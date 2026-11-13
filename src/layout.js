// 母港的配置：哪裡是岸壁、浮橋、商店、賣魚的籃子、停船格、排行榜看板。
// 這個檔案只有數字，不碰畫面：伺服器（分配停船格、檢查玩家是不是真的站在商店前）和瀏覽器（蓋模型、判斷互動）共用同一份。
// 港口的設計圖在 lowpoly/harborPlan.js（低面小島漁港）：這裡的數字都從那份來，不另外寫死。
import { BOAT_TYPES } from './boatdata.js';
import { toWorld, toLocal, headingToWorld } from './frame.js';
import * as H from './lowpoly/harborPlan.js';
import { onPlatform, segDist } from './lowpoly/homeShape.js';

// 這個檔案裡的座標全是「港座標」（見 frame.js）：原點在港池北岸（岸壁靠水的那條邊）的正中央，x 向東、z 向南（港口朝海）。
// 要給世界用的（玩家與船的位置、伺服器的檢查）：onDeck / pontoonY / inHarbor 吃世界座標、內部自己轉；
// berthPose 回傳世界座標；SELL、SHELF 等有 world 版本（見檔尾的 homeW）。要用港座標的（蓋模型）用 onDeckLocal / pontoonYLocal。

export const DECK_Y = H.DECK_Y; // 岸壁的高度（海平面以上，公尺）；比船的甲板略高，一步就能跨上船

// 岸壁與防波堤是一整塊 U 形的水泥平台（多邊形，見 harborPlan.js 的 PLATFORM），實心的，游泳的人鑽不到底下。
// DECKS 只是給海面畫水線用的三個矩形：北岸壁、西堤、東堤（靠港池那一側的牆腳）
export const DECKS = [
  { x0: H.BASIN.x0, x1: H.BASIN.x1, z0: -14, z1: H.BASIN.z0 },
  { x0: H.BASIN.x0 - 4.5, x1: H.BASIN.x0, z0: H.BASIN.z0, z1: H.BASIN.z1 + 4.5 },
  { x0: H.BASIN.x1, x1: H.BASIN.x1 + 4.5, z0: H.BASIN.z0, z1: H.BASIN.z1 + 4.5 },
];

// 唯一的一間店：買釣具、油、扳手、船都在店裡的長桌；賣魚在東邊魚市場前的籃子
const S = H.SHOP;
export const SHOP = { name: '商店', x: (S.x0 + S.x1) / 2, z: (S.z0 + S.z1) / 2, w: S.x1 - S.x0, d: S.z1 - S.z0, roof: 0x525d68, hint: '賣魚請到東邊魚市場前的籃子；油、扳手、釣具和船在店裡的長桌' };
// 燈塔：西邊堤頭方墩上的白燈塔（r：走不過去的範圍）
export const LIGHTHOUSE = { x: H.LIGHTHOUSE.x, z: H.LIGHTHOUSE.z, r: 1.4 };
// 賣魚的地方：魚市場前的籃子、顯示價格的電子板、按下去就賣出的按鈕
export const SELL = {
  basket: { x: H.SELL.basket.x, z: H.SELL.basket.z, y: DECK_Y },
  board: { x: H.SELL.board.x, z: H.SELL.board.z },
  button: { x: H.SELL.button.x, z: H.SELL.button.z },
};

// 商品架：店裡的一張長桌，每樣商品後面立著一塊價格牌。玩家走進店裡、站在桌前按 E 購買
const SHELF_IDS = ['fuel', 'wrench', 'rod', 'box', 'engine', 'fisher', 'trawler'];
export const SHELF_X = H.SHELF_X;   // 長桌的兩端
export const SHELF_Z = H.SHELF_Z;
export const SHELF = SHELF_IDS.map((id, i) => ({ id, x: SHELF_X[0] + (SHELF_X[1] - SHELF_X[0]) * (i + 0.5) / SHELF_IDS.length }));
export const PLAYER_SPAWN = { x: H.SPAWN.x, z: H.SPAWN.z, yaw: H.SPAWN.yaw };

// ---- 浮動碼頭 ---------------------------------------------------------------
// 從岸壁往港內伸出去的兩條浮橋：一段斜的跳板從岸壁走下來，接一條貼著水面的木棧道，兩側是小舢舨的停船格（船尾朝浮橋）
export const PONTOON_Y = H.PONTOON_Y;   // 浮橋的橋面離水面多高
export const PONTOON_W = H.PONTOONS[0].w;
export const PONTOONS = H.PONTOONS.map((p, k) => ({
  id: 'AB'[k], x: p.x,
  deck: { x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z0, z1: p.z1 },
  gang: { x0: p.x - H.GANGWAYS[k].w / 2, x1: p.x + H.GANGWAYS[k].w / 2, z0: H.GANGWAYS[k].z0, z1: H.GANGWAYS[k].z1 },
}));
// 浮橋、跳板或樓梯在 (x, z) 的高度；不在上面就回傳 null
export function pontoonYLocal(x, z, margin = 0) {
  for (const p of PONTOONS) {
    const d = p.deck, g = p.gang;
    if (x >= d.x0 - margin && x <= d.x1 + margin && z >= d.z0 - margin && z <= d.z1 + margin) return PONTOON_Y;
    if (x >= g.x0 - margin && x <= g.x1 + margin && z >= g.z0 - margin && z <= g.z1) return DECK_Y + (PONTOON_Y - DECK_Y) * Math.min(1, Math.max(0, (z - g.z0) / (g.z1 - g.z0)));
  }
  return null;
}
export function pontoonY(x, z, margin = 0) { const [lx, lz] = toLocal(x, z); return pontoonYLocal(lx, lz, margin); }

