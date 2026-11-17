// 伺服器端多人流程整合測試：船隊、賣魚分紅、拖船、副駕、漁會、等級、意見信箱、修船、誘魚桶、看板、亂送訊息。
// 全部在同一個行程裡建房間、放假玩家（ws 是假的，訊息收進 p.inbox）。
// 寫法照 tools/gameplay.test.js。測到失敗的不硬改到通過：失敗代表伺服器行為跟預期不同，見報告。
import assert from 'node:assert/strict';
import test from 'node:test';
import { Room, newPlayer, GRACE } from '../server/room.js';
import { Guild, weekEndsAt, gainExp, expOf } from '../server/guild.js';
import { expireAsks, stepTows, towOf } from '../server/party.js';
import { Activity } from '../server/activity.js';
import { QUAY_CENTER_W, ALL_SHELF_W, SITES, HAVEN_SELL_W, SELL_W } from '../src/layout.js';
import { GUILD, LEVEL, PARTY, TOW, FEEDBACK, levelOf } from '../src/config.js';
import { BOAT_TYPES, CHUM_SPEC, repairCost } from '../src/boatdata.js';

// ---- 共用 ----
function fixture(n = 4) {
  const guild = new Guild(null), rooms = new Map();
  let clock = 1_000_000;
  const hub = {
    daily: { top: () => [], offer: () => -1 }, keep() {}, sessions: new Map(), guild,
    activity: new Activity('.', { off: true, now: () => clock }),
    eachRoom(fn) { for (const r of rooms.values()) fn(r); },
  };
  const room = new Room(1, hub);
  rooms.set(1, room);
  const names = ['阿明', '小華', '老陳', '阿珠', '第五人'];
  const add = (id, r = room) => {
    const p = newPlayer(id, null, 'token-' + id, names[id - 1] || '玩家' + id);
    p.inbox = [];
    p.ws = { readyState: 1, send: (raw) => p.inbox.push(JSON.parse(raw)) };
    r.enter(p);
    p.pos = [QUAY_CENTER_W.x, 1.3, QUAY_CENTER_W.z, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];
    return p;
  };
  const ps = [];
  for (let i = 1; i <= n; i++) ps.push(add(i));
  return { hub, guild, room, rooms, add, ps, tick: (ms) => { clock += ms; } };
}
const lastOf = (p, t) => p.inbox.filter((m) => m.t === t).at(-1);
const countOf = (p, t) => p.inbox.filter((m) => m.t === t).length;
const clear = (...ps) => { for (const p of ps) p.inbox.length = 0; };
function team(room, lead, ...rest) {
  for (const q of rest) {
    room.on(lead, { t: 'partyInvite', to: q.id });
    const ask = lastOf(q, 'ask');
    assert.ok(ask && ask.kind === 'party', `${q.name} 應收到邀請`);
    room.on(q, { t: 'askAns', aid: ask.aid, yes: true });
  }
}
const standOf = (id, site) => ALL_SHELF_W.find((s) => s.id === id && s.site === site).stand;
const stand = (p, id, site) => { const st = standOf(id, site); p.pos = [st.x, 1.3, st.z, 0, 0, 0, 0, 0, 0, 0, 0, '', '']; };
const putBoat = (p, x, z, h = 0) => { p.boat.s[0] = x; p.boat.s[1] = z; p.boat.s[2] = h; };
const aboard = (p, owner, flags = 0) => { p.pos = [owner.boat.s[0], 1.3, owner.boat.s[1], 0, flags, 0, 0, 0, owner.id, 0, 0, '', '']; };
const offline = (room, p) => room.drop(p);
const boatMsg = (owner, dx = 0) => { const s = [...owner.boat.s]; s[0] += dx; return s; };
const tuna = (value) => ({ id: 'tuna', kg: 2, len: 0.8, value });

// ======================= 船隊 =======================
test('船隊：邀請→同意、拒絕、逾時（逾時後舊的 aid 不能再用）', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  room.on(a, { t: 'partyInvite', to: b.id });
  const ask = lastOf(b, 'ask');
  room.on(b, { t: 'askAns', aid: ask.aid, yes: false });
  assert.equal(b.party || 0, 0);
  assert.ok(a.inbox.some((m) => m.t === 'sys' && m.text.includes('婉拒')));
  // 逾時
  room.on(a, { t: 'partyInvite', to: c.id });
  const ask2 = lastOf(c, 'ask');
  expireAsks(room, Date.now() + (PARTY.askSec + 2) * 1000);
  assert.equal(room.asks.size, 0);
  assert.ok(lastOf(c, 'askGone')?.aid === ask2.aid, '被邀請的人要收到 askGone');
  room.on(c, { t: 'askAns', aid: ask2.aid, yes: true });
  assert.equal(c.party || 0, 0, '過期的邀請不能再同意');
  // 同意
  team(room, a, b);
  assert.ok(a.party > 0 && a.party === b.party);
  assert.deepEqual(lastOf(c, 'party').of, { [a.id]: a.party, [b.id]: a.party }, '整房都會收到船隊表');
});

