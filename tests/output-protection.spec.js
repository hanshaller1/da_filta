const { test, expect } = require('playwright/test');

test('final soft protection is transparent below knee and bounded above it', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const results = await page.evaluate(async () => {
    const values = [-20, -1, -.8, -.5, 0, .5, .8, 1, 20];
    const output = [];
    for (const sampleRate of [44100, 48000, 96000]) {
      const context = new OfflineAudioContext(2, 128, sampleRate);
      await context.audioWorklet.addModule(new URL('output-protection-processor.js', location.href));
      const source = context.createBufferSource();
      const buffer = context.createBuffer(2, 128, sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        values.forEach((value, index) => { data[index] = value; });
      }
      source.buffer = buffer;
      source.connect(new AudioWorkletNode(context, 'da-filta-output-protection', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]
      })).connect(context.destination);
      source.start();
      const rendered = await context.startRendering();
      output.push({ sampleRate, values: values.map((_, index) => rendered.getChannelData(0)[index]) });
    }
    return output;
  });
  for (const result of results) {
    const data = result.values;
    expect(data[0]).toBeGreaterThanOrEqual(-.99001);
    expect(data[8]).toBeLessThanOrEqual(.99001);
    expect(data[1]).toBeLessThan(-.8);
    expect(data[7]).toBeGreaterThan(.8);
    for (const index of [2, 3, 4, 5, 6]) expect(data[index]).toBeCloseTo([-.8, -.5, 0, .5, .8][index - 2], 5);
    for (let index = 0; index < data.length; index += 1) expect(data[index]).toBeCloseTo(-data[data.length - 1 - index], 5);
  }
});

test('enable, threshold and softness change only the final transfer', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const cases = await page.evaluate(async () => {
    const result = [];
    for (const options of [
      { enabled: false, threshold: .5, softness: 0 },
      { enabled: true, threshold: .5, softness: 1 },
      { enabled: true, threshold: .95, softness: 1 },
      { enabled: true, threshold: .8, softness: 0 },
      { enabled: true, threshold: .8, softness: 1 }
    ]) {
      const context = new OfflineAudioContext(1, 128, 48000);
      await context.audioWorklet.addModule(new URL('output-protection-processor.js', location.href));
      const buffer = context.createBuffer(1, 128, 48000);
      buffer.getChannelData(0).fill(1);
      buffer.getChannelData(0)[0] = .75;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const processor = new AudioWorkletNode(context, 'da-filta-output-protection', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: options
      });
      source.connect(processor).connect(context.destination);
      source.start();
      const output = (await context.startRendering()).getChannelData(0);
      result.push({ first: output[0], second: output[1] });
    }
    return result;
  });
  expect(cases[0].first).toBeCloseTo(.75, 5);
  expect(cases[0].second).toBeCloseTo(1, 5);
  expect(cases[1].first).toBeLessThan(.75);
  expect(cases[2].first).toBeCloseTo(.75, 5);
  expect(cases[3].second).toBeGreaterThan(cases[4].second);
  for (const entry of cases.slice(1)) expect(entry.second).toBeLessThanOrEqual(.99001);
});
