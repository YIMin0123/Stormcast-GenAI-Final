// 樣板形狀：岩塊（只有 3 種形狀，靠翻轉、鏡像、拉伸、埋深複用）、闊葉樹、草叢、地形。
// 全部都是「每面一色」的幾何，交給 kit.js 的同一個材質畫。
import * as THREE from 'three';
import { FaceBuilder, rng, fbm } from './kit.js';
import { jitter } from './palette.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 同一個位置的頂點要移一樣的量（相鄰的面才接得起來，不會裂開）
function weldJitter(geo, f) {
  const pos = geo.attributes.position, v = new THREE.Vector3(), memo = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let o = memo.get(key);
    if (!o) memo.set(key, (o = f(v.clone())));
    pos.setXYZ(i, o.x, o.y, o.z);
  }
  return geo;
}

// 依法線決定的亂數：同一個平面上的小三角形拿到同一個顏色（切面看起來是一整塊）
function normalKey(n) { return Math.round(n.x * 9) * 7919 + Math.round(n.y * 9) * 104729 + Math.round(n.z * 9) * 1299709; }

// ---- 岩塊：一顆球用幾個隨機的平面切掉，切口就是大塊的平面 ----
// kind 0 圓塊、1 高塊（拉高變岩柱）、2 扁塊（壓扁變礁岩）。底部也是完整的，翻過來不會露出平底
export function rockGeo(kind, P, seed) {
  const r = rng(seed);
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const scl = [new THREE.Vector3(1.15, 0.9, 1), new THREE.Vector3(0.85, 1.35, 0.9), new THREE.Vector3(1.3, 0.6, 1.1)][kind];
  const cuts = [];
  for (let i = 0; i < 9; i++) {
    const n = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    cuts.push({ n, d: 0.62 + r() * 0.25 });
  }
  weldJitter(geo, (v) => {
    v.normalize().multiplyScalar(0.92 + 0.16 * fbm(v.x * 2 + seed, v.z * 2 + v.y * 1.7));
    for (const c of cuts) { const k = v.dot(c.n); if (k > c.d) v.addScaledVector(c.n, c.d - k); }
    return v.multiply(scl);
  });
  const base = [P.rock, P.rock2, P.rockWarm][kind];
  const fb = new FaceBuilder();
  const cache = new Map();
  fb.addGeometry(geo, (m, n) => {
    const k = normalKey(n);
    if (!cache.has(k)) cache.set(k, jitter(base, rng(k ^ seed), 0.09));
    return cache.get(k);
  });
  return fb.build();
}

