// 魚艙（前甲板艙口，固定在船上的魚箱）的伺服器規則：艙蓋誰能開、開著才放得進拿得出、容量照船、
// 隊友放進來等於送給船主、抱著魚箱倒進去／裝出來、換船前要清空、船沉完了跟著沒了、存檔讀檔。
// 寫法照 tools/social.test.js（同一個行程建房間、假玩家）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { Room, newPlayer, profileOf, applyProfile } from '../server/room.js';
import { Guild } from '../server/guild.js';
import { Activity } from '../server/activity.js';
import { buyBox, hatchOf } from '../server/fishBoxes.js';
import { QUAY_CENTER_W } from '../src/layout.js';
import { FISHBOX } from '../src/config.js';
import { hatchSpec, boxFit } from '../src/boxdata.js';

function fixture(n = 3) {
  const rooms = new Map();
  const hub = {
    daily: { top: () => [], offer: () => -1 }, keep() {}, sessions: new Map(), guild: new Guild(null),
    activity: new Activity('.', { off: true, now: () => 1_000_000 }),
    eachRoom(fn) { for (const r of rooms.values()) fn(r); },
  };
  const room = new Room(1, hub);
  rooms.set(1, room);
  const ps = [];
  for (let id = 1; id <= n; id++) {
    const p = newPlayer(id, null, 'token-' + id, '玩家' + id);
    p.inbox = [];
    p.ws = { readyState: 1, send: (raw) => p.inbox.push(JSON.parse(raw)) };
    room.enter(p);
    p.pos = [QUAY_CENTER_W.x, 1.3, QUAY_CENTER_W.z, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];
    ps.push(p);
  }
  return { room, ps };
}
const lastOf = (p, t) => p.inbox.filter((m) => m.t === t).at(-1);
const clear = (...ps) => { for (const p of ps) p.inbox.length = 0; };
// 換成遠洋大漁船（魚艙最大），人站在自己船上
function trawler(p) {
  p.kit.boats.trawler = { engineLv: 0 };
  p.kit.active = 'trawler';
  p.boat.type = 'trawler';
}
const onBoat = (p, owner) => { p.pos = [owner.boat.s[0], 1.3, owner.boat.s[1], 0, 0, 0, 0, 0, owner.id, 0, 0, '', '']; };
let uid = 50_000;
const giveFish = (p, f = { id: 'mackerel', kg: 1, len: 0.4, value: 30 }) => { const u = uid++; p.fish.set(u, { ...f }); return u; };
function team(room, a, b) {
  room.on(a, { t: 'partyInvite', to: b.id });
  room.on(b, { t: 'askAns', aid: lastOf(b, 'ask').aid, yes: true });
}

test('每個人進房都有一個魚艙；小舢舨沒有艙口，放不進去', () => {
  const { room, ps: [a] } = fixture(1);
  const h = hatchOf(a);
  assert.ok(h && h.hatch && h.k === 'd' && h.b === a.id);
  assert.equal(room.boxes.get(h.bid), h);
  onBoat(a, a);
  room.on(a, { t: 'hatchLid', bid: h.bid, open: true });
  assert.equal(h.open, false, '小舢舨沒有艙口，開不了');
  const u = giveFish(a);
  room.on(a, { t: 'boxIn', bid: h.bid, uid: u });
  assert.match(lastOf(a, 'boxNo').msg, /沒有魚艙/);
});

