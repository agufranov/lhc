/**
 * Headless sanity check of the lattice, the pusher and the aperture — `npm run check`.
 * If a number here stops matching the real machine, the simulation is lying.
 */

import { LHC_CONFIG, SPS_CONFIG, buildRing } from '../src/sim/lattice';
import { Machine } from '../src/sim/machine';
import { World, PROTONS_PER_BATCH, poseAtArclength } from '../src/sim/world';
import { momentumFromEnergy } from '../src/sim/units';
import { CpuBackend } from '../src/sim/backends/cpuBackend';
import { channelTemperature, penetrationDepth, verdictFor } from '../src/sim/damage';
import {
  BARREL,
  DETECTOR_SHELLS,
  EM_CELLS,
  EM_SAMPLINGS,
  HAD_CELLS,
  HAD_SAMPLINGS,
  MUON_CHAMBERS,
  MUON_STATIONS,
  SEGMENT_STRIDE,
  SOLENOID_FIELD,
  SPECIES_HEAVY,
  SPECIES_LEPTON,
  TRANSVERSE_BEND,
  buildCollision,
  buildShower,
  buildTransverse,
  speciesName,
} from '../src/sim/shower';
import {
  BATCH_LENGTH,
  BUNCHES_PER_BATCH,
  CROSSING_RATE,
  FEMTOBARN_INVERSE,
  INSERTION_COOLING,
  SIGMA_HIGGS,
  SIGMA_INELASTIC,
  TRIGGER_MIN_PT,
} from '../src/sim/detector';
import { Analysis, DISCOVERY_SIGMA, HIGGS_BOOST } from '../src/sim/analysis';
import { INCIDENTS, IncidentSystem } from '../src/sim/incidents';

const ring = buildRing(LHC_CONFIG);

const o = ring.orbit;
const closureErr = Math.hypot(o[o.length - 2] - o[0], o[o.length - 1] - o[1]);

let len = 0;
for (let i = 2; i < o.length; i += 2) len += Math.hypot(o[i] - o[i - 2], o[i + 1] - o[i - 1]);
len += Math.hypot(o[0] - o[o.length - 2], o[1] - o[o.length - 1]);

console.log('cells                ', LHC_CONFIG.cells);
console.log('bend radius rho [m]  ', ring.bendRadius.toFixed(2), ' (LHC: 2803.95)');
console.log('geometric closure [m]', closureErr.toExponential(2));
console.log('orbit length [m]     ', len.toFixed(1), 'vs', LHC_CONFIG.circumference);
console.log('simulated aperture   ', `±${LHC_CONFIG.apertureRadius} m`);
console.log('real beam pipe       ', `±${(LHC_CONFIG.beamPipeRadius * 1000).toFixed(1)} mm`);

/** A world with one batch circulating in the collider, going `bore`. */
function colliderWorld(stepsPerTurn = 2400, bore = 1): World {
  const w = new World(LHC_CONFIG, SPS_CONFIG, { stepsPerTurn });
  w.attachBackend(new CpuBackend());
  const inj = w.collider.ring.injection;
  w.beam.inject({
    x: inj.x,
    y: inj.y,
    dx: inj.dx * bore,
    dy: inj.dy * bore,
    gamma: w.collider.gamma,
    protons: PROTONS_PER_BATCH,
    ring: 0,
  });
  w.attachBackend(new CpuBackend());
  return w;
}

/**
 * Puts a batch in the injector **and ramps the injector to flat top**, which is what it now
 * takes to have something the collider can capture.
 *
 * The chain delivers at 26 GeV and the injector accelerates it to 450; extracting before
 * that is done sends the collider a beam sixteen times too soft, which is a thing this file
 * measures on purpose further down. Everything that just wants a batch delivered goes
 * through here.
 */
function loadInjector(w: World, frames = 600): boolean {
  w.fillInjector();
  w.injector.setTargetEnergy(w.injector.ring.config.topEnergyGeV);
  for (let i = 0; i < frames && w.injector.rampFraction < 0.999; i++) w.advance(1 / 60);
  return w.injector.rampFraction >= 0.999;
}

/** Tracks one beam and reports how far it strays from the closed orbit. */
function track(stepsPerTurn: number, turns: number, bore = 1) {
  const w = colliderWorld(stepsPerTurn, bore);
  const dt = w.collider.revolutionPeriod / stepsPerTurn;

  let maxOffset = 0;
  let survivedTurns = 0;
  const t0 = performance.now();
  for (let t = 0; t < turns; t++) {
    for (let s = 0; s < stepsPerTurn; s++) {
      w.backend!.step(dt, 1);
      if (!w.beam.alive[0]) break;
      const off = Math.abs(w.offsetOf(0).metres);
      if (off > maxOffset) maxOffset = off;
    }
    if (!w.beam.alive[0]) break;
    survivedTurns = t + 1;
  }
  const wall = performance.now() - t0;
  return { w, maxOffset, survivedTurns, alive: w.beam.alive[0] === 1, wall };
}

console.log('--- injection (450 GeV) ---');
{
  const probe = new Machine(LHC_CONFIG);
  console.log('E [GeV]              ', probe.energyGeV.toFixed(1));
  console.log('B [T]                ', probe.fieldStrength.toFixed(4));
  console.log('I [A]                ', probe.meanCurrent.toFixed(0));
  console.log('T_rev [us]           ', (probe.revolutionPeriod * 1e6).toFixed(3), ' (LHC: 88.92)');
}

// Coarse integration distorts the closed orbit. The simulated aperture is far too wide
// for that to be fatal, so the interesting column is what a real 29 mm pipe would say.
console.log('--- closed-orbit distortion vs stepping (20 turns each) ---');
console.log(' steps/turn   max offset   of ±29 mm pipe   verdict');
for (const stepsPerTurn of [4800, 2400, 1200, 800, 600, 400, 300, 200]) {
  const r = track(stepsPerTurn, 20);
  const pct = (r.maxOffset / LHC_CONFIG.beamPipeRadius) * 100;
  const verdict = r.alive
    ? pct > 100
      ? 'circulating here, lost in a real pipe'
      : 'circulating'
    : `lost after ${r.survivedTurns} turns`;
  console.log(
    ` ${String(stepsPerTurn).padStart(10)}   ${(r.maxOffset * 1000)
      .toFixed(2)
      .padStart(8)} mm   ${pct.toFixed(0).padStart(12)} %   ${verdict}`,
  );
}

console.log('--- long run at the default 2400 steps/turn ---');
{
  const r = track(2400, 2000);
  const steps = 2000 * 2400;
  console.log('turns                ', r.survivedTurns, `(${(2000 * 88.9e-6 * 1e3).toFixed(1)} ms of beam time)`);
  console.log('max orbit offset [mm]', (r.maxOffset * 1000).toFixed(3));
  console.log('|v|/c                ', (Math.hypot(r.w.beam.vx[0], r.w.beam.vy[0]) / 299792458).toFixed(12));
  console.log('instrumented cost    ', ((r.wall / steps) * 1e6).toFixed(1), 'us / 1k steps');
}

// The counter-rotating beam is the same particle pointing the other way: it is in the
// other aperture of the twin-bore dipole, so the field it sees is reversed and it is bent
// exactly as well. If this ever stops matching beam 1, the bore logic has broken.
console.log('--- beam 2, the other way round the same ring ---');
{
  const r = track(2400, 200, -1);
  console.log('turns                ', r.survivedTurns, r.alive ? '(circulating)' : '(LOST)');
  console.log('max orbit offset [mm]', (r.maxOffset * 1000).toFixed(3), '— compare beam 1 above');
}

// A single-bore machine has no second pipe, so a particle going the wrong way through it
// is bent the wrong way and dies. That is not a bug, it is the difference between the two.
console.log('--- the same trick in the single-bore injector ---');
{
  const w = new World();
  w.attachBackend(new CpuBackend());
  const inj = w.injector.ring.injection;
  w.beam.inject({
    x: inj.x,
    y: inj.y,
    dx: -inj.dx,
    dy: -inj.dy,
    gamma: w.injector.gamma,
    protons: PROTONS_PER_BATCH,
    ring: 1,
  });
  w.attachBackend(new CpuBackend());
  let frames = 0;
  while (w.beam.alive[0] && frames < 600) {
    w.advance(1 / 60);
    frames++;
  }
  console.log('backwards in the SPS ', w.beam.alive[0] ? 'circulates (WRONG)' : 'lost, as it must be');
}

