const { test, expect } = require('playwright/test');

test('CURRENT remains sample-identical with an explicit CURRENT core option', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const difference = await page.evaluate(async () => {
    const render = async core => {
      const sampleRate = 48000; const length = 12000;
      const context = new OfflineAudioContext(1, length, sampleRate);
      await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
      const buffer = context.createBuffer(1, length, sampleRate);
      const input = buffer.getChannelData(0);
      for (let i = 0; i < 1500; i += 1) input[i] = 0.02 * Math.sin(2 * Math.PI * 777 * i / sampleRate);
      const options = {
        bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
        bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
        feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === 5), feedbackBandRight: Array(10).fill(false),
        feedbackAllLeft: true, feedbackAllRight: false, resonance: 1,
        feedbackTopology: 'common-bus', feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum',
        feedbackAllLevel: 'raw', wetModel: 'filterbank-sum'
      };
      if (core) options.feedbackCore = core;
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: options
      });
      const source = context.createBufferSource(); source.buffer = buffer;
      source.connect(node).connect(context.destination); source.start();
      return (await context.startRendering()).getChannelData(0);
    };
    const oldDefault = await render(null);
    const explicitCurrent = await render('current');
    let maximum = 0;
    for (let i = 0; i < oldDefault.length; i += 1) maximum = Math.max(maximum, Math.abs(oldDefault[i] - explicitCurrent[i]));
    return maximum;
  });
  expect(difference).toBe(0);
});

test('FEEDBACK CORE switches CURRENT to ZDF to CURRENT live without rebuilding the Worklet', async ({ page }) => {
  await page.addInitScript(() => {
    window.__coreNodes = [];
    const mediaDevices = navigator.mediaDevices || {};
    mediaDevices.enumerateDevices = async () => [
      { kind: 'audioinput', deviceId: 'input-1', label: 'Mock Input', groupId: 'group-1' },
      { kind: 'audiooutput', deviceId: 'output-1', label: 'Mock Output', groupId: 'group-1' }
    ];
    mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    if (!mediaDevices.addEventListener) mediaDevices.addEventListener = () => {};
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    class MockAudioWorkletNode {
      constructor(context, name, options) {
        this.name = name; this.options = options; this.messages = [];
        this.port = { postMessage: message => this.messages.push(message), close() {} };
        window.__coreNodes.push(this);
      }
      connect() {} disconnect() {}
    }
    class MockAudioContext {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.audioWorklet = { addModule: async () => {} }; }
      resume() { this.state = 'running'; return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createGain() { return { gain: { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } }, connect() {}, disconnect() {} }; }
      createMediaStreamDestination() { return { stream: new MediaStream() }; }
      close() { this.state = 'closed'; return Promise.resolve(); }
    }
    window.AudioContext = MockAudioContext;
    window.AudioWorkletNode = MockAudioWorkletNode;
    HTMLMediaElement.prototype.setSinkId = async function () {};
    HTMLMediaElement.prototype.play = async function () {};
    HTMLMediaElement.prototype.pause = function () {};
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-audio-input]').selectOption('input-1');
  await page.locator('[data-audio-output]').selectOption('output-1');
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON');
  const initial = await page.evaluate(() => window.__coreNodes.find(node => node.name === window.Filterbank.PROCESSOR_NAME).options.processorOptions.feedbackCore);
  expect(initial).toBe('current');
  await page.locator('[data-feedback-core]').selectOption('zdf');
  await expect(page.locator('[data-local-loop-tuning]')).toBeDisabled();
  const sweetspotsToggle = page.locator('[data-dev-lab-group="sweetspots"] .dev-lab-collapse-toggle');
  if (await sweetspotsToggle.getAttribute('aria-expanded') === 'false') await sweetspotsToggle.click();
  const live = await page.evaluate(() => {
    const node = window.__coreNodes.find(candidate => candidate.name === window.Filterbank.PROCESSOR_NAME);
    return { value: node.messages.at(-1), count: window.__coreNodes.length };
  });
  expect(live.value).toEqual({ type: 'set-feedback-core', value: 'zdf' });
  await page.locator('[data-sweetspot-save="A"]').click();
  await page.locator('[data-feedback-core]').selectOption('current');
  const returned = await page.evaluate(() => {
    const node = window.__coreNodes.find(candidate => candidate.name === window.Filterbank.PROCESSOR_NAME);
    return { value: node.messages.at(-1), count: window.__coreNodes.length };
  });
  expect(returned.value).toEqual({ type: 'set-feedback-core', value: 'current' });
  expect(returned.count).toBe(live.count);
  await page.locator('[data-sweetspot-load="A"]').click();
  await expect(page.locator('[data-feedback-core]')).toHaveValue('zdf');
  const loaded = await page.evaluate(() => {
    const node = window.__coreNodes.find(candidate => candidate.name === window.Filterbank.PROCESSOR_NAME);
    return { messages: node.messages, count: window.__coreNodes.length };
  });
  const loadedCoreMessages = loaded.messages.filter(message => message.type === 'set-feedback-core');
  expect(loadedCoreMessages.at(-1)).toEqual({ type: 'set-feedback-core', value: 'zdf' });
  expect(loaded.count).toBe(live.count);
});

