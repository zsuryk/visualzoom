# 05 — Minimal MV3 extension shell, popup, layer budget warning

**What to build:** Promote the fixture-proven module into a real Manifest V3 extension (Chrome + Firefox): manifest, content-script wiring, and the popup surface showing the current scale with a slider and +/−/reset buttons. Also the layer budget warning: when the scaled page exceeds the browser's compositor texture limit, show a one-time non-blocking notice explaining visual zoom may be slow, and log a telemetry line.

**Blocked by:** 03 — Scale model and zoom inputs; 04 — Wrapper survival and graceful teardown.

**Status:** ready-for-agent

- [ ] Loading the unpacked extension in Chrome (and Firefox, per platform build) injects the content script on a normal page, and the popup opens showing the current scale.
- [ ] The popup slider and +/−/reset drive the page's scale end to end, and the scale readout stays in sync with gesture/hotkey zoom.
- [ ] On a page large enough to exceed the compositor texture budget, zooming in shows the one-time non-blocking layer budget notice and writes a telemetry log entry.
- [ ] The notice fires at most once per page load, and dismissing or ignoring it never blocks zoom interaction.
- [ ] Keyboard support (the Alt-combos from the zoom-inputs ticket) works unchanged inside the real extension.
