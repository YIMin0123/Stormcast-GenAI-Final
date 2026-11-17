// 魚是誰的：釣到的人；送過人的是最後收下的人的。只有主人和主人的隊友能拿起放在外面的魚（隊友是幫忙搬，魚還是主人的），
// 賣掉（母島籃子、大港大秤、整箱賣）的錢都付給主人；誰放進去、誰按賣出都不算。主人不在這間房了才算拿著的人的。
// 寫法照 tools/hatch.test.js（同一個行程建房間、假玩家）
import assert from 'node:assert/strict';
import test from 'node:test';
import { Room, newPlayer } from '../server/room.js';
import { Guild } from '../server/guild.js';
import { Activity } from '../server/activity.js';
import { SELL_W, HAVEN_SELL_W } from '../src/layout.js';
import { PORT } from '../src/lowpoly/havenPlan.js';

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
    at(p, SELL_W.button);
    ps.push(p);
  }
  return { room, ps };
}
const at = (p, w) => { p.pos = [w.x, SELL_W.basket.y, w.z, 0, 0, 0, 0, 0, 0, 0, 0, '', '']; };
const lastOf = (p, t) => p.inbox.filter((m) => m.t === t).at(-1);
function team(room, a, b) {
  room.on(a, { t: 'partyInvite', to: b.id });
  room.on(b, { t: 'askAns', aid: lastOf(b, 'ask').aid, yes: true });
}
let uid = 70_000;
// p 釣到一條魚（by 記釣到的人）
const caught = (p, value = 100) => { const u = uid++; p.fish.set(u, { id: 'mackerel', kg: 1, len: 0.4, value, by: { pid: p.id, key: p.token, name: p.name } }); return u; };
const put = (room, p, u, k) => room.on(p, { t: 'put', uid: u, k, x: SELL_W.basket.x, y: SELL_W.basket.y, z: SELL_W.basket.z, yaw: 0 });
const money = (...ps) => ps.map((p) => p.kit.money);

test('沒組隊的人拿不起別人的魚；隊友可以幫忙拿，魚還是主人的', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  team(room, a, b);
  const u = caught(a);
  put(room, a, u, 'g');
  room.on(c, { t: 'grab', uid: u });
  assert.match(lastOf(c, 'grabNo').msg, /只有他和他的隊友能拿/);
  assert.ok(room.loose.has(u), '陌生人拿不走');
  assert.equal(room.loosePub(room.loose.get(u)).w, a.id, '畫面端知道魚是 A 的');
  room.on(b, { t: 'grab', uid: u });
  assert.ok(b.fish.has(u), '隊友拿得起來');
  assert.equal(lastOf(b, 'grabbed').of, a.name, '告訴 B 這是幫 A 拿的');
  // B 放下，A 自己可以拿回來
  put(room, b, u, 'g');
  room.on(a, { t: 'grab', uid: u });
  assert.ok(a.fish.has(u));
});

test('隊友放進籃子、別人按賣出：錢付給釣到的人', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  team(room, a, b);
  const u = caught(a, 100);
  put(room, a, u, 'g');
  room.on(b, { t: 'grab', uid: u });
  put(room, b, u, 'b');
  const [ma, mb, mc] = money(a, b, c);
  room.on(c, { t: 'sell' });
  const share = Math.round(100 * 0.10);   // 同隊分紅（PARTY.share）
  assert.equal(a.kit.money - ma, 100, '釣到的 A 拿到錢');
  assert.equal(b.kit.money - mb, share, '放進去的 B 只拿到同隊分紅');
  assert.equal(c.kit.money, mc, '按按鈕的 C 沒拿到');
  assert.deepEqual(lastOf(b, 'sold').uids, [u], 'B 那邊把籃子裡他放的魚拿掉');
  assert.equal(lastOf(a, 'sold').n, 1);
});

test('隊友幫忙拿去大港大秤賣：錢付給主人（含大港加成）', () => {
  const { room, ps: [a, b] } = fixture(2);
  team(room, a, b);
  const u = caught(a, 200), v = caught(b, 50);
  put(room, a, u, 'g');
  room.on(b, { t: 'grab', uid: u });
  at(b, HAVEN_SELL_W);
  const [ma, mb] = money(a, b);
  room.on(b, { t: 'sell', at: 'haven', uids: [u, v] });
  const k = 1 + PORT.bonus, aGot = Math.round(200 * k), bGot = Math.round(50 * k);
  assert.equal(a.kit.money - ma, aGot + Math.round(bGot * 0.10), 'A 拿到自己那條（加上 B 那條的分紅）');
  assert.equal(b.kit.money - mb, bGot + Math.round(aGot * 0.10), 'B 只拿到自己那條（加上 A 那條的分紅）');
  assert.equal(lastOf(a, 'paidFor').n, 1);
  assert.equal(lastOf(b, 'sold').others, 1);
});

test('送出去的魚是收下的人的；幫忙拿著的魚轉送別人，魚還是原主的', () => {
  const { room, ps: [a, b, c] } = fixture(3);
  const u = caught(a, 80);
  room.on(a, { t: 'give', to: b.id, uid: u });
  room.on(b, { t: 'giveAns', oid: lastOf(b, 'offer').oid, yes: true });
  put(room, b, u, 'b');
  let [ma, mb] = money(a, b);
  room.on(a, { t: 'sell' });
  assert.equal(b.kit.money - mb, 80, '收下的 B 拿到錢');
  assert.equal(a.kit.money, ma);
  // 隊友 B 幫 A 拿著一條，轉送給 C：還是 A 的
  team(room, a, b);
  const w = caught(a, 40);
  put(room, a, w, 'g');
  room.on(b, { t: 'grab', uid: w });
  room.on(b, { t: 'give', to: c.id, uid: w });
  room.on(c, { t: 'giveAns', oid: lastOf(c, 'offer').oid, yes: true });
  assert.ok(c.fish.has(w));
  put(room, c, w, 'b');
  [ma, mb] = money(a, b);
  const mc = c.kit.money;
  room.on(c, { t: 'sell' });
  assert.equal(a.kit.money - ma, 40, '還是付給 A');
  assert.equal(c.kit.money, mc);
});

test('主人不在這間房了：付給拿著的人，誰都能撿', () => {
  const { room, ps: [a, b] } = fixture(2);
  const u = caught(a, 60);
  put(room, a, u, 'g');
  room.players.delete(a.id);
  room.on(b, { t: 'grab', uid: u });
  assert.ok(b.fish.has(u));
  put(room, b, u, 'b');
  const mb = b.kit.money;
  room.on(b, { t: 'sell' });
  assert.equal(b.kit.money - mb, 60);
});
