/**
 * The things that go wrong on their own, and the one that went wrong for real.
 *
 * ## Why a machine needs accidents to be interesting
 *
 * Everything else here does what it is told. A fill that is going well is a stationary state:
 * the luminosity ticks down at its lifetime and there is nothing to decide until it is time to
 * dump. The real machine is not like that at all — it spends its life being interrupted, and
 * *availability* is the number the operations group is judged on, not peak luminosity. So this
 * is the other half of running a collider: something breaks, the beam goes, and the question is
 * how much of the fill you get back and how fast.
 *
 * Nothing here is new physics. Every incident reaches for a mechanism the model already has —
 * quench a circuit, trip one off, arm the dump kickers, take protons out of a beam — and the
 * whole of what an incident *is* is a rate, a trigger condition, and which of those it pulls.
 *
 * ## The rates are real, near enough
 *
 * Times between failures are given in **hours of machine time** and are the order of magnitude
 * the real machine runs at: a UFO — a dust grain falling into the beam, which is genuinely what
 * the acronym stands for — dumps the LHC a couple of dozen times a year against ~1500 hours of
 * stable beams; RF and cryogenics faults are the next most common causes of a premature dump.
 * At the fixed 200× machine clock that comes out at roughly one interruption per minute or two
 * of play, which is about right for a toy and honest about where it came from. See `limits.md`.
 *
 * The exception is `interconnect`, and it is deliberately once in a machine's lifetime.
 */

import type { World } from './world';

export type IncidentSeverity = 'notice' | 'alarm' | 'catastrophe';

export interface IncidentDefinition {
  id: string;
  /** What the alarm banner says. */
  name: string;
  severity: IncidentSeverity;
  /** Mean time between occurrences [hours of machine time], while `when` holds. */
  mtbfHours: number;
  /** Nothing fires unless this does — most of them need beam to be interesting. */
  when(world: World): boolean;
  /** Does it, and says what happened in one line. */
  apply(world: World, rand: () => number): string;
}

/** Is there anything circulating in the collider worth losing? */
function hasBeam(world: World): boolean {
  return world.bunchesIn(0) > 0;
}

/** A random arc of the collider, as an index into its circuits. */
function someArc(world: World, rand: () => number): number {
  return Math.min(world.collider.circuits.length - 1, Math.floor(rand() * world.collider.circuits.length));
}

function arcName(world: World, arc: number): string {
  return world.collider.ring.arcs[arc]?.name ?? `S${arc}`;
}

/**
 * The catalogue.
 *
 * Ordered by how often they happen. Each one's `apply` is three or four lines, because the
 * mechanisms are already here — which is the test of whether an incident is real or is a
 * special case bolted on: if it needs new machinery, it is a cutscene.
 */
