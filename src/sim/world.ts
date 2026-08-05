/**
 * The accelerator complex, as one simulated world.
 *
 * Two rings, four lines between and out of them, and **one** array of particles pushed by
 * **one** backend against **one** field table and **one** aperture table. That is the
 * whole design, and every feature above it falls out of it:
 *
 *  · A bunch leaving the injector is not handed over to the collider — nothing happens to
 *    it at all. It keeps flying, and what bends it is whatever magnet it is passing. The
 *    version before this had a table per ring, and a bunch that left the injector by an
 *    unplanned route sailed straight through the collider's dipoles as though they were
 *    not there. It could only be "injected" by a geometric test that guessed where it
 *    ought to be.
 *  · Several beams are several particles. There is nothing to say about the second one.
 *  · A beam going the other way round the ring is a particle pointing the other way. It
 *    is in the other aperture of the twin-bore dipole, so the field it sees is reversed
 *    and it is bent correctly, and that is the entire implementation (see field.ts).
 *  · A dump is a transfer line that ends in a block instead of a ring.
 *
 * A ring's only relationship to a particle is capture: if the RF programme matches the
 * particle's momentum, that ring holds its energy and ramps it. If it does not — a
 * 450 GeV bunch arriving at a machine that has ramped to 6.8 TeV — the ring does not
 * capture it, does not accelerate it, and bends it fifteen times too hard. There is no
 * interlock anywhere; injecting into a ramped machine is allowed, and you watch why it
 * is not done.
 */

import {
  type Arc,
  type Placement,
  type Ring,
  type RingConfig,
  LHC_CONFIG,
  SPS_CONFIG,
  buildRing,
} from './lattice';
import { type BeamLine, type Pose, buildTransferLine, routeLine, sampleLine } from './line';
import { Machine, beamEnergyJoules } from './machine';
import { MagnetCircuit } from './powering';
import { BeamState, FREE_FLIGHT } from './beam';
import { type DamageSite, channelTemperature, penetrationDepth } from './damage';
import { buildCollision, buildShower, buildTransverse } from './shower';
import {
  BATCH_LENGTH,
  BUNCHES_PER_BATCH,
  BUNCH_SPACING,
  type CollisionEvent,
  Detector,
  INSERTION_HALF_LENGTH_F,
  SIGMA_HIGGS,
  SIGMA_INELASTIC,
  pairLuminosity,
} from './detector';
import { LOSS_STRIDE, type SimBackend } from './backend';
import {
  APERTURE_STRIDE,
  NO_MACHINE,
  NO_SECTOR,
  type OrbitFrame,
  makeOrbitFrame,
  projectToOrbit,
  writeArc,
  writeStraight,
} from './aperture';
import { FIELD_STRIDE } from './field';
import {
  C_LIGHT,
  PROTON_REST_ENERGY_GEV,
  betaFromGamma,
  gammaFromEnergy,
  momentumFromEnergy,
} from './units';

/**
 * Where the injector is parked: the length of TI 2, the line that aims it.
 *
 * TI 2 is a pure drift — `placeInjector` moves the whole injector so that it is — so this
 * number is both the length of that line and the distance the SPS stands off the collider.
 * It is therefore the one knob that decides how compact the complex is, and what it is
 * traded against is the *second* line, whose two ends are then both fixed.
 *
 * Measured, for TI 8 leaving sextant `TI8_EXIT_CELL` with the outward kick: there is no
 * route at all below 3.02 km of standoff, and from 3.05 km up to about 4.7 km the same
 * family of routes exists — one 437 m dipole turning 30°, into collider straight 7 — with
 * the tunnel growing 0.4 m for every metre the injector moves out. So the shortest end of
 * that family is the compact one; 3.2 km sits 180 m clear of the feasibility edge, which
 * a ring's own aperture is enough reason for.
 *
 * The 500 m TI 2 pays over the real 2.7 km buys 6.1 km on TI 8 — 10.42 km down to 4.32,
 * against a real 2.7 — so the complex as a whole is closer to the machine, not further.
 */
export const INJECTOR_STANDOFF = 3200;

/**
 * Length of a beam dump line [m]. The LHC's runs ~700 m from IR6 to its cavern.
 *
 * Drawn at 700 the absorber sat *on top of* the collider tunnel. Everything about a dump
 * line is measured in its own aperture — see the block constants below — and the collider's
 * tunnel wall already reaches 1.18 of the collider's, so at the shared 250 m aperture the
 * cavern overlapped the ring it is supposed to protect. Lengthening the line and narrowing
 * the pipe (`DUMP_APERTURE_F`) fixes both ends of that.
 *
 * The number is no longer the real 700 m and says so: it is what it takes to stand the
 * cavern clear of a tunnel drawn 3600x too wide.
 */
export const DUMP_LINE_LENGTH = 2000;

/**
 * The absorber, in units of the dump line's own aperture: half-width across the beam, and
 * length along it from the end of the line.
 *
 * A real TDE is a slender thing — 7.7 m of graphite in a 700 mm bore, eleven diameters
 * long — and the block used to be drawn squat, 4.4 apertures across and 3 deep, which read
 * as a shed rather than as something a beam bores into. Long and thick is also what the
 * penetration picture needs: the channel a full beam drives is metres of the real thing but
 * a good fraction of the block here, and it has to have somewhere to go.
 *
 * The length is doing a second job. The pusher stops a particle by the *transverse* test —
 * `|offset| > radius` — so a bunch running straight down the middle of a pipe is not stopped
 * by reaching the end of it; it coasts on until some other element's wall claims it, which
 * measured ~100 m past the mouth. A block that is deep enough to contain that is a block the
 * beam really does stop inside, and `isDumpEnd` can then ask the honest question.
 */
export const DUMP_BLOCK_HALF_WIDTH_F = 3.2;
export const DUMP_BLOCK_LENGTH_F = 12;

/**
 * Dump pipe radius as a fraction of the collider's aperture.
 *
 * A dump line only ever carries beam straight into a block, so it does not need the wide
 * aperture the rings are drawn with (see "the one deliberate lie" in CLAUDE.md) — that
 * width exists to make a field-free straight *inside a ring* visible, and a dump line is
 * nothing but a field-free straight. Narrow enough to read as a side tunnel, wide enough
 * that a dumped batch (~10 mm off the closed orbit) is nowhere near the wall.
 */
export const DUMP_APERTURE_F = 0.42;

/**
 * Protons in one macro-particle: one SPS batch.
 *
 * The LHC is filled with 12 SPS batches, and 12 × 234 × 1.15e11 is the nominal 2808
 * bunches — so a full fill really is twelve presses of the button, and the stored beam
 * energy climbs to the 352 MJ the reference numbers quote as you do it.
 */
export const PROTONS_PER_BATCH = 234 * 1.15e11;

/** Machine seconds for the chain to put a fresh batch in the injector. */
export const INJECTOR_CYCLE = 21.6;

/**
 * Injector straight the second transfer line leaves from: the sextant the beam reaches
 * immediately *before* TI 2's, which is one step **clockwise** on screen from the far-side
 * sextant TI 8 used to leave from.
 *
 * Cell index runs clockwise on screen — the injector's `sense` is −1, so it turns clockwise
 * in world coordinates, and the camera maps a y-up world onto y-down pixels without
 * mirroring the picture, so what turns clockwise in the world turns clockwise on screen.
 *
 * This sextant faces the collider, so the line comes off the ring already pointing roughly
 * where it has to go, and the bend it then needs turns the *other* way and is short with it:
 * +30° against the ring's own curvature where the far sextant needed −75° with it, 437 m of
 * dipole where that needed 1092, 4.32 km of tunnel where that needed 10.42. Measured across
 * all six sextants and all eight collider straights, at every standoff that has a route.
 *
 * It is not a pure drift, and no sextant but TI 2's own can be: a line leaves along one of
 * six tangents 60° apart and a collider straight is entered along one of eight 45° apart,
 * and only the antiparallel pair lines up with that grid at all. So TI 8 has dipoles, on
 * their own circuit, and switching them off strands the beam in the tunnel.
 */
const TI8_EXIT_CELL = 5;

/**
 * Which way TI 8's kicker throws the bunch.
 *
 * Inward — leaning the line back towards the collider instead of letting it fan out — is
 * the obvious way to shorten it, and it does not close. Scanned both sextants either side
 * of TI 2's, against all eight collider straights, over injector standoffs from 1.4 to
 * 9 km in 50 m steps, allowing one *and* two dipole strings and every radius from 1.8 T
 * up: there is **no** route that clears both rings. An inward kick sends the bunch across
 * the injector's own middle, and by the time it is out the far side it is pointing away
 * from the collider.
 *
 * What does turn the line the other way is the *bend*, not the kick: from this sextant the
 * route curves +30° where the old one curved −75° (see `TI8_EXIT_CELL`). The kick stays
 * outward because that is the one that has a route.
 *
 * `kickSign` stays in `LineConfig` because it costs nothing and the next geometry may want
 * it.
 */
const TI8_KICK_SIGN = 1;

/**
 * The two dump insertions — **one per beam, and they cannot share one.**
 *
 * Both dumps used to leave `DUMP_CELL` together, one out of each end, and that does not
 * close. A kicker has to sit at its own beam's *near* end of the straight, because the pulse
 * is timed off the arc the bunch arrives from and a device further down the straight than the
 * pulse is long would be reached after the field had collapsed. So with a kicker filling a
 * fraction f of the straight, beam 1's line leaves at f·L and beam 2's at (1−f)·L — and
 * whichever way f goes, one of two things is wrong:
 *
 *  · **f < 0.5**: beam 1 leaves *upstream* of beam 2, then runs downstream while beam 2 runs
 *    upstream. The two lines cross. Measured at f = 0.42: 26 m between two pipes 105 m wide,
 *    so the picture had one dump drawn through the other.
 *  · **f > 0.5**: the exits are the right way round, but the two kickers now occupy the same
 *    metres of tunnel, which was the reason f was dropped to 0.42 in the first place.
 *
 * There is no f that satisfies both, so the straight is the thing that has to give. Beam 2
 * dumps out of the *next* insertion round, which its own direction of travel reaches first —
 * so both lines leave the same arc (`kickerSector` 4 for both), from opposite ends of it, and
 * diverge instead of crossing. Each kicker then gets a whole straight to itself and goes back
 * to `KICKER_LENGTH_F`: 961 m of device, 72 px, and half the field it needed at 0.42.
 *
 * The real machine puts both at IR6 and does this with geometry ninety metres wide that this
 * simulation does not have; two insertions is the honest way to say the same thing at a
 * 3600× aperture.
 */
const DUMP_CELL = 4;
const DUMP_CELL_BEAM2 = 3;

/**
 * The straights the two experimental insertions sit in — P3 and P7.
 *
 * They **have** to be exactly half a ring apart, and that is not a preference. Two
 * counter-rotating bunches on one closed orbit meet where their arclengths agree, at
 * `(s₁+s₂)/2`, which is a quantity defined modulo C/2: there are two meeting points per
 * turn and they are always antipodal. Put the second insertion anywhere else and it needs
 * its own phasing, and no single adjustment can serve both. It is the same fact that puts
 * ATLAS and CMS opposite each other on the real ring.
 *
 * P1 and P5, where the real general-purpose experiments are, are not free here: beam 1 is
 * injected at P2, beam 2 arrives at P8, and both dump lines leave P5. Of the four antipodal
 * pairs of straights that leaves exactly one, and this is it.
 */
const DETECTOR_CELLS = [2, 6];

/**
 * Cogging: the fractional trim put on beam 2's revolution frequency while the operator
 * holds the control, and how fast that walks the crossing point around the ring.
 *
 * This is the real lever. To move where two counter-rotating beams meet you cannot move
 * either of them sideways — you change how fast one of them goes round, let it slip, and
 * stop when the meeting point is where you want it. A slip of `u` metres moves the crossing
 * point by u/2, so at 2 % of a revolution the crossing walks at 1 % of the ring per turn:
 * 266 m of ring per second at injection, 533 m at flat top, and the 874 m that separates a
 * head-on collision from nothing takes about two seconds to cross.
 *
 * A real machine trims by parts per million and takes minutes over it. This is the same
 * exaggeration as everything else on the beam clock, and the same reason: two per cent is
 * what makes beam 2 *visibly* crawl against beam 1 while the control is held, which is the
 * entire point of having a control rather than a checkbox. A real cogging shift also moves
 * the beam radially, which is not modelled.
 */
const COG_TRIM = 0.04;

/**
 * How close to head-on a synchronised injection has to get before the kicker will fire, and
 * why it is not tighter.
 *
 * **The phase a batch can be delivered at is quantised.** Nothing that happens while the
 * bunch is in flight can change where it will meet the other beam — see `bucketState` — so
 * the only lever is which pass of the injector to fire on, and waiting one more injector
 * turn steps the eventual crossing point by a fixed amount. What comes back after the wrap
 * is a grid about 430 m across, and that is a real number: it is what the LHC being very
 * nearly 27/7 of the SPS does, and it is why the two machines' RF is locked on the real
 * machine rather than left to chance.
 *
 * So a synchronised pulse cannot promise head-on, and demanding it is what makes injection
 * feel broken: measured, insisting on ±247 m meant hunting round the grid for up to
 * thirty injector turns — thirteen seconds of the machine visibly doing nothing. What it
 * promises instead is **collisions**: land inside the batch overlap, where the experiments
 * see something immediately, which takes one to three turns. Getting from there to the peak
 * is what cogging is for, and that division is the honest one — a real fill is injected on
 * buckets and *then* cogged.
 */
