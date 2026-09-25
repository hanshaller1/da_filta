const { test, expect } = require('playwright/test');

test('dynamic EQ target, sensitivity, range and smoothing', async () => {
  const { normalizeDynamicEq, targetGainDb, smoothGain, timeCoefficient } = await import('../dynamic-eq-core.mjs');
  const state = normalizeDynamicEq({ dynamicEqThresholdDb: -24, dynamicEqWindowDb: 6, dynamicEqRangeDb: 12 });
  expect(targetGainDb(-15, state)).toBe(-6);
  expect(targetGainDb(-23, state)).toBe(0);
  expect(targetGainDb(-15, { ...state, dynamicEqRangeDb: 4 })).toBe(-4);
  expect(targetGainDb(-15, { ...state, dynamicEqStrength: 50 })).toBe(-3);
  expect(targetGainDb(-15, state, 50)).toBe(-3);
  expect(targetGainDb(-15, state, 0)).toBe(0);
  expect(targetGainDb(-10, state)).toBe(-11);
  expect(targetGainDb(0, state)).toBe(-12);
  const boost = { ...state, dynamicEqMode: 'boost' };
  expect(targetGainDb(-33, boost)).toBe(6);
  expect(targetGainDb(-33, boost, 50)).toBe(3);
  expect(targetGainDb(-15, boost)).toBe(0);
  const balance = { ...state, dynamicEqMode: 'balance' };
  expect(targetGainDb(-15, balance)).toBe(-6);
  expect(targetGainDb(-24, balance)).toBe(0);
  expect(targetGainDb(-33, balance)).toBe(6);
  expect(normalizeDynamicEq({}).dynamicEqEnabled).toBe(false);
  const attack = timeCoefficient(30, 48000);
  const release = timeCoefficient(250, 48000);
  const first = smoothGain(0, -6, attack, release);
  expect(first).toBeLessThan(0);
  expect(first).toBeGreaterThan(-6);
  const returning = smoothGain(-6, 0, attack, release);
  expect(returning).toBeGreaterThan(-6);
  expect(smoothGain(-6, 6, attack, release)).toBe(returning);
  expect(Number.isFinite(smoothGain(0, 12, attack, release))).toBe(true);
  let crossing = -6;
  for (let i = 0; i < 192000; i += 1) crossing = smoothGain(crossing, 6, attack, release);
  expect(crossing).toBeGreaterThan(0);
});

test('audio worklet applies linked gain from source bands and keeps power independent', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const render = async (enabled, mode = 'cut', sensitivity = 100, threshold = -48) => {
      const context = new OfflineAudioContext(2, 48000, 48000);
      const source = context.createBufferSource();
      const buffer = context.createBuffer(2, context.length, context.sampleRate);
      for (let i = 0; i < context.length; i += 1) {
        const sine = Math.sin(2 * Math.PI * 777 * i / context.sampleRate);
        buffer.getChannelData(0)[i] = .4 * sine;
        buffer.getChannelData(1)[i] = .1 * sine;
      }
      source.buffer = buffer;
      const packets = [];
      const bank = await window.Filterbank.create(context, {
        bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
        dynamicEqEnabled: enabled, dynamicEqMode: mode, dynamicEqThresholdDb: threshold,
        dynamicEqWindowDb: 0, dynamicEqRangeDb: 12, dynamicEqAttackMs: 1,
        dynamicEqReleaseMs: 50,
        dynamicEqBandSensitivity: Array.from({ length: 10 }, (_, i) => i === 5 ? sensitivity : 0),
        onDynamicEqTelemetry: packet => packets.push(packet)
      });
      source.connect(bank.input);
      bank.output.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      await new Promise(resolve => setTimeout(resolve, 30));
      const rms = channel => {
        const data = output.getChannelData(channel);
        let energy = 0;
        for (let i = 36000; i < 48000; i += 1) energy += data[i] * data[i];
        return Math.sqrt(energy / 12000);
      };
      const answer = { left: rms(0), right: rms(1), packets: packets.length,
        gain: packets.at(-1)?.gains?.[5], level: packets.at(-1)?.levels?.[5] };
      bank.dispose();
      return answer;
    };
    return { off: await render(false), cut: await render(true), boost: await render(true, 'boost'),
      boostActive: await render(true, 'boost', 100, -10), muted: await render(true, 'cut', 0) };
  });
  expect(result.off.packets).toBe(0);
  expect(result.cut.packets).toBeGreaterThan(0);
  expect(result.cut.level).toBeGreaterThan(-48);
  expect(result.cut.gain).toBeLessThan(-1);
  expect(result.cut.left).toBeLessThan(result.off.left);
  expect(result.cut.right).toBeLessThan(result.off.right);
  expect(result.cut.left / result.cut.right).toBeCloseTo(result.off.left / result.off.right, 1);
  expect(result.boost.gain).toBe(0);
  expect(result.boostActive.gain).toBeGreaterThan(0.5);
  expect(result.boostActive.left).toBeGreaterThan(result.off.left);
  expect(result.muted.gain).toBe(0);
  expect(result.muted.left).toBeCloseTo(result.off.left, 4);
});

