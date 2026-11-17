// 魚箱與送東西（伺服器這邊）：魚箱買了拿在手上，可以放在地上、甲板上，掉進海裡會浮著；只有主人搬得動。
// 箱子裡的魚受保護：別人拿不走；別人把魚放進你的箱子 = 送給你。送魚、送箱子都要對方按接受。
// 箱子：{ bid, owner 主人, fish: [uid…]（都在主人的 p.fish 裡）, k: hand 手上／g 地上／d 甲板上／w 浮在海上, x, y, z, yaw, b 誰的船 }
// 魚艙：每個人一個 hatch: true 的箱子，固定在自己船的前甲板艙口（k 永遠是 d、b 是自己）。搬不走、不算在魚箱數量裡、
//   容量照船（boxdata 的 hatchSpec）；艙蓋 open 開著才放得進、拿得出（主人和隊友都能開關）；換船前要先清空，船沉完了裡面的魚跟著沒了
import { FISHBOX, SHARE, WORLD } from '../src/config.js';
import { boxFit, BOX_SPEC, hatchSpec } from '../src/boxdata.js';
import { BOAT_TYPES } from '../src/boatdata.js';
import { SELL_W, SELL_REACH, HAVEN_SELL_W } from '../src/layout.js';
import { PORT } from '../src/lowpoly/havenPlan.js';
import { SPECIES, isJunk } from '../src/fishdata.js';

let nextBid = 1, nextOid = 1;
const nums = (a) => a.every((v) => typeof v === 'number' && Number.isFinite(v));
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const fishPub = (uid, f) => ({ uid, id: f.id, kg: f.kg, len: f.len, value: f.value });
// 送出去的魚記下收的人（gift）：之後賣掉的錢付給他，不再付給釣到的人（見 room.js 的 fishOwner）。
// 只有魚的主人送才算數；隊友幫忙拿著的魚轉手給別人，魚還是原本主人的
const gifted = (f, to, from) => {
  if (!f) return;
  const w = f.gift || f.by;
  if (!w || w.key === from.token) f.gift = { pid: to.id, key: to.token, name: to.name };
};

// ---- 箱子本身 ----
export function boxPub(room, bx) {
  const o = room.players.get(bx.owner);
  const fish = [];
  for (const u of bx.fish) { const f = o && o.fish.get(u); if (f) fish.push(fishPub(u, f)); }
  return { bid: bx.bid, o: bx.owner, k: bx.k, x: bx.x, y: bx.y, z: bx.z, yaw: bx.yaw, b: bx.b, fish,
    ...(bx.hatch ? { h: o?.kit?.active || '', open: !!bx.open } : {}) };
}
// 一般的魚箱（不含魚艙）
const crates = (p) => p.boxes.filter((bx) => !bx.hatch);
// 這個人的魚艙
export const hatchOf = (p) => p.boxes.find((bx) => bx.hatch) || null;
// 換了船（換船、買新船、沉了換一艘）：魚艙的 h（船種，決定在哪艘船上、多大）跟著變，重新告訴大家。
// 換到沒有艙口的船（小舢舨）時艙蓋一併關上，下次換回來是蓋著的
export function syncHatch(room, p) {
  const bx = hatchOf(p);
  if (!bx) return;
  if (!BOAT_TYPES[p.kit.active]?.hatch) bx.open = false;
  room.all({ t: 'box', add: [boxPub(room, bx)] });
}
// 這個箱子的尺寸：魚艙照主人現在開的船
const specOf = (room, bx) => (bx.hatch ? hatchSpec(room.players.get(bx.owner)?.kit?.active) : BOX_SPEC);
const boxList = (room) => [...room.boxes.values()].map((bx) => boxPub(room, bx));
const show = (room, bx) => room.all({ t: 'box', add: [boxPub(room, bx)] });
const hide = (room, bids) => bids.length && room.all({ t: 'box', del: bids });
export { boxList };

