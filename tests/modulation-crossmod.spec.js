const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const { installReference, processorFactory, crossmodState, measureNativeCrossmod } = require('./helpers/modulation-crossmod.cjs');

const scenarios = ['lfo:lfo.2:rate', 'lfo:lfo.2:amount', 'lfo:envelope.2:attack',
  'lfo:envelope.2:release', 'lfo:envelope.2:amount', 'env:lfo.2:rate', 'env:lfo.2:amount',
  'env:envelope.2:attack', 'env:envelope.2:release', 'env:envelope.2:amount',
  'clock:lfo.2:rate', 'clock:envelope.2:amount'];
for (const rate of [48000, 96000]) test(`cross modulation renders deterministic finite production Worklet audio at ${rate} Hz`, async ({ page }) => {
  await page.goto('/');
  const states = scenarios.map(scenario => [scenario, crossmodState(scenario), crossmodState(scenario, false)]);
  const result = await page.evaluate(async ({ rate, states }) => {
    const render = async state => {
      const length = Math.round(rate * .35);
      const context = new OfflineAudioContext(2, length, rate);
      await context.audioWorklet.addModule('/filterbank-processor.js');
      const buffer = context.createBuffer(2, length, rate);
      for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < length; frame++) {
        const time = frame / rate, pulse = time % .09 < .05 ? 1 : .02;
        buffer.getChannelData(channel)[frame] = pulse * .09 * (Math.sin(time * 2 * Math.PI * 640) + .3 * Math.sin(time * 2 * Math.PI * 160));
      }
      const source = context.createBufferSource(); source.buffer = buffer;
      const bank = new AudioWorkletNode(context, 'da-filta-processor', { numberOfInputs: 1, numberOfOutputs: 2,
        outputChannelCount: [2, 1], processorOptions: { modulationState: state,
          bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
          bandGainLeft: Array(10).fill(20), bandGainRight: Array(10).fill(20), resonance: 0 } });
      let errors = 0; bank.onprocessorerror = () => errors++;
      source.connect(bank); bank.connect(context.destination, 0); source.start();
      const output = await context.startRendering();
      bank.disconnect(); source.disconnect();
      return { channels: [output.getChannelData(0), output.getChannelData(1)], errors };
    };
    const rows = [];
    for (const [scenario, active, inactive] of states) {
      const a = await render(active), repeat = await render(active), base = await render(inactive);
      let difference = 0, parity = 0, peak = 0, finite = true;
      for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < a.channels[channel].length; frame++) {
        const sample = a.channels[channel][frame]; finite &&= Number.isFinite(sample);
        difference = Math.max(difference, Math.abs(sample - base.channels[channel][frame]));
        parity = Math.max(parity, Math.abs(sample - repeat.channels[channel][frame])); peak = Math.max(peak, Math.abs(sample));
      }
      rows.push({ scenario, difference, parity, peak, finite, errors: a.errors + repeat.errors + base.errors });
    }
    return rows;
  }, { rate, states });
  for (const row of result) {
    expect(row.finite, row.scenario).toBe(true); expect(row.errors, row.scenario).toBe(0);
    expect(row.parity, row.scenario).toBe(0); expect(row.difference, row.scenario).toBeGreaterThan(1e-6);
    expect(row.peak, row.scenario).toBeLessThan(1);
  }
  fs.writeFileSync(test.info().outputPath('crossmod-audio.json'), JSON.stringify(result, null, 2));
});

test('native Worklet callback costs for many assignments and meta modulation at 48/96 kHz', async ({ page }) => {
  test.setTimeout(60000);
  const report = await measureNativeCrossmod(page);
  for (const row of report.live) {
    expect(row.actualRate).toBe(row.rate); expect(row.processorErrors).toBe(0); expect(row.finite).toBe(true);
    expect(row.messages).toBeGreaterThan(0); expect(row.reads).toBeGreaterThan(10); expect(row.peak).toBeLessThan(1);
  }
  expect(report.nativeRender).toHaveLength(6);
  for (const row of report.nativeRender) expect(row.blocks).toBeGreaterThan(100);
  fs.writeFileSync(test.info().outputPath('crossmod-native.json'), JSON.stringify(report, null, 2));
  console.log('CROSSMOD_NATIVE=' + JSON.stringify(report.nativeRender));
});

