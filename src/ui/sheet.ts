/**
 * The bottom sheet: the machine readouts on a screen too narrow to stand them beside the
 * machine.
 *
 * ## Why the panels move rather than being rebuilt
 *
 * Every readout in this app is built once and then written into by key (`Readout`), and the
 * HUD holds references to the elements it writes. So the sheet does not build a mobile copy of
 * anything — it **moves the same panel elements** into itself and hands them back to their
 * rails when the window is wide again. There is one BEAM panel in this app, it is updated by
 * one line of `hud.ts`, and which column it is standing in is a fact about the window.
 *
 * The same goes for the experiments' cards: on a phone they are a tab in here rather than a
 * card placed beside the machine, and it is the same element with the same canvas in it.
 *
 * ## What it is, exactly
 *
 * A strip of tabs, **one line of numbers that is always there**, and one group of panels at a
 * time — at the bottom of the window, and **the picture is fitted above it**, which is the
 * whole reason the machine is still visible on a phone. Its height is published to `main.ts`,
 * which adds it to what the camera has to keep clear, so the invariant survives the small
 * screen intact: no panel is drawn over the machine, on any size of window.
 *
 * **It starts folded, and that is the important decision.** Open, it is a third of the window
 * and the whole complex is drawn 260 px across; folded, the machine gets some 550 px of a
 * 844 px phone. What makes folding affordable is the peek line: energy, what is in each beam,
 * and the luminosity, which is what somebody watching wants to know without asking. The rest
 * is one tap away, and a tap on any group opens it.
 *
 * The groups are not one tab per panel. Five panels and two experiments is seven tabs on a
 * 390 px screen, which is a scroller; grouped by what they answer — what the beam is doing,
 * what the run has collected, what the machine's own state is — it is three, plus an
 * experiment's tab that appears when that experiment has something to show.
 */

import type { World } from '../sim/world';
import { energyGeV } from './format';

export interface SheetGroup {
  id: string;
  label: string;
  /** Panel element ids, in the order they are stacked. */
  panels: string[];
  /** Shown only when at least one of its panels has something in it. */
  whenVisible?: boolean;
}

const GROUPS: SheetGroup[] = [
  { id: 'beam', label: 'beam', panels: ['panel-beam', 'panel-physics'] },
  { id: 'run', label: 'run', panels: ['panel-run'] },
  { id: 'machine', label: 'machine', panels: ['panel-power', 'panel-injector', 'panel-compute'] },
  { id: 'ip-a', label: '', panels: ['panel-ip-a'], whenVisible: true },
  { id: 'ip-b', label: '', panels: ['panel-ip-b'], whenVisible: true },
];

export class Sheet {
  private root: HTMLElement;
  private tabsRoot: HTMLElement;
  private body: HTMLElement;
  private toggle: HTMLButtonElement;
  /** The one line that is on screen whether the sheet is open or shut. */
  private peek: HTMLElement;
  private peekText = '';
  private tabs = new Map<string, HTMLButtonElement>();
  /** Where each panel came from, so it can be put back when the window grows. */
  private home = new Map<string, HTMLElement>();
  private current = 'beam';
  private open = true;
  private attached = false;

  constructor(labels: { ipA: string; ipB: string }) {
    this.root = document.getElementById('sheet')!;
    this.tabsRoot = document.getElementById('sheet-tabs')!;
    this.body = document.getElementById('sheet-body')!;
    GROUPS[3].label = labels.ipA;
    GROUPS[4].label = labels.ipB;

    for (const group of GROUPS) {
      const el = document.createElement('button');
      el.className = 'sheet-tab';
      el.textContent = group.label;
      el.addEventListener('click', () => this.show(group.id));
      this.tabsRoot.append(el);
      this.tabs.set(group.id, el);
    }

    this.toggle = document.createElement('button');
    this.toggle.className = 'sheet-toggle';
    this.toggle.title = 'Folds the readouts away and gives the machine the screen.';
    this.toggle.addEventListener('click', () => this.setOpen(!this.open));
    this.tabsRoot.append(this.toggle);

    this.peek = document.createElement('div');
    this.peek.className = 'sheet-peek';
    this.root.insertBefore(this.peek, this.body);

    for (const id of GROUPS.flatMap((g) => g.panels)) {
      const el = document.getElementById(id);
      if (el?.parentElement) this.home.set(id, el.parentElement);
    }
    // Folded to start with: the picture is what a phone has least of.
    this.setOpen(false);
  }

