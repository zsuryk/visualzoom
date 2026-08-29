import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { chromiumLaunchOptions, PORT } from './helpers/browser-env.js';

const EXTENSION_PATH = fileURLToPath(new URL('../extension/', import.meta.url));
const BASE = `http://127.0.0.1:${PORT}`;
const FIXTURE = `${BASE}/fixtures/native-zoom-breaking.html`;
const HUGE_PAGE = `${BASE}/fixtures/huge-page.html`;
const WRAPPER = '#visual-zoom-wrapper';

// The extension tests launch the real unpacked MV3 extension in the full
// chromium build (the headless shell can't load extensions). Each test gets a
// fresh browser profile; the launches are heavy, so run them sequentially.
test.describe.configure({ mode: 'serial' });

async function launchExtension() {
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1024, height: 768 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
    ...chromiumLaunchOptions(),
  });
  let worker = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  for (let i = 0; i < 40 && !worker; i++) {
    await new Promise((r) => setTimeout(r, 250));
    worker = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  }
  if (!worker) {
    await ctx.close();
    throw new Error('the extension service worker never started');
  }
  return { ctx, worker, extId: new URL(worker.url()).host };
}

// The popup asks the background for the *active* tab's zoom state. Opening the
// popup as a tab makes the popup itself the active tab, so focus the real
// page, then reload the popup so it queries the page.
async function openPopup(ctx, page, extId) {
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await page.bringToFront();
  await popup.reload();
  await popup.waitForSelector('#scale');
  return popup;
}

// Shift+Plus on the main keyboard is Shift+=, which real browsers report as the
// '+' key. Playwright's accelerator cannot produce the shifted character and
// the headless build reports '=' anyway, so the hotkeys are driven as DOM
// keydown events — the exact event our content-script listener consumes.
async function pressHotkey(page, key) {
  await page.evaluate((k) => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: k,
        bubbles: true,
        cancelable: true,
        shiftKey: true,
      })
    );
  }, key);
}

const wrapperTransform = (page) =>
  page.evaluate(
    () => getComputedStyle(document.getElementById('visual-zoom-wrapper')).transform
  );

