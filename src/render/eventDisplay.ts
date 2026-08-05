/**
 * The r–φ event display: one collision drawn looking straight down the beam pipe.
 *
 * This is the second of the two views, and the reason there are two. The picture on the ring
 * is r–z — a plane containing the beam axis — which is right for *where* a collision happened
 * and useless for anything else, because that projection throws φ away and lays every track's
 * transverse momentum flat in the picture. Looking down the axis gives back what an
 * experiment is actually built to measure, and `shower.ts` says what that is.
 *
 * What is drawn here, outward, and why each of them is a separate thing:
 *
 *  · **the tracker as layers, and the hits on them.** Eight silicon layers and a straw
 *    tracker. A track is not a line anybody drew — it is a fit through the points it left,
 *    and those points are the dots. A neutral leaves none, which is how a photon is told
 *    from an electron and is the single most legible piece of physics on this picture.
 *  · **the calorimeters as cells, in depth as well as around.** Four EM samplings and three
 *    tile samplings, each cell lit by what landed in it. An electromagnetic shower is a
 *    narrow spike that dies in sampling 2; a hadron is a wide clump that is still going in
 *    sampling 3 and punches into the tile. That difference is the reason for the depth
 *    segmentation and it is visible here rather than asserted.
 *  · **the toroid coils and three muon stations.** Eight coils, and something that lights all
 *    three stations has been through the whole detector.
 *
 * It draws into its own canvas rather than onto the machine, because it is a readout and not
 * a place: the ring says where the beams are, this says what came out. Everything is in units
 * of the detector radius, which is what `buildTransverse` produces, so the whole of the
 * scaling is one number.
 */

import type { EventObject, TransverseEvent } from '../sim/shower';
import {
  BARREL,
  EM_CELLS,
  EM_SAMPLINGS,
  HAD_CELLS,
  HAD_SAMPLINGS,
  HIT_SILICON,
  HIT_STRIDE,
  MUON_CHAMBERS,
  MUON_STATIONS,
  SEGMENT_STRIDE,
  SPECIES_COUNT,
  SPECIES_EM,
  SPECIES_HADRON,
  SPECIES_HEAVY,
  SPECIES_KAON,
  SPECIES_LEPTON,
  SPECIES_MUON,
  SPECIES_NEUTRON,
} from '../sim/shower';
import { SPECIES_STYLE, clamp01 } from './palette';

/** How much of the box the detector fills, leaving a ring of margin for the labels. */
const FIT = 0.9;

/** Structural colours, by layer kind: fill and stroke. */
const KIND_COLORS: Record<string, [string, string]> = {
  pipe: ['rgba(70, 82, 104, 0.9)', 'rgba(140, 165, 200, 0.5)'],
  pixel: ['rgba(88, 128, 176, 0.55)', 'rgba(150, 200, 250, 0.75)'],
  strip: ['rgba(74, 112, 156, 0.5)', 'rgba(130, 180, 235, 0.6)'],
  straw: ['rgba(40, 62, 88, 0.55)', 'rgba(108, 156, 205, 0.35)'],
  solenoid: ['rgba(96, 100, 108, 0.7)', 'rgba(160, 170, 185, 0.45)'],
  em: ['rgba(16, 34, 56, 0.95)', 'rgba(88, 140, 200, 0.28)'],
  had: ['rgba(40, 30, 22, 0.95)', 'rgba(170, 120, 74, 0.28)'],
  coil: ['rgba(58, 62, 72, 0.95)', 'rgba(140, 150, 168, 0.5)'],
  muon: ['rgba(30, 36, 52, 0.9)', 'rgba(120, 148, 195, 0.45)'],
};

/** One character for a species, for the labels — there is room for one and no more. */
const SPECIES_MARK: Record<number, string> = {
  [SPECIES_HADRON]: 'π',
  [SPECIES_EM]: 'γ',
  [SPECIES_NEUTRON]: 'n',
  [SPECIES_MUON]: 'μ',
  [SPECIES_KAON]: 'K',
  [SPECIES_HEAVY]: 'b',
  [SPECIES_LEPTON]: 'ℓ',
};

