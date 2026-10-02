const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const p = require('./helpers/dsp-performance.cjs');

test('P2 baseline costs and hotpath profile use the actual processor classes', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await p.loadHarnesses(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  const report = await page.evaluate(({ features, cores }) => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES], qs = [...window.Filterbank.BAND_QS];
    const timings = [], counts = [], input = [];
    const median = rows => rows.sort((a, b) => a - b)[Math.floor(rows.length / 2)];
    function bench(Harness, rate, config, part) {
      const h = new Harness(rate, config, frequencies, qs);
      for (let b = 0; b < 96; b++) h.process(part);
      const samples = [];
      for (let repeat = 0; repeat < 5; repeat++) { const start = performance.now(); for (let b = 0; b < 128; b++) h.process(part); samples.push((performance.now() - start) / 128); }
      return { medianMs: median(samples), minMs: samples[0], maxMs: samples.at(-1), samples };
    }
    for (const rate of [48000, 96000]) for (const config of features) {
      const before = bench(window.p2Before.Harness, rate, config, 'graph');
      const after = bench(window.p2After.Harness, rate, config, 'graph');
      timings.push({ rate, name: config.name, before, after });
    }
    for (const config of cores) for (const rate of config.rates) {
      const before = bench(window.p2Before.Harness, rate, config, 'bank');
      const after = bench(window.p2After.Harness, rate, config, 'bank');
      timings.push({ rate, name: config.name, part: 'bank', before, after });
    }
    for (const rate of [48000, 96000]) for (const stage of ['linear', 'tape', 'tube', 'crunch', 'destroy']) for (const amount of [0, 1]) {
      for (const transition of [false, true]) {
        const versions = [];
        for (const Module of [window.p2Before, window.p2After]) {
          const h = new Module.Harness(rate, { stage: transition ? stage === 'linear' ? 'tape' : 'linear' : stage, amount }, frequencies, qs);
          for (let b = 0; b < 96; b++) h.process('input');
          if (transition) h.input.handleMessage({ type: 'set-input-stage', value: stage });
          const phases = { steady: [], warm: [], fade: [] };
          for (let b = 0; b < 160; b++) {
            const phase = h.input.target ? h.input.warmFrames > 0 ? 'warm' : 'fade' : transition && b === 0 ? 'warm' : 'steady';
            const start = performance.now(); h.process('input'); phases[phase].push(performance.now() - start);
          }
          versions.push(Object.fromEntries(Object.entries(phases).map(([phase, data]) => [phase, { blocks: data.length, totalMs: data.reduce((a, b) => a + b, 0), meanMs: data.length ? data.reduce((a, b) => a + b, 0) / data.length : 0 }])));
        }
        input.push({ rate, stage, amount, transition, before: versions[0], after: versions[1] });
      }
    }
    for (const config of features) {
      const h = new window.p2After.Harness(96000, config, frequencies, qs), calls = {};
      for (const name of ['updateModulationTargets', 'setEffectiveDynamicEqTimes', 'refreshBandModulationOffsets', 'mainPostGainFeedbackWeight', 'applyMainCommonBusSaturation', 'updateDynamicEq', 'solveZdfReturn', 'solveZdfPerBandCoupledReturns']) {
        const original = h.bank[name]; h.bank[name] = function (...args) { calls[name] = (calls[name] || 0) + 1; return original.apply(this, args); };
      }
      for (let b = 0; b < 64; b++) h.process();
      counts.push({ name: config.name, blocks: 64, calls, messages: h.messages });
    }
    return { timings, input, counts };
  }, { features: p.featureCases(), cores: p.coreCases() });
  // Timing runs are uninstrumented. Collect the CPU profile separately.
  await cdp.send('Profiler.start');
  await page.evaluate(() => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES], qs = [...window.Filterbank.BAND_QS];
    for (const config of [{}, { dynamicEq: true }, { stage: 'destroy', bands: 5, main: true, resonance: .6 },
      { core: 'zdf-per-band', bands: 10, main: true, resonance: .7 }, { diagnostics: true, nonlinearDiagnostics: true, topology: 'isolated-tpt', bands: 2, resonance: .7 }]) {
      const h = new window.p2After.Harness(96000, config, frequencies, qs);
      for (let i = 0; i < 1024; i++) h.process();
    }
  });
  const { profile } = await cdp.send('Profiler.stop');
  const samples = new Map();
  for (const node of profile.nodes) samples.set(node.id, { name: node.callFrame.functionName || '(anonymous)', url: node.callFrame.url, hits: 0 });
  for (const id of profile.samples || []) if (samples.has(id)) samples.get(id).hits++;
  report.profile = [...samples.values()].filter(row => row.hits).sort((a, b) => b.hits - a.hits).slice(0, 24);
  report.environment = { base: p.BASE_REVISION, browser: browser.version(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, memoryGiB: os.totalmem() / 2 ** 30 };
  expect(report.timings.length).toBeGreaterThan(90);
  fs.writeFileSync(test.info().outputPath('p2-costs.json'), JSON.stringify(report, null, 2));
  console.log('P2_HOTPATH=' + JSON.stringify({ environment: report.environment, top: report.profile.slice(0, 12), counts: report.counts.slice(0, 5), summary: report.timings.filter(row => ['idle', 'filterbank', 'heavy', 'worst'].includes(row.name)) }));
});

