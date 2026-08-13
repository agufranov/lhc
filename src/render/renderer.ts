/**
 * Canvas renderer.
 *
 * Draw order matters and is the whole trick to keeping the tunnel readable:
 *
 *   1. background, then the injector chain that feeds the complex
 *   2. per ring: power clouds, then the magnets themselves on top of their own glow — a
 *      separate chain inside the ring, set back from the tunnel, drawn as solid bodies
 *      (steel casing + a cold mass that takes the colour of the current) so a magnet is a
 *      visible object even with no current in it
 *   3. the experimental insertions, still *under* the tunnel so the beam pipe is painted
 *      through the middle of each of them
 *   4. the tunnel, drawn *over* the glow: hollow, walls of real thickness, its bore
 *      filled opaque so nothing leaks inside
 *   5. the transfer and dump lines, so their bores paint clean joints into the tunnels
 *      they connect
 *   6. the interaction region — the stretch of ring where the two beams are meeting
 *   7. wall damage — scars, channels, heat — then the showers, then the collisions
 *   8. the beams, inside the tunnels
 *
 * Nothing here is magnified. The pipe is drawn at the width the simulation actually
 * uses (see `apertureRadius`), so where the beam appears is where the integrator put
 * it — and a particle crossing a switched-off arc is drawn flying dead straight across
 * the tunnel until it reaches the wall, because that is exactly what it does.
 *
 * Everything structural is measured in units of the ring's own half-aperture rather than
 * in metres, so the SPS — a quarter of the size — is drawn a quarter of the size, walls
 * and magnets and all. On the LHC those fractions come out as the metres this file used
 * to hard-code.
 */

import type { Machine } from '../sim/machine';
import type { Extraction, InjectorChain, World } from '../sim/world';
import {
  DUMP_BLOCK_HALF_WIDTH_F,
  DUMP_BLOCK_LENGTH_F,
  INJECTOR_CYCLE,
  poseAtArclength,
} from '../sim/world';
import type { BeamLine } from '../sim/line';
import { sampleLine } from '../sim/line';
import { TRAIL_STRIDE } from '../sim/backend';
import type { Arc, Ring, Straight } from '../sim/lattice';
import type { DamageSite } from '../sim/damage';
import { DETECTOR_SHELLS, SEGMENT_STRIDE, SPECIES_COUNT } from '../sim/shower';
import { INSERTION_HALF_LENGTH_F, INSERTION_RADIUS_F } from '../sim/detector';
import type { MachineBands } from '../ui/layout';
import { CAMERA_MARGIN, LABEL_ROOM, OVERLAY_GAP, OVERLAY_PADDING, READOUT_COLUMN } from '../ui/layout';
import type { Borders, CameraFrame } from './camera';
import { Camera, easeInOut, frameFor, lerpFrame } from './camera';
import { MAGNET_GAP_F, MAGNET_WIDTH_F, WALL_F, bore } from './structure';
import type { ViewId } from './views';
import { viewBounds } from './views';
import {
  COLORS,
  MAGNET_CASING,
  MAGNET_CASING_DARK,
  SPECIES_STYLE,
  clamp01,
  heatColor,
  magnetColor,
  rgba,
} from './palette';

/**
 * Empty border the whole complex is fitted inside.
 *
 * It lives in `ui/layout.ts` with the panel widths, because those two numbers between them
 * decide whether an overlay panel is drawn on top of the collider — and nothing but the eye
 * relates them otherwise. `check:render` asserts the clearance.
 */
const MARGIN = CAMERA_MARGIN;
/** Tail decay constant [s] at low speed, and its cap as a fraction of one turn. */
const TAIL_TAU = 0.28;
const TAIL_MAX_TURNS = 0.4;
/** Circuit power that maps to a fully grown cloud [W]. */
const POWER_REFERENCE = 2.2e6;

// --- tunnel and magnet geometry ----------------------------------------------
// The fractions themselves are in `structure.ts`, because `views.ts` frames the camera with
// the same numbers and neither file may import the other.
const BLOCKS_PER_ARC = 22;

/**
 * Diagrammatic magnification of the damage channel. A 35 m channel is four pixels on
 * an 8 km ring; this stretches it to something you can see. The metres quoted in the
 * HUD are the real ones.
 */
const DAMAGE_SCALE = 24;
/**
 * Drawn width of a shower as a fraction of its drawn length.
 *
 * A hadronic cascade is a spike: metres long and a hand's breadth across, and more so the
 * harder the primary — `check` measures 3.06 m by 0.25 m at 450 GeV and 2.87 m by 0.03 m at
 * 6.8 TeV. Drawn at its own aspect it is a bright line and nothing about it reads as a
 * shower, and no single magnification suits both, so the aspect is standardised here and
 * the true metres stay in the model where `check` prints them. The angles *within* the
 * cascade, the branching and the species are physics and are not touched.
 */
const SHOWER_ASPECT = 0.32;
/**
 * Magnification of the cascade, along it. Bigger than `DAMAGE_SCALE`, on purpose.
 *
 * The channel is magnified 24× and no more because it is a hole bored *into* the wall and
 * has to stay inside the tunnel it is bored in — at 120× it would stick forty pixels out
 * through the far side of the cryostat. The shower is the opposite kind of thing: it is
 * precisely the part of the event that does not stay inside anything, the spray that goes
 * through the wall and into the cold mass, which is why a loss beside a magnet can quench
 * it. So it gets its own scale, chosen to make the branching legible: a 450 GeV batch draws
 * 24 px of cascade and a 6.8 TeV one 74 px, and the metres are in `check`.
 */
const SHOWER_SCALE = 180;
const IMPACT_FLASH = 1.6; // seconds
/** How long a kicker stays lit after a pulse [ms]. */
const KICKER_FLASH = 900;
/**
 * How much screen a name on the machine needs before it is worth drawing [px].
 *
 * The spacing between neighbouring labels round a ring, not the width of one: `S12` is about
 * 24 px of type and this is what keeps it from touching `P3` next to it. Below it the small
 * labels are not drawn at all — see `drawLabels`.
 *
 * **56 and not 34**, which is what it was first tried at, because a ring's labels are not the
 * only things standing round it: the kickers and the transfer lines put their own names in the
 * same annulus. At 34 the injector on the overview drew `S12` through `MKI · MSI`, and the
 * collider on a phone drew `P4` through `MKD · MSD`. At 56 the collider keeps all sixteen of
 * its names on any desktop and loses them on a phone, and the injector — a quarter of the size
 * — keeps its own only when you go and look at it. Which is the rule stated plainly: a machine
 * is named in detail when it is the thing being looked at.
 */
const LABEL_SPACING_MIN = 56;
/** Drawn length the injector chain needs before its two lines of type are worth writing [px]. */
const CHAIN_LABEL_MIN = 48;

/**
 * The experimental insertions, in units of the ring's half-aperture like everything else
 * structural — 475 m across and 550 m long on the collider.
 *
 * ATLAS is 25 m across and 46 m long, which on this picture is three pixels by six, so this
 * is a magnification and a large one. It is also the one place where a magnification cannot
 * be avoided by making the physics visible instead: the pipe is drawn 3600× wide precisely
 * so a beam's own motion reads, and a detector drawn to the same exaggeration would be
 * ninety kilometres. The true metres are printed by `check` and quoted in the HUD.
 *
 * The **aspect is standardised too**, the same way `SHOWER_ASPECT` is: a real experiment is
 * twice as long as it is wide, and at this size that draws as a sliver lying along the pipe.
 * What is *not* standardised is where the layers are — they come from `DETECTOR_SHELLS` in
 * `shower.ts`, which is also where the cascade stops treating matter as transparent and
 * where the transverse display bins its calorimeter cells. One list, three readers.
 *
 * The size itself comes from `detector.ts` for the same reason: it is the box a vertex may
 * be drawn in as well as the box drawn round it, and the simulation is the one that decides
 * where a collision happens.
 */
const DETECTOR_RADIUS_F = INSERTION_RADIUS_F;
const DETECTOR_HALF_LENGTH_F = INSERTION_HALF_LENGTH_F;
/** Fill and stroke of each shell, outermost first — muon, hadronic, EM, tracker. */
export const SHELL_COLORS: ReadonlyArray<readonly [string, string]> = [
  ['rgba(12, 18, 28, 0.96)', 'rgba(88, 118, 158, 0.35)'],
  ['rgba(30, 50, 70, 0.96)', 'rgba(118, 188, 235, 0.42)'],
  ['rgba(56, 44, 38, 0.96)', 'rgba(190, 140, 92, 0.4)'],
  ['rgba(40, 48, 70, 0.96)', 'rgba(118, 148, 200, 0.42)'],
];
/** Outer radius of each layer with its colours, outermost first, so each nests in the last. */
const DETECTOR_LAYERS: Array<[number, string, string]> = DETECTOR_SHELLS.map(
  (r, i) => [r, SHELL_COLORS[i][0], SHELL_COLORS[i][1]] as [number, string, string],
).reverse();
/** How long a collision event display stays on screen [s]. */
const EVENT_FLASH = 1.1;

/**
 * How far the picture moves at full shake [css px].
 *
 * Small on purpose. The overlay does not shake with it — it cannot, see `render` — so every
 * pixel of this is a pixel the machine may reach towards a panel, and the layout's own
 * tolerance for that is `OVERHANG_ALLOWED` = 40. Eight is loud enough to be alarming at 60 fps
 * and nowhere near enough to put an arc under a card.
 */
const SHAKE_PIXELS = 8;

/**
 * How hard the ground has to be moving before the picture goes red.
 *
 * Above what an `alarm` starts at (0.35) and below what a `catastrophe` starts at (1), so the
 * tint belongs to the catastrophe alone and fades out well before the shake does.
 */
const ALARM_TINT_SHAKE = 0.45;

/** Magnet under the pointer. */
export interface MagnetPick {
  machine: Machine;
  arc: number;
}

export class Renderer {
  readonly camera = new Camera();
  /** Cached free bands for the overlay; dropped whenever the camera moves. `machineBands`. */
  private bands: MachineBands | null = null;
  /** Magnet the pointer is over, for the click affordance. */
  hovered: MagnetPick | null = null;

