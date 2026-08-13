# Reference numbers

Regression anchors from `npm run check` and `npm run check:render`. If these move,
something changed — find out what before moving the number.

```
LHC   bend radius rho       2803.93 m   (LHC: 2803.95)
      T_rev                  88.925 us  (LHC: 88.92)
      B at 450 GeV / 6.8 TeV  0.5353 / 8.0895 T   (LHC: 8.09 at top)
      stored in magnets        7.42 GJ  (LHC: ~8.5)
      ramp duration            1037 s   (LHC: ~1200)
      one batch at flat top      29 MJ; 12 of them = 352 MJ  (LHC: ~350)
      quench margin at nominal 1.05 K; one batch into 4235 t is 2.0 K

SPS   bend radius             741.3 m   (SPS: 741.3)
      energy programme     26 -> 450 GeV  (SPS: 26 -> 450) — it ramps
      B at 26 / 450 GeV     0.117 / 2.025 T   (SPS: 2.02 at extraction)
      ramp                     100 s of machine time = 0.50 s of play
                               (SPS: 4.3 s real — stretched 23x, see limits.md)
      T_rev                  23.054 us  (SPS: 23.05)
      drawn speed through its own ramp   5.3 -> 13.3 km/s of track

orbit offset @2400 steps/turn   beam 1  10.071 mm, flat over 2000 turns
                                beam 2  10.043 mm — the two must stay equal
push cost                       ~420 us / 1k particle-steps, ~100 us / frame for one beam
sector off at injection         lost after 0.14 turns, 2409 m of straight flight
sector off at flat top          dies on a straight ~500 m from the nearest coil, 14 % of it
                                reaches the cold mass, nothing quenches
drawn speed                     a 26 GeV injector bunch holds 5.3 km/s of track while the
                                collider goes 0.50 -> 2.00 turns/s through a ramp; its own
                                ramp takes it to 13.3. Beam clock anchors: 0.20 turns/s at
                                26 GeV, 0.50 at 450, 2.00 at 6800

chain  one 871 m tube (Linac4 86 + PSB 157 + PS 628), on the injection straight, firing
       south-east; 65 px drawn, and it costs the picture nothing
TI 2   3.20 km, a straight drift, aim error 0   (also the injector standoff)
TI 8   4.10 km out of sextant 5: 1042 m drift, one 437 m dipole (30 deg at rho 834 m,
       1.80 T, turning against the ring), 2619 m drift, into collider straight 7 backwards
TD1 / TD2  2.00 km each, straight, into their absorbers, out of **P5 and P4** — one
       insertion per beam, because within one straight the two lines cross whatever the
       kicker length (see beamlines.md). 3952 m apart at closest, pipes 105 m. Each absorber
       1260 m deep and ±336 m wide (12 and 3.2 of the dump line's own aperture); both beams
       stop ~420 m into the block, within 1 m of its axis.
kickers  319 m / 90 mrad / 0.42 T on the SPS at flat top; the dump kickers 961 m / 90 mrad /
       2.13 T at 6.8 TeV. All four at 85 % of their own straight — 22 px and 67 px drawn.
       Each ends exactly where its own line's pipe begins, which is what makes the departure
       visible.
septa    cancel 2.02 T (SPS) and 0.54 T (LHC), DC, standing off the closed orbit, not drawn
pulse    one arc *plus one kicker* long — the bunch is seen an arc upstream and has to get
       all the way through the kicker before the field collapses
closest approach between the two closed orbits    1250 m
closest approach between the two transfer lines    730 m (pipes are 66 m)
23 field sectors, 34 aperture elements
world extent 12.03 x 10.14 km; collider half-aperture 15.2 px, injector 4.0 px at 1919x906
       (floor asserted: 12). CAMERA_MARGIN is 80 at the sides; the top and bottom borders are
       the title and the button bar as measured, plus LABEL_ROOM = 48 for the names drawn
       outside the tunnel wall — which costs about a sixth of the picture and is what keeps
       S67, S78 and the second experiment off the buttons.
overlay at 1280x860   collider tunnel wall ends at 774 px, the experiments' cards start at
       784, the injector spans x 918..1081 / y 308..469 — so a card sits above it and a
       card below it. check:render asserts the first of those three.
labels drawn        LABEL_SPACING_MIN = 56 px between neighbours round a ring. On a desktop
       overview that names all 8 sectors and 8 points of the collider and none of the
       injector's (a quarter of the size, and its names would run through the kicker labels
       in the same annulus); at the injector's own view, all 14 of both rings'; at 390x844,
       none. The chain has its own test — 48 px of drawn tube, which is 65 on a desktop and
       13 on a phone. Ring names, experiment names, and any quenched or switched-off sector
       are drawn at every size
narrow layout at 390x844   machine 294 px across (width-limited: a ring is square and a
       phone is tall, so the vertical slack is what lets the sheet open for almost nothing);
       stacked up from the bottom edge: places strip 390x40, sheet on it (folded to its tabs
       and one peek line, 34 vh open), the console on that at three rows and 110 px, the
       machine above all of it; readouts 366 px of the sheet's 366; event display 320 px, the
       biggest it is drawn anywhere. Smallest tap target 29 px, floor 28
the console        1180x58 at every window that has room for it, 1069 at 1101 — and the same
       pixels at all six places, which is the point of it: check:page walks the places and
       compares the desk, every bay, pause and both dumps. The places are 396x31 beside the
       title. The scope comes off the desk under 1360 px, where the busiest place's keys plus
       the nameplate plus the dumps want the whole box; the load meter never does
camera views at 1919x906 (magnification against the overview, which is 1.00x):
       SPS 3.64x, ATLAS/CMS 3.35x, TI 2/TI 8 1.31x, LHC 0.96x — the collider already fills
       the overview's height, so its own view is a pan and not a zoom. There is no view of
       the dumps: a box round both absorbers came out 0.9x, a tab that zooms out.
       A flight is 0.75 s of wall time = 45 frames, and its overlay bands are sampled at 9
       points along it (8 + the start); the endpoints alone gave -61 px of clearance
event cards at 1919x906   480x241 both, picture 196 px, numbers 120 px beside it. Both
       pictures are always the same size (check:render asserts it): they are one detector at
       one radius, read against each other.

shower (one proton)   450 GeV: 373 particles, 192 drawn, 3.06 x 0.25 m, 10 generations
                      6.8 TeV: 471 particles, 192 drawn, 2.87 x 0.03 m, 10 generations
quench at flat top    a sector takes 15.6 MJ; a 6.8 TeV batch (29 MJ) quenches out to
                      ~160 m from the coil, a 450 GeV batch (1.9 MJ) never does

insertions   ATLAS at P3, s = 7230 m; CMS at P7, s = 20559 m — half a ring apart to 0.000 m
one batch    234 bunches over 1754 m = 6.6 % of the ring; crossings count within ±877 m
             of an IP, and bunch pairs fall off triangularly to zero there
nominal fill (12 + 12 batches, every pair head-on, at 6.8 TeV):
             12 batch pairs, 2808 bunch pairs/turn, L = 1.21e34 cm^-2 s^-1 at *each*
             insertion, pile-up 31, 0.96 GHz of interactions, 0.66 Higgs/s,
             46 h burn-off lifetime      (LHC: 2808, 1.0e34, 30-60, ~1 GHz, ~1/s, ~50 h)
mis-phasing  0 m -> 234 bunch pairs, 200 m -> 181, 440 m -> 117, 877 m -> none
where an event is drawn inside a ±550 m insertion, by where the crossing sits:
             crossing on the IP -> vertices at a mean of  -9 m, spread -395..361
             crossing  300 m off ->                      138 m, spread -258..464
             crossing  600 m off ->                      275 m, spread  -31..511
phasing a fill, through the machine (fill, ramp the injector, extract; injection carries a
random angle and momentum, so these vary run to run). Injection no longer waits for a phase,
only for a bucket one of its own is not already in:
             injected  held 0.25 s -> crossing -5782 m, nothing collides
             auto-cog  7.2 s from there -> -4 m, 233 bunch pairs, L = 1.0e33, at 450 GeV;
                       about 2 s at flat top, where the beam is drawn four times faster
             cogging by hand   268 m of ring per second at injection, 1065 at flat top
                       (COG_TRIM 4 %; the automatic loop uses COG_TRIM_FAST 14 % until it is
                       within COG_APPROACH 400 m)
             World.canCog, which greys the cogging controls out: offered in 1800 of 1800
                       frames with two beams up. It must not flicker — it is geometric for
                       the same reason luminosity is
collision event, r-z view (one inelastic pp interaction, in detector radii):
             900 GeV:   41 primaries, 463 particles, 256 drawn, 1.08 / 0.98 x 0.81
             13.6 TeV:  75 primaries, 467 particles, 256 drawn, 1.08 / 1.07 x 0.94
the same event, r-phi view (same generator, same seed — check asserts they agree):
             900 GeV:   41 particles (26 charged), 23 tracks drawn, 192 tracker hits,
                        13 curled up in the tracker, 1 through to the muon chambers,
                        sum pT 27 GeV
             13.6 TeV:  75 particles (48 charged), 45 tracks drawn, 383 tracker hits,
                        23 curled up, 2 through, sum pT 47 GeV
             pT to leave the tracker  0.345 GeV/c  (1.15 m at 2 T: 0.345 — exact, the bend
                        is standardised on the tracker)
             barrel  22 layers: 4 pixel, 4 strip, 1 straw, 4 EM samplings x 64 cells,
                        3 tile x 32, 8 toroid coils, 3 muon stations x 16. Group boundaries
                        are DETECTOR_SHELLS exactly: 0.42 / 0.6 / 0.8
             EM samplings [GeV]    2 / 6 / 13 / 5 — an EM shower peaks in sampling 2
             tile samplings [GeV]  9 / 7 / 4 — what punched through
trigger      6+6 batches over 30 s of play: ~15 candidates offered per insertion, 7-9 kept,
             each picked out of ~5e10 interactions. Bar = last kept, decaying to 2 GeV over 4 s
             The bar is asked of the experiment: TRIGGER_SPECIALTY_GAIN = 1.8 on e/γ at ATLAS
             and on muons at CMS, so one beam fills the two panels with different physics.
             The panel names the stream — single-μ, single-e, γ, b-jet, strange, jet.
burn-off     one head-on pair, intensity of a fresh batch by seconds of play:
             0 s 100.0 %, 30 s 96.5 %, 120 s 87.5 %, 300 s 73.6 % — and gamma never moves
detectors drawn  82 px long in an 85 px straight, tracker at 0.420 of the radius
cogging      272 m of ring per second at injection, 1072 m at flat top, both directions
debris load (per insertion, against 1800 W of cryogenics):
             6+6 batches 419 W, 12+12 839 W, 18+18 1649 W — all hold at 1.90 K;
             24+24 is 2903 W, over capacity, and quenches. Cooling 40 K -> 2 K: 18 s of play
hardest object in 400 events at 13.6 TeV:
             pion 45 %, photon 30 %, b/c jet 12 %, kaon 11 %, isolated lepton 3 %, tail 40+ GeV
mass spectra (a function of ∫L dt alone; 1 step and 1000 steps of the same exposure give an
identical histogram, which is the frame-rate independence the luminosity also claims):
             J/ψ 7.8e5 per 0.01 fb⁻¹, Z 8.0e3 — a ratio of 100, which is the real one
             γγ at 125 GeV: 0.1 fb⁻¹ -> 19 on 181 = 1.4σ; 1 fb⁻¹ -> 187 on 1806 = 4.4σ
             five sigma at 1.3 fb⁻¹ = 5 min of play at a nominal fill, 1.0 h at one batch
                       each way. HIGGS_BOOST 4×, so the honest exposure is 5.2 fb⁻¹
             Υ(2S) and Υ(3S) are drawn as a shoulder on Υ(1S): 72 log bins over 1..200 GeV
                       are 7.5 % wide and the three states span 10 %
incidents (MTBF in hours of machine time -> one per N minutes of play at 200×):
             ufo 20 h / 6 min, rf 35 / 11, vacuum 45 / 13, power 60 / 18, cryo 90 / 27,
             interconnect 6000 h / 30 h of play. Cool-down 600 s of machine time, and
             nothing else fires inside it. Off by default; main.ts switches them on
fill economics (one head-on pair at flat top):
             lifetime 48 h of machine time, turnaround 15 min -> optimum fill √(τ·T) = 3.4 h
                       = 1.0 min of play. Real machine: 46 h and 4 h -> 14 h fills
             20 s of play collected 8.1e-3 fb⁻¹ in 69 min of stable beams, peak 2.0e33
```
