# Rendering

`src/render/`. Nothing here can be verified by eye from the agent's environment, so
`check:render` is the whole regression net — see the note in `CLAUDE.md`.

## Draw order is load-bearing

background → injector chain → per ring (power clouds → magnets → **insertions** → tunnel) →
transfer lines → **interaction region** → damage channels → showers → **collisions** → beams
→ labels.

The tunnel is drawn *over* the magnet glow, and its bore is filled opaque so nothing leaks
inside — which is also why the insertions go *under* it, so the beam pipe is painted through
the middle of each detector instead of stopping at it. The transfer lines go last of the
structure so their bores close the joint into both tunnels. The showers go after the channels
they came out of, so the tracks read on top of the damage rather than under it.

## What is magnified, and what is not

**The beam is never magnified.** Where the comet is drawn is where the integrator put it, and
that is the whole point of a 250 m aperture instead of a 29 mm one. Four things *are*
magnified, each for a stated reason and each with the true metres reported somewhere: the
damage channel (`DAMAGE_SCALE` 24×, held down so a hole bored into the wall stays inside the
tunnel it was bored in), the shower (`SHOWER_SCALE` 180× and a standardised aspect, because a
cascade is a spike and it is the part of the event that leaves the pipe anyway), the kick
angle (90 mrad against a real 0.28, scaled with the aperture it has to cross), and the
**detectors** (475 m across against a real 25 m, and a standardised aspect: ATLAS is twice as
long as it is wide and at this size that draws as a sliver lying along the pipe). The detector
is the one case where the magnification cannot be avoided by making the physics visible
instead — drawn to the pipe's own 3600× exaggeration it would be ninety kilometres. Its size
lives in `detector.ts` (`INSERTION_RADIUS_F`, `INSERTION_HALF_LENGTH_F`) rather than in the
renderer, because the magnified box is also the stretch of ring the insertion collects over
and the volume a collision vertex may be drawn in — one number, three uses.

**Everything structural is measured in units of the ring's own half-aperture**, not in
metres: `WALL_F` 0.18, `MAGNET_GAP_F` 0.56, `MAGNET_WIDTH_F` 0.84. On the LHC those are
the 45 m / 140 m / 210 m this file used to hard-code; on the SPS they scale it down with
the ring. Add a constant in metres and the injector will be drawn with LHC-sized walls.

**A comet's width and brightness are its intensity**, and nothing else about it moves. See
`collisions.md`: burn-off takes protons and not energy, so a fill that has been running is
drawn thinner — never slower, never a different colour. `check:render` asserts a burnt-down
batch is under 75 % of full width and over 25 %, because it also has to stay findable.

## The one thing not drawn on the machine

`render/eventDisplay.ts` draws into an experiment's own canvas rather than onto the picture of
the complex, and it is the only thing here that does. The reason is a division of labour: the
ring says where the beams are, the panel says what came out.

**The experiments stand in the free bands above and below the injector** — the one stretch of
picture with nothing in it — and the machine readouts keep the full-height column at the right
edge. A panel appears the moment its experiment triggers on something and then stays, because
the trigger holds an event and there is always something to look at from then on. An empty
display reading "no collisions" is a box holding picture space against the day it has anything
to show; a panel that arrives when the beams start colliding says the same thing by arriving.

They were in that rail too, once, at its top and bottom ends with the readouts between them.
There is not enough column for three: POWER alone wants 460 px and INJECTOR another 270, so
the moment both experiments triggered the readouts were crushed into a 115 px scroller with
the injector panel pushed off the bottom of it and the lower card sliding under the button
bar. All three gates were green. See `lessons.md`.

Each is **a picture with its numbers beside it, not above them**. Stacked, the panel was
360 px tall and two of them plus the machine readouts did not fit an 860 px window at all;
side by side it is shorter *and* the canvas is bigger. That is the whole trade — a panel is as
wide as there is room for to the right of the collider, and no taller than it has to be.

**"As wide as there is room for" is arithmetic, not a constant.** The panel used to be a flat
380 px with a check that the collider's arc ended left of it: 36 px of clearance at 1280×860,
and a 196 px picture on a 2560 px screen with five hundred pixels going spare. The room around
the machine is a *measured* quantity, so `Renderer.machineBands` walks the geometry that is
actually drawn — both closed orbits, every transfer and dump line, each padded by its own
tunnel wall — and answers one question: **how far right does the machine reach between these
two screen heights?**

Three things follow from asking it per band rather than once:

- **The card reaches much further left than the collider's widest point.** At the height of
  the top corner the arc has curved hundreds of pixels back.
- **It is asked for the card's own strip, not the whole band** — two passes in
  `eventCardBoxes`, place then re-measure — because TI 8 crosses the top of the space below
  the injector on its way in, and a card sized against the whole band loses 90 px of width to
  a line it does not go near.
- **Rings are hard and lines are soft.** A ring is the thing being looked at; a transfer line
  is a thin pipe across a corner, and holding a card's width off the screen for it costs the
  readouts beside it far more than the line loses. Cards are placed against the rings; the
  lines are reported (`linesRightIn`) and not obeyed.

The picture then takes what is left, bounded by a floor (`EVENT_CANVAS_MIN` 196, what a
twenty-two-layer barrel stays readable at) and a ceiling (320). **A card is as tall as the
taller of its two columns**, and that is usually the numbers, not the picture: see
`EVENT_SIDE_HEIGHT` in `layout.ts` for the wrapping measurements and why the column is 210 px
wide. `main.ts` republishes the boxes each frame; it is a comparison unless something moved.
Floor and not round on a half pixel — rounding up borrows it from the clearance.

