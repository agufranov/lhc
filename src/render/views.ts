/**
 * The named places the camera can be at, and what is going on in each of them.
 *
 * ## Why the camera moves at all
 *
 * The whole complex drawn at once is the picture this toy is about — two rings, four lines
 * and the beam actually flying between them — and it is also about 1700 px wide before it is
 * worth looking at. A phone has 390. So a view is not a decoration: it is the only way the
 * same picture works on a screen a quarter of the size, and the same mechanism earns its keep
 * on a desktop, because the injector is drawn a quarter of the collider's size and its
 * magnets are hard to click at that size.
 *
 * ## What a view is, and what it is not
 *
 * A view is **a box in world metres and nothing else.** It hides nothing, switches nothing,
 * and changes nothing that is simulated: every particle in `World` is stepped whether it is
 * on screen or not, which is what "one world" means (`docs/architecture.md`). A view whose
 * subject is empty is still worth going to — watching an empty SPS being filled is the point
 * of the SPS — which is why `viewActivity` reports what is happening there rather than a
 * reason to grey the tab out. **A camera position is never a control that would do nothing**,
 * so no view is ever blocked; see `docs/rendering.md`.
 *
 * Every box is **derived from the geometry that is actually built** — a ring's own bounds, a
 * line's own samples, an insertion's own half-length — padded by that object's own tunnel
 * wall (`structure.ts`). Nothing here is a hard-coded metre, so moving an experiment or
 * re-routing TI 8 moves its view with it.
 */

import type { Machine } from '../sim/machine';
import type { World } from '../sim/world';
import { DUMP_BLOCK_HALF_WIDTH_F, DUMP_BLOCK_LENGTH_F } from '../sim/world';
import { sampleLine } from '../sim/line';
import { INSERTION_HALF_LENGTH_F, INSERTION_RADIUS_F } from '../sim/detector';
import { FREE_FLIGHT } from '../sim/beam';
import type { Bounds } from './camera';
import { bore, tunnelPad } from './structure';

export type ViewId = 'complex' | 'sps' | 'ti' | 'lhc' | 'ip-a' | 'ip-b';

export interface View {
  id: ViewId;
  /** What the tab says. Short: a phone gives a tab about 64 px. */
  label: string;
  /** What the place is, for the tooltip and for anybody who has never seen the machine. */
  title: string;
}

/**
 * How much of a view's frame is context rather than subject.
 *
 * A ring framed on its own tunnel wall touches all four edges of the picture and reads as
 * something cut off. This is the room left round it as a fraction of the subject's own size —
 * small, so that zooming to the injector really does make the injector big.
 */
const VIEW_ROOM = 0.06;

/**
 * How much ring an experiment's view shows either side of its insertion.
 *
 * The insertion is `INSERTION_HALF_LENGTH_F` long in bore units and this frames three of it,
 * so the detector fills the middle third of the picture with the beam pipe running in and out
 * of it. Framed on the box alone the drawn detector is the whole window and there is nothing
 * to say what it is attached to.
 */
const IP_CONTEXT = 3;

/**
 * The views, in the order the machine is operated in.
 *
 * **There is no view of the dumps**, and that is measured rather than chosen: the two
 * absorbers stand at opposite corners of the picture, so a box round both of them is *wider*
 * than the whole complex — `check:render` printed 0.9×, a tab that zooms out. What it would
 * show is already on the overview at the same size, and the dump buttons never fold away
 * (`ui/controls.ts`), so nothing is out of reach for want of it.
 */
export function listViews(world: World): View[] {
  const injector = world.injector.ring.config.name;
  const collider = world.collider.ring.config.name;
  const [a, b] = world.detectors;
  return [
    {
      id: 'complex',
      label: 'complex',
      title: 'The whole machine: both rings, all four lines, and the beam between them.',
    },
    {
      id: 'sps',
      label: injector,
      title: `The injector: filled by the chain, ramped, and extracted into the ${collider}.`,
    },
    {
      id: 'ti',
      label: 'TI 2 · TI 8',
      title: `The transfer lines, one into each beam of the ${collider}.`,
    },
    { id: 'lhc', label: collider, title: 'The collider itself, both beams on one orbit.' },
    {
      id: 'ip-a',
      label: a.config.name,
      title: `${a.config.name} at ${a.config.point}: where the two beams are made to cross.`,
    },
    {
      id: 'ip-b',
      label: b.config.name,
      title: `${b.config.name} at ${b.config.point}: the other interaction point, half a ring away.`,
    },
  ];
}

/**
 * The box a view frames, in world metres.
 *
 * Cached per world, because none of it can move: a view is derived from the lattice, and the
 * lattice is built once. Without the cache the tab bar re-samples both transfer lines and
 * both dump lines every frame to decide whether to draw a dot on a tab.
 */
export function viewBounds(world: World, id: ViewId): Bounds {
  let byId = boundsCache.get(world);
  if (!byId) {
    byId = new Map();
    boundsCache.set(world, byId);
  }
  const hit = byId.get(id);
  if (hit) return hit;
  const box = computeBounds(world, id);
  byId.set(id, box);
  return box;
}

