// 母港的配置：哪裡是木棧板、商店、賣魚的籃子、停船格、排行榜看板。
// 這個檔案只有數字，不碰畫面：伺服器（分配停船格、檢查玩家是不是真的站在商店前）和瀏覽器（蓋模型、判斷互動）共用同一份。
// 港口的設計圖在 lowpoly/harborPlan.js（木造漁港）：這裡的數字都從那份來，不另外寫死。
import { BOAT_TYPES } from './boatdata.js';
import { BOAT_REPAIR } from './boatdata.js';
import { toWorld, toLocal, headingToWorld, HAVEN, SEA_YARD } from './frame.js';
import { TABLET } from './config.js';
import { PORT, PORT_GOODS, PORT_STAND_OFF, TOWN } from './lowpoly/havenPlan.js';
import * as Y from './lowpoly/seaYardPlan.js';
import * as H from './lowpoly/harborPlan.js';
import { onBoards, pierDist } from './lowpoly/homeShape.js';

// 這個檔案裡的座標全是「港座標」（見 frame.js）：原點在岸邊木平台靠海那條邊的正中央，x 向東、z 向南（往外海）。
// 要給世界用的（玩家與船的位置、伺服器的檢查）：onDeck / deckY / inHarbor 吃世界座標、內部自己轉；
// berthPose 回傳世界座標；SELL、SHELF 等有 world 版本（見檔尾的 homeW）。要用港座標的（蓋模型）用 deckYLocal。

export const DECK_Y = H.DECK_Y; // 木棧板的高度（海平面以上，公尺）；比船的甲板略高，一步就能跨上船

// 以前的水泥岸壁要在牆腳畫水線；木棧橋底下是空的，沒有牆，所以是空的
export const DECKS = [];

// 母港的店（港口漁具行）：只賣釣具和補給；賣魚在橋頭東邊魚市場前的籃子。船務在海上修船屋和大港（見檔尾的據點）
const S = H.SHOP;
export const SHOP = { name: '商店', x: (S.x0 + S.x1) / 2, z: (S.z0 + S.z1) / 2, w: S.x1 - S.x0, d: S.z1 - S.z0, roof: 0x525d68, hint: '賣魚請到橋頭東邊魚市場的收購站；油、釣具在店裡的櫃台，引擎和船在店裡東邊的展示台' };
// 燈塔：東邊岩岬上的白燈塔（r：走不過去的範圍）
export const LIGHTHOUSE = { x: H.LIGHTHOUSE.x, z: H.LIGHTHOUSE.z, r: 1.25 };   // 塔身底部半徑 1.2（腳下的石墩踩得上去，見 harbor3d.js）
// 賣魚的地方：魚市場前面的收購站（磅秤上的籃子、柱子上的電子價格板、按下去就賣出的按鈕）
export const SELL = {
  basket: { x: H.SELL.basket.x, z: H.SELL.basket.z, y: DECK_Y },
  board: { x: H.SELL.board.x, z: H.SELL.board.z },
  button: { x: H.SELL.button.x, z: H.SELL.button.z },
};
// 伺服器檢查「人在收購站旁邊」：離按鈕多遠內可以賣（畫面上 1.7 公尺內才按得到，多留一點給網路延遲、位置還沒送到）
export const SELL_REACH = 4;

