# Visual Zoom — Extension Spec

Status: ready-for-agent

## Problem Statement

Native browser zoom (Ctrl+Plus/Minus) reflows the page — it recalculates CSS dimensions so the layout re-wraps at the new viewport size. On simple pages this works, but on complex pages (sticky navs, fixed modals, large tables, canvas-heavy dashboards, overflow-hidden layouts) the reflow breaks the layout: fixed elements stop being fixed, sticky headers overlap content, grids clip, and scroll containers behave unexpectedly.

Users want to zoom into detail (or out for overview) on these complex pages *without* the layout coming apart. A visual zoom that scales the already-rendered pixels instead of recomputing CSS promises exactly that.

## Solution

Visual Zoom is a browser extension (Chrome + Firefox, Manifest V3) that scales the page's rendered output live, keeping the layout untouched. It wraps the page content in a container, applies `transform: scale()`, and fakes a scaled scroll area so native scrolling still reaches the zoomed-in overflow. A configurable modifier (default Shift) + scrollwheel performs cursor-anchored zoom; Shift+Plus/Minus/0 handle keyboard zoom, in, out and reset; a popup provides a slider, +/−/reset and per-site toggles; an options page holds the global settings.

Zooming in accepts blurry text by design — layout fidelity is the product. Zooming out below 1× fills the letterbox bands by stretching only the page background. A per-site opt-in "crisp-text escape hatch" reflows the page when crispness matters more than fidelity. When the page's own scripts destroy the wrapper, the extension re-applies on navigation/cheap body-clears but never fights the framework — it tears down to 1× gracefully and informs the user.

## User Stories

1. As a user of a complex single-page app, I want to zoom in with my scrollwheel + modifier, so that I can inspect detail without the layout breaking.
2. As a user, I want the zoom to be anchored under my cursor, so that the point I'm pointing at stays put while everything scales around it (map-like feel).
3. As a user, I want to zoom out below 1×, so that I can get an overview of wide dashboards and large layouts.
4. As a user zoomed out below 1×, I want the letterbox bands to show the page background rather than empty white space, so that zooming out looks intentional.
5. As a keyboard-only user, I want Shift+Plus/Shift+Minus/Shift+0 for zoom in/out/reset, so that I don't need a mouse or a scrollwheel to zoom.
6. As a user, I want the zoom modifier to be configurable, so that I can pick a key that doesn't clash with my own shortcuts.
7. As a user, I want native Ctrl+wheel/Ctrl+Plus zoom to keep working, so that I can still use the browser's own reflow zoom when I want it.
8. As a user, I want a popup with a slider and +/−/reset, so that I can fine-tune the zoom level and reset without gestures.
9. As a user, I want the popup to show my current scale and per-site toggles, so that I can see what's active on the page I'm viewing.
10. As a user, I want the option to enable per-site zoom memory, so that my preferred zoom level is restored when I revisit a site.
11. As a user, I want zoom memory to be off by default, so that the extension never surprises me by re-applying an old zoom.
12. As a user, I want to configure the fixed-element policy (scale-everything / protect-modals / protect-sticky-too), so that I can choose whether fixed and sticky elements stay viewport-anchored under zoom.
13. As a user with a page that has a modal dialog, I want the modal to stay viewport-anchored when the rest of the page is zoomed, so that the dialog remains usable.
14. As a user, I want the fixed-element policy to be configurable globally or per-site, so that different sites can behave differently.
15. As a user, I want an optional per-site crisp-text reflow, so that text stays sharp on sites where I care about readability over layout fidelity.
16. As a user of a very long page, I want a one-time notice when visual zoom may be slow, so that I understand why the page is struggling rather than thinking it's broken.
17. As a user on a site that fights the wrapper, I want the extension to reset to 1× gracefully and tell me, so that I'm never left with a stuck, half-zoomed page.
18. As a user, I want a per-site disable toggle, so that I can turn visual zoom off entirely on sites where it conflicts with the page's scripts.
19. As a user, I want scrollbars, wheel scroll, keyboard scrolling, and touch scrolling to keep working while zoomed in, so that I can move around the zoomed page naturally.
20. As a user, I want the zoom range to be 0.3×–3×, so that I have a useful envelope of zoom levels.
21. As a user, I want zoom steps to feel even across the whole range, so that the zoom gesture feels natural at both extremes.

## Implementation Decisions

