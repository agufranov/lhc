/**
 * Compute backend contract.
 *
 * Everything that touches particles goes through here so that a WebGPU implementation
 * can be dropped in without the rest of the app noticing — and so that CPU and GPU
 * can be benchmarked against each other on the same workload.
 *
 * Rules the contract enforces:
 *  - the host never reads particle state per-step, only in bulk between frames;
 *  - the trail is produced by the backend (a GPU backend appends to a device buffer
 *    and hands back one readback), not by the caller stepping one substep at a time;
 *  - the field is uploaded once as a flat table, not queried through a callback.
 *
 * There is one backend for the whole complex, not one per ring: the tables cover every
 * machine and every line, so a particle crossing from one into another is not an event
 * the backend has to know about.
 */

import type { BeamState } from './beam';

/**
 * One trail sample: x, y, outward normal nx, ny, transverse offset as a fraction of the
 * local aperture, and the particle's id.
 *
 * The pusher has to project onto the closed orbit anyway to test the aperture, so it
 * hands the orbit frame over instead of throwing it away. The id is what lets the
 * renderer keep several comets apart — with one buffer for every beam in the complex,
 * samples from different particles are interleaved.
 */
export const TRAIL_STRIDE = 6;

/**
 * One loss: closest point on the orbit sx, sy, the outward normal nx, ny, the signed
 * transverse offset at impact (its sign says which wall), the unit direction of travel
 * dirX, dirY — which is the direction the damage channel runs in — then the particle's
 * index, the aperture element it hit, and finally the particle's **own** position at the
 * moment it stopped.
 *
 * The element is what makes a quench possible: it says which magnet took the beam. The
 * true position matters because sx, sy is the foot of the perpendicular on the design
 * orbit, which is on the axis of the pipe — offset it by the aperture and you get a point
 * on the side wall. Right for a beam that grazed the wall of a ring, wrong for one that
 * ran into the far end of a dump, where the shower starts on the axis.
 */
export const LOSS_STRIDE = 11;

export interface BackendStats {
  /** Wall time of the last step() call [ms]. */
  lastStepMs: number;
  /** Rolling average of ms per 1000 steps — the honest CPU/GPU comparison number. */
  msPerKStep: number;
  stepsTotal: number;
}

export interface SimBackend {
  readonly id: string;
  readonly label: string;
  readonly kind: 'cpu' | 'gpu';
  readonly stats: BackendStats;

  /** Takes ownership of the initial state; may upload it to the device. */
  init(beam: BeamState): void;

  /** Uploads the magnetic lattice of the whole complex. */
  setField(table: Float32Array, sectorCount: number): void;

  /**
   * Signed excitation of every sector in tesla, 2N long: sectors 0..N−1 are the field in
   * the aperture a particle travelling *with* the design direction sees, N..2N−1 the one
   * it sees travelling against it. For a twin-bore dipole those are opposite, which is
   * what lets one ring carry two counter-rotating beams; for a single-bore machine they
   * are equal, so a particle going the wrong way is bent the wrong way and dies.
   *
   * Changes every frame while ramping, drops to zero for a magnet the operator switched
   * off, and drops to zero in one aperture only while that beam's kicker fires.
   */
  setFieldScales(scales: Float32Array): void;

  /**
   * Uploads the beam pipe. Every element carries its own aperture; a particle whose
   * transverse offset exceeds it has hit the wall, and the backend clears its `alive`
   * flag and records the impact.
   */
  setAperture(table: Float32Array, elementCount: number): void;

  /** Advances `steps` fixed steps of `dt` seconds. */
  step(dt: number, steps: number): void;

  /** Copies current positions into `out` as [x0,y0,x1,y1,...]; returns particle count. */
  readPositions(out: Float32Array): number;

  /** Copies trail samples recorded since the last call; returns sample count. */
  drainTrail(out: Float32Array): number;

  /** Copies impacts recorded since the last call; returns impact count. */
  drainLosses(out: Float32Array): number;

  /** Writes the device state back into `beam` (for dump/quench logic on the host). */
  sync(beam: BeamState): void;

  dispose(): void;
}

export interface BackendFactory {
  id: string;
  label: string;
  kind: 'cpu' | 'gpu';
  /** Why it can't run here, or null if it can. */
  unavailableReason(): Promise<string | null>;
  create(): Promise<SimBackend>;
}

const registry = new Map<string, BackendFactory>();

export function registerBackend(factory: BackendFactory): void {
  registry.set(factory.id, factory);
}

export function listBackends(): BackendFactory[] {
  return [...registry.values()];
}

export function getBackend(id: string): BackendFactory | undefined {
  return registry.get(id);
}

export function makeStats(): BackendStats {
  return { lastStepMs: 0, msPerKStep: 0, stepsTotal: 0 };
}

export function recordStats(stats: BackendStats, ms: number, steps: number): void {
  stats.lastStepMs = ms;
  stats.stepsTotal += steps;
  if (steps > 0) {
    const sample = (ms / steps) * 1000;
    stats.msPerKStep = stats.msPerKStep === 0 ? sample : stats.msPerKStep * 0.9 + sample * 0.1;
  }
}
