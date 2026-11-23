import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// This original calibration study is synthesized locally. It contains no
// melody, recording or transcription from the artists named by the project.
const data = JSON.parse(await readFile('examples/demo.json', 'utf8'));
const duration = data.duration ?? data.parts?.duration ?? data.song.audioMetadata.durationSeconds;
const rate = 24000;
const samples = new Float64Array(Math.ceil(duration * rate));
const pitched = data.guitars
  ? data.guitars.flatMap(g => g.notes)
  : data.parts.guitar ? [...data.parts.guitar.notes, ...data.parts.piano.notes]
  : data.parts.slice(0, 3).flat().map(n => ({ ...n, end: n.endTime }));
const drums = data.drums ?? (Array.isArray(data.parts) ? data.parts[3].map(n => ({ ...n, time: n.start })) : []);
for (const note of pitched) {
  const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
  const end = note.end;
  for (let i = Math.ceil(note.start * rate); i < Math.min(samples.length, Math.ceil(end * rate)); i++) {
    const age = i / rate - note.start;
    const envelope = Math.min(1, age / .006, (end - i / rate) / .025);
    samples[i] += .045 * Math.sin(2 * Math.PI * frequency * age) * envelope * Math.exp(-age * 1.2);
  }
}
for (const event of drums) {
  for (let j = 0; j < rate * .1; j++) {
    const i = Math.round(event.time * rate) + j;
    if (i >= samples.length) break;
    const frequency = event.pitch === 36 ? 75 : event.pitch === 38 ? 183 : 3300;
    samples[i] += .08 * Math.sin(2 * Math.PI * frequency * j / rate) * Math.exp(-j / rate * 65);
  }
}
const wav = Buffer.alloc(44 + samples.length * 4);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28);
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(samples.length * 4, 40);
for (let i = 0; i < samples.length; i++) {
  const value = Math.round(Math.max(-1, Math.min(1, samples[i])) * 20000);
  wav.writeInt16LE(value, 44 + i * 4);
  wav.writeInt16LE(value, 46 + i * 4);
}
await mkdir('output', { recursive: true });
await writeFile('output/demo.wav', wav);
const hash = createHash('sha256').update(wav).digest('hex');
data.audioSha256 = hash;
if (data.parts?.guitar) data.parts.audioSha256 = hash;
if (data.song) data.song.audioMetadata.sha256 = hash;
await writeFile('output/demo.json', JSON.stringify(data));
const result = spawnSync(process.execPath, ['scripts/render.mjs', '--data', 'output/demo.json', '--audio', 'output/demo.wav',
  '--output', 'output/demo.mp4', '--fps', '30'], { stdio: 'inherit' });
if (result.error || result.status !== 0) process.exit(result.status || 1);
