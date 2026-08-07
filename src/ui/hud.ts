import type { World } from '../sim/world';
import { INJECTOR_CYCLE } from '../sim/world';
import {
  BATCH_LENGTH,
  FEMTOBARN_INVERSE,
  INSERTION_COOLING,
  SIGMA_INELASTIC,
} from '../sim/detector';
import { DISCOVERY_SIGMA, HIGGS_MASS } from '../sim/analysis';
import { speciesName } from '../sim/shower';
import { SpectrumView } from '../render/spectrum';
import { magnetColor, rgba, clamp01 } from '../render/palette';
import { verdictFor } from '../sim/damage';
import { OPERATING_TEMPERATURE } from '../sim/powering';
import { Readout } from './readout';
import { EventPanel } from './eventPanel';
import { clock, count, duration, energyGeV, fixed, si } from './format';

export interface FrameStats {
  fps: number;
  stepsThisFrame: number;
  frameMs: number;
}

/**
 * Entries a peak needs before it is ticked off as rediscovered.
 *
 * Not a physical threshold — the plot draws whatever is there — but a claim needs enough to
 * stand on, and a hundred events in a peak is where one stops being a wobble on a log plot.
 */
const PEAK_VISIBLE = 100;
/** Lines of the chronicle kept on screen. It is a rail panel, not a terminal. */
const LOG_LINES = 5;
/** Wall seconds an alarm holds the ticker before it goes back to saying what is going on. */
const ALARM_HOLD = 9;

interface SectorRow {
  root: HTMLElement;
  bar: HTMLElement;
  power: HTMLElement;
}

export class Hud {
  private beam: Readout;
  private physics: Readout;
  private power: Readout;
  private compute: Readout;
  private injector: Readout;
  private sectors: SectorRow[] = [];
  private events: EventPanel[] = [];
  private eventRail: HTMLElement | null = null;

  /** The run: the two spectra, the fill in progress, and the machine's own chronicle. */
  private run!: Readout;
  private dimuon!: SpectrumView;
  private diphoton!: SpectrumView;
  private report!: HTMLElement;
  private reportRows!: Map<string, HTMLElement>;
  private logRoot!: HTMLElement;
  private ticker: HTMLElement | null = null;
  /** How much of the chronicle is already on screen, so it is not rebuilt every frame. */
  private loggedLines = 0;
  private reportsShown = 0;
  /** Exposure the spectra were last drawn at — they are redrawn when it has moved enough. */
  private drawnAt = -1;

