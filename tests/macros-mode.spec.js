const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { processorFactory } = require('./helpers/modulation-crossmod.cjs');
const { summarizeNativeRender } = require('./helpers/measure-input-character-full-graph.cjs');

const rows = page => page.locator('[data-macro-assignments] > [data-assignment-id]');
const slider = (locator, value) => locator.evaluate((element, next) => {
  element.value = String(next); element.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const macro = (value, assignments = []) => ({ value, assignments });
const route = (id, targetId, amount = 50, extra = {}) => ({ id, targetId, amount, ...extra });
test.use({ viewport: { width: 1440, height: 900 } });

test('MOD is empty and switching workspaces preserves macro/preset bases and accessible ownership', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-mode="presets"]').click();
  await slider(page.locator('[data-macro-value="3"]'), 73);
  const before = await page.evaluate(() => ({ base: window.PresetMode.capture(), library: window.PresetMode.getState() }));
  await expect(page.getByRole('tab', { name: 'MAKROS', exact: true })).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('tab', { name: 'MOD', exact: true }).click();
    await expect(page.locator('#mode-mod')).toBeVisible();
    await expect(page.locator('#mode-mod')).toBeEmpty();
    await expect(page.locator('#mode-mod input, #mode-mod button, #mode-mod select')).toHaveCount(0);
    expect(await page.evaluate(() => ({ base: window.PresetMode.capture(), library: window.PresetMode.getState() }))).toEqual(before);
    await page.getByRole('tab', { name: 'PRESETS / SNAPSHOTS', exact: true }).click();
    await expect(page.locator('[data-macro-value="3"]')).toHaveValue('73');
  }
  const ownership = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    return { unique: new Set(ids).size === ids.length, tabs: [...document.querySelectorAll('[role=tab]')].every(tab =>
      document.getElementById(tab.getAttribute('aria-controls'))?.getAttribute('aria-labelledby') === tab.id) };
  });
  expect(ownership).toEqual({ unique: true, tabs: true });
  // Exercise the existing navigation entry point with an old workspace ID.
  await page.locator('[data-mode="mod"]').evaluate(tab => { tab.dataset.mode = 'makros'; tab.click(); tab.dataset.mode = 'mod'; });
  expect(await page.evaluate(() => window.FilterMode.getState().selectedWorkspaceMode)).toBe('presets');
  await expect(page.locator('#mode-presets')).toBeVisible();
  await expect(page.locator('[data-macro-slot]')).toHaveCount(4);
  await page.locator('[data-macro-slot="3"]').focus(); await page.keyboard.press('Space');
  await expect(page.locator('[data-macro-slot="3"]')).toBeFocused();
  await expect(page.locator('[data-macro-slot="3"]')).toHaveAttribute('aria-pressed', 'true');
});

