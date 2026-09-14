const { test, expect } = require('playwright/test');

test('the UI-to-production path delivers a non-zero positive local TPT residual to the wet and final outputs', async ({ page }) => {
  test.setTimeout(180000);
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const testState = {
      workletNodes: [],
      workletMessages: [],
      diagnostics: []
    };
    window.__tptPositiveE2e = testState;
    const nativeAudioWorkletNode = window.AudioWorkletNode;
    window.AudioWorkletNode = function InstrumentedAudioWorkletNode(context, name, options) {
      options.processorOptions.collectResonatorDiagnostics = true;
      let node;
      try {
        node = new nativeAudioWorkletNode(context, name, options);
      } catch (error) {
        testState.workletNodeError = error?.message || String(error);
        throw error;
      }
      const postMessage = node.port.postMessage.bind(node.port);
      node.port.postMessage = message => {
        testState.workletMessages.push(structuredClone(message));
        postMessage(message);
      };
      const collectDiagnostics = event => {
        if (event.data?.type === 'resonator-diagnostics') testState.diagnostics.push(event.data);
      };
      node.port.addEventListener('message', collectDiagnostics);
      node.port.onmessage = collectDiagnostics;
      node.port.start?.();
      testState.workletNodes.push({ name, options: structuredClone(options) });
      return node;
    };
    window.AudioWorkletNode.prototype = nativeAudioWorkletNode.prototype;

    const mediaDevices = navigator.mediaDevices || {};
    mediaDevices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'test-input', label: 'Test input', groupId: 'test-group' }];
    mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    if (!mediaDevices.addEventListener) mediaDevices.addEventListener = () => {};
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async function () {} });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: function () {} });
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { configurable: true, value: async function () {} });

    const buildInput = (context, config) => {
      const buffer = context.createBuffer(2, context.length, context.sampleRate);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      let randomState = 0x13579bdf;
      const random = () => {
        randomState = (1664525 * randomState + 1013904223) >>> 0;
        return randomState / 0xffffffff;
      };
      for (let frame = 0; frame < context.length; frame += 1) {
        const time = frame / context.sampleRate;
        let sample;
        if (config.signal === 'noise') {
          sample = (random() * 2 - 1) * 0.006;
        } else if (config.signal === 'multi') {
          sample = 0.004 * (
            Math.sin(2 * Math.PI * 79 * time)
            + Math.sin(2 * Math.PI * 411 * time + 0.27)
            + Math.sin(2 * Math.PI * 997 * time + 0.61)
            + Math.sin(2 * Math.PI * 2800 * time + 0.11)
          );
        } else {
          sample = 0.01 * Math.sin(2 * Math.PI * config.frequency * time);
        }
        left[frame] = sample;
        right[frame] = sample * 0.8;
      }
      return buffer;
    };

    window.AudioContext = function TestOfflineAudioContext() {
      const config = window.__tptPositiveE2eConfig;
      const context = new OfflineAudioContext(2, config.frameCount, config.sampleRate);
      const addModule = context.audioWorklet.addModule.bind(context.audioWorklet);
      Object.defineProperty(context, 'audioWorklet', {
        configurable: true,
        value: {
          addModule: async url => {
            window.__tptPositiveE2e.addModuleUrl = url;
            try {
              await addModule(url);
              window.__tptPositiveE2e.addModuleSucceeded = true;
            } catch (error) {
              window.__tptPositiveE2e.addModuleError = error?.message || String(error);
              throw error;
            }
          }
        }
      });
      const createGain = context.createGain.bind(context);
      context.__tptE2eGains = [];
      context.createGain = () => {
        const gain = createGain();
        context.__tptE2eGains.push(gain);
        return gain;
      };
      context.createMediaStreamSource = () => {
        const source = context.createBufferSource();
        source.buffer = buildInput(context, config);
        source.start();
        return source;
      };
      context.createMediaStreamDestination = () => {
        const destination = createGain();
        destination.stream = new MediaStream();
        destination.connect(context.destination);
        return destination;
      };
      Object.defineProperty(context, 'resume', { configurable: true, value: async () => {} });
      Object.defineProperty(context, 'close', { configurable: true, value: async () => {} });
      window.__tptPositiveE2e.context = context;
      return context;
    };
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  const auditionSelector = page.locator('[data-positive-resonance-audition]');
  await expect(auditionSelector).toHaveValue('0.10');
  await expect(auditionSelector.locator('option')).toHaveText(['0.10', '0.20', '0.30', '0.40', '0.60', '0.80', '1.00']);
  const driveSelector = page.locator('[data-positive-resonance-drive]');
  await expect(driveSelector).toHaveValue('1');
  await expect(driveSelector.locator('option')).toHaveText(['1', '2', '4', '8', '16']);
  const floorSelector = page.locator('[data-positive-resonance-damping-floor]');
  await expect(floorSelector).toHaveValue('0.10');
  await expect(floorSelector.locator('option')).toHaveText(['0.10', '0.05', '0.02', '0.00', '-0.02']);

  const renderFromUi = async config => page.evaluate(async testConfig => {
    const state = window.__tptPositiveE2e;
    state.workletMessages.length = 0;
    state.diagnostics.length = 0;
    state.workletNodes.length = 0;
    window.__tptPositiveE2eConfig = {
      ...testConfig,
      frameCount: Math.round(testConfig.sampleRate * testConfig.duration)
    };

    const setRange = async (selector, value) => {
      const control = document.querySelector(selector);
      control.value = String(value);
      control.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await setRange('[data-control="inputGain"]', 0);
    await setRange('[data-control="dryWet"]', testConfig.dryWet);
    await setRange('[data-control="volume"]', -12);
    await setRange('[data-control="resonance"]', 0);
    const auditionSelect = document.querySelector('[data-positive-resonance-audition]');
    auditionSelect.value = '0.10';
    auditionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    const driveSelect = document.querySelector('[data-positive-resonance-drive]');
    const floorSelect = document.querySelector('[data-positive-resonance-damping-floor]');
    if (!testConfig.preserveDrive) {
      driveSelect.value = '1';
      driveSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (!testConfig.preserveFloor) {
      floorSelect.value = '0.10';
      floorSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const bandIndex = testConfig.bandIndex ?? 4;
    const fader = document.querySelectorAll('.band-fader')[bandIndex];
    fader.value = String(testConfig.bandGain);
    fader.dispatchEvent(new Event('input', { bubbles: true }));
    const localButton = document.querySelectorAll('[data-feedback-band]')[bandIndex];
    const feedbackAllButton = document.querySelector('.fb-all-toggle');
    if (localButton.classList.contains('active')) localButton.click();
    if (feedbackAllButton.classList.contains('active')) feedbackAllButton.click();
    await document.querySelector('[data-audio-start]').click();
    for (let attempt = 0; document.querySelector('[data-audio-status]').textContent !== 'ON' && attempt < 100; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (document.querySelector('[data-audio-status]').textContent !== 'ON') {
      throw new Error(`AudioEngine did not start: ${document.querySelector('[data-audio-message]').textContent}; addModule=${state.addModuleSucceeded}/${state.addModuleError}; node=${state.workletNodeError}`);
    }
    if (testConfig.localFeedback) localButton.click();
    if (testConfig.feedbackAll) feedbackAllButton.click();
    await setRange('[data-control="resonance"]', testConfig.resonance);
    auditionSelect.value = Number(testConfig.auditionGain ?? 0.10).toFixed(2);
    auditionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    if (!testConfig.preserveDrive) {
      driveSelect.value = String(testConfig.drive ?? 1);
      driveSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (!testConfig.preserveFloor) {
      floorSelect.value = Number(testConfig.floor ?? 0.10).toFixed(2);
      floorSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise(resolve => setTimeout(resolve, 50));

    const rendered = await state.context.startRendering();
    await new Promise(resolve => setTimeout(resolve, 50));
    const output = rendered.getChannelData(0);
    let finalPeak = 0;
    let finalEnergy = 0;
    let finite = true;
    for (let frame = 0; frame < output.length; frame += 1) {
      finalPeak = Math.max(finalPeak, Math.abs(output[frame]));
      finalEnergy += output[frame] * output[frame];
      finite = finite && Number.isFinite(output[frame]);
    }
    const diagnosticMessage = state.diagnostics.at(-1);
    const diagnostics = diagnosticMessage?.left;
    const result = {
      finalPeak,
      finalRms: Math.sqrt(finalEnergy / output.length),
      finite,
      diagnostics,
      rightDiagnostics: diagnosticMessage?.right,
      diagnosticsCount: state.diagnostics.length,
      processorOptions: state.workletNodes[0]?.options?.processorOptions,
      workletMessages: state.workletMessages
    };
    document.querySelector('[data-audio-stop]').click();
    for (let attempt = 0; document.querySelector('[data-audio-status]').textContent !== 'OFF' && attempt < 100; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (document.querySelector('[data-audio-status]').textContent !== 'OFF') throw new Error('AudioEngine did not stop.');
    return result;
  }, config);

  const cases = {
    zero: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 411, bandIndex: 4, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 0, bandGain: 0 },
    local: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 411, bandIndex: 4, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, bandGain: 0 },
    calibration020: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 411, bandIndex: 4, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, auditionGain: 0.20, bandGain: 0 },
    calibration030: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 411, bandIndex: 4, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, auditionGain: 0.30, bandGain: 0 },
    calibration040: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 411, bandIndex: 4, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, auditionGain: 0.40, bandGain: 0 },
    calibration060: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 411, bandIndex: 4, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, auditionGain: 0.60, bandGain: 0 },
    calibration080: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 411, bandIndex: 4, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, auditionGain: 0.80, bandGain: 0 },
    calibration100: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 411, bandIndex: 4, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, auditionGain: 1.00, bandGain: 0 },
    local44100: { sampleRate: 44100, duration: 1, signal: 'center', frequency: 411, bandIndex: 4, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, bandGain: 0 },
    local29: { sampleRate: 48000, duration: 2, signal: 'center', frequency: 29, bandIndex: 0, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, bandGain: 0 },
    local777: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 777, bandIndex: 5, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, bandGain: 0 },
    local11000: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 11000, bandIndex: 9, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, bandGain: 0 },
    gateOff: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 411, bandIndex: 4, dryWet: 100, localFeedback: false, feedbackAll: false, resonance: 1, bandGain: 0 },
    noiseZero: { sampleRate: 48000, duration: 1, signal: 'noise', frequency: 411, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 0, bandGain: 0 },
    noiseLocal: { sampleRate: 48000, duration: 1, signal: 'noise', frequency: 411, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, bandGain: 0 },
    multiLocal: { sampleRate: 48000, duration: 1, signal: 'multi', frequency: 411, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, bandGain: 0 },
    boostedLocal: { sampleRate: 48000, duration: 1, signal: 'multi', frequency: 411, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, bandGain: 100 },
    dry: { sampleRate: 48000, duration: 1, signal: 'multi', frequency: 411, dryWet: 0, localFeedback: true, feedbackAll: false, resonance: 1, bandGain: 0 },
    halfWet: { sampleRate: 48000, duration: 1, signal: 'multi', frequency: 411, dryWet: 50, localFeedback: true, feedbackAll: false, resonance: 1, bandGain: 0 },
    allZero: { sampleRate: 48000, duration: 1, signal: 'multi', frequency: 411, dryWet: 100, localFeedback: false, feedbackAll: true, resonance: 0, bandGain: 0 },
    all: { sampleRate: 48000, duration: 1, signal: 'multi', frequency: 411, dryWet: 100, localFeedback: false, feedbackAll: true, resonance: 1, bandGain: 0 },
    drive16FloorNegative: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 411, bandIndex: 4, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, bandGain: 0, drive: 16, floor: -0.02 },
    drive16FloorNegativeRestart: { sampleRate: 48000, duration: 1, signal: 'center', frequency: 411, bandIndex: 4, dryWet: 100, localFeedback: true, feedbackAll: false, resonance: 1, bandGain: 0, preserveDrive: true, preserveFloor: true }
  };
  const result = {};
  for (const [name, config] of Object.entries(cases)) result[name] = await renderFromUi(config);

  for (const [name, measurement] of Object.entries(result)) {
    expect(measurement.diagnostics, `${name} did not receive AudioWorklet diagnostics.`).toBeTruthy();
    expect(measurement.rightDiagnostics, `${name} did not receive right-channel AudioWorklet diagnostics.`).toBeTruthy();
  }
  const diagnosticsRms = diagnostics => Math.sqrt(diagnostics.wetEnergy / diagnostics.frameCount);
  const nonlinearResidualRms = diagnostics => Math.sqrt(diagnostics.nonlinearResidualEnergy[4] / diagnostics.sampleCount);
  const db = ratio => 20 * Math.log10(Math.max(ratio, 1e-20));
  const localWetDifferenceDb = db(diagnosticsRms(result.local.diagnostics) / diagnosticsRms(result.zero.diagnostics));
  const localFinalDifferenceDb = db(result.local.finalRms / result.zero.finalRms);
  const broadbandFinalDifferenceDb = db(result.noiseLocal.finalRms / result.noiseZero.finalRms);
  const allFinalDifferenceDb = db(result.all.finalRms / result.allZero.finalRms);

  expect(result.local.processorOptions.positiveResonanceAuditionGain).toBe(0.1);
  expect(result.local.processorOptions.enableNonlinearPositiveResonator).toBeTruthy();
  expect(result.local.processorOptions.positiveResonanceDrive).toBe(1);
  expect(result.local.processorOptions.resonatorDampingFloor).toBe(0.1);
  expect(result.local.processorOptions.feedbackBandLeft[4]).toBe(false);
  expect(result.local.workletMessages).toContainEqual({ type: 'set-band-feedback', channel: 'left', index: 4, enabled: true });
  expect(result.local.workletMessages).toContainEqual({ type: 'set-band-feedback', channel: 'right', index: 4, enabled: true });
  expect(result.local.workletMessages).toContainEqual({ type: 'set-resonance', value: 1 });
  expect(result.local.workletMessages).toContainEqual({ type: 'set-positive-resonance-audition-gain', value: 0.1 });
  expect(result.local.workletMessages).toContainEqual({ type: 'set-positive-resonance-drive', value: 1 });
  expect(result.local.workletMessages).toContainEqual({ type: 'set-positive-resonance-damping-floor', value: 0.1 });
  expect(result.local.diagnostics.localGates[4]).toBeCloseTo(1, 5);
  expect(result.local.diagnostics.resonatorMagnitudes[4]).toBeCloseTo(1, 5);
  expect(result.local.diagnostics.resonatorDampingScales[4]).toBeCloseTo(0.1, 5);
  expect(result.local.diagnostics.resonatorAuditionGates[4]).toBeCloseTo(1, 5);
  expect(result.local.diagnostics.positiveResonanceAuditionGain).toBeCloseTo(0.1, 5);
  expect(result.local.diagnostics.nonlinearEnabled).toBeTruthy();
  expect(result.local.diagnostics.nonlinearDrive).toBeCloseTo(1, 5);
  expect(result.local.diagnostics.nonlinearDriveTarget).toBe(1);
  expect(result.local.rightDiagnostics.localGates[4]).toBeCloseTo(1, 5);
  expect(result.local.rightDiagnostics.resonatorMagnitudes[4]).toBeCloseTo(1, 5);
  expect(result.local.rightDiagnostics.resonatorDampingScales[4]).toBeCloseTo(0.1, 5);
  expect(result.local.diagnostics.nonlinearBandPeak[4]).toBeGreaterThan(1e-4);
  expect(result.local.diagnostics.nonlinearResidualPeak[4]).toBeGreaterThan(1e-4);
  expect(Math.sqrt(result.local.diagnostics.nonlinearResidualEnergy[4] / result.local.diagnostics.sampleCount)).toBeGreaterThan(1e-5);
  expect(Number.isFinite(localWetDifferenceDb)).toBeTruthy();
  expect(Number.isFinite(localFinalDifferenceDb)).toBeTruthy();
  expect(result.gateOff.diagnostics.nonlinearResidualPeak[4]).toBeLessThanOrEqual(1e-7);
  expect(Math.abs(db(result.gateOff.finalRms / result.zero.finalRms))).toBeLessThan(0.2);
  // A phase-coherent residual may add or subtract at the output. Its actual
  // presence is asserted above from the Worklet diagnostic and by the direct
  // production-path test; total RMS is not a valid monotonic loudness proxy.
  expect(Number.isFinite(broadbandFinalDifferenceDb)).toBeTruthy();
  expect(Math.abs(broadbandFinalDifferenceDb)).toBeGreaterThan(1e-5);
  expect(Math.abs(db(result.multiLocal.finalRms / result.dry.finalRms))).toBeGreaterThan(1e-5);
  expect(result.boostedLocal.finalRms).toBeGreaterThan(result.multiLocal.finalRms);
  expect(Number.isFinite(result.halfWet.finalRms)).toBeTruthy();
  expect(result.all.finalRms).toBeGreaterThan(result.noiseZero.finalRms);
  expect(allFinalDifferenceDb).toBeGreaterThan(0.01);
  for (const [name, index] of [['local29', 0], ['local777', 5], ['local11000', 9]]) {
    expect(result[name].diagnostics.localGates[index]).toBeCloseTo(1, 5);
    expect(result[name].diagnostics.resonatorMagnitudes[index]).toBeCloseTo(1, 5);
    expect(result[name].diagnostics.resonatorDampingScales[index]).toBeCloseTo(0.1, 5);
    expect(result[name].diagnostics.nonlinearResidualPeak[index]).toBeGreaterThan(1e-4);
  }
  expect(result.local44100.diagnostics.nonlinearResidualPeak[4]).toBeGreaterThan(1e-4);
  expect(result.drive16FloorNegative.workletMessages).toContainEqual({ type: 'set-positive-resonance-drive', value: 16 });
  expect(result.drive16FloorNegative.workletMessages).toContainEqual({ type: 'set-positive-resonance-damping-floor', value: -0.02 });
  expect(result.drive16FloorNegative.diagnostics.nonlinearDrive).toBeCloseTo(16, 5);
  expect(result.drive16FloorNegative.diagnostics.resonatorDampingFloor).toBeCloseTo(-0.02, 5);
  expect(result.drive16FloorNegativeRestart.processorOptions.positiveResonanceDrive).toBe(16);
  expect(result.drive16FloorNegativeRestart.processorOptions.resonatorDampingFloor).toBe(-0.02);
  expect(result.drive16FloorNegativeRestart.diagnostics.nonlinearDrive).toBeCloseTo(16, 5);
  expect(result.drive16FloorNegativeRestart.diagnostics.resonatorDampingFloor).toBeCloseTo(-0.02, 5);
  for (const [name, gain] of [['calibration020', 0.2], ['calibration030', 0.3], ['calibration040', 0.4], ['calibration060', 0.6], ['calibration080', 0.8], ['calibration100', 1]]) {
    expect(result[name].workletMessages).toContainEqual({ type: 'set-positive-resonance-audition-gain', value: gain });
    expect(result[name].diagnostics.positiveResonanceAuditionGain).toBeCloseTo(gain, 5);
    expect(result[name].diagnostics.nonlinearResidualPeak[4]).toBeGreaterThan(1e-4);
  }
  for (const measurement of Object.values(result)) expect(measurement.finite).toBeTruthy();
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);

  console.log(
    `TPT_POSITIVE_E2E center wet=${localWetDifferenceDb.toFixed(2)}dB final=${localFinalDifferenceDb.toFixed(2)}dB `
      + `noise final=${broadbandFinalDifferenceDb.toFixed(3)}dB fbAll=${allFinalDifferenceDb.toFixed(3)}dB `
      + `localResidualRms=${nonlinearResidualRms(result.local.diagnostics).toExponential(3)} `
      + `localFinal=${result.local.finalRms.toExponential(3)} fbAllFinal=${result.all.finalRms.toExponential(3)} `
      + [['29', 'local29', 0], ['411', 'local', 4], ['777', 'local777', 5], ['11000', 'local11000', 9]]
        .map(([frequency, name, index]) => {
          const diagnostics = result[name].diagnostics;
          return `${frequency}:base=${diagnostics.baseBandPeak[index].toExponential(3)},res=${diagnostics.nonlinearBandPeak[index].toExponential(3)},residual=${diagnostics.nonlinearResidualPeak[index].toExponential(3)},after0.1=${(diagnostics.nonlinearResidualPeak[index] * 0.1).toExponential(3)},final=${result[name].finalRms.toExponential(3)}`;
        }).join(' ')
  );
});