function makeBox(room, p, place) {
  const bx = { bid: nextBid++, owner: p.id, fish: [], k: 'hand', x: 0, y: 0, z: 0, yaw: 0, b: 0, ...place };
  p.boxes.push(bx);
  room.boxes.set(bx.bid, bx);
  return bx;
}
// 清掉一個箱子（連同裡面的魚）
function killBox(room, p, bx) {
  for (const u of bx.fish) p.fish.delete(u);
  p.boxes = p.boxes.filter((o) => o !== bx);
  room.boxes.delete(bx.bid);
  hide(room, [bx.bid]);
}
// 箱子在世界的哪裡（拿在手上的：主人站的地方；甲板上的：那艘船）
function boxAt(room, bx) {
  if (bx.k === 'hand') { const o = room.players.get(bx.owner); return o && o.pos ? [o.pos[0], o.pos[2]] : [1e9, 1e9]; }
  if (bx.k === 'd') { const o = room.players.get(bx.b); return o && o.boat ? [o.boat.s[0], o.boat.s[1]] : [1e9, 1e9]; }
  return [bx.x, bx.z];
}
const nearBox = (room, p, bx) => { const [x, z] = boxAt(room, bx); return room.near(p, x, z, bx.k === 'd' ? SHARE.deckReach : FISHBOX.reach + 1.5); };
// 這個人手上抱著的箱子
const heldBox = (p) => p.boxes.find((bx) => bx.k === 'hand') || null;
// 所有箱子裡的魚（不能再拿去賣、送、放）
export const inBoxes = (p) => new Set(p.boxes.flatMap((bx) => bx.fish));
// 抱著的箱子放在腳邊（換抱別的、斷線時）
function setDown(room, p, bx) {
  if (!p.pos) return;
  const [x, y, z, yaw, flags, , , , onBoat, lx, lz] = p.pos;
  const b = room.players.get(onBoat)?.boat;
  if (b && !b.sunk) {
    Object.assign(bx, { k: 'd', x: lx, y: 0, z: lz, yaw: yaw - b.s[2], b: onBoat });
  } else {
    const floating = !!(flags & 4) || !!b?.sunk;
    Object.assign(bx, { k: floating ? 'w' : 'g', x, y: floating ? 0 : y, z, yaw, b: 0 });
  }
  show(room, bx);
}
// 某艘船沉了、不見了：甲板上的箱子浮到海面上（裡面的魚還在）；魚艙跟著船
export function floatBoxes(room, owner) {
  const s = owner.boat && owner.boat.s;
  if (!s) return;
  const fx = Math.cos(s[2]), fz = Math.sin(s[2]);
  for (const bx of room.boxes.values()) {
    if (bx.k !== 'd' || bx.b !== owner.id || bx.hatch) continue;
    Object.assign(bx, { k: 'w', x: s[0] + fx * bx.x - fz * bx.z, y: 0, z: s[1] + fz * bx.x + fx * bx.z, b: 0 });
    show(room, bx);
  }
}

// 買新船原地換船：這艘船甲板上的箱子（不管誰的）搬到新船的前甲板（spot() 給一個船身座標 [x, z]）
export function moveDeckBoxes(room, owner, spot) {
  for (const bx of room.boxes.values()) {
    if (bx.k !== 'd' || bx.b !== owner.id || bx.hatch) continue;
    const [x, z] = spot();
    Object.assign(bx, { x, y: 0, z });
    show(room, bx);
  }
}