  constructor(world: World) {
    const machine = world.collider;
    this.beam = new Readout(document.getElementById('panel-beam')!, 'beam');
    this.beam.row('energy', 'energy');
    this.beam.row('momentum', 'momentum');
    this.beam.row('gamma', 'γ');
    this.beam.row('beta', '1 − β', 'how far the protons are from the speed of light');
    this.beam.row('field', 'dipole field');
    this.beam.row('radius', 'bending ρ');
    this.beam.separator();
    this.beam.row('beam1', 'beam 1', 'batches going clockwise, the way TI 2 delivers');
    this.beam.row('beam2', 'beam 2', 'batches going the other way, delivered by TI 8');
    this.beam.row('flight', 'in transfer', 'bunches in a line, captured by no ring');
    this.beam.row('fill', 'fill', 'a nominal fill is 12 SPS batches');
    this.beam.row('offset', 'orbit offset', 'transverse distance from the closed orbit');
    this.beam.row(
      'realpipe',
      'vs real pipe',
      'the simulated aperture is deliberately huge so a field-free straight line is visible; this is what a real ±28.9 mm pipe would have made of the same offset',
    );
    this.beam.row('frev', 'f_rev');
    this.beam.row('screen', 'on screen', 'one clock for the whole complex, and it does not change with energy — a ramp does not make the beam go round any faster');
    this.beam.row('turns', 'turns');
    this.beam.row('beamclock', 'beam clock');
    this.beam.row('stored', 'stored beam E');
    this.beam.row(
      'intensity',
      'intensity',
      'protons left in a circulating batch, as a fraction of the one the chain delivered. ' +
        'Collisions are the only thing that consumes beam here — two protons leave per ' +
        'inelastic interaction — and what they take is population and nothing else: the ' +
        'protons that are left are exactly as energetic. That is why a burning fill is drawn ' +
        'thinner and not slower or redder.',
    );

    this.physics = new Readout(document.getElementById('panel-physics')!, 'physics');
    this.physics.row(
      'crossing',
      'crossing point',
      'where the two beams are actually meeting, as a distance from the nearest interaction point; a batch is 1754 m long, so anything inside ±877 m collides',
    );
    this.physics.row(
      'phase',
      'phasing',
      'cogging trims beam 2 revolution frequency, which is the only way to move where the beams meet',
    );
    this.physics.separator();
    for (const det of world.detectors) {
      this.physics.row(`lumi-${det.config.id}`, `${det.config.name} L`);
      this.physics.row(`pairs-${det.config.id}`, `${det.config.name} pairs`, 'colliding bunch pairs per turn; a nominal fill gives 2808');
      this.physics.row(
        `heat-${det.config.id}`,
        `${det.config.name} debris`,
        `collision debris sprays down the pipe into the superconducting magnets that squeeze the beams into the interaction point, and the cryogenics has to take it back out — ${si(INSERTION_COOLING, 'W', 1)} of it, per insertion. Past that capacity there is no equilibrium: the cold mass simply climbs`,
      );
    }
    this.physics.separator();
    this.physics.row('pileup', 'pile-up', 'inelastic interactions in one bunch crossing');
    this.physics.row('rate', 'interaction rate');
    this.physics.row(
      'trigger',
      'hardest object',
      'the highest-pT thing in the last event drawn — almost everything out of a collision is a soft pion, and what a hard track *is* is the part that depends on energy: strange, then charm and beauty, then an isolated lepton, which in practice means a W or a Z',
    );
    this.physics.row('burn', 'burn-off', 'protons the collisions have consumed, and what that does to the fill lifetime');

    this.buildRun(world);

    this.power = new Readout(document.getElementById('panel-power')!, 'power');
    this.power.row('state', 'state');
    this.power.row('machineclock', 'machine clock');
    this.power.row('current', 'I_dipole');
    this.power.row('magnets', 'magnet circuits');
    this.power.row('cryo', 'cryogenics');
    this.power.row('site', 'total site load');
    this.power.row('storedmag', 'stored in magnets');
    this.power.separator();

    const grid = document.createElement('div');
    grid.className = 'sectors';
    for (const arc of machine.ring.arcs) {
      const root = document.createElement('div');
      root.className = 'sector';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = arc.name;
      const track = document.createElement('span');
      track.className = 'track';
      const bar = document.createElement('span');
      bar.className = 'bar';
      track.append(bar);
      const pw = document.createElement('span');
      pw.className = 'pw';
      pw.textContent = '—';
      root.append(name, track, pw);
      grid.append(root);
      this.sectors.push({ root, bar, power: pw });
    }
    this.power.append(grid);

    this.power.separator();
    this.power.row('quench', 'quenched circuits', 'a beam hit puts megajoules into a coil with about a kelvin of margin');
    this.power.row('coil', 'hottest coil');
    this.power.row('damage', 'wall hits');
    this.power.row('depth', 'penetration', 'how far the beam drilled into the wall');
    this.power.row('deposited', 'deposited');
    this.power.row('peak', 'peak temperature');

    this.injector = new Readout(
      document.getElementById('panel-injector')!,
      `injector — ${world.injector.ring.config.name}`,
    );
    this.injector.row(
      'state',
      'cycle',
      'the injector is a machine, not a source: the chain delivers at its flat-bottom ' +
        'energy and somebody has to ramp it to the energy the collider takes beam at. ' +
        'Extract before that is done and the collider is handed a beam it cannot capture.',
    );
    this.injector.row('batches', 'batches ready');
    this.injector.row(
      'capture',
      'collider will',
      'a ring captures a beam only if its RF programme matches that beam momentum; a 450 GeV batch arriving at a machine set for 6.8 TeV is bent fifteen times too hard and is in the wall within metres',
    );
    this.injector.row('chain', 'chain');
    this.injector.row('energy', 'extraction E');
    this.injector.row('field', 'dipole field');
    this.injector.row('frev', 'f_rev');
    this.injector.separator();
    for (const e of world.extractions) {
      this.injector.row(`line-${e.line.config.id}`, e.line.config.name);
    }

    // The two experiments, in a column of their own inboard of the machine readouts, one at
    // each end of it. They are pictures rather than readouts, which is why they get the
    // corners: the eye finds them without reading. The column has no width until one of them
    // has triggered on something — see `EventPanel`.
    this.eventRail = document.getElementById('rail-events');
    for (const [slot, det] of ['panel-ip-a', 'panel-ip-b'].map(
      (id, i) => [id, world.detectors[i]] as const,
    )) {
      const root = document.getElementById(slot);
      if (root && det) this.events.push(new EventPanel(root, det));
    }

    this.compute = new Readout(document.getElementById('panel-compute')!, 'compute');
    this.compute.row('backend', 'backend');
    this.compute.row('particles', 'macro-particles');
    this.compute.row('stepsturn', 'steps / turn');
    this.compute.row('stepsframe', 'steps / frame');
    this.compute.row('cost', 'µs / 1k steps');
    this.compute.row('fps', 'fps');
  }

