# Collisions: detectors, luminosity, phasing, and what an event display is

`detector.ts`, `updateCollisions` in `world.ts`, `buildCollision` in `shower.ts`, and the
interaction region in `renderer.ts`.

## A detector is a piece of machine, not a scoreboard

Both beams run on the **same closed orbit** — which bore a particle is in follows from the
direction it is going — so a forward and a reverse bunch pass through each other's position
twice a turn and nothing happens, because there is a cold mass between them. An experimental
insertion is where the two bores are brought into one chamber. So "collisions happen in the
detector" is not a rule imposed on the model; it is the only place in the model where a
crossing is anything at all.

**Two insertions, exactly half a ring apart, and that is forced.** Two counter-rotating
bunches meet where their arclengths agree, at `(s₁+s₂)/2` — a quantity defined modulo C/2 —
so there are two meeting points per turn and they are always antipodal. One phase adjustment
therefore serves both, which is why ATLAS (P1) and CMS (P5) face each other on the real ring.
Here P1/P5 are taken (beam 1 injects at P2, beam 2 arrives at P8, both dumps leave P5), and
**P3 and P7 are the only free antipodal pair**.

**They are ATLAS and CMS standing at the wrong addresses, and the address is the only thing
faked.** An unnamed box identifies nothing and cannot: the two general-purpose experiments are
two particular machines, built around different things, and that difference is the reason
there are two of them — so it is modelled (see the trigger, below) and it needs the names to
mean anything. What cannot be had is their points, which are taken. Both are drawn and printed
with their point beside them — `ATLAS · P3`, `CMS · P7` — so nothing is hidden. See
`docs/limits.md`.

**A macro-particle is 1754 m long, and that is what makes the whole thing tractable.** One
batch is 234 bunches at 25 ns. Two batches therefore do not meet at a point: every bunch of
one meets every bunch of the other somewhere, spread over a batch length. A bunch pair is
colliding at an interaction point exactly while **both batches are covering it**, and
everything follows from that one geometric statement with nothing to tune:

- bunch pairs meeting there per turn = `(L − 2|δ|)/25 ns`, triangular in how far from the IP
  the batch centres cross, zero at half a batch — 877 m. That 877 m is the target;
- 12 batches each way, head-on, is 12 × 234 = **2808** pairs, the nominal number;
- during a burst a pair meets every 25 ns, so the luminosity is the 40 MHz one; a pair covers
  a given IP for 6.6 % of a turn, once per turn (the other crossing that turn is at the other
  detector), and the turn average comes out at **1.2e34 cm⁻² s⁻¹**. Nothing writes that down.

**Luminosity is computed, not sampled.** Asking "are two batches on the IP right now" once a
frame is the obvious implementation and it is wrong: the burst is two frames at 60 fps and
whether the frames land on it depends on the frame rate. Measured — a nominal fill read
9.1e33 instead of 1.2e34, and would read something else again on a slower machine. The closed
form is exact and is what a real machine quotes anyway. The geometric test survives for one
job: deciding when to draw an event, which *should* happen in bursts.

## Burn-off is what consumes beam, and it takes population only

Two protons leave the machine per inelastic interaction and nothing puts them back, which
gives a 46 h fill lifetime on the **machine** clock — about a quarter of an hour of play, and
measured: one head-on pair runs 100 % → 96.5 % → 87.5 % → 73.6 % of a fresh batch over 0, 30,
120 and 300 seconds.

**What a burning fill loses is protons and nothing else.** The RF holds the energy, so `gamma`
is untouched by burn-off — `check` asserts it does not move — and the protons still circulating
are exactly as energetic as they were. That constrains the drawing completely: intensity moves
the comet's *width* and *brightness*, which is what a beam-current transformer would show, and
must not touch its colour temperature or its speed. A beam drawn redder or slower as it burns
would be saying the collisions had softened it, which is the one thing they do not do.

Floored well above zero (`0.34 + 0.66 f` on width): a batch burned down to a tenth is still a
batch and still has to be findable on the ring. The number itself is in the HUD; this is the
shape of it.

**One other thing consumes beam, and it obeys the same rule.** A vacuum incident — beam–gas
scattering — multiplies the loss rate for a while (`World.vacuumFactor`), which is a real
mechanism and takes population in exactly the same way: the protons still going round are
exactly as energetic, and nothing about the drawing changes. It is also what makes "when do I
dump this fill" a question with a different answer on different fills. See `running.md`, which
is also where the lifetime this implies gets turned into an optimum fill length.

