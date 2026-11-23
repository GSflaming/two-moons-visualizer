import { parseChord } from './theory.mjs';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const number = value => typeof value === 'number' && Number.isFinite(value);
function notes(events, duration, start = 'start', end = 'end') {
  check(Array.isArray(events), 'Expected a note event array');
  events.forEach((event, i) => {
    check(number(event[start]) && event[start] >= 0 && number(event[end]) &&
      event[end] > event[start] && event[end] <= duration + .025, 'Invalid note time range');
    check(Number.isInteger(event.pitch) && event.pitch >= 0 && event.pitch <= 127, 'Invalid MIDI pitch');
    check(i === 0 || event[start] >= events[i - 1][start], 'Events must be sorted by start time');
    if (event.string != null) check(Number.isInteger(event.string) && event.string >= 1 && event.string <= 6 &&
      Number.isInteger(event.fret) && event.fret >= 0 && event.fret <= 36, 'Invalid guitar position');
  });
}

export function validateInput(data) {
  check(number(data.duration) && data.duration > 0, 'Invalid duration');
  check(Array.isArray(data.bars) && data.bars.length > 0, 'Missing bars');
  data.bars.forEach((bar, i) => {
    const [n, d] = bar.meter ?? [];
    check(Number.isInteger(n) && n > 0 && n <= 32 && [1, 2, 4, 8, 16, 32].includes(d), 'Invalid meter');
    check(number(bar.start) && bar.start >= 0 && number(bar.end) && bar.end > bar.start &&
      bar.end <= data.duration + .025, 'Invalid bar range');
    check(!i || Math.abs(bar.start - data.bars[i - 1].end) < 1e-5, 'Bars must be contiguous');
    check(Array.isArray(bar.pulses) && bar.pulses.length === n + 1 &&
      bar.pulses[0] === bar.start && bar.pulses.at(-1) === bar.end &&
      bar.pulses.every((t, j) => number(t) && (!j || t > bar.pulses[j - 1])), 'Invalid pulse boundaries');
  });
  check(Array.isArray(data.drums), 'Missing drum array');
  for (const event of data.drums) {
    const bar = data.bars[event.bar - 1];
    check(Number.isInteger(event.bar) && bar && number(event.time) &&
      event.time >= bar.start - 1e-5 && event.time < bar.end + 1e-5, 'Drum hit outside its bar');
    check(Number.isInteger(event.pitch) && event.pitch >= 0 && event.pitch <= 127, 'Invalid drum pitch');
  }
  check(Array.isArray(data.guitars) && data.guitars.length === 2, 'Expected two guitars');
  for (const guitar of data.guitars) notes(guitar.notes, data.duration);
  check(Array.isArray(data.chords), 'Missing chord array');
  for (const [i, chord] of data.chords.entries()) {
    check(number(chord.start) && number(chord.end) && chord.start >= 0 &&
      chord.end > chord.start && chord.end <= data.duration + .025 &&
      (!i || chord.start >= data.chords[i - 1].end - 1e-5), 'Invalid chord interval');
    parseChord(chord.symbol);
  }
  return data;
}
