# 01 — Native-zoom-breaking fixture page

**What to build:** A permanent local test page that deliberately breaks native reflow zoom, kept forever as the deterministic regression fixture for the wrapper, scaled scroll area, and cursor anchor. It must contain a sticky nav, a fixed modal, a huge table, a canvas, an overflow-hidden body, and a section that replaces its DOM contents (React-style) on demand. With native browser zoom (Ctrl+Plus/Minus) applied, the page must visibly fall apart; with no zoom it must look like a normal complex page.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Loading the page shows a complex layout: sticky nav, fixed modal (openable), huge scrollable table, canvas element, overflow-hidden body, and a button that swaps the DOM out via replace-style operations.
- [ ] Applying native browser zoom to the page visibly breaks at least the sticky/fixed elements (proving the page qualifies as a native-zoom-breaking fixture).
- [ ] The page is deterministic and servable locally, with no external network dependencies.
- [ ] Every fixture element is reachable by queryable, stable selectors/ids so browser automation can drive it.
