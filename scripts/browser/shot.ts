/**
 * A screenshot of the running toy, headless. See `page.ts` for why there is a browser here.
 *
 *   npm run shot -- [width] [height] [out.png] [settle seconds]
 *
 * It drives the machine to two colliding beams first, because an empty collider photographs
 * none of the things worth looking at — the experiments' panels are not even on screen until
 * something has triggered.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { collide, open } from './page';

const [w = '1920', h = '1080', out = 'shot.png', settle = '8'] = process.argv.slice(2);
const width = Number(w);
const height = Number(h);
const file = resolve(out);
await mkdir(dirname(file), { recursive: true });

const session = await open(width, height);
try {
  await collide(session.page, Number(settle));
  await session.page.screenshot({ path: file as `${string}.png` });
  if (session.errors.length > 0) console.log(`page errors:\n  ${session.errors.join('\n  ')}`);
  console.log(`${width}x${height} -> ${file}`);
} finally {
  await session.close();
}
