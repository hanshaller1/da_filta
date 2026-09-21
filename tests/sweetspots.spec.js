const { test, expect } = require('playwright/test');

const storageKey = 'da-filta-sweetspots-v1';

test.describe('Sweetspots', () => {
  test('starts empty and saves a complete, independent snapshot', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const rows = page.locator('.sweetspot-row');
    await expect(rows).toHaveCount(4);
    await expect(page.locator('[data-sweetspot-load="A"]')).toBeDisabled();
    await expect(page.locator('[data-sweetspot-clear="A"]')).toBeDisabled();

    await page.locator('[data-sweetspot-name="A"]').fill('Aggressive RAW');
    await page.locator('[data-control="resonance"]').fill('0.65');
    await page.locator('[data-control="inputGain"]').fill('8');
    await page.locator('[data-control="dryWet"]').fill('72');
    await page.locator('[data-control="volume"]').fill('-12');
    await page.locator('.band-fader[data-band="0"]').fill('75');
    await page.locator('[data-feedback-band="0"]').click();
    await page.locator('.fb-all-toggle').click();

    const devValues = {
      '[data-feedback-topology]': 'common-bus',
      '[data-feedback-tap]': 'post-gain',
      '[data-feedback-all-engine]': 'common-bus',
      '[data-feedback-all-source]': 'post-gain-sum',
      '[data-post-gain-feedback-weight]': 'soft-knee',
      '[data-feedback-all-level]': 'sqrt2',
      '[data-wet-model]': 'filterbank-sum',
      '[data-common-bus-saturation-mode]': 'constant-ceiling',
      '[data-common-bus-drive]': '2',
      '[data-common-bus-ceiling]': '0.5',
      '[data-feedback-all-resonance-curve]': 'soft-knee',
      '[data-feedback-all-saturation-return]': 'drive-4-return-0.2',
      '[data-band-boost-db]': '24',
      '[data-band-cut-db]': '24'
    };
    for (const [selector, value] of Object.entries(devValues)) await page.locator(selector).selectOption(value);

    await page.locator('[data-sweetspot-save="A"]').click();
    await expect(page.locator('[data-sweetspot-load="A"]')).toBeEnabled();
    await expect(page.locator('[data-sweetspot-clear="A"]')).toBeEnabled();

    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    expect(saved.version).toBe(1);
    expect(saved.slots.A.name).toBe('Aggressive RAW');
    expect(saved.slots.A.state.resonance).toBeCloseTo(0.65);
    expect(saved.slots.A.state.bandGainLeft[0]).toBe(75);
    expect(saved.slots.A.state.feedbackBandLeft[0]).toBe(true);
    expect(saved.slots.A.state.feedbackAllLeft).toBe(true);
    expect(saved.slots.A.state.feedbackTopology).toBe('common-bus');
    expect(saved.slots.A.state.feedbackTap).toBe('post-gain');
    expect(saved.slots.A.state.feedbackAllEngine).toBe('common-bus');
    expect(saved.slots.A.state.feedbackAllSource).toBe('post-gain-sum');
    expect(saved.slots.A.state.postGainFeedbackWeight).toBe('soft-knee');
    expect(saved.slots.A.state.feedbackAllLevel).toBe('sqrt2');
    expect(saved.slots.A.state.wetModel).toBe('filterbank-sum');
    expect(saved.slots.A.state.commonBusSaturationMode).toBe('constant-ceiling');
    expect(saved.slots.A.state.commonBusDrive).toBe(2);
    expect(saved.slots.A.state.commonBusCeiling).toBe(0.5);
    expect(saved.slots.A.state.feedbackAllResonanceCurve).toBe('soft-knee');
    expect(saved.slots.A.state.feedbackAllSaturationReturn).toBe('drive-4-return-0.2');
    expect(saved.slots.A.state.maxBandBoostDb).toBe(24);
    expect(saved.slots.A.state.maxBandCutDb).toBe(24);
    expect(saved.slots.A.state.inputGainDb).toBe(8);
    expect(saved.slots.A.state.dryWet).toBe(72);
    expect(saved.slots.A.state.volumeDb).toBe(-12);

    await page.locator('.band-fader[data-band="0"]').fill('-50');
    await page.locator('[data-feedback-band="0"]').click();
    await page.locator('.fb-all-toggle').click();
    const afterLiveChange = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    expect(afterLiveChange.slots.A.state.bandGainLeft[0]).toBe(75);
    expect(afterLiveChange.slots.A.state.feedbackBandLeft[0]).toBe(true);
    expect(afterLiveChange.slots.A.state.feedbackAllLeft).toBe(true);
  });

  test('loads atomically through applyState, updates controls, and clear is audio-neutral', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('[data-control="resonance"]').fill('0.4');
    await page.locator('.band-fader[data-band="1"]').fill('55');
    await page.locator('[data-feedback-band="1"]').click();
    const savedDevValues = {
      '[data-reference-level]': '0.5', '[data-positive-resonance-engine]': 'phase2',
      '[data-local-loop-tuning]': 'compensated',
      '[data-feedback-topology]': 'common-bus', '[data-feedback-tap]': 'post-gain',
      '[data-feedback-core]': 'zdf',
      '[data-feedback-all-engine]': 'common-bus', '[data-feedback-all-source]': 'post-gain-sum',
      '[data-post-gain-feedback-weight]': 'soft-knee', '[data-feedback-all-level]': 'half',
      '[data-wet-model]': 'filterbank-sum', '[data-common-bus-saturation-mode]': 'constant-ceiling',
      '[data-common-bus-drive]': '2', '[data-common-bus-ceiling]': '0.5',
      '[data-feedback-all-resonance-curve]': 'soft-knee', '[data-feedback-all-saturation-return]': 'drive-4-return-0.2',
      '[data-band-boost-db]': '18', '[data-band-cut-db]': '24',
      '[data-positive-resonance-audition]': '0.20', '[data-positive-resonance-drive]': '4',
      '[data-positive-resonance-damping-floor]': '-0.05', '[data-positive-resonance-output]': 'full-nonlinear',
      '[data-positive-resonance-latency]': 'matched', '[data-positive-resonance-curve]': 'aggressive'
    };
    for (const [selector, value] of Object.entries(savedDevValues)) await page.locator(selector).selectOption(value);
    await page.locator('[data-sweetspot-save="B"]').click();

    await page.locator('[data-control="resonance"]').fill('-0.7');
    await page.locator('.band-fader[data-band="1"]').fill('-20');
    await page.locator('[data-feedback-band="1"]').click();
    await page.locator('[data-feedback-topology]').selectOption('isolated-tpt');
    await page.locator('[data-feedback-tap]').selectOption('pre-gain');
    await page.locator('[data-feedback-all-level]').selectOption('raw');

    await page.locator('[data-sweetspot-load="B"]').click();
    await expect(page.locator('[data-control="resonance"]')).toHaveValue('0.4');
    await expect(page.locator('.band-fader[data-band="1"]')).toHaveValue('55');
    await expect(page.locator('[data-feedback-all-level]')).toHaveValue('half');
    await expect(page.locator('[data-feedback-band="1"]')).toHaveClass(/active/);
    for (const [selector, value] of Object.entries(savedDevValues)) await expect(page.locator(selector)).toHaveValue(value);

    const beforeClear = await page.locator('[data-control="resonance"]').inputValue();
    await page.locator('[data-sweetspot-clear="B"]').click();
    await expect(page.locator('[data-sweetspot-load="B"]')).toBeDisabled();
    await expect(page.locator('[data-sweetspot-clear="B"]')).toBeDisabled();
    await expect(page.locator('[data-control="resonance"]')).toHaveValue(beforeClear);
    const cleared = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    expect(cleared.slots.B.state).toBeNull();
  });

  test('sanitizes non-finite numeric values during a snapshot load', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const result = await page.evaluate(() => {
      const engine = new window.AudioEngine({});
      engine.applyState({ inputGainDb: 'not-a-number', inputCharacterAmount: 'NaN', dryWet: 'Infinity', volumeDb: 'bad' });
      const state = engine.getState();
      return [state.inputGainDb, state.inputCharacterAmount, state.dryWet, state.volumeDb].map(Number.isFinite);
    });
    expect(result).toEqual([true, true, true, true]);
  });

  test('persists names and snapshots across reload, and ignores malformed storage', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('[data-sweetspot-name="C"]').fill('Open Resonance');
    await page.locator('[data-sweetspot-save="C"]').click();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-sweetspot-name="C"]')).toHaveValue('Open Resonance');
    await expect(page.locator('[data-sweetspot-load="C"]')).toBeEnabled();

    await page.evaluate(() => window.localStorage.setItem('da-filta-sweetspots-v1', '{not-json'));
    await page.reload({ waitUntil: 'networkidle' });
    for (const slot of ['A', 'B', 'C', 'D']) {
      await expect(page.locator(`[data-sweetspot-load="${slot}"]`)).toBeDisabled();
      await expect(page.locator(`[data-sweetspot-clear="${slot}"]`)).toBeDisabled();
    }
  });
});
