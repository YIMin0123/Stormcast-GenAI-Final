// 船：三種木造漁船（小舢舨、漁船、大漁船）的模型、浮力與操控。人物模型在 figure.js（這裡轉出去給別的檔案用）。
// 船身與人物座標：+X 前方、+Y 向上、+Z 右側；船的原點在水線中央。
import * as THREE from 'three';
import { bulb } from './toon.js';
import { buildFigure } from './figure.js';
export { buildFigure };

import { BOAT_TYPES, MAX_LEVEL, BOAT_PAINTS, CRACK_SLOW } from './boatdata.js';
// 三種船的規格在 boatdata.js（伺服器也用同一份）
export { BOAT_TYPES, MAX_LEVEL };
const CRACKS = 6;          // 耐久度分成幾處破洞：全破了船就沉
const DRIFT = 1.2;         // 沒油時只能用這個速度慢慢漂（公尺/秒）
const GROUND_MIN = 0.12;   // 擱淺的船拖著船底往淺處爬，水深剩這麼多（公尺）就不能再往淺處走（不會開上陸地）
// 船受得了的搖晃（斜率）：超過 SAFE 開始受損，橫搖超過 CAPSIZE 就翻
const SAFE_ROLL = 0.24, SAFE_PITCH = 0.28, CAPSIZE_ROLL = 0.5, CAPSIZE_PITCH = 1.0;   // 外海的浪變大之後，船受得了的角度也跟著放寬
const HURT_K = 5;          // 搖過頭時每秒扣多少耐久（乘上超出的角度）。以前是 40，船太容易壞；
// 現在：平常的日子在外海不會壞，風大的日子橫著受浪每分鐘掉一兩點，暴風雨裡橫著受浪小舢舨大約撐三四分鐘
const LAMP_POOL = 0.11;      // 集魚燈照在海面那圈光最亮多亮（加亮混色；晚上海很黑，一點點就很明顯）
const JOLT_K = 2;          // 船身晃多快算「猛地一晃」（俯仰、橫搖的角速度加起來，除以這個數字；1 以上甲板上的魚會被拋起來）
const GALE_HEEL = 0.07;   // 每秒 40 公尺的風（颱風）橫著吹過來時，船被壓歪的斜率（約 4 度；陣風時更多）
const SPOUT_HEEL = 0.48; // 水龍捲最強的陣風橫著打過來時，船被猛烈壓歪的斜率（加上浪的搖晃就可能翻）

const WHEEL_R = 0.25;   // Q 版人物：方向盤太大會擋住第一人稱往前看
const FP_GAP = 0.45;     // 第一人稱時站在方向盤後面多遠：再近輪子會塞滿畫面，再遠手要伸成細長一根擋在眼前
const HELM_GAP = 0.34;   // 第三人稱時舵手站在方向盤後面多遠（瀏海離輪子剩幾公分，手才搆得到）
const HULL_SEGMENTS = 34, RAIL_WIDTH = 1.03, DECK_WIDTH = 0.97; // 船殼與甲板碰撞共用的模型尺寸
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

// 船身半寬；t：0 = 船尾，1 = 船首
function halfBeam(S, t) {
  return (S.beam / 2) * (t < 0.38
    ? 0.74 + 0.26 * Math.sin((t / 0.38) * Math.PI / 2)
    : Math.pow(Math.max(Math.cos(((t - 0.38) / 0.62) * Math.PI / 2), 0), 0.52));
}

// 船殼碰撞取樣點（局部座標 [lx, lz]，快取於規格上避免每幀配置記憶體）：沿兩舷外緣、船首、船尾封板及龍骨中心密集覆蓋，
// 使狹窄的指棧（0.8m）或碼頭轉角無法從取樣縫隙間鑽入，同時留出泊位停靠（0.45m）所需的安全邊距
const _hullCache = new WeakMap();
function hullSamples(S) {
  let pts = _hullCache.get(S);
  if (pts) return pts;
  pts = [];
  const half = S.len / 2, endF = 0.98, beamF = 0.98;
  const nx = Math.max(8, Math.ceil(S.len / 0.75));
  for (let i = 0; i <= nx; i++) {
    const t = 0.5 + (i / nx - 0.5) * endF;
    const lx = (t - 0.5) * S.len, w = halfBeam(S, t) * beamF;
    pts.push([lx, w], [lx, -w]);
    if (i % 2 === 0 || i === nx) pts.push([lx, 0]);
  }
  const sw = halfBeam(S, 0.5 - 0.5 * endF) * beamF;
  for (const k of [-0.7, -0.35, 0.35, 0.7]) pts.push([-endF * half, sw * k]);
  _hullCache.set(S, pts);
  return pts;
}

function railRise(S, t) {
  return S.bul + S.rise * t ** 2.6 + 0.43 * S.bul * (1 - t) ** 2;
}

