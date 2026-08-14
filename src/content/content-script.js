import { createVisualZoom } from './visual-zoom.js';

// The content script is the fixture-proven module wired into the extension.
// It applies visual zoom on every page load (aggressive default) and bridges
// the popup/background and the module through chrome.runtime messages.
const controller = createVisualZoom({
  // Every scale change (gesture, hotkey, popup, reset, teardown) is reported
  // so the open popup's readout, slider, and active state stay in sync.
  onScaleChange: (scale, wrapped) => {
    try {
      chrome.runtime.sendMessage({ type: 'vz-scale-changed', scale, wrapped });
    } catch {
      // No background receiver (e.g. during unload); ignore.
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') {
    return;
  }
  if (msg.type === 'vz-get-state') {
    sendResponse({ scale: controller.getScale(), wrapped: controller.isWrapped() });
  } else if (msg.type === 'vz-set-scale') {
    controller.setScale(msg.scale);
    sendResponse({ ok: true });
  } else if (msg.type === 'vz-step') {
    controller.step(msg.direction);
    sendResponse({ ok: true });
  }
});

controller.apply();
