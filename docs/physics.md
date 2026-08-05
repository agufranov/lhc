# Physics: the ring, the pusher, and the one deliberate lie

What is simulated in `lattice.ts`, `field.ts`, `aperture.ts` and the backends.

## The model

- **Lattice.** N cells of `straight + arc`, every arc bending exactly 2π/N, so the ring
  closes by construction. LHC: 8 cells, ρ = 2803.93 m from 1232 × 14.3 m of dipole in
  26 658.883 m. SPS: 6 sextants, ρ = 741.3 m from 744 × 6.26 m in 6911.5 m, giving
  2.025 T at 450 GeV. A ring also carries its `placement` (where it sits in the world),
  its `sense` (+1 turns left, −1 turns right) and whether its magnets are twin-bore.
- **Pusher.** Exact velocity rotation by ω·dt, ω = qB/(γm), position advanced with the
  mid-step velocity. For a purely magnetic field this is what Boris reduces to; |v| is
  conserved to machine precision, so the integrator can never fake acceleration.
- **Field is integrated over the step, not sampled at a point.** A hard in/out test
  quantises each arc's bend to a whole step (~4 mrad, enormous) and the error is
  systematic — the orbit spirals out and the beam dies in a few turns. Weighting B by
  the fraction of the step inside the sector removes it entirely.
- **Per-sector excitation.** `setFieldScales` carries one signed tesla per sector per
  aperture, computed from that circuit's *own* current. This is what makes switching a
  magnet off mean anything.
- **Beam momentum follows the ramp programme, not the mean circuit current.** The RF
  holds the energy. A dead magnet stops bending the protons; it does not slow them down.
  Hence `Machine.programmedCurrent`.
- **Both rings run an energy programme**, and `RingConfig.rampRate` is what says which kind
  of machine each one is: 10 A/s on the collider, 1035 s to take 733 → 11 080 A, the real
  twenty-minute ramp; 48 A/s on the injector, 100 s for 26 → 450 GeV. See `beamlines.md`
  for what the injector's ramp changed, and `limits.md` for why its rate is not the real one.
- **No focusing.** No quadrupoles, no correctors — this is a 2D horizontal view and a
  dipole-only ring is only weakly focusing. Any field error is therefore fatal, which is
  correct for what is modelled and worth saying out loud when it surprises someone.

## The one deliberate lie: the aperture

`apertureRadius = 250 m`; the real pipe (`beamPipeRadius = 0.0289 m`) is quoted but not
simulated. A field-free particle leaves an aperture `a` after √(2aρ): 13 m for a real
pipe, i.e. one pixel on a ring 8 km wide. With a faithful aperture, "no magnets means a
straight line" — the most important thing this simulation has to show — is invisible.

At 250 m the straight flight is kilometres and the aperture is ~20 px tall. The HUD
reports the true offset in mm next to what a real ±28.9 mm pipe would have made of it,
so nothing is hidden. `fieldRegionHalfWidth = 320 m` must stay larger than the aperture
or a particle could leave the field before it reaches the wall.

There was an earlier design that kept a 29 mm aperture and magnified transverse offsets
~3600× for drawing. It was rejected: under magnification a straight line still leaves
the pipe in one pixel of longitudinal travel, so the correct physics looked like a
scripted instant death. Do not reintroduce it.

The injector's aperture is the same lie scaled by ρ: 66 m on ρ = 741.3 m is the same
fraction of its ring that 250 m is of the LHC's, so both pipes are drawn the same
relative width and a field-free straight line is as visible in one as in the other. Keep
that ratio if you add a third ring.
