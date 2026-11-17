// 魚餌戰術差異化與動態物價（docs/bait_and_market_plan.md）：四種餌同價同份量、各自的加成、
// 零和蹺蹺板（買 X 漲 X、其餘降）、自然回穩、取整與上下限、房間買餌照動態價收錢並廣播。
// 房間的寫法照 tools/hatch.test.js（同一個行程建房間、假玩家）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { BAITS, BAIT_PRICE, BAIT_MAX, SPECIES, baitPriceOf, baitBought, baitSettled, rollCatch, biteDelay } from '../src/fishdata.js';
import { shopItem } from '../src/boatdata.js';
import { Room, newPlayer } from '../server/room.js';
import { Guild } from '../server/guild.js';
import { Activity } from '../server/activity.js';
import { ALL_SHELF_W } from '../src/layout.js';

const KEYS = ['shrimp', 'minnow', 'squid', 'lure'];
const flat = () => Object.fromEntries(KEYS.map((k) => [k, BAIT_PRICE.base]));

test('四種餌：一份 8 個、基準價 $100、偏好的魚都存在', () => {
  assert.deepEqual(Object.keys(BAITS), KEYS);
  for (const B of Object.values(BAITS)) {
    assert.equal(B.pack, 8);
    assert.equal(B.price, BAIT_PRICE.base);
    for (const id of B.prefer ?? []) assert.ok(SPECIES[id], id);
  }
  assert.equal(BAIT_MAX, 40);
});

test('售價取整到 $5、夾在 $60～$160', () => {
  assert.equal(baitPriceOf(100), 100);
  assert.equal(baitPriceOf(102.4), 100);
  assert.equal(baitPriceOf(102.6), 105);
  assert.equal(baitPriceOf(12), BAIT_PRICE.min);
  assert.equal(baitPriceOf(999), BAIT_PRICE.max);
});

test('零和蹺蹺板：買一份 X，X +12、其餘 -4，碰到上下限就停', () => {
  const r = baitBought(flat(), 'squid');
  assert.deepEqual(r, { shrimp: 96, minnow: 96, squid: 112, lure: 96 });
  let s = flat();
  for (let i = 0; i < 20; i++) s = baitBought(s, 'lure');
  assert.equal(s.lure, BAIT_PRICE.max);
  assert.equal(s.shrimp, BAIT_PRICE.min);
});

test('自然回穩：每 60 秒偏離的部分剩 98%，十分鐘大約收 18%', () => {
  const one = baitSettled({ shrimp: 150, minnow: 50, squid: 100, lure: 100 });
  assert.ok(Math.abs(one.shrimp - 149) < 1e-9);
  assert.ok(Math.abs(one.minnow - 51) < 1e-9);
  const ten = baitSettled({ shrimp: 150, minnow: 100, squid: 100, lure: 100 }, 10);
  assert.ok(Math.abs((ten.shrimp - 100) / 50 - 0.98 ** 10) < 1e-9);
  assert.ok(0.98 ** 10 > 0.8 && 0.98 ** 10 < 0.83);
});

test('shopItem：給了動態價就照它，沒給照基準價', () => {
  const kit = newPlayer(9, null, 'token-9', '玩家9').kit;
  assert.equal(shopItem('bait_shrimp', kit).price, 100);
  assert.equal(shopItem('bait_shrimp', kit, { shrimp: 75 }).price, 75);
  assert.equal(shopItem('bait_shrimp', { ...kit, baits: { shrimp: 40 } }, { shrimp: 75 }).price, null);
});

test('各餌的效果：蝦餌咬得快、小魚餌魚變大、亮片餌魚比較不會掙扎', () => {
  const avg = (fn, n = 4000) => { let s = 0; for (let i = 0; i < n; i++) s += fn(); return s / n; };
  const base = avg(() => biteDelay({})), fast = avg(() => biteDelay({ bait: 'shrimp' }));
  assert.ok(fast < base * 0.88, `蝦餌 ${fast} vs ${base}`);
  // 同一個隨機數序列比較：小魚餌重 12%、亮片餌力道少 10%
  const seq = () => { let x = 0.123; return () => (x = (x * 9301 + 49297) % 233280 / 233280); };
  const rnd = Math.random;
  const spot = { depth: 20, island: 0, off: 200, night: false, rough: 0 };
  try {
    Math.random = seq(); const a = rollCatch({ ...spot, bait: '' });
    Math.random = seq(); const b = rollCatch({ ...spot, bait: 'minnow' });
    Math.random = seq(); const c = rollCatch({ ...spot, bait: 'lure' });
    Math.random = seq(); const d = rollCatch({ ...spot, bait: 'shrimp' });
    if (a.id === b.id) assert.ok(Math.abs(b.kg / a.kg - 1.12) < 0.02, `${a.kg} → ${b.kg}`);
    if (a.id === d.id && a.id === c.id && a.kg === c.kg) assert.ok(Math.abs(c.strength / d.strength - 0.9) < 1e-6);
  } finally { Math.random = rnd; }
});

function fixture(n = 2) {
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
    ps.push(p);
  }
  return { room, ps };
}
const lastOf = (p, t) => p.inbox.filter((m) => m.t === t).at(-1);
const standAt = (p, id) => { const s = ALL_SHELF_W.find((x) => x.id === id); p.pos = [s.stand.x, 1.3, s.stand.z, 0, 0, 0, 0, 0, 0, 0, 0, '', '']; };

test('房間買餌：照動態價收錢、買的漲別的降、大家都收到新價格', () => {
  const { room, ps: [a, b] } = fixture(2);
  assert.deepEqual(room.worldState().baitPrices, { shrimp: 100, minnow: 100, squid: 100, lure: 100 });
  a.kit.money = 1000;
  standAt(a, 'bait_lure');
  room.on(a, { t: 'buy', id: 'bait_lure' });
  assert.equal(lastOf(a, 'bought')?.id, 'bait_lure');
  assert.equal(a.kit.money, 900);
  assert.equal(a.kit.baits.lure, 8);
  assert.deepEqual(lastOf(b, 'baitPrices').prices, { shrimp: 95, minnow: 95, squid: 95, lure: 110 });
  room.on(a, { t: 'buy', id: 'bait_lure' });
  assert.equal(a.kit.money, 790, '第二份照漲過的 $110 收');
  // 買冷門的那種：照特價收
  room.baitRaw = { shrimp: 72, minnow: 100, squid: 100, lure: 100 };
  standAt(a, 'bait_shrimp');
  const before = a.kit.money;
  room.on(a, { t: 'buy', id: 'bait_shrimp' });
  assert.equal(before - a.kit.money, 70);
});

test('房間的餌價每 60 秒往 $100 收', () => {
  const { room, ps: [a] } = fixture(1);
  room.baitRaw = { shrimp: 160, minnow: 60, squid: 100, lure: 100 };
  const t0 = room.baitAt;
  a.inbox.length = 0;
  room.step(t0 + 30_000);
  assert.equal(room.baitRaw.shrimp, 160, '還沒到 60 秒');
  room.step(t0 + 60_000 * 10 + 1);
  assert.ok(Math.abs(room.baitRaw.shrimp - (100 + 60 * 0.98 ** 10)) < 1e-9);
  assert.ok(Math.abs(room.baitRaw.minnow - (100 - 40 * 0.98 ** 10)) < 1e-9);
  assert.deepEqual(lastOf(a, 'baitPrices').prices, room.baitPrices());
});
