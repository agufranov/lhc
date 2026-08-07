/**
 * The experimental insertions — the only places in the machine where the two beams are
 * allowed to touch each other.
 *
 * ## Why a detector is a piece of accelerator and not a scoreboard
 *
 * Both beams in this simulation run on the same closed orbit, and they always have: which
 * aperture of a twin-bore dipole a particle is in follows from the direction it is going
 * (see `aperture.ts`), so beam 1 and beam 2 are drawn on one line and are in two pipes. A
 * forward bunch and a reverse bunch pass through each other's position twice every turn and
 * nothing happens, because there is a cold mass between them.
 *
 * An experimental insertion is where that stops being true: the two bores are brought into
 * one chamber, the beams are steered head-on, and everything that comes out of that is what
 * the experiment is there to look at. So "collisions happen in the detector" is not a rule
 * imposed on the model — it is the only place in the model where a crossing is anything at
 * all.
 *
 * ## Where they are, and why exactly two, exactly opposite
 *
 * Two counter-rotating bunches on one closed orbit meet at **two** points per turn, and
 * those two points are always exactly half a ring apart: they meet where the arclengths
 * agree, `(s₁+s₂)/2`, which is defined modulo C/2. So a pair of insertions half a ring
 * apart is phased by one and the same adjustment, and both collect collisions from the same
 * bunch pairs — which is precisely why ATLAS at Point 1 and CMS at Point 5 face each other
 * across the real ring.
 *
 * Here P1 and P5 are not available: beam 1 is injected at P2, beam 2 arrives at P8, and both
 * dump lines leave P5. Of the eight straights the only free diametrically opposite pair is
 * **P3 and P7**, and that is where these two go. They are named for their points and not for
 * the real experiments, because they are not standing where the real experiments stand.
 *
 * ## What is real in the numbers below
 *
 * All of it, except where marked. Bunches per batch, bunch spacing, the transverse beam size
 * a squeezed insertion produces, the inelastic cross-section, the Higgs cross-section. What
 * comes out of them — 2808 colliding bunch pairs, 1.2e34 cm⁻² s⁻¹, ~30 interactions per
 * crossing, about one Higgs a second, a burn-off lifetime of two days — are the real LHC's
 * numbers, and they are *derived* here rather than quoted. See `check`.
 */

import { C_LIGHT } from './units';
import type { Straight } from './lattice';
import {
  SPECIES_EM,
  SPECIES_HEAVY,
  SPECIES_KAON,
  SPECIES_LEPTON,
  SPECIES_MUON,
} from './shower';

/**
 * Bunches in one SPS batch, and how far apart they are.
 *
 * This is the number that makes the whole phasing problem tractable and it is worth being
 * explicit about. One macro-particle in this simulation is a *batch* — 234 bunches at 25 ns
 * — so it is not a point: it is **1754 m of beam**, a fifteenth of the ring. Two batches
 * crossing therefore do not meet at a point either; every bunch of one meets every bunch of
 * the other somewhere, and those meeting points are spread over the length of a batch.
 *
 * Which gives the collision rule for free, with no tolerance to invent: **bunches of two
 * batches are colliding at an interaction point exactly while both batches are covering
 * it.** Nothing else. The triangular fall-off of luminosity with mis-phasing, the 40 MHz
 * crossing rate and the 6.6 % duty cycle all come out of that one geometric statement.
 */
export const BUNCHES_PER_BATCH = 234;
/** 25 ns of beam [m]. */
export const BUNCH_SPACING = 25e-9 * C_LIGHT;
/** How long one macro-particle really is [m]. */
export const BATCH_LENGTH = BUNCHES_PER_BATCH * BUNCH_SPACING;
/** Bunch crossings per second while two batches overlap an IP [Hz] — the 40 MHz clock. */
export const CROSSING_RATE = C_LIGHT / BUNCH_SPACING;

/**
 * Transverse beam size at the interaction point [m].
 *
 * σ = √(β* ε_n / γ): 0.55 m of β*, the nominal 3.75 µm rad normalised emittance and γ at
 * 6.8 TeV give 16.6 µm. Not modelled — there are no quadrupoles here, so there is nothing
 * to squeeze with — it is quoted, because luminosity is meaningless without it and it is the
 * one number the geometry of this simulation cannot produce.
 */
export const TRANSVERSE_SIGMA = 16.6e-6;

