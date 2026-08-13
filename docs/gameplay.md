# Gameplay

`src/game/guide.ts`, the guide panel in `index.html`, stable action ids in
`ui/controls.ts`, and their responsive presentation in `style.css`.

## Two presentations of one machine

The normal page opens in **guided commissioning**. `?sandbox=1` opens the complete
operator console that existed before the game layer. The guide's `skip to sandbox`
button changes presentation in place: it does not construct another `World`, reset a
beam, or replay an operation.

The guide owns no simulated state. Each of its transitions is a predicate on the live
`World`:

1. the SPS has actually reached 450 GeV;
2. beam 1 has actually arrived in the collider through TI 2;
3. a newly delivered batch has actually reached the SPS;
4. beam 2 has actually arrived through TI 8;
5. the collider has actually reached 6.8 TeV;
6. at least one detector has non-zero luminosity after cogging.

A press alone completes nothing. While a ramp, chain delivery, kicker wait, transfer
or cogging loop is in progress, the guide exposes no new machine command and reports
the state it is waiting on.

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

## First shift

The first shift is deliberately one continuous commissioning story rather than five
unrelated tooltips:

`SPS 26 → 450 GeV` → `TI 2 / beam 1` → `new SPS batch` → `TI 8 / beam 2` →
`LHC 450 GeV → 6.8 TeV` → `automatic cogging` → `detector luminosity`.

It starts with the batch the simulator already creates in the SPS. It does not ask the
player to fill a machine that is visibly non-empty.

## Narrow screens

At 1100 CSS pixels and below, guided commissioning becomes a distinct composition:

- the guide is the only rail panel and spans the top of the viewport;
- the camera reserves the guide's measured DOM height, not a guessed constant;
- the focused control bar contains pause and at most one machine action;
- event cards are withheld on this first mobile slice, while collision vertices and
  the interaction region remain visible on the machine canvas.

The complete mobile event-display and sandbox navigation are not solved by this first
slice; see `docs/limits.md`. `check:page` measures the 390×844 entry state for overflow,
panel bounds, camera clearance and the number of exposed actions.
