const { test, expect } = require('playwright/test');

test('all spectral modules off give a neutral stereo wet path at 44.1, 48 and 96 kHz', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const engine = window.FilterMode.getAudioEngine();
    engine.setFilterbankEnabled(false);
    engine.setFilterEnabled(false);
    engine.setDynamicEq({ ...engine.getState(), dynamicEqEnabled: false });
    const state = engine.getFilterbankState();
    const results = [];
    for (const sampleRate of [44100, 48000, 96000]) {
      const context = new OfflineAudioContext(2, Math.round(sampleRate * 0.12), sampleRate);
      const buffer = context.createBuffer(2, context.length, sampleRate);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      for (let i = 0; i < context.length; i += 1) {
        left[i] = (i === 0 ? 0.3 : 0) + 0.07 * Math.sin(2 * Math.PI * 777 * i / sampleRate);
        right[i] = i < context.length / 2 ? 0 : 0.04 * Math.sin(2 * Math.PI * 2400 * i / sampleRate);
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      const bank = await window.Filterbank.create(context, state);
      source.connect(bank.input);
      bank.output.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      let maxError = 0;
      let rightLeak = 0;
      for (let i = 0; i < context.length; i += 1) {
        maxError = Math.max(maxError, Math.abs(output.getChannelData(0)[i] - left[i]),
          Math.abs(output.getChannelData(1)[i] - right[i]));
        if (i < context.length / 2) rightLeak = Math.max(rightLeak, Math.abs(output.getChannelData(1)[i]));
      }
      results.push({ sampleRate, maxError, rightLeak });
      bank.dispose();
    }
    return { required: state.spectralCoreRequired, diagnostics: state.collectResonatorDiagnostics, results };
  });
  expect(results.required).toBe(false);
  expect(results.diagnostics).toBe(false);
  for (const result of results.results) {
    expect(result.maxError, `${result.sampleRate} Hz`).toBeLessThan(1e-7);
    expect(result.rightLeak, `${result.sampleRate} Hz`).toBe(0);
  }
});

test('FILTERBANK, FILTER and Dynamic EQ independently keep the ten-band core active', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const engine = window.FilterMode.getAudioEngine();
    engine.setFilterState({ filterType: 'lowpass', filterFrequencyHz: 411, filterSlope: 70 });
    engine.setBandBaseGain('left', 5, 100);
    const render = async (fb, filter, dyn) => {
      engine.setFilterbankEnabled(fb);
      engine.setFilterEnabled(filter);
      engine.setDynamicEq({ ...engine.getState(), dynamicEqEnabled: dyn,
        dynamicEqMode: 'cut', dynamicEqThresholdDb: -48, dynamicEqWindowDb: 0,
        dynamicEqRangeDb: 12, dynamicEqAttackMs: 1, dynamicEqReleaseMs: 30,
        dynamicEqBandSensitivity: Array.from({ length: 10 }, (_, i) => i === 5 ? 100 : 0) });
      const state = engine.getFilterbankState();
      const context = new OfflineAudioContext(2, 12000, 48000);
      const buffer = context.createBuffer(2, context.length, 48000);
      for (let i = 0; i < context.length; i += 1) {
        const sample = 0.3 * Math.sin(2 * Math.PI * 777 * i / 48000);
        buffer.getChannelData(0)[i] = sample;
        buffer.getChannelData(1)[i] = sample * 0.5;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      const bank = await window.Filterbank.create(context, state);
      source.connect(bank.input);
      bank.output.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      let energy = 0;
      let deviation = 0;
      for (let i = 6000; i < context.length; i += 1) {
        const actual = output.getChannelData(0)[i];
        energy += actual * actual;
        deviation += (actual - buffer.getChannelData(0)[i]) ** 2;
      }
      bank.dispose();
      return { required: state.spectralCoreRequired, rms: Math.sqrt(energy / 6000),
        deviation: Math.sqrt(deviation / 6000) };
    };
    return {
      off: await render(false, false, false),
      fb: await render(true, false, false),
      filter: await render(false, true, false),
      dyn: await render(false, false, true),
      all: await render(true, true, true)
    };
  });
  expect(results.off.required).toBe(false);
  expect(results.off.deviation).toBeLessThan(1e-7);
  for (const mode of ['fb', 'filter', 'dyn', 'all']) {
    expect(results[mode].required, mode).toBe(true);
    expect(results[mode].deviation, mode).toBeGreaterThan(0.005);
  }
  expect(results.dyn.rms).toBeLessThan(results.fb.rms);
});