test('艙蓋：船主、隊友能開關，別人不行；關著放不進、拿不出', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  trawler(a);
  team(room, a, b);
  for (const p of [a, b, c]) onBoat(p, a);
  const h = hatchOf(a), u = giveFish(a);
  room.on(a, { t: 'boxIn', bid: h.bid, uid: u });
  assert.match(lastOf(a, 'boxNo').msg, /艙蓋關著/);
  room.on(c, { t: 'hatchLid', bid: h.bid, open: true });
  assert.equal(h.open, false);
  assert.match(lastOf(c, 'no').msg, /船主和隊友/);
  room.on(b, { t: 'hatchLid', bid: h.bid, open: true });
  assert.equal(h.open, true, '隊友可以打開');
  const pub = lastOf(c, 'box').add.find((d) => d.bid === h.bid);
  assert.equal(pub.open, true, '大家都看得到艙蓋開了');
  assert.equal(pub.h, 'trawler');
  room.on(a, { t: 'boxIn', bid: h.bid, uid: u });
  assert.ok(lastOf(a, 'boxedIn'));
  assert.deepEqual(h.fish, [u]);
  room.on(a, { t: 'hatchLid', bid: h.bid, open: false });
  clear(a);
  room.on(a, { t: 'boxOut', bid: h.bid });
  assert.match(lastOf(a, 'no').msg, /艙蓋關著/);
  assert.equal(h.fish.length, 1);
  room.on(a, { t: 'hatchLid', bid: h.bid, open: true });
  room.on(a, { t: 'boxOut', bid: h.bid });
  assert.equal(lastOf(a, 'boxOut').fish.uid, u);
  assert.equal(h.fish.length, 0);
  // 魚艙搬不走、不能整箱賣
  room.on(a, { t: 'boxTake', bid: h.bid });
  assert.equal(h.k, 'd');
});

test('隊友把魚放進船主的魚艙＝送給船主；魚艙不算在魚箱數量裡', () => {
  const { room, ps: [a, b] } = fixture(2);
  trawler(a);
  team(room, a, b);
  onBoat(a, a); onBoat(b, a);
  const h = hatchOf(a);
  room.on(a, { t: 'hatchLid', bid: h.bid, open: true });
  const u = giveFish(b);
  room.on(b, { t: 'boxIn', bid: h.bid, uid: u });
  assert.ok(a.fish.has(u) && !b.fish.has(u));
  assert.ok(lastOf(a, 'boxGift'));
  // 買一般魚箱：魚艙不佔名額
  a.kit.money = 99999;
  buyBox(room, a, {});
  assert.ok(lastOf(a, 'bought'), '有魚艙也能買第一個魚箱');
  assert.equal(a.boxes.filter((bx) => !bx.hatch).length, FISHBOX.max);
});

test('容量照船：大漁船的魚艙比一個魚箱裝得多；滿了放不進', () => {
  const { room, ps: [a] } = fixture(1);
  trawler(a);
  onBoat(a, a);
  const h = hatchOf(a), S = hatchSpec('trawler');
  room.on(a, { t: 'hatchLid', bid: h.bid, open: true });
  const big = { id: 'tuna', kg: 20, len: 1.2, value: 300 };
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const u = giveFish(a, big);
    clear(a);
    room.on(a, { t: 'boxIn', bid: h.bid, uid: u });
    if (lastOf(a, 'boxNo')) { assert.match(lastOf(a, 'boxNo').msg, /魚艙滿了/); break; }
    n++;
  }
  const inCrate = (() => { const list = []; while (!boxFit(list, big.id, big.len)) list.push(big); return list.length; })();
  assert.ok(n > inCrate * 3, `魚艙裝 ${n} 條，魚箱只裝 ${inCrate} 條`);
  assert.equal(boxFit(h.fish.map((u) => a.fish.get(u)), big.id, big.len, S), 'full');
  assert.equal(boxFit([], 'tuna', 2.5, S), '', '大魚艙放得下 2.5 公尺的魚（魚箱放不下）');
  assert.equal(boxFit([], 'tuna', 2.5), 'long');
});

