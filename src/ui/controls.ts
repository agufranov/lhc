import type { World } from '../sim/world';
import type { View, ViewId } from '../render/views';
import { listViews, viewActivity } from '../render/views';
import { Scope } from './scope';

export interface ControlHandlers {
  onTogglePause(): void;
  onFillInjector(): void;
  onExtract(lineId: string): void;
  /** The collider's ramp, as a setpoint: `true` for flat top, `false` for injection energy. */
  onRamp(up: boolean): void;
  /** The injector's own ramp: `true` for flat top, `false` for flat bottom. */
  onInjectorRamp(up: boolean): void;
  /** Held: −1 or +1 while the button is down, 0 when it is let go. */
  onCog(direction: number): void;
  onAutoCog(): void;
  /** Somebody asked to look somewhere else. The camera flies; nothing else changes. */
  onView(id: ViewId): void;
}

/**
 * The console, and the strip of places that says which machine it is wired to.
 *
 * ## Why it is not one row of everything
 *
 * It used to be: thirteen buttons and a picker, in one flat row, ordered the way the machine
 * is plumbed — fill, ramp the injector, extract each way, cog, dump each beam, ramp the
 * collider. That order is right and it is useless to anybody who does not already know the
 * cycle, because every control is equally loud and nothing says which of them belongs to
 * which machine. The audience for this is somewhere between an accelerator engineer and
 * somebody who clicked a link.
 *
 * So there is **a place, and a desk for it**. The places are exactly `views.ts`, one strip
 * doing both jobs, because "which machine am I at" and "what am I looking at" are the same
 * question and answering it twice is how a toy grows two navigations. Picking one flies the
 * camera there and swaps what is on the desk.
 *
 * Three things this has to get right, and they are all consequences of the greying rule in
 * `docs/rendering.md` — *a control is greyed only when pressing it would do nothing at all*:
 *
 * - **No place is ever greyed.** Looking at an empty SPS is a thing somebody may want to do,
 *   and a camera position cannot be a no-op. What the empty ones get instead is a mark
 *   saying whether there is anything over there — see `viewActivity`.
 * - **Nothing is removed, only folded**, and one press unfolds it. The instructive mistakes
 *   — injecting into a ramped collider, arming a kicker with no beam — are two presses away
 *   rather than one, and no press is refused that was not refused before.
 * - **The dumps are outside the folding entirely.** Dumping the beam is the one action an
 *   operator must never have to navigate to, so it sits at the right-hand end of the desk
 *   whatever place is selected.
 *
 * ## Why the places left the desk
 *
 * They were the first row of it, and everything else in the box was the selected place's own
 * controls — one key at `complex`, four at the injector, a caption and three at an interaction
 * point. So the box was a different width, and sometimes a different height, on every press,
 * and **every other control in it moved when you changed place**, including the dumps, which
 * are the two that must never move. A strip of tabs cannot share a box with something that
 * changes size.
 *
 * They are now beside the title (`index.html`), where they are the same six at the same size
 * for ever, and on a phone they are fixed to the very bottom of the window under the sheet,
 * which is where a thumb is and where the six of them fit. What is left is a desk that is
 * **fixed in every dimension**: the whole box, and each of its four bays — nameplate and
 * lamps, the place's own keys, the instruments, and the keys that are never folded away.
 * Changing place changes what is on the desk and never where anything is on it, which
 * `check:page` measures by walking every place and comparing the boxes.
 *
 * ## Why it looks like a desk
 *
 * Because a machine you can quench should not be operated through something that reads like a
 * toolbar. The keys are physical — bevel, engraved caption, and a lamp in the corner of each
 * that is dark exactly when pressing it would do nothing, which is the greying rule made
 * visible instead of merely tooltipped. Beside them are the three instruments the readouts
 * cannot be glanced at for: the **lamps** (a beam each way round the collider, a ramp running,
 * collisions, a quench), a **load meter** on the dipoles of whichever machine this place
 * belongs to, and the **scope**, which is the only thing on screen that shows a ramp as the
 * twenty-minute shape it is (`ui/scope.ts`). Every one of them is read off the world; there is
 * nothing on this desk that is decoration only.
 *
 * ## Why the ramps became one button each
 *
 * A ramp is a *setpoint*, not two commands: the machine is either programmed for flat top or
 * for injection energy. Two buttons meant one of them was always the greyed one — pressing
 * "ramp up" on a machine already programmed to ramp up does nothing, which is exactly the
 * definition of a control that should not be there. One button that says which way it will
 * go is never a no-op, and pressing it *during* a ramp reverses it, which a real machine also
 * lets you do.
 */
