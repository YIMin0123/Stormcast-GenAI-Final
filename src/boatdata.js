// 三種船的規格。這個檔案不碰畫面，伺服器和瀏覽器共用同一份（船的模型與浮力在 boat.js）。
// len / beam / draft：長、寬、吃水；deck：甲板離水線的高度；bul：舷牆高；rise：船首翹起的高度
// speed：極速（公尺/秒）；tiltK：隨浪搖晃的程度；costK：引擎升級的價錢倍率
// cabin：駕駛艙範圍（沒有就是敞船）；helmX：掌舵時站的位置；box：魚箱的位置與大小
// hp：耐久度；tank：油箱容量（公升）；burn：油門全開每秒吃多少油；fuelX：加油的位置（引擎旁）
export const BOAT_TYPES = {
  skiff: {
    id: 'skiff', name: '小舢舨', price: 0, len: 6, beam: 2.2, draft: 0.45, deck: 0.32, bul: 0.33, rise: 0.4,
    speed: 4.4, tiltK: 1.15, costK: 0.4, paint: [0.86, 0.80, 0.62], cabin: null, helmX: -1.9, helmR: 0.8,
    hp: 60, tank: 20, burn: 0.04, fuelX: -2.6,
    box: { x: 0.9, z: 0, w: 0.7, d: 0.9, h: 0.4 },
  },
  fisher: {
    id: 'fisher', name: '漁船', price: 1800, len: 13, beam: 4.6, draft: 1.0, deck: 0.85, bul: 0.35, rise: 1.1,
    speed: 7, tiltK: 1, costK: 1, paint: [0.08, 0.42, 0.44], cabin: { x0: -4.2, x1: -0.8, hw: 1.3, top: 2.3 }, helmX: -2.5, helmR: 1.1,
    hatch: { x: 2.0, s: 1.8 }, barrel: { x: 3.4, z: 0.9 }, box: { x: 0.5, z: 0, w: 0.9, d: 1.3, h: 0.55 },
    hp: 120, tank: 60, burn: 0.09, fuelX: -5.45,
  },
  trawler: {
    id: 'trawler', name: '大漁船', price: 7500, len: 18, beam: 6.2, draft: 1.3, deck: 1.05, bul: 0.45, rise: 1.4,
    speed: 8.6, tiltK: 0.75, costK: 1.8, paint: [0.55, 0.16, 0.12], cabin: { x0: -6.2, x1: -1.8, hw: 1.9, top: 2.4 }, helmX: -3.5, helmR: 1.1,
    hatch: { x: 2.8, s: 2.4 }, barrel: { x: 5.2, z: 1.4 }, box: { x: -0.5, z: 0, w: 1.0, d: 1.7, h: 0.6 },
    hp: 200, tank: 120, burn: 0.16, fuelX: -7.45,
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
  fuel:   45,
  wrench: 250,
  chum:   600,
};   // 魚箱的價錢在 config.js 的 FISHBOX
export const REPAIR = [40, 100, 220, 450, 800, 1400];   // 修釣竿的價錢（依釣竿等級）
export const CAN = 20;                        // 一桶油幾公升
export const CHUM_SPEC = { price: 600, max: 3, life: 180, radius: 18, quota: 10, clearR: 25 };

export const BOAT_MODS = {
  sonar: { id: 'sonar', name: '探魚聲納',     price: 2800, desc: '地圖顯示魚群剩餘尾數、倒數與狀態' },
  hull:  { id: 'hull',  name: '自動抽水龍骨', price: 3500, desc: '大浪撞擊傷害 -40%，並緩慢自動修補船體' },
  lamp:  { id: 'lamp',  name: '船首集魚燈',   price: 2200, desc: '夜間在船隻附近垂釣，趨光與夜行魚機率 ×1.8' },
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
  tide:  { id: 'tide',  name: '黃金魚潮祈福', price: 4000, duration: 300, desc: '全服 5 分鐘內稀有與少見魚種出現率 ×2，並清除海域驚嚇' },
  storm: { id: 'storm', name: '風暴海神祭',   price: 4000, desc: '平靜海況下立即召喚巨浪風暴（高倍率與深海魚出沒）' },
};

export const HONOR_TITLES = [
  { id: 'seafarer', name: '討海人',     price: 5000,   gold: false },
  { id: 'captain',  name: '破浪船長',   price: 15000,  gold: false },
  { id: 'hunter',   name: '深海獵人',   price: 30000,  gold: false },
  { id: 'survivor', name: '海嘯生還者', price: 50000,  gold: false },
  { id: 'dragon',   name: '七海龍王',   price: 100000, gold: true  },
];

// 玩家的家當（伺服器保管）：{ money, rodLv, rodBroken, wrench, chum, mods, paints, paint, boats: { 船種: { engineLv } }, active,
//   baits: { 餌種: 剩幾個 }, bait: 現在掛的餌種（'' 是基本餌） }
export const newKit = () => ({
  money: 0, rodLv: 0, rodBroken: false, wrench: false, chum: 0,
  mods: { sonar: false, hull: false, lamp: false },
  paints: ['default'], paint: 'default',
  boats: { skiff: { engineLv: 0 } }, active: 'skiff',
  baits: Object.fromEntries(Object.keys(BAITS).map((k) => [k, 0])), bait: '',
});
export const baitCount = (kit, id) => (kit.baits && kit.baits[id]) || 0;

// 商品架上的一樣東西現在賣多少、買了會怎樣。回傳 { price, apply(kit) }；price 為 null 表示沒得買（why：原因）
// 引擎是裝在「現在放在世界裡的那艘船」上；魚箱是拿在手上的道具（伺服器另外處理，見 server/fishBoxes.js）
export function shopItem(id, kit, honors = null) {
  const cur = kit.boats[kit.active], S = BOAT_TYPES[kit.active];
  if (id === 'fuel') return { price: PRICE.fuel, apply() {} };
  if (id.startsWith('bait_') && BAITS[id.slice(5)]) {   // 餌：一次買一份，每種最多囤 BAIT_MAX 個
    const t = id.slice(5), B = BAITS[t];
    if (baitCount(kit, t) + B.pack > BAIT_MAX) return { price: null, why: 'full' };
    return { price: B.price, apply(k) { k.baits = { ...k.baits }; k.baits[t] = baitCount(k, t) + B.pack; if (!k.bait) k.bait = t; } };
  }
  if (id === 'wrench') return kit.wrench ? { price: null, why: 'have' } : { price: PRICE.wrench, apply(k) { k.wrench = true; } };
  if (id === 'chum') {
    if ((kit.chum || 0) >= CHUM_SPEC.max) return { price: null, why: 'full' };
    return { price: PRICE.chum, apply(k) { k.chum = (k.chum || 0) + 1; } };
  }
  if (id.startsWith('mod_') && BOAT_MODS[id.slice(4)]) {
    const m = id.slice(4), M = BOAT_MODS[m];
    if (kit.mods?.[m]) return { price: null, why: 'have' };
    return { price: M.price, mod: M, apply(k) { k.mods = { ...k.mods, [m]: true }; } };
  }
  if (id === 'paint' || id.startsWith('paint:')) {
    const owned = new Set(kit.paints || ['default']);
    const P = id === 'paint' ? BOAT_PAINTS.find((p) => p.price > 0 && !owned.has(p.id)) : BOAT_PAINTS.find((p) => p.id === id.slice(6));
    if (!P) return { price: null, why: 'have' };
    if (owned.has(P.id)) return { price: 0, paint: P, swap: true, apply(k) { k.paint = P.id; } };
    return { price: P.price, paint: P, apply(k) { k.paints = [...new Set([...(k.paints || ['default']), P.id])]; k.paint = P.id; } };
  }
  if (id === 'title' || id.startsWith('title:')) {
    const owned = new Set(honors?.titles || []);
    const T = id === 'title' ? HONOR_TITLES.find((t) => !owned.has(t.name)) : HONOR_TITLES.find((t) => t.id === id.slice(6));
    if (!T) return { price: null, why: 'have' };
    if (owned.has(T.name)) {
      const next = honors?.title === T.name ? '' : T.name;
      return { price: 0, title: T, swap: true, apply() {}, applyHonors(h) { h.title = next; } };
    }
    return {
      price: T.price, title: T, apply() {},
      applyHonors(h) { if (!h.titles.includes(T.name)) h.titles.push(T.name); h.title = T.name; },
    };
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
    return { price: BOAT_TYPES[id].price, apply(k) { k.boats[id] = { engineLv: 0 }; } };
  }
  return { price: null, why: 'none' };
}