test('船隊：滿 4 人不能再邀、對方已在別隊、自己邀自己、邀離線的人', () => {
  const f = fixture(4), { room, ps: [a, b, c, d] } = f;
  const e = f.add(5), g = f.add(6);
  team(room, a, b, c, d);
  clear(e);
  room.on(b, { t: 'partyInvite', to: e.id });   // 隊員（不是發起人）邀也一樣算人數
  assert.equal(lastOf(e, 'ask'), undefined, '滿 4 人不能再邀');
  room.on(e, { t: 'partyInvite', to: a.id });
  assert.equal(lastOf(a, 'ask'), undefined, '對方已在別隊');
  assert.match(lastOf(e, 'no').msg, /別的船隊/);
  room.on(e, { t: 'partyInvite', to: e.id });
  assert.match(lastOf(e, 'no').msg, /找不到/);
  offline(room, g);
  room.on(e, { t: 'partyInvite', to: g.id });
  assert.match(lastOf(e, 'no').msg, /找不到/, '離線的人邀不到');
});

test('船隊：同意前邀請的人已經滿隊／對方已經入別隊 → 不能加入', () => {
  const f = fixture(4), { room, ps: [a, b, c, d] } = f;
  const e = f.add(5);
  team(room, a, b, c);
  room.on(a, { t: 'partyInvite', to: e.id });
  const askE = lastOf(e, 'ask');
  team(room, a, d);   // 在 e 回答之前，滿 4 人了
  room.on(e, { t: 'askAns', aid: askE.aid, yes: true });
  assert.equal(e.party || 0, 0, '對方的隊滿了：不能加入');
  assert.equal([...room.players.values()].filter((p) => p.party === a.party).length, PARTY.max);
});

test('船隊：退隊、剩一人自動解散；斷線保留、按離開／斷線太久退隊', () => {
  const f = fixture(4), { room, ps: [a, b, c, d] } = f;
  team(room, a, b, c);
  room.on(c, { t: 'partyLeave' });
  assert.equal(c.party, 0);
  assert.ok(a.party && a.party === b.party);
  offline(room, b);
  assert.equal(b.party, a.party, '斷線一下：還在隊裡');
  // 斷線太久被收走
  room.remove(b);
  assert.equal(a.party, 0, '只剩一人：解散');
  assert.ok(a.inbox.some((m) => m.t === 'sys' && m.text === '船隊解散了'));
  // 按離開
  team(room, a, c, d);
  room.quit(d);
  assert.equal(d.party, 0);
  assert.equal(a.party, c.party);
  assert.ok(a.party > 0);
  // 退隊訊息重複送不會出錯
  room.on(d, { t: 'partyLeave' });
  room.on(a, { t: 'partyLeave' });
  assert.equal(c.party, 0, '剩一人解散');
});

test('船隊：被併到別間房（enter 非 fresh）就退隊，留在原房的隊友不會變成一人隊', () => {
  const f = fixture(3), { room, ps: [a, b, c] } = f;
  team(room, a, b, c);
  const room2 = new Room(2, f.hub);
  f.rooms.set(2, room2);
  // 模擬 index.js 的 doMerge：只把 a 搬過去（真的合併是整間搬；這裡測 enter 自己的行為）
  room.players.delete(a.id); room.berths.delete(a.berth);
  room2.enter(a, { fresh: false, quiet: true });
  assert.equal(a.party, 0);
});

// ======================= 賣魚 =======================
function sellHaven(room, p, value, uid = 900 + p.id) {
  p.fish.set(uid, tuna(value));
  p.pos = [HAVEN_SELL_W.x, 1.3, HAVEN_SELL_W.z, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];
  const m0 = p.kit.money;
  room.on(p, { t: 'sell', at: 'haven', uids: [uid] });
  return p.kit.money - m0;
}

test('賣魚：分紅給每位在線隊友、急凍魚艙、大港疊加；離線隊友不拿、不重複發', () => {
  const { room, ps: [a, b, c, d] } = fixture(4);
  team(room, a, b, c, d);
  c.boat.type = 'trawler';
  offline(room, d);
  const before = [a, b, c, d].map((p) => p.kit.money);
  const got = sellHaven(room, a, 1000);
  assert.equal(got, Math.round(1000 * (1 + 0.15 + BOAT_TYPES.trawler.freshBonus)));
  const share = Math.round(got * PARTY.share);
  assert.equal(b.kit.money - before[1], share);
  assert.equal(c.kit.money - before[2], share);
  assert.equal(d.kit.money - before[3], 0, '離線的隊友不拿分紅');
  assert.equal(countOf(b, 'partyBonus'), 1);
  // 同一條魚再賣一次：不會再給錢
  const again = (() => { const m0 = a.kit.money; room.on(a, { t: 'sell', at: 'haven', uids: [900 + a.id, 900 + a.id] }); return a.kit.money - m0; })();
  assert.equal(again, 0);
  assert.equal(countOf(b, 'partyBonus'), 1, '空的賣出不發分紅');
});