// 商品：油、誘魚桶、魚箱、釣竿擺在櫃台上，餌在後牆的工作台（見 harborPlan.js 的 GOODS）。
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
// 每個人同時只有一艘船放在世界裡，進房時伺服器在母港分配一格（母港 32 格，每格一樣大，什麼船都停得下）。
// 格子記的是棧橋邊上的點（ex, ez）和往外的方向（nx, nz）：船尾靠棧橋、船頭朝外，船多長，船身中心就離邊緣多遠（見 berthPose）
// 排的順序是離岸邊由近到遠：伺服器先分近的。
// 母港的格子後面接著海上修船屋的 4 格臨時泊位、大港灣島的 16 格（各用自己的座標 frame；max：停得下多長的船）：
// 平板在那邊叫船、換船、買新船時才會用到（進房一律先停母港）
const siteBerths = (site, frame, list) => list.map((b) => ({ label: b.id, kind: site, site, frame, ex: b.ex, ez: b.ez, nx: b.nx, nz: b.nz, heading: Math.atan2(b.nz, b.nx), max: b.max ?? Infinity }));
export const HOME_BERTHS = H.BERTHS.length;
export const BERTHS = [
  ...H.BERTHS.map((b) => ({ label: b.id, kind: 'slip', site: 'home', frame: null, ex: b.ex, ez: b.ez, nx: b.nx, nz: b.nz, heading: Math.atan2(b.nz, b.nx), max: Infinity })),
  ...siteBerths('yard', SEA_YARD, Y.BERTHS), ...siteBerths('haven', HAVEN, PORT.berths),
];
// 這種船停在這一格時，船身中心在哪、朝哪
export function berthPose(berth, type) {
  const d = 0.45 + BOAT_TYPES[type].len / 2, F = berth.frame;
  const [x, z] = (F ? F.toWorld : toWorld)(berth.ex + berth.nx * d, berth.ez + berth.nz * d);
  return { x, z, heading: (F ? F.headingToWorld : headingToWorld)(berth.heading) };
}
// 這種船可以停哪幾類格子（進房時分配用）：只分母港的
export const berthKinds = () => ['slip'];
// 這一格停不停得下這種船
export const berthFits = (berth, type) => BOAT_TYPES[type].len <= berth.max;
// 船在不在母港附近（換船、收船時用）：棧橋兩側 30 公尺內、岸邊木平台前面
export const inHarbor = (x, z) => { const [lx, lz] = toLocal(x, z); return lz > -8 && pierDist(lx, lz) < 30; };

// ---- 看板 -------------------------------------------------------------------
// 商店正面東半邊一排：漁會捐贈榜（以前停船位置牌的位置）、本房紀錄、今日紀錄。都面向海（+z）
export const BOARD_Z = S.z1 + 0.3;
export const BOARDS = { donate: { x: H.BOARDS[0].x, w: 1.4 }, room: { x: H.BOARDS[1].x, w: 2.8 }, daily: { x: H.BOARDS[2].x, w: 2.8 } };
export const BOARD_H = 2.3, BOARD_Y0 = DECK_Y + 0.5;   // 排行榜看板的高度、底邊離地多高