const SYNC_WINDOW = (BATCH_LENGTH / 2) * 0.3;
/** The widest it will settle for, and how long it takes to get there. */
const SYNC_WINDOW_MAX = (BATCH_LENGTH / 2) * 0.9;
/**
 * How long the pulse insists on the tight window before it will take whatever collides.
 *
 * The grid is coarse — about 430 m, one thirty-first of the half-ring the crossing point can
 * sit anywhere in — so a fixed threshold makes the wait a lottery: measured, the same fill
 * held 1.2 s once and 8.9 s the next time, for no reason the operator can see or act on.
 * Relaxing the window takes a good phase if one comes round early and settles for a working
 * one if not, which bounds the hold at a few seconds.
 *
 * It cannot do better than that and should not pretend to. Landing inside the overlap is
 * what injection can promise; the last few hundred metres are cogging's job, and needing
 * both is the honest shape of the problem rather than a gap in it.
 */
const SYNC_RELAX = 5;
/** Seconds of wall clock an armed kicker will wait for its bucket before giving up. */
const SYNC_TIMEOUT = 12;

/** How long a collision event stays on the screen [s]. */
const EVENT_LIFETIME = 1.1;

/**
 * Interpenetrating batch pairs kept per frame — a drawing budget, not a physical limit.
 *
 * A nominal fill has twelve batches each way and about twelve of them are passing through
 * each other at any instant; the luminosity sum above is over every pair either way.
 */
const MAX_OVERLAPS = 32;


/**
 * The kicker–septum pair, which is how a beam really leaves a ring.
 *
 * Two devices with two jobs, and neither of them is "switch a dipole off":
 *
 *  · the **kicker** is short, pulsed and fast. It fires between one bunch and the next and
 *    gives that one bunch a small angular deflection — enough to walk it sideways, over
 *    the drift that follows, out of the circulating beam's channel and into the septum's.
 *  · the **septum** is long, strong and *permanently on*. Its field sits in a channel
 *    displaced from the closed orbit, behind a blade; the circulating beam passes it every
 *    turn and never feels it. Only a bunch the kicker has moved across gets in, and there
 *    the septum cancels the ring's bend, so it leaves in a straight line.
 *
 * "One pulse, one bunch" is therefore not a rule imposed on anything: the septum would
 * take any beam in its channel, and the kicker is the only thing that puts one there.
 *
 * `KICK_ANGLE` is scaled with the aperture, like the aperture itself. A real MKI turns the
 * beam by 0.28 mrad because it only has to clear a septum blade a couple of centimetres
 * away; the pipe here is 3600× the real one, so the channel it has to reach across is
 * 3600× further, and the angle goes with it. The field that implies is reported by
 * `npm run check` rather than hidden.
 */
const KICK_ANGLE = 0.09;
/**
 * Kicker length as a fraction of the straight it sits in.
 *
 * A real MKI is fifteen metres of ferrite, and at 0.06 of a straight this was drawn at that
 * proportion: a 22 m mark, two pixels, at the *near* end of the straight — while the beam
 * only visibly leaves the ring at the arc up to 1131 m (a hundred pixels) further on, where
 * the septum cancels the bend. The flash and the departure were nowhere near each other and
 * the thing in between is a straight section, so what the eye saw was a kicker that fired
 * and did nothing, followed by a beam that carried on straight for no visible reason.
 *
 * Running it down most of the straight puts its downstream end where the beam actually
 * leaves, so the bunch is seen entering the violet device and coming out of it aimed
 * somewhere else. It also makes the field *more* plausible, not less — the same angle over
 * sixteen times the length is a sixteenth of the field: 0.75 T on the SPS against 6.0 T,
 * and 3.5 T on the LHC at flat top against the 12.6 T the short one would have needed.
 *
 * It has to stay at the near end. The pulse is timed off the arc the bunch arrives from and
 * lasts one arc transit; a device at the far end of the straight would be a whole straight
 * further away than that pulse is long, and the bunch would get there after it had passed.
 */
const KICKER_LENGTH_F = 0.85;
/** How far into the aperture the septum's channel begins, as a fraction of the kick. */
const SEPTUM_STANDOFF_F = 0.4;

/** Momentum mismatch a ring's RF can still capture. */
const CAPTURE_WINDOW = 0.02;

export interface WorldOptions {
  /** Integration steps per revolution *of the collider*; the step is a fixed length. */
  stepsPerTurn: number;
  /**
   * Apparent collider revolutions per wall second, at three anchors.
   *
   * Three and not two, because there are now three energies in this complex that matter:
   * the injector's flat bottom (26 GeV, what the chain delivers), the collider's injection
   * energy (450 GeV, what the injector hands over) and the collider's flat top. The map
   * between them is interpolated on rapidity — see `turnsPerSecondAt`.
   */
  turnsPerSecondAtFlatBottom: number;
  turnsPerSecondAtInjection: number;
  turnsPerSecondAtTop: number;
  /** Machine-time seconds per wall second (drives ramps, power, cryo, refills). */
  opsTimeScale: number;
  maxStepsPerFrame: number;
  protonsPerBatch: number;
  /**
   * Rms angle a fresh bunch is delivered with [rad], and its rms momentum spread.
   *
   * 0.4 mrad on the injector's 741 m bend radius is a 0.3 m betatron oscillation — half a
   * per cent of its pipe — so a batch wobbles about the closed orbit rather than sitting
   * on it, and no two batches wobble alike. Large enough to see on a beam that has been
   * round a few times, small enough that a bunch still survives the transfer line.
   */
  divergence: number;
  momentumSpread: number;
}

export const DEFAULT_OPTIONS: WorldOptions = {
  stepsPerTurn: 2400,
  turnsPerSecondAtFlatBottom: 0.2,
  turnsPerSecondAtInjection: 0.5,
  turnsPerSecondAtTop: 2,
  opsTimeScale: 200,
  maxStepsPerFrame: 20_000,
  protonsPerBatch: PROTONS_PER_BATCH,
  divergence: 4e-4,
  momentumSpread: 3e-4,
};

/** A particle that ended up in the wall. Feeds the impact flash and the quench rule. */
export interface BeamLoss {
  sx: number;
  sy: number;
  nx: number;
  ny: number;
  offset: number;
  /** Machine it was lost in, or NO_MACHINE for a transfer or dump line. */
  machine: number;
  /** Field sector it was lost in, or NO_SECTOR. */
  sector: number;
  energyGeV: number;
  depositedEnergy: number;
  /**
   * Distance from the impact to the nearest superconducting coil [m], and the fraction of
   * the shower that reached it. Zero gap means the beam let go inside the magnet.
   */
  coilGap: number;
  coilFraction: number;
  /** True if the loss quenched the magnet nearest it. */
  quenched: boolean;
  /** True if the beam was meant to end here. */
  onPurpose: boolean;
  at: number;
}

/** Which magnet a global field sector belongs to. */
export interface SectorRef {
  machine: number;
  arc: number;
  /** Line index if the sector is a transfer-line dipole, else -1. */
  line: number;
}

export type KickerState = 'idle' | 'armed' | 'firing';

/**
 * How an armed injection kicker chooses its moment.
 *
 *  · `bucket` — it waits until firing would put the batch head-on with one already
 *    circulating the other way, and only then lets go. This is what a real injection does,
 *    and it is why a real fill collides without anybody aiming it: the SPS and the LHC run
 *    on locked RF and a batch goes into a chosen bucket, not into the next gap.
 *  · `now` — it fires on the first bunch that comes past. The batch lands wherever it lands,
 *    the crossing point is somewhere in the arcs, and the experiments see nothing. Kept
 *    because it is the demonstration: press it, then look at the interaction region and see
 *    where the two beams are actually meeting.
 *
 * A dump kicker ignores this entirely — there is nothing to be in phase with.
 */
export type KickerTiming = 'bucket' | 'now';

/** One extraction path: the line, its kicker and what powers its bend. */
export interface Extraction {
  line: BeamLine;
  state: KickerState;
  circuit: MagnetCircuit | null;
  /** Wall-clock stamp of the last pulse, for the flash. */
  firedAt: number;
  /** Beam-clock time the pulse ends. */
  until: number;
  /** Bunches that have gone down it. */
  sent: number;
  /** Index in the global field table of this line's septum, or −1 if it has none. */
  septum: number;
  /** Index of its kicker, and the kicker's geometry for drawing. */
  kicker: number;
  kickerArc: Arc | null;
  /** Whether this pulse waits for its bucket, and when it was armed (`World.elapsed`). */
  timing: KickerTiming;
  armedAt: number;
  /** Set while the pulse is armed and holding for phase, for the readout. */
  waitingForBucket: boolean;
}

export interface AdvanceResult {
  steps: number;
  /** Particle ids that appeared this frame — their comet tails must start clean. */
  spawned: number[];
}

// --- injector placement ------------------------------------------------------

/**
 * Positions an injector ring so that a tangent leaving it lands exactly on the collider's
 * injection point, pointing the way the collider's beam goes.
 *
 * That first line is therefore a pure drift, aimed by construction. Every line after it
 * has to be steered with dipoles, because both ends are already fixed — which is what
 * `buildTransferLine` is for.
 */
export function placeInjector(
  collider: Ring,
  base: RingConfig,
  lineLength = INJECTOR_STANDOFF,
  exitCell = 0,
): RingConfig {
  const target = collider.injection;
  const ex = target.x - target.dx * lineLength;
  const ey = target.y - target.dy * lineLength;

  // Aim the ray the beam actually leaves on — after the kicker, not the tangent. The
  // kicker turns it by KICK_ANGLE before it ever reaches the transfer line.
  const probe = buildRing({ ...base, placement: { x: 0, y: 0, rotation: 0 } });
  const k = buildKicker(probe, exitCell, 1, 1);
  const rotation = Math.atan2(target.dy, target.dx) - Math.atan2(k.exit.dy, k.exit.dx);

  const c = Math.cos(rotation);
  const sn = Math.sin(rotation);
  const placement: Placement = {
    x: ex - (k.exit.x * c - k.exit.y * sn),
    y: ey - (k.exit.x * sn + k.exit.y * c),
    rotation,
  };
  return { ...base, placement };
}

/**
 * There was a `solveStandoff` here that searched for the injector placement at which the
 * *second* tangent also grazed the collider's closed orbit, so that both transfer lines
 * could be pure drifts. It is gone, and the negative result is why: swept from 2 to 9 km in
 * 20 m steps and refined to half a metre, no standoff produces a graze at all — the search
 * returned `Infinity` every time and the injector was parked at the fallback constant.
 * Nothing was solving anything. TI 8 bends by design now, and `INJECTOR_STANDOFF` says what
 * it is chosen against instead.
 */

/** Pose at the far end of a straight, pointing back along it — beam 2's way in. */
function reverseEntryPose(ring: Ring, cell: number): Pose {
  const s = ring.straights[cell % ring.straights.length];
  return { x: s.x2, y: s.y2, dx: -s.dx, dy: -s.dy };
}

/** Do the two segments properly cross? */
function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * The kicker in straight `cell`, and the pose of the beam that has just been through it.
 *
 * It sits at the near end of the straight — where the bunch enters, which is x1 going
 * forwards and x2 going backwards — so the drift that follows is the whole straight, and
 * that drift is what turns a small angle into a useful displacement. Everything after the
 * kicker is one straight ray: the drift is field free, and the septum cancels the ring's
 * bend, so a transfer line starting here is a line and not a curve.
 */
export function buildKicker(
  ring: Ring,
  cell: number,
  bore: number,
  kickSign = 1,
  lengthFraction = KICKER_LENGTH_F,
  angle = KICK_ANGLE,
): { arc: Arc; exit: Pose; drift: number; displacement: number } {
  const s = ring.straights[cell % ring.straights.length];
  const dx = s.dx * bore;
  const dy = s.dy * bore;
  const x = bore > 0 ? s.x1 : s.x2;
  const y = bore > 0 ? s.y1 : s.y2;

  // outward, away from the ring centre — which is on the left of the design direction
  // when the ring turns left, and so on the right of a beam running the other way
  const turn = -ring.config.sense * bore * kickSign * angle;
  const length = s.length * lengthFraction;
  const radius = length / Math.abs(turn);
  const sign = Math.sign(turn);
  const cx = x - sign * dy * radius;
  const cy = y + sign * dx * radius;
  const phiStart = Math.atan2(y - cy, x - cx);

  const arc: Arc = {
    index: 0,
    name: 'MK',
    cx,
    cy,
    radius,
    phiStart,
    dPhi: turn,
    fieldSign: -sign,
    length,
    dipoles: 1,
  };
  const phiEnd = phiStart + turn;
  const drift = s.length - length;
  return {
    arc,
    exit: {
      x: cx + radius * Math.cos(phiEnd),
      y: cy + radius * Math.sin(phiEnd),
      dx: dx * Math.cos(turn) - dy * Math.sin(turn),
      dy: dx * Math.sin(turn) + dy * Math.cos(turn),
    },
    drift,
    // How far off the closed orbit the bunch is by the end of the straight: the sagitta it
    // gains inside the kicker plus the walk over whatever drift is left. Taking only the
    // drift term was right when the kicker was a 22 m mark and wrong now that it is most of
    // the straight — the septum's channel is placed from this, and placing it too far out
    // leaves the extracted bunch short of it.
    displacement: 0.5 * Math.abs(turn) * length + Math.abs(turn) * drift,
  };
}

