# 04 — Wrapper survival and graceful teardown

**What to build:** What happens when the page's own scripts destroy the wrapper mid-zoom (SPA frameworks, replace-style DOM clears). The module re-applies the wrapper on navigation and on cheap-to-detect body clears, but never fights the page: if the wrapper cannot be re-established cleanly, it tears down to 1× gracefully and surfaces a notice to the user — never an observer loop or a stuck half-zoomed page.

**Blocked by:** 02 — Wrapper, scaled scroll area, letterbox bands.

**Status:** done

- [x] Browser automation triggers the fixture's DOM-replacement section while zoomed and asserts the wrapper is re-applied and zoom state preserved (or restored per the re-apply path).
- [x] When re-establishment is impossible (fixture scenario that fights the wrapper), the module tears down to exactly 1×, leaves the page in a usable state, and shows a one-time notice.
- [x] The teardown path does not re-wrap repeatedly: no retry loop, no further mutations after the notice.
- [x] Navigating away and back re-applies the wrapper fresh without leaking state from the previous page.

## Comments

Implemented in `src/content/visual-zoom.js` (exported `STABILITY_MS` for
`@unit`/`@fixture` use; `@fixture` automation in
`tests/wrapper-survival.spec.js`; two new scenario buttons on the fixture —
`#fixture-body-replace` and `#fixture-body-fight`). Full suite: 37 tests, all
green across repeat runs.

Design notes (faithful to CONTEXT.md's "Wrapper survival"; observable
contract per checklist):

- **Cheap detection**: a `MutationObserver` on `document.body` childList only
  — direct children, never the subtree — so a single mutation batch covers any
  replace-style clear, while ordinary content changes inside the wrapper never
  even notify. The observer starts on first `apply()`, stops on
  `dispose()`/teardown.
- **Re-apply path**: when the wrapper is destroyed but the page still has
  content, the module re-wraps the fresh content at the current scale and
  resets scroll to top. Original inline styles are captured once and kept
  across re-applies, so a later teardown restores the page's true original
  styles (never our own `overflow`/`background` mutations).
- **Graceful teardown**: re-establishment is impossible when the page keeps
  destroying the wrapper or when there is nothing left to wrap (empty body).
  A loss budget counts consecutive wrapper destructions; it only resets when a
  re-applied wrapper survives the full `STABILITY_MS` window, so both burst
  fighters and slower relentless ones tear down — no observer loop and no
  half-zoomed page. Teardown restores the page to exactly 1×, detaches all
  listeners, shows a one-time dismissible notice, and never touches the DOM
  again (`tornDown` + observer disconnect make it final).
- **Re-engagement**: `apply()` after a teardown re-wraps fresh, clears the
  stale notice, and re-arms the observer — the extension's enable path works
  even after a page fought the wrapper. Full navigation re-injects the module
  with fresh state, which the reload test asserts (clean wrapper at 1×, no
  leaked scroll/styles/notice).
- Empty-body clears tear down rather than wrapping a hollow shell that the
  page's later renders would bypass — the stuck half-zoomed state is avoided
  by construction.

Known limitation, deliberately bounded (the stability window is the heuristic
that distinguishes "clean re-establishment" from fighting):

- A page that destroys the wrapper on a cadence *slower* than `STABILITY_MS`
  per loss gets each wrapper counted as clean before the next strike, so it
  never exhausts the budget. That cadence is indistinguishable from a legit
  SPA re-rendering by clearing body; counting it cumulatively would wrongly
  tear down pages that merely render a few times, so the window is the agreed
  tradeoff. The 600 ms fighter (faster than the window) is covered by a test.