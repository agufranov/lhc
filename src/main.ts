import { LHC_CONFIG } from './sim/lattice';
import { World } from './sim/world';
import { TRAIL_STRIDE, getBackend, registerBackend } from './sim/backend';
import { cpuBackendFactory } from './sim/backends/cpuBackend';
import { webgpuBackendFactory } from './sim/backends/webgpuBackend';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';
import { Controls } from './ui/controls';
import { Sheet } from './ui/sheet';
import { MOBILE_WIDTH, eventCardBoxes, machineBorders, publishLayout } from './ui/layout';

registerBackend(cpuBackendFactory);
registerBackend(webgpuBackendFactory);

const canvas = document.getElementById('stage') as HTMLCanvasElement;

// One world: two rings, four lines, one particle array, one backend. A bunch crossing
// from the injector to the collider is not an event anybody has to handle.
const world = new World();

const renderer = new Renderer(canvas);
const hud = new Hud(world, {
  onBackend(id) {
    void swapBackend(id);
  },
});

/** The overlay's own furniture, and the two cards whose visibility moves the right rail. */
const overlayRoot = document.querySelector('.overlay') as HTMLElement;
const titleRoot = document.querySelector('.title') as HTMLElement;
const cardA = document.getElementById('panel-ip-a')!;
const cardB = document.getElementById('panel-ip-b')!;

/**
 * Puts the experiments' cards where the machine leaves room for them.
 *
 * The stylesheet's numbers come from `ui/layout.ts` so that the same geometry the camera is
 * checked against is the geometry the panels are laid out with — and none of them is a
 * constant, because the room around the machine is a measured quantity that changes with the
 * window. The button bar's height is measured rather than assumed: it wraps to two rows on a
 * narrow window and the lower card has to clear whatever it actually became.
 *
 * Cheap enough to call every frame: it is a comparison unless something really moved.
 */
function fitOverlay(): void {
  const bands = renderer.machineBands(world);
  const boxes = eventCardBoxes(
    canvas.clientWidth,
    canvas.clientHeight,
    bands,
    overlayChrome(),
    [!cardA.hidden, !cardB.hidden],
    // A zoomed view has no free band to stand a card in — the machine it is zoomed into fills
    // the window — so the cards take the readouts' column there and the readouts scroll.
    renderer.view === 'complex' ? 'beside' : 'column',
  );
  publishLayout(document.documentElement, boxes, bands);
}

/**
 * The title and the button bar, as tall as the browser actually made them — plus the sheet,
 * on a window narrow enough to have one.
 *
 * The sheet stands along the bottom over the picture, so as far as the camera is concerned it
 * is more button bar: the machine is fitted above whatever the overlay actually took, which is
 * how "no panel is drawn over the machine" survives a 390 px screen.
 */
function overlayChrome(): { title: number; controls: number } {
  return { title: titleRoot.offsetHeight, controls: controlsRoot.offsetHeight + sheet.height };
}

/**
 * Narrow enough that the readouts cannot stand beside the machine.
 *
 * One question asked once: the stylesheet answers it with a media query and the app with this,
 * and they are the same number because a layout half in one mode and half in the other is the
 * bug this whole file exists to avoid.
 */
const narrow = window.matchMedia(`(max-width: ${MOBILE_WIDTH}px)`);

/**
 * Fits the machine, keeping it out from under the title and the buttons.
 *
 * The camera is given the same two numbers the overlay's rails start at: a picture centred in
 * the whole window puts the collider's lowest sector labels behind the button bar, which is
 * where they were.
 */
function fitCamera(dtWall = 0): void {
  renderer.resize(
    world,
    // On a phone the overlay has no side columns at all, so a zoomed view may use the whole
    // width of the window rather than keeping the rails' clear.
    { ...machineBorders(overlayChrome()), sides: narrow.matches ? 0 : undefined },
    dtWall,
  );
}

const sheet = new Sheet({
  ipA: world.detectors[0].config.name,
  ipB: world.detectors[1].config.name,
});

const trail = new Float32Array(16_384 * TRAIL_STRIDE);

let paused = false;
let lastFrame = performance.now();
let fps = 60;

const controlsRoot = document.getElementById('controls')!;
const controls = new Controls(controlsRoot, world, {
  onTogglePause() {
    paused = !paused;
    controls.setPaused(paused);
  },
  onFillInjector() {
    world.requestFill();
  },
  onExtract(id) {
    const index = world.lineIndex(id);
    if (index >= 0) world.armKicker(index);
  },
  onCog(direction) {
    world.setCogging(direction);
  },
  onAutoCog() {
    world.autoCog();
  },
  onRamp(up) {
    world.collider.setTargetEnergy(up ? LHC_CONFIG.topEnergyGeV : LHC_CONFIG.injectionEnergyGeV);
  },
  onInjectorRamp(up) {
    const cfg = world.injector.ring.config;
    world.injector.setTargetEnergy(up ? cfg.topEnergyGeV : cfg.injectionEnergyGeV);
  },
  // A tab is a place: the camera flies there and the bar shows what can be done from it.
  // Nothing about the machine changes — see `render/views.ts`.
  onView(id) {
    renderer.setView(id);
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

/**
 * A handle on the running machine, for the browser gates and for anybody with a console open.
 *
 * `check:page` forces an incident through this and then asserts what the *page* did about it —
 * which is the only way to test the alarm banner and the shake, since both are things the DOM
 * and the canvas do rather than things the physics knows. Nothing in the app reads it back.
 */
(window as unknown as { lhc: unknown }).lhc = { world, renderer };

async function boot(): Promise<void> {
  // Things go wrong on their own in the app, and never in a measurement — see
  // `IncidentSystem.enabled`. `?quiet=1` is how the browser gates get a machine that will
  // still be running two colliding beams when they come to measure the overlay.
  world.incidents.enabled = !new URLSearchParams(location.search).has('quiet');
  world.attachBackend(await cpuBackendFactory.create());
  // The injector starts with a batch in it and the collider starts empty: filling the
  // collider is something you do, not something that has already happened.
  world.fillInjector();
  fitCamera();
  fitOverlay();
  requestAnimationFrame(frame);
}

function frame(now: number): void {
  const dtWall = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  fps = fps * 0.9 + (1 / Math.max(dtWall, 1e-4)) * 0.1;

  // The camera is moved on wall time and not on the machine clock: a view a paused machine
  // is looking at still has to be able to change. See `Renderer.resize`.
  fitCamera(dtWall);
  fitOverlay();
  // **The experiments' cards are not on screen while the camera is moving.** They are placed
  // beside the machine, and coming out of a zoomed view the machine covers the whole window
  // for part of the flight — there is nowhere beside it to be. Hidden by opacity rather than
  // by `hidden`, so nothing about the layout changes and the rails do not jump; see
  // `docs/rendering.md`.
  overlayRoot.classList.toggle('is-flying', renderer.flying);
  // Which readouts are in the sheet, and whether an experiment has earned a tab in it yet.
  sheet.attach(narrow.matches);
  sheet.update(world);
  // The same question the sheet and the stylesheet ask, asked once: on a narrow screen every
  // control says the same thing in fewer words, because the tab above it carries the context.
  controls.setCompact(narrow.matches);
  // The bar stands on top of the sheet. Published rather than assumed, because the sheet is
  // as tall as its contents up to a cap and the reader can fold it away.
  document.documentElement.style.setProperty('--sheet-height', `${sheet.height}px`);

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
  // Which controls would currently do nothing — cogging with only one beam on the orbit —
  // and which places have something happening in them. The kickers are never among them.
  controls.update(world, renderer.view);
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
