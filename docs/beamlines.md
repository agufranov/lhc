# Transfer lines, kickers, and how a beam gets from one ring to the other

`line.ts`, the extraction half of `world.ts`, and where the injector is parked.

## Routing a line is scored on steel, not tunnel

`routeLine` picks the route needing the least *magnet*, with tunnel length only breaking
ties. Two mistakes were made here in a row and both are worth not repeating:

- **Landing the bend on the ring leaves no freedom.** With the bend ending exactly on the
  target, the radius falls out of the geometry, and it came back in kilometres — a
  kilometres-long curved dipole. Drift → bend → drift separates the questions: the radius
  is then free, so the magnet runs at the strongest field it is allowed and is as short as
  that permits.
- **Scoring on total length picks long magnets.** A route that saves a kilometre of empty
  tunnel by asking for eight kilometres of curved dipole scores better on length and is
  obviously not cheaper. Tunnel is cheap; a bend is a string of dipoles.

And a bend has to stand clear of the ring it takes beam from. A magnet only bends what is
in its own pipe, and for the first √(2ρa) of a tangential departure the bunch is still
inside the injector's — a bend placed there does nothing at all, and the beam runs into
the wall of the line it was supposed to be steered down. Measured: with a 6 m lead-in the
beam died 428 m along a 4 km line.

## Each beam dumps out of its own insertion, and it has to

Both dumps used to leave one straight, one out of each end. That does not close, and the
reason is worth keeping: a kicker has to sit at its own beam's **near** end of the straight,
because the pulse is timed off the arc the bunch arrives from and a device further down the
straight than the pulse is long would be reached after the field had collapsed. So with a
kicker filling a fraction f of the straight, beam 1's line leaves at f·L and beam 2's at
(1−f)·L, and whichever way f goes one of two things is wrong:

- **f < 0.5** — beam 1 leaves *upstream* of beam 2, then runs downstream while beam 2 runs
  upstream. **The two lines cross.** Measured at f = 0.42: 26 m between two pipes 105 m wide,
  so the picture had one dump drawn through the other and neither kicker was legible.
- **f > 0.5** — the exits are the right way round, but the two kickers now occupy the same
  metres of tunnel, which is why f was dropped to 0.42 in the first place.

There is no f that satisfies both, so the straight is the thing that gives: beam 1 dumps out
of P5 and beam 2 out of P4, both through the same arc, from opposite ends of it, diverging
instead of crossing — 3952 m apart at closest. Each kicker then gets a whole straight to
itself and goes back to `KICKER_LENGTH_F`: **961 m and 67 px** against 475 m and 36 px, and
**2.13 T** against 4.30, because the same 90 mrad over twice the length is half the field.

It costs 1.2 px of collider aperture (18.7 → 17.5) because the second absorber is somewhere
new. That is the whole price, and `check:render` still asserts the > 12 px floor.

The real machine puts both at IR6 and does this with extraction geometry ninety metres wide
that this simulation does not have; two insertions is the honest way to say the same thing at
a 3600× aperture.

## Kickers are not magnets

**The ring's dipoles are never touched by an extraction, and must never be *drawn* as
though they were.** The renderer went on shading the extraction sector as a dead magnet
long after the physics had stopped switching it off — a lie about how the machine works,
and one only the eye catches. `check:render` now asserts that no dipole is drawn in the
switched-off colour while a kicker is firing.

**The ring's dipoles are never touched by an extraction.** They go on running at whatever
the programme asks for. What takes the beam out is an *extra* field — a septum sector in
the global table, co-located with the extraction channel of the sector the beam leaves
through, pointing the other way, switched on for the length of one pulse. While it is on
the two sum to zero in that channel and the beam is not bent; every other bunch in the
ring carries on. An earlier version blanked the dipole itself, which is a different claim
about the machine and a wrong one.

The septum has to cover √(2ρw) of arc — far enough for the beam to get clear of the
dipole's field region on its way out — and that is where its length comes from.

