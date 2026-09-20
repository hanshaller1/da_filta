const { test, expect } = require('playwright/test');

test('COMMON-BUS MAIN soft-knee resonance curve is bounded, live-switchable, and isolated from other paths', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/', { waitUntil: 'networkidle' });
  const curveSelector = page.locator('[data-feedback-all-resonance-curve]');
  await expect(curveSelector).toHaveValue('current');
  expect(await curveSelector.locator('option').allTextContents()).toEqual(['CURRENT', 'SOFT KNEE']);
  await curveSelector.selectOption('soft-knee');
  await expect(curveSelector).toHaveValue('soft-knee');
  await curveSelector.selectOption('current');

  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const bandCount = frequencies.length;
    const moduleUrl = new URL('/filterbank-processor.js', location.href).href;
    const zeros = () => Array(bandCount).fill(0);
    const oneGate = index => Array.from({ length: bandCount }, (_, band) => band === index);
    const maxDifference = (first, second) => first.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - second[index])), 0);
    const softKnee = resonance => {
      if (resonance <= 0.5) return resonance * resonance;
      const hermite = (value, start, end) => {
        const width = end.r - start.r;
        const t = (value - start.r) / width;
        const t2 = t * t;
        const t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * start.g
          + (t3 - 2 * t2 + t) * width * start.m
          + (-2 * t3 + 3 * t2) * end.g
          + (t3 - t2) * width * end.m;
      };
      if (resonance <= 0.75) return hermite(resonance, { r: .5, g: .25, m: 1 }, { r: .75, g: .56, m: 1.2 });
      if (resonance <= 0.95) return .56 + 1.2 * (resonance - .75);
      if (resonance < 1) return hermite(resonance, { r: .95, g: .8, m: 1.2 }, { r: 1, g: 1, m: 5 });
      return 1;
    };
    const render = async ({
      resonance, curve = 'current', topology = 'common-bus', feedbackAll = true,
      feedbackAllEngine = 'common-bus', feedbackBandLeft = zeros(), event = null
    }) => {
      const sampleRate = 48000;
      const duration = event ? 0.34 : 0.12;
      const context = new OfflineAudioContext(2, Math.round(sampleRate * duration), sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const input = context.createBuffer(2, Math.round(sampleRate * duration), sampleRate);
      const left = input.getChannelData(0);
      for (let frame = 0; frame < left.length; frame += 1) left[frame] = 0.01 * Math.sin((2 * Math.PI * 411 * frame) / sampleRate);
      const diagnostics = [];
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
        channelCountMode: 'explicit', channelInterpretation: 'discrete',
        processorOptions: {
          bandFrequencies: frequencies, bandQs: qs,
          bandGainLeft: zeros(), bandGainRight: zeros(),
          feedbackBandLeft, feedbackBandRight: zeros(),
          feedbackAllLeft: feedbackAll, feedbackAllRight: false,
          resonance, maxBandGainDb: 12, maxBandBoostDb: 12, maxBandCutDb: 12,
          smoothingTime: .015, feedbackGateSmoothingTime: .008, resonanceSmoothingTime: .015,
          feedbackAllNormalization: 1 / Math.sqrt(bandCount), maxFeedbackGain: 1.25,
          feedbackTopology: topology, feedbackTap: 'pre-gain', wetModel: 'filterbank-sum',
          commonBusSaturationMode: 'current', commonBusDrive: 1, commonBusCeiling: 1,
          feedbackAllEngine, feedbackAllSource: 'post-gain-sum', feedbackAllLevel: 'raw', feedbackAllResonanceCurve: curve,
          collectResonatorDiagnostics: true
        }
      });
      node.port.onmessage = message => { if (message.data?.type === 'resonator-diagnostics') diagnostics.push(message.data.left); };
      const source = context.createBufferSource();
      source.buffer = input;
      source.connect(node).connect(context.destination);
      source.start();
      const suspension = event && context.suspend(event.time).then(async () => {
        node.port.postMessage(event.message);
        await context.resume();
      });
      const rendering = context.startRendering();
      if (suspension) await suspension;
      const rendered = await rendering;
      await new Promise(resolve => setTimeout(resolve, 0));
      return { samples: rendered.getChannelData(0), diagnostics };
    };

    const points = [0, .25, .5, .6, .7, .75, .8, .85, .9, .95, 1];
    const current = {};
    const soft = {};
    for (const resonance of points) {
      current[resonance] = (await render({ resonance })).diagnostics.at(-1).mainFeedbackGain;
      soft[resonance] = (await render({ resonance, curve: 'soft-knee' })).diagnostics.at(-1).mainFeedbackGain;
    }
    const commonCurrent = await render({ resonance: .9 });
    const commonSoft = await render({ resonance: .9, curve: 'soft-knee' });
    const localCurrent = await render({ resonance: .9, topology: 'local-loop-exp' });
    const localSoft = await render({ resonance: .9, topology: 'local-loop-exp', curve: 'soft-knee' });
    const localBusCurrent = await render({ resonance: .9, feedbackAll: false, feedbackBandLeft: oneGate(4) });
    const localBusSoft = await render({ resonance: .9, curve: 'soft-knee', feedbackAll: false, feedbackBandLeft: oneGate(4) });
    const negativeCurrent = await render({ resonance: -.9 });
    const negativeSoft = await render({ resonance: -.9, curve: 'soft-knee' });
    const live = await render({
      resonance: .9,
      event: { time: .14, message: { type: 'set-feedback-all-resonance-curve', value: 'soft-knee' } }
    });
    const dense = Array.from({ length: 1001 }, (_, index) => softKnee(index / 1000));
    const step = 1e-5;
    const derivative = point => (softKnee(point + step) - softKnee(point - step)) / (2 * step);
    return {
      points, current, soft,
      denseFinite: dense.every(value => Number.isFinite(value)),
      denseBounded: dense.every(value => value >= 0 && value <= 1),
      denseMonotonic: dense.every((value, index) => index === 0 || value >= dense[index - 1]),
      jointValueGaps: [.5, .75, .95].map(point => Math.abs(softKnee(point - step) - softKnee(point + step))),
      jointDerivativeGaps: [.5, .75, .95].map(point => Math.abs(derivative(point - step) - derivative(point + step))),
      commonDifference: maxDifference(commonCurrent.samples, commonSoft.samples),
      localDifference: maxDifference(localCurrent.samples, localSoft.samples),
      localBusDifference: maxDifference(localBusCurrent.samples, localBusSoft.samples),
      negativeDifference: maxDifference(negativeCurrent.samples, negativeSoft.samples),
      localGain: [localCurrent.diagnostics.at(-1).mainFeedbackGain, localSoft.diagnostics.at(-1).mainFeedbackGain],
      liveGains: live.diagnostics.map(packet => packet.mainFeedbackGain),
      liveReturnPeak: Math.max(...live.diagnostics.map(packet => packet.mainCommonFeedbackReturnPeak))
    };
  });

  report.points.forEach(resonance => expect(report.current[resonance]).toBeCloseTo(1.25 * resonance * resonance, 12));
  expect(report.soft[0]).toBe(0);
  expect(report.soft[1]).toBe(1.25);
  expect(report.soft[.75]).toBeCloseTo(.7, 12);
  expect(report.soft[.9]).toBeCloseTo(.925, 12);
  expect(report.soft[.95]).toBeCloseTo(1, 12);
  expect(report.denseFinite).toBeTruthy();
  expect(report.denseBounded).toBeTruthy();
  expect(report.denseMonotonic).toBeTruthy();
  expect(report.jointValueGaps.every(value => value < 3e-5)).toBeTruthy();
  expect(report.jointDerivativeGaps.every(value => value < 2e-3)).toBeTruthy();
  expect(report.commonDifference).toBeGreaterThan(1e-6);
  expect(report.localDifference).toBe(0);
  expect(report.localBusDifference).toBe(0);
  expect(report.negativeDifference).toBe(0);
  expect(report.localGain[0]).toBeCloseTo(1.0125, 12);
  expect(report.localGain[1]).toBeCloseTo(1.0125, 12);
  expect(report.liveGains.some(value => Math.abs(value - 1.0125) < 1e-9)).toBeTruthy();
  expect(report.liveGains.some(value => Math.abs(value - .925) < 1e-9)).toBeTruthy();
  expect(report.liveReturnPeak).toBeGreaterThan(1e-6);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
