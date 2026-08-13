# 02 — Wrapper, scaled scroll area, letterbox bands

**What to build:** The content-script module that performs whole-page visual zoom on the fixture: it moves all of the body's children into an injected wrapper container, applies a live `transform: scale()` to it, and sets the wrapper's layout box to the original dimensions × scale so the browser's native scroll area (scrollbars, wheel, keys, touch) still reaches the parts of a zoomed-in page that visually overflow the viewport. When zoomed out below 1×, only the page background stretches to the viewport edges; content geometry stays untouched.

**Blocked by:** 01 — Native-zoom-breaking fixture page.

**Status:** done

- [x] Browser automation loads the fixture, injects the content-script module, and asserts that at a scale > 1 the scaled scroll area reaches the page's overflow (scrolling to the bottom/right lands past the viewport-visible region).
- [x] Native scrolling still works while zoomed: wheel, keyboard scrolling, and touch/scrollbar input reach the zoomed overflow.
- [x] At a scale < 1, the letterbox bands around the page show the page background stretched to the viewport edges rather than blank space, with content geometry unchanged.
- [x] Scale stepping, scale clamping, scaled-dimensions math, and letterbox geometry are covered by deterministic pure-math unit tests.
- [x] The wrapper is idempotent: applying the module twice (or re-running it after navigation) does not double-wrap the page.

## Comments

Implemented `src/content/visual-zoom.js` (module exports the pure scale math for
`@unit` tests) plus `tests/visual-zoom.spec.js` (fixture automation) and
`tests/scale-model.spec.js` (@unit). Full suite: 11 tests, all green, 0 flaky
across repeat runs.

Design notes (faithful to ADR-0001/0002, observable contract per checklist):

- The wrapper holds the page's original layout box (unscaled) and carries
  `transform: scale()`. Transformed visual overflow IS included in the root
  scrollable overflow, so the native html scroll area reaches orig x scale
  (verified: scrollWidth/Height 2048/1536 at 2x). Resizing the body box to
  orig x scale instead would reflow children and over-zoom.
- html overflow is `auto` at scale >= 1 (root native scroll area active) and
  `hidden` below 1x; body overflow becomes `visible` while active and is
  restored on dispose. Wrapper is out-of-flow (absolute, top/left 0, origin
  0 0) so the page layout inside it never reflows.
- Letterbox: at scale < 1 the html background is set to the page's computed
  background so the bands paint to the viewport edges; screenshot pixel probes
  assert the band colour, and layout geometry is asserted unchanged.
- Idempotency: `apply()` detects an existing wrapper and reconfigures it
  instead of double-wrapping; instance-safe. `dispose()` restores the
  original tree and inline styles.

Headless-shell caveats (environment, not product bugs; noted in tests):
root-scroller wheel/keyboard input and CDP touch events are ignored by
headless shell, so wheel is exercised on the page's own scroll region,
keyboard via native focus-driven scroll-into-view, and touch/scrollbar via a
CDP scroll gesture (`Input.synthesizeScrollGesture`). The fixture's inner
scroller sets `overscroll-behavior: contain`, which traps gestures at its
edge; the test lets it overflow (like an ordinary scrollable pod) so a
continued gesture chains onto the scaled root scroller.