test('Combined workspace exposes four manual controls and the shared assignment editor @smoke', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/');
  await page.locator('[data-mode="presets"]').click();
  await expect(page.locator('#mode-presets')).toBeVisible();
  await expect(page.locator('#mode-presets')).not.toContainText('coming later');
  await expect(page.locator('.mode-placeholder')).toHaveCount(0);
  await expect(page.locator('[data-mode="presets"]').locator('xpath=..').locator('.mode-power')).toHaveCount(0);
  await expect(page.locator('[data-macro-value]')).toHaveCount(4);
  const defaults = await page.evaluate(() => window.MacroMode.getState());
  expect(defaults.macroSources.map(source => source.value)).toEqual(Array(4).fill(0));
  expect(defaults.macroSources.map(source => source.assignments)).toEqual(Array(4).fill([]));
  await slider(page.locator('[data-macro-value="0"]'), 50);
  await expect(page.locator('[data-macro-value-output="0"]')).toHaveText('50 %');
  await page.locator('[data-macro-add-assignment]').click();
  const first = rows(page).first();
  await first.locator('[data-macro-target]').selectOption('filterbank.band.4.gainDb');
  await first.locator('[data-macro-channel]').selectOption('spread');
  await slider(first.locator('[data-macro-amount]'), -50);
  await first.locator('[data-macro-assignment-invert]').check();
  const saved = (await page.evaluate(() => window.MacroMode.getState())).macroSources;
  expect(saved[0].assignments[0]).toMatchObject({ amount: -50, channel: 'spread', invert: true, enabled: true });
  await page.locator('[data-macro-slot="3"]').click();
  await expect(page.locator('[data-macro-slot="3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(rows(page)).toHaveCount(0);
  expect((await page.evaluate(() => window.MacroMode.getState())).macroSources).toEqual(saved);
  await page.locator('[data-macro-slot="0"]').focus(); await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(1);
  await first.locator('[data-macro-assignment-enable]').click();
  await expect(first).toHaveAttribute('data-assignment-status', 'assignment-disabled');
  await first.locator('[data-macro-assignment-enable]').click();
  await first.locator('[data-macro-target]').selectOption('global.resonance');
  await expect(first.locator('[data-macro-channel]')).toBeDisabled();
  const registry = await page.evaluate(() => window.LfoMode.getTargetRegistry().map(target => target.id));
  expect(await first.locator('[data-macro-target] option').evaluateAll(options => options.map(option => option.value).filter(Boolean).sort())).toEqual(registry.sort());
  await first.locator('[data-macro-assignment-remove]').click(); await expect(rows(page)).toHaveCount(0);
  await page.locator('[data-macro-add-assignment]').focus(); await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(1);
  await first.locator('[data-macro-assignment-enable]').focus(); await page.keyboard.press('Space');
  expect((await page.evaluate(() => window.MacroMode.getState())).macroSources[0].assignments[0].enabled).toBe(false);
  await first.locator('[data-macro-assignment-remove]').focus(); await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('[data-mode="filterbank"]').click();
  await page.locator('[data-mode="presets"]').click();
  await expect(page.locator('#mode-presets')).toBeVisible();
  expect(errors).toEqual([]);
});

test('macro lost targets retain rows and reactivate, including slot warnings while unselected', async ({ page }) => {
  await page.goto('/'); await page.locator('[data-mode="filter"]').click();
  await page.locator('[data-module-power="filter"]').click();
  await page.locator('[data-mode="presets"]').click(); await page.locator('[data-macro-add-assignment]').click();
  await rows(page).first().locator('[data-macro-target]').selectOption('filter.frequencyHz');
  await slider(rows(page).first().locator('[data-macro-amount]'), 50);
  await slider(page.locator('[data-macro-value="0"]'), 100);
  const saved = (await page.evaluate(() => window.MacroMode.getState())).macroSources[0];
  await expect(rows(page).first()).toHaveAttribute('data-assignment-status', 'active');
  await page.locator('[data-module-power="filter"]').click();
  await expect(rows(page).first()).toHaveAttribute('data-assignment-status', 'target-unavailable');
  await page.locator('[data-module-power="filter"]').click();
  await expect(rows(page).first()).toHaveAttribute('data-assignment-status', 'active');
  await page.locator('[data-mode="filter"]').click(); await page.locator('[data-filter-type="formant"]').click();
  await page.locator('[data-mode="presets"]').click();
  await expect(rows(page).first()).toHaveAttribute('data-assignment-status', 'target-unavailable');
  await page.locator('[data-macro-slot="1"]').click();
  await expect(page.locator('[data-macro-slot="0"]')).toHaveAttribute('data-lost-targets', '1');
  await expect(page.locator('[data-macro-slot="0"]')).toContainText('LOST TARGET');
  await page.locator('[data-mode="filter"]').click(); await page.locator('[data-filter-type="lowpass"]').click();
  await page.locator('[data-mode="presets"]').click(); await page.locator('[data-macro-slot="0"]').click();
  await expect(rows(page).first()).toHaveAttribute('data-assignment-status', 'active');
  expect((await page.evaluate(() => window.MacroMode.getState())).macroSources[0]).toEqual(saved);
  await page.locator('[data-macro-add-assignment]').click();
  await rows(page).nth(1).locator('[data-macro-target]').selectOption('global.spread');
  const spread = (await page.evaluate(() => window.MacroMode.getState())).macroSources[0].assignments[1];
  await expect(rows(page).nth(1)).toHaveAttribute('data-assignment-status', 'active');
  await page.locator('[data-channel-toggle]').click();
  await expect(rows(page).nth(1)).toHaveAttribute('data-assignment-status', 'target-unavailable');
  await page.locator('[data-channel-toggle]').click();
  await expect(rows(page).nth(1)).toHaveAttribute('data-assignment-status', 'active');
  expect((await page.evaluate(() => window.MacroMode.getState())).macroSources[0].assignments[1]).toEqual(spread);
});

test('macro configuration round-trips existing engine and version-1 snapshots; legacy load resets macros only', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('da-filta-sweetspots-v1', JSON.stringify({ version: 1, slots: {
    A: { name: 'macros', state: { macroSources: Array.from({ length: 8 }, (_, index) => ({ value: index * 13,
      assignments: [{ id: `band.${index}`, targetId: 'filterbank.band.4.gainDb', amount: -50, channel: 'spread', invert: true },
        { id: `off.${index}`, targetId: 'lfo.2.rate', amount: 25, enabled: false },
        { id: `lost.${index}`, targetId: 'removed.target', amount: 100 }] })) } },
    B: { name: 'legacy', state: { lfoSources: [{ enabled: true, rateHz: 2, targetId: 'global.resonance', amount: 37 }],
      envelopeSources: [{ enabled: true, attack: 40 }], clockMod: { enabled: true } } }
  } })));
  await page.goto('/'); await page.locator('[data-mode="presets"]').click();
  await page.locator('[data-dev-lab-group="sweetspots"] .dev-lab-collapse-toggle').click();
  await page.locator('[data-sweetspot-load="A"]').click();
  const saved = await page.evaluate(() => window.MacroMode.getState().macroSources);
  expect(saved.map(source => source.value)).toEqual([0, 13, 26, 39]);
  await expect(rows(page).nth(2)).toHaveAttribute('data-assignment-status', 'target-invalid');
  await expect(rows(page).nth(2).locator('[data-macro-target-state]')).toContainText('INVALID');
  const engineRoundtrip = await page.evaluate(() => {
    const engine = window.MacroMode.getAudioEngine(), snapshot = engine.getState();
    engine.applyState({ ...snapshot, macroSources: [] });
    engine.applyState(JSON.parse(JSON.stringify(snapshot)));
    return engine.getState().macroSources;
  });
  expect(engineRoundtrip).toEqual(saved);
  await page.locator('[data-sweetspot-save="C"]').click();
  await slider(page.locator('[data-macro-value="0"]'), 100);
  await rows(page).first().locator('[data-macro-assignment-remove]').click();
  await page.locator('[data-sweetspot-load="C"]').click();
  expect(await page.evaluate(() => window.MacroMode.getState().macroSources)).toEqual(saved);
  await page.locator('[data-sweetspot-load="B"]').click();
  const legacy = await page.evaluate(() => window.MacroMode.getAudioEngine().getState());
  expect(legacy.macroSources.map(source => [source.value, source.assignments])).toEqual(Array(4).fill([0, []]));
  expect(legacy.lfoSources[0]).toMatchObject({ enabled: true, rateHz: 2, amount: 37 });
  expect(legacy.envelopeSources[0]).toMatchObject({ enabled: true, attack: 40 }); expect(legacy.clockMod.enabled).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('da-filta-sweetspots-v1')).version)).toBe(1);
});

