const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { processorFactory } = require('./helpers/modulation-crossmod.cjs');
const { summarizeNativeRender } = require('./helpers/measure-input-character-full-graph.cjs');
test.use({ viewport: { width: 1440, height: 900 } });

test('stored legacy eight-macro v1 library and A/B snapshots remain readable without startup rewrite', async ({ page }) => {
  await page.goto('/');
  const stored = await page.evaluate(() => {
    const a = window.PresetMode.capture();
    a.macroSources = Array.from({ length: 8 }, (_, i) => ({ id: `macro.${i + 1}`, value: i * 10,
      assignments: [{ id: `old.${i}`, sourceId: `macro.${i + 1}`, targetId: 'global.resonance', amount: 10, channel: 'both', invert: false, enabled: true }] }));
    const b = structuredClone(a); b.macroSources.forEach(source => { source.value += 20; });
    const library = JSON.stringify({ format: 'da_filta-preset-library', version: 1, presets: [
      { id: 'old', format: 'da_filta-preset', version: 1, name: 'Old', state: a }] });
    const snapshots = JSON.stringify({ format: 'da_filta-snapshots', version: 1, slots: { A: a, B: b } });
    localStorage.setItem('da-filta-presets-v1', library); localStorage.setItem('da-filta-snapshots-v1', snapshots);
    return { library, snapshots };
  });
  await page.reload();
  expect(await page.evaluate(() => ({ library: localStorage.getItem('da-filta-presets-v1'), snapshots: localStorage.getItem('da-filta-snapshots-v1') }))).toEqual(stored);
  await page.locator('[data-mode="presets"]').click();
  await page.locator('[data-preset-list]').selectOption('old'); await page.locator('[data-preset-action="load"]').click();
  expect((await page.evaluate(() => window.PresetMode.capture())).macroSources.map(source => source.value)).toEqual([0, 10, 20, 30]);
  await page.locator('[data-preset-morph]').evaluate(input => { input.value = '50'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect((await page.evaluate(() => window.PresetMode.capture())).macroSources.map(source => source.value)).toEqual([10, 20, 30, 40]);
  await expect(page.locator('[data-macro-value="3"]')).toHaveValue('40');
  await page.locator('[data-snapshot-recall="A"]').click();
  await expect(page.locator('[data-macro-value="3"]')).toHaveValue('30');
  await page.locator('[data-mode="mod"]').click();
  await page.evaluate(() => window.PresetMode.apply(window.PresetMode.getState().presets[0].state));
  await expect(page.locator('#mode-mod')).toBeVisible();
  expect(await page.evaluate(() => window.FilterMode.getState().selectedWorkspaceMode)).toBe('mod');
});
const action = (page, name) => page.locator(`[data-preset-action="${name}"]`);
const open = async page => { await page.goto('/'); await page.locator('[data-mode="presets"]').click(); };
const name = (page, value) => page.locator('[data-preset-name]').fill(value);
const setMorph = (page, value) => page.locator('[data-preset-morph]').evaluate((element, value) => {
  element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const state = page => page.evaluate(() => window.PresetMode.capture());
const change = (page, fields) => page.evaluate(fields => window.PresetMode.apply({ ...window.PresetMode.capture(), ...fields }), fields);

test('PRESETS provides an explicit library, read-only INIT, snapshots and keyboard controls @smoke', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await open(page);
  await expect(page.locator('#mode-presets')).toBeVisible(); await expect(page.locator('.mode-placeholder')).toHaveCount(0);
  await expect(page.locator('#mode-presets')).not.toContainText('coming later');
  await expect(action(page, 'update')).toBeDisabled(); await expect(action(page, 'delete')).toBeDisabled(); await expect(action(page, 'rename')).toBeDisabled();
  await expect(page.locator('[data-preset-morph]')).toBeDisabled();
  await page.locator('[data-snapshot-capture="A"]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-snapshot-status="A"]')).toHaveText('CAPTURED');
  await page.locator('[data-snapshot-capture="B"]').focus(); await page.keyboard.press('Space');
  await expect(page.locator('[data-preset-morph]')).toBeEnabled();
  await page.locator('[data-preset-morph]').focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-preset-morph-output]')).toHaveText('1 %');
  await name(page, 'Keyboard'); await action(page, 'save').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-preset-selected-name]')).toHaveText('Keyboard');
  expect(errors).toEqual([]);
});

