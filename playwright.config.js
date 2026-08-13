import { defineConfig } from '@playwright/test';
import { homedir } from 'os';
import { existsSync } from 'fs';

const PORT = 4173;

// The chromium build needs system libraries that some environments
// (e.g. minimal WSL) don't install. If a directory with the .so files is
// available — via CHROMIUM_LIB_PATH or the default location below — expose
// it through LD_LIBRARY_PATH so the browser can launch.
const libCandidates = [
  process.env.CHROMIUM_LIB_PATH,
  `${homedir()}/.local/share/chromium-libs`,
].filter(Boolean);
const chromiumLibs = libCandidates.find((dir) => existsSync(dir));
const fontsConfPath = process.env.CHROMIUM_FONTS_CONF
  || `${homedir()}/.local/share/chromium-fonts/fonts.conf`;
const fontsConf = existsSync(fontsConfPath) ? fontsConfPath : undefined;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1024, height: 768 },
    launchOptions: chromiumLibs || fontsConf
      ? {
          env: {
            ...process.env,
            ...(chromiumLibs
              ? {
                  LD_LIBRARY_PATH: [chromiumLibs, process.env.LD_LIBRARY_PATH]
                    .filter(Boolean)
                    .join(':'),
                }
              : {}),
            ...(fontsConf ? { FONTCONFIG_FILE: fontsConf } : {}),
          },
        }
      : undefined,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory .`,
    url: `http://127.0.0.1:${PORT}/fixtures/native-zoom-breaking.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