test('topological Worklet order, cycle restore, availability and base restoration use compiled handles', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async code => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { makeBank } = await import(url); URL.revokeObjectURL(url);
    const options = { bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
      bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0), modulationState: {
        lfoModuleEnabled: true, envelopeModuleEnabled: true, lfoSources: [{ enabled: true, waveform: 'square', rateHz: .01,
          assignments: [{ id: 'a', targetId: 'lfo.2.amount', amount: 50 }] },
          { enabled: true, waveform: 'square', rateHz: 2, outputAmount: 25,
            assignments: [{ id: 'b', targetId: 'envelope.1.attack', amount: 50 }] }],
        envelopeSources: [{ enabled: true, attack: 20, assignments: [{ id: 'out', targetId: 'filterbank.band.4.gainDb', amount: 25 }] }]
      } };
    const bank = makeBank(48000, options);
    const input = [[new Float32Array(128).fill(.3), new Float32Array(128).fill(.3)]];
    const output = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]];
    const order = bank.modulationCore.graph.order;
    const compilationCount = bank.modulationCore.compilationCount, nodes = bank.modulationNodes, targets = bank.modulationCore.compiledTargets;
    bank.modulationCore.compileAssignments = () => { throw new Error('graph rebuilt in sample loop'); };
    for (let index = 0; index < 20; index++) bank.process(input, output);
    const active = { amount: bank.lfoSources[1].effectiveOutputAmount, attack: bank.envelopeSources[0].effectiveAttack,
      baseRate: bank.lfoSources[1].rateHz, baseAttack: bank.envelopeSources[0].attack,
      compileStable: compilationCount === bank.modulationCore.compilationCount && nodes === bank.modulationNodes && targets === bank.modulationCore.compiledTargets };
    const bank2 = makeBank(48000, { ...options, modulationState: { ...options.modulationState,
      assignments: [...bank.modulationCore.getAssignments()].reverse() } });
    for (let index = 0; index < 20; index++) bank2.process(input, output);
    const reverse = [bank2.lfoSources[1].effectiveOutputAmount, bank2.envelopeSources[0].effectiveAttack, bank2.envelopeSources[0].value];
    const value = bank.envelopeSources[0].value;
    const restore = makeBank(48000, { ...options, modulationState: { ...options.modulationState,
      assignments: [{ id: 'self', sourceId: 'lfo.2', targetId: 'lfo.2.rate', amount: 100 }] } });
    for (let index = 0; index < 20; index++) restore.process(input, output);
    const cyclic = { ids: restore.modulationCore.getAssignments().map(item => item.id), blocked: [...restore.modulationCore.graph.blocked],
      rate: restore.lfoSources[1].effectiveRateHz };
    const base = makeBank(48000, { ...options, modulationState: { ...options.modulationState, assignments: [] } });
    const state = structuredClone(options.modulationState);
    state.assignments = [{ id: 'rate.saved', sourceId: 'lfo.1', targetId: 'lfo.2.rate', amount: 20 }];
    const availabilityBank = makeBank(48000, { ...options, modulationState: state });
    const rates = [];
    const sample = () => { for (let index = 0; index < 4; index++) availabilityBank.process(input, output);
      rates.push([availabilityBank.lfoSources[1].rateHz, availabilityBank.lfoSources[1].effectiveRateHz]); };
    sample();
    state.lfoSources[1].rateMode = 'sync'; availabilityBank.setModulationState(state); sample();
    state.lfoSources[1].rateMode = 'free'; availabilityBank.setModulationState(state); sample();
    state.assignments[0].enabled = false; availabilityBank.setModulationState(state); sample();
    state.assignments[0].enabled = true; state.lfoSources[0].enabled = false;
    availabilityBank.setModulationState(state); sample();
    state.lfoSources[0].enabled = true; availabilityBank.setModulationState(state); sample();
    const savedId = availabilityBank.modulationCore.getAssignments()[0].id;
    state.assignments = []; availabilityBank.setModulationState(state); sample();
    return { order, active, reverse, value, cyclic, rates, savedId,
      base: [base.lfoSources[1].effectiveOutputAmount, base.envelopeSources[0].effectiveAttack] };
  }, processorFactory('http://localhost:3000'));
  expect(result.order.indexOf('lfo.1')).toBeLessThan(result.order.indexOf('lfo.2'));
  expect(result.order.indexOf('lfo.2')).toBeLessThan(result.order.indexOf('envelope.1'));
  expect(result.active).toMatchObject({ amount: 50, baseRate: 2, baseAttack: 20, compileStable: true });
  expect(result.active.attack).toBeGreaterThan(20);
  expect(result.reverse).toEqual([result.active.amount, result.active.attack, result.value]);
  expect(result.cyclic).toEqual({ ids: ['self'], blocked: ['lfo.2:self'], rate: 2 });
  expect(result.base).toEqual([25, 20]);
  expect(result.savedId).toBe('rate.saved');
  expect(result.rates.map(row => row[0])).toEqual(Array(7).fill(2));
  for (const index of [0, 2, 5]) expect(result.rates[index][1]).toBeGreaterThan(2);
  for (const index of [1, 3, 4, 6]) expect(result.rates[index][1]).toBe(2);
});