test('P2 native production graph quantifies callback budget and finite output', async ({ page }) => {
  test.setTimeout(180_000);
  const features = p.featureCases().filter(row => !['diagnostics-nonlinear', 'safety-telemetry'].includes(row.name));
  let cases = [48000, 96000].flatMap(rate => features.map(config => ({ ...config, rate })));
  cases.push(...['tube->destroy', 'destroy->tube'].map(stage => ({ name: 'heavy-transition', stage, rate: 96000, dynamicEq: true, bands: 5, main: true, resonance: .6 })));
  if (process.env.P2_NATIVE_INPUT === '1') cases = [48000, 96000].flatMap(rate =>
    ['linear', 'tape', 'tube', 'crunch', 'destroy'].flatMap(target => [0, 1].flatMap(amount => [false, true].map(transition => ({
      rate, amount, name: `input-${target}/${amount}/${transition ? 'transition' : 'steady'}`,
      stage: transition ? `${target === 'linear' ? 'tape' : 'linear'}->${target}` : target
    })))));
  const runs = [];
  if (process.env.P2_NATIVE_PAIRED === '1') {
    const selected = cases.filter(row => row.rate === 96000 && ['filterbank', 'tube', 'destroy', 'heavy', 'per-band', 'diagnostics-linear', 'heavy-transition'].includes(row.name));
    for (let round = 0; round < 3; round++) for (const baseline of round % 2 ? [false, true] : [true, false]) {
      runs.push({ round, ...await p.measureNative(page, selected, { baseline }) });
    }
  } else runs.push(await p.measureNative(page, cases, { baseline: process.env.P2_NATIVE_BASELINE === '1' }));
  for (const run of runs) for (const row of run.live) { expect(row.actualRate).toBe(row.rate); expect(row.processorErrors).toBe(0); expect(row.finite).toBe(true); expect(row.reads).toBeGreaterThan(0); }
  const report = runs.length === 1 ? runs[0] : { runs };
  fs.writeFileSync(test.info().outputPath('p2-native.json'), JSON.stringify(report, null, 2));
  console.log('P2_NATIVE=' + JSON.stringify(runs.map(run => ({ baseline: run.baseline, cases: run.live.length,
    nativeRender: run.nativeRender.filter(row => ['idle', 'filterbank', 'heavy', 'worst'].includes(row.stage) || row.stage.startsWith('heavy-transition')) }))));
});

