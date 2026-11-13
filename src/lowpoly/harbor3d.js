// 小島漁港的 3D：照 harborPlan.js 的配置，全部用低面平塗做。
// 不會動的（岸壁、防波堤、建築、燈、旗）合成一個網格；會重複很多個的（消波塊、船、繫船柱、木箱、樹、岩石、草）用樣板＋實例。
import * as THREE from 'three';
import { FaceBuilder, rng, mirrored } from './kit.js';
import { jitter } from './palette.js';
import { rockGeo, broadleafGeo, tuftGeo, terrainGeo, groundKind } from './shapes.js';
import * as H from './harborPlan.js';
import { BOAT_TYPES } from '../boatdata.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 島的形狀（高度、平台、港池）放在 homeShape.js：遊戲和伺服器也要用，不能引入 three.js
import { onPlatform, inBasin, harborHeight, homeBed, segDist } from './homeShape.js';
export { onPlatform, inBasin, harborHeight, homeBed };
const nearPlatform = (x, z, d) => [[d, 0], [-d, 0], [0, d], [0, -d]].some(([a, b]) => onPlatform(x + a, z + b));

// 點到折線的距離（小路上色用）
function distToPath(x, z, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// ---- 方塊：上面一個顏色、側面一個顏色（同一面的兩個三角形同色）----
function box(fb, x0, x1, y0, y1, z0, z1, top, side, r, amt = 0.04) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const cache = new Map();
  fb.addGeometry(g, (m, n) => {
    const k = Math.round(n.x * 3) * 9 + Math.round(n.y * 3) * 3 + Math.round(n.z * 3);
    if (!cache.has(k)) cache.set(k, jitter(n.y > 0.5 ? top : side, r, amt));
    return cache.get(k);
  });
}
// 一段線（平台外緣）往外海的方向
function outward(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  let nx = -dz / L, nz = dx / L;
  if (nx * ((a[0] + b[0]) / 2) + nz * ((a[1] + b[1]) / 2 - 20) < 0) { nx = -nx; nz = -nz; }
  return [nx, nz, dx / L, dz / L, L];
}
// 沿著一段線立一道牆，牆往平台內側長 t 公尺
function segWall(fb, a, b, t, y0, y1, col, r) {
  const [nx, nz, ux, uz, L] = outward(a, b);
  const g = new THREE.BoxGeometry(L, y1 - y0, t);
  g.rotateY(Math.atan2(-uz, ux));
  g.translate((a[0] + b[0]) / 2 - nx * t / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2 - nz * t / 2);
  const c = jitter(col, r, 0.03);
  fb.addGeometry(g, (m, n) => (n.y > 0.5 ? c : c.clone().multiplyScalar(0.92)));
}

// 港池邊緣一道矮矮的壓頂（往平台那一側長 t 公尺）
function segCurb(fb, a, b, t, y0, y1, col, r) {
  const [nx, nz, ux, uz, L] = outward(a, b);
  const g = new THREE.BoxGeometry(L, y1 - y0, t);
  g.rotateY(Math.atan2(-uz, ux));
  g.translate((a[0] + b[0]) / 2 + nx * t / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2 + nz * t / 2);
  const c = jitter(col, r, 0.03);
  fb.addGeometry(g, (m, n) => (n.y > 0.5 ? c : c.clone().multiplyScalar(0.9)));
}

// 斜屋頂：兩片斜面（屋脊沿 x）
function gableRoof(fb, x0, x1, z0, z1, y0, rise, over, col, r) {
  const zm = (z0 + z1) / 2, a = V(x0 - over, y0, z0 - over), b = V(x1 + over, y0, z0 - over), c = V(x1 + over, y0 + rise, zm), d = V(x0 - over, y0 + rise, zm);
  const e = V(x0 - over, y0, z1 + over), f = V(x1 + over, y0, z1 + over);
  const c1 = jitter(col, r, 0.03), c2 = jitter(col, r, 0.03).multiplyScalar(0.86);
  fb.tri(a, d, c, c1); fb.tri(a, c, b, c1);        // 北坡
  fb.tri(e, f, c, c2); fb.tri(e, c, d, c2);        // 南坡
  fb.tri(d, a, e, c1); fb.tri(c, f, b, c1);        // 兩端山牆的三角形（從外面看）
  // 屋簷底面（從下面看也看得到）
  fb.tri(a, b, f, c2); fb.tri(a, f, e, c2);
}

