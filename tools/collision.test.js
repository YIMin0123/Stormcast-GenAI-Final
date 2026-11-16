import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
import { WALLS, inWall, deckY, DECK_Y, BERTHS, berthPose } from '../src/layout.js';
import { toLocal, toWorld } from '../src/frame.js';
import { BOAT_TYPES } from '../src/boatdata.js';
import { SHOP } from '../src/lowpoly/harborPlan.js';
import { BAY, PORT } from '../src/lowpoly/havenPlan.js';
import { portFoundation, portWall } from '../src/lowpoly/havenShape.js';

// 移動測試不需要載入瀏覽器專用的人物模型與動作資源。
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.endsWith('/src/player.js') && specifier === './boat.js') return { url: 'data:text/javascript,export const buildFigure = () => ({})', shortCircuit: true };
  if (context.parentURL?.endsWith('/src/player.js') && specifier === './emotes.js') return { url: 'data:text/javascript,export const ACTION_BY_ID = {}; export const MOOD_TIME = 0', shortCircuit: true };
  if (context.parentURL?.endsWith('/src/boat.js') && specifier === './figure.js') return { url: 'data:text/javascript,export const buildFigure = () => globalThis.__testFigure()', shortCircuit: true };
  if (context.parentURL?.endsWith('/src/fish.js') && specifier === './fishModel.js') return { url: 'data:text/javascript,export const makeFishModel = () => globalThis.__testFish()', shortCircuit: true };
  return nextResolve(specifier, context);
} });
globalThis.__testFish = () => new THREE.Group();
const { Player } = await import('../src/player.js');
const { Boat, buildBoatMesh } = await import('../src/boat.js');
const { FishWorld } = await import('../src/fish.js');
const { BoxWorld } = await import('../src/fishBox.js');

function testBoat(type, heading = 0) {
  const boat = Object.create(Boat.prototype);
  Object.assign(boat, { spec: BOAT_TYPES[type], x: 0, z: 0, heading, y: 0,
    normal: new THREE.Vector3(0, 1, 0), blocks: [], sinking: false });
  return boat;
}

function playerOnBoat(boat, lx, lz) {
  const { x, z } = boat.toWorld(lx, lz), p = new Player(x, z, 0);
  p.animate = () => {}; p.boat = boat; p.lx = lx; p.lz = lz;
  p.base = p.y = boat.deckY(x, z);
  return p;
}
const openSea = (boat) => ({ boats: [boat], water: () => 0, ground: () => -30 });

test('三種船首尾的可見甲板都有支撐', () => {
  for (const type of ['skiff', 'fisher', 'trawler']) {
    const boat = testBoat(type), len = boat.spec.len;
    assert.equal(boat.deckContains(-len / 2 + 0.1, 0), true, `${type} 船尾甲板`);
    assert.equal(boat.deckContains(len / 2 - 0.3, 0), true, `${type} 船首甲板`);
  }
});

test('三種船的甲板碰撞範圍貼合實際模型三角面', () => {
  globalThis.__testFigure = () => new THREE.Group();
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) };
  try {
    for (const type of ['skiff', 'fisher', 'trawler']) {
      const boat = testBoat(type), mesh = buildBoatMesh(boat.spec), deck = mesh.children[1];
      mesh.updateMatrixWorld(true);
      for (let i = 0; i < 34; i++) for (const zFactor of [-0.9, 0, 0.9]) {
        const x = ((i + 0.5) / 34 - 0.5) * boat.spec.len, z = boat.deckHalfWidth(x) * zFactor;
        const ray = new THREE.Raycaster(new THREE.Vector3(x, boat.spec.deck + 2, z), new THREE.Vector3(0, -1, 0));
        assert.ok(ray.intersectObject(deck).length && boat.deckContains(x, z), `${type} 的甲板漏判：${x}, ${z}`);
      }
    }
  } finally {
    delete globalThis.__testFigure;
    delete globalThis.document;
  }
});

test('三種船的船首、船尾與兩側船舷會擋住走路', () => {
  for (const type of ['skiff', 'fisher', 'trawler']) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const boat = testBoat(type, Math.PI / 4), p = playerOnBoat(boat, 0, 0), world = openSea(boat);
    const c = Math.cos(boat.heading), s = Math.sin(boat.heading), wx = dx * c - dz * s, wz = dx * s + dz * c;
    for (let i = 0; i < 180; i++) p.update(1 / 60, wx, wz, false, false, world);
    assert.equal(p.boat, boat, `${type} 的 (${dx}, ${dz}) 船舷走出去`);
    assert.ok(boat.deckContains(p.lx, p.lz), `${type} 站到甲板外`);
  }
});

