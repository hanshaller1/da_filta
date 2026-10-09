// Filterbank response header: analyzer display options, view switches and the live status strip.
import { BAND_DEFINITIONS, BAND_COUNT, hooks } from './app-context.js';

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
  const zdf = packet?.left?.feedbackCoreEffective === 'zdf' || packet?.left?.feedbackCoreEffective === 'zdf-per-band' || packet?.left?.feedbackCoreEffective === 'zdf-shared-band-sat';
  const left = (zdf ? packet?.left?.baseBandEnergy : packet?.left?.bandEnergy) || [];
  const right = (zdf ? packet?.right?.baseBandEnergy : packet?.right?.bandEnergy) || [];
  const frameCount = Math.max(1, finiteAnalyzerEnergy(packet?.left?.frameCount)) + Math.max(1, finiteAnalyzerEnergy(packet?.right?.frameCount));
  const energies = Array.from({ length: BAND_COUNT }, (_, index) => finiteAnalyzerEnergy(left[index]) + finiteAnalyzerEnergy(right[index]));
  const rms = energies.map(energy => Math.sqrt(energy / frameCount));
  const peakRms = Math.max(0, ...rms);
  return { energies, rms, peakRms, isSilent: peakRms < ANALYZER_SILENCE_RMS };
};
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
let clearAnalyzerHover = () => {};
const setClearAnalyzerHover = value => (clearAnalyzerHover = value);
let hideAnalyzerDetails = () => {};
const setHideAnalyzerDetails = value => (hideAnalyzerDetails = value);
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
// This view requests worklet diagnostics only when its telemetry is needed.
const responseModeControl = document.createElement('div');
responseModeControl.className = 'response-mode-control';
responseModeControl.setAttribute('role', 'group');
responseModeControl.setAttribute('aria-label', 'Filterbank Response Ansicht');
const normalResponseButton = document.createElement('button');
const devResponseButton = document.createElement('button');
normalResponseButton.type = devResponseButton.type = 'button';
normalResponseButton.classList.add('ui-role-view'); devResponseButton.classList.add('ui-role-view');
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
  ['VISUAL', [['peakGlow', 'Peak Glow'], ['smoothDecay', 'Smooth Decay'], ['liveStatusStrip', 'Live Status Strip']]]
];
const analyzerOptions = document.createElement('div');
analyzerOptions.className = 'analyzer-options';
analyzerOptions.innerHTML = '<button type="button" class="analyzer-options-toggle" aria-expanded="false" aria-controls="analyzer-options-popover" title="Analyzer-Anzeigen konfigurieren">VIEW</button><div id="analyzer-options-popover" class="analyzer-options-popover" hidden></div>';
const analyzerOptionsToggle = analyzerOptions.querySelector('.analyzer-options-toggle');
analyzerOptionsToggle.classList.add('ui-role-utility');
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
    input.addEventListener('change', () => hooks.setAnalyzerDisplayOption(key, input.checked));
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
spectrumBarsButton.classList.add('ui-role-view'); spectrumCurveButton.classList.add('ui-role-view');
spectrumBarsButton.setAttribute('aria-label', 'Filterbank-Balken in den Vordergrund');
spectrumCurveButton.setAttribute('aria-label', 'Spectrum in den Vordergrund');
spectrumBarsButton.innerHTML = '<svg viewBox="0 0 20 16" aria-hidden="true" focusable="false"><rect x="1" y="8" width="3" height="7"/><rect x="6" y="3" width="3" height="12"/><rect x="11" y="6" width="3" height="9"/><rect x="16" y="1" width="3" height="14"/></svg>';
spectrumCurveButton.innerHTML = '<svg viewBox="0 0 20 16" aria-hidden="true" focusable="false"><path d="M1 12 C3 11,3 5,6 8 S9 13,11 5 S14 10,16 4 S18 7,19 3"/></svg>';
spectrumForegroundControl.append(spectrumBarsButton, spectrumCurveButton);
analyzerHeaderControls?.prepend(spectrumForegroundControl);

export {
  analyzerDisplay, getAnalyzerBandEnergyMetrics, analyzerHeaderControls, analyzer, analyzerFooter,
  clearAnalyzerHover, hideAnalyzerDetails, analyzerAxisX, filterbankWorkspace, responseModeControl,
  normalResponseButton, devResponseButton, responseChart, responseLegend, analyzerOptionsPopover,
  liveStatusStrip, spectrumForegroundControl, spectrumBarsButton, spectrumCurveButton, setClearAnalyzerHover,
  setHideAnalyzerDetails
};
