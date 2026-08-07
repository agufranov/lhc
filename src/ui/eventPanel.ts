/**
 * One experiment's panel: the transverse event display, and the few numbers that say what
 * you are looking at.
 *
 * ## What is on it, and why it is not every collision
 *
 * A running insertion produces about a billion inelastic collisions a second. Drawing them
 * as they come — one flash every half second, each replacing the last — is a strobe: the eye
 * gets "collisions are happening", which the luminosity readout already says in a form you
 * can compare, and nothing else. Nothing can be read off a picture that is replaced before
 * it has been looked at.
 *
 * What a real experiment does with that flood is the answer, and it is one of the central
 * facts about the machine rather than a workaround: it **triggers**. It keeps the events with
 * something hard in them, throws the rest away in microseconds, and what ends up on the wall
 * in the control room is the interesting one, held. So this panel holds the best collision
 * the experiment has recorded, says what it was kept for, and — the number that makes the
 * point — says how many interactions it was picked out of.
 *
 * The bar decays (see `TRIGGER_DECAY`), so a monster event owns the display for a few seconds
 * and then lets the next one in. Without that the first lucky 40 GeV lepton would freeze the
 * panel for the rest of the session.
 */

import type { Detector } from '../sim/detector';
import type { World } from '../sim/world';
import {
  BARREL,
  DETECTOR_RADIUS_M,
  SPECIES_EM,
  SPECIES_HADRON,
  SPECIES_HEAVY,
  SPECIES_KAON,
  SPECIES_LEPTON,
  SPECIES_MUON,
  SPECIES_NEUTRON,
} from '../sim/shower';
import { EventDisplay } from '../render/eventDisplay';
import { Readout } from './readout';
import { count } from './format';

/** Seconds the "just recorded" flash on the vertex lasts. */
const FLASH = 0.9;

/** Short names for the object list — a narrow column has room for three of these. */
const SHORT_NAME: Record<number, string> = {
  [SPECIES_HADRON]: 'π',
  [SPECIES_EM]: 'γ',
  [SPECIES_NEUTRON]: 'n',
  [SPECIES_MUON]: 'μ',
  [SPECIES_KAON]: 'K',
  [SPECIES_HEAVY]: 'b/c',
  [SPECIES_LEPTON]: 'lep',
};

export class EventPanel {
  private display: EventDisplay;
  private rows: Readout;
  private detector: Detector;
  private root: HTMLElement;
  /** True once this experiment has triggered on anything. See `update`. */
  private live = false;
  /** Identity of what is on screen, so the canvas is only redrawn when it changes. */
  private shown: unknown = null;
  private shownAt = -1e9;
  private drawn = false;

  constructor(root: HTMLElement, detector: Detector) {
    this.detector = detector;
    this.root = root;
    root.innerHTML = '';
    // Nothing until this experiment has seen something. An empty display holding two hundred
    // pixels of picture against the day it has an event is worse than no display at all, and
    // "the experiments arrive when the beams start colliding" is a truer thing for the
    // machine to say than a permanent box reading "no collisions".
    root.hidden = true;

    const h = document.createElement('h2');
    // Named, with its point beside it: the experiments here are the real ones and the
    // straights they stand in are not theirs, so the picture says both. See `DETECTOR_CELLS`.
    h.textContent = `${detector.config.name} · ${detector.config.point}`;
    root.append(h);

    const canvas = document.createElement('canvas');
    canvas.className = 'event-view';
    canvas.title =
      'The collision seen down the beam pipe, through the whole barrel.\n\n' +
      'Inside out: beam pipe, four pixel layers, four strip layers, a straw tracker, the ' +
      'solenoid, a presampler and three electromagnetic samplings, three tile samplings, ' +
      'eight toroid coils and three muon stations.\n\n' +
      'The dots are hits — what the tracker actually measures. A track is a fit through ' +
      'them, and a neutral leaves none at all, which is how a photon is told from an ' +
      'electron: calorimeter energy with nothing pointing at it (marked ° on its label).\n\n' +
      'Tracks curve inside the solenoid and run straight outside it, because the barrel ' +
      'bending out there is a toroid and bends in the other plane. Curvature is momentum; ' +
      'below about 0.35 GeV/c a track spirals up inside the tracker and never gets out.\n\n' +
      'Lit cells are the towers the particles landed in, at the azimuth the bend left them ' +
      'at — blue electromagnetic, orange hadronic. Depth matters: an electromagnetic shower ' +
      'dies in sampling 2, a hadron is still going in sampling 3 and punches into the tile.';
    // The picture and its numbers side by side, not stacked. Stacked, the panel was 360 px
    // tall and two of them plus the machine readouts did not fit an 860 px window; beside
    // each other it is 246 px *and* the canvas is bigger, which is the whole trade.
    const body = document.createElement('div');
    body.className = 'event-body';
    body.append(canvas);
    root.append(body);
    this.display = new EventDisplay(canvas);

    const side = document.createElement('div');
    body.append(side);
    this.rows = new Readout(side, '');
    // The Readout writes its own (empty) heading; drop it, the panel already has one.
    side.querySelector('h2')?.remove();
    this.rows.row(
      'kept',
      'trigger',
      `the stream this event went down and the object that fired it. A readout does not ` +
        `write "an event", it writes one into a stream named for what fired the trigger — ` +
        `and the two experiments do not agree about that, because a trigger is built out of ` +
        `the detector behind it. ${detector.config.name} is built around ` +
        `${detector.config.specialtyLabel}, so those clear the bar here at a momentum that ` +
        `would be thrown away at the other point.`,
    );
    this.rows.row(
      'objects',
      'objects',
      'the hardest few things that came out, by transverse momentum. ° means it left no ' +
        'track in the tracker — a neutral, known only by the energy it dropped in the ' +
        'calorimeter',
    );
    this.rows.row(
      'measured',
      'tracker',
      'tracker hits and how much of the event they came from: a charged particle leaves a ' +
        'hit on every layer it reaches, a neutral leaves none, and one curled up by the ' +
        'solenoid never leaves the tracker at all',
    );
    this.rows.row(
      'et',
      'Σ pT',
      'transverse momentum summed over everything that came out, and how many things reached ' +
        'the muon chambers — eleven metres of lead and steel out from the vertex',
    );
    this.rows.row(
      'rate',
      'picked from',
      'inelastic interactions per event this experiment has put on the display, with the ' +
        'pile-up of the crossing it came out of. A real experiment sees about a billion ' +
        'interactions a second and writes a thousand; the rest are thrown away in ' +
        'microseconds, on this same question — is there anything hard in it?',
    );

    // The layer legend, under the numbers rather than under the picture: it never changes,
    // so it belongs at the bottom of the column that is read, not the one that is watched.
    //
    // **One line, not three.** It is a caption on a picture that has not changed since the
    // session started, and three lines of it cost a card three lines of height that the
    // numbers above — which do change — had to give up. What the layers *are* is on the
    // picture's own tooltip, which is where a reader who wants them will look.
    const note = document.createElement('div');
    note.className = 'event-note';
    note.textContent = `r–φ · ${DETECTOR_RADIUS_M} m · ${BARREL.length} layers`;
    side.append(note);
  }

