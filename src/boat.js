// 船：三種木造漁船（小舢舨、漁船、大漁船）的模型、浮力與操控，以及可重複使用的人物模型。
// 船身與人物座標：+X 前方、+Y 向上、+Z 右側；船的原點在水線中央。
import * as THREE from 'three';
import { bulb } from './toon.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// len / beam / draft：長、寬、吃水；deck：甲板離水線的高度；bul：舷牆高；rise：船首翹起的高度
// speed：極速（公尺/秒）；tiltK：隨浪搖晃的程度；costK：引擎升級的價錢倍率
// cabin：駕駛艙範圍（沒有就是敞船）；helmX：掌舵時站的位置；box：魚箱的位置與大小
// hp：耐久度；tank：油箱容量（公升）；burn：油門全開每秒吃多少油；fuelX：加油的位置（引擎旁）
export const BOAT_TYPES = {
  skiff: {
    id: 'skiff', name: '小舢舨', price: 0, len: 6, beam: 2.2, draft: 0.45, deck: 0.32, bul: 0.33, rise: 0.4,
    speed: 4.4, tiltK: 1.15, costK: 0.4, paint: [0.86, 0.80, 0.62], cabin: null, helmX: -1.9, helmR: 0.8,
    hp: 60, tank: 20, burn: 0.04, fuelX: -2.6,
    box: { x: 0.9, z: 0, w: 0.7, d: 0.9, h: 0.4 },
  },
  fisher: {
    id: 'fisher', name: '漁船', price: 700, len: 13, beam: 4.6, draft: 1.0, deck: 0.85, bul: 0.35, rise: 1.1,
    speed: 7, tiltK: 1, costK: 1, paint: [0.08, 0.42, 0.44], cabin: { x0: -4.2, x1: -0.8, hw: 1.3, top: 2.3 }, helmX: -2.5, helmR: 1.1,
    hatch: { x: 2.0, s: 1.8 }, barrel: { x: 3.4, z: 0.9 }, box: { x: 0.5, z: 0, w: 0.9, d: 1.3, h: 0.55 },
    hp: 120, tank: 60, burn: 0.09, fuelX: -5.45,
  },
  trawler: {
    id: 'trawler', name: '大漁船', price: 3000, len: 18, beam: 6.2, draft: 1.3, deck: 1.05, bul: 0.45, rise: 1.4,
    speed: 8.6, tiltK: 0.75, costK: 1.8, paint: [0.55, 0.16, 0.12], cabin: { x0: -6.2, x1: -1.8, hw: 1.9, top: 2.4 }, helmX: -3.5, helmR: 1.1,
    hatch: { x: 2.8, s: 2.4 }, barrel: { x: 5.2, z: 1.4 }, box: { x: -0.5, z: 0, w: 1.0, d: 1.7, h: 0.6 },
    hp: 200, tank: 120, burn: 0.16, fuelX: -7.45,
  },
};
export const BOX_CAP = [0, 6, 12, 20];   // 魚箱各等級裝幾條
export const MAX_LEVEL = 3;
const CRACKS = 6;          // 耐久度分成幾處破洞：全破了船就沉
const DRIFT = 1.2;         // 沒油時只能用這個速度慢慢漂（公尺/秒）
// 船受得了的搖晃（斜率）：超過 SAFE 開始受損，橫搖超過 CAPSIZE 就翻
const SAFE_ROLL = 0.24, SAFE_PITCH = 0.28, CAPSIZE_ROLL = 0.5, CAPSIZE_PITCH = 1.0;   // 外海的浪變大之後，船受得了的角度也跟著放寬
const HURT_K = 5;          // 搖過頭時每秒扣多少耐久（乘上超出的角度）。以前是 40，船太容易壞；
// 現在：平常的日子在外海不會壞，風大的日子橫著受浪每分鐘掉一兩點，暴風雨裡橫著受浪小舢舨大約撐三四分鐘
const JOLT_K = 2;          // 船身晃多快算「猛地一晃」（俯仰、橫搖的角速度加起來，除以這個數字；1 以上甲板上的魚會被拋起來）
const GALE_HEEL = 0.07;   // 每秒 40 公尺的風（颱風）橫著吹過來時，船被壓歪的斜率（約 4 度；陣風時更多）
const SPOUT_HEEL = 0.3;  // 水龍捲最強的風橫著吹過來時，船被壓歪的斜率（加上浪的搖晃就可能翻）