// ---- 船：低面的船殼（船首尖、船尾平）、舷牆、甲板；漁船和大漁船加駕駛艙 ----
// 座標：+x 船首、+y 上、原點在水線中央
export function boatGeo(type, P, hullCol, seed) {
  const T = BOAT_TYPES[type], r = rng(seed), fb = new FaceBuilder();
  const L = T.len, B = T.beam / 2;
  const st = [[0, 0.86], [0.2, 0.98], [0.5, 1], [0.72, 0.9], [0.88, 0.58], [1, 0]];   // [沿船長, 半寬比例]
  const pts = st.map(([t, w]) => {
    const x = -L / 2 + t * L, y = T.deck + T.rise * t * t;
    return { x, y, w: B * w, ch: -T.draft * 0.35, k: -T.draft * (t > 0.9 ? 0.6 : 1) };
  });
  const bottom = hullCol, top = P.white, deck = P.woodLight;   // 白色上半、彩色下半
  const out = (a, b, c, col, ref) => {   // 確保法線朝外
    const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    const m = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(m.sub(ref)) < 0) fb.tri(a, c, b, col); else fb.tri(a, b, c, col);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    for (const s of [-1, 1]) {
      const pe = V(p.x, p.y, s * p.w), qe = V(q.x, q.y, s * q.w);           // 舷緣
      const pc = V(p.x, p.ch, s * p.w * 0.9), qc = V(q.x, q.ch, s * q.w * 0.9);   // 舭（水線下）
      const pk = V(p.x, p.k, 0), qk = V(q.x, q.k, 0);                          // 龍骨
      const ref = V((p.x + q.x) / 2, 0, 0);
      const cTop = jitter(top, r, 0.03), cBot = jitter(bottom, r, 0.03);
      // 舷側分兩段：舷緣到水線上方一點是白色，再往下（露出水面的一截＋水線下）是船的顏色
      const band = (u) => Math.max(0.12, u.y * 0.45);
      const pm = V(p.x, band(p), s * p.w * 0.98), qm = V(q.x, band(q), s * q.w * 0.98);
      out(pe, qe, qm, cTop, ref); out(pe, qm, pm, cTop, ref);
      out(pm, qm, qc, cBot, ref); out(pm, qc, pc, cBot, ref);
      out(pc, qc, qk, cBot, ref); out(pc, qk, pk, cBot, ref);
      // 舷牆（薄板，兩面都畫）
      const pb = V(p.x, p.y + T.bul, s * p.w), qb = V(q.x, q.y + T.bul, s * q.w);
      const cb = jitter(top, r, 0.03).multiplyScalar(1.04);
      fb.tri(pe, qe, qb, cb); fb.tri(pe, qb, pb, cb); fb.tri(pe, qb, qe, cb.clone().multiplyScalar(0.85)); fb.tri(pe, pb, qb, cb.clone().multiplyScalar(0.85));
      // 甲板
      const dc = jitter(deck, r, 0.04);
      out(V(p.x, p.y, 0), pe, qe, dc, V(0, -10, 0)); out(V(p.x, p.y, 0), qe, V(q.x, q.y, 0), dc, V(0, -10, 0));
    }
  }
  // 船尾封板
  const p0 = pts[0], ref0 = V(0, 0, 0);
  for (const s of [-1, 1]) {
    const e = V(p0.x, p0.y + T.bul, s * p0.w), c = V(p0.x, p0.ch, s * p0.w * 0.9), k = V(p0.x, p0.k, 0), d0 = V(p0.x, p0.y + T.bul, 0);
    out(e, c, k, jitter(top, r, 0.03), ref0); out(e, k, d0, jitter(top, r, 0.03), ref0);
  }
  if (type === 'skiff') {
    box(fb, -L / 2 - 0.45, -L / 2 + 0.05, T.deck - 0.1, T.deck + 0.55, -0.22, 0.22, P.metal, P.metal, r);   // 外掛引擎
    box(fb, -0.6, 0.6, T.deck, T.deck + 0.12, -B * 0.8, B * 0.8, P.wood, P.wood, r);                          // 坐板
  } else {
    // 駕駛艙：船中偏後，白牆、深色窗、藍色屋頂；屋頂一根短桅
    const cx0 = -L * 0.12, cx1 = cx0 + L * 0.24, cw = B * 0.62, y0 = T.deck + T.rise * 0.2, ch = type === 'trawler' ? 2.3 : 2.0;
    box(fb, cx0, cx1, y0, y0 + ch, -cw, cw, P.white, P.white, r, 0.02);
    box(fb, cx1 - 0.02, cx1 + 0.03, y0 + ch * 0.55, y0 + ch * 0.85, -cw * 0.85, cw * 0.85, P.window, P.window, r, 0.01);
    for (const s of [-1, 1]) box(fb, cx0 + 0.3, cx1 - 0.3, y0 + ch * 0.55, y0 + ch * 0.85, s * cw - 0.03, s * cw + 0.03, P.window, P.window, r, 0.01);
    box(fb, cx0 - 0.25, cx1 + 0.25, y0 + ch, y0 + ch + 0.18, -cw - 0.2, cw + 0.2, P.cabinRoof, P.cabinRoof, r, 0.02);
    box(fb, cx0 + 0.6, cx0 + 0.78, y0 + ch, y0 + ch + 2.6, -0.09, 0.09, P.white, P.white, r);
    if (type === 'trawler') box(fb, -L * 0.42, -L * 0.3, T.deck, T.deck + 1.2, -B * 0.5, B * 0.5, P.metal, P.metal, r);   // 船尾的捲網機
  }
  return fb.build();
}

