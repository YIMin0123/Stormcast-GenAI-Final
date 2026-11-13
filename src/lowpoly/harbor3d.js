// 母島木造漁港的 3D：照 harborPlan.js 的配置，全部用低面平塗做。
// 不會動的（棧橋、木樁、建築、燈、旗）合成一個網格；會重複很多個的（船、繫船柱、木箱、木桶、樹、岩石、草）用樣板＋實例。
// 美術的方向（參考盜賊之海的做法，不照抄）：形狀簡單粗壯、「真實的歪」——木板長短高低差一點、木樁歪歪的、
// 有換過的新木板和曬白的舊木板、樁腳泡水的地方顏色變深長苔；比信箱小的東西不放
import * as THREE from 'three';
import { FaceBuilder, rng, mirrored } from './kit.js';
import { jitter } from './palette.js';
import { rockGeo, broadleafGeo, tuftGeo, terrainGeo, groundKind } from './shapes.js';
import * as H from './harborPlan.js';
import { BOAT_TYPES } from '../boatdata.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 島的形狀（高度、棧板）放在 homeShape.js：遊戲和伺服器也要用，不能引入 three.js
import { harborHeight, homeBed, onBoards } from './homeShape.js';
export { harborHeight, homeBed, onBoards };
export const onPlatform = onBoards;   // 舊名字（樣品間用）

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
// 斜放的方塊：中心 (cx, cy, cz)、長邊沿著 (ux, uz)、長 len × 寬 wid × 高 h。
// roll：繞長邊轉（左右歪）、pitch：繞寬邊轉（一頭高一頭低）
const yawOf = (ux, uz) => Math.atan2(-uz, ux);
function obox(fb, cx, cy, cz, ux, uz, len, wid, h, top, side, r, amt = 0.04, roll = 0, pitch = 0) {
  const g = new THREE.BoxGeometry(len, h, wid);
  if (roll) g.rotateX(roll);
  if (pitch) g.rotateZ(pitch);
  g.rotateY(yawOf(ux, uz));
  g.translate(cx, cy, cz);
  const ct = jitter(top, r, amt), cs = jitter(side, r, amt), cb = cs.clone().multiplyScalar(0.7);
  fb.addGeometry(g, (m, n) => (n.y > 0.5 ? ct : n.y < -0.5 ? cb : cs));
}
// 斜屋頂：兩片斜面（屋脊沿 x）
function gableRoof(fb, x0, x1, z0, z1, y0, rise, over, col, r) {
  const zm = (z0 + z1) / 2, a = V(x0 - over, y0, z0 - over), b = V(x1 + over, y0, z0 - over), c = V(x1 + over, y0 + rise, zm), d = V(x0 - over, y0 + rise, zm);
  const e = V(x0 - over, y0, z1 + over), f = V(x1 + over, y0, z1 + over);
  const c1 = jitter(col, r, 0.03), c2 = jitter(col, r, 0.03).multiplyScalar(0.86);
  fb.tri(a, d, c, c1); fb.tri(a, c, b, c1);        // 北坡
  fb.tri(e, f, c, c2); fb.tri(e, c, d, c2);        // 南坡
  fb.tri(d, a, e, c1); fb.tri(c, f, b, c1);        // 兩端山牆的三角形
  fb.tri(a, b, f, c2); fb.tri(a, f, e, c2);        // 屋簷底面
}
// 把另一個 FaceBuilder 蓋好的東西（自己的座標）轉一下、搬過去，顏色照舊
function merge(fb, sub, rot, x, y, z) {
  const g = sub.build();
  g.rotateY(rot); g.translate(x, y, z);
  const col = g.attributes.color;
  fb.addGeometry(g, (m, n, i) => new THREE.Color(col.getX(i * 3), col.getY(i * 3), col.getZ(i * 3)));
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
      const band = (u) => Math.max(0.12, u.y * 0.45);
      const pm = V(p.x, band(p), s * p.w * 0.98), qm = V(q.x, band(q), s * q.w * 0.98);
      out(pe, qe, qm, cTop, ref); out(pe, qm, pm, cTop, ref);
      out(pm, qm, qc, cBot, ref); out(pm, qc, pc, cBot, ref);
      out(pc, qc, qk, cBot, ref); out(pc, qk, pk, cBot, ref);
      const pb = V(p.x, p.y + T.bul, s * p.w), qb = V(q.x, q.y + T.bul, s * q.w);
      const cb = jitter(top, r, 0.03).multiplyScalar(1.04);
      fb.tri(pe, qe, qb, cb); fb.tri(pe, qb, pb, cb); fb.tri(pe, qb, qe, cb.clone().multiplyScalar(0.85)); fb.tri(pe, pb, qb, cb.clone().multiplyScalar(0.85));
      const dc = jitter(deck, r, 0.04);
      out(V(p.x, p.y, 0), pe, qe, dc, V(0, -10, 0)); out(V(p.x, p.y, 0), qe, V(q.x, q.y, 0), dc, V(0, -10, 0));
    }
  }
  const p0 = pts[0], ref0 = V(0, 0, 0);
  for (const s of [-1, 1]) {
    const e = V(p0.x, p0.y + T.bul, s * p0.w), c = V(p0.x, p0.ch, s * p0.w * 0.9), k = V(p0.x, p0.k, 0), d0 = V(p0.x, p0.y + T.bul, 0);
    out(e, c, k, jitter(top, r, 0.03), ref0); out(e, k, d0, jitter(top, r, 0.03), ref0);
  }
  if (type === 'skiff') {
    box(fb, -L / 2 - 0.45, -L / 2 + 0.05, T.deck - 0.1, T.deck + 0.55, -0.22, 0.22, P.metal, P.metal, r);
    box(fb, -0.6, 0.6, T.deck, T.deck + 0.12, -B * 0.8, B * 0.8, P.wood, P.wood, r);
  } else {
    const cx0 = -L * 0.12, cx1 = cx0 + L * 0.24, cw = B * 0.62, y0 = T.deck + T.rise * 0.2, ch = type === 'trawler' ? 2.3 : 2.0;
    box(fb, cx0, cx1, y0, y0 + ch, -cw, cw, P.white, P.white, r, 0.02);
    box(fb, cx1 - 0.02, cx1 + 0.03, y0 + ch * 0.55, y0 + ch * 0.85, -cw * 0.85, cw * 0.85, P.window, P.window, r, 0.01);
    for (const s of [-1, 1]) box(fb, cx0 + 0.3, cx1 - 0.3, y0 + ch * 0.55, y0 + ch * 0.85, s * cw - 0.03, s * cw + 0.03, P.window, P.window, r, 0.01);
    box(fb, cx0 - 0.25, cx1 + 0.25, y0 + ch, y0 + ch + 0.18, -cw - 0.2, cw + 0.2, P.cabinRoof, P.cabinRoof, r, 0.02);
    box(fb, cx0 + 0.6, cx0 + 0.78, y0 + ch, y0 + ch + 2.6, -0.09, 0.09, P.white, P.white, r);
    if (type === 'trawler') box(fb, -L * 0.42, -L * 0.3, T.deck, T.deck + 1.2, -B * 0.5, B * 0.5, P.metal, P.metal, r);
  }
  return fb.build();
}

