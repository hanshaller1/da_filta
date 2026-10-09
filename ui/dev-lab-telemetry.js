// DEV / LAB response view and debug console: DSP telemetry history, event log and resonator diagnostics.
import {
  BAND_DEFINITIONS, state, audioEngine, updateResonatorDiagnostics, setUpdateResonatorDiagnostics
} from './app-context.js';
import {
  analyzerDisplay, getAnalyzerBandEnergyMetrics, analyzerHeaderControls, hideAnalyzerDetails,
  filterbankWorkspace, responseModeControl, normalResponseButton, devResponseButton, responseChart,
  responseLegend, spectrumForegroundControl
} from './analyzer-header.js';

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
  let latestOutputGuard = null;
  let latestOutputProtection = null;
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
  const renderSessionMax = () => {
    if (responseMode !== 'dev-lab' || debugConsole.hidden) return;
    debugMax.textContent = `SESSION MAX  LOCAL ${number(sessionMax.local)}  MAIN ${number(sessionMax.main)}  SAT IN ${number(sessionMax.saturator)}  SAT ACT ${(sessionMax.satActivity * 100).toFixed(0)} %  BAND ${BAND_DEFINITIONS[sessionMax.bandIndex]?.frequency ?? '—'} Hz  DOM ${(sessionMax.dominantMs / 1000).toFixed(1)} s  RESETS ${sessionMax.resets}`;
  };
  const renderLog = () => {
    if (responseMode !== 'dev-lab' || debugConsole.hidden) return;
    const pinned = debugLog.scrollHeight - debugLog.scrollTop - debugLog.clientHeight < 4;
    debugLog.replaceChildren(...events.map(event => { const row = document.createElement('div'); row.className = `response-debug-event ${event.warning ? 'is-warning' : ''}`; row.innerHTML = `<time>${event.time}</time><span>${event.text}</span>`; return row; }));
    if (pinned) debugLog.scrollTop = debugLog.scrollHeight;
    renderSessionMax();
  };
  const appendLogRow = event => {
    if (responseMode !== 'dev-lab' || debugConsole.hidden) return;
    const pinned = debugLog.scrollHeight - debugLog.scrollTop - debugLog.clientHeight < 4;
    const row = document.createElement('div'); row.className = `response-debug-event ${event.warning ? 'is-warning' : ''}`; row.innerHTML = `<time>${event.time}</time><span>${event.text}</span>`;
    debugLog.append(row);
    while (debugLog.children.length > maxEvents) debugLog.firstElementChild?.remove();
    if (pinned) debugLog.scrollTop = debugLog.scrollHeight;
    renderSessionMax();
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
    sessionStartedAt = performance.now(); markerNumber = 0; snapshotNumber = 0; events.length = 0; snapshots.length = 0; lastEventAt.clear(); if (!debugConsole.hidden) debugLog.replaceChildren(); resetSessionMax(); latest = null; latestOutputGuard = null; latestOutputProtection = null; resetBaseline = null;
    const state = audioEngine || {}; log(`AUDIO START · SR ${Math.round(context?.sampleRate || 0)} Hz · ${context?.state || 'running'} · TOPOLOGY ${state.feedbackTopology || '—'} · TAP ${state.feedbackTap || '—'} · WET ${state.wetModel || '—'} · SAT ${state.commonBusSaturationMode || '—'}`, { force: true });
  };
  const ratio = (returnValue, tap) => Math.abs(finite(tap)) < 1e-6 ? null : Math.min(999, Math.abs(finite(returnValue)) / Math.abs(finite(tap)));
  const localReturnValue = (channel, peak = false) => channel.feedbackCoreEffective === 'zdf-per-band'
    ? Math.max(0, ...(channel[peak ? 'zdfPerBandLocalReturnPeak' : 'zdfPerBandLocalReturn'] || []).map(value => Math.abs(finite(value))))
    : finite(channel.commonFeedbackReturn);
  const localFeedbackRatio = channel => {
    if (channel.feedbackCoreEffective !== 'zdf-per-band') return ratio(channel.commonFeedbackReturn, channel.commonTapSum);
    const ratios = (channel.zdfPerBandLocalReturn || []).map((value, band) => ratio(value, channel.zdfPerBandLocalBus?.[band])).filter(value => value !== null);
    return ratios.length ? Math.max(...ratios) : null;
  };
  const telemetryMetrics = packet => {
    const left = packet.left; const right = packet.right; const countL = Math.max(1, finite(left.frameCount)); const countR = Math.max(1, finite(right.frameCount));
    const sat = Math.max(finite(left.saturationActiveFrames) / countL, finite(right.saturationActiveFrames) / countR);
    const feedbackRatioLeft = localFeedbackRatio(left);
    const feedbackRatioRight = localFeedbackRatio(right);
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
    latest = null; latestOutputGuard = null; latestOutputProtection = null; audioEngine?.resetOutputGuardTelemetry(); audioEngine?.resetOutputProtectionTelemetry(); render();
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
    if (responseMode !== 'dev-lab') return;
    if (!latest) { summary.textContent = 'NO AUDIO — keine Telemetrie verfügbar'; bands.replaceChildren(); detail.textContent = ''; return; }
    const { left, right } = latest; const dominant = dominantBand(latest); const energyMetrics = getAnalyzerBandEnergyMetrics(latest); const frequencies = BAND_DEFINITIONS.map(band => band.frequency);
    const items = [
      ['RES TARGET', number(left.resonanceTarget)], ['RES SMOOTHED', number(left.smoothedResonance)], ['TOPOLOGY', left.feedbackTopology], ['TAP', left.feedbackTap], ['WET', left.wetModel], ['SAT', left.commonBusSaturationMode], ['DRIVE', number(left.commonBusDrive)], ['CEILING', number(left.commonBusCeiling)],
      ['POST GAIN FB WEIGHT', left.mainPostGainFeedbackWeightMode], ['FB ALL AMOUNT', `${number(left.feedbackAllAmount)} %`],
      ['CORE', left.feedbackCore !== 'current' && left.feedbackCoreEffective !== left.feedbackCore ? 'ZDF (INACTIVE: ISOLATED TPT)' : left.feedbackCore],
      ...(left.feedbackCoreEffective === 'zdf' || left.feedbackCoreEffective === 'zdf-shared-band-sat' ? [
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
        ...(left.zdfPerBandLocalReturn || []).flatMap((value, band) => [
          [`LOCAL ${band + 1} RET L/R`, `${number(value)} / ${number(right.zdfPerBandLocalReturn?.[band])}`],
          [`LOCAL ${band + 1} BUS L/R`, `${number(left.zdfPerBandLocalBus?.[band])} / ${number(right.zdfPerBandLocalBus?.[band])}`]
        ]),
        ['PER-BAND MAIN BUS L/R', `${number(left.zdfPerBandMainBus)} / ${number(right.zdfPerBandMainBus)}`],
        ['PER-BAND MAIN RET L/R', `${number(left.zdfPerBandMainReturn)} / ${number(right.zdfPerBandMainReturn)}`],
        ['PER-BAND SOLVER AVG L/R', `${number(finite(left.zdfPerBandCoupledSolverIterations) / Math.max(1, finite(left.frameCount)))} / ${number(finite(right.zdfPerBandCoupledSolverIterations) / Math.max(1, finite(right.frameCount)))}`],
        ['PER-BAND SOLVER MAX L/R', `${left.zdfPerBandCoupledSolverMaxIterations} / ${right.zdfPerBandCoupledSolverMaxIterations}`],
        ['PER-BAND RESIDUAL L/R', `${number(left.zdfPerBandCoupledSolverLastResidual)} / ${number(right.zdfPerBandCoupledSolverLastResidual)}`],
        ['PER-BAND FALLBACKS L/R', `${left.zdfPerBandCoupledFallbackCount} / ${right.zdfPerBandCoupledFallbackCount}`],
        ['PER-BAND NONFINITE L/R', `${left.zdfPerBandCoupledNonFiniteResetCount} / ${right.zdfPerBandCoupledNonFiniteResetCount}`]
      ] : []),
      ...(left.feedbackCoreEffective === 'zdf-per-band' ? [] : [
        ['COMMON LOCAL RET L/R', `${number(left.commonFeedbackReturn)} / ${number(right.commonFeedbackReturn)}`],
        ['COMMON LOCAL TAP L/R', `${number(left.commonTapSum)} / ${number(right.commonTapSum)}`]
      ]),
      ['MAIN RET L/R', `${number(left.mainCommonFeedbackReturn)} / ${number(right.mainCommonFeedbackReturn)}`], ['MAIN TAP L/R', `${number(left.mainTapSum)} / ${number(right.mainTapSum)}`], ['MAIN SCALED L/R', `${number(left.mainTapSumScaled)} / ${number(right.mainTapSumScaled)}`], ['MAIN FB GAIN', number(left.mainFeedbackGain)], ['FB ALL SCALE', number(left.mainFeedbackLevelScale)],
      ['SOURCE PK L/R', `${number(left.sourcePeak)} / ${number(right.sourcePeak)}`], ['WET PK L/R', `${number(left.wetPeak)} / ${number(right.wetPeak)}`],
      ...(left.feedbackCoreEffective === 'zdf-per-band' ? [] : [
        ['LOCAL SAT IN/OUT L', `${number(left.commonSaturationInput)} / ${number(left.commonSaturationOutput)}`],
        ['LOCAL SAT IN/OUT R', `${number(right.commonSaturationInput)} / ${number(right.commonSaturationOutput)}`]
      ]),
      ['MAIN SAT IN/OUT L', `${number(left.mainSaturationInput)} / ${number(left.mainSaturationOutput)}`], ['MAIN SAT IN/OUT R', `${number(right.mainSaturationInput)} / ${number(right.mainSaturationOutput)}`], ['MAIN RESETS L/R', `${Math.max(0, finite(left.mainCommonNonFiniteResets) - resetBaseline.left)} / ${Math.max(0, finite(right.mainCommonNonFiniteResets) - resetBaseline.right)}`]
    ];
    const guard = latestOutputGuard;
    const output = latestOutputProtection;
    items.push(
      ['MASTER PK L/R', guard ? `${number(guard.inPeakLeft)} / ${number(guard.inPeakRight)}` : '—'],
      ['GUARD OUT PK L/R', guard ? `${number(guard.outPeakLeft)} / ${number(guard.outPeakRight)}` : '—'],
      ['GUARD GR', guard ? `${number(guard.gainReductionDb)} dB` : '—'],
      ['GUARD ACT', guard ? `${finite(guard.activePercent).toFixed(1)} %` : '—'],
      ['FINAL PK L/R', output ? `${number(output.postPeakLeft)} / ${number(output.postPeakRight)}` : '—'],
      ['SAFETY GR', output ? `${number(output.gainReductionDb)} dB` : '—'],
      ['SAFETY ACT', output ? `${finite(output.activePercent).toFixed(1)} %` : '—']
    );
    summary.replaceChildren(...items.map(([label, value]) => { const item = document.createElement('div'); item.innerHTML = `<span>${label}</span><b>${value ?? '—'}</b>`; return item; }));
    const metrics = telemetryMetrics(latest);
    const sourceCrestL = metrics.sourceRmsLeft > 1e-9 ? left.sourcePeak / metrics.sourceRmsLeft : 0;
    const sourceCrestR = metrics.sourceRmsRight > 1e-9 ? right.sourcePeak / metrics.sourceRmsRight : 0;
    const wetCrestL = metrics.wetRmsLeft > 1e-9 ? left.wetPeak / metrics.wetRmsLeft : 0;
    const wetCrestR = metrics.wetRmsRight > 1e-9 ? right.wetPeak / metrics.wetRmsRight : 0;
    detail.innerHTML = `<strong>${left.feedbackCoreEffective === 'zdf' || left.feedbackCoreEffective === 'zdf-per-band' || left.feedbackCoreEffective === 'zdf-shared-band-sat' ? 'DOMINANT BASE BAND' : 'DOMINANT BAND'}</strong><b>${frequencies[dominant.index]} Hz</b><span>DOMINANCE ${(dominant.dominance * 100).toFixed(0)} %</span><span>DOM STABLE ${((performance.now() - dominant.startedAt) / 1000).toFixed(1)} s</span><span>SAT ACT ${(metrics.sat * 100).toFixed(0)} % · RETURN/TAP ${metrics.feedbackRatio === null ? 'N/A' : metrics.feedbackRatio.toFixed(2)}</span><span>DC L/R ${number(metrics.dcLeft)} / ${number(metrics.dcRight)}</span><span>SRC CREST ${sourceCrestL.toFixed(2)} / ${sourceCrestR.toFixed(2)}</span><span>WET CREST ${wetCrestL.toFixed(2)} / ${wetCrestR.toFixed(2)}</span>`;
    if (dominant.isSilent || !Number.isFinite(dominant.startedAt) || dominant.startedAt <= 0 || performance.now() < dominant.startedAt) {
      detail.querySelector('b').textContent = 'N/A';
      detail.querySelectorAll('span')[1].textContent = 'DOM STABLE N/A';
    }
    bands.replaceChildren(...frequencies.map((frequency, index) => { const zdf = left.feedbackCoreEffective === 'zdf' || left.feedbackCoreEffective === 'zdf-per-band' || left.feedbackCoreEffective === 'zdf-shared-band-sat'; const energy = finite((zdf ? left.baseBandEnergy : left.bandEnergy)?.[index]) + finite((zdf ? right.baseBandEnergy : right.bandEnergy)?.[index]); const maxEnergy = Math.max(1e-12, dominant.energy); const row = document.createElement('div'); const gain = Math.max(audioEngine?.effectiveBandGainDbLeft?.[index] ?? 0, audioEngine?.effectiveBandGainDbRight?.[index] ?? 0); row.className = index === dominant.index ? 'is-dominant' : ''; row.innerHTML = `<span>${frequency >= 1000 ? `${(frequency / 1000).toFixed(1)} kHz` : `${frequency} Hz`}</span><i><b style="width:${Math.min(100, energy / maxEnergy * 100)}%"></b></i><em>${number(Math.max(finite((zdf ? left.baseBandPeak : left.bandPeak)?.[index]), finite((zdf ? right.baseBandPeak : right.bandPeak)?.[index])))}</em><small>${left.localGates?.[index] > .5 || right.localGates?.[index] > .5 ? 'FB ON' : 'FB OFF'} · ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB</small>`; return row; }));
    if (energyMetrics.isSilent) bands.querySelectorAll('i b').forEach(bar => { bar.style.width = '0%'; });
    const localTrace = responseLab.querySelector('[data-dev-lab-trace="common"]');
    localTrace.previousElementSibling.innerHTML = `${left.feedbackCoreEffective === 'zdf-per-band' ? 'LOCAL RETURN MAX ABS' : 'COMMON RETURN'} <i>L</i> <i>R</i>`;
    renderTrace(localTrace, histories.common, ['left', 'right']);
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
    sessionMax.resets = Math.max(sessionMax.resets, resetCount); sessionMax.local = Math.max(sessionMax.local, Math.abs(localReturnValue(packet.left, true)), Math.abs(localReturnValue(packet.right, true))); sessionMax.main = Math.max(sessionMax.main, Math.abs(finite(packet.left.mainCommonFeedbackReturn)), Math.abs(finite(packet.right.mainCommonFeedbackReturn))); sessionMax.saturator = Math.max(sessionMax.saturator, Math.abs(finite(packet.left.commonSaturationInput)), Math.abs(finite(packet.right.commonSaturationInput)), Math.abs(finite(packet.left.mainSaturationInput)), Math.abs(finite(packet.right.mainSaturationInput))); sessionMax.satActivity = Math.max(sessionMax.satActivity, metrics.sat);
    const baseEnergy = packet.left.feedbackCoreEffective === 'zdf' || packet.left.feedbackCoreEffective === 'zdf-per-band' || packet.left.feedbackCoreEffective === 'zdf-shared-band-sat';
    const leftEnergy = baseEnergy ? packet.left.baseBandEnergy : packet.left.bandEnergy;
    const rightEnergy = baseEnergy ? packet.right.baseBandEnergy : packet.right.bandEnergy;
    const energy = Math.max(...(leftEnergy || []).map((value, index) => finite(value) + finite(rightEnergy?.[index]))); if (energy > sessionMax.bandEnergy) { sessionMax.bandEnergy = energy; sessionMax.bandIndex = nextDominant.index; }
    renderSessionMax();
  };
  const receive = packet => {
    if (!packet?.left || !packet?.right) return;
    if (!resetBaseline) resetBaseline = { left: finite(packet.left.mainCommonNonFiniteResets), right: finite(packet.right.mainCommonNonFiniteResets) };
    observe(packet);
    if (frozen) return;
    latest = packet; audioLabel.textContent = 'LIVE · 15 Hz';
    push(histories.common, { left: localReturnValue(packet.left), right: localReturnValue(packet.right) });
    push(histories.main, { left: packet.left.mainCommonFeedbackReturn, right: packet.right.mainCommonFeedbackReturn });
    push(histories.resonance, { target: packet.left.resonanceTarget, smoothed: packet.left.smoothedResonance }); render();
  };
  const receiveOutputGuard = packet => {
    if (!packet || frozen) return;
    latestOutputGuard = packet;
    render();
  };
  const receiveOutputProtection = packet => {
    if (!packet || frozen) return;
    latestOutputProtection = packet;
    render();
  };
  setUpdateResonatorDiagnostics(() => {
    const normalTelemetryRequested = analyzerDisplay.selfOscillation || analyzerDisplay.dominantBand
      || analyzerDisplay.feedbackEnergy || analyzerDisplay.saturationIndicators;
    const needed = state.selectedWorkspaceMode === 'filterbank'
      && (responseMode === 'dev-lab' || normalTelemetryRequested);
    const outputProtectionNeeded = state.selectedWorkspaceMode === 'filterbank' && responseMode === 'dev-lab';
    summary.classList.toggle('has-output-protection', outputProtectionNeeded);
    // These views use linear band and feedback metrics, not the 2x solver metrics.
    audioEngine?.setResonatorDiagnosticsEnabled(needed);
    audioEngine?.setOutputGuardTelemetryEnabled(outputProtectionNeeded);
    audioEngine?.setOutputProtectionTelemetryEnabled(outputProtectionNeeded);
    if (!outputProtectionNeeded && !frozen) { latestOutputGuard = null; latestOutputProtection = null; }
  });
  const setMode = mode => { hideAnalyzerDetails(); responseMode = mode; const dev = mode === 'dev-lab'; filterbankWorkspace?.classList.toggle('is-dev-lab', dev); responseLab.hidden = !dev; responseChart.hidden = dev; if (responseLegend) responseLegend.hidden = dev; spectrumForegroundControl.hidden = dev; normalResponseButton.classList.toggle('active', !dev); devResponseButton.classList.toggle('active', dev); normalResponseButton.setAttribute('aria-pressed', String(!dev)); devResponseButton.setAttribute('aria-pressed', String(dev)); updateResonatorDiagnostics(); render(); };
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
  setMode('normal');
  return { receive, receiveOutputGuard, receiveOutputProtection, reset, render, startSession, getLatest: () => latest, getOutputGuard: () => latestOutputGuard, getOutputProtection: () => latestOutputProtection, getDominant: () => ({ index: dominant.index, stableMs: dominant.index === null ? 0 : performance.now() - dominant.startedAt }), getMetrics: () => latest ? telemetryMetrics(latest) : null, logEvent: log, eventCount: () => events.length, logStateChange: (label, before, after) => { if (before !== after) log(`${label} ${before} → ${after}`, { key: label, throttle: 350 }); }, logPanic: () => log('PANIC'), setAudioOff: () => { log('AUDIO STOP'); if (!frozen) { latest = null; latestOutputGuard = null; latestOutputProtection = null; audioLabel.textContent = 'NO AUDIO'; render(); } } };
})();
window.FilterbankDebugConsole = devLabTelemetry;

export {
  devLabTelemetry
};