export const INCIDENTS: readonly IncidentDefinition[] = [
  {
    id: 'ufo',
    name: 'UFO — beam dumped',
    severity: 'alarm',
    mtbfHours: 20,
    when: (w) => hasBeam(w) && w.collider.rampFraction > 0.1,
    apply(world, rand) {
      // An Unidentified Falling Object: a grain of dust, microns across, falls off the top of
      // the beam pipe and into the beam. The protons that hit it shower into the nearest
      // magnet, the loss monitors see the spike, and the interlock dumps the beam — which is
      // the system working exactly as designed, on something nobody can prevent.
      const arc = someArc(world, rand);
      world.collider.circuits[arc].deposit(2e5 * rand());
      world.dumpBeams();
      return `UFO in ${arcName(world, arc)} — loss monitors over threshold, beams dumped`;
    },
  },
  {
    id: 'rf',
    name: 'RF cavity trip',
    severity: 'alarm',
    mtbfHours: 35,
    when: hasBeam,
    apply(world) {
      // A klystron trips, a cavity loses its field, and the bunches it was holding start to
      // debunch. The interlock does not wait to find out how that ends.
      world.dumpBeams();
      return 'RF cavity trip — the bucket was lost and the interlock dumped both beams';
    },
  },
  {
    id: 'vacuum',
    name: 'vacuum pressure rise',
    severity: 'notice',
    mtbfHours: 45,
    when: hasBeam,
    apply(world, rand) {
      // Beam–gas scattering: protons hitting residual molecules leave the beam. It is the one
      // incident that does not end the fill — it makes the fill worse, which is the more
      // interesting thing to do to it, because now the question is whether to keep running.
      const factor = 6 + rand() * 10;
      world.setVacuumFault(factor, 900);
      return `vacuum pressure rise — beam–gas losses up ${factor.toFixed(0)}×; the fill is dying faster than it is burning`;
    },
  },
  {
    id: 'power',
    name: 'power glitch — circuit tripped',
    severity: 'alarm',
    mtbfHours: 60,
    when: (w) => hasBeam(w) || w.collider.rampFraction > 0.5,
    apply(world, rand) {
      // A dip on the 18 kV network opens a breaker. The field in that sector fades with the
      // extraction time constant, and a beam with one arc missing does not survive it — this
      // is the incident where the beam dies in the wall rather than in the absorber.
      const arc = someArc(world, rand);
      world.collider.circuits[arc].enabled = false;
      return `power glitch — ${arcName(world, arc)} dipole circuit tripped off, and the beam is in it`;
    },
  },
  {
    id: 'cryo',
    name: 'cryogenics fault — sector quench',
    severity: 'alarm',
    mtbfHours: 90,
    when: (w) => w.collider.rampFraction > 0.3,
    apply(world, rand) {
      // Lose the cold and the coil goes normal on its own, with no beam needed. Twenty minutes
      // of machine time to get it back, which is the expensive kind of interruption.
      const arc = someArc(world, rand);
      world.collider.circuits[arc].quench();
      if (hasBeam(world)) world.dumpBeams();
      return `cryogenics fault in ${arcName(world, arc)} — the sector quenched with no beam-induced loss at all`;
    },
  },
  {
    id: 'interconnect',
    name: 'INTERCONNECT FAILURE',
    severity: 'catastrophe',
    mtbfHours: 6000,
    // 19 September 2008: a bad splice between two dipoles, at 8.7 kA on the way to 5.5 TeV.
    // It only exists above most of nominal current, which is where the joint had to carry
    // enough for its resistance to matter.
    when: (w) => w.collider.circuits.some((c) => c.load > 0.75 && !c.isDown),
    apply(world, rand) {
      // What actually happened: the splice went resistive, an arc burned through the helium
      // enclosure, and six tonnes of helium at 1.9 K went into the tunnel at a rate the relief
      // valves were never sized for. Fifty-three magnets were damaged and the machine was down
      // for fourteen months. Here: the sector and both its neighbours go, everything stops, and
      // it takes as long as three quenches take.
      const arc = someArc(world, rand);
      const n = world.collider.circuits.length;
      for (const k of [arc, (arc + 1) % n, (arc + n - 1) % n]) {
        const circuit = world.collider.circuits[k];
        circuit.deposit(3e7);
        circuit.quench();
      }
      world.dumpBeams();
      world.shakeGround(1);
      return (
        `INTERCONNECT FAILURE at ${arcName(world, arc)} — a splice went resistive at ` +
        `${(world.collider.circuits[arc].load * 100).toFixed(0)} % of nominal. Helium in the tunnel; ` +
        'three sectors down. This is 19 September 2008.'
      );
    },
  },
];

/**
 * What the papers made of it.
 *
 * The machine was going to make a black hole, a strangelet, or a hole in the vacuum, and the
 * answer in every case is the same one and it is worth knowing: **the cosmic ray flux has been
 * running this experiment on the Earth, the Moon and every star for billions of years, at
 * energies this machine cannot reach.** That argument is what the 2008 LHC Safety Assessment
 * Group report is built on, and it is a much better piece of physics than the scare it answers.
 *
 * So the press turns up when something goes bang, and gets corrected in the same line.
 */
