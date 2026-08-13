import { test, expect } from '@playwright/test';
import {
  MIN_SCALE,
  MAX_SCALE,
  STEP_FACTOR,
  clampScale,
  scaleIn,
  scaleOut,
  scaledSize,
  letterbox,
} from '../src/content/visual-zoom.js';

test.describe('02 — scale model pure math', () => {
  test('@unit clamps the scale to the 0.3x–3x envelope', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(10)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
    expect(clampScale(-2)).toBe(MIN_SCALE);
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

  test('@unit scaled dimensions multiply the original box', () => {
    expect(scaledSize(1024, 768, 2)).toEqual({ width: 2048, height: 1536 });
    expect(scaledSize(1024, 768, 0.5)).toEqual({ width: 512, height: 384 });
    expect(scaledSize(3200, 200, 1)).toEqual({ width: 3200, height: 200 });
  });

  test('@unit letterbox geometry leaves bands only when zoomed out', () => {
    const zoomedIn = letterbox(1024, 768, 1024, 768, 2);
    expect(zoomedIn).toEqual({
      contentWidth: 2048,
      contentHeight: 1536,
      right: 0,
      bottom: 0,
    });

    const zoomedOut = letterbox(1024, 768, 1024, 768, 0.5);
    expect(zoomedOut.contentWidth).toBe(512);
    expect(zoomedOut.contentHeight).toBe(384);
    expect(zoomedOut.right).toBe(512);
    expect(zoomedOut.bottom).toBe(384);
    expect(zoomedOut.right + zoomedOut.contentWidth).toBe(1024);
    expect(zoomedOut.bottom + zoomedOut.contentHeight).toBe(768);
  });
});