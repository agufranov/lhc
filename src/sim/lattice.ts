/**
 * Ring geometry.
 *
 * A ring is built as N identical cells:   [ straight section ] [ arc (dipoles) ]
 * Every arc bends by exactly 2π/N, so the machine closes on itself by construction —
 * the closed orbit is a regular N-gon with rounded corners, which is what a real
 * accelerator actually is. With N = 8 you get the LHC octagon, with N = 6 the SPS.
 *
 * A ring also carries where it sits in the world (`placement`) and which way it turns
 * (`sense`). Neither is physics; they are what lets two rings and the lines between them
 * share one coordinate system.
 *
 * This is pure geometry. The flat tables the pusher reads are assembled in world.ts, out
 * of every machine and every line at once — a particle is at a place and feels whatever
 * is at that place, so there is nothing per-ring about them.
 */

/** Where a lattice starts and which way it points. Drawing, not physics. */
export interface Placement {
  x: number;
  y: number;
  /** Direction of travel at the start of straight 0 [rad]. */
  rotation: number;
}

export interface RingConfig {
  id: string;
  name: string;
  /** Number of cells = number of arcs = number of straight sections. */
  cells: number;
  /** Design circumference [m]. */
  circumference: number;
  /** Fraction of the circumference filled with bending magnets. */
  bendFraction: number;
  /** Bending dipoles per arc (cosmetic + powering bookkeeping). */
  dipolesPerArc: number;
  injectionEnergyGeV: number;
  topEnergyGeV: number;
  /** Total inductance of one arc's main dipole circuit [H]. */
  arcInductance: number;
  /** Main dipole current at top energy [A]. */
  nominalCurrent: number;
  /**
   * How fast the programme is allowed to move the dipole current [A per machine second].
   *
   * This is the whole difference in character between the two machines here. The collider
   * carries 1.4 GJ per sector through 15 H of coil and takes twenty minutes over its ramp;
   * the injector is a small warm machine that ramps in seconds and does it again every
   * cycle. One number says which kind of machine it is.
   */
  rampRate: number;
  /** Cell index where the beam is injected. */
  injectionCell: number;
  placement: Placement;
  /**
   * +1 = the beam turns left (counter-clockwise in machine coordinates, which the camera
   * flips into a clockwise ring on screen), −1 = it turns right.
   *
   * The injector counter-rotates, and that is not decoration: an extraction line leaves
   * along a tangent, and a ring is always on the *inside* of its own tangent. Two rings
   * turning the same way therefore end up nested along that line with their tunnels
   * overlapping, whichever length you pick. Counter-rotating puts the injector on the
   * far side of the line, clear of the collider — which is also why the real TI 2 hands
   * the SPS beam over the way it does.
   */
  sense: 1 | -1;
  /**
   * Twin-bore magnets: two apertures with opposite field in one cold mass, so the ring
   * can carry two beams going opposite ways round it. A particle travelling against the
   * design direction is in the other bore and is bent correctly. A single-bore machine
   * has one pipe, and a particle going the wrong way through it is bent the wrong way.
   */
  twinBore: boolean;
  /** Whether its magnets are superconducting, and so whether they can quench at all. */
  superconducting: boolean;
  /** Cold mass of one arc's magnets [kg] — what a beam hit has to heat up. */
  arcColdMass: number;
  /** Temperature margin above 1.9 K at zero current [K]; see MagnetCircuit. */
  quenchMargin: number;
  /** Radial half-width of the magnet bore, where the dipole field exists [m]. */
  fieldRegionHalfWidth: number;
  /**
   * Half-aperture of the pipe as simulated and drawn [m].
   *
   * Deliberately ~3600× the real thing, and this is the one number in the model that is
   * knowingly wrong. The reason is geometry, not laziness: a particle with no field on
   * it leaves an aperture `a` after ρθ²/2 = a, i.e. after √(2aρ) of flight. For the real
   * 29 mm pipe that is 13 m — one pixel on a ring 8 km across, so "no magnets means a
   * straight line" would be invisible, which is the single most important thing this
   * simulation has to show. At 250 m the same straight line runs for 1180 m before it
   * touches the wall, and the aperture it crosses is ~20 px tall, so you can watch both
   * the drift and the impact.
   *
   * The true offset in millimetres is reported in the HUD next to what the real pipe
   * would have done with it.
   */
  apertureRadius: number;
  /** The real LHC beam pipe [m]. Not used by the physics, only quoted. */
  beamPipeRadius: number;
}

