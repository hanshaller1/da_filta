const { test, expect } = require('playwright/test');

test('FILTERBANK RESPONSE keeps NORMAL intact and DEV LAB diagnostics passive', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');

  const normal = page.locator('[data-response-mode="normal"]');
  const devLab = page.locator('[data-response-mode="dev-lab"]');
  const bars = page.locator('.fb-workspace .chart-grid .bars');
  const panel = page.locator('.response-dev-lab');
  const footer = page.locator('.fb-workspace .analyzer-footer');
  await expect(normal).toHaveAttribute('aria-pressed', 'true');
  await expect(bars).toBeVisible();
  await expect(panel).toBeHidden();

  const audioStateBefore = await page.evaluate(() => ({
    status: window.document.querySelector('[data-audio-status]').textContent,
    gain: window.document.querySelector('[data-control="inputGain"]').value,
    resonance: window.document.querySelector('[data-control="resonance"]').value
  }));
  await devLab.click();
  await expect(panel).toBeVisible();
  await expect(bars).toBeHidden();
  await expect(panel).toContainText('NO AUDIO');
  await expect(panel.locator('[data-dev-lab-freeze]')).toBeVisible();
  await expect(panel.locator('[data-dev-lab-reset]')).toBeVisible();
  await expect(footer).toBeHidden();
  expect(await panel.evaluate(node => {
    const analyzer = node.closest('.analyzer').getBoundingClientRect();
    const panelRect = node.getBoundingClientRect();
    // The remaining inset is the DEV-LAB body's own bottom padding,
    // not a retained analyzer footer.
    return Math.abs(panelRect.bottom - analyzer.bottom) <= 12;
  })).toBeTruthy();
  await panel.locator('[data-dev-lab-freeze]').click();
  await expect(panel.locator('[data-dev-lab-freeze]')).toHaveText('LIVE');
  await panel.locator('[data-dev-lab-reset]').click();

  const audioStateAfter = await page.evaluate(() => ({
    status: window.document.querySelector('[data-audio-status]').textContent,
    gain: window.document.querySelector('[data-control="inputGain"]').value,
    resonance: window.document.querySelector('[data-control="resonance"]').value
  }));
  expect(audioStateAfter).toEqual(audioStateBefore);

  await normal.click();
  await expect(bars).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(footer).toBeVisible();
  expect(errors).toEqual([]);
});

