const { defineConfig } = require('playwright/test');
const path = require('node:path');

module.exports = defineConfig({
  testDir: path.join(__dirname, 'tests'),
  testMatch: '**/*.spec.js',
  outputDir: path.join(__dirname, 'tests/artifacts/test-results/standard'),
  grepInvert: /@quarantine\b/,
  reporter: 'line',
  // Native DSP timing surveys share this suite; avoid CPU-count-sized runs.
  workers: 2,
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node server.js',
    cwd: __dirname,
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 30_000
  }
});
