const { test, expect } = require('playwright/test');
const fs = require('node:fs');

test('real-path headroom survey stays finite across rates and gain layers', async ({ page }, testInfo) => {
  test.setTimeout(300000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const rows = await page.evaluate(async () => {
    const rates = [44100, 48000, 96000];
    const signals = ['sine29', 'sine115', 'sine777', 'sine2800', 'sine5200', 'sine11000', 'multitone', 'noise', 'impulse', 'synth'];
    const all = Array(10).fill(true);
    const configs = [
      { name: 'A neutral/default', wet: 50, volume: -6 },
      { name: 'B input +24', inputDb: 24 },
      { name: 'C 10x 0 dB' },
      { name: 'D 10x +12 dB', band: 100 },
      { name: 'E 10x +24 dB DEV', band: 100, boostDb: 24 },
      { name: 'F FILTER max boost', filter: true },
      { name: 'G Dynamic EQ max boost', dynamic: true },
      { name: 'H bands+FILTER', band: 100, filter: true },
      { name: 'I bands+Dynamic EQ', band: 100, dynamic: true },
      { name: 'J bands+FILTER+Dynamic EQ', band: 100, filter: true, dynamic: true },
      { name: 'K local common bus', band: 100, local: true, resonance: 1 },
      { name: 'L FB ALL', band: 100, main: true, resonance: 1 },
      { name: 'M local+FB ALL', band: 100, local: true, main: true, resonance: 1 },
      { name: 'N high positive resonance', band: 100, local: true, main: true, resonance: .75 },
      { name: 'O negative resonance', band: 100, local: true, main: true, resonance: -1 },
      ...['linear', 'silk', 'tape', 'tube', 'console', 'crunch', 'destroy'].map(stage => ({ name: `P ${stage}`, inputDb: 24, stage })),
      ...[.25, .5, .75, 1, -.25, -.5, -.75, -1].flatMap(resonance => [
        { name: `FB local ${resonance}`, local: true, resonance },
        { name: `FB main ${resonance}`, main: true, resonance },
        { name: `FB both ${resonance}`, local: true, main: true, resonance }
      ])
    ];
    const metric = (buffer, first) => {
      let peak = 0, sum = 0, over = 0, nonfinite = 0;
      for (let channel = first; channel < first + 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (const sample of data) {
          if (!Number.isFinite(sample)) { nonfinite += 1; continue; }
          const magnitude = Math.abs(sample);
          peak = Math.max(peak, magnitude);
          sum += sample * sample;
          if (magnitude > 1) over += 1;
        }
      }
      return { peak, rms: Math.sqrt(sum / (buffer.length * 2)), over, nonfinite };
    };
    const render = async (rate, signal, config) => {
      const context = new OfflineAudioContext(10, Math.round(rate * .32), rate);
      const source = context.createBufferSource();
      const buffer = context.createBuffer(2, context.length, rate);
      for (let c = 0; c < 2; c += 1) {
        const data = buffer.getChannelData(c);
        let seed = 0x12345678 + c;
        for (let n = 0; n < data.length; n += 1) {
          const t = n / rate;
          const freq = signal.startsWith('sine') ? Number(signal.slice(4)) : 0;
          if (freq) data[n] = .1 * Math.sin(2 * Math.PI * freq * t + c * .19);
          else if (signal === 'multitone') data[n] = [29, 115, 777, 2800, 5200, 11000].reduce((sum, f) => sum + Math.sin(2 * Math.PI * f * t), 0) * (.1 / 6);
          else if (signal === 'noise') { seed = (1664525 * seed + 1013904223) >>> 0; data[n] = .1 * (seed / 0xffffffff * 2 - 1); }
          else if (signal === 'impulse') data[n] = n === 100 ? .5 : 0;
          else data[n] = .09 * (Math.sin(2 * Math.PI * 110 * t) + .4 * Math.sin(2 * Math.PI * 220 * t) + .25 * Math.sin(2 * Math.PI * 440 * t)) * (Math.sin(2 * Math.PI * 2 * t) ** 2);
        }
      }
      source.buffer = buffer;
      const engine = new window.AudioEngine({});
      engine.inputGainDb = config.inputDb || 0;
      engine.maxBandBoostDb = config.boostDb || 12;
      engine.bandGainLeft.fill(config.band || 0);
      engine.bandGainRight.fill(config.band || 0);
      engine.feedbackBandLeft = config.local ? all : Array(10).fill(false);
      engine.feedbackBandRight = config.local ? all : Array(10).fill(false);
      engine.feedbackAllLeft = Boolean(config.main);
      engine.feedbackAllRight = Boolean(config.main);
      engine.resonance = config.resonance || 0;
      if (config.filter) {
        engine.filterEnabled = true;
        engine.filterType = 'bell';
        engine.filterBellFrequencyHz = 777;
        engine.filterBellWidth = 100;
        engine.filterGainDb = 12;
        engine.rebuildFilterModeBandControls();
      }
      if (config.dynamic) {
        engine.dynamicEqEnabled = true;
        engine.dynamicEqMode = 'boost';
        engine.dynamicEqThresholdDb = -60;
        engine.dynamicEqWindowDb = 0;
        engine.dynamicEqRangeDb = 12;
        engine.dynamicEqAttackMs = 1;
        engine.dynamicEqDetectorMode = 'peak';
      }
      await context.audioWorklet.addModule(new URL('input-preamp-processor.js', location.href));
      await context.audioWorklet.addModule(new URL('output-protection-processor.js', location.href));
      const preamp = new AudioWorkletNode(context, 'resonant-input-preamp-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { inputGainDb: engine.inputGainDb, stage: config.stage || 'linear', characterAmount: .5 }
      });
      const inputGain = context.createGain();
      inputGain.gain.value = 10 ** (engine.inputGainDb / 20);
      const bank = await window.Filterbank.create(context, engine.getFilterbankState());
      const dry = context.createGain();
      const wet = context.createGain();
      const mix = context.createGain();
      const master = context.createGain();
      const protection = new AudioWorkletNode(context, 'da-filta-output-protection', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]
      });
      const wetPercent = config.wet ?? 100;
      dry.gain.value = 1 - wetPercent / 100;
      wet.gain.value = wetPercent / 100;
      master.gain.value = 10 ** ((config.volume ?? 0) / 20);
      source.connect(inputGain).connect(preamp);
      preamp.connect(bank.input);
      preamp.connect(dry).connect(mix);
      bank.output.connect(wet).connect(mix);
      mix.connect(master).connect(protection);
      const merger = context.createChannelMerger(10);
      const tap = (node, offset) => {
        const splitter = context.createChannelSplitter(2);
        node.connect(splitter);
        splitter.connect(merger, 0, offset);
        splitter.connect(merger, 1, offset + 1);
      };
      tap(preamp, 0); tap(bank.output, 2); tap(mix, 4); tap(master, 6); tap(protection, 8);
      merger.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      bank.dispose();
      return { rate, signal, config: config.name, source: metric(buffer, 0), input: metric(output, 0), wet: metric(output, 2), premaster: metric(output, 4), postmaster: metric(output, 6), final: metric(output, 8) };
    };
    const results = [];
    for (const rate of rates) {
      for (const config of configs) {
        const chosen = config.name.startsWith('FB ') ? ['sine777', 'multitone', 'impulse'] : signals;
        for (const signal of chosen) results.push(await render(rate, signal, config));
      }
    }
    return results;
  });
  fs.writeFileSync(testInfo.outputPath('headroom.json'), JSON.stringify(rows, null, 2));
  console.log('HEADROOM_SUMMARY=' + JSON.stringify([...rows].sort((a, b) => b.wet.peak - a.wet.peak).slice(0, 12)));
  for (const row of rows) {
    expect(row.input.nonfinite + row.wet.nonfinite + row.premaster.nonfinite + row.postmaster.nonfinite + row.final.nonfinite, `${row.rate} ${row.config} ${row.signal}`).toBe(0);
    expect(row.final.peak, `${row.rate} ${row.config} ${row.signal}`).toBeLessThanOrEqual(.99001);
    if (row.postmaster.peak <= .8) expect(row.final.peak).toBeCloseTo(row.postmaster.peak, 5);
  }
});
