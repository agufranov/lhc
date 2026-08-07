/**
 * The mass spectrum, drawn: a histogram with everything anybody has discovered on it.
 *
 * This is the only picture in the toy that is not of the machine. It is what the machine is
 * *for*, and it is drawn the way the real ones are drawn — log counts against log mass for the
 * dimuon plot, because the interesting thing about it is that it spans six decades and the
 * peaks are still visible; linear against linear for the diphoton window, because a bump of a
 * few hundred on a background of a few thousand is a linear-scale story and would vanish on a
 * log one.
 *
 * A histogram of a growing exposure has an awkward property: the axis has to move. Fixing the
 * top at the tallest bin means everything jumps every frame; fixing it at a constant means the
 * plot is empty for the first minute and clipped after ten. So the log plot's ceiling is the
 * next power of ten above the tallest bin and the linear plot's is the tallest bin rounded up,
 * both smoothed — the shape stays still while the numbers climb past it.
 */

import type { MassSpectrum } from '../sim/analysis';

/** Room for the axis labels, in css pixels. */
const PAD_LEFT = 4;
const PAD_BOTTOM = 11;
const PAD_TOP = 3;

export class SpectrumView {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  /** Smoothed ceiling, so the axis creeps rather than jumping every time a bin grows. */
  private ceiling = 0;
  dirty = true;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  /** Resizes to the element's own box. Cheap, and a no-op when nothing has moved. */
  resize(): void {
    const dpr = Math.min((globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === this.cssWidth && h === this.cssHeight && dpr === this.dpr) return;
    this.dirty = true;
    this.dpr = dpr;
    this.cssWidth = w;
    this.cssHeight = h;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Draws the spectrum at this exposure.
   *
   * `marks` are the masses to label — the peaks whose sources have anything in them yet, so a
   * plot that has not collected a Z does not claim one.
   */
  render(spectrum: MassSpectrum, integrated: number, marks: Array<{ mass: number; label: string }>): void {
    this.resize();
    const { ctx } = this;
    const w = this.cssWidth;
    const h = this.cssHeight;
    if (w <= 0 || h <= 0) return;
    ctx.clearRect(0, 0, w, h);
    this.dirty = false;

    const counts = spectrum.at(integrated);
    const n = spectrum.binCount;
    const lo = spectrum.edges[0];
    const hi = spectrum.edges[n];
    const plotW = w - PAD_LEFT;
    const plotH = h - PAD_BOTTOM - PAD_TOP;

    let tallest = 0;
    for (let i = 0; i < n; i++) tallest = Math.max(tallest, counts[i]);
    if (tallest <= 0) {
      this.empty(w, h);
      return;
    }

    // The ceiling, and why it is smoothed: a bare `max` makes every bar in the picture shrink
    // by a per cent every frame as the exposure grows, which reads as the plot breathing.
    const want = spectrum.logarithmic
      ? Math.pow(10, Math.ceil(Math.log10(tallest) + 0.001))
      : tallest * 1.25;
    this.ceiling = this.ceiling === 0 ? want : this.ceiling + (want - this.ceiling) * 0.08;
    const top = Math.max(this.ceiling, want * 0.6);

    const x = (mass: number): number =>
      PAD_LEFT +
      plotW *
        (spectrum.logarithmic
          ? Math.log(mass / lo) / Math.log(hi / lo)
          : (mass - lo) / (hi - lo));
    const y = (count: number): number => {
      if (!spectrum.logarithmic) return PAD_TOP + plotH * (1 - count / top);
      // Log counts, floored a decade below the ceiling's own floor so an empty bin is at the
      // axis rather than at minus infinity.
      const decades = Math.max(3, Math.log10(top) + 1);
      const v = count > 0 ? Math.log10(count) : -1;
      return PAD_TOP + plotH * (1 - Math.max(0, (v + 1) / decades));
    };

    // Decade lines on the log plot, a mid line on the linear one: a histogram without a scale
    // behind it is a shape rather than a measurement.
    ctx.strokeStyle = 'rgba(120, 150, 190, 0.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (spectrum.logarithmic) {
      for (let d = 1; d <= Math.ceil(Math.log10(hi)); d++) {
        const gx = Math.round(x(Math.pow(10, d))) + 0.5;
        ctx.moveTo(gx, PAD_TOP);
        ctx.lineTo(gx, PAD_TOP + plotH);
      }
    } else {
      const gy = Math.round(PAD_TOP + plotH / 2) + 0.5;
      ctx.moveTo(PAD_LEFT, gy);
      ctx.lineTo(w, gy);
    }
    ctx.stroke();

    // The histogram itself, as one filled outline rather than as bars: at three pixels a bin
    // the gaps between bars are all anybody sees.
    ctx.beginPath();
    ctx.moveTo(x(spectrum.edges[0]), PAD_TOP + plotH);
    for (let i = 0; i < n; i++) {
      const x0 = x(spectrum.edges[i]);
      const x1 = x(spectrum.edges[i + 1]);
      const yy = y(counts[i]);
      ctx.lineTo(x0, yy);
      ctx.lineTo(x1, yy);
    }
    ctx.lineTo(x(spectrum.edges[n]), PAD_TOP + plotH);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + plotH);
    fill.addColorStop(0, 'rgba(120, 190, 255, 0.42)');
    fill.addColorStop(1, 'rgba(90, 150, 220, 0.10)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(160, 210, 255, 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // The peaks, named. A label is drawn only for a source that has something in it, so the
    // plot never announces a Z it has not collected.
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    for (const mark of marks) {
      if (mark.mass < lo || mark.mass > hi) continue;
      const mx = x(mark.mass);
      ctx.strokeStyle = 'rgba(255, 210, 120, 0.35)';
      ctx.beginPath();
      ctx.moveTo(mx, PAD_TOP);
      ctx.lineTo(mx, PAD_TOP + plotH);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 214, 140, 0.95)';
      ctx.fillText(mark.label, Math.min(w - 10, Math.max(10, mx)), PAD_TOP);
    }

    // The mass axis. Three numbers on the log plot, two on the linear one — it is 240 px wide.
    ctx.fillStyle = 'rgba(122, 146, 178, 0.9)';
    ctx.textBaseline = 'bottom';
    const ticks = spectrum.logarithmic ? [1, 10, 100] : [lo, (lo + hi) / 2, hi];
    for (const t of ticks) {
      if (t < lo || t > hi) continue;
      ctx.textAlign = t === ticks[0] ? 'left' : t === ticks[ticks.length - 1] ? 'right' : 'center';
      ctx.fillText(String(Math.round(t)), Math.min(w, Math.max(0, x(t))), h);
    }
    ctx.textAlign = 'right';
    ctx.fillText('GeV', w, h);
  }

  private empty(w: number, h: number): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(109, 132, 163, 0.75)';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('no data yet', w / 2, h / 2);
  }
}
