// 魚箱的容量（瀏覽器和伺服器共用，只有算式）：照魚模型的實際大小放，魚越大越快滿；比箱子長的放不進去
import { SPECIES } from './fishdata.js';
import { FISHBOX } from './config.js';

// 一條魚佔多少體積（立方公尺）：身長 × 身高 × 身寬，魚是紡錘形，大約只佔外框的一半
export function fishVolume(id, len) {
  const sp = SPECIES[id];
  if (!sp) return 0;
  return len * (len * (sp.h || 0.25)) * (len * (sp.w || 0.12)) * 0.5;
}
// 箱子能裝的體積
export const BOX_VOLUME = FISHBOX.w * FISHBOX.d * FISHBOX.h * FISHBOX.fill;
// 最長放得進去的魚：斜斜放在箱底的對角線
export const BOX_LONGEST = Math.hypot(FISHBOX.w, FISHBOX.d);

// 這條魚放不放得進這個箱子。list：箱子裡已經有的魚 [{ id, len }]。回傳 '' 放得進去；'long' 太長；'full' 滿了
export function boxFit(list, id, len) {
  if (len > BOX_LONGEST) return 'long';
  const used = list.reduce((s, f) => s + fishVolume(f.id, f.len), 0);
  return used + fishVolume(id, len) > BOX_VOLUME ? 'full' : '';
}
// 箱子滿了幾成（0–1）
export const boxUsed = (list) => Math.min(1, list.reduce((s, f) => s + fishVolume(f.id, f.len), 0) / BOX_VOLUME);
// 抱著這箱魚走路是平常的幾倍速度
export const boxSpeed = (kg) => Math.max(FISHBOX.slowest, 1 - (1 - FISHBOX.slowest) * Math.min(1, kg / FISHBOX.heavy));

export const BOX_WALL = 0.04;   // 箱壁與箱底木板厚度（fishBox.js 共用）

/** 射線與箱子本地軸向包圍盒 [x0..x1] × [y0..y1] × [z0..z1] 的交點 { tIn, tOut } */
export function rayAabb(ox, oy, oz, dx, dy, dz, x0, x1, y0, y1, z0, z1, tMin = 0) {
  let lo = tMin, hi = Infinity;
  const slab = (o, d, a, b) => {
    if (Math.abs(d) < 1e-8) return o >= a && o <= b;
    let t1 = (a - o) / d, t2 = (b - o) / d;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > lo) lo = t1;
    if (t2 < hi) hi = t2;
    return lo <= hi;
  };
  if (!slab(ox, dx, x0, x1) || !slab(oy, dy, y0, y1) || !slab(oz, dz, z0, z1)) return null;
  return { tIn: Math.max(tMin, lo), tOut: hi };
}

/** 射線段 [lo, hi] 到本地軸向包圍盒的最小 3D 距離（凸距離函式做三分搜尋，直接命中為 0） */
export function distRayToAabb(ox, oy, oz, dx, dy, dz, x0, x1, y0, y1, z0, z1, lo, hi) {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const d2 = (t) => {
    const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
    const cx = clamp(px, x0, x1) - px, cy = clamp(py, y0, y1) - py, cz = clamp(pz, z0, z1) - pz;
    return cx * cx + cy * cy + cz * cz;
  };
  let a = lo, b = hi;
  for (let i = 0; i < 12; i++) {
    const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618;
    if (d2(m1) <= d2(m2)) b = m2; else a = m1;
  }
  return Math.sqrt(d2((a + b) * 0.5));
}

/**
 * 判斷視線在單一魚箱本地座標系下對準「抱起／放進魚箱 (fbox)」還是「拿箱內的魚 (fpile)」：
 * - 先照外框最近距離算可及範圍（站兩端也能拿，不再只算中心點）
 * - 先撞到四面木板壁、把手或頂部框緣（4cm 木壁）→ fbox，木板遮住後方的魚不互相干擾
 * - 視線由上口直接望進開口內且命中魚身（或寬容範圍內）→ fpile 並帶出命中的那一條魚
 */
