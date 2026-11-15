import assert from 'node:assert/strict';
import test from 'node:test';
import { Spray } from '../src/spray.js';

test('spray uploads only live particles and stops uploading when they expire', () => {
  const spray = new Spray(12);
  const { geometry } = spray.points;
  const position = geometry.attributes.iPos;
  spray.update(0.02);
  assert.equal(position.version, 0);
  assert.equal(spray.points.visible, false);
  spray.emit(1, 0, 0, 0, 0, 0, 0.01, 1);
  spray.emit(2, 0, 0, 0, 0, 0, 0.2, 0.5);
  spray.update(0.02);
  assert.equal(geometry.instanceCount, 1);
  assert.equal(spray.points.visible, true);
  assert.deepEqual(position.updateRanges, [{ start: 0, count: 3 }]);
  assert.equal(position.array[0], 2);
  assert.equal(geometry.attributes.iSize.array[0], 0.5);
  assert.ok(geometry.attributes.iA.array[0] > 0);
  spray.update(0.2);
  assert.equal(geometry.instanceCount, 0);
  assert.equal(spray.points.visible, false);
  const version = position.version;
  spray.update(0.02);
  assert.equal(position.version, version);
});

test('continuous spray stays within capacity and resumes after an empty interval', () => {
  const spray = new Spray(2);
  for (let x = 1; x <= 5; x++) spray.emit(x, 0, 0, 0, 0, 0, 0.1, x);
  spray.update(0.02);
  assert.equal(spray.points.geometry.instanceCount, 2);
  assert.deepEqual([...spray.size], [5, 4]);
  spray.update(0.11);
  spray.emit(6, 0, 0, 0, 0, 0, 0.1, 6);
  spray.update(0.02);
  assert.equal(spray.points.geometry.instanceCount, 1);
  assert.equal(spray.size[0], 6);
});
