/**
 * What the experiments make of the collisions they have collected: **mass spectra**.
 *
 * ## Why this is here at all
 *
 * Everything else in this simulation is a machine. This is the only part that is an
 * *experiment*: the point of running the accelerator is not the luminosity, it is what the
 * luminosity is turned into, and that is one plot — the invariant mass of two objects, binned,
 * with everything anybody has ever discovered sitting on it as a bump.
 *
 * A collision by itself says nothing; a million of them say J/ψ, Υ, Z. So this is the thing
 * that grows while the machine runs and does not reset when the beams are dumped, and it is
 * the reason to keep running rather than to look at one event display and close the tab.
 *
 * ## It is computed, not sampled — the same argument as the luminosity
 *
 * The obvious implementation is to take the events this simulation actually builds a cascade
 * for, pair up their tracks and histogram that. It is wrong for the same reason sampling the
 * luminosity once a frame was wrong (see `world.ts`): a cascade is built for about one
 * collision per pass of two batches, so the histogram would be a picture of the *drawing
 * budget* rather than of the beam. A real experiment records a billion collisions a second
 * and this one draws two.
 *
 * So the spectrum is what ∫L dt implies, exactly:
 *
 *     N(bin) = ∫L dt × Σ_source σ_eff × (fraction of that source falling in the bin)
 *
 * with the cross-sections real and the acceptance folded into `σ_eff` (see `limits.md`).
 * Nothing accumulates frame by frame and nothing depends on the frame rate: the whole
 * histogram is a function of one number, the integrated luminosity, and that is the number the
 * operator is playing for.
 *
 * ## One realisation, frozen
 *
 * The expectation alone draws a smooth curve, which is a *theory* plot and not a measurement —
 * and a discovery is a statistical statement, so the bins have to fluctuate. Each bin carries a
 * standard normal drawn once at construction and the count shown is `N + z√N`: Poisson
 * fluctuation to first order, one realisation, frozen — so the plot grows without shimmering,
 * which it would do if the fluctuation were re-rolled every frame. The **significance** is
 * computed from the expectation rather than from the fluctuated bins, because that is what it
 * means: how big the signal is against how big the background's own noise is.
 */

/** 1 nb⁻¹ in cm⁻². Cross-sections here are in nanobarns, luminosity in cm⁻². */
export const NANOBARN_INVERSE = 1e33;

/**
 * One thing that puts pairs of objects at a particular invariant mass.
 *
 * `sigma` is an *effective* cross-section: production × branching ratio to the pair × the
 * fraction of them a detector sees and reconstructs. Folding acceptance into one number per
 * source is the departure here — a real analysis measures it per pT and per rapidity — and the
 * production cross-sections and the masses themselves are the real ones. See `limits.md`.
 */
export interface MassSource {
  name: string;
  /** Effective cross-section [nb]: production × branching × acceptance. */
  sigma: number;
  /** Rest mass [GeV/c²], or 0 for a continuum. */
  mass: number;
  /** Natural width [GeV], as a FWHM. Zero for anything narrower than the resolution. */
  width: number;
  /** Continuum only: dN/dm ∝ m^(−index) between `lo` and `hi`. */
  index?: number;
  lo?: number;
  hi?: number;
  /** Drawn on the plot when the peak has anything in it. */
  label?: string;
}

/**
 * Dimuon resolution, as a fraction of the mass.
 *
 * A real tracker measures a muon's momentum from the sagitta of its curve, so the *relative*
 * resolution is roughly constant in this range and about a per cent and a half — which is why
 * the Z peak on a real plot is three or four GeV wide when its natural width is 2.5, and why
 * the J/ψ is a spike. Both come out right from one number.
 */
export const DIMUON_RESOLUTION = 0.015;
/**
 * Diphoton mass resolution, as a fraction.
 *
 * The whole of why H → γγ is a discovery channel with a branching ratio of two per mille: a
 * calorimeter measures a photon to about 1.3 %, so a 125 GeV Higgs sits in a 1.6 GeV window
 * against a background that is 60 GeV wide. Resolution *is* the signal-to-background here.
 */
export const DIPHOTON_RESOLUTION = 0.013;

/**
 * The dimuon spectrum, 1 to 200 GeV — the most reproduced plot in particle physics.
 *
 * Everything on it is real: masses, widths, and cross-sections that reproduce the ratios a
 * real experiment measures — a hundred J/ψ for every Z. What is folded in rather than
 * modelled is acceptance, and what is absent is any reconstruction at all.
 */