**Whether two beams collide is a question about geometry, not about capture.** `gatherBunches`
asks where a particle is, not which ring's RF is holding it. Asking about capture made the
luminosity flicker: a circulating bunch passing the mouth of a transfer line is claimed by
that line's pipe for a frame or two, `updateCapture` drops it to free flight, and it vanishes
out of the snapshot — measured, a nominal fill reading three quarters of its luminosity
because two or three of its twenty-four batches happened to be passing a junction.

## Collisions cost the machine, and the cryogenics is a capacity

Every interaction releases √s and most of it goes straight down the pipe into the
superconducting magnets that squeeze the beams together. The power falls out of numbers
already here — L × σ_inel interactions a second, each carrying 13.6 TeV — and at nominal that
is **2.1 kW**, of which about 40 % reaches the coils. A little under a kilowatt a side, which
is what the real inner triplets are quoted at, and one of the reasons the real machine needs
new ones to run brighter.

Cooling is a **capacity, not a rate**, and that is the whole character of it: a refrigerator
at 1.9 K removes so many watts and no more, so below that the cold mass sits at the operating
point however hard you run, and above it there is no equilibrium to find — it simply climbs.
Measured, per insertion, against `INSERTION_COOLING` = 1800 W:

```
 6 + 6 batches    6.02e33     419 W    holds at 1.90 K
12 + 12           1.20e34     839 W    holds at 1.90 K   <- nominal
18 + 18           2.36e34    1649 W    holds at 1.90 K
24 + 24           4.16e34    2903 W    over capacity, quenched inside two seconds of play
```

So a fill can be pushed past what the insertions can be cooled at, which is the real trade at
the real place on the scale. **The only consequence modelled is the readout**: the triplet
quadrupoles that would go normal are not in this model, because there are no quadrupoles in it
at all. Cooling back from 40 K takes 18 s of play.

## Phasing: how the beams are made to meet where the experiments are

The crossing point is set by the relative phase of the two beams. **One control does it, and
it is cogging** — injection used to hold for a phase as well, and no longer does.

**Why injection does not aim any more.** The phase a batch can be delivered at is quantised.
Nothing that happens while the bunch is in flight can change where it will meet the other beam
— every particle here covers the same path length per unit time, so as the bunch closes on the
kicker its remaining flight shortens by exactly as much as its target moves — and the only
lever is which pass of the injector to fire on. Waiting a whole injector turn steps the
eventual crossing point by one injector circumference, so the reachable phases are a **grid,
about 430 m across**. That is a real number: it is what the LHC being very nearly 27/7 of the
SPS does, and it is why the two machines' RF is locked rather than left to chance.

Hunting a grid that coarse is a lottery and it was one: measured, the same fill held 1.2 s once
and 8.9 s the next time, up to 13 s when the window was tight, with the machine visibly doing
nothing and the readout unable to say why. What it bought — landing inside the batch overlap —
is a second of cogging at flat top. So the pulse fires as soon as it may: measured, **0.25 s**,
against 1–9 s. The batch lands wherever the grid put it, typically kilometres from an IP, and
the operator cogs it on.

**One thing injection still holds for: a batch must not land on top of one of its own.** A
batch is 1754 m long, so two of them less than that apart are the same stretch of beam. Without
that rule every batch after the first landed at the same place in the ring, a fill went into
one bucket, and one dump pulse took all of it. `bucketState` tests exactly that, and unlike the
phase it never relaxes — landing off the bucket costs luminosity and cogging takes it back;
landing on top of a circulating batch cannot be undone by anything. This is what a filling
scheme is.

**Cogging** does all the aiming. It trims one beam's revolution frequency, which is the only
way to move where two beams meet; a slip of `u` metres moves the crossing by u/2. Measured at
`COG_TRIM` = 4 %: 268 m of ring per second at injection and 1065 m at flat top — the beam is
drawn going four times faster there.

