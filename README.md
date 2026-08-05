# LHC — beam playground

A browser toy about the Large Hadron Collider. Not a design code: it is a game, but the
numbers on screen are the real ones, so it should not embarrass a physicist.

```
npm install
npm start     # http://127.0.0.1:5173
npm run check # headless lattice + tracking sanity check
```

Space bar toggles pause. **Clicking a magnet chain switches that arc off** — watch what
happens next; click a quenched one to start it cooling. The collider starts *empty*: fill
the SPS, then throw its beam at the LHC, one batch at a time, either way round.

## What is actually simulated

* **The lattice.** 8 cells, each `straight section + arc`, every arc bending exactly
  2π/8, so the ring closes by construction — a rounded octagon, which is what the LHC
  is. ρ = 2803.9 m from 1232 × 14.3 m of dipole in a 26 658.9 m circumference. The same
  builder makes the SPS out of its own real numbers: 6 sextants, 744 × 6.26 m of dipole
  in 6911.5 m, ρ = 741.3 m, 2.02 T at 450 GeV.
* **The beam.** Macro-particles — one per SPS batch — pushed by the Lorentz force and
  nothing else, all of them in one array whether they are in a ring or in a transfer line.
  Inside an arc it sees B_z and its velocity rotates by ω·dt with ω = qB/(γm); between
  arcs there is no field and it flies dead straight. Rotation is exact, so |v| is
  conserved to machine precision and the integrator can never fake acceleration.
* **The beam pipe.** An aperture of ±250 m around the closed orbit — see below for why
  that number is knowingly wrong. Every step the particle is projected onto the orbit,
  and if its transverse offset exceeds the aperture it is in the wall and the beam is
  gone. Nothing keeps it centred: there are no correctors and no quadrupoles.
* **The powering.** Eight superconducting circuits, L = 15.1 H each, ramped at 10 A/s
  from 733 A (450 GeV) to 11 080 A (6.8 TeV). A cold circuit has no resistance, so the
  wall only sees power while the current is *changing*: P = L·I·dI/dt. That is why the
  clouds around the arcs bloom during a ramp and collapse at flat top, while the magnet
  colour (which follows the current, i.e. the stored field) stays put.

`npm run check` prints the numbers that matter next to the real machine's:

```
bend radius rho [m]   2803.93  (LHC: 2803.95)
T_rev [us]            88.925   (LHC: 88.92)
B [T]                 8.0895   (LHC @6.8 TeV: 8.09)
stored in beam [MJ]   352      (LHC: ~350)
```

## The one number that is deliberately wrong

The aperture. The real pipe is 29 mm; this one is ±250 m, four orders of magnitude out.
Here is the reasoning, because it is the only place the model lies on purpose.

A particle with no field on it flies straight, and leaves an aperture `a` after
√(2aρ) of flight. For a real 29 mm pipe on ρ = 2804 m that is **13 metres** — one pixel
on a ring 8 km across. So with a faithful aperture, switching a magnet off would make
the beam vanish into the wall on the spot, and the single most important thing this
simulation has to show — that the circle is not magic, it is eight arcs of dipoles, and
without them the beam goes straight — would be invisible.

At ±250 m the same straight line runs for 1.2 km before it touches the wall, and the
aperture it crosses is ~20 px tall. Measured, with a sector switched off at injection:

```
survived              0.21 turns / 0.52 s of wall clock
straight flight [m]   4152 from the arc entrance before touching the wall
  drawn as            332 px on a 1280x860 canvas
  a real 29 mm pipe   13 m
```

(4152 m rather than 1180 m because the field does not vanish when you flip the switch —
the coil is still at 600 A on the way down, so the beam is still being bent, just not
enough.)

Everything else stays honest. The true transverse offset is reported in the HUD in
millimetres, next to what a real ±28.9 mm pipe would have made of it, so the
`integration` slider still tells you the truth:

```
 steps/turn   max offset   of ±29 mm pipe   verdict
       4800       3.36 mm             12 %   circulating
       2400      10.10 mm             35 %   circulating   <- default
       1200      32.27 mm            112 %   circulating here, lost in a real pipe
        600     174.98 mm            605 %   circulating here, lost in a real pipe
        200    1620.65 mm           5608 %   circulating here, lost in a real pipe
```

At the default the orbit is flat: max offset 10.07 mm on turn 1 and 10.07 mm on turn 2000.
The push costs about 370 µs per 1000 particle-steps; at 6.8 TeV one beam asks for 242
steps a frame, and the injector — a quarter of the size — takes a quarter of a turn per
world step, because there is one clock and the step is a fixed length in metres.

## Injection, two beams, and the dump

The **inject** buttons do not put a beam anywhere. There is no such operation.

A collider does not make its own beam. Protons reach the LHC through a linac and three
synchrotrons, and the last of them — the SPS — is a real ring with a real beam going round
it. So there are two machines here, four lines between and out of them, and **one array of
particles pushed by one backend against one field table**. Everything else follows:

* **fill SPS** puts a batch in the injector.
* **→ LHC beam 1** arms the TI 2 extraction kickers. They fire when the bunch next reaches
  the extraction point — up to a full SPS turn of waiting, because a kicker that goes off
  *inside* the bend cuts it short and throws the bunch at the wall, which is why the real
  ones are synchronised to the revolution frequency. The bunch is then not bent by that
  sector, carries straight on down the tangent, crosses 2.7 km of transfer line with a
  beam pipe around it, and the LHC picks up whatever arrives. Nothing is handed over.
* **→ LHC beam 2** does the same down TI 8, which arrives pointing the other way round the
  ring. That is the whole of what makes it the counter-rotating beam.
* **dump beam 1 / beam 2** fire the kickers at Point 6, one out of each end of the same
  straight, into 700 m of line ending in a block of graphite.

Batches stack. A nominal LHC fill is 12 SPS batches, and pressing the button twelve times
really does get you to the 352 MJ the reference numbers quote.

Nothing is ever greyed out. An earlier version refused to inject into a ramped machine, on
the grounds that the transfer line is set for 450 GeV and the beam would be lost. That is
true, and it is also the most instructive thing in the machine — so the rule lives in the
physics instead: a ring captures a beam only if its RF programme matches that beam's
momentum, and a 450 GeV batch arriving at a machine set for 6.8 TeV is simply bent fifteen
times too hard until it reaches the wall.

### How one ring carries two beams

A twin-bore dipole is two apertures in one cold mass with opposite field. So which
aperture a particle is in is decided by nothing more than which way it is travelling
relative to the design direction of the pipe it is in — and the field it sees is the one
for that aperture. A second beam going the other way is bent correctly, and there is no
"which beam" flag anywhere in the code.

The injector is single-bore. Send a beam backwards round it and it is bent the wrong way
and lost, which `npm run check` asserts alongside the collider case:

```
beam 1, 2000 turns   max orbit offset 10.07 mm
beam 2,  200 turns   max orbit offset 10.04 mm
backwards in the SPS lost, as it must be
```

Kickers act on one aperture, so dumping beam 1 leaves beam 2 circulating.

### Quench

A superconductor is only superconducting below a surface in temperature, field and
current. A beam hit puts megajoules into a coil with about a kelvin of margin, so it goes
normal, and then a gigajoule of stored field has to go somewhere in seconds. What happens,
in order: the joules land in the cold mass; the margin is checked against the load line,
which closes as the current rises, so the same hit is survivable at injection and fatal at
flat top; a resistive voltage appears and has to be told apart from the inductive one;
quench heaters drive the *whole* coil normal on purpose so the energy is spread rather
than boiled into one spot; the breaker opens and the current decays into the extraction
resistors. The sector goes red, the bend goes with it, and the beam is lost.

```
margin at nominal current   1.05 K
one batch at flat top       29.3 MJ into a 4235 t cold mass  ->  quenches
coil after the heaters      26 K
current                     11080 A -> 35 A through the extraction resistors
```

Click a quenched magnet to start it cooling back to 1.9 K. That takes 8–12 hours in
reality and twenty minutes of machine time here, which is the one number in the chain that
is compressed rather than real; the detection delay is the other.

### Where the lines come from

`placeInjector` moves the whole injector ring so that TI 2 is a pure drift — aimed by
construction, landing on the collider's injection point with zero error. Every line after
that has both ends already fixed and has to be steered, so `line.ts` solves drift→bend and
drift→bend→drift→bend and keeps the shortest route that does not cross a ring. Those bends
are real dipoles on real circuits; switch one off and the beam does not arrive.

Ahead of the SPS the chain is drawn at true scale and carries no simulated beam: the PS
(628 m), the Booster (157 m) and Linac4 (86 m). To scale, the machine that actually makes
the protons is 86 metres of a picture eleven kilometres across.

## Switching a magnet off

Click a magnet chain. The circuit opens, but 15 H holding 11 kA cannot go dark on
command — the current decays through the extraction resistors with a 104 s time
constant, and the field with it.

There are no quadrupoles anywhere in this ring, so nothing restores the orbit. The beam
enters the weakened arc, is under-bent, and drifts steadily outwards across the aperture
until it reaches the wall about a fifth of a turn later — visibly, in half a second of
wall clock, which is the point.

Note what does *not* change: the beam energy. The RF holds it. That is why the beam
momentum in this model follows the ramp programme rather than the average of the
circuits — a dead magnet stops bending the protons, it does not slow them down.

## Damage

Where the beam hits, it does not stop at the surface. A proton starts a hadronic shower
that develops over a few interaction lengths, and a *beam* does far worse: the leading
bunches vaporise the material and the rest fly down the channel they made. That is
hydrodynamic tunnelling, and it is why the LHC beam is quoted as able to drill tens of
metres into copper.

```
 E [GeV]   deposited     depth      peak T      verdict
   450       23 MJ      2.9 m      7456 K   vaporised
  1800       93 MJ      9.2 m      9315 K   vaporised
  6800      352 MJ     35.2 m      9218 K   vaporised
```