function hullSection(S, t) {
  const half = halfBeam(S, t);
  const sheer = S.deck + railRise(S, t);
  const keel = -S.draft * (1 - Math.pow(t, 5));
  // 半邊剖面，由龍骨到舷緣：[橫向, 高度]
  return [[0, keel], [0.6 * half, keel * 0.9], [1.07 * half, keel * 0.12], [1.13 * half, 0.56 * sheer], [half * RAIL_WIDTH, sheer]];
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
  const NS = HULL_SEGMENTS, NP = 9;   // 縱向分幾段、半邊剖面分幾段
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
  const pos = [], colr = [], nor = [], deck = [], cap = [], paintVerts = [];
  // 水線下是深紅的防污漆，水線上一道白漆，船舷是上過油的木頭，舷牆是各船自己的漆色
  const RED = [0.50, 0.095, 0.065], WHITE = [0.90, 0.88, 0.80], WOOD = [0.52, 0.31, 0.15], PAINT = S.paint.map((v) => Math.min(1, v * 1.25));
  const tri = (list) => { for (const [ss, ii] of list) { pos.push(...rings[ss][ii]); const n = nrm[ss][ii]; const l = n.length() || 1; nor.push(n.x / l, n.y / l, n.z / l); } };
  for (let s = 0; s < NS; s++) {
    for (let i = 0; i < M - 1; i++) {
      tri([[s, i], [s + 1, i], [s, i + 1], [s + 1, i], [s + 1, i + 1], [s, i + 1]]);
      const y = (rings[s][i][1] + rings[s][i + 1][1] + rings[s + 1][i][1] + rings[s + 1][i + 1][1]) / 4;
      const sheer = (sheers[s] + sheers[s + 1]) / 2, strake = Math.min(Math.abs(i - mid), Math.abs(i + 1 - mid));
      let col = y < 0.0 ? RED : y < 0.11 ? WHITE : y < 0.66 * sheer ? WOOD : PAINT;
      const isPaint = col === PAINT;
      if (col === WOOD) { const k = 0.86 + 0.28 * (((s >> 1) * 7 + strake * 3) % 4) / 3; col = [WOOD[0] * k, WOOD[1] * k, WOOD[2] * k]; }   // 木板一片深一片淺
      for (let n = 0; n < 6; n++) { if (isPaint) paintVerts.push(colr.length / 3); colr.push(col[0], col[1], col[2]); }
    }
    const d = (r) => [[r[0][0], S.deck, r[0][2] * DECK_WIDTH], [r[M - 1][0], S.deck, r[M - 1][2] * DECK_WIDTH]];
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
    const isPaint = col === PAINT;
    for (let n = 0; n < 6; n++) { if (isPaint) paintVerts.push(colr.length / 3); colr.push(col[0], col[1], col[2]); nor.push(-1, 0, 0); }
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  hg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colr), 3));
  hg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  hg.userData.paintVerts = paintVerts;
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
  const D = S.deck, { x0, x1, hw, top } = S.cabin, cx = (x0 + x1) / 2, wallH = 0.7;   // 艙壁到腰：人物只有 1.62 高，船外看得到上半身
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
  const winH = 1.95 - wallH, winY = D + (1.95 + wallH) / 2;   // 窗：艙壁頂到窗楣
  g.add(box(0.03, winH, hw * 2 - 0.16, glass, x1, winY, 0),
    box(x1 - x0 - 0.16, winH, 0.03, glass, cx, winY, -hw), box(x1 - x0 - 0.16, winH, 0.03, glass, cx, winY, hw));
  for (const pz of [-hw * 0.34, hw * 0.34]) g.add(box(0.06, winH, 0.06, wood, x1, winY, pz));          // 前窗的窗框
  g.add(box(0.06, winH, 0.06, wood, cx, winY, -hw), box(0.06, winH, 0.06, wood, cx, winY, hw));
  for (const [side, colr] of [[-1, 0xff3b30], [1, 0x34d058]]) {
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: colr }));
    nav.position.set(x1 + 0.2, D + top + 0.2, side * (hw + 0.1));
    g.add(nav, box(0.14, 0.12, 0.05, iron, x1 + 0.14, D + top + 0.2, side * (hw + 0.16)));
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 8, 18), lambert(0xe2582a));
  ring.rotation.set(0, 0, 0);
  ring.position.set(cx - 0.3, D + 0.37, hw + 0.09);
  g.add(ring);
  for (const a of [0, 1, 2, 3]) {
    const band = box(0.16, 0.16, 0.05, lambert(0xf2f0ea), 0, 0, 0);
    band.position.set(cx - 0.3 + Math.cos(a * Math.PI / 2 + 0.78) * 0.26, D + 0.37 + Math.sin(a * Math.PI / 2 + 0.78) * 0.26, hw + 0.09);
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
  // 方向盤中心在人物胸口的高度（肩膀 0.92），舵台跟艙壁一樣高
  const wheelPos = new THREE.Vector3(x1 - 0.82, D + 0.8, 0);
  g.add(box(0.55, 0.72, hw * 2 - 1.0, wood, x1 - 0.4, D + 0.36, 0));
  g.add(box(0.06, 0.24, 0.34, brass, x1 - 0.65, D + 0.84, -0.45)); // 羅盤座
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
  throttle.position.set(x1 - 0.45, D + 0.72, 0.6);
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
  const tankObj = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.8, 14), tankMat);
  drum.rotation.z = Math.PI / 2;
  drum.position.set(ex, tankY, tz);
  tankObj.add(drum);
  for (const sx of [-0.26, 0.26]) {
    tankObj.add(box(0.1, 0.16, 0.56, darkWood, ex + sx, D + 0.08, tz));                // 墊木
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.278, 0.278, 0.05, 14), iron);
    strap.rotation.z = Math.PI / 2;
    strap.position.set(ex + sx, tankY, tz);
    tankObj.add(strap);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), iron);
  neck.position.set(ex + 0.1, tankY + 0.3, tz);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.035, 12), brass);
  cap.position.set(ex + 0.1, tankY + 0.36, tz);
  const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 12), lambert(0xf2eede));
  gauge.rotation.z = Math.PI / 2;
  gauge.position.set(ex + 0.41, tankY + 0.02, tz);
  tankObj.add(neck, cap, gauge);
  g.add(tankObj, box(0.05, 0.05, 0.42, iron, ex - 0.2, D + 0.2, tz - 0.42));          // 油管
  blocks.push([ex - 0.45, ex + 0.45, tz - 0.3, tz + 0.3]);

  // ---- 前甲板左舷的長椅：坐在上面面向海，可以釣魚 ----
  const sx = S.hatch.x, sz = -(halfBeam(S, (sx + S.len / 2) / S.len) - 0.62);
  const seatMesh = new THREE.Group();
  seatMesh.add(box(1.3, 0.06, 0.36, wood, sx, D + 0.42, sz));
  for (const lx of [-0.52, 0.52]) seatMesh.add(box(0.07, 0.4, 0.32, darkWood, sx + lx, D + 0.2, sz));
  seatMesh.add(box(1.04, 0.05, 0.05, darkWood, sx, D + 0.14, sz));
  g.add(seatMesh);
  blocks.push([sx - 0.66, sx + 0.66, sz - 0.19, sz + 0.19]);

  // ---- 船燈的開關：駕駛艙右前方那根柱子內側的一個小銅盒，上面一根撥桿、一顆指示燈 ----
  const sw = new THREE.Vector3(x1 - 0.14, D + 1.05, hw - 0.14);
  const switchObj = new THREE.Group();
  const lever = new THREE.Group();
  lever.position.set(sw.x - 0.04, sw.y - 0.02, sw.z);
  lever.add(box(0.09, 0.025, 0.025, iron, -0.04, 0, 0), box(0.035, 0.045, 0.045, lambert(0xb23a2e), -0.09, 0, 0));
  const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: 0x3a2a1a }));
  pilot.position.set(sw.x - 0.04, sw.y + 0.065, sw.z);
  switchObj.add(box(0.07, 0.2, 0.13, brass, sw.x, sw.y, sw.z), lever, pilot);
  g.add(switchObj);

  // ---- 兩種船各自的樣子：近海漁船是輕快的海釣船（前甲板一頂藍白條紋遮陽棚），遠洋大漁船是雙層艦橋＋船尾 A 字吊架的大船 ----
  const seats = [{ x: sx, z: sz, h: 0.45, yaw: -Math.PI / 2, out: [0, 0.6], mesh: seatMesh }];   // 坐的位置、坐墊高度、面向（相對船首）、站起來時往哪裡挪
  const white = lambert(0xf2f0ea), yellow = lambert(0xe8c13a), black = lambert(0x1d1b1a), steel = lambert(0x8d979c);
  let radarBar = null;
  const searchLamps = [];
  if (S.id === 'fisher') {
    // 遮陽棚：四根細白柱撐著藍白相間的帆布頂
    const cy = D + 2.15, blue = lambert(0x2f6fb0);
    for (const px of [0.2, 3.6]) for (const pz of [-1.45, 1.45]) g.add(box(0.05, 2.15, 0.05, white, px, D + 1.075, pz));
    for (let i = 0; i < 6; i++) g.add(box(0.6, 0.05, 3.2, i % 2 ? white : blue, 0.2 + 0.3 + i * 0.6 - 0.1, cy + 0.03, 0));
    for (const pz of [-1.6, 1.6]) g.add(box(3.6, 0.14, 0.03, blue, 1.9, cy - 0.05, pz));   // 兩側垂下來的布邊
    // 屋頂一根竹製的長天線、船頭的救生圈架
    const bamboo = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.022, 3.4, 6), lambert(0xb99a4a));
    bamboo.position.set(x0 + 0.5, roofY + 1.7, -hw + 0.3);
    bamboo.rotation.z = -0.08;
    g.add(bamboo);
    const bx = S.len / 2 - 1.5, by = D + railRise(S, 0.9) + 0.25;
    g.add(box(0.05, 0.5, 0.05, steel, bx, by - 0.1, 0.5));
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.055, 6, 14), lambert(0xe2582a));
    ring2.rotation.y = Math.PI / 2;
    ring2.position.set(bx, by + 0.1, 0.5);
    g.add(ring2);
  } else if (S.id === 'trawler') {
    // 二樓瞭望台：屋頂鋪一層地板、四周深灰的鋼護欄、左後角一座登頂的鐵梯
    const fy = roofY + 0.03, rail = lambert(0x3a3f43), rh = 0.85;
    g.add(box(x1 - x0 + 0.5, 0.05, hw * 2 + 0.3, steel, cx, fy, 0));
    for (const pz of [-hw - 0.1, hw + 0.1]) {
      g.add(box(x1 - x0 + 0.5, 0.05, 0.05, rail, cx, fy + rh, pz), box(x1 - x0 + 0.5, 0.035, 0.035, rail, cx, fy + rh * 0.5, pz));
      for (let px = x0 - 0.2; px <= x1 + 0.21; px += (x1 - x0 + 0.4) / 4) g.add(box(0.05, rh, 0.05, rail, px, fy + rh / 2, pz));
    }
    g.add(box(0.05, 0.05, hw * 2 + 0.2, rail, x1 + 0.2, fy + rh, 0), box(0.05, 0.035, hw * 2 + 0.2, rail, x1 + 0.2, fy + rh * 0.5, 0));
    for (const pz of [-0.32, 0.32]) g.add(box(0.05, top + 0.2, 0.05, rail, x0 - 0.12, D + (top + 0.2) / 2, -hw + 0.5 + pz));
    for (let y = D + 0.3; y < D + top; y += 0.32) g.add(box(0.04, 0.035, 0.64, rail, x0 - 0.12, y, -hw + 0.5));
    // 雷達塔：白色的 T 型塔，頂上一根一直轉的雷達橫桿
    const tx = cx + 0.9, th = 2.3;
    g.add(box(0.14, th, 0.14, white, tx, fy + th / 2, 0), box(0.1, 0.08, 1.5, white, tx, fy + th * 0.7, 0), box(0.5, 0.1, 0.5, white, tx, fy + th + 0.05, 0));
    radarBar = new THREE.Group();
    radarBar.position.set(tx, fy + th + 0.2, 0);
    radarBar.add(box(0.14, 0.12, 1.8, white, 0, 0.02, 0), box(0.16, 0.06, 1.6, lambert(0xc8352a), 0, 0.1, 0));
    g.add(radarBar, box(0.08, 0.14, 0.08, rail, tx, fy + th + 0.12, 0));
    // 船頂左右兩顆遠程探照燈（跟船首集魚燈一起亮）
    for (const pz of [-hw + 0.25, hw - 0.25]) {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.26, 10), rail);
      head.rotation.z = Math.PI / 2 - 0.25;
      head.position.set(x1 + 0.05, fy + 0.42, pz);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 10), new THREE.MeshBasicMaterial({ color: 0x4a4636 }));
      lens.rotation.z = Math.PI / 2 - 0.25;
      lens.position.set(x1 + 0.19, fy + 0.385, pz);
      g.add(head, lens, box(0.06, 0.3, 0.06, rail, x1, fy + 0.18, pz));
      searchLamps.push(lens);
    }
    // 船尾：黃黑相間的 A 字鋼吊架（兩條往前傾的腿、頂上一根橫樑、兩顆滑輪吊鉤），第二根粗煙囪
    const ah = 3.8, ax0 = -S.len / 2 + 1.1, ax1 = ax0 + 0.85, az = halfBeam(S, 0.08) - 0.3;
    for (const sd of [-1, 1]) {
      const n = 6;
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n, seg = box(0.2, ah / n + 0.02, 0.2, i % 2 ? black : yellow, 0, 0, 0);
        seg.position.set(ax0 + (ax1 - ax0) * (t0 + t1) / 2, D + ah * (t0 + t1) / 2, sd * (az - (az - 1.25) * (t0 + t1) / 2));
        seg.rotation.set(-sd * Math.atan2(az - 1.25, ah), 0, -Math.atan2(ax1 - ax0, ah));
        g.add(seg);
      }
      g.add(box(0.34, 0.1, 0.34, black, ax0, D + 0.05, sd * az));
      const hook = new THREE.Group();
      hook.position.set(ax1, D + ah - 0.25, sd * 0.6);
      hook.add(box(0.16, 0.2, 0.1, black, 0, 0, 0), box(0.03, 0.7, 0.03, steel, 0, -0.45, 0), box(0.12, 0.05, 0.05, steel, 0.04, -0.8, 0));
      g.add(hook);
    }
    for (let i = 0; i < 5; i++) g.add(box(0.24, 0.26, 2.7 / 5, i % 2 ? yellow : black, ax1, D + ah, -1.08 + i * 0.54));
    blocks.push([ax0 - 0.17, ax0 + 0.17, -az - 0.17, -az + 0.17], [ax0 - 0.17, ax0 + 0.17, az - 0.17, az + 0.17]);   // 只擋腳本身：腳的內側留一條路走到船尾
    for (const pz of [-0.4, 0.4]) {
      const fat = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 2.5, 10), black);
      fat.position.set(ex - 0.05, D + 1.7, pz);
      g.add(fat, box(0.38, 0.1, 0.38, lambert(0xc8352a), ex - 0.05, D + 2.6, pz));
    }
    // 前甲板：藍白雙槽急凍魚艙蓋（冷媒管、扣環）、捲網絞盤、白色圓筒救生筏
    const hs = S.hatch.s, hx = S.hatch.x, lid = lambert(0xe9eef2), frz = lambert(0x2f6fb0);
    for (const pz of [-hs / 4, hs / 4]) {
      g.add(box(hs - 0.2, 0.08, hs / 2 - 0.14, lid, hx, D + 0.32, pz), box(hs - 0.1, 0.05, 0.06, frz, hx, D + 0.37, pz));
      for (const px of [-hs * 0.3, hs * 0.3]) g.add(box(0.1, 0.05, 0.14, steel, hx + px, D + 0.37, pz + (pz > 0 ? 1 : -1) * (hs / 4 - 0.1)));
    }
    g.add(box(hs + 0.04, 0.3, 0.1, frz, hx, D + 0.15, 0), box(0.06, 0.06, hs * 0.8, steel, hx - hs / 2 - 0.06, D + 0.2, 0));
    const wx = hx + hs / 2 + 1.1;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.1, 12), lambert(0x4f7a5a));
    drum.rotation.x = Math.PI / 2;
    drum.position.set(wx, D + 0.5, -0.9);
    g.add(drum);
    for (const pz of [-1.5, -0.3]) g.add(box(0.5, 0.95, 0.08, rail, wx, D + 0.475, pz));
    blocks.push([wx - 0.45, wx + 0.45, -1.6, -0.2]);
    const raft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.95, 12), white);
    raft.rotation.z = Math.PI / 2;
    const rfx = cx - 0.5, rfz = -hw + 0.5;   // 架在二樓平台左舷（不佔甲板的走道）
    raft.position.set(rfx, fy + 0.4, rfz);
    g.add(raft, box(0.1, 0.12, 0.7, rail, rfx - 0.3, fy + 0.06, rfz), box(0.1, 0.12, 0.7, rail, rfx + 0.3, fy + 0.06, rfz),
      box(0.06, 0.62, 0.62, lambert(0xc8352a), rfx, fy + 0.4, rfz));
    // 右舷再一張釣魚長椅（左舷那張原本就有）：四個人的船隊都坐得下
    const sz2 = -sz, seat2 = new THREE.Group();
    seat2.add(box(1.3, 0.06, 0.36, wood, sx, D + 0.42, sz2));
    for (const lx of [-0.52, 0.52]) seat2.add(box(0.07, 0.4, 0.32, darkWood, sx + lx, D + 0.2, sz2));
    seat2.add(box(1.04, 0.05, 0.05, darkWood, sx, D + 0.14, sz2));
    g.add(seat2);
    blocks.push([sx - 0.66, sx + 0.66, sz2 - 0.19, sz2 + 0.19]);
    seats.push({ x: sx, z: sz2, h: 0.45, yaw: Math.PI / 2, out: [0, -0.6], mesh: seat2 });
  }

  // ---- 探魚聲納（改裝，買了才出現）：方向盤右前方舵台上的一台小機器，螢幕朝著舵手 ----
  const sonar = new THREE.Group();
  sonar.position.set(x1 - 0.56, D + 0.72, 0.34);
  sonar.add(box(0.2, 0.05, 0.28, iron, 0, 0.025, 0), box(0.1, 0.24, 0.28, iron, 0.02, 0.17, 0), box(0.02, 0.2, 0.012, brass, 0.06, 0.32, 0.1));
  let sonarCtx = null, sonarTex = null;
  {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 96;
    const ctx = cv.getContext('2d');
    // 沒有畫布可以畫（測試環境）：螢幕就是一片綠
    if (ctx && typeof ctx.arc === 'function') { sonarCtx = ctx; sonarTex = new THREE.CanvasTexture(cv); sonarTex.colorSpace = THREE.SRGBColorSpace; }
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.18), new THREE.MeshBasicMaterial(sonarTex ? { map: sonarTex, toneMapped: false } : { color: 0x1c6b3a }));
    scr.rotation.y = -Math.PI / 2;
    scr.position.set(-0.035, 0.17, 0);
    sonar.add(scr);
  }
  sonar.visible = false;
  g.add(sonar);

  // ---- 船首集魚燈（改裝，買了才出現）：船頭一座往下照的探照燈；燈一開，船頭的海面亮一圈 ----
  const blx = S.len / 2 - 0.58, bly = D + railRise(S, 0.96);
  const bowLamp = new THREE.Group();
  bowLamp.position.set(blx, bly, 0);
  const lampHead = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.13, 0.3, 10), iron);
  lampHead.rotation.z = Math.PI / 2 + 0.55;
  lampHead.position.set(0.12, 0.62, 0);
  const lampLens = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 10), new THREE.MeshBasicMaterial({ color: 0x4a4636 }));
  lampLens.rotation.z = Math.PI / 2 + 0.55;
  lampLens.position.set(0.26, 0.535, 0);
  bowLamp.add(box(0.07, 0.6, 0.07, iron, 0, 0.3, 0), box(0.22, 0.05, 0.3, iron, 0, 0.03, 0), lampHead, lampLens);
  for (const pz of [-0.19, 0.19]) bowLamp.add(box(0.04, 0.2, 0.03, brass, 0.06, 0.56, pz));
  // 照在海面上的那一圈光：只加亮、不動畫面的 alpha（alpha 是「是不是天空」的記號）
  //   中間亮、往外三圈淡到沒有（頂點色）：整片一樣亮的話邊緣很硬，晚上看像一塊板子躺在海上
  const poolGeo = new THREE.BufferGeometry();
  {
    const N = 24, rings = [[0.3, 1], [0.62, 0.42], [1, 0]], pos = [0, 0, 0], col = [1, 1, 1], idx = [];
    for (const [rr, k] of rings) for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; pos.push(Math.cos(a) * rr, Math.sin(a) * rr, 0); col.push(k, k, k); }
    for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + (i + 1) % N);
    for (let q = 0; q < rings.length - 1; q++) for (let i = 0; i < N; i++) { const a = 1 + q * N + i, b = 1 + q * N + (i + 1) % N; idx.push(a, a + N, b, b, a + N, b + N); }
    poolGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    poolGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    poolGeo.setIndex(idx);
  }
  const pool = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({
    color: 0xffe7a8, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  }));
  pool.rotation.x = -Math.PI / 2;
  pool.scale.set(S.len * 0.42, S.len * 0.3, 1);
  pool.position.set(blx + S.len * 0.34, 0.25, 0);   // 貼在水線上、船頭前面
  pool.visible = false;
  pool.renderOrder = 4;
  bowLamp.visible = false;
  g.add(bowLamp, pool);

  // 舵手：站在方向盤正後方，第一人稱時再退一點（setManned 會依視角挪位置；眼睛 eye 在第一人稱的位置上）
  const helmsman = buildFigure();
  helmsman.position.set(wheelPos.x - HELM_GAP, D, 0);
  g.add(helmsman);
  return {
    sonar, sonarCtx, sonarTex, bowLamp, bowLampLens: lampLens, bowLampPool: pool, searchLamps, radarBar,
    bowLampAt: new THREE.Vector3(blx + 0.1, bly + 0.55, 0), bowLampR: 0.5,     // 準心要對準哪裡才能開關集魚燈
    wheel, wheelPos, throttle, helmsman, lantern, lever, pilot, tankObj, switchObj, roofPaintMat: paint,
    helm: wheelPos,                                       // 準心要對準哪裡才能掌舵：方向盤
    tank: new THREE.Vector3(ex + 0.1, tankY + 0.3, tz),   // 加油口
    switch: sw, switchR: 0.2,                             // 船燈的開關
    seats,
    eye: new THREE.Vector3(wheelPos.x - FP_GAP + 0.08, D + 1.25, 0), // 第一人稱的眼睛位置（跟走路時一樣高，player.js 的 eyeH）
    lamp: new THREE.Vector3(cx - 0.8, roofY + 2.5, 0),   // 桅頂的油燈
    roof: [[x0, -hw], [x1, -hw], [x1, hw], [x0, hw]].map(([x, z]) => new THREE.Vector3(x, roofY, z)),
  };
}

