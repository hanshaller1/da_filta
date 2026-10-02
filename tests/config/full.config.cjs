const config = require('../../playwright.config.js');
const path = require('node:path');

module.exports = {
  ...config,
  grepInvert: undefined,
  outputDir: path.resolve(__dirname, '../artifacts/test-results/full')
};
