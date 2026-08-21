import { test, expect } from '@playwright/test';

const FIXTURE = '/fixtures/native-zoom-breaking.html';

async function loadVisualZoom(page) {
  await page.goto(FIXTURE);
  await page.evaluate(async () => {
    const mod = await import('/src/content/visual-zoom.js');
    globalThis.vz = mod.createVisualZoom();
    globalThis.vz.apply();
  });
}

async function gestureWheel(page, cx, cy, deltaY, count = 1, modifiers = {}) {
  await page.evaluate(
    ({ cx, cy, deltaY, count, modifiers }) => {
      for (let i = 0; i < count; i++) {
        window.dispatchEvent(
          new WheelEvent('wheel', {
            deltaX: 0,
            deltaY,
            deltaMode: 0,
            clientX: cx,
            clientY: cy,
            bubbles: true,
            cancelable: true,
            ...modifiers,
          })
        );
      }
    },
    { cx, cy, deltaY, count, modifiers }
  );
}

// Alt+Plus on the main keyboard is Shift+=, which real browsers report as the
// '+' key. Playwright's accelerator cannot produce the shifted character, so
// the hotkeys are driven as DOM keydown events with the real '+' key/Alt
// modifier — the exact event our listener consumes.
async function pressHotkey(page, key) {
  await page.evaluate((key) => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        altKey: true,
      })
    );
  }, key);
}

async function probePixel(page, shot, x, y) {
  return page.evaluate(
    async ({ b64, x, y }) => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = 'data:image/png;base64,' + b64;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    },
    { b64: shot.toString('base64'), x, y }
  );
}