test('signed ZDF core oscillates high bands with finite output and keeps CURRENT selectable', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const core = page.locator('[data-feedback-core]');
  await expect(core).toHaveValue('current');
  await core.selectOption('zdf');
  await expect(core).toHaveValue('zdf');

  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const renders = [];
    for (const band of [7, 8, 9]) {
      const sampleRate = 48000;
      const length = Math.round(sampleRate * 0.5);
      const context = new OfflineAudioContext(1, length, sampleRate);
      await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
      const buffer = context.createBuffer(1, length, sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < Math.round(sampleRate * 0.03); i += 1) samples[i] = 0.02 * Math.sin(2 * Math.PI * frequencies[band] * i / sampleRate);
      const packets = [];
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: {
          bandFrequencies: frequencies, bandQs: qs,
          bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
          feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === band), feedbackBandRight: Array(10).fill(false),
          feedbackAllLeft: false, feedbackAllRight: false,
          resonance: 1, feedbackTopology: 'common-bus', feedbackCore: 'zdf',
          feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum',
          wetModel: 'filterbank-sum', collectResonatorDiagnostics: true
        }
      });
      node.port.onmessage = event => { if (event.data?.type === 'resonator-diagnostics') packets.push(event.data.left); };
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(node).connect(context.destination);
      source.start();
      const output = (await context.startRendering()).getChannelData(0);
      await new Promise(resolve => setTimeout(resolve, 0));
      let peak = 0; let energy = 0; let crossings = 0;
      const start = Math.round(sampleRate * 0.35);
      for (let i = start; i < length; i += 1) {
        peak = Math.max(peak, Math.abs(output[i])); energy += output[i] ** 2;
        if (i > start && output[i - 1] <= 0 && output[i] > 0) crossings += 1;
      }
      renders.push({ band, peak, rms: Math.sqrt(energy / (length - start)), frequency: crossings / ((length - start) / sampleRate), finite: output.every(Number.isFinite), diagnostics: packets.at(-1) });
    }
    return renders;
  });
  console.log('ZDF HIGH-BAND PROBE', JSON.stringify(report.map(({ band, peak, rms, frequency, finite, diagnostics }) => ({ band, peak, rms, frequency, finite, iterations: diagnostics?.zdfSolverMaxIterations, fallbacks: diagnostics?.zdfSolverFallbackCount, residual: diagnostics?.zdfSolverResidual }))));
  for (const result of report) {
    expect(result.finite).toBe(true);
    expect(result.diagnostics.feedbackCore).toBe('zdf');
    expect(result.diagnostics.zdfSolverResidual).toBeLessThan(0.01);
  }
});

