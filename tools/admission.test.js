import assert from 'node:assert/strict';
import test from 'node:test';
import { Admission, admissionKey } from '../server/admission.js';

test('IPv6 privacy addresses share a source quota and mapped IPv4 matches native IPv4', () => {
  const source = admissionKey('2001:0db8:0000:2::abcd');
  assert.equal(source, admissionKey('2001:db8:0:2:9999::ffff'));
  assert.notEqual(source, admissionKey('2001:db8:0:3::abcd'));
  assert.equal(admissionKey('::ffff:c000:201'), admissionKey('192.0.2.1'));
});

test('a source cannot hold more than 16 sockets, and closing one restores a slot', () => {
  const gate = new Admission(() => 0);
  const key = '192.0.2.1';
  const close = Array.from({ length: 16 }, () => {
    assert.equal(gate.upgrade(key), 0);
    return gate.opened(key);
  });
  assert.equal(gate.upgrade(key), 429);
  assert.equal(gate.upgrade('192.0.2.2'), 0);
  close[0]();
  assert.equal(gate.upgrade(key), 0);
});

test('sequential upgrades and new visitors have independent budgets that replenish', () => {
  let now = 0;
  const gate = new Admission(() => now);
  const key = '192.0.2.1';
  assert.equal(gate.upgrade(key), 0);
  const close = gate.opened(key);
  for (let i = 1; i < 24; i++) {
    assert.equal(gate.upgrade(key), 0);
    gate.opened(key)();
  }
  assert.equal(gate.upgrade(key), 429);
  for (let i = 0; i < 8; i++) assert.equal(gate.guest(key), true);
  assert.equal(gate.guest(key), false);
  now = 500;
  assert.equal(gate.upgrade(key), 0);
  assert.equal(gate.guest(key), false);
  now = 5000;
  assert.equal(gate.guest(key), true);
  close();
});

test('distributed upgrades are bounded and idle sources expire while active ones survive', () => {
  let now = 0;
  const gate = new Admission(() => now);
  const first = '2001:db8:0::/64';
  assert.equal(gate.upgrade(first), 0);
  const close = gate.opened(first);
  for (let i = 1; i <= 8192; i++) {
    assert.equal(gate.upgrade(`2001:db8:${i.toString(16)}::/64`), i < 256 ? 0 : 503);
  }
  assert.equal(gate.sources.size, 256);
  now = 125;
  assert.equal(gate.upgrade('192.0.2.1'), 0);
  assert.equal(gate.upgrade('192.0.2.2'), 503);
  now = 60000;
  assert.equal(gate.upgrade('192.0.2.2'), 0);
  assert.equal(gate.sources.size, 3);
  assert.equal(gate.sources.get(first).open, 1);
  close();
});

test('rotating IPs do not bypass the shared new visitor budget', () => {
  let now = 0;
  const gate = new Admission(() => now);
  for (let i = 1; i <= 49; i++) {
    const key = `192.0.2.${i}`;
    assert.equal(gate.upgrade(key), 0);
    assert.equal(gate.guest(key), i <= 48);
  }
  now = 1000;
  assert.equal(gate.guest('192.0.2.49'), true);
});
