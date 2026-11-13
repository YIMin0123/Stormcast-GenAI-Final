// 母港的配置：哪裡是木棧板、商店、賣魚的籃子、停船格、排行榜看板。
// 這個檔案只有數字，不碰畫面：伺服器（分配停船格、檢查玩家是不是真的站在商店前）和瀏覽器（蓋模型、判斷互動）共用同一份。
// 港口的設計圖在 lowpoly/harborPlan.js（木造漁港）：這裡的數字都從那份來，不另外寫死。
import { BOAT_TYPES } from './boatdata.js';
import { toWorld, toLocal, headingToWorld } from './frame.js';
import * as H from './lowpoly/harborPlan.js';
import { onBoards, pierDist } from './lowpoly/homeShape.js';

// 這個檔案裡的座標全是「港座標」（見 frame.js）：原點在岸邊木平台靠海那條邊的正中央，x 向東、z 向南（往外海）。
// 要給世界用的（玩家與船的位置、伺服器的檢查）：onDeck / deckY / inHarbor 吃世界座標、內部自己轉；
// berthPose 回傳世界座標；SELL、SHELF 等有 world 版本（見檔尾的 homeW）。要用港座標的（蓋模型）用 deckYLocal。

export const DECK_Y = H.DECK_Y; // 木棧板的高度（海平面以上，公尺）；比船的甲板略高，一步就能跨上船

// 以前的水泥岸壁要在牆腳畫水線；木棧橋底下是空的，沒有牆，所以是空的
export const DECKS = [];

// 唯一的一間店：買釣具、油、扳手、船都在店裡的長桌；賣魚在橋頭東邊魚市場前的籃子
const S = H.SHOP;
export const SHOP = { name: '商店', x: (S.x0 + S.x1) / 2, z: (S.z0 + S.z1) / 2, w: S.x1 - S.x0, d: S.z1 - S.z0, roof: 0x525d68, hint: '賣魚請到橋頭東邊魚市場前的籃子；油、扳手、釣具和船在店裡的長桌' };
// 燈塔：東邊岩岬上的白燈塔（r：走不過去的範圍）
export const LIGHTHOUSE = { x: H.LIGHTHOUSE.x, z: H.LIGHTHOUSE.z, r: 1.5 };
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

// ---- 木棧板 ------------------------------------------------------------------
// 岸邊平台、棧橋、轉角平台、指棧、商店和魚市場的地板都一樣高。在上面就回傳高度，不在就回傳 null
export function deckYLocal(x, z, margin = 0) { return onBoards(x, z, margin) ? DECK_Y : null; }
export function deckY(x, z, margin = 0) { const [lx, lz] = toLocal(x, z); return deckYLocal(lx, lz, margin); }
// 某點是否在棧板上（留一點邊緣餘裕）
export function onDeck(x, z, margin = 0) { return deckY(x, z, margin) !== null; }
export const onDeckLocal = (x, z, margin = 0) => onBoards(x, z, margin);

// 梯子：從棧橋邊往水裡伸出去 1 公尺、寬 0.9 公尺的一條「看不見的斜坡」。落水的人游到梯子前面就踩得到，
// 一路往上爬到棧板（從水面下 1.8 公尺開始：比游泳時的腳還低，浪再低都接得上）；站在棧板上往梯子走，也能一路爬下水。不在梯子上就回傳 null
const LADDER_OUT = 1.0, LADDER_HALF = 0.45, LADDER_TOP = 0.15, LADDER_FOOT = 1.8;
export function ladderYLocal(x, z) {
  for (const l of H.LADDERS) {
    const dx = x - l.x, dz = z - l.z, u = dx * l.nx + dz * l.nz, v = -dx * l.nz + dz * l.nx;
    if (Math.abs(v) < LADDER_HALF && u > -0.05 && u < LADDER_OUT) return u <= LADDER_TOP ? DECK_Y : DECK_Y - (u - LADDER_TOP) / (LADDER_OUT - LADDER_TOP) * (DECK_Y + LADDER_FOOT);
  }
  return null;
}
export function ladderY(x, z) { const [lx, lz] = toLocal(x, z); return ladderYLocal(lx, lz); }