test('賣魚：大漁船沉了就沒有急凍加成；不在大秤旁不能賣', () => {
  const { room, ps: [a, b] } = fixture(2);
  team(room, a, b);
  b.boat.type = 'trawler'; b.boat.sunk = true;
  assert.equal(sellHaven(room, a, 1000), 1150);
  a.fish.set(77, tuna(1000));
  a.pos = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];
  room.on(a, { t: 'sell', at: 'haven', uids: [77] });
  assert.ok(a.fish.has(77));
});

test('賣魚：母港籃子一次賣兩位隊友的魚，各自付錢、互相分紅、不重複', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  team(room, a, b);
  for (const [p, uid, v] of [[a, 501, 1000], [b, 502, 2000]]) {
    p.fish.set(uid, tuna(v));
    room.loose.set(uid, { uid, owner: p.id, f: p.fish.get(uid), k: 'b', x: SELL_W.basket.x, y: SELL_W.basket.y, z: SELL_W.basket.z, yaw: 0, b: 0, at: Date.now() });
  }
  c.pos = [SELL_W.button.x, 1.3, SELL_W.button.z, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];
  const m = [a, b, c].map((p) => p.kit.money);
  room.on(c, { t: 'sell' });
  assert.equal(a.kit.money - m[0], 1000 + Math.round(2000 * PARTY.share));
  assert.equal(b.kit.money - m[1], 2000 + Math.round(1000 * PARTY.share));
  assert.equal(c.kit.money - m[2], 0, '幫忙按的人（不同隊）不拿錢');
  room.on(c, { t: 'sell' });
  assert.equal(a.kit.money - m[0], 1000 + Math.round(2000 * PARTY.share), '再按一次不會重複發');
});

// ======================= 拖船 =======================
test('拖船：兩個方向的請求 → 同意；纜繩解開；太遠被拒；一艘不能參與兩組', () => {
  const { room, ps: [a, b, c, d] } = fixture(4);
  putBoat(a, 0, 0); putBoat(b, -14, 0); putBoat(c, -200, 0); putBoat(d, -15, 4);
  room.on(a, { t: 'towAsk', to: c.id });
  assert.equal(lastOf(c, 'ask'), undefined, '太遠');
  // 我拖他
  b.boat.moor = 2;
  room.on(a, { t: 'towAsk', to: b.id });
  room.on(b, { t: 'askAns', aid: lastOf(b, 'ask').aid, yes: true });
  assert.deepEqual(room.tows, [{ tug: a.id, tow: b.id }]);
  assert.equal(b.boat.moor, -1);
  assert.ok(lastOf(c, 'tow'), '全房都知道');
  // 第三艘想加進來：兩個方向都不行
  clear(a, b, d);
  room.on(d, { t: 'towAsk', to: a.id, me: true });
  room.on(d, { t: 'towAsk', to: b.id });
  assert.equal(room.asks.size, 0);
  assert.equal(lastOf(a, 'ask'), undefined);
  // 被拖的一方解開
  room.on(b, { t: 'towCut' });
  assert.equal(room.tows.length, 0);
  // 請他拖我（me）
  room.on(d, { t: 'towAsk', to: a.id, me: true });
  room.on(a, { t: 'askAns', aid: lastOf(a, 'ask').aid, yes: true });
  assert.deepEqual(room.tows, [{ tug: a.id, tow: d.id }]);
  // 拖船的一方解開
  room.on(a, { t: 'towCut' });
  assert.equal(room.tows.length, 0);
});

test('拖船：問的時候和答的時候之間船已經被別人拖走 → 不會出現兩組', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  putBoat(a, 0, 0); putBoat(b, -14, 0); putBoat(c, -14, 6);
  room.on(a, { t: 'towAsk', to: b.id });
  const askB = lastOf(b, 'ask');
  room.on(c, { t: 'towAsk', to: a.id });   // c 也要拖 a
  room.on(a, { t: 'askAns', aid: lastOf(a, 'ask').aid, yes: true });
  assert.deepEqual(room.tows, [{ tug: c.id, tow: a.id }]);
  room.on(b, { t: 'askAns', aid: askB.aid, yes: true });
  assert.equal(room.tows.length, 1, 'a 已經被拖：b 那邊同意也不能再連');
});

test('拖船：船沉、離線、離太遠、換船／叫船自動斷；第三人送 towCut 沒效果', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  const link = () => { putBoat(a, 0, 0); putBoat(b, -14, 0); room.on(a, { t: 'towAsk', to: b.id }); room.on(b, { t: 'askAns', aid: lastOf(b, 'ask').aid, yes: true }); assert.equal(room.tows.length, 1); };
  link();
  room.on(c, { t: 'towCut' });
  assert.equal(room.tows.length, 1, '不相干的人解不了');
  room.on(a, { t: 'sink', why: 'flood', side: 1 });
  assert.equal(room.tows.length, 0, '拖船沉了');
  a.boat.sunk = false;
  link();
  offline(room, b);
  assert.equal(room.tows.length, 0, '被拖的離線');
  b.ws = { readyState: 1, send: (raw) => b.inbox.push(JSON.parse(raw)) }; b.gone = 0;
  link();
  putBoat(b, -14 - TOW.snap - 20, 0);
  stepTows(room);
  assert.equal(room.tows.length, 0, '離太遠繃斷');
  assert.match(lastOf(a, 'towCut').why, /繃斷/);
  // 叫船（平板）：拖纜解開
  link();
  a.pos = [QUAY_CENTER_W.x, 1.3, QUAY_CENTER_W.z, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];
  room.on(a, { t: 'call' });
  assert.equal(room.tows.length, 0, '叫船後拖纜解開');
});

