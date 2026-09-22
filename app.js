const {
  BAND_DEFINITIONS,
  BAND_COUNT,
  BAND_GAIN_MIN,
  BAND_GAIN_MAX,
  BAND_GAIN_NEUTRAL,
  GLOBAL_CONTROL_DEFINITIONS,
  controlToBandGainDb,
  createInitialState,
  getEffectiveBandGains,
  setBandBaseGain: setStateBandBaseGain
} = window.ResonantState;
const state = createInitialState();
let audioEngine = null;
let panic = () => {};
// Purely presentational: these switches are deliberately not part of the
// application/DSP state or DEV-LABS snapshots.
const ANALYZER_DISPLAY_DEFAULTS = Object.freeze({
  lrBars: true,
  peakHold: true,
  grid: true,
  bandRegions: true,
  frequencyLabels: true,
  hoverValues: true,
  spreadDelta: false,
  inputSpectrum: false,
  outputSpectrum: true,
  filterResponse: false,
  feedbackActivity: false,
  selfOscillation: false,
  dominantBand: false,
  feedbackEnergy: false,
  saturationIndicators: false,
  peakGlow: true,
  smoothDecay: true,
  liveStatusStrip: true,
  collapsedPreview: true,
  spectrumFill: true,
  spectrumTrail: false,
  energyBloom: false,
  peakMarkers: false,
  enhancedBars: true
});
const analyzerDisplay = { ...ANALYZER_DISPLAY_DEFAULTS };
const ANALYZER_SILENCE_DBFS = -90;
const ANALYZER_SILENCE_RMS = 10 ** (ANALYZER_SILENCE_DBFS / 20);
const finiteAnalyzerEnergy = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const getAnalyzerBandEnergyMetrics = packet => {
  const zdf = packet?.left?.feedbackCoreEffective === 'zdf' || packet?.left?.feedbackCoreEffective === 'zdf-per-band';
  const left = (zdf ? packet?.left?.baseBandEnergy : packet?.left?.bandEnergy) || [];
  const right = (zdf ? packet?.right?.baseBandEnergy : packet?.right?.bandEnergy) || [];
  const frameCount = Math.max(1, finiteAnalyzerEnergy(packet?.left?.frameCount)) + Math.max(1, finiteAnalyzerEnergy(packet?.right?.frameCount));
  const energies = Array.from({ length: BAND_COUNT }, (_, index) => finiteAnalyzerEnergy(left[index]) + finiteAnalyzerEnergy(right[index]));
  const rms = energies.map(energy => Math.sqrt(energy / frameCount));
  const peakRms = Math.max(0, ...rms);
  return { energies, rms, peakRms, isSilent: peakRms < ANALYZER_SILENCE_RMS };
};
const POSITIVE_RESONANCE_AUDITION_VALUES = [0.10, 0.20, 0.30, 0.40, 0.60, 0.80, 1.00, 1.50, 2.00, 4.00];
const positiveResonanceAuditionSelect = document.querySelector('[data-positive-resonance-audition]');
const positiveResonanceDriveSelect = document.querySelector('[data-positive-resonance-drive]');
const positiveResonanceDampingFloorSelect = document.querySelector('[data-positive-resonance-damping-floor]');
const positiveResonanceOutputSelect = document.querySelector('[data-positive-resonance-output]');
const positiveResonanceLatencySelect = document.querySelector('[data-positive-resonance-latency]');
const positiveResonanceCurveSelect = document.querySelector('[data-positive-resonance-curve]');
const addDevSelectOptions = (select, values, format = value => String(value)) => {
  if (!select) return;
  values.forEach(value => {
    const optionValue = format(value);
    if ([...select.options].some(option => option.value === optionValue)) return;
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionValue;
    select.append(option);
  });
};
addDevSelectOptions(positiveResonanceAuditionSelect, [1.50, 2.00, 4.00], value => value.toFixed(2));
addDevSelectOptions(positiveResonanceDriveSelect, [24, 32]);
addDevSelectOptions(positiveResonanceDampingFloorSelect, [-0.05, -0.10], value => value.toFixed(2));
const devLabPanel = document.querySelector('[data-dev-lab-panel]');
const devLabToggle = document.querySelector('[data-dev-lab-toggle]');
const mastheadDevLab = document.querySelector('.masthead-dev-lab');
const mastheadThemeEditor = document.querySelector('.theme-editor');
if (mastheadDevLab && mastheadThemeEditor && devLabToggle) mastheadDevLab.insertBefore(mastheadThemeEditor, devLabToggle);
const devLabControls = document.querySelector('.dev-lab-panel .dev-lab-controls');
const devLabGroups = new Map();
[['input', 'INPUT'], ['keyboard', 'KEYBOARD'], ['filterbank', 'FILTERBANK'], ['local-feedback', 'LOCAL FEEDBACK'], ['main', 'FB ALL / MAIN'], ['negative-resonance', 'NEGATIVE RESONANCE'], ['resonator', 'LEGACY / RESONATOR LAB']].forEach(([value, label]) => {
  const group = document.createElement('section');
  group.className = 'dev-lab-group';
  group.dataset.devLabGroup = value;
  group.innerHTML = `<div class="dev-lab-group-header"><h2>${label}</h2><button class="dev-lab-info-button" type="button" data-dev-lab-help="${value}" aria-label="Hilfe zu ${label}" aria-expanded="false" aria-controls="dev-lab-tooltip">i</button></div>`;
  devLabControls?.append(group);
  devLabGroups.set(value, group);
});
const SWEETSPOT_SLOTS = ['A', 'B', 'C', 'D'];
const sweetspotGroup = document.createElement('section');
sweetspotGroup.className = 'dev-lab-group sweetspot-group';
sweetspotGroup.dataset.devLabGroup = 'sweetspots';
sweetspotGroup.innerHTML = '<div class="dev-lab-group-header"><h2>SWEETSPOTS</h2></div><div class="sweetspot-list"></div>';
const sweetspotList = sweetspotGroup.querySelector('.sweetspot-list');
const sweetspotRows = new Map();
SWEETSPOT_SLOTS.forEach(slot => {
  const row = document.createElement('div');
  row.className = 'sweetspot-row';
  row.innerHTML = `<strong>${slot}</strong><input type="text" maxlength="48" data-sweetspot-name="${slot}" aria-label="Sweetspot ${slot} Name"><button type="button" data-sweetspot-save="${slot}">SAVE</button><button type="button" data-sweetspot-load="${slot}" disabled>LOAD</button><button type="button" data-sweetspot-clear="${slot}" disabled>CLEAR</button>`;
  sweetspotList?.append(row);
  sweetspotRows.set(slot, row);
});
devLabControls?.append(sweetspotGroup);
const groupForDevControl = control => {
  const attribute = control.querySelector('select')?.getAttributeNames().find(name => name.startsWith('data-')) ?? '';
  if (attribute === 'data-input-preamp-stage') return 'input';
  if (attribute === 'data-reference-level' || attribute === 'data-band-boost-db' || attribute === 'data-band-cut-db' || attribute === 'data-spread-curve' || attribute === 'data-spread-max-offset-db' || attribute === 'data-wet-model') return 'filterbank';
  if (attribute === 'data-feedback-topology' || attribute === 'data-feedback-tap' || attribute === 'data-local-loop-tuning' || attribute === 'data-feedback-core') return 'local-feedback';
  if (attribute === 'data-feedback-all-engine' || attribute === 'data-feedback-all-source' || attribute === 'data-post-gain-feedback-weight' || attribute === 'data-feedback-all-level') return 'main';
  return 'resonator';
};
const inlineDevLabControls = document.querySelector('.analyzer-header .dev-lab-controls');
inlineDevLabControls?.querySelectorAll(':scope > .dev-audition-control, :scope > .dev-lab-control').forEach(control => {
  devLabGroups.get(groupForDevControl(control))?.append(control);
});
inlineDevLabControls?.remove();
const analyzerHeader = document.querySelector('.analyzer-header');
const analyzerStatus = document.querySelector('.analyzer-status');
const analyzerTitle = analyzerHeader?.querySelector('strong');
if (analyzerHeader && analyzerTitle) {
  const titleStatus = document.createElement('div');
  titleStatus.className = 'analyzer-title-status';
  titleStatus.append(analyzerTitle);
  analyzerHeader.prepend(titleStatus);
}
const analyzerTitleStatus = analyzerHeader?.querySelector('.analyzer-title-status');
// Header metadata belongs to the app controls, not the compact analyzer view.
analyzerStatus?.remove();
const analyzerHeaderControls = analyzerHeader?.querySelector('.analyzer-header-controls');
const analyzerLegend = document.querySelector('.analyzer > .legend');
analyzerLegend?.remove();
const analyzer = document.querySelector('.analyzer');
let analyzerFooter = null;
let collapsedPreview = null;
let clearAnalyzerHover = () => {};
let hideAnalyzerDetails = () => {};
const analyzerAxisX = document.querySelector('.chart-grid .axis-x');
if (analyzer && analyzerAxisX) {
  analyzerAxisX.replaceChildren(...BAND_DEFINITIONS.map((band, index) => {
    const label = document.createElement('span');
    label.textContent = index + 1;
    return label;
  }));
  analyzerFooter = document.createElement('div');
  analyzerFooter.className = 'analyzer-footer';
  analyzerFooter.append(analyzerAxisX);
  analyzer.append(analyzerFooter);
}
const filterbankWorkspace = document.querySelector('.fb-workspace');
const responseCollapseButton = document.createElement('button');
responseCollapseButton.type = 'button';
responseCollapseButton.className = 'response-collapse-toggle';
const setFilterbankResponseCollapsed = collapsed => {
  filterbankWorkspace?.classList.toggle('is-collapsed', collapsed);
  responseCollapseButton.setAttribute('aria-expanded', String(!collapsed));
  responseCollapseButton.setAttribute('aria-label', collapsed ? 'Filterbank response ausklappen' : 'Filterbank response einklappen');
  if (collapsedPreview) {
    collapsedPreview.hidden = !collapsed || !analyzerDisplay.collapsedPreview;
    hideAnalyzerDetails();
    if (collapsed) scheduleAnalyzerRender();
  }
  responseCollapseButton.textContent = collapsed ? '▾' : '▴';
};
if (analyzerHeaderControls && filterbankWorkspace) {
  setFilterbankResponseCollapsed(false);
  analyzerHeaderControls.append(responseCollapseButton);
  responseCollapseButton.addEventListener('click', () => setFilterbankResponseCollapsed(!filterbankWorkspace.classList.contains('is-collapsed')));
}

// This panel is deliberately a UI-only consumer of the existing worklet
// diagnostics. It never sends a message back into the audio graph.
const responseModeControl = document.createElement('div');
responseModeControl.className = 'response-mode-control';
responseModeControl.setAttribute('role', 'group');
responseModeControl.setAttribute('aria-label', 'Filterbank Response Ansicht');
const normalResponseButton = document.createElement('button');
const devResponseButton = document.createElement('button');
normalResponseButton.type = devResponseButton.type = 'button';
normalResponseButton.textContent = 'NORMAL'; devResponseButton.textContent = 'DEV LAB';
normalResponseButton.dataset.responseMode = 'normal'; devResponseButton.dataset.responseMode = 'dev-lab';
responseModeControl.append(normalResponseButton, devResponseButton);
const responseChart = filterbankWorkspace?.querySelector('.chart-grid');
const responseLegend = filterbankWorkspace?.querySelector('.legend');

const ANALYZER_OPTION_GROUPS = [
  ['BASIC', [['lrBars', 'L/R Bars'], ['peakHold', 'Peak Hold'], ['grid', 'Grid'], ['bandRegions', 'Band Regions'], ['frequencyLabels', 'Frequency Labels']]],
  ['VALUES', [['hoverValues', 'Hover Values'], ['spreadDelta', 'Spread Delta']]],
  ['SPECTRUM', [['inputSpectrum', 'Input Spectrum', 'Zeigt das Spektrum vor der Filterbank.'], ['outputSpectrum', 'Output Spectrum', 'Zeigt das Spektrum des verarbeiteten Filterbank-Signals.'], ['filterResponse', 'Filter Response', 'Zeigt die eingestellte lineare Filterbank-Kurve; Feedback und nichtlineare Effekte sind nicht enthalten.']]],
  ['FEEDBACK', [['feedbackActivity', 'Feedback Activity'], ['selfOscillation', 'Self Oscillation', 'Markiert Bänder mit über Zeit stabiler, hoher Feedback-Energie.'], ['dominantBand', 'Dominant Band', 'Hebt den aktuellen Telemetrie-Kandidaten mit der höchsten Bandenergie hervor.'], ['feedbackEnergy', 'Feedback Energy']]],
  ['LEVELS', [['saturationIndicators', 'Saturation / Clip Indicators']]],
  ['STYLE', [['spectrumFill', 'Spectrum Fill', 'Füllt das Output-Spektrum dezent bis zur unteren Kante.'], ['spectrumTrail', 'Spectrum Trail', 'Zeigt einen kurzen, rein visuellen Nachlauf des Output-Spektrums.'], ['energyBloom', 'Energy Bloom', 'Hebt besonders energiereiche Frequenzbereiche dezent hervor.'], ['peakMarkers', 'Peak Markers', 'Zeigt kurzlebige Marker an ausgeprägten lokalen Spectrum-Peaks.'], ['enhancedBars', 'Enhanced Bars', 'Verfeinert die L/R-Control-Balken mit Verlauf und Top-Kante.']]],
  ['VISUAL', [['peakGlow', 'Peak Glow'], ['smoothDecay', 'Smooth Decay'], ['liveStatusStrip', 'Live Status Strip'], ['collapsedPreview', 'Collapsed Preview']]]
];
const analyzerOptions = document.createElement('div');
analyzerOptions.className = 'analyzer-options';
analyzerOptions.innerHTML = '<button type="button" class="analyzer-options-toggle" aria-expanded="false" aria-controls="analyzer-options-popover" title="Analyzer-Anzeigen konfigurieren">VIEW</button><div id="analyzer-options-popover" class="analyzer-options-popover" hidden></div>';
const analyzerOptionsToggle = analyzerOptions.querySelector('.analyzer-options-toggle');
const analyzerOptionsPopover = analyzerOptions.querySelector('.analyzer-options-popover');
ANALYZER_OPTION_GROUPS.forEach(([group, options]) => {
  const section = document.createElement('section');
  section.innerHTML = `<strong>${group}</strong>`;
  options.forEach(([key, label, tooltip]) => {
    const option = document.createElement('label');
    option.title = tooltip || `${label} nur anzeigen oder ausblenden.`;
    option.innerHTML = `<input type="checkbox" data-analyzer-option="${key}"><span>${label}</span>`;
    const input = option.querySelector('input');
    input.checked = analyzerDisplay[key];
    input.addEventListener('change', () => setAnalyzerDisplayOption(key, input.checked));
    section.append(option);
  });
  analyzerOptionsPopover.append(section);
});
const setAnalyzerOptionsOpen = open => {
  analyzerOptionsPopover.hidden = !open;
  analyzerOptionsToggle.setAttribute('aria-expanded', String(open));
  if (open) requestAnimationFrame(positionAnalyzerOptionsPopover);
};
const positionAnalyzerOptionsPopover = () => {
  if (analyzerOptionsPopover.hidden) return;
  const buttonRect = analyzerOptionsToggle.getBoundingClientRect();
  const viewportPadding = 8;
  const spaceBelow = window.innerHeight - buttonRect.bottom - viewportPadding;
  const spaceAbove = buttonRect.top - viewportPadding;
  const openAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
  // Keep the toggle itself reachable: constrain the menu to the available
  // side of the viewport instead of allowing an oversized menu to cover it.
  analyzerOptionsPopover.style.maxHeight = `${Math.max(120, openAbove ? spaceAbove : spaceBelow)}px`;
  const menuRect = analyzerOptionsPopover.getBoundingClientRect();
  const left = Math.max(viewportPadding, Math.min(window.innerWidth - menuRect.width - viewportPadding, buttonRect.left));
  const top = openAbove ? Math.max(viewportPadding, buttonRect.top - menuRect.height - 6) : buttonRect.bottom + 6;
  analyzerOptionsPopover.style.left = `${Math.round(left)}px`;
  analyzerOptionsPopover.style.top = `${Math.round(top)}px`;
};
analyzerOptionsToggle.addEventListener('click', () => { hideAnalyzerDetails(); setAnalyzerOptionsOpen(analyzerOptionsPopover.hidden); });
document.addEventListener('pointerdown', event => { if (!analyzerOptions.contains(event.target)) { hideAnalyzerDetails(); setAnalyzerOptionsOpen(false); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape') setAnalyzerOptionsOpen(false); });
window.addEventListener('resize', positionAnalyzerOptionsPopover);
analyzerHeaderControls?.prepend(analyzerOptions);

const liveStatusStrip = document.createElement('div');
liveStatusStrip.className = 'analyzer-live-status';
liveStatusStrip.dataset.analyzerLiveStatus = '';
liveStatusStrip.setAttribute('aria-label', 'Aktueller Filterbank-Status');
analyzerTitleStatus?.append(liveStatusStrip);

// The spectrum is a UI-only view over the AudioEngine's passive wet-output
// AnalyserNodes. It never controls, reconnects, or otherwise alters audio.
const spectrumForegroundControl = document.createElement('div');
spectrumForegroundControl.className = 'spectrum-foreground-control';
spectrumForegroundControl.setAttribute('role', 'group');
spectrumForegroundControl.setAttribute('aria-label', 'Visualisierung im Vordergrund');
const spectrumBarsButton = document.createElement('button');
const spectrumCurveButton = document.createElement('button');
spectrumBarsButton.type = spectrumCurveButton.type = 'button';
spectrumBarsButton.setAttribute('aria-label', 'Filterbank-Balken in den Vordergrund');
spectrumCurveButton.setAttribute('aria-label', 'Spectrum in den Vordergrund');
spectrumBarsButton.innerHTML = '<svg viewBox="0 0 20 16" aria-hidden="true" focusable="false"><rect x="1" y="8" width="3" height="7"/><rect x="6" y="3" width="3" height="12"/><rect x="11" y="6" width="3" height="9"/><rect x="16" y="1" width="3" height="14"/></svg>';
spectrumCurveButton.innerHTML = '<svg viewBox="0 0 20 16" aria-hidden="true" focusable="false"><path d="M1 12 C3 11,3 5,6 8 S9 13,11 5 S14 10,16 4 S18 7,19 3"/></svg>';
spectrumForegroundControl.append(spectrumBarsButton, spectrumCurveButton);
analyzerHeaderControls?.prepend(spectrumForegroundControl);

const spectrumRenderer = (() => {
  if (!responseChart) return { setVisible() {}, refresh() {} };
  const canvas = document.createElement('canvas');
  canvas.className = 'filterbank-spectrum';
  canvas.setAttribute('aria-hidden', 'true');
  responseChart.insertBefore(canvas, responseChart.querySelector('.bars'));
  const context = canvas.getContext('2d');
  const minFrequency = 20;
  const maxFrequency = 20000;
  const minDecibels = -90;
  const maxDecibels = 0;
  const logFrequencyRange = Math.log(maxFrequency / minFrequency);
  let visible = true;
  let foreground = 'bars';
  let animationFrame = 0;
  let leftAnalyser = null;
  let rightAnalyser = null;
  let inputLeftAnalyser = null;
  let inputRightAnalyser = null;
  let leftBins = null;
  let rightBins = null;
  let inputLeftBins = null;
  let inputRightBins = null;
  let lastLayers = [];
  let cssWidth = 0;
  let cssHeight = 0;
  let palette = null;
  let outputTrail = [];
  let lastTrailCaptureAt = 0;
  const frequencyToX = (frequency, width) => Math.log(Math.max(minFrequency, Math.min(maxFrequency, frequency)) / minFrequency) / logFrequencyRange * width;
  const decibelsToY = (decibels, height) => (maxDecibels - Math.max(minDecibels, Math.min(maxDecibels, decibels))) / (maxDecibels - minDecibels) * height;
  const shouldRender = () => visible && !filterbankWorkspace?.classList.contains('is-collapsed');
  const updateButtons = () => {
    const barsFront = foreground === 'bars';
    spectrumBarsButton.classList.toggle('active', barsFront);
    spectrumCurveButton.classList.toggle('active', !barsFront);
    spectrumBarsButton.setAttribute('aria-pressed', String(barsFront));
    spectrumCurveButton.setAttribute('aria-pressed', String(!barsFront));
    responseChart.classList.toggle('spectrum-foreground', !barsFront);
  };
  const resize = () => {
    const rect = responseChart.getBoundingClientRect();
    const width = Math.max(0, Math.floor(rect.width));
    const height = Math.max(0, Math.floor(rect.height));
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    if (!width || !height) return false;
    if (cssWidth !== width || cssHeight !== height || canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
      cssWidth = width; cssHeight = height;
      canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    return true;
  };
  const colors = () => {
    if (palette) return palette;
    const style = getComputedStyle(document.body);
    const canvasColor = (value, fallback) => String(value || '').trim().match(/^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i)?.[0] || fallback;
    palette = {
      left: canvasColor(style.getPropertyValue('--graph-left-color'), '#49d7eb'),
      right: canvasColor(style.getPropertyValue('--graph-right-color'), '#e16c85'),
      input: canvasColor(style.getPropertyValue('--secondary-text'), '#9aaab0'),
      response: canvasColor(style.getPropertyValue('--strong-text'), '#d9e4e8')
    };
    return palette;
  };
  const ensureBins = () => {
    if (analyzerDisplay.inputSpectrum) audioEngine?.ensureInputSpectrumAnalysers?.();
    const nextLeft = audioEngine?.spectrumAnalyserLeft || null;
    const nextRight = audioEngine?.spectrumAnalyserRight || null;
    const nextInputLeft = audioEngine?.inputSpectrumAnalyserLeft || null;
    const nextInputRight = audioEngine?.inputSpectrumAnalyserRight || null;
    if (nextLeft !== leftAnalyser || nextRight !== rightAnalyser || nextInputLeft !== inputLeftAnalyser || nextInputRight !== inputRightAnalyser) {
      leftAnalyser = nextLeft; rightAnalyser = nextRight;
      inputLeftAnalyser = nextInputLeft; inputRightAnalyser = nextInputRight;
      leftBins = leftAnalyser ? new Float32Array(leftAnalyser.frequencyBinCount) : null;
      rightBins = rightAnalyser ? new Float32Array(rightAnalyser.frequencyBinCount) : null;
      inputLeftBins = inputLeftAnalyser ? new Float32Array(inputLeftAnalyser.frequencyBinCount) : null;
      inputRightBins = inputRightAnalyser ? new Float32Array(inputRightAnalyser.frequencyBinCount) : null;
    }
    return leftAnalyser && rightAnalyser && leftBins && rightBins;
  };
  const curvePath = (data, analyser) => {
    const sampleRate = analyser.context.sampleRate;
    const binWidth = sampleRate / analyser.fftSize;
    const start = Math.max(1, Math.ceil(minFrequency / binWidth));
    const end = Math.min(data.length - 1, Math.floor(maxFrequency / binWidth));
    context.beginPath();
    for (let bin = start; bin <= end; bin += 1) {
      const x = frequencyToX(bin * binWidth, cssWidth);
      const y = decibelsToY(Number.isFinite(data[bin]) ? data[bin] : minDecibels, cssHeight);
      if (bin === start) context.moveTo(x, y); else context.lineTo(x, y);
    }
    return { start, end, binWidth };
  };
  const drawCurve = (data, analyser, color, alpha, lineWidth) => {
    curvePath(data, analyser);
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
  };
  const drawOutputFill = (data, analyser, color, alpha) => {
    const { start, end, binWidth } = curvePath(data, analyser);
    const gradient = context.createLinearGradient(0, 0, 0, cssHeight);
    gradient.addColorStop(0, color);
    gradient.addColorStop(.78, color);
    gradient.addColorStop(1, 'transparent');
    context.lineTo(frequencyToX(end * binWidth, cssWidth), cssHeight);
    context.lineTo(frequencyToX(start * binWidth, cssWidth), cssHeight);
    context.closePath();
    context.globalAlpha = alpha;
    context.fillStyle = gradient;
    context.fill();
  };
  const drawEnergyBloom = (data, analyser, color) => {
    const binWidth = analyser.context.sampleRate / analyser.fftSize;
    BAND_DEFINITIONS.forEach(band => {
      const center = Math.round(band.frequency / binWidth);
      const radius = Math.max(1, Math.round(center * .13));
      let peak = minDecibels;
      for (let bin = Math.max(1, center - radius); bin <= Math.min(data.length - 1, center + radius); bin += 1) peak = Math.max(peak, Number.isFinite(data[bin]) ? data[bin] : minDecibels);
      if (peak < -42) return;
      const x = frequencyToX(band.frequency, cssWidth);
      const alpha = Math.min(.12, Math.max(.018, (peak + 42) / 42 * .12));
      const glow = context.createRadialGradient(x, cssHeight * .58, 0, x, cssHeight * .58, Math.max(15, cssWidth * .065));
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'transparent');
      context.globalAlpha = alpha;
      context.fillStyle = glow;
      context.fillRect(Math.max(0, x - cssWidth * .08), 0, Math.min(cssWidth * .16, cssWidth), cssHeight);
    });
  };
  const drawPeakMarkers = (data, analyser, color) => {
    const binWidth = analyser.context.sampleRate / analyser.fftSize;
    const start = Math.max(3, Math.ceil(minFrequency / binWidth));
    const end = Math.min(data.length - 4, Math.floor(maxFrequency / binWidth));
    const peaks = [];
    for (let bin = start; bin <= end; bin += 3) {
      const value = Number.isFinite(data[bin]) ? data[bin] : minDecibels;
      if (value > -30 && value >= data[bin - 2] && value >= data[bin + 2]) peaks.push({ bin, value });
    }
    peaks.sort((a, b) => b.value - a.value).slice(0, 5).forEach(({ bin, value }) => {
      context.globalAlpha = Math.min(.72, .22 + (value + 30) / 30 * .5);
      context.fillStyle = color;
      context.beginPath();
      context.arc(frequencyToX(bin * binWidth, cssWidth), decibelsToY(value, cssHeight), 1.45, 0, Math.PI * 2);
      context.fill();
    });
  };
  const captureTrail = now => {
    if (!analyzerDisplay.spectrumTrail || now - lastTrailCaptureAt < 105) return;
    outputTrail.unshift({ left: new Float32Array(leftBins), right: new Float32Array(rightBins), at: now });
    outputTrail = outputTrail.slice(0, 3);
    lastTrailCaptureAt = now;
  };
  const effectiveGain = index => audioEngine?.getEffectiveBandGains(index) ?? getEffectiveBandGains(state, index, { maxBandBoostDb: getBandBoostDb(), maxBandCutDb: getBandCutDb() });
  const drawFilterResponse = (channel, color) => {
    context.globalAlpha = .52;
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.beginPath();
    for (let x = 0; x <= cssWidth; x += 2) {
      const frequency = minFrequency * Math.exp((x / cssWidth) * logFrequencyRange);
      let linearGain = 1;
      BAND_DEFINITIONS.forEach((band, index) => {
        const gainDb = effectiveGain(index)[channel === 'left' ? 'leftDb' : 'rightDb'];
        const ratio = frequency / band.frequency;
        // The linear, no-feedback BPF magnitude is intentionally an
        // approximation: it communicates the configured bank, not a solver prediction.
        const q = Number(band.q) || 1.2;
        const magnitude = (ratio / q) / Math.sqrt((1 - ratio * ratio) ** 2 + (ratio / q) ** 2);
        linearGain += (10 ** (gainDb / 20) - 1) * magnitude;
      });
      const y = decibelsToY(20 * Math.log10(Math.max(1e-5, Math.abs(linearGain))), cssHeight);
      if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
    context.setLineDash([]);
  };
  const draw = () => {
    animationFrame = 0;
    if (!shouldRender()) return;
    if (!resize()) { schedule(); return; }
    context.clearRect(0, 0, cssWidth, cssHeight);
    lastLayers = [];
    ensureBins();
    const color = colors();
    if (analyzerDisplay.inputSpectrum && inputLeftAnalyser && inputRightAnalyser && inputLeftBins && inputRightBins) {
      inputLeftAnalyser.getFloatFrequencyData(inputLeftBins); inputRightAnalyser.getFloatFrequencyData(inputRightBins);
      drawCurve(inputLeftBins, inputLeftAnalyser, color.input, .28, .85);
      drawCurve(inputRightBins, inputRightAnalyser, color.input, .16, .85);
      lastLayers.push('inputSpectrum');
    }
    if (analyzerDisplay.filterResponse) {
      drawFilterResponse('left', color.left); drawFilterResponse('right', color.right);
      lastLayers.push('filterResponse');
    }
    if (analyzerDisplay.outputSpectrum && leftAnalyser && rightAnalyser && leftBins && rightBins) {
      leftAnalyser.getFloatFrequencyData(leftBins); rightAnalyser.getFloatFrequencyData(rightBins);
      const now = performance.now();
      captureTrail(now);
      if (analyzerDisplay.energyBloom) {
        drawEnergyBloom(leftBins, leftAnalyser, color.left);
        drawEnergyBloom(rightBins, rightAnalyser, color.right);
        lastLayers.push('energyBloom');
      }
      if (analyzerDisplay.spectrumTrail && outputTrail.length > 1) {
        outputTrail.slice(1).forEach((trail, index) => {
          const age = Math.max(0, now - trail.at);
          const trailAlpha = Math.max(0, .15 - age / 2200) * (1 - index * .25);
          if (!trailAlpha) return;
          drawCurve(trail.left, leftAnalyser, color.left, trailAlpha, .9);
          drawCurve(trail.right, rightAnalyser, color.right, trailAlpha * .7, .9);
        });
        lastLayers.push('spectrumTrail');
      }
      if (analyzerDisplay.spectrumFill) {
        drawOutputFill(leftBins, leftAnalyser, color.left, foreground === 'bars' ? .075 : .12);
        drawOutputFill(rightBins, rightAnalyser, color.right, foreground === 'bars' ? .045 : .075);
        lastLayers.push('spectrumFill');
      }
      const alpha = foreground === 'bars' ? .38 : .96;
      const width = foreground === 'bars' ? 1 : 1.65;
      drawCurve(leftBins, leftAnalyser, color.left, alpha, width);
      drawCurve(rightBins, rightAnalyser, color.right, alpha, width);
      if (analyzerDisplay.peakMarkers) {
        drawPeakMarkers(leftBins, leftAnalyser, color.left);
        drawPeakMarkers(rightBins, rightAnalyser, color.right);
        lastLayers.push('peakMarkers');
      }
      lastLayers.push('outputSpectrum');
    }
    context.globalAlpha = 1;
    schedule();
  };
  const schedule = () => { if (!animationFrame && shouldRender()) animationFrame = requestAnimationFrame(draw); };
  const refresh = () => { if (shouldRender()) schedule(); };
  const setVisible = nextVisible => { visible = Boolean(nextVisible); if (!visible && animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = 0; } else refresh(); };
  const setForeground = nextForeground => { foreground = nextForeground === 'spectrum' ? 'spectrum' : 'bars'; updateButtons(); refresh(); };
  spectrumBarsButton.addEventListener('click', () => setForeground('bars'));
  spectrumCurveButton.addEventListener('click', () => setForeground('spectrum'));
  window.addEventListener('resize', () => { palette = null; refresh(); });
  new ResizeObserver(() => refresh()).observe(responseChart);
  new MutationObserver(() => { palette = null; }).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('da-filta-theme-change', () => { palette = null; refresh(); });
  updateButtons(); refresh();
window.FilterbankSpectrum = { frequencyToX, decibelsToY };
  return { setVisible, refresh, setForeground, getLayers: () => [...lastLayers] };
})();
responseCollapseButton.addEventListener('click', () => requestAnimationFrame(() => spectrumRenderer.refresh()));
const responseLab = document.createElement('section');
responseLab.className = 'response-dev-lab';
responseLab.hidden = true;
responseLab.setAttribute('aria-label', 'Filterbank DSP Telemetrie');
responseLab.innerHTML = `
  <div class="response-dev-toolbar"><span data-dev-lab-audio>NO AUDIO</span><button type="button" data-dev-lab-freeze aria-pressed="false">FREEZE</button><button type="button" data-dev-lab-reset>RESET METRICS</button><button type="button" data-debug-console-toggle aria-expanded="false">DEBUG CONSOLE</button><button type="button" data-debug-mark>MARK</button><button type="button" data-debug-snapshot>SNAPSHOT</button><button class="dev-lab-info-button" type="button" data-dev-lab-help="response" aria-label="Hilfe zu den DEV-LAB-Diagnosewerkzeugen" aria-expanded="false" aria-controls="dev-lab-tooltip">i</button></div>
  <div class="response-dev-summary" data-dev-lab-summary></div>
  <div class="response-dev-traces"><figure><figcaption>COMMON RETURN <i>L</i> <i>R</i></figcaption><canvas data-dev-lab-trace="common"></canvas></figure><figure><figcaption>MAIN RETURN <i>L</i> <i>R</i></figcaption><canvas data-dev-lab-trace="main"></canvas></figure><figure><figcaption>RESONANCE <i>TARGET</i> <i>SMOOTHED</i></figcaption><canvas data-dev-lab-trace="resonance"></canvas></figure></div>
  <div class="response-dev-bottom"><div class="response-dev-bands" data-dev-lab-bands></div><div class="response-dev-band-detail" data-dev-lab-band-detail></div></div>`;
responseChart?.after(responseLab);
analyzerHeaderControls?.prepend(responseModeControl);

// Deliberately outside FILTERBANK RESPONSE: this is a non-modal diagnostic
// overlay, so opening it cannot change the response panel's geometry.
const debugConsoleOverlay = document.createElement('section');
debugConsoleOverlay.className = 'response-debug-console';
debugConsoleOverlay.dataset.debugConsole = '';
debugConsoleOverlay.hidden = true;
debugConsoleOverlay.setAttribute('aria-label', 'Strukturiertes DSP Event Log');
debugConsoleOverlay.innerHTML = '<div class="response-debug-console-toolbar" data-debug-console-drag-handle><strong>DEBUG CONSOLE</strong><span data-debug-copy-state></span><button type="button" data-debug-copy>COPY DEBUG REPORT</button><button type="button" data-debug-clear>CLEAR LOG</button><button type="button" data-debug-console-close aria-label="Debug Console schließen">×</button></div><div class="response-debug-log" data-debug-log role="log" aria-live="polite"></div><div class="response-debug-max" data-debug-max></div><div class="response-debug-resize-grip" data-debug-console-resize aria-label="Debug Console-Größe ändern" role="separator" aria-orientation="both"></div>';
document.body.append(debugConsoleOverlay);

// Session-only floating geometry. The panel remains fully inside the viewport.
const debugConsoleGeometry = (() => {
  const margin = 12; let geometry = null;
  const normalize = value => { const maxWidth = Math.max(1, window.innerWidth - margin * 2); const maxHeight = Math.max(1, window.innerHeight - margin * 2); const width = Math.max(Math.min(500, maxWidth), Math.min(maxWidth, value.width)); const height = Math.max(Math.min(280, maxHeight), Math.min(maxHeight, value.height)); return { width, height, x: Math.max(margin, Math.min(window.innerWidth - margin - width, value.x)), y: Math.max(margin, Math.min(window.innerHeight - margin - height, value.y)) }; };
  const apply = value => { geometry = normalize(value); Object.assign(debugConsoleOverlay.style, { width: `${geometry.width}px`, height: `${geometry.height}px`, maxWidth: `${window.innerWidth - margin * 2}px`, maxHeight: `${window.innerHeight - margin * 2}px`, left: `${geometry.x}px`, top: `${geometry.y}px`, right: 'auto', bottom: 'auto' }); };
  const ensure = () => { if (!geometry) { const width = Math.min(780, window.innerWidth - margin * 2); const height = Math.min(440, window.innerHeight - margin * 2); apply({ width, height, x: window.innerWidth - width - 20, y: window.innerHeight - height - 20 }); } else apply(geometry); };
  const bindPointer = (element, type) => element.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (type === 'drag' && event.target.closest('button, input, select, textarea, a'))) return;
    ensure(); const start = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, pointerX: event.clientX, pointerY: event.clientY }; element.setPointerCapture(event.pointerId); debugConsoleOverlay.classList.add(type === 'drag' ? 'is-dragging' : 'is-resizing');
    const move = next => apply(type === 'drag' ? { ...geometry, x: start.x + next.clientX - start.pointerX, y: start.y + next.clientY - start.pointerY } : { ...geometry, width: start.width + next.clientX - start.pointerX, height: start.height + next.clientY - start.pointerY });
    const end = next => { if (element.hasPointerCapture(next.pointerId)) element.releasePointerCapture(next.pointerId); element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('pointercancel', end); debugConsoleOverlay.classList.remove('is-dragging', 'is-resizing'); };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end); event.preventDefault();
  });
  bindPointer(debugConsoleOverlay.querySelector('[data-debug-console-drag-handle]'), 'drag'); bindPointer(debugConsoleOverlay.querySelector('[data-debug-console-resize]'), 'resize'); const clampToViewport = () => { if (geometry) apply(geometry); }; window.addEventListener('resize', clampToViewport); window.visualViewport?.addEventListener('resize', clampToViewport); new ResizeObserver(clampToViewport).observe(document.documentElement);
  return { ensure, current: () => geometry };
})();

