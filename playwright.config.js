import { defineConfig } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1024, height: 768 },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory .`,
    url: `http://127.0.0.1:${PORT}/fixtures/native-zoom-breaking.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
