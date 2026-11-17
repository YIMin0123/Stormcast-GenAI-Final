// 三種船的規格。這個檔案不碰畫面，伺服器和瀏覽器共用同一份（船的模型與浮力在 boat.js）。
// len / beam / draft：長、寬、吃水；deck：甲板離水線的高度；bul：舷牆高；rise：船首翹起的高度
// speed：極速（公尺/秒）；turnRate：轉向靈活度；tiltK：隨浪搖晃的程度；hurtMul：浪打壞船的程度；waveSlow：大浪讓船慢下來的程度（0 = 不受影響）
// costK：引擎升級的價錢倍率；cabin：駕駛艙範圍（沒有就是敞船）；helmX：掌舵時站的位置；box：內建魚艙的位置與大小
// hp：耐久度；tank：油箱容量（公升）；burn：油門全開每秒吃多少油；fuelX：加油的位置（引擎旁）
// maxCans / maxChums：甲板上放得下幾個油桶、誘魚桶；freshBonus：急凍魚艙讓賣價多幾成（同隊共享）
// sonarRange：聲納掃多遠（公尺，0 = 裝不了）；lampMul：船首集魚燈讓夜裡趨光魚多幾倍；mass：噸位（船撞船時誰讓誰、拖船快慢）
// joltMul：船身猛晃時甲板上的東西被拋起來的程度（大漁船穩，只有一半）
export const BOAT_TYPES = {
  skiff: {
    id: 'skiff', name: '小舢舨', price: 0, len: 6, beam: 2.2, draft: 0.45, deck: 0.32, bul: 0.33, rise: 0.4,
    speed: 4.4, turnRate: 1.35, tiltK: 1.15, hurtMul: 1.0, waveSlow: 1.0, costK: 0.4,
    paint: [0.86, 0.80, 0.62], cabin: null, helmX: -1.9, helmR: 0.8,
    hp: 60, tank: 20, burn: 0.04, fuelX: -2.6,
    maxCans: 2, maxChums: 2, freshBonus: 0, sonarRange: 0, lampMul: 1.0, mass: 1.0,
    box: { x: 0.9, z: 0, w: 0.7, d: 0.9, h: 0.4 },
  },
  fisher: {
    id: 'fisher', name: '近海漁船', price: 2500, len: 13, beam: 4.6, draft: 1.0, deck: 0.85, bul: 0.35, rise: 1.1,
    speed: 7.8, turnRate: 1.15, tiltK: 0.90, hurtMul: 0.85, waveSlow: 0.7, costK: 1,
    paint: [0.08, 0.42, 0.44], cabin: { x0: -4.2, x1: -0.8, hw: 1.3, top: 2.3 }, helmX: -2.5, helmR: 1.1,
    hatch: { x: 2.0, s: 1.8 }, barrel: { x: 3.4, z: 0.9 },
    box: { x: 0.5, z: 0, w: 1.05, d: 1.45, h: 0.58 },   // 內建活魚艙
    hp: 130, tank: 65, burn: 0.09, fuelX: -5.45,
    maxCans: 4, maxChums: 4, freshBonus: 0, sonarRange: 160, lampMul: 1.8, mass: 3.5,
  },
  trawler: {
    id: 'trawler', name: '遠洋大漁船', price: 9500, len: 18, beam: 6.2, draft: 1.3, deck: 1.05, bul: 0.45, rise: 1.4,
    speed: 8.65, turnRate: 0.92, tiltK: 0.45, hurtMul: 0.65, waveSlow: 0.0, costK: 1.8,
    paint: [0.55, 0.16, 0.12], cabin: { x0: -6.2, x1: -1.8, hw: 1.9, top: 2.5 }, helmX: -3.5, helmR: 1.1,
    hatch: { x: 2.8, s: 2.5 }, barrel: { x: 5.2, z: 1.4 },
    box: { x: -0.5, z: 0, w: 1.45, d: 2.25, h: 0.72 },  // 雙槽急凍魚艙
    hp: 240, tank: 140, burn: 0.15, fuelX: -7.45,
    maxCans: 6, maxChums: 6, freshBonus: 0.10, sonarRange: 240, lampMul: 2.2, mass: 9.0, joltMul: 0.5,
  },
};
import { BAITS, BAIT_MAX } from './fishdata.js';
import { FISHBOX } from './config.js';
export const BOAT_ORDER = ['skiff', 'fisher', 'trawler'];
export const MAX_LEVEL = 5;

