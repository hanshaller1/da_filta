const { test, expect } = require('playwright/test');

test('signed resonance changes rendered audio in CURRENT, LOCAL LOOP, Unified and Per-Band ZDF', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const modes = [
      ['current', 'isolated-tpt'], ['current', 'common-bus'], ['current', 'local-loop-exp'],
      ['zdf', 'common-bus'], ['zdf-per-band', 'common-bus']
    ];
    const render = async (core, topology, route, resonance, rate) => {
      const context = new OfflineAudioContext(2, Math.round(rate * .5), rate);
      const defaults = window.FilterMode.getAudioEngine().getFilterbankState();
      const filterbank = await window.Filterbank.create(context, {
        ...defaults, modulationState: null, resonance, feedbackCore: core, feedbackTopology: topology,
        bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
        feedbackBandLeft: Array.from({ length: 10 }, (_, i) => route !== 'main' && route !== 'off' && i === 4),
        feedbackBandRight: Array(10).fill(false), feedbackAllLeft: route === 'main' || route === 'both', feedbackAllRight: false
      });
      const buffer = context.createBuffer(2, context.length, rate);
      for (let i = Math.round(rate * .08); i < rate * .25; i++) {
        const time = i / rate;
        const sample = .025 * Math.sin(2 * Math.PI * 411 * time) + .006 * Math.sin(2 * Math.PI * 2800 * time);
        buffer.getChannelData(0)[i] = sample;
        buffer.getChannelData(1)[i] = sample * .8;
      }
      const source = context.createBufferSource(); source.buffer = buffer;
      source.connect(filterbank.input); filterbank.output.connect(context.destination); source.start();
      const output = await context.startRendering(); filterbank.dispose();
      return [output.getChannelData(0), output.getChannelData(1)];
    };
    const compare = (a, b, channel = 0) => {
      let max = 0, energy = 0;
      for (let i = 0; i < a[channel].length; i++) { const d = a[channel][i] - b[channel][i]; max = Math.max(max, Math.abs(d)); energy += d * d; }
      return { max, rms: Math.sqrt(energy / a[channel].length) };
    };
    const metrics = output => ({ finite: output.every(channel => channel.every(Number.isFinite)), peak: output.reduce((peak, channel) => channel.reduce((p, value) => Math.max(p, Math.abs(value)), peak), 0) });
    const results = [];
    for (const [core, topology] of modes) {
      for (const rate of [44100, 48000, 96000]) {
        for (const route of rate === 48000 ? ['local', 'main', 'both'] : ['both']) {
          const [zero, positive, negative, offZero, offPositive, offNegative] = await Promise.all([
            render(core, topology, route, 0, rate), render(core, topology, route, .8, rate), render(core, topology, route, -.8, rate),
            render(core, topology, 'off', 0, rate), render(core, topology, 'off', .8, rate), render(core, topology, 'off', -.8, rate)
          ]);
          results.push({ core, topology, rate, route, zero: metrics(zero), positive: metrics(positive), negative: metrics(negative),
            positiveDelta: compare(positive, zero), negativeDelta: compare(negative, zero), signedDelta: compare(positive, negative),
            zeroGateDelta: compare(zero, offZero), offPositiveDelta: compare(offPositive, offZero), offNegativeDelta: compare(offNegative, offZero),
            rightPositiveDelta: compare(positive, zero, 1), rightNegativeDelta: compare(negative, zero, 1) });
        }
      }
    }
    return results;
  });
  await testInfo.attach('signed-resonance-audio', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  for (const item of report) {
    const label = `${item.core}/${item.topology}/${item.route}/${item.rate}`;
    for (const metrics of [item.zero, item.positive, item.negative]) { expect(metrics.finite, label).toBe(true); expect(metrics.peak, label).toBeLessThan(100); }
    for (const delta of [item.positiveDelta, item.negativeDelta, item.signedDelta]) {
      expect(delta.max, label).toBeGreaterThan(1e-5); expect(delta.rms, label).toBeGreaterThan(1e-6);
    }
    for (const delta of [item.zeroGateDelta, item.offPositiveDelta, item.offNegativeDelta, item.rightPositiveDelta, item.rightNegativeDelta]) expect(delta.max, label).toBe(0);
  }
});

