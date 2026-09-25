const { test, expect } = require('playwright/test');

test('SPREAD uses concrete dB and materializes the authoritative L/R pair', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const spread = page.locator('[data-control="spread"]');
  await expect(spread).toHaveAttribute('min', '-6');
  await expect(spread).toHaveAttribute('max', '6');
  await expect(spread).toHaveAttribute('step', '0.1');
  const resonance = page.locator('[data-control="resonance"]');
  await expect(resonance).toHaveAttribute('min', '-1');
  await expect(resonance).toHaveAttribute('max', '1');
  await expect(resonance).toHaveAttribute('step', '0.01');
  await expect(resonance).toHaveValue('0');
  await spread.fill('6');
  await expect(page.locator('[data-output="spread"]')).toHaveText('+6.0 dB');
  const classic = await page.evaluate(() => ({ manual: window.FilterMode.getManualBandState(), effective: window.FilterMode.getAudioEngine().getEffectiveBandGains(0) }));
  expect(classic.manual.left[0]).toBeCloseTo(-50, 10);
  expect(classic.manual.right[0]).toBeCloseTo(50, 10);
  expect(classic.effective.leftDb).toBeCloseTo(-6, 10);
  expect(classic.effective.rightDb).toBeCloseTo(6, 10);
  const beforeSwitch = JSON.stringify({ left: classic.manual.left, right: classic.manual.right, effective: classic.effective });
  await page.locator('.per-channel-toggle').click();
  await expect(spread).toBeDisabled();
  await expect(page.locator('.band-fader-channel[data-band="0"][data-channel="left"]')).toHaveValue('-50');
  await expect(page.locator('.band-fader-channel[data-band="0"][data-channel="right"]')).toHaveValue('50');
  const afterSwitch = await page.evaluate(() => ({ manual: window.FilterMode.getManualBandState(), effective: window.FilterMode.getAudioEngine().getEffectiveBandGains(0) }));
  expect(JSON.stringify({ left: afterSwitch.manual.left, right: afterSwitch.manual.right, effective: afterSwitch.effective })).toBe(beforeSwitch);
});

test('P/CH edits survive CLASSIC and only a new SPREAD input overwrites them', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const spread = page.locator('[data-control="spread"]');
  await spread.fill('6');
  await page.locator('.per-channel-toggle').click();
  await page.locator('.band-fader-channel[data-band="0"][data-channel="left"]').fill('66.7');
  await page.locator('.band-fader-channel[data-band="0"][data-channel="right"]').fill('-25');
  const pchEffective = await page.evaluate(() => window.FilterMode.getAudioEngine().getEffectiveBandGains(0));
  await page.locator('.classic-channel-toggle').click();
  await expect(spread).toBeEnabled();
  await expect(spread).toHaveValue('6');
  const classic = await page.evaluate(() => ({
    effective: window.FilterMode.getAudioEngine().getEffectiveBandGains(0),
    centerControl: Number(document.querySelector('.center-fader .band-fader[data-band="0"]').value),
    markers: [...document.querySelectorAll('[data-classic-marker^="0-"]')].map(marker => marker.style.bottom)
  }));
  expect(classic.effective).toEqual(pchEffective);
  expect(classic.effective.leftDb).toBeCloseTo(8, 1);
  expect(classic.effective.rightDb).toBeCloseTo(-3, 8);
  expect(classic.centerControl).toBeCloseTo(100 * 2.5 / 12, 0);
  expect(parseFloat(classic.markers[0])).toBeCloseTo(83.35, 1);
  expect(classic.markers[1]).toBe('37.5%');
  await spread.fill('3');
  const rewritten = await page.evaluate(() => window.FilterMode.getAudioEngine().getEffectiveBandGains(0));
  expect(rewritten.leftDb).toBeCloseTo(-0.5, 1);
  expect(rewritten.rightDb).toBeCloseTo(5.5, 1);
  await spread.fill('0');
  const centered = await page.evaluate(() => window.FilterMode.getAudioEngine().getEffectiveBandGains(0));
  expect(centered.leftDb).toBeCloseTo(2.5, 1);
  expect(centered.rightDb).toBeCloseTo(2.5, 1);
  await page.locator('.per-channel-toggle').click();
  expect(await page.evaluate(() => window.FilterMode.getAudioEngine().getEffectiveBandGains(0))).toEqual(centered);
});

