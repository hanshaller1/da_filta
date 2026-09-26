const { test, expect } = require('playwright/test');
const fs = require('node:fs');

test('audit production input character worklet across rates, levels, harmonics and transients', async ({ page }, testInfo) => {
  test.setTimeout(300000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async () => {
    const rates = [44100, 48000, 96000];
    const stages = ['linear', 'silk', 'tape', 'tube', 'console', 'crunch', 'destroy'];
    const amounts = [0, .25, .5, .75, 1];
    const gainDbValues = [0, 12, 24];
    const frequencies = [100, 1000, 5000, 10000];

    const analyze = (data, rate, frequency, first, last) => {
      const n = last - first;
      let sum = 0, peak = 0, dc = 0;
      for (let i = first; i < last; i++) {
        const x = data[i]; sum += x * x; peak = Math.max(peak, Math.abs(x)); dc += x;
      }
      const projection = f => {
        let re = 0, im = 0;
        for (let i = first; i < last; i++) {
          const phase = 2 * Math.PI * f * i / rate;
          re += data[i] * Math.cos(phase); im -= data[i] * Math.sin(phase);
        }
        return 2 * Math.hypot(re, im) / n;
      };
      const fundamental = projection(frequency);
      let harmonicPower = 0;
      const inbandBins = new Set([frequency.toFixed(6)]), aliasBins = new Set();
      const harmonics = [];
      for (let h = 2; h <= 24; h++) {
        const raw = h * frequency;
        if (raw >= rate / 2) {
          const folded = Math.abs(((raw + rate / 2) % rate) - rate / 2);
          const amplitude = projection(folded);
          aliasBins.add(folded.toFixed(6));
          harmonics.push({ order: h, frequency: raw, foldedHz: folded, amplitude });
        } else {
          const amplitude = projection(raw);
          harmonicPower += amplitude * amplitude;
          inbandBins.add(raw.toFixed(6));
          harmonics.push({ order: h, frequency: raw, foldedHz: raw, amplitude });
        }
      }
      let aliasPower = 0;
      for (const bin of aliasBins) if (!inbandBins.has(bin)) {
        const amplitude = projection(Number(bin));
        aliasPower += amplitude * amplitude;
      }
      return {
        rms: Math.sqrt(sum / n), peak, dc: dc / n, fundamental,
        thd: fundamental ? Math.sqrt(harmonicPower) / fundamental : 0,
        aliasRatio: fundamental ? Math.sqrt(aliasPower) / fundamental : 0,
        harmonics
      };
    };

    const render = async ({ rate, stage, amount, frequency = 1000, amplitude = .25, gainDb = 0, kind = 'sine' }) => {
      const length = Math.floor(rate * .2);
      const context = new OfflineAudioContext(1, length, rate);
      await context.audioWorklet.addModule(new URL('/input-preamp-processor.js', location.href));
      const buffer = context.createBuffer(1, length, rate);
      const sourceData = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const t = i / rate;
        if (kind === 'impulse') sourceData[i] = i === Math.floor(rate * .1) ? amplitude : 0;
        else if (kind === 'asymmetric') sourceData[i] = amplitude * (Math.sin(2 * Math.PI * frequency * t) > 0 ? 1 : -.3);
        else if (kind === 'multitone') sourceData[i] = amplitude * ([8000, 9700, 11300].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) / 3);
        else sourceData[i] = amplitude * Math.sin(2 * Math.PI * frequency * t);
      }
      const source = context.createBufferSource(); source.buffer = buffer;
      const gain = context.createGain(); gain.gain.value = 10 ** (gainDb / 20);
      const node = new AudioWorkletNode(context, 'resonant-input-preamp-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { inputGainDb: gainDb, stage, characterAmount: amount }
      });
      source.connect(gain).connect(node).connect(context.destination); source.start();
      const rendered = await context.startRendering();
      const output = rendered.getChannelData(0);
      const first = Math.floor(rate * .1), last = length;
      const inputAnalysis = analyze(sourceData.map ? sourceData : Array.from(sourceData), rate, frequency, first, last);
      const outputAnalysis = analyze(output, rate, frequency, first, last);
      let finite = true, maxAbs = 0;
      for (const x of output) { finite &&= Number.isFinite(x); maxAbs = Math.max(maxAbs, Math.abs(x)); }
      let tailDc = 0, tailRms = 0, tailCount = Math.min(4096, length);
      for (let i = length - tailCount; i < length; i++) { tailDc += output[i]; tailRms += output[i] * output[i]; }
      return { input: inputAnalysis, output: outputAnalysis, finite, maxAbs, tailDc: tailDc / tailCount, tailRms: Math.sqrt(tailRms / tailCount), samples: Array.from(output.slice(Math.floor(rate * .1), Math.floor(rate * .1) + 512)) };
    };

    const neutral = [];
    const harmonic = [];
    const levels = [];
    const transient = [];
    const stereoParity = [];
    const amountTransitions = [];
    for (const rate of rates) {
      for (const stage of stages) {
        for (const amount of [0, 1]) {
          const r = await render({ rate, stage, amount, frequency: 1000, amplitude: .25 });
          neutral.push({ rate, stage, amount, ...r });
        }
        for (const frequency of frequencies) for (const amplitude of [.03, .25, .8]) {
          const r = await render({ rate, stage, amount: 1, frequency, amplitude });
          harmonic.push({ rate, stage, frequency, amplitude, ...r.output, inputRms: r.input.rms, inputPeak: r.input.peak, finite: r.finite });
        }
        for (const amount of amounts) for (const gainDb of gainDbValues) {
          const r = await render({ rate, stage, amount, frequency: 1000, amplitude: .1, gainDb });
          levels.push({ rate, stage, amount, gainDb, inputRms: r.input.rms * 10 ** (gainDb / 20), inputPeak: r.input.peak * 10 ** (gainDb / 20), outputRms: r.output.rms, outputPeak: r.output.peak, dc: r.output.dc, finite: r.finite, maxAbs: r.maxAbs });
        }
        for (const kind of ['impulse', 'asymmetric', 'multitone']) {
          const r = await render({ rate, stage, amount: 1, frequency: 1000, amplitude: kind === 'impulse' ? .8 : .3, gainDb: 24, kind });
          transient.push({ rate, stage, kind, finite: r.finite, peak: r.maxAbs, dc: r.output.dc, tailDc: r.tailDc, tailRms: r.tailRms, outputRms: r.output.rms, samples: r.samples });
        }
        for (const amount of [0, 1]) {
          const length = Math.floor(rate * .05);
          const context = new OfflineAudioContext(2, length, rate);
          await context.audioWorklet.addModule(new URL('/input-preamp-processor.js', location.href));
          const buffer = context.createBuffer(2, length, rate);
          for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < length; i++) data[i] = .25 * Math.sin(2 * Math.PI * 1000 * i / rate);
          }
          const source = context.createBufferSource(); source.buffer = buffer;
          const node = new AudioWorkletNode(context, 'resonant-input-preamp-processor', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
            processorOptions: { inputGainDb: 0, stage, characterAmount: amount }
          });
          source.connect(node).connect(context.destination); source.start();
          const rendered = await context.startRendering();
          const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
          let maximumDifference = 0;
          for (let i = 0; i < length; i++) maximumDifference = Math.max(maximumDifference, Math.abs(left[i] - right[i]));
          stereoParity.push({ rate, stage, amount, maximumDifference });
        }
        const transitionLength = Math.floor(rate * .2);
        const transitionContext = new OfflineAudioContext(1, transitionLength, rate);
        await transitionContext.audioWorklet.addModule(new URL('/input-preamp-processor.js', location.href));
        const transitionBuffer = transitionContext.createBuffer(1, transitionLength, rate);
        const transitionData = transitionBuffer.getChannelData(0);
        for (let i = 0; i < transitionLength; i++) transitionData[i] = .3 + .2 * Math.sin(2 * Math.PI * 100 * i / rate);
        const transitionSource = transitionContext.createBufferSource(); transitionSource.buffer = transitionBuffer;
        const transitionNode = new AudioWorkletNode(transitionContext, 'resonant-input-preamp-processor', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          processorOptions: { inputGainDb: 0, stage, characterAmount: 1 }
        });
        transitionSource.connect(transitionNode).connect(transitionContext.destination);
        transitionSource.start();
        const transitionRendering = transitionContext.startRendering();
        await transitionContext.suspend(.1);
        transitionNode.port.postMessage({ type: 'set-character-amount', value: 0 });
        await transitionContext.resume();
        const transitionOutput = (await transitionRendering).getChannelData(0);
        let transitionFinite = true, transitionPeak = 0, transitionTailDc = 0;
        const tailStart = Math.max(0, transitionOutput.length - Math.floor(rate * .05));
        for (let i = 0; i < transitionOutput.length; i++) {
          const sample = transitionOutput[i];
          transitionFinite &&= Number.isFinite(sample);
          transitionPeak = Math.max(transitionPeak, Math.abs(sample));
          if (i >= tailStart) transitionTailDc += sample;
        }
        amountTransitions.push({ rate, stage, finite: transitionFinite, peak: transitionPeak, tailDc: transitionTailDc / (transitionOutput.length - tailStart) });
      }
    }
    return { rates, stages, amounts, gainDbValues, frequencies, neutral, harmonic, levels, transient, stereoParity, amountTransitions,
      tubeHighpassHz: rates.map(rate => {
        const pole = Math.pow(.9987, 48000 / rate);
        return { rate, pole, hz: -Math.log(pole) * rate / (2 * Math.PI) };
      }) };
  });

  const path = testInfo.outputPath('input-character-audit.json');
  fs.writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(`INPUT_CHARACTER_AUDIT=${path}`);
  const neutralRows = report.neutral.filter(row => row.amount === 0);
  const neutralMaxDifference = Math.max(...neutralRows.map(row => {
    const start = Math.floor(row.rate * .1);
    return Math.max(...row.samples.map((x, i) => Math.abs(x - .25 * Math.sin(2 * Math.PI * 1000 * (start + i) / row.rate))));
  }));
  console.log('INPUT_CHARACTER_AUDIT_SUMMARY=' + JSON.stringify({
    neutralMaxDifference,
    thdMax: Object.fromEntries(report.stages.map(stage => [stage, Math.max(...report.harmonic.filter(row => row.stage === stage).map(row => row.thd))])),
    aliasMax: Object.fromEntries(report.stages.map(stage => [stage, Math.max(...report.harmonic.filter(row => row.stage === stage).map(row => row.aliasRatio))])),
    nonfinite: report.transient.filter(row => !row.finite).map(({ rate, stage, kind }) => ({ rate, stage, kind })),
    tubeHighpassHz: report.tubeHighpassHz
  }));
  expect(report.neutral.every(row => row.finite)).toBe(true);
  expect(report.harmonic.every(row => row.finite)).toBe(true);
  expect(report.levels.every(row => row.finite)).toBe(true);
  expect(report.transient.every(row => row.finite)).toBe(true);
  expect(report.stereoParity.every(row => row.maximumDifference < 1e-7)).toBe(true);
  expect(report.amountTransitions.every(row => row.finite && row.peak < 100 && Math.abs(row.tailDc - .3) < .03)).toBe(true);
});
