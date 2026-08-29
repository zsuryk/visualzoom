import { test, expect } from '@playwright/test';
import { STABILITY_MS } from '../src/content/visual-zoom.js';

const FIXTURE = '/fixtures/native-zoom-breaking.html';

const NOTICE = '#visual-zoom-notice';
const WRAPPER = '#visual-zoom-wrapper';

async function applyVisualZoom(page) {
  await page.evaluate(async () => {
    const mod = await import('/src/content/visual-zoom.js');
    globalThis.vz = mod.createVisualZoom();
    globalThis.vz.apply();
  });
}

async function loadVisualZoom(page) {
  await page.goto(FIXTURE);
  await applyVisualZoom(page);
}

// Shift+Plus on the main keyboard is Shift+=, which real browsers report as the
// '+' key. Playwright's accelerator cannot produce the shifted character, so
// the hotkeys are driven as DOM keydown events — the exact event our listener
// consumes.
async function pressHotkey(page, key) {
  await page.evaluate((key) => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        shiftKey: true,
      })
    );
  }, key);
}

test.describe('04 — wrapper survival and graceful teardown', () => {
  test('@fixture the wrapper survives the fixture region-level DOM replacement while zoomed', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(1.5));

    // The fixture's React-style swap only replaces the region's children,
    // deep inside the wrapper. Ordinary in-page DOM replacement must not
    // destroy the wrapper or the zoom.
    await page.click('#fixture-replace');
    await expect(page.locator('#swap-text')).toContainText('swap #1');
    await expect(page.locator(WRAPPER)).toHaveCount(1);
    await expect(page.locator(NOTICE)).toHaveCount(0);

    const state = await page.evaluate(() => ({
      scale: vz.getScale(),
      transform: getComputedStyle(document.getElementById('visual-zoom-wrapper')).transform,
    }));
    expect(state.scale).toBeCloseTo(1.5, 10);
    expect(state.transform).toBe('matrix(1.5, 0, 0, 1.5, 0, 0)');

    // And zooming still works on the surviving wrapper.
    await pressHotkey(page, '+');
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.5 * 1.05, 10);
  });

  test('@fixture body-level replaceChildren while zoomed re-applies the wrapper and preserves zoom', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(1.5));
    await page.evaluate(() => {
      document.documentElement.scrollTop = 200;
    });

    // A body-level clear (SPA router / replaceChildren-driven framework) takes
    // the wrapper with it. The module re-applies it around the fresh content
    // at the current scale.
    await page.evaluate(() => document.getElementById('fixture-body-replace').click());
    await expect(page.locator('#fresh-note')).toBeVisible();
    await expect(page.locator(WRAPPER)).toHaveCount(1);
    await expect(page.locator(NOTICE)).toHaveCount(0);

    const state = await page.evaluate(() => {
      const wrapper = document.getElementById('visual-zoom-wrapper');
      const note = document.getElementById('fresh-note');
      return {
        scale: vz.getScale(),
        noteInsideWrapper: note ? note.closest('#visual-zoom-wrapper') === wrapper : false,
        oldPageGone: document.getElementById('fixture-scroll') === null,
        scrollTop: document.documentElement.scrollTop,
        transform: getComputedStyle(wrapper).transform,
      };
    });
    expect(state.scale).toBeCloseTo(1.5, 10);
    expect(state.noteInsideWrapper).toBe(true);
    expect(state.oldPageGone).toBe(true);
    // The re-applied wrapper is a fresh page: scrolled back to the top, no
    // state carried over from the previous page's scroll position.
    expect(state.scrollTop).toBe(0);
    expect(state.transform).toBe('matrix(1.5, 0, 0, 1.5, 0, 0)');

    // Gesture zoom still works on the re-applied wrapper.
    await pressHotkey(page, '+');
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.5 * 1.05, 10);
  });

  test('@fixture successive spaced body clears keep re-applying without hitting the teardown budget', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(1.5));

    const replaceWith = (id, text) =>
      page.evaluate(({ id, text }) => {
        const el = document.createElement('div');
        el.id = id;
        el.textContent = text;
        document.body.replaceChildren(el);
      }, { id, text });

    await replaceWith('gen-a', 'first replacement');
    await expect(page.locator('#gen-a')).toBeVisible();
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.5, 10);

    // A second legit replacement after the wrapper has been stable for the
    // whole stability window is a new disruption, not a page fighting the
    // wrapper: the budget has been reset, so the module re-applies again
    // instead of tearing down.
    await page.waitForTimeout(STABILITY_MS + 200);
    await replaceWith('gen-b', 'second replacement');
    await expect(page.locator('#gen-b')).toBeVisible();
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.5, 10);
    await expect(page.locator(NOTICE)).toHaveCount(0);

    const state = await page.evaluate(() => ({
      wrapped: document.getElementById('visual-zoom-wrapper') !== null,
      inside: document.getElementById('gen-b').closest('#visual-zoom-wrapper') ===
        document.getElementById('visual-zoom-wrapper'),
    }));
    expect(state.wrapped).toBe(true);
    expect(state.inside).toBe(true);
  });

  test('@fixture when the page fights the wrapper, the module tears down to exactly 1x with a one-time notice', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(1.5));

    // The adversarial fixture unwraps the wrapper wherever it appears. The
    // module must not loop: it tears down to a clean, usable page at 1x.
    await page.evaluate(() => document.getElementById('fixture-body-fight').click());
    await expect(page.locator(NOTICE)).toHaveCount(1);

    const state = await page.evaluate(() => ({
      wrapped: document.getElementById('visual-zoom-wrapper') !== null,
      scale: vz.getScale(),
      // The page is left usable: its own content is preserved in place.
      nav: document.getElementById('fixture-nav') !== null,
      fightButton: document.getElementById('fixture-body-fight') !== null,
      htmlOverflow: document.documentElement.style.overflow,
      htmlBackground: document.documentElement.style.background,
      bodyOverflow: document.body.style.overflow,
    }));
    expect(state.wrapped).toBe(false);
    expect(state.scale).toBe(1);
    expect(state.nav).toBe(true);
    expect(state.fightButton).toBe(true);
    expect(state.htmlOverflow).toBe('');
    expect(state.htmlBackground).toBe('');
    expect(state.bodyOverflow).toBe('');

    // Listeners are detached: the zoom hotkey and gesture no longer consume
    // events, so the page's native behavior is fully restored.
    const notConsumed = await page.evaluate(() => {
      const wheel = new WheelEvent('wheel', {
        deltaY: -100,
        deltaMode: 0,
        clientX: 512,
        clientY: 384,
        bubbles: true,
        cancelable: true,
        shiftKey: true,
      });
      window.dispatchEvent(wheel);
      const key = new KeyboardEvent('keydown', {
        key: '+',
        bubbles: true,
        cancelable: true,
        shiftKey: true,
      });
      window.dispatchEvent(key);
      return { wheel: wheel.defaultPrevented, key: key.defaultPrevented };
    });
    expect(notConsumed.wheel).toBe(false);
    expect(notConsumed.key).toBe(false);
  });

  test('@fixture teardown is final: no retry loop, no further mutations after the notice', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(1.5));
    await page.evaluate(() => document.getElementById('fixture-body-fight').click());
    await expect(page.locator(NOTICE)).toHaveCount(1);

    const snapshot = await page.evaluate(() => ({
      wrapped: document.getElementById('visual-zoom-wrapper') !== null,
      noticeCount: document.querySelectorAll('#visual-zoom-notice').length,
      bodyChildren: document.body.children.length,
      scale: vz.getScale(),
    }));
    expect(snapshot.wrapped).toBe(false);
    expect(snapshot.noticeCount).toBe(1);
    expect(snapshot.scale).toBe(1);

    // The fight continues in the page (it keeps trying to remove the wrapper),
    // but the module never re-wraps and never mutates the DOM again.
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
      wrapped: document.getElementById('visual-zoom-wrapper') !== null,
      noticeCount: document.querySelectorAll('#visual-zoom-notice').length,
      bodyChildren: document.body.children.length,
      scale: vz.getScale(),
    }));
    expect(after).toEqual(snapshot);
  });

  test('@fixture a slower relentless fighter still ends in teardown, not an observer loop', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(1.5));

    // Unlike the fixture button, which fights on every mutation, this page
    // unwraps the wrapper on a slow cadence (600ms) — slower than the burst
    // case but still faster than the stability window, so every re-applied
    // wrapper is destroyed before it can count as a clean re-establishment.
    await page.evaluate(() => {
      setInterval(() => {
        const wrapper = document.getElementById('visual-zoom-wrapper');
        if (!wrapper) {
          return;
        }
        while (wrapper.firstChild) {
          document.body.appendChild(wrapper.firstChild);
        }
        wrapper.remove();
      }, 600);
    });

    // The budget only resets when a wrapper actually persists, so the count
    // climbs across the slow losses and the module tears down after a few.
    await expect(page.locator(NOTICE)).toHaveCount(1);
    expect(await page.evaluate(() => document.getElementById('visual-zoom-wrapper') === null)).toBe(
      true
    );
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
  });

  test('@fixture tearing down on an empty body, then re-applying, re-engages fresh', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(1.5));

    // A page that clears its body to nothing cannot be re-established: there
    // is nothing to wrap, so the module tears down gracefully instead of
    // leaving a hollow, half-zoomed wrapper.
    await page.evaluate(() => document.body.replaceChildren());
    await expect(page.locator(NOTICE)).toHaveCount(1);
    expect(await page.evaluate(() => vz.getScale())).toBe(1);
    expect(await page.evaluate(() => document.getElementById('visual-zoom-wrapper') === null)).toBe(
      true
    );

    // The page renders fresh content, and the extension re-engages. apply()
    // wraps the new content fresh, clears the stale notice, and zoom works
    // again from 1x — no state from before the teardown leaks through.
    await page.evaluate(() => {
      const root = document.createElement('div');
      root.id = 're-rendered';
      root.textContent = 'rendered after teardown';
      document.body.appendChild(root);
    });
    await page.evaluate(() => vz.apply());
    await expect(page.locator(NOTICE)).toHaveCount(0);
    expect(await page.evaluate(() => document.getElementById('visual-zoom-wrapper') !== null)).toBe(
      true
    );
    const state = await page.evaluate(() => ({
      scale: vz.getScale(),
      inside: document.getElementById('re-rendered').closest('#visual-zoom-wrapper') ===
        document.getElementById('visual-zoom-wrapper'),
    }));
    expect(state.scale).toBe(1);
    expect(state.inside).toBe(true);

    await pressHotkey(page, '+');
    expect(await page.evaluate(() => vz.getScale())).toBeCloseTo(1.05, 10);
  });

  test('@fixture navigating away and back re-applies the wrapper fresh without leaking state', async ({
    page,
  }) => {
    await loadVisualZoom(page);
    await page.evaluate(() => vz.setScale(2));
    await page.evaluate(() => {
      document.documentElement.scrollTop = 300;
      document.documentElement.scrollLeft = 100;
    });

    await page.reload();
    await applyVisualZoom(page);

    const state = await page.evaluate(() => ({
      wrapped: document.getElementById('visual-zoom-wrapper') !== null,
      children: document.body.children.length,
      scale: vz.getScale(),
      scrollTop: document.documentElement.scrollTop,
      scrollLeft: document.documentElement.scrollLeft,
      transform: getComputedStyle(document.getElementById('visual-zoom-wrapper')).transform,
      notice: document.getElementById('visual-zoom-notice') !== null,
    }));
    expect(state.wrapped).toBe(true);
    expect(state.children).toBe(1);
    // Nothing leaks from the previous page: fresh scale, clean scroll, no notice.
    expect(state.scale).toBe(1);
    expect(state.scrollTop).toBe(0);
    expect(state.scrollLeft).toBe(0);
    expect(state.transform).toBe('matrix(1, 0, 0, 1, 0, 0)');
    expect(state.notice).toBe(false);
  });
});
