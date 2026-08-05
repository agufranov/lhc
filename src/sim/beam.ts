/**
 * Beam state: structure-of-arrays, fixed capacity, no per-particle objects.
 * This is the layout that maps 1:1 onto GPU storage buffers — do not turn it into
 * an array of Particle objects, ever.
 *
 * Every particle carries its own energy, because there is one of these for the whole
 * complex rather than one per ring:
 *
 *  · `gamma` — a bunch coasting in the injector at 450 GeV and a bunch being ramped in
 *    the collider are in the same array. Energy cannot be a property of a machine.
 *  · `ring` — the machine whose RF is holding this particle, or −1 for a particle in
 *    free flight down a transfer line. A ring only ramps the particles it has captured.
 *
 * There is deliberately no "which beam" field. Which aperture of a twin-bore dipole a
 * particle is in follows from the direction it is travelling relative to the design
 * direction of the element it is on — see `OrbitFrame.tx`. A second beam going the other
 * way round the ring is therefore not a special case anywhere; it is a particle injected
 * pointing the other way.
 */

import {
  C_LIGHT,
  ELEMENTARY_CHARGE,
  PROTON_MASS,
  PROTON_REST_ENERGY_GEV,
  betaFromGamma,
} from './units';

/** Box–Muller, clipped so one unlucky draw cannot throw a bunch at the wall. */
function gaussian(): number {
  const u = Math.max(Math.random(), 1e-9);
  const v = Math.random();
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(-2.5, Math.min(2.5, n));
}

/** Not in a ring: flying down a line, or in a ring that failed to capture it. */
export const FREE_FLIGHT = -1;

export class BeamState {
  readonly capacity: number;
  count = 0;

  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  /** 1 = in flight, 0 = lost, dumped or extracted into nothing. */
  readonly alive: Uint8Array;

  /** Bunch population, per macro-particle. Drives the "how much energy is in there" HUD. */
  readonly charge: Float64Array;
  /** Lorentz factor, per particle. */
  readonly gamma: Float64Array;
  /**
   * How fast this particle is stepped, as a fraction of the world's stepping rate, 0..1.
   *
   * Every particle in this array is doing 0.999999+ of the speed of light, so nothing about
   * where they *are* can show which one is the more energetic. What separates them on screen
   * has to be put there deliberately, and this is where: the world writes each particle's
   * apparent speed here from its own rapidity (`World.stepRateFor`), and the backend steps a
   * particle only that fraction of the time. The step itself is the same length in metres
   * for everybody, so the integration is exactly as accurate for a slow bunch as a fast one.
   *
   * It is a display quantity and nothing but — no force, no field and no aperture test reads
   * it. It lives here because it is per particle and the backend needs it, which is the
   * definition of a column in this array.
   *
   * **Range 0..1, and above 1 is silently lost.** The world offers iterations at the rate a
   * top-energy beam needs and the backend's accumulator advances a particle at most once per
   * iteration, so 1 is the ceiling and there is nothing above it to have. Anything that wants
   * to make one beam faster than another has to slow the other one — see `World.cogging`,
   * which worked in one direction only until it did.
   */
  readonly rate: Float64Array;
  /** Machine index whose RF holds this particle, or FREE_FLIGHT. */
  readonly ring: Int8Array;
  /** Stable identity, so a comet keeps its tail across compaction. */
  readonly id: Int32Array;

  private nextId = 1;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vy = new Float64Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.charge = new Float64Array(capacity);
    this.gamma = new Float64Array(capacity);
    this.rate = new Float64Array(capacity);
    this.ring = new Int8Array(capacity);
    this.id = new Int32Array(capacity);
  }

  clear(): void {
    this.count = 0;
    this.alive.fill(0);
  }

  /** Injects one macro-particle. `dx, dy` need not be normalised. */
  inject(spec: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    gamma: number;
    protons: number;
    ring: number;
    /** Rms angular spread to give this bunch [rad]; 0 for a perfectly aimed one. */
    divergence?: number;
    /** Rms fractional momentum spread. */
    momentumSpread?: number;
  }): number {
    if (this.count >= this.capacity) this.compact();
    if (this.count >= this.capacity) return -1;

    const i = this.count++;
    const len = Math.hypot(spec.dx, spec.dy) || 1;

    // No bunch is aimed perfectly. A real one arrives with an angular spread — its
    // emittance — and a spread in momentum, and the two together are why an injected beam
    // oscillates about the closed orbit instead of sitting on it, and why no two batches
    // sit on quite the same orbit. Here one macro-particle stands for a whole batch, so
    // what would be a spread within the bunch becomes a difference between bunches.
    const angle = gaussian() * (spec.divergence ?? 0);
    const gamma = spec.gamma * (1 + gaussian() * (spec.momentumSpread ?? 0));
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const ux = spec.dx / len;
    const uy = spec.dy / len;
    const speed = betaFromGamma(gamma) * C_LIGHT;

    this.x[i] = spec.x;
    this.y[i] = spec.y;
    this.vx[i] = (ux * c - uy * sn) * speed;
    this.vy[i] = (ux * sn + uy * c) * speed;
    this.alive[i] = 1;
    this.charge[i] = spec.protons;
    this.gamma[i] = gamma;
    // Stepped at full rate until the world has looked at it once, which is the same frame.
    this.rate[i] = 1;
    this.ring[i] = spec.ring as number;
    this.id[i] = this.nextId++;
    return i;
  }

  /**
   * Rescales a particle's velocity to match its energy. This is the RF's job, and it is
   * why the orbit stays put while the field ramps — the pusher itself is purely magnetic
   * and conserves |v| exactly, so nothing else can change it.
   */
  setGamma(i: number, gamma: number): void {
    const target = betaFromGamma(gamma) * C_LIGHT;
    const v = Math.hypot(this.vx[i], this.vy[i]);
    this.gamma[i] = gamma;
    if (v === 0) return;
    const s = target / v;
    this.vx[i] *= s;
    this.vy[i] *= s;
  }

  /** q / (γm) [C/kg] for particle i — the ω in the pusher's rotation. */
  chargeOverGammaMass(i: number): number {
    return ELEMENTARY_CHARGE / (this.gamma[i] * PROTON_MASS);
  }

  /** Momentum [GeV/c]. */
  momentum(i: number): number {
    const g = this.gamma[i];
    return Math.sqrt(Math.max(g * g - 1, 0)) * PROTON_REST_ENERGY_GEV;
  }

  aliveCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) n += this.alive[i];
    return n;
  }

  /** Drops the dead so a long session cannot run the array out. Ids are preserved. */
  compact(): void {
    let w = 0;
    for (let r = 0; r < this.count; r++) {
      if (!this.alive[r]) continue;
      if (w !== r) {
        this.x[w] = this.x[r];
        this.y[w] = this.y[r];
        this.vx[w] = this.vx[r];
        this.vy[w] = this.vy[r];
        this.alive[w] = this.alive[r];
        this.charge[w] = this.charge[r];
        this.gamma[w] = this.gamma[r];
        this.rate[w] = this.rate[r];
        this.ring[w] = this.ring[r];
        this.id[w] = this.id[r];
      }
      w++;
    }
    for (let i = w; i < this.count; i++) this.alive[i] = 0;
    this.count = w;
  }
}
