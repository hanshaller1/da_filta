const { test, expect } = require('playwright/test');

const readTypography = (page, selectors) => page.evaluate(selectors => Object.fromEntries(
  Object.entries(selectors).map(([role, selector]) => {
    const element = document.querySelector(selector);
    if (!element) return [role, null];
    const style = getComputedStyle(element);
    return [role, {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      textTransform: style.textTransform,
      fontVariantNumeric: style.fontVariantNumeric
    }];
  })
), selectors);

const uiFont = '"Trebuchet MS", Arial, sans-serif';
const monoFont = 'Consolas, "Courier New", monospace';

test('central semantic roles use the typography system at the reference desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const filterbank = await readTypography(page, {
    mastheadLabel: '.audio-device-label',
    deviceSelect: '.audio-device select',
    themeSelect: '.theme-picker select',
    audioButton: '.audio-button',
    audioStatusLabel: '.audio-state span',
    audioStatusValue: '.audio-state strong',
    panelTitle: '.analyzer-title-status > strong',
    modeTab: '.mode-select',
    channelModeLabel: '.channel-mode-label',
    channelModeState: '.channel-mode-state',
    globalLabel: '.control-card .control-label',
    globalValue: '.control-card .control-row output',
    bandFrequency: '.band-card .band-value',
    classicGain: '.band-slider-value',
    perChannelGain: '.channel-fader output',
    devTitle: '.dev-lab-panel-header strong',
    devGroup: '.dev-lab-group h2',
    devLabel: '.dev-lab-control > span',
    devInput: '.dev-lab-control input[type="number"]',
    debugLog: '.response-debug-console'
  });
  expect(filterbank.mastheadLabel).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '700' });
  expect(filterbank.deviceSelect).toMatchObject({ fontFamily: uiFont, fontSize: '12px', fontWeight: '400' });
  expect(filterbank.themeSelect).toMatchObject({ fontFamily: uiFont, fontSize: '12px', fontWeight: '400' });
  expect(filterbank.audioButton).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '600' });
  expect(filterbank.audioStatusLabel).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '400' });
  expect(filterbank.audioStatusValue).toMatchObject({ fontFamily: uiFont, fontSize: '12px', fontWeight: '700' });
  expect(filterbank.panelTitle).toMatchObject({ fontFamily: uiFont, fontSize: '15px', fontWeight: '700' });
  expect(filterbank.modeTab).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '700' });
  expect(filterbank.channelModeLabel).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '700', lineHeight: '11.5px', letterSpacing: '0.55px', textTransform: 'none' });
  expect(filterbank.channelModeState).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '700', lineHeight: '11.5px', letterSpacing: '0.55px', textTransform: 'none' });
  expect(filterbank.globalLabel).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '700' });
  expect(filterbank.globalValue).toMatchObject({ fontFamily: uiFont, fontSize: '12px', fontWeight: '600', fontVariantNumeric: 'tabular-nums' });
  expect(filterbank.bandFrequency).toMatchObject({ fontFamily: uiFont, fontSize: '12px', fontWeight: '700' });
  expect(filterbank.classicGain).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '600', fontVariantNumeric: 'tabular-nums' });
  expect(filterbank.perChannelGain).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '600', fontVariantNumeric: 'tabular-nums' });
  expect(filterbank.devTitle).toMatchObject({ fontFamily: uiFont, fontSize: '15px', fontWeight: '700' });
  expect(filterbank.devGroup).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '700' });
  expect(filterbank.devLabel).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '400' });
  expect(filterbank.devInput).toMatchObject({ fontFamily: uiFont, fontSize: '11px', fontWeight: '600' });
  expect(filterbank.debugLog).toMatchObject({ fontFamily: monoFont, fontSize: '10px', fontWeight: '400' });

  await page.locator('[data-mode="filter"]').click();
  const filter = await readTypography(page, {
    panelTitle: '.filter-response > header strong',
    descriptor: '.filter-response > header span',
    axisX: '.filter-response-labels',
    axisY: '.filter-response-zero',
    marker: '.filter-frequency-marker-label',
    typeLabel: '.filter-type-control > span',
    typeGroup: '.filter-type-group > strong',
    typeOption: '.filter-type-options button',
    primaryLabel: '.filter-frequency-control > span',
    secondaryLabel: '.filter-secondary-controls .filter-parameter-control > span',
    standardValue: '.filter-secondary-controls output',
    primaryValue: '.filter-frequency-control output'
  });
  expect(filter.panelTitle).toMatchObject({ fontFamily: uiFont, fontSize: '15px', fontWeight: '700' });
  expect(filter.descriptor).toMatchObject({ fontFamily: uiFont, fontSize: '9px', fontWeight: '400' });
  expect(filter.axisX).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '600' });
  expect(filter.axisY).toMatchObject({ fontFamily: uiFont, fontSize: '8px', fontWeight: '400' });
  expect(filter.marker).toMatchObject({ fontFamily: uiFont, fontSize: '8px', fontWeight: '400' });
  expect(filter.typeLabel).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '700' });
  expect(filter.typeGroup).toMatchObject({ fontFamily: uiFont, fontSize: '9px', fontWeight: '700' });
  expect(filter.typeOption).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '600' });
  expect(filter.primaryLabel).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '700' });
  expect(filter.secondaryLabel).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '700' });
  expect(filter.standardValue).toMatchObject({ fontFamily: uiFont, fontSize: '11px', fontWeight: '600', fontVariantNumeric: 'tabular-nums' });
  expect(filter.primaryValue).toMatchObject({ fontFamily: uiFont, fontSize: '14px', fontWeight: '700', fontVariantNumeric: 'tabular-nums' });

  await page.locator('[data-mode="filterbank"]').click();
  const filterbankAxis = await readTypography(page, {
    axisX: '.analyzer-footer .axis-x',
    axisY: '.fb-workspace .axis-y'
  });
  expect(filterbankAxis.axisX).toMatchObject({ fontFamily: uiFont, fontSize: '10px', fontWeight: '600' });
  expect(filterbankAxis.axisY).toMatchObject({ fontFamily: uiFont, fontSize: '8px', fontWeight: '400' });
});

