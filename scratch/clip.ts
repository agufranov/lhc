import { open, selectView } from '../scripts/browser/page';
for (const [w, h] of [[1361, 900], [1370, 900], [1280, 860], [2560, 1440]] as Array<[number, number]>) {
  const s = await open(w, h);
  try {
    for (const view of ['complex', 'sps', 'ti', 'lhc', 'ip-a', 'ip-b']) {
      await selectView(s.page, view);
      const m = await s.page.evaluate(() => {
        const bay = document.querySelector('.deck-keys')!;
        const b = bay.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(bay).paddingLeft);
        const keys = Array.from(document.querySelectorAll('#controls button'))
          .filter((el) => (el as HTMLElement).offsetParent !== null && el.closest('.deck-keys'));
        const over = keys
          .map((el) => Math.round(el.getBoundingClientRect().right - (b.right - pad)))
          .reduce((a, x) => Math.max(a, x), -999);
        return { room: Math.round(b.width - 2 * pad), over };
      });
      if (m.over > 0) console.log(`  ${w}  ${view}: ${m.over} px OVER (room ${m.room})`);
    }
    console.log(`${w}x${h}: checked`);
  } finally {
    await s.close();
  }
}
