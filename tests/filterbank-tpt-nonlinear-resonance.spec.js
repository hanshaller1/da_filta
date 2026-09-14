const { test, expect } = require('playwright/test');

test('diagnostic nonlinear TPT state feedback converges, colors predictably, and leaves the audible path untouched', async ({ page }) => {
  test.setTimeout(180000);
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const report = await page.evaluate(async () => {
    const { LinearTptSvf } = await import('/tpt-svf.js');
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const dampingFloor = window.Filterbank.RESONATOR_DAMPING_FLOOR;
    const selected = [0, 4, 5, 7, 8, 9];
    const rates = [44100, 48000];
    const drives = [1, 2, 4, 8];
    const resonances = [0.25, 0.5, 0.75, 1];
    const moduleUrl = new URL('filterbank-processor.js', window.location.href).href;
    const neutral = () => Array(frequencies.length).fill(0);
    const gates = () => Array(frequencies.length).fill(false);
    const oneGate = index => Array.from({ length: frequencies.length }, (_, current) => current === index);
    const damping = resonance => 1 - (1 - dampingFloor) * resonance;

    const rms = (energy, count) => Math.sqrt(energy / Math.max(1, count));
    const magnitude = (real, imaginary, count) => 2 * Math.hypot(real, imaginary) / Math.max(1, count);

    const tone = ({ sampleRate, index, resonance, drive, peak = 0.05 }) => {
      const frequency = frequencies[index];
      const base = new LinearTptSvf(sampleRate, frequency, qs[index]);
      const linearResonator = new LinearTptSvf(sampleRate, frequency, qs[index]);
      linearResonator.setDampingScale(damping(resonance));
      const nonlinear = new LinearTptSvf(sampleRate, frequency, qs[index]);
      const duration = index < 2 ? 4 : 1.5;
      const frameCount = Math.round(sampleRate * duration);
      const analysisStart = frameCount - sampleRate;
      const harmonicReal = Array(8).fill(0);
      const harmonicImaginary = Array(8).fill(0);
      let linearEnergy = 0;
      let linearResonatorEnergy = 0;
      let nonlinearEnergy = 0;
      let residualEnergy = 0;
      let nonlinearPeak = 0;
      let residualPeak = 0;
      let statePeak = 0;
      let finite = true;
      let maxDifference = 0;
      let linearComparisonMaxDifference = 0;

      for (let frame = 0; frame < frameCount; frame += 1) {
        const input = peak * Math.sin((2 * Math.PI * frequency * frame) / sampleRate);
        const linear = base.process(input);
        const linearResonatorOutput = linearResonator.process(input);
        const nonlinearOutput = resonance > 0
          ? nonlinear.processPositiveStateFeedback(input, damping(resonance), drive)
          : nonlinear.process(input);
        const residual = nonlinearOutput - linear;
        const state = Math.max(Math.abs(nonlinear.ic1eq), Math.abs(nonlinear.ic2eq));
        nonlinearPeak = Math.max(nonlinearPeak, Math.abs(nonlinearOutput));
        residualPeak = Math.max(residualPeak, Math.abs(residual));
        statePeak = Math.max(statePeak, state);
        finite = finite
          && Number.isFinite(linear)
          && Number.isFinite(linearResonatorOutput)
          && Number.isFinite(nonlinearOutput)
          && Number.isFinite(state);
        maxDifference = Math.max(maxDifference, Math.abs(residual));
        linearComparisonMaxDifference = Math.max(
          linearComparisonMaxDifference,
          Math.abs(nonlinearOutput - linearResonatorOutput)
        );
        if (frame >= analysisStart) {
          linearEnergy += linear * linear;
          linearResonatorEnergy += linearResonatorOutput * linearResonatorOutput;
          nonlinearEnergy += nonlinearOutput * nonlinearOutput;
          residualEnergy += residual * residual;
          for (let harmonic = 1; harmonic <= 8; harmonic += 1) {
            const phase = (2 * Math.PI * harmonic * frequency * frame) / sampleRate;
            harmonicReal[harmonic - 1] += nonlinearOutput * Math.cos(phase);
            harmonicImaginary[harmonic - 1] += nonlinearOutput * Math.sin(phase);
          }
        }
      }

      const analysisFrames = frameCount - analysisStart;
      const harmonics = harmonicReal.map((real, index) => magnitude(real, harmonicImaginary[index], analysisFrames));
      const fundamental = Math.max(harmonics[0], Number.EPSILON);
      const harmonicEnergy = harmonics.slice(1).reduce((sum, value) => sum + value * value, 0);
      return {
        linearRms: rms(linearEnergy, analysisFrames),
        linearResonatorRms: rms(linearResonatorEnergy, analysisFrames),
        nonlinearRms: rms(nonlinearEnergy, analysisFrames),
        residualRms: rms(residualEnergy, analysisFrames),
        nonlinearPeak,
        residualPeak,
        statePeak,
        thd: Math.sqrt(harmonicEnergy) / fundamental,
        h2: harmonics[1],
        h3: harmonics[2],
        h4Plus: Math.sqrt(harmonics.slice(3).reduce((sum, value) => sum + value * value, 0)),
        finite,
        maxDifference,
        linearComparisonMaxDifference,
        solverCalls: nonlinear.nonlinearSolverCallCount,
        solverMeanIterations: nonlinear.nonlinearSolverIterationTotal / Math.max(1, nonlinear.nonlinearSolverCallCount),
        solverMaximumIterations: nonlinear.nonlinearSolverIterationMaximum,
        solverFallbacks: nonlinear.nonlinearFallbackCount,
        solverResets: nonlinear.nonlinearNonFiniteResetCount,
        lastConvergenceError: nonlinear.lastNonlinearConvergenceError
      };
    };

    const impulse = ({ sampleRate, index, drive }) => {
      const filter = new LinearTptSvf(sampleRate, frequencies[index], qs[index]);
      const frameCount = Math.round(sampleRate * (index < 2 ? 6 : 2));
      let peak = 0;
      let tailEnergy = 0;
      let lastAbove = 0;
      let statePeak = 0;
      let finite = true;
      const values = new Float64Array(frameCount);
      for (let frame = 0; frame < frameCount; frame += 1) {
        const output = filter.processPositiveStateFeedback(frame === 0 ? 0.05 : 0, damping(1), drive);
        values[frame] = output;
        peak = Math.max(peak, Math.abs(output));
        statePeak = Math.max(statePeak, Math.abs(filter.ic1eq), Math.abs(filter.ic2eq));
        finite = finite && Number.isFinite(output) && Number.isFinite(statePeak);
      }
      const threshold = peak * 1e-3;
      for (let frame = 0; frame < frameCount; frame += 1) {
        if (Math.abs(values[frame]) >= threshold) lastAbove = frame;
        if (frame >= frameCount * 0.75) tailEnergy += values[frame] * values[frame];
      }
      return {
        peak,
        statePeak,
        decaySeconds: lastAbove / sampleRate,
        tailRms: rms(tailEnergy, frameCount - Math.floor(frameCount * 0.75)),
        finite,
        fallbacks: filter.nonlinearFallbackCount,
        resets: filter.nonlinearNonFiniteResetCount
      };
    };

    const inputLevels = {};
    for (const sampleRate of rates) {
      inputLevels[sampleRate] = {};
      for (const peak of [0.01, 0.025, 0.05, 0.1, 0.25]) {
        inputLevels[sampleRate][peak] = tone({ sampleRate, index: 4, resonance: 1, drive: 4, peak });
      }
    }

    const measurements = {};
    const decays = {};
    for (const sampleRate of rates) {
      measurements[sampleRate] = {};
      decays[sampleRate] = {};
      for (const index of selected) {
        measurements[sampleRate][index] = {};
        for (const resonance of resonances) {
          measurements[sampleRate][index][resonance] = {};
          for (const drive of drives) {
            measurements[sampleRate][index][resonance][drive] = tone({ sampleRate, index, resonance, drive });
          }
        }
        decays[sampleRate][index] = impulse({ sampleRate, index, drive: 4 });
      }
    }

    const neutralParity = {};
    const smallSignal = {};
    for (const sampleRate of rates) {
      neutralParity[sampleRate] = selected.map(index => tone({ sampleRate, index, resonance: 0, drive: 8 }));
      smallSignal[sampleRate] = selected.map(index => tone({
        sampleRate, index, resonance: 1, drive: 8, peak: 1e-7
      }));
    }

    const benchmark = drive => {
      const filters = [];
      for (let channel = 0; channel < 2; channel += 1) {
        for (let index = 0; index < frequencies.length; index += 1) {
          filters.push(new LinearTptSvf(48000, frequencies[index], qs[index]));
        }
      }
      for (let frame = 0; frame < 4096; frame += 1) {
        const input = 0.05 * Math.sin((2 * Math.PI * 411 * frame) / 48000);
        for (const filter of filters) {
          if (drive === 0) filter.process(input);
          else filter.processPositiveStateFeedback(input, damping(1), drive);
        }
      }
      const started = globalThis.performance.now();
      for (let frame = 0; frame < 48000; frame += 1) {
        const input = 0.05 * Math.sin((2 * Math.PI * 411 * frame) / 48000);
        for (const filter of filters) {
          if (drive === 0) filter.process(input);
          else filter.processPositiveStateFeedback(input, damping(1), drive);
        }
      }
      return globalThis.performance.now() - started;
    };
    benchmark(4);
    const performance = { linearMs: benchmark(0), drive4Ms: benchmark(4), drive8Ms: benchmark(8) };

    const createInput = (context, frequency) => {
      const buffer = context.createBuffer(2, context.length, context.sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let frame = 0; frame < data.length; frame += 1) {
          data[frame] = 0.05 * Math.sin((2 * Math.PI * frequency * frame) / context.sampleRate + channel * 0.23);
        }
      }
      return buffer;
    };

    const renderProcessor = async ({ diagnostic, resonance, local = false, feedbackAll = false }) => {
      const sampleRate = 48000;
      const context = new OfflineAudioContext(2, sampleRate, sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const source = context.createBufferSource();
      source.buffer = createInput(context, frequencies[4]);
      const diagnostics = [];
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
          bandGainLeft: neutral(),
          bandGainRight: neutral(),
          feedbackBandLeft: local ? oneGate(4) : gates(),
          feedbackBandRight: gates(),
          feedbackAllLeft: feedbackAll,
          feedbackAllRight: false,
          resonance,
          maxBandGainDb: 12,
          smoothingTime: 0.015,
          feedbackGateSmoothingTime: 0.008,
          resonanceSmoothingTime: 0.015,
          feedbackAllNormalization: 1 / Math.sqrt(frequencies.length),
          maxFeedbackGain: 1.25,
          maxAuditionGain: 0.25,
          resonatorDampingFloor: dampingFloor,
          collectResonatorDiagnostics: diagnostic,
          enableNonlinearResonatorDiagnostics: diagnostic,
          nonlinearResonatorDrive: 4
        }
      });
      node.port.onmessage = event => {
        if (event.data?.type === 'resonator-diagnostics') diagnostics.push(event.data);
      };
      source.connect(node);
      node.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      await new Promise(resolve => setTimeout(resolve, 0));
      return {
        left: Array.from(output.getChannelData(0)),
        right: Array.from(output.getChannelData(1)),
        diagnostics: diagnostics[diagnostics.length - 1]
      };
    };
    const maximumDifference = (a, b) => a.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - b[index])), 0);
    const production = {};
    for (const scenario of [
      ['positiveLocal', 1, true, false],
      ['negativeLocal', -0.75, true, false],
      ['feedbackAll', 0.75, false, true]
    ]) {
      const [name, resonance, local, feedbackAll] = scenario;
      const reference = await renderProcessor({ diagnostic: false, resonance, local, feedbackAll });
      const diagnostic = await renderProcessor({ diagnostic: true, resonance, local, feedbackAll });
      production[name] = {
        leftDifference: maximumDifference(reference.left, diagnostic.left),
        rightDifference: maximumDifference(reference.right, diagnostic.right),
        diagnostics: diagnostic.diagnostics
      };
    }
    const gateOff = await renderProcessor({ diagnostic: true, resonance: 1, local: false });
    const resonanceZero = await renderProcessor({ diagnostic: true, resonance: 0, local: true });

    return { measurements, decays, inputLevels, neutralParity, smallSignal, performance, production, gateOff, resonanceZero };
  });

  for (const sampleRate of [44100, 48000]) {
    for (const index of [0, 4, 5, 7, 8, 9]) {
      for (const resonance of [0.25, 0.5, 0.75, 1]) {
        for (const drive of [1, 2, 4, 8]) {
          const measurement = report.measurements[sampleRate][index][resonance][drive];
          expect(measurement.finite).toBeTruthy();
          expect(measurement.solverFallbacks).toBe(0);
          expect(measurement.solverResets).toBe(0);
          expect(measurement.solverMaximumIterations).toBeLessThanOrEqual(4);
        }
      }
      const driveThd = [1, 2, 4, 8].map(drive => report.measurements[sampleRate][index][1][drive].thd);
      for (let driveIndex = 1; driveIndex < driveThd.length; driveIndex += 1) {
        expect(driveThd[driveIndex]).toBeGreaterThan(driveThd[driveIndex - 1]);
      }
      expect(report.decays[sampleRate][index].finite).toBeTruthy();
      expect(report.decays[sampleRate][index].fallbacks).toBe(0);
      expect(report.decays[sampleRate][index].resets).toBe(0);
    }
    for (const measurement of report.neutralParity[sampleRate]) {
      expect(measurement.maxDifference).toBeLessThanOrEqual(1e-14);
      expect(measurement.solverCalls).toBe(0);
    }
    for (const measurement of report.smallSignal[sampleRate]) {
      expect(measurement.linearComparisonMaxDifference).toBeLessThanOrEqual(1e-14);
    }
    const levels = [0.01, 0.025, 0.05, 0.1, 0.25].map(level => report.inputLevels[sampleRate][level].thd);
    for (let index = 1; index < levels.length; index += 1) expect(levels[index]).toBeGreaterThan(levels[index - 1]);
  }

  for (const drive of [1, 2, 4, 8]) {
    expect(report.measurements[44100][9][1][drive].thd).toBeGreaterThan(report.measurements[48000][9][1][drive].thd);
  }
  for (const name of ['positiveLocal', 'negativeLocal', 'feedbackAll']) {
    expect(report.production[name].leftDifference).toBeLessThanOrEqual(1e-6);
    expect(report.production[name].rightDifference).toBeLessThanOrEqual(1e-6);
  }
  expect(report.production.positiveLocal.diagnostics.left.nonlinearSolverCalls[4]).toBeGreaterThan(0);
  expect(report.production.positiveLocal.diagnostics.left.nonlinearFallbackCounts[4]).toBe(0);
  expect(report.gateOff.diagnostics.left.nonlinearSolverCalls.every(value => value === 0)).toBeTruthy();
  expect(report.resonanceZero.diagnostics.left.nonlinearSolverCalls.every(value => value === 0)).toBeTruthy();
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);

  const compact = sampleRate => [0, 4, 5, 7, 8, 9].map(index => {
    const value = report.measurements[sampleRate][index][1][4];
    return `${index + 1}:thd=${(value.thd * 100).toFixed(3)}%,state=${value.statePeak.toFixed(3)},res=${value.residualRms.toFixed(5)}`;
  }).join(', ');
  const solverSamples = [44100, 48000].flatMap(sampleRate => [0, 4, 5, 7, 8, 9].map(index => (
    report.measurements[sampleRate][index][1][4]
  )));
  const meanIterations = solverSamples.reduce((sum, value) => sum + value.solverMeanIterations, 0) / solverSamples.length;
  const maximumIterations = Math.max(...solverSamples.map(value => value.solverMaximumIterations));
  console.log(
    `TPT_NONLINEAR 44.1k ${compact(44100)} | 48k ${compact(48000)} | `
    + `411-level THD=${[0.01, 0.025, 0.05, 0.1, 0.25].map(level => (report.inputLevels[48000][level].thd * 100).toFixed(3)).join('/') }% | `
    + `solver d4 avg=${meanIterations.toFixed(3)},max=${maximumIterations},fallback=0 | `
    + `perf linear=${report.performance.linearMs.toFixed(2)}ms,d4=${report.performance.drive4Ms.toFixed(2)}ms,d8=${report.performance.drive8Ms.toFixed(2)}ms`
  );
});
