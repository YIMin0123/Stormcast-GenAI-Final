import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { GRACE, Room, newPlayer } from '../server/room.js';
import { FishWorld } from '../src/fish.js';
import { SELL_W, HAVEN_PUMP_W, QUAY_CENTER_W, DECK_Y, deckY } from '../src/layout.js';
import { SERVER } from '../src/config.js';
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

test('加油柱只替靠近的船加油，按可容納的公升數收費', () => {
  const { room, p } = roomFixture();
  p.pos[0] = HAVEN_PUMP_W.x; p.pos[2] = HAVEN_PUMP_W.z;
  p.kit.money = 100;
  p.boat.s[10] = 18;
  room.on(p, { t: 'pump', liters: 20 });
  assert.equal(p.kit.money, 100);
  p.boat.s[0] = HAVEN_PUMP_W.x; p.boat.s[1] = HAVEN_PUMP_W.z;
  room.on(p, { t: 'pump', liters: 20 });
  assert.equal(p.boat.s[10], 20);
  assert.equal(p.kit.money, 100 - Math.ceil(2 * PORT.pump.price));
  room.on(p, { t: 'pump', liters: 20 });
  assert.equal(p.kit.money, 100 - Math.ceil(2 * PORT.pump.price));
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
