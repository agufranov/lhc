/**
 * The beam pipe.
 *
 * The lattice defines a closed orbit; this defines how far a particle may stray from it
 * before it is on the wall. Two things need that:
 *   · the pusher, which kills a particle whose transverse offset exceeds the aperture;
 *   · the renderer, which puts the wall damage on the side the beam actually hit.
 *
 * So this returns the full orbit frame — closest point on the closed orbit, the outward
 * normal there, and what the element belongs to — not just a distance.
 *
 * Like the field table there is **one of these for the whole complex**: both rings, both
 * transfer lines and both dump lines, in beam order but all in one array. A particle is
 * inside whichever pipe is nearest, wherever that pipe happens to lead. That is what
 * makes extraction, transfer and injection one continuous flight with no handover.
 *
 * Every element therefore carries its own aperture radius — the injector's pipe is a
 * quarter of the collider's — and says which machine it belongs to and which magnet
 * sector, if any, sits on it. The first is how a ring knows which particles its RF is
 * holding; the second is how a loss is traced to the circuit that has to quench.
 *
 * Same layout rules as field.ts: flat f32 table, fixed stride, no allocation, so the
 * GPU backend uploads it unchanged. APERTURE_WGSL is the shader-side twin.
 */

import type { Arc, Straight } from './lattice';

/** kind, 5 geometry floats, sense, radius, machine, sector, owner. */
export const APERTURE_STRIDE = 11;
/** straight: 0, x1, y1, dx, dy, length */
export const ELEMENT_STRAIGHT = 0;
/** arc: 1, cx, cy, phiStart, dPhi, radius */
export const ELEMENT_ARC = 1;
/** Element belongs to no ring — a transfer or dump line. */
export const NO_MACHINE = -1;
/** Element has no magnet on it. */
export const NO_SECTOR = -1;

const TAU = Math.PI * 2;

/** What an element is attached to, beyond its geometry. */
export interface ElementOwner {
  /** Aperture half-width at this element [m]. */
  radius: number;
  /**
   * Handedness of the element. It does two jobs, and they agree:
   *  · on a straight it is the outward-normal sign — nothing in the geometry of a line
   *    segment says which side the ring centre is on;
   *  · everywhere it turns the normal into the design direction of travel,
   *    `d = (−n.y, n.x)·sense`, which is what tells the pusher whether a particle is
   *    going with the beam or against it. On an arc that is sign(dPhi).
   */
  sense: number;
  /** Machine index, or NO_MACHINE. */
  machine: number;
  /** Index into the global field table, or NO_SECTOR. */
  sector: number;
  /**
   * Which pipe this is: machines and lines each get an id, and a magnet only bends the
   * beam whose element carries the same one. Two pipes can run through the same patch of
   * ground — a transfer line arrives tangentially and spends its last kilometre inside
   * the arc's field region — and only this says which of them the beam is in.
   */
  owner: number;
}

export function writeStraight(
  table: Float32Array,
  slot: number,
  s: Straight,
  owner: ElementOwner,
): void {
  const o = slot * APERTURE_STRIDE;
  table[o + 0] = ELEMENT_STRAIGHT;
  table[o + 1] = s.x1;
  table[o + 2] = s.y1;
  table[o + 3] = s.dx;
  table[o + 4] = s.dy;
  table[o + 5] = s.length;
  table[o + 6] = owner.sense;
  table[o + 7] = owner.radius;
  table[o + 8] = owner.machine;
  table[o + 9] = owner.sector;
  table[o + 10] = owner.owner;
}

export function writeArc(table: Float32Array, slot: number, a: Arc, owner: ElementOwner): void {
  const o = slot * APERTURE_STRIDE;
  table[o + 0] = ELEMENT_ARC;
  table[o + 1] = a.cx;
  table[o + 2] = a.cy;
  table[o + 3] = a.phiStart;
  table[o + 4] = a.dPhi;
  table[o + 5] = a.radius;
  // on an arc the design direction is the tangent, which runs the way the arc sweeps
  table[o + 6] = Math.sign(a.dPhi) || owner.sense;
  table[o + 7] = owner.radius;
  table[o + 8] = owner.machine;
  table[o + 9] = owner.sector;
  table[o + 10] = owner.owner;
}