export const LHC_CONFIG: RingConfig = {
  id: 'lhc',
  name: 'LHC',
  cells: 8,
  circumference: 26_658.883,
  // 1232 main dipoles × 14.3 m of magnetic length
  bendFraction: (1232 * 14.3) / 26_658.883,
  dipolesPerArc: 154,
  injectionEnergyGeV: 450,
  topEnergyGeV: 6800,
  arcInductance: 15.1, // 154 × 98 mH
  nominalCurrent: 11_080, // A at 6.8 TeV
  // 10 A/s: 733 A at injection to 11 080 A at flat top is 1035 s, the real ~20 minute ramp
  rampRate: 10,
  injectionCell: 1, // LSS2 — beam 1 really is injected at Point 2
  // Which way up the octagon is drawn is arbitrary; a quarter turn is what puts the
  // injector complex beside the collider instead of under it, and the whole picture
  // then costs no screen space at all (see `placeInjector`).
  placement: { x: 0, y: 0, rotation: Math.PI / 2 },
  sense: 1,
  twinBore: true,
  superconducting: true,
  // 154 dipoles of 27.5 t
  arcColdMass: 154 * 27_500,
  // margin to the critical surface at zero current; ~1 K of it survives at nominal
  quenchMargin: 7,
  // the bore has to be wider than the aperture, or a particle could drift out of the
  // field before it reaches the wall and never be bent back
  fieldRegionHalfWidth: 320,
  apertureRadius: 250,
  beamPipeRadius: 0.0289,
};

/**
 * The SPS: last stage of the injector chain and the machine that actually fills the LHC.
 *
 * Real numbers: 6911.5 m in six sextants, 744 main dipoles of 6.26 m, which gives
 * ρ = 741.3 m and 2.02 T at 450 GeV — all of that comes straight out of the geometry.
 *
 * `arcInductance` and `nominalCurrent` are indicative rather than sourced, and unlike
 * everywhere else in this model they should not be quoted at anyone: the SPS main
 * dipoles are warm, resistive magnets, so their real power bill is I²R — a term this
 * simulation does not have (see powering.ts, which assumes a superconducting circuit).
 * What the SPS is here for is the beam it hands over, not its power draw.
 *
 * `placement` is a placeholder: the injector is positioned against the collider it feeds
 * by `placeInjector` in world.ts, which is the only thing that knows where that is.
 */
export const SPS_CONFIG: RingConfig = {
  id: 'sps',
  name: 'SPS',
  cells: 6,
  circumference: 6911.5,
  bendFraction: (744 * 6.26) / 6911.5,
  dipolesPerArc: 124,
  /**
   * 26 → 450 GeV, and it really ramps.
   *
   * These are the real energies: the PS delivers at 26 GeV and the LHC takes beam at 450,
   * and everything the SPS is for happens in between. It used to sit at 450 with injection
   * and top the same, which made it a very large piece of pipe that handed over a beam it
   * had done nothing to — and made `docs/limits.md` say so. Now the chain delivers at flat
   * bottom, the operator ramps, and a batch extracted before the ramp is a 26 GeV batch
   * arriving at a collider set for 450: the same lesson as injecting into a ramped LHC,
   * one straight down the injector.
   */
  injectionEnergyGeV: 26,
  topEnergyGeV: 450,
  arcInductance: 2.4,
  nominalCurrent: 5000,
  /**
   * Stretched, and this is the one place the two clocks cannot both be served.
   *
   * The real SPS ramps 26 → 450 GeV in about 4.3 s. At the fixed 200× machine clock that
   * is 21 ms of wall time — the beam would simply *be* at flat top the frame after the
   * button, and a machine whose whole new job is to accelerate would show nothing doing
   * it. So the ramp is stretched to 98 s of machine time, half a second of play, which is
   * long enough to watch the beam clock climb under it. It is still 10× the rate the
   * collider's dipoles are allowed, which is the fact about the two machines that matters.
   */
  rampRate: 48,
  injectionCell: 3,
  placement: { x: 0, y: 0, rotation: 0 },
  sense: -1,
  // one pipe, and warm resistive magnets: nothing here can quench, it can only be hit
  twinBore: false,
  superconducting: false,
  arcColdMass: 124 * 17_000,
  quenchMargin: 0,
  // Same exaggeration as the LHC's aperture, scaled by the bend radius: an aperture is
  // only visible on screen if it is the same fraction of the ring it belongs to. Field
  // half-width keeps the same margin over it that the LHC's does.
  fieldRegionHalfWidth: 85,
  apertureRadius: 66,
  beamPipeRadius: 0.0289,
};

