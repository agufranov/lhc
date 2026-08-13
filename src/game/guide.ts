import type { World } from '../sim/world';
import { FEMTOBARN_INVERSE } from '../sim/detector';
import type { ControlAction, Controls } from '../ui/controls';
import {
  PRODUCTION_SHIFT_TARGET,
  ProductionShift,
  type ProductionShiftScore,
} from './productionShift';

type PrimaryAction = 'start-production' | 'dump-fill' | 'retry';

interface GuideView {
  chapter: number;
  title: string;
  goal: string;
  status: string;
  action: ControlAction | null;
  state: string;
  complete?: boolean;
  section?: string;
  step?: string;
  meter?: number;
  primary?: { action: PrimaryAction; label: string };
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
  private readonly meter: HTMLElement;
  private readonly meterFill: HTMLElement;
  private readonly primaryButton: HTMLButtonElement;
  private readonly sandboxButton: HTMLButtonElement;
  private readonly world: World;
  private readonly controls: Controls;
  private readonly hooks: GuideHooks;
  private sandboxMode: boolean;
  private rendered = '';
  private focusedAction: ControlAction | null | undefined;
  private primaryAction: PrimaryAction | null = null;
  private commissioned = false;
  private shift: ProductionShift | null = null;

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
    this.meter = required(root, '#guide-meter');
    this.meterFill = required(root, '#guide-meter-fill');
    this.primaryButton = required(root, '#guide-primary') as HTMLButtonElement;
    this.sandboxButton = required(root, '#guide-sandbox') as HTMLButtonElement;
    this.primaryButton.addEventListener('click', () => this.runPrimaryAction());
    this.sandboxButton.addEventListener('click', () => this.openSandbox());
    this.applyMode();
    this.update();
  }

  get isSandbox(): boolean {
    return this.sandboxMode;
  }

  /** Public scenario state for the HUD, browser gates and an operator's console. */
  get productionShift(): ProductionShift | null {
    return this.shift;
  }

  /** The mobile camera reserves this panel's actual height rather than a CSS guess. */
  get mobileHeight(): number {
    if (this.sandboxMode || !matchMedia('(max-width: 1100px)').matches) return 0;
    return this.root.offsetHeight;
  }

  update(): void {
    if (this.sandboxMode) return;
    let view: GuideView;
    if (!this.commissioned) {
      const commissioning = commissioningView(this.world);
      if (commissioning.complete) this.commissioned = true;
      view = this.commissioned ? productionReadyView(this.world) : commissioning;
    } else if (!this.shift) {
      view = productionReadyView(this.world);
    } else {
      this.shift.update();
      view = productionView(this.world, this.shift);
    }

    document.body.classList.toggle('mode-production', this.shift !== null);
    const key = JSON.stringify(view);
    if (key === this.rendered) return;
    this.rendered = key;

    this.root.dataset.chapter = String(view.chapter);
    this.root.dataset.state = view.state;
    if (view.action) this.root.dataset.nextAction = view.action;
    else delete this.root.dataset.nextAction;
    this.chapter.textContent = view.section ?? (view.complete ? 'COMMISSIONING COMPLETE' : `COMMISSIONING · ${view.chapter}/3`);
    this.progress.textContent = view.step ?? progress(view.chapter, !!view.complete);
    this.title.textContent = view.title;
    this.goal.textContent = view.goal;
    this.status.textContent = view.status;
    this.status.classList.toggle('guide-status--waiting', view.action === null && !view.primary && !view.complete);
    this.status.classList.toggle('guide-status--complete', !!view.complete);
    this.meter.hidden = view.meter === undefined;
    this.meterFill.style.width = `${Math.max(0, Math.min(1, view.meter ?? 0)) * 100}%`;
    this.primaryAction = view.primary?.action ?? null;
    this.primaryButton.hidden = !view.primary;
    this.primaryButton.textContent = view.primary?.label ?? '';
    this.sandboxButton.textContent = 'sandbox';
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
    if (this.sandboxMode) document.body.classList.remove('mode-production');
    this.root.hidden = this.sandboxMode;
    if (this.sandboxMode) {
      this.focusedAction = undefined;
      this.controls.sandbox();
    } else {
      this.focusedAction = null;
      this.controls.guide(null);
    }
  }

  private runPrimaryAction(): void {
    switch (this.primaryAction) {
      case 'start-production':
        this.shift = new ProductionShift(this.world);
        this.rendered = '';
        this.update();
        break;
      case 'dump-fill':
        this.shift?.requestDump();
        this.rendered = '';
        this.update();
        break;
      case 'retry':
        location.reload();
        break;
    }
  }
}

