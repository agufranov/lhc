/**
 * Headless smoke test of the renderer — `npm run check:render`.
 *
 * It exists because a drawing bug is invisible to the type checker and to the physics
 * check: `traceOrbit` used to call beginPath itself, so the second loop of a band fill
 * replaced the first, and `fill('evenodd')` painted the whole inner disc of the ring
 * opaque — burying every magnet. Nothing caught that but the naked eye.
 *
 * So: run the real Renderer against a canvas context that records what it was asked to
 * do, and assert the things you would otherwise have to look at.
 */

import { LHC_CONFIG, SPS_CONFIG } from '../src/sim/lattice';
import { World, poseAtArclength } from '../src/sim/world';
import { sampleLine } from '../src/sim/line';
import { SEGMENT_STRIDE, TRACKER_RADIUS } from '../src/sim/shower';
import { EVENT_CANVAS, eventPanelLeft } from '../src/ui/layout';
import { CpuBackend } from '../src/sim/backends/cpuBackend';
import { TRAIL_STRIDE } from '../src/sim/backend';

type Point = [number, number];

interface FillRecord {
  rule: string;
  subpaths: number;
  style: string;
  points: Point[];
}

class MockContext {
  fillStyle: unknown = '';
  strokeStyle: unknown = '';
  lineWidth = 1;
  lineCap = '';
  lineJoin = '';
  globalCompositeOperation = '';
  font = '';
  textAlign = '';
  textBaseline = '';

  subpaths = 0;
  points: Point[] = [];
  fills: FillRecord[] = [];
  strokes: Array<{ style: string; width: number; points: Point[]; op: string }> = [];
  texts: Array<{ text: string; x: number; y: number }> = [];

  beginPath(): void {
    this.subpaths = 0;
    this.points = [];
  }
  moveTo(x: number, y: number): void {
    this.subpaths++;
    this.points.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.points.push([x, y]);
  }
  closePath(): void {}
  arc(x: number, y: number): void {
    this.subpaths++;
    this.points.push([x, y]);
  }
  fill(rule = 'nonzero'): void {
    this.fills.push({
      rule,
      subpaths: this.subpaths,
      style: String(this.fillStyle),
      points: this.points.slice(),
    });
  }
  stroke(): void {
    this.strokes.push({
      style: String(this.strokeStyle),
      width: this.lineWidth,
      points: this.points.slice(),
      op: this.globalCompositeOperation,
    });
  }
  fillRect(): void {}
  clearRect(): void {}
  setTransform(): void {}
  save(): void {}
  restore(): void {}
  drawImage(): void {}
  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y });
  }
  createRadialGradient() {
    return { addColorStop(): void {} };
  }
}

function makeCanvas() {
  const ctx = new MockContext();
  return {
    width: 0,
    height: 0,
    clientWidth: 1280,
    clientHeight: 860,
    style: {} as Record<string, string>,
    getContext: () => ctx,
    ctx,
  };
}

const globals = globalThis as unknown as Record<string, unknown>;
/** Canvases the renderer makes for itself — the first one is the beam layer. */
const created: Array<ReturnType<typeof makeCanvas>> = [];
globals.document = {
  createElement: () => {
    const c = makeCanvas();
    created.push(c);
    return c;
  },
};
globals.window = { devicePixelRatio: 1 };

const { Renderer } = await import('../src/render/renderer');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const trail = new Float32Array(16_384 * TRAIL_STRIDE);
const canvas = makeCanvas();
const renderer = new Renderer(canvas as unknown as HTMLCanvasElement);
const ctx = canvas.ctx;

/**
 * Fills the injector and ramps it to flat top.
 *
 * The injector accelerates now: the chain delivers at 26 GeV and the collider only captures
 * 450, so "fill and extract" is "fill, ramp, extract" and everything below that wants a
 * batch delivered has to say so.
 */
function loadInjector(w: World, frames = 600): void {
  w.fillInjector();
  w.injector.setTargetEnergy(w.injector.ring.config.topEnergyGeV);
  for (let i = 0; i < frames && w.injector.rampFraction < 0.999; i++) w.advance(1 / 60);
}

/** Puts one batch straight into the collider, going `bore`. */
function fillCollider(w: World, bore = 1): void {
  const inj = w.collider.ring.injection;
  w.beam.inject({
    x: inj.x,
    y: inj.y,
    dx: inj.dx * bore,
    dy: inj.dy * bore,
    gamma: w.collider.gamma,
    protons: 2.69e13,
    ring: 0,
  });
  w.attachBackend(new CpuBackend());
}

function drawFrame(w: World, dt = 1 / 60): void {
  renderer.render(w, trail, w.backend!.drainTrail(trail), dt);
}

const world = new World();
const machine = world.collider;
const injector = world.injector;
world.attachBackend(new CpuBackend());
world.fillInjector();
fillCollider(world);
renderer.resize(world);

// a few frames so there is a trail to draw
for (let i = 0; i < 20; i++) world.advance(1 / 60);
drawFrame(world);

console.log('--- band fills ---');
const evenOdd = ctx.fills.filter((f) => f.rule === 'evenodd');
check('each ring is drawn as two band fills', evenOdd.length === 4, `${evenOdd.length} found for 2 rings`);
check(
  'every even-odd fill has two subpaths (a band, not a disc)',
  evenOdd.every((f) => f.subpaths === 2),
  evenOdd.map((f) => f.subpaths).join(', '),
);

console.log('--- magnets ---');
// MAGNET_CASING is rgb(92, 108, 132); every dipole block strokes it once
const casing = ctx.strokes.filter((s) => s.style.includes('92, 108, 132'));
const blocks = (LHC_CONFIG.cells + SPS_CONFIG.cells) * 22;
check(
  'every dipole block of both rings is stroked with its casing',
  casing.length >= blocks,
  `${casing.length} strokes for ${blocks} blocks`,
);
check(
  'magnet bodies are wide enough to see',
  casing.every((s) => s.width >= 3),
  `thinnest ${Math.min(...casing.map((s) => s.width)).toFixed(1)} px`,
);

console.log('--- the complex fits on screen ---');
const borePx = LHC_CONFIG.apertureRadius * renderer.camera.scale;
check(
  'the collider aperture is still tall enough to watch the beam cross it',
  borePx > 12,
  `half-aperture is ${borePx.toFixed(1)} px`,
);
const injBorePx = SPS_CONFIG.apertureRadius * renderer.camera.scale;
check(
  'the injector pipe is drawn thinner than the collider one',
  injBorePx < borePx && injBorePx > 2,
  `${injBorePx.toFixed(1)} px`,
);
for (const [name, ring] of [['collider', machine.ring], ['injector', injector.ring]] as const) {
  const b = ring.bounds;
  const inside =
    renderer.camera.x(b.minX) > -1 &&
    renderer.camera.x(b.maxX) < 1281 &&
    renderer.camera.y(b.maxY) > -1 &&
    renderer.camera.y(b.minY) < 861;
  check(`the ${name} ring is inside the canvas`, inside);
}

