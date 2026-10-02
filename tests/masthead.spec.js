const { test, expect } = require('playwright/test');

test('masthead keeps audio controls in primary and reserves an accessible MIDI setup slot', { tag: '@smoke' }, async ({ page }) => {
  for (const [width, height] of [[1914, 907], [1440, 900], [1914, 768], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');

    const structure = await page.evaluate(() => {
      const primary = document.querySelectorAll('.masthead-primary');
      const midi = document.querySelector('[data-midi-setup]');
      const separators = [...document.querySelectorAll('.masthead-separator')];
      const input = document.querySelector('[data-audio-input]');
      const output = document.querySelector('[data-audio-output]');
      const inputLabel = document.querySelector('.audio-input-source .audio-device-label');
      const routeArrow = document.querySelector('.audio-routing-arrow');
      const start = document.querySelector('[data-audio-start]');
      const status = document.querySelector('.audio-state');
      const devLab = document.querySelector('.masthead-dev-lab');
      const bounds = element => {
        const { left, right, width: elementWidth, height: elementHeight } = element.getBoundingClientRect();
        return { left, right, width: elementWidth, height: elementHeight };
      };
      return {
        primaryCount: primary.length,
        oldControlsCount: document.querySelectorAll('.masthead-controls').length,
        audioControlCounts: ['[data-audio-start]', '[data-audio-panic]', '[data-audio-bypass]', '[data-audio-status]']
          .map(selector => document.querySelectorAll(selector).length),
        startInsidePrimary: primary[0]?.contains(start),
        panicInsidePrimary: primary[0]?.contains(document.querySelector('[data-audio-panic]')),
        bypassInsidePrimary: primary[0]?.contains(document.querySelector('[data-audio-bypass]')),
        statusInsidePrimary: primary[0]?.contains(status),
        midiInsidePrimary: primary[0]?.contains(midi),
        midiLabel: midi?.getAttribute('aria-label'),
        midiTitle: midi?.getAttribute('title'),
        midiTabIndex: midi?.tabIndex,
        inputLabelBeforeInput: Boolean(inputLabel.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING),
        inputBeforeOutput: Boolean(input.compareDocumentPosition(routeArrow) & Node.DOCUMENT_POSITION_FOLLOWING),
        outputBeforeMidi: Boolean(output.compareDocumentPosition(midi) & Node.DOCUMENT_POSITION_FOLLOWING),
        midiBeforeStart: Boolean(midi.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING),
        primary: bounds(primary[0]),
        source: bounds(document.querySelector('.audio-input-source')),
        input: bounds(input),
        output: bounds(output),
        separators: separators.map(element => ({
          ...bounds(element),
          ariaHidden: element.getAttribute('aria-hidden'),
          color: getComputedStyle(element).backgroundColor
        })),
        midi: bounds(midi),
        start: bounds(start),
        status: bounds(status),
        devLab: bounds(devLab),
        documentWidth: document.documentElement.scrollWidth
      };
    });

    expect(structure.primaryCount, `${width}x${height}: one primary`).toBe(1);
    expect(structure.oldControlsCount, `${width}x${height}: old controls container removed`).toBe(0);
    expect(structure.audioControlCounts).toEqual([1, 1, 1, 1]);
    expect(structure.startInsidePrimary).toBe(true);
    expect(structure.panicInsidePrimary).toBe(true);
    expect(structure.bypassInsidePrimary).toBe(true);
    expect(structure.statusInsidePrimary).toBe(true);
    expect(structure.midiInsidePrimary).toBe(true);
    expect(structure.midiLabel).toBe('MIDI Setup');
    expect(structure.midiTitle).toBe('MIDI Setup');
    expect(structure.midiTabIndex).toBe(0);
    expect(structure.inputLabelBeforeInput).toBe(true);
    expect(structure.inputBeforeOutput).toBe(true);
    expect(structure.outputBeforeMidi).toBe(true);
    expect(structure.midiBeforeStart).toBe(true);
    expect(structure.separators).toHaveLength(2);
    expect(structure.separators.every(separator => separator.ariaHidden === 'true')).toBe(true);
    expect(structure.separators[0].height).toBe(structure.separators[1].height);
    expect(structure.separators[0].width).toBe(structure.separators[1].width);
    expect(structure.separators[0].color).toBe(structure.separators[1].color);
    expect(structure.documentWidth).toBeLessThanOrEqual(width);
    expect(structure.input.width).toBeGreaterThanOrEqual(120);
    expect(structure.output.width).toBeGreaterThan(0);
    expect(structure.output.width).toBeGreaterThanOrEqual(120);
    expect(structure.midi.width).toBeGreaterThan(0);
    expect(structure.status.width).toBeGreaterThan(0);
    expect(structure.output.right).toBeLessThanOrEqual(structure.separators[0].left);
    expect(structure.separators[0].right).toBeLessThanOrEqual(structure.midi.left);
    expect(structure.midi.right).toBeLessThanOrEqual(structure.separators[1].left);
    expect(structure.separators[1].right).toBeLessThanOrEqual(structure.start.left);
    expect(structure.status.right).toBeLessThanOrEqual(structure.devLab.left);
  }
});
