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
    const audioIo = rect('.audio-io-bar');
    const legend = rect('.analyzer-header-controls .legend');
    const fbAll = rect('.fb-all-control');
    const devLabSelects = [...document.querySelectorAll('.dev-lab-panel select')].map(select => ({
      width: select.getBoundingClientRect().width,
      height: select.getBoundingClientRect().height
    }));
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
      panelWidth: panel.width,
      panelTop: panel.top,
      panelRight: panel.right,
      panelBottom: panel.bottom,
      audioIoTop: audioIo.top,
      analyzerHeight: rect('.fb-workspace').height,
      analyzerStatusCenter: rect('.analyzer-status').top + rect('.analyzer-status').height / 2,
      analyzerHeaderCenter: rect('.analyzer-header').top + rect('.analyzer-header').height / 2,
      legendInHeader: Boolean(document.querySelector('.analyzer-header-controls > .legend')),
      graphLegendCount: document.querySelectorAll('.analyzer > .legend').length,
      legendFbGap: fbAll.left - legend.right,
      legendCenter: legend.top + legend.height / 2,
      fbAllCenter: fbAll.top + fbAll.height / 2,
      devLabSelects,
      shellLeft: rect('.app-shell').left,
      shellRight: rect('.app-shell').right,
      graphHeight: rect('.fb-workspace').height,
      bandHeight: bands[0].height,
      bandBottom: bands[0].bottom,
      faderTrackHeights: [...document.querySelectorAll('.fader-track')].map(element => element.getBoundingClientRect().height),
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
  expect(Math.abs(layout.panelTop - layout.audioIoTop)).toBeLessThanOrEqual(2);
  expect(layout.devLabSelects).toHaveLength(20);
  expect(layout.devLabSelects.every(select => select.width === 142 && select.height === 24)).toBeTruthy();
  expect(Math.abs(layout.shellLeft - (layout.viewportWidth - layout.shellRight))).toBeLessThanOrEqual(2);
  expect(Math.abs(layout.panelBottom - layout.bandBottom)).toBeLessThanOrEqual(2);
  expect(Math.abs(layout.analyzerStatusCenter - layout.analyzerHeaderCenter)).toBeLessThanOrEqual(2);
  expect(layout.legendInHeader).toBeTruthy();
  expect(layout.graphLegendCount).toBe(0);
  expect(layout.legendFbGap).toBeGreaterThanOrEqual(16);
  expect(layout.legendFbGap).toBeLessThanOrEqual(24);
  expect(Math.abs(layout.legendCenter - layout.fbAllCenter)).toBeLessThanOrEqual(2);
  expect(layout.bandHeight).toBeGreaterThan(layout.graphHeight);
  expect(layout.faderTrackHeights).toHaveLength(10);
  expect(layout.faderTrackHeights.every(height => height === layout.faderTrackHeights[0] && height > 175)).toBeTruthy();
  expect(layout.allBandsInViewport).toBeTruthy();
  expect(layout.frequencyLabelsVisible).toBeTruthy();
  await page.locator('[data-dev-lab-toggle]').click();
  const closedLayout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
    left: document.querySelector('.app-shell').getBoundingClientRect().left,
    right: document.querySelector('.app-shell').getBoundingClientRect().right,
    panelHidden: document.querySelector('.dev-lab-panel').hidden
  }));
  expect(closedLayout.panelHidden).toBeTruthy();
  expect(closedLayout.scrollWidth).toBeLessThanOrEqual(closedLayout.clientWidth + 2);
  expect(closedLayout.scrollHeight).toBeLessThanOrEqual(closedLayout.clientHeight + 2);
  expect(Math.abs(closedLayout.left - (layout.viewportWidth - closedLayout.right))).toBeLessThanOrEqual(2);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
