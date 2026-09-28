const { test, expect } = require('playwright/test');
const { browserBundle } = require('./helpers/input-character-full-graph.cjs');

test('Clock Mod adds an isolated held layer and combines with band modulation in the worklet', async ({ page }) => {
  await page.goto('/');
  const bundle = browserBundle('http://localhost:3000');
  const result = await page.evaluate(async code => {
    const moduleUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { Graph } = await import(moduleUrl);
    URL.revokeObjectURL(moduleUrl);
    const engine = window.ClockModMode.getAudioEngine();
    const modulationState = engine.getModulationState();
    const options = {
      bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES],
      bandQs: [...window.Filterbank.BAND_QS],
      bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
      maxBandBoostDb: 12, maxBandCutDb: 12, modulationState
    };
    const graph = new Graph(48000, options, 'linear', false);
    const bank = graph.bank;
    bank.setBandControl('left', 0, 40, true);
    bank.setBandControl('right', 0, -20, true);
    const baseBefore = [bank.bandControls.left[0], bank.bandControls.right[0]];
    const runBlocks = count => {
      const inputs = [[new Float32Array(128), new Float32Array(128)]];
      const outputs = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]];
      for (let index = 0; index < count; index += 1) bank.process(inputs, outputs);
    };
    const offState = { ...modulationState, filterbankEnabled: true, filterEnabled: true, dynamicEqEnabled: true,
      dynamicEqThresholdDb: -24, dynamicEqRangeDb: 6,
      clockMod: { enabled: false, waveform: 'saw', sourceFrequencyHz: 1, modulationGain: 50, midpointDb: 0,
        direction: 'forward', clockSource: 'internal', internalBpm: 10000, clockScale: '1/4', rightInvert: false,
        lockedBands: Array(10).fill(false) } };
    bank.setModulationState(offState);
    runBlocks(4);
    const offOffset = bank.modulationBandOffsetsByChannel.left[0];
    const lfoSources = offState.lfoSources.map(item => ({ ...item }));
    Object.assign(lfoSources[0], { enabled: true, waveform: 'sine', rateHz: 1, phaseOffsetDeg: 90,
      targetId: 'filterbank.band.0.gainDb', amount: 50 });
    const activeState = { ...offState, lfoModuleEnabled: true, lfoEnabled: true, lfoSources,
      assignments: [{ sourceId: 'lfo.1', targetId: 'filterbank.band.0.gainDb', amount: 50 }],
      clockMod: { ...offState.clockMod, enabled: true, rightInvert: true } };
    bank.setModulationState(activeState);
    runBlocks(4);
    const active = {
      leftOffset: bank.modulationBandOffsetsByChannel.left[0],
      rightOffset: bank.modulationBandOffsetsByChannel.right[0],
      directLeft: bank.modulationDirectBandOffsetsByChannel.left[0],
      directRight: bank.modulationDirectBandOffsetsByChannel.right[0],
      heldLeft: bank.clockMod.heldLeft[0], heldRight: bank.clockMod.heldRight[0],
      heldBand1: bank.clockMod.heldLeft[1],
      currentBand: bank.clockMod.currentBand,
      assignmentCount: bank.modulationCore.assignments.length,
      leftMultiplier: bank.modulationBandGainTargets.left[0],
      rightMultiplier: bank.modulationBandGainTargets.right[0],
      finite: bank.modulationBandOffsetsByChannel.left.every(Number.isFinite)
        && bank.modulationBandGainTargets.right.every(Number.isFinite),
      baseAfter: [bank.bandControls.left[0], bank.bandControls.right[0]]
    };
    bank.setModulationState({ ...activeState, clockMod: { ...activeState.clockMod, enabled: false } });
    runBlocks(1);
    const disabledOffset = bank.modulationBandOffsetsByChannel.left[0];
    const disabledDirectLeft = bank.modulationDirectBandOffsetsByChannel.left[0];
    return { offOffset, active, disabledOffset, disabledDirectLeft, baseBefore };
  }, bundle);

  expect(result.offOffset).toBe(0);
  expect(result.active.leftOffset).toBeCloseTo(result.active.directLeft + result.active.heldLeft, 8);
  expect(result.active.rightOffset).toBeCloseTo(result.active.directRight + result.active.heldRight, 8);
  expect(result.active.directLeft).toBeGreaterThan(0);
  expect(result.active.directRight).toBeGreaterThan(0);
  expect(result.active.heldLeft).toBeLessThan(0);
  expect(result.active.heldRight).toBeGreaterThan(0);
  expect(result.active.heldBand1).toBe(0);
  expect(result.active.assignmentCount).toBe(1);
  expect(result.active.finite).toBe(true);
  expect(result.active.baseAfter).toEqual(result.baseBefore);
  expect(result.disabledOffset).toBeCloseTo(result.disabledDirectLeft, 8);
  expect(result.active.leftMultiplier).toBeGreaterThan(0);
  expect(result.active.rightMultiplier).toBeGreaterThan(0);
});

