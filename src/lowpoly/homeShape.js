// 母港島的形狀：只有數字和算式（不碰畫面），瀏覽器和伺服器共用。
// 座標是港座標（見 frame.js，跟 harborPlan.js 同一套）：原點在港池北岸正中央，x 向東、z 向南（港口朝海），單位公尺。
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

export function inPoly(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
// 在不在岸壁＋防波堤那塊 U 形水泥平台上；在不在港池（含入口）裡
export const onPlatform = (x, z) => inPoly(x, z, H.PLATFORM);
export const inBasin = (x, z) => inPoly(x, z, H.BASIN_EDGE) || (Math.abs(x) < 10.8 && z > H.BASIN.z1 - 3);

export const SHELF_DEPTH = -3.2;   // 近岸淺灘、港池的水深
const FLOOR = -30;                 // 外海的海底（跟 terrain.js 的 SEA_FLOOR 一樣）

// 離島多遠（1 = 剛好在海岸線上）：島的主體、兩側收下來的那一截、港口那一片，取最近的
function islandMetric(x, z) {
  const I = H.ISLAND;
  let e = Math.hypot((x - I.x) / I.rx, (z - I.z) / I.rz);
  for (const S of H.SIDES) e = Math.min(e, Math.hypot((x - S.x) / S.rx, (z - S.z) / S.rz));
  return e;
}

// ---- 島的高度：一整塊圓潤的島（主體橢圓＋兩側沿著岸壁往下收的一截）、後面一座圓頂的山丘；
// 擋土牆後面墊到牆頂；水泥平台底下壓低、港池是海 ----
export function harborHeight(x, z) {
  const L = H.HILL;
  const nz = fbm(x * 0.05, z * 0.05) - 0.5;
  const e = islandMetric(x, z) + nz * 0.16;
  const eh = Math.hypot((x - L.x) / L.rx, (z - L.z) / L.rz);
  let land = 2.2 + (L.peak - 2.2) * smooth(0, 1, Math.max(0, 1 - eh * eh)) + (fbm(x * 0.08 + 5, z * 0.08) - 0.5) * 1.2;
  if (z < -13.5 && z > -21 && Math.abs(x) < 48) land = Math.max(land, H.DECK_Y + H.RETAIN.h + 0.1);   // 擋土牆後面
  let h = SHELF_DEPTH + (land - SHELF_DEPTH) * (1 - smooth(0.88, 1.0, e));
  if (onPlatform(x, z)) h = Math.min(h, 1.1);    // 水泥平台底下（被平台蓋住）
  else if (inBasin(x, z)) h = SHELF_DEPTH;        // 港池、入口是海
  return h;
}

// 遊戲用的海床：島上照 harborHeight；水泥平台當成實心的陸地（擋浪）；
// 島外面一圈淺灘，再往外慢慢深到外海的海底。港口那一片（港池外面到防波堤外）也是淺灘
export function homeBed(x, z) {
  if (onPlatform(x, z)) return 1.1;
  const h = harborHeight(x, z);
  if (h > SHELF_DEPTH + 0.01 || inBasin(x, z)) return h;
  const eHarbor = Math.hypot(x / 62, (z - 14) / 40);   // 港口外面那一片淺灘
  const e = Math.min(islandMetric(x, z), eHarbor) + (fbm(x * 0.02 + 9, z * 0.02) - 0.5) * 0.3;
  return SHELF_DEPTH + (FLOOR - SHELF_DEPTH) * smooth(1.0, 2.6, e);
}