  /** Where the camera is looking. See `views.ts`, and `setView` for how it gets there. */
  private viewId: ViewId = 'complex';
  /** A camera on its way from one view to another, or null when it has arrived. */
  private flight: Flight | null = null;
  /** A view asked for before the canvas had a size: applied by the next `resize`. */
  private pendingView = false;
  /** The view the current flight started from, for the bands at that end. */
  private previousView: ViewId = 'complex';
  /** A camera that is never drawn with: it measures what a frame *would* leave clear. */
  private scratch = new Camera();

  private ctx: CanvasRenderingContext2D;
  private beamCanvas: HTMLCanvasElement;
  private beamCtx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  /** The overlay furniture the last fit was made against. See `resize`. */
  private chromeTop = 0;
  private chromeBottom = 0;
  /** How wide the overlay's side columns are, which is what a zoomed view is fitted inside. */
  private chromeSides = 0;

  /** Last drawn point per particle, so each comet's tail joins up across frames. */
  private lastBeam = new Map<number, { x: number; y: number }>();
  /** Scratch: this frame's trail samples grouped by the particle that made them. */
  private grouped = new Map<number, number[]>();
  /** Scratch: how much of each batch is left, by particle id. See `updateBeamLayer`. */
  private intensity = new Map<number, number>();
  /** Wall seconds of shaking so far — the phase of the wobble, not a physical quantity. */
  private shakePhase = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.beamCanvas = document.createElement('canvas');
    const bctx = this.beamCanvas.getContext('2d');
    if (!bctx) throw new Error('2D canvas context unavailable');
    this.beamCtx = bctx;
  }

  /**
   * Sizes the canvas and puts the camera where the current view says, moving it if it is on
   * its way somewhere.
   *
   * `chrome` is how far down the title reaches and how far up the button bar does — measured
   * off the DOM by `main.ts`, because the bar wraps to two rows on a narrow window. It is
   * **not** decoration to fit inside: the machine's own labels are drawn outside its tunnel
   * wall, so a ring fitted to the whole window puts S67 and S78 behind the buttons, which is
   * exactly what it did. The border on a side is therefore whatever that side actually has
   * over it plus room for a label, and never less than `MARGIN`.
   *
   * `dtWall` is wall seconds since the last frame, and it is what a camera flight is timed
   * on — **not** `World.elapsed`. A camera is not part of the machine: it must move at the
   * same speed whether the simulation is paused, running at 200× or stopped by an incident.
   * Called with nothing, this is the plain refit it always was, which is what the headless
   * gates want.
   */
  resize(
    world: World,
    chrome: { top: number; bottom: number; sides?: number } = { top: 0, bottom: 0 },
    dtWall = 0,
  ): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    // How wide the overlay's side columns are. On a phone there are none — the readouts are
    // in a sheet along the bottom — and a zoomed view may then have the whole width.
    const sides = chrome.sides ?? OVERLAY_PADDING + READOUT_COLUMN + OVERLAY_GAP;
    const resized =
      w !== this.cssWidth ||
      h !== this.cssHeight ||
      dpr !== this.dpr ||
      chrome.top !== this.chromeTop ||
      chrome.bottom !== this.chromeBottom ||
      sides !== this.chromeSides;

    if (!resized && !this.flight && !this.pendingView) return;

    if (resized) {
      this.dpr = dpr;
      this.cssWidth = w;
      this.cssHeight = h;
      this.chromeTop = chrome.top;
      this.chromeBottom = chrome.bottom;
      this.chromeSides = sides;
      for (const c of [this.canvas, this.beamCanvas]) {
        c.width = Math.max(1, Math.round(w * dpr));
        c.height = Math.max(1, Math.round(h * dpr));
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.beamCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.beamCtx.clearRect(0, 0, w, h);
      this.lastBeam.clear();
      // A flight's two ends are frames, and a frame is only meaningful against the borders it
      // was fitted in. Rather than re-derive a half-finished one against a window that has
      // just changed under it, arrive: a camera that lands early while the window is being
      // dragged is not a bug, and a camera interpolating between two stale frames is.
      this.flight = null;
    }

    const borders = this.borders();
    if (this.pendingView) {
      this.pendingView = false;
      this.startFlight(world, borders);
    }

    if (this.flight) {
      this.flight.t = Math.min(1, this.flight.t + dtWall / VIEW_FLIGHT_SECONDS);
      const frame = lerpFrame(this.flight.from, this.flight.to, easeInOut(this.flight.t));
      this.camera.apply(frame, w, h, borders);
      // The comet's tail is drawn into its own canvas in **screen** pixels and kept across
      // frames, so a camera that moves leaves the whole of it behind at the wrong place —
      // the same smear `clearBeamTrail` exists to prevent when a bunch reappears somewhere
      // else. There is nowhere to move a screen-space trail to, so it is dropped every frame
      // of a flight and grows back when the camera lands.
      this.clearBeamTrail();
      if (this.flight.t >= 1) this.flight = null;
    } else {
      this.camera.apply(frameFor(viewBounds(world, this.viewId), w, h, borders), w, h, borders);
    }

    this.bands = null;
  }

  /** Which view the camera is at, or heading for. */
  get view(): ViewId {
    return this.viewId;
  }

  /** True while the camera is between two views. */
  get flying(): boolean {
    return this.flight !== null;
  }

  /**
   * Sends the camera to a view. The next `resize` starts it moving; `render` does the rest.
   *
   * Idempotent, because it is wired to a tab bar that says which view is current: pressing
   * the tab you are already at must not restart a flight you have already finished.
   */
  setView(id: ViewId): void {
    if (id === this.viewId) return;
    this.viewId = id;
    this.pendingView = true;
  }

  /**
   * The borders the machine is fitted inside, from the overlay furniture measured last.
   *
   * **The sides are not the same on every view, and that is what keeps the panels off the
   * machine.** On the overview the machine is height-limited and never reaches the rails, so
   * the sides are the plain margin and the cards are placed against the geometry — measured,
   * generous, and the layout this toy was tuned around. Zoom in on one machine and that stops
   * being true: the subject grows until it covers the whole window, rails and cards and all,
   * and no arithmetic about where a card goes can help, because there is nowhere left. So a
   * zoomed view is fitted **between the overlay's own columns**, which costs it nothing that
   * matters — every one of these views is height-limited too — and makes "no panel is drawn
   * over the machine" true by construction rather than by measurement.
   */
  private borders(): Borders {
    const side = this.viewId === 'complex' ? MARGIN : Math.max(MARGIN, this.chromeSides);
    return {
      left: side,
      right: side,
      top: Math.max(MARGIN, this.chromeTop + LABEL_ROOM),
      bottom: Math.max(MARGIN, this.chromeBottom + LABEL_ROOM),
    };
  }

  private startFlight(world: World, borders: Borders): void {
    const w = this.cssWidth;
    const h = this.cssHeight;
    const to = frameFor(viewBounds(world, this.viewId), w, h, borders);
    // Before the first fit there is nowhere to fly from: land.
    if (this.camera.scale <= 0 || w === 0 || h === 0) {
      this.camera.apply(to, w, h, borders);
      return;
    }
    // Described against the box it is about to fly in, not the one it arrived in: the two
    // differ whenever a flight crosses between the overview and a zoomed view, and a frame
    // read in the wrong box starts the flight with a sideways jump.
    const from = this.camera.frame(borders);
    const fromView = this.flight ? this.flight.toView : this.previousView;
    this.previousView = this.viewId;
    this.flight = {
      from,
      to,
      fromView,
      toView: this.viewId,
      t: 0,
      // **The overlay is derived from where the machine is, and during a flight it is in two
      // places.** Every card is placed against `machineBands`, so bands that followed the
      // camera would move a card every frame — and a card stands *beside* the machine, so one
      // that moves while the machine moves under it is one frame away from being drawn on top
      // of it, which is the one thing the layout may never do. So the flight gets one set of
      // bands for the whole of it, and the overlay moves exactly twice: when the flight starts
      // and when it lands.
      //
      // **The two ends are not enough to derive them from**, which is the trap here and is
      // what `check:render` was written to catch: a ring sweeps across the window as the
      // camera pans, and it can reach further right halfway through than it does at either
      // end. Measured at −61 px of clearance — a card over the injector's arc — when this was
      // the union of the endpoints alone. So the flight is sampled.
      bands: this.flightBands(world, from, to, fromView, borders),
    };
  }

  /**
   * The bands that are clear for **every moment** of a flight, sampled along it.
   *
   * Sampled and not solved: where a ring is on screen at time t is a linear pan under a
   * geometric zoom, and the largest screen x it reaches has no closed form worth having. Nine
   * samples of a 0.75 s flight is one every 90 ms, which is finer than the motion — and the
   * gate measures the real thing, every frame of a real flight, against the answer this gave.
   *
   * The endpoints are measured under their own view's rule; everything between them is
   * measured under the **strict** one, where every ring is an obstacle and the free strips are
   * the window's own halves. Mid-flight there is no "the injector defines the bands" to be
   * had: it is somewhere in the middle of a pan, and the only safe reading is that anything
   * on screen might be under a card.
   */
  private flightBands(
    world: World,
    from: CameraFrame,
    to: CameraFrame,
    fromView: ViewId,
    borders: Borders,
  ): MachineBands {
    let bands = this.bandsAt(world, from, fromView, borders);
    for (let i = 1; i <= FLIGHT_SAMPLES; i++) {
      const t = i / FLIGHT_SAMPLES;
      const frame = lerpFrame(from, to, easeInOut(t));
      // `STRICT_VIEW` is any view that is not the overview: what it selects is the rule, not
      // a place. The last sample is the destination, under its own rule.
      const view = i === FLIGHT_SAMPLES ? this.viewId : STRICT_VIEW;
      bands = unionBands(bands, this.bandsAt(world, frame, view, borders));
    }
    return bands;
  }

  /** The bands a given frame would leave, without moving the real camera. */
  private bandsAt(
    world: World,
    frame: CameraFrame,
    view: ViewId,
    borders: Borders,
  ): MachineBands {
    this.scratch.apply(frame, this.cssWidth, this.cssHeight, borders);
    return computeBands(world, this.scratch, view);
  }

  /**
   * Right-hand edge of the collider's tunnel wall [CSS px] — **what the overlay has to clear.**
   *
   * The panels are HTML over this canvas and nothing but this number relates the two. It is
   * here rather than in `ui/layout.ts` because it is a fact about the camera, and it is the
   * camera that changes with the window; the layout asks for it every frame and sizes the
   * experiments' column from what is left. See `eventCanvasSize`.
   */
  colliderRight(world: World): number {
    const ring = world.collider.ring;
    return this.camera.x(ring.bounds.maxX + bore(ring) * (1 + WALL_F));
  }

  /**
   * The **free bands** the overlay may put cards in, in CSS px. See `ui/layout.ts`.
   *
   * A single "the machine ends here" number is the collider's widest point, and using it
   * everywhere wastes the screen: at the height of the top corner the ring's arc has curved
   * hundreds of pixels back to the left, and above and below the injector there is a band
   * running the whole width of the window with nothing in it. That band is where the
   * experiments' cards go, so what the layout needs is not one edge but three: where the
   * injector's own band begins and ends, and how far right the machine reaches *above* it and
   * *below* it.
   *
   * While the camera is flying this is the union of the two ends — see `startFlight`.
   */
  machineBands(world: World): MachineBands {
    if (this.flight) return this.flight.bands;
    // Walking both closed orbits and four lines is not free, and none of it moves until the
    // camera does. `resize` drops this.
    if (this.bands) return this.bands;
    this.bands = computeBands(world, this.camera, this.viewId);
    return this.bands;
  }
  /** Drops one comet's tail, or every one of them. */
  clearBeamTrail(particle?: number): void {
    if (particle === undefined) {
      this.beamCtx.save();
      this.beamCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.beamCtx.clearRect(0, 0, this.beamCanvas.width, this.beamCanvas.height);
      this.beamCtx.restore();
      this.lastBeam.clear();
    } else {
      this.lastBeam.delete(particle);
    }
  }

  /** Arc index of `machine` under a point in CSS pixels, or -1. */
  pickMagnet(machine: Machine, cssX: number, cssY: number): number {
    const wx = this.camera.worldX(cssX);
    const wy = this.camera.worldY(cssY);
    const a = bore(machine.ring);
    const scale = Math.max(this.camera.scale, 1e-9);
    // The magnet body is only a few pixels wide on screen, so give the pointer a wider
    // band than the drawn one. The band can only grow *inwards*, though: outwards it runs
    // into the tunnel, and a click that lands on the beam pipe must not switch a magnet
    // off. Inwards there is nothing but the empty middle of the ring, which is what makes
    // the injector's magnets clickable at a quarter of the collider's size.
    const outward = Math.min(
      Math.max(a * MAGNET_WIDTH_F, 22 / scale),
      a * (MAGNET_WIDTH_F / 2 + MAGNET_GAP_F * 0.8),
    );
    const inward = Math.max(outward, 14 / scale);

    for (const arc of machine.ring.arcs) {
      const radius = magnetRadius(arc.radius, a);
      const dx = wx - arc.cx;
      const dy = wy - arc.cy;
      const offset = Math.hypot(dx, dy) - radius;
      if (offset > outward || offset < -inward) continue;

      let ang = Math.atan2(dy, dx) - arc.phiStart;
      ang -= Math.PI * 2 * Math.round(ang / (Math.PI * 2));
      const lo = Math.min(0, arc.dPhi);
      const hi = Math.max(0, arc.dPhi);
      if (ang >= lo && ang <= hi) return arc.index;
    }
    return -1;
  }

  /** The magnet under a point, in whichever ring owns it. */
  pick(world: World, cssX: number, cssY: number): MagnetPick | null {
    for (const machine of world.machines) {
      const arc = this.pickMagnet(machine, cssX, cssY);
      if (arc >= 0) return { machine, arc };
    }
    return null;
  }

  render(world: World, trail: Float32Array, trailCount: number, dtWall: number): void {
    this.drawBackground();

    // **The ground shakes.** Applied to the drawing and to nothing else: the camera is what
    // `machineBands` derives the overlay from, so shaking *that* would jitter every panel in
    // the window and could walk a card onto the machine — which is the one thing the layout
    // is not allowed to do. The background is painted before the translate, or the shake
    // would drag an unpainted edge across the picture.
    const shaking = world.shake > 0.002;
    if (shaking) {
      this.shakePhase += dtWall;
      const a = SHAKE_PIXELS * world.shake;
      const t = this.shakePhase;
      this.ctx.save();
      this.ctx.translate(
        a * Math.sin(t * 91.7) * Math.sin(t * 13.3),
        a * Math.sin(t * 77.3 + 1.7) * Math.sin(t * 17.9),
      );
    }

    this.drawChain(world);

    for (const machine of world.machines) {
      this.drawClouds(machine);
      this.drawMagnets(machine);
      // under the tunnel, so the pipe is painted through the middle of the detector
      this.drawDetectors(world, machine);
      this.drawTunnel(machine.ring);
    }

    this.drawLines(world);
    this.drawInteractionRegion(world);
    this.drawDamage(world);
    // after the channels and the heat, so the tracks read on top of what they did
    this.drawShowers(world);
    this.drawCollisions(world);

    const tau = Math.min(TAIL_TAU, TAIL_MAX_TURNS * world.secondsPerTurn);
    this.intensity.clear();
    for (let i = 0; i < world.beam.count; i++) {
      if (world.beam.alive[i]) this.intensity.set(world.beam.id[i], world.intensityOf(i));
    }
    this.updateBeamLayer(trail, trailCount, dtWall, tau);
    this.compositeBeam();
    this.drawBeamHeads(world);
    this.drawLabels(world);
    if (shaking) this.ctx.restore();
    this.drawAlarmTint(world);
  }

  /**
   * The tunnel lights going red.
   *
   * Keyed on the **shake** and nothing else, above a threshold only a catastrophe reaches:
   * an alarm shakes the picture by 0.35 and a catastrophe by 1, so this comes on for the one
   * and never for the other without needing to know which it was. It used to ask what the
   * banner was saying, and the banner had already moved on to the fill ending — so the loudest
   * thing in the machine's repertoire fired for two frames, on the wrong event, or not at all.
   *
   * Drawn *outside* the shake so the edges of the window stay covered.
   */
  private drawAlarmTint(world: World): void {
    if (world.shake <= ALARM_TINT_SHAKE) return;
    const { ctx } = this;
    const w = this.cssWidth;
    const h = this.cssHeight;
    const glow = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7);
    glow.addColorStop(0, 'rgba(255, 40, 30, 0)');
    glow.addColorStop(1, `rgba(255, 30, 24, ${(0.42 * world.shake).toFixed(3)})`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }

  // --- geometry helpers -----------------------------------------------------

  /**
   * Adds the closed orbit displaced by `offset` metres (positive = outwards) as a
   * subpath. Deliberately does NOT call beginPath: the band fills need two of these in
   * one path, and an even-odd fill of a single loop is a filled disc that swallows
   * everything inside the ring.
   */
  private traceOrbit(ctx: CanvasRenderingContext2D, ring: Ring, offset: number): void {
    const { camera } = this;
    const sense = ring.config.sense;
    let first = true;
    for (let k = 0; k < ring.straights.length; k++) {
      const s = ring.straights[k];
      // the ring centre is to the left of travel when the beam turns left, so the
      // outward normal is the right one — mirrored when it turns right
      const nx = s.dy * offset * sense;
      const ny = -s.dx * offset * sense;
      if (first) {
        ctx.moveTo(camera.x(s.x1 + nx), camera.y(s.y1 + ny));
        first = false;
      } else {
        ctx.lineTo(camera.x(s.x1 + nx), camera.y(s.y1 + ny));
      }
      ctx.lineTo(camera.x(s.x2 + nx), camera.y(s.y2 + ny));

      const a = ring.arcs[k];
      const radius = a.radius + offset;
      const samples = 40;
      for (let i = 1; i <= samples; i++) {
        const phi = a.phiStart + (a.dPhi * i) / samples;
        ctx.lineTo(camera.x(a.cx + radius * Math.cos(phi)), camera.y(a.cy + radius * Math.sin(phi)));
      }
    }
    ctx.closePath();
  }

  private strokeArc(
    cx: number,
    cy: number,
    radius: number,
    phiStart: number,
    dPhi: number,
    samples: number,
  ): void {
    const { ctx, camera } = this;
    ctx.beginPath();
    for (let i = 0; i <= samples; i++) {
      const phi = phiStart + (dPhi * i) / samples;
      const px = camera.x(cx + radius * Math.cos(phi));
      const py = camera.y(cy + radius * Math.sin(phi));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  /** Fills the rectangle swept by a straight element displaced ±`half` metres. */
  private fillAlong(s: Straight, half: number, style: string): void {
    const { ctx, camera } = this;
    const nx = s.dy * half;
    const ny = -s.dx * half;
    ctx.beginPath();
    ctx.moveTo(camera.x(s.x1 + nx), camera.y(s.y1 + ny));
    ctx.lineTo(camera.x(s.x2 + nx), camera.y(s.y2 + ny));
    ctx.lineTo(camera.x(s.x2 - nx), camera.y(s.y2 - ny));
    ctx.lineTo(camera.x(s.x1 - nx), camera.y(s.y1 - ny));
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  }

  /** Fills the annular band swept by an arc element displaced ±`half` metres. */
  private fillArcBand(a: Arc, half: number, style: string): void {
    const { ctx, camera } = this;
    const samples = 24;
    ctx.beginPath();
    for (let i = 0; i <= samples; i++) {
      const phi = a.phiStart + (a.dPhi * i) / samples;
      const r = a.radius + half;
      const px = camera.x(a.cx + r * Math.cos(phi));
      const py = camera.y(a.cy + r * Math.sin(phi));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let i = samples; i >= 0; i--) {
      const phi = a.phiStart + (a.dPhi * i) / samples;
      const r = a.radius - half;
      ctx.lineTo(camera.x(a.cx + r * Math.cos(phi)), camera.y(a.cy + r * Math.sin(phi)));
    }
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  }

  // --- layers ---------------------------------------------------------------

  private drawBackground(): void {
    const { ctx, cssWidth: w, cssHeight: h } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);

    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(24, 42, 78, 0.35)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private drawClouds(machine: Machine): void {
    const { ctx, camera } = this;
    const a = bore(machine.ring);
    ctx.globalCompositeOperation = 'lighter';

    for (const arc of machine.ring.arcs) {
      const circuit = machine.circuits[arc.index];
      const load = clamp01(circuit.load);
      // stored field halo + the bloom that only exists while power is flowing
      const draw = clamp01(Math.abs(circuit.power) / POWER_REFERENCE);
      const extracting = circuit.power < 0;
      const color = magnetColor(load);
      const radius = camera.len(a * 0.92) * (0.55 + 0.9 * load) + camera.len(a * 3.12) * draw;
      const alpha = 0.05 + 0.15 * load + 0.26 * draw;
      if (radius <= 0.5 || alpha <= 0.01) continue;

      const chainRadius = magnetRadius(arc.radius, a);
      const samples = 7;
      for (let i = 0; i < samples; i++) {
        const phi = arc.phiStart + (arc.dPhi * (i + 0.5)) / samples;
        const px = camera.x(arc.cx + chainRadius * Math.cos(phi));
        const py = camera.y(arc.cy + chainRadius * Math.sin(phi));
        const g = ctx.createRadialGradient(px, py, 0, px, py, radius);
        const core = extracting ? { r: 120, g: 200, b: 255 } : color;
        g.addColorStop(0, rgba(core, alpha));
        g.addColorStop(0.45, rgba(core, alpha * 0.35));
        g.addColorStop(1, rgba(core, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * The magnets themselves: a steel casing with the cold mass inside it. The casing is
   * always visible, so a switched-off sector reads as a dead object rather than as
   * nothing at all.
   */
  private drawMagnets(machine: Machine): void {
    const { ctx, camera } = this;
    const a = bore(machine.ring);
    const casingWidth = Math.max(4, camera.len(a * MAGNET_WIDTH_F));
    const coreWidth = casingWidth * 0.46;
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';

    for (const arc of machine.ring.arcs) {
      const circuit = machine.circuits[arc.index];
      const load = clamp01(circuit.load);
      const down = circuit.isDown;
      const live = circuit.enabled && !down;
      const radius = magnetRadius(arc.radius, a);
      const hovered = this.hovered?.machine === machine && this.hovered.arc === arc.index;

      const step = arc.dPhi / BLOCKS_PER_ARC;
      const gap = step * 0.2;

      // casing
      ctx.strokeStyle = rgba(live ? MAGNET_CASING : MAGNET_CASING_DARK, hovered ? 1 : 0.85);
      ctx.lineWidth = casingWidth;
      for (let b = 0; b < BLOCKS_PER_ARC; b++) {
        this.strokeArc(arc.cx, arc.cy, radius, arc.phiStart + step * b + gap / 2, step - gap, 6);
      }

      // cold mass: this is the part that takes the colour of the current
      ctx.strokeStyle = live ? rgba(magnetColor(load), 0.98) : 'rgba(22, 26, 34, 0.95)';
      ctx.lineWidth = coreWidth;
      for (let b = 0; b < BLOCKS_PER_ARC; b++) {
        this.strokeArc(arc.cx, arc.cy, radius, arc.phiStart + step * b + gap / 2, step - gap, 6);
      }

      // energised magnets bloom a little along their own body
      if (live && load > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(magnetColor(load), 0.1 + 0.3 * load);
        ctx.lineWidth = casingWidth * 1.5;
        this.strokeArc(arc.cx, arc.cy, radius, arc.phiStart, arc.dPhi, 40);
        ctx.globalCompositeOperation = 'source-over';
      }

      if (hovered) {
        ctx.strokeStyle = 'rgba(180, 220, 255, 0.85)';
        ctx.lineWidth = Math.max(1, camera.len(a * 0.056));
        this.strokeArc(arc.cx, arc.cy, radius + (a * MAGNET_WIDTH_F) / 2, arc.phiStart, arc.dPhi, 40);
        this.strokeArc(arc.cx, arc.cy, radius - (a * MAGNET_WIDTH_F) / 2, arc.phiStart, arc.dPhi, 40);
      }

      if (down) {
        // A quench is not a switch. The coil has gone normal, it is dumping its stored
        // energy into its own cold mass, and it stays that way until it has been cooled
        // back to 1.9 K — so it is drawn as something happening, not as something off.
        this.drawQuench(arc, radius, a, circuit.state, circuit.temperature);
      } else if (!circuit.enabled) {
        ctx.strokeStyle = 'rgba(255, 140, 60, 0.75)';
        ctx.lineWidth = Math.max(1, camera.len(a * 0.088));
        this.strokeArc(arc.cx, arc.cy, radius, arc.phiStart, arc.dPhi, 40);
      } else if (circuit.quenchProximity > 0.12) {
        // warm but still holding: the margin to the critical surface is being eaten
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255, 170, 60, ${0.15 + 0.5 * circuit.quenchProximity})`;
        ctx.lineWidth = Math.max(1, camera.len(a * 0.07));
        this.strokeArc(arc.cx, arc.cy, radius, arc.phiStart, arc.dPhi, 40);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  /**
   * A quenched sector: the coil is normal, dumping its stored energy into its own cold
   * mass, and the mass is glowing at whatever temperature it has reached. Recovering is
   * the same thing backwards, as the cryogenics pull it down to 1.9 K again.
   */
  private drawQuench(
    arc: Arc,
    radius: number,
    a: number,
    state: string,
    temperature: number,
  ): void {
    const { ctx, camera } = this;
    const recovering = state === 'recovering';
    const warm = clamp01((temperature - 1.9) / 60);

    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = recovering
      ? `rgba(120, 190, 255, ${0.5 + 0.3 * warm})`
      : `rgba(255, ${Math.round(70 + 90 * (1 - warm))}, 60, 0.92)`;
    ctx.lineWidth = Math.max(1, camera.len(a * 0.11));
    this.strokeArc(arc.cx, arc.cy, radius, arc.phiStart, arc.dPhi, 40);

    ctx.globalCompositeOperation = 'lighter';
    const samples = 6;
    for (let i = 0; i < samples; i++) {
      const phi = arc.phiStart + (arc.dPhi * (i + 0.5)) / samples;
      const px = camera.x(arc.cx + radius * Math.cos(phi));
      const py = camera.y(arc.cy + radius * Math.sin(phi));
      const r = Math.max(6, camera.len(a * (1.2 + 2.4 * warm)));
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      const core = recovering ? '120, 190, 255' : '255, 110, 60';
      g.addColorStop(0, `rgba(${core}, ${0.35 + 0.35 * warm})`);
      g.addColorStop(1, `rgba(${core}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawTunnel(ring: Ring): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'source-over';

    const a = bore(ring);
    const outer = a * (1 + WALL_F);

    // wall material: the band between the outer and inner shells, even-odd filled
    ctx.beginPath();
    this.traceOrbit(ctx, ring, outer);
    this.traceOrbit(ctx, ring, -outer);
    ctx.fillStyle = 'rgba(30, 45, 68, 0.96)';
    ctx.fill('evenodd');

    // the bore itself: opaque, so magnet glow never bleeds inside the pipe
    ctx.beginPath();
    this.traceOrbit(ctx, ring, a);
    this.traceOrbit(ctx, ring, -a);
    ctx.fillStyle = 'rgba(6, 9, 16, 0.97)';
    ctx.fill('evenodd');

    ctx.lineWidth = Math.max(0.7, this.camera.len(a * 0.032));
    ctx.strokeStyle = 'rgba(104, 148, 205, 0.55)';
    for (const d of [outer, -outer]) {
      ctx.beginPath();
      this.traceOrbit(ctx, ring, d);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(74, 110, 156, 0.4)';
    for (const d of [a, -a]) {
      ctx.beginPath();
      this.traceOrbit(ctx, ring, d);
      ctx.stroke();
    }
  }

  /**
   * Every line out of every machine: the two transfer lines into the collider and the two
   * dump lines out of it.
   *
   * Drawn after the tunnels so their bores close the joint at each end. A line's bend is a
   * real dipole on a real circuit — TI 8 cannot be a plain drift, because by the time it
   * is built both of its ends are already fixed — so it is drawn as magnets, and switching
   * one off strands the beam in the tunnel.
   *
   * The kicker markers are the only things in this picture standing for hardware the
   * simulation does not integrate a field for (see `World.publishFieldScales`), so they
   * are drawn as instrument boxes rather than as magnets.
   */
  private drawLines(world: World): void {
    const { ctx, camera } = this;
    const t = now();

    for (const e of world.extractions) {
      const line = e.line;
      const a = line.config.apertureRadius;

      ctx.globalCompositeOperation = 'source-over';
      for (const seg of line.straights) this.fillAlong(seg, a * (1 + WALL_F), 'rgba(30, 45, 68, 0.96)');
      for (const arc of line.arcs) this.fillArcBand(arc, a * (1 + WALL_F), 'rgba(30, 45, 68, 0.96)');
      for (const seg of line.straights) this.fillAlong(seg, a, 'rgba(6, 9, 16, 0.97)');
      for (const arc of line.arcs) this.fillArcBand(arc, a, 'rgba(6, 9, 16, 0.97)');

      // the line's own dipoles, sitting on the outside of its bend
      if (e.circuit) {
        const load = clamp01(e.circuit.load);
        for (const arc of line.arcs) {
          ctx.strokeStyle = e.circuit.enabled
            ? rgba(magnetColor(load), 0.95)
            : 'rgba(255, 140, 60, 0.85)';
          ctx.lineWidth = Math.max(2, camera.len(a * 0.7));
          this.strokeArc(arc.cx, arc.cy, arc.radius + a * 1.7, arc.phiStart, arc.dPhi, 24);
        }
      }

      if (line.isDump) this.drawDumpBlock(line);

      const heat = e.state === 'firing' ? 1 : clamp01(1 - (t - e.firedAt) / KICKER_FLASH);
      this.drawKicker(e, heat);
    }
  }

  /**
   * The kicker: short, on the closed orbit, and violet because nothing else is.
   *
   * It is drawn where it is in the lattice, at the length it has, so its shortness against
   * the septum behind it is the picture rather than a caption. Dark when spent, amber when
   * armed and waiting for a bunch, blazing for the microseconds it fires.
   */
  private drawKicker(e: Extraction, heat: number): void {
    const { ctx, camera } = this;
    const arc = e.kickerArc;
    if (!arc) return;
    const a = e.line.config.apertureRadius;
    const armed = e.state === 'armed';

    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt';
    ctx.strokeStyle =
      heat > 0.01
        ? `rgba(255, 170, 255, ${0.7 + 0.3 * heat})`
        : armed
          ? 'rgba(210, 120, 255, 0.95)'
          : 'rgba(120, 90, 150, 0.85)';
    ctx.lineWidth = Math.max(2.5, camera.len(a * 1.5));
    this.strokeArc(arc.cx, arc.cy, arc.radius, arc.phiStart, arc.dPhi, 8);

    if (heat <= 0.01 && !armed) return;
    // a pulse is microseconds; it should read as a flash, not as a lamp
    ctx.globalCompositeOperation = 'lighter';
    const phi = arc.phiStart + arc.dPhi / 2;
    const px = camera.x(arc.cx + arc.radius * Math.cos(phi));
    const py = camera.y(arc.cy + arc.radius * Math.sin(phi));
    const r = Math.max(8, camera.len(a * 6) * (0.35 + 0.65 * heat));
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    const k = armed && heat <= 0.01 ? 0.25 : heat;
    g.addColorStop(0, `rgba(255, 225, 255, ${0.85 * k})`);
    g.addColorStop(0.35, `rgba(220, 110, 255, ${0.45 * k})`);
    g.addColorStop(1, 'rgba(150, 40, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * The experimental insertions: a cavern, the detector inside it, and the vertex.
   *
   * Drawn **before the tunnel**, so the tunnel's opaque bore is painted over the middle of
   * it and the beam pipe reads as running through the detector rather than stopping at it.
   * That is also the truth of the thing: everything here is built around a pipe that does
   * not care it is there.
   *
   * Nested rectangles are the r–z section of nested cylinders, which is exactly the view
   * this simulation draws — the plane it works in contains the beam axis — so this is the
   * same projection an experiment puts on the wall, at the same orientation.
   */
  private drawDetectors(world: World, machine: Machine): void {
    const { ctx, camera } = this;
    const a = bore(machine.ring);
    const R = a * DETECTOR_RADIUS_F;
    const L = a * DETECTOR_HALF_LENGTH_F;
    ctx.globalCompositeOperation = 'source-over';

    for (const det of world.detectors) {
      if (world.machines[det.config.machine] !== machine) continue;
      const { x, y, dx, dy } = det.ip;

      const box = (halfWidth: number, halfLength: number): void => {
        const nx = dy * halfWidth;
        const ny = -dx * halfWidth;
        const ax = x - dx * halfLength;
        const ay = y - dy * halfLength;
        const bx = x + dx * halfLength;
        const by = y + dy * halfLength;
        ctx.beginPath();
        ctx.moveTo(camera.x(ax + nx), camera.y(ay + ny));
        ctx.lineTo(camera.x(bx + nx), camera.y(by + ny));
        ctx.lineTo(camera.x(bx - nx), camera.y(by - ny));
        ctx.lineTo(camera.x(ax - nx), camera.y(ay - ny));
        ctx.closePath();
      };

      // the cavern the thing was lowered into
      box(R * 1.14, L * 1.08);
      ctx.fillStyle = 'rgba(16, 22, 34, 0.98)';
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, camera.len(a * 0.05));
      ctx.strokeStyle = 'rgba(86, 116, 162, 0.38)';
      ctx.stroke();

      // the detector: muon system, hadronic calorimeter, electromagnetic calorimeter,
      // tracker — outermost first, so each is drawn inside the one before it
      for (const [f, fill, stroke] of DETECTOR_LAYERS) {
        box(R * f, L * f);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = Math.max(0.6, camera.len(a * 0.035));
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }

      // What the collisions are doing to the magnets around it. Collision debris sprays
      // kilowatts into a cold mass held at 1.9 K, and past the cryogenics' capacity there is
      // no equilibrium to settle at — so this is a warning that grows, not a state.
      const heat = det.thermalLoad;
      if (heat > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        box(R * 1.14, L * 1.08);
        ctx.fillStyle = det.quenched
          ? `rgba(255, 90, 60, ${(0.2 + 0.3 * heat).toFixed(3)})`
          : `rgba(255, 150, 60, ${(0.16 * heat).toFixed(3)})`;
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  /**
   * The interaction region: the stretches of ring the two beams are lying on top of each
   * other on **right now**, and the points their centres cross at.
   *
   * **This is the whole of the feedback for cogging**, and the reason it is drawn on the ring
   * rather than printed in the HUD. One macro-particle is 234 bunches over 1754 m, so two of
   * them passing each other interpenetrate over an interval that opens, grows to a batch
   * length and closes again — and while it is open a bunch of one beam is meeting a bunch of
   * the other at every point of it, evenly. So the band is drawn evenly and drawn where the
   * batches are (`World.overlaps`), which makes it a picture of the machine's state rather
   * than a diagram of it.
   *
   * That is also what a flash in an experiment now stands on. An earlier version drew one
   * band, at the crossing point nearest IP3, permanently: with a phased fill it sat on IP3
   * and never moved, while the events flashed alternately at IP3 and IP7 — the two crossings
   * per turn are half a ring apart and a pair reaches them half a turn apart. So an
   * experiment lit up with nothing drawn anywhere near it. There was beam there; the picture
   * simply was not showing it.
   *
   * The part inside an insertion is drawn **bright** and the rest dim. A meeting out in an
   * arc is nothing — the two beams are in separate bores there and pass straight through each
   * other — so the only part of this worth anything is the part lying inside a detector, and
   * that part is exactly where a vertex may be drawn (`Detector.halfLength`).
   */
  private drawInteractionRegion(world: World): void {
    const { ctx, camera } = this;
    const ring = world.collider.ring;
    const a = bore(ring);
    const insertion = a * DETECTOR_HALF_LENGTH_F;

    /** Is that point inside an experimental insertion — the only place a meeting counts? */
    const collected = (x: number, y: number): boolean => {
      for (const det of world.detectors) {
        const along = (x - det.ip.x) * det.ip.dx + (y - det.ip.y) * det.ip.dy;
        const across = -(x - det.ip.x) * det.ip.dy + (y - det.ip.y) * det.ip.dx;
        if (Math.abs(along) < insertion && Math.abs(across) < a * DETECTOR_RADIUS_F) return true;
      }
      return false;
    };

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';
    for (const region of world.overlaps) {
      // Sampled by length rather than by count, so a band that has only just opened is still
      // resolved and a full-length one does not cost forty strokes it has no use for.
      const samples = Math.max(4, Math.min(40, Math.round(region.half / 45)));
      for (let i = 0; i < samples; i++) {
        const u0 = -region.half + (2 * region.half * i) / samples;
        const u1 = -region.half + (2 * region.half * (i + 1)) / samples;
        const p0 = poseAtArclength(ring, region.s + u0);
        const p1 = poseAtArclength(ring, region.s + u1);
        const inside = collected((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
        // **Beam-coloured, and no wider than the beam is.** This used to be mint green and
        // `DETECTOR_RADIUS_F` wide, which is exactly the half-height of the drawn detector —
        // so what the eye got was a green slab filling the experiment's box, a colour nothing
        // else in the machine uses for a beam and a width that said "this volume is lit"
        // rather than "these two beams are lying on each other". It is two beams in one pipe,
        // so it is drawn as the beam is drawn and a little wider than one of them.
        ctx.strokeStyle = inside ? 'rgba(150, 225, 255, 0.62)' : 'rgba(80, 170, 215, 0.14)';
        ctx.lineWidth = Math.max(1, camera.len(a * (inside ? 0.95 : 0.7)));
        ctx.beginPath();
        ctx.moveTo(camera.x(p0.x), camera.y(p0.y));
        ctx.lineTo(camera.x(p1.x), camera.y(p1.y));
        ctx.stroke();
      }
    }

    // The crossing points themselves: where the batch *centres* meet. Thin ticks, because
    // they are landmarks for the operator and not places anything is collected — and there
    // are **two** of them, half a ring apart, because a crossing point is defined modulo C/2.
    // Both are real, both collect, and drawing only one is what made the far experiment look
    // like it was flashing for no reason. They stay put when the band is closed, which is
    // what cogging is aimed with.
    const crossing = world.crossingNearestIP();
    if (crossing) {
      const C = ring.config.circumference;
      ctx.strokeStyle = 'rgba(150, 200, 235, 0.6)';
      ctx.lineWidth = Math.max(1, camera.len(a * 0.1));
      for (const s of [crossing.s, crossing.s + C / 2]) {
        const c = poseAtArclength(ring, s);
        const nx = c.dy * a * 1.3;
        const ny = -c.dx * a * 1.3;
        ctx.beginPath();
        ctx.moveTo(camera.x(c.x + nx), camera.y(c.y + ny));
        ctx.lineTo(camera.x(c.x - nx), camera.y(c.y - ny));
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Collision events, drawn as the r–z display an experiment would put them on.
   *
   * Same segment buffer and same species colours as a wall shower, because it is the same
   * cascade code — what differs is that this one starts from seventy particles leaving a
   * point instead of one driving into copper, and that the first 42 % of the radius is
   * transparent, so the tracks read as tracks before anything sprays. The event is built in
   * units of the detector radius, so scaling it is one number.
   */
  private drawCollisions(world: World): void {
    const { ctx, camera } = this;
    if (world.collisions.length === 0) return;
    const t = now();
    const lines: number[][] = [];
    for (let s = 0; s < SPECIES_COUNT; s++) lines.push([]);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    // Shared with the transverse display in the experiment's own panel: one collision seen
    // from two places must be one set of colours. See `SPECIES_STYLE`.
    const style = SPECIES_STYLE;

    // **One batch per event, not one per species.**
    //
    // The fade is a property of an *event* — how long ago that collision was recorded — and
    // batching every event's segments together by species meant one alpha per species for
    // the whole picture, taken as the freshest. So a fresh event at one experiment relit the
    // fading one at the other: both are on screen at once for most of a fade (`EVENT_FLASH`
    // is forty times the pass that made it), and the far detector visibly flared every time
    // the near one flashed. Two experiments is at most a handful of events, so a loop over
    // them costs a few more strokes and gets each one its own age.
    for (const ev of world.collisions) {
      const age = clamp01(1 - (t - ev.at) / (EVENT_FLASH * 1000));
      if (age <= 0.01) continue;
      const machine = world.machines[world.detectors[ev.detector].config.machine];
      const scale = bore(machine.ring) * DETECTOR_RADIUS_F;
      const width = camera.len(scale * 0.012);
      const ux = ev.dx;
      const uy = ev.dy;
      const shower = ev.event;
      for (const pts of lines) pts.length = 0;

      for (let i = 0; i < shower.count; i++) {
        const o = i * SEGMENT_STRIDE;
        const species = shower.data[o + 4] | 0;
        const x0 = shower.data[o] * scale;
        const y0 = shower.data[o + 1] * scale;
        const x1 = shower.data[o + 2] * scale;
        const y1 = shower.data[o + 3] * scale;
        lines[species].push(
          camera.x(ev.x + ux * x0 - uy * y0),
          camera.y(ev.y + uy * x0 + ux * y0),
          camera.x(ev.x + ux * x1 - uy * y1),
          camera.y(ev.y + uy * x1 + ux * y1),
        );
      }

      for (let s = 0; s < SPECIES_COUNT; s++) {
        const pts = lines[s];
        if (pts.length === 0) continue;
        ctx.strokeStyle = `rgba(${style[s][0]}, ${(style[s][2] * age).toFixed(3)})`;
        ctx.lineWidth = Math.max(0.5, width * style[s][1]);
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 4) {
          ctx.moveTo(pts[i], pts[i + 1]);
          ctx.lineTo(pts[i + 2], pts[i + 3]);
        }
        ctx.stroke();
      }
    }

    // **No vertex glow.** There was one: a green radial gradient most of an aperture across,
    // painted over the interaction point on every event. It buried the thing it was supposed
    // to mark — the tracks *are* the vertex, they all start there — and because a pass draws
    // an event roughly every half second, what the eye actually saw of a running experiment
    // was a detector filling with green wash and the beam physics underneath it going dim.
    // The vertex is now exactly what it is in a real event display: the point every track
    // radiates from, and nothing drawn on top of it.
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * The septum is **not drawn**, on purpose.
   *
   * It used to be: a teal yoke standing off the closed orbit with its blade between, four of
   * them, one per extraction. They were curved bands lying alongside the ring at exactly the
   * radius the eye reads as "a magnet", and with four of them the picture was busy with
   * hardware that never does anything visible — the septum is DC, it never changes, and the
   * event the eye is here for is the kicker firing. So the kickers are the only extraction
   * hardware in the picture now, and being the only violet thing in it they read as the one
   * device that acts.
   *
   * Its **field is still there** and has to be: it is what cancels the ring's bend in the
   * extraction channel, and without it an extracted bunch simply follows the arc round and
   * never enters the transfer line. See `World.publishFieldScales`.
   */

  /**
   * The absorber a dump line ends in: a long core of graphite in its own cavern.
   *
   * Its size comes from `world.ts`, because `isDumpEnd` decides whether a beam landed in it
   * from the same two numbers. Drawn as a core inside a casing so that the beam boring into
   * it has something to bore into — the damage channel is drawn from the impact point along
   * the direction of travel, and at a full 6.8 TeV batch that channel is 35 m of the block's
   * length.
   */
  private drawDumpBlock(line: BeamLine): void {
    const { ctx, camera } = this;
    const a = line.config.apertureRadius;
    const { x, y, dx, dy } = line.exit;

    const face = (halfWidth: number, length: number, fill: string, stroke: string): void => {
      const nx = dy * halfWidth;
      const ny = -dx * halfWidth;
      const ex = x + dx * length;
      const ey = y + dy * length;
      ctx.beginPath();
      ctx.moveTo(camera.x(x + nx), camera.y(y + ny));
      ctx.lineTo(camera.x(ex + nx), camera.y(ey + ny));
      ctx.lineTo(camera.x(ex - nx), camera.y(ey - ny));
      ctx.lineTo(camera.x(x - nx), camera.y(y - ny));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, camera.len(a * 0.12));
      ctx.stroke();
    };

    ctx.globalCompositeOperation = 'source-over';
    // the cavern and its steel jacket
    face(
      a * DUMP_BLOCK_HALF_WIDTH_F,
      a * DUMP_BLOCK_LENGTH_F,
      'rgba(38, 34, 33, 0.98)',
      'rgba(150, 130, 110, 0.55)',
    );
    // the graphite core the beam is actually stopped in
    face(
      a * DUMP_BLOCK_HALF_WIDTH_F * 0.55,
      a * DUMP_BLOCK_LENGTH_F * 0.92,
      'rgba(24, 22, 22, 0.98)',
      'rgba(96, 86, 76, 0.5)',
    );
  }

  /**
   * The chain ahead of the injector: **one long tube**, running along the injection straight
   * and firing south-east into the ring.
   *
   * It was Linac4, the Booster and the PS as three separate objects at their real sizes, and
   * on a picture eleven kilometres across the two rings were a 100 m circle and a 25 m one —
   * dots too small to resolve, in the one place where something *long* would read. So they
   * are one run of accelerating structure now, 871 m of it, which is the honest sum of the
   * three machines it stands for. No beam is tracked in any of it: what comes out of the end
   * is a batch at the injector's flat-bottom energy, and the injector is the first machine
   * this simulation integrates.
   *
   * It brightens while the chain is running, and that is the only state it has.
   */
  private drawChain(world: World): void {
    const { ctx, camera } = this;
    const chain: InjectorChain = world.chain;
    const filling = world.fillRemaining > 0;
    // Holding for the injector to come back to flat bottom is a third state and worth
    // seeing: the button has been pressed and nothing is moving yet.
    const holding = filling && !world.injectorReadyForChain;
    const heat = filling ? (holding ? 0.5 : 1) : 0.25;

    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt';

    // the cryostat/tunnel it runs in, so the tube is an object and not a line
    ctx.strokeStyle = `rgba(96, 150, 210, ${(0.22 + 0.28 * heat).toFixed(3)})`;
    ctx.lineWidth = Math.max(2, camera.len(150));
    ctx.beginPath();
    ctx.moveTo(camera.x(chain.x1), camera.y(chain.y1));
    ctx.lineTo(camera.x(chain.x2), camera.y(chain.y2));
    ctx.stroke();

    // the accelerating structures themselves, drawn as the tank sections they are
    const sections = 14;
    ctx.strokeStyle = `rgba(150, 200, 245, ${(0.35 + 0.55 * heat).toFixed(3)})`;
    ctx.lineWidth = Math.max(2, camera.len(96));
    for (let i = 0; i < sections; i++) {
      const t0 = (i + 0.12) / sections;
      const t1 = (i + 0.88) / sections;
      ctx.beginPath();
      ctx.moveTo(
        camera.x(chain.x1 + (chain.x2 - chain.x1) * t0),
        camera.y(chain.y1 + (chain.y2 - chain.y1) * t0),
      );
      ctx.lineTo(
        camera.x(chain.x1 + (chain.x2 - chain.x1) * t1),
        camera.y(chain.y1 + (chain.y2 - chain.y1) * t1),
      );
      ctx.stroke();
    }

    if (!filling || holding) return;
    // a bunch running down it while the chain delivers: the one moving thing in the picture
    // that is not integrated, and it says so by being a glow rather than a comet
    ctx.globalCompositeOperation = 'lighter';
    const t = 1 - clamp01(world.fillRemaining / INJECTOR_CYCLE);
    const px = camera.x(chain.x1 + (chain.x2 - chain.x1) * t);
    const py = camera.y(chain.y1 + (chain.y2 - chain.y1) * t);
    const r = Math.max(6, camera.len(320));
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(190, 235, 255, 0.55)');
    g.addColorStop(1, 'rgba(60, 140, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Where the beam went into the wall: a channel driven along the direction of travel,
   * the material around it glowing at whatever temperature it is still at, and a scar
   * that stays after everything has cooled back to 1.9 K.
   *
   * A hit inside a dump absorber is drawn the same way, because it is the same physics —
   * the difference is only that somebody meant it to happen there.
   */
  private drawDamage(world: World): void {
    if (world.damage.length === 0) return;
    const { ctx, camera } = this;

    for (const site of world.damage) {
      const a = site.radius;
      const geom = this.damageGeometry(site, a);

      // permanent scar on the wall
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(12, 10, 12, 0.9)';
      ctx.lineWidth = Math.max(1.5, camera.len(a * 0.184));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(camera.x(geom.x0), camera.y(geom.y0));
      ctx.lineTo(camera.x(geom.x1), camera.y(geom.y1));
      ctx.stroke();

      const color = heatColor(site.temperature);
      const heat = clamp01((site.temperature - 300) / 3000);
      if (heat <= 0.005) continue;

      // the channel, incandescent along its length
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(color, 0.35 + 0.5 * heat);
      ctx.lineWidth = Math.max(1, camera.len(a * 0.12));
      ctx.beginPath();
      ctx.moveTo(camera.x(geom.x0), camera.y(geom.y0));
      ctx.lineTo(camera.x(geom.x1), camera.y(geom.y1));
      ctx.stroke();

      // heat spreading into the material around it
      const cloudRadius = camera.len(a * (0.56 + 1.68 * heat));
      const samples = 5;
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const px = camera.x(geom.x0 + (geom.x1 - geom.x0) * t);
        const py = camera.y(geom.y0 + (geom.y1 - geom.y0) * t);
        const r = cloudRadius * (1 - 0.45 * t);
        const alpha = (0.05 + 0.3 * heat) * (1 - 0.5 * t);
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, rgba(color, alpha));
        g.addColorStop(0.4, rgba(color, alpha * 0.4));
        g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // the flash of the hit itself
      const age = (world.machineClock - site.at) / world.options.opsTimeScale;
      if (age >= 0 && age < IMPACT_FLASH) {
        const k = 1 - age / IMPACT_FLASH;
        const px = camera.x(geom.x0);
        const py = camera.y(geom.y0);
        const r = 10 + 70 * (1 - k);
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(255, 250, 235, ${0.9 * k})`);
        g.addColorStop(0.3, `rgba(255, 165, 70, ${0.5 * k})`);
        g.addColorStop(1, 'rgba(255, 70, 30, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * The particle shower: the cascade `buildShower` made, drawn as the tree it is.
   *
   * The shape is physics and comes from `sim/shower.ts` — a branching cascade of hadrons,
   * electromagnetic bursts, neutrons and the odd muon, each species with its own reach.
   * What is chosen here is only how to look at it, and a shower is a spike, so:
   *
   *  · **along** the beam it is stretched by `SHOWER_SCALE`, which is larger than the
   *    channel's `DAMAGE_SCALE` on purpose — see that constant;
   *  · **across** it, enough to bring the drawn aspect to `SHOWER_ASPECT`, because a real
   *    cascade is a twelfth of its length wide at 450 GeV and a hundredth at 6.8 TeV, and
   *    no single magnification makes both of those legible.
   *
   * The angles, the branching and the species are untouched: only the two scales are ours.
   *
   * One path per species per site would be a stroke call per species per site; they are
   * collected across every site instead and stroked four times for the whole frame, because
   * 48 sites of 192 segments is nine thousand lines and the state changes cost more than the
   * lines do.
   */
  private drawShowers(world: World): void {
    const { ctx, camera } = this;
    // Screen-space endpoints per species, collected across every site and stroked once each.
    const lines: number[][] = [];
    const widths: number[] = [0, 0, 0, 0];
    for (let s = 0; s < SPECIES_COUNT; s++) lines.push([]);

    let drawn = 0;
    for (const site of world.damage) {
      const heat = clamp01((site.temperature - 300) / 3000);
      if (heat <= 0.005) continue;
      const shower = site.shower;
      if (!shower || shower.count === 0) continue;

      const geom = this.damageGeometry(site, site.radius);
      const along = (site.depth * SHOWER_SCALE) / shower.reach;
      const across =
        shower.spread > 1e-6
          ? (along * shower.reach * SHOWER_ASPECT) / shower.spread
          : along;
      const ux = site.dirX;
      const uy = site.dirY;

      for (let i = 0; i < shower.count; i++) {
        const o = i * SEGMENT_STRIDE;
        const species = shower.data[o + 4] | 0;
        const x0 = shower.data[o] * along;
        const y0 = shower.data[o + 1] * across;
        const x1 = shower.data[o + 2] * along;
        const y1 = shower.data[o + 3] * across;
        lines[species].push(
          camera.x(geom.x0 + ux * x0 - uy * y0),
          camera.y(geom.y0 + uy * x0 + ux * y0),
          camera.x(geom.x0 + ux * x1 - uy * y1),
          camera.y(geom.y0 + uy * x1 + ux * y1),
        );
        widths[species] = Math.max(widths[species], camera.len(site.radius * 0.02));
        drawn++;
      }
    }
    if (drawn === 0) return;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    // charged hadrons carry the cascade; the electromagnetic part is the bright short one;
    // neutrons run out into the tail; a muon leaves in a straight line and keeps going. A
    // cascade in a wall never makes the last three — they are collision species — but the
    // table has to cover every index the buffer can hold.
    const style: Array<[string, number]> = [
      ['rgba(255, 196, 104, 0.34)', 1],
      ['rgba(150, 214, 255, 0.5)', 0.7],
      ['rgba(196, 168, 255, 0.22)', 0.8],
      ['rgba(255, 120, 200, 0.4)', 0.5],
      ['rgba(140, 255, 190, 0.34)', 0.9],
      ['rgba(255, 140, 80, 0.4)', 1.1],
      ['rgba(255, 255, 235, 0.5)', 0.9],
    ];
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const pts = lines[s];
      if (pts.length === 0) continue;
      ctx.strokeStyle = style[s][0];
      ctx.lineWidth = Math.max(0.5, widths[s] * style[s][1]);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 4) {
        ctx.moveTo(pts[i], pts[i + 1]);
        ctx.lineTo(pts[i + 2], pts[i + 3]);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Entry point on the wall and where the channel ends. The channel runs along the
   * direction the particle was actually travelling when it hit, then burrows on through
   * the wall, further the deeper it goes.
   */
  private damageGeometry(site: DamageSite, a: number) {
    const dx = site.dirX;
    const dy = site.dirY;

    // Where the shower starts. A beam that drifted across the pipe hits the side wall, so
    // the entry is the orbit point pushed out by the aperture; a beam that ran into the
    // end of a dump stopped on the axis, and pushing *that* sideways drew the whole event
    // beside the absorber instead of inside it.
    const x0 = site.onPurpose ? site.px : site.sx + site.nx * a * site.side;
    const y0 = site.onPurpose ? site.py : site.sy + site.ny * a * site.side;

    const reach = site.depth * DAMAGE_SCALE;
    const burrow = Math.min(a * WALL_F * 2.2, reach * 0.25);
    return {
      x0,
      y0,
      x1: x0 + dx * reach + site.nx * site.side * burrow,
      y1: y0 + dy * reach + site.ny * site.side * burrow,
    };
  }

  /**
   * One trail buffer holds every beam in the complex, interleaved, so the samples are
   * grouped by the particle that made them before anything is drawn. Each comet keeps its
   * own continuity point: joining one particle's tail to another's would draw a bright
   * line straight across the picture.
   */
  private updateBeamLayer(
    trail: Float32Array,
    count: number,
    dtWall: number,
    tau: number,
  ): void {
    const { beamCtx: ctx, camera } = this;

    const fade = 1 - Math.exp(-Math.max(dtWall, 0) / Math.max(tau, 1e-3));
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0, 0, 0, ${fade})`;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    this.grouped.clear();
    for (let i = 0; i < count; i++) {
      const o = i * TRAIL_STRIDE;
      const id = trail[o + 5];
      let list = this.grouped.get(id);
      if (!list) {
        list = [];
        this.grouped.set(id, list);
      }
      list.push(trail[o], trail[o + 1]);
    }
    if (this.grouped.size === 0) {
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [id, points] of this.grouped) {
      const last = this.lastBeam.get(id);
      // **How much of the batch is left, drawn.**
      //
      // Collisions consume the beam and nothing else in this model does — two protons leave
      // per inelastic interaction — so a fill that has been running is a fill with fewer
      // protons in it. The one thing that must not be implied is that they are *slower* or
      // *softer*: the RF holds the energy, and what a burnt-down beam has lost is population
      // and nothing else. So intensity moves the comet's width and its brightness, which is
      // what a beam-current transformer would show, and touches neither its colour
      // temperature nor its speed.
      //
      // Floored well above zero, because a beam that has burned down to a tenth is still a
      // beam and still has to be visible on the ring — the number is in the HUD, this is the
      // shape of it.
      const f = this.intensity.get(id) ?? 1;
      const w = 0.34 + 0.66 * f;
      const a = 0.42 + 0.58 * f;
      // wide soft core + thin bright filament: reads as a comet, not as a wire
      for (const [width, color, alpha] of [
        [5.5, '40, 120, 200', 0.3],
        [2.4, '90, 220, 255', 0.65],
        [1.1, '235, 252, 255', 0.95],
      ] as const) {
        ctx.beginPath();
        if (last) ctx.moveTo(camera.x(last.x), camera.y(last.y));
        else ctx.moveTo(camera.x(points[0]), camera.y(points[1]));
        for (let i = 0; i < points.length; i += 2) {
          ctx.lineTo(camera.x(points[i]), camera.y(points[i + 1]));
        }
        ctx.lineWidth = width * w;
        ctx.strokeStyle = `rgba(${color}, ${(alpha * a).toFixed(3)})`;
        ctx.stroke();
      }
      this.lastBeam.set(id, {
        x: points[points.length - 2],
        y: points[points.length - 1],
      });
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private compositeBeam(): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.beamCanvas, 0, 0, this.cssWidth, this.cssHeight);
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawBeamHeads(world: World): void {
    const { ctx, camera } = this;
    const { beam } = world;

    for (let i = 0; i < beam.count; i++) {
      if (!beam.alive[i]) continue;
      const px = camera.x(beam.x[i]);
      const py = camera.y(beam.y[i]);
      // The head carries the same intensity as the tail — a burnt-down batch is dimmer all
      // the way along, not a faint tail behind a full-brightness head.
      const f = world.intensityOf(i);
      const r = 26 * (0.5 + 0.5 * f);

      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(255, 255, 255, ${(0.35 + 0.6 * f).toFixed(3)})`);
      g.addColorStop(0.25, `rgba(140, 230, 255, ${(0.2 + 0.35 * f).toFixed(3)})`);
      g.addColorStop(1, 'rgba(60, 160, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = COLORS.beamHead;
      ctx.beginPath();
      ctx.arc(px, py, 1.2 + 0.9 * f, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Names on the machine, and **only where there is room to read them**.
   *
   * Sixteen labels go round a ring — eight arcs and eight points — and how much screen each
   * gets is the ring's drawn circumference divided between them. On a 390 px phone the whole
   * complex puts that at 20 px a label and the picture is a wreath of overlapping type; on a
   * desktop it is 150 px and they are the thing that makes the picture a diagram. So the small
   * labels are drawn when their spacing clears `LABEL_SPACING_MIN` and not otherwise, which is
   * the same rule for a small window as for a camera zoomed out — one test, no modes.
   *
   * What is never dropped: the name of each ring, and the experiments. Those two identify what
   * is on screen, there are four of them altogether, and a picture with nothing named on it is
   * not a diagram of anything.
   */
  private drawLabels(world: World): void {
    const { ctx, camera } = this;
    /** Screen px between neighbouring labels round a ring. */
    const spacing = (ring: Ring): number => {
      const radius = (ring.bounds.maxX - ring.bounds.minX) / 2;
      const count = Math.max(ring.arcs.length + ring.straights.length, 1);
      return (2 * Math.PI * camera.len(radius)) / count;
    };
    /**
     * Room for the small labels attached to a machine — its kickers, and the chain feeding it.
     *
     * **Asked of the machine the label is attached to**, which is the whole of the fix: the
     * first version took the larger of the two rings, so a camera looking at the collider drew
     * `LINAC4 · PSB · PS`, `MKI · MSI` and `TI 2` on top of each other around an injector 40 px
     * across, which is precisely the pile-up the threshold exists to prevent.
     */
    const roomAt = (machine: number): boolean =>
      spacing(world.machines[machine].ring) >= LABEL_SPACING_MIN;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const machine of world.machines) {
      const { ring } = machine;
      const cx = (ring.bounds.minX + ring.bounds.maxX) / 2;
      const cy = (ring.bounds.minY + ring.bounds.maxY) / 2;

      const room = spacing(ring) >= LABEL_SPACING_MIN;
      for (const arc of ring.arcs) {
        // A quenched or switched-off sector says so whatever the scale: it is not a name, it
        // is the machine reporting a fault, and a fault nobody can see is a fault nobody fixes.
        const circuit = machine.circuits[arc.index];
        const faulted =
          !circuit.enabled ||
          circuit.state === 'quenching' ||
          circuit.state === 'quenched' ||
          circuit.state === 'recovering';
        if (!room && !faulted) continue;
        const phi = arc.phiStart + arc.dPhi / 2;
        const wx = arc.cx + arc.radius * Math.cos(phi);
        const wy = arc.cy + arc.radius * Math.sin(phi);
        const [lx, ly] = pushOut(wx, wy, cx, cy, 40 / camera.scale);
        const load = clamp01(circuit.load);
        let text = arc.name;
        let style = rgba(magnetColor(load), 0.55 + 0.45 * load);
        if (circuit.state === 'quenching' || circuit.state === 'quenched') {
          text = `${arc.name} QUENCH`;
          style = 'rgba(255, 90, 70, 0.95)';
        } else if (circuit.state === 'recovering') {
          text = `${arc.name} cooling`;
          style = 'rgba(130, 190, 255, 0.9)';
        } else if (!circuit.enabled) {
          text = `${arc.name} off`;
          style = 'rgba(255, 150, 80, 0.9)';
        }
        ctx.fillStyle = style;
        ctx.fillText(text, camera.x(lx), camera.y(ly));
      }

      ctx.fillStyle = COLORS.label;
      for (const s of room ? ring.straights : []) {
        const wx = (s.x1 + s.x2) / 2;
        const wy = (s.y1 + s.y2) / 2;
        const [lx, ly] = pushOut(wx, wy, cx, cy, 34 / camera.scale);
        ctx.fillText(`P${s.index + 1}`, camera.x(lx), camera.y(ly));
      }

      for (const det of world.detectors) {
        if (world.machines[det.config.machine] !== machine) continue;
        const a = bore(machine.ring);
        const colliding = det.collidingPairs > 0;
        ctx.fillStyle = colliding ? 'rgba(160, 225, 255, 0.95)' : 'rgba(130, 165, 205, 0.75)';
        ctx.fillText(
          det.config.name,
          camera.x(det.ip.x + det.ip.dy * a * DETECTOR_RADIUS_F * 1.5),
          camera.y(det.ip.y - det.ip.dx * a * DETECTOR_RADIUS_F * 1.5),
        );
      }

      // the ring's own name, in the middle of it
      ctx.fillStyle = 'rgba(150, 190, 235, 0.5)';
      ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(ring.config.name, camera.x(cx), camera.y(cy));
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    }

    for (const e of world.extractions) {
      const line = e.line;
      const a = line.config.apertureRadius;
      const mid = line.straights[Math.floor(line.straights.length / 2)] ?? null;
      if (mid) {
        const mx = (mid.x1 + mid.x2) / 2;
        const my = (mid.y1 + mid.y2) / 2;
        ctx.fillStyle = line.isDump ? 'rgba(230, 170, 130, 0.85)' : 'rgba(140, 185, 230, 0.85)';
        ctx.fillText(line.config.name, camera.x(mx + mid.dy * a * 3), camera.y(my - mid.dx * a * 3));
      }
      ctx.fillStyle = COLORS.label;
      if (roomAt(line.config.fromMachine))
        ctx.fillText(
        line.isDump ? 'MKD · MSD' : 'MKI · MSI',
        camera.x(line.entry.x - line.entry.dx * a * 4 + line.entry.dy * a * 4),
        camera.y(line.entry.y - line.entry.dy * a * 4 - line.entry.dx * a * 4),
      );
      if (line.isDump) {
        ctx.fillStyle = 'rgba(210, 180, 150, 0.85)';
        ctx.fillText(
          'TDE',
          camera.x(line.exit.x + line.exit.dx * a * 5),
          camera.y(line.exit.y + line.exit.dy * a * 5),
        );
      }
    }

    // The chain gets its own test rather than the injector's, because it is not a label in a
    // ring's annulus competing with fifteen others — it is two lines of type in open space
    // beside a drawn tube, and what decides whether to write them is whether that tube is
    // long enough on screen to be worth naming. 65 px on a desktop overview, 13 on a phone.
    const { chain } = world;
    if (camera.len(Math.hypot(chain.x2 - chain.x1, chain.y2 - chain.y1)) < CHAIN_LABEL_MIN) return;
    ctx.fillStyle = COLORS.label;
    const cmx = camera.x((chain.x1 + chain.x2) / 2);
    const cmy = camera.y((chain.y1 + chain.y2) / 2);
    ctx.fillText(chain.name, cmx, cmy - 16);
    ctx.fillText(chain.note, cmx, cmy - 4);
  }
}

/** Radius of the magnet chain of an arc: inside the ring, clear of the tunnel. */
function magnetRadius(arcRadius: number, aperture: number): number {
  return arcRadius - aperture * (1 + WALL_F + MAGNET_GAP_F + MAGNET_WIDTH_F / 2);
}

function pushOut(x: number, y: number, cx: number, cy: number, distance: number): [number, number] {
  const dx = x - cx;
  const dy = y - cy;
  const len = Math.hypot(dx, dy) || 1;
  return [x + (dx / len) * distance, y + (dy / len) * distance];
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** How long the camera takes to move between two views [wall seconds]. */
const VIEW_FLIGHT_SECONDS = 0.75;
/** How many points along a flight the overlay's bands are measured at. See `flightBands`. */
const FLIGHT_SAMPLES = 8;
/**
 * The view whose *rule* is used for the middle of a flight: any view but the overview.
 *
 * `computeBands` asks one question of a view — is the injector defining the free strips, or is
 * it just another obstacle — and halfway through a pan the answer has to be the second one.
 */
const STRICT_VIEW: ViewId = 'lhc';

/** A camera between two views. Both ends are fixed for the whole of it. */
interface Flight {
  from: CameraFrame;
  to: CameraFrame;
  fromView: ViewId;
  toView: ViewId;
  /** 0 at the start, 1 on arrival. Advanced by wall time, not by the machine clock. */
  t: number;
  /** The overlay's bands for the whole flight: the union of both ends. See `startFlight`. */
  bands: MachineBands;
}

/**
 * The free bands a camera leaves, measured off the geometry that is actually drawn.
 *
 * A free function rather than a method because it is asked about **three** cameras: the real
 * one, and the two ends of a flight. See `Renderer.machineBands`.
 *
 * Measured off the closed orbit of both rings and every transfer and dump line, each padded
 * by its own tunnel wall, because a band computed from bounding boxes would hand the layout
 * space that TI 8 is lying across.
 */
function computeBands(world: World, camera: Camera, view: ViewId): MachineBands {
  const injector = world.injector.ring;
  const injectorPad = camera.len(bore(injector) * (1 + WALL_F));
  // Screen y runs the other way from world y: the ring's highest point is its smallest y.
  const rawTop = camera.y(injector.bounds.maxY) - injectorPad;
  const rawBottom = camera.y(injector.bounds.minY) + injectorPad;

  /**
   * **The injector defines the bands only while it is in the picture.**
   *
   * On the complex view it is what makes them: the strips above and below it run the whole
   * width of the window with nothing in them, which is where the cards go, and the injector
   * itself is therefore not an obstacle — a card is never placed in its own band's middle.
   * Zoom to a single machine and neither half of that is true any more. The injector may be
   * a thousand pixels off the top of the window, and a band running from 0 to −1000 px is
   * not a band; and whatever is on screen *is* an obstacle, including the injector, because
   * now it is the thing being looked at rather than the thing the cards stand beside.
   *
   * So: on `complex`, the injector splits the window and is excluded. Anywhere else, the
   * window's own halves are the strips and every ring counts.
   */
  const defining = view === 'complex' && rawBottom > 0 && rawTop < camera.height;
  const half = camera.height / 2;
  const injectorTop = defining ? rawTop : half;
  const injectorBottom = defining ? rawBottom : half;

  // Every drawn point as [right edge, top, bottom] in screen px, so asking "how far right
  // does the machine reach between these two heights" is one scan.
  //
  // Two sets, because the two are not worth the same screen. A **ring** is the thing being
  // looked at and a card over it is a card over the machine. A **transfer line** is a thin
  // pipe crossing a corner — TI 8 cuts through the top of the band below the injector on
  // its way in — and holding a whole card's width off the screen for it costs the readouts
  // beside it far more than the line loses. So the cards are placed against the rings and
  // the lines are reported, not obeyed.
  const rings: number[] = [];
  const lines: number[] = [];
  const into = (target: number[]) => (x: number, y: number, pad: number) => {
    const halfPad = camera.len(pad);
    const sy = camera.y(y);
    target.push(camera.x(x) + halfPad, sy - halfPad, sy + halfPad);
  };
  const consider = into(lines);
  const considerRing = into(rings);

  for (const machine of world.machines) {
    if (defining && machine === world.injector) continue;
    const ring = machine.ring;
    const pad = bore(ring) * (1 + WALL_F);
    const C = ring.config.circumference;
    const steps = 720;
    for (let i = 0; i < steps; i++) {
      const p = poseAtArclength(ring, (C * i) / steps);
      considerRing(p.x, p.y, pad);
    }
  }
  for (const e of world.extractions) {
    const line = e.line;
    const a = line.config.apertureRadius;
    const pad = a * (1 + WALL_F);
    for (const [x, y] of sampleLine(line, line.length / 64)) consider(x, y, pad);
    // The absorber a dump line ends in is wider and longer than the pipe that feeds it.
    const { x, y, dx, dy } = line.exit;
    const halfWidth = a * DUMP_BLOCK_HALF_WIDTH_F;
    const length = a * DUMP_BLOCK_LENGTH_F;
    for (const along of [0, length]) {
      for (const across of [-halfWidth, halfWidth]) {
        consider(x + dx * along + dy * across, y + dy * along - dx * across, 0);
      }
    }
  }

  const rightIn = (points: number[], top: number, bottom: number): number => {
    let right = 0;
    for (let i = 0; i < points.length; i += 3) {
      if (points[i + 2] > top && points[i + 1] < bottom) right = Math.max(right, points[i]);
    }
    return right;
  };

  return {
    injectorTop,
    injectorBottom,
    rightIn: (top, bottom) => rightIn(rings, top, bottom),
    linesRightIn: (top, bottom) => rightIn(lines, top, bottom),
  };
}

/**
 * The bands that are free at both ends of a flight, and therefore free throughout it.
 *
 * Conservative on purpose, in both senses: the injector's strip is the union of where it is
 * at each end (so the free strips are the *smaller* of the two), and the machine's right edge
 * is the further right of the two. A card placed against this is clear of the machine at
 * every moment of the flight without anything having to be measured per frame.
 */
function unionBands(a: MachineBands, b: MachineBands): MachineBands {
  return {
    injectorTop: Math.min(a.injectorTop, b.injectorTop),
    injectorBottom: Math.max(a.injectorBottom, b.injectorBottom),
    rightIn: (top, bottom) => Math.max(a.rightIn(top, bottom), b.rightIn(top, bottom)),
    linesRightIn: (top, bottom) =>
      Math.max(a.linesRightIn(top, bottom), b.linesRightIn(top, bottom)),
  };
}
