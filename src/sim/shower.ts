/**
 * A particle shower, as the branching cascade it actually is.
 *
 * A proton stopping in matter does not deliver one blow. It hits a nucleus, and the debris
 * of that collision hits more nuclei, and the number of particles doubles and redoubles
 * until there is not enough energy left in any one of them to make anything new. What comes
 * out is a *tree* — a few metres of it in copper, thousands of particles, three or four
 * kinds — and every branch is a different species with a different reach:
 *
 *  · **charged hadrons** — mostly pions. They interact every nuclear interaction length
 *    (15 cm in copper) and are what carries the cascade forward.
 *  · **the electromagnetic component** — every third pion is a π⁰, which lives 10⁻¹⁶ s and
 *    becomes two photons. Those pair-produce and bremsstrahlung on the *radiation* length,
 *    which in copper is 1.4 cm, ten times shorter. So each π⁰ dumps its energy in a short,
 *    dense, bright burst well inside the hadronic cascade around it. This is why the light
 *    from a shower is concentrated where the hadrons are still going.
 *  · **neutrons** — no charge, no ionisation, wander further and end the shower's tail.
 *  · **muons** — from pions that decayed before they could interact. They barely interact at
 *    all and leave in a straight line, which is why they are the thing you build a detector
 *    at the far end for.
 *
 * The cascade is built in **real metres** in its own frame — +x along the direction of
 * travel, +y across it — and the caller scales it to whatever the drawing needs. Nothing
 * here knows about pixels or about where in the machine it happened, which is the point:
 * two beams colliding want the same tree, from the same function, with a different primary
 * energy and two of them back to back.
 *
 * Deterministic in `seed`, so a site does not boil between frames.
 */

/** Segment layout: x0, y0, x1, y1, species, energy [GeV], generation, — stride 8. */
export const SEGMENT_STRIDE = 8;

/**
 * What a track is.
 *
 * The first four are what a cascade in matter makes, and they are ordered by how far they
 * reach. The last three only ever come out of a **collision**, and they are ordered by how
 * rare and how interesting they are — because that is the one thing that really does depend
 * on energy. A soft track is a pion, and a soft track is what almost everything is; strange
 * quarks cost a little more; charm and beauty cost real transverse momentum; and an isolated
 * hard lepton essentially means a W or a Z has just decayed, which is the kind of thing an
 * experiment builds a trigger for. See `speciesForPt`.
 */
export const SPECIES_HADRON = 0;
export const SPECIES_EM = 1;
export const SPECIES_NEUTRON = 2;
export const SPECIES_MUON = 3;
/** Strange: a charged kaon, from a soft-to-moderate track. */
export const SPECIES_KAON = 4;
/** Charm or beauty — a jet with a displaced vertex, and sometimes a muon inside it. */
export const SPECIES_HEAVY = 5;
/** An isolated hard lepton: the W and Z signature, and what a trigger is built for. */
export const SPECIES_LEPTON = 6;
export const SPECIES_COUNT = 7;

/** Species that go through the material instead of showering in it. */
function penetrates(species: number): boolean {
  return species === SPECIES_MUON || species === SPECIES_LEPTON;
}

/** What to call one, for the readout. */
export function speciesName(species: number): string {
  switch (species) {
    case SPECIES_EM:
      return 'photon';
    case SPECIES_NEUTRON:
      return 'neutron';
    case SPECIES_MUON:
      return 'muon';
    case SPECIES_KAON:
      return 'kaon';
    case SPECIES_HEAVY:
      return 'b/c jet';
    case SPECIES_LEPTON:
      return 'isolated lepton';
    default:
      return 'pion';
  }
}

/**
 * What the cascade is developing in. Two lengths, and the ratio between them is the
 * whole shape of a shower.
 */
export interface Material {
  /** Nuclear interaction length — how far a hadron goes between collisions. */
  interactionLength: number;
  /** Radiation length. Ten times shorter, which is the story in the header. */
  radiationLength: number;
}

/** The wall: copper, in metres. */
export const COPPER: Material = { interactionLength: 0.15, radiationLength: 0.0143 };

/** Critical energy in copper [GeV]: below this an electron loses energy by ionising. */
const CRITICAL_ENERGY = 0.019;
/** A hadron below this has nothing left to make [GeV]. */
const HADRON_CUTOFF = 0.28;
/** Typical transverse momentum a secondary comes off with [GeV/c]. */
const PT_TYPICAL = 0.35;
/** Fraction of a π⁰'s energy that goes into the electromagnetic component. */
const PI_ZERO_FRACTION = 1 / 3;
/** Chance that a charged pion decays to a muon before it interacts. */
const MUON_FRACTION = 0.02;

export interface Shower {
  /** Segments, `SEGMENT_STRIDE` floats each, in the shower's own frame [m]. */
  data: Float32Array;
  count: number;
  /** How far the cascade got along the beam, and how far across it [m]. */
  reach: number;
  spread: number;
  /**
   * How far it got *backwards* [m]. Zero for a shower driven into a wall; for a collision
   * event, which is two beams meeting, it is the mirror of `reach`.
   */
  back: number;
  /** Particles the cascade made, and how many of them are in `data`. */
  particles: number;
  /** How many it started from: 1 for a wall shower, the event multiplicity for a collision. */
  primaries: number;
  /**
   * The hardest thing in the event: its transverse momentum [GeV/c] and what it was.
   *
   * This is what an experiment would have triggered on, and the one number that says whether
   * an event was worth keeping. Zero for a wall shower, which has no transverse anything.
   */
  hardestPt: number;
  hardestSpecies: number;
  /** Primary energy it was built from [GeV]. */
  energyGeV: number;
}

interface Track {
  x: number;
  y: number;
  /** Direction, unit. */
  dx: number;
  dy: number;
  energy: number;
  species: number;
  generation: number;
  /** Generations since this branch turned electromagnetic. */
  emAge: number;
}

/**
 * How deep an electromagnetic sub-shower is followed.
 *
 * A π⁰'s cascade is over in twenty radiation lengths — twenty-eight centimetres of copper
 * against the two metres the hadronic part takes — so at any scale that shows the whole
 * shower it is a bright point, not a structure. Followed to its own energy cutoff it also
 * eats the entire drawing budget: every generation halves the energy but only advances
 * 1.4 cm, so "hardest first" dives into it and never comes back. Measured: 172 of 192
 * segments electromagnetic, a cascade 0.9 m long and 2 cm wide — a needle.
 */
