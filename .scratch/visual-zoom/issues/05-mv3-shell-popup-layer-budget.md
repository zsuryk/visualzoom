# 05 — Minimal MV3 extension shell, popup, layer budget warning

**What to build:** Promote the fixture-proven module into a real Manifest V3 extension (Chrome + Firefox): manifest, content-script wiring, and the popup surface showing the current scale with a slider and +/−/reset buttons. Also the layer budget warning: when the scaled page exceeds the browser's compositor texture limit, show a one-time non-blocking notice explaining visual zoom may be slow, and log a telemetry line.

**Blocked by:** 03 — Scale model and zoom inputs; 04 — Wrapper survival and graceful teardown.

**Status:** done

- [x] Loading the unpacked extension in Chrome (and Firefox, per platform build) injects the content script on a normal page, and the popup opens showing the current scale.
- [x] The popup slider and +/−/reset drive the page's scale end to end, and the scale readout stays in sync with gesture/hotkey zoom.
- [x] On a page large enough to exceed the compositor texture budget, zooming in shows the one-time non-blocking layer budget notice and writes a telemetry log entry.
- [x] The notice fires at most once per page load, and dismissing or ignoring it never blocks zoom interaction.
- [x] Keyboard support (the Alt-combos from the zoom-inputs ticket) works unchanged inside the real extension.

## Comments

Implemented as a real MV3 extension shell plus the layer budget warning. `@extension`
automation in `tests/extension.spec.js` loads the unpacked extension into the full
chromium build (`--load-extension`); `@fixture`/`@unit` coverage in
`tests/layer-budget.spec.js` and `tests/scale-model.spec.js`. Full suite: 50 tests,
green across repeat runs.

**Extension shell** (`extension/` + `manifests/` + `scripts/build.mjs`):

- The content script is the fixture-proven module (`src/content/visual-zoom.js`)
  wired by a new ESM entry (`src/content/content-script.js`). Chrome content scripts
  can't be ES modules, so `npm run build` bundles it with esbuild into
  `extension/content-script.js` and copies the target platform's manifest into
  `extension/manifest.json` (`npm run build:firefox` for the Firefox variant, which
  uses `background.scripts` + `gecko.id`). The webServer command builds before serving,
  so tests always exercise a fresh bundle.
- **Auto-apply**: the content script calls `apply()` at document_idle on every page —
  the spec's "aggressive on install" gesture-claim policy.
- **Messaging** (popup ⇄ background ⇄ content): `vz-get-state` round-trip on popup
  open; `vz-set-scale`/`vz-step` for the slider and +/−/reset; the module reports
  every scale change (`vz-scale-changed`, scale + wrapped) which the background relays
  to the open popup, so the readout/slider/active-state mirror gesture, hotkey, and
  popup zoom — including the graceful-teardown path (page unwraps to 1×, popup follows).
- **Popup** (`extension/popup.*`): current-scale readout with a linear 30–300 slider,
  +/−/reset, and a graceful "not active on this page" state with disabled controls.
  Per-site toggles and the options link are ticket 06's scope, not this ticket's.
- **Module hooks**: `createVisualZoom({ onScaleChange, onTelemetry })`. chrome.runtime
  stays out of the module (it's shared with fixture tests that run without chrome
  APIs); the content-script entry injects the chrome implementations.

**Layer budget warning** (`MAX_TEXTURE_PX` = 8192, `budgetExceeded` exported):

- Checked on every scale application: when the scaled page exceeds the per-dimension
  compositor texture budget, a one-time non-blocking toast (`visual-zoom-budget-notice`,
  shared `showToast` helper with the teardown notice) appears and a telemetry line is
  logged. In the extension the telemetry is forwarded to the background, which logs it;
  in the fixture the module logs `[visual-zoom] telemetry layer-budget-exceeded {…}`
  directly. One-shot per page load (`budgetNoticeShown`, reset on re-engage via
  `apply()`); dismissing/ignoring never intercepts zoom interaction.
- Both triggers are tested: a normal page zoomed in past the limit (module fixture —
  the native fixture is overflow-hidden, so the test flips body to visible overflow
  and appends a 6000px block before wrapping, then hotkeys past 8192), and an
  inherently huge page that exceeds at 1× (`fixtures/huge-page.html`, extension e2e
  asserting the SW console telemetry line).

**Environment notes** (for repeatability):

- The full chromium build needs NSS libs (`libsoftokn3.so`/`libfreebl3.so`) missing
  from this WSL setup; they were installed user-space into
  `~/.local/share/chromium-libs` (the same dir the playwright config already loads),
  extracted from Fedora's `nss-softokn`/`nss-softokn-freebl` packages. Without them
  the extension tests' browser FATALs at NSS init.
- Headless reports `Alt+Shift+=` as key `'='` (no keyboard layout), so — as in tickets
  02–04 — hotkeys are driven as DOM keydown events, which the isolated-world listener
  provably receives.
- Firefox has no build installed here, so the per-platform build is provided as the
  manifest variant (`build:firefox`) but only Chrome is automation-tested; Firefox
  deserves a manual smoke pass before release.
