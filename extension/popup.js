const scaleOutput = document.getElementById('scale');
const slider = document.getElementById('slider');
const zoomOut = document.getElementById('zoom-out');
const zoomIn = document.getElementById('zoom-in');
const reset = document.getElementById('reset');
const statusEl = document.getElementById('status');
const controls = document.getElementById('controls');

const formatScale = (scale) => `${Math.round(scale * 100)}%`;

function render(state) {
  if (!state || !state.ok || !state.wrapped) {
    statusEl.textContent = 'Visual Zoom is not active on this page.';
    scaleOutput.textContent = '100%';
    slider.value = 100;
    controls.classList.add('disabled');
    return;
  }
  statusEl.textContent = 'Zoom level on the current page';
  controls.classList.remove('disabled');
  slider.value = Math.round(state.scale * 100);
  scaleOutput.textContent = formatScale(state.scale);
}

function requestState() {
  chrome.runtime.sendMessage({ type: 'vz-get-state' }, render);
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

// Scale changes from gesture/hotkey zoom arrive here and keep the readout and
// slider in sync with what is actually on the page — including the teardown
// path, where the page unwraps back to 1x and the controls go inactive.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'vz-scale-changed') {
    slider.value = Math.round(msg.scale * 100);
    scaleOutput.textContent = formatScale(msg.scale);
    if (msg.wrapped) {
      statusEl.textContent = 'Zoom level on the current page';
      controls.classList.remove('disabled');
    } else {
      statusEl.textContent = 'Visual Zoom is not active on this page.';
      controls.classList.add('disabled');
    }
  }
});

requestState();
