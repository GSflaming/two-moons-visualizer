import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateInput } from '../src/input.mjs';
import { createRenderer } from '../src/renderer.mjs';
import { parseChord } from '../src/theory.mjs';
import { floorIndex } from '../src/timing.mjs';

const example = JSON.parse(await readFile(new URL('../examples/demo.json', import.meta.url)));
const digest = canvas => createHash('sha256').update(canvas.toBuffer('image/png')).digest('hex');

test('example renders deterministically across seeks and changes with time', () => {
  const input = structuredClone(example);
  const original = JSON.stringify(input);
  const renderer = createRenderer(validateInput(input));
  assert.equal(renderer.canvas.width, 1920);
  assert.equal(renderer.canvas.height, 1080);
  renderer.draw(.07);
  const before = digest(renderer.canvas);
  renderer.draw(2.65);
  // A font parser treating weight as size would spill glyphs into this margin.
  const margin = renderer.canvas.getContext('2d').getImageData(0, 0, 1920, 70).data;
  for (let i = 0; i < margin.length; i += 4) assert.equal(margin[i], 255);
  assert.notEqual(before, digest(renderer.canvas));
  renderer.draw(.07);
  assert.equal(before, digest(renderer.canvas));
  renderer.draw(renderer.duration - .0001);
  assert.equal(JSON.stringify(input), original);
});

test('event validation rejects negative time and reversed note duration', () => {
  const bad = structuredClone(example);
  const notes = bad.guitars?.[0].notes ?? bad.parts.guitar?.notes ?? bad.parts[0];
  notes[0].start = -1;
  assert.throws(() => validateInput(bad));
  const reversed = structuredClone(example);
  const second = reversed.guitars?.[0].notes ?? reversed.parts.guitar?.notes ?? reversed.parts[0];
  if ('endTime' in second[0]) second[0].endTime = second[0].start;
  else second[0].end = second[0].start;
  assert.throws(() => validateInput(reversed));
});

test('floor lookup selects an exact pulse boundary and handles pre-roll', () => {
  assert.equal(floorIndex([0, .5, 1], .5), 1);
  assert.equal(floorIndex([0, .5, 1], -.1), -1);
});

test('harmony retains altered intervals and slash bass', () => {
  const chord = parseChord('C7(b9)/E');
  assert.deepEqual(chord.tones.map(tone => tone.pc), [0, 4, 7, 10, 1]);
});

test('CLI rejects invalid fps without encoding', () => {
  const result = spawnSync(process.execPath, ['scripts/render.mjs', '--fps', '0'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid start, duration or fps/);
});

test('meter changes preserve pulse counts and empty parts can rest', () => {
  assert.deepEqual(example.bars.map(bar => bar.meter), [[4, 4], [7, 8], [3, 4], [4, 4]]);
  const resting = structuredClone(example);
  resting.drums = [];
  resting.chords = [];
  resting.guitars.forEach(g => { g.notes = []; });
  const renderer = createRenderer(validateInput(resting));
  for (const bar of resting.bars) {
    renderer.draw(bar.start);
    renderer.draw(bar.end - 1e-7);
  }
  const bad = structuredClone(example);
  bad.bars[1].pulses.pop();
  assert.throws(() => validateInput(bad), /pulse/);
});
