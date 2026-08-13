/**
 * A scratch driver: a screenshot of every place, at one window size.
 *
 *   npm run probe -- 390 844 scratch/phone
 *
 * Not a gate. It exists because the desk shows a different set of keys at every place and the
 * only way to know they all fit is to look at all of them.
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { collide, open, selectView } from './page';

const [w = '1440', h = '900', out = 'scratch/probe'] = process.argv.slice(2);
const width = Number(w);
const height = Number(h);
await mkdir(resolve(out), { recursive: true });

const session = await open(width, height);
try {
  await collide(session.page, 2);
  for (const view of ['complex', 'sps', 'ti', 'lhc', 'ip-a']) {
    await selectView(session.page, view);
    const file = resolve(out, `${view}.png`);
    await session.page.screenshot({ path: file as `${string}.png` });
    console.log(file);
  }
  if (session.errors.length > 0) console.log(`page errors:\n  ${session.errors.join('\n  ')}`);
} finally {
  await session.close();
}
