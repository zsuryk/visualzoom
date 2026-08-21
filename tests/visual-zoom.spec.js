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

test.describe('02 — wrapper, scaled scroll area, letterbox bands', () => {
  test('@fixture scale > 1: the scaled scroll area reaches the page overflow', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(2));

    // The native scroll area's box is the original dimensions x the scale.
    const metrics = await page.evaluate(() => {
      const html = document.documentElement;
      return {
        sw: html.scrollWidth,
        sh: html.scrollHeight,
        cw: html.clientWidth,
        ch: html.clientHeight,
      };
    });
    expect(metrics.cw).toBe(1024);
    expect(metrics.ch).toBe(768);
    expect(metrics.sw).toBe(2048);
    expect(metrics.sh).toBe(1536);

    // The status card starts below the viewport-visible region.
    const before = await page.locator('#fixture-status').boundingBox();
    expect(before.y).toBeGreaterThanOrEqual(metrics.ch);

    // Scrolling to the bottom lands past the viewport-visible region.
    await page.evaluate(() => {
      document.documentElement.scrollTop = 1e9;
      document.getElementById('fixture-scroll').scrollTop = 1e9;
    });
    const after = await page.locator('#fixture-status').boundingBox();
    expect(after.y).toBeGreaterThanOrEqual(0);
    expect(after.y + after.height).toBeLessThanOrEqual(metrics.ch);

    // The zoomed-in right overflow is reachable horizontally too.
    const reachableX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(reachableX).toBe(1024);
    await page.evaluate(() => {
      document.documentElement.scrollLeft = 1e9;
    });
    expect(await page.evaluate(() => document.documentElement.scrollLeft)).toBe(reachableX);
  });

  test('@fixture native scrolling reaches the zoomed overflow', async ({ page }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(2));

    // The scaled overflow is a real native scroll area: a scrollbar exists
    // that reaches it. (Headless shell ignores wheel/keys aimed at the root
    // scroller, so wheel is exercised on the page's own scroll region and
    // the scaled area is driven through focus and touch instead.)
    const scrollArea = await page.evaluate(() => {
      const html = document.documentElement;
      return {
        overflow: getComputedStyle(html).overflow,
        reachX: html.scrollWidth - html.clientWidth,
        reachY: html.scrollHeight - html.clientHeight,
      };
    });
    expect(scrollArea.overflow).toBe('auto');
    expect(scrollArea.reachX).toBe(1024);
    expect(scrollArea.reachY).toBe(768);

    // Wheel: the fixture's native scroll region inside the zoomed page scrolls.
    await page.evaluate(() => {
      document.getElementById('fixture-scroll').scrollTop = 0;
    });
    await page.mouse.move(500, 400);
    await page.mouse.wheel(0, 300);
    await page.mouse.wheel(0, 300);
    const regionTop = await page.evaluate(
      () => document.getElementById('fixture-scroll').scrollTop
    );
    expect(regionTop).toBeGreaterThan(0);

    // Keyboard navigation scrolls the scaled scroll area natively: focusing
    // the deepest control moves the scroll that keyboard navigation relies on
    // (browser-internal scroll-into-view), bringing it inside the viewport.
    await page.evaluate(() => {
      document.documentElement.scrollTop = 0;
      document.documentElement.scrollLeft = 0;
      document.getElementById('fixture-replace').focus();
    });
    const kb = await page.evaluate(() => ({
      active: document.activeElement && document.activeElement.id,
      scrollTop: document.documentElement.scrollTop,
    }));
    expect(kb.active).toBe('fixture-replace');
    expect(kb.scrollTop).toBeGreaterThan(0);

    // Touch/scrollbar gesture: a native scroll gesture drives the scaled root
    // scroll area. The fixture's own scroll region (the page's only scroller)
    // carries overscroll-behavior: contain, which traps gestures at its edge;
    // in this feature's context that inner scroller is just nested content, so
    // the test lets it overflow like an ordinary scrollable pod. With the
    // region at its end, a continued gesture chains onto the root scroller —
    // exactly how touch/scrollbar interaction reaches the zoomed overflow.
    await page.evaluate(() => {
      const region = document.getElementById('fixture-scroll');
      region.style.overscrollBehavior = 'auto';
      region.scrollTop = 1e9;
      document.documentElement.scrollTop = 0;
    });
    const regionEndTop = await page.evaluate(
      () => document.getElementById('fixture-scroll').scrollTop
    );
    expect(regionEndTop).toBeGreaterThan(0);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizeScrollGesture', {
      x: 500,
      y: 500,
      yDistance: -300,
      speed: 300,
    });
    const gestureTop = await page.evaluate(() => document.documentElement.scrollTop);
    expect(gestureTop).toBeGreaterThan(0);
  });

  test('@fixture wheel chains onto the zoomed root scroller', async ({ page }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(2));

    // The nested region traps gestures at its edge by default; with chaining
    // allowed, a continued wheel at the region's end reaches the root
    // scroller — the scaled scroll area.
    await page.evaluate(() => {
      const region = document.getElementById('fixture-scroll');
      region.style.overscrollBehavior = 'auto';
      region.scrollTop = 1e9;
      document.documentElement.scrollTop = 0;
    });
    await page.mouse.move(500, 400);
    await page.mouse.wheel(0, 300);
    await page.mouse.wheel(0, 300);
    const rootTop = await page.evaluate(() => document.documentElement.scrollTop);
    expect(rootTop).toBeGreaterThan(0);
  });

  test('@fixture keyboard scrolling reaches the zoomed overflow', async ({ page }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(2));

    // Arrow keys on the focused page scroll the root scroll area natively.
    await page.evaluate(() => {
      document.documentElement.scrollTop = 0;
      document.body.tabIndex = 0;
      document.body.focus();
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const rootTop = await page.evaluate(() => document.documentElement.scrollTop);
    expect(rootTop).toBeGreaterThan(0);
  });

  test('@fixture content wider than the original box stays reachable (no wrapper clip)', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(2));

    // A non-scrollable element wider than the page's original box, appended
    // to the wrapped content. The wrapper must not clip it: the scroll area
    // covers it at original x scale.
    await page.evaluate(() => {
      const wrapper = document.getElementById('visual-zoom-wrapper');
      const wide = document.createElement('div');
      wide.id = 'fixture-wide';
      wide.style.width = '2000px';
      wide.style.height = '20px';
      wide.style.background = 'rgb(0, 0, 0)';
      wrapper.appendChild(wide);
    });

    const reach = await page.evaluate(() => {
      const html = document.documentElement;
      return { reachX: html.scrollWidth - html.clientWidth };
    });
    expect(reach.reachX).toBe(2000 * 2 - 1024);

    await page.evaluate(() => {
      document.documentElement.scrollLeft = 1e9;
    });
    expect(await page.evaluate(() => document.documentElement.scrollLeft)).toBe(reach.reachX);
  });

  test('@fixture state is shared across instances: re-apply keeps scale, any instance can dispose', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(async () => {
      const mod = await import('/src/content/visual-zoom.js');
      globalThis.vz2 = mod.createVisualZoom();
      vz2.apply();
      vz.setScale(2);
    });
    expect(await page.evaluate(() => vz.getScale())).toBe(2);

    // Re-applying with the default scale preserves the active zoom.
    await page.evaluate(() => vz2.apply());
    expect(await page.evaluate(() => vz.getScale())).toBe(2);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.getElementById('visual-zoom-wrapper')).transform
      )
    ).toBe('matrix(2, 0, 0, 2, 0, 0)');

    // Disposing from the non-owning instance restores the page completely.
    await page.evaluate(() => vz2.dispose());
    expect(await page.evaluate(() => document.body.children.length)).toBe(3);
    expect(
      await page.evaluate(() => !document.getElementById('visual-zoom-wrapper'))
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
    expect(await page.evaluate(() => document.documentElement.style.background)).toBe('');

    // And applying again works from scratch.
    await page.evaluate(() => vz.apply());
    expect(await page.evaluate(() => document.body.children.length)).toBe(1);
  });

  test('@fixture re-applying after navigation does not double-wrap', async ({ page }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(1.5));

    await page.reload();
    await page.evaluate(async () => {
      const mod = await import('/src/content/visual-zoom.js');
      globalThis.vz = mod.createVisualZoom();
      globalThis.vz.apply();
    });

    expect(await page.evaluate(() => document.body.children.length)).toBe(1);
    expect(
      await page.evaluate(() => document.getElementById('visual-zoom-wrapper') !== null)
    ).toBe(true);
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
  });

  test('@fixture scale < 1: letterbox bands show the page background, geometry untouched', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    // Zooming below 1x is gated; the letterbox path needs the gate on.
    await page.evaluate(() => vz.setZoomBelow100(true));
    await page.evaluate(() => vz.setScale(0.5));

    // Zoomed out, nothing overflows the viewport: no native scrollbar.
    const metrics = await page.evaluate(() => {
      const html = document.documentElement;
      return {
        sw: html.scrollWidth,
        sh: html.scrollHeight,
        cw: html.clientWidth,
        ch: html.clientHeight,
        overflow: getComputedStyle(html).overflow,
      };
    });
    expect(metrics.overflow).toBe('hidden');
    expect(metrics.sw).toBe(metrics.cw);
    expect(metrics.sh).toBe(metrics.ch);

    // The bands are filled with the page background, not blank white.
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
    ).toBe('rgb(233, 233, 236)');

    const shot = await page.screenshot({ type: 'png' });
    const px = await page.evaluate(async (b64) => {
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
      const at = (x, y) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      return { right: at(1000, 400), bottom: at(512, 700), corner: at(1014, 758) };
    }, shot.toString('base64'));
    expect(px.right).toEqual([233, 233, 236]);
    expect(px.bottom).toEqual([233, 233, 236]);
    expect(px.corner).toEqual([233, 233, 236]);

    // Content geometry is untouched: the wrapper keeps the original layout
    // box and the fixture's own dimensions are unmodified.
    const geometry = await page.evaluate(() => {
      const w = document.getElementById('visual-zoom-wrapper');
      const r = w.getBoundingClientRect();
      return {
        wrapperLayoutW: w.offsetWidth,
        wrapperLayoutH: w.offsetHeight,
        wrapperVisualW: r.width,
        wrapperVisualH: r.height,
        nav: document.getElementById('fixture-nav').offsetHeight,
        table: document.getElementById('fixture-table').offsetWidth,
        region: document.getElementById('fixture-scroll').offsetWidth,
      };
    });
    expect(geometry.wrapperLayoutW).toBe(1024);
    expect(geometry.wrapperLayoutH).toBe(768);
    expect(geometry.wrapperVisualW).toBe(512);
    expect(geometry.wrapperVisualH).toBe(384);
    expect(geometry.nav).toBe(52);
    expect(geometry.table).toBe(3200);
    expect(geometry.region).toBe(1024);
  });

  test('@fixture the wrapper is idempotent and tears down cleanly', async ({ page }) => {
    await loadVisualZoom(page);

    const children = () => page.evaluate(() => document.body.children.length);
    expect(await children()).toBe(1);

    // Re-applying (a second controller instance) does not double-wrap.
    await page.evaluate(async () => {
      const mod = await import('/src/content/visual-zoom.js');
      globalThis.vz2 = mod.createVisualZoom();
      vz2.apply();
    });
    expect(await children()).toBe(1);

    // Zooming still works after the double apply.
    await page.evaluate(() => vz.setScale(3));
    expect(await children()).toBe(1);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.getElementById('visual-zoom-wrapper')).transform
      )
    ).toBe('matrix(3, 0, 0, 3, 0, 0)');

    // Teardown returns the page to its original structure... (the fixture's
    // body has three children: the scroll region, the modal, the inline script)
    await page.evaluate(() => vz.dispose());
    expect(await children()).toBe(3);
    expect(
      await page.evaluate(() => !document.getElementById('visual-zoom-wrapper'))
    ).toBe(true);

    // ...and applying again works from scratch.
    await page.evaluate(() => vz.apply());
    expect(await children()).toBe(1);
  });
});