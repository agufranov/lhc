/**
 * Field sampling.
 *
 * The whole magnetic model is: a flat table of annular field sectors + one signed
 * excitation per sector per aperture. Deliberately branch-light, allocation-free and
 * index-based so the exact same math can be pasted into a compute shader — FIELD_WGSL
 * below is that paste.
 *
 * Outside every sector B = 0 and the particle flies in a straight line.
 *
 * There is **one table for the whole complex**: the collider's arcs, the injector's arcs
 * and every dipole in every transfer line, in one array. A particle does not belong to a
 * ring — it is at a place, and it feels whatever is at that place. Before this was one
 * table per ring, and a bunch that left the injector by an unplanned route sailed
 * straight through the collider's magnets without noticing them.
 *
 * The excitation is carried in **tesla**, signed, not as a fraction: two rings running at
 * 8.09 T and 2.02 T share the table, so there is no one field strength to scale.
 *
 * Sectors are excited **per aperture**. `scales` is 2N long: the first N are the +1 bore,
 * the second N the −1 bore. A twin-bore dipole really does have two apertures with
 * opposite field — that is how one ring carries two beams going opposite ways — and
 * kickers really do act on one beam and not the other.
 *
 * Why this integrates over the step instead of sampling a point:
 * a hard in/out test quantises the bend of each arc to a whole step. One step is
 * ~4 mrad — an enormous kick by accelerator standards — and the error is systematic
 * (the particle always overshoots the magnet end), so the closed orbit spirals out and
 * the beam is lost within a few turns. Weighting B by the fraction of the step that
 * actually lies inside the sector removes the quantisation entirely: each arc bends by
 * ρ·Δφ worth of field no matter how coarse the stepping is.
 */

/** cx, cy, radius, phiStart, dPhi, halfWidth, owner */
export const FIELD_STRIDE = 7;

const TAU = Math.PI * 2;

/**
 * Step-averaged vertical field B_z seen while moving from (x, y) by (dx, dy).
 *
 * @param table  packed sectors: cx, cy, radius, phiStart, dPhi, halfWidth
 * @param scales 2N signed excitations [T]; sector k in bore b is at k + (b < 0 ? N : 0)
 * @param count  number of sectors in the table
 * @param base   0 for the +1 bore, `count` for the −1 bore
 * @param owner  the pipe the particle is currently in; a magnet only acts on the beam in
 *               its own aperture, which is what keeps a ring's fringe field out of the
 *               transfer line running alongside it
 */
export function integrateFieldZ(
  table: Float32Array,
  scales: Float32Array,
  count: number,
  base: number,
  owner: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
): number {
  let bz = 0;
  for (let k = 0; k < count; k++) {
    const tesla = scales[base + k];
    if (tesla === 0) continue;

    const o = k * FIELD_STRIDE;
    // A dipole bends what is inside it. The field region is an annulus hundreds of metres
    // wide — it has to be, to cover an aperture that is deliberately 3600× the real pipe —
    // and a transfer line arriving tangentially runs inside that annulus for the last
    // kilometre of its approach. Without this the collider's arc grabs the beam being
    // delivered to it and throws it into the wall before it can be injected.
    if (table[o + 6] !== owner) continue;
    const cx = table[o];
    const cy = table[o + 1];

    const r0x = x - cx;
    const r0y = y - cy;
    const r1x = r0x + dx;
    const r1y = r0y + dy;

    // radial gate on the mid-step radius; the orbit sits within millimetres of ρ,
    // so this is a coarse reject, not a physical aperture
    const mx = (r0x + r1x) * 0.5;
    const my = (r0y + r1y) * 0.5;
    const halfWidth = table[o + 5];
    const dr = Math.sqrt(mx * mx + my * my) - table[o + 2];
    if (dr < -halfWidth || dr > halfWidth) continue;

    // angular overlap of the step with the sector, as a fraction of the step
    const dPhi = table[o + 4];
    const delta = Math.atan2(r0x * r1y - r0y * r1x, r0x * r1x + r0y * r1y);
    let a0 = Math.atan2(r0y, r0x) - table[o + 3];
    a0 -= TAU * Math.round(a0 / TAU);
    const a1 = a0 + delta;

    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    const spanLo = Math.min(0, dPhi);
    const spanHi = Math.max(0, dPhi);
    const overlap = Math.min(hi, spanHi) - Math.max(lo, spanLo);
    if (overlap < 0) continue;

    const width = hi - lo;
    const frac = width > 1e-12 ? Math.min(overlap / width, 1) : 1;
    bz += tesla * frac;
  }
  return bz;
}

/**
 * WGSL twin of integrateFieldZ. Kept next to the TypeScript version on purpose:
 * if one changes, the other has to change in the same commit.
 */
export const FIELD_WGSL = /* wgsl */ `
const TAU: f32 = 6.28318530718;

// sectors: array<f32> packed as cx, cy, radius, phiStart, dPhi, halfWidth, owner
// scales:  array<f32>, 2N signed excitations in tesla; base selects the aperture
fn integrateFieldZ(p: vec2<f32>, step: vec2<f32>, count: u32, base: u32, owner: f32) -> f32 {
  var bz: f32 = 0.0;
  for (var k: u32 = 0u; k < count; k = k + 1u) {
    let tesla = scales[base + k];
    if (tesla == 0.0) { continue; }

    let o = k * 7u;
    if (sectors[o + 6u] != owner) { continue; }
    let r0 = p - vec2<f32>(sectors[o], sectors[o + 1u]);
    let r1 = r0 + step;

    let halfWidth = sectors[o + 5u];
    let dr = length((r0 + r1) * 0.5) - sectors[o + 2u];
    if (dr < -halfWidth || dr > halfWidth) { continue; }

    let dPhi = sectors[o + 4u];
    let delta = atan2(r0.x * r1.y - r0.y * r1.x, r0.x * r1.x + r0.y * r1.y);
    var a0 = atan2(r0.y, r0.x) - sectors[o + 3u];
    a0 = a0 - TAU * round(a0 / TAU);
    let a1 = a0 + delta;

    let lo = min(a0, a1);
    let hi = max(a0, a1);
    let overlap = min(hi, max(0.0, dPhi)) - max(lo, min(0.0, dPhi));
    if (overlap < 0.0) { continue; }

    let width = hi - lo;
    let frac = select(1.0, min(overlap / width, 1.0), width > 1e-12);
    bz = bz + tesla * frac;
  }
  return bz;
}
`;