/** Pose at the end of a ring's straight `cell`, going the way the beam goes. */
function exitPose(ring: Ring, cell: number): Pose {
  const s = ring.straights[cell % ring.straights.length];
  return { x: s.x2, y: s.y2, dx: s.dx, dy: s.dy };
}

/** Pose at the start of a ring's straight `cell`, going backwards — beam 2's way out. */
function reverseExitPose(ring: Ring, cell: number): Pose {
  const s = ring.straights[cell % ring.straights.length];
  return { x: s.x1, y: s.y1, dx: -s.dx, dy: -s.dy };
}

// --- the injector chain ahead of the injector --------------------------------

/**
 * Everything ahead of the injector, drawn as **one straight run of accelerating structure**
 * ending on the injector's injection point.
 *
 * Linac4, the Booster and the PS used to be three objects here — two little rings and a
 * stub, laid out backwards at their real sizes. At the scale of a picture eleven kilometres
 * across the PS is a 100 m circle and the Booster a 25 m one: two dots the eye cannot
 * resolve and cannot learn anything from, sitting in the one place where a *long* object
 * would read. So they are one tube now, and its length is the honest sum of what it stands
 * for — 86 m of Linac4, 157 m of Booster and 628 m of PS, 871 m of machine, which is 70 px
 * and reads as the long thing it is.
 *
 * **It runs along the injection straight, so the protons fly into the injector without a
 * kink**, and because that straight points east-south-east the whole chain reads as firing
 * south-east into the ring. Nothing is tracked in it: the injector is the first machine
 * this simulation integrates, and what arrives out of the end of this tube is a batch at
 * `CHAIN_ENERGY` GeV (see `fillInjector`).
 */
export interface InjectorChain {
  /** Upstream end, and the injection point it delivers to. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  name: string;
  note: string;
  length: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Machine length the drawn tube stands for [m]: Linac4 + PSB + PS.
 *
 * Not a magnification. Drawn back along the injection straight it costs the picture
 * nothing — it lands inside the bounding box the two rings already need.
 */
export const CHAIN_LENGTH = 86 + 157.08 + 628.3;

export function buildInjectorChain(injector: Ring): InjectorChain {
  const entry = injector.injection;
  const x1 = entry.x - entry.dx * CHAIN_LENGTH;
  const y1 = entry.y - entry.dy * CHAIN_LENGTH;
  return {
    x1,
    y1,
    x2: entry.x,
    y2: entry.y,
    name: 'LINAC4 · PSB · PS',
    note: `→ ${SPS_CONFIG.injectionEnergyGeV} GeV`,
    length: CHAIN_LENGTH,
    bounds: {
      minX: Math.min(x1, entry.x),
      minY: Math.min(y1, entry.y),
      maxX: Math.max(x1, entry.x),
      maxY: Math.max(y1, entry.y),
    },
  };
}

// --- the world ---------------------------------------------------------------

export class World {
  readonly collider: Machine;
  readonly injector: Machine;
  readonly machines: Machine[];
  readonly extractions: Extraction[];
  readonly detectors: Detector[];
  readonly chain: InjectorChain;
  readonly beam: BeamState;
  readonly options: WorldOptions;

  backend: SimBackend | null = null;

  /** Beam-frame elapsed time [s]. */
  beamClock = 0;
  /** Operations elapsed time [s]. */
  machineClock = 0;
  /** Collider revolutions since the world started. */
  turns = 0;
  /**
   * Seconds of simulation the world has been asked to advance.
   *
   * Not `performance.now()`. Anything paced against the wall clock keeps running while the
   * simulation is paused and runs at the wrong speed when it is driven headless — `check`
   * puts twenty seconds of beam through in fifty milliseconds, so a kicker timed against
   * the wall never times out and never relaxes its window. Anything the *machine* waits for
   * is timed against this instead; only the render flashes, which are about what the eye
   * has just seen, still use the wall clock.
   */
  elapsed = 0;

  readonly losses: BeamLoss[] = [];
  readonly damage: DamageSite[] = [];
  /** Collisions still worth drawing, newest last. */
  readonly collisions: CollisionEvent[] = [];
  /**
   * Where the two beams are interpenetrating this frame — the whole of what the renderer
   * draws as the interaction region, and the reason a flash in an experiment has visible
   * beam under it. Recomputed every frame from where the batches actually are.
   */
  readonly overlaps: BeamOverlap[] = [];

  /**
   * Cogging: −1, 0 or +1. Held by the operator, or driven by `coggingAuto`.
   *
   * It trims beam 2's revolution frequency, which is the only way to move where the two
   * beams meet — see `COG_TRIM`.
   */
  cogging = 0;
  /** True while the automatic cogging loop is walking the crossing point onto an IP. */
  coggingAuto = false;

  /** How far the injector stands off the collider — the length of TI 2 [m]. */
  readonly standoff: number;
  /** Machine seconds until the injector chain delivers its next batch; 0 = idle. */
  fillRemaining = 0;
  fills = 0;

  private readonly fieldTable: Float32Array;
  private readonly sectorRefs: SectorRef[];
  private readonly apertureTable: Float32Array;
  private readonly elementCount: number;
  private readonly scales: Float32Array;

  private stepCarry = 0;
  private readonly frame: OrbitFrame = makeOrbitFrame();
  private readonly lossScratch = new Float32Array(64 * LOSS_STRIDE);
  /** Scratch: this frame's collider bunches, split by which way round they are going. */
  private readonly forward: BunchOnOrbit[] = [];
  private readonly reverse: BunchOnOrbit[] = [];
  /** Whether each detector had a crossing last frame, so an event is drawn once per pass. */
  private wasColliding: boolean[] = [];
  /** Fractional entitlement to an event display, per detector — see `updateCollisions`. */
  private eventCredit: number[] = [];
  private eventSeed = 1;

  constructor(
    colliderConfig: RingConfig = LHC_CONFIG,
    injectorConfig: RingConfig = SPS_CONFIG,
    options: Partial<WorldOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.collider = new Machine(colliderConfig);
    // The injector is parked so that TI 2 is a drift of exactly this length, which is also
    // as close to the collider as TI 8's route allows (see INJECTOR_STANDOFF).
    this.standoff = INJECTOR_STANDOFF;
    this.injector = new Machine(
      placeInjector(this.collider.ring, injectorConfig, this.standoff),
    );
    this.machines = [this.collider, this.injector];
    this.beam = new BeamState(1024);

    this.chain = buildInjectorChain(this.injector.ring);

    this.extractions = this.buildLines();

    // The insertions. They own nothing but a place on the closed orbit; whether anything is
    // colliding there is a question about particles, and particles live in one array.
    this.detectors = DETECTOR_CELLS.map((cell) => {
      const straight = this.collider.ring.straights[cell];
      const mid = { x: (straight.x1 + straight.x2) / 2, y: (straight.y1 + straight.y2) / 2 };
      return new Detector(
        {
          id: `ip${cell + 1}`,
          name: `IP${cell + 1}`,
          machine: 0,
          cell,
        },
        straight,
        arclengthOnRing(this.collider.ring, mid.x, mid.y).s,
        this.collider.ring.config.apertureRadius * INSERTION_HALF_LENGTH_F,
      );
    });
    this.wasColliding = this.detectors.map(() => false);
    this.eventCredit = this.detectors.map(() => 0);

    const built = this.buildTables();
    this.fieldTable = built.field;
    this.sectorRefs = built.refs;
    this.apertureTable = built.aperture;
    this.elementCount = built.elementCount;
    this.scales = new Float32Array(this.sectorRefs.length * 2);
  }

  // --- construction ---------------------------------------------------------

  private buildLines(): Extraction[] {
    const lhc = this.collider.ring;
    const sps = this.injector.ring;
    const spsAperture = sps.config.apertureRadius;
    const lhcAperture = lhc.config.apertureRadius;
    const injectionMomentum = momentumFromEnergy(sps.config.topEnergyGeV);

    const lines: BeamLine[] = [];

    // TI 2 — into the collider's beam 1. A pure drift: the injector was placed for it.
    lines.push(
      buildTransferLine(
        {
          id: 'ti2',
          name: 'TI 2',
          apertureRadius: spsAperture,
          fieldRegionHalfWidth: spsAperture * 1.3,
          bore: 1,
          designMomentumGeVc: injectionMomentum,
          fromMachine: 1,
          kickerCell: 0,
          kickerSector: 0,
          kickSign: 1,
          kickerLengthF: KICKER_LENGTH_F,
          toMachine: 0,
        },
        buildKicker(sps, 0, 1, 1, KICKER_LENGTH_F).exit,
        { ...lhc.injection },
      ),
    );

    // TI 8 — into the collider's beam 2, which runs the other way round the same ring.
    //
    // The exit sextant is pinned (`TI8_EXIT_CELL`), not searched: which side of the injector
    // the beam leaves from is a decision about the layout, and letting a scan over all six
    // pick it meant a tuning change somewhere else could silently move the extraction to the
    // far side of the ring and add six kilometres of tunnel. What is still searched is the
    // one thing with no layout content — which of the collider's eight straights to aim at.

    /** How far a tangent runs before it is clear of the ring's own pipe [m]. */
    const runOutOf = (ring: Ring): number =>
      Math.sqrt(2 * ring.bendRadius * ring.config.apertureRadius) * 1.25;

    const clearsRings = (line: BeamLine): boolean => {
      for (const orbit of [lhc.orbit, sps.orbit]) {
        const pts = sampleLine(line, 60);
        for (let i = 1; i < pts.length; i++) {
          if (pts[i][2] < 60 || pts[i][2] > line.length - 60) continue;
          for (let k = 0; k < orbit.length; k += 2) {
            const j = (k + 2) % orbit.length;
            if (segmentsCross(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1],
                              orbit[k], orbit[k + 1], orbit[j], orbit[j + 1])) return false;
          }
        }
      }
      return true;
    };

    // Scored on steel and only then on tunnel, the same way `routeLine` scores the radius:
    // a route that saves a kilometre of empty tunnel by asking for a longer dipole is not
    // the cheaper one.
    const steel = (line: BeamLine): number => line.arcs.reduce((n, a) => n + a.length, 0);
    let best8: BeamLine | null = null;
    const exitCell = TI8_EXIT_CELL;
    const ti8FromCell = buildKicker(sps, exitCell, 1, TI8_KICK_SIGN, KICKER_LENGTH_F).exit;
    for (let cell = 0; cell < lhc.straights.length; cell++) {
      const route = routeLine(
        {
          id: 'ti8',
          name: 'TI 8',
          apertureRadius: spsAperture,
          fieldRegionHalfWidth: spsAperture * 1.3,
          bore: 1,
          designMomentumGeVc: injectionMomentum,
          fromMachine: 1,
          kickerCell: exitCell,
          kickerSector: exitCell,
          kickSign: TI8_KICK_SIGN,
          kickerLengthF: KICKER_LENGTH_F,
          toMachine: 0,
        },
        ti8FromCell,
        reverseEntryPose(lhc, cell),
        // One correcting dipole, a tunnel of a sane length — and the dipole has to stand
        // clear of the ring it is taking beam from. A magnet only bends what is in its own
        // pipe, and for the first √(2ρa) of a tangential departure the bunch is still
        // inside the injector's: a bend placed there does nothing at all, and the beam
        // runs into the wall of the transfer line it was supposed to be steered down.
        (line) =>
          line.arcs.length <= 1 &&
          line.length < 14_000 &&
          line.straights[0] !== undefined &&
          line.straights[0].length > runOutOf(sps) &&
          clearsRings(line),
      );
      if (!route) continue;
      if (
        !best8 ||
        steel(route) < steel(best8) - 1 ||
        (Math.abs(steel(route) - steel(best8)) <= 1 && route.length < best8.length)
      ) {
        best8 = route;
      }
    }
    if (!best8) {
      throw new Error(
        `TI 8: no route out of sextant ${exitCell} clears the rings at a ${INJECTOR_STANDOFF} m ` +
          'standoff — see INJECTOR_STANDOFF for the range that has one',
      );
    }
    lines.push(best8);

    // The two dump lines, both out of `DUMP_CELL` — drawn as Point 5, where the real ones
    // leave Point 6 — one per beam. That one straight's difference is what puts the
    // experiments at P3 and P7 instead of at the real P1 and P5: with the dumps at P5 the
    // only free antipodal pair of straights is P3/P7 (see `DETECTOR_CELLS`), and moving them
    // to their real P6 would free P1/P5 for the experiments at the cost of re-checking that
    // the absorbers still stand clear. Beam 1 leaves
    // forwards out of the end of the straight; beam 2, travelling the other way, leaves
    // backwards out of the start of the same one — which is the next sector along in its
    // direction of travel, hence a different kicker.
    const dumpMomentum = momentumFromEnergy(lhc.config.topEnergyGeV);
    const dumpAperture = lhcAperture * DUMP_APERTURE_F;
    const cells = lhc.arcs.length;
    for (const [name, pose, cell, sector, bore] of [
      ['TD1', exitPose(lhc, DUMP_CELL), DUMP_CELL, DUMP_CELL, 1],
      [
        'TD2',
        reverseExitPose(lhc, DUMP_CELL_BEAM2),
        DUMP_CELL_BEAM2,
        (DUMP_CELL_BEAM2 - 1 + cells) % cells,
        -1,
      ],
    ] as const) {
      // the dump line runs along the ray the kicker puts the beam on, not the tangent
      // The same call, with the same length fraction, as the one `buildTables` makes for the
      // field sector — they are two statements of one device and nothing checks that they
      // agree. If they disagree the line starts somewhere the kicker does not point.
      const dumpFrom = buildKicker(lhc, cell, bore, 1, KICKER_LENGTH_F).exit;
      void pose;
      lines.push(
        buildTransferLine(
          {
            id: name.toLowerCase(),
            name,
            apertureRadius: dumpAperture,
            fieldRegionHalfWidth: dumpAperture * 1.3,
            bore,
            designMomentumGeVc: dumpMomentum,
            fromMachine: 0,
            kickerCell: cell,
            kickerSector: sector,
            kickSign: 1,
            kickerLengthF: KICKER_LENGTH_F,
            toMachine: -1,
          },
          dumpFrom,
          {
            x: dumpFrom.x + dumpFrom.dx * DUMP_LINE_LENGTH,
            y: dumpFrom.y + dumpFrom.dy * DUMP_LINE_LENGTH,
            dx: dumpFrom.dx,
            dy: dumpFrom.dy,
          },
        ),
      );
    }