// 小舢舨：敞船，船尾掛一顆小引擎，用舵柄操控
function buildSkiff(S, g, blocks) {
  const D = S.deck, wood = lambert(0x7a5230), iron = lambert(0x2b2d2f);
  const seats = [-0.7, 1.9].map((tx, i) => {
    const plank = box(0.28, 0.05, halfBeam(S, (tx + S.len / 2) / S.len) * 1.9, wood, tx, D + 0.3, 0);   // 坐板
    g.add(plank);
    return { x: tx, z: 0, h: 0.34, yaw: i ? Math.PI : 0, out: [i ? -0.45 : 0.45, 0], mesh: plank };
  });
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
  const red = lambert(0xb8322a), tx = -2.25, tz = -0.5, tankObj = new THREE.Group();
  tankObj.add(box(0.44, 0.24, 0.3, red, tx, D + 0.12, tz), box(0.2, 0.03, 0.04, iron, tx - 0.06, D + 0.3, tz),
    box(0.03, 0.06, 0.04, iron, tx - 0.15, D + 0.27, tz), box(0.03, 0.06, 0.04, iron, tx + 0.03, D + 0.27, tz));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10), iron);
  cap.position.set(tx + 0.14, D + 0.265, tz);
  tankObj.add(cap);
  const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.62, 5), iron);
  hose.position.set(-2.62, D + 0.3, -0.27);
  hose.rotation.set(0.75, 0, 1.0);
  g.add(tankObj, hose);
  blocks.push([tx - 0.24, tx + 0.24, tz - 0.17, tz + 0.17]);

  const helmsman = buildFigure();
  helmsman.position.set(S.helmX, D, 0);
  g.add(helmsman);
  const c = [[-1.5, -0.6], [1.5, -0.6], [1.5, 0.6], [-1.5, 0.6]];
  return {
    wheel: null, tiller, throttle: null, helmsman, lantern, lever: null, pilot: null, tankObj, switchObj: lantern,
    helm: new THREE.Vector3(-S.len / 2 + 0.6, D + 0.75, 0),      // 準心要對準哪裡才能掌舵：舵柄
    tank: new THREE.Vector3(tx + 0.14, D + 0.27, tz),            // 加油口
    switch: new THREE.Vector3(S.len / 2 - 0.9, D + 1.25, 0), switchR: 0.3,   // 船燈沒有另外的開關：直接對準船首那盞燈
    seats,                                                       // 兩塊坐板
    eye: new THREE.Vector3(S.helmX + 0.08, D + 1.25, 0),
    lamp: new THREE.Vector3(S.len / 2 - 0.9, D + 1.25, 0),
    roof: c.map(([x, z]) => new THREE.Vector3(x, D, z)),   // 沒有屋頂：影子只算船身
  };
}

