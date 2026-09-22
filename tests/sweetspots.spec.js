const { test, expect } = require('playwright/test');

const storageKey = 'da-filta-sweetspots-v1';
const normalControls = {
  resonance: '[data-control="resonance"]', inputGain: '[data-control="inputGain"]',
  dryWet: '[data-control="dryWet"]', spread: '[data-control="spread"]',
  volume: '[data-control="volume"]', band: '.band-fader[data-band="1"]'
};

test.describe('DEV/LAB snapshots', () => {
  test('save contains only the explicit DEV/LAB configuration', async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('[data-sweetspot-name="A"]').fill('ZDF comparison');
    await page.locator('[data-control="resonance"]').fill('0.65');
    await page.locator('[data-control="inputGain"]').fill('8');
    await page.locator('[data-control="dryWet"]').fill('72');
    await page.locator('[data-control="spread"]').fill('-0.35');
    await page.locator('[data-control="volume"]').fill('-12');
    await page.locator('.band-fader[data-band="0"]').fill('75');
    await page.locator('[data-feedback-band="0"]').click();
    await page.locator('.fb-all-toggle').click();
    await page.locator('[data-feedback-core]').selectOption('zdf');
    await page.locator('[data-feedback-topology]').selectOption('isolated-tpt');
    await page.locator('[data-feedback-tap]').selectOption('pre-gain');
    await page.locator('[data-wet-model]').selectOption('reference-delta');
    await page.locator('[data-feedback-all-engine]').selectOption('legacy');
    await page.locator('[data-feedback-all-level]').selectOption('raw');
    await page.locator('[data-spread-curve]').selectOption('quadratic');
    await page.locator('[data-spread-max-offset-db]').selectOption('9');
    await page.locator('[data-feedback-all-level]').selectOption('sqrt2');
    await page.locator('[data-sweetspot-save="A"]').click();

    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    const snapshot = saved.slots.A.state;
    expect(saved.version).toBe(1);
    expect(saved.slots.A.name).toBe('ZDF comparison');
    expect(snapshot).toMatchObject({ feedbackCore: 'zdf', feedbackTopology: 'isolated-tpt', feedbackTap: 'pre-gain', wetModel: 'reference-delta', feedbackAllEngine: 'legacy', spreadCurve: 'quadratic', spreadMaxOffsetDb: 9, feedbackAllLevel: 'sqrt2' });
    ['bandGainLeft', 'bandGainRight', 'feedbackBandLeft', 'feedbackBandRight', 'feedbackAllLeft', 'feedbackAllRight', 'resonance', 'inputGainDb', 'dryWet', 'spread', 'volumeDb', 'audioStatus', 'audioError'].forEach(key => expect(snapshot).not.toHaveProperty(key));
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('load restores DEV/LAB values while preserving normal controls and feedback state', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('[data-feedback-core]').selectOption('zdf');
    await page.locator('[data-feedback-topology]').selectOption('isolated-tpt');
    await page.locator('[data-feedback-tap]').selectOption('pre-gain');
    await page.locator('[data-wet-model]').selectOption('reference-delta');
    await page.locator('[data-feedback-all-engine]').selectOption('legacy');
    await page.locator('[data-feedback-all-level]').selectOption('raw');
    await page.locator('[data-spread-curve]').selectOption('smoothstep');
    await page.locator('[data-spread-max-offset-db]').selectOption('12');
    await page.locator('[data-sweetspot-save="B"]').click();

    await page.locator(normalControls.resonance).fill('0.82');
    await page.locator(normalControls.inputGain).fill('6');
    await page.locator(normalControls.dryWet).fill('70');
    await page.locator(normalControls.spread).fill('-0.35');
    await page.locator(normalControls.volume).fill('-9');
    await page.locator(normalControls.band).fill('-25');
    await page.locator('[data-feedback-band="1"]').click();
    await page.locator('.fb-all-toggle').click();
    await page.locator('[data-feedback-core]').selectOption('current');
    await page.locator('[data-feedback-topology]').selectOption('common-bus');
    await page.locator('[data-feedback-tap]').selectOption('post-gain');
    await page.locator('[data-wet-model]').selectOption('filterbank-sum');
    await page.locator('[data-feedback-all-engine]').selectOption('common-bus');
    await page.locator('[data-feedback-all-level]').selectOption('sqrt10');
    await page.locator('[data-spread-curve]').selectOption('linear');
    await page.locator('[data-spread-max-offset-db]').selectOption('3');

    await page.locator('[data-sweetspot-load="B"]').click();
    await expect(page.locator('[data-feedback-core]')).toHaveValue('zdf');
    await expect(page.locator('[data-feedback-topology]')).toHaveValue('isolated-tpt');
    await expect(page.locator('[data-feedback-tap]')).toHaveValue('pre-gain');
    await expect(page.locator('[data-wet-model]')).toHaveValue('reference-delta');
    await expect(page.locator('[data-feedback-all-engine]')).toHaveValue('legacy');
    await expect(page.locator('[data-feedback-all-level]')).toHaveValue('raw');
    await expect(page.locator('[data-spread-curve]')).toHaveValue('smoothstep');
    await expect(page.locator('[data-spread-max-offset-db]')).toHaveValue('12');
    await expect(page.locator(normalControls.resonance)).toHaveValue('0.82');
    await expect(page.locator(normalControls.inputGain)).toHaveValue('6');
    await expect(page.locator(normalControls.dryWet)).toHaveValue('70');
    await expect(page.locator(normalControls.spread)).toHaveValue('-0.35');
    await expect(page.locator(normalControls.volume)).toHaveValue('-9');
    await expect(page.locator(normalControls.band)).toHaveValue('-25');
    await expect(page.locator('[data-feedback-band="1"]')).toHaveClass(/active/);
    await expect(page.locator('.fb-all-toggle')).toHaveClass(/active/);
  });

  test('legacy full-state snapshots ignore normal fields and tolerate unknown fields', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(key => window.localStorage.setItem(key, JSON.stringify({ version: 1, slots: { A: { name: 'Legacy full state', state: { feedbackCore: 'zdf', spreadCurve: 'quadratic', spreadMaxOffsetDb: 9, bandGainLeft: Array(10).fill(100), bandGainRight: Array(10).fill(-100), resonance: -1, inputGainDb: 24, dryWet: 0, spread: 1, volumeDb: -60, feedbackBandLeft: Array(10).fill(true), feedbackAllLeft: true, unknownLegacyField: 'ignored' } }, B: null, C: null, D: null } })), storageKey);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator(normalControls.resonance).fill('0.82');
    await page.locator(normalControls.inputGain).fill('6');
    await page.locator(normalControls.dryWet).fill('70');
    await page.locator(normalControls.spread).fill('-0.35');
    await page.locator(normalControls.volume).fill('-9');
    await page.locator(normalControls.band).fill('-25');
    await page.locator('[data-sweetspot-load="A"]').click();

    await expect(page.locator('[data-feedback-core]')).toHaveValue('zdf');
    await expect(page.locator('[data-spread-curve]')).toHaveValue('quadratic');
    await expect(page.locator('[data-spread-max-offset-db]')).toHaveValue('9');
    for (const [key, value] of Object.entries({ resonance: '0.82', inputGain: '6', dryWet: '70', spread: '-0.35', volume: '-9', band: '-25' })) await expect(page.locator(normalControls[key])).toHaveValue(value);
  });

  test('persists names and ignores malformed storage', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('[data-sweetspot-name="C"]').fill('Experiment C');
    await page.locator('[data-sweetspot-save="C"]').click();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-sweetspot-name="C"]')).toHaveValue('Experiment C');
    await expect(page.locator('[data-sweetspot-load="C"]')).toBeEnabled();
    await page.evaluate(() => window.localStorage.setItem('da-filta-sweetspots-v1', '{not-json'));
    await page.reload({ waitUntil: 'networkidle' });
    for (const slot of ['A', 'B', 'C', 'D']) await expect(page.locator(`[data-sweetspot-load="${slot}"]`)).toBeDisabled();
  });
});