test('negative resonance reaches the production worklet through UI and changes the protected final output', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    window.__signedAudio = { messages: [], diagnostics: [] };
    const NativeNode = window.AudioWorkletNode;
    window.AudioWorkletNode = function (context, name, options) {
      if (name === 'da-filta-processor') options.processorOptions.collectResonatorDiagnostics = true;
      const node = new NativeNode(context, name, options);
      if (name === 'da-filta-processor') {
        const post = node.port.postMessage.bind(node.port);
        node.port.postMessage = message => { window.__signedAudio.messages.push(structuredClone(message)); post(message); };
        node.port.addEventListener('message', event => { if (event.data?.type === 'resonator-diagnostics') window.__signedAudio.diagnostics.push(event.data); });
        node.port.start();
      }
      return node;
    };
    window.AudioWorkletNode.prototype = NativeNode.prototype;
    const devices = navigator.mediaDevices;
    devices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'test-input', label: 'Test input', groupId: 'test' }];
    devices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    for (const name of ['play', 'pause', 'setSinkId']) Object.defineProperty(HTMLMediaElement.prototype, name, { configurable: true, value: async () => {} });
    window.AudioContext = function () {
      const context = new OfflineAudioContext(2, 24000, 48000);
      context.createMediaStreamSource = () => {
        const source = context.createBufferSource();
        const buffer = context.createBuffer(2, context.length, context.sampleRate);
        for (let i = 3840; i < 12000; i++) {
          const sample = .012 * Math.sin(2 * Math.PI * 411 * i / 48000) + .003 * Math.sin(2 * Math.PI * 2800 * i / 48000);
          buffer.getChannelData(0)[i] = sample; buffer.getChannelData(1)[i] = sample * .8;
        }
        source.buffer = buffer; source.start(); return source;
      };
      context.createMediaStreamDestination = () => { const node = context.createGain(); node.stream = new MediaStream(); node.connect(context.destination); return node; };
      Object.defineProperty(context, 'resume', { value: async () => {} });
      Object.defineProperty(context, 'close', { value: async () => {} });
      return context;
    };
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const engine = window.FilterMode.getAudioEngine();
    const setRange = (name, value) => { const element = document.querySelector(`[data-control="${name}"]`); element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true })); };
    setRange('dryWet', 100); setRange('volume', -6);
    document.querySelector('[data-feedback-band="4"]').click();
    document.querySelector('.fb-all-toggle').click();
    const renders = [];
    for (const [enabled, resonance] of [[true, 0], [true, .8], [true, -.8], [false, 0], [false, -.8]]) {
      const power = document.querySelector('[data-module-power="filterbank"]');
      if (engine.filterbankEnabled !== enabled) power.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      setRange('resonance', 0);
      await engine.start({ inputDeviceId: 'test-input' });
      window.__signedAudio.messages.length = 0; window.__signedAudio.diagnostics.length = 0;
      setRange('resonance', resonance);
      await new Promise(resolve => setTimeout(resolve, 30));
      const wrapperResonance = engine.filterbank.resonance;
      const output = await engine.context.startRendering();
      await new Promise(resolve => setTimeout(resolve, 30));
      renders.push({ enabled, resonance, engineResonance: engine.resonance, wrapperResonance,
        messages: [...window.__signedAudio.messages], diagnostics: window.__signedAudio.diagnostics.at(-1)?.left,
        output: output.getChannelData(0), guard: engine.outputGuardEnabled, protection: engine.outputProtectionEnabled });
      await engine.stop();
    }
    const compare = (a, b) => {
      let max = 0, energy = 0;
      for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; max = Math.max(max, Math.abs(d)); energy += d * d; }
      return { max, rms: Math.sqrt(energy / a.length) };
    };
    return { cases: renders.map(({ output, ...item }) => ({ ...item, finite: output.every(Number.isFinite), peak: output.reduce((p, v) => Math.max(p, Math.abs(v)), 0) })),
      positive: compare(renders[1].output, renders[0].output), negative: compare(renders[2].output, renders[0].output),
      signed: compare(renders[1].output, renders[2].output), disabled: compare(renders[4].output, renders[3].output) };
  });
  await testInfo.attach('signed-resonance-production', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  for (const item of report.cases) {
    // Output protection uses a soft knee above its threshold, bounded by 0.99.
    expect(item.finite).toBe(true); expect(item.peak).toBeLessThanOrEqual(.99);
    expect(item.guard).toBe(true); expect(item.protection).toBe(true);
    expect(item.engineResonance).toBe(item.resonance);
    const effective = item.enabled ? item.resonance : 0;
    expect(item.wrapperResonance).toBe(effective);
    expect(item.messages).toContainEqual({ type: 'set-resonance', value: effective });
    expect(item.diagnostics.resonanceTarget).toBe(effective);
    expect(item.diagnostics.smoothedResonance).toBeCloseTo(effective, 5);
  }
  for (const delta of [report.positive, report.negative, report.signed]) { expect(delta.max).toBeGreaterThan(1e-5); expect(delta.rms).toBeGreaterThan(1e-6); }
  expect(report.disabled.max).toBe(0);
});
