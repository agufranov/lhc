/**
 * World (metres, y up) → screen (CSS pixels, y down).
 * Kept as an explicit object so several rings can be drawn at different scales
 * once the SPS and the transfer lines arrive.
 */

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Border kept clear on each side of the fitted machine [CSS px]. */
export interface Borders {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Where the camera is, as the two things worth interpolating.
 *
 * A camera is usually described by the box it was fitted to, and a box is exactly the wrong
 * thing to move between two of: interpolating the four edges of a box zooms and pans at rates
 * that fight each other, and the picture appears to swing. What moves smoothly is **the world
 * point under the middle of the picture, and the magnification** — the first linearly, the
 * second geometrically, because a factor of ten is the same amount of zoom whether it starts
 * at 1 or at 100. See `lerpFrame`.
 */
export interface CameraFrame {
  /** Pixels per metre. */
  scale: number;
  /** World point at the centre of the box the borders leave. */
  cx: number;
  cy: number;
}

export class Camera {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  width = 0;
  height = 0;
  /** The borders the last frame was applied with, so `frame()` can undo the arithmetic. */
  private borders: Borders = { top: 0, right: 0, bottom: 0, left: 0 };

  /**
   * Fits `bounds` into the window, inside borders that need not be equal.
   *
   * They are not equal because the window is not empty around the picture: a title bar sits
   * over the top of it and a row (or two rows) of buttons over the bottom, and a machine
   * centred in the *window* puts its lowest sector labels underneath them. So the borders are
   * given per side and the machine is centred in what is left, not in the window. See
   * `Renderer.resize`.
   */
  fit(bounds: Bounds, width: number, height: number, borders: Borders): void {
    this.apply(frameFor(bounds, width, height, borders), width, height, borders);
  }

  /** Puts the camera at a frame. The inverse of `frame()`. */
  apply(frame: CameraFrame, width: number, height: number, borders: Borders): void {
    this.width = width;
    this.height = height;
    this.borders = borders;
    this.scale = frame.scale;
    const boxW = Math.max(width - borders.left - borders.right, 1);
    const boxH = Math.max(height - borders.top - borders.bottom, 1);
    this.offsetX = borders.left + boxW / 2 - frame.cx * frame.scale;
    this.offsetY = borders.top + boxH / 2 + frame.cy * frame.scale;
  }

  /**
   * Where the camera is now, in the form that can be interpolated.
   *
   * `borders` defaults to the ones it was last applied with, and is given explicitly when a
   * flight is about to be flown inside a *different* box — a zoomed view is fitted between the
   * overlay's own columns and the overview is not. Describing the camera against the box it is
   * about to move in rather than the one it arrived in is what keeps a flight from starting
   * with a jump: not one pixel of the picture moves, only the arithmetic that names where it is.
   */
  frame(borders: Borders = this.borders): CameraFrame {
    const boxW = Math.max(this.width - borders.left - borders.right, 1);
    const boxH = Math.max(this.height - borders.top - borders.bottom, 1);
    return {
      scale: this.scale,
      cx: this.worldX(borders.left + boxW / 2),
      cy: this.worldY(borders.top + boxH / 2),
    };
  }

  x(worldX: number): number {
    return worldX * this.scale + this.offsetX;
  }

  y(worldY: number): number {
    return -worldY * this.scale + this.offsetY;
  }

  /** Metres → pixels. */
  len(metres: number): number {
    return metres * this.scale;
  }

  /** Screen (CSS px) → world, for hit testing. */
  worldX(screenX: number): number {
    return (screenX - this.offsetX) / this.scale;
  }

  worldY(screenY: number): number {
    return (this.offsetY - screenY) / this.scale;
  }
}

/** The frame that fits `bounds` inside `borders`, without moving any camera. */
export function frameFor(
  bounds: Bounds,
  width: number,
  height: number,
  borders: Borders,
): CameraFrame {
  const worldW = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const worldH = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const boxW = Math.max(width - borders.left - borders.right, 1);
  const boxH = Math.max(height - borders.top - borders.bottom, 1);
  return {
    scale: Math.min(boxW / worldW, boxH / worldH),
    cx: (bounds.minX + bounds.maxX) / 2,
    cy: (bounds.minY + bounds.maxY) / 2,
  };
}

/**
 * A point on the way from one frame to another, `t` in 0..1.
 *
 * **The magnification is interpolated geometrically and the centre linearly.** Halfway
 * between 1 px/m and 100 px/m is 10 and not 50: linear scale spends most of a flight at the
 * far end's magnification and arrives with a lurch, which is exactly what a camera that
 * crosses four orders of magnitude — the whole complex to the inside of a detector — must
 * not do.
 */
export function lerpFrame(from: CameraFrame, to: CameraFrame, t: number): CameraFrame {
  return {
    scale: from.scale * Math.pow(to.scale / from.scale, t),
    cx: from.cx + (to.cx - from.cx) * t,
    cy: from.cy + (to.cy - from.cy) * t,
  };
}

/** Smooth at both ends: nothing starts or stops moving abruptly. */
export function easeInOut(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}