test('拖船：幫船主掌舵的副駕可以解船主的拖纜；towOf 找得到兩邊', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  team(room, a, c);
  putBoat(a, 0, 0); putBoat(b, -14, 0);
  room.on(a, { t: 'towAsk', to: b.id });
  room.on(b, { t: 'askAns', aid: lastOf(b, 'ask').aid, yes: true });
  assert.equal(towOf(room, a.id), towOf(room, b.id));
  aboard(c, a); room.on(c, { t: 'helm', forId: a.id, on: true });
  room.on(c, { t: 'towCut' });
  assert.equal(room.tows.length, 0);
});

// ======================= 副駕 =======================
test('副駕：非隊友、不在船上、船主正在掌舵、已有人在開 → 都被拒', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  aboard(b, a);
  room.on(b, { t: 'helm', forId: a.id, on: true });
  assert.equal(a.boat.pilot || 0, 0, '非隊友');
  team(room, a, b, c);
  b.pos[8] = 0;
  room.on(b, { t: 'helm', forId: a.id, on: true });
  assert.equal(a.boat.pilot || 0, 0, '不在那艘船上');
  aboard(b, a);
  a.pos = [a.boat.s[0], 1.3, a.boat.s[1], 0, 32, 0, 0, 0, a.id, 0, 0, '', ''];
  room.on(b, { t: 'helm', forId: a.id, on: true });
  assert.equal(a.boat.pilot || 0, 0, '船主正在掌舵');
  a.pos[4] = 0;
  room.on(b, { t: 'helm', forId: a.id, on: true });
  assert.equal(a.boat.pilot, b.id);
  aboard(c, a);
  room.on(c, { t: 'helm', forId: a.id, on: true });
  assert.equal(a.boat.pilot, b.id, '已經有隊友在開');
});

test('副駕：forId 的 b 更新船主的船；船主自己的 b 被忽略；非副駕的 forId b／sink 不收', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  team(room, a, b);
  aboard(b, a);
  room.on(b, { t: 'helm', forId: a.id, on: true });
  const s = boatMsg(a, 3);
  room.on(b, { t: 'b', forId: a.id, s });
  assert.equal(a.boat.s[0], s[0]);
  room.on(a, { t: 'b', s: boatMsg(a, 50) });
  assert.equal(a.boat.s[0], s[0], '船主自己的 b 被忽略');
  // 非隊友（c）想用 forId 移動或弄沉別人的船
  room.on(c, { t: 'b', forId: a.id, s: boatMsg(a, 40) });
  room.on(c, { t: 'b', forId: b.id, s: boatMsg(b, 40) });
  assert.equal(a.boat.s[0], s[0]);
  room.on(c, { t: 'sink', forId: a.id, why: 'flood', side: 1 });
  room.on(c, { t: 'sink', forId: b.id, why: 'flood', side: 1 });
  assert.equal(a.boat.sunk, false, '非副駕不能弄沉別人的船');
  assert.equal(b.boat.sunk, false);
  assert.equal(c.boat.sunk, false, 'forId 指別人時不能退回去弄沉自己');
  // 副駕回報沉船
  room.on(b, { t: 'sink', forId: a.id, why: 'curl', side: -1 });
  assert.equal(a.boat.sunk, true);
  assert.equal(a.boat.pilot, 0);
  assert.equal(b.boat.sunk, false, '副駕自己的船不受影響');
  assert.ok(lastOf(a, 'sunk'), '船主要收到 sunk');
});

test('副駕：船主送 helm 收回；退隊、副駕離線、船主離線時自動收回', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  const take = () => { aboard(b, a); room.on(b, { t: 'helm', forId: a.id, on: true }); assert.equal(a.boat.pilot, b.id); };
  team(room, a, b, c);
  take();
  room.on(a, { t: 'helm', on: true });
  assert.equal(a.boat.pilot, 0);
  assert.equal(lastOf(b, 'pilotEnd').forId, a.id);
  take();
  room.on(b, { t: 'helm', forId: a.id, on: false });
  assert.equal(a.boat.pilot, 0, '副駕放手');
  take();
  room.on(b, { t: 'partyLeave' });
  assert.equal(a.boat.pilot, 0, '副駕退隊');
  team(room, a, b);
  take();
  room.on(a, { t: 'partyLeave' });   // a 退隊：b、c 還在一隊
  assert.equal(a.boat.pilot, 0, '船主退隊');
  room.on(c, { t: 'partyLeave' });   // 解散，讓 a、b 重新組
  team(room, a, b);
  take();
  offline(room, b);
  assert.equal(a.boat.pilot, 0, '副駕離線');
  b.ws = { readyState: 1, send: (raw) => b.inbox.push(JSON.parse(raw)) }; b.gone = 0;
  take();
  offline(room, a);
  assert.equal(a.boat.pilot, 0, '船主離線');
});

