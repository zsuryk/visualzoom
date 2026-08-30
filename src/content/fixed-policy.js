// Fixed-element policy: lift protected fixed/sticky elements out of the scaled
// wrapper into an unscaled layer so they anchor to the viewport at 1× while
// the rest of the page scales.

const FIXED_LAYER_ID = 'visual-zoom-fixed-layer';

export function createFixedPolicy({ getWrapper }) {
  let fixedPolicy = 'scale-everything';
  let fixedLayer = null;
  const protectedElements = new Map();
  let fixedObserver = null;

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
    if (getComputedStyle(el).position === 'sticky') {
      el.style.width = getComputedStyle(el).width;
      el.style.position = 'fixed';
    }
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

  function unliftElement(el) {
    const record = protectedElements.get(el);
    if (!record) {
      return;
    }
    protectedElements.delete(el);
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

  function onFixedMutation(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
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

  function syncPolicy() {
    clearProtected();
    stopFixedObserver();
    if (!getWrapper() || fixedPolicy === 'scale-everything') {
      return;
    }
    scanAndLift(getWrapper());
    startFixedObserver();
  }

  function setPolicy(nextPolicy) {
    fixedPolicy = nextPolicy;
  }

  function getPolicy() {
    return fixedPolicy;
  }

  function dispose() {
    clearProtected();
    stopFixedObserver();
  }

  return {
    syncPolicy,
    clearProtected,
    startFixedObserver,
    stopFixedObserver,
    setPolicy,
    getPolicy,
    dispose,
  };
}