  update(world: World, stats: FrameStats): void {
    const machine = world.collider;
    const t = machine.telemetry();
    const cfg = machine.ring.config;

    this.beam.set('energy', energyGeV(t.energyGeV));
    this.beam.set('momentum', `${t.momentumGeVc.toFixed(0)} GeV/c`);
    this.beam.set('gamma', count(Math.round(t.gamma)));
    this.beam.set('beta', (1 - t.beta).toExponential(2));
    this.beam.set('field', `${fixed(t.field, 3)} T`);
    this.beam.set('radius', `${count(Math.round(machine.ring.bendRadius))} m`);

    const b1 = world.bunchesInBeam(0, 1);
    const b2 = world.bunchesInBeam(0, -1);
    this.beam.set('beam1', b1 > 0 ? `${count(b1)} batches` : 'empty', b1 > 0 ? undefined : 'idle');
    this.beam.set('beam2', b2 > 0 ? `${count(b2)} batches` : 'empty', b2 > 0 ? undefined : 'idle');
    this.beam.set('flight', world.inFlight > 0 ? count(world.inFlight) : '—');
    this.beam.set('fill', `${(((b1 + b2) / 12) * 100).toFixed(0)} % of nominal`);

    const lead = world.leadBunch(0);
    if (lead >= 0) {
      const off = world.offsetOf(lead);
      const realFill = Math.abs(off.metres) / cfg.beamPipeRadius;
      this.beam.set(
        'offset',
        Math.abs(off.metres) < 1
          ? `${(off.metres * 1000).toFixed(2)} mm  (${(Math.abs(off.fraction) * 100).toFixed(1)} %)`
          : `${off.metres.toFixed(1)} m  (${(Math.abs(off.fraction) * 100).toFixed(0)} %)`,
        Math.abs(off.fraction) > 0.7 ? 'warn' : Math.abs(off.fraction) > 0.35 ? 'hot' : undefined,
      );
      this.beam.set(
        'realpipe',
        realFill > 1 ? 'would already be lost' : `${(realFill * 100).toFixed(0)} % of ±28.9 mm`,
        realFill > 1 ? 'warn' : realFill > 0.5 ? 'hot' : undefined,
      );
    } else {
      this.beam.set('offset', 'no beam', 'idle');
      this.beam.set('realpipe', '—', 'idle');
    }

    this.beam.set('frev', si(t.revolutionFrequency, 'Hz', 3));
    this.beam.set(
      'screen',
      world.secondsPerTurn >= 1
        ? `1 turn / ${world.secondsPerTurn.toFixed(2)} s`
        : `${(1 / world.secondsPerTurn).toFixed(1)} turns / s`,
    );
    this.beam.set('turns', count(Math.floor(world.turns)));
    this.beam.set('beamclock', si(world.beamClock, 's', 2));
    const stored = world.storedBeamEnergy(0);
    this.beam.set('stored', si(stored, 'J', 1), stored > 1e8 ? 'hot' : undefined);
    const intensity = world.beamIntensity(0);
    this.beam.set(
      'intensity',
      b1 + b2 > 0 ? `${(intensity * 100).toFixed(1)} % of a fresh batch` : '—',
      b1 + b2 === 0 ? 'idle' : intensity < 0.6 ? 'warn' : intensity < 0.9 ? 'hot' : undefined,
    );

    const ramping = machine.circuits.some((c) => c.state === 'ramping');
    const extracting = t.magnetPower < -1e3;
    this.power.set(
      'state',
      t.quenched > 0
        ? 'QUENCH'
        : extracting
          ? 'ramping down'
          : ramping
            ? 'ramping'
            : t.load > 0.2
              ? 'flat top'
              : 'injection',
      t.quenched > 0 ? 'warn' : ramping ? 'hot' : undefined,
    );
    this.power.set('machineclock', clock(world.machineClock));
    this.power.set('current', `${count(Math.round(t.current))} A  (${(t.load * 100).toFixed(0)} %)`);
    this.power.set('magnets', si(Math.abs(t.magnetPower), 'W', 1), ramping ? 'hot' : 'idle');
    this.power.set('cryo', si(machine.options.cryoPower, 'W', 1));
    this.power.set('site', si(t.totalPower, 'W', 1), t.totalPower > 60e6 ? 'warn' : undefined);
    this.power.set('storedmag', si(t.storedMagnetEnergy, 'J', 2));

    let hottest = machine.circuits[0];
    for (let i = 0; i < this.sectors.length; i++) {
      const circuit = machine.circuits[i];
      const row = this.sectors[i];
      const load = clamp01(circuit.load);
      if (circuit.temperature > hottest.temperature) hottest = circuit;
      row.bar.style.width = `${(load * 100).toFixed(1)}%`;
      row.bar.style.background = circuit.isDown
        ? 'rgba(255, 80, 70, 0.9)'
        : circuit.enabled
          ? rgba(magnetColor(load), 0.9)
          : 'rgba(255, 140, 60, 0.85)';
      const p = Math.abs(circuit.power);
      row.power.textContent = circuit.state === 'quenched'
        ? 'QUENCH'
        : circuit.state === 'recovering'
          ? 'cooling'
          : !circuit.enabled
            ? 'OFF'
            : p > 1e3
              ? si(p, 'W', 1)
              : '—';
      row.root.classList.toggle('active', p > 1e3 || !circuit.enabled || circuit.isDown);
      row.root.classList.toggle('off', !circuit.enabled || circuit.isDown);
    }

    this.power.set(
      'quench',
      world.quenchedCircuits > 0 ? count(world.quenchedCircuits) : 'none',
      world.quenchedCircuits > 0 ? 'warn' : undefined,
    );
    this.power.set(
      'coil',
      `${hottest.temperature.toFixed(1)} K of ${hottest.quenchTemperature.toFixed(1)} K`,
      hottest.temperature > OPERATING_TEMPERATURE * 2 ? 'hot' : undefined,
    );

    const last = world.damage[world.damage.length - 1];
    this.power.set('damage', world.damage.length > 0 ? count(world.damage.length) : 'none');
    if (last) {
      const verdict = verdictFor(last.peakTemperature);
      this.power.set('depth', `${last.depth.toFixed(1)} m of copper`);
      this.power.set(
        'deposited',
        `${si(last.deposited, 'J', 1)}${last.onPurpose ? ' — in the dump' : ''}`,
        last.onPurpose ? 'idle' : 'warn',
      );
      this.power.set(
        'peak',
        `${count(Math.round(last.peakTemperature))} K — ${verdict}`,
        verdict === 'warmed' ? 'hot' : 'warn',
      );
    }

    this.updatePhysics(world);
    this.updateRun(world);
    this.updateInjector(world);
    for (const panel of this.events) panel.update(world);
    // The column itself, so an empty one takes no width from the picture at all.
    if (this.eventRail) {
      const wanted = !this.events.some((p) => p.visible);
      if (this.eventRail.hidden !== wanted) this.eventRail.hidden = wanted;
    }

    const backend = world.backend;
    this.compute.set('backend', backend ? backend.label : 'none');
    this.compute.set('particles', count(world.beam.aliveCount()));
    this.compute.set('stepsturn', count(world.options.stepsPerTurn));
    this.compute.set('stepsframe', count(stats.stepsThisFrame));
    this.compute.set('cost', backend ? (backend.stats.msPerKStep * 1000).toFixed(1) : '—');
    this.compute.set('fps', stats.fps.toFixed(0), stats.fps < 45 ? 'warn' : undefined);
  }

