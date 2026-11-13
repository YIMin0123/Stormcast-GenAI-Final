// 小島漁港的新配置（草案）：照使用者挑的參考圖（Codex 的等角鳥瞰圖）排，尺寸照實際船隻。只有數字，不碰畫面。
// 座標：原點在港池北岸（岸壁靠水的那條邊）的正中央；x 向東、z 向南、y 向上（海平面 = 0），單位公尺。
// 確認後再接到 layout.js（伺服器與遊戲共用的那份）。
import { BOAT_TYPES } from '../boatdata.js';

const TRAWLER = BOAT_TYPES.trawler;   // 18 × 6.2：大船格要停得下最大的船
const SKIFF = BOAT_TYPES.skiff;       // 6 × 2.2

export const DECK_Y = 1.3;      // 岸壁、防波堤的走道高度
export const PONTOON_Y = 0.55;  // 浮動碼頭的橋面高度

// ---- 港池（水）：內寬 96、深 40，四角削成斜角；南邊入口 20 公尺 ----
export const BASIN = { x0: -48, x1: 48, z0: 0, z1: 40 };
export const ENTRANCE = { x0: -10, x1: 10 };

// ---- 岸壁＋防波堤：一整塊 U 形的水泥平台（走道高 1.3 m）----
// 港池的邊（從西堤頭沿著港內繞到東堤頭）
export const BASIN_EDGE = [[-10, 40], [-42, 40], [-48, 34], [-48, 3], [-45, 0], [45, 0], [48, 3], [48, 34], [42, 40], [10, 40]];
// 平台的外緣（從東堤頭沿著外側繞回西堤頭）
export const PLATFORM_OUTER = [[10.8, 44.5], [44, 44.5], [52.5, 36], [52.5, -11], [49.5, -14], [-49.5, -14], [-52.5, -11], [-52.5, 36], [-44, 44.5], [-10.8, 44.5]];
export const PLATFORM = [...BASIN_EDGE, ...PLATFORM_OUTER];
// 面對外海、堆消波塊的那幾段（側邊岸壁的上半段靠著陸地，不堆）
export const SEAWARD = [
  [[-10.8, 44.5], [-44, 44.5]], [[-44, 44.5], [-52.5, 36]], [[-52.5, 36], [-52.5, 16]],
  [[44, 44.5], [10.8, 44.5]], [[52.5, 36], [44, 44.5]], [[52.5, 16], [52.5, 36]],
];
export const BEACON = { x: ENTRANCE.x1 + 2.6, z: BASIN.z1 + 2.3, h: 5 };   // 紅燈標：東邊堤頭
export const LIGHTHOUSE = { x: -12.4, z: BASIN.z1 + 2.45, base: 1.4, h: 8 };   // 白燈塔：西邊堤頭的方墩上（和東邊的紅燈標一對）

// ---- 陸地：一整塊圓潤的島，後面一座山丘；兩側陸地沿著側邊岸壁的上半段往下收，海岸是一圈岩石 ----
export const ISLAND = { x: 0, z: -24, rx: 66, rz: 30 };            // 島的主體（橢圓）
export const SIDES = [{ x: -59, z: -2, rx: 9, rz: 22 }, { x: 59, z: -2, rx: 9, rz: 22 }];   // 兩側往下收的那一截
export const HILL = { x: 0, z: -34, rx: 40, rz: 18, peak: 10 };     // 後山（最高 10 m）
export const RETAIN = { x0: -47, x1: 47, z: -14, h: 2.5 };         // 岸壁後面的擋土牆（牆頂 = 1.3 + 2.5）
export const STAIRS = [{ x: 12, z0: -9.8, z1: -14, w: 3 }];        // 一道樓梯：貼著牆的前面往上爬
export const PATHS = [];
export const PATH_W = 1.8;
export const SUMMIT = null;
export const FENCE = null;

