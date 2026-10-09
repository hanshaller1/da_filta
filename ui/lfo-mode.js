// LFO mode: source slots, parameter controls, waveform display and assignments.
import { getModulationTarget, getModulationAssignmentStatus } from '../modulation-core.mjs';
import {
  LFO_WAVEFORMS, LFO_SYNC_DIVISIONS, paginateLfoSources, rateToSlider, sliderToRate, waveformSample
} from '../lfo-core.mjs';
import { SYNC_DIVISION_BEATS } from '../clock-core.mjs';
import { state, audioEngine, hooks } from './app-context.js';
import { lfoTargetContext, renderSourceAssignments, bindAssignmentEditor } from './modulation-assignments.js';
import { renderMacroControls } from './macro-mode.js';
import {
  lfoMidiStatus, midiConfig, midiAccessStatus, midiRuntimeEnabled, getMidiStatusText, setClockState,
  midiManager, setMidiTransportRunning
} from './midi-clock.js';

const lfoTelemetry = new Map();
const lfoPowerButton = document.querySelector('[data-module-power="lfo"]');
const lfoWaveformButtons = [...document.querySelectorAll('[data-lfo-waveform]')];
const lfoPolarityButtons = [...document.querySelectorAll('[data-lfo-polarity]')];
const lfoAssignmentList = document.querySelector('[data-lfo-assignments]');
const lfoRateInput = document.querySelector('[data-lfo-rate]');
const lfoPhaseInput = document.querySelector('[data-lfo-phase]');
const lfoWavePath = document.querySelector('[data-lfo-wave-path]');
const lfoVisualizer = document.querySelector('[data-lfo-visualizer]');
const lfoAxisLabels = [...document.querySelectorAll('[data-lfo-axis-value]')];
const lfoGridLines = [...document.querySelectorAll('[data-lfo-visualizer] .lfo-grid-line')];
const lfoPhaseLine = document.querySelector('[data-lfo-phase-line]');
const lfoPhaseDot = document.querySelector('[data-lfo-phase-dot]');
const lfoPhaseReadout = document.querySelector('[data-lfo-phase-readout]');
const lfoStatus = document.querySelector('[data-lfo-status]');
const lfoSlots = document.querySelector('[data-lfo-slots]');
const lfoTitle = document.querySelector('[data-lfo-title]');
const lfoSourceEnableButton = document.querySelector('[data-lfo-source-enable]');
const lfoRateModeButtons = [...document.querySelectorAll('[data-lfo-rate-mode]')];
const lfoClockSourceSelect = document.querySelector('[data-lfo-clock-source]');
const lfoBpmInput = document.querySelector('[data-lfo-bpm]');
const lfoDivisionSelect = document.querySelector('[data-lfo-division]');
const lfoInvertButton = document.querySelector('[data-lfo-invert]');
const lfoBpmControl = document.querySelector('[data-lfo-bpm-control]');
const lfoDivisionControl = document.querySelector('[data-lfo-division-control]');
let selectedLfoIndex = 0;
const setSelectedLfoIndex = value => (selectedLfoIndex = value);
let lfoSlotPage = 0;
const LFO_SLOT_PAGE_SIZE = 4;
let lfoAnimationFrame = 0;
let lfoTelemetryReceivedAt = 0;
const setLfoTelemetryReceivedAt = value => (lfoTelemetryReceivedAt = value);
const lfoFormatRate = value => `${Number(value) < 1 ? Number(value).toFixed(2) : Number(value).toFixed(Number(value) < 10 ? 2 : 1)} Hz`;
const getSelectedLfo = () => state.lfoSources?.[selectedLfoIndex] || state.lfoSources?.[0];
const getSourceLfoTelemetry = source => source ? lfoTelemetry.get(source.id) || null : null;
const syncLegacyLfoAliases = () => {
  for (const source of state.lfoSources || []) {
    const firstAssignment = source.assignments[0];
    source.targetId = firstAssignment?.targetId || '';
    source.amount = firstAssignment?.amount ?? 0;
    source.channel = firstAssignment?.channel || 'both';
  }
  const first = state.lfoSources?.[0];
  if (!first) return;
  state.lfoEnabled = state.lfoModuleEnabled === true;
  state.lfoWaveform = first.waveform;
  state.lfoRateHz = first.rateHz;
  state.lfoPolarity = first.polarity;
  state.lfoPhase = first.phaseOffsetDeg;
  state.lfoTargetId = first.targetId;
  state.lfoAmount = first.amount;
  state.lfoSeed = first.seed;
};
const commitLfoState = () => {
  syncLegacyLfoAliases();
  audioEngine?.setModulationState(state);
  renderLfoControls();
};
const setSelectedLfo = patch => {
  const source = getSelectedLfo();
  if (!source) return;
  Object.assign(source, patch);
  commitLfoState();
};
const populateLfoTargets = () => renderLfoAssignments();
const lfoAssignmentStatus = (assignment, source) => getModulationAssignmentStatus(
  assignment, lfoTargetContext(), state.lfoModuleEnabled && source.enabled);