// ---- 闊葉樹：一根樹幹（分一兩根枝）＋幾個不規則多面體疊成的樹冠，近看有小塊面增加層次 ----
export function broadleafGeo(P, seed) {
  const r = rng(seed);
  const fb = new FaceBuilder();
  const h = 3.2 + r() * 1.4;
  const lean = new THREE.Vector3((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5);
  // 樹幹：五角柱，往上變細，稍微歪
  const trunk = new THREE.CylinderGeometry(0.16, 0.3, h, 5, 2);
  trunk.translate(0, h / 2, 0);
  weldJitter(trunk, (v) => v.addScaledVector(lean, (v.y / h) ** 1.5));
  fb.addGeometry(trunk, (m, n, i) => jitter(P.trunk, rng(seed + i), 0.07), () => 0.3);
  // 兩根斜枝
  for (let b = 0; b < 2; b++) {
    const a = r() * Math.PI * 2, len = 1.1 + r() * 0.6;
    const br = new THREE.CylinderGeometry(0.06, 0.12, len, 4, 1);
    br.translate(0, len / 2, 0);
    br.rotateZ(0.8 + r() * 0.3); br.rotateY(a);
    br.translate(lean.x * 0.6, h * (0.55 + r() * 0.15), lean.z * 0.6);
    fb.addGeometry(br, (m, n, i) => jitter(P.trunk, rng(seed * 3 + i), 0.07), () => 0.3);
  }
  // 樹冠：一個大的在中間，四周幾個中的，再撒幾個小的
  const top = new THREE.Vector3(lean.x, h, lean.z);
  const blobs = [{ c: top.clone().add(new THREE.Vector3(0, 0.9, 0)), s: 1.55 }];
  const nMid = 4 + Math.floor(r() * 2);
  for (let i = 0; i < nMid; i++) {
    const a = (i / nMid) * Math.PI * 2 + r() * 0.6;
    blobs.push({ c: top.clone().add(new THREE.Vector3(Math.cos(a) * 1.15, 0.2 + r() * 0.9, Math.sin(a) * 1.15)), s: 0.95 + r() * 0.35 });
  }
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2;
    blobs.push({ c: top.clone().add(new THREE.Vector3(Math.cos(a) * 1.8, -0.2 + r() * 1.6, Math.sin(a) * 1.8)), s: 0.45 + r() * 0.2 });
  }
  const leaves = [P.leaf, P.leaf2, P.leaf3];
  blobs.forEach((bl, bi) => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const rr = rng(seed * 17 + bi);
    weldJitter(g, (v) => v.multiplyScalar(0.8 + rr() * 0.4));
    g.scale(bl.s, bl.s * (0.75 + rr() * 0.2), bl.s);
    g.rotateY(rr() * 6.28);
    g.translate(bl.c.x, bl.c.y, bl.c.z);
    const base = leaves[Math.floor(rr() * 3)];
    fb.addGeometry(g, (m, n, i) => jitter(base, rng(seed * 31 + bi * 100 + i), 0.06), () => 0.3);
  });
  return fb.build();
}

// ---- 草叢：幾片三角形的草葉圍成一小叢（正反兩面都畫），離鏡頭遠了縮小到消失 ----
export function tuftGeo(P, seed) {
  const r = rng(seed);
  const fb = new FaceBuilder();
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.5;
    const h = 0.2 + r() * 0.18, w = 0.05 + r() * 0.03, out = 0.08 + r() * 0.07;
    const cx = Math.cos(a) * 0.05, cz = Math.sin(a) * 0.05;
    const px = -Math.sin(a), pz = Math.cos(a);
    const A = new THREE.Vector3(cx - px * w, 0, cz - pz * w);
    const B = new THREE.Vector3(cx + px * w, 0, cz + pz * w);
    const T = new THREE.Vector3(cx + Math.cos(a) * out, h, cz + Math.sin(a) * out);
    const base = jitter(P.tuft, r, 0.08), tip = jitter(P.tuftTip, r, 0.08);
    fb.tri(A, B, T, base, [3, 3, 3], 1, [base, base, tip]);
    fb.tri(B, A, T, base, [3, 3, 3], 1, [base, base, tip]);
  }
  return fb.build();
}

