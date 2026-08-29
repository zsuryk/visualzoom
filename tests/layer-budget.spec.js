import { test, expect } from '@playwright/test';

const FIXTURE = '/fixtures/native-zoom-breaking.html';
const BUDGET_NOTICE = '#visual-zoom-budget-notice';

async function loadTallVisualZoom(page) {
  await page.goto(FIXTURE);
  // The fixture's body is overflow-hidden, so its own content never extends
  // the document's scrollable area. Make the document's measured size reflect
  // a genuinely tall page: switch the body to visible overflow and append a
  // 6000px block BEFORE the module wraps, so the wrapper measures ~6000px.
  await page.evaluate(() => {
    document.body.style.overflow = 'visible';
    const tall = document.createElement('div');
    tall.id = 'fixture-tall';
    tall.style.height = '6000px';
    tall.style.background = 'rgb(255, 0, 0)';
    document.body.appendChild(tall);
  });
  await page.evaluate(async () => {
    const mod = await import('/src/content/visual-zoom.js');
    globalThis.vz = mod.createVisualZoom();
    globalThis.vz.apply();
  });
}

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

test.describe('05 — layer budget warning (module)', () => {
  test('@fixture zooming in past the compositor texture limit shows the one-time notice and logs telemetry', async ({
    page,
  }) => {
    const telemetry = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[visual-zoom] telemetry')) {
        telemetry.push(msg.text());
      }
    });

    await loadTallVisualZoom(page);

    // At 1x the ~6000px page is still within the 8192px texture budget: no
    // notice, no telemetry.
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
    await expect(page.locator(BUDGET_NOTICE)).toHaveCount(0);
    expect(telemetry).toEqual([]);

    // Seven hotkey zoom-ins (1.05^7 ≈ 1.407x) push the scaled page past the
    // limit: 6000 * 1.407 ≈ 8443px.
    for (let i = 0; i < 7; i++) {
      await pressHotkey(page, '+');
    }
    const scale = await page.evaluate(() => vz.getScale());
    expect(scale).toBeCloseTo(1.05 ** 7, 10);

    await expect(page.locator(BUDGET_NOTICE)).toHaveCount(1);
    await expect(page.locator(BUDGET_NOTICE)).toContainText('may be slow');

    // A telemetry line with the scaled dimensions was logged.
    const budgetLogs = telemetry.filter((l) => l.includes('layer-budget-exceeded'));
    expect(budgetLogs).toHaveLength(1);
    expect(budgetLogs[0]).toContain(`"height":${Math.round(6000 * 1.05 ** 7)}`);
  });

  test('@fixture the notice fires once per page load and never blocks zoom interaction', async ({
    page,
  }) => {
    await loadTallVisualZoom(page);
    await page.evaluate(() => vz.setScale(1.5));
    await expect(page.locator(BUDGET_NOTICE)).toHaveCount(1);

    // Dismissing the notice does not interrupt zoom: it just goes away.
    await page.click(`${BUDGET_NOTICE} button`);
    await expect(page.locator(BUDGET_NOTICE)).toHaveCount(0);

    // Zooming to the top of the envelope never re-shows the notice, and the
    // wrapper keeps scaling — the notice is non-blocking by construction.
    await page.evaluate(() => vz.setScale(3));
    expect(await page.evaluate(() => vz.getScale())).toBe(3);
    await expect(page.locator(BUDGET_NOTICE)).toHaveCount(0);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.getElementById('visual-zoom-wrapper')).transform
      )
    ).toBe('matrix(3, 0, 0, 3, 0, 0)');

    // Zooming back out stays equally unobstructed.
    await page.evaluate(() => vz.reset());
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
    await expect(page.locator(BUDGET_NOTICE)).toHaveCount(0);
  });

  test('@fixture a page within the texture budget never shows the notice', async ({ page }) => {
    await page.goto(FIXTURE);
    await page.evaluate(async () => {
      const mod = await import('/src/content/visual-zoom.js');
      globalThis.vz = mod.createVisualZoom();
      globalThis.vz.apply();
    });
    await page.evaluate(() => vz.setScale(3));
    await expect(page.locator(BUDGET_NOTICE)).toHaveCount(0);
  });
});
