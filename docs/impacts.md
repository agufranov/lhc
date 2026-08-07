# What a beam does when it hits something

`damage.ts`, `shower.ts`, and the quench rule in `world.ts` / `powering.ts`.

## Damage

`damage.ts`. A proton showers over a few interaction lengths; a *beam* vaporises the
material ahead of it and the rest fly down the channel (hydrodynamic tunnelling). Two
constants are **calibrated, not derived**: they reproduce ~35 m of channel for a full
6.8 TeV beam, which is the figure the LHC is quoted at. One *batch* is a twelfth of that
beam, so what is actually seen here is 4.4 m at flat top and 1.4 m at injection — with peak
channel temperatures of 6117 K and 1323 K, vaporised and merely warmed. Temperature is
energy over the heat capacity of the channel. Sites **do not cool** — the heat cloud marks
what the beam did, and a mark that fades is a mark you miss. Scars survive re-injection.

## An impact is a cascade, not a blow

`shower.ts` builds the tree a stopping proton actually makes: it hits a nucleus, the debris
hits more nuclei, and the count doubles until nothing has the energy to make anything new.
Four species, each with its own reach, and that is what the colours are:

- **charged hadrons** interact every nuclear interaction length (15 cm in copper) and carry
  the cascade forward. They are the trunk.
- **the electromagnetic component** — every third pion is a π⁰ and becomes two photons, which
  work on the *radiation* length, 1.4 cm, ten times shorter. Short, dense, bright, and over
  in 28 cm against the hadronic part's two metres.
- **neutrons** wander further and make the tail; **muons** barely interact and leave straight.

Built once, at the loss, and kept on the `DamageSite` — a shower re-rolled every frame is a
boiling smear rather than something that happened. Deterministic in its seed. **The same
function is the collision mechanic**: same tree, different primary energy, two of them back
to back. See `collisions.md`.

Three things about it are budget, not physics, and each is measured in `check`:

- **192 segments** of the 300–500 particles the cascade makes (a real 6.8 TeV shower is tens
  of thousands). The budget is spent **hardest first** so it buys the trunk and the branches
  hang off it; spent in generation order it fans out at the third branching and draws a bush.
  Measured: 3 generations that way against 10 this way.
- **The electromagnetic part is followed 4 generations and handicapped in the queue.** It
  halves its energy every 1.4 cm, so "hardest first" dives into it and never comes back:
  172 of 192 segments electromagnetic, a cascade 0.9 m long and 2 cm wide.
- **A soft hadron does not get a whole interaction length.** It ionises to a stop in
  centimetres. Without that the wide-angle tail wandered a metre out and a 450 GeV shower
  came out wider than it was long.

Measured shape: 3.06 m × 0.25 m at 450 GeV, 2.87 m × 0.03 m at 6.8 TeV — a spike, which is
correct and unreadable, so the renderer standardises the drawn aspect (`SHOWER_ASPECT`) and
gives the cascade its own magnification (`SHOWER_SCALE` = 180, against the channel's 24). The
two differ on purpose: the channel is a hole bored into the wall and has to stay inside the
tunnel, and the shower is exactly the part of the event that does not stay inside anything.

## Quench is a heating rule, and heat does not read the element table

A loss deposits into the **nearest superconducting cold mass**, not into the element the
aperture table says the particle was in, with the fraction that reaches the coil falling off
as `exp(−gap / apertureRadius)`. The rule used to be "inside an arc, or nothing happens",
so a batch that hit the wall of a straight a few metres from a dipole left it at 1.9 K while
the same batch a metre further on took the whole sector down. `BeamLoss` carries `coilGap`
and `coilFraction` so the answer is inspectable rather than mysterious.

What that gives, at flat top (a sector takes 15.6 MJ before it goes normal):

```
gap from the coil   reaches it   6.8 TeV batch   450 GeV batch
        0 m            100 %      1.98 K quench   0.13 K holds
      100 m             67 %      1.33 K quench   0.09 K holds
      200 m             45 %      0.89 K holds    0.06 K holds
      500 m             14 %      0.27 K holds    0.02 K holds
```

**Known limit, and the reason most hits still do not quench:** the deposit is spread over the
whole 4235 t string, so it takes ~16 MJ, and a 450 GeV batch is 1.9 MJ — it never quenches
anything at any distance. A real magnet quenches on a few mJ/cm³ and *any* full batch on a
coil would take it down. Heating one dipole's 27.5 t instead of the string's 4235 t is the
one-line change that would do it; it is not made because it also deletes the deliberate
"survivable at injection, fatal at flat top" behaviour the load line exists for. That is a
balance decision, not an oversight.

## Quenches that no beam caused

Not every quench here comes from a hit any more. A cryogenics fault takes a sector down with no
loss at all, a power glitch trips a circuit off with beam still in it, and the 2008 interconnect
failure takes three sectors and the beams together. All of them reach for the machinery on this
page — `MagnetCircuit.quench`, `deposit`, `enabled` — and none of them adds any: an incident that
needs new machinery is a cutscene. What they are, how often, and why they are switched off in a
headless run: `running.md`.
