import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { GRACE, Room, newPlayer } from '../server/room.js';
import { isWater } from '../server/world.js';
import { FishWorld } from '../src/fish.js';
import { SELL_W, QUAY_CENTER_W, DECK_Y, deckY, ALL_SHELF_W, SITES, BERTHS, HAVEN_SELL_W } from '../src/layout.js';
import { SERVER, GUILD, LEVEL, PARTY, TOW, FEEDBACK, levelOf } from '../src/config.js';
import { refreshRule, refreshPeriodTag, nextRefreshAt } from '../src/announce.js';
import { wrap180, compassDist, projectCompassX } from '../src/compass.js';
import { Sea, VORTEX } from '../src/weather.js';
import { BOAT_TYPES, BLESSINGS, CHUM_SPEC, repairCost, shopItem, newKit, titlesFor } from '../src/boatdata.js';
import { Guild, weekKey, weekEndsAt } from '../server/guild.js';
import { Activity } from '../server/activity.js';
import { biteDelay, rollCatch, junkChance, pickSpecies, isJunk } from '../src/fishdata.js';
import { epochAt } from '../server/profiles.js';
import { pickBoxLocal } from '../src/boxdata.js';
import { PORT } from '../src/lowpoly/havenPlan.js';

function roomFixture() {
  const room = new Room(1, { daily: { top: () => [] }, keep() {}, sessions: new Map() });
  const add = (id) => {
    const p = newPlayer(id, null, 'token-' + id, '測試');
    room.enter(p);
    p.pos = [QUAY_CENTER_W.x, 1.3, QUAY_CENTER_W.z, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];
    return p;
  };
  return { room, p: add(1), guest: add(2) };
}

const tuna = { id: 'tuna', kg: 2, len: 0.8, value: 200 };
const deckFish = (uid, owner, b) => ({ uid, owner, f: tuna, k: 'd', x: 0, y: 0, z: 0, yaw: 0, b });

test('自己的魚、別人的魚或空魚箱留在甲板時，不能換船；清空後可以換', () => {
  const { room, p, guest } = roomFixture();
  p.kit.boats.fisher = { engineLv: 0 };
  const swap = () => room.on(p, { t: 'swap', type: 'fisher' });
  for (const owner of [p.id, guest.id]) {
    room.loose.set(1, deckFish(1, owner, p.id));
    swap();
    assert.equal(p.boat.type, 'skiff');
  }
  room.loose.clear();
  room.boxes.set(1, { k: 'd', b: p.id, fish: [] });
  swap();
  assert.equal(p.boat.type, 'skiff');
  room.boxes.clear();
  swap();
  assert.equal(p.boat.type, 'fisher');
});

test('船沉後，甲板上的散魚不會留給下一艘船，魚箱仍漂浮', () => {
  const { room, p, guest } = roomFixture();
  guest.fish.set(7, tuna);
  room.loose.set(7, deckFish(7, guest.id, p.id));
  const box = { bid: 1, owner: guest.id, k: 'd', b: p.id, x: 0, z: 0, fish: [8] };
  guest.boxes.push(box);
  room.boxes.set(1, box);
  guest.fish.set(8, tuna);
  room.on(p, { t: 'sink', why: 'flood', side: 1 });
  assert.equal(room.loose.size, 0);
  assert.equal(guest.fish.has(7), false);
  assert.equal(guest.fish.has(8), true);
  assert.equal(box.k, 'w');
});

test('船主離線滿三分鐘才回收，仍在船上的乘客帶著手上的魚及自有魚箱回港', () => {
  assert.equal(SERVER.reconnectSec, 180);
  const { room, p: owner, guest } = roomFixture();
  const received = [];
  guest.ws = { readyState: 1, send: (raw) => received.push(JSON.parse(raw)) };
  guest.pos[8] = owner.id;
  guest.hold = ['tuna', tuna.len];
  guest.fish.set(11, tuna);
  guest.fish.set(12, tuna);
  guest.fish.set(13, tuna);
  const hand = { bid: 1, owner: guest.id, k: 'hand', b: 0, fish: [12] };
  const deck = { bid: 2, owner: guest.id, k: 'd', b: owner.id, x: 0, z: 0, fish: [13] };
  guest.boxes.push(hand, deck);
  room.boxes.set(hand.bid, hand);
  room.boxes.set(deck.bid, deck);

  room.quit(owner);
  const droppedAt = owner.gone;
  assert.ok(received.some((m) => m.t === 'leave' && m.reclaimMs > 0 && m.reclaimMs <= GRACE));
  room.step(droppedAt + GRACE - 1);
  assert.equal(guest.pos[8], owner.id);
  assert.equal(room.count, 2);
  room.step(droppedAt + GRACE);

  const returned = received.findIndex((m) => m.t === 'passengerReturn');
  assert.ok(returned >= 0 && returned < received.findIndex((m) => m.t === 'boatGone'));
  assert.equal(room.count, 1);
  assert.equal(guest.pos[8], 0);
  assert.equal(deckY(guest.pos[0], guest.pos[2]), DECK_Y);
  assert.deepEqual(guest.hold, ['tuna', tuna.len]);
  assert.equal(room.resumeData(guest).fish[0].uid, 11);
  assert.equal(hand.k, 'hand');
  assert.equal(deck.k, 'g');
  assert.equal(deckY(deck.x, deck.z), DECK_Y);
  assert.deepEqual(hand.fish, [12]);
  assert.deepEqual(deck.fish, [13]);
});