const WHEEL_R = 0.33, ARM_LEN = 0.40;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const DOWN = new THREE.Vector3(0, -1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// ---- 人物：低多邊形的紙片風少女漁夫（早期 3D 主機的那種味道），約兩頭身。紅色大蝴蝶結、白色水手服配深藍裙子、咖啡色短靴。
// 全身用稜角分明的平面拼成、每個面一個顏色；頭髮是幾片有厚度的尖角板子；眼睛、腮紅、嘴是畫在平平的臉上的一張小圖。
// 四肢各自掛在關節上，走路或握舵時轉動關節即可（關節的位置和四肢的長度跟以前一樣，動作、手上拿的東西都不用改）
const flat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
// 把一堆點包起來的凸多面體。法線取相鄰面的平均（描邊是沿法線往外推的，這樣輪廓線才不會在稜角上裂開），
// 表面的明暗則由材質的 flatShading 一個面一個面算
function solid(points, mat) {
  let geo = new ConvexGeometry(points.map((p) => new THREE.Vector3(...p)));
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}
// 一圈八個點（切了角的長方形）：高度 y、前後 x0–x1、左右半寬 hz、切角 c
const ring = (y, x0, x1, hz, c) => [[x0, y, hz - c], [x0, y, c - hz], [x1, y, hz - c], [x1, y, c - hz], [x0 + c, y, hz], [x0 + c, y, -hz], [x1 - c, y, hz], [x1 - c, y, -hz]];
// 稜柱（上下半徑不同的幾邊形柱子）；四邊的轉 45 度，面才會朝正前、正側
function prism(mat, rTop, rBot, len, sides) {
  const geo = new THREE.CylinderGeometry(rTop, rBot, len, sides, 1);
  if (sides === 4) geo.rotateY(Math.PI / 4);
  return new THREE.Mesh(geo, mat);
}
// 臉：一張 64×36 的小圖，放大時不做平滑（一格一格的）。五官都擠在臉的下半部：
// 兩顆分得很開的深色長方眼睛（沒有亮點）、細細的眉毛、眼睛外下方的腮紅、一點點嘴
let faceTex = null;
function faceTexture() {
  if (faceTex) return faceTex;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 36;
  const g = cv.getContext('2d');
  for (const x of [13, 44]) {
    g.fillStyle = '#3a2620';
    g.fillRect(x + 1, 11, 5, 14); g.fillRect(x, 12, 7, 12);     // 眼睛：圓角的長方塊
    g.fillStyle = '#4e342a'; g.fillRect(x + 1, 21, 5, 3);       // 底下淡一點點
    g.fillStyle = '#8a5a3c'; g.fillRect(x, 6, 7, 1);            // 眉毛
  }
  g.fillStyle = '#f3a79c'; g.fillRect(6, 25, 7, 3); g.fillRect(51, 25, 7, 3);   // 腮紅
  g.fillStyle = '#b5534a'; g.fillRect(31, 29, 2, 2);                             // 嘴
  faceTex = new THREE.CanvasTexture(cv);
  faceTex.magFilter = faceTex.minFilter = THREE.NearestFilter;
  faceTex.generateMipmaps = false;
  faceTex.colorSpace = THREE.SRGBColorSpace;
  return faceTex;
}
export function buildFigure() {
  const g = new THREE.Group();
  const skin = flat(0xf6cfa8), hair = flat(0x7a4a2e), navy = flat(0x3d4290), shirt = flat(0xf6eeee);
  const boot = flat(0x6e4028), trim = flat(0xe9e4f2), ribbon = flat(0xd2302c);
  const face = new THREE.MeshLambertMaterial({ map: faceTexture(), alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // 一段稜柱狀的肢體：上端在關節上，往下垂
  const limb = (mat, rTop, rBot, len, x, y, z) => {
    const joint = new THREE.Group();
    joint.position.set(x, y, z);
    const m = prism(mat, rTop, rBot, len, 4);
    m.position.y = -len / 2;
    joint.add(m);
    g.add(joint);
    return joint;
  };
  const legs = [-1, 1].map((side) => {
    const joint = limb(skin, 0.07, 0.064, 0.27, 0, 0.44, side * 0.094);
    // 短靴：粗粗的靴筒加上一塊厚厚的鞋頭
    const shaft = prism(boot, 0.118, 0.112, 0.2, 4);
    shaft.position.y = -0.31;
    const toe = solid([[-0.09, -0.44, 0.092], [-0.09, -0.44, -0.092], [0.18, -0.44, 0.088], [0.18, -0.44, -0.088], [0.18, -0.385, 0.082], [0.18, -0.385, -0.082],
      [0.09, -0.33, 0.084], [0.09, -0.33, -0.084], [-0.09, -0.33, 0.092], [-0.09, -0.33, -0.092]], boot);
    joint.add(shaft, toe);
    return joint;
  });
  const arms = [-1, 1].map((side) => {
    const joint = limb(skin, 0.05, 0.078, ARM_LEN + 0.05, 0, 0.845, side * 0.2);   // 越往手越粗，手就是末端那一塊（沒有另外做手掌）
    const sleeve = prism(shirt, 0.075, 0.105, 0.12, 4);   // 短袖
    sleeve.position.y = -0.04;
    joint.add(sleeve);
    joint.userData.side = side;
    return joint;
  });
  const body = [];
  let parent = g, oy = 0;   // 現在往哪個關節上加東西、那個關節的高度
  const put = (m, x, y, z) => {
    m.position.set(x, y - oy, z);
    parent.add(m);
    body.push(m);
    return m;
  };
  // ---- 身體：白色水手服、深藍裙子、紅領巾 ----
  put(solid(ring(0.57, -0.135, 0.135, 0.19, 0.05).concat(ring(0.86, -0.095, 0.095, 0.135, 0.04)), shirt), 0, 0, 0);
  put(solid(ring(0.35, -0.215, 0.215, 0.275, 0.09).concat(ring(0.61, -0.115, 0.115, 0.16, 0.045)), navy), 0, 0, 0);   // 裙子
  put(solid(ring(0.835, -0.125, 0.12, 0.175, 0.05).concat(ring(0.875, -0.1, 0.1, 0.145, 0.045)), navy), 0, 0, 0);     // 水手領（搭在肩膀上的一圈）
  put(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.27), navy), -0.115, 0.775, 0);                                // 背後垂下來的方領
  put(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.23), trim), -0.128, 0.725, 0);                               // 領子上的白線
  put(solid([[0.115, 0.855, 0.04], [0.115, 0.855, -0.04], [0.15, 0.80, 0.055], [0.15, 0.80, -0.055], [0.115, 0.79, 0.055], [0.115, 0.79, -0.055],
    [0.15, 0.655, 0], [0.125, 0.665, 0]], ribbon), 0, 0, 0);                                                           // 領巾
  const torso = body.splice(0);   // 到這裡為止是軀幹：第一人稱走路時留著（低頭看得到自己的身體），掌舵時才藏
  put(prism(skin, 0.05, 0.056, 0.08, 6), 0, 0.915, 0);                                                                 // 脖子（幾乎被頭蓋住）
  // ---- 頭：很大的一顆（差不多跟身體一樣高），正面是平的。整顆頭（連頭髮和蝴蝶結）掛在脖子的關節上，可以轉頭、抬頭、低頭 ----
  const head = new THREE.Group();
  head.position.y = 0.95;
  g.add(head);
  parent = head; oy = 0.95;
  const HY = 1.2;   // 頭的中心高度
  const at = (pts) => pts.map(([x, y, z]) => [x, y + HY, z]);
  put(solid(at([...ring(-0.27, -0.14, 0.17, 0.19, 0.08), ...ring(-0.2, -0.23, 0.26, 0.265, 0.1), ...ring(0.0, -0.26, 0.26, 0.315, 0.08),
    ...ring(0.18, -0.24, 0.25, 0.29, 0.1), ...ring(0.27, -0.14, 0.14, 0.17, 0.07)]), skin), 0, 0, 0);
  const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.27), face);
  faceMesh.rotation.y = Math.PI / 2;
  put(faceMesh, 0.2615, HY - 0.065, 0);
  for (const side of [-1, 1]) put(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.04), skin), -0.03, HY - 0.12, side * 0.3);   // 耳朵
  // ---- 頭髮：比頭大一圈、有稜有角的一大塊；額前一片大尖瀏海垂到兩眼中間，兩旁的瀏海往外撇；
  //      兩側各一大束尖尖的頭髮垂到肩膀，後面兩束往外翹；後腦勺的頭髮蓋到脖子 ----
  put(solid(at([...ring(-0.1, -0.33, -0.05, 0.33, 0.1), ...ring(0.06, -0.335, 0.2, 0.36, 0.1), ...ring(0.2, -0.3, 0.3, 0.33, 0.11),
    ...ring(0.31, -0.2, 0.2, 0.22, 0.09), [-0.02, 0.37, 0]]), hair), 0, 0, 0);
  // 瀏海：[左右位置, 寬, 尖端的高度, 尖端的左右位置]
  for (const [zc, w, tipY, tipZ] of [[0, 0.19, -0.07, 0.01], [-0.16, 0.15, -0.005, -0.2], [0.16, 0.15, -0.005, 0.2], [-0.275, 0.13, -0.15, -0.3], [0.275, 0.13, -0.15, 0.3]]) {
    put(solid(at([[0.305, 0.19, zc - w / 2], [0.305, 0.19, zc + w / 2], [0.262, 0.19, zc - w / 2], [0.262, 0.19, zc + w / 2], [0.295, tipY, tipZ], [0.268, tipY, tipZ]]), hair), 0, 0, 0);
  }
  for (const side of [-1, 1]) {
    put(solid(at([[0.17, 0.06, side * 0.3], [-0.05, 0.06, side * 0.3], [0.17, 0.06, side * 0.37], [-0.05, 0.06, side * 0.37],
      [0.18, -0.2, side * 0.31], [-0.04, -0.2, side * 0.33], [0.15, -0.2, side * 0.41], [-0.04, -0.22, side * 0.42], [0.08, -0.47, side * 0.37]]), hair), 0, 0, 0);   // 臉旁垂下來的一束
    put(solid(at([[-0.02, 0.0, side * 0.3], [-0.25, 0.0, side * 0.25], [-0.02, 0, side * 0.36], [-0.25, 0, side * 0.3],
      [-0.06, -0.25, side * 0.34], [-0.27, -0.22, side * 0.27], [-0.1, -0.25, side * 0.45], [-0.3, -0.24, side * 0.37], [-0.2, -0.52, side * 0.44]]), hair), 0, 0, 0);   // 後面往外翹的一束
  }
  put(solid(at([...ring(-0.08, -0.335, -0.1, 0.3, 0.1), [-0.33, -0.3, 0.13], [-0.33, -0.3, -0.13], [-0.3, -0.37, 0], [-0.2, -0.27, 0.2], [-0.2, -0.27, -0.2]]), hair), 0, 0, 0);   // 後腦勺
  // ---- 紅色大蝴蝶結：綁在後腦勺上方，兩片大翅膀往上往外張，底下垂著兩條帶子 ----
  const bow = new THREE.Group();   // 整個蝴蝶結歪向一邊（從正面只看得到一側露出來）
  bow.rotation.x = 0.3; bow.position.z = 0.03;
  head.add(bow); parent = bow;
  put(solid(at([[-0.3, 0.27, 0.05], [-0.3, 0.27, -0.05], [-0.3, 0.17, 0.05], [-0.3, 0.17, -0.05], [-0.37, 0.25, 0.04], [-0.37, 0.25, -0.04], [-0.37, 0.19, 0.04], [-0.37, 0.19, -0.04]]), ribbon), 0, 0, 0);
  for (const side of [-1, 1]) {
    put(solid(at([[-0.31, 0.25, side * 0.04], [-0.31, 0.19, side * 0.04], [-0.36, 0.22, side * 0.04], [-0.27, 0.5, side * 0.36], [-0.36, 0.48, side * 0.36],
      [-0.31, 0.1, side * 0.42], [-0.38, 0.12, side * 0.4]]), ribbon), 0, 0, 0);
    put(solid(at([[-0.32, 0.19, side * 0.02], [-0.36, 0.19, side * 0.02], [-0.32, 0.19, side * 0.06], [-0.37, -0.1, side * 0.24], [-0.42, -0.08, side * 0.17], [-0.4, -0.15, side * 0.14]]), ribbon), 0, 0, 0);
  }
  parent = head;
  // fpHide：掌舵的第一人稱要藏起來的部分（脖子以上）；mats：這個人用到的所有材質
  g.traverse((m) => { if (m.isMesh) m.userData.figure = true; });
  g.userData = { legs, arms, head, fpHide: body, torso, mats: [skin, hair, navy, shirt, boot, trim, ribbon, face] };
  return g;
}

