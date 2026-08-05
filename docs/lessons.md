# Negative results and silent bugs

Two lists that exist so nothing here is re-derived or re-shipped. Everything is measured;
nothing is guessed. **Add to this file whenever something costs an hour and leaves no trace
in the code.**

## Things that were tried and do not work

- **Two straight lines into the collider.** A line leaves along one of the injector's six
  tangent directions; a collider straight can be entered along one of eight. Only two of
  the six ever line up with that grid, and those two are antiparallel — opposite sides of a
  hexagon — so their tangent lines are parallel and 2.2 km apart. Both landing on straights
  is out, whichever straights you pick. A second line *can* be straight if it arrives
  tangent to an **arc** instead, but that parks the injector 6 km out — and there was a
  `solveStandoff` searching for exactly that placement: swept 2–9 km in 20 m steps, refined
  to half a metre, it found no graze at any standoff, returned `Infinity` every time, and
  parked the injector at its fallback constant. Nothing was being solved, so it is gone.
  `INJECTOR_STANDOFF` now states what the placement *is* chosen against: the shortest
  standoff at which TI 8 has a route. Measured — none below 3.02 km, then the same family
  of routes from 3.05 to ~4.7 km, so the compact end of it plus a margin.
- **Bending TI 8 "the other way".** Reaching the same heading the other way round is
  360° − θ: a 240° loop, not a short cut, and the loop runs back through the collider's own
  pipe. 10.83 km against 13.28, with the beam lost 4.3 km along it.
- **Kicking TI 8 inward**, to lean the line back towards the collider instead of letting it
  fan out. Scanned **both** sextants either side of TI 2's, all eight collider straights,
  standoffs 1.4–9 km in 50 m steps, one *and* two dipole strings, every radius from 1.8 T up:
  no route clears both rings, anywhere. An inward kick crosses the injector's own middle and
  comes out pointing away from the collider. What *does* turn the line the other way is the
  **bend**, not the kick — see `TI8_EXIT_CELL`.
- **Magnifying transverse offsets instead of the aperture.** Rejected for a stated reason;
  see the aperture section in `physics.md`. Do not reintroduce it.

## Bugs that were silent, and how they were caught

None of these threw. All of them looked like broken physics.

- **A typed array swallows writes past its end.** Twice: the field table was allocated from
  a stale count, so sector geometry was quietly zero and beams flew off at 250 m. Whenever
  a sector is added, the capacity expression and the write loop must be changed in the same
  edit — they are two statements of the same fact and nothing checks that they agree.
- **Capture re-tested every frame** made the answer depend on the frame rate: at 200×, the
  programme moves 4.5 % of the current between frames, more than the 2 % window, so a
  captured beam was dropped and the field climbed out from under it.
- **A kicker watching the wrong element.** Beam 1 runs straight k then arc k; beam 2 runs
  the ring backwards and meets arc k off straight k+1. The beam 2 dump fired every time and
  caught nothing.
- **A bend inside the ring it takes beam from does nothing.** A magnet only bends what is in
  its own pipe, and for the first √(2ρa) of a tangential departure the bunch is still in the
  ring's. With a 6 m lead-in the beam died 428 m along a 4 km line.
- **The renderer kept shading a dipole as switched off** long after the physics had stopped
  doing it. Only the eye catches that, so `check:render` now asserts it.
- **A field written in the wrong aperture's convention.** The beam 2 dump kicker's arc is
  built for `bore = −1`, so its `fieldSign` already bends *that* bunch outward; the publisher
  then negated it again the way a twin-bore ring dipole has to be negated, and the kicker
  threw the batch inward into the ring wall. It looked like "the dump works backwards",
  which is exactly what it was. Nothing tested TD2 — `check` and `check:render` only ever ran
  TD1. Both now run both, and assert *where* the batch stops, not just that it left.
- **A dumped beam scored as absorbed from 243 m away.** A loss is anchored to the closest
  point on the closed orbit, which for a beam running down the middle of a dump line is a
  collider element hundreds of metres off once the line runs out. `isDumpEnd` asked about
  that anchor with a 720 m tolerance and answered "in the absorber" for a beam that never
  came near it. It asks about the particle's own position against the block's real volume now.
- **One global clock scaled by the collider's energy** made the injector accelerate through
  a collider ramp, and made correct physics look broken (see `architecture.md`).
- **Luminosity sampled once a frame depended on the frame rate.** Two batches cover an IP for
  6.6 % of a turn, which is two frames at 60 fps, so whether the frames landed on the burst
  decided the answer: a nominal fill read 9.1e33 instead of 1.2e34, and would have read
  something else again on a slower machine. Nothing about the number looked wrong.
- **A transfer line's `bore` is not the beam it becomes.** TI 8 leaves the injector forwards
  and arrives in the collider backwards. The bucket test read `bore`, looked for a partner
  among the batches going its own way, found none, and fired unsynchronised every time —
  which looked exactly like synchronised injection not working at all.
- **A rate above 1 was silently thrown away.** The backend's accumulator advances a particle
  at most once per iteration, and at flat top a captured beam is already at exactly 1 — so
  cogging *up* did nothing, and the control worked in one direction only, at one energy only.
  Nothing threw; the button simply had no effect at the one energy anybody collides at.
- **Bucket-synchronised injection poured a whole fill into one bucket.** Every batch after the
  first was phased against the same partner, so all of them arrived at the same place in the
  ring — and one dump pulse then took the lot. It looked like the dump being wrong.
- **Luminosity sampled against *capture* rather than geometry flickered.** A circulating bunch
  passing a transfer line's mouth is claimed by that pipe for a frame, `updateCapture` drops
  it to free flight, and it falls out of the snapshot: a nominal fill read three quarters of
  its luminosity for no reason visible in any single frame.