export class Controls {
  private pause: Key;
  private paused = false;
  private blocks: Block[] = [];
  private tabs: Tab[] = [];
  private clusters = new Map<ViewId, HTMLElement>();
  private toggles: Toggle[] = [];
  private shown: ViewId | null = null;
  /** Every control that says something shorter on a narrow screen. */
  private labels: Array<{ el: HTMLElement; long: string; short: string }> = [];
  private compact = false;
  /** The nameplate, the lamps beside it, and the dipole load dial. */
  private plate: HTMLElement;
  private plateName = '';
  private lamps: LampView[] = [];
  private dial: Dial;
  private scope: Scope;
  /** The instruments are read at {@link INSTRUMENT_PERIOD}, not at sixty frames a second. */
  private since = 0;

  constructor(root: HTMLElement, places: HTMLElement, world: World, handlers: ControlHandlers) {
    root.innerHTML = '';
    places.innerHTML = '';
    const collider = world.collider.ring.config;
    const injector = world.injector.ring.config;

    // --- the places -----------------------------------------------------------
    for (const view of listViews(world)) {
      this.tabs.push(tab(places, view, () => handlers.onView(view.id)));
    }

    // --- the nameplate, and what the machine is doing without being asked ------
    const plate = bay(root, 'deck-plate');
    this.plate = document.createElement('div');
    this.plate.className = 'deck-name';
    plate.append(this.plate);
    const lamps = document.createElement('div');
    lamps.className = 'deck-lamps';
    for (const spec of LAMPS) this.lamps.push(lamp(lamps, spec));
    plate.append(lamps);

    // --- what can be done at each place ---------------------------------------
    //
    // A control may appear under more than one place, and two do: filling is how a session
    // starts, so it is on the overview as well as on the injector, and the extraction kickers
    // belong both to the machine they fire in and to the line they fire down.
    const keys = bay(root, 'deck-keys');
    const fill: Item = [
      `⚡ fill ${injector.name}`,
      '⚡ fill',
      `Runs the chain: the ${injector.name} goes back to its ${injector.injectionEnergyGeV} GeV ` +
        `flat bottom, and ${(21.6).toFixed(1)} s later the PS delivers a batch into it. ` +
        'Batches stack at flat bottom, which is what a real fill does.',
      handlers.onFillInjector,
      (w: World) => (w.fillRemaining > 0 ? 'the chain is already delivering this cycle' : null),
      'fill',
    ];
    const toBeam1: Item = [
      `→ ${collider.name} beam 1`,
      '→ beam 1',
      'Fires the TI 2 extraction kickers. The batch leaves the injector on its next ' +
        'pass and flies down the transfer line, clockwise into the collider.',
      () => handlers.onExtract('ti2'),
      undefined,
      'to-beam-1',
    ];
    const toBeam2: Item = [
      `→ ${collider.name} beam 2`,
      '→ beam 2',
      'Same, down TI 8 — which has to bend, and arrives pointing the other way round ' +
        'the ring. That is the whole of what makes it the counter-rotating beam.',
      () => handlers.onExtract('ti8'),
      undefined,
      'to-beam-2',
    ];

    this.cluster(keys, 'complex', [fill]);

    const injectorCluster = this.cluster(keys, 'sps', [fill, toBeam1, toBeam2]);
    this.ramp(
      injectorCluster,
      world,
      (w) => w.injector.targetEnergy,
      injector.topEnergyGeV,
      injector.injectionEnergyGeV,
      handlers.onInjectorRamp,
      `Ramps the ${injector.name} to the energy the ${collider.name} takes beam at. ` +
        'Extract before it has finished and a 26 GeV batch arrives at a collider set for ' +
        '450 — the same lesson as injecting into a ramped collider, one machine earlier.',
      'Back down to the energy the chain delivers at. Nothing can be filled until it is here.',
      'ramp-injector',
    );

    this.cluster(keys, 'ti', [toBeam1, toBeam2]);

    const colliderCluster = this.cluster(keys, 'lhc', []);
    this.ramp(
      colliderCluster,
      world,
      (w) => w.collider.targetEnergy,
      collider.topEnergyGeV,
      collider.injectionEnergyGeV,
      handlers.onRamp,
      `Puts the ${collider.name} on its ramp to ${(collider.topEnergyGeV / 1000).toFixed(1)} TeV. ` +
        'Whatever it is holding goes up with it — the RF keeps the beam on the orbit while ' +
        'the field climbs — and whatever arrives afterwards at 450 GeV does not.',
      `Back to the ${collider.injectionEnergyGeV} GeV the transfer lines are set for. The energy ` +
        'leaves the coils through the extraction resistors, which is why it takes as long ' +
        'coming down as it did going up.',
      'ramp-collider',
    );
    this.cogging(colliderCluster, handlers);

    // The experiments' own control is the one that aims the crossing point at them. Phasing
    // is what turns a filled machine into a running one, and it is the only control in this
    // toy whose effect is *at* an interaction point rather than at a machine.
    for (const id of ['ip-a', 'ip-b'] as const) {
      this.cogging(this.cluster(keys, id, []), handlers);
    }

    // --- the instruments -------------------------------------------------------
    const gauges = bay(root, 'deck-gauges');
    this.dial = dial(gauges);
    const screen = document.createElement('canvas');
    screen.className = 'deck-scope';
    screen.title =
      'Both machines, as a fraction of their own flat top, over the last thirty seconds of ' +
      'watching. The sawtooth is the injector cycling; the long climb is the collider ramp.';
    gauges.append(screen);
    this.scope = new Scope(screen);

    // --- always reachable ------------------------------------------------------
    const safety = bay(root, 'deck-safety');
    this.pause = key(
      safety,
      '⏸ pause',
      handlers.onTogglePause,
      'Stops the clock. Space does the same.',
      'pause',
    );
    this.labels.push({ el: this.pause.label, long: '⏸ pause', short: '⏸' });
    const dump = document.createElement('div');
    dump.className = 'control control--group control--dump';
    const cap = document.createElement('span');
    cap.className = 'caption';
    cap.textContent = 'dump';
    dump.append(cap);
    const dump1 = key(
      dump,
      '⏻ beam 1',
      () => handlers.onExtract('td1'),
      'Fires the beam 1 dump kickers at Point 5.',
      'dump-1',
    );
    const dump2 = key(
      dump,
      '⏻ beam 2',
      () => handlers.onExtract('td2'),
      'Fires the beam 2 dump kickers, the other way out of the same straight.',
      'dump-2',
    );
    this.labels.push({ el: dump1.label, long: '⏻ beam 1', short: '⏻ 1' });
    this.labels.push({ el: dump2.label, long: '⏻ beam 2', short: '⏻ 2' });
    safety.append(dump);

    this.update(world, 'complex', 0);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    const entry = this.labels.find((l) => l.el === this.pause.label)!;
    entry.long = paused ? '▶ run' : '⏸ pause';
    entry.short = paused ? '▶' : '⏸';
    this.pause.label.textContent = this.compact ? entry.short : entry.long;
  }

