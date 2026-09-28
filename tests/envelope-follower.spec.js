const { test, expect } = require('playwright/test');
const { browserBundle } = require('./helpers/input-character-full-graph.cjs');

test('Envelope workspace exposes the shared modulation targets and persists V1 controls', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'ENVELOPE FOLLOWER' }).click();
  await expect(page.locator('[data-envelope-visualizer]')).toBeVisible();
  await expect(page.locator('[data-envelope-attack]')).toBeVisible();
  await expect(page.locator('[data-envelope-release]')).toBeVisible();
  await expect(page.locator('[data-envelope-sensitivity]')).toBeVisible();
  await expect(page.locator('[data-envelope-amount]')).toBeVisible();

  await page.locator('[data-envelope-mode="rms"]').click();
  await page.locator('[data-envelope-attack]').evaluate(input => { input.value = '35'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('[data-envelope-release]').evaluate(input => { input.value = '700'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('[data-envelope-sensitivity]').evaluate(input => { input.value = '180'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('[data-envelope-target]').selectOption('filterbank.band.3.gainDb');
  await page.locator('[data-envelope-channel]').selectOption('spread');
  await page.locator('[data-envelope-invert]').click();
  await page.locator('[data-envelope-enable]').click();

  const state = await page.evaluate(() => window.EnvelopeMode.getState().envelopeSources[0]);
  expect(state).toMatchObject({
    id: 'envelope.1', enabled: true, detectorMode: 'rms', attack: 35, release: 700,
    sensitivity: 180, targetId: 'filterbank.band.3.gainDb', channel: 'spread', invert: true
  });
  expect(await page.locator('[data-envelope-wave-path]').getAttribute('d')).toContain('M');
  expect(await page.locator('[data-envelope-mode="rms"]').getAttribute('aria-pressed')).toBe('true');
  expect(await page.locator('[data-envelope-enable]').getAttribute('aria-pressed')).toBe('true');
  const targets = await page.evaluate(() => window.EnvelopeMode.getTargetRegistry().map(target => target.id));
  expect(targets).toContain('global.resonance');
  expect(targets).toContain('dynamicEq.thresholdDb');
  expect(targets).toContain('filterbank.band.3.gainDb');
});

test('Envelope detector runs in the Worklet, reports telemetry, and removes modulation when disabled', async ({ page }) => {
  await page.goto('/');
  const bundle = browserBundle('http://localhost:3000');
  const result = await page.evaluate(async code => {
    const engine = new window.AudioEngine({});
    engine.setFilterbankEnabled(true);
    const envelopeSources = engine.getModulationState().envelopeSources.map(source => ({
      ...source, enabled: true, detectorMode: 'peak', attack: 20, release: 20,
      sensitivity: 100, amount: 50, targetId: 'filterbank.band.5.gainDb', channel: 'both'
    }));
    const modulation = { ...engine.getModulationState(), envelopeSources };
    engine.setModulationState(modulation);
    const options = engine.getFilterbankState();
    options.bandFrequencies = [...window.Filterbank.BAND_FREQUENCIES];
    options.bandQs = [...window.Filterbank.BAND_QS];
    options.bandGainLeft = Array(10).fill(50);
    options.bandGainRight = Array(10).fill(50);
    options.maxBandBoostDb = 12;
    options.maxBandCutDb = 12;
    const bundleUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const { Graph } = await import(bundleUrl);
    URL.revokeObjectURL(bundleUrl);
    const graph = new Graph(48000, options, 'linear', false);
    const messages = [];
    graph.onTelemetry = message => messages.push(message);
    for (let block = 0; block < 30; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      for (let frame = 0; frame < left.length; frame += 1) {
        const sample = .4 * Math.sin((block * 128 + frame) * Math.PI * 2 * 440 / 48000);
        left[frame] = sample;
        right[frame] = sample;
      }
      graph.process([left, right]);
    }
    const activeValue = graph.bank.envelopeSources[0].value;
    const activeOffset = graph.bank.modulationDirectBandOffsetsDb[5];
    const baseGainBefore = graph.bank.controlToGainDb(graph.bank.bandControls.left[5]);
    const envelopePackets = messages.filter(message => message.type === 'envelope-telemetry');
    for (let block = 0; block < 12; block += 1) graph.process([new Float32Array(128), new Float32Array(128)]);
    const silenceValue = graph.bank.envelopeSources[0].value;
    const silencePacket = messages.filter(message => message.type === 'envelope-telemetry').at(-1) || null;
    const baseGainAfter = graph.bank.controlToGainDb(graph.bank.bandControls.left[5]);
    graph.bank.setModulationState({ ...modulation, envelopeSources: [{ ...envelopeSources[0], enabled: false }] });
    for (let block = 0; block < 4; block += 1) graph.process([new Float32Array(128).fill(.4), new Float32Array(128).fill(.4)]);
    return {
      activeValue, activeOffset, silenceValue, disabledValue: graph.bank.envelopeSources[0].value,
      baseGainBefore, baseGainAfter, disabledOffset: graph.bank.modulationDirectBandOffsetsDb[5],
      envelopePacket: envelopePackets.at(-1) || null,
      silencePacket,
      finite: Number.isFinite(activeValue) && Number.isFinite(activeOffset)
    };
  }, bundle);

  expect(result.activeValue).toBeGreaterThan(.25);
  expect(result.activeOffset).toBeGreaterThan(0);
  expect(result.silenceValue).toBeLessThan(result.activeValue);
  expect(result.disabledValue).toBe(0);
  expect(result.disabledOffset).toBe(0);
  expect(result.baseGainAfter).toBe(result.baseGainBefore);
  expect(result.envelopePacket).toMatchObject({ type: 'envelope-telemetry', sourceId: 'envelope.1', enabled: true });
  expect(result.envelopePacket.value).toBeGreaterThan(0);
  expect(result.silencePacket.value).toBeLessThan(result.envelopePacket.value);
  expect(result.finite).toBe(true);
});

test('Envelope workspace follows the LFO responsive split at the requested viewport sizes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'ENVELOPE FOLLOWER' }).click();
  for (const viewport of [{ width: 1914, height: 907 }, { width: 1440, height: 900 }, { width: 1914, height: 768 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const graph = document.querySelector('.envelope-response').getBoundingClientRect();
      const controls = document.querySelector('.envelope-controls').getBoundingClientRect();
      return { graph: { x: graph.x, y: graph.y, width: graph.width, height: graph.height }, controls: { x: controls.x, y: controls.y, width: controls.width, height: controls.height } };
    });
    expect(layout.graph.width).toBeGreaterThan(0);
    expect(layout.graph.height).toBeGreaterThan(0);
    expect(layout.controls.width).toBeGreaterThan(0);
    expect(layout.controls.height).toBeGreaterThan(0);
    if (viewport.width <= 1050) expect(layout.graph.y + layout.graph.height).toBeLessThanOrEqual(layout.controls.y + 1);
    else expect(layout.graph.x + layout.graph.width).toBeLessThanOrEqual(layout.controls.x + 1);
  }
});