`autoCog()` walks it on and stops, and it has to cross more ring than it used to: the crossing
point can start anywhere on the half-ring it is defined over, measured at 5.8 km. At the
operator's trim that is 22 s at injection energy, which is the dead time the phase hunt was
removed for, moved one control along. So the loop runs a harder slip — `COG_TRIM_FAST` = 14 %
— until it is within `COG_APPROACH` = 400 m, and then drops to `COG_TRIM` for the approach,
because a frame of its own motion is the finest it can aim. Measured, worst case: **7.2 s at
injection energy, about two at flat top.** The manual buttons keep `COG_TRIM`, because the feel
of that control — beam 2 visibly crawling against beam 1 — is the reason it is a control and
not a checkbox. Its stopping threshold is derived from one frame of its own motion rather than
fixed, or it works at one energy only.

**Cogging always slows a beam and never speeds one up.** `rate` is the fraction of the
world's iterations a particle takes, the world offers them at the rate a *top-energy* beam
needs, and the backend's accumulator advances a particle at most once per iteration — so any
rate above 1 is silently thrown away. At flat top a captured beam is already at exactly 1, so
speeding it up did nothing and cogging worked in one direction only, at one energy only. A
frequency trim is relative anyway: to move the crossing one way slow beam 2, to move it the
other slow beam 1.

A real machine trims by parts per million over minutes; four per cent is what makes beam 2
visibly crawl against beam 1 while the control is held.

`inject immediately` is kept as the demonstration: the batch lands at whatever phase it lands
at, the beams meet out in the arcs, and the experiments see nothing at all.

## What is drawn, and why it is drawn from live positions

**The interaction region is drawn on the ring, from where the batches actually are** —
`World.overlaps`, rebuilt every frame. Two batches passing each other interpenetrate over the
intersection of the two 1754 m stretches they occupy: an interval centred on the crossing
point that opens from nothing, grows to a whole batch length and closes again. While it is
open, a bunch of one beam is meeting a bunch of the other at *every* point of it, evenly — so
the band is drawn evenly, and it is a picture of the state rather than a diagram of it. That
is the whole of the feedback for cogging, which is why it is on the picture and not in the HUD.

Two arcs shorter than half a ring intersect in at most one interval, so a pair has one of
these at a time: the antipodal crossing is the *same* pair half a turn later, and the two
experiments therefore flash alternately rather than together. **The crossing point is marked at
both antipodes**, because a crossing point is defined modulo C/2 and both are real. Drawing one
band, permanently, at the crossing nearest IP3 — which is what this used to do — left it
sitting on IP3 while the events flashed at IP3 *and* IP7, so the far experiment lit up with
nothing drawn near it. There was beam there; the picture was not showing it.

**The part of it inside an insertion is drawn bright and the rest dim**, and that is the point
of drawing it at all. A meeting out in an arc is nothing — separate bores — so the only
stretch worth anything is the stretch lying inside a detector. What changes with the phasing is
how many bunches meet there — so the **rate** of event displays follows `Detector.headOn`, not
their brightness. A badly phased experiment does not see weaker collisions, it sees fewer of
them, because a collision is a collision.

**It is drawn as a beam, because that is what it is.** It used to be mint green and
`DETECTOR_RADIUS_F` wide — exactly the half-height of the drawn detector — so inside an
insertion it read as a green slab filling the experiment's box: a colour nothing else in the
machine uses for beam, at a width that says "this volume is lit" rather than "these two beams
are lying on each other". It is now the beam's own blue-white, a little wider than one beam
where it is collected and thinner and dim where it is not. `check:render` keys on those two
colours.

**And a collision is drawn where the bunches met, not at the middle of the detector.** Over a
pass every bunch of one batch meets every bunch of the other, and those meeting points are
triangular about the crossing with a half-batch of reach; clipped to the insertion, that is the
distribution a vertex is one sample of (`sampleMeeting`). So a phased experiment puts its
events on the interaction point and a mis-phased one puts them against the far end of its
detector, scattered. Measured, for a ±550 m insertion: a crossing on the IP draws vertices at
a mean of −9 m spread over ±380, one 300 m off draws them at +138 m, one 600 m off at +275 m.

Two things make this the right thing to draw rather than a liberty. The *instantaneous* window
is not: it is a sliver at the moment the region first reaches into the detector, so every flash
would land at the same end of the box and which sliver it was would depend on the frame the
edge was noticed on — a frame-rate dependence of exactly the kind the luminosity computation
exists to avoid. And on the real machine this scatter is a few centimetres and the insertion is
a point; it is visible here only because a detector is drawn twenty times its true size, which
is the same magnification that lets the interaction region cross part of one. Once an insertion
is a *stretch* of ring in this picture it has to be treated like one consistently, and
`INSERTION_HALF_LENGTH_F` in `detector.ts` is that stretch — the box the renderer draws and the
volume a vertex may appear in are one number.

