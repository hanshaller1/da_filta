const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { measureFullGraph } = require('./helpers/measure-input-character-full-graph.cjs');
const { microProfile } = require('./helpers/profile-input-character-transition.cjs');
const { compare } = require('./helpers/compare-input-character-transition.cjs');
const filename = path.join(__dirname, 'measurements/input-character-transition-performance.json');
const cases = ['linear', 'tape', 'tube', 'destroy', 'tube->destroy', 'destroy->tube', 'tape->destroy', 'destroy->tape'];
function update(value) { const report = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {}; fs.writeFileSync(filename, JSON.stringify(Object.assign(report, value), null, 2) + '\n'); }

test('profile unchanged P3B.4 before optimization: detailed constituents and native 96k render', async ({ page }) => {
  test.setTimeout(180_000);
  const current = fs.readFileSync(path.join(__dirname, 'helpers/input-character-architecture.cjs'));
  expect(current.equals(fs.readFileSync(path.join(__dirname, 'helpers/input-character-architecture-p3b4.cjs')))).toBe(true);
  const profile = await microProfile(page);
  for (const row of profile.warmHistory.filter(x => x.framesFed >= 384)) expect(row.maximum).toBe(0);
  const before = await measureFullGraph(page, { adaptive: true, cases, rates: [96000], variant: 'p3b4' });
  update({ date: new Date().toISOString(), baselineHash: createHash('sha256').update(current).digest('hex'), profile, before, historicalP3b4: JSON.parse(fs.readFileSync(path.join(__dirname, 'measurements/input-character-adaptive-oversampling.json'), 'utf8')).nativeRender });
});

for (const mode of ['shape', 'lean']) {
  test(`${mode}: numeric regression against frozen P3B.4 including handover and state`, () => {
    test.setTimeout(240_000);
    const result = compare(mode);
    const report = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {};
    update({ numeric: { ...report.numeric, [mode]: result } });
    for (const row of result.rows) { expect(row.maximum).toBe(0); expect(row.rms).toBe(0); expect(row.peakDifference).toBe(0); expect(row.bitDifferences).toBe(0); expect(row.dryMaximum).toBe(0); }
    expect(result.stateMaximum).toBe(0);
    for (const row of result.contracts) { expect(row.delay).toBe(192); expect(row.peakAt).toBe(192); expect(row.identityMaximum).toBe(0); expect(row.stereoMaximum).toBe(0); expect(row.tubeCutoffHz).toBeCloseTo(9.93772936, 5); expect(row.factor).toBe(row.stage === 'linear' ? 1 : row.rate === 96000 ? row.stage === 'destroy' ? 2 : 1 : row.stage === 'destroy' ? 4 : 2); }
    for (const row of result.controls) { expect(row.maximum).toBe(0); expect(row.stereoMaximum).toBe(0); expect(row.tubeStatePeak).toBeLessThan(3); expect(row.tubeFinal).toBeLessThan(1e-8); expect(row.dcIncreases).toBe(0); }
    for (const row of result.extremes) { expect(row.nonfinite).toBe(0); expect(row.stereo).toBe(0); }
  });
  if (mode === 'shape') test(`${mode}: native complete 96k render ablation`, async ({ page }) => {
    test.setTimeout(180_000);
    const result = await measureFullGraph(page, { adaptive: true, cases, rates: [96000], variant: mode });
    update({ shapeNative: result });
  });
}

for (const repeat of [1, 2, 3]) test(`lean: native complete 96k repeat ${repeat}`, async ({ page }) => {
  test.setTimeout(180_000);
  const result = await measureFullGraph(page, { adaptive: true, cases, rates: [96000], variant: 'lean', durationMs: 4000 });
  const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
  // Keep every run. A failed release gate is a recorded measurement, not a test retry.
  update({ optimizedRuns: [...(report.optimizedRuns || []), { repeat, date: new Date().toISOString(), variant: 'lean', durationMs: 4000,
    p99GatePassed: result.nativeRender.every(row => (row.switchWindow?.p99Ms ?? row.p99Ms) <= .7 * 128000 / row.rate), ...result }] });
});