test('Clock Mod worklet caps UI telemetry at 15 Hz at 10,000 BPM', async ({ page }) => {
  await page.goto('/');
  const bundle = browserBundle('http://localhost:3000');
  const result = await page.evaluate(async code => {
    const moduleUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { Graph } = await import(moduleUrl);
    URL.revokeObjectURL(moduleUrl);
    const engine = window.ClockModMode.getAudioEngine();
    const options = { bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
      bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0), maxBandBoostDb: 12, maxBandCutDb: 12,
      modulationState: { ...engine.getModulationState(), clockMod: { enabled: true, internalBpm: 10000,
        sourceFrequencyHz: 20, modulationGain: 100, waveform: 'random', direction: 'random' } } };
    const graph = new Graph(48000, options, 'linear', false);
    const messages = [];
    graph.bank.port.postMessage = message => { if (message.type === 'clock-mod-telemetry') messages.push(message); };
    const inputs = [[new Float32Array(128), new Float32Array(128)]];
    const outputs = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]];
    for (let index = 0; index < 188; index += 1) graph.bank.process(inputs, outputs);
    return { telemetryCount: messages.length, phase: graph.bank.clockMod.oscillatorPhase,
      finite: [...graph.bank.clockMod.heldLeft, ...graph.bank.clockMod.heldRight].every(Number.isFinite),
      cursor: graph.bank.clockMod.currentBand };
  }, bundle);
  expect(result.telemetryCount).toBeLessThanOrEqual(9);
  expect(result.telemetryCount).toBeGreaterThanOrEqual(7);
  expect(result.finite).toBe(true);
  expect(result.phase).toBeGreaterThanOrEqual(0);
  expect(result.phase).toBeLessThan(1);
  expect(result.cursor).toBeGreaterThanOrEqual(0);
  expect(result.cursor).toBeLessThan(10);
});

test('Clock Mod worklet follows shared MIDI START, STOP, CONTINUE, and scale', async ({ page }) => {
  await page.goto('/');
  const bundle = browserBundle('http://localhost:3000');
  const result = await page.evaluate(async code => {
    const moduleUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { Graph } = await import(moduleUrl);
    URL.revokeObjectURL(moduleUrl);
    const engine = window.ClockModMode.getAudioEngine();
    const options = { bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
      bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0), maxBandBoostDb: 12, maxBandCutDb: 12,
      modulationState: { ...engine.getModulationState(), clock: { source: 'internal', bpm: 60, midiBpm: 120, running: true },
        clockMod: { enabled: true, waveform: 'saw', sourceFrequencyHz: 1, modulationGain: 100, midpointDb: 0,
          direction: 'forward', clockSource: 'midi', clockScale: '1/8', internalBpm: 120 } } };
    const graph = new Graph(48000, options, 'linear', false);
    const bank = graph.bank;
    const block = length => {
      const inputs = [[new Float32Array(length), new Float32Array(length)]];
      const outputs = [[new Float32Array(length), new Float32Array(length)], [new Float32Array(length)]];
      bank.process(inputs, outputs);
    };
    const run = frames => {
      let remaining = frames;
      while (remaining >= 128) { block(128); remaining -= 128; }
      if (remaining > 0) block(remaining);
    };
    bank.handleMessage({ type: 'midi-clock-start' });
    run(12000);
    const afterFirstStep = { last: bank.clockMod.lastTriggeredBand, current: bank.clockMod.currentBand,
      midiBeat: bank.clockCore.midiBeatPosition, held: bank.clockMod.heldLeft[0] };
    bank.handleMessage({ type: 'midi-clock-stop' });
    run(12000);
    const afterStop = { current: bank.clockMod.currentBand, midiBeat: bank.clockCore.midiBeatPosition,
      held: bank.clockMod.heldLeft[0] };
    bank.handleMessage({ type: 'midi-clock-pulse', bpm: 120 });
    run(12000);
    const afterStoppedPulse = { current: bank.clockMod.currentBand, midiBeat: bank.clockCore.midiBeatPosition,
      held: bank.clockMod.heldLeft[0] };
    bank.handleMessage({ type: 'midi-clock-continue' });
    run(12000);
    const afterContinue = { last: bank.clockMod.lastTriggeredBand, midiBeat: bank.clockCore.midiBeatPosition };
    const heldBeforeStart = bank.clockMod.heldLeft[0];
    bank.handleMessage({ type: 'midi-clock-start' });
    return { afterFirstStep, afterStop, afterStoppedPulse, afterContinue, afterStart: {
      current: bank.clockMod.currentBand, last: bank.clockMod.lastTriggeredBand,
      midiBeat: bank.clockCore.midiBeatPosition, held: bank.clockMod.heldLeft[0], heldBeforeStart
    } };
  }, bundle);
  expect(result.afterFirstStep.last).toBe(0);
  expect(result.afterFirstStep.current).toBe(1);
  expect(result.afterFirstStep.midiBeat).toBeCloseTo(0.5, 3);
  expect(result.afterStop.current).toBe(1);
  expect(result.afterStop.midiBeat).toBeCloseTo(result.afterFirstStep.midiBeat, 8);
  expect(result.afterStop.held).toBe(result.afterFirstStep.held);
  expect(result.afterStoppedPulse.current).toBe(result.afterStop.current);
  expect(result.afterStoppedPulse.midiBeat).toBe(result.afterStop.midiBeat);
  expect(result.afterStoppedPulse.held).toBe(result.afterStop.held);
  expect(result.afterContinue.last).toBe(1);
  expect(result.afterContinue.midiBeat).toBeCloseTo(1, 3);
  expect(result.afterStart.current).toBe(0);
  expect(result.afterStart.last).toBe(-1);
  expect(result.afterStart.midiBeat).toBe(0);
  expect(result.afterStart.held).toBe(result.afterStart.heldBeforeStart);
});