/** Inelastic proton–proton cross-section at 13.6 TeV [cm²] — 80 mb. */
export const SIGMA_INELASTIC = 80e-27;
/** Total Higgs production cross-section [cm²] — 55 pb, the sum over production modes. */
export const SIGMA_HIGGS = 55e-36;

/** 1 fb⁻¹ in cm⁻², for the integrated-luminosity readout. */
export const FEMTOBARN_INVERSE = 1e39;

/**
 * Collision debris, and why an interaction point has to be cooled.
 *
 * Every inelastic collision releases √s and most of it goes straight on down the beam pipe
 * in both directions. The magnets that squeeze the beams into the interaction point — the
 * inner triplet, superconducting and sitting a few tens of metres away on each side — are
 * the first thing it meets, so a working experiment continuously sprays kilowatts into a
 * cold mass held at 1.9 K. That is a genuine limit on the machine and not a detail: it is one
 * of the reasons the LHC needs new triplets to run at higher luminosity.
 *
 * The power falls out of numbers already here: L × σ_inel interactions a second, each
 * carrying √s. At nominal that is 9.6e8 × 13.6 TeV = **2.1 kW**, and about 40 % of it ends
 * up in the coils rather than in absorbers or the experiment itself — a little under a
 * kilowatt a side, which is the figure the real triplets are quoted at.
 *
 * `INSERTION_COOLING` is what the cryogenics can take back out. Indicative rather than
 * sourced, and chosen against the load above: a nominal fill sits at about half of it, so the
 * machine runs cold and comfortable, and roughly twice nominal luminosity is where the
 * insertion starts to warm faster than it can be cooled. Which is the real trade, at the real
 * place on the scale.
 */
export const DEBRIS_TO_COILS = 0.4;
export const INSERTION_COOLING = 1800;
/** Cold mass of the magnets either side of one interaction point [kg] — four quadrupoles. */
export const INSERTION_COLD_MASS = 4 * 12_000;
/** Effective heat capacity of a cold mass in this range [J/(kg·K)] — as in `powering.ts`. */
const COLD_HEAT_CAPACITY = 3.5;
/** Where a superconducting insertion stops being superconducting [K]. */
export const INSERTION_QUENCH_TEMPERATURE = 4.5;
/** Operating temperature [K]. */
export const INSERTION_TEMPERATURE = 1.9;

/**
 * How big an insertion is *drawn*, in units of the ring's half-aperture — and therefore how
 * much of the ring one of them collects meetings over.
 *
 * A real experiment is 25 m across on a 27 km ring. It is a point: every collision it records
 * is within a few centimetres of the interaction point, and drawn to scale the whole of ATLAS
 * would be three pixels. So it is magnified, to 475 m across and 1100 m long, twenty times its
 * true size — and that magnification is what makes an insertion a *stretch* of ring in this
 * picture rather than a point on it.
 *
 * Once it is a stretch it has to be treated like one, and consistently. The band of
 * interpenetrating beam is drawn at 1:1 and crosses part of that stretch; a collision has to
 * be drawn at a point of the part it crosses, not at the middle of the box. Drawing every
 * vertex dead centre put flashes where the two beams demonstrably were not, which on a picture
 * that goes to the trouble of showing where they *are* is the one thing it must not do. See
 * `World.updateCollisions`.
 *
 * The renderer takes its detector size from here, so the drawn box and the volume a vertex can
 * appear in are one number and cannot drift apart.
 */
export const INSERTION_RADIUS_F = 1.9;
export const INSERTION_HALF_LENGTH_F = 2.2;

export interface DetectorConfig {
  id: string;
  /** What is written on the cavern: the experiment. */
  name: string;
  /** Which straight it stands in, as the machine names it — `P3`, `P7`. */
  point: string;
  /** Machine the insertion belongs to. */
  machine: number;
  /** Straight section it sits in; the interaction point is at that straight's centre. */
  cell: number;
  /**
   * The species this experiment is built to catch better than the other one, and the one
   * line that says why. See `TRIGGER_SPECIALTY_GAIN`.
   */
  specialty: readonly number[];
  specialtyLabel: string;
}

/**
 * How much an experiment's trigger favours the thing it was built around.
 *
 * Two general-purpose experiments record the same collisions, and they still do not keep
 * the same events, because a trigger is built out of the detector it sits behind. CMS is a
 * solenoid wrapped in muon chambers — the name is the design — and its muon triggers reach
 * lower in pT than anybody else's; ATLAS's liquid-argon calorimeter is what its electron and
 * photon menu is built on. So the same 5 GeV muon is a keeper at one point and a soft event
 * at the other, and running both here shows the two panels filling with visibly different
 * physics out of one beam.
 *
 * A real menu is a hundred lines of thresholds, prescales and isolation cuts. This is one
 * multiplier on the pT that decides what is kept, which is the shape of the thing and not
 * the substance of it — a stated departure, and the same kind as the drawing budgets.
 */