## A collision event is the same cascade, started differently

`buildCollision` shares the loop with `buildShower` — same tree, same species, same
hardest-first budget. What differs is the start and the material:

- **not one proton driving into copper, but seventy leaving a point at once.** An inelastic pp
  collision is generated **flat in rapidity**, which is the one rule that makes it look like
  anything: a track's direction in the plane this simulation draws — which contains the beam
  axis, so it is the r–z view an experiment puts on the wall — is `(sinh η, pT in plane)`.
  Hence a dense spray along the pipe both ways with a scatter of central tracks across it.
  Multiplicity is `dN_ch/dη = 6.2 at 13.6 TeV` scaling as `(√s)^0.23`: measured, **75
  primaries at 13.6 TeV and 41 at 900 GeV**, which are the real numbers.
- **the pT spectrum has two components, because a real one does.** A soft exponential of mean
  0.55 GeV for the bulk, and a power-law tail from hard parton scattering. An exponential
  alone means *nothing* ever comes out above a few GeV — e^(−30/0.55) is not a small number,
  it is zero — and the hard tail is the entire reason anybody built the machine.
- **what a track is depends on how hard it is**, which is the one thing about a collision that
  really does scale with energy. Making a particle costs energy, so the heavier and rarer the
  thing, the more transverse momentum the collision had to have: below a GeV it is a pion and
  so is almost everything; a kaon carries a strange quark and costs a little more; charm and
  beauty are only made in a hard scatter, fly a few millimetres and decay to a muon a tenth of
  the time (which is emitted, inside the jet — a signature in itself); and an isolated lepton
  above ten or twenty GeV means, in practice, a W or a Z. That is what a trigger is built for
  and it is drawn white, thick and brightest.

  Measured over 400 events at 13.6 TeV, the hardest object was a pion 45 % of the time, a
  photon 30 %, a b/c jet 12 %, a kaon 11 % and an isolated lepton 3 %, with the tail reaching
  40+ GeV. **The shape and the ordering are real; the rate of the rare ones is not** — a real
  inelastic event contains a W about once in ten million. That is a drawing budget of the same
  kind as the 256 segments, and `check` prints both.
- **the first 42 % of the radius is transparent** (`TRACKER_RADIUS`, and the cascade's
  `transparentRadius` argument). A tracking volume is deliberately built to weigh nothing, and
  that single rule is why an event display is clean tracks radiating from a vertex with a spray
  only where the calorimeter starts. Without it every track branches within centimetres of the
  vertex and the event is a blob.

The event is built in **units of the detector radius**, and those radii are the *drawn*
detector's, standardised — an 11 m detector whose tracker reaches 1.15 m draws the tracker as
a dot. They live in one list, `DETECTOR_SHELLS` in `shower.ts`, read by three things: the
renderer draws its boxes from it, the cascade stops treating matter as transparent at its
first entry, and the transverse display bins its calorimeter cells between its entries. They
were three copies of the same four numbers and `check:render` existed to assert that two of
them still agreed; now there is nothing to disagree. The true metres (11 m radius, 22 m
half-length) are quoted in `shower.ts` and printed by `check`.

## Two views of one collision, and why there have to be two

The display drawn on the ring is **r–z** — a plane containing the beam axis, which is the view
an experiment puts on the wall. It is right for *where* a collision happened, and it cannot
show anything else: projecting onto that plane throws φ away and lays every track's transverse
momentum flat in the picture whether it was there or not.

So each experiment also has an **r–φ display of its own** (`buildTransverse`, drawn by
`render/eventDisplay.ts` into the panel `ui/eventPanel.ts` builds), looking straight down the
pipe. It gives back what the other view cannot show, and it is what a detector is built
around:

- **tracks curve inside the solenoid and run straight outside it.** A charged particle in the
  tracker is on a circle of radius pT/(0.3 B); reading that sagitta is how a tracker weighs
  anything. The field stops at the coil — out there the barrel bending is a *toroid*, which
  bends in r–z and not in this plane — so one track is a curve for the first 42 % of the
  radius and a dead straight line for the rest. That kink is real, and it is where the
  momentum measurement ends.