const devLabTelemetry = (() => {
  const maxHistory = 150; // 10 seconds at the 15 Hz worklet publish rate.
  const histories = { common: [], main: [], resonance: [] };
  let latest = null;
  let frozen = false;
  let responseMode = 'normal';
  let resetBaseline = null;
  const maxEvents = 1000;
  const events = [];
  const snapshots = [];
  const lastEventAt = new Map();
  let sessionStartedAt = null;
  let markerNumber = 0;
  let snapshotNumber = 0;
  let dominant = { index: null, startedAt: 0, logged: new Set() };
  let satThreshold = 0;
  let sessionMax = { local: 0, main: 0, saturator: 0, satActivity: 0, bandEnergy: 0, bandIndex: 0, dominantMs: 0, resets: 0 };
  const freezeButton = responseLab.querySelector('[data-dev-lab-freeze]');
  const resetButton = responseLab.querySelector('[data-dev-lab-reset]');
  const summary = responseLab.querySelector('[data-dev-lab-summary]');
  const bands = responseLab.querySelector('[data-dev-lab-bands]');
  const detail = responseLab.querySelector('[data-dev-lab-band-detail]');
  const audioLabel = responseLab.querySelector('[data-dev-lab-audio]');
  const consoleToggle = responseLab.querySelector('[data-debug-console-toggle]');
  const debugConsole = debugConsoleOverlay;
  const debugLog = debugConsole.querySelector('[data-debug-log]');
  const debugMax = debugConsole.querySelector('[data-debug-max]');
  const copyButton = debugConsole.querySelector('[data-debug-copy]');
  const copyState = debugConsole.querySelector('[data-debug-copy-state]');
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const number = value => Math.abs(finite(value)) >= 10 ? finite(value).toFixed(2) : finite(value).toFixed(4);
  const timestamp = () => {
    const elapsed = Math.max(0, performance.now() - (sessionStartedAt ?? performance.now()));
    const minutes = Math.floor(elapsed / 60000); const seconds = Math.floor(elapsed / 1000) % 60; const milliseconds = Math.floor(elapsed % 1000);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  };
  const renderLog = () => {
    if (responseMode !== 'dev-lab' || filterbankWorkspace?.classList.contains('is-collapsed') || debugConsole.hidden) return;
    const pinned = debugLog.scrollHeight - debugLog.scrollTop - debugLog.clientHeight < 4;
    debugLog.replaceChildren(...events.map(event => { const row = document.createElement('div'); row.className = `response-debug-event ${event.warning ? 'is-warning' : ''}`; row.innerHTML = `<time>${event.time}</time><span>${event.text}</span>`; return row; }));
    if (pinned) debugLog.scrollTop = debugLog.scrollHeight;
    debugMax.textContent = `SESSION MAX  LOCAL ${number(sessionMax.local)}  MAIN ${number(sessionMax.main)}  SAT IN ${number(sessionMax.saturator)}  SAT ACT ${(sessionMax.satActivity * 100).toFixed(0)} %  BAND ${BAND_DEFINITIONS[sessionMax.bandIndex]?.frequency ?? '—'} Hz  DOM ${(sessionMax.dominantMs / 1000).toFixed(1)} s  RESETS ${sessionMax.resets}`;
  };
  const appendLogRow = event => {
    if (responseMode !== 'dev-lab' || filterbankWorkspace?.classList.contains('is-collapsed') || debugConsole.hidden) return;
    const pinned = debugLog.scrollHeight - debugLog.scrollTop - debugLog.clientHeight < 4;
    const row = document.createElement('div'); row.className = `response-debug-event ${event.warning ? 'is-warning' : ''}`; row.innerHTML = `<time>${event.time}</time><span>${event.text}</span>`;
    debugLog.append(row);
    while (debugLog.children.length > maxEvents) debugLog.firstElementChild?.remove();
    if (pinned) debugLog.scrollTop = debugLog.scrollHeight;
    debugMax.textContent = `SESSION MAX  LOCAL ${number(sessionMax.local)}  MAIN ${number(sessionMax.main)}  SAT IN ${number(sessionMax.saturator)}  SAT ACT ${(sessionMax.satActivity * 100).toFixed(0)} %  BAND ${BAND_DEFINITIONS[sessionMax.bandIndex]?.frequency ?? '—'} Hz  DOM ${(sessionMax.dominantMs / 1000).toFixed(1)} s  RESETS ${sessionMax.resets}`;
  };
  const log = (text, options = {}) => {
    if (!sessionStartedAt && !options.force) return;
    const key = options.key || text; const now = performance.now();
    if (options.throttle && now - (lastEventAt.get(key) || -Infinity) < options.throttle) return;
    lastEventAt.set(key, now); events.push({ time: timestamp(), text, warning: Boolean(options.warning) });
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    appendLogRow(events[events.length - 1]);
  };
  const resetSessionMax = () => { sessionMax = { local: 0, main: 0, saturator: 0, satActivity: 0, bandEnergy: 0, bandIndex: 0, dominantMs: 0, resets: 0 }; satThreshold = 0; dominant = { index: null, startedAt: performance.now(), logged: new Set() }; };
  const startSession = context => {
    sessionStartedAt = performance.now(); markerNumber = 0; snapshotNumber = 0; events.length = 0; snapshots.length = 0; lastEventAt.clear(); if (!debugConsole.hidden) debugLog.replaceChildren(); resetSessionMax(); latest = null; resetBaseline = null;
    const state = audioEngine || {}; log(`AUDIO START · SR ${Math.round(context?.sampleRate || 0)} Hz · ${context?.state || 'running'} · TOPOLOGY ${state.feedbackTopology || '—'} · TAP ${state.feedbackTap || '—'} · WET ${state.wetModel || '—'} · SAT ${state.commonBusSaturationMode || '—'}`, { force: true });
  };
  const ratio = (returnValue, tap) => Math.abs(finite(tap)) < 1e-6 ? null : Math.min(999, Math.abs(finite(returnValue)) / Math.abs(finite(tap)));
  const telemetryMetrics = packet => {
    const left = packet.left; const right = packet.right; const countL = Math.max(1, finite(left.frameCount)); const countR = Math.max(1, finite(right.frameCount));
    const sat = Math.max(finite(left.saturationActiveFrames) / countL, finite(right.saturationActiveFrames) / countR);
    const feedbackRatioLeft = ratio(left.commonFeedbackReturn, left.commonTapSum);
    const feedbackRatioRight = ratio(right.commonFeedbackReturn, right.commonTapSum);
    return { sat, feedbackRatio: feedbackRatioLeft === null && feedbackRatioRight === null ? null : Math.max(feedbackRatioLeft ?? 0, feedbackRatioRight ?? 0), dcLeft: finite(left.wetDcSum) / countL, dcRight: finite(right.wetDcSum) / countR,
      sourceRmsLeft: Math.sqrt(Math.max(0, finite(left.sourceEnergy) / countL)), sourceRmsRight: Math.sqrt(Math.max(0, finite(right.sourceEnergy) / countR)), wetRmsLeft: Math.sqrt(Math.max(0, finite(left.wetEnergy) / countL)), wetRmsRight: Math.sqrt(Math.max(0, finite(right.wetEnergy) / countR)) };
  };
  const push = (history, value) => { history.push(value); if (history.length > maxHistory) history.shift(); };
  const dominantBand = packet => {
    const metrics = getAnalyzerBandEnergyMetrics(packet);
    if (metrics.isSilent) return { index: null, energy: 0, dominance: 0, isSilent: true, startedAt: 0 };
    let index = 0; let energy = -1; let total = 0;
    metrics.energies.forEach((value, band) => { total += value; if (value > energy) { energy = value; index = band; } });
    return { index, energy: Math.max(0, energy), dominance: total > 0 ? Math.max(0, energy) / total : 0, isSilent: false, startedAt: dominant.startedAt };
  };
  const reset = () => {
    histories.common.length = histories.main.length = histories.resonance.length = 0;
    resetBaseline = latest ? { left: finite(latest.left.mainCommonNonFiniteResets), right: finite(latest.right.mainCommonNonFiniteResets) } : null;
    latest = null; render();
  };
  const renderTrace = (canvas, history, keys, range = 1) => {
    const rect = canvas.getBoundingClientRect(); const width = Math.max(1, Math.floor(rect.width)); const height = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext('2d'); context.clearRect(0, 0, width, height); context.strokeStyle = 'rgba(127,150,160,.28)'; context.lineWidth = 1;
    context.beginPath(); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
    const max = Math.max(range, ...history.flatMap(item => keys.map(key => Math.abs(finite(item[key])))));
    keys.forEach((key, keyIndex) => { context.strokeStyle = keyIndex ? getComputedStyle(document.documentElement).getPropertyValue('--secondary-text') : getComputedStyle(document.documentElement).getPropertyValue('--cyan'); context.lineWidth = 1.5; context.beginPath(); history.forEach((item, index) => { const x = history.length < 2 ? 0 : index * width / (maxHistory - 1); const y = height / 2 - finite(item[key]) / max * (height * .44); if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); }); context.stroke(); });
  };
  const render = () => {
    if (responseMode !== 'dev-lab' || filterbankWorkspace?.classList.contains('is-collapsed')) return;
    if (!latest) { summary.textContent = 'NO AUDIO — keine Telemetrie verfügbar'; bands.replaceChildren(); detail.textContent = ''; return; }
    const { left, right } = latest; const dominant = dominantBand(latest); const energyMetrics = getAnalyzerBandEnergyMetrics(latest); const frequencies = BAND_DEFINITIONS.map(band => band.frequency);
    const items = [
      ['RES TARGET', number(left.resonanceTarget)], ['RES SMOOTHED', number(left.smoothedResonance)], ['TOPOLOGY', left.feedbackTopology], ['TAP', left.feedbackTap], ['WET', left.wetModel], ['SAT', left.commonBusSaturationMode], ['DRIVE', number(left.commonBusDrive)], ['CEILING', number(left.commonBusCeiling)],
      ['POST GAIN FB WEIGHT', left.mainPostGainFeedbackWeightMode], ['FB ALL AMOUNT', `${number(left.feedbackAllAmount)} %`],
      ['CORE', left.feedbackCore !== 'current' && left.feedbackCoreEffective !== left.feedbackCore ? 'ZDF (INACTIVE: ISOLATED TPT)' : left.feedbackCore],
      ...(left.feedbackCoreEffective === 'zdf' ? [
        ['ZDF LOCAL BUS L/R', `${number(left.zdfLocalBus)} / ${number(right.zdfLocalBus)}`],
        ['ZDF MAIN BUS L/R', `${number(left.zdfMainBus)} / ${number(right.zdfMainBus)}`],
        ['ZDF TOTAL RETURN L/R', `${number(left.zdfTotalReturn)} / ${number(right.zdfTotalReturn)}`],
        ['ZDF SOLVER AVG L/R', `${number(finite(left.zdfSolverIterations) / Math.max(1, finite(left.frameCount)))} / ${number(finite(right.zdfSolverIterations) / Math.max(1, finite(right.frameCount)))}`],
        ['ZDF SOLVER MAX L/R', `${left.zdfSolverMaxIterations} / ${right.zdfSolverMaxIterations}`],
        ['ZDF RESIDUAL L/R', `${number(left.zdfSolverLastResidual)} / ${number(right.zdfSolverLastResidual)}`],
        ['ZDF WORST RES L/R', `${number(left.zdfSolverResidual)} / ${number(right.zdfSolverResidual)}`],
        ['ZDF FALLBACKS L/R', `${left.zdfSolverFallbackCount} / ${right.zdfSolverFallbackCount}`],
        ['ZDF NONFINITE L/R', `${left.zdfNonFiniteResetCount} / ${right.zdfNonFiniteResetCount}`]
      ] : []),
      ...(left.feedbackCoreEffective === 'zdf-per-band' ? [
        ['PER-BAND MAIN BUS L/R', `${number(left.zdfPerBandMainBus)} / ${number(right.zdfPerBandMainBus)}`],
        ['PER-BAND MAIN RET L/R', `${number(left.zdfPerBandMainReturn)} / ${number(right.zdfPerBandMainReturn)}`],
        ['PER-BAND SOLVER AVG L/R', `${number(finite(left.zdfPerBandCoupledSolverIterations) / Math.max(1, finite(left.frameCount)))} / ${number(finite(right.zdfPerBandCoupledSolverIterations) / Math.max(1, finite(right.frameCount)))}`],
        ['PER-BAND SOLVER MAX L/R', `${left.zdfPerBandCoupledSolverMaxIterations} / ${right.zdfPerBandCoupledSolverMaxIterations}`],
        ['PER-BAND RESIDUAL L/R', `${number(left.zdfPerBandCoupledSolverLastResidual)} / ${number(right.zdfPerBandCoupledSolverLastResidual)}`],
        ['PER-BAND FALLBACKS L/R', `${left.zdfPerBandCoupledFallbackCount} / ${right.zdfPerBandCoupledFallbackCount}`],
        ['PER-BAND NONFINITE L/R', `${left.zdfPerBandCoupledNonFiniteResetCount} / ${right.zdfPerBandCoupledNonFiniteResetCount}`]
      ] : []),
      ['LOCAL RET L/R', `${number(left.commonFeedbackReturn)} / ${number(right.commonFeedbackReturn)}`], ['LOCAL TAP L/R', `${number(left.commonTapSum)} / ${number(right.commonTapSum)}`], ['MAIN RET L/R', `${number(left.mainCommonFeedbackReturn)} / ${number(right.mainCommonFeedbackReturn)}`], ['MAIN TAP L/R', `${number(left.mainTapSum)} / ${number(right.mainTapSum)}`], ['MAIN SCALED L/R', `${number(left.mainTapSumScaled)} / ${number(right.mainTapSumScaled)}`], ['MAIN FB GAIN', number(left.mainFeedbackGain)], ['FB ALL SCALE', number(left.mainFeedbackLevelScale)],
      ['SOURCE PK L/R', `${number(left.sourcePeak)} / ${number(right.sourcePeak)}`], ['WET PK L/R', `${number(left.wetPeak)} / ${number(right.wetPeak)}`], ['LOCAL SAT IN/OUT L', `${number(left.commonSaturationInput)} / ${number(left.commonSaturationOutput)}`], ['LOCAL SAT IN/OUT R', `${number(right.commonSaturationInput)} / ${number(right.commonSaturationOutput)}`], ['MAIN SAT IN/OUT L', `${number(left.mainSaturationInput)} / ${number(left.mainSaturationOutput)}`], ['MAIN SAT IN/OUT R', `${number(right.mainSaturationInput)} / ${number(right.mainSaturationOutput)}`], ['MAIN RESETS L/R', `${Math.max(0, finite(left.mainCommonNonFiniteResets) - resetBaseline.left)} / ${Math.max(0, finite(right.mainCommonNonFiniteResets) - resetBaseline.right)}`]
    ];
    summary.replaceChildren(...items.map(([label, value]) => { const item = document.createElement('div'); item.innerHTML = `<span>${label}</span><b>${value ?? '—'}</b>`; return item; }));
    const metrics = telemetryMetrics(latest);
    const sourceCrestL = metrics.sourceRmsLeft > 1e-9 ? left.sourcePeak / metrics.sourceRmsLeft : 0;
    const sourceCrestR = metrics.sourceRmsRight > 1e-9 ? right.sourcePeak / metrics.sourceRmsRight : 0;
    const wetCrestL = metrics.wetRmsLeft > 1e-9 ? left.wetPeak / metrics.wetRmsLeft : 0;
    const wetCrestR = metrics.wetRmsRight > 1e-9 ? right.wetPeak / metrics.wetRmsRight : 0;
    detail.innerHTML = `<strong>${left.feedbackCoreEffective === 'zdf' || left.feedbackCoreEffective === 'zdf-per-band' ? 'DOMINANT BASE BAND' : 'DOMINANT BAND'}</strong><b>${frequencies[dominant.index]} Hz</b><span>DOMINANCE ${(dominant.dominance * 100).toFixed(0)} %</span><span>DOM STABLE ${((performance.now() - dominant.startedAt) / 1000).toFixed(1)} s</span><span>SAT ACT ${(metrics.sat * 100).toFixed(0)} % · RETURN/TAP ${metrics.feedbackRatio === null ? 'N/A' : metrics.feedbackRatio.toFixed(2)}</span><span>DC L/R ${number(metrics.dcLeft)} / ${number(metrics.dcRight)}</span><span>SRC CREST ${sourceCrestL.toFixed(2)} / ${sourceCrestR.toFixed(2)}</span><span>WET CREST ${wetCrestL.toFixed(2)} / ${wetCrestR.toFixed(2)}</span>`;
    if (dominant.isSilent || !Number.isFinite(dominant.startedAt) || dominant.startedAt <= 0 || performance.now() < dominant.startedAt) {
      detail.querySelector('b').textContent = 'N/A';
      detail.querySelectorAll('span')[1].textContent = 'DOM STABLE N/A';
    }
    bands.replaceChildren(...frequencies.map((frequency, index) => { const zdf = left.feedbackCoreEffective === 'zdf' || left.feedbackCoreEffective === 'zdf-per-band'; const energy = finite((zdf ? left.baseBandEnergy : left.bandEnergy)?.[index]) + finite((zdf ? right.baseBandEnergy : right.bandEnergy)?.[index]); const maxEnergy = Math.max(1e-12, dominant.energy); const row = document.createElement('div'); const gain = Math.max(audioEngine?.effectiveBandGainDbLeft?.[index] ?? 0, audioEngine?.effectiveBandGainDbRight?.[index] ?? 0); row.className = index === dominant.index ? 'is-dominant' : ''; row.innerHTML = `<span>${frequency >= 1000 ? `${(frequency / 1000).toFixed(1)} kHz` : `${frequency} Hz`}</span><i><b style="width:${Math.min(100, energy / maxEnergy * 100)}%"></b></i><em>${number(Math.max(finite((zdf ? left.baseBandPeak : left.bandPeak)?.[index]), finite((zdf ? right.baseBandPeak : right.bandPeak)?.[index])))}</em><small>${left.localGates?.[index] > .5 || right.localGates?.[index] > .5 ? 'FB ON' : 'FB OFF'} · ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB</small>`; return row; }));
    if (energyMetrics.isSilent) bands.querySelectorAll('i b').forEach(bar => { bar.style.width = '0%'; });
    renderTrace(responseLab.querySelector('[data-dev-lab-trace="common"]'), histories.common, ['left', 'right']);
    renderTrace(responseLab.querySelector('[data-dev-lab-trace="main"]'), histories.main, ['left', 'right']);
    renderTrace(responseLab.querySelector('[data-dev-lab-trace="resonance"]'), histories.resonance, ['target', 'smoothed'], 1);
  };
  const observe = packet => {
    const nextDominant = dominantBand(packet); const now = performance.now(); const metrics = telemetryMetrics(packet);
    if (nextDominant.isSilent) { dominant = { index: null, startedAt: 0, logged: new Set() }; }
    else if (dominant.index === null) { dominant.index = nextDominant.index; dominant.startedAt = now; dominant.logged.clear(); }
    else if (dominant.index !== nextDominant.index) { log(`DOMINANT BAND ${BAND_DEFINITIONS[dominant.index].frequency} Hz → ${BAND_DEFINITIONS[nextDominant.index].frequency} Hz`); dominant.index = nextDominant.index; dominant.startedAt = now; dominant.logged.clear(); }
    const stableMs = nextDominant.isSilent ? 0 : now - dominant.startedAt; sessionMax.dominantMs = Math.max(sessionMax.dominantMs, stableMs);
    [3000, 5000, 10000].forEach(threshold => { if (!nextDominant.isSilent && stableMs >= threshold && !dominant.logged.has(threshold)) { dominant.logged.add(threshold); log(`DOMINANT STABLE ${BAND_DEFINITIONS[dominant.index].frequency} Hz / ${(threshold / 1000).toFixed(1)} s`); } });
    const satPercent = metrics.sat * 100; const threshold = [90, 75, 50, 25].find(value => satPercent >= value) || 0;
    if (threshold > satThreshold) log(`SAT ACTIVITY ${threshold} % threshold crossed`);
    satThreshold = threshold || (satPercent < Math.max(0, satThreshold - 8) ? 0 : satThreshold);
    const resetCount = Math.max(finite(packet.left.mainCommonNonFiniteResets), finite(packet.right.mainCommonNonFiniteResets));
    if (resetCount > sessionMax.resets) log('WARNING NON-FINITE RESET / MAIN COMMON BUS', { warning: true });
    sessionMax.resets = Math.max(sessionMax.resets, resetCount); sessionMax.local = Math.max(sessionMax.local, Math.abs(finite(packet.left.commonFeedbackReturn)), Math.abs(finite(packet.right.commonFeedbackReturn))); sessionMax.main = Math.max(sessionMax.main, Math.abs(finite(packet.left.mainCommonFeedbackReturn)), Math.abs(finite(packet.right.mainCommonFeedbackReturn))); sessionMax.saturator = Math.max(sessionMax.saturator, Math.abs(finite(packet.left.commonSaturationInput)), Math.abs(finite(packet.right.commonSaturationInput)), Math.abs(finite(packet.left.mainSaturationInput)), Math.abs(finite(packet.right.mainSaturationInput))); sessionMax.satActivity = Math.max(sessionMax.satActivity, metrics.sat);
    const baseEnergy = packet.left.feedbackCoreEffective === 'zdf' || packet.left.feedbackCoreEffective === 'zdf-per-band';
    const leftEnergy = baseEnergy ? packet.left.baseBandEnergy : packet.left.bandEnergy;
    const rightEnergy = baseEnergy ? packet.right.baseBandEnergy : packet.right.bandEnergy;
    const energy = Math.max(...(leftEnergy || []).map((value, index) => finite(value) + finite(rightEnergy?.[index]))); if (energy > sessionMax.bandEnergy) { sessionMax.bandEnergy = energy; sessionMax.bandIndex = nextDominant.index; }
  };
  const receive = packet => {
    if (!packet?.left || !packet?.right) return;
    if (!resetBaseline) resetBaseline = { left: finite(packet.left.mainCommonNonFiniteResets), right: finite(packet.right.mainCommonNonFiniteResets) };
    observe(packet);
    if (frozen) return;
    latest = packet; audioLabel.textContent = 'LIVE · 15 Hz';
    push(histories.common, { left: packet.left.commonFeedbackReturn, right: packet.right.commonFeedbackReturn });
    push(histories.main, { left: packet.left.mainCommonFeedbackReturn, right: packet.right.mainCommonFeedbackReturn });
    push(histories.resonance, { target: packet.left.resonanceTarget, smoothed: packet.left.smoothedResonance }); render();
  };
  const setMode = mode => { hideAnalyzerDetails(); responseMode = mode; const dev = mode === 'dev-lab'; filterbankWorkspace?.classList.toggle('is-dev-lab', dev); responseLab.hidden = !dev; responseChart.hidden = dev; if (responseLegend) responseLegend.hidden = dev; spectrumForegroundControl.hidden = dev; normalResponseButton.classList.toggle('active', !dev); devResponseButton.classList.toggle('active', dev); normalResponseButton.setAttribute('aria-pressed', String(!dev)); devResponseButton.setAttribute('aria-pressed', String(dev)); render(); };
  normalResponseButton.addEventListener('click', () => setMode('normal')); devResponseButton.addEventListener('click', () => setMode('dev-lab'));
  freezeButton.addEventListener('click', () => { frozen = !frozen; freezeButton.textContent = frozen ? 'LIVE' : 'FREEZE'; freezeButton.setAttribute('aria-pressed', String(frozen)); });
  resetButton.addEventListener('click', () => { reset(); resetSessionMax(); log('RESET METRICS'); });
  const setConsoleOpen = open => { if (open) debugConsoleGeometry.ensure(); debugConsole.hidden = !open; consoleToggle.setAttribute('aria-expanded', String(open)); consoleToggle.classList.toggle('active', open); if (open) renderLog(); };
  consoleToggle.addEventListener('click', () => setConsoleOpen(debugConsole.hidden));
  debugConsole.querySelector('[data-debug-console-close]').addEventListener('click', () => { setConsoleOpen(false); consoleToggle.focus(); });
  responseLab.querySelector('[data-debug-mark]').addEventListener('click', () => { markerNumber += 1; log(`USER MARK #${markerNumber}`); });
  responseLab.querySelector('[data-debug-snapshot]').addEventListener('click', () => {
    if (!latest) { log('SNAPSHOT unavailable — NO AUDIO'); return; }
    snapshotNumber += 1; const d = dominantBand(latest); const m = telemetryMetrics(latest); const state = audioEngine || {}; const gains = state.effectiveBandGainDbLeft?.map(value => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`).join(',') || '—'; const fb = (state.feedbackBandLeft || []).map((on, index) => on ? index + 1 : null).filter(Boolean).join(',') || 'none';
    const text = `SNAPSHOT #${snapshotNumber} · RES ${number(latest.left.resonanceTarget)}/${number(latest.left.smoothedResonance)} · DOM ${BAND_DEFINITIONS[d.index].frequency} Hz/${((performance.now() - dominant.startedAt) / 1000).toFixed(1)} s · LOCAL ${number(latest.left.commonFeedbackReturn)}/${number(latest.right.commonFeedbackReturn)} · MAIN ${number(latest.left.mainCommonFeedbackReturn)}/${number(latest.right.mainCommonFeedbackReturn)} · SAT ${(m.sat * 100).toFixed(0)} % · FB ${fb} · GAIN [${gains}] · TOPOLOGY ${state.feedbackTopology} · TAP ${state.feedbackTap}`;
    snapshots.push(text); log(text);
  });
  debugConsole.querySelector('[data-debug-clear]').addEventListener('click', () => { events.length = 0; snapshots.length = 0; markerNumber = 0; renderLog(); });
  copyButton.addEventListener('click', async () => {
    const report = [`FILTERBANK DEBUG REPORT`, ...events.map(event => `${event.time}  ${event.text}`), '', `SESSION MAX`, `LOCAL ${number(sessionMax.local)} MAIN ${number(sessionMax.main)} SAT IN ${number(sessionMax.saturator)} SAT ACT ${(sessionMax.satActivity * 100).toFixed(0)} % BAND ${BAND_DEFINITIONS[sessionMax.bandIndex]?.frequency ?? '—'} Hz DOM ${(sessionMax.dominantMs / 1000).toFixed(1)} s RESETS ${sessionMax.resets}`].join('\n');
    try { await navigator.clipboard.writeText(report); copyState.textContent = 'COPIED'; setTimeout(() => { copyState.textContent = ''; }, 1200); } catch { copyState.textContent = 'COPY FAILED'; }
  });
  responseCollapseButton.addEventListener('click', () => requestAnimationFrame(render));
  setMode('normal');
  return { receive, reset, render, startSession, getLatest: () => latest, getDominant: () => ({ index: dominant.index, stableMs: dominant.index === null ? 0 : performance.now() - dominant.startedAt }), getMetrics: () => latest ? telemetryMetrics(latest) : null, logEvent: log, eventCount: () => events.length, logStateChange: (label, before, after) => { if (before !== after) log(`${label} ${before} → ${after}`, { key: label, throttle: 350 }); }, logPanic: () => log('PANIC'), setAudioOff: () => { log('AUDIO STOP'); if (!frozen) { latest = null; audioLabel.textContent = 'NO AUDIO'; render(); } } };
})();
window.FilterbankDebugConsole = devLabTelemetry;
devLabToggle?.addEventListener('click', () => {
  const open = Boolean(devLabPanel?.hidden);
  if (devLabPanel) devLabPanel.hidden = !open;
  devLabToggle.classList.toggle('active', open);
  devLabToggle.setAttribute('aria-expanded', String(open));
});
const addDevLabSelector = (label, attribute, options) => {
  const container = devLabGroups.get({
    'data-input-preamp-stage': 'input',
    'data-reference-level': 'filterbank',
    'data-band-boost-db': 'filterbank',
    'data-band-cut-db': 'filterbank',
    'data-spread-curve': 'filterbank',
    'data-spread-max-offset-db': 'filterbank',
    'data-wet-model': 'filterbank',
    'data-feedback-topology': 'local-feedback',
    'data-feedback-core': 'local-feedback',
    'data-local-loop-tuning': 'local-feedback',
    'data-feedback-tap': 'local-feedback',
    'data-common-bus-saturation-mode': 'local-feedback',
    'data-common-bus-drive': 'local-feedback',
    'data-common-bus-ceiling': 'local-feedback',
    'data-feedback-all-engine': 'main',
    'data-feedback-all-source': 'main',
    'data-post-gain-feedback-weight': 'main',
    'data-feedback-all-level': 'main',
    'data-feedback-all-resonance-curve': 'main',
    'data-feedback-all-saturation-return': 'main',
    'data-negative-resonance-mode': 'negative-resonance', 'data-negative-resonance-curve': 'negative-resonance',
    'data-negative-resonance-local': 'negative-resonance', 'data-negative-resonance-main': 'negative-resonance'
  }[attribute] ?? 'resonator');
  if (!container) return null;
  const control = document.createElement('label');
  control.className = 'dev-lab-control';
  const title = document.createElement('span');
  title.textContent = label;
  const select = document.createElement('select');
  select.setAttribute(attribute, '');
  options.forEach(([value, text]) => { const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option); });
  control.append(title, select);
  container.append(control);
  return select;
};
const addDevLabNumberControl = ({ label, attribute, min, max, step, suffix, tooltip, value, onChange, group = 'main' }) => {
  const container = devLabGroups.get(group); if (!container) return null;
  const control = document.createElement('label'); control.className = 'dev-lab-control';
  const title = document.createElement('span'); title.textContent = label;
  const input = document.createElement('input');
  input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value());
  input.setAttribute(attribute, ''); input.setAttribute('aria-label', `${label} ${suffix}`); input.title = tooltip;
  const unit = document.createElement('em'); unit.textContent = suffix;
  const apply = restoreInvalid => {
    const numeric = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(numeric)) { if (restoreInvalid) input.value = String(value()); return; }
    onChange(Math.min(max, Math.max(min, numeric))); input.value = String(value());
  };
  input.addEventListener('input', () => { if (input.value !== '') apply(false); });
  input.addEventListener('change', () => apply(true)); input.addEventListener('blur', () => apply(true));
  control.append(title, input, unit); container.append(control); return input;
};
const KEYBOARD_PREFERENCES_STORAGE_KEY = 'da-filta-keyboard-preferences-v1';
const KEY_STEP_DEFAULT_PERCENT = 5;
const KEY_SPEED_DEFAULT_HZ = 30;
const clampKeyboardPreference = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const readKeyboardPreferences = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEYBOARD_PREFERENCES_STORAGE_KEY) || 'null');
    return {
      keyStepPercent: clampKeyboardPreference(stored?.keyStepPercent, .1, 100, KEY_STEP_DEFAULT_PERCENT),
      keySpeedHz: clampKeyboardPreference(stored?.keySpeedHz, 1, 60, KEY_SPEED_DEFAULT_HZ)
    };
  } catch { return { keyStepPercent: KEY_STEP_DEFAULT_PERCENT, keySpeedHz: KEY_SPEED_DEFAULT_HZ }; }
};
const keyboardPreferences = readKeyboardPreferences();
const formatKeyboardPreference = (value, decimals) => String(Number(value.toFixed(decimals)));
const persistKeyboardPreferences = () => {
  try { window.localStorage.setItem(KEYBOARD_PREFERENCES_STORAGE_KEY, JSON.stringify(keyboardPreferences)); } catch { /* Storage may be unavailable. */ }
};
const addKeyboardPreferenceControl = ({ label, attribute, min, max, step, suffix, tooltip, value, onChange }) => {
  const container = devLabGroups.get('keyboard');
  if (!container) return null;
  const control = document.createElement('label'); control.className = 'dev-lab-control';
  const title = document.createElement('span'); title.textContent = label;
  const input = document.createElement('input');
  input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = formatKeyboardPreference(value(), step < 1 ? 1 : 0);
  input.setAttribute(attribute, ''); input.setAttribute('aria-label', `${label} ${suffix}`); input.title = tooltip;
  const unit = document.createElement('em'); unit.textContent = suffix;
  const apply = restoreInvalid => {
    const numeric = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(numeric)) { if (restoreInvalid) input.value = formatKeyboardPreference(value(), step < 1 ? 1 : 0); return; }
    onChange(Math.min(max, Math.max(min, numeric)));
    input.value = formatKeyboardPreference(value(), step < 1 ? 1 : 0);
  };
  input.addEventListener('input', () => { if (input.value !== '') apply(false); });
  input.addEventListener('change', () => apply(true)); input.addEventListener('blur', () => apply(true));
  control.append(title, input, unit); container.append(control); return input;
};
const keyStepInput = addKeyboardPreferenceControl({
  label: 'KEY STEP', attribute: 'data-key-step-percent', min: .1, max: 100, step: .1, suffix: '%',
  tooltip: 'Bestimmt, wie weit sich ein Band-Fader pro Tastaturschritt bewegt. Der Wert entspricht einem Prozentanteil des vollständigen Fader-Regelwegs. 5 % entspricht dem bisherigen Verhalten; 100 % bewegt den Fader mit einem Schritt bis zum jeweiligen Grenzwert.',
  value: () => keyboardPreferences.keyStepPercent,
  onChange: value => { keyboardPreferences.keyStepPercent = value; persistKeyboardPreferences(); }
});
const keySpeedInput = addKeyboardPreferenceControl({
  label: 'KEY SPEED', attribute: 'data-key-speed-hz', min: 1, max: 60, step: 1, suffix: 'Hz',
  tooltip: 'Bestimmt, wie viele Fader-Schritte pro Sekunde beim Gedrückthalten einer Tastaturtaste ausgeführt werden. Der erste Schritt erfolgt sofort. 30 Hz entspricht dem bisherigen Verhalten.',
  value: () => keyboardPreferences.keySpeedHz,
  onChange: value => { keyboardPreferences.keySpeedHz = value; persistKeyboardPreferences(); }
});
const referenceLevelSelect = addDevLabSelector('DEV REFERENCE', 'data-reference-level', [['1', '100 %'], ['0.75', '75 %'], ['0.5', '50 %'], ['0.25', '25 %'], ['0', '0 % / BANDS ONLY']]);
const resonanceEngineSelect = addDevLabSelector('DEV RES ENGINE', 'data-positive-resonance-engine', [['tpt', 'TPT'], ['phase2', 'PHASE 2']]);
const bandBoostSelect = addDevLabSelector('DEV BAND BOOST', 'data-band-boost-db', [['12', '+12 dB'], ['18', '+18 dB'], ['24', '+24 dB']]);
const bandCutSelect = addDevLabSelector('DEV BAND CUT', 'data-band-cut-db', [['12', '-12 dB'], ['24', '-24 dB'], ['36', '-36 dB'], ['48', '-48 dB'], ['60', '-60 dB']]);
const spreadCurveSelect = addDevLabSelector('SPREAD CURVE', 'data-spread-curve', [['linear', 'LINEAR'], ['quadratic', 'QUADRATIC'], ['smoothstep', 'SMOOTHSTEP']]);
const spreadMaxOffsetSelect = addDevLabSelector('DEV SPREAD MAX OFFSET', 'data-spread-max-offset-db', [['3', '3 dB'], ['6', '6 dB'], ['9', '9 dB'], ['12', '12 dB']]);
if (spreadCurveSelect) spreadCurveSelect.value = 'linear';
if (spreadMaxOffsetSelect) spreadMaxOffsetSelect.value = '6';
const feedbackTopologySelect = addDevLabSelector('DEV FB TOPOLOGY', 'data-feedback-topology', [['isolated-tpt', 'ISOLATED TPT'], ['common-bus', 'COMMON BUS'], ['local-loop-exp', 'LOCAL LOOP EXP']]);
const feedbackCoreSelect = addDevLabSelector('FEEDBACK CORE', 'data-feedback-core', [['current', 'CURRENT'], ['zdf', 'ZDF UNIFIED'], ['zdf-per-band', 'ZDF PER-BAND']]);
const localLoopTuningSelect = addDevLabSelector('DEV LOCAL LOOP TUNING', 'data-local-loop-tuning', [['current', 'CURRENT'], ['compensated', 'COMPENSATED']]);
const feedbackTapSelect = addDevLabSelector('DEV FB TAP', 'data-feedback-tap', [['pre-gain', 'PRE GAIN'], ['post-gain', 'POST GAIN']]);
const wetModelSelect = addDevLabSelector('DEV WET MODEL', 'data-wet-model', [['reference-delta', 'REFERENCE + DELTA'], ['filterbank-sum', 'FILTERBANK SUM']]);
const commonBusSatSelect = addDevLabSelector('DEV FB SAT', 'data-common-bus-saturation-mode', [['current', 'CURRENT'], ['constant-ceiling', 'CONSTANT CEILING']]);
const commonBusDriveSelect = addDevLabSelector('DEV FB DRIVE', 'data-common-bus-drive', [['0.5', '0.5'], ['1', '1'], ['2', '2'], ['4', '4'], ['8', '8'], ['16', '16']]);
const commonBusCeilingSelect = addDevLabSelector('DEV FB CEILING', 'data-common-bus-ceiling', [['0.25', '0.25'], ['0.5', '0.50'], ['1', '1.00'], ['2', '2.00'], ['4', '4.00']]);
const feedbackAllEngineSelect = addDevLabSelector('DEV FB ALL ENGINE', 'data-feedback-all-engine', [['legacy', 'LEGACY'], ['common-bus', 'COMMON BUS']]);
const feedbackAllSourceSelect = addDevLabSelector('DEV FB ALL SOURCE', 'data-feedback-all-source', [['pre-gain-sum', 'PRE GAIN SUM'], ['post-gain-sum', 'POST GAIN SUM']]);
if (feedbackAllSourceSelect) feedbackAllSourceSelect.value = 'post-gain-sum';
const postGainFeedbackWeightSelect = addDevLabSelector('DEV POST GAIN FB WEIGHT', 'data-post-gain-feedback-weight', [['current', 'CURRENT'], ['soft-knee', 'SOFT KNEE']]);
const feedbackAllLevelSelect = addDevLabSelector('DEV FB ALL LEVEL', 'data-feedback-all-level', [
  ['raw', 'RAW'],
  ['sqrt2', '1 / SQRT(2)'],
  ['half', '1 / 2'],
  ['sqrt10', '1 / SQRT(10)'],
  ['tenth', '1 / 10'],
  ['twentieth', '1 / 20'],
  ['fortieth', '1 / 40'],
  ['eightieth', '1 / 80']
]);
if (wetModelSelect) wetModelSelect.value = 'filterbank-sum';
if (feedbackTopologySelect) feedbackTopologySelect.value = 'common-bus';
if (feedbackTapSelect) feedbackTapSelect.value = 'post-gain';
if (feedbackAllEngineSelect) feedbackAllEngineSelect.value = 'common-bus';
if (feedbackAllLevelSelect) feedbackAllLevelSelect.value = 'sqrt10';
const feedbackAllAmountInput = addDevLabNumberControl({
  label: 'FB ALL AMOUNT', attribute: 'data-feedback-all-amount', min: 0, max: 100, step: 1, suffix: '%',
  tooltip: 'Skaliert ausschließlich die Stärke des gemeinsamen FB-ALL/MAIN-Feedback-Loops. 100 % entspricht dem bisherigen Verhalten. LOCAL-Feedback bleibt unverändert.',
  value: () => audioEngine?.feedbackAllAmount ?? 100,
  onChange: value => audioEngine?.setFeedbackAllAmount(value)
});
const feedbackAllResonanceCurveSelect = addDevLabSelector('DEV RESONANCE CURVE', 'data-feedback-all-resonance-curve', [['current', 'CURRENT'], ['soft-knee', 'SOFT KNEE']]);
const feedbackAllSaturationReturnSelect = addDevLabSelector('DEV MAIN SAT/RETURN', 'data-feedback-all-saturation-return', [['current', 'CURRENT'], ['drive-4-return-0.2', 'DRIVE 4 / RETURN 0.2']]);
const negativeResonanceModeSelect = addDevLabSelector('NEG MODE', 'data-negative-resonance-mode', [['signed', 'SIGNED'], ['damping', 'DAMPING'], ['anti-resonance', 'ANTI-RESONANCE'], ['phase', 'PHASE']]);
const negativeResonanceCurveSelect = addDevLabSelector('NEG CURVE', 'data-negative-resonance-curve', [['same-as-positive', 'SAME AS POSITIVE'], ['linear', 'LINEAR'], ['squared', 'SQUARED'], ['soft-knee', 'SOFT KNEE']]);
const negativeResonanceAmountInput = addDevLabNumberControl({ label: 'NEG AMOUNT', attribute: 'data-negative-resonance-amount', min: 0, max: 200, step: 1, suffix: '%', tooltip: 'Stärke des negativen Feedback-Experiments; kein Output-Gain.', value: () => audioEngine?.negativeResonanceAmount ?? 100, onChange: value => audioEngine?.setNegativeResonanceAmount(value), group: 'negative-resonance' });
const negativeResonanceLocalSelect = addDevLabSelector('NEG LOCAL', 'data-negative-resonance-local', [['on', 'ON'], ['off', 'OFF']]);
const negativeResonanceMainSelect = addDevLabSelector('NEG MAIN', 'data-negative-resonance-main', [['on', 'ON'], ['off', 'OFF']]);
const negativeResonancePhaseInput = addDevLabNumberControl({ label: 'NEG PHASE', attribute: 'data-negative-resonance-phase', min: 0, max: 180, step: 1, suffix: '°', tooltip: 'PHASE-Experiment: Zielstärke der stabilen negativen Phaseninteraktion.', value: () => audioEngine?.negativeResonancePhase ?? 90, onChange: value => audioEngine?.setNegativeResonancePhase(value), group: 'negative-resonance' });
const updateNegativeResonanceRelevance = () => { if (negativeResonancePhaseInput) negativeResonancePhaseInput.disabled = negativeResonanceModeSelect?.value !== 'phase'; };
negativeResonanceModeSelect?.addEventListener('change', event => { audioEngine?.setNegativeResonanceMode(event.target.value); updateNegativeResonanceRelevance(); });
negativeResonanceCurveSelect?.addEventListener('change', event => audioEngine?.setNegativeResonanceCurve(event.target.value));
negativeResonanceLocalSelect?.addEventListener('change', event => audioEngine?.setNegativeResonanceLocal(event.target.value === 'on'));
negativeResonanceMainSelect?.addEventListener('change', event => audioEngine?.setNegativeResonanceMain(event.target.value === 'on'));
updateNegativeResonanceRelevance();
const inputPreampStageSelect = addDevLabSelector('DEV INPUT STAGE', 'data-input-preamp-stage', [
  ['linear', 'LINEAR'],
  ['silk', 'SILK'],
  ['tape', 'TAPE'],
  ['tube', 'TUBE'],
  ['console', 'CONSOLE'],
  ['crunch', 'CRUNCH'],
  ['destroy', 'DESTROY']
]);
const addDevLabCharacterSlider = () => {
  const container = devLabGroups.get('input');
  if (!container) return null;
  const control = document.createElement('label');
  control.className = 'dev-lab-control dev-lab-character-control';
  const title = document.createElement('span');
  title.textContent = 'DEV CHARACTER';
  const row = document.createElement('span');
  row.className = 'dev-character-row';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
  slider.value = String(state.inputCharacterAmount);
  slider.setAttribute('data-input-character-amount', '');
  slider.setAttribute('aria-label', 'DEV Character Amount');
  const output = document.createElement('output');
  output.setAttribute('data-input-character-output', '');
  output.textContent = `${state.inputCharacterAmount} %`;
  row.append(slider, output);
  const scale = document.createElement('span');
  scale.className = 'dev-character-scale';
  scale.innerHTML = '<span>0 %</span><span>50 %</span><span>100 %</span>';
  control.append(title, row, scale);
  container.append(control);
  return slider;
};
const inputCharacterAmountSlider = addDevLabCharacterSlider();

