const { test, expect } = require('playwright/test');

test('TUBE DC blocker preserves its 48 kHz cutoff at all supported sample rates', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const rates = [44100, 48000, 96000];
    const referencePole = .9987;
    const amplitude = .001;
    const biasDerivative = 1 / Math.cosh(1.3 * .18) ** 2;
    const poleFor = rate => Math.pow(referencePole, 48000 / rate);
    const cutoffFor = (rate, pole) => Math.acos(2 * pole / (1 + pole * pole)) * rate / (2 * Math.PI);
    const toneResponse = [];

    for (const rate of rates) {
      for (const frequency of [1, 5, 10, 20, 100]) {
        const length = rate * 2;
        const context = new OfflineAudioContext(1, length, rate);
        await context.audioWorklet.addModule(new URL('/input-preamp-processor.js', location.href));
        const buffer = context.createBuffer(1, length, rate);
        const input = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) input[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / rate);
        const source = context.createBufferSource(); source.buffer = buffer;
        const node = new AudioWorkletNode(context, 'resonant-input-preamp-processor', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          processorOptions: { inputGainDb: 0, stage: 'tube', characterAmount: 1 }
        });
        source.connect(node).connect(context.destination); source.start();
        const rendered = await context.startRendering();
        const output = rendered.getChannelData(0);
        let re = 0, im = 0;
        const first = rate, last = rate * 2, count = rate;
        for (let i = first; i < last; i++) {
          const phase = 2 * Math.PI * frequency * i / rate;
          re += output[i] * Math.cos(phase);
          im -= output[i] * Math.sin(phase);
        }
        const measuredRatio = (2 * Math.hypot(re, im) / count) / amplitude;
        const pole = poleFor(rate);
        const omega = 2 * Math.PI * frequency / rate;
        const highpassMagnitude = Math.sqrt((2 - 2 * Math.cos(omega)) / (1 + pole * pole - 2 * pole * Math.cos(omega)));
        toneResponse.push({ rate, frequency, measuredRatio, expectedRatio: biasDerivative * highpassMagnitude });
      }
    }

    const impulse = [];
    for (const rate of rates) {
      const length = rate;
      const context = new OfflineAudioContext(1, length, rate);
      await context.audioWorklet.addModule(new URL('/input-preamp-processor.js', location.href));
      const buffer = context.createBuffer(1, length, rate);
      buffer.getChannelData(0)[Math.floor(rate * .1)] = .8;
      const source = context.createBufferSource(); source.buffer = buffer;
      const gain = context.createGain(); gain.gain.value = 10 ** (24 / 20);
      const node = new AudioWorkletNode(context, 'resonant-input-preamp-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { inputGainDb: 24, stage: 'tube', characterAmount: 1 }
      });
      source.connect(gain).connect(node).connect(context.destination); source.start();
      const rendered = await context.startRendering();
      const output = rendered.getChannelData(0);
      let finite = true, tailPeak = 0;
      for (let i = 0; i < output.length; i++) {
        finite &&= Number.isFinite(output[i]);
        if (i >= Math.floor(rate * .75)) tailPeak = Math.max(tailPeak, Math.abs(output[i]));
      }
      impulse.push({ rate, finite, tailPeak });
    }

    return {
      rates,
      poles: rates.map(rate => ({ rate, oldPole: referencePole, newPole: poleFor(rate) })),
      cutoffs: rates.map(rate => ({ rate, oldCutoff: cutoffFor(rate, referencePole), newCutoff: cutoffFor(rate, poleFor(rate)) })),
      toneResponse,
      impulse
    };
  });

  for (const row of report.poles) {
    expect(row.newPole).toBeCloseTo(Math.pow(.9987, 48000 / row.rate), 15);
  }
  expect(report.poles.find(row => row.rate === 48000).newPole).toBe(.9987);
  const referenceCutoff = report.cutoffs.find(row => row.rate === 48000).newCutoff;
  for (const row of report.cutoffs) {
    expect(Math.abs(row.newCutoff - referenceCutoff)).toBeLessThan(0.00001);
    expect(Math.abs(row.newCutoff - 9.93773)).toBeLessThan(0.00001);
  }
  for (const row of report.toneResponse) {
    expect(Math.abs(row.measuredRatio - row.expectedRatio), `${row.rate} Hz at ${row.frequency} Hz`).toBeLessThan(0.00002);
  }
  expect(report.impulse.every(row => row.finite && row.tailPeak < 1e-6)).toBe(true);
  console.log('TUBE_DC_RATE_REPORT=' + JSON.stringify(report));
});
