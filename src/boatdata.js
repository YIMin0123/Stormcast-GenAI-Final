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
    id: 'fisher', name: '漁船', price: 700, len: 13, beam: 4.6, draft: 1.0, deck: 0.85, bul: 0.35, rise: 1.1,
    speed: 7, tiltK: 1, costK: 1, paint: [0.08, 0.42, 0.44], cabin: { x0: -4.2, x1: -0.8, hw: 1.3, top: 2.3 }, helmX: -2.5, helmR: 1.1,
    hatch: { x: 2.0, s: 1.8 }, barrel: { x: 3.4, z: 0.9 }, box: { x: 0.5, z: 0, w: 0.9, d: 1.3, h: 0.55 },
    hp: 120, tank: 60, burn: 0.09, fuelX: -5.45,
  },
  trawler: {
    id: 'trawler', name: '大漁船', price: 3000, len: 18, beam: 6.2, draft: 1.3, deck: 1.05, bul: 0.45, rise: 1.4,
    speed: 8.6, tiltK: 0.75, costK: 1.8, paint: [0.55, 0.16, 0.12], cabin: { x0: -6.2, x1: -1.8, hw: 1.9, top: 2.4 }, helmX: -3.5, helmR: 1.1,
    hatch: { x: 2.8, s: 2.4 }, barrel: { x: 5.2, z: 1.4 }, box: { x: -0.5, z: 0, w: 1.0, d: 1.7, h: 0.6 },
    hp: 200, tank: 120, burn: 0.16, fuelX: -7.45,
  },
};
export const BOAT_ORDER = ['skiff', 'fisher', 'trawler'];
export const BOX_CAP = [0, 6, 12, 20];   // 魚箱各等級裝幾條
export const MAX_LEVEL = 3;

// ---- 商店的價錢（伺服器照這份扣錢，瀏覽器照這份顯示） ----
export const PRICE = { rod: [120, 350, 800], engine: [200, 500, 1000], box: [100, 300, 700], fuel: 30, wrench: 150 };
export const REPAIR = [40, 100, 220, 450];   // 修釣竿的價錢（依釣竿等級）
export const CAN = 20;                        // 一桶油幾公升

// 玩家的家當（伺服器保管）：{ money, rodLv, rodBroken, wrench, boats: { 船種: { engineLv, boxLv } }, active: 現在放在世界裡的是哪一艘 }
export const newKit = () => ({ money: 0, rodLv: 0, rodBroken: false, wrench: false, boats: { skiff: { engineLv: 0, boxLv: 0 } }, active: 'skiff' });

// 商品架上的一樣東西現在賣多少、買了會怎樣。回傳 { price, apply(kit) }；price 為 null 表示沒得買（why：原因）
// 引擎和魚箱是裝在「現在放在世界裡的那艘船」上
export function shopItem(id, kit) {
  const cur = kit.boats[kit.active], S = BOAT_TYPES[kit.active];
  if (id === 'fuel') return { price: PRICE.fuel, apply() {} };
  if (id === 'wrench') return kit.wrench ? { price: null, why: 'have' } : { price: PRICE.wrench, apply(k) { k.wrench = true; } };
  if (id === 'rod') {
    // 釣竿斷了：先修。錢不夠也修得起，身上有多少算多少（不然釣竿斷了又沒錢，就再也賺不到錢了）
    if (kit.rodBroken) return { price: Math.min(REPAIR[kit.rodLv], kit.money), repair: true, cheap: kit.money < REPAIR[kit.rodLv], apply(k) { k.rodBroken = false; } };
    if (kit.rodLv >= MAX_LEVEL) return { price: null, why: 'max' };
    return { price: PRICE.rod[kit.rodLv], apply(k) { k.rodLv++; } };
  }
  if (id === 'engine') {
    if (!cur || cur.engineLv >= MAX_LEVEL) return { price: null, why: 'max' };
    return { price: Math.round(PRICE.engine[cur.engineLv] * S.costK / 10) * 10, apply(k) { k.boats[k.active].engineLv++; } };
  }
  if (id === 'box') {
    if (!cur || cur.boxLv >= MAX_LEVEL) return { price: null, why: 'max' };
    return { price: PRICE.box[cur.boxLv], apply(k) { k.boats[k.active].boxLv++; } };
  }
  if (BOAT_TYPES[id] && id !== 'skiff') {
    if (kit.boats[id]) return { price: null, why: 'have' };
    return { price: BOAT_TYPES[id].price, apply(k) { k.boats[id] = { engineLv: 0, boxLv: 0 }; } };
  }
  return { price: null, why: 'none' };
}