  /** True once this panel is on screen, so the rail around it knows whether to be there. */
  get visible(): boolean {
    return this.live;
  }

  update(world: World): void {
    const det = this.detector;
    const kept = det.kept;

    // It appears on the first trigger and then stays: the trigger holds an event, so there is
    // always something to look at from that moment on, and a panel that came and went with
    // the beam would be a flicker rather than a readout.
    if (!this.live) {
      if (!kept) return;
      this.live = true;
      this.root.hidden = false;
      this.display.dirty = true;
    }

    if (kept !== this.shown) {
      this.shown = kept;
      this.shownAt = world.elapsed;
      this.drawn = false;
    }
    // The trigger holds one event for seconds at a time, so redrawing it every frame is a
    // hundred wedges a second of identical picture. Only while the flash is fading, or once
    // when it changes.
    const age = world.elapsed - this.shownAt;
    this.display.resize();
    if (!this.drawn || age < FLASH || this.display.dirty) {
      this.display.render(kept ? kept.transverse : null, Math.max(0, 1 - age / FLASH));
      this.drawn = true;
    }

    if (!kept) {
      for (const key of ['kept', 'objects', 'measured', 'et', 'rate']) {
        this.rows.set(key, '—', 'idle');
      }
      return;
    }

    const t = kept.transverse;
    const pt = kept.score;
    // The stream, not the species name: "single-μ, 6.1 GeV" says both what it was and what
    // the experiment did with it, in the same width the species alone used to take.
    this.rows.set(
      'kept',
      `${kept.stream} · ${pt < 10 ? pt.toFixed(1) : pt.toFixed(0)} GeV`,
      pt > 10 ? 'warn' : pt > 3 ? 'hot' : undefined,
    );
    // Named, because "some circles" is not a readout. Three fit; the rest are on the picture.
    this.rows.set(
      'objects',
      t.objects.length > 0
        ? t.objects
            .slice(0, 3)
            .map((o) => `${SHORT_NAME[o.species] ?? '?'}${o.neutral ? '°' : ''} ${o.pt.toFixed(1)}`)
            .join(' · ')
        : 'all soft',
      t.objects.length > 0 ? undefined : 'idle',
    );
    // Shortened, all three of them: this column sets the height of the card, and a value
    // that wraps to three lines costs the picture beside it two. The tooltips still say
    // what each number is.
    this.rows.set('measured', `${t.hitCount} hits · ${t.charged}/${t.primaries} charged`);
    this.rows.set(
      'et',
      `${t.sumEt.toFixed(0)} GeV · ${t.muonTracks > 0 ? `μ×${t.muonTracks} through` : 'none through'}`,
      t.muonTracks > 0 ? 'hot' : undefined,
    );
    const pileUp = kept.pileUp > 0.05 ? ` · ${kept.pileUp.toFixed(0)} at once` : '';
    this.rows.set(
      'rate',
      det.selectivity > 1
        ? `1 in ${det.selectivity.toExponential(1)}${pileUp}`
        : `${count(det.recorded)} kept${pileUp}`,
    );
  }
}