// **The overlay must not be drawn on top of the machine.** The panels are HTML over a canvas,
// so nothing in either file relates the camera's margin to a column width — and it went wrong
// exactly that way: the experiments' column was put where the collider's right-hand arc
// already was. Both numbers live in `ui/layout.ts` now and this is what checks them.
{
  const wall = LHC_CONFIG.apertureRadius * (1 + 0.18);
  const colliderRight = renderer.camera.x(machine.ring.bounds.maxX + wall);
  const panelLeft = eventPanelLeft(1280);
  check(
    'the experiments stand clear of the collider they are drawn beside',
    colliderRight < panelLeft,
    `collider tunnel ends at ${colliderRight.toFixed(0)} px, the panels start at ${panelLeft}`,
  );
  // And the injector is the thing they sit above and below rather than on: its own band of
  // screen is what the readouts in the middle of the rail are level with.
  const sps = injector.ring.bounds;
  check(
    'and the injector is left of them, or beside the readouts between them',
    renderer.camera.x(sps.minX) > colliderRight,
    `injector spans ${renderer.camera.x(sps.minX).toFixed(0)}..${renderer.camera.x(sps.maxX).toFixed(0)} px,` +
      ` y ${renderer.camera.y(sps.maxY).toFixed(0)}..${renderer.camera.y(sps.minY).toFixed(0)}`,
  );
}

console.log('--- the experimental insertions ---');
{
  // Every layer is a four-corner quad; the muon shell's fill colour is unique in the picture.
  const outer = ctx.fills.filter((f) => f.style.includes('40, 48, 70') && f.points.length === 4);
  check('both insertions are drawn', outer.length === world.detectors.length, `${outer.length} bodies`);
  const size = (f: (typeof outer)[number]): number => {
    const xs = f.points.map((p) => p[0]);
    const ys = f.points.map((p) => p[1]);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  };
  check(
    'and are big enough to read as objects',
    outer.every((f) => size(f) > 24),
    `smallest ${Math.min(...outer.map(size)).toFixed(0)} px across`,
  );
  // ATLAS is 46 m long. Drawn at that it would be six pixels, which is why this is
  // magnified — but it must not swallow the straight it sits in either.
  const straightPx = machine.ring.straights[0].length * renderer.camera.scale;
  check(
    'and no longer than the straight they sit in',
    outer.every((f) => size(f) < straightPx),
    `${Math.max(...outer.map(size)).toFixed(0)} px against a ${straightPx.toFixed(0)} px straight`,
  );
  const tracker = ctx.fills.filter((f) => f.style.includes('12, 18, 28') && f.points.length === 4);
  check(
    'each has a tracking volume inside it',
    tracker.length === world.detectors.length,
    `${tracker.length} found`,
  );
  check(
    'and the tracker is the transparent radius the event builder uses',
    Math.abs(size(tracker[0]) / size(outer[0]) - TRACKER_RADIUS) < 0.02,
    `drawn ${(size(tracker[0]) / size(outer[0])).toFixed(3)} vs ${TRACKER_RADIUS} in shower.ts`,
  );
  for (const det of world.detectors) {
    check(`${det.config.name} is labelled`, ctx.texts.some((t) => t.text === det.config.name));
  }
}

console.log('--- lines out of the machines ---');
const labels = ctx.texts.map((t) => t.text);
// Matched on the centre of each drift, not on a point near its end. TI 8 leaves the sextant
// next to TI 2's and runs 430 m past its kicker on the way out, so "a quad with a corner
// within 40 px of where TI 2 starts" counts both lines' pipes and reported four quads for a
// line that has one drift. A quad's centroid belongs to exactly one drift.
for (const e of world.extractions) {
  const line = e.line;
  let found = 0;
  for (const seg of line.straights) {
    const mx = renderer.camera.x((seg.x1 + seg.x2) / 2);
    const my = renderer.camera.y((seg.y1 + seg.y2) / 2);
    found += ctx.fills.filter((f) => {
      if (f.rule !== 'nonzero' || f.points.length !== 4) return false;
      const cx = f.points.reduce((n, p) => n + p[0], 0) / 4;
      const cy = f.points.reduce((n, p) => n + p[1], 0) / 4;
      return Math.hypot(cx - mx, cy - my) < 4;
    }).length;
  }
  check(
    `${line.config.name} is drawn as a wall and a bore along every drift`,
    found === line.straights.length * 2,
    `${found} quads for ${line.straights.length} drift(s)`,
  );
  check(`${line.config.name} is labelled`, labels.includes(line.config.name));
}
// The layout of the two transfer lines, which is only ever judged by eye.
{
  const ti2 = world.extractions[0].line;
  const ti8 = world.extractions[1].line;
  const cells = injector.ring.straights.length;
  // Cell index runs clockwise on screen: the injector's sense is −1 and the camera does not
  // mirror the picture. So the sextant the beam reaches just before TI 2's is one step
  // clockwise from the far-side sextant TI 8 used to leave from.
  check(
    "TI 8 leaves the sextant just upstream of TI 2's",
    ti8.config.kickerCell === (ti2.config.kickerCell + cells - 1) % cells,
    `TI 2 out of cell ${ti2.config.kickerCell}, TI 8 out of cell ${ti8.config.kickerCell}`,
  );
  const ringTurn = Math.sign(injector.ring.arcs[0].dPhi);
  check(
    "TI 8's bend curves against the injector's own turn",
    ti8.arcs.length === 1 && Math.sign(ti8.arcs[0].dPhi) === -ringTurn,
    `${ti8.arcs.length} bend(s), ${((((ti8.arcs[0]?.dPhi ?? 0) * 180) / Math.PI)).toFixed(1)} deg` +
      ` against a ring turning ${ringTurn > 0 ? 'anticlockwise' : 'clockwise'}`,
  );
  const steel = ti8.arcs.reduce((n, a) => n + a.length, 0);
  check(
    'and that keeps it short — it replaced 10.42 km with 1092 m of dipole',
    ti8.length < 6000 && steel < 600,
    `${(ti8.length / 1000).toFixed(2)} km with ${steel.toFixed(0)} m of dipole`,
  );
  let gap = Infinity;
  for (const [ax, ay] of sampleLine(ti2, 20)) {
    for (const [bx, by] of sampleLine(ti8, 20)) {
      gap = Math.min(gap, Math.hypot(ax - bx, ay - by));
    }
  }
  check(
    'the two lines never run inside one another',
    gap > ti2.config.apertureRadius + ti8.config.apertureRadius,
    `${gap.toFixed(0)} m apart at closest, pipes are ${ti2.config.apertureRadius} m`,
  );
}

check(
  'TI 2 lands exactly on the collider injection point',
  Math.hypot(
    world.extractions[0].line.exit.x - machine.ring.injection.x,
    world.extractions[0].line.exit.y - machine.ring.injection.y,
  ) < 1e-6,
);
check('there are two dump lines', world.extractions.filter((e) => e.line.isDump).length === 2);
check('their absorbers are labelled', labels.filter((t) => t === 'TDE').length === 2);
for (const want of [world.chain.name, 'LHC', 'SPS']) {
  check(`"${want}" is labelled`, labels.includes(want));
}

