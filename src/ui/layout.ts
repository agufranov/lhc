/**
 * Where the overlay sits over the picture, and how big the things in it are.
 *
 * It lives in TypeScript rather than in the stylesheet because **something has to be able to
 * check it**. The machine is drawn on a canvas underneath the panels, and whether a panel
 * covers it is a fact about numbers in two files with nothing relating them — a margin in the
 * renderer and a width in the CSS. It went wrong exactly that way twice: first the
 * experiments' column was put where the collider's right-hand arc already was, then the
 * experiments and the machine readouts were put in one column with no room for either.
 *
 * So the geometry is worked out here from what the camera actually did (`Renderer.machineBands`),
 * `main.ts` publishes it as CSS custom properties every frame, the stylesheet only places what
 * it is given, and two gates check it: `check:render` sweeps window sizes over the arithmetic
 * and `check:page` measures the real boxes in a real browser.
 */

/** Padding round the whole overlay, and the gap between its columns [CSS px]. */
export const OVERLAY_PADDING = 16;
export const OVERLAY_GAP = 16;

/** The machine-readout column: beam and physics on the left, power and injector on the right. */
export const READOUT_COLUMN = 260;

/**
 * An experiment's panel, which is wider than a readout because it is **a picture with its
 * numbers beside it** rather than above them.
 *
 * Stacked — canvas over rows — the panel was 360 px tall and two of them plus the machine
 * readouts did not fit a 860 px window at all. Side by side it is shorter and the canvas is
 * *larger*, which is the trade: a panel is as wide as there is room for to the right of the
 * collider, and no taller than it has to be.
 *
 * ## Why the size is measured and not declared
 *
 * It used to be 380 px flat, with a check that the collider's right-hand arc ended left of
 * where that put the panels — 36 px of clearance at 1280×860, and a fixed 196 px picture on
 * a 2560 px screen with five hundred pixels going spare. Both halves of that are wrong the
 * same way: **the room around the machine is a measured quantity**, it changes with every
 * window size, and a constant can only be either too greedy on a small screen or too timid on
 * a big one.
 *
 * So a card is derived from the band it stands in (`eventCardBoxes`), the clearance is
 * arithmetic rather than an assertion that might fail, and the picture takes whatever is left
 * over. `check:render` sweeps window sizes and prints what it gets and `check:page` measures
 * the real DOM, because these are measured numbers and the next session should re-measure
 * them rather than trust this comment.
 */

/**
 * The numbers column beside the picture, and how tall it is [CSS px].
 *
 * **Its height is what sets a card's height, not the picture's.** At 148 px wide every value
 * in it wrapped to two or three lines and the column stood 294 px tall against a 235 px
 * picture — so a card modelled as "picture plus chrome" was 60 px shorter than the card the
 * browser actually laid out, and both of them ran past the ends of their bands: the top one
 * onto the injector, the bottom one under the button bar. Measured in the browser, wrapping
 * against width like this:
 *
 *     148 → 294    170 → 277    190 → 240    210 → 221    240 → 221    280 → 165
 *
 * Those were measured against five values that each wrapped to two or three lines. They are
 * one line each now and the column measures **120 px** at 248 wide, which is well under the
 * picture beside it — so a card is as tall as its picture and no taller, which is what it
 * should have been all along.
 *
 * 210 was the near end of that plateau. It is **248** now, and the height that goes with it
 * is far below the numbers above, because both moved at once: the rows were shortened (five
 * values that each fitted one line, and a one-line legend instead of three) and the column
 * was widened to hold them. A card is wider and shorter for it, which is what it should be —
 * it is a picture with its numbers beside it, and the numbers are a caption.
 *
 * The height is a measured constant and `check:page` asserts it against the real DOM, because
 * it moves whenever a row's wording or the panel's font does.
 */
export const EVENT_SIDE = 248;
export const EVENT_SIDE_HEIGHT = 120;
export const EVENT_PANEL_CHROME = 12 + 12 + 12 + EVENT_SIDE;

/**
 * The r–φ display inside it. Square, because the thing drawn in it is a circle end-on.
 *
 * The floor is what the whole barrel — twenty-two layers — stays resolvable at, and it is
 * also the size every assertion in `check:render` was written against: a window with no room
 * for it is a window the card is allowed to overhang, because a card too small to read is
 * worse than a card slightly over the machine.
 *
 * The ceiling is a taste judgement and the only one here. It was 320, which let a card grow
 * to nearly four hundred pixels tall on a big screen and stand over most of a band; a
 * collision does not become more legible for being swelled to fill a 4K screen, and the
 * height it costs is height the card is *placed* against.
 */
