const { test, expect } = require('playwright/test');

test('FILTERBANK RESPONSE collapses visually without resetting control state', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const metrics = () => page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const type = selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return { fontSize: style.fontSize, fontWeight: style.fontWeight };
    };
    const rectSnapshot = target => {
      const { x, y, width, height } = typeof target === 'string'
        ? rect(target)
        : target.getBoundingClientRect();
      return { x, y, width, height };
    };
    const bands = [...document.querySelectorAll('.band-card')].map(element => element.getBoundingClientRect());
    const tracks = [...document.querySelectorAll('.fader-track')].map(element => element.getBoundingClientRect().height);
    const panel = rect('.dev-lab-panel');
    const footer = document.querySelector('.analyzer-footer');
    const footerRect = footer.getBoundingClientRect();
    const firstAxisNumber = document.querySelector('.analyzer-footer .axis-x span').getBoundingClientRect();
    const collapsed = document.querySelector('.fb-workspace').classList.contains('is-collapsed');
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
      workspaceHeight: rect('.fb-workspace').height,
      chartVisible: getComputedStyle(document.querySelector('.chart-grid')).display !== 'none',
      axisLabels: [...document.querySelectorAll('.analyzer-footer .axis-x span')].map(element => element.textContent),
      axisBandCenterOffsets: [...document.querySelectorAll('.analyzer-footer .axis-x span')].map((element, index) => {
        const axisRect = element.getBoundingClientRect();
        const bandRect = bands[index];
        return Math.abs((axisRect.left + axisRect.width / 2) - (bandRect.left + bandRect.width / 2));
      }),
      bandHeight: bands[0].height,
      bandBottom: bands[0].bottom,
      faderHeight: tracks[0],
      allTracksEqual: tracks.every(height => height === tracks[0]),
      panelTop: panel.top,
      panelBottom: panel.bottom,
      audioIoTop: rect('.audio-io-bar').top,
      analyzerHeight: rect('.analyzer').height,
      headerHeight: rect('.analyzer-header').height,
      headerBottom: rect('.analyzer-header').bottom,
      chartHeight: rect('.chart-grid').height,
      footerHeight: footerRect.height,
      footerTop: footerRect.top,
      footerSeparatorTop: footerRect.top + (collapsed ? parseFloat(getComputedStyle(footer, '::before').top) : 0),
      firstAxisNumberTop: firstAxisNumber.top,
      firstAxisNumberBottom: firstAxisNumber.bottom,
      analyzerBottom: rect('.analyzer').bottom,
      axisTypography: type('.analyzer-footer .axis-x'),
      frequencyTypography: type('.band-value'),
      headerElements: {
        title: rectSnapshot('.analyzer-title-status strong'),
        mode: rectSnapshot('.analyzer-status span:nth-child(1)'),
        screen: rectSnapshot('.analyzer-status span:nth-child(2)'),
        channel: rectSnapshot('.analyzer-status span:nth-child(3)'),
        spread: rectSnapshot('.analyzer-status span:nth-child(4)'),
        legend: rectSnapshot('.analyzer-header-controls .legend'),
        fbAll: rectSnapshot('.fb-all-control span'),
        fbAllButton: rectSnapshot('.fb-all-toggle'),
        collapse: rectSnapshot('.response-collapse-toggle')
      },
      axisPositions: [...document.querySelectorAll('.analyzer-footer .axis-x span')].map(rectSnapshot)
    };
  });

  const toggle = page.locator('.response-collapse-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-label', 'Filterbank response einklappen');
  await toggle.focus();
  await expect(toggle).toBeFocused();
  const expanded = await metrics();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'tests/artifacts/filterbank-response-expanded-1914x907.png', fullPage: true });

  const faders = page.locator('.band-fader');
  const feedback = page.locator('[data-feedback-band]');
  const modulation = page.locator('[data-mod-band]');
  await faders.nth(0).fill('40');
  await faders.nth(4).fill('-30');
  await feedback.nth(2).click();
  await modulation.nth(6).click();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-label', 'Filterbank response ausklappen');
  await expect(page.locator('.chart-grid')).toBeHidden();
  const collapsed = await metrics();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'tests/artifacts/filterbank-response-collapsed-1914x907.png', fullPage: true });

  expect(expanded.chartVisible).toBeTruthy();
  expect(collapsed.chartVisible).toBeFalsy();
  expect(expanded.axisLabels).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  expect(collapsed.axisLabels).toEqual(expanded.axisLabels);
  expect(expanded.axisTypography).toEqual(expanded.frequencyTypography);
  expect(collapsed.axisTypography).toEqual(expanded.axisTypography);
  expect(collapsed.axisBandCenterOffsets.every(offset => offset <= 2), JSON.stringify(collapsed.axisBandCenterOffsets)).toBeTruthy();
  for (const name of Object.keys(expanded.headerElements)) {
    expect(Math.abs(collapsed.headerElements[name].x - expanded.headerElements[name].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsed.headerElements[name].y - expanded.headerElements[name].y)).toBeLessThanOrEqual(1);
  }
  collapsed.axisPositions.forEach((position, index) => {
    expect(Math.abs(position.x - expanded.axisPositions[index].x)).toBeLessThanOrEqual(1);
  });
  expect(collapsed.workspaceHeight).toBeLessThan(expanded.workspaceHeight);
  expect(collapsed.chartHeight).toBe(0);
  expect(collapsed.footerSeparatorTop - collapsed.headerBottom).toBeGreaterThanOrEqual(4);
  expect(collapsed.footerSeparatorTop - collapsed.headerBottom).toBeLessThanOrEqual(6);
  expect(collapsed.firstAxisNumberTop - collapsed.footerSeparatorTop).toBeGreaterThanOrEqual(5);
  expect(collapsed.firstAxisNumberTop - collapsed.footerSeparatorTop).toBeLessThanOrEqual(8);
  expect(collapsed.analyzerBottom - collapsed.firstAxisNumberBottom).toBeGreaterThanOrEqual(4);
  expect(collapsed.analyzerBottom - collapsed.firstAxisNumberBottom).toBeLessThanOrEqual(6);
  expect(collapsed.bandHeight).toBeGreaterThan(expanded.bandHeight + 100);
  expect(collapsed.faderHeight).toBeGreaterThan(expanded.faderHeight + 100);
  expect(collapsed.allTracksEqual).toBeTruthy();
  for (const layout of [expanded, collapsed]) {
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 2);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 2);
    expect(Math.abs(layout.panelTop - layout.audioIoTop)).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.panelBottom - layout.bandBottom)).toBeLessThanOrEqual(2);
  }
  await expect(faders.nth(0)).toHaveValue('40');
  await expect(faders.nth(4)).toHaveValue('-30');
  await expect(feedback.nth(2)).toHaveClass(/active/);
  await expect(modulation.nth(6)).toHaveClass(/active/);
  await expect(page.locator('[data-band-value="0"]')).toHaveText('+4.8 dB');
  await expect(page.locator('[data-band-value="4"]')).toHaveText('-3.6 dB');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.chart-grid')).toBeVisible();
  await expect(faders.nth(0)).toHaveValue('40');
  await expect(faders.nth(4)).toHaveValue('-30');
  await expect(feedback.nth(2)).toHaveClass(/active/);
  await expect(modulation.nth(6)).toHaveClass(/active/);
  await expect(page.locator('[data-band-value="0"]')).toHaveText('+4.8 dB');
  await expect(page.locator('[data-band-value="4"]')).toHaveText('-3.6 dB');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
