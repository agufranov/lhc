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

export class Camera {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  width = 0;
  height = 0;

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
    this.width = width;
    this.height = height;
    const worldW = Math.max(bounds.maxX - bounds.minX, 1e-6);
    const worldH = Math.max(bounds.maxY - bounds.minY, 1e-6);
    const boxW = Math.max(width - borders.left - borders.right, 1);
    const boxH = Math.max(height - borders.top - borders.bottom, 1);
    this.scale = Math.min(boxW / worldW, boxH / worldH);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.offsetX = borders.left + boxW / 2 - cx * this.scale;
    this.offsetY = borders.top + boxH / 2 + cy * this.scale;
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
