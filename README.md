# Visual Zoom

A browser extension that zooms rendered webpages by scaling pixels, not by reflowing layout.

## What it does

Native browser zoom recomputes CSS dimensions and reflows the entire layout — breaking complex pages. **Visual Zoom** scales the already-rendered output instead, preserving the original layout exactly as designed.

## Features

- **Gesture zoom**: Shift + scrollwheel to zoom in/out
- **Hotkeys**: Shift+Plus / Shift+Minus / Shift+0 for keyboard zoom
- **Per-site memory**: Optionally remember zoom level per site
- **Fixed element policy**: Configurable behavior for modals and sticky elements
- **Crisp text mode**: Optional reflow for sharp text at settled zoom
- **Zoom out**: Optional letterbox mode below 100%

## Install

### Chrome

1. Clone this repo
2. Run `npm install && npm run build`
3. Open `chrome://extensions`
4. Enable "Developer mode"
5. Click "Load unpacked" → select the `extension/` folder

### Firefox

1. Run `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on" → select `extension/manifest.json`

## Development

```bash
npm install        # Install dependencies
npm run build      # Build extension (Chrome)
npm run build:firefox  # Build extension (Firefox)
npm test           # Run tests
```

## License

MIT
