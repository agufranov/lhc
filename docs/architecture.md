# Architecture

The decisions everything else falls out of. Read this before touching anything under
`src/sim/` that moves a particle.

## GPU portability is a hard constraint

Everything that touches particles must stay portable to a compute shader:

- particle state is SoA typed arrays (`BeamState`) — never an array of objects. `rate` is a
  column like any other: the host writes each particle's apparent speed, the backend keeps a
  per-particle accumulator and pushes it only that fraction of the iterations;
- the lattice is a flat `Float32Array` with a fixed stride, laid out as a GPU storage
  buffer would be (`FIELD_STRIDE`, `APERTURE_STRIDE`);
- field and aperture code is allocation-free, index-based and branch-light;
- `FIELD_WGSL` in `field.ts` and `APERTURE_WGSL` in `aperture.ts` are line-for-line
  translations of the TypeScript above them. **If one changes, the other changes in the
  same edit.** Nothing enforces this but you.
- everything particle-related goes through `SimBackend` so CPU and GPU can be
  benchmarked on the same workload (`µs / 1k steps` in the compute panel).

Documented trap in `webgpuBackend.ts`: positions reach ~10⁴ m and millimetres matter,
which is the edge of f32. The GPU backend must keep positions relative to the sector
centre or split them hi/lo. The CPU backend integrates in f64.

## SimBackend contract

`init` · `setField` · `setFieldScales` · `setAperture` · `step` · `readPositions` ·
`drainTrail` · `drainLosses` · `sync` · `dispose`.

The host never reads particle state per step. The backend produces the trail and the
loss records itself, so a GPU implementation appends to a device buffer and hands back
one readback. Buffer strides live in `backend.ts`:

- `TRAIL_STRIDE = 6` — x, y, nx, ny, offset/aperture, particle id
- `LOSS_STRIDE = 11` — sx, sy, nx, ny, offset, dirX, dirY, particle, element, **px, py**
- `FIELD_STRIDE = 7` — cx, cy, radius, phiStart, dPhi, halfWidth, **owner**
- `APERTURE_STRIDE = 11` — kind, 5 geometry, sense, radius, machine, sector, **owner**
- `SEGMENT_STRIDE = 8` (`shower.ts`) — x0, y0, x1, y1, species, energy, generation, spare

The id in the trail is what keeps several comets apart in one buffer. A loss carries *two*
positions and both are load-bearing: `sx, sy` is the foot of the perpendicular on the closed
orbit — right for a beam that crossed its pipe and grazed the side wall — and `px, py` is
where the particle actually was, which is the only useful answer for a beam that ran down
the middle of a dump line until the pipe ran out.

The backend also reads `beam.rate` and steps each particle only that fraction of the
iterations offered; see "one world, one clock" below.

`setFieldScales` uploads **2N signed excitations in tesla**, not fractions: two rings at
8.09 T and 2.02 T share one table, so there is no single field strength to scale by. The
first N are the aperture a particle travelling *with* the design direction sees, the
second N the one it sees going against it.

The pusher must project onto the orbit anyway for the aperture test, so it passes the
orbit frame along rather than throwing it away.

## One world, one particle array, one backend

This is the load-bearing decision and everything else falls out of it. There is **one**
field table, **one** aperture table and **one** `BeamState` for the whole complex, and a
particle does not belong to a machine — it is at a place, and it feels whatever is at
that place.

What that buys, all of it for free:

- **Extraction, transfer and injection are one continuous flight.** Nothing is handed
  over. A bunch leaves the injector because its sector stopped bending it, and arrives in
  the collider because it flew there.
- **Several beams are several particles.** A batch is a macro-particle; injecting again
  adds one. Twelve of them is a nominal fill and 352 MJ.
- **A counter-rotating beam is a particle pointing the other way** — see the bore rule
  below. Not a special case anywhere.
- **A dump is a line that ends in a block** instead of in a ring.

`Machine` is a ring's lattice, its circuits and the energy programme it is running. It
owns no beam. Its only relationship to a particle is **capture**: if its RF programme
matches the particle's momentum to 2 %, that ring holds that particle's energy and ramps
it; if not, the particle keeps the energy it has and is bent by whatever field is there.
That single rule is why there is no injection interlock — inject into a ramped machine
and watch a 450 GeV batch meet a field set for 6.8 TeV.

The one thing this design costs: `projectToOrbit` now scans a table covering everything,
so the hint (`OrbitFrame.element` from the last step) matters more than it did, and it is
only trusted well inside the hinted pipe.

## Capture is a state, not a per-frame test

