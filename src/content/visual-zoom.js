export const MIN_SCALE = 0.3;
export const MAX_SCALE = 3.0;
export const STEP_FACTOR = 1.05;

// The browser's known compositor texture limit: a layer larger than this per
// dimension is split or falls back to a slow raster path. Pages whose scaled
// size exceeds it get the one-time layer-budget warning and a telemetry line.
export const MAX_TEXTURE_PX = 8192;

// The pure scale math spans the full 0.3x–3x envelope; the zoom-below-100
// setting picks the effective floor at runtime (1x when off, MIN_SCALE when
// on) and hands it in via the minScale argument.
export function clampScale(scale, minScale = MIN_SCALE) {
  return Math.min(MAX_SCALE, Math.max(minScale, scale));
}

export function budgetExceeded(width, height, scale) {
  return width * scale > MAX_TEXTURE_PX || height * scale > MAX_TEXTURE_PX;
}

export function scaleIn(scale, minScale = MIN_SCALE) {
  return clampScale(scale * STEP_FACTOR, minScale);
}

export function scaleOut(scale, minScale = MIN_SCALE) {
  return clampScale(scale / STEP_FACTOR, minScale);
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

import { POLICIES, DEFAULT_HOTKEYS } from '../settings/store.js';
import { createFixedPolicy } from './fixed-policy.js';
import { createNotices } from './notices.js';

const WRAPPER_ID = 'visual-zoom-wrapper';
const transparent = 'rgba(0, 0, 0, 0)';

// Wrapper-survival budget: a page that clears or replaces body contents (SPA
// frameworks) destroys the injected wrapper; the module re-applies it. The
// budget counts consecutive wrapper losses since the last time a re-applied
// wrapper actually persisted (see armStabilityTimer). Once the count exceeds
// MAX_REAPPLY_TRIES, re-establishment is treated as impossible: the module
// tears down to 1x gracefully and tells the user — never an observer loop.
export const STABILITY_MS = 1000;
const MAX_REAPPLY_TRIES = 2;

// The key a user holds while scrolling to gesture-zoom. Defaults to Shift:
// Alt is avoided because Firefox intercepts Alt+scroll at the chrome level
// (mousewheel.with_alt.action=2, history navigation) and never delivers the
// wheel event to page JS. Shift+scroll (action=4, horizontal scroll) still
// fires wheel events, so the extension can intercept them. Persisted
// settings (ticket 06) feed the live value in through createVisualZoom's
// modifier option / setInputs().
export const DEFAULT_MODIFIER = 'shiftKey';

// Rough pixel advance of one wheel notch; each notch steps the scale
// multiplicatively by STEP_FACTOR. Line-mode and page-mode deltas are
// converted to pixels so every real wheel reports gesture zoom.
const WHEEL_NOTCH_PX = 100;
const LINE_PX = 16;
const PAGE_PX = 100;

let scale = 1;
let crispText = false;
let zoomModifier = DEFAULT_MODIFIER;
let inputHotkeys = DEFAULT_HOTKEYS;
let gestureEnabled = true;
let hotkeysEnabled = true;
// Whether zooming below 100% is allowed (the letterbox zoom-out). Off by
// default: the scale clamps at 1x unless the user opts in, mirroring how a
// trackpad pinch starts from the page at 100%.
let zoomBelow100 = false;
let origWidth = 0;
let origHeight = 0;
let pageBackground = '';
let savedStyles = null;
let listenersAttached = false;
// Whether the body-transform approach is active: transform: scale() is applied
// directly to document.body instead of wrapping children in a div. This avoids
// childList mutations on body that break sites observing body for DOM changes
// (e.g. YouTube thumbnail hover autoplay).
let bodyScaled = false;

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

// Whether the configured gesture modifier is held, without colliding with
// native browser shortcuts. Alt/Shift combos also require Ctrl and Meta to be
// free so Ctrl+wheel (native reflow zoom) and Meta+wheel stay untouched; a
// Ctrl/Meta-configured modifier claims its own key.
const PRIMARY_MODIFIERS = ['ctrlKey', 'metaKey'];

function hasZoomModifier(event) {
  if (!event[zoomModifier]) {
    return false;
  }
  return (
    PRIMARY_MODIFIERS.includes(zoomModifier) || (!event.ctrlKey && !event.metaKey)
  );
}

function matchesCombo(event, combo) {
  if (event.key !== combo.key || !event[combo.modifier]) {
    return false;
  }
  return (
    PRIMARY_MODIFIERS.includes(combo.modifier) || (!event.ctrlKey && !event.metaKey)
  );
}

function captureBackground() {
  const html = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const source = html.backgroundColor !== transparent ? document.documentElement : document.body;
  return getComputedStyle(source).background;
}

function getWrapper() {
  if (bodyScaled) {
    return document.body;
  }
  return document.getElementById(WRAPPER_ID);
}

const fixedPolicy = createFixedPolicy({ getWrapper });
const notices = createNotices();

// The effective scale floor: 1x unless zoom-below-100 is enabled, in which
// case the full 0.3x envelope floor applies.
function effectiveMinScale() {
  return zoomBelow100 ? MIN_SCALE : 1;
}

function applyLayout(nextScale, target) {
  const html = document.documentElement;
  target.style.transform = `scale(${nextScale})`;
  html.style.overflow = nextScale >= 1 ? 'auto' : 'hidden';
  if (savedStyles) {
    html.style.background = nextScale < 1 ? pageBackground : savedStyles.html.background;
  }
}

// The crisp-text escape hatch renders the settled scale by reflowing the page
// (CSS zoom on the root), so text re-rasterizes crisply — trading layout
// fidelity for sharpness. It is an explicit per-site opt-in, never a default.
function applyCrispLayout(nextScale) {
  document.documentElement.style.zoom = nextScale === 1 ? '' : String(nextScale);
}

// Report the current (scale, wrapped, engaged) state to the extension wiring
// hook so an open popup can mirror what is actually on the page — including
// the teardown path, where the page unwraps back to 1x, and the crisp-text
// path, where the tool is engaged without a wrapper.
function notifyScale() {
  scaleChangeListener?.(scale, Boolean(getWrapper()), isEngaged());
}

function applyScale(nextScale) {
  scale = clampScale(nextScale, effectiveMinScale());
  // Snap near-1.0 fractional scales to exactly 1 so the unwrap path fires.
  // Wheel gestures multiply by Math.pow(STEP_FACTOR, notch) which can land
  // on 1.0000000001 or 0.9999999998 due to floating-point rounding.
  if (scale !== 1 && Math.abs(scale - 1) < 1e-3) {
    scale = 1;
  }
  const active = getWrapper();
  if (active) {
      if (scale === 1 && !crispText) {
        // Back to 100%: restore the original DOM so sites that expect direct
        // body children (e.g. YouTube thumbnail autoplay) work again.
        unwrap();
        attachListeners();
        return;
      }
    applyLayout(scale, active);
    checkLayerBudget();
  } else if (crispText) {
    applyCrispLayout(scale);
  } else if (scale !== 1) {
    // Transitioning from dormant to active: wrap now.
    startObserving();
    wrapBody(scale);
    return;
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
  if (!gestureEnabled || !hasZoomModifier(event) || !isEngaged()) {
    return;
  }
    // Lazy-wrap on first gesture from dormant mode.
    if (!getWrapper() && !crispText) {
      wrapBody(scale);
    }
  event.preventDefault();
  const nextScale = clampScale(
    scale * Math.pow(STEP_FACTOR, notchFromWheel(event)),
    effectiveMinScale()
  );
  if (nextScale === scale) {
    return;
  }
  // In reflow mode there is no scaled scroll area to compensate: the browser
  // reflows layout around the origin, so the cursor anchor is not claimed.
  if (crispText) {
    applyScale(nextScale);
  } else {
    applyScaleAnchored(nextScale, event.clientX, event.clientY);
  }
}

function isEditable(el) {
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable
  );
}

function onKeyDown(event) {
  if (!hotkeysEnabled || !isEngaged()) {
    return;
  }
  if (isEditable(event.target)) {
    return;
  }
  let nextScale;
  if (matchesCombo(event, inputHotkeys.zoomIn)) {
    nextScale = scaleIn(scale, effectiveMinScale());
  } else if (matchesCombo(event, inputHotkeys.zoomOut)) {
    nextScale = scaleOut(scale, effectiveMinScale());
  } else if (matchesCombo(event, inputHotkeys.reset)) {
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
  document.documentElement.style.zoom = '';
  document.body.style.transform = '';
  document.body.style.transformOrigin = '';
  document.body.style.width = '';
  document.body.style.height = '';
  bodyScaled = false;
  crispText = false;
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

// Apply the scale transform to the page. For 'scale-everything' policy, the
// transform goes directly on document.body — no child elements are moved, so
// body's childList never mutates. This prevents sites that observe body
// (YouTube, SPAs) from reinitialising and losing event bindings (hover
// autoplay, etc.). For fixed-element policies that need to lift protected
// elements, the original wrapper approach is used.
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

  origWidth = html.scrollWidth;
  origHeight = html.scrollHeight;
  pageBackground = captureBackground();

  if (fixedPolicy.getPolicy() === 'scale-everything') {
    bodyScaled = true;
    body.style.transformOrigin = '0 0';
    body.style.width = `${origWidth}px`;
    body.style.height = `${origHeight}px`;
    body.style.overflow = 'visible';
    attachListeners();
    scale = clampScale(targetScale, effectiveMinScale());
    applyLayout(scale, body);
  } else {
    const el = document.createElement('div');
    el.id = WRAPPER_ID;
    moveChildren(body, el);
    body.appendChild(el);

    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.width = `${origWidth}px`;
    el.style.height = `${origHeight}px`;
    el.style.transformOrigin = '0 0';
    body.style.overflow = 'visible';

    attachListeners();
    scale = clampScale(targetScale, effectiveMinScale());
    applyLayout(scale, el);
    fixedPolicy.syncPolicy();
  }
  checkLayerBudget();
  notifyScale();
}

// Restore the original DOM. Idempotent whether the body-transform or wrapper
// approach is currently active.
function unwrap() {
  fixedPolicy.clearProtected();
  fixedPolicy.stopFixedObserver();
  // Stop the body observer BEFORE DOM mutations: moveChildren and
  // active.remove() mutate body's childList, which would fire onBodyMutation
  // and trigger reapplyAfterLoss(), recreating the wrapper we just destroyed.
  stopObserving();
  if (bodyScaled) {
    // Body-transform approach: just remove the inline styles.
    // No children were moved, so no childList mutation fires — the whole
    // point of this approach.
    document.body.style.transform = '';
    document.body.style.transformOrigin = '';
    document.body.style.width = '';
    document.body.style.height = '';
    bodyScaled = false;
  } else {
    const active = getWrapper();
    if (active) {
      moveChildren(active, document.body);
      active.remove();
    }
  }
  notices.removeBudgetNotice();
  restoreStylesAndState();
  detachListeners();
  notifyScale();
}

// The tool is engaged when either the wrapper is up (live transform) or the
// crisp-text reflow is active — so gesture/hotkey zoom keep working in both.
function isEngaged() {
  return listenersAttached || Boolean(getWrapper()) || crispText;
}

// Enter/leave the crisp-text escape hatch. Entering reflows the page at the
// settled scale (wrapper torn down, CSS zoom on the root) so text re-rasterizes
// crisply; leaving clears the reflow and re-wraps the page at the same scale,
// returning to live-transform zoom.
function setCrispText(enabled) {
  if (enabled === crispText) {
    return;
  }
  crispText = enabled;
  if (enabled) {
    removeWrapperKeepZoom();
    stopObserving();
    applyCrispLayout(scale);
  } else {
    document.documentElement.style.zoom = '';
    startObserving();
    wrapBody(scale);
  }
  notifyScale();
}

// Tear the zoom down but keep the settled scale and the captured original
// styles, so the crisp reflow can take over and a later re-wrap reuses the
// page's true originals.
function removeWrapperKeepZoom() {
  fixedPolicy.clearProtected();
  fixedPolicy.stopFixedObserver();
  if (bodyScaled) {
    document.body.style.transform = '';
    document.body.style.transformOrigin = '';
    document.body.style.width = '';
    document.body.style.height = '';
    bodyScaled = false;
    notices.removeBudgetNotice();
    if (savedStyles) {
      const html = document.documentElement;
      const body = document.body;
      html.style.overflow = savedStyles.html.overflow;
      html.style.background = savedStyles.html.background;
      body.style.overflow = savedStyles.body.overflow;
    }
    return;
  }
  const active = getWrapper();
  if (!active) {
    return;
  }
  moveChildren(active, document.body);
  active.remove();
  notices.removeBudgetNotice();
  if (savedStyles) {
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = savedStyles.html.overflow;
    html.style.background = savedStyles.html.background;
    body.style.overflow = savedStyles.body.overflow;
  }
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
  if (notices.isBudgetNoticeShown() || tornDown || !getWrapper()) {
    return;
  }
  if (!budgetExceeded(origWidth, origHeight, scale)) {
    return;
  }
  notices.showBudgetNotice();
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
  notices.showNotice();
}

export function createVisualZoom({
  onScaleChange = null,
  onTelemetry = null,
  modifier = DEFAULT_MODIFIER,
  hotkeys = DEFAULT_HOTKEYS,
  gestureEnabled: initialGestureEnabled = true,
  hotkeysEnabled: initialHotkeysEnabled = true,
  policy = 'scale-everything',
  zoomBelow100: allowZoomBelow100 = false,
} = {}) {
  scaleChangeListener = onScaleChange;
  telemetrySink = onTelemetry;
  zoomModifier = modifier;
  inputHotkeys = hotkeys;
  gestureEnabled = initialGestureEnabled;
  hotkeysEnabled = initialHotkeysEnabled;
  if (POLICIES.includes(policy)) {
    fixedPolicy.setPolicy(policy);
  }
  zoomBelow100 = allowZoomBelow100;

  function apply(initialScale = 1) {
    tornDown = false;
    notices.removeNotice();
    notices.removeBudgetNotice();
    notices.reset();
    if (crispText) {
      applyScale(initialScale);
      return;
    }
    // Dormant mode: no zoom needed, skip DOM surgery entirely.
    // Listeners are attached so a future gesture can wrap on demand.
    // This prevents breaking sites that expect direct body children
    // (e.g. YouTube thumbnail hover autoplay).
    if (initialScale === 1 && !zoomBelow100 && !getWrapper()) {
      attachListeners();
      notifyScale();
      return;
    }
    startObserving();
    const existing = getWrapper();
    if (existing) {
      if (initialScale === 1 && scale === 1) {
        return;
      }
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
    setScale(direction > 0 ? scaleIn(scale, effectiveMinScale()) : scaleOut(scale, effectiveMinScale()));
  }

  // Settings changes land here live: a new gesture modifier or hotkey combo
  // applies to already-open tabs without a reload of the extension.
  function setInputs({ modifier: nextModifier, hotkeys: nextHotkeys, gestureEnabled: nextGesture, hotkeysEnabled: nextHotkeysEnabled } = {}) {
    if (nextModifier) {
      zoomModifier = nextModifier;
    }
    if (nextHotkeys) {
      inputHotkeys = nextHotkeys;
    }
    if (typeof nextGesture === 'boolean') {
      gestureEnabled = nextGesture;
    }
    if (typeof nextHotkeysEnabled === 'boolean') {
      hotkeysEnabled = nextHotkeysEnabled;
    }
  }

  // A new fixed-element policy applies to the live page immediately: protected
  // elements are lifted or restored without reloading anything.
  function setPolicy(nextPolicy) {
    if (!POLICIES.includes(nextPolicy) || nextPolicy === fixedPolicy.getPolicy()) {
      return;
    }
    const wasZoomed = scale !== 1;
    fixedPolicy.setPolicy(nextPolicy);
    if (wasZoomed) {
      // Re-apply the zoom with the new policy: this handles transitions
      // between body-transform and wrapper approaches.
      const currentScale = scale;
      unwrap();
      if (nextPolicy === 'scale-everything') {
        // Switching to body-transform: apply directly.
        bodyScaled = true;
        const body = document.body;
        body.style.transformOrigin = '0 0';
        body.style.width = `${origWidth}px`;
        body.style.height = `${origHeight}px`;
        body.style.overflow = 'visible';
        attachListeners();
        scale = clampScale(currentScale, effectiveMinScale());
        applyLayout(scale, body);
      } else {
        // Switching to wrapper approach: re-wrap.
        startObserving();
        wrapBody(currentScale);
      }
    }
  }

  // The zoom-below-100 gate applies live: turning it on lets zoom-out pass
  // 1x; turning it off re-clamps the current scale (a settled sub-1x scale
  // jumps back to 100%).
  function setZoomBelow100(enabled) {
    zoomBelow100 = Boolean(enabled);
    if (zoomBelow100) {
      return;
    }
    if (scale < 1) {
      applyScale(1);
    }
  }

  return {
    apply,
    dispose,
    setScale,
    step,
    reset: () => setScale(1),
    getScale: () => scale,
    isWrapped: () => Boolean(getWrapper()),
    isEngaged,
    setInputs,
    setCrispText,
    setPolicy,
    setZoomBelow100,
  };
}
