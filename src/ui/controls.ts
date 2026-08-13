import type { World } from '../sim/world';
import type { View, ViewId } from '../render/views';
import { listViews, viewActivity } from '../render/views';

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
 * The button bar: where you are, and what can be done from there.
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
 * So the bar is **a place and its controls**. The tabs are the places the camera can be —
 * they are exactly `views.ts`, one bar doing both jobs, because "which machine am I at" and
 * "what am I looking at" are the same question and answering it twice is how a toy grows two
 * navigations. Picking one flies the camera there and swaps the cluster underneath it.
 *
 * Three things this has to get right, and they are all consequences of the greying rule in
 * `docs/rendering.md` — *a control is greyed only when pressing it would do nothing at all*:
 *
 * - **No tab is ever greyed.** Looking at an empty SPS is a thing somebody may want to do,
 *   and a camera position cannot be a no-op. What the empty ones get instead is a mark
 *   saying whether there is anything over there — see `viewActivity`.
 * - **Nothing is removed, only folded**, and one press unfolds it. The instructive mistakes
 *   — injecting into a ramped collider, arming a kicker with no beam — are two presses away
 *   rather than one, and no press is refused that was not refused before.
 * - **The dumps are outside the folding entirely.** Dumping the beam is the one action an
 *   operator must never have to navigate to, so it sits at the right-hand end of the bar
 *   whatever place is selected.
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
  private pauseBtn: HTMLButtonElement;
  private blocks: Block[] = [];
  private tabs: Tab[] = [];
  private clusters = new Map<ViewId, HTMLElement>();
  private toggles: Toggle[] = [];
  private shown: ViewId | null = null;

  constructor(root: HTMLElement, world: World, handlers: ControlHandlers) {
    root.innerHTML = '';
    const collider = world.collider.ring.config;
    const injector = world.injector.ring.config;

    this.pauseBtn = button(root, '⏸ pause', handlers.onTogglePause, 'Stops the clock. Space does the same.');
    this.pauseBtn.classList.add('control--pause');

    // --- the places -----------------------------------------------------------
    const tabs = document.createElement('div');
    tabs.className = 'control control--tabs';
    tabs.setAttribute('role', 'tablist');
    for (const view of listViews(world)) {
      this.tabs.push(tab(tabs, view, () => handlers.onView(view.id)));
    }
    root.append(tabs);

    // --- what can be done at each of them -------------------------------------
    //
    // A control may appear under more than one place, and two do: filling is how a session
    // starts, so it is on the overview as well as on the injector, and the extraction kickers
    // belong both to the machine they fire in and to the line they fire down.
    const fill: Item = [
      `⚡ fill ${injector.name}`,
      `Runs the chain: the ${injector.name} goes back to its ${injector.injectionEnergyGeV} GeV ` +
        `flat bottom, and ${(21.6).toFixed(1)} s later the PS delivers a batch into it. ` +
        'Batches stack at flat bottom, which is what a real fill does.',
      handlers.onFillInjector,
      (w: World) => (w.fillRemaining > 0 ? 'the chain is already delivering this cycle' : null),
    ];
    const toBeam1: Item = [
      `→ ${collider.name} beam 1`,
      'Fires the TI 2 extraction kickers. The batch leaves the injector on its next ' +
        'pass and flies down the transfer line, clockwise into the collider.',
      () => handlers.onExtract('ti2'),
    ];
    const toBeam2: Item = [
      `→ ${collider.name} beam 2`,
      'Same, down TI 8 — which has to bend, and arrives pointing the other way round ' +
        'the ring. That is the whole of what makes it the counter-rotating beam.',
      () => handlers.onExtract('ti8'),
    ];

    this.cluster(root, 'complex', [fill]);

    const injectorCluster = this.cluster(root, 'sps', [fill, toBeam1, toBeam2]);
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
    );

    this.cluster(root, 'ti', [toBeam1, toBeam2]);

    const colliderCluster = this.cluster(root, 'lhc', []);
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
    );
    this.cogging(colliderCluster, handlers);

    // The experiments' own control is the one that aims the crossing point at them. Phasing
    // is what turns a filled machine into a running one, and it is the only control in this
    // toy whose effect is *at* an interaction point rather than at a machine.
    for (const id of ['ip-a', 'ip-b'] as const) {
      this.cogging(this.cluster(root, id, []), handlers);
    }

    // --- always reachable ------------------------------------------------------
    const dump = document.createElement('div');
    dump.className = 'control control--group control--dump';
    const cap = document.createElement('span');
    cap.className = 'caption';
    cap.textContent = 'dump';
    dump.append(cap);
    button(dump, '⏻ beam 1', () => handlers.onExtract('td1'), 'Fires the beam 1 dump kickers at Point 5.');
    button(
      dump,
      '⏻ beam 2',
      () => handlers.onExtract('td2'),
      'Fires the beam 2 dump kickers, the other way out of the same straight.',
    );
    root.append(dump);

    this.update(world, 'complex');
  }

  setPaused(paused: boolean): void {
    this.pauseBtn.textContent = paused ? '▶ run' : '⏸ pause';
  }

  /**
   * Greys out whatever would currently do nothing, marks the places where something is
   * happening, and shows the cluster belonging to `view`.
   *
   * Called every frame, and cheap: every write is guarded by a comparison, so a frame in
   * which nothing changed touches no DOM at all.
   */
  update(world: World, view: ViewId): void {
    if (view !== this.shown) {
      this.shown = view;
      for (const [id, el] of this.clusters) el.hidden = id !== view;
      for (const t of this.tabs) {
        const current = t.id === view;
        t.el.classList.toggle('is-current', current);
        t.el.setAttribute('aria-selected', current ? 'true' : 'false');
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
        t.el.textContent = up ? t.upLabel : t.downLabel;
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
  }

  /** One place's controls. Hidden rather than destroyed: they are built once. */
  private cluster(root: HTMLElement, id: ViewId, items: Item[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'control control--group control--cluster';
    wrap.dataset.view = id;
    for (const [label, title, onClick, why] of items) {
      const el = button(wrap, label, onClick, title);
      if (why) this.block(el, why);
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
  ): void {
    const upLabel = `▲ ramp → ${topGeV >= 1000 ? `${(topGeV / 1000).toFixed(1)} TeV` : `${topGeV} GeV`}`;
    const downLabel = `▼ ramp → ${bottomGeV} GeV`;
    // Read at the moment it is pressed rather than trusting the label: a ramp that has been
    // reversed while the finger was on the way down must still do the sane thing.
    const el = button(root, upLabel, () => onRamp(!programmedFor(target(world), topGeV)), upTitle);
    this.toggles.push({ el, target, topGeV, upLabel, downLabel, upTitle, downTitle, up: true });
  }

  /**
   * Phasing: the control that walks the crossing point onto an interaction point.
   *
   * Greyed with fewer than two beams on the orbit — there is no crossing point to move, and
   * the readout beside it says `needs both beams`. **Greying one of these does not cancel
   * what it was doing**: the automatic loop switching itself off whenever a snapshot lost a
   * beam is a bug this machine has already had (see `docs/collisions.md`), and `canCog` is
   * the geometric test written to survive it. A held trim is let go by its own `mouseup`,
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
    const auto = button(
      root,
      '◎ auto',
      () => handlers.onAutoCog(),
      'Walks the crossing point onto the first interaction point and stops. The two ' +
        'insertions are half a ring apart, so aligning one aligns the other.',
    );
    const right = hold(root, 'cog ▶', (down) => handlers.onCog(down ? 1 : 0), 'The same, the other way.');
    const needsTwoBeams = (w: World): string | null =>
      w.canCog ? null : 'it takes a batch in each beam — there is no crossing point to move';
    for (const el of [left, auto, right]) this.block(el, needsTwoBeams);
  }

  private block(el: HTMLButtonElement, why: (world: World) => string | null): void {
    this.blocks.push({ el, why, title: el.title, shown: undefined });
  }
}

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

/** A place in the bar, and whether anything is going on there. */
interface Tab {
  id: ViewId;
  el: HTMLButtonElement;
  dot: HTMLElement;
  mark: string;
}

/** A ramp button, which says which way it would go. */
interface Toggle {
  el: HTMLButtonElement;
  target: (world: World) => number;
  topGeV: number;
  upLabel: string;
  downLabel: string;
  upTitle: string;
  downTitle: string;
  up: boolean;
}

/** A cluster entry: label, tooltip, what it does, and when it would do nothing. */
type Item = [string, string, () => void, ((world: World) => string | null)?];

/** Is the machine already asking for this energy, to within a volt of it? */
function programmedFor(target: number, energyGeV: number): boolean {
  return Math.abs(target - energyGeV) < 1e-6;
}

/** Greyed controls refuse the press; they are not `disabled`, or they would lose the reason. */
function blocked(el: HTMLElement): boolean {
  return el.getAttribute('aria-disabled') === 'true';
}

function button(
  root: HTMLElement,
  label: string,
  onClick: () => void,
  title?: string,
): HTMLButtonElement {
  const el = document.createElement('button');
  el.className = 'control control--button';
  el.textContent = label;
  if (title) el.title = title;
  el.addEventListener('click', () => {
    if (!blocked(el)) onClick();
  });
  root.append(el);
  return el;
}

/**
 * A button that reports being held down rather than being clicked.
 *
 * **Pointer events, not mouse events.** A finger on a phone produces `pointerdown` and
 * `pointerup`; the mouse events a touch browser synthesises from it arrive late, only for
 * taps, and never at all for a hold — which is the whole of what this control is. Capture is
 * taken so a finger that slides off the button still delivers its release: the alternative is
 * a frequency trim nobody can switch off.
 */
function hold(
  root: HTMLElement,
  label: string,
  onHold: (down: boolean) => void,
  title?: string,
): HTMLButtonElement {
  const el = document.createElement('button');
  el.className = 'control control--button';
  el.textContent = label;
  if (title) el.title = title;
  el.addEventListener('pointerdown', (e) => {
    if (blocked(el)) return;
    el.setPointerCapture(e.pointerId);
    onHold(true);
  });
  // Letting go is always delivered, even by a control that has just gone dead under the
  // finger — the alternative is a trim nobody can switch off.
  const release = () => onHold(false);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
  root.append(el);
  return el;
}

/** A place in the tab bar: a name, and a dot for whether anything is happening there. */
function tab(root: HTMLElement, view: View, onClick: () => void): Tab {
  const el = document.createElement('button');
  el.className = 'control control--tab';
  el.setAttribute('role', 'tab');
  el.title = view.title;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const name = document.createElement('span');
  name.textContent = view.label;
  el.append(dot, name);
  el.addEventListener('click', onClick);
  root.append(el);
  return { id: view.id, el, dot, mark: '' };
}