// The push, called the way the app calls it.
{
  const bench = colliderWorld();
  const dt = bench.collider.revolutionPeriod / bench.options.stepsPerTurn;
  const chunk = 242; // steps per frame at 6.8 TeV
  const chunks = 4000;
  const t0 = performance.now();
  for (let i = 0; i < chunks; i++) bench.backend!.step(dt, chunk);
  const wall = performance.now() - t0;
  console.log('push cost            ', ((wall / (chunks * chunk)) * 1e6).toFixed(1), 'us / 1k steps');
  console.log('frame budget         ', ((wall / chunks) * 1000).toFixed(0), 'us / frame at 6.8 TeV');
  console.log('still circulating    ', bench.beam.alive[0] === 1);
}

const m = colliderWorld();
m.collider.setTargetEnergy(LHC_CONFIG.topEnergyGeV);
while (m.collider.energyGeV < LHC_CONFIG.topEnergyGeV - 0.5 && m.machineClock < 5000) {
  m.advance(1 / 60);
}

console.log('--- after ramp ---');
console.log('E [GeV]              ', m.collider.energyGeV.toFixed(1));
console.log('B [T]                ', m.collider.fieldStrength.toFixed(4), ' (LHC @6.8 TeV: 8.09)');
console.log('I [A]                ', m.collider.meanCurrent.toFixed(0));
console.log('stored in magnets [GJ]', (m.collider.storedMagnetEnergy / 1e9).toFixed(2), ' (LHC: ~8.5)');
console.log('one batch at flat top ', (m.storedBeamEnergy(0) / 1e6).toFixed(0), 'MJ; 12 of them =', ((m.storedBeamEnergy(0) * 12) / 1e6).toFixed(0), 'MJ (LHC: ~350)');
console.log('ramp duration [s]    ', m.machineClock.toFixed(0), ' (LHC: ~1200)');
console.log('captured through ramp', m.beam.alive[0] === 1 ? 'yes' : 'NO — the RF lost it');

// Switching a magnet off removes 45 degrees of bending. The field does not vanish — the
// coil dumps through its extraction resistor — but with no focusing anywhere in the ring
// even a few per cent of missing bend is far more than 29 mm of aperture can absorb.
console.log('--- switch off sector S23 at injection ---');
{
  const off = colliderWorld();
  off.collider.toggleCircuit(1);

  const arc = ring.arcs[1];
  const entryX = arc.cx + arc.radius * Math.cos(arc.phiStart);
  const entryY = arc.cy + arc.radius * Math.sin(arc.phiStart);

  const dtWall = 1 / 60;
  let wallSeconds = 0;
  let straightFlight = 0;
  while (off.beam.alive[0] === 1 && wallSeconds < 30) {
    off.advance(dtWall);
    wallSeconds += dtWall;
    straightFlight = Math.hypot(off.beam.x[0] - entryX, off.beam.y[0] - entryY);
  }
  const site = off.damage[off.damage.length - 1];
  console.log('survived             ', off.turns.toFixed(2), 'turns /', wallSeconds.toFixed(2), 's of wall clock');
  console.log('straight flight [m]  ', straightFlight.toFixed(0), 'from the arc entrance before touching the wall');
  console.log('S23 current at loss  ', off.collider.circuits[1].current.toFixed(0), 'A of', off.collider.programmedCurrent.toFixed(0));
  if (site) {
    console.log('penetration [m]      ', site.depth.toFixed(1));
    console.log('deposited [MJ]       ', (site.deposited / 1e6).toFixed(1));
    console.log('peak temperature [K] ', site.peakTemperature.toFixed(0), verdictFor(site.peakTemperature));
  }
  console.log('quenched by the hit  ', off.quenchedCircuits, 'circuits');
}

console.log('--- the injector complex ---');
{
  const w = new World();
  const sps = w.injector.ring;

  console.log('SPS cells            ', SPS_CONFIG.cells, '(sextants)');
  console.log('SPS bend radius [m]  ', sps.bendRadius.toFixed(1), ' (SPS: 741.3)');
  console.log(
    'SPS energy programme ',
    `${SPS_CONFIG.injectionEnergyGeV} -> ${SPS_CONFIG.topEnergyGeV} GeV`,
    ' (SPS: 26 -> 450)',
  );
  console.log('SPS B at flat bottom ', w.injector.fieldStrength.toFixed(3), 'T at 26 GeV');
  w.injector.setTargetEnergy(SPS_CONFIG.topEnergyGeV);
  {
    const t0 = w.machineClock;
    let frames = 0;
    while (w.injector.rampFraction < 0.999 && frames < 3000) {
      w.advance(1 / 60);
      frames++;
    }
    console.log('SPS B at flat top    ', w.injector.fieldStrength.toFixed(3), ' (SPS: 2.02)');
    console.log(
      'SPS ramp             ',
      `${(w.machineClock - t0).toFixed(0)} s of machine time,`,
      `${(frames / 60).toFixed(2)} s of play  (SPS: 4.3 s real — stretched, see lattice.ts)`,
    );
  }
  console.log('SPS T_rev [us]       ', (w.injector.revolutionPeriod * 1e6).toFixed(3), ' (SPS: 23.05)');
  w.injector.setTargetEnergy(SPS_CONFIG.injectionEnergyGeV);
  for (let i = 0; i < 3000 && w.injector.rampFraction > 0.001; i++) w.advance(1 / 60);

  for (const e of w.extractions) {
    const bend = e.line.arcs[0];
    console.log(
      `${e.line.config.name.padEnd(5)}`,
      `${(e.line.length / 1000).toFixed(2)} km`,
      bend ? `${e.line.arcs.length} bend(s)` : 'a straight pipe',
    );
  }

  // The kicker is what the eye is meant to follow, so it is drawn where it is and at the
  // length it is. Running it down most of the straight puts its downstream end where the
  // beam actually leaves the ring — and the same angle over sixteen times the length needs
  // a sixteenth of the field, so the number below got more plausible, not less.
  console.log('extraction hardware  ');
  for (const e of w.extractions) {
    const arc = e.kickerArc;
    if (!arc) continue;
    const from = w.machines[e.line.config.fromMachine];
    const straight = from.ring.straights[e.line.config.kickerCell].length;
    // Quoted at the energy the device actually fires at — flat top of whichever machine it
    // belongs to. A kicker's field tracks the beam momentum, so this is its worst case.
    const top = from.ring.config.topEnergyGeV;
    const p = momentumFromEnergy(top);
    console.log(
      `  ${e.line.config.name.padEnd(5)} kicker ${arc.length.toFixed(0).padStart(4)} m`,
      `(${((arc.length / straight) * 100).toFixed(0)} % of the straight),`,
      `${(Math.abs(arc.dPhi) * 1000).toFixed(0)} mrad,`,
      `${(p / (0.299_792_458 * arc.radius)).toFixed(2)} T at ${top.toFixed(0)} GeV`,
    );
  }

  // Nothing the *collider* does may appear to speed the injector up. Each particle is
  // stepped at the rate its own energy earns, so this measures the injector bunch's drawn
  // speed on both sides of a collider ramp: metres of track per wall second, which is what
  // the eye actually judges. The injector's own ramp, which must move it, is below.
  const e0 = w.injector.energyGeV;
  const f0 = w.injector.fieldStrength;
  w.attachBackend(new CpuBackend());
  w.fillInjector();
  w.attachBackend(new CpuBackend());

  /** Metres the bunch covers per wall second, integrated over `frames` frames. */
  const drawnSpeed = (world: World, i: number, frames: number): number => {
    let d = 0;
    for (let f = 0; f < frames; f++) {
      const x0 = world.beam.x[i];
      const y0 = world.beam.y[i];
      world.advance(1 / 60);
      d += Math.hypot(world.beam.x[i] - x0, world.beam.y[i] - y0);
    }
    return d / (frames / 60);
  };

  const spsBefore = drawnSpeed(w, 0, 120);
  const colliderBefore = w.turnsPerSecond;
  w.collider.setTargetEnergy(LHC_CONFIG.topEnergyGeV);
  for (let i = 0; i < 2000; i++) w.advance(1 / 60);
  const spsAfter = drawnSpeed(w, 0, 120);

  console.log(
    'injector through a collider ramp',
    `E ${e0.toFixed(1)} -> ${w.injector.energyGeV.toFixed(1)} GeV,`,
    `B ${f0.toFixed(3)} -> ${w.injector.fieldStrength.toFixed(3)} T`,
  );
  console.log(
    'collider drawn speed     ',
    `${colliderBefore.toFixed(2)} -> ${w.turnsPerSecond.toFixed(2)} turns/s (it ramped, so it must rise)`,
  );
  console.log(
    'injector drawn speed     ',
    `${(spsBefore / 1000).toFixed(1)} -> ${(spsAfter / 1000).toFixed(1)} km/s of track`,
    Math.abs(spsAfter / spsBefore - 1) < 0.05
      ? '— unchanged, as it must be'
      : `— WRONG, it moved by ${((spsAfter / spsBefore - 1) * 100).toFixed(0)} %`,
  );

  // And now the injector's *own* ramp, which is the whole point of it being a machine: the
  // same bunch, 26 -> 450 GeV, must visibly speed up. This is the number that says the SPS
  // is accelerating something rather than storing it.
  w.injector.setTargetEnergy(SPS_CONFIG.topEnergyGeV);
  for (let i = 0; i < 3000 && w.injector.rampFraction < 0.999; i++) w.advance(1 / 60);
  const spsRamped = drawnSpeed(w, 0, 120);
  console.log(
    'injector through its own ramp',
    `E ${w.beam.gamma[0] > 0 ? (w.beam.gamma[0] * 0.938_272).toFixed(0) : '—'} GeV,`,
    `B ${w.injector.fieldStrength.toFixed(3)} T,`,
    `drawn speed ${(spsBefore / 1000).toFixed(1)} -> ${(spsRamped / 1000).toFixed(1)} km/s of track`,
    spsRamped > spsBefore * 1.5 ? '— it accelerates' : '— WRONG, the ramp did not show',
  );

  const ti2 = w.extractions[0].line;
  const target = w.collider.ring.injection;
  console.log(
    'TI 2 aim error [m]   ',
    Math.hypot(ti2.exit.x - target.x, ti2.exit.y - target.y).toExponential(1),
  );

  let gap = Infinity;
  const a = w.collider.ring.orbit;
  const b = sps.orbit;
  for (let i = 0; i < a.length; i += 2) {
    for (let j = 0; j < b.length; j += 2) {
      gap = Math.min(gap, Math.hypot(a[i] - b[j], a[i + 1] - b[j + 1]));
    }
  }
  console.log('closest approach [m] ', gap.toFixed(0));
  console.log('field sectors        ', w.sectorCount, '(both rings plus every line dipole)');
  console.log('aperture elements    ', w.elements);
}

