import type { World } from '../sim/world';
import type { ControlAction, Controls } from '../ui/controls';

interface GuideView {
  chapter: number;
  title: string;
  goal: string;
  status: string;
  action: ControlAction | null;
  state: string;
  complete?: boolean;
}

export interface GuideHooks {
  onModeChange(sandbox: boolean): void;
}

/**
 * Progressive presentation over the real machine.
 *
 * Every transition below is a predicate on `World`: pressing a button is never enough to
 * complete a step. The guide waits for the SPS ramp, the flight down a transfer line, the
 * collider ramp and finally non-zero detector luminosity. It owns no simulation state and
 * can therefore be removed at any moment by opening the sandbox.
 */
export class GameGuide {
  private readonly root: HTMLElement;
  private readonly chapter: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly title: HTMLElement;
  private readonly goal: HTMLElement;
  private readonly status: HTMLElement;
  private readonly sandboxButton: HTMLButtonElement;
  private readonly world: World;
  private readonly controls: Controls;
  private readonly hooks: GuideHooks;
  private sandboxMode: boolean;
  private rendered = '';
  private focusedAction: ControlAction | null | undefined;

  constructor(
    root: HTMLElement,
    world: World,
    controls: Controls,
    sandbox: boolean,
    hooks: GuideHooks,
  ) {
    this.root = root;
    this.world = world;
    this.controls = controls;
    this.hooks = hooks;
    this.sandboxMode = sandbox;
    this.chapter = required(root, '#guide-chapter');
    this.progress = required(root, '#guide-progress');
    this.title = required(root, '#guide-title');
    this.goal = required(root, '#guide-goal');
    this.status = required(root, '#guide-status');
    this.sandboxButton = required(root, '#guide-sandbox') as HTMLButtonElement;
    this.sandboxButton.addEventListener('click', () => this.openSandbox());
    this.applyMode();
    this.update();
  }

  get isSandbox(): boolean {
    return this.sandboxMode;
  }

  /** The mobile camera reserves this panel's actual height rather than a CSS guess. */
  get mobileHeight(): number {
    if (this.sandboxMode || !matchMedia('(max-width: 1100px)').matches) return 0;
    return this.root.offsetHeight;
  }

  update(): void {
    if (this.sandboxMode) return;
    const view = guideView(this.world);
    const key = JSON.stringify(view);
    if (key === this.rendered) return;
    this.rendered = key;

    this.root.dataset.chapter = String(view.chapter);
    this.root.dataset.state = view.state;
    if (view.action) this.root.dataset.nextAction = view.action;
    else delete this.root.dataset.nextAction;
    this.chapter.textContent = view.complete ? 'COMMISSIONING COMPLETE' : `COMMISSIONING · ${view.chapter}/3`;
    this.progress.textContent = progress(view.chapter, !!view.complete);
    this.title.textContent = view.title;
    this.goal.textContent = view.goal;
    this.status.textContent = view.status;
    this.status.classList.toggle('guide-status--waiting', view.action === null && !view.complete);
    this.status.classList.toggle('guide-status--complete', !!view.complete);
    this.sandboxButton.textContent = view.complete ? 'continue in sandbox' : 'skip to sandbox';
    if (this.focusedAction !== view.action) {
      this.focusedAction = view.action;
      this.controls.guide(view.action);
    }
  }

  openSandbox(): void {
    if (this.sandboxMode) return;
    this.sandboxMode = true;
    this.applyMode();
    this.hooks.onModeChange(true);
  }

  private applyMode(): void {
    document.body.classList.toggle('mode-guided', !this.sandboxMode);
    document.body.classList.toggle('mode-sandbox', this.sandboxMode);
    this.root.hidden = this.sandboxMode;
    if (this.sandboxMode) {
      this.focusedAction = undefined;
      this.controls.sandbox();
    } else {
      this.focusedAction = null;
      this.controls.guide(null);
    }
  }
}

