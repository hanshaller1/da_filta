const { test, expect } = require('playwright/test');

test('compact UI keeps normalized resonance and spread display formatting', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });

  const resonance = page.locator('[data-control="resonance"]');
  const spread = page.locator('[data-control="spread"]');
  const setAndRead = async (control, output, value) => {
    await control.fill(String(value));
    return output.textContent();
  };
  const resonanceOutput = page.locator('[data-output="resonance"]');
  const spreadOutput = page.locator('[data-output="spread"]');
  for (const [value, expected] of [[0, '0'], [0.99, '0.99'], [1, '1'], [-0.99, '-0.99'], [-1, '-1']]) {
    expect(await setAndRead(resonance, resonanceOutput, value)).toBe(expected);
    expect(await setAndRead(spread, spreadOutput, value)).toBe(expected);
  }

  const layout = await page.evaluate(() => ({
    graphHeight: document.querySelector('.fb-workspace').getBoundingClientRect().height,
    bandHeight: document.querySelector('.band-card').getBoundingClientRect().height,
    panelGap: getComputedStyle(document.querySelector('.global-controls')).gap,
    zeroLabelLeft: getComputedStyle(document.querySelector('.fader-track'), '::after').left
  }));
  const scaleAlignment = await page.evaluate(() => [...document.querySelectorAll('.control-card')].map(card => {
    const input = card.querySelector('input[type="range"]');
    const scale = card.querySelector('.control-scale');
    const inputRect = input.getBoundingClientRect();
    const scaleRect = scale.getBoundingClientRect();
    const spanCenters = [...scale.querySelectorAll(':scope > span')].map(span => {
      const rect = span.getBoundingClientRect();
      return rect.left + rect.width / 2;
    });
    return {
      widthDifference: Math.abs(inputRect.width - scaleRect.width),
      leftDifference: Math.abs(inputRect.left - scaleRect.left),
      centers: spanCenters,
      track: { left: inputRect.left + 2, center: inputRect.left + inputRect.width / 2, right: inputRect.right - 2 }
    };
  }));
  expect(layout.graphHeight).toBeGreaterThan(layout.bandHeight);
  expect(layout.panelGap).toBe('7px');
  expect(layout.zeroLabelLeft).toBe('29px');
  for (const alignment of scaleAlignment) {
    expect(alignment.widthDifference).toBeLessThanOrEqual(1);
    expect(alignment.leftDifference).toBeLessThanOrEqual(1);
    expect(alignment.centers[0]).toBeCloseTo(alignment.track.left, 0);
    expect(alignment.centers.at(-1)).toBeCloseTo(alignment.track.right, 0);
  }
  for (const index of [1, 3]) expect(scaleAlignment[index].centers[1]).toBeCloseTo(scaleAlignment[index].track.center, 0);
  expect(pageErrors).toEqual([]);
});
