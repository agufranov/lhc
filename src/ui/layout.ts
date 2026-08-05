/**
 * The few numbers that decide where the overlay sits over the picture.
 *
 * They live in TypeScript rather than in the stylesheet because **something has to be able
 * to check them**. The machine is drawn on a canvas underneath the panels, and whether a
 * panel covers the collider is a fact about two numbers that live in two different files —
 * `MARGIN` in the renderer and a width in the CSS — with nothing relating them. It went
 * wrong exactly that way: the experiments' column was put where the collider's right-hand
 * arc already was.
 *
 * So the widths are here, `main.ts` publishes them as CSS custom properties, the stylesheet
 * reads them from there, and `check:render` asserts that the collider's right edge lands
 * left of where the panels start.
 */

/** Padding round the whole overlay, and the gap between its columns [CSS px]. */
export const OVERLAY_PADDING = 16;
export const OVERLAY_GAP = 16;

/** The machine-readout column: beam and physics on the left, power and injector on the right. */
export const READOUT_COLUMN = 260;

/**
 * An experiment's panel, which is wider than a readout because it is **a picture with its
 * numbers beside it** rather than above them.
 *
 * Stacked — canvas over rows — the panel was 360 px tall and two of them plus the machine
 * readouts did not fit a 860 px window at all. Side by side it is 246 px and the canvas is
 * *larger*, which is the trade: a panel is as wide as there is room for to the right of the
 * collider, and no taller than it has to be.
 */
export const EVENT_PANEL_WIDTH = 380;
/** The r–φ display inside it. Square, because the thing drawn in it is a circle end-on. */
export const EVENT_CANVAS = 196;

/**
 * Empty border the machine is fitted inside [CSS px].
 *
 * Dropped from 96 so the picture is bigger — the collider's half-aperture goes 17.5 → 18.3 px
 * — and it cannot go much further: the picture is centred, so every pixel of margin removed
 * pushes the collider's right-hand arc that much closer to the experiments' column. The
 * clearance that leaves is asserted, not assumed.
 */
export const CAMERA_MARGIN = 80;

/** Left edge of the experiments' column, for a canvas `width` CSS pixels across. */
export function eventPanelLeft(width: number): number {
  return width - OVERLAY_PADDING - EVENT_PANEL_WIDTH;
}

/** Publishes the widths the stylesheet needs. Called once, at boot. */
export function publishLayout(root: HTMLElement): void {
  root.style.setProperty('--event-panel-width', `${EVENT_PANEL_WIDTH}px`);
  root.style.setProperty('--event-canvas', `${EVENT_CANVAS}px`);
  root.style.setProperty('--readout-column', `${READOUT_COLUMN}px`);
  root.style.setProperty('--overlay-padding', `${OVERLAY_PADDING}px`);
  root.style.setProperty('--overlay-gap', `${OVERLAY_GAP}px`);
}
