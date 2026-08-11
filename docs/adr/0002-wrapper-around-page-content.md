# 0002: The scale transform lives on a wrapper around the page's content

The extension moves all of `body`'s children into an injected container div, applies `transform: scale()` plus scaled layout dimensions to it, and leaves the browser's native scroll area on `<html>`/`<body>` around it.

Applied to `<html>` directly, the page's own scroll area would be the transformed thing and every `position: fixed` element would become a descendant of a transformed ancestor — viewport-anchoring would break globally and the fixed-element policy could not rescue selected elements. The wrapper keeps the fixed-element policy a local concern (move protected elements in/out of the wrapper) and keeps native scrollbars separate from our scaled machinery.

Cost: pages break under DOM wrapping in enumerable edge cases (html-level backgrounds, `body:fullscreen`, scripts that inspect `document.body.children`), which the per-site escape hatch and known-issue list absorb.