// 船身半寬；t：0 = 船尾，1 = 船首
function halfBeam(S, t) {
  return (S.beam / 2) * (t < 0.38
    ? 0.74 + 0.26 * Math.sin((t / 0.38) * Math.PI / 2)
    : Math.pow(Math.max(Math.cos(((t - 0.38) / 0.62) * Math.PI / 2), 0), 0.52));
}

function hullSection(S, t) {
  const half = halfBeam(S, t);
  const sheer = S.deck + S.bul + S.rise * Math.pow(t, 2.6) + 0.43 * S.bul * (1 - t) * (1 - t);
  const keel = -S.draft * (1 - Math.pow(t, 5));
  // 半邊剖面，由龍骨到舷緣：[橫向, 高度]
  return [[0, keel], [0.6 * half, keel * 0.9], [1.07 * half, keel * 0.12], [1.13 * half, 0.56 * sheer], [half * 1.03, sheer]];
}

// 把剖面的五個控制點連成圓滑的曲線（Catmull-Rom），回傳 n+1 個點
function smoothSection(pts, n) {
  const out = [], P = (i) => pts[clamp(i, 0, pts.length - 1)];
  for (let k = 0; k <= n; k++) {
    const u = (k / n) * (pts.length - 1), i = Math.min(Math.floor(u), pts.length - 2), t = u - i;
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2), t2 = t * t, t3 = t2 * t;
    out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t3)));
  }
  return out;
}

function buildHull(S) {
  const NS = 34, NP = 9;   // 縱向分幾段、半邊剖面分幾段
  const rings = [], sheers = [];
  for (let s = 0; s <= NS; s++) {
    const t = s / NS, x = (t - 0.5) * S.len;
    const ctrl = hullSection(S, t), half = smoothSection(ctrl, NP);
    half[0][0] = 0;
    for (const p of half) p[0] = Math.max(p[0], 0);
    const ring = [];
    for (let i = half.length - 1; i >= 0; i--) ring.push([x, half[i][1], -half[i][0]]);
    for (let i = 1; i < half.length; i++) ring.push([x, half[i][1], half[i][0]]);
    rings.push(ring);
    sheers.push(ctrl[4][1]);
  }
  const M = rings[0].length, mid = (M - 1) / 2;
  // 每個格點的法線：周圍幾個面的平均，船殼的明暗才是圓滑的
  const nrm = rings.map((r) => r.map(() => new THREE.Vector3()));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let s = 0; s < NS; s++) {
    for (let i = 0; i < M - 1; i++) {
      a.fromArray(rings[s][i]); b.fromArray(rings[s + 1][i]); c.fromArray(rings[s][i + 1]);
      fn.subVectors(b, a).cross(c.sub(a));
      for (const [ss, ii] of [[s, i], [s + 1, i], [s, i + 1], [s + 1, i + 1]]) nrm[ss][ii].add(fn);
    }
  }
  const pos = [], colr = [], nor = [], deck = [], cap = [];
  // 水線下是深紅的防污漆，水線上一道白漆，船舷是上過油的木頭，舷牆是各船自己的漆色
  const RED = [0.50, 0.095, 0.065], WHITE = [0.90, 0.88, 0.80], WOOD = [0.52, 0.31, 0.15], PAINT = S.paint.map((v) => Math.min(1, v * 1.25));
  const tri = (list) => { for (const [ss, ii] of list) { pos.push(...rings[ss][ii]); const n = nrm[ss][ii]; const l = n.length() || 1; nor.push(n.x / l, n.y / l, n.z / l); } };
  for (let s = 0; s < NS; s++) {
    for (let i = 0; i < M - 1; i++) {
      tri([[s, i], [s + 1, i], [s, i + 1], [s + 1, i], [s + 1, i + 1], [s, i + 1]]);
      const y = (rings[s][i][1] + rings[s][i + 1][1] + rings[s + 1][i][1] + rings[s + 1][i + 1][1]) / 4;
      const sheer = (sheers[s] + sheers[s + 1]) / 2, strake = Math.min(Math.abs(i - mid), Math.abs(i + 1 - mid));
      let col = y < 0.0 ? RED : y < 0.11 ? WHITE : y < 0.66 * sheer ? WOOD : PAINT;
      if (col === WOOD) { const k = 0.86 + 0.28 * (((s >> 1) * 7 + strake * 3) % 4) / 3; col = [WOOD[0] * k, WOOD[1] * k, WOOD[2] * k]; }   // 木板一片深一片淺
      for (let n = 0; n < 6; n++) colr.push(col[0], col[1], col[2]);
    }
    const d = (r) => [[r[0][0], S.deck, r[0][2] * 0.97], [r[M - 1][0], S.deck, r[M - 1][2] * 0.97]];
    const [a0, a1] = d(rings[s]), [b0, b1] = d(rings[s + 1]);
    deck.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
    // 舷緣蓋板：舷牆頂上一條深色的木條
    for (const e of [0, M - 1]) {
      const p = rings[s][e], q = rings[s + 1][e], w = 0.07, up = 0.035;
      const o0 = [p[0], p[1] + up, p[2] * 1.02 + Math.sign(p[2]) * 0.02], i0 = [p[0], p[1] + up, p[2] - Math.sign(p[2]) * w];
      const o1 = [q[0], q[1] + up, q[2] * 1.02 + Math.sign(q[2]) * 0.02], i1 = [q[0], q[1] + up, q[2] - Math.sign(q[2]) * w];
      cap.push(...o0, ...o1, ...i0, ...o1, ...i1, ...i0, ...o0, ...p, ...o1, ...o1, ...p, ...q);
    }
  }
  // 船尾封板：左舷、右舷同一高度的點兩兩相連，一條一條橫的木板把整個船尾封起來
  // （以前是從龍骨那一點往外拉的扇形，只蓋到船殼曲線底下那一小圈，甲板以上是敞開的，浪會從船尾直接漫進來）
  for (let i = 0; i < mid; i++) {
    const L0 = rings[0][i], L1 = rings[0][i + 1], R0 = rings[0][M - 1 - i], R1 = rings[0][M - 2 - i];
    pos.push(...L0, ...L1, ...R0, ...L1, ...R1, ...R0);
    const y = (L0[1] + L1[1]) / 2, col = y < 0.0 ? RED : y < 0.11 ? WHITE : y < 0.66 * sheers[0] ? WOOD : PAINT;
    for (let n = 0; n < 6; n++) { colr.push(col[0], col[1], col[2]); nor.push(-1, 0, 0); }
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  hg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colr), 3));
  hg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(deck), 3));
  const duv = new Float32Array((deck.length / 3) * 2);
  for (let i = 0; i < deck.length / 3; i++) { duv[i * 2] = deck[i * 3] / 1.6; duv[i * 2 + 1] = deck[i * 3 + 2] / 1.1; }
  dg.setAttribute('uv', new THREE.BufferAttribute(duv, 2));
  dg.computeVertexNormals();
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap), 3));
  cg.computeVertexNormals();
  return [
    new THREE.Mesh(hg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })),
    new THREE.Mesh(dg, lambert(0x8f6c44, { side: THREE.DoubleSide, map: deckTexture(S.len, S.beam) })),
    new THREE.Mesh(cg, lambert(0x3d2817, { side: THREE.DoubleSide })),
  ];
}

// 甲板的木板紋：一條條縱向的木板
let deckTex = null;
function deckTexture() {
  if (deckTex) return deckTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  for (let i = 0; i < 8; i++) {
    const v = 200 + ((i * 53) % 40);
    g.fillStyle = `rgb(${v}, ${v - 8}, ${v - 22})`;
    g.fillRect(0, i * 16, 128, 16);
    g.fillStyle = 'rgba(40, 24, 10, 0.55)';
    g.fillRect(0, i * 16, 128, 1.5);
    g.fillRect((i * 37) % 128, i * 16, 1.5, 16);
  }
  deckTex = new THREE.CanvasTexture(cv);
  deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
  deckTex.colorSpace = THREE.SRGBColorSpace;
  return deckTex;
}

