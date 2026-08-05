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

export class Camera {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  width = 0;
  height = 0;

  fit(bounds: Bounds, width: number, height: number, margin: number): void {
    this.width = width;
    this.height = height;
    const worldW = Math.max(bounds.maxX - bounds.minX, 1e-6);
    const worldH = Math.max(bounds.maxY - bounds.minY, 1e-6);
    this.scale = Math.min((width - 2 * margin) / worldW, (height - 2 * margin) / worldH);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.offsetX = width / 2 - cx * this.scale;
    this.offsetY = height / 2 + cy * this.scale;
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
