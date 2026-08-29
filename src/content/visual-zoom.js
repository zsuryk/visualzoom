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

import { POLICIES } from '../settings/store.js';

const WRAPPER_ID = 'visual-zoom-wrapper';
const NOTICE_ID = 'visual-zoom-notice';
const BUDGET_NOTICE_ID = 'visual-zoom-budget-notice';
const transparent = 'rgba(0, 0, 0, 0)';

const FIXED_LAYER_ID = 'visual-zoom-fixed-layer';

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

export const DEFAULT_HOTKEYS = {
  zoomIn: { modifier: 'shiftKey', key: '+' },
  zoomOut: { modifier: 'shiftKey', key: '-' },
  reset: { modifier: 'shiftKey', key: '0' },
};

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
// Whether zooming below 100% is allowed (the letterbox zoom-out). Off by
// default: the scale clamps at 1x unless the user opts in, mirroring how a
// trackpad pinch starts from the page at 100%.
let zoomBelow100 = false;
let origWidth = 0;
let origHeight = 0;
let pageBackground = '';
let savedStyles = null;
let listenersAttached = false;

// Fixed-element policy state: the active mode and the elements currently
// lifted out of the scaled wrapper into the unscaled fixed layer (ticket 07).
let fixedPolicy = 'scale-everything';
let fixedLayer = null;
const protectedElements = new Map();
let fixedObserver = null;

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
  return document.getElementById(WRAPPER_ID);
}

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
  if (!hasZoomModifier(event) || !isEngaged()) {
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

function onKeyDown(event) {
  if (!isEngaged()) {
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
  scale = clampScale(targetScale, effectiveMinScale());
  applyLayout(scale, el);
  checkLayerBudget();
  syncPolicy();
  notifyScale();
}

// Move the page's children back to body, undo the styles, and stop watching
// the DOM. Idempotent whether or not a wrapper is currently present.
function unwrap() {
  const active = getWrapper();
  // Restore lifted elements to their original spots inside the wrapper BEFORE
  // the children are moved back to body, so the page regains its exact DOM.
  clearProtected();
  stopFixedObserver();
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

// Tear the wrapper down but keep the settled scale and the captured original
// styles, so the crisp reflow can take over and a later re-wrap reuses the
// page's true originals.
function removeWrapperKeepZoom() {
  const active = getWrapper();
  clearProtected();
  stopFixedObserver();
  if (!active) {
    return;
  }
  moveChildren(active, document.body);
  active.remove();
  removeBudgetNotice();
  if (savedStyles) {
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = savedStyles.html.overflow;
    html.style.background = savedStyles.html.background;
    body.style.overflow = savedStyles.body.overflow;
  }
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

// ---- Fixed-element policy ----
//
// Protected fixed/sticky elements are "lifted" out of the scaled wrapper into
// a fixed layer that lives at body level, outside any transform. A lifted
// element keeps its own CSS, so a `position: fixed` modal re-anchors to the
// viewport at 1x while the rest of the page scales, and a sticky header lifted
// as `position: fixed` stays viewport-anchored too. Elements that become
// fixed after the page is already zoomed (SPA-rendered modals, dynamically
// added sticky elements) are caught by a live subtree observer and lifted the
// moment they appear.

// The layer is a sibling of the wrapper, so it is never scaled: its fixed
// children anchor to the viewport at 1x. It covers the viewport but passes
// interaction through everywhere a lifted element isn't painted; each lifted
// element keeps its own pointer-events.
function ensureFixedLayer() {
  if (fixedLayer) {
    return fixedLayer;
  }
  fixedLayer = document.createElement('div');
  fixedLayer.id = FIXED_LAYER_ID;
  fixedLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;';
  document.body.appendChild(fixedLayer);
  return fixedLayer;
}

function removeFixedLayer() {
  if (fixedLayer) {
    fixedLayer.remove();
    fixedLayer = null;
  }
}

// Whether the current policy protects this element. Sticky table headers
// (sticky cells inside a <table>) are left to their own scroll container —
// lifting them out of the table would collapse its layout — so only page-level
// sticky chrome (headers/navs) is protected.
function shouldProtect(el) {
  if (fixedPolicy === 'scale-everything') {
    return false;
  }
  const position = getComputedStyle(el).position;
  if (position === 'fixed') {
    return true;
  }
  return (
    position === 'sticky' && fixedPolicy === 'protect-sticky-too' && !el.closest('table')
  );
}

// Skip elements that are already inside a lifted element: lifting the outermost
// fixed element (e.g. a modal backdrop) brings its descendants along, and
// re-lifting them would break their offset positioning.
function isDescendantOfProtected(el) {
  for (const protectedEl of protectedElements.keys()) {
    if (protectedEl !== el && protectedEl.contains(el)) {
      return true;
    }
  }
  return false;
}

function liftElement(el) {
  if (protectedElements.has(el) || isDescendantOfProtected(el)) {
    return;
  }
  if (!shouldProtect(el)) {
    return;
  }
  const inlinePosition = el.style.position;
  const inlinePointerEvents = el.style.pointerEvents;
  const inlineWidth = el.style.width;
  // A sticky element only sticks against a scroll container; lifted to the
  // viewport layer it must be fixed to stay viewport-anchored at 1x. In flow
  // its auto width fills its scroll container, but a fixed element's auto
  // width shrinks to its content — pin the computed in-flow width so a
  // full-width header keeps its full width at 1x. (A sticky that hasn't stuck
  // yet still anchors at its flow position, which matches the fixture navs
  // this policy is designed for; below-the-fold chunky stickies are outside
  // scope.)
  if (getComputedStyle(el).position === 'sticky') {
    el.style.width = getComputedStyle(el).width;
    el.style.position = 'fixed';
  }
  // The fixed layer passes interaction through with pointer-events:none,
  // which its descendants inherit — so each lifted element re-asserts
  // pointer-events:auto to stay interactive (protected elements must remain
  // usable, per the ticket). All overrides are restored on unlift.
  el.style.pointerEvents = 'auto';
  protectedElements.set(el, {
    parent: el.parentNode,
    next: el.nextSibling,
    inlinePosition,
    inlinePointerEvents,
    inlineWidth,
  });
  ensureFixedLayer().appendChild(el);
}

// Restore a lifted element to its original spot in the wrapped page. If the
// page removed the element itself while it was lifted, or destroyed its
// original parent (body-level content replacement), drop the orphan rather
// than re-attach stale nodes.
function unliftElement(el) {
  const record = protectedElements.get(el);
  if (!record) {
    return;
  }
  protectedElements.delete(el);
  // A page closing a modal deletes its node; the element then lives nowhere,
  // so restoring it would resurrect something the page intentionally removed.
  if (!el.isConnected) {
    return;
  }
  el.style.position = record.inlinePosition;
  el.style.pointerEvents = record.inlinePointerEvents;
  el.style.width = record.inlineWidth;
  if (record.parent && record.parent.isConnected) {
    if (record.next && record.next.isConnected) {
      record.parent.insertBefore(el, record.next);
    } else {
      record.parent.appendChild(el);
    }
  } else {
    // The page destroyed the original parent (body-level content
    // replacement): the element only survives in the fixed layer, so drop it.
    el.remove();
  }
}

function clearProtected() {
  for (const el of Array.from(protectedElements.keys())) {
    unliftElement(el);
  }
  removeFixedLayer();
}

function walkElements(root, fn) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    fn(node);
  }
}

function scanAndLift(root) {
  if (fixedPolicy === 'scale-everything') {
    return;
  }
  const candidates = [];
  if (shouldProtect(root)) {
    candidates.push(root);
  }
  walkElements(root, (el) => {
    if (shouldProtect(el)) {
      candidates.push(el);
    }
  });
  for (const el of candidates) {
    liftElement(el);
  }
}

// Live tracking: new nodes added to the wrapped page (SPA-rendered modals)
// and class/style changes that turn elements fixed (a modal shown via a
// class on its own or an ancestor container) both land here. Each change is
// scanned in place; already-lifted elements are skipped because they no
// longer live inside the observed wrapper. (Shadow-root modals are out of
// scope for the fixture-proven tracker.)
function onFixedMutation(mutations) {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes') {
      // A class/style change on an ancestor can make a whole subtree fixed,
      // so scan the changed element's subtree, not just the element.
      scanAndLift(mutation.target);
    } else if (mutation.type === 'childList') {
      for (const added of mutation.addedNodes) {
        if (added.nodeType === Node.ELEMENT_NODE) {
          scanAndLift(added);
        }
      }
    }
  }
}