test('complex product capture/load preserves every base and excluded session, safety and DEV configuration', async ({ page }) => {
  await open(page);
  const expected = await page.evaluate(() => {
    const api = window.PresetMode, engine = api.getAudioEngine(), base = api.capture();
    Object.assign(base, { inputGainDb: 7, inputPreampStage: 'tube', inputCharacterAmount: 76, resonance: .37, dryWet: 79,
      filterEnabled: true, filterType: 'bell', filterBellFrequencyHz: 2300, filterGainDb: -5, filterResonance: 30,
      dynamicEqEnabled: true, dynamicEqThresholdDb: -31, dynamicEqDetectorMode: 'peak', detectorReferenceMode: 'REL',
      learnedReferenceValid: true, learnedReferenceFrozen: true, perChannelBands: true });
    base.bandGainLeft = Array.from({ length: 10 }, (_, i) => i * 10 - 50); base.bandGainRight = [...base.bandGainLeft].reverse();
    base.bandChannelLinked[2] = true; base.feedbackBandLeft[4] = true; base.feedbackBandRight[6] = true; base.feedbackAllLeft = true;
    base.lfoModuleEnabled = true; base.envelopeModuleEnabled = true;
    base.lfoSources.forEach((source, i) => Object.assign(source, { enabled: true, rateHz: i + .4, waveform: 'triangle',
      assignments: [{ id: `lfo.${i}`, sourceId: source.id, targetId: 'filter.frequencyHz', amount: -30, channel: 'both', invert: true, enabled: true }] }));
    base.envelopeSources.forEach((source, i) => Object.assign(source, { enabled: true, detectorMode: 'rms', attack: 10 + i,
      assignments: [{ id: `env.${i}`, sourceId: source.id, targetId: 'lfo.2.rate', amount: 20, channel: 'both', invert: false, enabled: true }] }));
    base.clockMod.enabled = true; base.clockMod.modulationGain = 40; base.clockMod.lockedBands[7] = true;
    base.macroSources.forEach((source, i) => Object.assign(source, { value: i * 12,
      assignments: [{ id: `macro.${i}`, sourceId: source.id, targetId: i === 7 ? 'lost.target' : 'filterbank.band.4.gainDb', amount: 40,
        channel: i === 7 ? 'right' : 'spread', invert: true, enabled: i !== 6 }] }));
    engine.setVolumeDb(-19); engine.setOutputGuardThreshold(.67); engine.setOutputProtectionSoftness(43); engine.setFeedbackCore('current');
    api.apply(base); return api.capture();
  });
  await name(page, 'Complex'); await action(page, 'save').click(); await change(page, { resonance: 0, filterType: 'lowpass', inputPreampStage: 'linear' });
  const before = await page.evaluate(() => ({ engine: window.PresetMode.getAudioEngine().getState(),
    theme: document.body.dataset.theme, midi: localStorage.getItem('da-filta-midi-clock-v1'), keyboard: localStorage.getItem('da-filta-keyboard-preferences-v1'),
    analyzer: window.AnalyzerDisplay?.getState?.(), workspace: window.FilterMode.getState().selectedWorkspaceMode }));
  await action(page, 'load').click(); expect(await state(page)).toEqual(expected);
  const after = await page.evaluate(() => ({ engine: window.PresetMode.getAudioEngine().getState(), theme: document.body.dataset.theme,
    midi: localStorage.getItem('da-filta-midi-clock-v1'), keyboard: localStorage.getItem('da-filta-keyboard-preferences-v1'),
    analyzer: window.AnalyzerDisplay?.getState?.(), workspace: window.FilterMode.getState().selectedWorkspaceMode }));
  for (const key of ['theme', 'midi', 'keyboard', 'analyzer', 'workspace']) expect(after[key]).toEqual(before[key]);
  for (const key of ['volumeDb', 'outputGuardEnabled', 'outputGuardThreshold', 'outputProtectionEnabled', 'outputProtectionSoftness', 'feedbackCore']) expect(after.engine[key]).toEqual(before.engine[key]);
  await page.locator('[data-mode="presets"]').click(); await expect(page.locator('[data-macro-value="3"]')).toHaveValue('36');
  await page.locator('[data-mode="lfo"]').click(); await expect(page.locator('[data-lfo-rate-output]')).toHaveText('0.40 Hz');
  await page.locator('[data-mode="envelope-follower"]').click(); await expect(page.locator('[data-envelope-attack]')).toHaveValue('10');
  await page.locator('[data-mode="filter"]').click(); await expect(page.locator('[data-filter-type="bell"]')).toHaveClass(/active/);
});

