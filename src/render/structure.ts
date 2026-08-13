/**
 * The structural fractions everything on the picture is measured in, and the unit itself.
 *
 * They live in their own module because two files need them and neither may import the
 * other: `renderer.ts` draws with them, and `views.ts` frames the camera with them — a view
 * has to know how far a tunnel wall stands off the closed orbit, or the camera clips the
 * wall of the very thing the view is named after.
 *
 * **Everything structural is a multiple of the ring's own half-aperture**, never a length in
 * metres. On the collider these come out as the 45 m / 140 m / 210 m the renderer used to
 * hard-code; on the injector, a quarter of the size, they scale down with it. Add a constant
 * in metres and the SPS is drawn with LHC-sized walls. See `docs/rendering.md`.
 */

import type { Ring } from '../sim/lattice';

/** Tunnel wall thickness. 0.18 × 250 m = the 45 m the LHC was drawn with. */
export const WALL_F = 0.18;
/** Clearance between the tunnel wall and the magnet chain (140 m on the LHC). */
export const MAGNET_GAP_F = 0.56;
/** Width of a magnet body (210 m on the LHC). */
export const MAGNET_WIDTH_F = 0.84;

/** Half-aperture of a ring's pipe [m] — the unit everything structural is drawn in. */
export function bore(ring: Ring): number {
  return ring.config.apertureRadius;
}

/** How far the outside of the tunnel wall stands off the closed orbit [m]. */
export function tunnelPad(ring: Ring): number {
  return bore(ring) * (1 + WALL_F);
}