test('test-only positive residual audition-gain sweep quantifies broadband audibility without changing production calibration', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const sampleRate = 48000;
    const frameCount = sampleRate;
    const bandCount = window.ResonantState.BAND_COUNT;
    const selectedBand = 4;
    const moduleUrl = new URL('/filterbank-processor.js', window.location.href).href;
    const buildInput = context => {
      const buffer = context.createBuffer(2, frameCount, sampleRate);
      let state = 0x5f3759df;
      for (let channel = 0; channel < 2; channel += 1) {
        const output = buffer.getChannelData(channel);
        for (let frame = 0; frame < frameCount; frame += 1) {
          state = (1664525 * state + 1013904223) >>> 0;
          const noise = (state / 0xffffffff) * 2 - 1;
          const time = frame / sampleRate;
          output[frame] = 0.003 * noise + 0.003 * Math.sin(2 * Math.PI * 411 * time + channel * 0.31);
        }
      }
      return buffer;
    };
    const render = async ({ resonance, auditionGain }) => {
      const context = new OfflineAudioContext(2, frameCount, sampleRate);
      await context.audioWorklet.addModule(moduleUrl);
      const source = context.createBufferSource();
      source.buffer = buildInput(context);
      const node = new AudioWorkletNode(context, window.Filterbank.PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        processorOptions: {
          bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES],
          bandQs: [...window.Filterbank.BAND_QS],
          bandGainLeft: Array(bandCount).fill(0),
          bandGainRight: Array(bandCount).fill(0),
          feedbackBandLeft: Array.from({ length: bandCount }, (_, index) => index === selectedBand),
          feedbackBandRight: Array.from({ length: bandCount }, (_, index) => index === selectedBand),
          feedbackAllLeft: false,
          feedbackAllRight: false,
          resonance,
          maxBandGainDb: 12,
          smoothingTime: 0.015,
          feedbackGateSmoothingTime: 0.008,
          resonanceSmoothingTime: 0.015,
          feedbackAllNormalization: 1 / Math.sqrt(bandCount),
          maxFeedbackGain: 1.25,
          maxAuditionGain: 0.25,
          resonatorDampingFloor: 0.1,
          positiveResonanceAuditionGain: auditionGain,
          enableNonlinearPositiveResonator: true,
          positiveResonanceDrive: 1,
          positiveResonanceDriveSmoothingTime: 0.015
        }
      });
      source.connect(node);
      node.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      let energy = 0;
      let residualEnergy = 0;
      let peak = 0;
      let finite = true;
      const channel = output.getChannelData(0);
      const input = source.buffer.getChannelData(0);
      for (let frame = 0; frame < channel.length; frame += 1) {
        energy += channel[frame] * channel[frame];
        const residual = channel[frame] - input[frame];
        residualEnergy += residual * residual;
        peak = Math.max(peak, Math.abs(channel[frame]));
        finite = finite && Number.isFinite(channel[frame]);
      }
      return {
        rms: Math.sqrt(energy / channel.length),
        residualRms: Math.sqrt(residualEnergy / channel.length),
        peak,
        finite
      };
    };

    const baseline = await render({ resonance: 0, auditionGain: 0.1 });
    const gains = [0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1];
    const values = {};
    for (const auditionGain of gains) values[auditionGain] = await render({ resonance: 1, auditionGain });
    const db = value => 20 * Math.log10(Math.max(value, 1e-20));
    return {
      baseline,
      values,
      dbChange: Object.fromEntries(gains.map(gain => [gain, db(values[gain].rms / baseline.rms)]))
    };
  });

  expect(result.baseline.finite).toBeTruthy();
  let previousResidualRms = result.baseline.residualRms;
  for (const gain of [0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1]) {
    expect(result.values[gain].finite).toBeTruthy();
    expect(result.values[gain].residualRms).toBeGreaterThan(previousResidualRms);
    previousResidualRms = result.values[gain].residualRms;
  }
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `JavaScript page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  console.log(`TPT_POSITIVE_AUDITION_SWEEP baseline=${result.baseline.rms.toExponential(3)} ${[0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1].map(gain => `${gain}:${result.dbChange[gain].toFixed(3)}dB`).join(' ')}`);
});