// 有駕駛艙的船（漁船、大漁船）
function buildCabinBoat(S, g, blocks) {
  const D = S.deck, { x0, x1, hw, top } = S.cabin, cx = (x0 + x1) / 2, wallH = 1.05;
  const cream = lambert(0xe8dcc0), wood = lambert(0x7a5230), darkWood = lambert(0x4f3520);
  const iron = lambert(0x2b2d2f), brass = lambert(0xb8923a);
  const paint = new THREE.MeshLambertMaterial({ color: new THREE.Color(...S.paint).multiplyScalar(1.6) });

  // ---- 駕駛艙：木造、四面開窗、後方敞開 ----
  g.add(box(0.1, wallH, hw * 2, cream, x1, D + wallH / 2, 0));
  g.add(box(x1 - x0, wallH, 0.1, cream, cx, D + wallH / 2, -hw));
  g.add(box(x1 - x0, wallH, 0.1, cream, cx, D + wallH / 2, hw));
  const hdr = top - 1.95;
  g.add(box(0.1, hdr, hw * 2, cream, x1, D + 1.95 + hdr / 2, 0));
  g.add(box(x1 - x0, hdr, 0.1, cream, cx, D + 1.95 + hdr / 2, -hw));
  g.add(box(x1 - x0, hdr, 0.1, cream, cx, D + 1.95 + hdr / 2, hw));
  for (const px of [x0, x1]) for (const pz of [-hw, hw]) g.add(box(0.16, top, 0.16, wood, px, D + top / 2, pz));
  const roofY = D + top + 0.14;
  g.add(box(x1 - x0 + 0.7, 0.14, hw * 2 + 0.5, paint, cx, roofY - 0.07, 0));
  blocks.push([x1 - 0.75, x1 + 0.25, -hw - 0.2, hw + 0.2],        // 舵台與前牆
    [x0 - 0.15, x1 + 0.25, -hw - 0.2, -hw + 0.18],                 // 左牆
    [x0 - 0.15, x1 + 0.25, hw - 0.18, hw + 0.2]);                  // 右牆

  // 窗玻璃、紅綠航行燈、救生圈、屋頂的扶手與天線
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fc0d0, transparent: true, opacity: 0.2, depthWrite: false });
  g.add(box(0.03, 0.9, hw * 2 - 0.16, glass, x1, D + 1.5, 0),
    box(x1 - x0 - 0.16, 0.9, 0.03, glass, cx, D + 1.5, -hw), box(x1 - x0 - 0.16, 0.9, 0.03, glass, cx, D + 1.5, hw));
  for (const pz of [-hw * 0.34, hw * 0.34]) g.add(box(0.06, 0.9, 0.06, wood, x1, D + 1.5, pz));          // 前窗的窗框
  g.add(box(0.06, 0.9, 0.06, wood, cx, D + 1.5, -hw), box(0.06, 0.9, 0.06, wood, cx, D + 1.5, hw));
  for (const [side, colr] of [[-1, 0xff3b30], [1, 0x34d058]]) {
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: colr }));
    nav.position.set(x1 + 0.2, D + top + 0.2, side * (hw + 0.1));
    g.add(nav, box(0.14, 0.12, 0.05, iron, x1 + 0.14, D + top + 0.2, side * (hw + 0.16)));
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 8, 18), lambert(0xe2582a));
  ring.rotation.set(0, 0, 0);
  ring.position.set(cx - 0.3, D + 0.62, hw + 0.09);
  g.add(ring);
  for (const a of [0, 1, 2, 3]) {
    const band = box(0.16, 0.16, 0.05, lambert(0xf2f0ea), 0, 0, 0);
    band.position.set(cx - 0.3 + Math.cos(a * Math.PI / 2 + 0.78) * 0.26, D + 0.62 + Math.sin(a * Math.PI / 2 + 0.78) * 0.26, hw + 0.09);
    band.rotation.z = a * Math.PI / 2 + 0.78;
    g.add(band);
  }
  const railY = D + top + 0.14 + 0.22;
  for (const pz of [-hw - 0.12, hw + 0.12]) {
    g.add(box(x1 - x0 + 0.3, 0.035, 0.035, iron, cx, railY, pz));
    for (const px of [x0 - 0.05, cx, x1 + 0.05]) g.add(box(0.035, 0.22, 0.035, iron, px, railY - 0.11, pz));
  }
  const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 2.2, 5), iron);
  whip.position.set(x0 + 0.3, D + top + 1.24, hw - 0.25);
  g.add(whip);

  // ---- 舵台、方向盤、油門桿 ----
  const wheelPos = new THREE.Vector3(x1 - 0.82, D + 1.12, 0);
  g.add(box(0.55, 1.0, hw * 2 - 1.0, wood, x1 - 0.4, D + 0.5, 0));
  g.add(box(0.06, 0.24, 0.34, brass, x1 - 0.65, D + 1.13, -0.5)); // 羅盤座
  const wheel = new THREE.Group();
  wheel.position.copy(wheelPos);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R, 0.03, 8, 28), darkWood);
  rim.rotation.y = Math.PI / 2;
  wheel.add(rim);
  for (let s = 0; s < 3; s++) {
    const spoke = box(0.03, WHEEL_R * 2, 0.03, darkWood, 0, 0, 0);
    spoke.rotation.x = (s * Math.PI) / 3;
    wheel.add(spoke);
  }
  for (let s = 0; s < 6; s++) { // 握把：看得出方向盤轉了多少
    const a = (s * Math.PI) / 3;
    const h = box(0.035, 0.1, 0.035, darkWood, 0, Math.cos(a) * (WHEEL_R + 0.07), Math.sin(a) * (WHEEL_R + 0.07));
    h.rotation.x = a;
    wheel.add(h);
  }
  wheel.add(box(0.1, 0.09, 0.09, brass, 0.03, 0, 0));
  g.add(wheel, box(0.3, 0.05, 0.05, iron, x1 - 0.67, wheelPos.y, 0));
  const throttle = new THREE.Group();
  throttle.position.set(x1 - 0.45, D + 1.0, 0.6);
  throttle.add(box(0.04, 0.3, 0.04, brass, 0, 0.15, 0), box(0.07, 0.07, 0.07, lambert(0xb23a2e), 0, 0.3, 0));
  g.add(throttle);

  // ---- 屋頂：短桅與油燈 ----
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.4, 8), wood);
  mast.position.set(cx - 0.8, roofY + 1.2, 0);
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), bulb(0xffd98a));
  lantern.position.set(cx - 0.8, roofY + 2.5, 0);
  g.add(mast, lantern, box(0.9, 0.05, 0.05, wood, cx - 0.8, roofY + 1.9, 0));

  // ---- 船尾：引擎箱、排氣管、插著的釣竿 ----
  const ex = x0 - 1.25;
  g.add(box(1.1, 0.75, 1.4, wood, ex, D + 0.375, 0));
  blocks.push([ex - 0.65, ex + 0.6, -0.8, 0.8]);
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.3, 8), iron);
  stack.position.set(ex - 0.05, D + 1.6, 0.4);
  g.add(stack);
  const rodMat = lambert(0x3b2a1a), rx = x0 - 1.7, rw = halfBeam(S, (rx + S.len / 2) / S.len) - 0.28;
  for (const [rz, lean] of [[-rw, -0.35], [rw, 0.35], [-rw * 0.65, -0.2]]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 3.6, 6), rodMat);
    rod.position.set(rx, D + 1.9, rz + lean * 1.2);
    rod.rotation.set(lean, 0, 0.5);
    g.add(rod);
  }

  // ---- 前甲板：艙蓋、靠牆的木箱、木桶、繩圈、浮球 ----
  g.add(box(S.hatch.s, 0.28, S.hatch.s, darkWood, S.hatch.x, D + 0.14, 0));
  const crate = lambert(0xa9824e), kx = x1 + 0.4;
  g.add(box(0.55, 0.42, 0.8, crate, kx, D + 0.21, 0.45), box(0.55, 0.42, 0.8, crate, kx, D + 0.63, 0.45),
    box(0.55, 0.42, 0.8, crate, kx, D + 0.21, -0.5));
  blocks.push([kx - 0.2, kx + 0.35, -1.0, 0.95]);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.85, 10), lambert(0x8a5a2e));
  barrel.position.set(S.barrel.x, D + 0.43, S.barrel.z);
  blocks.push([S.barrel.x - 0.4, S.barrel.x + 0.4, S.barrel.z - 0.4, S.barrel.z + 0.4]);
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.09, 6, 14), lambert(0xc9ae7a));
  rope.rotation.x = Math.PI / 2;
  rope.position.set(S.barrel.x + 0.9, D + 0.1, 0.3);
  g.add(barrel, rope);
  const buoy = lambert(0xf07a1a);
  for (const [bx, bz] of [[S.barrel.x + 1.2, -0.3], [x0 - 0.4, -hw - 0.2]]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), buoy);
    b.position.set(bx, D + 0.24, bz);
    g.add(b);
  }

  // ---- 油箱：引擎箱右邊橫躺的一顆鐵桶，上面有加油口，一條油管接進引擎箱 ----
  const tz = 1.2, tankMat = lambert(0x3f6652), tankY = D + 0.36;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.8, 14), tankMat);
  drum.rotation.z = Math.PI / 2;
  drum.position.set(ex, tankY, tz);
  g.add(drum);
  for (const sx of [-0.26, 0.26]) {
    g.add(box(0.1, 0.16, 0.56, darkWood, ex + sx, D + 0.08, tz));                      // 墊木
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.278, 0.278, 0.05, 14), iron);
    strap.rotation.z = Math.PI / 2;
    strap.position.set(ex + sx, tankY, tz);
    g.add(strap);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), iron);
  neck.position.set(ex + 0.1, tankY + 0.3, tz);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.035, 12), brass);
  cap.position.set(ex + 0.1, tankY + 0.36, tz);
  const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 12), lambert(0xf2eede));
  gauge.rotation.z = Math.PI / 2;
  gauge.position.set(ex + 0.41, tankY + 0.02, tz);
  g.add(neck, cap, gauge, box(0.05, 0.05, 0.42, iron, ex - 0.2, D + 0.2, tz - 0.42));   // 油管
  blocks.push([ex - 0.45, ex + 0.45, tz - 0.3, tz + 0.3]);

  // ---- 前甲板左舷的長椅：坐在上面面向海，可以釣魚 ----
  const sx = S.hatch.x, sz = -(halfBeam(S, (sx + S.len / 2) / S.len) - 0.62);
  g.add(box(1.3, 0.06, 0.36, wood, sx, D + 0.42, sz));
  for (const lx of [-0.52, 0.52]) g.add(box(0.07, 0.4, 0.32, darkWood, sx + lx, D + 0.2, sz));
  g.add(box(1.04, 0.05, 0.05, darkWood, sx, D + 0.14, sz));
  blocks.push([sx - 0.66, sx + 0.66, sz - 0.19, sz + 0.19]);

  // ---- 船燈的開關：駕駛艙右前方那根柱子內側的一個小銅盒，上面一根撥桿、一顆指示燈 ----
  const sw = new THREE.Vector3(x1 - 0.14, D + 1.32, hw - 0.14);
  g.add(box(0.07, 0.2, 0.13, brass, sw.x, sw.y, sw.z));
  const lever = new THREE.Group();
  lever.position.set(sw.x - 0.04, sw.y - 0.02, sw.z);
  lever.add(box(0.09, 0.025, 0.025, iron, -0.04, 0, 0), box(0.035, 0.045, 0.045, lambert(0xb23a2e), -0.09, 0, 0));
  const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: 0x3a2a1a }));
  pilot.position.set(sw.x - 0.04, sw.y + 0.065, sw.z);
  g.add(lever, pilot);

  const helmsman = buildFigure();
  helmsman.position.set(S.helmX, D, 0);
  g.add(helmsman);
  return {
    wheel, wheelPos, throttle, helmsman, lantern, lever, pilot,
    helm: wheelPos,                                       // 準心要對準哪裡才能掌舵：方向盤
    tank: new THREE.Vector3(ex + 0.1, tankY + 0.3, tz),   // 加油口
    switch: sw, switchR: 0.2,                             // 船燈的開關
    seats: [{ x: sx, z: sz, h: 0.45, yaw: -Math.PI / 2, out: [0, 0.6] }],   // 坐的位置、坐墊高度、面向（相對船首）、站起來時往哪裡挪
    eye: new THREE.Vector3(S.helmX + 0.08, D + 1.63, 0), // 第一人稱的眼睛位置
    lamp: new THREE.Vector3(cx - 0.8, roofY + 2.5, 0),   // 桅頂的油燈
    roof: [[x0, -hw], [x1, -hw], [x1, hw], [x0, hw]].map(([x, z]) => new THREE.Vector3(x, roofY, z)),
  };
}

