// 世界的可調參數：想改地圖、港口的位置與朝向，只改這個檔案。
// 瀏覽器與伺服器共用，其他檔案不要再寫死這些數字（座標轉換見 frame.js）。
export const WORLD = {
  size: 2048,                                // 地圖邊長（公尺），原點在正中央，+x 東、+z 南
  home: {
    islandLocal: { x: 0, z: -24 },           // 母島中心在「港座標」的位置（港口設計圖的固定參照點，見 lowpoly/harborPlan.js 的 ISLAND，通常不用改）
    center: { x: -552, z: -579 },            // 母島中心在世界的位置（地圖左上一帶）
    harborFacingDeg: 135,                    // 港口面向：以正北為 0、順時針；135 = 東南（地圖的右下）
  },
  waveFromHarborBackDeg: 8.6,                // 浪向相對「港口背面」的偏斜（度）：浪從港口的背面吹來，港內才是背風面
};
