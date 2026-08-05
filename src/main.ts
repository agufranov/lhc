import { LHC_CONFIG } from './sim/lattice';
import { World } from './sim/world';
import { TRAIL_STRIDE, getBackend, registerBackend } from './sim/backend';
import { cpuBackendFactory } from './sim/backends/cpuBackend';
import { webgpuBackendFactory } from './sim/backends/webgpuBackend';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';
import { Controls } from './ui/controls';
import { publishLayout } from './ui/layout';

registerBackend(cpuBackendFactory);
registerBackend(webgpuBackendFactory);

// The stylesheet's column widths come from `ui/layout.ts`, so that the same numbers the
// camera is checked against are the ones the panels are actually laid out with.
publishLayout(document.documentElement);

const canvas = document.getElementById('stage') as HTMLCanvasElement;

// One world: two rings, four lines, one particle array, one backend. A bunch crossing
// from the injector to the collider is not an event anybody has to handle.
const world = new World();

const renderer = new Renderer(canvas);
const hud = new Hud(world);

const trail = new Float32Array(16_384 * TRAIL_STRIDE);

let paused = false;
let lastFrame = performance.now();
let fps = 60;
/**
 * Whether an injection waits for the bucket that puts it head-on with the other beam.
 *
 * On by default, because that is what a machine does and because injecting without it
 * produces a filled collider that collides nowhere — which is worth seeing on purpose and
 * confusing to arrive at by accident.
 */
let injectOnBucket = true;

const controls = new Controls(document.getElementById('controls')!, world, {
  onTogglePause() {
    paused = !paused;
    controls.setPaused(paused);
  },
  onFillInjector() {
    world.requestFill();
  },
  onExtract(id) {
    const index = world.lineIndex(id);
    if (index >= 0) world.armKicker(index, injectOnBucket ? 'bucket' : 'now');
  },
  onCog(direction) {
    world.setCogging(direction);
  },
  onAutoCog() {
    world.autoCog();
  },
  onToggleTiming() {
    injectOnBucket = !injectOnBucket;
    return injectOnBucket;
  },
  onRampUp() {
    world.collider.setTargetEnergy(LHC_CONFIG.topEnergyGeV);
  },
  onRampDown() {
    world.collider.setTargetEnergy(LHC_CONFIG.injectionEnergyGeV);
  },
  onInjectorRamp(up) {
    const cfg = world.injector.ring.config;
    world.injector.setTargetEnergy(up ? cfg.topEnergyGeV : cfg.injectionEnergyGeV);
  },
  onBackend(id) {
    void swapBackend(id);
  },
});

async function swapBackend(id: string): Promise<void> {
  const factory = getBackend(id);
  if (!factory) return;
  const reason = await factory.unavailableReason();
  if (reason) {
    console.warn(`backend "${id}" unavailable: ${reason}`);
    return;
  }
  world.attachBackend(await factory.create());
  renderer.clearBeamTrail();
}

async function boot(): Promise<void> {
  world.attachBackend(await cpuBackendFactory.create());
  // The injector starts with a batch in it and the collider starts empty: filling the
  // collider is something you do, not something that has already happened.
  world.fillInjector();
  renderer.resize(world);
  requestAnimationFrame(frame);
}

function frame(now: number): void {
  const dtWall = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  fps = fps * 0.9 + (1 / Math.max(dtWall, 1e-4)) * 0.1;

  renderer.resize(world);

  let steps = 0;
  const t0 = performance.now();
  if (!paused) {
    const r = world.advance(dtWall);
    steps = r.steps;
    // A fresh bunch appears where it appears, not where the last tail ended. Without
    // this the comet is drawn a straight line from one to the other, across the picture.
    for (const id of r.spawned) renderer.clearBeamTrail(id);
  }

  const trailCount = world.backend ? world.backend.drainTrail(trail) : 0;
  renderer.render(world, trail, trailCount, paused ? 0 : dtWall);

  hud.update(world, { fps, stepsThisFrame: steps, frameMs: performance.now() - t0 });
  requestAnimationFrame(frame);
}

// Clicking a magnet chain switches that arc's dipole circuit off. It does not go dark
// instantly — 15 H at 11 kA has to dump through the extraction resistors first. Clicking
// a quenched one starts it cooling back to 1.9 K.
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  renderer.hovered = renderer.pick(world, e.clientX - rect.left, e.clientY - rect.top);
  canvas.style.cursor = renderer.hovered ? 'pointer' : 'default';
});

canvas.addEventListener('mouseleave', () => {
  renderer.hovered = null;
});

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const hit = renderer.pick(world, e.clientX - rect.left, e.clientY - rect.top);
  if (hit) hit.machine.toggleCircuit(hit.arc);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
    controls.setPaused(paused);
  }
});

void boot();