test('legacy state defaults and independent FILTERBANK, FILTER and dynamic layers', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    engine.applyState({ bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0) });
    const legacy = engine.getState();
    engine.bandGainLeft[5] = 25;
    engine.bandGainRight[5] = 25;
    engine.filterModeBandGainsDb[5] = 3;
    engine.filterbankEnabled = false;
    engine.filterEnabled = false;
    const neither = engine.getPreDynamicGainDb(5, 'left');
    engine.filterbankEnabled = true;
    const manual = engine.getPreDynamicGainDb(5, 'left');
    engine.filterbankEnabled = false;
    engine.filterEnabled = true;
    const filter = engine.getPreDynamicGainDb(5, 'left');
    engine.filterbankEnabled = true;
    const both = engine.getPreDynamicGainDb(5, 'left');
    engine.setDynamicEq({ ...legacy, dynamicEqEnabled: true });
    return { legacy: [legacy.dynamicEqEnabled, legacy.dynamicEqMode, legacy.dynamicEqThresholdDb,
      legacy.dynamicEqBandSensitivity], neither, manual, filter, both,
      manualStillStored: engine.bandGainLeft[5], dynamicEnabled: engine.dynamicEqEnabled };
  });
  expect(result.legacy).toEqual([false, 'cut', -24, Array(10).fill(100)]);
  expect(result.neither).toBe(0);
  expect(result.manual).toBe(3);
  expect(result.filter).toBe(3);
  expect(result.both).toBe(6);
  expect(result.manualStillStored).toBe(25);
  expect(result.dynamicEnabled).toBe(true);
});

test('peak catches a transient sooner while RMS retains its energy longer', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const render = async detector => {
      const context = new OfflineAudioContext(2, 9600, 48000);
      const source = context.createBufferSource();
      const buffer = context.createBuffer(2, context.length, 48000);
      const left = buffer.getChannelData(0);
      for (let i = 0; i < 480; i += 1) left[i] = .5 * Math.sin(2 * Math.PI * 777 * i / 48000);
      source.buffer = buffer;
      const packets = [];
      const bank = await window.Filterbank.create(context, {
        dynamicEqEnabled: true, dynamicEqMode: 'cut', dynamicEqDetectorMode: detector,
        dynamicEqThresholdDb: -45, dynamicEqWindowDb: 0, dynamicEqRangeDb: 12,
        dynamicEqAttackMs: 1, dynamicEqReleaseMs: 80,
        dynamicEqBandSensitivity: Array.from({ length: 10 }, (_, i) => i === 5 ? 100 : 0),
        onDynamicEqTelemetry: packet => packets.push(packet)
      });
      source.connect(bank.input);
      bank.output.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      await new Promise(resolve => setTimeout(resolve, 30));
      let energy = 0;
      const data = output.getChannelData(0);
      for (let i = 0; i < 480; i += 1) energy += data[i] * data[i];
      const answer = { transientRms: Math.sqrt(energy / 480), laterLevel: packets[0]?.levels?.[5] };
      bank.dispose();
      return answer;
    };
    return { peak: await render('peak'), rms: await render('rms') };
  });
  expect(result.peak.transientRms).toBeLessThan(result.rms.transientRms);
  expect(result.rms.laterLevel).toBeGreaterThan(result.peak.laterLevel);
});