const boundsCache = new WeakMap<World, Map<ViewId, Bounds>>();

function computeBounds(world: World, id: ViewId): Bounds {
  switch (id) {
    case 'complex': {
      // Exactly what the camera was fitted to before there were views at all: everything,
      // padded by the widest tunnel so no wall is clipped off the edge of the window.
      const b = world.bounds;
      const pad = tunnelPad(world.collider.ring);
      return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    }
    case 'sps':
      return ringBounds(world.injector);
    case 'lhc':
      return ringBounds(world.collider);
    case 'ti':
      return lineBounds(world, (lineId) => lineId === 'ti2' || lineId === 'ti8');
    case 'ip-a':
    case 'ip-b':
      return insertionBounds(world, id === 'ip-a' ? 0 : 1);
  }
}

/**
 * What is happening at a view, for the mark on its tab.
 *
 * Deliberately **not** a reason to disable anything — see the note at the top of this file. It
 * answers the one question a tab bar hides the answer to, "is there anything to look at over
 * there": `beams` is how many macro-particles are inside the box, and `hot` is that place
 * doing the thing it exists for.
 */
export interface ViewActivity {
  /** Macro-particles currently inside the view's box. */
  beams: number;
  /** The place is doing its job: an insertion collecting collisions, an absorber being hit. */
  hot: boolean;
}

export function viewActivity(world: World, id: ViewId): ViewActivity {
  const box = viewBounds(world, id);
  const beam = world.beam;
  let beams = 0;
  let free = 0;
  for (let i = 0; i < beam.count; i++) {
    if (!beam.alive[i]) continue;
    const x = beam.x[i];
    const y = beam.y[i];
    if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) continue;
    beams++;
    if (beam.ring[i] === FREE_FLIGHT) free++;
  }

  let hot = false;
  if (id === 'ip-a' || id === 'ip-b') {
    hot = world.detectors[id === 'ip-a' ? 0 : 1].luminosity > 0;
  } else if (id === 'complex') {
    hot = world.detectors.some((d) => d.luminosity > 0);
  } else if (id === 'ti') {
    // A batch in a line is one no ring is holding: `FREE_FLIGHT` is the same test the pusher
    // makes. Inside a line's box that is a beam on its way somewhere, which is the whole of
    // what a transfer line ever has to show.
    hot = free > 0;
  }
  return { beams, hot };
}

function ringBounds(machine: Machine): Bounds {
  const ring = machine.ring;
  const pad = tunnelPad(ring);
  const b = ring.bounds;
  return grow(
    { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad },
    VIEW_ROOM,
  );
}

/**
 * The box round a set of lines: the pipe itself, and the absorber a dump line finishes in —
 * which is wider and longer than the pipe that feeds it, and is the part of a dump view worth
 * going to see.
 */
function lineBounds(world: World, wanted: (id: string) => boolean): Bounds {
  const box = empty();
  for (const e of world.extractions) {
    const line = e.line;
    if (!wanted(line.config.id)) continue;
    const a = line.config.apertureRadius;
    const pad = a * (1 + 0.18);
    for (const [x, y] of sampleLine(line, line.length / 128)) include(box, x, y, pad);
    const { x, y, dx, dy } = line.exit;
    const halfWidth = a * DUMP_BLOCK_HALF_WIDTH_F;
    const length = a * DUMP_BLOCK_LENGTH_F;
    for (const along of [0, length]) {
      for (const across of [-halfWidth, halfWidth]) {
        include(box, x + dx * along + dy * across, y + dy * along - dx * across, 0);
      }
    }
  }
  return grow(box, VIEW_ROOM);
}

/** The box round one experiment: the insertion, and enough ring either side to place it. */
function insertionBounds(world: World, index: number): Bounds {
  const detector = world.detectors[index];
  const ring = world.machines[detector.config.machine].ring;
  const a = bore(ring);
  const { x, y, dx, dy } = detector.ip;
  const along = a * INSERTION_HALF_LENGTH_F * IP_CONTEXT;
  const across = a * INSERTION_RADIUS_F * IP_CONTEXT;
  const box = empty();
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      include(box, x + dx * along * s + dy * across * t, y + dy * along * s - dx * across * t, 0);
    }
  }
  return box;
}

function empty(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function include(box: Bounds, x: number, y: number, pad: number): void {
  box.minX = Math.min(box.minX, x - pad);
  box.minY = Math.min(box.minY, y - pad);
  box.maxX = Math.max(box.maxX, x + pad);
  box.maxY = Math.max(box.maxY, y + pad);
}

/** Adds context round a box, as a fraction of its own size. */
function grow(box: Bounds, fraction: number): Bounds {
  const dx = (box.maxX - box.minX) * fraction;
  const dy = (box.maxY - box.minY) * fraction;
  return { minX: box.minX - dx, minY: box.minY - dy, maxX: box.maxX + dx, maxY: box.maxY + dy };
}