function commissioningView(world: World): GuideView {
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

function productionReadyView(world: World): GuideView {
  const luminosity = totalLuminosity(world);
  return {
    chapter: 3,
    section: 'COMMISSIONING COMPLETE',
    step: '● ● ●',
    title: 'First collisions are only the start',
    goal: 'Carry these live beams into a three-minute production shift. Collect data, choose when to dump, then return a replacement fill to stable beams.',
    status: `READY · ${(luminosity / 1e33).toFixed(2)} × 10³³ cm⁻²s⁻¹`,
    action: null,
    state: 'commissioning-complete',
    complete: true,
    primary: { action: 'start-production', label: 'start production shift' },
  };
}

function productionView(world: World, shift: ProductionShift): GuideView {
  const score = shift.score;
  const common = {
    chapter: 4,
    section: 'PRODUCTION SHIFT',
    step: shift.phase === 'complete' ? 'REPORT' : `${countdown(shift.remainingWallSeconds)} LEFT`,
    meter: shift.progress,
  };

  if (shift.phase === 'complete') {
    return {
      ...common,
      title: score.passed ? 'Shift passed' : 'Shift incomplete',
      goal: resultGoal(score),
      status:
        `${fb(score.integrated)} fb⁻¹ · ${Math.round(score.availability * 100)}% stable · ` +
        `turnaround ${machineDuration(score.turnaroundSeconds)} · ` +
        `${score.operatorDumps} dump${score.operatorDumps === 1 ? '' : 's'} · ` +
        `${score.quenches} quench${score.quenches === 1 ? '' : 'es'} · ${score.damage} damage`,
      action: null,
      state: score.passed ? 'production-passed' : 'production-failed',
      complete: score.passed,
      primary: { action: 'retry', label: 'restart campaign' },
    };
  }

  if (shift.phase === 'ending') {
    return {
      ...common,
      title: 'Shift handover',
      goal: 'The scored window is closed. Both beams are leaving through TD1 and TD2 before the report is signed.',
      status: 'END OF SHIFT · SAFE DUMP IN PROGRESS',
      action: null,
      state: 'production-ending',
    };
  }

  if (shift.isDumping) {
    return {
      ...common,
      title: 'Operator dump',
      goal: 'Follow both beams into their absorbers. The data is already on tape; the cost now is turnaround.',
      status: `DUMP KICKERS FIRING · ${fb(shift.integrated)} / ${fb(PRODUCTION_SHIFT_TARGET)} fb⁻¹`,
      action: null,
      state: 'production-dumping',
    };
  }

  const b1 = world.bunchesInBeam(0, 1);
  const b2 = world.bunchesInBeam(0, -1);
  if (b1 + b2 === 0 && (world.collider.isRamping || world.collider.rampFraction > 0.02)) {
    return {
      ...common,
      title: 'Pay the turnaround',
      goal: 'The next fill must enter at 450 GeV. Bring the empty LHC back to injection energy.',
      status: world.collider.isRamping
        ? `RAMPING DOWN · ${Math.round(world.collider.rampFraction * 100)}%`
        : 'LHC EMPTY · 6.8 TeV IS TOO HIGH TO INJECT',
      action: world.collider.isRamping ? null : 'lhc-ramp-down',
      state: world.collider.isRamping ? 'refill-lhc-ramping-down' : 'refill-lhc-down',
    };
  }

  const commissioning = commissioningView(world);
  if (!commissioning.complete) {
    return {
      ...commissioning,
      ...common,
      title: commissioning.title,
      goal: `Turnaround is running. ${commissioning.goal}`,
      state: `refill-${commissioning.state}`,
    };
  }

  const optimum = world.optimumFillLength;
  const untilDump = optimum - world.fillAge;
  const advice = isFinite(optimum)
    ? untilDump > 0
      ? `MODEL: DUMP IN ${countdown(untilDump / world.options.opsTimeScale)}`
      : `MODEL: ${countdown(-untilDump / world.options.opsTimeScale)} PAST OPTIMUM`
    : 'MODEL: WAITING FOR BURN-OFF';
  const afterRefill = score.operatorDumps > 0 && score.refilled;
  return {
    ...common,
    title: afterRefill ? 'Replacement fill is producing' : 'Choose when this fill ends',
    goal: afterRefill
      ? 'The required dump and refill are complete. Keep collecting until the shift clock closes.'
      : `Reach ${fb(PRODUCTION_SHIFT_TARGET)} fb⁻¹, make at least one operator dump, and bring the replacement fill back to stable beams.`,
    status: `DATA ${fb(shift.integrated)} / ${fb(PRODUCTION_SHIFT_TARGET)} fb⁻¹ · ${advice}`,
    action: null,
    state: 'production-stable',
    primary: { action: 'dump-fill', label: 'dump this fill' },
  };
}

function resultGoal(score: ProductionShiftScore): string {
  if (score.passed) {
    return 'The data target was reached, a degrading fill was dumped deliberately, and its replacement returned to stable beams.';
  }
  const missing: string[] = [];
  if (score.integrated < PRODUCTION_SHIFT_TARGET) missing.push(`${fb(PRODUCTION_SHIFT_TARGET)} fb⁻¹ of data`);
  if (score.operatorDumps === 0) missing.push('an operator dump');
  if (!score.refilled) missing.push('stable beams after turnaround');
  return `The handover is missing ${missing.join(', ')}. The machine obeyed every command; the shift objective did not.`;
}

function totalLuminosity(world: World): number {
  return world.detectors.reduce((sum, detector) => sum + detector.luminosity, 0);
}

function fb(value: number): string {
  return (value / FEMTOBARN_INVERSE).toFixed(3);
}

function countdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function machineDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  return `${(seconds / 60).toFixed(0)} min`;
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
