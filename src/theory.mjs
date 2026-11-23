import { midiAt, PRESETS, parsePositions } from './vendor/fret-note/music.mjs';

const letters = 'CDEFGAB';
const naturals = [0, 2, 4, 5, 7, 9, 11];
export const pc = (midi) => ((midi % 12) + 12) % 12;
export const tuning = Object.freeze([...PRESETS.standard.notes]);
const ascii = (value) => String(value).trim().replaceAll('♭', 'b').replaceAll('♯', '#')
  .replaceAll('𝄫', 'bb').replace(/[𝄪]/gu, '##').replaceAll('x', '##');
export const display = (value) => String(value).replace(/(?<=[A-G])[b#]+|[b#]+(?=\d)/g, (accidental) =>
  ({ bb: '𝄫', '##': '𝄪' })[accidental] ?? accidental.replaceAll('b', '♭').replaceAll('#', '♯'));

export function parseNote(value) {
  const match = ascii(value).match(/^([A-Ga-g])(#+|b+)?(-?\d+)?$/);
  if (!match) throw new Error(`无效音名 ${value}`);
  const [, name, accidental = '', octaveText] = match;
  const letter = name.toUpperCase();
  const index = letters.indexOf(letter);
  const raw = naturals[index] + accidental.length * (accidental.startsWith('b') ? -1 : 1);
  const midi = octaveText === undefined ? null : 12 * (Number(octaveText) + 1) + raw;
  if (midi !== null && (!Number.isInteger(midi) || midi < 0 || midi > 127)) {
    throw new Error(`音高超出 MIDI 0–127 ${value}`);
  }
  return { name: letter + accidental, index, raw, pc: pc(raw), midi };
}

export function spelledPitch(note, midi) {
  if (pc(midi) !== note.pc) throw new Error('音名和 MIDI 音高不一致');
  return note.name + (Math.floor((midi - note.raw) / 12) - 1);
}

const diatonic = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 14, 11: 17, 13: 21 };
function chordTone(root, degree, alteration) {
  const steps = diatonic[degree] + alteration;
  const unwrapped = root.index + degree - 1;
  const letter = unwrapped % 7;
  const natural = naturals[letter] + 12 * Math.floor(unwrapped / 7);
  const offset = root.raw + steps - natural;
  const note = parseNote(letters[letter] + (offset < 0 ? 'b'.repeat(-offset) : '#'.repeat(offset)));
  const prefix = alteration < 0 ? 'b'.repeat(-alteration) : '#'.repeat(alteration);
  return { ...note, degree, interval: prefix + degree, steps,
    role: ({ 1: 'root', 3: 'third', 5: 'fifth', 7: 'seventh' })[degree] ?? 'tension' };
}

export function parseChord(value) {
  const text = ascii(value).replace(/\s/g, '').replace(/−/g, '-');
  const match = text.match(/^([A-G](?:#+|b+)?)(.*?)(?:\/([A-G](?:#+|b+)?))?$/);
  if (!match) throw new Error(`无效和弦 ${value}`);
  const [, rootName, rawQuality, slash] = match;
  const root = parseNote(rootName);
  const bass = slash ? parseNote(slash) : root;
  let quality = rawQuality.replaceAll('Δ', 'maj').replace(/^M/, 'maj').replace(/^min/, 'm')
    .replace(/^ø(?:7)?/, 'm7b5').replace(/^°/, 'dim').replace(/^-/,'m')
    .replace(/7\(9\)/g, '9').replace(/[(),]/g, '');
  const intervals = new Map([[1, 0], [3, 0], [5, 0]]);
  const added = [];
  const kind = quality.match(/^(mMaj|maj|dim|aug|m|\+)(?!aj)/)?.[0] ?? '';
  quality = quality.slice(kind.length);
  if (['m', 'mMaj', 'dim'].includes(kind)) intervals.set(3, -1);
  if (kind === 'dim') intervals.set(5, -1);
  if (['aug', '+'].includes(kind)) intervals.set(5, 1);
  const majorSeventh = kind === 'maj' || kind === 'mMaj';
  const extension = quality.match(/^(13|11|9|7|6|5)/)?.[0];
  if (extension) {
    quality = quality.slice(extension.length);
    const number = Number(extension);
    if (number === 5) intervals.delete(3);
    if (number === 6) intervals.set(6, 0);
    if (number >= 7) intervals.set(7, majorSeventh ? 0 : kind === 'dim' ? -2 : -1);
    for (const degree of [9, 11, 13]) if (number >= degree) intervals.set(degree, 0);
  }
  const replaced = new Set();
  while (quality.length) {
    const token = quality.match(/^(sus[24]?|alt|(add|omit|no)?(#+|b+)?(13|11|9|7|6|5|4|3|2))/);
    if (!token) throw new Error(`不支持的和弦记号 ${value}（${quality}）`);
    quality = quality.slice(token[0].length);
    if (token[0].startsWith('sus')) {
      intervals.delete(3);
      intervals.set(token[0] === 'sus2' ? 2 : 4, 0);
      continue;
    }
    if (token[0] === 'alt') {
      if (!intervals.has(7)) intervals.set(7, -1);
      intervals.delete(5);
      intervals.delete(9);
      added.push([5, -1], [5, 1], [9, -1], [9, 1]);
      continue;
    }
    const [, , action, accidental = '', degreeText] = token;
    const degree = Number(degreeText);
    const alteration = accidental.length * (accidental.startsWith('b') ? -1 : 1);
    if (action === 'no' || action === 'omit') {
      intervals.delete(degree);
      for (let i = added.length - 1; i >= 0; i--) if (added[i][0] === degree) added.splice(i, 1);
    } else if (action === 'add' || replaced.has(degree)) {
      added.push([degree, alteration]);
    } else {
      intervals.set(degree, alteration);
      replaced.add(degree);
    }
  }
  const unique = new Map([...intervals, ...added].map(([degree, alt]) => [`${degree}:${alt}`, [degree, alt]]));
  const tones = [...unique.values()].sort(([a, x], [b, y]) => a - b || x - y)
    .map(([degree, alt]) => chordTone(root, degree, alt));
  return { symbol: text, root, bass, tones, slash: Boolean(slash), alteredSet: /alt/.test(rawQuality) };
}

export function harmonicRelation(chord, key) {
  if (!key?.tonic) return null;
  const tonic = parseNote(key.tonic);
  const degree = (chord.root.index - tonic.index + 7) % 7 + 1;
  const steps = pc(chord.root.pc - tonic.pc);
  const expected = diatonic[degree];
  const difference = ((steps - expected + 18) % 12) - 6;
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][degree - 1];
  const third = chord.tones.find(tone => tone.degree === 3);
  const fifth = chord.tones.find(tone => tone.degree === 5);
  const sign = difference < 0 ? '♭'.repeat(-difference) : '♯'.repeat(difference);
  return sign + (third?.interval === 'b3' ? roman.toLowerCase() : roman) +
    (fifth?.interval === 'b5' && third?.interval === 'b3' ? '°' : '');
}

export function guitarPositions(chord, min = 0, max = 24) {
  const positions = [];
  for (let string = 1; string <= 6; string++) {
    for (let fret = min; fret <= max; fret++) {
      const midi = midiAt(tuning, string, fret);
      const tone = chord.tones.find(tone => tone.pc === pc(midi));
      if (tone) positions.push({ string, fret, midi, tone, name: spelledPitch(tone, midi) });
    }
  }
  return positions;
}

export function positionVoices(positions, chord) {
  const strings = new Set();
  return positions.map(({ string, fret }) => {
    if (!Number.isInteger(string) || string < 1 || string > 6 || !Number.isInteger(fret) ||
        fret < 0 || fret > 24 || strings.has(string)) throw new Error('每弦最多一个有效的 0–24 品位');
    strings.add(string);
    const midi = midiAt(tuning, string, fret);
    const tone = chord.tones.find(tone => tone.pc === pc(midi)) ??
      (chord.bass.pc === pc(midi) ? chord.bass : null);
    return { string, fret, midi, id: `string-${string}`, instrument: 'guitar',
      name: tone ? spelledPitch(tone, midi) : null, tone: tone?.role ? tone : null };
  });
}
export const parseFingering = parsePositions;

export function theoreticalVoices(chord) {
  // Fold the symbolic pitches into one shared register for an illustrative comparison.
  return chord.tones.map(tone => {
    const midi = 55 + pc(tone.pc - 55);
    return { midi, name: spelledPitch(tone, midi), tone };
  });
}

export function fingeringOptions(chord, start, end, inversion = null) {
  const positions = guitarPositions(chord, start, end);
  if (!chord.tones.some(tone => tone.pc === chord.bass.pc)) {
    for (let string = 1; string <= 6; string++) {
      for (let fret = start; fret <= end; fret++) {
        const midi = midiAt(tuning, string, fret);
        if (pc(midi) === chord.bass.pc) positions.push({ string, fret, midi });
      }
    }
  }
  const bassPc = inversion ?? chord.bass.pc;
  const result = [];
  const essential = chord.tones.filter(tone => [3, 7].includes(tone.degree)).map(tone => tone.pc);
  const byString = Array.from({ length: 6 }, (_, index) =>
    positions.filter(position => position.string === 6 - index));
  function find(index, notes, min, max) {
    if (index === byString.length) {
      const pcs = new Set(notes.map(note => pc(note.midi)));
      if (pcs.size < Math.min(3, chord.tones.length) ||
          essential.some(pitch => !pcs.has(pitch))) return;
      if (pc(Math.min(...notes.map(note => note.midi))) !== bassPc) return;
      const missing = chord.tones.filter(tone => !pcs.has(tone.pc)).length;
      result.push({ positions: notes, score: missing * 20 + (max - min) + notes.length / 10 });
      return;
    }
    find(index + 1, notes, min, max);
    for (const note of byString[index]) {
      const nextMin = note.fret ? Math.min(min, note.fret) : min;
      const nextMax = note.fret ? Math.max(max, note.fret) : max;
      if (nextMax - nextMin <= 4) find(index + 1, [...notes, note], nextMin, nextMax);
    }
  }
  find(0, [], Infinity, 0);
  return result.sort((a, b) => a.score - b.score).slice(0, 6);
}
