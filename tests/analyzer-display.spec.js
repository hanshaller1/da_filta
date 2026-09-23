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
  const popoverBounds = await page.locator('.analyzer-options-popover').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  expect(popoverBounds.left).toBeGreaterThanOrEqual(0);
  expect(popoverBounds.top).toBeGreaterThanOrEqual(0);
  expect(popoverBounds.right).toBeLessThanOrEqual(popoverBounds.viewportWidth);
  expect(popoverBounds.bottom).toBeLessThanOrEqual(popoverBounds.viewportHeight);
  const headerLayout = await page.evaluate(() => {
    const title = document.querySelector('.analyzer-title-status > strong').getBoundingClientRect();
    const status = document.querySelector('.analyzer-live-status').getBoundingClientRect();
    const header = document.querySelector('.analyzer-header');
    return { title, status, flexWrap: getComputedStyle(header).flexWrap };
  });
  expect(headerLayout.status.left).toBeGreaterThan(headerLayout.title.right);
  expect(Math.abs(headerLayout.status.top - headerLayout.title.top)).toBeLessThanOrEqual(4);
  expect(headerLayout.flexWrap).toBe('nowrap');
  for (const theme of ['pro-console', 'graphite', 'clean-modern', 'analog-inspired', 'ultraviolet']) {
    await page.locator('[data-theme-select]').selectOption(theme);
    const colors = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return [style.getPropertyValue('--graph-left-color').trim(), style.getPropertyValue('--graph-right-color').trim()];
    });
    colors.forEach(color => expect(color).toMatch(/^#[0-9a-f]{6}$/i));
  }
  await page.locator('[data-theme-select]').selectOption('current');
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
  await expect.poll(() => page.locator('.collapsed-analyzer-preview svg path').getAttribute('d')).toBe('M0.0 35.0 L50.0 35.0 L150.0 35.0 L250.0 35.0 L350.0 35.0 L450.0 35.0 L550.0 35.0 L650.0 35.0 L750.0 35.0 L850.0 35.0 L950.0 35.0 L1000.0 35.0');
  await page.evaluate(() => window.FilterbankDebugConsole.receive({
    left: { frameCount: 64, bandEnergy: Array(10).fill(1e-12) },
    right: { frameCount: 64, bandEnergy: Array(10).fill(1e-12) }
  }));
  await expect.poll(() => page.locator('[data-collapsed-band="9"]').evaluate(element => getComputedStyle(element).getPropertyValue('--preview-level'))).toBe('0.000');
  await page.evaluate(() => window.FilterbankDebugConsole.receive({
    left: { frameCount: 64, bandEnergy: [0, 0, 0, .16, 0, 0, 0, 0, 0, 0], commonFeedbackReturn: .2, mainCommonFeedbackReturn: .1, saturationActiveFrames: 0, wetPeak: .2 },
    right: { frameCount: 64, bandEnergy: [0, 0, 0, .12, 0, 0, 0, 0, 0, 0], commonFeedbackReturn: .1, mainCommonFeedbackReturn: .05, saturationActiveFrames: 0, wetPeak: .2 }
  }));
  await expect.poll(() => page.locator('[data-collapsed-band="3"]').evaluate(element => getComputedStyle(element).getPropertyValue('--preview-level'))).not.toBe('0.000');
  await expect.poll(() => page.locator('.collapsed-analyzer-preview svg path').getAttribute('d')).toMatch(/^M0\.0 [\d.]+(?: L\d+\.0 [\d.]+){11}$/);
  const pathPoints = await page.locator('.collapsed-analyzer-preview svg path').evaluate(path => [...path.getAttribute('d').matchAll(/[ML](\d+\.\d) (\d+\.\d)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) })));
  expect(pathPoints[0]).toEqual({ x: 0, y: pathPoints[1].y });
  expect(pathPoints.at(-1)).toEqual({ x: 1000, y: pathPoints.at(-2).y });
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
    ['peakHold', 'feedbackActivity', 'selfOscillation', 'dominantBand', 'feedbackEnergy', 'saturationIndicators', 'inputSpectrum', 'outputSpectrum', 'filterResponse'].forEach(key => window.FilterbankAnalyzer.setDisplayOption(key, true));
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
  await expect(page.locator('.analyzer-band-detail')).toBeHidden();
  await page.evaluate(() => window.FilterbankAnalyzer.setDisplayOption('peakHold', false));
  await expect(page.locator('.chart-grid')).toHaveClass(/hide-peak-hold/);
  expect(pageErrors).toEqual([]);
});

test('Analyzer VIEW popover remains reachable within a tablet viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 720 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('.analyzer-options-toggle').click();
  const bounds = await page.locator('.analyzer-options-popover').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
  const lastOption = page.locator('[data-analyzer-option="collapsedPreview"]');
  await lastOption.scrollIntoViewIfNeeded();
  await expect(lastOption).toBeVisible();
});

