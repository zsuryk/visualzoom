import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { chromiumLaunchOptions, PORT } from './helpers/browser-env.js';

const EXTENSION_PATH = fileURLToPath(new URL('../extension/', import.meta.url));
const BASE = `http://127.0.0.1:${PORT}`;
const FIXTURE = `${BASE}/fixtures/native-zoom-breaking.html`;
const WRAPPER = '#visual-zoom-wrapper';

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
  return { ctx, extId: new URL(worker.url()).host };
}

async function openFixture(page, url = FIXTURE) {
  await page.goto(url);
  await page.waitForLoadState('load');
  await expect(page.locator(WRAPPER)).toHaveCount(1);
}

// Two Alt+wheel notches (~1.1025x) on the open page — enough to distinguish
// a scaled modal (640 * 1.1025 ~= 706px) from a protected 1x modal (640px).
async function zoomIn(page) {
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) {
      window.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -100,
          deltaMode: 0,
          clientX: 512,
          clientY: 384,
          bubbles: true,
          cancelable: true,
          altKey: true,
        })
      );
    }
  });
}

const modalWidth = (page) => page.locator('#fixture-modal').boundingBox().then((b) => b.width);

test.describe('07 — fixed-element policy (extension)', () => {
  test('@extension a global policy applies to all sites; a per-site override wins for that site only, live', async () => {
    const { ctx, extId } = await launchExtension();
    try {
      const page = await ctx.newPage();
      await openFixture(page);
      await page.click('#fixture-nav-action');
      await expect(page.locator('#fixture-modal-backdrop')).toHaveClass(/open/);

      // Zoom the open page (default scale-everything): the modal scales.
      await zoomIn(page);
      await expect.poll(() => modalWidth(page)).toBeGreaterThan(700);

      // Set the GLOBAL fixed-element policy to protect-modals in the options
      // page. The already-open page reacts live, no reload: the modal snaps
      // viewport-anchored at 1x (640px).
      const options = await ctx.newPage();
      await options.goto(`chrome-extension://${extId}/options.html`);
      await expect(options.locator('#fixed-policy')).toHaveValue('scale-everything');
      await options.locator('#fixed-policy').selectOption('protect-modals');
      await expect.poll(() => modalWidth(page)).toBeCloseTo(640, 0);
      await expect(page.locator('#visual-zoom-fixed-layer #fixture-modal-backdrop')).toHaveCount(1);

      // Per-site override for 127.0.0.1 back to scale-everything: only that
      // site changes, again live — the modal scales again.
      await options.locator('#add-host').fill('127.0.0.1');
      await options.locator('#add-site').click();
      const row = options.locator('.site-row').filter({ hasText: '127.0.0.1' });
      await row.locator('.site-policy').selectOption('scale-everything');
      await expect.poll(() => modalWidth(page)).toBeGreaterThan(700);

      // Another site with no override keeps the global protect-modals policy.
      const other = await ctx.newPage();
      await openFixture(other, FIXTURE.replace('127.0.0.1', 'localhost'));
      await other.click('#fixture-nav-action');
      await expect(other.locator('#fixture-modal-backdrop')).toHaveClass(/open/);
      await zoomIn(other);
      await expect.poll(() => modalWidth(other)).toBeCloseTo(640, 0);
      await expect(
        other.locator('#visual-zoom-fixed-layer #fixture-modal-backdrop')
      ).toHaveCount(1);

      // Dropping the per-site override restores the global policy live on the
      // original site.
      await row.locator('.site-policy').selectOption({ label: 'Default' });
      await expect.poll(() => modalWidth(page)).toBeCloseTo(640, 0);
    } finally {
      await ctx.close();
    }
  });
});
