// 海上修船屋的形狀算式（修船屋座標，配置見 seaYardPlan.js）：哪裡是平台、哪裡擋路、船會不會撞上、爬梯多高。
// 只有算式，不碰畫面：瀏覽器（走路、擋船）和伺服器共用。模型在 seaYard3d.js
import * as Y from './seaYardPlan.js';

// 爬梯：從平台邊往外伸出去 1 公尺、寬 0.9 公尺的一條「看不見的斜坡」（跟母港的梯子同一個算法，見 layout.js）。
// ladders：[{ x, z, nx, nz }]；deckY：平台高度。在梯子上回傳高度，不在回傳 null
const LADDER_OUT = 1.0, LADDER_HALF = 0.45, LADDER_TOP = 0.15, LADDER_FOOT = 1.8;
export function ladderRamp(ladders, deckY, x, z) {
  for (const l of ladders) {
    const dx = x - l.x, dz = z - l.z, u = dx * l.nx + dz * l.nz, v = -dx * l.nz + dz * l.nx;
    if (Math.abs(v) < LADDER_HALF && u > -0.05 && u < LADDER_OUT) return u <= LADDER_TOP ? deckY : deckY - (u - LADDER_TOP) / (LADDER_OUT - LADDER_TOP) * (deckY + LADDER_FOOT);
  }
  return null;
}

// 這一點在不在平台上。grow：多算寬幾公尺（負的 = 往內縮）
export const yardOnDeck = (x, z, grow = 0) => Y.DECKS.some((d) => x > d.x0 - grow && x < d.x1 + grow && z > d.z0 - grow && z < d.z1 + grow);
// 船會不會撞上平台（底下都是樁和浮筒，船過不去）
export const yardPier = (x, z) => yardOnDeck(x, z, -0.15);

// 平台上擋路的長方形：工坊的後牆和兩道側牆、屋裡的展示台和後牆工作台、修船台、油桶攤、龍門吊的基座
const H = Y.HOUSE, T = 0.25;
const G = Object.fromEntries(Y.GOODS.map((g) => [g.id, g]));
export const YARD_WALLS = [
  { x0: H.x0, x1: H.x1, z0: H.z0, z1: H.z0 + T },
  { x0: H.x0, x1: H.x0 + T, z0: H.z0, z1: H.z1 },
  { x0: H.x1 - T, x1: H.x1, z0: H.z0, z1: H.z1 },
  Y.BENCH, Y.BACK_BENCH,
  { x0: G.repair.x - 0.55, x1: G.repair.x + 0.55, z0: G.repair.z - 0.3, z1: G.repair.z + 0.3 },
  { x0: G.fuel.x - 0.6, x1: G.fuel.x + 0.6, z0: G.fuel.z - 0.32, z1: G.fuel.z + 0.32 },
  { x0: Y.CRANE.x - 0.5, x1: Y.CRANE.x + 0.5, z0: Y.CRANE.z - 0.5, z1: Y.CRANE.z + 0.5 },
];
export const yardWall = (x, z) => YARD_WALLS.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);

// 腳在高度 feet 的人在 (x, z) 踩到什麼：牆（99）、爬梯、平台面；都不是（在海裡、在平台底下游）回傳 null。
// 沒說腳多高（feet 是 null：種東西、丟東西問地面）就照「站在平台上」算
export function yardGround(x, z, feet) {
  if (Math.abs(x) > Y.REACH || Math.abs(z) > Y.REACH) return null;
  const ly = ladderRamp(Y.LADDERS, Y.DECK_Y, x, z);
  if (ly !== null && !yardOnDeck(x, z)) return ly;
  if (!yardOnDeck(x, z, 0.1)) return null;
  if (feet !== null && feet !== undefined && feet < Y.DECK_Y - 0.9) return null;   // 在平台底下游泳的人：從底下過去
  return yardWall(x, z) ? 99 : Y.DECK_Y;
}