test('FILTERBANK display L/R control bars are immediate while peak and preview animation stay independent', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const fader = page.locator('.center-fader .band-fader').nth(3);
  const bars = page.locator('[data-analyzer-band="3"] i[data-channel]');

  await fader.fill('100');
  await expect(bars.nth(0)).toHaveAttribute('style', /height: 50%/);
  await expect(bars.nth(1)).toHaveAttribute('style', /height: 50%/);
  const visiblePositive = await bars.nth(0).evaluate(element => {
    const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
    return { background: style.background, opacity: Number(style.opacity), height: rect.height };
  });
  expect(visiblePositive.background).not.toBe('none');
  expect(visiblePositive.opacity).toBeGreaterThan(0);
  expect(visiblePositive.height).toBeGreaterThan(0);
  await fader.fill('0');
  await expect(bars.nth(0)).toHaveAttribute('style', /height: 0%/);
  await expect(bars.nth(1)).toHaveAttribute('style', /height: 0%/);
  await fader.fill('50');
  await expect(bars.nth(0)).toHaveAttribute('style', /height: 25%/);
  await expect(bars.nth(1)).toHaveAttribute('style', /height: 25%/);
  await fader.fill('-50');
  await expect(bars.nth(0)).toHaveAttribute('style', /height: 25%/);
  await expect(bars.nth(0)).toHaveClass(/negative/);
  await fader.fill('-100');
  await expect(bars.nth(0)).toHaveAttribute('style', /height: 50%/);
  await expect(bars.nth(0)).toHaveClass(/negative/);
  const visibleNegative = await bars.nth(0).evaluate(element => {
    const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
    return { background: style.background, opacity: Number(style.opacity), height: rect.height, top: rect.top };
  });
  expect(visibleNegative.background).not.toBe('none');
  expect(visibleNegative.opacity).toBeGreaterThan(0);
  expect(visibleNegative.height).toBeGreaterThan(0);

  await page.locator('[data-control="spread"]').fill('-0.5');
  await fader.fill('0');
  await expect.poll(async () => ({ left: await bars.nth(0).getAttribute('style'), right: await bars.nth(1).getAttribute('style') })).toEqual({ left: 'height: 12.5%;', right: 'height: 12.5%;' });
  await expect(bars.nth(0)).not.toHaveClass(/negative/);
  await expect(bars.nth(1)).toHaveClass(/negative/);
  const spreadBars = await bars.evaluateAll(items => items.map(element => {
    const style = getComputedStyle(element); return { background: style.background, opacity: Number(style.opacity), height: element.getBoundingClientRect().height };
  }));
  spreadBars.forEach(bar => { expect(bar.background).not.toBe('none'); expect(bar.opacity).toBeGreaterThan(0); expect(bar.height).toBeGreaterThan(0); });

  await fader.dispatchEvent('pointerdown');
  await fader.dispatchEvent('pointermove');
  await fader.fill('30');
  await fader.dispatchEvent('change');
  await fader.dispatchEvent('pointerup');
  await expect(page.locator('.analyzer-band-detail')).toBeHidden();
  await bars.nth(0).hover();
  await expect(page.locator('.analyzer-band-detail')).toBeVisible();
  await page.mouse.move(2, 2);
  await expect(page.locator('.analyzer-band-detail')).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test('analyzer zero bars have no enhanced decoration while small signed values remain visible', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const fader = page.locator('.band-fader').first();
  const bars = page.locator('[data-analyzer-band="0"] i[data-channel]');

  const snapshot = async () => bars.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    return {
      className: element.className,
      height: element.getBoundingClientRect().height,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      opacity: Number(style.opacity),
      backgroundColor: style.backgroundColor
    };
  }));

  for (const theme of ['current', 'dark-studio', 'forest']) {
    await page.locator('[data-theme-select]').selectOption(theme);
    await expect(bars.nth(0)).toHaveClass(/is-zero/);
    await expect(bars.nth(1)).toHaveClass(/is-zero/);
    for (const bar of await snapshot()) {
      expect(bar.className).toContain('is-zero');
      expect(bar.height).toBe(0);
      expect(bar.borderTopWidth).toBe('0px');
      expect(bar.boxShadow).toBe('none');
      expect(bar.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    }

    await fader.fill('1');
    for (const bar of await snapshot()) {
      expect(bar.className).not.toContain('is-zero');
      expect(bar.height).toBeGreaterThan(0);
      expect(bar.opacity).toBeGreaterThan(0);
    }

    await fader.fill('-1');
    for (const bar of await snapshot()) {
      expect(bar.className).not.toContain('is-zero');
      expect(bar.height).toBeGreaterThan(0);
      expect(bar.opacity).toBeGreaterThan(0);
    }

    await fader.fill('0');
  }

  await page.evaluate(() => window.FilterbankAnalyzer.setDisplayOption('enhancedBars', false));
  await expect(bars.nth(0)).toHaveClass(/is-zero/);
  await expect.poll(async () => (await snapshot()).map(bar => bar.boxShadow)).toEqual(['none', 'none']);
  for (const bar of await snapshot()) {
    expect(bar.height).toBe(0);
    expect(bar.borderTopWidth).toBe('0px');
    expect(bar.boxShadow).toBe('none');
    expect(bar.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  }

  const zeroLine = await page.locator('.chart-grid').evaluate(element => {
    const style = getComputedStyle(element, '::after');
    return { display: style.display, height: style.height };
  });
  expect(zeroLine).toEqual({ display: 'block', height: '1px' });
});
