/**
 * Where does a dumped batch actually die?
 *
 * `isDumpEnd` accepts a loss within a few apertures of the line's exit, which at the
 * original 250 m aperture and 700 m line was a 1000 m ball covering the whole line and
 * reaching back to the ring — lax enough to report success without the beam ever getting
 * near the block. This prints each loss in the dump line's own frame: distance along it and
 * transverse offset from its axis.
 *
 * Run for both beams. TD2 is the one that used to throw the beam at the wall.
 */

import { World, DUMP_APERTURE_F, DUMP_LINE_LENGTH } from '../src/sim/world';
import { CpuBackend } from '../src/sim/backends/cpuBackend';

const w = new World();
w.attachBackend(new CpuBackend());

const send = (lineId: string): void => {
  w.fillInjector();
  w.armKicker(w.lineIndex(lineId));
  for (let i = 0; i < 6000; i++) {
    w.advance(1 / 60);
    if (w.extractions[w.lineIndex(lineId)].state === 'idle' && w.inFlight === 0) break;
  }
};
// two batches into beam 1 and two into beam 2
send('ti2');
send('ti8');
send('ti2');
send('ti8');
console.log(`in the collider: beam 1 ${w.bunchesInBeam(0, 1)}, beam 2 ${w.bunchesInBeam(0, -1)}`);

console.log(`dump line length ${DUMP_LINE_LENGTH} m, aperture factor ${DUMP_APERTURE_F}`);
for (const id of ['td1', 'td2']) {
  const idx = w.lineIndex(id);
  const e = w.extractions[idx];
  const line = e.line;
  const p = line.entry;
  const bore = line.config.bore;

  console.log(`\n--- ${line.config.name} (bore ${bore}) ---`);
  console.log(`  kicker cell ${line.config.kickerCell}, septum on arc ${line.config.kickerSector}`);
  console.log(`  entry      (${p.x.toFixed(0)}, ${p.y.toFixed(0)})  dir (${p.dx.toFixed(3)}, ${p.dy.toFixed(3)})`);
  console.log(`  exit       (${line.exit.x.toFixed(0)}, ${line.exit.y.toFixed(0)})`);
  console.log(`  geometry   ${line.straights.length} straights, ${line.arcs.length} arcs, ${line.length.toFixed(0)} m`);

  const before = w.damage.length;
  const had = bore > 0 ? w.bunchesInBeam(0, 1) : w.bunchesInBeam(0, -1);
  w.armKicker(idx);
  for (let i = 0; i < 8000; i++) {
    w.advance(1 / 60);
    if (w.extractions[idx].state === 'idle' && w.inFlight === 0) break;
  }
  const now = bore > 0 ? w.bunchesInBeam(0, 1) : w.bunchesInBeam(0, -1);
  console.log(`  bunches    ${had} -> ${now}`);
  console.log(`  losses     ${w.damage.length - before}`);
  // Where the particle *is* (px, py), not where its closed orbit was (sx, sy). For a beam
  // that ran down the middle of the pipe the two are hundreds of metres apart: once the line
  // runs out, the loss is anchored to whatever element claims the particle next.
  for (const d of w.damage.slice(before)) {
    const report = (tag: string, x: number, y: number): void => {
      const rx = x - p.x;
      const ry = y - p.y;
      console.log(
        `    ${tag} along ${(rx * p.dx + ry * p.dy).toFixed(0).padStart(7)} m` +
          `   across ${(-rx * p.dy + ry * p.dx).toFixed(1).padStart(8)} m`,
      );
    };
    report('impact ', d.px, d.py);
    report('anchor ', d.sx, d.sy);
    console.log(
      `    block mouth at along ${line.length.toFixed(0)} m, ${(line.config.apertureRadius * 12).toFixed(0)} m deep` +
        `, ±${(line.config.apertureRadius * 3.2).toFixed(0)} m wide   onPurpose=${d.onPurpose}`,
    );
  }
}
