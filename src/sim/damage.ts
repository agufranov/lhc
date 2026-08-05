/**
 * What happens where the beam hits the wall.
 *
 * A proton does not stop at the surface: it starts a hadronic shower that develops over
 * a few interaction lengths. And a *beam* does much worse than a proton — the leading
 * bunches vaporise the material and the rest fly down the channel they made, which is
 * hydrodynamic tunnelling. That is why the LHC beam is quoted as able to drill tens of
 * metres into copper rather than the ~2 m a single shower would suggest.
 *
 * The two constants below are calibrated, not derived: they reproduce ~35 m of channel
 * for a full 6.8 TeV beam and ~3 m at 450 GeV injection. Everything else is textbook.
 */

/** Nuclear interaction length in copper [m]. */
const HADRONIC_LENGTH = 0.15;
/** Energy scale at which tunnelling starts to dominate the shower depth [J]. */
const TUNNELLING_ENERGY = 1.7e7;
/** Radius of the damaged channel [m] — the shower spreads the sub-mm spot to ~1 cm. */
export const CHANNEL_RADIUS = 0.01;

const COPPER_DENSITY = 8960; // kg/m³
const COPPER_HEAT_CAPACITY = 385; // J/(kg·K)
const COPPER_MELTING = 1358; // K
const COPPER_BOILING = 2835; // K
/** The wall is inside a cryostat, so what it cools back down to is superfluid helium. */
export const AMBIENT_TEMPERATURE = 1.9; // K

import type { Shower } from './shower';

export interface DamageSite {
  /** Impact point on the closed orbit and the outward normal there. */
  sx: number;
  sy: number;
  nx: number;
  ny: number;
  /**
   * Where the particle actually was when it stopped.
   *
   * `sx, sy` is the foot of the perpendicular on the design orbit — the axis of the pipe.
   * Offsetting that by the aperture finds the side wall, which is where a beam that
   * drifted out really does hit; a beam that ran into the far end of a dump line stopped
   * on the axis, and drawing its shower on the side wall put it beside the absorber.
   */
  px: number;
  py: number;
  /** Which wall: +1 outer, −1 inner. */
  side: number;
  /** Unit direction of travel at impact, machine frame. */
  dirX: number;
  dirY: number;
  /** How far into the material the beam got [m]. */
  depth: number;
  /** Energy delivered to the wall [J]. */
  deposited: number;
  /** Temperature right after the hit [K]. */
  peakTemperature: number;
  /**
   * Temperature the site is shown at [K]. It does not cool: the heat cloud is there to
   * mark what the beam did, and a mark that fades is a mark you miss.
   */
  temperature: number;
  /** Global field sector if it landed in a magnet, else −1. */
  arc: number;
  /** Aperture half-width where it hit [m] — one table covers pipes of several sizes. */
  radius: number;
  /** True if the beam was supposed to stop here: a dump absorber. */
  onPurpose: boolean;
  /** Machine-clock timestamp of the hit [s]. */
  at: number;
  /**
   * The cascade the impact set off, in its own frame [m], built once and kept.
   *
   * Built here rather than in the renderer because it is physics, not decoration, and
   * because it must not be re-rolled every frame — a shower that reshuffles at 60 Hz is a
   * boiling smear rather than a thing that happened once.
   */
  shower: Shower;
  /** Energy of one proton in the batch that made it [GeV]. */
  energyGeV: number;
}

/**
 * Penetration depth [m]. Logarithmic in energy for the shower itself, then stretched by
 * how much energy the beam brings — a pilot bunch scratches, a full beam drills.
 */
export function penetrationDepth(energyGeV: number, depositedJoules: number): number {
  const shower = HADRONIC_LENGTH * (Math.log(Math.max(energyGeV, 1)) + 2);
  return shower * (1 + depositedJoules / TUNNELLING_ENERGY);
}

/** Temperature the channel reaches if all the energy stays in it [K]. */
export function channelTemperature(depositedJoules: number, depth: number): number {
  const volume = Math.PI * CHANNEL_RADIUS * CHANNEL_RADIUS * Math.max(depth, 1e-3);
  const mass = volume * COPPER_DENSITY;
  return AMBIENT_TEMPERATURE + depositedJoules / (mass * COPPER_HEAT_CAPACITY);
}

export type DamageVerdict = 'warmed' | 'melted' | 'vaporised';

export function verdictFor(temperature: number): DamageVerdict {
  if (temperature >= COPPER_BOILING) return 'vaporised';
  if (temperature >= COPPER_MELTING) return 'melted';
  return 'warmed';
}