test('SPREAD keeps its positive and negative center anchors when one channel clamps', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const center = page.locator('.center-fader .band-fader[data-band="0"]');
  const spread = page.locator('[data-control="spread"]');
  const pair = () => page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(0).display);

  await center.fill('83.3');
  await spread.fill('6');
  let display = await pair();
  expect(display.leftDb).toBeCloseTo(4, 1);
  expect(display.rightDb).toBe(12);
  await spread.fill('3');
  display = await pair();
  expect(display.leftDb).toBeCloseTo(7, 1);
  expect(display.rightDb).toBe(12);
  await spread.fill('0');
  display = await pair();
  expect(display.leftDb).toBeCloseTo(10, 1);
  expect(display.rightDb).toBeCloseTo(10, 1);

  await center.fill('-83.3');
  await spread.fill('6');
  display = await pair();
  expect(display.leftDb).toBe(-12);
  expect(display.rightDb).toBeCloseTo(-4, 1);
  await spread.fill('0');
  display = await pair();
  expect(display.leftDb).toBeCloseTo(-10, 1);
  expect(display.rightDb).toBeCloseTo(-10, 1);
});

test('DEV SPREAD max clamping reuses the active center anchor', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const center = page.locator('.center-fader .band-fader[data-band="0"]');
  const spread = page.locator('[data-control="spread"]');
  const pair = () => page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(0).display);

  await center.fill('83.3');
  await spread.fill('5');
  await page.locator('[data-spread-max-offset-db]').evaluate(select => { select.value = '3'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(spread).toHaveValue('3');
  let display = await pair();
  expect(display.leftDb).toBeCloseTo(7, 1);
  expect(display.rightDb).toBe(12);
  await spread.fill('0');
  display = await pair();
  expect(display.leftDb).toBeCloseTo(10, 1);
  expect(display.rightDb).toBeCloseTo(10, 1);
});

test('CLASSIC center moves both stored channels by one clamped delta', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('.per-channel-toggle').click();
  await page.locator('.band-fader-channel[data-band="0"][data-channel="left"]').fill('66.7');
  await page.locator('.band-fader-channel[data-band="0"][data-channel="right"]').fill('-25');
  await page.locator('.classic-channel-toggle').click();
  await page.locator('.center-fader .band-fader[data-band="0"]').fill('37.5');
  let pair = await page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(0).display);
  expect(pair.leftDb).toBeCloseTo(10, 1);
  expect(pair.rightDb).toBeCloseTo(-1, 1);
  await page.locator('.center-fader .band-fader[data-band="0"]').fill('100');
  pair = await page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(0).display);
  expect(pair.leftDb).toBe(12);
  expect(pair.rightDb).toBeCloseTo(1, 1);
});

test('P/CH always disables SPREAD for every spectral power combination', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const spread = page.locator('[data-control="spread"]');
  await spread.fill('4');
  await page.locator('.per-channel-toggle').click();
  for (const combination of [[true, false], [false, true], [true, true], [false, false]]) {
    await page.evaluate(([filterbank, filter]) => { const engine = window.FilterMode.getAudioEngine(); engine.setFilterbankEnabled(filterbank); engine.setFilterEnabled(filter); }, combination);
    await expect(spread).toBeDisabled();
    await expect(spread).toHaveValue('4');
  }
});

test('DEV max changes the dB range, clamps SPREAD and leaves SPREAD CURVE compatibility-only', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const spread = page.locator('[data-control="spread"]');
  await spread.fill('5');
  await page.locator('[data-spread-max-offset-db]').evaluate(select => { select.value = '3'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(spread).toHaveAttribute('min', '-3');
  await expect(spread).toHaveAttribute('max', '3');
  await expect(spread).toHaveValue('3');
  await expect(page.locator('[data-output="spread"]')).toHaveText('+3.0 dB');
  const pair = await page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(0).display);
  expect(pair.leftDb).toBeCloseTo(-3, 8);
  expect(pair.rightDb).toBeCloseTo(3, 8);
  await page.locator('[data-spread-curve]').evaluate(select => { select.value = 'quadratic'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(spread).toHaveValue('3');
  expect(await page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(0).display)).toEqual(pair);
});
