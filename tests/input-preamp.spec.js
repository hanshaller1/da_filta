const { test, expect } = require('playwright/test');

test('input stage keeps gain and character independent while preserving distinct stable curves', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const render = async ({ gainDb = 0, stage = 'linear', characterAmount = 1, processorGainDb = gainDb }) => {
      const sampleRate = 48000;
      const length = sampleRate;
      const context = new OfflineAudioContext(1, length, sampleRate);
      await context.audioWorklet.addModule(new URL('/input-preamp-processor.js', location.href));
      const input = context.createBuffer(1, length, sampleRate);
      const sourceData = input.getChannelData(0);
      for (let index = 0; index < length; index += 1) sourceData[index] = 0.72 * Math.sin((2 * Math.PI * 480 * index) / sampleRate);
      const source = context.createBufferSource(); source.buffer = input;
      const gain = context.createGain(); gain.gain.value = 10 ** (gainDb / 20);
      const preamp = new AudioWorkletNode(context, 'resonant-input-preamp-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { inputGainDb: processorGainDb, stage, characterAmount }
      });
      source.connect(gain).connect(preamp).connect(context.destination); source.start();
      const rendered = await context.startRendering();
      const output = rendered.getChannelData(0);
      let rms = 0; let dc = 0; let finite = true; let peak = 0;
      for (let index = sampleRate / 2; index < length; index += 1) {
        const sample = output[index]; rms += sample * sample; dc += sample; peak = Math.max(peak, Math.abs(sample)); finite &&= Number.isFinite(sample);
      }
      const start = sampleRate / 2; const frames = length - start;
      return { output: Array.from(output.slice(start)), rms: Math.sqrt(rms / frames), dc: dc / frames, peak, finite };
    };
    const maxDifference = (left, right) => left.output.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - right.output[index])), 0);
    const linear0 = await render({ characterAmount: 0 });
    const linear50 = await render({ characterAmount: 0.5 });
    const linear100 = await render({ characterAmount: 1 });
    const gain12 = await render({ gainDb: 12, characterAmount: 0 });
    const silk0 = await render({ stage: 'silk', characterAmount: 0 });
    const silk50 = await render({ stage: 'silk', characterAmount: 0.5 });
    const silk100 = await render({ stage: 'silk', characterAmount: 1 });
    const stages = {};
    for (const stage of ['silk', 'tape', 'tube', 'console', 'crunch', 'destroy']) stages[stage] = await render({ stage, characterAmount: 1 });
    const processorGain0 = await render({ gainDb: 12, stage: 'console', characterAmount: 1, processorGainDb: 0 });
    const processorGain24 = await render({ gainDb: 12, stage: 'console', characterAmount: 1, processorGainDb: 24 });
    const destroyHigh = await render({ gainDb: 24, stage: 'destroy', characterAmount: 1 });
    const lowCharacterHighGain = await render({ gainDb: 24, stage: 'crunch', characterAmount: 0.1 });
    return {
      linearDifferences: [maxDifference(linear0, linear50), maxDifference(linear0, linear100)],
      gainRatio: gain12.rms / linear0.rms,
      silkZeroDifference: maxDifference(linear0, silk0),
      silkMidpointError: silk50.output.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - (linear0.output[index] + 0.5 * (silk100.output[index] - linear0.output[index])))), 0),
      pairDifferences: Object.values(stages).map((stage, index, values) => values.slice(index + 1).map(other => maxDifference(stage, other))),
      tubeDc: stages.tube.dc,
      processorGainDifference: maxDifference(processorGain0, processorGain24),
      destroyHigh, lowCharacterHighGain
    };
  });

  expect(report.linearDifferences).toEqual([0, 0]);
  expect(report.gainRatio).toBeCloseTo(10 ** (12 / 20), 5);
  expect(report.silkZeroDifference).toBe(0);
  expect(report.silkMidpointError).toBeLessThan(1e-7);
  expect(report.pairDifferences.flat()).toEqual(expect.arrayContaining([expect.any(Number)]));
  for (const difference of report.pairDifferences.flat()) expect(difference).toBeGreaterThan(1e-4);
  expect(Math.abs(report.tubeDc)).toBeLessThan(2e-3);
  expect(report.processorGainDifference).toBeLessThan(1e-7);
  expect(report.destroyHigh.finite).toBe(true);
  expect(report.lowCharacterHighGain.finite).toBe(true);
  expect(errors).toEqual([]);
});