// End to end, with no handover anywhere: the batch is extracted, crosses the line and
// turns up in the collider because it flew there.
console.log('--- fill the collider, both beams ---');
{
  const w = new World();
  w.attachBackend(new CpuBackend());

  const send = (lineId: string): boolean => {
    loadInjector(w);
    w.armKicker(w.lineIndex(lineId));
    for (let i = 0; i < 4000; i++) {
      w.advance(1 / 60);
      if (w.extractions[w.lineIndex(lineId)].state === 'idle' && w.inFlight === 0) break;
    }
    return true;
  };

  send('ti2');
  console.log('after TI 2           ', `beam 1: ${w.bunchesInBeam(0, 1)}, beam 2: ${w.bunchesInBeam(0, -1)}`);
  send('ti8');
  console.log('after TI 8           ', `beam 1: ${w.bunchesInBeam(0, 1)}, beam 2: ${w.bunchesInBeam(0, -1)}`);
  send('ti2');
  send('ti2');
  console.log('after two more TI 2  ', `beam 1: ${w.bunchesInBeam(0, 1)}, beam 2: ${w.bunchesInBeam(0, -1)}`);
  console.log('stored in collider   ', si(w.storedBeamEnergy(0)), 'at 450 GeV');

  // let it all circulate together for a while
  const before = w.beam.aliveCount();
  for (let i = 0; i < 1200; i++) w.advance(1 / 60);
  console.log('several beams at once', `${before} injected, ${w.beam.aliveCount()} still circulating after ${w.turns.toFixed(1)} turns`);

  // Both dumps, because for a long time only one of them was ever run. A kicker acts on one
  // aperture, so dumping beam 1 must leave beam 2 circulating and the other way round; and
  // the beam 2 kicker's field has to be written in the aperture that beam is actually in.
  // Signed the other way it threw the batch at the inside wall of the ring — the dump
  // "worked backwards", which is exactly what it looked like.
  for (const [line, bore, other] of [['td1', 1, -1], ['td2', -1, 1]] as const) {
    console.log(`--- dump with ${line.toUpperCase()}, one kicker pulse per batch ---`);
    const mine = w.bunchesInBeam(0, bore);
    const theirs = w.bunchesInBeam(0, other);
    const before = w.damage.length;
    w.armKicker(w.lineIndex(line));
    for (let i = 0; i < 3000; i++) {
      w.advance(1 / 60);
      if (w.extractions[w.lineIndex(line)].state === 'idle' && w.inFlight === 0) break;
    }
    console.log(
      `beam ${bore > 0 ? 1 : 2}               `,
      `${mine} → ${w.bunchesInBeam(0, bore)}`,
      '(one pulse, one batch)',
    );
    console.log(
      `beam ${other > 0 ? 1 : 2}               `,
      `${theirs} → ${w.bunchesInBeam(0, other)}`,
      '(a kicker acts on one aperture)',
    );
    const hits = w.damage.slice(before);
    const exit = w.extractions[w.lineIndex(line)].line.exit;
    for (const d of hits) {
      const rx = d.px - exit.x;
      const ry = d.py - exit.y;
      console.log(
        'stopped              ',
        `${(rx * exit.dx + ry * exit.dy).toFixed(0)} m into the block,`,
        `${Math.abs(-rx * exit.dy + ry * exit.dx).toFixed(1)} m off its axis —`,
        d.onPurpose ? 'in the absorber' : 'NOT in the absorber',
      );
    }
  }
}

// There is no injection interlock, and this is why that is the interesting choice. The
// injector only ever makes 450 GeV; a collider at flat top is running its dipoles fifteen
// times harder than that beam can be bent by. The bunch is not captured, is not accelerated,
// and is in the wall almost at once. Nothing about the pusher is different — the field is.
console.log('--- injecting 450 GeV into a ramped collider ---');
{
  const w = new World();
  w.attachBackend(new CpuBackend());
  w.collider.setTargetEnergy(LHC_CONFIG.topEnergyGeV);
  while (w.collider.energyGeV < LHC_CONFIG.topEnergyGeV - 0.5 && w.machineClock < 5000) {
    w.advance(1 / 60);
  }
  console.log('collider at            ', w.collider.energyGeV.toFixed(0), 'GeV,', w.collider.fieldStrength.toFixed(2), 'T');

  const entry = w.collider.ring.injection;
  loadInjector(w);
  w.armKicker(w.lineIndex('ti2'));
  const before = w.damage.length;
  for (let i = 0; i < 4000 && w.damage.length === before; i++) w.advance(1 / 60);
  const site = w.damage[w.damage.length - 1];
  console.log('the batch is captured  ', w.bunchesIn(0) > 0 ? 'yes (WRONG)' : 'no — its momentum is 6 % of the ring\'s');
  if (site) {
    console.log(
      'and dies               ',
      `${Math.hypot(site.sx - entry.x, site.sy - entry.y).toFixed(0)} m from the injection point`,
    );
  }
  // the same batch into a collider that is *not* ramped is the working case, above
}

console.log('--- quench ---');
{
  const w = colliderWorld();
  w.collider.setTargetEnergy(LHC_CONFIG.topEnergyGeV);
  while (w.collider.energyGeV < LHC_CONFIG.topEnergyGeV - 0.5 && w.machineClock < 5000) {
    w.advance(1 / 60);
  }
  const c = w.collider.circuits[3];
  console.log('at flat top          ', `${c.temperature.toFixed(2)} K, quenches at ${c.quenchTemperature.toFixed(2)} K`);
  console.log('margin at nominal    ', (c.quenchTemperature - 1.9).toFixed(2), 'K');

  const oneBatch = w.storedBeamEnergy(0);
  console.log('one batch carries    ', si(oneBatch), '— into a', (c.config.coldMass / 1000).toFixed(0), 't cold mass');
  const quenched = c.deposit(oneBatch);
  console.log('a direct hit         ', quenched ? 'quenches it' : 'does NOT quench it (wrong)');
  console.log('coil after the hit   ', c.temperature.toFixed(0), 'K');

  let t = 0;
  while (c.state === 'quenching' && t < 100) {
    w.advance(1 / 60);
    t += 1 / 60;
  }
  console.log('detection + heaters  ', (t * w.options.opsTimeScale).toFixed(2), 's of machine time, then', c.state);
  console.log('coil after heaters   ', c.temperature.toFixed(0), 'K (the stored field is in the cold mass now)');
  const i0 = c.current;
  for (let i = 0; i < 600; i++) w.advance(1 / 60);
  console.log('current decaying     ', i0.toFixed(0), '→', c.current.toFixed(0), 'A through the extraction resistors');
  console.log('beam after the quench', w.beam.alive[0] ? 'still circulating' : 'lost — the bend went with it');

  w.collider.toggleCircuit(3);
  console.log('operator reset       ', c.state);
}