- **Every collision drawn at the exact centre of its detector.** The vertex was `Detector.ip`,
  full stop, so a mis-phased fill flashed at the middle of a box the picture was simultaneously
  showing had beam through one end of it only. Nothing was wrong with the physics and nothing
  in the HUD moved; it simply said the event display was decoration.
- **One interaction-region band, drawn permanently at the crossing nearest IP3.** Events flash
  at both insertions, half a turn apart — the crossing point is defined modulo C/2 — so with a
  phased fill the band sat on IP3 and IP7 lit up over what looked like empty pipe. Both the
  band (now from live positions) and the crossing tick (now at both antipodes) had to move.
- **An overlay panel laid over the machine it is a readout for.** The experiments' column was
  put at x 772 on a 1280 px canvas; the collider's tunnel wall reaches 839. Nothing could have
  caught it: the camera's margin is in the renderer, the column width is in the stylesheet,
  and no file knows both. They are one module now (`ui/layout.ts`), the stylesheet takes its
  widths from it through custom properties, and `check:render` asserts the clearance.
- **Two transfer lines drawn through each other, and nothing looked for it.** The two dump
  lines left one straight from opposite ends and crossed: 26 m between two pipes 105 m wide.
  `check:render` compared TI 2 against TI 8 for exactly this and compared nothing else, so
  four of the six pairs of lines in the model were never checked at all. It now compares every
  pair. The fix was structural rather than a tuning — within one straight there is no kicker
  length that avoids the crossing (see `beamlines.md`), which is the sort of thing that only
  becomes obvious once the constraint is written down.
- **A clock map clamped at the bottom hid the injector's whole new job.** The beam clock was
  anchored on the collider's injection and top energies and clamped below the first, so once
  the injector started at 26 GeV a batch at flat bottom and a batch ready to extract were
  drawn going at exactly the same speed. Nothing was wrong with the physics; the picture
  simply could not show the acceleration it now had. Three anchors, and the two old ones
  untouched so no measured number moved.
- **Burn-off computed, reported, and then drawn at full brightness for ever.** The charge was
  coming off the macro-particles correctly and the HUD said so, and the comet on the ring was
  identical at 100 % and at 20 % of a fresh batch. Only the eye catches that, so
  `check:render` asserts a burnt-down batch is visibly thinner — and also that it never
  becomes invisible, because a fill at a tenth is still a fill.
- **Curvature measured across a batched stroke is meaningless.** The renderer batches every
  species into one path, so consecutive points in the recorded stroke jump from the end of one
  track to the start of another. A check that "the transverse tracks curve" passed with a
  confident 180° — a straight-line drawing would have passed it too. Angles have to be taken
  on the event's own segment buffer, where two segments belong to one track only if the first
  ends exactly where the second begins.
- **A new random draw in the middle of an event generator re-rolls every event.** Adding a
  charge to each primary looked free; drawing it from the same LCG would have shifted the
  whole sequence and silently changed every collision number in `docs/reference.md`, with
  nothing failing. It is derived from the primary's index instead, and the reason is written
  where it is done.
- **"Nothing is drawn over the vertex" is not an assertion you can write by distance alone.**
  The first version counted gradient fills near the interaction point and failed on the beam
  head — which is a gradient, and which is *at* the IP because that is where the colliding
  batch is. An assertion that forbids drawing the beam where the beam is would have been the
  worse bug of the two.
- **`performance.now()` in the machine's own timing.** A kicker waiting for its bucket relaxed
  its window and timed out against the wall clock, so it behaved one way in the browser and
  never relaxed or timed out at all under `check`, which runs twenty seconds of beam in fifty
  milliseconds. Anything the machine waits for is on `World.elapsed` now.
- **Three green gates and the overlay was on top of itself.** The two experiments' cards and
  the machine readouts shared one flex rail: the moment both experiments triggered, POWER was
  crushed into a 115 px scroller, INJECTOR was pushed off the bottom of it and the lower card
  slid under the button bar. `typecheck`, `check` and `check:render` all passed, and they
  always would have — the overlay is HTML over the canvas, and an assertion about what the
  *renderer was asked to draw* cannot see a panel covering a panel. The lesson is not about
  flexbox. It is that a whole category of user-visible bug had no gate at all, and the fix was
  to add one (`check:page`) rather than to fix the instance. On its first run it found two
  more overlaps nobody had reported.
- **"There is no browser here" was written down and believed for months.** There is: Chrome is
  installed, `puppeteer-core` drives it headless, and a screenshot takes twenty seconds. Every
  layout question above was answered by *looking*. Check an environment claim before building
  around it.
- **A layout modelled as "picture plus chrome" was 60 px short of the box the browser made.**
  The numbers column beside the picture is the taller of the two, not the picture — at 148 px
  wide its values wrapped to three lines and it stood 294 px against a 235 px picture. Both
  cards then ran past the ends of their bands. Anything whose height depends on text wrapping
  has to be *measured* in a browser and re-measured by a check, never added up from the
  stylesheet.
- **Sizing a card against a whole band gives away width to whatever crosses the far end of
  it.** TI 8 cuts across the top of the space below the injector on its way in, and it alone
  cost the lower card 90 px — enough to push it out of the layout entirely. The band is asked
  for the strip the card actually occupies, in two passes: place, re-measure, re-place.
- **A boundary test written as "on or past the edge" put the injector inside its own band.**
  The bands are defined as *above the injector's top* and *below its bottom*, and the SPS's
  own extreme points landed exactly on those lines, so floating-point equality handed every
  card an obstacle at the middle of the SPS. The ring that defines a band is excluded from it.
