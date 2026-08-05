# What is not modelled, and what is deliberately not real

The audience is physicists, so every departure from reality is stated where it is made in
the code and listed here. **A new departure goes in both places, in the same change.**

## Not built yet

Quadrupoles (a dipole-only ring is only weakly focusing, which is all this 2D view has), and
with them β* and a real emittance — the 16.6 µm beam size at the IP is quoted, not simulated,
because there is nothing here to squeeze with. Bunch structure below a batch. RF as anything
but a capture rule. Crossing angles and separation bumps, and with them the long-range
beam-beam encounters they exist to prevent. The WebGPU backend. The injector's warm resistive
magnets, whose real power bill is I²R and this powering model has no such term — its energy
programme is modelled, its power draw is not and should not be quoted at anyone. The Booster
and the PS as machines: the chain ahead of the injector is one drawn tube and nothing is
tracked in it.

## Known modelling limits, all deliberate

- **TI 8 is 4.1 km** against the real 2.7 km, with a 437 m dipole, and **TI 2 is 3.2 km**
  against the real 2.7. Both of TI 8's ends are fixed by the time it is built, and TI 2 pays
  its 500 m to buy that: the pair used to be 2.7 + 10.4 km. See `lessons.md` for what has
  been ruled out.
- **The septum keeps a circulating beam out of a line by a tie-break, not by geometry.** Its
  *field* really does stand off the closed orbit, so a circulating beam never enters it —
  that part is physical. But where a line's pipe joins a ring's the two overlap, and what
  keeps a circulating beam out of the line beside it is `projectToOrbit` preferring the ring
  on a tie.
- **Kick angles are scaled with the aperture.** A real MKI turns the beam by 0.28 mrad
  because it only has to clear a blade a couple of centimetres away; the pipe here is
  3600× the real one and the angle goes with it, to 90 mrad. The *field* that implies is no
  longer silly, because the kicker is 85 % of a straight rather than 15 m of ferrite:
  0.42 T on the SPS and 0.14 T on the LHC at injection, against 6.0 and 2.0 T when it was
  drawn at its real proportion.
- **A shower is one primary's cascade, cut to 192 segments and drawn at a standardised
  aspect.** The tree is 300–500 particles of a real tens of thousands, and the drawn width
  is not the physical width; both numbers are printed by `check`. What a *batch* does is
  2.7e13 of these on top of each other, and that is only represented by the channel and the
  heat, not by more tracks.
- **A batch is one macro-particle.** Twelve make a nominal fill, but there is no structure
  inside one and no way to lose part of it. Its 234 bunches exist only as a number: they set
  its 1754 m length, which is what the whole collision rule is built on, and they are what
  the bunch-pair count counts.
- **Injection lands on a 430 m grid and cogging is trimmed at 4 %.** The grid is real — it is
  what the LHC being 27/7 of the SPS does — but a real machine does not settle for landing
  anywhere in the overlap, and a real cogging trim is parts per million over minutes rather
  than four per cent over seconds. Both are stated where they are made.
- **The detectors are at P3 and P7, not P1 and P5**, because the dump lines and both
  injections have taken every other antipodal pair of straights. They are named for their
  points so nothing claims to be ATLAS or CMS. The one straight that causes this is the
  dumps': `DUMP_CELL` puts them at P5 where the real ones leave P6, and moving them there
  would free P1/P5 for the experiments — at the cost of re-checking that the absorbers still
  stand clear of the ring, which is what that constant was chosen against.
- **A detector is drawn twenty times its true size**, and is therefore a *stretch* of ring in
  this picture rather than a point on it. That is what makes "the part of the interaction
  region inside a detector" and "where in the detector a vertex is" mean anything at all; on
  the real machine both are a few centimetres. One constant, `INSERTION_HALF_LENGTH_F`.
- **The rare species in an event display are exaggerated.** A real inelastic event contains a
  W about once in ten million and a b hadron in about one per cent; here an isolated lepton
  turns up in 3 % of events and a b/c jet in 25 %. The pT spectrum's *shape* and the ordering
  of what appears at what energy are real; how often the top of it is reached is a drawing
  budget, and `check` prints the honest rate beside it.
- **An insertion that overheats only says so.** The debris power, the cryogenic capacity and
  the temperature are modelled and quench at the right place on the scale, but nothing follows
  from the quench, because the inner-triplet quadrupoles that would go normal are not in this
  model — there are no quadrupoles in it at all.
