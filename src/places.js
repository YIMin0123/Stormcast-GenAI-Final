// 這個位置叫什麼地方（給人看的名字）：圖鑑記「在哪釣到」、平板的房間 app 寫「他在哪」都用這裡。
// 不碰畫面，瀏覽器和伺服器共用（座標是世界座標）
import { fishZone } from './fishzone.js';
import { ISLANDS } from './terrain.js';
import { inHarbor, QUAY_CENTER_W } from './layout.js';
import { TABLET } from './config.js';

export const ZONE_NAME = { river: '高山小河', cave: '透天洞穴', arch: '石拱門', atoll: '沉船環礁', beacon: '燈標岩' };
const ISLAND_NAME = Object.fromEntries(ISLANDS.map((o) => [o.id, o.name]));

// 釣魚點（server/world.js 的 fishingSpot）→ 地名：特別的釣場用它的名字；離岸太遠是外海；其他是最近那座島附近
export function placeOfSpot({ zone, island, off }) {
  if (zone && ZONE_NAME[zone]) return ZONE_NAME[zone];
  if (off > TABLET.farOff) return '外海';
  return `${ISLAND_NAME[island] ?? ''}附近`;
}

// 任意一點 → 地名。off：離岸距離（公尺；瀏覽器用 offAt 查，查不到就只看離島多遠）
export function placeAt(x, z, off = null) {
  if (inHarbor(x, z) || Math.hypot(x - QUAY_CENTER_W.x, z - QUAY_CENTER_W.z) < TABLET.harborR) return `${ISLAND_NAME.home}港口`;
  const zone = fishZone(x, z);
  let island = ISLANDS[0], d = Infinity;
  for (const o of ISLANDS) { const k = Math.hypot(x - o.x, z - o.z) - o.R; if (k < d) { d = k; island = o; } }
  return placeOfSpot({ zone, island: island.id, off: off ?? Math.max(0, d) });
}
