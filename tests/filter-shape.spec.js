const { test, expect } = require('playwright/test');

test('filter shapes are finite, bounded and follow their multimode geometry', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const shape = (type, overrides = {}) => window.FilterShape.createFilterShape({
      type,
      frequencyHz: 777,
      slope: 50,
      bandwidth: 50,
      bandDefinitions: window.ResonantState.BAND_DEFINITIONS,
      maxBandCutDb: 24,
      ...overrides
    });
    return {
      lowpass: shape('lowpass'),
      highpass: shape('highpass'),
      bandpass: shape('bandpass'),
      notch: shape('notch'),
      shallow: shape('lowpass', { slope: 0 }),
      steep: shape('lowpass', { slope: 100 }),
      narrowBandpass: shape('bandpass', { bandwidth: 0 }),
      wideBandpass: shape('bandpass', { bandwidth: 100 }),
      narrowNotch: shape('notch', { bandwidth: 0 }),
      wideNotch: shape('notch', { bandwidth: 100 }),
      frequencyA: shape('lowpass', { frequencyHz: 500 }),
      frequencyB: shape('lowpass', { frequencyHz: 501 }),
      edges: [29, 11000].flatMap(frequencyHz => [0, 100].flatMap(slope => [0, 100].map(bandwidth => shape('bandpass', { frequencyHz, slope, bandwidth }))))
    };
  });

  for (const values of Object.values(result).flat(Infinity).filter(value => typeof value === 'number')) {
    expect(Number.isFinite(values)).toBeTruthy();
    expect(values).toBeGreaterThanOrEqual(-24);
    expect(values).toBeLessThanOrEqual(0);
  }
  expect(result.lowpass).toHaveLength(10);
  expect(result.lowpass.every((value, index) => index === 0 || result.lowpass[index - 1] >= value)).toBeTruthy();
  expect(result.highpass.every((value, index) => index === 0 || result.highpass[index - 1] <= value)).toBeTruthy();
  expect(result.bandpass[5]).toBeGreaterThan(result.bandpass[0]);
  expect(result.bandpass[5]).toBeGreaterThan(result.bandpass[9]);
  expect(result.notch[5]).toBeLessThan(result.notch[0]);
  expect(result.notch[5]).toBeLessThan(result.notch[9]);
  expect(Math.abs(result.steep[4] - result.steep[6])).toBeGreaterThan(Math.abs(result.shallow[4] - result.shallow[6]));
  expect(result.wideBandpass.filter(value => value > -12).length).toBeGreaterThan(result.narrowBandpass.filter(value => value > -12).length);
  expect(result.wideNotch.filter(value => value < -12).length).toBeGreaterThan(result.narrowNotch.filter(value => value < -12).length);
  expect(result.frequencyA).not.toEqual(result.frequencyB);
});

test('frequency slider mapping is logarithmic and round-trips actual Hz', async ({ page }) => {
  await page.goto('/');
  const values = await page.evaluate(() => {
    const { sliderToFrequency, frequencyToSlider } = window.FilterShape;
    return [29, 218, 777, 1500, 11000].map(frequency => ({ frequency, slider: frequencyToSlider(frequency), roundTrip: sliderToFrequency(frequencyToSlider(frequency)) }));
  });
  expect(values[0].slider).toBe(0);
  expect(values.at(-1).slider).toBe(1000);
  values.forEach(({ frequency, roundTrip }) => expect(Math.abs(roundTrip - frequency) / frequency).toBeLessThan(.004));
});

test('FILTER resonance adds bounded type-specific peaks independently from depth', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const create = (type, overrides = {}) => window.FilterShape.createFilterShape({
      type,
      frequencyHz: 777,
      slope: 50,
      bandwidth: 50,
      resonance: 0,
      depth: 100,
      bandDefinitions: window.ResonantState.BAND_DEFINITIONS,
      maxBandBoostDb: 12,
      maxBandCutDb: 12,
      ...overrides
    });
    return Object.fromEntries(['lowpass', 'highpass', 'bandpass', 'notch'].map(type => [type, {
      base: create(type),
      resonant: create(type, { resonance: 100 }),
      lowDepthHighResonance: create(type, { depth: 30, resonance: 80 })
    }]));
  });

  for (const { base, resonant, lowDepthHighResonance } of Object.values(result)) {
    expect(resonant).toHaveLength(10);
    expect(resonant.every(Number.isFinite)).toBeTruthy();
    expect(Math.max(...resonant)).toBeLessThanOrEqual(12);
    expect(Math.min(...resonant)).toBeGreaterThanOrEqual(-12);
    expect(resonant.some((value, index) => value > base[index])).toBeTruthy();
    expect(lowDepthHighResonance.some(value => value > 0)).toBeTruthy();
  }
  expect(result.lowpass.resonant[5]).toBe(12);
  expect(result.highpass.resonant[5]).toBe(12);
  expect(result.bandpass.resonant[5]).toBe(12);
  expect(result.notch.resonant[3]).toBeGreaterThan(0);
  expect(result.notch.resonant[7]).toBeGreaterThan(0);
  expect(result.notch.resonant[5]).toBeLessThan(0);
});

test('FILTER depth scales only attenuation and reaches neutral at zero without resonance', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const create = (type, depth, resonance = 0) => window.FilterShape.createFilterShape({
      type,
      frequencyHz: 777,
      slope: 50,
      bandwidth: 50,
      resonance,
      depth,
      bandDefinitions: window.ResonantState.BAND_DEFINITIONS,
      maxBandBoostDb: 24,
      maxBandCutDb: 36
    });
    return Object.fromEntries(['lowpass', 'highpass', 'bandpass', 'notch'].map(type => [type, {
      full: create(type, 100),
      half: create(type, 50),
      neutral: create(type, 0),
      resonantAtZeroDepth: create(type, 0, 100)
    }]));
  });

  for (const { full, half, neutral, resonantAtZeroDepth } of Object.values(result)) {
    full.forEach((value, index) => expect(half[index]).toBeCloseTo(value / 2, 10));
    expect(neutral).toEqual(Array(10).fill(0));
    expect(resonantAtZeroDepth.some(value => value > 0)).toBeTruthy();
    expect(Math.max(...resonantAtZeroDepth)).toBeLessThanOrEqual(24);
    expect(Math.min(...resonantAtZeroDepth)).toBeGreaterThanOrEqual(-36);
  }
});
