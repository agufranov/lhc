# The run: what it is for, when to end it, and what interrupts it

`analysis.ts`, `incidents.ts`, the fill book-keeping in `world.ts`, `render/spectrum.ts`, and
the run panel in `ui/hud.ts`.

Everything else in this repository is a machine. This page is about the thing the machine is
*for* — and about the fact that a collider which is running perfectly is a stationary state,
which is the one shape a toy must not have. Reaching two colliding beams used to be the end of
the game. It is now the beginning of one.

Three mechanisms, and they interlock: **the spectra** give a reason to keep running, **the fill
economics** give something to decide while it runs, and **the incidents** take it away.

## The spectra: a run turns into one plot

`analysis.ts`. Two histograms, and both are the real ones:

- **μ⁺μ⁻ invariant mass, 1 to 200 GeV, log–log.** The most reproduced plot in particle
  physics, and the first thing a new detector does is rediscover it: the J/ψ (charm, 1974), the
  ψ′, the three Υ states (beauty, 1977) and the Z (1983), sitting on the Drell–Yan continuum.
  Masses and widths are the real ones; the cross-sections reproduce the real ratios — about a
  hundred J/ψ per Z.
- **γγ, 100 to 160 GeV, linear.** The Higgs window. σ(pp→H) is 55 pb and H → γγ takes 2.27 per
  mille of it, against a continuum four hundred times bigger, so the whole measurement is a bump
  of a few hundred on tens of thousands. **The only reason it can be seen at all is resolution**:
  1.3 % puts the signal in a 3 GeV window while the background is spread over sixty. That is
  why the plot is linear — a log axis would hide the one thing on it.

**It is computed from ∫L dt, not accumulated from the events that are drawn**, and that is the
same argument the luminosity makes one file over. A cascade is built for roughly one collision
per pass of two batches; a histogram filled from those would be a picture of the drawing budget.
So the whole spectrum is a function of one number:

```
N(bin) = ∫L dt × Σ_source σ_eff × (fraction of that source in the bin)
```

with resonances integrated over each bin with an error function (the bins are wider than the
J/ψ) and the continuum integrated analytically. `check` asserts that the same ∫L handed over in
one step and in a thousand gives an identical histogram.

**One realisation, frozen.** The expectation alone is a smooth curve — a theory plot, not a
measurement — and a discovery is a statistical statement. So each bin carries a standard normal
drawn once at construction and shows `N + z√N`: Poisson to first order, and *stable*, because a
fluctuation re-rolled every frame would shimmer. The significance is computed from the
expectation, because that is what significance means.

**It does not reset when the beams are dumped.** The data is on tape. That single property is
what makes a session an arc instead of a sequence of identical episodes, and it is why the
plots live in the run panel and not in an experiment's card.

The exposure a five-sigma γγ excess takes is printed by `check`, in fb⁻¹ *and* in minutes of
play at a nominal fill — because that second number is the design question, and the answer has
to be a session rather than a week. `HIGGS_BOOST` is the one number here that is not real; see
`limits.md`.

## The fill: an episode, with an end and a score

A **fill** opens at the first proton on the collider's orbit and closes when the last one
leaves — dumped, thrown into a wall, or taken by an incident. It is the same geometric snapshot
the luminosity is built on (`forward`/`reverse`), for the same reason.

What it accumulates is what an operator is judged on and none of it is recoverable afterwards:
stable-beam seconds, ∫L dt, peak luminosity, incidents, quenches. When it closes, `FillReport`
is what the panel shows, including the number the real operations group lives by — **what
fraction of the whole cycle, turnaround included, was actually colliding.**

### When to dump: √(τ·T)

The one calculation in the toy that tells you to press a button. With a beam decaying at
lifetime τ and a turnaround T after every fill, the average luminosity over the cycle is
maximised by running each fill for **√(τ·T)**. It is the standard result, and the real machine's
numbers put it where the real machine runs: 46 h of lifetime and 4 h of turnaround give 14 hour
fills.

Both inputs here are measured rather than assumed. τ is the machine's own present loss rate —
burn-off, times whatever a vacuum fault is doing — and T is the turnaround **this operator has
actually been taking**, averaged over the fills so far (`DEFAULT_TURNAROUND` until there is one
to measure). Because the turnaround here is compressed far harder than the beam lifetime is, the
answer comes out around a minute of play rather than half a day, which is the right tempo for a
game and is arrived at honestly.