// 進房（新來的、帶著存檔的）：存著的箱子放回他的船上；以前買過「船上的魚箱」的換成一個箱子放在船上
export function homeBoxes(room, p) {
  const saved = p.savedBoxes || [];
  p.savedBoxes = null;
  const old = Object.values(p.kit.boats).some((b) => b.boxLv > 0);
  for (const b of Object.values(p.kit.boats)) delete b.boxLv;
  if (!saved.length && old) saved.push([]);
  const S = BOAT_TYPES[p.kit.active], spot = S.box || { x: 0, z: 0 };
  saved.slice(0, FISHBOX.max).forEach((uids, i) => {
    const bx = makeBox(room, p, { k: 'd', b: p.id, x: spot.x - i * (FISHBOX.w + 0.2), y: 0, z: spot.z });
    bx.fish = uids.filter((u) => p.fish.has(u));
  });
  ensureHatch(room, p, p.savedHatch || []);
  p.savedHatch = null;
  for (const bx of p.boxes) show(room, bx);
}
// 每個人都有一個魚艙（沒有的話建一個；fish：存檔讀回來的魚）
function ensureHatch(room, p, fish = []) {
  let bx = hatchOf(p);
  if (!bx) bx = makeBox(room, p, { k: 'd', b: p.id, hatch: true, open: false });
  else room.boxes.set(bx.bid, bx);
  for (const u of fish) if (p.fish.has(u) && !bx.fish.includes(u)) bx.fish.push(u);
  return bx;
}
// 魚艙清空（船沉完了、定時刷新）
export function clearHatch(room, p) {
  const bx = hatchOf(p);
  if (!bx) return;
  for (const u of bx.fish) p.fish.delete(u);
  bx.fish = [];
  bx.open = false;
  if (room.boxes.has(bx.bid)) show(room, bx);
}
// 存檔：每個箱子裡的魚（不含魚艙）；魚艙另外存
export const savedBoxesOf = (p) => crates(p).map((bx) => bx.fish.map((u) => p.fish.get(u)).filter(Boolean));
export const savedHatchOf = (p) => (hatchOf(p)?.fish || []).map((u) => p.fish.get(u)).filter(Boolean);
// 讀檔：箱子裡的魚重新編號放回 p.fish，等進房時 homeBoxes 放出來
export function loadBoxes(p, list, uid) {
  p.savedBoxes = [];
  for (const fishes of Array.isArray(list) ? list.slice(0, FISHBOX.max) : []) {
    const uids = [];
    for (const f of Array.isArray(fishes) ? fishes.slice(0, 200) : []) {
      if (!f || !SPECIES[f.id]) continue;
      const u = uid();
      p.fish.set(u, { id: f.id, kg: f.kg, len: f.len, value: f.value, by: f.by && typeof f.by.name === 'string' ? f.by : null, gift: f.gift && typeof f.gift.name === 'string' ? f.gift : null });
      uids.push(u);
    }
    p.savedBoxes.push(uids);
  }
}
// 讀檔：魚艙裡的魚
export function loadHatch(p, list, uid) {
  p.savedHatch = [];
  for (const f of Array.isArray(list) ? list.slice(0, 200) : []) {
    if (!f || !SPECIES[f.id]) continue;
    const u = uid();
    p.fish.set(u, { id: f.id, kg: f.kg, len: f.len, value: f.value, by: f.by && typeof f.by.name === 'string' ? f.by : null, gift: f.gift && typeof f.gift.name === 'string' ? f.gift : null });
    p.savedHatch.push(u);
  }
}
// 斷線：抱著的箱子先放在腳邊
export const dropBoxes = (room, p) => { const bx = heldBox(p); if (bx) setDown(room, p, bx); };
// 船被回收：乘客仍抱著的箱子跟著人走，其餘放在舊船上的自有箱搬到岸上。
export function returnPassengerBoxes(room, p, boatOwner, landing) {
  let i = 0;
  for (const bx of p.boxes) {
    if (bx.k !== 'd' || bx.b !== boatOwner || bx.hatch) continue;
    const side = i++ % 2 === 0 ? -1 : 1;
    const offset = side * (FISHBOX.d / 2 + 0.27);
    Object.assign(bx, { k: 'g', x: landing.x - Math.sin(landing.yaw) * offset, y: landing.y,
      z: landing.z + Math.cos(landing.yaw) * offset, yaw: landing.yaw, b: 0 });
    show(room, bx);
  }
}
// 離開太久被收走：箱子收起來（跟著存檔）；別人放在他船上的箱子浮到海上
export function stowBoxes(room, p) {
  floatBoxes(room, p);
  const bids = p.boxes.map((bx) => bx.bid);
  for (const b of bids) room.boxes.delete(b);
  hide(room, bids);
}
// 定時刷新：箱子和裡面的魚都清掉（魚艙留著、清空）
export function resetBoxes(room, p) {
  for (const bx of crates(p)) killBox(room, p, bx);
  clearHatch(room, p);
}