// The chain ahead of the injector: one long tube on the injection straight, not two dots.
// It used to be a PS circle and a PSB circle at their real sizes — 100 m and 25 m on a
// picture eleven kilometres across, which is under two pixels each.
{
  const chain = world.chain;
  const ax = renderer.camera.x(chain.x1);
  const ay = renderer.camera.y(chain.y1);
  const bx = renderer.camera.x(chain.x2);
  const by = renderer.camera.y(chain.y2);
  const px = Math.hypot(bx - ax, by - ay);
  check(
    'the injector chain is one long tube, not a row of dots',
    px > 40,
    `${px.toFixed(0)} px for ${chain.length.toFixed(0)} m`,
  );
  // Collinear with the injection straight, so the protons fly into the ring without a kink.
  const inj = injector.ring.injection;
  const ux = (chain.x2 - chain.x1) / chain.length;
  const uy = (chain.y2 - chain.y1) / chain.length;
  check(
    'and runs along the injection straight',
    Math.abs(ux * inj.dx + uy * inj.dy - 1) < 1e-9,
    `dot product ${(ux * inj.dx + uy * inj.dy).toFixed(6)}`,
  );
  // South-east on screen is right and down: +x in pixels, +y in pixels.
  check(
    'firing south-east on screen',
    bx > ax && by > ay,
    `${(bx - ax).toFixed(0)} px right, ${(by - ay).toFixed(0)} px down`,
  );
  check('it ends on the injection point', Math.hypot(chain.x2 - inj.x, chain.y2 - inj.y) < 1e-9);
  check('and costs the picture nothing', renderer.camera.x(chain.x1) < 1281 && renderer.camera.y(chain.y1) < 861);
}

console.log('--- hit testing ---');
for (const [name, m] of [['collider', machine], ['injector', injector]] as const) {
  const arc = m.ring.arcs[0];
  const phi = arc.phiStart + arc.dPhi / 2;
  const aperture = m.ring.config.apertureRadius;

  /** Picks at a point `inward` metres inside the design orbit, at the middle of arc 0. */
  const pickAtOffset = (inward: number): number => {
    const r = arc.radius - inward;
    const wx = arc.cx + r * Math.cos(phi);
    const wy = arc.cy + r * Math.sin(phi);
    return renderer.pickMagnet(m, renderer.camera.x(wx), renderer.camera.y(wy));
  };

  const hits: number[] = [];
  for (let inward = -2 * aperture; inward <= 8 * aperture; inward += aperture / 50) {
    if (pickAtOffset(inward) === arc.index) hits.push(inward);
  }
  const first = hits[0];
  const last = hits[hits.length - 1];

  check(`${name}: clicking the beam pipe picks nothing`, pickAtOffset(0) === -1);
  check(`${name}: there is a clickable magnet band`, hits.length > 0, `${first?.toFixed(0)} m … ${last?.toFixed(0)} m inward`);
  check(`${name}: the band clears the tunnel wall`, first > aperture * 1.18, `wall at ${(aperture * 1.18).toFixed(0)} m`);
  check(
    `${name}: the band is a comfortable click target`,
    (last - first) * renderer.camera.scale > 16,
    `${((last - first) * renderer.camera.scale).toFixed(0)} px tall`,
  );
  check(`${name}: clicking outside the ring picks nothing`, pickAtOffset(-1.2 * aperture) === -1);
}

