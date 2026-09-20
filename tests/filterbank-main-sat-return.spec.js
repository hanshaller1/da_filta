const { test, expect } = require('playwright/test');

test('MAIN common-bus drive/return A/B preserves non-MAIN paths and exact saturation formulas', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const selector = page.locator('[data-feedback-all-saturation-return]');
  await expect(selector).toHaveValue('current');
  expect(await selector.locator('option').allTextContents()).toEqual(['CURRENT', 'DRIVE 4 / RETURN 0.2']);
  await selector.selectOption('drive-4-return-0.2');
  await expect(selector).toHaveValue('drive-4-return-0.2');
  await selector.selectOption('current');

  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const count = frequencies.length;
    const moduleUrl = new URL('/filterbank-processor.js', location.href).href;
    const zeros = () => Array(count).fill(0);
    const oneGate = index => Array.from({ length: count }, (_, band) => band === index);
    const maxDifference = (a, b) => a.reduce((max, value, index) => Math.max(max, Math.abs(value - b[index])), 0);
    const render = async ({
      mode = 'current', topology = 'common-bus', resonance = .9, feedbackAll = true,
      feedbackAllEngine = 'common-bus', feedbackBandLeft = zeros(), level = 'raw', ceiling = 'current', event = null
    } = {}) => {
      const sampleRate = 48000;
      const duration = event ? .34 : .12;
      const context = new OfflineAudioContext(2, Math.round(sampleRate * duration), sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const buffer = context.createBuffer(2, Math.round(sampleRate * duration), sampleRate);
      const left = buffer.getChannelData(0);
      for (let frame = 0; frame < left.length; frame += 1) left[frame] = .01 * Math.sin((2 * Math.PI * 411 * frame) / sampleRate);
      const diagnostics = [];
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
        channelCountMode: 'explicit', channelInterpretation: 'discrete',
        processorOptions: {
          bandFrequencies: frequencies, bandQs: qs, bandGainLeft: zeros(), bandGainRight: zeros(),
          feedbackBandLeft, feedbackBandRight: zeros(), feedbackAllLeft: feedbackAll, feedbackAllRight: false,
          resonance, maxBandGainDb: 12, maxBandBoostDb: 12, maxBandCutDb: 12,
          smoothingTime: .015, feedbackGateSmoothingTime: .008, resonanceSmoothingTime: .015,
          feedbackAllNormalization: 1 / Math.sqrt(count), maxFeedbackGain: 1.25,
          feedbackTopology: topology, feedbackTap: 'post-gain', wetModel: 'filterbank-sum',
          commonBusSaturationMode: ceiling, commonBusDrive: 8, commonBusCeiling: .5,
          feedbackAllEngine, feedbackAllSource: 'post-gain-sum', feedbackAllLevel: level,
          feedbackAllResonanceCurve: 'current', feedbackAllSaturationReturn: mode,
          collectResonatorDiagnostics: true
        }
      });
      node.port.onmessage = message => { if (message.data?.type === 'resonator-diagnostics') diagnostics.push(message.data.left); };
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(node).connect(context.destination); source.start();
      const suspend = event && context.suspend(event.time).then(async () => { node.port.postMessage(event.message); await context.resume(); });
      const rendering = context.startRendering(); if (suspend) await suspend;
      const rendered = await rendering; await new Promise(resolve => setTimeout(resolve, 0));
      return { samples: rendered.getChannelData(0), diagnostics };
    };
    const current = await render();
    const experiment = await render({ mode: 'drive-4-return-0.2' });
    const ceilingCurrent = await render({ ceiling: 'constant-ceiling' });
    const ceilingExperiment = await render({ ceiling: 'constant-ceiling', mode: 'drive-4-return-0.2' });
    const localCurrent = await render({ feedbackAll: false, feedbackBandLeft: oneGate(4) });
    const localExperiment = await render({ mode: 'drive-4-return-0.2', feedbackAll: false, feedbackBandLeft: oneGate(4) });
    const loopCurrent = await render({ topology: 'local-loop-exp' });
    const loopExperiment = await render({ topology: 'local-loop-exp', mode: 'drive-4-return-0.2' });
    const negativeCurrent = await render({ resonance: -.9 });
    const negativeExperiment = await render({ resonance: -.9, mode: 'drive-4-return-0.2' });
    const raw = await render({ level: 'raw' });
    const sqrt10 = await render({ level: 'sqrt10' });
    const live = await render({ event: { time: .14, message: { type: 'set-feedback-all-saturation-return', value: 'drive-4-return-0.2' } } });
    const last = result => result.diagnostics.at(-1);
    return {
      current: last(current), experiment: last(experiment),
      ceilingDifference: maxDifference(ceilingCurrent.samples, ceilingExperiment.samples),
      localDifference: maxDifference(localCurrent.samples, localExperiment.samples),
      loopDifference: maxDifference(loopCurrent.samples, loopExperiment.samples),
      negativeDifference: maxDifference(negativeCurrent.samples, negativeExperiment.samples),
      rawScaled: last(raw).firstMainTapSumScaled, sqrtScaled: last(sqrt10).firstMainTapSumScaled,
      liveModes: live.diagnostics.map(item => item.mainSaturationReturnMode),
      liveFinite: live.samples.every(Number.isFinite)
    };
  });

  const formula = packet => ({ input: packet.mainSaturationInput, output: packet.mainSaturationOutput, returned: packet.mainCommonFeedbackReturn });
  const current = formula(report.current);
  const experiment = formula(report.experiment);
  expect(current.output).toBeCloseTo(Math.tanh(current.input), 12);
  expect(current.returned).toBeCloseTo(current.output, 12);
  expect(experiment.output).toBeCloseTo(Math.tanh(4 * experiment.input), 12);
  expect(experiment.returned).toBeCloseTo(.2 * experiment.output, 12);
  expect(Math.abs(experiment.returned)).toBeLessThanOrEqual(.2 + 1e-12);
  expect(Math.abs(.2 * 4 - .8)).toBeLessThan(1e-12);
  expect(report.ceilingDifference).toBe(0);
  expect(report.localDifference).toBe(0);
  expect(report.loopDifference).toBe(0);
  expect(report.negativeDifference).toBe(0);
  expect(report.rawScaled / report.sqrtScaled).toBeCloseTo(Math.sqrt(10), 9);
  expect(report.liveModes).toContain('current');
  expect(report.liveModes).toContain('drive-4-return-0.2');
  expect(report.liveFinite).toBeTruthy();
  expect(pageErrors).toEqual([]);
});
