// 魚種資料與「釣到什麼、多大、值多少」的規則。這個檔案不碰畫面，伺服器和瀏覽器共用同一份：
// 多人模式下由伺服器擲魚（防作弊），瀏覽器只拿結果來顯示。
//
// 每一種魚（和雜物）自己帶著「在哪裡、什麼時候、什麼天氣釣得到」，要調分布只改這張表，不用動下面的邏輯：
//   kg：常見的重量範圍（大的可以超出，沒有上限）；mult：魚種倍率（每公斤 100 元 × 倍率）；
//   strength：上鉤後掙扎的力道；h / w：身高與厚度（相對於身長）；lenK：身長係數
//   rarity：'common' 普通 / 'uncommon' 少見 / 'rare' 稀有（沒寫 w 的出現點就用稀有度的預設權重）
//   kind：'junk' 是雜物（釣上來不是魚，不上排行榜）；model：雜物的模型名字（fish.js 畫）；notes：釣到時的一句話
//   where：在哪一類水域，預設 ['open']（一般海域）。可填：'open'、島的名字（'home' / 'haven'，在該島附近）、
//          礁石（'arch' / 'atoll' / 'beacon'，或 'reef' 代表任何一處礁石）、特別的釣場（'river' / 'cave'）
//   spots：出現的條件，每一項各有一個權重，符合的全部加起來：{ w 權重, where 覆蓋水域, depth 水深範圍(公尺), off 離岸範圍(公尺),
//          time 'day' 白天 / 'night' 夜裡 }；離岸距離前後有幾十公尺的亂數，交界不是一刀切
//   twilight：清晨與黃昏的加成倍數；nightK：夜裡的加成倍數
//   rain / before / after：下雨、風暴來之前、風暴過後的加成倍數；need：'after' 只有風暴過後才出現
export const KG_PRICE = 100;
export const RARITY = {
  common: { label: '普通', w: 40 },
  uncommon: { label: '少見', w: 18 },
  rare: { label: '稀有', w: 6 },
};
const INF = 9999;
export const SPECIES = {
  // ---- 沿岸的小魚與各島的魚 ----
  sardine: { name: '沙丁魚', kg: [0.15, 0.4], mult: 0.30, strength: 0.3, color: 0x4f7fb0, h: 0.22, w: 0.11, rarity: 'common',
    spots: [{ w: 70, depth: [0, 7], time: 'day' }, { w: 30, depth: [0, 7], time: 'night' }, { w: 15, depth: [7, INF], off: [0, 120], time: 'day' }] },
  mackerel: { name: '鯖魚', kg: [0.4, 1.2], mult: 0.30, strength: 0.5, color: 0x1f6f78, h: 0.22, w: 0.12, rarity: 'common',
    spots: [{ w: 40, depth: [7, INF], off: [0, 120] }, { w: 50, off: [120, 250] }, { w: 30, off: [250, 400] }, { w: 10, off: [400, INF] },
      { w: 25, where: ['reef'], time: 'day' }] },
  bream: { name: '黑鯛', kg: [0.6, 1.5], mult: 0.40, strength: 0.6, color: 0x4a4f58, h: 0.42, w: 0.12, rarity: 'common', where: ['home', 'haven'],
    spots: [{ w: 25, depth: [0, 7] }, { w: 40, depth: [7, INF], off: [0, 120] }, { w: 15, off: [120, 250] }] },
  flounder: { name: '比目魚', kg: [1.0, 2.5], mult: 0.45, strength: 0.6, color: 0x8a6a3c, h: 0.55, w: 0.06, rarity: 'uncommon', where: ['atoll'], spots: [{ w: 60 }] },
  grouper: { name: '石斑', kg: [1.5, 4.0], mult: 0.50, strength: 0.9, color: 0x9a5a2e, h: 0.36, w: 0.17, rarity: 'uncommon', where: ['arch'], spots: [{ w: 60 }] },
  eel: { name: '海鰻', kg: [1.3, 3.2], mult: 0.45, strength: 0.8, color: 0x5c5a2a, h: 0.09, w: 0.07, lenK: 0.78, rarity: 'uncommon', where: ['atoll', 'beacon'], rain: 2, spots: [{ w: 60 }] },
  mullet: { name: '烏魚', kg: [1.0, 2.6], mult: 0.35, strength: 0.7, color: 0x7d8790, h: 0.24, w: 0.14, rarity: 'common',
    spots: [{ w: 25, where: ['haven'], depth: [0, 7] }, { w: 40, where: ['haven'], depth: [7, INF], off: [0, 120] }, { w: 15, where: ['haven'], off: [120, 250] }, { w: 60, where: ['atoll'] }] },
  snapper: { name: '紅鯛', kg: [1.1, 2.8], mult: 0.55, strength: 0.8, color: 0xd2493a, h: 0.40, w: 0.13, rarity: 'uncommon', where: ['arch', 'beacon'], spots: [{ w: 60 }] },
  puffer: { name: '河豚', kg: [0.3, 0.9], mult: 0.9, strength: 0.4, color: 0xc9b27a, h: 0.62, w: 0.55, lenK: 0.3, rarity: 'uncommon', where: ['home'], spots: [{ depth: [0, 10] }] },
  stonebream: { name: '石鯛', kg: [1.0, 2.6], mult: 0.85, strength: 0.8, color: 0x3a3f4a, h: 0.45, w: 0.14, rarity: 'uncommon', where: ['home'], spots: [{ depth: [7, INF], off: [0, 150] }] },
  octopus: { name: '章魚', kg: [0.6, 2.2], mult: 0.7, strength: 0.6, color: 0xb5654a, h: 0.5, w: 0.5, lenK: 0.45, model: 'octopus', rarity: 'uncommon', where: ['home', 'haven'], spots: [{ depth: [0, 12], time: 'night' }] },
  pomfret: { name: '白鯧', kg: [0.6, 1.6], mult: 0.6, strength: 0.5, color: 0xb9c4cc, h: 0.62, w: 0.08, rarity: 'common', where: ['haven'], spots: [{ w: 35, depth: [7, INF], off: [0, 160] }] },
  seabass: { name: '鱸魚', kg: [1.2, 3.5], mult: 0.5, strength: 0.75, color: 0x8a98a0, h: 0.27, w: 0.14, rarity: 'common', where: ['haven'], rain: 2.5, spots: [{ w: 35, off: [0, 120] }] },
  amberjack: { name: '紅甘', kg: [3, 8], mult: 0.42, strength: 1.0, color: 0x6b8a7a, h: 0.26, w: 0.16, rarity: 'uncommon', where: ['haven'], spots: [{ off: [80, 300] }] },
  // ---- 海上的礁石 ----
  grouperGiant: { name: '龍膽石斑', kg: [8, 25], mult: 0.55, strength: 1.2, color: 0x7a4b36, h: 0.38, w: 0.22, rarity: 'rare', where: ['arch'], spots: [{}] },
  mahi: { name: '鬼頭刀', kg: [4, 12], mult: 0.5, strength: 1.05, color: 0x62c4a0, h: 0.36, w: 0.12, lenK: 0.5, rarity: 'uncommon', before: 3,
    spots: [{ where: ['arch'] }, { off: [250, 500] }] },
  clown: { name: '小丑魚', kg: [0.05, 0.15], mult: 1.0, strength: 0.25, color: 0xf28a1e, h: 0.4, w: 0.16, lenK: 0.22, rarity: 'common', where: ['atoll'], spots: [{ w: 40 }] },
  wreckEel: { name: '沉船巨鰻', kg: [12, 30], mult: 0.6, strength: 1.25, color: 0x4a4a3a, h: 0.08, w: 0.08, lenK: 0.8, rarity: 'rare', where: ['atoll'], nightK: 2.5, spots: [{}] },
  lanternfish: { name: '燈籠魚', kg: [0.2, 0.6], mult: 1.6, strength: 0.4, color: 0x3a5f8a, h: 0.3, w: 0.13, lenK: 0.3, rarity: 'uncommon',
    spots: [{ where: ['beacon'], time: 'night' }, { w: 10, depth: [30, INF], off: [250, INF], time: 'night' }] },
  glowsquid: { name: '夜光魷', kg: [0.8, 2.5], mult: 1.2, strength: 0.5, color: 0xa8f0ff, h: 0.26, w: 0.2, rarity: 'rare', where: ['beacon'], spots: [{ time: 'night' }] },
  // ---- 離岸與外海 ----
  bonito: { name: '鰹魚', kg: [2.0, 5.0], mult: 0.38, strength: 1.0, color: 0x2a4f8f, h: 0.28, w: 0.17, rarity: 'common',
    spots: [{ w: 35, off: [120, 250], time: 'day' }, { w: 45, off: [250, 400], time: 'day' }, { w: 40, off: [400, INF], time: 'day' },
      { w: 25, off: [120, 250], time: 'night' }, { w: 35, off: [250, 400], time: 'night' }, { w: 20, off: [400, INF], time: 'night' }, { w: 15, where: ['reef'], time: 'day' }] },
  tuna: { name: '鮪魚', kg: [8, 25], mult: 0.18, strength: 1.2, color: 0x1c2f5e, h: 0.30, w: 0.20, rarity: 'common',
    spots: [{ w: 25, off: [250, 400], time: 'day' }, { w: 50, off: [400, INF], time: 'day' }, { w: 20, off: [250, 400], time: 'night' }, { w: 35, off: [400, INF], time: 'night' }] },
  flyingfish: { name: '飛魚', kg: [0.2, 0.5], mult: 0.6, strength: 0.35, color: 0x5aa0c8, h: 0.2, w: 0.1, lenK: 0.5, rarity: 'common', twilight: 3, spots: [{ w: 25, off: [100, 350], time: 'day' }] },
  saury: { name: '秋刀魚', kg: [0.1, 0.25], mult: 0.9, strength: 0.3, color: 0x6a8fa8, h: 0.12, w: 0.07, lenK: 0.8, rarity: 'common', twilight: 3, spots: [{ w: 25, off: [100, 300] }] },
  spanish: { name: '土魠', kg: [3, 9], mult: 0.4, strength: 0.95, color: 0x7e8e98, h: 0.22, w: 0.13, lenK: 0.55, rarity: 'uncommon', twilight: 2, spots: [{ off: [120, 350] }] },
  yellowfin: { name: '黃鰭鮪', kg: [15, 45], mult: 0.22, strength: 1.2, color: 0x2d5aa0, h: 0.3, w: 0.2, rarity: 'uncommon', spots: [{ off: [350, INF], depth: [20, INF] }] },
  sunfish: { name: '翻車魚', kg: [30, 90], mult: 0.12, strength: 0.8, color: 0x9aa7ad, h: 0.9, w: 0.12, lenK: 0.45, rarity: 'rare', spots: [{ w: 4, off: [400, INF], time: 'day' }] },
  shark: { name: '鯊魚', kg: [40, 120], mult: 0.1, strength: 1.3, color: 0x6f7c88, h: 0.2, w: 0.18, lenK: 0.55, fin: 2.2, rarity: 'rare', before: 4, after: 2, spots: [{ w: 3, off: [250, INF] }] },
  oarfish: { name: '皇帶魚', kg: [10, 40], mult: 0.35, strength: 0.9, color: 0xd6dee6, h: 0.06, w: 0.04, lenK: 1.1, rarity: 'rare', need: 'after', spots: [{ off: [200, INF] }] },
  // ---- 只在晚上出現的魚 ----
  squid: { name: '小卷', kg: [0.1, 0.4], mult: 0.75, strength: 0.3, color: 0xd99a94, h: 0.26, w: 0.2, rarity: 'common',
    spots: [{ w: 55, depth: [0, 7], time: 'night' }, { w: 10, depth: [7, INF], off: [0, 120], time: 'night' }, { w: 25, where: ['reef'], time: 'night' }, { w: 25, where: ['cave'] }] },
  hairtail: { name: '白帶魚', kg: [0.5, 1.8], mult: 0.62, strength: 0.7, color: 0xc4ccd6, h: 0.07, w: 0.03, lenK: 0.95, rarity: 'common',
    spots: [{ w: 40, depth: [7, INF], off: [0, 120], time: 'night' }, { w: 35, off: [120, 250], time: 'night' }, { w: 15, off: [250, 400], time: 'night' }, { w: 30, where: ['reef'], time: 'night' }] },
  swordfish: { name: '旗魚', kg: [15, 40], mult: 0.22, strength: 1.12, color: 0x27386e, h: 0.22, w: 0.15, lenK: 0.5, rarity: 'rare',
    spots: [{ w: 10, off: [120, 250], time: 'night' }, { w: 30, off: [250, 400], time: 'night' }, { w: 45, off: [400, INF], time: 'night' }] },
  // ---- 秘境：透天洞穴深潭（月光魚下雨天特別容易上鉤）、高山小河（黃金鱒個頭小，但一公斤的價錢是別的魚好幾倍）----
  moonfish: { name: '藍洞月光魚', kg: [0.8, 2.2], mult: 1.6, strength: 0.75, color: 0x7fdcff, h: 0.36, w: 0.1, rarity: 'rare', where: ['cave'], rain: 2.3, spots: [{ w: 35 }] },
  glassfish: { name: '琉璃鯛', kg: [0.5, 1.5], mult: 2.5, strength: 0.6, color: 0x4a6bff, h: 0.38, w: 0.1, rarity: 'rare', where: ['cave'], spots: [{ w: 9 }] },
  trout: { name: '黃金鱒', kg: [0.2, 0.7], mult: 3.2, strength: 0.55, color: 0xe6b422, h: 0.26, w: 0.12, rarity: 'uncommon', where: ['river'], spots: [{ w: 30 }] },
  ayu: { name: '香魚', kg: [0.1, 0.3], mult: 1.2, strength: 0.35, color: 0xa8b04a, h: 0.2, w: 0.1, rarity: 'common', where: ['river'], spots: [{ w: 70 }] },

  // ---- 雜物：不是魚。賣得到錢，但很少；不算排行榜 ----
  slipper: { name: '拖鞋', kind: 'junk', model: 'slipper', kg: [0.2, 0.5], mult: 0.05, strength: 0.15, color: 0x3a8fd0, h: 0.2, w: 0.2, rarity: 'common', notes: ['只有一隻。另一隻呢？', '還是濕的，主人大概走得很不甘心。'],
    spots: [{ w: 40, depth: [0, 15], off: [0, 150] }] },
  tin: { name: '空罐', kind: 'junk', model: 'tin', kg: [0.1, 0.3], mult: 0.05, strength: 0.1, color: 0xb9bec4, h: 0.5, w: 0.5, rarity: 'common', notes: ['裡面連一條魚都沒有。'],
    spots: [{ w: 40, off: [0, 150] }] },
  bottle: { name: '寶特瓶', kind: 'junk', model: 'bottle', kg: [0.1, 0.3], mult: 0.05, strength: 0.1, color: 0xbfe6f2, h: 0.3, w: 0.3, rarity: 'common', notes: ['請把垃圾帶回家。'],
    spots: [{ w: 40, off: [0, 250] }] },
  net: { name: '破漁網', kind: 'junk', model: 'net', kg: [0.5, 2], mult: 0.05, strength: 0.4, color: 0x6a8a5a, h: 0.12, w: 0.12, rarity: 'common', notes: ['整團纏在一起，解開的時間比釣魚還久。'],
    spots: [{ w: 40, where: ['reef'] }, { w: 15, off: [0, 150] }] },
  tire: { name: '舊輪胎', kind: 'junk', model: 'tire', kg: [5, 12], mult: 0.06, strength: 0.5, color: 0x2a2b2e, h: 0.4, w: 0.3, rarity: 'uncommon', notes: ['好重！以為是大魚。'],
    spots: [{ depth: [0, 15], off: [0, 100] }] },
  key: { name: '生鏽鑰匙', kind: 'junk', model: 'key', kg: [0.1, 0.2], mult: 0.5, strength: 0.15, color: 0x8a5a2e, h: 0.15, w: 0.1, rarity: 'uncommon', notes: ['不知道是哪扇門的鑰匙。'],
    spots: [{ w: 30, where: ['atoll'] }, { w: 5, off: [0, 100] }] },
  msgbottle: { name: '漂流瓶', kind: 'junk', model: 'msgbottle', kg: [0.3, 0.6], mult: 0.1, strength: 0.15, color: 0x7ec8a0, h: 0.35, w: 0.35, rarity: 'uncommon', after: 4,
    notes: ['瓶子裡有張紙：「如果你看到這張紙，今天一定會釣到大魚。」', '瓶子裡有張紙：「救命，我被困在公司。」', '瓶子裡有張紙：「這片海的魚，其實比較想釣你。」', '瓶子裡有張紙：「往西北走，不要回頭。」', '瓶子裡有張紙：「第 3 天，我還是沒釣到魚。」'],
    spots: [{ w: 15 }] },
  duck: { name: '橡皮鴨', kind: 'junk', model: 'duck', kg: [0.1, 0.3], mult: 0.4, strength: 0.1, color: 0xffd83a, h: 0.7, w: 0.7, rarity: 'uncommon', notes: ['呱。它漂了很遠才來到這裡。'],
    spots: [{ w: 15 }] },
  seafloat: { name: '玻璃浮球', kind: 'junk', model: 'float', kg: [1, 2.5], mult: 0.8, strength: 0.3, color: 0x7bd8c0, h: 0.8, w: 0.8, rarity: 'rare', after: 3, notes: ['老漁具的浮球，在陽光下很漂亮。'],
    spots: [{ w: 8, off: [150, INF] }] },
  coins: { name: '海盜金幣袋', kind: 'junk', model: 'coins', kg: [1, 3], mult: 1.2, strength: 0.4, color: 0xd9a82a, h: 0.7, w: 0.7, rarity: 'rare', notes: ['沉甸甸的，裡面叮噹作響！'],
    spots: [{ w: 25, where: ['atoll'] }, { w: 2, off: [0, 400] }] },
};