/** Filled by projectToOrbit: closest point on the closed orbit + outward unit normal. */
export interface OrbitFrame {
  sx: number;
  sy: number;
  nx: number;
  ny: number;
  /**
   * Design direction of travel at the closest point.
   *
   * This is what decides which aperture of a twin-bore dipole a particle is in: one going
   * with it is in the bore whose field bends it inwards, one going against it is in the
   * other, where the field is reversed. That is the whole of how a single ring carries
   * two beams in opposite directions, and it needs no per-particle state at all.
   */
  tx: number;
  ty: number;
  /** Signed transverse offset [m]; positive points away from the ring centre. */
  offset: number;
  /** Index of the nearest element in the aperture table. */
  element: number;
  /** Aperture half-width there [m]. */
  radius: number;
  /** Machine that owns the nearest element, or NO_MACHINE. */
  machine: number;
  /** Field sector on the nearest element, or NO_SECTOR. */
  sector: number;
  /** Pipe the particle is in — see ElementOwner.owner. */
  owner: number;
}

export function makeOrbitFrame(): OrbitFrame {
  return {
    sx: 0,
    sy: 0,
    nx: 1,
    ny: 0,
    tx: 0,
    ty: 1,
    offset: 0,
    element: 0,
    radius: Infinity,
    machine: NO_MACHINE,
    sector: NO_SECTOR,
    owner: -1,
  };
}

/**
 * Projects onto element `k`. Returns the distance, and reports through `interior`
 * whether the foot of the perpendicular landed inside the element rather than being
 * clamped to one of its ends.
 */
function projectElement(
  table: Float32Array,
  k: number,
  x: number,
  y: number,
  out: OrbitFrame,
): { dist: number; interior: boolean } {
  const o = k * APERTURE_STRIDE;
  const sense = table[o + 6];
  let sx: number;
  let sy: number;
  let nx: number;
  let ny: number;
  let interior: boolean;

  if (table[o] === ELEMENT_STRAIGHT) {
    const ax = table[o + 1];
    const ay = table[o + 2];
    const dx = table[o + 3];
    const dy = table[o + 4];
    const length = table[o + 5];
    const s = (x - ax) * dx + (y - ay) * dy;
    interior = s >= 0 && s <= length;
    const cs = s < 0 ? 0 : s > length ? length : s;
    sx = ax + dx * cs;
    sy = ay + dy * cs;
    // the ring centre is to the left of travel when the beam turns left, so "outward"
    // is the right normal — and the mirror image when it turns right
    nx = dy * sense;
    ny = -dx * sense;
  } else {
    const cx = table[o + 1];
    const cy = table[o + 2];
    const phiStart = table[o + 3];
    const dPhi = table[o + 4];
    const radius = table[o + 5];
    let a = Math.atan2(y - cy, x - cx) - phiStart;
    a -= TAU * Math.round(a / TAU);
    const lo = dPhi < 0 ? dPhi : 0;
    const hi = dPhi < 0 ? 0 : dPhi;
    interior = a >= lo && a <= hi;
    const phi = phiStart + (a < lo ? lo : a > hi ? hi : a);
    nx = Math.cos(phi);
    ny = Math.sin(phi);
    sx = cx + radius * nx;
    sy = cy + radius * ny;
  }

  const ex = x - sx;
  const ey = y - sy;
  out.sx = sx;
  out.sy = sy;
  out.nx = nx;
  out.ny = ny;
  out.tx = -ny * sense;
  out.ty = nx * sense;
  out.offset = ex * nx + ey * ny;
  out.element = k;
  out.radius = table[o + 7];
  out.machine = table[o + 8];
  out.sector = table[o + 9];
  out.owner = table[o + 10];
  return { dist: Math.sqrt(ex * ex + ey * ey), interior };
}

/**
 * Projects (x, y) onto the closed orbit. Elements tile the machine without gaps, so the
 * element that actually contains the particle always wins the distance comparison and
 * the reported normal is the true transverse direction there.
 *
 * `hint` is the element the particle was in last step. A particle whose perpendicular
 * foot lands strictly inside an element is necessarily closest to that element — its
 * offset is millimetres against elements kilometres long — so the hint usually settles
 * this in one iteration instead of forty. That check dominates the push loop otherwise,
 * and it matters more now that the table holds the whole complex rather than one ring;
 * a GPU backend wants the same trick with a per-particle hint buffer.
 */