test('船主及時重連或乘客已下船時，不會觸發回港；離線乘客仍能在重連時回港', () => {
  const { room, p: owner, guest } = roomFixture();
  guest.pos[8] = owner.id;
  room.drop(owner);
  const droppedAt = owner.gone;
  owner.gone = 0;
  room.step(droppedAt + GRACE);
  assert.equal(guest.pos[8], owner.id);
  assert.equal(room.boatInfo(owner).reclaimMs, null);

  guest.pos[8] = 0;
  room.returnPassengers(owner);
  assert.equal(guest.passengerReturn, null);

  guest.pos[8] = owner.id;
  const oldPos = [...guest.pos];
  oldPos[8] = 0;
  // 船在外海，回港前尚未送達的座標封包應被忽略。
  oldPos[0] = 0; oldPos[2] = 0;
  room.remove(owner);
  const landing = guest.passengerReturn;
  assert.ok(landing);
  assert.equal(room.resumeData(guest).passengerReturn, landing);
  room.on(guest, { t: 'p', s: oldPos });
  assert.equal(guest.passengerReturn, landing);
  room.on(guest, { t: 'p', s: [...guest.pos] });
  assert.equal(guest.passengerReturn, null);
});

test('斷線放下魚箱時，甲板用船身座標，在海裡則留下浮箱', () => {
  const { room, p, guest } = roomFixture();
  const box = { bid: 1, owner: p.id, k: 'hand', b: 0, fish: [] };
  p.boxes.push(box);
  room.boxes.set(1, box);
  p.pos[8] = guest.id;
  p.pos[9] = 0.5;
  p.pos[10] = -0.2;
  room.drop(p);
  assert.deepEqual([box.k, box.b, box.x, box.y, box.z], ['d', guest.id, 0.5, 0, -0.2]);
  p.pos[8] = 0;
  p.pos[4] = 4;
  box.k = 'hand';
  room.drop(p);
  assert.equal(box.k, 'w');
  assert.equal(box.y, 0);
});

// ---- 修船、買船、據點 ----
const standOf = (id, site) => ALL_SHELF_W.find((s) => s.id === id && s.site === site).stand;
const stand = (p, id, site) => { const st = standOf(id, site); p.pos = [st.x, 1.3, st.z, 0, 0, 0, 0, 0, 0, 0, 0, '', '']; };

test('修船台：船要停進船塢、照損壞收費、一次修滿；完好不收錢', () => {
  const { room, p } = roomFixture();
  const sent = [];
  p.ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) };
  stand(p, 'repair', 'yard');
  p.kit.money = 1000;
  p.boat.s[11] = 0.5; p.boat.cracks = [[0, 0, 10], [1, 0, 10], [2, 0, 10]];
  room.on(p, { t: 'repairBoat' });
  assert.equal(p.kit.money, 1000, '船還停在母港：修不到');
  p.boat.s[0] = SITES.yard.x; p.boat.s[1] = SITES.yard.z;
  const cost = repairCost('skiff', 0.5, 3);
  assert.equal(cost, Math.round(30 * 2.5 + 3 * 30));
  room.on(p, { t: 'repairBoat' });
  assert.equal(p.kit.money, 1000 - cost);
  assert.equal(p.boat.s[11], 1);
  assert.deepEqual(p.boat.cracks, []);
  assert.ok(sent.some((m) => m.t === 'repaired' && m.cost === cost));
  room.on(p, { t: 'repairBoat' });
  assert.equal(p.kit.money, 1000 - cost, '完好的船不收錢');
  assert.equal(repairCost('trawler', 0.99, 0), Math.max(50, Math.round(2.4 * 2.5)), '小損也收最低價');
  assert.equal(repairCost('fisher', 1, 0), 0);
});

test('母港不賣船務；在修船屋買新船：原地換船、舊船進倉庫、停進修船屋的泊位', () => {
  const { room, p } = roomFixture();
  p.kit.money = 20000;
  room.on(p, { t: 'buy', id: 'fisher' });
  assert.equal(p.kit.boats.fisher, undefined, '人在母港買不到船');
  assert.equal(shopItem('mod_sonar', newKit()).why, 'boat', '只有小舢舨裝不了聲納');
  assert.equal(shopItem('wrench', newKit()).price, null);
  stand(p, 'fisher', 'yard');
  p.boat.s[10] = 7;
  room.on(p, { t: 'buy', id: 'fisher' });
  assert.equal(p.kit.active, 'fisher');
  assert.equal(p.kit.money, 20000 - BOAT_TYPES.fisher.price);
  assert.equal(p.boat.type, 'fisher');
  assert.equal(p.stored.skiff.fuel, 7);
  assert.equal(BERTHS[p.berth].site, 'yard');
  assert.equal(p.kit.boats.fisher.engineLv, 0);
  room.on(p, { t: 'buy', id: 'mod_lamp' });
  assert.equal(p.kit.mods.lamp, false, '集魚燈要站在它的攤位前');
  stand(p, 'mod_lamp', 'haven');
  room.on(p, { t: 'buy', id: 'mod_lamp' });
  assert.equal(p.kit.mods.lamp, true);
});

test('誘魚桶帶得了幾桶看現在這艘船', () => {
  const kit = newKit();
  kit.chum = BOAT_TYPES.skiff.maxChums;
  assert.equal(shopItem('chum', kit).price, null);
  kit.boats.trawler = { engineLv: 0 }; kit.active = 'trawler';
  assert.equal(shopItem('chum', kit).price, CHUM_SPEC.price);
  kit.chum = CHUM_SPEC.max;
  assert.equal(shopItem('chum', kit).price, null);
});