console.log('--- the button does not restart the beam ---');
{
  const w = new World();
  w.attachBackend(new CpuBackend());
  w.fillInjector();

  check('the collider starts empty', w.bunchesIn(0) === 0);
  check('the injector has a batch', w.bunchesIn(1) === 1);

  // The injector has to be taken to flat top first: it accelerates now, and a 26 GeV batch
  // is not something the collider can capture.
  w.injector.setTargetEnergy(w.injector.ring.config.topEnergyGeV);
  for (let i = 0; i < 600 && w.injector.rampFraction < 0.999; i++) w.advance(1 / 60);
  check('the injector ramps to flat top', w.injector.rampFraction >= 0.999,
    `${w.injector.energyGeV.toFixed(0)} GeV`);

  w.armKicker(w.lineIndex('ti2'));
  check('arming does not fill the ring', w.bunchesIn(0) === 0);

  let fired = false;
  for (let i = 0; i < 3000 && w.bunchesInBeam(0, 1) === 0; i++) {
    w.advance(1 / 60);
    fired ||= w.extractions[w.lineIndex('ti2')].state === 'firing';
  }
  check('the kickers fire', fired);
  check('a batch arrives, going clockwise', w.bunchesInBeam(0, 1) === 1);

  // the second beam is the same thing pointing the other way
  loadInjector(w);
  w.armKicker(w.lineIndex('ti8'));
  for (let i = 0; i < 4000 && w.bunchesInBeam(0, -1) === 0; i++) w.advance(1 / 60);
  check('TI 8 delivers a counter-rotating batch', w.bunchesInBeam(0, -1) === 1);
  check('...without disturbing beam 1', w.bunchesInBeam(0, 1) === 1);

  // several beams at once, which is the whole point of one particle array
  for (let k = 0; k < 3; k++) {
    loadInjector(w);
    w.armKicker(w.lineIndex('ti2'));
    for (let i = 0; i < 3000 && w.extractions[w.lineIndex('ti2')].state !== 'idle'; i++) {
      w.advance(1 / 60);
    }
  }
  for (let i = 0; i < 300; i++) w.advance(1 / 60);
  check(
    'batches stack rather than replacing each other',
    w.bunchesInBeam(0, 1) >= 3,
    `${w.bunchesInBeam(0, 1)} in beam 1, ${w.bunchesInBeam(0, -1)} in beam 2`,
  );

  const before = ctx.strokes.length;
  drawFrame(w);
  check('a frame with several beams in it still draws', ctx.strokes.length > before);

  console.log('--- dump ---');
  const b2 = w.bunchesInBeam(0, -1);
  // A kicker fires once, for one bunch. Emptying the ring takes one pulse per batch —
  // which is what "the next ones are closed to it" means.
  const b1 = w.bunchesInBeam(0, 1);
  for (let batch = 0; batch < b1; batch++) {
    w.armKicker(w.lineIndex('td1'));
    for (let i = 0; i < 3000 && w.extractions[w.lineIndex('td1')].state !== 'idle'; i++) {
      w.advance(1 / 60);
    }
    for (let i = 0; i < 400; i++) w.advance(1 / 60);
  }
  check('one pulse takes one batch', w.bunchesInBeam(0, 1) === 0, `${b1} batches, ${b1} pulses`);
  check('and leaves beam 2 alone', w.bunchesInBeam(0, -1) === b2, `beam 2 still ${w.bunchesInBeam(0, -1)}`);
  check('the beam ended in the absorber', w.damage.some((d) => d.onPurpose));

  // The beam 2 dump, which for a long time nothing here ran. Its kicker field was written
  // into the aperture the *other* beam is in, so it bent the batch inward and put it in the
  // inside wall of the ring — "the dump works backwards". Assert where the batch stops, not
  // just that it left: dead centre of the block is the difference between the two.
  for (let batch = w.bunchesInBeam(0, -1); batch > 0; batch--) {
    w.armKicker(w.lineIndex('td2'));
    for (let i = 0; i < 3000 && w.extractions[w.lineIndex('td2')].state !== 'idle'; i++) {
      w.advance(1 / 60);
    }
    for (let i = 0; i < 400; i++) w.advance(1 / 60);
  }
  check('the beam 2 dump empties beam 2 too', w.bunchesInBeam(0, -1) === 0);
  {
    const exit = w.extractions[w.lineIndex('td2')].line.exit;
    const hit = w.damage[w.damage.length - 1];
    const rx = hit.px - exit.x;
    const ry = hit.py - exit.y;
    const into = rx * exit.dx + ry * exit.dy;
    const off = Math.abs(-rx * exit.dy + ry * exit.dx);
    check(
      'and stops it inside the absorber, on the block axis',
      hit.onPurpose && into > 0 && off < SPS_CONFIG.apertureRadius,
      `${into.toFixed(0)} m into the block, ${off.toFixed(1)} m off its axis`,
    );
  }

  console.log('--- kicker and septum ---');
  {
    // The ring dipole is NOT switched off to extract. It was, once, and the renderer went
    // on drawing it dark long after the physics had stopped doing it — which is a lie
    // about how the machine works, and exactly the kind of lie only the eye catches.
    const kw = new World();
    kw.attachBackend(new CpuBackend());
    loadInjector(kw);
    kw.armKicker(kw.lineIndex('ti2'));
    const ext = kw.extractions[kw.lineIndex('ti2')];
    let drewWhileFiring = false;
    let litKicker = 0;
    let dipoleDark = 0;
    for (let i = 0; i < 2000 && !drewWhileFiring; i++) {
      kw.advance(1 / 60);
      if (ext.state !== 'firing') continue;
      ctx.strokes.length = 0;
      drawFrame(kw);
      drewWhileFiring = true;
      // the kicker's own violet body
      litKicker = ctx.strokes.filter((st) => st.style.includes('255, 170, 255')).length;
      // 'rgba(22, 26, 34' is the dead cold-mass colour a switched-off dipole is drawn in
      dipoleDark = ctx.strokes.filter((st) => st.style.includes('22, 26, 34')).length;
    }
    check('a frame was drawn while the kicker was firing', drewWhileFiring);
    check('the kicker is drawn lit', litKicker > 0, `${litKicker} strokes`);
    check('no ring dipole is drawn switched off during extraction', dipoleDark === 0, `${dipoleDark} dead blocks`);
    // The septa are deliberately invisible — four DC bands alongside the ring that never do
    // anything the eye is here for, crowding the one device that does. The *field* has to
    // stay, so this asserts both halves: nothing teal is drawn, and every extraction still
    // has a septum sector in the field table cancelling the ring's bend.
    const septumStrokes = ctx.strokes.filter((st) => st.style.includes('120, 200, 190')).length;
    check('the septum is not drawn', septumStrokes === 0, `${septumStrokes} teal strokes`);

    // The kicker is the only extraction hardware left in the picture, so it has to be big
    // enough to see and it has to be *where the beam leaves*. At 22 m it was two pixels at
    // the near end of the straight while the departure happened a hundred pixels downstream
    // — a device that flashed and visibly did nothing, followed by a beam that carried on
    // straight for no reason the eye could attach to anything.
    //
    // "Where the beam leaves" is the start of the line's own pipe, and that is the invariant
    // worth asserting rather than "near the arc": the two are the same thing only when the
    // kicker fills its straight, and the dump kickers deliberately do not — they share one
    // straight and have to sit end to end in it.
    const spans = new Map<string, Array<{ name: string; lo: number; hi: number }>>();
    for (const x of kw.extractions) {
      const arc = x.kickerArc!;
      const from = kw.machines[x.line.config.fromMachine].ring;
      const straight = from.straights[x.line.config.kickerCell];
      const px = renderer.camera.len(arc.length);
      check(
        `${x.line.config.name}'s kicker is long enough to see`,
        px > 20,
        `${px.toFixed(0)} px`,
      );

      const endPhi = arc.phiStart + arc.dPhi;
      const ex = arc.cx + arc.radius * Math.cos(endPhi);
      const ey = arc.cy + arc.radius * Math.sin(endPhi);
      const gap = Math.hypot(ex - x.line.entry.x, ey - x.line.entry.y);
      check(
        `${x.line.config.name}'s kicker ends where its line begins`,
        gap < 1,
        `${gap.toFixed(2)} m apart`,
      );

      // where it sits along its straight, so two in one straight can be compared
      const along = (px2: number, py: number): number =>
        (px2 - straight.x1) * straight.dx + (py - straight.y1) * straight.dy;
      const a0 = along(arc.cx + arc.radius * Math.cos(arc.phiStart), arc.cy + arc.radius * Math.sin(arc.phiStart));
      const a1 = along(ex, ey);
      const key = `${x.line.config.fromMachine}:${x.line.config.kickerCell}`;
      if (!spans.has(key)) spans.set(key, []);
      spans.get(key)!.push({ name: x.line.config.name, lo: Math.min(a0, a1), hi: Math.max(a0, a1) });
    }
    // Two devices cannot occupy the same metres of tunnel. Every extraction has a straight of
    // its own now, so this has nothing left to find — which is the point of keeping it.
    for (const [, list] of spans) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const overlap = Math.min(list[i].hi, list[j].hi) - Math.max(list[i].lo, list[j].lo);
          check(
            `${list[i].name} and ${list[j].name} do not overlap in their straight`,
            overlap < 0,
            `${overlap > 0 ? `${overlap.toFixed(0)} m of overlap` : `${(-overlap).toFixed(0)} m apart`}`,
          );
        }
      }
    }
    // **And no two lines run inside one another anywhere**, which is the check that was
    // missing. Only TI 2 and TI 8 were ever compared, so nothing noticed that the two dump
    // lines crossed: beam 1 left its straight upstream of beam 2 and then ran downstream
    // while beam 2 ran upstream, and their pipes passed through each other 26 m apart.
    // Within one straight there is no kicker length that avoids it — see `DUMP_CELL_BEAM2` —
    // so each beam dumps out of its own insertion.
    {
      const lines = kw.extractions.map((x) => x.line);
      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          let gap = Infinity;
          for (const [ax, ay] of sampleLine(lines[i], 80)) {
            for (const [bx, by] of sampleLine(lines[j], 80)) {
              gap = Math.min(gap, Math.hypot(ax - bx, ay - by));
            }
          }
          const clear = lines[i].config.apertureRadius + lines[j].config.apertureRadius;
          check(
            `${lines[i].config.name} and ${lines[j].config.name} never run inside one another`,
            gap > clear,
            `${gap.toFixed(0)} m apart at closest, pipes need ${clear.toFixed(0)}`,
          );
        }
      }
    }
    check(
      'but every extraction still has one powered in the field table',
      kw.extractions.every((x) => x.kickerArc !== null && x.septum >= 0),
    );
  }

  console.log('--- quench ---');
  const c = w.collider.circuits[2];
  // a full fill's worth of joules; at injection current the margin is 6.6 K, and this is
  // 24 K of it, so it goes normal — one batch at injection would not
  c.deposit(3.5e8);
  check('a beam-sized deposit quenches a superconducting circuit', c.state === 'quenching');
  const beforeQ = ctx.texts.length;
  drawFrame(w);
  check('the quench is labelled on the ring', ctx.texts.slice(beforeQ).some((t) => t.text.includes('QUENCH')));
  for (let i = 0; i < 400; i++) w.advance(1 / 60);
  check(
    'it settles as quenched with the current dumping',
    c.state === 'quenched' && c.current < c.config.nominalCurrent,
    `${c.current.toFixed(0)} A, coil at ${c.temperature.toFixed(0)} K`,
  );
  w.collider.toggleCircuit(2);
  check('clicking it starts the cool-down', c.state === 'recovering');
}

