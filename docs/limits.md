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
- **Injection does not aim at all, and cogging is trimmed at 4 % — 14 % while the automatic
  loop is still far out.** A real fill is injected onto chosen buckets and then cogged; here
  the reachable phases are a 430 m grid (which is real — it is what the LHC being 27/7 of the
  SPS does) and hunting that grid was seconds of dead time, so the kicker fires as soon as it
  may and cogging does all the aiming. A real cogging trim is parts per million over minutes
  rather than per cent over seconds. All of it is stated where it is made; see
  `collisions.md` for the measurements.
- **ATLAS and CMS are at P3 and P7, not P1 and P5.** The dump lines and both injections have
  taken every other antipodal pair of straights, so the address is wrong and the names are
  right — an unnamed box identifies nothing, and what the two experiments are better at than
  each other is modelled rather than asserted (see below). Both are drawn and printed with
  their point beside them, `ATLAS · P3`, so the substitution is never hidden. The one straight
  that causes it is the dumps': `DUMP_CELL` puts them at P5 where the real ones leave P6, and
  moving them there would free P1/P5 for the experiments — at the cost of re-checking that the
  absorbers still stand clear of the ring, which is what that constant was chosen against.
- **A trigger menu is one multiplier.** `TRIGGER_SPECIALTY_GAIN` = 1.8 on the pT of the
  species an experiment was built around — muons for CMS, e/γ for ATLAS — which is why the two
  panels fill with different physics out of one beam. The asymmetry is real and famous; a real
  menu is a hundred lines of thresholds, prescales and isolation cuts, and this has the shape
  of that and none of the substance. The stream names on the panel (`single-μ`, `b-jet`, …) are
  a classification of the hardest object and nothing more: no isolation is required, no
  invariant mass is formed.
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
- **The mass spectra are a simulation of the measurement, not of the events.** They are computed
  from ∫L dt and real cross-sections rather than filled from the collisions this simulation
  draws — which is the honest choice, since a cascade is built for about one collision per pass
  and a histogram of *those* would be a picture of the drawing budget. What that costs: the
  acceptance and efficiency of a real detector are folded into one effective cross-section per
  source instead of being modelled per pT and rapidity; there is no reconstruction, no
  combinatorial background from mispaired tracks, and no continuum shape fitted to anything. And
  the event display can never show you a Z, because the generator that makes the displays does
  not know about resonances at all. The masses, the widths, the resolutions and the ratios
  between the sources are real.
- **`HIGGS_BOOST` is 4×.** At the true rate a five-sigma γγ excess wants some tens of fb⁻¹,
  which is hours of play at a nominal fill and days at the one or two batches a session usually
  runs; boosted, it lands at 1.3 fb⁻¹ — about five minutes of nominal running or an hour at one
  batch each way. `check` prints the honest exposure beside it every run. It is the same kind of
  budget as the rare species in an event display.
- **Incident rates are a game budget with a real shape.** The MTBFs are the real machine's order
  of magnitude — a UFO dumps the LHC a couple of dozen times against ~1500 hours of stable beams,
  RF and cryogenics are next — but they are quoted per hour of *machine* time, which at 200×
  comes to an interruption every minute or two of play. That is tuned to a session, not measured.
  `interconnect` is the 2008 accident and is once per 6000 hours; what follows from it here is
  three quenched sectors and a recovery, not fourteen months and fifty-three damaged magnets.
- **A vacuum fault consumes beam, and it is the only thing besides collisions that does.**
  Beam–gas scattering really does take protons out of a fill, so this is a real mechanism, but
  it is one multiplier on the burn-off rate rather than a pressure profile with a lifetime
  computed from it. Like burn-off it takes population only: the protons still circulating are
  exactly as energetic, and the drawing rule is unchanged.
- **In a zoomed view, the machine that is not the subject passes behind the rails.** One world
  is drawn wherever the camera is pointed, so at the injector's own view the collider's arc runs
  straight across the window - 2355 px of it, measured by `check:render` - and there is nothing
  to be done about it short of not drawing the rest of the machine, which would be a lie about
  where the beam is. What is guaranteed instead is that the *subject* of a view is never under a
  panel: a zoomed camera is fitted between the overlay's own columns and the experiments' cards
  take the readouts' column there. The overview, which is the view the layout was built for,
  keeps the full rule. See `rendering.md`.
- **The experiments' cards are hidden for the 0.75 s of a camera flight.** Coming out of a
  zoomed view the machine covers the whole window part-way through, and a card is a thing that
  stands beside the machine.
- **A phone's picture is width-limited, and the space above and below it is dead.** A ring is
  square and a phone is tall: at 390 px the collider is drawn 294 px across with room to spare
  vertically, and nothing is done with that room. Cropping the fit to fill it would push the
  arcs off the sides of the window, which is worse. What the slack does buy is that opening the
  sheet costs almost nothing until it passes about 40 % of the window.
- **On a phone the complex is a ring 150 px across, and the sector names are not drawn.** The
  narrow layout keeps every panel off the machine by fitting the machine into what is left
  (`rendering.md`), and what it cannot buy back is size: sixteen labels round a ring have 20 px
  each at that scale, so below `LABEL_SPACING_MIN` they are dropped. What is still named is
  each ring, each experiment, and any sector that has quenched or been switched off. The camera's
  places are the answer to the rest, and are the reason the toy works at this size at all.
- **A window under about 1700 px wide cannot hold the overlay the machine deserves.** The
  experiments' cards need ~440 px beside the readouts' 260 and there is not that much room
  outside the collider's arc; below it the cards retreat into the readout column and the
  readouts scroll, which is the old behaviour and the reason the layout was rewritten. What is
  guaranteed at every size is that nothing is drawn on top of anything — `check:page` asserts
  that at 1280×860 too.
- **Both rails scroll on a short window, and the right one scrolls on most windows.** The left
  rail (beam, physics, compute) fits an 1919×906 window with 21 px to spare; the right one
  (run, power, injector) is still about 108 px over at that size and does not stop scrolling
  until roughly 2560×1440, because the run panel's two spectra plus the eight-circuit power
  list plus the injector's own rows add up to more column than a normal window is tall,
  compacting notwithstanding (`.rail .panel`, `.rail .row` etc. in `style.css`, and the
  eight-circuit list packed two to a row). They scroll rather than overlapping, which is what
  they used to do instead. `check:page` prints how much is hidden and does not fail on it —
  what it *does* fail on is a **panel** whose own content is scrolled away, which is the flexbox
  crushing it and is the bug that shipped. Because it scrolls on most sessions and not just
  narrow ones, the rail's scrollbar is hidden until the pointer is over the column
  (`scrollbar-width: none` / zero-width `::-webkit-scrollbar` by default, both restored on
  `:hover`) — a bar that is visible more often than not read as a permanent stripe down the
  readouts rather than a control.
- **A card may reach up to 40 px over an arc** (`OVERHANG_ALLOWED`) when its band is too narrow
  for a readable picture, and it may cover a transfer line freely — rings are treated as hard
  obstacles and lines as soft. Argued in `rendering.md`; the alternative was hiding readouts.
