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
twenty-two-layer barrel stays readable at) and a ceiling (`EVENT_CANVAS_MAX` 240 — it was 320,
which let a card grow to nearly four hundred pixels and stand over most of a band for no gain
in legibility). **A card is as tall as the taller of its two columns**, and that is now always
the picture: the numbers are five one-line values and a one-line legend, measuring 120 px
against a 248 px column — see `EVENT_SIDE_HEIGHT` in `layout.ts`, which carries the wrapping
measurements. It used to be the other way round, with values wrapping to three lines and the
column 60 px taller than the picture beside it. `main.ts` republishes the boxes each frame; it
is a comparison unless something moved. Floor and not round on a half pixel — rounding up
borrows it from the clearance.

**Both pictures are the same size, and that costs something.** They are two views of the same
barrel at the same radius, read one against the other, so at different sizes the same detector
is two different circles and a track that reaches the muon chambers in one looks longer than
the one that does in the other. So the pair is sized twice: each against its own band, and
then both at the smaller of the two. The cost is that the band above the injector governs, and
that band does not grow with the window — the machine grows into it — so a wider window buys
picture in steps rather than continuously, and 196 px is what most windows get. `check:render`
asserts the two are equal at every size and prints the steps.

Where a window is too narrow to hold a readable card beside the readouts, the card takes its
floor size and is allowed to reach `OVERHANG_ALLOWED` (40 px) over an arc; past that it
retreats into the readouts' own column and they scroll instead. A smudge over an arc costs
less than an injector panel scrolled off the screen; that is the whole judgement.

Measured by `check:render`, which sweeps window sizes and prints the table (`band above` and
`band below` are the rings' right edge in each card's strip):

| window | band above | band below | card left | picture, top / bottom |
| --- | --- | --- | --- | --- |
| 1280×860 | 774 | 811 | 784 | 196 / 196 (retreated) |
| 1440×900 | 872 | 904 | 921 | 219 / 219 |
| 1600×900 | 958 | 985 | 1072 | 228 / 228 |
| 1919×906 | 1092 | 1141 | 1147 | 196 / 196 |
| 1920×1080 | 1090 | 1171 | 1148 | 196 / 196 |
| 2560×1440 | 1443 | 1559 | 1744 | 240 / 240 (ceiling) |

The camera it sweeps is fitted the way the app fits it — inside the title and the button bar
(`machineBorders`) — because that is what decides where the injector's band falls.

And by `check:page`, which measures the boxes the browser really laid out. At 1919×906: cards
480×241 at (1147, 16) and (1147, 582), both readouts whole, nothing overlapping anything.

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
further, because every pixel of margin removed pushes the right-hand arc closer to the panels.
The clearance is measured rather than assumed, so the next person to want a bigger picture will
be told exactly how much is left.

**The four borders are not equal, and the machine is centred in what they leave.** The window
is not empty around the picture: the title is over the top of it and the button bar — one row,
or two under about 1500 px — over the bottom, so a complex centred in the *window* puts its
lowest sector labels behind the buttons, which is where they were on anything under about
1000 px tall. `Renderer.resize` takes those two measured heights (`machineBorders`, the same
numbers the rails start at) and adds `LABEL_ROOM` = 48 px, because the sector, point and
experiment names are drawn 34–40 px *outside* the tunnel wall and are therefore not inside the
bounds being fitted at all. The sides keep `CAMERA_MARGIN`. It costs perhaps a tenth of the
ring's drawn size and buys back the bottom of the machine.

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

## What a control may be greyed out for

One rule, in `ui/controls.ts`: **a control is greyed only when pressing it would do nothing at
all.** Not when it would do something bad — a machine that refuses the interesting mistakes is
a machine with nothing to find out in it.

