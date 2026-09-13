const { test, expect } = require('playwright/test');

test('the hidden positive local TPT resonator is linear when inactive and resonant when locally enabled', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const { LinearTptSvf } = await import('/tpt-svf.js');
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const bandCount = frequencies.length;
    const dampingFloor = window.Filterbank.RESONATOR_DAMPING_FLOOR;
    const magnitudes = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
    const sampleRates = [44100, 48000];
    const moduleUrl = new URL('filterbank-processor.js', window.location.href).href;
    const neutral = () => Array(bandCount).fill(0);
    const gates = () => Array(bandCount).fill(false);
    const selectedIndices = [0, 1, 4, 5, 7, 8, 9];
    const allIndices = Array.from({ length: bandCount }, (_, index) => index);

    const dampingScale = magnitude => 1 - (1 - dampingFloor) * Math.min(1, Math.max(0, magnitude));
    const oneGate = index => Array.from({ length: bandCount }, (_, currentIndex) => currentIndex === index);
    const twoGates = (first, second) => Array.from({ length: bandCount }, (_, currentIndex) => (
      currentIndex === first || currentIndex === second
    ));

    const createToneMetrics = ({ sampleRate, index, magnitude, gateEnabled = true }) => {
      const base = new LinearTptSvf(sampleRate, frequencies[index], qs[index]);
      const resonator = new LinearTptSvf(sampleRate, frequencies[index], qs[index]);
      resonator.setDampingScale(dampingScale(gateEnabled ? magnitude : 0));
      const duration = index < 2 ? 2.5 : 0.8;
      const frameCount = Math.round(sampleRate * duration);
      const analysisStart = Math.floor(frameCount * 0.6);
      let baseEnergy = 0;
      let resonatorEnergy = 0;
      let residualEnergy = 0;
      let residualPeak = 0;
      let resonatorPeak = 0;
      let maximumState = 0;
      let finite = true;

      for (let frame = 0; frame < frameCount; frame += 1) {
        const input = 0.01 * Math.sin((2 * Math.PI * frequencies[index] * frame) / sampleRate);
        const baseOutput = base.process(input);
        const resonatorOutput = resonator.process(input);
        const residual = resonatorOutput - baseOutput;
        if (frame >= analysisStart) {
          baseEnergy += baseOutput * baseOutput;
          resonatorEnergy += resonatorOutput * resonatorOutput;
          residualEnergy += residual * residual;
        }
        residualPeak = Math.max(residualPeak, Math.abs(residual));
        resonatorPeak = Math.max(resonatorPeak, Math.abs(resonatorOutput));
        maximumState = Math.max(maximumState, Math.abs(resonator.ic1eq), Math.abs(resonator.ic2eq));
        finite = finite
          && Number.isFinite(baseOutput)
          && Number.isFinite(resonatorOutput)
          && Number.isFinite(residual)
          && Number.isFinite(maximumState);
      }

      const analysisFrames = frameCount - analysisStart;
      return {
        baseRms: Math.sqrt(baseEnergy / analysisFrames),
        resonatorRms: Math.sqrt(resonatorEnergy / analysisFrames),
        residualRms: Math.sqrt(residualEnergy / analysisFrames),
        residualPeak,
        resonatorPeak,
        maximumState,
        finite
      };
    };

    const createImpulseMetrics = ({ sampleRate, index, magnitude }) => {
      const base = new LinearTptSvf(sampleRate, frequencies[index], qs[index]);
      const resonator = new LinearTptSvf(sampleRate, frequencies[index], qs[index]);
      resonator.setDampingScale(dampingScale(magnitude));
      const duration = index < 2 ? 3 : 1;
      const frameCount = Math.round(sampleRate * duration);
      const output = new Float64Array(frameCount);
      let peak = 0;
      let maximumState = 0;
      let finite = true;

      for (let frame = 0; frame < frameCount; frame += 1) {
        const input = frame === 0 ? 0.05 : 0;
        base.process(input);
        const resonatorOutput = resonator.process(input);
        output[frame] = resonatorOutput;
        peak = Math.max(peak, Math.abs(resonatorOutput));
        maximumState = Math.max(maximumState, Math.abs(resonator.ic1eq), Math.abs(resonator.ic2eq));
        finite = finite && Number.isFinite(resonatorOutput) && Number.isFinite(maximumState);
      }

      const threshold = peak * 1e-3;
      let lastAboveThreshold = -1;
      let energy = 0;
      for (let frame = 0; frame < frameCount; frame += 1) {
        const sample = output[frame];
        energy += sample * sample;
        if (Math.abs(sample) >= threshold) lastAboveThreshold = frame;
      }

      return {
        peak,
        rms: Math.sqrt(energy / frameCount),
        decaySeconds: Math.max(0, lastAboveThreshold) / sampleRate,
        maximumState,
        finite
      };
    };

    const createLegacyLoopToneMetrics = ({ sampleRate, index, magnitude }) => {
      const filter = new LinearTptSvf(sampleRate, frequencies[index], qs[index]);
      const duration = index < 2 ? 2.5 : 0.8;
      const frameCount = Math.round(sampleRate * duration);
      const analysisStart = Math.floor(frameCount * 0.6);
      const feedbackGain = 1.25 * magnitude * magnitude;
      let feedbackReturn = 0;
      let energy = 0;
      let peak = 0;
      let maximumState = 0;
      let finite = true;

      for (let frame = 0; frame < frameCount; frame += 1) {
        const source = 0.01 * Math.sin((2 * Math.PI * frequencies[index] * frame) / sampleRate);
        const bandOutput = filter.process(source + feedbackReturn);
        feedbackReturn = Number.isFinite(bandOutput) ? Math.tanh(feedbackGain * bandOutput) : 0;
        if (frame >= analysisStart) energy += bandOutput * bandOutput;
        peak = Math.max(peak, Math.abs(bandOutput));
        maximumState = Math.max(maximumState, Math.abs(filter.ic1eq), Math.abs(filter.ic2eq));
        finite = finite
          && Number.isFinite(bandOutput)
          && Number.isFinite(feedbackReturn)
          && Number.isFinite(maximumState);
      }

      return {
        rms: Math.sqrt(energy / (frameCount - analysisStart)),
        peak,
        maximumState,
        finite
      };
    };

    const createInput = (context, frequency, leftOnly = false) => {
      const buffer = context.createBuffer(2, context.length, context.sampleRate);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      for (let frame = 0; frame < buffer.length; frame += 1) {
        left[frame] = 0.01 * Math.sin((2 * Math.PI * frequency * frame) / context.sampleRate);
        right[frame] = leftOnly ? 0 : 0.008 * Math.sin((2 * Math.PI * frequency * frame) / context.sampleRate + 0.41);
      }
      return buffer;
    };

    const renderWorklet = async ({
      sampleRate,
      index,
      resonance,
      feedbackBandLeft = gates(),
      feedbackBandRight = gates(),
      feedbackAllLeft = false,
      leftOnly = false
    }) => {
      const duration = index < 2 ? 1.5 : 0.65;
      const context = new OfflineAudioContext(2, Math.round(sampleRate * duration), sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const source = context.createBufferSource();
      source.buffer = createInput(context, frequencies[index], leftOnly);
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
          feedbackBandLeft,
          feedbackBandRight,
          feedbackAllLeft,
          feedbackAllRight: false,
          resonance,
          maxBandGainDb: 12,
          smoothingTime: 0.015,
          feedbackGateSmoothingTime: 0.008,
          resonanceSmoothingTime: 0.015,
          feedbackAllNormalization: 1 / Math.sqrt(bandCount),
          maxFeedbackGain: 1.25,
          maxAuditionGain: 0.25,
          resonatorDampingFloor: dampingFloor,
          collectResonatorDiagnostics: true
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
      node.port.postMessage({ type: 'dispose' });
      node.disconnect();

      let finiteOutput = true;
      for (let channel = 0; channel < 2; channel += 1) {
        const data = output.getChannelData(channel);
        for (let frame = 0; frame < data.length; frame += 1) finiteOutput = finiteOutput && Number.isFinite(data[frame]);
      }
      return {
        diagnostics: diagnostics[diagnostics.length - 1],
        diagnosticCount: diagnostics.length,
        finiteOutput,
        frameCount: context.length
      };
    };

    const linear = {};
    const impulses = {};
    const legacyLoop = {};
    for (const sampleRate of sampleRates) {
      linear[sampleRate] = {};
      impulses[sampleRate] = {};
      legacyLoop[sampleRate] = {};
      for (const index of allIndices) {
        linear[sampleRate][index] = magnitudes.map(magnitude => createToneMetrics({ sampleRate, index, magnitude }));
      }
      for (const index of selectedIndices) {
        impulses[sampleRate][index] = [0, 0.25, 0.5, 0.75, 1].map(magnitude => (
          createImpulseMetrics({ sampleRate, index, magnitude })
        ));
        legacyLoop[sampleRate][index] = [0, 0.25, 0.5, 0.75, 1].map(magnitude => (
          createLegacyLoopToneMetrics({ sampleRate, index, magnitude })
        ));
      }
    }

    const gateOff = {};
    for (const sampleRate of sampleRates) {
      gateOff[sampleRate] = selectedIndices.map(index => createToneMetrics({
        sampleRate,
        index,
        magnitude: 1,
        gateEnabled: false
      }));
    }

    const actual = { inactive: {}, active: {}, feedbackAllIgnored: null, leftOnly: null, multiple: null };
    for (const sampleRate of sampleRates) {
      actual.inactive[sampleRate] = await renderWorklet({
        sampleRate,
        index: 4,
        resonance: 1
      });
      actual.active[sampleRate] = [];
      for (const resonance of [0, 0.25, 0.5, 0.75, 1]) {
        actual.active[sampleRate].push(await renderWorklet({
          sampleRate,
          index: 4,
          resonance,
          feedbackBandLeft: oneGate(4)
        }));
      }
    }
    actual.feedbackAllIgnored = {
      off: await renderWorklet({
        sampleRate: 48000,
        index: 4,
        resonance: 0.75,
        feedbackBandLeft: oneGate(4)
      }),
      on: await renderWorklet({
        sampleRate: 48000,
        index: 4,
        resonance: 0.75,
        feedbackBandLeft: oneGate(4),
        feedbackAllLeft: true
      })
    };
    actual.leftOnly = await renderWorklet({
      sampleRate: 48000,
      index: 5,
      resonance: 1,
      feedbackBandLeft: oneGate(5),
      leftOnly: true
    });
    actual.multiple = await renderWorklet({
      sampleRate: 48000,
      index: 4,
      resonance: 0.75,
      feedbackBandLeft: twoGates(4, 5)
    });

    const summary = {};
    for (const index of selectedIndices) {
      summary[index] = {};
      for (const sampleRate of sampleRates) {
        const tone = linear[sampleRate][index];
        const impulse = impulses[sampleRate][index];
        summary[index][sampleRate] = {
          resonantGainAtOne: tone[tone.length - 1].resonatorRms / tone[0].baseRms,
          legacyGainAtOne: legacyLoop[sampleRate][index][4].rms / tone[0].baseRms,
          residualPeakAtOne: tone[tone.length - 1].residualPeak,
          decayAtZero: impulse[0].decaySeconds,
          decayAtOne: impulse[impulse.length - 1].decaySeconds,
          maximumStateAtOne: tone[tone.length - 1].maximumState
        };
      }
    }

    return { dampingFloor, magnitudes, linear, impulses, legacyLoop, gateOff, actual, summary };
  });

  expect(result.dampingFloor).toBeGreaterThan(0);
  expect(result.dampingFloor).toBeLessThanOrEqual(1);
  for (const sampleRate of [44100, 48000]) {
    for (const measurements of Object.values(result.linear[sampleRate])) {
      let previousRms = 0;
      for (const measurement of measurements) {
        expect(measurement.finite).toBeTruthy();
        expect(measurement.resonatorRms).toBeGreaterThanOrEqual(previousRms * (1 - 1e-10));
        previousRms = measurement.resonatorRms;
      }
      expect(measurements[0].residualPeak).toBe(0);
      expect(measurements[0].residualRms).toBe(0);
      expect(measurements[measurements.length - 1].resonatorRms / measurements[0].baseRms).toBeCloseTo(10, 3);
    }
    for (const measurement of result.gateOff[sampleRate]) {
      expect(measurement.finite).toBeTruthy();
      expect(measurement.residualPeak).toBe(0);
      expect(measurement.residualRms).toBe(0);
    }
    for (const measurements of Object.values(result.impulses[sampleRate])) {
      let previousDecay = 0;
      for (const measurement of measurements) {
        expect(measurement.finite).toBeTruthy();
        expect(measurement.maximumState).toBeGreaterThanOrEqual(0);
        expect(measurement.decaySeconds).toBeGreaterThanOrEqual(previousDecay - (1 / sampleRate));
        previousDecay = measurement.decaySeconds;
      }
    }
    for (const measurements of Object.values(result.legacyLoop[sampleRate])) {
      for (const measurement of measurements) expect(measurement.finite).toBeTruthy();
    }

    const inactive = result.actual.inactive[sampleRate];
    expect(inactive.finiteOutput).toBeTruthy();
    expect(inactive.diagnosticCount).toBeGreaterThan(0);
    expect(inactive.diagnostics.left.finite).toBeTruthy();
    expect(inactive.diagnostics.right.finite).toBeTruthy();
    expect(inactive.diagnostics.left.maximumResidual).toBe(0);
    expect(inactive.diagnostics.right.maximumResidual).toBe(0);

    let previousPeak = 0;
    for (const measurement of result.actual.active[sampleRate]) {
      const diagnostics = measurement.diagnostics.left;
      expect(measurement.finiteOutput).toBeTruthy();
      expect(diagnostics.finite).toBeTruthy();
      expect(diagnostics.maximumState).toBeGreaterThanOrEqual(0);
      expect(diagnostics.bandPeak[4]).toBeGreaterThanOrEqual(previousPeak * (1 - 1e-10));
      previousPeak = diagnostics.bandPeak[4];
    }
  }

  const feedbackAllOffPeak = result.actual.feedbackAllIgnored.off.diagnostics.left.bandPeak[4];
  const feedbackAllOnPeak = result.actual.feedbackAllIgnored.on.diagnostics.left.bandPeak[4];
  expect(feedbackAllOnPeak).toBeCloseTo(feedbackAllOffPeak, 12);
  expect(result.actual.leftOnly.diagnostics.left.finite).toBeTruthy();
  expect(result.actual.leftOnly.diagnostics.right.finite).toBeTruthy();
  expect(result.actual.leftOnly.diagnostics.right.bandEnergy.every(value => value === 0)).toBeTruthy();
  expect(result.actual.multiple.diagnostics.left.finite).toBeTruthy();
  expect(result.actual.multiple.diagnostics.left.bandPeak[4]).toBeGreaterThan(0);
  expect(result.actual.multiple.diagnostics.left.bandPeak[5]).toBeGreaterThan(0);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);

  const report = [44100, 48000].map(sampleRate => {
    const measurements = [0, 1, 4, 5, 7, 8, 9].map(index => {
      const measurement = result.summary[index][sampleRate];
      return `${index + 1}:new=${measurement.resonantGainAtOne.toFixed(3)}x,old=${measurement.legacyGainAtOne.toFixed(3)}x/${measurement.decayAtZero.toFixed(3)}s→${measurement.decayAtOne.toFixed(3)}s/state=${measurement.maximumStateAtOne.toFixed(3)}`;
    }).join(', ');
    return `${sampleRate / 1000}k ${measurements}`;
  }).join(' | ');
  console.log(`TPT_POSITIVE_RESONANCE floor=${result.dampingFloor}, ${report}`);
});