// ---- 商店的價錢（伺服器照這份扣錢，瀏覽器照這份顯示） ----
export const PRICE = {
  rod:    [150, 450, 1200, 2800, 6500],
  engine: [250, 600, 1400, 3000, 6500],
  fuel:   80,
  chum:   600,
};   // 魚箱的價錢在 config.js 的 FISHBOX
export const REPAIR = [40, 100, 220, 450, 800, 1400];   // 修釣竿的價錢（依釣竿等級）
export const CAN = 20;                        // 一桶油幾公升
export const CHUM_SPEC = { price: 600, max: 6, life: 180, radius: 18, quota: 10 };   // max：最多帶幾桶（還要看船放得下幾桶：BOAT_TYPES 的 maxChums）

// 船壞了：每個破洞讓極速少 each（最慢剩 floor，還開得回修船屋）；海上修不了，要開到修船屋或大港船塢的修船台付錢修
// perHp：每一點耐久多少錢；perCrack：每個破洞再加多少；min：最少收多少；reach：人離修船台多近；range：船停在修船台多遠以內
export const CRACK_SLOW = { each: 0.08, floor: 0.5 };
export const BOAT_REPAIR = { perHp: 2.5, perCrack: 30, min: 50, reach: 3.2, range: 35 };
// 修一艘船要多少錢（type 船種、hp01 剩幾成耐久、cracks 幾個破洞）；完好回傳 0
export function repairCost(type, hp01, cracks) {
  const S = BOAT_TYPES[type], lost = S.hp * (1 - Math.min(1, Math.max(0, hp01)));
  if (lost < 0.5 && !cracks) return 0;
  return Math.max(BOAT_REPAIR.min, Math.round(lost * BOAT_REPAIR.perHp + cracks * BOAT_REPAIR.perCrack));
}

// 改裝（裝一次，名下的漁船、大漁船都有；小舢舨裝不了）
export const BOAT_MODS = {
  sonar: { id: 'sonar', name: '探魚聲納',   price: 2800, desc: '方向盤旁加裝聲納螢幕，顯示魚群與水深（漁船／大漁船專用）', reqBoats: ['fisher', 'trawler'] },
  lamp:  { id: 'lamp',  name: '船首集魚燈', price: 2200, desc: '船頭加裝可開關的集魚燈，夜裡趨光魚多 1.8～2.2 倍（漁船／大漁船專用）', reqBoats: ['fisher', 'trawler'] },
};

export const BOAT_PAINTS = [
  { id: 'default',  name: '原廠塗裝', price: 0,     rgb: null },
  { id: 'crimson',  name: '深海緋紅', price: 2000,  rgb: [0.78, 0.16, 0.18] },
  { id: 'navy',     name: '風暴靛藍', price: 3500,  rgb: [0.14, 0.28, 0.62] },
  { id: 'emerald',  name: '翡翠海獵', price: 5000,  rgb: [0.12, 0.55, 0.38] },
  { id: 'obsidian', name: '黑曜幽靈', price: 7500,  rgb: [0.16, 0.17, 0.20] },
  { id: 'gold',     name: '黃金船長', price: 10000, rgb: [0.88, 0.68, 0.16] },
];

