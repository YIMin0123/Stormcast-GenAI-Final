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
export const SPAWN = { x: -16, z: -2.5, yaw: Math.PI / 2 };   // 商店門口，面向棧橋
// 店裡賣東西的長桌：玩家走進店裡、站在桌子南邊買
export const SHELF_Z = -11.0;
export const SHELF_X = [-26.6, -20.4];
// 魚市場（橋頭東邊）：開放的棚子；賣魚的籃子、電子價格板、按鈕在棚子前面的木平台上
export const MARKET = { x0: 13, x1: 27, z0: -12.5, z1: -5, h: 3.6 };
export const SELL = { basket: { x: 17, z: -3.6 }, board: { x: 19, z: -4.3 }, button: { x: 21, z: -3.6 } };
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
