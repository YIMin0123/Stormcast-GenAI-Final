// 魚種資料與「釣到什麼、多大、值多少」的規則。這個檔案不碰畫面，伺服器和瀏覽器共用同一份：
// 多人模式下由伺服器擲魚（防作弊），瀏覽器只拿結果來顯示。

// kg：常見的重量範圍（大的可以超出，沒有上限）；mult：魚種倍率（每公斤 100 元 × 倍率）；
// strength：上鉤後掙扎的力道；h / w：身高與厚度（相對於身長）；lenK：身長係數
export const KG_PRICE = 100;
export const SPECIES = {
  sardine: { name: '沙丁魚', kg: [0.15, 0.4], mult: 0.30, strength: 0.3, color: 0x4f7fb0, h: 0.22, w: 0.11 },
  mackerel: { name: '鯖魚', kg: [0.4, 1.2], mult: 0.30, strength: 0.5, color: 0x1f6f78, h: 0.22, w: 0.12 },
  bream: { name: '黑鯛', kg: [0.6, 1.5], mult: 0.40, strength: 0.6, color: 0x4a4f58, h: 0.42, w: 0.12 },
  flounder: { name: '比目魚', kg: [1.0, 2.5], mult: 0.45, strength: 0.6, color: 0x8a6a3c, h: 0.55, w: 0.06 },
  grouper: { name: '石斑', kg: [1.5, 4.0], mult: 0.50, strength: 0.9, color: 0x9a5a2e, h: 0.36, w: 0.17 },
  eel: { name: '海鰻', kg: [1.3, 3.2], mult: 0.45, strength: 0.8, color: 0x5c5a2a, h: 0.09, w: 0.07, lenK: 0.78 },
  mullet: { name: '烏魚', kg: [1.0, 2.6], mult: 0.35, strength: 0.7, color: 0x7d8790, h: 0.24, w: 0.14 },
  snapper: { name: '紅鯛', kg: [1.1, 2.8], mult: 0.55, strength: 0.8, color: 0xd2493a, h: 0.40, w: 0.13 },
  bonito: { name: '鰹魚', kg: [2.0, 5.0], mult: 0.38, strength: 1.0, color: 0x2a4f8f, h: 0.28, w: 0.17 },
  tuna: { name: '鮪魚', kg: [8, 25], mult: 0.18, strength: 1.2, color: 0x1c2f5e, h: 0.30, w: 0.20 },
  // 只在晚上出現的魚
  squid: { name: '小卷', kg: [0.1, 0.4], mult: 0.75, strength: 0.3, color: 0xd99a94, h: 0.26, w: 0.2 },
  hairtail: { name: '白帶魚', kg: [0.5, 1.8], mult: 0.62, strength: 0.7, color: 0xc4ccd6, h: 0.07, w: 0.03, lenK: 0.95 },
  swordfish: { name: '旗魚', kg: [15, 40], mult: 0.22, strength: 1.12, color: 0x27386e, h: 0.22, w: 0.15, lenK: 0.5 },
};

// 每座島附近的特產
export const SPECIALTY = { home: 'bream', west: 'flounder', twin: 'grouper', rocks: 'eel', sand: 'mullet', east: 'snapper' };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 依水深、最近的島、離岸多遠決定釣到什麼：岸邊是小魚，島的周圍有特產，離陸地越遠魚越大越貴
// off：離最近的陸地幾公尺。四個海域——淺灘、近海（一百多公尺內）、離岸（兩百多公尺）、外海、遠洋（四百公尺以上）；
// 海域的交界不是一刀切，前後幾十公尺兩邊的魚都釣得到
// 晚上多了夜裡才出來的魚：岸邊的小卷、島周圍的白帶魚、外海的旗魚
export function pickSpecies(depth, islandId, off, night = false) {
  const local = SPECIALTY[islandId] ?? 'mackerel';
  const d = off + (Math.random() - 0.5) * 70;
  const table = night
    ? (depth < 7 ? [['squid', 55], ['sardine', 30], [local, 15]]
      : d < 120 ? [['hairtail', 40], [local, 30], ['mackerel', 20], ['squid', 10]]
        : d < 250 ? [['hairtail', 35], ['mackerel', 30], ['bonito', 25], ['swordfish', 10]]
          : d < 400 ? [['bonito', 35], ['swordfish', 30], ['tuna', 20], ['hairtail', 15]]
            : [['swordfish', 45], ['tuna', 35], ['bonito', 20]])
    : depth < 7 ? [['sardine', 70], [local, 30]]
      : d < 120 ? [[local, 45], ['mackerel', 40], ['sardine', 15]]
        : d < 250 ? [['mackerel', 50], ['bonito', 35], [local, 15]]
          : d < 400 ? [['bonito', 45], ['tuna', 25], ['mackerel', 30]]
            : [['tuna', 50], ['bonito', 40], ['mackerel', 10]];
  let r = Math.random() * table.reduce((s, t) => s + t[1], 0);
  for (const [id, w] of table) { r -= w; if (r <= 0) return id; }
  return table[0][0];
}