- **the tracker is layers, and what it gives you is hits.** Four pixel layers, four strip
  layers and a straw tracker. A track is not a line anybody drew: it is a fit through the dots
  it left. A neutral leaves **none at all**, which is how a photon is told from an electron
  and is the most legible piece of physics on the picture — calorimeter energy with nothing
  pointing at it. Measured at 13.6 TeV: 383 hits from 48 charged of 75 particles.
- **the calorimeter is cells in depth as well as around.** A particle deposits in a tower at a
  particular φ — rotated away from the one it left the vertex at, by exactly the bend, and
  that rotation *is* the measurement — and at a particular *depth*. An electromagnetic shower
  peaks in sampling 2 and is finished; a hadron leaves a third of itself spread through the EM
  calorimeter and punches into the tile behind it. **Longitudinal segmentation is what
  separates the two**, which is why there are four EM samplings and three tile samplings and
  not one ring each. Measured, EM samplings 1–4: 2 / 6 / 13 / 5 GeV.
- **showers have a width.** An electromagnetic one is a couple of cells, a hadronic one is
  wider, so a photon reads as a spike and a jet as a clump. Everything into one cell drew
  spikes for both and lost the one difference between them the eye gets at a glance.
- **what stops where, out to the muon chambers.** Photons and electrons are absorbed in the EM
  layer, hadrons drive into the hadronic one, muons go through everything — three stations
  outside eight toroid coils, and a thing that lights all three has been through eleven metres
  of lead and steel. A chamber hit is drawn as a mark and not a brightness, because it is a
  fact and not an energy.
- **the hard objects are named**, on the picture and in the panel: one character and a
  momentum at the end of the track, with `°` for a neutral.

`BARREL` in `shower.ts` is that structure — 22 layers — and its *group* boundaries are
`DETECTOR_SHELLS` exactly, because those four numbers are what the cascade, the ring renderer
and the vertex volume are all built on. `check` and `check:render` both assert the two still
agree, and that no two layers overlap.

**One generator, two projections.** `generatePrimaries` produces the particle list once and
both views are built from it with the same seed, so the panel cannot show a lepton the ring
never saw; `check` asserts the primary count and the hardest object agree. Charge is derived
from the primary's *index* rather than from a random draw, deliberately: the sequence pulled
out of the LCG is what makes the two views the same event and what every collision number in
`check` was measured against, so a draw inserted in the middle of it would silently re-roll all
of them.

**Two standardisations, and they work together.** The drawn radii are not the real ones — a
real tracker is a tenth of the detector's radius and would draw as a dot with eight layers
inside it — so the shells keep their real *order and grouping* and are spread out to be
resolvable. The **bend is then standardised on the tracker**: a track's drawn radius is its
real radius scaled by the factor taking the real 1.15 m tracking volume to the drawn
`TRACKER_RADIUS`. That makes the one question this view exists to answer come out exactly
right — *which tracks curl up inside the tracker and never reach the calorimeter* — because
both sides of that comparison scale together. Measured and printed: **0.345 GeV/c to escape
the tracker**, which is the real number for 1.15 m at 2 T, and at 13.6 TeV **23 of 75
primaries never get out**. A looper deposits nothing, which is the point of it.

Every primary deposits; only the hardest 56 above 0.3 GeV/c are *drawn*. A hundred spiralling
200 MeV tracks on top of each other is a disc, not a display, and a real event display applies
exactly this cut for exactly this reason.

## The trigger: what to do with a billion collisions a second

A running insertion sees about a billion inelastic collisions a second and can write about a
thousand. Drawing them as they come — one flash every half second, each replacing the last — is
not a display of anything; it is a strobe, and nothing can be read off a picture that is
replaced before it has been looked at. All the eye takes from it is that collisions are
happening, which the luminosity readout already says in a form you can compare.