test('user library selection is silent; save/reload, rename, duplicate, confirmed update/delete and INIT load work', async ({ page }) => {
  await open(page); await change(page, { resonance: .33 }); await name(page, 'Sound'); await action(page, 'save').click();
  const saved = await state(page); await page.reload(); await page.locator('[data-mode="presets"]').click();
  await page.locator('[data-preset-list]').selectOption({ label: 'Sound' }); expect((await state(page)).resonance).toBe(0);
  await action(page, 'load').click(); expect(await state(page)).toEqual(saved);
  await name(page, 'Renamed'); await action(page, 'rename').click(); await name(page, 'Copy'); await action(page, 'duplicate').click();
  await change(page, { resonance: -.43 }); await action(page, 'update').click();
  await page.locator('[data-preset-cancel]').click(); await action(page, 'load').click(); expect((await state(page)).resonance).toBe(.33);
  await change(page, { resonance: -.43 }); await action(page, 'update').click(); await page.locator('[data-preset-confirm]').click();
  await change(page, { resonance: 0 }); await action(page, 'load').click(); expect((await state(page)).resonance).toBe(-.43);
  await action(page, 'delete').click(); await page.locator('[data-preset-confirm]').click();
  await expect(page.locator('[data-preset-list] option')).toHaveCount(2);
  await action(page, 'load').click(); expect(await state(page)).toEqual(await page.evaluate(() => window.PresetMode.contract.init));
  await name(page, 'Renamed'); await action(page, 'save').click(); await expect(page.locator('[data-preset-status]')).toContainText('Name bereits vorhanden');
});

test('snapshot persistence, immutable endpoints, exact non-monotonic morph, discrete switch and matching amount interpolation', async ({ page }) => {
  await open(page);
  const a = await page.evaluate(() => { const base = window.PresetMode.capture(); base.filterEnabled = true; base.filterFrequencyHz = 100;
    base.resonance = -.2; base.macroSources[0].value = 10; base.macroSources[0].assignments = [{ id: 'r', sourceId: 'macro.1', targetId: 'global.resonance', amount: -50, channel: 'both', invert: false, enabled: true }];
    window.PresetMode.apply(base); return window.PresetMode.capture(); });
  await page.locator('[data-snapshot-capture="A"]').click();
  const b = await page.evaluate(() => { const base = window.PresetMode.capture(); base.filterFrequencyHz = 10000; base.filterType = 'highpass'; base.resonance = .8;
    base.macroSources[0].value = 90; base.macroSources[0].assignments[0].amount = 50; base.feedbackBandLeft[4] = true;
    window.PresetMode.apply(base); return window.PresetMode.capture(); });
  await page.locator('[data-snapshot-capture="B"]').click(); await page.reload(); await page.locator('[data-mode="presets"]').click();
  await expect(page.locator('[data-snapshot-status="A"]')).toHaveText('CAPTURED'); await expect(page.locator('[data-snapshot-status="B"]')).toHaveText('CAPTURED');
  for (const percent of [0, 25, 50, 75, 100, 33, 77, 10, 90, 0, 100, 0]) {
    await setMorph(page, percent);
    const expected = await page.evaluate(({ a, b, percent }) => window.PresetMode.contract.interpolatePresetState(a, b, percent), { a, b, percent });
    expect(await state(page)).toEqual(expected);
  }
  await page.locator('[data-snapshot-recall="B"]').click(); expect(await state(page)).toEqual(b);
  await page.locator('[data-snapshot-recall="A"]').click(); expect(await state(page)).toEqual(a);
  expect((await page.evaluate(() => window.PresetMode.getState())).snapshots).toEqual({ A: a, B: b });
});