const DEV_LAB_HELP = {
  'data-key-step-percent': {
    title: 'KEY STEP', what: 'Bestimmt, wie weit sich ein Band-Fader pro Tastaturschritt bewegt.',
    scope: 'Reine Keyboard-Bedienpräferenz. Der Wert ist ein Prozentanteil des vollständigen Fader-Regelwegs und verändert weder DSP noch Audio.',
    values: [['0.1 %', 'Kleinster Schritt.'], ['5 %', 'Bisheriges Verhalten.'], ['100 %', 'Ein Schritt bis zum Grenzwert.']],
    default: '5 %', note: 'Gültig von 0.1 % bis 100.0 %; die Präferenz wird separat gespeichert und nicht in Sweetspots übernommen.'
  },
  'data-key-speed-hz': {
    title: 'KEY SPEED', what: 'Bestimmt, wie viele Fader-Schritte pro Sekunde beim Gedrückthalten einer Tastaturtaste ausgeführt werden.',
    scope: 'Reine Keyboard-Bedienpräferenz. Der erste Schritt erfolgt sofort; nur weitere Schritte nutzen diese Rate.',
    values: [['1 Hz', 'Ein Wiederholungsschritt pro Sekunde.'], ['30 Hz', 'Bisherige Wiederholrate.'], ['60 Hz', 'Höchste Wiederholrate.']],
    default: '30 Hz', note: 'Gültig von 1 Hz bis 60 Hz; die Präferenz wird separat gespeichert und nicht in Sweetspots übernommen.'
  },
  'data-input-preamp-stage': {
    title: 'DEV INPUT STAGE', what: 'Wählt die feste nichtlineare Kennlinie beziehungsweise Klangcharakteristik.',
    scope: 'Wirkt nach dem Input Gain und vor der Dry/Wet-Verzweigung.',
    values: [['LINEAR', 'Vollständig linear; Character ist klanglich wirkungslos.'], ['SILK', 'Sehr subtiler, symmetrischer Peak-Rounding-Charakter.'], ['TAPE', 'Weiche, runde Saturation mit sanfter Verdichtung.'], ['TUBE', 'Warme asymmetrische Sättigung mit kompensiertem DC-Anteil.'], ['CONSOLE', 'Direkter, punchiger Charakter mit definierterem Knee.'], ['CRUNCH', 'Härtere, deutlich hörbare Verzerrung.'], ['DESTROY', 'Hartes, experimentelles Clipping/Fold-Verhalten.']],
    default: 'LINEAR', note: 'Input Gain = Ansteuerung. DEV CHARACTER = Charakteranteil. Die Kennlinie bleibt fest und verändert sich nicht automatisch mit dem Gain; keine Loudness Compensation.'
  },
  'data-input-character-amount': {
    title: 'DEV CHARACTER', what: 'Bestimmt unabhängig vom Input Gain, wie stark der gewählte Stage-Charakter dem linearen Signal aufgeprägt wird.',
    scope: 'Wirkt nach dem Input Gain im Input-Stage-Worklet und vor der Dry/Wet-Verzweigung.',
    values: [['0 %', 'Exakt linearer Ausgang; Input Gain bleibt aktiv.'], ['50 %', 'Hälftige Mischung aus linearer Eingangsspur und voller Stage-Kennlinie.'], ['100 %', 'Voller Charakter der gewählten Stage.']],
    default: '50 %', note: 'Input Gain = Ansteuerung, Character = Charakteranteil. Der Regler fügt keinen linearen Gain hinzu; bei LINEAR ist er klanglich wirkungslos.'
  },
  'data-reference-level': {
    title: 'DEV REFERENCE', what: 'Steuert den Anteil des Unity-Reference-Pfads im Wet-Signal.',
    scope: 'Nur im Wet Model REFERENCE + DELTA; Band-Gains werden nicht direkt verändert. Im FILTERBANK SUM-Wet-Modell wirkungslos.',
    values: [['100 %', 'Voller Unity-Reference-Anteil.'], ['75 %', 'Reference-Anteil 0,75.'], ['50 %', 'Reference-Anteil 0,50.'], ['25 %', 'Reference-Anteil 0,25.'], ['0 % / BANDS ONLY', 'Kein Unity-Reference-Anteil; im REFERENCE + DELTA-Modell bleibt der Band-/Delta-Anteil.']],
    default: '100 %', note: 'Experimenteller Wet-Model-Vergleich; keine Hardwarebehauptung.'
  },
  'data-band-boost-db': {
    title: 'DEV BAND BOOST', what: 'Legt den maximalen positiven dB-Bereich der Band-Gain-Fader fest.',
    scope: 'Wirkt auf die positive Hälfte jedes Band-Faders; Zwischenwerte werden linear im dB-Bereich abgebildet.',
    values: [['+12 dB', 'Fader +100 = +12 dB.'], ['+18 dB', 'Fader +100 = +18 dB.'], ['+24 dB', 'Fader +100 = +24 dB.']],
    default: '+12 dB', note: 'Experimenteller Kalibrierwert; kein bestätigter Erica-Hardwarewert.'
  },
  'data-band-cut-db': {
    title: 'DEV BAND CUT', what: 'Legt den maximalen negativen dB-Bereich der Band-Gain-Fader fest.',
    scope: 'Wirkt unabhängig vom Boost auf die negative Hälfte der Band-Fader; bei -60 dB sind -100 = -60 dB, -50 = -30 dB und 0 = 0 dB.',
    values: [['-12 dB', 'Fader -100 = -12 dB.'], ['-24 dB', 'Fader -100 = -24 dB.'], ['-36 dB', 'Fader -100 = -36 dB.'], ['-48 dB', 'Fader -100 = -48 dB.'], ['-60 dB', 'Fader -100 = -60 dB.']],
    default: '-12 dB', note: 'Experimenteller Kalibrierwert; kein bestätigter Erica-Hardwarewert.'
  },
  'data-spread-curve': {
    title: 'SPREAD CURVE', what: 'Wählt die Kennlinie des CLASSIC-SPREAD-Offsets.',
    scope: 'Nur FB MODE + CLASSIC: Ein gemeinsamer dB-Offset wird symmetrisch auf alle linken und rechten Band-Gains aufgeteilt. FB_CH_SELECT bleibt unverändert.',
    values: [['LINEAR', 'Offset folgt direkt dem SPREAD-Wert.'], ['QUADRATIC', 'Geringe Wirkung um die Mitte, stärkerer Anstieg zum Maximum.'], ['SMOOTHSTEP', 'Weicher Verlauf an Mitte und Maximum.']],
    default: 'LINEAR', note: 'DEV/LAB-Vergleich, keine finale Erica-Kennlinie.'
  },
  'data-spread-max-offset-db': {
    title: 'DEV SPREAD MAX OFFSET', what: 'Legt den maximalen CLASSIC-SPREAD-Offset pro Kanal fest.',
    scope: 'Nur FB MODE + CLASSIC. Der Offset wird für jeden Kanal separat am aktuellen Band-Gain-Limit geclampet; Basisfaderwerte bleiben unverändert.',
    values: [['3 dB', 'Maximal ±3 dB pro Kanal.'], ['6 dB', 'Maximal ±6 dB pro Kanal.'], ['9 dB', 'Maximal ±9 dB pro Kanal.'], ['12 dB', 'Maximal ±12 dB pro Kanal.']],
    default: '6 dB', note: 'Neutraler Test-Startwert, keine Produktionsentscheidung.'
  },
  'data-wet-model': {
    title: 'DEV WET MODEL', what: 'Wählt die experimentelle Bildung des Wet-Ausgangs.',
    scope: 'Wirkt im Wet-Pfad vor der Ausgabe; beeinflusst nicht die trockene Referenz direkt.',
    values: [['REFERENCE + DELTA', 'Unity-Reference plus Summe der durch Band-Gain erzeugten Delta-Beiträge.'], ['FILTERBANK SUM', 'Summe der tatsächlichen Bandpfade ohne direkten Unity-Reference-Pfad.']],
    default: 'REFERENCE + DELTA', note: 'Experimenteller Architekturvergleich, keine bestätigte interne Hardwaretopologie.'
  },
  'data-feedback-topology': {
    title: 'DEV FB TOPOLOGY', what: 'Wählt die Topologie des positiven individuellen Feedbacks.',
    scope: 'ISOLATED TPT verwendet den älteren Resonator-/Residualpfad. COMMON BUS führt aktive Band-Taps als gemeinsamen Return an alle Base-Filter zurück. LOCAL LOOP EXP führt jeden aktiven Bandpass über einen eigenen gesättigten One-Sample-Return nur an sein eigenes Band zurück.',
    values: [['ISOLATED TPT', 'Ältere separate Resonator-/TPT-Architektur.'], ['COMMON BUS', 'Aktive lokale Taps werden gemeinsam zurückgeführt und können dadurch alle Base-Bänder erneut anregen.'], ['LOCAL LOOP EXP', 'Jedes aktive Band besitzt einen getrennten lokalen äußeren Loop; MAIN/FB ALL kann zusätzlich weiterlaufen.']],
    default: 'ISOLATED TPT', note: 'Experimenteller Reverse-Engineering-Hörvergleich. Keine Schaltung wird als bewiesen behauptet.'
  },
  'data-feedback-core': {
    title: 'FEEDBACK CORE', what: 'Wählt den experimentellen Feedback-Core, ohne die normale Filterbank-Konfiguration zu ersetzen.',
    scope: 'CURRENT verwendet den bestehenden Feedback-Core. ZDF verwendet den alternativen Zero-Delay-Feedback-Core in den unterstützten Feedback-Topologien.',
    values: [['CURRENT', 'Bestehender CURRENT-Feedback-Core.'], ['ZDF', 'Alternativer ZDF-Feedback-Core für den direkten DEV/LAB-Vergleich.']],
    default: 'CURRENT', note: 'Experimentelle Core-Auswahl; Band-Gains, MAIN/FB ALL und die übrigen normalen Bedienelemente werden nicht durch diese Auswahl gespeichert.'
  },
  'data-local-loop-tuning': {
    title: 'DEV LOCAL LOOP TUNING', what: 'Wählt die interne Stimmung des experimentellen lokalen Feedback-Loops.',
    scope: 'Wirkt ausschließlich bei LOCAL LOOP EXP. CURRENT lässt die Base-Bandzentren unverändert; COMPENSATED verschiebt nur die Testbänder 218 Hz, 777 Hz, 1.5 kHz und 2.8 kHz abhängig von der tatsächlichen Worklet-Sample-Rate und dem vorhandenen TPT-Q.',
    values: [['CURRENT', 'Unveränderte Base-Bandzentren und das bisherige One-Sample-Delay-Verhalten.'], ['COMPENSATED', 'Stimmt die vier Testbänder intern höher, damit deren verzögerte lokale Selbstoszillation näher an der nominalen Bandfrequenz liegt.']],
    default: 'CURRENT', note: '5.2 kHz und 11 kHz bleiben unverändert. Gain, Saturation, Delay, MAIN/FB ALL und alle anderen Topologien werden nicht angepasst.'
  },
  'data-feedback-tap': {
    title: 'DEV FB TAP', what: 'Legt fest, ob der lokale COMMON-BUS-Tap Band-Ausgänge vor oder nach Band-Gain verwendet.',
    scope: 'Nur lokaler COMMON-BUS-Feedback-Tap; bei ISOLATED TPT und ohne lokalen Common Bus wirkungslos.',
    values: [['PRE GAIN', 'Verwendet den unverstärkten Base-Bandpass-Ausgang.'], ['POST GAIN', 'Verwendet den mit (1 + deltaGain) gewichteten Band-Ausgang; Boost/Cut verändert dadurch zusätzlich den lokalen Loop-Tap.']],
    default: 'PRE GAIN', note: 'Experimenteller DEV-Wert; keine Änderung an Band-Gain selbst.'
  },
  'data-common-bus-saturation-mode': {
    title: 'DEV FB SAT', what: 'Wählt die Sättigungskennlinie der Common-Bus-Returns.',
    scope: 'Nur positive COMMON-BUS-Returns: lokaler Common Return und MAIN/FB-ALL-Return werden jeweils mit dieser Kennlinie gesättigt.',
    values: [['CURRENT', 'Bestehende tanh()-Kennlinie.'], ['CONSTANT CEILING', 'Verwendet ceiling * tanh((drive * x) / ceiling).']],
    default: 'CURRENT', note: 'Experimenteller DEV-Wert; im LEGACY-FB-ALL-Pfad nicht die Legacy-Sättigung ersetzen.'
  },
  'data-common-bus-drive': {
    title: 'DEV FB DRIVE', what: 'Bestimmt den Drive-Faktor der CONSTANT-CEILING-Common-Bus-Kennlinie.',
    scope: 'Relevant für positive COMMON-BUS-Returns nur bei CONSTANT CEILING; im CURRENT-Modus wird dieser Wert nicht verwendet.',
    values: [['0.5', 'Niedrigere Ansteuerung der Kennlinie.'], ['1', 'Neutrale Ansteuerung.'], ['2', 'Doppelte Ansteuerung.'], ['4', 'Vierfache Ansteuerung.'], ['8', 'Achtfache Ansteuerung.'], ['16', 'Sechzehnfache Ansteuerung.']],
    default: '1', note: 'Experimenteller DEV-Wert; kein unabhängiger Gain-Regler.'
  },
  'data-common-bus-ceiling': {
    title: 'DEV FB CEILING', what: 'Bestimmt die Ceiling-Amplitude der CONSTANT-CEILING-Kennlinie.',
    scope: 'Relevant für positive COMMON-BUS-Returns nur bei CONSTANT CEILING; im CURRENT-Modus wird dieser Wert nicht verwendet.',
    values: [['0.25', 'Return-Ceiling 0,25.'], ['0.50', 'Return-Ceiling 0,50.'], ['1.00', 'Return-Ceiling 1,00.'], ['2.00', 'Return-Ceiling 2,00.'], ['4.00', 'Return-Ceiling 4,00.']],
    default: '1.00', note: 'Experimenteller DEV-Wert; wirkt zusammen mit der Formel ceiling * tanh((drive * x) / ceiling).'
  },
  'data-feedback-all-engine': {
    title: 'DEV FB ALL ENGINE', what: 'Wählt den MAIN-/FB-ALL-Feedbackpfad.',
    scope: 'LEGACY verwendet den bisherigen Legacy-FB-ALL-Pfad. COMMON BUS bildet einen eigenen MAIN-Return aus der Summe der Base-Band-Ausgänge.',
    values: [['LEGACY', 'Bisheriger Legacy-FB-ALL-Pfad.'], ['COMMON BUS', 'Eigener MAIN-Common-Bus-Return; lokaler Common Return und MAIN-Return werden getrennt gebildet und gesättigt, dann gemeinsam an den Filterbank-Eingang geführt.']],
    default: 'LEGACY', note: 'Experimenteller Architekturvergleich; keine bestätigte Erica-Schaltung.'
  },
  'data-feedback-all-source': {
    title: 'DEV FB ALL SOURCE', what: 'Wählt die Quelle der MAIN-/FB-ALL-Summe.',
    scope: 'Nur COMMON-BUS FB ALL / MAIN; die Auswahl erfolgt nach Bildung der jeweiligen MAIN-Summe und vor Level, Resonance-Gain und Saturation.',
    values: [['PRE GAIN SUM', 'Summe der Base-Band-Ausgänge vor Band-Gain.'], ['POST GAIN SUM', 'Summe der mit (1 + deltaGain) gewichteten Band-Ausgänge; Boost/Cut beeinflusst dadurch zusätzlich die MAIN-Schleife.']],
    default: 'POST GAIN SUM', note: 'Bei LEGACY wirkungslos; experimenteller MAIN-Tap-Vergleich.'
  },
  'data-post-gain-feedback-weight': {
    title: 'DEV POST GAIN FB WEIGHT', what: 'Formt ausschliesslich die Band-Gewichtung der MAIN-/FB-ALL-POST-GAIN-Summe.',
    scope: 'Nur COMMON BUS + FB ALL ENGINE = COMMON BUS + POST GAIN SUM. Hoerbarer Band-Gain, FILTERBANK SUM und der lokale POST-GAIN-Tap bleiben unveraendert; die Gewichtung liegt vor FB ALL LEVEL, Resonance und Saturation.',
    values: [['CURRENT', 'Verwendet den hoerbaren linearen Band-Gain unveraendert.'], ['SOFT KNEE', 'Bis +12 dB identisch; +18 dB werden zu +15 dB und +24 dB zu +18 dB fuer den MAIN-Tap gewichtet.']],
    default: 'CURRENT', note: 'Statische, zeitunabhaengige Feedback-Gewichtung; keine Kompression des hoerbaren Signals.'
  },
  'data-feedback-all-level': {
    title: 'DEV FB ALL LEVEL', what: 'Skaliert die gebildete MAIN-Tap-Summe.',
    scope: 'Ausschließlich COMMON-BUS-MAIN: MAIN-Tap-Summe → Level → feedbackGain (1.25 * resonance²) → bestehende Saturation → mainCommonReturn. LEGACY ignoriert den Wert.',
    values: [['RAW', 'Faktor 1,0.'], ['1 / SQRT(2)', 'Faktor ≈ 0,7071 (≈ -3,01 dB).'], ['1 / 2', 'Faktor 0,5 (≈ -6,02 dB).'], ['1 / SQRT(10)', 'Faktor 1 / sqrt(10) ≈ 0,316227766.'], ['1 / 10', 'Faktor 0,1.'], ['1 / 20', 'Faktor 0,05.'], ['1 / 40', 'Faktor 0,025.'], ['1 / 80', 'Faktor 0,0125.']],
    default: 'RAW', note: 'Experimentelle feste COMMON-BUS-MAIN-Kalibrierung; keine automatische Normalisierung und keine finale Klangentscheidung.'
  },
  'data-feedback-all-amount': {
    title: 'FB ALL AMOUNT', what: 'Skaliert ausschließlich die Stärke des gemeinsamen FB-ALL/MAIN-Feedback-Loops.',
    scope: 'Nur ZDF PER-BAND mit aktivem FB ALL / MAIN. Der Faktor wirkt im impliziten MAIN-Feedback-Gain vor der MAIN-Sättigung; LOCAL-Feedback bleibt unverändert.',
    values: [['0 %', 'Kein rekursiver MAIN-Return; der günstige LOCAL-only-Pfad bleibt aktiv.'], ['100 %', 'Entspricht exakt dem bisherigen Phase-2-MAIN-Verhalten.']],
    default: '100 %', note: 'Live geglättet; Resonance, FB ALL LEVEL und die LOCAL-Semantik werden nicht verändert.'
  },
  'data-positive-resonance-audition': {
    title: 'CAL DEV RES AUD', what: 'Bestimmt den zusätzlichen Audition-Anteil der positiven lokalen Resonance.',
    scope: 'Nur im positiven lokalen Pfad außerhalb des COMMON-BUS-Modus; wird mit dem hörbaren Residualanteil addiert.',
    values: [['0.10', 'Audition-Gain 0,10.'], ['0.20', 'Audition-Gain 0,20.'], ['0.30', 'Audition-Gain 0,30.'], ['0.40', 'Audition-Gain 0,40.'], ['0.60', 'Audition-Gain 0,60.'], ['0.80', 'Audition-Gain 0,80.'], ['1.00', 'Audition-Gain 1,00.'], ['1.50', 'Audition-Gain 1,50.'], ['2.00', 'Audition-Gain 2,00.'], ['4.00', 'Audition-Gain 4,00.']],
    default: '0.10', note: 'Experimenteller Hörtestwert; im aktuellen COMMON-BUS-Core wirkungslos.'
  },
  'data-positive-resonance-drive': {
    title: 'CAL DEV RES DRIVE', what: 'Bestimmt den Drive der positiven nichtlinearen TPT-Resonator-Saturation.',
    scope: 'Nur im positiven lokalen TPT-/nichtlinearen Resonatorpfad; im COMMON-BUS-Modus werden diese Resonator-Auditionpfade nicht verwendet.',
    values: [['1', 'Drive 1.'], ['2', 'Drive 2.'], ['4', 'Drive 4.'], ['8', 'Drive 8.'], ['16', 'Drive 16.'], ['24', 'Drive 24.'], ['32', 'Drive 32.']],
    default: '1', note: 'Experimenteller Resonator-LAB-Wert; kein FB-ALL- oder Common-Bus-Drive.'
  },
  'data-positive-resonance-damping-floor': {
    title: 'CAL DEV RES FLOOR', what: 'Bestimmt die Restdämpfung des positiven lokalen Resonators bei voller Resonance.',
    scope: 'Nur im positiven lokalen Resonatorpfad; steuert dessen Damping-Skala, nicht den COMMON-BUS-MAIN-Return.',
    values: [['0.10', 'Restdämpfung 0,10.'], ['0.05', 'Restdämpfung 0,05.'], ['0.02', 'Restdämpfung 0,02.'], ['0.00', 'Keine positive Restdämpfung.'], ['-0.02', 'Negative Grenz-/Selbstoszillationsanalyse.'], ['-0.05', 'Stärker negative Grenz-/Selbstoszillationsanalyse.'], ['-0.10', 'Am stärksten negative Grenz-/Selbstoszillationsanalyse.']],
    default: '0.10', note: 'Experimenteller Resonator-LAB-Wert; negative Werte dienen Analyse und sind keine finalen Hardwarewerte.'
  },
  'data-positive-resonance-output': {
    title: 'DEV RES OUTPUT', what: 'Wählt den hörbaren positiven Resonator-Ausgang bzw. Residualtyp.',
    scope: 'Nur im positiven lokalen Resonatorpfad; im aktuellen COMMON-BUS-Core ohne positive lokale Resonator-Audition wirkungslos.',
    values: [['CURRENT RESIDUAL', 'Aktuelles Resonator-Signal minus linearer Base-/Referenzpfad.'], ['NONLINEAR - BASE', 'Nichtlinearer Resonatorausgang minus dessen Base-Anteil.'], ['FULL NONLINEAR', 'Vollständiger nichtlinearer Resonatorausgang; im MATCHED-Modus latenzangepasst rekonstruiert.']],
    default: 'CURRENT RESIDUAL', note: 'Experimenteller TPT-/Residualvergleich.'
  },
  'data-positive-resonance-latency': {
    title: 'DEV RES LATENCY', what: 'Wählt die Latenzvariante des positiven Resonator-Auditionsignals.',
    scope: 'Nur im positiven lokalen Resonatorpfad; der aktuelle COMMON-BUS-MAIN-Pfad verwendet diese Auswahl nicht.',
    values: [['CURRENT', 'Aktuelle, direkt aus dem gewählten Resonatorpfad kommende Latenz.'], ['MATCHED', 'Latenzangepasste Variante für den direkten Vergleich mit dem Base-Pfad.']],
    default: 'CURRENT', note: 'Experimenteller TPT-/Residualvergleich.'
  },
  'data-positive-resonance-curve': {
    title: 'DEV RES CURVE', what: 'Formt die Kennlinie, mit der positive Resonance auf die lokale Resonator-Magnitude abgebildet wird.',
    scope: 'Nur positive lokale Resonance; COMMON BUS deaktiviert den lokalen Resonatorpfad, daher dort wirkungslos.',
    values: [['CURRENT', 'Lineare Resonance-Abbildung.'], ['EARLY', 'Früherer Anstieg über sqrt(resonance).'], ['AGGRESSIVE', 'Früherer/stärkerer Anstieg über cbrt(resonance).']],
    default: 'CURRENT', note: 'Experimenteller Resonator-LAB-Wert.'
  },
  'data-feedback-all-resonance-curve': {
    title: 'DEV RESONANCE CURVE', what: 'Formt ausschließlich die positive Resonance-zu-Feedback-Gain-Kennlinie des COMMON-BUS MAIN-/FB-ALL-Pfads.',
    scope: 'COMMON BUS + FB ALL ENGINE = COMMON BUS: CURRENT verwendet 1.25 * resonance². SOFT KNEE verteilt den oberen kritischen Bereich über mehr Reglerweg und erreicht bei 1.00 weiterhin exakt 1.25. LOCAL LOOP EXP, lokaler Common Bus, negative Resonance und Legacy-Pfade bleiben bei der bisherigen Kennlinie.',
    values: [['CURRENT', 'Unverändert: K = 1.25 * resonance².'], ['SOFT KNEE', 'Glatter A/B-Versuch mit mehr Auflösung vor dem Maximum.']],
    default: 'CURRENT', note: 'Nur Mapping; Topologie, Summierung, Saturation und FB-ALL-Level bleiben unverÃ¤ndert.'
  },
  'data-feedback-all-saturation-return': {
    title: 'DEV MAIN SAT/RETURN', what: 'A/B-Versuch nur im MAIN-/FB-ALL-COMMON-BUS-Return mit normaler CURRENT-tanh-Saturation.',
    scope: 'CURRENT bleibt unveraendert: tanh(K * S). DRIVE 4 / RETURN 0.2 verwendet 0.2 * tanh(4 * K * S). CONSTANT CEILING, lokaler Common Bus, LOCAL LOOP EXP, negative Resonance und Legacy bleiben unveraendert.',
    values: [['CURRENT', 'Unveraendert: tanh(K * S).'], ['DRIVE 4 / RETURN 0.2', 'Vierfacher Drive vor tanh, danach 0.2 Return-Level; Kleinsignal-Steigung 0.8.']],
    default: 'CURRENT', note: 'Nur ein MAIN-Return-A/B-Test; keine Topologie-, Pegel- oder Wet-Modell-Aenderung.'
  },
  'data-negative-resonance-mode': { title: 'NEG MODE', what: 'Wählt den ausschließlich bei negativer Resonance aktiven Feedback-Versuch.', default: 'SIGNED' },
  'data-negative-resonance-curve': { title: 'NEG CURVE', what: 'Normierte Magnitude für negative Resonance.', default: 'SAME AS POSITIVE' },
  'data-negative-resonance-amount': { title: 'NEG AMOUNT', what: 'Skaliert die negative Loop-Stärke von 0 bis 200 %, nicht den Output.', default: '100 %' },
  'data-negative-resonance-local': { title: 'NEG LOCAL', what: 'Schaltet nur den negativen LOCAL-Loop.', default: 'ON' },
  'data-negative-resonance-main': { title: 'NEG MAIN', what: 'Schaltet nur den negativen gemeinsamen MAIN-Loop.', default: 'ON' },
  'data-negative-resonance-phase': { title: 'NEG PHASE', what: 'Steuert ausschließlich den PHASE-Modus.', default: '90°' },
  'data-positive-resonance-engine': {
    title: 'DEV RES ENGINE', what: 'Wählt die Engine des positiven lokalen Resonators.',
    scope: 'Nur positive lokale Resonance außerhalb des COMMON-BUS-Modus; negative Resonance und FB ALL bleiben im Legacy-Pfad.',
    values: [['TPT', 'Nichtlinearer positiver TPT-Resonatorpfad mit dem aktuellen Residual-/Audition-Modell.'], ['PHASE 2', 'Ältere positive Phase-2-Resonator-/Prototyplösung.']],
    default: 'TPT', note: 'Experimenteller Engine-Vergleich; im aktuellen COMMON-BUS-Core wirkungslos.'
  }
};

