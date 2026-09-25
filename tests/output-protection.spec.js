const { test, expect } = require('playwright/test');

test('final soft protection is transparent below knee and bounded above it', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const results = await page.evaluate(async () => {
    const values = [-20, -1, -.8, -.5, 0, .5, .8, 1, 20];
    const output = [];
    for (const sampleRate of [44100, 48000, 96000]) {
      const context = new OfflineAudioContext(2, 128, sampleRate);
      await context.audioWorklet.addModule(new URL('output-protection-processor.js', location.href));
      const source = context.createBufferSource();
      const buffer = context.createBuffer(2, 128, sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        values.forEach((value, index) => { data[index] = value; });
      }
      source.buffer = buffer;
      source.connect(new AudioWorkletNode(context, 'da-filta-output-protection', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]
      })).connect(context.destination);
      source.start();
      const rendered = await context.startRendering();
      output.push({ sampleRate, values: values.map((_, index) => rendered.getChannelData(0)[index]) });
    }
    return output;
  });
  for (const result of results) {
    const data = result.values;
    expect(data[0]).toBeGreaterThanOrEqual(-.99001);
    expect(data[8]).toBeLessThanOrEqual(.99001);
    expect(data[1]).toBeLessThan(-.8);
    expect(data[7]).toBeGreaterThan(.8);
    for (const index of [2, 3, 4, 5, 6]) expect(data[index]).toBeCloseTo([-.8, -.5, 0, .5, .8][index - 2], 5);
    for (let index = 0; index < data.length; index += 1) expect(data[index]).toBeCloseTo(-data[data.length - 1 - index], 5);
  }
});

test('enable, threshold and softness change only the final transfer', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const cases = await page.evaluate(async () => {
    const result = [];
    for (const options of [
      { enabled: false, threshold: .5, softness: 0 },
      { enabled: true, threshold: .5, softness: 1 },
      { enabled: true, threshold: .95, softness: 1 },
      { enabled: true, threshold: .8, softness: 0 },
      { enabled: true, threshold: .8, softness: 1 }
    ]) {
      const context = new OfflineAudioContext(1, 128, 48000);
      await context.audioWorklet.addModule(new URL('output-protection-processor.js', location.href));
      const buffer = context.createBuffer(1, 128, 48000);
      buffer.getChannelData(0).fill(1);
      buffer.getChannelData(0)[0] = .75;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const processor = new AudioWorkletNode(context, 'da-filta-output-protection', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: options
      });
      source.connect(processor).connect(context.destination);
      source.start();
      const output = (await context.startRendering()).getChannelData(0);
      result.push({ first: output[0], second: output[1] });
    }
    return result;
  });
  expect(cases[0].first).toBeCloseTo(.75, 5);
  expect(cases[0].second).toBeCloseTo(1, 5);
  expect(cases[1].first).toBeLessThan(.75);
  expect(cases[2].first).toBeCloseTo(.75, 5);
  expect(cases[3].second).toBeGreaterThan(cases[4].second);
  for (const entry of cases.slice(1)) expect(entry.second).toBeLessThanOrEqual(.99001);
});