for (const width of [1914, 1440, 1024, 560]) test(`macro workspace controls and assignment rows fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto('/');
  await page.locator('[data-mode="presets"]').click();
  for (let index = 0; index < 8; index++) await page.locator('[data-macro-add-assignment]').click();
  const layout = await page.locator('#mode-presets').evaluate(panel => {
    const controls = panel.querySelector('.macro-controls').getBoundingClientRect();
    const editor = panel.querySelector('.macro-assignment-editor').getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    return { width: panel.clientWidth, scroll: panel.scrollWidth, documentWidth: document.documentElement.clientWidth,
      documentScroll: document.documentElement.scrollWidth, controlsBottom: controls.bottom, editorTop: editor.top,
      values: [...panel.querySelectorAll('[data-macro-value]')].map(input => {
        const r = input.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right };
      }), left: rect.left, right: rect.right };
  });
  expect(layout.scroll).toBeLessThanOrEqual(layout.width);
  expect(layout.documentScroll).toBeLessThanOrEqual(layout.documentWidth);
  expect(layout.controlsBottom).toBeLessThanOrEqual(layout.editorTop);
  const seam = await page.evaluate(() => {
    const macro = document.querySelector('.macro-mode-panel'), preset = document.querySelector('.preset-workspace');
    const m = macro.getBoundingClientRect(), p = preset.getBoundingClientRect();
    const workspace = document.querySelector('.mode-workspace');
    return { outerBorder: getComputedStyle(workspace).borderLeftWidth,
      divider: getComputedStyle(preset).borderLeftWidth, stackedDivider: getComputedStyle(preset).borderTopWidth,
      macroRight: m.right, presetLeft: p.left, macroBottom: m.bottom, presetTop: p.top };
  });
  if (width >= 1200) expect(seam.outerBorder).toBe('1px');
  if (width > 600) { expect(seam.divider).toBe('1px'); expect(seam.macroRight).toBeLessThanOrEqual(seam.presetLeft); }
  else { expect(seam.stackedDivider).toBe('1px'); expect(seam.macroBottom).toBeLessThanOrEqual(seam.presetTop); }
  for (const value of layout.values) {
    expect(value.width).toBeGreaterThan(32); expect(value.height).toBeGreaterThanOrEqual(32);
    expect(value.left).toBeGreaterThanOrEqual(layout.left); expect(value.right).toBeLessThanOrEqual(layout.right);
  }
  await page.locator('[data-macro-slot="3"]').click();
  await page.locator('[data-macro-add-assignment]').click();
  await rows(page).first().locator('[data-macro-target]').selectOption('global.resonance');
  await slider(page.locator('[data-macro-value="3"]'), 71);
  await expect(page.locator('[data-macro-value-output="3"]')).toHaveText('71 %');
  await page.screenshot({ path: test.info().outputPath(`macro-${width}.png`), fullPage: true });
});

test('production processor sums macros with LFO/Envelope, applies meta targets, preserves bases and prepared handles', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async code => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { makeBank } = await import(url); URL.revokeObjectURL(url);
    const state = { filterbankEnabled: true, filterEnabled: true, filterShapeParams: { type: 'lowpass', frequencyHz: 1000 },
      baseResonance: 0, lfoModuleEnabled: true, envelopeModuleEnabled: true,
      lfoSources: [{ enabled: true, waveform: 'square', rateHz: 1, assignments: [{ id: 'lfo', targetId: 'filterbank.band.4.gainDb', amount: 10 }] },
        { enabled: true, rateHz: 2, assignments: [] }],
      envelopeSources: [{ enabled: true, attack: 20, thresholdDb: -60, assignments: [{ id: 'env', targetId: 'filterbank.band.4.gainDb', amount: 10 }] }],
      macroSources: [{ value: 100, assignments: [{ id: 'res', targetId: 'global.resonance', amount: 50 },
        { id: 'band', targetId: 'filterbank.band.4.gainDb', amount: 25 },
        { id: 'frequency', targetId: 'filter.frequencyHz', amount: 20 },
        { id: 'rate', targetId: 'lfo.2.rate', amount: 50 }, { id: 'attack', targetId: 'envelope.1.attack', amount: 50 }] },
        { value: 50, assignments: [{ id: 'second', targetId: 'filterbank.band.4.gainDb', amount: 25 }] }] };
    state.macroSources.push({}, {}, { value: 100, assignments: [{ id: 'discarded', targetId: 'global.resonance', amount: 100 }] });
    const bank = makeBank(48000, { modulationState: state,
      bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
      bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0), resonance: 0 });
    const input = [[new Float32Array(128).fill(.3), new Float32Array(128).fill(.2)]];
    const output = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]];
    const tick = () => { for (let i = 0; i < 20; i++) bank.process(input, output); };
    const core = bank.modulationCore, nodes = bank.modulationNodes, targets = core.compiledTargets;
    const count = core.compilationCount, graphCount = core.graphCompilationCount;
    core.compileAssignments = () => { throw new Error('compile in hotpath'); };
    const sourceLookup = core.sources.get.bind(core.sources);
    core.sources.get = id => { if (id.startsWith('macro.')) throw new Error('macro lookup in hotpath'); return sourceLookup(id); };
    tick();
    const before = { resonance: core.getEffectiveValue('global.resonance', bank), baseResonance: bank.baseResonance,
      frequency: bank.effectiveFilterShapeParams.frequencyHz, baseFrequency: bank.filterShapeParams.frequencyHz,
      rate: bank.lfoSources[1].effectiveRateHz, baseRate: bank.lfoSources[1].rateHz,
      attack: bank.envelopeSources[0].effectiveAttack, baseAttack: bank.envelopeSources[0].attack,
      band: core.getEffectiveValue('filterbank.band.4.gainDb', bank, 'left'), env: bank.envelopeSources[0].value,
      phase: bank.lfoSources[1].freePhase, value: bank.envelopeSources[0].value };
    core.sources.get = sourceLookup;
    bank.handleMessage({ type: 'set-macro-value', sourceId: 'macro.1', value: 0 });
    bank.handleMessage({ type: 'set-macro-value', sourceId: 'macro.2', value: 0 });
    const untouched = { phase: bank.lfoSources[1].freePhase, value: bank.envelopeSources[0].value };
    tick();
    return { before, untouched, after: { resonance: core.getEffectiveValue('global.resonance', bank),
      frequency: bank.effectiveFilterShapeParams.frequencyHz, rate: bank.lfoSources[1].effectiveRateHz,
      attack: bank.envelopeSources[0].effectiveAttack,
      band: core.getEffectiveValue('filterbank.band.4.gainDb', bank, 'left'), env: bank.envelopeSources[0].value },
      stable: count === core.compilationCount && graphCount === core.graphCompilationCount && nodes === bank.modulationNodes && targets === core.compiledTargets,
      blocked: [...core.graph.blocked], macroIds: [...core.sources.keys()].filter(id => id.startsWith('macro.')) };
  }, processorFactory('http://localhost:3000'));
  expect(result.before).toMatchObject({ resonance: .5, baseResonance: 0, baseFrequency: 1000, baseRate: 2, baseAttack: 20 });
  expect(result.before.frequency).toBeGreaterThan(1000); expect(result.before.rate).toBeGreaterThan(2); expect(result.before.attack).toBeGreaterThan(20);
  expect(result.before.band).toBeCloseTo(4.5 + 1.2 + result.before.env * 1.2, 12);
  expect(result.untouched).toEqual({ phase: result.before.phase, value: result.before.value });
  expect(result.after).toMatchObject({ resonance: 0, frequency: 1000, rate: 2, attack: 20 });
  expect(result.after.band).toBeCloseTo(1.2 + result.after.env * 1.2, 12);
  expect(result.stable).toBe(true); expect(result.blocked).toEqual([]);
  expect(result.macroIds).toEqual(['macro.1', 'macro.2', 'macro.3', 'macro.4']);
});

for (const rate of [48000, 96000]) test(`manual macro routing renders native audio and neutral sources match legacy at ${rate}Hz`, async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async rate => {
    const render = async (macroSources, automated = false) => {
      const length = Math.round(rate * .15), context = new OfflineAudioContext(2, length, rate);
      await context.audioWorklet.addModule('/filterbank-processor.js');
      const buffer = context.createBuffer(2, length, rate);
      for (let c = 0; c < 2; c++) for (let i = 0; i < length; i++) buffer.getChannelData(c)[i] = .05 * Math.sin(i / rate * 2 * Math.PI * 640);
      const bank = new AudioWorkletNode(context, 'da-filta-processor', { numberOfInputs: 1, numberOfOutputs: 2, outputChannelCount: [2, 1],
        processorOptions: { modulationState: { filterbankEnabled: true, macroSources }, resonance: 0,
          feedbackBandLeft: Array.from({ length: 10 }, (_, i) => i === 4),
          feedbackBandRight: Array.from({ length: 10 }, (_, i) => i === 4),
          bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
          bandGainLeft: Array(10).fill(20), bandGainRight: Array(10).fill(20) } });
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(bank); bank.connect(context.destination);
      let errors = 0; bank.onprocessorerror = () => errors++;
      if (automated) {
        context.suspend(128 / rate).then(() => {
          // Rapid manual changes travel through the same value-only port path.
          for (const value of [100, 0, 50, 0, 100]) bank.port.postMessage({ type: 'set-macro-value', sourceId: 'macro.1', value });
          context.resume();
        });
      }
      source.start(); const output = await context.startRendering();
      bank.disconnect(); source.disconnect();
      return { channels: [output.getChannelData(0), output.getChannelData(1)], errors };
    };
    const legacy = await render(undefined), defaults = await render([]);
    const zero = await render([{ value: 0, assignments: [{ id: 'r', targetId: 'global.resonance', amount: 50 }] }]);
    const empty = await render(Array.from({ length: 8 }, () => ({ value: 100, assignments: [] })));
    const active = await render([{ value: 100, assignments: [{ id: 'r', targetId: 'global.resonance', amount: 50 }] }]);
    const automated = await render([{ value: 0, assignments: [{ id: 'r', targetId: 'global.resonance', amount: 50 }] }], true);
    const difference = a => Math.max(...a.channels.map((channel, c) => channel.reduce((max, sample, i) => Math.max(max, Math.abs(sample - legacy.channels[c][i])), 0)));
    return { defaults: difference(defaults), zero: difference(zero), empty: difference(empty), active: difference(active), automated: difference(automated),
      errors: [legacy, defaults, zero, empty, active, automated].reduce((n, item) => n + item.errors, 0),
      finite: automated.channels.every(channel => channel.every(Number.isFinite)),
      maxStep: automated.channels[0].reduce((max, sample, i, channel) => i ? Math.max(max, Math.abs(sample - channel[i - 1])) : max, 0) };
  }, rate);
  expect(result).toMatchObject({ defaults: 0, zero: 0, empty: 0, errors: 0, finite: true });
  expect(result.active).toBeGreaterThan(1e-6); expect(result.automated).toBeGreaterThan(1e-6);
  expect(result.maxStep).toBeLessThan(.1);
});

test('accepted resonator/P2 audio stays sample-identical with no macro configuration', async ({ page }) => {
  const base = 'ebac14b';
  const reference = file => execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' });
  await page.context().route('**/tests/macros-reference/*', route => route.fulfill({ contentType: 'text/javascript',
    body: reference(new URL(route.request().url()).pathname.split('/').at(-1)) }));
  const body = reference('filterbank-processor.js');
  const imports = body.match(/^import .*;$/gm).join('\n').replace(/from '\.\//g, "from 'http://localhost:3000/tests/macros-reference/");
  const before = `${imports}\nexport function makeBank(sampleRate, processorOptions) {
    class AudioWorkletProcessor { constructor() { this.port = { postMessage() {} }; } }
    let Processor; const registerProcessor = (_, Class) => { Processor = Class; };
    ${body.replace(/^import .*;\r?\n/gm, '')}
    return new Processor({ processorOptions }); }`;
  await page.goto('/');
  const result = await page.evaluate(async ({ before, after }) => {
    const load = async code => { const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); const module = await import(url); URL.revokeObjectURL(url); return module; };
    const old = await load(before), current = await load(after), rows = [];
    for (const rate of [48000, 96000]) for (const active of [false, true]) {
      const options = { bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS],
        bandGainLeft: Array(10).fill(20), bandGainRight: Array(10).fill(15), resonance: .3,
        feedbackBandLeft: Array.from({ length: 10 }, (_, index) => index === 4), feedbackAllLeft: true, feedbackAllAmount: 25, feedbackTapModulation: 'exclude',
        modulationState: { filterbankEnabled: true, lfoModuleEnabled: active, envelopeModuleEnabled: active,
          lfoSources: Array.from({ length: 4 }, (_, index) => ({ enabled: true, rateHz: .7 + index,
            assignments: [{ id: `band.${index}`, targetId: `filterbank.band.${index}.gainDb`, amount: 5 },
              ...(index === 0 ? [{ id: 'meta', targetId: 'lfo.2.rate', amount: 10 }] : [])] })),
          envelopeSources: Array.from({ length: 4 }, (_, index) => ({ enabled: true, assignments: [{ id: `env.${index}`, targetId: `filterbank.band.${index + 5}.gainDb`, amount: 10 }] })),
          clockMod: { enabled: active, internalBpm: 10000, modulationGain: 25, rightInvert: true } } };
      const a = old.makeBank(rate, options), b = current.makeBank(rate, options);
      const input = [[new Float32Array(128).fill(.05), new Float32Array(128).fill(.03)]];
      const outA = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]];
      const outB = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128)]];
      let difference = 0;
      for (let block = 0; block < 256; block++) {
        a.process(input, outA); b.process(input, outB);
        for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) difference = Math.max(difference, Math.abs(outA[0][c][i] - outB[0][c][i]));
      }
      rows.push({ rate, active, difference });
    }
    return rows;
  }, { before, after: processorFactory('http://localhost:3000') });
  for (const row of result) expect(row.difference, JSON.stringify(row)).toBe(0);
});

test('four macros with 32 routes: native callback cost survey at 48/96kHz', async ({ page }) => {
  test.setTimeout(60000); await page.goto('/');
  const cases = [48000, 96000].flatMap(rate => [false, true].map(active => ({ rate, active, stage: `${active ? '32-routes' : 'base'}@${rate}` })));
  const cdp = await page.context().newCDPSession(page), events = [];
  cdp.on('Tracing.dataCollected', event => events.push(...event.value));
  await cdp.send('Tracing.start', { categories: 'audio,webaudio,disabled-by-default-audio', transferMode: 'ReportEvents' });
  const live = await page.evaluate(async cases => {
    const rows = [];
    for (const config of cases) {
      const context = new AudioContext({ sampleRate: config.rate, latencyHint: 'interactive' });
      await context.audioWorklet.addModule('/filterbank-processor.js');
      const macroSources = Array.from({ length: 4 }, (_, index) => ({ value: 50,
        assignments: config.active ? [`filterbank.band.${index}.gainDb`, `filterbank.band.${index + 4}.gainDb`, 'global.resonance', 'global.dryWet', 'lfo.2.rate', 'lfo.2.outputAmount', 'envelope.1.attack', 'envelope.1.release']
          .map((targetId, n) => ({ id: `${index}.${n}`, targetId, amount: 2, invert: index % 2 === 0 })) : [] }));
      const bank = new AudioWorkletNode(context, 'da-filta-processor', { numberOfInputs: 1, numberOfOutputs: 2, outputChannelCount: [2, 1],
        processorOptions: { modulationState: { macroSources, filterbankEnabled: true, lfoModuleEnabled: true, envelopeModuleEnabled: true,
          lfoSources: [{ enabled: true, assignments: [] }, { enabled: true, assignments: [] }], envelopeSources: [{ enabled: true, assignments: [] }] },
          bandFrequencies: [...window.Filterbank.BAND_FREQUENCIES], bandQs: [...window.Filterbank.BAND_QS], bandGainLeft: Array(10).fill(20), bandGainRight: Array(10).fill(20) } });
      const source = context.createOscillator(); source.frequency.value = 173;
      const gain = context.createGain(); gain.gain.value = .05;
      const analyser = context.createAnalyser(), mute = context.createGain(); mute.gain.value = 0;
      source.connect(gain); gain.connect(bank); bank.connect(analyser, 0); analyser.connect(mute); mute.connect(context.destination);
      let processorErrors = 0; bank.onprocessorerror = () => processorErrors++;
      source.start(); await context.resume(); await new Promise(resolve => setTimeout(resolve, 1500));
      const samples = new Float32Array(2048); analyser.getFloatTimeDomainData(samples);
      rows.push({ rate: config.rate, stage: config.stage, actualRate: context.sampleRate, processorErrors,
        finite: samples.every(Number.isFinite), peak: samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0) });
      source.stop(); bank.disconnect(); gain.disconnect(); analyser.disconnect(); mute.disconnect(); await context.close();
    }
    return rows;
  }, cases);
  const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end'); await complete; await cdp.detach();
  const nativeRender = summarizeNativeRender(live, events);
  for (const row of live) { expect(row.actualRate).toBe(row.rate); expect(row.processorErrors).toBe(0); expect(row.finite).toBe(true); expect(row.peak).toBeGreaterThan(0); }
  for (const row of nativeRender) expect(row.blocks).toBeGreaterThan(100);
  fs.writeFileSync(test.info().outputPath('macros-native.json'), JSON.stringify({ live, nativeRender }, null, 2));
  console.log('MACROS_NATIVE=' + JSON.stringify(nativeRender));
});