const EM_GENERATIONS = 4;
/**
 * Priority handicap for the electromagnetic component.
 *
 * The queue is worked hardest first, and at equal energy the hadron is the one to follow:
 * it is what carries the cascade forward into the material. The photons are drawn where
 * they are made.
 */
const EM_PRIORITY = 0.55;
/**
 * How sharply the drawing budget follows energy.
 *
 * Strictly hardest-first spends everything on the trunk, and at 6.8 TeV the trunk is
 * pencil-thin: θ ≈ pT/p is 0.1 mrad for the leading particle, so the cascade came out 2.4 m
 * long and 4 cm wide — the shape is right and it draws as a single line. What makes a shower
 * look like a shower is the soft end, thousands of sub-GeV particles at large angles, and
 * that is exactly what a budget spent on the trunk never reaches. A fractional power keeps
 * the order — hard first — while letting the spray in early enough to be seen.
 */
const PRIORITY_EXPONENT = 0.3;

/**
 * Builds the cascade one primary of `energyGeV` makes.
 *
 * `maxSegments` is a drawing budget, not a physical limit: a real 6.8 TeV shower is tens of
 * thousands of particles and no picture wants that many lines. What the budget is spent on
 * is the question, and it is spent **hardest first** — always the most energetic particle
 * still waiting. That follows the leading particle all the way down before it starts on the
 * soft branches, so the cascade comes out as a trunk driving into the material with
 * everything else hanging off it. Spending it in generation order instead fans the whole
 * budget out at the third branching and draws a bush: measured, 3 generations against 14.
 *
 * `particles` reports how many the cascade actually made, so the number is not hidden.
 */
export function buildShower(energyGeV: number, seed: number, maxSegments = 192): Shower {
  const data = new Float32Array(maxSegments * SEGMENT_STRIDE);
  const rand = rng(seed);
  const grown = cascade(
    [
      {
        x: 0,
        y: 0,
        dx: 1,
        dy: 0,
        energy: Math.max(energyGeV, HADRON_CUTOFF),
        species: SPECIES_HADRON,
        generation: 0,
        emAge: 0,
      },
    ],
    rand,
    data,
    maxSegments,
    COPPER,
    0,
  );
  return {
    data,
    count: grown.count,
    reach: Math.max(grown.maxX, 1e-6),
    spread: grown.spread,
    back: Math.max(-grown.minX, 0),
    particles: grown.particles,
    primaries: 1,
    hardestPt: 0,
    hardestSpecies: SPECIES_HADRON,
    energyGeV,
  };
}