The RF either has a bunch in a bucket or it does not, and once it does it drags it up the
ramp. The 2 % momentum window is consulted only when a particle *enters* a machine; asking
again every frame makes the answer depend on the frame rate (see `lessons.md`).
A ring that fails to capture a bunch does not accelerate it, and bends it with whatever
field it is running — which is the whole of the "do not inject into a ramped machine" rule.

## The bore rule: how one ring carries two beams

A twin-bore dipole is two apertures in one cold mass with **opposite** field. So which
bore a particle is in is decided by nothing more than **which way it is going relative to
the design direction of the element it is on** (`OrbitFrame.tx`), and the field it sees is
`scales[k]` or `scales[N + k]`. A beam going the other way round the ring is bent
correctly, and there is no per-particle "which beam" field anywhere.

A single-bore machine — the injector, every transfer line — gets the *same* field in both
halves, so a particle going the wrong way through it is bent the wrong way and dies. That
is not a bug, it is the difference between the two kinds of machine, and `npm run check`
asserts both halves of it.

Kickers act per aperture, which is why dumping beam 1 does not take beam 2 with it.

## A magnet only bends what is inside it

`FIELD_STRIDE`'s `owner` and `APERTURE_STRIDE`'s `owner` are the same id: machines and
lines each get one, and `integrateFieldZ` skips a sector whose owner is not the pipe the
particle is currently in.

This is not a nicety. The field region is an annulus hundreds of metres wide — it has to
be, to cover an aperture 3600× the real pipe — and a transfer line arriving tangentially
runs *inside* that annulus for the last kilometre of its approach. Without the owner
check the collider's arc grabs the beam being delivered to it and puts it in the wall
213 m short of the injection point. Which it did.

## One world, one clock

A turn is 89 µs and a ramp is 20 minutes; no single compression shows both, so there are
two scales and the HUD labels them separately. Never quietly fuse them.

- **beam clock** — 0.2 collider turns per wall second at the injector's 26 GeV flat bottom,
  0.5 at the collider's 450 GeV injection energy, 2 at top, interpolated on **rapidity**
  (y = artanh β ≈ ln 2γ). β moves two parts per million across the whole ramp and no honest
  display can show that; rapidity is the quantity that goes on adding up like a velocity
  after velocity has run out of room. So what is drawn is the additive velocity, and a beam
  twice as far up the ramp in rapidity is drawn going twice as fast.

  **Three anchors, not two**, since the injector started ramping. With the low anchor at the
  collider's injection energy the map clamped below it, so a 26 GeV batch and a 450 GeV one
  were drawn at identical speed — on the one machine whose whole job is to tell them apart.
  Extending the upper segment downwards is not an option either: rapidity(26) is far enough
  below rapidity(450) that the straight line goes negative before it gets there. The two
  upper anchors are untouched, so every measured number taken against them still holds.
- **The rate is per particle, from its own energy** (`World.stepRateFor` → `BeamState.rate`).
  The world offers iterations at the rate a top-energy beam needs and each particle takes the
  fraction of them its rapidity earns — one step stays one fixed length in metres for
  everybody, so a coasting bunch is integrated exactly as accurately as a ramping one rather
  than being given a longer step to look slow with. Measured: an injector bunch holds
  13.3 km/s of track across a full collider ramp while the collider goes 0.5 → 2.0 turns/s.
  Scaling *one global clock* by the collider's energy is what this replaced, and it made the
  injector — a machine that never ramps — visibly accelerate four-fold every time the
  collider did. It also made the injection interlock look broken: a bunch that had obviously
  "sped up" then died on the first dipole of the ramped ring it was sent into. Measured, and
  correct: a 450 GeV batch into a collider at 6.8 TeV is not captured and is in the wall
  1327 m later.
- **machine clock** — `opsTimeScale` = 200× real time, fixed, with no slider. A knob that
  changes how fast the machine runs changes what every number on the screen means. Drives
  ramps, powering, cryogenics, quench recovery, burn-off and the injector refill (21.6 s of
  SPS cycle = 0.11 s of wall time; the collider's ramp is ten thousand times longer, which is
  the point). The **injector's** ramp is the one thing 200× cannot serve — a real 4.3 s ramp
  is 21 ms of play, which is not a ramp anybody can watch — so it is stretched, and only it.
  See `limits.md`.

The world step is a **fixed length in metres** — the collider's circumference over
`stepsPerTurn` — so every machine is integrated at the same spatial resolution and the
injector, a quarter of the size, takes a quarter of the steps to go round. It really is
3.86× faster and nothing has to be done to make it so.

**Anything the machine waits for is timed on `World.elapsed`, not `performance.now()`.**
Wall-clock pacing keeps running while paused and runs at the wrong speed headless — `check`
puts twenty seconds of beam through in fifty milliseconds. Only the render flashes still use
the wall clock, and they are about what the eye has just seen.