  /**
   * Narrow screen: every control says the same thing in fewer words.
   *
   * Called with the same media query the sheet and the stylesheet use, so the desk is never
   * half in one mode and half in the other.
   */
  setCompact(compact: boolean): void {
    if (compact === this.compact) return;
    this.compact = compact;
    for (const l of this.labels) l.el.textContent = compact ? l.short : l.long;
    for (const t of this.toggles) {
      t.label.textContent = t.up
        ? compact ? t.upShort : t.upLabel
        : compact ? t.downShort : t.downLabel;
    }
    this.setPaused(this.paused);
  }

  /**
   * Greys out whatever would currently do nothing, marks the places where something is
   * happening, shows the keys belonging to `view`, and reads the instruments.
   *
   * Called every frame, and cheap: every write is guarded by a comparison, so a frame in
   * which nothing changed touches no DOM at all. The lamps and the meter are read at
   * {@link INSTRUMENT_PERIOD} rather than per frame, because counting what is in each beam
   * walks the whole particle array — an instrument that answers "is there beam" six times a
   * second is telling the truth as fast as anybody can read it.
   */
  update(world: World, view: ViewId, dtWall: number): void {
    if (view !== this.shown) {
      this.shown = view;
      for (const [id, el] of this.clusters) el.hidden = id !== view;
      for (const t of this.tabs) {
        const current = t.id === view;
        t.el.classList.toggle('is-current', current);
        t.el.setAttribute('aria-selected', current ? 'true' : 'false');
      }
      const name = this.tabs.find((t) => t.id === view)?.name ?? '';
      if (name !== this.plateName) {
        this.plateName = name;
        this.plate.textContent = name;
      }
    }

    for (const t of this.tabs) {
      const { beams, hot } = viewActivity(world, t.id);
      const mark = hot ? 'hot' : beams > 0 ? 'live' : '';
      if (mark !== t.mark) {
        t.mark = mark;
        t.dot.className = mark ? `dot dot--${mark}` : 'dot';
      }
    }

    for (const t of this.toggles) {
      const up = !programmedFor(t.target(world), t.topGeV);
      if (up !== t.up) {
        t.up = up;
        t.label.textContent = up
          ? this.compact ? t.upShort : t.upLabel
          : this.compact ? t.downShort : t.downLabel;
        t.el.title = up ? t.upTitle : t.downTitle;
      }
    }

    for (const b of this.blocks) {
      const why = b.why(world);
      if (why === b.shown) continue;
      b.shown = why;
      b.el.classList.toggle('control--blocked', why !== null);
      if (why !== null) {
        b.el.setAttribute('aria-disabled', 'true');
        b.el.title = `${why}.\n\n${b.title}`;
      } else {
        b.el.removeAttribute('aria-disabled');
        b.el.title = b.title;
      }
    }

    this.scope.update(world, dtWall);
    this.since += dtWall;
    if (this.since < INSTRUMENT_PERIOD) return;
    this.since = 0;
    this.instruments(world, view);
  }