    return lines.map((line) => ({
      line,
      state: 'idle' as KickerState,
      // A line's dipoles sit at their set point the whole time — a transfer line is not
      // ramped, it is set for the energy it carries and left there. Switching one off is
      // what makes the beam miss.
      circuit: line.arcs.length > 0 ? energised() : null,
      firedAt: -1e9,
      until: -1,
      sent: 0,
      septum: -1,
      kicker: -1,
      kickerArc: null,
      timing: 'bucket' as KickerTiming,
      armedAt: 0,
      waitingForBucket: false,
    }));
  }

  /**
   * Assembles the flat tables: every machine's arcs then every line's arcs into the field
   * table, and every element of both into the aperture table, in beam order per machine.
   */
  private buildTables() {
    const refs: SectorRef[] = [];

    // every ring dipole, a kicker *and* a septum per extraction, and every line bend
    let sectors = 0;
    for (const m of this.machines) sectors += m.ring.arcs.length;
    for (const e of this.extractions) sectors += 2 + e.line.arcs.length;
    const field = new Float32Array(sectors * FIELD_STRIDE);

    let elements = 0;
    for (const m of this.machines) elements += m.ring.arcs.length + m.ring.straights.length;
    for (const e of this.extractions) elements += e.line.arcs.length + e.line.straights.length;
    const aperture = new Float32Array(elements * APERTURE_STRIDE);

    let sector = 0;
    let slot = 0;

    const writeSector = (
      cx: number,
      cy: number,
      radius: number,
      phiStart: number,
      dPhi: number,
      halfWidth: number,
      pipe: number,
      ref: SectorRef,
    ): number => {
      refs.push(ref);
      const o = sector * FIELD_STRIDE;
      field[o + 0] = cx;
      field[o + 1] = cy;
      field[o + 2] = radius;
      field[o + 3] = phiStart;
      field[o + 4] = dPhi;
      field[o + 5] = halfWidth;
      field[o + 6] = pipe;
      return sector++;
    };

    for (let m = 0; m < this.machines.length; m++) {
      const ring = this.machines[m].ring;
      const owner = {
        radius: ring.config.apertureRadius,
        sense: ring.config.sense,
        machine: m,
        sector: NO_SECTOR,
        owner: m,
      };
      for (let k = 0; k < ring.arcs.length; k++) {
        writeStraight(aperture, slot++, ring.straights[k], owner);
        const arc = ring.arcs[k];
        const s = writeSector(
          arc.cx,
          arc.cy,
          arc.radius,
          arc.phiStart,
          arc.dPhi,
          ring.config.fieldRegionHalfWidth,
          m,
          { machine: m, arc: arc.index, line: -1 },
        );
        writeArc(aperture, slot++, arc, { ...owner, sector: s });
      }
    }

    // The kicker and the septum, as two separate fields in the table.
    for (const e of this.extractions) {
      const cfg = e.line.config;
      const ring = this.machines[cfg.fromMachine].ring;
      const arc = ring.arcs[cfg.kickerSector];
      const k = buildKicker(ring, cfg.kickerCell, cfg.bore, cfg.kickSign, cfg.kickerLengthF);
      e.kickerArc = k.arc;

      // The kicker: short, and dark until it fires.
      e.kicker = writeSector(
        k.arc.cx,
        k.arc.cy,
        k.arc.radius,
        k.arc.phiStart,
        k.arc.dPhi,
        ring.config.apertureRadius,
        cfg.fromMachine,
        { machine: NO_MACHINE, arc: -1, line: -1 },
      );

      // The septum: always on, and out of the circulating beam's way. Its channel starts
      // where the kicked bunch has got to by the time it arrives — a fraction of the
      // sideways walk the kick bought — and runs outwards far enough to hold the beam
      // until it is clear of the ring dipole's own field region. The closed orbit is below
      // the bottom of that band, which is the blade: the circulating beam goes past it
      // every turn and feels nothing.
      //
      // Nothing is drawn for it (see `Renderer`): it is a field in the table and no more.
      const w = ring.config.fieldRegionHalfWidth;
      const inner = Math.min(k.displacement * SEPTUM_STANDOFF_F, w * 0.6);
      const runOut = Math.sqrt(2 * arc.radius * w);
      const span = Math.min(Math.abs(arc.dPhi), (runOut / arc.radius) * 1.3) * Math.sign(arc.dPhi);
      const from = cfg.bore > 0 ? arc.phiStart : arc.phiStart + arc.dPhi - span;
      e.septum = writeSector(
        arc.cx,
        arc.cy,
        arc.radius + (inner + w) / 2,
        from,
        span,
        (w - inner) / 2,
        cfg.fromMachine,
        { machine: NO_MACHINE, arc: -1, line: -1 },
      );
    }

    for (const [l, e] of this.extractions.entries()) {
      const cfg = e.line.config;
      const pipe = this.machines.length + l;
      const owner = {
        radius: cfg.apertureRadius,
        sense: 1,
        machine: NO_MACHINE,
        sector: NO_SECTOR,
        owner: pipe,
      };
      for (const s of e.line.straights) writeStraight(aperture, slot++, s, owner);
      for (const arc of e.line.arcs) {
        const s = writeSector(
          arc.cx,
          arc.cy,
          arc.radius,
          arc.phiStart,
          arc.dPhi,
          cfg.fieldRegionHalfWidth,
          pipe,
          { machine: NO_MACHINE, arc: e.line.arcs.indexOf(arc), line: l },
        );
        writeArc(aperture, slot++, arc, { ...owner, sector: s });
      }
    }

    return { field, refs, aperture, elementCount: slot };
  }

  attachBackend(backend: SimBackend): void {
    this.backend?.dispose();
    this.backend = backend;
    backend.init(this.beam);
    backend.setField(this.fieldTable, this.sectorRefs.length);
    backend.setAperture(this.apertureTable, this.elementCount);
    this.publishFieldScales();
  }

  // --- geometry the camera needs --------------------------------------------

  get bounds() {
    const boxes = [
      ...this.machines.map((m) => m.ring.bounds),
      ...this.extractions.map((e) => e.line.bounds),
      this.chain.bounds,
    ];
    return {
      minX: Math.min(...boxes.map((b) => b.minX)),
      minY: Math.min(...boxes.map((b) => b.minY)),
      maxX: Math.max(...boxes.map((b) => b.maxX)),
      maxY: Math.max(...boxes.map((b) => b.maxY)),
    };
  }

  // --- operator actions -----------------------------------------------------

  /**
   * Puts a batch in the injector, **at the energy the chain delivers** — 26 GeV, which is
   * what the PS extracts at and has nothing to do with where the injector's ramp happens
   * to be.
   *
   * That is the whole of the new rule. Injecting at the injector's *current* energy, which
   * is what this used to do, means a batch is captured whatever state the machine is in and
   * the ramp is decoration. Injecting at 26 GeV means the injector has to be sitting at
   * flat bottom to catch it — capture is a momentum match and nothing else — so filling and
   * ramping are in an order, and getting the order wrong is visible rather than forbidden.
   *
   * Always allowed; batches stack, which is what a real SPS does at flat bottom.
   */
  fillInjector(): void {
    const ring = this.injector.ring;
    this.beam.inject({
      ...ring.injection,
      gamma: gammaFromEnergy(ring.config.injectionEnergyGeV),
      protons: this.options.protonsPerBatch,
      ring: 1,
      divergence: this.options.divergence,
      momentumSpread: this.options.momentumSpread,
    });
    this.fills++;
    this.backend?.init(this.beam);
  }

  /**
   * Starts the chain's cycle, which delivers a batch when it finishes.
   *
   * It also asks the injector for flat bottom, and the countdown does not start until the
   * injector is there — which is what a supercycle is. The PS cannot hand 26 GeV protons
   * to a ring running its dipoles at 450, and a control that quietly threw the batch away
   * every time it was pressed out of order would be an annoyance rather than a lesson. The
   * lesson that *is* worth having is one click further on and much more interesting:
   * extract from the injector before it has ramped, and watch a 26 GeV batch arrive at a
   * collider set for 450.
   */
  requestFill(): void {
    if (this.fillRemaining > 0) return;
    this.fillRemaining = INJECTOR_CYCLE;
    this.injector.setTargetEnergy(this.injector.ring.config.injectionEnergyGeV);
  }

  /** Is the injector sitting low enough to take what the chain delivers? */
  get injectorReadyForChain(): boolean {
    const want = momentumFromEnergy(this.injector.ring.config.injectionEnergyGeV);
    return Math.abs(this.injector.momentumGeVc / want - 1) < CAPTURE_WINDOW;
  }

  /**
   * Arms a kicker. Never refused: the interesting failures — extracting an empty ring,
   * firing into a machine that has ramped — are things to watch, not things to prevent.
   */
  armKicker(index: number, timing: KickerTiming = 'bucket'): void {
    const e = this.extractions[index];
    if (!e || e.state !== 'idle') return;
    e.state = 'armed';
    e.timing = timing;
    e.armedAt = this.elapsed;
    e.waitingForBucket = false;
  }

  /**
   * Holds the cogging control: −1, +1, or 0 to let go. Cancels the automatic loop, because
   * two things driving one trim is one thing too many.
   */
  setCogging(direction: number): void {
    this.cogging = Math.sign(direction);
    if (this.cogging !== 0) this.coggingAuto = false;
  }

  /** Starts the automatic loop, which walks the crossing point onto an IP and stops. */
  autoCog(): void {
    this.coggingAuto = !this.coggingAuto;
    if (!this.coggingAuto) this.cogging = 0;
  }

  /**
   * Where the two beams are currently meeting: the signed distance from `IP3` to the
   * crossing point of the closest pair [m], or null if one of the beams is empty.
   *
   * This is the number cogging exists to zero, and drawing it is the only feedback the
   * operator gets — which is why the renderer marks the interaction region on the ring
   * rather than leaving it as a HUD line.
   */
  crossingNearestIP(): { offset: number; s: number } | null {
    if (this.forward.length === 0 || this.reverse.length === 0) return null;
    const ip = this.detectors[0]?.s ?? 0;
    let best: { offset: number; s: number } | null = null;
    for (const f of this.forward) {
      for (const r of this.reverse) {
        const offset = this.crossingOffset(f.s, r.s, ip);
        if (!best || Math.abs(offset) < Math.abs(best.offset)) {
          best = { offset, s: ip + offset };
        }
      }
    }
    return best;
  }

  /**
   * What is left of a batch, as a fraction of the one the chain delivered.
   *
   * **This is the one thing collisions do to the beam.** Every inelastic interaction takes
   * one proton out of each side, and nothing puts them back — so a fill runs down, and it
   * runs down *only* in population. The protons that are left are exactly as energetic as
   * they were: the RF holds the energy and burn-off does not touch `gamma`. A beam that has
   * given half of itself to the experiments is half as bright, half as luminous, still
   * 6.8 TeV, and drawn thinner rather than redder or slower. See `updateBeamLayer`.
   */
  intensityOf(i: number): number {
    return Math.max(0, Math.min(1, this.beam.charge[i] / this.options.protonsPerBatch));
  }