A dipole is set and left; its field takes a hundred seconds to decay when you open the
switch, and that is modelled. A **kicker** is the opposite device and is modelled as one:

- it **fires itself** when a bunch of the right beam is on the **arc it will arrive from** —
  there is no on/off for the operator, only *arm*. Which arc that is depends on the beam:
  beam 1 runs straight k then arc k, so it reaches the kicker in straight k off arc k−1;
  beam 2 runs the ring backwards and comes into straight k off arc k. Watch the straight the
  kicker sits in and the bunch has already gone past it — the beam 2 dump fired every time
  and never caught anything;
- the pulse lasts **one arc plus one kicker**, so it takes **one bunch**. The batch behind it
  goes on circulating and needs its own pulse. It has to cover the kicker as well as the arc
  because the bunch is detected an arc upstream: sized to the arc alone, the field collapsed
  with the bunch halfway through a 961 m kicker, and half a kick aims at nothing — the batch
  left on a ray no line was built along and went into the wall;
- it is **85 % of the straight long**, so its downstream end is where the beam leaves the
  ring. At the real proportion (a 15 m MKI → 22 m here) it was two pixels at the *near* end
  of the straight while the departure happened at the arc a hundred pixels away, and what
  the eye saw was a device that flashed and did nothing followed by a beam that went straight
  for no visible reason. Length also buys plausibility: the same angle over sixteen times
  the length is a sixteenth of the field, 6.0 T → 0.42 T on the SPS;
- anything else inside that stretch during those microseconds leaves too. That is not a
  simplification — it is why a real machine keeps an abort gap;
- it is drawn violet, and nothing else in the picture is, because it is not a dipole. **The
  septum is not drawn at all.** It was — a teal yoke and blade standing off the closed orbit,
  four of them — and it crowded the picture with hardware that never does anything the eye is
  here for: a septum is DC and unchanging, and the event worth watching is the kicker firing.
  Its *field* stays, and has to: without it an extracted bunch follows the arc round and never
  enters the transfer line. `check:render` asserts both halves — nothing teal is drawn, every
  extraction still has a septum sector in the field table.

The field a kicker or septum is given is written **as the extracted bunch sees it**, in
`publishFieldScales`. A ring dipole's excitation is quoted for the forward aperture and
negated for the reverse one, but `buildKicker` already builds its arc for the bunch's own
`bore` — negating that as well pointed the beam 2 dump kicker inward and threw the batch into
the inside wall of the ring. One convention, applied once.

Every bunch is injected with a random angle (0.4 mrad rms) and momentum (3e-4), so no beam
sits exactly on the closed orbit and no two batches sit on the same one. One macro-particle
stands for a whole batch here, so what would be a spread *within* a bunch becomes a spread
*between* them.

## The injector is a machine, not a source

It used to sit at 450 GeV with its injection and top energies the same, which made a
6.9 km ring into a very large piece of pipe that handed over a beam it had done nothing to.
It runs its real programme now — **26 → 450 GeV** — and everything follows from where the
protons enter it:

- **the chain delivers at 26 GeV, always.** That is what the PS extracts at, and it has
  nothing to do with where the injector's ramp happens to be. Capture is a momentum match
  and nothing else, so the injector has to be *at* flat bottom to take a batch;
- so filling and ramping are in an order, and the order is the machine's, not a rule laid on
  top of it. `requestFill` asks for flat bottom and the chain holds until it is there — a PS
  cannot hand 26 GeV protons to a ring running its dipoles at 450, and a control that
  silently binned the batch every time it was pressed out of order would be an annoyance
  rather than a lesson;
- **the lesson is one click further on and much better.** Extract before the ramp has
  finished and a 26 GeV batch goes down a transfer line set for 450 and arrives at a collider
  set for 450. It is not captured, and it is in the wall — the same fact as injecting into a
  ramped collider, one machine earlier, and reachable without ramping anything to 6.8 TeV.

