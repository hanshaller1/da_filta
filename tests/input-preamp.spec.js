const { test, expect } = require('playwright/test');

test('fixed input-drive characters remain finite, continuous, and independent of processor gain messages', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const render = async ({ gainDb, stage, processorGainDb = gainDb }) => {
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
        processorOptions: { inputGainDb: processorGainDb, stage }
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
    const linear0 = await render({ gainDb: 0, stage: 'linear' });
    const linear12 = await render({ gainDb: 12, stage: 'linear' });
    const oldPreamp = await render({ gainDb: 12, stage: 'preamp' });
    const invalid = await render({ gainDb: 12, stage: 'invalid-value' });
    const characters = {};
    for (const stage of ['clean', 'warm', 'crunch', 'aggressive']) {
      characters[stage] = {
        low: await render({ gainDb: 6, stage }),
        high: await render({ gainDb: 24, stage }),
        processorGain0: await render({ gainDb: 12, stage, processorGainDb: 0 }),
        processorGain24: await render({ gainDb: 12, stage, processorGainDb: 24 })
      };
    }
    return { linear0, linear12, oldPreamp, invalid, characters };
  });

  expect(report.linear0.finite).toBe(true);
  expect(Math.abs(report.linear12.rms / report.linear0.rms - (10 ** (12 / 20)))).toBeLessThan(1e-4);
  expect(Math.abs(report.oldPreamp.rms - report.linear12.rms)).toBeLessThan(1e-7);
  expect(Math.abs(report.invalid.rms - report.linear12.rms)).toBeLessThan(1e-7);
  for (const character of Object.values(report.characters)) {
    expect(character.low.finite && character.high.finite).toBe(true);
    expect(character.high.rms).toBeGreaterThan(character.low.rms);
    expect(Math.abs(character.low.dc)).toBeLessThan(1e-5);
    expect(character.low.rightRms).toBeGreaterThan(0);
    expect(Math.abs(character.processorGain0.rms - character.processorGain24.rms)).toBeLessThan(1e-7);
  }
  expect(errors).toEqual([]);
});