function guideView(world: World): GuideView {
  const b1 = world.bunchesInBeam(0, 1);
  const b2 = world.bunchesInBeam(0, -1);
  const inSps = world.bunchesIn(1);
  const sps = world.injector;
  const lhc = world.collider;

  if (b1 === 0) {
    if (world.inFlight > 0 || lineBusy(world, 'ti2')) {
      return {
        chapter: 1,
        title: 'First beam',
        goal: 'Follow the batch through TI 2 into LHC beam 1.',
        status: world.inFlight > 0 ? 'IN FLIGHT · transfer is continuous' : 'KICKER ARMED · waiting for the batch',
        action: null,
        state: 'beam-1-transfer',
      };
    }
    if (inSps === 0) {
      if (world.fillRemaining > 0) {
        return {
          chapter: 1,
          title: 'First beam',
          goal: 'Wait for the injector chain to deliver a replacement batch.',
          status: 'CHAIN RUNNING',
          action: null,
          state: 'beam-1-refill',
        };
      }
      return {
        chapter: 1,
        title: 'First beam',
        goal: 'Put one batch into the SPS.',
        status: 'SPS EMPTY',
        action: 'fill-sps',
        state: 'beam-1-fill',
      };
    }
    if (sps.isRamping) {
      return {
        chapter: 1,
        title: 'Match the injection energy',
        goal: 'The LHC accepts this batch at 450 GeV. Let the SPS finish its ramp.',
        status: `RAMPING · ${Math.round(sps.rampFraction * 100)}%`,
        action: null,
        state: 'beam-1-ramping',
      };
    }
    if (sps.rampFraction < 0.98) {
      return {
        chapter: 1,
        title: 'Match the injection energy',
        goal: 'Raise the SPS batch from 26 GeV to the 450 GeV accepted by the LHC.',
        status: 'SPS · 26 → 450 GeV',
        action: 'sps-ramp-up',
        state: 'beam-1-ramp',
      };
    }
    return {
      chapter: 1,
      title: 'Extract through TI 2',
      goal: 'Arm the TI 2 kicker. It will send the next passing batch into LHC beam 1.',
      status: 'SPS READY · 450 GeV',
      action: 'extract-beam-1',
      state: 'beam-1-extract',
    };
  }

  if (b2 === 0) {
    if (world.inFlight > 0 || lineBusy(world, 'ti8')) {
      return {
        chapter: 2,
        title: 'Counter-rotating beam',
        goal: 'Follow the batch through the bend in TI 8 into LHC beam 2.',
        status: world.inFlight > 0 ? 'IN FLIGHT · arriving in the opposite direction' : 'KICKER ARMED · waiting for the batch',
        action: null,
        state: 'beam-2-transfer',
      };
    }
    if (inSps === 0) {
      if (world.fillRemaining > 0 || sps.isRamping) {
        const status = world.fillRemaining > 0
          ? 'CHAIN RUNNING · SPS returning to 26 GeV'
          : `RAMPING DOWN · ${Math.round(sps.rampFraction * 100)}%`;
        return {
          chapter: 2,
          title: 'Prepare the second batch',
          goal: 'The injector chain waits for the SPS flat bottom, then delivers at 26 GeV.',
          status,
          action: null,
          state: 'beam-2-refilling',
        };
      }
      return {
        chapter: 2,
        title: 'Prepare the second batch',
        goal: 'Run the chain. The SPS will return to 26 GeV before the batch is delivered.',
        status: 'BEAM 1 CIRCULATING · SPS EMPTY',
        action: 'fill-sps',
        state: 'beam-2-fill',
      };
    }
    if (sps.isRamping) {
      return {
        chapter: 2,
        title: 'Prepare the second batch',
        goal: 'Let the SPS finish matching the LHC injection energy again.',
        status: `RAMPING · ${Math.round(sps.rampFraction * 100)}%`,
        action: null,
        state: 'beam-2-ramping',
      };
    }
    if (sps.rampFraction < 0.98) {
      return {
        chapter: 2,
        title: 'Prepare the second batch',
        goal: 'Raise the new SPS batch to 450 GeV.',
        status: 'ONE BEAM STORED · SECOND BATCH AT 26 GeV',
        action: 'sps-ramp-up',
        state: 'beam-2-ramp',
      };
    }
    return {
      chapter: 2,
      title: 'Extract through TI 8',
      goal: 'Send this batch through TI 8. Its arrival direction makes it beam 2.',
      status: 'SPS READY · BEAM 1 CIRCULATING',
      action: 'extract-beam-2',
      state: 'beam-2-extract',
    };
  }

  const luminosity = world.detectors.reduce((sum, detector) => sum + detector.luminosity, 0);
  if (lhc.isRamping) {
    return {
      chapter: 3,
      title: 'Bring the collider to energy',
      goal: 'Both beams are captured by the RF and rise with the dipole field.',
      status: `LHC RAMPING · ${Math.round(lhc.rampFraction * 100)}%`,
      action: null,
      state: 'lhc-ramping',
    };
  }
  if (lhc.rampFraction < 0.98) {
    return {
      chapter: 3,
      title: 'Bring the collider to energy',
      goal: 'Ramp both stored beams from 450 GeV to 6.8 TeV.',
      status: 'TWO BEAMS STORED · NO COLLISIONS YET',
      action: 'lhc-ramp-up',
      state: 'lhc-ramp',
    };
  }
  if (luminosity <= 0) {
    const crossing = world.crossingNearestIP();
    if (world.coggingAuto) {
      return {
        chapter: 3,
        title: 'Move the crossing point',
        goal: 'Cogging slips one beam until both meeting points reach the experiments.',
        status: `COGGING · ${crossing ? `${Math.abs(crossing.offset).toFixed(0)} m from an IP` : 'acquiring beams'}`,
        action: null,
        state: 'cogging',
      };
    }
    return {
      chapter: 3,
      title: 'Move the crossing point',
      goal: 'The beams already cross twice per turn, but not inside a detector. Start automatic cogging.',
      status: `FLAT TOP · ${crossing ? `${Math.abs(crossing.offset).toFixed(0)} m from an IP` : 'crossing not found'}`,
      action: 'cog-auto',
      state: 'cog',
    };
  }
  return {
    chapter: 3,
    title: 'First collisions',
    goal: 'Both beams are circulating at 6.8 TeV and meeting inside ATLAS and CMS.',
    status: `STABLE BEAMS · ${luminosity.toExponential(2)} cm⁻²s⁻¹`,
    action: null,
    state: 'complete',
    complete: true,
  };
}

function lineBusy(world: World, id: string): boolean {
  const index = world.lineIndex(id);
  return index >= 0 && world.extractions[index].state !== 'idle';
}

function progress(chapter: number, complete: boolean): string {
  if (complete) return '● ● ●';
  return [1, 2, 3].map((n) => (n < chapter ? '●' : n === chapter ? '◉' : '○')).join(' ');
}

function required(root: HTMLElement, selector: string): HTMLElement {
  const hit = root.querySelector<HTMLElement>(selector);
  if (!hit) throw new Error(`guide is missing ${selector}`);
  return hit;
}
