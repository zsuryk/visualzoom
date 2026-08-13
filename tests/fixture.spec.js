import { test, expect } from '@playwright/test';

const FIXTURE = '/fixtures/native-zoom-breaking.html';

const STABLE_IDS = [
  'fixture-nav',
  'fixture-nav-action',
  'fixture-scroll',
  'fixture-table-wrap',
  'fixture-table',
  'fixture-table-header',
  'fixture-canvas',
  'fixture-replace',
  'fixture-swap-region',
  'fixture-modal-backdrop',
  'fixture-modal',
  'fixture-modal-close',
  'fixture-status',
];

async function gotoFixture(page) {
  await page.goto(FIXTURE);
  await page.waitForLoadState('load');
}

test.describe('01 — native-zoom-breaking fixture', () => {
  test('@fixture loads as a complex, fully-functional page', async ({ page }) => {
    const external = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.hostname !== '127.0.0.1') external.push(req.url());
    });

    await gotoFixture(page);

    // Deterministic and servable locally: no external network dependencies.
    expect(external).toEqual([]);

    // Stable selectors/ids reachable by browser automation.
    for (const id of STABLE_IDS) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }

    // Sticky nav, pixel-pinned, sitting at the top.
    const nav = await page.evaluate(() => {
      const el = document.getElementById('fixture-nav');
      const cs = getComputedStyle(el);
      return {
        position: cs.position,
        top: cs.top,
        height: el.getBoundingClientRect().height,
      };
    });
    expect(nav.position).toBe('sticky');
    expect(nav.top).toBe('0px');
    expect(nav.height).toBe(52);

    // The nav genuinely sticks: scrolling the region does not move it.
    await page.evaluate(() => {
      document.getElementById('fixture-scroll').scrollTop = 600;
    });
    expect(await page.locator('#fixture-nav').boundingBox()).toMatchObject({ y: 0 });

    // Overflow-hidden body: the root never scrolls; only #fixture-scroll does.
    const bodyOverflow = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { x: cs.overflowX, y: cs.overflowY };
    });
    expect(bodyOverflow.x).toBe('hidden');
    expect(bodyOverflow.y).toBe('hidden');

    // Huge scrollable table: 400 deterministic rows, overflow within its wrap.
    const table = await page.evaluate(() => {
      const wrap = document.getElementById('fixture-table-wrap');
      const tbody = document.querySelector('#fixture-table tbody');
      return {
        rows: tbody.children.length,
        scrollable: wrap.scrollHeight > wrap.clientHeight,
        stickyHeader: getComputedStyle(
          document.getElementById('fixture-table-header').firstElementChild
        ).position,
      };
    });
    expect(table.rows).toBe(400);
    expect(table.scrollable).toBe(true);
    expect(table.stickyHeader).toBe('sticky');

    // Canvas: rasterised at load time with a non-empty backing store.
    const canvas = await page.evaluate(() => {
      const c = document.getElementById('fixture-canvas');
      const d = c.getContext('2d').getImageData(40, 40, 1, 1).data;
      return { width: c.width, height: c.height, opaque: d[3] > 0 };
    });
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(240);
    expect(canvas.opaque).toBe(true);

    // Fixed modal: hidden at first, opens on demand, fits the viewport at 1x.
    await expect(page.locator('#fixture-modal-backdrop')).not.toHaveClass(/open/);
    await page.click('#fixture-nav-action');
    await expect(page.locator('#fixture-modal-backdrop')).toHaveClass(/open/);
    await expect(page.locator('#fixture-modal')).toBeVisible();
    const modal = await page.locator('#fixture-modal').boundingBox();
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(modal.x).toBeGreaterThanOrEqual(0);
    expect(modal.x + modal.width).toBeLessThanOrEqual(innerWidth);

    // Close the modal so its full-viewport backdrop stops intercepting hits
    // on the rest of the page before driving the DOM-replace region below.
    await page.click('#fixture-modal-close');
    await expect(page.locator('#fixture-modal-backdrop')).not.toHaveClass(/open/);

    // DOM-replace region: React-style swap removes the old nodes.
    await expect(page.locator('#swap-original')).toBeVisible();
    await page.click('#fixture-replace');
    await expect(page.locator('#swap-text')).toContainText('swap #1');
    await expect(page.locator('#swap-original')).toHaveCount(0);
    await page.click('#fixture-replace');
    await expect(page.locator('#swap-text')).toContainText('swap #2');

    // Status readout reflects the interactions.
    await expect(page.locator('#fixture-status')).toHaveText('swapped:2');
  });

  test('@fixture native browser zoom visibly breaks the sticky/fixed elements', async ({
    page,
  }) => {
    await gotoFixture(page);

    // Baseline: nav action button fully inside the viewport, modal unclipped.
    const baseline = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
    }));
    expect(baseline.innerWidth).toBe(1024);

    const navAction = page.locator('#fixture-nav-action');
    const navActionBefore = await navAction.boundingBox();
    expect(navActionBefore.x + navActionBefore.width).toBeLessThanOrEqual(
      baseline.innerWidth
    );

    // Open the fixed modal before zooming and keep it open: at 1x it must
    // fit entirely within the viewport.
    await page.click('#fixture-nav-action');
    const modalBefore = await page.locator('#fixture-modal').boundingBox();
    expect(modalBefore.x).toBeGreaterThanOrEqual(0);
    expect(modalBefore.x + modalBefore.width).toBeLessThanOrEqual(baseline.innerWidth);

    // Zoom in so the layout reflows to a clearly smaller viewport: native
    // zoom reuses Chromium's page-scale reflow, which the headless shell
    // build ignores from the keyboard, so drive the identical layout-viewport
    // shrink (window.innerWidth reflows to ~1.8x smaller) through CDP.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 560,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(innerWidth, 'page zoom did not reflow the layout').toBeLessThanOrEqual(
      baseline.innerWidth / 1.8
    );

    // The sticky nav's pixel-pinned width no longer fits the zoomed viewport:
    // its action button is pushed past the visible edge and unreachable.
    const navActionAfter = await navAction.boundingBox();
    expect(navActionAfter.x + navActionAfter.width).toBeGreaterThan(innerWidth);

    // The fixed modal is now clipped on both sides of the viewport.
    const modalAfter = await page.locator('#fixture-modal').boundingBox();
    expect(modalAfter.x).toBeLessThan(0);
    expect(modalAfter.x + modalAfter.width).toBeGreaterThan(innerWidth);
  });
});
