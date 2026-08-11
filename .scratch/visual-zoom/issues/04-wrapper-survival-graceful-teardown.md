# 04 — Wrapper survival and graceful teardown

**What to build:** What happens when the page's own scripts destroy the wrapper mid-zoom (SPA frameworks, replace-style DOM clears). The module re-applies the wrapper on navigation and on cheap-to-detect body clears, but never fights the page: if the wrapper cannot be re-established cleanly, it tears down to 1× gracefully and surfaces a notice to the user — never an observer loop or a stuck half-zoomed page.

**Blocked by:** 02 — Wrapper, scaled scroll area, letterbox bands.

**Status:** ready-for-agent

- [ ] Browser automation triggers the fixture's DOM-replacement section while zoomed and asserts the wrapper is re-applied and zoom state preserved (or restored per the re-apply path).
- [ ] When re-establishment is impossible (fixture scenario that fights the wrapper), the module tears down to exactly 1×, leaves the page in a usable state, and shows a one-time notice.
- [ ] The teardown path does not re-wrap repeatedly: no retry loop, no further mutations after the notice.
- [ ] Navigating away and back re-applies the wrapper fresh without leaking state from the previous page.