  /**
   * The run: the two plots, the fill in progress, and what has happened lately.
   *
   * Everything above this in the rail is a picture of the machine *now*. This is the only
   * panel that accumulates — the spectra are a function of ∫L dt and survive every dump, the
   * fill report closes an episode off, and the chronicle is what happened while you were
   * looking at an event display. It is the answer to "the beams are colliding, now what".
   */
  private buildRun(world: World): void {
    this.run = new Readout(document.getElementById('panel-run')!, 'run');

    const dimuonCanvas = plot(
      'μ⁺μ⁻ mass · log–log',
      'Every pair of muons the experiments recorded, binned by the mass of the thing that ' +
        'must have decayed to make them: m² = 2·pT₁pT₂·(cosh Δη − cos Δφ).\n\n' +
        'This is the most reproduced plot in particle physics, and the first thing a new ' +
        'detector does is rediscover it. The peaks are, left to right: the J/ψ (a charm ' +
        'quark bound to its antiquark, 1974), the Υ (the same for beauty, 1977), and the Z ' +
        '(1983). Between them is the Drell–Yan continuum — a quark and an antiquark ' +
        'annihilating to a virtual photon — which is a background here and a measurement of ' +
        'the proton in its own right.\n\n' +
        'It is computed from the integrated luminosity and real cross-sections, not from the ' +
        'handful of events this simulation draws, and it does not reset when the beams are ' +
        'dumped. The data is on tape.',
    );
    this.run.append(dimuonCanvas);
    this.dimuon = new SpectrumView(dimuonCanvas.querySelector('canvas')!);
    this.run.row('exposure', '∫L dt', 'summed over both insertions, on the machine clock — the number every plot here is a function of');
    this.run.row(
      'records',
      'rediscovered',
      'what this run has collected enough of to see: a peak is ticked once it stands clear ' +
        'of the continuum under it. Everything here was somebody’s Nobel Prize.',
    );

    const diphotonCanvas = plot(
      'γγ mass · the Higgs window',
      'Two photons, and nothing else. A Higgs boson decays this way about twice in a ' +
        'thousand, which is rare enough that the entire measurement is a bump of a few ' +
        'hundred events on a smooth background of tens of thousands — and the *only* reason ' +
        'it can be seen at all is calorimeter resolution: 1.3 % puts the signal in a 3 GeV ' +
        'window while the background is spread over sixty.\n\n' +
        'The bump grows as √(∫L dt), which is why this is a reason to keep the machine ' +
        'running rather than to watch one collision.',
    );
    this.run.append(diphotonCanvas);
    this.diphoton = new SpectrumView(diphotonCanvas.querySelector('canvas')!);
    this.run.row(
      'higgs',
      'γγ excess',
      'signal over the square root of the background in a ±1.4σ window around 125 GeV. ' +
        'Five sigma is what particle physics calls a discovery — a one in 3.5 million chance ' +
        'that a fluctuation of the background alone would look like this.',
    );
    this.run.separator();
    this.run.row('fill', 'fill', 'the fill in progress: how long it has been up and what it has collected');
    this.run.row(
      'optimum',
      'dump when',
      'a beam decaying with lifetime τ, and a turnaround T before the next fill collides, ' +
        'give the most average luminosity if each fill is run for √(τ·T). That is the real ' +
        'result the real machine plans 10–15 hour fills with; the numbers in it here are ' +
        'this machine’s own — its lifetime, and the turnaround you have actually been taking.',
    );
    // Short labels, both of them: the value column is what has something to say here, and
    // `ATLAS / CMS` wrapped its own label onto two lines to say nothing the value did not.
    this.run.row(
      'score',
      'kept',
      'events each experiment’s trigger has written out, and the hardest object either of ' +
        'them has ever recorded. They see the same collisions and keep different ones, ' +
        'because a trigger is built out of the detector behind it.',
    );
    this.run.row(
      'safety',
      'safety',
      'The LHC Safety Assessment Group, 2008. Every proposed catastrophe has the same ' +
        'answer: cosmic rays have been running this experiment on the Earth, the Moon and ' +
        'every star for billions of years, at energies this machine cannot reach, and all of ' +
        'them are still here. A microscopic black hole would need extra dimensions to form ' +
        'at all and would evaporate in about 1e−27 s.',
    );

    // The last fill, closed off — an episode needs an end or the session is one long
    // stationary state. Hidden until there has been one.
    this.report = document.createElement('div');
    this.report.className = 'report';
    this.report.hidden = true;
    const head = document.createElement('div');
    head.className = 'report-head';
    this.report.append(head);
    const grid = document.createElement('div');
    grid.className = 'report-grid';
    this.report.append(grid);
    this.reportRows = new Map([['head', head]]);
    for (const [key, label] of [
      ['integrated', '∫L dt'],
      ['stable', 'stable beams'],
      ['peak', 'peak L'],
      ['efficiency', 'efficiency'],
      ['trouble', 'interruptions'],
    ] as const) {
      const k = document.createElement('span');
      k.textContent = label;
      const v = document.createElement('b');
      v.textContent = '—';
      grid.append(k, v);
      this.reportRows.set(key, v);
    }
    this.run.append(this.report);

    this.logRoot = document.createElement('div');
    this.logRoot.className = 'log';
    this.run.append(this.logRoot);

    this.ticker = document.getElementById('ticker');
    this.setTicker(quietLine(world), 'notice');
  }