test('在船舷邊跳過足夠高度時可以離船', () => {
  const boat = testBoat('fisher'), p = playerOnBoat(boat, 0, 1.6), world = openSea(boat);
  p.update(1 / 60, 0, 1, false, true, world);
  for (let i = 0; i < 100 && p.boat; i++) p.update(1 / 60, 0, 1, false, false, world);
  assert.equal(p.boat, null);
});

test('漁船與大漁船的艙蓋頂面有落腳高度', () => {
  for (const type of ['fisher', 'trawler']) {
    const boat = testBoat(type), p = playerOnBoat(boat, boat.spec.hatch.x, 0);
    const world = openSea(boat);
    p.update(1 / 60, 0, 0, false, false, world);
    assert.ok(Math.abs(p.y - (boat.spec.deck + 0.28)) < 1e-9, `${type} 的艙蓋被穿過`);
  }
});

test('船移動、隨浪傾斜時，船上的人持續踩在甲板上', () => {
  for (const type of ['skiff', 'fisher', 'trawler']) {
    const boat = testBoat(type), p = playerOnBoat(boat, 0, 0), world = openSea(boat);
    for (let i = 0; i < 120; i++) {
      boat.x += 0.02; boat.z -= 0.01; boat.y = 0.3 * Math.sin(i / 15);
      boat.normal.set(0.1 * Math.sin(i / 20), 1, 0.1 * Math.cos(i / 20)).normalize();
      p.update(1 / 60, 0, 0, false, false, world);
      assert.equal(p.boat, boat);
      assert.ok(Math.abs(p.y - boat.walkDeckY(p.x, p.z)) < 1e-8);
    }
  }
});

test('商店開口兩側的牆與通道', () => {
  const blocked = (x, z) => WALLS.some((wall) => inWall(wall, x, z));
  const z = SHOP.z1 - 0.1;
  assert.equal(blocked((SHOP.x0 + SHOP.open.x0) / 2, z), true);
  assert.equal(blocked((SHOP.open.x0 + SHOP.open.x1) / 2, z), false);
});

test('游泳時可從岸上障礙的下方經過，水下障礙仍會擋住', () => {
  const p = Object.create(Player.prototype);
  p.onWater = true; p.base = -0.95; p.h = 0;
  const world = { water: () => 0, ground: (_x, _z, under) => under ? -3 : 99 };
  assert.equal(p._surface(0, 0, world).swim, true);
  world.ground = () => 99;
  assert.equal(p._surface(0, 0, world), null);
  p.onWater = false;
  world.ground = (_x, _z, under) => under ? -3 : 99;
  assert.equal(p._surface(0, 0, world), null);
});

test('從船飛過水面時仍可偵測腳下的橋，游泳時仍可從橋底通過', () => {
  const p = new Player(0, 0, 0);
  const world = { boats: [], water: () => 0, ground: (_x, _z, under) => under ? -3 : 1.3 };
  p.onWater = true; p.base = -0.95; p.h = 2.5;
  assert.deepEqual(p._surface(0, 0, world), { boat: null, y: 1.3, swim: false });
  p.h = 0;
  assert.equal(p._surface(0, 0, world).swim, true);
});

test('橋面高於重疊的船，跳過橋面後應站到橋上', () => {
  const boat = { sinking: false, heading: 0, toLocal: (x, z) => ({ x, z }), toWorld: (x, z) => ({ x, z }),
    deckContains: (x) => x < 0.8, blockedLocal: () => false, deckY: () => 0.6 };
  const world = { boats: [boat], water: () => 0, ground: (x, _z, under) => !under && x >= 0 ? 1.3 : -3 };
  const p = new Player(-0.4, 0, 0);
  p.animate = () => {}; p.boat = boat; p.lx = p.x; p.lz = 0; p.base = p.y = 0.6;
  p.h = 0.9;
  assert.equal(p._probe(0.2, 0, world).boat, null, '腳高於橋面時應優先選橋');
  p.h = 0;
  p.update(0.05, 1, 0, false, true, world);
  for (let i = 0; i < 15; i++) p.update(0.05, 1, 0, false, false, world);
  assert.ok(p.x > 0 && p.boat === null && p.h === 0 && Math.abs(p.y - 1.3) < 1e-9,
    `未落在橋面：x=${p.x}, y=${p.y}, h=${p.h}, boat=${!!p.boat}`);
});