// ---- 建築 ----
// 商店（左邊、靠牆）：正面西半邊是開放的店面（看得到店裡的貨架），東半邊掛三塊排行榜
export const SHOP = { x0: -42, x1: -26, z0: -13, z1: -5, h: 3.4, open: { x0: -41, x1: -33.5 } };
export const BOARDS = [-31.8, -29.4, -27.0].map((x, i) => ({ id: ['berth', 'room', 'daily'][i], x, w: 2.0, z: SHOP.z1 + 0.15, y0: DECK_Y + 0.5, h: 2.3 }));
export const SPAWN = { x: -30, z: -2.5, yaw: Math.PI / 2 };   // 商店門口，面向港池
// 魚市場棚（右邊、靠牆）：開放的鐵皮屋頂；賣魚的籃子、電子價格板、按鈕在棚子前面
export const MARKET = { x0: 24, x1: 38, z0: -12.5, z1: -5, h: 3.6 };
export const SELL = { basket: { x: 28, z: -3.6 }, board: { x: 30, z: -4.3 }, button: { x: 32, z: -3.6 } };
// 大漁旗：牆上的坡地，三根旗桿
export const FLAGS = [-7, 0, 7].map((x) => ({ x, z: -17.5, h: 7 }));
export const LAMPS = [[-46, -2], [-20, -2], [4, -2], [20, -2], [46, -2], [-50.5, 20], [50.5, 20]].map(([x, z]) => ({ x, z }));

// ---- 浮動碼頭：兩條往南伸的浮橋，各一段跳板從岸壁走下來 ----
export const PONTOONS = [-13, 13].map((x) => ({ x, w: 1.6, z0: 4.5, z1: 26 }));
export const GANGWAYS = PONTOONS.map((p) => ({ x: p.x, w: 1.2, z0: 0, z1: p.z0 }));   // 1.3 → 0.55 公尺

// ---- 停船格（32 格）----
// small：每條浮橋兩側各 6 格（共 24），船尾靠浮橋；big：東西堤內側各 4 格（共 8），船尾靠堤、船頭朝港內
export const BERTHS = [];
{
  const off = 1.6 / 2 + 0.35 + SKIFF.len / 2;
  PONTOONS.forEach((p, k) => {
    for (let i = 0; i < 6; i++) {
      const z = p.z0 + 2.5 + i * 3.1;
      BERTHS.push({ id: `${'AB'[k]}-${i * 2 + 1}`, kind: 'small', x: p.x - off, z, heading: Math.PI });
      BERTHS.push({ id: `${'AB'[k]}-${i * 2 + 2}`, kind: 'small', x: p.x + off, z, heading: 0 });
    }
  });
  const pitch = TRAWLER.beam + 1.3;
  const bx = BASIN.x1 - 0.45 - TRAWLER.len / 2;
  for (let i = 0; i < 4; i++) {
    const z = 7 + i * pitch;
    BERTHS.push({ id: `W-${i + 1}`, kind: 'big', x: -bx, z, heading: 0 });
    BERTHS.push({ id: `E-${i + 1}`, kind: 'big', x: bx, z, heading: Math.PI });
  }
}
export function berthRect(b) {
  const t = b.kind === 'small' ? SKIFF : TRAWLER;
  return { x: b.x, z: b.z, len: t.len, beam: t.beam, heading: b.heading };
}

// 繫船柱：岸壁邊每 7 公尺一根（避開跳板），大船格每格堤邊一根
export const BOLLARDS = [];
for (let x = -42; x <= 42; x += 7) if (GANGWAYS.every((g) => Math.abs(x - g.x) > 2)) BOLLARDS.push({ x, z: -0.5 });
for (const b of BERTHS) if (b.kind === 'big') BOLLARDS.push({ x: Math.sign(b.x) * (BASIN.x1 + 0.5), z: b.z });

// 小物件堆
export const PROPS = [
  { kind: 'crates', x: -44.5, z: -8, w: 2, d: 3 },
  { kind: 'crates', x: -22, z: -10, w: 2.5, d: 2 },
  { kind: 'floats', x: 2, z: -12.5, w: 3, d: 1.2 },
  { kind: 'fishboxes', x: 40.5, z: -8, w: 2, d: 3 },
];