export function projectToOrbit(
  table: Float32Array,
  count: number,
  x: number,
  y: number,
  out: OrbitFrame,
  hint = -1,
): number {
  // The hint is only trusted well inside the hinted pipe. Elements used to tile one ring
  // with no gaps, so containment was unambiguous; the table now holds transfer and dump
  // lines that leave along tangents and overlap the arcs they leave from, and a particle
  // near a wall has to be checked against everything — otherwise a bunch on the closed
  // orbit can stay locked to the dump line it passed and be declared lost in it.
  if (hint >= 0 && hint < count) {
    const probe = projectElement(table, hint, x, y, out);
    if (probe.interior && Math.abs(out.offset) < out.radius * 0.25) return out.offset;
  }

  // Ranked by distance *as a fraction of the local aperture*, not by metres. Pipes of
  // different sizes overlap where a line joins a ring — TI 2 ends exactly on the
  // collider's injection point and runs along its straight — and the question being asked
  // is "which pipe is this particle inside", not "which axis is nearest". By metres, a
  // bunch circulating 30 m off the collider's closed orbit would be claimed by the
  // injector's 66 m line it happens to be passing, and lost in it.
  //
  // Where a line joins a ring the two run collinear and the scores tie, so the tie is
  // broken in favour of the ring. That is the septum: a bunch circulating past the dump
  // must stay in the ring's pipe, not be claimed by the line leaving beside it — and it
  // must take the *ring's* design direction, because the beam 2 dump line points the way
  // beam 2 travels, and a particle handed that direction goes into the forward bore and
  // is bent the wrong way out of the machine.
  //
  // Only on a tie. Preferring the ring whenever it still contains the particle at all
  // looks equivalent and is not: an extracted bunch stays inside the ring's pipe for the
  // first few hundred metres of the line, and would then be declared lost against the
  // ring's wall at the exact moment the line's pipe was holding it perfectly.
  const TIE = 1e-3;
  let bestScore = Infinity;
  let bestElement = -1;
  let ringScore = Infinity;
  let ringElement = -1;
  for (let k = 0; k < count; k++) {
    const { dist } = projectElement(table, k, x, y, out);
    const score = dist / out.radius;
    if (score < bestScore) {
      bestScore = score;
      bestElement = k;
    }
    if (out.machine !== NO_MACHINE && score < ringScore) {
      ringScore = score;
      ringElement = k;
    }
  }
  if (ringElement >= 0 && ringScore <= bestScore + TIE) bestElement = ringElement;
  // `out` currently holds the last element examined; recompute the winner
  if (bestElement >= 0) projectElement(table, bestElement, x, y, out);
  return out.offset;
}

/**
 * WGSL twin. The shader needs the offset *as a fraction of the local aperture* — with
 * one table covering pipes of different sizes there is no single radius to compare
 * against on the host side.
 */
export const APERTURE_WGSL = /* wgsl */ `
const TAU: f32 = 6.28318530718;

// elements: array<f32>, stride 10, kind 0 = straight, 1 = arc
fn apertureFraction(p: vec2<f32>, count: u32) -> f32 {
  var bestDist: f32 = 1e30;
  var bestFraction: f32 = 0.0;

  for (var k: u32 = 0u; k < count; k = k + 1u) {
    let o = k * 10u;
    var s: vec2<f32>;
    var n: vec2<f32>;

    if (elements[o] < 0.5) {
      let a = vec2<f32>(elements[o + 1u], elements[o + 2u]);
      let d = vec2<f32>(elements[o + 3u], elements[o + 4u]);
      let t = clamp(dot(p - a, d), 0.0, elements[o + 5u]);
      s = a + d * t;
      n = vec2<f32>(d.y, -d.x) * elements[o + 6u];
    } else {
      let c = vec2<f32>(elements[o + 1u], elements[o + 2u]);
      let phiStart = elements[o + 3u];
      let dPhi = elements[o + 4u];
      let radius = elements[o + 5u];
      var a = atan2(p.y - c.y, p.x - c.x) - phiStart;
      a = a - TAU * round(a / TAU);
      let phi = phiStart + clamp(a, min(0.0, dPhi), max(0.0, dPhi));
      n = vec2<f32>(cos(phi), sin(phi));
      s = c + radius * n;
    }

    let e = p - s;
    let radius = elements[o + 7u];
    let score = length(e) / radius;
    if (score < bestDist) {
      bestDist = score;
      bestFraction = dot(e, n) / radius;
    }
  }
  return bestFraction;
}
`;
