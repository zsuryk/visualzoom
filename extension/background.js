// Background service worker: the message hub between the popup and the
// content scripts, and the telemetry log sink.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') {
    return;
  }

  // Popup asks for the active tab's zoom state on open.
  if (msg.type === 'vz-get-state') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null) {
        sendResponse({ ok: false });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'vz-get-state' }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          sendResponse({ ok: false });
          return;
        }
        sendResponse({ ok: true, scale: resp.scale, wrapped: resp.wrapped });
      });
    });
    return true;
  }

  // Popup drives the page: exact scale, or a multiplicative step.
  if (msg.type === 'vz-set-scale' || msg.type === 'vz-step') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null) {
        return;
      }
      chrome.tabs.sendMessage(tab.id, msg, () => void chrome.runtime.lastError);
    });
    return;
  }

  // Content scripts report every scale change; relay it to the popup so its
  // readout, slider, and active state stay in sync with gesture/hotkey zoom.
  if (msg.type === 'vz-scale-changed' && sender.tab) {
    chrome.runtime.sendMessage(
      { type: 'vz-scale-changed', scale: msg.scale, wrapped: msg.wrapped },
      () => void chrome.runtime.lastError
    );
    return;
  }

  // Telemetry sink: layer-budget-exceeded and friends are logged here so the
  // real envelope can be learned before release.
  if (msg.type === 'vz-telemetry') {
    console.info(`[visual-zoom] telemetry ${msg.event}`, msg.data);
    return;
  }
});