// ---- 漁會：每週捐款榜、稱號、等級 ----
function guildFixture() {
  const guild = new Guild(null), rooms = new Map();
  const hub = { daily: { top: () => [], offer: () => -1 }, keep() {}, sessions: new Map(), guild, activity: new Activity('.', { off: true }), eachRoom(fn) { for (const r of rooms.values()) fn(r); } };
  const room = new Room(1, hub);
  rooms.set(1, room);
  const add = (id, name) => {
    const p = newPlayer(id, null, 'token-' + id, name);
    p.inbox = [];
    p.ws = { readyState: 1, send: (raw) => p.inbox.push(JSON.parse(raw)) };
    room.enter(p);
    p.pos = [QUAY_CENTER_W.x, 1.3, QUAY_CENTER_W.z, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];
    return p;
  };
  return { hub, guild, room, a: add(1, '阿明'), b: add(2, '小華'), c: add(3, '老陳'), d: add(4, '阿珠') };
}

test('換週的時間點：台灣時間週一早上 5 點', () => {
  const mon5 = Date.UTC(2026, 10, 15, 21, 0, 0);   // 2026-11-16（一）05:00 UTC+8
  assert.equal(weekKey(mon5 - 1) + 1, weekKey(mon5));
  assert.equal(weekKey(mon5), weekKey(mon5 + 7 * 86400000 - 1));
  assert.equal(weekEndsAt(mon5), mon5 + 7 * 86400000);
  assert.equal(weekEndsAt(mon5 - 1), mon5);
});

test('捐款：要站在捐款箱前、最少 $100、累積上榜；稱號照門檻和名次給，被超過就換人；換週清空', () => {
  const { guild, room, a, b } = guildFixture();
  a.kit.money = 100000; b.kit.money = 100000;
  room.on(a, { t: 'donate', amount: 5000 });
  assert.equal(a.kit.money, 100000, '不在捐款箱前不能捐');
  stand(a, 'title', 'home'); stand(b, 'title', 'haven');
  room.on(a, { t: 'donate', amount: GUILD.min - 1 });
  room.on(a, { t: 'donate', amount: 200000 });
  assert.equal(a.kit.money, 100000, '太少、錢不夠都不收');
  room.on(a, { t: 'donate', amount: 5000.9 });
  assert.equal(a.kit.money, 95000);
  assert.deepEqual(guild.info(a.token), { amount: 5000, rank: 1, titles: ['碼頭釣客'], wear: '碼頭釣客' });
  assert.equal(a.wearTitle, '碼頭釣客', '第一次解鎖自動戴上');
  room.on(a, { t: 'donate', amount: 25000 });
  assert.deepEqual(guild.info(a.token).titles, ['碼頭釣客', '海釣熟手', '老討海人', '👑 漁會會長']);
  assert.equal(a.wearTitle, '碼頭釣客', '已經戴著的不會被換掉');
  room.on(a, { t: 'wear', title: '👑 漁會會長' });
  assert.equal(a.wearTitle, '👑 漁會會長');
  assert.equal(room.roster(b).find((r) => r.id === a.id).gold, true);
  room.on(b, { t: 'wear', title: '👑 漁會會長' });
  assert.equal(b.wearTitle || '', '', '沒有的稱號戴不上');
  // 小華超過阿明：會長易主，阿明掉到第二名（滿 2 萬）變總幹事，原本戴的會長自動拿掉
  room.on(b, { t: 'donate', amount: 40000 });
  assert.equal(guild.info(b.token).rank, 1);
  assert.ok(guild.info(b.token).titles.includes('👑 漁會會長'));
  assert.equal(a.wearTitle, '', '被超過，特殊稱號收回');
  assert.ok(guild.info(a.token).titles.includes('🎣 漁會總幹事'));
  assert.deepEqual(room.boards().donate.map((e) => [e.name, e.amount]), [['小華', 40000], ['阿明', 30000]]);
  assert.ok(!JSON.stringify(room.boards()).includes('token-'), '榜上不放登入代碼');
  // 改名不掉榜
  guild.rename(a.token, '阿明改名');
  assert.equal(room.boards().donate[1].name, '阿明改名');
  assert.deepEqual(titlesFor(60000, 4), ['碼頭釣客', '海釣熟手', '老討海人', '資深船長']);
  // 換週：全部清空
  assert.equal(guild.roll(weekEndsAt()), true);
  assert.deepEqual(guild.info(b.token), { amount: 0, rank: 0, titles: [], wear: '' });
  assert.deepEqual(room.boards().donate, []);
});

test('等級：經驗公式、捐款和賣魚給經驗、同隊在線多一成半', () => {
  assert.deepEqual(levelOf(0), { lv: 1, into: 0, need: 100 });
  assert.deepEqual(levelOf(100), { lv: 2, into: 0, need: 240 });
  assert.equal(LEVEL.need(3), 80 * 3 + 20 * 9);
  const { room, a, b } = guildFixture();
  stand(a, 'title', 'home');
  a.kit.money = 50000;
  room.on(a, { t: 'donate', amount: 10000 });
  assert.equal(a.dex._lv.exp, 10000 * LEVEL.donate);
  assert.equal(room.roster(b).find((r) => r.id === a.id).lv, levelOf(200).lv);
  a.party = b.party = 7;
  room.on(a, { t: 'donate', amount: 10000 });
  assert.equal(a.dex._lv.exp, 200 + Math.round(200 * (1 + LEVEL.party)));
});