- **Live compositor transform over re-render** (ADR-0001): zoom applies `transform: scale()` to the rendered page; reflow is never used by default. Re-render at the settled scale exists only as the per-site crisp-text escape hatch.
- **Wrapper around page content** (ADR-0002): all of `body`'s children are moved into an injected container div; `transform: scale()` lives on the container, which keeps the page's original (unscaled) layout box; the browser's native scroll area stays on `<html>`/`<body>`.
- **Scaled scroll area**: the wrapper's scaled visual overflow feeds the native scroll area, so native scrolling reaches original dimensions × scale — the zoomed-in overflow. (The layout box is never resized to original × scale: combined with the transform that would double-scale the visuals.) Requires scroll-anchoring math so the viewport doesn't jump during the gesture.
- **Cursor anchor**: during a gesture, compensate the scaled scroll area's scroll position so the under-cursor pixel never drifts.
- **Scale model**: range 0.3×–3×; multiplicative steps of ~5% of the current scale per gesture notch (so the change is felt as an even, exponential zoom).
- **Gesture claim policy**: the extension is aggressive (works on all pages on install) but defaults its modifier to Shift (Alt is avoided because Firefox intercepts Alt+scroll for history navigation). Modifier is fully configurable.
- **Zoom hotkeys**: Shift+Plus / Shift+Minus / Shift+0 for zoom in / out / reset; like the modifier, all configurable through persisted settings.
- **Fixed-element policy**: three modes — scale-everything (default), protect-modals (modals stay viewport-anchored at 1×), protect-sticky-too. Protected elements are excluded from the transform via live tracking. Policy configurable globally or per-site.
- **Settings**: per-site zoom memory is configurable and off by default; crisp-text escape hatch is per-site opt-in; layer-budget warning triggers instrumentation to learn the real envelope. Settings shape lives in `chrome.storage`.
- **Letterbox bands**: zoom-out below 1× stretches only the page background to the viewport edges; content geometry untouched.
- **Wrapper survival**: re-apply on navigation and cheap-to-detect body clears; never fight the framework — on unresolvable destruction, tear down to 1× and surface a notice.
- **Layer budget**: when the scaled page exceeds the browser's compositor texture limit, show a one-time non-blocking warning and log telemetry.
- **Surfaces**: popup = current scale + slider, +/−/reset, per-site toggles (enable/disable, memory), link to options. Options page = modifier, hotkeys, fixed-element policy, memory default, crisp-text hatch.
- **Browsers**: Chrome + Firefox, Manifest V3 only.
- **Development order**: build the native-zoom-breaking fixture page first (kept permanently as the regression fixture), prove wrapper/scroll/anchor mechanics on it, then promote to a minimal MV3 extension.

## Testing Decisions

- Tests assert external behavior (the rendered result and observable page behavior), never implementation details like DOM structure or function internals.
- **Seam 1 — unit tests for pure math**: multiplicative scale stepping, scale clamping to 0.3×–3×, cursor-anchor scroll compensation, scaled-dimensions × scale, layer-budget limit computation. Deterministic, no browser needed.
- **Seam 2 — native-zoom-breaking fixture page driven by browser automation**: a permanent local page with sticky nav, fixed modal, huge table, canvas, overflow-hidden body, and a React-style DOM-replacement section. Automation loads it, injects the real content-script module, and asserts: wrapper survival under DOM replacement; graceful teardown when the wrapper can't be re-established; fixed-element policy modes behave correctly; cursor anchor holds the under-cursor pixel stationary during the gesture; scaled scroll area reaches the overflow of a zoomed-in page.
- **Prior art**: no existing test suite in the repo (greenfield). The two seams follow the repo's documented stance of testing through the highest seam possible.
- **Verification on real pages**: after the fixture proves the mechanics, manually sanity-check on a set of known-complex live sites before wider release.

## Out of Scope

- The mobile/touch browser extension story (platform support may not even exist for this; decide later).
- Telemetry payload details and data collection specifics.
- Native zoom interception or replacement (we deliberately coexist with Ctrl+zoom, per Q9 decision).
- Full per-site memory storage schema beyond the site → scale mapping.
- Any form of raster snapshot / screenshot-based zoom (rejected in grilling; it breaks liveness and interactivity).
- Multi-browser packaging beyond Chrome + Firefox.
- UI themes / localization / accessibility compliance beyond keyboard support.

## Further Notes

- The design was produced through a grilling session; the two ADRs (0001 visual zoom is live transform; 0002 wrapper around page content) record the hard-to-reverse architectural decisions. CONTEXT.md defines the vocabulary used throughout this spec (cursor anchor, scaled scroll area, fixed-element policy, crisp-text escape hatch, letterbox band, layer budget warning, wrapper survival, popup/options surfaces).
- First milestone is the fixture page, not the extension plumbing — the risky logic is the wrapper + scaled scroll area + anchor mechanics, and those are proven fastest on a controlled, deterministic page.
