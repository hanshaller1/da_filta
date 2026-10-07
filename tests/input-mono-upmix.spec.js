const { test, expect } = require('playwright/test');

// The Input Character Worklet is the stereo entry of the production graph.
// A mono interface or mono sample must reach both channels; stereo stays as is.
test('production preamp node up-mixes mono input to both channels and keeps stereo channels independent', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const render = async (channels, options) => {
      const sampleRate = 48000;
      const length = 4800;
      const context = new OfflineAudioContext(2, length, sampleRate);
      await context.audioWorklet.addModule(new URL('/input-preamp-processor.js', location.href));
      const buffer = context.createBuffer(channels, length, sampleRate);
      for (let channel = 0; channel < channels; channel += 1) {
        const data = buffer.getChannelData(channel);
        const frequency = channel === 0 ? 440 : 1100;
        for (let index = 0; index < length; index += 1) data[index] = 0.25 * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
      }
      const source = context.createBufferSource(); source.buffer = buffer;
      // Same head as AudioEngine: sourceBus -> Input Gain -> Preamp.
      const sourceBus = context.createGain(); const inputGain = context.createGain();
      const preamp = new AudioWorkletNode(context, 'resonant-input-preamp-processor', options);
      source.connect(sourceBus); sourceBus.connect(inputGain); inputGain.connect(preamp); preamp.connect(context.destination);
      source.start();
      const rendered = await context.startRendering();
      const left = rendered.getChannelData(0); const right = rendered.getChannelData(1);
      let leftPeak = 0; let rightPeak = 0; let difference = 0;
      // Skip the fixed 192-sample Character delay and startup.
      for (let index = 1024; index < length; index += 1) {
        leftPeak = Math.max(leftPeak, Math.abs(left[index]));
        rightPeak = Math.max(rightPeak, Math.abs(right[index]));
        difference = Math.max(difference, Math.abs(left[index] - right[index]));
      }
      return { leftPeak, rightPeak, difference };
    };
    const processorOptions = { inputGainDb: 0, stage: 'linear', characterAmount: 0.5 };
    const production = window.AudioEngine.inputPreampNodeOptions(processorOptions);
    return {
      interpretation: production.channelInterpretation,
      mono: await render(1, production),
      stereo: await render(2, production),
      legacyDiscreteMono: await render(1, { ...production, channelInterpretation: 'discrete' })
    };
  });

  expect(report.interpretation).toBe('speakers');
  expect(report.mono.leftPeak).toBeGreaterThan(0.2);
  expect(report.mono.rightPeak).toBeGreaterThan(0.2);
  expect(report.mono.difference).toBeLessThan(1e-6);
  // Stereo L/R content stays independent (different test tones per channel).
  expect(report.stereo.leftPeak).toBeGreaterThan(0.2);
  expect(report.stereo.rightPeak).toBeGreaterThan(0.2);
  expect(report.stereo.difference).toBeGreaterThan(0.1);
  // Documents the previous defect: DISCRETE leaves the mono right channel silent.
  expect(report.legacyDiscreteMono.rightPeak).toBe(0);
  expect(errors).toEqual([]);
});