test('single/library JSON exports import without overwrites, reject bad/future formats and omit runtime/DEV/session data', async ({ page }) => {
  await open(page); await name(page, 'Exchange'); await action(page, 'save').click();
  const exported = [];
  for (const mode of ['export', 'export-library']) {
    const download = page.waitForEvent('download'); await action(page, mode).click();
    const path = test.info().outputPath(`${mode}.json`); await (await download).saveAs(path);
    const data = JSON.parse(fs.readFileSync(path, 'utf8')); exported.push(data);
    const text = JSON.stringify(data); expect(text).not.toMatch(/outputGuard|outputProtection|volumeDb|feedbackCore|runtimePhase|selectedWorkspace|midiStatus/);
    await page.locator('[data-preset-import]').setInputFiles({ name: `${mode}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await expect(page.locator('[data-preset-status]')).toContainText('IMPORTED');
  }
  const library = await page.evaluate(() => window.PresetMode.getState().presets);
  expect(library.map(entry => entry.name)).toEqual(['Exchange', 'Exchange (2)', 'Exchange (3)', 'Exchange (2) (2)']);
  expect(new Set(library.map(entry => entry.id)).size).toBe(4); expect(library.every(entry => JSON.stringify(entry.state) === JSON.stringify(library[0].state))).toBe(true);
  for (const text of ['{', JSON.stringify({ ...exported[0], version: 99 }), JSON.stringify({ format: 'nope', version: 1 })]) {
    await page.locator('[data-preset-import]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(page.locator('[data-preset-status]')).toContainText('IMPORT ERROR');
    expect((await page.evaluate(() => window.PresetMode.getState())).presets).toHaveLength(4);
  }
});

test('blocked localStorage reports persistence failure while the application and in-memory presets remain usable', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException('blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); }; });
  await open(page); await expect(page.locator('[data-preset-status]')).toContainText('nicht lesbar');
  await name(page, 'Memory'); await action(page, 'save').click(); await expect(page.locator('[data-preset-status]')).toContainText('Nicht dauerhaft gespeichert');
  await change(page, { resonance: .5 }); await action(page, 'load').click(); expect((await state(page)).resonance).toBe(0);
  await page.locator('[data-mode="presets"]').click(); await expect(page.locator('[data-macro-value]')).toHaveCount(4);
});

for (const width of [1914, 1440, 1024, 560]) test(`preset controls, full names and snapshots fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await open(page); const longName = 'Long preset name '.repeat(4).slice(0, 64);
  await name(page, longName); await action(page, 'save').click();
  await page.locator('[data-snapshot-capture="A"]').click(); await page.locator('[data-snapshot-capture="B"]').click();
  await setMorph(page, 50); await expect(page.locator('[data-preset-selected-name]')).toHaveText(longName.trim());
  const layout = await page.locator('#mode-presets').evaluate(panel => ({ width: panel.clientWidth, scroll: panel.scrollWidth,
    pageWidth: document.documentElement.clientWidth, pageScroll: document.documentElement.scrollWidth,
    buttons: [...panel.querySelectorAll('button:not(:disabled)')].filter(button => button.getClientRects().length).map(button => { const r = button.getBoundingClientRect(); return { width: r.width, height: r.height }; }),
    name: panel.querySelector('[data-preset-selected-name]').scrollWidth, nameWidth: panel.querySelector('[data-preset-selected-name]').clientWidth,
    snapshots: panel.querySelector('.preset-snapshots').getBoundingClientRect().bottom, morph: panel.querySelector('.preset-morph').getBoundingClientRect().top }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.width); expect(layout.pageScroll).toBeLessThanOrEqual(layout.pageWidth);
  expect(layout.name).toBeLessThanOrEqual(layout.nameWidth); expect(layout.snapshots).toBeLessThanOrEqual(layout.morph);
  for (const button of layout.buttons) { expect(button.height).toBeGreaterThanOrEqual(32); expect(button.width).toBeGreaterThanOrEqual(32); }
  await page.screenshot({ path: test.info().outputPath(`presets-${width}.png`), fullPage: true });
});

test('production processor continuous morph preserves compiled graph, histories and additive LFO/Envelope/Macro modulation', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async code => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), { makeBank } = await import(url); URL.revokeObjectURL(url);
    const engine = window.PresetMode.getAudioEngine(), base = window.PresetMode.capture();
    base.lfoModuleEnabled = true; base.lfoSources[0].enabled = true; base.lfoSources[0].waveform = 'square';
    base.envelopeModuleEnabled = true; base.envelopeSources[0].enabled = true;
    for (const source of [base.lfoSources[0], base.envelopeSources[0], base.macroSources[0]]) source.assignments = [{ id: source.id, sourceId: source.id, targetId: 'global.resonance', amount: 10, channel: 'both', invert: false, enabled: true }];
    base.macroSources[0].value = 50; window.PresetMode.apply(base);
    const bank = makeBank(48000, { modulationState: engine.getModulationState(), bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS] });
    const input = [[new Float32Array(128).fill(.1), new Float32Array(128).fill(.1)]], output = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]];
    for (let i = 0; i < 20; i++) bank.process(input, output);
    const count = bank.modulationCore.compilationCount, graphCount = bank.modulationCore.graphCompilationCount, targets = bank.modulationCore.compiledTargets;
    const phase = bank.lfoSources[0].freePhase, detector = bank.envelopeSources[0].value;
    base.resonance = .2; base.lfoSources[0].assignments[0].amount = 20; window.PresetMode.apply(base, true);
    bank.setModulationBaseValues(engine.getModulationState());
    const unchanged = phase === bank.lfoSources[0].freePhase && detector === bank.envelopeSources[0].value;
    for (let i = 0; i < 20; i++) bank.process(input, output);
    const effective = bank.modulationCore.getEffectiveValue('global.resonance', bank);
    return { unchanged, stable: count === bank.modulationCore.compilationCount && graphCount === bank.modulationCore.graphCompilationCount && targets === bank.modulationCore.compiledTargets,
      base: bank.baseResonance, effective, expected: .2 + .2 + bank.envelopeSources[0].value * .1 + .05 };
  }, processorFactory('http://localhost:3000'));
  expect(result.unchanged).toBe(true); expect(result.stable).toBe(true); expect(result.base).toBe(.2); expect(result.effective).toBeCloseTo(result.expected, 12);
});

