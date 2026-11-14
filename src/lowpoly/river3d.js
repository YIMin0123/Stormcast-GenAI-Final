// 大港灣島的山澗小河、瀑布、天窗跳水台、藤蔓的模型（大港座標，位置和尺寸見 havenPlan.js 的 RIVER、DIVE、VINES）。
// 都交給全場共用的那個低面材質畫：
//   河水是一條貼著河床的水帶，一格一格各自一個顏色；每幀照「沿河的距離 − 時間」換顏色，白沫就一格一格往下游跑（不另外寫著色器、不用貼圖）
//   瀑布是從崖頂往前拋出去的一道水簾（雙面都畫，走到水簾後面也看得到）
//   藤蔓只是裝飾（不能爬）：一串一串掛著，照材質原本的隨風擺動晃
import * as THREE from 'three';
import { FaceBuilder, rng } from './kit.js';
import { jitter } from './palette.js';
import { riverPath, riverFalls, skyEdge, diveDeck } from './havenShape.js';
import { RIVER } from './havenPlan.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- 河水、瀑布、水潭 ----
// 回傳 { update(時間) }：每幀呼叫，換水面每一格的顏色
export function buildRiver({ mat, group }) {
  const pts = riverPath(), falls = riverFalls(), W = RIVER.water, S = RIVER.spring;
  const fb = new FaceBuilder(), cells = [], WHITE = new THREE.Color(1, 1, 1);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  // 一格（四邊形）：u 沿河的距離、lane 第幾道、kind 0 河水／1 瀑布／2 水潭／3 落水的白沫；both：雙面都畫
  const tri = (a, b, c, both) => {
    nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    if (nrm.y < 0) { const t = b; b = c; c = t; }   // 朝上
    fb.tri(a.clone(), b.clone(), c.clone(), WHITE, [0, 0, 0], 0.25);
    if (both) fb.tri(a.clone(), c.clone(), b.clone(), WHITE, [0, 0, 0], 0.25);
  };
  const cell = (list, u, lane, kind, both = false) => {
    const v0 = fb.p.length / 3;
    for (const [a, b, c] of list) tri(a, b, c, both);
    cells.push({ v0, n: fb.p.length / 3 - v0, u, lane, kind });
  };
  const LANES = [-1, -1 / 3, 1 / 3, 1];
  const row = (st, y = st.y, fwd = 0, k = 1) => LANES.map((L) => V3(st.x + st.tx * fwd - st.tz * L * W.half * k, y, st.z + st.tz * fwd + st.tx * L * W.half * k));
  const strip = (r0, r1, u, kind, both) => { for (let j = 0; j < 3; j++) cell([[r0[j], r0[j + 1], r1[j]], [r0[j + 1], r1[j + 1], r1[j]]], u, j, kind, both); };
  // 一道水簾：從 st 往前拋 thr 公尺、從 yTop 落到 yBot（拋物線），分 n 段
  const curtain = (st, yTop, yBot, thr, n) => {
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n, cur = row(st, yTop - (yTop - yBot) * t * t, thr * t, 1 - 0.15 * t);
      if (prev) strip(prev, cur, st.u + (yTop - yBot) * t, 1, true);
      prev = cur;
    }
  };
  // 一圈水面（扇形拼成的圓）
  const disc = (x, z, y, rad, n, kind) => {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      cell([[V3(x, y, z), V3(x + Math.cos(a0) * rad, y, z + Math.sin(a0) * rad), V3(x + Math.cos(a1) * rad, y, z + Math.sin(a1) * rad)]], k * 1.7, k % 3, kind);
    }
  };

  // 沿著河道一站一站：瀑布把水帶切成上下兩段；流進天窗的地方停
  const lipAt = new Map(falls.map((f) => [f.i, f]));
  const runs = [[]];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (skyEdge(p.x, p.z) < -0.4) break;
    if (p.s < S.r - 0.8) continue;   // 湧泉池裡面：由池子的水面蓋著
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z);
    runs[runs.length - 1].push({ x: p.x, z: p.z, y: p.y + W.depth, tx: (b.x - a.x) / l, tz: (b.z - a.z) / l, u: p.s });
    const f = lipAt.get(i);
    if (f) {
      const q = pts[i + 1], sl = Math.hypot(q.x - p.x, q.z - p.z), st = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, tx: (q.x - p.x) / sl, tz: (q.z - p.z) / sl, u: p.s + 0.5 };
      runs[runs.length - 1].push({ ...st, y: f.top + W.depth, fall: f });
      runs.push([{ ...st, y: f.bottom + W.depth }]);
    }
  }
  let last = null;
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) strip(row(run[i]), row(run[i + 1]), run[i].u, 0, false);
    const end = run[run.length - 1];
    if (end && end.fall) curtain(end, end.y, end.fall.bottom + W.depth, RIVER.fall.throw, 6);
    if (end) last = end;
  }
  // 最後從天窗的缺口沖下去，落在深潭上（落水的地方一圈白沫）
  if (last) {
    const T = RIVER.plunge.throw;
    curtain(last, last.y, 0.3, T, 14);
    disc(last.x + last.tx * T, last.z + last.tz * T, 0.34, 2.8, 8, 3);
  }
  // 湧泉池、瀑布底下的水潭（比河水低一點點，兩片水面疊在一起才不會閃）
  disc(pts[0].x, pts[0].z, pts[0].y + W.depth, S.r - 0.15, 12, 2);
  for (const f of falls) disc(f.bx, f.bz, f.bottom + W.depth - 0.04, RIVER.basin.r + 0.6, 10, 2);

  const geo = fb.build(), col = geo.attributes.color, A = col.array;
  col.setUsage(THREE.DynamicDrawUsage);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  group.add(mesh);
  const deep = new THREE.Color('#1f8fd0'), light = new THREE.Color('#74d2ee'), white = new THREE.Color('#f3fbff');
  const update = (t) => {
    for (const c of cells) {
      let k, w;   // k：深淺（0 深 … 1 淺）；w：白沫（0 … 1）
      if (c.kind === 0) {
        k = 0.5 + 0.5 * Math.sin(c.u * 0.9 - t * 4.2 + c.lane * 2.1);
        const s = Math.sin(c.u * 0.55 - t * 6 + c.lane * 1.7 + Math.sin(c.u * 0.13) * 3);
        w = s > 0 ? s ** 6 * 0.85 : 0;
      } else if (c.kind === 1) { k = 1; w = 0.5 + 0.45 * Math.sin(c.u * 1.5 - t * 12 + c.lane * 2.4); }
      else if (c.kind === 2) { k = 0.35 + 0.25 * Math.sin(t * 1.3 + c.u * 1.9); w = 0; }
      else { k = 1; w = 0.6 + 0.4 * Math.sin(t * 9 + c.u * 2.3); }
      const r = (deep.r + (light.r - deep.r) * k) * (1 - w) + white.r * w;
      const g = (deep.g + (light.g - deep.g) * k) * (1 - w) + white.g * w;
      const b = (deep.b + (light.b - deep.b) * k) * (1 - w) + white.b * w;
      for (let i = c.v0 * 3, e = (c.v0 + c.n) * 3; i < e; i += 3) { A[i] = r; A[i + 1] = g; A[i + 2] = b; }
    }
    col.needsUpdate = true;
  };
  update(0);
  return { update };
}