// A quench is a heating event: joules into the cold mass, and the coil goes normal if that
// takes it past the load line. Two things decide it, and both are worth seeing — how much
// energy the beam carries, and how far from the coil it let go of it. The second used to be
// ignored entirely: a loss anywhere but *inside* an arc deposited nothing at all, so a batch
// that hit the wall of a straight a few metres from a dipole left it at 1.9 K.
console.log('--- what it takes to quench a magnet ---');
{
  const probe = new World();
  probe.collider.setTargetEnergy(LHC_CONFIG.topEnergyGeV);
  while (probe.collider.energyGeV < LHC_CONFIG.topEnergyGeV - 0.5 && probe.machineClock < 5000) {
    probe.advance(1 / 60);
  }
  const c = probe.collider.circuits[0];
  const margin = c.quenchTemperature - 1.9;
  const capacity = c.config.coldMass * 3.5;
  console.log(`at flat top a sector takes ${(margin * capacity / 1e6).toFixed(1)} MJ before it goes normal`);
  console.log(' gap from the coil    reaches it   as a 6.8 TeV batch   as a 450 GeV batch');
  for (const gap of [0, 100, 200, 300, 500, 1000]) {
    const f = Math.exp(-gap / LHC_CONFIG.apertureRadius);
    const hot = PROTONS_PER_BATCH * 6800 * 1.602176634e-10 * f;
    const cold = PROTONS_PER_BATCH * 450 * 1.602176634e-10 * f;
    console.log(
      ` ${String(gap).padStart(9)} m   ${(f * 100).toFixed(0).padStart(9)} %` +
        `   ${(hot / capacity).toFixed(2).padStart(7)} K ${hot / capacity > margin ? 'quench ' : 'holds  '}` +
        `      ${(cold / capacity).toFixed(2).padStart(6)} K ${cold / capacity > margin ? 'quench' : 'holds'}`,
    );
  }
  console.log('so a 450 GeV batch never quenches: the model spreads a hit over the whole');
  console.log('4235 t string, and one batch at injection energy is 1.9 MJ of it.');

  // End to end, at flat top: kill the bend and see where the beam ends up and what that
  // costs. The point of interest is that it does not have to die *in* a magnet any more.
  const off = colliderWorld();
  off.collider.setTargetEnergy(LHC_CONFIG.topEnergyGeV);
  while (off.collider.energyGeV < LHC_CONFIG.topEnergyGeV - 0.5 && off.machineClock < 5000) {
    off.advance(1 / 60);
  }
  off.collider.toggleCircuit(1);
  for (let i = 0; i < 1800 && off.beam.alive[0]; i++) off.advance(1 / 60);
  const hit = off.losses[off.losses.length - 1];
  if (hit) {
    console.log(
      'a 6.8 TeV batch let go  ',
      hit.sector >= 0 ? 'inside a magnet,' : 'on a straight,',
      `${hit.coilGap.toFixed(0)} m from the nearest coil —`,
      `${(hit.coilFraction * 100).toFixed(0)} % of it reached the cold mass,`,
      `${off.quenchedCircuits} circuit(s) quenched`,
    );
  }
}

// A beam hitting matter is a cascade, not a blow: one proton makes a tree of secondaries
// that branches until nothing has the energy to make anything new. The shape below is what
// gets drawn, and the same builder is what two beams colliding will use.
console.log('--- the shower one proton makes ---');
{
  const names = ['hadron', 'EM', 'neutron', 'muon'];
  console.log(' E [GeV]   particles   drawn   reach     width    hadron/EM/neutron/muon');
  for (const e of [450, 6800]) {
    const s = buildShower(e, 12345);
    const mix = [0, 0, 0, 0];
    let deepest = 0;
    for (let i = 0; i < s.count; i++) {
      mix[s.data[i * SEGMENT_STRIDE + 4] | 0]++;
      deepest = Math.max(deepest, s.data[i * SEGMENT_STRIDE + 6]);
    }
    console.log(
      ` ${String(e).padStart(6)}   ${String(s.particles).padStart(9)}   ${String(s.count).padStart(5)}` +
        `   ${s.reach.toFixed(2).padStart(5)} m   ${s.spread.toFixed(2).padStart(5)} m   ` +
        mix.map((n, k) => `${names[k]} ${n}`).join(', ') +
        `, ${deepest} generations`,
    );
  }
  // the same primary twice must give the same tree, or the picture boils at 60 Hz
  const a = buildShower(6800, 99);
  const b = buildShower(6800, 99);
  let same = a.count === b.count;
  for (let i = 0; same && i < a.count * SEGMENT_STRIDE; i++) same = a.data[i] === b.data[i];
  console.log('deterministic in the seed', same ? 'yes' : 'NO — it will boil between frames');
  console.log(
    'a real one is           ',
    'thousands of particles over a few metres; the tree above is the trunk of that,',
  );
  console.log('                         cut to a drawing budget, with the count reported.');
}

console.log('--- damage vs beam energy ---');
console.log(' E [GeV]   deposited     depth      peak T      verdict');
for (const e of [450, 1800, 6800]) {
  const deposited = PROTONS_PER_BATCH * e * 1.602176634e-10;
  const depth = penetrationDepth(e, deposited);
  const peak = channelTemperature(deposited, depth);
  console.log(
    ` ${String(e).padStart(5)}   ${(deposited / 1e6).toFixed(0).padStart(6)} MJ   ${depth
      .toFixed(1)
      .padStart(6)} m   ${peak.toFixed(0).padStart(7)} K   ${verdictFor(peak)}`,
  );
}

// What a beam of each energy is drawn moving at. There is no slider: the rate is a function
// of the beam's own energy, so this table is the whole pacing model.
console.log('--- pacing: drawn speed vs the beam\'s own energy ---');
console.log(' E [GeV]   1-beta      s/turn   turns/s   steps/frame @60fps');
{
  const probe = new World();
  for (const e of [450, 900, 1800, 3400, 6800]) {
    const fraction = Math.sqrt(e * e - 0.88) / Math.sqrt(6800 * 6800 - 0.88);
    probe.collider.programmedCurrent = LHC_CONFIG.nominalCurrent * fraction;
    for (const c of probe.collider.circuits) c.current = probe.collider.programmedCurrent;
    const t = probe.collider.telemetry();
    const perFrame = probe.options.stepsPerTurn / (probe.secondsPerTurn * 60);
    console.log(
      ` ${String(e).padStart(5)}   ${(1 - t.beta).toExponential(2)}  ${probe.secondsPerTurn
        .toFixed(3)
        .padStart(7)}   ${(1 / probe.secondsPerTurn).toFixed(2).padStart(6)}   ${perFrame
        .toFixed(0)
        .padStart(6)}`,
    );
  }
  console.log('the injector is a quarter of the size, so one world step takes it a quarter');
  console.log('of a turn further: same metres per step everywhere, no second clock.');
}

