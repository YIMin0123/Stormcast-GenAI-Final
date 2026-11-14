// 母島木造漁港的配置：只有數字，不碰畫面。遊戲的 layout.js（伺服器與遊戲共用）照這份的數字排。
// 方向：參考盜賊之海前哨站的感覺——商店、魚市場夾在橋頭，一條會轉彎的木棧橋從岸邊伸出去，轉角有一塊比較寬的木平台。
// 座標（港座標）：原點在岸邊木平台靠海那條邊的正中央；x 向東、z 向南（往外海）、y 向上（海平面 = 0），單位公尺。
import { BOAT_TYPES } from '../boatdata.js';

const TRAWLER = BOAT_TYPES.trawler;   // 18 × 6.2：每一格都要停得下最大的船

export const DECK_Y = 1.3;      // 所有木棧板（岸邊平台、棧橋、指棧、商店和魚市場的地板）的高度

// ---- 島：一整塊圓潤的島（主體橢圓＋前面一片給村子用的緩坡＋東邊一個放燈塔的岩岬），後面一座山丘 ----
export const ISLAND = { x: 0, z: -54, rx: 78, rz: 56 };
export const FRONT = { x: 0, z: -6, rx: 56, rz: 9 };          // 岸邊的緩坡（木平台、商店、魚市場在這裡）
export const POINT = { x: 62, z: -27, rx: 13, rz: 11 };       // 東邊的岩岬（燈塔）
export const HILL = { x: -8, z: -62, rx: 50, rz: 32, peak: 16 };
// 母島的低面地形（含海底）蓋的範圍：港座標中心 (cx, cz)、邊長 size。遊戲的大地形在這一塊裡面不畫（兩層疊在同一個高度會互搶）
export const HOME_GROUND = { cx: 0, cz: -46, size: 214 };
export const TERRACE = { x0: -34, x1: 34, z0: -17, z1: -5, y: DECK_Y - 0.05, blend: 6 };   // 村子那一片整平（跟棧板一樣高，一步走上去）

// ---- 木棧板：每一塊都是一個長方形（可以斜放）{ cx, cz 中心, ux, uz 長邊方向, hl 半長, hw 半寬 } ----
const rect = (cx, cz, ux, uz, hl, hw, kind) => ({ cx, cz, ux, uz, hl, hw, kind });
export const PIER_W = 4;                              // 棧橋寬
const HW = PIER_W / 2;
export const BOARDWALK = rect(0, -2, 1, 0, 32, 3, 'walk');          // 岸邊木平台：x -32..32、z -5..1
export const SEG1 = rect(0, 35.5, 0, 1, 34.5, HW, 'pier');          // 棧橋第一段：從岸邊直直往南，z 1..70
export const CORNER = rect(0, 76, 0, 1, 6, 7, 'corner');            // 轉角木平台：14 × 12
// 第二段：從轉角平台南邊往東南偏 30 度（往回伸進平台 1.5 公尺，接縫不會露空）
export const BEND = 30 * Math.PI / 180;
const D2 = [Math.sin(BEND), Math.cos(BEND)];          // 第二段的方向
const B0 = [0, 82];                                    // 第二段的起點（轉角平台南邊正中央）
const SEG2_LEN = 68.5;
export const SEG2 = rect(B0[0] + D2[0] * (SEG2_LEN - 1.5) / 2, B0[1] + D2[1] * (SEG2_LEN - 1.5) / 2, D2[0], D2[1], (SEG2_LEN + 1.5) / 2, HW, 'pier');
// 棧橋的中心線（算「離棧橋多遠」用）
export const PIER_LINE = [[0, 1], [0, 82], [B0[0] + D2[0] * SEG2_LEN, B0[1] + D2[1] * SEG2_LEN]];

