const { test, expect } = require('playwright/test');

test('stereo AudioWorklet filterbank matches the native Biquad reference', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const bandCount = window.ResonantState.BAND_COUNT;
    const frequencies = window.Filterbank.BAND_FREQUENCIES;
    const qs = window.Filterbank.BAND_QS;
    const neutral = () => Array(bandCount).fill(0);
    const oneBand = (index, control) => Array.from({ length: bandCount }, (_, currentIndex) => currentIndex === index ? control : 0);
    const createInput = (context, signal, frequency) => {
      const frameCount = context.length;
      const input = context.createBuffer(2, frameCount, context.sampleRate);
      const left = input.getChannelData(0);
      const right = input.getChannelData(1);
      let sweepPhase = 0;
      for (let frame = 0; frame < frameCount; frame += 1) {
        if (signal === 'impulse') {
          left[frame] = frame === 0 ? 0.04 : 0;
          right[frame] = frame === 0 ? -0.03 : 0;
          continue;
        }
        if (signal === 'sweep') {
          const progress = frame / Math.max(1, frameCount - 1);
          const instantaneousFrequency = 25 * ((12000 / 25) ** progress);
          sweepPhase += 2 * Math.PI * instantaneousFrequency / context.sampleRate;
          left[frame] = 0.04 * Math.sin(sweepPhase);
          right[frame] = 0.035 * Math.sin(sweepPhase + 0.41);
          continue;
        }
        const phase = 2 * Math.PI * frequency * frame / context.sampleRate;
        left[frame] = 0.05 * Math.sin(phase);
        right[frame] = 0.04 * Math.sin(phase + 0.37);
      }
      return input;
    };

    const renderWorklet = async ({ sampleRate, signal = 'sine', frequency = 777, leftControls, rightControls }) => {
      const context = new OfflineAudioContext(2, Math.round(sampleRate * 0.45), sampleRate);
      const source = context.createBufferSource();
      source.buffer = createInput(context, signal, frequency);
      const filterbank = await window.Filterbank.create(context, {
        bandGainLeft: leftControls,
        bandGainRight: rightControls
      });
      source.connect(filterbank.input);
      filterbank.output.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      filterbank.dispose();
      return { input: source.buffer, output };
    };

    const renderNativeReference = async ({ sampleRate, signal = 'sine', frequency = 777, leftControls, rightControls }) => {
      const context = new OfflineAudioContext(2, Math.round(sampleRate * 0.45), sampleRate);
      const source = context.createBufferSource();
      source.buffer = createInput(context, signal, frequency);
      const splitter = context.createChannelSplitter(2);
      const merger = context.createChannelMerger(2);
      const sums = [context.createGain(), context.createGain()];
      sums.forEach(sum => { sum.gain.value = 1; });
      source.connect(splitter);
      splitter.connect(sums[0], 0, 0);
      splitter.connect(sums[1], 1, 0);
      for (let channel = 0; channel < 2; channel += 1) {
        const controls = channel === 0 ? leftControls : rightControls;
        for (let index = 0; index < bandCount; index += 1) {
          const filter = context.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.value = frequencies[index];
          filter.Q.value = qs[index];
          const delta = context.createGain();
          delta.gain.value = window.Filterbank.controlToDeltaGain(controls[index]);
          splitter.connect(filter, channel, 0);
          filter.connect(delta);
          delta.connect(sums[channel]);
        }
        sums[channel].connect(merger, 0, channel);
      }
      merger.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      return { input: source.buffer, output };
    };

    const collectMetrics = (nativeRender, workletRender) => {
      const metrics = {
        leftParityMaxError: 0,
        rightParityMaxError: 0,
        leftInputMaxError: 0,
        rightInputMaxError: 0,
        leftRms: 0,
        rightRms: 0,
        finite: true
      };
      const frameCount = workletRender.output.length;
      const measurementStart = Math.floor(frameCount * 0.5);
      const leftInput = workletRender.input.getChannelData(0);
      const rightInput = workletRender.input.getChannelData(1);
      const nativeLeft = nativeRender.output.getChannelData(0);
      const nativeRight = nativeRender.output.getChannelData(1);
      const workletLeft = workletRender.output.getChannelData(0);
      const workletRight = workletRender.output.getChannelData(1);
      for (let frame = 0; frame < frameCount; frame += 1) {
        const values = [nativeLeft[frame], nativeRight[frame], workletLeft[frame], workletRight[frame]];
        if (values.some(value => !Number.isFinite(value))) metrics.finite = false;
        metrics.leftParityMaxError = Math.max(metrics.leftParityMaxError, Math.abs(workletLeft[frame] - nativeLeft[frame]));
        metrics.rightParityMaxError = Math.max(metrics.rightParityMaxError, Math.abs(workletRight[frame] - nativeRight[frame]));
        metrics.leftInputMaxError = Math.max(metrics.leftInputMaxError, Math.abs(workletLeft[frame] - leftInput[frame]));
        metrics.rightInputMaxError = Math.max(metrics.rightInputMaxError, Math.abs(workletRight[frame] - rightInput[frame]));
        if (frame >= measurementStart) {
          metrics.leftRms += workletLeft[frame] ** 2;
          metrics.rightRms += workletRight[frame] ** 2;
        }
      }
      const measuredFrames = frameCount - measurementStart;
      metrics.leftRms = Math.sqrt(metrics.leftRms / measuredFrames);
      metrics.rightRms = Math.sqrt(metrics.rightRms / measuredFrames);
      return metrics;
    };

    const compareCase = async options => {
      const workletRender = await renderWorklet(options);
      const nativeRender = await renderNativeReference(options);
      return collectMetrics(nativeRender, workletRender);
    };

    const neutral44100 = await compareCase({ sampleRate: 44100, leftControls: neutral(), rightControls: neutral() });
    const neutral48000 = await compareCase({ sampleRate: 48000, leftControls: neutral(), rightControls: neutral() });
    const centerResponses = [];
    for (let index = 0; index < frequencies.length; index += 1) {
      centerResponses.push(await compareCase({
        sampleRate: index % 2 === 0 ? 44100 : 48000,
        frequency: frequencies[index],
        leftControls: oneBand(index, 50),
        rightControls: neutral()
      }));
    }
    const extremes = {};
    for (const index of [0, 4, 9]) {
      extremes[index] = {
        positiveMax: await compareCase({ sampleRate: 44100, frequency: frequencies[index], leftControls: oneBand(index, 100), rightControls: neutral() }),
        negativeMid: await compareCase({ sampleRate: 48000, frequency: frequencies[index], leftControls: oneBand(index, -50), rightControls: neutral() }),
        negativeMax: await compareCase({ sampleRate: 44100, frequency: frequencies[index], leftControls: oneBand(index, -100), rightControls: neutral() })
      };
    }
    const rightOnly = await compareCase({ sampleRate: 48000, frequency: 1500, leftControls: neutral(), rightControls: oneBand(6, 50) });
    const mixed = await compareCase({
      sampleRate: 44100,
      frequency: 777,
      leftControls: [100, -50, 40, 0, 80, -30, 20, 0, -70, 50],
      rightControls: [-80, 30, 0, 60, -20, 45, 0, -40, 70, -10]
    });
    const betweenBands = await compareCase({ sampleRate: 48000, frequency: Math.sqrt(411 * 777), leftControls: oneBand(4, 50), rightControls: oneBand(5, -50) });
    const impulse = await compareCase({ sampleRate: 44100, signal: 'impulse', leftControls: oneBand(4, 100), rightControls: oneBand(4, -100) });
    const sweep = await compareCase({ sampleRate: 48000, signal: 'sweep', leftControls: oneBand(7, 50), rightControls: oneBand(2, -50) });

    const frequencyResponse = new OfflineAudioContext(1, 128, 48000).createBiquadFilter();
    const peakMagnitudes = frequencies.map((frequency, index) => {
      frequencyResponse.type = 'bandpass';
      frequencyResponse.frequency.value = frequency;
      frequencyResponse.Q.value = qs[index];
      const magnitude = new Float32Array(1);
      const phase = new Float32Array(1);
      frequencyResponse.getFrequencyResponse(new Float32Array([frequency]), magnitude, phase);
      return magnitude[0];
    });

    return {
      neutral44100,
      neutral48000,
      centerResponses,
      extremes,
      rightOnly,
      mixed,
      betweenBands,
      impulse,
      sweep,
      peakMagnitudes,
      qs,
      mapping: {
        neutral: window.Filterbank.controlToDeltaGain(0),
        positive: window.Filterbank.controlToDeltaGain(100),
        negative: window.Filterbank.controlToDeltaGain(-100)
      }
    };
  });

  const allMetrics = [
    result.neutral44100,
    result.neutral48000,
    ...result.centerResponses,
    ...Object.values(result.extremes).flatMap(values => Object.values(values)),
    result.rightOnly,
    result.mixed,
    result.betweenBands,
    result.impulse,
    result.sweep
  ];
  for (const metrics of allMetrics) {
    expect(metrics.finite).toBeTruthy();
    expect(metrics.leftParityMaxError).toBeLessThanOrEqual(2e-5);
    expect(metrics.rightParityMaxError).toBeLessThanOrEqual(2e-5);
  }
  for (const neutral of [result.neutral44100, result.neutral48000]) {
    expect(neutral.leftInputMaxError).toBeLessThanOrEqual(1e-6);
    expect(neutral.rightInputMaxError).toBeLessThanOrEqual(1e-6);
  }
  expect(result.mapping.neutral).toBe(0);
  expect(result.mapping.positive).toBeCloseTo(10 ** (12 / 20) - 1, 10);
  expect(result.mapping.negative).toBeCloseTo(10 ** (-12 / 20) - 1, 10);
  for (const response of result.centerResponses) {
    expect(response.leftRms).toBeGreaterThan(result.neutral44100.leftRms * 1.2);
    expect(response.rightInputMaxError).toBeLessThanOrEqual(1e-6);
  }
  for (const values of Object.values(result.extremes)) {
    expect(values.positiveMax.leftRms).toBeGreaterThan(result.neutral44100.leftRms * 1.2);
    expect(values.negativeMid.leftRms).toBeLessThan(result.neutral48000.leftRms * 0.9);
    expect(values.negativeMid.leftRms).toBeGreaterThan(0);
    expect(values.negativeMax.leftRms).toBeLessThan(result.neutral44100.leftRms * 0.9);
    expect(values.negativeMax.leftRms).toBeGreaterThan(0);
  }
  expect(result.rightOnly.leftInputMaxError).toBeLessThanOrEqual(1e-6);
  expect(result.rightOnly.rightRms).toBeGreaterThan(result.neutral48000.rightRms * 1.2);
  expect(result.qs).toHaveLength(10);
  expect(result.qs.every(value => Number.isFinite(value) && value > 0)).toBeTruthy();
  for (const magnitude of result.peakMagnitudes) expect(magnitude).toBeCloseTo(1, 5);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
