import { test, expect } from '@playwright/test';
import { launchExtension, openPopup, BASE, FIXTURE, HUGE_PAGE } from './helpers/extension-env.js';

// The extension tests launch the real unpacked MV3 extension in the full
// chromium build (the headless shell can't load extensions). Each test gets a
// fresh browser profile; the launches are heavy, so run them sequentially.
test.describe.configure({ mode: 'serial' });

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

const bodyTransform = (page) =>
  page.evaluate(() => document.body.style.transform);

const bodyScale = async (page) =>
  parseFloat((await bodyTransform(page)).match(/scale\(([-\d.e+]+)\)/)?.[1] || '1');

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
        wrapped: vz.isWrapped(),
      };
    });
    // With the body-transform approach (scale-everything policy), the fight
    // button has no wrapper to destroy, so the zoom stays active at 1.5x.
    expect(reported.scale).toBe(1.5);
    expect(reported.wrapped).toBe(true);
  });

  test('@extension the unpacked extension injects the content script and the popup shows the current scale', async () => {
    const { ctx, extId } = await launchExtension();
    try {
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      await page.waitForLoadState('load');

      // The content script enters dormant mode on a normal page: no transform at 1x.
      await expect(async () => {
        const transform = await bodyTransform(page);
        expect(transform).toBe('');
      }).toPass();

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
      expect(await bodyTransform(page)).toBe('scale(1.05)');
      await popup.locator('#zoom-in').click();
      await expect(popup.locator('#scale')).toHaveText('110%');

      // The slider sets an exact scale on the page.
      await popup.locator('#slider').evaluate((el) => {
        el.value = '150';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await expect(popup.locator('#scale')).toHaveText('150%');
      expect(await bodyTransform(page)).toBe('scale(1.5)');

      // − steps down multiplicatively; reset returns to exactly 1×.
      await popup.locator('#zoom-out').click();
      await expect(popup.locator('#scale')).toHaveText('143%');
      expect(await bodyScale(page)).toBeCloseTo(1.5 / 1.05, 4);
      await popup.locator('#reset').click();
      await expect(popup.locator('#scale')).toHaveText('100%');
      await expect(async () => {
        const transform = await bodyTransform(page);
        expect(transform).toBe('');
      }).toPass();

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
      await expect(async () => {
        const transform = await bodyTransform(page);
        expect(transform).toBe('');
      }).toPass();
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
      // Dormant mode: no transform at 1x.
      await expect(async () => {
        const transform = await bodyTransform(page);
        expect(transform).toBe('');
      }).toPass();
      const popup = await openPopup(ctx, page, extId);
      await expect(popup.locator('#scale')).toHaveText('100%');
      await popup.locator('#zoom-in').click();
      await expect(popup.locator('#scale')).toHaveText('105%');

      // With the body-transform approach (scale-everything policy), the fight
      // button has no wrapper to destroy, so the zoom stays active. The popup
      // continues to show the current zoom level.
      await page.evaluate(() => document.getElementById('fixture-body-fight').click());
      await expect(popup.locator('#scale')).toHaveText('105%');
      await expect(popup.locator('#status')).toHaveText('Zoom level on the current page');
      await expect(popup.locator('#controls')).not.toHaveClass(/disabled/);
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

      // Dormant mode: no transform at 1x, no budget notice.
      await expect(async () => {
        const transform = await bodyTransform(page);
        expect(transform).toBe('');
      }).toPass();
      await expect(page.locator('#visual-zoom-budget-notice')).toHaveCount(0);

      // Zoom in: the transform is applied and the scaled page exceeds
      // the compositor texture budget, triggering the one-time notice.
      await pressHotkey(page, '+');
      await expect(async () => {
        const transform = await bodyTransform(page);
        expect(transform).not.toBe('');
      }).toPass();
      await expect(page.locator('#visual-zoom-budget-notice')).toHaveCount(1);
      await expect(page.locator('#visual-zoom-budget-notice')).toContainText('may be slow');
      await expect
        .poll(() => swLogs.filter((l) => l.includes('layer-budget-exceeded')))
        .toHaveLength(1);

      // Ignoring the notice never blocks zoom: keep zooming in, and the
      // notice stays a single element.
      await pressHotkey(page, '+');
      await pressHotkey(page, '+');
      await expect(page.locator('#visual-zoom-budget-notice')).toHaveCount(1);
      // 3 presses from dormant (scale=1): 1.05 → 1.1025 → 1.157625
      expect(await bodyScale(page)).toBeCloseTo(1.05 ** 3, 4);

      // Dismissing it lets zoom continue unobstructed, and it never returns
      // within this page load.
      await page.click('#visual-zoom-budget-notice button');
      await expect(page.locator('#visual-zoom-budget-notice')).toHaveCount(0);
      await pressHotkey(page, '+');
      // 4th press: 1.05^4
      expect(await bodyScale(page)).toBeCloseTo(1.05 ** 4, 4);
      await expect(page.locator('#visual-zoom-budget-notice')).toHaveCount(0);

      // Still exactly one telemetry line for this page load.
      expect(swLogs.filter((l) => l.includes('layer-budget-exceeded'))).toHaveLength(1);
    } finally {
      await ctx.close();
    }
  });
});