test('ZDF LOCAL LOOP EXP ignores delayed-only frequency compensation', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const result = await page.evaluate(async () => {
    const render = async localLoopTuning => {
      const sampleRate = 48000; const length = 12000;
      const context = new OfflineAudioContext(1, length, sampleRate);
      await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
      const input = context.createBuffer(1, length, sampleRate);
      const samples = input.getChannelData(0);
      for (let i = 0; i < 1500; i += 1) samples[i] = 0.02 * Math.sin(2 * Math.PI * 5200 * i / sampleRate);
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: {
          bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
          bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
          feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === 8), feedbackBandRight: Array(10).fill(false),
          feedbackAllLeft: false, feedbackAllRight: false,
          resonance: 1, feedbackTopology: 'local-loop-exp', feedbackCore: 'zdf', localLoopTuning,
          wetModel: 'filterbank-sum'
        }
      });
      const source = context.createBufferSource(); source.buffer = input;
      source.connect(node).connect(context.destination); source.start();
      return (await context.startRendering()).getChannelData(0);
    };
    const nominal = await render('current');
    const compensated = await render('compensated');
    let maxDifference = 0;
    for (let i = 0; i < nominal.length; i += 1) maxDifference = Math.max(maxDifference, Math.abs(nominal[i] - compensated[i]));
    return { maxDifference, finite: nominal.every(Number.isFinite) && compensated.every(Number.isFinite) };
  });
  expect(result.finite).toBe(true);
  expect(result.maxDifference).toBe(0);
});

test('the running Worklet switches CURRENT to ZDF without recreation', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const result = await page.evaluate(async () => {
    const sampleRate = 48000; const length = Math.round(sampleRate * 0.6);
    const context = new OfflineAudioContext(1, length, sampleRate);
    await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
    const input = context.createBuffer(1, length, sampleRate);
    const samples = input.getChannelData(0);
    for (const start of [0, 0.25]) {
      for (let i = Math.round(sampleRate * start); i < Math.round(sampleRate * (start + 0.03)); i += 1) {
        samples[i] = 0.02 * Math.sin(2 * Math.PI * 5200 * i / sampleRate);
      }
    }
    const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: {
        bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
        bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
        feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === 8), feedbackBandRight: Array(10).fill(false),
        feedbackAllLeft: false, feedbackAllRight: false,
        resonance: 1, feedbackTopology: 'common-bus', feedbackCore: 'current', wetModel: 'filterbank-sum'
      }
    });
    const source = context.createBufferSource(); source.buffer = input;
    source.connect(node).connect(context.destination); source.start();
    const switching = context.suspend(0.2).then(async () => {
      node.port.postMessage({ type: 'set-feedback-core', value: 'zdf' });
      await context.resume();
    });
    const rendering = context.startRendering(); await switching;
    const output = (await rendering).getChannelData(0);
    const frequency = (start, end) => {
      let first = null; let last = null; let count = 0;
      for (let i = Math.round(sampleRate * start) + 1; i < Math.round(sampleRate * end); i += 1) {
        if (output[i - 1] <= 0 && output[i] > 0) {
          const crossing = i - output[i - 1] / (output[i] - output[i - 1]);
          if (first === null) first = crossing;
          last = crossing; count += 1;
        }
      }
      return count > 1 ? sampleRate * (count - 1) / (last - first) : null;
    };
    return { before: frequency(0.10, 0.18), after: frequency(0.45, 0.58), finite: output.every(Number.isFinite), state: context.state };
  });
  expect(result.finite).toBe(true);
  expect(result.before).toBeGreaterThan(3500);
  expect(result.before).toBeLessThan(4800);
  expect(result.after).toBeGreaterThan(5000);
  expect(result.after).toBeLessThan(5400);
  expect(result.state).toBe('closed');
});

