import type { World } from '../sim/world';
import { listBackends } from '../sim/backend';

export interface ControlHandlers {
  onTogglePause(): void;
  onFillInjector(): void;
  onExtract(lineId: string): void;
  onRampUp(): void;
  onRampDown(): void;
  /** The injector's own ramp: `true` for flat top, `false` for flat bottom. */
  onInjectorRamp(up: boolean): void;
  onBackend(id: string): void;
  /** Held: −1 or +1 while the button is down, 0 when it is let go. */
  onCog(direction: number): void;
  onAutoCog(): void;
}

/**
 * What a control may be greyed out for, and what it may never be greyed out for.
 *
 * **The only reason to grey a control out is that pressing it would do nothing at all** —
 * the machine is already programmed for what the button asks for, or the thing it acts on
 * is not there. Anything that would do something *bad* stays live, and this is the whole
 * distinction:
 *
 * - The kickers are **never** disabled. An earlier version greyed injection out when the
 *   collider had ramped, on the grounds that the transfer line is set for 450 GeV and the
 *   beam would be lost. That is true, and it is also the single most instructive thing in
 *   the machine: press it and watch a batch arrive at a ring bending fifteen times too hard.
 *   The rule lives in the physics — a ring does not capture a beam whose momentum it cannot
 *   match — and arming a charged kicker before there is a beam to kick is a thing an
 *   operator may want to do.
 * - The **ramps** are greyed when the machine is already programmed for that energy, because
 *   `setTargetEnergy` is idempotent and a second press is not a lesson, it is a no-op. So is
 *   filling while the chain is already delivering: `requestFill` returns immediately.
 * - **Cogging** is greyed with fewer than two beams on the orbit. A frequency trim moves the
 *   crossing point of two beams; with one of them empty there is no crossing point, the
 *   readout says `needs both beams`, and the control has nothing to aim.
 *
 * Greyed rather than `disabled`: a disabled button fires no mouse events, so it loses its
 * tooltip — and the tooltip is where the reason is. `aria-disabled` plus `.control--blocked`
 * keeps the hover, and the handlers refuse the press. `check:page` asserts both states.
 */
export class Controls {
  private pauseBtn: HTMLButtonElement;
  private blocks: Block[] = [];

