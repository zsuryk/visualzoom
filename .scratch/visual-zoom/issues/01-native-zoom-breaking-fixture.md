# 01 — Native-zoom-breaking fixture page

**What to build:** A permanent local test page that deliberately breaks native reflow zoom, kept forever as the deterministic regression fixture for the wrapper, scaled scroll area, and cursor anchor. It must contain a sticky nav, a fixed modal, a huge table, a canvas, an overflow-hidden body, and a section that replaces its DOM contents (React-style) on demand. With native browser zoom (Ctrl+Plus/Minus) applied, the page must visibly fall apart; with no zoom it must look like a normal complex page.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] Loading the page shows a complex layout: sticky nav, fixed modal (openable), huge scrollable table, canvas element, overflow-hidden body, and a button that swaps the DOM out via replace-style operations.
- [ ] Applying native browser zoom to the page visibly breaks at least the sticky/fixed elements (proving the page qualifies as a native-zoom-breaking fixture).
- [x] The page is deterministic and servable locally, with no external network dependencies.
- [x] Every fixture element is reachable by queryable, stable selectors/ids so browser automation can drive it.

## Comments

Implemented in `fixtures/native-zoom-breaking.html` + Playwright spec at
`tests/fixture.spec.js`. The fixture is served locally by the test harness
(`playwright.config.js` webServer via `python3 -m http.server`).

The native-zoom-breakage mechanism is genuine reflow breakage, not scripted:
the root scroll area is `overflow: hidden`, the sticky nav lives inside the
only scroll region (a real sticky context) and carries a pixel-pinned
`min-width`, and the fixed modal has a fixed `width`. Chromium's page zoom
reflows the layout viewport (shrinking CSS-px width) without re-measuring
those boxes, so the nav action button and modal edges get clipped and are
unreachable (the region clips horizontal overflow). The canvas is rasterised
once at load, so its grid degrades under zoom. Breakage is demonstrated on
zoom-in (the direction visual zoom exists for); zoom-out merely widens the
viewport and is not asserted.

Static verification done: all 16 ids unique, every inline-script element
reference resolves, no external network references, spec/config syntax OK,
fixture served over HTTP 200.

Test run status: the fixture spec `tests/fixture.spec.js` now runs green. The
WSL container lacked Chromium's system libraries and fonts; they were
installed to a user dir (`~/.local/share/chromium-libs` and
`~/.local/share/chromium-fonts`) and wired through `playwright.config.js` via
`LD_LIBRARY_PATH`/`FONTCONFIG_FILE` (only when the dirs exist). Two headless
quirks are handled in the spec: page zoom is emulated by narrowing the layout
viewport via CDP `Emulation.setDeviceMetricsOverride` (headless shell ignores
the Ctrl+= accelerator) — it reflows `window.innerWidth` ~1.8x smaller so the
pixel-pinned nav/modal break exactly as native zoom would — and the
full-viewport modal backdrop is closed before driving the DOM-replace region
so it stops intercepting clicks.
