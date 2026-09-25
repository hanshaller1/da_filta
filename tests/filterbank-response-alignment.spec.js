const { test, expect } = require('playwright/test');

const desktopSizes = [
  { width: 1914, height: 907 },
  { width: 1440, height: 900 },
  { width: 1914, height: 768 }
];

test('FILTERBANK response uses FILTER panel and graph surfaces across desktop sizes', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  for (const size of desktopSizes) {
    await page.setViewportSize(size);
    for (const theme of ['current', 'graphite']) {
      await page.locator('[data-theme-select]').selectOption(theme);
      const layout = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect();
        const style = selector => getComputedStyle(document.querySelector(selector));
        const gap = parseFloat(style('.console').getPropertyValue('--panel-gap'));
        const workspace = box('.mode-workspace');
        const navigation = box('.mode-tabs');
        const response = box('.fb-workspace .analyzer');
        const graph = box('.fb-workspace .chart-grid');
        const controls = box('.filterbank-controls-panel');
        const header = box('.analyzer-header');
        const live = document.querySelector('.analyzer-live-status');
        const meter = box('.analyzer-feedback-energy');
        return {
          gap,
          navigationWidth: navigation.width,
          leftGap: response.left - navigation.right,
          topGap: response.top - workspace.top,
          rightGap: workspace.right - response.right,
          bottomGap: workspace.bottom - controls.bottom,
          controlsGap: controls.top - response.bottom,
          graphInset: graph.left - response.left,
          graphRightInset: response.right - graph.right,
          graphHeight: graph.height,
          headerInside: header.left >= response.left && header.right <= response.right && header.top >= response.top,
          headerControlsFit: [...document.querySelector('.analyzer-header-controls').children].every(child => child.getBoundingClientRect().right <= header.right),
          telemetryFits: live.scrollWidth <= live.clientWidth + 1,
          feedbackMeterFits: meter.left >= graph.left && meter.right <= graph.right && meter.top >= graph.top,
          pageOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
          responseStyle: {
            border: style('.fb-workspace .analyzer').borderColor,
            radius: style('.fb-workspace .analyzer').borderRadius,
            background: style('.fb-workspace .analyzer').backgroundImage !== 'none' ? style('.fb-workspace .analyzer').backgroundImage : style('.fb-workspace .analyzer').backgroundColor,
            padding: style('.fb-workspace .analyzer').padding
          },
          graphStyle: {
            background: style('.fb-workspace .chart-grid').backgroundColor,
            border: style('.fb-workspace .chart-grid').outlineColor
          }
        };
      });
      expect(layout.navigationWidth).toBe(size.width === 1440 ? 176 : 240);
      expect(layout.leftGap).toBeGreaterThanOrEqual(layout.gap);
      expect(layout.topGap).toBeGreaterThanOrEqual(layout.gap);
      expect(layout.rightGap).toBeGreaterThanOrEqual(layout.gap);
      expect(layout.bottomGap).toBeGreaterThanOrEqual(layout.gap);
      expect(layout.controlsGap).toBeCloseTo(layout.gap, 0);
      expect(layout.graphInset).toBeGreaterThan(10);
      expect(layout.graphRightInset).toBeGreaterThan(10);
      expect(layout.graphHeight).toBeGreaterThan(90);
      expect(layout.headerInside).toBe(true);
      expect(layout.headerControlsFit).toBe(true);
      expect(layout.telemetryFits).toBe(true);
      expect(layout.feedbackMeterFits).toBe(true);
      expect(layout.pageOverflow).toBe(false);
      await expect(page.locator('.filterbank-controls-panel')).toBeVisible();

      await page.locator('[data-mode="filter"]').click();
      const reference = await page.evaluate(() => {
        const panel = getComputedStyle(document.querySelector('.filter-response'));
        const graph = getComputedStyle(document.querySelector('.filter-response-chart'));
        return {
          responseStyle: {
            border: panel.borderColor,
            radius: panel.borderRadius,
            background: panel.backgroundImage !== 'none' ? panel.backgroundImage : panel.backgroundColor,
            padding: panel.padding
          },
          graphStyle: { background: graph.backgroundColor, border: graph.borderColor }
        };
      });
      expect(layout.responseStyle).toEqual(reference.responseStyle);
      expect(layout.graphStyle).toEqual(reference.graphStyle);
      await page.locator('[data-mode="filterbank"]').click();
    }
  }
});

test('FILTERBANK response keeps the theme graph surface in every preset', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  await page.goto('/', { waitUntil: 'networkidle' });
  const themes = await page.locator('[data-theme-select] option').evaluateAll(options => options.map(option => option.value).filter(value => value !== 'custom'));
  for (const theme of themes) {
    await page.locator('[data-theme-select]').selectOption(theme);
    const surfaces = await page.evaluate(() => {
      const theme = getComputedStyle(document.body);
      const response = getComputedStyle(document.querySelector('.fb-workspace .analyzer'));
      const graph = getComputedStyle(document.querySelector('.fb-workspace .chart-grid'));
      const filterResponse = getComputedStyle(document.querySelector('.filter-response'));
      const filterGraph = getComputedStyle(document.querySelector('.filter-response-chart'));
      return {
        graph: graph.backgroundColor,
        filterGraph: filterGraph.backgroundColor,
        themeGraph: theme.getPropertyValue('--graph-background').trim(),
        panel: response.backgroundImage !== 'none' ? response.backgroundImage : response.backgroundColor,
        filterPanel: filterResponse.backgroundImage !== 'none' ? filterResponse.backgroundImage : filterResponse.backgroundColor,
        themePanel: theme.getPropertyValue('--panel-background').trim(),
        grid: graph.backgroundImage
      };
    });
    expect(surfaces.graph).toBe(surfaces.filterGraph);
    expect(surfaces.panel).toBe(surfaces.filterPanel);
    expect(surfaces.themeGraph).not.toBe('');
    expect(surfaces.themePanel).not.toBe('');
    expect(surfaces.grid).not.toBe('none');
  }
});
