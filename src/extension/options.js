/* global __BROWSER__ */
/* The options page is the full-width settings surface: the gesture zoom
   modifier, the three zoom hotkeys, the per-site memory default, the
   fixed-element policy default, and per-site overrides (memory + the crisp-text
   escape hatch). Changes persist immediately to chrome.storage.sync and reach
   already-open tabs via storage.onChanged. */
import {
  MODIFIERS,
  POLICIES,
  HOTKEY_SLOTS,
} from '../settings/store.js';
import {
  loadSettings,
  saveSettings,
  updateSite,
  removeSite,
  subscribeSettings,
  resetSettings,
  clearZoomMemory,
  clearSiteSettings,
  clearAllData,
} from '../settings/storage.js';
import { siteSettings, hostnameFor } from '../settings/store.js';

const MODIFIER_LABELS = {
  altKey: 'Alt',
  ctrlKey: 'Ctrl',
  shiftKey: 'Shift',
  metaKey: 'Meta (\u2318)',
};

const POLICY_LABELS = {
  'scale-everything': 'Scale everything',
  'protect-modals': 'Protect modals',
  'protect-sticky-too': 'Protect modals and sticky',
};

const modifierSelect = document.getElementById('modifier');
const altWarning = document.getElementById('alt-warning');
const ctrlWarning = document.getElementById('ctrl-warning');
const zoomBelowWarning = document.getElementById('zoom-below-warning');
const fixedPolicyWarning = document.getElementById('fixed-policy-warning');
const hotkeyWarnings = document.getElementById('hotkey-warnings');
const memoryDefault = document.getElementById('memory-default');
const gestureEnabled = document.getElementById('gesture-enabled');
const hotkeysEnabled = document.getElementById('hotkeys-enabled');
const zoomBelow100 = document.getElementById('zoom-below-100');
const fixedPolicy = document.getElementById('fixed-policy');
const hotkeyRoots = {
  zoomIn: {
    modifier: document.getElementById('hotkey-zoom-in-modifier'),
    key: document.getElementById('hotkey-zoom-in-key'),
  },
  zoomOut: {
    modifier: document.getElementById('hotkey-zoom-out-modifier'),
    key: document.getElementById('hotkey-zoom-out-key'),
  },
  reset: {
    modifier: document.getElementById('hotkey-reset-modifier'),
    key: document.getElementById('hotkey-reset-key'),
  },
};
const addHost = document.getElementById('add-host');
const addSite = document.getElementById('add-site');
const siteList = document.getElementById('site-list');
const saved = document.getElementById('saved');
const themeSelect = document.getElementById('theme');
const resetBtn = document.getElementById('reset-settings');
const clearZoomMemBtn = document.getElementById('clear-zoom-memory');
const clearSiteBtn = document.getElementById('clear-site-settings');
const clearAllBtn = document.getElementById('clear-all-data');

let settings = null;

function fillModifierSelect(select, value) {
  select.textContent = '';
  for (const modifier of MODIFIERS) {
    const option = document.createElement('option');
    option.value = modifier;
    option.textContent = MODIFIER_LABELS[modifier];
    select.appendChild(option);
  }
  select.value = value;
}

function showSaved() {
  saved.hidden = false;
  clearTimeout(showSaved.timer);
  showSaved.timer = setTimeout(() => {
    saved.hidden = true;
  }, 1200);
}

const HOTKEY_LABELS = { zoomIn: 'Zoom in', zoomOut: 'Zoom out', reset: 'Reset' };

