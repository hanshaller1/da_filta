const { test, expect } = require('playwright/test');

const renderOutputPath = (page, options) => page.evaluate(async settings => {
  const rate = settings.sampleRate || 48000;
  const length = Math.round(rate * (settings.duration || .3));
  const context = new OfflineAudioContext(2, length, rate);
  await context.audioWorklet.addModule('/output-guard-processor.js');
  await context.audioWorklet.addModule('/output-protection-processor.js');
  const source = context.createBufferSource();
  source.buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = source.buffer.getChannelData(channel);
    for (let frame = 0; frame < length; frame += 1) {
      data[frame] = settings.kind === 'burst' && frame >= Math.round(rate * .1)
        ? .1 : channel === 1 ? (settings.right ?? settings.left ?? 4) : (settings.left ?? 4);
    }
  }
  if (settings.invalidInput) {
    source.buffer.getChannelData(0)[0] = NaN;
    source.buffer.getChannelData(1)[1] = Infinity;
  }
  const guardMessages = [];
  const safetyMessages = [];
  const guard = new AudioWorkletNode(context, 'da-filta-output-guard', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
    channelCount: 2, channelCountMode: 'explicit',
    processorOptions: { enabled: settings.guardEnabled !== false, threshold: settings.guardThreshold ?? .5,
      attackMs: settings.attackMs ?? 2, releaseMs: settings.releaseMs ?? 250, telemetryEnabled: true }
  });
  const safety = new AudioWorkletNode(context, 'da-filta-output-protection', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
    channelCount: 2, channelCountMode: 'explicit',
    processorOptions: { enabled: settings.safetyEnabled !== false, threshold: settings.safetyThreshold ?? .8,
      softness: settings.safetySoftness ?? 1, telemetryEnabled: true }
  });
  guard.port.onmessage = event => { if (event.data?.type === 'output-guard-telemetry') guardMessages.push(event.data); };
  safety.port.onmessage = event => { if (event.data?.type === 'output-protection-telemetry') safetyMessages.push(event.data); };
  source.connect(guard); guard.connect(safety); safety.connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  await new Promise(resolve => setTimeout(resolve, 0));
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(1);
  let steadyLeft = 0;
  let steadyRight = 0;
  let maxFinal = 0;
  let nonFinite = 0;
  for (let frame = 0; frame < length; frame += 1) {
    if (!Number.isFinite(left[frame]) || !Number.isFinite(right[frame])) nonFinite += 1;
    maxFinal = Math.max(maxFinal, Math.abs(left[frame]), Math.abs(right[frame]));
    if (frame >= Math.floor(length * .9)) {
      steadyLeft += Math.abs(left[frame]);
      steadyRight += Math.abs(right[frame]);
    }
  }
  const steadyFrames = length - Math.floor(length * .9);
  const probes = Object.fromEntries((settings.probeTimes || []).map(time => [String(time), {
    left: left[Math.min(length - 1, Math.round(rate * time))],
    right: right[Math.min(length - 1, Math.round(rate * time))]
  }]));
  return { steadyLeft: steadyLeft / steadyFrames, steadyRight: steadyRight / steadyFrames,
    maxFinal, nonFinite, probes, guardMessages, safetyMessages };
}, options);