test('resonator telemetry is opt-in and does not change an audible oversampled TPT result', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const render = async diagnostics => {
      const context = new OfflineAudioContext(2, 12000, 48000);
      const buffer = context.createBuffer(2, context.length, 48000);
      for (let i = 0; i < context.length; i += 1) {
        buffer.getChannelData(0)[i] = 0.05 * Math.sin(2 * Math.PI * 777 * i / 48000);
      }
      const packets = [];
      const bank = await window.Filterbank.create(context, {
        feedbackTopology: 'isolated-tpt', positiveResonanceEngine: 'tpt',
        feedbackBandLeft: Array.from({ length: 10 }, (_, i) => i === 5),
        resonance: 0.8, positiveResonanceAuditionGain: 1, positiveResonanceDrive: 4,
        ...(diagnostics ? { collectResonatorDiagnostics: true } : {}),
        onDiagnostics: packet => packets.push(packet)
      });
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(bank.input);
      bank.output.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      await new Promise(resolve => setTimeout(resolve, 20));
      const samples = Array.from(output.getChannelData(0));
      const report = { samples, packets: packets.length,
        finite: packets.every(packet => packet.left?.finite && packet.right?.finite),
        fields: packets.length > 0 && packets[0].left.baseFilterFrequencies?.length === 10
          && packets[0].left.nonlinearBandPeak?.length === 10 };
      bank.dispose();
      return report;
    };
    const off = await render(false);
    const on = await render(true);
    let maxDifference = 0;
    let outputPeak = 0;
    for (let i = 0; i < off.samples.length; i += 1) {
      maxDifference = Math.max(maxDifference, Math.abs(off.samples[i] - on.samples[i]));
      outputPeak = Math.max(outputPeak, Math.abs(off.samples[i]));
    }
    return { offPackets: off.packets, onPackets: on.packets, finite: on.finite,
      fields: on.fields, maxDifference, outputPeak };
  });
  expect(results.offPackets).toBe(0);
  expect(results.onPackets).toBeGreaterThan(0);
  expect(results.finite).toBe(true);
  expect(results.fields).toBe(true);
  expect(results.outputPeak).toBeGreaterThan(0.01);
  expect(results.maxDifference).toBeLessThan(1e-6);
});

test('the neutral wet path preserves dry/wet mixing and module power fades without a click', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const render = async (wetGain, switchOn = false) => {
      const sampleRate = 48000;
      const context = new OfflineAudioContext(2, 12000, sampleRate);
      const buffer = context.createBuffer(2, context.length, sampleRate);
      for (let i = 0; i < context.length; i += 1) {
        buffer.getChannelData(0)[i] = 0.05 * Math.sin(2 * Math.PI * 777 * i / sampleRate);
        buffer.getChannelData(1)[i] = 0.035 * Math.sin(2 * Math.PI * 411 * i / sampleRate);
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      const bank = await window.Filterbank.create(context, {
        spectralCoreRequired: false,
        bandGainLeft: Array.from({ length: 10 }, (_, i) => i === 5 ? 100 : 0)
      });
      const dry = context.createGain();
      const wet = context.createGain();
      dry.gain.value = 1 - wetGain;
      wet.gain.value = wetGain;
      source.connect(dry).connect(context.destination);
      source.connect(bank.input);
      bank.output.connect(wet).connect(context.destination);
      source.start();
      const suspended = switchOn ? context.suspend(0.125) : null;
      const rendering = context.startRendering();
      if (suspended) {
        await suspended;
        bank.setSpectralCoreRequired(true);
        await context.resume();
      }
      const output = await rendering;
      let maxError = 0;
      let maxSwitchStep = 0;
      for (let i = 0; i < context.length; i += 1) {
        if (!switchOn) {
          maxError = Math.max(maxError,
            Math.abs(output.getChannelData(0)[i] - buffer.getChannelData(0)[i]),
            Math.abs(output.getChannelData(1)[i] - buffer.getChannelData(1)[i]));
        } else if (i > 6000 && i < 7200) {
          maxSwitchStep = Math.max(maxSwitchStep,
            Math.abs(output.getChannelData(0)[i] - output.getChannelData(0)[i - 1]));
        }
      }
      bank.dispose();
      return { maxError, maxSwitchStep };
    };
    return { dry: await render(0), half: await render(0.5), wet: await render(1),
      transition: await render(1, true) };
  });
  for (const mode of ['dry', 'half', 'wet']) expect(results[mode].maxError, mode).toBeLessThan(1e-7);
  expect(results.transition.maxSwitchStep).toBeLessThan(0.03);
});

