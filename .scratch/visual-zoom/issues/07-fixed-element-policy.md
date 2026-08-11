# 07 — Fixed-element policy

**What to build:** The user-configurable fixed-element policy deciding how `position: fixed`/`sticky` elements behave under zoom. Three modes: scale-everything (default — everything scales together), protect-modals (modals stay viewport-anchored at 1× so dialogs remain usable while the rest of the page zooms), and protect-sticky-too (sticky headers/navs also stay viewport-anchored). Protected elements are excluded from the scale transform via live tracking, so elements appearing after zoom (SPA-rendered modals, dynamic sticky elements) are caught too. The policy applies globally or per-site from the settings surfaces.

**Blocked by:** 06 — Settings, options page, per-site behavior, crisp-text escape hatch.

**Status:** ready-for-agent

- [ ] Browser automation on the fixture asserts each mode behaves correctly: scale-everything zooms fixed elements with the page; protect-modals keeps an open modal viewport-anchored at 1× while the rest scales; protect-sticky-too additionally anchors the sticky nav.
- [ ] An element that becomes fixed/modal after the page is already zoomed is tracked live and protected when the active policy calls for it.
- [ ] Setting the policy globally in the options page affects all sites; setting it per-site overrides the global default for that site only.
- [ ] Protected elements remain interactive and correctly viewport-anchored while the page pans under zoom (scaled scroll area still reaches the overflow around them).
- [ ] Switching modes live (without reload) applies the new behavior immediately.
