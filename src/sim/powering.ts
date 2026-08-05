/**
 * Main dipole powering, per arc, and what happens when one gives up.
 *
 * Superconducting circuit: no resistive loss while it is cold and happy, so the wall
 * plug only sees power while the current is *changing* — P = L·I·dI/dt. That is the
 * whole drama of a ramp: gigajoules go into the magnets over ~20 minutes, and have to
 * come back out again.
 *
 * ## Quench
 *
 * A superconductor is only superconducting below a surface in (temperature, field,
 * current). Push it past that surface anywhere — a few millijoules per cubic centimetre
 * is enough at 7 TeV, which is a few times 10⁻⁷ of the stored beam — and that spot goes
 * normal, dissipates I²R, heats its neighbours, and the normal zone spreads along the
 * coil at metres per second. That is a quench, and the reason it is taken so seriously is
 * arithmetic: the circuit is holding of order a gigajoule, and all of it has to go
 * somewhere in seconds.
 *
 * What is modelled, in the order it happens:
 *
 *  1. **Trigger.** Beam hits the wall inside the magnet. `deposit()` puts the joules into
 *     the cold mass; if the temperature goes past what the load line allows at that
 *     current, the magnet goes normal. The margin shrinks as the current rises, which is
 *     why a magnet at injection survives what a magnet at flat top does not.
 *  2. **Detection.** A resistive voltage appears across the coil, and it has to be told
 *     apart from the inductive one. Real detection takes ~10 ms, and that delay is here
 *     because it is why quench heaters exist at all.
 *  3. **Protection.** Heaters fire and drive the *whole* coil normal deliberately, so the
 *     stored energy is spread over the whole magnet instead of boiling one spot. Then the
 *     circuit breaker opens and the current decays into the extraction resistors.
 *  4. **Aftermath.** The cold mass ends up at tens of kelvin, and cannot take current
 *     again until it is back at 1.9 K. Clicking the magnet starts that.
 *
 * Two numbers are compressed rather than faked, and both are marked where they are used:
 * detection is slowed to something visible, and recovery is minutes rather than the eight
 * hours it takes to re-cool and re-precycle a real sector.
 */

export type CircuitState =
  | 'cold'
  | 'ramping'
  | 'flat'
  | 'off'
  | 'quenching'
  | 'quenched'
  | 'recovering';

export interface CircuitConfig {
  inductance: number; // H
  nominalCurrent: number; // A
  /** dI/dt limit [A/s]. The LHC ramps its main dipoles at about 10 A/s. */
  rampRate: number;
  /** Energy-extraction time constant once a quench is detected [s]. */
  extractionTau: number;
  /** Cold mass of the circuit's magnets [kg]. */
  coldMass: number;
  /**
   * Temperature the coil may reach at zero current before it goes normal [K].
   *
   * The real quantity is a surface in (T, B, I); at fixed geometry the part that matters
   * is that the margin closes as the current rises, which is what `quenchTemperature`
   * does with it.
   */
  quenchMargin: number;
}

/** Operating temperature of the LHC magnets: superfluid helium [K]. */
export const OPERATING_TEMPERATURE = 1.9;
/**
 * Quench detection + heater delay [s of machine time].
 *
 * The real one is about 10 ms, which at any watchable time compression is one frame and
 * therefore invisible. Stretched so the sequence can be seen; it is the only part of the
 * quench chain whose duration is not the real one.
 */
const DETECTION_TIME = 0.4;
/**
 * Cool-down after a quench [s of machine time].
 *
 * The real figure is 8–12 hours to re-cool and re-precycle a sector, and at 60× that is
 * eight minutes of staring at an orange arc. Compressed to twenty minutes of machine
 * time — a third of a ramp, so it still hurts.
 */
const RECOVERY_TIME = 1200;
/** Effective heat capacity of the cold mass around 10 K [J/(kg·K)]. */
const COLD_HEAT_CAPACITY = 3.5;

export class MagnetCircuit {
  current = 0;
  targetCurrent = 0;
  /** dI/dt of the last update [A/s]. */
  currentRate = 0;
  /** Instantaneous electrical power drawn by this circuit [W]; negative = extracting. */
  power = 0;
  state: CircuitState = 'cold';
  /**
   * Switched on by the operator. Switching off does not zero the field: 15 H holding
   * 11 kA has to dump its energy through the extraction resistors first, so the sector
   * fades out over a time constant and the beam has that long to survive without it.
   */
  enabled = true;

  /** Coil temperature [K]. Nominal operating point is superfluid helium at 1.9 K. */
  temperature = OPERATING_TEMPERATURE;
  /** Fraction of the critical surface used up; > 1 means the magnet goes normal. */
  loadLine = 0;
  /** Peak temperature reached in the last quench [K]. */
  peakTemperature = OPERATING_TEMPERATURE;
  /** Seconds of machine time left in the current phase. */
  timer = 0;