// 走不過去的範圍（港座標的矩形）：商店的牆、看板、店裡和魚市場的擺設、坡上的小屋
export const WALLS = [
  { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z0 + 0.25 },                 // 商店：後牆
  { x0: S.x0, x1: S.x0 + 0.25, z0: S.z0, z1: S.z1 },                 // 西牆
  { x0: S.x1 - 0.25, x1: S.x1, z0: S.z0, z1: S.z1 },                 // 東牆
  { x0: S.x0, x1: S.open.x0, z0: S.z1 - 0.25, z1: S.z1 },           // 正面西側短牆
  { x0: S.open.x1, x1: S.x1, z0: S.z1 - 0.25, z1: S.z1 },            // 正面東半邊
  { x0: BOARDS.donate.x - 0.8, x1: BOARDS.daily.x + 1.5, z0: BOARD_Z - 0.3, z1: BOARD_Z + 0.25 },   // 一排看板
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
// 玩家出生點：位置與面向（世界座標）
export const SPAWN_W = { ...homeW(PLAYER_SPAWN), yaw: headingToWorld(PLAYER_SPAWN.yaw) };
// 岸邊木平台中央的空地，避開棧橋、商店與港口擺設。每個泊位對應一個回港位置。
export function passengerLanding(berth) {
  const { BOARDWALK } = H;
  const k = ((berth % HOME_BERTHS) + HOME_BERTHS) % HOME_BERTHS;   // 停在修船屋、大港泊位的人也照編號分一個位置
  const x = BOARDWALK.cx + (k % 8 - 3.5) * 1.95;
  const z = BOARDWALK.cz + (Math.floor(k / 8) - 1.5) * 1.5;
  return { ...homeW({ x, z }), y: DECK_Y, yaw: SPAWN_W.yaw };
}
// 以前水泥岸壁朝海的那條邊（纜繩翻過牆角用）；木棧橋的纜繩直接拉，不翻牆角，所以放到無限遠
export const QUAY_EDGE_Z = Infinity;
// 橋頭（岸邊木平台中央）、棧橋第一段的中間：海鷗、環境音、鏡頭、地圖標記用
export const QUAY_CENTER_W = homeW({ x: 0, z: 0 });
export const HARBOR_CENTER_W = homeW({ x: H.SEG1.cx, z: H.SEG1.cz });
// 站在商店門口（世界座標）：靠近這裡會顯示商店的提示
export const SHOP_FRONT_W = homeW({ x: (S.x0 + S.open.x1) / 2, z: S.z1 + 1.5 });

// 大港灣島：吊鉤大秤收購站在世界的哪裡（伺服器檢查人有沒有站在旁邊用）
const havenW = (p) => { const [x, z] = HAVEN.toWorld(p.x, p.z); return { x, z }; };
export const HAVEN_SELL_W = havenW(PORT.sell);

// ---- 三個據點（世界座標）----------------------------------------------------
// 母港（只賣釣具補給）、海上修船屋、大港灣島（後兩個辦船務：修船、買船、引擎、改裝、塗裝）。
// callR：人離據點中心多近可以用平板叫船、換船；repairR：船停在多近以內修船台修得到
const yardC = (() => { const [x, z] = SEA_YARD.toWorld(0, 2); return { x, z }; })();
export const SITES = {
  home: { id: 'home', name: '潮汐灣', x: QUAY_CENTER_W.x, z: QUAY_CENTER_W.z, callR: TABLET.harborR, repairR: 0 },
  yard: { id: 'yard', name: '海上修船屋', ...yardC, callR: TABLET.yardR, repairR: BOAT_REPAIR.range },
  haven: { id: 'haven', name: '大港灣島', ...havenW(PORT.center), callR: TABLET.havenR, repairR: PORT.repairR },
};
// (x, z) 在哪個據點的範圍裡（都不在回傳 null）
export const siteAt = (x, z) => Object.values(SITES).find((s) => Math.hypot(x - s.x, z - s.z) < s.callR) ?? null;

// 修船屋和大港的商品、工位（世界座標）：{ id, site, x, z, y 擺放面高度, stand 客人站的位置, tagW / tag 價格牌, lx, lz, face 設計圖座標（蓋模型用）}
const siteShelf = (site, frame, g, off, y) => {
  const t = g.tag ?? { dy: -0.38, dz: 0.46 };
  const [x, z] = frame.toWorld(g.x, g.z), [sx, sz] = frame.toWorld(g.x, g.z + g.face * off), [tx, tz] = frame.toWorld(g.x, g.z + g.face * t.dz);
  return { id: g.id, site, x, z, y, lx: g.x, lz: g.z, face: g.face, stand: { x: sx, z: sz }, tagW: { x: tx, z: tz }, tag: { y: y + t.dy, dz: t.dz } };
};
export const SITE_SHELF_W = [
  ...Y.GOODS.map((g) => siteShelf('yard', SEA_YARD, g, Y.STAND_OFF, g.y)),
  ...PORT_GOODS.map((g) => siteShelf('haven', HAVEN, g, PORT_STAND_OFF, (g.deck ? PORT.deckY : TOWN.y + (g.lift ?? 0)) + g.y)),
];
// 全部據點的商品（母港的在前面，編號跟 SHELF 一樣）
export const ALL_SHELF_W = [...SHELF_W.map((s) => ({ ...s, site: 'home' })), ...SITE_SHELF_W];
