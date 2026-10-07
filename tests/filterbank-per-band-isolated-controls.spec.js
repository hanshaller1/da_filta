const { test, expect } = require('playwright/test');

// DEV/LAB: Per-Band ZDF selected together with ISOLATED TPT runs no ZDF solver.
// Runtime fader and gate changes must still be smoothed and become audible.
test('Per-Band ZDF with ISOLATED TPT applies runtime fader changes like the CURRENT isolated path', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const render = async ({ core, cut }) => {
      const sampleRate = 48000;
      const length = Math.round(sampleRate * 0.5);
      const context = new OfflineAudioContext(1, length, sampleRate);
      await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
      const input = context.createBuffer(1, length, sampleRate);
      const samples = input.getChannelData(0);
      for (let index = 0; index < length; index += 1) samples[index] = 0.1 * Math.sin(2 * Math.PI * frequencies[4] * index / sampleRate);
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: {
          bandFrequencies: frequencies, bandQs: qs,
          bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
          feedbackBandLeft: Array(10).fill(false), feedbackBandRight: Array(10).fill(false),
          resonance: 0, feedbackTopology: 'isolated-tpt', feedbackCore: core, wetModel: 'filterbank-sum'
        }
      });
      const source = context.createBufferSource(); source.buffer = input;
      source.connect(node).connect(context.destination); source.start();
      if (cut) {
        context.suspend(0.05).then(() => {
          node.port.postMessage({ type: 'set-band-base-gain', channel: 'left', index: 4, value: -100 });
          context.resume();
        });
      }
      const output = (await context.startRendering()).getChannelData(0);
      let energy = 0;
      const start = Math.round(sampleRate * 0.3);
      for (let index = start; index < length; index += 1) energy += output[index] * output[index];
      return { output, rms: Math.sqrt(energy / (length - start)) };
    };
    const perBandNeutral = await render({ core: 'zdf-per-band', cut: false });
    const perBandCut = await render({ core: 'zdf-per-band', cut: true });
    const currentCut = await render({ core: 'current', cut: true });
    let maxDifference = 0;
    for (let index = 0; index < perBandCut.output.length; index += 1) {
      maxDifference = Math.max(maxDifference, Math.abs(perBandCut.output[index] - currentCut.output[index]));
    }
    return { neutralRms: perBandNeutral.rms, cutRms: perBandCut.rms, currentCutRms: currentCut.rms, maxDifference };
  });

  // A -12 dB fader cut on the excited band must clearly lower the output.
  expect(report.cutRms).toBeLessThan(report.neutralRms * 0.6);
  // Without feedback, both isolated paths are the same linear bank.
  expect(report.maxDifference).toBeLessThan(1e-6);
  expect(errors).toEqual([]);
});
