# Visual Zoom

A browser extension that zooms a rendered webpage by scaling its already-rendered pixels, rather than by recomputing CSS dimensions and reflowing the layout (which is how native browser zoom works). Native zoom breaks on complex layouts; visual zoom aims to preserve the layout as-is.

## Language

**Visual zoom**:
Zooming a webpage by scaling its rendered output on screen, keeping the underlying layout unchanged.
_Avoid_: CSS zoom, reflow zoom, layout zoom

**Whole-page zoom**:
An interaction mode where the entire page scales as one unit and remains fully interactive.
_Avoid_: Lens, magnifier, snapshot zoom

**Zoom modifier**:
The user-configurable key (e.g., Ctrl/Alt/Shift) that, combined with a gesture (e.g., scrollwheel), triggers visual zoom. Lives in persisted settings, never hardcoded. Defaults to a key the browser's native zoom doesn't already claim (Alt), so visual zoom and native reflow zoom can coexist on the same page.

## Interaction modes

**Gesture zoom**:
Visual zoom driven by the zoom modifier + scrollwheel, without leaving the page.
_Avoid_: Hotkey zoom, slider zoom

**Zoom hotkeys**:
The Alt+Plus / Alt+Minus / Alt+0 commands for zoom in, zoom out, and reset — the keyboard-only counterpart to gesture zoom, kept off Ctrl (native zoom's combos) so the two zooms coexist. Like the modifier, fully configurable in persisted settings.

**Settled zoom**:
The scale value in effect when the user stops gesturing. On zoom-in, settled text is expected to be blurry by design; layout fidelity is the product's identity.

**Cursor anchor**:
The point under the cursor that stays visually fixed on screen while the scale changes around it. Achieved by compensating the scaled scroll area's scroll position during the gesture, so the under-cursor pixel never drifts. The basis of the gesture's physical, map-like feel.

## Performance

**Layer budget warning**:
A one-time, non-blocking notice shown when the scaled page exceeds the browser's known compositor texture limit (large pages zoomed in), warning that visual zoom may be slow. Also the trigger for instrumented telemetry so the real envelope is known before release.

## Fixed elements

**Fixed-element policy**:
A user-configurable setting that decides how `position: fixed`/`sticky` elements behave under zoom. Modes: scale-everything (default), protect-modals (modals stay viewport-anchored at 1×), protect-sticky-too. Applies globally or per-site.

**Protected element**:
A fixed/sticky element the current policy excludes from the scale transform, tracked live by the extension.

## Text crispness

**Crisp-text escape hatch**:
An explicit per-site user opt-in that reflows the page at the settled scale so text re-renders crisply, trading away layout fidelity. Never on by default.

## Zoom-out

**Letterbox band**:
The dead space around the page when it's zoomed out below 1×, since visual zoom never reflows. Filled by stretching only the page's background to the viewport edges; content geometry is never touched.

## Panning

**Scaled scroll area**:
A wrapper element holding the page's content at its original (unscaled) layout box, with `transform: scale()` applied on top so the compositor scales the rendered pixels. The wrapper's scaled visual overflow feeds the browser's native scroll area, so native scrolling (scrollbars, wheel, keys, touch) reaches the page's original dimensions × the scale factor — the parts of a zoomed-in page that visually overflow the viewport. Takes over from the page's real scroll area while zoomed. (The layout box itself is never resized to original × scale: combined with the transform that would double-scale the visuals.)

## Settings

**Scale model**:
The zoom parameter set: range 0.3×–3×, multiplicative steps of ~5% per gesture notch. Applies to all zoom interactions.

**Per-site zoom memory**:
A configurable setting controlling whether the settled scale is restored when the user revisits a site. Off by default; when on, the mapping is site → scale.

**Zoom persistence**:
The act of storing and restoring the settled scale per site, governed by the per-site zoom memory setting. Never enabled without explicit user opt-in.

## Extension surfaces

**Popup**:
The quick-controls surface: current-scale readout with a slider, +/−/reset buttons, and per-site toggles (enable/disable for this site, memory for this site). Shows what's happening on the current page.

**Options page**:
The full-width settings surface for how the tool behaves globally: zoom modifier, zoom hotkeys, fixed-element policy, per-site memory default, and the crisp-text escape hatch. Popup links to it.

## Development

**Native-zoom-breaking fixture**:
A permanent local test page that deliberately breaks native reflow zoom (sticky nav, fixed modal, huge table, canvas, overflow-hidden body) and doubles as the deterministic regression fixture for the wrapper/scaled-scroll-area/anchor mechanics. Built before any extension plumbing.

## Page dynamics

**Wrapper survival**:
The extension's stance when the page's own scripts (SPA frameworks, replaceChildren calls) destroy the injected wrapper mid-zoom: re-apply on navigation and on cheap-to-detect body clears, but never fight the page — if the wrapper can't be re-established cleanly, tear down to 1× gracefully and tell the user, rather than entering an observer loop.
