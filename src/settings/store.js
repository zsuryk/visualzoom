// The persisted settings layer for Visual Zoom. This module is chrome-free:
// it holds the settings shape, its defaults, and the pure functions that
// normalize settings read from/written to storage. The chrome.storage adapter
// (storage.js) and every surface (content script, popup, options page) build
// on it; unit tests import it directly in the fixture/Node context.

// The keys a user can configure as the gesture zoom modifier. Kept as the
// KeyboardEvent property names so a configuration maps 1:1 onto events.
export const MODIFIERS = ['altKey', 'ctrlKey', 'shiftKey', 'metaKey'];

// The fixed-element policy modes. The *stored default* lives here; the
// behavior behind each mode is ticket 07's scope.
export const POLICIES = ['scale-everything', 'protect-modals', 'protect-sticky-too'];

// The three zoom hotkeys, each its own (modifier, key) combo so the popup and
// options page can configure them independently of the gesture modifier.
export const HOTKEY_SLOTS = ['zoomIn', 'zoomOut', 'reset'];

export const DEFAULT_HOTKEYS = {
  zoomIn: { modifier: 'altKey', key: '+' },
  zoomOut: { modifier: 'altKey', key: '-' },
  reset: { modifier: 'altKey', key: '0' },
};

export const DEFAULT_SETTINGS = {
  // Gesture zoom modifier: Alt by default, the key native browser zoom
  // doesn't claim, so visual zoom and native reflow zoom coexist.
  zoomModifier: 'altKey',
  hotkeys: DEFAULT_HOTKEYS,
  // Per-site zoom memory default: off. Zoom is only ever restored on revisit
  // after an explicit per-site opt-in.
  memoryDefault: false,
  // Zooming below 100% (letterbox zoom-out) is gated behind an explicit opt-in,
  // mirroring the trackpad pinch metaphor: zoom-out to overview is allowed
  // only when the user enables it. Off by default.
  zoomBelow100: false,
  // Global default for the fixed-element policy (ticket 07 consumes it).
  fixedElementPolicy: 'scale-everything',
  // Per-site overrides indexed by hostname.
  sites: {},
};

const SITE_KEYS = ['enabled', 'memory', 'crispText', 'scale', 'fixedElementPolicy'];

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      freezeDeep(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

freezeDeep(DEFAULT_SETTINGS);

// The site key for a URL: lowercased hostname with a leading 'www.' stripped,
// so www.example.com and example.com share one per-site entry.
export function hostnameFor(input) {
  const candidates = typeof input === 'string' && input.length > 0 ? [input, `http://${input}`] : [];
  for (const candidate of candidates) {
    try {
      return new URL(candidate).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      // Try the next candidate when the input is not a URL on its own.
    }
  }
  return '';
}

function sanitizeModifier(value, fallback = DEFAULT_SETTINGS.zoomModifier) {
  return MODIFIERS.includes(value) ? value : fallback;
}

function sanitizeHotkey(value, fallback) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.key !== 'string' ||
    value.key.length === 0
  ) {
    return { modifier: fallback.modifier, key: fallback.key };
  }
  return {
    modifier: sanitizeModifier(value.modifier, fallback.modifier),
    key: String(value.key).slice(0, 3),
  };
}

function sanitizeSite(raw) {
  const site = {};
  if (raw && typeof raw === 'object') {
    if (typeof raw.enabled === 'boolean') {
      site.enabled = raw.enabled;
    }
    if (typeof raw.memory === 'boolean') {
      site.memory = raw.memory;
    }
    if (raw.crispText === true) {
      site.crispText = true;
    }
    if (typeof raw.scale === 'number' && Number.isFinite(raw.scale)) {
      site.scale = raw.scale;
    }
    if (POLICIES.includes(raw.fixedElementPolicy)) {
      site.fixedElementPolicy = raw.fixedElementPolicy;
    }
  }
  return site;
}

// Normalize settings read from storage into a valid shape. Unknown fields are
// dropped, wrong-typed fields fall back to defaults, and per-site overrides
// are kept only when present, so "inherit" values (e.g. an absent per-site
// memory that falls back to the global default) survive round-trips.
export function sanitizeSettings(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const sites = {};
  if (raw.sites && typeof raw.sites === 'object') {
    for (const hostname of Object.keys(raw.sites)) {
      const sanitized = sanitizeSite(raw.sites[hostname]);
      if (Object.keys(sanitized).length > 0) {
        sites[hostname] = sanitized;
      }
    }
  }
  return {
    zoomModifier: sanitizeModifier(raw.zoomModifier),
    hotkeys: {
      zoomIn: sanitizeHotkey(raw.hotkeys && raw.hotkeys.zoomIn, DEFAULT_HOTKEYS.zoomIn),
      zoomOut: sanitizeHotkey(raw.hotkeys && raw.hotkeys.zoomOut, DEFAULT_HOTKEYS.zoomOut),
      reset: sanitizeHotkey(raw.hotkeys && raw.hotkeys.reset, DEFAULT_HOTKEYS.reset),
    },
    memoryDefault: raw.memoryDefault === true,
    zoomBelow100: raw.zoomBelow100 === true,
    fixedElementPolicy: POLICIES.includes(raw.fixedElementPolicy)
      ? raw.fixedElementPolicy
      : DEFAULT_SETTINGS.fixedElementPolicy,
    sites,
  };
}

// The effective per-site view of the settings for a hostname.
export function siteSettings(settings, hostname) {
  const over = settings && settings.sites && settings.sites[hostname];
  return {
    // Visual zoom is on for a site unless the user explicitly disabled it.
    enabled: over ? over.enabled !== false : true,
    // Per-site memory, falling back to the global memory default.
    memory: over && typeof over.memory === 'boolean' ? over.memory : settings.memoryDefault,
    // The crisp-text escape hatch is a per-site opt-in, never a default.
    crispText: over ? over.crispText === true : false,
    // The remembered settled scale (only ever applied under explicit memory).
    scale:
      over && typeof over.scale === 'number' && Number.isFinite(over.scale) ? over.scale : 1,
    // Per-site fixed-policy override, falling back to the global default.
    fixedElementPolicy:
      over && over.fixedElementPolicy ? over.fixedElementPolicy : settings.fixedElementPolicy,
  };
}

export const SETTINGS_KEY = 'settings';