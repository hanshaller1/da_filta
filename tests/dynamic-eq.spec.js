const { test, expect } = require('playwright/test');

test('dynamic EQ target, sensitivity, range and smoothing', async () => {
  const { normalizeDynamicEq, targetGainDb, smoothGain, timeCoefficient } = await import('../dynamic-eq-core.mjs');
  const state = normalizeDynamicEq({ dynamicEqThresholdDb: -24, dynamicEqWindowDb: 6, dynamicEqRangeDb: 12 });
  expect(targetGainDb(-15, state)).toBe(-6);
  expect(targetGainDb(-23, state)).toBe(0);
  expect(targetGainDb(-15, { ...state, dynamicEqRangeDb: 4 })).toBe(-4);
  expect(targetGainDb(-15, { ...state, dynamicEqStrength: 50 })).toBe(-3);
  expect(targetGainDb(-15, state, 50)).toBe(-3);
  expect(targetGainDb(-15, state, 0)).toBe(0);
  expect(targetGainDb(-10, state)).toBe(-11);
  expect(targetGainDb(0, state)).toBe(-12);
  const boost = { ...state, dynamicEqMode: 'boost' };
  expect(targetGainDb(-33, boost)).toBe(6);
  expect(targetGainDb(-33, boost, 50)).toBe(3);
  expect(targetGainDb(-15, boost)).toBe(0);
  const balance = { ...state, dynamicEqMode: 'balance' };
  expect(targetGainDb(-15, balance)).toBe(-6);
  expect(targetGainDb(-24, balance)).toBe(0);
  expect(targetGainDb(-33, balance)).toBe(6);
  expect(normalizeDynamicEq({}).dynamicEqEnabled).toBe(false);
  const attack = timeCoefficient(30, 48000);
  const release = timeCoefficient(250, 48000);
  const first = smoothGain(0, -6, attack, release);
  expect(first).toBeLessThan(0);
  expect(first).toBeGreaterThan(-6);
  const returning = smoothGain(-6, 0, attack, release);
  expect(returning).toBeGreaterThan(-6);
  expect(smoothGain(-6, 6, attack, release)).toBe(returning);
  expect(Number.isFinite(smoothGain(0, 12, attack, release))).toBe(true);
  let crossing = -6;
  for (let i = 0; i < 192000; i += 1) crossing = smoothGain(crossing, 6, attack, release);
  expect(crossing).toBeGreaterThan(0);
});

test('audio worklet applies linked gain from source bands and keeps power independent', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const render = async (enabled, mode = 'cut', sensitivity = 100, threshold = -48) => {
      const context = new OfflineAudioContext(2, 48000, 48000);
      const source = context.createBufferSource();
      const buffer = context.createBuffer(2, context.length, context.sampleRate);
      for (let i = 0; i < context.length; i += 1) {
        const sine = Math.sin(2 * Math.PI * 777 * i / context.sampleRate);
        buffer.getChannelData(0)[i] = .4 * sine;
        buffer.getChannelData(1)[i] = .1 * sine;
      }
      source.buffer = buffer;
      const packets = [];
      const bank = await window.Filterbank.create(context, {
        bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0),
        dynamicEqEnabled: enabled, dynamicEqMode: mode, dynamicEqThresholdDb: threshold,
        dynamicEqWindowDb: 0, dynamicEqRangeDb: 12, dynamicEqAttackMs: 1,
        dynamicEqReleaseMs: 50,
        dynamicEqBandSensitivity: Array.from({ length: 10 }, (_, i) => i === 5 ? sensitivity : 0),
        onDynamicEqTelemetry: packet => packets.push(packet)
      });
      source.connect(bank.input);
      bank.output.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      await new Promise(resolve => setTimeout(resolve, 30));
      const rms = channel => {
        const data = output.getChannelData(channel);
        let energy = 0;
        for (let i = 36000; i < 48000; i += 1) energy += data[i] * data[i];
        return Math.sqrt(energy / 12000);
      };
      const answer = { left: rms(0), right: rms(1), packets: packets.length,
        gain: packets.at(-1)?.gains?.[5], level: packets.at(-1)?.levels?.[5] };
      bank.dispose();
      return answer;
    };
    return { off: await render(false), cut: await render(true), boost: await render(true, 'boost'),
      boostActive: await render(true, 'boost', 100, -10), muted: await render(true, 'cut', 0) };
  });
  expect(result.off.packets).toBe(0);
  expect(result.cut.packets).toBeGreaterThan(0);
  expect(result.cut.level).toBeGreaterThan(-48);
  expect(result.cut.gain).toBeLessThan(-1);
  expect(result.cut.left).toBeLessThan(result.off.left);
  expect(result.cut.right).toBeLessThan(result.off.right);
  expect(result.cut.left / result.cut.right).toBeCloseTo(result.off.left / result.off.right, 1);
  expect(result.boost.gain).toBe(0);
  expect(result.boostActive.gain).toBeGreaterThan(0.5);
  expect(result.boostActive.left).toBeGreaterThan(result.off.left);
  expect(result.muted.gain).toBe(0);
  expect(result.muted.left).toBeCloseTo(result.off.left, 4);
});