test('offline LOCAL self-oscillation survey across ten bands and three sample rates', async ({ page }) => {
  test.setTimeout(300000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const moduleUrl = new URL('/filterbank-processor.js', location.href);
    const rows = [];
    for (const sampleRate of [44100, 48000, 96000]) {
      const contextModules = new Map();
      for (let band = 0; band < frequencies.length; band += 1) {
        for (const core of ['current', 'zdf']) {
          const duration = band < 3 ? 1.2 : band < 5 ? 0.8 : 0.5;
          const length = Math.round(sampleRate * duration);
          const context = new OfflineAudioContext(1, length, sampleRate);
          await context.audioWorklet.addModule(moduleUrl);
          const buffer = context.createBuffer(1, length, sampleRate);
          const input = buffer.getChannelData(0);
          const burst = Math.min(0.1, Math.max(0.03, 3 / frequencies[band]));
          for (let i = 0; i < Math.round(sampleRate * burst); i += 1) input[i] = 0.02 * Math.sin(2 * Math.PI * frequencies[band] * i / sampleRate);
          const packets = [];
          const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
            processorOptions: {
              bandFrequencies: frequencies, bandQs: qs,
              bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
              feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === band), feedbackBandRight: Array(10).fill(false),
              feedbackAllLeft: false, feedbackAllRight: false,
              resonance: 1, feedbackTopology: 'common-bus', feedbackCore: core,
              feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum',
              wetModel: 'filterbank-sum', collectResonatorDiagnostics: true
            }
          });
          node.port.onmessage = event => { if (event.data?.type === 'resonator-diagnostics') packets.push(event.data.left); };
          const source = context.createBufferSource(); source.buffer = buffer;
          source.connect(node).connect(context.destination); source.start();
          const started = performance.now();
          const output = (await context.startRendering()).getChannelData(0);
          const renderMs = performance.now() - started;
          await new Promise(resolve => setTimeout(resolve, 0));
          let peak = 0; let energy = 0; let earlyEnergy = 0; let count = 0;
          let firstCrossing = null; let lastCrossing = null;
          const start = Math.round(length * 0.70);
          const earlyStart = Math.round(length * 0.25);
          const earlyEnd = Math.round(length * 0.40);
          for (let i = 0; i < length; i += 1) {
            const value = output[i];
            peak = Math.max(peak, Math.abs(value));
            if (i >= earlyStart && i < earlyEnd) earlyEnergy += value * value;
            if (i < start) continue;
            energy += value * value;
            if (i > start && output[i - 1] <= 0 && value > 0) {
              const crossing = i - output[i - 1] / (value - output[i - 1]);
              if (firstCrossing === null) firstCrossing = crossing;
              lastCrossing = crossing;
              count += 1;
            }
          }
          const rms = Math.sqrt(energy / (length - start));
          const earlyRms = Math.sqrt(earlyEnergy / (earlyEnd - earlyStart));
          const sustained = rms > 0.005 && rms >= earlyRms * 0.5;
          const measured = count >= 2 ? sampleRate * (count - 1) / (lastCrossing - firstCrossing) : null;
          const blockSize = Math.max(1, Math.round(sampleRate * 0.01));
          const blockRms = [];
          for (let first = 0; first < length; first += blockSize) {
            let blockEnergy = 0;
            const end = Math.min(length, first + blockSize);
            for (let i = first; i < end; i += 1) blockEnergy += output[i] * output[i];
            blockRms.push(Math.sqrt(blockEnergy / (end - first)));
          }
          const maximumBlockRms = Math.max(...blockRms);
          const attackBlock = blockRms.findIndex(value => value >= maximumBlockRms * 0.5);
          const lastTailBlock = blockRms.findLastIndex(value => value >= 0.005);
          const attackMs = attackBlock < 0 ? null : attackBlock * blockSize / sampleRate * 1000;
          const tailDurationMs = Math.max(0, (lastTailBlock + 1) * blockSize / sampleRate * 1000 - burst * 1000);
          rows.push({ sampleRate, band: band + 1, nominal: frequencies[band], core,
            frequency: sustained ? measured : null, rms, peak, earlyRms, sustained, attackMs, tailDurationMs,
            finite: output.every(Number.isFinite), renderMs,
            solverMaxIterations: Math.max(0, ...packets.map(packet => packet.zdfSolverMaxIterations)),
            solverAverageIterations: packets.reduce((sum, packet) => sum + packet.zdfSolverIterations, 0)
              / Math.max(1, packets.reduce((sum, packet) => sum + packet.frameCount, 0)),
            solverWorstResidual: Math.max(0, ...packets.map(packet => packet.zdfSolverResidual)),
            fallbackCount: packets.at(-1)?.zdfSolverFallbackCount ?? 0,
            nonFiniteResetCount: packets.at(-1)?.zdfNonFiniteResetCount ?? 0 });
        }
      }
    }
    return rows;
  });
  console.log('UNIFIED ZDF SURVEY', JSON.stringify(report.map(row => [row.sampleRate, row.band, row.core, row.frequency && +row.frequency.toFixed(2), +row.rms.toFixed(4), +row.peak.toFixed(4), +row.attackMs.toFixed(1), +row.tailDurationMs.toFixed(1), +row.renderMs.toFixed(1), row.solverMaxIterations, row.fallbackCount, +row.solverAverageIterations.toFixed(2), +row.solverWorstResidual.toExponential(1)])));
  expect(report).toHaveLength(60);
  for (const row of report) {
    expect(row.finite).toBe(true);
    if (row.core === 'zdf') {
      expect(row.sustained, JSON.stringify(row)).toBe(true);
      expect(Math.abs(row.frequency - row.nominal) / row.nominal, JSON.stringify(row)).toBeLessThan(0.06);
      expect(row.nonFiniteResetCount).toBe(0);
    }
  }
});

