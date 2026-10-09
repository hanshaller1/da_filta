// CLOCK MOD mode: controls, band locks and the held-value graph.
import { rateToSlider, sliderToRate } from '../lfo-core.mjs';
import { BAND_DEFINITIONS, BAND_COUNT, state, audioEngine, hooks } from './app-context.js';
import { renderSourceAssignments, bindAssignmentEditor } from './modulation-assignments.js';
import { midiDisplayBpm } from './midi-clock.js';

let clockModTelemetry = null;
const setClockModTelemetry = value => (clockModTelemetry = value);
const clockModPowerButton = document.querySelector('[data-module-power="clock-mod"]');
const clockModWaveformButtons = [...document.querySelectorAll('[data-clock-mod-waveform]')];
const clockModDirectionButtons = [...document.querySelectorAll('[data-clock-mod-direction]')];
const clockModSourceButtons = [...document.querySelectorAll('[data-clock-mod-source]')];
const clockModFrequencyInput = document.querySelector('[data-clock-mod-frequency]');
const clockModFrequencyOutput = document.querySelector('[data-clock-mod-frequency-output]');
const clockModGainInput = document.querySelector('[data-clock-mod-gain]');
const clockModGainOutput = document.querySelector('[data-clock-mod-gain-output]');
const clockModMidpointInput = document.querySelector('[data-clock-mod-midpoint]');
const clockModMidpointOutput = document.querySelector('[data-clock-mod-midpoint-output]');
const clockModBpmInput = document.querySelector('[data-clock-mod-bpm]');
const clockModBpmControl = document.querySelector('[data-clock-mod-bpm-control]');
const clockModMidiTempo = document.querySelector('[data-clock-mod-midi-tempo]');
const clockModMidiBpm = document.querySelector('[data-clock-mod-midi-bpm]');
const clockModScaleInput = document.querySelector('[data-clock-mod-scale]');
const clockModScaleControl = document.querySelector('[data-clock-mod-scale-control]');
const clockModRightInvertButton = document.querySelector('[data-clock-mod-right-invert]');
const clockModResetButton = document.querySelector('[data-clock-mod-reset]');
const clockModStatus = document.querySelector('[data-clock-mod-status]');
const clockModGrid = document.querySelector('[data-clock-mod-grid]');
const clockModCurrentBand = document.querySelector('[data-clock-mod-current-band]');
const clockModLeftPath = document.querySelector('[data-clock-mod-left-path]');
const clockModRightPath = document.querySelector('[data-clock-mod-right-path]');
const clockModPoints = document.querySelector('[data-clock-mod-points]');
const clockModFrequencies = document.querySelector('[data-clock-mod-frequencies]');
const clockModLocks = document.querySelector('[data-clock-mod-locks]');
const clockModAxisBoost = document.querySelector('[data-clock-mod-axis-boost]');
const clockModAxisCut = document.querySelector('[data-clock-mod-axis-cut]');
const clockModFrequencyX = frequency => {
  const minimum = BAND_DEFINITIONS[0].frequency;
  const maximum = BAND_DEFINITIONS[BAND_DEFINITIONS.length - 1].frequency;
  return 20 + Math.log(frequency / minimum) / Math.log(maximum / minimum) * 960;
};
const getClockModBandLimits = () => ({
  boost: Number.isFinite(audioEngine?.maxBandBoostDb) ? audioEngine.maxBandBoostDb : 12,
  cut: Number.isFinite(audioEngine?.maxBandCutDb) ? audioEngine.maxBandCutDb : 12
});
const commitClockModState = patch => {
  state.clockMod = window.ResonantState.normalizeClockModState({ ...state.clockMod, ...patch });
  if (audioEngine?.setClockModState) state.clockMod = audioEngine.setClockModState(state.clockMod);
  renderClockModControls();
  return state.clockMod;
};
const setClockModEnabled = enabled => commitClockModState({ enabled: enabled === true });
const renderClockModLocks = () => {
  if (!clockModLocks) return;
  if (!clockModLocks.children.length) {
    clockModLocks.replaceChildren(...BAND_DEFINITIONS.map((band, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.clockModLock = String(index);
      button.classList.add('ui-role-utility');
      button.setAttribute('aria-label', `Lock Clock Mod band ${index + 1} (${band.label})`);
      button.addEventListener('click', () => {
        const lockedBands = [...state.clockMod.lockedBands];
        lockedBands[index] = !lockedBands[index];
        commitClockModState({ lockedBands });
      });
      return button;
    }));
    clockModFrequencies?.replaceChildren(...BAND_DEFINITIONS.map(band => {
      const label = document.createElement('span');
      label.textContent = band.label.replace(' Hz', '').replace(' kHz', 'k');
      label.style.left = `${clockModFrequencyX(band.frequency) / 10}%`;
      return label;
    }));
    const boundaries = [0];
    for (let index = 0; index < BAND_DEFINITIONS.length - 1; index += 1) {
      boundaries.push((clockModFrequencyX(BAND_DEFINITIONS[index].frequency)
        + clockModFrequencyX(BAND_DEFINITIONS[index + 1].frequency)) / 2);
    }
    boundaries.push(1000);
    clockModLocks.style.gridTemplateColumns = Array.from({ length: BAND_COUNT }, (_, index) =>
      `${boundaries[index + 1] - boundaries[index]}fr`).join(' ');
  }
  [...clockModLocks.querySelectorAll('[data-clock-mod-lock]')].forEach((button, index) => {
    const locked = state.clockMod.lockedBands[index] === true;
    button.textContent = `${index + 1} ${locked ? 'LOCK' : '—'}`;
    button.setAttribute('aria-pressed', String(locked));
    button.classList.toggle('is-locked', locked);
  });
};
const renderClockModGraph = () => {
  if (!clockModGrid || !clockModLeftPath || !clockModRightPath || !clockModPoints) return;
  const { boost, cut } = getClockModBandLimits();
  const maximum = Math.max(.1, boost);
  const minimum = -Math.max(.1, cut);
  const yFor = value => 12 + (maximum - Math.min(maximum, Math.max(minimum, value))) / (maximum - minimum) * 206;
  if (clockModAxisBoost) clockModAxisBoost.textContent = `+${maximum} dB`;
  if (clockModAxisCut) clockModAxisCut.textContent = `${minimum} dB`;
  const gridValues = [maximum, maximum / 2, 0, minimum / 2, minimum];
  const svgNs = 'http://www.w3.org/2000/svg';
  clockModGrid.replaceChildren(...gridValues.map(value => {
    const line = document.createElementNS(svgNs, 'line');
    const y = yFor(value);
    line.setAttribute('x1', '0'); line.setAttribute('x2', '1000');
    line.setAttribute('y1', y.toFixed(2)); line.setAttribute('y2', y.toFixed(2));
    line.setAttribute('class', `clock-mod-grid-line${value === 0 ? ' is-zero' : ''}`);
    return line;
  }));
  const telemetry = clockModTelemetry;
  const heldLeft = Array.isArray(telemetry?.heldLeft) ? telemetry.heldLeft : [];
  const heldRight = Array.isArray(telemetry?.heldRight) ? telemetry.heldRight : [];
  const lockedBands = state.clockMod.lockedBands;
  const leftValues = Array.from({ length: BAND_COUNT }, (_, index) => Number.isFinite(heldLeft[index])
    ? lockedBands[index] ? state.clockMod.midpointDb : heldLeft[index] : state.clockMod.midpointDb);
  const rightValues = Array.from({ length: BAND_COUNT }, (_, index) => Number.isFinite(heldRight[index])
    ? lockedBands[index] ? state.clockMod.midpointDb : heldRight[index] : state.clockMod.midpointDb);
  const xValues = BAND_DEFINITIONS.map(band => clockModFrequencyX(band.frequency));
  clockModLeftPath.setAttribute('d', leftValues.map((value, index) =>
    `${index ? 'L' : 'M'}${xValues[index].toFixed(2)} ${yFor(value).toFixed(2)}`).join(' '));
  clockModRightPath.setAttribute('d', rightValues.map((value, index) =>
    `${index ? 'L' : 'M'}${xValues[index].toFixed(2)} ${yFor(value).toFixed(2)}`).join(' '));
  const highlightedBand = Number.isInteger(telemetry?.currentBand) ? telemetry.currentBand : 0;
  const bandLeft = highlightedBand === 0 ? 0 : (xValues[highlightedBand - 1] + xValues[highlightedBand]) / 2;
  const bandRight = highlightedBand === BAND_COUNT - 1 ? 1000 : (xValues[highlightedBand] + xValues[highlightedBand + 1]) / 2;
  if (clockModCurrentBand) {
    clockModCurrentBand.setAttribute('x', bandLeft.toFixed(2));
    clockModCurrentBand.setAttribute('width', (bandRight - bandLeft).toFixed(2));
    clockModCurrentBand.setAttribute('visibility', state.clockMod.enabled ? 'visible' : 'hidden');
  }
  const points = [];
  for (let index = 0; index < BAND_COUNT; index += 1) {
    for (const channel of ['left', 'right']) {
      const value = channel === 'left' ? leftValues[index] : rightValues[index];
      const y = yFor(value);
      const circle = document.createElementNS(svgNs, 'circle');
      circle.setAttribute('cx', xValues[index].toFixed(2)); circle.setAttribute('cy', y.toFixed(2));
      circle.setAttribute('r', channel === 'left' ? '5' : '3.5');
      circle.setAttribute('class', `clock-mod-point-${channel}`);
      const title = document.createElementNS(svgNs, 'title');
      title.textContent = `Band ${index + 1} · ${channel.toUpperCase()} ${value >= 0 ? '+' : ''}${value.toFixed(1)} dB${lockedBands[index] ? ' · LOCKED' : ''}`;
      circle.append(title); points.push(circle);
      const label = document.createElementNS(svgNs, 'text');
      label.setAttribute('x', xValues[index].toFixed(2));
      label.setAttribute('y', Math.min(222, Math.max(13, y + (channel === 'left' ? -8 : 14))).toFixed(2));
      label.setAttribute('class', 'clock-mod-point-label');
      label.textContent = `${channel === 'left' ? 'L' : 'R'} ${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
      points.push(label);
    }
  }
  clockModPoints.replaceChildren(...points);
  renderClockModLocks();
};
const renderClockModControls = () => {
  if (!clockModStatus) return;
  const config = state.clockMod;
  const telemetry = clockModTelemetry;
  const current = Number.isInteger(telemetry?.currentBand) ? telemetry.currentBand : 0;
  const last = Number.isInteger(telemetry?.lastTriggeredBand) ? telemetry.lastTriggeredBand : -1;
  clockModStatus.textContent = `${config.enabled ? 'MODULE ON' : 'MODULE OFF'} · ${last >= 0 ? `LAST ${last + 1} · ` : ''}NEXT ${current + 1}`;
  clockModStatus.classList.toggle('clock-mod-status-current', config.enabled);
  if (clockModPowerButton) {
    clockModPowerButton.setAttribute('aria-pressed', String(config.enabled));
    clockModPowerButton.setAttribute('aria-label', `CLOCK MOD ${config.enabled ? 'ausschalten' : 'einschalten'}`);
  }
  clockModWaveformButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.clockModWaveform === config.waveform)));
  clockModDirectionButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.clockModDirection === config.direction)));
  clockModSourceButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.clockModSource === config.clockSource)));
  if (clockModFrequencyInput) clockModFrequencyInput.value = String(rateToSlider(config.sourceFrequencyHz));
  if (clockModFrequencyOutput) clockModFrequencyOutput.textContent = `${config.sourceFrequencyHz < 1 ? config.sourceFrequencyHz.toFixed(2) : config.sourceFrequencyHz.toFixed(2)} Hz`;
  if (clockModGainInput) clockModGainInput.value = String(config.modulationGain);
  if (clockModGainOutput) clockModGainOutput.textContent = `${config.modulationGain} %`;
  const limits = getClockModBandLimits();
  if (clockModMidpointInput) {
    clockModMidpointInput.min = String(-limits.cut); clockModMidpointInput.max = String(limits.boost);
    clockModMidpointInput.value = String(Math.min(limits.boost, Math.max(-limits.cut, config.midpointDb)));
  }
  if (clockModMidpointOutput) clockModMidpointOutput.textContent = `${config.midpointDb >= 0 ? '+' : ''}${config.midpointDb.toFixed(1)} dB`;
  if (clockModBpmInput) {
    clockModBpmInput.value = String(config.internalBpm);
    clockModBpmInput.disabled = config.clockSource !== 'internal';
  }
  clockModBpmControl?.classList.toggle('is-inactive', config.clockSource !== 'internal');
  if (clockModMidiTempo) clockModMidiTempo.classList.toggle('is-inactive', config.clockSource !== 'midi');
  if (clockModScaleInput) { clockModScaleInput.value = config.clockScale; clockModScaleInput.disabled = config.clockSource !== 'midi'; }
  clockModScaleControl?.classList.toggle('is-inactive', config.clockSource !== 'midi');
  const bpm = Number.isFinite(midiDisplayBpm) ? midiDisplayBpm : Number.isFinite(telemetry?.midiBpm) ? telemetry.midiBpm : null;
  if (clockModMidiBpm) clockModMidiBpm.textContent = config.clockSource !== 'midi' || bpm === null ? '—' : `${bpm.toFixed(1)} BPM`;
  if (clockModRightInvertButton) {
    clockModRightInvertButton.textContent = `RIGHT INVERT ${config.rightInvert ? 'ON' : 'OFF'}`;
    clockModRightInvertButton.setAttribute('aria-pressed', String(config.rightInvert));
  }
  renderSourceAssignments('clock-mod', state.clockMod, document.querySelector('[data-clock-mod-assignments]'), true);
  renderClockModLocks();
  renderClockModGraph();
};
hooks.renderClockModControls = renderClockModControls;
clockModWaveformButtons.forEach(button => button.addEventListener('click', () => commitClockModState({ waveform: button.dataset.clockModWaveform })));
clockModDirectionButtons.forEach(button => button.addEventListener('click', () => commitClockModState({ direction: button.dataset.clockModDirection })));
clockModSourceButtons.forEach(button => button.addEventListener('click', () => commitClockModState({ clockSource: button.dataset.clockModSource })));
clockModFrequencyInput?.addEventListener('input', () => commitClockModState({ sourceFrequencyHz: sliderToRate(clockModFrequencyInput.value) }));
clockModGainInput?.addEventListener('input', () => commitClockModState({ modulationGain: Number(clockModGainInput.value) }));
clockModMidpointInput?.addEventListener('input', () => commitClockModState({ midpointDb: Number(clockModMidpointInput.value) }));
clockModBpmInput?.addEventListener('change', () => commitClockModState({ internalBpm: Number(clockModBpmInput.value) }));
clockModScaleInput?.addEventListener('change', () => commitClockModState({ clockScale: clockModScaleInput.value }));
clockModRightInvertButton?.addEventListener('click', () => commitClockModState({ rightInvert: !state.clockMod.rightInvert }));
clockModResetButton?.addEventListener('click', () => {
  audioEngine?.resetClockModProgression?.();
  clockModTelemetry = { ...(clockModTelemetry || {}), currentBand: 0, lastTriggeredBand: -1 };
  renderClockModControls();
});
bindAssignmentEditor('clock-mod', () => state.clockMod, () => commitClockModState({ assignments: state.clockMod.assignments }));
clockModPowerButton?.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  setClockModEnabled(!state.clockMod.enabled);
});

export {
  clockModTelemetry, renderClockModControls, setClockModTelemetry
};