// ---- 船隊、分紅、副駕、拖船 ----
const lastOf = (p, t) => p.inbox.filter((m) => m.t === t).at(-1);
function team(f, ...ps) {
  for (const q of ps.slice(1)) {
    f.room.on(ps[0], { t: 'partyInvite', to: q.id });
    f.room.on(q, { t: 'askAns', aid: lastOf(q, 'ask').aid, yes: true });
  }
}

test('船隊：邀請要對方同意、人數上限、退隊剩一人就解散', () => {
  const f = guildFixture(), { room, a, b, c, d } = f;
  const join = (id, name) => { const q = newPlayer(id, null, 'token-' + id, name); q.inbox = []; q.ws = { readyState: 1, send: (raw) => q.inbox.push(JSON.parse(raw)) }; room.enter(q); return q; };
  const more = [];
  for (let i = 5; i <= PARTY.max; i++) more.push(join(i, `第${i}人`));
  room.on(a, { t: 'partyInvite', to: b.id });
  assert.equal(lastOf(b, 'ask').kind, 'party');
  room.on(b, { t: 'askAns', aid: lastOf(b, 'ask').aid, yes: false });
  assert.equal(b.party || 0, 0);
  team(f, a, b, c, d, ...more);
  assert.ok(a.party && [b, c, d, ...more].every((q) => q.party === a.party));
  const e = join(PARTY.max + 1, '多一人');
  room.on(a, { t: 'partyInvite', to: e.id });
  assert.equal(lastOf(e, 'ask'), undefined, `滿 ${PARTY.max} 人不能再邀`);
  for (const q of [d, c, ...more]) room.on(q, { t: 'partyLeave' });
  assert.equal(a.party, b.party);
  room.quit(b);
  assert.equal(a.party, 0, '只剩一個人：解散');
});

test('賣魚：大漁船的急凍魚艙全隊共享、隊友拿分紅、大港再加成', () => {
  const f = guildFixture(), { room, a, b, c } = f;
  team(f, a, b);
  b.boat.type = 'trawler';   // 隊友開著遠洋大漁船
  const sell = (p, value) => {
    p.fish.set(900, { id: 'tuna', kg: 2, len: 0.8, value });
    p.pos = [HAVEN_SELL_W.x, 1.3, HAVEN_SELL_W.z, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];
    const m0 = p.kit.money;
    room.on(p, { t: 'sell', at: 'haven', uids: [900] });
    return p.kit.money - m0;
  };
  const got = sell(a, 1000);
  assert.equal(got, Math.round(1000 * (1 + 0.15 + BOAT_TYPES.trawler.freshBonus)));
  assert.equal(lastOf(b, 'partyBonus').amount, Math.round(got * PARTY.share));
  assert.equal(b.kit.money, Math.round(got * PARTY.share));
  assert.equal(sell(c, 1000), 1150, '沒組隊：只有大港的加成');
  assert.equal(c.inbox.some((m) => m.t === 'partyBonus'), false);
});

test('副駕：同隊、站在船上、船主沒掌舵才接得了；船主一握方向盤就收回', () => {
  const f = guildFixture(), { room, a, b, c } = f;
  const aboard = (p, owner) => { p.pos = [owner.boat.s[0], 1.3, owner.boat.s[1], 0, 0, 0, 0, 0, owner.id, 0, 0, '', '']; };
  aboard(b, a); aboard(c, a);
  room.on(b, { t: 'helm', forId: a.id, on: true });
  assert.equal(a.boat.pilot || 0, 0, '不同隊不能開');
  team(f, a, b);
  room.on(b, { t: 'helm', forId: a.id, on: true });
  assert.equal(a.boat.pilot, b.id);
  const s = [...a.boat.s]; s[0] += 3;
  room.on(c, { t: 'b', forId: a.id, s });
  assert.notEqual(a.boat.s[0], s[0], '不是副駕的人送來的不收');
  room.on(a, { t: 'b', s });
  assert.notEqual(a.boat.s[0], s[0], '副駕開著的時候，船主自己送的位置不收');
  room.on(b, { t: 'b', forId: a.id, s });
  assert.equal(a.boat.s[0], s[0]);
  const helm = [...b.pos]; helm[4] = 32;
  room.on(b, { t: 'p', s: helm });
  assert.equal(b.pos[4], 32, '副駕可以是掌舵中');
  room.on(a, { t: 'helm', on: true });
  assert.equal(a.boat.pilot, 0);
  assert.equal(lastOf(b, 'pilotEnd').forId, a.id);
  room.on(b, { t: 'b', forId: a.id, s: [...s.slice(0, 1).map((v) => v + 5), ...s.slice(1)] });
  assert.equal(a.boat.s[0], s[0], '收回之後副駕送的不收');
});

