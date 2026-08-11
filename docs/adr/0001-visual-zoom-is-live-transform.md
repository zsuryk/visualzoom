# 0001: Visual zoom scales live rendered pixels, it never reflows

Visual zoom applies a live `transform: scale()` to the already-rendered page, so the browser's compositor scales the rasterized pixels rather than recalculating CSS dimensions. The page stays live and interactive. Re-rendering (reflow at the settled scale) is only ever used behind an explicit per-site opt-in — the crisp-text escape hatch.

The alternative was re-rendering at every settled scale, which is what native browser zoom does and which breaks complex layouts — the exact failure visual zoom exists to avoid.
