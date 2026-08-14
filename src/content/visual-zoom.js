export const MIN_SCALE = 0.3;
export const MAX_SCALE = 3.0;
export const STEP_FACTOR = 1.05;

export function clampScale(scale) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function scaleIn(scale) {
  return clampScale(scale * STEP_FACTOR);
}

export function scaleOut(scale) {
  return clampScale(scale / STEP_FACTOR);
}

export function scaledSize(width, height, scale) {
  return { width: width * scale, height: height * scale };
}

export function letterbox(viewportWidth, viewportHeight, contentWidth, contentHeight, scale) {
  const { width, height } = scaledSize(contentWidth, contentHeight, scale);
  return {
    contentWidth: width,
    contentHeight: height,
    right: Math.max(0, viewportWidth - width),
    bottom: Math.max(0, viewportHeight - height),
  };
}

// The scroll positions that keep the point under the cursor (cursorX,
// cursorY, in viewport px) visually fixed when the scale changes from
// fromScale to toScale. A content coordinate p appears at screen position
// p * scale - scroll, so keeping p fixed across a scale change gives
// (scroll + cursor) * (toScale / fromScale) - cursor.
export function anchoredScroll(scrollX, scrollY, cursorX, cursorY, fromScale, toScale) {
  const ratio = toScale / fromScale;
  return {
    scrollX: (scrollX + cursorX) * ratio - cursorX,
    scrollY: (scrollY + cursorY) * ratio - cursorY,
  };
}

const WRAPPER_ID = 'visual-zoom-wrapper';
const transparent = 'rgba(0, 0, 0, 0)';

// The key a user holds while scrolling to gesture-zoom. Defaults to Alt, the
// key native browser zoom doesn't claim, so visual zoom and native reflow
// zoom coexist. Persisted settings (ticket 06) will make this configurable.
const ZOOM_MODIFIER = 'altKey';

// Rough pixel advance of one wheel notch; each notch steps the scale
// multiplicatively by STEP_FACTOR. Line-mode and page-mode deltas are
// converted to pixels so every real wheel reports gesture zoom.
const WHEEL_NOTCH_PX = 100;
const LINE_PX = 16;
const PAGE_PX = 100;

let scale = 1;
let origWidth = 0;
let origHeight = 0;
let pageBackground = '';
let savedStyles = null;
let listenersAttached = false;

const hasZoomModifier = (event) => event[ZOOM_MODIFIER];

function captureBackground() {
  const html = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const source = html.backgroundColor !== transparent ? document.documentElement : document.body;
  return getComputedStyle(source).background;
}

function getWrapper() {
  return document.getElementById(WRAPPER_ID);
}

function applyLayout(nextScale, target) {
  const html = document.documentElement;
  target.style.transform = `scale(${nextScale})`;
  html.style.overflow = nextScale >= 1 ? 'auto' : 'hidden';
  if (savedStyles) {
    html.style.background = nextScale < 1 ? pageBackground : savedStyles.html.background;
  }
}

function applyScale(nextScale) {
  scale = clampScale(nextScale);
  const active = getWrapper();
  if (active) {
    applyLayout(scale, active);
  }
}

// Scale the page to nextScale while keeping the pixel under the cursor fixed:
// compensate the scaled scroll area's scroll position by the anchored-scroll
// amount during the gesture.
function applyScaleAnchored(nextScale, cursorX, cursorY) {
  const fromScale = scale;
  const html = document.documentElement;
  const compensated = anchoredScroll(
    html.scrollLeft,
    html.scrollTop,
    cursorX,
    cursorY,
    fromScale,
    nextScale
  );
  applyScale(nextScale);
  html.scrollLeft = compensated.scrollX;
  html.scrollTop = compensated.scrollY;
}

// A wheel notch is typically deltaY of ~100 px. Each notch steps the scale
// multiplicatively by STEP_FACTOR; fractional notches (trackpads) give smooth
// even-feeling zoom. Scrolling up (negative deltaY) zooms in, like a pinch.
function notchFromWheel(event) {
  const delta =
    event.deltaMode === 1
      ? event.deltaY * LINE_PX
      : event.deltaMode === 2
        ? event.deltaY * PAGE_PX
        : event.deltaY;
  return -delta / WHEEL_NOTCH_PX;
}

function onWheel(event) {
  if (!hasZoomModifier(event) || event.ctrlKey || event.metaKey || !getWrapper()) {
    return;
  }
  const nextScale = clampScale(scale * Math.pow(STEP_FACTOR, notchFromWheel(event)));
  if (nextScale === scale) {
    return;
  }
  event.preventDefault();
  applyScaleAnchored(nextScale, event.clientX, event.clientY);
}

function onKeyDown(event) {
  if (!hasZoomModifier(event) || event.ctrlKey || event.metaKey || !getWrapper()) {
    return;
  }
  let nextScale;
  if (event.key === '+') {
    nextScale = scaleIn(scale);
  } else if (event.key === '-') {
    nextScale = scaleOut(scale);
  } else if (event.key === '0') {
    nextScale = 1;
  } else {
    return;
  }
  event.preventDefault();
  applyScale(nextScale);
}

function attachListeners() {
  if (listenersAttached) {
    return;
  }
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  listenersAttached = true;
}

function detachListeners() {
  if (!listenersAttached) {
    return;
  }
  window.removeEventListener('wheel', onWheel);
  window.removeEventListener('keydown', onKeyDown);
  listenersAttached = false;
}

export function createVisualZoom() {
  function apply(initialScale = 1) {
    const existing = getWrapper();
    if (existing) {
      applyScale(initialScale === 1 ? scale : initialScale);
      return;
    }

    const body = document.body;
    const html = document.documentElement;
    savedStyles = {
      html: {
        overflow: html.style.overflow,
        background: html.style.background,
      },
      body: {
        overflow: body.style.overflow,
      },
    };

    const el = document.createElement('div');
    el.id = WRAPPER_ID;

    const region = document.createDocumentFragment();
    while (body.firstChild) {
      region.appendChild(body.firstChild);
    }
    el.appendChild(region);
    body.appendChild(el);

    origWidth = html.scrollWidth;
    origHeight = html.scrollHeight;
    pageBackground = captureBackground();

    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.width = `${origWidth}px`;
    el.style.height = `${origHeight}px`;
    el.style.transformOrigin = '0 0';
    body.style.overflow = 'visible';

    attachListeners();
    applyScale(initialScale);
  }

  function dispose() {
    const active = getWrapper();
    if (!active) {
      return;
    }
    const body = document.body;
    const html = document.documentElement;
    while (active.firstChild) {
      body.appendChild(active.firstChild);
    }
    active.remove();

    if (savedStyles) {
      html.style.overflow = savedStyles.html.overflow;
      html.style.background = savedStyles.html.background;
      body.style.overflow = savedStyles.body.overflow;
    }
    savedStyles = null;
    scale = 1;
    origWidth = 0;
    origHeight = 0;
    pageBackground = '';
    detachListeners();
  }

  function setScale(nextScale) {
    applyScale(nextScale);
  }

  function step(direction) {
    setScale(direction > 0 ? scaleIn(scale) : scaleOut(scale));
  }

  return {
    apply,
    dispose,
    setScale,
    step,
    reset: () => setScale(1),
    getScale: () => scale,
    isWrapped: () => Boolean(getWrapper()),
  };
}