test('guard and final safety remain independent and reduce sustained 4 FS at the actual final output', async ({ page }) => {
  await page.goto('/');
  const on = await renderOutputPath(page, { left: 4, right: 4, guardThreshold: .5 });
  const guardOff = await renderOutputPath(page, { left: 4, right: 4, guardEnabled: false, guardThreshold: .5 });
  const safetyOff = await renderOutputPath(page, { left: 4, right: 4, safetyEnabled: false, guardThreshold: .5 });
  const bothOff = await renderOutputPath(page, { left: 4, right: 4, guardEnabled: false, safetyEnabled: false });
  const lastGuardOn = on.guardMessages.at(-1);
  const lastSafetyOn = on.safetyMessages.at(-1);
  const lastGuardOff = guardOff.guardMessages.at(-1);
  const lastSafetyGuardOff = guardOff.safetyMessages.at(-1);
  expect(on.steadyLeft).toBeCloseTo(.5, 2);
  expect(on.steadyRight).toBeCloseTo(.5, 2);
  expect(on.maxFinal).toBeLessThanOrEqual(.99001);
  expect(lastGuardOn.inPeakLeft).toBeCloseTo(4, 3);
  expect(lastGuardOn.outPeakLeft).toBeCloseTo(.5, 2);
  expect(lastGuardOn.gainReductionDb).toBeGreaterThan(17);
  expect(lastGuardOn.activePercent).toBe(100);
  expect(lastSafetyOn.gainReductionDb).toBe(0);
  expect(lastSafetyOn.postPeakLeft).toBeCloseTo(.5, 2);
  expect(guardOff.steadyLeft).toBeGreaterThan(.98);
  expect(guardOff.maxFinal).toBeLessThanOrEqual(.99001);
  expect(lastGuardOff.outPeakLeft).toBeCloseTo(4, 3);
  expect(lastGuardOff.gainReductionDb).toBe(0);
  expect(lastSafetyGuardOff.gainReductionDb).toBeGreaterThan(10);
  expect(lastSafetyGuardOff.postPeakLeft).toBeGreaterThan(.98);
  expect(20 * Math.log10(guardOff.steadyLeft / on.steadyLeft)).toBeGreaterThan(5.5);
  expect(safetyOff.steadyLeft).toBeCloseTo(.5, 2);
  expect(safetyOff.maxFinal).toBeGreaterThan(.99);
  expect(bothOff.steadyLeft).toBeCloseTo(4, 2);
  expect(bothOff.maxFinal).toBeCloseTo(4, 2);
  expect([on, guardOff, safetyOff, bothOff].every(result => result.nonFinite === 0)).toBe(true);
  console.log('OUTPUT_GUARD_4FS=' + JSON.stringify({ on: { master: lastGuardOn.inPeakLeft, guardOut: lastGuardOn.outPeakLeft, guardGr: lastGuardOn.gainReductionDb, final: lastSafetyOn.postPeakLeft }, off: { master: lastGuardOff.inPeakLeft, guardOut: lastGuardOff.outPeakLeft, guardGr: lastGuardOff.gainReductionDb, final: lastSafetyGuardOff.postPeakLeft } }));
});

test('attack, release and stereo link behave across 44.1, 48 and 96 kHz', async ({ page }) => {
  await page.goto('/');
  for (const sampleRate of [44100, 48000, 96000]) {
    const attacks = [];
    for (const attackMs of [.1, 2, 10, 50]) {
      const result = await renderOutputPath(page, { sampleRate, left: 4, right: 4,
        guardThreshold: .5, attackMs, safetyEnabled: false, probeTimes: [.001, .02] });
      attacks.push(result);
      expect(result.nonFinite).toBe(0);
      expect(result.guardMessages.length).toBeGreaterThan(0);
    }
    expect(attacks[0].probes['0.001'].left).toBeLessThan(attacks[1].probes['0.001'].left);
    expect(attacks[1].probes['0.001'].left).toBeLessThan(attacks[2].probes['0.001'].left);
    expect(attacks[2].probes['0.001'].left).toBeLessThan(attacks[3].probes['0.001'].left);
    expect(attacks[0].probes['0.02'].left).toBeCloseTo(.5, 2);
    expect(attacks[1].probes['0.02'].left).toBeCloseTo(.5, 2);
    const linked = await renderOutputPath(page, { sampleRate, left: 2, right: .2, safetyEnabled: false });
    expect(linked.steadyLeft).toBeCloseTo(.5, 2);
    expect(linked.steadyRight).toBeCloseTo(.05, 2);
    expect(linked.steadyLeft / linked.steadyRight).toBeCloseTo(10, 3);
    const minimumThreshold = await renderOutputPath(page, { sampleRate, left: 4, right: 4,
      guardThreshold: .25, attackMs: .1, safetyEnabled: false });
    expect(minimumThreshold.steadyLeft).toBeCloseTo(.25, 2);
    expect(minimumThreshold.nonFinite).toBe(0);
    const releases = [];
    for (const releaseMs of [20, 250, 1000, 2000]) {
      const result = await renderOutputPath(page, { sampleRate, kind: 'burst', left: 4, right: 4,
        releaseMs, safetyEnabled: false, duration: 1.2, probeTimes: [.09, .15, .35, 1.1] });
      releases.push(result);
      expect(result.probes['0.09'].left).toBeCloseTo(.5, 2);
      expect(result.probes['1.1'].left).toBeGreaterThan(result.probes['0.15'].left);
      expect(result.guardMessages.length).toBeGreaterThanOrEqual(17);
      expect(result.guardMessages.length).toBeLessThanOrEqual(19);
      expect(result.safetyMessages.length).toBeGreaterThanOrEqual(17);
      expect(result.safetyMessages.length).toBeLessThanOrEqual(19);
    }
    expect(releases[0].probes['0.15'].left).toBeGreaterThan(releases[1].probes['0.15'].left);
    expect(releases[1].probes['0.15'].left).toBeGreaterThan(releases[2].probes['0.15'].left);
    expect(releases[2].probes['0.15'].left).toBeGreaterThan(releases[3].probes['0.15'].left);
    expect(releases[0].probes['0.35'].left).toBeCloseTo(.1, 2);
    const transparent = await renderOutputPath(page, { sampleRate, left: .3, right: .2, guardThreshold: .5, invalidInput: true });
    expect(transparent.steadyLeft).toBeCloseTo(.3, 3);
    expect(transparent.steadyRight).toBeCloseTo(.2, 3);
    expect(transparent.nonFinite).toBe(0);
  }
});