// 小舢舨：敞船，船尾掛一顆小引擎，用舵柄操控
function buildSkiff(S, g, blocks) {
  const D = S.deck, wood = lambert(0x7a5230), iron = lambert(0x2b2d2f);
  for (const tx of [-0.7, 1.9]) g.add(box(0.28, 0.05, halfBeam(S, (tx + S.len / 2) / S.len) * 1.9, wood, tx, D + 0.3, 0)); // 坐板
  // 船尾外掛引擎與舵柄
  const tiller = new THREE.Group();
  tiller.position.set(-S.len / 2 + 0.05, D + 0.55, 0);
  tiller.add(box(0.3, 0.42, 0.26, iron, 0, 0.05, 0), box(0.08, 0.9, 0.08, iron, -0.08, -0.6, 0),
    box(0.9, 0.05, 0.05, wood, 0.55, 0.2, 0));
  // 引擎的圓頂罩、螺旋槳旁的護板
  const cowl = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), lambert(0x8a1f1a));
  cowl.scale.set(1.0, 0.9, 0.8);
  cowl.position.set(0, 0.26, 0);
  tiller.add(cowl, box(0.26, 0.05, 0.3, iron, -0.1, -0.86, 0), box(0.05, 0.3, 0.02, iron, -0.2, -1.0, 0));
  g.add(tiller);
  // 靠在船舷內側的一對船槳
  const oarMat = lambert(0x9a7448);
  for (const side of [-1, 1]) {
    const hb = halfBeam(S, 0.5) - 0.2;
    const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.6, 6), oarMat);
    oar.rotation.z = Math.PI / 2;
    oar.position.set(0.3, D + 0.1, side * hb);
    const blade = box(0.6, 0.03, 0.16, oarMat, 1.75, D + 0.1, side * hb);
    g.add(oar, blade);
  }
  // 船首的小燈、繩圈與浮球
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.0, 6), wood);
  post.position.set(S.len / 2 - 0.9, D + 0.7, 0);
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), bulb(0xffd98a));
  lantern.position.set(S.len / 2 - 0.9, D + 1.25, 0);
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 6, 12), lambert(0xc9ae7a));
  rope.rotation.x = Math.PI / 2;
  rope.position.set(S.len / 2 - 1.4, D + 0.07, 0.25);
  g.add(post, lantern, rope);

  // 油箱：船尾左側一個紅色的手提油箱，一條油管接到引擎
  const red = lambert(0xb8322a), tx = -2.25, tz = -0.5;
  g.add(box(0.44, 0.24, 0.3, red, tx, D + 0.12, tz), box(0.2, 0.03, 0.04, iron, tx - 0.06, D + 0.3, tz),
    box(0.03, 0.06, 0.04, iron, tx - 0.15, D + 0.27, tz), box(0.03, 0.06, 0.04, iron, tx + 0.03, D + 0.27, tz));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10), iron);
  cap.position.set(tx + 0.14, D + 0.265, tz);
  const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.62, 5), iron);
  hose.position.set(-2.62, D + 0.3, -0.27);
  hose.rotation.set(0.75, 0, 1.0);
  g.add(cap, hose);
  blocks.push([tx - 0.24, tx + 0.24, tz - 0.17, tz + 0.17]);

  const helmsman = buildFigure();
  helmsman.position.set(S.helmX, D, 0);
  g.add(helmsman);
  const c = [[-1.5, -0.6], [1.5, -0.6], [1.5, 0.6], [-1.5, 0.6]];
  return {
    wheel: null, tiller, throttle: null, helmsman, lantern, lever: null, pilot: null,
    helm: new THREE.Vector3(-S.len / 2 + 0.6, D + 0.75, 0),      // 準心要對準哪裡才能掌舵：舵柄
    tank: new THREE.Vector3(tx + 0.14, D + 0.27, tz),            // 加油口
    switch: new THREE.Vector3(S.len / 2 - 0.9, D + 1.25, 0), switchR: 0.3,   // 船燈沒有另外的開關：直接對準船首那盞燈
    seats: [{ x: -0.7, z: 0, h: 0.34, yaw: 0, out: [0.45, 0] }, { x: 1.9, z: 0, h: 0.34, yaw: Math.PI, out: [-0.45, 0] }],   // 兩塊坐板
    eye: new THREE.Vector3(S.helmX + 0.08, D + 1.63, 0),
    lamp: new THREE.Vector3(S.len / 2 - 0.9, D + 1.25, 0),
    roof: c.map(([x, z]) => new THREE.Vector3(x, D, z)),   // 沒有屋頂：影子只算船身
  };
}