- **An event display is one collision**, cut to 256 segments, sitting inside a pile-up of
  about thirty that is reported and not drawn. Its radii are the drawn detector's, not the
  real one's; its angles, multiplicity and species are physics. Both are printed by `check`.
- **The injector's ramp is stretched 23×** — 100 s of machine time against a real 4.3 s. This
  is the one place the fixed 200× machine clock cannot be served: 4.3 s of it is 21 ms of
  play, and a machine whose whole job is to accelerate would show nothing doing it. At
  `rampRate` 48 A/s the ramp is half a second of play and still 5× the rate the collider's
  dipoles are allowed, which is the fact about the two machines that matters. The collider's
  ramp is *not* stretched: 1037 s of machine time against a real ~1200.
- **The chain ahead of the injector is one 871 m tube** rather than Linac4, the Booster and
  the PS. The length is the honest sum of the three machines' own lengths, so it is not a
  magnification — but it is drawn as one straight run of structure, on the injection straight,
  and the two rings are gone from the picture. They were under two pixels each.
- **The transverse view's barrel is a real barrel with unreal spacing.** `BARREL` has the
  layers a real one has, in the real order and grouping — beam pipe, four pixel layers, four
  strip layers, a straw tracker, the solenoid, a presampler and three EM samplings, three tile
  samplings, eight toroid coils, three muon stations — and what is *not* real is how far apart
  they are. Drawn to scale the whole tracker is a tenth of the radius with eight layers inside
  it, which is one dot. Cell counts are a budget with the real ratio kept: 64 EM and 32
  hadronic against a real ~256 and ~64.
- **The transverse view's solenoid bend is standardised on the tracker**, the way the shell
  radii are standardised on the detector. The threshold that matters — 0.345 GeV/c to escape
  the tracker — is exactly the real one, because both sides of it scale together; the
  threshold to reach the *outer* radius is not, and more tracks reach the calorimeter here
  than really would. Stated in `shower.ts` where it is made.
- **A hit is a point, not a cluster, and there is no reconstruction.** The dots are where a
  primary crossed a layer, drawn from truth; nothing fits a track to them, nothing resolves
  two tracks that share a hit, and there is no resolution or efficiency anywhere. What is real
  is which particles leave hits and which layers they reach.
- **Transverse momentum does not balance.** The primaries are generated independently, so the
  vector sum of their pT is a random walk rather than the zero a real collision conserves —
  which is why no missing-Et is drawn or quoted. Drawing one would be a measurement of the
  generator, not of the event.
- **Both dumps at P5 became P5 and P4**, one insertion per beam. The real machine puts them
  both at IR6; here they cannot share a straight at all (see `beamlines.md`).
- **An event display is drawn for one collision in a few hundred million**, and the panel says
  so. What is not real is the *candidate* rate: this simulation builds a cascade for roughly
  one collision per pass of two batches, so the trigger is choosing among a handful and not
  among a billion. The selection rule — hardest object, bar decaying from what was last kept —
  is the real shape of the thing; the numbers on either side of it are a drawing budget.
- **Quench recovery is 20 minutes** of machine time against 8–12 hours real, and quench
  detection is stretched from ~10 ms to something visible. Both are marked in `powering.ts`.
- **A quench takes ~16 MJ** because the deposit is spread over the whole 4235 t string, so a
  450 GeV batch never quenches anything. See `impacts.md` for why that trade was taken.
- **A window under about 1700 px wide cannot hold the overlay the machine deserves.** The
  experiments' cards need ~440 px beside the readouts' 260 and there is not that much room
  outside the collider's arc; below it the cards retreat into the readout column and the
  readouts scroll, which is the old behaviour and the reason the layout was rewritten. What is
  guaranteed at every size is that nothing is drawn on top of anything — `check:page` asserts
  that at 1280×860 too.
- **The left-hand rail scrolls on a short window.** A filled beam readout, the physics panel
  and the compute panel want about 1020 px of column, and a 906 px window has 768. It scrolls
  rather than overlapping, which is what it used to do instead; `check:page` prints how much
  is hidden and does not fail on it.
- **A card may reach up to 40 px over an arc** (`OVERHANG_ALLOWED`) when its band is too narrow
  for a readable picture, and it may cover a transfer line freely — rings are treated as hard
  obstacles and lines as soft. Argued in `rendering.md`; the alternative was hiding readouts.
