# 03 — Scale model and zoom inputs

**What to build:** All the ways a user changes the scale. The scale model clamps to 0.3×–3× and steps multiplicatively (~5% of the current scale per notch) so zoom feels even at both extremes. The zoom modifier + scrollwheel performs gesture zoom anchored under the cursor: the under-cursor pixel never drifts while everything scales around it, which requires compensating the scaled scroll area's scroll position during the gesture. Alt+Plus / Alt+Minus / Alt+0 perform zoom in, zoom out, and reset — the keyboard-only counterpart, deliberately kept off Ctrl so native browser zoom still works alongside.

**Blocked by:** 02 — Wrapper, scaled scroll area, letterbox bands.

**Status:** done

- [x] Pure-math unit tests cover: multiplicative step application, clamping to the 0.3×–3× envelope, cursor-anchor scroll compensation, and even-feeling step sizes across the whole range.
- [x] Browser automation on the fixture asserts the cursor anchor: during a modifier+wheel gesture, the pixel under the cursor stays visually fixed on screen.
- [x] Alt+Plus / Alt+Minus / Alt+0 zoom in, out, and reset on the fixture, and reset returns to exactly 1×.
- [x] Native Ctrl+wheel / Ctrl+Plus zoom is untouched: with the modifier not pressed, wheel scrolling pans the page normally and Ctrl+zoom still performs the browser's native reflow zoom.
- [x] Gesture zoom and hotkey zoom agree on the scale state (gesturing then hotkeying continues from the same scale, clamped to the envelope).

## Comments

Implemented in `src/content/visual-zoom.js` (exports `anchoredScroll` for
`@unit` tests; `@fixture` automation in `tests/zoom-inputs.spec.js`; new
`@unit` math tests added to `tests/scale-model.spec.js`). Full suite: 29
tests, all green across repeat runs.

Design notes (faithful to CONTEXT.md; observable contract per checklist):

- **Scale model**: reuses ticket 02's `MIN/MAX_SCALE` 0.3–3 envelope and
  multiplicative `STEP_FACTOR` 1.05 stepping; `anchoredScroll` is the new pure
  math — a content coordinate `p` renders at `p * scale − scroll`, so keeping
  `p` fixed across a scale change gives `(scroll + cursor) × (to/from) −
  cursor`.
- **Gesture zoom**: Alt+wheel (default modifier; native zoom doesn't claim
  Alt). Scroll-up zooms in; each ~100 px of wheel = one notch (`LINE_PX`
  line-mode and page-mode deltas are normalised). Fractional notches
  (trackpads) give smooth even-feeling multiplicative zoom. The wheel handler
  excludes Ctrl/meta so Ctrl+wheel always falls through to native zoom, and
  it only consumes the event when the scale actually changes (at a clamped
  boundary the wheel still pans). `applyScaleAnchored` writes the compensated
  scroll position onto the root scroller during the gesture.
- **Zoom hotkeys**: Alt+Plus/Alt+Minus/Alt+0 (key `'+'`/`'-'`/`'0'`; Plus is
  Shift+= or NumpadAdd), kept off Ctrl so native reflow zoom coexists. Both
  handlers share module scale state, so gesture → hotkey handoffs continue
  from the same clamped scale.
- **Lifecycle**: listeners attach in `apply()` (once, module-level flag) and
  detach in `dispose()`, matching the wrapper lifecycle.
- **Native zoom untouched**: non-interference is asserted at the DOM level —
  plain and Ctrl+wheel events are never prevented, so native panning and
  native reflow zoom proceed. (Headless shell can't perform page zoom; as in
  ticket 01, only our non-interference is observable there.)

Known limitations, deliberately out of scope (recorded for later tickets):

- **Anchor below 1×**: the cursor anchor works wherever the scaled scroll
  area can compensate (scale ≥ 1). Below 1× the root overflow is `hidden`
  (letterbox mode, ticket 02) so the compensated scroll clamps to 0 and the
  anchor can't hold; the page shrinks toward the content origin.
- **Modifier is hardcoded to Alt** (a `ZOOM_MODIFIER` constant). CONTEXT.md
  requires the modifier and hotkeys to live in persisted settings, never
  hardcoded — that's ticket 06's options/settings work; the constant is the
  single seam for it.

Pre-existing flakiness found while landing the changes:

- `tests/visual-zoom.spec.js` "keyboard scrolling reaches the zoomed
  overflow" (ticket 02) fails ~50% when run **in isolation** (clean checkout
  reproduces; full suite green). Root cause is the documented headless-shell
  quirk: root-scroller keyboard input is ignored, and the test's
  focus-driven ArrowDown scroll only lands intermittently. Owned by ticket
  02, left as-is.
