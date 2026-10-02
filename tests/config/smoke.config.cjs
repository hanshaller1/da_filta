const config = require('../../playwright.config.js');
const path = require('node:path');

module.exports = {
  ...config,
  grep: /@smoke\b/,
  outputDir: path.resolve(__dirname, '../artifacts/test-results/smoke')
};