test('拖船：要夠近、要對方同意、一艘只拖一艘；任一邊能解、離太遠會斷', () => {
  const f = guildFixture(), { room, a, b, c } = f;
  const put = (p, x, z, h = 0) => { p.boat.s[0] = x; p.boat.s[1] = z; p.boat.s[2] = h; };
  put(a, 0, 0); put(b, -200, 0); put(c, -14, 3);
  room.on(a, { t: 'towAsk', to: b.id });
  assert.equal(lastOf(b, 'ask'), undefined, `超過 ${TOW.reach} 公尺不能拖`);
  put(b, -12, 0);
  b.boat.moor = 3;
  room.on(a, { t: 'towAsk', to: b.id });
  assert.equal(lastOf(b, 'ask').kind, 'tow');
  room.on(b, { t: 'askAns', aid: lastOf(b, 'ask').aid, yes: true });
  assert.deepEqual(room.tows, [{ tug: a.id, tow: b.id }]);
  assert.equal(b.boat.moor, -1, '被拖的船岸上的纜繩自動解開');
  room.on(c, { t: 'towAsk', to: b.id, me: true });
  assert.equal(lastOf(b, 'ask').kind, 'tow');
  assert.equal(room.asks.size, 0, '已經在拖的船不能再接一條');
  room.on(b, { t: 'towCut' });
  assert.equal(room.tows.length, 0);
  // 請對方拖我（me）：我是被拖的
  room.on(c, { t: 'towAsk', to: a.id, me: true });
  room.on(a, { t: 'askAns', aid: lastOf(a, 'ask').aid, yes: true });
  assert.deepEqual(room.tows, [{ tug: a.id, tow: c.id }]);
  put(c, -200, 0);
  for (let i = 0; i < 12; i++) room.step(Date.now() + i * 100);
  assert.equal(room.tows.length, 0, '離太遠：繃斷');
});

test('意見信箱：要站在郵筒前、分類和字數要對、一分鐘只收一則', () => {
  const { hub, room, a } = guildFixture();
  room.on(a, { t: 'feedback', kind: 'bug', text: '魚卡在碼頭下面' });
  assert.equal(hub.activity.fb.length, 0, '不在郵筒前不收');
  stand(a, 'mailbox', 'home');
  room.on(a, { t: 'feedback', kind: 'spam', text: 'x' });
  room.on(a, { t: 'feedback', kind: 'idea', text: '   ' });
  room.on(a, { t: 'feedback', kind: 'idea', text: '字'.repeat(FEEDBACK.maxLen + 1) });
  assert.equal(hub.activity.fb.length, 0);
  room.on(a, { t: 'feedback', kind: 'idea', text: '想要可以養魚的水族箱\u0007<b>' });
  assert.equal(lastOf(a, 'feedbackOk').t, 'feedbackOk');
  const e = hub.activity.fb[0];
  assert.deepEqual(Object.keys(e).sort(), ['at', 'kind', 'name', 'pid', 'text']);
  assert.equal(e.text, '想要可以養魚的水族箱 <b>');
  assert.ok(!JSON.stringify(e).includes('token-'), '不存登入代碼');
  room.on(a, { t: 'feedback', kind: 'bug', text: '再投一則' });
  assert.equal(hub.activity.fb.length, 1, `${FEEDBACK.cdSec} 秒內只收一則`);
  assert.equal(hub.activity.report().feedback.length, 1);
});

function fishFixture() {
  const scene = new THREE.Scene();
  const player = { carry: false, mesh: new THREE.Group() };
  const fish = new FishWorld({ player, scene, basket: SELL_W.basket });
  const boat = { mesh: new THREE.Group(), spec: { deck: 1 } };
  // 此處測持有權與擺位，不需載入魚的材質與 Canvas。
  fish.spawnHeld = (id, kg, len, uid, value) => {
    const it = { id, kg, len, uid, value, thick: 0.1, mesh: new THREE.Group() };
    fish._hold(it);
    return it;
  };
  return { fish, boat };
}

test('重連會補回漏收的漁獲、移除已售魚，也不會複製手上或籃中的魚', () => {
  const { fish, boat } = fishFixture();
  fish.spawnHeld('tuna', 2, 0.8, 1, 200);
  const privateFish = [{ ...tuna, uid: 2 }];
  fish.reconcileOwn(privateFish, [], 1, boat);
  assert.equal(fish.held, null);
  assert.deepEqual(fish.items.map((it) => it.uid), [2]);
  fish.reconcileOwn(privateFish, [], 1, boat);
  assert.deepEqual(fish.items.map((it) => it.uid), [2]);
  fish.spawnHeld('tuna', 2, 0.8, 3, 200);
  fish.reconcileOwn(privateFish, [{ ...tuna, uid: 3, o: 1, k: 'b' }], 1, boat);
  assert.equal(fish.held, null);
  assert.deepEqual(fish.basket.map((it) => it.uid), [3]);
});

test('大量漁獲堆在收購籃時，高度仍能通過伺服器驗證', () => {
  const { fish } = fishFixture(), { room, p } = roomFixture();
  p.pos[0] = SELL_W.basket.x; p.pos[2] = SELL_W.basket.z;
  for (let uid = 1; uid <= 100; uid++) {
    const it = fish.spawnHeld('tuna', 2, 0.8, uid, 200);
    fish.toBasket();
    p.fish.set(uid, tuna);
    const { x, y, z } = it.mesh.position;
    room.on(p, { t: 'put', uid, k: 'b', x, y, z, yaw: 0 });
  }
  assert.equal(room.loose.size, 100);
});

