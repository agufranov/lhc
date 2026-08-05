/**
 * CPU reference backend.
 *
 * Pusher: exact velocity rotation by ω·dt with ω = qB/(γm), position advanced with the
 * mid-step velocity. For a purely magnetic field this is what the Boris pusher reduces
 * to — |v| is conserved to machine precision, so the beam can never gain or lose energy
 * through the integrator, only through the RF and the dump.
 *
 * Every step also projects the particle onto the closed orbit. That is not free, but it
 * is what makes the beam pipe real, and it now does a second job: the design direction it
 * reports says which aperture of a twin-bore dipole the particle is in, which is how a
 * counter-rotating beam is bent correctly without being a special case anywhere.
 *
 * γ is per particle. One array holds every bunch in the complex, and a bunch coasting in
 * the injector at 450 GeV sits next to one being ramped in the collider.
 *
 * Kept as the reference the GPU backend must reproduce.
 */

import type { BeamState } from '../beam';
import { FIELD_STRIDE, integrateFieldZ } from '../field';
import { APERTURE_STRIDE, type OrbitFrame, makeOrbitFrame, projectToOrbit } from '../aperture';
import {
  type BackendFactory,
  type BackendStats,
  type SimBackend,
  LOSS_STRIDE,
  TRAIL_STRIDE,
  makeStats,
  recordStats,
} from '../backend';
import { ELEMENTARY_CHARGE, PROTON_MASS } from '../units';

const TRAIL_CAPACITY = 16_384;
const LOSS_CAPACITY = 64;
/** Trail samples recorded per step() call, shared out between the live particles. */
const TRAIL_BUDGET = 2048;

export class CpuBackend implements SimBackend {
  readonly id = 'cpu';
  readonly label = 'CPU (scalar, float64)';
  readonly kind = 'cpu' as const;
  readonly stats: BackendStats = makeStats();

  private beam!: BeamState;
  private field: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private scales: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private sectorCount = 0;

  private aperture: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private elementCount = 0;

  private frame: OrbitFrame = makeOrbitFrame();
  /** Last known aperture element per particle — see projectToOrbit's `hint`. */
  private hints = new Int32Array(0);
  /**
   * Design direction of travel where each particle was last projected. Kept per particle
   * because the frame is scratch shared by everyone: it decides which aperture of the
   * dipole the particle is in, and reading a neighbour's would put a beam in the wrong
   * bore. One step out of date, which is metres on a kilometres-long element.
   */
  private tanX = new Float64Array(0);
  private tanY = new Float64Array(0);
  /** Which pipe each particle was last found in — a magnet only bends its own beam. */
  private owner = new Float64Array(0);
  /** q/(γm) per particle, refreshed once per call rather than once per step. */
  private omega = new Float64Array(0);
  /**
   * Fractional step accumulator, per particle.
   *
   * A step is a fixed length in metres for every particle, so the only way a bunch can be
   * shown moving slower is to take fewer of them: `BeamState.rate` is added up here and the
   * particle advances whenever the total passes 1. A 450 GeV bunch at rate 0.25 moves on
   * every fourth iteration and covers a quarter of the ground per second — with exactly the
   * same integration error per metre as a 6.8 TeV one, which is the point of doing it this
   * way rather than by shortening its step.
   */
  private carry = new Float64Array(0);

  private trail = new Float32Array(TRAIL_CAPACITY * TRAIL_STRIDE);
  private trailCount = 0;
  private losses = new Float32Array(LOSS_CAPACITY * LOSS_STRIDE);
  private lossCount = 0;

  init(beam: BeamState): void {
    this.beam = beam;
    this.trailCount = 0;
    this.lossCount = 0;
    if (this.hints.length < beam.capacity) {
      this.hints = new Int32Array(beam.capacity);
      this.omega = new Float64Array(beam.capacity);
      this.tanX = new Float64Array(beam.capacity);
      this.tanY = new Float64Array(beam.capacity);
      this.owner = new Float64Array(beam.capacity);
      this.carry = new Float64Array(beam.capacity);
    }
    // −1 means "never projected": the first step does that before it does anything else,
    // because which way the beam pipe runs is what decides which aperture of the dipole
    // the particle is in. Seeding this from the particle's own velocity would put every
    // freshly injected bunch in the forward bore for one step — a full-strength kick with
    // the wrong sign, which is 8 mrad, which is a 27 m betatron oscillation.
    this.hints.fill(-1);
  }

  setField(table: Float32Array, sectorCount: number): void {
    this.field = table;
    this.sectorCount = Math.min(sectorCount, Math.floor(table.length / FIELD_STRIDE));
    if (this.scales.length < this.sectorCount * 2) {
      this.scales = new Float32Array(this.sectorCount * 2);
    }
  }

  setFieldScales(scales: Float32Array): void {
    this.scales.set(scales.subarray(0, Math.min(scales.length, this.scales.length)));
  }

  setAperture(table: Float32Array, elementCount: number): void {
    this.aperture = table;
    this.elementCount = Math.min(elementCount, Math.floor(table.length / APERTURE_STRIDE));
  }

