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

export function createVisualZoom() {
  const WRAPPER_ID = 'visual-zoom-wrapper';
  const transparent = 'rgba(0, 0, 0, 0)';

  let wrapper = null;
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
      if (nextScale < 1) {
        html.style.background = pageBackground;
      } else {
        html.style.background = savedStyles.html.background;
      }
    }
  }

  function apply(initialScale = 1) {
    const existing = getWrapper();
    if (existing) {
      scale = clampScale(initialScale);
      applyLayout(scale, existing);
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

    wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;

    const region = document.createDocumentFragment();
    while (body.firstChild) {
      region.appendChild(body.firstChild);
    }
    wrapper.appendChild(region);
    body.appendChild(wrapper);

    origWidth = html.scrollWidth;
    origHeight = html.scrollHeight;
    pageBackground = captureBackground();

    wrapper.style.position = 'absolute';
    wrapper.style.top = '0';
    wrapper.style.left = '0';
    wrapper.style.width = `${origWidth}px`;
    wrapper.style.height = `${origHeight}px`;
    wrapper.style.overflow = 'hidden';
    wrapper.style.transformOrigin = '0 0';
    body.style.overflow = 'visible';

    scale = clampScale(initialScale);
    applyLayout(scale, wrapper);
  }

  function dispose() {
    const active = getWrapper();
    if (!active) {
      wrapper = null;
      return;
    }
    const body = document.body;
    const html = document.documentElement;
    while (active.firstChild) {
      body.appendChild(active.firstChild);
    }
    active.remove();
    wrapper = null;

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
    scale = clampScale(nextScale);
    const active = getWrapper();
    if (active) {
      applyLayout(scale, active);
    }
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
    getOriginalSize: () => ({ width: origWidth, height: origHeight }),
  };
}