// 回傳船的模型；blocks 會被填入甲板上走不過去的範圍 [x0, x1, z0, z1]
export function buildBoatMesh(S, blocks = []) {
  const g = new THREE.Group();
  const hull = buildHull(S);
  hull.forEach((m) => g.add(m));
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
  g.userData.hullGeo = hull[0].geometry;
  // 海上救難用：船尾甲板一座黃黑相間的十字拖船樁（旁邊盤著麻繩）、船頭一個拖纜環。小舢舨的舵柄在正中間，樁偏到右舷
  {
    const tx = -S.len / 2 + 0.45, tz = S.cabin ? 0 : 0.55, D = S.deck, k = S.cabin ? 1 : 0.7;
    const yel = lambert(0xe8c13a), blk = lambert(0x1d1b1a), post = new THREE.Group();
    post.position.set(tx, D, tz);
    for (let i = 0; i < 4; i++) post.add(box(0.13 * k, 0.15 * k, 0.13 * k, i % 2 ? blk : yel, 0, (0.075 + i * 0.15) * k, 0));
    post.add(box(0.1 * k, 0.1 * k, 0.5 * k, blk, 0, 0.42 * k, 0), box(0.18 * k, 0.05 * k, 0.18 * k, yel, 0, 0.62 * k, 0));
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.2 * k, 0.06 * k, 5, 12), lambert(0xc9ae7a));
    coil.rotation.x = Math.PI / 2;
    coil.position.set(0.05, 0.06 * k, (S.cabin ? 0.42 : -0.3) * k);
    post.add(coil);
    g.add(post);
    const by = D + railRise(S, 1) + 0.02, eye = new THREE.Mesh(new THREE.TorusGeometry(0.09 * k, 0.025 * k, 5, 10), lambert(0x2b2d2f));
    eye.rotation.x = Math.PI / 2;
    eye.position.set(S.len / 2 - 0.22, by, 0);
    g.add(eye);
    g.userData.towPost = new THREE.Vector3(tx, D + 0.45 * k, tz);   // 拖纜綁在這裡；準心對準它按 E
    g.userData.towR = 0.45;
    g.userData.bowEye = new THREE.Vector3(S.len / 2 - 0.22, by, 0);
  }
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
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, side: THREE.DoubleSide, forceSinglePass: true }));
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
    this.moveSpeed = 0;
    this.engineLv = 0;   // 引擎等級：每級極速 +15%
    this.fuel = S.tank;  // 油箱裡的油（公升）；新船是滿的
    this.damage = [];    // 甲板上的破洞：{ lx, lz, dmg, mesh }。耐久度 = 滿的 - 所有破洞
    this.roll = 0;       // 目前的橫搖、縱搖（斜率）
    this.pitch = 0;
    this.sinking = 0;    // 正在沉：開始沉了幾秒（0 = 沒事）
    this.sunkBy = null;  // 'capsize' 被浪打翻、'flood' 破損太嚴重
    this.moor = null;    // 纜繩綁在岸上的哪根繫纜樁：{ i 第幾根, lx, lz 船上綁繩子的位置, len 繩長 }；沒綁是 null
    this.lampOn = true;  // 船燈的開關（開著：天黑了會照亮甲板；關掉就不亮）
    this.paintId = 'default';
    this.mods = { sonar: false, lamp: false };   // 改裝（探魚聲納、船首集魚燈）：買了才裝上去（見 setMods）
    this.fishLamp = false;                       // 船首集魚燈開著嗎（要先裝了才開得了）
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

  // 極速：引擎每級 +15%；船板每破一個洞慢一截（進水拖著走），最慢還剩一半，開得回修船屋
  get maxSpeed() { return this.spec.speed * (1 + 0.15 * this.engineLv) * Math.max(CRACK_SLOW.floor, 1 - CRACK_SLOW.each * this.damage.length) * (this.towK ?? 1); }   // towK：拖著別的船時極速剩幾成
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

  // 更換船殼塗裝（船舷漆色 + 駕駛艙屋頂）
  setPaint(paintId = 'default') {
    if (this.paintId === paintId) return;
    this.paintId = paintId;
    const P = BOAT_PAINTS.find((p) => p.id === paintId);
    const rgb = (P && P.rgb) || this.spec.paint;
    const hullPaint = rgb.map((v) => Math.min(1, v * 1.25));
    const hg = this.parts.hullGeo, colAttr = hg?.getAttribute('color');
    if (colAttr && hg.userData.paintVerts) {
      for (const vi of hg.userData.paintVerts) colAttr.setXYZ(vi, hullPaint[0], hullPaint[1], hullPaint[2]);
      colAttr.needsUpdate = true;
    }
    if (this.parts.roofPaintMat) this.parts.roofPaintMat.color.setRGB(rgb[0], rgb[1], rgb[2]).multiplyScalar(1.6);
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

  // 改裝（買了才有）：探魚聲納、船首集魚燈。小舢舨裝不了（沒有那些零件）
  setMods(mods) {
    this.mods = { sonar: !!mods?.sonar, lamp: !!mods?.lamp };
    const P = this.parts;
    if (P.sonar) P.sonar.visible = this.mods.sonar;
    if (P.bowLamp) P.bowLamp.visible = this.mods.lamp;
    if (!this.mods.lamp) this.fishLamp = false;
  }
  // 船首集魚燈開關（要先裝了才開得了）
  setFishLamp(on) { this.fishLamp = !!on && this.mods.lamp && !!this.parts.bowLamp; }
  // 聲納掃多遠（公尺；沒裝是 0）
  get sonarRange() { return this.mods.sonar && this.parts.sonar ? this.spec.sonarRange || 0 : 0; }
  // 聲納的螢幕：每 0.12 秒重畫一次。spots：[{ x, z, n 剩幾條 }]（世界座標的魚群）；depth：船底下水多深（公尺）
  updateSonarScreen(dt, spots, depth) {
    const g = this.parts.sonarCtx;
    if (!g || !this.sonarRange) return;
    this._sonarT = (this._sonarT || 0) + dt;
    this._sonarA = ((this._sonarA || 0) + dt * 2.2) % (Math.PI * 2);
    if (this._sonarT < 0.12) return;
    this._sonarT = 0;
    const W = 128, H = 96, cx = 48, cy = 48, R = 42, range = this.sonarRange;
    g.fillStyle = '#04170c'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1f7a3f'; g.lineWidth = 1;
    for (const r of [R, R * 2 / 3, R / 3]) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    // 掃描線（船頭朝上）
    g.strokeStyle = '#5dff8f'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(this._sonarA) * R, cy - Math.cos(this._sonarA) * R); g.stroke();
    // 魚群的亮點：相對船頭的方向、距離
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    g.font = 'bold 9px monospace'; g.textBaseline = 'middle';
    for (const s of spots) {
      const dx = s.x - this.x, dz = s.z - this.z, d = Math.hypot(dx, dz);
      if (d > range) continue;
      const fwd = dx * ch + dz * sh, right = -dx * sh + dz * ch, px = cx + right / range * R, py = cy - fwd / range * R;
      g.fillStyle = '#b6ffca'; g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fill();
      if (s.n > 0) { g.fillStyle = '#5dff8f'; g.fillText(String(s.n), px + 5, py); }
    }
    g.fillStyle = '#5dff8f'; g.textBaseline = 'alphabetic';
    g.fillText('DEP', 96, 14); g.fillText(`${Math.max(0, depth).toFixed(1)}m`, 94, 26);
    g.fillText('RNG', 96, 48); g.fillText(`${range}m`, 94, 60);
    g.fillText(`${spots.filter((s) => Math.hypot(s.x - this.x, s.z - this.z) <= range).length} SIG`, 94, 84);
    this.parts.sonarTex.needsUpdate = true;
  }

  // 船燈的樣子。glow：天有多黑（0 白天、1 全黑）。開著的燈白天也看得出是亮的，天黑後亮到會暈開；關掉就是一顆暗的玻璃
  showLamp(glow) {
    const P = this.parts, m = P.lantern.material;
    if (P.bowLampLens) {
      // 集魚燈：開著的時候燈頭發亮、船頭海面一圈光（天越黑越明顯）；大漁船屋頂的兩顆探照燈一起亮
      const on = this.fishLamp && this.mods.lamp && !this.sinking;
      P.bowLampLens.material.color.setHex(on ? 0xfff2c4 : 0x4a4636);
      if (on) P.bowLampLens.material.color.multiplyScalar(1 + 1.2 * glow);
      for (const s of P.searchLamps) s.material.color.copy(P.bowLampLens.material.color);
      P.bowLampPool.visible = on && glow > 0.02;
      P.bowLampPool.material.opacity = LAMP_POOL * glow;
    }
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
    h.userData.fpShow?.forEach((m) => { m.visible = fp; });
    // 有方向盤的船：第三人稱時舵手貼近方向盤、握下半圈（看起來手長正常）；
    // 第一人稱時站遠一點（FP_GAP）、握上半圈，從眼睛往下看得到雙手握在輪子上
    this.fpHelm = fp;
    if (this.parts.wheel) h.position.x = this.parts.wheelPos.x - (fp ? FP_GAP : HELM_GAP);
    if (!on) for (const k in this.keys) this.keys[k] = false;
  }

  /** 計算船殼所有碰撞取樣點的地面分布（max、超限累積與踏上棧橋／乾地之點數） */
  hullProfile(ground, x = this.x, z = this.z, heading = this.heading) {
    const S = this.spec, fx = Math.cos(heading), fz = Math.sin(heading), rx = -fz, rz = fx;
    const lim = -S.draft * 0.7;
    let max = -Infinity, hardN = 0, over = 0;
    for (const [lx, lz] of hullSamples(S)) {
      const g = ground(x + fx * lx + rx * lz, z + fz * lx + rz * lz);
      if (g > max) max = g;
      if (g > -GROUND_MIN) hardN++;
      if (g > lim) over += g - lim;
    }
    return { max, hardN, over };
  }

  /** 判斷在 (x, z, heading) 時船殼是否觸及過淺水區、棧橋或岸壁 */
  hullBlocked(ground, x = this.x, z = this.z, heading = this.heading) {
    return this.hullProfile(ground, x, z, heading).max > -this.spec.draft * 0.7;
  }

  _gateOk(env, x, z, heading) {
    if (!env.gate) return true;
    const S = this.spec, half = S.len / 2, fx = Math.cos(heading), fz = Math.sin(heading);
    return env.gate(x + fx * half * 0.9, z + fz * half * 0.9) >= S.beam
      && env.gate(x, z) >= S.beam
      && env.gate(x - fx * half * 0.9, z - fz * half * 0.9) >= S.beam;
  }

  _hullAllowed(cur, cand, lim) {
    if (cand.max <= lim) return true;
    // 棧橋與乾地（> -GROUND_MIN）一律為硬障礙：水裡或淺灘擱淺時都不許跨上去
    if (cur.hardN === 0 && cand.hardN > 0) return false;
    if (cur.hardN > 0) {
      if (cand.hardN > cur.hardN) return false;
      return cand.hardN < cur.hardN || cand.over < cur.over - 1e-4;
    }
    // 擱淺在淺灘時只准往不會更淺或更卡死的方向移動／脫困
    return cand.max <= cur.max + 1e-4 && cand.over <= cur.over + 1e-4;
  }

  _poseAllowed(env, cur, curGate, x, z, heading, lim) {
    if (curGate && !this._gateOk(env, x, z, heading)) return null;
    const cand = this.hullProfile(env.ground, x, z, heading);
    return this._hullAllowed(cur, cand, lim) ? cand : null;
  }

  _wallNormal(ground, x, z, heading, lim) {
    const S = this.spec, fx = Math.cos(heading), fz = Math.sin(heading), rx = -fz, rz = fx, eps = 0.35;
    let gx = 0, gz = 0;
    for (const [lx, lz] of hullSamples(S)) {
      const px = x + fx * lx + rx * lz, pz = z + fz * lx + rz * lz;
      const g = ground(px, pz);
      if (g <= lim) continue;
      const w = g - lim;
      gx += (ground(px + eps, pz) - ground(px - eps, pz)) * w;
      gz += (ground(px, pz + eps) - ground(px, pz - eps)) * w;
    }
    const len = Math.hypot(gx, gz);
    return len > 1e-6 ? [gx / len, gz / len] : null;
  }

  _tryMove(env, cur, curGate, dx, dz, dt, lim) {
    const dist = Math.hypot(dx, dz);
    if (dist <= 1e-9) return { prof: cur, gate: curGate };
    const step = (cx, cz) => {
      const lx = clamp(cx, -env.limit, env.limit), lz = clamp(cz, -env.limit, env.limit);
      const prof = this._poseAllowed(env, cur, curGate, lx, lz, this.heading, lim);
      return prof ? { x: lx, z: lz, prof } : null;
    };
    let hit = step(this.x + dx, this.z + dz);
    if (hit) {
      this.x = hit.x; this.z = hit.z;
      return { prof: hit.prof, gate: this._gateOk(env, this.x, this.z, this.heading) };
    }
    // 撞上障礙：沿邊緣法線投影滑動，其次嘗試單軸滑行
    const nrm = this._wallNormal(env.ground, clamp(this.x + dx, -env.limit, env.limit), clamp(this.z + dz, -env.limit, env.limit), this.heading, lim);
    if (nrm) {
      const into = dx * nrm[0] + dz * nrm[1];
      if (into > 0) hit = step(this.x + dx - into * nrm[0], this.z + dz - into * nrm[1]);
    }
    if (!hit) {
      const ax = step(this.x + dx, this.z), az = step(this.x, this.z + dz);
      hit = ax && (!az || Math.abs(dx) >= Math.abs(dz)) ? ax : az;
    }
    if (hit) {
      const frac = Math.hypot(hit.x - this.x, hit.z - this.z) / dist;
      this.x = hit.x; this.z = hit.z;
      this.speed *= Math.exp(-dt * 4 * (1 - frac));
      return { prof: hit.prof, gate: this._gateOk(env, this.x, this.z, this.heading) };
    }
    this.speed *= Math.exp(-dt * 10);
    return { prof: cur, gate: curGate };
  }

  // env.ground(x,z)：地面或障礙物的高度（海床為負值）；env.wave(x,z)：該處浪高；env.limit：活動範圍
  update(dt, env) {
    if (this.sinking) return this._sink(dt);
    const S = this.spec;
    const depth = -env.ground(this.x, this.z);
    const afloat = depth > S.draft * 0.9;
    this.aground = !afloat;
    const k = this.keys;

    const thrust = (k.w ? 1 : 0) - (k.s ? 0.45 : 0);
    this.throttle += (thrust - this.throttle) * (1 - Math.exp(-dt * 3));
    // 引擎吃油：油門開多大吃多少；沒油了只能慢慢漂
    if (this.fuel > 0) this.fuel = Math.max(0, this.fuel - S.burn * Math.abs(this.throttle) * dt);
    // 浪大的時候開不快（船一直在爬坡、砸進浪裡）：小船受的影響比大船大
    const slow = env.slow ? Math.min(0.6, env.slow(this.x, this.z) * (S.waveSlow ?? Math.min(1.4, 13 / S.len))) : 0;   // 大漁船噸位重，大浪也不減速
    // 擱淺了：引擎還能慢慢推（前進、倒車都行，約三成速度；沒油就用慢慢撐的），不然就永遠困在淺灘上（只准往不更淺且不碰硬障礙的方向移動）
    const target = afloat ? thrust * (this.fuel > 0 ? this.maxSpeed : DRIFT) * (1 - slow) : thrust * (this.fuel > 0 ? this.maxSpeed * 0.3 : DRIFT * 0.5);
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * (afloat ? 0.5 * (1 + 0.2 * this.engineLv) : 1.2)));

    // 方向盤：按著就打過去，放開自動回正；船越短轉得越靈活
    const turn = (k.d ? 1 : 0) - (k.a ? 1 : 0);
    this.rudder += (turn - this.rudder) * (1 - Math.exp(-dt * (turn ? 2.2 : 1.6)));
    // 漩渦或水龍捲在附近：船被往中心拉、帶著繞圈，船頭也跟著被扭
    const flow = afloat && env.flow ? env.flow(this.x, this.z) : null;
    const lim = -S.draft * 0.7;
    let fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    let cur = this.hullProfile(env.ground, this.x, this.z, this.heading);
    let curGate = this._gateOk(env, this.x, this.z, this.heading);

    // 不會倒退或前進開上岸、撞進棧橋或卡住洞口；綁著纜繩停泊時不受外圍水流拖跑
    const vx = fx * this.speed + (flow && !this.moor ? flow.x : 0), vz = fz * this.speed + (flow && !this.moor ? flow.z : 0);
    this.moveSpeed = this.aground ? Math.abs(this.speed) : Math.hypot(vx, vz);
    const dx = vx * dt, dz = vz * dt;
    const mv = this._tryMove(env, cur, curGate, dx, dz, dt, lim);
    cur = mv.prof; curGate = mv.gate;

    // 轉向與水流扭轉：不許把船首或船尾擺進棧橋或岸壁（擱淺時仍可往深水處掰回）
    const authority = (afloat ? clamp(Math.abs(this.speed) / 3, 0.12, 1) : 0.3) * (this.speed < -0.2 ? -1 : 1);
    const dSpin = this.rudder * 0.55 * (S.turnRate ?? Math.sqrt(13 / S.len)) * dt * authority + (flow && !this.moor ? flow.spin * dt : 0);
    if (dSpin) {
      let spin = dSpin;
      if (!this._poseAllowed(env, cur, curGate, this.x, this.z, this.heading + spin, lim)) {
        spin = dSpin * 0.5;
        if (!this._poseAllowed(env, cur, curGate, this.x, this.z, this.heading + spin, lim)) spin = 0;
      }
      if (spin) { this.heading += spin; fx = Math.cos(this.heading); fz = Math.sin(this.heading); }
    }
    const rx = -fz, rz = fx;

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
    this.jolt = Math.max((this.jolt || 0) * Math.exp(-dt * 3), (Math.abs(this._wp) + Math.abs(this._wr)) / JOLT_K * (S.joltMul ?? 1));

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
      if (stress > 0) this.hurt(stress * HURT_K * (S.hurtMul ?? 1) * dt);
      // 往低的那一側翻：roll > 0 是右舷被抬高
      const blown = flow && Math.hypot(flow.wx, flow.wz) > 0.3;   // 是被水龍捲的風吹翻的，不是浪
      if (blown && (ar > CAPSIZE_ROLL || ap > CAPSIZE_PITCH)) this.founder('spout', this.roll > 0 ? -1 : 1);
      else if (this.hp <= 0) this.founder(over > 0 ? 'capsize' : 'flood', this.roll > 0 ? -1 : 1);
      if (this.sinking) return;
    }

    this._pose();
  }

  // 由船首方向與水面法線組出姿態，再擺好船上會動的東西
  _pose() {
    const S = this.spec, fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    if (this.parts.radarBar) this.parts.radarBar.rotation.y = (performance.now() / 1000 * 2.4) % (Math.PI * 2);   // 大漁船的雷達一直轉
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
        // 舵手雙手握在方向盤兩側，跟著轉一小段。第三人稱握三點和九點鐘（方向盤在她胸口高度，手剛好搆到）；
        // 第一人稱握偏上（兩點和十點鐘），從眼睛看得到
        const fp = this.fpHelm, turnA = clamp(this.rudder * 2.6, -0.5, 0.5);
        for (const arm of arms) {
          const ang = arm.userData.side * (fp ? 1.05 : 1.45) + turnA;
          this._d.set(P.wheelPos.x - P.helmsman.position.x - 0.03, P.wheelPos.y - S.deck + Math.cos(ang) * WHEEL_R, Math.sin(ang) * WHEEL_R).sub(arm.userData.base);
          const len = this._d.length();
          arm.quaternion.setFromUnitVectors(DOWN, this._d.divideScalar(len));
          arm.userData.stretch(len / P.helmsman.userData.armLen);
        }
      } else {
        // 小舢舨：右手往後握著舵柄
        arms[0].rotation.set(0.36, 0, 0.15);   // 左手垂在身旁，往外張開一點（不然會插進裙子）
        arms[1].rotation.set(0, 0, -0.75 + this.rudder * 0.25);
      }
    }
  }

  // ---- 多人 ----
  // 自己的船現在的狀態，送給伺服器轉給別人：[x, z, 航向, 高度, 傾斜 x, z, 船速, 舵, 油門, 狀態（1 燈開著、2 有人掌舵、4 擱淺、8 集魚燈開著、16 綁著岸上的纜繩）, 油量, 耐久（0–1）]
  netState() {
    const r = (v, k = 100) => Math.round(v * k) / k, n = this.normal;
    return [r(this.x), r(this.z), r(this.heading, 1000), r(this.y), r(n.x, 1000), r(n.z, 1000), r(this.speed), r(this.rudder), r(this.throttle),
      (this.lampOn ? 1 : 0) | (this.manned ? 2 : 0) | (this.aground ? 4 : 0) | (this.fishLamp ? 8 : 0) | (this.moor ? 16 : 0), r(this.fuel, 10), r(this.hp / this.spec.hp)];
  }

  // 別人的船：收到船主傳來的狀態。第一次、或一下子差太遠（換了停船格）就直接放過去
  setNet(s, snap = false) {
    const first = !this.net;
    this.net = s; this.netAge = 0;
    this.lampOn = !!(s[9] & 1);
    this.fishLamp = !!(s[9] & 8);
    this.tied = !!(s[9] & 16);   // 別人的船綁著岸上的纜繩（撞到它不會讓）
    if (!!(s[9] & 2) !== this.manned && !this.sinking) this.setManned(!!(s[9] & 2));
    if (first || snap || Math.hypot(s[0] - this.x, s[1] - this.z) > 30) {
      this.x = s[0]; this.z = s[1]; this.heading = s[2]; this.y = s[3];
      this.normal.set(s[4], Math.sqrt(Math.max(0.01, 1 - s[4] * s[4] - s[5] * s[5])), s[5]);
      this._pose();
    }
  }

  // 別人的船每一幀：物理是船主那邊算的，這裡只把收到的狀態平滑地補到位。
  // 補的目標是「他現在大概在哪」：最後一筆狀態，加上這段時間照船速往前走的距離（最多往前推半秒）
  updateRemote(dt) {
    if (this.sinking) return this._sink(dt);
    const s = this.net;
    if (!s) return;
    this.netAge += dt;
    const lead = Math.min(this.netAge, 0.5), k = 1 - Math.exp(-dt * 10), n = this.normal;
    const tx = s[0] + Math.cos(s[2]) * s[6] * lead, tz = s[1] + Math.sin(s[2]) * s[6] * lead;
    this.x += (tx - this.x) * k; this.z += (tz - this.z) * k; this.y += (s[3] - this.y) * k;
    this.heading += Math.atan2(Math.sin(s[2] - this.heading), Math.cos(s[2] - this.heading)) * k;
    const nx = n.x + (s[4] - n.x) * k, nz = n.z + (s[5] - n.z) * k;
    n.set(nx, Math.sqrt(Math.max(0.01, 1 - nx * nx - nz * nz)), nz);
    this.speed = s[6]; this.rudder += (s[7] - this.rudder) * k; this.throttle += (s[8] - this.throttle) * k;
    this.aground = !!(s[9] & 4); this.fuel = s[10];
    this._pose();
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

  // 船身座標 (lx, lz) 是否在實際畫出的甲板內。甲板沿船殼各段的端點線性連接。
  deckContains(lx, lz) {
    const S = this.spec;
    if (lx < -S.len / 2 || lx > S.len / 2) return false;
    return Math.abs(lz) <= this.deckHalfWidth(lx);
  }

  deckHalfWidth(lx) {
    const S = this.spec, t = clamp((lx + S.len / 2) / S.len, 0, 1), u = t * HULL_SEGMENTS, i = Math.min(HULL_SEGMENTS - 1, Math.floor(u)), f = u - i;
    return (halfBeam(S, i / HULL_SEGMENTS) * (1 - f) + halfBeam(S, (i + 1) / HULL_SEGMENTS) * f) * RAIL_WIDTH * DECK_WIDTH;
  }

  // 到船首、船尾或舷邊的局部軸向距離；負值表示超出甲板。
  deckClearance(lx, lz) {
    return Math.min(lx + this.spec.len / 2, this.spec.len / 2 - lx, this.deckHalfWidth(lx) - Math.abs(lz));
  }

  // 舷牆頂離甲板多高（跟 hullSection 的外形使用同一公式）。
  railHeightAt(lx) {
    const S = this.spec, t = clamp((lx + S.len / 2) / S.len, 0, 1), u = t * HULL_SEGMENTS, i = Math.min(HULL_SEGMENTS - 1, Math.floor(u)), f = u - i;
    return (railRise(S, i / HULL_SEGMENTS) * (1 - f) + railRise(S, (i + 1) / HULL_SEGMENTS) * f) / this.normal.y;
  }

  onHatch(lx, lz) {
    const h = this.spec.hatch;
    return !!h && Math.abs(lx - h.x) <= h.s / 2 && Math.abs(lz) <= h.s / 2;
  }

  // 船身座標 (lx, lz) 處的甲板或艙蓋表面高度（相對於船原點）
  deckLocalY(lx, lz) {
    return this.spec.deck + (this.onHatch(lx, lz) ? 0.28 : 0);
  }

  // 艙蓋是甲板上的實體箱蓋；人可以踩上它。
  walkDeckY(x, z) {
    const y = this.deckY(x, z);
    if (!this.spec.hatch) return y;
    const l = this.toLocal(x, z);
    return this.onHatch(l.x, l.z) ? y + 0.28 / this.normal.y : y;
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