// ---- 地形：格點隨機錯開、每格的對角線方向隨機，三角形大小方向都不一樣；每個三角形一個顏色 ----
export function heightAt(x, z) {
  const r = Math.hypot(x * 0.9, z * 1.1);
  const n = fbm(x * 0.02 + 3, z * 0.02 + 7);
  let h = 12 * (1 - smooth(20, 58, r + (n - 0.5) * 24)) - 2.6;
  // 北邊（z 小的那側）一道斷崖，上面是台地
  const cl = smooth(-7, -3, -z + (fbm(x * 0.05, z * 0.05) - 0.5) * 10);
  h += 7.5 * cl * (1 - smooth(22, 46, r));
  h += (fbm(x * 0.08 + 11, z * 0.08) - 0.5) * 2.2;
  return h;
}
// hf：高度函式（預設是樣品島）；cx、cz：這塊地形的中心
// paint(x, z, y, 法線)：要特別上色的面（小路等）回傳顏色，其他回傳 null
export function terrainGeo(P, size = 170, step = 2.8, seed = 5, hf = heightAt, cx = 0, cz = 0, paint = null) {
  const r = rng(seed);
  const N = Math.round(size / step), half = size / 2;
  const pts = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const edge = i === 0 || j === 0 || i === N || j === N;
    const x = cx - half + i * step + (edge ? 0 : (r() - 0.5) * step * 0.7);
    const z = cz - half + j * step + (edge ? 0 : (r() - 0.5) * step * 0.7);
    pts.push(new THREE.Vector3(x, hf(x, z), z));
  }
  const at = (i, j) => pts[j * (N + 1) + i];
  const fb = new FaceBuilder();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const face = (a, b, c) => {
    nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    const cy = (a.y + b.y + c.y) / 3, cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
    const patch = fbm(cx * 0.05 + 40, cz * 0.05);
    let col;
    if (cy < 0.35) col = P.sandWet;
    else if (cy < 1.5 && nrm.y > 0.8) col = P.sand;
    else if (nrm.y < 0.74) col = nrm.y < 0.55 ? P.cliff : P.rock2;
    else col = patch < 0.42 ? P.grassDark : patch < 0.55 ? P.grass2 : P.grass;
    if (paint) { const c2 = paint(cx, cz, cy, nrm); if (c2) col = c2; }
    fb.tri(a, b, c, jitter(col, r, 0.05), [0, 0, 0], 0.25);   // 0.25：地形的記號（不打邊緣光）
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    if (r() < 0.5) { face(a, c, b); face(b, c, d); } else { face(a, c, d); face(a, d, b); }
  }
  return fb.build();
}

// ---- 岩架：懸崖上一層一層的扁岩板（從上面看是不規則的多邊形，上緣削一圈斜角，側面一圈深色的底） ----
// 模型是 x、z 各 ±1、高 0～1 的大小，擺的時候再拉成需要的長、寬、厚。top：頂面的顏色（岩石或長了苔）
export function ledgeGeo(P, seed, top) {
  const r = rng(seed), fb = new FaceBuilder(), n = 9;
  const rad = [], V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (let i = 0; i < n; i++) rad.push(0.82 + r() * 0.3);
  const ring = (k, y, jy) => rad.map((q, i) => { const a = (i / n) * Math.PI * 2 + 0.15; return V(Math.cos(a) * q * k, y + (r() - 0.5) * jy, Math.sin(a) * q * k); });
  const bot = ring(0.86, 0, 0), mid = ring(1.0, 0.86, 0.1), up = ring(0.88, 0.98, 0.1), cen = V(0, 1.0, 0);
  const side = P.rock2, under = P.rock2.clone().multiplyScalar(0.72), lip = P.rock.clone(), cap = top;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const c = side.clone().multiplyScalar(0.92 + r() * 0.16);
    fb.tri(bot[i], mid[i], mid[j], i % 3 ? c : under); fb.tri(bot[i], mid[j], bot[j], i % 3 ? c : under);   // 側面（往下收）
    fb.tri(mid[i], up[i], up[j], lip); fb.tri(mid[i], up[j], mid[j], lip);                                  // 上緣的斜角
    fb.tri(up[i], cen, up[j], cap.clone().multiplyScalar(0.94 + r() * 0.12));                                // 頂面
    fb.tri(bot[j], V(0, 0, 0), bot[i], under);                                                               // 底面
  }
  return fb.build();
}