// ---- 小物件（樣板）----
// 繫船柱：粗短的木樁，頂上削圓，中間綁一圈繩子
function bollardGeo(P) {
  const fb = new FaceBuilder(), r = rng(3);
  const g1 = new THREE.CylinderGeometry(0.2, 0.23, 0.6, 7); g1.translate(0, 0.3, 0);
  const g2 = new THREE.CylinderGeometry(0.12, 0.2, 0.12, 7); g2.translate(0, 0.66, 0);
  const g3 = new THREE.CylinderGeometry(0.245, 0.245, 0.1, 7); g3.translate(0, 0.38, 0);
  fb.addGeometry(g1, () => jitter(P.woodDark, r, 0.05));
  fb.addGeometry(g2, () => jitter(P.wood, r, 0.05));
  fb.addGeometry(g3, () => jitter(P.rope, r, 0.05));
  return fb.build();
}
function crateGeo(col, w, h, d, seed, P) {
  const fb = new FaceBuilder(), r = rng(seed);
  box(fb, -w / 2, w / 2, 0, h, -d / 2, d / 2, col, col.clone().multiplyScalar(0.86), r);
  if (P) for (const s of [-1, 1]) box(fb, -w / 2 - 0.02, w / 2 + 0.02, h * 0.15, h * 0.3, s * d / 2 - 0.02, s * d / 2 + 0.02, P.woodDark, P.woodDark, r);   // 木箱的橫條
  return fb.build();
}
function barrelGeo(P, seed) {
  const fb = new FaceBuilder(), r = rng(seed);
  const parts = [[0, 0.3, 0.34, 0.38], [0.3, 0.9, 0.38, 0.38], [0.9, 1.2, 0.38, 0.34]];
  for (const [y0, y1, rb, rt] of parts) { const g = new THREE.CylinderGeometry(rt, rb, y1 - y0, 8); g.translate(0, (y0 + y1) / 2, 0); fb.addGeometry(g, (m, n) => (n.y > 0.5 ? jitter(P.woodLight, r, 0.04) : jitter(P.wood, r, 0.06))); }
  for (const y of [0.22, 0.98]) { const g = new THREE.CylinderGeometry(0.39, 0.39, 0.07, 8); g.translate(0, y, 0); fb.addGeometry(g, () => jitter(P.lampPole, r, 0.05)); }
  return fb.build();
}
function floatGeo(P) {
  const fb = new FaceBuilder(), r = rng(9);
  const g = new THREE.IcosahedronGeometry(0.28, 0); g.translate(0, 0.25, 0);
  fb.addGeometry(g, () => jitter(P.float, r, 0.06));
  return fb.build();
}
// 一堆漁網：壓扁的一團
function netGeo(P, seed) {
  const fb = new FaceBuilder(), r = rng(seed);
  const g = new THREE.IcosahedronGeometry(0.7, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, Math.max(0, p.getY(i)) * 0.45 + 0.02);
  fb.addGeometry(g, () => jitter(P.net, r, 0.08));
  return fb.build();
}

