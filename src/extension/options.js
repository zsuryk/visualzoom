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
} from '../settings/storage.js';
import { siteSettings, hostnameFor } from '../settings/store.js';

const MODIFIER_LABELS = {
  altKey: 'Alt',
  ctrlKey: 'Ctrl',
  shiftKey: 'Shift',
  metaKey: 'Meta (\u2318)',
};

const modifierSelect = document.getElementById('modifier');
const memoryDefault = document.getElementById('memory-default');
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

function render() {
  fillModifierSelect(modifierSelect, settings.zoomModifier);
  for (const slot of HOTKEY_SLOTS) {
    fillModifierSelect(hotkeyRoots[slot].modifier, settings.hotkeys[slot].modifier);
    hotkeyRoots[slot].key.value = settings.hotkeys[slot].key;
  }
  memoryDefault.checked = settings.memoryDefault;
  fixedPolicy.value = settings.fixedElementPolicy;
  renderSites();
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

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'site-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      removeSite(hostname).then(() => showSaved());
    });

    row.append(name, memory, crisp, remove);
    siteList.appendChild(row);
  }
}

modifierSelect.addEventListener('change', () => {
  saveSettings({ zoomModifier: modifierSelect.value }).then(showSaved);
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
      key.value = next.hotkeys[slot].key;
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

fixedPolicy.addEventListener('change', () => {
  saveSettings({ fixedElementPolicy: fixedPolicy.value }).then(showSaved);
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

(async () => {
  settings = await loadSettings();
  render();
})();