test('副駕：船主斷線寬限中，隊友不能接手他的船（船主不在，船留在原地等他）', () => {
  const { room, ps: [a, b] } = fixture(2);
  team(room, a, b);
  offline(room, a);
  aboard(b, a);
  clear(b);
  room.on(b, { t: 'helm', forId: a.id, on: true });
  assert.equal(a.boat.pilot || 0, 0);
  assert.ok(lastOf(b, 'no'));
  a.ws = { readyState: 1, send: (raw) => a.inbox.push(JSON.parse(raw)) }; a.gone = 0;
  assert.equal(room.snapshot(a).pilot, 0);
});

test('副駕：同一個人不能同時開兩艘隊友的船', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  team(room, a, b, c);
  aboard(c, a); room.on(c, { t: 'helm', forId: a.id, on: true });
  assert.equal(a.boat.pilot, c.id);
  aboard(c, b); room.on(c, { t: 'helm', forId: b.id, on: true });
  assert.ok(!(a.boat.pilot === c.id && b.boat.pilot === c.id), '一個人同時是兩艘船的副駕');
});

test('副駕：被併到別間房（不同隊了）副駕要收回', () => {
  const f = fixture(2), { room, ps: [a, b] } = f;
  team(room, a, b);
  aboard(b, a); room.on(b, { t: 'helm', forId: a.id, on: true });
  const room2 = new Room(2, f.hub); f.rooms.set(2, room2);
  for (const p of [a, b]) { room.players.delete(p.id); room.berths.delete(p.berth); }
  for (const p of [a, b]) room2.enter(p, { fresh: false, quiet: true });
  assert.equal(a.party, 0); assert.equal(b.party, 0);
  assert.equal(a.boat.pilot || 0, 0, '已經不同隊，b 還在開 a 的船');
  room2.on(b, { t: 'b', forId: a.id, s: boatMsg(a, 5) });
  assert.notEqual(a.boat.s[0], boatMsg(a, 5)[0], '不同隊的人還能用 forId 移動別人的船');
});

test('副駕：掌舵旗號 32 只認自己的船或正在開的那艘', () => {
  const { room, ps: [a, b] } = fixture(2);
  team(room, a, b);
  const helmPos = () => [a.boat.s[0], 1.3, a.boat.s[1], 0, 32, 0, 0, 0, a.id, 0, 0, '', ''];
  room.on(b, { t: 'p', s: helmPos() });
  assert.notEqual(b.pos[4], 32);
  aboard(b, a); room.on(b, { t: 'helm', forId: a.id, on: true });
  room.on(b, { t: 'p', s: helmPos() });
  assert.equal(b.pos[4], 32);
});

// ======================= 漁會 =======================
test('漁會捐款：金額下限、上限、錢不夠、不在捐款箱旁、怪值', () => {
  const { room, guild, ps: [a] } = fixture(1);
  a.kit.money = 2_000_000;
  room.on(a, { t: 'donate', amount: 1000 });
  assert.equal(a.kit.money, 2_000_000, '不在捐款箱旁');
  stand(a, 'title', 'home');
  for (const amount of [GUILD.min - 1, GUILD.max + 1, -500, NaN, Infinity, -Infinity, 'abc', null, undefined, {}, [], true]) {
    room.on(a, { t: 'donate', amount });
  }
  assert.equal(a.kit.money, 2_000_000, '怪值都不收');
  room.on(a, { t: 'donate', amount: GUILD.min });
  assert.equal(a.kit.money, 2_000_000 - GUILD.min);
  room.on(a, { t: 'donate', amount: GUILD.max });
  assert.equal(guild.info(a.token).amount, GUILD.min + GUILD.max);
  a.kit.money = 50;
  room.on(a, { t: 'donate', amount: 100 });
  assert.equal(a.kit.money, 50, '錢不夠');
  // 大港的捐款箱也能捐
  a.kit.money = 1000; stand(a, 'title', 'haven');
  room.on(a, { t: 'donate', amount: 100 });
  assert.equal(a.kit.money, 900);
});

