const { test, expect } = require('playwright/test');

test('LOCAL LOOP COMPENSATED retunes only the four scoped bands at the active sample rate', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/', { waitUntil: 'networkidle' });

  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const moduleUrl = new URL('/filterbank-processor.js', location.href).href;
    const render = async ({ sampleRate, topology, tuning, feedbackAll = false, engine = 'tpt' }) => {
      const length = Math.round(sampleRate * 0.16);
      const context = new OfflineAudioContext(2, length, sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(2, length, sampleRate);
      const diagnostics = [];
      const node = new AudioWorkletNode(context, 'da-filta-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: {
          bandFrequencies: frequencies, bandQs: qs,
          bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
          feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === 5),
          feedbackBandRight: Array(10).fill(false),
          feedbackAllLeft: feedbackAll, feedbackAllRight: false,
          resonance: 1, maxBandGainDb: 12, maxBandBoostDb: 12, maxBandCutDb: 12,
          feedbackTopology: topology, localLoopTuning: tuning, positiveResonanceEngine: engine, feedbackTap: 'pre-gain', wetModel: 'filterbank-sum',
          feedbackAllEngine: 'common-bus', feedbackAllSource: 'pre-gain-sum', feedbackAllLevel: 'raw',
          commonBusSaturationMode: 'current', commonBusDrive: 1, commonBusCeiling: 1,
          smoothingTime: 0.015, feedbackGateSmoothingTime: 0.008, resonanceSmoothingTime: 0.015,
          feedbackAllNormalization: 1 / Math.sqrt(10), maxFeedbackGain: 1.25,
          collectResonatorDiagnostics: true
        }
      });
      node.port.onmessage = event => { if (event.data?.type === 'resonator-diagnostics') diagnostics.push(event.data.left); };
      source.connect(node); node.connect(context.destination); source.start();
      await context.startRendering();
      await new Promise(resolve => setTimeout(resolve, 0));
      return diagnostics.at(-1);
    };
    return {
      nominal441: await render({ sampleRate: 44100, topology: 'local-loop-exp', tuning: 'current' }),
      compensated441: await render({ sampleRate: 44100, topology: 'local-loop-exp', tuning: 'compensated' }),
      compensated480: await render({ sampleRate: 48000, topology: 'local-loop-exp', tuning: 'compensated' }),
      common480: await render({ sampleRate: 48000, topology: 'common-bus', tuning: 'compensated', feedbackAll: true }),
      isolated480: await render({ sampleRate: 48000, topology: 'isolated-tpt', tuning: 'compensated' }),
      phase2Local480: await render({ sampleRate: 48000, topology: 'local-loop-exp', tuning: 'compensated', engine: 'phase2' })
    };
  });

  const nominal = [29, 61, 115, 218, 411, 777, 1500, 2800, 5200, 11000];
  const compensatedIndexes = [3, 5, 6, 7];
  const expectNominal = packet => {
    expect(packet.localLoopTuning).toBeDefined();
    expect(packet.baseFilterFrequencies).toEqual(nominal);
    expect(packet.baseFilterFrequencies.every(Number.isFinite)).toBeTruthy();
  };
  const expectScopedCompensation = (packet, expected) => {
    expect(packet.localLoopTuning).toBe('compensated');
    packet.baseFilterFrequencies.forEach((value, index) => {
      if (compensatedIndexes.includes(index)) expect(value).toBeCloseTo(expected[compensatedIndexes.indexOf(index)], 6);
      else expect(value).toBe(nominal[index]);
    });
    expect(packet.baseFilterFrequencies.every(Number.isFinite)).toBeTruthy();
  };

  expect(report.nominal441.localLoopTuning).toBe('current');
  expectNominal(report.nominal441);
  expectScopedCompensation(report.compensated441, [220.200969, 806.057220, 1608.006148, 3184.254639]);
  expectScopedCompensation(report.compensated480, [220.021269, 803.649014, 1598.848330, 3149.924101]);
  expectNominal(report.common480);
  expectNominal(report.isolated480);
  expectNominal(report.phase2Local480);
  expect(report.common480.feedbackTopology).toBe('common-bus');
  expect(report.common480.mainCommonFeedbackReturnPeak).toBeGreaterThanOrEqual(0);
});

test('DEV LOCAL LOOP TUNING is a CURRENT-by-default LOCAL FEEDBACK control', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const tuning = page.locator('[data-local-loop-tuning]');
  await expect(tuning).toHaveValue('current');
  await expect(tuning.locator('option')).toHaveText(['CURRENT', 'COMPENSATED']);
  expect(await tuning.locator('xpath=ancestor::section[@data-dev-lab-group]').getAttribute('data-dev-lab-group')).toBe('local-feedback');
  await tuning.selectOption('compensated');
  await expect(tuning).toHaveValue('compensated');
});