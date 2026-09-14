const { test, expect } = require('playwright/test');

test('the audible positive local path uses the 2x nonlinear residual and accepts live drive targets', async ({ page }) => {
  test.setTimeout(180000);
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const bandCount = frequencies.length;
    const moduleUrl = new URL('/filterbank-processor.js', window.location.href).href;
    const drives = [1, 2, 4, 8, 16];
    const rates = [44100, 48000];
    const resonances = [0.5, 0.75, 1];
    const selectedBands = [4, 9];
    const zeroes = () => Array(bandCount).fill(0);
    const gates = (index, channel = 'both') => Array.from({ length: bandCount }, (_, current) => (
      current === index && (channel === 'both' || channel === 'left')
    ));

    const rms = (energy, frames) => Math.sqrt(energy / Math.max(1, frames));
    const harmonicMagnitude = (real, imaginary, frames) => 2 * Math.hypot(real, imaginary) / Math.max(1, frames);

    const render = async ({
      sampleRate,
      index,
      resonance,
      drive,
      gate = true,
      leftOnly = false
    }) => {
      const duration = frequencies[index] <= 61 ? 2 : 1;
      const frameCount = Math.round(sampleRate * duration);
      const context = new OfflineAudioContext(2, frameCount, sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const diagnostics = [];
      const input = context.createBuffer(2, frameCount, sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const samples = input.getChannelData(channel);
        for (let frame = 0; frame < frameCount; frame += 1) {
          samples[frame] = (leftOnly && channel === 1)
            ? 0
            : 0.05 * Math.sin((2 * Math.PI * frequencies[index] * frame) / sampleRate + channel * 0.17);
        }
      }
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        processorOptions: {
          bandFrequencies: frequencies,
          bandQs: qs,
          bandGainLeft: zeroes(),
          bandGainRight: zeroes(),
          feedbackBandLeft: gate ? gates(index, 'left') : zeroes(),
          feedbackBandRight: gate ? gates(index, leftOnly ? 'none' : 'right') : zeroes(),
          feedbackAllLeft: false,
          feedbackAllRight: false,
          resonance,
          maxBandGainDb: 12,
          smoothingTime: 0.015,
          feedbackGateSmoothingTime: 0.008,
          resonanceSmoothingTime: 0.015,
          feedbackAllNormalization: 1 / Math.sqrt(bandCount),
          maxFeedbackGain: 1.25,
          maxAuditionGain: 0.25,
          resonatorDampingFloor: 0.1,
          positiveResonanceAuditionGain: 0.2,
          positiveResonanceAuditionGainSmoothingTime: 0.015,
          enableNonlinearPositiveResonator: true,
          positiveResonanceDrive: drive,
          positiveResonanceDriveSmoothingTime: 0.015,
          collectResonatorDiagnostics: true
        }
      });
      node.port.addEventListener('message', event => {
        if (event.data?.type === 'resonator-diagnostics') diagnostics.push(event.data);
      });
      node.port.start?.();
      const source = context.createBufferSource();
      source.buffer = input;
      source.connect(node);
      node.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      const channel = output.getChannelData(0);
      const sourceChannel = input.getChannelData(0);
      const analysisStart = Math.floor(frameCount * 0.5);
      let outputEnergy = 0;
      let residualEnergy = 0;
      let outputPeak = 0;
      let residualPeak = 0;
      let finite = true;
      const real = Array(4).fill(0);
      const imaginary = Array(4).fill(0);
      for (let frame = 0; frame < frameCount; frame += 1) {
        const sample = channel[frame];
        const residual = sample - sourceChannel[frame];
        outputPeak = Math.max(outputPeak, Math.abs(sample));
        residualPeak = Math.max(residualPeak, Math.abs(residual));
        finite = finite && Number.isFinite(sample) && Number.isFinite(residual);
        if (frame >= analysisStart) {
          outputEnergy += sample * sample;
          residualEnergy += residual * residual;
          for (let harmonic = 1; harmonic <= 4; harmonic += 1) {
            const phase = (2 * Math.PI * harmonic * frequencies[index] * frame) / sampleRate;
            real[harmonic - 1] += sample * Math.cos(phase);
            imaginary[harmonic - 1] += sample * Math.sin(phase);
          }
        }
      }
      const analysisFrames = frameCount - analysisStart;
      const harmonics = real.map((value, harmonic) => harmonicMagnitude(value, imaginary[harmonic], analysisFrames));
      const fundamental = Math.max(harmonics[0], Number.EPSILON);
      const thd = Math.sqrt(harmonics.slice(1).reduce((sum, value) => sum + value * value, 0)) / fundamental;
      const right = output.getChannelData(1);
      const rightInput = input.getChannelData(1);
      let rightResidualPeak = 0;
      for (let frame = 0; frame < frameCount; frame += 1) {
        rightResidualPeak = Math.max(rightResidualPeak, Math.abs(right[frame] - rightInput[frame]));
      }
      const lastDiagnostics = diagnostics.at(-1)?.left;
      return {
        outputPeak,
        outputRms: rms(outputEnergy, analysisFrames),
        residualPeak,
        residualRms: rms(residualEnergy, analysisFrames),
        thd,
        finite,
        rightResidualPeak,
        diagnostics: lastDiagnostics
      };
    };

    const measurements = {};
    for (const sampleRate of rates) {
      measurements[sampleRate] = {};
      for (const index of selectedBands) {
        measurements[sampleRate][index] = {};
        for (const resonance of resonances) {
          measurements[sampleRate][index][resonance] = {};
          for (const drive of drives) {
            measurements[sampleRate][index][resonance][drive] = await render({
              sampleRate,
              index,
              resonance,
              drive
            });
          }
        }
      }
    }
    const neutral = await render({ sampleRate: 48000, index: 4, resonance: 0, drive: 8 });
    const gateOff = await render({ sampleRate: 48000, index: 4, resonance: 1, drive: 8, gate: false });
    const leftOnly = await render({ sampleRate: 48000, index: 4, resonance: 1, drive: 4, leftOnly: true });
    const low = await render({ sampleRate: 48000, index: 0, resonance: 1, drive: 4 });
    return { measurements, neutral, gateOff, leftOnly, low };
  });

  for (const sampleRate of [44100, 48000]) {
    for (const index of [4, 9]) {
      for (const resonance of [0.5, 0.75, 1]) {
        for (const drive of [1, 2, 4, 8, 16]) {
          const measurement = report.measurements[sampleRate][index][resonance][drive];
          expect(measurement.finite).toBeTruthy();
          expect(measurement.residualRms).toBeGreaterThan(1e-8);
          expect(measurement.diagnostics.nonlinearEnabled).toBeTruthy();
          expect(measurement.diagnostics.nonlinearDriveTarget).toBe(drive);
          expect(measurement.diagnostics.nonlinearDrive).toBeCloseTo(drive, 5);
          expect(measurement.diagnostics.nonlinearResidualPeak[index]).toBeGreaterThan(1e-7);
          expect(measurement.diagnostics.nonlinearSolverIterationMaximum[index]).toBeLessThanOrEqual(4);
          expect(measurement.diagnostics.nonlinearFallbackCounts[index]).toBe(0);
          expect(measurement.diagnostics.nonlinearNonFiniteStateResets[index]).toBe(0);
        }
      }
    }
  }

  expect(report.neutral.residualPeak).toBeLessThanOrEqual(1e-7);
  expect(report.gateOff.residualPeak).toBeLessThanOrEqual(1e-7);
  expect(report.leftOnly.rightResidualPeak).toBeLessThanOrEqual(1e-7);
  expect(report.low.finite).toBeTruthy();
  expect(report.low.diagnostics.nonlinearFallbackCounts[0]).toBe(0);
  expect(report.low.diagnostics.nonlinearNonFiniteStateResets[0]).toBe(0);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  await page.close({ runBeforeUnload: false });

  const format = (sampleRate, index) => [1, 2, 4, 8, 16].map(drive => {
    const value = report.measurements[sampleRate][index][1][drive];
    return `D${drive}:rms=${value.outputRms.toExponential(3)},res=${value.residualRms.toExponential(3)},thd=${(value.thd * 100).toFixed(3)}%`;
  }).join(' ');
  console.log(`TPT_NONLINEAR_AUDITION 411 44.1 ${format(44100, 4)} | 48 ${format(48000, 4)}`);
  console.log(`TPT_NONLINEAR_AUDITION 11k 44.1 ${format(44100, 9)} | 48 ${format(48000, 9)}`);
});