test('DEV LAB keeps telemetry and graph geometry stable for long live values', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-response-mode="dev-lab"]').click();

  const geometry = await page.evaluate(() => {
    const channel = values => ({
      resonanceTarget: values.resonance,
      smoothedResonance: values.resonance,
      feedbackTopology: 'isolated-tpt', feedbackTap: 'reference-delta', wetModel: 'post-gain', commonBusSaturationMode: 'constant-ceiling',
      commonBusDrive: values.scalar, commonBusCeiling: values.scalar,
      commonFeedbackReturn: values.scalar, commonTapSum: values.scalar, mainCommonFeedbackReturn: values.scalar, mainTapSum: values.scalar,
      mainTapSumScaled: values.scalar, mainFeedbackLevelScale: values.scalar, sourcePeak: values.scalar, wetPeak: values.scalar,
      commonSaturationInput: values.scalar, commonSaturationOutput: values.scalar, mainSaturationInput: values.scalar, mainSaturationOutput: values.scalar,
      mainCommonNonFiniteResets: 0, frameCount: 128, saturationActiveFrames: 0, wetDcSum: values.scalar,
      sourceEnergy: 1, wetEnergy: 1, bandEnergy: Array(10).fill(values.scalar), bandPeak: Array(10).fill(values.scalar), localGates: Array(10).fill(0)
    });
    const packet = values => ({ left: channel(values), right: channel(values) });
    const rects = () => Object.fromEntries(['.response-dev-summary', '.response-dev-traces', '.response-dev-bottom', '.response-dev-bands', '.response-dev-band-detail'].map(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return [selector, { top: rect.top, height: rect.height }];
    }));
    window.FilterbankDebugConsole.receive(packet({ resonance: 0, scalar: 0 }));
    const short = rects();
    const summaryCells = [...document.querySelectorAll('.response-dev-summary div')].map(cell => cell.getBoundingClientRect().height);
    window.FilterbankDebugConsole.receive(packet({ resonance: -0.0000, scalar: -0.0000 }));
    const negative = rects();
    window.FilterbankDebugConsole.receive(packet({ resonance: 100, scalar: 11000 }));
    const long = rects();
    const valueCells = [...document.querySelectorAll('.response-dev-summary b')].map(value => ({ text: value.textContent, height: value.getBoundingClientRect().height, wraps: value.scrollHeight > value.clientHeight, clipped: value.scrollWidth > value.clientWidth, textOverflow: getComputedStyle(value).textOverflow }));
    const visibleDiagnosticNodes = [...document.querySelectorAll('.response-dev-summary div, .response-dev-band-detail > *, .response-dev-bands em, .response-dev-bands small')].map(node => ({ clipped: node.scrollWidth > node.clientWidth, textOverflow: getComputedStyle(node).textOverflow }));
    const panel = document.querySelector('.response-dev-lab');
    return { short, negative, long, summaryCells, valueCells, visibleDiagnosticNodes, horizontalOverflow: panel.scrollWidth > panel.clientWidth };
  });

  for (const selector of ['.response-dev-traces', '.response-dev-bottom', '.response-dev-bands', '.response-dev-band-detail']) {
    expect(geometry.long[selector]).toEqual(geometry.short[selector]);
    expect(geometry.negative[selector]).toEqual(geometry.short[selector]);
  }
  expect(geometry.summaryCells.every(height => height === 23)).toBeTruthy();
  expect(geometry.valueCells.every(value => value.height === 11 && !value.wraps && !value.clipped && value.textOverflow !== 'ellipsis')).toBeTruthy();
  expect(geometry.visibleDiagnosticNodes.every(node => !node.clipped && node.textOverflow !== 'ellipsis')).toBeTruthy();
  expect(geometry.horizontalOverflow).toBeFalsy();
});

test('resonator diagnostics publish passive L/R telemetry at the bounded 15 Hz rate', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(2, 48000, 48000);
    await context.audioWorklet.addModule('/filterbank-processor.js');
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(2, context.length, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = source.buffer.getChannelData(channel);
      for (let frame = 0; frame < data.length; frame += 1) data[frame] = 0.1 * Math.sin(2 * Math.PI * frequencies[4] * frame / context.sampleRate);
    }
    const messages = [];
    const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
      processorOptions: {
        bandFrequencies: frequencies, bandQs: [...window.Filterbank.BAND_QS], bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
        feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === 4), feedbackBandRight: Array.from({ length: 10 }, (_, index) => index === 4),
        feedbackAllLeft: true, feedbackAllRight: true, resonance: 0.8, feedbackTopology: 'common-bus', feedbackAllEngine: 'common-bus',
        collectResonatorDiagnostics: true, smoothingTime: .015, feedbackGateSmoothingTime: .008, resonanceSmoothingTime: .015
      }
    });
    node.port.onmessage = event => { if (event.data?.type === 'resonator-diagnostics') messages.push(event.data); };
    source.connect(node); node.connect(context.destination); source.start(); await context.startRendering(); await new Promise(resolve => setTimeout(resolve, 0));
    const last = messages.at(-1); node.port.postMessage({ type: 'dispose' }); node.disconnect();
    return { count: messages.length, left: last?.left, right: last?.right };
  });
  expect(result.count).toBeGreaterThanOrEqual(14);
  expect(result.count).toBeLessThanOrEqual(16);
  for (const channel of [result.left, result.right]) {
    expect(channel).toBeTruthy();
    expect(channel.bandEnergy).toHaveLength(10);
    expect(Number.isFinite(channel.commonTapSum)).toBeTruthy();
    expect(Number.isFinite(channel.commonSaturationInput)).toBeTruthy();
    expect(Number.isFinite(channel.mainTapSum)).toBeTruthy();
    expect(Number.isFinite(channel.mainSaturationOutput)).toBeTruthy();
  }
});