export const PRESS_LINES: readonly string[] = [
  'PRESS: “LHC CREATES BLACK HOLE” — one would need extra dimensions to form at all, and ' +
    'would evaporate by Hawking radiation in about 1e−27 s, long before crossing a proton.',
  'PRESS: “STRANGELET SWALLOWS GENEVA” — no stable strange matter has ever been observed, and ' +
    'heavier cosmic-ray nuclei have been hitting the Moon at these energies for 4.5 billion years.',
  'PRESS: “SCIENTISTS RESTART DOOMSDAY MACHINE” — the atmosphere absorbs a cosmic ray above ' +
    'this energy about ten times a second, and has done since before there was an atmosphere.',
  'PRESS: “VACUUM DECAY FEARED” — if the vacuum could be tipped over at 13.6 TeV, the universe ' +
    'would have done it to itself 1e22 times over by now.',
  'PRESS: “TIME TRAVELLER SABOTAGES COLLIDER” — the 2009 bird, the 2008 splice and this one ' +
    'were all cryogenics, metallurgy and a baguette respectively.',
];

/** One line of the machine's own chronicle. */
export interface LogEntry {
  /** `World.machineClock` when it happened. */
  at: number;
  kind: 'machine' | 'incident' | 'press' | 'physics' | 'fill';
  severity: IncidentSeverity;
  text: string;
}

/**
 * Rolls for incidents, once a frame, on the machine clock.
 *
 * Poisson: each definition gets `dt/MTBF` of a chance every frame, which is exact in the limit
 * and frame-rate independent to the accuracy anybody could measure. There is one global
 * cool-down, because two alarms in the same second read as a bug rather than as bad luck.
 */
export class IncidentSystem {
  /** Machine seconds of quiet still owed after the last incident. */
  private cooldown = 0;
  /** Every incident that has fired, newest last. */
  readonly fired: Array<{ id: string; at: number }> = [];
  /**
   * **Off unless somebody asks for it, and the app asks for it.**
   *
   * A headless run is a measurement, and a measurement with random interruptions in it is not
   * one: `check` puts thirty seconds of play — an hour and a half of machine time — through a
   * dozen worlds, and at these rates about a quarter of those would be interrupted. Every
   * number in `docs/reference.md` would then be a number *usually*. So the simulation is
   * quiet by default and `main.ts` switches it on, unless the page was opened `?quiet=1`,
   * which is how the browser gates get a deterministic machine to measure the layout on.
   */
  enabled = false;

  private seed = 0x1badd00d;

  /** Machine seconds of calm after any incident, so they never arrive on top of each other. */
  static readonly COOLDOWN = 600;

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Fires at most one incident, and returns it, or null on a quiet frame. */
  advance(world: World, dtMachine: number): { def: IncidentDefinition; text: string } | null {
    if (!this.enabled || dtMachine <= 0) return null;
    if (this.cooldown > 0) {
      this.cooldown -= dtMachine;
      return null;
    }
    for (const def of INCIDENTS) {
      if (!def.when(world)) continue;
      const chance = dtMachine / (def.mtbfHours * 3600);
      if (this.rand() >= chance) continue;
      this.cooldown = IncidentSystem.COOLDOWN;
      this.fired.push({ id: def.id, at: world.machineClock });
      return { def, text: def.apply(world, () => this.rand()) };
    }
    return null;
  }

  /** A press reaction, or null — they only turn up for the loud ones, and not every time. */
  pressLine(severity: IncidentSeverity): string | null {
    if (severity === 'notice') return null;
    if (severity !== 'catastrophe' && this.rand() > 0.35) return null;
    return PRESS_LINES[Math.floor(this.rand() * PRESS_LINES.length) % PRESS_LINES.length];
  }

  /**
   * Forces one by id, and returns what `advance` would have returned for it — so everything
   * downstream of an incident happens the same way whether it arrived or was asked for.
   * See `World.forceIncident`.
   */
  force(world: World, id: string): { def: IncidentDefinition; text: string } | null {
    const def = INCIDENTS.find((d) => d.id === id);
    if (!def) return null;
    this.cooldown = IncidentSystem.COOLDOWN;
    this.fired.push({ id: def.id, at: world.machineClock });
    return { def, text: def.apply(world, () => this.rand()) };
  }
}