  constructor(readonly config: CircuitConfig) {}

  get storedEnergy(): number {
    return 0.5 * this.config.inductance * this.current * this.current;
  }

  get load(): number {
    return this.config.nominalCurrent > 0 ? this.current / this.config.nominalCurrent : 0;
  }

  /** True while the circuit cannot hold current at all. */
  get isDown(): boolean {
    return this.state === 'quenching' || this.state === 'quenched' || this.state === 'recovering';
  }

  /**
   * Temperature at which the coil goes normal at the current it is carrying [K].
   *
   * Linear in the load fraction: at zero current the margin is the full `quenchMargin`
   * above 1.9 K, at nominal current it is gone. That is the shape of the real load line,
   * and it is the reason the same hit is survivable at injection and fatal at flat top.
   */
  get quenchTemperature(): number {
    // A real magnet keeps about a seventh of its zero-current margin at nominal, which is
    // the ~1 K that quench protection is designed around; it does not go to zero.
    const margin = this.config.quenchMargin * Math.max(0.15, 1 - 0.85 * Math.abs(this.load));
    return OPERATING_TEMPERATURE + margin;
  }

  /** How close the coil is to going normal, 0..1. */
  get quenchProximity(): number {
    const span = this.quenchTemperature - OPERATING_TEMPERATURE;
    if (span <= 0) return 1;
    return Math.min(1, (this.temperature - OPERATING_TEMPERATURE) / span);
  }

  /**
   * Puts `joules` into the cold mass. Returns true if that quenched it.
   *
   * A direct beam hit is not a marginal event: 23 MJ into 27 tonnes is thousands of
   * kelvin before any of it conducts away, against a margin measured in single kelvin.
   * The interesting question is never whether it quenches, it is what happens next.
   */
  deposit(joules: number): boolean {
    if (this.isDown) return false;
    this.temperature += joules / (this.config.coldMass * COLD_HEAT_CAPACITY);
    if (this.temperature < this.quenchTemperature) return false;
    this.quench();
    return true;
  }

  /** Forces a quench — the trigger having already been decided elsewhere. */
  quench(): void {
    if (this.isDown) return;
    this.state = 'quenching';
    this.timer = DETECTION_TIME;
    this.peakTemperature = this.temperature;
  }

  /** Operator reset: start cooling back to 1.9 K. */
  beginRecovery(): void {
    if (this.state !== 'quenched') return;
    this.state = 'recovering';
    this.timer = RECOVERY_TIME;
  }

  /** Advances by `dt` seconds of *machine* time. */
  update(dt: number): void {
    if (dt <= 0) return;
    const prev = this.current;

    switch (this.state) {
      case 'quenching': {
        // Detection window: the coil is already normal somewhere and the current is still
        // flowing through it. Nothing has opened yet, so the field is still there and the
        // beam is still being bent — for about ten real milliseconds.
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'quenched';
          // heaters have now driven the whole coil normal on purpose: the stored energy
          // is spread over the cold mass instead of concentrated where the beam hit
          this.temperature +=
            this.storedEnergy * 0.35 / (this.config.coldMass * COLD_HEAT_CAPACITY);
          this.peakTemperature = Math.max(this.peakTemperature, this.temperature);
        }
        break;
      }
      case 'quenched':
        // breaker open: the current decays into the extraction resistors
        this.current *= Math.exp(-dt / this.config.extractionTau);
        break;
      case 'recovering': {
        this.current *= Math.exp(-dt / this.config.extractionTau);
        this.timer -= dt;
        // cryogenics pulling the cold mass back down to 1.9 K
        const k = Math.min(1, dt / Math.max(this.timer + dt, 1e-6));
        this.temperature += (OPERATING_TEMPERATURE - this.temperature) * k;
        if (this.timer <= 0) {
          this.temperature = OPERATING_TEMPERATURE;
          this.state = 'cold';
          this.enabled = true;
        }
        break;
      }
      default: {
        if (!this.enabled) {
          this.current *= Math.exp(-dt / this.config.extractionTau);
        } else {
          const delta = this.targetCurrent - this.current;
          const maxStep = this.config.rampRate * dt;
          this.current += Math.abs(delta) <= maxStep ? delta : Math.sign(delta) * maxStep;
        }
        // heat leaking back out to the helium bath between events
        this.temperature += (OPERATING_TEMPERATURE - this.temperature) * Math.min(1, dt / 30);
        break;
      }
    }

    this.currentRate = (this.current - prev) / dt;
    // P = V·I with V = L·dI/dt
    this.power = this.config.inductance * this.current * this.currentRate;

    if (!this.isDown) {
      const moving = Math.abs(this.currentRate) > 0.05;
      this.state = !this.enabled ? 'off' : moving ? 'ramping' : this.current > 1 ? 'flat' : 'cold';
    }

    this.loadLine = this.quenchProximity;
  }
}