export const TRIGGER_SPECIALTY_GAIN = 1.8;

/**
 * The stream an event goes down: what the experiment thinks it just saw.
 *
 * A real readout does not write "an event"; it writes an event *into a stream*, named for
 * the object that fired the trigger — single muon, electron/photon, jet, b-physics. That
 * name is the whole of what particle identification is for, and it is the one thing an
 * event display can say in two characters: this was kept because there was a muon in it.
 */
export function triggerStream(species: number): string {
  switch (species) {
    case SPECIES_MUON:
      return 'single-μ';
    case SPECIES_LEPTON:
      return 'single-e';
    case SPECIES_EM:
      return 'γ';
    case SPECIES_HEAVY:
      return 'b-jet';
    case SPECIES_KAON:
      return 'strange';
    default:
      return 'jet';
  }
}

/**
 * The trigger, and why an experiment has to have one.
 *
 * At nominal luminosity an insertion sees a billion inelastic collisions a second and can
 * write about a thousand. Everything else is thrown away within microseconds, and the
 * decision of what to keep is made on one question: **is there anything hard in it?** Almost
 * every collision is a spray of soft pions that nobody has ever wanted to look at; what a
 * trigger is built to catch is the rare event with a high-pT object in it, because that is
 * the only kind that can contain anything that was not already known.
 *
 * That is also the answer to what a display should do with a machine producing events faster
 * than they can be read. Flashing each one for half a second is not a display of anything —
 * it is a strobe, and the eye takes nothing from it but that collisions are happening, which
 * the luminosity readout already says. So the panel shows **the best event the experiment
 * has recorded**, held, with the rate it was selected at printed beside it. Which is what an
 * experiment actually puts on the wall.
 *
 * `TRIGGER_MIN_PT` is the bar an event has to clear to be worth recording at all, and the
 * threshold then rises to whatever was last kept and **decays back** — so a monster event
 * holds the display for a while and then lets the next one in, rather than freezing it for
 * the rest of the session. A real trigger's thresholds are tuned to a bandwidth in exactly
 * this spirit, though rather more carefully.
 */
export const TRIGGER_MIN_PT = 2;
/** Seconds of wall time for the bar to fall back to `TRIGGER_MIN_PT` by 1/e. */
export const TRIGGER_DECAY = 4;

/** What the trigger kept: one collision, in both of the views there are. */
export interface KeptEvent {
  /** The r–z cascade — the same one drawn on the ring. */
  event: import('./shower').Shower;
  /** The same collision down the beam axis: curved tracks and lit calorimeter cells. */
  transverse: import('./shower').TransverseEvent;
  cmEnergyGeV: number;
  /** Interactions in the crossing this one came out of. */
  pileUp: number;
  /** Transverse momentum of the hardest object — what it was kept for. */
  score: number;
  /** The stream it went down: what the experiment made of it. See `triggerStream`. */
  stream: string;
  /** Inelastic interactions the experiment had seen when it recorded this one. */
  seen: number;
  /** `World.elapsed` when it was recorded, for the display's own flash. */
  at: number;
}

/** One collision, kept for as long as it is worth drawing. */
export interface CollisionEvent {
  detector: number;
  /** Vertex, and the beam axis there. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Where that vertex is, along the beam, from the interaction point [m]. */
  offset: number;
  /** The event's tracks, in units of the detector radius. */
  event: import('./shower').Shower;
  /** √s of the collision [GeV]. */
  cmEnergyGeV: number;
  /** Interactions this display stands for. */
  pileUp: number;
  at: number;
}

/**
 * An interaction point and everything the experiment there has counted.
 *
 * It owns no beam and no geometry beyond where it is — `World` does the counting, because
 * the question "are two batches covering this point" is about particles and particles live
 * in one array for the whole complex.
 */
export class Detector {
  readonly config: DetectorConfig;
  /** The interaction point, and the beam direction through it. */
  readonly ip: { x: number; y: number; dx: number; dy: number };
  /** Arclength of the IP along its ring's closed orbit [m]. */
  readonly s: number;
  /**
   * Half the length of ring this insertion covers [m] — `INSERTION_HALF_LENGTH_F` in metres.
   *
   * The volume a collision can be drawn in, and the stretch of the interaction region the
   * renderer draws as collected. Both have to be the same number as the drawn box.
   */
  readonly halfLength: number;

