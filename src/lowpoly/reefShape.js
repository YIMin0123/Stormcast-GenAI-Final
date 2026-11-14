// 海上礁石群的形狀：只有數字和算式（不碰畫面），瀏覽器和伺服器共用。每個函式吃的是那一組自己的座標（見 reefPlan.js）。
import { ARCH, ATOLL, BEACON } from './reefPlan.js';
import { fbm } from './homeShape.js';
import { REEF_FRAMES } from '../frame.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const FLOOR = -30;   // 外海的海底（跟 terrain.js 的 SEA_FLOOR 一樣）

// 石拱門的海床：兩隻腳各是一根從海底小丘上立起來的岩柱（拱本身是另外的模型，高度圖裡沒有，船從底下過）
export function archBed(x, z) {
  const A = ARCH;
  let h = FLOOR;
  for (const s of [-1, 1]) {
    const d = Math.hypot(x - s * A.legX, z / 1.15) + (fbm(x * 0.2 + 3, z * 0.2 + s * 9) - 0.5) * 1.6;
    const mound = FLOOR + (A.mound - FLOOR) * (1 - smooth(A.legR + 1.5, A.legR + 22, d));
    const pillar = (A.top - 4 - A.mound) * (1 - smooth(A.legR - 1.2, A.legR + 1.6, d));
    h = Math.max(h, mound + pillar);
  }
  return h;
}

// 環礁：一片淺淺的礁盤，上面幾根露出水面的尖礁，外圍很快掉到深水
export function atollBed(x, z) {
  const A = ATOLL;
  const e = Math.hypot(x / A.rx, z / A.rz) + (fbm(x * 0.04 + 11, z * 0.04 + 5) - 0.5) * 0.34;
  let h = A.flat + (fbm(x * 0.13 + 2, z * 0.13 + 8) - 0.5) * 2 * A.rough;
  const k = smooth(A.edge, A.edge + 0.75, e);
  h = h * (1 - k) + FLOOR * k;   // 這樣寫，礁盤外面剛好是海底的深度（不會差一點點）
  for (const s of A.spikes) {
    const d = Math.hypot(x - s.x, z - s.z) + (fbm(x * 0.3 + s.x, z * 0.3 + s.z) - 0.5) * 1.2;
    if (d < s.r) h = Math.max(h, s.h - (s.h + 1.2) * smooth(0.25 * s.r, s.r, d));
  }
  return h;
}

// 燈標岩嶼：一座小岩島
export function beaconBed(x, z) {
  const B = BEACON;
  const d = Math.hypot(x, z * 1.2) + (fbm(x * 0.12 + 4, z * 0.12 + 6) - 0.5) * 5;
  const skirt = FLOOR + (-2.5 - FLOOR) * (1 - smooth(B.r, B.r + 42, d));
  if (d >= B.r) return skirt;
  return Math.max(skirt, B.top - (B.top + 2.5) * smooth(0.35 * B.r, B.r, d) + (fbm(x * 0.3, z * 0.3) - 0.5) * 0.8 * (1 - smooth(0.5 * B.r, B.r, d)));
}

const SHAPES = [['arch', archBed, ARCH.reach], ['atoll', atollBed, ATOLL.reach], ['beacon', beaconBed, BEACON.reach]];
// 世界座標版：這一點有礁石的話回傳它的海床高度，沒有就是外海的海底
export function reefBed(wx, wz) {
  let h = FLOOR;
  for (const [key, f, reach] of SHAPES) {
    const F = REEF_FRAMES[key];
    if ((wx - F.origin.x) ** 2 + (wz - F.origin.z) ** 2 > reach * reach) continue;
    const [x, z] = F.toLocal(wx, wz);
    h = Math.max(h, f(x, z));
  }
  return h;
}
