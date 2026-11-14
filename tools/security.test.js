import assert from 'node:assert/strict';
import test from 'node:test';
import { Room, newPlayer, applyProfile } from '../server/room.js';
import { cleanName } from '../server/words.js';
import { sendRaw } from '../server/wire.js';
import { FISHBOX } from '../src/config.js';
import { BERTHS, QUAY_CENTER_W, HAVEN_PUMP_W } from '../src/layout.js';

function fixture() {
  const hub = { keep() {}, sessions: new Map(), daily: { top: () => [] } };
  const room = new Room(1, hub);
  const make = (id) => {
    const p = newPlayer(id, null, 'a'.repeat(32), '測試');
    room.enter(p);
    return p;
  };
  const p = make(1), q = make(2);
  return { room, p, q };
}
const pos = (x, z, carrier = 0) => [x, 1.3, z, 0, 0, 0, 0, 0, carrier, 0, 0, '', ''];

test('畸形訊息、繼承屬性與損壞值不會引發例外或污染狀態', () => {
  const { room, p } = fixture();
  const start = pos(QUAY_CENTER_W.x, QUAY_CENTER_W.z);
  room.on(p, { t: 'p', s: start });
  assert.equal(p.pos, start);
  const bad = JSON.parse('{"toString":0,"valueOf":0}');
  assert.equal(cleanName(bad), '');
  for (const m of [
    { t: 'p', s: { slice: 0 } },
    { t: 'p', s: [...start.slice(0, 11), 'constructor', ''] },
    { t: 'p', s: pos(start[0], start[2], 999) },
    { t: 'h', id: 'constructor', len: 1 },
    { t: 'chat', text: bad },
    { t: 'sink', why: bad, side: 1 },
    { t: 'swap', type: 'constructor' },
    { t: 'baitSel', id: bad },
    { t: 'bd', cracks: [[0, 0]], moor: -1 },
    { t: 'bd', cracks: [[0, 0, -5]], moor: -1 },
  ]) room.on(p, m);
  assert.equal(p.pos, start);
  assert.equal(p.hold, null);
  assert.equal(p.boat.sunk, false);
  assert.equal(p.kit.active, 'skiff');
  assert.deepEqual(p.boat.cracks, []);
  p.pos = pos(HAVEN_PUMP_W.x, HAVEN_PUMP_W.z);
  room.on(p, { t: 'pump', liters: bad });
  assert.equal(p.kit.money, 0);
});

test('正常船況會同步，離群座標、負油量和不完整船損會被拒絕', () => {
  const { room, p } = fixture(), berth = BERTHS[p.berth];
  assert.ok(berth);
  const state = [...p.boat.s];
  state[10] -= 2;
  room.on(p, { t: 'b', s: state });
  room.on(p, { t: 'bd', cracks: [[0, 0, 1]], moor: -1 });
  const poisoned = [...state];
  poisoned[0] = 1e308;
  room.on(p, { t: 'b', s: poisoned });
  room.on(p, { t: 'bd', cracks: [[0]], moor: -1 });
  const negative = [...state];
  negative[10] = -1;
  room.on(p, { t: 'b', s: negative });
  assert.deepEqual(p.boat.s, state);
  assert.deepEqual(p.boat.cracks, [[0, 0, 1]]);
});

test('舊存檔中的不完整船損與越界油量不會帶回遊戲', () => {
  const { room, p } = fixture();
  applyProfile(p, { stored: { skiff: { fuel: -5, cracks: [[0, 0], [0, 0, 2]] } } });
  room.parkBoat(p);
  assert.equal(p.boat.s[10], 0);
  assert.deepEqual(p.boat.cracks, [[0, 0, 2]]);
  assert.ok(Number.isFinite(p.boat.s[11]));
});

test('送魚只接受有效的同意，逾時或分開後不能交付，重連不會收到原釣者的憑證', () => {
  const { room, p, q } = fixture();
  q.token = 'b'.repeat(32);
  p.ws = q.ws = { readyState: 1, send() {} };
  const x = QUAY_CENTER_W.x, z = QUAY_CENTER_W.z;
  p.pos = q.pos = pos(x, z);
  p.fish.set(1, { id: 'tuna', kg: 2, len: 0.8, value: 200, by: { pid: p.id, key: p.token, name: p.name } });
  const offer = () => {
    room.on(p, { t: 'give', to: q.id, uid: 1 });
    return [...room.offers.values()][0];
  };
  const accept = (oid, yes = true) => room.on(q, { t: 'giveAns', oid, yes });

  let o = offer();
  accept(o.oid, 'true');
  assert.ok(p.fish.has(1));
  q.pos = pos(x + 50, z);
  accept(o.oid);
  assert.ok(p.fish.has(1));
  q.pos = pos(x, z);
  o = offer();
  o.at -= FISHBOX.offerSec * 1000 + 1;
  accept(o.oid);
  assert.ok(p.fish.has(1));
  accept(offer().oid);
  assert.equal(p.fish.has(1), false);
  assert.equal(q.fish.get(1).by.key, p.token);
  assert.deepEqual(room.resumeData(q).fish, [{ uid: 1, id: 'tuna', kg: 2, len: 0.8, value: 200 }]);
});

test('慢速連線超過佇列上限就中止，健康連線可正常接收', () => {
  const sent = [];
  const ws = { readyState: 1, bufferedAmount: 0, send: (raw) => sent.push(raw), terminate() { this.readyState = 3; } };
  sendRaw(ws, 'first');
  ws.bufferedAmount = 2 * 1024 * 1024;
  sendRaw(ws, 'second');
  assert.deepEqual(sent, ['first']);
  assert.equal(ws.readyState, 3);
});
