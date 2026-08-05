/**
 * SI units everywhere inside the simulation core.
 * Energies are carried in GeV because that is what the HUD and the operators speak.
 */

export const C_LIGHT = 299_792_458; // m/s
export const ELEMENTARY_CHARGE = 1.602_176_634e-19; // C
export const PROTON_MASS = 1.672_621_923_69e-27; // kg
export const PROTON_REST_ENERGY_GEV = 0.938_272_088_16; // GeV
export const GEV_PER_JOULE = 1 / (ELEMENTARY_CHARGE * 1e9);

/** Lorentz factor of a proton with total energy E [GeV]. */
export function gammaFromEnergy(energyGeV: number): number {
  return energyGeV / PROTON_REST_ENERGY_GEV;
}

export function betaFromGamma(gamma: number): number {
  return Math.sqrt(1 - 1 / (gamma * gamma));
}

/** Momentum [GeV/c] from total energy [GeV]. */
export function momentumFromEnergy(energyGeV: number): number {
  const m0 = PROTON_REST_ENERGY_GEV;
  return Math.sqrt(Math.max(energyGeV * energyGeV - m0 * m0, 0));
}

/** Magnetic rigidity Bρ [T·m] for a proton of momentum p [GeV/c]. */
export function rigidity(momentumGeVc: number): number {
  return momentumGeVc / 0.299_792_458;
}

/** Dipole field [T] needed to bend momentum p [GeV/c] on radius ρ [m]. */
export function fieldForRadius(momentumGeVc: number, bendRadius: number): number {
  return rigidity(momentumGeVc) / bendRadius;
}

/**
 * q / (γ m) — the only beam constant the particle pusher needs.
 * Rotation of the velocity vector per step is ω·dt with ω = qB/(γm).
 */
export function chargeOverGammaMass(gamma: number): number {
  return ELEMENTARY_CHARGE / (gamma * PROTON_MASS);
}
