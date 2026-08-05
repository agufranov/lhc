# CLAUDE.md

Index and working rules for this repository. **This file is the whole of what you must read
every session.** The detail lives in `docs/`; read the one page that covers what you are
about to touch, not all of them.

## Rule zero: write down what you learn, in the same change

Nobody will ask you to do this. Do it anyway, every time, without being told.

**Something is worth recording if a future session would otherwise re-derive it or break
it:** a new module, a changed contract, a tuned constant other numbers depend on, a decision
about what the model may and may not fake, a measured number, a trap discovered the hard way,
or an approach that was tried and failed. Record it in the same change as the work, not later.
If a document contradicts the code, the code is right and the document is a bug.

Where it goes:

| what you learned | where it goes |
| --- | --- |
| a measured number worth regressing against | `docs/reference.md` |
| an approach that was tried and does not work, or a bug that was silent | `docs/lessons.md` |
| a deliberate departure from reality, or something still missing | `docs/limits.md` |
| how a mechanism works and why it is that way | the matching `docs/` page below |
| a new module, or a change to any rule on this page | `CLAUDE.md` |

Two things that are not optional:

- **A behaviour the user can see gets an assertion**: `check:render` if it is drawn,
  `check:page` if it is placed. Those are the whole regression net for anything visual —
  see "Seeing the page".
- **A measured number gets printed by `check` or `check:render`**, not just written down, so
  the next session can re-measure it instead of trusting it.

Keep every page short and factual. These are not changelogs — record the *current* state and
the reasoning behind it, and delete what stopped being true.

## What this is

A browser toy about the LHC. It is a game, not a design code — but the audience is
physicists, so the numbers on screen are the real ones and every deliberate departure
from reality is stated in the code where it is made.

Vite + TypeScript, no framework, Canvas 2D. Two rings — the LHC and the SPS that fills
it — four lines between and out of them, and one array of macro-particles shared by all
of it. Both LHC beams, several batches each, plus whatever is in flight.

What works today: fill the injector at 26 GeV and **ramp it to 450**, extract down TI 2 or
TI 8 into either beam of the collider, stack batches, ramp to 6.8 TeV, switch any dipole
circuit off by clicking it, quench one and recover it, dump either beam into its own
absorber, watch every wall hit develop as a particle cascade, and **collide the two beams at
P3 and P7** — phasing the crossing point onto an interaction point with bucket-timed
injection and cogging. Each experiment has its own **event display** through the whole barrel,
looking down the beam pipe: twenty-two layers, the tracker hits a charged particle leaves and
a neutral does not, tracks curving in the solenoid and running straight outside it, the
calorimeter cells they landed in at the depth they died at, the muon chambers, named objects,
and a **trigger** that keeps the best collision instead of strobing every one. The beams
**thin as they collide**, and only thin — the protons left in them are exactly as energetic.
What is not built: `docs/limits.md`.

## Where everything is written down

| page | read it before touching |
| --- | --- |
| `docs/architecture.md` | anything that moves a particle: backends, buffer strides, the one-world rule, capture, the bore rule, the two clocks |
| `docs/physics.md` | the lattice, the pusher, field integration, the 250 m aperture |
| `docs/beamlines.md` | transfer and dump lines, kickers and septa, injection, where the injector is parked |
| `docs/collisions.md` | detectors, luminosity, phasing and cogging, the interaction region, event displays |
| `docs/impacts.md` | wall damage, particle cascades, the quench rule |
| `docs/rendering.md` | anything in `src/render/` |
| `docs/reference.md` | any number you are about to change or quote |
| `docs/lessons.md` | before trying something that looks obvious and is not |
| `docs/limits.md` | before "fixing" something that is wrong on purpose |

## Commands

Run these with the **Bash** tool, not PowerShell — see below.

```
npm install
npm start            # http://127.0.0.1:5173 (strictPort)
npm run typecheck    # tsc --noEmit, both configs (see tsconfig.browser.json)
npm run check        # headless: lattice, tracking, extraction, dumps, powering, quench,
                     # damage, showers, pacing, collisions and phasing — every number in
                     # docs/reference.md comes from it
npm run check:render # headless renderer smoke test against a recording mock canvas
npm run check:page   # the overlay measured in real headless Chrome: what covers what
npm run shot -- 1919 906 out.png   # a screenshot of the running toy, headless
```

`npm run build` runs the typecheck then `vite build`.

### Environment (Windows)

- **Use the Bash tool for anything involving node.** It sources `~/.bashrc`, which
  initialises fnm, so `node` (v24) and `npm` are on `PATH` there and nowhere else.
  PowerShell has neither node nor fnm on `PATH`; if you must use it, bootstrap first:
  `$env:Path = 'C:\Users\ils\.local\share\fnm;' + $env:Path; fnm env --use-on-cd | Out-String | Invoke-Expression`
  (verified: gives v24.18.1). There is no nvm here — an older note in this file claimed a
  hard-coded `.nvm` path, which is stale.
- PowerShell 5.1 otherwise: no `&&`, no ternary. Use `;` and `if ($?) { }`.
- The dev server may already be running from an earlier session and will hold port 5173;
  `npm start` then fails with `Port 5173 is already in use`. Vite resolves modules from
  disk on every request, so an older server still serves current code — check with
  `Invoke-WebRequest` for a known new symbol rather than restarting blindly.
- A git repository, on `main`. **Pushing `main` publishes the toy**: `.github/workflows/pages.yml`
  runs typecheck, `check`, `check:render`, `vite build`, and deploys `dist/` to GitHub Pages.
  A red check there means nothing ships, which is the point — do not push work that fails
  the three gates locally.