test('P2 paired production timings, allocation sampling and empty route gating', async ({ page }) => {
  test.setTimeout(120_000);
  await p.loadHarnesses(page);
  const report = await page.evaluate(() => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES], qs = [...window.Filterbank.BAND_QS], rows = [];
    for (const name of ['empty-routes', 'main', 'destroy', 'tube']) for (const rate of [48000, 96000]) {
      const part = ['empty-routes', 'main'].includes(name) ? 'bank' : 'input';
      const config = name === 'main' ? { bands: 5, main: true, resonance: .7 }
        : name === 'destroy' ? { stage: 'destroy' } : name === 'tube' ? { stage: 'tube' } : {};
      const old = new window.p2Before.Harness(rate, config, frequencies, qs), next = new window.p2After.Harness(rate, config, frequencies, qs);
      let maximum = 0;
      for (let block = 0; block < 256; block++) {
        const a = old.process(part), b = next.process(part);
        for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) maximum = Math.max(maximum, Math.abs(a[c][i] - b[c][i]));
      }
      const before = [], after = [];
      for (let repeat = 0; repeat < 7; repeat++) for (const [h, data] of [[old, before], [next, after]]) {
        const start = performance.now(); for (let block = 0; block < 512; block++) h.process(part); data.push((performance.now() - start) / 512);
      }
      rows.push({ name, rate, maximum, before, after });
    }
    const gating = [0, 12].map(lfo => {
      return [window.p2Before, window.p2After].map(Module => {
        const h = new Module.Harness(96000, { lfo }, frequencies, qs); let calls = 0;
        const original = h.bank.updateModulationTargets;
        h.bank.updateModulationTargets = function () { calls++; return original.call(this); };
        for (let i = 0; i < 64; i++) h.process('bank');
        return { calls, beat: h.bank.clockCore.beatPosition, phases: h.bank.lfoSources.map(x => x.phase) };
      });
    });
    return { rows, gating };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  report.allocations = {};
  for (const variant of ['baseline', 'current']) {
    await page.evaluate(variant => {
      const Module = variant === 'baseline' ? window.p2Before : window.p2After;
      window.p2AllocationHarness = new Module.Harness(96000, { bands: 5, main: true, resonance: .7, lfo: 12 }, [...window.Filterbank.BAND_FREQUENCIES], [...window.Filterbank.BAND_QS]);
      for (let i = 0; i < 256; i++) window.p2AllocationHarness.process();
    }, variant);
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    await page.evaluate(() => { for (let i = 0; i < 1024; i++) window.p2AllocationHarness.process(); });
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const allocations = [];
    const collect = node => { if (node.selfSize) allocations.push({ name: node.callFrame.functionName, url: node.callFrame.url, bytes: node.selfSize }); for (const child of node.children) collect(child); };
    collect(profile.head); report.allocations[variant] = allocations.sort((a, b) => b.bytes - a.bytes);
  }
  for (const row of report.rows) expect(row.maximum).toBe(0);
  expect(report.gating[0][0].calls).toBe(256); expect(report.gating[0][1].calls).toBe(0);
  expect(report.gating[1][0].calls).toBe(256); expect(report.gating[1][1].calls).toBe(256);
  for (const [before, after] of report.gating) { expect(after.beat).toBe(before.beat); expect(after.phases).toEqual(before.phases); }
  fs.writeFileSync(test.info().outputPath('p2-paired.json'), JSON.stringify(report, null, 2));
  const median = data => [...data].sort((a, b) => a - b)[Math.floor(data.length / 2)];
  console.log('P2_PAIRED=' + JSON.stringify({ rows: report.rows.map(row => ({ name: row.name, rate: row.rate, maximum: row.maximum,
    beforeMs: median(row.before), afterMs: median(row.after) })), gating: report.gating,
    allocations: Object.fromEntries(Object.entries(report.allocations).map(([name, data]) => [name, data.slice(0, 5)])) }));
});

