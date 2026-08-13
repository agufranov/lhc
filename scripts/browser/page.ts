/**
 * The real page, in real Chrome, headless.
 *
 * ## Why this exists
 *
 * `check:render` runs the renderer against a recording mock canvas, so it sees everything
 * that is a *drawing* bug and nothing that is a *layout* bug: the overlay is HTML sitting on
 * top of that canvas, and no assertion about what the renderer was asked to draw can notice
 * one panel covering another. That is how the experiments' column came to squeeze the machine
 * readouts into a 130 px scroller with the injector panel pushed off the bottom — three cards
 * fighting over one rail, invisible to all three gates and obvious in one screenshot.
 *
 * So this drives the actual app: `shot.ts` photographs it, `page-check.ts` measures it.
 * `puppeteer-core` downloads no browser — it uses the Chrome already on the machine — and it
 * runs **headless**, so nothing opens on screen and nothing steals focus.
 */

import { existsSync } from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

/** Where the page is served from. The dev server is usually already up; see CLAUDE.md. */
export const URL_BASE = process.env.LHC_URL ?? 'http://127.0.0.1:5173/';

/** Chrome, wherever this machine keeps it. Nothing is downloaded. */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((p): p is string => !!p);

export function findChrome(): string {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error(`no Chrome found; tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
  return found;
}

/**
 * A server to point the browser at.
 *
 * Uses the dev server if one is already up — a session usually has one, and Vite resolves
 * modules from disk on every request, so an old server still serves current code. Starts its
 * own on a free port if not, so neither the screenshot nor the check depends on somebody
 * having run `npm start` first.
 */
async function ensureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  try {
    const probe = await fetch(URL_BASE, { signal: AbortSignal.timeout(1500) });
    if (probe.ok) return { url: URL_BASE, close: async () => {} };
  } catch {
    // nothing there; start one below
  }
  const { createServer } = await import('vite');
  const server = await createServer({ server: { port: 0, strictPort: false, host: '127.0.0.1' } });
  await server.listen();
  const address = server.resolvedUrls?.local[0];
  if (!address) throw new Error('vite started but published no local URL');
  return { url: address, close: () => server.close() };
}

export interface PageSession {
  browser: Browser;
  page: Page;
  /** Anything the page threw or logged as an error — a picture cannot tell you that. */
  errors: string[];
  /** Closes the browser, and the dev server if this session started one. */
  close: () => Promise<void>;
}

/**
 * Opens the page.
 *
 * `quiet` — the default — appends `?quiet=1`, which switches the incident system off: a run
 * that has to end with two beams colliding cannot afford a UFO in the middle of it, and at the
 * real rates about a quarter of these runs would get one. Pass `false` to drive the machine
 * the way a player gets it.
 */
export async function open(width: number, height: number, quiet = true): Promise<PageSession> {
  const server = await ensureServer();
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: [`--window-size=${width},${height}`, '--hide-scrollbars', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const errors: string[] = [];
  // The page asks for a favicon it does not have, on every load, for ever. That 404 is not a
  // fault in anything and drowning a real exception in it would be.
  const noise = (text: string): boolean => text.includes('favicon') || text.includes('404');
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !noise(m.text())) errors.push(m.text());
  });
  const url = quiet ? `${server.url}${server.url.includes('?') ? '&' : '?'}quiet=1` : server.url;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
  return {
    browser,
    page,
    errors,
    close: async () => {
      await browser.close();
      await server.close();
    },
  };
}

/**
 * Clicks a control by a fragment of its visible label.
 *
 * **Visible, and it matters.** The bar shows one place's controls at a time, and the ones
 * belonging to the other places are in the DOM with `hidden` on them — where `click()` would
 * still fire their handlers, which is a press no user could make. It also disambiguates: the
 * injector's ramp reads `▲ ramp → 450 GeV` and the collider's reads `▼ ramp → 450 GeV`, and
 * only one of the two clusters is ever on screen.
 */
export async function press(page: Page, label: string): Promise<boolean> {
  return page.evaluate((text: string) => {
    const buttons = Array.from(document.querySelectorAll('#controls button')).filter(
      (b) => (b as HTMLElement).offsetParent !== null,
    );
    const hit = buttons.find((b) => (b.textContent ?? '').trim().includes(text));
    if (!hit) return false;
    (hit as HTMLButtonElement).click();
    return true;
  }, label);
}

/**
 * Goes to a place: clicks the tab whose name contains `label` and waits for the camera.
 *
 * The camera takes three quarters of a second to fly and the cluster of controls under the
 * tabs swaps at the press, so waiting is not about the buttons — it is about not measuring
 * the overlay while the machine is still moving under it.
 */
export async function selectView(page: Page, label: string): Promise<boolean> {
  const hit = await page.evaluate((text: string) => {
    const tabs = Array.from(document.querySelectorAll('#controls .control--tab'));
    const found = tabs.find((b) => (b.textContent ?? '').trim().includes(text));
    if (!found) return false;
    (found as HTMLButtonElement).click();
    return true;
  }, label);
  await wait(1.1);
  return hit;
}

/** Whether the camera is between two views right now. */
export async function flying(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { lhc: { renderer: { flying: boolean } } }).lhc.renderer.flying,
  );
}

/**
 * Every button in the bar and whether it is greyed out.
 *
 * A greyed control is `aria-disabled` rather than `disabled` — it keeps its tooltip, which is
 * where the reason is — so this reads the attribute the app actually sets. See
 * `ui/controls.ts` for which controls may be greyed and which may never be.
 */
export async function controlStates(
  page: Page,
): Promise<Array<{ label: string; blocked: boolean; shown: boolean; tab: boolean }>> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#controls button')).map((b) => ({
      label: (b.textContent ?? '').trim(),
      blocked: b.getAttribute('aria-disabled') === 'true',
      shown: (b as HTMLElement).offsetParent !== null,
      tab: b.classList.contains('control--tab'),
    })),
  );
}

export const wait = (seconds: number): Promise<void> =>
  new Promise((r) => setTimeout(r, seconds * 1000));

/** The text of one overlay panel, whitespace collapsed — what a reader would see on it. */
export async function panelText(page: Page, id: string): Promise<string> {
  return page.evaluate(
    (sel: string) => (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' '),
    `#${id}`,
  );
}

