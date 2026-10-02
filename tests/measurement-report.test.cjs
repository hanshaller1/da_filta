const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createMeasurementReport } = require('./helpers/measurement-report.cjs');

function temporaryOutput(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'da-filta-measurements-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), parent);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test('measurement updates preserve the historical fixture and accumulate only in the active output', t => {
  const outputDir = temporaryOutput(t);
  const name = 'summary-input-character-oversampling.json';
  const baseline = path.join(__dirname, 'measurements', name);
  const original = fs.readFileSync(baseline);
  const report = createMeasurementReport(name, () => ({ project: { outputDir } }));
  const reference = JSON.parse(original);

  assert.deepEqual(report.read(), reference);
  report.update({ cleanupProbe: 1 });
  report.update({ cleanupSecondProbe: 2 });
  assert.deepEqual(report.read(), { ...reference, cleanupProbe: 1, cleanupSecondProbe: 2 });
  assert.deepEqual(fs.readFileSync(baseline), original);
  assert.ok(fs.existsSync(path.join(outputDir, 'measurements', name)));
});

test('measurement reports stay isolated when the active Playwright profile changes', t => {
  const root = temporaryOutput(t);
  let outputDir = path.join(root, 'standard');
  const report = createMeasurementReport('cleanup-probe.json', () => ({ project: { outputDir } }));
  report.write({ run: 'standard' });
  outputDir = path.join(root, 'quarantine');
  assert.deepEqual(report.read(), {});
  report.write({ run: 'quarantine' });
  outputDir = path.join(root, 'standard');
  assert.deepEqual(report.read(), { run: 'standard' });
});