test('all ten filter types keep identical selector typography and fit the visible button groups', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-mode="filter"]').click();

  const typeIds = await page.locator('[data-filter-type]').evaluateAll(elements => elements.map(element => element.dataset.filterType));
  const expectedDisplayNames = {
    lowpass: 'LOW PASS',
    highpass: 'HIGH PASS',
    bandpass: 'BAND PASS',
    notch: 'NOTCH',
    bell: 'PEAK / BELL',
    lowshelf: 'LOW SHELF',
    highshelf: 'HIGH SHELF',
    tilt: 'TILT',
    baxandall: 'BAXANDALL / TONE',
    formant: 'FORMANT / VOWEL'
  };
  expect(typeIds).toHaveLength(10);
  expect(await page.locator('.filter-type-group > strong').allTextContents()).toEqual(['CLASSIC', 'EQ / TONE / FORMANT']);
  let baseline = null;
  for (const typeId of typeIds) {
    const option = page.locator(`[data-filter-type="${typeId}"]`);
    await expect(option).toBeVisible();
    const current = await option.evaluate(element => {
      const style = getComputedStyle(element);
      return { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight };
    });
    baseline ||= current;
    expect(current).toEqual(baseline);
    const fit = await page.locator('.filter-type-options button').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1));
    expect(fit).toBeTruthy();
    await option.click();
    await expect(option).toHaveText(expectedDisplayNames[typeId]);
    await expect(option).toHaveClass(/active/);
  }
});

test('typography changes do not introduce viewport overflow at desktop and tablet sizes', async ({ page }) => {
  for (const viewport of [[1914, 907], [1440, 900], [1914, 768], [1199, 800]]) {
    await page.setViewportSize({ width: viewport[0], height: viewport[1] });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('[data-mode="filter"]').click();
    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      modeTabOverflow: [...document.querySelectorAll('.mode-select > span')].some(element => element.scrollWidth > element.clientWidth + 1),
      channelTypographyMatchesMode: (() => {
        const mode = getComputedStyle(document.querySelector('.mode-select'));
        const properties = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform'];
        return [...document.querySelectorAll('.channel-mode-label, .channel-mode-state')].every(element => {
          const style = getComputedStyle(element);
          return properties.every(property => style[property] === mode[property]);
        });
      })(),
      filterTypeButtonOverflow: [...document.querySelectorAll('[data-filter-type]')].filter(element => element.scrollWidth > element.clientWidth + 1).map(element => ({ text: element.textContent, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
      filterTypeButtonsVisible: [...document.querySelectorAll('[data-filter-type]')].every(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }),
      bandCount: document.querySelectorAll('.band-card').length,
      bandRow: [...document.querySelectorAll('.band-card')].every(element => Math.abs(element.getBoundingClientRect().top - document.querySelector('.band-card').getBoundingClientRect().top) <= 1)
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 2);
    expect(metrics.modeTabOverflow).toBeFalsy();
    expect(metrics.channelTypographyMatchesMode, `channel typography mismatch at ${viewport.join('x')}`).toBeTruthy();
    expect(metrics.filterTypeButtonOverflow, `filter type overflow at ${viewport.join('x')}: ${JSON.stringify(metrics.filterTypeButtonOverflow)}`).toEqual([]);
    expect(metrics.filterTypeButtonsVisible).toBeTruthy();
    expect(metrics.bandCount).toBe(10);
    expect(metrics.bandRow).toBeTruthy();
  }
});
