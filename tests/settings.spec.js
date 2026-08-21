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

// Open the popup as a tab against the *real* page as the active tab.
async function openPopup(ctx, page, extId) {
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await page.bringToFront();
  await popup.reload();
  await popup.waitForSelector('#scale');
  return popup;
}

async function dispatchKey(page, key, modifiers = {}) {
  await page.evaluate(
    ({ key, modifiers }) => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
      );
    },
    { key, modifiers }
  );
}

async function dispatchWheel(page, deltaY, modifiers = {}) {
  await page.evaluate(
    ({ deltaY, modifiers }) => {
      window.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          deltaMode: 0,
          clientX: 512,
          clientY: 384,
          bubbles: true,
          cancelable: true,
          ...modifiers,
        })
      );
    },
    { deltaY, modifiers }
  );
}

const wrapperTransform = (page) =>
  page.evaluate(
    () => getComputedStyle(document.getElementById('visual-zoom-wrapper')).transform
  );

test.describe('06 — settings, options page, per-site behavior, crisp text', () => {
  test('@extension the popup shows per-site toggles; disabling a site leaves it untouched until re-enabled', async () => {
    const { ctx, extId } = await launchExtension();
    try {
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      await page.waitForLoadState('load');
      await expect(page.locator(WRAPPER)).toHaveCount(1);

      const popup = await openPopup(ctx, page, extId);
      await expect(popup.locator('#site-section')).toBeVisible();
      await expect(popup.locator('#site-name')).toHaveText('127.0.0.1');
      await expect(popup.locator('#site-enabled')).toBeChecked();

      // Disabling visual zoom for the site leaves the page untouched: the
      // wrapper is gone, the scale is 1x, and the popup reports inactive.
      await popup.locator('#site-enabled').uncheck();
      await expect(page.locator(WRAPPER)).toHaveCount(0);
      await expect(page.locator(WRAPPER)).not.toBeAttached();
      await expect(popup.locator('#status')).toHaveText(
        'Visual Zoom is not active on this page.'
      );

      // Re-enabling applies visual zoom fresh: the wrapper is back at 1x.
      await popup.locator('#site-enabled').check();
      await expect(page.locator(WRAPPER)).toHaveCount(1);
      await expect(wrapperTransform(page)).resolves.toBe('matrix(1, 0, 0, 1, 0, 0)');
      await expect(popup.locator('#status')).toHaveText('Zoom level on the current page');
    } finally {
      await ctx.close();
    }
  });

  test('@extension per-site zoom memory is off by default, restores on revisit when on, and never leaks to other sites', async () => {
    const { ctx, extId } = await launchExtension();
    try {
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      await page.waitForLoadState('load');
      await expect(page.locator(WRAPPER)).toHaveCount(1);
      const popup = await openPopup(ctx, page, extId);

      // Default: memory off. Zoom to 150%, reload — the previous scale is
      // never restored, the page comes back at 1x.
      await popup.locator('#slider').evaluate((el) => {
        el.value = '150';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await expect(popup.locator('#scale')).toHaveText('150%');
      await page.reload();
      await page.waitForLoadState('load');
      await expect(page.locator(WRAPPER)).toHaveCount(1);
      await expect(wrapperTransform(page)).resolves.toBe('matrix(1, 0, 0, 1, 0, 0)');

      // Opt in to memory for this site, zoom to 105%, and wait for the settled
      // scale to be committed to storage.
      await popup.locator('#site-memory').check();
      await popup.locator('#zoom-in').click();
      await expect(popup.locator('#scale')).toHaveText('105%');
      await page.waitForTimeout(700);

      // Revisit the site: the settled scale is restored.
      await page.reload();
      await page.waitForLoadState('load');
      await expect(page.locator(WRAPPER)).toHaveCount(1);
      await expect
        .poll(() => wrapperTransform(page))
        .toBe('matrix(1.05, 0, 0, 1.05, 0, 0)');

      // The remembered scale is not applied to other sites: localhost is a
      // different hostname, so it comes back at 1x.
      await page.goto(`${BASE.replace('127.0.0.1', 'localhost')}/fixtures/native-zoom-breaking.html`);
      await page.waitForLoadState('load');
      await expect(page.locator(WRAPPER)).toHaveCount(1);
      await expect(wrapperTransform(page)).resolves.toBe('matrix(1, 0, 0, 1, 0, 0)');
    } finally {
      await ctx.close();
    }
  });

  test('@extension changing the modifier and hotkeys in the options page takes effect live and persists', async () => {
    const { ctx, extId } = await launchExtension();
    try {
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      await page.waitForLoadState('load');
      await expect(page.locator(WRAPPER)).toHaveCount(1);

      const options = await ctx.newPage();
      await options.goto(`chrome-extension://${extId}/options.html`);
      await expect(options.locator('#modifier')).toHaveValue('altKey');

      // Change the gesture modifier to Ctrl and the zoom-in hotkey key to "x",
      // without touching the already-open page or reloading the extension.
      await options.locator('#modifier').selectOption('ctrlKey');
      await options.locator('#hotkey-zoom-in-key').fill('x');
      await options.locator('#hotkey-zoom-in-key').press('Enter');

      // The open page reacts live: Ctrl+wheel now gestures, Alt+wheel does not.
      await dispatchWheel(page, -100, { altKey: true });
      await expect(wrapperTransform(page)).resolves.toBe('matrix(1, 0, 0, 1, 0, 0)');
      await dispatchWheel(page, -100, { ctrlKey: true });
      await expect(wrapperTransform(page)).resolves.toBe('matrix(1.05, 0, 0, 1.05, 0, 0)');

      // The hotkey change is live too: Alt+x zooms in, Alt++ does not.
      await dispatchKey(page, 'x', { altKey: true });
      await expect(wrapperTransform(page)).resolves.toBe('matrix(1.1025, 0, 0, 1.1025, 0, 0)');
      await dispatchKey(page, '+', { altKey: true });
      await expect(wrapperTransform(page)).resolves.toBe('matrix(1.1025, 0, 0, 1.1025, 0, 0)');
      await dispatchKey(page, '0', { altKey: true });
      await expect(wrapperTransform(page)).resolves.toBe('matrix(1, 0, 0, 1, 0, 0)');

      // The settings persist: a fresh options page shows them, and a fresh
      // page load still uses the new combos.
      await options.reload();
      await expect(options.locator('#modifier')).toHaveValue('ctrlKey');
      await expect(options.locator('#hotkey-zoom-in-key')).toHaveValue('x');
      await page.reload();
      await page.waitForLoadState('load');
      await expect(page.locator(WRAPPER)).toHaveCount(1);
      await dispatchWheel(page, -100, { ctrlKey: true });
      await expect(wrapperTransform(page)).resolves.toBe('matrix(1.05, 0, 0, 1.05, 0, 0)');
      await dispatchWheel(page, -100, { altKey: true });
      await expect(wrapperTransform(page)).resolves.toBe('matrix(1.05, 0, 0, 1.05, 0, 0)');
    } finally {
      await ctx.close();
    }
  });

  test('@extension the crisp-text escape hatch reflows an open page at the settled scale and returns to live-transform when disabled', async () => {
    const { ctx, extId } = await launchExtension();
    try {
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      await page.waitForLoadState('load');
      await expect(page.locator(WRAPPER)).toHaveCount(1);

      const popup = await openPopup(ctx, page, extId);
      await test.step('zoom popup to 105', async () => {
        await popup.locator('#zoom-in').click();
        await expect(popup.locator('#scale')).toHaveText('105%');
      });

      // Enable the crisp-text escape hatch for this site from the options page.
      const options = await ctx.newPage();
      await test.step('open options and add site', async () => {
        await options.goto(`chrome-extension://${extId}/options.html`);
        await options.locator('#add-host').fill('127.0.0.1');
        await options.locator('#add-site').click();
        await options.locator('.site-row').filter({ hasText: '127.0.0.1' }).locator('.site-crisp').check();
      });

      // The already-open page reacts without any reload: the wrapper is torn
      // down and the page reflows at the settled scale.
      await test.step('assert crisp reflow', async () => {
        await expect(page.locator(WRAPPER)).toHaveCount(0);
        await expect
          .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).zoom))
          .toBe('1.05');
        await expect(page.locator('#visual-zoom-wrapper')).toHaveCount(0);
      });

      // Disabling the escape hatch returns to the live transform at the same
      // scale.
      await test.step('disable crisp and assert wrap returns', async () => {
        await options.locator('.site-row').filter({ hasText: '127.0.0.1' }).locator('.site-crisp').uncheck();
        await expect(page.locator(WRAPPER)).toHaveCount(1);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.style.zoom))
          .toBe('');
        await expect(wrapperTransform(page)).resolves.toBe('matrix(1.05, 0, 0, 1.05, 0, 0)');
      });
    } finally {
      await ctx.close();
    }
  });

  test('@extension the zoom-below-100 setting gates zoom-out and applies live from the options page', async () => {
    const { ctx, extId } = await launchExtension();
    try {
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      await page.waitForLoadState('load');
      await expect(page.locator(WRAPPER)).toHaveCount(1);

      const popup = await openPopup(ctx, page, extId);
      const options = await ctx.newPage();
      await options.goto(`chrome-extension://${extId}/options.html`);
      await expect(options.locator('#zoom-below-100')).not.toBeChecked();

      // Default (gate off): the popup slider floor is 100% and zoom-out
      // clamps at 100% — the page never goes below 1x. (The popup is a tab
      // in the test harness, so the fixture page must be the active tab for
      // popup messages to reach it.)
      await page.bringToFront();
      await expect(popup.locator('#slider')).toHaveAttribute('min', '100');
      await popup.locator('#zoom-out').click();
      await popup.locator('#zoom-out').click();
      await expect(popup.locator('#scale')).toHaveText('100%');
      await expect(wrapperTransform(page)).resolves.toBe('matrix(1, 0, 0, 1, 0, 0)');

      // Enabling the gate live unlocks the envelope: the popup slider now
      // reaches down to 30%, and setting 50% drives the page below 1x. (The
      // gate lands in the content script via storage.onChanged; the first
      // slider message can race ahead of that notification, so the slider is
      // re-driven until the page confirms the sub-1x transform.)
      await options.bringToFront();
      await options.locator('#zoom-below-100').check();
      await expect(popup.locator('#slider')).toHaveAttribute('min', '30');
      await page.bringToFront();
      await expect
        .poll(async () => {
          await popup.locator('#slider').evaluate((el) => {
            el.value = '50';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
          return wrapperTransform(page);
        })
        .toBe('matrix(0.5, 0, 0, 0.5, 0, 0)');
      await expect(popup.locator('#scale')).toHaveText('50%');

      // Disabling the gate live re-clamps the settled sub-1x scale to 100%,
      // and the open popup readout follows.
      await options.bringToFront();
      await options.locator('#zoom-below-100').uncheck();
      await expect
        .poll(() => wrapperTransform(page))
        .toBe('matrix(1, 0, 0, 1, 0, 0)');
      await expect(popup.locator('#scale')).toHaveText('100%');

      // The setting persists: a fresh options page still shows it unchecked.
      await options.reload();
      await expect(options.locator('#zoom-below-100')).not.toBeChecked();
    } finally {
      await ctx.close();
    }
  });
});