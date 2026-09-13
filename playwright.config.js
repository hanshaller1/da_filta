const { defineConfig } = require('playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  outputDir: './tests/artifacts/test-results',
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npm.cmd start',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 30_000
  }
});
