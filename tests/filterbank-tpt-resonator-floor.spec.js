const { test, expect } = require('playwright/test');

test('extended positive-resonator damping floors remain finite and characterize their tails', async ({ page }) => {
  test.setTimeout(90000);
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const report = await page.evaluate(async () => {
    const { OversampledPositiveTptResonator } = await import('/tpt-svf.js');
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const rates = [44100, 48000];
    const floors = [0.10, 0.05, 0.02, 0.00, -0.02];
    const selected = [0, 4, 5, 7, 9];
    const damping = (floor, resonance) => 1 - (1 - floor) * resonance;
    const rms = (energy, count) => Math.sqrt(energy / Math.max(1, count));

    const measure = ({ sampleRate, index, floor, resonance, drive, burst = true }) => {
      const frequency = frequencies[index];
      // This is deliberately short: the test characterizes stability and
      // relative tails, while the manual calibration remains the authority
      // for the audible duration of extreme settings.
      const duration = frequency <= 29 ? 2 : 0.2;
      const frameCount = Math.round(sampleRate * duration);
      const burstFrames = burst ? Math.max(1, Math.round(sampleRate * (frequency <= 61 ? 0.35 : 0.10))) : frameCount;
      const filter = new OversampledPositiveTptResonator(sampleRate, frequency, qs[index]);
      let bandEnergy = 0;
      let residualEnergy = 0;
      let outputPeak = 0;
      let residualPeak = 0;
      let statePeak = 0;
      let lastAbove = 0;
      let finite = true;
      const inputScale = 0.05;
      for (let frame = 0; frame < frameCount; frame += 1) {
        const input = frame < burstFrames
        ? inputScale * Math.sin((2 * Math.PI * frequency * frame) / sampleRate)
          : 0;
        const band = filter.process(input, damping(floor, resonance), drive, resonance > 0);
        const residual = filter.residual;
        outputPeak = Math.max(outputPeak, Math.abs(band));
        residualPeak = Math.max(residualPeak, Math.abs(residual));
        statePeak = Math.max(statePeak, filter.statePeak);
        finite = finite && Number.isFinite(band) && Number.isFinite(residual) && Number.isFinite(filter.statePeak);
        if (frame >= burstFrames) {
          bandEnergy += band * band;
          residualEnergy += residual * residual;
          if (Math.abs(band) >= Math.max(outputPeak * 1e-3, 1e-12)) lastAbove = frame;
        }
      }
      const tailFrames = Math.max(1, frameCount - burstFrames);
      return {
        dampingScale: damping(floor, resonance),
        outputPeak,
        residualPeak,
        tailRms: rms(bandEnergy, tailFrames),
        residualTailRms: rms(residualEnergy, tailFrames),
        tailSeconds: Math.max(0, lastAbove - burstFrames) / sampleRate,
        statePeak,
        finite,
        meanIterations: filter.nonlinearSolverIterationTotal / Math.max(1, filter.nonlinearSolverCallCount),
        maximumIterations: filter.nonlinearSolverIterationMaximum,
        fallbacks: filter.nonlinearFallbackCount,
        resets: filter.nonlinearNonFiniteResetCount
      };
    };

    const floorSeries = {};
    for (const sampleRate of rates) {
      floorSeries[sampleRate] = {};
      for (const resonance of [0.5, 0.75, 0.9, 1]) {
        floorSeries[sampleRate][resonance] = {};
        for (const floor of floors) {
          floorSeries[sampleRate][resonance][floor] = measure({
            sampleRate, index: 4, floor, resonance, drive: 4
          });
        }
      }
    }

    const tailSeries = {};
    for (const sampleRate of rates) {
      tailSeries[sampleRate] = {};
      for (const index of selected) {
        tailSeries[sampleRate][index] = {};
        for (const floor of [0.10, 0.00, -0.02]) {
          tailSeries[sampleRate][index][floor] = {};
          for (const drive of floor === 0.10 ? [4] : [4, 16]) {
            tailSeries[sampleRate][index][floor][drive] = measure({
              sampleRate, index, floor, resonance: 1, drive
            });
          }
        }
      }
    }

    const driveSeries = {};
    for (const sampleRate of rates) {
      driveSeries[sampleRate] = {};
      for (const index of [4, 9]) {
        driveSeries[sampleRate][index] = {};
        for (const drive of [1, 2, 4, 8, 16]) {
          driveSeries[sampleRate][index][drive] = measure({
            sampleRate, index, floor: 0.10, resonance: 1, drive, burst: false
          });
        }
      }
    }

    const extremes = [
      [0.30, 8, 0.02],
      [0.60, 8, 0.00],
      [0.60, 16, 0.00],
      [0.60, 8, -0.02],
      [1.00, 16, -0.02]
    ].map(([audition, drive, floor]) => {
      const measurement = measure({ sampleRate: 48000, index: 4, floor, resonance: 1, drive });
      return { audition, drive, floor, audibleResidualPeak: audition * measurement.residualPeak, ...measurement };
    });

    return { floorSeries, tailSeries, driveSeries, extremes };
  });

  for (const sampleRate of [44100, 48000]) {
    for (const resonance of [0.5, 0.75, 0.9, 1]) {
      let previousResidualPeak = 0;
      for (const floor of [0.10, 0.05, 0.02, 0.00, -0.02]) {
        const measurement = report.floorSeries[sampleRate][resonance][floor];
        expect(measurement.finite).toBeTruthy();
        expect(measurement.maximumIterations).toBeLessThanOrEqual(4);
        expect(measurement.fallbacks).toBe(0);
        expect(measurement.resets).toBe(0);
        // Down to zero, reducing residual damping must strengthen the local
        // resonator. The negative DEV floor is intentionally not included:
        // its bounded active-feedback probe is not a monotonic gain control.
        if (floor >= 0) {
          expect(measurement.residualPeak).toBeGreaterThanOrEqual(previousResidualPeak);
          previousResidualPeak = measurement.residualPeak;
        }
      }
    }
    for (const index of [0, 4, 5, 7, 9]) {
      for (const floor of [0.10, 0.00, -0.02]) {
        for (const drive of floor === 0.10 ? [4] : [4, 16]) {
          const measurement = report.tailSeries[sampleRate][index][floor][drive];
          expect(measurement.finite).toBeTruthy();
          expect(measurement.maximumIterations).toBeLessThanOrEqual(4);
          expect(measurement.fallbacks).toBe(0);
          expect(measurement.resets).toBe(0);
          // At 11 kHz / D16 / F=-0.02 the bounded nonlinear state can be
          // large relative to the 0.05 test input, but must remain bounded
          // over the complete tail render.
          expect(measurement.statePeak).toBeLessThan(200);
        }
      }
    }
  }
  for (const extreme of report.extremes) {
    expect(extreme.finite).toBeTruthy();
    expect(extreme.statePeak).toBeLessThan(200);
    expect(extreme.fallbacks).toBe(0);
    expect(extreme.resets).toBe(0);
  }
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `Page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  await page.close({ runBeforeUnload: false });

  const summarize = floor => {
    const measurement = report.floorSeries[48000][1][floor];
    return `${floor}:tail=${measurement.tailSeconds.toFixed(3)}s,state=${measurement.statePeak.toFixed(3)},res=${measurement.residualTailRms.toExponential(3)}`;
  };
  console.log(`TPT_RESONATOR_FLOOR 411Hz/48k ${[0.10, 0.05, 0.02, 0, -0.02].map(summarize).join(' ')}`);
  for (const sampleRate of [44100, 48000]) {
    console.log(
      `TPT_RESONATOR_TAILS ${sampleRate / 1000}k ${[0, 4, 5, 7, 9].map(index => {
        const baseline = report.tailSeries[sampleRate][index][0.1][4];
        const zero = report.tailSeries[sampleRate][index][0][4];
        const active = report.tailSeries[sampleRate][index][-0.02][16];
        return `${[29, 411, 777, 2800, 11000][[0, 4, 5, 7, 9].indexOf(index)]}Hz:`
          + `F.1/D4=${baseline.tailSeconds.toFixed(3)}s,F0/D4=${zero.tailSeconds.toFixed(3)}s,`
          + `F-.02/D16=${active.tailSeconds.toFixed(3)}s,state=${active.statePeak.toFixed(3)}`;
      }).join(' ')}`
    );
  }
  for (const sampleRate of [44100, 48000]) {
    console.log(
      `TPT_RESONATOR_DRIVE ${sampleRate / 1000}k ${[4, 9].map(index => `${[411, 11000][[4, 9].indexOf(index)]}Hz:`
        + [1, 2, 4, 8, 16].map(drive => {
          const value = report.driveSeries[sampleRate][index][drive];
          return `D${drive}=peak${value.residualPeak.toExponential(2)}/state${value.statePeak.toFixed(2)}`;
        }).join(',')).join(' ')}`
    );
  }
  console.log(`TPT_RESONATOR_EXTREMES ${report.extremes.map(value => `A${value.audition}/D${value.drive}/F${value.floor}:peak=${value.outputPeak.toExponential(3)},state=${value.statePeak.toFixed(3)},tail=${value.tailSeconds.toFixed(3)}s`).join(' ')}`);
});