export const EVENT_CANVAS_MIN = 196;
export const EVENT_CANVAS_MAX = 240;

/**
 * Empty border the machine is fitted inside [CSS px].
 *
 * Dropped from 96 so the picture is bigger — the collider's half-aperture goes 17.5 → 18.3 px
 * — and it cannot go much further: the picture is centred, so every pixel of margin removed
 * pushes the collider's right-hand arc that much closer to the experiments' column. The
 * clearance that leaves is asserted, not assumed.
 */
export const CAMERA_MARGIN = 80;

/**
 * Room kept outside the tunnel wall for the machine's own labels [CSS px].
 *
 * The sector names, the point names and the experiments are drawn 34–40 px *outside* the
 * ring, so they are not inside the bounds the camera fits — a fit that only clears the
 * tunnel puts them under whatever the overlay has at that edge. This is that overhang plus
 * the height of the type, and `Renderer.resize` adds it to the title above the picture and
 * the button bar below it. Before it existed the bottom of the collider — S67, S78, and the
 * second experiment with it — sat behind the buttons on any window under about 1000 px.
 */
export const LABEL_ROOM = 48;

/**
 * Everything above the picture in a card and below it: the heading and the panel's padding.
 *
 * Measured off the real DOM rather than added up from the stylesheet — `check:page` asserts a
 * card's height really is its picture plus this, so a change to the heading's font or the
 * panel's padding fails there instead of quietly pushing a card into the machine. It has
 * already caught one: trimming `.panel`'s padding to fit the readouts took it from 50 to 45.
 */
export const EVENT_CARD_CHROME = 45;

/**
 * How far a card may reach over the machine before it is moved out of the way [CSS px].
 *
 * Not zero, on purpose. The floor on the picture means a window can be too narrow to hold a
 * readable card in the space beside the readouts, and then something has to give: a corner of
 * a translucent card over the outermost pixels of an arc, or the machine readouts squeezed
 * into a scroller. The first is a smudge and the second is the bug this layout was rewritten
 * to fix, so a little overhang is allowed and a lot sends the card back into the column.
 */
export const OVERHANG_ALLOWED = 40;

/** Where everything the layout places goes: the two cards, and the rails left over. */
export interface OverlayBoxes {
  cards: [CardBox, CardBox];
  /** Insets for the readout columns, from the top and bottom of the window. */
  rails: { top: number; bottom: number; rightTop: number; rightBottom: number };
}

/**
 * The overlay's own furniture, measured off the DOM rather than assumed.
 *
 * Both wrap: the title on a very narrow window and the button bar on anything under about
 * 1500 px, where it goes to two rows and takes 86 px instead of 54. The rails have to start
 * under one and stop over the other, so guessing either is how a panel ends up half behind
 * the buttons.
 */
export interface OverlayChrome {
  title: number;
  controls: number;
}

/** A card's box, in CSS px from the top-left of the window. */
export interface CardBox {
  top: number;
  left: number;
  width: number;
  height: number;
  /** The picture inside it, square. */
  canvas: number;
}

/**
 * The bands the overlay may put cards in — `Renderer.machineBands`.
 *
 * All in CSS px: where the injector's own band starts and ends, and how far right the machine
 * reaches above it and below it.
 */
export interface MachineBands {
  injectorTop: number;
  injectorBottom: number;
  /**
   * How far right the **rings** reach between two screen heights.
   *
   * A band, not a bounding box, and asked for the card's *own* strip rather than the whole
   * band: a card sized against a whole band loses width to whatever crosses the far end of
   * it. See the two passes in `eventCardBoxes`.
   */
  rightIn(top: number, bottom: number): number;
  /** The same for the transfer and dump lines, which are reported rather than obeyed. */
  linesRightIn(top: number, bottom: number): number;
}