test('開發者模式連續點擊不同海上事件（含進行中的漩渦／暴風雨）時會先清除前一個並成功切換', async () => {
  const prev = process.env.STORMCAST_DEV;
  process.env.STORMCAST_DEV = '1';
  try {
    const devRoomMod = await import('../server/room.js?dev=1');
    const room = new devRoomMod.Room(99, { daily: { top: () => [] }, keep() {}, sessions: new Map() });
    const sent = [];
    const p = devRoomMod.newPlayer(1, { readyState: 1, bufferedAmount: 0, send: (raw) => sent.push(JSON.parse(raw)), terminate() {} }, 't'.repeat(32), '測試');
    room.enter(p);
    p.pos = [QUAY_CENTER_W.x, 1.3, QUAY_CENTER_W.z, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];

    const expectPhase = { whirl: 'whirl', storm: 'storm', thunder: 'thunder', spout: 'storm', tsunami: 'omen', typhoon: 'brew' };
    for (const kind of ['whirl', 'storm', 'thunder', 'spout', 'tsunami', 'typhoon', 'whirl']) {
      room.on(p, { t: 'dev', cmd: 'event', kind });
      assert.equal(room.sea.phase, expectPhase[kind], `${kind} 應順利觸發`);
      assert.ok(room.sea.ev && Number.isFinite(room.sea.ev.x) && Number.isFinite(room.sea.ev.z), `${kind} 應記錄地圖觸發座標`);
      if (kind === 'spout') assert.ok(room.sea.vortices.some((v) => v.kind === 'spout'), '水龍捲觸發後應立刻產生座標以供地圖標記');
      const lastSys = sent.filter((m) => m.t === 'sys').at(-1);
      assert.equal(lastSys.text, `（測試）引發了 ${kind}`, `${kind} 不應顯示「現在引發不了」`);
    }
    room.on(p, { t: 'dev', cmd: 'calm' });
    assert.equal(room.sea.ev, null, '恢復平靜後應清除事件標記');
  } finally {
    if (prev === undefined) delete process.env.STORMCAST_DEV; else process.env.STORMCAST_DEV = prev;
  }
});

test('魚箱 OBB 準心可對準箱壁角落與兩端，且抱箱與拿箱內指定魚互不干擾', () => {
  const norm = (dx, dy, dz) => { const l = Math.hypot(dx, dy, dz); return [dx / l, dy / l, dz / l]; };
  const rayFrom = (ox, oy, oz, tx, ty, tz, tMin = 0) => {
    const [dx, dy, dz] = norm(tx - ox, ty - oy, tz - oz);
    return { ox, oy, oz, dx, dy, dz, tMin };
  };
  const insideFish = [
    { fish: { uid: 10, id: 'sardine' }, name: '沙丁魚', min: [-0.62, 0.04, -0.14], max: [-0.24, 0.16, 0.14] },
    { fish: { uid: 20, id: 'tuna' }, name: '鮪魚', min: [0.15, 0.04, -0.22], max: [0.65, 0.24, 0.22] },
  ];

  // 1) 站在魚箱最右端旁（離中心 2.9m > reach 2.6m，但離箱端 2.1m < 2.6m）且準心瞄向側面木板壁 → 應可對準 fbox
  const hitWall = pickBoxLocal(rayFrom(2.9, 1.25, 0.9, 0.75, 0.35, 0.45), { x: 2.9, y: 0, z: 0.9 }, insideFish, { fp: true, wantOut: true });
  assert.equal(hitWall?.kind, 'fbox');
  assert.equal(hitWall?.off, 0);

  // 2) 站在正面旁望向不透明前木板壁，後方就是鮪魚 → 木板遮擋不該誤拿箱內魚
  const hitFrontPlank = pickBoxLocal(rayFrom(0.4, 1.0, 1.2, 0.4, 0.35, 0.49), { x: 0.4, y: 0, z: 1.2 }, insideFish, { fp: true, wantOut: true });
  assert.equal(hitFrontPlank?.kind, 'fbox');

  // 3) 望進箱口並精準指到左側沙丁魚 vs 右側鮪魚 → 各自拿出指定的那一條魚（fpile）
  const pickLeft = pickBoxLocal(rayFrom(0, 1.25, 0.90, -0.42, 0.10, 0), { x: 0, y: 0, z: 0.90 }, insideFish, { fp: true, wantOut: true });
  assert.equal(pickLeft?.kind, 'fpile');
  assert.equal(pickLeft?.fish.uid, 10);
  const pickRight = pickBoxLocal(rayFrom(0, 1.25, 0.90, 0.40, 0.14, 0), { x: 0, y: 0, z: 0.90 }, insideFish, { fp: true, wantOut: true });
  assert.equal(pickRight?.kind, 'fpile');
  assert.equal(pickRight?.fish.uid, 20);

  // 4) 對準頂部 4cm 實木箱緣（z=0.47）→ 優先抱起魚箱；手持魚放入模式（putOnly）指進開口也回傳 fbox
  const hitRim = pickBoxLocal(rayFrom(0, 1.25, 0.90, 0, 0.64, 0.47), { x: 0, y: 0, z: 0.90 }, insideFish, { fp: true, wantOut: true });
  assert.equal(hitRim?.kind, 'fbox');
  const putFish = pickBoxLocal(rayFrom(0, 1.25, 0.90, 0.40, 0.14, 0), { x: 0, y: 0, z: 0.90 }, insideFish, { fp: true, wantOut: false, putOnly: true });
  assert.equal(putFish?.kind, 'fbox');
});

