const { test, expect } = require('playwright/test');

test('positive local TPT resonance is audible only as the controlled residual', async ({ page }) => {
  test.setTimeout(180000);
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const { OversampledPositiveTptResonator } = await import('/tpt-svf.js');
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const bandCount = frequencies.length;
    const sampleRates = [44100, 48000];
    const resonanceValues = [0, 0.25, 0.5, 0.75, 1];
    const selectedIndices = Array.from({ length: bandCount }, (_, index) => index);
    const auditionGain = window.Filterbank.POSITIVE_RESONANCE_AUDITION_GAIN;
    const dampingFloor = window.Filterbank.RESONATOR_DAMPING_FLOOR;
    const neutral = () => Array(bandCount).fill(0);
    const gates = () => Array(bandCount).fill(false);
    const selectedGates = indices => Array.from({ length: bandCount }, (_, index) => indices.includes(index));

    const createBurstInput = (context, frequency, leftOnly = false) => {
      const buffer = context.createBuffer(2, context.length, context.sampleRate);
      const burstFrames = frequency <= 61
        ? Math.round(context.sampleRate * 1.25)
        : Math.round(context.sampleRate * 0.3);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      for (let frame = 0; frame < burstFrames; frame += 1) {
        const phase = (2 * Math.PI * frequency * frame) / context.sampleRate;
        left[frame] = 0.01 * Math.sin(phase);
        right[frame] = leftOnly ? 0 : 0.008 * Math.sin(phase + 0.39);
      }
      return { buffer, burstFrames };
    };

    const render = async ({
      sampleRate,
      index,
      resonance,
      localIndices = [],
      feedbackAllLeft = false,
      feedbackAllRight = false,
      dryWet = 100,
      leftOnly = false
    }) => {
      const duration = frequencies[index] <= 61 ? 3 : 1;
      const context = new OfflineAudioContext(2, Math.round(sampleRate * duration), sampleRate);
      const source = context.createBufferSource();
      const input = createBurstInput(context, frequencies[index], leftOnly);
      source.buffer = input.buffer;
      const filterbank = await window.Filterbank.create(context, {
        bandGainLeft: neutral(),
        bandGainRight: neutral(),
        feedbackBandLeft: selectedGates(localIndices),
        feedbackBandRight: selectedGates(localIndices),
        feedbackAllLeft,
        feedbackAllRight,
        resonance
      });
      const dryGain = context.createGain();
      const wetGain = context.createGain();
      dryGain.gain.value = 1 - dryWet / 100;
      wetGain.gain.value = dryWet / 100;
      source.connect(dryGain);
      source.connect(filterbank.input);
      dryGain.connect(context.destination);
      filterbank.output.connect(wetGain);
      wetGain.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      filterbank.dispose();
      return { input: input.buffer, output, burstFrames: input.burstFrames };
    };

    const expectedPositiveLocal = ({ input, sampleRate, localIndices, resonance, drive = 1 }) => {
      const expected = [new Float32Array(input.length), new Float32Array(input.length)];
      for (let channel = 0; channel < 2; channel += 1) {
        const nonlinearResonators = frequencies.map((frequency, index) => (
          new OversampledPositiveTptResonator(sampleRate, frequency, qs[index])
        ));
        const source = input.getChannelData(channel);
        for (let frame = 0; frame < source.length; frame += 1) {
          const sourceSample = source[frame];
          let sample = sourceSample;
          for (let band = 0; band < bandCount; band += 1) {
            if (resonance > 0 && localIndices.includes(band)) {
              nonlinearResonators[band].process(
                sourceSample,
                1 - (1 - dampingFloor) * resonance,
                drive,
                true
              );
              sample += auditionGain * nonlinearResonators[band].residual;
            }
          }
          expected[channel][frame] = sample;
        }
      }
      return expected;
    };

    const calculateMetrics = ({ rendered, expected = null }) => {
      const values = {
        outputPeak: 0,
        outputRms: 0,
        residualPeak: 0,
        residualRms: 0,
        decaySeconds: 0,
        maximumExpectedError: 0,
        finite: true
      };
      const start = Math.floor(rendered.burstFrames * 0.5);
      const end = rendered.burstFrames;
      let outputEnergy = 0;
      let residualEnergy = 0;
      let residualPeak = 0;
      let lastSignificantFrame = rendered.burstFrames;
      const residuals = [];
      for (let channel = 0; channel < 2; channel += 1) {
        const input = rendered.input.getChannelData(channel);
        const output = rendered.output.getChannelData(channel);
        for (let frame = 0; frame < output.length; frame += 1) {
          const residual = output[frame] - input[frame];
          values.outputPeak = Math.max(values.outputPeak, Math.abs(output[frame]));
          residualPeak = Math.max(residualPeak, Math.abs(residual));
          values.finite = values.finite && Number.isFinite(output[frame]) && Number.isFinite(residual);
          if (expected) values.maximumExpectedError = Math.max(values.maximumExpectedError, Math.abs(output[frame] - expected[channel][frame]));
          if (channel === 0 && frame >= start && frame < end) {
            outputEnergy += output[frame] * output[frame];
            residualEnergy += residual * residual;
          }
          if (channel === 0) residuals[frame] = residual;
        }
      }
      const threshold = residualPeak * 1e-3;
      if (threshold > 0) {
        for (let frame = rendered.burstFrames; frame < residuals.length; frame += 1) {
          if (Math.abs(residuals[frame]) >= threshold) lastSignificantFrame = frame;
        }
      }
      const analysisFrames = Math.max(1, end - start);
      values.outputRms = Math.sqrt(outputEnergy / analysisFrames);
      values.residualPeak = residualPeak;
      values.residualRms = Math.sqrt(residualEnergy / analysisFrames);
      values.decaySeconds = Math.max(0, lastSignificantFrame - rendered.burstFrames) / rendered.output.sampleRate;
      return values;
    };

    const measurements = {};
    for (const sampleRate of sampleRates) {
      measurements[sampleRate] = {};
      for (const index of selectedIndices) {
        measurements[sampleRate][index] = {};
        for (const resonance of resonanceValues) {
          const rendered = await render({ sampleRate, index, resonance, localIndices: [index] });
          const expected = expectedPositiveLocal({
            input: rendered.input,
            sampleRate,
            localIndices: [index],
            resonance
          });
          measurements[sampleRate][index][resonance] = calculateMetrics({ rendered, expected });
        }
      }
    }

    const gateOffRendered = await render({ sampleRate: 48000, index: 4, resonance: 1 });
    const gateOffExpected = expectedPositiveLocal({
      input: gateOffRendered.input,
      sampleRate: 48000,
      localIndices: [],
      resonance: 1
    });
    const gateOff = calculateMetrics({ rendered: gateOffRendered, expected: gateOffExpected });

    const leftOnlyRendered = await render({
      sampleRate: 48000,
      index: 5,
      resonance: 1,
      localIndices: [5],
      leftOnly: true
    });
    const leftOnlyExpected = expectedPositiveLocal({
      input: leftOnlyRendered.input,
      sampleRate: 48000,
      localIndices: [5],
      resonance: 1
    });
    const leftOnly = calculateMetrics({ rendered: leftOnlyRendered, expected: leftOnlyExpected });

    let rightResidualPeak = 0;
    const rightInput = leftOnlyRendered.input.getChannelData(1);
    const rightOutput = leftOnlyRendered.output.getChannelData(1);
    for (let frame = 0; frame < rightOutput.length; frame += 1) {
      rightResidualPeak = Math.max(rightResidualPeak, Math.abs(rightOutput[frame] - rightInput[frame]));
    }

    const multipleRendered = await render({
      sampleRate: 48000,
      index: 4,
      resonance: 0.75,
      localIndices: [2, 4, 7]
    });
    const multipleExpected = expectedPositiveLocal({
      input: multipleRendered.input,
      sampleRate: 48000,
      localIndices: [2, 4, 7],
      resonance: 0.75
    });
    const multiple = calculateMetrics({ rendered: multipleRendered, expected: multipleExpected });

    const dryRendered = await render({
      sampleRate: 48000,
      index: 4,
      resonance: 1,
      localIndices: [4],
      dryWet: 0
    });
    const wetRendered = await render({
      sampleRate: 48000,
      index: 4,
      resonance: 1,
      localIndices: [4],
      dryWet: 100
    });
    const dryWet = {
      dry: calculateMetrics({ rendered: dryRendered }),
      wet: calculateMetrics({ rendered: wetRendered })
    };

    const feedbackAllOnly = calculateMetrics({
      rendered: await render({ sampleRate: 48000, index: 4, resonance: 0.75, feedbackAllLeft: true })
    });
    const localAndAll = calculateMetrics({
      rendered: await render({ sampleRate: 48000, index: 4, resonance: 0.75, localIndices: [4], feedbackAllLeft: true })
    });
    const negative = calculateMetrics({
      rendered: await render({ sampleRate: 48000, index: 4, resonance: -0.75, localIndices: [4] })
    });

    return {
      auditionGain,
      measurements,
      gateOff,
      leftOnly,
      rightResidualPeak,
      multiple,
      dryWet,
      feedbackAllOnly,
      localAndAll,
      negative
    };
  });

  expect(result.auditionGain).toBe(0.10);
  for (const sampleRate of [44100, 48000]) {
    for (const measurements of Object.values(result.measurements[sampleRate])) {
      let previousResidualRms = 0;
      for (const resonance of [0, 0.25, 0.5, 0.75, 1]) {
        const measurement = measurements[resonance];
        expect(measurement.finite).toBeTruthy();
        expect(measurement.maximumExpectedError).toBeLessThanOrEqual(2e-6);
        expect(measurement.residualRms).toBeGreaterThanOrEqual(previousResidualRms * (1 - 1e-9));
        previousResidualRms = measurement.residualRms;
      }
      expect(measurements[0].residualPeak).toBe(0);
      expect(measurements[0].residualRms).toBe(0);
      expect(measurements[1].residualRms).toBeGreaterThan(1e-8);
    }
  }

  expect(result.gateOff.finite).toBeTruthy();
  expect(result.gateOff.residualPeak).toBe(0);
  expect(result.gateOff.maximumExpectedError).toBeLessThanOrEqual(1e-6);
  expect(result.leftOnly.finite).toBeTruthy();
  expect(result.leftOnly.maximumExpectedError).toBeLessThanOrEqual(2e-6);
  expect(result.rightResidualPeak).toBeLessThanOrEqual(1e-6);
  expect(result.multiple.finite).toBeTruthy();
  expect(result.multiple.residualRms).toBeGreaterThan(1e-8);
  expect(result.multiple.maximumExpectedError).toBeLessThanOrEqual(2e-6);
  expect(result.dryWet.dry.residualPeak).toBeLessThanOrEqual(1e-6);
  expect(result.dryWet.wet.residualRms).toBeGreaterThan(1e-8);
  expect(result.feedbackAllOnly.finite).toBeTruthy();
  expect(result.feedbackAllOnly.residualRms).toBeGreaterThan(1e-8);
  expect(result.localAndAll.finite).toBeTruthy();
  expect(result.localAndAll.residualRms).toBeGreaterThan(1e-8);
  expect(result.negative.finite).toBeTruthy();
  expect(result.negative.residualRms).toBeGreaterThan(1e-10);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);

  const report = ['29', '61', '411', '777', '2800', '5200', '11000'].map((frequency, position) => {
    const index = [0, 1, 4, 5, 7, 8, 9][position];
    const measurement = result.measurements[48000][index][1];
    return `${frequency}:${measurement.outputPeak.toFixed(4)}/${measurement.outputRms.toFixed(4)}/${measurement.residualPeak.toFixed(4)}/${measurement.residualRms.toFixed(4)}/${measurement.decaySeconds.toFixed(3)}s`;
  }).join(', ');
  console.log(`TPT_POSITIVE_AUDITION gain=${result.auditionGain}, 48k outputPeak/outputRms/residualPeak/residualRms/decay ${report}`);
});
