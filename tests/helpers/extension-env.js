// Shared helpers for @extension tests: launch the real unpacked MV3 extension
// and open the popup as a tab.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { chromiumLaunchOptions, PORT } from './browser-env.js';

export const EXTENSION_PATH = fileURLToPath(new URL('../../extension/', import.meta.url));
export const BASE = `http://127.0.0.1:${PORT}`;
export const FIXTURE = `${BASE}/fixtures/native-zoom-breaking.html`;
export const HUGE_PAGE = `${BASE}/fixtures/huge-page.html`;

export async function launchExtension() {
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1024, height: 768 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
    ...chromiumLaunchOptions(),
  });
  let worker = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  for (let i = 0; i < 40 && !worker; i++) {
    await new Promise((r) => setTimeout(r, 250));
    worker = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  }
  if (!worker) {
    await ctx.close();
    throw new Error('the extension service worker never started');
  }
  return { ctx, extId: new URL(worker.url()).host };
}

export async function openPopup(ctx, page, extId) {
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await page.bringToFront();
  await popup.reload();
  await popup.waitForSelector('#scale');
  return popup;
}