console.log('--- a switched-off arc ---');
{
  const w = new World();
  w.attachBackend(new CpuBackend());
  fillCollider(w);
  w.collider.toggleCircuit(1);
  let guard = 0;
  let peak = 0;
  let frames = 0;
  while (w.beam.alive[0] === 1 && guard++ < 2000) {
    w.advance(1 / 60);
    if (w.beam.alive[0]) peak = Math.max(peak, Math.abs(w.offsetOf(0).metres));
    frames++;
  }
  const aperture = LHC_CONFIG.apertureRadius;
  check('switching a magnet off loses the beam', w.beam.alive[0] === 0);
  check(
    'the beam crosses most of the aperture before it hits',
    peak / aperture > 0.5,
    `reached ${((peak / aperture) * 100).toFixed(0)} % of the aperture`,
  );
  check('it takes long enough to see', frames > 10, `${frames} frames (${(frames / 60).toFixed(2)} s at 60 fps)`);
  check('the hit left damage on the wall', w.damage.length > 0);

  const before = ctx.fills.length + ctx.strokes.length;
  drawFrame(w);
  check('the damaged wall still renders', ctx.fills.length + ctx.strokes.length > before);

  // An impact is a cascade, not a blow. It used to be drawn as 26 straight rays out of one
  // point, which is a starburst — no branching, no species, nothing that develops. What has
  // to be true of the drawing: several species are stroked, in their own colours, and the
  // lines form a *tree* rather than a fan, which shows up as most segments not starting at
  // the impact point.
  const site = w.damage[w.damage.length - 1];
  check('the impact built a cascade', site.shower.count > 40, `${site.shower.count} segments`);
  const kinds = new Set<number>();
  for (let i = 0; i < site.shower.count; i++) kinds.add(site.shower.data[i * SEGMENT_STRIDE + 4] | 0);
  check('of more than one kind of particle', kinds.size >= 3, `${kinds.size} species`);

  ctx.strokes.length = 0;
  drawFrame(w);
  // one stroke per species, each carrying every segment of that species in the whole frame
  const showerColours = ['255, 196, 104', '150, 214, 255', '196, 168, 255', '255, 120, 200'];
  const showerStrokes = ctx.strokes.filter((st) => showerColours.some((c) => st.style.includes(c)));
  check(
    'and the shower is drawn, batched by species',
    showerStrokes.length >= 3 && showerStrokes.length <= 4,
    `${showerStrokes.length} strokes for ${showerStrokes.reduce((n, st) => n + st.points.length / 2, 0)} segments`,
  );
  // A fan has every line starting at the impact; a cascade branches off itself. This also
  // catches the cascade being drawn too small to read: at the channel's own magnification it
  // was three pixels long and every endpoint rounded onto its neighbours — 40 distinct
  // points out of 384, a bright smudge.
  const origins = new Set(showerStrokes.flatMap((st) => st.points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)));
  check(
    'and it branches rather than radiating from one point',
    origins.size > 70,
    `${origins.size} distinct endpoints`,
  );
  let spanX = 0;
  let spanY = 0;
  for (const st of showerStrokes) {
    const xs = st.points.map((p) => p[0]);
    const ys = st.points.map((p) => p[1]);
    spanX = Math.max(spanX, Math.max(...xs) - Math.min(...xs));
    spanY = Math.max(spanY, Math.max(...ys) - Math.min(...ys));
  }
  check(
    'and it is big enough to see it develop',
    Math.max(spanX, spanY) > 10,
    `${Math.max(spanX, spanY).toFixed(0)} px across`,
  );
}

console.log('--- collisions ---');

/**
 * Two batches put on the collider by hand, one each way, at chosen distances from IP3 — so
 * the crossing point can be placed exactly where a test wants it instead of being cogged
 * there. Their mean is the crossing; their difference is how far through each other they are.
 */
function twoBatches(forwardOffset: number, reverseOffset: number): World {
  const w = new World();
  w.attachBackend(new CpuBackend());
  const ip = w.detectors[0].s;
  for (const [s, bore] of [
    [ip + forwardOffset, 1],
    [ip + reverseOffset, -1],
  ] as const) {
    const p = poseAtArclength(w.collider.ring, s);
    w.beam.inject({
      x: p.x, y: p.y, dx: p.dx * bore, dy: p.dy * bore,
      gamma: w.collider.gamma, protons: 2.69e13, ring: 0,
    });
  }
  w.attachBackend(new CpuBackend());
  for (let i = 0; i < w.beam.count; i++) w.beam.ring[i] = 0;
  return w;
}

/** The teal interaction-region strokes of the last frame, split by whether anybody collects them. */
function bandStrokes(): { collected: Point[][]; passing: Point[][] } {
  return {
    collected: ctx.strokes.filter((s) => s.style.includes('170, 255, 225')).map((s) => s.points),
    passing: ctx.strokes.filter((s) => s.style.includes('90, 190, 165')).map((s) => s.points),
  };
}

