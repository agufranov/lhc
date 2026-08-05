export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const COLORS = {
  background: '#05070c',
  vignette: '#0a1020',
  pipe: '#1b2b45',
  pipeGlow: '#2f5680',
  straight: '#243447',
  label: '#5d7391',
  labelBright: '#9fb6d0',
  beamHead: '#ffffff',
  beamTail: '#49d8ff',
} as const;

/**
 * What a track is, and how much the eye is meant to notice it — indexed by `SPECIES_*`.
 *
 * The order is the order of rarity: pions and photons are the wallpaper, a kaon is worth a
 * colour of its own, a heavy-flavour jet is worth more, and an isolated hard lepton is the
 * one an experiment would have kept the event for — so it is white, thick and brighter than
 * everything else. `[colour, width factor, alpha]`.
 *
 * **One table, both views.** The r–z display on the ring and the r–φ display in the
 * experiment's panel are two projections of one collision, and a lepton that is white in one
 * of them and pink in the other would be two different particles as far as the eye is
 * concerned.
 */
export const SPECIES_STYLE: ReadonlyArray<readonly [string, number, number]> = [
  ['255, 208, 130', 1, 0.5],
  ['160, 220, 255', 0.75, 0.5],
  ['200, 175, 255', 0.8, 0.4],
  ['255, 130, 205', 0.6, 0.7],
  ['130, 255, 195', 1, 0.8],
  ['255, 150, 85', 1.7, 0.95],
  ['255, 255, 240', 2.4, 1],
];

/** Magnet colour ramp: cold iron → energised blue → hot orange → white at nominal. */
const MAGNET_RAMP: Array<[number, RGB]> = [
  [0.0, { r: 34, g: 46, b: 66 }],
  [0.25, { r: 44, g: 108, b: 176 }],
  [0.55, { r: 96, g: 176, b: 232 }],
  [0.8, { r: 255, g: 158, b: 66 }],
  [1.0, { r: 255, g: 236, b: 190 }],
];

export function magnetColor(load: number): RGB {
  return sampleRamp(MAGNET_RAMP, clamp01(load));
}

/** The steel of the cryostat — what a magnet looks like with no current in it at all. */
export const MAGNET_CASING: RGB = { r: 92, g: 108, b: 132 };
export const MAGNET_CASING_DARK: RGB = { r: 38, g: 46, b: 60 };

/**
 * Incandescence: what damaged material looks like at a given temperature [K].
 * Roughly the blacksmith's scale — dull red from ~800 K, orange, yellow, white above
 * the boiling point of copper.
 */
const HEAT_RAMP: Array<[number, RGB]> = [
  [0, { r: 26, g: 20, b: 20 }],
  [600, { r: 92, g: 26, b: 18 }],
  [1000, { r: 190, g: 54, b: 20 }],
  [1400, { r: 244, g: 122, b: 32 }],
  [2000, { r: 255, g: 186, b: 84 }],
  [2835, { r: 255, g: 236, b: 190 }],
  [6000, { r: 255, g: 255, b: 245 }],
];

export function heatColor(temperature: number): RGB {
  return sampleRamp(HEAT_RAMP, Math.max(temperature, 0));
}

export function sampleRamp(ramp: Array<[number, RGB]>, t: number): RGB {
  for (let i = 1; i < ramp.length; i++) {
    if (t <= ramp[i][0]) {
      const [t0, c0] = ramp[i - 1];
      const [t1, c1] = ramp[i];
      const k = (t - t0) / Math.max(t1 - t0, 1e-9);
      return {
        r: c0.r + (c1.r - c0.r) * k,
        g: c0.g + (c1.g - c0.g) * k,
        b: c0.b + (c1.b - c0.b) * k,
      };
    }
  }
  return ramp[ramp.length - 1][1];
}

export function rgba({ r, g, b }: RGB, a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
