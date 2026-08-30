// Background service worker: the message hub between the popup and the
// content scripts, and the telemetry log sink.

export function createMessageRouter({ chrome }) {
  function handleMessage(msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string') {
      return;
    }

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
          sendResponse({
            ok: true,
            scale: resp.scale,
            wrapped: resp.wrapped,
            active: resp.active,
            enabled: resp.enabled,
          });
        });
      });
      return true;
    }

    if (msg.type === 'vz-get-host') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || tab.id == null) {
          sendResponse({ ok: false });
          return;
        }
        chrome.tabs.sendMessage(tab.id, { type: 'vz-get-host' }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.hostname) {
            sendResponse({ ok: false });
            return;
          }
          sendResponse({ ok: true, hostname: resp.hostname });
        });
      });
      return true;
    }

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

    if (msg.type === 'vz-scale-changed' && sender.tab) {
      chrome.runtime.sendMessage(
        {
          type: 'vz-scale-changed',
          scale: msg.scale,
          wrapped: msg.wrapped,
          active: msg.active,
        },
        () => void chrome.runtime.lastError
      );
      return;
    }

    if (msg.type === 'vz-telemetry') {
      console.info(`[visual-zoom] telemetry ${msg.event}`, msg.data);
      return;
    }
  }

  return { handleMessage };
}

// Production entry point: wire up the real chrome API.
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  const router = createMessageRouter({ chrome });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) =>
    router.handleMessage(msg, sender, sendResponse)
  );
}