// ---- 蓋整座港口島 ----
// game：放進遊戲裡用（船是遊戲自己的，不擺樣品船）。回傳給遊戲用的清單（港座標）：
//   rocks 海岸的大岩石 { x, z, r, top }、piles 立在水裡的木樁 { x, z, r }、solids 棧板上擋路的東西 { x, z, r }
export function buildHarbor({ P, r, place, mat, group, templates, game = false }) {
  // camBoxes：給鏡頭判斷「會不會被擋住」用的簡單方塊（建築的牆和屋頂、小屋、燈塔）。
  // 不拿真正的模型去打射線：整座港合起來十幾萬個三角形，手機每幀打好幾條會慢到只剩十幾幀
  const out = { rocks: [], piles: [], solids: [], camBoxes: [] };
  const camBox = (x0, x1, y0, y1, z0, z1, rot = 0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2) => out.camBoxes.push({ cx, cy: (y0 + y1) / 2, cz, w: x1 - x0, h: y1 - y0, d: z1 - z0, rot });
  const D = H.DECK_Y;
  const terrain = new THREE.Mesh(terrainGeo(P, 214, 2.0, 7, homeBed, 0, -46, null), mat);
  terrain.castShadow = terrain.receiveShadow = true;
  group.add(terrain);

  const fb = new FaceBuilder();
  const TH = 0.07;                 // 木板的厚度
  const BEAM_Y = D - TH - 0.11;    // 縱樑的中心
  const CAP_Y = D - TH - 0.22 - 0.11;   // 橫樑的中心（木樁頂在它下面）

  // ---- 木樁：從海底立到橫樑下面；泡水的那一截深色、長苔 ----
  // top：樁頂的高度（高出棧板的就是繫纜樁、欄杆柱）；lean：歪的方向
  const WET_TOP = 0.45;
  // 回傳 { at(y) → 這根樁在高度 y 的中心 [x, z]、rr 半徑 }（樁是歪的，掛東西要照著它的歪法擺）；太短不立就回傳 null
  const post = (x, z, top, rad = 0.17) => {
    const bed = homeBed(x, z), y0 = Math.max(bed - 0.3, -9);
    if (y0 > top - 0.3) return null;
    const lx = (r() - 0.5) * 0.07, lz = (r() - 0.5) * 0.07, rr = rad * (0.85 + r() * 0.3);
    const seg = (a, b, col, k) => {
      if (b <= a) return;
      const g = new THREE.CylinderGeometry(rr * (k ? 0.97 : 1), rr, b - a, 6);
      g.rotateY(r() * 1.0);
      g.translate(0, (a + b) / 2, 0);
      // 歪：越高偏越多（樁腳不動）
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const h = p.getY(i) - y0; p.setX(i, p.getX(i) + lx * h); p.setZ(i, p.getZ(i) + lz * h); }
      g.translate(x, 0, z);
      const c1 = jitter(col, r, 0.06), c2 = c1.clone().multiplyScalar(0.85);
      fb.addGeometry(g, (m, n) => (Math.abs(n.y) > 0.5 ? c2 : c1));
    };
    const wet = Math.min(WET_TOP, top);
    seg(y0, Math.min(-0.25, wet), P.moss.clone().lerp(P.woodWet, 0.45), 0);   // 水面下：長苔
    seg(Math.max(y0, -0.25), wet, P.woodWet, 1);                             // 水線附近：泡水的深色
    seg(Math.max(y0, wet), top, r() < 0.3 ? P.woodGrey : P.wood, 1);
    if (bed < -0.2) out.piles.push({ x, z, r: rr + 0.05 });
    return { rr, at: (y) => [x + lx * (y - y0), z + lz * (y - y0)] };
  };

  // 棧板接在一起的地方（棧橋接岸邊平台、接轉角平台，指棧接棧橋）木板不能疊在同一個高度上（會閃）：
  // 排在前面的那塊說了算，後面那塊的木板中心落在前面那塊上就不鋪；只有一角伸過去的，墊高一點蓋在上面
  const ORDER = [H.BOARDWALK, H.CORNER, H.SEG1, H.SEG2, ...H.FINGERS, ...H.FLOORS];
  const inRect = (x, z, R) => { const dx = x - R.cx, dz = z - R.cz; return Math.abs(dx * R.ux + dz * R.uz) <= R.hl && Math.abs(-dx * R.uz + dz * R.ux) <= R.hw; };
  const before = (R) => ORDER.slice(0, ORDER.indexOf(R));

  // ---- 一塊棧板：木板（跨短邊、沿長邊一片一片排）、底下兩三根縱樑、每 3 公尺一根橫樑和一排木樁 ----
  const deck = (R, { posts = true, braces = false, skirt = 0.06, skipPost = () => false } = {}) => {
    const wx = -R.uz, wz = R.ux;   // 寬邊方向
    const plankLen = 2 * R.hw + skirt * 2, prev = before(R);
    for (let s = -R.hl; s < R.hl - 0.05;) {
      const w = Math.min(0.27 + r() * 0.08, R.hl - s);
      const c = s + w / 2;
      const k = r();
      const col = k < 0.06 ? P.woodFresh : k < 0.14 ? P.woodGrey : k < 0.55 ? P.woodLight : P.wood;   // 偶爾一片新換的、一片曬白的
      const off = (r() - 0.5) * 0.12, len = plankLen + (r() - 0.5) * 0.1;   // 木板左右長短不齊
      const cx = R.cx + R.ux * c + wx * off, cz = R.cz + R.uz * c + wz * off;
      const jy = (r() - 0.5) * 0.012, roll = (r() - 0.5) * 0.012, pitch = (r() - 0.5) * 0.012;
      s += w;
      if (prev.some((Q) => inRect(cx, cz, Q))) continue;
      // 四個角有沒有伸到前面那幾塊上
      let over = false;
      for (const a of [-w / 2, w / 2]) for (const b of [-len / 2, len / 2]) if (prev.some((Q) => inRect(cx + R.ux * a + wx * b, cz + R.uz * a + wz * b, Q))) over = true;
      // 木板之間不留縫、側面跟板面同色系（只暗一點）：細細的深色縫在遠處比一個像素還細，會變成一閃一閃的鋸齒線。
      // 一片一片靠每片木板深淺不同分出來
      obox(fb, cx, D - TH / 2 + (over ? 0.03 : jy), cz, wx, wz, len, w - 0.006, TH, col, col.clone().multiplyScalar(0.82), r, 0.05, over ? 0 : roll, over ? 0 : pitch);
    }
    // 縱樑
    const rows = R.hw > 2.5 ? [-(R.hw - 0.35), 0, R.hw - 0.35] : [-(R.hw - 0.3), R.hw - 0.3];
    for (const o of rows) obox(fb, R.cx + wx * o, BEAM_Y, R.cz + wz * o, R.ux, R.uz, 2 * R.hl, 0.18, 0.22, P.woodDark, P.woodDark, r, 0.05);
    if (!posts) return;
    // 橫樑＋木樁（每 3 公尺一排；寬的平台中間也加）
    const n = Math.max(1, Math.round((2 * R.hl - 0.6) / 3));
    const across = R.hw > 2.5 ? [-(R.hw - 0.25), 0, R.hw - 0.25] : R.hw > 0.6 ? [-(R.hw - 0.2), R.hw - 0.2] : [0];
    for (let i = 0; i <= n; i++) {
      const s = -R.hl + 0.3 + (2 * R.hl - 0.6) * (i / n);
      const cx = R.cx + R.ux * s, cz = R.cz + R.uz * s;
      if (R.hw > 0.6) obox(fb, cx, CAP_Y, cz, wx, wz, 2 * R.hw + 0.3, 0.22, 0.22, P.woodDark, P.woodDark, r, 0.05, 0, (r() - 0.5) * 0.03);
      for (const o of across) {
        const px = cx + wx * o, pz = cz + wz * o;
        if (skipPost(px, pz) || prev.some((Q) => inRect(px, pz, { ...Q, hl: Q.hl + 0.4, hw: Q.hw + 0.4 }))) continue;
        post(px, pz, CAP_Y - 0.11);
      }
      // 斜撐：兩根樁之間一片斜的木板（隔一格一片，在外側）
      if (braces && i < n && i % 2 === 0) {
        for (const sg of [-1, 1]) {
          const o = sg * (R.hw - 0.2 + 0.2), len = (2 * R.hl - 0.6) / n;
          const bx = cx + R.ux * len / 2 + wx * o, bz = cz + R.uz * len / 2 + wz * o;
          if (homeBed(bx, bz) > -0.5) continue;
          const dy = (CAP_Y - 0.2) - 0.1;
          obox(fb, bx, (CAP_Y - 0.2 + 0.1) / 2, bz, R.ux, R.uz, Math.hypot(len, dy), 0.06, 0.2, P.wood, P.woodDark, r, 0.05, 0, Math.atan2(dy, len) * sg);
        }
      }
    }
  };
  // 燈籠：方形的燈罩、上下兩片蓋子（s：大小）
  const lantern = (x, y, z, s = 1) => {
    box(fb, x - 0.2 * s, x + 0.2 * s, y - 0.22 * s, y + 0.22 * s, z - 0.2 * s, z + 0.2 * s, P.bulb, P.bulb, r, 0.01);
    box(fb, x - 0.26 * s, x + 0.26 * s, y + 0.22 * s, y + 0.3 * s, z - 0.26 * s, z + 0.26 * s, P.lampPole, P.lampPole, r);
    box(fb, x - 0.24 * s, x + 0.24 * s, y - 0.3 * s, y - 0.22 * s, z - 0.24 * s, z + 0.24 * s, P.lampPole, P.lampPole, r);
  };
  // 轉角平台西邊那排高出棧板的柱子（拉繩子用）：就用平台自己邊上那排樁往上長，不另外再立
  const C = H.CORNER, ropeX = C.cx - C.hw + 0.25;
  const ropeZ = [];
  { const n = Math.max(1, Math.round((2 * C.hl - 0.6) / 3)); for (let i = 0; i <= n; i++) ropeZ.push(C.cz - C.hl + 0.3 + (2 * C.hl - 0.6) * (i / n)); }
  const isRopePost = (x, z) => Math.abs(x - ropeX) < 0.3 && ropeZ.some((rz) => Math.abs(z - rz) < 0.3);
  // 指棧尾端那根高樁：指棧自己那排樁在它旁邊的就不立
  const fingerEnd = (f) => [f.cx + f.ux * (f.hl - 0.2), f.cz + f.uz * (f.hl - 0.2)];
  const nearEnd = (f) => (x, z) => { const [ex, ez] = fingerEnd(f); return Math.hypot(x - ex, z - ez) < 0.8; };

  deck(H.BOARDWALK);
  deck(H.SEG1, { braces: true });
  deck(H.CORNER, { skipPost: isRopePost });
  deck(H.SEG2, { braces: true });
  for (const f of H.FINGERS) deck(f, { skirt: 0.04, skipPost: nearEnd(f) });
  for (const f of H.FLOORS) deck(f, { posts: false });

  // 指棧尾端那根樁高出棧板（繫纜用），樁上綁一圈繩子；每隔幾根頂上放一盞小燈籠（裝飾，不打光）
  H.FINGERS.forEach((f, i) => {
    const [x, z] = fingerEnd(f);
    const p = post(x, z, D + 0.75, 0.19);
    if (!p) return;
    const [rx, rz] = p.at(D + 0.5);
    const g = new THREE.CylinderGeometry(p.rr + 0.035, p.rr + 0.035, 0.08, 6); g.translate(rx, D + 0.5, rz);
    fb.addGeometry(g, () => jitter(P.rope, r, 0.05));
    if (i % 4 === 0) { const [tx, tz] = p.at(D + 0.75); lantern(tx, D + 0.75 + 0.21, tz, 0.7); }
    out.solids.push({ x, z, r: 0.3 });
  });
  // 轉角平台西邊：一排高樁，樁之間拉一條繩子（只是好看，擋不住人）；梯子那一格不拉
  {
    const tops = [];
    for (const z of ropeZ) { const p = post(ropeX, z, D + 1.0, 0.15); if (p) { tops.push({ z, at: p.at(D + 0.8) }); out.solids.push({ x: ropeX, z, r: 0.22 }); } }
    const lad = H.LADDERS.find((l) => l.nx < 0 && Math.abs(l.x - (C.cx - C.hw)) < 0.1);
    for (let i = 0; i < tops.length - 1; i++) {
      const a = tops[i], b = tops[i + 1];
      if (lad && lad.z > a.z && lad.z < b.z) continue;
      const [ax, az] = a.at, [bx, bz] = b.at, L = Math.hypot(bx - ax, bz - az);
      obox(fb, (ax + bx) / 2, D + 0.8, (az + bz) / 2, (bx - ax) / L, (bz - az) / L, L, 0.05, 0.05, P.rope, P.rope, r, 0.03, 0, 0);
    }
  }
  // 梯子：棧橋邊往下伸進水裡，兩根扶手高出棧板（落水的人從這裡爬上來，見 layout.js 的 ladderY）
  for (const l of H.LADDERS) {
    const x = l.x + l.nx * 0.1, z = l.z + l.nz * 0.1;
    for (const sg of [-1, 1]) {
      const px = x - l.nz * sg * 0.3, pz = z + l.nx * sg * 0.3;
      obox(fb, px, (D + 0.7 - 1.6) / 2, pz, l.nx, l.nz, 0.1, 0.1, D + 0.7 + 1.6, P.woodDark, P.woodDark, r);
    }
    for (let y = -1.3; y < D - 0.1; y += 0.35) obox(fb, x, y, z, -l.nz, l.nx, 0.62, 0.07, 0.06, P.wood, P.wood, r);
  }

  // ---- 會亮的燈：木頭燈桿、往棧橋中間伸出去的橫桿、掛著一盞方形的燈籠 ----
  for (const l of H.LAMPS) {
    box(fb, l.x - 0.11, l.x + 0.11, CAP_Y, D + 3.75, l.z - 0.11, l.z + 0.11, P.woodDark, P.woodDark, r);
    obox(fb, l.x + l.ax * 0.45, D + 3.65, l.z + l.az * 0.45, l.ax, l.az, 1.0, 0.1, 0.1, P.woodDark, P.woodDark, r);
    box(fb, l.x + l.ax * 0.75 - 0.02, l.x + l.ax * 0.75 + 0.02, D + 3.5, D + 3.6, l.z + l.az * 0.75 - 0.02, l.z + l.az * 0.75 + 0.02, P.lampPole, P.lampPole, r);   // 吊燈籠的短繩
    lantern(l.x + l.ax * 0.75, D + 3.2, l.z + l.az * 0.75);
    out.solids.push({ x: l.x, z: l.z, r: 0.25 });
  }

  // ---- 商店：木板牆、深色斜屋頂；正面西半邊開放（看得到店裡的長桌和貨架），東半邊掛三塊排行榜 ----
  {
    const S = H.SHOP, top = D + S.h, t = 0.25;
    box(fb, S.x0 - 0.2, S.x1 + 0.2, D - 1.4, D - TH, S.z0 - 0.2, S.z0 + 1.5, P.stone, P.stone, r);   // 後面的石砌地基
    box(fb, S.x0, S.x1, D, top, S.z0, S.z0 + t, P.wood, P.wood, r);                 // 後牆
    box(fb, S.x0, S.x0 + t, D, top, S.z0, S.z1, P.wood, P.wood, r);                 // 西牆
    box(fb, S.x1 - t, S.x1, D, top, S.z0, S.z1, P.wood, P.wood, r);                 // 東牆
    box(fb, S.open.x1, S.x1, D, top, S.z1 - t, S.z1, P.wood, P.wood, r);            // 正面東半邊
    box(fb, S.x0, S.open.x1, D + 2.6, top, S.z1 - t, S.z1, P.wood, P.wood, r);      // 開口上方
    // 正面牆上一條一條的直木條（開口那一段只有上面一截）
    for (let x = S.x0 + 0.4; x < S.x1 - 0.2; x += 0.9 + r() * 0.3) {
      box(fb, x - 0.04, x + 0.04, x > S.open.x1 ? D : D + 2.6, top, S.z1, S.z1 + 0.03, P.woodDark, P.woodDark, r);
    }
    box(fb, H.SHELF_X[0], H.SHELF_X[1], D + 0.78, D + 0.86, H.SHELF_Z - 0.45, H.SHELF_Z + 0.45, P.woodLight, P.woodDark, r);   // 賣東西的長桌
    for (const x of [H.SHELF_X[0] + 0.15, H.SHELF_X[1] - 0.15]) for (const z of [H.SHELF_Z - 0.35, H.SHELF_Z + 0.35]) box(fb, x - 0.06, x + 0.06, D, D + 0.78, z - 0.06, z + 0.06, P.woodDark, P.woodDark, r);
    for (const x of [S.x0 + 0.1, S.open.x1 - 0.1, S.x1 - 0.1]) box(fb, x - 0.18, x + 0.18, D, top + 0.05, S.z1 - 0.2, S.z1 + 0.15, P.woodDark, P.woodDark, r);   // 柱子
    gableRoof(fb, S.x0, S.x1, S.z0, S.z1, top, 2.2, 0.7, P.roofSlate, r);
    camBox(S.x0, S.x1, D, top, S.z0, S.z0 + t); camBox(S.x0, S.x0 + t, D, top, S.z0, S.z1); camBox(S.x1 - t, S.x1, D, top, S.z0, S.z1);
    camBox(S.open.x1, S.x1, D, top, S.z1 - t, S.z1); camBox(S.x0, S.open.x1, D + 2.6, top, S.z1 - t, S.z1);
    camBox(S.x0 - 0.7, S.x1 + 0.7, top, top + 2.2, S.z0 - 0.7, S.z1 + 0.7);   // 屋頂
    // 屋頂上一個小煙囪、門口上方一塊招牌
    box(fb, S.x0 + 3, S.x0 + 3.8, top + 0.6, top + 3.0, S.z0 + 2, S.z0 + 2.8, P.stone, P.stone, r);
    box(fb, S.x0 + 1.5, S.open.x1 - 1.5, D + 2.75, D + 3.3, S.z1, S.z1 + 0.12, P.woodLight, P.woodDark, r);
    // 店裡：靠後牆兩排貨架，上面擺油桶、工具箱、釣竿、船模型
    for (const [x0, x1] of [[S.x0 + 0.6, S.x0 + 3.6], [S.x0 + 4.0, S.open.x1 - 0.4]]) {
      for (const y of [D + 0.1, D + 1.0, D + 1.9]) box(fb, x0, x1, y, y + 0.08, S.z0 + 0.3, S.z0 + 1.2, P.woodLight, P.woodLight, r);
      for (const x of [x0, x1 - 0.08]) box(fb, x, x + 0.08, D, D + 2.6, S.z0 + 0.3, S.z0 + 1.2, P.woodDark, P.woodDark, r);
    }
    for (let i = 0; i < 6; i++) box(fb, S.x0 + 0.9 + i * 0.45, S.x0 + 1.1 + i * 0.45, D + 0.18, D + 0.75, S.z0 + 0.6, S.z0 + 0.95, P.flagRed, P.flagRed, r);
    for (let i = 0; i < 4; i++) box(fb, S.x0 + 0.9 + i * 0.7, S.x0 + 1.4 + i * 0.7, D + 1.08, D + 1.4, S.z0 + 0.5, S.z0 + 1.0, P.hullGreen, P.hullGreen, r);
    for (let i = 0; i < 7; i++) box(fb, S.x0 + 4.4 + i * 0.35, S.x0 + 4.46 + i * 0.35, D + 0.2, D + 2.4, S.z0 + 0.5, S.z0 + 0.56, P.woodDark, P.woodDark, r);
    box(fb, S.x0 + 4.6, S.x0 + 6.2, D + 1.98, D + 2.35, S.z0 + 0.55, S.z0 + 1.0, P.white, P.hullBlue, r);
    if (!game) for (const b of H.BOARDS) {   // 遊戲裡的看板由 boards.js 另外立
      box(fb, b.x - b.w / 2 - 0.12, b.x + b.w / 2 + 0.12, b.y0 - 0.12, b.y0 + b.h + 0.12, S.z1, S.z1 + 0.1, P.yellow, P.yellow, r);
      box(fb, b.x - b.w / 2, b.x + b.w / 2, b.y0, b.y0 + b.h, S.z1 + 0.1, S.z1 + 0.14, P.woodDark, P.woodDark, r, 0.02);
    }
    lantern(S.x0 + 0.8, D + 2.3, S.z1 + 0.45, 0.8);   // 門口的燈
  }
  // ---- 魚市場：木柱、往南傾的鐵皮屋頂、桌上的魚箱 ----
  {
    const M = H.MARKET;
    box(fb, M.x0 - 0.2, M.x1 + 0.2, D - 1.4, D - TH, M.z0 - 0.2, M.z0 + 1.5, P.stone, P.stone, r);
    for (const x of [M.x0 + 0.3, (M.x0 + M.x1) / 2, M.x1 - 0.3]) for (const z of [M.z0 + 0.3, M.z1 - 0.3]) {
      box(fb, x - 0.16, x + 0.16, D, D + M.h + (z < -8 ? 0.7 : 0), z - 0.16, z + 0.16, P.wood, P.wood, r);
      out.solids.push({ x, z, r: 0.3 });
    }
    const a = V(M.x0 - 0.6, D + M.h + 0.85, M.z0 - 0.5), b = V(M.x1 + 0.6, D + M.h + 0.85, M.z0 - 0.5), c = V(M.x1 + 0.6, D + M.h - 0.1, M.z1 + 0.9), d = V(M.x0 - 0.6, D + M.h - 0.1, M.z1 + 0.9);
    const col = jitter(P.roofTin, r, 0.03);
    fb.tri(a, d, c, col); fb.tri(a, c, b, col); fb.tri(a, c, d, col.clone().multiplyScalar(0.75)); fb.tri(a, b, c, col.clone().multiplyScalar(0.75));
    box(fb, M.x0 - 0.2, M.x1 + 0.2, D, D + 2.2, M.z0, M.z0 + 0.2, P.woodGrey, P.woodGrey, r);   // 後面一道矮木牆
    camBox(M.x0 - 0.6, M.x1 + 0.6, D + M.h - 0.1, D + M.h + 0.85, M.z0 - 0.5, M.z1 + 0.9);   // 棚頂（斜的，用一塊方塊包住）
    box(fb, M.x0 + 1, M.x1 - 1, D + 0.8, D + 0.9, M.z0 + 1.2, M.z0 + 3.2, P.woodLight, P.woodLight, r);
    for (let i = 0; i < 6; i++) box(fb, M.x0 + 1.4 + i * 1.9, M.x0 + 2.9 + i * 1.9, D + 0.9, D + 1.15, M.z0 + 1.4, M.z0 + 3.0, P.white, P.fishbox, r);
    lantern((M.x0 + M.x1) / 2, D + M.h - 0.4, (M.z0 + M.z1) / 2 + 1, 0.8);
  }
  // 賣魚：籃子、電子板（立柱上）、按鈕
  box(fb, H.SELL.basket.x - 0.6, H.SELL.basket.x + 0.6, D, D + 0.5, H.SELL.basket.z - 0.45, H.SELL.basket.z + 0.45, P.woodLight, P.wood, r);
  box(fb, H.SELL.board.x - 0.06, H.SELL.board.x + 0.06, D, D + 1.2, H.SELL.board.z - 0.06, H.SELL.board.z + 0.06, P.metal, P.metal, r);
  box(fb, H.SELL.board.x - 0.6, H.SELL.board.x + 0.6, D + 1.2, D + 1.9, H.SELL.board.z - 0.08, H.SELL.board.z + 0.08, P.window, P.window, r, 0.01);
  box(fb, H.SELL.button.x - 0.25, H.SELL.button.x + 0.25, D, D + 0.95, H.SELL.button.z - 0.25, H.SELL.button.z + 0.25, P.white, P.white, r);
  box(fb, H.SELL.button.x - 0.12, H.SELL.button.x + 0.12, D + 0.95, D + 1.05, H.SELL.button.z - 0.12, H.SELL.button.z + 0.12, P.flagRed, P.flagRed, r);

  // ---- 坡上的小屋：石砌地基、灰泥或木板牆、斜屋頂、門、窗、煙囪 ----
  H.HOUSES.forEach((hs, k) => {
    const c = Math.cos(hs.rot), s = Math.sin(hs.rot), hw = hs.w / 2, hd = hs.d / 2;
    const ys = [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]].map(([a, b]) => harborHeight(hs.x + a * c + b * s, hs.z - a * s + b * c));
    const lo = Math.min(...ys), y0 = Math.max(...ys) + 0.35;
    const sub = new FaceBuilder();
    box(sub, -hw - 0.15, hw + 0.15, lo - y0 - 0.5, 0, -hd - 0.15, hd + 0.15, P.stone, P.stone, r);
    const wall = k % 2 ? P.plaster : P.wood;
    box(sub, -hw, hw, 0, hs.h, -hd, hd, wall, wall, r);
    for (const sx of [-hw - 0.05, hw - 0.1]) box(sub, sx, sx + 0.15, 0, hs.h, -hd - 0.05, hd + 0.05, P.woodDark, P.woodDark, r);   // 四角的木柱
    gableRoof(sub, -hw, hw, -hd, hd, hs.h, 1.8, 0.45, k === 1 ? P.roofSlate : P.roofRed, r);
    box(sub, -0.5, 0.5, 0, 1.9, hd, hd + 0.08, P.woodDark, P.woodDark, r);                              // 門（朝海）
    for (const wx of [-hw + 1.1, hw - 1.1]) box(sub, wx - 0.4, wx + 0.4, 1.1, 1.8, hd, hd + 0.06, P.window, P.woodDark, r, 0.01);
    box(sub, hw - 1.4, hw - 0.7, hs.h + 0.4, hs.h + 2.3, -0.6, 0.1, P.stone, P.stone, r);              // 煙囪
    merge(fb, sub, hs.rot, hs.x, y0, hs.z);
    out.camBoxes.push({ cx: hs.x, cy: y0 + (hs.h + 1.8) / 2, cz: hs.z, w: hs.w + 0.9, h: hs.h + 1.8, d: hs.d + 0.9, rot: hs.rot });
  });

  // ---- 大漁旗：橋頭後面的坡地 ----
  H.FLAGS.forEach((f, i) => {
    const y0 = harborHeight(f.x, f.z) - 0.2;
    box(fb, f.x - 0.08, f.x + 0.08, y0, y0 + f.h, f.z - 0.08, f.z + 0.08, P.white, P.white, r);
    box(fb, f.x - 0.14, f.x + 0.14, y0 + f.h, y0 + f.h + 0.25, f.z - 0.14, f.z + 0.14, P.yellow, P.yellow, r);
    const col = [P.flagRed, P.yellow, P.flagRed][i];
    box(fb, f.x + 0.08, f.x + 3.0, y0 + f.h - 2.0, y0 + f.h - 0.1, f.z - 0.03, f.z + 0.03, col, col, r, 0.02);
    box(fb, f.x + 0.08, f.x + 3.0, y0 + f.h - 2.0, y0 + f.h - 1.55, f.z - 0.04, f.z + 0.04, P.flagBlue, P.flagBlue, r, 0.02);
  });

  // ---- 白燈塔：東邊岩岬上，石砌的矮墩、白色的塔、一圈陽台＋欄杆、玻璃燈室、深色圓頂 ----
  {
    const L = H.LIGHTHOUSE, g0 = harborHeight(L.x, L.z), y0 = g0 + 0.3, y1 = y0 + L.h;
    const add = (g, x, y, z, col) => { g.translate(x, y, z); fb.addGeometry(g, typeof col === 'function' ? col : () => col); };
    add(new THREE.CylinderGeometry(1.7, 1.9, 1.6, 9), L.x, g0 - 0.5, L.z, (m, n) => jitter(P.stone, r, 0.06));
    add(new THREE.CylinderGeometry(0.9, 1.2, L.h, 10).rotateY(Math.PI / 10), L.x, y0 + L.h / 2, L.z, (m, n) => (m.y > y0 + L.h * 0.45 && m.y < y0 + L.h * 0.62 ? P.flagRed : n.y > 0.5 ? P.white : jitter(P.white, r, 0.02)));
    box(fb, L.x - 0.4, L.x + 0.4, y0, y0 + 1.9, L.z + 1.05, L.z + 1.22, P.woodDark, P.woodDark, r);
    for (const k of [0.3, 0.7]) box(fb, L.x - 0.22, L.x + 0.22, y0 + L.h * k, y0 + L.h * k + 0.55, L.z + 1.03 - k * 0.3, L.z + 1.17 - k * 0.3, P.window, P.window, r);
    add(new THREE.CylinderGeometry(1.4, 1.25, 0.25, 10), L.x, y1 + 0.12, L.z, P.white);
    add(new THREE.CylinderGeometry(1.35, 1.35, 0.55, 10, 1, true), L.x, y1 + 0.52, L.z, P.lampPole);
    add(new THREE.CylinderGeometry(0.65, 0.65, 1.0, 8), L.x, y1 + 0.75, L.z, P.bulb);
    add(new THREE.CylinderGeometry(0.72, 0.72, 0.15, 8), L.x, y1 + 1.32, L.z, P.white);
    add(new THREE.ConeGeometry(0.8, 0.75, 8), L.x, y1 + 1.77, L.z, P.flagRed);
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 4), L.x, y1 + 2.4, L.z, P.lampPole);
    camBox(L.x - 1.2, L.x + 1.2, g0 - 1.3, y1 + 2.5, L.z - 1.2, L.z + 1.2);
  }

  const statics = new THREE.Mesh(fb.build(), mat);
  statics.castShadow = statics.receiveShadow = true;
  group.add(statics);

  // ---- 船：停滿大部分的格子；遊戲裡的船是玩家自己的，不擺 ----
  if (!game) {
    const cols = [P.hullRed, P.hullBlue, P.hullGreen, P.hullOrange];
    const types = ['skiff', 'fisher', 'trawler'];
    const bGeo = Object.fromEntries(types.map((t, k) => [t, cols.map((c, i) => boatGeo(t, P, c, 40 + k * 10 + i))]));
    const bLists = Object.fromEntries(types.map((t) => [t, [[], [], [], []]]));
    for (const b of H.BERTHS) {
      if (r() < 0.15) continue;
      const type = types[Math.floor(r() * 3)], d = 0.45 + BOAT_TYPES[type].len / 2;
      bLists[type][Math.floor(r() * 4)].push({ pos: V(b.ex + b.nx * d, 0, b.ez + b.nz * d), scl: V(1, 1, 1), rot: -Math.atan2(b.nz, b.nx), flip: false, tint: 0.95 + r() * 0.08 });
    }
    for (const type of types) bGeo[type].forEach((g, i) => templates.push({ mesh: place(g, bLists[type][i], true, true), hue: 0.55 + i * 0.1 }));
  }

  // ---- 繫船柱、木箱、木桶、魚箱、浮球、漁網 ----
  templates.push({ mesh: place(bollardGeo(P), H.BOLLARDS.map((b) => ({ pos: V(b.x, D, b.z), scl: V(1, 1, 1), rot: r() * 6.28, flip: false, tint: 0.9 + r() * 0.15 })), true, true), hue: 0.02 });
  const geos = { crates: crateGeo(P.crate, 1.0, 0.8, 0.8, 11, P), fishboxes: crateGeo(P.fishbox, 1.0, 0.45, 0.7, 12), floats: floatGeo(P), barrels: barrelGeo(P, 13), nets: netGeo(P, 14) };
  const lists = Object.fromEntries(Object.keys(geos).map((k) => [k, []]));
  const stackH = { crates: 0.8, fishboxes: 0.45, barrels: 1.2, floats: 0, nets: 0 };
  // 一堆一堆擺：地上的彼此不重疊（離太近就換個位置），疊上去的那幾個放在下面某一個的正上方
  const gap = { crates: 1.05, fishboxes: 0.95, barrels: 0.82, floats: 0.55, nets: 1.3 };
  for (const p of H.PROPS) {
    const n = p.kind === 'nets' ? 2 : 4 + Math.floor(r() * 3), ground = [];
    for (let i = 0; i < n; i++) {
      const up = i > 3 && stackH[p.kind] > 0 && p.kind !== 'barrels' && ground.length;
      const s = p.kind === 'floats' ? 1.4 : 1, rot = (r() - 0.5) * 0.4 + (r() < 0.5 ? Math.PI / 2 : 0);
      if (up) {
        const b = ground[Math.floor(r() * ground.length)];
        lists[p.kind].push({ pos: V(b.x + (r() - 0.5) * 0.08, D + stackH[p.kind], b.z + (r() - 0.5) * 0.08), scl: V(s, s, s), rot: b.rot + (r() - 0.5) * 0.25, flip: false, tint: 0.88 + r() * 0.18 });
        continue;
      }
      let x, z, ok = false;
      for (let t = 0; t < 30 && !ok; t++) { x = p.x + (r() - 0.5) * p.w; z = p.z + (r() - 0.5) * p.d; ok = ground.every((g) => Math.hypot(g.x - x, g.z - z) > gap[p.kind]); }
      if (!ok) continue;
      ground.push({ x, z, rot });
      lists[p.kind].push({ pos: V(x, D, z), scl: V(s, s, s), rot, flip: false, tint: 0.88 + r() * 0.18 });
      if (p.kind !== 'floats' && p.kind !== 'nets') out.solids.push({ x, z, r: p.kind === 'barrels' ? 0.42 : 0.55 });
    }
  }
  Object.keys(geos).forEach((k, i) => templates.push({ mesh: place(geos[k], lists[k], true, true), hue: 0.05 + i * 0.12 }));

  // ---- 海岸一圈大岩石、東邊岩岬一堆、山上幾顆 ----
  const rg = []; for (let k = 0; k < 3; k++) { const g = rockGeo(k, P, 100 + k * 13); rg.push(g, mirrored(g)); }
  const rl = rg.map(() => []);
  const addRock = (x, z, s, sink) => {
    const k = Math.floor(r() * 3);
    const scl = V(s * (0.9 + r() * 0.4), s * (0.65 + r() * 0.45), s * (0.9 + r() * 0.4));
    const y = harborHeight(x, z) - scl.y * sink;
    rl[k * 2 + (r() < 0.5 ? 1 : 0)].push({ pos: V(x, y, z), scl, rot: r() * 6.28, flip: r() < 0.35, tint: 0.88 + r() * 0.16 });
    out.rocks.push({ x, z, r: 0.85 * Math.max(scl.x, scl.z), top: y + scl.y });
  };
  const nearDeck = (x, z, m) => onBoards(x, z, m);
  const village = (x, z) => x > -40 && x < 40 && z > -22 && z < 6;   // 橋頭那一片是沙灘和村子，不堆大石頭
  for (let tries = 0, made = 0; made < 260 && tries < 40000; tries++) {
    const x = (r() - 0.5) * 180, z = -116 + r() * 126, h = harborHeight(x, z);
    if (h < -1.6 || h > 1.2 || nearDeck(x, z, 3) || village(x, z)) continue;
    made++;
    addRock(x, z, 1.4 + r() * 1.8, 0.35);
  }
  for (let i = 0; i < 14; i++) {   // 岩岬：燈塔腳下一堆
    const a = r() * 6.28, d = 3 + r() * 9, x = H.LIGHTHOUSE.x + Math.cos(a) * d, z = H.LIGHTHOUSE.z + Math.sin(a) * d;
    const sz = 1.2 + r() * 1.6;
    if (Math.hypot(x - H.LIGHTHOUSE.x, z - H.LIGHTHOUSE.z) < 2.2 + sz * 1.2) continue;   // 石頭最大會比 sz 寬三成：不插進燈塔的石墩
    addRock(x, z, sz, 0.4);
  }
  for (let c = 0; c < 8; c++) {
    let x, z, h, tries = 0;
    do { x = (r() - 0.5) * 120; z = -100 + r() * 60; h = harborHeight(x, z); tries++; } while ((h < 6 || H.HOUSES.some((hs) => Math.hypot(x - hs.x, z - hs.z) < 8)) && tries < 300);
    for (let i = 0; i < 2 + Math.floor(r() * 2); i++) addRock(x + (r() - 0.5) * 3, z + (r() - 0.5) * 3, 0.9 + r() * 0.9, 0.3);
  }
  rg.forEach((g, i) => templates.push({ mesh: place(g, rl[i], true, true), hue: i * 0.06 }));

  // ---- 山上的大樹（少而大）、草 ----
  const tg = []; for (let k = 0; k < 3; k++) { const g = broadleafGeo(P, 300 + k * 41); tg.push(g, mirrored(g)); }
  const tl = tg.map(() => []), trees = [];
  const clearOf = (x, z) => H.HOUSES.every((hs) => Math.hypot(x - hs.x, z - hs.z) > 7) && Math.hypot(x - H.LIGHTHOUSE.x, z - H.LIGHTHOUSE.z) > 8 && !(x > -36 && x < 36 && z > -24);
  const okLand = (x, z, h) => h > 2.4 && clearOf(x, z) && groundKind(x, z, harborHeight) === 'grass';
  for (let tries = 0; tries < 12000 && trees.length < 40; tries++) {
    const x = (r() - 0.5) * 160, z = -112 + r() * 100, h = harborHeight(x, z);
    if (!okLand(x, z, h) || trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 10 * 10) || out.rocks.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + 1.2)) continue;   // 樹幹不長在石頭裡
    trees.push({ x, z });
    const s = 1.25 + r() * 0.45;
    tl[Math.floor(r() * tg.length)].push({ pos: V(x, h - 0.2, z), scl: V(s, s * (0.9 + r() * 0.2), s), rot: r() * 6.28, flip: false, tint: 0.92 + r() * 0.14 });
  }
  tg.forEach((g, i) => templates.push({ mesh: place(g, tl[i], true, true), hue: 0.25 + i * 0.07 }));
  const gg = [tuftGeo(P, 700), tuftGeo(P, 701)], gl = [[], []];
  for (let tries = 0, made = 0; made < 3600 && tries < 40000; tries++) {
    const x = (r() - 0.5) * 170, z = -116 + r() * 116, h = harborHeight(x, z);
    if (h < 1.6 || nearDeck(x, z, 0.5) || groundKind(x, z, harborHeight) !== 'grass') continue;
    if (H.HOUSES.some((hs) => Math.hypot(x - hs.x, z - hs.z) < Math.hypot(hs.w, hs.d) / 2 + 0.6) || Math.hypot(x - H.LIGHTHOUSE.x, z - H.LIGHTHOUSE.z) < 2.6) continue;
    made++;
    const s = 0.8 + r() * 0.6;
    gl[made % 2].push({ pos: V(x, h - 0.05, z), scl: V(s, s * (0.8 + r() * 0.5), s), rot: r() * 6.28, flip: false, tint: 0.9 + r() * 0.2 });
  }
  gg.forEach((g, i) => templates.push({ mesh: place(g, gl[i], false, true), hue: 0.5 + i * 0.05 }));
  return out;
}