export const rarityOf = (id) => RARITY[SPECIES[id]?.rarity ?? 'common'];
export const isJunk = (id) => SPECIES[id]?.kind === 'junk';

// 各個地方的特產（有 where 的魚，依水域整理，給資料頁與說明用；實際擲魚看 spots）
export const SPECIALTY = {};
for (const [id, sp] of Object.entries(SPECIES)) {
  if (sp.kind === 'junk') continue;
  for (const w of new Set([...(sp.where ?? []), ...(sp.spots ?? []).flatMap((s) => s.where ?? [])])) (SPECIALTY[w] ??= []).push(id);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const REEF_ZONES = { arch: 1, atoll: 1, beacon: 1 };
const inRange = (v, r) => !r || (v >= r[0] && v <= r[1]);

// 清晨（5:30–8:30）與黃昏（16:30–18:30）：有些魚成群出來
export const isTwilight = (hour) => (hour >= 5.5 && hour < 8.5) || (hour >= 16.5 && hour < 18.5);

// 這個出現點在現在的條件下算不算數；算的話回傳權重，不算回 0。d：離岸距離加上一點亂數
function spotWeight(sp, spot, c, d) {
  const where = spot.where ?? sp.where ?? ['open'], zone = c.zone;
  const here = zone === 'river' || zone === 'cave' ? where.includes(zone)
    : REEF_ZONES[zone] ? where.includes(zone) || where.includes('reef')
      : where.includes('open') || where.includes(c.island);
  if (!here || !inRange(c.depth, spot.depth) || !inRange(d, spot.off)) return 0;
  if (spot.time === 'night' && !c.night) return 0;
  if (spot.time === 'day' && c.night) return 0;
  if (sp.need === 'after' && c.storm !== 'after') return 0;
  let w = spot.w ?? RARITY[sp.rarity ?? 'common'].w;
  if (c.night && sp.nightK) w *= sp.nightK;
  if (isTwilight(c.hour) && sp.twilight) w *= sp.twilight;
  if (sp.rain) w *= 1 + (sp.rain - 1) * clamp(c.rain / 0.4, 0, 1);
  if (c.storm === 'before' && sp.before) w *= sp.before;
  if (c.storm === 'after' && sp.after) w *= sp.after;
  return w;
}

// 在 junk 或魚的那一堆裡，照權重抽一種
function pickFrom(c, junk) {
  const d = c.off + (Math.random() - 0.5) * 70;
  const table = [];
  for (const [id, sp] of Object.entries(SPECIES)) {
    if ((sp.kind === 'junk') !== junk) continue;
    const w = sp.spots.reduce((s, spot) => s + spotWeight(sp, spot, c, d), 0);
    if (w > 0) table.push([id, w]);
  }
  if (!table.length) return null;
  let r = Math.random() * table.reduce((s, t) => s + t[1], 0);
  for (const [id, w] of table) { r -= w; if (r <= 0) return id; }
  return table[table.length - 1][0];
}

// 釣到雜物的機率：港口附近的淺水垃圾多，風暴過後漂來更多；小河、洞穴的深潭裡沒有
export const JUNK = { p: 0.07, near: 1.6, nearOff: 100, after: 3 };
function junkChance(c) {
  if (c.zone === 'river' || c.zone === 'cave') return 0;
  return JUNK.p * (c.off < JUNK.nearOff ? JUNK.near : 1) * (c.storm === 'after' ? JUNK.after : 1);
}

// 依水深、最近的島、離岸多遠、時間與天氣決定釣到什麼：岸邊是小魚，島的周圍有特產，離陸地越遠魚越大越貴
// off：離最近的陸地幾公尺；zone：特別的釣場（'river'、'cave'、'arch'、'atoll'、'beacon'）；
// hour：現在幾點；storm：'before' 風暴快來了、'after' 風暴剛過、其餘 null
export function pickSpecies(depth, island, off, night = false, zone = null, rain = 0, hour = night ? 23 : 12, storm = null) {
  const c = { depth, island, off, night, zone, rain, hour, storm };
  if (Math.random() < junkChance(c)) { const j = pickFrom(c, true); if (j) return j; }
  return pickFrom(c, false) ?? 'mackerel';
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

// 這個位置會釣到什麼。where：{ depth 水深, island 最近的島, off 離岸幾公尺, night 是不是晚上, hour 幾點, storm 風暴前後, rough 浪有多大（0–1）, zone 特別的釣場, rain 雨勢, hot 是不是在魚群熱點裡 }
// 離岸越遠：魚種越好（鰹魚、鮪魚、旗魚）、個頭越大；浪大的日子，外海的魚個頭更大。
// 越值錢的魚越難釣：同一種魚個頭越大掙扎越兇，身價越高（二十塊以下不算、八百塊以上到頂）再往上加
export function rollCatch({ depth, island, off, night, rough, zone = null, rain = 0, hot = false, hour, storm = null }) {
  const far = clamp((off - 60) / 380, 0, 1), special = zone === 'river' || zone === 'cave';
  const id = pickSpecies(depth, island, off, night, zone, rain, hour ?? (night ? 23 : 12), storm);
  // 雜物不看離岸距離變大；魚群熱點裡的魚個頭大一截；小河和洞穴的魚不照離岸距離變大
  const flat = special || isJunk(id);
  const f = rollFish(id, flat ? 0 : clamp(0.7 * far + 0.5 * (off >= 120 ? rough : 0) + (hot ? 0.45 : 0), 0, 1), flat ? 0 : clamp((off - 250) / 300, 0, 1)), [a, b] = SPECIES[id].kg;
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
