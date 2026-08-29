// The popup is the quick-controls surface: current-scale readout with a
// slider, +/−/reset, per-site toggles (enable/disable and memory for this
// site), and a link to the options page. Per-site changes are written straight
// to chrome.storage.sync; the content scripts on this site pick them up via
// storage.onChanged, so toggling applies live without reloading anything.
import { loadSettings, updateSite, subscribeSettings } from '../settings/storage.js';
import { siteSettings } from '../settings/store.js';

const scaleOutput = document.getElementById('scale');
const slider = document.getElementById('slider');
const zoomOut = document.getElementById('zoom-out');
const zoomIn = document.getElementById('zoom-in');
const reset = document.getElementById('reset');
const statusEl = document.getElementById('status');
const controls = document.getElementById('controls');
const siteSection = document.getElementById('site-section');
const siteName = document.getElementById('site-name');
const enableToggle = document.getElementById('site-enabled');
const memoryToggle = document.getElementById('site-memory');
const optionsLink = document.getElementById('open-options');

const formatScale = (scale) => `${Math.round(scale * 100)}%`;

const current = { hostname: null, settings: null, site: null };

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.dataset.theme = 'dark';
  } else if (theme === 'light') {
    root.dataset.theme = 'light';
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = prefersDark ? 'dark' : 'light';
  }
}

// The slider's floor follows the zoom-below-100 setting: 100% when off,
// 30% when on, so the slider never offers a range the page would clamp away.
function syncSliderMin() {
  slider.min = current.settings && current.settings.zoomBelow100 ? '30' : '100';
}

function render(state) {
  const active = Boolean(state && state.ok && state.active);
  if (!active) {
    statusEl.textContent = 'Visual Zoom is not active on this page.';
    scaleOutput.textContent = '100%';
    slider.value = 100;
    controls.classList.add('disabled');
  } else {
    statusEl.textContent = 'Zoom level on the current page';
    controls.classList.remove('disabled');
    slider.value = Math.round(state.scale * 100);
    scaleOutput.textContent = formatScale(state.scale);
  }
  renderSite();
}

function renderSite() {
  // #site-section ships with a `hidden` attribute in the markup; the UA rule
  // [hidden] { display: none } wins over an inline `display: ''`, so toggle the
  // element's own hidden property rather than (only) its style.
  const show = Boolean(current.hostname && current.settings && current.site);
  siteSection.hidden = !show;
  if (!show) {
    return;
  }
  siteName.textContent = current.hostname;
  enableToggle.checked = current.site.enabled;
  memoryToggle.checked = current.site.memory;
}

function requestState() {
  chrome.runtime.sendMessage({ type: 'vz-get-state' }, render);
  chrome.runtime.sendMessage({ type: 'vz-get-host' }, async (resp) => {
    if (!resp || !resp.ok || !resp.hostname) {
      return;
    }
    current.hostname = resp.hostname;
    current.settings = await loadSettings();
    current.site = siteSettings(current.settings, current.hostname);
    applyTheme(current.settings.theme);
    syncSliderMin();
    renderSite();
  });
}

function sendSetScale(scale) {
  chrome.runtime.sendMessage({ type: 'vz-set-scale', scale });
}

function sendStep(direction) {
  chrome.runtime.sendMessage({ type: 'vz-step', direction });
}

zoomOut.addEventListener('click', () => sendStep(-1));
zoomIn.addEventListener('click', () => sendStep(1));
reset.addEventListener('click', () => sendSetScale(1));
slider.addEventListener('input', () => {
  scaleOutput.textContent = formatScale(Number(slider.value) / 100);
  sendSetScale(Number(slider.value) / 100);
});

enableToggle.addEventListener('change', () => {
  updateSite(current.hostname, { enabled: enableToggle.checked });
});
memoryToggle.addEventListener('change', () => {
  updateSite(current.hostname, { memory: memoryToggle.checked });
});
optionsLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Scale changes from gesture/hotkey zoom arrive here and keep the readout and
// slider in sync with what is actually on the page — including the teardown
// path (page unwraps to 1x, controls go inactive) and the crisp-text path
// (engaged without a wrapper).
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'vz-scale-changed') {
    render({ ok: true, scale: msg.scale, wrapped: msg.wrapped, active: msg.active });
  }
});

// Another surface (options page) changed the settings: refresh the toggles so
// this popup never shows a stale per-site state.
subscribeSettings((next) => {
  current.settings = next;
  applyTheme(next.theme);
  syncSliderMin();
  if (!current.hostname) {
    return;
  }
  current.site = siteSettings(next, current.hostname);
  renderSite();
});

requestState();

// When the OS preference changes and the user is on "Device" theme, re-apply.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (current.settings && current.settings.theme === 'device') {
    applyTheme('device');
  }
});