test('AudioEngine runtime controls drive the real Master → Guard → Safety path', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-audio-source="sample"]').click();
  await expect(page.locator('[data-audio-input]')).toHaveValue('full-drums-145');
  await page.locator('[data-response-mode="dev-lab"]').click();
  const outputGroup = page.locator('[data-dev-lab-group="output"]');
  await outputGroup.locator('.dev-lab-collapse-toggle').click();
  const guardEnabled = outputGroup.locator('[data-output-guard-enabled]');
  const guardThreshold = outputGroup.locator('[data-output-guard-threshold]');
  const guardAttack = outputGroup.locator('[data-output-guard-attack-ms]');
  const guardRelease = outputGroup.locator('[data-output-guard-release-ms]');
  const safetyEnabled = outputGroup.locator('[data-output-protection-enabled]');
  await guardThreshold.fill('0.5');
  await page.locator('[data-control="volume"]').fill('0');
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON', { timeout: 15000 });
  await page.waitForFunction(() => window.FilterbankDebugConsole.getOutputGuard()?.gainReductionDb > 0, null, { timeout: 5000 });
  const fullDrums = await page.evaluate(() => window.FilterbankDebugConsole.getOutputGuard());
  expect(fullDrums.inPeakLeft).toBeGreaterThan(.5);
  expect(fullDrums.outPeakLeft).toBeLessThan(fullDrums.inPeakLeft);
  expect(fullDrums.activePercent).toBeGreaterThan(0);

  await page.locator('[data-control="resonance"]').fill('0.5');
  await page.locator('.fb-all-toggle').click();
  expect(await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return [engine.resonance, engine.feedbackAllLeft];
  })).toEqual([.5, true]);
  await page.waitForTimeout(200);
  await page.waitForFunction(() => Number.isFinite(window.FilterbankDebugConsole.getOutputGuard()?.inPeakLeft)
    && Number.isFinite(window.FilterbankDebugConsole.getOutputProtection()?.postPeakLeft), null, { timeout: 5000 });

  await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    engine.dryGainNode.disconnect(engine.mixBus);
    engine.wetGainNode.disconnect(engine.mixBus);
    const source = engine.context.createConstantSource();
    source.offset.value = 4;
    source.connect(engine.mixBus);
    source.start();
    window.__outputGuardProbe = source;
  });
  await page.waitForFunction(() => {
    const guard = window.FilterbankDebugConsole.getOutputGuard();
    const safety = window.FilterbankDebugConsole.getOutputProtection();
    return guard?.inPeakLeft > 3.99 && Math.abs(guard.outPeakLeft - .5) < .03
      && guard.gainReductionDb > 17 && safety?.postPeakLeft < .6 && safety.gainReductionDb === 0;
  }, null, { timeout: 5000 });
  const on = await page.evaluate(() => ({ guard: window.FilterbankDebugConsole.getOutputGuard(), safety: window.FilterbankDebugConsole.getOutputProtection() }));

  const offStarted = Date.now();
  await guardEnabled.selectOption('off');
  await page.waitForFunction(() => {
    const guard = window.FilterbankDebugConsole.getOutputGuard();
    const safety = window.FilterbankDebugConsole.getOutputProtection();
    return guard?.enabledMix < 1e-7 && guard.outPeakLeft > 3.9 && guard.gainReductionDb === 0
      && safety?.prePeakLeft > 3.9 && safety.postPeakLeft > .98;
  }, null, { timeout: 5000 });
  const guardOffMs = Date.now() - offStarted;
  expect(guardOffMs).toBeLessThan(750);
  const off = await page.evaluate(() => ({ guard: window.FilterbankDebugConsole.getOutputGuard(), safety: window.FilterbankDebugConsole.getOutputProtection() }));
  expect(off.safety.gainReductionDb).toBeGreaterThan(10);

  await safetyEnabled.selectOption('off');
  await page.waitForFunction(() => {
    const safety = window.FilterbankDebugConsole.getOutputProtection();
    return safety?.postPeakLeft > 3.9 && safety.gainReductionDb === 0 && safety.activePercent === 0;
  }, null, { timeout: 5000 });
  const guardOnStarted = Date.now();
  await guardEnabled.selectOption('on');
  await page.waitForFunction(() => {
    const guard = window.FilterbankDebugConsole.getOutputGuard();
    const safety = window.FilterbankDebugConsole.getOutputProtection();
    return guard?.enabledMix > .999 && Math.abs(guard.outPeakLeft - .5) < .03
      && Math.abs(safety?.postPeakLeft - .5) < .03 && safety.gainReductionDb === 0;
  }, null, { timeout: 5000 });
  const guardOnMs = Date.now() - guardOnStarted;
  expect(guardOnMs).toBeLessThan(750);

  await guardThreshold.fill('0.95');
  await guardAttack.fill('10');
  await guardRelease.fill('1000');
  await page.waitForFunction(() => {
    const guard = window.FilterbankDebugConsole.getOutputGuard();
    return guard?.threshold === .95 && guard.attackMs === 10 && guard.releaseMs === 1000
      && Math.abs(guard.outPeakLeft - .95) < .03;
  }, null, { timeout: 5000 });

  // Save and restore both output stages while the real engine is processing audio.
  const safetyThreshold = outputGroup.locator('[data-output-protection-threshold]');
  const safetySoftness = outputGroup.locator('[data-output-protection-softness]');
  await safetyEnabled.selectOption('on');
  await safetyThreshold.fill('0.65');
  await safetySoftness.fill('25');
  await guardThreshold.fill('0.6');
  await guardAttack.fill('10');
  await guardRelease.fill('1000');
  await guardEnabled.selectOption('off');
  await safetyEnabled.selectOption('off');
  const sweetspotsToggle = page.locator('[data-dev-lab-group="sweetspots"] .dev-lab-collapse-toggle');
  if (await sweetspotsToggle.getAttribute('aria-expanded') === 'false') await sweetspotsToggle.click();
  await page.locator('[data-sweetspot-save="A"]').click();

  await guardEnabled.selectOption('on');
  await guardThreshold.fill('0.3');
  await guardAttack.fill('0.1');
  await guardRelease.fill('20');
  await safetyEnabled.selectOption('on');
  await safetyThreshold.fill('0.9');
  await safetySoftness.fill('90');
  await page.locator('[data-sweetspot-load="A"]').click();
  await page.waitForFunction(() => {
    const guard = window.FilterbankDebugConsole.getOutputGuard();
    const safety = window.FilterbankDebugConsole.getOutputProtection();
    const engine = window.FilterMode.getAudioEngine();
    return !engine.outputGuardEnabled && !engine.outputProtectionEnabled
      && guard?.enabledMix < 1e-7 && guard.outPeakLeft > 3.9
      && safety?.enabledMix < 1e-7 && safety.postPeakLeft > 3.9;
  }, null, { timeout: 5000 });
  expect(await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return [engine.outputGuardThreshold, engine.outputGuardAttackMs, engine.outputGuardReleaseMs,
      engine.outputProtectionThreshold, engine.outputProtectionSoftness];
  })).toEqual([.6, 10, 1000, .65, 25]);

  console.log('OUTPUT_GUARD_LIVE=' + JSON.stringify({ fullDrums: { inPeak: fullDrums.inPeakLeft, outPeak: fullDrums.outPeakLeft, gr: fullDrums.gainReductionDb, activity: fullDrums.activePercent },
    on: { master: on.guard.inPeakLeft, guardOut: on.guard.outPeakLeft, final: on.safety.postPeakLeft },
    off: { master: off.guard.inPeakLeft, guardOut: off.guard.outPeakLeft, final: off.safety.postPeakLeft }, guardOffMs, guardOnMs }));
  await page.evaluate(() => { window.__outputGuardProbe?.stop(); window.__outputGuardProbe?.disconnect(); });
  await page.locator('[data-audio-stop]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('OFF');
});