test('漁會稱號：解鎖自動配戴、wear 換與拿掉、戴沒解鎖的被拒、前三名易主收回、換週清空、改名', () => {
  const { room, guild, hub, ps: [a, b, c] } = fixture(3);
  for (const p of [a, b, c]) { p.kit.money = 500_000; stand(p, 'title', 'home'); }
  room.on(a, { t: 'donate', amount: 15000 });
  assert.equal(a.wearTitle, '海釣熟手', '一次跨兩級：戴門檻最高的');
  room.on(a, { t: 'wear', title: '' });
  assert.equal(a.wearTitle, '');
  clear(a);
  room.on(a, { t: 'wear', title: '碼頭釣客' });
  assert.equal(a.wearTitle, '', '剛換過：要隔 GUILD.wearCd 秒才能再換');
  assert.ok(lastOf(a, 'no'));
  a.wearAt = 0;
  room.on(a, { t: 'wear', title: '碼頭釣客' });
  assert.equal(a.wearTitle, '碼頭釣客');
  clear(a);
  room.on(a, { t: 'wear', title: '資深船長' });
  assert.equal(a.wearTitle, '碼頭釣客');
  assert.ok(lastOf(a, 'no'));
  for (const title of [123, null, undefined, {}, '__proto__', 'constructor']) room.on(a, { t: 'wear', title });
  assert.equal(a.wearTitle, '碼頭釣客');
  // 第三名的理事
  room.on(a, { t: 'donate', amount: 5000 });   // 2 萬
  room.on(b, { t: 'donate', amount: 30000 });
  room.on(c, { t: 'donate', amount: 25000 });
  a.wearAt = 0;
  room.on(a, { t: 'wear', title: '⚓ 漁會理事' });
  assert.equal(a.wearTitle, '⚓ 漁會理事');
  assert.ok(lastOf(b, 'title'), '同房的人收到稱號變更');
  // 有第四個人超過 a：a 掉到第四名，理事收回
  const d = newPlayer(9, null, 'token-9', '後來者');
  d.inbox = []; d.ws = { readyState: 1, send: (raw) => d.inbox.push(JSON.parse(raw)) };
  room.enter(d); d.kit.money = 100000; stand(d, 'title', 'home');
  room.on(d, { t: 'donate', amount: 21000 });
  assert.equal(guild.info(a.token).rank, 4);
  assert.equal(a.wearTitle, '', '掉出前三名：特殊稱號收回');
  assert.ok(lastOf(c, 'title') && lastOf(c, 'title').id === a.id || c.inbox.some((m) => m.t === 'title' && m.id === a.id && m.title === ''));
  // 改名
  guild.rename(b.token, '小華改名');
  assert.equal(room.boards().donate[0].name, '小華改名');
  // 換週
  assert.equal(guild.roll(weekEndsAt()), true);
  // index.js 換週時會跑 syncTitles；這裡直接叫
  return import('../server/guild.js').then(({ syncTitles }) => {
    syncTitles(hub);
    for (const p of [a, b, c, d]) assert.equal(p.wearTitle, '', '換週後稱號清空');
    assert.deepEqual(room.boards().donate, []);
  });
});

test('漁會：沒戴稱號的人一直送 wear \'\'（什麼都沒變）不該每次都對全服廣播看板', () => {
  const { room, ps: [a, b] } = fixture(2);
  clear(b);
  for (let i = 0; i < 80; i++) room.on(a, { t: 'wear', title: '' });   // 一秒內最多可送 80 則（index.js 的 burst 上限）
  assert.ok(countOf(b, 'boards') <= 1, `別人收到 ${countOf(b, 'boards')} 次看板廣播`);
});

// ======================= 等級 =======================
test('等級：賣魚、捐款給經驗；同隊隊友在線多 15%（離線不算）；升級有訊息', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  sellHaven(room, a, 1000);
  assert.equal(expOf(a), Math.max(1, Math.round(1150 * LEVEL.sell)));
  team(room, a, b);
  const e0 = expOf(a);
  stand(a, 'title', 'home'); a.kit.money = 100000;
  room.on(a, { t: 'donate', amount: 1000 });
  assert.equal(expOf(a) - e0, Math.round(1000 * LEVEL.donate * (1 + LEVEL.party)));
  offline(room, b);
  const e1 = expOf(a);
  room.on(a, { t: 'donate', amount: 1000 });
  assert.equal(expOf(a) - e1, Math.round(1000 * LEVEL.donate), '隊友離線：沒有加成');
  // 升級
  clear(a, c);
  const need = levelOf(expOf(a));
  gainExp(room, a, need.need - need.into);
  assert.equal(lastOf(a, 'exp').up, true);
  assert.equal(lastOf(c, 'lv').id, a.id);
  assert.equal(lastOf(c, 'lv').lv, need.lv + 1);
});

test('等級：gainExp 收到怪值不會把經驗弄成 Infinity（目前只有伺服器內部呼叫）', () => {
  const { room, ps: [a] } = fixture(1);
  for (const v of [0, -5, NaN, 'x', Infinity]) gainExp(room, a, v);
  assert.ok(Number.isFinite(expOf(a)), `經驗變成 ${expOf(a)}`);
});

