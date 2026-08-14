import { open, selectView, wait } from '../scripts/browser/page';
const [w = '1440', h = '900', out = 'scratch/deck.png', sel = '#controls'] = process.argv.slice(2);
const s = await open(Number(w), Number(h));
try {
  await selectView(s.page, 'lhc');
  await wait(1);
  const el = await s.page.$(sel);
  await el!.screenshot({ path: out as `${string}.png` });
  console.log(out);
} finally {
  await s.close();
}
