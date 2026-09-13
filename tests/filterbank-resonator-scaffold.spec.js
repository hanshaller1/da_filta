const { test, expect } = require('playwright/test');

test('the silent linear resonator scaffold stays state-separated and residual-free', async ({ page }) => {
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
    const moduleUrl = new URL('filterbank-processor.js', window.location.href).href;
    const neutral = () => Array(bandCount).fill(0);
    const noFeedback = () => Array(bandCount).fill(false);
    const oneFeedback = index => Array.from({ length: bandCount }, (_, currentIndex) => currentIndex === index);

    const createInput = (context, { signal, frequency, leftOnly = false }) => {
      const buffer = context.createBuffer(2, context.length, context.sampleRate);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      let noiseState = 0x12345678;
      for (let frame = 0; frame < buffer.length; frame += 1) {
        let leftValue = 0;
        let rightValue = 0;
        if (signal === 'noise') {
          noiseState = (1664525 * noiseState + 1013904223) >>> 0;
          leftValue = ((noiseState / 0xffffffff) * 2 - 1) * 0.1;
          noiseState = (1664525 * noiseState + 1013904223) >>> 0;
          rightValue = ((noiseState / 0xffffffff) * 2 - 1) * 0.08;
        } else {
          const phase = (2 * Math.PI * frequency * frame) / context.sampleRate;
          leftValue = 0.04 * Math.sin(phase) + (frame === 0 ? 0.08 : 0);
          rightValue = 0.035 * Math.sin(phase + 0.31) + (frame === 0 ? -0.06 : 0);
        }
        left[frame] = leftValue;
        right[frame] = leftOnly ? 0 : rightValue;
      }
      return buffer;
    };

    const render = async ({
      sampleRate,
      frequency,
      signal = 'impulse-sine',
      duration = 0.6,
      leftOnly = false,
      feedbackBandLeft = noFeedback(),
      resonance = 0
    }) => {
      const context = new OfflineAudioContext(2, Math.round(sampleRate * duration), sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const source = context.createBufferSource();
      source.buffer = createInput(context, { signal, frequency, leftOnly });
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
          feedbackBandRight: noFeedback(),
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

      let maximumOutputError = 0;
      let finite = true;
      for (let channel = 0; channel < 2; channel += 1) {
        const input = source.buffer.getChannelData(channel);
        const rendered = output.getChannelData(channel);
        for (let frame = 0; frame < rendered.length; frame += 1) {
          maximumOutputError = Math.max(maximumOutputError, Math.abs(rendered[frame] - input[frame]));
          finite = finite && Number.isFinite(rendered[frame]);
        }
      }

      const lastDiagnostics = diagnostics[diagnostics.length - 1];
      return { maximumOutputError, finite, diagnostics: lastDiagnostics, diagnosticCount: diagnostics.length };
    };

    const linear = {};
    for (const sampleRate of [44100, 48000]) {
      linear[sampleRate] = [];
      for (let index = 0; index < bandCount; index += 1) {
        linear[sampleRate].push(await render({
          sampleRate,
          frequency: frequencies[index],
          duration: index < 2 ? 2.5 : 0.6
        }));
      }
    }

    const noise = {};
    for (const sampleRate of [44100, 48000]) {
      noise[sampleRate] = {};
      for (const index of [0, 1, 8, 9]) {
        noise[sampleRate][index] = await render({
          sampleRate,
          frequency: frequencies[index],
          signal: 'noise',
          duration: index < 2 ? 2 : 0.75
        });
      }
    }

    const leftOnly = await render({ sampleRate: 48000, frequency: 777, leftOnly: true });
    const feedbackResidual = await render({
      sampleRate: 48000,
      frequency: 411,
      feedbackBandLeft: oneFeedback(4),
      resonance: 0.75
    });

    const resetProbe = new LinearTptSvf(48000, frequencies[4], qs[4]);
    resetProbe.process(0.5);
    resetProbe.process(-0.25);
    resetProbe.reset();
    const resetState = [
      resetProbe.ic1eq,
      resetProbe.ic2eq,
      resetProbe.low,
      resetProbe.band,
      resetProbe.high,
      resetProbe.unitBand,
      resetProbe.notch,
      resetProbe.peak
    ];

    const benchmark = filterCount => {
      const filters = new Array(filterCount);
      for (let index = 0; index < filterCount; index += 1) {
        const band = index % bandCount;
        filters[index] = new LinearTptSvf(48000, frequencies[band], qs[band]);
      }
      for (let frame = 0; frame < 16384; frame += 1) {
        const input = 0.05 * Math.sin((2 * Math.PI * 411 * frame) / 48000);
        for (let index = 0; index < filterCount; index += 1) filters[index].process(input);
      }
      const start = performance.now();
      for (let frame = 0; frame < 240000; frame += 1) {
        const input = 0.05 * Math.sin((2 * Math.PI * 411 * frame) / 48000);
        for (let index = 0; index < filterCount; index += 1) filters[index].process(input);
      }
      return performance.now() - start;
    };
    const baseMs = benchmark(20);
    const dualMs = benchmark(40);

    return {
      linear,
      noise,
      leftOnly,
      feedbackResidual,
      resetPass: resetState.every(value => value === 0),
      baseMs,
      dualMs,
      performanceRatio: dualMs / Math.max(baseMs, Number.EPSILON)
    };
  });

  const allLinear = Object.values(result.linear).flat();
  const allNoise = Object.values(result.noise).flatMap(values => Object.values(values));
  for (const measurement of [...allLinear, ...allNoise]) {
    expect(measurement.finite).toBeTruthy();
    expect(measurement.diagnosticCount).toBeGreaterThan(0);
    expect(measurement.diagnostics.left.finite).toBeTruthy();
    expect(measurement.diagnostics.right.finite).toBeTruthy();
    expect(measurement.diagnostics.left.maximumResidual).toBe(0);
    expect(measurement.diagnostics.right.maximumResidual).toBe(0);
    expect(measurement.maximumOutputError).toBeLessThanOrEqual(1e-6);
  }
  expect(result.leftOnly.diagnostics.left.maximumResidual).toBe(0);
  expect(result.leftOnly.diagnostics.right.maximumResidual).toBe(0);
  expect(result.leftOnly.maximumOutputError).toBeLessThanOrEqual(1e-6);
  expect(result.feedbackResidual.diagnostics.left.maximumResidual).toBeGreaterThan(1e-8);
  expect(result.feedbackResidual.diagnostics.right.maximumResidual).toBe(0);
  expect(result.resetPass).toBeTruthy();
  expect(result.baseMs).toBeGreaterThan(0);
  expect(result.dualMs).toBeGreaterThan(0);
  expect(result.performanceRatio).toBeLessThan(4);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);

  console.log(`RESONATOR_SCAFFOLD residual=0, 20TPT=${result.baseMs.toFixed(3)}ms, 40TPT=${result.dualMs.toFixed(3)}ms, ratio=${result.performanceRatio.toFixed(3)}`);
});
