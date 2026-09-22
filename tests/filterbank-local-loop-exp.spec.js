const { test, expect } = require('playwright/test');

test('LOCAL LOOP EXP keeps individual feedback returns local and coexists with MAIN', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-feedback-topology] option')).toHaveText(['ISOLATED TPT', 'COMMON BUS', 'LOCAL LOOP EXP']);

  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const bandCount = frequencies.length;
    const moduleUrl = new URL('/filterbank-processor.js', location.href).href;
    const zeros = () => Array(bandCount).fill(0);
    const gates = indexes => Array.from({ length: bandCount }, (_, index) => indexes.includes(index));
    const maxDifference = (first, second) => first.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - second[index])), 0);

    const render = async ({
      topology = 'local-loop-exp', activeBands = [4], feedbackAll = false,
      feedbackAllEngine = 'legacy', feedbackAllAmount = 100, resonance = 1, event = null
    } = {}) => {
      const sampleRate = 48000;
      const duration = 0.75;
      const length = Math.round(sampleRate * duration);
      const context = new OfflineAudioContext(2, length, sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const input = context.createBuffer(2, length, sampleRate);
      const left = input.getChannelData(0);
      for (let frame = 0; frame < Math.round(sampleRate * 0.05); frame += 1) {
        left[frame] = 0.03 * Math.sin((2 * Math.PI * 411 * frame) / sampleRate);
      }
      const diagnostics = [];
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
        channelCountMode: 'explicit', channelInterpretation: 'discrete',
        processorOptions: {
          bandFrequencies: frequencies, bandQs: qs,
          bandGainLeft: zeros(), bandGainRight: zeros(),
          feedbackBandLeft: gates(activeBands), feedbackBandRight: zeros(),
          feedbackAllLeft: feedbackAll, feedbackAllRight: false,
          resonance, maxBandGainDb: 12, maxBandBoostDb: 12, maxBandCutDb: 12,
          smoothingTime: 0.015, feedbackGateSmoothingTime: 0.008, resonanceSmoothingTime: 0.015,
          feedbackAllNormalization: 1 / Math.sqrt(bandCount), maxFeedbackGain: 1.25,
          feedbackTopology: topology, feedbackTap: 'pre-gain', wetModel: 'filterbank-sum',
          commonBusSaturationMode: 'current', commonBusDrive: 1, commonBusCeiling: 1,
          feedbackAllEngine, feedbackAllSource: 'pre-gain-sum', feedbackAllLevel: 'raw', feedbackAllAmount,
          collectResonatorDiagnostics: true
        }
      });
      node.port.onmessage = message => {
        if (message.data?.type === 'resonator-diagnostics') diagnostics.push(message.data.left);
      };
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
      const localPeak = Array(bandCount).fill(0);
      for (const packet of diagnostics) {
        packet.localFeedbackReturnPeak.forEach((value, index) => { localPeak[index] = Math.max(localPeak[index], value); });
      }
      return {
        samples: rendered.getChannelData(0),
        localPeak,
        latest: diagnostics.at(-1)
      };
    };

    const single = await render({ activeBands: [4] });
    const multiple = await render({ activeBands: [2, 5] });
    const common = await render({ topology: 'common-bus', activeBands: [4] });
    const dual = await render({ activeBands: [4], feedbackAll: true, feedbackAllEngine: 'common-bus' });
    const dualAmount0 = await render({ activeBands: [4], feedbackAll: true, feedbackAllEngine: 'common-bus', feedbackAllAmount: 0 });
    const dualAmount25 = await render({ activeBands: [4], feedbackAll: true, feedbackAllEngine: 'common-bus', feedbackAllAmount: 25 });
    const switched = await render({ event: { time: 0.3, message: { type: 'set-feedback-topology', value: 'common-bus' } } });
    const panicked = await render({ event: { time: 0.3, message: { type: 'panic' } } });
    const negativeLocal = await render({ topology: 'local-loop-exp', activeBands: [4], resonance: -0.75 });
    const negativeIsolated = await render({ topology: 'isolated-tpt', activeBands: [4], resonance: -0.75 });

    return {
      single,
      multiple,
      common,
      dual,
      dualAmount0,
      dualAmount25,
      switched,
      panicked,
      negativeDifference: maxDifference(negativeLocal.samples, negativeIsolated.samples)
    };
  });

  expect(report.single.localPeak[4]).toBeGreaterThan(1e-6);
  expect(report.single.localPeak.filter((value, index) => index !== 4).every(value => value === 0)).toBeTruthy();
  expect(report.single.latest.baseBandEnergy[4]).toBeGreaterThan(100 * Math.max(...report.single.latest.baseBandEnergy.filter((value, index) => index !== 4)));

  expect(report.multiple.localPeak[2]).toBeGreaterThan(1e-6);
  expect(report.multiple.localPeak[5]).toBeGreaterThan(1e-6);
  expect(report.multiple.localPeak.filter((value, index) => index !== 2 && index !== 5).every(value => value === 0)).toBeTruthy();

  expect(report.common.latest.commonFeedbackReturnPeak).toBeGreaterThan(1e-6);
  expect(report.common.localPeak.every(value => value === 0)).toBeTruthy();

  expect(report.dual.localPeak[4]).toBeGreaterThan(1e-6);
  expect(report.dual.latest.mainCommonFeedbackReturnPeak).toBeGreaterThan(1e-6);
  expect(report.dualAmount0.latest.mainCommonFeedbackReturnPeak).toBe(0);
  expect(report.dualAmount0.localPeak).toEqual(report.single.localPeak);
  expect(report.dualAmount25.localPeak[4]).toBeGreaterThan(1e-6);
  expect(report.dualAmount25.latest.mainCommonFeedbackReturnPeak).toBeGreaterThan(1e-7);
  expect(report.switched.latest.localFeedbackReturnPeak.every(value => value === 0)).toBeTruthy();
  expect(report.panicked.latest.localFeedbackReturnPeak.every(value => value === 0)).toBeTruthy();
  expect(report.negativeDifference).toBeLessThan(1e-12);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
