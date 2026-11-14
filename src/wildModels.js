// 海上的生物模型（海鷗、海豚、海龜、魚群、螃蟹、鯨魚、鯊魚背鰭）。只有數字和幾何，不碰行為（行為在 wildlife.js）。
// 風格跟魚一樣：低面平塗（每個面一個顏色、flatShading），顏色畫在頂點上，所有生物共用同一個材質。
// 座標：+x 是頭的方向、+y 向上、z 是左右；每一種的長度（公尺）寫在各自的 make 函式上面。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
export const wildMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });

// ---- 小工具 ---------------------------------------------------------------
const C = (c) => (c.isColor ? c : new THREE.Color(c));
const shade = (c, k) => C(c).clone().multiplyScalar(k);

// 把一個幾何轉成「每個面獨立」的，並依 fn(x, y, z, nx, ny, nz) 給每個頂點上色（fn 回傳顏色或色碼）。
// 用面的法線，所以顏色會一塊一塊的，正好是低面的味道
export function paint(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3), tmp = new THREE.Color();
  for (let i = 0; i + 2 < p.count; i += 3) {   // 一個三角形一個顏色（用三個頂點的平均位置），才是一塊一塊的低面
    let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { x += p.getX(i + k) / 3; y += p.getY(i + k) / 3; z += p.getZ(i + k) / 3; nx += n.getX(i + k) / 3; ny += n.getY(i + k) / 3; nz += n.getZ(i + k) / 3; }
    const c = typeof fn === 'function' ? fn(x, y, z, nx, ny, nz) : fn;
    tmp.set(c.isColor ? c : C(c));
    for (let k = 0; k < 3; k++) tmp.toArray(col, (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const merge = (list) => mergeGeometries(list.map((g) => {
  if (g.index) g = g.toNonIndexed();
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}), false);

// 橢圓斷面的身體：stations 由後往前（x 遞增）：{ x, ry 半高, rz 半寬, cy 中心高度 }，n 邊形。兩頭用扇形收口
export function bodyGeo(stations, n = 10) {
  const pos = [], idx = [];
  for (const s of stations) for (let i = 0; i < n; i++) { const a = i / n * TAU; pos.push(s.x, (s.cy ?? 0) + s.ry * Math.sin(a), s.rz * Math.cos(a)); }
  const rings = stations.length;
  for (let j = 0; j < rings - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = (j + 1) * n + i, c = (j + 1) * n + (i + 1) % n, d = j * n + (i + 1) % n;
    idx.push(a, b, d, b, c, d);
  }
  const cap = (j, flip) => {
    const s = stations[j], ci = pos.length / 3; pos.push(s.x, s.cy ?? 0, 0);
    for (let i = 0; i < n; i++) { const a = j * n + i, b = j * n + (i + 1) % n; if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); }
  };
  cap(0, false); cap(rings - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
}

// 一片薄板：pts 是 3D 點（照順序圍成一圈，從第 0 個點扇形展開），兩面都看得到
export function sheetGeo(pts) {
  const pos = [];
  for (let i = 1; i < pts.length - 1; i++) pos.push(...pts[0], ...pts[i], ...pts[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
const mirrorZ = (pts) => pts.map(([x, y, z]) => [x, y, -z]);
const at = (g, x, y, z) => { g.translate(x, y, z); return g; };
const sph = (r, sx, sy, sz, w = 6, h = 5) => { const g = new THREE.SphereGeometry(r, w, h); g.scale(sx, sy, sz); return g; };
// 兩點之間的一根細棍（腳、觸鬚、鳥腿）
function limb(a, b, r0, r1, seg = 4) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true);   // 頂（r1）在 b 那頭
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}
const mk = (geo) => new THREE.Mesh(geo, wildMat);

// ============================================================================
// 海鷗：身長約 0.75 公尺（含尾）、展翅約 1.6 公尺。身體、頭、嘴、尾、眼睛合成一個；翅膀每幀重算（拍翅、收翅）；腳另一個（飛的時候收起來）
// ============================================================================
const GULL = {
  white: '#f6f6f1', back: '#a7b2bd', backDark: '#7f8c99', beak: '#f2c230', spot: '#d8402f', leg: '#e9894a', tip: '#23272d', eye: '#14161a', band: '#2a2e35',
};
// 翅膀的四個斷面：肩、肘、腕、尖。chord：[前緣, 後緣]（相對斷面中心的 x）
const WING = {
  shoulder: [0.07, 0.045, 0.05],
  links: [[0.3, [0.0, 0.06, 1]], [0.2, [-0.06, 0.0, 1]], [0.27, [-0.2, -0.07, 1]]],   // 長度、展開時的方向
  folded: [[0.1, [-0.5, -0.45, 0.35]], [0.08, [-1, -0.05, 0.1]], [0.1, [-1, 0, 0.05]]],   // 收起來：貼著身體往後
  chord: [[0.11, -0.13], [0.09, -0.14], [0.04, -0.12], [-0.07, -0.17]],
  topCol: ['#c8d0d7', '#aab4be', '#8995a1', GULL.tip], botCol: ['#fbfbf8', '#eef1f2', '#d8dde1', '#555b63'],
};
export function makeGull() {
  const W = GULL;
  const body = bodyGeo([
    { x: -0.3, ry: 0.006, rz: 0.006, cy: 0.012 }, { x: -0.23, ry: 0.03, rz: 0.026, cy: 0.012 }, { x: -0.11, ry: 0.066, rz: 0.058, cy: 0.012 },
    { x: 0.03, ry: 0.086, rz: 0.076, cy: 0.018 }, { x: 0.15, ry: 0.078, rz: 0.066, cy: 0.032 }, { x: 0.22, ry: 0.052, rz: 0.044, cy: 0.056 }, { x: 0.265, ry: 0.034, rz: 0.03, cy: 0.074 },
  ], 9);
  const paintedBody = paint(body, (x, y, z, nx, ny) => (ny > 0.35 && x > -0.26 && x < 0.13 ? (x < -0.1 ? W.backDark : W.back) : W.white));
  const head = paint(at(sph(0.05, 1.08, 1, 0.95, 8, 6), 0.31, 0.092, 0), W.white);
  const beakUp = paint(at(limb([0, 0, 0], [0.095, -0.004, 0], 0.017, 0.006, 5), 0.345, 0.086, 0), (x, y, z, nx, ny) => (x > 0.425 ? W.beak : W.beak));
  const beakTipSpot = paint(at(sph(0.009, 1.2, 0.7, 1, 4, 3), 0.418, 0.075, 0), W.spot);
  const eyes = [1, -1].map((s) => paint(at(sph(0.0095, 1, 1, 1, 5, 4), 0.332, 0.103, s * 0.043), W.eye));
  const brow = [1, -1].map((s) => paint(at(sph(0.015, 1.3, 0.55, 0.8, 5, 3), 0.328, 0.113, s * 0.04), W.white));
  // 尾巴：一片扇形，尾端一道黑帶
  const tail = paint(sheetGeo([[-0.27, 0.025, 0], [-0.43, 0.012, 0.062], [-0.46, 0.012, 0.0], [-0.43, 0.012, -0.062]]), (x) => (x < -0.4 ? W.band : x < -0.34 ? '#dfe3e6' : W.white));
  const base = merge([paintedBody, head, beakUp, beakTipSpot, ...eyes, ...brow, tail]);
  const bodyMesh = mk(base);
  // 腳：兩條橘色的細腿加三趾腳掌（腳底在 y = -0.135）
  const legs = [];
  for (const s of [1, -1]) {
    legs.push(limb([0.02, 0.02, s * 0.034], [0.035, -0.12, s * 0.036], 0.008, 0.006, 4));
    legs.push(sheetGeo([[0.035, -0.128, s * 0.036], [0.095, -0.135, s * 0.062], [0.1, -0.135, s * 0.036], [0.095, -0.135, s * 0.01]]));
  }
  const legMesh = mk(paint(merge(legs), W.leg));
  // 翅膀：兩片（左右）合成一個幾何，每幀由 setGullWings 改頂點
  const wingGeo = new THREE.BufferGeometry();
  const quads = 3, verts = quads * 2 * 3 * 2 * 2;   // 3 段 × 上下兩層 × 每層 2 個三角形 × 兩邊
  wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  wingGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  const col = new Float32Array(verts * 3), tmp = new THREE.Color();
  let vi = 0;
  for (let side = 0; side < 2; side++) for (let layer = 0; layer < 2; layer++) for (let q = 0; q < quads; q++) for (let t = 0; t < 6; t++) {
    // 每個四邊形兩個三角形：(lead k, trail k, lead k+1) (trail k, trail k+1, lead k+1)
    const sec = q + (t === 2 || t === 4 || t === 5 ? 1 : 0);
    tmp.set((layer === 0 ? WING.topCol : WING.botCol)[sec]).toArray(col, vi * 3); vi++;
  }
  wingGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const wings = mk(wingGeo);
  wings.frustumCulled = false;
  const g = new THREE.Group();
  g.add(bodyMesh, wings, legMesh);
  g.userData = { wings, legs: legMesh, wingGeo, kind: 'gull' };
  setGullWings(g, 0, 0, 0);
  return g;
}
const _v = new THREE.Vector3();
// flap：翅膀根部抬起的角度（弧度，正的往上）；lag：翼尖比根部多（慢）轉的角度；fold：0 展開、1 收在身邊
export function setGullWings(g, flap, lag, fold) {
  const geo = g.userData.wingGeo, P = geo.attributes.position.array;
  let o = 0;
  for (let side = 0; side < 2; side++) {
    const sg = side ? -1 : 1;
    // 四個斷面的中心
    const cx = [], cy = [], cz = [];
    let x = WING.shoulder[0], y = WING.shoulder[1], z = sg * WING.shoulder[2];
    cx.push(x); cy.push(y); cz.push(z);
    for (let k = 0; k < 3; k++) {
      const open = WING.links[k], fd = WING.folded[k];
      let dx = open[1][0] * (1 - fold) + fd[1][0] * fold, dy = open[1][1] * (1 - fold) + fd[1][1] * fold, dz = open[1][2] * (1 - fold) + fd[1][2] * fold;
      const len = open[0] * (1 - fold) + fd[0] * fold, m = Math.hypot(dx, dy, dz) || 1;
      dx /= m; dy /= m; dz /= m;
      const th = (k === 0 ? flap : flap + lag * (k === 1 ? 0.6 : 1)) * (1 - fold), c = Math.cos(th), s = Math.sin(th);
      const ny = dy * c + dz * s, nz = -dy * s + dz * c;   // 繞 x 軸轉：th > 0 往上抬
      x += dx * len; y += ny * len; z += sg * nz * len;
      cx.push(x); cy.push(y); cz.push(z);
    }
    const shrink = 1 - 0.35 * fold;
    const lead = (k) => [cx[k] + WING.chord[k][0] * shrink, cy[k], cz[k]], trail = (k) => [cx[k] + WING.chord[k][1] * shrink, cy[k], cz[k]];
    for (let layer = 0; layer < 2; layer++) for (let q = 0; q < 3; q++) {
      const a = lead(q), b = trail(q), c2 = lead(q + 1), d = trail(q + 1);
      // 材質兩面都畫、又是 flatShading（法線在著色器裡算），所以繞向不用管
      for (const p of [a, b, c2, b, d, c2]) { P[o++] = p[0]; P[o++] = p[1] + (layer ? -0.004 : 0.004); P[o++] = p[2]; }
    }
  }
  geo.attributes.position.needsUpdate = true;
}

// ============================================================================
// 海豚：身長約 2.8 公尺（嘴尖到尾鰭後緣）。前身（頭到肚子）、後身（尾柄，繞肚子後面轉）、尾鰭（繞尾柄末端轉）三個零件
// ============================================================================
const DOL = { back: '#566b7d', flank: '#7e95a6', belly: '#e9eff2', fin: '#42525f', eye: '#0e1114', lip: '#aebdc7' };
const dolColor = (x, y, z, nx, ny) => (ny > 0.45 ? DOL.back : ny > -0.2 ? DOL.flank : DOL.belly);
export const DOLPHIN = { pivot: -0.2, tailAt: -0.95 };   // 後身繞 x = pivot；尾鰭繞 pivot + tailAt
export function makeDolphin() {
  const front = bodyGeo([
    { x: -0.2, ry: 0.2, rz: 0.17 }, { x: 0.1, ry: 0.27, rz: 0.22, cy: 0.02 }, { x: 0.45, ry: 0.27, rz: 0.215, cy: 0.03 }, { x: 0.8, ry: 0.22, rz: 0.17, cy: 0.03 },
    { x: 1.0, ry: 0.17, rz: 0.12, cy: 0.035 }, { x: 1.12, ry: 0.11, rz: 0.085, cy: 0.025 }, { x: 1.2, ry: 0.075, rz: 0.06, cy: -0.01 }, { x: 1.28, ry: 0.04, rz: 0.045, cy: -0.04 },
    { x: 1.38, ry: 0.02, rz: 0.03, cy: -0.05 }, { x: 1.42, ry: 0.01, rz: 0.015, cy: -0.05 },
  ], 10);
  const parts = [paint(front, (x, y, z, nx, ny) => (x > 1.18 && ny < 0.1 ? DOL.lip : dolColor(x, y, z, nx, ny)))];
  // 背鰭：往後彎的鐮刀形（兩層薄板疊出一點厚度）
  const dorsal = [[0.36, 0.25, 0], [0.22, 0.46, 0], [0.05, 0.6, 0], [0.12, 0.4, 0], [-0.05, 0.24, 0]];
  parts.push(paint(sheetGeo(dorsal.map(([x, y]) => [x, y, 0.012])), DOL.fin), paint(sheetGeo(dorsal.map(([x, y]) => [x, y, -0.012])), DOL.fin));
  // 胸鰭：往後下方划出去的一片
  for (const s of [1, -1]) parts.push(paint(sheetGeo([[0.66, -0.12, s * 0.17], [0.42, -0.2, s * 0.2], [0.3, -0.42, s * 0.46], [0.5, -0.32, s * 0.4]]), DOL.fin));
  for (const s of [1, -1]) {
    parts.push(paint(at(sph(0.022, 1, 1, 0.6, 6, 4), 1.02, 0.1, s * 0.115), DOL.eye));
  }
  const frontMesh = mk(merge(parts));
  const rear = bodyGeo([
    { x: -0.9, ry: 0.055, rz: 0.04 }, { x: -0.6, ry: 0.085, rz: 0.058 }, { x: -0.3, ry: 0.14, rz: 0.105 }, { x: 0, ry: 0.2, rz: 0.17 },
  ], 8);
  const rearMesh = mk(paint(rear, dolColor));
  // 尾鰭：左右兩片月牙（中間有缺口），在尾柄末端
  const fl = [[0.03, 0, 0.04], [-0.05, 0, 0.16], [-0.26, 0, 0.44], [-0.2, 0, 0.22], [-0.1, 0, 0.03]];
  const fluke = mk(paint(merge([sheetGeo(fl), sheetGeo(mirrorZ(fl))]), (x, y, z) => (Math.abs(z) > 0.3 ? shade(DOL.fin, 0.85) : DOL.fin)));
  const g = new THREE.Group(), rearG = new THREE.Group(), flukeG = new THREE.Group();
  rearG.position.x = DOLPHIN.pivot;
  rearG.add(rearMesh);
  flukeG.position.x = DOLPHIN.tailAt;
  flukeG.add(fluke);
  rearG.add(flukeG);
  g.add(frontMesh, rearG);
  g.userData = { rear: rearG, fluke: flukeG, kind: 'dolphin' };
  return g;
}

// ============================================================================
// 鯨魚：身長約 14 公尺（座頭鯨的味道）。前身、後身（繞身體中段轉）、尾鰭（繞尾柄末端轉）
// ============================================================================
const WH = { back: '#2f4152', flank: '#46596d', belly: '#e4e9ed', groove: '#c3ccd5', fin: '#33465a', finBelly: '#dfe6eb' };
export const WHALE = { pivot: 0, tailAt: -6.4 };
export function makeWhale() {
  const color = (x, y, z, nx, ny) => (ny > 0.45 ? WH.back : ny > -0.25 ? WH.flank : (x > 0 && Math.floor((z + 3) * 2.2) % 2 ? WH.groove : WH.belly));
  const front = bodyGeo([
    { x: 0, ry: 1.5, rz: 1.35 }, { x: 1.5, ry: 1.6, rz: 1.45 }, { x: 3.0, ry: 1.5, rz: 1.5, cy: -0.05 }, { x: 4.5, ry: 1.3, rz: 1.5, cy: -0.15 },
    { x: 5.8, ry: 1.0, rz: 1.3, cy: -0.2 }, { x: 6.8, ry: 0.55, rz: 0.9, cy: -0.25 }, { x: 7.3, ry: 0.25, rz: 0.5, cy: -0.25 },
  ], 12);
  const parts = [paint(front, color)];
  // 頭上的幾顆藤壺（淺色小疙瘩），讓頭不是一整塊平的
  for (const [x, y, z] of [[6.2, 0.75, 0.5], [5.7, 0.95, -0.4], [6.7, 0.35, -0.2], [6.5, 0.55, 0.15], [5.2, 1.05, 0.2]]) parts.push(paint(at(sph(0.17, 1.2, 0.6, 1.1, 5, 4), x, y, z), '#9ba7ad'));
  // 背鰭：一個小小的駝峰
  parts.push(paint(sheetGeo([[-1.0, 1.28, 0.015], [-1.6, 1.85, 0.015], [-2.2, 1.18, 0.015]]), WH.fin), paint(sheetGeo([[-1.0, 1.28, -0.015], [-1.6, 1.85, -0.015], [-2.2, 1.18, -0.015]]), WH.fin));
  // 胸鰭：又長又白（腹面）的大鰭
  for (const s of [1, -1]) parts.push(paint(sheetGeo([[3.0, -0.9, s * 1.25], [2.2, -1.0, s * 1.3], [0.9, -2.1, s * 3.4], [1.8, -1.7, s * 3.0]]), (x, y, z) => (Math.abs(z) > 2.4 ? WH.finBelly : WH.fin)));
  for (const s of [1, -1]) parts.push(paint(at(sph(0.08, 1, 1, 0.7, 6, 4), 5.0, 0.15, s * 1.36), '#0d1114'));
  const frontMesh = mk(merge(parts));
  const rear = bodyGeo([
    { x: -6.3, ry: 0.28, rz: 0.2 }, { x: -5.4, ry: 0.4, rz: 0.28 }, { x: -4.4, ry: 0.6, rz: 0.45 }, { x: -3, ry: 0.9, rz: 0.75 }, { x: -1.5, ry: 1.25, rz: 1.1 }, { x: 0, ry: 1.5, rz: 1.35 },
  ], 12);
  const rearMesh = mk(paint(rear, color));
  // 尾鰭：寬約 4.6 公尺，後緣有缺口
  const fl = [[0.1, 0, 0.18], [-0.4, 0, 0.6], [-1.3, 0, 2.2], [-1.0, 0, 1.0], [-0.55, 0, 0.12]];
  const fluke = mk(paint(merge([sheetGeo(fl), sheetGeo(mirrorZ(fl))]), (x, y, z) => (Math.abs(z) > 1.4 ? WH.finBelly : WH.fin)));
  const g = new THREE.Group(), rearG = new THREE.Group(), flukeG = new THREE.Group();
  rearG.add(rearMesh);
  flukeG.position.x = WHALE.tailAt; flukeG.add(fluke); rearG.add(flukeG);
  g.add(frontMesh, rearG);
  g.userData = { rear: rearG, fluke: flukeG, kind: 'whale' };
  return g;
}

// ============================================================================
// 海龜：甲長約 0.95 公尺。身體（甲＋頭＋脖子）一個、四隻鰭各一個（繞肩膀拍動）
// ============================================================================
const TU = { shellA: '#6f7d3a', shellB: '#59672f', shellC: '#8a7b43', plastron: '#e6dcae', skin: '#8c9b55', skinD: '#6c7a40', eye: '#101214' };
const hash2 = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
export function makeTurtle() {
  const shell = new THREE.SphereGeometry(1, 10, 6);
  const p = shell.attributes.position;
  for (let i = 0; i < p.count; i++) { let y = p.getY(i); if (y < 0) y *= 0.3; p.setY(i, y * 0.2); p.setX(i, p.getX(i) * 0.5); p.setZ(i, p.getZ(i) * 0.4); }
  const shellP = paint(shell, (x, y, z, nx, ny) => {
    if (ny < -0.35) return TU.plastron;
    const h = hash2(Math.floor(x * 7), Math.floor(z * 7));
    return h < 0.34 ? TU.shellB : h < 0.7 ? TU.shellA : TU.shellC;
  });
  const parts = [shellP];
  // 脖子和頭
  parts.push(paint(at(sph(0.1, 1.5, 0.8, 0.8, 7, 5), 0.5, 0.02, 0), (x, y, z, nx, ny) => (ny > 0.3 ? TU.skinD : TU.skin)));
  parts.push(paint(limb([0.34, 0.0, 0], [0.46, 0.02, 0], 0.07, 0.055, 6), TU.skin));
  for (const s of [1, -1]) parts.push(paint(at(sph(0.014, 1, 1, 1, 5, 4), 0.55, 0.055, s * 0.055), TU.eye));
  parts.push(paint(sheetGeo([[0.57, 0.0, 0.03], [0.62, -0.015, 0], [0.57, 0.0, -0.03]]), '#7a8447'));
  // 尾巴
  parts.push(paint(sheetGeo([[-0.42, 0.0, 0.03], [-0.56, -0.02, 0], [-0.42, 0.0, -0.03]]), TU.skin));
  const body = mk(merge(parts));
  const g = new THREE.Group();
  g.add(body);
  const flippers = [];
  const mkFlip = (pts, pos, s) => {
    const gr = new THREE.Group(), m = mk(paint(sheetGeo(s > 0 ? pts : mirrorZ(pts)), (x, y, z) => (Math.abs(z) > 0.3 ? TU.skinD : TU.skin)));
    gr.position.set(...pos); gr.add(m); g.add(gr); flippers.push({ g: gr, s, front: pos[0] > 0 });
  };
  for (const s of [1, -1]) {
    // 前鰭：大。根部窄、中段最寬、尖尖的末端往後彎，像一片樹葉
    mkFlip([[0.1, 0, 0.0], [0.13, -0.005, 0.12], [0.1, -0.015, 0.28], [0.0, -0.025, 0.46], [-0.16, -0.035, 0.66], [-0.17, -0.03, 0.5], [-0.17, -0.02, 0.3], [-0.12, -0.005, 0.1], [-0.08, 0, 0.0]], [0.2, -0.02, s * 0.28], s);
    mkFlip([[0.06, 0, 0.0], [0.07, -0.01, 0.1], [0.0, -0.02, 0.22], [-0.1, -0.025, 0.28], [-0.12, -0.015, 0.15], [-0.08, 0, 0.0]], [-0.3, -0.02, s * 0.22], s);   // 後鰭：小
  }
  g.userData = { flippers, kind: 'turtle' };
  return g;
}

// ============================================================================
// 螃蟹：甲寬約 0.22 公尺。身體（甲＋眼睛）一個、左右腳各一個、左右螯各一個
// ============================================================================
const CR = { shell: '#dd5a2b', top: '#ee7a3c', leg: '#c64a22', claw: '#ef6b32', tip: '#fff0d6', eye: '#111', stalk: '#e8a07a' };
export function makeCrab() {
  const shell = new THREE.SphereGeometry(1, 9, 5);
  const p = shell.attributes.position;
  for (let i = 0; i < p.count; i++) { let y = p.getY(i); if (y < 0) y *= 0.25; p.setY(i, y * 0.05); p.setX(i, p.getX(i) * 0.075); p.setZ(i, p.getZ(i) * 0.11); }
  const parts = [paint(shell, (x, y, z, nx, ny) => (ny > 0.55 ? CR.top : CR.shell))];
  for (const s of [1, -1]) {
    parts.push(paint(limb([0.05, 0.03, s * 0.045], [0.07, 0.07, s * 0.052], 0.006, 0.006, 4), CR.stalk));
    parts.push(paint(at(sph(0.0085, 1, 1, 1, 5, 4), 0.072, 0.078, s * 0.052), CR.eye));
  }
  const body = mk(merge(parts));
  const g = new THREE.Group();
  g.add(body);
  // 腳：每邊三條，兩段（先往外往上、再往外往下踩地）
  const legSide = (s) => {
    const list = [];
    for (let k = 0; k < 3; k++) {
      const x = 0.03 - k * 0.04, sw = (k - 1) * 0.015;
      list.push(limb([x, 0.015, s * 0.085], [x + sw, 0.055, s * 0.17], 0.007, 0.0055, 4), limb([x + sw, 0.055, s * 0.17], [x + sw * 1.6 - 0.01, -0.018, s * 0.25], 0.0055, 0.003, 4));
    }
    return mk(paint(merge(list), CR.leg));
  };
  const legL = legSide(1), legR = legSide(-1);
  // 螯：手臂＋大螯（掌＋上下兩片鉗），掛在身體前面兩側
  const clawSide = (s) => {
    const gr = new THREE.Group(), list = [];
    list.push(limb([0, 0, 0], [0.06, 0.035, s * 0.05], 0.011, 0.009, 5), at(sph(0.034, 1.2, 0.7, 1, 6, 4), 0.1, 0.04, s * 0.075),
      limb([0.12, 0.052, s * 0.078], [0.2, 0.07, s * 0.092], 0.016, 0.004, 5), limb([0.12, 0.028, s * 0.078], [0.19, 0.012, s * 0.1], 0.016, 0.004, 5));
    const m = mk(paint(merge(list), (x, y, z) => (x > 0.15 ? CR.tip : CR.claw)));
    gr.position.set(0.075, 0.02, s * 0.075); gr.add(m);
    return gr;
  };
  const clawL = clawSide(1), clawR = clawSide(-1);
  g.add(legL, legR, clawL, clawR);
  g.userData = { legL, legR, clawL, clawR, kind: 'crab' };
  return g;
}

// ============================================================================
// 魚群裡的小魚：長約 0.16 公尺，用 InstancedMesh（一群一次畫完）。顏色靠每條的 instanceColor 染
// ============================================================================
export function makeSchoolFish() {
  const body = paint(at(sph(0.5, 1.0, 0.42, 0.26, 6, 4), 0, 0, 0), (x, y, z, nx, ny) => (ny > 0.3 ? '#9fb6c8' : ny > -0.3 ? '#d8e3ea' : '#ffffff'));
  const tail = paint(sheetGeo([[-0.4, 0, 0], [-0.78, 0.26, 0], [-0.7, 0, 0], [-0.78, -0.26, 0]]), '#aebfcc');
  const eye = paint(at(sph(0.05, 1, 1, 1, 4, 3), 0.34, 0.07, 0.11), '#10141a');
  const eye2 = paint(at(sph(0.05, 1, 1, 1, 4, 3), 0.34, 0.07, -0.11), '#10141a');
  const g = merge([body, tail, eye, eye2]);
  g.scale(0.16, 0.16, 0.16);
  return g;
}

// ============================================================================
// 鯊魚的背鰭（和一小段尾鰭上緣）：露出水面的部分，約高 0.8 公尺
// ============================================================================
export function makeSharkFin() {
  const fin = new THREE.ConeGeometry(0.17, 0.85, 4, 4);
  const p = fin.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 0.425, k = y / 0.85; p.setY(i, y); p.setX(i, p.getX(i) * 1.6 - k * k * 0.32); p.setZ(i, p.getZ(i) * 0.3); }
  const tail = paint(sheetGeo([[-1.7, -0.02, 0], [-2.05, 0.5, 0], [-2.2, 0.0, 0]]), '#4a5560');
  const g = merge([paint(fin, (x, y) => (y > 0.5 ? '#3d4852' : '#556270')), tail]);
  const m = mk(g);
  const grp = new THREE.Group();
  grp.add(m);
  grp.userData = { kind: 'fin' };
  return grp;
}

export function disposeWild(obj) {
  obj.traverse((o) => { if (o.isMesh && !o.userData.shared) o.geometry.dispose(); });
}
