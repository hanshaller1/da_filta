const { test, expect } = require('playwright/test');

test('diagnostic TPT SVF model matches the base bandpass and removes external-loop phase dependence', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const frequencies = window.Filterbank.BAND_FREQUENCIES;
    const qs = window.Filterbank.BAND_QS;
    const sampleRates = [44100, 48000];
    const selectedIndices = [0, 1, 4, 5, 7, 9];

    const createBiquad = (frequency, q, sampleRate) => {
      const omega = 2 * Math.PI * frequency / sampleRate;
      const alpha = Math.sin(omega) / (2 * q);
      const a0 = 1 + alpha;
      return {
        b0: alpha / a0,
        b1: 0,
        b2: -alpha / a0,
        a1: (-2 * Math.cos(omega)) / a0,
        a2: (1 - alpha) / a0,
        z1: 0,
        z2: 0
      };
    };
    const processBiquad = (filter, input) => {
      const output = filter.b0 * input + filter.z1;
      filter.z1 = filter.b1 * input - filter.a1 * output + filter.z2;
      filter.z2 = filter.b2 * input - filter.a2 * output;
      return output;
    };

    const createTptSvf = (frequency, q, sampleRate, dampingScale = 1) => {
      const g = Math.tan(Math.PI * frequency / sampleRate);
      const baseK = 1 / q;
      const k = Math.max(1e-6, baseK * dampingScale);
      const a1 = 1 / (1 + g * (g + k));
      const a2 = g * a1;
      const a3 = g * a2;
      return { a1, a2, a3, baseK, k, ic1eq: 0, ic2eq: 0 };
    };
    const processTptSvf = (filter, input) => {
      const v3 = input - filter.ic2eq;
      const band = filter.a1 * filter.ic1eq + filter.a2 * v3;
      const low = filter.ic2eq + filter.a2 * filter.ic1eq + filter.a3 * v3;
      filter.ic1eq = 2 * band - filter.ic1eq;
      filter.ic2eq = 2 * low - filter.ic2eq;
      const high = input - filter.k * band - low;
      return {
        low,
        band,
        high,
        unitBand: filter.baseK * band,
        peak: low - high
      };
    };

    const impulseParity = {};
    const resonantGain = {};
    const currentLoopDrive = {};
    for (const sampleRate of sampleRates) {
      impulseParity[sampleRate] = {};
      resonantGain[sampleRate] = {};
      currentLoopDrive[sampleRate] = {};
      for (const index of selectedIndices) {
        const frequency = frequencies[index];
        const q = qs[index];
        const biquad = createBiquad(frequency, q, sampleRate);
        const tpt = createTptSvf(frequency, q, sampleRate);
        let maxError = 0;
        for (let frame = 0; frame < 8192; frame += 1) {
          const input = frame === 0 ? 1 : 0;
          maxError = Math.max(maxError, Math.abs(processBiquad(biquad, input) - processTptSvf(tpt, input).unitBand));
        }
        impulseParity[sampleRate][index] = maxError;

        const base = createTptSvf(frequency, q, sampleRate);
        const resonant = createTptSvf(frequency, q, sampleRate, 0.1);
        let baseEnergy = 0;
        let resonantEnergy = 0;
        const frameCount = Math.round(sampleRate * 2);
        const measurementStart = Math.floor(frameCount * 0.75);
        for (let frame = 0; frame < frameCount; frame += 1) {
          const input = 0.001 * Math.sin(2 * Math.PI * frequency * frame / sampleRate);
          const baseOutput = processTptSvf(base, input).unitBand;
          const resonantOutput = processTptSvf(resonant, input).unitBand;
          if (frame >= measurementStart) {
            baseEnergy += baseOutput * baseOutput;
            resonantEnergy += resonantOutput * resonantOutput;
          }
        }
        resonantGain[sampleRate][index] = Math.sqrt(resonantEnergy / baseEnergy);

        currentLoopDrive[sampleRate][index] = {};
        for (const resonance of [0.5, 0.75, 1, -0.5, -0.75, -1]) {
          const loopFilter = createBiquad(frequency, q, sampleRate);
          const frameTotal = Math.round(sampleRate * 0.5);
          let feedbackReturn = 0;
          let maxDrive = 0;
          let driveEnergy = 0;
          let maxSaturationDelta = 0;
          let nonlinearSamples = 0;
          for (let frame = 0; frame < frameTotal; frame += 1) {
            const input = frame === 0 ? 0.05 : 0;
            const bandOutput = processBiquad(loopFilter, input + feedbackReturn);
            const drive = Math.sign(resonance) * 1.25 * resonance * resonance * bandOutput;
            feedbackReturn = Math.tanh(drive);
            maxDrive = Math.max(maxDrive, Math.abs(drive));
            driveEnergy += drive * drive;
            maxSaturationDelta = Math.max(maxSaturationDelta, Math.abs(feedbackReturn - drive));
            if (Math.abs(drive) >= 0.25) nonlinearSamples += 1;
          }
          currentLoopDrive[sampleRate][index][resonance] = {
            maxDrive,
            driveRms: Math.sqrt(driveEnergy / frameTotal),
            maxSaturationDelta,
            nonlinearFraction: nonlinearSamples / frameTotal
          };
        }
      }
    }

    const harmonicMetrics = (shape, amplitude = 0.25, sampleCount = 65536) => {
      const harmonics = Array(6).fill(0).map(() => ({ real: 0, imag: 0 }));
      for (let frame = 0; frame < sampleCount; frame += 1) {
        const phase = 2 * Math.PI * frame / 1024;
        const output = shape(amplitude * Math.sin(phase));
        for (let harmonic = 1; harmonic <= harmonics.length; harmonic += 1) {
          harmonics[harmonic - 1].real += output * Math.cos(harmonic * phase);
          harmonics[harmonic - 1].imag -= output * Math.sin(harmonic * phase);
        }
      }
      const magnitudes = harmonics.map(value => Math.hypot(value.real, value.imag));
      return magnitudes.map(value => value / magnitudes[0]);
    };
    const normalizedAsymmetricTanh = (value, drive, bias) => {
      const offset = Math.tanh(drive * bias);
      const slope = drive * (1 - offset * offset);
      return (Math.tanh(drive * (value + bias)) - offset) / slope;
    };
    const harmonics = {
      currentTanh: harmonicMetrics(value => Math.tanh(value)),
      drivenTanh: harmonicMetrics(value => Math.tanh(4 * value) / 4),
      asymmetricTanh: harmonicMetrics(value => normalizedAsymmetricTanh(value, 4, 0.12))
    };

    return { impulseParity, resonantGain, currentLoopDrive, harmonics };
  });

  for (const sampleRate of [44100, 48000]) {
    for (const index of [0, 1, 4, 5, 7, 9]) {
      expect(result.impulseParity[sampleRate][index]).toBeLessThan(1e-12);
      expect(result.resonantGain[sampleRate][index]).toBeCloseTo(10, 3);
    }
    for (const index of [0, 1, 4, 5, 7, 9]) {
      expect(result.currentLoopDrive[sampleRate][index]['0.75'].maxSaturationDelta).toBeLessThan(1e-6);
      expect(result.currentLoopDrive[sampleRate][index]['-1'].nonlinearFraction).toBe(0);
    }
  }
  expect(result.currentLoopDrive['48000']['4']['1'].maxSaturationDelta).toBeGreaterThan(0.2);
  expect(result.currentLoopDrive['48000']['4']['1'].nonlinearFraction).toBeGreaterThan(0.5);
  expect(result.currentLoopDrive['48000']['9']['1'].maxSaturationDelta).toBeLessThan(1e-5);
  expect(result.harmonics.currentTanh[2]).toBeLessThan(0.01);
  expect(result.harmonics.drivenTanh[2]).toBeGreaterThan(0.05);
  expect(result.harmonics.asymmetricTanh[1]).toBeGreaterThan(0.1);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