test('P2 changes preserve P1-C audio, solver and continuous source state at all rates', async ({ page }) => {
  test.setTimeout(240_000);
  await p.loadHarnesses(page);
  const rows = await page.evaluate(({ features, cores }) => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES], qs = [...window.Filterbank.BAND_QS];
    const configs = features.flatMap(config => [44100, 48000, 96000].map(rate => ({ ...config, rate, part: 'graph' })))
      .concat(cores.flatMap(config => config.rates.map(rate => ({ ...config, rate, part: 'bank' }))));
    const plain = value => ArrayBuffer.isView(value) ? Array.from(value)
      : Array.isArray(value) ? value.map(plain) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)])) : value;
    function state(h) {
      const keys = ['deltaGains', 'feedbackGates', 'feedbackReturns', 'localFeedbackReturns', 'commonFeedbackReturns', 'mainCommonFeedbackReturns',
        'mainCommonSaturationOutputs', 'zdfReturn', 'zdfLocalReturn', 'zdfMainReturn', 'zdfPerBandLocalReturns', 'zdfPerBandMainReturns',
        'zdfSolverIterations', 'zdfSolverResidual', 'zdfPerBandCoupledIterations', 'zdfPerBandCoupledResiduals', 'modulationBandGains',
        'modulationBandOffsetsDbSmoothed', 'preDynamicSmoothedDb', 'dynamicEqGainByChannel', 'dynamicEqEnergyByChannel', 'effectiveDryWet'];
      return { bank: Object.fromEntries(keys.map(key => [key, plain(h.bank[key])])),
        filters: ['left', 'right'].map(channel => h.bank.baseFilters[channel].map(f => [f.ic1eq, f.ic2eq, f.frequency, f.a1, f.a2, f.a3])),
        tube: [Array.from(h.input.tubePreviousInput), Array.from(h.input.tubePreviousOutput)],
        character: [h.input.active.index, h.input.target?.index, h.input.warmFrames, h.input.stageCrossfade, h.input.characterAmount],
        clock: [h.bank.clockCore.beatPosition, h.bank.clockCore.midiBeatPosition, h.bank.clockMod.currentBand,
          Array.from(h.bank.clockMod.heldLeft), Array.from(h.bank.clockMod.heldRight)],
        lfo: h.bank.lfoSources.map(x => [x.phase, x.phaseFrameCounter, x.sampleValue, x.randomState]),
        envelope: h.bank.envelopeSources.map(x => [x.value, x.rawLevel, x.rmsEnergy, x.rmsWindowIndex, x.delayRemainingSamples]),
        messages: h.messages, lastMessage: plain(h.lastMessage) };
    }
    function solverMetrics(h) {
      const counter = () => ({ calls: 0, active: 0, iterations: 0, maxIterations: 0, maxResidual: 0 });
      const metrics = { calls: 0, activeScalarSolves: 0, iterations: 0, maxIterations: 0, maxResidual: 0,
        unified: counter(), local: counter(), coupled: { ...counter(), activeVariables: 0, acceptedNewtonSteps: 0, maxAcceptedNewtonSteps: 0 } };
      for (const method of ['solveZdfReturn', 'solveZdfPerBandLocalReturns', 'solveZdfPerBandCoupledReturns']) {
        const original = h.bank[method];
        h.bank[method] = function (source, channel, gate) {
          const coupledFallbackBefore = this.zdfPerBandCoupledFallbackCounts[channel];
          const result = original.call(this, source, channel, gate); metrics.calls++;
          const detail = method === 'solveZdfReturn' ? metrics.unified : method === 'solveZdfPerBandLocalReturns' ? metrics.local : metrics.coupled;
          detail.calls++;
          const add = (iterations, residual) => {
            detail.active += iterations > 0; detail.iterations += iterations;
            detail.maxIterations = Math.max(detail.maxIterations, iterations); detail.maxResidual = Math.max(detail.maxResidual, residual);
          };
          if (method === 'solveZdfReturn') {
            const iterations = this.zdfSolverIterations[channel]; metrics.activeScalarSolves += iterations > 0;
            metrics.iterations += iterations; metrics.maxIterations = Math.max(metrics.maxIterations, iterations);
            metrics.maxResidual = Math.max(metrics.maxResidual, this.zdfSolverResidual[channel]);
            add(iterations, this.zdfSolverResidual[channel]);
          } else if (method === 'solveZdfPerBandCoupledReturns') {
            metrics.iterations += this.zdfPerBandCoupledIterations[channel]; metrics.maxIterations = Math.max(metrics.maxIterations, this.zdfPerBandCoupledIterations[channel]);
            metrics.maxResidual = Math.max(metrics.maxResidual, this.zdfPerBandCoupledResiduals[channel]);
            metrics.activeScalarSolves += this.zdfPerBandWorkspaces[channel].activeCount;
            add(this.zdfPerBandCoupledIterations[channel], this.zdfPerBandCoupledResiduals[channel]);
            detail.activeVariables += this.zdfPerBandWorkspaces[channel].activeCount + 1;
            // The published coupled counter includes +1 on convergence.
            // Count accepted outer Newton steps separately, excluding nested
            // fallback iterations and rejected backtracking candidates.
            const steps = this.zdfPerBandCoupledIterations[channel]
              - (this.zdfPerBandCoupledFallbackCounts[channel] === coupledFallbackBefore ? 1 : 0);
            detail.acceptedNewtonSteps += Math.max(0, steps);
            detail.maxAcceptedNewtonSteps = Math.max(detail.maxAcceptedNewtonSteps, steps);
          } else for (let band = 0; band < 10; band++) {
            const iterations = this.zdfPerBandSolverIterations[channel][band]; metrics.activeScalarSolves += iterations > 0;
            metrics.iterations += iterations; metrics.maxIterations = Math.max(metrics.maxIterations, iterations);
            metrics.maxResidual = Math.max(metrics.maxResidual, this.zdfPerBandSolverResiduals[channel][band]);
            add(iterations, this.zdfPerBandSolverResiduals[channel][band]);
          }
          return result;
        };
      }
      return metrics;
    }
    return configs.map(config => {
      const old = new window.p2Before.Harness(config.rate, config, frequencies, qs), next = new window.p2After.Harness(config.rate, config, frequencies, qs);
      const beforeSolver = solverMetrics(old), afterSolver = solverMetrics(next);
      let maximum = 0, squareDifference = 0, peak = 0, finite = true, tailEnergy = 0;
      const blocks = config.part === 'bank' ? 128 : 256;
      for (let block = 0; block < blocks; block++) {
        for (const h of [old, next]) {
          for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) h.samples[c][i] = block > blocks * .75 ? 0
            : .15 * Math.sin((block * 128 + i) * .19 + c * .27) + (block === 0 && i === 32 ? (c ? -3 : 12) : 0);
          if (config.part === 'graph') {
            if (block === 8) h.input.handleMessage({ type: 'set-input-stage', value: 'destroy' });
            if (block === 10) h.input.handleMessage({ type: 'set-input-stage', value: 'crunch' });
            if (block === 12) h.input.handleMessage({ type: 'set-input-stage', value: 'tube' });
            if (block === 128) h.input.handleMessage({ type: 'set-character-amount', value: 0 });
            if (block === 160) h.input.handleMessage({ type: 'set-character-amount', value: 1 });
            if (block === 192) h.bank.setBandControl('left', 2, -40);
          }
        }
        const a = old.process(config.part), b = next.process(config.part);
        for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) {
          const delta = a[c][i] - b[c][i]; maximum = Math.max(maximum, Math.abs(delta)); squareDifference += delta * delta;
          finite &&= Number.isFinite(b[c][i]); peak = Math.max(peak, Math.abs(b[c][i]));
          if (block > blocks * .75) tailEnergy += b[c][i] ** 2;
        }
      }
      const finalState = state(next);
      delete finalState.lastMessage;
      const allFinite = value => typeof value === 'number' ? Number.isFinite(value) : value && typeof value === 'object' ? Object.values(value).every(allFinite) : true;
      return { name: config.name, rate: config.rate, maximum, rmsDifference: Math.sqrt(squareDifference / (blocks * 256)), finite, stateFinite: allFinite(finalState), peak, tailEnergy,
        stateEqual: JSON.stringify(state(old)) === JSON.stringify(state(next)), beforeSolver, afterSolver,
        fallback: plain(next.bank.zdfSolverFallbackCount), perBandFallback: plain(next.bank.zdfPerBandSolverFallbackCounts),
        coupledFallback: plain(next.bank.zdfPerBandCoupledFallbackCounts), resets: plain(next.bank.zdfNonFiniteResetCount) };
    });
  }, { features: p.featureCases(), cores: p.coreCases() });
  fs.writeFileSync(test.info().outputPath('p2-parity.json'), JSON.stringify(rows, null, 2));
  expect(rows.filter(row => row.maximum !== 0 || !row.stateEqual || !row.finite || !row.stateFinite), 'audio/state parity failures').toEqual([]);
  for (const row of rows) { expect(row.rmsDifference).toBe(0); expect(row.afterSolver).toEqual(row.beforeSolver); }
  console.log('P2_PARITY=' + JSON.stringify({ cases: rows.length, maximum: Math.max(...rows.map(row => row.maximum)), stateEqual: rows.every(row => row.stateEqual) }));
});

