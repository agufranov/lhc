/**
 * Transfer and dump lines.
 *
 * A line is a short lattice that is not a ring: a drift, optionally a bend, another
 * drift. It leaves one machine along a tangent and either lands on another machine's
 * closed orbit or ends in a block of graphite.
 *
 * Why a bend is needed at all, given that TI 2 in `placeInjector` is a pure drift: the
 * injector can only be positioned once. The first line is aimed by moving the whole ring
 * to suit it; every line after that has to be steered, because the geometry at both ends
 * is already fixed. Those bends are real dipoles in the field table, on real circuits —
 * switch one off and the beam does not arrive.
 *
 * The solver is the useful part. Given where the beam leaves (a point and a direction)
 * and where it has to be (a point and a direction), a drift–arc–drift has three unknowns
 * — the two drift lengths and the bend radius — and two equations. So the radius is a
 * free parameter, chosen for the strongest field the dipoles are allowed to run at, and
 * the drifts fall out of a 2×2 solve.
 */

import type { Arc, Straight } from './lattice';

const TAU = Math.PI * 2;

export interface Pose {
  x: number;
  y: number;
  /** Unit direction of travel. */
  dx: number;
  dy: number;
}

export interface LineConfig {
  id: string;
  name: string;
  /** Aperture half-width of the line's pipe [m]. */
  apertureRadius: number;
  /** Radial half-width of the bend's field region [m]. */
  fieldRegionHalfWidth: number;
  /**
   * Which aperture of the ring it leaves feeds this line. A kicker acts on one beam:
   * this is the bore whose field is suppressed when the line's kicker fires.
   */
  bore: number;
  /** Beam momentum the line is set up for [GeV/c] — its dipoles are matched to it. */
  designMomentumGeVc: number;
  /** Machine index the line leaves from. */
  fromMachine: number;
  /** Straight the kicker sits in, and the arc whose bend the septum cancels. */
  kickerCell: number;
  kickerSector: number;
  /**
   * Which way the kicker throws the bunch: +1 outward, away from the ring centre, −1
   * inward. Outward is the obvious one and usually the right one; kicking the other way
   * out of the *next* sector along can reach the same place with far less tunnel, because
   * the two lines then lean towards each other instead of both fanning out.
   */
  kickSign: number;
  /**
   * How much of its straight the kicker fills, as a fraction.
   *
   * Per line and not a global constant, because two extractions can share one straight: the
   * two dump kickers do, one at each end, and at the usual 0.85 they overlapped over seven
   * tenths of it and were drawn one on top of the other. The physics never noticed — a
   * kicker acts on one aperture and they act on different ones — but the picture showed two
   * devices occupying the same metres of tunnel, which is not a thing.
   *
   * A shorter kicker needs a stronger field for the same angle, and the field is reported by
   * `check` rather than hidden.
   */
  kickerLengthF: number;
  /** Machine index it delivers to, or -1 for a dump. */
  toMachine: number;
}

export interface BeamLine {
  config: LineConfig;
  straights: Straight[];
  arcs: Arc[];
  /** Total length [m]. */
  length: number;
  /** Where it starts and where it ends. */
  entry: Pose;
  exit: Pose;
  /** True if it ends in an absorber rather than in a machine. */
  isDump: boolean;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Samples a line's path. Used to check that a line does not cut through a machine on its
 * way — a transfer line that crosses a ring would put its pipe inside the ring's, and any
 * beam circulating there would find itself in the wrong tunnel.
 */
export function sampleLine(line: BeamLine, step = 40): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  let travelled = 0;
  const walk = (
    length: number,
    at: (t: number) => [number, number],
  ): void => {
    const n = Math.max(2, Math.ceil(length / step));
    for (let i = 0; i <= n; i++) {
      const [px, py] = at(i / n);
      out.push([px, py, travelled + (length * i) / n]);
    }
    travelled += length;
  };
  // elements were pushed in beam order within each kind, and a line alternates
  // drift, bend, drift, bend — walk them back together
  const drifts = [...line.straights];
  const bends = [...line.arcs];
  while (drifts.length || bends.length) {
    const d = drifts.shift();
    if (d) walk(d.length, (t) => [d.x1 + d.dx * d.length * t, d.y1 + d.dy * d.length * t]);
    const b = bends.shift();
    if (b) {
      walk(b.length, (t) => {
        const phi = b.phiStart + b.dPhi * t;
        return [b.cx + b.radius * Math.cos(phi), b.cy + b.radius * Math.sin(phi)];
      });
    }
  }
  return out;
}

/** Signed angle from u to v, in (−π, π]. */
function turnBetween(u: Pose, v: Pose): number {
  let a = Math.atan2(v.dy, v.dx) - Math.atan2(u.dy, u.dx);
  a -= TAU * Math.round(a / TAU);
  return a;
}