// ---- 建築：都踩在棧板高度上（地板也是棧板）----
// 商店（橋頭西邊）：正面朝海，西半邊開放（看得到店裡的長桌和貨架），東半邊掛三塊排行榜
export const SHOP = { x0: -28, x1: -12, z0: -15, z1: -5, h: 3.4, open: { x0: -27, x1: -19.5 } };
export const BOARDS = [-18.6, -16.4, -13.5].map((x, i) => ({ id: ['berth', 'room', 'daily'][i], x, w: 2.0, z: SHOP.z1 + 0.15, y0: DECK_Y + 0.5, h: 2.3 }));
export const SPAWN = { x: 0, z: -9, yaw: Math.PI / 2 };   // 商店和魚市場中間的沙地（正對棧橋），面向海；後面是空地，第三人稱鏡頭拉得開
// 店裡的擺設（地板上的長方形 x0..x1、z0..z1；模型和擋路都照這些）。
// 西半邊是櫃台區：客人從正面的大開口進來，櫃台橫在中間，櫃台後面靠後牆一整排貨架；西牆邊一排立著賣的釣竿。
// 東半邊是展示區：三座展示台（引擎、漁船模型、大漁船模型），後牆是工作台和掛工具的洞洞板
const COUNTER = { x0: -26.7, x1: -20.5, z0: -11.75, z1: -10.95, h: 0.72 };   // 玩家眼睛只有 1.25 公尺高：檯面低一點，商品才在視線底下
export const SHOP_IN = {
  counter: COUNTER,
  backShelf: { x0: -27.7, x1: -20.3, z0: -14.75, z1: -14.1 },
  rodRack: { x0: -27.75, x1: -27.25, z0: -10.2, z1: -6.6 },
  plinths: [-17.9, -15.7, -13.5].map((x) => ({ x0: x - 0.75, x1: x + 0.75, z0: -12.05, z1: -11.15, h: 0.75 })),
  bench: { x0: -19.2, x1: -14.2, z0: -14.75, z1: -14.05, h: 0.9 },
};
// 商品：每樣擺在哪（x, z 是商品中心、y 是擺放面的高度），客人站在它南邊 1.3 公尺按 E 買。
// tag：價格牌相對商品的位置（dy 高、dz 前後）、tilt 往後仰多少（0 = 直立）。牌子都貼在櫃台／展示台的正面、商品正下方，商品不會擋到字
// （櫃台的牌子要低到檯面突出的那一截擋不到：從站位看過去，牌子上緣離檯面至少 0.13）
const onCounter = (id, x) => ({ id, x, z: (COUNTER.z0 + COUNTER.z1) / 2, y: DECK_Y + COUNTER.h, tag: { dy: -0.36, dz: 0.42, tilt: 0 } });
const onPlinth = (id, i) => { const p = SHOP_IN.plinths[i]; return { id, x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2, y: DECK_Y + p.h, tag: { dy: -0.38, dz: 0.465, tilt: 0 } }; };
// 餌擺在東半邊後牆的工作台上（客人站在台子南邊按 E）：四種餌，id 是 bait_ 加上餌種（見 fishdata.js 的 BAITS）
const onBench = (id, x) => { const b = SHOP_IN.bench; return { id, x, z: (b.z0 + b.z1) / 2, y: DECK_Y + b.h, tag: { dy: -0.45, dz: 0.45, tilt: 0 } }; };
export const GOODS = [   // 順序跟伺服器的商品清單一樣
  onCounter('fuel', -23.4), onCounter('wrench', -22.1), onCounter('rod', -26.0), onCounter('box', -24.7),
  onPlinth('engine', 0), onPlinth('fisher', 1), onPlinth('trawler', 2),
  onBench('bait_shrimp', -18.5), onBench('bait_minnow', -17.3), onBench('bait_squid', -16.1), onBench('bait_lure', -14.9),
];
// 魚市場（橋頭東邊）：開放的棚子，前排左右兩座鋪冰的展示台；中間那根柱子是收購站——
// 柱子上掛電子價格板，左邊是放在磅秤上的漁獲籃，緊靠著籃子右邊是賣出的按鈕。棚子裡有處理魚的長桌、冰櫃和魚箱、東邊一排活魚水槽
export const MARKET = { x0: 13, x1: 27, z0: -12.5, z1: -5, h: 3.6 };
// 板子貼在中間那根柱子的正面；按鈕緊靠磅秤右邊（磅秤台半寬 0.55、按鈕柱半徑 0.2，中間留 0.3）：站在籃子旁邊就按得到
const BASKET = { x: 18.5, z: -4.0 };
export const SELL = { basket: BASKET, board: { x: 20, z: -5.06 }, button: { x: BASKET.x + 1.05, z: BASKET.z } };
// 磅秤的錶：指針跟著籃子裡魚的總重量轉，0 在左下、滿刻度在右下（掃過 sweep 弧度），超過 maxKg 就頂在底；
// 每 tickKg 一格短刻度、每 majorKg 一格長刻度。angle(kg)：指針轉的角度（0 朝正上方、正的往左轉）
export const SCALE_DIAL = {
  maxKg: 50, tickKg: 5, majorKg: 10, sweep: Math.PI * 1.5,
  angle(kg) { return this.sweep / 2 - this.sweep * Math.min(Math.max(kg, 0), this.maxKg) / this.maxKg; },
};
export const MARKET_IN = {
  displays: [{ x0: 13.8, x1: 18.4, z0: -6.75, z1: -5.75 }, { x0: 21.6, x1: 26.2, z0: -6.75, z1: -5.75 }],
  table: { x0: 17.4, x1: 22.6, z0: -9.6, z1: -8.7, h: 0.9 },
  chest: { x0: 13.6, x1: 15.4, z0: -11.6, z1: -10.6 },
  boxes: { x0: 15.9, x1: 17.4, z0: -12.1, z1: -10.9 },
  tanks: { x0: 24.6, x1: 26.5, z0: -11.6, z1: -8.0 },
};
// 室內燈：店裡（櫃台區、展示區）和魚市場棚下各有一組，牆上（柱子上）的開關一按整組亮或暗；整間房共用（伺服器記著）。
// ROOM_LAMPS 是真的打光的位置（電腦版）；燈泡的模型在 shopMarket.js 蓋（記在 out.bulbs）
export const LIGHT_ZONES = ['shop', 'market'];
// 有屋頂遮雨的範圍（含屋簷）：底下不畫雨絲、不濺水花。y 是屋頂最高處（比它高的雨照常落下來，落到屋頂為止）
export const ROOFS = [
  { x0: SHOP.x0 - 0.7, x1: SHOP.x1 + 0.7, z0: SHOP.z0 - 0.7, z1: SHOP.z1 + 0.7, y: DECK_Y + SHOP.h + 2.3 },
  { x0: MARKET.x0 - 0.6, x1: MARKET.x1 + 0.6, z0: MARKET.z0 - 0.5, z1: MARKET.z1 + 0.9, y: DECK_Y + MARKET.h + 0.9 },
];
export const ROOM_LAMPS = [
  { zone: 'shop', x: -20.0, y: DECK_Y + 2.6, z: -10.0 },   // 一盞照整間店（每多一盞，電腦整個畫面都要多算一次）
  { zone: 'market', x: 20, y: DECK_Y + 2.7, z: -8.6 },
];
// 開關：{ zone, x, z 開關面板的中心, y 高, nx, nz 面板朝哪邊（玩家站的那一側）}
export const SWITCHES = [
  { zone: 'shop', x: -27.73, z: -6.0, y: DECK_Y + 1.3, nx: 1, nz: 0 },     // 店裡西牆、靠門口
  { zone: 'market', x: 13.3, z: -5.12, y: DECK_Y + 1.3, nx: 0, nz: 1 },    // 魚市場最西邊那根前柱
];
// 有字的招牌（畫在貼圖上）：style 是 wood 木頭看板、cloth 布條、nobori 直式的旗（字直排）
export const SIGNS = [
  { text: '港口漁具行', x: -23.2, y: DECK_Y + 4.75, z: -6.42, w: 5.2, h: 0.9, rot: 0, style: 'wood' },
  { text: '魚市場', x: 20, y: DECK_Y + 3.18, z: -4.98, w: 3.2, h: 0.6, rot: 0, style: 'wood' },
  { text: '今日漁獲・新鮮直送', x: 20, y: DECK_Y + 1.55, z: -12.02, w: 2.4, h: 1.1, rot: 0, style: 'chalk' },   // 釘在後排中間那根柱子的正面（柱子不會從黑板中間穿出來）
  { text: '鮮魚', x: 13.25, y: DECK_Y + 2.35, z: -4.62, w: 0.46, h: 1.5, rot: 0, style: 'nobori', col: '#c8352a' },
  { text: '大漁', x: 26.75, y: DECK_Y + 2.35, z: -4.62, w: 0.46, h: 1.5, rot: 0, style: 'nobori', col: '#2f5d9a' },
  { text: '釣具', x: -28.6, y: DECK_Y + 2.35, z: -4.4, w: 0.46, h: 1.5, rot: 0, style: 'nobori', col: '#2f5d9a' },
];
// 地板：商店、魚市場也是棧板（walk 判斷用）
export const FLOORS = [
  rect((SHOP.x0 + SHOP.x1) / 2, (SHOP.z0 + SHOP.z1) / 2, 1, 0, (SHOP.x1 - SHOP.x0) / 2, (SHOP.z1 - SHOP.z0) / 2, 'floor'),
  rect((MARKET.x0 + MARKET.x1) / 2, (MARKET.z0 + MARKET.z1) / 2, 1, 0, (MARKET.x1 - MARKET.x0) / 2, (MARKET.z1 - MARKET.z0) / 2, 'floor'),
];
// 坡上的幾間小屋（裝飾，走不進去）：{ x, z 中心, w, d, h, rot }
export const HOUSES = [
  { x: -44, z: -24, w: 7, d: 6, h: 3.0, rot: 0.25 },
  { x: 42, z: -26, w: 6, d: 6, h: 2.8, rot: -0.3 },
  { x: -6, z: -32, w: 8, d: 6, h: 3.2, rot: 0.08 },
];
// 大漁旗：橋頭後面的坡地，三根旗桿
export const FLAGS = [-6, 0, 6].map((x) => ({ x, z: -19, h: 7 }));
// 燈塔：東邊的岩岬上
export const LIGHTHOUSE = { x: 64, z: -27, h: 9 };