test('frozen Dynamic EQ reference restores explicitly while ordinary FREEZE retains its existing live reference', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async code => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); const { makeBank } = await import(url); URL.revokeObjectURL(url);
    const bank = makeBank(48000, { bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS] });
    const first = { dynamicEqEnabled: true, learnedReferenceFrozen: true, learnedReferenceValid: true, learnedReferenceDb: Array(10).fill(-30) };
    bank.setDynamicEq(first); bank.setDynamicEq({ ...first, learnedReferenceDb: Array(10).fill(-60) });
    const ordinary = [...bank.learnedReferenceDb];
    bank.handleMessage({ type: 'set-dynamic-eq', ...first, learnedReferenceDb: Array(10).fill(-60), restoreReference: true });
    return { ordinary, recalled: [...bank.learnedReferenceDb] };
  }, processorFactory('http://localhost:3000'));
  expect(result.ordinary).toEqual(Array(10).fill(-30)); expect(result.recalled).toEqual(Array(10).fill(-60));
});

for (const rate of [48000, 96000]) test(`live morph keeps nodes and safety, compiles only at midpoint crossings and measures callback cost at ${rate}Hz`, async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(rate => { const Original = window.AudioContext; window.AudioContext = class extends Original { constructor(options) { super({ ...options, sampleRate: rate }); } }; }, rate);
  await open(page);
  await page.evaluate(() => {
    const api = window.PresetMode, base = api.capture(); base.filterEnabled = true; base.filterFrequencyHz = 800; base.dynamicEqEnabled = true;
    base.lfoModuleEnabled = true; base.envelopeModuleEnabled = true; base.clockMod.enabled = true; base.clockMod.modulationGain = 10;
    base.lfoSources.forEach((source, i) => Object.assign(source, { enabled: true, rateHz: .7 + i, assignments: [
      { id: `band.${i}`, sourceId: source.id, targetId: `filterbank.band.${i}.gainDb`, amount: 4, channel: 'both', invert: false, enabled: true }] }));
    base.lfoSources[0].assignments.push({ id: 'meta', sourceId: 'lfo.1', targetId: 'lfo.2.rate', amount: 10, channel: 'both', invert: false, enabled: true });
    base.envelopeSources.forEach((source, i) => Object.assign(source, { enabled: true, assignments: [
      { id: `env.${i}`, sourceId: source.id, targetId: `filterbank.band.${i + 5}.gainDb`, amount: 4, channel: 'both', invert: false, enabled: true }] }));
    base.macroSources.forEach((source, i) => Object.assign(source, { value: 20, assignments: [{ id: `macro.${i}`, sourceId: source.id,
      targetId: `filterbank.band.${i}.gainDb`, amount: 4, channel: 'spread', invert: false, enabled: true }] }));
    base.resonance = .1; base.feedbackBandLeft[4] = true; base.feedbackAllLeft = true; base.feedbackAllAmount = 25;
    api.apply(base); api.getAudioEngine().setVolumeDb(-60);
  });
  await page.locator('[data-snapshot-capture="A"]').click();
  await page.evaluate(() => { const api = window.PresetMode, base = api.capture();
    base.filterType = 'highpass'; base.filterFrequencyHz = 3000; base.dynamicEqThresholdDb = -35; base.lfoSources[0].rateHz = 8;
    base.envelopeSources[0].attack = 200; base.macroSources.forEach(source => { source.value = 70; source.assignments[0].amount = 30; }); api.apply(base); });
  await page.locator('[data-snapshot-capture="B"]').click(); await setMorph(page, 0);
  const cdp = await page.context().newCDPSession(page), reports = [], events = [];
  const collect = event => events.push(...event.value); cdp.on('Tracing.dataCollected', collect);
  await cdp.send('Tracing.start', { categories: 'audio,webaudio,disabled-by-default-audio', transferMode: 'ReportEvents' });
  await page.locator('[data-audio-source="sample"]').click(); await page.locator('[data-audio-toggle]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON');
  await page.evaluate(() => { const engine = window.PresetMode.getAudioEngine(); window.presetLiveTest = {
    nodes: [engine.context, engine.source, engine.filterbank.workletNode, engine.inputPreampNode, engine.outputGuardNode, engine.outputProtectionNode],
    editorRows: ['[data-lfo-slot]', '[data-envelope-slot]', '[data-macro-value]', '[data-preset-list] option'].map(selector => document.querySelector(selector)),
    counts: { structural: 0, continuous: 0, writes: 0, errors: 0, editorMutations: 0 } };
    const counts = window.presetLiveTest.counts, post = engine.filterbank.workletNode.port.postMessage.bind(engine.filterbank.workletNode.port);
    const observer = new MutationObserver(changes => { counts.editorMutations += changes.length; });
    document.querySelectorAll('[data-lfo-assignments], [data-envelope-assignments], [data-clock-mod-assignments], [data-macro-assignments]').forEach(list => observer.observe(list, { childList: true, subtree: true }));
    engine.filterbank.workletNode.port.postMessage = message => { if (message.type === 'set-modulation-state') counts.structural++;
      if (message.type === 'set-modulation-base-values') counts.continuous++; post(message); };
    engine.filterbank.workletNode.addEventListener('processorerror', () => counts.errors++);
    const write = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (/^da-filta-(?:presets|snapshots)-v1$/.test(key)) counts.writes++; return write.call(this, key, value); };
  });
  let destinationStarts;
  for (const stage of ['base', 'morph']) {
    if (stage === 'morph') {
      events.length = 0;
      await cdp.send('Tracing.start', { categories: 'audio,webaudio,disabled-by-default-audio', transferMode: 'ReportEvents' });
    }
    if (stage === 'base') await page.waitForTimeout(1500);
    else await page.evaluate(async () => { const input = document.querySelector('[data-preset-morph]');
      for (let i = 1; i <= 120; i++) { input.value = String(Math.round(50 - 50 * Math.cos(i / 120 * 4 * Math.PI)));
        input.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 25)); } });
    const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve)); await cdp.send('Tracing.end'); await complete;
    if (stage === 'base') destinationStarts = events.filter(event => event.name === 'AudioDestination::StartWithWorkletTaskRunner');
    // The same destination stays running in both windows. Reuse its recorded
    // startup metadata; every Render duration is from the current trace window.
    reports.push(...summarizeNativeRender([{ rate, stage: `${stage}@${rate}` }], stage === 'base' ? events : [...destinationStarts, ...events]));
  }
  cdp.off('Tracing.dataCollected', collect);
  await cdp.detach();
  const live = await page.evaluate(() => { const engine = window.PresetMode.getAudioEngine(), previous = window.presetLiveTest;
    const current = [engine.context, engine.source, engine.filterbank.workletNode, engine.inputPreampNode, engine.outputGuardNode, engine.outputProtectionNode];
    return { counts: previous.counts, sameNodes: current.every((node, i) => node === previous.nodes[i]), rate: engine.context.sampleRate,
      status: engine.status, volume: engine.volumeDb, guard: engine.outputGuardEnabled, safety: engine.outputProtectionEnabled,
      sameEditorRows: previous.editorRows.every(row => row?.isConnected),
      snapshot: window.PresetMode.capture(), endpoint: window.PresetMode.getState().snapshots.A }; });
  expect(live.rate).toBe(rate); expect(live.sameNodes).toBe(true); expect(live.sameEditorRows).toBe(true); expect(live.status).toBe('ON');
  expect(live.counts).toMatchObject({ structural: 4, writes: 0, errors: 0, editorMutations: 0 }); expect(live.counts.continuous).toBe(116);
  expect(live).toMatchObject({ volume: -60, guard: true, safety: true }); expect(live.snapshot).toEqual(live.endpoint);
  for (const report of reports) expect(report.blocks).toBeGreaterThan(100);
  fs.writeFileSync(test.info().outputPath(`preset-morph-${rate}.json`), JSON.stringify({ reports, live }, null, 2));
  console.log('PRESET_MORPH_NATIVE=' + JSON.stringify(reports));
  await page.locator('[data-audio-toggle]').click(); await expect(page.locator('[data-audio-status]')).toHaveText('OFF');
});

