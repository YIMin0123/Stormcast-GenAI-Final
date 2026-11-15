import assert from 'node:assert/strict';
import test from 'node:test';
import { FramePacer } from '../src/framePacer.js';
import { QualityTiming, reducedQuality } from '../src/adaptiveQuality.js';

test('normal 45 FPS cadence on a 60 Hz display does not count as jitter', () => {
  const clock = new FramePacer(), timing = new QualityTiming(), actions = [];
  for (let i = 0; i < 1200; i++) {
    const now = i * 1000 / 60;
    if (clock.take(now, 45) !== null) actions.push(timing.sample(now, 45));
  }
  assert.ok(!actions.includes('lower'));
  assert.ok(actions.includes('raise'));
});

test('isolated stalls do not trigger a reduction and sustained drops do', () => {
  const timing = new QualityTiming();
  for (let i = 0; i <= 360; i++) {
    const now = i * 1000 / 60 + (i >= 175 ? 220 : 0);
    assert.notEqual(timing.sample(now, 60), 'lower');
  }
  timing.reset();
  const actions = Array.from({ length: 220 }, (_, i) => timing.sample(i * 1000 / 30, 60));
  assert.equal(actions.slice(0, 150).includes('lower'), false);
  assert.ok(actions.includes('lower'));
});

test('adaptive stages never increase effects above saved preferences or change view settings', () => {
  const saved = { shadow: 2, grass: 2, ao: false, bloom: true, rays: true, wet: true, msaa: true, view: 2, fov: 61 };
  const original = { ...saved };
  const stages = [0, 1, 2, 3].map((level) => reducedQuality(saved, level));
  assert.deepEqual(stages.map((g) => [g.shadow, g.grass, g.bloom]), [[2, 2, true], [2, 2, false], [1, 1, false], [0, 0, false]]);
  assert.ok(stages.every((g) => !g.ao && g.fov === 61 && g.view === 2));
  assert.deepEqual(saved, original);
});