test('ZDF LOCAL, MAIN, dual, signed resonance, stereo, open tap and PANIC', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const render = async ({ local = [], main = false, resonance = 1, gain = 0, cut = 24, panic = false, core = 'zdf', level = 'sqrt10', allGain = false, drive = 1, ceiling = 1, saturation = 'current', feedbackAllAmount = 100 }) => {
      const sampleRate = 48000; const length = Math.round(sampleRate * 0.4);
      const context = new OfflineAudioContext(2, length, sampleRate);
      await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
      const input = context.createBuffer(2, length, sampleRate);
      const leftInput = input.getChannelData(0);
      for (let i = 0; i < Math.round(sampleRate * 0.03); i += 1) leftInput[i] = 0.02 * Math.sin(2 * Math.PI * 777 * i / sampleRate);
      const packets = [];
      const gains = Array(10).fill(allGain ? 100 : 0); gains[5] = gain;
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: {
          bandFrequencies: frequencies, bandQs: qs,
          bandGainLeft: gains, bandGainRight: Array(10).fill(0), maxBandCutDb: cut,
          feedbackBandLeft: Array.from({ length: 10 }, (_, index) => local.includes(index)), feedbackBandRight: Array(10).fill(false),
          feedbackAllLeft: main, feedbackAllRight: false, maxBandBoostDb: 24,
          resonance, feedbackTopology: 'common-bus', feedbackCore: core, feedbackTap: 'post-gain',
          feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum', feedbackAllLevel: level,
          feedbackAllAmount,
          commonBusSaturationMode: saturation, commonBusDrive: drive, commonBusCeiling: ceiling,
          wetModel: 'filterbank-sum', collectResonatorDiagnostics: true
        }
      });
      node.port.onmessage = event => { if (event.data?.type === 'resonator-diagnostics') packets.push(event.data.left); };
      const source = context.createBufferSource(); source.buffer = input;
      source.connect(node).connect(context.destination); source.start();
      const suspension = panic && context.suspend(0.2).then(async () => { node.port.postMessage({ type: 'panic' }); await context.resume(); });
      const rendering = context.startRendering(); if (suspension) await suspension;
      const output = await rendering;
      await new Promise(resolve => setTimeout(resolve, 0));
      const left = output.getChannelData(0); const right = output.getChannelData(1);
      let leftPeak = 0; let rightPeak = 0; let postPanicPeak = 0; let tailEnergy = 0;
      for (let i = 0; i < length; i += 1) {
        leftPeak = Math.max(leftPeak, Math.abs(left[i])); rightPeak = Math.max(rightPeak, Math.abs(right[i]));
        if (i > sampleRate * 0.25) { postPanicPeak = Math.max(postPanicPeak, Math.abs(left[i])); tailEnergy += left[i] * left[i]; }
      }
      return {
        leftPeak, rightPeak, postPanicPeak, tailRms: Math.sqrt(tailEnergy / (length - sampleRate * 0.25)),
        finite: left.every(Number.isFinite) && right.every(Number.isFinite),
        localPeak: Math.max(0, ...packets.map(packet => Math.abs(packet.zdfLocalBus))),
        mainPeak: Math.max(0, ...packets.map(packet => Math.abs(packet.zdfMainBus))),
        localReturnPeak: Math.max(0, ...packets.map(packet => Math.abs(packet.commonFeedbackReturn))),
        mainReturnPeak: Math.max(0, ...packets.map(packet => Math.abs(packet.mainCommonFeedbackReturn))),
        tapPeak: Math.max(0, ...packets.map(packet => packet.commonTapSumPeak)),
        fallbackCount: packets.at(-1)?.zdfSolverFallbackCount ?? 0,
        solverMaxIterations: Math.max(0, ...packets.map(packet => packet.zdfSolverMaxIterations)),
        solverWorstResidual: Math.max(0, ...packets.map(packet => packet.zdfSolverResidual)),
        nonFiniteResetCount: packets.at(-1)?.zdfNonFiniteResetCount ?? 0,
        dominantBaseBand: packets.at(-1)?.dominantBaseBand
      };
    };
    return {
      local: await render({ local: [5] }),
      main: await render({ main: true }),
      mainRaw: await render({ main: true, level: 'raw' }),
      dual: await render({ local: [5], main: true }),
      mainAmounts: await Promise.all([0, 1, 25, 50, 100].map(feedbackAllAmount => render({
        local: [5], main: true, feedbackAllAmount
      }))),
      multiple: await render({ local: [4, 5, 6], main: true }),
      currentMainRaw: await render({ main: true, level: 'raw', core: 'current' }),
      currentDual: await render({ local: [5], main: true, core: 'current' }),
      currentMultiple: await render({ local: [4, 5, 6], main: true, core: 'current' }),
      negativeLocal: await render({ local: [5], resonance: -1 }),
      negativeMain: await render({ main: true, resonance: -1 }),
      negativeDual: await render({ local: [5], main: true, resonance: -1 }),
      currentNegativeDual: await render({ local: [5], main: true, resonance: -1, core: 'current' }),
      neutral: await render({ local: [5], main: true, resonance: 0 }),
      panic: await render({ local: [5], main: true, panic: true }),
      stress: await render({ local: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], main: true, level: 'raw', allGain: true, gain: 100, drive: 16, ceiling: 4, saturation: 'constant-ceiling' }),
      taps: await Promise.all([0, -25, -50, -100].map(gain => render({ local: [5], resonance: 0.00001, gain })))
    };
  });
  console.log('UNIFIED ZDF SCENARIOS', JSON.stringify(report));
  for (const value of [report.local, report.main, report.mainRaw, report.dual, report.multiple, ...report.mainAmounts, report.currentMainRaw, report.currentDual, report.currentMultiple, report.negativeLocal, report.negativeMain, report.negativeDual, report.currentNegativeDual, report.neutral, report.panic, report.stress, ...report.taps]) {
    expect(value.finite).toBe(true);
    expect(value.rightPeak).toBe(0);
    expect(value.nonFiniteResetCount).toBe(0);
  }
  expect(report.local.localPeak).toBeGreaterThan(0);
  expect(report.main.mainPeak).toBeGreaterThan(0);
  expect(report.dual.localPeak).toBeGreaterThan(0);
  expect(report.dual.mainPeak).toBeGreaterThan(0);
  expect(report.mainAmounts[0].mainReturnPeak).toBe(0);
  expect(report.mainAmounts[0].localReturnPeak).toBe(report.local.localReturnPeak);
  for (const index of [1, 2, 3, 4]) expect(report.mainAmounts[index].mainReturnPeak).toBeGreaterThan(1e-8);
  expect(report.mainAmounts[4].mainReturnPeak).toBe(report.dual.mainReturnPeak);
  expect(report.multiple.localPeak).toBeGreaterThan(0);
  expect(report.multiple.mainPeak).toBeGreaterThan(0);
  expect(report.negativeDual.localPeak).toBeGreaterThan(0);
  expect(report.negativeDual.mainPeak).toBeGreaterThan(0);
  expect(report.neutral.tailRms).toBeLessThan(0.01);
  expect(report.panic.postPanicPeak).toBeLessThan(1e-5);
  expect(report.stress.solverMaxIterations).toBeLessThanOrEqual(6);
  for (let i = 1; i < report.taps.length; i += 1) expect(report.taps[i].tapPeak).toBeLessThan(report.taps[i - 1].tapPeak);
});