test('no preset action leaves the full modulated production bank sample-identical with accepted macro commit', async ({ page }) => {
  const reference = file => execFileSync('git', ['show', `4c9bf80:${file}`], { encoding: 'utf8' });
  await page.context().route('**/tests/presets-reference/*', route => route.fulfill({ contentType: 'text/javascript', body: reference(new URL(route.request().url()).pathname.split('/').at(-1)) }));
  const body = reference('filterbank-processor.js'), imports = body.match(/^import .*;$/gm).join('\n').replace(/from '\.\//g, "from 'http://localhost:3000/tests/presets-reference/");
  const before = `${imports}\nexport function makeBank(sampleRate, processorOptions) {
    class AudioWorkletProcessor { constructor() { this.port = { postMessage() {} }; } }
    let Processor; const registerProcessor = (_, Class) => { Processor = Class; };
    ${body.replace(/^import .*;\r?\n/gm, '')} return new Processor({ processorOptions }); }`;
  await page.goto('/');
  const results = await page.evaluate(async ({ before, after }) => {
    const load = async code => { const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); const module = await import(url); URL.revokeObjectURL(url); return module; };
    const old = await load(before), current = await load(after), rows = [], engine = window.PresetMode.getAudioEngine();
    const base = window.PresetMode.capture(); base.filterEnabled = true; base.dynamicEqEnabled = true; base.lfoModuleEnabled = true; base.envelopeModuleEnabled = true;
    base.clockMod.enabled = true; base.clockMod.modulationGain = 10; base.clockMod.internalBpm = 10000;
    base.lfoSources.forEach((source, i) => Object.assign(source, { enabled: true, rateHz: i + 1, assignments: [
      { id: `lfo.${i}`, sourceId: source.id, targetId: `filterbank.band.${i}.gainDb`, amount: 10, channel: 'both', invert: false, enabled: true }] }));
    base.envelopeSources.forEach((source, i) => Object.assign(source, { enabled: true, assignments: [
      { id: `env.${i}`, sourceId: source.id, targetId: `filterbank.band.${i + 5}.gainDb`, amount: 10, channel: 'both', invert: false, enabled: true }] }));
    base.macroSources.forEach((source, i) => Object.assign(source, { value: i * 10, assignments: [
      { id: `macro.${i}`, sourceId: source.id, targetId: `filterbank.band.${i}.gainDb`, amount: 4, channel: 'spread', invert: false, enabled: true }] }));
    // Configure the fixtures through the pre-existing setters. Merely loading
    // the new preset module above must never recall/apply anything.
    engine.applyState({ ...engine.getState(), ...base });
    for (const rate of [48000, 96000]) {
      const options = { ...engine.getFilterbankState(), bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
        resonance: .3, feedbackBandLeft: Array.from({ length: 10 }, (_, i) => i === 4), feedbackAllLeft: true,
        // The frozen reference predates modulation in the ZDF feedback tap; its
        // contract is the explicit FADER ONLY legacy tap (covered separately in
        // filterbank-feedback-tap-modulation.spec.js).
        feedbackTapModulation: 'exclude' };
      const a = old.makeBank(rate, options), b = current.makeBank(rate, options);
      const input = [[new Float32Array(128).fill(.1), new Float32Array(128).fill(.05)]];
      const outA = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]], outB = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]];
      let difference = 0;
      for (let block = 0; block < 256; block++) { a.process(input, outA); b.process(input, outB);
        for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) difference = Math.max(difference, Math.abs(outA[0][c][i] - outB[0][c][i])); }
      rows.push({ rate, difference });
    }
    return rows;
  }, { before, after: processorFactory('http://localhost:3000') });
  expect(results).toEqual([{ rate: 48000, difference: 0 }, { rate: 96000, difference: 0 }]);
});
