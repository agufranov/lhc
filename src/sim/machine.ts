/**
 * One accelerator ring: lattice + powering + the energy programme it is running.
 *
 * It does **not** own a beam. Particles live in one array for the whole complex (see
 * world.ts) because a bunch on its way from the injector to the collider is in neither
 * ring and in the same simulation as both. A ring's relationship to a particle is only
 * this: it may have captured it, in which case its RF holds that particle's energy.
 *
 * What is left here is the machine as an operator sees it: what the ramp programme is
 * asking for, what each circuit is actually doing, and what that costs.
 */

import { type Ring, type RingConfig, buildRing } from './lattice';
import { MagnetCircuit } from './powering';
import {
  ELEMENTARY_CHARGE,
  PROTON_REST_ENERGY_GEV,
  betaFromGamma,
  C_LIGHT,
  fieldForRadius,
  gammaFromEnergy,
  momentumFromEnergy,
} from './units';

export interface MachineOptions {
  /** Cryogenics electrical load while cold [W]. */
  cryoPower: number;
  /** Everything else on site: ventilation, controls, experiments [W]. */
  servicesPower: number;
}

export const DEFAULT_MACHINE_OPTIONS: MachineOptions = {
  cryoPower: 27e6,
  servicesPower: 20e6,
};

export interface MachineTelemetry {
  energyGeV: number;
  momentumGeVc: number;
  gamma: number;
  beta: number;
  field: number;
  current: number;
  load: number;
  storedMagnetEnergy: number;
  magnetPower: number;
  totalPower: number;
  revolutionPeriod: number;
  revolutionFrequency: number;
  quenched: number;
}

export class Machine {
  readonly ring: Ring;
  readonly circuits: MagnetCircuit[];
  readonly options: MachineOptions;

  /**
   * What the ramp programme asks the dipoles to run at [A].
   *
   * The beam's momentum follows *this*, not the mean of the circuits: the RF holds the
   * energy, and switching a magnet off does not slow the protons down — it just stops
   * bending them there, which is exactly why it kills the beam.
   */
  programmedCurrent: number;

  /**
   * The RF, as a switch.
   *
   * With it on, a captured beam's momentum follows the ramp — which is the only reason
   * the orbit stays put while the field climbs, because the radius the field wants is
   * p/(qB) and both terms are moving together. Switch it off and the field goes on rising
   * under a beam whose momentum is frozen: the orbit spirals inwards and the beam is in
   * the magnets within a few turns. That is what a synchrotron is *for*, and it is worth
   * being able to watch it not happen.
   */
  rfOn = true;

  private targetEnergyGeV: number;

  constructor(config: RingConfig, options: Partial<MachineOptions> = {}) {
    this.options = { ...DEFAULT_MACHINE_OPTIONS, ...options };
    this.ring = buildRing(config);
    this.targetEnergyGeV = config.injectionEnergyGeV;

    const nominalMomentum = momentumFromEnergy(config.topEnergyGeV);
    this.circuits = this.ring.arcs.map(
      () =>
        new MagnetCircuit({
          inductance: config.arcInductance,
          nominalCurrent: config.nominalCurrent,
          rampRate: config.rampRate,
          extractionTau: 104,
          coldMass: config.arcColdMass,
          quenchMargin: config.quenchMargin,
        }),
    );
    // start pre-cycled at injection current
    const injectionFraction = momentumFromEnergy(config.injectionEnergyGeV) / nominalMomentum;
    for (const c of this.circuits) {
      c.current = c.config.nominalCurrent * injectionFraction;
      c.targetCurrent = c.current;
    }
    this.programmedCurrent = config.nominalCurrent * injectionFraction;
  }

  // --- energy / field bookkeeping -------------------------------------------

  /** Beam momentum follows the programmed current: p ∝ B ∝ I. */
  get momentumGeVc(): number {
    const nominal = momentumFromEnergy(this.ring.config.topEnergyGeV);
    return nominal * (this.programmedCurrent / this.ring.config.nominalCurrent);
  }

  get energyGeV(): number {
    const p = this.momentumGeVc;
    return Math.sqrt(p * p + PROTON_REST_ENERGY_GEV * PROTON_REST_ENERGY_GEV);
  }

  get gamma(): number {
    return gammaFromEnergy(this.energyGeV);
  }

  get meanCurrent(): number {
    let sum = 0;
    for (const c of this.circuits) sum += c.current;
    return sum / this.circuits.length;
  }

  /** Field the programme is asking for [T]. */
  get fieldStrength(): number {
    return fieldForRadius(this.momentumGeVc, this.ring.bendRadius);
  }

