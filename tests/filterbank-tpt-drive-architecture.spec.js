const { test, expect } = require('playwright/test');

test('diagnostic nonlinear TPT resonance architectures preserve small-signal tuning and quantify drive character', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  const report = await page.evaluate(() => {
    const frequencies = window.Filterbank.BAND_FREQUENCIES;
    const qs = window.Filterbank.BAND_QS;
    const selectedBands = [0, 4, 5, 7, 8, 9];
    const sampleRates = [44100, 48000];
    const resonances = [0.25, 0.5, 0.75, 1];

    const createFilter = (frequency, q, sampleRate) => ({
      g: Math.tan(Math.PI * frequency / sampleRate),
      baseK: 1 / q,
      ic1eq: 0,
      ic2eq: 0,
      maximumState: 0,
      finite: true,
      solverCalls: 0,
      solverIterations: 0,
      solverMaximumIterations: 0,
      solverFailures: 0
    });

    const updateStates = (filter, band, low) => {
      const nextIc1eq = 2 * band - filter.ic1eq;
      const nextIc2eq = 2 * low - filter.ic2eq;
      if (!Number.isFinite(nextIc1eq + nextIc2eq + band + low)) {
        filter.ic1eq = 0;
        filter.ic2eq = 0;
        filter.finite = false;
        return 0;
      }
      filter.ic1eq = nextIc1eq;
      filter.ic2eq = nextIc2eq;
      filter.maximumState = Math.max(filter.maximumState, Math.abs(nextIc1eq), Math.abs(nextIc2eq));
      return filter.baseK * band;
    };

    const processLinear = (filter, input, dampingScale) => {
      const k = filter.baseK * dampingScale;
      const denominator = 1 + filter.g * (filter.g + k);
      const band = (filter.ic1eq + filter.g * (input - filter.ic2eq)) / denominator;
      const low = filter.ic2eq + filter.g * band;
      return updateStates(filter, band, low);
    };

    const saturators = {
      tanh(value, drive) {
        if (drive <= 1e-9) return { value, derivative: 1 };
        const shaped = Math.tanh(drive * value);
        return { value: shaped / drive, derivative: 1 - shaped * shaped };
      },
      cubic(value, drive) {
        if (drive <= 1e-9) return { value, derivative: 1 };
        const driven = drive * value;
        if (driven >= 1) return { value: 2 / (3 * drive), derivative: 0 };
        if (driven <= -1) return { value: -2 / (3 * drive), derivative: 0 };
        return {
          value: (driven - driven * driven * driven / 3) / drive,
          derivative: 1 - driven * driven
        };
      },
      asymmetric(value, drive) {
        if (drive <= 1e-9) return { value, derivative: 1 };
        const bias = 0.12;
        const offset = Math.tanh(drive * bias);
        const normalization = 1 - offset * offset;
        const shaped = Math.tanh(drive * (value + bias));
        return {
          value: (shaped - offset) / (drive * normalization),
          derivative: (1 - shaped * shaped) / normalization
        };
      },
      twoStage(value, drive) {
        if (drive <= 1e-9) return { value, derivative: 1 };
        const firstDrive = Math.sqrt(drive);
        const firstRaw = Math.tanh(firstDrive * value);
        const first = firstRaw / firstDrive;
        const secondRaw = Math.tanh(firstDrive * first);
        return {
          value: secondRaw / firstDrive,
          derivative: (1 - firstRaw * firstRaw) * (1 - secondRaw * secondRaw)
        };
      }
    };

    const processFeedbackSaturation = (filter, input, resonance, drive, saturationName = 'tanh') => {
      const dampingScale = 1 - 0.9 * resonance;
      const feedbackAmount = filter.baseK * (1 - dampingScale);
      const linearDenominator = 1 + filter.g * (filter.g + filter.baseK - feedbackAmount);
      const rhs = filter.ic1eq + filter.g * (input - filter.ic2eq);
      let band = rhs / linearDenominator;
      const saturation = saturators[saturationName];
      let converged = false;
      let usedIterations = 0;
      for (let iteration = 0; iteration < 4; iteration += 1) {
        usedIterations = iteration + 1;
        const shaped = saturation(band, drive);
        const equation = (1 + filter.g * filter.g + filter.g * filter.baseK) * band
          - filter.g * feedbackAmount * shaped.value - rhs;
        const derivative = 1 + filter.g * filter.g + filter.g * filter.baseK
          - filter.g * feedbackAmount * shaped.derivative;
        if (!Number.isFinite(equation + derivative) || Math.abs(derivative) < 1e-12) break;
        const correction = equation / derivative;
        band -= correction;
        if (Math.abs(correction) <= 1e-10 * Math.max(1, Math.abs(band))) {
          converged = true;
          break;
        }
      }
      if (!converged) {
        const shaped = saturation(band, drive);
        const equation = (1 + filter.g * filter.g + filter.g * filter.baseK) * band
          - filter.g * feedbackAmount * shaped.value - rhs;
        converged = Number.isFinite(equation) && Math.abs(equation) < 1e-7;
      }
      filter.solverCalls += 1;
      filter.solverIterations += usedIterations;
      filter.solverMaximumIterations = Math.max(filter.solverMaximumIterations, usedIterations);
      if (!converged) filter.solverFailures += 1;
      filter.finite = filter.finite && Number.isFinite(band) && converged;
      const low = filter.ic2eq + filter.g * band;
      return updateStates(filter, band, low);
    };

    const processDampingSaturation = (filter, input, resonance, drive) => {
      const effectiveK = filter.baseK * (1 - 0.9 * resonance);
      const rhs = filter.ic1eq + filter.g * (input - filter.ic2eq);
      let band = rhs / (1 + filter.g * (filter.g + effectiveK));
      for (let iteration = 0; iteration < 4; iteration += 1) {
        const shaped = saturators.tanh(band, drive);
        const equation = (1 + filter.g * filter.g) * band + filter.g * effectiveK * shaped.value - rhs;
        const derivative = 1 + filter.g * filter.g + filter.g * effectiveK * shaped.derivative;
        band -= equation / derivative;
      }
      const low = filter.ic2eq + filter.g * band;
      return updateStates(filter, band, low);
    };

    const processStateSaturation = (filter, input, resonance, drive) => {
      const output = processLinear(filter, input, 1 - 0.9 * resonance);
      const first = saturators.tanh(filter.ic1eq, drive).value;
      const second = saturators.tanh(filter.ic2eq, drive).value;
      filter.ic1eq = first;
      filter.ic2eq = second;
      filter.maximumState = Math.max(filter.maximumState, Math.abs(first), Math.abs(second));
      return output;
    };

    const processInputSaturation = (filter, input, resonance, drive) => {
      const shapedInput = saturators.tanh(input, drive).value;
      return processLinear(filter, shapedInput, 1 - 0.9 * resonance);
    };

    const foldFrequency = (frequency, sampleRate) => {
      let folded = frequency % sampleRate;
      if (folded > sampleRate / 2) folded = sampleRate - folded;
      return Math.abs(folded);
    };

    const analyzeSine = ({ sampleRate, frequency, signalFrequency = frequency, q, resonance, amplitude, drive, mode, saturationName = 'tanh' }) => {
      const filter = createFilter(frequency, q, sampleRate);
      const seconds = frequency <= 29 ? 10 : frequency <= 61 ? 6 : 3;
      const frameCount = Math.round(sampleRate * seconds);
      const analysisLength = Math.min(Math.round(sampleRate), Math.floor(frameCount / 2));
      const analysisStart = frameCount - analysisLength;
      const harmonicBins = Array.from({ length: 8 }, (_, index) => foldFrequency((index + 1) * signalFrequency, sampleRate));
      const real = new Float64Array(harmonicBins.length);
      const imaginary = new Float64Array(harmonicBins.length);
      let peak = 0;
      let energy = 0;
      let mean = 0;
      let residualPeak = 0;
      let residualEnergy = 0;
      const baseFilter = createFilter(frequency, q, sampleRate);
      for (let frame = 0; frame < frameCount; frame += 1) {
        const input = amplitude * Math.sin(2 * Math.PI * signalFrequency * frame / sampleRate);
        const baseOutput = processLinear(baseFilter, input, 1);
        let output;
        if (mode === 'linear') output = processLinear(filter, input, 1 - 0.9 * resonance);
        else if (mode === 'feedback') output = processFeedbackSaturation(filter, input, resonance, drive, saturationName);
        else if (mode === 'damping') output = processDampingSaturation(filter, input, resonance, drive);
        else if (mode === 'state') output = processStateSaturation(filter, input, resonance, drive);
        else if (mode === 'input') output = processInputSaturation(filter, input, resonance, drive);
        else {
          const resonant = processLinear(filter, input, 1 - 0.9 * resonance);
          const residual = resonant - baseOutput;
          output = baseOutput + saturators.tanh(residual, drive).value;
        }
        if (frame >= analysisStart) {
          const localFrame = frame - analysisStart;
          const residual = output - baseOutput;
          peak = Math.max(peak, Math.abs(output));
          energy += output * output;
          mean += output;
          residualPeak = Math.max(residualPeak, Math.abs(residual));
          residualEnergy += residual * residual;
          for (let harmonic = 0; harmonic < harmonicBins.length; harmonic += 1) {
            const phase = 2 * Math.PI * harmonicBins[harmonic] * localFrame / sampleRate;
            real[harmonic] += output * Math.cos(phase);
            imaginary[harmonic] -= output * Math.sin(phase);
          }
        }
      }
      const rms = Math.sqrt(energy / analysisLength);
      const magnitudes = Array.from(real, (value, index) => 2 * Math.hypot(value, imaginary[index]) / analysisLength);
      const fundamental = Math.max(magnitudes[0], 1e-18);
      const harmonicRatios = magnitudes.map(value => value / fundamental);
      const thd = Math.sqrt(harmonicRatios.slice(1).reduce((sum, value) => sum + value * value, 0));
      return {
        peak,
        rms,
        crestFactor: peak / Math.max(rms, 1e-18),
        statePeak: filter.maximumState,
        dc: mean / analysisLength,
        residualPeak,
        residualRms: Math.sqrt(residualEnergy / analysisLength),
        thd,
        h2: harmonicRatios[1],
        h3: harmonicRatios[2],
        h4Plus: Math.sqrt(harmonicRatios.slice(3).reduce((sum, value) => sum + value * value, 0)),
        aliasIndicators: harmonicRatios.slice(1),
        solverMeanIterations: filter.solverIterations / Math.max(1, filter.solverCalls),
        solverMaximumIterations: filter.solverMaximumIterations,
        solverFailures: filter.solverFailures,
        finite: filter.finite && Object.values({ peak, rms, thd }).every(Number.isFinite)
      };
    };

    const analyzeTransient = ({ sampleRate, frequency, q, resonance, drive, signal }) => {
      const filter = createFilter(frequency, q, sampleRate);
      const frameCount = Math.round(sampleRate * (frequency <= 61 ? 4 : 1));
      let peak = 0;
      let energy = 0;
      let tailEnergy = 0;
      let lastAbove = 0;
      let seed = 0x12345678;
      for (let frame = 0; frame < frameCount; frame += 1) {
        let input = 0;
        if (signal === 'impulse') input = frame === 0 ? 0.1 : 0;
        else if (signal === 'noise') {
          seed = (1664525 * seed + 1013904223) >>> 0;
          input = 0.05 * ((seed / 0xffffffff) * 2 - 1);
        } else {
          input = 0.025 * (
            Math.sin(2 * Math.PI * frequency * frame / sampleRate)
            + Math.sin(2 * Math.PI * frequency * 0.63 * frame / sampleRate)
            + Math.sin(2 * Math.PI * frequency * 1.71 * frame / sampleRate)
          );
        }
        const output = processFeedbackSaturation(filter, input, resonance, drive, 'tanh');
        peak = Math.max(peak, Math.abs(output));
        energy += output * output;
        if (frame > frameCount * 0.75) tailEnergy += output * output;
        if (Math.abs(output) > 1e-5) lastAbove = frame;
      }
      return {
        peak,
        rms: Math.sqrt(energy / frameCount),
        tailRms: Math.sqrt(tailEnergy / Math.max(1, frameCount - Math.floor(frameCount * 0.75))),
        decaySeconds: lastAbove / sampleRate,
        statePeak: filter.maximumState,
        finite: filter.finite && Number.isFinite(energy)
      };
    };

    const linearLevels = {};
    const feedbackDrive = {};
    const positionComparison = {};
    const saturationComparison = {};
    const transientSignals = {};
    const levelSensitivity = {};
    const offCenterResponse = {};
    for (const sampleRate of sampleRates) {
      linearLevels[sampleRate] = {};
      feedbackDrive[sampleRate] = {};
      for (const index of selectedBands) {
        const frequency = frequencies[index];
        const q = qs[index];
        linearLevels[sampleRate][frequency] = {};
        feedbackDrive[sampleRate][frequency] = {};
        for (const resonance of resonances) {
          linearLevels[sampleRate][frequency][resonance] = analyzeSine({
            sampleRate, frequency, q, resonance, amplitude: 0.05, drive: 0, mode: 'linear'
          });
          feedbackDrive[sampleRate][frequency][resonance] = {};
          for (const drive of [1, 2, 4, 8]) {
            feedbackDrive[sampleRate][frequency][resonance][drive] = analyzeSine({
              sampleRate, frequency, q, resonance, amplitude: 0.05, drive, mode: 'feedback'
            });
          }
        }
      }

      positionComparison[sampleRate] = {};
      saturationComparison[sampleRate] = {};
      transientSignals[sampleRate] = {};
      levelSensitivity[sampleRate] = {};
      offCenterResponse[sampleRate] = {};
      for (const index of [4, 9]) {
        const frequency = frequencies[index];
        const q = qs[index];
        positionComparison[sampleRate][frequency] = {};
        for (const mode of ['feedback', 'damping', 'state', 'input', 'residual']) {
          positionComparison[sampleRate][frequency][mode] = analyzeSine({
            sampleRate, frequency, q, resonance: 1, amplitude: 0.05, drive: 4, mode
          });
        }
        saturationComparison[sampleRate][frequency] = {};
        for (const saturationName of ['tanh', 'cubic', 'asymmetric', 'twoStage']) {
          saturationComparison[sampleRate][frequency][saturationName] = analyzeSine({
            sampleRate, frequency, q, resonance: 1, amplitude: 0.05, drive: 4,
            mode: 'feedback', saturationName
          });
        }
        transientSignals[sampleRate][frequency] = {};
        for (const signal of ['impulse', 'noise', 'multi']) {
          transientSignals[sampleRate][frequency][signal] = analyzeTransient({
            sampleRate, frequency, q, resonance: 1, drive: 4, signal
          });
        }
        levelSensitivity[sampleRate][frequency] = {};
        for (const amplitude of [0.01, 0.025, 0.05, 0.1, 0.25]) {
          levelSensitivity[sampleRate][frequency][amplitude] = analyzeSine({
            sampleRate, frequency, q, resonance: 1, amplitude, drive: 4, mode: 'feedback'
          });
        }
        offCenterResponse[sampleRate][frequency] = {
          below: analyzeSine({
            sampleRate, frequency, signalFrequency: frequency * 0.7, q,
            resonance: 1, amplitude: 0.05, drive: 4, mode: 'feedback'
          }),
          above: analyzeSine({
            sampleRate, frequency, signalFrequency: frequency * 1.4, q,
            resonance: 1, amplitude: 0.05, drive: 4, mode: 'feedback'
          })
        };
      }
    }

    const selfOscillationProbe = {};
    for (const sampleRate of sampleRates) {
      selfOscillationProbe[sampleRate] = {};
      for (const index of [0, 4, 9]) {
        const frequency = frequencies[index];
        const q = qs[index];
        const filter = createFilter(frequency, q, sampleRate);
        const frameCount = Math.round(sampleRate * (frequency === 29 ? 6 : 2));
        let tailEnergy = 0;
        let tailPeak = 0;
        // A controlled diagnostic excursion beyond zero damping. This is not
        // the production mapping; it only tests whether saturation can bound
        // a future oscillatory region.
        for (let frame = 0; frame < frameCount; frame += 1) {
          const input = frame === 0 ? 0.001 : 0;
          const resonanceBeyondCurrentRange = 1.12;
          const output = processFeedbackSaturation(filter, input, resonanceBeyondCurrentRange, 4, 'tanh');
          if (frame >= frameCount * 0.75) {
            tailPeak = Math.max(tailPeak, Math.abs(output));
            tailEnergy += output * output;
          }
        }
        selfOscillationProbe[sampleRate][frequency] = {
          tailPeak,
          tailRms: Math.sqrt(tailEnergy / Math.max(1, frameCount * 0.25)),
          statePeak: filter.maximumState,
          finite: filter.finite && Number.isFinite(tailEnergy)
        };
      }
    }

    const benchmark = (nonlinear, oversampling) => {
      const durations = [];
      for (let repetition = 0; repetition < 4; repetition += 1) {
        const rate = 48000 * oversampling;
        const filters = [];
        for (let channel = 0; channel < 2; channel += 1) {
          for (let band = 0; band < frequencies.length; band += 1) {
            filters.push(createFilter(frequencies[band], qs[band], rate));
          }
        }
        let checksum = 0;
        const started = performance.now();
        for (let frame = 0; frame < 48000; frame += 1) {
          const input = 0.05 * Math.sin(2 * Math.PI * 411 * frame / 48000);
          for (let phase = 0; phase < oversampling; phase += 1) {
            for (let index = 0; index < filters.length; index += 1) {
              checksum += nonlinear
                ? processFeedbackSaturation(filters[index], input, 1, 4, 'tanh')
                : processLinear(filters[index], input, 0.1);
            }
          }
        }
        durations.push(performance.now() - started + checksum * 0);
      }
      durations.sort((left, right) => left - right);
      return (durations[1] + durations[2]) / 2;
    };
    // Warm-up and then compare one second of 20 resonator filters. These are
    // directional browser timings, not a real-time deadline guarantee.
    benchmark(false, 1);
    const performanceCosts = {
      linear1xMs: benchmark(false, 1),
      nonlinear1xMs: benchmark(true, 1),
      nonlinear2xMs: benchmark(true, 2)
    };
    performanceCosts.nonlinearToLinear = performanceCosts.nonlinear1xMs / performanceCosts.linear1xMs;
    performanceCosts.oversampledToNonlinear = performanceCosts.nonlinear2xMs / performanceCosts.nonlinear1xMs;

    return {
      linearLevels,
      feedbackDrive,
      positionComparison,
      saturationComparison,
      transientSignals,
      levelSensitivity,
      offCenterResponse,
      selfOscillationProbe,
      performanceCosts
    };
  });

  for (const sampleRate of ['44100', '48000']) {
    for (const frequency of ['29', '411', '777', '2800', '5200', '11000']) {
      const levels = report.linearLevels[sampleRate][frequency];
      expect(levels['0.25'].rms).toBeLessThan(levels['0.5'].rms);
      expect(levels['0.5'].rms).toBeLessThan(levels['0.75'].rms);
      expect(levels['0.75'].rms).toBeLessThan(levels['1'].rms);
      expect(levels['1'].thd).toBeLessThan(1e-6);
      for (const resonance of ['0.25', '0.5', '0.75', '1']) {
        for (const drive of ['1', '2', '4', '8']) {
          expect(report.feedbackDrive[sampleRate][frequency][resonance][drive].finite).toBe(true);
        }
      }
      expect(report.feedbackDrive[sampleRate][frequency]['1']['4'].thd).toBeGreaterThan(0.001);
    }
    for (const frequency of ['411', '11000']) {
      expect(report.positionComparison[sampleRate][frequency].feedback.finite).toBe(true);
      expect(report.positionComparison[sampleRate][frequency].feedback.thd).toBeGreaterThan(0.001);
      expect(report.positionComparison[sampleRate][frequency].input.statePeak)
        .toBeLessThan(report.linearLevels[sampleRate][frequency]['1'].statePeak);
      expect(report.saturationComparison[sampleRate][frequency].asymmetric.h2).toBeGreaterThan(0.00001);
      for (const signal of ['impulse', 'noise', 'multi']) {
        expect(report.transientSignals[sampleRate][frequency][signal].finite).toBe(true);
      }
      expect(report.levelSensitivity[sampleRate][frequency]['0.01'].thd)
        .toBeLessThan(report.levelSensitivity[sampleRate][frequency]['0.25'].thd);
      expect(report.offCenterResponse[sampleRate][frequency].below.finite).toBe(true);
      expect(report.offCenterResponse[sampleRate][frequency].above.finite).toBe(true);
    }
    for (const frequency of ['29', '411', '11000']) {
      expect(report.selfOscillationProbe[sampleRate][frequency].finite).toBe(true);
    }
  }

  const summary = {};
  for (const sampleRate of ['44100', '48000']) {
    summary[sampleRate] = {
      bands: {},
      positions: report.positionComparison[sampleRate],
      saturators: report.saturationComparison[sampleRate],
      transients: report.transientSignals[sampleRate],
      inputLevel: report.levelSensitivity[sampleRate],
      offCenter: report.offCenterResponse[sampleRate],
      selfOscillation: report.selfOscillationProbe[sampleRate]
    };
    for (const frequency of ['29', '411', '777', '2800', '5200', '11000']) {
      summary[sampleRate].bands[frequency] = {
        linear: Object.fromEntries(['0.25', '0.5', '0.75', '1'].map(resonance => [resonance, {
          rms: report.linearLevels[sampleRate][frequency][resonance].rms,
          statePeak: report.linearLevels[sampleRate][frequency][resonance].statePeak,
          crest: report.linearLevels[sampleRate][frequency][resonance].crestFactor,
          thd: report.linearLevels[sampleRate][frequency][resonance].thd
        }])),
        feedbackDrive4: Object.fromEntries(['0.25', '0.5', '0.75', '1'].map(resonance => [resonance, {
          rms: report.feedbackDrive[sampleRate][frequency][resonance]['4'].rms,
          statePeak: report.feedbackDrive[sampleRate][frequency][resonance]['4'].statePeak,
          crest: report.feedbackDrive[sampleRate][frequency][resonance]['4'].crestFactor,
          thd: report.feedbackDrive[sampleRate][frequency][resonance]['4'].thd,
          h3: report.feedbackDrive[sampleRate][frequency][resonance]['4'].h3,
          alias: report.feedbackDrive[sampleRate][frequency][resonance]['4'].h4Plus
          , solverMean: report.feedbackDrive[sampleRate][frequency][resonance]['4'].solverMeanIterations
          , solverMax: report.feedbackDrive[sampleRate][frequency][resonance]['4'].solverMaximumIterations
          , solverFailures: report.feedbackDrive[sampleRate][frequency][resonance]['4'].solverFailures
        }])),
        driveSweepAtMaximum: Object.fromEntries(['1', '2', '4', '8'].map(drive => [drive, {
          rms: report.feedbackDrive[sampleRate][frequency]['1'][drive].rms,
          thd: report.feedbackDrive[sampleRate][frequency]['1'][drive].thd,
          h3: report.feedbackDrive[sampleRate][frequency]['1'][drive].h3
        }]))
      };
    }
  }
  summary.performanceCosts = report.performanceCosts;
  console.log(`TPT_DRIVE_ARCHITECTURE ${JSON.stringify(summary)}`);
});