function startFixedObserver() {
  if (fixedObserver || fixedPolicy === 'scale-everything') {
    return;
  }
  const wrapper = getWrapper();
  if (!wrapper) {
    return;
  }
  fixedObserver = new MutationObserver(onFixedMutation);
  fixedObserver.observe(wrapper, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  });
}

function stopFixedObserver() {
  if (!fixedObserver) {
    return;
  }
  fixedObserver.disconnect();
  fixedObserver = null;
}

// Apply the current policy to the live page: restore every lifted element,
// re-scan the wrapped content under the new policy, and resume tracking.
// Safe to call with no wrapper (e.g. crisp-text reflow or a disabled site).
function syncPolicy() {
  clearProtected();
  stopFixedObserver();
  if (!getWrapper() || fixedPolicy === 'scale-everything') {
    return;
  }
  scanAndLift(getWrapper());
  startFixedObserver();
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

export function createVisualZoom({
  onScaleChange = null,
  onTelemetry = null,
  modifier = DEFAULT_MODIFIER,
  hotkeys = DEFAULT_HOTKEYS,
  policy = 'scale-everything',
  zoomBelow100: allowZoomBelow100 = false,
} = {}) {
  scaleChangeListener = onScaleChange;
  telemetrySink = onTelemetry;
  zoomModifier = modifier;
  inputHotkeys = hotkeys;
  if (POLICIES.includes(policy)) {
    fixedPolicy = policy;
  }
  zoomBelow100 = allowZoomBelow100;

  function apply(initialScale = 1) {
    tornDown = false;
    removeNotice();
    noticeShown = false;
    removeBudgetNotice();
    budgetNoticeShown = false;
    if (crispText) {
      applyScale(initialScale);
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
  function setInputs({ modifier: nextModifier, hotkeys: nextHotkeys } = {}) {
    if (nextModifier) {
      zoomModifier = nextModifier;
    }
    if (nextHotkeys) {
      inputHotkeys = nextHotkeys;
    }
  }

  // A new fixed-element policy applies to the live page immediately: protected
  // elements are lifted or restored without reloading anything.
  function setPolicy(nextPolicy) {
    if (!POLICIES.includes(nextPolicy) || nextPolicy === fixedPolicy) {
      return;
    }
    fixedPolicy = nextPolicy;
    if (getWrapper()) {
      syncPolicy();
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