test('transfer stays transparent, monotonic, bounded and never adds gain across settings and rates', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const results = await page.evaluate(async () => {
    const output = [];
    const settings = [
      ...[0, 25, 50, 75, 100].flatMap(softness => [.5, .8, .95].map(threshold => ({ softness, threshold })))
    ];
    for (const sampleRate of [44100, 48000, 96000]) {
      for (const { threshold, softness } of settings) {
        const length = 4096;
        const context = new OfflineAudioContext(1, length, sampleRate);
        await context.audioWorklet.addModule(new URL('output-protection-processor.js', location.href));
        const buffer = context.createBuffer(1, length, sampleRate);
        const input = buffer.getChannelData(0);
        const half = length / 2;
        for (let index = 0; index < half; index += 1) {
          const magnitude = 2 * index / (half - 1);
          input[index] = magnitude;
          input[length - 1 - index] = -magnitude;
        }
        input[0] = threshold - 1e-6;
        input[1] = threshold;
        input[2] = threshold + 1e-6;
        input[length - 1] = -input[0];
        input[length - 2] = -input[1];
        input[length - 3] = -input[2];
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(new AudioWorkletNode(context, 'da-filta-output-protection', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          processorOptions: { enabled: true, threshold, softness: softness / 100 }
        })).connect(context.destination);
        source.start();
        const rendered = (await context.startRendering()).getChannelData(0);
        let priorPositive = 0;
        let maxOutput = 0;
        let maxUpwardGain = 0;
        let symmetryError = 0;
        let belowThresholdError = 0;
        let continuityError = 0;
        for (let index = 0; index < half; index += 1) {
          const positive = rendered[index];
          const negative = rendered[length - 1 - index];
          const magnitude = input[index];
          maxOutput = Math.max(maxOutput, Math.abs(positive), Math.abs(negative));
          maxUpwardGain = Math.max(maxUpwardGain, Math.abs(positive) - magnitude, Math.abs(negative) - magnitude);
          symmetryError = Math.max(symmetryError, Math.abs(positive + negative));
          if (magnitude <= threshold) belowThresholdError = Math.max(belowThresholdError, Math.abs(positive - magnitude), Math.abs(negative + magnitude));
          if (index < 3) continuityError = Math.max(continuityError, Math.abs(positive - threshold));
          if (magnitude > threshold && positive + 1e-7 < priorPositive) throw new Error(`Nonmonotonic curve: ${sampleRate}/${threshold}/${softness}`);
          priorPositive = positive;
          if (!Number.isFinite(positive) || !Number.isFinite(negative)) throw new Error(`Nonfinite output: ${sampleRate}/${threshold}/${softness}`);
        }
        output.push({ sampleRate, threshold, softness, maxOutput, maxUpwardGain, symmetryError, belowThresholdError, continuityError });
      }
    }
    return output;
  });
  expect(results).toHaveLength(45);
  for (const result of results) {
    expect(result.maxOutput, `${result.sampleRate}/${result.threshold}/${result.softness}`).toBeLessThanOrEqual(.99001);
    expect(result.maxUpwardGain, `${result.sampleRate}/${result.threshold}/${result.softness}`).toBeLessThanOrEqual(1e-7);
    expect(result.symmetryError, `${result.sampleRate}/${result.threshold}/${result.softness}`).toBeLessThanOrEqual(1e-7);
    expect(result.belowThresholdError, `${result.sampleRate}/${result.threshold}/${result.softness}`).toBeLessThanOrEqual(1e-7);
    expect(result.continuityError, `${result.sampleRate}/${result.threshold}/${result.softness}`).toBeLessThanOrEqual(1e-5);
  }
});