test('從魚箱拿魚（boxOut）可依指定 uid 取出目標漁獲，未指定時才取最上方', () => {
  const { room, p } = roomFixture();
  const sent = [];
  p.ws = { readyState: 1, bufferedAmount: 0, send: (raw) => sent.push(JSON.parse(raw)), terminate() {} };
  p.fish.set(10, { id: 'sardine', kg: 0.4, len: 0.25, value: 40, by: null });
  p.fish.set(20, { id: 'tuna', kg: 8, len: 1.0, value: 800, by: null });
  p.fish.set(30, { id: 'salmon', kg: 3, len: 0.6, value: 300, by: null });
  const bx = { bid: 99, owner: p.id, fish: [10, 20, 30], k: 'g', x: p.pos[0], y: 0, z: p.pos[2], yaw: 0, b: 0 };
  p.boxes.push(bx);
  room.boxes.set(bx.bid, bx);

  // 指定取出中間那條 uid=10，應精準拿出且不影響其餘兩條順序
  room.on(p, { t: 'boxOut', bid: bx.bid, uid: 10 });
  assert.equal(sent.findLast((m) => m.t === 'boxOut')?.fish.uid, 10);
  assert.deepEqual(bx.fish, [20, 30]);

  // 未指定 uid（舊訊息相容）：取出最末條 uid=30
  room.on(p, { t: 'boxOut', bid: bx.bid });
  assert.equal(sent.findLast((m) => m.t === 'boxOut')?.fish.uid, 30);
  assert.deepEqual(bx.fish, [20]);
});

test('全服刷新改為每週（168 小時），週期文字與期數切換正確', () => {
  assert.equal(SERVER.refresh.everyHours, 168);
  assert.equal(refreshPeriodTag(), '每週');
  assert.equal(refreshRule(), '每週日台灣時間 05:00');
  const midWeek = Date.parse('2026-11-17T04:56:00+08:00');
  assert.equal(epochAt(midWeek), 1);
  assert.equal(nextRefreshAt(midWeek), Date.parse('2026-11-22T05:00:00+08:00'));
  assert.equal(epochAt(Date.parse('2026-11-22T05:00:00+08:00')), 2);
});

test('頂部羅盤角度折疊、距離格式與邊界鎖定計算正確', () => {
  assert.equal(wrap180(350 - 10), -20);
  assert.equal(wrap180(10 - 350), 20);
  assert.equal(compassDist(48.4), '48m');
  assert.equal(compassDist(234), '230m');
  assert.equal(compassDist(1460), '1.5km');
  const aligned = projectCompassX(5, 2, 360, 120);
  assert.equal(aligned.clamped, 0);
  assert.equal(aligned.aligned, true);
  assert.equal(Math.round(aligned.x), 189);
  const rightEdge = projectCompassX(120, 10, 360, 120);
  assert.equal(rightEdge.clamped, 1);
  const leftEdge = projectCompassX(260, 10, 360, 120);
  assert.equal(leftEdge.clamped, -1);
});

test('大漩渦與水龍捲內圈與白浪區向心吸力足以吸走大型漁船，並具強烈繞流與邊界衰減', () => {
  const sea = new Sea();
  sea.vortices = [{ kind: 'whirl', x: 0, z: 0, vx: 0, vz: 0, s: 1, age: 60, life: 200 }];
  const wf120 = sea.flowAt(120, 0);
  assert.ok(-wf120.x > BOAT_TYPES.trawler.speed, `120m 白浪區漩渦吸力應強於滿艙基本大漁船極速 (${(-wf120.x).toFixed(2)})`);
  assert.ok(-wf120.z > 10, `120m 漩渦切線流速應強烈 (${(-wf120.z).toFixed(2)})`);
  assert.ok(-sea.flowAt(85, 0).x > BOAT_TYPES.trawler.speed * 1.75, '85m 內圈吸力應壓過滿改大漁船極速');
  assert.ok(Math.abs(wf120.spin) > 0.1);
  assert.equal(sea.whirlNear(120, 0).r, 120);
  assert.equal(sea.coreAt(VORTEX.whirl.core - 2, 0), 'whirl');
  assert.equal(sea.flowAt(VORTEX.whirl.far + 10, 0).x, 0);

  sea.vortices = [{ kind: 'spout', x: 0, z: 0, vx: 0, vz: 0, s: 1, age: 40, life: 140 }];
  const sf105 = sea.flowAt(VORTEX.spout.rc, 0);
  assert.ok(-sf105.x > BOAT_TYPES.trawler.speed * 1.75, `水龍捲風牆吸力應壓過滿改大漁船極速 (${(-sf105.x).toFixed(2)})`);
  assert.ok(-sf105.z > 18, `水龍捲切線速度應極強 (${(-sf105.z).toFixed(2)})`);
  assert.ok(Math.hypot(sf105.wx, sf105.wz) > 0.5, '水龍捲風圈應產生顯著側風');
  assert.ok(sf105.spin > 0.6);
  assert.equal(sea.spoutNear(50, 0).r, 50);
  assert.equal(sea.coreAt(VORTEX.spout.core - 2, 0), 'spout');
  assert.equal(sea.flowAt(VORTEX.spout.far + 10, 0).x, 0);
});