test.describe('03 — scale model and zoom inputs', () => {
  test('@fixture modifier+wheel zoom anchors the pixel under the cursor', async ({ page }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => {
      // A solid-red marker centred at the viewport centre at scale 1 with
      // zero scroll: page coordinate (512, 384), size 60 -> spans
      // (482..542) x (354..414) on screen.
      const wrapper = document.getElementById('visual-zoom-wrapper');
      const marker = document.createElement('div');
      marker.id = 'anchor-marker';
      marker.style.cssText =
        'position:absolute;left:482px;top:354px;width:60px;height:60px;' +
        'background:rgb(255,0,0);z-index:999;';
      wrapper.appendChild(marker);
    });

    const cx = 512;
    const cy = 384;

    const before = await page.evaluate(({ cx, cy }) => {
      const html = document.documentElement;
      const el = document.elementFromPoint(cx, cy);
      return {
        element: el ? el.tagName + (el.id ? '#' + el.id : '') : null,
        scale: vz.getScale(),
        scrollLeft: html.scrollLeft,
        scrollTop: html.scrollTop,
        px: (html.scrollLeft + cx) / vz.getScale(),
        py: (html.scrollTop + cy) / vz.getScale(),
      };
    }, { cx, cy });
    expect(before.scale).toBe(1);
    expect(before.element).toBe('DIV#anchor-marker');

    const shotBefore = await page.screenshot();
    const pixelBefore = await probePixel(page, shotBefore, cx, cy);
    expect(pixelBefore).toEqual([255, 0, 0]);

    // Four notches of Alt+wheel zoom-in anchored under the cursor.
    await gestureWheel(page, cx, cy, -100, 4, { altKey: true });

    const expectedScale = 1.05 ** 4;
    const after = await page.evaluate(({ cx, cy }) => {
      const html = document.documentElement;
      const el = document.elementFromPoint(cx, cy);
      return {
        element: el ? el.tagName + (el.id ? '#' + el.id : '') : null,
        scale: vz.getScale(),
        scrollLeft: html.scrollLeft,
        scrollTop: html.scrollTop,
        px: (html.scrollLeft + cx) / vz.getScale(),
        py: (html.scrollTop + cy) / vz.getScale(),
      };
    }, { cx, cy });

    expect(after.scale).toBeCloseTo(expectedScale, 10);
    expect(after.element).toBe('DIV#anchor-marker');
    // The under-cursor content coordinate is preserved; a sub-pixel drift is
    // expected because the root scroller rounds scroll offsets to whole CSS
    // pixels at device scale 1.
    expect(Math.abs(after.px - before.px)).toBeLessThan(1.5);
    expect(Math.abs(after.py - before.py)).toBeLessThan(1.5);
    // The scroll area was really compensated, not left at its old position.
    expect(after.scrollLeft).toBeGreaterThan(100);
    expect(after.scrollLeft).toBeLessThan(120);
    expect(after.scrollTop).toBeGreaterThan(70);
    expect(after.scrollTop).toBeLessThan(90);

    // The pixel under the cursor is still the red marker's pixel on screen.
    const shotAfter = await page.screenshot();
    const pixelAfter = await probePixel(page, shotAfter, cx, cy);
    expect(pixelAfter).toEqual([255, 0, 0]);
  });

  test('@fixture Alt+Plus / Alt+Minus / Alt+0 zoom in, out, and reset to exactly 1x', async ({
    page,
  }) => {
    await loadVisualZoom(page);

    await pressHotkey(page, '+');
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05, 10);
    await pressHotkey(page, '+');
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05 ** 2, 10);

    await pressHotkey(page, '-');
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05, 10);

    await pressHotkey(page, '0');
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
  });

  test('@fixture hotkeys clamp at the 0.3x–3x envelope', async ({ page }) => {
    await loadVisualZoom(page);
    // The envelope floor is only reachable with the zoom-below-100 gate on.
    await page.evaluate(() => vz.setZoomBelow100(true));

    await page.evaluate(() => vz.setScale(2.9));
    await pressHotkey(page, '+');
    expect(await page.evaluate(() => vz.getScale())).toBe(3);
    await pressHotkey(page, '+');
    expect(await page.evaluate(() => vz.getScale())).toBe(3);

    await pressHotkey(page, '0');
    await page.evaluate(() => vz.setScale(0.31));
    await pressHotkey(page, '-');
    expect(await page.evaluate(() => vz.getScale())).toBe(0.3);
    await pressHotkey(page, '-');
    expect(await page.evaluate(() => vz.getScale())).toBe(0.3);
  });

  test('@fixture gesture zoom and hotkey zoom agree on the shared scale state', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    // The final gesture zooms out below 1x, which needs the gate on.
    await page.evaluate(() => vz.setZoomBelow100(true));

    // Zoom in by gesture: 3 notches.
    await gestureWheel(page, 512, 384, -100, 3, { altKey: true });
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05 ** 3, 10);

    // Hotkeys continue from the same settled scale, not from 1x.
    await pressHotkey(page, '+');
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05 ** 4, 10);
    await pressHotkey(page, '-');
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05 ** 3, 10);

    // And gesture again from that state.
    await gestureWheel(page, 512, 384, -100, 2, { altKey: true });
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05 ** 5, 10);

    // Gesturing out clamps to the envelope, and reset recovers exactly 1x.
    await gestureWheel(page, 512, 384, 100, 1000, { altKey: true });
    expect(await page.evaluate(() => vz.getScale())).toBe(0.3);
    await pressHotkey(page, '0');
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
  });

  test('@fixture the zoom-below-100 gate clamps zoom-out at 100% by default and unlocks the envelope live', async ({
    page,
  }) => {
    await loadVisualZoom(page);

    // Default: zooming out stops exactly at 100%.
    await page.evaluate(() => vz.setScale(1.05));
    await pressHotkey(page, '-');
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
    await pressHotkey(page, '-');
    expect(await page.evaluate(() => vz.getScale())).toBe(1);

    // Wheel zoom-out clamps the same way.
    await gestureWheel(page, 512, 384, 100, 1000, { altKey: true });
    expect(await page.evaluate(() => vz.getScale())).toBe(1);

    // Directly setting a sub-1x scale is clamped to 100% too.
    await page.evaluate(() => vz.setScale(0.5));
    expect(await page.evaluate(() => vz.getScale())).toBe(1);

    // Enabling the gate live lets zoom-out pass 1x down to the envelope floor.
    await page.evaluate(() => vz.setZoomBelow100(true));
    await gestureWheel(page, 512, 384, 100, 1000, { altKey: true });
    expect(await page.evaluate(() => vz.getScale())).toBe(0.3);

    // Disabling the gate live re-clamps a settled sub-1x scale to 100%.
    await page.evaluate(() => vz.setZoomBelow100(false));
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
  });

  test('@fixture line-mode wheels still perform gesture zoom', async ({ page }) => {
    await loadVisualZoom(page);

    // Some platforms report wheel deltas in lines (deltaMode 1), not pixels.
    // A few lines must still produce a real zoom step, not a ~0 notch.
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) {
        window.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -3,
            deltaMode: 1,
            clientX: 512,
            clientY: 384,
            bubbles: true,
            cancelable: true,
            altKey: true,
          })
        );
      }
    });
    const scale = await page.evaluate(() => vz.getScale());
    expect(scale).toBeGreaterThan(1.05);
    expect(scale).toBeLessThan(1.05 ** 2);
  });

  test('@fixture without the modifier, wheel pans normally and scale is untouched', async ({
    page,
  }) => {
    await loadVisualZoom(page);

    // A plain wheel event is not intercepted: its default (native panning)
    // is left in the browser's hands.
    const notPrevented = await page.evaluate(() => {
      const e = new WheelEvent('wheel', {
        deltaY: 100,
        deltaMode: 0,
        clientX: 512,
        clientY: 384,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(notPrevented).toBe(false);
    expect(await page.evaluate(() => vz.getScale())).toBe(1);

    // Real wheel input pans the page's own scroll region normally. The cursor
    // sits on the page heading, whose scroll chain leads to the page's own
    // scroll region (no inner scroller intercepts the wheel).
    const heading = await page.locator('h1').boundingBox();
    await page.evaluate(() => {
      document.getElementById('fixture-scroll').scrollTop = 0;
    });
    await page.mouse.move(heading.x + 60, heading.y + heading.height / 2);
    await page.mouse.wheel(0, 300);
    await page.mouse.wheel(0, 300);
    const regionTop = await page.evaluate(
      () => document.getElementById('fixture-scroll').scrollTop
    );
    expect(regionTop).toBeGreaterThan(0);
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
  });

  test('@fixture Ctrl+wheel and Ctrl+Plus keep native browser zoom untouched', async ({
    page,
  }) => {
    await loadVisualZoom(page);

    // Ctrl+wheel is not claimed by our gesture: its default is not prevented
    // (so the browser's native reflow zoom proceeds) and our scale is static.
    // Ctrl+Alt+wheel is equally unclaimed — the hotkeys' Ctrl exclusion
    // applies to the gesture too.
    const ctrlWheel = await page.evaluate(() => {
      const e = new WheelEvent('wheel', {
        deltaY: 100,
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
    expect(ctrlWheel).toBe(false);

    const ctrlAltWheel = await page.evaluate(() => {
      const e = new WheelEvent('wheel', {
        deltaY: -100,
        deltaMode: 0,
        clientX: 512,
        clientY: 384,
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        altKey: true,
      });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(ctrlAltWheel).toBe(false);

    // Ctrl+Plus (Ctrl+Shift+=, key '+') is not claimed by our hotkeys (which
    // are Alt): the default is not prevented, so native zoom proceeds.
    const ctrlPlus = await page.evaluate(() => {
      const e = new KeyboardEvent('keydown', {
        key: '+',
        code: 'Equal',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(ctrlPlus).toBe(false);

    // Real Ctrl+wheel input leaves the scale untouched. (Headless shell
    // ignores browser page zoom, so only our non-interference is asserted;
    // the native reflow zoom itself is out of this module's hands.)
    await page.keyboard.down('Control');
    await page.mouse.move(512, 384);
    await page.mouse.wheel(0, 300);
    await page.keyboard.up('Control');
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
  });
});