function updateWarnings() {
  altWarning.hidden = settings.zoomModifier !== 'altKey';
  if (!altWarning.hidden) {
    if (__BROWSER__ === 'firefox') {
      altWarning.innerHTML =
        '<strong>Warning:</strong> Firefox intercepts Alt+scroll for history ' +
        'navigation (<code>mousewheel.with_alt.action</code> defaults to 2) ' +
        'and never delivers the wheel event to page JavaScript. Gesture zoom ' +
        'will not work unless you change this pref to 0 or 1 in ' +
        '<code>about:config</code>.';
    } else {
      altWarning.innerHTML =
        '<strong>Warning:</strong> Alt+scroll may be intercepted by the ' +
        'operating system or other applications on some platforms. Gesture ' +
        'zoom may not work reliably.';
    }
  }
  ctrlWarning.hidden = settings.zoomModifier !== 'ctrlKey';
  if (!ctrlWarning.hidden) {
    if (__BROWSER__ === 'firefox') {
      ctrlWarning.innerHTML =
        '<strong>Warning:</strong> Ctrl+scroll is Firefox\'s native reflow ' +
        '&mdash; gesture zoom may not work reliably. Ctrl+key shortcuts ' +
        '(Ctrl++, Ctrl+-) also conflict with Firefox\'s zoom and may ' +
        'not fire as expected.';
    } else {
      ctrlWarning.innerHTML =
        '<strong>Warning:</strong> Ctrl+scroll is Chrome\'s native reflow ' +
        '&mdash; gesture zoom may not work reliably. Ctrl+key shortcuts ' +
        '(Ctrl++, Ctrl+-) also conflict with Chrome\'s zoom and may ' +
        'not fire as expected.';
    }
  }
  zoomBelowWarning.hidden = !settings.zoomBelow100;
  fixedPolicyWarning.hidden = settings.fixedElementPolicy === 'scale-everything';

  hotkeyWarnings.textContent = '';
  for (const slot of HOTKEY_SLOTS) {
    const hk = settings.hotkeys[slot];
    if (hk.modifier === 'ctrlKey') {
      const p = document.createElement('p');
      p.className = 'warning';
      if (__BROWSER__ === 'firefox') {
        p.innerHTML =
          `<strong>Warning:</strong> ${HOTKEY_LABELS[slot]} (Ctrl+${hk.key}) ` +
          'conflicts with Firefox\'s native zoom shortcut and may not work as expected.';
      } else {
        p.innerHTML =
          `<strong>Warning:</strong> ${HOTKEY_LABELS[slot]} (Ctrl+${hk.key}) ` +
          'conflicts with Chrome\'s native zoom shortcut and may not work as expected.';
      }
      hotkeyWarnings.appendChild(p);
    }
  }
}

function render() {
  fillModifierSelect(modifierSelect, settings.zoomModifier);
  for (const slot of HOTKEY_SLOTS) {
    fillModifierSelect(hotkeyRoots[slot].modifier, settings.hotkeys[slot].modifier);
    hotkeyRoots[slot].key.value = settings.hotkeys[slot].key;
  }
  memoryDefault.checked = settings.memoryDefault;
  gestureEnabled.checked = settings.gestureEnabled;
  hotkeysEnabled.checked = settings.hotkeysEnabled;
  zoomBelow100.checked = settings.zoomBelow100;
  fixedPolicy.value = settings.fixedElementPolicy;
  themeSelect.value = settings.theme;
  applyTheme(settings.theme);
  renderSites();
  updateWarnings();
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.dataset.theme = 'dark';
  } else if (theme === 'light') {
    root.dataset.theme = 'light';
  } else {
    // Device: respect OS preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = prefersDark ? 'dark' : 'light';
  }
}

function siteRowControls(classSuffix, label, checked) {
  const toggle = document.createElement('label');
  toggle.className = 'site-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = `site-${classSuffix}`;
  input.checked = checked;
  const span = document.createElement('span');
  span.textContent = label;
  toggle.append(input, span);
  return toggle;
}

// Per-site fixed-element policy override. The empty "Default" option removes
// the override so the site falls back to the global policy.
function sitePolicySelect(value) {
  const select = document.createElement('select');
  select.className = 'site-policy';
  select.setAttribute('aria-label', 'Fixed-element policy for this site');
  const inherit = document.createElement('option');
  inherit.value = '';
  inherit.textContent = 'Default';
  select.appendChild(inherit);
  for (const policy of POLICIES) {
    const option = document.createElement('option');
    option.value = policy;
    option.textContent = POLICY_LABELS[policy];
    select.appendChild(option);
  }
  select.value = value;
  return select;
}