// ---- 停船格（32 格，每格一樣大）：船尾靠棧橋、船頭朝外 ----
// 每格 8 公尺寬（大漁船 6.2 公尺寬，格子之間一根 0.8 公尺的指棧）；指棧 8 公尺長，從棧橋邊伸出去
export const PITCH = 8, FINGER_LEN = 8, FINGER_W = 0.8;
export const BERTHS = [];   // { id, ex, ez 棧橋邊上的點, nx, nz 往外的方向, ux, uz 沿著棧橋的方向 }
export const FINGERS = [];
{
  // 一段棧橋的兩側：從 a（離岸近的那頭）沿著 u 方向，每 PITCH 一格
  const side = (ox, oz, ux, uz, s0, n, sides) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      for (const sg of sides) {
        const nx = -uz * sg, nz = ux * sg;   // 往外的方向（sg 選棧橋的哪一側）
        const s = s0 + PITCH * (i + 0.5);
        out.push({ ex: ox + ux * s + nx * HW, ez: oz + uz * s + nz * HW, nx, nz, ux, uz });
      }
    }
    for (let i = 0; i <= n; i++) {
      for (const sg of sides) {
        const nx = -uz * sg, nz = ux * sg, s = s0 + PITCH * i;
        const ex = ox + ux * s + nx * HW, ez = oz + uz * s + nz * HW;
        FINGERS.push(rect(ex + nx * FINGER_LEN / 2, ez + nz * FINGER_LEN / 2, nx, nz, FINGER_LEN / 2, FINGER_W / 2, 'finger'));
      }
    }
    return out;
  };
  // 第一段（往南）：sg = +1 → 往西（-x），sg = -1 → 往東；從 z = 6 開始，每側 8 格
  const a = side(0, 0, 0, 1, 6, 8, [1, -1]);
  // 第二段（往東南）：從起點往外 4 公尺開始，每側 8 格
  const b = side(B0[0], B0[1], D2[0], D2[1], 4, 8, [1, -1]);
  [...a, ...b].forEach((s, i) => BERTHS.push({ id: `${i + 1}號`, ...s }));
}
// 繫船柱：每格的棧橋邊上一根（船尾的纜繩綁在這裡）
export const BOLLARDS = BERTHS.map((b) => ({ x: b.ex - b.nx * 0.35, z: b.ez - b.nz * 0.35 }));
// 會亮的燈（晚上真的打光，最多 4 盞）：橋頭、轉角平台、第二段中間、橋尾。{ x, z 燈桿, ax, az 燈頭伸出去的方向 }
export const LAMPS = [
  { x: HW - 0.25, z: 3, ax: -1, az: 0 },
  { x: CORNER.cx + CORNER.hw - 0.4, z: CORNER.cz, ax: -1, az: 0 },
  { x: B0[0] + D2[0] * 34 + D2[1] * (HW - 0.25), z: B0[1] + D2[1] * 34 - D2[0] * (HW - 0.25), ax: -D2[1], az: D2[0] },
  { x: B0[0] + D2[0] * (SEG2_LEN - 0.5) + D2[1] * (HW - 0.25), z: B0[1] + D2[1] * (SEG2_LEN - 0.5) - D2[0] * (HW - 0.25), ax: -D2[1], az: D2[0] },
];
// 路燈也有開關：每根燈桿朝棧橋中間那一面一個，一盞燈一區（整間房共用，跟室內燈一樣伺服器記著）。天黑了開著的才亮
LIGHT_ZONES.push(...LAMPS.map((_, i) => `dock${i}`));
SWITCHES.push(...LAMPS.map((l, i) => ({ zone: `dock${i}`, x: l.x + l.ax * 0.125, z: l.z + l.az * 0.125, y: DECK_Y + 1.3, nx: l.ax, nz: l.az })));
export const ZONE_LABEL = (zone) => (zone === 'shop' ? '店裡的燈' : zone === 'market' ? '魚市場的燈' : '這盞路燈');
// 梯子：從棧橋邊爬下水、落水的人從這裡爬上來。{ x, z 棧橋邊上的點, nx, nz 往外（水）的方向 }
// 放在沒有停船格的地方：橋頭兩側、轉角平台東西兩邊、橋尾
export const LADDERS = [
  { x: -HW, z: 3.5, nx: -1, nz: 0 },
  { x: HW, z: 4.6, nx: 1, nz: 0 },
  { x: CORNER.cx - CORNER.hw, z: 77.4, nx: -1, nz: 0 },
  { x: CORNER.cx + CORNER.hw, z: 79, nx: 1, nz: 0 },
  { x: B0[0] + D2[0] * SEG2_LEN, z: B0[1] + D2[1] * SEG2_LEN, nx: D2[0], nz: D2[1] },
];

// 小物件堆：木桶、木箱、魚箱、浮球、漁網（{ kind, x, z, w, d }，放在棧板上）
export const PROPS = [
  { kind: 'crates', x: -29.5, z: -3, w: 2.5, d: 2.5 },
  { kind: 'barrels', x: -9.5, z: -3.8, w: 2, d: 1.6 },
  { kind: 'fishboxes', x: 25, z: -3, w: 2.5, d: 2 },
  { kind: 'floats', x: 9, z: -3.8, w: 2.4, d: 1.4 },
  { kind: 'barrels', x: -4.5, z: 79, w: 3, d: 3 },
  { kind: 'crates', x: 4.5, z: 79.5, w: 2.5, d: 3 },
  { kind: 'nets', x: -3.6, z: 72.5, w: 2, d: 2 },
  { kind: 'crates', x: B0[0] + D2[0] * 64.5 - D2[1] * 0.9, z: B0[1] + D2[1] * 64.5 + D2[0] * 0.9, w: 1.2, d: 1.2 },   // 橋尾西側（東側是燈、正中間是梯子）
];
