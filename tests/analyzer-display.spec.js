const { test, expect } = require('playwright/test');

test('Analyzer display layers, status strip and collapsed preview remain UI-only', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/', { waitUntil: 'networkidle' });

  const defaults = await page.evaluate(() => window.FilterbankAnalyzer.getDisplayState());
  expect(defaults).toMatchObject({ lrBars: true, peakHold: true, outputSpectrum: true, inputSpectrum: false, liveStatusStrip: true, collapsedPreview: true, spectrumFill: true, spectrumTrail: false, energyBloom: false, peakMarkers: false, enhancedBars: true });
  await expect(page.locator('.analyzer-status')).toHaveCount(0);
  await expect(page.locator('.analyzer > .legend')).toHaveCount(0);
  await expect(page.locator('.analyzer-footer .axis-x')).toHaveText(/29 Hz\s*61 Hz\s*115 Hz\s*218 Hz\s*411 Hz\s*777 Hz\s*1\.5 kHz\s*2\.8 kHz\s*5\.2 kHz\s*11 kHz/);
  await page.locator('.analyzer-options-toggle').click();
  for (const key of ['frequencyLabels', 'inputSpectrum', 'outputSpectrum', 'filterResponse', 'feedbackActivity', 'selfOscillation', 'dominantBand', 'feedbackEnergy', 'saturationIndicators', 'spectrumFill', 'spectrumTrail', 'energyBloom', 'peakMarkers', 'enhancedBars', 'liveStatusStrip', 'collapsedPreview']) {
    const option = page.locator(`[data-analyzer-option="${key}"]`);
    await expect(option).toBeVisible();
    const before = await option.isChecked();
    await option.click();
    await expect(option).toBeChecked({ checked: !before });
    if (key === 'frequencyLabels') await expect(page.locator('.analyzer-footer')).toHaveClass(/hide-frequency-labels/);
    await option.click();
  }
  await page.locator('.analyzer-options-toggle').click();

  await page.locator('[data-control="spread"]').fill('-0.5');
  await page.locator('.band-fader').nth(3).fill('50');
  const band = page.locator('[data-analyzer-band="3"]');
  await expect.poll(() => band.getAttribute('data-delta-db')).not.toBeNull();
  const info = await page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(3));
  expect(Math.abs(info.delta)).toBeGreaterThan(0);
  const positions = await band.locator('i[data-channel]').evaluateAll(items => items.map(item => item.getBoundingClientRect().left));
  expect(positions[0]).toBeLessThan(positions[1]);
  await band.hover();
  await expect(page.locator('.analyzer-band-detail')).toBeVisible();
  await page.mouse.move(2, 2);
  await expect(page.locator('.analyzer-band-detail')).toBeHidden();
  await band.hover();
  await expect(page.locator('.analyzer-band-detail')).toBeVisible();
  await page.locator('.analyzer-options-toggle').click();
  await expect(page.locator('.analyzer-band-detail')).toBeHidden();
  await page.locator('.analyzer-options-toggle').click();
  await band.hover();
  await expect(page.locator('.analyzer-band-detail')).toBeVisible();
  await expect(page.locator('.analyzer-live-status')).toContainText('SPREAD -50');

  await page.locator('.response-collapse-toggle').click();
  await expect(page.locator('.fb-workspace')).toHaveClass(/is-collapsed/);
  await expect.poll(() => page.locator('.analyzer-footer').evaluate(element => getComputedStyle(element, '::before').display)).toBe('none');
  await expect(page.locator('.analyzer-band-detail')).toBeHidden();
  await expect(page.locator('.collapsed-analyzer-preview')).toBeVisible();
  await page.evaluate(() => window.FilterbankDebugConsole.receive({
    left: { frameCount: 64, bandEnergy: [0, 0, 0, .16, 0, 0, 0, 0, 0, 0], commonFeedbackReturn: .2, mainCommonFeedbackReturn: .1, saturationActiveFrames: 0, wetPeak: .2 },
    right: { frameCount: 64, bandEnergy: [0, 0, 0, .12, 0, 0, 0, 0, 0, 0], commonFeedbackReturn: .1, mainCommonFeedbackReturn: .05, saturationActiveFrames: 0, wetPeak: .2 }
  }));
  await expect.poll(() => page.locator('[data-collapsed-band="3"]').evaluate(element => getComputedStyle(element).getPropertyValue('--preview-level'))).not.toBe('0.000');
  await expect.poll(() => page.locator('.collapsed-analyzer-preview svg path').getAttribute('d')).toMatch(/L/);
  await expect(page.locator('[data-collapsed-band="3"]')).toHaveAttribute('title', /218 Hz/);
  await page.locator('[data-collapsed-band="3"]').hover();
  await expect(page.locator('.collapsed-analyzer-detail')).toBeVisible();
  await page.mouse.move(2, 2);
  await expect(page.locator('.collapsed-analyzer-detail')).toBeHidden();
  await page.locator('.response-collapse-toggle').click();
  await expect(page.locator('.collapsed-analyzer-preview')).toBeHidden();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Analyzer diagnostic overlays bind to existing telemetry without changing audio state', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-feedback-band="3"]').click();
  await page.evaluate(() => {
    ['peakHold', 'liveEditValues', 'feedbackActivity', 'selfOscillation', 'dominantBand', 'feedbackEnergy', 'saturationIndicators', 'inputSpectrum', 'outputSpectrum', 'filterResponse'].forEach(key => window.FilterbankAnalyzer.setDisplayOption(key, true));
    window.FilterbankDebugConsole.receive({
      left: { frameCount: 64, bandEnergy: [0, 0, 0, .2, 0, 0, 0, 0, 0, 0], commonFeedbackReturn: .3, mainCommonFeedbackReturn: .15, saturationActiveFrames: 8, wetPeak: 1 },
      right: { frameCount: 64, bandEnergy: [0, 0, 0, .16, 0, 0, 0, 0, 0, 0], commonFeedbackReturn: .2, mainCommonFeedbackReturn: .1, saturationActiveFrames: 4, wetPeak: 1 }
    });
    window.FilterbankAnalyzer.refresh();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.FilterbankDebugConsole.receive({
    left: { frameCount: 64, bandEnergy: [0, 0, 0, .2, 0, 0, 0, 0, 0, 0], commonFeedbackReturn: .3, mainCommonFeedbackReturn: .15, saturationActiveFrames: 8, wetPeak: 1 },
    right: { frameCount: 64, bandEnergy: [0, 0, 0, .16, 0, 0, 0, 0, 0, 0], commonFeedbackReturn: .2, mainCommonFeedbackReturn: .1, saturationActiveFrames: 4, wetPeak: 1 }
  }));
  await page.evaluate(() => window.FilterbankAnalyzer.refresh());
  const band = page.locator('[data-analyzer-band="3"]');
  await expect(band).toHaveClass(/has-feedback/);
  await expect(band).toHaveClass(/is-dominant/);
  await expect(band).toHaveClass(/is-oscillating/);
  await expect(page.locator('.analyzer-feedback-energy')).toBeVisible();
  await expect(page.locator('.analyzer-saturation-indicator')).toBeVisible();
  expect(await page.locator('.analyzer-feedback-energy').evaluate(element => getComputedStyle(element).top)).toBe('4px');
  expect(await page.locator('.analyzer-feedback-energy').evaluate(element => {
    const chart = element.closest('.chart-grid').getBoundingClientRect();
    return Math.round(element.getBoundingClientRect().top - chart.top);
  })).toBe(4);
  await page.locator('.band-fader').nth(3).fill('30');
  await expect(page.locator('.analyzer-band-detail')).toBeVisible();
  await page.evaluate(() => window.FilterbankAnalyzer.setDisplayOption('liveEditValues', false));
  await page.locator('.band-fader').nth(3).fill('40');
  await expect(page.locator('.analyzer-band-detail')).toBeHidden();
  await page.evaluate(() => window.FilterbankAnalyzer.setDisplayOption('peakHold', false));
  await expect(page.locator('.chart-grid')).toHaveClass(/hide-peak-hold/);
  expect(pageErrors).toEqual([]);
});