  /**
   * Luminosity [cm⁻² s⁻¹], averaged over a turn — which is how a real machine quotes it,
   * and the only form of it that does not depend on the frame rate. See `updateCollisions`.
   */
  luminosity = 0;
  /** Smoothed, so the readout does not jitter as batches are injected and burn down. */
  smoothed = 0;
  /** Batch pairs that collide here at all, and the bunch pairs that meet here per turn. */
  collidingPairs = 0;
  bunchPairs = 0;
  /**
   * Luminosity of one bunch pair while it is actually crossing [cm⁻² s⁻¹].
   *
   * The 40 MHz number, not the turn average. Pile-up is per crossing, so this is what it
   * has to be derived from — and it is why μ does not change when the phasing is off: fewer
   * bunches collide, but the ones that do are just as dense.
   */
  crossingLuminosity = 0;
  /** ∫L dt [cm⁻²], on the machine clock. */
  integrated = 0;
  /** Inelastic interactions, and Higgs bosons among them. */
  events = 0;
  higgs = 0;
  /** Protons this insertion has burned out of the beams. */
  burned = 0;

  /**
   * The trigger: the best collision this experiment has recorded, and the bar the next one
   * has to clear. See `TRIGGER_MIN_PT`.
   */
  kept: KeptEvent | null = null;
  threshold = TRIGGER_MIN_PT;
  /** Candidates the trigger has been offered, and how many of them it wrote out. */
  candidates = 0;
  recorded = 0;
  /**
   * The hardest thing this experiment has ever recorded, and what it called it.
   *
   * Two general-purpose experiments on one beam are a competition whether anybody says so or
   * not — they publish the same measurements and one of them gets there first — and since the
   * triggers here really are different (`TRIGGER_SPECIALTY_GAIN`), the two records diverge on
   * physics rather than on luck. The scoreboard in the HUD is these two numbers.
   */
  bestScore = 0;
  bestStream = '';

  /**
   * What this experiment's menu makes of an object: the pT it is worth *to it*.
   *
   * The bar is one number and the detector behind it is not, so the same object is worth
   * more at the point built to measure it — a muon at CMS, an electron or a photon at
   * ATLAS. See `TRIGGER_SPECIALTY_GAIN`.
   */
  priority(species: number, pt: number): number {
    return this.config.specialty.includes(species) ? pt * TRIGGER_SPECIALTY_GAIN : pt;
  }

  /**
   * Offers a candidate to the trigger. Returns true if it was recorded.
   *
   * The first one is always taken — an empty display says nothing about the machine — and
   * after that it is the bar, which is the last thing kept and falls back towards
   * `TRIGGER_MIN_PT` over `TRIGGER_DECAY`.
   *
   * The bar is compared against the *weighted* pT, so the two experiments keep different
   * events out of the same beam; what the panel prints is the real momentum.
   */
  offer(candidate: KeptEvent): boolean {
    this.candidates++;
    const priority = this.priority(candidate.event.hardestSpecies, candidate.score);
    if (this.kept !== null && priority < this.threshold) return false;
    this.kept = candidate;
    this.threshold = Math.max(TRIGGER_MIN_PT, priority);
    this.recorded++;
    if (candidate.score > this.bestScore) {
      this.bestScore = candidate.score;
      this.bestStream = candidate.stream;
    }
    return true;
  }

  /** Lets the bar fall back, so one exceptional event does not own the display for ever. */
  relaxTrigger(dtWall: number): void {
    const k = Math.exp(-Math.max(dtWall, 0) / TRIGGER_DECAY);
    this.threshold = TRIGGER_MIN_PT + (this.threshold - TRIGGER_MIN_PT) * k;
  }

  /**
   * One in how many inelastic interactions this experiment has written out.
   *
   * The honest denominator is `events` — every collision that really happened here — not the
   * handful of them this simulation bothered to build a cascade for. A real experiment runs
   * at about one in forty thousand.
   */
  get selectivity(): number {
    return this.recorded > 0 ? this.events / this.recorded : 0;
  }

  /** Power the collision debris is putting into the insertion's cold mass [W]. */
  debrisPower = 0;
  /** Temperature of that cold mass [K]. */
  temperature = INSERTION_TEMPERATURE;
  /** True once it has gone normal; it stays that way until the beams stop. */
  quenched = false;