  /** The one line the machine says out loud, over the picture. */
  private setTicker(text: string, severity: string): void {
    if (!this.ticker) return;
    if (this.ticker.textContent !== text) this.ticker.textContent = text;
    const cls = `ticker sev-${severity}`;
    if (this.ticker.className !== cls) this.ticker.className = cls;
  }

  private updateRun(world: World): void {
    const a = world.analysis;
    const fb = a.integrated / FEMTOBARN_INVERSE;

    // The plots. Redrawn when the exposure has moved by a per cent — at 60 fps an identical
    // histogram is a hundred and forty strokes a second of nothing changing.
    this.dimuon.resize();
    this.diphoton.resize();
    if (a.integrated > this.drawnAt * 1.01 || this.dimuon.dirty || this.diphoton.dirty) {
      this.drawnAt = a.integrated;
      const marks: Array<{ mass: number; label: string }> = [];
      for (const s of a.dimuon.sources) {
        // Labelled only once its own peak has something in it: a plot that names a Z it has
        // not collected is a diagram of what one looks like, not a measurement.
        if (s.label && a.dimuon.expected(s.name, a.integrated) > PEAK_VISIBLE) {
          marks.push({ mass: s.mass, label: s.label });
        }
      }
      this.dimuon.render(a.dimuon, a.integrated, marks);
      const excess = a.higgsWindow;
      this.diphoton.render(
        a.diphoton,
        a.integrated,
        excess.sigma > 1 ? [{ mass: HIGGS_MASS, label: 'H → γγ' }] : [],
      );
    }

    this.run.set(
      'exposure',
      fb > 1e-4 ? `${fb.toFixed(fb > 1 ? 2 : 4)} fb⁻¹` : 'nothing yet',
      fb > 1e-4 ? undefined : 'idle',
    );
    // Ticked ones first and the rest after, rather than a mark against every name: the column
    // is 260 px and "J/ψ ✓ · ψ' ✓ · Υ ✓ · Z ✓ · H —" wraps onto two lines of it.
    const named = a.dimuon.sources.filter((s) => s.label);
    const got = named
      .filter((s) => a.dimuon.expected(s.name, a.integrated) > PEAK_VISIBLE)
      .map((s) => s.label);
    const missing = named
      .filter((s) => a.dimuon.expected(s.name, a.integrated) <= PEAK_VISIBLE)
      .map((s) => s.label);
    if (a.discovered) got.push('H');
    else missing.push('H');
    const excess = a.higgsWindow;
    this.run.set(
      'records',
      got.length > 0 ? `${got.join(' ')} ✓${missing.length > 0 ? `  ·  ${missing.join(' ')} —` : ''}` : 'nothing yet',
      a.discovered ? 'warn' : got.length > 0 ? undefined : 'idle',
    );
    this.run.set(
      'higgs',
      excess.sigma < 0.2
        ? '—'
        : `${excess.sigma.toFixed(1)}σ · ${excess.signal.toFixed(0)} on ${si(excess.background, '', 2)}`,
      excess.sigma >= DISCOVERY_SIGMA ? 'warn' : excess.sigma > 2 ? 'hot' : excess.sigma < 0.2 ? 'idle' : undefined,
    );

    // The fill in progress, and when to end it.
    const fill = world.fill;
    if (fill) {
      this.run.set(
        'fill',
        `#${fill.index} · ${duration(world.fillAge)} up · ${(fill.integrated / FEMTOBARN_INVERSE).toFixed(4)} fb⁻¹`,
        fill.incidents > 0 ? 'hot' : undefined,
      );
    } else {
      this.run.set('fill', world.fillHistory.length > 0 ? 'no beam — refill' : 'no beam yet', 'idle');
    }
    const optimum = world.optimumFillLength;
    if (!fill) {
      this.run.set('optimum', '—', 'idle');
    } else if (!isFinite(optimum)) {
      this.run.set('optimum', 'nothing is burning yet', 'idle');
    } else {
      const left = optimum - world.fillAge;
      this.run.set(
        'optimum',
        left > 0
          ? `after ${duration(optimum)} — ${duration(left)} to go`
          : `${duration(-left)} past it — dump it`,
        left > 0 ? undefined : 'warn',
      );
    }

    const [a1, a2] = world.detectors;
    if (a1 && a2) {
      const best = Math.max(a1.bestScore, a2.bestScore);
      this.run.set(
        'score',
        `${a1.recorded} / ${a2.recorded}` +
          (best > 0
            ? ` · best ${best.toFixed(0)} GeV ${a1.bestScore >= a2.bestScore ? a1.config.name : a2.config.name}`
            : ''),
        a1.recorded + a2.recorded > 0 ? undefined : 'idle',
      );
    }
    // The tooltip carries the actual argument; the line is a joke that happens to be true.
    this.run.set('safety', 'world still here', 'idle');

    // The last fill, and the chronicle. Both are appends, so neither is rebuilt per frame.
    if (world.fillHistory.length > this.reportsShown) {
      this.reportsShown = world.fillHistory.length;
      const r = world.fillHistory[world.fillHistory.length - 1];
      const cycle = r.endedAt - r.startedAt + (r.turnaround || world.turnaround);
      this.report.hidden = false;
      this.reportRows.get('head')!.textContent = `fill ${r.index} — ${r.reason}`;
      this.reportRows.get('integrated')!.textContent =
        `${(r.integrated / FEMTOBARN_INVERSE).toFixed(4)} fb⁻¹`;
      this.reportRows.get('stable')!.textContent = duration(r.stableSeconds);
      this.reportRows.get('peak')!.textContent =
        r.peakLuminosity > 1e28 ? `${r.peakLuminosity.toExponential(1)} cm⁻²s⁻¹` : '—';
      // The number the operations group is actually judged on: of all the time this fill
      // cost, including getting the beam back afterwards, how much of it was colliding.
      this.reportRows.get('efficiency')!.textContent =
        cycle > 0 ? `${((r.stableSeconds / cycle) * 100).toFixed(0)} % of the cycle` : '—';
      this.reportRows.get('trouble')!.textContent =
        r.incidents + r.quenches > 0
          ? `${plural(r.incidents, 'incident')} · ${plural(r.quenches, 'quench', 'quenches')}`
          : 'clean';
    }

    while (this.loggedLines < world.chronicle.length) {
      const entry = world.chronicle[this.loggedLines++];
      const line = document.createElement('div');
      line.className = `log-line log-${entry.kind} sev-${entry.severity}`;
      line.textContent = `${clock(entry.at)}  ${entry.text}`;
      this.logRoot.append(line);
      while (this.logRoot.childElementCount > LOG_LINES) this.logRoot.firstElementChild?.remove();
    }
    // The chronicle is capped in the world too, so the count can go down under this one.
    if (this.loggedLines > world.chronicle.length) this.loggedLines = world.chronicle.length;

    const alarm = world.alarm;
    if (alarm && world.elapsed - alarm.at < ALARM_HOLD) {
      this.setTicker(alarm.text, alarm.severity);
    } else if (alarm) {
      world.alarm = null;
      this.setTicker(quietLine(world), 'notice');
    }
  }

