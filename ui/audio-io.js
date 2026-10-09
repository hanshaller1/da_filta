// Audio source and device selection, status display and the AudioEngine with its telemetry callbacks.
import { BAND_DEFINITIONS, state, audioEngine, updateResonatorDiagnostics, setAudioEngine } from './app-context.js';
import { devLabTelemetry } from './dev-lab-telemetry.js';
import { renderMacroControls } from './macro-mode.js';
import { filterSpectrumRenderer } from './filter-mode.js';
import { renderDynamicEqControls, setDynamicEqTelemetry } from './dynamic-eq-mode.js';
import {
  lfoTelemetry, getSelectedLfo, renderLfoWaveform, renderLfoPhase, startLfoDisplay, setLfoTelemetryReceivedAt
} from './lfo-mode.js';
import { renderClockModControls, setClockModTelemetry } from './clock-mod-mode.js';
import {
  envelopeTelemetry, envelopeGraphValues, envelopeRawGraphValues, getEnvelopeSource, renderEnvelopeGraph
} from './envelope-mode.js';
import { scheduleAnalyzerRender } from './band-analyzer.js';

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
  // The graph starts with one fixed source; keep its UI selection aligned
  // throughout module loading and the Character warmup interval.
  inputSourceButtons.forEach(button => { button.disabled = status === 'STARTING'; });
  if (inputDeviceSelect) inputDeviceSelect.disabled = status === 'STARTING';
  if (audioToggleButton) {
    audioToggleButton.disabled = status === 'STARTING';
    audioToggleButton.textContent = status === 'ON' ? 'STOP AUDIO' : 'START AUDIO';
    audioToggleButton.classList.toggle('stop', status === 'ON');
  }
  if (status === 'ON') devLabTelemetry.startSession(audioEngine?.context);
  else if (status !== 'STARTING') devLabTelemetry.setAudioOff();
  filterSpectrumRenderer.refresh();
};
setAudioEngine(new AudioEngine({
  onStatusChange: updateAudioStatus,
  onDevicesChanged: devices => { knownInputDevices = devices.inputs; if (audioSourceMode === 'device') renderDevices(inputDeviceSelect, devices.inputs, 'Kein Input-Gerät'); renderDevices(outputDeviceSelect, devices.outputs, 'Standardausgabe'); },
  onDiagnostics: packet => { devLabTelemetry.receive(packet); scheduleAnalyzerRender(); },
  onDynamicEqTelemetry: packet => {
    setDynamicEqTelemetry(packet);
    if (Array.isArray(packet.learnedReferenceDb)) {
      state.learnedReferenceDb = [...packet.learnedReferenceDb];
      state.learnedReferenceValid = packet.learnedReferenceValid === true
        && packet.learnedReferenceDb.length === BAND_DEFINITIONS.length
        && packet.learnedReferenceDb.every(Number.isFinite);
      state.learnedReferenceFrozen = state.learnedReferenceValid && packet.learnedReferenceFrozen === true;
    }
    if (state.selectedWorkspaceMode === 'dynamic-eq') requestAnimationFrame(renderDynamicEqControls);
  },
  onLfoTelemetry: packet => {
    if (packet.sourceId) lfoTelemetry.set(packet.sourceId, packet);
    setLfoTelemetryReceivedAt(performance.now());
    if (state.selectedWorkspaceMode === 'lfo' && packet.sourceId === getSelectedLfo()?.id) {
      if (getSelectedLfo()?.waveform === 'sample-hold' || getSelectedLfo()?.waveform === 'noise') renderLfoWaveform();
      renderLfoPhase();
      startLfoDisplay();
    }
  },
  onEnvelopeTelemetry: packet => {
    if (packet.sourceId) envelopeTelemetry.set(packet.sourceId, packet);
    if (Number.isFinite(packet.value) && Number.isFinite(packet.rawLevel)) {
      const values = envelopeGraphValues.get(packet.sourceId) || [];
      const rawValues = envelopeRawGraphValues.get(packet.sourceId) || [];
      values.push(Math.min(1, Math.max(0, packet.value)));
      rawValues.push(Math.min(1, Math.max(0, packet.rawLevel)));
      if (values.length > 96) values.shift();
      if (rawValues.length > 96) rawValues.shift();
      envelopeGraphValues.set(packet.sourceId, values);
      envelopeRawGraphValues.set(packet.sourceId, rawValues);
    }
    if (state.selectedWorkspaceMode === 'envelope-follower' && packet.sourceId === getEnvelopeSource()?.id) renderEnvelopeGraph();
  },
  onClockModTelemetry: packet => {
    setClockModTelemetry(packet);
    if (state.selectedWorkspaceMode === 'clock-mod') renderClockModControls();
  },
  onOutputProtectionTelemetry: packet => devLabTelemetry.receiveOutputProtection(packet),
  onOutputGuardTelemetry: packet => devLabTelemetry.receiveOutputGuard(packet)
}));
audioEngine.applyState(state);
renderClockModControls();
renderMacroControls();
updateResonatorDiagnostics();
const setAudioBypass = enabled => {
  audioBypassEnabled = Boolean(enabled);
  audioEngine?.setBypass(audioBypassEnabled);
  bypassAudioButton?.setAttribute('aria-pressed', String(audioBypassEnabled));
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

export {
  inputDeviceSelect, outputDeviceSelect, audioToggleButton, panicAudioButton, bypassAudioButton, audioMessage,
  audioSourceMode, audioBypassEnabled, rememberedInputDeviceId, selectedSample, logSourceEvent,
  updateAudioStatus, setAudioBypass, refreshAudioDevices
};