// 回傳船的模型；blocks 會被填入甲板上走不過去的範圍 [x0, x1, z0, z1]
export function buildBoatMesh(S, blocks = []) {
  const g = new THREE.Group();
  buildHull(S).forEach((m) => g.add(m));
  // 船舷掛的草繩碰墊
  const fender = new THREE.CylinderGeometry(0.16, 0.16, 0.7, 8), fmat = lambert(0xc9ae7a);
  for (const t of S.cabin ? [0.3, 0.5, 0.68] : [0.4, 0.62]) {
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(fender, fmat);
      m.position.set((t - 0.5) * S.len, S.deck * 0.6, side * (hullSection(S, t)[3][0] + 0.14));
      if (!S.cabin) m.scale.setScalar(0.6);
      g.add(m);
    }
  }
  g.userData = S.cabin ? buildCabinBoat(S, g, blocks) : buildSkiff(S, g, blocks);
  return g;
}

// 船底取樣的九個點（船長方向、船寬方向，各以取樣半徑為 1）：船頭、船尾、兩舷、四個角、正中央
const HULL_PTS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.6, 0.8], [0.6, -0.8], [-0.6, 0.8], [-0.6, -0.8], [0, 0]];

// 船艙口的「蓋子」：一片看不見、只寫深度的面，蓋在舷緣的高度上。海面畫到這裡就被擋掉，
// 浪高過甲板但還沒高過舷緣的時候，水才不會出現在船裡面（真的高過舷緣灌進來的水照樣看得到）
function buildWaterMask(S) {
  const NS = 24, pos = [], idx = [];
  for (let s = 0; s <= NS; s++) {
    const t = s / NS, x = (t - 0.5) * S.len, half = halfBeam(S, t);
    const y = S.deck + S.bul + S.rise * Math.pow(t, 2.6) + 0.43 * S.bul * (1 - t) * (1 - t) - 0.03;
    pos.push(x, y, -half, x, y, half);
    if (s < NS) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, side: THREE.DoubleSide }));
  m.renderOrder = 1;   // 在不透明的船身之後、海面（renderOrder 2）之前畫
  return m;
}

export class Boat {
  constructor(type, x, z, heading) {
    const S = this.spec = BOAT_TYPES[type];
    this.blocks = [];
    this.mesh = buildBoatMesh(S, this.blocks);
    this.parts = this.mesh.userData;
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0;
    this.rudder = 0;     // -1（左滿舵）到 +1（右滿舵）
    this.throttle = 0;
    this.y = 0;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.keys = { w: false, a: false, s: false, d: false };
    this.aground = false;
    this.manned = false;
    this.engineLv = 0;   // 引擎等級：每級極速 +15%
    this.boxLv = 0;      // 魚箱等級：0 = 沒有
    this.boxFish = [];   // 魚箱裡的魚
    this.boxMesh = null;
    this.fuel = S.tank;  // 油箱裡的油（公升）；新船是滿的
    this.damage = [];    // 甲板上的破洞：{ lx, lz, dmg, mesh }。耐久度 = 滿的 - 所有破洞
    this.roll = 0;       // 目前的橫搖、縱搖（斜率）
    this.pitch = 0;
    this.sinking = 0;    // 正在沉：開始沉了幾秒（0 = 沒事）
    this.sunkBy = null;  // 'capsize' 被浪打翻、'flood' 破損太嚴重
    this.moor = null;    // 纜繩綁在岸上的哪根繫纜樁：{ i 第幾根, lx, lz 船上綁繩子的位置, len 繩長 }；沒綁是 null
    this.lampOn = true;  // 船燈的開關（開著：天黑了會照亮甲板；關掉就不亮）
    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._nS = new THREE.Vector3(0, 1, 0);         // 只看長浪的姿態（算船受不受得了用）
    this._vp = 0; this._vr = 0; this._wp = 0; this._wr = 0;   // 畫面上的縱搖、橫搖（斜率）與它們變化的速度
    this.waterMask = buildWaterMask(S);            // 擋住船艙裡的海面（由外面在描邊、陰影設好之後再掛到船上）
    this.setManned(false);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = -heading;
  }

  get maxSpeed() { return this.spec.speed * (1 + 0.15 * this.engineLv); }
  get boxCap() { return BOX_CAP[this.boxLv]; }
  get hp() { return Math.max(0, this.spec.hp - this.damage.reduce((sum, d) => sum + d.dmg, 0)); }

  // 受損：甲板上裂開一個洞，繼續受損洞會變大，大到一定程度再裂下一個
  hurt(amount) {
    const each = this.spec.hp / CRACKS;
    while (amount > 1e-9 && this.hp > 0) {
      let c = this.damage[this.damage.length - 1];
      if (!c || c.dmg >= each - 1e-9) c = this._crack();
      const add = Math.min(each - c.dmg, amount);   // 一個洞裝不下的，裂到下一個洞
      c.dmg += add; amount -= add;
      c.mesh.scale.setScalar(0.5 + 0.5 * c.dmg / each);
    }
  }

  // 讀檔時把破洞放回原來的位置
  restoreCrack(lx, lz, dmg) {
    const each = this.spec.hp / CRACKS, c = this._crack({ lx, lz });
    c.dmg = Math.min(each, dmg);
    c.mesh.scale.setScalar(0.5 + 0.5 * c.dmg / each);
  }

  _crack(at = null) {
    const S = this.spec;
    for (let n = 0; n < 80 && !at; n++) {
      const lx = (Math.random() - 0.5) * S.len, lz = (Math.random() - 0.5) * S.beam;
      if (!this.deckContains(lx, lz) || this.blockedLocal(lx, lz)) continue;
      // 不要裂在舵位上，也不要和別的洞疊在一起（試很多次都找不到位置就不挑了）
      const clear = Math.hypot(lx - S.helmX, lz) > S.helmR + 0.5 && !this.damage.some((d) => Math.hypot(d.lx - lx, d.lz - lz) < 0.75);
      if (clear || n > 50) at = { lx, lz };
    }
    at ??= { lx: S.helmX + S.helmR + 0.6, lz: 0 };
    const g = new THREE.Group(), plank = lambert(0x6b4a2a);
    g.add(box(0.6, 0.012, 0.42, lambert(0x150d07), 0, 0.006, 0));          // 黑黑的破洞
    const a = box(0.5, 0.03, 0.09, plank, 0.06, 0.06, -0.13), b = box(0.42, 0.03, 0.09, plank, -0.1, 0.05, 0.11);
    a.rotation.set(0, 0.2, 0.35); b.rotation.set(0, -0.4, -0.3);           // 翹起來的斷木板
    g.add(a, b);
    g.position.set(at.lx, S.deck + 0.004, at.lz);
    g.rotation.y = Math.random() * Math.PI * 2;
    this.mesh.add(g);
    const c = { ...at, dmg: 0, mesh: g };
    this.damage.push(c);
    return c;
  }