// ======================= 意見信箱 =======================
test('意見信箱：分類、空字、超過 200 字、控制字元、60 秒冷卻、不在郵筒旁', () => {
  const f = fixture(2), { hub, room, ps: [a, b] } = f;
  room.on(a, { t: 'feedback', kind: 'bug', text: '不在郵筒旁' });
  assert.equal(hub.activity.fb.length, 0);
  stand(a, 'mailbox', 'home');
  for (const [kind, text] of [['spam', 'x'], ['__proto__', 'x'], ['toString', 'x'], [null, 'x'], ['bug', ''], ['bug', ' \u0001\u0002 '], ['bug', 123], ['bug', null], ['bug', ['a']], ['bug', 'x'.repeat(FEEDBACK.maxLen + 1)]]) {
    room.on(a, { t: 'feedback', kind, text });
  }
  assert.equal(hub.activity.fb.length, 0);
  room.on(a, { t: 'feedback', kind: 'perf', text: '🐟'.repeat(FEEDBACK.maxLen) });
  assert.equal(hub.activity.fb.length, 1, '200 個 emoji（照字算）可以');
  f.tick(FEEDBACK.cdSec * 1000 - 1);
  room.on(a, { t: 'feedback', kind: 'bug', text: '太快' });
  assert.equal(hub.activity.fb.length, 1, '冷卻中');
  f.tick(2);
  room.on(a, { t: 'feedback', kind: 'bug', text: 'a\nb\tc\u007f' });
  assert.equal(hub.activity.fb.length, 2);
  assert.equal(hub.activity.fb[1].text, 'a b c');
  // 別人不受 a 的冷卻影響
  stand(b, 'mailbox', 'haven');
  room.on(b, { t: 'feedback', kind: 'idea', text: '大港也收' });
  assert.equal(hub.activity.fb.length, 3);
});

// ======================= 修船 =======================
test('修船：自己的、幫隊友（forId）、不是隊友、船不在範圍、沒壞、錢不夠、站在船上', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  const yard = SITES.yard;
  for (const p of [a, b, c]) { p.kit.money = 5000; putBoat(p, yard.x, yard.z); p.boat.s[11] = 0.5; p.boat.cracks = [[0, 0, 10]]; }
  const cost = repairCost('skiff', 0.5, 1);
  room.on(a, { t: 'repairBoat' });
  assert.equal(a.kit.money, 5000, '不在修船台前');
  stand(a, 'repair', 'yard');
  a.pos[8] = a.id;
  room.on(a, { t: 'repairBoat' });
  assert.equal(a.kit.money, 5000, '站在船上不行');
  a.pos[8] = 0;
  room.on(a, { t: 'repairBoat' });
  assert.equal(a.kit.money, 5000 - cost);
  assert.equal(a.boat.s[11], 1);
  room.on(a, { t: 'repairBoat' });
  assert.equal(a.kit.money, 5000 - cost, '沒壞不收錢');
  room.on(a, { t: 'repairBoat', forId: c.id });
  assert.equal(c.boat.s[11], 0.5, '不是隊友');
  team(room, a, b);
  room.on(a, { t: 'repairBoat', forId: b.id });
  assert.equal(b.boat.s[11], 1);
  assert.equal(b.kit.money, 5000, '隊友不用付');
  assert.equal(a.kit.money, 5000 - 2 * cost);
  // 船不在範圍
  b.boat.s[11] = 0.5; putBoat(b, yard.x + yard.repairR + 50, yard.z);
  room.on(a, { t: 'repairBoat', forId: b.id });
  assert.equal(b.boat.s[11], 0.5);
  // 錢不夠
  putBoat(b, yard.x, yard.z); a.kit.money = 1;
  room.on(a, { t: 'repairBoat', forId: b.id });
  assert.equal(b.boat.s[11], 0.5);
  // 怪的 forId
  a.kit.money = 5000;
  for (const forId of [9999, -1, 'x', NaN, {}, a.id]) room.on(a, { t: 'repairBoat', forId });
  assert.ok(a.kit.money >= 0);
});

// ======================= 誘魚桶、集魚燈 =======================
test('誘魚桶：useChum 用掉一桶、沒有就不行、陸地／太遠不行、同一處不疊加；買的上限看船型', () => {
  const { room, ps: [a] } = fixture(1);
  const [bx, bz] = [a.boat.s[0], a.boat.s[1]];
  a.pos = [bx, 1.3, bz, 0, 0, 0, 0, 0, a.id, 0, 0, '', ''];
  a.kit.chum = 0;
  room.on(a, { t: 'useChum', x: bx, z: bz });
  assert.match(lastOf(a, 'no').msg, /沒有誘魚桶/);
  a.kit.chum = 2;
  room.on(a, { t: 'useChum', x: bx + 100, z: bz });
  assert.equal(a.kit.chum, 2, '太遠');
  room.on(a, { t: 'useChum', x: QUAY_CENTER_W.x, z: QUAY_CENTER_W.z });
  // 碼頭（陸地）丟不進去
  room.on(a, { t: 'useChum', x: bx, z: bz });
  assert.equal(a.kit.chum, 1);
  room.on(a, { t: 'useChum', x: bx + 1, z: bz });
  assert.equal(a.kit.chum, 1, '同一處不疊加');
  // 買：小舢舨上限 maxChums
  stand(a, 'chum', 'home');
  a.kit.money = 100000; a.kit.chum = 0;
  for (let i = 0; i < 10; i++) room.on(a, { t: 'buy', id: 'chum' });
  assert.equal(a.kit.chum, Math.min(CHUM_SPEC.max, BOAT_TYPES.skiff.maxChums));
});