test('guard and final safety telemetry share the existing summary, freeze, reset and fit target viewports', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  await page.goto('/');
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().outputGuardTelemetryEnabled)).toBe(false);
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().outputProtectionTelemetryEnabled)).toBe(false);
  await page.locator('[data-response-mode="dev-lab"]').click();
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().outputGuardTelemetryEnabled)).toBe(true);
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().outputProtectionTelemetryEnabled)).toBe(true);
  const packet = { prePeakLeft: 1.42, prePeakRight: 1.31, postPeakLeft: .94, postPeakRight: .93, gainReductionDb: 3.6, activePercent: 18, enabledMix: 1, threshold: .5, softness: 1 };
  await page.evaluate(value => {
    const channel = { resonanceTarget: 0, smoothedResonance: 0, feedbackTopology: 'common-bus', feedbackTap: 'pre-gain', wetModel: 'filterbank-sum', commonBusSaturationMode: 'current', commonBusDrive: 1, commonBusCeiling: 1, mainPostGainFeedbackWeightMode: 'current', feedbackAllAmount: 100, feedbackCore: 'current', feedbackCoreEffective: 'current', commonFeedbackReturn: 0, commonTapSum: 0, mainCommonFeedbackReturn: 0, mainTapSum: 0, mainTapSumScaled: 0, mainFeedbackGain: 0, mainFeedbackLevelScale: 0, sourcePeak: .2, wetPeak: .3, commonSaturationInput: 0, commonSaturationOutput: 0, mainSaturationInput: 0, mainSaturationOutput: 0, mainCommonNonFiniteResets: 0, frameCount: 128, saturationActiveFrames: 0, wetDcSum: 0, sourceEnergy: 1, wetEnergy: 1, bandEnergy: Array(10).fill(.01), bandPeak: Array(10).fill(.1), localGates: Array(10).fill(0) };
    window.FilterbankDebugConsole.receive({ left: { ...channel }, right: { ...channel } });
    window.FilterbankDebugConsole.receiveOutputProtection(value);
    window.FilterbankDebugConsole.receiveOutputGuard({ inPeakLeft: 2, inPeakRight: 1.8, outPeakLeft: 1.42, outPeakRight: 1.31, gainReductionDb: 4.2, activePercent: 75, enabledMix: 1, threshold: .5, attackMs: 2, releaseMs: 250 });
  }, packet);

  const summary = page.locator('.response-dev-summary');
  for (const [label, value] of [['MASTER PK L/R', '2.0000 / 1.8000'], ['GUARD OUT PK L/R', '1.4200 / 1.3100'], ['GUARD GR', '4.2000 dB'], ['GUARD ACT', '75.0 %'], ['FINAL PK L/R', '0.9400 / 0.9300'], ['SAFETY GR', '3.6000 dB'], ['SAFETY ACT', '18.0 %']]) {
    const cell = summary.locator('div').filter({ has: page.locator('span', { hasText: label }) });
    await expect(cell.locator('span')).toHaveText(label);
    await expect(cell.locator('b')).toHaveText(value);
  }
  await expect(page.locator('.dev-lab-panel [data-output-protection-telemetry]')).toHaveCount(0);
  await expect(page.locator('.dev-lab-panel [data-output-guard-telemetry]')).toHaveCount(0);

  await page.locator('[data-dev-lab-freeze]').click();
  await page.evaluate(() => window.FilterbankDebugConsole.receiveOutputGuard({ inPeakLeft: 4, inPeakRight: 4, outPeakLeft: .5, outPeakRight: .5, gainReductionDb: 18, activePercent: 100 }));
  await page.evaluate(() => window.FilterbankDebugConsole.receiveOutputProtection({ prePeakLeft: 2, prePeakRight: 2, postPeakLeft: .99, postPeakRight: .99, gainReductionDb: 6.1, activePercent: 40, enabledMix: 1, threshold: .5, softness: 0 }));
  await expect(summary.locator('div').filter({ has: page.locator('span', { hasText: 'MASTER PK L/R' }) }).locator('b')).toHaveText('2.0000 / 1.8000');
  await expect(page.locator('[data-dev-lab-freeze]')).toHaveText('LIVE');
  await page.locator('[data-dev-lab-reset]').click();
  await expect(summary).toContainText('NO AUDIO');
  await page.locator('[data-dev-lab-freeze]').click();
  await expect(page.locator('[data-dev-lab-freeze]')).toHaveText('FREEZE');

  const layouts = [];
  for (const viewport of [{ width: 1914, height: 907 }, { width: 1440, height: 900 }, { width: 1914, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(value => {
      const channel = { resonanceTarget: 0, smoothedResonance: 0, feedbackTopology: 'common-bus', feedbackTap: 'pre-gain', wetModel: 'filterbank-sum', commonBusSaturationMode: 'current', commonBusDrive: 1, commonBusCeiling: 1, mainPostGainFeedbackWeightMode: 'current', feedbackAllAmount: 100, feedbackCore: 'current', feedbackCoreEffective: 'current', commonFeedbackReturn: 0, commonTapSum: 0, mainCommonFeedbackReturn: 0, mainTapSum: 0, mainTapSumScaled: 0, mainFeedbackGain: 0, mainFeedbackLevelScale: 0, sourcePeak: .2, wetPeak: .3, commonSaturationInput: 0, commonSaturationOutput: 0, mainSaturationInput: 0, mainSaturationOutput: 0, mainCommonNonFiniteResets: 0, frameCount: 128, saturationActiveFrames: 0, wetDcSum: 0, sourceEnergy: 1, wetEnergy: 1, bandEnergy: Array(10).fill(.01), bandPeak: Array(10).fill(.1), localGates: Array(10).fill(0) };
      window.FilterbankDebugConsole.receive({ left: { ...channel }, right: { ...channel } });
      window.FilterbankDebugConsole.receiveOutputProtection(value);
      window.FilterbankDebugConsole.receiveOutputGuard({ inPeakLeft: 2, inPeakRight: 1.8, outPeakLeft: 1.42, outPeakRight: 1.31, gainReductionDb: 4.2, activePercent: 75, enabledMix: 1, threshold: .5, attackMs: 2, releaseMs: 250 });
    }, packet);
    layouts.push(await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const panel = rect('.response-dev-lab');
      const summary = rect('.response-dev-summary');
      const traces = rect('.response-dev-traces');
      const bottom = rect('.response-dev-bottom');
      const cells = [...document.querySelectorAll('.response-dev-summary div')].map(element => ({
        rect: element.getBoundingClientRect(), value: element.querySelector('b').getBoundingClientRect(),
        wrap: element.querySelector('b').scrollHeight > element.querySelector('b').clientHeight,
        clipped: element.querySelector('b').scrollWidth > element.querySelector('b').clientWidth
      }));
      return { panel, summary, traces, bottom, cells,
        horizontalOverflow: document.querySelector('.response-dev-lab').scrollWidth > document.querySelector('.response-dev-lab').clientWidth };
    }));
  }
  for (const layout of layouts) {
    expect(layout.horizontalOverflow).toBe(false);
    expect(layout.summary.right).toBeLessThanOrEqual(layout.panel.right + 1);
    expect(layout.summary.bottom).toBeLessThanOrEqual(layout.panel.bottom + 1);
    expect(layout.traces.top).toBeGreaterThanOrEqual(layout.summary.bottom);
    expect(layout.cells).toHaveLength(32);
    expect(layout.cells.every(cell => cell.rect.height === 23 && !cell.wrap && !cell.clipped)).toBe(true);
  }
  await page.locator('[data-mode="dynamic-eq"]').click();
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().outputGuardTelemetryEnabled)).toBe(false);
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().outputProtectionTelemetryEnabled)).toBe(false);
  await page.locator('[data-mode="filterbank"]').click();
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().outputGuardTelemetryEnabled)).toBe(true);
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().outputProtectionTelemetryEnabled)).toBe(true);
  await page.locator('[data-response-mode="normal"]').click();
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().outputGuardTelemetryEnabled)).toBe(false);
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().outputProtectionTelemetryEnabled)).toBe(false);
});