/**
 * Waits until a panel says something, or gives up.
 *
 * The machine clock runs 200× wall time and injection waits for a bucket, so "press, sleep,
 * press" races states that arrive whenever they arrive: it produced a screenshot with beam 2
 * empty and one wall hit, because the ramp landed between arming the kicker and its firing.
 * Wait for what the machine says instead.
 */
export async function until(
  page: Page,
  id: string,
  says: (text: string) => boolean,
  seconds = 20,
): Promise<boolean> {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    if (says(await panelText(page, id))) return true;
    if (Date.now() > deadline) return false;
    await wait(0.25);
  }
}

/**
 * Gets the machine into the state worth looking at: a batch in each beam, ramped, colliding,
 * with both experiments triggered — which is the only state in which the panels this is here
 * to check are on screen at all.
 *
 * The order is the order a user has to press them in, and the waits are real: `fill` puts the
 * injector back to flat bottom and the chain delivers 21.6 s of machine time later, so ramping
 * straight after a fill cancels the flat bottom and the batch never arrives. That cost one
 * screenshot to discover.
 */
export async function collide(page: Page, settle = 8): Promise<void> {
  // The bar shows one place's controls at a time, so getting a fill into the collider is a
  // walk from machine to machine — which is what it is on the real thing too, and what the
  // tabs are for. See `ui/controls.ts`.
  await selectView(page, 'SPS');
  for (const [n, beam] of [['1', '→ LHC beam 1'], ['2', '→ LHC beam 2']] as const) {
    // Back to flat bottom first, explicitly: an SPS sitting at 450 GeV holds the fill —
    // "chain holding, waiting for flat bottom" — and no batch is ever delivered. The ramp is
    // one button that says which way it will go, so this is the same button as the one below.
    await press(page, 'ramp → 26 GeV');
    await press(page, 'fill SPS');
    await until(page, 'panel-injector', (t) => /batches ready\s*[1-9]/.test(t));
    await press(page, 'ramp → 450 GeV');
    await until(page, 'panel-injector', (t) => t.includes('ready to extract'));
    await press(page, beam);
    // The kicker is armed, not fired: it waits for the bucket that puts this batch head-on
    // with the other beam. Ramping before it fires loses the batch into a wall.
    await until(page, 'panel-beam', (t) => new RegExp(`beam ${n}\\s*\\d+ batches`).test(t));
  }
  await selectView(page, 'LHC');
  await press(page, 'ramp → 6.8 TeV');
  await until(page, 'panel-power', (t) => t.includes('flat top'), 30);
  // **Cog, and mean it.** Injection no longer waits for a phase — the phases it could reach
  // were a coarse grid and hunting them was seconds of dead time — so a fresh fill collides
  // nowhere until the crossing point is walked onto an interaction point, and that is what
  // this button is. Matched on "no collisions" rather than on an experiment's name, which
  // has changed once already.
  await press(page, 'auto');
  await until(page, 'panel-physics', (t) => !t.includes('no collisions'), 60);
  // Both experiments have to have triggered on something or their panels are not on screen,
  // and with one batch per beam that only happens while both cover an IP — which comes round
  // when it comes round. A minute is long enough for every window size tried; less was not.
  await until(
    page,
    'panel-physics',
    (t) => !/hardest object\s*—/.test(t),
    60,
  );
  await wait(settle);
}