// --- the experiments ---------------------------------------------------------
//
// Every number under here is derived from geometry and four measured constants (bunches per
// batch, 25 ns spacing, the 16.6 µm beam size at the IP, the 80 mb inelastic cross-section).
// If a nominal fill stops reading 2808 bunch pairs and 1.2e34, something moved.
console.log('--- the experiments ---');
{
  const w = new World();
  w.attachBackend(new CpuBackend());
  const C = LHC_CONFIG.circumference;
  const names = w.detectors.map((d) => d.config.name).join(' + ');
  const apart = w.detectors[1].s - w.detectors[0].s;
  console.log('insertions           ', names, `at s = ${w.detectors.map((d) => d.s.toFixed(0)).join(', ')} m`);
  console.log('half a ring apart    ', `${(apart - C / 2).toFixed(3)} m of error`,
    '(they must be: two counter-rotating bunches meet at two antipodal points)');
  console.log('one macro-particle   ', `${BUNCHES_PER_BATCH} bunches over ${BATCH_LENGTH.toFixed(0)} m`,
    `= ${((BATCH_LENGTH / C) * 100).toFixed(1)} % of the ring`);
  console.log('so a crossing counts ', `within ±${(BATCH_LENGTH / 2).toFixed(0)} m of an IP`);
  console.log('bunch crossing rate  ', `${(CROSSING_RATE / 1e6).toFixed(1)} MHz`, ' (LHC: 40)');

  // A nominal fill, placed by hand: 12 batches each way, mirrored about IP3 so every pair
  // crosses exactly there.
  for (let m = 0; m < 12; m++) {
    for (const [s, bore] of [
      [w.detectors[0].s + (m * C) / 12, 1],
      [w.detectors[0].s - (m * C) / 12, -1],
    ] as const) {
      const p = poseAtArclength(w.collider.ring, s);
      w.beam.inject({
        x: p.x, y: p.y, dx: p.dx * bore, dy: p.dy * bore,
        gamma: w.collider.gamma, protons: PROTONS_PER_BATCH, ring: 0,
      });
    }
  }
  w.attachBackend(new CpuBackend());
  w.collider.setTargetEnergy(LHC_CONFIG.topEnergyGeV);
  for (let i = 0; i < 4000; i++) w.collider.advanceOperations(1);
  for (let i = 0; i < w.beam.count; i++) w.beam.ring[i] = 0;
  w.advance(1 / 60);

  const ip = w.detectors[0];
  console.log('--- a nominal fill, 12 + 12 batches, every pair head-on ---');
  console.log('batch pairs colliding', ip.collidingPairs, ' (12)');
  console.log('bunch pairs per turn ', ip.bunchPairs.toFixed(0), ' (LHC: 2808)');
  console.log('luminosity           ', ip.luminosity.toExponential(2), 'cm^-2 s^-1  (LHC: 1.0e34)');
  console.log('the other insertion  ', w.detectors[1].luminosity.toExponential(2), '— the same, and not by accident');
  console.log('pile-up              ', ip.pileUp.toFixed(0), 'per crossing  (LHC: 30-60)');
  console.log('interaction rate     ', (ip.luminosity * SIGMA_INELASTIC / 1e9).toFixed(2), 'GHz  (LHC: ~1)');
  console.log('Higgs                ', (ip.luminosity * SIGMA_HIGGS).toFixed(2), 'per second  (LHC: ~1)');
  {
    let protons = 0;
    for (let i = 0; i < w.beam.count; i++) protons += w.beam.charge[i];
    const perSecond = 2 * 2 * ip.luminosity * SIGMA_INELASTIC; // two beams, two insertions
    console.log('burn-off lifetime    ', (protons / perSecond / 3600).toFixed(0), 'h  (LHC: ~50)');
  }

  // And where an experiment actually sees them. Two 1754 m batches do not meet at a point:
  // their bunches meet all along a triangular distribution about the crossing, and what one
  // insertion collects is the part of that lying inside it. So an event display goes where
  // the beams are — dead centre when the machine is phased, pushed against the far end of the
  // detector when it is not. Drawing every vertex at the middle of the box put flashes where
  // the same picture was showing there was no beam, which is the one thing it must not do.
  console.log('--- where in an insertion an event is drawn ---');
  console.log(' crossing from IP    events drawn at            of a ±550 m insertion');
  for (const off of [0, 300, 600]) {
    const w = new World();
    w.attachBackend(new CpuBackend());
    const ip = w.detectors[0].s;
    for (const [s, bore] of [
      [ip + off, 1],
      [ip + off, -1],
    ] as const) {
      const p = poseAtArclength(w.collider.ring, s);
      w.beam.inject({
        x: p.x, y: p.y, dx: p.dx * bore, dy: p.dy * bore,
        gamma: w.collider.gamma, protons: PROTONS_PER_BATCH, ring: 0,
      });
    }
    w.attachBackend(new CpuBackend());
    for (let i = 0; i < w.beam.count; i++) w.beam.ring[i] = 0;

    const seen: number[] = [];
    let count = 0;
    for (let i = 0; i < 6000 && seen.length < 8; i++) {
      w.advance(1 / 60);
      if (w.collisions.length > count) seen.push(w.collisions[w.collisions.length - 1].offset);
      count = w.collisions.length;
    }
    const mean = seen.reduce((a, b) => a + b, 0) / Math.max(1, seen.length);
    const lo = seen.length > 0 ? Math.min(...seen) : 0;
    const hi = seen.length > 0 ? Math.max(...seen) : 0;
    console.log(
      ` ${String(off).padStart(9)} m     mean ${mean.toFixed(0).padStart(5)} m,` +
        ` spread ${lo.toFixed(0).padStart(5)} to ${hi.toFixed(0).padStart(4)} m  (${seen.length} events)`,
    );
  }
  console.log('on the real machine that scatter is centimetres and the insertion is a point;');
  console.log('it is visible here only because a detector is drawn twenty times its true size.');

  // What mis-phasing costs. The pair count is triangular in how far the crossing sits from
  // the IP, so this is the whole of why cogging is a control and not a checkbox.
  console.log('--- luminosity vs where the crossing sits ---');
  console.log(' offset from IP    bunch pairs   fraction of head-on');
  for (const off of [0, 200, 440, 877, 1200]) {
    const pairs = Math.max(0, (BATCH_LENGTH - 2 * off) / (BATCH_LENGTH / BUNCHES_PER_BATCH));
    console.log(
      ` ${String(off).padStart(9)} m    ${pairs.toFixed(0).padStart(9)}   ` +
        `${((pairs / BUNCHES_PER_BATCH) * 100).toFixed(0).padStart(3)} %`,
    );
  }
}

// Phasing, end to end, through the real operator path: fill, extract, arrive, capture, cog.
// This is the check that would have caught reading a line's `bore` as the beam it becomes in
// the collider — TI 8 leaves the injector forwards and arrives backwards.
//
// **Injection no longer waits for a phase**, so what this measures is the two things left:
// how long a kicker holds (only ever for a bucket one of its own is already in), and what
// cogging then does with wherever the batches landed.
console.log('--- phasing a fill, through the machine ---');
{
  const dt = 1 / 60;
  const w = new World();
  w.attachBackend(new CpuBackend());
  const run = (s: number) => { for (let i = 0; i < s / dt; i++) w.advance(dt); };
  let waited = 0;
  for (const id of ['ti2', 'ti8']) {
    // Fill *and ramp*: the injector now hands over 450 GeV only after it has been taken
    // there, and a 26 GeV batch would never be captured by the collider at all.
    loadInjector(w);
    run(0.6);
    const k = w.lineIndex(id);
    w.armKicker(k);
    let t = 0;
    while (w.extractions[k].sent === 0 && t < 20) { w.advance(dt); t += dt; }
    waited = Math.max(waited, t);
    run(1.4);
  }

  const x = w.crossingNearestIP();
  const d = w.detectors[0];
  console.log(
    `injected  waited ${waited.toFixed(2)} s  ->  crossing ${
      x ? `${x.offset.toFixed(0).padStart(6)} m` : '     —'
    }   ${d.collidingPairs > 0 ? `${d.bunchPairs.toFixed(0)} bunch pairs, L = ${d.luminosity.toExponential(2)}` : 'nothing collides'}`,
  );
  if (x) {
    // and this is what the operator does about it
    w.autoCog();
    let t = 0;
    while (w.coggingAuto && t < 40) { w.advance(dt); t += dt; }
    const y = w.crossingNearestIP();
    console.log(
      `          auto-cog ${t.toFixed(1)} s  ->  crossing ${y ? `${y.offset.toFixed(0).padStart(6)} m` : '     —'}` +
        `   ${w.detectors[0].bunchPairs.toFixed(0)} bunch pairs, L = ${w.detectors[0].luminosity.toExponential(2)}`,
    );
  }
  // What the operator's own control does with a second of holding, at both energies. The
  // crossing point moves at half the slip, and the slip is a fraction of a revolution — so
  // this is four times faster at flat top, where the beam is drawn going four times faster.
  for (const top of [false, true] as const) {
    if (top) {
      w.collider.setTargetEnergy(LHC_CONFIG.topEnergyGeV);
      for (let t = 0; t < 60 && w.collider.isRamping; t += dt) w.advance(dt);
    }
    const before = w.crossingNearestIP();
    w.setCogging(1);
    run(1);
    const after = w.crossingNearestIP();
    w.setCogging(0);
    console.log(
      `          cogging by hand at ${top ? 'flat top ' : 'injection'} ` +
        `${before && after ? `${Math.abs(after.offset - before.offset).toFixed(0)} m of ring per second` : '—'}`,
    );
  }
  // `canCog` is what greys the cogging controls out, asked once a frame — so it must not
  // flicker. It is deliberately geometric (`gatherBunches` asks where a particle is, not which
  // ring's RF is holding it), because the capture question does flicker: a batch passing the
  // mouth of a transfer line is claimed by it for a frame or two. This is the assertion that
  // the geometric one does not.
  {
    let dead = 0;
    const frames = Math.round(30 / dt);
    for (let i = 0; i < frames; i++) {
      w.advance(dt);
      if (!w.canCog) dead++;
    }
    console.log(
      `          two beams up: cogging offered in ${frames - dead} of ${frames} frames ` +
        `(the control greys out on the other ${dead})`,
    );
  }
  console.log('a pulse fires as soon as it may — the phases injection can reach are a 430 m');
  console.log('grid and hunting it was seconds of dead time — so cogging does all the aiming,');
  console.log('and the automatic loop runs a harder slip until it is close (COG_TRIM_FAST).');
}