// ---- 天窗跳水台：木板平台，根在天窗邊的地上，前半截懸在洞口上面 ----
// 一根方木：從 p0 到 p1，斷面寬 w（水平方向）、高 h
function beam(fb, p0, p1, w, h, col) {
  const d = new THREE.Vector3().subVectors(p1, p0).normalize();
  const side = Math.abs(d.y) > 0.95 ? V3(1, 0, 0) : new THREE.Vector3().crossVectors(d, V3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(side, d).normalize();
  const c = [];
  for (const p of [p0, p1]) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) c.push(p.clone().addScaledVector(side, a * w / 2).addScaledVector(up, b * h / 2));
  const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), m = new THREE.Vector3();
  fb.grain = d;
  for (const [i, j, k, l] of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) {
    let a = c[i], b = c[j], q = c[k], s = c[l];
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(q, a));
    m.copy(a).add(q).multiplyScalar(0.5).sub(mid);
    if (n.dot(m) < 0) { const t = b; b = s; s = t; }   // 一律朝外
    fb.tri(a.clone(), b.clone(), q.clone(), col);
    fb.tri(a.clone(), q.clone(), s.clone(), col);
  }
  fb.grain = null;
}
export function buildDive({ P, r, mat, group }) {
  const K = diveDeck(), fb = new FaceBuilder();
  const at = (a, b, y) => V3(K.x + K.ux * a - K.uz * b, y, K.z + K.uz * a + K.ux * b);
  // 台面的木板（一片一片橫著鋪）
  for (let a = 0; a < K.len - 0.01; a += 0.5) {
    const w = K.half * (1 + (r() - 0.5) * 0.06);
    beam(fb, at(a + 0.25, -w, K.y - 0.04), at(a + 0.25, w, K.y - 0.04), 0.46, 0.08, jitter(r() < 0.3 ? P.woodLight : r() < 0.2 ? P.woodGrey : P.wood, r, 0.06));
  }
  for (const b of [-K.half * 0.62, K.half * 0.62]) {
    beam(fb, at(-0.2, b, K.y - 0.2), at(K.len - 0.1, b, K.y - 0.2), 0.16, 0.24, jitter(P.woodDark, r, 0.05));        // 底下兩根長樑
    beam(fb, at(K.rim + 0.3, b, K.y - 3.0), at(K.rim + 3.6, b, K.y - 0.3), 0.14, 0.14, jitter(P.woodDark, r, 0.05));  // 從洞壁斜撐上來
  }
  // 地上那一段兩邊的欄杆（懸空的那一段沒有，助跑、往下跳都不擋）
  for (const b of [-K.half + 0.07, K.half - 0.07]) {
    for (const a of [0.25, K.rim - 0.25]) beam(fb, at(a, b, K.y - 0.6), at(a, b, K.y + 1.0), 0.12, 0.12, jitter(P.woodDark, r, 0.05));
    beam(fb, at(0.25, b, K.y + 0.92), at(K.rim - 0.25, b, K.y + 0.92), 0.08, 0.08, jitter(P.wood, r, 0.05));
  }
  const mesh = new THREE.Mesh(fb.build(), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

// ---- 藤蔓（一串）：樣板的根在原點、往 +y 長到 1（越往 +y 晃得越多）；擺的時候整個倒過來掛，根在上面、尾巴垂下去 ----
export function vineGeo(P, seed) {
  const r = rng(seed), fb = new FaceBuilder(), SW = [3.5, 3.5, 3.5];
  const stem = P.trunk.clone().lerp(P.grassDark, 0.6), leaves = [P.leaf2, P.grassDark, P.leaf, P.moss];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (let s = 0, strands = 2 + (seed % 2); s < strands; s++) {
    const ox = s === 0 ? 0 : (r() - 0.5) * 0.3, oz = s === 0 ? 0 : (r() - 0.5) * 0.14, len = s === 0 ? 1 : 0.45 + r() * 0.45, N = 6, R = 0.014;
    const node = (k) => { const y = (len * k) / N; return V3(ox + Math.sin(y * 7 + s * 2.1) * 0.05, y, oz + Math.cos(y * 5 + s) * 0.04); };
    for (let k = 0; k < N; k++) {
      const a = node(k), b = node(k + 1);
      // 莖：三角柱
      for (let j = 0; j < 3; j++) {
        const a0 = j * 2.0944, a1 = (j + 1) * 2.0944, o0 = V3(Math.cos(a0) * R, 0, Math.sin(a0) * R), o1 = V3(Math.cos(a1) * R, 0, Math.sin(a1) * R);
        let p0 = a.clone().add(o0), p1 = a.clone().add(o1), q0 = b.clone().add(o0), q1 = b.clone().add(o1);
        n.crossVectors(e1.subVectors(q0, p0), e2.subVectors(p1, p0));
        if (n.dot(o0) + n.dot(o1) < 0) { let t = p0; p0 = p1; p1 = t; t = q0; q0 = q1; q1 = t; }   // 朝外
        fb.tri(p0, q0, p1.clone(), stem, SW);
        fb.tri(p1, q0.clone(), q1, stem, SW);
      }
      // 葉子：每一節一兩片，往旁邊伸、尖端朝尾巴垂（雙面都畫）
      for (let i = 0, m = 1 + (r() < 0.6 ? 1 : 0); i < m; i++) {
        const u = r(), base = a.clone().lerp(b, u), ang = r() * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang), w = 0.07 + r() * 0.05;
        const b0 = base.clone().add(V3(-dz * w * 0.5, -0.012, dx * w * 0.5)), b1 = base.clone().add(V3(dz * w * 0.5, -0.012, -dx * w * 0.5));
        const tip = base.clone().add(V3(dx * (0.1 + r() * 0.06), 0.035 + r() * 0.03, dz * (0.1 + r() * 0.06)));
        const col = jitter(leaves[Math.floor(r() * leaves.length)], r, 0.08);
        fb.tri(b0.clone(), b1.clone(), tip.clone(), col, SW);
        fb.tri(b0, tip, b1, col, SW);
      }
    }
  }
  return fb.build();
}