test('the production UI requests diagnostics only for visible DEV or telemetry views', async ({ page }) => {
  await page.goto('/');
  const diagnostics = () => page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return { enabled: engine.resonatorDiagnosticsEnabled,
      nonlinear: engine.nonlinearResonatorDiagnosticsEnabled };
  });
  expect(await diagnostics()).toEqual({ enabled: false, nonlinear: false });
  await page.locator('[data-response-mode="dev-lab"]').click();
  expect(await diagnostics()).toEqual({ enabled: true, nonlinear: false });
  await page.locator('[data-mode="filter"]').click();
  expect(await diagnostics()).toEqual({ enabled: false, nonlinear: false });
  await page.locator('[data-mode="filterbank"]').click();
  expect(await diagnostics()).toEqual({ enabled: true, nonlinear: false });
  await page.locator('[data-response-mode="normal"]').click();
  expect(await diagnostics()).toEqual({ enabled: false, nonlinear: false });
  await page.evaluate(() => window.FilterbankAnalyzer.setDisplayOption('feedbackEnergy', true));
  expect(await diagnostics()).toEqual({ enabled: true, nonlinear: false });
  await page.evaluate(() => window.FilterbankAnalyzer.setDisplayOption('feedbackEnergy', false));
  expect(await diagnostics()).toEqual({ enabled: false, nonlinear: false });
});

test('linear DEV telemetry skips inaudible oversampling unless nonlinear details are requested', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const render = async nonlinearDetails => {
      const context = new OfflineAudioContext(2, 8000, 48000);
      const buffer = context.createBuffer(2, context.length, 48000);
      for (let i = 0; i < context.length; i += 1) {
        buffer.getChannelData(0)[i] = 0.05 * Math.sin(2 * Math.PI * 777 * i / 48000);
      }
      const packets = [];
      const bank = await window.Filterbank.create(context, {
        feedbackTopology: 'common-bus', resonance: 0,
        collectResonatorDiagnostics: true,
        collectNonlinearResonatorDiagnostics: nonlinearDetails,
        onDiagnostics: packet => packets.push(packet)
      });
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(bank.input);
      bank.output.connect(context.destination);
      source.start();
      await context.startRendering();
      await new Promise(resolve => setTimeout(resolve, 20));
      const packet = packets.at(-1);
      bank.dispose();
      return { count: packets.length,
        linearPeak: Math.max(...(packet?.left.bandPeak || [0])),
        nonlinearPeak: Math.max(...(packet?.left.nonlinearBandPeak || [0])) };
    };
    return { normal: await render(false), detailed: await render(true) };
  });
  expect(result.normal.count).toBeGreaterThan(0);
  expect(result.normal.linearPeak).toBeGreaterThan(0.01);
  expect(result.normal.nonlinearPeak).toBe(0);
  expect(result.detailed.nonlinearPeak).toBeGreaterThan(0.01);
});