test('集魚燈：夜裡、裝了燈、船頭燈開著（s[9] & 8）、25 公尺內才有倍率；誰的船都算', () => {
  const { room, ps: [a, b] } = fixture(2);
  const night = (v) => Object.defineProperty(room.climate, 'night', { get: () => v, configurable: true });
  b.boat.type = 'trawler'; b.kit.mods.lamp = true; b.boat.s[9] |= 8;
  const [x, z] = [b.boat.s[0], b.boat.s[1]];
  night(false);
  assert.equal(room.lampActive(a, x, z), 0, '白天沒有');
  night(true);
  assert.equal(room.lampActive(a, x, z), BOAT_TYPES.trawler.lampMul, '別人的燈也算');
  assert.equal(room.lampActive(a, x + 30, z), 0, '太遠');
  b.boat.s[9] &= ~8;
  assert.equal(room.lampActive(a, x, z), 0, '燈沒開');
  b.boat.s[9] |= 8; b.kit.mods.lamp = false;
  assert.equal(room.lampActive(a, x, z), 0, '沒裝燈（只送旗號不算）');
  b.kit.mods.lamp = true; b.boat.type = 'skiff';
  assert.equal(room.lampActive(a, x, z), 0, '小舢舨的倍率是 1：等於沒有');
});

// ======================= 看板 =======================
test('看板 boards()：donate 依金額排、不含登入代碼；dex 依魚種數、排除 _ 開頭欄位', () => {
  const { room, guild, ps: [a, b, c] } = fixture(3);
  guild.donate(a.token, a.name, 3000); guild.donate(b.token, b.name, 8000);
  a.dex = { tuna: { n: 1 }, _lv: { exp: 9999 } };
  b.dex = { tuna: { n: 1 }, mackerel: { n: 3 } };
  c.dex = { _lv: { exp: 1 } };
  const bd = room.boards();
  assert.deepEqual(bd.donate.map((e) => e.name), [b.name, a.name]);
  assert.ok(!JSON.stringify(bd).includes('token-'));
  assert.deepEqual(bd.dex.map((e) => [e.name, e.n]), [[b.name, 2], [a.name, 1]]);
  assert.ok(bd.dex.every((e) => !('token' in e)));
});

// ======================= 亂送訊息 =======================
test('亂送訊息：新訊息帶缺欄位、型別錯、NaN、超大、負數、不存在／自己的 id，伺服器不丟例外', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  team(room, a, b);
  putBoat(a, 0, 0); putBoat(b, -14, 0);
  const weird = [undefined, null, NaN, Infinity, -1, 0, 1e308, -1e308, '1', 'abc', '', true, {}, [], [1, 2], a.id, b.id, c.id, 99999, '__proto__'];
  const kinds = ['partyInvite', 'partyLeave', 'towAsk', 'towCut', 'askAns', 'helm', 'b', 'sink', 'donate', 'wear', 'guild', 'feedback', 'repairBoat', 'useChum', 'buy', 'h', 'p', 'swap', 'call'];
  const fields = ['to', 'me', 'aid', 'yes', 'forId', 'on', 's', 'why', 'side', 'amount', 'title', 'kind', 'text', 'x', 'z', 'id', 'len'];
  const errors = [];
  for (const p of [a, b, c]) for (const t of kinds) {
    try { room.on(p, { t }); } catch (e) { errors.push(`${t} {}: ${e.message}`); }
    for (const k of fields) for (const v of weird) {
      try { room.on(p, { t, [k]: v }); } catch (e) { errors.push(`${t} ${k}=${String(v)}: ${e.message}`); }
    }
  }
  // 組合：forId 指自己、別人、不存在，s 合法或不合法
  for (const p of [a, b, c]) for (const forId of [a.id, b.id, c.id, 99999, 0, '1']) {
    for (const s of [boatMsg(a), Array(12).fill(NaN), Array(12).fill(1e9), null]) {
      for (const t of ['b', 'sink', 'helm', 'repairBoat']) {
        try { room.on(p, { t, forId, s, why: 'flood', side: 1, on: true }); } catch (e) { errors.push(`${t} forId=${forId}: ${e.message}`); }
      }
    }
  }
  // askAns 亂答
  room.on(a, { t: 'towAsk', to: b.id });
  for (const aid of [lastOf(b, 'ask')?.aid, 0, -1, 'x', null]) for (const yes of [true, 1, 'yes', null]) {
    for (const p of [a, b, c]) { try { room.on(p, { t: 'askAns', aid, yes }); } catch (e) { errors.push(`askAns ${aid}: ${e.message}`); } }
  }
  try { for (let i = 0; i < 20; i++) room.step(Date.now() + i * 100); } catch (e) { errors.push('step: ' + e.message); }
  assert.deepEqual(errors, []);
});
