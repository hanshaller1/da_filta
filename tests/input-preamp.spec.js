const { test, expect } = require('playwright/test');

test('DEV input preamp is transparent at 0 dB, continuous, stereo-safe, and nonlinear above its clean range', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const render = async (gainDb, stage) => {
      const sampleRate = 48000;
      const length = sampleRate;
      const context = new OfflineAudioContext(2, length, sampleRate);
      await context.audioWorklet.addModule(new URL('/input-preamp-processor.js', location.href));
      const input = context.createBuffer(2, length, sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const samples = input.getChannelData(channel);
        const amplitude = channel === 0 ? 0.22 : 0.11;
        for (let index = 0; index < length; index += 1) samples[index] = amplitude * Math.sin((2 * Math.PI * 480 * index) / sampleRate);
      }
      const source = context.createBufferSource();
      source.buffer = input;
      const gain = context.createGain();
      gain.gain.value = 10 ** (gainDb / 20);
      const preamp = new AudioWorkletNode(context, 'resonant-input-preamp-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
        channelCountMode: 'explicit', channelInterpretation: 'discrete',
        processorOptions: { inputGainDb: gainDb, stage }
      });
      source.connect(gain).connect(preamp).connect(context.destination);
      source.start();
      const rendered = await context.startRendering();
      const output = rendered.getChannelData(0);
      const right = rendered.getChannelData(1);
      let peak = 0; let energy = 0; let dc = 0; let rightEnergy = 0; let finite = true;
      for (let index = sampleRate / 2; index < length; index += 1) {
        const sample = output[index]; const rightSample = right[index];
        peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; dc += sample;
        rightEnergy += rightSample * rightSample; finite = finite && Number.isFinite(sample) && Number.isFinite(rightSample);
      }
      const frames = length - sampleRate / 2;
      return { rms: Math.sqrt(energy / frames), peak, dc: dc / frames, rightRms: Math.sqrt(rightEnergy / frames), finite };
    };
    const linear0 = await render(0, 'linear');
    const linear12 = await render(12, 'linear');
    const preamp0 = await render(0, 'preamp');
    const stages = {};
    for (const gainDb of [6, 12, 18, 24]) stages[gainDb] = await render(gainDb, 'preamp');
    return { linear0, linear12, preamp0, stages };
  });
  expect(report.linear0.finite && report.preamp0.finite).toBe(true);
  expect(Math.abs(report.preamp0.rms - report.linear0.rms)).toBeLessThan(1e-7);
  expect(Math.abs(report.linear12.rms / report.linear0.rms - (10 ** (12 / 20)))).toBeLessThan(1e-4);
  expect(report.stages[6].rms).toBeGreaterThan(report.preamp0.rms);
  expect(report.stages[24].rms).toBeGreaterThan(report.stages[6].rms);
  expect(Math.abs(report.stages[12].rms - report.linear12.rms)).toBeGreaterThan(1e-3);
  expect(report.stages[24].peak).toBeLessThan(1.51);
  for (const stage of Object.values(report.stages)) {
    expect(stage.finite).toBe(true);
    expect(Math.abs(stage.dc)).toBeLessThan(1e-5);
    expect(stage.rightRms).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});