export const DIMUON_SOURCES: readonly MassSource[] = [
  { name: 'continuum', sigma: 420, mass: 0, width: 0, index: 3.2, lo: 1, hi: 200 },
  { name: 'jpsi', sigma: 78, mass: 3.0969, width: 0, label: 'J/ψ' },
  { name: 'psi2s', sigma: 2.4, mass: 3.6861, width: 0, label: "ψ'" },
  { name: 'upsilon1s', sigma: 3.0, mass: 9.4603, width: 0, label: 'Υ' },
  { name: 'upsilon2s', sigma: 1.0, mass: 10.0234, width: 0 },
  { name: 'upsilon3s', sigma: 0.6, mass: 10.3552, width: 0 },
  { name: 'z', sigma: 0.8, mass: 91.1876, width: 2.4952, label: 'Z' },
];

/**
 * The diphoton spectrum in the Higgs window, and why it is the one to watch.
 *
 * σ(pp → H) is 55 pb at 13.6 TeV and H → γγ takes 2.27 per mille of it, so the signal is
 * ~0.05 pb after acceptance against a continuum background four hundred times bigger. That
 * ratio is the real one, and it is the reason the 2012 discovery needed years of running and
 * two experiments: a bump of a few hundred events on a hundred thousand.
 *
 * **`HIGGS_BOOST` is a game budget and the one number here that is not real.** At the true
 * rate a five-sigma excess wants some tens of fb⁻¹, which is hours of play at a nominal fill
 * and days at the one or two batches a session usually runs. Boosted, an attentive operator
 * gets there in a few fb⁻¹. Everything else — the mass, the width, the resolution, the shape
 * and normalisation of the background — is real, and `check` prints what the honest exposure
 * would have been. See `limits.md`.
 */
export const HIGGS_BOOST = 4;
export const HIGGS_MASS = 125.2;
export const DIPHOTON_SOURCES: readonly MassSource[] = [
  // 20 pb of continuum across the window against 0.05 pb of signal — the real ratio, and the
  // reason this took two experiments and years of running.
  { name: 'continuum', sigma: 0.02, mass: 0, width: 0, index: 5.5, lo: 100, hi: 160 },
  { name: 'higgs', sigma: 5e-5 * HIGGS_BOOST, mass: HIGGS_MASS, width: 0, label: 'H → γγ' },
];

/**
 * A binned mass spectrum: the bins, and what each source puts in each of them.
 *
 * The per-source breakdown is kept rather than summed, because the plot draws the total and
 * the significance needs the signal and the background apart — and because a peak label is
 * only worth drawing once its own source has anything in it.
 */
export class MassSpectrum {
  /** Bin edges [GeV], `bins.length + 1` of them. */
  readonly edges: Float64Array;
  /** Fraction of each source falling in each bin: `share[source][bin]`. */
  private readonly share: Float64Array[];
  /** One standard normal per bin, drawn once — see the header. */
  private readonly noise: Float64Array;
  private readonly counts: Float64Array;

