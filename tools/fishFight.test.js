import assert from 'node:assert/strict';
import test from 'node:test';
import { Group } from 'three';
import { Room, newPlayer } from '../server/room.js';
import { REEL_PROTOCOL } from '../src/fishFight.js';
import { Fishing } from '../src/fishing.js';
import { HAVEN_SELL_W } from '../src/layout.js';
import { isWater } from '../server/world.js';

const water = [-300, 0, 300].flatMap((x) => [-300, 0, 300].map((z) => [x, z])).find(([x, z]) => isWater(x, z));

function fixture(t) {
  const start = Date.now();
  let now = start;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(performance, 'now', () => now - start);
  const messages = [];
  const ws = { readyState: 1, bufferedAmount: 0, send: (raw) => messages.push(JSON.parse(raw)) };
  const room = new Room(1, { daily: { top: () => [], offer: () => -1 }, keep() {}, sessions: new Map() });
  const p = newPlayer(1, ws, 'fight-fixture', '漁夫');
  room.enter(p);
  const [x, z] = water;
  p.pos = [x, 2, z, 0, 0, 0, 0, 0, 0, 0, 0, '', ''];
  const send = (m) => room.on(p, m);
  const tick = (ms = 100, simulate = true) => { now += ms; if (simulate) room.step(now); };
  function bite(strength) {
    send({ t: 'cast', x, z });
    assert.equal(p.fishing?.state, 'wait');
    p.fishing.fish = { id: 'mackerel', kg: 1, len: 0.4, value: 100, strength };
    now = p.fishing.biteAt;
    room.step(now);
    assert.equal(p.fishing.state, 'bite');
    messages.length = 0;
  }
  return { p, room, send, tick, bite, messages, time: () => now };
}

test('old land reports, stale inputs and waiting cannot create a catch', (t) => {
  const { p, send, tick, bite, messages } = fixture(t);
  bite(0.7);
  send({ t: 'hook' });
  assert.match(messages.at(-1).msg, /重新整理/);
  bite(0.7);
  send({ t: 'hook', v: REEL_PROTOCOL });
  const { id } = messages.at(-1);
  send({ t: 'reel', id: id - 1, n: 1, held: true });
  send({ t: 'reel', id, n: 2, held: true });
  send({ t: 'reel', id, n: 1, held: 1 });
  assert.equal(p.fishing.n, 0);
  for (let i = 0; i < 45; i++) {
    send({ t: 'land', id, progress: 1, value: 1e9 });
    tick();
  }
  assert.equal(p.fish.size, 0);
  assert.equal(p.fishing, null);
  assert.ok(messages.some((m) => m.t === 'fightEnd' && m.result === 'escape'));
});

test('over-tension breaks the rod on the server and a client cannot declare a snap', (t) => {
  const { p, send, tick, bite, messages } = fixture(t);
  bite(2);
  send({ t: 'hook', v: REEL_PROTOCOL });
  send({ t: 'lose', why: 'snap' });
  assert.equal(p.kit.rodBroken, false);
  bite(2);
  send({ t: 'hook', v: REEL_PROTOCOL });
  const { id } = messages.at(-1);
  send({ t: 'reel', id, n: 1, held: true });
  t.mock.method(Math, 'random', () => 0.45);
  for (let i = 0; i < 50 && p.fishing; i++) tick();
  assert.equal(p.kit.rodBroken, true);
  assert.equal(p.fish.size, 0);
  assert.ok(messages.some((m) => m.t === 'fightEnd' && m.result === 'snap'));
});

test('releasing the reel for the whole fight still lets the fish escape', (t) => {
  const { p, send, tick, bite, messages } = fixture(t);
  bite(0.7);
  send({ t: 'hook', v: REEL_PROTOCOL });
  const { id } = messages.at(-1);
  send({ t: 'reel', id, n: 1, held: false });
  for (let i = 0; i < 60 && p.fishing; i++) tick();
  assert.equal(p.fishing, null);
  assert.equal(p.fish.size, 0);
  assert.ok(messages.some((m) => m.t === 'fightEnd' && m.result === 'escape'));
});