The two constants in `damage.ts` are calibrated, not derived — they reproduce ~35 m for
a full 6.8 TeV beam and ~3 m at injection. The temperature is then just the energy over
the heat capacity of the channel it made. It does not cool: the heat cloud is a mark of
what the beam did, and a mark that fades is a mark you miss. On screen: a channel driven
along the direction of travel, the material around it glowing on the blacksmith's scale,
and a scar that survives re-injection. The channel is drawn 24× longer than it is — 35 m
is four pixels on this ring — while the metres in the HUD are the real ones.

## Two clocks, on purpose

A revolution takes 89 µs and a ramp takes 20 minutes; no single time compression shows
both. So there are two, and the HUD labels them:

* **beam clock** — extreme slow motion, `secondsPerTurnAtInjection` of wall time per
  turn at 450 GeV (default 2.5 s).
* **machine clock** — `opsTimeScale`× real time (default 60×), drives ramps and power.

The beam is paced by the proton's *proper* time: a fixed amount of it per wall second.
Lab time runs γ times faster, so the comet visibly accelerates through the ramp while
the physics stays exactly what it is — the true speed does almost nothing:

```
 E [GeV]   1-beta      s/turn   turns/s
   450   2.17e-6    2.500     0.40
  1800   1.36e-7    0.625     1.60
  6800   9.52e-9    0.165     6.04
```

Pacing on lab time would be honest and useless: a 2 ppm change in |v| is not something
you can watch. The tail is allowed to stretch with the speed (capped at 0.4 turn), which
is the other half of the cue.

## Structure

```
src/sim/
  lattice.ts    ring geometry -> flat field + aperture tables (GPU-buffer layout)
  field.ts      B_z sampling; the WGSL twin lives in the same file
  aperture.ts   beam pipe: projection onto the closed orbit, same deal
  beam.ts       particle state, structure-of-arrays
  backend.ts    compute backend contract + registry
  backends/     cpuBackend.ts (reference), webgpuBackend.ts (stub + shader)
  powering.ts   magnet circuits: current, stored energy, power
  machine.ts    one ring = lattice + powering + beam + backend
  complex.ts    two rings + the transfer line + the injection sequence
src/render/     canvas layers: machines, power clouds, comet trails
src/ui/         HUD panels and controls
```

### Why it is built this way

* **GPU portability.** Particle state is SoA typed arrays, the lattice is a flat f32
  table, and the field sampler is written so it translates line-for-line into WGSL —
  `FIELD_WGSL` in `field.ts` is that translation, already written. Everything particle
  related goes through `SimBackend`, so a WebGPU implementation drops in and the
  backend selector in the toolbar benchmarks it against the CPU on the same workload
  (`µs / 1k steps` in the compute panel).
  One trap is documented in `webgpuBackend.ts`: positions run to ~10⁴ m and we care
  about millimetres, which is at the edge of f32 — the GPU version has to keep
  positions relative to the sector centre.
* **Beam dump / quench.** Losses already exist and are already localised: a `BeamLoss`
  carries the impact point, which arc it happened in, and how many joules went into the
  wall. `MagnetCircuit` has `state`, `temperature`, `loadLine` and an extraction time
  constant, and the renderer already draws a `quenched` circuit in red. A quench is now
  the rule that connects the two.
* **One world.** There is one field table, one aperture table and one particle array for
  the whole complex, and a particle does not belong to a machine — it is at a place and
  feels whatever is at that place. Extraction, transfer and injection are therefore one
  continuous flight with nothing handed over; several beams are several particles; a
  counter-rotating beam is a particle pointing the other way; a dump is a line that ends
  in a block. Everything structural in the renderer is measured in units of a ring's own
  aperture, so a ring a quarter of the size is drawn a quarter of the size, walls and
  magnets and all.
* **A magnet only bends what is inside it.** Sectors and pipes carry the same owner id.
  The field region has to be hundreds of metres wide to cover an aperture 3600× the real
  pipe, and a transfer line arriving tangentially runs inside that annulus for the last
  kilometre — without the owner check the collider's arc grabs the beam being delivered
  to it and puts it in the wall 213 m short of the injection point.

### Field integration, a subtlety worth keeping

The field is weighted by the fraction of each step that lies inside the arc rather than
by a hard in/out test. With a hard test the bend of every arc is quantised to a whole
step — about 4 mrad, which is a colossal kick — and it is systematic, so the orbit
spirals out and the beam is lost within a few turns. With fractional weighting the
orbit is flat to sub-millimetre over thousands of turns at 2400 steps/turn.

## Not there yet

No beam dump — though the dump kicker is the same shape of thing as the extraction one,
so it should reuse it. No quench yet, only the hooks for it. The SPS sits at flat top:
its own 26 → 450 GeV ramp and its warm, resistive magnets (which cost I²R, a term the
powering model does not have) are not modelled. A real fill is 12 SPS batches into
different RF buckets; here there is one macro-particle per ring, so one extraction is one
fill and a new one replaces what was circulating. No RF, no quadrupoles (a dipole-only
ring is weakly focusing in the horizontal plane, which is all this 2D view has), one
beam, one bunch, no collisions.