// ---- 賣整箱：抱著箱子對母島的籃子、大港的大秤按 E ----
export function sellBox(room, p, m) {
  const bx = p.boxes.find((o) => o.bid === m.bid);
  if (!bx || bx.k !== 'hand') return room.send(p, { t: 'no', msg: '要抱著自己的魚箱才能整箱賣' });
  const haven = m.at === 'haven', spot = haven ? HAVEN_SELL_W : SELL_W.basket;
  if (!room.near(p, spot.x, spot.z, haven ? PORT.sell.reach + 2 : SELL_REACH + 1)) return room.send(p, { t: 'no', msg: haven ? '要站在大秤旁邊才能賣' : '要站在籃子旁邊才能賣' });
  if (!bx.fish.length) return room.send(p, { t: 'no', msg: '箱子是空的' });
  const uids = bx.fish, fishes = [];
  for (const u of uids) {
    const f = p.fish.get(u);
    if (!f) continue;
    fishes.push(f); p.fish.delete(u);
  }
  bx.fish = [];
  // 錢照每條魚的主人付（隊友的魚付給隊友）；大港多 15%、急凍魚艙、船隊分紅、經驗都在 payout 算，紀錄在 payFish 裡比
  const pay = room.payFish(p, fishes, haven ? PORT.bonus : 0);
  room.send(p, { t: 'sold', total: pay.total, fresh: pay.fresh, uids, others: pay.others, kit: p.kit, box: bx.bid, at: haven ? 'haven' : undefined });
  show(room, bx);
}

// ---- 買箱子：最多 FISHBOX.max 個；滿了要先答應清掉最舊的那個（m.replace） ----
export function buyBox(room, p, m) {
  const kit = p.kit;
  const mine = crates(p);
  if (mine.length >= FISHBOX.max && m.replace !== true) {
    const old = mine[0];
    return room.send(p, { t: 'boxFull', n: old.fish.length });
  }
  if (kit.money < FISHBOX.price) return room.send(p, { t: 'no', msg: '錢不夠' });
  if (mine.length >= FISHBOX.max) killBox(room, p, mine[0]);
  kit.money -= FISHBOX.price;
  const was = heldBox(p);
  if (was) setDown(room, p, was);
  const bx = makeBox(room, p, { k: 'hand' });
  room.send(p, { t: 'bought', id: 'box', price: FISHBOX.price, kit, bid: bx.bid });
  show(room, bx);
}

// ---- 送東西：先問對方，對方按接受才給 ----
function offerCheck(room, g, off) {
  const t = room.players.get(off.to);
  if (!t || !t.ws) return '對方不在了';
  if (off.uid) {
    if (!g.fish.has(off.uid) || room.loose.has(off.uid) || inBoxes(g).has(off.uid)) return '那條魚已經不在手上了';
    if (t.fish.size >= 200) return '對方身上的魚太多了';
  } else {
    const bx = g.boxes.find((o) => o.bid === off.bid);
    if (!bx || bx.k !== 'hand') return '箱子已經不在手上了';
    if (crates(t).length >= FISHBOX.max) return `對方已經有 ${FISHBOX.max} 個魚箱了`;
    if (t.fish.size + bx.fish.length > 200) return '對方身上的魚太多了';
  }
  return '';
}
export function expireOffers(room, now) {
  for (const off of [...room.offers.values()]) {
    if (now - off.at < FISHBOX.offerSec * 1000) continue;
    room.offers.delete(off.oid);
    const g = room.players.get(off.from), t = room.players.get(off.to);
    if (g) room.send(g, { t: 'giveNo', msg: `${t ? t.name : '對方'} 沒有回應` });
    if (t) room.send(t, { t: 'offerGone', oid: off.oid });
  }
}

