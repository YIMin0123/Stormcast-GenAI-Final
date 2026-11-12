// 母港的配置：哪裡是岸壁、浮橋、商店、賣魚的籃子、停船格、排行榜看板。
// 這個檔案只有數字，不碰畫面：伺服器（分配停船格、檢查玩家是不是真的站在商店前）和瀏覽器（蓋模型、判斷互動）共用同一份。
import { BOAT_TYPES } from './boatdata.js';

export const DECK_Y = 1.3; // 岸壁的高度（海平面以上，公尺）；比船的甲板略高，一步就能跨上船

// 可行走的平台（軸對齊矩形，公尺）：岸壁與防波堤。都是實心的水泥，游泳的人鑽不到底下
export const DECKS = [
  { x0: -30, x1: 22, z0: 104, z1: 118 },     // 岸壁
  { x0: 18, x1: 22, z0: 118, z1: 160 },      // 防波堤：往南伸出去
  { x0: -10, x1: 18, z0: 156, z1: 160 },     // 防波堤：轉向西，圍住港內
];

// 唯一的一間店：賣魚、買釣具、升級船都在這附近
export const SHOP = { name: '商店', x: -20, z: 107.5, w: 9, d: 6, roof: 0xb5503a, hint: '賣魚請到東邊魚市場前的籃子；油、扳手、釣具和船在店旁的攤位' };
export const LIGHTHOUSE = { x: 30, z: 108, r: 2.5 };
// 賣魚的地方：魚市場前的籃子、顯示價格的電子板、按下去就賣出的按鈕
export const SELL = { basket: { x: 7, z: 112.2, y: DECK_Y }, board: { x: 7, z: 111.2 }, button: { x: 8.4, z: 112.2 } };

// 商品架：商店旁的攤位，一張長桌，每樣商品後面立著一塊價格牌。玩家站在桌前按 E 購買
export const SHELF = [
  { id: 'fuel', x: -11.6 }, { id: 'wrench', x: -9.95 }, { id: 'rod', x: -8.3 }, { id: 'box', x: -6.65 },
  { id: 'engine', x: -5.0 }, { id: 'fisher', x: -3.35 }, { id: 'trawler', x: -1.7 },
];
export const SHELF_X = [-12.5, -0.8];   // 長桌的兩端
export const SHELF_Z = 106.4;
export const PLAYER_SPAWN = { x: -6, z: 114, yaw: Math.PI / 2 };

// ---- 浮動碼頭 ---------------------------------------------------------------
// 從岸壁往港內伸出去的兩條浮橋：一段斜的跳板從岸壁走下來，接一條貼著水面的木棧道，兩側是小舢舨的停船格（船尾朝浮橋）
export const PONTOON_Y = 0.55;          // 浮橋的橋面離水面多高
export const PONTOON_W = 1.6;           // 橋面寬
const PONTOON_Z = [121.6, 140.8];       // 橋面從哪裡到哪裡
const GANG_W = 1.2;                     // 跳板寬
export const PONTOONS = [{ id: 'A', x: -24.75 }, { id: 'B', x: -5.2 }].map((p) => ({
  ...p,
  deck: { x0: p.x - PONTOON_W / 2, x1: p.x + PONTOON_W / 2, z0: PONTOON_Z[0], z1: PONTOON_Z[1] },
  gang: { x0: p.x - GANG_W / 2, x1: p.x + GANG_W / 2, z0: 118, z1: PONTOON_Z[0] },
}));
// 浮橋或跳板在 (x, z) 的橋面高度；不在上面就回傳 null
export function pontoonY(x, z, margin = 0) {
  for (const p of PONTOONS) {
    const d = p.deck, g = p.gang;
    if (x >= d.x0 - margin && x <= d.x1 + margin && z >= d.z0 - margin && z <= d.z1 + margin) return PONTOON_Y;
    if (x >= g.x0 - margin && x <= g.x1 + margin && z >= g.z0 - margin && z <= g.z1) return DECK_Y + (PONTOON_Y - DECK_Y) * Math.min(1, Math.max(0, (z - g.z0) / (g.z1 - g.z0)));
  }
  return null;
}

// 某點是否在岸壁或防波堤上（留一點邊緣餘裕）
export function onDeck(x, z, margin = 0) {
  for (const r of DECKS) {
    if (x >= r.x0 - margin && x <= r.x1 + margin && z >= r.z0 - margin && z <= r.z1 + margin) return true;
  }
  return false;
}

