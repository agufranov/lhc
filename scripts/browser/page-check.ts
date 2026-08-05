/**
 * The overlay, measured in a real browser: **does anything cover anything?**
 *
 * ## Why this gate exists
 *
 * `check:render` drives the renderer against a recording mock canvas, so it sees every
 * drawing bug and no layout bug at all. The overlay is HTML on top of that canvas, and no
 * assertion about what the renderer was *asked to draw* can notice that a card is sitting on
 * another card. It went wrong exactly that way and shipped: the moment both experiments
 * triggered, the two event cards and the machine readouts were sharing one flex rail with
 * nowhere near enough height in it — POWER crushed to a 115 px scroller, INJECTOR pushed off
 * the bottom of it, and the lower card sliding under the button bar. Three green gates, one
 * screenshot to see it.
 *
 * So this one measures `getBoundingClientRect` on everything in the overlay and asserts what
 * a person would otherwise have to look for:
 *
 *  · no two cards overlap, and none of them is under the button bar;
 *  · no card is cut off by the window;
 *  · no card covers the machine — checked against the same bands the layout was given, so a
 *    card that has drifted off its band fails here rather than being noticed months later;
 *  · every card that should be visible is, and is not scrolling its own content away;
 *  · a card really is its picture plus `EVENT_CARD_CHROME`, which is the one number in
 *    `layout.ts` that is measured off the DOM rather than derived.
 *
 * Runs headless against a Vite server it starts itself if one is not already up.
 */

import {
  EVENT_CANVAS_MIN,
  EVENT_CARD_CHROME,
  EVENT_SIDE_HEIGHT,
  OVERHANG_ALLOWED,
  OVERLAY_PADDING,
} from '../../src/ui/layout';
import { collide, open } from './page';

interface Box {
  id: string;
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  /** How much taller its content is than the box — a panel scrolling itself away. */
  hidden: number;
}

const sizes: Array<[number, number]> = [
  [1280, 860],
  [1919, 906],
  [1600, 900],
  [2560, 1440],
];

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Two boxes overlap if they overlap on both axes. One pixel of touching is not an overlap. */
function overlap(a: Box, b: Box): number {
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return x > 0 && y > 0 ? Math.round(Math.min(x, y)) : 0;
}