// ---- 停船格 -----------------------------------------------------------------
// 每個人同時只有一艘船放在世界裡，進房時伺服器分配一格（共 32 格，每格一樣大，什麼船都停得下）。
// 格子記的是棧橋邊上的點（ex, ez）和往外的方向（nx, nz）：船尾靠棧橋、船頭朝外，船多長，船身中心就離邊緣多遠（見 berthPose）
// 排的順序是離岸邊由近到遠：伺服器先分近的
export const BERTHS = H.BERTHS.map((b) => ({ label: b.id, kind: 'slip', ex: b.ex, ez: b.ez, nx: b.nx, nz: b.nz, heading: Math.atan2(b.nz, b.nx) }));
// 這種船停在這一格時，船身中心在哪、朝哪
export function berthPose(berth, type) {
  const d = 0.45 + BOAT_TYPES[type].len / 2;
  const [x, z] = toWorld(berth.ex + berth.nx * d, berth.ez + berth.nz * d);
  return { x, z, heading: headingToWorld(berth.heading) };
}
// 這種船可以停哪幾類格子（依優先順序）：格子不分大小
export const berthKinds = () => ['slip'];
// 船在不在母港附近（換船、收船時用）：棧橋兩側 30 公尺內、岸邊木平台前面
export const inHarbor = (x, z) => { const [lx, lz] = toLocal(x, z); return lz > -8 && pierDist(lx, lz) < 30; };

// ---- 看板 -------------------------------------------------------------------
// 商店正面東半邊一排：停船位置牌、本房紀錄、今日紀錄。都面向海（+z）
export const BOARD_Z = S.z1 + 0.3;
export const BOARDS = { berth: { x: H.BOARDS[0].x, w: 0.95 }, room: { x: H.BOARDS[1].x, w: 2.8 }, daily: { x: H.BOARDS[2].x, w: 2.8 } };
export const BOARD_H = 2.3, BOARD_Y0 = DECK_Y + 0.5;   // 排行榜看板的高度、底邊離地多高

// 走不過去的範圍（港座標的矩形）：商店的牆、看板、魚市場的桌子、坡上的小屋
export const WALLS = [
  { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z0 + 0.25 },                 // 商店：後牆
  { x0: S.x0, x1: S.x0 + 0.25, z0: S.z0, z1: S.z1 },                 // 西牆
  { x0: S.x1 - 0.25, x1: S.x1, z0: S.z0, z1: S.z1 },                 // 東牆
  { x0: S.open.x1, x1: S.x1, z0: S.z1 - 0.25, z1: S.z1 },            // 正面東半邊
  { x0: BOARDS.berth.x - 0.6, x1: BOARDS.daily.x + 1.5, z0: BOARD_Z - 0.3, z1: BOARD_Z + 0.25 },   // 一排看板
  { x0: H.MARKET.x0 + 1, x1: H.MARKET.x1 - 1, z0: H.MARKET.z0 + 1.2, z1: H.MARKET.z0 + 3.2 },     // 魚市場的桌子
  ...H.HOUSES.map((h) => { const r = Math.hypot(h.w, h.d) / 2 * 0.8; return { x0: h.x - r, x1: h.x + r, z0: h.z - r, z1: h.z + r }; }),   // 坡上的小屋（斜放的，用略小的方框擋）
];

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
// 以前水泥岸壁朝海的那條邊（纜繩翻過牆角用）；木棧橋的纜繩直接拉，不翻牆角，所以放到無限遠
export const QUAY_EDGE_Z = Infinity;
// 橋頭（岸邊木平台中央）、棧橋第一段的中間：海鷗、環境音、鏡頭、地圖標記用
export const QUAY_CENTER_W = homeW({ x: 0, z: 0 });
export const HARBOR_CENTER_W = homeW({ x: H.SEG1.cx, z: H.SEG1.cz });
// 站在商店門口（世界座標）：靠近這裡會顯示商店的提示
export const SHOP_FRONT_W = homeW({ x: (S.x0 + S.open.x1) / 2, z: S.z1 + 1.5 });
// 停船位置牌：看板中心（世界座標）
export const BERTH_BOARD_W = homeW({ x: BOARDS.berth.x, z: BOARD_Z });