// 擋土牆前面那道樓梯：從岸壁（z0）爬到牆頂後面的坡地（z1）。在樓梯上就回傳高度，不在就回傳 null
const STAIR_TOP = DECK_Y + H.RETAIN.h + 0.1;
export function stairYLocal(x, z) {
  for (const s of H.STAIRS) {
    if (Math.abs(x - s.x) <= s.w / 2 && z <= s.z0 && z >= s.z1 - 1.2) return DECK_Y + (STAIR_TOP - DECK_Y) * Math.min(1, (s.z0 - z) / (s.z0 - s.z1));
  }
  return null;
}
export function stairY(x, z) { const [lx, lz] = toLocal(x, z); return stairYLocal(lx, lz); }

// 某點是否在岸壁或防波堤上（留一點邊緣餘裕）
export function onDeck(x, z, margin = 0) { const [lx, lz] = toLocal(x, z); return onDeckLocal(lx, lz, margin); }
export function onDeckLocal(x, z, margin = 0) {
  if (onPlatform(x, z)) return true;
  if (margin <= 0) return false;
  for (let i = 0, j = H.PLATFORM.length - 1; i < H.PLATFORM.length; j = i++) {
    const [ax, az] = H.PLATFORM[j], [bx, bz] = H.PLATFORM[i];
    if (segDist(x, z, ax, az, bx, bz) < margin) return true;
  }
  return false;
}

// ---- 停船格 -----------------------------------------------------------------
// 每個人同時只有一艘船放在世界裡，進房時伺服器分配一格（全部在港內，共 32 格）：
//   small：浮橋兩側（小舢舨，船尾朝浮橋）；big：東西堤內側（漁船、大漁船，船尾靠堤、船頭朝港內）
// big 的格子記的是堤岸的邊緣（edge）和往水面的方向（nx, nz）：船多長，船身中心就離邊緣多遠（見 berthPose）
export const BERTHS = [];
{
  const PITCH = 3.1, N = 6, OFF = PONTOON_W / 2 + 0.35 + BOAT_TYPES.skiff.len / 2;
  for (const p of PONTOONS) {
    for (let i = 0; i < N; i++) {
      for (const side of [-1, 1]) {
        BERTHS.push({ label: `${p.id}-${i * 2 + (side < 0 ? 1 : 2)}`, kind: 'small', x: p.x + side * OFF, z: p.deck.z0 + 2.5 + i * PITCH, heading: side > 0 ? 0 : Math.PI });
      }
    }
  }
  const pitch = BOAT_TYPES.trawler.beam + 1.3;
  for (let i = 0; i < 4; i++) {
    const z = 7 + i * pitch;
    BERTHS.push({ label: `西堤-${i + 1}`, kind: 'big', ex: H.BASIN.x0, ez: z, nx: 1, nz: 0, heading: 0, off: 0, stern: true });
    BERTHS.push({ label: `東堤-${i + 1}`, kind: 'big', ex: H.BASIN.x1, ez: z, nx: -1, nz: 0, heading: Math.PI, off: 0, stern: true });
  }
}
// 這種船停在這一格時，船身中心在哪、朝哪
export function berthPose(berth, type) {
  let lx = berth.x, lz = berth.z;
  if (berth.kind === 'big') {
    const T = BOAT_TYPES[type], d = berth.off + 0.45 + (berth.stern ? T.len / 2 : T.beam / 2);
    lx = berth.ex + berth.nx * d; lz = berth.ez + berth.nz * d;
  }
  const [x, z] = toWorld(lx, lz);
  return { x, z, heading: headingToWorld(berth.heading) };
}
// 這種船可以停哪幾類格子（依優先順序）
export const berthKinds = (type) => (type === 'skiff' ? ['small', 'big'] : ['big']);
// 船在不在母港附近（換船、收船時用）
export const inHarbor = (x, z) => { const [lx, lz] = toLocal(x, z); return lx > -56 && lx < 56 && lz > -16 && lz < 60; };

// ---- 看板 -------------------------------------------------------------------
// 商店正面東半邊一排：停船位置牌、本房紀錄、今日紀錄。都面向海（+z）
export const BOARD_Z = S.z1 + 0.3;
export const BOARDS = { berth: { x: -32.6, w: 0.95 }, room: { x: -30.4, w: 2.8 }, daily: { x: -27.5, w: 2.8 } };
export const BOARD_H = 2.3, BOARD_Y0 = DECK_Y + 0.5;   // 排行榜看板的高度、底邊離地多高