test('legacy state defaults and independent FILTERBANK, FILTER and dynamic layers', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    engine.applyState({ bandGainLeft: Array(10).fill(0), bandGainRight: Array(10).fill(0) });
    const legacy = engine.getState();
    engine.bandGainLeft[5] = 25;
    engine.bandGainRight[5] = 25;
    engine.filterModeBandGainsDb[5] = 3;
    engine.filterbankEnabled = false;
    engine.filterEnabled = false;
    const neither = engine.getPreDynamicGainDb(5, 'left');
    engine.filterbankEnabled = true;
    const manual = engine.getPreDynamicGainDb(5, 'left');
    engine.filterbankEnabled = false;
    engine.filterEnabled = true;
    const filter = engine.getPreDynamicGainDb(5, 'left');
    engine.filterbankEnabled = true;
    const both = engine.getPreDynamicGainDb(5, 'left');
    engine.setDynamicEq({ ...legacy, dynamicEqEnabled: true });
    return { legacy: [legacy.dynamicEqEnabled, legacy.dynamicEqMode, legacy.dynamicEqThresholdDb,
      legacy.dynamicEqBandSensitivity], neither, manual, filter, both,
      manualStillStored: engine.bandGainLeft[5], dynamicEnabled: engine.dynamicEqEnabled };
  });
  expect(result.legacy).toEqual([false, 'cut', -24, Array(10).fill(100)]);
  expect(result.neither).toBe(0);
  expect(result.manual).toBe(3);
  expect(result.filter).toBe(3);
  expect(result.both).toBe(6);
  expect(result.manualStillStored).toBe(25);
  expect(result.dynamicEnabled).toBe(true);
});

test('peak catches a transient sooner while RMS retains its energy longer', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const render = async detector => {
      const context = new OfflineAudioContext(2, 9600, 48000);
      const source = context.createBufferSource();
      const buffer = context.createBuffer(2, context.length, 48000);
      const left = buffer.getChannelData(0);
      for (let i = 0; i < 480; i += 1) left[i] = .5 * Math.sin(2 * Math.PI * 777 * i / 48000);
      source.buffer = buffer;
      const packets = [];
      const bank = await window.Filterbank.create(context, {
        dynamicEqEnabled: true, dynamicEqMode: 'cut', dynamicEqDetectorMode: detector,
        dynamicEqThresholdDb: -45, dynamicEqWindowDb: 0, dynamicEqRangeDb: 12,
        dynamicEqAttackMs: 1, dynamicEqReleaseMs: 80,
        dynamicEqBandSensitivity: Array.from({ length: 10 }, (_, i) => i === 5 ? 100 : 0),
        onDynamicEqTelemetry: packet => packets.push(packet)
      });
      source.connect(bank.input);
      bank.output.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      await new Promise(resolve => setTimeout(resolve, 30));
      let energy = 0;
      const data = output.getChannelData(0);
      for (let i = 0; i < 480; i += 1) energy += data[i] * data[i];
      const answer = { transientRms: Math.sqrt(energy / 480), laterLevel: packets[0]?.levels?.[5] };
      bank.dispose();
      return answer;
    };
    return { peak: await render('peak'), rms: await render('rms') };
  });
  expect(result.peak.transientRms).toBeLessThan(result.rms.transientRms);
  expect(result.rms.laterLevel).toBeGreaterThan(result.peak.laterLevel);
});