const renderLfoAssignments = () => {
  renderSourceAssignments('lfo', getSelectedLfo(), lfoAssignmentList, state.lfoModuleEnabled);
};
const getDisplayedLfoPhase = () => {
  const source = getSelectedLfo();
  const telemetry = getSourceLfoTelemetry(source);
  if (!state.lfoModuleEnabled || !source?.enabled || !telemetry?.enabled) return 0;
  const elapsed = Math.min(1 / 30, Math.max(0, performance.now() - lfoTelemetryReceivedAt) / 1000);
  if (source.rateMode === 'sync') {
    if (state.lfoClock?.source === 'midi' && !state.lfoClock.running) return telemetry.phase;
    const bpm = state.lfoClock?.source === 'midi' ? state.lfoClock.midiBpm : state.lfoClock?.bpm;
    const rate = (Number(bpm) || 120) / 60 / (SYNC_DIVISION_BEATS[source.syncDivision] || 1);
    return (telemetry.phase + elapsed * rate) % 1;
  }
  const rateHz = Number.isFinite(telemetry.rateHz) ? telemetry.rateHz : source.rateHz;
  return (telemetry.phase + elapsed * rateHz) % 1;
};
// Worklet telemetry is already the final oscillator sample after polarity and
// invert. Keep it authoritative for the live marker; never transform it again.
const lfoTelemetrySampleValue = telemetry => telemetry?.enabled && Number.isFinite(telemetry.value)
  ? telemetry.value : null;
const getLfoPreviewRandom = (source, phase) => {
  const seed = (source.seed + Math.floor(phase * 4) * 0x9e3779b9) >>> 0;
  let value = seed || 1;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return ((value >>> 0) / 0xffffffff) * 2 - 1;
};
const lfoDisplaySample = (source, phase) => {
  // This is a seeded preview only. Random preview values are not represented as
  // live samples; renderLfoPhase uses the actual worklet value when available.
  const raw = waveformSample(source.waveform, phase + source.phaseOffsetDeg / 360,
    getLfoPreviewRandom(source, phase), getLfoPreviewRandom(source, phase + .25));
  const polarityValue = source.polarity === 'unipolar' ? (raw + 1) / 2 : raw;
  return source.invert ? -polarityValue : polarityValue;
};
const getLfoDisplayDomain = source => source.polarity === 'unipolar'
  ? (source.invert ? { min: -1, max: 0 } : { min: 0, max: 1 })
  : { min: -1, max: 1 };