// 平台上走不過去的範圍（港座標的矩形）：商店的牆、魚市場的桌子、擋土牆、樓梯兩側、堤頭方墩、外海那側的胸牆、看板
export const WALLS = [
  { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z0 + 0.25 },                 // 商店：後牆
  { x0: S.x0, x1: S.x0 + 0.25, z0: S.z0, z1: S.z1 },                 // 西牆
  { x0: S.x1 - 0.25, x1: S.x1, z0: S.z0, z1: S.z1 },                 // 東牆
  { x0: S.open.x1, x1: S.x1, z0: S.z1 - 0.25, z1: S.z1 },            // 正面東半邊
  { x0: BOARDS.berth.x - 0.6, x1: BOARDS.daily.x + 1.5, z0: BOARD_Z - 0.3, z1: BOARD_Z + 0.25 },   // 一排看板
  { x0: H.MARKET.x0 + 1, x1: H.MARKET.x1 - 1, z0: H.MARKET.z0 + 1.2, z1: H.MARKET.z0 + 3.2 },     // 魚市場的桌子
  { x0: -14, x1: -10.8, z0: H.BASIN.z1 + 0.4, z1: H.BASIN.z1 + 4.5 },                               // 西邊堤頭的方墩（燈塔）
];
{
  // 擋土牆（樓梯那一段留空）、樓梯兩側的側牆
  const R = H.RETAIN;
  let x = R.x0;
  for (const s of [...H.STAIRS].sort((a, b) => a.x - b.x)) {
    WALLS.push({ x0: x, x1: s.x - s.w / 2 - 0.6, z0: R.z - 1.0, z1: R.z + 0.15 });
    for (const side of [-1, 1]) {
      const sx = s.x + side * (s.w / 2 + 0.2);
      WALLS.push({ x0: sx - 0.2, x1: sx + 0.2, z0: s.z1 - 1.2, z1: s.z0 + 0.3 });
    }
    x = s.x + s.w / 2 + 0.6;
  }
  WALLS.push({ x0: x, x1: R.x1, z0: R.z - 1.0, z1: R.z + 0.15 });
  // 面對外海的胸牆：沿著每一段每 0.8 公尺擺一格（斜的那幾段也擋得住）
  for (const [a, b] of H.SEAWARD) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 0.8);
    let nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (nx * mx + nz * (mz - 20) < 0) { nx = -nx; nz = -nz; }   // 朝外海的方向（跟 harbor3d.js 的 outward 一樣）
    for (let i = 0; i <= n; i++) {
      const t = i / n, cx = a[0] + (b[0] - a[0]) * t - nx * 0.4, cz = a[1] + (b[1] - a[1]) * t - nz * 0.4;
      WALLS.push({ x0: cx - 0.45, x1: cx + 0.45, z0: cz - 0.45, z1: cz + 0.45 });
    }
  }
}

// ---- 世界座標版 ---------------------------------------------------------------
// 給瀏覽器的互動判斷和伺服器用：把港座標的一個點 {x, z} 轉成世界座標（其他欄位照抄）
export const homeW = (p) => { const [x, z] = toWorld(p.x, p.z); return { ...p, x, z }; };
export const SELL_W = { basket: homeW(SELL.basket), board: homeW(SELL.board), button: homeW(SELL.button) };
export const SHOP_W = homeW(SHOP);
export const LIGHTHOUSE_W = homeW(LIGHTHOUSE);
// 商品架：每樣商品的位置（x）、站在桌前的位置（站位）都是世界座標；桌子在港座標的 z
export const SHELF_W = SHELF.map((it) => ({ ...it, lx: it.x, ...homeW({ x: it.x, z: SHELF_Z }), stand: homeW({ x: it.x, z: SHELF_Z + 1.3 }) }));
export const BOARD_STAND_W = homeW({ x: BOARDS.berth.x, z: BOARD_Z + 1.2 });
// 玩家出生點：位置與面向（世界座標）
export const SPAWN_W = { ...homeW(PLAYER_SPAWN), yaw: headingToWorld(PLAYER_SPAWN.yaw) };
// 岸壁朝海那一側的邊緣（繫纜樁都在這條邊上），港座標的 z：從岸壁那塊平台推出來，不寫死
export const QUAY_EDGE_Z = DECKS[0].z1;
// 岸壁的中央（朝海那一側）、港內水面的中央：海鷗、環境音、鏡頭、地圖標記用（從岸壁那塊平台推出來）
const quayMidX = (DECKS[0].x0 + DECKS[0].x1) / 2;
export const QUAY_CENTER_W = homeW({ x: quayMidX, z: DECKS[0].z1 });
export const HARBOR_CENTER_W = homeW({ x: quayMidX, z: DECKS[0].z1 + 10 });
// 站在商店門口（世界座標）：靠近這裡會顯示商店的提示
export const SHOP_FRONT_W = homeW({ x: (S.x0 + S.open.x1) / 2, z: S.z1 + 1.5 });
// 停船位置牌：看板中心（世界座標）
export const BERTH_BOARD_W = homeW({ x: BOARDS.berth.x, z: BOARD_Z });