console.log('--- the event one collision makes ---');
{
  for (const cm of [900, 13_600]) {
    const ev = buildCollision(cm, 12345);
    const seen = new Set<number>();
    for (let i = 0; i < ev.count; i++) seen.add(ev.data[i * SEGMENT_STRIDE + 4]);
    console.log(
      ` sqrt(s) ${String(cm).padStart(6)} GeV   ${String(ev.primaries).padStart(3)} out of the collision,` +
        ` ${String(ev.particles).padStart(4)} particles after showering,` +
        ` ${ev.count} drawn, ${seen.size} species, reach ${ev.reach.toFixed(2)} / ${ev.back.toFixed(2)}` +
        ` and ${ev.spread.toFixed(2)} across, in detector radii`,
    );
  }
  console.log('flat in rapidity with a few hundred MeV of pT, which is what makes it a spray');
  console.log('along the pipe both ways with a scatter of tracks across it. The first 42 % of');
  console.log('the radius is transparent, so the tracks read as tracks before anything showers.');

  // What a track *is* depends on how hard it is, and that is the one thing about a collision
  // that really does scale with energy. Making a particle costs energy, so the heavier and
  // rarer the thing, the more transverse momentum the collision had to have to make it.
  console.log('--- what a track is, by how hard it is ---');
  const hardest = new Map<string, { n: number; pt: number }>();
  let events = 0;
  let withLepton = 0;
  let withHeavy = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const ev = buildCollision(13_600, seed * 7919);
    events++;
    const name = speciesName(ev.hardestSpecies);
    const row = hardest.get(name) ?? { n: 0, pt: 0 };
    row.n++;
    row.pt = Math.max(row.pt, ev.hardestPt);
    hardest.set(name, row);
    let lepton = false;
    let heavy = false;
    for (let i = 0; i < ev.count; i++) {
      const s = ev.data[i * SEGMENT_STRIDE + 4];
      if (s === SPECIES_LEPTON) lepton = true;
      if (s === SPECIES_HEAVY) heavy = true;
    }
    if (lepton) withLepton++;
    if (heavy) withHeavy++;
  }
  console.log(` over ${events} events, the hardest object was:`);
  for (const [name, row] of [...hardest].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `   ${name.padEnd(16)} ${((row.n / events) * 100).toFixed(1).padStart(5)} % of events,` +
        ` up to ${row.pt.toFixed(0)} GeV`,
    );
  }
  console.log(` events containing a b/c jet ${((withHeavy / events) * 100).toFixed(0)} %,` +
    ` an isolated lepton ${((withLepton / events) * 100).toFixed(0)} %`);
  console.log(' the *shape* is real — a soft exponential plus a power-law tail from hard');
  console.log(' parton scattering — and so is the ordering. The rate of the rare ones is not:');
  console.log(' a real inelastic event contains a W about once in ten million, and a display');
  console.log(' that never showed one would not be worth having. This is a drawing budget of');
  console.log(' the same kind as the 256 segments, and this is where it is stated.');
}

// Collisions are not free to the machine. The debris of every interaction goes down the pipe
// into the superconducting magnets that squeeze the beams together, and the cryogenics has to
// take it back out — a capacity, not a rate, so past it there is no equilibrium at all.
console.log('--- what the collisions do to the machine around them ---');
{
  console.log(' fill        luminosity    debris into the coils   verdict');
  for (const n of [6, 12, 18, 24]) {
    const w = new World();
    w.attachBackend(new CpuBackend());
    w.collider.setTargetEnergy(LHC_CONFIG.topEnergyGeV);
    for (let i = 0; i < 4000; i++) w.collider.advanceOperations(1);
    const C = LHC_CONFIG.circumference;
    const ip = w.detectors[0].s;
    for (let m = 0; m < n; m++) {
      for (const [s, bore] of [
        [ip + (m * C) / n, 1],
        [ip - (m * C) / n, -1],
      ] as const) {
        const p = poseAtArclength(w.collider.ring, s);
        w.beam.inject({
          x: p.x, y: p.y, dx: p.dx * bore, dy: p.dy * bore,
          gamma: w.collider.gamma, protons: PROTONS_PER_BATCH, ring: 0,
        });
      }
    }
    w.attachBackend(new CpuBackend());
    for (let i = 0; i < w.beam.count; i++) w.beam.ring[i] = 0;
    for (let i = 0; i < 60; i++) w.advance(1 / 60);
    const d = w.detectors[0];
    // read before the long run: thirty seconds of play is nearly seven hours of machine time,
    // and burn-off has visibly eaten the beam by the end of it
    const lumi = d.luminosity;
    const debris = d.debrisPower;
    const over = debris > INSERTION_COOLING;
    for (let i = 0; i < 60 * 30; i++) w.advance(1 / 60);
    console.log(
      ` ${String(n).padStart(2)}+${String(n).padEnd(2)}   ${lumi.toExponential(2)}` +
        `   ${debris.toFixed(0).padStart(6)} W of ${INSERTION_COOLING} W    ` +
        (over
          ? `over capacity — ${d.temperature.toFixed(0)} K after thirty seconds of play${d.quenched ? ', QUENCHED' : ''}`
          : `holds at ${d.temperature.toFixed(2)} K`),
    );
  }
  console.log(' 2.1 kW at nominal, of which 40 % reaches the coils — which is the kilowatt a');
  console.log(' side the real inner triplets are quoted at, and the reason the real machine');
  console.log(' needs new ones to run brighter. Cooling back from 40 K takes 18 s of play.');
}

// The second view of a collision: the same event looked at down the beam pipe. What has to
// be true of it is that it is the *same* event — one generator, two projections — and that
// the one thing the transverse view exists to show comes out at the real number.
console.log('--- the transverse view of the same collision ---');
{
  for (const cm of [900, 13_600]) {
    const seed = 12345;
    const rz = buildCollision(cm, seed);
    const rphi = buildTransverse(cm, seed);
    console.log(
      ` sqrt(s) ${String(cm).padStart(6)} GeV  ` +
        `${rphi.primaries} particles (${rphi.charged} charged), ${rphi.drawn} tracks drawn, ` +
        `${rphi.hitCount} tracker hits, ${rphi.loopers} curled up inside the tracker, ` +
        `${rphi.muonTracks} through to the muon chambers, sum pT ${rphi.sumEt.toFixed(0)} GeV`,
    );
    console.log(
      `                     same event as the r-z view: ` +
        `${rz.primaries === rphi.primaries && rz.hardestPt === rphi.hardestPt ? 'yes' : 'NO — the two views have drifted apart'}` +
        ` (${rz.primaries} primaries, hardest ${rphi.hardestPt.toFixed(1)} GeV ` +
        `${speciesName(rphi.hardestSpecies)})`,
    );
  }

  // The barrel, which is what the display draws and what a particle stops in.
  const kinds = (k: string): number => BARREL.filter((l) => l.kind === k).length;
  console.log(
    ' barrel                ',
    `${BARREL.length} layers: ${kinds('pixel')} pixel, ${kinds('strip')} strip,`,
    `${kinds('straw')} straw, ${EM_SAMPLINGS} EM samplings x ${EM_CELLS} cells,`,
    `${HAD_SAMPLINGS} tile x ${HAD_CELLS}, ${MUON_STATIONS} muon stations x ${MUON_CHAMBERS}`,
  );
  {
    const outer = (k: string): number => Math.max(...BARREL.filter((l) => l.kind === k).map((l) => l.r1));
    const agree =
      Math.abs(outer('straw') - DETECTOR_SHELLS[0]) < 1e-9 &&
      Math.abs(outer('em') - DETECTOR_SHELLS[1]) < 1e-9 &&
      Math.abs(outer('had') - DETECTOR_SHELLS[2]) < 1e-9;
    console.log(
      ' group boundaries      ',
      agree
        ? `tracker ${DETECTOR_SHELLS[0]}, EM ${DETECTOR_SHELLS[1]}, tile ${DETECTOR_SHELLS[2]} — the same numbers the cascade and the ring use`
        : 'MISMATCHED against DETECTOR_SHELLS',
    );
  }

  // The measurement the r-phi view is for. A track on a circle through the vertex never gets
  // further from it than 2R, so it escapes a shell of radius r only if 2 * BEND * pT > r —
  // and because the bend is standardised on the tracker, that threshold is the real one.
  const escape = DETECTOR_SHELLS[0] / (2 * TRANSVERSE_BEND);
  const real = 0.299_792_458 * SOLENOID_FIELD * 1.15 * 0.5;
  console.log(
    ' pT to leave the tracker',
    `${escape.toFixed(3)} GeV/c`,
    `(1.15 m at ${SOLENOID_FIELD} T: ${real.toFixed(3)})`,
    Math.abs(escape - real) < 1e-3 ? '' : ' — MISMATCHED',
  );
  // Longitudinal segmentation, which is the point of having four samplings and not one ring.
  {
    const e = buildTransverse(13_600, 1006);
    const depth = (a: Float32Array, cells: number, n: number): string => {
      const out: string[] = [];
      for (let s = 0; s < n; s++) {
        let sum = 0;
        for (let c = 0; c < cells; c++) sum += a[s * cells + c];
        out.push(sum.toFixed(0));
      }
      return out.join(' / ');
    };
    console.log(' EM samplings [GeV]    ', depth(e.em, EM_CELLS, EM_SAMPLINGS), '— an EM shower peaks in sampling 2');
    console.log(' tile samplings [GeV]  ', depth(e.had, HAD_CELLS, HAD_SAMPLINGS), '— what punched through');
  }
  console.log(' tracks curve inside the solenoid and run straight outside it, because the barrel');
  console.log(' bending out there is a toroid and bends in the other plane. The cell a particle');
  console.log(' lights is at the azimuth the bend left it at, not the one it started from — which');
  console.log(' is the whole measurement, and exactly what the r-z view on the ring throws away.');
  console.log(' A neutral leaves no hits at all: that is how a photon is told from an electron.');
}