  /** Mean of the above over everything circulating in a machine, or 0 if it is empty. */
  beamIntensity(machine: number): number {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < this.beam.count; i++) {
      if (!this.beam.alive[i] || this.beam.ring[i] !== machine) continue;
      sum += this.intensityOf(i);
      n++;
    }
    return n > 0 ? sum / n : 0;
  }

  /** Index of a line by its id, for the UI. */
  lineIndex(id: string): number {
    return this.extractions.findIndex((e) => e.line.config.id === id);
  }

  // --- the loop -------------------------------------------------------------

  /**
   * Apparent collider revolutions per wall second for a beam of that energy — 0.2 at the
   * injector's flat bottom, 0.5 at the collider's injection energy, 2 at top.
   *
   * Interpolated on **rapidity**, y = artanh β ≈ ln 2γ, and that is the whole point. The
   * thing a ramp actually increases is not the speed — β goes from 0.9999978 to
   * 0.99999999, two parts per million, and no honest display can show that — it is the
   * energy, and rapidity is the quantity that stands in for velocity once velocity has
   * run out of room: it keeps adding up the way a speed ought to, all the way to
   * infinity, while β sits pinned against 1. So what is drawn is the additive velocity, and
   * a beam twice as far up the ramp in rapidity really is drawn going twice as fast.
   *
   * **It is a function of the energy, not of the clock.** Every particle is asked
   * separately (`stepRateFor`), so a 450 GeV bunch is drawn at 450 GeV's speed wherever it
   * is and whatever anything else is doing. An earlier version scaled one global clock by
   * the *collider's* energy, which meant the injector — a machine that never ramps — visibly
   * accelerated four-fold every time the collider did, and a bunch that had obviously
   * "sped up" then died on the first dipole of the ramped ring it was injected into. The
   * beam was right and the picture was lying.
   */
  turnsPerSecondAt(energyGeV: number): number {
    const cfg = this.collider.ring.config;
    const rapidity = (e: number): number =>
      Math.log(2 * gammaFromEnergy(Math.max(e, PROTON_REST_ENERGY_GEV)));
    const {
      turnsPerSecondAtFlatBottom: c,
      turnsPerSecondAtInjection: a,
      turnsPerSecondAtTop: b,
    } = this.options;

    // Three anchors, because the injector now ramps and there are three energies in this
    // complex that mean something. Two anchors with the low one at the collider's injection
    // energy is what this was, and it clamped — so a 26 GeV batch coasting round the SPS
    // and a 450 GeV one ready to leave it were drawn going at exactly the same speed, on
    // the one machine whose new job is to tell them apart. Extending the *upper* segment
    // downwards instead does not work either: rapidity(26) is far enough below
    // rapidity(450) that the line goes negative long before it gets there.
    const bottom = rapidity(this.injector.ring.config.injectionEnergyGeV);
    const mid = rapidity(cfg.injectionEnergyGeV);
    const top = rapidity(cfg.topEnergyGeV);
    const y = rapidity(energyGeV);
    const lerp = (t: number, lo: number, hi: number): number =>
      lo + (hi - lo) * Math.max(0, Math.min(1, t));

    if (y <= mid) {
      return bottom < mid ? lerp((y - bottom) / (mid - bottom), c, a) : a;
    }
    return top > mid ? lerp((y - mid) / (top - mid), a, b) : a;
  }

  /**
   * The same thing as the fraction of the world's stepping rate a particle gets, 0..1.
   *
   * The world iterates at the rate the *fastest* beam needs — top energy — and everything
   * slower sits out iterations in proportion. That keeps one step one fixed length in metres
   * for every particle, so a coasting injector bunch is integrated exactly as accurately as
   * a bunch at flat top instead of being given a longer step to look slow with.
   */
  stepRateFor(gamma: number): number {
    const energyGeV = gamma * PROTON_REST_ENERGY_GEV;
    return this.turnsPerSecondAt(energyGeV) / this.options.turnsPerSecondAtTop;
  }

  /** Apparent revolutions per wall second of the beam the collider's RF is holding. */
  get turnsPerSecond(): number {
    return this.turnsPerSecondAt(this.collider.energyGeV);
  }

  /** Wall-clock seconds per collider turn. */
  get secondsPerTurn(): number {
    return 1 / this.turnsPerSecond;
  }


  advance(dtWall: number): AdvanceResult {
    const dtMachine = dtWall * this.options.opsTimeScale;
    this.machineClock += dtMachine;
    this.elapsed += dtWall;
    for (const m of this.machines) m.advanceOperations(dtMachine);
    for (const e of this.extractions) e.circuit?.update(dtMachine);

    const spawned: number[] = [];
    // The chain holds until the injector is back at flat bottom: 26 GeV protons cannot be
    // handed to a ring whose dipoles are set for 450. See `requestFill`.
    if (this.fillRemaining > 0 && this.injectorReadyForChain) {
      this.fillRemaining = Math.max(0, this.fillRemaining - dtMachine);
      if (this.fillRemaining === 0) {
        this.fillInjector();
        spawned.push(this.beam.id[this.beam.count - 1]);
      }
    }

    this.updateKickers();
    this.publishFieldScales();
    // Capture *before* stepping. The field has just moved with the ramp; a particle whose
    // RF has not yet followed it would spend the whole frame being bent by a field a per
    // cent too strong for its momentum, every frame, all the way up the ramp — which is
    // enough to lose the beam long before flat top.
    this.updateCapture();

    const steps = this.stepBeam(dtWall);
    this.collectLosses();
    // After the step, so a crossing is judged on where the beams actually are.
    this.updateCollisions(dtWall, dtMachine);

    return { steps, spawned };
  }

  // --- collisions -----------------------------------------------------------

  /**
   * Fills `forward` and `reverse` with the collider's bunches and where they are round it.
   *
   * Which way a bunch is going is the same question it always is here — its velocity against
   * the design direction of the orbit under it — so there is still no "which beam" stored
   * anywhere.
   */
  private gatherBunches(): void {
    const { x, y, vx, vy, alive, ring, charge, count } = this.beam;
    this.forward.length = 0;
    this.reverse.length = 0;
    const orbit = this.collider.ring;
    const aperture = orbit.config.apertureRadius;
    for (let i = 0; i < count; i++) {
      // Asked of **where the particle is**, not of which ring's RF is holding it.
      //
      // Capture is the wrong question here and asking it made the luminosity flicker: a
      // circulating bunch passing the mouth of a transfer line is claimed by that line's
      // pipe for a frame or two, `updateCapture` drops it to free flight, and it vanishes
      // out of the snapshot — measured, a nominal fill read three quarters of its luminosity
      // because two or three of its twenty-four batches happened to be passing a junction.
      // Whether two beams collide is a question about geometry, and this is the geometry.
      if (!alive[i] || ring[i] > 0) continue;
      const at = arclengthOnRing(orbit, x[i], y[i]);
      const px = poseAtArclength(orbit, at.s);
      if (Math.hypot(x[i] - px.x, y[i] - px.y) > aperture) continue;
      const bunch: BunchOnOrbit = { index: i, s: at.s, protons: charge[i] };
      if (vx[i] * at.tx + vy[i] * at.ty >= 0) this.forward.push(bunch);
      else this.reverse.push(bunch);
    }
  }

  /**
   * Luminosity, burn-off and the event displays, once a frame.
   *
   * A macro-particle here is an SPS batch: 234 bunches at 25 ns, which is **1754 m of
   * beam**, a fifteenth of the ring. So two batches do not meet at a point. Every bunch of
   * one meets every bunch of the other somewhere, those meeting points are spread over a
   * batch length, and a bunch pair is meeting at *this* interaction point exactly while both
   * batches are covering it. Everything else falls out of that:
   *
   *  · the bunch pairs that meet here, per turn, are `(L − 2|δ|)/25 ns` where δ is how far
   *    from the IP the two batch centres cross — triangular, going to zero at half a batch
   *    length, 877 m. That 877 m is the target cogging has to put the crossing inside, and
   *    12 batches each way head-on gives 12 × 234 = 2808 of them, the nominal number;
   *  · while two batches overlap, a bunch pair meets every 25 ns, so the luminosity in the
   *    burst is the 40 MHz one. A given pair covers a given IP for 6.6 % of a turn, once per
   *    turn — the other crossing that turn is at the antipodal point, which is the other
   *    detector — and the average over a turn comes out at 1.2e34 cm⁻² s⁻¹ for a nominal
   *    fill. That is the real machine's number and it is nowhere written down here.
   *
   * **The luminosity is the turn average and is computed, not sampled.** Asking "are two
   * batches on top of the IP right now" once a frame is the obvious implementation and it is
   * wrong: the burst is 6.6 % of a turn, which at 60 fps is two frames, and whether the
   * frames land on it depends on the frame rate. Measured — a nominal fill read 9.1e33
   * instead of 1.2e34, and it would have read something else again on a slower machine. The
   * closed form is exact, free, and is what a real machine quotes anyway. The *geometric*
   * test survives for one job only, below: deciding when to draw an event, which is a thing
   * that should happen in bursts because it does.
   *
   * Burn-off runs on the **machine** clock, because it is an operations-scale process: two
   * days of real luminosity lifetime, so a quarter of an hour of play.
   */
  private updateCollisions(dtWall: number, dtMachine: number): void {
    this.gatherBunches();
    const C = this.collider.ring.config.circumference;
    const half = BATCH_LENGTH / 2;
    const cmEnergy = 2 * this.collider.energyGeV;
    const smoothing = 1 - Math.exp(-dtWall / 1.5);

    // Where the beams are lying on top of each other this frame. Detector-independent — it is
    // a fact about two batches — so it is computed once and the insertions ask about it.
    this.overlaps.length = 0;
    for (const f of this.forward) {
      for (const r of this.reverse) {
        const gap = wrapSigned(r.s - f.s, C);
        const halfOverlap = (BATCH_LENGTH - Math.abs(gap)) / 2;
        if (halfOverlap <= 0) continue;
        if (this.overlaps.length >= MAX_OVERLAPS) break;
        this.overlaps.push({ s: f.s + gap / 2, half: halfOverlap });
      }
    }

    for (let d = 0; d < this.detectors.length; d++) {
      const det = this.detectors[d];
      det.luminosity = 0;
      det.collidingPairs = 0;
      det.bunchPairs = 0;
      det.crossingLuminosity = 0;
      // Where in *this* insertion a collision of this pass can be drawn, in metres from the
      // IP. Null while no bunches are meeting inside it, which is also the test for whether
      // it is collecting anything at all.
      let vertexWindow: { lo: number; hi: number; peak: number } | null = null;

      for (const f of this.forward) {
        for (const r of this.reverse) {
          const offset = this.crossingOffset(f.s, r.s, det.s);
          const delta = Math.abs(offset);
          const overlap = BATCH_LENGTH - 2 * delta;
          if (overlap <= 0) continue;

          const bunch = pairLuminosity(
            this.beam.charge[f.index] / BUNCHES_PER_BATCH,
            this.beam.charge[r.index] / BUNCHES_PER_BATCH,
          );
          // The burst lasts `overlap` metres of the ring out of C, once per turn.
          const lumi = (bunch * overlap) / C;
          det.luminosity += lumi;
          det.collidingPairs++;
          det.bunchPairs += overlap / BUNCH_SPACING;
          if (bunch > det.crossingLuminosity) det.crossingLuminosity = bunch;

          // One inelastic interaction takes one proton out of each beam. This is the only
          // thing in the model that consumes beam on purpose, and it is why a fill has a
          // lifetime rather than lasting until somebody dumps it.
          const burn = lumi * SIGMA_INELASTIC * dtMachine;
          this.beam.charge[f.index] = Math.max(0, this.beam.charge[f.index] - burn);
          this.beam.charge[r.index] = Math.max(0, this.beam.charge[r.index] - burn);
          det.burned += 2 * burn;

          // Is this pair meeting *inside* this insertion right now? Each batch occupies a
          // batch length of orbit, so they interpenetrate over the intersection of those two
          // intervals, and an experiment is collecting exactly while that intersection
          // reaches into it. That is what a pass is, and what an event display is issued
          // against below.
          const a = wrapSigned(f.s - det.s, C);
          const b = wrapSigned(r.s - det.s, C);
          if (Math.min(a, b) + half <= -det.halfLength) continue;
          if (Math.max(a, b) - half >= det.halfLength) continue;

          // And *where* in it, taken over the whole pass rather than over this frame.
          //
          // The instantaneous overlap is the wrong thing to draw a vertex from: it is a
          // sliver at the moment the region first reaches into the detector, so every flash
          // would land at the same end of the box, and which sliver it was would depend on
          // the frame the edge happened to be noticed on. Over a pass, every bunch of one
          // batch meets every bunch of the other, and those meeting points are triangular
          // about the crossing with a half-batch of reach — a fact about the pair, not about
          // the frame rate. Clipped to the insertion, that is the distribution the vertex of
          // a collision drawn here is one sample of.
          const lo = Math.max(offset - half, -det.halfLength);
          const hi = Math.min(offset + half, det.halfLength);
          if (hi > lo && (!vertexWindow || hi - lo > vertexWindow.hi - vertexWindow.lo)) {
            vertexWindow = { lo, hi, peak: offset };
          }
        }
      }

      // What the collisions are doing to the machine around them, and what the cryogenics
      // can take back out. On the machine clock, like every thermal process here.
      det.advanceThermal(cmEnergy, dtMachine);

      det.events += det.luminosity * SIGMA_INELASTIC * dtMachine;
      det.higgs += det.luminosity * SIGMA_HIGGS * dtMachine;
      det.integrated += det.luminosity * dtMachine;
      det.smoothed += (det.luminosity - det.smoothed) * smoothing;

      // How often an event is drawn, and why it is a rate rather than a brightness.
      //
      // A collision is a collision: badly phased, an experiment does not see *weaker* events,
      // it sees *fewer* of them. So a pass earns `headOn` of an event display and one is
      // drawn when the credit passes 1 — dead on the interaction point that is every pass,
      // and out at the edge of the overlap it is one pass in ten. Which is the answer to why
      // a flash appears in the detector while the crossing point is drawn beside it: the
      // batches are 1754 m long and both of them really are lying across the detector at that
      // moment. What changes with the phasing is how many of their bunches meet *there*, and
      // that is what this counts.
      //
      // A credit rather than a die roll, so the rate is exact and does not depend on the
      // frame rate or on anything random.
      const colliding = vertexWindow !== null;
      if (colliding && !this.wasColliding[d]) this.eventCredit[d] += det.headOn;
      if (colliding && vertexWindow && !this.wasColliding[d] && this.eventCredit[d] >= 1) {
        this.eventCredit[d] -= 1;
        // **Where the vertex goes.** Not the middle of the detector: the middle of the
        // detector is where the beams are only when the machine is perfectly phased, and a
        // flash drawn there while the interaction region is visibly lying across one end of
        // the experiment says the picture is decoration rather than a state. So it is a
        // sample of where this pair's bunches met, and a badly cogged fill puts its events
        // where the beams are — off to one side, and out of the detector altogether once the
        // crossing is far enough away.
        //
        // On the real machine that scatter is a few centimetres and the insertion is a point.
        // It is visible here because the insertion is drawn twenty times its true size, which
        // is the same magnification that lets the interaction region cross part of it.
        const seed = this.eventSeed++ * 2654435761;
        const u = sampleMeeting(vertexWindow.lo, vertexWindow.hi, vertexWindow.peak, half, seed);
        const p = poseAtArclength(this.collider.ring, det.s + u);
        const shower = buildCollision(cmEnergy, seed);
        this.collisions.push({
          detector: d,
          x: p.x,
          y: p.y,
          dx: p.dx,
          dy: p.dy,
          offset: u,
          event: shower,
          cmEnergyGeV: cmEnergy,
          pileUp: det.pileUp,
          at: now(),
        });

        // **The trigger.** Every candidate is offered; the experiment records the ones with
        // something hard in them and throws the rest away, which is what a trigger is and
        // what stops the display being a strobe. The transverse view is built only for what
        // is kept — it is the expensive half and there is no point building it for an event
        // nobody will look at, which is exactly the argument a real readout makes.
        if (det.kept === null || shower.hardestPt >= det.threshold) {
          det.offer({
            event: shower,
            transverse: buildTransverse(cmEnergy, seed),
            cmEnergyGeV: cmEnergy,
            pileUp: det.pileUp,
            score: shower.hardestPt,
            seen: det.events,
            at: this.elapsed,
          });
        } else {
          det.candidates++;
        }
      }
      det.relaxTrigger(dtWall);
      this.wasColliding[d] = colliding;
    }

    const cutoff = now() - EVENT_LIFETIME * 1000;
    while (this.collisions.length > 0 && this.collisions[0].at < cutoff) this.collisions.shift();
    if (this.collisions.length > 8) this.collisions.splice(0, this.collisions.length - 8);

    this.updateCogging(C, dtWall);
  }

  /**
   * Where a forward and a reverse bunch cross, as a signed distance from an interaction
   * point [m].
   *
   * They meet where their arclengths agree, at `(s₁+s₂)/2` — a quantity defined modulo C/2,
   * because adding a whole ring to one of them moves the meeting point by half of one. Which
   * is the same statement as "there are two crossings per turn, antipodal", and the reason
   * a second insertion half a ring away needs no phasing of its own.
   */
  private crossingOffset(s1: number, s2: number, ip: number): number {
    const C = this.collider.ring.config.circumference;
    return wrapSigned((s1 + s2) / 2 - ip, C / 2);
  }

  /**
   * The automatic cogging loop: walks the crossing point onto an interaction point and
   * stops.
   *
   * It steers the pair that is already closest, which is the right target when injection has
   * been synchronised — every pair then shares one offset and moving one moves all of them.
   * With unsynchronised batches in the ring the pairs sit at different offsets and no single
   * trim can serve them all; the loop then simply lands the nearest one, and the readout
   * shows how many pairs are actually colliding.
   */
  private updateCogging(C: number, dtWall: number): void {
    if (!this.coggingAuto) return;
    // A bunch passing the mouth of a transfer line can be claimed by it for a frame, which
    // drops it out of the snapshot. Standing still for that frame is right; switching the
    // loop off is not — it used to, and auto-cogging gave up a second or two in for no
    // reason the operator could see.
    if (this.forward.length === 0 || this.reverse.length === 0) {
      this.cogging = 0;
      return;
    }
    const ip = this.detectors[0]?.s ?? 0;
    let best = Infinity;
    for (const f of this.forward) {
      for (const r of this.reverse) {
        const off = this.crossingOffset(f.s, r.s, ip);
        if (Math.abs(off) < Math.abs(best)) best = off;
      }
    }
    // It cannot aim finer than one frame of its own motion, and that motion is four times
    // larger at flat top than at injection because the beam is drawn going four times
    // faster. A fixed threshold is therefore a threshold that works at one energy: derive it
    // from what a frame actually moves.
    const perFrame = (C * COG_TRIM * this.turnsPerSecond * dtWall) / 2;
    const grain = Math.max(2, perFrame * 1.5);
    if (!Number.isFinite(best) || Math.abs(best) < grain) {
      this.cogging = 0;
      this.coggingAuto = false;
      return;
    }
    // Speeding beam 2 up walks the crossing point backwards along the orbit, so the trim
    // takes the sign of the offset it is trying to remove.
    this.cogging = best > 0 ? 1 : -1;
  }

  private stepBeam(dtWall: number): number {
    if (!this.backend || this.beam.count === 0) return 0;

    // One step is a fixed length in metres — the collider's circumference over
    // `stepsPerTurn` — so every machine is integrated at the same spatial resolution and the
    // injector, a quarter of the size, takes a quarter of the steps to go round. It really
    // is 3.86× faster and nothing has to be done to make it so.
    //
    // The world offers iterations at the rate a beam at *top* energy needs; each particle
    // takes the fraction of them its own energy earns (`stepRateFor`, written into
    // `beam.rate` by `updateCapture`). So the number of iterations here does not depend on
    // what any machine is doing — only on the wall clock.
    const period = this.collider.revolutionPeriod;
    const dtStep = period / this.options.stepsPerTurn;

    this.stepCarry += dtWall * this.options.stepsPerTurn * this.options.turnsPerSecondAtTop;
    let steps = Math.floor(this.stepCarry);
    if (steps <= 0) return 0;
    this.stepCarry -= steps;
    steps = Math.min(steps, this.options.maxStepsPerFrame);

    this.backend.step(dtStep, steps);
    // The beam clock is the clock of the beam the collider is holding — the one the HUD's
    // turn counter is about. A bunch elsewhere runs against it at the ratio of their rates,
    // which is what `updateKickers` has to correct a pulse length by.
    this.beamClock += steps * dtStep * this.stepRateFor(this.collider.gamma);
    this.turns = this.beamClock / period;
    return steps;
  }

  /**
   * Excitation of every sector, in tesla, for both apertures.
   *
   * A twin-bore machine gets ±B, which is what carries two beams the opposite way round
   * one ring. A single-bore one gets the same field in both, so a particle going the
   * wrong way through it is bent the wrong way — correctly, since there is no second pipe
   * for it to be in. A firing kicker zeroes one aperture of one sector, and only one:
   * dumping beam 1 must not take beam 2 with it.
   */
  private publishFieldScales(): void {
    const n = this.sectorRefs.length;
    for (let k = 0; k < n; k++) {
      const ref = this.sectorRefs[k];
      let tesla: number;
      let twin = false;
      if (ref.machine >= 0) {
        const machine = this.machines[ref.machine];
        tesla = machine.sectorField(ref.arc);
        twin = machine.ring.config.twinBore;
      } else if (ref.line < 0) {
        // a septum: dark unless its kicker is firing, and that is decided below
        this.scales[k] = 0;
        this.scales[n + k] = 0;
        continue;
      } else {
        const e = this.extractions[ref.line];
        const arc = e.line.arcs[ref.arc];
        const load = e.circuit ? e.circuit.load : 1;
        tesla =
          arc.fieldSign *
          (e.line.config.designMomentumGeVc / (0.299_792_458 * arc.radius)) *
          load;
      }
      this.scales[k] = tesla;
      this.scales[n + k] = twin ? -tesla : tesla;
    }

    for (const e of this.extractions) {
      if (e.septum < 0 || !e.kickerArc) continue;
      const cfg = e.line.config;
      const machine = this.machines[cfg.fromMachine];
      const twin = machine.ring.config.twinBore;

      /**
       * Writes a field **as the bunch being extracted sees it**, and nothing into the other
       * aperture — dumping beam 1 must not take beam 2 with it.
       *
       * The frame is the whole trap here. A ring dipole's excitation is quoted for the
       * forward aperture and the reverse one is its negative, so anything written in the
       * *ring's* convention has to be flipped for a reverse beam. But a kicker's arc is
       * built by `buildKicker` for the bunch's own `bore` — its `fieldSign` is already the
       * sign that bends *that* bunch outward — so flipping it as well pointed the beam 2
       * dump kicker inward and threw the batch into the inside wall of the ring instead of
       * down the dump line. One convention, applied once, is the fix: everything below is
       * expressed as the extracted bunch feels it.
       */
      const put = (sector: number, seen: number): void => {
        const own = cfg.bore > 0 ? sector : n + sector;
        const other = cfg.bore > 0 ? n + sector : sector;
        this.scales[own] = seen;
        // A single-bore machine has one pipe, so there is no "other aperture" to keep clear.
        this.scales[other] = twin ? 0 : seen;
      };

      // The septum is a DC magnet: on, always, whether anything is being extracted or not.
      // It opposes the ring dipole exactly, so a bunch in its channel is not bent — and the
      // circulating beam never reaches its channel. What it has to cancel is read out of the
      // table the pusher itself will read, in the aperture this bunch is in, so the twin-bore
      // sign is taken from the ring rather than restated here.
      const ringSector = this.sectorIndex(cfg.fromMachine, cfg.kickerSector);
      const ringSeen = this.scales[cfg.bore > 0 ? ringSector : n + ringSector];
      put(e.septum, -ringSeen);

      // The kicker is dark until it fires, and its field tracks the beam momentum so the
      // angle it gives is the same at injection and at flat top — which is what a real one
      // does by charging to a voltage matched to the energy.
      const arc = e.kickerArc;
      const kick =
        e.state === 'firing'
          ? (arc.fieldSign * machine.momentumGeVc) / (0.299_792_458 * arc.radius)
          : 0;
      put(e.kicker, kick);
    }

    this.backend?.setFieldScales(this.scales);
  }

  /**
   * Fires an armed kicker once a bunch of the right beam is in the straight section ahead
   * of its sector, and holds it for a full revolution so the whole beam leaves. A kicker
   * that goes off while a bunch is inside the sector cuts its bend short and throws it at
   * the wall, which is why the real ones are synchronised to the revolution frequency.
   */
  private updateKickers(): void {
    // The bucket test asks where the circulating beams are *now*, so the snapshot has to be
    // this frame's and not the one `updateCollisions` left behind after the last step —
    // a batch moves several hundred metres between frames, which is more than the phase
    // window the test is trying to hit.
    this.gatherBunches();

    for (const e of this.extractions) {
      if (e.state === 'firing') {
        if (this.beamClock >= e.until) {
          e.state = 'idle';
        }
        continue;
      }
      if (e.state !== 'armed') continue;

      // Asked every frame, not only during the few frames a bunch spends on the arc the
      // kicker watches, so the readout can say what the pulse is waiting for.
      let holdForBucket = false;
      if (e.timing === 'bucket') {
        const sync = this.bucketState(e);
        const elapsed = this.elapsed - e.armedAt;
        const window =
          SYNC_WINDOW + (SYNC_WINDOW_MAX - SYNC_WINDOW) * Math.min(1, elapsed / SYNC_RELAX);
        // Two reasons to hold, and only one of them ever relaxes. Landing off the bucket
        // costs luminosity and cogging can take it back; landing on top of a batch already
        // circulating cannot be undone by anything.
        if (sync && (sync.clash || Math.abs(sync.offset) > window)) {
          e.waitingForBucket = true;
          holdForBucket = elapsed < SYNC_TIMEOUT;
        } else {
          e.waitingForBucket = false;
        }
      }

      const cfg = e.line.config;
      const machine = this.machines[cfg.fromMachine];
      // Which straight the bunch is on just before it reaches the kicker's sector — and
      // that depends on which way it is going. Beam 1 runs straight k then arc k; beam 2
      // runs the ring backwards, so it meets arc k coming off straight k+1. Watching the
      // forward straight for a reverse beam waits for a bunch that has already gone past,
      // which is why the beam 2 dump fired every time and never caught anything.
      // The kicker sits at the near end of its straight, so by the time a bunch is on
      // that straight it has already gone past. Watch the arc it comes in from: beam 1
      // arrives off arc cell−1, beam 2 — running the ring backwards — off arc cell.
      const cells = this.machines[cfg.fromMachine].ring.arcs.length;
      const watch = cfg.bore > 0 ? (cfg.kickerCell - 1 + cells) % cells : cfg.kickerCell;
      const bunch = this.bunchInElement(this.elementSlot(cfg.fromMachine, watch, true), cfg.bore);
      if (bunch >= 0) {
        // A batch that arrives at an arbitrary moment lands at an arbitrary phase, meets the
        // other beam somewhere out in the arcs, and is never seen by an experiment. So a
        // synchronised pulse holds until it is lined up on a bucket that puts it head-on
        // with something already circulating. It gives up after `SYNC_TIMEOUT` rather than
        // sulking forever — the beam it is aiming at can be dumped out from under it.
        if (holdForBucket) continue;

        // One pulse, one bunch.
        //
        // A kicker is not a magnet you switch. It is a few microseconds of field that has
        // to rise, hold and fall between one bunch and the next, and it fires once — the
        // batch behind this one goes on circulating. So the pulse lasts exactly as long as
        // it takes the bunch to cross the sector it is being thrown out of, and then the
        // device is spent until it is armed again.
        //
        // Anything else that happens to be inside that stretch during those microseconds
        // leaves with it. That is not a simplification: it is why a real machine keeps an
        // abort gap, a stretch of ring deliberately left empty for the kicker to rise in.
        //
        // The window has to cover the whole way from where the bunch was *seen* to the far
        // end of the kicker: it is detected somewhere in the arc upstream, so worst case it
        // is at the very start of that arc and still has the arc and the kicker to cross.
        // Sized to the arc alone — which was right when the kicker was 68 m — the field
        // collapsed with the bunch halfway through it, and half a kick aims at nothing: the
        // batch left the ring on a ray no transfer line was built along and went into the
        // wall. Both dumps and TI 8 did exactly that.
        const reach =
          machine.ring.arcs[cfg.kickerSector].length + (e.kickerArc?.length ?? 0);
        const transit = reach / (betaFromGamma(machine.gamma) * C_LIGHT);
        // `beamClock` is the collider beam's clock and this bunch may not be the collider's:
        // each is stepped at the rate its own energy earns, so a transit of the bunch's own
        // beam time is that ratio of beam-clock seconds. Get this wrong and an injector
        // kicker holds four times too long while the collider is at flat top, which empties
        // the sector behind the bunch as well.
        const ratio =
          this.stepRateFor(this.collider.gamma) / Math.max(this.stepRateFor(machine.gamma), 1e-6);
        e.state = 'firing';
        e.firedAt = now();
        e.until = this.beamClock + transit * 1.05 * ratio;
        e.sent += 1;
      }
    }
  }

  /**
   * Field-table index of a machine's arc `cell`.
   *
   * Every machine's arcs are written first and in order, so this is just the running total —
   * but it is the same fact as the write loop in `buildTables` stated twice, and if one moves
   * the other has to.
   */
  private sectorIndex(machine: number, cell: number): number {
    let base = 0;
    for (let m = 0; m < machine; m++) base += this.machines[m].ring.arcs.length;
    return base + cell;
  }

  /** Aperture-table slot of a machine's straight or arc `cell`. */
  private elementSlot(machine: number, cell: number, arc: boolean): number {
    let base = 0;
    for (let m = 0; m < machine; m++) {
      base += this.machines[m].ring.arcs.length * 2;
    }
    return base + cell * 2 + (arc ? 1 : 0);
  }

  /** The live bunch on that element travelling the way `bore` says, or −1. */
  private bunchInElement(element: number, bore: number): number {
    const { x, y, vx, vy, alive, count } = this.beam;
    for (let i = 0; i < count; i++) {
      if (!alive[i]) continue;
      projectToOrbit(this.apertureTable, this.elementCount, x[i], y[i], this.frame);
      if (this.frame.element !== element) continue;
      const along = vx[i] * this.frame.tx + vy[i] * this.frame.ty;
      if (bore > 0 ? along >= 0 : along < 0) return i;
    }
    return -1;
  }

  /**
   * How far from head-on the next batch down this line would arrive if the kicker let go
   * now — or null if there is nothing in the other beam to be in phase with, in which case
   * any moment will do.
   *
   * The thing that makes this answerable at all is that it **cannot change on its own**.
   * Every particle in this world covers the same path length per unit time, so as the bunch
   * closes on the kicker its remaining flight shortens by exactly as much as the circulating
   * beam it is aiming at moves, and the crossing point — the mean of the two arclengths —
   * does not move. Waiting does nothing; waiting a whole *injector turn* moves it by one
   * injector circumference, and that is what makes the reachable phases a grid rather than a
   * continuum. See `SYNC_WINDOW` for how wide that grid is and what it costs.
   */
  private bucketState(e: Extraction): { offset: number; dir: number; clash: boolean } | null {
    const cfg = e.line.config;
    if (cfg.toMachine !== 0) return null;

    const injector = this.machines[cfg.fromMachine].ring;
    const collider = this.collider.ring;
    const Cinj = injector.config.circumference;

    // Which beam this batch becomes.
    //
    // `config.bore` is the aperture the line uses **in the machine it leaves**, and both
    // transfer lines leave the injector forwards — TI 8 is beam 2 because of where it
    // *arrives*, entering its collider straight backwards, not because of how it left. So
    // the question has to be asked of the arrival: the line's exit direction against the
    // collider's design direction there. Reading `bore` instead had TI 8 looking for a
    // partner among the batches going its own way, finding none, and firing unsynchronised
    // every time.
    const arrive = arclengthOnRing(collider, e.line.exit.x, e.line.exit.y);
    const dir = e.line.exit.dx * arrive.tx + e.line.exit.dy * arrive.ty >= 0 ? 1 : -1;
    const partners = dir > 0 ? this.reverse : this.forward;

    // Beam path still to run, for whichever batch in the injector reaches the kicker first:
    // the rest of the way round the injector to the kicker's downstream end, then the whole
    // transfer line.
    const sExit = arclengthOnRing(injector, e.line.entry.x, e.line.entry.y).s;
    let remaining = Infinity;
    for (let i = 0; i < this.beam.count; i++) {
      if (!this.beam.alive[i] || this.beam.ring[i] !== cfg.fromMachine) continue;
      const sBunch = arclengthOnRing(injector, this.beam.x[i], this.beam.y[i]).s;
      let gap = cfg.bore > 0 ? sExit - sBunch : sBunch - sExit;
      gap -= Cinj * Math.floor(gap / Cinj);
      if (gap < remaining) remaining = gap;
    }
    if (!Number.isFinite(remaining)) return null;
    remaining += e.line.length;

    // Where on the collider's closed orbit this batch effectively already is, counted back
    // along the flight it has not made yet.
    const sVirtual = arrive.s - dir * remaining;

    const ip = this.detectors[0]?.s ?? 0;
    const mine = dir > 0 ? this.forward : this.reverse;
    const half = BATCH_LENGTH / 2;
    const C = collider.config.circumference;

    /**
     * Would this batch land on top of one already going the same way?
     *
     * A batch is 1754 m long, so two of them less than that apart are the same stretch of
     * beam, and this is the check that stops a fill from being poured into one bucket. It
     * was not there at first, and the consequence was not subtle: every batch after the
     * first was phased against the *same* partner, so all of them arrived at the same place
     * in the ring, and one dump pulse took the lot. A filling scheme is exactly the rule
     * that a real machine applies here.
     *
     * Like the crossing offset, the separation is conserved — same beam, same direction,
     * same rate — so it is a property of the pass and not of the moment.
     */
    const clash = mine.some((q) => Math.abs(wrapSigned(sVirtual - q.s, C)) < BATCH_LENGTH);

    // Aim at a batch that has nothing to collide with yet, so a fill pairs up one for one
    // rather than piling every new batch onto the first one that arrived. With none free
    // there is nothing to be in phase *with*, and the only rule left is not to land on top
    // of one of our own.
    let chosen: BunchOnOrbit | null = null;
    for (const p of partners) {
      const taken = mine.some((q) => Math.abs(this.crossingOffset(q.s, p.s, ip)) < half);
      if (!taken) {
        chosen = p;
        break;
      }
    }
    return {
      offset: chosen ? this.crossingOffset(sVirtual, chosen.s, ip) : 0,
      dir,
      clash,
    };
  }

  /**
   * Works out which ring, if any, is holding each particle's energy.
   *
   * A ring captures a particle if the particle is on one of its elements and the RF
   * programme matches its momentum. Captured particles follow the ramp; everything else
   * keeps the energy it has. That single rule replaces the injection interlock: a 450 GeV
   * batch arriving at a machine that has ramped is simply never captured, and is bent by
   * a field fifteen times too strong until it reaches the wall.
   */
  private updateCapture(): void {
    const { x, y, vx, vy, alive, count, gamma, rate } = this.beam;
    for (let i = 0; i < count; i++) {
      if (!alive[i]) continue;
      // How fast this bunch is drawn moving, from its own energy and nothing else's.
      rate[i] = this.stepRateFor(gamma[i]);
      projectToOrbit(this.apertureTable, this.elementCount, x[i], y[i], this.frame);
      const m = this.frame.machine;
      // Cogging: a trim on one beam's revolution frequency, in the collider only. Slipping
      // one beam against the other is the only way to move where they meet — see `COG_TRIM`
      // — and `rate` is exactly the revolution frequency this world runs a particle at, so
      // this is the trim and not a picture of one.
      //
      // **It always slows a beam and never speeds one up**, and that is not a stylistic
      // choice. `rate` is a fraction of the iterations the world offers, the world offers
      // them at the rate a *top-energy* beam needs, and the backend's accumulator can
      // advance a particle at most once per iteration — so any rate above 1 is silently
      // thrown away. At flat top a captured beam is already at exactly 1, so speeding it up
      // did nothing at all and cogging worked in one direction only, at one energy only.
      // A frequency trim is relative anyway: to move the crossing one way, slow beam 2; to
      // move it the other, slow beam 1.
      if (this.cogging !== 0 && m === 0) {
        const against = vx[i] * this.frame.tx + vy[i] * this.frame.ty < 0;
        const slowTheReverseBeam = this.cogging < 0;
        if (against === slowTheReverseBeam) rate[i] *= 1 - COG_TRIM;
      }
      if (m === NO_MACHINE) {
        this.beam.ring[i] = FREE_FLIGHT;
        continue;
      }
      const machine = this.machines[m];
      // Capture is a state, not a test repeated every frame.
      //
      // The RF either has this bunch in a bucket or it does not. Re-asking the question
      // each frame made the answer depend on the frame: at 200× machine time the
      // programme moves 4.5 % of the current between one frame and the next, more than
      // the capture window, so a beam that was perfectly captured was dropped, its
      // momentum froze, and the field climbed out from under it. Which looked exactly
      // like injection being broken by moving a time slider, because it was.
      if (this.beam.ring[i] !== m) {
        const p = this.beam.momentum(i);
        const matched = Math.abs(p / machine.momentumGeVc - 1) < CAPTURE_WINDOW;
        if (!matched) {
          this.beam.ring[i] = FREE_FLIGHT;
          continue;
        }
        this.beam.ring[i] = m;
      }
      // The RF is what puts the energy in. Without it the beam keeps the momentum it has
      // while the field climbs away from it.
      if (!machine.rfOn) continue;
      const want = machine.gamma;
      if (gamma[i] !== want) this.beam.setGamma(i, want);
    }
  }

  private collectLosses(): void {
    const backend = this.backend;
    if (!backend) return;
    const n = backend.drainLosses(this.lossScratch);
    if (n === 0) return;

    for (let i = 0; i < n; i++) {
      const o = i * LOSS_STRIDE;
      const sx = this.lossScratch[o];
      const sy = this.lossScratch[o + 1];
      const offset = this.lossScratch[o + 4];
      const particle = this.lossScratch[o + 7];
      const element = this.lossScratch[o + 8];
      const px = this.lossScratch[o + 9];
      const py = this.lossScratch[o + 10];

      const eo = element * APERTURE_STRIDE;
      const machineIndex = this.apertureTable[eo + 8];
      const sector = this.apertureTable[eo + 9];

      const energyGeV = this.beam.gamma[particle] * 0.938_272_088_16;
      const deposited = beamEnergyJoules(this.beam.charge[particle], energyGeV);
      const depth = penetrationDepth(energyGeV, deposited);

      // Did it end up somewhere it was supposed to? A dump line's absorber is the only
      // place in the complex where stopping the beam is the intended outcome. Asked of where
      // the particle is, not of where its closed orbit was.
      const onPurpose = this.isDumpEnd(px, py);

      // A quench is a heating event, and heat does not care which element the aperture
      // table says the beam was in when it died.
      //
      // The rule used to be "the loss is inside an arc, or nothing happens", which meant a
      // batch that hit the wall of a straight a few metres from a dipole left it at 1.9 K
      // while the same batch a metre further on took the whole sector down. So the deposit
      // goes into the *nearest* cold mass instead, with the fraction of the shower that
      // reaches it falling off over the machine's own aperture — a hundred metres of
      // vacuum, steel and concrete between the impact and the coil is what stops a quench,
      // and a hit right beside the magnet is as good as a hit inside it.
      let quenched = false;
      let coilGap = Infinity;
      let coilFraction = 0;
      const near = this.nearestColdMass(px, py);
      if (near) {
        const machine = this.machines[near.machine];
        coilGap = near.gap;
        coilFraction = Math.exp(-near.gap / machine.ring.config.apertureRadius);
        quenched = machine.circuits[near.arc].deposit(deposited * coilFraction);
      }

      this.losses.push({
        sx,
        sy,
        nx: this.lossScratch[o + 2],
        ny: this.lossScratch[o + 3],
        offset,
        machine: machineIndex,
        sector,
        energyGeV,
        depositedEnergy: deposited,
        coilGap,
        coilFraction,
        quenched,
        onPurpose,
        at: now(),
      });

      const peak = channelTemperature(deposited, depth);
      this.damage.push({
        // One primary's cascade, seeded from where it happened so it is the same tree every
        // frame. The batch is 2.7e13 protons and this is the shape one of them makes.
        shower: buildShower(energyGeV, px * 7.3 + py * 3.1 + particle),
        energyGeV,
        sx,
        sy,
        nx: this.lossScratch[o + 2],
        ny: this.lossScratch[o + 3],
        px,
        py,
        side: offset >= 0 ? 1 : -1,
        dirX: this.lossScratch[o + 5],
        dirY: this.lossScratch[o + 6],
        depth,
        deposited,
        peakTemperature: peak,
        temperature: peak,
        arc: sector,
        radius: this.apertureTable[eo + 7],
        onPurpose,
        at: this.machineClock,
      });
    }
    if (this.losses.length > 16) this.losses.splice(0, this.losses.length - 16);
    if (this.damage.length > 48) this.damage.splice(0, this.damage.length - 48);
  }

  /**
   * The nearest cold mass that could be quenched by something happening at (x, y), and how
   * far the shower has to travel to reach it [m].
   *
   * Only superconducting machines are asked: the injector's magnets are warm and resistive,
   * so nothing there can quench — it can only be hit. Distance is to the arc's own annulus,
   * so a loss inside the magnet gives a gap of zero and the full deposit.
   */
  private nearestColdMass(x: number, y: number): { machine: number; arc: number; gap: number } | null {
    let best: { machine: number; arc: number; gap: number } | null = null;
    for (let m = 0; m < this.machines.length; m++) {
      const ring = this.machines[m].ring;
      if (!ring.config.superconducting) continue;
      for (const arc of ring.arcs) {
        const dx = x - arc.cx;
        const dy = y - arc.cy;
        const r = Math.hypot(dx, dy);
        let a = Math.atan2(dy, dx) - arc.phiStart;
        a -= Math.PI * 2 * Math.round(a / (Math.PI * 2));
        const lo = Math.min(0, arc.dPhi);
        const hi = Math.max(0, arc.dPhi);
        let gap: number;
        if (a >= lo && a <= hi) {
          gap = Math.abs(r - arc.radius);
        } else {
          // past one end of the arc: measure to the nearer end of the magnet string
          const end = Math.abs(a - lo) < Math.abs(a - hi) ? lo : hi;
          const phi = arc.phiStart + end;
          gap = Math.hypot(x - (arc.cx + arc.radius * Math.cos(phi)), y - (arc.cy + arc.radius * Math.sin(phi)));
        }
        if (!best || gap < best.gap) best = { machine: m, arc: arc.index, gap };
      }
    }
    return best;
  }

  /**
   * Is that point inside a dump absorber?
   *
   * Asked of where the particle actually **is**, not of the closest point on the closed
   * orbit. The two are the same thing for a beam that crossed its pipe and hit the side
   * wall, and they are nothing like the same thing for a beam that ran down the middle of a
   * dump line: the loss gets anchored to whatever element claims the particle once the line
   * has run out, which is a collider element 243 m away in empty space. This used to be
   * asked of that anchor against a 720 m ball, which said "in the absorber" for a beam that
   * was never within 240 m of it.
   */
  private isDumpEnd(x: number, y: number): boolean {
    for (const e of this.extractions) {
      if (!e.line.isDump) continue;
      const a = e.line.config.apertureRadius;
      const { x: ex, y: ey, dx, dy } = e.line.exit;
      const along = (x - ex) * dx + (y - ey) * dy;
      const across = -(x - ex) * dy + (y - ey) * dx;
      // a metre of slack at the mouth, for a particle stopped just short of the face
      if (along > -1 && along < a * DUMP_BLOCK_LENGTH_F && Math.abs(across) < a * DUMP_BLOCK_HALF_WIDTH_F) {
        return true;
      }
    }
    return false;
  }

  // --- telemetry ------------------------------------------------------------

  /** Live bunches in a machine, by the ring that captured them. */
  bunchesIn(machine: number): number {
    let n = 0;
    for (let i = 0; i < this.beam.count; i++) {
      if (this.beam.alive[i] && this.beam.ring[i] === machine) n++;
    }
    return n;
  }

  /** Live bunches in a machine going one way round it. */
  bunchesInBeam(machine: number, bore: number): number {
    const { x, y, vx, vy, alive, ring, count } = this.beam;
    let n = 0;
    for (let i = 0; i < count; i++) {
      if (!alive[i] || ring[i] !== machine) continue;
      projectToOrbit(this.apertureTable, this.elementCount, x[i], y[i], this.frame);
      const along = vx[i] * this.frame.tx + vy[i] * this.frame.ty;
      if (bore > 0 ? along >= 0 : along < 0) n++;
    }
    return n;
  }

  /** Bunches neither ring has captured — in a line, or about to be lost. */
  get inFlight(): number {
    let n = 0;
    for (let i = 0; i < this.beam.count; i++) {
      if (this.beam.alive[i] && this.beam.ring[i] === FREE_FLIGHT) n++;
    }
    return n;
  }

  /** Stored beam energy in a machine [J]. */
  storedBeamEnergy(machine: number): number {
    let sum = 0;
    for (let i = 0; i < this.beam.count; i++) {
      if (!this.beam.alive[i] || this.beam.ring[i] !== machine) continue;
      sum += beamEnergyJoules(this.beam.charge[i], this.beam.gamma[i] * 0.938_272_088_16);
    }
    return sum;
  }

  /** Signed transverse offset of a given particle, as a fraction of its local pipe. */
  offsetOf(i: number): { metres: number; fraction: number } {
    projectToOrbit(this.apertureTable, this.elementCount, this.beam.x[i], this.beam.y[i], this.frame);
    return { metres: this.frame.offset, fraction: this.frame.offset / this.frame.radius };
  }

  /** Index of the first live bunch captured by a machine, or −1. */
  leadBunch(machine: number): number {
    for (let i = 0; i < this.beam.count; i++) {
      if (this.beam.alive[i] && this.beam.ring[i] === machine) return i;
    }
    return -1;
  }

  /** Sectors in the shared field table: every arc of every machine and every line. */
  get sectorCount(): number {
    return this.sectorRefs.length;
  }

  /** Elements in the shared aperture table. */
  get elements(): number {
    return this.elementCount;
  }

  get quenchedCircuits(): number {
    let n = 0;
    for (const m of this.machines) n += m.quenchedCount;
    return n;
  }

  /** Speed of light in the world's own units, for the HUD's time-of-flight lines. */
  static readonly C = C_LIGHT;

  /** β of a machine's programme, for time-of-flight sums. */
  betaOf(machine: number): number {
    return betaFromGamma(this.machines[machine].gamma);
  }
}

