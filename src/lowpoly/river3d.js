// 大港灣島的山澗小河、瀑布、天窗跳水台、藤蔓的模型（大港座標，位置和尺寸見 havenPlan.js 的 RIVER、DIVE、VINES）。
//   河水、瀑布、水潭是一張水面的網格，用跟海面同一種水的材質畫（見 renderShaders.js 的 riverVert、riverFrag）：
//     這裡只負責形狀，和每個頂點上「水往哪邊流、流多快、水多深、白沫多不多」這幾個數字，動起來是材質自己算的
//   跳水台、藤蔓交給全場共用的那個低面材質畫；藤蔓只是裝飾（不能爬），照材質原本的隨風擺動晃
import * as THREE from 'three';
import { FaceBuilder, rng } from './kit.js';
import { jitter } from './palette.js';
import { riverPath, riverFalls, skyEdge, diveDeck, springEdge, basinEdge } from './havenShape.js';
import { RIVER } from './havenPlan.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---- 河水、瀑布、水潭 ----
// groundAt(x, z)：畫出來的地面多高（水邊在哪裡、水多深照它算）；water：水的材質（遊戲那邊給的，見 haven.js），沒給（範例頁）就用一片半透明的水色頂著
export function buildRiver({ group, groundAt, water }) {
  const pts = riverPath(), falls = riverFalls(), W = RIVER.water, S = RIVER.spring;
  const pos = [], pat = [], dir = [], wv = [], idx = [];
  // 一個頂點：p 紋路座標、f 紋路每秒流多遠、d (紋路 y 軸在地上的方向 x, z, 暴漲時這一點跟著漲幾成)、w (水深, 種類, 白沫, 邊緣淡出)
  const vert = (x, y, z, p, f, d, w) => { pos.push(x, y, z); pat.push(p[0], p[1], f[0], f[1]); dir.push(d[0], d[1], d[2]); wv.push(w[0], w[1], w[2], w[3]); return pos.length / 3 - 1; };
  // 一排一排的頂點（每排一樣多個）縫成一張面
  const sew = (rows) => {
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < rows[i].length - 1; j++) {
      const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j], d = rows[i + 1][j + 1];
      idx.push(a, c, b, b, c, d);
    }
  };
  const depthAt = (x, y, z) => Math.max(-1.5, Math.min(1.5, y - groundAt(x, z)));   // 這一點的水有多深（水面在地面底下是負的；暴漲時材質會把漲的高度加上去）
  // 從 (x, z) 往 (dx, dz) 走，高 y 的水面在幾公尺外碰到岸；max 公尺內都沒碰到（那一側沒有岸擋著）回傳 null
  const shore = (x, z, dx, dz, y, max) => { for (let d = 0.3; d <= max; d += 0.15) if (groundAt(x + dx * d, z + dz * d) > y) return d; return null; };
  const BANK = 0.3;   // 水面鋪到岸裡面多遠（水邊那條線由地面切出來）
  // 岸量的是暴漲時的水面碰到的地方（平常多出來的那一截埋在岸裡看不到）；暴漲時那一側擋不住，就退回平常的岸再多鋪一點、最外面淡出
  const RISE = RIVER.flood.rise;
  const bank = (x, z, dx, dz, y, max) => { const hi = shore(x, z, dx, dz, y + RISE, max); if (hi !== null) return [hi + BANK, 1]; const lo = shore(x, z, dx, dz, y, max); return lo !== null ? [lo + BANK + 0.6, 0] : [null, 0]; };

  // 沿著河道一站一站鋪成一條連續的水面：湧泉池、河道、瀑布底下的水潭都是它（每一站左右各自量到岸多遠，池子的地方自然就寬），
  // 中間沒有另外接上去的水面，所以沒有接縫。只有瀑布把它切成上下兩段；流進天窗的地方停。
  // 一站：{ x, z, y 水面高度, tx / tz 往下游, u 沿河的距離, slope 多陡, pond 在池子裡幾成（水流得慢、水紋不拉長）, reach 最遠量到多遠 }
  const B = RIVER.basin, p0 = pts[0], l0 = Math.hypot(pts[1].x - p0.x, pts[1].z - p0.z), t0 = [(pts[1].x - p0.x) / l0, (pts[1].z - p0.z) / l0];
  const pondAt = (x, z) => Math.max(1 - smooth(-1, 1.5, springEdge(x, z)), ...falls.map((f) => 1 - smooth(-0.5, 1.5, basinEdge(f, x, z))));
  const station = (x, z, y, tx, tz, u, slope) => { const pond = pondAt(x, z); return { x, z, y, tx, tz, u, slope, pond, reach: RIVER.flat + 2.6 + pond * (Math.max(S.r, B.r) * 1.4 + 0.5) }; };
  const lipAt = new Map(falls.map((f) => [f.i, f]));
  const runs = [[]], hitOf = new Map([[runs[0], { at: [p0.x, p0.z], k: 0.25 }]]);   // 每一段的水從哪裡冒出來／沖下來（那裡翻白）
  // 湧泉池在源頭後面的那一半：往上游多鋪幾站
  for (let k = Math.ceil(S.r * 1.4) + 1; k >= 1; k--) runs[0].push(station(p0.x - t0[0] * k, p0.z - t0[1] * k, p0.y + W.depth, t0[0], t0[1], -k, 0));
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (skyEdge(p.x, p.z) < -0.4) break;
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z);
    runs[runs.length - 1].push(station(p.x, p.z, p.y + W.depth, (b.x - a.x) / l, (b.z - a.z) / l, p.s, Math.max(0, (a.y - b.y) / l)));
    const f = lipAt.get(i);
    if (f) {
      // 瀑布口：上面那一段停在崖邊，下面那一段從崖腳（水潭的水面）接著鋪
      const q = pts[i + 1], sl = Math.hypot(q.x - p.x, q.z - p.z), tx = (q.x - p.x) / sl, tz = (q.z - p.z) / sl, mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
      runs[runs.length - 1].push({ ...station(mx, mz, f.top + W.depth, tx, tz, p.s + 0.5, 0.6), fall: f });
      const next = [station(mx, mz, f.bottom + W.depth, tx, tz, p.s + 0.5, 0)];
      hitOf.set(next, { at: [mx + tx * RIVER.fall.throw, mz + tz * RIVER.fall.throw], k: 1.4 });   // 水簾落在水潭的哪裡
      runs.push(next);
    }
  }

  // 一排 13 個點（靠岸的地方密一點，水邊才利落）：左右各自量到岸多遠、鋪到岸裡面一點點（水邊在哪裡由地面決定，不是一條直直的邊）；那一側量不到岸就只鋪到 OPEN 公尺、最外面那一排淡出
  const LANES = [-1, -0.92, -0.8, -0.6, -0.38, -0.18, 0, 0.18, 0.38, 0.6, 0.8, 0.92, 1], OPEN = W.half + 0.3;
  let last = null;
  for (const run of runs) {
    if (run.length < 2) continue;
    const tail = run[run.length - 1], hit = hitOf.get(run);
    sew(run.map((st) => {
      const speed = Math.min(6.5, 1.4 + 10 * st.slope) * (1 - 0.75 * st.pond);
      // 陡的地方翻白；快到瀑布口也是
      const steep = Math.max(0.85 * smooth(0.1, 0.5, st.slope), tail.fall ? 0.6 * Math.exp(-(tail.u - st.u) / 1.3) : 0);
      // 左岸、右岸。快到瀑布口的那幾站就在崖邊（兩旁的地面往下掉，量到的岸不準）：最寬只到水簾那麼寬
      let sides = [bank(st.x, st.z, st.tz, -st.tx, st.y, st.reach), bank(st.x, st.z, -st.tz, st.tx, st.y, st.reach)];
      if (tail.fall && tail.u - st.u < 3) sides = sides.map(([v, e]) => [Math.min(v ?? 9, W.half * 1.1 + (tail.u - st.u) * 0.5), e]);
      return LANES.map((L) => {
        const [s, solid] = sides[L < 0 ? 0 : 1], lat = L * (s === null ? OPEN : s), x = st.x - st.tz * lat, z = st.z + st.tx * lat;
        const white = hit ? Math.max(steep, hit.k * Math.exp(-Math.hypot(x - hit.at[0], z - hit.at[1]) / 2.4)) : steep;
        return vert(x, st.y, z, [lat, st.u], [0, speed], [st.tx, st.tz, 1], [depthAt(x, st.y, z), -st.pond, white, !solid && Math.abs(L) === 1 ? 0 : 1]);
      });
    }));
    last = tail;
  }

  // 落進深潭的那一圈白沫：一圈一圈的同心圓，波紋從中間往外推，越外面越淡
  const RINGS = [0, 0.3, 0.55, 0.75, 0.9, 1], SEG = 20;
  const splash = (x, z, y, rad, speed, white) => {
    sew(RINGS.map((k) => {
      const row = [];
      for (let j = 0; j <= SEG; j++) {
        const a = (j / SEG) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), px = x + c * rad * k, pz = z + sn * rad * k;
        row.push(vert(px, y, pz, [-px, pz], [-c * speed, sn * speed], [0, 1, 0], [0.4, 3, white * Math.exp(-rad * k / 1.7), 1 - smooth(0.45, 1, k)]));
      }
      return row;
    }));
  };

  // 水簾：從 st 往前拋 thr 公尺、從 yTop 落到 yBot（拋物線），分 n 段；越往下掉越快。兩邊淡出
  const FALL = [-1.1, -0.8, -0.4, 0, 0.4, 0.8, 1.1];
  // pin：底下是不是落在海面上（那一頭不跟著暴漲）
  const curtain = (st, yTop, yBot, thr, n, pin) => {
    let arc = 0, py = yTop, pf = 0;
    const rows = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n, y = yTop - (yTop - yBot) * t * t, fwd = thr * t, wide = 1 - 0.15 * t;
      arc += Math.hypot(py - y, fwd - pf); py = y; pf = fwd;
      rows.push(FALL.map((L, j) => vert(st.x + st.tx * fwd - st.tz * L * W.half * wide, y, st.z + st.tz * fwd + st.tx * L * W.half * wide,
        [L * W.half, st.u + arc], [0, 3.5 + 7 * t], [st.tx, st.tz, pin ? 1 - t * t : 1], [0.45, 1, 1, j === 0 || j === FALL.length - 1 ? 0 : 1])));
    }
    sew(rows);
  };
  for (const run of runs) { const end = run[run.length - 1]; if (end && end.fall) curtain(end, end.y, end.fall.bottom + W.depth, RIVER.fall.throw, 7, false); }
  // 最後從天窗的缺口沖下去，落在深潭上（落水的地方一圈白沫）
  if (last) {
    const T = RIVER.plunge.throw, hx = last.x + last.tx * T, hz = last.z + last.tz * T;
    splash(hx, hz, 0.34, 3.4, 1.3, 1.6);
    curtain(last, last.y, 0.3, T, 14, true);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aPat', new THREE.Float32BufferAttribute(pat, 4));
  geo.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  geo.setAttribute('aW', new THREE.Float32BufferAttribute(wv, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, water || new THREE.MeshBasicMaterial({ color: 0x3fb9c6, transparent: true, opacity: 0.72, side: THREE.DoubleSide }));
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.renderOrder = 2.2;   // 在海面之後畫：落進深潭的水簾和白沫蓋在海面上
  group.add(mesh);
  return mesh;
}

// ---- 天窗跳水台：木板平台，根在天窗邊的地上，前半截懸在洞口上面 ----
// 一根方木：從 p0 到 p1，斷面寬 w（水平方向）、高 h
export function beam(fb, p0, p1, w, h, col) {
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