  /**
   * The experiments.
   *
   * Luminosity is quoted the way a real machine quotes it — averaged over a turn — and the
   * bunch-pair count next to it is what that average is made of, so the two together say
   * *why* the number is what it is: 2808 pairs is a nominal fill perfectly phased, and
   * anything less is either fewer batches or a crossing point that is not on the IP.
   */
  private updatePhysics(world: World): void {
    const crossing = world.crossingNearestIP();
    const reach = BATCH_LENGTH / 2;
    if (!crossing) {
      this.physics.set('crossing', 'needs both beams', 'idle');
    } else {
      const off = Math.abs(crossing.offset);
      this.physics.set(
        'crossing',
        off < reach
          ? `${crossing.offset.toFixed(0)} m from ${world.detectors[0].config.name}`
          : `${(crossing.offset / 1000).toFixed(2)} km — out in the arcs`,
        off < reach * 0.25 ? undefined : off < reach ? 'hot' : 'warn',
      );
    }
    this.physics.set(
      'phase',
      world.coggingAuto
        ? 'cogging — seeking'
        : world.cogging !== 0
          ? `cogging ${world.cogging > 0 ? '+' : '−'}`
          : 'locked',
      world.cogging !== 0 || world.coggingAuto ? 'hot' : 'idle',
    );

    let lumi = 0;
    let integrated = 0;
    let higgs = 0;
    let burned = 0;
    let pileUp = 0;
    for (const det of world.detectors) {
      lumi += det.smoothed;
      integrated += det.integrated;
      higgs += det.higgs;
      burned += det.burned;
      pileUp = Math.max(pileUp, det.pileUp);
      this.physics.set(
        `lumi-${det.config.id}`,
        det.smoothed > 1e28 ? `${det.smoothed.toExponential(2)} cm⁻²s⁻¹` : 'no collisions',
        det.smoothed > 1e28 ? undefined : 'idle',
      );
      this.physics.set(
        `pairs-${det.config.id}`,
        det.collidingPairs > 0 ? `${count(Math.round(det.bunchPairs))} of 2808` : '—',
        det.collidingPairs > 0 ? undefined : 'idle',
      );
      this.physics.set(
        `heat-${det.config.id}`,
        // Short enough for one line: the value used to be "68.60 W of 1.8 kW · 1.90 K" and
        // wrapped, leaving a stranded "K" on a line of its own in a 260 px column. What the
        // cooling capacity is stays in the tooltip, where a number that never changes belongs.
        det.quenched
          ? `QUENCH — ${det.temperature.toFixed(0)} K`
          : det.debrisPower > 1
            ? `${si(det.debrisPower, 'W', 1)} · ${det.temperature.toFixed(2)} K`
            : `cold · ${det.temperature.toFixed(2)} K`,
        det.quenched ? 'warn' : det.thermalLoad > 0.05 ? 'hot' : det.debrisPower > 1 ? undefined : 'idle',
      );
    }

    this.physics.set('pileup', pileUp > 0.05 ? `${pileUp.toFixed(0)} per crossing` : '—');
    this.physics.set('rate', lumi > 1e28 ? `${si(lumi * SIGMA_INELASTIC, 'Hz', 2)}` : '—');
    this.physics.set(
      'integrated',
      integrated > 0 ? `${(integrated / FEMTOBARN_INVERSE).toFixed(3)} fb⁻¹` : '—',
    );
    this.physics.set('higgs', higgs >= 1 ? count(Math.floor(higgs)) : '—');

    const last = world.collisions[world.collisions.length - 1];
    if (last) {
      const pt = last.event.hardestPt;
      const name = speciesName(last.event.hardestSpecies);
      this.physics.set(
        'trigger',
        `${name}, ${pt < 10 ? pt.toFixed(1) : pt.toFixed(0)} GeV`,
        pt > 10 ? 'warn' : pt > 3 ? 'hot' : undefined,
      );
    } else {
      this.physics.set('trigger', '—', 'idle');
    }

    // Fill lifetime the present burn-off implies, on the real clock: N / (dN/dt), with two
    // protons leaving the machine per inelastic interaction. Two days is the real answer.
    const perSecond = lumi * SIGMA_INELASTIC * 2;
    let circulating = 0;
    for (let i = 0; i < world.beam.count; i++) {
      if (world.beam.alive[i] && world.beam.ring[i] === 0) circulating += world.beam.charge[i];
    }
    const hours = perSecond > 0 ? circulating / perSecond / 3600 : 0;
    this.physics.set(
      'burn',
      burned > 0
        ? `${burned.toExponential(1)} p — ${hours > 0 ? `${hours.toFixed(0)} h lifetime` : '—'}`
        : '—',
      burned > 0 ? undefined : 'idle',
    );
  }

