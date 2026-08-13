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

const WRAPPER_ID = 'visual-zoom-wrapper';
const transparent = 'rgba(0, 0, 0, 0)';

let scale = 1;
let origWidth = 0;
let origHeight = 0;
let pageBackground = '';
let savedStyles = null;

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
