export const MIN_SCALE = 0.3;
export const MAX_SCALE = 3.0;
export const STEP_FACTOR = 1.05;

// The browser's known compositor texture limit: a layer larger than this per
// dimension is split or falls back to a slow raster path. Pages whose scaled
// size exceeds it get the one-time layer-budget warning and a telemetry line.
export const MAX_TEXTURE_PX = 8192;

export function clampScale(scale) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function budgetExceeded(width, height, scale) {
  return width * scale > MAX_TEXTURE_PX || height * scale > MAX_TEXTURE_PX;
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
const NOTICE_ID = 'visual-zoom-notice';
const BUDGET_NOTICE_ID = 'visual-zoom-budget-notice';
const transparent = 'rgba(0, 0, 0, 0)';

// Wrapper-survival budget: a page that clears or replaces body contents (SPA
// frameworks) destroys the injected wrapper; the module re-applies it. The
// budget counts consecutive wrapper losses since the last time a re-applied
// wrapper actually persisted (see armStabilityTimer). Once the count exceeds
// MAX_REAPPLY_TRIES, re-establishment is treated as impossible: the module
// tears down to 1x gracefully and tells the user — never an observer loop.
export const STABILITY_MS = 1000;
const MAX_REAPPLY_TRIES = 2;

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

// Extension wiring hooks. The content-script entry passes implementations
// that talk to chrome.runtime; in the fixture/unit context they stay null and
// every call is a no-op (telemetry falls back to a console line instead).
let scaleChangeListener = null;
let telemetrySink = null;

// Wrapper-survival state: SPA-style scripts can replace or clear the page's
// body mid-zoom, destroying the injected wrapper. These track when that
// happens so the module can re-apply the wrapper — or tear down gracefully
// when the page is actively fighting it.
let observer = null;
let tornDown = false;
let wrapperLossCount = 0;
let stabilityTimer = null;
let noticeShown = false;
let budgetNoticeShown = false;

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

// Report the current (scale, wrapped) state to the extension wiring hook so
// an open popup can mirror what is actually on the page — including the
// teardown path, where the page unwraps back to 1x.
function notifyScale() {
  scaleChangeListener?.(scale, Boolean(getWrapper()));
}

function applyScale(nextScale) {
  scale = clampScale(nextScale);
  const active = getWrapper();
  if (active) {
    applyLayout(scale, active);
    checkLayerBudget();
  }
  notifyScale();
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

// ---- Wrapper survival: re-apply on cheap body clears, tear down gracefully ----

function restoreStylesAndState() {
  if (savedStyles) {
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = savedStyles.html.overflow;
    html.style.background = savedStyles.html.background;
    body.style.overflow = savedStyles.body.overflow;
  }
  savedStyles = null;
  scale = 1;
  origWidth = 0;
  origHeight = 0;
  pageBackground = '';
  wrapperLossCount = 0;
  clearStabilityTimer();
}

function moveChildren(from, to) {
  while (from.firstChild) {
    to.appendChild(from.firstChild);
  }
}

// Move the page's children into a fresh wrapper at targetScale. The original
// inline styles are captured once and kept across re-applies, so a later
// teardown restores the page's true original styles, not the ones we set.
function wrapBody(targetScale) {
  const body = document.body;
  const html = document.documentElement;
  if (!savedStyles) {
    savedStyles = {
      html: {
        overflow: html.style.overflow,
        background: html.style.background,
      },
      body: {
        overflow: body.style.overflow,
      },
    };
  }

  const el = document.createElement('div');
  el.id = WRAPPER_ID;

  moveChildren(body, el);
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
  applyScale(targetScale);
}

// Move the page's children back to body, undo the styles, and stop watching
// the DOM. Idempotent whether or not a wrapper is currently present.
function unwrap() {
  const active = getWrapper();
  if (active) {
    moveChildren(active, document.body);
    active.remove();
  }
  removeBudgetNotice();
  restoreStylesAndState();
  stopObserving();
  detachListeners();
  notifyScale();
}

function getNotice() {
  return document.getElementById(NOTICE_ID);
}

// One-time, non-blocking toast: fixed bottom-right, dismissible, and never
// intercepts page interaction. Shared by the teardown and layer-budget
// notices. Nothing is shown again once the caller's one-shot flag is set.
function showToast(id, message, background, zIndex) {
  const body = document.body;
  if (!body) {
    return;
  }
  const notice = document.createElement('div');
  notice.id = id;
  notice.setAttribute('role', 'status');
  notice.style.cssText =
    `position:fixed;right:16px;bottom:16px;z-index:${zIndex};max-width:320px;` +
    `padding:12px 16px;border-radius:8px;background:${background};color:#fff;` +
    'font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.35);';
  const messageEl = document.createElement('span');
  messageEl.textContent = message;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.style.cssText =
    'margin-left:8px;padding:2px 8px;border:1px solid rgba(255,255,255,0.4);' +
    'border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer;';
  dismiss.addEventListener('click', () => notice.remove());
  notice.append(messageEl, dismiss);
  body.appendChild(notice);
}

// One-time, non-blocking notice after a graceful teardown. Nothing is shown
// again once noticeShown is set, and nothing after this function mutates the
// DOM.
function showNotice() {
  if (noticeShown) {
    return;
  }
  noticeShown = true;
  showToast(
    NOTICE_ID,
    'Visual Zoom stopped: the page replaced its own content, so zoom was reset to 100%.',
    '#17203a',
    2147483647
  );
}

function removeNotice() {
  const notice = getNotice();
  if (notice) {
    notice.remove();
  }
}

// ---- Layer budget warning ----

function getBudgetNotice() {
  return document.getElementById(BUDGET_NOTICE_ID);
}

function removeBudgetNotice() {
  const notice = getBudgetNotice();
  if (notice) {
    notice.remove();
  }
}

// One-time, non-blocking notice when the scaled page exceeds the browser's
// compositor texture limit: zooming a huge page into a texture-sized layer can
// be slow. It never blocks zoom interaction and fires at most once per page
// load (budgetNoticeShown, reset on re-engage via apply()).
function showBudgetNotice() {
  if (budgetNoticeShown) {
    return;
  }
  budgetNoticeShown = true;
  showToast(
    BUDGET_NOTICE_ID,
    'Visual Zoom may be slow on this page: it is larger than the browser\'s ' +
      'compositor texture limit.',
    '#3a2d12',
    2147483646
  );
}

// Instrumented telemetry for the layer budget so the real envelope is known
// before release. In the extension the content script forwards this to the
// background, which logs it; in the fixture the module logs directly.
function telemetry(event, data) {
  if (telemetrySink) {
    telemetrySink(event, data);
    return;
  }
  console.info(`[visual-zoom] telemetry ${event} ${JSON.stringify(data)}`);
}

function checkLayerBudget() {
  if (budgetNoticeShown || tornDown || !getWrapper()) {
    return;
  }
  if (!budgetExceeded(origWidth, origHeight, scale)) {
    return;
  }
  showBudgetNotice();
  telemetry('layer-budget-exceeded', {
    width: Math.round(origWidth * scale),
    height: Math.round(origHeight * scale),
    scale,
  });
}

// The page replaced or cleared body contents, taking the wrapper with it.
// Re-apply at the current scale so zoom survives the page's own DOM changes,
// but never fight the page: if the wrapper cannot be re-established cleanly
// — the page keeps destroying it, or there is nothing left to wrap — tear
// down to 1x and tell the user rather than entering an observer loop.
function reapplyAfterLoss() {
  const body = document.body;
  if (!body || body.children.length === 0) {
    teardown();
    return;
  }
  wrapperLossCount += 1;
  if (wrapperLossCount > MAX_REAPPLY_TRIES) {
    teardown();
    return;
  }
  wrapBody(scale);
  armStabilityTimer();
  // A re-wrapped page is a fresh page: it starts at the top, never mid-scroll
  // in the content that was just replaced.
  const html = document.documentElement;
  html.scrollLeft = 0;
  html.scrollTop = 0;
}

// A re-applied wrapper that survives the whole stability window means the
// page accepted it: reset the loss budget. A page that keeps destroying the
// wrapper before that — at any cadence, however slow — keeps the budget
// climbing, so a relentless fighter tears down exactly like a burst one.
function armStabilityTimer() {
  clearStabilityTimer();
  stabilityTimer = setTimeout(() => {
    stabilityTimer = null;
    if (!tornDown && getWrapper()) {
      wrapperLossCount = 0;
    }
  }, STABILITY_MS);
}

function clearStabilityTimer() {
  if (stabilityTimer !== null) {
    clearTimeout(stabilityTimer);
    stabilityTimer = null;
  }
}

function onBodyMutation() {
  if (tornDown || !document.body || getWrapper()) {
    return;
  }
  reapplyAfterLoss();
}

// Cheapest detector of wrapper destruction: watch only body's direct children
// (a single childList mutation covers any replace-style clear), never the
// subtree, so ordinary content changes inside the wrapper stay unbudgeted.
function startObserving() {
  if (observer || !document.body) {
    return;
  }
  observer = new MutationObserver(onBodyMutation);
  observer.observe(document.body, { childList: true });
}

function stopObserving() {
  if (!observer) {
    return;
  }
  observer.disconnect();
  observer = null;
}

// Final graceful stop: explicit re-applies can re-engage via apply(), but
// nothing observes or mutates the DOM again after the one-time notice.
function teardown() {
  tornDown = true;
  unwrap();
  showNotice();
}

export function createVisualZoom({ onScaleChange = null, onTelemetry = null } = {}) {
  scaleChangeListener = onScaleChange;
  telemetrySink = onTelemetry;

  function apply(initialScale = 1) {
    tornDown = false;
    removeNotice();
    noticeShown = false;
    removeBudgetNotice();
    budgetNoticeShown = false;
    startObserving();
    const existing = getWrapper();
    if (existing) {
      applyScale(initialScale === 1 ? scale : initialScale);
      return;
    }
    wrapBody(initialScale);
  }

  function dispose() {
    unwrap();
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
