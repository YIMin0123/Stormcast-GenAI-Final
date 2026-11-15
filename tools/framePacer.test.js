import assert from 'node:assert/strict';
import test from 'node:test';
import { FramePacer, RefreshRateProbe } from '../src/framePacer.js';

test('render caps preserve animation time and independent gameplay updates', () => {
  for (const limit of [30, 45, 60, 90, 120]) {
    for (const screenHz of [60, 90, 120, 144]) {
      if (limit > screenHz) continue;
      const draw = new FramePacer();
      const sim = new FramePacer();
      let draws = 0, steps = 0, simulatedMs = 0;
      for (let i = 0; i <= screenHz * 10; i++) {
        const now = i * 1000 / screenHz;
        const dt = sim.take(now, 60);
        if (draw.take(now, limit) > 0) draws++;
        if (dt > 0) { steps++; simulatedMs += dt; }
      }
      assert.equal(draws, limit * 10, `${limit} FPS on ${screenHz} Hz`);
      assert.equal(steps, 600);
      assert.equal(simulatedMs, 10000);
    }
  }
});

test('the browser clock unlocks only sustainable choices, including integer timestamps and dropped frames', () => {
  for (const [screenHz, expected] of [[30, 30], [60, 60], [90, 90], [120, 120], [144, 120]]) {
    const probe = new RefreshRateProbe();
    let tick = 0;
    for (let i = 0; i <= 64; i++) {
      tick += i % 7 === 0 ? 2 : 1;
      probe.sample(Math.round(tick * 1000 / screenHz));
    }
    assert.equal(probe.hz, expected, `${screenHz} Hz`);
  }
});

test('refresh capability ignores isolated fast callbacks and survives temporary slowdown', () => {
  const probe = new RefreshRateProbe();
  for (let i = 0; i <= 32; i++) probe.sample(i * 1000 / 60 - (i === 5 ? 10 : 0));
  assert.equal(probe.hz, 60);
  probe.reset();
  for (let i = 0; i <= 32; i++) probe.sample(i * 1000 / 90);
  assert.equal(probe.hz, 90);
  probe.reset();
  for (let i = 0; i <= 32; i++) probe.sample(i * 1000 / 60);
  assert.equal(probe.hz, 90);
});

test('changing rate or resuming from a hidden page starts a new timing interval', () => {
  const clock = new FramePacer();
  assert.equal(clock.take(0, 20), 0);
  assert.equal(clock.take(17, 20), null);
  assert.equal(clock.take(20, 60), 0);
  assert.equal(clock.take(37, 60), 17);
  clock.reset();
  assert.equal(clock.take(22000, 60), 0);
  assert.equal(clock.take(22010, 60), null);
  assert.equal(clock.take(22017, 60), 17);
});

test('a missed deadline does not queue catch-up renders, including on a variable refresh display', () => {
  const clock = new FramePacer();
  assert.equal(clock.take(0, 30), 0);
  assert.equal(clock.take(32.9, 30), 32.9);
  assert.equal(clock.take(103, 30), 103 - 32.9);
  assert.equal(clock.take(112, 30), null);
  assert.equal(clock.take(134, 30), 31);
});