  private updateInjector(world: World): void {
    const inj = world.injector;
    const t = inj.telemetry();
    const ready = world.bunchesIn(1);

    const cfg = inj.ring.config;
    const ramping = inj.isRamping;
    const atTop = inj.rampFraction > 0.98;
    this.injector.set(
      'state',
      ramping
        ? `ramping — ${(inj.rampFraction * 100).toFixed(0)} % of the way up`
        : atTop
          ? `flat top — ${cfg.topEnergyGeV} GeV, ready to extract`
          : `flat bottom — ${cfg.injectionEnergyGeV} GeV`,
      ramping ? 'hot' : atTop ? undefined : 'idle',
    );
    this.injector.set(
      'batches',
      ready > 0 ? count(ready) : 'empty',
      ready > 0 ? undefined : 'idle',
    );
    this.injector.set(
      'chain',
      world.fillRemaining > 0
        ? world.injectorReadyForChain
          ? `delivering — ${world.fillRemaining.toFixed(1)} s`
          : 'holding — waiting for flat bottom'
        : `idle (cycle ${INJECTOR_CYCLE} s)`,
      world.fillRemaining > 0 ? 'hot' : undefined,
    );
    const mismatch = world.collider.momentumGeVc / inj.momentumGeVc;
    this.injector.set(
      'capture',
      mismatch > 1.02
        ? `NOT capture — its field is ${mismatch.toFixed(1)}× too strong`
        : 'capture what arrives',
      mismatch > 1.02 ? 'warn' : undefined,
    );
    this.injector.set('energy', energyGeV(t.energyGeV));
    this.injector.set('field', `${fixed(t.field, 3)} T`);
    this.injector.set('frev', si(t.revolutionFrequency, 'Hz', 3));

    for (const e of world.extractions) {
      const key = `line-${e.line.config.id}`;
      const state =
        e.state === 'firing'
          ? 'FIRING'
          : e.state === 'armed'
            ? e.waitingForBucket
              ? 'armed — holding for a free bucket'
              : 'armed — waiting for the bunch'
            : e.circuit && !e.circuit.enabled
              ? 'dipoles off'
              : `${(e.line.length / 1000).toFixed(2)} km · ${e.sent} sent`;
      this.injector.set(
        key,
        state,
        e.state === 'firing' ? 'warn' : e.state === 'armed' ? 'hot' : undefined,
      );
    }
  }
}

