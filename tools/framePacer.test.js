import assert from 'node:assert/strict';
import test from 'node:test';
import { FramePacer } from '../src/framePacer.js';

test('a 30 FPS render cap preserves animation time and independent gameplay updates', () => {
  for (const screenHz of [60, 90, 120, 144]) {
    const draw = new FramePacer();
    const sim = new FramePacer();
    let draws = 0, steps = 0, simulatedMs = 0;
    for (let i = 0; i <= screenHz * 10; i++) {
      const now = i * 1000 / screenHz;
      const dt = sim.take(now, 60);
      if (draw.take(now, 30) > 0) draws++;
      if (dt > 0) { steps++; simulatedMs += dt; }
    }
    assert.equal(draws, 300);
    assert.equal(steps, 600);
    assert.equal(simulatedMs, 10000);
  }
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