/** Deterministic LCG, so a site does not boil between frames. */
function rng(seed: number): () => number {
  let state = (Math.abs(Math.round(seed)) | 1) >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Grows a set of tracks into `data` until the budget runs out, hardest first.
 *
 * `transparentRadius` is the one thing here that is not about a wall: inside a detector
 * the first metre or so is deliberately built to weigh nothing — it measures a track's
 * momentum and lets it through — so a particle below that radius is moved straight out to
 * it without interacting. That single rule is why an event display is long clean tracks
 * radiating from the vertex and a spray only where the calorimeter starts. A shower driven
 * into a wall passes 0 and the rule costs nothing.
 */
function cascade(
  pending: Track[],
  rand: () => number,
  data: Float32Array,
  maxSegments: number,
  material: Material,
  transparentRadius: number,
): { count: number; particles: number; maxX: number; minX: number; spread: number } {
  const INTERACTION_LENGTH = material.interactionLength;
  const RADIATION_LENGTH = material.radiationLength;
  let count = 0;
  let particles = pending.length;
  let maxX = 0;
  let minX = 0;
  let spread = 0;

  const priority = (t: Track): number =>
    Math.pow(t.energy, PRIORITY_EXPONENT) * (t.species === SPECIES_EM ? EM_PRIORITY : 1);

  /** Takes the most important particle still waiting; swap-removes it. */
  const takeHardest = (): Track => {
    let best = 0;
    for (let i = 1; i < pending.length; i++) {
      if (priority(pending[i]) > priority(pending[best])) best = i;
    }
    const t = pending[best];
    pending[best] = pending[pending.length - 1];
    pending.pop();
    return t;
  };

  const emit = (t: Track, x1: number, y1: number): void => {
    if (count >= maxSegments) return;
    const o = count * SEGMENT_STRIDE;
    data[o] = t.x;
    data[o + 1] = t.y;
    data[o + 2] = x1;
    data[o + 3] = y1;
    data[o + 4] = t.species;
    data[o + 5] = t.energy;
    data[o + 6] = t.generation;
    count++;
    if (x1 > maxX) maxX = x1;
    if (x1 < minX) minX = x1;
    const across = Math.abs(y1);
    if (across > spread) spread = across;
  };

  while (pending.length > 0 && count < maxSegments) {
      const t = takeHardest();

      // The transparent volume: cross it in one straight segment and interact on the far
      // side of it. See the note on `transparentRadius`.
      if (transparentRadius > 0) {
        const r0 = Math.hypot(t.x, t.y);
        if (r0 < transparentRadius) {
          const b = t.x * t.dx + t.y * t.dy;
          const c = r0 * r0 - transparentRadius * transparentRadius;
          const d = Math.sqrt(Math.max(b * b - c, 0)) - b + 1e-6;
          const ex = t.x + t.dx * d;
          const ey = t.y + t.dy * d;
          emit(t, ex, ey);
          t.x = ex;
          t.y = ey;
          pending.push(t);
          continue;
        }
      }

      // How far this one gets before it does anything. A muon goes until the budget runs
      // out; the electromagnetic component works on the radiation length, everything else
      // on the interaction length.
      // A slow hadron does not get a whole interaction length: it ionises its way to a stop
      // in a few centimetres of copper. Giving every hadron the full 15 cm however soft it
      // was let the wide-angle tail wander a metre out — a 450 GeV shower came out wider
      // than it was long, where a real one is a spike a hand's breadth across at any energy.
      const range = Math.min(1, 0.25 + 0.75 * Math.min(1, t.energy / 3));
      const step =
        penetrates(t.species)
          ? INTERACTION_LENGTH * 12
          : t.species === SPECIES_EM
            ? RADIATION_LENGTH * (0.6 + 0.8 * rand())
            : INTERACTION_LENGTH *
              (0.6 + 0.8 * rand()) *
              range *
              (t.species === SPECIES_NEUTRON ? 1.6 : 1);

      const x1 = t.x + t.dx * step;
      const y1 = t.y + t.dy * step;
      emit(t, x1, y1);

      // Muons and hard isolated leptons do not shower; neutrons that have run down are the
      // end of the tail. Everything else — pions, kaons, the hadrons of a heavy-flavour jet
      // — carries the cascade on.
      if (penetrates(t.species)) continue;
      if (t.species === SPECIES_EM) {
        if (t.energy < CRITICAL_ENERGY || t.emAge >= EM_GENERATIONS) continue;
      } else if (t.energy < HADRON_CUTOFF) {
        continue;
      }

      // The electromagnetic component halves: one photon becomes a pair, one electron
      // radiates a photon. Two children, nearly collinear, energy roughly split. A hadron
      // makes a handful — a real inelastic collision at these energies makes more, but every
      // extra child is budget that comes off the depth of the cascade, and depth is the part
      // that reads.
      const children =
        t.species === SPECIES_EM ? 2 : Math.max(2, Math.min(4, Math.round(1.6 + 0.5 * Math.log(t.energy))));

      // Leading-particle effect: one secondary keeps about half of what came in, the rest
      // share what is left. Without it the cascade dies in three generations and looks like
      // a bush rather than something driving forward into the material.
      const shares: number[] = [];
      let total = 0;
      for (let i = 0; i < children; i++) {
        const w = i === 0 && t.species !== SPECIES_EM ? 1.5 + rand() : rand() * 0.6 + 0.1;
        shares.push(w);
        total += w;
      }

      for (let i = 0; i < children; i++) {
        const energy = (t.energy * shares[i]) / total;
        particles++;

        let species: number;
        if (t.species === SPECIES_EM) {
          species = SPECIES_EM;
        } else {
          const roll = rand();
          species =
            roll < PI_ZERO_FRACTION
              ? SPECIES_EM
              : roll < PI_ZERO_FRACTION + MUON_FRACTION
                ? SPECIES_MUON
                : roll < PI_ZERO_FRACTION + MUON_FRACTION + 0.18
                  ? SPECIES_NEUTRON
                  : SPECIES_HADRON;
        }

        // θ ≈ pT / p, so the energetic ones stay near the axis and the soft ones spray
        // wide. This is the single rule that makes a shower look like a shower: it is a
        // narrow spike of hard particles inside a broad haze of soft ones.
        const pt = species === SPECIES_EM ? PT_TYPICAL * 0.15 : PT_TYPICAL;
        const theta = Math.min(1.2, pt / Math.max(energy, 0.05)) * (rand() * 2 - 1);
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        pending.push({
          x: x1,
          y: y1,
          dx: t.dx * c - t.dy * s,
          dy: t.dx * s + t.dy * c,
          energy,
          species,
          generation: t.generation + 1,
          emAge: species === SPECIES_EM ? t.emAge + 1 : 0,
        });
      }
  }

  return { count, particles, maxX, minX, spread };
}

// --- collisions --------------------------------------------------------------

/**
 * The detector, in units of its own outer radius.
 *
 * The real ATLAS is 11 m in radius and 22 m long, and its tracking volume — the part that
 * is deliberately built to weigh nothing — reaches only 1.15 m, a tenth of the way out.
 * Drawn at those proportions the tracker is a dot and every track is a spray starting
 * almost at the vertex, which is the opposite of what an event display shows and the
 * opposite of what a collision *is* to look at. So the radii below are the drawn detector's
 * and are standardised, exactly as `SHOWER_ASPECT` standardises the shape of a wall
 * cascade; the true metres are quoted here and printed by `check`.
 *
 * What is **not** standardised, and is the physics: how many particles come out, how they
 * are distributed in angle, what species they are, and which of them get all the way
 * through. Those are the numbers below them.
 */
export const TRACKER_RADIUS = 0.42;
/**
 * The shells, outward: tracker, electromagnetic calorimeter, hadronic calorimeter, muon
 * system — every one an outer radius in units of the detector's own.
 *
 * **One list, read by three things**: the renderer draws the boxes from it, the cascade
 * stops treating matter as transparent at the first entry, and the transverse display bins
 * its calorimeter cells between them. They were three copies of the same four numbers and
 * `check:render` existed to assert that two of them still agreed; now there is nothing to
 * disagree.
 */
export const TRACKER_SHELL = 0;
export const EM_SHELL = 1;
export const HAD_SHELL = 2;
export const MUON_SHELL = 3;
export const DETECTOR_SHELLS = [TRACKER_RADIUS, 0.6, 0.8, 1.0] as const;
/** Real dimensions of the thing being drawn [m], for the readouts. */
export const DETECTOR_RADIUS_M = 11;
export const DETECTOR_HALF_LENGTH_M = 22;
/** Real radius of the tracking volume [m] — what the solenoid bend is standardised on. */
export const TRACKER_RADIUS_M = 1.15;
/** Solenoid field the tracker sits in [T]. ATLAS runs 2 T, CMS 3.8. */
export const SOLENOID_FIELD = 2;

/**
 * Calorimeter, in the same units. A hadron calorimeter is ~7 interaction lengths deep and
 * fills a bit over a third of the radius, which is where the ratio comes from; the
 * electromagnetic one is ten times finer-grained in the same sense the wall is.
 */
const DETECTOR_MATERIAL: Material = { interactionLength: 0.055, radiationLength: 0.0055 };

/**
 * Charged multiplicity per unit rapidity at 13.6 TeV, and how it grows with energy.
 *
 * Measured: 6.2 per unit of η at mid-rapidity at 13 TeV, and the growth is close to
 * (√s)^0.23 — which puts 900 GeV, the energy this machine collides at if you are impatient
 * enough to try it before ramping, at 3.3. Both are the measured numbers.
 */
const DN_DETA = 6.2;
const DN_DETA_REFERENCE = 13_600;
const DN_DETA_EXPONENT = 0.23;
/** Rapidity range the event is generated over: |η| < 4 is roughly what is instrumented. */
const ETA_MAX = 4;
/** Mean transverse momentum of a particle out of a soft collision [GeV/c]. */
const MEAN_PT = 0.55;
/** Neutrals per charged particle — π⁰ and neutrons that no tracker sees but a calorimeter does. */
const NEUTRAL_FRACTION = 0.5;

/**
 * The hard tail of the transverse momentum spectrum, and why there has to be one.
 *
 * Almost everything out of a proton–proton collision is soft: an exponential in pT with a
 * mean of 550 MeV, and an exponential means **nothing** ever comes out above a few GeV —
 * e^(−30/0.55) is not a small number, it is zero. But hard scattering between the partons
 * inside the protons is a different process with a different spectrum, a power law, and it is
 * the entire reason anybody built the machine: jets, heavy quarks, W and Z bosons and the
 * Higgs all live out there. So the spectrum is two components, which is what a real one is.
 *
 * `HARD_INDEX` is the power of the tail and `HARD_FRACTION` how much of the event is drawn
 * from it. Both are **soft on purpose**: a real minimum-bias event almost never contains a
 * 10 GeV track and essentially never contains a W, and an event display that showed one every
 * few seconds would be lying by five orders of magnitude. This is a drawing budget of the
 * same kind as the 256 segments — the picture is allowed to be interesting more often than
 * the machine is, and `check` prints what the honest rate would be. The **shape** is real,
 * and so is everything that follows from it: what a track *is* depends on how hard it is.
 */
const HARD_FRACTION = 0.018;
const HARD_INDEX = 3;
/** Where the hard component starts [GeV/c]. */
const HARD_PT_MIN = 1.5;

/**
 * What a track is, given how much transverse momentum it came out with.
 *
 * This is the real ordering and the real reason for it. Making a particle costs energy, so
 * the heavier and rarer the thing, the more transverse momentum the collision had to have to
 * make it:
 *
 *  · below about a GeV it is a **pion**, and so is almost everything — a third of them
 *    neutral, which is where the electromagnetic component comes from;
 *  · a **kaon** carries a strange quark, and strangeness is suppressed in a soft collision
 *    but not much: about a tenth of hadrons, rising slowly;
 *  · **charm and beauty** are heavy enough that they are only made in a hard scatter. A b
 *    hadron flies a few millimetres before it decays, which is how they are identified, and
 *    about a tenth of the time it decays to a muon — a muon *inside* a jet rather than
 *    isolated, which is a signature in itself and is why one is emitted below;
 *  · an **isolated lepton** above ten or twenty GeV is, in practice, a W or a Z that has just
 *    decayed. Nothing else makes one. It is what a trigger is built to catch.
 *
 * The thresholds are real; the probabilities at the top end are generous, for the reason
 * given on `HARD_FRACTION`.
 */
function speciesForPt(pt: number, rand: () => number): number {
  const roll = rand();
  if (pt > 10) {
    if (roll < 0.3) return SPECIES_LEPTON;
    if (roll < 0.65) return SPECIES_HEAVY;
    return SPECIES_HADRON;
  }
  if (pt > 3) {
    if (roll < 0.03) return SPECIES_LEPTON;
    if (roll < 0.21) return SPECIES_HEAVY;
    if (roll < 0.36) return SPECIES_KAON;
    return roll < 0.65 ? SPECIES_EM : SPECIES_HADRON;
  }
  if (pt > 1) {
    if (roll < 0.012) return SPECIES_HEAVY;
    if (roll < 0.14) return SPECIES_KAON;
    return roll < 0.48 ? SPECIES_EM : SPECIES_HADRON;
  }
  // the soft bulk: pions, a tenth of them strange, a few neutrons and the odd decay muon
  if (roll < PI_ZERO_FRACTION) return SPECIES_EM;
  if (roll < PI_ZERO_FRACTION + 0.02) return SPECIES_MUON;
  if (roll < PI_ZERO_FRACTION + 0.02 + 0.09) return SPECIES_KAON;
  if (roll < PI_ZERO_FRACTION + 0.02 + 0.09 + 0.12) return SPECIES_NEUTRON;
  return SPECIES_HADRON;
}

/**
 * One particle out of the collision, before anything has been decided about how to draw it.
 *
 * The generator produces these once and **both views are built from the same list**: the
 * r–z display drawn on the ring and the r–φ display drawn in the experiment's own panel are
 * the same collision seen from two places, not two collisions that happen to look alike. Get
 * that wrong and the panel is decoration — it would show a lepton the ring never saw.
 */
export interface Primary {
  eta: number;
  /** Transverse momentum [GeV/c] — the curvature in the transverse view, and the trigger. */
  pt: number;
  /** Azimuth about the beam axis [rad]. */
  phi: number;
  energy: number;
  species: number;
  /** +1, −1, or 0 for the neutrals, which do not bend in the solenoid. */
  charge: number;
}

/**
 * Charge, without consuming a random draw.
 *
 * Deliberately derived from the index rather than from `rand`: the sequence this generator
 * pulls out of the LCG is what makes the two views the same event and what every measured
 * number in `check` was taken against, so a new draw inserted in the middle of it would
 * quietly re-roll every collision this simulation has ever printed. Photons and neutrons are
 * neutral because they are; everything else is a coin toss.
 */
function chargeOf(species: number, index: number): number {
  if (species === SPECIES_EM || species === SPECIES_NEUTRON) return 0;
  return (Math.imul(index + 1, 2_654_435_761) >>> 28) & 1 ? 1 : -1;
}

/**
 * The particles one inelastic proton–proton collision puts out.
 *
 * The angular distribution is the only part of this that has to be got right for it to look
 * like anything, and it is one line: a soft collision produces particles **flat in rapidity**
 * with a transverse momentum of a few hundred MeV. Multiplicity is `dN_ch/dη` at √s, and the
 * pT spectrum is two components because a real one is — see `HARD_FRACTION`.
 */
export function generatePrimaries(
  cmEnergyGeV: number,
  rand: () => number,
): { primaries: Primary[]; hardestPt: number; hardestSpecies: number } {
  const perEta =
    DN_DETA * Math.pow(Math.max(cmEnergyGeV, 1) / DN_DETA_REFERENCE, DN_DETA_EXPONENT);
  const charged = Math.max(2, Math.round(perEta * 2 * ETA_MAX));
  const total = Math.round(charged * (1 + NEUTRAL_FRACTION));

  const primaries: Primary[] = [];
  let hardestPt = 0;
  let hardestSpecies = SPECIES_HADRON;

  for (let i = 0; i < total; i++) {
    const eta = (rand() * 2 - 1) * ETA_MAX;
    const pt =
      rand() < HARD_FRACTION
        ? HARD_PT_MIN * Math.pow(Math.max(rand(), 1e-9), -1 / (HARD_INDEX - 1))
        : -MEAN_PT * Math.log(Math.max(rand(), 1e-6));
    const phi = rand() * Math.PI * 2;
    const energy = pt * Math.cosh(eta);
    const species = speciesForPt(pt, rand);
    if (pt > hardestPt) {
      hardestPt = pt;
      hardestSpecies = species;
    }
    primaries.push({
      eta,
      pt,
      phi,
      energy: Math.max(energy, HADRON_CUTOFF),
      species,
      charge: chargeOf(species, primaries.length),
    });

    // A b or c hadron decays to a muon about a tenth of the time, and that muon comes out
    // *inside* the jet rather than isolated. It is a real signature and it costs one track:
    // same direction, a third of the momentum.
    if (species === SPECIES_HEAVY && rand() < 0.1) {
      primaries.push({
        eta,
        pt: pt * 0.3,
        phi,
        energy: Math.max(energy * 0.3, HADRON_CUTOFF),
        species: SPECIES_MUON,
        charge: chargeOf(SPECIES_MUON, primaries.length),
      });
    }
  }

  return { primaries, hardestPt, hardestSpecies };
}

/**
 * The event one inelastic proton–proton collision makes, in units of the detector radius —
 * the **r–z view**, the one an experiment puts on the wall and the one drawn on the ring.
 *
 * This is the same cascade as a wall shower and the same function under it — the tree, the
 * species, the budget spent hardest first. What differs is what starts it: not one proton
 * driving into copper, but seventy-odd particles leaving a point in every direction at once,
 * and a detector built so that the first 42 % of the radius does not touch them.
 *
 * The plane drawn contains the beam axis, so a track's direction here is (sinh η, pT in
 * plane) and that is why the picture is a dense spray along the pipe in both directions with
 * a scatter of central tracks across it. What is *lost* in this projection is φ — every
 * track is drawn as though its transverse momentum lay in the picture — and recovering it is
 * the whole reason `buildTransverse` exists.
 *
 * `cmEnergyGeV` is √s: twice the beam energy, since the beams are head-on.
 */
export function buildCollision(cmEnergyGeV: number, seed: number, maxSegments = 256): Shower {
  const data = new Float32Array(maxSegments * SEGMENT_STRIDE);
  const rand = rng(seed);
  const event = generatePrimaries(cmEnergyGeV, rand);

  const pending: Track[] = [];
  for (const p of event.primaries) {
    const along = p.pt * Math.sinh(p.eta);
    const across = p.pt * Math.cos(p.phi);
    const len = Math.hypot(along, across) || 1;
    pending.push({
      x: 0,
      y: 0,
      dx: along / len,
      dy: across / len,
      energy: p.energy,
      species: p.species,
      generation: 0,
      emAge: p.species === SPECIES_EM ? 1 : 0,
    });
  }

  const hardest = event.hardestPt;
  const hardestSpecies = event.hardestSpecies;
  const primaries = pending.length;
  const grown = cascade(
    pending,
    rand,
    data,
    maxSegments,
    DETECTOR_MATERIAL,
    TRACKER_RADIUS,
  );
  return {
    data,
    count: grown.count,
    reach: Math.max(grown.maxX, 1e-6),
    spread: Math.max(grown.spread, 1e-6),
    back: Math.max(-grown.minX, 1e-6),
    particles: grown.particles,
    primaries,
    hardestPt: hardest,
    hardestSpecies,
    energyGeV: cmEnergyGeV,
  };
}


// --- the transverse view -----------------------------------------------------

/** Cells around φ in the two calorimeters, and chambers in one muon station. */
const EM_CELLS_N = 64;
const HAD_CELLS_N = 32;
export const MUON_CHAMBERS = 16;

/**
 * The **r–φ view**: the same collision seen straight down the beam pipe.
 *
 * The r–z display drawn on the ring shows where a collision happened and how much came out
 * of it, and it cannot show anything else, because projecting onto a plane that contains the
 * beam axis throws φ away and puts every track's transverse momentum in the picture whether
 * it was there or not. Looking down the axis instead is a different measurement, and it is
 * the one an experiment is actually built around:
 *
 *  · **tracks curve inside the solenoid and go straight outside it.** A charged particle in
 *    the tracker runs on a circle of radius pT/(0.3 B), and reading that sagitta is how a
 *    tracker weighs anything at all. The field stops at the coil — outside it the barrel
 *    bending is a *toroid*, which bends in r–z and not in this plane — so one track is a
 *    curve for the first 42 % of the radius and a straight line for the rest. That kink is
 *    real, and it is where the momentum measurement ends.
 *  · **the tracker is layers, and what it gives you is hits.** Four pixel layers, four strip
 *    layers and a straw tracker, and a track is not a line anybody drew: it is a fit through
 *    the points it left on them. It is also how a photon is told from an electron — a photon
 *    leaves calorimeter energy with **no hits pointing at it at all**.
 *  · **the calorimeter is cells in depth as well as around.** A particle deposits in a tower
 *    at a particular φ — rotated away from the one it left the vertex at, by exactly the bend
 *    — and at a particular *depth*. An electromagnetic shower is finished by the second
 *    sampling; a hadron is still going in the third and punches into the tile behind it.
 *    Longitudinal sampling is how a real calorimeter separates the two, which is why there
 *    are four EM samplings here and not one ring.
 *  · **what reaches the muon chambers.** Three stations outside eight toroid coils, and a
 *    thing that lights all three has been through eleven metres of lead and steel.
 *
 * ## The two standardisations, and what they buy
 *
 * The drawn radii are not the real ones — a real tracker is a tenth of the detector's radius
 * and would draw as a dot with eight layers inside it — so both the radii and the bend are
 * standardised, and they are standardised *together*:
 *
 *  · **the shells keep their real order and grouping, spread to be resolvable.** `BARREL` is
 *    a real barrel: beam pipe, four pixel layers, four strip layers, a straw tracker, the
 *    solenoid, a presampler and three EM samplings, three tile samplings, three muon stations
 *    outside eight toroid coils. What is not real is how far apart they are.
 *  · **the bend is standardised on the tracker**, so a track's drawn radius is its real radius
 *    scaled by the factor taking the real 1.15 m tracking volume to the drawn `TRACKER_RADIUS`.
 *    That makes the one question this view exists to answer come out exactly right — *which
 *    tracks curl up inside the tracker and never reach the calorimeter* — because both sides
 *    of the comparison scale together. Measured and printed by `check`: **0.345 GeV/c**, which
 *    is the real number for 1.15 m at 2 T.
 */
export const TRANSVERSE_BEND =
  TRACKER_RADIUS / (0.299_792_458 * SOLENOID_FIELD * TRACKER_RADIUS_M);

/** What a barrel layer is for. Drives how it is drawn and what it records. */
export type LayerKind =
  | 'pipe'
  | 'pixel'
  | 'strip'
  | 'straw'
  | 'solenoid'
  | 'em'
  | 'had'
  | 'coil'
  | 'muon';

export interface BarrelLayer {
  name: string;
  kind: LayerKind;
  /** Inner and outer radius, in units of the detector's outer radius. */
  r0: number;
  r1: number;
  /** Cells around φ; 0 for a shell with no segmentation of its own. */
  cells: number;
}

/**
 * The barrel, inner to outer.
 *
 * The group boundaries are `DETECTOR_SHELLS` exactly — tracker ends at 0.42, EM at 0.6,
 * hadronic at 0.8, muon at 1.0 — because those four numbers are what the cascade, the ring
 * renderer and the vertex volume are all built on. Everything between them is structure, and
 * `check` asserts the two still agree.
 */
export const BARREL: readonly BarrelLayer[] = [
  { name: 'beam pipe', kind: 'pipe', r0: 0.022, r1: 0.03, cells: 0 },
  { name: 'pixel L0', kind: 'pixel', r0: 0.052, r1: 0.06, cells: 0 },
  { name: 'pixel L1', kind: 'pixel', r0: 0.082, r1: 0.09, cells: 0 },
  { name: 'pixel L2', kind: 'pixel', r0: 0.112, r1: 0.12, cells: 0 },
  { name: 'pixel L3', kind: 'pixel', r0: 0.142, r1: 0.15, cells: 0 },
  { name: 'strips L0', kind: 'strip', r0: 0.2, r1: 0.21, cells: 0 },
  { name: 'strips L1', kind: 'strip', r0: 0.24, r1: 0.25, cells: 0 },
  { name: 'strips L2', kind: 'strip', r0: 0.28, r1: 0.29, cells: 0 },
  { name: 'strips L3', kind: 'strip', r0: 0.32, r1: 0.33, cells: 0 },
  { name: 'straw tracker', kind: 'straw', r0: 0.348, r1: 0.42, cells: 0 },
  { name: 'solenoid', kind: 'solenoid', r0: 0.42, r1: 0.436, cells: 0 },
  { name: 'presampler', kind: 'em', r0: 0.436, r1: 0.452, cells: EM_CELLS_N },
  { name: 'EM sampling 1', kind: 'em', r0: 0.452, r1: 0.496, cells: EM_CELLS_N },
  { name: 'EM sampling 2', kind: 'em', r0: 0.496, r1: 0.562, cells: EM_CELLS_N },
  { name: 'EM sampling 3', kind: 'em', r0: 0.562, r1: 0.6, cells: EM_CELLS_N },
  { name: 'tile sampling 1', kind: 'had', r0: 0.6, r1: 0.67, cells: HAD_CELLS_N },
  { name: 'tile sampling 2', kind: 'had', r0: 0.67, r1: 0.74, cells: HAD_CELLS_N },
  { name: 'tile sampling 3', kind: 'had', r0: 0.74, r1: 0.8, cells: HAD_CELLS_N },
  { name: 'toroid coils', kind: 'coil', r0: 0.845, r1: 0.95, cells: 8 },
  { name: 'muon BI', kind: 'muon', r0: 0.812, r1: 0.836, cells: MUON_CHAMBERS },
  { name: 'muon BM', kind: 'muon', r0: 0.884, r1: 0.908, cells: MUON_CHAMBERS },
  { name: 'muon BO', kind: 'muon', r0: 0.958, r1: 0.982, cells: MUON_CHAMBERS },
];

/**
 * Calorimeter segmentation.
 *
 * Around φ: finer in the electromagnetic layer than in the hadronic one, which is the real
 * ordering and the reason an electron is a sharp thing and a jet is not (a real EM
 * calorimeter is ~256 cells round and a hadronic one ~64, so both of these are a budget with
 * the ratio kept). In depth: **four EM samplings and three tile samplings**, because
 * longitudinal segmentation is not decoration — it is the measurement that separates a
 * photon, finished by sampling 2, from a pion, still going at sampling 3 and punching into
 * the tile behind it.
 */
export const EM_CELLS = EM_CELLS_N;
export const HAD_CELLS = HAD_CELLS_N;
export const EM_SAMPLINGS = 4;
export const HAD_SAMPLINGS = 3;
/** Muon stations, outward. */
export const MUON_STATIONS = 3;

/**
 * How a stopping particle shares itself out in depth.
 *
 * An electromagnetic shower peaks a few radiation lengths in and is over: most of it lands in
 * sampling 2 and almost nothing survives to the tile. A hadron ionises its way through the EM
 * calorimeter leaving roughly a third of itself spread fairly evenly, then showers in the
 * tile. A muon is minimum-ionising and leaves a flat trace of almost nothing everywhere,
 * which is exactly how one is recognised.
 */
const EM_PROFILE_EM = [0.06, 0.22, 0.55, 0.17];
const EM_PROFILE_HADRON = [0.1, 0.25, 0.4, 0.25];
const HAD_PROFILE = [0.45, 0.35, 0.2];
/** Fraction a hadron leaves in the EM calorimeter on its way through. */
const HADRON_EM_FRACTION = 0.35;
/** What a minimum-ionising particle leaves in a calorimeter, as a fraction of its pT. */
const MIP_FRACTION = 0.02;

/**
 * Lateral spread of a shower, in cells.
 *
 * A shower is not one tower. An electromagnetic one is narrow — a couple of cells, which is
 * why a photon reads as a spike — and a hadronic one is wide, which is why a jet reads as a
 * clump. Depositing everything into a single cell drew spikes for both and lost the one
 * difference between them the eye gets at a glance.
 */
const EM_LATERAL = [0.15, 0.7, 0.15];
const HAD_LATERAL = [0.22, 0.56, 0.22];

/**
 * Tracks drawn, hardest first, and the momentum below which one is not drawn at all.
 *
 * Every primary deposits and every charged one leaves hits — the tracker picture is the whole
 * event — but a hundred spiralling 200 MeV tracks drawn on top of each other is a disc, not a
 * display, and a real event display applies exactly this cut for exactly this reason.
 * 0.3 GeV/c is also, and not by coincidence, about where a track stops being able to leave
 * the tracker at all.
 */
const TRACK_BUDGET = 56;
const TRACK_PT_MIN = 0.3;
/** Hard objects labelled on the display, and the momentum worth labelling. */
const LABEL_BUDGET = 5;
const LABEL_PT_MIN = 1.5;

/** Hit layout: x, y, kind — stride 3. */
export const HIT_STRIDE = 3;
export const HIT_SILICON = 0;
export const HIT_STRAW = 1;

/** Radii the silicon layers record at, the three straw samplings, and the muon stations. */
const SILICON_RADII = BARREL.filter((l) => l.kind === 'pixel' || l.kind === 'strip').map(
  (l) => (l.r0 + l.r1) / 2,
);
const STRAW_RADII = [0.362, 0.384, 0.406];
const MUON_RADII = BARREL.filter((l) => l.kind === 'muon').map((l) => (l.r0 + l.r1) / 2);

/** One labelled object: what it was, how hard, and where it ended up. */
export interface EventObject {
  species: number;
  pt: number;
  x: number;
  y: number;
  /** True if it left no track in the tracker — a neutral, known only by its energy. */
  neutral: boolean;
}

export interface TransverseEvent {
  /** Drawn tracks, `SEGMENT_STRIDE` floats per segment, in units of the detector radius. */
  data: Float32Array;
  count: number;
  /** Tracker hits, `HIT_STRIDE` floats each — what the tracker actually measures. */
  hits: Float32Array;
  hitCount: number;
  /** Transverse energy per calorimeter cell [GeV], indexed `sampling * cells + cell`. */
  em: Float32Array;
  had: Float32Array;
  /** Muon chambers that fired, indexed `station * MUON_CHAMBERS + chamber`. */
  muon: Uint8Array;
  /** Brightest cell in each calorimeter [GeV], so a display can normalise without rescanning. */
  emPeak: number;
  hadPeak: number;
  /** The hardest few objects, for labelling. */
  objects: EventObject[];
  /** Particles out of the collision, tracks drawn, and how many never left the tracker. */
  primaries: number;
  drawn: number;
  loopers: number;
  /** Charged particles, and how many things the muon chambers saw. */
  charged: number;
  muonTracks: number;
  /** Sum of pT over everything that came out [GeV] — the size of the event. */
  sumEt: number;
  hardestPt: number;
  hardestSpecies: number;
  energyGeV: number;
}

/**
 * A track's geometry: an arc of a circle through the origin, radius `TRANSVERSE_BEND · pT`,
 * tangent to φ at the vertex — and a straight line from wherever it leaves the solenoid.
 *
 * One sign convention, applied once. Get it wrong and half the event bends backwards.
 */
interface TrackGeometry {
  /** Bending radius, or Infinity for a neutral. */
  R: number;
  cx: number;
  cy: number;
  theta0: number;
  charge: number;
  phi: number;
  /** Arclength at which it leaves the solenoid, or Infinity if it never does. */
  exit: number;
  /** Where it leaves, and the direction it leaves on. */
  ex: number;
  ey: number;
  edx: number;
  edy: number;
}

/** Arclength at which an arc of radius R through the origin first reaches radius `r`. */
function arcTo(R: number, r: number): number {
  if (!Number.isFinite(R)) return r;
  // The distance from the vertex is 2R·sin(s/2R), so 2R is as far as the circle ever gets: a
  // track with 2R below the layer radius simply cannot reach it, and that is a looper.
  if (r > 2 * R) return Infinity;
  return 2 * R * Math.asin(r / (2 * R));
}

function trackGeometry(p: Primary): TrackGeometry {
  const field = DETECTOR_SHELLS[TRACKER_SHELL];
  if (p.charge === 0 || p.pt < 1e-6) {
    return {
      R: Infinity,
      cx: 0,
      cy: 0,
      theta0: 0,
      charge: 0,
      phi: p.phi,
      exit: field,
      ex: Math.cos(p.phi) * field,
      ey: Math.sin(p.phi) * field,
      edx: Math.cos(p.phi),
      edy: Math.sin(p.phi),
    };
  }
  const R = TRANSVERSE_BEND * p.pt;
  const cx = R * p.charge * Math.sin(p.phi);
  const cy = -R * p.charge * Math.cos(p.phi);
  const theta0 = Math.atan2(-cy, -cx);
  const exit = arcTo(R, field);
  const g: TrackGeometry = {
    R, cx, cy, theta0, charge: p.charge, phi: p.phi, exit,
    ex: 0, ey: 0, edx: 0, edy: 0,
  };
  if (Number.isFinite(exit)) {
    const theta = theta0 - (p.charge * exit) / R;
    g.ex = cx + R * Math.cos(theta);
    g.ey = cy + R * Math.sin(theta);
    // The tangent there, which is where it goes once the field stops.
    g.edx = Math.sin(theta) * p.charge;
    g.edy = -Math.cos(theta) * p.charge;
  }
  return g;
}

/** Point on a track at arclength `s`: curving inside the solenoid, straight outside it. */
function pointAt(g: TrackGeometry, s: number, out: { x: number; y: number }): void {
  if (!Number.isFinite(g.R)) {
    out.x = Math.cos(g.phi) * s;
    out.y = Math.sin(g.phi) * s;
    return;
  }
  if (s <= g.exit) {
    const theta = g.theta0 - (g.charge * s) / g.R;
    out.x = g.cx + g.R * Math.cos(theta);
    out.y = g.cy + g.R * Math.sin(theta);
    return;
  }
  const d = s - g.exit;
  out.x = g.ex + g.edx * d;
  out.y = g.ey + g.edy * d;
}

/** Cell index of an azimuth, 0..cells−1. */
function cellOf(phi: number, cells: number): number {
  const t = phi / (Math.PI * 2);
  return ((Math.floor(t * cells) % cells) + cells) % cells;
}

/** Adds `energy` to a calorimeter, spread over depth and over the cells either side. */
function deposit(
  into: Float32Array,
  cells: number,
  centre: number,
  energy: number,
  profile: readonly number[],
  lateral: readonly number[],
): void {
  for (let s = 0; s < profile.length; s++) {
    for (let k = 0; k < lateral.length; k++) {
      const c = (((centre + k - (lateral.length >> 1)) % cells) + cells) % cells;
      into[s * cells + c] += energy * profile[s] * lateral[k];
    }
  }
}

export function buildTransverse(
  cmEnergyGeV: number,
  seed: number,
  maxSegments = 512,
  maxHits = 1024,
): TransverseEvent {
  const rand = rng(seed);
  const event = generatePrimaries(cmEnergyGeV, rand);
  const data = new Float32Array(maxSegments * SEGMENT_STRIDE);
  const hits = new Float32Array(maxHits * HIT_STRIDE);
  const em = new Float32Array(EM_SAMPLINGS * EM_CELLS);
  const had = new Float32Array(HAD_SAMPLINGS * HAD_CELLS);
  const muon = new Uint8Array(MUON_STATIONS * MUON_CHAMBERS);

  const face = DETECTOR_SHELLS[TRACKER_SHELL];

  // Hardest first, the same rule the cascade spends its budget by, so the tracks that get
  // drawn and labelled are the ones the event would have been kept for.
  const order = event.primaries.map((_, i) => i);
  order.sort((a, b) => event.primaries[b].pt - event.primaries[a].pt);

  const at = { x: 0, y: 0 };
  const objects: EventObject[] = [];
  let count = 0;
  let hitCount = 0;
  let drawn = 0;
  let loopers = 0;
  let charged = 0;
  let muonTracks = 0;
  let sumEt = 0;

  for (const index of order) {
    const p = event.primaries[index];
    sumEt += p.pt;
    if (p.charge !== 0) charged++;
    const g = trackGeometry(p);
    const through = penetrates(p.species);
    const looped = !Number.isFinite(g.exit);

    if (looped) loopers++;

    // **Hits, which are what a tracker measures.** Only charged particles leave them, and
    // that is the whole of how a photon is told from an electron: calorimeter energy with
    // nothing pointing at it. A looper still lights the inner layers it does reach, which is
    // real, and is most of what a soft event puts on the pixels.
    if (p.charge !== 0) {
      for (const [radii, kind] of [
        [SILICON_RADII, HIT_SILICON],
        [STRAW_RADII, HIT_STRAW],
      ] as const) {
        for (const r of radii) {
          const s = arcTo(g.R, r);
          if (!Number.isFinite(s) || hitCount >= maxHits) continue;
          pointAt(g, s, at);
          const o = hitCount * HIT_STRIDE;
          hits[o] = at.x;
          hits[o + 1] = at.y;
          hits[o + 2] = kind;
          hitCount++;
        }
      }
    }

    // What it left in the calorimeters, at the azimuth the bend delivered it to.
    if (!looped) {
      pointAt(g, g.exit, at);
      const phiFace = Math.atan2(at.y, at.x);
      const emCell = cellOf(phiFace, EM_CELLS);
      const hadCell = cellOf(phiFace, HAD_CELLS);
      if (through) {
        deposit(em, EM_CELLS, emCell, p.pt * MIP_FRACTION, EM_PROFILE_HADRON, EM_LATERAL);
        deposit(had, HAD_CELLS, hadCell, p.pt * MIP_FRACTION, HAD_PROFILE, HAD_LATERAL);
        // And the stations it lights on the way out, each at its own azimuth: outside the
        // solenoid the track is straight, so the muon system sees it somewhere else again.
        for (let st = 0; st < MUON_RADII.length; st++) {
          pointAt(g, g.exit + (MUON_RADII[st] - face), at);
          muon[st * MUON_CHAMBERS + cellOf(Math.atan2(at.y, at.x), MUON_CHAMBERS)] = 1;
        }
        muonTracks++;
      } else if (p.species === SPECIES_EM) {
        deposit(em, EM_CELLS, emCell, p.pt, EM_PROFILE_EM, EM_LATERAL);
      } else {
        deposit(em, EM_CELLS, emCell, p.pt * HADRON_EM_FRACTION, EM_PROFILE_HADRON, EM_LATERAL);
        deposit(had, HAD_CELLS, hadCell, p.pt * (1 - HADRON_EM_FRACTION), HAD_PROFILE, HAD_LATERAL);
      }
    }

    if (drawn >= TRACK_BUDGET || p.pt < TRACK_PT_MIN) continue;

    // The polyline. Sampled by turned angle inside the solenoid so an arc reads as an arc,
    // and with one more point outside it, because a straight line needs no more than that.
    const path = looped ? Math.min(Math.PI * 2 * g.R, 3.2) : g.exit;
    const turns = Number.isFinite(g.R) ? path / g.R : 0;
    const steps = Math.max(2, Math.min(24, Math.ceil(turns / 0.18) + 2));
    const points: number[] = [];
    for (let i = 0; i <= steps; i++) {
      pointAt(g, (path * i) / steps, at);
      points.push(at.x, at.y);
    }
    // Outside the solenoid the track is a straight line, so it needs no sampling for its own
    // sake — but a point at each muon station is worth having: it puts a visible node where
    // the chambers are, and it is what makes "this stopped bending when the field stopped"
    // something `check:render` can measure rather than something the comment asserts.
    if (!looped && through) {
      for (const r of MUON_RADII) {
        pointAt(g, g.exit + (r - face), at);
        points.push(at.x, at.y);
      }
    }
    if (count + points.length / 2 > maxSegments) continue;
    drawn++;
    for (let k = 2; k < points.length; k += 2) {
      const o = count * SEGMENT_STRIDE;
      data[o] = points[k - 2];
      data[o + 1] = points[k - 1];
      data[o + 2] = points[k];
      data[o + 3] = points[k + 1];
      data[o + 4] = p.species;
      data[o + 5] = p.energy;
      // Neutrals are drawn faint: they are a reconstruction, not a measurement, and the
      // picture must not claim the tracker saw one.
      data[o + 6] = p.charge === 0 ? 1 : 0;
      // The spare column of the stride carries pT, which is what a transverse track *is*.
      data[o + 7] = p.pt;
      count++;
      if (count >= maxSegments) break;
    }

    if (objects.length < LABEL_BUDGET && p.pt >= LABEL_PT_MIN && !looped) {
      objects.push({
        species: p.species,
        pt: p.pt,
        x: points[points.length - 2],
        y: points[points.length - 1],
        neutral: p.charge === 0,
      });
    }
  }

  let emPeak = 0;
  let hadPeak = 0;
  for (const v of em) if (v > emPeak) emPeak = v;
  for (const v of had) if (v > hadPeak) hadPeak = v;

  return {
    data,
    count,
    hits,
    hitCount,
    em,
    had,
    muon,
    emPeak,
    hadPeak,
    objects,
    primaries: event.primaries.length,
    drawn,
    loopers,
    charged,
    muonTracks,
    sumEt,
    hardestPt: event.hardestPt,
    hardestSpecies: event.hardestSpecies,
    energyGeV: cmEnergyGeV,
  };
}