// A running experiment sees a billion interactions a second and can look at none of them.
// What it does instead is trigger, and this is the rate that comes out of it.
console.log('--- the trigger ---');
{
  const w = new World();
  w.attachBackend(new CpuBackend());
  const ip = w.detectors[0].s;
  for (let b = 0; b < 6; b++) {
    for (const bore of [1, -1] as const) {
      const p = poseAtArclength(w.collider.ring, ip + b * BATCH_LENGTH * 1.05);
      w.beam.inject({
        x: p.x, y: p.y, dx: p.dx * bore, dy: p.dy * bore,
        gamma: w.collider.gamma, protons: PROTONS_PER_BATCH, ring: 0,
      });
    }
  }
  w.attachBackend(new CpuBackend());
  for (let i = 0; i < w.beam.count; i++) w.beam.ring[i] = 0;
  for (let i = 0; i < 60 * 30; i++) w.advance(1 / 60);

  for (const d of w.detectors) {
    const kept = d.kept;
    console.log(
      ` ${d.config.name}`,
      `saw ${d.events.toExponential(2)} interactions,`,
      `offered ${d.candidates} candidates,`,
      `kept ${d.recorded}`,
      kept
        ? `— on the display: ${speciesName(kept.event.hardestSpecies)} at ${kept.score.toFixed(1)} GeV`
        : '— nothing',
    );
    console.log(
      `      the one on the display was picked out of ${d.selectivity.toExponential(2)} interactions`,
    );
  }
  console.log(' the bar is the last thing kept and decays back to', `${TRIGGER_MIN_PT} GeV`,
    'over a few seconds,');
  console.log(' so a monster event holds the display for a while and then lets the next one in.');
  console.log(' the selection rule is a real one — hardest object, bar from what was last kept.');
  console.log(' the candidate rate is not: a cascade is built for about one collision per pass,');
  console.log(' so the trigger is choosing among a handful and not among a billion a second.');
}

// The one thing collisions do to the beam, and the one thing they must not do.
console.log('--- burn-off: the beam thins, and does not soften ---');
{
  const w = new World();
  w.attachBackend(new CpuBackend());
  const ip = w.detectors[0].s;
  for (const bore of [1, -1] as const) {
    const p = poseAtArclength(w.collider.ring, ip);
    w.beam.inject({
      x: p.x, y: p.y, dx: p.dx * bore, dy: p.dy * bore,
      gamma: w.collider.gamma, protons: PROTONS_PER_BATCH, ring: 0,
    });
  }
  w.attachBackend(new CpuBackend());
  for (let i = 0; i < w.beam.count; i++) w.beam.ring[i] = 0;
  const gamma0 = w.beam.gamma[0];
  console.log(' play [s]   intensity   stored beam E   gamma');
  for (const seconds of [0, 30, 120, 300]) {
    while (w.elapsed < seconds) w.advance(1 / 60);
    console.log(
      ` ${String(seconds).padStart(8)}   ${(w.beamIntensity(0) * 100).toFixed(1).padStart(7)} %`,
      `  ${si(w.storedBeamEnergy(0)).padStart(9)}`,
      `  ${w.beam.gamma[0].toFixed(0)}`,
      Math.abs(w.beam.gamma[0] / gamma0 - 1) < 1e-9 ? '(unchanged, as it must be)' : '(MOVED — burn-off must not touch the energy)',
    );
  }
  console.log(' two protons leave the machine per inelastic interaction and nothing puts them');
  console.log(' back. What a burning fill loses is population: the protons still in it are');
  console.log(' exactly as energetic, which is why it is drawn thinner and not slower.');
}

// What the running is *for*. Everything here is a function of one number — the integrated
// luminosity — and of nothing else, which is the same claim the luminosity itself makes.
console.log('--- the mass spectra: what a run turns into ---');
{
  const a = new Analysis();
  const fb = (x: number) => x * FEMTOBARN_INVERSE;

  // The peaks land where the particles are. A bin whose centre is nearest the mass must be
  // the tallest bin in its neighbourhood, or the plot is drawing something else.
  // The bin a resonance's mass falls in must stand over both of its neighbours. Asked of the
  // *immediate* neighbours and not of a window: the three Υ states are within 10 % of each
  // other and ψ′ sits on the J/ψ's shoulder, so a window test would ask each of them to be
  // the tallest thing near a much bigger peak and would fail on real physics.
  let misplaced = '';
  a.integrated = fb(0.05);
  const bins = a.dimuon.at(a.integrated);
  const binOf = (mass: number): number => {
    for (let i = 0; i < a.dimuon.binCount; i++) {
      if (mass >= a.dimuon.edges[i] && mass < a.dimuon.edges[i + 1]) return i;
    }
    return -1;
  };
  let unresolved = '';
  for (const source of a.dimuon.sources) {
    if (source.mass === 0) continue;
    const i = binOf(source.mass);
    if (i <= 0 || i >= a.dimuon.binCount - 1) continue;
    // A state sitting within a bin or two of a bigger one is *drawn* as a shoulder on it and
    // cannot be a peak of its own — which is what a plot at this resolution really looks
    // like. The three Υ states are inside 10 % of each other and this plot's bins are 7.5 %
    // wide; resolving them wants 270 bins in 240 px. Reported, not failed.
    const crowded = a.dimuon.sources.some(
      (other) => other !== source && other.sigma > source.sigma && Math.abs(binOf(other.mass) - i) <= 2,
    );
    if (bins[i] >= bins[i - 1] && bins[i] >= bins[i + 1]) continue;
    if (crowded) unresolved += ` ${source.name}`;
    else misplaced += ` ${source.name}`;
  }
  console.log(
    ` every resonance is a peak in its own bin  ${misplaced === '' ? 'yes' : `NO —${misplaced}`}` +
      `  (J/ψ 3.097, ψ′ 3.686, Υ 9.460 / 10.023 / 10.355, Z 91.19 GeV — the real masses)`,
  );
  if (unresolved !== '') {
    console.log(
      `   drawn as a shoulder on a bigger neighbour at 72 log bins:${unresolved}` +
        ' — which is what this resolution really gives',
    );
  }

  console.log(' exposure      J/ψ        Z       Z/(J/ψ)   γγ excess at 125 GeV');
  for (const x of [0.01, 0.1, 0.5, 1, 3]) {
    a.integrated = fb(x);
    const jpsi = a.dimuon.expected('jpsi', a.integrated);
    const z = a.dimuon.expected('z', a.integrated);
    const w = a.higgsWindow;
    console.log(
      ` ${`${x} fb-1`.padStart(9)}  ${jpsi.toExponential(1).padStart(8)} ${z
        .toExponential(1)
        .padStart(8)}   ${(z / jpsi).toExponential(1)}   ` +
        `${w.signal.toFixed(0).padStart(5)} on ${w.background.toFixed(0).padStart(6)} = ${w.sigma
          .toFixed(1)
          .padStart(4)} σ`,
    );
  }

  // Where the discovery lands, in exposure and in play time. The second number is the one
  // that says whether this is a session's worth of running or a week's.
  const probe = new Analysis();
  let found = 0;
  for (let x = 0.001; x < 50 && found === 0; x *= 1.02) {
    probe.integrated = fb(x);
    if (probe.higgsWindow.sigma >= DISCOVERY_SIGMA) found = x;
  }
  // A nominal fill is 1.2e34 per insertion and the analysis combines both, on the machine
  // clock — which runs 200× wall.
  const nominalPlay = fb(found) / (2 * 1.2e34) / 200;
  const onePlusOne = fb(found) / (2 * 9.0e32) / 200;
  console.log(
    ` five sigma at ${found.toFixed(2)} fb⁻¹` +
      ` — ${(nominalPlay / 60).toFixed(0)} min of play at a nominal fill,` +
      ` ${(onePlusOne / 3600).toFixed(1)} h at one batch each way`,
  );
  console.log(
    ` HIGGS_BOOST is ${HIGGS_BOOST}×, so the honest exposure would be ` +
      `${(found * HIGGS_BOOST).toFixed(1)} fb⁻¹ — which is the real order of the real discovery.`,
  );

  // **The spectrum is a function of the exposure and of nothing else.** Same total ∫L handed
  // over in one step and in a thousand has to give the same histogram, or this is an
  // accumulator with a frame-rate dependence in it, which is the bug the luminosity
  // computation exists to avoid.
  const oneStep = new Analysis();
  oneStep.advance(1e34, 1000);
  const many = new Analysis();
  for (let i = 0; i < 1000; i++) many.advance(1e34, 1);
  const A = oneStep.dimuon.at(oneStep.integrated);
  const B = many.dimuon.at(many.integrated);
  let worst = 0;
  for (let i = 0; i < A.length; i++) worst = Math.max(worst, Math.abs(A[i] - B[i]));
  console.log(
    ` 1 step vs 1000 steps of the same ∫L  ${worst < 1e-6 ? 'identical' : `DIFFER by ${worst}`}` +
      '  (it is computed from ∫L, never accumulated per frame)',
  );
}

