const {
  BAND_DEFINITIONS,
  BAND_COUNT,
  BAND_GAIN_MIN,
  BAND_GAIN_MAX,
  BAND_GAIN_NEUTRAL,
  GLOBAL_CONTROL_DEFINITIONS,
  controlToBandGainDb,
  createInitialState,
  setBandBaseGain: setStateBandBaseGain
} = window.ResonantState;
const state = createInitialState();
let audioEngine = null;
let panic = () => {};
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
const devLabControls = document.querySelector('.dev-lab-panel .dev-lab-controls');
const devLabGroups = new Map();
[['input', 'INPUT'], ['filterbank', 'FILTERBANK'], ['local-feedback', 'LOCAL FEEDBACK'], ['main', 'FB ALL / MAIN'], ['resonator', 'LEGACY / RESONATOR LAB']].forEach(([value, label]) => {
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
  if (attribute === 'data-reference-level' || attribute === 'data-band-boost-db' || attribute === 'data-band-cut-db' || attribute === 'data-wet-model') return 'filterbank';
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
if (analyzerHeader && analyzerStatus && analyzerTitle) {
  const titleStatus = document.createElement('div');
  titleStatus.className = 'analyzer-title-status';
  titleStatus.append(analyzerTitle, analyzerStatus);
  analyzerHeader.prepend(titleStatus);
}
const analyzerHeaderControls = analyzerHeader?.querySelector('.analyzer-header-controls');
const analyzerLegend = document.querySelector('.analyzer > .legend');
if (analyzerHeaderControls && analyzerLegend) analyzerHeaderControls.prepend(analyzerLegend);
const analyzer = document.querySelector('.analyzer');
const analyzerAxisX = document.querySelector('.chart-grid .axis-x');
if (analyzer && analyzerAxisX) {
  const analyzerFooter = document.createElement('div');
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
  let leftBins = null;
  let rightBins = null;
  let cssWidth = 0;
  let cssHeight = 0;
  let palette = null;
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
    const style = getComputedStyle(document.documentElement);
    palette = { left: style.getPropertyValue('--cyan').trim() || '#49d7eb', right: style.getPropertyValue('--secondary-text').trim() || '#e16c85' };
    return palette;
  };
  const ensureBins = () => {
    const nextLeft = audioEngine?.spectrumAnalyserLeft || null;
    const nextRight = audioEngine?.spectrumAnalyserRight || null;
    if (nextLeft !== leftAnalyser || nextRight !== rightAnalyser) {
      leftAnalyser = nextLeft; rightAnalyser = nextRight;
      leftBins = leftAnalyser ? new Float32Array(leftAnalyser.frequencyBinCount) : null;
      rightBins = rightAnalyser ? new Float32Array(rightAnalyser.frequencyBinCount) : null;
    }
    return leftAnalyser && rightAnalyser && leftBins && rightBins;
  };
  const drawCurve = (data, analyser, color, alpha, lineWidth) => {
    const sampleRate = analyser.context.sampleRate;
    const binWidth = sampleRate / analyser.fftSize;
    const start = Math.max(1, Math.ceil(minFrequency / binWidth));
    const end = Math.min(data.length - 1, Math.floor(maxFrequency / binWidth));
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.beginPath();
    for (let bin = start; bin <= end; bin += 1) {
      const x = frequencyToX(bin * binWidth, cssWidth);
      const y = decibelsToY(Number.isFinite(data[bin]) ? data[bin] : minDecibels, cssHeight);
      if (bin === start) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
  };
  const draw = () => {
    animationFrame = 0;
    if (!shouldRender()) return;
    if (!resize()) { schedule(); return; }
    context.clearRect(0, 0, cssWidth, cssHeight);
    if (ensureBins()) {
      leftAnalyser.getFloatFrequencyData(leftBins);
      rightAnalyser.getFloatFrequencyData(rightBins);
      const color = colors();
      const alpha = foreground === 'bars' ? .38 : .96;
      const width = foreground === 'bars' ? 1 : 1.65;
      drawCurve(leftBins, leftAnalyser, color.left, alpha, width);
      drawCurve(rightBins, rightAnalyser, color.right, alpha, width);
      context.globalAlpha = 1;
    }
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
  updateButtons(); refresh();
window.FilterbankSpectrum = { frequencyToX, decibelsToY };
  return { setVisible, refresh, setForeground };
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
    const zdf = packet?.left?.feedbackCoreEffective === 'zdf';
    const left = (zdf ? packet?.left?.baseBandEnergy : packet?.left?.bandEnergy) || [];
    const right = (zdf ? packet?.right?.baseBandEnergy : packet?.right?.bandEnergy) || [];
    let index = 0; let energy = -1; let total = 0;
    for (let band = 0; band < BAND_COUNT; band += 1) { const value = finite(left[band]) + finite(right[band]); total += value; if (value > energy) { energy = value; index = band; } }
    return { index, energy: Math.max(0, energy), dominance: total > 0 ? Math.max(0, energy) / total : 0 };
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
    const { left, right } = latest; const dominant = dominantBand(latest); const frequencies = BAND_DEFINITIONS.map(band => band.frequency);
    const items = [
      ['RES TARGET', number(left.resonanceTarget)], ['RES SMOOTHED', number(left.smoothedResonance)], ['TOPOLOGY', left.feedbackTopology], ['TAP', left.feedbackTap], ['WET', left.wetModel], ['SAT', left.commonBusSaturationMode], ['DRIVE', number(left.commonBusDrive)], ['CEILING', number(left.commonBusCeiling)],
      ['POST GAIN FB WEIGHT', left.mainPostGainFeedbackWeightMode],
      ['CORE', left.feedbackCore === 'zdf' && left.feedbackCoreEffective !== 'zdf' ? 'ZDF (INACTIVE: ISOLATED TPT)' : left.feedbackCore],
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
      ['LOCAL RET L/R', `${number(left.commonFeedbackReturn)} / ${number(right.commonFeedbackReturn)}`], ['LOCAL TAP L/R', `${number(left.commonTapSum)} / ${number(right.commonTapSum)}`], ['MAIN RET L/R', `${number(left.mainCommonFeedbackReturn)} / ${number(right.mainCommonFeedbackReturn)}`], ['MAIN TAP L/R', `${number(left.mainTapSum)} / ${number(right.mainTapSum)}`], ['MAIN SCALED L/R', `${number(left.mainTapSumScaled)} / ${number(right.mainTapSumScaled)}`], ['MAIN FB GAIN', number(left.mainFeedbackGain)], ['FB ALL SCALE', number(left.mainFeedbackLevelScale)],
      ['SOURCE PK L/R', `${number(left.sourcePeak)} / ${number(right.sourcePeak)}`], ['WET PK L/R', `${number(left.wetPeak)} / ${number(right.wetPeak)}`], ['LOCAL SAT IN/OUT L', `${number(left.commonSaturationInput)} / ${number(left.commonSaturationOutput)}`], ['LOCAL SAT IN/OUT R', `${number(right.commonSaturationInput)} / ${number(right.commonSaturationOutput)}`], ['MAIN SAT IN/OUT L', `${number(left.mainSaturationInput)} / ${number(left.mainSaturationOutput)}`], ['MAIN SAT IN/OUT R', `${number(right.mainSaturationInput)} / ${number(right.mainSaturationOutput)}`], ['MAIN RESETS L/R', `${Math.max(0, finite(left.mainCommonNonFiniteResets) - resetBaseline.left)} / ${Math.max(0, finite(right.mainCommonNonFiniteResets) - resetBaseline.right)}`]
    ];
    summary.replaceChildren(...items.map(([label, value]) => { const item = document.createElement('div'); item.innerHTML = `<span>${label}</span><b>${value ?? '—'}</b>`; return item; }));
    const metrics = telemetryMetrics(latest);
    const sourceCrestL = metrics.sourceRmsLeft > 1e-9 ? left.sourcePeak / metrics.sourceRmsLeft : 0;
    const sourceCrestR = metrics.sourceRmsRight > 1e-9 ? right.sourcePeak / metrics.sourceRmsRight : 0;
    const wetCrestL = metrics.wetRmsLeft > 1e-9 ? left.wetPeak / metrics.wetRmsLeft : 0;
    const wetCrestR = metrics.wetRmsRight > 1e-9 ? right.wetPeak / metrics.wetRmsRight : 0;
    detail.innerHTML = `<strong>${left.feedbackCoreEffective === 'zdf' ? 'DOMINANT BASE BAND' : 'DOMINANT BAND'}</strong><b>${frequencies[dominant.index]} Hz</b><span>DOMINANCE ${(dominant.dominance * 100).toFixed(0)} %</span><span>DOM STABLE ${((performance.now() - dominant.startedAt) / 1000).toFixed(1)} s</span><span>SAT ACT ${(metrics.sat * 100).toFixed(0)} % · RETURN/TAP ${metrics.feedbackRatio === null ? 'N/A' : metrics.feedbackRatio.toFixed(2)}</span><span>DC L/R ${number(metrics.dcLeft)} / ${number(metrics.dcRight)}</span><span>SRC CREST ${sourceCrestL.toFixed(2)} / ${sourceCrestR.toFixed(2)}</span><span>WET CREST ${wetCrestL.toFixed(2)} / ${wetCrestR.toFixed(2)}</span>`;
    bands.replaceChildren(...frequencies.map((frequency, index) => { const zdf = left.feedbackCoreEffective === 'zdf'; const energy = finite((zdf ? left.baseBandEnergy : left.bandEnergy)?.[index]) + finite((zdf ? right.baseBandEnergy : right.bandEnergy)?.[index]); const maxEnergy = Math.max(1e-12, dominant.energy); const row = document.createElement('div'); const gain = Math.max(controlToBandGainDb(audioEngine?.bandGainLeft?.[index] ?? 0, audioEngine?.maxBandBoostDb, audioEngine?.maxBandCutDb), controlToBandGainDb(audioEngine?.bandGainRight?.[index] ?? 0, audioEngine?.maxBandBoostDb, audioEngine?.maxBandCutDb)); row.className = index === dominant.index ? 'is-dominant' : ''; row.innerHTML = `<span>${frequency >= 1000 ? `${(frequency / 1000).toFixed(1)} kHz` : `${frequency} Hz`}</span><i><b style="width:${Math.min(100, energy / maxEnergy * 100)}%"></b></i><em>${number(Math.max(finite((zdf ? left.baseBandPeak : left.bandPeak)?.[index]), finite((zdf ? right.baseBandPeak : right.bandPeak)?.[index])))}</em><small>${left.localGates?.[index] > .5 || right.localGates?.[index] > .5 ? 'FB ON' : 'FB OFF'} · ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB</small>`; return row; }));
    renderTrace(responseLab.querySelector('[data-dev-lab-trace="common"]'), histories.common, ['left', 'right']);
    renderTrace(responseLab.querySelector('[data-dev-lab-trace="main"]'), histories.main, ['left', 'right']);
    renderTrace(responseLab.querySelector('[data-dev-lab-trace="resonance"]'), histories.resonance, ['target', 'smoothed'], 1);
  };
  const observe = packet => {
    const nextDominant = dominantBand(packet); const now = performance.now(); const metrics = telemetryMetrics(packet);
    if (dominant.index === null) { dominant.index = nextDominant.index; dominant.startedAt = now; dominant.logged.clear(); }
    else if (dominant.index !== nextDominant.index) { log(`DOMINANT BAND ${BAND_DEFINITIONS[dominant.index].frequency} Hz → ${BAND_DEFINITIONS[nextDominant.index].frequency} Hz`); dominant.index = nextDominant.index; dominant.startedAt = now; dominant.logged.clear(); }
    const stableMs = now - dominant.startedAt; sessionMax.dominantMs = Math.max(sessionMax.dominantMs, stableMs);
    [3000, 5000, 10000].forEach(threshold => { if (stableMs >= threshold && !dominant.logged.has(threshold)) { dominant.logged.add(threshold); log(`DOMINANT STABLE ${BAND_DEFINITIONS[dominant.index].frequency} Hz / ${(threshold / 1000).toFixed(1)} s`); } });
    const satPercent = metrics.sat * 100; const threshold = [90, 75, 50, 25].find(value => satPercent >= value) || 0;
    if (threshold > satThreshold) log(`SAT ACTIVITY ${threshold} % threshold crossed`);
    satThreshold = threshold || (satPercent < Math.max(0, satThreshold - 8) ? 0 : satThreshold);
    const resetCount = Math.max(finite(packet.left.mainCommonNonFiniteResets), finite(packet.right.mainCommonNonFiniteResets));
    if (resetCount > sessionMax.resets) log('WARNING NON-FINITE RESET / MAIN COMMON BUS', { warning: true });
    sessionMax.resets = Math.max(sessionMax.resets, resetCount); sessionMax.local = Math.max(sessionMax.local, Math.abs(finite(packet.left.commonFeedbackReturn)), Math.abs(finite(packet.right.commonFeedbackReturn))); sessionMax.main = Math.max(sessionMax.main, Math.abs(finite(packet.left.mainCommonFeedbackReturn)), Math.abs(finite(packet.right.mainCommonFeedbackReturn))); sessionMax.saturator = Math.max(sessionMax.saturator, Math.abs(finite(packet.left.commonSaturationInput)), Math.abs(finite(packet.right.commonSaturationInput)), Math.abs(finite(packet.left.mainSaturationInput)), Math.abs(finite(packet.right.mainSaturationInput))); sessionMax.satActivity = Math.max(sessionMax.satActivity, metrics.sat);
    const baseEnergy = packet.left.feedbackCoreEffective === 'zdf';
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
  const setMode = mode => { responseMode = mode; const dev = mode === 'dev-lab'; filterbankWorkspace?.classList.toggle('is-dev-lab', dev); responseLab.hidden = !dev; responseChart.hidden = dev; if (responseLegend) responseLegend.hidden = dev; spectrumForegroundControl.hidden = dev; spectrumRenderer.setVisible(!dev); normalResponseButton.classList.toggle('active', !dev); devResponseButton.classList.toggle('active', dev); normalResponseButton.setAttribute('aria-pressed', String(!dev)); devResponseButton.setAttribute('aria-pressed', String(dev)); render(); };
  normalResponseButton.addEventListener('click', () => setMode('normal')); devResponseButton.addEventListener('click', () => setMode('dev-lab'));
  freezeButton.addEventListener('click', () => { frozen = !frozen; freezeButton.textContent = frozen ? 'LIVE' : 'FREEZE'; freezeButton.setAttribute('aria-pressed', String(frozen)); });
  resetButton.addEventListener('click', () => { reset(); resetSessionMax(); log('RESET METRICS'); });
  const setConsoleOpen = open => { if (open) debugConsoleGeometry.ensure(); debugConsole.hidden = !open; consoleToggle.setAttribute('aria-expanded', String(open)); consoleToggle.classList.toggle('active', open); if (open) renderLog(); };
  consoleToggle.addEventListener('click', () => setConsoleOpen(debugConsole.hidden));
  debugConsole.querySelector('[data-debug-console-close]').addEventListener('click', () => { setConsoleOpen(false); consoleToggle.focus(); });
  responseLab.querySelector('[data-debug-mark]').addEventListener('click', () => { markerNumber += 1; log(`USER MARK #${markerNumber}`); });
  responseLab.querySelector('[data-debug-snapshot]').addEventListener('click', () => {
    if (!latest) { log('SNAPSHOT unavailable — NO AUDIO'); return; }
    snapshotNumber += 1; const d = dominantBand(latest); const m = telemetryMetrics(latest); const state = audioEngine || {}; const gains = state.bandGainLeft?.map(value => `${controlToBandGainDb(value, state.maxBandBoostDb, state.maxBandCutDb) >= 0 ? '+' : ''}${controlToBandGainDb(value, state.maxBandBoostDb, state.maxBandCutDb).toFixed(1)}`).join(',') || '—'; const fb = (state.feedbackBandLeft || []).map((on, index) => on ? index + 1 : null).filter(Boolean).join(',') || 'none';
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
  return { receive, reset, render, startSession, logEvent: log, eventCount: () => events.length, logStateChange: (label, before, after) => { if (before !== after) log(`${label} ${before} → ${after}`, { key: label, throttle: 350 }); }, logPanic: () => log('PANIC'), setAudioOff: () => { log('AUDIO STOP'); if (!frozen) { latest = null; audioLabel.textContent = 'NO AUDIO'; render(); } } };
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
    'data-feedback-all-saturation-return': 'main'
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
const referenceLevelSelect = addDevLabSelector('DEV REFERENCE', 'data-reference-level', [['1', '100 %'], ['0.75', '75 %'], ['0.5', '50 %'], ['0.25', '25 %'], ['0', '0 % / BANDS ONLY']]);
const resonanceEngineSelect = addDevLabSelector('DEV RES ENGINE', 'data-positive-resonance-engine', [['tpt', 'TPT'], ['phase2', 'PHASE 2']]);
const bandBoostSelect = addDevLabSelector('DEV BAND BOOST', 'data-band-boost-db', [['12', '+12 dB'], ['18', '+18 dB'], ['24', '+24 dB']]);
const bandCutSelect = addDevLabSelector('DEV BAND CUT', 'data-band-cut-db', [['12', '-12 dB'], ['24', '-24 dB'], ['36', '-36 dB'], ['48', '-48 dB'], ['60', '-60 dB']]);
const feedbackTopologySelect = addDevLabSelector('DEV FB TOPOLOGY', 'data-feedback-topology', [['isolated-tpt', 'ISOLATED TPT'], ['common-bus', 'COMMON BUS'], ['local-loop-exp', 'LOCAL LOOP EXP']]);
const feedbackCoreSelect = addDevLabSelector('FEEDBACK CORE', 'data-feedback-core', [['current', 'CURRENT'], ['zdf', 'ZDF']]);
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
const feedbackAllResonanceCurveSelect = addDevLabSelector('DEV RESONANCE CURVE', 'data-feedback-all-resonance-curve', [['current', 'CURRENT'], ['soft-knee', 'SOFT KNEE']]);
const feedbackAllSaturationReturnSelect = addDevLabSelector('DEV MAIN SAT/RETURN', 'data-feedback-all-saturation-return', [['current', 'CURRENT'], ['drive-4-return-0.2', 'DRIVE 4 / RETURN 0.2']]);
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
  'data-positive-resonance-engine': {
    title: 'DEV RES ENGINE', what: 'Wählt die Engine des positiven lokalen Resonators.',
    scope: 'Nur positive lokale Resonance außerhalb des COMMON-BUS-Modus; negative Resonance und FB ALL bleiben im Legacy-Pfad.',
    values: [['TPT', 'Nichtlinearer positiver TPT-Resonatorpfad mit dem aktuellen Residual-/Audition-Modell.'], ['PHASE 2', 'Ältere positive Phase-2-Resonator-/Prototyplösung.']],
    default: 'TPT', note: 'Experimenteller Engine-Vergleich; im aktuellen COMMON-BUS-Core wirkungslos.'
  }
};

const DEV_LAB_GROUP_HELP = {
  input: ['data-input-preamp-stage', 'data-input-character-amount'],
  filterbank: ['data-reference-level', 'data-band-boost-db', 'data-band-cut-db', 'data-wet-model'],
  'local-feedback': ['data-feedback-topology', 'data-local-loop-tuning', 'data-feedback-tap', 'data-common-bus-saturation-mode', 'data-common-bus-drive', 'data-common-bus-ceiling'],
  main: ['data-feedback-all-engine', 'data-feedback-all-source', 'data-post-gain-feedback-weight', 'data-feedback-all-level', 'data-feedback-all-resonance-curve', 'data-feedback-all-saturation-return'],
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
const THEME_VALUES = ['current', 'clean-modern', 'dark-studio', 'analog-inspired', 'minimal-dark', 'pro-console'];
const themeSelect = document.querySelector('[data-theme-select]');
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
  const theme = THEME_VALUES.includes(value) ? value : 'current';
  document.body.dataset.theme = theme;
  if (themeSelect) themeSelect.value = theme;
  try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Storage may be unavailable. */ }
};
applyTheme(readStoredTheme());
themeSelect?.addEventListener('change', event => applyTheme(event.target.value));
const bands = document.querySelector('.bands');
bands.innerHTML = BAND_DEFINITIONS.map((band,index) => `<article class="band-card"><div class="band-actions"><button class="band-action" type="button" data-feedback-band="${index}">FB</button><button class="band-action" type="button" data-mod-band="${index}">MOD</button></div><output class="band-slider-value" data-band-value="${index}">0.0 dB</output><div class="fader-wrap"><span class="fader-label positive">+</span><div class="fader-track"><div class="fader-hit-area"><input class="band-fader" type="range" min="${BAND_GAIN_MIN}" max="${BAND_GAIN_MAX}" value="${BAND_GAIN_NEUTRAL}" data-band="${index}" aria-label="${band.label} Fader"></div></div><span class="fader-label negative">−</span></div><div class="band-value">${band.label}</div></article>`).join('');
const formatValue = (name,value) => { if(name==='dryWet') return `${Math.round(value)} %`; if(name==='inputGain'||name==='volume') return `${Number(value).toFixed(1)} dB`; return Number(value).toFixed(2).replace(/\.?0+$/,''); };

const bars = document.querySelector('.bars');
bars.innerHTML = Array.from({length:BAND_COUNT},(_,i)=>`<div class="bar-pair" data-analyzer-band="${i}"><i></i><i></i></div>`).join('');
const faders = [...document.querySelectorAll('.band-fader')];
const renderAnalyzerBar = (bar, value) => {
  const numericValue = Number(value);
  const height = numericValue > BAND_GAIN_NEUTRAL
    ? (numericValue / BAND_GAIN_MAX) * 50
    : numericValue < BAND_GAIN_NEUTRAL
      ? (Math.abs(numericValue) / Math.abs(BAND_GAIN_MIN)) * 50
      : 0;
  bar.classList.toggle('negative', numericValue < BAND_GAIN_NEUTRAL);
  bar.style.height = `${height}%`;
};
const updateAnalyzerBand = index => {
  const [leftBar, rightBar] = document.querySelectorAll(`[data-analyzer-band="${index}"] i`);
  renderAnalyzerBar(leftBar, state.bandGainLeft[index]);
  renderAnalyzerBar(rightBar, state.bandGainRight[index]);
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
};
const setFeedbackAll = (channel, enabled) => {
  const channels = state.channelSelection === 'LR' ? ['left', 'right'] : [channel];
  channels.forEach(targetChannel => {
    if (targetChannel === 'left') state.feedbackAllLeft = Boolean(enabled);
    else state.feedbackAllRight = Boolean(enabled);
    audioEngine?.setFeedbackAll(targetChannel, enabled);
  });
  devLabTelemetry.logStateChange('FB ALL', setFeedbackAll.last ?? 'OFF', enabled ? 'ON' : 'OFF'); setFeedbackAll.last = enabled ? 'ON' : 'OFF';
};
faders.forEach((slider,index) => {
  slider.addEventListener('input', () => setBandBaseGain('left', index, slider.value));
  slider.addEventListener('dblclick', () => setBandBaseGain('left', index, BAND_GAIN_NEUTRAL));
  renderBand(index);
});

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
const BAND_GAIN_STEP = (BAND_GAIN_MAX - BAND_GAIN_MIN) * 0.05;
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
  const upIndex = FADER_UP_CODES.indexOf(event.code);
  if (upIndex !== -1) { setBandBaseGain('left', upIndex, state.bandGainLeft[upIndex] + BAND_GAIN_STEP); event.preventDefault(); return; }
  const downIndex = FADER_DOWN_CODES.indexOf(event.code);
  if (downIndex !== -1) { setBandBaseGain('left', downIndex, state.bandGainLeft[downIndex] - BAND_GAIN_STEP); event.preventDefault(); return; }
  const neutralIndex = FADER_NEUTRAL_CODES.indexOf(event.code);
  if (neutralIndex !== -1) { setBandBaseGain('left', neutralIndex, BAND_GAIN_NEUTRAL); event.preventDefault(); }
});

const inputDeviceSelect = document.querySelector('[data-audio-input]');
const outputDeviceSelect = document.querySelector('[data-audio-output]');
const inputSourceButtons = [...document.querySelectorAll('[data-audio-source]')];
const startAudioButton = document.querySelector('[data-audio-start]');
const stopAudioButton = document.querySelector('[data-audio-stop]');
const panicAudioButton = document.querySelector('[data-audio-panic]');
const audioStatus = document.querySelector('[data-audio-status]');
const audioMessage = document.querySelector('[data-audio-message]');
let hasManualInputSelection = false;
const SAMPLE_LIBRARY = Array.isArray(window.ResonantSamples) ? window.ResonantSamples : [];
const sampleById = new Map(SAMPLE_LIBRARY.map(sample => [sample.id, sample]));
let audioSourceMode = 'device';
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
  startAudioButton.disabled = status === 'STARTING' || status === 'ON';
  stopAudioButton.disabled = status !== 'ON';
  if (status === 'ON') devLabTelemetry.startSession(audioEngine?.context);
  else if (status !== 'STARTING') devLabTelemetry.setAudioOff();
};
audioEngine = new AudioEngine({
  onStatusChange: updateAudioStatus,
  onDevicesChanged: devices => { knownInputDevices = devices.inputs; if (audioSourceMode === 'device') renderDevices(inputDeviceSelect, devices.inputs, 'Kein Input-Gerät'); renderDevices(outputDeviceSelect, devices.outputs, 'Standardausgabe'); },
  onDiagnostics: packet => devLabTelemetry.receive(packet)
});
audioEngine.applyState(state);
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
const updateLocalLoopTuningRelevance = () => {
  const zdf = feedbackCoreSelect?.value === 'zdf';
  if (localLoopTuningSelect) {
    localLoopTuningSelect.disabled = zdf;
    localLoopTuningSelect.title = zdf ? 'COMPENSATED gilt nur im CURRENT-Core.' : '';
  }
  if (feedbackCoreSelect) feedbackCoreSelect.title = zdf && feedbackTopologySelect?.value === 'isolated-tpt'
    ? 'ZDF wirkt nur bei COMMON BUS oder LOCAL LOOP EXP; ISOLATED TPT bleibt unverändert.' : '';
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
['resonance', 'dryWet', 'inputGain', 'volume'].forEach(name => {
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
  if (snapshot.volumeDb !== undefined) renderGlobalControlValue('volume', snapshot.volumeDb);
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
    [referenceLevelSelect, snapshot.referenceLevel], [resonanceEngineSelect, snapshot.positiveResonanceEngine],
    [feedbackTopologySelect, snapshot.feedbackTopology], [feedbackCoreSelect, snapshot.feedbackCore], [localLoopTuningSelect, snapshot.localLoopTuning],
    [feedbackTapSelect, snapshot.feedbackTap], [wetModelSelect, snapshot.wetModel],
    [commonBusSatSelect, snapshot.commonBusSaturationMode], [commonBusDriveSelect, snapshot.commonBusDrive],
    [commonBusCeilingSelect, snapshot.commonBusCeiling], [feedbackAllEngineSelect, snapshot.feedbackAllEngine],
    [feedbackAllSourceSelect, snapshot.feedbackAllSource], [postGainFeedbackWeightSelect, snapshot.postGainFeedbackWeight],
    [feedbackAllLevelSelect, snapshot.feedbackAllLevel], [feedbackAllResonanceCurveSelect, snapshot.feedbackAllResonanceCurve],
    [feedbackAllSaturationReturnSelect, snapshot.feedbackAllSaturationReturn], [resonanceEngineSelect, snapshot.positiveResonanceEngine],
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
  setSelectValue(inputPreampStageSelect, snapshot.inputPreampStage);
  if (inputCharacterAmountSlider && snapshot.inputCharacterAmount !== undefined) {
    state.inputCharacterAmount = Number(snapshot.inputCharacterAmount);
    inputCharacterAmountSlider.value = String(snapshot.inputCharacterAmount);
    const output = document.querySelector('[data-input-character-output]');
    if (output) output.textContent = `${snapshot.inputCharacterAmount} %`;
  }
  updateInputCharacterRelevance();
  updateLocalLoopTuningRelevance();
  renderBandSliderValues();
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
    const currentState = audioEngine?.getState?.();
    if (!currentState) return;
    sweetspots[slot] = { name: nameInput.value || sweetspotDefaultName(slot), state: cloneSnapshot(currentState) };
    persistSweetspots(); renderSweetspots();
  });
  row.querySelector(`[data-sweetspot-load="${slot}"]`).addEventListener('click', () => {
    const savedState = sweetspots[slot]?.state; if (!savedState) return;
    const snapshot = cloneSnapshot(savedState);
    audioEngine.applyState(snapshot);
    syncUiFromAudioState(audioEngine.getState());
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
startAudioButton.addEventListener('click', async () => {
  try {
    await audioEngine.start({ inputDeviceId: rememberedInputDeviceId || inputDeviceSelect.value, outputDeviceId: outputDeviceSelect.value, sourceMode: audioSourceMode, sample: selectedSample() });
    if (audioSourceMode === 'sample' && selectedSample()) logSourceEvent(`SAMPLE START ${selectedSample().name}`);
  } catch (error) {
    audioMessage.textContent = audioEngine.getErrorMessage(error);
  }
});
stopAudioButton.addEventListener('click', () => audioEngine.stop());
panicAudioButton?.addEventListener('click', panic);
updateAudioStatus('OFF');
refreshAudioDevices();