  /**
   * The lamps and the dial.
   *
   * The dial is the dipoles of **the machine this place belongs to** — at the injector it is
   * the injector's, everywhere else the collider's — because a desk labelled SPS metering the
   * LHC is a desk that lies. It reads mean circuit current against nominal, so a circuit
   * switched off or quenched drags the needle down, which is exactly the thing worth seeing
   * happen without opening POWER.
   *
   * A needle and not a bar, and that is not decoration: a moving-coil meter is the instrument
   * this machine's desk would actually carry, the eye reads an angle faster than it reads a
   * length, and a needle that swings has a *speed* — which is the whole story of a ramp.
   */
  private instruments(world: World, view: ViewId): void {
    for (const l of this.lamps) {
      const state = l.state(world);
      if (state === l.lit) continue;
      l.lit = state;
      l.dot.className = state ? `lamp-bulb is-${state}` : 'lamp-bulb';
    }
    const machine = view === 'sps' ? world.injector : world.collider;
    const load = Math.max(0, Math.min(1.15, machine.telemetry().load));
    const angle = (-DIAL_SWEEP / 2 + Math.min(load, 1.08) * DIAL_SWEEP).toFixed(1);
    if (angle !== this.dial.angle) {
      this.dial.angle = angle;
      this.dial.needle.style.transform = `translateX(-50%) rotate(${angle}deg)`;
      // Over nominal is a state, not a number: the face lights red rather than the needle
      // going somewhere there is no scale for.
      this.dial.face.classList.toggle('is-over', load > 1.01);
    }
    const text = `${machine.ring.config.name} ${(load * 100).toFixed(0)}%`;
    if (text !== this.dial.text) {
      this.dial.text = text;
      this.dial.caption.textContent = text;
    }
  }