test('existing ordinary assignments and Clock holds match P2 DSP audio; focused 48/96 kHz costs remain bounded', async ({ page }) => {
  await installReference(page); await page.goto('/');
  const result = await page.evaluate(async ({ before, after }) => {
    const load = async code => { const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); const module = await import(url); URL.revokeObjectURL(url); return module; };
    const a = await load(before), b = await load(after), rows = [];
    for (const rate of [48000, 96000]) for (const clock of [false, true]) {
      const options = { bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
        // Freeze the P2 comparison path independently of product startup defaults.
        feedbackCore: 'current', feedbackTopology: 'isolated-tpt', wetModel: 'reference-delta',
        feedbackTap: 'pre-gain', feedbackAllEngine: 'legacy', feedbackAllLevel: 'raw',
        bandGainLeft: Array(10).fill(20), bandGainRight: Array(10).fill(15), resonance: .3,
        modulationState: { filterbankEnabled: true, lfoModuleEnabled: true, envelopeModuleEnabled: true,
          lfoSources: Array.from({ length: 4 }, (_, index) => ({ enabled: true, rateHz: .7 + index, waveform: 'sine',
            assignments: Array.from({ length: 3 }, (_, target) => ({ id: `${index}.${target}`, targetId: `filterbank.band.${index + target}.gainDb`, amount: 5, channel: target === 2 ? 'spread' : 'both' })) })),
          envelopeSources: [{ enabled: true, attack: 20, release: 250, targetId: 'filterbank.band.5.gainDb', amount: 15, channel: 'spread' }],
          clockMod: { enabled: clock, midpointDb: -3, modulationGain: 60, rightInvert: true, internalBpm: 10000,
            direction: 'ping-pong', waveform: 'random', lockedBands: [false, true] } } };
      const old = a.makeBank(rate, options), current = b.makeBank(rate, options);
      const input = [[new Float32Array(128).fill(.05), new Float32Array(128).fill(.03)]];
      const outA = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]];
      const outB = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]];
      let maxDifference = 0, squares = 0;
      for (let block = 0; block < 256; block++) {
        old.process(input, outA); current.process(input, outB);
        for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 128; frame++) {
          const difference = outA[0][channel][frame] - outB[0][channel][frame];
          maxDifference = Math.max(maxDifference, Math.abs(difference)); squares += difference * difference;
        }
      }
      const costs = [[], []];
      for (let round = 0; round < 7; round++) for (const version of round % 2 ? [1, 0] : [0, 1]) {
        const bank = version ? current : old, output = version ? outB : outA;
        const started = performance.now(); for (let block = 0; block < 256; block++) bank.process(input, output);
        costs[version].push((performance.now() - started) / 256);
      }
      const median = values => [...values].sort((x, y) => x - y)[3];
      const metaOptions = structuredClone(options);
      metaOptions.modulationState.lfoSources[0].assignments.push(
        { id: 'meta.rate', targetId: 'lfo.2.rate', amount: 20 },
        { id: 'meta.amount', targetId: 'lfo.3.amount', amount: 25, invert: true },
        { id: 'meta.attack', targetId: 'envelope.1.attack', amount: 20 },
        { id: 'meta.release', targetId: 'envelope.1.release', amount: 20 });
      metaOptions.modulationState.envelopeSources[0].assignments = [
        { id: 'env.audio', targetId: 'filterbank.band.5.gainDb', amount: 15, channel: 'spread' },
        { id: 'env.rate', targetId: 'lfo.4.rate', amount: 20 },
        { id: 'env.amount', targetId: 'lfo.4.amount', amount: 25, invert: true }];
      const meta = b.makeBank(rate, metaOptions), metaCosts = [];
      for (let block = 0; block < 64; block++) meta.process(input, outB);
      const compileCount = meta.modulationCore.compilationCount, nodes = meta.modulationNodes;
      meta.modulationCore.compileAssignments = () => { throw new Error('sample-loop compilation'); };
      for (let round = 0; round < 7; round++) {
        const started = performance.now(); for (let block = 0; block < 256; block++) meta.process(input, outB);
        metaCosts.push((performance.now() - started) / 256);
      }
      rows.push({ rate, clock, maxDifference, rmsDifference: Math.sqrt(squares / (256 * 256)),
        beforeMs: median(costs[0]), afterMs: median(costs[1]), metaMs: median(metaCosts),
        metaCompileStable: compileCount === meta.modulationCore.compilationCount && nodes === meta.modulationNodes,
        finite: outB.flat().every(channel => channel.every(Number.isFinite)),
        holdsEqual: JSON.stringify([...old.clockMod.heldLeft, ...old.clockMod.heldRight]) === JSON.stringify([...current.clockMod.heldLeft, ...current.clockMod.heldRight]) });
    }
    return rows;
  }, { before: processorFactory('http://localhost:3000', true), after: processorFactory('http://localhost:3000') });
  for (const row of result) {
    expect(row.maxDifference, JSON.stringify(row)).toBe(0); expect(row.rmsDifference).toBe(0);
    expect(row.finite).toBe(true); expect(row.holdsEqual).toBe(true);
    expect(row.afterMs, JSON.stringify(row)).toBeLessThan(row.beforeMs * 2 + .5);
    expect(row.metaMs, JSON.stringify(row)).toBeLessThan(row.afterMs * 3 + .5);
    expect(row.metaCompileStable).toBe(true);
  }
  fs.writeFileSync(test.info().outputPath('crossmod-performance.json'), JSON.stringify(result, null, 2));
  console.log('CROSSMOD_COSTS=' + JSON.stringify(result));
});
