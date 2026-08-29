// chrome.storage adapter for the settings layer. Only the extension surfaces
// (content script, popup, options page) import this; the pure settings core
// (store.js) stays chrome-free so the fixture/unit tests can import it.
import { sanitizeSettings, SETTINGS_KEY, DEFAULT_SETTINGS } from './store.js';

export async function loadSettings() {
  const raw = await chrome.storage.sync.get(SETTINGS_KEY);
  return sanitizeSettings(raw[SETTINGS_KEY]);
}

// Persist a settings change and return the sanitized result. Accepts either a
// partial object (merged over the current settings) or a mutator function
// (given the current settings, returns the next), so per-site updates can be
// written read-modify-write without clobbering concurrent scale writes.
export async function saveSettings(mutator) {
  const current = await loadSettings();
  const next =
    typeof mutator === 'function' ? mutator(current) : { ...current, ...mutator };
  const sanitized = sanitizeSettings(next);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: sanitized });
  return sanitized;
}

// Merge a per-site override into settings.sites[hostname] and persist.
export function updateSite(hostname, patch) {
  return saveSettings((settings) => {
    const sites = { ...settings.sites };
    sites[hostname] = { ...(sites[hostname] || {}), ...patch };
    return { ...settings, sites };
  });
}

// Drop every per-site override for a hostname, restoring the global defaults.
export function removeSite(hostname) {
  return saveSettings((settings) => {
    if (!settings.sites[hostname]) {
      return settings;
    }
    const sites = { ...settings.sites };
    delete sites[hostname];
    return { ...settings, sites };
  });
}

// Subscribe to settings changes (any surface: options page, popup, this
// content script's own memory writes). Called with (next, prev) sanitized
// settings. Returns an unsubscribe function.
export function subscribeSettings(cb) {
  const handler = (changes, area) => {
    if (area !== 'sync' || !changes[SETTINGS_KEY]) {
      return;
    }
    cb(
      sanitizeSettings(changes[SETTINGS_KEY].newValue),
      changes[SETTINGS_KEY].oldValue ? sanitizeSettings(changes[SETTINGS_KEY].oldValue) : null
    );
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

// Reset all settings to their defaults, preserving per-site zoom memory.
export async function resetSettings() {
  const current = await loadSettings();
  // Preserve remembered zoom scales so the user doesn't lose their positions.
  const sites = {};
  for (const [hostname, site] of Object.entries(current.sites || {})) {
    if (typeof site.scale === 'number' && Number.isFinite(site.scale)) {
      sites[hostname] = { scale: site.scale };
    }
  }
  const next = sanitizeSettings({ ...DEFAULT_SETTINGS, sites });
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

// Clear all remembered zoom scales from per-site settings.
export async function clearZoomMemory() {
  return saveSettings((settings) => {
    const sites = {};
    for (const [hostname, site] of Object.entries(settings.sites)) {
      const { scale, ...rest } = site;
      if (Object.keys(rest).length > 0) {
        sites[hostname] = rest;
      }
    }
    return { ...settings, sites };
  });
}

// Clear all per-site overrides, restoring global defaults.
export async function clearSiteSettings() {
  return saveSettings((settings) => ({ ...settings, sites: {} }));
}

// Clear all data by removing the settings key from storage.
export async function clearAllData() {
  await chrome.storage.sync.remove(SETTINGS_KEY);
}