// --- arclength: where something is *along* a ring ------------------------------

/**
 * A stretch of ring the two beams are lying on top of each other on, **right now**.
 *
 * A batch is 1754 m long, so two of them passing each other interpenetrate over an interval
 * that opens from nothing, grows to a whole batch length and closes again — and while it is
 * open, a bunch of one beam is meeting a bunch of the other at *every* point of it, evenly,
 * because at each point exactly one bunch of each batch is there. That is what makes this the
 * honest thing to draw: it is where the beams are meeting, at the moment they are meeting.
 *
 * Its centre never moves. It sits at `(s₁+s₂)/2`, the crossing point, because the two batch
 * centres approach it at the same speed from opposite sides.
 *
 * Two arcs shorter than half a ring intersect in at most one interval, so a batch pair has
 * exactly one of these at a time — the antipodal crossing is the *same* pair half a turn
 * later, which is why the two experiments flash alternately rather than together.
 */
export interface BeamOverlap {
  /** Centre of the overlap along the closed orbit [m] — the crossing point. */
  s: number;
  /** Half its length [m]: (batch length − separation) / 2, so it opens and closes as they pass. */
  half: number;
}

/** A bunch reduced to what a crossing calculation needs. */
interface BunchOnOrbit {
  /** Index in the beam array. */
  index: number;
  /** Distance travelled along the closed orbit [m]. */
  s: number;
  /** Protons in this batch. */
  protons: number;
}