export function pickBoxLocal(ray, pLocal, fishBoxes = [], { fp = true, wantOut = false, putOnly = false } = {}) {
  const { ox, oy, oz, dx, dy, dz, tMin = 0 } = ray;
  const hx = FISHBOX.w / 2 + BOX_WALL, hz = FISHBOX.d / 2 + BOX_WALL, H = FISHBOX.h + BOX_WALL;
  const rx = Math.max(0, Math.abs(pLocal.x) - hx), rz = Math.max(0, Math.abs(pLocal.z) - hz);
  if (Math.hypot(rx, rz) > FISHBOX.reach || Math.abs(pLocal.y) > 2.2) return null;

  const exact = rayAabb(ox, oy, oz, dx, dy, dz, -hx, hx, 0, H, -hz, hz, tMin);
  const h1 = rayAabb(ox, oy, oz, dx, dy, dz, -hx - 0.01, hx + 0.01, H * 0.50, H * 0.74, -hz - 0.04, -hz, tMin);
  const h2 = rayAabb(ox, oy, oz, dx, dy, dz, -hx - 0.01, hx + 0.01, H * 0.50, H * 0.74, hz, hz + 0.04, tMin);
  const minHandleT = Math.min(h1 ? h1.tIn : Infinity, h2 ? h2.tIn : Infinity);
  const handleEarlier = minHandleT < (exact ? exact.tIn - 1e-4 : Infinity);

  if (wantOut && !putOnly && fishBoxes.length && exact && !handleEarlier) {
    const ey = oy + dy * exact.tIn, ex = ox + dx * exact.tIn, ez = oz + dz * exact.tIn;
    const mx = FISHBOX.w / 2, mz = FISHBOX.d / 2;
    const enterMouth = exact.tIn > tMin + 1e-4 && oy > H - 0.05 && dy < -0.02
      && Math.abs(ey - H) < 2e-3 && Math.abs(ex) <= mx && Math.abs(ez) <= mz;
    if (enterMouth) {
      const cav = rayAabb(ox, oy, oz, dx, dy, dz, -FISHBOX.w / 2, FISHBOX.w / 2, BOX_WALL, H + 0.12, -FISHBOX.d / 2, FISHBOX.d / 2, exact.tIn);
      const tEnd = cav ? cav.tOut : exact.tOut;
      const fPad = fp ? 0.045 : 0.095;
      let bestFish = null, bestDirect = false, bestT = Infinity, bestScore = 1;
      for (const fb of fishBoxes) {
        const hit = rayAabb(ox, oy, oz, dx, dy, dz,
          fb.min[0] - fPad, fb.max[0] + fPad, fb.min[1] - fPad, fb.max[1] + fPad, fb.min[2] - fPad, fb.max[2] + fPad,
          Math.max(tMin, exact.tIn - 0.02));
        if (!hit || hit.tIn > tEnd + fPad) continue;
        const off = distRayToAabb(ox, oy, oz, dx, dy, dz,
          fb.min[0], fb.max[0], fb.min[1], fb.max[1], fb.min[2], fb.max[2], hit.tIn, Math.min(hit.tOut, tEnd + fPad));
        const direct = off <= 1e-4, score = off / fPad;
        if (score >= 1) continue;
        if (!bestFish || (direct !== bestDirect ? direct : direct ? hit.tIn < bestT : score < bestScore)) {
          bestFish = fb; bestDirect = direct; bestT = hit.tIn; bestScore = score;
        }
      }
      if (bestFish) {
        const off = bestDirect ? 0 : bestScore * fPad;
        return { kind: 'fpile', fish: bestFish.fish, name: bestFish.name, t: bestT, off, r: fPad };
      }
      return { kind: 'fbox', t: tEnd, off: 0, r: fp ? 0.06 : 0.16 };
    }
  }

  const pad = putOnly ? (fp ? 0.12 : 0.24) : (fp ? 0.06 : 0.16);
  if (exact || minHandleT < Infinity) {
    const t = Math.min(exact ? exact.tIn : Infinity, minHandleT);
    return { kind: 'fbox', t, off: 0, r: pad };
  }
  const padded = rayAabb(ox, oy, oz, dx, dy, dz, -hx - pad, hx + pad, -pad, H + pad, -hz - 0.04 - pad, hz + 0.04 + pad, tMin);
  if (!padded) return null;
  const off = distRayToAabb(ox, oy, oz, dx, dy, dz, -hx, hx, 0, H, -hz, hz, padded.tIn, padded.tOut);
  if (off > pad) return null;
  return { kind: 'fbox', t: padded.tIn, off, r: pad };
}