test('effective L/R control bars are immediate while peak and preview animation stay independent', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const fader = page.locator('.band-fader').nth(3);
  const bars = page.locator('[data-analyzer-band="3"] i[data-channel]');

  await fader.fill('100');
  await expect(bars.nth(0)).toHaveAttribute('style', /height: 50%/);
  await expect(bars.nth(1)).toHaveAttribute('style', /height: 50%/);
  await fader.fill('0');
  await expect(bars.nth(0)).toHaveAttribute('style', /height: 0%/);
  await expect(bars.nth(1)).toHaveAttribute('style', /height: 0%/);
  await fader.fill('-100');
  await expect(bars.nth(0)).toHaveAttribute('style', /height: 50%/);
  await expect(bars.nth(0)).toHaveClass(/negative/);

  await page.locator('[data-control="spread"]').fill('-0.5');
  await fader.fill('0');
  await expect.poll(async () => ({ left: await bars.nth(0).getAttribute('style'), right: await bars.nth(1).getAttribute('style') })).toEqual({ left: 'height: 12.5%;', right: 'height: 12.5%;' });
  await expect(bars.nth(0)).not.toHaveClass(/negative/);
  await expect(bars.nth(1)).toHaveClass(/negative/);

  await fader.fill('30');
  await expect.poll(() => page.evaluate(() => window.FilterbankAnalyzer.getDetailState().mode)).toBe('live-edit');
  await fader.dispatchEvent('pointerup');
  await expect(page.locator('.analyzer-band-detail')).toBeHidden({ timeout: 900 });
  expect(pageErrors).toEqual([]);
});