/**
 * Distance along a ring's closed orbit of the point nearest (x, y), and the design
 * direction there.
 *
 * The aperture table cannot answer this: it holds the whole complex, it is searched by
 * proximity as a fraction of the local pipe, and it has no notion of "how far round". This
 * scans one ring's own geometry, which is unambiguous — a ring's elements tile it exactly
 * once, straight `k` then arc `k`.
 *
 * Nothing in the pusher needs this, which is why it is here and not in `aperture.ts`: it is
 * asked of a dozen macro-particles once a frame, never of a particle in the inner loop, so
 * it has no shader twin to keep in step.
 */
export function arclengthOnRing(
  ring: Ring,
  x: number,
  y: number,
): { s: number; tx: number; ty: number } {
  const straightLength = ring.straights[0].length;
  const arcLength = ring.arcs[0].length;
  const cell = straightLength + arcLength;

  let best = Infinity;
  let s = 0;
  let tx = 1;
  let ty = 0;

  for (let k = 0; k < ring.straights.length; k++) {
    const e = ring.straights[k];
    const along = Math.max(0, Math.min(e.length, (x - e.x1) * e.dx + (y - e.y1) * e.dy));
    const px = e.x1 + e.dx * along;
    const py = e.y1 + e.dy * along;
    const d = Math.hypot(x - px, y - py);
    if (d < best) {
      best = d;
      s = k * cell + along;
      tx = e.dx;
      ty = e.dy;
    }

    const a = ring.arcs[k];
    let phi = Math.atan2(y - a.cy, x - a.cx) - a.phiStart;
    phi -= Math.PI * 2 * Math.round(phi / (Math.PI * 2));
    const lo = Math.min(0, a.dPhi);
    const hi = Math.max(0, a.dPhi);
    const clamped = Math.max(lo, Math.min(hi, phi));
    const qx = a.cx + a.radius * Math.cos(a.phiStart + clamped);
    const qy = a.cy + a.radius * Math.sin(a.phiStart + clamped);
    const dq = Math.hypot(x - qx, y - qy);
    if (dq < best) {
      best = dq;
      s = k * cell + straightLength + Math.abs(clamped) * a.radius;
      // tangent, running the way the arc sweeps
      const sign = Math.sign(a.dPhi) || 1;
      tx = -Math.sin(a.phiStart + clamped) * sign;
      ty = Math.cos(a.phiStart + clamped) * sign;
    }
  }
  return { s, tx, ty };
}