// 消波塊：中心伸出四隻往外變細的腳（正四面體的四個方向）
function tetrapodGeo(P, seed) {
  const fb = new FaceBuilder(), r = rng(seed);
  const dirs = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((d) => V(...d).normalize());
  const up = V(0, 1, 0);
  const cache = new Map();
  for (const d of dirs) {
    const g = new THREE.CylinderGeometry(0.3, 0.5, 1.35, 6, 1);
    g.translate(0, 0.62, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d));
    fb.addGeometry(g, (m, n) => {
      const k = Math.round(n.x * 5) * 121 + Math.round(n.y * 5) * 11 + Math.round(n.z * 5);
      if (!cache.has(k)) cache.set(k, jitter(P.tetra, r, 0.06));
      return cache.get(k);
    });
  }
  return fb.build();
}
function bollardGeo(P) {
  const fb = new FaceBuilder(), r = rng(3);
  const g1 = new THREE.CylinderGeometry(0.16, 0.2, 0.45, 7); g1.translate(0, 0.22, 0);
  const g2 = new THREE.CylinderGeometry(0.28, 0.22, 0.14, 7); g2.translate(0, 0.5, 0);
  fb.addGeometry(g1, () => jitter(P.hullRed, r, 0.05).multiplyScalar(0.7));
  fb.addGeometry(g2, () => jitter(P.hullRed, r, 0.05).multiplyScalar(0.8));
  return fb.build();
}
function crateGeo(col, w, h, d, seed) {
  const fb = new FaceBuilder();
  box(fb, -w / 2, w / 2, 0, h, -d / 2, d / 2, col, col.clone().multiplyScalar(0.86), rng(seed));
  return fb.build();
}
function floatGeo(P) {
  const fb = new FaceBuilder(), r = rng(9);
  const g = new THREE.IcosahedronGeometry(0.28, 0); g.translate(0, 0.25, 0);
  fb.addGeometry(g, () => jitter(P.float, r, 0.06));
  return fb.build();
}

