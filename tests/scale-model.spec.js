import { test, expect } from '@playwright/test';
import {
  MIN_SCALE,
  MAX_SCALE,
  STEP_FACTOR,
  MAX_TEXTURE_PX,
  clampScale,
  scaleIn,
  scaleOut,
  anchoredScroll,
  budgetExceeded,
} from '../src/content/visual-zoom.js';

test.describe('02 — scale model pure math', () => {
  test('@unit clamps the scale to the 0.3x–3x envelope', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(10)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
    expect(clampScale(-2)).toBe(MIN_SCALE);
  });

  test('@unit the zoom-below-100 gate raises the floor to 1x', () => {
    // With the gate off, the effective floor is 1x: nothing below 100% is
    // reachable, even though the pure envelope still spans 0.3x–3x.
    expect(clampScale(0.5, 1)).toBe(1);
    expect(clampScale(0.31, 1)).toBe(1);
    expect(clampScale(1.4, 1)).toBe(1.4);
    expect(scaleOut(1, 1)).toBe(1);
    expect(scaleOut(1.05, 1)).toBe(1);
    expect(scaleIn(1, 1)).toBeCloseTo(1.05, 10);
    // With the gate on, the full envelope floor applies again.
    expect(clampScale(0.5, MIN_SCALE)).toBe(0.5);
    expect(scaleOut(MIN_SCALE, MIN_SCALE)).toBe(MIN_SCALE);
  });

  test('@unit steps multiplicatively by ~5% per notch', () => {
    expect(STEP_FACTOR).toBeCloseTo(1.05, 10);
    expect(scaleIn(1)).toBeCloseTo(1.05, 10);
    expect(scaleOut(1)).toBeCloseTo(1 / 1.05, 10);
    expect(scaleIn(scaleOut(1))).toBeCloseTo(1, 10);
    expect(scaleOut(scaleIn(2))).toBeCloseTo(2, 10);
  });

  test('@unit stepping stays inside the envelope', () => {
    expect(scaleIn(MAX_SCALE)).toBe(MAX_SCALE);
    expect(scaleOut(MIN_SCALE)).toBe(MIN_SCALE);
    expect(scaleIn(1.7)).toBeLessThanOrEqual(MAX_SCALE);
    expect(scaleOut(0.4)).toBeGreaterThanOrEqual(MIN_SCALE);
  });

});

test.describe('03 — scale model: cursor anchor + even steps', () => {
  test('@unit anchoredScroll keeps the under-cursor content point fixed on zoom-in', () => {
    const r = anchoredScroll(0, 0, 512, 384, 1, 2);
    expect(r.scrollX).toBeCloseTo(512, 10);
    expect(r.scrollY).toBeCloseTo(384, 10);
    // (scroll + cursor) / scale is invariant, so the pixel under the cursor
    // stays put.
    expect((r.scrollX + 512) / 2).toBeCloseTo((0 + 512) / 1, 10);
    expect((r.scrollY + 384) / 2).toBeCloseTo((0 + 384) / 1, 10);
  });

  test('@unit anchoredScroll round-trips zooming back out', () => {
    const r = anchoredScroll(512, 384, 512, 384, 2, 1);
    expect(r.scrollX).toBeCloseTo(0, 10);
    expect(r.scrollY).toBeCloseTo(0, 10);
    expect((r.scrollX + 512) / 1).toBeCloseTo((512 + 512) / 2, 10);
    expect((r.scrollY + 384) / 1).toBeCloseTo((384 + 384) / 2, 10);
  });

  test('@unit anchoredScroll compensates non-zero scroll positions', () => {
    const r = anchoredScroll(100, 50, 40, 30, 1, 1.05);
    expect(r.scrollX).toBeCloseTo((100 + 40) * 1.05 - 40, 10);
    expect(r.scrollY).toBeCloseTo((50 + 30) * 1.05 - 30, 10);
    expect((r.scrollX + 40) / 1.05).toBeCloseTo(140, 10);
    expect((r.scrollY + 30) / 1.05).toBeCloseTo(80, 10);
  });

  test('@unit anchoredScroll with no scale change leaves scroll untouched', () => {
    expect(anchoredScroll(25, 40, 500, 400, 1.5, 1.5)).toEqual({ scrollX: 25, scrollY: 40 });
  });

  test('@unit step sizes feel even across the whole range (multiplicative)', () => {
    for (const s of [MIN_SCALE, 0.4, 0.7, 1, 1.4, 2, 2.9]) {
      if (s * STEP_FACTOR <= MAX_SCALE) {
        expect(scaleIn(s) / s).toBeCloseTo(STEP_FACTOR, 10);
      } else {
        expect(scaleIn(s)).toBe(MAX_SCALE);
      }
      if (s / STEP_FACTOR >= MIN_SCALE) {
        expect(scaleOut(s) / s).toBeCloseTo(1 / STEP_FACTOR, 10);
      } else {
        expect(scaleOut(s)).toBe(MIN_SCALE);
      }
    }
  });

  test('@unit repeated stepping traverses the whole envelope without overshooting', () => {
    let s = MIN_SCALE;
    let prev = s;
    let hitMax = false;
    while (s < MAX_SCALE) {
      const next = scaleIn(s);
      expect(next).toBeGreaterThan(prev);
      expect(next).toBeLessThanOrEqual(MAX_SCALE);
      if (next === MAX_SCALE) {
        hitMax = true;
      }
      prev = next;
      s = next;
    }
    expect(hitMax).toBe(true);
    expect(s).toBe(MAX_SCALE);

    let t = MAX_SCALE;
    while (t > MIN_SCALE) {
      const next = scaleOut(t);
      expect(next).toBeLessThan(t);
      expect(next).toBeGreaterThanOrEqual(MIN_SCALE);
      t = next;
    }
    expect(t).toBe(MIN_SCALE);
  });
});

test.describe('05 — layer budget limit computation', () => {
  test('@unit the budget is a per-dimension compositor texture limit', () => {
    expect(MAX_TEXTURE_PX).toBe(8192);
  });

  test('@unit scaled size at or under the budget is fine', () => {
    expect(budgetExceeded(1024, 768, 3)).toBe(false);
    expect(budgetExceeded(8192, 800, 1)).toBe(false);
    expect(budgetExceeded(1000, 8192, 1)).toBe(false);
  });

  test('@unit exceeding on either dimension trips the budget', () => {
    expect(budgetExceeded(8192, 800, 1.01)).toBe(true);
    expect(budgetExceeded(1024, 8193, 1)).toBe(true);
    expect(budgetExceeded(5000, 5000, 2)).toBe(true);
  });

  test('@unit zooming out below 1x can bring a huge page back under budget', () => {
    expect(budgetExceeded(16000, 16000, 1)).toBe(true);
    expect(budgetExceeded(16000, 16000, 0.5)).toBe(false);
    expect(budgetExceeded(10000, 10000, 0.8)).toBe(false);
  });

  test('@unit the boundary is exclusive', () => {
    expect(budgetExceeded(8192, 768, 1)).toBe(false);
    expect(budgetExceeded(1024, 8192, 1)).toBe(false);
  });
});
