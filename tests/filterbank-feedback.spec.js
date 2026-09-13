const { test, expect } = require('playwright/test');

test('AudioWorklet feedback, FB ALL and resonance remain finite, stereo-isolated and additive', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const bandCount = window.ResonantState.BAND_COUNT;
    const neutral = () => Array(bandCount).fill(0);
    const gates = () => Array(bandCount).fill(false);
    const oneGate = index => Array.from({ length: bandCount }, (_, currentIndex) => currentIndex === index);
    const allGates = () => Array(bandCount).fill(true);
    const oneBand = (index, control) => Array.from({ length: bandCount }, (_, currentIndex) => currentIndex === index ? control : 0);
    const createInput = (context, signal, frequency) => {
      const buffer = context.createBuffer(2, context.length, context.sampleRate);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      for (let frame = 0; frame < context.length; frame += 1) {
        if (signal === 'impulse') {
          left[frame] = frame === 0 ? 0.1 : 0;
          right[frame] = frame === 0 ? -0.08 : 0;
        } else {
          const phase = 2 * Math.PI * frequency * frame / context.sampleRate;
          left[frame] = 0.04 * Math.sin(phase);
          right[frame] = 0.035 * Math.sin(phase + 0.29);
        }
      }
      return buffer;
    };

    const render = async ({
      sampleRate = 48000,
      duration = 0.75,
      signal = 'impulse',
      frequency = 411,
      bandGainLeft = neutral(),
      bandGainRight = neutral(),
      feedbackBandLeft = gates(),
      feedbackBandRight = gates(),
      feedbackAllLeft = false,
      feedbackAllRight = false,
      resonance = 0
    } = {}) => {
      const context = new OfflineAudioContext(2, Math.round(sampleRate * duration), sampleRate);
      const source = context.createBufferSource();
      source.buffer = createInput(context, signal, frequency);
      const filterbank = await window.Filterbank.create(context, {
        bandGainLeft,
        bandGainRight,
        feedbackBandLeft,
        feedbackBandRight,
        feedbackAllLeft,
        feedbackAllRight,
        resonance
      });
      source.connect(filterbank.input);
      filterbank.output.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      filterbank.dispose();
      return { input: source.buffer, output };
    };

    const compare = (first, second) => {
      const metrics = { leftMaxError: 0, rightMaxError: 0 };
      for (let channel = 0; channel < 2; channel += 1) {
        const firstData = first.output.getChannelData(channel);
        const secondData = second.output.getChannelData(channel);
        for (let frame = 0; frame < firstData.length; frame += 1) {
          const error = Math.abs(firstData[frame] - secondData[frame]);
          if (channel === 0) metrics.leftMaxError = Math.max(metrics.leftMaxError, error);
          else metrics.rightMaxError = Math.max(metrics.rightMaxError, error);
        }
      }
      return metrics;
    };

    const metrics = renderResult => {
      const values = { leftTailRms: 0, rightTailRms: 0, leftTailMax: 0, rightTailMax: 0, maxAbs: 0, finite: true, firstLeft: 0, firstRight: 0 };
      const start = 1;
      const end = Math.min(renderResult.output.length, Math.max(128, Math.round(renderResult.output.sampleRate * 0.14)));
      const left = renderResult.output.getChannelData(0);
      const right = renderResult.output.getChannelData(1);
      values.firstLeft = left[0];
      values.firstRight = right[0];
      for (let frame = 0; frame < left.length; frame += 1) {
        if (!Number.isFinite(left[frame]) || !Number.isFinite(right[frame])) values.finite = false;
        values.maxAbs = Math.max(values.maxAbs, Math.abs(left[frame]), Math.abs(right[frame]));
        if (frame >= start && frame < end) {
          values.leftTailRms += left[frame] ** 2;
          values.rightTailRms += right[frame] ** 2;
          values.leftTailMax = Math.max(values.leftTailMax, Math.abs(left[frame]));
          values.rightTailMax = Math.max(values.rightTailMax, Math.abs(right[frame]));
        }
      }
      const count = end - start;
      values.leftTailRms = Math.sqrt(values.leftTailRms / count);
      values.rightTailRms = Math.sqrt(values.rightTailRms / count);
      return values;
    };

    const reference = await render({ sampleRate: 44100, signal: 'sine', frequency: 411, bandGainLeft: oneBand(4, 50), bandGainRight: oneBand(4, -50) });
    const resonanceWithoutFeedback = await render({ sampleRate: 44100, signal: 'sine', frequency: 411, bandGainLeft: oneBand(4, 50), bandGainRight: oneBand(4, -50), resonance: 1 });
    const localAtZero = await render({ sampleRate: 44100, signal: 'sine', frequency: 411, bandGainLeft: oneBand(4, 50), bandGainRight: oneBand(4, -50), feedbackBandLeft: oneGate(4), feedbackBandRight: oneGate(4), resonance: 0 });
    const allAtZero = await render({ sampleRate: 48000, signal: 'sine', frequency: 777, bandGainLeft: oneBand(5, 50), bandGainRight: oneBand(5, -50), feedbackAllLeft: true, feedbackAllRight: true, resonance: 0 });
    const allAtZeroReference = await render({ sampleRate: 48000, signal: 'sine', frequency: 777, bandGainLeft: oneBand(5, 50), bandGainRight: oneBand(5, -50) });

    const perBand = {};
    for (const index of [0, 4, 9]) {
      perBand[index] = {};
      for (const resonance of [0.25, 0.5, 1, -0.25, -0.5, -1]) {
        perBand[index][resonance] = metrics(await render({
          sampleRate: index === 9 ? 48000 : 44100,
          signal: 'impulse',
          feedbackBandLeft: oneGate(index),
          resonance
        }));
      }
    }

    const fbAll = {};
    for (const resonance of [0.25, 0.5, 1, -0.25, -0.5, -1]) {
      fbAll[resonance] = metrics(await render({
        sampleRate: resonance > 0 ? 44100 : 48000,
        signal: 'impulse',
        feedbackAllLeft: true,
        resonance
      }));
    }

    const localOnly = await render({ sampleRate: 48000, signal: 'impulse', feedbackBandLeft: oneGate(4), resonance: 0.75 });
    const allOnly = await render({ sampleRate: 48000, signal: 'impulse', feedbackAllLeft: true, resonance: 0.75 });
    const localAndAll = await render({ sampleRate: 48000, signal: 'impulse', feedbackBandLeft: oneGate(4), feedbackAllLeft: true, resonance: 0.75 });
    const leftOnly = await render({ sampleRate: 44100, signal: 'impulse', feedbackBandLeft: oneGate(6), resonance: 1 });
    const rightOnly = await render({ sampleRate: 48000, signal: 'impulse', feedbackBandRight: oneGate(6), resonance: 1 });
    const longPositive = metrics(await render({ sampleRate: 48000, duration: 2, signal: 'impulse', feedbackBandLeft: allGates(), feedbackAllLeft: true, resonance: 1 }));
    const longNegative = metrics(await render({ sampleRate: 48000, duration: 2, signal: 'impulse', feedbackBandLeft: allGates(), feedbackAllLeft: true, resonance: -1 }));
    const longStereo = metrics(await render({ sampleRate: 44100, duration: 2, signal: 'impulse', feedbackBandLeft: allGates(), feedbackBandRight: allGates(), feedbackAllLeft: true, feedbackAllRight: true, resonance: 1 }));

    return {
      noFeedbackDifference: compare(reference, resonanceWithoutFeedback),
      localAtZeroDifference: compare(reference, localAtZero),
      allAtZeroDifference: compare(allAtZeroReference, allAtZero),
      perBand,
      fbAll,
      localOnly: metrics(localOnly),
      allOnly: metrics(allOnly),
      localAndAll: metrics(localAndAll),
      localAllDifference: compare(allOnly, localAndAll),
      initialAuditionDifference: {
        left: Math.abs(allOnly.output.getChannelData(0)[0] - localAndAll.output.getChannelData(0)[0]),
        right: Math.abs(allOnly.output.getChannelData(1)[0] - localAndAll.output.getChannelData(1)[0])
      },
      leftOnly: metrics(leftOnly),
      leftOnlyRightDifference: compare(leftOnly, await render({ sampleRate: 44100, signal: 'impulse' })).rightMaxError,
      rightOnly: metrics(rightOnly),
      rightOnlyLeftDifference: compare(rightOnly, await render({ sampleRate: 48000, signal: 'impulse' })).leftMaxError,
      longPositive,
      longNegative,
      longStereo,
      constants: {
        normalization: window.Filterbank.FEEDBACK_ALL_NORMALIZATION,
        maxFeedbackGain: window.Filterbank.MAX_FEEDBACK_GAIN,
        maxAuditionGain: window.Filterbank.MAX_AUDITION_GAIN,
        feedbackGateSmoothing: window.Filterbank.FEEDBACK_GATE_SMOOTHING_SECONDS,
        resonanceSmoothing: window.Filterbank.RESONANCE_SMOOTHING_SECONDS
      }
    };
  });

  expect(result.noFeedbackDifference.leftMaxError).toBeLessThanOrEqual(1e-6);
  expect(result.noFeedbackDifference.rightMaxError).toBeLessThanOrEqual(1e-6);
  expect(result.localAtZeroDifference.leftMaxError).toBeLessThanOrEqual(1e-6);
  expect(result.localAtZeroDifference.rightMaxError).toBeLessThanOrEqual(1e-6);
  expect(result.allAtZeroDifference.leftMaxError).toBeLessThanOrEqual(1e-6);
  expect(result.allAtZeroDifference.rightMaxError).toBeLessThanOrEqual(1e-6);

  for (const values of Object.values(result.perBand)) {
    for (const metrics of Object.values(values)) {
      expect(metrics.finite).toBeTruthy();
      expect(metrics.leftTailMax).toBeGreaterThan(1e-9);
    }
    expect(values['1'].leftTailRms).toBeGreaterThan(values['0.25'].leftTailRms);
    expect(values['-1'].leftTailRms).toBeGreaterThan(values['-0.25'].leftTailRms);
    expect(Math.abs(values['1'].leftTailRms - values['-1'].leftTailRms)).toBeGreaterThan(1e-8);
    expect(Math.abs(values['1'].firstLeft - values['-1'].firstLeft)).toBeLessThanOrEqual(1e-6);
  }
  for (const metrics of Object.values(result.fbAll)) {
    expect(metrics.finite).toBeTruthy();
    expect(metrics.leftTailMax).toBeGreaterThan(1e-9);
  }
  expect(Math.abs(result.fbAll['1'].leftTailRms - result.fbAll['-1'].leftTailRms)).toBeGreaterThan(1e-8);

  expect(result.localOnly.finite).toBeTruthy();
  expect(result.allOnly.finite).toBeTruthy();
  expect(result.localAndAll.finite).toBeTruthy();
  expect(result.localAllDifference.leftMaxError).toBeGreaterThan(1e-8);
  expect(result.initialAuditionDifference.left).toBeLessThanOrEqual(1e-6);
  expect(result.initialAuditionDifference.right).toBeLessThanOrEqual(1e-6);
  expect(result.leftOnly.finite).toBeTruthy();
  expect(result.rightOnly.finite).toBeTruthy();
  expect(result.leftOnlyRightDifference).toBeLessThanOrEqual(1e-6);
  expect(result.rightOnlyLeftDifference).toBeLessThanOrEqual(1e-6);

  for (const metrics of [result.longPositive, result.longNegative, result.longStereo]) {
    expect(metrics.finite).toBeTruthy();
    expect(metrics.maxAbs).toBeLessThan(100);
  }
  expect(result.constants.normalization).toBeCloseTo(1 / Math.sqrt(10), 12);
  expect(result.constants.maxFeedbackGain).toBe(1.25);
  expect(result.constants.maxAuditionGain).toBe(0.25);
  expect(result.constants.feedbackGateSmoothing).toBe(0.008);
  expect(result.constants.resonanceSmoothing).toBe(0.015);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
