import { mustPress, open, panelText, selectView, setRamp, until, wait } from '../scripts/browser/page';
const [w = '390', h = '844'] = process.argv.slice(2);
const s = await open(Number(w), Number(h));
const say = async (t: string) => console.log(`${t}: inj="${(await panelText(s.page, 'panel-injector')).trim().slice(0, 120)}"`);
try {
  await selectView(s.page, 'sps');
  await say('at sps');
  await setRamp(s.page, 'injector', false);
  await mustPress(s.page, 'fill');
  const ok1 = await until(s.page, 'panel-injector', (t) => /batches ready\s*[1-9]/.test(t));
  console.log(`batches ready: ${ok1}`);
  await say('after fill');
  await setRamp(s.page, 'injector', true);
  const ok2 = await until(s.page, 'panel-injector', (t) => t.includes('ready to extract'));
  console.log(`ready to extract: ${ok2}`);
  await mustPress(s.page, 'to-beam-1');
  const ok3 = await until(s.page, 'panel-beam', (t) => /beam 1\s*\d+ batches/.test(t));
  console.log(`beam 1 arrived: ${ok3}`);
  console.log(`beam: ${(await panelText(s.page, 'panel-beam')).trim().slice(0, 160)}`);
  await wait(1);
  console.log(`fps: ${(await panelText(s.page, 'panel-compute')).replace(/.*fps/, 'fps')}`);
  if (s.errors.length) console.log(`errors: ${s.errors.join('; ')}`);
} finally {
  await s.close();
}