/**
 * Solves drift → bend → drift from `from` to `to`.
 *
 * Returns null when no arrangement with both drifts pointing forwards exists, which is a
 * real answer: it means the two ends cannot be joined by one bend of that strength and
 * the geometry has to change, not the code.
 */
export function solveLine(
  from: Pose,
  to: Pose,
  bendRadius: number,
): { drift0: number; drift1: number; turn: number; radius: number } | null {
  const turn = turnBetween(from, to);

  if (Math.abs(turn) < 1e-9) {
    // straight shot: the two poses must already be collinear
    const along = (to.x - from.x) * from.dx + (to.y - from.y) * from.dy;
    const across = -(to.x - from.x) * from.dy + (to.y - from.y) * from.dx;
    if (Math.abs(across) > 1e-6 || along < 0) return null;
    return { drift0: along, drift1: 0, turn: 0, radius: 0 };
  }

  const sign = Math.sign(turn);
  // the arc's displacement, in the entry frame: forward r·sin|turn|, sideways r·(1−cos)
  const s = Math.sin(Math.abs(turn));
  const c = 1 - Math.cos(turn);
  const nx = -from.dy * sign;
  const ny = from.dx * sign;
  const ax = from.dx * bendRadius * s + nx * bendRadius * Math.abs(c);
  const ay = from.dy * bendRadius * s + ny * bendRadius * Math.abs(c);

  // to − from − arc = drift0·u0 + drift1·u1
  const rx = to.x - from.x - ax;
  const ry = to.y - from.y - ay;
  const det = from.dx * to.dy - from.dy * to.dx;
  if (Math.abs(det) < 1e-12) return null;
  const drift0 = (rx * to.dy - ry * to.dx) / det;
  const drift1 = (from.dx * ry - from.dy * rx) / det;
  if (drift0 < 0 || drift1 < 0) return null;

  return { drift0, drift1, turn, radius: bendRadius };
}

/**
 * Solves drift → bend, with the bend ending exactly on the target.
 *
 * This is the right shape for a line that has to *land* on a ring. Leave a trailing drift
 * and the line's last stretch lies on top of the closed orbit it is arriving at, running
 * inside the ring's own tunnel for as far as that drift is long — which is not a transfer
 * line, it is a second pipe down the middle of the machine. Ending on the bend means the
 * line touches the ring at one point and curves away from it everywhere else.
 *
 * With the trailing drift gone there are two unknowns for two equations, so there is no
 * free radius to choose: it comes out of the geometry, and if it comes out too tight for
 * the field the dipoles can produce, that pair of ends simply cannot be joined.
 */
export function solveLanding(
  from: Pose,
  to: Pose,
  reflex = false,
): { drift0: number; turn: number; radius: number } | null {
  // Two directions arrive at the same heading: turn 40° left, or 320° right. The short
  // one in angle is not always the short one in *tunnel* — bending the other way can put
  // the whole line on the near side of the ring instead of taking it around the far side.
  const direct = turnBetween(from, to);
  const turn = reflex ? direct - Math.sign(direct) * TAU : direct;
  if (Math.abs(turn) < 1e-9) return null;

  const sign = Math.sign(turn);
  const nx = -from.dy * sign;
  const ny = from.dx * sign;
  const rx = to.x - from.x;
  const ry = to.y - from.y;

  const across = rx * nx + ry * ny;
  const radius = across / (1 - Math.cos(turn));
  if (!(radius > 0)) return null;

  const drift0 = rx * from.dx + ry * from.dy - radius * Math.sin(Math.abs(turn));
  if (drift0 < 0) return null;

  return { drift0, turn, radius };
}

/**
 * Builds a line from `from` to `to`, choosing the tightest bend the dipoles can take.
 *
 * `maxField` is what the line's magnets are allowed to run at, which sets the smallest
 * radius through ρ = p / (0.3 B). Longer radii are tried in turn, because a bend that is
 * geometrically impossible at one radius is often fine at another.
 */
export function buildTransferLine(
  config: LineConfig,
  from: Pose,
  to: Pose,
  options: { maxField?: number; landing?: boolean } = {},
): BeamLine {
  const maxField = options.maxField ?? 1.8;
  const minRadius = config.designMomentumGeVc / (0.299_792_458 * maxField);

  let solved: { drift0: number; drift1: number; turn: number; radius: number } | null = null;
  if (options.landing) {
    const landing = solveLanding(from, to);
    if (landing && landing.radius >= minRadius) solved = { ...landing, drift1: 0 };
  } else {
    // Start at the tightest bend the dipoles can take and open it out until the geometry
    // admits a solution. Starting below `minRadius` would quietly ask for a field the
    // magnets cannot produce.
    for (let k = 0; k < 80 && !solved; k++) {
      solved = solveLine(from, to, minRadius * (1 + k * 0.25));
    }
  }
  if (!solved) {
    throw new Error(
      `${config.name}: no drift-bend-drift joins those two ends; move the machines`,
    );
  }

  return assemble(config, from, to, [solved]);
}

