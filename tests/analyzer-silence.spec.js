const { test, expect } = require('playwright/test');

test('DEV LAB uses RMS silence semantics for band bars and dominant state', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-response-mode="dev-lab"]').click();
  const results = await page.evaluate(() => {
    const receive = ({ rms, frameCount, sampleRate }) => {
      const energies = Array(10).fill(0);
      energies[4] = rms * rms * frameCount;
      const channel = {
        frameCount, sampleRate, bandEnergy: energies, bandPeak: Array(10).fill(0), localGates: Array(10).fill(0),
        resonanceTarget: 0, smoothedResonance: 0, saturationActiveFrames: 0,
        sourceEnergy: 0, wetEnergy: 0, sourcePeak: 0, wetPeak: 0, wetDcSum: 0
      };
      window.FilterbankDebugConsole.receive({ left: channel, right: { ...channel, bandEnergy: [...energies] } });
      return {
        widths: [...document.querySelectorAll('[data-dev-lab-bands] i b')].map(bar => bar.style.width),
        dominant: document.querySelector('[data-dev-lab-band-detail] b').textContent,
        stable: [...document.querySelectorAll('[data-dev-lab-band-detail] span')].find(node => node.textContent.startsWith('DOM STABLE')).textContent,
        dominantRows: document.querySelectorAll('[data-dev-lab-bands] .is-dominant').length
      };
    };
    const silent = [
      receive({ rms: 0, frameCount: 64, sampleRate: 44100 }),
      receive({ rms: 1e-5, frameCount: 128, sampleRate: 48000 }),
      receive({ rms: 1e-5, frameCount: 256, sampleRate: 96000 })
    ];
    return { silent, audible: receive({ rms: 4e-5, frameCount: 128, sampleRate: 48000 }), normal: receive({ rms: .1, frameCount: 128, sampleRate: 48000 }) };
  });

  results.silent.forEach(result => {
    expect(result.widths).toEqual(Array(10).fill('0%'));
    expect(result.dominant).toBe('N/A');
    expect(result.stable).toBe('DOM STABLE N/A');
    expect(result.dominantRows).toBe(0);
  });
  expect(results.audible.widths[4]).toBe('100%');
  expect(results.audible.dominant).toBe('411 Hz');
  expect(results.audible.stable).not.toMatch(/NaN|Infinity|-/);
  expect(results.normal.widths[4]).toBe('100%');
});