test('空中切換水面與橋面時維持人物原有高度', () => {
  const p = new Player(1, 0, 0);
  p.animate = () => {}; p.onWater = true; p.base = -0.95; p.h = 2.5; p.y = 1.55;
  const world = { boats: [], water: () => 0, ground: (_x, _z, under) => under ? -3 : 1.3 };
  p.update(0.01, 0, 0, false, false, world);
  assert.ok(p.y <= 1.55 && p.y > 1.5, `高度突變：y=${p.y}`);
});

test('沿真實母港座標從停靠的船跳上棧橋', () => {
  const boat = {
    sinking: false, heading: 0,
    toLocal: (x, z) => { const [lx, lz] = toLocal(x, z); return { x: lx, z: lz }; },
    toWorld: (x, z) => { const [wx, wz] = toWorld(x, z); return { x: wx, z: wz }; },
    deckContains: (x, z) => x > 1.8 && x < 4.2 && z > 20 && z < 24,
    blockedLocal: () => false, deckY: () => 0.7,
  };
  const [x, z] = toWorld(2.2, 22), [tx, tz] = toWorld(1.2, 22);
  const world = { boats: [boat], water: () => 0, ground: (wx, wz, under) => under ? -3 : deckY(wx, wz) ?? -3 };
  const p = new Player(x, z, 0);
  p.animate = () => {}; p.boat = boat; p.lx = 2.2; p.lz = 22; p.base = p.y = 0.7;
  p.update(0.05, tx - x, tz - z, false, true, world);
  for (let i = 0; i < 14; i++) p.update(0.05, tx - x, tz - z, false, false, world);
  assert.ok(p.boat === null && p.h === 0 && Math.abs(p.y - DECK_Y) < 1e-9,
    `未落在棧橋：y=${p.y}, h=${p.h}, boat=${!!p.boat}`);
});

test('從棧橋跨過水面上船時，跨步不能轉成彈飛的速度', () => {
  for (const dt of [1 / 20, 1 / 60, 1 / 120]) {
    const boat = { sinking: false, heading: 0, toLocal: (x, z) => ({ x, z }), toWorld: (x, z) => ({ x, z }),
      deckContains: (x) => x > 0.6 && x < 4, blockedLocal: () => false, deckY: () => 0.32 };
    const world = { boats: [boat], water: () => 0, ground: (x, _z, under) => !under && x <= 0 ? 1.3 : -3 };
    const p = new Player(-0.01, 0, 0);
    p.animate = () => {}; p.base = p.y = 1.3;
    p.update(dt, 1, 0, false, false, world);
    assert.equal(p.boat, boat, `dt=${dt} 時沒有跨上船`);
    assert.ok(p.airVX <= 3.2 + 1e-6, `dt=${dt} 的跨步速度異常：${p.airVX}`);
    const x = p.x;
    for (let t = 0; t < 0.2; t += dt) p.update(dt, 0, 0, false, false, world);
    assert.ok(p.x - x < 1, `dt=${dt} 時上船後彈飛了 ${p.x - x} 公尺`);
  }
});

test('從船跨上橋並跳起時，也不能把跨步距離當成慣性', () => {
  const boat = { sinking: false, heading: 0, toLocal: (x, z) => ({ x, z }), toWorld: (x, z) => ({ x, z }),
    deckContains: (x) => x > 0.6 && x < 4, blockedLocal: () => false, deckY: () => 0.32 };
  const world = { boats: [boat], water: () => 0, ground: (x, _z, under) => !under && x <= 0 ? 1.3 : -3 };
  const p = new Player(0.61, 0, 0);
  p.animate = () => {}; p.boat = boat; p.lx = p.x; p.lz = 0; p.base = p.y = 0.32;
  p.update(1 / 60, -1, 0, false, true, world);
  assert.equal(p.boat, null);
  assert.ok(p.h > 0 && p.airVX < 0 && p.airVX >= -3.2 - 1e-6, `跳起速度異常：${p.airVX}`);
});

