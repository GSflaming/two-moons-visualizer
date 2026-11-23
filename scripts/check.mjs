import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRenderer } from '../src/renderer.mjs';
import { validateInput } from '../src/input.mjs';

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await check(path);
    else if (path.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    }
  }
}
await check('src');
await check('scripts');
await check('tests');
const data = validateInput(JSON.parse(await readFile('examples/demo.json', 'utf8')));
const renderer = createRenderer(data);
renderer.draw(0);
renderer.draw(renderer.duration - 1e-4);
console.log('Syntax, example validation and renderer initialization passed. No browser bundle is required.');
