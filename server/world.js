// 伺服器眼中的地圖：跟遊戲用同一套地形，算出每個位置的水深、離岸多遠、算不算外海。
// 釣魚時用它決定「這裡會釣到什麼」，也用它擋掉不合理的請求（人在陸地卻說釣到深海魚）。
import { makeTerrain, ISLANDS } from '../src/terrain.js';
import { computeDanger, computeOffshore, windWave, seaLevel } from '../src/weather.js';
import { onDeck, BERTHS, berthPose } from '../src/layout.js';
import { BOAT_TYPES } from '../src/boatdata.js';

import { WORLD } from '../src/config.js';
import { fishZone, riverLevel } from '../src/fishzone.js';
const N = 512, NF = 1024, L = WORLD.size;
const { bed, main } = makeTerrain(NF, L);
// 粗一半的版本只拿兩座大島（不含海上的礁石）：離岸多遠、算不算外海看的是離大島多遠
const coarse = new Float32Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const k = 2 * j * NF + 2 * i;
  coarse[j * N + i] = (main[k] + main[k + 1] + main[k + NF] + main[k + NF + 1]) / 4;
}
const danger = computeDanger(coarse, N, L), offshore = computeOffshore(coarse, N, L);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function sample(arr, x, z, n) {
  const gx = clamp((x / L + 0.5) * n - 0.5, 0, n - 1.001), gz = clamp((z / L + 0.5) * n - 0.5, 0, n - 1.001);
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * n + i;
  return (arr[k] * (1 - fx) + arr[k + 1] * fx) * (1 - fz) + (arr[k + n] * (1 - fx) + arr[k + n + 1] * fx) * fz;
}
export const bedAt = (x, z) => sample(bed, x, z, NF);
export const dangerAt = (x, z) => sample(danger, x, z, N) / 255;
export const offAt = (x, z) => sample(offshore, x, z, N);
// 可以拋竿的水面：不是岸、不是棧板（船上不算，伺服器不管船擋不擋）
export const isWater = (x, z) => (bedAt(x, z) < -0.6 && !onDeck(x, z, 0.2)) || riverLevel(x, z) !== null;   // 山上的小河、湧泉池也可以釣

// 這個位置釣魚的條件（給 rollCatch 用）。climate、sea：這間房現在的天氣與海況
export function fishingSpot(x, z, climate, sea) {
  let near = ISLANDS[0], dist = Infinity;
  for (const o of ISLANDS) { const d = Math.hypot(x - o.x, z - o.z); if (d < dist) { dist = d; near = o; } }
  const d = dangerAt(x, z), level = seaLevel(windWave(climate.wind * (1 + 0.7 * climate.rain)) * sea.lull, sea.storm, sea.surge, d, d);
  return { depth: -bedAt(x, z), island: near.id, off: offAt(x, z), night: climate.night, rough: clamp((level - 0.5) / 1.5, 0, 1), zone: fishZone(x, z), rain: Math.max(sea.rain, climate.rain) };
}

// 開機時檢查每個停船格的水夠不夠深（地形改了、格子擺到淺灘上的話，這裡會講）
for (const b of BERTHS) {
  const type = 'trawler', p = berthPose(b, type), S = BOAT_TYPES[type];   // 每格都要停得下最大的船
  const c = Math.cos(p.heading), s = Math.sin(p.heading);
  const shallow = [[S.len / 2, 0], [-S.len / 2, 0], [0, S.beam / 2], [0, -S.beam / 2], [0, 0]].some(([a, e]) => -bedAt(p.x + c * a - s * e, p.z + s * a + c * e) < S.draft + 0.2);
  if (shallow) console.warn(`[berth] 停船格 ${b.label} 的水太淺`);
}