const wrapperScale = async (page) =>
  parseFloat((await wrapperTransform(page)).match(/matrix\(([-\d.e+]+),/)[1]);

test.describe('05 — minimal MV3 extension shell', () => {
  test('@fixture the module reports the unwrapped 1x state to the wiring hook on teardown', async ({
    page,
  }) => {
    await page.goto(FIXTURE);
    const reported = await page.evaluate(async () => {
      const mod = await import('/src/content/visual-zoom.js');
      const seen = [];
      globalThis.vz = mod.createVisualZoom({
        onScaleChange: (scale, wrapped) => seen.push({ scale, wrapped }),
      });
      globalThis.vz.apply();
      globalThis.vz.setScale(1.5);
      document.getElementById('fixture-body-fight').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        seen,
        scale: vz.getScale(),
        wrapped: document.getElementById('visual-zoom-wrapper') !== null,
      };
    });
    // The last reported state is the graceful teardown: 1x and unwrapped, so
    // an open popup can follow the page instead of showing a stale readout.
    expect(reported.seen[reported.seen.length - 1]).toEqual({ scale: 1, wrapped: false });
    expect(reported.scale).toBe(1);
    expect(reported.wrapped).toBe(false);
  });

  test('@extension the unpacked extension injects the content script and the popup shows the current scale', async () => {
    const { ctx, extId } = await launchExtension();
    try {
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      await page.waitForLoadState('load');

      // The content script auto-applies visual zoom on a normal page.
      await expect(page.locator(WRAPPER)).toHaveCount(1);
      await expect(page.locator(WRAPPER)).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');

      // The popup opens; with the popup tab itself active, it degrades to the
      // not-active state instead of crashing.
      const popup = await ctx.newPage();
      await popup.goto(`chrome-extension://${extId}/popup.html`);
      await expect(popup.locator('#status')).toHaveText(
        'Visual Zoom is not active on this page.'
      );

      // With the real page as the active tab, the popup shows its scale and
      // enables the controls.
      await page.bringToFront();
      await popup.reload();
      await expect(popup.locator('#scale')).toHaveText('100%');
      await expect(popup.locator('#status')).toHaveText('Zoom level on the current page');
      await expect(popup.locator('#controls')).not.toHaveClass(/disabled/);
    } finally {
      await ctx.close();
    }
  });

  test('@extension the popup slider and +/−/reset drive the scale end to end, and the readout stays in sync with gesture/hotkey zoom', async () => {
    const { ctx, extId } = await launchExtension();
    try {
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      await page.waitForLoadState('load');
      const popup = await openPopup(ctx, page, extId);
      await expect(popup.locator('#scale')).toHaveText('100%');

      // + drives the page up one multiplicative step and the readout follows.
      await popup.locator('#zoom-in').click();
      await expect(popup.locator('#scale')).toHaveText('105%');
      expect(await wrapperTransform(page)).toBe('matrix(1.05, 0, 0, 1.05, 0, 0)');
      await popup.locator('#zoom-in').click();
      await expect(popup.locator('#scale')).toHaveText('110%');

      // The slider sets an exact scale on the page.
      await popup.locator('#slider').evaluate((el) => {
        el.value = '150';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await expect(popup.locator('#scale')).toHaveText('150%');
      expect(await wrapperTransform(page)).toBe('matrix(1.5, 0, 0, 1.5, 0, 0)');

      // − steps down multiplicatively; reset returns to exactly 1×.
      await popup.locator('#zoom-out').click();
      await expect(popup.locator('#scale')).toHaveText('143%');
      expect(await wrapperScale(page)).toBeCloseTo(1.5 / 1.05, 4);
      await popup.locator('#reset').click();
      await expect(popup.locator('#scale')).toHaveText('100%');
      expect(await wrapperTransform(page)).toBe('matrix(1, 0, 0, 1, 0, 0)');

      // Gesture zoom on the page moves the open popup's readout (and slider).
      await pressHotkey(page, '+');
      await expect(popup.locator('#scale')).toHaveText('105%');
      await page.evaluate(() => {
        window.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -100,
            deltaMode: 0,
            clientX: 512,
            clientY: 384,
            bubbles: true,
            cancelable: true,
            shiftKey: true,
          })
        );
      });
      await expect(popup.locator('#scale')).toHaveText('110%');
      expect(await popup.locator('#slider').inputValue()).toBe('110');

      // Keyboard support works unchanged inside the real extension: the hotkeys
      // from the zoom-inputs ticket zoom in/out and reset.
      await pressHotkey(page, '+');
      await expect(popup.locator('#scale')).toHaveText('116%');
      await pressHotkey(page, '-');
      await expect(popup.locator('#scale')).toHaveText('110%');
      await pressHotkey(page, '0');
      await expect(popup.locator('#scale')).toHaveText('100%');
      expect(await wrapperTransform(page)).toBe('matrix(1, 0, 0, 1, 0, 0)');
    } finally {
      await ctx.close();
    }
  });

  test('@extension the popup readout follows a graceful teardown on a page that fights the wrapper', async () => {
    const { ctx, extId } = await launchExtension();
    try {
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      await page.waitForLoadState('load');
      await expect(page.locator(WRAPPER)).toHaveCount(1);
      const popup = await openPopup(ctx, page, extId);
      await expect(popup.locator('#scale')).toHaveText('100%');
      await popup.locator('#zoom-in').click();
      await expect(popup.locator('#scale')).toHaveText('105%');

      // The page fights the wrapper, so the extension tears down to 1x. The
      // open popup follows: readout back to 100% and controls inactive.
      await page.evaluate(() => document.getElementById('fixture-body-fight').click());
      await expect(page.locator(WRAPPER)).toHaveCount(0);
      await expect(popup.locator('#scale')).toHaveText('100%');
      await expect(popup.locator('#status')).toHaveText(
        'Visual Zoom is not active on this page.'
      );
      await expect(popup.locator('#controls')).toHaveClass(/disabled/);
    } finally {
      await ctx.close();
    }
  });

  test('@extension on a huge page the layer-budget notice fires once, logs telemetry, and never blocks zoom', async () => {
    const { ctx, worker } = await launchExtension();
    try {
      const swLogs = [];
      worker.on('console', (msg) => {
        swLogs.push(msg.text());
      });

      const page = await ctx.newPage();
      await page.goto(HUGE_PAGE);
      await page.waitForLoadState('load');

      // The scaled page exceeds the compositor texture budget: the one-time
      // non-blocking notice appears and a telemetry line is logged.
      await expect(page.locator('#visual-zoom-budget-notice')).toHaveCount(1);
      await expect(page.locator('#visual-zoom-budget-notice')).toContainText('may be slow');
      await expect(page.locator(WRAPPER)).toHaveCount(1);
      await expect
        .poll(() => swLogs.filter((l) => l.includes('layer-budget-exceeded')))
        .toHaveLength(1);

      // Ignoring the notice never blocks zoom: keep zooming in, and the
      // notice stays a single element.
      await pressHotkey(page, '+');
      await pressHotkey(page, '+');
      await expect(page.locator('#visual-zoom-budget-notice')).toHaveCount(1);
      expect(await wrapperTransform(page)).toBe('matrix(1.1025, 0, 0, 1.1025, 0, 0)');

      // Dismissing it lets zoom continue unobstructed, and it never returns
      // within this page load.
      await page.click('#visual-zoom-budget-notice button');
      await expect(page.locator('#visual-zoom-budget-notice')).toHaveCount(0);
      await pressHotkey(page, '+');
      expect(await wrapperScale(page)).toBeCloseTo(1.05 ** 3, 4);
      await expect(page.locator('#visual-zoom-budget-notice')).toHaveCount(0);

      // Still exactly one telemetry line for this page load.
      expect(swLogs.filter((l) => l.includes('layer-budget-exceeded'))).toHaveLength(1);
    } finally {
      await ctx.close();
    }
  });
});
