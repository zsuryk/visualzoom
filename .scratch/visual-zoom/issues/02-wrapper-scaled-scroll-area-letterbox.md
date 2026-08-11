# 02 — Wrapper, scaled scroll area, letterbox bands

**What to build:** The content-script module that performs whole-page visual zoom on the fixture: it moves all of the body's children into an injected wrapper container, applies a live `transform: scale()` to it, and sets the wrapper's layout box to the original dimensions × scale so the browser's native scroll area (scrollbars, wheel, keys, touch) still reaches the parts of a zoomed-in page that visually overflow the viewport. When zoomed out below 1×, only the page background stretches to the viewport edges; content geometry stays untouched.

**Blocked by:** 01 — Native-zoom-breaking fixture page.

**Status:** ready-for-agent

- [ ] Browser automation loads the fixture, injects the content-script module, and asserts that at a scale > 1 the scaled scroll area reaches the page's overflow (scrolling to the bottom/right lands past the viewport-visible region).
- [ ] Native scrolling still works while zoomed: wheel, keyboard scrolling, and touch/scrollbar input reach the zoomed overflow.
- [ ] At a scale < 1, the letterbox bands around the page show the page background stretched to the viewport edges rather than blank space, with content geometry unchanged.
- [ ] Scale stepping, scale clamping, scaled-dimensions math, and letterbox geometry are covered by deterministic pure-math unit tests.
- [ ] The wrapper is idempotent: applying the module twice (or re-running it after navigation) does not double-wrap the page.