What a real experiment does with that flood is the answer, and it is one of the central facts
about the machine rather than a workaround: it **triggers**. Almost every collision is a spray
of soft pions nobody has ever wanted to look at; what a trigger catches is the rare event with
a high-pT object in it, because that is the only kind that can contain something not already
known. So `Detector.offer` takes a candidate only if its hardest object clears the bar, the bar
becomes whatever was last kept, and it **decays** back to `TRIGGER_MIN_PT` = 2 GeV over
`TRIGGER_DECAY` = 4 s — or the first lucky 40 GeV lepton would freeze the panel for the rest of
the session. The transverse event is built only for what is kept, which is the same argument a
real readout makes about bandwidth.

**The two experiments do not keep the same events, and that is what a detector is.** A trigger
is built out of the thing behind it: CMS is a solenoid wrapped in muon chambers — the name is
the design — and its muon thresholds reach lower than anybody else's; ATLAS's liquid-argon
calorimeter is what its electron and photon menu was built on. So `Detector.priority` weights
the pT that decides what is kept by `TRIGGER_SPECIALTY_GAIN` = 1.8 for the species that
experiment was built around, and one beam fills the two panels with visibly different physics.
The panel prints the **stream**, not the species — `single-μ`, `single-e`, `γ`, `b-jet`,
`strange`, `jet` — because a readout does not write "an event", it writes one into a stream
named for whatever fired the trigger, and that name is the whole of what identifying a particle
is for. What is a departure is the gain itself: a real menu is a hundred lines of thresholds,
prescales and isolation cuts, and this is one multiplier with the shape of that and none of the
substance. See `limits.md`.

Measured, six pairs colliding over thirty seconds of play: about 15 candidates offered per
insertion, 7 to 9 kept, and each one picked out of ~5e10 interactions. The panel prints that
denominator, because it is the point. **A panel does not exist until its experiment has
triggered on something** — see `rendering.md`; before the first event there is nothing to
hold the space for. (A real trigger's one-in-40 000 is a different ratio —
it counts against every interaction, and this simulation only builds a cascade for a handful
of them. The honest reading of "1 in 6.6e10" is *this event was picked out of that many*, not
that the trigger here is better.)

**No vertex glow.** There was one — a green radial gradient most of an aperture across, painted
over the interaction point on every event. It buried the thing it was marking, since the tracks
*are* the vertex and they all start there, and because a pass draws an event roughly every half
second what the eye saw of a running experiment was a detector filling with green wash and the
beam physics going dim underneath it. `check:render` now asserts no gradient is filled over a
vertex — excluding the beam heads by name, because a colliding batch is *at* the interaction
point by definition and the beam must be allowed to be drawn where the beam is.

## Traps found here

- **A line's `config.bore` is the aperture it uses in the machine it *leaves*.** Both transfer
  lines leave the injector forwards; TI 8 is beam 2 because of where it *arrives*, entering
  its collider straight backwards. Reading `bore` as "which beam this becomes" had TI 8 hunting
  for a partner among the batches going its own way, finding none, and firing unsynchronised
  every time. The question has to be asked of the arrival: the line's exit direction against
  the collider's design direction there.
- **Anything the machine waits for must be timed on `World.elapsed`, not `performance.now()`.**
  Wall-clock pacing keeps running while paused and runs at the wrong speed headless — `check`
  puts twenty seconds of beam through in fifty milliseconds, so a kicker timed against the wall
  never times out and never relaxes its window. Only the render flashes still use the wall
  clock, and they are about what the eye has just seen.
- **A bunch passing the mouth of a transfer line can be claimed by it for one frame**, which
  drops it out of the crossing snapshot. Auto-cogging used to switch itself off when that
  happened and gave up a second or two in for no visible reason.
- **An event display outlives the pass that made it by about forty times.** A pass across an
  insertion is 27 ms of drawn time at flat top; `EVENT_FLASH` is 1.1 s, because anything
  shorter cannot be read. So a fading event sits in a detector the beams have already left,
  and at flat top the half-turn between the two insertions is shorter than the fade — both are
  lit, one igniting while the other fades. That is a display persisting, not a collision
  persisting, and it is why the *band* has to be drawn from live positions: the band is what
  says where the beams are now.
- **And because both are lit at once, each has to fade on its own age.** `drawCollisions`
  batched every event's segments together by species — one set of strokes per colour for the
  whole picture, at one alpha, taken as the freshest event's. So every flash at one experiment
  relit the fading one at the other, a thing the eye catches at once and no assertion could
  see. The loop is now per event, which costs a handful of strokes; `check:render` measures the
  two alphas and requires the older one to be visibly dimmer.