The ramp itself is stretched and that is the one place the fixed 200× machine clock cannot
be served; see `limits.md`. What it buys is measured: the same bunch goes from 5.3 to
13.3 km/s of drawn track as the injector takes it up, so the machine is visibly accelerating
something rather than storing it.

**Everything ahead of the injector is one tube.** Linac4, the Booster and the PS were three
objects at their real sizes, and on a picture eleven kilometres across the two rings were a
100 m circle and a 25 m one — under two pixels each, in the one place where something *long*
would read. They are now a single run of accelerating structure whose length is the honest
sum of what it stands for, 871 m, laid along the injection straight so the protons fly in
without a kink. That straight points east-south-east, so the whole chain reads as firing
south-east into the ring, and it costs the picture nothing: it lands inside the bounding box
the two rings already need. Nothing is tracked in it — the injector is the first machine this
simulation integrates.

## Injection is an event, not a reset

`inject` does not put a beam in the collider. It **arms** a kicker. The kicker fires itself
when a bunch of the right beam arrives, that bunch is thrown out of the ring, it flies down
a transfer line, and the collider picks up whatever turns up, wherever it turns up. Nothing
is handed over anywhere: it is one continuous flight through one field table.

The pieces:

- **A transfer line is a lattice, not a special case.** Its straights and bends are rows in
  the same aperture and field tables as the rings', so the extracted bunch keeps a pipe
  around it and the same pusher moves it the whole way.
- **TI 2 is aimed by construction.** `placeInjector` moves the whole injector ring so that
  the ray the beam leaves on — *after* the kicker, not the tangent — ends exactly on the
  collider's injection point pointing the collider's way. Measured aim error: 0. Its length
  (`INJECTOR_STANDOFF`, 3.20 km) is therefore also how far the injector stands off, so it is
  the one knob that sets how compact the complex is.
- **Every line after the first has to be steered.** Both of its ends are already fixed by
  then. See the routing section above.
- **TI 8 leaves the sextant just upstream of TI 2's** (`TI8_EXIT_CELL` = 5), which faces the
  collider, so it comes off the ring already pointing roughly the right way: its bend is
  +30° *against* the ring's own curvature, 437 m of dipole, 4.10 km of tunnel. Leaving from
  the far side of the injector instead — the antiparallel sextant, bending −75° *with* the
  ring — cost 10.42 km and 1092 m of dipole. The exit sextant is **pinned, not searched**: a
  scan over all six let an unrelated tuning change move the extraction to the far side and
  add six kilometres. Only the collider straight to aim at is still searched, and it comes
  out as straight 7, entered backwards, which is what makes this beam 2.
- **Cell index runs clockwise on screen.** The injector's `sense` is −1, so it turns
  clockwise in world coordinates, and `Camera` maps a y-up world onto y-down pixels *without
  mirroring* the picture — north stays up. So a lattice's sense reads the same on screen as
  in the world, and cell k+1 is one step clockwise from cell k in both.
- **There is no interlock.** Injecting into a ramped machine is allowed and is the most
  instructive thing in the toy: the ring does not capture a beam whose momentum it cannot
  match, so a 450 GeV batch meets a field set for 6.8 TeV and is in the wall within metres.

**The injector counter-rotates, and that is forced.** An extraction line leaves along a
tangent and a ring always lies on the inside of its own tangent, so two rings turning the
same way end up nested along that line with their tunnels metres apart, at *any* line
length. Counter-rotating puts the injector on the far side. This is what `sense` is for,
and it is why every aperture element carries a handedness — on an arc "outward" is just
away from the centre of curvature, but on a straight nothing in the geometry says which
side the ring is on.

The whole layout is rotated a quarter turn (`LHC_CONFIG.placement.rotation`) so the complex
hangs off the collider's flank, into the spare width of a landscape canvas. Measured: the
injector, the four lines and the linac chain cost the collider **nothing** on screen. Below
or above it the aperture would drop from 18.7 px to 13.9 px. If you move the injection
point, re-run `check:render` — it asserts the collider aperture is >12 px and that both
rings are inside the canvas.