test('dynamic EQ workspace, power and state survive tab changes', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="dynamic-eq"]').click();
  await expect(page.locator('#mode-dynamic-eq')).toBeVisible();
  await expect(page.locator('[data-module-power="dynamic-eq"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-dynamic-eq-mode]')).toHaveCount(3);
  await expect(page.locator('[data-dynamic-eq-detector]')).toHaveCount(2);
  await expect(page.locator('.dynamic-eq-control')).toHaveCount(6);
  await expect(page.locator('.dynamic-eq-sensitivity-item')).toHaveCount(10);
  await page.locator('[data-dynamic-eq-mode="balance"]').click();
  await page.locator('.dynamic-eq-control input[aria-label="Threshold"]').fill('-18');
  await page.locator('.dynamic-eq-sensitivity-item input').first().fill('50');
  await page.locator('[data-module-power="dynamic-eq"]').click();
  await page.locator('[data-mode="filter"]').click();
  await page.locator('[data-mode="dynamic-eq"]').click();
  expect(await page.evaluate(() => {
    const state = window.FilterMode.getAudioEngine().getState();
    return [state.dynamicEqEnabled, state.dynamicEqMode, state.dynamicEqThresholdDb, state.dynamicEqBandSensitivity[0]];
  })).toEqual([true, 'balance', -18, 50]);
  await expect(page.locator('[data-module-power="dynamic-eq"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-dynamic-eq-reset]').click();
  await expect(page.locator('.dynamic-eq-sensitivity-item output').first()).toHaveText('100');
});

test('dynamic EQ graph and controls fit the existing desktop workspace', async ({ page }) => {
  for (const [width, height] of [[1914, 907], [1440, 900], [1914, 768]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.locator('[data-mode="dynamic-eq"]').click();
    const geometry = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const panel = rect('#mode-dynamic-eq');
      const response = rect('.dynamic-eq-response');
      const controls = rect('.dynamic-eq-controls');
      const graph = rect('.dynamic-eq-graph');
      const sensitivity = rect('.dynamic-eq-sensitivity-grid');
      return { panel, response, controls, graph, sensitivity,
        controlScroll: document.querySelector('.dynamic-eq-controls').scrollHeight - controls.height };
    });
    expect(geometry.response.left).toBeGreaterThanOrEqual(geometry.panel.left);
    expect(geometry.controls.right).toBeLessThanOrEqual(geometry.panel.right);
    expect(geometry.graph.bottom).toBeLessThan(geometry.sensitivity.top);
    expect(geometry.sensitivity.bottom).toBeLessThanOrEqual(geometry.panel.bottom);
    expect(geometry.controlScroll).toBeLessThan(2);
  }
});

test('dynamic EQ plot starts at the graph edge and sliders share exact band centers at varied widths', async ({ page }) => {
  for (const width of [1914, 1440, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.locator('[data-mode="dynamic-eq"]').click();
    const geometry = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const centers = selector => [...document.querySelectorAll(selector)].map(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.left + bounds.width / 2;
      });
      const graph = rect('.dynamic-eq-graph');
      const plot = rect('.dynamic-eq-plot');
      return {
        graph: { left: graph.left, right: graph.right },
        plot: { left: plot.left, right: plot.right },
        bars: centers('.dynamic-eq-column'),
        frequencies: centers('.dynamic-eq-frequency'),
        sliders: centers('.dynamic-eq-sensitivity-item input')
      };
    });
    expect(geometry.plot.left).toBeCloseTo(geometry.graph.left, 0);
    expect(geometry.plot.right).toBeCloseTo(geometry.graph.right, 0);
    expect(geometry.bars).toHaveLength(10);
    expect(geometry.frequencies).toHaveLength(10);
    expect(geometry.sliders).toHaveLength(10);
    for (let index = 0; index < 10; index += 1) {
      expect(geometry.frequencies[index]).toBeCloseTo(geometry.bars[index], 0);
      expect(geometry.sliders[index]).toBeCloseTo(geometry.bars[index], 0);
    }
  }
});