test('leaving fishing range cancels the fight and old inputs cannot affect the next cast', (t) => {
  const { p, room, send, tick, bite, messages } = fixture(t);
  bite(0.7);
  send({ t: 'hook', v: REEL_PROTOCOL });
  const { id } = messages.at(-1);
  const out = p.pos.slice();
  out[0] += 85;
  send({ t: 'p', s: out });
  assert.equal(p.fishing, null);
  assert.ok(messages.some((m) => m.t === 'fightEnd' && m.id === id));
  p.pos[0] -= 85;
  p.suspect = 0;
  bite(0.7);
  send({ t: 'hook', v: REEL_PROTOCOL });
  send({ t: 'reel', id, n: 1, held: true });
  assert.equal(p.fishing.n, 0);
  room.drop(p);
  tick(1000);
  assert.equal(p.fishing, null);
  assert.equal(p.fish.size, 0);
});

test('a browser following its meter can catch once over a 300 ms RTT connection with jitter', (t) => {
  const { p, send, tick, bite, messages, time } = fixture(t);
  p.kit.rodLv = 2;
  bite(0.95);
  let seed = 18431;
  t.mock.method(Math, 'random', () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 2 ** 32; });
  const toClient = [], toServer = [];
  function enqueue(queue, message) {
    const delay = 130 + 40 * Math.random();
    queue.push({ at: Math.max(time() + delay, queue.at(-1)?.at ?? 0), message });
  }
  const mesh = new Group(), arm = new Group();
  arm.userData.grip = new Group();
  arm.add(arm.userData.grip);
  mesh.add(arm);
  mesh.userData.arms = [null, arm];
  const fishing = new Fishing({
    player: { x: p.pos[0], z: p.pos[2], mesh }, scene: new Group(),
    rodLv: () => p.kit.rodLv, canFish: () => true, surfaceY: () => 0, toast() {}, splash() {}, onSnap() {},
    net: { reel: (id, n, held) => enqueue(toServer, { t: 'reel', id, n, held }), rtt: () => 300 },
  });
  fishing.land.set(p.pos[0], 0, p.pos[2]);
  fishing.state = 'hooking';
  send({ t: 'hook', v: REEL_PROTOCOL });
  let nextReaction = 0, held = false, caught;
  for (let frame = 0; frame < 1800 && !caught; frame++) {
    const now = time();
    for (const m of messages.splice(0)) {
      if (['fight', 'reelState', 'fightEnd', 'caught'].includes(m.t)) enqueue(toClient, m);
    }
    while (toClient[0]?.at <= now) {
      const { message: m } = toClient.shift();
      if (m.t === 'fight') fishing.serverFight(m);
      if (m.t === 'reelState') fishing.serverReel(m);
      if (m.t === 'fightEnd') fishing.serverEnd(m.id, m.result);
      if (m.t === 'caught') { caught = m; fishing.serverEnd(m.fightId, 'caught'); }
    }
    if (fishing.state === 'fight') {
      if (now >= nextReaction) {
        if (fishing.force < fishing.zone - 0.04) held = true;
        if (fishing.force > fishing.zone + 0.04) held = false;
        nextReaction = now + 130;
      }
      fishing.setReel(held);
      fishing.update(1 / 60);
    }
    while (toServer[0]?.at <= now) send(toServer.shift().message);
    // Server's production loop runs approximately every six of these render frames.
    tick(1000 / 60, frame % 6 === 0);
  }
  assert.ok(caught);
  assert.equal(fishing.state, 'idle');
  assert.equal(p.fish.size, 1);
  assert.equal(p.fish.get(caught.fish.uid).value, 100);
  send({ t: 'land', id: caught.fightId, value: 1e9 });
  send({ t: 'reel', id: caught.fightId, n: 1, held: true });
  assert.equal(p.fish.size, 1);
  p.pos[0] = HAVEN_SELL_W.x;
  p.pos[2] = HAVEN_SELL_W.z;
  const beforeSale = p.kit.money;
  send({ t: 'sell', at: 'haven', uids: [caught.fish.uid] });
  assert.ok(p.kit.money > beforeSale);
  const afterSale = p.kit.money;
  send({ t: 'sell', at: 'haven', uids: [caught.fish.uid] });
  assert.equal(p.kit.money, afterSale);
});