for (const [width, height] of sizes) {
  console.log(`--- ${width}x${height} ---`);
  const session = await open(width, height);
  try {
    await collide(session.page, 2);

    const measured = await session.page.evaluate(() => {
      // The rails as whole boxes, not their contents: a rail is one scrolling column, and
      // what must not overlap anything is the column.
      const ids = ['rail-left', 'rail-right', 'panel-ip-a', 'panel-ip-b', 'controls'];
      const boxes = ids
        .map((id) => {
          const el = document.getElementById(id);
          // Not `offsetParent`: it is null for everything positioned `fixed`, which is most
          // of this overlay, and using it reported an empty screen.
          if (!el || el.hidden || getComputedStyle(el).display === 'none') return null;
          const r = el.getBoundingClientRect();
          return {
            id,
            top: r.top,
            left: r.left,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
            hidden: Math.max(0, el.scrollHeight - el.clientHeight),
          };
        })
        .filter((b): b is NonNullable<typeof b> => b !== null);
      const canvasEl = document.querySelector('#panel-ip-a .event-view') as HTMLElement | null;
      const style = getComputedStyle(document.documentElement);
      const num = (name: string): number => parseFloat(style.getPropertyValue(name));
      const hiddenIn = (id: string): number => {
        const el = document.getElementById(id);
        return el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0;
      };
      // The numbers beside the picture: a card is as tall as the taller of the two, which is
      // what `EVENT_CARD_CHROME` and `EVENT_SIDE_HEIGHT` are measured from.
      const sideEl = document.querySelector('#panel-ip-a .event-body > div:last-child');
      return {
        boxes,
        railHidden: hiddenIn('rail-right'),
        leftRailHidden: hiddenIn('rail-left'),
        pictureA: canvasEl?.getBoundingClientRect().width ?? 0,
        sideHeight: sideEl?.getBoundingClientRect().height ?? 0,
        bands: {
          injectorTop: num('--band-injector-top'),
          injectorBottom: num('--band-injector-bottom'),
          rightAbove: num('--event-a-machine-right'),
          rightBelow: num('--event-b-machine-right'),
        },
      };
    });

    const boxes: Box[] = measured.boxes;
    const by = (id: string): Box | undefined => boxes.find((b) => b.id === id);
    for (const b of boxes) {
      console.log(
        `       ${b.id.padEnd(14)} ${Math.round(b.left).toString().padStart(5)},` +
          `${Math.round(b.top).toString().padStart(4)}  ${Math.round(b.width)}x${Math.round(b.height)}` +
          `${b.hidden > 0 ? `  (${Math.round(b.hidden)} px of content scrolled away)` : ''}`,
      );
    }

    const a = by('panel-ip-a');
    const b = by('panel-ip-b');
    if (a) {
      console.log(
        `       picture ${Math.round(measured.pictureA)} px, numbers beside it ` +
          `${Math.round(measured.sideHeight)} px, card ${Math.round(a.height)} px tall`,
      );
    }
    check(
      'both experiments are on screen',
      !!a && !!b,
      `${boxes.filter((x) => x.id.startsWith('panel-ip')).length} of 2 — the run has to reach collisions`,
    );
    if (session.errors.length > 0) check('the page threw nothing', false, session.errors.join('; '));
    if (!a || !b) continue;

    // The one that shipped.
    let worst = '';
    let worstBy = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const px = overlap(boxes[i], boxes[j]);
        if (px > worstBy) {
          worstBy = px;
          worst = `${boxes[i].id} over ${boxes[j].id} by ${px} px`;
        }
      }
    }
    check('no panel is drawn over another panel', worstBy === 0, worst || 'nothing overlaps');

    // The right-hand rail is the one the experiments compete with, and the one that was
    // crushed. Wherever the cards stand *beside* it — the design, and what any window with
    // room for it gets — it must hold both its readouts whole. Where the window is too narrow
    // and the cards have retreated into the column, it scrolls, which is the stated retreat.
    //
    // The left-hand rail is never asserted: a filled beam readout, the physics and the
    // compute panel want 1020 px of column and no window here is that tall, so it scrolls —
    // strictly better than the overlap it used to be. See `limits.md`.
    const railBox = by('rail-right')!;
    const beside = a.right <= railBox.left && b.right <= railBox.left;
    if (!beside) {
      console.log('       (cards have retreated into the readout column — window too narrow)');
    }
    if (beside) {
      check(
        'the machine readouts are whole, not scrolled away',
        measured.railHidden === 0,
        `right rail hides ${Math.round(measured.railHidden)} px, ` +
          `left rail ${Math.round(measured.leftRailHidden)} px`,
      );
    }

    check(
      'every panel is inside the window',
      boxes.every(
        (b) => b.left >= 0 && b.top >= 0 && b.right <= width + 0.5 && b.bottom <= height + 0.5,
      ),
      boxes
        .filter((b) => b.left < 0 || b.top < 0 || b.right > width + 0.5 || b.bottom > height + 0.5)
        .map((b) => b.id)
        .join(', ') || 'all in',
    );

    // The cards stand in the bands the layout was given, not over the machine in them.
    const bands = measured.bands;
    // Clear of the injector always — that is what a band *is*. Clear of the rings too, except
    // that a card forced down to its floor size may reach `OVERHANG_ALLOWED` over them, and a
    // card that has retreated into the column is over whatever the column is over.
    const clears = (card: Box, machineRight: number): string => {
      const over = machineRight - card.left;
      if (over <= 0) return '';
      if (!beside) return '';
      return over > OVERHANG_ALLOWED ? `over the machine by ${Math.round(over)} px` : '';
    };
    check(
      'the top card stands clear of the injector, and of the machine beside it',
      a.bottom <= bands.injectorTop && clears(a, bands.rightAbove) === '',
      `card ${Math.round(a.left)}..${Math.round(a.bottom)}, machine ends at ` +
        `${Math.round(bands.rightAbove)} and the injector starts at ${Math.round(bands.injectorTop)}` +
        (clears(a, bands.rightAbove) ? ` — ${clears(a, bands.rightAbove)}` : ''),
    );
    check(
      'and the bottom card clears it the other way',
      b.top >= bands.injectorBottom && clears(b, bands.rightBelow) === '',
      `card ${Math.round(b.left)}..${Math.round(b.top)}, machine ends at ` +
        `${Math.round(bands.rightBelow)} and the injector ends at ${Math.round(bands.injectorBottom)}` +
        (clears(b, bands.rightBelow) ? ` — ${clears(b, bands.rightBelow)}` : ''),
    );

    check(
      'the picture is at least as big as a barrel is readable at',
      measured.pictureA >= EVENT_CANVAS_MIN - 0.5,
      `${Math.round(measured.pictureA)} px, floor is ${EVENT_CANVAS_MIN}`,
    );
    // Both constants are measured off this, and both move whenever the heading, the padding or
    // the wording of a row does — which is exactly when a card starts overrunning its band.
    check(
      `the numbers column is the ${EVENT_SIDE_HEIGHT} px the layout was told`,
      Math.abs(measured.sideHeight - EVENT_SIDE_HEIGHT) <= 2,
      `${Math.round(measured.sideHeight)} px`,
    );
    check(
      `a card is its taller column plus ${EVENT_CARD_CHROME} px of heading and padding`,
      Math.abs(a.height - (Math.max(measured.pictureA, measured.sideHeight) + EVENT_CARD_CHROME)) <= 1,
      `card ${Math.round(a.height)} px tall, picture ${Math.round(measured.pictureA)} px, ` +
        `numbers ${Math.round(measured.sideHeight)} px`,
    );
    // Their *right* edges, not their left ones: the two cards are sized independently from
    // their own bands, so they are different widths and only line up on the side they are
    // anchored to.
    check(
      'the two cards line up with each other and stand off the window edge',
      Math.abs(a.right - b.right) <= 0.5 && width - a.right >= OVERLAY_PADDING,
      `right edges ${Math.round(a.right)} and ${Math.round(b.right)}, window ${width}`,
    );

    if (session.errors.length > 0) check('the page threw nothing', false, session.errors.join('; '));
  } finally {
    await session.close();
  }
}

console.log('');
console.log(failures === 0 ? 'all page checks passed' : `${failures} page check(s) failed`);
if (failures > 0) process.exit(1);
