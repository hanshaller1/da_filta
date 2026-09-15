const { test, expect } = require('playwright/test');

test('MODE panel is absent and its height is assigned exclusively to the response graph', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  const metrics = await page.evaluate(() => {
    const height = selector => Math.round(document.querySelector(selector).getBoundingClientRect().height);
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const workspace = rect('.fb-workspace');
    const chart = rect('.chart-grid');
    const footer = rect('.analyzer-footer');
    const bands = rect('.bands');
    return {
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      workspace: Math.round(workspace.height),
      chart: Math.round(chart.height),
      header: height('.analyzer-header'),
      footer: Math.round(footer.height),
      bands: Math.round(bands.height),
      chartTop: Math.round(chart.top),
      chartBottom: Math.round(chart.bottom),
      footerTop: Math.round(footer.top),
      bandCenters: [...document.querySelectorAll('.bar-pair')].map(element => {
        const box = element.getBoundingClientRect();
        return Math.round(box.left + box.width / 2);
      }),
      axisCenters: [...document.querySelectorAll('.analyzer-footer .axis-x span')].map(element => {
        const box = element.getBoundingClientRect();
        return Math.round(box.left + box.width / 2);
      })
    };
  });
  await expect(page.locator('.mode-bar')).toHaveCount(0);
  expect(metrics.workspace).toBeGreaterThanOrEqual(300);
  expect(metrics.chart).toBeGreaterThanOrEqual(238);
  expect(metrics.header).toBe(26);
  expect(metrics.footer).toBe(28);
  expect(metrics.bands).toBe(345);
  expect(metrics.chartBottom).toBe(metrics.footerTop);
  expect(metrics.bandCenters).toEqual(metrics.axisCenters);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 2);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
