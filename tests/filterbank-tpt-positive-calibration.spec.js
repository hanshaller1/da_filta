const { test, expect } = require('playwright/test');

test('positive TPT audition calibration matrix stays monotone across gains, bands, signals and sample rates', async ({ page }) => {
  test.setTimeout(180000);
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const { LinearTptSvf } = await import('/tpt-svf.js');
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const gains = [0.10, 0.20, 0.30, 0.40];
    const resonances = [0, 0.25, 0.50, 0.75, 1];
    const indices = [0, 4, 5, 9];
    const rates = [44100, 48000];
    const signals = ['center', 'noise', 'multi'];
    const dampingFloor = window.Filterbank.RESONATOR_DAMPING_FLOOR;
    const buildSignal = ({ sampleRate, frameCount, frequency, signal }) => {
      const values = new Float64Array(frameCount);
      let randomState = 0x6a09e667;
      for (let frame = 0; frame < frameCount; frame += 1) {
        const time = frame / sampleRate;
        if (signal === 'noise') {
          randomState = (1664525 * randomState + 1013904223) >>> 0;
          values[frame] = ((randomState / 0xffffffff) * 2 - 1) * 0.006;
        } else if (signal === 'multi') {
          values[frame] = 0.0035 * (
            Math.sin(2 * Math.PI * 79 * time)
            + Math.sin(2 * Math.PI * frequency * time + 0.31)
            + Math.sin(2 * Math.PI * 997 * time + 0.59)
            + Math.sin(2 * Math.PI * 2800 * time + 0.17)
          );
        } else {
          values[frame] = 0.01 * Math.sin(2 * Math.PI * frequency * time);
        }
      }
      return values;
    };
    const measure = ({ sampleRate, index, signal, resonance, auditionGain, dryWet = 100, gate = true }) => {
      const frequency = frequencies[index];
      const frameCount = Math.round(sampleRate * (frequency <= 61 ? 1.5 : 0.35));
      const source = buildSignal({ sampleRate, frameCount, frequency, signal });
      const base = new LinearTptSvf(sampleRate, frequency, qs[index]);
      const resonator = new LinearTptSvf(sampleRate, frequency, qs[index]);
      const magnitude = gate && resonance > 0 ? resonance : 0;
      resonator.setDampingScale(1 - (1 - dampingFloor) * magnitude);
      const wetMix = dryWet / 100;
      let outputPeak = 0;
      let outputEnergy = 0;
      let residualPeak = 0;
      let residualEnergy = 0;
      let targetBandEnergy = 0;
      let finite = true;
      for (let frame = 0; frame < frameCount; frame += 1) {
        const input = source[frame];
        const baseBand = base.process(input);
        const resonantBand = resonator.process(input);
        const residual = resonantBand - baseBand;
        const wet = input + auditionGain * residual;
        const output = (1 - wetMix) * input + wetMix * wet;
        outputPeak = Math.max(outputPeak, Math.abs(output));
        outputEnergy += output * output;
        residualPeak = Math.max(residualPeak, Math.abs(residual));
        residualEnergy += residual * residual;
        targetBandEnergy += resonantBand * resonantBand;
        finite = finite && Number.isFinite(baseBand) && Number.isFinite(resonantBand) && Number.isFinite(residual) && Number.isFinite(output);
      }
      return {
        outputPeak,
        outputRms: Math.sqrt(outputEnergy / frameCount),
        residualPeak,
        residualRms: Math.sqrt(residualEnergy / frameCount),
        targetBandEnergy,
        finite
      };
    };
    const matrix = {};
    for (const sampleRate of rates) {
      matrix[sampleRate] = {};
      for (const index of indices) {
        matrix[sampleRate][index] = {};
        for (const signal of signals) {
          matrix[sampleRate][index][signal] = {};
          for (const resonance of resonances) {
            matrix[sampleRate][index][signal][resonance] = {};
            for (const auditionGain of gains) {
              matrix[sampleRate][index][signal][resonance][auditionGain] = measure({ sampleRate, index, signal, resonance, auditionGain });
            }
          }
        }
      }
    }
    const dryWet = gains.map(auditionGain => ({
      auditionGain,
      dry: measure({ sampleRate: 48000, index: 4, signal: 'multi', resonance: 1, auditionGain, dryWet: 0 }),
      half: measure({ sampleRate: 48000, index: 4, signal: 'multi', resonance: 1, auditionGain, dryWet: 50 }),
      wet: measure({ sampleRate: 48000, index: 4, signal: 'multi', resonance: 1, auditionGain, dryWet: 100 }),
      gateOff: measure({ sampleRate: 48000, index: 4, signal: 'multi', resonance: 1, auditionGain, gate: false }),
      resonanceZero: measure({ sampleRate: 48000, index: 4, signal: 'multi', resonance: 0, auditionGain })
    }));
    const db = ratio => 20 * Math.log10(Math.max(ratio, 1e-20));
    const snapshot = Object.fromEntries(gains.map(auditionGain => {
      const baseline = matrix[48000][4].multi[0][auditionGain];
      const full = matrix[48000][4].multi[1][auditionGain];
      return [auditionGain, { outputDbDelta: db(full.outputRms / baseline.outputRms), residualRms: full.residualRms }];
    }));
    return { matrix, dryWet, snapshot };
  });

  for (const sampleRate of [44100, 48000]) {
    for (const index of [0, 4, 5, 9]) {
      for (const signal of ['center', 'noise', 'multi']) {
        for (const resonance of [0, 0.25, 0.5, 0.75, 1]) {
          let previousAudibleResidualRms = 0;
          for (const auditionGain of [0.1, 0.2, 0.3, 0.4]) {
            const measurement = result.matrix[sampleRate][index][signal][resonance][auditionGain];
            expect(measurement.finite).toBeTruthy();
            if (resonance === 0) expect(measurement.residualPeak).toBeLessThanOrEqual(1e-12);
            if (resonance > 0) expect(measurement.residualRms).toBeGreaterThan(0);
            const audibleResidualRms = auditionGain * measurement.residualRms;
            expect(audibleResidualRms).toBeGreaterThanOrEqual(previousAudibleResidualRms * (1 - 1e-12));
            previousAudibleResidualRms = audibleResidualRms;
          }
        }
      }
    }
  }
  for (const measurement of result.dryWet) {
    expect(measurement.dry.residualPeak).toBeGreaterThan(0);
    expect(measurement.dry.outputRms).toBeLessThan(measurement.half.outputRms);
    expect(measurement.half.outputRms).toBeLessThan(measurement.wet.outputRms);
    expect(measurement.gateOff.residualPeak).toBeLessThanOrEqual(1e-12);
    expect(measurement.resonanceZero.residualPeak).toBeLessThanOrEqual(1e-12);
  }
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `Browser page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  console.log(`TPT_POSITIVE_CALIBRATION 48k Band5 multi ${[0.1, 0.2, 0.3, 0.4].map(gain => `${gain}:${result.snapshot[gain].outputDbDelta.toFixed(3)}dB/res=${result.snapshot[gain].residualRms.toExponential(3)}`).join(' ')}`);
});