  /**
   * Signed field of one sector [T], from the current that is actually in its coil.
   *
   * This is the number the pusher gets, and it is where "a dead magnet stops bending the
   * protons but does not slow them down" lives: the beam's momentum comes from
   * `programmedCurrent`, the bend from `circuit.current`, and nothing keeps them equal.
   */
  sectorField(index: number): number {
    const arc = this.ring.arcs[index];
    const circuit = this.circuits[index];
    const cfg = this.ring.config;
    const momentum =
      momentumFromEnergy(cfg.topEnergyGeV) * (circuit.current / cfg.nominalCurrent);
    return arc.fieldSign * fieldForRadius(momentum, this.ring.bendRadius);
  }

  get revolutionPeriod(): number {
    const beta = betaFromGamma(this.gamma);
    return this.ring.config.circumference / (beta * C_LIGHT);
  }

  setTargetEnergy(energyGeV: number): void {
    const cfg = this.ring.config;
    const clamped = Math.max(cfg.injectionEnergyGeV, Math.min(energyGeV, cfg.topEnergyGeV));
    this.targetEnergyGeV = clamped;
    for (const c of this.circuits) {
      if (c.enabled && c.state !== 'quenched') c.targetCurrent = this.programmedTarget;
    }
  }

  get targetEnergy(): number {
    return this.targetEnergyGeV;
  }

  /**
   * Where the ramp programme has got to: 0 sitting at injection energy, 1 at flat top.
   *
   * Linear in momentum, which is linear in current, which is what actually moves — so this
   * is the fraction of the ramp that has been *done*, not a fraction of the energy.
   */
  get rampFraction(): number {
    const cfg = this.ring.config;
    const lo = momentumFromEnergy(cfg.injectionEnergyGeV);
    const hi = momentumFromEnergy(cfg.topEnergyGeV);
    if (hi - lo < 1e-9) return 1;
    return Math.max(0, Math.min(1, (this.momentumGeVc - lo) / (hi - lo)));
  }

  /** True while the dipoles are still moving towards what the programme asked for. */
  get isRamping(): boolean {
    return Math.abs(this.programmedTarget - this.programmedCurrent) > 1e-3;
  }

  /** Current the ramp programme is heading for [A]. */
  get programmedTarget(): number {
    const cfg = this.ring.config;
    const fraction =
      momentumFromEnergy(this.targetEnergyGeV) / momentumFromEnergy(cfg.topEnergyGeV);
    return cfg.nominalCurrent * fraction;
  }

  /**
   * Operator switch on one arc's dipole circuit. Switching off leaves ~1 GJ in the coil,
   * so the field fades with the extraction time constant rather than vanishing.
   *
   * It does not buy the beam much: with no quadrupoles there is nothing restoring the
   * orbit, and a few per cent missing from a sector's bending is already far more than
   * the aperture can absorb. On a quenched circuit this is the reset that starts it
   * cooling back down.
   */
  toggleCircuit(index: number): boolean {
    const circuit = this.circuits[index];
    if (!circuit) return false;
    if (circuit.state === 'quenched') {
      circuit.beginRecovery();
      return false;
    }
    circuit.enabled = !circuit.enabled;
    if (circuit.enabled) circuit.targetCurrent = this.programmedTarget;
    return circuit.enabled;
  }

  /** Advances powering and the ramp programme by `dt` seconds of machine time. */
  advanceOperations(dt: number): void {
    // the programme ramps at the same rate the circuits are allowed to follow it
    const target = this.programmedTarget;
    const delta = target - this.programmedCurrent;
    const maxStep = this.circuits[0].config.rampRate * dt;
    this.programmedCurrent += Math.abs(delta) <= maxStep ? delta : Math.sign(delta) * maxStep;

    for (const c of this.circuits) c.update(dt);
  }

  // --- telemetry ------------------------------------------------------------

  get magnetPower(): number {
    let sum = 0;
    for (const c of this.circuits) sum += c.power;
    return sum;
  }

  get storedMagnetEnergy(): number {
    let sum = 0;
    for (const c of this.circuits) sum += c.storedEnergy;
    return sum;
  }

  get quenchedCount(): number {
    let n = 0;
    for (const c of this.circuits) if (c.state === 'quenched' || c.state === 'quenching') n++;
    return n;
  }

  telemetry(): MachineTelemetry {
    const gamma = this.gamma;
    const period = this.revolutionPeriod;
    const magnetPower = this.magnetPower;
    return {
      energyGeV: this.energyGeV,
      momentumGeVc: this.momentumGeVc,
      gamma,
      beta: betaFromGamma(gamma),
      field: this.fieldStrength,
      current: this.meanCurrent,
      load: this.meanCurrent / this.ring.config.nominalCurrent,
      storedMagnetEnergy: this.storedMagnetEnergy,
      magnetPower,
      totalPower:
        Math.max(magnetPower, 0) + this.options.cryoPower + this.options.servicesPower,
      revolutionPeriod: period,
      revolutionFrequency: 1 / period,
      quenched: this.quenchedCount,
    };
  }
}

/** Joules in `protons` protons of energy `energyGeV`. */
export function beamEnergyJoules(protons: number, energyGeV: number): number {
  return protons * energyGeV * ELEMENTARY_CHARGE * 1e9;
}
