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

test('the four classic shapes keep their pre-extension reference values', async ({ page }) => {
  await page.goto('/');
  const actual = await page.evaluate(() => Object.fromEntries(['lowpass', 'highpass', 'bandpass', 'notch'].map(type => [type, window.FilterShape.createFilterShape({
    type, frequencyHz: 777, slope: 50, bandwidth: 50, resonance: 35, depth: 70,
    bandDefinitions: window.ResonantState.BAND_DEFINITIONS, maxBandBoostDb: 12, maxBandCutDb: 24
  })])));
  const reference = {
    lowpass: [0, 0, 0, 0.000005642245418583282, 0.10701225923013899, -3.4555040295233432, -16.594027381432905, -16.799989224032803, -16.8, -16.8],
    highpass: [-16.8, -16.8, -16.8, -16.79998645861099, -16.543170577847665, -3.4555040295233432, 0.08582192440295434, 0.000004489986331355424, 0, 0],
    bandpass: [-16.8, -16.8, -16.799999999900496, -11.563542129554186, -0.02171055460051219, 2.9085270414568565, -0.18072417042192634, -11.791947776610098, -16.79999999987241, -16.8],
    notch: [0, 2.244319131801437e-7, 0.019465037207131105, -1.712533077495078, -15.608982077130538, -16.799772295766658, -15.310101345298548, -1.6229799502339053, 0.021969121412826403, 0]
  };
  for (const type of Object.keys(reference)) actual[type].forEach((value, index) => expect(value).toBeCloseTo(reference[type][index], 7));
});

test('extended EQ shapes follow logarithmic bell, shelf, tilt and tone behavior', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(() => {
    const create = (type, values = {}) => window.FilterShape.createFilterShape({
      type, frequencyHz: 777, slope: 50, bandwidth: 50, bandDefinitions: window.ResonantState.BAND_DEFINITIONS,
      maxBandBoostDb: 12, maxBandCutDb: 12, ...values
    });
    return {
      bell: create('bell', { gainDb: 6 }), bellCut: create('bell', { gainDb: -6 }), bellZero: create('bell'),
      lowShelf: create('lowshelf', { lowShelfGainDb: 6 }), highShelf: create('highshelf', { highShelfGainDb: -6 }),
      tilt: create('tilt', { tiltDb: 6 }), tiltReverse: create('tilt', { tiltDb: -6 }), tiltZero: create('tilt'),
      bass: create('baxandall', { baxandallBassDb: 6 }), treble: create('baxandall', { baxandallTrebleDb: 6 }),
      opposite: create('baxandall', { baxandallBassDb: 6, baxandallTrebleDb: -6 }), toneZero: create('baxandall')
    };
  });
  expect(report.bell[5]).toBeCloseTo(6, 8);
  expect(report.bell[5]).toBeGreaterThan(report.bell[4]);
  expect(report.bell[4]).toBeGreaterThan(report.bell[1]);
  report.bell.forEach((value, index) => expect(report.bellCut[index]).toBeCloseTo(-value, 8));
  expect(report.bellZero).toEqual(Array(10).fill(0));
  expect(report.lowShelf[0]).toBeCloseTo(6, 5);
  expect(report.lowShelf[9]).toBeCloseTo(0, 5);
  expect(report.highShelf[0]).toBeCloseTo(0, 5);
  expect(report.highShelf[9]).toBeCloseTo(-6, 5);
  expect(report.tilt[0]).toBeCloseTo(-6, 5);
  expect(report.tilt[5]).toBeCloseTo(0, 5);
  expect(report.tilt[9]).toBeCloseTo(6, 5);
  report.tilt.forEach((value, index) => expect(report.tiltReverse[index]).toBeCloseTo(-value, 8));
  expect(report.tiltZero).toEqual(Array(10).fill(0));
  expect(report.bass[0]).toBeGreaterThan(5);
  expect(report.bass[9]).toBeCloseTo(0, 5);
  expect(report.treble[0]).toBeCloseTo(0, 5);
  expect(report.treble[9]).toBeGreaterThan(5);
  expect(report.opposite[0]).toBeGreaterThan(5);
  expect(report.opposite[9]).toBeLessThan(-5);
  expect(report.toneZero).toEqual(Array(10).fill(0));
});

test('formants morph continuously in log frequency, shift by octaves and stay bounded', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(() => {
    const centers = window.FilterShape.formantCenters;
    const create = values => window.FilterShape.createFilterShape({ type: 'formant', bandDefinitions: window.ResonantState.BAND_DEFINITIONS, maxBandBoostDb: 12, maxBandCutDb: 36, formantAmount: 70, formantWidth: 50, ...values });
    return {
      vowels: [0, 1, 2, 3, 4].map(formantVowel => create({ formantVowel })),
      a: centers(0), half: centers(.5), e: centers(1), octaveUp: centers(0, 12), octaveDown: centers(0, -12),
      morphs: [0, .25, .5, .75, 1].map(formantVowel => create({ formantVowel })),
      extreme: create({ formantVowel: 4, formantShiftSemitones: 12, formantWidth: 100, formantAmount: 100 })
    };
  });
  expect(report.a).toEqual([800, 1150, 2900]);
  expect(report.e).toEqual([400, 1700, 2600]);
  report.half.forEach((value, index) => expect(value).toBeCloseTo(Math.sqrt(report.a[index] * report.e[index]), 8));
  report.octaveUp.forEach((value, index) => expect(value).toBeCloseTo(report.a[index] * 2, 8));
  report.octaveDown.forEach((value, index) => expect(value).toBeCloseTo(report.a[index] / 2, 8));
  report.vowels.forEach(shape => {
    expect(shape).toHaveLength(10);
    expect(shape.every(Number.isFinite)).toBeTruthy();
    expect(shape.filter(value => value > 1).length).toBeGreaterThanOrEqual(2);
  });
  for (let index = 1; index < report.morphs.length; index += 1) {
    report.morphs[index].forEach((value, band) => expect(Math.abs(value - report.morphs[index - 1][band])).toBeLessThan(5));
  }
  expect(report.extreme.every(value => Number.isFinite(value) && value >= -36 && value <= 12)).toBeTruthy();
});