export const typicalLength = (id, kg) => (SPECIES[id].lenK ?? 0.42) * Math.cbrt(kg);

// 擲出一條魚的重量與身長。大小是長尾分布：大多落在常見範圍的前段，越大越少，但沒有上限——
// 偶爾會冒出比常見範圍大好幾倍的個體。重量隨身長的立方變大，所以特別大的小魚也能很值錢。
// big：0–1，離岸越遠、浪越大的日子，魚的個頭越大；giant：0–1，遠洋的魚整體再大一些
export function rollFish(id, big = 0, giant = 0) {
  const [a, b] = SPECIES[id].kg;
  const tail = -Math.log(1 - Math.random() * 0.999999);   // 指數分布：一半的魚小於 0.69，百分之一大於 4.6，沒有上限
  const kg = +(a + (b - a) * (0.36 + 0.3 * big) * (1 + 0.6 * giant) * tail).toFixed(2);
  const len = +(typicalLength(id, kg) * (0.92 + Math.random() * 0.16)).toFixed(2);
  return { kg, len };
}

// 價值 ＝ 每公斤 100 元 × 魚種倍率 × 重量
export function fishValue(id, kg) {
  return Math.max(1, Math.round(KG_PRICE * SPECIES[id].mult * kg));
}

// 這個位置會釣到什麼。where：{ depth 水深, island 最近的島, off 離岸幾公尺, night 是不是晚上, rough 浪有多大（0–1） }
// 離岸越遠：魚種越好（鰹魚、鮪魚、旗魚）、個頭越大；浪大的日子，外海的魚個頭更大。
// 越值錢的魚越難釣：同一種魚個頭越大掙扎越兇，身價越高（二十塊以下不算、八百塊以上到頂）再往上加
export function rollCatch({ depth, island, off, night, rough }) {
  const far = clamp((off - 60) / 380, 0, 1);
  const id = pickSpecies(depth, island, off, night);
  const f = rollFish(id, clamp(0.7 * far + 0.5 * (off >= 120 ? rough : 0), 0, 1), clamp((off - 250) / 300, 0, 1)), [a, b] = SPECIES[id].kg;
  const value = fishValue(id, f.kg);
  const tough = clamp(Math.log(value / 20) / Math.log(40), 0, 1);
  return { id, ...f, value, strength: SPECIES[id].strength * (0.85 + 0.3 * clamp((f.kg - a) / (b - a), 0, 1.6)) * (0.8 + 0.55 * tough) };
}

// 這條魚最快幾秒拉得上來（收線小遊戲的進度從三成開始，一直對在區間裡的速度）；伺服器用來擋「太快釣起來」
export const minFightTime = (strength) => 0.7 / (0.2 / (0.7 + 0.5 * strength));
// 等魚咬的時間（秒）：釣竿越好越快，下雨時也比較快
export const biteDelay = (rodLv, rain) => (2.5 + Math.random() * 6.5) * Math.pow(0.82, rodLv) * (1 - 0.35 * clamp(rain / 0.5, 0, 1));
// 拋竿最遠拋多遠（公尺）
export const castRange = (rodLv) => 22 * (1 + 0.25 * rodLv);

// 畫面上顯示用：「鯖魚　38 公分　0.82 公斤」
export const fishLabel = (it) => `${(it.sp ?? SPECIES[it.id]).name}　${Math.round(it.len * 100)} 公分　${it.kg.toFixed(2)} 公斤`;
export const money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