test('抱著魚箱對著打開的魚艙：有魚就倒進去，空箱子就裝出來', () => {
  const { room, ps: [a] } = fixture(1);
  trawler(a);
  onBoat(a, a);
  a.kit.money = 99999;
  buyBox(room, a, {});
  const cr = a.boxes.find((bx) => !bx.hatch), h = hatchOf(a);
  const us = [giveFish(a), giveFish(a), giveFish(a)];
  cr.fish.push(...us);
  room.on(a, { t: 'hatchPour', bid: h.bid });
  assert.match(lastOf(a, 'no').msg, /艙蓋關著/);
  room.on(a, { t: 'hatchLid', bid: h.bid, open: true });
  room.on(a, { t: 'hatchPour', bid: h.bid });
  assert.deepEqual({ ...lastOf(a, 'hatchPoured'), t: 0 }, { t: 0, n: 3, into: true, left: 0 });
  assert.equal(cr.fish.length, 0);
  assert.equal(h.fish.length, 3);
  room.on(a, { t: 'hatchPour', bid: h.bid });
  assert.equal(lastOf(a, 'hatchPoured').into, false);
  assert.equal(cr.fish.length, 3);
  assert.equal(h.fish.length, 0);
});

test('魚艙有魚不能換船；存檔讀檔留著；船沉完了跟著沒了', () => {
  const { room, ps: [a] } = fixture(1);
  trawler(a);
  a.kit.boats.fisher = { engineLv: 0 };
  onBoat(a, a);
  const h = hatchOf(a), u = giveFish(a, { id: 'tuna', kg: 5, len: 0.9, value: 200 });
  room.on(a, { t: 'hatchLid', bid: h.bid, open: true });
  room.on(a, { t: 'boxIn', bid: h.bid, uid: u });
  clear(a);
  a.pos = [QUAY_CENTER_W.x, 1.3, QUAY_CENTER_W.z, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];   // 換船要先下船
  room.on(a, { t: 'swap', type: 'fisher' });
  assert.ok(a.inbox.some((m) => m.t === 'no' && /魚艙/.test(m.msg)), '魚艙有魚：先拿出來才能換船');
  // 存檔讀檔
  const prof = profileOf(a);
  assert.equal(prof.hatch.length, 1);
  assert.equal(prof.fish.filter((f) => f.id === 'tuna').length, 0, '魚艙裡的魚不重複存在身上');
  const { room: r2 } = fixture(0);
  const q = newPlayer(9, null, 'token-9', '讀檔的人');
  q.inbox = []; q.ws = { readyState: 1, send: (raw) => q.inbox.push(JSON.parse(raw)) };
  applyProfile(q, prof);
  r2.enter(q);
  const h2 = hatchOf(q);
  assert.equal(h2.fish.length, 1);
  assert.equal(q.fish.get(h2.fish[0]).id, 'tuna');
  // 船沉完了
  a.boat.sunk = true;
  room.on(a, { t: 'boatLost' });
  assert.equal(hatchOf(a).fish.length, 0);
  assert.ok(!a.fish.has(u));
});

test('換船後魚艙跟著新船（廣播新的 h）；換到小舢舨艙蓋關上', () => {
  const { room, ps: [a, b] } = fixture(2);
  trawler(a);
  a.kit.boats.fisher = { engineLv: 0 };
  onBoat(a, a);
  const h = hatchOf(a);
  room.on(a, { t: 'hatchLid', bid: h.bid, open: true });
  assert.equal(h.open, true);
  a.pos = [QUAY_CENTER_W.x, 1.3, QUAY_CENTER_W.z, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];   // 換船要先下船
  clear(a, b);
  room.on(a, { t: 'swap', type: 'fisher' });
  assert.equal(a.kit.active, 'fisher');
  const pub = lastOf(b, 'box')?.add.find((d) => d.bid === h.bid);
  assert.equal(pub?.h, 'fisher', '別人收到魚艙換到近海漁船');
  clear(a, b);
  room.on(a, { t: 'swap', type: 'skiff' });
  assert.equal(a.kit.active, 'skiff');
  assert.equal(h.open, false, '小舢舨沒有艙口：艙蓋關上');
  assert.equal(lastOf(b, 'box')?.add.find((d) => d.bid === h.bid)?.h, 'skiff');
});