  // 離船身座標 (lx, lz) 最近、伸手修得到的破洞
  nearDamage(lx, lz, r = 1.2) {
    let best = null, bd = r;
    for (const c of this.damage) {
      const d = Math.hypot(c.lx - lx, c.lz - lz);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // 修好一個破洞
  repair(c) {
    const i = this.damage.indexOf(c);
    if (i < 0) return;
    c.mesh.removeFromParent();
    this.damage.splice(i, 1);
  }

  // 船不行了，開始沉。side：往哪一側翻（+1 右、-1 左）
  founder(why, side = 1) {
    if (this.sinking) return;
    this.sinking = 1e-6;
    this.sunkBy = why;
    this._side = side;
    this._lean = Math.atan(Math.abs(this.roll));
    this.speed = 0; this.throttle = 0;
    this.waterMask.visible = false;   // 船進水了：艙裡的海面不再擋掉
    this.setManned(false);
  }

  // 沉沒的動畫：被打翻的整艘翻過去，破損沉沒的歪向一邊慢慢下去，被漩渦吞掉的一邊轉一邊被拉下去
  _sink(dt) {
    const t = (this.sinking += dt), cap = this.sunkBy === 'capsize' || this.sunkBy === 'spout' || this.sunkBy === 'curl';
    if (this.sunkBy === 'whirl') { this.heading += dt * 2.6; this.y -= dt * (0.5 + 0.6 * t); }
    const lean = Math.min(this._lean + t * (cap ? 1.0 : 0.16), cap ? 2.7 : 0.6);
    this.y -= dt * (cap ? Math.max(0, t - 1.2) * 0.9 : 0.25 + 0.3 * t);
    _q.setFromAxisAngle(Y_AXIS, -this.heading).multiply(_q2.setFromAxisAngle(X_AXIS, this._side * lean));
    this.mesh.quaternion.slerp(_q, 1 - Math.exp(-dt * 5));
    this.mesh.position.set(this.x, this.y, this.z);
  }

  // 裝上（或加大）魚箱：甲板上一個敞口木箱，魚放進去不會跳走、滑走
  setBox(level) {
    const S = this.spec, B = S.box;
    if (!this.boxLv && level) this.blocks.push([B.x - B.w / 2 - 0.05, B.x + B.w / 2 + 0.05, B.z - B.d / 2 - 0.05, B.z + B.d / 2 + 0.05]);
    this.boxLv = level;
    if (this.boxMesh) this.boxMesh.removeFromParent();
    const g = this.boxMesh = new THREE.Group(), h = B.h * (0.8 + 0.2 * level);
    const mat = lambert([0xa9824e, 0xa9824e, 0x8f6a3c, 0x6f4f2c][level]);
    g.add(box(B.w, 0.05, B.d, mat, 0, 0.025, 0),
      box(B.w, h, 0.05, mat, 0, h / 2, -B.d / 2), box(B.w, h, 0.05, mat, 0, h / 2, B.d / 2),
      box(0.05, h, B.d, mat, -B.w / 2, h / 2, 0), box(0.05, h, B.d, mat, B.w / 2, h / 2, 0));
    g.position.set(B.x, S.deck, B.z);
    this.mesh.add(g);
  }

  // 船燈的樣子。glow：天有多黑（0 白天、1 全黑）。開著的燈白天也看得出是亮的，天黑後亮到會暈開；關掉就是一顆暗的玻璃
  showLamp(glow) {
    const P = this.parts, m = P.lantern.material;
    m.color.copy(m.userData.base).multiplyScalar(this.lampOn ? 0.7 + 1.5 * Math.max(glow, 0.3) * m.userData.k : 0.3);
    if (P.lever) {
      P.lever.rotation.z = this.lampOn ? -0.55 : 0.55;   // 撥桿：往上是開
      P.pilot.material.color.setHex(this.lampOn ? 0x8dff7a : 0x3a2a1a);
    }
  }

  // 有人掌舵時才顯示舵手；fp = 第一人稱（隱藏頭和身體，只留手臂）
  setManned(on, fp = false) {
    this.manned = on;
    const h = this.parts.helmsman;
    h.visible = on;
    h.userData.fpHide.forEach((m) => { m.visible = !fp; });
    h.userData.torso.forEach((m) => { m.visible = !fp; });
    h.userData.legs.forEach((m) => { m.visible = !fp; });
    if (!on) for (const k in this.keys) this.keys[k] = false;
  }

  // env.ground(x,z)：地面或障礙物的高度（海床為負值）；env.wave(x,z)：該處浪高；env.limit：活動範圍
  update(dt, env) {
    if (this.sinking) return this._sink(dt);
    const S = this.spec, half = S.len / 2;
    const depth = -env.ground(this.x, this.z);
    const afloat = depth > S.draft * 0.9;
    this.aground = !afloat;
    const k = this.keys;

    const thrust = (k.w ? 1 : 0) - (k.s ? 0.45 : 0);
    this.throttle += (thrust - this.throttle) * (1 - Math.exp(-dt * 3));
    // 引擎吃油：油門開多大吃多少；沒油了只能慢慢漂
    if (this.fuel > 0) this.fuel = Math.max(0, this.fuel - S.burn * Math.abs(this.throttle) * dt);
    const target = afloat ? thrust * (this.fuel > 0 ? this.maxSpeed : DRIFT) : 0;
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * (afloat ? 0.5 * (1 + 0.2 * this.engineLv) : 3)));

    // 方向盤：按著就打過去，放開自動回正；船越短轉得越靈活
    const turn = (k.d ? 1 : 0) - (k.a ? 1 : 0);
    this.rudder += (turn - this.rudder) * (1 - Math.exp(-dt * (turn ? 2.2 : 1.6)));
    if (afloat) {
      const authority = clamp(Math.abs(this.speed) / 3, 0.12, 1) * (this.speed < -0.2 ? -1 : 1);
      this.heading += this.rudder * 0.55 * Math.sqrt(13 / S.len) * dt * authority;
    }

    // 漩渦或水龍捲在附近：船被往中心拉、帶著繞圈，船頭也跟著被扭
    const flow = afloat && env.flow ? env.flow(this.x, this.z) : null;
    if (flow && !this.moor) this.heading += flow.spin * dt;   // 綁著纜繩的船被繩子拉住，不會被水流帶著原地打轉
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    // 不會開上岸，也不會撞穿碼頭
    const nx = this.x + (fx * this.speed + (flow ? flow.x : 0)) * dt, nz = this.z + (fz * this.speed + (flow ? flow.z : 0)) * dt;
    const dir = Math.sign(this.speed || 1), rx = -fz, rz = fx;
    const blocked = [[half * 0.8, 0], [half * 0.65, S.beam * 0.35], [half * 0.65, -S.beam * 0.35]].some(([a, b]) =>
      env.ground(nx + (fx * a * dir) + rx * b, nz + (fz * a * dir) + rz * b) > -S.draft * 0.7);
    if (blocked) this.speed *= Math.exp(-dt * 6);
    else { this.x = clamp(nx, -env.limit, env.limit); this.z = clamp(nz, -env.limit, env.limit); }

    const fade = clamp((depth - 0.3) / 7.7, 0, 1);
    const surf = (dx, dz) => {
      const x = this.x + dx, z = this.z + dz, b = env.base ? env.base(x, z) : 0;   // 淺水裡變小的只有風浪，巨浪湧進來的水位不打折
      return Math.max((env.wave(x, z) - b) * fade + b, env.ground(x, z) + 0.15);
    };

    const pa = S.len * 0.38, ra = S.beam * 0.43;
    const s0 = surf(0, 0);
    const yT = Math.max(s0, env.ground(this.x, this.z) + S.draft);
    const pitch = S.tiltK * (surf(fx * pa, fz * pa) - surf(-fx * pa, -fz * pa)) / (2 * pa);
    let heel = -this.rudder * this.speed * 0.005; // 轉彎時向外側傾
    // 水龍捲的風吹在船身上：橫著受風整艘被壓歪（往下風處倒），船頭或船尾對著風就沒什麼事
    if (flow && (flow.wx || flow.wz)) heel -= SPOUT_HEEL * S.tiltK * (flow.wx * rx + flow.wz * rz);
    // 風暴、颱風的強風也一樣：橫著受風被壓歪，再加上浪就更容易翻；船頭頂著風最穩
    if (flow && flow.gx !== undefined) heel -= GALE_HEEL * S.tiltK * (flow.gx * rx + flow.gz * rz);
    const roll = S.tiltK * (surf(rx * ra, rz * ra) - surf(-rx * ra, -rz * ra)) / (2 * ra) + heel;
    // nT：只看長浪的姿態——船受不受得了（裂、翻）照這個算，跟以前一樣
    const nT = this._v.set(-(pitch * fx + roll * rx), 1, -(pitch * fz + roll * rz)).normalize();
    this._nS.lerp(nT, 1 - Math.exp(-dt * 3.5)).normalize();

    // 畫面上的姿態：船身貼著「看得到的那片水面」浮（長浪加中浪，浪頭的水平位移也算）。
    // 在船底取九個點，求最貼近它們的一個平面：平面的高度是船浮在哪裡，前後、左右的坡度就是縱搖、橫搖
    let hC = s0, pV = pitch, rV = roll;
    if (env.waveFine) {
      const fs = fade * fade * (3 - 2 * fade);
      let sh = 0, sxh = 0, szh = 0, sxx = 0, szz = 0;
      for (const [u, v] of HULL_PTS) {
        const lx = u * pa, lz = v * ra, x = this.x + fx * lx + rx * lz, z = this.z + fz * lx + rz * lz;
        const h = Math.max(env.waveFine(x, z, fs), env.ground(x, z) + 0.15);
        sh += h; sxh += lx * h; szh += lz * h; sxx += lx * lx; szz += lz * lz;
      }
      hC = sh / HULL_PTS.length; pV = sxh / sxx; rV = szh / szz + heel;
      pV += 0.035 * clamp(this.speed / S.speed, -0.4, 1.2);   // 開快了船頭會抬起來一點
    }
    // 船有慣性：被浪抬起一邊之後會晃過頭再回來（彈簧加阻尼），不是死死黏著水面
    const W = afloat ? 5.5 : 9, Z = afloat ? 0.45 : 1;
    this._wp += ((pV - this._vp) * W * W - 2 * Z * W * this._wp) * dt; this._vp = clamp(this._vp + this._wp * dt, -1.2, 1.2);
    this._wr += ((rV - this._vr) * W * W - 2 * Z * W * this._wr) * dt; this._vr = clamp(this._vr + this._wr * dt, -1.2, 1.2);

    // 巨浪那種又長又高的浪，船是整艘被托上去的：先跟著它升降，剩下的小浪才慢慢跟上（不然船會被「淹」在水牆裡）
    const lift = (env.base ? env.base(this.x, this.z) : 0) + (env.bank ? env.bank(this.x, this.z) : 0);   // 大漩渦的漏斗也是整艘船跟著下去
    this.y += lift - (this._lift ?? lift);
    this._lift = lift;
    this.y += (Math.max(hC, yT - s0 > 0 ? yT : hC) - this.y) * (1 - Math.exp(-dt * 6));   // 擱淺時（yT 比水面高）照船底碰到的地面算
    this.normal.set(-(this._vp * fx + this._vr * rx), 1, -(this._vp * fz + this._vr * rz)).normalize();
    // 船身猛地一晃的程度：撞上浪、被浪頭砸到時跳高，之後一秒內退掉（甲板上的魚看這個數字決定會不會被拋起來）
    this.jolt = Math.max((this.jolt || 0) * Math.exp(-dt * 3), (Math.abs(this._wp) + Math.abs(this._wr)) / JOLT_K);

    // ---- 浪對船的傷害（只算在深水裡）----
    // 搖得超過船受得了的角度、或浪直接蓋過船舷，船板就會裂；橫著被大浪打到會整艘翻掉
    this.roll = -(this._nS.x * rx + this._nS.z * rz) / this._nS.y;
    this.pitch = -(this._nS.x * fx + this._nS.z * fz) / this._nS.y;
    if (depth > 3) {
      // 大漩渦的漏斗壁是斜的，但那裡的水是繞著圈轉的（離心力把水面壓成斜的）：船跟著水轉，等於是「貼著」斜面坐，
      // 不算被浪搖歪。所以傾斜的程度要先扣掉漏斗本身的坡度
      const tilt = (ax, az, d) => (env.bank ? S.tiltK * (env.bank(this.x + ax * d, this.z + az * d) - env.bank(this.x - ax * d, this.z - az * d)) / (2 * d) : 0);
      const follow = 1 - Math.exp(-dt * 3.5);
      this._bankR = (this._bankR || 0) + (tilt(rx, rz, ra) - (this._bankR || 0)) * follow;
      this._bankP = (this._bankP || 0) + (tilt(fx, fz, pa) - (this._bankP || 0)) * follow;
      const ar = Math.abs(this.roll - this._bankR), ap = Math.abs(this.pitch - this._bankP);
      const swamp = clamp(s0 - (this.y + S.deck + S.bul), 0, 1.5);
      // 船頭對著巨浪爬上去不傷船（那是一道長坡，不是拍在船上的浪）；橫著、斜著就照樣會被扭裂、翻掉
      const ride = env.base ? S.tiltK * (env.base(this.x + fx * pa, this.z + fz * pa) - env.base(this.x - fx * pa, this.z - fz * pa)) / (2 * pa) : 0;
      this._ride = (this._ride || 0) + (ride - (this._ride || 0)) * (1 - Math.exp(-dt * 3.5));   // 跟船身的姿態用同樣的速度跟上
      // 橫著受浪最傷船（船板是被扭裂的），船頭頂浪好得多
      // 歪得超過「會翻」的角度不會馬上翻掉，而是船板裂得很快（浪打進來）；耐久歸零才沉。只有水龍捲的風會直接把船掀翻
      const over = Math.max(0, ar - CAPSIZE_ROLL) + Math.max(0, ap - CAPSIZE_PITCH);
      const stress = 2.5 * Math.max(0, ar - SAFE_ROLL) + Math.max(0, Math.abs(this.pitch - this._ride - this._bankP) - SAFE_PITCH) + 0.3 * Math.max(0, swamp - 0.3) + 6 * over;   // 浪花潑進來一點不算，水真的高過船舷三十公分以上才傷船
      if (stress > 0) this.hurt(stress * HURT_K * dt);
      // 往低的那一側翻：roll > 0 是右舷被抬高
      const blown = flow && Math.hypot(flow.wx, flow.wz) > 0.3;   // 是被水龍捲的風吹翻的，不是浪
      if (blown && (ar > CAPSIZE_ROLL || ap > CAPSIZE_PITCH)) this.founder('spout', this.roll > 0 ? -1 : 1);
      else if (this.hp <= 0) this.founder(over > 0 ? 'capsize' : 'flood', this.roll > 0 ? -1 : 1);
      if (this.sinking) return;
    }

    // 由船首方向與水面法線組出姿態
    const n = this.normal;
    const f = new THREE.Vector3(fx, 0, fz);
    f.addScaledVector(n, -f.dot(n)).normalize();
    const r = new THREE.Vector3().crossVectors(f, n);
    this._m.makeBasis(f, n, r);
    this.mesh.quaternion.setFromRotationMatrix(this._m);
    this.mesh.position.set(this.x, this.y, this.z);

    // ---- 船上會動的東西 ----
    const P = this.parts;
    if (P.tiller) P.tiller.rotation.y = this.rudder * 0.6;
    if (P.wheel) {
      P.wheel.rotation.x = this.rudder * 2.6;
      P.throttle.rotation.z = -this.throttle * 0.7;
    }
    if (this.manned) {
      const arms = P.helmsman.userData.arms;
      if (P.wheel) {
        // 舵手雙手握在方向盤兩側，跟著轉一小段
        const turnA = clamp(this.rudder * 2.6, -0.8, 0.8);
        for (const arm of arms) {
          const ang = arm.userData.side * 1.05 + turnA;
          this._d.set(P.wheelPos.x - S.helmX - 0.03, P.wheelPos.y - S.deck + Math.cos(ang) * WHEEL_R, Math.sin(ang) * WHEEL_R).sub(arm.position);
          const len = this._d.length();
          arm.quaternion.setFromUnitVectors(DOWN, this._d.divideScalar(len));
          arm.scale.set(1, len / ARM_LEN, 1);
        }
      } else {
        // 小舢舨：右手往後握著舵柄
        arms[0].rotation.set(0, 0, 0.15);
        arms[1].rotation.set(0, 0, -0.75 + this.rudder * 0.25);
      }
    }
  }