const DEV_LAB_GROUP_HELP = {
  input: ['data-input-preamp-stage', 'data-input-character-amount'],
  keyboard: ['data-key-step-percent', 'data-key-speed-hz'],
  filterbank: ['data-reference-level', 'data-band-boost-db', 'data-band-cut-db', 'data-spread-curve', 'data-spread-max-offset-db', 'data-wet-model'],
  'local-feedback': ['data-feedback-topology', 'data-feedback-core', 'data-local-loop-tuning', 'data-feedback-tap', 'data-common-bus-saturation-mode', 'data-common-bus-drive', 'data-common-bus-ceiling'],
  main: ['data-feedback-all-engine', 'data-feedback-all-source', 'data-post-gain-feedback-weight', 'data-feedback-all-level', 'data-feedback-all-amount', 'data-feedback-all-resonance-curve', 'data-feedback-all-saturation-return'],
  'negative-resonance': ['data-negative-resonance-mode', 'data-negative-resonance-curve', 'data-negative-resonance-amount', 'data-negative-resonance-local', 'data-negative-resonance-main', 'data-negative-resonance-phase'],
  resonator: ['data-positive-resonance-audition', 'data-positive-resonance-drive', 'data-positive-resonance-damping-floor', 'data-positive-resonance-output', 'data-positive-resonance-latency', 'data-positive-resonance-curve', 'data-positive-resonance-engine']
};
const RESPONSE_DEV_LAB_HELP = [
  { title: 'FREEZE / LIVE', what: 'FREEZE hält ausschließlich die sichtbaren DEV-LAB-Livewerte und Zeitgraphen an. Event-Erfassung, Audio und DSP laufen weiter. LIVE setzt nur die visuelle Aktualisierung fort.' },
  { title: 'RESET METRICS', what: 'Löscht ausschließlich Diagnose-Historien, Diagnose-Maxima und resetbare Diagnose-Baselines. Audio- und DSP-Parameter bleiben unverändert.' },
  { title: 'DEBUG CONSOLE', what: 'Öffnet das frei verschiebbare und skalierbare Debug-Panel mit Ereignisprotokoll, Snapshots und Session-Maximalwerten. Die Audioverarbeitung bleibt unverändert.' },
  { title: 'MARK', what: 'Schreibt eine fortlaufende USER-MARK-Zeitmarke für Video- und Audioanalyse in das strukturierte Event-Log. Keine Audio- oder DSP-Änderung.' },
  { title: 'SNAPSHOT', what: 'Schreibt einen kompakten, passiven Momentzustand der vorhandenen Telemetrie und Filterbank-State in das Event-Log. Keine Parameter werden geändert.' }
];
const devLabTooltip = document.createElement('section');
devLabTooltip.className = 'dev-lab-tooltip';
devLabTooltip.id = 'dev-lab-tooltip';
devLabTooltip.setAttribute('role', 'dialog');
devLabTooltip.setAttribute('aria-label', 'DEV-LAB Hilfe');
devLabTooltip.hidden = true;
document.body.append(devLabTooltip);
let activeDevLabHelpButton = null;
const appendDevLabHelpText = (parent, text) => {
  if (!text) return;
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  parent.append(paragraph);
};
const renderDevLabHelp = (title, entries) => {
  devLabTooltip.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = title;
  devLabTooltip.append(heading);
  entries.forEach(help => {
    const section = document.createElement('section');
    section.className = 'dev-lab-help-entry';
    const entryHeading = document.createElement('h4');
    entryHeading.textContent = help.title;
    section.append(entryHeading);
    appendDevLabHelpText(section, help.what);
    appendDevLabHelpText(section, help.scope);
    if (help.values?.length) {
      const values = document.createElement('ul');
      help.values.forEach(([name, description]) => { const item = document.createElement('li'); const value = document.createElement('strong'); value.textContent = `${name} — `; item.append(value, description); values.append(item); });
      section.append(values);
    }
    appendDevLabHelpText(section, help.default);
    appendDevLabHelpText(section, help.note);
    devLabTooltip.append(section);
  });
};
const positionDevLabTooltip = () => {
  if (!activeDevLabHelpButton) return;
  const anchor = activeDevLabHelpButton.getBoundingClientRect();
  const width = Math.min(460, Math.max(280, window.innerWidth - 24));
  devLabTooltip.style.width = `${width}px`;
  devLabTooltip.style.maxHeight = `${Math.max(160, window.innerHeight - 24)}px`;
  const tooltipHeight = devLabTooltip.getBoundingClientRect().height;
  let left = anchor.right + 8;
  if (left + width > window.innerWidth - 12) left = anchor.left - width - 8;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  let top = anchor.top;
  if (top + tooltipHeight > window.innerHeight - 12) top = window.innerHeight - tooltipHeight - 12;
  top = Math.max(12, top);
  devLabTooltip.style.left = `${left}px`;
  devLabTooltip.style.top = `${top}px`;
};
const hideDevLabTooltip = () => {
  if (activeDevLabHelpButton) activeDevLabHelpButton.setAttribute('aria-expanded', 'false');
  activeDevLabHelpButton = null;
  devLabTooltip.hidden = true;
};
const showDevLabTooltip = button => {
  const key = button.dataset.devLabHelp;
  const entries = key === 'response' ? RESPONSE_DEV_LAB_HELP : (DEV_LAB_GROUP_HELP[key] || []).map(attribute => DEV_LAB_HELP[attribute]).filter(Boolean);
  if (!entries.length) return;
  activeDevLabHelpButton = button;
  renderDevLabHelp(key === 'response' ? 'FILTERBANK RESPONSE · DEV LAB' : button.closest('.dev-lab-group')?.querySelector('h2')?.textContent || 'DEV / LAB', entries);
  devLabTooltip.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  positionDevLabTooltip();
};
document.addEventListener('click', event => {
  const button = event.target.closest('.dev-lab-info-button');
  if (button) {
    if (button === activeDevLabHelpButton) hideDevLabTooltip();
    else { hideDevLabTooltip(); showDevLabTooltip(button); }
    return;
  }
  if (!devLabTooltip.hidden && !devLabTooltip.contains(event.target)) hideDevLabTooltip();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !devLabTooltip.hidden) hideDevLabTooltip(); });