// 玩家傳來的、跟箱子和送東西有關的訊息；不是的話回傳 false
export function onBoxMsg(room, p, m, now) {
  switch (m.t) {
    case 'boxPut': {   // 抱著的箱子放下：地上、甲板上（自己或別人的船）、海上（浮著）
      const bx = p.boxes.find((o) => o.bid === m.bid);
      if (!p.pos || !bx || bx.hatch || bx.k !== 'hand' || !['g', 'd', 'w'].includes(m.k) || !nums([m.x, m.y, m.z, m.yaw])
        || Math.max(Math.abs(m.x), Math.abs(m.z)) > WORLD.size / 2 || Math.abs(m.y) > 300) return true;
      let bx0 = m.x, bz0 = m.z, b = 0;
      if (m.k === 'd') {
        const o = room.players.get(m.b);
        if (!o || !o.boat || o.boat.sunk || Math.hypot(m.x, m.z) > 20) return true;
        b = o.id; bx0 = o.boat.s[0]; bz0 = o.boat.s[1];
      }
      if (dist(p.pos[0], p.pos[2], bx0, bz0) > (m.k === 'd' ? 25 : 6)) return true;
      Object.assign(bx, { k: m.k, x: m.x, y: m.y, z: m.z, yaw: m.yaw, b });
      show(room, bx);
      return true;
    }
    case 'boxTake': {   // 抱起自己的箱子（裡面的魚一起）
      const bx = p.boxes.find((o) => o.bid === m.bid);
      if (!bx || bx.hatch || bx.k === 'hand') return true;
      if (heldBox(p)) return room.send(p, { t: 'no', msg: '手上已經抱著一個箱子了' }), true;
      if (!nearBox(room, p, bx)) return room.send(p, { t: 'no', msg: '太遠了，拿不到' }), true;
      bx.k = 'hand'; bx.b = 0;
      show(room, bx);
      return true;
    }
    case 'boxIn': {   // 把手上的魚放進箱子（別人的箱子 = 送給箱主）
      const bx = room.boxes.get(m.bid), f = p.fish.get(m.uid);
      const no = (msg) => (room.send(p, { t: 'boxNo', uid: m.uid, msg }), true);
      if (!bx || !f || bx.k === 'hand' || room.loose.has(m.uid) || inBoxes(p).has(m.uid)) return no('放不進去');
      if (!nearBox(room, p, bx)) return no('太遠了，放不進去');
      const o = room.players.get(bx.owner);
      if (!o || o.left) return no('放不進去');
      if (o !== p && o.fish.size >= 200) return no('對方身上的魚太多了');
      const spec = specOf(room, bx), what = bx.hatch ? '魚艙' : '魚箱';
      if (!spec || (bx.hatch && (!o.boat || o.boat.sunk))) return no('這艘船沒有魚艙');
      if (bx.hatch && !bx.open) return no('艙蓋關著，先打開');
      const fit = boxFit(bx.fish.map((u) => o.fish.get(u)).filter(Boolean), f.id, f.len, spec);
      if (fit) return no(fit === 'long' ? `這條${SPECIES[f.id].name}太大，放不進${what}` : `${what}滿了`);
      if (o !== p) { p.fish.delete(m.uid); o.fish.set(m.uid, f); gifted(f, o, p); }   // 放進別人的箱子＝送給他（p 自己的魚才算）
      bx.fish.push(m.uid);
      room.send(p, { t: 'boxedIn', uid: m.uid, bid: bx.bid, to: o === p ? '' : o.name });
      if (o !== p) room.send(o, { t: 'boxGift', from: p.name, id: f.id });
      show(room, bx);
      return true;
    }
    case 'boxOut': {   // 從自己的箱子拿一條出來（玩家指到的那一條，沒指定就拿最上面那條）
      const bx = p.boxes.find((o) => o.bid === m.bid);
      if (!bx || bx.k === 'hand' || !bx.fish.length) return true;
      if (bx.hatch && !bx.open) return room.send(p, { t: 'no', msg: '艙蓋關著，先打開' }), true;
      if (!nearBox(room, p, bx)) return room.send(p, { t: 'no', msg: '太遠了，拿不到' }), true;
      const idx = Number.isInteger(m.uid) ? bx.fish.indexOf(m.uid) : -1;
      const u = idx >= 0 ? bx.fish.splice(idx, 1)[0] : bx.fish.pop();
      const f = p.fish.get(u);
      if (f) room.send(p, { t: 'boxOut', fish: fishPub(u, f) });
      show(room, bx);
      return true;
    }
    case 'hatchLid': {   // 打開／關上魚艙的艙蓋：主人和隊友都可以
      const bx = room.boxes.get(m.bid), o = bx && room.players.get(bx.owner);
      if (!bx || !bx.hatch || !o || typeof m.open !== 'boolean') return true;
      if (o !== p && !room.sameParty(p, o)) return room.send(p, { t: 'no', msg: '只有船主和隊友能開艙蓋' }), true;
      if (!o.boat || o.boat.sunk || !specOf(room, bx)) return true;
      if (!nearBox(room, p, bx)) return room.send(p, { t: 'no', msg: '太遠了，搆不到' }), true;
      if (bx.open === m.open) return true;
      bx.open = m.open;
      show(room, bx);
      return true;
    }
    case 'hatchPour': {   // 抱著自己的魚箱對著自己打開的魚艙：箱子有魚就倒進艙裡、空箱子就從艙裡裝滿（裝得下多少算多少）
      const bx = hatchOf(p), cr = heldBox(p);
      if (!bx || !cr || bx.bid !== m.bid) return true;
      const spec = specOf(room, bx);
      if (!spec || !p.boat || p.boat.sunk) return room.send(p, { t: 'no', msg: '這艘船沒有魚艙' }), true;
      if (!bx.open) return room.send(p, { t: 'no', msg: '艙蓋關著，先打開' }), true;
      if (!nearBox(room, p, bx)) return room.send(p, { t: 'no', msg: '太遠了，搆不到' }), true;
      const into = cr.fish.length > 0, from = into ? cr : bx, to = into ? bx : cr, toSpec = into ? spec : BOX_SPEC;
      let n = 0;
      for (const u of [...from.fish].reverse()) {   // 最上面的先
        const f = p.fish.get(u);
        if (!f || boxFit(to.fish.map((v) => p.fish.get(v)).filter(Boolean), f.id, f.len, toSpec)) continue;
        from.fish.splice(from.fish.indexOf(u), 1);
        to.fish.push(u);
        n++;
      }
      room.send(p, { t: 'hatchPoured', n, into, left: from.fish.length });
      if (n) { show(room, bx); show(room, cr); }
      return true;
    }
    case 'give': {   // 送東西給旁邊的人：手上的魚（uid）或抱著的箱子（bid）
      const t = room.players.get(m.to);
      if (!t || t === p || !t.ws || !t.pos) return room.send(p, { t: 'no', msg: '對方不在了' }), true;
      if (!room.near(p, t.pos[0], t.pos[2], FISHBOX.giveReach + 1)) return room.send(p, { t: 'no', msg: '要站在對方旁邊才能送' }), true;
      const off = { oid: nextOid++, from: p.id, to: t.id, uid: m.uid || 0, bid: m.uid ? 0 : m.bid || 0, at: now };
      const why = offerCheck(room, p, off);
      if (why) return room.send(p, { t: 'no', msg: why }), true;
      for (const o of [...room.offers.values()]) if (o.from === p.id) room.offers.delete(o.oid);   // 一次只送一樣
      room.offers.set(off.oid, off);
      const bx = off.bid ? p.boxes.find((o) => o.bid === off.bid) : null;
      const what = off.uid ? fishPub(off.uid, p.fish.get(off.uid))
        : { box: bx.fish.length, kg: bx.fish.reduce((s, u) => s + (p.fish.get(u)?.kg || 0), 0), value: bx.fish.reduce((s, u) => s + (p.fish.get(u)?.value || 0), 0) };
      room.send(t, { t: 'offer', oid: off.oid, from: p.name, what, sec: FISHBOX.offerSec });
      room.send(p, { t: 'offering', to: t.name });
      return true;
    }
    case 'giveAns': {
      const off = room.offers.get(m.oid);
      if (!off || off.to !== p.id || typeof m.yes !== 'boolean') return true;
      if (now - off.at >= FISHBOX.offerSec * 1000) { expireOffers(room, now); return true; }
      room.offers.delete(off.oid);
      const g = room.players.get(off.from);
      if (!g) return true;
      if (!m.yes) return room.send(g, { t: 'giveNo', msg: `${p.name} 不收` }), true;
      const why = !p.pos || !room.near(g, p.pos[0], p.pos[2], FISHBOX.giveReach + 1) ? '離太遠了，無法交付' : offerCheck(room, g, off);
      if (why) { room.send(p, { t: 'no', msg: why }); room.send(g, { t: 'giveNo', msg: why }); return true; }
      if (off.uid) {
        const f = g.fish.get(off.uid);
        g.fish.delete(off.uid); p.fish.set(off.uid, f); gifted(f, p, g);
        room.send(g, { t: 'gave', uid: off.uid, to: p.name });
        room.send(p, { t: 'gift', fish: fishPub(off.uid, f), from: g.name });
        return true;
      }
      const bx = g.boxes.find((o) => o.bid === off.bid);
      for (const u of bx.fish) { const f = g.fish.get(u); g.fish.delete(u); if (f) { p.fish.set(u, f); gifted(f, p, g); } }
      g.boxes = g.boxes.filter((o) => o !== bx);
      const was = heldBox(p);
      if (was) setDown(room, p, was);
      bx.owner = p.id; bx.k = 'hand'; bx.b = 0;
      p.boxes.push(bx);
      room.send(g, { t: 'gave', bid: bx.bid, to: p.name });
      room.send(p, { t: 'gift', bid: bx.bid, from: g.name, n: bx.fish.length });
      show(room, bx);
      return true;
    }
  }
  return false;
}