  /**
   * Takes the panels into the sheet, or gives them back to their rails.
   *
   * Idempotent, because it is called from a media-query listener and from the frame loop, and
   * moving an element that is already where it should be would reset the scroll of whatever
   * the reader was in the middle of.
   */
  attach(mobile: boolean): void {
    if (mobile === this.attached) return;
    this.attached = mobile;
    this.root.hidden = !mobile;
    document.body.classList.toggle('is-mobile', mobile);
    for (const group of GROUPS) {
      for (const id of group.panels) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (mobile) {
          el.dataset.group = group.id;
          this.body.append(el);
        } else {
          delete el.dataset.group;
          this.home.get(id)?.append(el);
        }
      }
    }
    // `applyGroups` and not `show`: attaching must not decide whether the sheet is open. It
    // starts folded and stays however the reader left it.
    this.applyGroups();
  }

  /**
   * Which group is on screen.
   *
   * A tap on a group opens the sheet at it; a tap on the group already open folds it away
   * again, which is the same gesture doing the obvious thing in both directions and saves the
   * chevron from being the only way to get the picture back.
   */
  show(id: string): void {
    if (id === this.current && this.open) {
      this.setOpen(false);
      return;
    }
    this.current = id;
    this.applyGroups();
    this.setOpen(true);
  }

  /** Puts the panels of the current group on screen and takes the rest out of the layout. */
  private applyGroups(): void {
    for (const [tab, el] of this.tabs) el.classList.toggle('is-current', tab === this.current);
    for (const group of GROUPS) {
      for (const panelId of group.panels) {
        const el = document.getElementById(panelId);
        if (el && this.attached) el.classList.toggle('sheet-hidden', group.id !== this.current);
        else el?.classList.remove('sheet-hidden');
      }
    }
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.root.classList.toggle('is-collapsed', !open);
    this.toggle.textContent = open ? '▾' : '▴';
  }

  /**
   * Keeps the experiments' tabs in step with whether those experiments have anything to show,
   * and drops a tab whose panel has gone away — which also has to move the reader off it.
   *
   * Called every frame; every write is guarded, so a frame in which nothing changed writes
   * nothing.
   */
  update(world: World): void {
    if (!this.attached) return;

    // What is worth knowing without opening anything: what the beams are, what is in each of
    // them, and whether they are colliding. The same three questions BEAM and PHYSICS answer
    // at length, asked of the same functions the HUD asks — `bunchesInBeam` is what says how
    // many batches are going each way round the collider.
    const b1 = world.bunchesInBeam(0, 1);
    const b2 = world.bunchesInBeam(0, -1);
    const lumi = world.detectors.reduce((max, d) => Math.max(max, d.smoothed), 0);
    // Exponential and not SI prefixes: a luminosity is 1e33, and `si` walks a table that
    // stops at tera — it printed `893365744124313075712 Tcm⁻²s⁻¹`. The HUD writes it the way
    // the field does, and so does this. The threshold is the HUD's too: below 1e28 there is
    // nothing happening worth a number.
    const text =
      `${energyGeV(world.collider.telemetry().energyGeV)} · B1 ${b1 || '—'} · B2 ${b2 || '—'} · ` +
      `L ${lumi > 1e28 ? `${lumi.toExponential(1)} cm⁻²s⁻¹` : '—'}`;
    if (text !== this.peekText) {
      this.peekText = text;
      this.peek.textContent = text;
    }

    for (const group of GROUPS) {
      if (!group.whenVisible) continue;
      const panel = document.getElementById(group.panels[0]);
      const has = panel !== null && !panel.hidden;
      const tab = this.tabs.get(group.id)!;
      if (tab.hidden === !has) continue;
      tab.hidden = !has;
      if (!has && this.current === group.id) {
        this.current = 'beam';
        this.applyGroups();
      }
    }
  }

  /**
   * How much of the window the sheet is standing over [CSS px].
   *
   * Read by `main.ts` twice over: the camera is fitted above it, and it is published to the
   * stylesheet as `--sheet-height` so the button bar can stand on top of the sheet rather than
   * underneath it. The bar is in the overlay's grid and the sheet is fixed to the bottom of
   * the window, so without that the bar is simply covered — which is exactly what the first
   * screenshot of this layout showed: a phone with no controls on it at all.
   */
  get height(): number {
    return this.attached ? this.root.offsetHeight : 0;
  }
}
