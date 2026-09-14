const { test, expect } = require('playwright/test');

test('desktop viewport contains the complete open DEV/LAB layout', async ({ page }) => {
  await page.setViewportSize({ width: 1914, height: 907 });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/', { waitUntil: 'networkidle' });

  const layout = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const bands = [...document.querySelectorAll('.band-card')].map(element => element.getBoundingClientRect());
    const panel = rect('.dev-lab-panel');
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
      panelWidth: panel.width,
      panelRight: panel.right,
      graphHeight: rect('.fb-workspace').height,
      bandHeight: bands[0].height,
      allBandsInViewport: bands.every(band => band.left >= -1 && band.right <= window.innerWidth + 1 && band.bottom <= window.innerHeight + 1),
      frequencyLabelsVisible: [...document.querySelectorAll('.band-value')].every(element => {
        const band = element.closest('.band-card').getBoundingClientRect();
        const label = element.getBoundingClientRect();
        return label.bottom <= band.bottom + 1 && label.bottom <= window.innerHeight + 1;
      })
    };
  });

  await page.screenshot({ path: 'tests/artifacts/dev-lab-viewport-1914x907.png', fullPage: false });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 2);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 2);
  expect(layout.panelWidth).toBeGreaterThanOrEqual(280);
  expect(layout.panelRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.graphHeight).toBeGreaterThan(layout.bandHeight);
  expect(layout.allBandsInViewport).toBeTruthy();
  expect(layout.frequencyLabelsVisible).toBeTruthy();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
