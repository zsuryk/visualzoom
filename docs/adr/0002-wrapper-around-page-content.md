# 0002: The scale transform lives on a wrapper around the page's content

The extension moves all of `body`'s children into an injected container div, applies `transform: scale()` to it, and leaves the browser's native scroll area on `<html>`/`<body>` around it. The wrapper keeps the page's original (unscaled) layout box: the transform alone scales the pixels, and the wrapper's scaled visual overflow feeds the root scroll area, so native scrolling reaches original dimensions × scale without reflowing content. A layout box of original × scale would double-scale the visuals when combined with the transform — the reach grows through the scroll area, never through the box.

Applied to `<html>` directly, the page's own scroll area would be the transformed thing and every `position: fixed` element would become a descendant of a transformed ancestor — viewport-anchoring would break globally and the fixed-element policy could not rescue selected elements. The wrapper keeps the fixed-element policy a local concern (move protected elements in/out of the wrapper) and keeps native scrollbars separate from our scaled machinery.

Cost: pages break under DOM wrapping in enumerable edge cases (html-level backgrounds, `body:fullscreen`, scripts that inspect `document.body.children`), which the per-site escape hatch and known-issue list absorb.
