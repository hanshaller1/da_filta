const { test, expect } = require('playwright/test');

test('FILTERBANK RESPONSE keeps NORMAL intact and DEV LAB is a passive, collapsible diagnostic view', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');

  const normal = page.locator('[data-response-mode="normal"]');
  const devLab = page.locator('[data-response-mode="dev-lab"]');
  const workspace = page.locator('.fb-workspace');
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
    // The remaining seven pixels are the DEV-LAB body's own bottom padding,
    // not a retained analyzer footer.
    return Math.abs(panelRect.bottom - analyzer.bottom) <= 8;
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

  await page.locator('.response-collapse-toggle').click();
  await expect(workspace).toHaveClass(/is-collapsed/);
  await expect(footer).toBeHidden();
  await page.locator('.response-collapse-toggle').click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-dev-lab-freeze]')).toHaveText('LIVE');
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