  // ---- 給在甲板上走動的人用 ----
  // 世界座標 → 船身座標（只看航向，不管搖晃）
  toLocal(x, z) {
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    const dx = x - this.x, dz = z - this.z;
    return { x: dx * fx + dz * fz, z: -dx * fz + dz * fx };
  }

  toWorld(lx, lz) {
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    return { x: this.x + fx * lx - fz * lz, z: this.z + fz * lx + fx * lz };
  }

  // 船身座標 (lx, lz) 是否在甲板範圍內（船舷內側）
  deckContains(lx, lz) {
    const S = this.spec;
    if (lx < -S.len / 2 + 0.4 || lx > S.len / 2 - 0.9) return false;
    return Math.abs(lz) < halfBeam(S, (lx + S.len / 2) / S.len) * 0.97 - 0.15;
  }

  blockedLocal(lx, lz) {
    return this.blocks.some((r) => lx > r[0] && lx < r[1] && lz > r[2] && lz < r[3]);
  }

  // 世界座標 (x, z) 處的甲板高度：甲板是跟著船一起傾斜的平面
  deckY(x, z) {
    const n = this.normal, D = this.spec.deck;
    const px = this.x + n.x * D, py = this.y + n.y * D, pz = this.z + n.z * D;
    return py - (n.x * (x - px) + n.z * (z - pz)) / n.y;
  }
}