export class EventDisplay {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;

  /**
   * True when the canvas has been resized out from under whatever was last drawn on it.
   *
   * The panel only redraws when the event changes, because the trigger holds one for seconds
   * at a time — so a resize, which clears the canvas, has to be able to ask for one frame
   * back or the display goes blank and stays blank when the window moves.
   */
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
   * Draws one event, or the empty detector if there is nothing to draw.
   *
   * `flash` is 0..1 and fades over the first moment after an event was recorded: the trigger
   * holds one event for many seconds, so without it there is no way to tell a display that
   * has just changed from one that has been sitting there.
   */
  render(event: TransverseEvent | null, flash = 0): void {
    this.resize();
    const { ctx } = this;
    const w = this.cssWidth;
    const h = this.cssHeight;
    if (w <= 0 || h <= 0) return;

    ctx.clearRect(0, 0, w, h);
    this.dirty = false;
    const cx = w / 2;
    const cy = h / 2;
    const R = (Math.min(w, h) / 2) * FIT;

    this.barrel(cx, cy, R);
    if (event) {
      this.cells(cx, cy, R, event);
      this.muonHits(cx, cy, R, event);
      this.tracks(cx, cy, R, event);
      this.hits(cx, cy, R, event);
    }
    this.vertex(cx, cy, clamp01(flash));
    if (event) this.labels(cx, cy, R, event.objects);

    if (!event) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(109, 132, 163, 0.8)';
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('no collisions', cx, cy + R * 0.55);
    }
  }

  /**
   * The detector itself: every layer of `BARREL`, outermost first so each is drawn inside the
   * one before it, plus the eight toroid coils and the cell boundaries that say how finely
   * each calorimeter is divided.
   */
  private barrel(cx: number, cy: number, R: number): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'source-over';

    for (let i = BARREL.length - 1; i >= 0; i--) {
      const layer = BARREL[i];
      const [fill, stroke] = KIND_COLORS[layer.kind];

      if (layer.kind === 'coil') {
        // Eight of them, at 45°, and they are the reason a muon's momentum can still be
        // measured after it has left the solenoid — the toroid bends it in r–z, out of this
        // plane, which is why the track is drawn dead straight out here.
        for (let k = 0; k < layer.cells; k++) {
          const a = ((k + 0.5) / layer.cells) * Math.PI * 2;
          this.wedge(cx, cy, R * layer.r0, R * layer.r1, a - 0.055, a + 0.055);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.lineWidth = 0.8;
          ctx.strokeStyle = stroke;
          ctx.stroke();
        }
        continue;
      }

      // An annulus is one ring path minus the hole; drawn as two arcs in opposite senses so
      // the non-zero fill leaves the middle alone. Filling a disc here would bury everything
      // inside it, which is the same trap `traceOrbit` documents on the ring.
      ctx.beginPath();
      ctx.arc(cx, cy, R * layer.r1, 0, Math.PI * 2);
      ctx.arc(cx, cy, R * layer.r0, Math.PI * 2, 0, true);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = stroke;
      ctx.stroke();

      // Cell boundaries: what makes a calorimeter read as a calorimeter rather than as a
      // ring, and an honest statement of how finely it is divided.
      if (layer.cells > 0 && layer.kind !== 'muon') {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        for (let k = 0; k < layer.cells; k++) {
          const a = (k / layer.cells) * Math.PI * 2;
          ctx.moveTo(cx + Math.cos(a) * R * layer.r0, cy - Math.sin(a) * R * layer.r0);
          ctx.lineTo(cx + Math.cos(a) * R * layer.r1, cy - Math.sin(a) * R * layer.r1);
        }
        ctx.stroke();
      }
      // Muon chambers are discrete boxes with gaps between them, not a continuous shell.
      if (layer.kind === 'muon') {
        ctx.lineWidth = Math.max(1, (R * (layer.r1 - layer.r0)) / 1.4);
        ctx.strokeStyle = fill;
        for (let k = 0; k < layer.cells; k++) {
          const a0 = ((k + 0.08) / layer.cells) * Math.PI * 2;
          const a1 = ((k + 0.92) / layer.cells) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(cx, cy, R * ((layer.r0 + layer.r1) / 2), -a0, -a1, true);
          ctx.stroke();
        }
      }
      // The straw tracker is drawn as the straws it is: radial hatching, because a continuous
      // band there says "empty volume" and it is the densest part of the tracker.
      if (layer.kind === 'straw') {
        ctx.strokeStyle = 'rgba(108, 156, 205, 0.18)';
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        for (let k = 0; k < 72; k++) {
          const a = (k / 72) * Math.PI * 2;
          ctx.moveTo(cx + Math.cos(a) * R * layer.r0, cy - Math.sin(a) * R * layer.r0);
          ctx.lineTo(cx + Math.cos(a) * R * layer.r1, cy - Math.sin(a) * R * layer.r1);
        }
        ctx.stroke();
      }
    }
  }

  /**
   * The calorimeter cells, which are the readout.
   *
   * Normalised on the brightest cell in the event, so a soft event is still legible and a
   * hard one still says which tower was hit — an absolute scale draws every minimum-bias
   * event as an unlit ring. Square root on top of that, because the interesting range is
   * three decades and a linear ramp leaves everything but the leading tower black.
   */
  private cells(cx: number, cy: number, R: number, event: TransverseEvent): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    const em = BARREL.filter((l) => l.kind === 'em');
    const had = BARREL.filter((l) => l.kind === 'had');

    for (const [layers, values, cells, samplings, peak, color] of [
      [em, event.em, EM_CELLS, EM_SAMPLINGS, event.emPeak, '120, 200, 255'],
      [had, event.had, HAD_CELLS, HAD_SAMPLINGS, event.hadPeak, '255, 178, 96'],
    ] as const) {
      if (peak <= 0) continue;
      for (let s = 0; s < samplings && s < layers.length; s++) {
        const layer = layers[s];
        for (let c = 0; c < cells; c++) {
          const e = values[s * cells + c];
          if (e <= 0) continue;
          const k = Math.sqrt(clamp01(e / peak));
          if (k < 0.02) continue;
          const a0 = ((c + 0.06) / cells) * Math.PI * 2;
          const a1 = ((c + 0.94) / cells) * Math.PI * 2;
          this.wedge(cx, cy, R * layer.r0, R * layer.r1, a0, a1);
          ctx.fillStyle = `rgba(${color}, ${(0.1 + 0.8 * k).toFixed(3)})`;
          ctx.fill();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Chambers that fired. A hit out here is a fact, not an energy, so it is a mark. */
  private muonHits(cx: number, cy: number, R: number, event: TransverseEvent): void {
    const { ctx } = this;
    const stations = BARREL.filter((l) => l.kind === 'muon');
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255, 255, 240, 0.95)';
    for (let st = 0; st < MUON_STATIONS && st < stations.length; st++) {
      const layer = stations[st];
      ctx.lineWidth = Math.max(1.5, R * (layer.r1 - layer.r0) * 0.9);
      for (let c = 0; c < MUON_CHAMBERS; c++) {
        if (!event.muon[st * MUON_CHAMBERS + c]) continue;
        const a0 = ((c + 0.08) / MUON_CHAMBERS) * Math.PI * 2;
        const a1 = ((c + 0.92) / MUON_CHAMBERS) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, R * ((layer.r0 + layer.r1) / 2), -a0, -a1, true);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** The tracks, batched by species — and neutrals drawn faint, because nothing measured one. */
  private tracks(cx: number, cy: number, R: number, event: TransverseEvent): void {
    const { ctx } = this;
    const charged: number[][] = [];
    const neutral: number[][] = [];
    for (let s = 0; s < SPECIES_COUNT; s++) {
      charged.push([]);
      neutral.push([]);
    }
    for (let i = 0; i < event.count; i++) {
      const o = i * SEGMENT_STRIDE;
      const species = event.data[o + 4] | 0;
      const into = event.data[o + 6] > 0 ? neutral[species] : charged[species];
      into.push(
        cx + R * event.data[o],
        cy - R * event.data[o + 1],
        cx + R * event.data[o + 2],
        cy - R * event.data[o + 3],
      );
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const [batch, alphaScale, widthScale] of [
      [neutral, 0.5, 0.55],
      [charged, 1.5, 1],
    ] as const) {
      for (let s = 0; s < SPECIES_COUNT; s++) {
        const pts = batch[s];
        if (pts.length === 0) continue;
        const [color, width, alpha] = SPECIES_STYLE[s];
        ctx.strokeStyle = `rgba(${color}, ${Math.min(1, alpha * alphaScale).toFixed(3)})`;
        ctx.lineWidth = Math.max(0.5, R * 0.012 * width * widthScale);
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 4) {
          ctx.moveTo(pts[i], pts[i + 1]);
          ctx.lineTo(pts[i + 2], pts[i + 3]);
        }
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * What the tracker measured: a dot per layer crossing.
   *
   * These are the picture. A charged particle leaves one on every layer it reaches, a neutral
   * leaves none at all, and a looper leaves them on the inner layers and then stops — so the
   * density of dots near the middle is a soft event, and a clean line of them running out to
   * the straws is a hard track.
   */
  private hits(cx: number, cy: number, R: number, event: TransverseEvent): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    const silicon = Math.max(0.9, R * 0.011);
    const straw = Math.max(0.7, R * 0.008);
    for (const [kind, size, color] of [
      [HIT_SILICON, silicon, 'rgba(190, 230, 255, 0.9)'],
      [1, straw, 'rgba(255, 220, 150, 0.55)'],
    ] as const) {
      ctx.fillStyle = color;
      for (let i = 0; i < event.hitCount; i++) {
        const o = i * HIT_STRIDE;
        if ((event.hits[o + 2] | 0) !== kind) continue;
        ctx.beginPath();
        ctx.arc(cx + R * event.hits[o], cy - R * event.hits[o + 1], size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** The vertex: a point, because the tracks all start there and say so themselves. */
  private vertex(cx: number, cy: number, flash: number): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.6 + 0.4 * flash).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.4 + 1.2 * flash, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * The hard objects, named.
   *
   * One character and a momentum, at the end of the track, pushed out radially and nudged off
   * its neighbours — the panel is two hundred pixels across and there is room for five of
   * these and no more. A neutral is marked, because "calorimeter energy with no track" is the
   * whole of what identifies one and the label is where that can be said.
   */
  private labels(cx: number, cy: number, R: number, objects: EventObject[]): void {
    if (objects.length === 0) return;
    const { ctx } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';

    const placed: Array<[number, number]> = [];
    for (const ob of objects) {
      const r = Math.hypot(ob.x, ob.y) || 1;
      let px = cx + R * (ob.x / r) * (r + 0.09);
      let py = cy - R * (ob.y / r) * (r + 0.09);
      // Push off anything already written near here rather than stacking two labels.
      for (let tries = 0; tries < 6; tries++) {
        const clash = placed.some(([qx, qy]) => Math.hypot(px - qx, py - qy) < 16);
        if (!clash) break;
        px += 0;
        py += 12;
      }
      placed.push([px, py]);

      const [color] = SPECIES_STYLE[ob.species];
      const mark = SPECIES_MARK[ob.species] ?? '?';
      const text = `${mark}${ob.neutral ? '°' : ''} ${ob.pt < 10 ? ob.pt.toFixed(1) : ob.pt.toFixed(0)}`;
      ctx.textAlign = px < cx ? 'right' : 'left';
      ctx.fillStyle = `rgba(${color}, 0.95)`;
      ctx.fillText(text, px, py);
    }
  }

  /** An annular wedge between two radii and two azimuths, as a closed path. */
  private wedge(
    cx: number,
    cy: number,
    r0: number,
    r1: number,
    a0: number,
    a1: number,
  ): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(cx, cy, r0, -a0, -a1, true);
    ctx.arc(cx, cy, r1, -a1, -a0, false);
    ctx.closePath();
  }
}