{
  // Two batches placed head-on at IP3, which is the only state in which any of this draws.
  const w = twoBatches(0, 0);

  let events = 0;
  const species = new Set<string>();
  let vertexNear = Infinity;
  let regionSpan = 0;
  let inside = 0;
  let outside = 0;
  for (let i = 0; i < 90 && events === 0; i++) {
    w.advance(1 / 60);
    ctx.strokes.length = 0;
    ctx.fills.length = 0;
    ctx.texts.length = 0;
    drawFrame(w);
    events = w.collisions.length;
    if (events > 0) {
      // The event's tracks are the only 'lighter' strokes carrying these colours.
      for (const s of ctx.strokes) {
        for (const key of ['255, 208, 130', '160, 220, 255', '200, 175, 255', '255, 130, 205']) {
          if (s.style.includes(key)) species.add(key);
        }
      }
      // Radiating from **the event's own vertex**, not from the middle of the box — those
      // are the same point only when the machine is phased, which is what the next block is
      // about.
      const ev = w.collisions[w.collisions.length - 1];
      const vx = renderer.camera.x(ev.x);
      const vy = renderer.camera.y(ev.y);
      for (const s of ctx.strokes) {
        for (const p of s.points) vertexNear = Math.min(vertexNear, Math.hypot(p[0] - vx, p[1] - vy));
      }
    }
    // the interaction region band: the only teal thing drawn, in two shades
    const { collected, passing } = bandStrokes();
    const band = [...collected, ...passing];
    if (band.length > 0) {
      const xs = band.flatMap((pts) => pts.map((p) => p[0]));
      const ys = band.flatMap((pts) => pts.map((p) => p[1]));
      regionSpan = Math.max(
        regionSpan,
        Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
      );
      inside = Math.max(inside, collected.length);
      outside = Math.max(outside, passing.length);
    }
  }

  check('two phased batches produce collisions', events > 0, `${events} events drawn`);
  check(
    'a collision is drawn as more than one kind of particle',
    species.size >= 3,
    `${species.size} species`,
  );
  check('and radiates from its own vertex', vertexNear < 4, `nearest track ${vertexNear.toFixed(1)} px`);
  // The band is what cogging is aimed with. A batch is 1754 m; at this scale that is
  // about 130 px of ring, and if it is not drawn there is no feedback at all.
  check(
    'the interaction region is drawn on the ring',
    regionSpan > 40,
    `${regionSpan.toFixed(0)} px of orbit`,
  );
  // A meeting out in an arc is nothing — separate bores — so the band has to say which part
  // of itself anybody is collecting.
  check(
    'and distinguishes the part inside a detector from the rest',
    inside > 0 && outside > 0,
    `${inside} segments collected, ${outside} passing through`,
  );
  check(
    'luminosity is real while it happens',
    w.detectors[0].luminosity > 1e32,
    `${w.detectors[0].luminosity.toExponential(2)} cm^-2 s^-1 at ${w.detectors[0].bunchPairs.toFixed(0)} bunch pairs`,
  );

  // Both crossing points, not one. A crossing point is defined modulo half a ring, so there
  // are two of them and they are antipodal — and an experiment reaches its own half a turn
  // after the other reaches theirs. Drawing one tick had the far experiment flashing with
  // nothing marked anywhere near it.
  const ticks = ctx.strokes.filter((s) => s.style.includes('150, 225, 210'));
  let apart = 0;
  if (ticks.length === 2) {
    const mid = (i: number): Point => [
      (ticks[i].points[0][0] + ticks[i].points[1][0]) / 2,
      (ticks[i].points[0][1] + ticks[i].points[1][1]) / 2,
    ];
    const [ax, ay] = mid(0);
    const [bx, by] = mid(1);
    apart = Math.hypot(ax - bx, ay - by);
  }
  check(
    'the crossing is marked at both antipodal points',
    ticks.length === 2 && apart > 300,
    `${ticks.length} ticks, ${apart.toFixed(0)} px apart`,
  );
}

// Where an event is drawn when the machine is *not* phased onto the interaction point. The
// vertex has to follow the beams: the crossing is 500 m up the ring here, so the bunches meet
// in the far end of the insertion and nowhere near its middle. Drawn at the middle it would
// be a flash sitting where the picture is simultaneously showing there is no beam.
{
  const w2 = twoBatches(900, 100);
  const offsets: number[] = [];
  let seen = 0;
  let beamUnderFlash = Infinity;
  let outsideBox = 0;
  for (let i = 0; i < 1000 && offsets.length < 6; i++) {
    w2.advance(1 / 60);
    if (w2.collisions.length <= seen) {
      seen = w2.collisions.length;
      continue;
    }
    seen = w2.collisions.length;
    ctx.strokes.length = 0;
    ctx.fills.length = 0;
    ctx.texts.length = 0;
    drawFrame(w2);
    const ev = w2.collisions[w2.collisions.length - 1];
    offsets.push(ev.offset);
    if (Math.abs(ev.offset) > w2.detectors[ev.detector].halfLength) outsideBox++;
    // and there is beam drawn under it: the bright part of the interaction region has to
    // reach the point the flash is at, or the experiment is lighting up over nothing
    const vx = renderer.camera.x(ev.x);
    const vy = renderer.camera.y(ev.y);
    for (const pts of bandStrokes().collected) {
      for (const p of pts) beamUnderFlash = Math.min(beamUnderFlash, Math.hypot(p[0] - vx, p[1] - vy));
    }
  }
  const mean = offsets.reduce((a, b) => a + b, 0) / Math.max(1, offsets.length);
  const spread = offsets.length > 0 ? Math.max(...offsets) - Math.min(...offsets) : 0;
  check(
    'a mis-phased experiment sees its collisions off the interaction point',
    offsets.length > 0 && mean > 80,
    `${offsets.length} events at ${offsets.map((o) => o.toFixed(0)).join(', ')} m, mean ${mean.toFixed(0)} m`,
  );
  // and they scatter, because the bunches of two 1754 m batches meet all along the part of
  // the insertion the batches cover — not at one repeated point in it
  check(
    'and scattered across the stretch its bunches meet in',
    spread > 200,
    `${spread.toFixed(0)} m between the nearest and the furthest`,
  );
  check(
    'and never outside the detector it is drawn in',
    offsets.length > 0 && outsideBox === 0,
    `${outsideBox} of ${offsets.length} outside a ${w2.detectors[0].halfLength.toFixed(0)} m half-length`,
  );
  check(
    'with the interaction region drawn under the flash',
    beamUnderFlash < 40,
    `nearest collected band segment ${beamUnderFlash.toFixed(1)} px`,
  );
}

// **No vertex glow.** A green radial gradient most of an aperture across used to be painted
// over the interaction point on every event, and it buried the tracks — which are the only
// thing that says where the vertex is. A gradient fill records in the mock as an object, so
// this asserts nothing of the kind is painted anywhere near a vertex.
{
  const w = twoBatches(0, 0);
  let events = 0;
  let blobs = 0;
  for (let i = 0; i < 200 && events === 0; i++) {
    w.advance(1 / 60);
    ctx.fills.length = 0;
    drawFrame(w);
    events = w.collisions.length;
    if (events === 0) continue;
    // The beam heads are gradients too, and a colliding batch is *at* the interaction point
    // by definition — so they have to be excluded by name rather than by distance, or this
    // asserts that the beam may not be drawn where the beam is.
    const heads: Point[] = [];
    for (let k = 0; k < w.beam.count; k++) {
      if (w.beam.alive[k]) heads.push([renderer.camera.x(w.beam.x[k]), renderer.camera.y(w.beam.y[k])]);
    }
    for (const ev of w.collisions) {
      const vx = renderer.camera.x(ev.x);
      const vy = renderer.camera.y(ev.y);
      blobs += ctx.fills.filter(
        (f) =>
          f.style === '[object Object]' &&
          f.points.some((p) => Math.hypot(p[0] - vx, p[1] - vy) < 30) &&
          !f.points.some((p) => heads.some((h) => Math.hypot(p[0] - h[0], p[1] - h[1]) < 1)),
      ).length;
    }
  }
  check('a collision was drawn', events > 0, `${events} events`);
  check('and nothing is painted over its vertex', blobs === 0, `${blobs} gradient fills on the vertex`);
}