export const BLESSINGS = {
  tide:  { id: 'tide',  name: '黃金魚潮',   price: 4000, delay: 180, duration: 600, desc: '倒數 3 分鐘後降臨，全服 10 分鐘內稀有與少見魚種出現率 ×2，並喚出不限尾數的黃金魚群' },
  storm: { id: 'storm', name: '風暴海神祭', price: 4000, delay: 180, desc: '倒數 3 分鐘後，於平靜海況召喚巨浪風暴（高倍率與深海魚出沒）' },
};

// ---- 漁會捐款與稱號（每週一重置，連稱號一起清掉；規則與重置時間見 config.js 的 GUILD、伺服器 dex.js） ----
// 基本稱號：自己這一週捐滿 minDonate 就有，可以自己挑一個戴
export const DONATION_MILESTONES = [
  { id: 'dock_angler', name: '碼頭釣客', minDonate: 5000,  gold: false, desc: '當週累積捐款滿 $5,000 解鎖' },
  { id: 'sea_angler',  name: '海釣熟手', minDonate: 15000, gold: false, desc: '當週累積捐款滿 $15,000 解鎖' },
  { id: 'veteran',     name: '老討海人', minDonate: 30000, gold: false, desc: '當週累積捐款滿 $30,000 解鎖' },
  { id: 'captain',     name: '資深船長', minDonate: 50000, gold: false, desc: '當週累積捐款滿 $50,000 解鎖' },
];
// 特殊稱號：這一週捐款榜的前三名（還要捐滿 minDonate），被超過就換人
export const SPECIAL_TITLES = [
  { rank: 1, id: 'chairman', name: '👑 漁會會長',   minDonate: 30000, gold: true, desc: '當週捐款榜第 1 名專屬（需滿 $30,000）' },
  { rank: 2, id: 'director', name: '🎣 漁會總幹事', minDonate: 20000, gold: true, desc: '當週捐款榜第 2 名專屬（需滿 $20,000）' },
  { rank: 3, id: 'council',  name: '⚓ 漁會理事',   minDonate: 10000, gold: true, desc: '當週捐款榜第 3 名專屬（需滿 $10,000）' },
];
export const HONOR_TITLES = [...DONATION_MILESTONES, ...SPECIAL_TITLES];   // 全部的稱號（名字的白名單、顯示用）
// 這一週捐了 amount、排第 rank 名（1 起算，0 = 沒上榜）的人，有哪些稱號可以戴（名字）
export function titlesFor(amount, rank) {
  const out = DONATION_MILESTONES.filter((m) => amount >= m.minDonate).map((m) => m.name);
  for (const s of SPECIAL_TITLES) if (rank === s.rank && amount >= s.minDonate) out.push(s.name);
  return out;
}

// 玩家的家當（伺服器保管）：{ money, rodLv, rodBroken, chum, mods, paints, paint, boats: { 船種: { engineLv } }, active,
//   baits: { 餌種: 剩幾個 }, bait: 現在掛的餌種（'' 是基本餌） }
export const newKit = () => ({
  money: 0, rodLv: 0, rodBroken: false, chum: 0,
  mods: Object.fromEntries(Object.keys(BOAT_MODS).map((k) => [k, false])),
  paints: ['default'], paint: 'default',
  boats: { skiff: { engineLv: 0 } }, active: 'skiff',
  baits: Object.fromEntries(Object.keys(BAITS).map((k) => [k, 0])), bait: '',
});
export const baitCount = (kit, id) => (kit.baits && kit.baits[id]) || 0;