test('AudioEngine live path sends runtime controls to protection and reports real pre/post telemetry', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-audio-source="sample"]').click();
  await expect(page.locator('[data-audio-input]')).toHaveValue('full-drums-145');
  await page.locator('[data-response-mode="dev-lab"]').click();
  const outputGroup = page.locator('[data-dev-lab-group="output"]');
  await outputGroup.locator('.dev-lab-collapse-toggle').click();
  await outputGroup.locator('[data-output-guard-enabled]').selectOption('off');
  const protection = outputGroup.locator('[data-output-protection-enabled]');
  const threshold = outputGroup.locator('[data-output-protection-threshold]');
  const softness = outputGroup.locator('[data-output-protection-softness]');
  await expect(protection).toHaveValue('on');
  await threshold.fill('0.95');
  await softness.fill('100');
  await page.locator('[data-control="volume"]').fill('0');
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON', { timeout: 15000 });
  await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    window.__outputProtectionTelemetryTimes = [];
    window.__outputProtectionTelemetryPackets = [];
    const receive = engine.onOutputProtectionTelemetry;
    engine.onOutputProtectionTelemetry = packet => {
      window.__outputProtectionTelemetryTimes.push(performance.now());
      window.__outputProtectionTelemetryPackets.push(packet);
      receive?.(packet);
    };
  });
  await page.waitForFunction(() => window.FilterbankDebugConsole.getOutputProtection()?.threshold > .949, null, { timeout: 10000 });
  await threshold.fill('0.5');
  await page.waitForFunction(() => Math.abs((window.FilterbankDebugConsole.getOutputProtection()?.threshold ?? 1) - .5) < .001, null, { timeout: 5000 });
  await page.waitForTimeout(750);
  const sampleRunOn = await page.evaluate(() => {
    const packets = window.__outputProtectionTelemetryPackets.filter(packet => Math.abs(packet.threshold - .5) < .001 && packet.enabledMix > .999 && packet.softness > .999);
    return { count: packets.length, maxPrePeakLeft: Math.max(0, ...packets.map(packet => packet.prePeakLeft)), maxPrePeakRight: Math.max(0, ...packets.map(packet => packet.prePeakRight)), maxPostPeakLeft: Math.max(0, ...packets.map(packet => packet.postPeakLeft)), maxPostPeakRight: Math.max(0, ...packets.map(packet => packet.postPeakRight)), maxGainReductionDb: Math.max(0, ...packets.map(packet => packet.gainReductionDb)), maxActivePercent: Math.max(0, ...packets.map(packet => packet.activePercent)) };
  });

  const sampleMetrics = await page.evaluate(() => window.FilterbankDebugConsole.getOutputProtection());
  console.log('FULL_DRUMS_OUTPUT_PROTECTION_ON=' + JSON.stringify(sampleRunOn));
  expect(sampleRunOn.count).toBeGreaterThanOrEqual(5);
  expect(sampleMetrics.threshold).toBeCloseTo(.5, 3);
  expect(sampleMetrics.softness).toBeCloseTo(1, 3);
  expect(Number.isFinite(sampleMetrics.prePeakLeft) && Number.isFinite(sampleMetrics.postPeakLeft)).toBeTruthy();

  await protection.selectOption('off');
  await page.waitForFunction(() => {
    const metrics = window.FilterbankDebugConsole.getOutputProtection();
    return metrics?.enabledMix < 1e-8 && Math.abs(metrics.prePeakLeft - metrics.postPeakLeft) < 1e-6
      && metrics.gainReductionDb === 0 && metrics.activePercent === 0;
  }, null, { timeout: 5000 });
  await page.waitForTimeout(500);
  const sampleRunOff = await page.evaluate(() => {
    const packets = window.__outputProtectionTelemetryPackets.filter(packet => packet.enabledMix < 1e-8 && Math.abs(packet.threshold - .5) < .001);
    return { count: packets.length, maxPrePeakLeft: Math.max(0, ...packets.map(packet => packet.prePeakLeft)), maxPrePeakRight: Math.max(0, ...packets.map(packet => packet.prePeakRight)), maxPostPeakLeft: Math.max(0, ...packets.map(packet => packet.postPeakLeft)), maxPostPeakRight: Math.max(0, ...packets.map(packet => packet.postPeakRight)), maxGainReductionDb: Math.max(0, ...packets.map(packet => packet.gainReductionDb)), maxActivePercent: Math.max(0, ...packets.map(packet => packet.activePercent)) };
  });
  const sampleMetricsOff = await page.evaluate(() => window.FilterbankDebugConsole.getOutputProtection());
  console.log('FULL_DRUMS_OUTPUT_PROTECTION_OFF=' + JSON.stringify(sampleRunOff));
  expect(sampleRunOff.count).toBeGreaterThanOrEqual(3);
  expect(sampleMetricsOff.prePeakLeft).toBeCloseTo(sampleMetricsOff.postPeakLeft, 6);
  expect(sampleMetricsOff.prePeakRight).toBeCloseTo(sampleMetricsOff.postPeakRight, 6);
  expect(sampleMetricsOff.gainReductionDb).toBe(0);
  expect(sampleMetricsOff.activePercent).toBe(0);
  await protection.selectOption('on');
  await page.waitForFunction(() => window.FilterbankDebugConsole.getOutputProtection()?.enabledMix > .999, null, { timeout: 5000 });

  await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    engine.inputGainNode.gain.value = 0;
    const source = engine.context.createConstantSource();
    source.offset.value = .8;
    source.connect(engine.mixBus);
    source.start();
    window.__outputProtectionProbe = source;
  });
  await page.waitForFunction(() => {
    const metrics = window.FilterbankDebugConsole.getOutputProtection();
    return Math.abs((metrics?.threshold ?? 1) - .5) < .001 && metrics?.enabledMix > .999
      && metrics.prePeakLeft > .79 && metrics.postPeakLeft < .79;
  }, null, { timeout: 5000 });
  const enabled = await page.evaluate(() => window.FilterbankDebugConsole.getOutputProtection());
  expect(enabled.gainReductionDb).toBeGreaterThan(0);
  expect(enabled.activePercent).toBeGreaterThan(0);
  expect(enabled.prePeakLeft).toBeGreaterThan(.79);
  expect(enabled.postPeakLeft).toBeLessThan(enabled.prePeakLeft);
  expect(enabled.postPeakLeft).toBeLessThanOrEqual(.99001);

  await threshold.fill('0.95');
  await page.waitForFunction(() => {
    const metrics = window.FilterbankDebugConsole.getOutputProtection();
    return metrics?.threshold > .949 && metrics?.postPeakLeft > .79;
  }, null, { timeout: 5000 });
  await threshold.fill('0.5');
  await softness.fill('0');
  await page.waitForFunction(() => {
    const metrics = window.FilterbankDebugConsole.getOutputProtection();
    return Math.abs((metrics?.threshold ?? 1) - .5) < .001 && metrics?.softness < .001 && metrics?.postPeakLeft < .79;
  }, null, { timeout: 5000 });
  const hardKnee = await page.evaluate(() => window.FilterbankDebugConsole.getOutputProtection());
  expect(hardKnee.postPeakLeft).toBeGreaterThan(enabled.postPeakLeft);
  expect(hardKnee.gainReductionDb).toBeGreaterThan(0);

  await protection.selectOption('off');
  await page.evaluate(() => { window.__outputProtectionProbe.offset.value = 1.2; });
  await page.waitForFunction(() => {
    const metrics = window.FilterbankDebugConsole.getOutputProtection();
    return metrics?.enabledMix < 1e-8 && metrics.activePercent === 0 && metrics.gainReductionDb === 0
      && Math.abs(metrics.prePeakLeft - metrics.postPeakLeft) < 1e-6;
  }, null, { timeout: 5000 });
  const disabled = await page.evaluate(() => window.FilterbankDebugConsole.getOutputProtection());
  expect(disabled.prePeakLeft).toBeGreaterThan(1);
  expect(disabled.postPeakLeft).toBeCloseTo(disabled.prePeakLeft, 6);
  expect(disabled.gainReductionDb).toBe(0);
  expect(disabled.activePercent).toBe(0);
  const publishIntervals = await page.evaluate(() => {
    const times = window.__outputProtectionTelemetryTimes;
    return times.slice(1).map((time, index) => time - times[index]);
  });
  expect(publishIntervals.length).toBeGreaterThanOrEqual(5);
  expect(publishIntervals.every(interval => interval >= 55)).toBeTruthy();
  const averagePublishInterval = publishIntervals.reduce((sum, interval) => sum + interval, 0) / publishIntervals.length;
  expect(averagePublishInterval).toBeGreaterThanOrEqual(60);
  expect(averagePublishInterval).toBeLessThanOrEqual(100);
  await page.evaluate(() => {
    window.__outputProtectionProbe?.stop();
    window.__outputProtectionProbe?.disconnect();
  });
  await page.locator('[data-audio-stop]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('OFF');
});
