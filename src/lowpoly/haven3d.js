// 探險大港灣島的模型（大港座標，見 havenPlan.js）：整座島的低面地形、海岸和崖壁的岩塊、山上的樹。
// 樣品間（sample.js）和遊戲（haven.js）共用；交給 kit.js 的同一個材質畫。
import * as THREE from 'three';
import { mirrored } from './kit.js';
import { rockGeo, broadleafGeo, islandTerrain } from './shapes.js';
import { havenBed } from './havenShape.js';
import * as V from './havenPlan.js';

// place(幾何, 清單, 投不投影, 受不受影)：一個樣板＋很多個實例（跟港口同一套）。phone：手機（地形格子大一點、樹和岩塊少一點）
// 回傳 { groundAt(x, z) 畫出來的地面多高, kind(x, z) 這一點是哪一種地面, rocks 擋路的大岩塊 [{ x, z, r, top }] }
export function buildHaven({ P, r, place, mat, group, phone = false }) {
  const G = V.GROUND, half = G.size / 2;
  // 地形：電腦 1.8 公尺一格、手機 2.7 公尺（三角形少一半多）。島很大，面也跟著大塊，岩層一層 3.2 公尺。
  // 切成一百多公尺見方的一塊塊：背對鏡頭、被擋在畫面外的那幾塊不用畫；比 11 公尺深的海底看不到，不建
  const ground = islandTerrain(P, G.size, phone ? 2.7 : 1.8, 11, havenBed, G.cx, G.cz, {
    band: 3.2, minY: -11, tile: 118,
    // 越高的地方草越黃一點、岩石越淺一點（山頂曬得到太陽、風大）
    tint: (col, x, y, z, kind) => (y > 30 ? col.clone().lerp(kind === 3 ? P.sand : P.rock, Math.min(0.28, (y - 30) / 120)) : col),
  });
  for (const geo of ground.geos) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  const out = { groundAt: ground.at, kind: ground.kind, rocks: [] };
  const randPt = () => { const x = G.cx + (r() - 0.5) * 2 * half, z = G.cz + (r() - 0.5) * 2 * half; return [x, z, ground.at(x, z)]; };

  // ---- 岩塊：3 種形狀 × 原版／鏡像 = 6 份樣板 ----
  const rg = [];
  for (let k = 0; k < 3; k++) { const g = rockGeo(k, P, 100 + k * 13); rg.push(g, mirrored(g)); }
  const rl = rg.map(() => []);
  const addRock = (kind, pos, scl, flip = r() < 0.35) => rl[kind * 2 + (r() < 0.5 ? 1 : 0)].push({ pos, scl, rot: r() * Math.PI * 2, flip, tint: 0.88 + r() * 0.2 });
  // 海岸：一堆一堆的大礁岩，一半泡在水裡（島大，石頭也大）
  for (let tries = 0, made = 0; made < (phone ? 90 : 170) && tries < 30000; tries++) {
    const [x, z, h] = randPt();
    if (h < -1.6 || h > 1.2) continue;
    made++;
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const px = x + (r() - 0.5) * 7, pz = z + (r() - 0.5) * 7, s = 1.4 + r() * 3.2;
      const scl = new THREE.Vector3(s * (0.8 + r() * 0.6), s * (0.55 + r() * 0.5), s * (0.8 + r() * 0.6));
      addRock(r() < 0.6 ? 2 : 0, new THREE.Vector3(px, ground.at(px, pz) - scl.y * (0.15 + r() * 0.3), pz), scl);
      if (s > 2.4) out.rocks.push({ x: px, z: pz, r: s * 0.8, top: 99 });
    }
  }
  // 崖壁：拉高的岩柱貼著陡坡，深深埋進去
  for (let tries = 0, made = 0; made < (phone ? 110 : 240) && tries < 40000; tries++) {
    const [x, z, h] = randPt();
    if (h < 2 || ground.kind(x, z) !== 'cliff') continue;
    made++;
    const s = 2.2 + r() * 3.4;
    const scl = new THREE.Vector3(s * (0.7 + r() * 0.4), s * (1.5 + r() * 1.5), s * (0.7 + r() * 0.4));
    addRock(1, new THREE.Vector3(x, h - scl.y * (0.4 + r() * 0.2), z), scl, r() < 0.5);
  }
  rg.forEach((g, i) => place(g, rl[i], true, true));

  // ---- 樹：闊葉 3 種 × 原版／鏡像，長在草地上（太陡、太靠海、灣底整平的那一片不長）----
  const tg = [];
  for (let k = 0; k < 3; k++) { const g = broadleafGeo(P, 300 + k * 41); tg.push(g, mirrored(g)); }
  const tl = tg.map(() => []), cells = new Map(), CELL = 6;
  const crowded = (x, z, d) => {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const t of cells.get(i * 4096 + j) || []) if ((t[0] - x) ** 2 + (t[1] - z) ** 2 < d * d) return true;
    return false;
  };
  for (let tries = 0, made = 0; made < (phone ? 260 : 620) && tries < 60000; tries++) {
    const [x, z, h] = randPt();
    if (h < 3.2 || ground.kind(x, z) !== 'grass' || crowded(x, z, 5.2)) continue;
    made++;
    const key = Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push([x, z]);
    const s = 1.0 + r() * 0.7;   // 比母島的樹大一點：山大，樹太小會像灌木
    tl[Math.floor(r() * tg.length)].push({ pos: new THREE.Vector3(x, h - 0.2, z), scl: new THREE.Vector3(s, s * (0.9 + r() * 0.3), s), rot: r() * Math.PI * 2, flip: false, tint: 0.9 + r() * 0.16 });
    out.rocks.push({ x, z, r: 0.35 * s, top: 99 });   // 樹幹擋路
  }
  tg.forEach((g, i) => place(g, tl[i], true, true));
  return out;
}
