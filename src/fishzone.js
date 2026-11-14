// 特別的釣場在哪裡：高山小河、透天洞穴的深潭、海上的三處礁石。不碰畫面，瀏覽器和伺服器共用（座標是世界座標）。
import { HAVEN, REEF_FRAMES } from './frame.js';
import { riverSurface, caveFloor } from './lowpoly/havenShape.js';
import { ARCH, ATOLL, BEACON } from './lowpoly/reefPlan.js';

// 這個位置如果是山上的水（小河、湧泉池、瀑布底的水潭），回傳水面的高度；不是就 null
export const riverLevel = (x, z) => { const [hx, hz] = HAVEN.toLocal(x, z); return riverSurface(hx, hz); };

// 這個位置屬於哪個特別的釣場：'river' / 'cave' / 'arch' / 'atoll' / 'beacon'；都不是就 null（照一般的規則）
export function fishZone(x, z) {
  const [hx, hz] = HAVEN.toLocal(x, z);
  if (riverSurface(hx, hz) !== null) return 'river';
  if (caveFloor(hx, hz) !== null) return 'cave';
  for (const [id, R] of [['arch', ARCH], ['atoll', ATOLL], ['beacon', BEACON]]) {
    const o = REEF_FRAMES[id].origin;
    if (Math.hypot(x - o.x, z - o.z) < R.reach) return id;
  }
  return null;
}