test('LOCAL self-oscillation thresholds at three sample rates for both cores', async ({ page }) => {
  test.setTimeout(300000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const result = [];
    for (const sampleRate of [44100, 48000, 96000]) for (let band = 0; band < 10; band += 1) {
      for (const core of ['current', 'zdf']) {
        let threshold = null;
        for (const resonance of [0.7, 0.75, 0.8, 0.85, 0.875, 0.9, 0.925, 0.95, 0.975, 1]) {
          const duration = band < 3 ? 1.2 : band < 5 ? 0.8 : 0.5;
          const length = Math.round(sampleRate * duration);
          const context = new OfflineAudioContext(1, length, sampleRate);
          await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
          const buffer = context.createBuffer(1, length, sampleRate);
          const input = buffer.getChannelData(0);
          const burst = Math.min(0.1, Math.max(0.03, 3 / frequencies[band]));
          for (let i = 0; i < Math.round(sampleRate * burst); i += 1) input[i] = 0.02 * Math.sin(2 * Math.PI * frequencies[band] * i / sampleRate);
          const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
            processorOptions: {
              bandFrequencies: frequencies, bandQs: qs,
              bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
              feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === band), feedbackBandRight: Array(10).fill(false),
              feedbackAllLeft: false, feedbackAllRight: false,
              resonance, feedbackTopology: 'common-bus', feedbackCore: core,
              feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum', wetModel: 'filterbank-sum'
            }
          });
          const source = context.createBufferSource(); source.buffer = buffer;
          source.connect(node).connect(context.destination); source.start();
          const output = (await context.startRendering()).getChannelData(0);
          let earlyEnergy = 0; let lateEnergy = 0;
          const earlyStart = Math.round(length * 0.25); const earlyEnd = Math.round(length * 0.40);
          const lateStart = Math.round(length * 0.70);
          for (let i = earlyStart; i < earlyEnd; i += 1) earlyEnergy += output[i] * output[i];
          for (let i = lateStart; i < length; i += 1) lateEnergy += output[i] * output[i];
          const earlyRms = Math.sqrt(earlyEnergy / (earlyEnd - earlyStart));
          const lateRms = Math.sqrt(lateEnergy / (length - lateStart));
          const sustained = lateRms > 0.005 && lateRms >= earlyRms * 0.5;
          if (sustained) { threshold = resonance; break; }
        }
        result.push({ sampleRate, band: band + 1, nominal: frequencies[band], core, threshold });
      }
    }
    return result;
  });
  console.log('UNIFIED ZDF THRESHOLDS', JSON.stringify(report));
  expect(report).toHaveLength(60);
  for (const row of report.filter(row => row.core === 'zdf')) expect(row.threshold, JSON.stringify(row)).not.toBeNull();
});

