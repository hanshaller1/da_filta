const { test, expect } = require('playwright/test');

test('POST GAIN FB WEIGHT soft knee only changes the MAIN POST-GAIN sum', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const selector = page.locator('[data-post-gain-feedback-weight]');
  await expect(selector).toHaveValue('current');
  expect(await selector.locator('option').allTextContents()).toEqual(['CURRENT', 'SOFT KNEE']);

  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const count = frequencies.length;
    const moduleUrl = new URL('/filterbank-processor.js', location.href).href;
    const zeros = () => Array(count).fill(0);
    const gate = index => Array.from({ length: count }, (_, band) => band === index);
    const maxDifference = (a, b) => a.reduce((max, value, index) => Math.max(max, Math.abs(value - b[index])), 0);
    const render = async ({
      control = 100, boost = 24, cut = 12, weight = 'current', source = 'post-gain-sum',
      feedbackAll = true, local = false, wetModel = 'filterbank-sum', level = 'raw',
      mainReturn = 'current', live = false
    } = {}) => {
      const sampleRate = 48000;
      const duration = live ? .36 : .12;
      const context = new OfflineAudioContext(2, Math.round(sampleRate * duration), sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const buffer = context.createBuffer(2, Math.round(sampleRate * duration), sampleRate);
      const left = buffer.getChannelData(0);
      for (let frame = 0; frame < left.length; frame += 1) {
        left[frame] = .002 * Math.sin((2 * Math.PI * 411 * frame) / sampleRate);
      }
      const bandGainLeft = zeros();
      bandGainLeft[4] = control;
      const diagnostics = [];
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
        channelCountMode: 'explicit', channelInterpretation: 'discrete',
        processorOptions: {
          bandFrequencies: frequencies, bandQs: qs, bandGainLeft, bandGainRight: zeros(),
          feedbackBandLeft: local ? gate(4) : zeros(), feedbackBandRight: zeros(),
          feedbackAllLeft: feedbackAll, feedbackAllRight: false, resonance: .05,
          maxBandGainDb: 12, maxBandBoostDb: boost, maxBandCutDb: cut,
          smoothingTime: .015, feedbackGateSmoothingTime: .008, resonanceSmoothingTime: .015,
          feedbackAllNormalization: 1 / Math.sqrt(count), maxFeedbackGain: 1.25,
          feedbackTopology: 'common-bus', feedbackTap: 'post-gain', wetModel,
          commonBusSaturationMode: 'current', commonBusDrive: 1, commonBusCeiling: 1,
          feedbackAllEngine: 'common-bus', feedbackAllSource: source, postGainFeedbackWeight: weight,
          feedbackAllLevel: level, feedbackAllResonanceCurve: 'current', feedbackAllSaturationReturn: mainReturn,
          collectResonatorDiagnostics: true
        }
      });
      node.port.onmessage = event => { if (event.data?.type === 'resonator-diagnostics') diagnostics.push(event.data.left); };
      const input = context.createBufferSource(); input.buffer = buffer; input.connect(node).connect(context.destination); input.start();
      const switchWeight = live && context.suspend(.16).then(async () => {
        node.port.postMessage({ type: 'set-post-gain-feedback-weight', value: 'soft-knee' });
        await context.resume();
      });
      const rendering = context.startRendering();
      if (switchWeight) await switchWeight;
      const rendered = await rendering;
      await new Promise(resolve => setTimeout(resolve, 0));
      return { samples: rendered.getChannelData(0), diagnostics, last: diagnostics.at(-1) };
    };

    const current24 = await render();
    const softNegative = await render({ control: -100, weight: 'soft-knee' });
    const softZero = await render({ control: 0, weight: 'soft-knee' });
    const soft6 = await render({ control: 25, weight: 'soft-knee' });
    const soft12 = await render({ control: 50, weight: 'soft-knee' });
    const soft18 = await render({ control: 75, weight: 'soft-knee' });
    const soft24 = await render({ control: 100, weight: 'soft-knee' });
    const dense = [];
    for (let control = 0; control <= 100; control += 10) dense.push(await render({ control, weight: 'soft-knee' }));
    const preCurrent = await render({ weight: 'current', source: 'pre-gain-sum' });
    const preSoft = await render({ weight: 'soft-knee', source: 'pre-gain-sum' });
    const localCurrent = await render({ weight: 'current', feedbackAll: false, local: true });
    const localSoft = await render({ weight: 'soft-knee', feedbackAll: false, local: true });
    const sumCurrent = await render({ weight: 'current', feedbackAll: false, wetModel: 'filterbank-sum' });
    const sumSoft = await render({ weight: 'soft-knee', feedbackAll: false, wetModel: 'filterbank-sum' });
    const refCurrent = await render({ weight: 'current', feedbackAll: false, wetModel: 'reference-delta' });
    const refSoft = await render({ weight: 'soft-knee', feedbackAll: false, wetModel: 'reference-delta' });
    const raw = await render({ weight: 'soft-knee', level: 'raw' });
    const sqrt10 = await render({ weight: 'soft-knee', level: 'sqrt10' });
    const sat = await render({ weight: 'soft-knee', mainReturn: 'drive-4-return-0.2' });
    const live = await render({ live: true });
    const db = result => result.last.mainPostGainFeedbackWeightDb[4];
    return {
      current24: db(current24), soft: [db(softNegative), db(softZero), db(soft6), db(soft12), db(soft18), db(soft24)],
      dense: dense.map(db),
      preDifference: maxDifference(preCurrent.samples, preSoft.samples),
      localDifference: maxDifference(localCurrent.samples, localSoft.samples),
      sumDifference: maxDifference(sumCurrent.samples, sumSoft.samples),
      referenceDifference: maxDifference(refCurrent.samples, refSoft.samples),
      raw: raw.last, sqrt10: sqrt10.last, satMode: sat.last.mainSaturationReturnMode,
      liveModes: live.diagnostics.map(item => item.mainPostGainFeedbackWeightMode),
      finite: [current24, softNegative, softZero, soft6, soft12, soft18, soft24, ...dense, preCurrent, preSoft, localCurrent, localSoft, sumCurrent, sumSoft, refCurrent, refSoft, raw, sqrt10, sat, live]
        .every(result => result.samples.every(Number.isFinite) && result.diagnostics.every(item => item.mainPostGainFeedbackWeightDb.every(Number.isFinite)))
    };
  });

  expect(report.current24).toBeCloseTo(24, 10);
  expect(report.soft).toEqual(expect.arrayContaining([-12, 0, 6, 12]));
  expect(report.soft[4]).toBeCloseTo(15, 10);
  expect(report.soft[5]).toBeCloseTo(18, 10);
  expect(report.dense.every((value, index) => index === 0 || value >= report.dense[index - 1] - 1e-10)).toBeTruthy();
  expect(report.dense.every((value, index) => value <= index * 2.4 + 1e-10)).toBeTruthy();
  expect(report.preDifference).toBe(0);
  expect(report.localDifference).toBe(0);
  expect(report.sumDifference).toBe(0);
  expect(report.referenceDifference).toBe(0);
  expect(report.raw.mainFeedbackLevelScale).toBe(1);
  expect(report.sqrt10.mainFeedbackLevelScale).toBeCloseTo(1 / Math.sqrt(10), 12);
  expect(report.raw.firstMainTapSum).toBeCloseTo(report.sqrt10.firstMainTapSum, 12);
  expect(report.satMode).toBe('drive-4-return-0.2');
  expect(report.liveModes).toContain('current');
  expect(report.liveModes).toContain('soft-knee');
  expect(report.finite).toBeTruthy();
  expect(pageErrors).toEqual([]);
});