/** `1 incident`, `2 incidents` — a readout that says "1 incidents" reads as a bug. */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A captioned plot: the canvas, and the one line saying what is on its axes. */
function plot(caption: string, hint: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'plot';
  const canvas = document.createElement('canvas');
  canvas.className = 'plot-view';
  canvas.title = hint;
  const cap = document.createElement('div');
  cap.className = 'plot-caption';
  cap.textContent = caption;
  cap.title = hint;
  wrap.append(canvas, cap);
  return wrap;
}

/**
 * What the ticker says when nothing is wrong: the next thing worth doing.
 *
 * A status line that only speaks up for alarms is a status line that is blank most of the
 * time, and this is a machine with an order of operations — so when it is quiet it says where
 * in that order you are.
 */
function quietLine(world: World): string {
  if (world.collider.quenchedCount > 0) return 'a sector is quenched — click the orange arc to start it cooling';
  if (world.fill === null) {
    return world.bunchesIn(1) > 0
      ? 'the injector has beam — ramp it to 450 and extract into a ring'
      : 'the collider is empty — fill the injector';
  }
  let lumi = 0;
  for (const det of world.detectors) lumi += det.luminosity;
  if (lumi <= 0) {
    return world.collider.rampFraction < 0.98
      ? 'beam in the collider — ramp it, then cog the crossing point onto an experiment'
      : 'flat top, nothing colliding — cog the crossing point onto an experiment';
  }
  return `stable beams — ${(lumi * 2).toExponential(1)} cm⁻²s⁻¹ into the two experiments`;
}