test('母港實際泊位的三種船，從橋上跨船不會產生異常速度', () => {
  for (const berth of [BERTHS[0], BERTHS[1], BERTHS[16], BERTHS[17]]) {
    for (const type of ['skiff', 'fisher', 'trawler']) {
      const boat = Object.create(Boat.prototype), pose = berthPose(berth, type);
      Object.assign(boat, pose, { spec: BOAT_TYPES[type], y: 0, normal: new THREE.Vector3(0, 1, 0), blocks: [], sinking: false });
      const [x, z] = toWorld(berth.ex - berth.nx * 0.01, berth.ez - berth.nz * 0.01);
      const world = { boats: [boat], water: () => 0, ground: (wx, wz, under) => under ? -3 : deckY(wx, wz) ?? -3 };
      const p = new Player(x, z, 0);
      p.animate = () => {}; p.base = p.y = DECK_Y;
      p.update(1 / 60, Math.cos(pose.heading), Math.sin(pose.heading), false, false, world);
      assert.equal(p.boat, boat, `${berth.label} ${type} 未能跨上船`);
      assert.ok(Math.hypot(p.airVX, p.airVZ) <= 3.2 + 1e-6, `${berth.label} ${type} 速度異常`);
    }
  }
});

test('停在母港時，三種船仍可走上附近的棧橋', () => {
  for (const berth of [BERTHS[0], BERTHS[1], BERTHS[16], BERTHS[17]]) for (const type of ['skiff', 'fisher', 'trawler']) {
    const boat = testBoat(type), pose = berthPose(berth, type);
    Object.assign(boat, pose);
    const [x, z] = toWorld(berth.ex + berth.nx, berth.ez + berth.nz), local = boat.toLocal(x, z);
    const p = playerOnBoat(boat, local.x, local.z);
    const world = { boats: [boat], water: () => 0, ground: (wx, wz, under) => under ? -3 : deckY(wx, wz) ?? -3 };
    for (let i = 0; i < 120 && p.boat; i++) p.update(1 / 60, -Math.cos(pose.heading), -Math.sin(pose.heading), false, false, world);
    assert.ok(!p.boat && p.base === DECK_Y, `${berth.label} ${type} 無法走上棧橋`);
  }
});

test('傾斜的船上艙蓋高度沿船體法線正確抬高', () => {
  const boat = testBoat('trawler');
  boat.normal.set(0.2, Math.sqrt(0.95), 0.1);
  const x = boat.spec.hatch.x, z = 0;
  assert.ok(Math.abs(boat.walkDeckY(x, z) - boat.deckY(x, z) - 0.28 / boat.normal.y) < 1e-9);
});

test('高速飛行不會在一幀內穿過薄牆', () => {
  const p = Object.create(Player.prototype);
  Object.assign(p, { x: 0, z: 0, y: 0, base: 0, h: 0, vy: 0, boat: null, seat: null,
    onWater: false, fly: true, flyDash: true, flyFast: 72, flySpeed: 24, flyVert: 8, flyMaxH: 150,
    yaw: 0, phase: 0, off: new THREE.Vector3(), animate() {} });
  const world = { boats: [], water: () => -20, ground: (x) => x >= 1 && x < 1.1 ? 99 : 0 };
  p.update(0.05, 1, 0, false, false, world);
  assert.ok(p.x < 1, `穿過牆壁：x=${p.x}`);
});

function fallingPlayer(x = -0.1) {
  const p = new Player(x, 0, 0);
  p.base = p.y = 10;
  p.animate = () => {};
  return p;
}
const cliff = { boats: [], water: () => -20, ground: (x) => x < 0 ? 10 : 0 };

test('跑出斷崖後放開方向，人物仍帶著水平速度下落', () => {
  const p = fallingPlayer();
  p.update(0.05, 1, 0, true, false, cliff);
  assert.ok(p.h > 0 && p.airVX > 5);
  const x = p.x, y = p.y;
  p.update(0.05, 0, 0, false, false, cliff);
  assert.ok(p.x > x + 0.25 && p.y < y);
});

test('水流滑出瀑布後，不再受河道判定限制仍繼續向前', () => {
  const p = fallingPlayer();
  p.riverDrift(8.5, 0, 0.05, cliff);
  assert.ok(p.h > 0 && p.airVX === 8.5);
  p.flowVX = p.flowVZ = 0;
  const x = p.x;
  p.update(0.05, 0, 0, false, false, cliff);
  assert.ok(p.x > x + 0.4);
});