// 商品架上的一樣東西現在賣多少、買了會怎樣。回傳 { price, apply(kit) }；price 為 null 表示沒得買（why：原因）
// 引擎是裝在「現在放在世界裡的那艘船」上（每艘船各升各的）；魚箱、油桶、誘魚桶是拿在手上的道具（伺服器另外處理）
// 修船（repair）、漁會捐款箱（title）不是買東西，另外的訊息處理（見 server/room.js 的 repairBoat、donate）
export function shopItem(id, kit) {
  const cur = kit.boats[kit.active], S = BOAT_TYPES[kit.active];
  if (id === 'fuel') return { price: PRICE.fuel, apply() {} };
  if (id.startsWith('bait_') && BAITS[id.slice(5)]) {   // 餌：一次買一份，每種最多囤 BAIT_MAX 個
    const t = id.slice(5), B = BAITS[t];
    if (baitCount(kit, t) + B.pack > BAIT_MAX) return { price: null, why: 'full' };
    return { price: B.price, apply(k) { k.baits = { ...k.baits }; k.baits[t] = baitCount(k, t) + B.pack; if (!k.bait) k.bait = t; } };
  }
  if (id === 'chum') {
    if ((kit.chum || 0) >= Math.min(CHUM_SPEC.max, S.maxChums)) return { price: null, why: 'full', max: Math.min(CHUM_SPEC.max, S.maxChums) };   // 帶得了幾桶看現在這艘船
    return { price: PRICE.chum, apply(k) { k.chum = (k.chum || 0) + 1; } };
  }
  if (id.startsWith('mod_') && BOAT_MODS[id.slice(4)]) {
    const m = id.slice(4), M = BOAT_MODS[m];
    if (kit.mods?.[m]) return { price: null, why: 'have' };
    if (!M.reqBoats.some((t) => kit.boats[t])) return { price: null, why: 'boat', mod: M };   // 只有小舢舨：裝不了
    return { price: M.price, mod: M, apply(k) { k.mods = { ...k.mods, [m]: true }; } };
  }
  if (id === 'paint' || id.startsWith('paint:')) {
    const owned = new Set(kit.paints || ['default']);
    const P = id === 'paint' ? BOAT_PAINTS.find((p) => p.price > 0 && !owned.has(p.id)) : BOAT_PAINTS.find((p) => p.id === id.slice(6));
    if (!P) return { price: null, why: 'have' };
    if (owned.has(P.id)) return { price: 0, paint: P, swap: true, apply(k) { k.paint = P.id; } };
    return { price: P.price, paint: P, apply(k) { k.paints = [...new Set([...(k.paints || ['default']), P.id])]; k.paint = P.id; } };
  }
  if (id === 'bless_tide') return { price: BLESSINGS.tide.price, bless: BLESSINGS.tide, apply() {} };
  if (id === 'bless_storm') return { price: BLESSINGS.storm.price, bless: BLESSINGS.storm, apply() {} };
  if (id === 'rod') {
    // 釣竿斷了：先修。錢不夠也修得起，身上有多少算多少（不然釣竿斷了又沒錢，就再也賺不到錢了）
    if (kit.rodBroken) return { price: Math.min(REPAIR[kit.rodLv] ?? REPAIR[REPAIR.length - 1], kit.money), repair: true, cheap: kit.money < (REPAIR[kit.rodLv] ?? REPAIR[REPAIR.length - 1]), apply(k) { k.rodBroken = false; } };
    if (kit.rodLv >= MAX_LEVEL) return { price: null, why: 'max' };
    return { price: PRICE.rod[kit.rodLv], apply(k) { k.rodLv++; } };
  }
  if (id === 'engine') {
    if (!cur || cur.engineLv >= MAX_LEVEL) return { price: null, why: 'max' };
    return { price: Math.round(PRICE.engine[cur.engineLv] * S.costK / 10) * 10, apply(k) { k.boats[k.active].engineLv++; } };
  }
  if (id === 'box') return { price: FISHBOX.price, apply() {} };
  if (BOAT_TYPES[id] && id !== 'skiff') {
    if (kit.boats[id]) return { price: null, why: 'have' };
    return { price: BOAT_TYPES[id].price, boat: id, apply(k) { k.boats[id] = { engineLv: 0 }; } };
  }
  return { price: null, why: 'none' };
}