// ---- 停船格 -----------------------------------------------------------------
// 每個人同時只有一艘船放在世界裡，進房時伺服器分配一格：
//   small：浮橋兩側（小舢舨）；big：防波堤內側（漁船、大漁船，貼著堤岸）；anchor：港外西側的錨地（港內滿了才用，哪種船都可以）
// big 的格子記的是堤岸的邊緣（edge）和往水面的方向（nx, nz）：船多寬，船身中心就離邊緣多遠（見 berthPose）
export const BERTHS = [];
{
  const PITCH = 3.1, FIRST = 123.4, N = 6, OFF = PONTOON_W / 2 + 0.35 + BOAT_TYPES.skiff.len / 2;
  for (const p of PONTOONS) {
    for (let i = 0; i < N; i++) {
      for (const side of [-1, 1]) {
        BERTHS.push({ label: `${p.id}-${i * 2 + (side < 0 ? 1 : 2)}`, kind: 'small', x: p.x + side * OFF, z: FIRST + i * PITCH, heading: side > 0 ? 0 : Math.PI });
      }
    }
  }
  // 防波堤內側：東堤兩格（船頭朝南）、南堤一格加外檔一格（並排靠在裡面那艘的外側，船頭朝西）
  BERTHS.push({ label: '堤-1', kind: 'big', ex: 18, ez: 129.3, nx: -1, nz: 0, heading: Math.PI / 2, off: 0 });
  BERTHS.push({ label: '堤-2', kind: 'big', ex: 18, ez: 146.7, nx: -1, nz: 0, heading: Math.PI / 2, off: 0 });
  BERTHS.push({ label: '堤-3', kind: 'big', ex: 0, ez: 156, nx: 0, nz: -1, heading: Math.PI, off: 0 });
  BERTHS.push({ label: '堤-4', kind: 'big', ex: 0, ez: 156, nx: 0, nz: -1, heading: Math.PI, off: 7 });
  // 港外錨地：出港口往西，三排、每排十格，船頭朝東
  for (let c = 0; c < 3; c++) for (let r = 0; r < 10; r++) {
    BERTHS.push({ label: `錨-${c * 10 + r + 1}`, kind: 'anchor', x: -58 - 22 * c, z: 132 + 7.5 * r, heading: 0 });
  }
}
// 這種船停在這一格時，船身中心在哪、朝哪
export function berthPose(berth, type) {
  if (berth.kind !== 'big') return { x: berth.x, z: berth.z, heading: berth.heading };
  const d = berth.off + 0.45 + BOAT_TYPES[type].beam / 2;
  return { x: berth.ex + berth.nx * d, z: berth.ez + berth.nz * d, heading: berth.heading };
}
// 這種船可以停哪幾類格子（依優先順序）
export const berthKinds = (type) => (type === 'skiff' ? ['small', 'anchor'] : ['big', 'anchor']);
// 船在不在母港附近（換船、收船時用）
export const inHarbor = (x, z) => x > -125 && x < 30 && z > 112 && z < 210;

// ---- 看板 -------------------------------------------------------------------
// 魚市場前面一排：停船位置牌、本房紀錄、今日紀錄。都面向海（+z）
export const BOARD_Z = 112.0;
export const BOARDS = { berth: { x: 9.55, w: 0.95 }, room: { x: 11.65, w: 2.8 }, daily: { x: 14.65, w: 2.8 } };
export const BOARD_H = 3.0, BOARD_Y0 = DECK_Y + 0.45;   // 排行榜看板的高度、底邊離地多高

// 平台上走不過去的範圍：防波堤靠外海那一側的胸牆、魚市場裡的魚箱堆、自動販賣機、晒網架、看板
export const WALLS = [
  { x0: 21.2, x1: 22, z0: 118, z1: 160 }, { x0: -10, x1: 22, z0: 159.2, z1: 160 },
  { x0: 2.6, x1: 4.9, z0: 105.0, z1: 106.9 }, { x0: 7.6, x1: 10.2, z0: 105.2, z1: 106.3 }, { x0: 11.6, x1: 13.7, z0: 105.1, z1: 106.6 },
  { x0: -15.25, x1: -12.85, z0: 104.9, z1: 105.75 },
  { x0: 16.35, x1: 19.65, z0: 112.45, z1: 113.95 },
  { x0: -33.2, x1: 25.2, z0: 99.5, z1: 101.0 },   // 靠山的擋土牆
  { x0: BOARDS.berth.x - 0.6, x1: BOARDS.daily.x + 1.5, z0: BOARD_Z - 0.3, z1: BOARD_Z + 0.25 },   // 一排看板
];
