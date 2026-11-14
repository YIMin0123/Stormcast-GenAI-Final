import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';
import { WALLS, inWall } from '../src/layout.js';
import { SHOP } from '../src/lowpoly/harborPlan.js';
import { BAY, PORT } from '../src/lowpoly/havenPlan.js';
import { portFoundation, portWall } from '../src/lowpoly/havenShape.js';

// 移動測試不需要載入瀏覽器專用的人物模型與動作資源。
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.endsWith('/src/player.js') && specifier === './boat.js') return { url: 'data:text/javascript,export const buildFigure = () => ({})', shortCircuit: true };
  if (context.parentURL?.endsWith('/src/player.js') && specifier === './emotes.js') return { url: 'data:text/javascript,export const ACTION_BY_ID = {}; export const MOOD_TIME = 0', shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { Player } = await import('../src/player.js');

test('商店開口兩側的牆與通道', () => {
  const blocked = (x, z) => WALLS.some((wall) => inWall(wall, x, z));
  const z = SHOP.z1 - 0.1;
  assert.equal(blocked((SHOP.x0 + SHOP.open.x0) / 2, z), true);
  assert.equal(blocked((SHOP.open.x0 + SHOP.open.x1) / 2, z), false);
});

test('游泳時可從岸上障礙的下方經過，水下障礙仍會擋住', () => {
  const p = Object.create(Player.prototype);
  p.onWater = true;
  const world = { water: () => 0, ground: (_x, _z, under) => under ? -3 : 99 };
  assert.equal(p._surface(0, 0, world).swim, true);
  world.ground = () => 99;
  assert.equal(p._surface(0, 0, world), null);
  p.onWater = false;
  world.ground = (_x, _z, under) => under ? -3 : 99;
  assert.equal(p._surface(0, 0, world), null);
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