  step(dt: number, steps: number): void {
    if (steps <= 0) return;
    const t0 = performance.now();

    const { x, y, vx, vy, alive, gamma, rate, count } = this.beam;
    const { field, scales, sectorCount, aperture, elementCount } = this;
    const { hints, omega, tanX, tanY, owner, carry } = this;
    const frame = this.frame;

    let live = 0;
    let rateSum = 0;
    for (let i = 0; i < count; i++) {
      if (alive[i] === 0) continue;
      omega[i] = ELEMENTARY_CHARGE / (gamma[i] * PROTON_MASS);
      rateSum += rate[i];
      live++;
    }
    if (live === 0) {
      recordStats(this.stats, performance.now() - t0, steps);
      return;
    }

    // hold the trail to a fixed budget however many particles and steps there are
    const trailStride = Math.max(1, Math.ceil((steps * Math.max(rateSum, 1e-6)) / TRAIL_BUDGET));
    let sampleTick = 0;
    let advances = 0;

    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < count; i++) {
        if (alive[i] === 0) continue;
        // A slow bunch sits out most iterations; see `carry`.
        carry[i] += rate[i];
        if (carry[i] < 1) continue;
        carry[i] -= 1;
        advances++;

        const pvx = vx[i];
        const pvy = vy[i];

        if (hints[i] < 0) {
          projectToOrbit(aperture, elementCount, x[i], y[i], frame, -1);
          hints[i] = frame.element;
          tanX[i] = frame.tx;
          tanY[i] = frame.ty;
          owner[i] = frame.owner;
        }

        // Which aperture of the dipole this particle is in: the one it is going the
        // design way through, or the one it is going backwards through.
        const base = pvx * tanX[i] + pvy * tanY[i] >= 0 ? 0 : sectorCount;

        const bz = integrateFieldZ(
          field,
          scales,
          sectorCount,
          base,
          owner[i],
          x[i],
          y[i],
          pvx * dt,
          pvy * dt,
        );
        // dv/dt = (q/γm)·(vy·Bz, −vx·Bz)  ==  rotation of v by −(q/γm)·Bz·dt
        const ang = -omega[i] * bz * dt;

        let nvx = pvx;
        let nvy = pvy;
        if (ang !== 0) {
          const c = Math.cos(ang);
          const sn = Math.sin(ang);
          nvx = pvx * c - pvy * sn;
          nvy = pvx * sn + pvy * c;
          vx[i] = nvx;
          vy[i] = nvy;
        }

        // mid-step drift keeps the closed orbit centred on the design radius
        x[i] += 0.5 * (pvx + nvx) * dt;
        y[i] += 0.5 * (pvy + nvy) * dt;

        const offset = projectToOrbit(aperture, elementCount, x[i], y[i], frame, hints[i]);
        hints[i] = frame.element;
        tanX[i] = frame.tx;
        tanY[i] = frame.ty;
        owner[i] = frame.owner;
        if (Math.abs(offset) > frame.radius) {
          alive[i] = 0;
          const speed = Math.hypot(nvx, nvy) || 1;
          this.pushLoss(frame, nvx / speed, nvy / speed, i, x[i], y[i]);
          continue;
        }

        if (sampleTick++ % trailStride === 0) this.pushTrail(x[i], y[i], frame, i);
      }
    }

    // Costed on the pushes actually done, not the iterations offered: a ring full of
    // injection-energy bunches skips three iterations in four and must not be reported as
    // four times more expensive than it is.
    recordStats(this.stats, performance.now() - t0, advances);
  }

  private pushTrail(px: number, py: number, frame: OrbitFrame, particle: number): void {
    if (this.trailCount >= TRAIL_CAPACITY) return;
    const o = this.trailCount * TRAIL_STRIDE;
    this.trail[o] = px;
    this.trail[o + 1] = py;
    this.trail[o + 2] = frame.nx;
    this.trail[o + 3] = frame.ny;
    this.trail[o + 4] = frame.offset / frame.radius;
    this.trail[o + 5] = this.beam.id[particle];
    this.trailCount++;
  }

  private pushLoss(
    frame: OrbitFrame,
    dirX: number,
    dirY: number,
    particle: number,
    px: number,
    py: number,
  ): void {
    if (this.lossCount >= LOSS_CAPACITY) return;
    const o = this.lossCount * LOSS_STRIDE;
    this.losses[o] = frame.sx;
    this.losses[o + 1] = frame.sy;
    this.losses[o + 2] = frame.nx;
    this.losses[o + 3] = frame.ny;
    this.losses[o + 4] = frame.offset;
    this.losses[o + 5] = dirX;
    this.losses[o + 6] = dirY;
    this.losses[o + 7] = particle;
    this.losses[o + 8] = frame.element;
    this.losses[o + 9] = px;
    this.losses[o + 10] = py;
    this.lossCount++;
  }

  readPositions(out: Float32Array): number {
    const n = Math.min(this.beam.count, Math.floor(out.length / 2));
    for (let i = 0; i < n; i++) {
      out[i * 2] = this.beam.x[i];
      out[i * 2 + 1] = this.beam.y[i];
    }
    return n;
  }

  drainTrail(out: Float32Array): number {
    const n = Math.min(this.trailCount, Math.floor(out.length / TRAIL_STRIDE));
    out.set(this.trail.subarray(0, n * TRAIL_STRIDE));
    this.trailCount = 0;
    return n;
  }

  drainLosses(out: Float32Array): number {
    const n = Math.min(this.lossCount, Math.floor(out.length / LOSS_STRIDE));
    out.set(this.losses.subarray(0, n * LOSS_STRIDE));
    this.lossCount = 0;
    return n;
  }

  sync(_beam: BeamState): void {
    // CPU backend mutates the host state in place; nothing to copy back.
  }

  dispose(): void {}
}

export const cpuBackendFactory: BackendFactory = {
  id: 'cpu',
  label: 'CPU',
  kind: 'cpu',
  async unavailableReason() {
    return null;
  },
  async create() {
    return new CpuBackend();
  },
};
