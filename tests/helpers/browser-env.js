import { homedir } from 'os';
import { existsSync } from 'fs';

// Shared by the default launchOptions in playwright.config.js and the manual
// extension launch in extension.spec.js.
export const PORT = 4173;

// The chromium build needs system libraries that some environments (e.g.
// minimal WSL) don't install.
export function chromiumLaunchOptions() {
  const libCandidates = [
    process.env.CHROMIUM_LIB_PATH,
    `${homedir()}/.local/share/chromium-libs`,
  ].filter(Boolean);
  const chromiumLibs = libCandidates.find((dir) => existsSync(dir));
  const fontsConfPath = process.env.CHROMIUM_FONTS_CONF
    || `${homedir()}/.local/share/chromium-fonts/fonts.conf`;
  const fontsConf = existsSync(fontsConfPath) ? fontsConfPath : undefined;
  if (!chromiumLibs && !fontsConf) {
    return undefined;
  }
  return {
    env: {
      ...process.env,
      ...(chromiumLibs
        ? { LD_LIBRARY_PATH: [chromiumLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
        : {}),
      ...(fontsConf ? { FONTCONFIG_FILE: fontsConf } : {}),
    },
  };
}