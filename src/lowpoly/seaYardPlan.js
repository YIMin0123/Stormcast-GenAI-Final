// 海上修船屋的設計圖：只有數字（不碰畫面），瀏覽器和伺服器共用。
// 座標是「修船屋座標」（見 frame.js 的 SEA_YARD）：原點在 U 形船塢凹槽底的正中央，+z 朝凹槽開口（船從這頭開進來），x 是橫向，單位公尺。
// 在世界的哪裡、開口朝哪，寫在 config.js 的 WORLD.seaYard。
// 整座是立在海裡的固定樁平台（不跟著浪動）：兩條長臂夾著中間的停船凹槽，底部一塊大平台蓋著造船修船的工坊。

export const DECK_Y = 1.3;   // 平台高度（跟母港的木棧板一樣高，一步跨得上船）

// 平台：三塊長方形（x0..x1、z0..z1）。north／south 是兩條長臂，main 是底部的大平台
export const DECKS = [
  { id: 'north', x0: -8.5, x1: -4.5, z0: -2, z1: 18 },
  { id: 'south', x0: 4.5, x1: 8.5, z0: -2, z1: 18 },
  { id: 'main', x0: -11, x1: 11, z0: -14, z1: -2 },
];
// 中間的停船凹槽（內寬 9 公尺、長 20 公尺：最大的遠洋大漁船 18 × 6.2 也開得進來）
export const SLOT = { x0: -4.5, x1: 4.5, z0: -2, z1: 18 };

// 工坊：蓋在大平台上的鐵皮木構斜頂棚屋，朝凹槽那一面（+z）整面敞開。h 牆高、rise 屋頂再高多少
export const HOUSE = { x0: -10.4, x1: 10.4, z0: -13.2, z1: -3.2, h: 3.5, rise: 1.7 };
// 屋裡的擺設（擋路的長方形）：一整排展示台（商品擺在上面）、後牆的工作台
export const BENCH = { x0: -8.6, x1: 9.4, z0: -8.0, z1: -7.0, h: 0.8 };
export const BACK_BENCH = { x0: -9.6, x1: 9.6, z0: -12.9, z1: -12.2, h: 0.9 };
// 左翼的黃黑小龍門吊（站在大平台西北角，吊臂伸到凹槽上方）
export const CRANE = { x: -9.6, z: -2.9, h: 5.2, reach: 6.5 };
// 屋頂的大招牌與常亮的引航燈（燈不吃霧，遠遠就看得到）
export const SIGN = { text: '海上造船修船廠', x: 0, z: -3.3, w: 9.5, h: 1.3 };
export const BEACON = { x: 6.5, z: -8.2, h: 2.6 };

// 商品與工位：{ id, x, z 位置, y 擺放面高度, face 客人站在哪一側（+1 = +z 那側、-1 = -z 那側）, tag 價格牌相對商品的位置（dy 高、dz 往客人那側多遠；沒寫 = 貼在展示台正面） }
// 修船台和油桶攤在凹槽邊（客人站在屋裡、面向停在凹槽的船）；其他的在屋裡那排展示台上（客人站在展示台朝凹槽那一側）
const onBench = (id, x) => ({ id, x, z: (BENCH.z0 + BENCH.z1) / 2, y: DECK_Y + BENCH.h, face: 1, tag: { dy: -0.38, dz: 0.56 } });
export const GOODS = [
  { id: 'repair', x: 0, z: -2.8, y: DECK_Y + 1.0, face: -1, tag: { dy: 0.05, dz: 0.31 } },   // 修船工作台：凹槽底的正中央
  { id: 'fuel', x: -5.8, z: -2.8, y: DECK_Y + 0.5, face: -1, tag: { dy: -0.2, dz: 0.34 } },   // 手提油桶攤：左臂入口旁
  onBench('engine', -7.5), onBench('fisher', -4.2), onBench('trawler', -0.8),
  onBench('mod_sonar', 3.2), onBench('mod_lamp', 5.8), onBench('paint', 8.5),
];
export const STAND_OFF = 1.3;   // 客人站在商品前面多遠

// 繫纜樁、爬梯（從平台邊往外伸出去的那一點 x, z 與方向 nx, nz）、凹槽內側掛的防撞輪胎
export const BOLLARDS = [
  { x: -4.85, z: 3 }, { x: -4.85, z: 13 }, { x: 4.85, z: 3 }, { x: 4.85, z: 13 },       // 凹槽內側
  { x: -8.15, z: 5 }, { x: -8.15, z: 13 }, { x: 8.15, z: 5 }, { x: 8.15, z: 13 },       // 兩臂外側（臨時泊位）
];
export const LADDERS = [
  { x: -4.5, z: 8, nx: 1, nz: 0 }, { x: 4.5, z: 8, nx: -1, nz: 0 },                      // 凹槽內側各一座
  { x: -6.5, z: 18, nx: 0, nz: 1 }, { x: 6.5, z: 18, nx: 0, nz: 1 },                     // 兩臂的盡頭
];
export const TIRES = [1, 4.5, 8.5, 11.5, 15].flatMap((z) => [{ x: -4.5, z, nx: 1 }, { x: 4.5, z, nx: -1 }]).concat([-2.5, 0, 2.5].map((x) => ({ x, z: -2, nz: 1 })));

// 臨時泊位（平板在修船屋叫船、換船、買新船時停這裡）：格子記平台邊上的點（ex, ez）和往外的方向（nx, nz），船尾靠平台、船頭朝外
export const BERTHS = [
  { id: 'Y1', ex: -8.5, ez: 5, nx: -1, nz: 0 }, { id: 'Y2', ex: 8.5, ez: 5, nx: 1, nz: 0 },
  { id: 'Y3', ex: -8.5, ez: 13, nx: -1, nz: 0 }, { id: 'Y4', ex: 8.5, ez: 13, nx: 1, nz: 0 },
];

// 有屋頂遮雨的範圍（屋簷多 0.6）
export const ROOF = { x0: HOUSE.x0 - 0.6, x1: HOUSE.x1 + 0.6, z0: HOUSE.z0 - 0.6, z1: HOUSE.z1 + 0.6, y: DECK_Y + HOUSE.h + HOUSE.rise };
// 離原點這麼遠以外不用算（整座修船屋的範圍）
export const REACH = 30;
