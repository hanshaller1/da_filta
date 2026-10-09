// ENVELOPE FOLLOWER mode: source slots, parameter controls, level graph and assignments.
import { MODULATION_TARGETS, getModulationAssignmentStatus } from '../modulation-core.mjs';
import { state, audioEngine } from './app-context.js';
import { lfoTargetContext, renderSourceAssignments, bindAssignmentEditor } from './modulation-assignments.js';
import { renderMacroControls } from './macro-mode.js';

const envelopeTelemetry = new Map();
const envelopeGraphValues = new Map();
const envelopeRawGraphValues = new Map();
let selectedEnvelopeIndex = 0;
const envelopePowerButton = document.querySelector('[data-module-power="envelope-follower"]');
const envelopeEnableButton = document.querySelector('[data-envelope-enable]');
const envelopeSlotButtons = [...document.querySelectorAll('[data-envelope-slot]')];
const envelopeModeButtons = [...document.querySelectorAll('[data-envelope-mode]')];
const envelopeAttackInput = document.querySelector('[data-envelope-attack]');
const envelopeReleaseInput = document.querySelector('[data-envelope-release]');
const envelopeDelayInput = document.querySelector('[data-envelope-delay]');
const envelopeSensitivityInput = document.querySelector('[data-envelope-sensitivity]');
const envelopeThresholdInput = document.querySelector('[data-envelope-threshold]');
const envelopeWavePath = document.querySelector('[data-envelope-wave-path]');
const envelopeRawWavePath = document.querySelector('[data-envelope-raw-wave-path]');
const envelopeThresholdLine = document.querySelector('[data-envelope-threshold-line]');
const envelopeReadout = document.querySelector('[data-envelope-readout]');
const envelopeStatus = document.querySelector('[data-envelope-status]');
const getEnvelopeSource = (index = selectedEnvelopeIndex) => state.envelopeSources?.[index] || null;
const getEnvelopeValue = (source = getEnvelopeSource()) => {
  const telemetry = source ? envelopeTelemetry.get(source.id) : null;
  return source?.enabled && telemetry?.enabled && Number.isFinite(telemetry.value)
    ? Math.min(1, Math.max(0, telemetry.value)) : 0;
};
const renderEnvelopeGraph = () => {
  const current = getEnvelopeValue();
  const source = getEnvelopeSource();
  const rawValues = source ? envelopeRawGraphValues.get(source.id) || [] : [];
  const envelopeValues = source ? envelopeGraphValues.get(source.id) || [] : [];
  const currentTelemetry = source ? envelopeTelemetry.get(source.id) : null;
  const rawCurrent = source?.enabled && currentTelemetry?.enabled ? (currentTelemetry.rawLevel ?? 0) : 0;
  if (envelopeReadout) {
    envelopeReadout.textContent = `RAW ${rawCurrent.toFixed(2)} · ENV ${current.toFixed(2)}`;
    envelopeReadout.setAttribute('aria-label', `Raw detector level ${rawCurrent.toFixed(2)}, smoothed envelope ${current.toFixed(2)}`);
  }
  const drawPath = (element, values, fallback) => {
    if (!element) return;
    const points = values.length ? values : [fallback];
    let path = '';
    for (let index = 0; index < points.length; index += 1) {
      const x = points.length === 1 ? 1000 : index / (points.length - 1) * 1000;
      const y = 114 - Math.min(1, Math.max(0, points[index])) * 108;
      path += `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    element.setAttribute('d', path.trim());
  };
  drawPath(envelopeRawWavePath, rawValues, rawCurrent);
  drawPath(envelopeWavePath, envelopeValues, current);
  if (envelopeThresholdLine && source) {
    const y = 114 - 10 ** (source.thresholdDb / 20) * 108;
    envelopeThresholdLine.setAttribute('y1', y.toFixed(2));
    envelopeThresholdLine.setAttribute('y2', y.toFixed(2));
  }
};
const commitEnvelopeState = () => {
  const currentSource = getEnvelopeSource();
  const previous = currentSource ? envelopeTelemetry.get(currentSource.id)?.enabled === true : false;
  const normalized = window.ResonantState.normalizeEnvelopeState(state);
  state.envelopeCount = normalized.envelopeCount;
  state.envelopeSources = normalized.envelopeSources;
  const source = getEnvelopeSource();
  if (!source?.enabled || !previous) {
    if (source) {
      envelopeGraphValues.delete(source.id);
      envelopeRawGraphValues.delete(source.id);
      envelopeTelemetry.delete(source.id);
    }
  }
  audioEngine?.setModulationState(state);
  renderEnvelopeControls();
};
const setEnvelopeSource = patch => {
  const source = getEnvelopeSource();
  if (!source) return;
  // Compatibility for single-route callers; an explicit assignment array owns
  // routing and an empty array must never resurrect a removed legacy target.
  if (!patch.assignments && ['targetId', 'amount', 'channel', 'invert'].some(field => field in patch)) {
    const first = source.assignments[0] || { id: `${source.id}.assignment.1`, sourceId: source.id,
      targetId: '', amount: 50, channel: 'both', invert: false, enabled: true };
    for (const field of ['targetId', 'amount', 'channel', 'invert']) if (field in patch) first[field] = patch[field];
    if (!source.assignments.length) source.assignments.push(first);
  }
  Object.assign(source, patch);
  commitEnvelopeState();
};
const renderEnvelopeSlots = () => {
  envelopeSlotButtons.forEach(button => {
    const index = Number(button.dataset.envelopeSlot);
    const source = getEnvelopeSource(index);
    if (!source) return;
    const target = MODULATION_TARGETS.find(item => item.id === source.targetId);
    const active = index === selectedEnvelopeIndex;
    button.classList.toggle('active', active);
    button.classList.toggle('is-enabled', source.enabled);
    const assigned = source.assignments.filter(assignment => assignment.targetId);
    const lostCount = assigned.filter(assignment => ['target-invalid', 'target-unavailable', 'cycle-blocked'].includes(
      getModulationAssignmentStatus(assignment, lfoTargetContext(), state.envelopeModuleEnabled && source.enabled).reason)).length;
    button.dataset.lostTargets = String(lostCount);
    button.classList.toggle('has-lost-target', lostCount > 0);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', `Select ENV ${index + 1}, ${source.enabled ? 'ON' : 'OFF'}, ${source.detectorMode.toUpperCase()}, ${target?.label || 'NO TARGET'}`);
    button.querySelector('.lfo-slot-state').textContent = source.enabled ? 'ON' : 'OFF';
    button.querySelector('.lfo-slot-detail').textContent = `${source.detectorMode.toUpperCase()} · ${assigned.length > 1 ? `${assigned.length} TARGETS` : target?.label?.toUpperCase() || 'NO TARGET'}${lostCount ? ' · UNAVAILABLE' : ''}`;
  });
};
const renderEnvelopeControls = () => {
  const source = getEnvelopeSource();
  if (!source) return;
  renderEnvelopeSlots();
  envelopePowerButton?.setAttribute('aria-pressed', String(state.envelopeModuleEnabled === true));
  envelopePowerButton?.setAttribute('aria-label', state.envelopeModuleEnabled ? 'ENVELOPE FOLLOWER ausschalten' : 'ENVELOPE FOLLOWER einschalten');
  if (envelopeEnableButton) {
    envelopeEnableButton.textContent = source.enabled ? 'SOURCE ON' : 'SOURCE OFF';
    envelopeEnableButton.setAttribute('aria-pressed', String(source.enabled));
    envelopeEnableButton.setAttribute('aria-label', source.enabled ? 'Disable envelope source' : 'Enable envelope source');
  }
  envelopeModeButtons.forEach(button => {
    const active = button.dataset.envelopeMode === source.detectorMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (envelopeAttackInput) envelopeAttackInput.value = String(source.attack);
  if (envelopeReleaseInput) envelopeReleaseInput.value = String(source.release);
  if (envelopeDelayInput) envelopeDelayInput.value = String(source.delay);
  if (envelopeSensitivityInput) envelopeSensitivityInput.value = String(source.sensitivity);
  if (envelopeThresholdInput) envelopeThresholdInput.value = String(source.thresholdDb);
  const attackOutput = document.querySelector('[data-envelope-attack-output]');
  const releaseOutput = document.querySelector('[data-envelope-release-output]');
  const delayOutput = document.querySelector('[data-envelope-delay-output]');
  const sensitivityOutput = document.querySelector('[data-envelope-sensitivity-output]');
  const thresholdOutput = document.querySelector('[data-envelope-threshold-output]');
  if (attackOutput) attackOutput.textContent = `${Math.round(source.attack)} ms`;
  if (releaseOutput) releaseOutput.textContent = `${Math.round(source.release)} ms`;
  if (delayOutput) delayOutput.textContent = `${Math.round(source.delay)} ms`;
  if (sensitivityOutput) sensitivityOutput.textContent = `${Math.round(source.sensitivity)} %`;
  if (thresholdOutput) thresholdOutput.textContent = `${Math.round(source.thresholdDb)} dB`;
  renderSourceAssignments('envelope', source, document.querySelector('[data-envelope-assignments]'), state.envelopeModuleEnabled);
  const outputAmountInput = document.querySelector('[data-envelope-output-amount]');
  if (outputAmountInput) outputAmountInput.value = String(source.outputAmount);
  const outputAmountOutput = document.querySelector('[data-envelope-output-amount-output]');
  if (outputAmountOutput) outputAmountOutput.textContent = Math.round(source.outputAmount) + ' %';
  if (envelopeStatus) envelopeStatus.textContent = `${state.envelopeModuleEnabled ? 'MODULE ON' : 'MODULE OFF'} · ENV ${selectedEnvelopeIndex + 1} ${source.enabled ? 'ON' : 'OFF'} · INPUT / PRE-FILTERBANK`;
  renderEnvelopeGraph();
  if (state.selectedWorkspaceMode === 'presets') renderMacroControls();
};
renderEnvelopeControls();
envelopePowerButton?.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  if (event.detail === 0) return;
  state.envelopeModuleEnabled = !state.envelopeModuleEnabled;
  audioEngine?.setModulationState(state);
  renderEnvelopeControls();
});
envelopeSlotButtons.forEach(button => button.addEventListener('click', () => {
  const index = Number(button.dataset.envelopeSlot);
  if (!Number.isInteger(index) || index < 0 || index >= 4) return;
  selectedEnvelopeIndex = index;
  renderEnvelopeControls();
}));
bindAssignmentEditor('envelope', getEnvelopeSource, commitEnvelopeState);
document.querySelector('[data-envelope-output-amount]')?.addEventListener('input', event => setEnvelopeSource({ outputAmount: Number(event.target.value) }));
envelopeEnableButton?.addEventListener('click', () => setEnvelopeSource({ enabled: !getEnvelopeSource()?.enabled }));
envelopeModeButtons.forEach(button => button.addEventListener('click', () => {
  if (['peak', 'rms'].includes(button.dataset.envelopeMode)) setEnvelopeSource({ detectorMode: button.dataset.envelopeMode });
}));
envelopeAttackInput?.addEventListener('input', () => setEnvelopeSource({ attack: Number(envelopeAttackInput.value) }));
envelopeReleaseInput?.addEventListener('input', () => setEnvelopeSource({ release: Number(envelopeReleaseInput.value) }));
envelopeDelayInput?.addEventListener('input', () => setEnvelopeSource({ delay: Number(envelopeDelayInput.value) }));
envelopeSensitivityInput?.addEventListener('input', () => setEnvelopeSource({ sensitivity: Number(envelopeSensitivityInput.value) }));
envelopeThresholdInput?.addEventListener('input', () => setEnvelopeSource({ thresholdDb: Number(envelopeThresholdInput.value) }));

export {
  envelopeTelemetry, envelopeGraphValues, envelopeRawGraphValues, selectedEnvelopeIndex, getEnvelopeSource,
  renderEnvelopeGraph, commitEnvelopeState, renderEnvelopeControls
};
