const config = require('../../playwright.config.js');
const path = require('node:path');

module.exports = {
  ...config,
  grep: /@quarantine\b/,
  grepInvert: undefined,
  outputDir: path.resolve(__dirname, '../artifacts/test-results/quarantine')
};
