import { test, expect } from '@playwright/test';

const FIXTURE = '/fixtures/native-zoom-breaking.html';
const WRAPPER = '#visual-zoom-wrapper';

async function loadVisualZoom(page, options = {}) {
  await page.goto(FIXTURE);
  await page.evaluate(async (opts) => {
    const mod = await import('/src/content/visual-zoom.js');
    globalThis.vz = mod.createVisualZoom(opts);
    globalThis.vz.apply();
  }, options);
}

const scrollLayoutWidth = (page) =>
  page.evaluate(() => document.getElementById('fixture-scroll').offsetWidth);

test.describe('06 — crisp-text escape hatch (module)', () => {
  test('@fixture enabling crisp text unwraps and reflows at the settled scale; disabling returns to live-transform at the same scale', async ({
    page,
  }) => {
    await loadVisualZoom(page);

    // Baseline: live transform at 1x, original layout geometry.
    await expect(page.locator(WRAPPER)).toHaveCount(1);
    expect(await scrollLayoutWidth(page)).toBe(1024);

    // Zoom in with the live transform: layout geometry is untouched (only the
    // rendered pixels scale), so the scroll region keeps its 1024px box.
    await page.evaluate(() => vz.setScale(1.5));
    expect(await scrollLayoutWidth(page)).toBe(1024);
    expect(
      await page.evaluate(() => document.documentElement.style.zoom)
    ).toBe('');

    // Enable crisp text: the wrapper is torn down and the page reflows at the
    // settled scale (CSS zoom on the root), so the layout box itself changes.
    await page.evaluate(() => vz.setCrispText(true));
    await expect(page.locator(WRAPPER)).toHaveCount(0);
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.5, 10);
    expect(await page.evaluate(() => vz.isWrapped())).toBe(false);
    expect(await page.evaluate(() => vz.isEngaged())).toBe(true);
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).zoom)
    ).toBe('1.5');
    // The layout reflowed: the scroll region now lays out against the zoomed
    // viewport (1024 / 1.5) instead of the original 1024px box.
    expect(await scrollLayoutWidth(page)).toBeCloseTo(1024 / 1.5, 0);

    // Zooming still works in reflow mode: the settled scale changes and the
    // reflow follows.
    await page.evaluate(() => vz.setScale(1.575));
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.575, 10);
    expect(await scrollLayoutWidth(page)).toBeCloseTo(1024 / 1.575, 0);
    expect(
      await page.evaluate(() => document.documentElement.style.zoom)
    ).toBe('1.575');

    // Disable crisp text: back to the live transform at the same scale, with
    // the original layout box and no residual reflow zoom.
    await page.evaluate(() => vz.setCrispText(false));
    await expect(page.locator(WRAPPER)).toHaveCount(1);
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.575, 10);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.getElementById('visual-zoom-wrapper')).transform
      )
    ).toBe('matrix(1.575, 0, 0, 1.575, 0, 0)');
    expect(
      await page.evaluate(() => document.documentElement.style.zoom)
    ).toBe('');
    expect(await scrollLayoutWidth(page)).toBe(1024);
  });

  test('@fixture at scale 1 crisp text is a no-op: no wrapper, no reflow zoom, and the page stays interactive', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setCrispText(true));
    await expect(page.locator(WRAPPER)).toHaveCount(0);
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
    expect(
      await page.evaluate(() => document.documentElement.style.zoom)
    ).toBe('');
    expect(await page.evaluate(() => vz.isEngaged())).toBe(true);

    // Hotkey zoom from crisp-at-1x still engages reflow zoom.
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '+',
          bubbles: true,
          cancelable: true,
          shiftKey: true,
        })
      );
    });
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05, 10);
    expect(
      await page.evaluate(() => document.documentElement.style.zoom)
    ).toBe('1.05');
  });

  test('@fixture gesture zoom in crisp mode changes the reflow level (no cursor anchor, by design)', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setCrispText(true));
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
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05, 10);
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).zoom)
    ).toBe('1.05');
  });

  test('@fixture dispose() from crisp mode restores the page completely', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(1.5));
    await page.evaluate(() => vz.setCrispText(true));
    await page.evaluate(() => vz.dispose());

    const state = await page.evaluate(() => ({
      wrapped: document.getElementById('visual-zoom-wrapper') !== null,
      zoom: document.documentElement.style.zoom,
      scale: vz.getScale(),
      overflow: document.documentElement.style.overflow,
    }));
    expect(state.wrapped).toBe(false);
    expect(state.zoom).toBe('');
    expect(state.scale).toBe(1);
    expect(state.overflow).toBe('');

    // Re-applying after a crisp teardown engages fresh from 1x.
    await page.evaluate(() => vz.apply());
    await expect(page.locator(WRAPPER)).toHaveCount(1);
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
  });
});

test.describe('06 — configurable zoom inputs (module)', () => {
  const dispatchHotkey = (page, key, modifiers) =>
    page.evaluate(
      ({ key, modifiers }) => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }));
      },
      { key, modifiers }
    );

  const dispatchWheel = (page, deltaY, modifiers) =>
    page.evaluate(
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

  test('@fixture the configured modifier and hotkeys drive zoom, and setInputs switches them live', async ({
    page,
  }) => {
    await loadVisualZoom(page, {
      modifier: 'ctrlKey',
      hotkeys: {
        zoomIn: { modifier: 'ctrlKey', key: '+' },
        zoomOut: { modifier: 'ctrlKey', key: '-' },
        reset: { modifier: 'ctrlKey', key: '0' },
      },
    });

    // Alt combos are inert under the Ctrl configuration (native zoom stays).
    await dispatchHotkey(page, '+', { altKey: true });
    expect(await page.evaluate(() => vz.getScale())).toBe(1);

    // Ctrl+Plus zooms in, Ctrl+wheel gestures zoom, Ctrl+0 resets.
    await dispatchHotkey(page, '+', { ctrlKey: true });
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05, 10);
    await dispatchWheel(page, -100, { ctrlKey: true });
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05 ** 2, 10);
    await dispatchHotkey(page, '0', { ctrlKey: true });
    expect(await page.evaluate(() => vz.getScale())).toBe(1);

    // setInputs switches to Alt live, without recreating the controller.
    await page.evaluate(() =>
      vz.setInputs({
        modifier: 'altKey',
        hotkeys: {
          zoomIn: { modifier: 'altKey', key: '+' },
          zoomOut: { modifier: 'altKey', key: '-' },
          reset: { modifier: 'altKey', key: '0' },
        },
      })
    );
    await dispatchHotkey(page, '+', { ctrlKey: true });
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
    await dispatchHotkey(page, '+', { altKey: true });
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05, 10);
  });

  test('@fixture a ctrl-configured modifier claims Ctrl+wheel (the user opted into claiming Ctrl)', async ({
    page,
  }) => {
    await loadVisualZoom(page, { modifier: 'ctrlKey' });
    // With Ctrl as the configured gesture modifier, Alt+wheel is inert (native
    // Alt+wheel is page panning), while Ctrl+wheel is claimed by visual zoom.
    await dispatchWheel(page, -100, { altKey: true });
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
    const prevented = await page.evaluate(() => {
      const e = new WheelEvent('wheel', {
        deltaY: -100,
        deltaMode: 0,
        clientX: 512,
        clientY: 384,
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05, 10);
  });
});