test('OUTPUT controls and snapshots restore guard values while legacy snapshots use defaults', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const group = page.locator('[data-dev-lab-group="output"]');
  await expect(group.locator('.dev-lab-collapse-toggle')).toHaveAttribute('aria-expanded', 'false');
  await group.locator('.dev-lab-collapse-toggle').click();
  const enabled = group.locator('[data-output-guard-enabled]');
  const threshold = group.locator('[data-output-guard-threshold]');
  const attack = group.locator('[data-output-guard-attack-ms]');
  const release = group.locator('[data-output-guard-release-ms]');
  await expect(enabled).toHaveValue('on');
  await expect(threshold).toHaveValue('0.8');
  await expect(attack).toHaveValue('2');
  await expect(release).toHaveValue('250');
  expect(await group.locator('label > span').allTextContents()).toEqual([
    'OUTPUT GUARD', 'GUARD THRESHOLD', 'ATTACK', 'RELEASE', 'FINAL SAFETY', 'SAFETY KNEE START', 'SOFTNESS'
  ]);
  await threshold.fill('0.5');
  await attack.fill('10');
  await release.fill('1000');
  await page.locator('[data-dev-lab-group="sweetspots"] .dev-lab-collapse-toggle').click();
  await page.locator('[data-sweetspot-save="A"]').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('da-filta-sweetspots-v1')).slots.A.state);
  expect(saved).toMatchObject({ outputGuardEnabled: true, outputGuardThreshold: .5, outputGuardAttackMs: 10, outputGuardReleaseMs: 1000 });
  await threshold.fill('0.9');
  await attack.fill('50');
  await release.fill('2000');
  await enabled.selectOption('off');
  await page.locator('[data-sweetspot-load="A"]').click();
  await expect(enabled).toHaveValue('on');
  await expect(threshold).toHaveValue('0.5');
  await expect(attack).toHaveValue('10');
  await expect(release).toHaveValue('1000');

  await page.evaluate(() => {
    localStorage.setItem('da-filta-sweetspots-v1', JSON.stringify({ version: 1, slots: {
      A: { name: 'Legacy', state: { outputProtectionEnabled: true, outputProtectionThreshold: .8, outputProtectionSoftness: 100 } },
      B: null, C: null, D: null
    } }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-dev-lab-group="output"] .dev-lab-collapse-toggle').click();
  await page.locator('[data-dev-lab-group="sweetspots"] .dev-lab-collapse-toggle').click();
  await page.locator('[data-output-guard-threshold]').fill('0.3');
  await page.locator('[data-output-guard-attack-ms]').fill('50');
  await page.locator('[data-output-guard-release-ms]').fill('2000');
  await page.locator('[data-output-guard-enabled]').selectOption('off');
  await page.locator('[data-output-protection-enabled]').selectOption('on');
  await page.locator('[data-output-protection-threshold]').fill('0.6');
  await page.locator('[data-output-protection-softness]').fill('35');
  await page.locator('[data-output-protection-enabled]').selectOption('off');
  await page.locator('[data-sweetspot-load="A"]').click();
  expect(await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return [engine.outputGuardEnabled, engine.outputGuardThreshold, engine.outputGuardAttackMs, engine.outputGuardReleaseMs];
  })).toEqual([true, .8, 2, 250]);
  expect(await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    return [engine.outputProtectionEnabled, engine.outputProtectionThreshold, engine.outputProtectionSoftness];
  })).toEqual([true, .8, 100]);

  await page.evaluate(() => {
    localStorage.setItem('da-filta-sweetspots-v1', JSON.stringify({ version: 1, slots: {
      A: { name: 'Malformed numeric state', state: {
        outputGuardEnabled: 'off', outputGuardThreshold: null, outputGuardAttackMs: 'Infinity', outputGuardReleaseMs: 'invalid',
        outputProtectionEnabled: 'off', outputProtectionThreshold: null, outputProtectionSoftness: 'invalid'
      } }, B: null, C: null, D: null
    } }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-dev-lab-group="output"] .dev-lab-collapse-toggle').click();
  await page.locator('[data-dev-lab-group="sweetspots"] .dev-lab-collapse-toggle').click();
  await page.locator('[data-sweetspot-load="A"]').click();
  expect(await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    const values = [engine.outputGuardThreshold, engine.outputGuardAttackMs, engine.outputGuardReleaseMs,
      engine.outputProtectionThreshold, engine.outputProtectionSoftness];
    return [values.every(Number.isFinite), engine.outputProtectionEnabled, ...values];
  })).toEqual([true, true, .8, 2, 250, .8, 100]);
  expect(await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    engine.setOutputProtectionEnabled(false);
    engine.setOutputProtectionThreshold(.6);
    engine.setOutputProtectionSoftness(35);
    engine.applyState({});
    return [engine.outputProtectionEnabled, engine.outputProtectionThreshold, engine.outputProtectionSoftness];
  })).toEqual([true, .8, 100]);
});