test('黃金魚潮倒數 3 分鐘後生效 10 分鐘且不限尾數、無驚嚇懲罰、誘魚桶不疊加', () => {
  const { room, p } = roomFixture();
  const sent = [];
  p.ws = { readyState: 1, bufferedAmount: 0, send: (raw) => sent.push(JSON.parse(raw)), terminate() {} };
  p.kit.money = 10000;
  assert.equal(BLESSINGS.tide.name, '黃金魚潮');
  assert.equal(BLESSINGS.tide.duration, 600);

  // 1) 購買黃金魚潮：立刻扣款並進入 180 秒倒數，不會當場啟動
  room.on(p, { t: 'buy', id: 'bless_tide' });
  assert.equal(p.kit.money, 10000 - BLESSINGS.tide.price);
  const ws0 = room.worldState(room.pendingBless.tide - 10000);
  assert.equal(ws0.blessingLeft, 0);
  assert.equal(ws0.tideWait, 10);
  assert.equal(ws0.spots, undefined);
  assert.equal(room.extras.hot, null);

  // 2) 重複購買擋下；倒數結束後生效 10 分鐘，熱點為不限尾數
  room.on(p, { t: 'buy', id: 'bless_tide' });
  assert.equal(p.kit.money, 10000 - BLESSINGS.tide.price);
  const fireAt = room.pendingBless.tide + 50;
  room.step(fireAt);
  const ws1 = room.worldState(fireAt);
  assert.equal(ws1.tideWait, 0);
  assert.ok(ws1.blessingLeft >= 599);
  assert.equal(room.extras.hot.unlimited, true);
  assert.equal(ws1.extras.hot.count, null);
  for (let i = 0; i < 20; i++) {
    assert.equal(room.extras.consumeHot(room.extras.hot.x, room.extras.hot.z), false);
  }
  assert.ok(room.extras.hot !== null);

  // 3) 誘魚桶不重疊於黃金魚群／現有誘魚桶，且黃金魚潮期間不與誘魚桶疊加或扣配額
  p.kit.chum = 2;
  const hx = room.extras.hot.x, hz = room.extras.hot.z;
  p.pos = [hx, 1, hz, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];
  room.on(p, { t: 'useChum', x: hx, z: hz });
  assert.equal(p.kit.chum, 2);
  const [cx, cz] = [[320, 320], [-320, 320], [320, -320], [-320, -320]].find(([x, z]) => isWater(x, z) && Math.hypot(x - hx, z - hz) > 120);
  p.pos = [cx, 1, cz, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];
  room.on(p, { t: 'useChum', x: cx, z: cz });
  assert.equal(p.kit.chum, 1);
  assert.equal(room.extras.chums.length, 1);
  room.on(p, { t: 'useChum', x: cx, z: cz });
  assert.equal(p.kit.chum, 1);
  room.extras.consumeHot(cx, cz, { skipChum: true });
  assert.equal(room.extras.chums[0].count, CHUM_SPEC.quota);

  // 4) 風暴海神祭同樣先倒數 180 秒後才觸發風暴
  room.on(p, { t: 'buy', id: 'bless_storm' });
  assert.equal(room.sea.phase, 'calm');
  const stormFireAt = room.pendingBless.storm + 50;
  room.step(stormFireAt);
  assert.equal(room.worldState(stormFireAt).stormWait, 0);
  assert.equal(room.sea.phase, 'storm');

  // 5) 海面驚嚇已移除：同點即使傳入舊參數亦不延長咬餌時間
  assert.equal(room.fishSpots, undefined);
  const origRand = Math.random;
  Math.random = () => 0.5;
  try {
    assert.equal(biteDelay({ hot: true }), biteDelay({ hot: true, fatigue: 5 }));
  } finally {
    Math.random = origRand;
  }
});

test('漩渦／水龍捲外圍垂釣與消散後均提供對應高風險獎勵，且不覆蓋黃金魚群', () => {
  const { room, p } = roomFixture();
  p.ws = { readyState: 1, bufferedAmount: 0, send() {}, terminate() {} };

  // 1) 渦流外圍危險圈可觸發 vortexBonusAt 並加大 rollCatch 體型
  room.sea.vortices = [{ kind: 'whirl', x: 300, z: 300, vx: 0, vz: 0, s: 0.9, age: 80, life: 120 }];
  assert.equal(room.sea.vortexBonusAt(480, 300), true);
  assert.equal(room.sea.vortexBonusAt(700, 300), false);
  const origRand = Math.random;
  Math.random = () => 0.5;
  try {
    const base = rollCatch({ depth: 30, island: 'haven', off: 300, night: false, rough: 0 });
    const boosted = rollCatch({ depth: 30, island: 'haven', off: 300, night: false, rough: 0, vortex: true });
    assert.ok(boosted.kg >= base.kg);
  } finally {
    Math.random = origRand;
  }

  // 2) 漩渦壽命屆滿消散時於 step 產生消散魚群與 2 個漂流寶箱
  room.sea.vortices[0].age = 121;
  room.step(Date.now() + 100);
  assert.equal(room.sea.vortices.length, 0);
  assert.equal(room.extras.chests.length, 2);
  assert.ok(room.extras.hot && room.extras.hot.count === 14 && !room.extras.hot.unlimited);

  // 3) 若正在進行不限尾數黃金魚群，後續水龍捲消散只多給寶箱而不覆蓋黃金魚群
  room.extras.spawnHotspotNow(600, true);
  const goldHot = room.extras.hot;
  room.sea.vortices = [{ kind: 'spout', x: -300, z: 300, vx: 0, vz: 0, s: 0.9, age: 121, life: 120 }];
  room.step(Date.now() + 200);
  assert.equal(room.extras.hot, goldHot);
  assert.equal(room.extras.chests.length, 4);
});

test('透天洞穴與高山小河加入雜物機率，並能抽出對應秘境雜物', () => {
  assert.ok(junkChance({ zone: 'cave', off: 20, storm: null }) > 0);
  assert.ok(junkChance({ zone: 'river', off: 10, storm: null }) > 0);
  const origRand = Math.random;
  Math.random = () => 0.01;
  try {
    assert.equal(isJunk(pickSpecies(12, 'haven', 20, false, 'cave')), true);
    assert.equal(isJunk(pickSpecies(4, 'haven', 10, false, 'river')), true);
  } finally {
    Math.random = origRand;
  }
});