// The beam thins as the collisions eat it. Nothing but the eye catches a burn-off that is
// computed, reported and then drawn at full brightness for ever — which is what this did.
console.log('--- the beam thins as it burns off ---');
{
  const w = twoBatches(0, 0);
  const beamCtx = created[0].ctx;
  const widthNow = (): number => {
    beamCtx.strokes.length = 0;
    drawFrame(w);
    return Math.max(0, ...beamCtx.strokes.map((s) => s.width));
  };
  for (let i = 0; i < 30; i++) w.advance(1 / 60);
  const full = widthNow();
  const intensityFull = w.beamIntensity(0);
  // The charge is burned by the physics; drive it hard here so the drawing can be checked
  // in a second rather than in the quarter of an hour a real fill takes.
  for (let i = 0; i < w.beam.count; i++) w.beam.charge[i] *= 0.2;
  for (let i = 0; i < 30; i++) w.advance(1 / 60);
  const burnt = widthNow();
  const intensityBurnt = w.beamIntensity(0);
  check(
    'a fresh batch is drawn at full width',
    full > 0 && intensityFull > 0.95,
    `${full.toFixed(2)} px at ${(intensityFull * 100).toFixed(0)} % intensity`,
  );
  check(
    'and a burnt-down one is visibly thinner',
    burnt < full * 0.75,
    `${burnt.toFixed(2)} px at ${(intensityBurnt * 100).toFixed(0)} % intensity`,
  );
  check('but never invisible', burnt > full * 0.25, `${((burnt / full) * 100).toFixed(0)} % of full width`);
}

// The second view: the same collision seen down the beam pipe, in the experiment's own
// panel. It is the one picture in this app that is not drawn on the machine, so nothing
// else here would ever notice it failing to draw at all.
console.log('--- the transverse event display ---');
{
  const { EventDisplay } = await import('../src/render/eventDisplay');
  const shower = await import('../src/sim/shower');
  const {
    BARREL,
    DETECTOR_SHELLS,
    EM_CELLS,
    EM_SAMPLINGS,
    HAD_CELLS,
    HAD_SAMPLINGS,
    HIT_STRIDE,
    MUON_CHAMBERS,
    MUON_STATIONS,
    buildTransverse,
  } = shower;
  // At the size the panel really gives it, so "too small to resolve" would show up here.
  const panel = makeCanvas();
  panel.clientWidth = EVENT_CANVAS;
  panel.clientHeight = EVENT_CANVAS;
  const display = new EventDisplay(panel as unknown as HTMLCanvasElement);
  const pctx = panel.ctx;

  // The barrel is a real barrel, and its group boundaries are the four numbers everything
  // else in the model is built on. Those two facts have to keep agreeing.
  {
    const outer = (kind: string): number =>
      Math.max(...BARREL.filter((l) => l.kind === kind).map((l) => l.r1));
    check(
      'the barrel ends exactly on the shells the rest of the model uses',
      Math.abs(outer('straw') - DETECTOR_SHELLS[0]) < 1e-9 &&
        Math.abs(outer('em') - DETECTOR_SHELLS[1]) < 1e-9 &&
        Math.abs(outer('had') - DETECTOR_SHELLS[2]) < 1e-9 &&
        Math.abs(outer('muon') - DETECTOR_SHELLS[3]) < 0.02,
      `tracker ${outer('straw')}, EM ${outer('em')}, tile ${outer('had')}, muon ${outer('muon')}`,
    );
    const counts = (kind: string): number => BARREL.filter((l) => l.kind === kind).length;
    check(
      'and it has the layers a real one has',
      counts('pixel') === 4 && counts('strip') === 4 && counts('straw') === 1 &&
        counts('em') === EM_SAMPLINGS && counts('had') === HAD_SAMPLINGS &&
        counts('muon') === MUON_STATIONS,
      `${counts('pixel')} pixel, ${counts('strip')} strip, ${counts('straw')} straw, ` +
        `${counts('em')} EM, ${counts('had')} tile, ${counts('muon')} muon, ` +
        `${BARREL.length} in all`,
    );
    // Nothing may sit inside anything else: a layer list that overlaps draws one detector
    // through another and there is no other way to notice.
    let overlaps = 0;
    const radial = BARREL.filter((l) => l.kind !== 'coil' && l.kind !== 'muon');
    for (let i = 1; i < radial.length; i++) {
      if (radial[i].r0 < radial[i - 1].r1 - 1e-9) overlaps++;
    }
    check('and no two layers overlap', overlaps === 0, `${overlaps} overlapping`);
  }

  display.render(null);
  check(
    'an idle experiment still draws its whole detector',
    pctx.fills.length >= BARREL.length && pctx.texts.some((t) => t.text === 'no collisions'),
    `${pctx.fills.length} filled layers for ${BARREL.length} in the barrel`,
  );

  pctx.fills.length = 0;
  pctx.strokes.length = 0;
  pctx.texts.length = 0;
  // A seed with a muon in it, on purpose: what happens outside the solenoid is asserted
  // below and only something that gets out there can show it.
  const event = buildTransverse(13_600, 1006);
  check('the event has something that reaches the muon system', event.muonTracks > 0,
    `${event.muonTracks} through`);
  display.render(event, 1);

  // The cells, which are the readout. Depth as well as azimuth: an EM shower dies in
  // sampling 2 and a hadron is still going in sampling 3, and one ring of cells cannot say
  // that. A wedge records as an arc-arc path with a colour of its own.
  const allCells = EM_SAMPLINGS * EM_CELLS + HAD_SAMPLINGS * HAD_CELLS;
  const lit = pctx.fills.filter(
    (f) => f.style.includes('120, 200, 255') || f.style.includes('255, 178, 96'),
  );
  check(
    'the calorimeter cells a particle landed in are lit',
    lit.length > 20,
    `${lit.length} of ${allCells} cells (${EM_SAMPLINGS} EM + ${HAD_SAMPLINGS} tile samplings)`,
  );
  check(
    'and not all of them, or the picture says nothing',
    lit.length < allCells,
    `${lit.length} lit`,
  );
  // The one thing longitudinal segmentation is for: an electromagnetic shower must not be
  // spread flat through the depth of the calorimeter.
  {
    const perSampling = [];
    for (let s = 0; s < EM_SAMPLINGS; s++) {
      let sum = 0;
      for (let c = 0; c < EM_CELLS; c++) sum += event.em[s * EM_CELLS + c];
      perSampling.push(sum);
    }
    const peak = Math.max(...perSampling);
    check(
      'the electromagnetic calorimeter is deepest in sampling 2',
      perSampling.indexOf(peak) === 2,
      perSampling.map((v) => v.toFixed(0)).join(' / '),
    );
  }

  // Tracks, batched by species — the same colour table the ring uses, which is how they are
  // told apart from the structure strokes in the same buffer.
  const speciesKeys = ['255, 208, 130', '160, 220, 255', '200, 175, 255', '255, 130, 205',
    '130, 255, 195', '255, 150, 85', '255, 255, 240'];
  // ≥ 4 points, because a lit muon chamber is also stroked white and records as a one-point
  // arc — the lepton colour and the muon-hit colour are deliberately the same white.
  const tracks = pctx.strokes.filter(
    (s) => s.op === 'lighter' && s.points.length >= 4 && speciesKeys.some((k) => s.style.includes(k)),
  );
  check('tracks are drawn', tracks.length > 0, `${tracks.length} species batches`);
  const drawnSegments = tracks.reduce((n, s) => n + s.points.length / 2, 0);
  check(
    'every segment of the event reaches the canvas',
    drawnSegments === event.count,
    `${drawnSegments} drawn of ${event.count} built`,
  );
  // And the thing they are here for: they have to *curve*. Measured on the event's own
  // segments rather than on the stroked polylines — the renderer batches every species into
  // one path, so consecutive points there jump between tracks and any angle is meaningless.
  let maxBend = 0;
  let bent = 0;
  for (let i = 1; i < event.count; i++) {
    const a = (i - 1) * SEGMENT_STRIDE;
    const b = i * SEGMENT_STRIDE;
    // same track only: one segment ends exactly where the next begins
    if (event.data[a + 2] !== event.data[b] || event.data[a + 3] !== event.data[b + 1]) continue;
    const ux = event.data[a + 2] - event.data[a];
    const uy = event.data[a + 3] - event.data[a + 1];
    const vx = event.data[b + 2] - event.data[b];
    const vy = event.data[b + 3] - event.data[b + 1];
    const turn = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
    if (turn > 0.02) bent++;
    maxBend = Math.max(maxBend, turn);
  }
  check(
    'and they curve in the solenoid',
    maxBend > 0.05 && bent > 10,
    `${bent} bent joints, sharpest ${((maxBend * 180) / Math.PI).toFixed(1)} deg`,
  );
  // ...and stop curving outside it, because the field does. A muon's outermost segment is
  // in the muon system, where the bending is a toroid and out of this plane entirely.
  {
    let straightOutside = 0;
    let curvedOutside = 0;
    for (let i = 1; i < event.count; i++) {
      const a = (i - 1) * SEGMENT_STRIDE;
      const b = i * SEGMENT_STRIDE;
      if (event.data[a + 2] !== event.data[b] || event.data[a + 3] !== event.data[b + 1]) continue;
      if (Math.hypot(event.data[b], event.data[b + 1]) < DETECTOR_SHELLS[0] * 1.05) continue;
      const ux = event.data[a + 2] - event.data[a];
      const uy = event.data[a + 3] - event.data[a + 1];
      const vx = event.data[b + 2] - event.data[b];
      const vy = event.data[b + 3] - event.data[b + 1];
      if (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) > 0.01) curvedOutside++;
      else straightOutside++;
    }
    check(
      'and run straight once they are out of it',
      curvedOutside === 0 && straightOutside > 0,
      `${straightOutside} straight joints outside the solenoid, ${curvedOutside} still bending`,
    );
  }
  check(
    'soft tracks curl up inside the tracker',
    event.loopers > 0 && event.loopers < event.primaries,
    `${event.loopers} of ${event.primaries} never reached the calorimeter`,
  );

  // The hits, which are what a tracker actually measures — and the fact that a neutral
  // leaves none, which is the whole of how a photon is told from an electron.
  check(
    'the tracker records hits',
    event.hitCount > 40,
    `${event.hitCount} hits from ${event.charged} charged of ${event.primaries} particles`,
  );
  {
    let inside = 0;
    for (let i = 0; i < event.hitCount; i++) {
      const o = i * HIT_STRIDE;
      if (Math.hypot(event.hits[o], event.hits[o + 1]) <= DETECTOR_SHELLS[0] + 1e-6) inside++;
    }
    check('and every one of them is in the tracker', inside === event.hitCount,
      `${event.hitCount - inside} outside`);
  }
  {
    // A neutral track drawn on the picture must have nothing sitting on it.
    let neutralSegments = 0;
    let hitsOnNeutrals = 0;
    for (let i = 0; i < event.count; i++) {
      const o = i * SEGMENT_STRIDE;
      if (event.data[o + 6] <= 0) continue;
      neutralSegments++;
      for (let h = 0; h < event.hitCount; h++) {
        const q = h * HIT_STRIDE;
        const d = Math.hypot(event.hits[q] - event.data[o + 2], event.hits[q + 1] - event.data[o + 3]);
        if (d < 1e-4) hitsOnNeutrals++;
      }
    }
    check(
      'a neutral leaves no hits at all',
      neutralSegments > 0 && hitsOnNeutrals === 0,
      `${neutralSegments} neutral segments, ${hitsOnNeutrals} hits on them`,
    );
  }
  const hitDots = pctx.fills.filter(
    (f) => f.style.includes('190, 230, 255') || f.style.includes('255, 220, 150'),
  );
  check('and they are drawn', hitDots.length === event.hitCount, `${hitDots.length} dots`);

  // The muon system: three stations, and a thing that reaches them lights all three.
  check(
    'the muon system has three stations of chambers',
    event.muon.length === MUON_STATIONS * MUON_CHAMBERS,
    `${event.muon.length} chambers`,
  );
  {
    const perStation = [];
    for (let st = 0; st < MUON_STATIONS; st++) {
      let n = 0;
      for (let c = 0; c < MUON_CHAMBERS; c++) n += event.muon[st * MUON_CHAMBERS + c];
      perStation.push(n);
    }
    check(
      'and what gets through lights every one of them',
      event.muonTracks === 0 || perStation.every((n) => n > 0),
      `${event.muonTracks} through, chambers lit ${perStation.join(' / ')}`,
    );
  }

  // The particles are named. "Some circles" is what this looked like before.
  check(
    'the hard objects are labelled',
    event.objects.length > 0 && pctx.texts.length >= event.objects.length,
    `${event.objects.length} objects, ${pctx.texts.length} labels drawn`,
  );
  check(
    'and every label carries a momentum',
    pctx.texts.every((t) => /\d/.test(t.text)),
    pctx.texts.map((t) => t.text).join(', '),
  );
}