function renderSites() {
  siteList.textContent = '';
  for (const hostname of Object.keys(settings.sites).sort()) {
    const site = siteSettings(settings, hostname);
    const row = document.createElement('div');
    row.className = 'site-row';
    row.dataset.hostname = hostname;

    const name = document.createElement('span');
    name.className = 'site-host';
    name.textContent = hostname;

    const memory = siteRowControls('memory', 'Memory', site.memory);
    memory.querySelector('input').addEventListener('change', (event) => {
      updateSite(hostname, { memory: event.target.checked }).then(() => showSaved());
    });

    const crisp = siteRowControls('crisp', 'Crisp text', site.crispText);
    crisp.querySelector('input').addEventListener('change', (event) => {
      updateSite(hostname, { crispText: event.target.checked }).then(() => showSaved());
    });

    // The select shows the site's own override, or "Default" when it inherits
    // the global policy — so inheritance vs an explicit override is visible.
    const override = settings.sites[hostname] && settings.sites[hostname].fixedElementPolicy;
    const policy = sitePolicySelect(override || '');
    policy.addEventListener('change', () => {
      if (policy.value === '') {
        saveSettings((next) => {
          const sites = { ...next.sites };
          if (sites[hostname]) {
            const { fixedElementPolicy, ...rest } = sites[hostname];
            sites[hostname] = rest;
          }
          return { ...next, sites };
        }).then(() => showSaved());
      } else {
        updateSite(hostname, { fixedElementPolicy: policy.value }).then(() => showSaved());
      }
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'site-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      removeSite(hostname).then(() => showSaved());
    });

    row.append(name, memory, crisp, policy, remove);
    siteList.appendChild(row);
  }
}

modifierSelect.addEventListener('change', () => {
  saveSettings({ zoomModifier: modifierSelect.value }).then((next) => {
    settings = next;
    updateWarnings();
    showSaved();
  });
});

for (const slot of HOTKEY_SLOTS) {
  const { modifier, key } = hotkeyRoots[slot];
  const commit = () => {
    saveSettings((next) => ({
      ...next,
      hotkeys: {
        ...next.hotkeys,
        [slot]: { modifier: modifier.value, key: key.value.trim() || next.hotkeys[slot].key },
      },
    })).then((next) => {
      settings = next;
      key.value = next.hotkeys[slot].key;
      updateWarnings();
      showSaved();
    });
  };
  modifier.addEventListener('change', commit);
  key.addEventListener('input', commit);
  key.addEventListener('change', commit);
}

memoryDefault.addEventListener('change', () => {
  saveSettings({ memoryDefault: memoryDefault.checked }).then(showSaved);
});

gestureEnabled.addEventListener('change', () => {
  saveSettings({ gestureEnabled: gestureEnabled.checked }).then(showSaved);
});

hotkeysEnabled.addEventListener('change', () => {
  saveSettings({ hotkeysEnabled: hotkeysEnabled.checked }).then(showSaved);
});

zoomBelow100.addEventListener('change', () => {
  saveSettings({ zoomBelow100: zoomBelow100.checked }).then((next) => {
    settings = next;
    updateWarnings();
    showSaved();
  });
});

fixedPolicy.addEventListener('change', () => {
  saveSettings({ fixedElementPolicy: fixedPolicy.value }).then((next) => {
    settings = next;
    updateWarnings();
    showSaved();
  });
});

themeSelect.addEventListener('change', () => {
  saveSettings({ theme: themeSelect.value }).then(() => {
    applyTheme(themeSelect.value);
    showSaved();
  });
});

resetBtn.addEventListener('click', async () => {
  if (!confirm('Reset all settings to default? Remembered zoom levels are kept.')) {
    return;
  }
  settings = await resetSettings();
  render();
  showSaved();
});

clearZoomMemBtn.addEventListener('click', async () => {
  if (!confirm('Delete all remembered zoom levels?')) {
    return;
  }
  settings = await clearZoomMemory();
  renderSites();
  showSaved();
});

clearSiteBtn.addEventListener('click', async () => {
  if (!confirm('Delete all per-site settings?')) {
    return;
  }
  settings = await clearSiteSettings();
  renderSites();
  showSaved();
});

clearAllBtn.addEventListener('click', async () => {
  if (!confirm('Delete ALL saved data? This cannot be undone.')) {
    return;
  }
  await clearAllData();
  settings = await loadSettings();
  render();
  showSaved();
});

addSite.addEventListener('click', () => {
  const hostname = hostnameFor(addHost.value.trim());
  addHost.value = '';
  if (!hostname) {
    return;
  }
  updateSite(hostname, { enabled: true }).then(() => showSaved());
});
addHost.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    addSite.click();
  }
});

// Another surface changed settings (popup toggles, a content script's memory
// write): refresh the per-site rows without rebuilding the inputs mid-edit.
subscribeSettings((next) => {
  settings = next;
  renderSites();
});

// When the OS preference changes and the user is on "Device" theme, re-apply.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (settings && settings.theme === 'device') {
    applyTheme('device');
  }
});

(async () => {
  settings = await loadSettings();
  render();
})();