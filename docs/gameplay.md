# Gameplay

`src/game/guide.ts`, `src/game/productionShift.ts`, the guide panel in `index.html`, stable action ids in
`ui/controls.ts`, and their responsive presentation in `style.css`.

## Two presentations of one machine

The normal page opens in **guided commissioning**. `?sandbox=1` opens the complete
operator console that existed before the game layer. The guide's `skip to sandbox`
button changes presentation in place: it does not construct another `World`, reset a
beam, or replay an operation.

The guide owns no simulated state. Commissioning transitions are predicates on the live `World`:

1. the SPS has actually reached 450 GeV;
2. beam 1 has actually arrived in the collider through TI 2;
3. a newly delivered batch has actually reached the SPS;
4. beam 2 has actually arrived through TI 8;
5. the collider has actually reached 6.8 TeV;
6. at least one detector has non-zero luminosity after cogging.

A press alone completes nothing. While a ramp, chain delivery, kicker wait, transfer
or cogging loop is in progress, the guide exposes no new machine command and reports
the state it is waiting on.

The game layer does own scenario state: the production deadline, objective and frozen result.
It never owns a second copy of a beam, fill or clock. Those are still read from `World`.

## Progressive controls

`Controls` still constructs one complete operator panel with the original handlers.
Every machine command has a stable `data-action`; labels remain presentation. Guided
mode hides every action except the one being taught, while pause and the exit to
sandbox remain available. Sandbox removes those presentation classes and reveals the
same controls again.

Potentially bad operations are still allowed in sandbox. The pre-existing rule remains:
a control is greyed only when it would do nothing, never because the result would be
instructively destructive.

Random incidents are disabled during commissioning, before any protection system has
been introduced. They are enabled on a normal sandbox page and remain disabled under
`?quiet=1` for deterministic measurements.

## Commissioning

The first shift is deliberately one continuous commissioning story rather than five
unrelated tooltips:

`SPS 26 → 450 GeV` → `TI 2 / beam 1` → `new SPS batch` → `TI 8 / beam 2` →
`LHC 450 GeV → 6.8 TeV` → `automatic cogging` → `detector luminosity`.

It starts with the batch the simulator already creates in the SPS. It does not ask the
player to fill a machine that is visibly non-empty.

Reaching luminosity opens `start production shift` without resetting `World`. Sandbox remains
available, but is no longer presented as the only thing to do after commissioning.

## Production shift

The first scored scenario lasts 180 wall seconds, or ten machine hours at the standard 200×
operations clock. Its data target is 0.030 fb⁻¹ measured from the instant the shift starts.
Passing requires all three of these facts to be true before the clock closes:

1. the experiments collected the data target;
2. at least one fill ended through a deliberate `operator dump`;
3. a later fill reached non-zero stable-beam time.

This makes collisions the start of the loop. The player watches burn-off and the modelled
`√(τ·T)` optimum, chooses a dump time, then pays the physical turnaround: LHC ramp-down, two
new SPS batches through TI 2 and TI 8, LHC ramp and cogging. There is no refill command that
constructs beams outside these operations.

At the deadline the score freezes, any live beam is safely sent through both dump lines, and
the report appears only when the collider is empty. It reports data, stable-beam availability,
measured turnaround, operator dumps, quenches and damage. Random incidents remain disabled in
this first scored shift; they belong to the later machine-protection scenario.

## Narrow screens

At 1100 CSS pixels and below, the guided game becomes a distinct composition:

- the guide is the only rail panel and spans the top of the viewport;
- the camera reserves the guide's measured DOM height, not a guessed constant;
- the focused control bar contains pause and at most one machine action;
- event cards are withheld on this first mobile slice, while collision vertices and
  the interaction region remain visible on the machine canvas.

During production the guide adds the remaining-time clock, data meter and large dump decision.
The scientific run panel is visible beside the machine on desktop; on a phone the same spectra
remain a separate future focus view rather than being squeezed beside the ring.

The complete mobile event-display and sandbox navigation are not solved by this first
slice; see `docs/limits.md`. `check:page` measures the 390×844 entry state for overflow,
panel bounds, camera clearance and the number of exposed actions.