test('P2 redundant parameter traffic preserves constructor, restore, panic and events', async ({ page }) => {
  test.setTimeout(60_000);
  await p.loadHarnesses(page);
  await page.evaluate(code => {
    const current = window.Filterbank; new Function(code)(); window.p2BaselineFilterbank = window.Filterbank; window.Filterbank = current;
  }, p.source('filterbank.js', true));
  const report = await page.evaluate(async () => {
    const context = { createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; } };
    const NativeNode = window.AudioWorkletNode;
    const rows = [];
    try {
      for (const Class of [window.p2BaselineFilterbank, window.Filterbank]) {
        window.AudioWorkletNode = class { constructor(_context, _name, options) { this.options = options; this.messages = []; this.port = { postMessage: value => this.messages.push(structuredClone(value)), close() {} }; } connect() {} disconnect() {} };
        const engine = new window.AudioEngine({}); engine.filterbank = new Class(context, engine.getFilterbankState());
        const node = engine.filterbank.workletNode; const start = performance.now();
        for (let i = 0; i < 100; i++) { engine.applyEffectiveBandGains(); engine.applyEffectiveFeedbackState(); }
        rows.push({ messages: node.messages.length, elapsedMs: performance.now() - start,
          counts: Object.fromEntries([...new Set(node.messages.map(m => m.type))].map(type => [type, node.messages.filter(m => m.type === type).length])) });
      }
      const wrapper = new window.Filterbank(context, { feedbackBandLeft: [true], feedbackAllRight: true, preDynamicGainDbLeft: Array(10).fill(2) });
      const node = wrapper.workletNode, initial = structuredClone(node.options.processorOptions);
      wrapper.setBandFeedback('left', 0, true); wrapper.setFeedbackAll('right', true); wrapper.setPreDynamicGainDb(0, 2, 0);
      const initialRepeatMessages = node.messages.length;
      wrapper.setBandFeedback('left', 0, false); wrapper.setFeedbackAll('right', false); wrapper.setPreDynamicGainDb(0, -3, 4);
      const changed = node.messages.slice();
      const snapshot = { feedbackBandLeft: [true], feedbackAllRight: true, preDynamicGainDbLeft: Array(10).fill(2) };
      wrapper.applyState(snapshot); wrapper.applyState(snapshot);
      wrapper.setBandFeedback('left', 0, true); wrapper.setFeedbackAll('right', true); wrapper.setPreDynamicGainDb(0, 2, 0);
      const restoreMessages = node.messages.slice(changed.length);
      wrapper.panic(); wrapper.setBandFeedback('left', 0, true); wrapper.setFeedbackAll('right', true);
      const panicMessages = node.messages.slice(changed.length + restoreMessages.length);
      wrapper.setPreDynamicGainDb(1, -0, 0); wrapper.setPreDynamicGainDb(1, -0, 0); wrapper.setPreDynamicGainDb(1, 0, 0);
      wrapper.resetLfoPhase('lfo.1'); wrapper.resetLfoPhase('lfo.1');
      wrapper.sendClockTransport('start'); wrapper.sendClockTransport('start');
      const events = node.messages.slice(changed.length + restoreMessages.length + panicMessages.length);
      wrapper.dispose(); const disposedCount = node.messages.length;
      wrapper.setBandFeedback('left', 0, false); wrapper.setFeedbackAll('right', false); wrapper.applyState(snapshot);
      rows.contract = { initial, initialRepeatMessages, changed, restoreMessages, panicMessages, events, disposedCount, afterDispose: node.messages.length };

      // Use native MessagePort structured clones as well as the deterministic
      // collector above. No assertion depends on elapsed wall-clock time.
      rows.nativePort = [];
      for (const Class of [window.p2BaselineFilterbank, window.Filterbank]) {
        const channel = new MessageChannel(); let received = 0, resolveDrain;
        channel.port2.onmessage = event => { if (event.data === 'drain') resolveDrain(); else received++; };
        window.AudioWorkletNode = class { constructor() { this.port = channel.port1; } connect() {} disconnect() {} };
        const engine = new window.AudioEngine({}); engine.filterbank = new Class(context, engine.getFilterbankState());
        const senderMs = [];
        for (let repeat = 0; repeat < 7; repeat++) {
          const start = performance.now();
          for (let i = 0; i < 100; i++) { engine.applyEffectiveBandGains(); engine.applyEffectiveFeedbackState(); }
          senderMs.push(performance.now() - start);
          const drained = new Promise(resolve => { resolveDrain = resolve; }); channel.port1.postMessage('drain'); await drained;
        }
        rows.nativePort.push({ received, senderMs }); channel.port1.close(); channel.port2.close();
      }
    } finally { window.AudioWorkletNode = NativeNode; }
    return { messages: [...rows], contract: rows.contract, nativePort: rows.nativePort };
  });
  expect(report.messages.map(row => row.messages)).toEqual([5300, 2100]);
  expect(report.nativePort.map(row => row.received)).toEqual([37100, 14700]);
  const c = report.contract;
  expect(c.initial.feedbackBandLeft[0]).toBe(true); expect(c.initial.feedbackAllRight).toBe(true); expect(c.initial.preDynamicGainDbLeft[0]).toBe(2);
  expect(c.initialRepeatMessages).toBe(0);
  expect(c.changed.map(m => m.type)).toEqual(['set-band-feedback', 'set-feedback-all', 'set-pre-dynamic-gain-db']);
  expect(c.changed[0].enabled).toBe(false); expect(c.changed[1].enabled).toBe(false); expect(c.changed[2]).toMatchObject({ left: -3, right: 4 });
  expect(c.restoreMessages.map(m => m.type)).toEqual(['apply-state', 'apply-state']);
  expect(c.restoreMessages[0]).toMatchObject({ feedbackBandLeft: [true, false, false, false, false, false, false, false, false, false], feedbackAllRight: true });
  expect(c.panicMessages.map(m => m.type)).toEqual(['panic', 'set-band-feedback', 'set-feedback-all']);
  expect(c.events.map(m => m.type)).toEqual(['set-pre-dynamic-gain-db', 'set-pre-dynamic-gain-db', 'reset-lfo-phase', 'reset-lfo-phase', 'midi-clock-start', 'midi-clock-start']);
  expect(Object.is(c.events[0].left, -0)).toBe(true); expect(Object.is(c.events[1].left, 0)).toBe(true);
  expect(c.afterDispose).toBe(c.disposedCount);
  fs.writeFileSync(test.info().outputPath('p2-parameters.json'), JSON.stringify(report, null, 2));
  console.log('P2_PARAMETERS=' + JSON.stringify({ messages: report.messages, nativePort: report.nativePort, contractsPassed: true }));
});