/** One bending arc: an annular sector of field. */
export interface Arc {
  index: number;
  name: string;
  /** Centre of curvature [m]. */
  cx: number;
  cy: number;
  radius: number;
  /** Entry angle as seen from the centre of curvature [rad]. */
  phiStart: number;
  /** Signed swept angle [rad]; sign encodes the bend direction. */
  dPhi: number;
  /** Sign of B_z that produces this bend for a positive charge. */
  fieldSign: number;
  length: number;
  dipoles: number;
}

export interface Straight {
  index: number;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Unit vector along the beam direction. */
  dx: number;
  dy: number;
  length: number;
}

export interface Ring {
  config: RingConfig;
  arcs: Arc[];
  straights: Straight[];
  /** Bending radius ρ [m]. */
  bendRadius: number;
  /** Closed-orbit polyline, [x0,y0,x1,y1,...] in machine coordinates [m]. */
  orbit: Float64Array;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Injection point and direction. */
  injection: { x: number; y: number; dx: number; dy: number };
}

const TAU = Math.PI * 2;

export function buildRing(config: RingConfig): Ring {
  const n = config.cells;
  const sense = config.sense;
  const arcLength = (config.circumference * config.bendFraction) / n;
  const straightLength = (config.circumference * (1 - config.bendFraction)) / n;
  const theta = (sense * TAU) / n; // every cell bends by the same angle -> the ring closes
  const bendRadius = arcLength / Math.abs(theta);

  const arcs: Arc[] = [];
  const straights: Straight[] = [];
  const orbit: number[] = [];

  // Machine coordinates are right-handed with y up. The camera maps that onto y-down pixels,
  // which is not a mirror — north stays up — so the sense of a lattice reads the same on
  // screen as it does here: +1 turns anticlockwise in both.
  let x = config.placement.x;
  let y = config.placement.y;
  let dx = Math.cos(config.placement.rotation);
  let dy = Math.sin(config.placement.rotation);

  for (let k = 0; k < n; k++) {
    const point = k + 1; // LHC insertion points P1..P8
    const nextPoint = ((k + 1) % n) + 1;

    // --- straight section: no field, the beam flies dead straight -------------
    const sx = x;
    const sy = y;
    x += dx * straightLength;
    y += dy * straightLength;
    straights.push({
      index: k,
      name: `LSS${point}`,
      x1: sx,
      y1: sy,
      x2: x,
      y2: y,
      dx,
      dy,
      length: straightLength,
    });
    orbit.push(sx, sy, x, y);

    // --- arc: constant vertical dipole field ---------------------------------
    // Turning left puts the centre of curvature on the left normal (-dy, dx); a ring
    // that turns right puts it on the right one.
    const cx = x - sense * dy * bendRadius;
    const cy = y + sense * dx * bendRadius;
    const phiStart = Math.atan2(y - cy, x - cx);

    arcs.push({
      index: k,
      name: `S${point}${nextPoint}`,
      cx,
      cy,
      radius: bendRadius,
      phiStart,
      dPhi: theta,
      // a = (q/γm)·(vy·Bz, −vx·Bz); for v = +x and a = +y we need Bz < 0
      fieldSign: -sense,
      length: arcLength,
      dipoles: config.dipolesPerArc,
    });

    const arcSamples = 48;
    for (let i = 1; i <= arcSamples; i++) {
      const phi = phiStart + (theta * i) / arcSamples;
      const px = cx + bendRadius * Math.cos(phi);
      const py = cy + bendRadius * Math.sin(phi);
      orbit.push(px, py);
    }

    const phiEnd = phiStart + theta;
    x = cx + bendRadius * Math.cos(phiEnd);
    y = cy + bendRadius * Math.sin(phiEnd);
    const ndx = dx * Math.cos(theta) - dy * Math.sin(theta);
    const ndy = dx * Math.sin(theta) + dy * Math.cos(theta);
    dx = ndx;
    dy = ndy;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < orbit.length; i += 2) {
    minX = Math.min(minX, orbit[i]);
    maxX = Math.max(maxX, orbit[i]);
    minY = Math.min(minY, orbit[i + 1]);
    maxY = Math.max(maxY, orbit[i + 1]);
  }
  const inj = straights[config.injectionCell % n];

  return {
    config,
    arcs,
    straights,
    bendRadius,
    orbit: Float64Array.from(orbit),
    bounds: { minX, minY, maxX, maxY },
    injection: { x: inj.x1, y: inj.y1, dx: inj.dx, dy: inj.dy },
  };
}