  constructor(root: HTMLElement, world: World, handlers: ControlHandlers) {
    root.innerHTML = '';
    const collider = world.collider.ring.config;
    const injector = world.injector.ring.config;

    this.pauseBtn = button(root, '⏸ pause', handlers.onTogglePause);

    // The injector is a machine now, not a source: the chain delivers at 26 GeV and the
    // ramp to 450 is something somebody does. So filling and ramping are one cluster, in
    // the order they have to happen in.
    const injectorGroup = group(root, injector.name, [
      [
        `⚡ fill ${injector.name}`,
        `Runs the chain: the ${injector.name} goes back to its ${injector.injectionEnergyGeV} GeV ` +
          `flat bottom, and ${(21.6).toFixed(1)} s later the PS delivers a batch into it. ` +
          'Batches stack at flat bottom, which is what a real fill does.',
        handlers.onFillInjector,
      ],
      [
        `▲ ${injector.name} → ${injector.topEnergyGeV} GeV`,
        `Ramps the ${injector.name} to the energy the ${collider.name} takes beam at. ` +
          'Extract before this has finished and a 26 GeV batch arrives at a collider set ' +
          'for 450 — which is the same lesson as injecting into a ramped collider, one ' +
          'machine earlier.',
        () => handlers.onInjectorRamp(true),
      ],
      [
        `▼ ${injector.name} flat bottom`,
        'Back down to the energy the chain delivers at. Nothing can be filled until it is here.',
        () => handlers.onInjectorRamp(false),
      ],
    ]);
    this.block(injectorGroup[0], (w) =>
      w.fillRemaining > 0 ? 'the chain is already delivering this cycle' : null,
    );
    this.block(injectorGroup[1], (w) =>
      programmedFor(w.injector.targetEnergy, injector.topEnergyGeV)
        ? `already programmed for ${injector.topEnergyGeV} GeV`
        : null,
    );
    this.block(injectorGroup[2], (w) =>
      programmedFor(w.injector.targetEnergy, injector.injectionEnergyGeV)
        ? `already programmed for its ${injector.injectionEnergyGeV} GeV flat bottom`
        : null,
    );

    group(root, 'beam', [
      [
        `→ ${collider.name} beam 1`,
        'Fires the TI 2 extraction kickers. The batch leaves the injector on its next ' +
          'pass and flies down the transfer line, clockwise into the collider.',
        () => handlers.onExtract('ti2'),
      ],
      [
        `→ ${collider.name} beam 2`,
        'Same, down TI 8 — which has to bend, and arrives pointing the other way round ' +
          'the ring. That is the whole of what makes it the counter-rotating beam.',
        () => handlers.onExtract('ti8'),
      ],
    ]);

    // Phasing. Two beams on one closed orbit meet twice a turn wherever their phase says
    // they do, and an experiment only sees the ones that meet inside it — so this is the
    // control that turns a filled machine into a running one. It used to have an injection
    // timing toggle beside it; that is gone, because the phase injection could reach was a
    // 430 m grid and hunting it cost seconds of dead time to save one press of `auto`.
    const cog = document.createElement('div');
    cog.className = 'control control--group';
    const cogCaption = document.createElement('span');
    cogCaption.className = 'caption';
    cogCaption.textContent = 'cogging';
    cog.append(cogCaption);
    // Held, not clicked: cogging is a slip that accumulates for as long as it is applied,
    // and letting go is how you stop the crossing point where you want it.
    const cogLeft = hold(
      cog,
      '◀ cog',
      (down) => handlers.onCog(down ? -1 : 0),
      'Trims beam 2 revolution frequency. The beams slip against each other and the point ' +
        'where they meet walks round the ring — hold it and watch the interaction region move.',
    );
    const cogAuto = button(
      cog,
      '◎ auto',
      () => handlers.onAutoCog(),
      'Walks the crossing point onto the first interaction point and stops. The two ' +
        'insertions are half a ring apart, so aligning one aligns the other.',
    );
    const cogRight = hold(cog, 'cog ▶', (down) => handlers.onCog(down ? 1 : 0), 'The same, the other way.');
    root.append(cog);

    // A trim with one beam on the orbit moves nothing anybody can see, and the crossing
    // readout already says `needs both beams`.
    //
    // **Greying one of these does not cancel what it was doing**, and that is deliberate: the
    // automatic loop switching itself off whenever the snapshot lost a beam is a bug this
    // machine has already had once (see `collisions.md`), and `canCog` is the geometric test
    // written to survive it. A held trim is let go by its own mouseup, which still arrives —
    // greyed is not `disabled`.
    const needsTwoBeams = (w: World): string | null =>
      w.canCog ? null : 'it takes a batch in each beam — there is no crossing point to move';
    this.block(cogLeft, needsTwoBeams);
    this.block(cogRight, needsTwoBeams);
    this.block(cogAuto, needsTwoBeams);

    group(root, 'dump', [
      ['⏻ beam 1', 'Fires the beam 1 dump kickers at Point 5.', () => handlers.onExtract('td1')],
      ['⏻ beam 2', 'Fires the beam 2 dump kickers, the other way out of the same straight.', () => handlers.onExtract('td2')],
    ]);

    const rampUp = button(
      root,
      `▲ ramp → ${(collider.topEnergyGeV / 1000).toFixed(1)} TeV`,
      handlers.onRampUp,
      `Puts the ${collider.name} on its ramp to ${(collider.topEnergyGeV / 1000).toFixed(1)} TeV. ` +
        'Whatever it is holding goes up with it — the RF keeps the beam on the orbit while ' +
        'the field climbs — and whatever arrives afterwards at 450 GeV does not.',
    );
    const rampDown = button(
      root,
      '▼ ramp down',
      handlers.onRampDown,
      `Back to the ${collider.injectionEnergyGeV} GeV the transfer lines are set for. ` +
        'The energy leaves the coils through the extraction resistors, which is why it takes ' +
        'as long coming down as it did going up.',
    );
    this.block(rampUp, (w) =>
      programmedFor(w.collider.targetEnergy, collider.topEnergyGeV)
        ? `already programmed for ${(collider.topEnergyGeV / 1000).toFixed(1)} TeV`
        : null,
    );
    this.block(rampDown, (w) =>
      programmedFor(w.collider.targetEnergy, collider.injectionEnergyGeV)
        ? `already programmed for ${collider.injectionEnergyGeV} GeV`
        : null,
    );

    // No time sliders. There is one compression, it is fixed, and it is stated in the
    // HUD; a knob that changes how fast the machine runs is a knob that changes what the
    // numbers mean, and this is a machine to be operated, not tuned.
    const wrap = document.createElement('label');
    wrap.className = 'control control--select';
    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = 'compute';
    const select = document.createElement('select');
    for (const factory of listBackends()) {
      const opt = document.createElement('option');
      opt.value = factory.id;
      opt.textContent = factory.label;
      select.append(opt);
      void factory.unavailableReason().then((reason) => {
        if (reason) {
          opt.disabled = true;
          opt.textContent = `${factory.label} — ${reason}`;
        }
      });
    }
    select.value = world.backend?.id ?? 'cpu';
    select.addEventListener('change', () => handlers.onBackend(select.value));
    wrap.append(caption, select);
    root.append(wrap);

    this.update(world);
  }

  setPaused(paused: boolean): void {
    this.pauseBtn.textContent = paused ? '▶ run' : '⏸ pause';
  }

  /**
   * Greys out whatever would currently do nothing. Called every frame, and cheap: it is a
   * string comparison per control unless a reason has actually changed.
   */
  update(world: World): void {
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

/** A button that reports being held down rather than being clicked. */
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
  el.addEventListener('mousedown', () => {
    if (!blocked(el)) onHold(true);
  });
  // Letting go is always delivered, even by a control that has just gone dead under the
  // finger — the alternative is a trim nobody can switch off.
  el.addEventListener('mouseup', () => onHold(false));
  el.addEventListener('mouseleave', () => onHold(false));
  root.append(el);
  return el;
}

/** A captioned cluster of buttons, so five actions do not read as one row of five. */
function group(
  root: HTMLElement,
  caption: string,
  items: Array<[string, string, () => void]>,
): HTMLButtonElement[] {
  const wrap = document.createElement('div');
  wrap.className = 'control control--group';
  const cap = document.createElement('span');
  cap.className = 'caption';
  cap.textContent = caption;
  wrap.append(cap);
  const buttons = items.map(([label, title, onClick]) => button(wrap, label, onClick, title));
  root.append(wrap);
  return buttons;
}
