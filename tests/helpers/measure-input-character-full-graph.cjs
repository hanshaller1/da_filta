// Shared P3B.3/P3B.4 measurement: no production import or runtime integration.
const { expect } = require('playwright/test');
const { browserBundle } = require('./input-character-full-graph.cjs');
async function measureFullGraph(page, { adaptive = false, cases = ['linear', 'tape', 'tube', 'console', 'crunch', 'destroy', 'tube->destroy'], rates = [48000, 96000], variant = 'p3b4', durationMs = 2000 } = {}) {
  // Test-only isolation gives the main-thread timer sufficient resolution; no server change.
  await page.route('**/*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } });
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  // Chromium's native trace times the real 128-frame rendering callback, including
  // this Worklet graph and native analyzer branches. It avoids unavailable
  // performance.now() in AudioWorkletGlobalScope and main-thread JIT differences.
  const cdp = await page.context().newCDPSession(page);
  const traceEvents = [];
  cdp.on('Tracing.dataCollected', event => traceEvents.push(...event.value));
  await cdp.send('Tracing.start', { categories: 'audio,webaudio,disabled-by-default-audio', transferMode: 'ReportEvents' });
  const code = browserBundle('http://localhost:3000', false, { variant }), worklet = browserBundle('http://localhost:3000', true, { variant });
  const result = await page.evaluate(async ({ code, worklet, adaptive, cases, rates, durationMs }) => {
    const engine = new window.AudioEngine({});
    engine.setFilterbankEnabled(true); engine.setResonance(.55);
    engine.setDynamicEq({ dynamicEqEnabled: true, dynamicEqMode: 'cut', dynamicEqThresholdDb: -30 });
    for (const channel of ['left', 'right']) {
      for (let i = 0; i < 10; i++) engine.setBandBaseGain(channel, i, 25);
      for (const i of [2, 4, 6]) engine.setBandFeedback(channel, i, true);
      engine.setFeedbackAll(channel, true);
    }
    let options;
    const NativeNode = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeNode {
      constructor(context, name, init) { super(context, name, init); if (name === 'da-filta-processor') options = structuredClone(init.processorOptions); }
    };
    try { const bank = await window.Filterbank.create(new OfflineAudioContext(2, 128, 48000), engine.getFilterbankState()); bank.dispose(); }
    finally { window.AudioWorkletNode = NativeNode; }
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { Graph } = await import(url); URL.revokeObjectURL(url);
    const source = (rate, length, gain = 1) => Array.from({ length: 2 }, (_, c) => Float32Array.from({ length }, (_, i) => {
      const t = i / rate, u = t % .25;
      return gain * (.11 * Math.sin(2 * Math.PI * 173 * t + c * .17) + .05 * Math.sin(2 * Math.PI * 2203 * t) + .04 * Math.exp(-u * 60) * Math.sin(2 * Math.PI * 7000 * t));
    }));
    const replay = [], live = [];
    const nativeParity = [];
    // Verify that serial replay really executes the normal bank/guard/safety graph.
    for (const rate of rates) {
      const length = 8192, context = new OfflineAudioContext(2, length, rate);
      await Promise.all(['/filterbank-processor.js', '/output-guard-processor.js', '/output-protection-processor.js'].map(url => context.audioWorklet.addModule(url)));
      const input = source(rate, length, 10 ** (6 / 20));
      const graph = new Graph(rate, options, 'linear', adaptive), replayOutput = [new Float32Array(length), new Float32Array(length)];
      for (let i = 0; i < length; i += 128) {
        const result = graph.process(input.map(c => c.subarray(i, i + 128)));
        for (let c = 0; c < 2; c++) replayOutput[c].set(result[c], i);
      }
      const buffer = context.createBuffer(2, length, rate);
      for (let c = 0; c < 2; c++) buffer.getChannelData(c).set(input[c].subarray(0, length - 192), 192);
      const src = context.createBufferSource(); src.buffer = buffer;
      const bank = new AudioWorkletNode(context, 'da-filta-processor', { outputChannelCount: [2], processorOptions: options });
      const dry = context.createGain(), wet = context.createGain(), master = context.createGain();
      dry.gain.value = .3; wet.gain.value = .7; master.gain.value = 10 ** (-6 / 20);
      const guard = new AudioWorkletNode(context, 'da-filta-output-guard', { outputChannelCount: [2], processorOptions: { enabled: true, threshold: .8, attackMs: 2, releaseMs: 250, telemetryEnabled: false } });
      const safety = new AudioWorkletNode(context, 'da-filta-output-protection', { outputChannelCount: [2], processorOptions: { enabled: true, threshold: .8, softness: 1, telemetryEnabled: false } });
      src.connect(dry).connect(master); src.connect(bank).connect(wet).connect(master);
      master.connect(guard).connect(safety).connect(context.destination); src.start();
      const rendered = await context.startRendering(); let maximum = 0;
      for (let c = 0; c < 2; c++) for (let i = 0; i < length; i++) maximum = Math.max(maximum, Math.abs(rendered.getChannelData(c)[i] - replayOutput[c][i]));
      nativeParity.push({ rate, frames: length, maximum });
    }
    const quantile = (data, q) => [...data].sort((a, b) => a - b)[Math.min(data.length - 1, Math.floor(data.length * q))];
    for (const rate of rates) for (const stage of cases) {
      const timings = [], trials = [];
      const input = source(rate, 640 * 128, 10 ** (6 / 20));
      const blocks = Array.from({ length: 640 }, (_, i) => input.map(c => c.subarray(i * 128, (i + 1) * 128)));
      for (let trial = 0; trial < 3; trial++) {
        const graph = new Graph(rate, options, stage.split('->')[0], adaptive);
        for (let i = 0; i < 256; i++) graph.process(blocks[i]);
        if (stage.includes('->')) graph.character.request(stage.split('->')[1]);
        const times = [];
        for (let i = 256; i < 640; i++) {
          const begin = performance.now(); graph.process(blocks[i]); const elapsed = performance.now() - begin;
          times.push(elapsed); timings.push(elapsed);
        }
        trials.push({ p50Ms: quantile(times, .5), p95Ms: quantile(times, .95), p99Ms: quantile(times, .99), maxMs: Math.max(...times), telemetry: graph.telemetry });
      }
      const budget = 128000 / rate;
      replay.push({ rate, stage, budgetMs: budget, trials, p50Ms: quantile(timings, .5), p95Ms: quantile(timings, .95), p99Ms: quantile(timings, .99), maxMs: Math.max(...timings), p99ReservePercent: 100 * (1 - quantile(timings, .99) / budget), overBudget: timings.filter(t => t > budget).length, blocks: timings.length });
    }
    for (const rate of rates) for (const stage of cases) {
      const context = new AudioContext({ sampleRate: rate, latencyHint: 'interactive' });
      const moduleUrl = URL.createObjectURL(new Blob([worklet], { type: 'text/javascript' }));
      await context.audioWorklet.addModule(moduleUrl); URL.revokeObjectURL(moduleUrl);
      const node = new AudioWorkletNode(context, 'p3b3-full-graph', { numberOfInputs: 1, numberOfOutputs: 3, outputChannelCount: [2, 2, 2], channelCount: 2, channelCountMode: 'explicit', processorOptions: { bank: options, adaptive, stage: stage.split('->')[0], switchTo: stage.split('->')[1] || null } });
      const buffer = context.createBuffer(2, rate, rate), channels = source(rate, rate);
      for (let c = 0; c < 2; c++) buffer.copyToChannel(channels[c], c);
      const src = context.createBufferSource(); src.buffer = buffer; src.loop = true;
      const gain = context.createGain(); gain.gain.value = 10 ** (6 / 20);
      const mute = context.createGain(); mute.gain.value = 0;
      src.connect(gain).connect(node); node.connect(mute, 0).connect(context.destination);
      const analyzers = [];
      for (const tap of [1, 2]) {
        const splitter = context.createChannelSplitter(2); node.connect(splitter, tap);
        for (let c = 0; c < 2; c++) { const analyzer = context.createAnalyser(); analyzer.fftSize = 2048; splitter.connect(analyzer, c); analyzers.push(analyzer); }
      }
      const bytes = new Uint8Array(1024); let raf, analyzerReads = 0, telemetryMessages = 0, processorError = false;
      const draw = () => { for (const analyzer of analyzers) { analyzer.getByteFrequencyData(bytes); analyzerReads++; } raf = requestAnimationFrame(draw); };
      node.onprocessorerror = () => { processorError = true; };
      let resolveSnapshot;
      node.port.onmessage = event => { if (event.data.type === 'telemetry') telemetryMessages++; if (event.data.type === 'snapshot') resolveSnapshot?.(event.data); };
      draw(); src.start(); await context.resume();
      const started = performance.now(); await new Promise(resolve => setTimeout(resolve, durationMs));
      const snapshot = await new Promise((resolve, reject) => { resolveSnapshot = resolve; node.port.postMessage('snapshot'); setTimeout(() => reject(new Error('AudioWorklet snapshot timed out')), 5000); });
      live.push({ rate, actualRate: context.sampleRate, stage, wallMs: performance.now() - started, baseLatency: context.baseLatency, outputLatency: context.outputLatency, analyzerReads, telemetryMessages, processorError, ...snapshot, quantizedAverageReservePercent: 100 * (1 - snapshot.quantizedComputeMs / (snapshot.blocks * 128000 / rate)) });
      cancelAnimationFrame(raf); src.stop(); await context.close();
    }
    const ticks = [];
    for (let i = 0; i < 100; i++) { const start = performance.now(); let end; do { end = performance.now(); } while (end === start); ticks.push(end - start); }
    return { options, replay, live, nativeParity, environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, crossOriginIsolated, observedTimerTickMs: Math.min(...ticks) } };
  }, { code, worklet, adaptive, cases, rates, durationMs });
  const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end'); await complete;
  const starts = traceEvents.filter(event => event.name === 'AudioDestination::StartWithWorkletTaskRunner').sort((a, b) => a.ts - b.ts);
  expect(starts).toHaveLength(result.live.length);
  result.nativeRender = result.live.map((row, i) => {
    const all = traceEvents.filter(event => event.name === 'RealtimeAudioDestinationHandler::Render' && event.ph === 'X' && event.args?.frames === 128 && event.ts >= starts[i].ts && event.ts < (starts[i + 1]?.ts ?? Infinity));
    const durations = all.filter(event => event.ts > all[0].ts + 250000).map(event => event.dur / 1000).sort((a, b) => a - b);
    const quantile = q => durations[Math.min(durations.length - 1, Math.floor(durations.length * q))];
    const budgetMs = 128000 / row.rate;
    expect(durations.length).toBeGreaterThan(100);
    // Switch is scheduled at 0.5s. This conservative 0.4–0.8s window includes
    // warmup, the complete 15ms exponential fade and neighboring render bursts.
    const switchTimes = row.stage.includes('->') ? all.filter(event => event.ts >= all[0].ts + 400000 && event.ts <= all[0].ts + 800000).map(event => event.dur / 1000).sort((a, b) => a - b) : [];
    const switchP99 = switchTimes[Math.floor(switchTimes.length * .99)];
    return { rate: row.rate, stage: row.stage, blocks: durations.length, budgetMs, p50Ms: quantile(.5), p95Ms: quantile(.95), p99Ms: quantile(.99), maxMs: durations.at(-1), p99ReservePercent: 100 * (1 - quantile(.99) / budgetMs), overBudget: durations.filter(t => t > budgetMs).length, startupMaxMs: Math.max(...all.map(event => event.dur / 1000)), ...(switchTimes.length ? { switchWindow: { firstMs: 400, lastMs: 800, blocks: switchTimes.length, p99Ms: switchP99, maxMs: switchTimes.at(-1), p99ReservePercent: 100 * (1 - switchP99 / budgetMs), overBudget: switchTimes.filter(t => t > budgetMs).length } } : {}) };
  });
  expect(result.options.bandFrequencies).toHaveLength(10);
  expect(result.options.dynamicEqEnabled).toBe(true);
  for (const row of result.nativeParity) expect(row.maximum).toBeLessThan(3e-6);
  for (const row of result.live) {
    expect(row.actualRate).toBe(row.rate); expect(row.nonfinite).toBe(0); expect(row.processorError).toBe(false);
    expect(row.blocks).toBeGreaterThan(100); expect(row.analyzerReads).toBeGreaterThan(0); expect(row.telemetryMessages).toBeGreaterThan(0);
    expect(row.peak).toBeGreaterThan(.001);
  }
  return result;
}
module.exports = { measureFullGraph };
