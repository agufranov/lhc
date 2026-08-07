const PREFIXES: Array<[number, string]> = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
];

/** 26_658 W → "26.7 kW". */
export function si(value: number, unit: string, digits = 1): string {
  const abs = Math.abs(value);
  if (abs < 1e-12) return `0 ${unit}`;
  for (const [factor, prefix] of PREFIXES) {
    if (abs >= factor) {
      const scaled = value / factor;
      const d = Math.abs(scaled) >= 100 ? Math.max(digits - 1, 0) : digits;
      return `${scaled.toFixed(d)} ${prefix}${unit}`;
    }
  }
  return `${value.toExponential(digits)} ${unit}`;
}

export function fixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

export function energyGeV(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} TeV` : `${value.toFixed(0)} GeV`;
}

/** Clock as mm:ss for the machine timeline. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * A span of machine time, at the coarsest unit that still says something: `40 s`, `12 min`,
 * `3.4 h`.
 *
 * `clock` is for a timeline — where you are — and reads as a clock. This is for a *duration*
 * compared against another duration, where 3:27:31 is three glyphs of noise and "3.4 h" is
 * the answer. Both are in the run panel, side by side, doing different jobs.
 */
export function duration(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 90) return `${s.toFixed(0)} s`;
  if (s < 5400) return `${(s / 60).toFixed(0)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

export function count(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