test('stereo LOCAL + MAIN offline render-cost survey', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const rows = [];
    for (const sampleRate of [44100, 48000, 96000]) {
      for (const core of ['current', 'zdf']) {
        const times = [];
        for (let repetition = 0; repetition < 4; repetition += 1) {
          const length = Math.round(sampleRate * 0.35);
          const context = new OfflineAudioContext(2, length, sampleRate);
          await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
          const input = context.createBuffer(2, length, sampleRate);
          for (const channel of [0, 1]) {
            const samples = input.getChannelData(channel);
            for (let i = 0; i < Math.round(sampleRate * 0.03); i += 1) {
              samples[i] = 0.02 * Math.sin(2 * Math.PI * (channel ? 1500 : 777) * i / sampleRate);
            }
          }
          const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
            processorOptions: {
              bandFrequencies: frequencies, bandQs: qs,
              bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
              feedbackBandLeft: Array.from({ length: 10 }, (_, index) => [4, 5, 6].includes(index)),
              feedbackBandRight: Array.from({ length: 10 }, (_, index) => [5, 6, 7].includes(index)),
              feedbackAllLeft: true, feedbackAllRight: true,
              resonance: 1, feedbackTopology: 'common-bus', feedbackCore: core,
              feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum',
              feedbackAllLevel: 'sqrt10', wetModel: 'filterbank-sum'
            }
          });
          const source = context.createBufferSource(); source.buffer = input;
          source.connect(node).connect(context.destination); source.start();
          const started = performance.now();
          const rendered = await context.startRendering();
          times.push(performance.now() - started);
          if (!rendered.getChannelData(0).every(Number.isFinite) || !rendered.getChannelData(1).every(Number.isFinite)) {
            throw new Error('Non-finite stereo render');
          }
        }
        const measured = times.slice(1).sort((a, b) => a - b);
        rows.push({ sampleRate, core, medianMs: measured[1], times });
      }
    }
    return rows;
  });
  console.log('UNIFIED ZDF STEREO COST', JSON.stringify(report));
  expect(report).toHaveLength(6);
  for (const row of report) expect(Number.isFinite(row.medianMs)).toBe(true);
});
