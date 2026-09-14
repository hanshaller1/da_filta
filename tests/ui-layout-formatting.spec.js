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
    visibleBandTitles: document.querySelectorAll('.band-title').length,
    frequencyLabels: [...document.querySelectorAll('.band-value')].map(element => element.textContent),
    bandSliderValues: [...document.querySelectorAll('.band-slider-value')].map(element => element.textContent),
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
      widthDifference: Math.abs((inputRect.width - 4) - scaleRect.width),
      centers: spanCenters,
      track: { left: inputRect.left + 2, center: inputRect.left + inputRect.width / 2, right: inputRect.right - 2 }
    };
  }));
  expect(layout.bandHeight).toBeGreaterThan(layout.graphHeight);
  expect(layout.visibleBandTitles).toBe(0);
  expect(layout.frequencyLabels).toHaveLength(10);
  expect(layout.bandSliderValues).toEqual(Array(10).fill('0.0 dB'));
  expect(layout.panelGap).toBe('7px');
  expect(layout.zeroLabelLeft).toBe('29px');
  for (const alignment of scaleAlignment) {
    expect(alignment.widthDifference).toBeLessThanOrEqual(1);
    expect(alignment.centers[0]).toBeCloseTo(alignment.track.left, 0);
    expect(alignment.centers.at(-1)).toBeCloseTo(alignment.track.right, 0);
  }
  for (const index of [1, 3]) expect(scaleAlignment[index].centers[1]).toBeCloseTo(scaleAlignment[index].track.center, 0);
  const sliderValueAlignment = await page.evaluate(() => [...document.querySelectorAll('.control-card')].map(card => {
    const slider = card.querySelector('input[type="range"]').getBoundingClientRect();
    const value = card.querySelector('output').getBoundingClientRect();
    return Math.abs((slider.top + slider.height / 2) - (value.top + value.height / 2));
  }));
  sliderValueAlignment.forEach(difference => expect(difference).toBeLessThanOrEqual(1));
  const inputGain = page.locator('[data-control="inputGain"]');
  const inputGainOutput = page.locator('[data-output="inputGain"]');
  const inputGainWidths = [];
  for (const value of [0, 9, 10, 24]) {
    await inputGain.fill(String(value));
    inputGainWidths.push((await inputGainOutput.boundingBox()).width);
  }
  expect(new Set(inputGainWidths).size).toBe(1);
  expect(pageErrors).toEqual([]);
});
