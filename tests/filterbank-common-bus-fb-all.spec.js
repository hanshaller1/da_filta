const { test, expect } = require('playwright/test');

test('COMMON-BUS MAIN keeps a separate positive FB ALL return beside local feedback', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/', { waitUntil: 'networkidle' });
  const devLabToggle = page.locator('[data-dev-lab-toggle]');
  const devLabPanel = page.locator('[data-dev-lab-panel]');
  await expect(devLabPanel).toBeVisible();
  await expect(page.locator('.analyzer-header .dev-lab-controls')).toHaveCount(0);
  await expect(page.locator('.dev-lab-panel [data-input-preamp-stage], .dev-lab-panel [data-reference-level], .dev-lab-panel [data-band-boost-db], .dev-lab-panel [data-band-cut-db], .dev-lab-panel [data-wet-model], .dev-lab-panel [data-feedback-topology], .dev-lab-panel [data-feedback-tap], .dev-lab-panel [data-common-bus-saturation-mode], .dev-lab-panel [data-common-bus-drive], .dev-lab-panel [data-common-bus-ceiling], .dev-lab-panel [data-feedback-all-engine], .dev-lab-panel [data-feedback-all-source], .dev-lab-panel [data-feedback-all-level], .dev-lab-panel [data-positive-resonance-engine], .dev-lab-panel [data-positive-resonance-output], .dev-lab-panel [data-positive-resonance-latency], .dev-lab-panel [data-positive-resonance-curve], .dev-lab-panel [data-positive-resonance-audition], .dev-lab-panel [data-positive-resonance-drive], .dev-lab-panel [data-positive-resonance-damping-floor]')).toHaveCount(20);
  await expect(page.locator('[data-feedback-all-engine]')).toHaveValue('legacy');
  await expect(page.locator('[data-feedback-all-source]')).toHaveValue('post-gain-sum');
  await expect(page.locator('[data-feedback-all-level]')).toHaveValue('raw');
  await devLabToggle.click();
  await expect(devLabPanel).toBeHidden();
  await devLabToggle.click();
  await expect(devLabPanel).toBeVisible();
  const panelLayout = await devLabPanel.evaluate(element => ({
    overflowY: getComputedStyle(element).overflowY,
    fitsWithoutScroll: element.scrollHeight === element.clientHeight
  }));
  expect(panelLayout.overflowY).toBe('visible');
  expect(panelLayout.fitsWithoutScroll).toBeTruthy();
  await page.locator('[data-feedback-topology]').selectOption('common-bus');
  await page.locator('[data-common-bus-drive]').selectOption('8');
  await page.locator('[data-feedback-all-level]').selectOption('fortieth');
  await devLabToggle.click();
  await expect(devLabPanel).toBeHidden();
  await devLabToggle.click();
  await expect(page.locator('[data-feedback-topology]')).toHaveValue('common-bus');
  await expect(page.locator('[data-common-bus-drive]')).toHaveValue('8');
  await expect(page.locator('[data-feedback-all-level]')).toHaveValue('fortieth');
  expect(await page.locator('[data-feedback-all-engine] option').allTextContents()).toEqual(['LEGACY', 'COMMON BUS']);
  expect(await page.locator('[data-feedback-all-source] option').allTextContents()).toEqual(['PRE GAIN SUM', 'POST GAIN SUM']);
  expect(await page.locator('[data-feedback-all-level] option').allTextContents()).toEqual([
    'RAW', '1 / SQRT(10)', '1 / 10', '1 / 20', '1 / 40', '1 / 80'
  ]);

  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const bandCount = frequencies.length;
    const moduleUrl = new URL('/filterbank-processor.js', location.href).href;
    const zeros = () => Array(bandCount).fill(0);
    const gate = index => Array.from({ length: bandCount }, (_, band) => band === index);
    const maxDifference = (first, second) => {
      let maximum = 0;
      for (let index = 0; index < first.length; index += 1) maximum = Math.max(maximum, Math.abs(first[index] - second[index]));
      return maximum;
    };

    const render = async ({
      feedbackAllEngine = 'legacy', feedbackAllSource = 'post-gain-sum', feedbackAllLevel = 'raw', feedbackAll = false,
      local = false, bandGain = 0, wetModel = 'filterbank-sum', resonance = 0.9,
      saturationMode = 'current', drive = 1, ceiling = 1, duration = 0.8, events = []
    } = {}) => {
      const sampleRate = 48000;
      const length = Math.round(sampleRate * duration);
      const context = new OfflineAudioContext(2, length, sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const input = context.createBuffer(2, length, sampleRate);
      const left = input.getChannelData(0);
      for (let frame = 0; frame < Math.round(0.05 * sampleRate); frame += 1) {
        left[frame] = 0.03 * Math.sin((2 * Math.PI * 411 * frame) / sampleRate);
      }
      const diagnostics = [];
      const bandGainLeft = zeros();
      bandGainLeft[4] = bandGain;
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
        channelCountMode: 'explicit', channelInterpretation: 'discrete',
        processorOptions: {
          bandFrequencies: frequencies, bandQs: qs,
          bandGainLeft, bandGainRight: zeros(),
          feedbackBandLeft: local ? gate(4) : zeros(), feedbackBandRight: zeros(),
          feedbackAllLeft: feedbackAll, feedbackAllRight: false,
          resonance, maxBandGainDb: 12, maxBandBoostDb: 12, maxBandCutDb: 12,
          smoothingTime: 0.015, feedbackGateSmoothingTime: 0.008, resonanceSmoothingTime: 0.015,
          feedbackAllNormalization: 1 / Math.sqrt(bandCount), maxFeedbackGain: 1.25,
          feedbackTopology: 'common-bus', feedbackTap: 'post-gain', wetModel,
          commonBusSaturationMode: saturationMode, commonBusDrive: drive, commonBusCeiling: ceiling,
          feedbackAllEngine, feedbackAllSource, feedbackAllLevel, collectResonatorDiagnostics: true
        }
      });
      node.port.onmessage = event => {
        if (event.data?.type === 'resonator-diagnostics') diagnostics.push({ left: event.data.left, right: event.data.right });
      };
      const source = context.createBufferSource();
      source.buffer = input;
      source.connect(node).connect(context.destination);
      source.start();
      const suspends = events.map(event => context.suspend(event.time).then(async () => {
        node.port.postMessage(event.message || { type: 'set-resonance', value: event.value });
        await context.resume();
      }));
      const rendering = context.startRendering();
      await Promise.all(suspends);
      const rendered = await rendering;
      await new Promise(resolve => setTimeout(resolve, 0));
      const samples = rendered.getChannelData(0);
      let peak = 0;
      let energy = 0;
      let finite = true;
      for (const sample of samples) {
        peak = Math.max(peak, Math.abs(sample));
        energy += sample * sample;
        finite = finite && Number.isFinite(sample);
      }
      return {
        samples,
        diagnostics,
        latest: diagnostics.at(-1) || { left: {}, right: {} },
        peak,
        rms: Math.sqrt(energy / samples.length),
        finite
      };
    };

    const legacyImplicit = await render({ feedbackAll: true });
    const legacyExplicit = await render({ feedbackAll: true, feedbackAllEngine: 'legacy' });
    const legacyLevel = await render({ feedbackAll: true, feedbackAllEngine: 'legacy', feedbackAllLevel: 'tenth' });
    const mainOnly = await render({ feedbackAll: true, feedbackAllEngine: 'common-bus' });
    const mainSqrt = await render({ feedbackAll: true, feedbackAllEngine: 'common-bus', feedbackAllLevel: 'sqrt10' });
    const mainTenth = await render({ feedbackAll: true, feedbackAllEngine: 'common-bus', feedbackAllLevel: 'tenth' });
    const mainTwentieth = await render({ feedbackAll: true, feedbackAllEngine: 'common-bus', feedbackAllLevel: 'twentieth' });
    const mainFortieth = await render({ feedbackAll: true, feedbackAllEngine: 'common-bus', feedbackAllLevel: 'fortieth' });
    const mainEightieth = await render({ feedbackAll: true, feedbackAllEngine: 'common-bus', feedbackAllLevel: 'eightieth' });
    const localLegacyEngine = await render({ local: true, feedbackAll: false, feedbackAllEngine: 'legacy' });
    const localCommonEngine = await render({ local: true, feedbackAll: false, feedbackAllEngine: 'common-bus' });
    const localTenth = await render({ local: true, feedbackAll: false, feedbackAllEngine: 'common-bus', feedbackAllLevel: 'tenth' });
    const dual = await render({ local: true, feedbackAll: true, feedbackAllEngine: 'common-bus', bandGain: 100 });
    const preNeutral = await render({ feedbackAll: true, feedbackAllEngine: 'common-bus', feedbackAllSource: 'pre-gain-sum' });
    const postNeutral = await render({ feedbackAll: true, feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum' });
    const preBoosted = await render({ feedbackAll: true, feedbackAllEngine: 'common-bus', feedbackAllSource: 'pre-gain-sum', bandGain: 100 });
    const postBoosted = await render({ feedbackAll: true, feedbackAllEngine: 'common-bus', feedbackAllSource: 'post-gain-sum', bandGain: 100 });
    const referenceDelta = await render({ feedbackAll: true, feedbackAllEngine: 'common-bus', wetModel: 'reference-delta' });
    const filterbankSum = await render({ feedbackAll: true, feedbackAllEngine: 'common-bus', wetModel: 'filterbank-sum' });
    const zeroTail = await render({
      feedbackAll: true, feedbackAllEngine: 'common-bus', duration: 1.15,
      events: [{ time: 0.3, value: 0 }]
    });
    const switchedToLegacy = await render({
      feedbackAll: true, feedbackAllEngine: 'common-bus',
      events: [{ time: 0.3, message: { type: 'set-feedback-all-engine', value: 'legacy' } }]
    });
    const switchedToCommon = await render({
      feedbackAll: true, feedbackAllEngine: 'legacy',
      events: [{ time: 0.3, message: { type: 'set-feedback-all-engine', value: 'common-bus' } }]
    });
    const extremeRaw = await render({
      feedbackAll: true, local: true, feedbackAllEngine: 'common-bus', bandGain: 100,
      saturationMode: 'constant-ceiling', drive: 16, ceiling: 4, resonance: 1, duration: 0.5
    });
    const extremeSqrt = await render({
      feedbackAll: true, local: true, feedbackAllEngine: 'common-bus', feedbackAllLevel: 'sqrt10', bandGain: 100,
      saturationMode: 'constant-ceiling', drive: 16, ceiling: 4, resonance: 1, duration: 0.5
    });
    const extremeTenth = await render({
      feedbackAll: true, local: true, feedbackAllEngine: 'common-bus', feedbackAllLevel: 'tenth', bandGain: 100,
      saturationMode: 'constant-ceiling', drive: 16, ceiling: 4, resonance: 1, duration: 0.5
    });
    const tailDuringSmoothing = zeroTail.diagnostics
      .map(item => item.left)
      .filter(item => item.resonanceTarget === 0 && item.smoothedResonance > 1e-4);
    return {
      legacyParity: maxDifference(legacyImplicit.samples, legacyExplicit.samples),
      legacyLevelParity: maxDifference(legacyImplicit.samples, legacyLevel.samples),
      localParity: maxDifference(localLegacyEngine.samples, localCommonEngine.samples),
      localLevelParity: maxDifference(localCommonEngine.samples, localTenth.samples),
      mainOnly: mainOnly.latest,
      mainSqrt: mainSqrt.latest,
      mainTenth: mainTenth.latest,
      mainTwentieth: mainTwentieth.latest,
      mainFortieth: mainFortieth.latest,
      mainEightieth: mainEightieth.latest,
      dual: dual.latest,
      preNeutral: preNeutral.latest,
      postNeutral: postNeutral.latest,
      preBoosted: preBoosted.latest,
      postBoosted: postBoosted.latest,
      wetMainPeakDifference: Math.abs(referenceDelta.latest.left.mainCommonFeedbackReturnPeak - filterbankSum.latest.left.mainCommonFeedbackReturnPeak),
      wetOutputDifference: Math.abs(referenceDelta.rms - filterbankSum.rms),
      tailDuringSmoothing,
      zeroTail: zeroTail.latest,
      switchedToLegacy: switchedToLegacy.latest,
      switchedToCommon: switchedToCommon.latest,
      extremeRaw: extremeRaw.latest,
      extremeSqrt: extremeSqrt.latest,
      extremeTenth: extremeTenth.latest,
      finite: [mainOnly, mainSqrt, mainTenth, mainTwentieth, mainFortieth, mainEightieth, dual, preNeutral, postNeutral, preBoosted, postBoosted, referenceDelta, filterbankSum, zeroTail, switchedToLegacy, switchedToCommon, extremeRaw, extremeSqrt, extremeTenth]
        .every(item => item.finite && item.latest.left.finite && item.latest.right.finite)
    };
  });

  expect(report.legacyParity).toBe(0);
  expect(report.legacyLevelParity).toBe(0);
  expect(report.localParity).toBe(0);
  expect(report.localLevelParity).toBe(0);
  expect(report.mainOnly.left.mainCommonFeedbackReturnPeak).toBeGreaterThan(1e-5);
  expect(report.mainOnly.left.commonFeedbackReturnPeak).toBe(0);
  expect(report.mainOnly.right.mainCommonFeedbackReturnPeak).toBe(0);
  expect(report.mainOnly.left.mainFeedbackLevelScale).toBe(1);
  expect(report.mainSqrt.left.mainFeedbackLevelScale).toBeCloseTo(1 / Math.sqrt(10), 12);
  expect(report.mainTenth.left.mainFeedbackLevelScale).toBe(0.1);
  expect(report.mainTwentieth.left.mainFeedbackLevelScale).toBe(0.05);
  expect(report.mainFortieth.left.mainFeedbackLevelScale).toBe(0.025);
  expect(report.mainEightieth.left.mainFeedbackLevelScale).toBe(0.0125);
  expect(report.mainSqrt.left.firstMainTapSum).toBeCloseTo(report.mainOnly.left.firstMainTapSum, 12);
  expect(report.mainTenth.left.firstMainTapSum).toBeCloseTo(report.mainOnly.left.firstMainTapSum, 12);
  expect(report.mainSqrt.left.firstMainTapSumScaled).toBeCloseTo(report.mainOnly.left.firstMainTapSum / Math.sqrt(10), 12);
  expect(report.mainTenth.left.firstMainTapSumScaled).toBeCloseTo(report.mainOnly.left.firstMainTapSum * 0.1, 12);
  expect(report.mainTwentieth.left.firstMainTapSumScaled).toBeCloseTo(report.mainOnly.left.firstMainTapSum * 0.05, 12);
  expect(report.mainFortieth.left.firstMainTapSumScaled).toBeCloseTo(report.mainOnly.left.firstMainTapSum * 0.025, 12);
  expect(report.mainEightieth.left.firstMainTapSumScaled).toBeCloseTo(report.mainOnly.left.firstMainTapSum * 0.0125, 12);
  expect(report.dual.left.commonFeedbackReturnPeak).toBeGreaterThan(1e-5);
  expect(report.dual.left.mainCommonFeedbackReturnPeak).toBeGreaterThan(1e-5);
  expect(report.preNeutral.left.mainTapSumPeak).toBeCloseTo(report.postNeutral.left.mainTapSumPeak, 12);
  expect(report.postBoosted.left.mainTapSumPeak).toBeGreaterThan(report.preBoosted.left.mainTapSumPeak * 2);
  expect(report.wetMainPeakDifference).toBeCloseTo(0, 12);
  expect(report.wetOutputDifference).toBeGreaterThan(1e-6);
  expect(report.tailDuringSmoothing.some(item => Math.abs(item.mainCommonFeedbackReturn) > 1e-6)).toBeTruthy();
  expect(Math.abs(report.zeroTail.left.mainCommonFeedbackReturn)).toBeLessThan(1e-12);
  expect(Math.abs(report.switchedToLegacy.left.mainCommonFeedbackReturn)).toBeLessThan(1e-12);
  expect(report.switchedToCommon.left.mainCommonFeedbackReturnPeak).toBeGreaterThan(1e-5);
  expect(report.extremeRaw.left.mainCommonNonFiniteResets).toBe(0);
  expect(report.extremeSqrt.left.mainCommonNonFiniteResets).toBe(0);
  expect(report.extremeTenth.left.mainCommonNonFiniteResets).toBe(0);
  expect(report.finite).toBeTruthy();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
