const { test, expect } = require('playwright/test');

test('temporary LOCAL-only routing and fader diagnosis', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const frequencies = [...window.Filterbank.BAND_FREQUENCIES];
    const qs = [...window.Filterbank.BAND_QS];
    const sampleRate = 48000;
    const length = Math.round(sampleRate * 0.8);
    const fftFrequency = samples => {
      const size = 16384;
      const re = new Float64Array(size);
      const im = new Float64Array(size);
      for (let i = 0; i < size; i += 1) {
        re[i] = samples[samples.length - size + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
      }
      for (let i = 1, j = 0; i < size; i += 1) {
        let bit = size >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { const swap = re[i]; re[i] = re[j]; re[j] = swap; }
      }
      for (let span = 2; span <= size; span <<= 1) {
        const angle = -2 * Math.PI / span;
        for (let start = 0; start < size; start += span) {
          for (let offset = 0; offset < span / 2; offset += 1) {
            const phase = angle * offset;
            const cosine = Math.cos(phase); const sine = Math.sin(phase);
            const partner = start + offset + span / 2;
            const real = re[partner] * cosine - im[partner] * sine;
            const imaginary = re[partner] * sine + im[partner] * cosine;
            re[partner] = re[start + offset] - real;
            im[partner] = im[start + offset] - imaginary;
            re[start + offset] += real;
            im[start + offset] += imaginary;
          }
        }
      }
      let best = 1; let bestPower = 0;
      for (let bin = 1; bin < size / 2; bin += 1) {
        const power = re[bin] ** 2 + im[bin] ** 2;
        if (power > bestPower) { bestPower = power; best = bin; }
      }
      return { frequency: best * sampleRate / size, power: bestPower };
    };
    const render = async ({ selected = 3, selectedControl = 0, boosted = -1, tap = 'pre-gain', resonance = 1 }) => {
      const context = new OfflineAudioContext(1, length, sampleRate);
      await context.audioWorklet.addModule(new URL('/filterbank-processor.js', location.href));
      const input = context.createBuffer(1, length, sampleRate);
      const samples = input.getChannelData(0);
      for (let i = 0; i < Math.round(sampleRate * 0.03); i += 1) {
        samples[i] = 0.02 * Math.sin(2 * Math.PI * frequencies[selected] * i / sampleRate);
      }
      const gains = Array(10).fill(0); gains[selected] = selectedControl;
      if (boosted >= 0) gains[boosted] = 100;
      const packets = [];
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: {
          bandFrequencies: frequencies, bandQs: qs,
          bandGainLeft: gains, bandGainRight: Array(10).fill(0), maxBandBoostDb: 24, maxBandCutDb: 24,
          feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === selected),
          feedbackBandRight: Array(10).fill(false), feedbackAllLeft: false, feedbackAllRight: false,
          resonance, feedbackTopology: 'common-bus', feedbackCore: 'zdf', feedbackTap: tap,
          wetModel: 'filterbank-sum', collectResonatorDiagnostics: true
        }
      });
      node.port.onmessage = event => {
        if (event.data?.type === 'resonator-diagnostics') packets.push(event.data.left);
      };
      const source = context.createBufferSource(); source.buffer = input;
      source.connect(node).connect(context.destination); source.start();
      const output = (await context.startRendering()).getChannelData(0);
      await new Promise(resolve => setTimeout(resolve, 0));
      const last = packets.at(-1);
      const spectrum = fftFrequency(output);
      let wetEnergy = 0;
      for (let i = length - 16384; i < length; i += 1) wetEnergy += output[i] * output[i];
      return {
        selected: selected + 1, boosted: boosted < 0 ? null : boosted + 1, tap, selectedControl,
        dominantHz: spectrum.frequency, wetRms: Math.sqrt(wetEnergy / 16384),
        localReturnSeries: packets.map(packet => packet.zdfTotalReturn),
        mainReturnSeries: packets.map(packet => packet.mainCommonFeedbackReturn),
        baseEnergy: last.baseBandEnergy, basePeak: last.baseBandPeak,
        finalLocalReturn: last.zdfLocalBus, finite: output.every(Number.isFinite)
      };
    };
    const cases = [];
    for (const selectedControl of [0, -100]) {
      cases.push(await render({ selectedControl }));
      for (const boosted of [4, 5, 6, 7, 8, 9]) {
        cases.push(await render({ selectedControl, boosted }));
      }
    }
    cases.push(await render({ selectedControl: 0, boosted: 6, tap: 'post-gain' }));
    cases.push(await render({ selectedControl: 0, tap: 'post-gain' }));
    cases.push(await render({ selectedControl: 0, resonance: 0 }));
    return cases;
  });
  console.log('LOCAL_ONLY_TOPOLOGY', JSON.stringify(report.map(row => ({
    selected: row.selected, boosted: row.boosted, tap: row.tap, selectedControl: row.selectedControl,
    dominantHz: row.dominantHz, wetRms: +row.wetRms.toFixed(6),
    localReturn: row.localReturnSeries.at(-1), mainReturn: row.mainReturnSeries.at(-1),
    baseEnergy: row.baseEnergy.map(value => +value.toFixed(5)),
    basePeak: row.basePeak.map(value => +value.toFixed(5))
  }))));
  for (const row of report) {
    expect(row.finite).toBe(true);
    expect(row.mainReturnSeries.every(value => value === 0)).toBe(true);
  }
  for (const start of [0, 7]) {
    const reference = report[start];
    for (let index = start + 1; index < start + 7; index += 1) {
      expect(report[index].localReturnSeries).toEqual(reference.localReturnSeries);
      expect(report[index].baseEnergy).toEqual(reference.baseEnergy);
      expect(report[index].basePeak).toEqual(reference.basePeak);
    }
  }
  expect(report[14].localReturnSeries).toEqual(report[15].localReturnSeries);
  expect(report[14].baseEnergy).toEqual(report[15].baseEnergy);
  expect(report[14].basePeak).toEqual(report[15].basePeak);
});