- The build uses `base: './'` so it works from a Pages project subpath. **Never reference an
  asset by an absolute `/…` path** at runtime; it resolves to the domain root and 404s there
  while working perfectly on the dev server.

## Seeing the page

**There is a browser.** `puppeteer-core` drives the Chrome already installed on this machine,
headless — nothing opens on screen, nothing steals focus. `scripts/browser/` holds it:
`page.ts` (launch, drive the machine to two colliding beams, wait on what the panels *say*
rather than on the clock), `shot.ts` (a screenshot you can look at), `page-check.ts` (the
overlay measured with `getBoundingClientRect`). It starts its own Vite server if 5173 is not
already up. An earlier version of this file said no browser was available; it was wrong, and
a layout bug lived through three green gates because of it.

Four gates, and each sees something the others cannot:

1. `npm run typecheck`
2. `npm run check` — physics
3. `npm run check:render` — drawing, via a recording mock canvas
4. `npm run check:page` — layout, in a real browser

`check:render` exists because a drawing bug is invisible to 1 and 2, and it has earned its
keep several times over — a band fill that buried every magnet, a comet drawn across the
picture, a dipole shaded dead while a kicker fired, a cascade drawn three pixels long, a
collision flashing in a detector with no beam drawn near it.

`check:page` exists because a **layout** bug is invisible even to that: the overlay is HTML
over the canvas, and no assertion about what the renderer was asked to draw can see one panel
sitting on another. It caught, on its first run, three cards fighting over one rail with the
machine readouts crushed to a 115 px scroller, and two more overlaps nobody had noticed.

**When a visual behaviour is requested, add an assertion for it — to `check:render` if it is
drawn, to `check:page` if it is placed.** Still do not claim a visual result was verified
without one of these, or a screenshot you actually looked at.

## Layout

```
src/sim/
  units.ts       SI constants, γ/β/p/Bρ helpers
  lattice.ts     RingConfig + ring geometry -> flat field & aperture tables
  field.ts       B_z integrated over a step, + its WGSL twin
  aperture.ts    projection onto the closed orbit, + its WGSL twin
  beam.ts        BeamState: structure-of-arrays particle storage
  backend.ts     SimBackend contract, registry, buffer strides
  backends/      cpuBackend.ts (reference), webgpuBackend.ts (stub + shader)
  powering.ts    MagnetCircuit: current, stored energy, power, on/off, quench fields
  damage.ts      penetration depth and channel temperature
  line.ts        transfer and dump lines: the drift-bend router that aims them
  machine.ts     one ring = lattice + powering + energy programme + telemetry
  detector.ts    the experimental insertions: where they are, how big, luminosity, the trigger
  shower.ts      the branching cascade an impact sets off, the collision event, and the
                 same collision seen down the beam pipe (buildTransverse)
  world.ts       the whole complex: machines, lines, ONE beam array, ONE backend
src/render/
  camera.ts      world <-> screen, including the inverse for hit testing
  palette.ts     magnet, casing, incandescence ramps and the one species colour table
  renderer.ts    all drawing of the machine, plus pickMagnet hit testing
  eventDisplay.ts  the r-phi event display, into an experiment's own canvas
src/ui/          hud.ts, controls.ts, eventPanel.ts, readout.ts, format.ts
  layout.ts      where every overlay box goes, worked out against the camera
scripts/         check.ts, render-check.ts, dump-diag.ts (where a dumped batch really died)
  browser/       page.ts, shot.ts, page-check.ts — headless Chrome (node types live here
                 only; see tsconfig.browser.json)
docs/            the pages in the table above
.github/workflows/pages.yml   the three gates, then build and publish to GitHub Pages
```

## The invariants, in one place

Break any of these and something looks like broken physics rather than a bug. Each is
argued in the page named beside it.

- **One field table, one aperture table, one `BeamState`, one backend** for the whole
  complex. A particle belongs to a place, not to a machine. → `architecture.md`
- **Particle code stays GPU-portable**: SoA typed arrays, flat stride tables, no
  allocation in the hot path, and `FIELD_WGSL` / `APERTURE_WGSL` edited in the same change
  as their TypeScript twins. → `architecture.md`
- **Which bore a particle is in follows from the direction it is going.** There is no
  "which beam" field anywhere. → `architecture.md`
- **A magnet only bends what is in its own pipe** (`owner`). → `architecture.md`
- **Capture is a state, tested on entry, never per frame.** Anything re-tested per frame
  makes the physics depend on the frame rate. → `architecture.md`
- **Two clocks, never fused**: a per-particle beam rate from its own energy, and a fixed
  200× machine clock. Anything the machine waits for is timed on `World.elapsed`. →
  `architecture.md`
- **Collisions consume beam and nothing else does — and what they take is population.**
  A burning fill is drawn thinner, never slower or softer. → `collisions.md`
- **One collision, two views.** The r–z display on the ring and the r–φ display in an
  experiment's panel come from one generator and one seed. → `collisions.md`
- **The beam is never magnified**, and every other magnification is stated with its true
  metres reported somewhere. → `rendering.md`
- **The ring's dipoles are never touched by an extraction**, in the physics or in the
  drawing. → `beamlines.md`
- **Anything the user can see is asserted** — in `check:render` if it is drawn, in
  `check:page` if it is placed. → this page, above.
- **No overlay panel is drawn over the machine, and no panel over another panel.** Every box
  in the overlay is *derived* from where the camera actually put the machine
  (`Renderer.machineBands` → `ui/layout.ts`), never declared beside it; `check:render` sweeps
  the arithmetic over window sizes and `check:page` measures the real boxes. → `rendering.md`
