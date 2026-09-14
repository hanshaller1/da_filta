const { test, expect } = require('playwright/test');

test('2x diagnostic nonlinear TPT resonator reduces high-band aliasing without producing a residual at linear operation', async ({ page }) => {
  test.setTimeout(150000);
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const report = await page.evaluate(async () => {
    const { LinearTptSvf, OversampledPositiveTptResonator } = await import('/tpt-svf.js');
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const rates = [44100, 48000];
    const drives = [1, 2, 4, 8];
    const resonances = [0.5, 0.75, 1];
    const selected = [0, 4, 5, 7, 8, 9];
    const dampingFloor = window.Filterbank.RESONATOR_DAMPING_FLOOR;
    const damping = resonance => 1 - (1 - dampingFloor) * resonance;

    const rms = (energy, count) => Math.sqrt(energy / Math.max(1, count));
    const harmonicMagnitude = (real, imaginary, count) => 2 * Math.hypot(real, imaginary) / Math.max(1, count);
    const createOneX = (sampleRate, index) => ({
      reference: new LinearTptSvf(sampleRate, frequencies[index], qs[index]),
      nonlinear: new LinearTptSvf(sampleRate, frequencies[index], qs[index])
    });

    const measure = ({ sampleRate, index, resonance, drive, peak = 0.05 }) => {
      const oneX = createOneX(sampleRate, index);
      oneX.reference.setDampingScale(damping(resonance));
      const twoX = new OversampledPositiveTptResonator(sampleRate, frequencies[index], qs[index]);
      const duration = index < 2 ? 4 : 1.5;
      const frameCount = Math.round(sampleRate * duration);
      const analysisStart = frameCount - sampleRate;
      const metrics = {
        oneX: { energy: 0, peak: 0, residualEnergy: 0, residualPeak: 0, real: Array(8).fill(0), imaginary: Array(8).fill(0) },
        twoX: { energy: 0, peak: 0, residualEnergy: 0, residualPeak: 0, real: Array(8).fill(0), imaginary: Array(8).fill(0) }
      };
      let finite = true;

      for (let frame = 0; frame < frameCount; frame += 1) {
        const input = peak * Math.sin((2 * Math.PI * frequencies[index] * frame) / sampleRate);
        const reference = oneX.reference.process(input);
        const nonlinear = oneX.nonlinear.processPositiveStateFeedback(input, damping(resonance), drive);
        const oneXResidual = nonlinear - reference;
        twoX.process(input, damping(resonance), drive, resonance > 0);
        const outputs = [[nonlinear, oneXResidual], [twoX.nonlinearBand, twoX.residual]];
        for (let path = 0; path < outputs.length; path += 1) {
          const [output, residual] = outputs[path];
          const target = path === 0 ? metrics.oneX : metrics.twoX;
          target.peak = Math.max(target.peak, Math.abs(output));
          target.residualPeak = Math.max(target.residualPeak, Math.abs(residual));
          if (frame >= analysisStart) {
            target.energy += output * output;
            target.residualEnergy += residual * residual;
            for (let harmonic = 1; harmonic <= 8; harmonic += 1) {
              const phase = (2 * Math.PI * harmonic * frequencies[index] * frame) / sampleRate;
              target.real[harmonic - 1] += output * Math.cos(phase);
              target.imaginary[harmonic - 1] += output * Math.sin(phase);
            }
          }
          finite = finite && Number.isFinite(output) && Number.isFinite(residual);
        }
        finite = finite && Number.isFinite(twoX.statePeak);
      }

      const format = source => {
        const harmonics = source.real.map((real, harmonic) => (
          harmonicMagnitude(real, source.imaginary[harmonic], frameCount - analysisStart)
        ));
        const fundamental = Math.max(harmonics[0], Number.EPSILON);
        const aliasEnergy = Math.sqrt(harmonics.slice(2).reduce((sum, value) => sum + value * value, 0));
        return {
          rms: rms(source.energy, frameCount - analysisStart),
          peak: source.peak,
          residualRms: rms(source.residualEnergy, frameCount - analysisStart),
          residualPeak: source.residualPeak,
          thd: Math.sqrt(harmonics.slice(1).reduce((sum, value) => sum + value * value, 0)) / fundamental,
          aliasEnergy: aliasEnergy / fundamental,
          h2: harmonics[1],
          h3: harmonics[2]
        };
      };
      return {
        oneX: format(metrics.oneX),
        twoX: format(metrics.twoX),
        finite,
        oneXStatePeak: Math.max(Math.abs(oneX.nonlinear.ic1eq), Math.abs(oneX.nonlinear.ic2eq)),
        twoXStatePeak: twoX.statePeak,
        oneXIterations: oneX.nonlinear.nonlinearSolverIterationTotal / Math.max(1, oneX.nonlinear.nonlinearSolverCallCount),
        twoXIterations: twoX.nonlinearSolverIterationTotal / Math.max(1, twoX.nonlinearSolverCallCount),
        oneXMaximumIterations: oneX.nonlinear.nonlinearSolverIterationMaximum,
        twoXMaximumIterations: twoX.nonlinearSolverIterationMaximum,
        oneXFallbacks: oneX.nonlinear.nonlinearFallbackCount,
        twoXFallbacks: twoX.nonlinearFallbackCount,
        oneXResets: oneX.nonlinear.nonlinearNonFiniteResetCount,
        twoXResets: twoX.nonlinearNonFiniteResetCount,
        latencyNativeSamples: twoX.latencyNativeSamples
      };
    };

    const linearResidual = {};
    for (const sampleRate of rates) {
      linearResidual[sampleRate] = selected.map(index => {
        const resonator = new OversampledPositiveTptResonator(sampleRate, frequencies[index], qs[index]);
        let residualPeak = 0;
        let phaseErrorPeak = 0;
        for (let frame = 0; frame < sampleRate; frame += 1) {
          const input = 0.05 * Math.sin((2 * Math.PI * frequencies[index] * frame) / sampleRate);
          resonator.process(input, 1, 8, false);
          residualPeak = Math.max(residualPeak, Math.abs(resonator.residual));
          phaseErrorPeak = Math.max(phaseErrorPeak, Math.abs(resonator.nonlinearBand - resonator.linearBand));
        }
        return { residualPeak, phaseErrorPeak, latencyNativeSamples: resonator.latencyNativeSamples };
      });
    }

    const measurements = {};
    for (const sampleRate of rates) {
      measurements[sampleRate] = {};
      for (const index of selected) {
        measurements[sampleRate][index] = {};
        const drivesForBand = index === 9 ? drives : [4, 8];
        const resonancesForBand = index === 9 ? resonances : [1];
        for (const resonance of resonancesForBand) {
          measurements[sampleRate][index][resonance] = {};
          for (const drive of drivesForBand) {
            measurements[sampleRate][index][resonance][drive] = measure({ sampleRate, index, resonance, drive });
          }
        }
      }
    }

    const benchmark = mode => {
      const filters = Array.from({ length: 20 }, (_, index) => {
        const band = index % frequencies.length;
        if (mode === 'twoX' || mode === 'twoX8') {
          return new OversampledPositiveTptResonator(48000, frequencies[band], qs[band]);
        }
        return new LinearTptSvf(48000, frequencies[band], qs[band]);
      });
      for (let frame = 0; frame < 4096; frame += 1) {
        const input = 0.05 * Math.sin((2 * Math.PI * 411 * frame) / 48000);
        for (const filter of filters) {
          if (mode === 'linear') filter.process(input);
          else if (mode === 'oneX') filter.processPositiveStateFeedback(input, damping(1), 4);
          else filter.process(input, damping(1), mode === 'twoX8' ? 8 : 4, true);
        }
      }
      const started = globalThis.performance.now();
      for (let frame = 0; frame < 48000; frame += 1) {
        const input = 0.05 * Math.sin((2 * Math.PI * 411 * frame) / 48000);
        for (const filter of filters) {
          if (mode === 'linear') filter.process(input);
          else if (mode === 'oneX') filter.processPositiveStateFeedback(input, damping(1), 4);
          else filter.process(input, damping(1), mode === 'twoX8' ? 8 : 4, true);
        }
      }
      return globalThis.performance.now() - started;
    };
    benchmark('twoX');
    const performance = {
      linearMs: benchmark('linear'),
      nonlinearOneXDrive4Ms: benchmark('oneX'),
      nonlinearTwoXDrive4Ms: benchmark('twoX'),
      nonlinearTwoXDrive8Ms: benchmark('twoX8')
    };

    return { measurements, linearResidual, performance };
  });

  for (const sampleRate of [44100, 48000]) {
    for (const measurement of report.linearResidual[sampleRate]) {
      expect(measurement.residualPeak).toBeLessThanOrEqual(1e-14);
      expect(measurement.phaseErrorPeak).toBeLessThanOrEqual(1e-14);
      expect(measurement.latencyNativeSamples).toBe(7);
    }
    for (const index of [0, 4, 5, 7, 8, 9]) {
      for (const resonance of Object.keys(report.measurements[sampleRate][index])) {
        for (const measurement of Object.values(report.measurements[sampleRate][index][resonance])) {
          expect(measurement.finite).toBeTruthy();
          expect(measurement.oneXFallbacks).toBe(0);
          expect(measurement.twoXFallbacks).toBe(0);
          expect(measurement.oneXResets).toBe(0);
          expect(measurement.twoXResets).toBe(0);
          expect(measurement.oneXMaximumIterations).toBeLessThanOrEqual(4);
          expect(measurement.twoXMaximumIterations).toBeLessThanOrEqual(4);
        }
      }
    }
  }

  for (const sampleRate of [44100, 48000]) {
    for (const drive of [1, 2, 4, 8]) {
      for (const resonance of [0.5, 0.75, 1]) {
        const measurement = report.measurements[sampleRate][9][resonance][drive];
        expect(measurement.twoX.aliasEnergy).toBeLessThan(measurement.oneX.aliasEnergy * 0.25);
      }
    }
  }
  for (const index of [0, 4, 5, 7, 8]) {
    for (const sampleRate of [44100, 48000]) {
      for (const drive of [4, 8]) {
        const measurement = report.measurements[sampleRate][index][1][drive];
        expect(measurement.twoX.rms / measurement.oneX.rms).toBeGreaterThan(0.9);
        expect(measurement.twoX.rms / measurement.oneX.rms).toBeLessThan(1.1);
      }
    }
  }
  const oneXGap = Math.abs(report.measurements[44100][9][1][4].oneX.thd - report.measurements[48000][9][1][4].oneX.thd);
  const twoXGap = Math.abs(report.measurements[44100][9][1][4].twoX.thd - report.measurements[48000][9][1][4].twoX.thd);
  expect(twoXGap).toBeLessThan(oneXGap * 0.25);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);

  const eleven = sampleRate => [1, 2, 4, 8].map(drive => {
    const measurement = report.measurements[sampleRate][9][1][drive];
    return `D${drive}:${(measurement.oneX.thd * 100).toFixed(2)}→${(measurement.twoX.thd * 100).toFixed(2)}%`;
  }).join(',');
  console.log(
    `TPT_RESONATOR_2X 11k 44.1=${eleven(44100)} | 48=${eleven(48000)} | `
    + `latency=7 native samples | perf linear=${report.performance.linearMs.toFixed(2)}ms,1x=${report.performance.nonlinearOneXDrive4Ms.toFixed(2)}ms,2xD4=${report.performance.nonlinearTwoXDrive4Ms.toFixed(2)}ms,2xD8=${report.performance.nonlinearTwoXDrive8Ms.toFixed(2)}ms`
  );
});
