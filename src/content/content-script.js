import { createVisualZoom } from './visual-zoom.js';
import { hostnameFor, siteSettings } from '../settings/store.js';
import { loadSettings, subscribeSettings, updateSite } from '../settings/storage.js';

// The content script is the fixture-proven module wired into the extension,
// driven by persisted settings: the zoom modifier/hotkeys, whether visual zoom
// is enabled for this site, per-site zoom memory, and the per-site crisp-text
// escape hatch. Settings live in chrome.storage.sync; this script reads them
// on boot and reacts to storage.onChanged, so options/popup changes reach
// already-open tabs without reloading the extension.

const hostname = hostnameFor(location.href);

// How long a settled scale waits before it is committed to per-site memory.
// Gestures produce many intermediate scales; only the settled one is stored.
const MEMORY_WRITE_DEBOUNCE_MS = 300;

let controller = createVisualZoom({
  // Every scale change (gesture, hotkey, popup, reset, teardown, crisp-mode
  // reflow) is reported so the open popup's readout, slider, and active state
  // stay in sync — and the settled scale is committed to per-site memory when
  // this site has opted in.
  onScaleChange: (scale, wrapped, active) => {
    reportScale(scale, wrapped, active);
    if (active && site.memory) {
      persistMemoryScale(scale);
    }
  },
  // Telemetry lines (layer-budget-exceeded, ...) are forwarded to the
  // background, which logs them.
  onTelemetry: (event, data) => {
    try {
      chrome.runtime.sendMessage({ type: 'vz-telemetry', event, data });
    } catch {
      console.info(`[visual-zoom] telemetry ${event} ${JSON.stringify(data)}`);
    }
  },
});

let settings = null;
let site = { enabled: true, memory: false, crispText: false, scale: 1 };
let memoryWriteTimer = null;

function reportScale(scale, wrapped, active) {
  try {
    chrome.runtime.sendMessage({ type: 'vz-scale-changed', scale, wrapped, active });
  } catch {
    // No background receiver (e.g. during unload); ignore.
  }
}

function persistMemoryScale(scale) {
  clearTimeout(memoryWriteTimer);
  memoryWriteTimer = setTimeout(() => {
    memoryWriteTimer = null;
    updateSite(hostname, { scale }).catch(() => {});
  }, MEMORY_WRITE_DEBOUNCE_MS);
}

// Bring the page to the state the current settings demand. Idempotent: a
// disabled site is left untouched (no wrapper, scale 1); an enabled site is
// applied with its remembered scale and crisp-text preference; input combos
// and the fixed-element policy are always synced to the latest settings.
function sync() {
  // The fixed-element policy applies live: switching modes (globally or per
  // site) lifts or restores protected elements on already-open pages without
  // reloading anything.
  controller.setPolicy(site.fixedElementPolicy);
  // The zoom-below-100 gate applies live too: toggling it lets zoom-out pass
  // 1x, or re-clamps a settled sub-1x scale back to 100%.
  controller.setZoomBelow100(settings.zoomBelow100);
  if (site.enabled) {
    if (!controller.isEngaged()) {
      const initial = site.memory && site.scale !== 1 ? site.scale : 1;
      controller.apply(initial);
    }
    controller.setCrispText(site.crispText);
  } else if (controller.isEngaged()) {
    controller.dispose();
  }
  controller.setInputs({
    modifier: settings.zoomModifier,
    hotkeys: settings.hotkeys,
    gestureEnabled: settings.gestureEnabled,
    hotkeysEnabled: settings.hotkeysEnabled,
  });
}

async function boot() {
  settings = await loadSettings();
  site = siteSettings(settings, hostname);
  sync();
  subscribeSettings((next, prev) => {
    settings = next;
    site = siteSettings(next, hostname);
    sync();
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') {
    return;
  }
  if (msg.type === 'vz-get-state') {
    sendResponse({
      ok: true,
      scale: controller.getScale(),
      wrapped: controller.isWrapped(),
      active: controller.isEngaged(),
      enabled: site.enabled,
    });
  } else if (msg.type === 'vz-get-host') {
    sendResponse({ ok: true, hostname });
  } else if (msg.type === 'vz-set-scale') {
    controller.setScale(msg.scale);
    sendResponse({ ok: true });
  } else if (msg.type === 'vz-step') {
    controller.step(msg.direction);
    sendResponse({ ok: true });
  }
});

boot();