// The things that go wrong on their own. Each one is forced and its stated effect checked,
// because an incident that says it dumped the beam and did not is a cutscene.
console.log('--- incidents ---');
{
  const perPlayHour = (mtbf: number) => 3600 / (mtbf * 3600 / 200);
  for (const def of INCIDENTS) {
    const w = new World();
    w.attachBackend(new CpuBackend());
    // Two batches at flat top, which is the state most of them are conditioned on.
    const ip = w.detectors[0].s;
    for (const bore of [1, -1] as const) {
      const p = poseAtArclength(w.collider.ring, ip);
      w.beam.inject({
        x: p.x, y: p.y, dx: p.dx * bore, dy: p.dy * bore,
        gamma: w.collider.gamma, protons: PROTONS_PER_BATCH, ring: 0,
      });
    }
    w.attachBackend(new CpuBackend());
    for (let i = 0; i < w.beam.count; i++) w.beam.ring[i] = 0;
    w.collider.setTargetEnergy(LHC_CONFIG.topEnergyGeV);
    for (let i = 0; i < 4000 && w.collider.isRamping; i++) w.advance(1 / 60);

    const armed = () => w.extractions.filter((e) => e.line.config.id.startsWith('td') && e.state !== 'idle').length;
    const off = () => w.collider.circuits.filter((c) => !c.enabled).length;
    const down = () => w.collider.circuits.filter((c) => c.isDown).length;
    const before = { armed: armed(), off: off(), down: down(), vacuum: w.vacuumFactor };
    const fires = def.when(w);
    w.forceIncident(def.id);
    const did: string[] = [];
    if (armed() > before.armed) did.push('dumped the beams');
    if (off() > before.off) did.push(`tripped ${off() - before.off} circuit off`);
    if (down() > before.down) did.push(`quenched ${down() - before.down}`);
    if (w.vacuumFactor > before.vacuum) did.push(`vacuum ×${w.vacuumFactor.toFixed(0)}`);
    if (w.shake > 0.5) did.push('shook the ground');
    console.log(
      ` ${def.id.padEnd(13)} MTBF ${String(def.mtbfHours).padStart(4)} h of machine time` +
        ` = one per ${(1 / perPlayHour(def.mtbfHours) * 60).toFixed(0)} min of play` +
        `  ${fires ? '' : '[not armed here] '}-> ${did.join(', ') || 'NOTHING — an incident must do something'}`,
    );
  }
  // One at a time: two alarms in the same second read as a bug rather than as bad luck.
  const w = new World();
  w.attachBackend(new CpuBackend());
  w.incidents.enabled = true;
  w.forceIncident('rf');
  let extra = 0;
  for (let i = 0; i < 60 * 20; i++) {
    const n = w.incidents.fired.length;
    w.advance(1 / 60);
    extra += w.incidents.fired.length - n;
  }
  console.log(
    ` cool-down ${IncidentSystem.COOLDOWN} s of machine time — ${extra} more in the ` +
      `${((60 * 20) / 60 * 200 / 60).toFixed(0)} min of machine time after one` +
      `${extra === 0 ? ' (as it must be)' : ' — COOLDOWN LEAKED'}`,
  );
  console.log(' rates are the real machine\'s order: a UFO dumps the LHC a couple of dozen times');
  console.log(' a year against ~1500 h of stable beams, and RF and cryogenics are next after it.');
}

// A fill from beam to dump, and the one calculation that says when to end it.
console.log('--- a fill, and when to dump it ---');
{
  const w = new World();
  w.attachBackend(new CpuBackend());
  const ip = w.detectors[0].s;
  for (const bore of [1, -1] as const) {
    const p = poseAtArclength(w.collider.ring, ip);
    w.beam.inject({
      x: p.x, y: p.y, dx: p.dx * bore, dy: p.dy * bore,
      gamma: w.collider.gamma, protons: PROTONS_PER_BATCH, ring: 0,
    });
  }
  w.attachBackend(new CpuBackend());
  for (let i = 0; i < w.beam.count; i++) w.beam.ring[i] = 0;
  for (let i = 0; i < 60 * 20; i++) w.advance(1 / 60);

  const tau = w.beamLifetime;
  const T = w.turnaround;
  const optimum = w.optimumFillLength;
  console.log(
    ` one head-on pair: lifetime ${(tau / 3600).toFixed(0)} h of machine time,` +
      ` turnaround ${(T / 60).toFixed(0)} min ->`,
  );
  console.log(
    `   optimum fill ${(optimum / 3600).toFixed(1)} h = ${(optimum / 200 / 60).toFixed(1)} min of play` +
      `  ${Math.abs(optimum - Math.sqrt(tau * T)) < 1 ? '(√(τ·T), the standard result)' : 'FORMULA MISMATCH'}`,
  );
  console.log(
    `   the real machine: 46 h lifetime, 4 h turnaround -> ` +
      `${(Math.sqrt(46 * 4)).toFixed(0)} h fills, which is what it runs`,
  );

  // The fill closes when the beam goes, and the report is what was collected.
  w.dumpBeams('operator dump');
  for (let i = 0; i < 60 * 30 && w.fill !== null; i++) w.advance(1 / 60);
  const report = w.fillHistory[w.fillHistory.length - 1];
  if (!report) {
    console.log(' fill never closed — the dump did not take the beam out');
  } else {
    console.log(
      ` fill ${report.index}: ${report.reason}, ${(report.integrated / FEMTOBARN_INVERSE).toExponential(2)} fb⁻¹` +
        ` in ${(report.stableSeconds / 60).toFixed(0)} min of stable beams,` +
        ` peak ${report.peakLuminosity.toExponential(2)} cm⁻²s⁻¹`,
    );
  }
}

function si(joules: number): string {
  if (joules >= 1e9) return `${(joules / 1e9).toFixed(2)} GJ`;
  if (joules >= 1e6) return `${(joules / 1e6).toFixed(1)} MJ`;
  if (joules >= 1e3) return `${(joules / 1e3).toFixed(1)} kJ`;
  return `${joules.toFixed(0)} J`;
}
