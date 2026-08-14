import { open } from '../scripts/browser/page';
const s = await open(390, 844);
try {
  const m = await s.page.evaluate(() => {
    const bar = document.getElementById('viewbar')!;
    const tabs = Array.from(bar.querySelectorAll('.control--tab')).map((t) => ({
      t: (t.textContent ?? '').trim(),
      r: Math.round(t.getBoundingClientRect().right),
      h: Math.round(t.getBoundingClientRect().height),
    }));
    return { width: bar.clientWidth, scroll: bar.scrollWidth, tabs, deck: Math.round(document.getElementById('controls')!.getBoundingClientRect().height) };
  });
  console.log(`places: ${m.scroll} px of content in ${m.width}; deck ${m.deck} px tall`);
  console.log(m.tabs.map((t) => `${t.t}@${t.r}/${t.h}`).join(' '));
} finally {
  await s.close();
}