  constructor(
    readonly sources: readonly MassSource[],
    lo: number,
    hi: number,
    bins: number,
    readonly logarithmic: boolean,
    readonly resolution: number,
    seed = 1,
  ) {
    this.edges = new Float64Array(bins + 1);
    for (let i = 0; i <= bins; i++) {
      const t = i / bins;
      this.edges[i] = logarithmic ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t;
    }
    this.counts = new Float64Array(bins);
    this.share = sources.map((s) => this.shareOf(s));
    this.noise = new Float64Array(bins);
    let state = seed >>> 0;
    for (let i = 0; i < bins; i++) {
      // Box–Muller off the same LCG the rest of the model uses.
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const u1 = Math.max(state / 4294967296, 1e-9);
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const u2 = state / 4294967296;
      this.noise[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
  }

  get binCount(): number {
    return this.counts.length;
  }

  /** Where a source's cross-section lands, bin by bin, normalised to 1 over the plot. */
  private shareOf(source: MassSource): Float64Array {
    const n = this.binCount;
    const out = new Float64Array(n);
    let sum = 0;
    if (source.mass === 0) {
      // A continuum: dN/dm ∝ m^(−p), integrated over each bin exactly.
      const p = source.index ?? 3;
      const lo = source.lo ?? this.edges[0];
      const hi = source.hi ?? this.edges[n];
      const anti = (m: number): number => Math.pow(m, 1 - p) / (1 - p);
      for (let i = 0; i < n; i++) {
        const a = Math.max(this.edges[i], lo);
        const b = Math.min(this.edges[i + 1], hi);
        const v = b > a ? anti(b) - anti(a) : 0;
        out[i] = v;
        sum += v;
      }
    } else {
      // A resonance: natural width and detector resolution added in quadrature, integrated
      // over each bin with the error function rather than sampled at the bin centre — the
      // bins are wider than the J/ψ peak, and sampling a pdf that narrow gives nonsense.
      const natural = source.width / 2.3548;
      const smearing = this.resolution * source.mass;
      const sigma = Math.hypot(natural, smearing);
      for (let i = 0; i < n; i++) {
        const v =
          gaussianCdf(this.edges[i + 1], source.mass, sigma) -
          gaussianCdf(this.edges[i], source.mass, sigma);
        out[i] = v;
        sum += v;
      }
    }
    if (sum > 0) for (let i = 0; i < n; i++) out[i] /= sum;
    return out;
  }

  /**
   * The histogram at this exposure: counts per bin, fluctuated once and for all.
   *
   * `integrated` is ∫L dt in cm⁻², summed over whatever experiments are being combined —
   * which is what a combination *is*, and is why the discovery below arrives sooner with both
   * insertions running than with one.
   */
  at(integrated: number): Float64Array {
    const nb = integrated / NANOBARN_INVERSE;
    for (let i = 0; i < this.counts.length; i++) {
      let expected = 0;
      for (let s = 0; s < this.sources.length; s++) {
        expected += this.sources[s].sigma * nb * this.share[s][i];
      }
      this.counts[i] = Math.max(0, expected + this.noise[i] * Math.sqrt(expected));
    }
    return this.counts;
  }

  /** Expected counts from one named source, over the whole plot. */
  expected(name: string, integrated: number): number {
    const source = this.sources.find((s) => s.name === name);
    return source ? (source.sigma * integrated) / NANOBARN_INVERSE : 0;
  }

  /**
   * Expected counts from one source inside `±halfWidth` of a mass — the counting window a
   * search actually uses.
   */
  expectedIn(name: string, integrated: number, mass: number, halfWidth: number): number {
    const index = this.sources.findIndex((s) => s.name === name);
    if (index < 0) return 0;
    const total = (this.sources[index].sigma * integrated) / NANOBARN_INVERSE;
    let fraction = 0;
    for (let i = 0; i < this.binCount; i++) {
      const centre = (this.edges[i] + this.edges[i + 1]) / 2;
      if (Math.abs(centre - mass) <= halfWidth) fraction += this.share[index][i];
    }
    return total * fraction;
  }
}

/**
 * How wide a counting window to use, in units of the mass resolution.
 *
 * ±1.4σ is close to the optimum for a Gaussian signal on a flat background — it keeps 84 % of
 * the signal and lets in as little background as possible — and it is what a real cut-and-count
 * analysis lands on before anybody fits anything.
 */
export const SEARCH_WINDOW_SIGMA = 1.4;
/** The number every experiment is built to reach. */
export const DISCOVERY_SIGMA = 5;

/**
 * Everything the two experiments have collected, turned into the two plots.
 *
 * Owned by `World` and fed one number — the integrated luminosity, summed over the insertions.
 * A dump does not reset it: the data is on tape, which is the whole point of the thing and the
 * reason a session has an arc rather than a stationary state.
 */
export class Analysis {
  readonly dimuon = new MassSpectrum(DIMUON_SOURCES, 1, 200, 72, true, DIMUON_RESOLUTION, 0x5eed);
  readonly diphoton = new MassSpectrum(
    DIPHOTON_SOURCES,
    100,
    160,
    30,
    false,
    DIPHOTON_RESOLUTION,
    0xc0ffee,
  );

  /** ∫L dt over both insertions [cm⁻²] — what every number here is a function of. */
  integrated = 0;

  /** True once the diphoton excess has passed five sigma, and the exposure it took. */
  discovered = false;
  discoveredAt = 0;

  /** Signal and background in the Higgs counting window, and what that is worth in sigma. */
  get higgsWindow(): { signal: number; background: number; sigma: number } {
    const half = SEARCH_WINDOW_SIGMA * DIPHOTON_RESOLUTION * HIGGS_MASS;
    const signal = this.diphoton.expectedIn('higgs', this.integrated, HIGGS_MASS, half);
    const background = this.diphoton.expectedIn('continuum', this.integrated, HIGGS_MASS, half);
    return { signal, background, sigma: background > 0 ? signal / Math.sqrt(background) : 0 };
  }

  /**
   * Adds the luminosity collected in `dt` seconds of machine time.
   *
   * Returns the message to put in the log if this was the moment something crossed five sigma,
   * and null otherwise — a discovery is announced once.
   */
  advance(luminosity: number, dtMachine: number): string | null {
    this.integrated += luminosity * dtMachine;
    if (!this.discovered && this.higgsWindow.sigma >= DISCOVERY_SIGMA) {
      this.discovered = true;
      this.discoveredAt = this.integrated;
      return (
        `DISCOVERY — a ${HIGGS_MASS.toFixed(1)} GeV excess in γγ at ` +
        `${DISCOVERY_SIGMA.toFixed(0)}σ. That is a Higgs boson.`
      );
    }
    return null;
  }
}

/** Φ((x−μ)/σ), on Abramowitz & Stegun 7.1.26 — good to 1.5e-7, which is far more than enough. */
function gaussianCdf(x: number, mean: number, sigma: number): number {
  const z = (x - mean) / (sigma * Math.SQRT2);
  return 0.5 * (1 + erf(z));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
}
