import { open, selectView } from '../scripts/browser/page';
const [w = '1440', h = '900'] = process.argv.slice(2);
const s = await open(Number(w), Number(h));
try {
  for (const view of ['complex', 'sps', 'ti', 'lhc', 'ip-a']) {
    await selectView(s.page, view);
    const m = await s.page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? Math.round(el.getBoundingClientRect().width) : -1;
      };
      const keys = Array.from(document.querySelectorAll('.deck-keys .control--cluster:not([hidden])'))
        .map((c) => Math.round(c.getBoundingClientRect().width));
      const bay = document.querySelector('.deck-keys')!.getBoundingClientRect();
      const over = Array.from(document.querySelectorAll('#controls button'))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({ t: (el.textContent ?? '').trim(), r: el.getBoundingClientRect().right }))
        .filter((k) => k.r > bay.right + 0.5 && document.querySelector('.deck-keys')!.contains(document.querySelector(`[data-control]`)));
      return {
        deck: r('#controls'), plate: r('.deck-plate'), keysBay: r('.deck-keys'),
        gauges: r('.deck-gauges'), safety: r('.deck-safety'),
        lamps: r('.deck-lamps'), cluster: keys, over: over.map((o) => o.t),
        deckH: Math.round(document.querySelector('#controls')!.getBoundingClientRect().height),
        bottom: Math.round(document.querySelector('#controls')!.getBoundingClientRect().bottom),
        win: window.innerHeight,
      };
    });
    console.log(`${view.padEnd(8)} deck ${m.deck}x${m.deckH} (bottom ${m.bottom}/${m.win}) plate ${m.plate} lamps ${m.lamps} keys-bay ${m.keysBay} cluster ${m.cluster} gauges ${m.gauges} safety ${m.safety}`);
  }
} finally {
  await s.close();
}