const lfoDisplayY = (value, domain) => 114 - (value - domain.min) / (domain.max - domain.min) * 108;
const renderLfoAxis = domain => {
  if (!lfoVisualizer) return;
  lfoVisualizer.dataset.valueMin = String(domain.min);
  lfoVisualizer.dataset.valueMax = String(domain.max);
  const values = [domain.max, (domain.min + domain.max) / 2, domain.min];
  const label = value => value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0';
  lfoAxisLabels.forEach((element, index) => { element.textContent = label(values[index]); });
  lfoGridLines.forEach((line, index) => {
    line.dataset.lfoValue = String(values[index]);
    line.toggleAttribute('data-lfo-zero-line', values[index] === 0);
  });
  lfoVisualizer.querySelector('svg')?.setAttribute('aria-label',
    `Selected LFO waveform and audio-thread phase, range ${label(domain.min)} to ${label(domain.max)}`);
};
const renderLfoWaveform = () => {
  if (!lfoWavePath) return;
  const source = getSelectedLfo();
  if (!source) return;
  const domain = getLfoDisplayDomain(source);
  renderLfoAxis(domain);
  const count = 128;
  let path = '';
  for (let index = 0; index <= count; index += 1) {
    const phase = index / count;
    const value = lfoDisplaySample(source, phase);
    const y = lfoDisplayY(value, domain);
    path += `${index ? 'L' : 'M'}${(phase * 1000).toFixed(2)} ${y.toFixed(2)} `;
  }
  lfoWavePath.setAttribute('d', path.trim());
};
const renderLfoPhase = () => {
  if (!lfoPhaseLine || !lfoPhaseDot) return;
  const source = getSelectedLfo();
  if (!source) return;
  const telemetry = getSourceLfoTelemetry(source);
  const phase = getDisplayedLfoPhase();
  const x = phase * 1000;
  const telemetrySample = lfoTelemetrySampleValue(telemetry);
  const sample = telemetrySample ?? lfoDisplaySample(source, phase);
  const y = lfoDisplayY(sample, getLfoDisplayDomain(source));
  lfoPhaseLine.setAttribute('x1', x.toFixed(2));
  lfoPhaseLine.setAttribute('x2', x.toFixed(2));
  lfoPhaseDot.setAttribute('cx', x.toFixed(2));
  lfoPhaseDot.setAttribute('cy', y.toFixed(2));
  lfoPhaseDot.dataset.value = String(sample);
  const clockRate = source.rateMode === 'sync' ? `${source.syncDivision} · ${getMidiStatusText()}`
    : lfoFormatRate(Number.isFinite(telemetry?.rateHz) ? telemetry.rateHz : source.rateHz);
  const sampleReadout = telemetrySample === null ? '' : ` · ${telemetrySample > 0 ? '+' : ''}${telemetrySample.toFixed(2)}`;
  if (lfoPhaseReadout) lfoPhaseReadout.textContent = `${Math.round(phase * 360)}° · ${clockRate}${sampleReadout}`;
};
const renderLfoSlots = () => {
  if (!lfoSlots) return;
  const sources = state.lfoSources || [];
  const pages = paginateLfoSources(sources, LFO_SLOT_PAGE_SIZE);
  const pageCount = Math.max(1, pages.length);
  lfoSlotPage = Math.min(pageCount - 1, Math.max(0, Math.floor(selectedLfoIndex / LFO_SLOT_PAGE_SIZE)));
  lfoSlots.replaceChildren();
  (pages[lfoSlotPage] || []).forEach((source, offset) => {
    const index = lfoSlotPage * LFO_SLOT_PAGE_SIZE + offset;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lfo-slot${index === selectedLfoIndex ? ' active' : ''}${source.enabled ? ' is-enabled' : ''}`;
    button.dataset.lfoSlot = String(index);
    button.setAttribute('aria-pressed', String(index === selectedLfoIndex));
    const number = document.createElement('span'); number.className = 'lfo-slot-number'; number.textContent = String(index + 1);
    const status = document.createElement('span'); status.className = 'lfo-slot-state'; status.textContent = `${source.enabled ? 'ON' : 'OFF'} · ${source.waveform.toUpperCase()}`;
    const detail = document.createElement('span'); detail.className = 'lfo-slot-detail';
    const assigned = source.assignments.filter(assignment => assignment.targetId);
    const lostCount = assigned.filter(assignment => {
      const reason = lfoAssignmentStatus(assignment, source).reason;
      return reason === 'target-invalid' || reason === 'target-unavailable' || reason === 'cycle-blocked';
    }).length;
    detail.textContent = assigned.length === 1 ? (getModulationTarget(assigned[0].targetId)?.label || assigned[0].targetId)
      : assigned.length ? `${assigned.length} TARGETS` : 'NO TARGET';
    button.dataset.lostTargets = String(lostCount);
    button.classList.toggle('has-lost-target', lostCount > 0);
    if (lostCount) {
      detail.textContent = `! ${lostCount} UNAVAILABLE · ${detail.textContent}`;
      button.title = `${lostCount} unavailable or invalid assignment${lostCount === 1 ? '' : 's'}`;
    }
    button.append(number, status, detail);
    button.addEventListener('click', () => { selectedLfoIndex = index; renderLfoControls(); });
    lfoSlots.append(button);
  });
  if (pageCount > 1) {
    const nav = document.createElement('div'); nav.className = 'lfo-page-nav'; nav.setAttribute('aria-label', 'LFO banks');
    for (let page = 0; page < pageCount; page += 1) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'dynamic-eq-view-toggle';
      button.textContent = String.fromCharCode(65 + page); button.setAttribute('aria-pressed', String(page === lfoSlotPage));
      button.classList.add('ui-role-utility');
      button.addEventListener('click', () => { selectedLfoIndex = page * LFO_SLOT_PAGE_SIZE; renderLfoControls(); });
      nav.append(button);
    }
    lfoSlots.append(nav);
  }
};
const renderLfoControls = () => {
  if (!lfoPowerButton) return;
  const source = getSelectedLfo();
  if (!source) return;
  lfoPowerButton.setAttribute('aria-pressed', String(state.lfoModuleEnabled));
  lfoPowerButton.setAttribute('aria-label', state.lfoModuleEnabled ? 'LFO-Modul ausschalten' : 'LFO-Modul einschalten');
  if (lfoSourceEnableButton) {
    lfoSourceEnableButton.textContent = source.enabled ? 'SOURCE ON' : 'SOURCE OFF';
    lfoSourceEnableButton.setAttribute('aria-pressed', String(source.enabled));
  }
  if (lfoTitle) lfoTitle.textContent = `LFO ${selectedLfoIndex + 1} · ${source.waveform.toUpperCase()}${source.invert ? ' · INVERTED' : ''}`;
  lfoWaveformButtons.forEach(button => {
    const active = LFO_WAVEFORMS.includes(button.dataset.lfoWaveform) && button.dataset.lfoWaveform === source.waveform;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  lfoPolarityButtons.forEach(button => {
    const active = button.dataset.lfoPolarity === source.polarity;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  lfoRateModeButtons.forEach(button => {
    const active = button.dataset.lfoRateMode === source.rateMode;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  if (lfoRateInput) { lfoRateInput.value = String(rateToSlider(source.rateHz)); lfoRateInput.disabled = source.rateMode === 'sync'; }
  if (lfoPhaseInput) lfoPhaseInput.value = String(source.phaseOffsetDeg);
  if (lfoClockSourceSelect) lfoClockSourceSelect.value = state.lfoClock?.source || 'internal';
  if (lfoBpmInput) { lfoBpmInput.value = String(state.lfoClock?.bpm ?? 120); lfoBpmInput.disabled = source.rateMode !== 'sync' || state.lfoClock?.source === 'midi'; }
  if (lfoDivisionSelect) { lfoDivisionSelect.value = source.syncDivision; lfoDivisionSelect.disabled = source.rateMode !== 'sync'; }
  if (lfoClockSourceSelect) lfoClockSourceSelect.disabled = source.rateMode !== 'sync';
  if (lfoInvertButton) { lfoInvertButton.textContent = source.invert ? 'INVERT ON' : 'INVERT OFF'; lfoInvertButton.setAttribute('aria-pressed', String(source.invert)); }
  if (lfoBpmControl) lfoBpmControl.classList.toggle('is-inactive', source.rateMode !== 'sync' || state.lfoClock?.source === 'midi');
  if (lfoDivisionControl) lfoDivisionControl.classList.toggle('is-inactive', source.rateMode !== 'sync');
  const rateOutput = document.querySelector('[data-lfo-rate-output]');
  const phaseOutput = document.querySelector('[data-lfo-phase-output]');
  if (rateOutput) rateOutput.textContent = lfoFormatRate(source.rateHz);
  if (phaseOutput) phaseOutput.textContent = `${Math.round(source.phaseOffsetDeg)} deg`;
  const outputAmountInput = document.querySelector('[data-lfo-output-amount]');
  if (outputAmountInput) outputAmountInput.value = String(source.outputAmount);
  const outputAmountOutput = document.querySelector('[data-lfo-output-amount-output]');
  if (outputAmountOutput) outputAmountOutput.textContent = Math.round(source.outputAmount) + ' %';
  renderLfoAssignments();
  const assignedCount = source.assignments.filter(assignment => assignment.targetId).length;
  if (lfoStatus) lfoStatus.textContent = `${state.lfoModuleEnabled ? 'MODULE ON' : 'MODULE OFF'} · ${source.enabled ? 'LFO ON' : 'LFO OFF'} · ${assignedCount} TARGETS`;
  if (lfoMidiStatus) lfoMidiStatus.textContent = getMidiStatusText();
  renderLfoSlots();
  renderLfoWaveform();
  renderLfoPhase();
  if (state.selectedWorkspaceMode === 'presets') renderMacroControls();
};
hooks.renderLfoControls = renderLfoControls;
const animateLfoDisplay = () => {
  lfoAnimationFrame = 0;
  const telemetry = getSourceLfoTelemetry(getSelectedLfo());
  if (state.selectedWorkspaceMode !== 'lfo' || !state.lfoModuleEnabled || !getSelectedLfo()?.enabled || !telemetry?.enabled
    || performance.now() - lfoTelemetryReceivedAt > 250) return;
  renderLfoPhase();
  lfoAnimationFrame = requestAnimationFrame(animateLfoDisplay);
};
const startLfoDisplay = () => {
  if (!lfoAnimationFrame && state.lfoModuleEnabled && getSelectedLfo()?.enabled && getSourceLfoTelemetry(getSelectedLfo())?.enabled && state.selectedWorkspaceMode === 'lfo') {
    lfoAnimationFrame = requestAnimationFrame(animateLfoDisplay);
  }
};
const stopLfoDisplay = () => { if (lfoAnimationFrame) cancelAnimationFrame(lfoAnimationFrame); lfoAnimationFrame = 0; };
populateLfoTargets();
renderLfoControls();
lfoPowerButton?.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  if (event.detail === 0) return;
  state.lfoModuleEnabled = !state.lfoModuleEnabled;
  commitLfoState();
  if (!state.lfoModuleEnabled) stopLfoDisplay();
  startLfoDisplay();
});
lfoSourceEnableButton?.addEventListener('click', () => setSelectedLfo({ enabled: !getSelectedLfo()?.enabled }));
lfoWaveformButtons.forEach(button => button.addEventListener('click', () => {
  setSelectedLfo({ waveform: button.dataset.lfoWaveform });
}));
lfoPolarityButtons.forEach(button => button.addEventListener('click', () => {
  setSelectedLfo({ polarity: button.dataset.lfoPolarity });
}));
lfoRateModeButtons.forEach(button => button.addEventListener('click', () => setSelectedLfo({ rateMode: button.dataset.lfoRateMode })));
lfoRateInput?.addEventListener('input', () => {
  setSelectedLfo({ rateHz: sliderToRate(lfoRateInput.value) });
});
lfoPhaseInput?.addEventListener('input', () => {
  setSelectedLfo({ phaseOffsetDeg: Number(lfoPhaseInput.value) });
});
bindAssignmentEditor('lfo', getSelectedLfo, commitLfoState);
document.querySelector('[data-lfo-output-amount]')?.addEventListener('input', event => setSelectedLfo({ outputAmount: Number(event.target.value) }));
lfoInvertButton?.addEventListener('click', () => setSelectedLfo({ invert: !getSelectedLfo()?.invert }));
lfoDivisionSelect?.addEventListener('change', () => {
  if (LFO_SYNC_DIVISIONS.includes(lfoDivisionSelect.value)) setSelectedLfo({ syncDivision: lfoDivisionSelect.value });
});
lfoClockSourceSelect?.addEventListener('change', () => {
  if (lfoClockSourceSelect.value === 'midi') {
    const status = !midiRuntimeEnabled || !midiConfig.receive ? 'DISABLED' : midiAccessStatus === 'UNAVAILABLE' ? 'UNAVAILABLE' : (!midiManager.selectedId ? 'NO INPUT' : 'NO CLOCK');
    setMidiTransportRunning(false);
    setClockState({ source: 'midi', midiAvailable: midiAccessStatus === 'CONNECTED', running: false, midiStatus: status });
  } else {
    setMidiTransportRunning(false);
    setClockState({ source: 'internal', running: true, midiStatus: 'UNAVAILABLE' });
  }
});
lfoBpmInput?.addEventListener('change', () => {
  const bpm = Math.min(300, Math.max(30, Number(lfoBpmInput.value) || 120));
  setClockState({ bpm });
});
document.querySelector('[data-lfo-reset]')?.addEventListener('click', () => {
  audioEngine?.resetLfoPhase(getSelectedLfo()?.id);
  renderLfoControls();
});

export {
  lfoTelemetry, selectedLfoIndex, LFO_SLOT_PAGE_SIZE, getSelectedLfo, getSourceLfoTelemetry, commitLfoState,
  lfoAssignmentStatus, renderLfoWaveform, renderLfoPhase, renderLfoControls, startLfoDisplay, stopLfoDisplay,
  setSelectedLfoIndex, setLfoTelemetryReceivedAt
};