  constructor(config: DetectorConfig, straight: Straight, s: number, halfLength: number) {
    this.config = config;
    this.ip = {
      x: (straight.x1 + straight.x2) / 2,
      y: (straight.y1 + straight.y2) / 2,
      dx: straight.dx,
      dy: straight.dy,
    };
    this.s = s;
    this.halfLength = halfLength;
  }

  /** Interactions per bunch crossing — the pile-up an event display has to sit in. */
  get pileUp(): number {
    return (this.crossingLuminosity * SIGMA_INELASTIC) / CROSSING_RATE;
  }

  /**
   * What fraction of a batch's bunches actually meet here, 0..1.
   *
   * 1 when the batches cross dead on the interaction point, 0 when they cross a half-batch
   * away. It is the one number that says how well the machine is phased, and it is what the
   * *rate* of events has to follow — an experiment badly phased does not see weaker
   * collisions, it sees fewer of them, because a collision is a collision.
   */
  get headOn(): number {
    if (this.collidingPairs === 0) return 0;
    return this.bunchPairs / (this.collidingPairs * BUNCHES_PER_BATCH);
  }

  /**
   * Heats the insertion with the debris of `dt` seconds of collisions and lets the
   * cryogenics take back what it can.
   *
   * Cooling is a **capacity, not a rate**, which is the whole character of the thing. A
   * refrigerator at 1.9 K can remove so many watts and no more, so below that the temperature
   * sits at the operating point however hard you run, and above it the cold mass simply
   * climbs — there is no equilibrium to find. That is why luminosity has a ceiling set by
   * cryogenics rather than by the beams, and it is why this is a limit worth having in a toy
   * about a machine: it is one of the few places where doing the thing better is what breaks
   * it.
   *
   * Run on the machine clock, like every other thermal process here.
   */
  advanceThermal(cmEnergyGeV: number, dt: number): void {
    const joulesPerInteraction = cmEnergyGeV * 1e9 * 1.602_176_634e-19;
    this.debrisPower =
      this.luminosity * SIGMA_INELASTIC * joulesPerInteraction * DEBRIS_TO_COILS;

    const capacity = INSERTION_COLD_MASS * COLD_HEAT_CAPACITY;
    const net = this.debrisPower - INSERTION_COOLING;
    if (net > 0) {
      // Nothing to balance against: over capacity the cold mass just climbs.
      this.temperature = Math.min(300, this.temperature + (net * dt) / capacity);
    } else {
      // Spare capacity takes heat out until it reaches the operating point, and no further.
      const removed = Math.min(-net * dt, (this.temperature - INSERTION_TEMPERATURE) * capacity);
      this.temperature -= removed / capacity;
    }
    if (this.temperature > INSERTION_QUENCH_TEMPERATURE) this.quenched = true;
    // Cleared by taking the load off it, which means stopping the collisions.
    if (this.quenched && this.temperature <= INSERTION_TEMPERATURE + 0.05) this.quenched = false;
  }

  /** How close the cold mass is to going normal, 0..1. */
  get thermalLoad(): number {
    const span = INSERTION_QUENCH_TEMPERATURE - INSERTION_TEMPERATURE;
    return Math.max(0, Math.min(1, (this.temperature - INSERTION_TEMPERATURE) / span));
  }

  /** ∫L dt in fb⁻¹. */
  get integratedFb(): number {
    return this.integrated / FEMTOBARN_INVERSE;
  }
}

/**
 * Luminosity of one colliding batch pair while it is actually overlapping an IP
 * [cm⁻² s⁻¹].
 *
 * L = f · n₁ n₂ / (4π σ²) with f the 40 MHz bunch crossing rate — *not* the revolution
 * frequency, because while two batches overlap a bunch pair really is meeting every 25 ns.
 * The revolution frequency reappears on its own: a batch is 1754 m of a 26 659 m ring, so
 * a given pair overlaps a given IP for 6.6 % of each turn, and the average over a turn comes
 * out at f_rev × 234 × n₁n₂/(4πσ²) without anybody writing that down.
 *
 * `protons` are per bunch, not per batch.
 */
export function pairLuminosity(protons1: number, protons2: number): number {
  const sigmaCm = TRANSVERSE_SIGMA * 100;
  return (CROSSING_RATE * protons1 * protons2) / (4 * Math.PI * sigmaCm * sigmaCm);
}