/**
 * Where the two experiments' cards go, and how big the picture in each is.
 *
 * ## The thing this replaced
 *
 * All three cards on the right used to be one flex rail — an experiment, the machine
 * readouts, the other experiment — sharing one column of height. There is not enough of it:
 * POWER alone wants 460 px and INJECTOR another 270, so the moment both experiments trigger
 * the readouts are crushed into a 115 px scroller with the injector panel pushed off the
 * bottom, and the lower card slides under the button bar. That is a layout bug and no
 * assertion about *drawing* could ever have seen it — see `check:page`, which now can.
 *
 * ## What it is instead
 *
 * The readouts keep the far-right column, full height, because POWER is long and a column is
 * the only shape that fits it. The experiments move into **the bands above and below the
 * injector** — the one stretch of picture with nothing in it — right-aligned against the
 * readouts and reaching left only as far as the machine in *that band* allows, which is much
 * further than the collider's widest point. The band above the injector is shorter than the
 * one below it, so the two pictures are sized independently: each is as big as its own corner
 * allows rather than both being as small as the worse one.
 *
 * `controlsHeight` is measured off the DOM, because the button bar wraps to two rows on a
 * narrow window and the lower card has to clear whatever it actually became.
 */
export function eventCardBoxes(
  width: number,
  height: number,
  bands: MachineBands,
  chrome: OverlayChrome,
  showing: [boolean, boolean] = [true, true],
): OverlayBoxes {
  // The left rail starts under the title; the right one has nothing above it and starts at the
  // top of the window, which is 39 px of column the machine readouts need.
  const railTop = OVERLAY_PADDING + chrome.title + OVERLAY_GAP;
  const rightRailTop = OVERLAY_PADDING;
  const railBottom = OVERLAY_PADDING + chrome.controls + OVERLAY_GAP;
  /** Left edge of the readouts' column, and where a card stops if it is to stay beside it. */
  const columnLeft = width - OVERLAY_PADDING - READOUT_COLUMN;
  const windowRight = width - OVERLAY_PADDING;

  const card = (
    bandTop: number,
    bandBottom: number,
    anchor: 'top' | 'bottom',
    /** Forced picture size, for the second pass that makes the two cards agree. */
    fixedCanvas?: number,
  ): CardBox => {
    const fit = (right: number, strip: [number, number]): CardBox => {
      const wide = right - (bands.rightIn(...strip) + OVERLAY_GAP) - EVENT_PANEL_CHROME;
      const tall = bandBottom - bandTop - EVENT_CARD_CHROME;
      // Floor, not round: rounding up borrows the half pixel from the clearance, which is the
      // one thing this function exists to protect.
      const canvas =
        fixedCanvas ??
        Math.floor(Math.max(EVENT_CANVAS_MIN, Math.min(EVENT_CANVAS_MAX, wide, tall)));
      // As tall as the taller of its two columns. The numbers win on a small picture, which
      // is the whole reason `EVENT_SIDE_HEIGHT` exists.
      const box = {
        canvas,
        width: eventPanelWidth(canvas),
        height: Math.max(canvas, EVENT_SIDE_HEIGHT) + EVENT_CARD_CHROME,
      };
      const top = anchor === 'top' ? bandTop : bandBottom - box.height;
      return { ...box, top, left: right - box.width };
    };

    // Two passes. The first sizes the card against the whole band, the second against the
    // strip of screen the card that size actually stands in — which is what lets the lower
    // card ignore TI 8 crossing the top of its band on the way to the injector.
    const beside = (right: number): CardBox => {
      let box = fit(right, [bandTop, bandBottom]);
      for (let i = 0; i < 2; i++) box = fit(right, [box.top, box.top + box.height]);
      return box;
    };

    // Beside the readouts, which is where it belongs: the readouts are the thing that must
    // not be crushed, and a card whose corner reaches a few pixels over an arc costs far less
    // than an injector panel scrolled off the bottom of the screen. Only when there is so
    // little room that the card would sit *well* over the machine does it fall back into the
    // column — and then the readouts take what is left between the cards and scroll, because
    // a number can be scrolled to and a picture cannot.
    const wide = beside(columnLeft - OVERLAY_GAP);
    const overhang = bands.rightIn(wide.top, wide.top + wide.height) + OVERLAY_GAP - wide.left;
    return overhang <= OVERHANG_ALLOWED ? wide : beside(windowRight);
  };

  const first: [CardBox, CardBox] = [
    card(OVERLAY_PADDING, bands.injectorTop - OVERLAY_GAP, 'top'),
    card(bands.injectorBottom + OVERLAY_GAP, height - railBottom, 'bottom'),
  ];

  // **Both pictures at one size, which is both at the smaller.**
  //
  // They used to be sized independently — each as big as its own corner allowed — and that is
  // wrong for what they are: two views of the same detector at the same radius, read one
  // against the other. At different sizes the same 11 m barrel is two different circles, and
  // a track that reaches the muon chambers in one panel looks longer than the one that does
  // in the other. A scale that means something has to be the same scale in both.
  const canvas = Math.min(first[0].canvas, first[1].canvas);
  const cards: [CardBox, CardBox] = [
    card(OVERLAY_PADDING, bands.injectorTop - OVERLAY_GAP, 'top', canvas),
    card(bands.injectorBottom + OVERLAY_GAP, height - railBottom, 'bottom', canvas),
  ];

  // A card that had to fall back into the column is standing where the readouts would be, so
  // the rail starts below it and ends above the other one. A card nobody has triggered yet is
  // not on screen and takes nothing: the readouts have the whole column until the first
  // collision, which is also the only state most sessions ever see.
  const inColumn = (c: CardBox, visible: boolean): boolean =>
    visible && c.left + c.width > columnLeft;
  return {
    cards,
    rails: {
      top: railTop,
      bottom: railBottom,
      rightTop: inColumn(cards[0], showing[0])
        ? Math.max(rightRailTop, cards[0].top + cards[0].height + OVERLAY_GAP)
        : rightRailTop,
      rightBottom: inColumn(cards[1], showing[1])
        ? Math.max(railBottom, height - cards[1].top + OVERLAY_GAP)
        : railBottom,
    },
  };
}