Where a window is too narrow to hold a readable card beside the readouts, the card takes its
floor size and is allowed to reach `OVERHANG_ALLOWED` (40 px) over an arc; past that it
retreats into the readouts' own column and they scroll instead. A smudge over an arc costs
less than an injector panel scrolled off the screen; that is the whole judgement.

Measured by `check:render`, which sweeps window sizes and prints the table (`band above` and
`band below` are the rings' right edge in each card's strip):

| window | band above | band below | card left | picture, top / bottom |
| --- | --- | --- | --- | --- |
| 1280×860 | 820 | 848 | 822 | 196 / 196 (retreated) |
| 1440×900 | 910 | 940 | 945 | 233 / 214 |
| 1919×906 | 1143 | 1181 | 1160 | 221 / 196 |
| 1920×1080 | 1144 | 1234 | 1161 | 221 / 293 |
| 2560×1440 | 1554 | 1653 | 1702 | 320 / 320 (ceiling) |

And by `check:page`, which measures the boxes the browser really laid out. At 1919×906: cards
469×268 at (1160, 16) and 442×266 at (1185, 557), both readouts whole, nothing overlapping
anything.

## The overlay must not be drawn on top of anything, and that is checked

The panels are HTML over a canvas, so **nothing relates the camera to a column width** — they
are numbers in two files with no connection but the eye. It went wrong exactly that way twice,
and the second time nothing in the repository could have caught it, because a panel covering
another panel is invisible to a check that records what the renderer was *asked to draw*.

So there are two halves now. The geometry lives in `ui/layout.ts`, derived from
`Renderer.machineBands` and published to the stylesheet as custom properties each frame, so
every clearance is a subtraction rather than a coincidence — and `check:render` sweeps that
arithmetic over window sizes. Then `check:page` opens headless Chrome, drives the machine to
two colliding beams so the cards are actually on screen, and measures
`getBoundingClientRect` on every box: nothing over anything, nothing off the window, nothing
scrolled away, the cards in their bands, and the two measured constants (`EVENT_CARD_CHROME`,
`EVENT_SIDE_HEIGHT`) still equal to what the DOM does. **A layout change is not done until
that one is green.**

Everything on the right — both rails and both cards — is placed rather than flowed. The rails
are `position: fixed` with published insets; only the title and the button bar are still in
the overlay's own grid. Both rails scroll when a window is too short for them, which is the
one thing a column of numbers may do.

`CAMERA_MARGIN` is the other half of the machine's side of it. Dropping it from 96 to 80 makes
the picture bigger — the collider's half-aperture goes 17.5 → 18.3 px — and it cannot go much
further, because the picture is centred and every pixel of margin removed pushes that arc
closer to the panels. The clearance is measured rather than assumed, so the next person to want
a bigger picture will be told exactly how much is left.

The event display shares its species colours with
the machine renderer (`SPECIES_STYLE` in `palette.ts`) and its geometry with the cascade
(`BARREL` and `DETECTOR_SHELLS` in `shower.ts`) — one collision seen from two places must be
one set of colours and one detector, or the eye is looking at two different things.

**It draws the whole barrel**, twenty-two layers, because four plain circles is not a
detector: four pixel and four strip layers with the hits on them, a hatched straw tracker, the
solenoid, a presampler and three EM samplings, three tile samplings, eight toroid coils and
three muon stations. Each annulus is one ring path minus its hole — the same trap `traceOrbit`
documents on the ring, since filling a disc there buries everything inside it. The hard objects
are labelled, one character and a momentum, pushed radially off the end of their track.

Nothing else in the app would notice it failing to draw at all, so `check:render` runs it
against the same recording mock, and the assertions are the physics: the barrel's group
boundaries still equal `DETECTOR_SHELLS`, no two layers overlap, some but not all cells lit,
the EM calorimeter deepest in sampling 2, every segment reaching the canvas, a neutral with no
hits anywhere on it, every hit inside the tracker, all three muon stations lit by whatever got
through, and every label carrying a momentum.

Two traps found writing those:

- **the tracks have to curve, and then stop curving.** Both are measured on the event's own
  segment buffer, not on the stroked polylines — the renderer batches every species into one
  path, so consecutive points in a stroke jump between tracks and any angle taken across them
  is meaningless. It read a confident 180° before that was fixed. And "runs straight outside
  the solenoid" needed the track to have *two* points out there to have a joint to measure,
  which is why a penetrating track is now sampled at each muon station radius.
- **a lit muon chamber is stroked in the same white as a lepton track**, on purpose, and
  records as a one-point arc. A filter that picked track batches by colour alone counted it and
  reported half a segment.

## Traps

- **`traceOrbit` must not call `beginPath`.** The band fills need two subpaths in one
  path; an even-odd fill of a single loop is a filled disc that buries every magnet
  inside the ring. This shipped twice. `check:render` asserts every even-odd fill has
  exactly two subpaths.
- **The comet is one polyline continued across frames** (`lastBeam`, per ring). A bunch
  that reappears somewhere else — arriving in the collider, or a fresh one in a refilled
  injector — must have its ring's continuity dropped (`clearBeamTrail(id)`), or a bright
  line is drawn straight across the picture. Measured at 250 px when it regressed;
  `check:render` runs a whole inject → arrive → refill cycle and asserts no drawn segment
  exceeds 100 px.
- Magnets are a separate chain *inside* the ring, set back from the tunnel, drawn as
  steel casing + cold mass so they are visible objects with no current in them. They must
  stay visible and clickable.
- The magnet click band is deliberately wider than the drawn body. It can only be widened
  *inwards*: outwards it would reach the tunnel and a click on the beam pipe would switch
  a magnet off. That asymmetry is what keeps the injector's magnets clickable (18 px) at
  a quarter of the collider's size.