  /** One place's keys. Hidden rather than destroyed: they are built once. */
  private cluster(root: HTMLElement, id: ViewId, items: Item[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'control control--group control--cluster';
    wrap.dataset.view = id;
    for (const [label, short, title, onClick, why, name] of items) {
      const k = key(wrap, label, onClick, title, name);
      this.labels.push({ el: k.label, long: label, short });
      if (why) this.block(k.el, why);
    }
    root.append(wrap);
    this.clusters.set(id, wrap);
    return wrap;
  }

  /** The ramp of one machine, as the one button it is. See the note on this class. */
  private ramp(
    root: HTMLElement,
    world: World,
    target: (world: World) => number,
    topGeV: number,
    bottomGeV: number,
    onRamp: (up: boolean) => void,
    upTitle: string,
    downTitle: string,
    name: string,
  ): void {
    const top = topGeV >= 1000 ? `${(topGeV / 1000).toFixed(1)} TeV` : `${topGeV} GeV`;
    const upLabel = `▲ ramp → ${top}`;
    const downLabel = `▼ ramp → ${bottomGeV} GeV`;
    const upShort = `▲ ${top}`;
    const downShort = `▼ ${bottomGeV} GeV`;
    // Read at the moment it is pressed rather than trusting the label: a ramp that has been
    // reversed while the finger was on the way down must still do the sane thing.
    const k = key(root, upLabel, () => onRamp(!programmedFor(target(world), topGeV)), upTitle, name);
    this.toggles.push({
      el: k.el,
      label: k.label,
      target,
      topGeV,
      upLabel,
      downLabel,
      upShort,
      downShort,
      upTitle,
      downTitle,
      up: true,
    });
  }

  /**
   * Phasing: the control that walks the crossing point onto an interaction point.
   *
   * Greyed with fewer than two beams on the orbit — there is no crossing point to move, and
   * the readout beside it says `needs both beams`. **Greying one of these does not cancel
   * what it was doing**: the automatic loop switching itself off whenever a snapshot lost a
   * beam is a bug this machine has already had (see `docs/collisions.md`), and `canCog` is
   * the geometric test written to survive it. A held trim is let go by its own `pointerup`,
   * which still arrives, precisely because a greyed button is not `disabled`.
   */
  private cogging(root: HTMLElement, handlers: ControlHandlers): void {
    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = 'cogging';
    root.append(caption);
    // Held, not clicked: cogging is a slip that accumulates for as long as it is applied,
    // and letting go is how you stop the crossing point where you want it.
    const left = hold(
      root,
      '◀ cog',
      (down) => handlers.onCog(down ? -1 : 0),
      'Trims beam 2 revolution frequency. The beams slip against each other and the point ' +
        'where they meet walks round the ring — hold it and watch the interaction region move.',
    );
    const auto = key(
      root,
      '◎ auto',
      () => handlers.onAutoCog(),
      'Walks the crossing point onto the first interaction point and stops. The two ' +
        'insertions are half a ring apart, so aligning one aligns the other.',
      'cog-auto',
    );
    const right = hold(
      root,
      'cog ▶',
      (down) => handlers.onCog(down ? 1 : 0),
      'The same, the other way.',
    );
    const needsTwoBeams = (w: World): string | null =>
      w.canCog ? null : 'it takes a batch in each beam — there is no crossing point to move';
    for (const k of [left, auto, right]) this.block(k.el, needsTwoBeams);
  }

  private block(el: HTMLButtonElement, why: (world: World) => string | null): void {
    this.blocks.push({ el, why, title: el.title, shown: undefined });
  }
}

/** How often the lamps and the meter are read [s of wall time]. */
const INSTRUMENT_PERIOD = 1 / 6;

/**
 * The lamps along the nameplate: the five things worth knowing before pressing anything.
 *
 * Every one of them is a state the machine really is in, read off the world — a lamp that is
 * decoration is a lamp nobody believes the next time it lights.
 */
interface LampSpec {
  caption: string;
  title: string;
  /** `''` is dark; the rest are the colours in the stylesheet. */
  state: (world: World) => '' | 'live' | 'hot' | 'ok' | 'warn';
}

const LAMPS: LampSpec[] = [
  {
    caption: 'B1',
    title: 'A batch going clockwise round the collider.',
    state: (w) => (w.bunchesInBeam(0, 1) > 0 ? 'live' : ''),
  },
  {
    caption: 'B2',
    title: 'A batch going the other way round it.',
    state: (w) => (w.bunchesInBeam(0, -1) > 0 ? 'live' : ''),
  },
  {
    caption: 'RMP',
    title: 'A machine is on its ramp: the field is moving towards a setpoint it is not at yet.',
    state: (w) => (ramping(w.collider) || ramping(w.injector) ? 'hot' : ''),
  },
  {
    caption: 'LUM',
    title: 'The beams are crossing inside an experiment and it is collecting.',
    state: (w) => (w.detectors.some((d) => d.luminosity > 0) ? 'ok' : ''),
  },
  {
    caption: 'QNC',
    title: 'A dipole circuit has quenched. Click it in the picture to start it cooling.',
    state: (w) => (w.collider.quenchedCount + w.injector.quenchedCount > 0 ? 'warn' : ''),
  },
];

/** Is this machine between two energies rather than sitting at one? */
function ramping(machine: { energyGeV: number; targetEnergy: number }): boolean {
  return Math.abs(machine.energyGeV - machine.targetEnergy) > 0.5;
}

interface LampView extends LampSpec {
  dot: HTMLElement;
  lit: string;
}

/** The dipole load dial: a needle, the face it swings over, and the number it is saying. */
interface Dial {
  face: HTMLElement;
  needle: HTMLElement;
  caption: HTMLElement;
  angle: string;
  text: string;
}

/** How far the needle swings between an empty circuit and nominal current [degrees]. */
const DIAL_SWEEP = 240;

/** A control that is sometimes not worth pressing, and what it says while it is not. */
interface Block {
  el: HTMLButtonElement;
  /** The reason pressing it would do nothing right now, or null if it would do something. */
  why: (world: World) => string | null;
  /** What it says when it is worth pressing. */
  title: string;
  /** The reason on screen now: `undefined` before the first update, so that one applies. */
  shown: string | null | undefined;
}

/** A place in the strip, and whether anything is going on there. */
interface Tab {
  id: ViewId;
  el: HTMLButtonElement;
  dot: HTMLElement;
  /** What the nameplate says while this place is selected. */
  name: string;
  mark: string;
}

/** A ramp button, which says which way it would go. */
interface Toggle {
  el: HTMLButtonElement;
  label: HTMLElement;
  target: (world: World) => number;
  topGeV: number;
  upLabel: string;
  downLabel: string;
  /** The same, for a narrow screen: the place is named on the desk beside it. */
  upShort: string;
  downShort: string;
  upTitle: string;
  downTitle: string;
  up: boolean;
}

/**
 * A cluster entry: label, the same label for a phone, tooltip, what it does, when it would do
 * nothing, and the name the browser gates press it by.
 *
 * **The short label is not an abbreviation, it is the same words with the context removed.**
 * `⚡ fill SPS` is on a desk whose nameplate says SPS; `→ LHC beam 1` is reached from a place
 * whose only other machine is the LHC. On a 390 px screen the long ones are 440 px of button
 * in a row that has 374, and the fix cannot be a scroller — a control you have to find by
 * dragging is a control that is not there.
 */
type Item = [string, string, string, () => void, ((world: World) => string | null)?, string?];

/** Is the machine already asking for this energy, to within a volt of it? */
function programmedFor(target: number, energyGeV: number): boolean {
  return Math.abs(target - energyGeV) < 1e-6;
}

/** Greyed controls refuse the press; they are not `disabled`, or they would lose the reason. */
function blocked(el: HTMLElement): boolean {
  return el.getAttribute('aria-disabled') === 'true';
}

/** One bay of the desk. Its width is fixed in the stylesheet; see the note on `Controls`. */
function bay(root: HTMLElement, className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `deck-bay ${className}`;
  root.append(el);
  return el;
}

/**
 * A key on the desk: a lamp and an engraved caption.
 *
 * **The caption is its own element**, and it has to be: the lamp is a sibling, and every
 * `textContent` this class writes — a ramp reversing, every label on a narrow screen — would
 * otherwise wipe the lamp out. That is not a hypothetical; it is what happened the first time
 * a key grew one.
 *
 * The key carries a **`data-control` that does not change when its caption does**, which is
 * what the browser gates press it by. They used to match on the visible text, and the moment
 * the narrow layout started shortening labels (`setCompact`) every press in `collide()`
 * silently found nothing: the machine was driven for a minute and a half with two empty beams,
 * and only an unrelated assertion noticed.
 */
interface Key {
  el: HTMLButtonElement;
  label: HTMLElement;
}

function key(
  root: HTMLElement,
  caption: string,
  onClick: () => void,
  title?: string,
  name?: string,
): Key {
  const k = blank(root, caption, title, name);
  k.el.addEventListener('click', () => {
    if (!blocked(k.el)) onClick();
  });
  return k;
}

/**
 * A key that reports being held down rather than being clicked.
 *
 * **Pointer events, not mouse events.** A finger on a phone produces `pointerdown` and
 * `pointerup`; the mouse events a touch browser synthesises from it arrive late, only for
 * taps, and never at all for a hold — which is the whole of what this control is. Capture is
 * taken so a finger that slides off the key still delivers its release: the alternative is a
 * frequency trim nobody can switch off.
 */
function hold(
  root: HTMLElement,
  caption: string,
  onHold: (down: boolean) => void,
  title?: string,
): Key {
  const k = blank(root, caption, title);
  k.el.addEventListener('pointerdown', (e) => {
    if (blocked(k.el)) return;
    k.el.setPointerCapture(e.pointerId);
    onHold(true);
  });
  // Letting go is always delivered, even by a control that has just gone dead under the
  // finger — the alternative is a trim nobody can switch off.
  const release = (): void => onHold(false);
  k.el.addEventListener('pointerup', release);
  k.el.addEventListener('pointercancel', release);
  k.el.addEventListener('lostpointercapture', release);
  return k;
}

/** The key itself, with nothing bound to it yet. */
function blank(root: HTMLElement, caption: string, title?: string, name?: string): Key {
  const el = document.createElement('button');
  el.className = 'control control--button';
  if (name) el.dataset.control = name;
  const led = document.createElement('i');
  led.className = 'key-led';
  const label = document.createElement('span');
  label.className = 'key-label';
  label.textContent = caption;
  el.append(led, label);
  if (title) el.title = title;
  root.append(el);
  return { el, label };
}

/** A lamp on the nameplate: a bulb and three letters beside it. */
function lamp(root: HTMLElement, spec: LampSpec): LampView {
  const el = document.createElement('span');
  el.className = 'lamp';
  el.title = spec.title;
  const dot = document.createElement('i');
  dot.className = 'lamp-bulb';
  const caption = document.createElement('span');
  caption.textContent = spec.caption;
  el.append(dot, caption);
  root.append(el);
  return { ...spec, dot, lit: '' };
}

/** The dipole load dial: how much of nominal current the circuits are actually carrying. */
function dial(root: HTMLElement): Dial {
  const el = document.createElement('div');
  el.className = 'deck-dial';
  el.title =
    'Mean dipole current against nominal, for the machine this place belongs to. A circuit ' +
    'switched off or quenched carries none, and drags the needle down with it.';
  const face = document.createElement('div');
  face.className = 'dial-face';
  // The scale is drawn by the stylesheet — ticks and the red zone are one conic gradient each
  // — and only these two move: the needle, and the glass over it, which does not.
  const needle = document.createElement('i');
  needle.className = 'dial-needle';
  const hub = document.createElement('i');
  hub.className = 'dial-hub';
  const glass = document.createElement('i');
  glass.className = 'dial-glass';
  face.append(needle, hub, glass);
  const caption = document.createElement('div');
  caption.className = 'dial-caption';
  el.append(face, caption);
  root.append(el);
  return { face, needle, caption, angle: '', text: '' };
}

/** A place in the strip: a name, and a dot for whether anything is happening there. */
function tab(root: HTMLElement, view: View, onClick: () => void): Tab {
  const el = document.createElement('button');
  el.className = 'control control--tab';
  el.dataset.view = view.id;
  el.setAttribute('role', 'tab');
  el.title = view.title;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const name = document.createElement('span');
  name.textContent = view.label;
  el.append(dot, name);
  el.addEventListener('click', onClick);
  root.append(el);
  return { id: view.id, el, dot, name: view.label, mark: '' };
}