test('dynamic EQ reuses FILTER sliders and its six controls form one 2 by 3 grid', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="dynamic-eq"]').click();
  const styles = await page.evaluate(() => {
    const filter = document.querySelector('.filter-secondary-controls .filter-style-slider');
    const global = document.querySelector('.dynamic-eq-control .filter-style-slider');
    const sensitivity = document.querySelector('.dynamic-eq-sensitivity-item .filter-style-slider');
    const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]);
    const thumb = rules.find(rule => rule.selectorText === '.filter-style-slider::-webkit-slider-thumb');
    const track = rules.find(rule => rule.selectorText === '.filter-style-slider::-webkit-slider-runnable-track');
    const grid = document.querySelector('.dynamic-eq-control-grid');
    const cells = [...grid.children].map(child => child.getBoundingClientRect().toJSON());
    return { shared: [filter, global, sensitivity].every(input => input?.classList.contains('filter-style-slider')),
      thumb: { width: thumb?.style.width, height: thumb?.style.height, radius: thumb?.style.borderRadius,
        border: thumb?.style.border, shadow: thumb?.style.boxShadow },
      track: { height: track?.style.height, background: track?.style.background },
      gap: getComputedStyle(grid).gap, columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, cells };
  });
  expect(styles.shared).toBe(true);
  expect(styles.thumb).toMatchObject({ width: '10px', height: '20px', radius: '3px' });
  expect(styles.thumb.border).toContain('var(--range-thumb-border)');
  expect(styles.thumb.shadow).toContain('var(--range-thumb-shadow)');
  expect(styles.track.height).toBe('5px');
  expect(styles.track.background).toContain('var(--range-track)');
  expect(styles.gap).toBe('0px');
  expect(styles.columns).toBe(2);
  expect(styles.cells).toHaveLength(6);
  expect(styles.cells[0].right).toBeCloseTo(styles.cells[1].left, 0);
  expect(styles.cells[0].bottom).toBeCloseTo(styles.cells[2].top, 0);
});

test('dynamic EQ axes, guide values and detector colors remain visible across themes', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="dynamic-eq"]').click();
  await page.locator('[data-module-power="dynamic-eq"]').click();
  await expect(page.locator('.dynamic-eq-y-axis span')).toHaveText(['0 dBFS', '−12 dBFS', '−24 dBFS', '−36 dBFS', '−48 dBFS', '−60 dBFS']);
  await expect(page.locator('.dynamic-eq-x-axis span')).toHaveText(['29', '61', '115', '218', '411', '777', '1.5k', '2.8k', '5.2k', '11k']);
  await expect(page.locator('.dynamic-eq-level-guide span')).toHaveText(['UPPER -21.0', 'THRESHOLD -24.0', 'LOWER -27.0']);
  await page.evaluate(() => window.FilterMode.getAudioEngine().onDynamicEqTelemetry({
    levels: Array(10).fill(-20), gains: [-3, 3, 0, 0, 0, 0, 0, 0, 0, 0]
  }));
  await expect(page.locator('.dynamic-eq-level-value').first()).toHaveText('-20');
  const visible = await page.evaluate(() => ({
    detector: document.querySelector('.dynamic-eq-level').getBoundingClientRect().height,
    cut: document.querySelectorAll('.dynamic-eq-gain')[0].getBoundingClientRect().height,
    boost: document.querySelectorAll('.dynamic-eq-gain')[1].getBoundingClientRect().height,
    zero: getComputedStyle(document.querySelector('.dynamic-eq-gain-zero')).borderTopStyle
  }));
  expect(visible.detector).toBeGreaterThan(0);
  expect(visible.cut).toBeGreaterThan(0);
  expect(visible.boost).toBeGreaterThan(0);
  expect(visible.zero).toBe('dotted');
  const initialGainHeight = visible.cut;
  await page.locator('.dynamic-eq-control input[aria-label="Range"]').fill('3');
  await expect(page.locator('[data-dynamic-eq-gain-scale]')).toHaveText('GAIN · ±3.0 dB');
  const scaledGainHeight = await page.locator('.dynamic-eq-gain').first().evaluate(bar => bar.getBoundingClientRect().height);
  expect(scaledGainHeight).toBeGreaterThan(initialGainHeight * 1.9);
  const themes = await page.locator('[data-theme-select]').locator('option').evaluateAll(options => options.map(option => option.value).filter(value => value !== 'custom'));
  for (const theme of themes) {
    await page.locator('[data-theme-select]').selectOption(theme);
    const color = await page.locator('.dynamic-eq-level').first().evaluate(bar => getComputedStyle(bar).backgroundColor);
    expect(color).toMatch(/^rgb/);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
  }
});

