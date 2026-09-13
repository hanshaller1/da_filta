const { test, expect } = require('playwright/test');

test('inverted resonance characterization exposes the phase-limited scalar calibration', async ({ page }) => {
  test.setTimeout(180000);
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const frequencies = window.Filterbank.BAND_FREQUENCIES;
    const qs = window.Filterbank.BAND_QS;
    const bandCount = frequencies.length;
    const selectedBands = [0, 4, 5, 9];
    const resonanceValues = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
    const candidateNegativeMaxima = [1.25, 1.5, 1.75, 2, 2.25, 2.5, 3];
    const neutral = () => Array(bandCount).fill(0);
    const gates = indices => Array.from({ length: bandCount }, (_, index) => indices.includes(index));
    const moduleUrl = new URL('filterbank-processor.js', window.location.href).href;

    const calculateMetrics = (output, input, sampleRate, resonance, targetFrequency) => {
      const auditionScale = resonance === 0 ? 1 : 0.25 * resonance * resonance;
      let outputPeak = 0;
      let residualPeak = 0;
      let residualEnergy = 0;
      let earlyEnergy = 0;
      let lateEnergy = 0;
      let lastSignificantFrame = 0;
      let targetReal = 0;
      let targetImag = 0;
      const earlyEnd = Math.min(output.length, Math.round(sampleRate * 0.15));
      const lateStart = Math.min(output.length, Math.round(sampleRate * 0.5));
      const threshold = 1e-7;
      for (let frame = 0; frame < output.length; frame += 1) {
        const residual = output[frame] - input[frame];
        const internal = resonance === 0 ? residual : residual / auditionScale;
        outputPeak = Math.max(outputPeak, Math.abs(output[frame]));
        residualPeak = Math.max(residualPeak, Math.abs(residual));
        residualEnergy += residual * residual;
        if (frame < earlyEnd) earlyEnergy += residual * residual;
        if (frame >= lateStart) lateEnergy += residual * residual;
        if (Math.abs(residual) > threshold) lastSignificantFrame = frame;
        const phase = 2 * Math.PI * targetFrequency * frame / sampleRate;
        targetReal += internal * Math.cos(phase);
        targetImag -= internal * Math.sin(phase);
      }
      return {
        outputPeak,
        residualPeak,
        residualRms: Math.sqrt(residualEnergy / output.length),
        earlyRms: Math.sqrt(earlyEnergy / Math.max(1, earlyEnd)),
        lateRms: Math.sqrt(lateEnergy / Math.max(1, output.length - lateStart)),
        decayMs: 1000 * lastSignificantFrame / sampleRate,
        targetMagnitude: Math.hypot(targetReal, targetImag) / output.length,
        finite: output.every(Number.isFinite)
      };
    };

    const render = async ({ sampleRate, mode, bandIndex, resonance, maxFeedbackGain = 1.25, duration = 1.25 }) => {
      const frameCount = Math.round(sampleRate * duration);
      const context = new OfflineAudioContext(2, frameCount, sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const inputBuffer = context.createBuffer(2, frameCount, sampleRate);
      inputBuffer.getChannelData(0)[0] = 0.05;
      const source = context.createBufferSource();
      source.buffer = inputBuffer;
      const localIndices = mode === 'local' || mode === 'combined' ? [bandIndex] : [];
      const allEnabled = mode === 'all' || mode === 'combined';
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        processorOptions: {
          bandFrequencies: [...frequencies],
          bandQs: [...qs],
          bandGainLeft: neutral(),
          bandGainRight: neutral(),
          feedbackBandLeft: gates(localIndices),
          feedbackBandRight: gates([]),
          feedbackAllLeft: allEnabled,
          feedbackAllRight: false,
          resonance,
          maxBandGainDb: 12,
          smoothingTime: 0.015,
          feedbackGateSmoothingTime: 0.008,
          resonanceSmoothingTime: 0.015,
          feedbackAllNormalization: 1 / Math.sqrt(bandCount),
          maxFeedbackGain,
          maxAuditionGain: 0.25
        }
      });
      source.connect(node);
      node.connect(context.destination);
      source.start();
      const rendered = await context.startRendering();
      const output = rendered.getChannelData(0);
      const input = inputBuffer.getChannelData(0);
      const metrics = calculateMetrics(output, input, sampleRate, resonance, frequencies[bandIndex]);
      node.port.postMessage({ type: 'dispose' });
      node.disconnect();
      return metrics;
    };

    const baseline = {};
    for (const sampleRate of [44100, 48000]) {
      baseline[sampleRate] = {};
      for (const bandIndex of selectedBands) {
        baseline[sampleRate][bandIndex] = {};
        for (const resonance of resonanceValues) {
          baseline[sampleRate][bandIndex][resonance] = await render({
            sampleRate,
            mode: 'local',
            bandIndex,
            resonance
          });
        }
      }
    }

    const modes = {};
    for (const sampleRate of [44100, 48000]) {
      modes[sampleRate] = {};
      for (const mode of ['all', 'combined']) {
        modes[sampleRate][mode] = {};
        for (const resonance of resonanceValues) {
          modes[sampleRate][mode][resonance] = await render({
            sampleRate,
            mode,
            bandIndex: 4,
            resonance
          });
        }
      }
    }

    const candidates = {};
    for (const maximum of candidateNegativeMaxima) {
      candidates[maximum] = {};
      for (const mode of ['local', 'all', 'combined']) {
        candidates[maximum][mode] = {};
        for (const bandIndex of selectedBands) {
          candidates[maximum][mode][bandIndex] = await render({
            sampleRate: 48000,
            mode,
            bandIndex,
            resonance: -1,
            maxFeedbackGain: maximum
          });
        }
      }
    }

    const phase = selectedBands.map(index => {
      const omega44100 = 2 * Math.PI * frequencies[index] / 44100;
      const omega48000 = 2 * Math.PI * frequencies[index] / 48000;
      return {
        index,
        frequency: frequencies[index],
        positiveLoopPhaseDegrees44100: -omega44100 * 180 / Math.PI,
        negativeLoopPhaseDegrees44100: 180 - omega44100 * 180 / Math.PI,
        positiveLoopPhaseDegrees48000: -omega48000 * 180 / Math.PI,
        negativeLoopPhaseDegrees48000: 180 - omega48000 * 180 / Math.PI
      };
    });

    let tanhSymmetryMaxError = 0;
    for (const value of [-8, -4, -2, -1, -0.5, 0, 0.5, 1, 2, 4, 8]) {
      tanhSymmetryMaxError = Math.max(tanhSymmetryMaxError, Math.abs(Math.tanh(value) + Math.tanh(-value)));
    }

    return { baseline, modes, candidates, phase, tanhSymmetryMaxError };
  });

  for (const sampleRate of [44100, 48000]) {
    for (const bandIndex of [0, 4, 5, 9]) {
      const values = result.baseline[sampleRate][bandIndex];
      for (const resonance of [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]) {
        expect(values[resonance].finite).toBeTruthy();
      }
      expect(values['0'].residualPeak).toBe(0);
    }
    for (const bandIndex of [0, 4, 5]) {
      const values = result.baseline[sampleRate][bandIndex];
      expect(values['1'].residualRms).toBeGreaterThan(values['-1'].residualRms * 10000);
      expect(values['1'].lateRms).toBeGreaterThan(0.1);
      expect(values['-1'].lateRms).toBeLessThan(1e-12);
      expect(values['1'].targetMagnitude).toBeGreaterThan(values['-1'].targetMagnitude * 1000);
    }
    for (const mode of ['all', 'combined']) {
      const values = result.modes[sampleRate][mode];
      for (const resonance of [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]) {
        expect(values[resonance].finite).toBeTruthy();
      }
      expect(values['0'].residualPeak).toBe(0);
      expect(values['1'].residualRms).toBeGreaterThan(values['-1'].residualRms);
    }
    expect(result.modes[sampleRate].combined['1'].lateRms).toBeGreaterThan(0.2);
    expect(result.modes[sampleRate].combined['-1'].lateRms).toBeLessThan(1e-12);
  }

  for (const bandIndex of [0, 4, 5]) {
    expect(result.candidates['3'].local[bandIndex].targetMagnitude)
      .toBeLessThan(result.candidates['1.25'].local[bandIndex].targetMagnitude);
  }
  expect(result.candidates['1.5'].combined[9].lateRms).toBeLessThan(1e-12);
  expect(result.candidates['1.75'].combined[9].lateRms).toBeGreaterThan(0.05);
  expect(result.candidates['2.25'].local[9].lateRms).toBeGreaterThan(0.04);
  for (const maximum of Object.values(result.candidates)) {
    for (const mode of Object.values(maximum)) {
      for (const metrics of Object.values(mode)) expect(metrics.finite).toBeTruthy();
    }
  }

  for (const band of result.phase.slice(0, 3)) {
    expect(Math.abs(band.positiveLoopPhaseDegrees44100)).toBeLessThan(10);
    expect(Math.abs(band.negativeLoopPhaseDegrees44100)).toBeGreaterThan(170);
    expect(Math.abs(band.positiveLoopPhaseDegrees48000)).toBeLessThan(10);
    expect(Math.abs(band.negativeLoopPhaseDegrees48000)).toBeGreaterThan(170);
  }
  expect(result.tanhSymmetryMaxError).toBe(0);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
