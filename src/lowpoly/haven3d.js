// 探險大港灣島的模型（大港座標，見 havenPlan.js）：整座島的低面地形、海岸和崖壁的岩塊、山上的樹。
// 樣品間（sample.js）和遊戲（haven.js）共用；交給 kit.js 的同一個材質畫。
import * as THREE from 'three';
import { mirrored } from './kit.js';
import { rockGeo, broadleafGeo, islandTerrain } from './shapes.js';
import { havenHeight, caveCoords, skyEdge, CAVE_AXIS, riverBed, riverFalls, riverPath, coveFaceS, diveDeck } from './havenShape.js';
import { buildRiver, buildDive, vineGeo } from './river3d.js';
import { buildCave, cavePatch } from './cave3d.js';
import * as V from './havenPlan.js';

// place(幾何, 清單, 投不投影, 受不受影)：一個樣板＋很多個實例（跟港口同一套）。phone：手機（地形格子大一點、樹和岩塊少一點）
// 回傳 { groundAt(x, z) 畫出來的地面多高, kind(x, z) 這一點是哪一種地面, rocks 擋路的大岩塊 [{ x, z, r, top }] }
export function buildHaven({ P, r, place, mat, group, phone = false }) {
  const G = V.GROUND, half = G.size / 2;
  // 地形：電腦 1.8 公尺一格、手機 2.7 公尺（三角形少一半多）。島很大，面也跟著大塊，岩層一層 3.2 公尺。
  // 切成一百多公尺見方的一塊塊：背對鏡頭、被擋在畫面外的那幾塊不用畫；比 11 公尺深的海底看不到，不建
  // 越高的地方草越黃一點、岩石越淺一點（山頂曬得到太陽、風大）
  // 河床、湧泉池、瀑布底的水潭：濕的石頭色（不長草）
  const wet = P.rock2.clone().lerp(P.sandWet, 0.35).multiplyScalar(0.85);
  const tint = (col, x, y, z, kind) => (riverBed(x, z, 0.5) ? wet : y > 30 ? col.clone().lerp(kind === 3 ? P.sand : P.rock, Math.min(0.28, (y - 30) / 120)) : col);
  // 高度用上層（山坡、洞頂）；透天洞穴的天窗口和暗門洞口那兩小塊不畫，由洞穴的模型接手（見 cave3d.js）
  const step = phone ? 2.7 : 1.8;
  const ground = islandTerrain(P, G.size, step, 11, havenHeight, G.cx, G.cz, { band: 3.2, minY: -11, tile: 118, tint, skip: (x, z) => cavePatch(x, z, step * 0.9), plain: (x, z) => (riverBed(x, z, 3.5) ? 0 : 1) });
  for (const geo of ground.geos) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  const out = { groundAt: ground.at, kind: ground.kind, rocks: [] };
  buildCave({ P, r, mat, group, groundAt: ground.at, tint });
  // 天窗口、暗門洞口和它外面的海蝕溝不放石頭和樹（會擋住洞口，或浮在天窗上）
  // 小河和跳水台也一樣
  const DK = diveDeck(), onDeck = (x, z, pad) => { const a = (x - DK.x) * DK.ux + (z - DK.z) * DK.uz, b = -(x - DK.x) * DK.uz + (z - DK.z) * DK.ux; return a > -pad && a < DK.len && Math.abs(b) < DK.half + pad; };
  const keepOut = (x, z) => { const [s, l] = caveCoords(x, z); return skyEdge(x, z) < 3 || (s > 0 && Math.abs(l) < 12) || riverBed(x, z, 2.2) || onDeck(x, z, 2); };
  out.river = buildRiver({ mat, group });
  buildDive({ P, r, mat, group });
  const randPt = () => { for (;;) { const x = G.cx + (r() - 0.5) * 2 * half, z = G.cz + (r() - 0.5) * 2 * half; if (!keepOut(x, z)) return [x, z, ground.at(x, z)]; } };

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
  // 天窗邊：幾顆石頭散在洞口四周（不是等距排一圈），把洞口的輪廓打散。
  // 不擋路：擋路的東西只看平面位置，這些石頭在洞頂上，算進去的話連正下方深潭裡的船和人也會被擋住
  for (let i = 0, n = V.CAVE.sky.rocks; i < n; i++) {
    const a = (i + r() * 0.9) / n * Math.PI * 2 + 0.4, s = 1.4 + r() * 1.4;
    let d = 3;
    while (skyEdge(V.CAVE.x + Math.cos(a) * d, V.CAVE.z + Math.sin(a) * d) < s * 0.55 + r() * 1.6) d += 0.25;
    const x = V.CAVE.x + Math.cos(a) * d, z = V.CAVE.z + Math.sin(a) * d;
    if (riverBed(x, z, s + 1) || onDeck(x, z, s + 0.5)) continue;   // 不擋小河流進天窗的缺口、不壓到跳水台
    const scl = new THREE.Vector3(s * (0.8 + r() * 0.5), s * (0.6 + r() * 0.6), s * (0.8 + r() * 0.5));
    addRock(i % 3, new THREE.Vector3(x, ground.at(x, z) - scl.y * 0.3, z), scl, false);
  }
  // 暗門洞口兩旁：幾根岩柱貼著崖面站在水裡，洞口才不是一面牆上光禿禿的一個洞
  for (const [l, ds, size] of V.CAVE.door.mouth.pillars) {
    const sd = V.CAVE.face + ds, x = V.CAVE.x + CAVE_AXIS[0] * sd - CAVE_AXIS[1] * l, z = V.CAVE.z + CAVE_AXIS[1] * sd + CAVE_AXIS[0] * l;
    const scl = new THREE.Vector3(size * (0.75 + r() * 0.3), size * (1.7 + r() * 0.9), size * (0.75 + r() * 0.3));
    addRock(1, new THREE.Vector3(x, scl.y * 0.3 - 1, z), scl, r() < 0.5);
    out.rocks.push({ x, z, r: size * 0.7, top: 99 });
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

  // ---- 藤蔓（只是裝飾）：3 種樣板，倒過來掛（根在上面、尾巴垂下去，隨風晃）----
  const vg = [0, 1, 2].map((k) => vineGeo(P, 700 + k * 17)), vl = vg.map(() => []), few = phone ? 0.5 : 1;
  const hang = (x, y, z, len) => vl[Math.floor(r() * vg.length)].push({ pos: new THREE.Vector3(x, y, z), scl: new THREE.Vector3(len * 0.3, len, len * 0.3), rot: r() * Math.PI * 2, flip: true, tint: 0.85 + r() * 0.25 });
  // 天窗一圈：從洞邊垂進豎井裡
  for (let i = 0, n = Math.round(V.VINES.sky * few); i < n; i++) {
    const a = r() * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
    let d = 3;
    while (skyEdge(V.CAVE.x + cx * d, V.CAVE.z + cz * d) < -0.5) d += 0.2;
    const x = V.CAVE.x + cx * d, z = V.CAVE.z + cz * d;
    if (riverBed(x, z, 1.5)) continue;   // 小河沖下去的缺口不掛
    hang(x, ground.at(V.CAVE.x + cx * (d + 1.2), V.CAVE.z + cz * (d + 1.2)) - 0.1, z, 3 + r() * 7);
  }
  // 暗門洞口的上緣：垂下來半遮著洞口
  for (let i = 0, n = Math.round(V.VINES.door * few); i < n; i++) {
    const l = -5 + r() * 11, at = (s) => [V.CAVE.x + CAVE_AXIS[0] * s - CAVE_AXIS[1] * l, V.CAVE.z + CAVE_AXIS[1] * s + CAVE_AXIS[0] * l];
    const [x, z] = at(coveFaceS(l) + 0.7), [gx, gz] = at(coveFaceS(l) - 1.2);
    const top = Math.min(ground.at(gx, gz), 9 + r() * 4);
    if (top > 4) hang(x, top, z, Math.min(top - 0.5, 3 + r() * 4.5));
  }
  // 瀑布兩旁的崖壁
  const rp = riverPath();
  for (const f of riverFalls()) {
    const a = rp[f.i], b = rp[f.i + 1], sl = Math.hypot(b.x - a.x, b.z - a.z), tx = (b.x - a.x) / sl, tz = (b.z - a.z) / sl;
    for (let i = 0, n = Math.round(V.VINES.fall * few); i < n; i++) {
      const lat = (V.RIVER.flat + 0.5 + r() * 3.2) * (i % 2 ? 1 : -1), fwd = 0.9 + r() * 0.5;
      hang((a.x + b.x) / 2 + tx * fwd - tz * lat, f.top + 0.5 + r() * 0.8, (a.z + b.z) / 2 + tz * fwd + tx * lat, 2.5 + r() * 3);
    }
  }
  vg.forEach((g, i) => place(g, vl[i], false, true));
  return out;
}
