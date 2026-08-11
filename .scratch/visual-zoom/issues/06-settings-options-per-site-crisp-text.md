# 06 — Settings, options page, per-site behavior, crisp-text escape hatch

**What to build:** The persisted settings layer and the surfaces that configure it. The settings shape lives in the browser's storage and covers: the zoom modifier, the zoom hotkeys, the per-site zoom memory default (off by default — the extension never re-applies an old zoom without explicit opt-in), the fixed-element policy default, and per-site toggles shown in the popup (enable/disable visual zoom for this site, memory for this site). The options page is the full settings surface; the popup links to it. Also the crisp-text escape hatch: an explicit per-site opt-in that reflows the page at the settled scale so text re-renders crisply, trading layout fidelity for sharpness — never on by default.

**Blocked by:** 05 — Minimal MV3 extension shell, popup, layer budget warning.

**Status:** ready-for-agent

- [ ] Changing the zoom modifier and hotkeys in the options page changes the gesture/hotkey combos live, and the new combos persist across browser restarts.
- [ ] With per-site zoom memory off (the default), revisiting a site never restores a previous scale; with it on for a site, the settled scale is restored on revisit and not applied to other sites.
- [ ] The popup shows per-site toggles for enable/disable and memory, and disabling visual zoom for a site leaves that site untouched (scale 1×, no wrapper) until re-enabled.
- [ ] Enabling the crisp-text escape hatch for a site reflows that site's page at the settled scale with crisp text; disabling it returns to the live-transform zoom at the same scale.
- [ ] Settings changes propagate from the options page to already-open tabs without a reload of the extension.