The readout says `after 3.4 h — 62 s to go`, and then `past it — dump it`.

## The incidents: the machine is not the only thing running

`incidents.ts`. Six of them, and **not one needs a mechanism the model did not already have**:
each reaches for a quench, a circuit trip, the dump kickers, or the population of a beam. That
is the test of whether an incident is real or is a cutscene — if it needs new machinery, it is a
cutscene.

| id | what it is | what it does |
| --- | --- | --- |
| `ufo` | a dust grain falls into the beam | loss monitors over threshold, beams dumped |
| `rf` | a cavity trips and its bunches debunch | beams dumped by the interlock |
| `vacuum` | pressure rise: beam–gas scattering | the fill burns 6–16× faster for a while |
| `power` | an 18 kV dip opens a breaker | one arc's dipoles trip off, with beam in them |
| `cryo` | loss of cold in a sector | that sector quenches with no beam loss at all |
| `interconnect` | a splice goes resistive above 75 % of nominal | three sectors quench, helium in the tunnel |

**The rates are the real machine's order of magnitude.** MTBFs are quoted in hours of machine
time and printed by `check` beside what that comes to in minutes of play. A UFO dumps the real
LHC a couple of dozen times a year against ~1500 hours of stable beams; RF and cryogenics are
the next most common causes of a premature dump. `interconnect` is once in a machine's lifetime,
and it is 19 September 2008 — a bad splice at 8.7 kA on the way to 5.5 TeV, an arc through the
helium enclosure, six tonnes of helium into the tunnel, fifty-three magnets damaged, fourteen
months lost.

Three rules hold the system together:

- **Off unless asked.** `IncidentSystem.enabled` is false by default and `main.ts` switches it
  on in sandbox. It stays off during guided commissioning, before machine protection has been
  introduced. A headless run is a measurement and a measurement with random interruptions is not one —
  at these rates about a quarter of `check`'s thirty-second blocks would be interrupted, and
  every number in `reference.md` would become a number *usually*. The browser gates open the
  page with `?quiet=1` for the same reason, and then force the one they want to test.
- **One at a time.** A global cool-down of `IncidentSystem.COOLDOWN`, because two alarms in the
  same second read as a bug rather than as bad luck.
- **Forced and scheduled are the same event.** `World.forceIncident` runs the identical path,
  so `check` and `check:page` are testing the thing that happens rather than a rehearsal of it.

**The press turns up.** Every proposed catastrophe — black holes, strangelets, vacuum decay —
gets one line in the log with the answer beside it, and the answer is always the same and is
better physics than the scare: the cosmic ray flux has been running this experiment on the
Earth, the Moon and every star for billions of years at energies this machine cannot reach.
That is what the 2008 LHC Safety Assessment Group report is built on. The permanent line in the
run panel reads `no black holes · world still here`, and the argument is in its tooltip.

## What is drawn, and where

- **The run panel is at the top of the right rail, not in the left one.** Measured: the left
  rail is already ~85 px over a 906 px window with BEAM and PHYSICS in it, and those are the
  readouts you operate *against*. The spectra are what you look at once the machine is running
  itself. Both rails scroll; `check:page` asserts that no *panel* is crushed, which is a
  different failure and the one that once shipped.
- **The ticker lives inside the title block**, because the camera is fitted against that block's
  measured height — so the machine makes room for it by itself. Its height never changes,
  whatever it says, or the picture would resize every time something went wrong. When nothing is
  wrong it says what to do next; when something is, it says that, in red.
- **A quieter line never shouts over a louder one.** See `lessons.md`: the catastrophe's banner
  and the red tint were both being replaced two frames later by `fill 1 ended — beam dump`.
- **The ground shakes and the lights go red**, and the shake is applied to the *drawing* only.
  The camera is what the overlay's geometry is derived from, so shaking that would jitter every
  panel in the window and could walk a card onto the machine — the one thing the layout may not
  do. `check:render` asserts the bands do not move, and that the tint belongs to the catastrophe
  alone.
