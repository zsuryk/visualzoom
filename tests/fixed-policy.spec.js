import { test, expect } from '@playwright/test';

const FIXTURE = '/fixtures/native-zoom-breaking.html';
const LAYER = '#visual-zoom-fixed-layer';

async function loadVisualZoom(page, options = {}) {
  await page.goto(FIXTURE);
  await page.evaluate(async (opts) => {
    const mod = await import('/src/content/visual-zoom.js');
    globalThis.vz = mod.createVisualZoom(opts);
    globalThis.vz.apply();
  }, options);
}

async function openModal(page) {
  await page.click('#fixture-nav-action');
  await expect(page.locator('#fixture-modal-backdrop')).toHaveClass(/open/);
}

const modalBox = (page) => page.locator('#fixture-modal').boundingBox();
const modalWidth = async (page) => (await modalBox(page)).width;

test.describe('07 — fixed-element policy (module)', () => {
  test('@fixture scale-everything zooms fixed elements with the page', async ({ page }) => {
    await loadVisualZoom(page);
    await openModal(page);

    // Baseline at 1x: the 640px modal is centered in the viewport.
    const before = await modalBox(page);
    expect(before.width).toBeCloseTo(640, 0);
    expect(before.x).toBeCloseTo((1024 - 640) / 2, 0);

    // Zoom in: the modal scales with the page (1280px wide) and its right
    // edge is pushed past the viewport — it is clipped, not anchored.
    await page.evaluate(() => vz.setScale(2));
    const after = await modalBox(page);
    expect(after.width).toBeCloseTo(1280, 0);
    expect(after.x + after.width).toBeGreaterThan(1024);
  });

  test('@fixture protect-modals keeps an open modal viewport-anchored at 1x while the rest scales', async ({
    page,
  }) => {
    await loadVisualZoom(page, { policy: 'protect-modals' });
    await openModal(page);
    await page.evaluate(() => vz.setScale(2));

    // The modal stays centered in the viewport at 1x width.
    const modal = await modalBox(page);
    expect(modal.width).toBeCloseTo(640, 0);
    expect(modal.x).toBeCloseTo((1024 - 640) / 2, 0);

    // The rest of the page scales: the 3200px table renders 2x wide.
    const table = await page.locator('#fixture-table').boundingBox();
    expect(table.width).toBeCloseTo(6400, 0);

    // Panning under zoom: the scaled scroll area reaches the overflow around
    // the protected modal, which itself never drifts from the viewport.
    const metrics = await page.evaluate(() => {
      const html = document.documentElement;
      html.scrollLeft = 1e9;
      html.scrollTop = 1e9;
      return {
        sw: html.scrollWidth,
        sh: html.scrollHeight,
        left: html.scrollLeft,
        top: html.scrollTop,
      };
    });
    expect(metrics.sw).toBe(2048);
    expect(metrics.sh).toBe(1536);
    expect(metrics.left).toBe(1024);
    expect(metrics.top).toBe(768);

    const afterPan = await modalBox(page);
    expect(afterPan.x).toBeCloseTo(modal.x, 0);
    expect(afterPan.y).toBeCloseTo(modal.y, 0);
    expect(afterPan.width).toBeCloseTo(640, 0);
  });

  test('@fixture protect-sticky-too also anchors the sticky nav at 1x', async ({ page }) => {
    await loadVisualZoom(page, { policy: 'protect-sticky-too' });
    await page.evaluate(() => vz.setScale(2));

    // The sticky nav is viewport-anchored at 1x height, stuck to the top.
    const nav = await page.locator('#fixture-nav').boundingBox();
    expect(nav.height).toBeCloseTo(52, 0);
    expect(nav.y).toBeCloseTo(0, 0);

    // Panning the scaled scroll area does not move the anchored nav, and the
    // overflow around it stays reachable.
    const metrics = await page.evaluate(() => {
      const html = document.documentElement;
      html.scrollLeft = 1e9;
      html.scrollTop = 1e9;
      return { sw: html.scrollWidth, sh: html.scrollHeight };
    });
    expect(metrics.sw).toBe(2048);
    const navAfter = await page.locator('#fixture-nav').boundingBox();
    expect(navAfter.y).toBeCloseTo(0, 0);
    expect(navAfter.height).toBeCloseTo(52, 0);

    // The fixed modal is protected too, and ordinary content still scales.
    await openModal(page);
    expect(await modalWidth(page)).toBeCloseTo(640, 0);
    const table = await page.locator('#fixture-table').boundingBox();
    expect(table.width).toBeCloseTo(6400, 0);
  });

  test('@fixture a fixed element that appears after the page is already zoomed is tracked live', async ({
    page,
  }) => {
    await loadVisualZoom(page, { policy: 'protect-modals' });
    await page.evaluate(() => vz.setScale(2));

    // A modal-style fixed element is appended to the wrapped page after zoom.
    await page.evaluate(() => {
      const wrapper = document.getElementById('visual-zoom-wrapper');
      const late = document.createElement('div');
      late.id = 'late-modal';
      late.style.cssText =
        'position:fixed;top:60px;left:60px;width:120px;height:80px;' +
        'background:rgb(0,0,255);z-index:9999;';
      wrapper.appendChild(late);
    });

    // Live tracking lifts it into the unscaled fixed layer: it renders at 1x
    // (120px, at 60/60), not scaled to 2x (which would be 240px at 120/120).
    await expect
      .poll(async () => (await page.locator('#late-modal').boundingBox()).width)
      .toBeCloseTo(120, 0);
    const late = await page.locator('#late-modal').boundingBox();
    expect(late.x).toBeCloseTo(60, 0);
    expect(late.y).toBeCloseTo(60, 0);
    expect(late.height).toBeCloseTo(80, 0);
    await expect(page.locator(`${LAYER} #late-modal`)).toHaveCount(1);

    // It stays viewport-anchored while the page pans, and the overflow around
    // it is still reachable.
    const metrics = await page.evaluate(() => {
      const html = document.documentElement;
      html.scrollLeft = 1e9;
      html.scrollTop = 1e9;
      return { sw: html.scrollWidth, sh: html.scrollHeight };
    });
    expect(metrics.sw).toBe(2048);
    const afterPan = await page.locator('#late-modal').boundingBox();
    expect(afterPan.x).toBeCloseTo(60, 0);
    expect(afterPan.y).toBeCloseTo(60, 0);
    expect(afterPan.width).toBeCloseTo(120, 0);
  });

  test('@fixture an element that becomes fixed via a style change after zoom is caught live too', async ({
    page,
  }) => {
    await loadVisualZoom(page, { policy: 'protect-modals' });
    await page.evaluate(() => vz.setScale(2));

    // A normal in-flow element is appended; it is not fixed yet.
    await page.evaluate(() => {
      const wrapper = document.getElementById('visual-zoom-wrapper');
      const becomes = document.createElement('div');
      becomes.id = 'becomes-fixed';
      becomes.style.cssText = 'width:90px;height:60px;background:rgb(255,0,0);';
      wrapper.appendChild(becomes);
    });
    await expect(page.locator(`${LAYER} #becomes-fixed`)).toHaveCount(0);

    // The page turns it fixed after zoom; live tracking lifts it to 1x.
    await page.evaluate(() => {
      const el = document.getElementById('becomes-fixed');
      el.style.position = 'fixed';
      el.style.top = '20px';
      el.style.left = '20px';
    });
    await expect
      .poll(async () => (await page.locator('#becomes-fixed').boundingBox()).width)
      .toBeCloseTo(90, 0);
    const box = await page.locator('#becomes-fixed').boundingBox();
    expect(box.x).toBeCloseTo(20, 0);
    expect(box.y).toBeCloseTo(20, 0);
    await expect(page.locator(`${LAYER} #becomes-fixed`)).toHaveCount(1);
  });

  test('@fixture a modal revealed by a class change on an ancestor is caught live too', async ({
    page,
  }) => {
    await loadVisualZoom(page, { policy: 'protect-modals' });
    await page.evaluate(() => vz.setScale(2));

    // A host container that a page stylesheet turns into a fixed dialog
    // container only when marked open (a common modal wrapper pattern).
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'portal-styles';
      style.textContent =
        '#portal { width: 100px; height: 70px; background: rgb(0,128,0); }' +
        '#portal.open { position: fixed; top: 40px; left: 40px; }';
      const wrapper = document.getElementById('visual-zoom-wrapper');
      wrapper.appendChild(style);
      const portal = document.createElement('div');
      portal.id = 'portal';
      const modal = document.createElement('div');
      modal.id = 'portal-modal';
      modal.textContent = 'Modal inside portal';
      portal.appendChild(modal);
      wrapper.appendChild(portal);
    });
    await expect(page.locator(`${LAYER} #portal`)).toHaveCount(0);

    // The class lands on the container; the container and its content become protected.
    await page.evaluate(() => {
      document.getElementById('portal').classList.add('open');
    });
    await expect
      .poll(async () => (await page.locator('#portal').boundingBox()).width)
      .toBeCloseTo(100, 0);
    const box = await page.locator('#portal').boundingBox();
    expect(box.x).toBeCloseTo(40, 0);
    expect(box.y).toBeCloseTo(40, 0);
    await expect(page.locator(`${LAYER} #portal`)).toHaveCount(1);
    await expect(page.locator(`${LAYER} #portal-modal`)).toHaveCount(1);
  });

  test('@fixture switching modes live applies the new behavior immediately', async ({ page }) => {
    await loadVisualZoom(page);
    await openModal(page);
    await page.evaluate(() => vz.setScale(2));

    // Default scale-everything: modal scales with the page.
    expect(await modalWidth(page)).toBeCloseTo(1280, 0);

    // Switch to protect-modals: the modal snaps viewport-anchored at 1x.
    await page.evaluate(() => vz.setPolicy('protect-modals'));
    await expect.poll(() => modalWidth(page)).toBeCloseTo(640, 0);
    await expect(page.locator(`${LAYER} #fixture-modal-backdrop`)).toHaveCount(1);

    // Switch back: everything scales again, no reload.
    await page.evaluate(() => vz.setPolicy('scale-everything'));
    await expect.poll(() => modalWidth(page)).toBeCloseTo(1280, 0);
    await expect(page.locator(LAYER)).toHaveCount(0);

    // protect-sticky-too anchors both the modal and the sticky nav.
    await page.evaluate(() => vz.setPolicy('protect-sticky-too'));
    await expect.poll(() => modalWidth(page)).toBeCloseTo(640, 0);
    await expect
      .poll(async () => (await page.locator('#fixture-nav').boundingBox()).height)
      .toBeCloseTo(52, 0);
  });

  test('@fixture teardown restores lifted elements to their exact original spots', async ({ page }) => {
    await loadVisualZoom(page, { policy: 'protect-modals' });
    await openModal(page);
    await page.evaluate(() => vz.setScale(2));
    await expect(page.locator(`${LAYER} #fixture-modal-backdrop`)).toHaveCount(1);

    // Dispose: the modal backdrop returns to the page, the layer is gone, and
    // the page regains its exact pre-zoom DOM.
    await page.evaluate(() => vz.dispose());
    await expect(page.locator(LAYER)).toHaveCount(0);
    const state = await page.evaluate(() => {
      const backdrop = document.getElementById('fixture-modal-backdrop');
      return {
        bodyChildren: document.body.children.length,
        // The backdrop is a body-level element on this fixture: it returns to
        // its exact original parent, with its original position.
        backdropInBody: backdrop ? backdrop.parentElement === document.body : false,
        backdropPosition: backdrop ? getComputedStyle(backdrop).position : null,
        scale: vz.getScale(),
      };
    });
    expect(state.bodyChildren).toBe(3);
    expect(state.backdropInBody).toBe(true);
    expect(state.backdropPosition).toBe('fixed');
    expect(state.scale).toBe(1);
  });
});