// ---- 蓋整座港口島 ----
// game：放進遊戲裡用（船是遊戲自己的，不擺樣品船）。回傳給遊戲用的清單（港座標）：
//   tetrapods 消波塊、rocks 海岸的大岩石 { x, z, r, top }
export function buildHarbor({ P, r, place, mat, group, templates, game = false }) {
  const out = { tetrapods: [], rocks: [] };
  const D = H.DECK_Y, SEA = -3.2;
  const terrain = new THREE.Mesh(terrainGeo(P, 170, 2.0, 7, homeBed, 0, -6, null), mat);
  terrain.castShadow = terrain.receiveShadow = true;
  group.add(terrain);

  // 不會動的東西：合成一個網格
  const fb = new FaceBuilder();
  // 岸壁＋防波堤：U 形多邊形往下擠出到海底（上面水泥色、側面石頭色）
  {
    const shape = new THREE.Shape(H.PLATFORM.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: D - SEA, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); g.translate(0, SEA, 0);
    const cache = new Map();
    fb.addGeometry(g, (m, n) => {
      const k = Math.round(n.x * 20) * 1000 + Math.round(n.y * 20) * 40 + Math.round(n.z * 20);
      if (!cache.has(k)) cache.set(k, jitter(n.y > 0.5 ? P.concrete : P.stone, r, 0.04));
      return cache.get(k);
    });
  }
  // 面對外海的那幾段：胸牆；岸壁邊緣一圈淺色的壓頂
  for (const [a, b] of H.SEAWARD) segWall(fb, a, b, 0.8, D, D + 0.9, P.parapet, r);
  for (let i = 1; i < H.BASIN_EDGE.length - 2; i++) segCurb(fb, H.BASIN_EDGE[i], H.BASIN_EDGE[i + 1], 0.5, D, D + 0.12, P.parapet, r);
  // 擋土牆：石砌，一塊一塊凸出來
  box(fb, H.RETAIN.x0, H.RETAIN.x1, D - 0.5, D + H.RETAIN.h, H.RETAIN.z - 0.9, H.RETAIN.z, P.stone, P.stone, r);
  for (let x = H.RETAIN.x0 + 0.8; x < H.RETAIN.x1 - 0.5; x += 1.6 + r() * 0.5) {
    if (H.STAIRS.some((s) => Math.abs(x - s.x) < s.w / 2 + 0.8)) continue;
    for (let row = 0; row < 3; row++) {
      const y = D + 0.1 + row * 0.8 + r() * 0.1, w = 1.2 + r() * 0.5;
      box(fb, x - w / 2, x + w / 2, y, y + 0.65, H.RETAIN.z - 0.05, H.RETAIN.z + 0.12, P.stone, P.stone, r, 0.08);
    }
  }
  box(fb, H.RETAIN.x0 - 0.2, H.RETAIN.x1 + 0.2, D + H.RETAIN.h, D + H.RETAIN.h + 0.2, H.RETAIN.z - 1.1, H.RETAIN.z + 0.2, P.concrete, P.concreteSide, r);   // 牆頂的壓頂
  // 樓梯：貼著擋土牆前面往上爬，兩側一道斜邊的側牆
  for (const s of H.STAIRS) {
    const n = 13, top = D + H.RETAIN.h + 0.2, run = (s.z0 - s.z1) / n;
    for (let i = 0; i < n; i++) {
      const y = D + ((i + 1) / n) * (top - D), zf = s.z0 - i * run;
      box(fb, s.x - s.w / 2, s.x + s.w / 2, D - 0.1, y, s.z1 - 1.2, zf, P.concrete, P.concreteSide, r, 0.03);
    }
    for (const side of [-1, 1]) {
      const x0 = s.x + side * (s.w / 2 + 0.2);
      const pts = [[s.z0 + 0.3, D], [s.z1 - 1.2, D], [s.z1 - 1.2, top + 0.4], [s.z1 + 0.6, top + 0.4]];
      const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
      const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.4, bevelEnabled: false });
      eg.rotateY(-Math.PI / 2); eg.translate(x0 + 0.2, 0, 0);
      fb.addGeometry(eg, () => jitter(P.stone, r, 0.04));
    }
  }

  // 商店：木牆、深灰屋頂；正面西半邊開放（看得到店裡的貨架），東半邊掛三塊排行榜
  {
    const S = H.SHOP, top = D + S.h, t = 0.25;
    box(fb, S.x0, S.x1, D, top, S.z0, S.z0 + t, P.wood, P.wood, r);                 // 後牆
    box(fb, S.x0, S.x0 + t, D, top, S.z0, S.z1, P.wood, P.wood, r);                 // 西牆
    box(fb, S.x1 - t, S.x1, D, top, S.z0, S.z1, P.wood, P.wood, r);                 // 東牆
    box(fb, S.open.x1, S.x1, D, top, S.z1 - t, S.z1, P.wood, P.wood, r);            // 正面東半邊
    box(fb, S.x0, S.open.x1, D + 2.6, top, S.z1 - t, S.z1, P.wood, P.wood, r);      // 開口上方
    // 店裡賣東西的長桌（每樣商品一格，見 harborPlan.js 的 SHELF）
    box(fb, H.SHELF_X[0], H.SHELF_X[1], D + 0.78, D + 0.86, H.SHELF_Z - 0.45, H.SHELF_Z + 0.45, P.woodLight, P.woodDark, r);
    for (const x of [H.SHELF_X[0] + 0.15, H.SHELF_X[1] - 0.15]) for (const z of [H.SHELF_Z - 0.35, H.SHELF_Z + 0.35]) box(fb, x - 0.06, x + 0.06, D, D + 0.78, z - 0.06, z + 0.06, P.woodDark, P.woodDark, r);
    for (const x of [S.x0 + 0.1, S.open.x1 - 0.1, S.x1 - 0.1]) box(fb, x - 0.18, x + 0.18, D, top + 0.05, S.z1 - 0.2, S.z1 + 0.15, P.woodDark, P.woodDark, r);   // 柱子
    box(fb, S.x0 + t, S.x1 - t, D, D + 0.05, S.z0 + t, S.z1 - t, P.woodDark, P.woodDark, r);   // 地板
    gableRoof(fb, S.x0, S.x1, S.z0, S.z1, top, 1.9, 0.6, P.roofSlate, r);
    // 店裡：靠後牆兩排貨架，上面擺釣竿、油桶、工具箱、船模型
    for (const [x0, x1] of [[S.x0 + 0.6, S.x0 + 3.6], [S.x0 + 4.0, S.open.x1 - 0.4]]) {
      for (const y of [D + 0.1, D + 1.0, D + 1.9]) box(fb, x0, x1, y, y + 0.08, S.z0 + 0.3, S.z0 + 1.2, P.woodLight, P.woodLight, r);
      for (const x of [x0, x1 - 0.08]) box(fb, x, x + 0.08, D, D + 2.6, S.z0 + 0.3, S.z0 + 1.2, P.woodDark, P.woodDark, r);
    }
    for (let i = 0; i < 6; i++) box(fb, S.x0 + 0.9 + i * 0.45, S.x0 + 1.1 + i * 0.45, D + 0.18, D + 0.75, S.z0 + 0.6, S.z0 + 0.95, P.flagRed, P.flagRed, r);   // 紅色油桶
    for (let i = 0; i < 4; i++) box(fb, S.x0 + 0.9 + i * 0.7, S.x0 + 1.4 + i * 0.7, D + 1.08, D + 1.4, S.z0 + 0.5, S.z0 + 1.0, P.hullGreen, P.hullGreen, r);   // 工具箱
    for (let i = 0; i < 7; i++) box(fb, S.x0 + 4.4 + i * 0.35, S.x0 + 4.46 + i * 0.35, D + 0.2, D + 2.4, S.z0 + 0.5, S.z0 + 0.56, P.woodDark, P.woodDark, r);   // 立著的釣竿
    box(fb, S.x0 + 4.6, S.x0 + 6.2, D + 1.98, D + 2.35, S.z0 + 0.55, S.z0 + 1.0, P.white, P.hullBlue, r);   // 船模型
    if (!game) for (const b of H.BOARDS) {   // 遊戲裡的看板由 boards.js 另外立
      box(fb, b.x - b.w / 2 - 0.12, b.x + b.w / 2 + 0.12, b.y0 - 0.12, b.y0 + b.h + 0.12, S.z1, S.z1 + 0.1, P.yellow, P.yellow, r);
      box(fb, b.x - b.w / 2, b.x + b.w / 2, b.y0, b.y0 + b.h, S.z1 + 0.1, S.z1 + 0.14, P.woodDark, P.woodDark, r, 0.02);
    }
    box(fb, S.x0 + 0.4, S.x0 + 1.2, D + 2.0, D + 2.6, S.z1, S.z1 + 0.2, P.bulb, P.bulb, r);   // 門口的燈
  }
  // 魚市場棚：柱子、往南傾的鐵皮屋頂、桌上的魚箱
  {
    const M = H.MARKET;
    for (const x of [M.x0 + 0.3, (M.x0 + M.x1) / 2, M.x1 - 0.3]) for (const z of [M.z0 + 0.3, M.z1 - 0.3]) box(fb, x - 0.16, x + 0.16, D, D + M.h + (z < -8 ? 0.7 : 0), z - 0.16, z + 0.16, P.wood, P.wood, r);
    const a = V(M.x0 - 0.6, D + M.h + 0.85, M.z0 - 0.5), b = V(M.x1 + 0.6, D + M.h + 0.85, M.z0 - 0.5), c = V(M.x1 + 0.6, D + M.h - 0.1, M.z1 + 0.9), d = V(M.x0 - 0.6, D + M.h - 0.1, M.z1 + 0.9);
    const col = jitter(P.roofSlate, r, 0.03);
    fb.tri(a, d, c, col); fb.tri(a, c, b, col); fb.tri(a, c, d, col.clone().multiplyScalar(0.75)); fb.tri(a, b, c, col.clone().multiplyScalar(0.75));
    box(fb, M.x0 + 1, M.x1 - 1, D + 0.8, D + 0.9, M.z0 + 1.2, M.z0 + 3.2, P.woodLight, P.woodLight, r);
    for (let i = 0; i < 6; i++) box(fb, M.x0 + 1.4 + i * 1.9, M.x0 + 2.9 + i * 1.9, D + 0.9, D + 1.15, M.z0 + 1.4, M.z0 + 3.0, P.white, P.fishbox, r);
  }
  // 賣魚：籃子、電子板（立柱上）、按鈕
  box(fb, H.SELL.basket.x - 0.6, H.SELL.basket.x + 0.6, D, D + 0.5, H.SELL.basket.z - 0.45, H.SELL.basket.z + 0.45, P.woodLight, P.wood, r);
  box(fb, H.SELL.board.x - 0.06, H.SELL.board.x + 0.06, D, D + 1.2, H.SELL.board.z - 0.06, H.SELL.board.z + 0.06, P.metal, P.metal, r);
  box(fb, H.SELL.board.x - 0.6, H.SELL.board.x + 0.6, D + 1.2, D + 1.9, H.SELL.board.z - 0.08, H.SELL.board.z + 0.08, P.window, P.window, r, 0.01);
  box(fb, H.SELL.button.x - 0.25, H.SELL.button.x + 0.25, D, D + 0.95, H.SELL.button.z - 0.25, H.SELL.button.z + 0.25, P.white, P.white, r);
  box(fb, H.SELL.button.x - 0.12, H.SELL.button.x + 0.12, D + 0.95, D + 1.05, H.SELL.button.z - 0.12, H.SELL.button.z + 0.12, P.flagRed, P.flagRed, r);
  // 大漁旗：立在牆上的坡地
  H.FLAGS.forEach((f, i) => {
    const y0 = harborHeight(f.x, f.z) - 0.2;
    box(fb, f.x - 0.08, f.x + 0.08, y0, y0 + f.h, f.z - 0.08, f.z + 0.08, P.white, P.white, r);
    box(fb, f.x - 0.14, f.x + 0.14, y0 + f.h, y0 + f.h + 0.25, f.z - 0.14, f.z + 0.14, P.yellow, P.yellow, r);
    const col = [P.flagRed, P.yellow, P.flagRed][i];
    box(fb, f.x + 0.08, f.x + 3.0, y0 + f.h - 2.0, y0 + f.h - 0.1, f.z - 0.03, f.z + 0.03, col, col, r, 0.02);
    box(fb, f.x + 0.08, f.x + 3.0, y0 + f.h - 2.0, y0 + f.h - 1.55, f.z - 0.04, f.z + 0.04, P.flagBlue, P.flagBlue, r, 0.02);   // 下緣的藍色浪
  });
  // 路燈
  for (const l of H.LAMPS) {
    box(fb, l.x - 0.09, l.x + 0.09, D, D + 4.4, l.z - 0.09, l.z + 0.09, P.lampPole, P.lampPole, r);
    box(fb, l.x - 0.09, l.x + 0.09, D + 4.3, D + 4.45, l.z - 0.09, l.z + 0.9, P.lampPole, P.lampPole, r);
    box(fb, l.x - 0.22, l.x + 0.22, D + 4.1, D + 4.3, l.z + 0.5, l.z + 1.0, P.bulb, P.bulb, r, 0.01);
  }
  // 紅燈標
  {
    const B = H.BEACON, g = new THREE.CylinderGeometry(0.55, 0.75, B.h, 8);
    g.translate(B.x, D + B.h / 2, B.z);
    fb.addGeometry(g, (m) => (m.y > D + B.h * 0.55 && m.y < D + B.h * 0.7 ? P.white : P.flagRed));
    const lamp = new THREE.CylinderGeometry(0.35, 0.35, 0.6, 8); lamp.translate(B.x, D + B.h + 0.3, B.z);
    fb.addGeometry(lamp, () => P.bulb);
    const cap = new THREE.ConeGeometry(0.55, 0.5, 8); cap.translate(B.x, D + B.h + 0.85, B.z);
    fb.addGeometry(cap, () => P.flagRed);
  }
  // 白燈塔：方墩上一座白色的塔、一圈陽台＋欄杆、玻璃燈室、深色圓頂
  {
    const L = H.LIGHTHOUSE, y0 = D + L.base, y1 = y0 + L.h;
    const add = (g, x, y, z, col) => { g.translate(x, y, z); fb.addGeometry(g, typeof col === 'function' ? col : () => col); };
    add(new THREE.CylinderGeometry(0.85, 1.15, L.h, 10).rotateY(Math.PI / 10), L.x, y0 + L.h / 2, L.z, (m, n) => (n.y > 0.5 ? P.white : jitter(P.white, r, 0.02)));
    box(fb, L.x - 0.4, L.x + 0.4, y0, y0 + 1.9, L.z + 1.0, L.z + 1.17, P.woodDark, P.woodDark, r);   // 門（朝港外）
    for (const k of [0.32, 0.62]) box(fb, L.x - 0.22, L.x + 0.22, y0 + L.h * k, y0 + L.h * k + 0.55, L.z + 0.98 - k * 0.3, L.z + 1.12 - k * 0.3, P.window, P.window, r);   // 小窗
    add(new THREE.CylinderGeometry(1.35, 1.2, 0.25, 10), L.x, y1 + 0.12, L.z, P.white);           // 陽台
    add(new THREE.CylinderGeometry(1.3, 1.3, 0.55, 10, 1, true), L.x, y1 + 0.52, L.z, P.lampPole);  // 欄杆
    add(new THREE.CylinderGeometry(0.62, 0.62, 1.0, 8), L.x, y1 + 0.75, L.z, P.bulb);               // 燈室（玻璃）
    add(new THREE.CylinderGeometry(0.7, 0.7, 0.15, 8), L.x, y1 + 1.32, L.z, P.white);
    add(new THREE.ConeGeometry(0.75, 0.7, 8), L.x, y1 + 1.75, L.z, P.roofSlate);                  // 圓頂
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 4), L.x, y1 + 2.35, L.z, P.lampPole);          // 避雷針
  }
  // 堤頭的方墩
  box(fb, -14, -10.8, D, D + 1.4, H.BASIN.z1 + 0.4, H.BASIN.z1 + 4.5, P.parapet, P.parapet, r);
  // 跳板與浮橋（浮橋底下一排浮筒）
  H.PONTOONS.forEach((Pn, k) => {
    const G = H.GANGWAYS[k];
    const a = V(G.x - G.w / 2, D, G.z0), b = V(G.x + G.w / 2, D, G.z0), c = V(G.x + G.w / 2, H.PONTOON_Y, G.z1), d = V(G.x - G.w / 2, H.PONTOON_Y, G.z1);
    const col = jitter(P.metal, r, 0.03);
    fb.tri(a, d, c, col); fb.tri(a, c, b, col);
    for (const s of [-1, 1]) {
      const x = G.x + s * G.w / 2;
      fb.tri(V(x, D + 0.9, G.z0), V(x, H.PONTOON_Y + 0.9, G.z1), V(x, H.PONTOON_Y + 0.85, G.z1), col);
      fb.tri(V(x, D + 0.9, G.z0), V(x, H.PONTOON_Y + 0.85, G.z1), V(x, H.PONTOON_Y + 0.9, G.z1), col);
    }
    box(fb, Pn.x - Pn.w / 2, Pn.x + Pn.w / 2, H.PONTOON_Y - 0.12, H.PONTOON_Y, Pn.z0, Pn.z1, P.pontoon, P.woodDark, r);
    for (let z = Pn.z0 + 1; z < Pn.z1; z += 2.4) box(fb, Pn.x - Pn.w / 2 + 0.1, Pn.x + Pn.w / 2 - 0.1, -0.3, H.PONTOON_Y - 0.12, z - 0.7, z + 0.7, P.white, P.white, r);
  });
  const statics = new THREE.Mesh(fb.build(), mat);
  statics.castShadow = statics.receiveShadow = true;
  group.add(statics);

  // ---- 消波塊：沿著面對外海的那幾段亂堆 ----
  const tGeos = [tetrapodGeo(P, 1), tetrapodGeo(P, 2)];
  const tLists = [[], []];
  for (const [a, b] of H.SEAWARD) {
    const [nx, nz, , , L] = outward(a, b), n = Math.round((L * 6) / 3.2);
    for (let i = 0; i < n; i++) {
      const t = r(), o = 0.8 + r() * 5.2;
      const x = a[0] + (b[0] - a[0]) * t + nx * o, z = a[1] + (b[1] - a[1]) * t + nz * o;
      const layer = r() < 0.4 ? 1 : 0, s = 1.3 + r() * 0.3;
      const y = -0.5 + layer * 1.2 + r() * 0.3;
      tLists[i % 2].push({ pos: V(x, y, z), scl: V(s, s, s), rot: r() * 6.28, flip: r() < 0.5, tint: 0.92 + r() * 0.14 });
      out.tetrapods.push({ x, z, r: 1.1 * s, top: y + 1.0 * s });
    }
  }
  tGeos.forEach((g, i) => templates.push({ mesh: place(g, tLists[i], true, true), hue: 0.08 + i * 0.05 }));

  // ---- 船：停滿大部分的格子（白色上半、彩色下半）；遊戲裡的船是玩家自己的，不擺 ----
  if (!game) {
  const cols = [P.hullRed, P.hullBlue, P.hullGreen, P.hullOrange];
  const bGeo = {
    skiff: [P.hullRed, P.hullBlue, P.yellow, P.hullGreen].map((c, i) => boatGeo('skiff', P, c, 40 + i)),
    fisher: cols.map((c, i) => boatGeo('fisher', P, c, 50 + i)),
    trawler: cols.map((c, i) => boatGeo('trawler', P, c, 60 + i)),
  };
  const bLists = { skiff: [[], [], [], []], fisher: [[], [], [], []], trawler: [[], [], [], []] };
  for (const b of H.BERTHS) {
    if (r() < 0.12) continue;
    const type = b.kind === 'small' ? 'skiff' : r() < 0.6 ? 'fisher' : 'trawler';
    let x = b.x;
    if (type === 'fisher') x += Math.sign(b.x) * (BOAT_TYPES.trawler.len - BOAT_TYPES.fisher.len) / 2;   // 船尾一樣靠堤
    bLists[type][Math.floor(r() * 4)].push({ pos: V(x, 0, b.z), scl: V(1, 1, 1), rot: b.heading, flip: false, tint: 0.95 + r() * 0.08 });
  }
  for (const type of Object.keys(bGeo)) bGeo[type].forEach((g, i) => templates.push({ mesh: place(g, bLists[type][i], true, true), hue: 0.55 + i * 0.1 }));
  }

  // ---- 繫船柱、木箱、魚箱、浮球 ----
  templates.push({ mesh: place(bollardGeo(P), H.BOLLARDS.map((b) => ({ pos: V(b.x, D, b.z), scl: V(1, 1, 1), rot: 0, flip: false })), true, true), hue: 0.02 });
  const crate = crateGeo(P.crate, 1.0, 0.8, 0.8, 11), fishbox = crateGeo(P.fishbox, 1.0, 0.45, 0.7, 12);
  const cL = [], fL = [], flL = [];
  for (const p of H.PROPS) {
    const n = 4 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const x = p.x + (r() - 0.5) * p.w, z = p.z + (r() - 0.5) * p.d;
      if (p.kind === 'floats') flL.push({ pos: V(x, D, z), scl: V(1.4, 1.4, 1.4), rot: r() * 6.28, flip: false });
      else (p.kind === 'fishboxes' ? fL : cL).push({ pos: V(x, D + (i > 3 ? (p.kind === 'fishboxes' ? 0.45 : 0.8) : 0), z), scl: V(1, 1, 1), rot: (r() - 0.5) * 0.3 + (r() < 0.5 ? Math.PI / 2 : 0), flip: false, tint: 0.9 + r() * 0.15 });
    }
  }
  templates.push({ mesh: place(crate, cL, true, true), hue: 0.12 });
  templates.push({ mesh: place(fishbox, fL, true, true), hue: 0.6 });
  templates.push({ mesh: place(floatGeo(P), flL, true, true), hue: 0.05 });

  // ---- 海岸一圈大岩石（岩岸），山上幾顆 ----
  const rg = []; for (let k = 0; k < 3; k++) { const g = rockGeo(k, P, 100 + k * 13); rg.push(g, mirrored(g)); }
  const rl = rg.map(() => []);
  const addRock = (x, z, s, sink) => {
    const k = Math.floor(r() * 3);
    const scl = V(s * (0.9 + r() * 0.4), s * (0.65 + r() * 0.45), s * (0.9 + r() * 0.4));
    const y = harborHeight(x, z) - scl.y * sink;
    rl[k * 2 + (r() < 0.5 ? 1 : 0)].push({ pos: V(x, y, z), scl, rot: r() * 6.28, flip: r() < 0.35, tint: 0.88 + r() * 0.16 });
    out.rocks.push({ x, z, r: 0.85 * Math.max(scl.x, scl.z), top: y + scl.y });
  };
  for (let tries = 0, made = 0; made < 230 && tries < 30000; tries++) {
    const x = (r() - 0.5) * 160, z = -66 + r() * 96, h = harborHeight(x, z);
    if (h < -1.6 || h > 1.2 || onPlatform(x, z) || inBasin(x, z) || nearPlatform(x, z, 1.5)) continue;
    made++;
    addRock(x, z, 1.4 + r() * 1.8, 0.35);
  }
  for (let c = 0; c < 6; c++) {
    let x, z, h, tries = 0;
    do { x = (r() - 0.5) * 100; z = -55 + r() * 30; h = harborHeight(x, z); tries++; } while (h < 4.5 && tries < 300);
    for (let i = 0; i < 2 + Math.floor(r() * 2); i++) addRock(x + (r() - 0.5) * 3, z + (r() - 0.5) * 3, 0.9 + r() * 0.9, 0.3);
  }
  rg.forEach((g, i) => templates.push({ mesh: place(g, rl[i], true, true), hue: i * 0.06 }));

  // ---- 山上的大樹（少而大）、草 ----
  const tg = []; for (let k = 0; k < 3; k++) { const g = broadleafGeo(P, 300 + k * 41); tg.push(g, mirrored(g)); }
  const tl = tg.map(() => []), trees = [];
  const okLand = (x, z, h) => h > 2.4 && !onPlatform(x, z) && !(z > -21 && Math.abs(x) < 48) && groundKind(x, z, harborHeight) === 'grass';
  for (let tries = 0; tries < 8000 && trees.length < 22; tries++) {
    const x = (r() - 0.5) * 140, z = -64 + r() * 84, h = harborHeight(x, z);
    if (!okLand(x, z, h) || trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 10 * 10)) continue;
    trees.push({ x, z });
    const s = 1.25 + r() * 0.45;
    tl[Math.floor(r() * tg.length)].push({ pos: V(x, h - 0.2, z), scl: V(s, s * (0.9 + r() * 0.2), s), rot: r() * 6.28, flip: false, tint: 0.92 + r() * 0.14 });
  }
  tg.forEach((g, i) => templates.push({ mesh: place(g, tl[i], true, true), hue: 0.25 + i * 0.07 }));
  const gg = [tuftGeo(P, 700), tuftGeo(P, 701)], gl = [[], []];
  for (let tries = 0, made = 0; made < 2400 && tries < 30000; tries++) {
    const x = (r() - 0.5) * 150, z = -66 + r() * 90, h = harborHeight(x, z);
    if (h < 1.6 || onPlatform(x, z) || groundKind(x, z, harborHeight) !== 'grass') continue;
    made++;
    const s = 0.8 + r() * 0.6;
    gl[made % 2].push({ pos: V(x, h - 0.05, z), scl: V(s, s * (0.8 + r() * 0.5), s), rot: r() * 6.28, flip: false, tint: 0.9 + r() * 0.2 });
  }
  gg.forEach((g, i) => templates.push({ mesh: place(g, gl[i], false, true), hue: 0.5 + i * 0.05 }));
  return out;
}