/** Length, entry/exit poses and bounding box for an assembled sequence of elements. */
function finish(
  config: LineConfig,
  from: Pose,
  to: Pose,
  straights: Straight[],
  arcs: Arc[],
): BeamLine {
  let length = 0;
  for (const s of straights) length += s.length;
  for (const a of arcs) length += a.length;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (px: number, py: number): void => {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  };
  grow(from.x, from.y);
  grow(to.x, to.y);
  for (const s of straights) {
    grow(s.x1, s.y1);
    grow(s.x2, s.y2);
  }
  for (const a of arcs) {
    const samples = 16;
    for (let i = 0; i <= samples; i++) {
      const phi = a.phiStart + (a.dPhi * i) / samples;
      grow(a.cx + a.radius * Math.cos(phi), a.cy + a.radius * Math.sin(phi));
    }
  }

  return {
    config,
    straights,
    arcs,
    length,
    entry: { ...from },
    exit: { ...to },
    isDump: config.toMachine < 0,
    bounds: { minX, minY, maxX, maxY },
  };
}

/**
 * drift → bend → drift → bend, the second bend landing exactly on the target.
 *
 * One bend is not enough to join two machines that are already placed. The single-bend
 * solutions that exist at all come out 11–18 km long and still shave past a ring with
 * tens of metres to spare — which is another way of saying that a real transfer line has
 * more than one string of dipoles in it, and for the same reason.
 *
 * The turn is split between the two bends and both run at the same radius, which leaves
 * two unknowns — the two drifts — for the two position equations. Everything else is a
 * search over the split and the radius.
 */
function solveTwoBend(
  from: Pose,
  to: Pose,
  radius: number,
  split: number,
): { drift0: number; drift1: number; turn0: number; turn1: number; radius: number } | null {
  const total = turnBetween(from, to);
  const turn0 = total * split;
  const turn1 = total - turn0;
  if (Math.abs(turn0) < 1e-9 || Math.abs(turn1) < 1e-9) return null;

  const arcVec = (u: { dx: number; dy: number }, turn: number): [number, number] => {
    const sign = Math.sign(turn);
    const nx = -u.dy * sign;
    const ny = u.dx * sign;
    const s = Math.sin(Math.abs(turn));
    const c = 1 - Math.cos(turn);
    return [u.dx * radius * s + nx * radius * c, u.dy * radius * s + ny * radius * c];
  };

  const u0 = { dx: from.dx, dy: from.dy };
  const a0 = Math.atan2(from.dy, from.dx) + turn0;
  const u1 = { dx: Math.cos(a0), dy: Math.sin(a0) };

  const [a0x, a0y] = arcVec(u0, turn0);
  const [a1x, a1y] = arcVec(u1, turn1);
  const rx = to.x - from.x - a0x - a1x;
  const ry = to.y - from.y - a0y - a1y;

  const det = u0.dx * u1.dy - u0.dy * u1.dx;
  if (Math.abs(det) < 1e-9) return null;
  const drift0 = (rx * u1.dy - ry * u1.dx) / det;
  const drift1 = (u0.dx * ry - u0.dy * rx) / det;
  if (drift0 < 0 || drift1 < 0) return null;

  return { drift0, drift1, turn0, turn1, radius };
}

/**
 * Routes a line from `from` to `to` that stays clear of everything.
 *
 * Tries a single landing bend first, because a line with one dipole string in it is the
 * one to prefer, then opens out to two. `clears` is asked about each candidate; whatever
 * clears and is shortest wins.
 */