// ---- 母島的地形（比上面那個細）：格子 step 公尺、陡坡做成一層層的岩架 ----
// 回傳 { geo, at(x, z) → 畫出來的那張三角面在這一點的高度, kind(x, z) → 這一點那一面的種類（'shore' 'sand' 'cliff' 'grass'） }。
// 草、樹、石頭、人物的腳都照 at() 站，才會貼在看得到的地面上（不是照平滑的高度算式，那個跟一面一面的三角形差好幾十公分）
// 陡坡（坡度超過 37 度，連海岸的陡壁也算）：高度一層一層地分（每層 BAND 公尺，分界跟著雜訊起伏），每層是一段緩的岩架接一段陡的岩壁，
// 岩壁的顏色照它在哪一層輪流換灰褐色（看起來是一層層的岩層），岩架上夠平的地方照樣長草
export function islandTerrain(P, size, step, seed, hf, cx, cz) {
  const r = rng(seed);
  const N = Math.round(size / step), half = size / 2, x0 = cx - half, z0 = cz - half;
  const BAND = 1.5;
  const X = new Float32Array((N + 1) * (N + 1)), Y = new Float32Array(X.length), Z = new Float32Array(X.length);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const edge = i === 0 || j === 0 || i === N || j === N;
    const x = x0 + i * step + (edge ? 0 : (r() - 0.5) * step * 0.7);
    const z = z0 + j * step + (edge ? 0 : (r() - 0.5) * step * 0.7);
    let h = hf(x, z);
    if (!edge) {
      const e = 0.8, gx = (hf(x + e, z) - hf(x - e, z)) / (2 * e), gz = (hf(x, z + e) - hf(x, z - e)) / (2 * e);
      const w = smooth(0.62, 1.1, Math.hypot(gx, gz)) * smooth(-1.2, 0.2, h);   // 海岸的陡壁也分層（水面下一點開始）
      if (w > 0) {
        const off = (fbm(x * 0.06 + 13, z * 0.06) - 0.5) * 1.2;   // 岩層的分界不是水平的一刀，跟著雜訊微微起伏
        const t = h / BAND + off, k = Math.floor(t), f = t - k;
        const g = f < 0.5 ? f * 0.3 : 0.15 + ((f - 0.5) / 0.5) * 0.85;   // 前半段是緩的岩架、後半段是陡的岩壁
        h += ((k + g - off) * BAND - h) * w * 0.9;
      }
    }
    const q = j * (N + 1) + i; X[q] = x; Y[q] = h; Z[q] = z;
  }
  const V3 = (q) => new THREE.Vector3(X[q], Y[q], Z[q]);
  const diag = new Uint8Array(N * N), kinds = new Uint8Array(N * N * 2);   // 每一格怎麼切、每個三角形的種類
  const KIND = ['shore', 'sand', 'cliff', 'grass'];
  const strata = [P.rock2, P.rockWarm.clone().multiplyScalar(0.92), P.rock.clone().multiplyScalar(0.88), P.cliff.clone().lerp(P.rock2, 0.6).multiplyScalar(0.85)];
  const fb = new FaceBuilder();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const face = (a, b, c, slot) => {
    nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    const cy = (a.y + b.y + c.y) / 3, fx = (a.x + b.x + c.x) / 3, fz = (a.z + b.z + c.z) / 3;
    const patch = fbm(fx * 0.05 + 40, fz * 0.05);
    let col, kind;
    if (nrm.y < 0.74 && cy > -1.5) {
      kind = 2;
      // 岩壁：照它在第幾層輪流換顏色（分界跟地形分層同一套雜訊），很陡的再暗一點
      const layer = Math.floor(cy / (BAND * 0.5) + (fbm(fx * 0.06 + 13, fz * 0.06) - 0.5) * 2.4);
      col = strata[((layer % 4) + 4) % 4];
      if (nrm.y < 0.4) col = col.clone().multiplyScalar(0.9);
      if (cy < 0.5) col = col.clone().multiplyScalar(0.82);   // 水線附近濕的、顏色深一點
    } else if (cy < 0.35) { col = P.sandWet; kind = 0; }
    else if (cy < 1.5 && nrm.y > 0.8) { col = P.sand; kind = 1; }
    else { col = patch < 0.42 ? P.grassDark : patch < 0.55 ? P.grass2 : P.grass; kind = 3; }
    kinds[slot] = kind;
    fb.tri(a, b, c, jitter(col, r, 0.05), [0, 0, 0], 0.25);   // 0.25：地形的記號（不打邊緣光）
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const qa = j * (N + 1) + i, a = V3(qa), b = V3(qa + 1), c = V3(qa + N + 1), d = V3(qa + N + 2), cell = j * N + i;
    if (r() < 0.5) { diag[cell] = 0; face(a, c, b, cell * 2); face(b, c, d, cell * 2 + 1); } else { diag[cell] = 1; face(a, c, d, cell * 2); face(a, d, b, cell * 2 + 1); }
  }
  // 這一點落在哪個三角形：頂點有抖動，所以看附近 3×3 格
  const tri = (qa, qb, qc, x, z) => {
    const d = (Z[qb] - Z[qc]) * (X[qa] - X[qc]) + (X[qc] - X[qb]) * (Z[qa] - Z[qc]);
    const l1 = ((Z[qb] - Z[qc]) * (x - X[qc]) + (X[qc] - X[qb]) * (z - Z[qc])) / d, l2 = ((Z[qc] - Z[qa]) * (x - X[qc]) + (X[qa] - X[qc]) * (z - Z[qc])) / d, l3 = 1 - l1 - l2;
    return l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6 ? l1 * Y[qa] + l2 * Y[qb] + l3 * Y[qc] : null;
  };
  let lastSlot = -1;
  const find = (x, z) => {
    const ci = Math.floor((x - x0) / step), cj = Math.floor((z - z0) / step);
    for (let dj = 0; dj <= 2; dj++) for (let di = 0; di <= 2; di++) {
      const i = ci + (di === 2 ? -1 : di), j = cj + (dj === 2 ? -1 : dj);   // 先看自己那格
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const qa = j * (N + 1) + i, qb = qa + 1, qc = qa + N + 1, qd = qa + N + 2, cell = j * N + i;
      const [t0, t1] = diag[cell] === 0 ? [[qa, qc, qb], [qb, qc, qd]] : [[qa, qc, qd], [qa, qd, qb]];
      let y = tri(t0[0], t0[1], t0[2], x, z); if (y !== null) { lastSlot = cell * 2; return y; }
      y = tri(t1[0], t1[1], t1[2], x, z); if (y !== null) { lastSlot = cell * 2 + 1; return y; }
    }
    lastSlot = -1;
    return null;
  };
  const at = (x, z) => { const y = find(x, z); return y === null ? hf(x, z) : y; };
  const kind = (x, z) => (find(x, z) === null ? groundKind(x, z, hf) : KIND[kinds[lastSlot]]);
  return { geo: fb.build(), at, kind };
}

// 地面的種類（擺放物件用；跟上色同一套規則）
export function groundKind(x, z, hf = heightAt) {
  const h = hf(x, z), e = 0.6;
  const nx = hf(x - e, z) - hf(x + e, z), nz = hf(x, z - e) - hf(x, z + e);
  const ny = (2 * e) / Math.hypot(nx, 2 * e, nz);
  if (h < 0.35) return 'shore';
  if (h < 1.5 && ny > 0.8) return 'sand';
  if (ny < 0.74) return 'cliff';
  return 'grass';
}

// ---- 海面（暫時的：平塗大三角形，海面的畫法是之後另外討論的題目）----
export function waterGeo(P, size = 700, step = 14, seed = 9) {
  const r = rng(seed);
  const N = Math.round(size / step), half = size / 2;
  const fb = new FaceBuilder();
  const v = (i, j) => new THREE.Vector3(-half + i * step, 0, -half + j * step);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1);
    fb.tri(a, c, b, jitter(P.water, r, 0.025), [0, 0, 0], 2);
    fb.tri(b, c, d, jitter(P.water, r, 0.025), [0, 0, 0], 2);
  }
  return fb.build();
}