test('dynamic EQ workspace, power and state survive tab changes', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="dynamic-eq"]').click();
  await expect(page.locator('#mode-dynamic-eq')).toBeVisible();
  await expect(page.locator('[data-module-power="dynamic-eq"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-dynamic-eq-mode]')).toHaveCount(3);
  await expect(page.locator('[data-dynamic-eq-detector]')).toHaveCount(2);
  await expect(page.locator('.dynamic-eq-control')).toHaveCount(6);
  await expect(page.locator('.dynamic-eq-sensitivity-item')).toHaveCount(10);
  await page.locator('[data-dynamic-eq-mode="balance"]').click();
  await page.locator('.dynamic-eq-control input[aria-label="Threshold"]').fill('-18');
  await page.locator('.dynamic-eq-sensitivity-item input').first().fill('50');
  await page.locator('[data-module-power="dynamic-eq"]').click();
  await page.locator('[data-mode="filter"]').click();
  await page.locator('[data-mode="dynamic-eq"]').click();
  expect(await page.evaluate(() => {
    const state = window.FilterMode.getAudioEngine().getState();
    return [state.dynamicEqEnabled, state.dynamicEqMode, state.dynamicEqThresholdDb, state.dynamicEqBandSensitivity[0]];
  })).toEqual([true, 'balance', -18, 50]);
  await expect(page.locator('[data-module-power="dynamic-eq"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-dynamic-eq-reset]').click();
  await expect(page.locator('.dynamic-eq-sensitivity-item output').first()).toHaveText('100');
});

test('dynamic EQ graph and controls fit the existing desktop workspace', async ({ page }) => {
  for (const [width, height] of [[1914, 907], [1440, 900], [1914, 768]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.locator('[data-mode="dynamic-eq"]').click();
    const geometry = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const panel = rect('#mode-dynamic-eq');
      const response = rect('.dynamic-eq-response');
      const controls = rect('.dynamic-eq-controls');
      const graph = rect('.dynamic-eq-graph');
      const sensitivity = rect('.dynamic-eq-sensitivity-grid');
      return { panel, response, controls, graph, sensitivity,
        controlScroll: document.querySelector('.dynamic-eq-controls').scrollHeight - controls.height };
    });
    expect(geometry.response.left).toBeGreaterThanOrEqual(geometry.panel.left);
    expect(geometry.controls.right).toBeLessThanOrEqual(geometry.panel.right);
    expect(geometry.graph.bottom).toBeLessThan(geometry.sensitivity.top);
    expect(geometry.sensitivity.bottom).toBeLessThanOrEqual(geometry.panel.bottom);
    expect(geometry.controlScroll).toBeLessThan(2);
  }
});

test('dynamic EQ guide lines and bipolar gain bars follow telemetry', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="dynamic-eq"]').click();
  await page.locator('[data-module-power="dynamic-eq"]').click();
  await page.evaluate(() => window.FilterMode.getAudioEngine().onDynamicEqTelemetry({
    levels: Array(10).fill(-24), gains: [-4, 3, 0, 0, 0, 0, 0, 0, 0, 0]
  }));
  await expect(page.locator('.dynamic-eq-gain-value').first()).toHaveText('-4.0 dB');
  await expect(page.locator('.dynamic-eq-gain-value').nth(1)).toHaveText('+3.0 dB');
  const before = await page.locator('[data-dynamic-eq-threshold]').evaluate(element => element.style.bottom);
  await page.locator('.dynamic-eq-control input[aria-label="Threshold"]').fill('-18');
  const after = await page.locator('[data-dynamic-eq-threshold]').evaluate(element => element.style.bottom);
  expect(before).not.toBe(after);
  await expect(page.locator('[data-dynamic-eq-upper]')).toHaveAttribute('title', 'UPPER -15.0 dBFS');
  await expect(page.locator('[data-dynamic-eq-lower]')).toHaveAttribute('title', 'LOWER -21.0 dBFS');
});