window.addEventListener('resize', positionDevLabTooltip);
const THEME_STORAGE_KEY = 'da_filta-theme';
const LEGACY_THEME_STORAGE_KEY = 'resonant-filterbank-theme';
const CUSTOM_THEME_STORAGE_KEY = 'da_filta-custom-theme';
const THEME_VALUES = [
  'current', 'clean-modern', 'dark-studio', 'analog-inspired', 'minimal-dark', 'pro-console',
  'graphite', 'midnight', 'slate', 'forest', 'warm-studio',
  'copper-circuit', 'ultraviolet', 'deep-ocean', 'amber-crt', 'ice-lab'
];
const themeSelect = document.querySelector('[data-theme-select]');
const customThemeOption = themeSelect?.querySelector('option[value="custom"]');
const themeEditor = document.querySelector('.theme-editor');
const themeEditorToggle = document.querySelector('[data-theme-editor-toggle]');
const themeEditorPanel = document.querySelector('[data-theme-editor-panel]');
const themeEditorBase = document.querySelector('[data-theme-editor-base]');
const themeEditorStatus = document.querySelector('[data-theme-editor-status]');
const themeEditorFields = [...document.querySelectorAll('[data-theme-field]')];
const themeEditorOutputs = [...document.querySelectorAll('[data-theme-output]')];
const themeEditorReset = document.querySelector('[data-theme-reset]');
const themeEditorSave = document.querySelector('[data-theme-save]');
const themeEditorClear = document.querySelector('[data-theme-clear]');
const CUSTOM_THEME_PROPERTIES = [
  '--bg', '--cyan', '--text', '--page-background', '--overlay-opacity', '--overlay-line-x', '--overlay-line-y',
  '--panel-border', '--panel-background', '--panel-shadow', '--secondary-text', '--muted-text', '--strong-text',
  '--output-border', '--output-background', '--range-track', '--range-thumb-border', '--range-thumb-shadow',
  '--button-background', '--button-border', '--button-text', '--active-background', '--active-shadow',
  '--band-button-background', '--band-button-border', '--graph-background', '--graph-grid', '--graph-zero',
  '--graph-zero-shadow', '--graph-left', '--graph-right', '--graph-left-color', '--graph-right-color', '--graph-left-shadow', '--fader-track',
  '--fader-track-shadow', '--fader-thumb', '--error', '--color-scheme', '--theme-grid-background', '--spectrum-left', '--spectrum-right'
];
let editorTheme = null;
let runtimeThemeActive = false;
let editorThemeSaved = false;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const colorFromValue = (value, fallback = '#101820') => {
  const match = String(value || '').match(/#[0-9a-f]{3,8}\b/i);
  if (!match) return fallback;
  const hex = match[0].slice(1);
  return `#${hex.length === 3 ? [...hex].map(part => part + part).join('') : hex.slice(0, 6)}`;
};
const rgb = color => {
  const hex = colorFromValue(color).slice(1);
  return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
};
const hex = ([red, green, blue]) => `#${[red, green, blue].map(value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
const mixColor = (first, second, amount) => {
  const a = rgb(first); const b = rgb(second); const t = clamp(amount);
  return hex(a.map((value, index) => value + (b[index] - value) * t));
};
const withAlpha = (color, alpha) => {
  const [red, green, blue] = rgb(color);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha)})`;
};
const relativeLuminance = color => {
  const channels = rgb(color).map(value => value / 255).map(value => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
};
const changeSaturation = (color, saturation) => {
  const [red, green, blue] = rgb(color).map(value => value / 255);
  const max = Math.max(red, green, blue); const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return hex([red * 255, green * 255, blue * 255]);
  const chroma = max - min;
  let hue = max === red ? ((green - blue) / chroma + (green < blue ? 6 : 0)) : max === green ? (blue - red) / chroma + 2 : (red - green) / chroma + 4;
  hue /= 6;
  const nextSaturation = clamp((lightness > .5 ? chroma / (2 - max - min) : chroma / (max + min)) * saturation, 0, 1);
  const q = lightness < .5 ? lightness * (1 + nextSaturation) : lightness + nextSaturation - lightness * nextSaturation;
  const p = 2 * lightness - q;
  const channel = offset => { let t = hue + offset; if (t < 0) t += 1; if (t > 1) t -= 1; return (t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p) * 255; };
  return hex([channel(1 / 3), channel(0), channel(-1 / 3)]);
};
const adjustColor = (color, brightness, saturation) => {
  const saturated = changeSaturation(color, saturation / 100);
  return mixColor(saturated, brightness >= 0 ? '#ffffff' : '#000000', Math.abs(brightness) / 100 * .72);
};
const getBaseThemeName = theme => themeSelect?.querySelector(`option[value="${theme}"]`)?.textContent || theme;
const captureEditorTheme = baseTheme => {
  const style = getComputedStyle(document.body);
  return {
    baseTheme,
    accent: colorFromValue(style.getPropertyValue('--cyan'), '#10eaf7'),
    background: colorFromValue(style.getPropertyValue('--bg'), '#031319'),
    panel: colorFromValue(style.getPropertyValue('--panel-background'), '#15242a'),
    analyzerLeft: colorFromValue(style.getPropertyValue('--graph-left-color'), '#10eaf7'),
    analyzerRight: colorFromValue(style.getPropertyValue('--graph-right-color'), '#1bb9d2'),
    brightness: 0, contrast: 0, saturation: 100, glow: 50, borders: 50, grid: 50,
    gradients: true, shadows: true, backgroundGrid: true
  };
};
const normalizeEditorTheme = value => {
  const baseTheme = THEME_VALUES.includes(value?.baseTheme) ? value.baseTheme : 'current';
  const fallback = captureEditorTheme(baseTheme);
  const number = (key, min, max) => clamp(Number(value?.[key] ?? fallback[key]), min, max);
  return {
    ...fallback,
    baseTheme,
    accent: colorFromValue(value?.accent, fallback.accent), background: colorFromValue(value?.background, fallback.background),
    panel: colorFromValue(value?.panel, fallback.panel), analyzerLeft: colorFromValue(value?.analyzerLeft, fallback.analyzerLeft), analyzerRight: colorFromValue(value?.analyzerRight, fallback.analyzerRight),
    brightness: number('brightness', -100, 100), contrast: number('contrast', -100, 100), saturation: number('saturation', 0, 180), glow: number('glow', 0, 100), borders: number('borders', 0, 100), grid: number('grid', 0, 100),
    gradients: value?.gradients !== false, shadows: value?.shadows !== false, backgroundGrid: value?.backgroundGrid !== false
  };
};
const clearCustomTheme = () => {
  CUSTOM_THEME_PROPERTIES.forEach(property => document.body.style.removeProperty(property));
  runtimeThemeActive = false;
  document.dispatchEvent(new Event('da-filta-theme-change'));
};
const applyCustomTheme = theme => {
  const brightness = theme.brightness;
  const saturation = theme.saturation;
  let background = adjustColor(theme.background, brightness, saturation);
  let panel = adjustColor(theme.panel, brightness, saturation);
  const accent = adjustColor(theme.accent, brightness * .25, saturation);
  const left = adjustColor(theme.analyzerLeft, brightness * .2, saturation);
  const right = adjustColor(theme.analyzerRight, brightness * .2, saturation);
  const contrast = theme.contrast / 100;
  if (contrast < 0) panel = mixColor(panel, background, -contrast * .64);
  if (contrast > 0) panel = mixColor(panel, relativeLuminance(panel) > .48 ? '#ffffff' : '#000000', contrast * .15);
  const lightTheme = relativeLuminance(panel) > .46;
  const text = lightTheme ? '#17232b' : '#eaf1f3';
  const strongText = lightTheme ? '#0d1b22' : '#ffffff';
  const secondaryText = mixColor(text, panel, lightTheme ? .38 : .3);
  const mutedText = mixColor(text, panel, lightTheme ? .52 : .44);
  const border = mixColor(panel, text, .08 + theme.borders / 100 * .48);
  const output = mixColor(panel, background, .36);
  const graphBackground = mixColor(background, panel, .38);
  const button = mixColor(panel, text, lightTheme ? .055 : .09);
  const active = mixColor(panel, accent, lightTheme ? .22 : .18);
  const glow = theme.glow / 100;
  const gradient = (start, end) => theme.gradients ? `linear-gradient(145deg, ${start}, ${end})` : start;
  const set = (property, value) => document.body.style.setProperty(property, value);
  set('--bg', background); set('--cyan', accent); set('--text', text); set('--color-scheme', lightTheme ? 'light' : 'dark');
  set('--page-background', theme.gradients ? `radial-gradient(circle at 50% 0%, ${mixColor(panel, accent, .12)}, ${background} 58%, ${mixColor(background, '#000000', lightTheme ? 0 : .26)})` : background);
  set('--overlay-opacity', theme.backgroundGrid ? String(.025 + theme.grid / 100 * .18) : '0');
  set('--overlay-line-x', withAlpha(accent, .11)); set('--overlay-line-y', withAlpha(accent, .14));
  set('--panel-background', gradient(mixColor(panel, lightTheme ? '#ffffff' : accent, theme.gradients ? .035 : 0), panel));
  set('--panel-border', border); set('--panel-shadow', theme.shadows ? `0 3px 12px ${withAlpha(background, .3)}, inset 0 0 14px ${withAlpha(accent, .035)}` : 'none');
  set('--secondary-text', secondaryText); set('--muted-text', mutedText); set('--strong-text', strongText);
  set('--output-background', output); set('--output-border', mixColor(border, output, .25));
  set('--button-background', gradient(mixColor(button, lightTheme ? '#ffffff' : accent, .04), button)); set('--button-border', mixColor(border, text, .08)); set('--button-text', text);
  set('--band-button-background', gradient(mixColor(button, accent, .04), button)); set('--band-button-border', border);
  set('--active-background', gradient(mixColor(active, accent, .15), active));
  set('--active-shadow', glow ? `0 0 ${Math.round(3 + glow * 12)}px ${withAlpha(accent, .12 + glow * .48)}` : 'none');
  set('--range-track', theme.gradients ? `linear-gradient(90deg, ${accent}, ${mixColor(accent, panel, .64)})` : accent); set('--range-thumb-border', strongText); set('--range-thumb-shadow', glow ? `0 0 ${Math.round(2 + glow * 9)}px ${withAlpha(accent, .2 + glow * .55)}` : 'none');
  set('--graph-background', graphBackground); set('--graph-grid', withAlpha(mixColor(accent, text, .22), .42)); set('--theme-grid-background', `linear-gradient(to bottom, color-mix(in srgb, var(--graph-grid) ${theme.grid}%, transparent) 1px, transparent 1px)`);
  set('--graph-zero', withAlpha(accent, .58)); set('--graph-zero-shadow', glow ? `0 0 ${Math.round(2 + glow * 6)}px ${withAlpha(accent, glow * .42)}` : 'none');
  set('--graph-left', theme.gradients ? `linear-gradient(${mixColor(left, '#ffffff', .17)}, ${left})` : left); set('--graph-right', theme.gradients ? `linear-gradient(${mixColor(right, '#ffffff', .14)}, ${right})` : right); set('--graph-left-color', left); set('--graph-right-color', right); set('--graph-left-shadow', glow ? `0 0 ${Math.round(2 + glow * 6)}px ${withAlpha(left, glow * .45)}` : 'none');
  set('--spectrum-left', left); set('--spectrum-right', right);
  set('--fader-track', mixColor(output, background, .46)); set('--fader-track-shadow', theme.shadows ? `0 0 0 2px ${mixColor(background, '#000000', .35)}, 0 0 8px ${withAlpha(accent, .13)}` : 'none'); set('--fader-thumb', strongText);
  // Error/panic stays intentionally independent from the user accent.
  set('--error', lightTheme ? '#b43d35' : '#ff8b82');
  runtimeThemeActive = true;
  document.dispatchEvent(new Event('da-filta-theme-change'));
};
const readCustomTheme = () => { try { const stored = JSON.parse(window.localStorage.getItem(CUSTOM_THEME_STORAGE_KEY) || 'null'); return stored && typeof stored === 'object' ? stored : null; } catch { return null; } };
const updateCustomOption = () => {
  const hasCustom = Boolean(readCustomTheme());
  if (customThemeOption) customThemeOption.disabled = !hasCustom;
  if (themeEditorClear) themeEditorClear.hidden = !hasCustom;
};
const syncEditorUI = () => {
  if (!editorTheme) return;
  themeEditorBase.textContent = getBaseThemeName(editorTheme.baseTheme);
  themeEditorFields.forEach(field => { field[field.type === 'checkbox' ? 'checked' : 'value'] = editorTheme[field.dataset.themeField]; });
  themeEditorOutputs.forEach(output => { const key = output.dataset.themeOutput; output.textContent = key === 'saturation' ? `${editorTheme[key]}%` : editorTheme[key]; });
  themeEditorStatus.textContent = runtimeThemeActive && !editorThemeSaved ? 'UNSAVED' : '';
};
const readStoredTheme = () => {
  try {
    const currentTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (currentTheme !== null) return currentTheme;
    const legacyTheme = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (legacyTheme !== null) window.localStorage.setItem(THEME_STORAGE_KEY, legacyTheme);
    return legacyTheme;
  } catch { return null; }
};
const applyTheme = value => {
  const savedCustom = value === 'custom' ? readCustomTheme() : null;
  if (savedCustom) {
    const baseTheme = THEME_VALUES.includes(savedCustom.baseTheme) ? savedCustom.baseTheme : 'current';
    clearCustomTheme(); document.body.dataset.theme = baseTheme;
    editorTheme = normalizeEditorTheme(savedCustom); applyCustomTheme(editorTheme); editorThemeSaved = true;
    if (themeSelect) themeSelect.value = 'custom';
    try { window.localStorage.setItem(THEME_STORAGE_KEY, 'custom'); } catch { /* Storage may be unavailable. */ }
  } else {
    const theme = THEME_VALUES.includes(value) ? value : 'current';
    clearCustomTheme(); document.body.dataset.theme = theme; editorTheme = null; editorThemeSaved = false;
    if (themeSelect) themeSelect.value = theme;
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Storage may be unavailable. */ }
  }
  updateCustomOption(); syncEditorUI();
};
applyTheme(readStoredTheme());
themeSelect?.addEventListener('change', event => applyTheme(event.target.value));
const setThemeEditorOpen = open => {
  if (!themeEditorPanel || !themeEditorToggle) return;
  if (open && !editorTheme) editorTheme = captureEditorTheme(document.body.dataset.theme || 'current');
  themeEditorPanel.hidden = !open; themeEditorToggle.setAttribute('aria-expanded', String(open));
  if (open) syncEditorUI();
};
themeEditorToggle?.addEventListener('click', () => setThemeEditorOpen(themeEditorPanel.hidden));
themeEditorFields.forEach(field => field.addEventListener('input', () => {
  if (!editorTheme) editorTheme = captureEditorTheme(document.body.dataset.theme || 'current');
  const key = field.dataset.themeField;
  editorTheme[key] = field.type === 'checkbox' ? field.checked : field.type === 'range' ? Number(field.value) : colorFromValue(field.value);
  editorThemeSaved = false; applyCustomTheme(editorTheme); syncEditorUI();
}));
themeEditorReset?.addEventListener('click', () => { const base = editorTheme?.baseTheme || document.body.dataset.theme || 'current'; applyTheme(base); editorTheme = captureEditorTheme(base); syncEditorUI(); });
themeEditorSave?.addEventListener('click', () => {
  if (!editorTheme) editorTheme = captureEditorTheme(document.body.dataset.theme || 'current');
  try { window.localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify({ version: 1, ...editorTheme })); } catch { return; }
  runtimeThemeActive = true; editorThemeSaved = true; updateCustomOption();
  if (themeSelect) themeSelect.value = 'custom';
  try { window.localStorage.setItem(THEME_STORAGE_KEY, 'custom'); } catch { /* Storage may be unavailable. */ }
  syncEditorUI();
});
themeEditorClear?.addEventListener('click', () => {
  const base = editorTheme?.baseTheme || document.body.dataset.theme || 'current';
  try { window.localStorage.removeItem(CUSTOM_THEME_STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
  updateCustomOption(); applyTheme(base); setThemeEditorOpen(false);
});
document.addEventListener('pointerdown', event => { if (themeEditor && !themeEditor.contains(event.target)) setThemeEditorOpen(false); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') setThemeEditorOpen(false); });
window.DaFiltaThemeEditor = { applyCustomTheme, clearCustomTheme, getState: () => editorTheme && ({ ...editorTheme }) };
const bands = document.querySelector('.bands');
bands.innerHTML = BAND_DEFINITIONS.map((band,index) => `<article class="band-card"><div class="band-actions"><button class="band-action" type="button" data-feedback-band="${index}">FB</button><button class="band-action" type="button" data-mod-band="${index}">MOD</button></div><output class="band-slider-value" data-band-value="${index}">0.0 dB</output><div class="fader-wrap"><span class="fader-label positive">+</span><div class="fader-track"><div class="fader-hit-area"><input class="band-fader" type="range" min="${BAND_GAIN_MIN}" max="${BAND_GAIN_MAX}" step="0.1" value="${BAND_GAIN_NEUTRAL}" data-band="${index}" aria-label="${band.label} Fader"></div></div><span class="fader-label negative">−</span></div><div class="band-value">${band.label}</div></article>`).join('');
const formatValue = (name,value) => { if(name==='dryWet') return `${Math.round(value)} %`; if(name==='inputGain'||name==='volume') return `${Number(value).toFixed(1)} dB`; return Number(value).toFixed(2).replace(/\.?0+$/,''); };

const bars = document.querySelector('.bars');
bars.innerHTML = Array.from({ length: BAND_COUNT }, (_, i) => `<div class="bar-pair" data-analyzer-band="${i}" tabindex="0" aria-label="Band ${i + 1}, ${BAND_DEFINITIONS[i].label}"><i data-channel="left"></i><i data-channel="right"></i><b class="analyzer-peak analyzer-peak-left"></b><b class="analyzer-peak analyzer-peak-right"></b><small class="analyzer-band-delta"></small><em class="analyzer-feedback-marker" aria-hidden="true">FB</em><em class="analyzer-osc-marker" aria-hidden="true">OSC</em></div>`).join('');
const faders = [...document.querySelectorAll('.band-fader')];
const analyzerDetail = document.createElement('div');
analyzerDetail.className = 'analyzer-band-detail';
analyzerDetail.hidden = true;
responseChart?.append(analyzerDetail);
const analyzerFeedbackMeter = document.createElement('div');
analyzerFeedbackMeter.className = 'analyzer-feedback-energy';
analyzerFeedbackMeter.hidden = true;
analyzerFeedbackMeter.innerHTML = '<span>FB ENERGY</span><em>LOCAL</em><i data-feedback-energy="local"><b></b></i><em>MAIN</em><i data-feedback-energy="main"><b></b></i>';
responseChart?.append(analyzerFeedbackMeter);
const analyzerSaturationBadge = document.createElement('span');
analyzerSaturationBadge.className = 'analyzer-saturation-indicator';
analyzerSaturationBadge.hidden = true;
analyzerSaturationBadge.textContent = 'SAT';
responseChart?.append(analyzerSaturationBadge);
const collapsedAnalyzerDetail = document.createElement('div');
collapsedAnalyzerDetail.className = 'collapsed-analyzer-detail';
collapsedAnalyzerDetail.hidden = true;
collapsedPreview = document.createElement('div');
collapsedPreview.className = 'collapsed-analyzer-preview';
collapsedPreview.hidden = true;
collapsedPreview.innerHTML = '<svg viewBox="0 0 1000 42" preserveAspectRatio="none" aria-hidden="true"><path></path></svg>' + Array.from({ length: BAND_COUNT }, (_, index) => `<button type="button" data-collapsed-band="${index}" aria-label="Band ${index + 1}, ${BAND_DEFINITIONS[index].label}"><i></i><span>${index + 1}</span></button>`).join('');
analyzerFooter?.append(collapsedPreview, collapsedAnalyzerDetail);
const analyzerMotion = Array.from({ length: BAND_COUNT }, () => ({ left: 0, right: 0, peakLeft: 0, peakRight: 0, peakLeftAt: 0, peakRightAt: 0 }));
const analyzerOscillation = Array.from({ length: BAND_COUNT }, () => ({ since: 0, active: false }));
const collapsedPreviewLevels = Array(BAND_COUNT).fill(0);
let analyzerAnimationFrame = 0;
let analyzerLastFrame = performance.now();
let analyzerDetailMode = 'hidden';
let hoveredAnalyzerBand = null;
const toDb = value => `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)} dB`;
const getAnalyzerEffective = index => audioEngine?.getEffectiveBandGains(index) ?? getEffectiveBandGains(state, index, { maxBandBoostDb: getBandBoostDb(), maxBandCutDb: getBandCutDb() });
const getAnalyzerTelemetry = () => devLabTelemetry.getLatest?.() || null;
const getEnergyPair = (packet, index) => {
  const zdf = packet?.left?.feedbackCoreEffective === 'zdf' || packet?.left?.feedbackCoreEffective === 'zdf-per-band';
  const left = zdf ? packet?.left?.baseBandEnergy : packet?.left?.bandEnergy;
  const right = zdf ? packet?.right?.baseBandEnergy : packet?.right?.bandEnergy;
  return (Number(left?.[index]) || 0) + (Number(right?.[index]) || 0);
};
const analyzerBandInfo = index => {
  const effective = getAnalyzerEffective(index);
  const packet = getAnalyzerTelemetry();
  const feedback = Boolean(state.feedbackBandLeft[index] || state.feedbackBandRight[index]);
  return { index, effective, delta: effective.leftDb - effective.rightDb, feedback, dominant: devLabTelemetry.getDominant?.().index === index, oscillating: analyzerOscillation[index].active, energy: getEnergyPair(packet, index) };
};
const detailText = index => {
  const info = analyzerBandInfo(index);
  return [`BAND ${index + 1} · ${BAND_DEFINITIONS[index].label}`, `L ${toDb(info.effective.leftDb)}`, `R ${toDb(info.effective.rightDb)}`, ...(analyzerDisplay.spreadDelta || Math.abs(info.delta) > .005 ? [`Δ ${toDb(info.delta)}`] : []), info.feedback ? 'FB ON' : 'FB OFF', ...(state.feedbackAllLeft || state.feedbackAllRight ? ['MAIN'] : []), ...(info.dominant ? ['DOM'] : []), ...(info.oscillating ? ['OSC'] : [])];
};
const hideDetailElement = detail => { detail.hidden = true; };
hideAnalyzerDetails = () => {
  hoveredAnalyzerBand = null;
  analyzerDetailMode = 'hidden';
  hideDetailElement(analyzerDetail);
  hideDetailElement(collapsedAnalyzerDetail);
  bars.querySelectorAll('.is-hovered').forEach(element => element.classList.remove('is-hovered'));
  collapsedPreview?.querySelectorAll('.is-hovered').forEach(element => element.classList.remove('is-hovered'));
};
clearAnalyzerHover = () => {
  hoveredAnalyzerBand = null;
  bars.querySelectorAll('.is-hovered').forEach(element => element.classList.remove('is-hovered'));
  collapsedPreview?.querySelectorAll('.is-hovered').forEach(element => element.classList.remove('is-hovered'));
  hideDetailElement(collapsedAnalyzerDetail);
  if (analyzerDetailMode === 'hover') {
    analyzerDetailMode = 'hidden';
    hideDetailElement(analyzerDetail);
  }
};
const renderAnalyzerDetail = (index, anchor, collapsed = false) => {
  const detail = collapsed ? collapsedAnalyzerDetail : analyzerDetail;
  const container = collapsed ? analyzerFooter : responseChart;
  detail.replaceChildren(...detailText(index).map((line, lineIndex) => { const row = document.createElement(lineIndex === 0 ? 'strong' : 'span'); row.textContent = line; return row; }));
  detail.hidden = false;
  const containerRect = container.getBoundingClientRect();
  const rect = anchor?.getBoundingClientRect?.() || containerRect;
  detail.style.left = `${Math.max(4, Math.min(containerRect.width - 116, rect.left - containerRect.left + rect.width / 2 - 58))}px`;
  detail.style.top = collapsed ? '2px' : `${Math.max(4, Math.min(containerRect.height - 82, rect.top - containerRect.top + 8))}px`;
};
const showAnalyzerHover = (index, anchor, collapsed = false) => {
  if (!analyzerDisplay.hoverValues) return;
  hideAnalyzerDetails();
  hoveredAnalyzerBand = index;
  analyzerDetailMode = 'hover';
  anchor?.classList.add('is-hovered');
  renderAnalyzerDetail(index, anchor, collapsed);
};
const refreshStatusStrip = () => {
  if (!liveStatusStrip) return;
  const engine = audioEngine || {};
  const mainActive = state.feedbackAllLeft || state.feedbackAllRight;
  const activeBands = state.feedbackBandLeft.map((enabled, index) => enabled || state.feedbackBandRight[index] ? index + 1 : null).filter(Boolean);
  const packet = getAnalyzerTelemetry();
  const sat = packet && ((Number(packet.left?.saturationActiveFrames) || 0) > 0 || (Number(packet.right?.saturationActiveFrames) || 0) > 0);
  const tokens = [
    `INPUT ${Number(state.inputGain).toFixed(1)} dB`,
    Number(engine.commonBusDrive) > 1 ? `DRIVE ${engine.commonBusDrive}` : null,
    engine.feedbackTopology ? `FB ${String(engine.feedbackTopology).replaceAll('-', ' ').toUpperCase()}` : null,
    engine.feedbackCore ? String(engine.feedbackCore).toUpperCase() : null,
    `SPREAD ${state.spread >= 0 ? '+' : ''}${Math.round(state.spread * 100)}`,
    `OUT ${Number(state.volume).toFixed(1)} dB`,
    engine.feedbackTap ? (engine.feedbackTap === 'post-gain' ? 'POST' : 'PRE') : null,
    mainActive ? 'MAIN' : null,
    activeBands.length ? `FB ${activeBands.join(' ')}` : null,
    sat ? 'SAT' : null
  ].filter(Boolean);
  liveStatusStrip.replaceChildren(...tokens.map(token => { const badge = document.createElement('span'); badge.textContent = token; if (token === 'MAIN' || token === 'SAT' || token === 'ZDF') badge.classList.add('is-active'); if (token === 'SAT') badge.classList.add('is-warning'); return badge; }));
  liveStatusStrip.hidden = !analyzerDisplay.liveStatusStrip;
};
const updateOscillation = () => {
  const packet = getAnalyzerTelemetry();
  if (!packet) return;
  const energies = Array.from({ length: BAND_COUNT }, (_, index) => getEnergyPair(packet, index));
  const strongest = Math.max(1e-9, ...energies);
  const now = performance.now();
  energies.forEach((energy, index) => {
    const gated = state.feedbackBandLeft[index] || state.feedbackBandRight[index] || state.feedbackAllLeft || state.feedbackAllRight;
    const sustained = gated && energy > .00001 && energy >= strongest * .42;
    const candidate = analyzerOscillation[index];
    if (sustained) { if (!candidate.since) candidate.since = now; if (now - candidate.since >= 650) candidate.active = true; }
    else if (candidate.active && now - candidate.since < 1100) { /* short release hysteresis */ }
    else { candidate.since = 0; candidate.active = false; }
  });
};
const renderTelemetryIndicators = () => {
  const packet = getAnalyzerTelemetry();
  const left = packet?.left; const right = packet?.right;
  const local = Math.max(Math.abs(Number(left?.commonFeedbackReturn) || 0), Math.abs(Number(right?.commonFeedbackReturn) || 0));
  const main = Math.max(Math.abs(Number(left?.mainCommonFeedbackReturn) || 0), Math.abs(Number(right?.mainCommonFeedbackReturn) || 0));
  analyzerFeedbackMeter.hidden = !analyzerDisplay.feedbackEnergy;
  analyzerFeedbackMeter.querySelector('[data-feedback-energy="local"] b').style.width = `${Math.min(100, Math.sqrt(local) * 100)}%`;
  analyzerFeedbackMeter.querySelector('[data-feedback-energy="main"] b').style.width = `${Math.min(100, Math.sqrt(main) * 100)}%`;
  const frames = Math.max(1, Number(left?.frameCount) || 0, Number(right?.frameCount) || 0);
  const saturated = Math.max(Number(left?.saturationActiveFrames) || 0, Number(right?.saturationActiveFrames) || 0) / frames > .01 || Math.max(Math.abs(Number(left?.wetPeak) || 0), Math.abs(Number(right?.wetPeak) || 0)) >= .995;
  analyzerSaturationBadge.hidden = !analyzerDisplay.saturationIndicators || !saturated;
};
const renderCollapsedPreview = index => {
  const button = collapsedPreview.querySelector(`[data-collapsed-band="${index}"]`);
  if (!button) return;
  const motion = analyzerMotion[index];
  const packet = getAnalyzerTelemetry();
  const energyMetrics = getAnalyzerBandEnergyMetrics(packet);
  const peakEnergy = Math.max(...energyMetrics.energies);
  const audioLevel = !energyMetrics.isSilent && peakEnergy > 0 ? Math.min(1, Math.sqrt(energyMetrics.energies[index] / peakEnergy)) : 0;
  const targetLevel = packet && !energyMetrics.isSilent ? Math.min(1, Math.max(Math.abs(motion.left), Math.abs(motion.right)) / 260 + audioLevel * .82) : 0;
  const previousLevel = collapsedPreviewLevels[index];
  const level = targetLevel >= previousLevel ? targetLevel : previousLevel + (targetLevel - previousLevel) * .13;
  collapsedPreviewLevels[index] = level;
  button.style.setProperty('--preview-level', level.toFixed(3));
  const info = analyzerBandInfo(index);
  button.classList.toggle('is-active', info.feedback || info.dominant || info.oscillating);
  button.title = detailText(index).join('\n');
};
const renderCollapsedPreviewLine = () => {
  const path = collapsedPreview.querySelector('svg path');
  if (!path) return;
  const points = collapsedPreviewLevels.map((level, index) => ({ x: (index + .5) * 100, y: 35 - level * 28 }));
  const edgePoints = [{ x: 0, y: points[0].y }, ...points, { x: 1000, y: points.at(-1).y }];
  const d = edgePoints.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  path.setAttribute('d', d);
};
const animateAnalyzer = now => {
  analyzerAnimationFrame = 0;
  const elapsed = Math.min(100, Math.max(1, now - analyzerLastFrame));
  analyzerLastFrame = now;
  let needsFrame = false;
  updateOscillation();
  for (let index = 0; index < BAND_COUNT; index += 1) {
    const info = analyzerBandInfo(index); const motion = analyzerMotion[index];
    [['left', info.effective.leftControl, 'peakLeft', 'peakLeftAt'], ['right', info.effective.rightControl, 'peakRight', 'peakRightAt']].forEach(([channel, target, peakKey, peakAtKey]) => {
      const previous = motion[channel];
      const current = !analyzerDisplay.smoothDecay || Math.abs(target) >= Math.abs(previous) ? target : previous + (target - previous) * (1 - Math.exp(-elapsed / 150));
      motion[channel] = current;
      const magnitude = Math.abs(current);
      if (magnitude >= motion[peakKey]) { motion[peakKey] = magnitude; motion[peakAtKey] = now; }
      else if (now - motion[peakAtKey] > 550) motion[peakKey] = Math.max(magnitude, motion[peakKey] - elapsed * .035);
      if (Math.abs(target - current) > .05 || motion[peakKey] > magnitude + .05) needsFrame = true;
    });
    const pair = bars.querySelector(`[data-analyzer-band="${index}"]`);
    if (pair) {
      pair.dataset.leftDb = info.effective.leftDb.toFixed(3); pair.dataset.rightDb = info.effective.rightDb.toFixed(3); pair.dataset.deltaDb = info.delta.toFixed(3);
      pair.classList.toggle('has-feedback', analyzerDisplay.feedbackActivity && info.feedback);
      pair.classList.toggle('is-dominant', analyzerDisplay.dominantBand && info.dominant);
      pair.classList.toggle('is-oscillating', analyzerDisplay.selfOscillation && info.oscillating);
      pair.classList.toggle('has-glow', analyzerDisplay.peakGlow && Math.max(Math.abs(motion.left), Math.abs(motion.right)) > 4);
      pair.classList.toggle('hide-lr-bars', !analyzerDisplay.lrBars);
      const [leftBar, rightBar] = pair.querySelectorAll('i[data-channel]');
      // These bars are the current effective control values, not an audio
      // meter. They intentionally bypass visual decay and change on this frame.
      renderAnalyzerBar(leftBar, info.effective.leftControl);
      renderAnalyzerBar(rightBar, info.effective.rightControl);
      pair.querySelector('.analyzer-band-delta').textContent = `Δ ${toDb(info.delta)}`;
      pair.querySelector('.analyzer-peak-left').style.setProperty('--peak-level', (Math.sign(motion.left || 1) * motion.peakLeft / 2).toFixed(2));
      pair.querySelector('.analyzer-peak-right').style.setProperty('--peak-level', (Math.sign(motion.right || 1) * motion.peakRight / 2).toFixed(2));
    }
    analyzerAxisX?.children[index]?.classList.toggle('is-dominant', analyzerDisplay.dominantBand && info.dominant);
    if (filterbankWorkspace?.classList.contains('is-collapsed') && analyzerDisplay.collapsedPreview) renderCollapsedPreview(index);
  }
  if (filterbankWorkspace?.classList.contains('is-collapsed') && analyzerDisplay.collapsedPreview) renderCollapsedPreviewLine();
  refreshStatusStrip();
  renderTelemetryIndicators();
  if (needsFrame || (filterbankWorkspace?.classList.contains('is-collapsed') && analyzerDisplay.collapsedPreview)) analyzerAnimationFrame = requestAnimationFrame(animateAnalyzer);
};
const scheduleAnalyzerRender = () => { if (!analyzerAnimationFrame) analyzerAnimationFrame = requestAnimationFrame(animateAnalyzer); };
const setAnalyzerDisplayOption = (key, enabled) => {
  if (!(key in analyzerDisplay)) return;
  analyzerDisplay[key] = Boolean(enabled);
  analyzerOptionsPopover.querySelector(`[data-analyzer-option="${key}"]`).checked = analyzerDisplay[key];
  responseChart?.classList.toggle(`hide-${key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}`, !analyzerDisplay[key]);
  if (key === 'liveStatusStrip') refreshStatusStrip();
  if (key === 'hoverValues' && !analyzerDisplay[key]) hideAnalyzerDetails();
  if (key === 'frequencyLabels') analyzerFooter?.classList.toggle('hide-frequency-labels', !analyzerDisplay[key]);
  if (key === 'bandRegions') responseChart?.classList.toggle('hide-band-regions', !analyzerDisplay[key]);
  if (key === 'grid') responseChart?.classList.toggle('hide-grid', !analyzerDisplay[key]);
  if (key === 'collapsedPreview') collapsedPreview.hidden = !analyzerDisplay[key] || !filterbankWorkspace?.classList.contains('is-collapsed');
  spectrumRenderer.refresh(); scheduleAnalyzerRender();
};
window.FilterbankAnalyzer = { getDisplayState: () => ({ ...analyzerDisplay }), getDetailState: () => ({ mode: analyzerDetailMode, hoveredBand: hoveredAnalyzerBand }), setDisplayOption: setAnalyzerDisplayOption, getBandInfo: index => analyzerBandInfo(index), refresh: scheduleAnalyzerRender, getSpectrumLayers: () => spectrumRenderer.getLayers() };
const ANALYZER_ZERO_EPSILON = 1e-9;
const renderAnalyzerBar = (bar, value) => {
  const numericValue = Number(value);
  const isZero = Math.abs(numericValue) < ANALYZER_ZERO_EPSILON;
  const height = numericValue > BAND_GAIN_NEUTRAL
    ? (numericValue / BAND_GAIN_MAX) * 50
    : numericValue < BAND_GAIN_NEUTRAL
      ? (Math.abs(numericValue) / Math.abs(BAND_GAIN_MIN)) * 50
      : 0;
  bar.classList.toggle('negative', numericValue < BAND_GAIN_NEUTRAL);
  bar.classList.toggle('is-zero', isZero);
  bar.style.height = `${height}%`;
};
const updateAnalyzerBand = index => {
  const [leftBar, rightBar] = document.querySelectorAll(`[data-analyzer-band="${index}"] i`);
  const effective = getAnalyzerEffective(index);
  renderAnalyzerBar(leftBar, effective.leftControl);
  renderAnalyzerBar(rightBar, effective.rightControl);
  scheduleAnalyzerRender();
};
const getBandBoostDb = () => Number(bandBoostSelect?.value ?? 12);
const getBandCutDb = () => Number(bandCutSelect?.value ?? 12);
const formatBandSliderValue = value => {
  const gainDb = controlToBandGainDb(value, getBandBoostDb(), getBandCutDb());
  const normalizedGainDb = Math.abs(gainDb) < 1e-9 ? 0 : gainDb;
  return `${normalizedGainDb > 0 ? '+' : ''}${normalizedGainDb.toFixed(1)} dB`;
};
const renderBandSliderValues = () => faders.forEach((_, index) => renderBand(index));
const renderBand = index => {
  const slider = faders[index];
  slider.value = String(state.bandGainLeft[index]);
  const valueDisplay = document.querySelector(`[data-band-value="${index}"]`);
  if (valueDisplay) valueDisplay.textContent = formatBandSliderValue(state.bandGainLeft[index]);
  updateAnalyzerBand(index);
};
const setBandBaseGain = (channel, index, value) => {
  const channels = state.channelSelection === 'LR' ? ['left', 'right'] : [channel];
  channels.forEach(targetChannel => {
    const nextValue = setStateBandBaseGain(state, targetChannel, index, value);
    audioEngine?.setBandBaseGain(targetChannel, index, nextValue);
  });
  renderBand(index);
  refreshStatusStrip();
  const gainDb = formatBandSliderValue(state.bandGainLeft[index]);
  devLabTelemetry.logStateChange(`BAND ${index + 1} GAIN`, setBandBaseGain.last?.[index] ?? '+0.0 dB', gainDb);
  (setBandBaseGain.last ||= [])[index] = gainDb;
};
const setBandFeedback = (channel, index, enabled) => {
  const channels = state.channelSelection === 'LR' ? ['left', 'right'] : [channel];
  channels.forEach(targetChannel => {
    const target = targetChannel === 'left' ? state.feedbackBandLeft : state.feedbackBandRight;
    target[index] = Boolean(enabled);
    audioEngine?.setBandFeedback(targetChannel, index, target[index]);
  });
  devLabTelemetry.logStateChange(`BAND ${index + 1} FB`, setBandFeedback.last?.[index] ?? 'OFF', enabled ? 'ON' : 'OFF');
  (setBandFeedback.last ||= [])[index] = enabled ? 'ON' : 'OFF';
  scheduleAnalyzerRender();
  refreshStatusStrip();
};
const setFeedbackAll = (channel, enabled) => {
  const channels = state.channelSelection === 'LR' ? ['left', 'right'] : [channel];
  channels.forEach(targetChannel => {
    if (targetChannel === 'left') state.feedbackAllLeft = Boolean(enabled);
    else state.feedbackAllRight = Boolean(enabled);
    audioEngine?.setFeedbackAll(targetChannel, enabled);
  });
  devLabTelemetry.logStateChange('FB ALL', setFeedbackAll.last ?? 'OFF', enabled ? 'ON' : 'OFF'); setFeedbackAll.last = enabled ? 'ON' : 'OFF';
  scheduleAnalyzerRender();
  refreshStatusStrip();
};
faders.forEach((slider,index) => {
  slider.addEventListener('input', () => setBandBaseGain('left', index, slider.value));
  slider.addEventListener('dblclick', () => setBandBaseGain('left', index, BAND_GAIN_NEUTRAL));
  renderBand(index);
});
bars.querySelectorAll('[data-analyzer-band]').forEach(pair => {
  pair.addEventListener('pointerenter', () => showAnalyzerHover(Number(pair.dataset.analyzerBand), pair));
  pair.addEventListener('pointerleave', clearAnalyzerHover);
});
bars.addEventListener('focusin', event => {
  const pair = event.target.closest('[data-analyzer-band]');
  if (pair) showAnalyzerHover(Number(pair.dataset.analyzerBand), pair);
});
bars.addEventListener('focusout', clearAnalyzerHover);
collapsedPreview.querySelectorAll('[data-collapsed-band]').forEach(button => {
  button.addEventListener('pointerenter', () => {
    if (analyzerDisplay.collapsedPreview && filterbankWorkspace?.classList.contains('is-collapsed')) showAnalyzerHover(Number(button.dataset.collapsedBand), button, true);
  });
  button.addEventListener('pointerleave', clearAnalyzerHover);
});
analyzer?.addEventListener('pointerleave', hideAnalyzerDetails);
window.addEventListener('blur', hideAnalyzerDetails);
normalResponseButton.addEventListener('click', hideAnalyzerDetails);
devResponseButton.addEventListener('click', hideAnalyzerDetails);
document.addEventListener('input', () => { refreshStatusStrip(); scheduleAnalyzerRender(); });
document.addEventListener('change', () => { refreshStatusStrip(); scheduleAnalyzerRender(); });

document.querySelectorAll('[data-control]').forEach(slider => {
  const name = slider.dataset.control;
  const definition = GLOBAL_CONTROL_DEFINITIONS[name];
  const output = document.querySelector(`[data-output="${name}"]`);
  slider.min = String(definition.min);
  slider.max = String(definition.max);
  slider.step = String(definition.step);
  slider.value = String(state[name]);
  const update = () => { state[name] = Number(slider.value); output.textContent = formatValue(name, state[name]); };
  slider.addEventListener('input', update);
  slider.addEventListener('dblclick', () => {
    slider.value = String(definition.defaultValue);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  update();
});
document.querySelectorAll('[data-feedback-band]').forEach(button => button.addEventListener('click', () => { const index=Number(button.dataset.feedbackBand); const nextValue=!state.feedbackBandLeft[index]; setBandFeedback('left', index, nextValue); button.classList.toggle('active',nextValue); button.setAttribute('aria-pressed',String(nextValue)); }));
document.querySelectorAll('[data-mod-band]').forEach(button => button.addEventListener('click', () => { const index=Number(button.dataset.modBand); state.modulated[index]=!state.modulated[index]; button.classList.toggle('active',state.modulated[index]); button.setAttribute('aria-pressed',String(state.modulated[index])); }));
const fbAllButton = document.querySelector('.fb-all-toggle');
fbAllButton.addEventListener('click', () => { const nextValue=!state.feedbackAllLeft; setFeedbackAll('left', nextValue); fbAllButton.classList.toggle('active',nextValue); fbAllButton.textContent=nextValue?'ON':'OFF'; fbAllButton.setAttribute('aria-pressed',String(nextValue)); });

const FB_CODES = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0'];
const FADER_UP_CODES = ['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP'];
const FADER_DOWN_CODES = ['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL','Semicolon'];
const FADER_NEUTRAL_CODES = ['KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash'];
const getBandGainKeyStep = () => (BAND_GAIN_MAX - BAND_GAIN_MIN) * (keyboardPreferences.keyStepPercent / 100);
const getFaderKeyRepeatIntervalMs = () => 1000 / keyboardPreferences.keySpeedHz;
const DRIVE_UP_CODE = 'Equal';
const DRIVE_DOWN_CODE = 'Minus';
const RESONANCE_UP_CODE = 'BracketRight';
const RESONANCE_DOWN_CODE = 'BracketLeft';
const VOLUME_UP_CODE = 'Backslash';
const VOLUME_DOWN_CODE = 'Quote';
const isEditableTarget = target => target instanceof HTMLElement && ((target.matches('input, textarea, select') && !target.matches('input[type="range"]')) || target.isContentEditable);
const renderGlobalControlValue = (name, value) => {
  const definition = GLOBAL_CONTROL_DEFINITIONS[name];
  const slider = document.querySelector(`[data-control="${name}"]`);
  if (!definition || !slider) return;
  const clamped = Math.min(definition.max, Math.max(definition.min, Number(value)));
  const normalized = Number(clamped.toFixed(2));
  state[name] = normalized;
  slider.value = String(normalized);
  const output = document.querySelector(`[data-output="${name}"]`);
  if (output) output.textContent = formatValue(name, normalized);
};
const setGlobalControlValue = (name, value) => {
  const slider = document.querySelector(`[data-control="${name}"]`);
  renderGlobalControlValue(name, value);
  if (!slider) return;
  slider.dispatchEvent(new Event('input', { bubbles: true }));
};
const pressedFaderKeys = new Set();
let faderKeyboardAnimationFrame = 0;
let faderKeyboardLastStepAt = 0;
const getFaderKeyDelta = code => {
  const upIndex = FADER_UP_CODES.indexOf(code);
  if (upIndex !== -1) return { index: upIndex, delta: getBandGainKeyStep() };
  const downIndex = FADER_DOWN_CODES.indexOf(code);
  return downIndex !== -1 ? { index: downIndex, delta: -getBandGainKeyStep() } : null;
};
const applyPressedFaderKeys = () => {
  const deltas = Array.from({ length: BAND_COUNT }, () => 0);
  pressedFaderKeys.forEach(code => {
    const movement = getFaderKeyDelta(code);
    if (movement) deltas[movement.index] += movement.delta;
  });
  deltas.forEach((delta, index) => {
    if (delta) setBandBaseGain('left', index, state.bandGainLeft[index] + delta);
  });
};
const applyFaderKey = code => {
  const movement = getFaderKeyDelta(code);
  if (movement) setBandBaseGain('left', movement.index, state.bandGainLeft[movement.index] + movement.delta);
};
const animatePressedFaderKeys = now => {
  faderKeyboardAnimationFrame = 0;
  if (!pressedFaderKeys.size) return;
  if (now - faderKeyboardLastStepAt >= getFaderKeyRepeatIntervalMs()) {
    applyPressedFaderKeys();
    faderKeyboardLastStepAt = now;
  }
  faderKeyboardAnimationFrame = requestAnimationFrame(animatePressedFaderKeys);
};
const startPressedFaderKeyAnimation = () => {
  if (!faderKeyboardAnimationFrame) faderKeyboardAnimationFrame = requestAnimationFrame(animatePressedFaderKeys);
};
const clearPressedFaderKeys = () => {
  pressedFaderKeys.clear();
  faderKeyboardLastStepAt = 0;
  if (faderKeyboardAnimationFrame) cancelAnimationFrame(faderKeyboardAnimationFrame);
  faderKeyboardAnimationFrame = 0;
};
document.addEventListener('keydown', event => {
  if (isEditableTarget(event.target)) return;
  if (event.code === 'Space' || event.code === 'Enter' || event.code === 'NumpadEnter') {
    if (!event.repeat) panic();
    event.preventDefault();
    return;
  }
  if (event.code === DRIVE_UP_CODE) { setGlobalControlValue('inputGain', state.inputGain + 0.5); event.preventDefault(); return; }
  if (event.code === DRIVE_DOWN_CODE) { setGlobalControlValue('inputGain', state.inputGain - 0.5); event.preventDefault(); return; }
  if (event.code === RESONANCE_UP_CODE) { setGlobalControlValue('resonance', state.resonance + 0.02); event.preventDefault(); return; }
  if (event.code === RESONANCE_DOWN_CODE) { setGlobalControlValue('resonance', state.resonance - 0.02); event.preventDefault(); return; }
  if (event.code === VOLUME_UP_CODE) { setGlobalControlValue('volume', state.volume + 0.5); event.preventDefault(); return; }
  if (event.code === VOLUME_DOWN_CODE) { setGlobalControlValue('volume', state.volume - 0.5); event.preventDefault(); return; }
  const bandIndex = FB_CODES.indexOf(event.code);
  if (bandIndex !== -1) { if(event.shiftKey) document.querySelector(`[data-mod-band="${bandIndex}"]`).click(); else document.querySelector(`[data-feedback-band="${bandIndex}"]`).click(); event.preventDefault(); return; }
  if (getFaderKeyDelta(event.code)) {
    if (!pressedFaderKeys.has(event.code)) {
      pressedFaderKeys.add(event.code);
      applyFaderKey(event.code);
      faderKeyboardLastStepAt = performance.now();
      startPressedFaderKeyAnimation();
    }
    event.preventDefault();
    return;
  }
  const neutralIndex = FADER_NEUTRAL_CODES.indexOf(event.code);
  if (neutralIndex !== -1) { setBandBaseGain('left', neutralIndex, BAND_GAIN_NEUTRAL); event.preventDefault(); }
});
document.addEventListener('keyup', event => {
  if (pressedFaderKeys.delete(event.code) && !pressedFaderKeys.size) clearPressedFaderKeys();
});
window.addEventListener('blur', clearPressedFaderKeys);

const inputDeviceSelect = document.querySelector('[data-audio-input]');
const outputDeviceSelect = document.querySelector('[data-audio-output]');
const inputSourceButtons = [...document.querySelectorAll('[data-audio-source]')];
const audioToggleButton = document.querySelector('[data-audio-toggle]');
const panicAudioButton = document.querySelector('[data-audio-panic]');
const bypassAudioButton = document.querySelector('[data-audio-bypass]');
const audioStatus = document.querySelector('[data-audio-status]');
const audioMessage = document.querySelector('[data-audio-message]');
let hasManualInputSelection = false;
const SAMPLE_LIBRARY = Array.isArray(window.ResonantSamples) ? window.ResonantSamples : [];
const sampleById = new Map(SAMPLE_LIBRARY.map(sample => [sample.id, sample]));
let audioSourceMode = 'device';
let audioBypassEnabled = false;
let selectedSampleId = SAMPLE_LIBRARY[0]?.id || '';
let rememberedInputDeviceId = '';
let knownInputDevices = [];
const selectedSample = () => sampleById.get(selectedSampleId) || null;
const logSourceEvent = message => devLabTelemetry.logEvent?.(message);
const renderSampleOptions = () => {
  if (!inputDeviceSelect) return;
  inputDeviceSelect.replaceChildren();
  SAMPLE_LIBRARY.forEach(sample => {
    const option = document.createElement('option'); option.value = sample.id; option.textContent = sample.name; inputDeviceSelect.append(option);
  });
  if (!SAMPLE_LIBRARY.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = 'Kein integriertes Sample'; inputDeviceSelect.append(option);
  }
  inputDeviceSelect.value = selectedSampleId;
  inputDeviceSelect.setAttribute('aria-label', 'Integrierter Audio-Loop');
};
const renderSourceMode = () => {
  const isSample = audioSourceMode === 'sample';
  inputSourceButtons.forEach(button => {
    const active = button.dataset.audioSource === audioSourceMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (isSample) renderSampleOptions();
  else {
    renderDevices(inputDeviceSelect, knownInputDevices, 'Kein Input-Gerät');
    inputDeviceSelect?.setAttribute('aria-label', 'Audio-Eingabegerät');
  }
};
const switchRunningSource = async () => {
  if (audioEngine?.status !== 'ON') return;
  await audioEngine.setSource({ sourceMode: audioSourceMode, inputDeviceId: rememberedInputDeviceId || inputDeviceSelect?.value || '', sample: selectedSample() });
};
const setAudioSourceMode = async mode => {
  const nextMode = mode === 'sample' ? 'sample' : 'device';
  if (nextMode === audioSourceMode) return;
  const previousMode = audioSourceMode;
  try {
    if (nextMode === 'sample') rememberedInputDeviceId = inputDeviceSelect?.value || rememberedInputDeviceId;
    else renderDevices(inputDeviceSelect, knownInputDevices, 'Kein Input-Gerät');
    if (audioEngine?.status === 'ON') await audioEngine.setSource({ sourceMode: nextMode, inputDeviceId: rememberedInputDeviceId || inputDeviceSelect?.value || '', sample: selectedSample() });
    audioSourceMode = nextMode;
    renderSourceMode();
    logSourceEvent(`SOURCE ${previousMode.toUpperCase()} → ${nextMode.toUpperCase()}`);
    if (previousMode === 'sample') logSourceEvent('SAMPLE STOP');
    if (nextMode === 'sample' && selectedSample()) logSourceEvent(`SAMPLE START ${selectedSample().name}`);
  } catch (error) { audioMessage.textContent = audioEngine.getErrorMessage(error); }
};
inputSourceButtons.forEach(button => button.addEventListener('click', () => { setAudioSourceMode(button.dataset.audioSource); }));
const findElektronInput = devices => devices.find(device => /elektron/i.test(device.label ?? ''));
const renderDevices = (select, devices, emptyLabel) => {
  if (!select) return;
  const selectedValue = select === inputDeviceSelect ? rememberedInputDeviceId || select.value : select.value;
  select.replaceChildren();
  if (!devices.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = emptyLabel;
    select.append(option);
    return;
  }
  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Audio-Gerät ${index + 1}`;
    select.append(option);
  });
  const preferredElektronInput = select === inputDeviceSelect && !hasManualInputSelection ? findElektronInput(devices) : null;
  if (preferredElektronInput) select.value = preferredElektronInput.deviceId;
  else if ([...select.options].some(option => option.value === selectedValue)) select.value = selectedValue;
  if (select === inputDeviceSelect) rememberedInputDeviceId = select.value;
};
inputDeviceSelect?.addEventListener('change', async () => {
  if (audioSourceMode === 'device') { hasManualInputSelection = true; rememberedInputDeviceId = inputDeviceSelect.value; return; }
  selectedSampleId = inputDeviceSelect.value;
  try {
    await switchRunningSource();
    if (audioEngine?.status === 'ON' && selectedSample()) logSourceEvent(`SAMPLE START ${selectedSample().name}`);
  } catch (error) { audioMessage.textContent = audioEngine.getErrorMessage(error); }
});
renderSourceMode();
const updateAudioStatus = (status, message = '') => {
  state.audioStatus = status;
  state.audioError = message;
  audioStatus.textContent = status;
  audioMessage.textContent = message;
  audioStatus.dataset.status = status;
  if (audioToggleButton) {
    audioToggleButton.disabled = status === 'STARTING';
    audioToggleButton.textContent = status === 'ON' ? 'STOP AUDIO' : 'START AUDIO';
    audioToggleButton.classList.toggle('stop', status === 'ON');
  }
  if (status === 'ON') devLabTelemetry.startSession(audioEngine?.context);
  else if (status !== 'STARTING') devLabTelemetry.setAudioOff();
};
audioEngine = new AudioEngine({
  onStatusChange: updateAudioStatus,
  onDevicesChanged: devices => { knownInputDevices = devices.inputs; if (audioSourceMode === 'device') renderDevices(inputDeviceSelect, devices.inputs, 'Kein Input-Gerät'); renderDevices(outputDeviceSelect, devices.outputs, 'Standardausgabe'); },
  onDiagnostics: packet => { devLabTelemetry.receive(packet); scheduleAnalyzerRender(); }
});
audioEngine.applyState(state);
const setAudioBypass = enabled => {
  audioBypassEnabled = Boolean(enabled);
  audioEngine?.setBypass(audioBypassEnabled);
  bypassAudioButton?.setAttribute('aria-pressed', String(audioBypassEnabled));
};
const setPositiveResonanceAuditionGain = value => {
  const numericValue = Number(value);
  const nextValue = POSITIVE_RESONANCE_AUDITION_VALUES.includes(numericValue) ? numericValue : 0.10;
  if (positiveResonanceAuditionSelect) positiveResonanceAuditionSelect.value = nextValue.toFixed(2);
  audioEngine.setPositiveResonanceAuditionGain(nextValue);
};
setPositiveResonanceAuditionGain(positiveResonanceAuditionSelect?.value ?? 0.10);
positiveResonanceAuditionSelect?.addEventListener('change', event => setPositiveResonanceAuditionGain(event.target.value));
const POSITIVE_RESONANCE_DRIVE_VALUES = [1, 2, 4, 8, 16, 24, 32];
const setPositiveResonanceDrive = value => {
  const numericValue = Number(value);
  const nextValue = POSITIVE_RESONANCE_DRIVE_VALUES.includes(numericValue) ? numericValue : 1;
  if (positiveResonanceDriveSelect) positiveResonanceDriveSelect.value = String(nextValue);
  audioEngine.setPositiveResonanceDrive(nextValue);
};
setPositiveResonanceDrive(positiveResonanceDriveSelect?.value ?? 1);
positiveResonanceDriveSelect?.addEventListener('change', event => setPositiveResonanceDrive(event.target.value));
const POSITIVE_RESONANCE_DAMPING_FLOOR_VALUES = [0.10, 0.05, 0.02, 0.00, -0.02, -0.05, -0.10];
const setPositiveResonanceDampingFloor = value => {
  const numericValue = Number(value);
  const nextValue = POSITIVE_RESONANCE_DAMPING_FLOOR_VALUES.includes(numericValue) ? numericValue : 0.10;
  if (positiveResonanceDampingFloorSelect) positiveResonanceDampingFloorSelect.value = nextValue.toFixed(2);
  audioEngine.setPositiveResonanceDampingFloor(nextValue);
};
setPositiveResonanceDampingFloor(positiveResonanceDampingFloorSelect?.value ?? 0.10);
positiveResonanceDampingFloorSelect?.addEventListener('change', event => setPositiveResonanceDampingFloor(event.target.value));
const POSITIVE_RESONANCE_OUTPUT_VALUES = ['current-residual', 'nonlinear-base', 'full-nonlinear'];
const setPositiveResonanceOutputMode = value => {
  const nextValue = POSITIVE_RESONANCE_OUTPUT_VALUES.includes(value) ? value : 'current-residual';
  if (positiveResonanceOutputSelect) positiveResonanceOutputSelect.value = nextValue;
  audioEngine.setPositiveResonanceOutputMode(nextValue);
};
setPositiveResonanceOutputMode(positiveResonanceOutputSelect?.value ?? 'current-residual');
positiveResonanceOutputSelect?.addEventListener('change', event => setPositiveResonanceOutputMode(event.target.value));
const POSITIVE_RESONANCE_LATENCY_VALUES = ['current', 'matched'];
const setPositiveResonanceLatencyMode = value => {
  const nextValue = POSITIVE_RESONANCE_LATENCY_VALUES.includes(value) ? value : 'current';
  if (positiveResonanceLatencySelect) positiveResonanceLatencySelect.value = nextValue;
  audioEngine.setPositiveResonanceLatencyMode(nextValue);
};
setPositiveResonanceLatencyMode(positiveResonanceLatencySelect?.value ?? 'current');
positiveResonanceLatencySelect?.addEventListener('change', event => setPositiveResonanceLatencyMode(event.target.value));
const POSITIVE_RESONANCE_CURVE_VALUES = ['current', 'early', 'aggressive'];
const setPositiveResonanceCurve = value => {
  const nextValue = POSITIVE_RESONANCE_CURVE_VALUES.includes(value) ? value : 'current';
  if (positiveResonanceCurveSelect) positiveResonanceCurveSelect.value = nextValue;
  audioEngine.setPositiveResonanceCurve(nextValue);
};
setPositiveResonanceCurve(positiveResonanceCurveSelect?.value ?? 'current');
positiveResonanceCurveSelect?.addEventListener('change', event => setPositiveResonanceCurve(event.target.value));
const bindDevLabSelect = (select, apply, fallback) => {
  if (!select) return;
  let previous = select.value ?? fallback;
  apply(previous);
  select.addEventListener('change', event => { const next = event.target.value; apply(next); devLabTelemetry.logStateChange(select.previousElementSibling?.textContent || select.closest('label')?.querySelector('span')?.textContent || 'DEV PARAMETER', previous, next); previous = next; });
};
bindDevLabSelect(referenceLevelSelect, value => audioEngine.setReferenceLevel(value), '1');
bindDevLabSelect(resonanceEngineSelect, value => audioEngine.setPositiveResonanceEngine(value), 'tpt');
bindDevLabSelect(bandBoostSelect, value => { audioEngine.setBandBoostDb(value); renderBandSliderValues(); }, '12');
bindDevLabSelect(bandCutSelect, value => { audioEngine.setBandCutDb(value); renderBandSliderValues(); }, '12');
bindDevLabSelect(spreadCurveSelect, value => {
  state.spreadCurve = audioEngine.setSpreadCurve(value);
  renderBandSliderValues();
}, 'linear');
bindDevLabSelect(spreadMaxOffsetSelect, value => {
  state.spreadMaxOffsetDb = audioEngine.setSpreadMaxOffsetDb(value);
  renderBandSliderValues();
}, '6');
const updateLocalLoopTuningRelevance = () => {
  const zdf = feedbackCoreSelect?.value === 'zdf' || feedbackCoreSelect?.value === 'zdf-per-band';
  if (localLoopTuningSelect) {
    localLoopTuningSelect.disabled = zdf;
    localLoopTuningSelect.title = zdf ? 'COMPENSATED gilt nur im CURRENT-Core.' : '';
  }
  if (feedbackCoreSelect) feedbackCoreSelect.title = zdf && feedbackTopologySelect?.value === 'isolated-tpt'
    ? 'ZDF wirkt nur bei COMMON BUS oder LOCAL LOOP EXP; ISOLATED TPT bleibt unverändert.' : '';
  if (fbAllButton) {
    fbAllButton.disabled = false;
    fbAllButton.classList.remove('is-phase-one-inactive');
    fbAllButton.title = '';
    fbAllButton.textContent = state.feedbackAllLeft ? 'ON' : 'OFF';
    fbAllButton.setAttribute('aria-pressed', String(state.feedbackAllLeft));
  }
};
bindDevLabSelect(feedbackTopologySelect, value => { audioEngine.setFeedbackTopology(value); updateLocalLoopTuningRelevance(); }, 'isolated-tpt');
bindDevLabSelect(feedbackCoreSelect, value => { audioEngine.setFeedbackCore(value); updateLocalLoopTuningRelevance(); }, 'current');
bindDevLabSelect(localLoopTuningSelect, value => audioEngine.setLocalLoopTuning(value), 'current');
bindDevLabSelect(feedbackTapSelect, value => audioEngine.setFeedbackTap(value), 'pre-gain');
bindDevLabSelect(wetModelSelect, value => audioEngine.setWetModel(value), 'reference-delta');
bindDevLabSelect(commonBusSatSelect, value => audioEngine.setCommonBusSaturationMode(value), 'current');
bindDevLabSelect(commonBusDriveSelect, value => audioEngine.setCommonBusDrive(value), '1');
bindDevLabSelect(commonBusCeilingSelect, value => audioEngine.setCommonBusCeiling(value), '1');
bindDevLabSelect(feedbackAllEngineSelect, value => audioEngine.setFeedbackAllEngine(value), 'legacy');
bindDevLabSelect(feedbackAllSourceSelect, value => audioEngine.setFeedbackAllSource(value), 'post-gain-sum');
bindDevLabSelect(postGainFeedbackWeightSelect, value => audioEngine.setPostGainFeedbackWeight(value), 'current');
bindDevLabSelect(feedbackAllLevelSelect, value => audioEngine.setFeedbackAllLevel(value), 'raw');
bindDevLabSelect(feedbackAllResonanceCurveSelect, value => audioEngine.setFeedbackAllResonanceCurve(value), 'current');
bindDevLabSelect(feedbackAllSaturationReturnSelect, value => audioEngine.setFeedbackAllSaturationReturn(value), 'current');
const updateInputCharacterRelevance = () => {
  const control = inputCharacterAmountSlider?.closest('.dev-lab-character-control');
  const irrelevant = inputPreampStageSelect?.value === 'linear';
  control?.classList.toggle('is-irrelevant', irrelevant);
  inputCharacterAmountSlider?.setAttribute('aria-disabled', String(irrelevant));
};
bindDevLabSelect(inputPreampStageSelect, value => {
  const stage = audioEngine.setInputPreampStage(value);
  if (inputPreampStageSelect) inputPreampStageSelect.value = stage;
  updateInputCharacterRelevance();
}, 'linear');
const setInputCharacterAmount = value => {
  const definition = GLOBAL_CONTROL_DEFINITIONS.inputCharacterAmount;
  const numeric = Number(value);
  const amount = Number.isFinite(numeric) ? Math.max(definition.min, Math.min(definition.max, Math.round(numeric))) : definition.defaultValue;
  state.inputCharacterAmount = amount;
  if (inputCharacterAmountSlider) inputCharacterAmountSlider.value = String(amount);
  const output = document.querySelector('[data-input-character-output]');
  if (output) output.textContent = `${amount} %`;
  audioEngine.setInputCharacterAmount(amount);
};
setInputCharacterAmount(state.inputCharacterAmount);
inputCharacterAmountSlider?.addEventListener('input', event => setInputCharacterAmount(event.target.value));
const syncAudioParameters = () => {
  audioEngine.setInputGainDb(state.inputGain);
  audioEngine.setDryWet(state.dryWet);
  audioEngine.setVolumeDb(state.volume);
};
document.querySelector('[data-control="inputGain"]').addEventListener('input', syncAudioParameters);
document.querySelector('[data-control="dryWet"]').addEventListener('input', syncAudioParameters);
document.querySelector('[data-control="volume"]').addEventListener('input', syncAudioParameters);
document.querySelector('[data-control="resonance"]').addEventListener('input', () => audioEngine.setResonance(state.resonance));
document.querySelector('[data-control="spread"]').addEventListener('input', () => {
  audioEngine.setSpread(state.spread);
  renderBandSliderValues();
});
['resonance', 'dryWet', 'inputGain', 'volume', 'spread'].forEach(name => {
  const slider = document.querySelector(`[data-control="${name}"]`); let previous = state[name];
  slider?.addEventListener('input', () => { const next = state[name]; devLabTelemetry.logStateChange(name.toUpperCase(), Number(previous).toFixed(name === 'resonance' ? 2 : 1), Number(next).toFixed(name === 'resonance' ? 2 : 1)); previous = next; });
});
syncAudioParameters();
const SWEETSPOT_STORAGE_KEY = 'da-filta-sweetspots-v1';
const sweetspotDefaultName = slot => `Sweetspot ${slot}`;
const createEmptySweetspots = () => Object.fromEntries(SWEETSPOT_SLOTS.map(slot => [slot, { name: sweetspotDefaultName(slot), state: null }]));
const cloneSnapshot = value => JSON.parse(JSON.stringify(value));
const readSweetspots = () => {
  const empty = createEmptySweetspots();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SWEETSPOT_STORAGE_KEY) || 'null');
    if (!parsed || parsed.version !== 1 || !parsed.slots || typeof parsed.slots !== 'object') return empty;
    SWEETSPOT_SLOTS.forEach(slot => {
      const entry = parsed.slots[slot];
      if (!entry || typeof entry !== 'object') return;
      const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name : empty[slot].name;
      const savedState = entry.state && typeof entry.state === 'object' && !Array.isArray(entry.state) ? entry.state : null;
      empty[slot] = { name, state: savedState ? cloneSnapshot(savedState) : null };
    });
  } catch { /* Invalid or unavailable storage means empty slots. */ }
  return empty;
};
let sweetspots = readSweetspots();
const persistSweetspots = () => {
  try { window.localStorage.setItem(SWEETSPOT_STORAGE_KEY, JSON.stringify({ version: 1, slots: sweetspots })); } catch { /* Storage may be unavailable. */ }
};
const syncUiFromAudioState = snapshot => {
  if (!snapshot) return;
  state.bandGainLeft = Array.from({ length: BAND_COUNT }, (_, index) => Number(snapshot.bandGainLeft?.[index] ?? 0));
  state.bandGainRight = Array.from({ length: BAND_COUNT }, (_, index) => Number(snapshot.bandGainRight?.[index] ?? 0));
  state.feedbackBandLeft = Array.from({ length: BAND_COUNT }, (_, index) => Boolean(snapshot.feedbackBandLeft?.[index]));
  state.feedbackBandRight = Array.from({ length: BAND_COUNT }, (_, index) => Boolean(snapshot.feedbackBandRight?.[index]));
  state.feedbackAllLeft = Boolean(snapshot.feedbackAllLeft);
  state.feedbackAllRight = Boolean(snapshot.feedbackAllRight);
  if (snapshot.resonance !== undefined) renderGlobalControlValue('resonance', snapshot.resonance);
  if (snapshot.inputGainDb !== undefined) renderGlobalControlValue('inputGain', snapshot.inputGainDb);
  if (snapshot.dryWet !== undefined) renderGlobalControlValue('dryWet', snapshot.dryWet);
  if (snapshot.spread !== undefined) renderGlobalControlValue('spread', snapshot.spread);
  if (snapshot.volumeDb !== undefined) renderGlobalControlValue('volume', snapshot.volumeDb);
  if (snapshot.spreadMode !== undefined) state.spreadMode = snapshot.spreadMode;
  if (snapshot.spreadCurve !== undefined) state.spreadCurve = snapshot.spreadCurve;
  if (snapshot.spreadMaxOffsetDb !== undefined) state.spreadMaxOffsetDb = Number(snapshot.spreadMaxOffsetDb);
  faders.forEach((_, index) => renderBand(index));
  document.querySelectorAll('[data-feedback-band]').forEach(button => {
    const active = state.feedbackBandLeft[Number(button.dataset.feedbackBand)];
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  if (fbAllButton) {
    fbAllButton.classList.toggle('active', state.feedbackAllLeft);
    fbAllButton.textContent = state.feedbackAllLeft ? 'ON' : 'OFF';
    fbAllButton.setAttribute('aria-pressed', String(state.feedbackAllLeft));
  }
  const selectValues = [
    [bandBoostSelect, snapshot.maxBandBoostDb], [bandCutSelect, snapshot.maxBandCutDb],
    [spreadCurveSelect, snapshot.spreadCurve], [spreadMaxOffsetSelect, snapshot.spreadMaxOffsetDb],
    [referenceLevelSelect, snapshot.referenceLevel], [resonanceEngineSelect, snapshot.positiveResonanceEngine],
    [feedbackTopologySelect, snapshot.feedbackTopology], [feedbackCoreSelect, snapshot.feedbackCore], [localLoopTuningSelect, snapshot.localLoopTuning],
    [feedbackTapSelect, snapshot.feedbackTap], [wetModelSelect, snapshot.wetModel],
    [commonBusSatSelect, snapshot.commonBusSaturationMode], [commonBusDriveSelect, snapshot.commonBusDrive],
    [commonBusCeilingSelect, snapshot.commonBusCeiling], [feedbackAllEngineSelect, snapshot.feedbackAllEngine],
    [feedbackAllSourceSelect, snapshot.feedbackAllSource], [postGainFeedbackWeightSelect, snapshot.postGainFeedbackWeight],
    [feedbackAllLevelSelect, snapshot.feedbackAllLevel], [feedbackAllResonanceCurveSelect, snapshot.feedbackAllResonanceCurve],
    [feedbackAllSaturationReturnSelect, snapshot.feedbackAllSaturationReturn], [resonanceEngineSelect, snapshot.positiveResonanceEngine],
    [negativeResonanceModeSelect, snapshot.negativeResonanceMode], [negativeResonanceCurveSelect, snapshot.negativeResonanceCurve],
    [negativeResonanceLocalSelect, snapshot.negativeResonanceLocal === undefined ? undefined : snapshot.negativeResonanceLocal ? 'on' : 'off'],
    [negativeResonanceMainSelect, snapshot.negativeResonanceMain === undefined ? undefined : snapshot.negativeResonanceMain ? 'on' : 'off'],
    [positiveResonanceAuditionSelect, snapshot.positiveResonanceAuditionGain], [positiveResonanceDriveSelect, snapshot.positiveResonanceDrive],
    [positiveResonanceDampingFloorSelect, snapshot.positiveResonanceDampingFloor], [positiveResonanceOutputSelect, snapshot.positiveResonanceOutputMode],
    [positiveResonanceLatencySelect, snapshot.positiveResonanceLatencyMode], [positiveResonanceCurveSelect, snapshot.positiveResonanceCurve]
  ];
  const setSelectValue = (select, value) => {
    if (!select || value === undefined) return;
    const textValue = String(value);
    const exact = [...select.options].find(option => option.value === textValue);
    const numeric = exact || (Number.isFinite(Number(value)) ? [...select.options].find(option => Number(option.value) === Number(value)) : null);
    select.value = numeric?.value ?? textValue;
  };
  selectValues.forEach(([select, value]) => setSelectValue(select, value));
  if (feedbackAllAmountInput && snapshot.feedbackAllAmount !== undefined) feedbackAllAmountInput.value = String(snapshot.feedbackAllAmount);
  if (negativeResonanceAmountInput && snapshot.negativeResonanceAmount !== undefined) negativeResonanceAmountInput.value = String(snapshot.negativeResonanceAmount);
  if (negativeResonancePhaseInput && snapshot.negativeResonancePhase !== undefined) negativeResonancePhaseInput.value = String(snapshot.negativeResonancePhase);
  setSelectValue(inputPreampStageSelect, snapshot.inputPreampStage);
  if (inputCharacterAmountSlider && snapshot.inputCharacterAmount !== undefined) {
    state.inputCharacterAmount = Number(snapshot.inputCharacterAmount);
    inputCharacterAmountSlider.value = String(snapshot.inputCharacterAmount);
    const output = document.querySelector('[data-input-character-output]');
    if (output) output.textContent = `${snapshot.inputCharacterAmount} %`;
  }
  updateInputCharacterRelevance();
  updateLocalLoopTuningRelevance();
  updateNegativeResonanceRelevance();
  renderBandSliderValues();
};
// This is the complete, explicit DEV/LAB snapshot contract. Normal app state
// is intentionally absent: DEV/LAB snapshots are experimental configurations,
// not production presets.
const DEV_LAB_SNAPSHOT_PROPERTIES = Object.freeze([
  ['inputPreampStage', value => audioEngine.setInputPreampStage(value)],
  ['inputCharacterAmount', value => setInputCharacterAmount(value)],
  ['referenceLevel', value => audioEngine.setReferenceLevel(value)],
  ['maxBandBoostDb', value => audioEngine.setBandBoostDb(value)],
  ['maxBandCutDb', value => audioEngine.setBandCutDb(value)],
  ['spreadCurve', value => { state.spreadCurve = audioEngine.setSpreadCurve(value); }],
  ['spreadMaxOffsetDb', value => { state.spreadMaxOffsetDb = audioEngine.setSpreadMaxOffsetDb(value); }],
  ['positiveResonanceEngine', value => audioEngine.setPositiveResonanceEngine(value)],
  ['feedbackTopology', value => audioEngine.setFeedbackTopology(value)],
  ['feedbackCore', value => audioEngine.setFeedbackCore(value)],
  ['localLoopTuning', value => audioEngine.setLocalLoopTuning(value)],
  ['feedbackTap', value => audioEngine.setFeedbackTap(value)],
  ['wetModel', value => audioEngine.setWetModel(value)],
  ['commonBusSaturationMode', value => audioEngine.setCommonBusSaturationMode(value)],
  ['commonBusDrive', value => audioEngine.setCommonBusDrive(value)],
  ['commonBusCeiling', value => audioEngine.setCommonBusCeiling(value)],
  ['feedbackAllEngine', value => audioEngine.setFeedbackAllEngine(value)],
  ['feedbackAllSource', value => audioEngine.setFeedbackAllSource(value)],
  ['postGainFeedbackWeight', value => audioEngine.setPostGainFeedbackWeight(value)],
  ['feedbackAllLevel', value => audioEngine.setFeedbackAllLevel(value)],
  ['feedbackAllAmount', value => audioEngine.setFeedbackAllAmount(value)],
  ['feedbackAllResonanceCurve', value => audioEngine.setFeedbackAllResonanceCurve(value)],
  ['feedbackAllSaturationReturn', value => audioEngine.setFeedbackAllSaturationReturn(value)],
  ['negativeResonanceMode', value => audioEngine.setNegativeResonanceMode(value)],
  ['negativeResonanceCurve', value => audioEngine.setNegativeResonanceCurve(value)],
  ['negativeResonanceAmount', value => audioEngine.setNegativeResonanceAmount(value)],
  ['negativeResonanceLocal', value => audioEngine.setNegativeResonanceLocal(value)],
  ['negativeResonanceMain', value => audioEngine.setNegativeResonanceMain(value)],
  ['negativeResonancePhase', value => audioEngine.setNegativeResonancePhase(value)],
  ['positiveResonanceAuditionGain', value => audioEngine.setPositiveResonanceAuditionGain(value)],
  ['positiveResonanceDrive', value => audioEngine.setPositiveResonanceDrive(value)],
  ['positiveResonanceDampingFloor', value => audioEngine.setPositiveResonanceDampingFloor(value)],
  ['positiveResonanceOutputMode', value => audioEngine.setPositiveResonanceOutputMode(value)],
  ['positiveResonanceLatencyMode', value => audioEngine.setPositiveResonanceLatencyMode(value)],
  ['positiveResonanceCurve', value => audioEngine.setPositiveResonanceCurve(value)]
].map(([key, apply]) => Object.freeze({ key, apply })));
const createDevLabSnapshot = () => {
  const currentState = audioEngine?.getState?.();
  if (!currentState) return null;
  return Object.fromEntries(DEV_LAB_SNAPSHOT_PROPERTIES.map(({ key }) => [key, currentState[key]]));
};
const applyDevLabSnapshot = snapshot => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
  DEV_LAB_SNAPSHOT_PROPERTIES.forEach(({ key, apply }) => {
    if (Object.prototype.hasOwnProperty.call(snapshot, key)) apply(snapshot[key]);
  });
  syncUiFromAudioState(audioEngine.getState());
};
const renderSweetspots = () => SWEETSPOT_SLOTS.forEach(slot => {
  const entry = sweetspots[slot]; const row = sweetspotRows.get(slot); if (!row) return;
  const nameInput = row.querySelector(`[data-sweetspot-name="${slot}"]`);
  const loadButton = row.querySelector(`[data-sweetspot-load="${slot}"]`);
  const clearButton = row.querySelector(`[data-sweetspot-clear="${slot}"]`);
  nameInput.value = entry.name; loadButton.disabled = !entry.state; clearButton.disabled = !entry.state;
});
SWEETSPOT_SLOTS.forEach(slot => {
  const row = sweetspotRows.get(slot); const nameInput = row.querySelector(`[data-sweetspot-name="${slot}"]`);
  nameInput.addEventListener('input', () => { sweetspots[slot].name = nameInput.value; persistSweetspots(); });
  row.querySelector(`[data-sweetspot-save="${slot}"]`).addEventListener('click', () => {
    const snapshot = createDevLabSnapshot();
    if (!snapshot) return;
    sweetspots[slot] = { name: nameInput.value || sweetspotDefaultName(slot), state: cloneSnapshot(snapshot) };
    persistSweetspots(); renderSweetspots();
  });
  row.querySelector(`[data-sweetspot-load="${slot}"]`).addEventListener('click', () => {
    const savedState = sweetspots[slot]?.state; if (!savedState) return;
    const snapshot = cloneSnapshot(savedState);
    applyDevLabSnapshot(snapshot);
  });
  row.querySelector(`[data-sweetspot-clear="${slot}"]`).addEventListener('click', () => {
    sweetspots[slot].state = null; persistSweetspots(); renderSweetspots();
  });
});
renderSweetspots();
panic = () => {
  devLabTelemetry.logPanic();
  audioEngine?.panic();
  renderGlobalControlValue('resonance', 0);
  renderGlobalControlValue('dryWet', 0);
  renderGlobalControlValue('inputGain', 0);
  state.feedbackBandLeft.fill(false);
  state.feedbackBandRight.fill(false);
  state.feedbackAllLeft = false;
  state.feedbackAllRight = false;
  document.querySelectorAll('[data-feedback-band]').forEach(button => {
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
  });
  fbAllButton.classList.remove('active');
  fbAllButton.textContent = 'OFF';
  fbAllButton.setAttribute('aria-pressed', 'false');
};
const refreshAudioDevices = async () => {
  try {
    const devices = await audioEngine.refreshDevices();
    knownInputDevices = devices.inputs;
    if (audioSourceMode === 'device') renderDevices(inputDeviceSelect, devices.inputs, 'Kein Input-Gerät');
    renderDevices(outputDeviceSelect, devices.outputs, 'Standardausgabe');
  } catch (error) {
    audioMessage.textContent = error.message;
  }
};
audioToggleButton?.addEventListener('click', async () => {
  if (audioEngine.status === 'ON') { await audioEngine.stop(); return; }
  try {
    await audioEngine.start({ inputDeviceId: rememberedInputDeviceId || inputDeviceSelect.value, outputDeviceId: outputDeviceSelect.value, sourceMode: audioSourceMode, sample: selectedSample() });
    setAudioBypass(audioBypassEnabled);
    if (audioSourceMode === 'sample' && selectedSample()) logSourceEvent(`SAMPLE START ${selectedSample().name}`);
  } catch (error) {
    audioMessage.textContent = audioEngine.getErrorMessage(error);
  }
});
bypassAudioButton?.addEventListener('click', () => setAudioBypass(!audioBypassEnabled));
panicAudioButton?.addEventListener('click', panic);
updateAudioStatus('OFF');
refreshAudioDevices();
