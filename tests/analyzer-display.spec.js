const { test, expect } = require('playwright/test');

test('Analyzer display layers, status strip and collapsed preview remain UI-only', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/', { waitUntil: 'networkidle' });

  const defaults = await page.evaluate(() => window.FilterbankAnalyzer.getDisplayState());
  expect(defaults).toMatchObject({ lrBars: true, peakHold: true, outputSpectrum: true, inputSpectrum: false, liveStatusStrip: true, collapsedPreview: true });
  await page.locator('.analyzer-options-toggle').click();
  for (const key of ['inputSpectrum', 'outputSpectrum', 'filterResponse', 'feedbackActivity', 'selfOscillation', 'dominantBand', 'feedbackEnergy', 'saturationIndicators', 'liveStatusStrip', 'collapsedPreview']) {
    const option = page.locator(`[data-analyzer-option="${key}"]`);
    await expect(option).toBeVisible();
    const before = await option.isChecked();
    await option.click();
    await expect(option).toBeChecked({ checked: !before });
    await option.click();
  }
  await page.locator('.analyzer-options-toggle').click();

  await page.locator('[data-control="spread"]').fill('-0.5');
  await page.locator('.band-fader').nth(3).fill('50');
  const band = page.locator('[data-analyzer-band="3"]');
  await expect.poll(() => band.getAttribute('data-delta-db')).not.toBeNull();
  const info = await page.evaluate(() => window.FilterbankAnalyzer.getBandInfo(3));
  expect(Math.abs(info.delta)).toBeGreaterThan(0);
  await band.hover();
  await expect(page.locator('.analyzer-band-detail')).toBeVisible();
  await expect(page.locator('.analyzer-live-status')).toContainText('SPREAD -50');

  await page.locator('.response-collapse-toggle').click();
  await expect(page.locator('.fb-workspace')).toHaveClass(/is-collapsed/);
  await expect(page.locator('.collapsed-analyzer-preview')).toBeVisible();
  await page.evaluate(() => window.FilterbankDebugConsole.receive({
    left: { frameCount: 64, bandEnergy: [0, 0, 0, .16, 0, 0, 0, 0, 0, 0], commonFeedbackReturn: .2, mainCommonFeedbackReturn: .1, saturationActiveFrames: 0, wetPeak: .2 },
    right: { frameCount: 64, bandEnergy: [0, 0, 0, .12, 0, 0, 0, 0, 0, 0], commonFeedbackReturn: .1, mainCommonFeedbackReturn: .05, saturationActiveFrames: 0, wetPeak: .2 }
  }));
  await expect.poll(() => page.locator('[data-collapsed-band="3"]').evaluate(element => getComputedStyle(element).getPropertyValue('--preview-level'))).not.toBe('0.000');
  await expect(page.locator('[data-collapsed-band="3"]')).toHaveAttribute('title', /218 Hz/);
  await page.locator('.response-collapse-toggle').click();
  await expect(page.locator('.collapsed-analyzer-preview')).toBeHidden();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
