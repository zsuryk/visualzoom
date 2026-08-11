# 03 — Scale model and zoom inputs

**What to build:** All the ways a user changes the scale. The scale model clamps to 0.3×–3× and steps multiplicatively (~5% of the current scale per notch) so zoom feels even at both extremes. The zoom modifier + scrollwheel performs gesture zoom anchored under the cursor: the under-cursor pixel never drifts while everything scales around it, which requires compensating the scaled scroll area's scroll position during the gesture. Alt+Plus / Alt+Minus / Alt+0 perform zoom in, zoom out, and reset — the keyboard-only counterpart, deliberately kept off Ctrl so native browser zoom still works alongside.

**Blocked by:** 02 — Wrapper, scaled scroll area, letterbox bands.

**Status:** ready-for-agent

- [ ] Pure-math unit tests cover: multiplicative step application, clamping to the 0.3×–3× envelope, cursor-anchor scroll compensation, and even-feeling step sizes across the whole range.
- [ ] Browser automation on the fixture asserts the cursor anchor: during a modifier+wheel gesture, the pixel under the cursor stays visually fixed on screen.
- [ ] Alt+Plus / Alt+Minus / Alt+0 zoom in, out, and reset on the fixture, and reset returns to exactly 1×.
- [ ] Native Ctrl+wheel / Ctrl+Plus zoom is untouched: with the modifier not pressed, wheel scrolling pans the page normally and Ctrl+zoom still performs the browser's native reflow zoom.
- [ ] Gesture zoom and hotkey zoom agree on the scale state (gesturing then hotkeying continues from the same scale, clamped to the envelope).
