// 人物：低多邊形的 Q 版水手服少女（早期 3D 主機的味道），照角色設定的四視圖做。
// 座標：+X 前方、+Y 向上、+Z 右側；原點在兩腳中間的地面。全身高約 1.62 公尺，頭（連頭髮）約佔三分之一多一點。
// 每一塊都是稜角分明的凸多面體，一個面一個顏色；表面再疊一層一格一格的明暗雜點（像素貼圖的感覺），
// 眼睛、眉毛、腮紅、嘴畫在臉前面的一張小圖上。
// 四肢各自掛在關節上（肩膀、髖部、脖子），走路、坐下、握舵時轉動關節即可。
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const ARM_LEN = 0.275;   // 肩膀到握東西的位置（整條手臂再長 0.03）；握舵時用它算手臂要拉長多少
const SHOULDER_Y = 0.85, SHOULDER_Z = 0.165, HIP_Y = 0.44, HIP_Z = 0.105, NECK_Y = 1.0;
const WAIST_Y = 0.7;   // 腰的關節：上半身（衣服、手臂、頭）掛在這裡，鞠躬、伸懶腰、躺下時彎這裡

// ---- 像素雜點：每個面依它最朝向的軸，把物件自己的座標切成邊長 TEXEL 的方格，每格隨機亮一點或暗一點 ----
const TEXEL = 0.035;   // 方格大一點、明暗差多一點，才看得出一格一格的色塊
function pixelMat(color, { amp = 0.09, ...extra } = {}) {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vPix;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvPix = position;');
    sh.fragmentShader = 'varying vec3 vPix;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
	{
		vec3 fa = abs( cross( dFdx( vPix ), dFdy( vPix ) ) );
		vec3 c = floor( vPix / ${TEXEL.toFixed(4)} );
		vec2 g = fa.x > fa.y && fa.x > fa.z ? c.yz + 17.0 : ( fa.y > fa.z ? c.xz + 41.0 : c.xy + 83.0 );
		float h = fract( sin( dot( g, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
		diffuseColor.rgb *= 1.0 + ( h - 0.5 ) * ${amp.toFixed(3)};
	}`);
  };
  m.customProgramCacheKey = () => 'pix' + amp;
  return m;
}

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
// 一圈橢圓形排列的點：高度 y、中心的前後位置 cx、前後半徑 rx、左右半徑 rz
const oval = (y, cx, rx, rz, n = 10) => Array.from({ length: n }, (_, i) => { const a = (i + 0.5) / n * Math.PI * 2; return [cx + rx * Math.cos(a), y, rz * Math.sin(a)]; });
// 八角柱（切了角的方柱）：上端在 y0、下端在 y1，半寬 r0 → r1，前後中心 cx、左右中心 cz
const oct = (y0, y1, r0, r1, cx = 0, cz = 0) => [...ring(y0, cx - r0, cx + r0, r0, r0 * 0.42), ...ring(y1, cx - r1, cx + r1, r1, r1 * 0.42)].map(([x, y, z]) => [x, y, z + cz]);
// 一撮尖尖的頭髮：根部是一塊四邊形，尾端收成一個尖（前後兩點，back 是尖端的前後厚度）
const tuft = (root, tip, back = 0.03) => [...root, tip, [tip[0] - back, tip[1], tip[2]]];
// 一撮會彎的頭髮：根部 → 中段（縮成 k 倍寬，移到 mid）→ 尖端，拆成兩個凸塊接起來，中段那裡就有一個彎
function strand(root, mid, tip, k = 0.6, back = 0.03) {
  const c = [0, 1, 2].map((i) => root.reduce((t, p) => t + p[i], 0) / root.length);
  const m = root.map((p) => p.map((v, i) => mid[i] + (v - c[i]) * k));
  return [[...root, ...m], tuft(m, tip, back)];
}
const mz = (pts) => pts.map(([x, y, z]) => [x, y, -z]);              // 左右翻過來
const shift = (pts, dx, dz) => pts.map(([x, y, z]) => [x + dx, y, z + dz]);

// ---- 臉：一張 110×110 的小圖（一格 4 公釐），貼在臉的正前方，放大時不做平滑 ----
// 圖的範圍：左右 ±0.22、上下 1.42 → 0.98；圖的左邊是人物的右手邊（+Z）。
// 八種表情各一張（角色設定圖上那組）：普通、開心、驚訝、思考、閉眼、微笑、哭泣、眨眼
export const FACES = ['normal', 'happy', 'surprised', 'thinking', 'closed', 'smile', 'cry', 'wink'];
const faceTex = {};
function faceTexture(id = 'normal') {
  if (faceTex[id]) return faceTex[id];
  const cv = document.createElement('canvas');
  cv.width = 110; cv.height = 110;
  const g = cv.getContext('2d');
  const px = (c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const EYE = '#362824', LINE = '#3a2622', BROW = '#5a3a2c', LIP = '#9c4a3a', MOUTH = '#c4524a';
  // 腮紅：眼睛外下方一小塊，邊緣淡一點（跟膚色混過，不用半透明）
  for (const x0 of [13, 84]) {
    px('#f6ae8e', x0, 84, 13, 11);
    px('#f6a085', x0 + 1, 85, 11, 9);
    px('#f59a80', x0 + 2, 86, 9, 7);
  }
  // 眼睛（x0 是左緣，寬 14、高 56–84）
  const eyeOpen = (x0, top = 56) => { px(EYE, x0 + 1, top, 12, 85 - top); px(EYE, x0, top + 1, 14, 83 - top); px('#3d2b26', x0 + 2, 79, 10, 4); };
  const arc = (x0, f, w = 3) => { for (let i = 0; i < 14; i++) px(LINE, x0 + i, f(Math.abs(i - 6.5)), 1, w); };
  const happyEye = (x0) => arc(x0, (d) => 64 + Math.round(d * 0.9));            // ^
  const closedEye = (x0) => arc(x0, (d) => 77 - Math.round(d * 0.55), 2);       // ‿（往下彎的一條）
  const squeeze = (x0, dir) => {                                                 // > 或 <（用力閉著）
    for (let i = 0; i < 9; i++) { const x = dir > 0 ? x0 + 2 + i : x0 + 11 - i; px(LINE, x, 62 + i, 2, 2); px(LINE, x, 78 - i, 2, 2); }
  };
  // 眉毛（左眼的從外到內、右眼的從內到外）；lift：整條往上幾格；tilt：內側往上幾格
  const brows = (lift = 0, tilt = 0, only = 0) => {
    if (only >= 0) for (let i = 0; i < 18; i++) px(BROW, 13 + i, 41 - lift - (i < 4 ? -1 : 0) - Math.round(tilt * i / 17), 1, 2);
    if (only <= 0) for (let i = 0; i < 18; i++) px(BROW, 79 + i, 41 - lift - (i > 13 ? -1 : 0) - Math.round(tilt * (17 - i) / 17), 1, 2);
  };
  const smallO = () => { px(LIP, 54, 96, 3, 1); px(LIP, 53, 97, 1, 2); px(LIP, 57, 97, 1, 2); px(LIP, 54, 99, 3, 1); px('#c46e56', 54, 97, 3, 2); };
  const smileMouth = () => { px(LIP, 51, 95, 1, 1); px(LIP, 52, 96, 1, 1); px(LIP, 53, 97, 5, 1); px(LIP, 58, 96, 1, 1); px(LIP, 59, 95, 1, 1); };
  const openSmile = () => { px(LIP, 51, 95, 9, 1); px(MOUTH, 52, 96, 7, 3); px(LIP, 51, 96, 1, 2); px(LIP, 59, 96, 1, 2); px(LIP, 52, 98, 1, 1); px(LIP, 58, 98, 1, 1); px(LIP, 53, 99, 5, 1); px('#e07a6a', 54, 97, 3, 1); };
  switch (id) {
    case 'happy':     happyEye(20); happyEye(76); brows(2); openSmile(); break;
    case 'surprised': eyeOpen(20, 54); eyeOpen(76, 54); brows(5);
      px(LIP, 54, 95, 3, 1); px(LIP, 53, 96, 1, 4); px(LIP, 57, 96, 1, 4); px(LIP, 54, 100, 3, 1); px(MOUTH, 54, 96, 3, 4); break;
    case 'thinking':  eyeOpen(22, 60); eyeOpen(78, 60); brows(0, 0, 1); brows(4, -2, -1); px(LIP, 55, 98, 5, 1); break;
    case 'closed':    closedEye(20); closedEye(76); brows(); smileMouth(); break;
    case 'smile':     eyeOpen(20); eyeOpen(76); brows(1); smileMouth(); break;
    case 'cry':
      squeeze(20, 1); squeeze(76, -1); brows(0, 4);
      for (const x of [24, 82]) { px('#8fd0f5', x, 80, 4, 26); px('#c8ecff', x + 1, 82, 1, 20); }   // 兩道淚
      px(LIP, 52, 97, 7, 1); px(MOUTH, 52, 98, 7, 2); px(LIP, 51, 98, 1, 2); px(LIP, 59, 98, 1, 2); px(LIP, 52, 100, 7, 1); break;
    case 'wink':      eyeOpen(20); squeeze(76, -1); brows(1); openSmile(); break;
    default:          eyeOpen(20); eyeOpen(76); brows(); smallO();
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return (faceTex[id] = t);
}

export function buildFigure() {
  const g = new THREE.Group();
  const skin = pixelMat(0xf6bd92, { amp: 0.12 }), hair = pixelMat(0x794732, { amp: 0.21 }), shirt = pixelMat(0xf2e0da, { amp: 0.15 });
  const skirt = pixelMat(0x39395f, { amp: 0.16, side: THREE.DoubleSide }), navy = pixelMat(0x3d3660, { amp: 0.1 });
  const red = pixelMat(0xc8322d, { amp: 0.18 }), boot = pixelMat(0x67392a, { amp: 0.14 }), sole = pixelMat(0x4a2b21, { amp: 0.1 });
  const trim = pixelMat(0xeee6ee, { amp: 0.04 });
  // 臉的小圖：只有五官的地方不透明。標成透明的，才不會被描邊、也不投影
  const face = new THREE.MeshLambertMaterial({ map: faceTexture(), alphaTest: 0.5, transparent: true });

  let parent = g, oy = 0;   // 現在往哪個關節上加東西、那個關節的高度（下面的座標都是整個人的座標，加上去時換算）
  const list = [];
  const put = (m) => { m.position.y -= oy; parent.add(m); list.push(m); return m; };
  const add = (pts, mat) => put(solid(pts, mat));

  // ---- 腿：膚色的八角柱（上端藏在裙子裡）＋ 粗粗的咖啡色短靴（靴筒、往前凸的鞋頭、深色鞋底） ----
  const legs = [-1, 1].map((s) => {
    const joint = new THREE.Group();
    joint.position.set(0, HIP_Y, s * HIP_Z);
    g.add(joint);
    // 靴子比腿往外一點、本身窄一點（左右縮成 0.9）：兩隻靴子中間要看得到縫；腿往下微微往外張
    const bz = s * 0.025, nz = (pts) => shift(pts.map(([x, y, z]) => [x, y, z * 0.9]), 0, bz);
    const splay = (pts) => pts.map(([x, y, z]) => [x, y, z + s * 0.02 * Math.min(1, Math.max(0, (0.5 - y) / 0.3))]);
    const parts = [
      solid(splay(oct(0.5, 0.2, 0.072, 0.066)), skin),   // 腿的上端只比髖關節高一點點：坐下時腿往前抬，上端才不會從裙子後面戳出來
      solid(nz(shift(oct(0.25, 0.07, 0.094, 0.1), -0.018, 0)), boot),
      solid(nz([[-0.125, 0.02, 0.108], [-0.125, 0.02, -0.108], [-0.125, 0.13, 0.1], [-0.125, 0.13, -0.1], [0.03, 0.14, 0.1], [0.03, 0.14, -0.1],
        [0.12, 0.12, 0.09], [0.12, 0.12, -0.09], [0.165, 0.08, 0.08], [0.165, 0.08, -0.08], [0.17, 0.02, 0.085], [0.17, 0.02, -0.085],
        [0.1, 0.02, 0.115], [0.1, 0.02, -0.115]]), boot),
      solid(nz([[-0.13, 0, 0.11], [-0.13, 0, -0.11], [0.1, 0, 0.118], [0.1, 0, -0.118], [0.175, 0, 0.085], [0.175, 0, -0.085],
        [-0.13, 0.026, 0.112], [-0.13, 0.026, -0.112], [0.1, 0.026, 0.12], [0.1, 0.026, -0.12], [0.178, 0.026, 0.087], [0.178, 0.026, -0.087]]), sole),
    ];
    for (const m of parts) { m.position.y -= HIP_Y; joint.add(m); }
    return joint;
  });

  // ---- 上半身：掛在腰的關節上 ----
  const upper = new THREE.Group();
  upper.position.y = WAIST_Y;
  g.add(upper);

  // ---- 手臂：白色短袖（下緣張開）＋ 膚色手臂 ＋ 末端粗一點的方塊手 ----
  const arms = [-1, 1].map((s) => {
    const joint = new THREE.Group();
    joint.position.set(-0.015, SHOULDER_Y - WAIST_Y, s * SHOULDER_Z);
    joint.userData.base = new THREE.Vector3(-0.015, SHOULDER_Y, s * SHOULDER_Z);   // 肩膀在整個人座標裡的位置（握舵時算手要伸多長）
    upper.add(joint);
    const at = (pts) => pts.map(([x, y, z]) => [x, y - SHOULDER_Y, z]);
    const sleeve = solid(at(oct(0.915, 0.755, 0.064, 0.086)), shirt);                       // 袖子（袖根高一點，肩線才不會垮）
    const hand = new THREE.Group();                                                          // 手（掛在手腕上）
    hand.position.y = 0.615 - SHOULDER_Y;
    hand.add(solid([...oct(0, -0.06, 0.066, 0.07), ...oct(-0.075, -0.082, 0.055, 0.055)], skin));
    joint.add(sleeve, solid(at(oct(0.8, 0.6, 0.055, 0.058)), skin), hand);                  // 中間是手臂
    const grip = new THREE.Object3D();                                                       // 手心：拿東西（釣竿）的位置
    grip.position.y = -0.04;
    hand.add(grip);
    joint.userData.side = s;
    joint.userData.grip = grip;
    // 握舵時手臂要伸長才搆得到：只拉長手臂那一段，袖子和手維持原來的樣子
    joint.userData.stretch = (k) => { joint.scale.y = k; sleeve.scale.y = hand.scale.y = 1 / k; };
    return joint;
  });

  // ---- 身體：短短的白色水手服（上半身）、深藍百褶裙（跟著腿那半邊）、藍色水手領、紅領巾 ----
  put(new THREE.Mesh(skirtGeometry(), skirt));
  parent = upper; oy = WAIST_Y;
  // 上衣短短的，下襬（y 0.72）剛好蓋住裙腰
  add([...ring(0.72, -0.105, 0.12, 0.16, 0.045), ...ring(0.78, -0.1, 0.115, 0.155, 0.045), ...ring(0.87, -0.095, 0.11, 0.155, 0.045),
    ...ring(0.93, -0.085, 0.1, 0.13, 0.04), ...ring(0.975, -0.06, 0.07, 0.072, 0.03)], shirt);
  // 水手領：背後垂一片方領（上緣在脖子後面），從肩膀繞到胸前收成寬寬的 V 字（要浮在衣服前面才看得到）；邊上一條白線
  add([[-0.06, 1.0, 0.07], [-0.06, 1.0, -0.07], [-0.088, 0.975, 0.12], [-0.088, 0.975, -0.12], [-0.12, 0.845, 0.135], [-0.12, 0.845, -0.135],
    [-0.045, 1.0, 0.07], [-0.045, 1.0, -0.07], [-0.07, 0.97, 0.115], [-0.07, 0.97, -0.115], [-0.1, 0.845, 0.13], [-0.1, 0.845, -0.13]], navy);
  for (const s of [-1, 1]) {
    const S = (pts) => (s > 0 ? pts : mz(pts));
    add(S([[-0.06, 1.0, 0.07], [-0.088, 0.975, 0.125], [0.09, 0.968, 0.075], [0.105, 0.935, 0.14],
      [-0.05, 0.985, 0.065], [-0.075, 0.96, 0.115], [0.082, 0.96, 0.07], [0.097, 0.93, 0.13]]), navy);             // 肩上那一段
    const front = [[0.09, 0.968, 0.075], [0.105, 0.935, 0.14], [0.125, 0.895, 0.035], [0.12, 0.925, 0]];
    add(S([...front, ...front.map(([x, y, z]) => [x - 0.008, y, z])]), navy);                                         // 胸前那一段
    const a = [0.109, 0.935, 0.14], b = [0.129, 0.895, 0.035];                                                        // 胸前的白線：沿著 V 字外側斜邊
    add(S([a, b, [a[0], a[1] + 0.009, a[2] - 0.003], [b[0], b[1] + 0.009, b[2] - 0.003],
      [a[0] - 0.006, a[1], a[2]], [b[0] - 0.006, b[1], b[2]]]), trim);
    add(S([[-0.123, 0.86, 0.118], [-0.123, 0.86, 0.108], [-0.093, 0.965, 0.108], [-0.093, 0.965, 0.098],
      [-0.113, 0.86, 0.118], [-0.083, 0.965, 0.106]]), trim);                                                         // 背後方領兩側的白線
  }
  add([[-0.124, 0.859, 0.118], [-0.124, 0.859, -0.118], [-0.121, 0.869, 0.108], [-0.121, 0.869, -0.108],
    [-0.112, 0.859, 0.118], [-0.112, 0.859, -0.118], [-0.11, 0.869, 0.108], [-0.11, 0.869, -0.108]], trim);              // 背後方領下緣的白線
  add([...ring(0.93, 0.105, 0.147, 0.034, 0.012), ...ring(0.885, 0.11, 0.152, 0.03, 0.012)], red);                    // 領巾的結
  // 垂下來的領巾：胸前正中央一片短短的菱形，中間一條折脊（兩半邊亮暗不同）
  const tie = [[0.145, 0.885, 0.028], [0.145, 0.885, -0.028], [0.165, 0.795, -0.062], [0.17, 0.735, 0], [0.165, 0.795, 0.062], [0.172, 0.82, 0]];
  add([...tie, ...tie.map(([x, y, z]) => [x - 0.012, y, z])], red);
  const torso = list.splice(0);   // 到這裡為止是軀幹：第一人稱走路時留著，掌舵時才藏

  // ---- 頭：掛在脖子的關節上，可以轉頭、抬頭、低頭 ----
  const neck = solid(oct(1.05, 0.95, 0.045, 0.048), skin);
  neck.position.y = -WAIST_Y;
  upper.add(neck);
  const head = new THREE.Group();
  head.position.y = NECK_Y - WAIST_Y;
  upper.add(head);
  parent = head; oy = NECK_Y;
  // 頭殼：臉不是一整片平板——正面往兩旁彎（faceX：越往兩邊越往後），臉頰下半鼓一點，下巴圓圓的收進去。
  // 比例照第 6 張四視圖：額頭 y 1.43、下巴 y 1.02，臉寬 ±0.19
  const faceX = (z) => 0.207 - z * z;
  const front = [];
  for (const [y, zs, dx] of [[1.43, [0, 0.1, 0.19], 0], [1.3, [0, 0.1, 0.19], 0], [1.17, [0, 0.1, 0.19], 0.002],
    [1.09, [0, 0.08, 0.14, 0.19], 0.004], [1.045, [0, 0.08, 0.16], -0.002], [1.022, [0, 0.07, 0.12], -0.014]]) {
    for (const z of zs) for (const s of z ? [-1, 1] : [1]) front.push([faceX(z) + (z > 0.05 && z < 0.17 ? dx : Math.min(0, dx)), y, s * z]);
  }
  add([...front, ...[[0.15, 0.975, 0.12], [0.07, 0.99, 0.17],
    [0.15, 1.03, 0.235], [0.12, 1.3, 0.25], [-0.06, 1.08, 0.235], [-0.08, 1.35, 0.25], [-0.22, 1.25, 0.2], [-0.2, 1.08, 0.15], [0.0, 1.55, 0.15],
  ].flatMap(([x, y, z]) => [[x, y, z], [x, y, -z]]).map(([x, y, z]) => [x, 1.43 + (y - 1.43) * 0.9, z * 0.95])], skin);
  // 小小的鼻尖（側面看得到一個小凸起，正面只有一點點明暗）
  add([[faceX(0) - 0.01, 1.112, 0.014], [faceX(0) - 0.01, 1.112, -0.014], [faceX(0) - 0.01, 1.078, 0.016], [faceX(0) - 0.01, 1.078, -0.016],
    [faceX(0) + 0.016, 1.085, 0], [faceX(0) + 0.006, 1.108, 0]].map(([x, y, z]) => [x, y, z]), skin);
  // 五官那張圖也跟著臉彎：切成很多直條，每條往後退到臉的弧面前面一點點
  const faceGeo = new THREE.PlaneGeometry(0.44, 0.44, 44, 1), fp = faceGeo.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setZ(i, faceX(fp.getX(i)) + 0.006);
  const faceMesh = new THREE.Mesh(faceGeo, face);
  faceMesh.rotation.y = Math.PI / 2;
  faceMesh.position.set(0, 1.228, 0);
  put(faceMesh);
  for (const s of [-1, 1]) add(oct(1.2, 1.13, 0.03, 0.028, -0.05, s * 0.235), skin);   // 耳朵（從側髮和後面那束頭髮之間露出來）

  // ---- 頭髮 ----
  // 頭頂：屋脊一樣尖起來的一大塊，從正面看像個五角形；前緣是額頭上的瀏海根部，後面蓋到後頸（正中間露出水手領的上緣）
  add([[-0.02, 1.625, 0.03], ...oval(1.6, -0.01, 0.06, 0.08, 8), ...oval(1.56, -0.02, 0.14, 0.17, 10), ...oval(1.52, -0.025, 0.205, 0.24, 10),
    ...oval(1.48, -0.025, 0.235, 0.275, 12), ...oval(1.44, -0.01, 0.26, 0.3, 12), ...oval(1.4, 0, 0.28, 0.325, 12),
    [0.285, 1.42, 0.12], [0.285, 1.42, -0.12], [0.06, 1.34, 0.33], [0.06, 1.34, -0.33], [-0.12, 1.34, 0.335], [-0.12, 1.34, -0.335],
    [-0.27, 1.34, 0.2], [-0.27, 1.34, -0.2], [-0.29, 1.34, 0.05], [-0.29, 1.34, -0.05],
    [-0.02, 1.22, 0.32], [-0.02, 1.22, -0.32], [-0.2, 1.2, 0.3], [-0.2, 1.2, -0.3], [-0.285, 1.2, 0.18], [-0.285, 1.2, -0.18], [-0.3, 1.2, 0],
    [-0.08, 1.08, 0.27], [-0.08, 1.08, -0.27], [-0.22, 1.08, 0.22], [-0.22, 1.08, -0.22], [-0.27, 1.08, 0.1], [-0.27, 1.08, -0.1],
    [-0.16, 1.02, 0.12], [-0.16, 1.02, -0.12], [-0.215, 1.02, 0]].map(([x, y, z]) => [Math.min(x, y <= 1.42 ? 0.18 : x), y, z]), hair);
  // （上面：頭頂那塊在額頭以下往前的點收進去，不然會壓住額頭；額頭以上的前緣和瀏海根部接成一片）
  // 瀏海：頭頂那整頂頭髮的前緣往下延伸、剪成一撮一撮尖尖的——不是貼在額頭上的薄片。
  // 每撮都有厚度：根部厚、沿著頭頂的圓弧往前鼓出去，再往下往臉收成尖；相鄰幾撮的根部互相疊著（上面不留縫），
  // 只有尖端之間是三角形的缺口、露出額頭。最長的兩撮垂到眼睛上緣，兩邊的短、往外斜
  // [根部右手邊 z、左手邊 z]、[尖端 z、尖端高度]
  const bangX = (z) => 0.252 - 1.15 * z * z;   // 瀏海根部（y 1.44）前緣的弧度：比臉往前凸 4–5 公分，越往兩旁越往後
  for (const [za, zb, zt, yt] of [
    [0.3, 0.13, 0.25, 1.3], [0.21, 0.0, 0.11, 1.19], [0.075, -0.085, 0.035, 1.275],
    [-0.01, -0.21, -0.08, 1.17], [-0.15, -0.3, -0.245, 1.285],
  ]) {
    const root = [];
    for (const z of [za, zb]) {
      const x = bangX(z);
      // 根部：前緣、後緣，上端埋進頭頂那塊裡面（y 1.48 那圈橢圓再往內 1.5 公分）——頂上凸出來的話，描邊會畫出一道橫的屋簷
      const zc = Math.max(-0.25, Math.min(0.25, z)), top = -0.025 + 0.235 * Math.sqrt(1 - (zc / 0.275) ** 2) - 0.015;
      root.push([x, 1.44, z], [x - 0.055, 1.44, z], [Math.min(x - 0.03, top), 1.48, zc], [Math.min(x - 0.07, top - 0.04), 1.48, zc]);
    }
    const zm = (za + zb) / 2 * 0.45 + zt * 0.55, ym = 1.44 - (1.44 - yt) * 0.42;
    const xt = faceX(Math.min(Math.abs(zt), 0.19)) + 0.012 - Math.max(0, Math.abs(zt) - 0.19) * 0.8;   // 尖端貼著臉
    const xm = bangX((za + zb) / 2) * 0.58 + xt * 0.42 + 0.01;   // 中段比根部到尖端的直線再往前鼓一點：整撮是彎的
    // 根部 → 中段（縮成 0.6 寬、還有 3.5 公分厚）→ 尖端（收成一點，前後留一點厚度）
    const m = [za, zb].flatMap((z) => { const zz = zm + (z - (za + zb) / 2) * 0.6; return [[xm, ym, zz], [xm - 0.035, ym, zz]]; });
    add([...root, ...m], hair);
    add([...m, [xt, yt, zt], [xt - 0.02, yt + 0.01, zt]], hair);
  }
  // 兩側：臉頰旁一片長長的側髮（貼著臉、在耳朵前面），下緣兩個尖；耳朵後面一大束往下垂到肩膀，下緣兩個尖。
  // 側髮和耳後那束中間露出耳朵。每一撮都是中段彎一下的兩節
  for (const s of [-1, 1]) {
    const S = (pts) => (s > 0 ? pts : mz(pts));
    const side = (root, mid, tip, k = 0.6, back = 0.04) => { for (const pts of strand(root, mid, tip, k, back)) add(S(pts), hair); };
    // 臉旁那片：上端接在頭頂那塊底下；前緣在臉頰的側面（x 0.12，正面看在臉兩旁，側面看還露得出臉的輪廓）
    add(S([[0.1, 1.42, 0.215], [0.1, 1.42, 0.3], [-0.02, 1.42, 0.31], [-0.02, 1.42, 0.22],
      [0.125, 1.2, 0.228], [0.125, 1.2, 0.3], [0.0, 1.2, 0.31], [0.0, 1.2, 0.235]]), hair);
    side([[0.125, 1.2, 0.228], [0.125, 1.2, 0.29], [0.055, 1.2, 0.3], [0.055, 1.2, 0.235]], [0.115, 1.08, 0.268], [0.095, 0.955, 0.24], 0.6, 0.04);
    side([[0.055, 1.2, 0.24], [0.055, 1.2, 0.31], [0.0, 1.2, 0.31], [0.0, 1.2, 0.24]], [0.03, 1.1, 0.305], [0.0, 0.99, 0.3], 0.6, 0.04);
    add(S([[-0.04, 1.32, 0.27], [-0.04, 1.32, 0.34], [-0.26, 1.3, 0.3], [-0.26, 1.3, 0.21], [-0.12, 1.17, 0.38],
      [-0.04, 1.04, 0.33], [-0.1, 1.04, 0.37], [-0.24, 1.04, 0.34], [-0.29, 1.04, 0.22], [-0.2, 1.04, 0.2]]), hair);   // 耳後那束
    side([[-0.05, 1.08, 0.3], [-0.05, 1.08, 0.37], [-0.2, 1.08, 0.36], [-0.2, 1.08, 0.29]], [-0.1, 0.97, 0.375], [-0.14, 0.87, 0.32]);
    side([[-0.15, 1.08, 0.25], [-0.15, 1.08, 0.35], [-0.28, 1.08, 0.3], [-0.28, 1.08, 0.2]], [-0.21, 0.96, 0.32], [-0.23, 0.85, 0.28]);
  }

  // ---- 紅色大蝴蝶結：綁在後腦勺左上方，一片往上往外翹，一片往下往外垂 ----
  // 每一片沿中間的折線拆成兩塊（凸包包不出凹進去的折痕）：從結往外先鼓出去、到外緣再往頭收回來，看起來是布折起來的
  add([[-0.265, 1.51, -0.055], [-0.265, 1.51, -0.125], [-0.265, 1.44, -0.055], [-0.265, 1.44, -0.125],
    [-0.335, 1.505, -0.06], [-0.335, 1.505, -0.12], [-0.335, 1.445, -0.06], [-0.335, 1.445, -0.12]], red);   // 結
  const knotUp = [[-0.28, 1.51, -0.1], [-0.28, 1.45, -0.1], [-0.33, 1.51, -0.1], [-0.33, 1.45, -0.1]];
  const foldUp = [[-0.37, 1.6, -0.23], [-0.43, 1.6, -0.23], [-0.37, 1.39, -0.23], [-0.43, 1.39, -0.23]];
  add([...knotUp, ...foldUp], red);
  add([...foldUp, [-0.33, 1.63, -0.37], [-0.39, 1.62, -0.37], [-0.34, 1.37, -0.37], [-0.39, 1.36, -0.37]], red);   // 上片
  const knotDn = [[-0.28, 1.47, -0.1], [-0.28, 1.42, -0.07], [-0.33, 1.47, -0.1], [-0.33, 1.42, -0.07]];
  const foldDn = [[-0.345, 1.36, -0.31], [-0.4, 1.36, -0.31], [-0.345, 1.2, -0.22], [-0.4, 1.2, -0.22]];
  add([...knotDn, ...foldDn], red);
  add([...foldDn, [-0.34, 1.08, -0.4], [-0.4, 1.08, -0.4], [-0.31, 1.03, -0.2], [-0.37, 1.03, -0.2]], red);       // 下片：越往下越寬

  g.traverse((m) => { if (m.isMesh) m.userData.figure = true; });
  // fpHide：掌舵的第一人稱要藏起來的部分（脖子以上）；mats：這個人用到的所有材質
  // setFace：換表情（FACES 裡的一個）
  const setFace = (id) => { const t = faceTexture(FACES.includes(id) ? id : 'normal'); if (face.map !== t) face.map = t; };
  g.userData = { legs, arms, head, upper, setFace, fpHide: [neck, head], torso, mats: [skin, hair, shirt, skirt, navy, red, boot, sole, trim, face] };
  return g;
}

// 百褶裙：三十二個點一凸一凹（十六道褶）；凹的那圈要縮得比 cos(360°/32) 還多，才真的是凹下去的褶。
// 上窄下寬（A 字）、前後比左右扁一點
function skirtGeometry() {
  const n = 32;
  let geo = new THREE.CylinderGeometry(1, 1, 1, n, 1, true);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = ((Math.round(Math.atan2(x, z) / (Math.PI * 2) * n) % n) + n) % n;
    const f = k % 2 ? 0.945 : 1, top = y > 0;
    p.setXYZ(i, x * (top ? 0.105 : 0.225) * f, top ? 0.73 : 0.47, z * (top ? 0.145 : 0.27) * f);
  }
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();
  return geo;
}