/**
 * The inverse: where arclength `s` is on a ring, and which way the beam points there.
 *
 * The renderer needs this to draw the interaction region — the stretch of ring over which
 * two batches interpenetrate — as a band lying on the closed orbit, which is the only
 * feedback cogging has.
 */
export function poseAtArclength(ring: Ring, s: number): Pose {
  const straightLength = ring.straights[0].length;
  const arcLength = ring.arcs[0].length;
  const cellLength = straightLength + arcLength;
  const C = ring.config.circumference;

  let t = s - C * Math.floor(s / C);
  const k = Math.min(ring.straights.length - 1, Math.floor(t / cellLength));
  t -= k * cellLength;

  if (t <= straightLength) {
    const e = ring.straights[k];
    return { x: e.x1 + e.dx * t, y: e.y1 + e.dy * t, dx: e.dx, dy: e.dy };
  }
  const a = ring.arcs[k];
  const phi = a.phiStart + (a.dPhi * (t - straightLength)) / arcLength;
  const sign = Math.sign(a.dPhi) || 1;
  return {
    x: a.cx + a.radius * Math.cos(phi),
    y: a.cy + a.radius * Math.sin(phi),
    dx: -Math.sin(phi) * sign,
    dy: Math.cos(phi) * sign,
  };
}

/** `value` folded into [−period/2, period/2). */
/**
 * One point out of the meeting points of a batch pass, clipped to what an insertion sees.
 *
 * The density is triangular about the crossing, `peak`, and reaches a half-batch either side:
 * bunch j of one batch meets bunch k of the other at the mean of their positions, so summing
 * over j and k gives the convolution of two flat batches, which is a triangle. Clipping it to
 * `[lo, hi]` — the part of that triangle lying inside the detector — and sampling it is the
 * whole of where an event display is drawn.
 *
 * Binned rather than inverted analytically: the density is piecewise linear and clipped on
 * both sides, and thirty-two bins over at most 1100 m is 34 m of quantisation, which is under
 * three pixels.
 */
function sampleMeeting(lo: number, hi: number, peak: number, half: number, seed: number): number {
  const bins = 32;
  const at = (i: number): number => lo + ((hi - lo) * (i + 0.5)) / bins;
  const weight = (i: number): number => Math.max(0, 1 - Math.abs(at(i) - peak) / half);
  let total = 0;
  for (let i = 0; i < bins; i++) total += weight(i);
  if (total <= 0) return (lo + hi) / 2;
  let t = hash01(seed) * total;
  for (let i = 0; i < bins; i++) {
    t -= weight(i);
    if (t <= 0) return at(i);
  }
  return (lo + hi) / 2;
}

/** One deterministic number in [0, 1) out of a seed — the same integer hash `shower.ts` uses. */
function hash01(seed: number): number {
  let t = Math.imul(seed | 0, 1664525) + 1013904223;
  t = Math.imul(t ^ (t >>> 15), 1664525) + 1013904223;
  return (t >>> 0) / 4294967296;
}

function wrapSigned(value: number, period: number): number {
  const r = value - period * Math.round(value / period);
  return r;
}

/** A transfer-line dipole string, powered and sitting at its set point. */
function energised(): MagnetCircuit {
  const circuit = new MagnetCircuit({
    inductance: 0.5,
    nominalCurrent: 1000,
    rampRate: 200,
    extractionTau: 8,
    coldMass: 1e5,
    quenchMargin: 0,
  });
  circuit.current = circuit.config.nominalCurrent;
  circuit.targetCurrent = circuit.current;
  return circuit;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
