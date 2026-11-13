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
export const SHOP = { name: '商店', x: (S.x0 + S.x1) / 2, z: (S.z0 + S.z1) / 2, w: S.x1 - S.x0, d: S.z1 - S.z0, roof: 0x525d68, hint: '賣魚請到橋頭東邊魚市場的收購站；油、扳手、釣具在店裡的櫃台，引擎和船在店裡東邊的展示台' };
// 燈塔：東邊岩岬上的白燈塔（r：走不過去的範圍）
export const LIGHTHOUSE = { x: H.LIGHTHOUSE.x, z: H.LIGHTHOUSE.z, r: 1.25 };   // 塔身底部半徑 1.2（腳下的石墩踩得上去，見 harbor3d.js）
// 賣魚的地方：魚市場前面的收購站（磅秤上的籃子、柱子上的電子價格板、按下去就賣出的按鈕）
export const SELL = {
  basket: { x: H.SELL.basket.x, z: H.SELL.basket.z, y: DECK_Y },
  board: { x: H.SELL.board.x, z: H.SELL.board.z },
  button: { x: H.SELL.button.x, z: H.SELL.button.z },
};

// 商品：油、扳手、釣竿、魚箱擺在櫃台上，引擎和兩艘船（模型）擺在展示台上（見 harborPlan.js 的 GOODS）。
// 每樣商品旁邊一塊價格牌；玩家站在商品南邊（站位）按 E 購買。{ id, x, z 商品位置, y 擺放面高度, tag { x, y, z, tilt } 價格牌 }
export const SHELF = H.GOODS.map((g) => ({ id: g.id, x: g.x, z: g.z, y: g.y, tag: { x: g.x, y: g.y + g.tag.dy, z: g.z + g.tag.dz, tilt: g.tag.tilt } }));
export const STAND_OFF = 1.3;   // 站位在商品南邊多遠
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

// 走不過去的範圍（港座標的矩形）：商店的牆、看板、店裡和魚市場的擺設、坡上的小屋
export const WALLS = [
  { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z0 + 0.25 },                 // 商店：後牆
  { x0: S.x0, x1: S.x0 + 0.25, z0: S.z0, z1: S.z1 },                 // 西牆
  { x0: S.x1 - 0.25, x1: S.x1, z0: S.z0, z1: S.z1 },                 // 東牆
  { x0: S.open.x1, x1: S.x1, z0: S.z1 - 0.25, z1: S.z1 },            // 正面東半邊
  { x0: BOARDS.berth.x - 0.6, x1: BOARDS.daily.x + 1.5, z0: BOARD_Z - 0.3, z1: BOARD_Z + 0.25 },   // 一排看板
  { x0: H.MARKET.x0 - 0.2, x1: H.MARKET.x1 + 0.2, z0: H.MARKET.z0, z1: H.MARKET.z0 + 0.2 },        // 魚市場後面那道木牆
  { x0: H.SELL.board.x - 0.76, x1: H.SELL.board.x + 0.76, z0: H.SELL.board.z - 0.1, z1: H.SELL.board.z + 0.22 },   // 魚市場中間柱子上的價格板：底邊只到胸口，不擋的話頭會鑽進板子裡
  // 店裡：櫃台、後面的貨架、西牆邊的釣竿架、三座展示台、工作台
  ...[H.SHOP_IN.counter, H.SHOP_IN.backShelf, H.SHOP_IN.rodRack, ...H.SHOP_IN.plinths, H.SHOP_IN.bench].map((b) => ({ x0: b.x0 - 0.05, x1: b.x1 + 0.05, z0: b.z0 - 0.05, z1: b.z1 + 0.05 })),
  // 魚市場：兩座鋪冰的展示台、處理魚的長桌、冰櫃、魚箱、活魚水槽
  ...[...H.MARKET_IN.displays, H.MARKET_IN.table, H.MARKET_IN.chest, H.MARKET_IN.boxes, H.MARKET_IN.tanks].map((b) => ({ x0: b.x0 - 0.05, x1: b.x1 + 0.05, z0: b.z0 - 0.05, z1: b.z1 + 0.05 })),
  // 坡上的小屋：斜放的，用跟著轉的長方形擋（石砌地基比牆寬 0.15）
  ...H.HOUSES.map((h) => ({ cx: h.x, cz: h.z, ux: Math.cos(h.rot), uz: -Math.sin(h.rot), hl: h.w / 2 + 0.15, hw: h.d / 2 + 0.15 })),
];
// 某點在不在這個擋路的長方形裡（一般的是對齊座標軸的 x0..x1、z0..z1；斜放的是中心＋方向＋半長半寬）
export function inWall(r, x, z) {
  if (r.ux === undefined) return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
  const dx = x - r.cx, dz = z - r.cz;
  return Math.abs(dx * r.ux + dz * r.uz) < r.hl && Math.abs(-dx * r.uz + dz * r.ux) < r.hw;
}

// ---- 世界座標版 ---------------------------------------------------------------
// 給瀏覽器的互動判斷和伺服器用：把港座標的一個點 {x, z} 轉成世界座標（其他欄位照抄）
export const homeW = (p) => { const [x, z] = toWorld(p.x, p.z); return { ...p, x, z }; };
export const SELL_W = { basket: homeW(SELL.basket), board: homeW(SELL.board), button: homeW(SELL.button) };
// 室內燈的開關（世界座標）：站的位置在面板前面 0.8 公尺
export const LIGHT_ZONES = H.LIGHT_ZONES;
export const SWITCHES_W = H.SWITCHES.map((s) => ({ ...homeW(s), stand: homeW({ x: s.x + s.nx * 0.8, z: s.z + s.nz * 0.8 }) }));
export const SHOP_W = homeW(SHOP);
// 屋頂遮雨的範圍（世界座標）：中心、港座標 x 軸在世界裡的方向、半寬半長、屋頂高度
export const ROOFS_W = H.ROOFS.map((b) => {
  const [cx, cz] = toWorld((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2), [ax, az] = toWorld(1, 0), [ox, oz] = toWorld(0, 0);
  return { cx, cz, ux: ax - ox, uz: az - oz, hx: (b.x1 - b.x0) / 2, hz: (b.z1 - b.z0) / 2, y: b.y };
});
// 世界座標 (x, y, z) 是不是在屋頂底下
export function underRoof(x, y, z) {
  for (const b of ROOFS_W) {
    const dx = x - b.cx, dz = z - b.cz;
    if (y < b.y && Math.abs(dx * b.ux + dz * b.uz) < b.hx && Math.abs(-dx * b.uz + dz * b.ux) < b.hz) return true;
  }
  return false;
}
export const LIGHTHOUSE_W = homeW(LIGHTHOUSE);
// 商品：位置、站位、價格牌都換成世界座標（高度 y 不變）
export const SHELF_W = SHELF.map((it) => ({ ...it, ...homeW(it), stand: homeW({ x: it.x, z: it.z + STAND_OFF }), tagW: homeW(it.tag) }));
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
