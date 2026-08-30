import { test, expect } from '@playwright/test';
import { createMessageRouter } from '../src/background.js';

function createMockChrome() {
  const messages = [];
  const tabMessages = [];
  let lastError = null;

  return {
    messages,
    tabMessages,
    lastError,
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        messages.push(msg);
        cb?.();
      },
    },
    tabs: {
      query: (opts, cb) => {
        cb([{ id: 1 }]);
      },
      sendMessage: (tabId, msg, cb) => {
        tabMessages.push({ tabId, msg });
        cb?.({ scale: 1, wrapped: false, active: false, enabled: true });
      },
    },
  };
}

test.describe('background message router', () => {
  test('@unit vz-get-state returns zoom state from content script', () => {
    const chrome = createMockChrome();
    const router = createMessageRouter({ chrome });
    const responses = [];

    const result = router.handleMessage(
      { type: 'vz-get-state' },
      {},
      (resp) => responses.push(resp)
    );

    expect(result).toBe(true);
    expect(chrome.tabMessages).toHaveLength(1);
    expect(chrome.tabMessages[0].msg).toEqual({ type: 'vz-get-state' });
  });

  test('@unit vz-get-host returns hostname from content script', () => {
    const chrome = createMockChrome();
    const router = createMessageRouter({ chrome });
    const responses = [];

    chrome.tabs.sendMessage = (tabId, msg, cb) => {
      chrome.tabMessages.push({ tabId, msg });
      cb?.({ hostname: 'example.com' });
    };

    const result = router.handleMessage(
      { type: 'vz-get-host' },
      {},
      (resp) => responses.push(resp)
    );

    expect(result).toBe(true);
    expect(chrome.tabMessages[0].msg).toEqual({ type: 'vz-get-host' });
  });

  test('@unit vz-set-scale forwards to content script', () => {
    const chrome = createMockChrome();
    const router = createMessageRouter({ chrome });

    const result = router.handleMessage(
      { type: 'vz-set-scale', scale: 1.5 },
      {},
      () => {}
    );

    expect(result).toBeUndefined();
    expect(chrome.tabMessages).toHaveLength(1);
    expect(chrome.tabMessages[0].msg).toEqual({ type: 'vz-set-scale', scale: 1.5 });
  });

  test('@unit vz-step forwards to content script', () => {
    const chrome = createMockChrome();
    const router = createMessageRouter({ chrome });

    const result = router.handleMessage(
      { type: 'vz-step', direction: 1 },
      {},
      () => {}
    );

    expect(result).toBeUndefined();
    expect(chrome.tabMessages).toHaveLength(1);
    expect(chrome.tabMessages[0].msg).toEqual({ type: 'vz-step', direction: 1 });
  });

  test('@unit vz-scale-changed relays to runtime', () => {
    const chrome = createMockChrome();
    const router = createMessageRouter({ chrome });

    const result = router.handleMessage(
      { type: 'vz-scale-changed', scale: 2, wrapped: true, active: true },
      { tab: { id: 1 } },
      () => {}
    );

    expect(result).toBeUndefined();
    expect(chrome.messages).toHaveLength(1);
    expect(chrome.messages[0]).toEqual({
      type: 'vz-scale-changed',
      scale: 2,
      wrapped: true,
      active: true,
    });
  });

  test('@unit vz-telemetry logs to console', () => {
    const chrome = createMockChrome();
    const router = createMessageRouter({ chrome });
    const logs = [];
    const origInfo = console.info;
    console.info = (...args) => logs.push(args);

    router.handleMessage(
      { type: 'vz-telemetry', event: 'layer-budget-exceeded', data: { width: 9000 } },
      {},
      () => {}
    );

    console.info = origInfo;
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toContain('layer-budget-exceeded');
  });

  test('@unit ignores null messages', () => {
    const chrome = createMockChrome();
    const router = createMessageRouter({ chrome });

    const result = router.handleMessage(null, {}, () => {});
    expect(result).toBeUndefined();
    expect(chrome.tabMessages).toHaveLength(0);
  });

  test('@unit ignores messages without type', () => {
    const chrome = createMockChrome();
    const router = createMessageRouter({ chrome });

    const result = router.handleMessage({ foo: 'bar' }, {}, () => {});
    expect(result).toBeUndefined();
    expect(chrome.tabMessages).toHaveLength(0);
  });

  test('@unit vz-get-state returns ok:false when no tab', () => {
    const chrome = createMockChrome();
    chrome.tabs.query = (opts, cb) => cb([]);
    const router = createMessageRouter({ chrome });
    const responses = [];

    router.handleMessage(
      { type: 'vz-get-state' },
      {},
      (resp) => responses.push(resp)
    );

    expect(responses).toHaveLength(1);
    expect(responses[0]).toEqual({ ok: false });
  });

  test('@unit vz-get-state returns ok:false when content script errors', () => {
    const chrome = createMockChrome();
    chrome.tabs.sendMessage = (tabId, msg, cb) => {
      chrome.runtime.lastError = { message: 'error' };
      cb?.(undefined);
    };
    const router = createMessageRouter({ chrome });
    const responses = [];

    router.handleMessage(
      { type: 'vz-get-state' },
      {},
      (resp) => responses.push(resp)
    );

    expect(responses).toHaveLength(1);
    expect(responses[0]).toEqual({ ok: false });
  });
});
