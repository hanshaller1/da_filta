const { test, expect } = require('playwright/test');

test.describe('linear TPT/ZDF SVF parity', () => {
  test.setTimeout(120000);

  test('matches the current unit-bandpass Biquad model without touching the production path', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await page.addScriptTag({ url: '/tpt-svf.js' });

    const result = await page.evaluate(() => {
      const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
      const qs = [...window.Filterbank.BAND_QS];
      const sampleRates = [44100, 48000];
      const finite = (value) => Number.isFinite(value);
      const round = (value) => Number(value.toExponential(6));

      const createBiquadBandpass = (frequency, q, sampleRate) => {
        const omega = (2 * Math.PI * frequency) / sampleRate;
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

      const boundaries = frequencies.slice(0, -1).map((frequency, index) => (
        Math.sqrt(frequency * frequencies[index + 1])
      ));
      const lowerEdge = (index) => (
        index === 0 ? frequencies[0] ** 2 / boundaries[0] : boundaries[index - 1]
      );
      const upperEdge = (index) => (
        index === frequencies.length - 1
          ? frequencies[index] ** 2 / boundaries[boundaries.length - 1]
          : boundaries[index]
      );
      const wrapPhase = (phase) => Math.atan2(Math.sin(phase), Math.cos(phase));

      const compareSignal = (
        sampleRate,
        frequency,
        q,
        makeInput,
        frames,
        skipFrames = 0,
        analysisFrequency = frequency
      ) => {
        const biquad = createBiquadBandpass(frequency, q, sampleRate);
        const tpt = new window.LinearTptSvf(sampleRate, frequency, q);
        let maxAbsError = 0;
        let maxAbsBiquad = 0;
        let maxAbsTpt = 0;
        let biquadEnergy = 0;
        let tptEnergy = 0;
        let biquadSin = 0;
        let biquadCos = 0;
        let tptSin = 0;
        let tptCos = 0;
        let finiteSamples = true;
        let measured = 0;

        for (let frame = 0; frame < frames; frame += 1) {
          const input = makeInput(frame);
          const biquadOutput = processBiquad(biquad, input);
          const tptOutput = tpt.process(input);
          const error = Math.abs(biquadOutput - tptOutput);

          maxAbsError = Math.max(maxAbsError, error);
          maxAbsBiquad = Math.max(maxAbsBiquad, Math.abs(biquadOutput));
          maxAbsTpt = Math.max(maxAbsTpt, Math.abs(tptOutput));
          finiteSamples = finiteSamples && finite(biquadOutput) && finite(tptOutput);

          if (frame >= skipFrames) {
            biquadEnergy += biquadOutput * biquadOutput;
            tptEnergy += tptOutput * tptOutput;
            const phase = (2 * Math.PI * analysisFrequency * frame) / sampleRate;
            biquadSin += biquadOutput * Math.sin(phase);
            biquadCos += biquadOutput * Math.cos(phase);
            tptSin += tptOutput * Math.sin(phase);
            tptCos += tptOutput * Math.cos(phase);
            measured += 1;
          }
        }

        const biquadPhase = Math.atan2(biquadCos, biquadSin);
        const tptPhase = Math.atan2(tptCos, tptSin);

        return {
          maxAbsError,
          maxAbsBiquad,
          maxAbsTpt,
          rmsError: Math.abs(Math.sqrt(biquadEnergy / measured) - Math.sqrt(tptEnergy / measured)),
          phaseError: Math.abs(wrapPhase(biquadPhase - tptPhase)),
          finiteSamples
        };
      };

      const createNoise = (seed) => {
        let state = seed >>> 0;
        return () => {
          state = (1664525 * state + 1013904223) >>> 0;
          return ((state / 0xffffffff) * 2 - 1) * 0.2;
        };
      };

      const byRate = {};
      let impulseMax = 0;
      let sineMax = 0;
      let noiseMax = 0;
      let phaseMax = 0;
      let rmsMax = 0;
      let allFinite = true;
      let allReset = true;

      for (const sampleRate of sampleRates) {
        const bands = [];

        for (let index = 0; index < frequencies.length; index += 1) {
          const frequency = frequencies[index];
          const q = qs[index];
          const impulse = compareSignal(
            sampleRate,
            frequency,
            q,
            (frame) => (frame === 0 ? 0.25 : 0),
            Math.max(16384, Math.ceil(sampleRate * 1.5))
          );
          const probes = [
            Math.max(1, lowerEdge(index) * 0.5),
            lowerEdge(index),
            frequency,
            upperEdge(index),
            Math.min(sampleRate * 0.45, upperEdge(index) * 2)
          ].filter((probe, probeIndex, values) => (
            probe > 0 && probe < sampleRate / 2 && values.indexOf(probe) === probeIndex
          ));
          const sine = probes.map((probe) => {
            const frames = Math.max(
              32768,
              Math.ceil(sampleRate * Math.max(1.5, 48 / Math.max(probe, 1)))
            );
            return {
              probe,
              ...compareSignal(
                sampleRate,
                frequency,
                q,
                (frame) => 0.2 * Math.sin((2 * Math.PI * probe * frame) / sampleRate),
                frames,
                Math.floor(frames / 2),
                probe
              )
            };
          });
          const noiseGenerator = createNoise((sampleRate + 1) * (index + 1));
          const noiseFrames = index < 2 ? sampleRate * 4 : sampleRate * 2;
          const noise = compareSignal(sampleRate, frequency, q, () => noiseGenerator(), noiseFrames);
          const filter = new window.LinearTptSvf(sampleRate, frequency, q);

          filter.process(0.5);
          filter.process(-0.25);
          filter.reset();
          const resetState = [
            filter.ic1eq,
            filter.ic2eq,
            filter.low,
            filter.band,
            filter.high,
            filter.unitBand,
            filter.notch,
            filter.peak
          ];
          let silenceFinite = true;
          let silenceMaximum = 0;
          for (let frame = 0; frame < 8192; frame += 1) {
            const output = filter.process(0);
            silenceFinite = silenceFinite && finite(output);
            silenceMaximum = Math.max(silenceMaximum, Math.abs(output));
          }
          const resetPass = resetState.every((value) => value === 0) && silenceFinite && silenceMaximum === 0;

          const bandSineMax = Math.max(...sine.map((measurement) => measurement.maxAbsError));
          const bandNoiseMax = noise.maxAbsError;
          const bandPhaseMax = Math.max(...sine.map((measurement) => measurement.phaseError));
          const bandRmsMax = Math.max(...sine.map((measurement) => measurement.rmsError));

          impulseMax = Math.max(impulseMax, impulse.maxAbsError);
          sineMax = Math.max(sineMax, bandSineMax);
          noiseMax = Math.max(noiseMax, bandNoiseMax);
          phaseMax = Math.max(phaseMax, bandPhaseMax);
          rmsMax = Math.max(rmsMax, bandRmsMax);
          allFinite = allFinite && impulse.finiteSamples && noise.finiteSamples && sine.every((measurement) => measurement.finiteSamples);
          allReset = allReset && resetPass;

          bands.push({
            frequency,
            impulse: round(impulse.maxAbsError),
            sine: round(bandSineMax),
            noise: round(bandNoiseMax),
            phase: round(bandPhaseMax),
            rms: round(bandRmsMax),
            resetPass
          });
        }

        byRate[sampleRate] = bands;
      }

      return {
        impulseMax,
        sineMax,
        noiseMax,
        phaseMax,
        rmsMax,
        allFinite,
        allReset,
        byRate
      };
    });

    expect(result.allFinite).toBe(true);
    expect(result.allReset).toBe(true);
    expect(result.impulseMax).toBeLessThanOrEqual(1e-12);
    expect(result.sineMax).toBeLessThanOrEqual(1e-12);
    expect(result.noiseMax).toBeLessThanOrEqual(1e-12);
    // The samplewise outputs are compared separately at a much stricter
    // threshold. This phase estimate is based on long accumulated sine sums,
    // so its tolerance covers only floating-point accumulation noise.
    expect(result.phaseMax).toBeLessThanOrEqual(1e-10);
    expect(result.rmsMax).toBeLessThanOrEqual(1e-12);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);

    console.log(`TPT_PARITY_MEASUREMENTS ${JSON.stringify(result)}`);

    await test.info().attach('tpt-parity-measurements.json', {
      body: Buffer.from(JSON.stringify(result, null, 2)),
      contentType: 'application/json'
    });
  });
});
