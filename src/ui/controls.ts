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
  /** Switches injection between waiting for a bucket and firing at once. */
  onToggleTiming(): boolean;
}

/**
 * Nothing here is ever disabled.
 *
 * An earlier version greyed out injection when the collider had ramped, on the grounds
 * that the transfer line is set for 450 GeV and the beam would be lost. That is true, and
 * it is also the single most instructive thing in the machine: press it and watch a
 * batch arrive at a ring bending fifteen times too hard. The rule lives in the physics
 * now — a ring simply does not capture a beam whose momentum it cannot match — so the
 * buttons only ever say what they do.
 */
export class Controls {
  private pauseBtn: HTMLButtonElement;

  constructor(root: HTMLElement, world: World, handlers: ControlHandlers) {
    root.innerHTML = '';
    const collider = world.collider.ring.config;
    const injector = world.injector.ring.config;

    this.pauseBtn = button(root, '⏸ pause', handlers.onTogglePause);

    // The injector is a machine now, not a source: the chain delivers at 26 GeV and the
    // ramp to 450 is something somebody does. So filling and ramping are one cluster, in
    // the order they have to happen in.
    group(root, injector.name, [
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
    // control that turns a filled machine into a running one.
    const timing = button(
      root,
      '⟳ inject on bucket',
      () => {
        const bucket = handlers.onToggleTiming();
        timing.textContent = bucket ? '⟳ inject on bucket' : '⚠ inject immediately';
      },
      'On bucket: the kicker holds until firing would put the batch head-on with something ' +
        'already circulating. Immediately: it fires at the first bunch, the batch lands at ' +
        'whatever phase it lands at, and the beams meet out in the arcs where nothing is ' +
        'watching. Worth doing once.',
    );

    const cog = document.createElement('div');
    cog.className = 'control control--group';
    const cogCaption = document.createElement('span');
    cogCaption.className = 'caption';
    cogCaption.textContent = 'cogging';
    cog.append(cogCaption);
    // Held, not clicked: cogging is a slip that accumulates for as long as it is applied,
    // and letting go is how you stop the crossing point where you want it.
    hold(
      cog,
      '◀ cog',
      (down) => handlers.onCog(down ? -1 : 0),
      'Trims beam 2 revolution frequency. The beams slip against each other and the point ' +
        'where they meet walks round the ring — hold it and watch the interaction region move.',
    );
    button(
      cog,
      '◎ auto',
      () => handlers.onAutoCog(),
      'Walks the crossing point onto IP3 and stops. The two insertions are half a ring ' +
        'apart, so aligning one aligns the other.',
    );
    hold(cog, 'cog ▶', (down) => handlers.onCog(down ? 1 : 0), 'The same, the other way.');
    root.append(cog);

    group(root, 'dump', [
      ['⏻ beam 1', 'Fires the beam 1 dump kickers at Point 5.', () => handlers.onExtract('td1')],
      ['⏻ beam 2', 'Fires the beam 2 dump kickers, the other way out of the same straight.', () => handlers.onExtract('td2')],
    ]);

    button(root, `▲ ramp → ${(collider.topEnergyGeV / 1000).toFixed(1)} TeV`, handlers.onRampUp);
    button(root, '▼ ramp down', handlers.onRampDown);

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
  }

  setPaused(paused: boolean): void {
    this.pauseBtn.textContent = paused ? '▶ run' : '⏸ pause';
  }
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
  el.addEventListener('click', onClick);
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
  el.addEventListener('mousedown', () => onHold(true));
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
): void {
  const wrap = document.createElement('div');
  wrap.className = 'control control--group';
  const cap = document.createElement('span');
  cap.className = 'caption';
  cap.textContent = caption;
  wrap.append(cap);
  for (const [label, title, onClick] of items) button(wrap, label, onClick, title);
  root.append(wrap);
}