test('dynamic EQ guide lines and bipolar gain bars follow telemetry', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-mode="dynamic-eq"]').click();
  await page.locator('[data-module-power="dynamic-eq"]').click();
  await page.evaluate(() => window.FilterMode.getAudioEngine().onDynamicEqTelemetry({
    levels: Array(10).fill(-24), gains: [-4, 3, 0, 0, 0, 0, 0, 0, 0, 0]
  }));
  await expect(page.locator('.dynamic-eq-gain-value').first()).toHaveText('-4.0 dB');
  await expect(page.locator('.dynamic-eq-gain-value').nth(1)).toHaveText('+3.0 dB');
  const before = await page.locator('[data-dynamic-eq-threshold]').evaluate(element => element.style.bottom);
  await page.locator('.dynamic-eq-control input[aria-label="Threshold"]').fill('-18');
  const after = await page.locator('[data-dynamic-eq-threshold]').evaluate(element => element.style.bottom);
  expect(before).not.toBe(after);
  await expect(page.locator('[data-dynamic-eq-upper]')).toHaveAttribute('title', 'UPPER -15.0 dBFS');
  await expect(page.locator('[data-dynamic-eq-lower]')).toHaveAttribute('title', 'LOWER -21.0 dBFS');
});

test('running sample audio reaches the visible dynamic EQ telemetry graph', async ({ page }) => {
  test.setTimeout(30000);
  await page.goto('/');
  await page.locator('[data-mode="dynamic-eq"]').click();
  await page.locator('[data-module-power="dynamic-eq"]').click();
  await page.locator('[data-dynamic-eq-mode="boost"]').click();
  await page.locator('.dynamic-eq-control input[aria-label="Threshold"]').fill('0');
  await page.evaluate(() => {
    const engine = window.FilterMode.getAudioEngine();
    window.__dynamicEqLive = { packets: 0, levels: [], gains: [] };
    const receive = engine.onDynamicEqTelemetry;
    engine.onDynamicEqTelemetry = packet => {
      window.__dynamicEqLive.packets += 1;
      window.__dynamicEqLive.levels = packet.levels;
      window.__dynamicEqLive.gains = packet.gains;
      receive(packet);
    };
  });
  await page.locator('[data-audio-source="sample"]').click();
  await page.locator('[data-audio-start]').click();
  await expect(page.locator('[data-audio-status]')).toHaveText('ON');
  await expect.poll(() => page.evaluate(() => window.__dynamicEqLive.packets)).toBeGreaterThan(3);
  const live = await page.evaluate(() => ({
    ...window.__dynamicEqLive,
    visibleBars: [...document.querySelectorAll('.dynamic-eq-level')].filter(bar => bar.getBoundingClientRect().height > 2).length,
    visibleGains: [...document.querySelectorAll('.dynamic-eq-gain')].filter(bar => bar.getBoundingClientRect().height > 2).length,
    background: getComputedStyle(document.querySelector('.dynamic-eq-level')).backgroundColor,
    shownLevel: document.querySelector('.dynamic-eq-level-value').textContent,
    shownGain: document.querySelector('.dynamic-eq-gain-value').textContent
  }));
  expect(live.levels.some(level => level > -90)).toBe(true);
  expect(live.gains.some(gain => gain > 0.1)).toBe(true);
  expect(live.visibleBars).toBeGreaterThan(0);
  expect(live.visibleGains).toBeGreaterThan(0);
  expect(live.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(live.shownLevel).not.toBe('−120');
  expect(live.shownGain).toContain('dB');
  await page.locator('[data-audio-stop]').click();
});
