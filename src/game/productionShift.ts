import { FEMTOBARN_INVERSE } from '../sim/detector';
import type { FillProgress, FillReport, World } from '../sim/world';

/** Three wall minutes at the standard 200× operations clock. */
export const PRODUCTION_SHIFT_WALL_SECONDS = 180;
/** Enough data to require useful stable-beam time from one batch pair. */
export const PRODUCTION_SHIFT_TARGET = 0.03 * FEMTOBARN_INVERSE;

export type ProductionShiftPhase = 'running' | 'ending' | 'complete';

export interface ProductionShiftScore {
  integrated: number;
  stableSeconds: number;
  availability: number;
  completedFills: number;
  operatorDumps: number;
  refilled: boolean;
  turnaroundSeconds: number;
  quenches: number;
  damage: number;
  passed: boolean;
}

/**
 * One scored operations window over the existing machine.
 *
 * This owns game state — the deadline and the pass conditions — but no beam state. A requested
 * dump uses `World.dumpBeams`, a refill is recognised only after a later `FillProgress` has
 * accumulated real stable-beam seconds, and every number in the result comes back out of
 * `World`. The shift can therefore sit over the simulation without providing a shortcut
 * around it.
 */
export class ProductionShift {
  readonly target = PRODUCTION_SHIFT_TARGET;
  readonly startedAt: number;
  readonly endsAt: number;
  readonly exposureAtStart: number;
  readonly historyAtStart: number;

  phase: ProductionShiftPhase = 'running';
  private readonly firstFillIndex: number;
  private readonly firstFillStableAtStart: number;
  private readonly damageAtStart: number;
  private dumpPending = false;
  private finalScore: ProductionShiftScore | null = null;

  constructor(private readonly world: World) {
    this.startedAt = world.machineClock;
    this.endsAt = this.startedAt + PRODUCTION_SHIFT_WALL_SECONDS * world.options.opsTimeScale;
    this.exposureAtStart = world.analysis.integrated;
    this.historyAtStart = world.fillHistory.length;
    this.firstFillIndex = world.fill?.index ?? -1;
    this.firstFillStableAtStart = world.fill?.stableSeconds ?? 0;
    this.damageAtStart = world.damage.length;
  }

  get remainingMachineSeconds(): number {
    return Math.max(0, this.endsAt - this.world.machineClock);
  }

  get remainingWallSeconds(): number {
    return this.remainingMachineSeconds / this.world.options.opsTimeScale;
  }

  get integrated(): number {
    return Math.max(0, this.world.analysis.integrated - this.exposureAtStart);
  }

  get progress(): number {
    return Math.min(1, this.integrated / PRODUCTION_SHIFT_TARGET);
  }

  get isDumping(): boolean {
    return this.dumpPending;
  }

  get score(): ProductionShiftScore {
    return this.finalScore ?? this.measure();
  }

  /** A deliberate end to a fill, through both real dump lines. */
  requestDump(): boolean {
    if (this.phase !== 'running' || this.dumpPending || !this.world.fill) return false;
    this.dumpPending = true;
    this.world.dumpBeams('operator dump');
    return true;
  }

  update(): void {
    if (this.phase === 'complete') return;

    if (this.dumpPending && this.world.fill === null) this.dumpPending = false;

    if (this.phase === 'running' && this.world.machineClock >= this.endsAt) {
      // Freeze the scored window before the shift-end dump adds its own report. The beam still
      // leaves geometrically through TD1 and TD2; only the scoreboard stops at the bell.
      this.finalScore = this.measure();
      this.phase = 'ending';
      if (this.world.fill) this.world.dumpBeams('end of production shift');
    }

    if (this.phase === 'ending' && this.world.fill === null) this.phase = 'complete';
  }

  private reports(): FillReport[] {
    return this.world.fillHistory.slice(this.historyAtStart);
  }

  private measure(): ProductionShiftScore {
    const reports = this.reports();
    const operator = reports.filter((report) => report.reason === 'operator dump');
    const lastDump = operator.length > 0 ? operator[operator.length - 1].index : Infinity;
    const laterReport = reports.some((report) => report.index > lastDump && report.stableSeconds > 0);
    const liveRefill =
      !!this.world.fill && this.world.fill.index > lastDump && this.world.fill.stableSeconds > 0;
    const refilled = operator.length > 0 && (laterReport || liveRefill);
    const lastOperator = operator[operator.length - 1];
    const nextReport = reports.find((report) => report.index > lastDump);
    const nextStartedAt =
      nextReport?.startedAt ??
      (this.world.fill && this.world.fill.index > lastDump ? this.world.fill.startedAt : 0);
    const turnaroundSeconds =
      lastOperator && nextStartedAt > lastOperator.endedAt
        ? nextStartedAt - lastOperator.endedAt
        : 0;

    let stableSeconds = 0;
    let quenches = 0;
    for (const report of reports) {
      stableSeconds += this.stableDuringShift(report);
      quenches += report.quenches;
    }
    if (this.world.fill) {
      stableSeconds += this.stableDuringShift(this.world.fill);
      quenches += this.world.fill.quenches;
    }

    const integrated = this.integrated;
    const elapsed = Math.max(1, Math.min(this.world.machineClock, this.endsAt) - this.startedAt);
    const availability = Math.min(1, stableSeconds / elapsed);
    const passed = integrated >= PRODUCTION_SHIFT_TARGET && operator.length > 0 && refilled;
    return {
      integrated,
      stableSeconds,
      availability,
      completedFills: reports.length,
      operatorDumps: operator.length,
      refilled,
      turnaroundSeconds,
      quenches,
      damage: Math.max(0, this.world.damage.length - this.damageAtStart),
      passed,
    };
  }

  private stableDuringShift(fill: FillProgress): number {
    if (fill.index !== this.firstFillIndex) return fill.stableSeconds;
    return Math.max(0, fill.stableSeconds - this.firstFillStableAtStart);
  }
}
