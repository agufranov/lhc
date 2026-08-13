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
import { collide, controlStates, open, selectView } from './page';

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

type ControlState = Array<{ label: string; blocked: boolean; shown: boolean; tab: boolean }>;

/**
 * The button bar's greying, at both ends of a run.
 *
 * The rule is in `ui/controls.ts`: a control is greyed only when pressing it would do
 * *nothing* — a ramp already programmed for the energy it asks for, cogging with one beam on
 * the orbit — and never when it would do something instructive and bad. The kickers are the
 * whole point of that second half and are asserted live in both states.
 */
function checkControls(idle: ControlState, running: ControlState): void {
  const state = (bar: ControlState, fragment: string): boolean | null =>
    bar.find((c) => c.label.includes(fragment))?.blocked ?? null;
  const expect = (bar: ControlState, when: string, want: Record<string, boolean>): void => {
    const wrong = Object.entries(want)
      .map(([fragment]) => [fragment, state(bar, fragment)] as const)
      .filter(([fragment, is]) => is !== want[fragment])
      .map(([fragment, is]) => `${fragment} is ${is === null ? 'missing' : is ? 'greyed' : 'live'}`);
    check(
      `the controls that would do nothing are greyed out — ${when}`,
      wrong.length === 0,
      wrong.join(', ') || `${Object.keys(want).length} controls as expected`,
    );
  };

  // **A ramp is one button now and is therefore never greyed**, in either state: it is a
  // setpoint, it always says which way it will go, and pressing it always changes something —
  // including in the middle of a ramp, which reverses it. What used to be greyed here was the
  // half of a pair that was already programmed, which is a control that should not have been
  // on screen at all. See `ui/controls.ts`.
  expect(idle, 'empty collider', {
    'ramp → 6.8 TeV': false,
    '◀ cog': true, // no beams to move against each other
    '◎ auto': true,
    'cog ▶': true,
  });
  expect(running, 'ramped and colliding', {
    'ramp → 450 GeV': false, // the collider is at flat top: the button now offers the way down
    '◀ cog': false,
    '◎ auto': false,
    'cog ▶': false,
  });
  // Never, in either state: arming a kicker into a machine that cannot capture the beam is
  // the most instructive press in the toy, and firing one at nothing is an operator's right.
  const kickers = { '→ LHC beam 1': false, '→ LHC beam 2': false, '⏻ beam 1': false, '⏻ beam 2': false };
  expect(idle, 'the kickers, empty', kickers);
  expect(running, 'the kickers, colliding', kickers);

  // **No tab is ever greyed**, and the dumps are never folded away. A tab is a camera
  // position, which cannot be a no-op — looking at an empty machine is a thing somebody may
  // want to do — and dumping the beam is the one action nobody should have to navigate to.
  for (const [when, bar] of [['empty', idle], ['colliding', running]] as const) {
    const tabs = bar.filter((c) => c.tab);
    const named = TAB_NAMES.filter((n) => tabs.some((t) => t.label.includes(n)));
    check(
      `every place is there and none is greyed out — ${when}`,
      tabs.length === TAB_NAMES.length && named.length === TAB_NAMES.length && tabs.every((t) => !t.blocked && t.shown),
      `${tabs.length} tabs, ${tabs.filter((t) => t.blocked).length} greyed: ${tabs.map((t) => t.label).join(' ')}`,
    );
    const dumps = bar.filter((c) => c.label.startsWith('⏻'));
    check(
      `both dumps are on screen whatever place is selected — ${when}`,
      dumps.length === 2 && dumps.every((d) => d.shown && !d.blocked),
      dumps.map((d) => `${d.label}${d.shown ? '' : ' (hidden)'}`).join(', '),
    );
  }
}

/** The places in the bar. `views.ts` names them; this is what they read as on screen. */
const TAB_NAMES = ['complex', 'SPS', 'TI 2', 'LHC', 'ATLAS', 'CMS'];

