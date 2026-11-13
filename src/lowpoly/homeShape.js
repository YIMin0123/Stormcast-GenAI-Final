// 母港島的形狀：只有數字和算式（不碰畫面），瀏覽器和伺服器共用。
// 座標是港座標（見 frame.js，跟 harborPlan.js 同一套）：原點在岸邊木平台靠海那條邊的正中央，x 向東、z 向南（往外海），單位公尺。
import * as H from './harborPlan.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- 平滑的 2D 雜訊（跟 kit.js 的一樣，這裡不能引入 three.js 所以抄一份）----
function hash(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
export function fbm(x, z, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise(x * f, z * f); f *= 2.03; amp *= 0.5; }
  return s;
}

export function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
// 離棧橋的中心線多遠
export function pierDist(x, z) {
  const L = H.PIER_LINE;
  let d = Infinity;
  for (let i = 0; i < L.length - 1; i++) d = Math.min(d, segDist(x, z, L[i][0], L[i][1], L[i + 1][0], L[i + 1][1]));
  return d;
}

// ---- 木棧板 ----
// (x, z) 在不在這塊長方形上（margin：往外多算幾公尺）
export function inRect(x, z, r, margin = 0) {
  const dx = x - r.cx, dz = z - r.cz;
  return Math.abs(dx * r.ux + dz * r.uz) <= r.hl + margin && Math.abs(-dx * r.uz + dz * r.ux) <= r.hw + margin;
}
// 所有走得上去的棧板：岸邊平台、棧橋兩段、轉角平台、指棧、商店和魚市場的地板
export const DECK_RECTS = [H.BOARDWALK, H.SEG1, H.CORNER, H.SEG2, ...H.FINGERS, ...H.FLOORS];
// (x, z) 在不在棧板上
export function onBoards(x, z, margin = 0) {
  if (x < -40 - margin || x > 60 + margin || z < -16 - margin || z > 152 + margin) return false;   // 先用一個大框擋掉遠的
  for (const r of DECK_RECTS) if (inRect(x, z, r, margin)) return true;
  return false;
}

export const SHELF_DEPTH = -3.2;   // 近岸淺灘的水深
const FLOOR = -30;                 // 外海的海底（跟 terrain.js 的 SEA_FLOOR 一樣）

// 離島多遠（1 = 剛好在海岸線上）：島的主體、前面的緩坡、東邊的岩岬，取最近的
function islandMetric(x, z) {
  let e = Infinity;
  for (const S of [H.ISLAND, H.FRONT, H.POINT]) e = Math.min(e, Math.hypot((x - S.x) / S.rx, (z - S.z) / S.rz));
  return e;
}
// 村子那一片整平的程度（1 = 完全整平）
function terraceK(x, z) {
  const T = H.TERRACE;
  const dx = Math.max(T.x0 - x, 0, x - T.x1), dz = Math.max(T.z0 - z, 0, z - T.z1);
  return 1 - smooth(0, T.blend, Math.hypot(dx, dz));
}

// ---- 島的高度：一整塊圓潤的島、後面一座圓頂的山丘；岸邊一片整平給村子；海岸往下收到淺灘 ----
export function harborHeight(x, z) {
  const L = H.HILL;
  const e = islandMetric(x, z) + (fbm(x * 0.05, z * 0.05) - 0.5) * 0.14;
  const eh = Math.hypot((x - L.x) / L.rx, (z - L.z) / L.rz);
  let land = 2.2 + (L.peak - 2.2) * smooth(0, 1, Math.max(0, 1 - eh * eh)) + (fbm(x * 0.08 + 5, z * 0.08) - 0.5) * 1.4;
  const tk = terraceK(x, z);
  land += (H.TERRACE.y - land) * tk;
  // 海岸：沙灘緩緩往下收
  let h = SHELF_DEPTH + (land - SHELF_DEPTH) * (1 - smooth(0.72, 1.0, e));
  // 橋頭那一段：岸邊木平台底下是往海裡斜下去的沙灘（從整平的高度開始，每公尺低 0.3），兩頭慢慢接回原本的海岸
  const beach = H.TERRACE.y - (z - H.TERRACE.z1) * 0.3, wx = 1 - smooth(36, 46, Math.abs(x));
  if (beach < h) h += (beach - h) * wx;
  return Math.max(h, SHELF_DEPTH);
}

// 遊戲用的海床：島上照 harborHeight；島外面一圈淺灘，再往外慢慢深到外海的海底。
// 棧橋那一帶也留一片淺一點的海底（不會一下子掉到 30 公尺深）
export function homeBed(x, z) {
  const h = harborHeight(x, z);
  if (h > SHELF_DEPTH + 0.01) return h;
  const e = Math.min(islandMetric(x, z), 1 + pierDist(x, z) / 40) + (fbm(x * 0.02 + 9, z * 0.02) - 0.5) * 0.3;
  return SHELF_DEPTH + (FLOOR - SHELF_DEPTH) * smooth(1.0, 2.6, e);
}