So the ramps grey when the machine is already programmed for the energy they ask for
(`setTargetEnergy` is idempotent), filling greys while the chain is already delivering
(`requestFill` returns immediately), and the three cogging controls grey with fewer than two
beams on the orbit (`World.canCog` — there is no crossing point to move, and the readout beside
it says `needs both beams`). **The kickers are never greyed**, injection or dump: arming one
into a collider that has ramped is the single most instructive press in the toy, and charging a
kicker before there is a beam for it is a thing an operator may want to do.

Three things this had to get right:

- **greyed is `aria-disabled`, not `disabled`.** A disabled button fires no mouse events, so it
  shows no tooltip — and the tooltip is where the reason is. The class carries the look, the
  handlers refuse the press, and the title becomes *reason, then what the control does*.
- **greying is a view and must not write to the model.** The first version cancelled what a
  control was doing as it went dead — auto-cogging switched off when the beams went away — which
  is the same shape as a bug this machine has already had (`collisions.md`: the loop switching
  itself off because a snapshot lost a bunch for a frame). It is gone. A held trim is let go by
  its own `mouseup`, which still arrives, precisely because the button is not `disabled`.
- **the predicate must not flicker**, being asked once a frame. `canCog` is geometric, like the
  luminosity test and for the same reason; `check` measures it at 1800 frames of 1800 with two
  beams up, and a control that went dead for one frame in a run would show there.

`check:page` reads `aria-disabled` off the real bar in both states — an empty collider and a
ramped colliding one — and asserts the kickers are live in both.

## When it all goes wrong: the shake and the tint

The two loudest things this renderer can do, and both belong to `interconnect` alone.

**The shake is applied to the drawing and never to the camera.** `machineBands` is derived from
the camera and the whole overlay is derived from that, so a shake in the camera would jitter
every panel in the window and could walk a card onto the machine — the one thing the layout may
not do. So `render` translates the context after the background is painted (before it, and the
shake drags an unpainted edge across the picture) and restores before the tint.
`SHAKE_PIXELS` = 8 per axis, well inside `OVERHANG_ALLOWED` = 40, and `check:render` asserts both
the bound and that the bands do not move.

**The tint is keyed on the shake, not on the alarm.** An alarm shakes by 0.35 and a catastrophe
by 1, so a threshold at 0.45 belongs to the catastrophe without needing to know which it was. It
used to ask what the banner was saying — and the banner had already moved on to the fill ending.
See `lessons.md`.

The **run panel** (the spectra, the fill report, the chronicle) is at the top of the *right*
rail, and that is measured rather than tasteful: the left rail is already ~85 px over a 906 px
window with BEAM and PHYSICS in it, and those are the readouts you operate against. The
**ticker** is inside the title block, because the camera is fitted against that block's measured
height — so the machine makes room for it by itself — and it is a fixed height whatever it says,
or the picture would resize every time something went wrong. Both are argued in `running.md`.

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
- **`.row`, `.rows` and `.panel`'s own padding are shared with the event cards.**
  `EventPanel` builds its side column out of the same `Readout` class the machine readouts
  use, so tightening row spacing or panel padding to make BEAM/PHYSICS/POWER/INJECTOR
  denser also resizes the side column `EVENT_SIDE_HEIGHT` (120 px) is measured against, and
  `check:page` fails. Scope density changes to `.rail .panel` / `.rail .row` / `.rail .rows`
  — the rail panels only, since `.panel--event` is not inside `.rail` — and the event cards
  are untouched. Done this way for the readout-column compacting in this file's history;
  `check:page` still measured 120 px and 45 px afterwards.
- **The eight power circuits pack two to a row with no JS change.** `.sector`'s DOM
  (`hud.ts`) is unchanged — name, track, wattage — and is still its own three-column grid;
  what changed is `.sectors` going from a single flex column to a two-column CSS grid, so the
  browser's normal grid auto-placement lays two `.sector` items per row on its own. Nothing
  needed `display: contents` or touching the sector's own markup. Halved that list's height
  for free; the same trick would work for INJECTOR's extraction lines if that panel is ever
  the one that has to give up height.