test('跳起後可逐漸轉向，放開按鍵仍保有慣性', () => {
  const p = fallingPlayer();
  const floor = { boats: [], water: () => -20, ground: () => 10 };
  p.update(0.05, 1, 0, true, true, floor);
  assert.ok(p.h > 0 && p.airVX > 5);
  p.update(0.05, 0, 1, true, false, floor);
  assert.ok(p.airVX > 0 && p.airVZ > 0);
  const x = p.x, z = p.z;
  p.update(0.05, 0, 0, false, false, floor);
  assert.ok(p.x > x && p.z > z);
});

test('空中慣性碰牆會停下，落地後不會繼續滑動', () => {
  const p = fallingPlayer();
  p.riverDrift(8.5, 0, 0.05, cliff);
  const wall = { ...cliff, ground: (x) => x >= 0.8 && x < 1 ? 99 : cliff.ground(x) };
  for (let i = 0; i < 30; i++) p.update(0.05, 0, 0, false, false, wall);
  assert.ok(p.x < 0.8 && p.h === 0 && p.airVX === 0);
  const x = p.x;
  p.update(0.05, 0, 0, false, false, wall);
  assert.equal(p.x, x);
});

test('大港每間小屋的門前平台有模型高度，平台外沒有碰撞', () => {
  const ground = (x, z) => x * 0.01 + z * 0.02;
  for (const [x, z, w, d, , turn] of PORT.houses) {
    const rot = Math.atan2(BAY.x - x, BAY.z - z) + turn * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
    const point = (a, b) => [x + a * c + b * s, z - a * s + b * c];
    const [px, pz] = point(0, d / 2 + 0.6);
    const expected = Math.max(...[[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2 + 1.2], [w / 2, d / 2 + 1.2], [0, 0]].map(([a, b]) => ground(...point(a, b)))) + 0.3;
    assert.ok(Math.abs(portFoundation(px, pz, ground) - expected) < 1e-9);
    assert.equal(portWall(px, pz), false);
    assert.equal(portFoundation(...point(0, d / 2 + 1.3), ground), null);
  }
});

test('魚與魚箱放在漁船或大漁船艙蓋上時，停在艙蓋頂面而非沉入甲板', () => {
  for (const type of ['fisher', 'trawler']) {
    const boat = testBoat(type);
    boat.mesh = new THREE.Group();
    const h = boat.spec.hatch;
    assert.equal(boat.onHatch(h.x, 0), true);
    assert.equal(boat.onHatch(h.x + h.s / 2 + 0.2, 0), false);
    assert.ok(Math.abs(boat.deckLocalY(h.x, 0) - (boat.spec.deck + 0.28)) < 1e-9);
    assert.ok(Math.abs(boat.deckLocalY(h.x + h.s / 2 + 0.2, 0) - boat.spec.deck) < 1e-9);

    const player = { x: h.x - 0.5, z: 0, y: boat.spec.deck, yaw: 0, boat, lx: h.x - 0.5, lz: 0, mesh: new THREE.Group(), carry: false };
    const env = {
      boats: [boat], scene: new THREE.Group(), player,
      ground: () => -30, basketPos: { x: 99, z: 99, y: 0 }, basketR: 0.4,
      boxes: { each: () => [] }, waveAt: () => 0, splash() {}, toast() {},
      boatOf: (id) => id === 1 ? boat : null,
    };
    const fw = new FishWorld(env);

    // 放下到艙蓋上：停在 spec.deck + 0.28 + thick/2 + 0.02，世界高度亦含 0.28
    const dropped = fw.spawnHeld('hairtail', 1.2, 1.0, 101, 100);
    fw.drop();
    assert.equal(dropped.state, 'boat');
    assert.ok(boat.onHatch(dropped.lx, dropped.lz));
    const wp = fw.worldPos(dropped, new THREE.Vector3());
    assert.ok(Math.abs(dropped.mesh.position.y - (boat.spec.deck + 0.28 + dropped.thick / 2 + 0.02)) < 1e-9);
    assert.ok(Math.abs(wp.y - (boat.spec.deck + 0.28)) < 1e-9);

    // 高拋落在艙蓋上時於頂面著陸；低飛擦向艙蓋側面時彈回不穿模
    const thrown = fw.spawnHeld('hairtail', 1.2, 1.0, 102, 100);
    fw.throwHeld(new THREE.Vector3(h.x, boat.spec.deck + 1.2, 0), new THREE.Vector3(0, 0.5, 0));
    thrown.lively = 0;
    for (let i = 0; i < 60 && thrown.fly; i++) fw.update(1 / 60);
    assert.equal(thrown.fly, null);
    assert.equal(thrown.state, 'boat');
    assert.ok(Math.abs(thrown.mesh.position.y - (boat.spec.deck + 0.28 + thrown.thick / 2 + 0.02)) < 1e-9);

    const low = fw.spawnHeld('hairtail', 1.2, 1.0, 103, 100);
    fw.throwHeld(new THREE.Vector3(h.x - h.s / 2 - 0.15, boat.spec.deck + 0.02, 0), new THREE.Vector3(4, 0, 0));
    low.lively = 0;
    fw.update(1 / 20);
    assert.ok(low.x <= h.x - h.s / 2 || low.fly?.vx < 0, `${type} 低拋應撞艙蓋側面彈開`);

    // 船傾斜滑動時：低甲板上的魚撞到艙蓋邊會停住，不會憑空滑上去；艙蓋上的魚能滑回低甲板
    boat.normal.set(0.25, Math.sqrt(1 - 0.25 * 0.25), 0);
    fw.stowDeck(boat, h.x - h.s / 2 - 0.05, 0, 'hairtail', 1.2, 1.0, 104, 100);
    const slideLow = fw.items.at(-1);
    for (let i = 0; i < 30; i++) fw.update(1 / 60);
    assert.equal(boat.onHatch(slideLow.lx, slideLow.lz), false);
    assert.ok(Math.abs(slideLow.mesh.position.y - (boat.spec.deck + slideLow.thick / 2 + 0.02)) < 1e-9);

    dropped.lively = 0;
    dropped.lx = h.x + h.s / 2 - 0.05;
    for (let i = 0; i < 30; i++) fw.update(1 / 60);
    assert.equal(boat.onHatch(dropped.lx, dropped.lz), false);
    assert.ok(Math.abs(dropped.mesh.position.y - (boat.spec.deck + dropped.thick / 2 + 0.02)) < 1e-9);

    // 魚箱放在艙蓋上亦應落在 spec.deck + 0.28
    const bw = new BoxWorld(env);
    bw.set({ bid: 1, o: 1, k: 'd', b: 1, x: h.x, y: 0, z: 0, yaw: 0, fish: [] });
    assert.ok(Math.abs(bw.map.get(1).mesh.position.y - (boat.spec.deck + 0.28)) < 1e-9);
  }
});

