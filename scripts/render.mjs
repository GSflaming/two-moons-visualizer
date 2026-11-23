import { parseArgs } from 'node:util';
import { readFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { resolve, dirname, join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { GlobalFonts } from '@napi-rs/canvas';
import { createRenderer } from '../src/renderer.mjs';
import { validateInput } from '../src/input.mjs';

const { values } = parseArgs({ options: {
  data: { type: 'string', default: 'examples/demo.json' },
  audio: { type: 'string' }, output: { type: 'string' },
  start: { type: 'string' }, duration: { type: 'string' },
  fps: { type: 'string', default: '60' },
  font: { type: 'string', default: process.env.VISUALIZER_FONT },
  snapshot: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} });
if (values.help) {
  console.log('node scripts/render.mjs [--data events.json] [--audio recording.wav] [--output output.mp4] [--start seconds] [--duration seconds] [--fps 60] [--snapshot] [--font font.ttf]');
  process.exit(0);
}
const data = validateInput(JSON.parse(await readFile(resolve(values.data), 'utf8')));
if (values.font && !GlobalFonts.registerFromPath(resolve(values.font))) {
  throw new Error('Could not load the supplied font');
}
const renderer = createRenderer(data);
const start = Number(values.start ?? data.presentation?.start ?? 0);
const fps = Number(values.fps);
const duration = Math.min(Number(values.duration ?? renderer.duration - start), renderer.duration - start);
if (!Number.isFinite(start) || start < 0 || start >= renderer.duration ||
    !Number.isFinite(duration) || duration <= 0 ||
    !Number.isInteger(fps) || fps < 1 || fps > 120) {
  throw new Error('Invalid start, duration or fps');
}
const output = resolve(values.output ?? (values.snapshot ? 'output/preview.png' : 'output/visualizer.mp4'));
if (extname(output).toLowerCase() !== (values.snapshot ? '.png' : '.mp4')) {
  throw new Error('Use a .png output for snapshots or .mp4 for video');
}
if (values.audio && !values.snapshot) {
  const audioPath = resolve(values.audio);
  const expected = data.audioSha256 ?? data.parts?.audioSha256 ?? data.song?.audioMetadata?.sha256;
  if (expected && expected !== createHash('sha256').update(await readFile(audioPath)).digest('hex')) {
    throw new Error('Audio SHA-256 does not match the aligned event data');
  }
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audioPath], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) throw new Error('ffprobe could not read the audio. Install FFmpeg and check the input path.');
  const audioDuration = Number(JSON.parse(probe.stdout).format.duration);
  if (!Number.isFinite(audioDuration) || audioDuration + .05 < start + duration) {
    throw new Error('Audio is shorter than the requested render range');
  }
}
await mkdir(dirname(output), { recursive: true });
const scratch = await mkdtemp(join(dirname(output), '.render-'));
let encoder;
let completed;
try {
  const temporary = join(scratch, values.snapshot ? 'frame.png' : 'video.mp4');
  if (values.snapshot) {
    renderer.draw(start);
    await import('node:fs/promises').then(fs => fs.writeFile(temporary, renderer.canvas.toBuffer('image/png')));
  } else {
    const args = ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'mjpeg', '-i', 'pipe:0'];
    if (values.audio) args.push('-ss', String(start), '-i', resolve(values.audio));
    args.push('-map', '0:v:0');
    if (values.audio) args.push('-map', '1:a:0');
    args.push('-t', String(duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=in_range=full:out_range=limited:out_color_matrix=bt709',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
    if (values.audio) {
      const gain = data.presentation?.gainDb ?? 0;
      if (!Number.isFinite(gain) || gain < -60 || gain > 12) throw new Error('Invalid gainDb');
      args.push('-c:a', 'aac', '-b:a', '320k', '-af', `volume=${gain}dB,afade=t=in:d=0.005`);
    }
    args.push('-map_metadata', '-1', '-movflags', '+faststart', temporary);
    encoder = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let error;
    let stderr = '';
    encoder.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
    encoder.stdin.on('error', reason => { error = reason; });
    completed = new Promise(resolve => {
      encoder.once('error', reason => { error = reason; });
      encoder.once('close', code => resolve(code));
    });
    const frames = Math.ceil(duration * fps);
    for (let frame = 0; frame < frames; frame++) {
      if (error || encoder.exitCode !== null) throw error ?? new Error(stderr || 'FFmpeg exited early');
      renderer.draw(Math.min(renderer.duration - 1e-7, start + frame / fps));
      if (!encoder.stdin.write(renderer.canvas.toBuffer('image/jpeg', 96))) await once(encoder.stdin, 'drain');
    }
    encoder.stdin.end();
    const code = await completed;
    if (error || code !== 0) throw new Error('FFmpeg failed. ' + (stderr || error?.message || 'Check the installed encoder.'));
  }
  await rename(temporary, output);
  console.log(output);
} finally {
  if (encoder && encoder.exitCode === null && encoder.signalCode === null) {
    encoder.kill();
    await completed;
  }
  await rm(scratch, { recursive: true, force: true });
}