console.log('--- comet continuity ---');
{
  // A comet is drawn as one polyline continued across frames, so a bunch that appears
  // somewhere else — a fresh batch from the chain, a batch arriving in the collider — gets
  // a bright line drawn from wherever the last one was, straight across the picture,
  // unless that particle's continuity is dropped. Nothing but the eye catches this.
  const beamCtx = created[0].ctx;
  const w = new World();
  w.attachBackend(new CpuBackend());
  renderer.clearBeamTrail();
  let longest = 0;
  let spawns = 0;
  for (let i = 0; i < 900; i++) {
    if (i === 10 || i === 400) w.requestFill();
    if (i === 200) w.armKicker(w.lineIndex('ti2'));
    const r = w.advance(1 / 60);
    for (const id of r.spawned) renderer.clearBeamTrail(id);
    spawns += r.spawned.length;
    ctx.strokes.length = 0;
    ctx.fills.length = 0;
    ctx.texts.length = 0;
    beamCtx.strokes.length = 0;
    drawFrame(w);
    for (const st of beamCtx.strokes) {
      for (let k = 1; k < st.points.length; k++) {
        longest = Math.max(
          longest,
          Math.hypot(st.points[k][0] - st.points[k - 1][0], st.points[k][1] - st.points[k - 1][1]),
        );
      }
    }
  }
  check('the chain delivered batches during the run', spawns > 0, `${spawns} spawned`);
  check('no comet is ever drawn jumping across the picture', longest < 100, `longest segment ${longest.toFixed(1)} px`);
}

console.log(failures === 0 ? '\nall render checks passed' : `\n${failures} render check(s) FAILED`);
if (failures > 0) (globals.process as { exitCode: number }).exitCode = 1;