export function routeLine(
  config: LineConfig,
  from: Pose,
  to: Pose,
  clears: (line: BeamLine) => boolean,
  maxField = 1.8,
): BeamLine | null {
  const minRadius = config.designMomentumGeVc / (0.299_792_458 * maxField);
  let best: BeamLine | null = null;

  // Scored on how much *magnet* the route needs, not how much tunnel. Tunnel is cheap and
  // empty; a bend is a string of dipoles that has to be built, powered and paid for, and a
  // route that saves a kilometre of drift by asking for eight kilometres of curved dipole
  // is not the cheaper one. Tunnel length only breaks ties.
  const steel = (line: BeamLine): number => line.arcs.reduce((n, a) => n + a.length, 0);
  const consider = (line: BeamLine): void => {
    if (!clears(line)) return;
    if (!best) {
      best = line;
      return;
    }
    const a = steel(line);
    const b = steel(best);
    if (a < b - 1 || (Math.abs(a - b) <= 1 && line.length < best.length)) best = line;
  };

  // Reflex turns — bending the other way round to the same heading — were tried here and
  // do not shorten anything: to arrive at the same direction the line has to sweep 240°,
  // which is a loop, not a short cut, and the loop runs back through the collider's own
  // pipe. Measured at 10.83 km against 13.28, with the beam lost 4.3 km along it.
  // Drift → bend → drift, with the radius free.
  //
  // This is the arrangement that gives a *short* magnet. The landing solve below puts the
  // bend hard against the ring, and then there is no freedom left: the radius falls out of
  // the geometry and comes back in kilometres, which is a kilometres-long curved dipole.
  // Letting the beam drift, turn through a tight bend, and drift again separates the two
  // questions — the magnet is as short as its field allows, and the drifts do the rest.
  for (let ri = 0; ri < 24; ri++) {
    const radius = minRadius * (1 + ri * 0.35);
    const solved = solveLine(from, to, radius);
    if (solved) consider(assemble(config, from, to, [solved]));
  }

  const landing = solveLanding(from, to);
  if (landing && landing.radius >= minRadius) {
    consider(assemble(config, from, to, [{ ...landing, drift1: 0 }]));
  }

  for (let ri = 0; ri < 14; ri++) {
    const radius = minRadius * (1 + ri * 0.5);
    for (let si = 1; si < 12; si++) {
      const solved = solveTwoBend(from, to, radius, si / 12);
      if (!solved) continue;
      consider(assemble(config, from, to, [solved]));
    }
  }
  return best;
}

/** Turns a solved sequence into elements. */
function assemble(
  config: LineConfig,
  from: Pose,
  to: Pose,
  solutions: Array<
    | { drift0: number; drift1: number; turn: number; radius: number }
    | { drift0: number; drift1: number; turn0: number; turn1: number; radius: number }
  >,
): BeamLine {
  const straights: Straight[] = [];
  const arcs: Arc[] = [];
  let x = from.x;
  let y = from.y;
  let dx = from.dx;
  let dy = from.dy;

  const drift = (length: number): void => {
    if (length <= 1e-9) return;
    straights.push({
      index: straights.length,
      name: `${config.name}.D${straights.length + 1}`,
      x1: x,
      y1: y,
      x2: x + dx * length,
      y2: y + dy * length,
      dx,
      dy,
      length,
    });
    x += dx * length;
    y += dy * length;
  };

  const bend = (turn: number, radius: number): void => {
    if (Math.abs(turn) < 1e-12) return;
    const sign = Math.sign(turn);
    const cx = x - sign * dy * radius;
    const cy = y + sign * dx * radius;
    const phiStart = Math.atan2(y - cy, x - cx);
    arcs.push({
      index: arcs.length,
      name: `${config.name}.B${arcs.length + 1}`,
      cx,
      cy,
      radius,
      phiStart,
      dPhi: turn,
      // a = (q/γm)·(vy·Bz, −vx·Bz); a left turn needs Bz < 0
      fieldSign: -sign,
      length: Math.abs(turn) * radius,
      dipoles: Math.max(1, Math.round((Math.abs(turn) * radius) / 6.3)),
    });
    const phiEnd = phiStart + turn;
    x = cx + radius * Math.cos(phiEnd);
    y = cy + radius * Math.sin(phiEnd);
    const ndx = dx * Math.cos(turn) - dy * Math.sin(turn);
    const ndy = dx * Math.sin(turn) + dy * Math.cos(turn);
    dx = ndx;
    dy = ndy;
  };

  for (const s of solutions) {
    if ('turn' in s) {
      drift(s.drift0);
      bend(s.turn, s.radius);
      drift(s.drift1);
    } else {
      drift(s.drift0);
      bend(s.turn0, s.radius);
      drift(s.drift1);
      bend(s.turn1, s.radius);
    }
  }

  return finish(config, from, to, straights, arcs);
}

/**
 * A dump line: straight out of the ring, ending in an absorber.
 *
 * The LHC's is 700 m of drift from the kickers in IR6 to a graphite core in its own
 * cavern, and it is the only place the beam is ever allowed to stop on purpose.
 */
export function buildDumpLine(config: LineConfig, from: Pose, length: number): BeamLine {
  const to: Pose = {
    x: from.x + from.dx * length,
    y: from.y + from.dy * length,
    dx: from.dx,
    dy: from.dy,
  };
  return buildTransferLine(config, from, to);
}