for (const [width, height] of sizes) {
  console.log(`--- ${width}x${height} ---`);
  const session = await open(width, height);
  try {
    // The button bar as it stands on an empty collider, before anything is pressed. What is
    // greyed here is what would do nothing here — and the kickers are not in it, at either
    // end of the run. See `ui/controls.ts`.
    const idle = await controlStates(session.page);
    await collide(session.page, 2);
    const running = await controlStates(session.page);
    checkControls(idle, running);

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
      // Per panel, not per rail. A rail with more in it than the window is tall scrolls, and
      // that is the stated retreat; a *panel* whose own content is scrolled away has been
      // crushed by the flexbox, which is the bug that shipped. They are different failures
      // and only the second one is one.
      const crushed = ['panel-beam', 'panel-physics', 'panel-compute', 'panel-run', 'panel-power', 'panel-injector']
        .map((id) => ({ id, by: hiddenIn(id) }))
        .filter((p) => p.by > 1);
      // The numbers beside the picture: a card is as tall as the taller of the two, which is
      // what `EVENT_CARD_CHROME` and `EVENT_SIDE_HEIGHT` are measured from.
      const sideEl = document.querySelector('#panel-ip-a .event-body > div:last-child');
      return {
        boxes,
        crushed,
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

    // **No panel is crushed.** Both rails hold more than a short window can show and both
    // scroll, which is the stated retreat and the one thing a column of numbers may do — the
    // right one has held the run panel since the spectra arrived, and the left one has never
    // fitted a filled beam readout plus the physics plus compute. See `limits.md`.
    //
    // What must not happen is the bug that shipped: the flexbox taking the space out of a
    // *panel*, so POWER became a 115 px scroller with the injector pushed off the bottom of
    // it. A rail that scrolls can be scrolled; a panel that has been shrunk cannot be found.
    const railBox = by('rail-right')!;
    const beside = a.right <= railBox.left && b.right <= railBox.left;
    if (!beside) {
      console.log('       (cards have retreated into the readout column — window too narrow)');
    }
    check(
      'no panel has been crushed — the rails scroll, their contents do not',
      measured.crushed.length === 0,
      measured.crushed.map((p) => `${p.id} hides ${Math.round(p.by)} px`).join(', ') ||
        `rails scroll by ${Math.round(measured.railHidden)} px right, ` +
          `${Math.round(measured.leftRailHidden)} px left`,
    );

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

    // The run panel: two live canvases in the right-hand rail. A plot with no box is a plot
    // nobody can see, and it is the one thing on the overlay that is not made of text.
    const plots = await session.page.evaluate(() =>
      Array.from(document.querySelectorAll('#panel-run .plot-view')).map((c) => {
        const r = c.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }),
    );
    check(
      'both spectra have a box to be drawn in',
      plots.length === 2 && plots.every((p) => p.w > 100 && p.h > 40),
      plots.map((p) => `${p.w}x${p.h}`).join(', ') || 'none',
    );

    // And the machine's own voice, which has to be there at a fixed height whatever it says —
    // the camera is fitted against the title block that contains it.
    const ticker = await session.page.evaluate(() => {
      const el = document.getElementById('ticker');
      return el ? { h: Math.round(el.getBoundingClientRect().height), text: el.textContent ?? '' } : null;
    });
    check(
      'the ticker is on screen and saying something',
      !!ticker && ticker.h > 8 && ticker.text.length > 0,
      ticker ? `${ticker.h} px — "${ticker.text}"` : 'missing',
    );

    // **The catastrophe, in the real page.** Last, because it takes the beams away: forced
    // through the same path the scheduler uses, and what is asserted is what the *page* does
    // about it — the banner going red and the ground moving are DOM and canvas states that no
    // headless assertion about the physics could see.
    const boom = await session.page.evaluate(async () => {
      const w = (window as unknown as { lhc: { world: { forceIncident(id: string): string | null; shake: number } } }).lhc.world;
      const text = w.forceIncident('interconnect');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const el = document.getElementById('ticker');
      return {
        text,
        shake: w.shake,
        className: el?.className ?? '',
        banner: el?.textContent ?? '',
        logged: document.querySelectorAll('#panel-run .log-line').length,
      };
    });
    check(
      'a catastrophe reaches the page: red banner, shaking ground, a line in the log',
      boom.className.includes('sev-catastrophe') &&
        boom.shake > 0.5 &&
        boom.banner.includes('INTERCONNECT') &&
        boom.logged > 0,
      `shake ${boom.shake.toFixed(2)}, ${boom.logged} log lines, banner "${boom.banner.slice(0, 40)}…"`,
    );

    if (session.errors.length > 0) check('the page threw nothing', false, session.errors.join('; '));
  } finally {
    await session.close();
  }
}

// --- the narrow layout, measured on a phone -------------------------------------------------
//
// A different shape rather than a squeezed desktop: the readouts are in a sheet along the
// bottom and the picture is fitted above it. What has to be true is the same thing that has to
// be true at 2560 — no panel is drawn over the machine — plus the two things only a small
// screen can get wrong: something running off the side, and a control too small for a finger.
{
  const [width, height] = [390, 844];
  console.log(`--- ${width}x${height} (a phone) ---`);
  const session = await open(width, height);
  try {
    await collide(session.page, 2);
    const m = await session.page.evaluate(() => {
      const lhc = (window as unknown as {
        lhc: {
          renderer: { camera: { y(v: number): number; len(v: number): number }; view: string };
          world: { collider: { ring: { bounds: { minY: number }; config: { apertureRadius: number } } } };
        };
      }).lhc;
      const box = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el || el.hidden || getComputedStyle(el).display === 'none') return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const inside = (child: string, parent: string): boolean => {
        const c = document.querySelector(child);
        const p = document.querySelector(parent);
        return !!c && !!p && p.contains(c);
      };
      // The lowest the collider's tunnel wall is drawn, in screen pixels.
      const ring = lhc.world.collider.ring;
      const wall = lhc.renderer.camera.len(ring.config.apertureRadius * 1.18);
      return {
        sheet: box('#sheet'),
        controls: box('#controls'),
        title: box('.title'),
        beam: box('#panel-beam'),
        eventA: box('#panel-ip-a'),
        machineBottom: lhc.renderer.camera.y(ring.bounds.minY) + wall,
        beamInSheet: inside('#panel-beam', '#sheet-body'),
        eventInSheet: inside('#panel-ip-a', '#sheet-body'),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        colliding: (window as unknown as {
          lhc: { world: { detectors: Array<{ integrated: number }> } };
        }).lhc.world.detectors.every((d) => d.integrated > 0),
        // Only what is on screen: the clusters belonging to the other places are in the DOM
        // with `display: none` on them, and a control that is not shown is 0 px tall.
        smallestTap: Math.min(
          ...Array.from(document.querySelectorAll('.control--tab, .sheet-tab, .control--button'))
            .filter((el) => (el as HTMLElement).offsetParent !== null)
            .map((el) => (el as HTMLElement).getBoundingClientRect().height),
        ),
        // Every control that is on screen, and whether the window has cut it in half. The
        // places are excluded: that strip scrolls on purpose and says so with a fade, and a
        // tab half under the edge of a scroller is not a clipped control. Nothing else here
        // may be reached by dragging.
        clipped: Array.from(document.querySelectorAll('#controls button:not(.control--tab)'))
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { label: (el.textContent ?? '').trim(), left: r.left, right: r.right };
          })
          .filter((b) => b.left < 0 || b.right > window.innerWidth),
        crushed: ['panel-beam', 'panel-physics', 'panel-run', 'panel-power', 'panel-injector']
          .map((id) => {
            const el = document.getElementById(id);
            return { id, by: el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0 };
          })
          .filter((p) => p.by > 1),
      };
    });

    check('the readouts are in the sheet', m.beamInSheet && m.beam !== null);
    // The run has to have *happened*: every measurement below is of a machine with two beams
    // in it, and a driver that pressed nothing would leave every one of them passing on an
    // empty collider. This is the assertion that was missing when `setCompact` shortened the
    // labels `collide()` was matching on.
    check(
      'the phone reached two colliding beams',
      m.colliding,
      m.colliding ? 'both experiments have collected' : 'the collider never filled',
    );
    check(
      'the machine is drawn above the sheet, not behind it',
      m.sheet !== null && m.machineBottom <= m.sheet.top + 1,
      `machine ends at ${m.machineBottom.toFixed(0)} px, the sheet starts at ${m.sheet?.top.toFixed(0)}`,
    );
    check(
      'the button bar stands on top of the sheet',
      m.controls !== null && m.sheet !== null && m.controls.bottom <= m.sheet.top + 1 && m.controls.top > 0,
      `bar ${m.controls?.top.toFixed(0)}..${m.controls?.bottom.toFixed(0)}, sheet from ${m.sheet?.top.toFixed(0)}`,
    );
    check('nothing runs off the side of the window', m.overflow <= 0, `${m.overflow} px over`);
    check(
      'every control is big enough for a finger',
      m.smallestTap >= 28,
      `smallest is ${m.smallestTap.toFixed(0)} px`,
    );
    // Opened, not merely present: a panel in the sheet's DOM but on a tab nobody has pressed
    // is `display: none` and would measure as anything at all.
    const opened = await session.page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('#sheet-tabs .sheet-tab')).find(
        (t) => !(t as HTMLElement).hidden && /ATLAS|CMS/.test(t.textContent ?? ''),
      );
      if (!tab) return null;
      (tab as HTMLButtonElement).click();
      const panel = document.querySelector('#sheet-body .panel--event:not(.sheet-hidden)');
      const sheet = document.getElementById('sheet');
      if (!panel || !sheet) return null;
      const p = panel.getBoundingClientRect();
      const sh = sheet.getBoundingClientRect();
      const canvas = panel.querySelector('.event-view')?.getBoundingClientRect();
      // Inside the sheet's *columns*, and starting inside it. Not "ends inside it": the
      // sheet's body scrolls, so a panel taller than 34 vh legitimately runs past the bottom
      // of the visible box, and asserting otherwise measured the scroller rather than the
      // layout. What would be a bug is a card standing beside or above the sheet, over the
      // machine — which is what these two edges and the top are for.
      // Measured with the sheet **open**, which is the only state in which it has a width at
      // all: folded, the body is `display: none` and every box in it is zero.
      //
      // `.panel` carries `align-self: start` for the rails, where a panel is a fixed 260 px
      // column; inherited into the sheet's flex column it shrank the readouts to their own
      // content — 165 px of a 390 px screen with a gulf beside them, which is what "the layout
      // is inconsistent" looked like.
      const readout = document.querySelector('#sheet-body .panel:not(.sheet-hidden)');
      const body = document.getElementById('sheet-body')!;
      return {
        inside:
          p.left >= sh.left - 1 &&
          p.right <= sh.right + 1 &&
          p.top >= sh.top - 1 &&
          p.top < sh.bottom,
        width: p.width,
        picture: canvas?.width ?? 0,
        fills: readout ? readout.getBoundingClientRect().width : 0,
        body: body.clientWidth - 24,
      };
    });
    check(
      'an experiment is a tab in the sheet rather than a card over the machine',
      m.eventInSheet && opened !== null && opened.inside && opened.picture > 100,
      opened ? `${opened.width.toFixed(0)} px wide, picture ${opened.picture.toFixed(0)} px` : 'no experiment tab',
    );
    check(
      'the readouts fill the sheet rather than huddling in a column',
      opened !== null && Math.abs(opened.fills - opened.body) <= 2,
      opened ? `${opened.fills.toFixed(0)} px of ${opened.body.toFixed(0)}` : 'no panel open',
    );
    check(
      'no control is cut off by the edge of the window',
      m.clipped.length === 0,
      m.clipped.map((c) => `${c.label} at ${c.left.toFixed(0)}..${c.right.toFixed(0)}`).join(', ') ||
        'every one of them whole',
    );
    check(
      'no panel has been crushed — the sheet scrolls, its panels do not',
      m.crushed.length === 0,
      m.crushed.map((c) => `${c.id} by ${c.by}`).join(', ') || 'none',
    );

    // The tabs are the only way round a machine this size, so they had better work.
    await selectView(session.page, 'sps');
    // Field by field: a class instance does not survive being returned from the page, and the
    // first version of this read `undefined` out of a perfectly good renderer.
    const view = await session.page.evaluate(() => {
      const r = (window as unknown as { lhc: { renderer: { view: string; flying: boolean } } }).lhc
        .renderer;
      return { view: r.view, flying: r.flying };
    });
    check('a place can be reached by tapping it', view.view === 'sps' && !view.flying, `at ${view.view}`);

    if (session.errors.length > 0) check('the page threw nothing', false, session.errors.join('; '));
  } finally {
    await session.close();
  }
}

// Everything above ran on a `?quiet=1` page, because a layout measurement cannot afford a UFO
// in the middle of it. That leaves one thing to check: that a player gets the other machine.
{
  const session = await open(1280, 860, false);
  try {
    const live = await session.page.evaluate(
      () => (window as unknown as { lhc: { world: { incidents: { enabled: boolean } } } }).lhc.world.incidents.enabled,
    );
    check('a page opened normally has its incidents switched on', live === true, `enabled = ${live}`);
  } finally {
    await session.close();
  }
}

console.log('');
console.log(failures === 0 ? 'all page checks passed' : `${failures} page check(s) failed`);
if (failures > 0) process.exit(1);