/**
 * The borders the machine must keep clear at the top and bottom of the window.
 *
 * The same two numbers the rails start at, because they are the same fact: the title reaches
 * this far down and the buttons that far up, and neither the panels nor the machine may be
 * under them. `Renderer.resize` adds `LABEL_ROOM` on top.
 */
export function machineBorders(chrome: OverlayChrome): { top: number; bottom: number } {
  return {
    top: OVERLAY_PADDING + chrome.title + OVERLAY_GAP,
    bottom: OVERLAY_PADDING + chrome.controls + OVERLAY_GAP,
  };
}

/** The panel that picture sits in. */
export function eventPanelWidth(canvas: number): number {
  return canvas + EVENT_PANEL_CHROME;
}

/** What was last published, so a per-frame call is a comparison and not a restyle. */
let published = '';

/**
 * Publishes what the stylesheet cannot work out for itself.
 *
 * Called every frame rather than once at boot, because the cards now follow the camera: it is
 * a no-op unless something actually moved.
 */
export function publishLayout(root: HTMLElement, boxes: OverlayBoxes, bands: MachineBands): void {
  const { cards, rails } = boxes;
  const key = `${cards.map((c) => `${c.top},${c.left},${c.canvas}`).join('|')}|${Object.values(rails).join(',')}`;
  if (key === published) return;
  published = key;
  root.style.setProperty('--rail-top', `${rails.top}px`);
  root.style.setProperty('--rail-bottom', `${rails.bottom}px`);
  root.style.setProperty('--rail-right-top', `${rails.rightTop}px`);
  root.style.setProperty('--rail-right-bottom', `${rails.rightBottom}px`);
  // The bands are published because they are what a card was placed *against*: `check:page`
  // measures the cards in the browser and needs the same numbers to say whether they landed
  // where the layout meant them to.
  root.style.setProperty('--band-injector-top', `${bands.injectorTop}`);
  root.style.setProperty('--band-injector-bottom', `${bands.injectorBottom}`);
  for (const [i, card] of cards.entries()) {
    const id = i === 0 ? 'a' : 'b';
    root.style.setProperty(`--event-${id}-top`, `${card.top}px`);
    root.style.setProperty(`--event-${id}-left`, `${card.left}px`);
    // Width as well as the picture, so the box on screen is exactly the box that was placed:
    // shrink-to-fit rounded it up by two pixels and put the card over the window's margin.
    root.style.setProperty(`--event-${id}-width`, `${card.width}px`);
    root.style.setProperty(`--event-${id}-canvas`, `${card.canvas}px`);
    // How far right the machine reaches through this card's own strip of screen — what its
    // left edge was placed against, and what the browser check compares it to.
    root.style.setProperty(
      `--event-${id}-machine-right`,
      `${bands.rightIn(card.top, card.top + card.height)}`,
    );
  }
  root.style.setProperty('--event-side', `${EVENT_SIDE}px`);
  root.style.setProperty('--readout-column', `${READOUT_COLUMN}px`);
  root.style.setProperty('--overlay-padding', `${OVERLAY_PADDING}px`);
  root.style.setProperty('--overlay-gap', `${OVERLAY_GAP}px`);
}
