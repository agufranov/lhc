/**
 * The console's oscilloscope: both machines' energies, as a rolling trace.
 *
 * ## Why a plot that the readouts already contain
 *
 * They do not, and that is the point of it. POWER says what the field is *now*; a ramp is a
 * thing that takes twenty minutes of machine time and its whole character — the SPS sawtooth
 * against the collider's long climb, and the fact that both are programmes rather than knobs —
 * is only visible as a shape over time. It is also the one instrument on the desk that keeps
 * moving when nothing is being pressed, which is what stops a control panel reading as a
 * toolbar.
 *
 * ## What it is worth, exactly
 *
 * Two traces, of **fraction of that machine's own flat top** — so the SPS at 450 GeV and the
 * collider at 6.8 TeV both reach the top of the same box, and what is being compared is where
 * each machine is in its own cycle rather than a number the collider would win by fifteen to
 * one.
 *
 * Sampled on wall time, not on the machine clock, at `SAMPLE_PERIOD`: the trace is a picture
 * of the last {@link WINDOW} seconds of *watching*, which is what somebody looking at a screen
 * means by "just now". At 200× that is about half an hour of machine time, which holds a whole
 * collider ramp and a good many injector cycles.
 *
 * It draws only on the frames it samples on — four a second — because a trace that has not
 * moved does not need repainting, and this canvas is 140 px wide on a desk that is redrawn
 * sixty times a second.
 */

import type { World } from '../sim/world';

/** How long a trace remembers [s of wall time]. */
const WINDOW = 30;

/** How often it is sampled [s of wall time]. */
const SAMPLE_PERIOD = 0.25;

const SAMPLES = Math.round(WINDOW / SAMPLE_PERIOD);

/**
 * The collider's trace, and the injector's.
 *
 * **Phosphor, not palette.** This is a cathode-ray tube on the front of a desk, not a plot in
 * a panel: one green it is made of and one amber for the second beam, both drawn with a bloom
 * on a nearly black screen, and the graticule ruled underneath them the way a scope's is —
 * scratched into the glass rather than plotted. The picture of the machine behind the desk is
 * blue; nothing on the desk is, which is what keeps the two from reading as one surface.
 */
const COLLIDER = '#6dfba8';
const INJECTOR = '#ffc255';

export class Scope {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  /** Two rings of fractions in [0, 1], newest at `head - 1`. */
  private collider = new Float32Array(SAMPLES);
  private injector = new Float32Array(SAMPLES);
  private head = 0;
  private filled = 0;
  private since = SAMPLE_PERIOD;
  /** The backing store size last set, so a resize is a comparison and not a reallocation. */
  private sized = '';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  /**
   * Takes a sample if one is due, and repaints if it did.
   *
   * `dtWall`, because the machine clock is not what a trace on a screen is against — and a
   * paused machine still has a scope with the last half minute on it.
   */
  update(world: World, dtWall: number): void {
    this.since += dtWall;
    if (this.since < SAMPLE_PERIOD) return;
    this.since = 0;
    this.collider[this.head] = fraction(world.collider.energyGeV, world.collider.ring.config);
    this.injector[this.head] = fraction(world.injector.energyGeV, world.injector.ring.config);
    this.head = (this.head + 1) % SAMPLES;
    this.filled = Math.min(this.filled + 1, SAMPLES);
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    // Zero on a phone, where the scope is not on the desk at all: a canvas with no box is not
    // a bug and must not be drawn into, or the backing store is set to 0 and Chrome throws.
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!ctx || w < 8 || h < 8) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const key = `${w}x${h}@${dpr}`;
    if (key !== this.sized) {
      this.sized = key;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // The tube: an almost black screen with a graticule scratched into it, and a green cast
    // where the phosphor sits.
    ctx.fillStyle = '#03120a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(109, 251, 168, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const y = Math.round((h * i) / 4) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    for (let i = 1; i < 6; i++) {
      const x = Math.round((w * i) / 6) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();

    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.4;
    for (const [ring, colour] of [
      [this.injector, INJECTOR],
      [this.collider, COLLIDER],
    ] as const) {
      ctx.strokeStyle = colour;
      ctx.shadowColor = colour;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      for (let i = 0; i < this.filled; i++) {
        // Oldest first, so the newest sample is at the right-hand edge whatever the ring has
        // wrapped to.
        const at = (this.head - this.filled + i + SAMPLES * 2) % SAMPLES;
        const x = w - ((this.filled - 1 - i) * w) / (SAMPLES - 1);
        const y = h - 1.5 - ring[at] * (h - 3);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Which trace is which, on the tube rather than beside it: a legend in the DOM would be
    // one more thing to lay out, and a scope's own screen is where a scope says this.
    ctx.font = '7px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    for (const [i, [colour, name]] of ([[COLLIDER, 'LHC'], [INJECTOR, 'SPS']] as const).entries()) {
      const x = 4 + i * 30;
      ctx.fillStyle = colour;
      ctx.fillRect(x, 4.5, 6, 1.5);
      ctx.globalAlpha = 0.75;
      ctx.fillText(name, x + 9, 1);
      ctx.globalAlpha = 1;
    }

    // Scan lines. A CRT is not a flat fill of light, and one line in two darkened is the whole
    // of what says so at this size — it is the cheapest thing on the desk and the one that
    // does the most to stop the screen reading as a rounded rectangle with a graph in it.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 1);
  }
}

/** Where a machine is in its own cycle: flat bottom is 0 and its own flat top is 1. */
function fraction(
  energyGeV: number,
  config: { injectionEnergyGeV: number; topEnergyGeV: number },
): number {
  const span = config.topEnergyGeV - config.injectionEnergyGeV;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (energyGeV - config.injectionEnergyGeV) / span));
}