test('人物站在棧板邊緣與指棧轉角時，站地半徑會撐住而不直接掉進海裡，游在旁邊也不會瞬移上岸', () => {
  const world = { boats: [], water: () => 0, ground: (wx, wz, under) => under ? -3 : deckY(wx, wz, 0.12) ?? -3 };
  // 沿母港第一根指棧（z = 6, x = -2..-10, 半寬 0.4 + 凸出木條 0.12 = 0.52）斜切轉角走上指棧板邊
  const [sx, sz] = toWorld(-1.6, 5.25);
  const p = new Player(sx, sz, 0);
  p.animate = () => {}; p.base = p.y = DECK_Y;
  const [tx, tz] = toWorld(-2.8, 5.55);   // 斜切主棧橋與指棧內角，沿指棧凸出木板邊緣前進
  const dx = tx - sx, dz = tz - sz;
  for (let i = 0; i < 25; i++) {
    p.update(1 / 60, dx, dz, false, false, world);
    assert.equal(p.onWater, false, '沿指棧轉角與板邊走過去應穩穩站在木板上');
    assert.ok(Math.abs(p.y - DECK_Y) < 1e-9);
  }
  const [ex, ez] = toWorld(-5.0, 5.35), [ox, oz] = toWorld(-5.0, 4.0);   // 站地半徑邊緣（5.48 - 0.13）仍穩站，繼續走出去才會落水
  const p2 = new Player(ex, ez, 0);
  p2.animate = () => {}; p2.base = p2.y = DECK_Y;
  p2.update(1 / 60, 0, 0, false, false, world);
  assert.equal(p2.onWater, false, '站在木板邊緣半隻腳範圍內不應直接落水');
  for (let i = 0; i < 30; i++) p2.update(1 / 60, ox - ex, oz - ez, false, false, world);
  assert.equal(p2.onWater, true, '明顯走出木板外應落水');
  p2.update(1 / 60, ex - ox, ez - oz, false, false, world);
  assert.equal(p2.onWater, true, '水裡游近棧板邊不應直接傳送到棧板上');
});
