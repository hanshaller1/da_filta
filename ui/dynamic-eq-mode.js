// DYNAMIC EQ mode: band columns, parameter controls and the level/gain graph.
import { BAND_DEFINITIONS, state, audioEngine } from './app-context.js';
import { bandBoostSelect, bandCutSelect } from './dev-lab-controls.js';
import { renderMacroControls } from './macro-mode.js';

let dynamicEqTelemetry = null;
const setDynamicEqTelemetry = value => (dynamicEqTelemetry = value);
const dynamicEqPowerButton = document.querySelector('[data-module-power="dynamic-eq"]');
const dynamicEqColumns = document.querySelector('[data-dynamic-eq-columns]');
const dynamicEqLevelValues = document.querySelector('[data-dynamic-eq-level-values]');
const dynamicEqGainValues = document.querySelector('[data-dynamic-eq-gain-values]');
const dynamicEqOutValues = document.querySelector('[data-dynamic-eq-out-values]');
const dynamicEqBandDetail = document.querySelector('[data-dynamic-eq-band-detail]');
const dynamicEqXAxis = document.querySelector('[data-dynamic-eq-x-axis]');
const dynamicEqSensitivity = document.querySelector('[data-dynamic-eq-sensitivity]');
const dynamicEqProfileSvg = document.querySelector('[data-dynamic-eq-reference-profiles]');
const dynamicEqControls = document.querySelector('[data-dynamic-eq-controls]');
const dynamicEqGraphView = { input: true, reference: true, gain: true, out: true, state: true };
const dynamicEqGraphElement = document.querySelector('[data-dynamic-eq-graph]');
const dynamicEqDefinitions = [
  ['Threshold', 'dynamicEqThresholdDb', -60, 0, .5, 'dB'],
  ['Window', 'dynamicEqWindowDb', 0, 12, .5, 'dB'],
  ['Cut Range', 'dynamicEqCutRangeDb', 0, 12, .1, 'dB'],
  ['Boost Range', 'dynamicEqBoostRangeDb', 0, 12, .1, 'dB'],
  ['Strength', 'dynamicEqStrength', 0, 100, 1, '%'],
  ['Attack', 'dynamicEqAttackMs', 1, 500, 1, 'ms'],
  ['Release', 'dynamicEqReleaseMs', 10, 2000, 1, 'ms']
];
const dynamicEqBars = [];
const dynamicEqSensitivityInputs = [];
const clampUnit = value => Math.max(0, Math.min(1, value));
const levelDbFsToY = db => clampUnit((db + 60) / 60);
const levelPosition = db => levelDbFsToY(db) * 100;
const gainDbToY = (db, rangeDb) => 0.5 + 0.5 * Math.max(-1, Math.min(1, db / rangeDb));
const hasValidLearnedReference = () => state.learnedReferenceValid === true
  && Array.isArray(state.learnedReferenceDb)
  && state.learnedReferenceDb.length === BAND_DEFINITIONS.length
  && state.learnedReferenceDb.every(Number.isFinite);
const getAppliedGainRanges = () => {
  const boost = Number(audioEngine?.maxBandBoostDb ?? bandBoostSelect?.value ?? 12);
  const cut = Number(audioEngine?.maxBandCutDb ?? bandCutSelect?.value ?? 12);
  return {
    boost: Number.isFinite(boost) && boost > 0 ? boost : 12,
    cut: Number.isFinite(cut) && cut > 0 ? cut : 12
  };
};
const formatDynamicGain = db => `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
BAND_DEFINITIONS.forEach((band, index) => {
  const column = document.createElement('div');
  column.className = 'dynamic-eq-column';
  column.tabIndex = 0;
  column.setAttribute('role', 'group');
  column.innerHTML = '<i class="dynamic-eq-level dynamic-eq-input-left"></i><i class="dynamic-eq-level dynamic-eq-input-right"></i><i class="dynamic-eq-gain dynamic-eq-gain-left"></i><i class="dynamic-eq-gain dynamic-eq-gain-right"></i><i class="dynamic-eq-out dynamic-eq-out-left"></i><i class="dynamic-eq-out dynamic-eq-out-right"></i><i class="dynamic-eq-reference-mark dynamic-eq-reference-left"></i><i class="dynamic-eq-reference-mark dynamic-eq-reference-right"></i><i class="dynamic-eq-reference-mark dynamic-eq-reference-profile"></i>';
  dynamicEqColumns.append(column);
  dynamicEqBars.push(column);
  const showBandDetail = () => {
    dynamicEqColumns.querySelectorAll('.dynamic-eq-column.is-active').forEach(active => active.classList.remove('is-active'));
    column.classList.add('is-active');
    dynamicEqBandDetail.style.setProperty('--detail-band-center', `${((index + .5) / BAND_DEFINITIONS.length) * 100}%`);
    dynamicEqBandDetail.textContent = column.dataset.details || `${band.label}\nTelemetry unavailable`;
    dynamicEqBandDetail.hidden = false;
  };
  column.addEventListener('pointerenter', showBandDetail);
  column.addEventListener('pointerleave', () => { if (document.activeElement !== column && !column.classList.contains('is-pinned')) { dynamicEqBandDetail.hidden = true; column.classList.remove('is-active'); } });
  column.addEventListener('focus', showBandDetail);
  column.addEventListener('blur', () => { if (!column.classList.contains('is-pinned')) { dynamicEqBandDetail.hidden = true; column.classList.remove('is-active'); } });
  column.addEventListener('click', event => {
    event.stopPropagation();
    const pin = !column.classList.contains('is-pinned');
    dynamicEqColumns.querySelectorAll('.dynamic-eq-column.is-pinned').forEach(pinned => pinned.classList.remove('is-pinned'));
    column.classList.toggle('is-pinned', pin);
    if (pin) showBandDetail();
    else if (event.pointerType === 'touch' || document.activeElement !== column) {
      dynamicEqBandDetail.hidden = true;
      column.classList.remove('is-active');
      if (document.activeElement === column) column.blur();
    }
  });
  const levelValue = document.createElement('output');
  levelValue.className = 'dynamic-eq-level-value';
  levelValue.textContent = '−120';
  dynamicEqLevelValues.append(levelValue);
  const gainValue = document.createElement('output');
  gainValue.className = 'dynamic-eq-gain-value';
  gainValue.textContent = '+0.0 dB';
  dynamicEqGainValues.append(gainValue);
  const outValue = document.createElement('output');
  outValue.className = 'dynamic-eq-out-value';
  outValue.textContent = '—';
  dynamicEqOutValues.append(outValue);
  const frequency = document.createElement('span');
  frequency.className = 'dynamic-eq-frequency';
  frequency.textContent = band.label.replace(' Hz', '').replace(' kHz', 'k');
  dynamicEqXAxis.append(frequency);
  const label = document.createElement('label');
  label.className = 'dynamic-eq-sensitivity-item';
  label.innerHTML = '<input class="filter-style-slider" type="range" min="0" max="100" step="1"><output>100</output>';
  const input = label.querySelector('input');
  input.setAttribute('aria-label', `${band.label} sensitivity`);
  input.addEventListener('input', () => {
    state.dynamicEqBandSensitivity[index] = Number(input.value);
    label.querySelector('output').textContent = input.value;
    audioEngine?.setDynamicEq(state);
  });
  dynamicEqSensitivity.append(label);
  dynamicEqSensitivityInputs.push(input);
});
dynamicEqDefinitions.forEach(([label, field, min, max, step, unit]) => {
  const control = document.createElement('label');
  control.className = 'dynamic-eq-control filter-parameter-control';
  control.innerHTML = `<span>${label.toUpperCase()}</span><output></output><input class="filter-style-slider" type="range" min="${min}" max="${max}" step="${step}" aria-label="${label}">`;
  const input = control.querySelector('input');
  input.addEventListener('input', () => {
    state[field] = Number(input.value);
    control.querySelector('output').textContent = `${input.value} ${unit}`;
    audioEngine?.setDynamicEq(state);
    renderDynamicEqGraph();
  });
  dynamicEqControls.append(control);
});
const renderDynamicEqGraph = () => {
  Object.entries(dynamicEqGraphView).forEach(([layer, visible]) => {
    dynamicEqGraphElement.dataset[`show${layer[0].toUpperCase()}${layer.slice(1)}`] = String(visible);
  });
  dynamicEqGraphElement.closest('.dynamic-eq-response').dataset.showState = String(dynamicEqGraphView.state);
  const relativeMode = state.detectorReferenceMode === 'REL';
  const learnedProfileValid = hasValidLearnedReference();
  const threshold = relativeMode ? 0 : state.dynamicEqThresholdDb;
  const upper = threshold + state.dynamicEqWindowDb / 2;
  const lower = threshold - state.dynamicEqWindowDb / 2;
  const zone = document.querySelector('[data-dynamic-eq-window-zone]');
  zone.style.top = `${100 - levelPosition(upper)}%`;
  zone.style.bottom = `${levelPosition(lower)}%`;
  [['upper', threshold + state.dynamicEqWindowDb / 2], ['threshold', threshold], ['lower', threshold - state.dynamicEqWindowDb / 2]].forEach(([name, db]) => {
    const guide = document.querySelector(`[data-dynamic-eq-${name}]`);
    guide.style.bottom = `${levelPosition(db)}%`;
    guide.title = `${name.toUpperCase()} ${db.toFixed(1)} dBFS`;
    guide.querySelector('span').textContent = `${name.toUpperCase()} ${db.toFixed(1)}`;
    guide.classList.toggle('is-above-range', db >= 0);
  });
  const appliedGainRanges = getAppliedGainRanges();
  const gainAxisRange = Math.max(1, Number(state.dynamicEqCutRangeDb) || 0, Number(state.dynamicEqBoostRangeDb) || 0,
    appliedGainRanges.cut, appliedGainRanges.boost);
  const formatGainTick = value => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(gainAxisRange % 1 ? 1 : 0)} dB`;
  document.querySelector('[data-dynamic-eq-gain-scale]').textContent = `GAIN / OUT · SHARED SCALE ±${gainAxisRange.toFixed(gainAxisRange % 1 ? 1 : 0)} dB`;
  document.querySelector('[data-dynamic-eq-out-scale]').textContent = 'OUT · APPLIED GAIN L/R';
  document.querySelector('[data-dynamic-eq-gain-scale-positive]').textContent = formatGainTick(gainAxisRange);
  document.querySelector('[data-dynamic-eq-gain-scale-mid-positive]').textContent = formatGainTick(gainAxisRange / 2);
  document.querySelector('[data-dynamic-eq-gain-scale-mid-negative]').textContent = formatGainTick(-gainAxisRange / 2);
  document.querySelector('[data-dynamic-eq-gain-scale-negative]').textContent = formatGainTick(-gainAxisRange);
  dynamicEqBars.forEach((column, index) => {
    const level = dynamicEqTelemetry?.levels?.[index] ?? -120;
    const levelAvailable = Number.isFinite(dynamicEqTelemetry?.levels?.[index]);
    const gain = state.dynamicEqEnabled ? (dynamicEqTelemetry?.gains?.[index] ?? 0) : 0;
    const dual = state.stereoDetectorMode === 'DUAL';
    const leftLevel = dynamicEqTelemetry?.leftLevels?.[index] ?? level;
    const rightLevel = dynamicEqTelemetry?.rightLevels?.[index] ?? level;
    const leftGain = state.dynamicEqEnabled ? (dynamicEqTelemetry?.leftGains?.[index] ?? gain) : 0;
    const rightGain = state.dynamicEqEnabled ? (dynamicEqTelemetry?.rightGains?.[index] ?? gain) : 0;
    const leftOut = dynamicEqTelemetry?.leftAppliedBandGainDb?.[index];
    const rightOut = dynamicEqTelemetry?.rightAppliedBandGainDb?.[index];
    const setLevel = (selector, value) => { column.querySelector(selector).style.height = `${levelPosition(value)}%`; };
    const setGain = (selector, value) => {
      const bar = column.querySelector(selector);
      if (!Number.isFinite(value)) { bar.style.height = '0%'; return; }
      const position = gainDbToY(value, gainAxisRange);
      bar.style.height = `${Math.abs(position - 0.5) * 100}%`;
      bar.style.bottom = `${Math.min(position, 0.5) * 100}%`;
      bar.classList.toggle('is-cut', value < 0);
    };
    setLevel('.dynamic-eq-input-left', dual ? leftLevel : level);
    setLevel('.dynamic-eq-input-right', rightLevel);
    setGain('.dynamic-eq-gain-left', dual ? leftGain : gain);
    setGain('.dynamic-eq-gain-right', rightGain);
    const setOut = (selector, value) => {
      const bar = column.querySelector(selector);
      if (!Number.isFinite(value)) { bar.style.height = '0%'; return; }
      const position = gainDbToY(value, gainAxisRange);
      bar.style.height = `${Math.abs(position - 0.5) * 100}%`;
      bar.style.bottom = `${Math.min(position, 0.5) * 100}%`;
      bar.classList.toggle('is-cut', value < 0);
    };
    setOut('.dynamic-eq-out-left', leftOut);
    setOut('.dynamic-eq-out-right', rightOut);
    column.dataset.stereoMode = dual ? 'DUAL' : 'LINKED';
    dynamicEqLevelValues.children[index].textContent = dual
      ? `L ${leftLevel.toFixed(0)} / R ${rightLevel.toFixed(0)}` : level.toFixed(0);
    dynamicEqGainValues.children[index].textContent = dual
      ? `L ${formatDynamicGain(leftGain)} / R ${formatDynamicGain(rightGain)}` : formatDynamicGain(gain);
    dynamicEqOutValues.children[index].textContent = Number.isFinite(leftOut) && Number.isFinite(rightOut)
      ? `L ${formatDynamicGain(leftOut)} / R ${formatDynamicGain(rightOut)}`
      : '—';
    column.querySelector('.dynamic-eq-out-left').title = Number.isFinite(leftOut) ? `L APPLIED BAND GAIN ${formatDynamicGain(leftOut)}` : 'L APPLIED BAND GAIN unavailable';
    column.querySelector('.dynamic-eq-out-right').title = Number.isFinite(rightOut) ? `R APPLIED BAND GAIN ${formatDynamicGain(rightOut)}` : 'R APPLIED BAND GAIN unavailable';
    const profileValid = learnedProfileValid;
    const referenceValues = dual
      ? [dynamicEqTelemetry?.leftRelativeReferences?.[index], dynamicEqTelemetry?.rightRelativeReferences?.[index]]
      : [dynamicEqTelemetry?.relativeReferences?.[index]];
    const profileMark = column.querySelector('.dynamic-eq-reference-profile');
    profileMark.hidden = !relativeMode || !profileValid || !Number.isFinite(state.learnedReferenceDb?.[index]);
    if (relativeMode && profileValid && Number.isFinite(state.learnedReferenceDb[index])) {
      profileMark.style.bottom = `${levelPosition(state.learnedReferenceDb[index])}%`;
      profileMark.title = `LEARNED ${state.learnedReferenceDb[index].toFixed(1)} dBFS`;
    }
    ['left', 'right'].forEach((channel, markerIndex) => {
      const marker = column.querySelector(`.dynamic-eq-reference-${channel}`);
      const showLocal = relativeMode && !profileValid && Number.isFinite(referenceValues[markerIndex]);
      marker.hidden = !showLocal;
      if (showLocal) {
        marker.style.bottom = `${levelPosition(referenceValues[markerIndex])}%`;
        marker.title = `${channel.toUpperCase()} LOCAL REF ${referenceValues[markerIndex].toFixed(1)} dBFS`;
      }
    });
    const detailLines = [BAND_DEFINITIONS[index].label];
    if (dynamicEqGraphView.input && levelAvailable) {
      if (dual) {
        const leftAvailable = Number.isFinite(dynamicEqTelemetry?.leftLevels?.[index]);
        const rightAvailable = Number.isFinite(dynamicEqTelemetry?.rightLevels?.[index]);
        if (leftAvailable && rightAvailable) detailLines.push(`INPUT  L ${leftLevel.toFixed(1)} dBFS  ·  R ${rightLevel.toFixed(1)} dBFS`);
        else {
          if (leftAvailable) detailLines.push(`INPUT  L ${leftLevel.toFixed(1)} dBFS`);
          if (rightAvailable) detailLines.push(`INPUT  R ${rightLevel.toFixed(1)} dBFS`);
        }
      } else detailLines.push(`INPUT  ${level.toFixed(1)} dBFS`);
    }
    if (dynamicEqGraphView.reference) {
      if (relativeMode && profileValid && Number.isFinite(state.learnedReferenceDb[index])) {
        detailLines.push(`REF  LEARNED ${state.learnedReferenceDb[index].toFixed(1)} dBFS`);
      }
      if (relativeMode && !(profileValid && Number.isFinite(state.learnedReferenceDb[index])) && dual && referenceValues.every(Number.isFinite)) {
        detailLines.push(`REF  L ${referenceValues[0].toFixed(1)}  ·  R ${referenceValues[1].toFixed(1)} dBFS`);
      } else if (relativeMode && !(profileValid && Number.isFinite(state.learnedReferenceDb[index])) && Number.isFinite(referenceValues[0])) {
        detailLines.push(`REF  ${referenceValues[0].toFixed(1)} dBFS`);
      } else if (!relativeMode) {
        detailLines.push(`REF  THRESHOLD ${state.dynamicEqThresholdDb.toFixed(1)} dBFS`);
        detailLines.push(`WINDOW  ${lower.toFixed(1)} to ${upper.toFixed(1)} dBFS`);
      }
    }
    if (dynamicEqGraphView.gain && state.dynamicEqEnabled) {
      if (dual) {
        const leftAvailable = Number.isFinite(dynamicEqTelemetry?.leftGains?.[index]);
        const rightAvailable = Number.isFinite(dynamicEqTelemetry?.rightGains?.[index]);
        if (leftAvailable && rightAvailable) detailLines.push(`DYNAMIC GAIN  L ${formatDynamicGain(leftGain)}  ·  R ${formatDynamicGain(rightGain)}`);
        else {
          if (leftAvailable) detailLines.push(`DYNAMIC GAIN  L ${formatDynamicGain(leftGain)}`);
          if (rightAvailable) detailLines.push(`DYNAMIC GAIN  R ${formatDynamicGain(rightGain)}`);
        }
      } else if (Number.isFinite(dynamicEqTelemetry?.gains?.[index])) detailLines.push(`DYNAMIC GAIN  ${formatDynamicGain(gain)}`);
    }
    if (dynamicEqGraphView.out) {
      if (Number.isFinite(leftOut) && Number.isFinite(rightOut)) detailLines.push(`APPLIED GAIN  L ${formatDynamicGain(leftOut)}  ·  R ${formatDynamicGain(rightOut)}`);
      else {
        if (Number.isFinite(leftOut)) detailLines.push(`APPLIED GAIN  L ${formatDynamicGain(leftOut)}`);
        if (Number.isFinite(rightOut)) detailLines.push(`APPLIED GAIN  R ${formatDynamicGain(rightOut)}`);
      }
    }
    detailLines.push(`SENSITIVITY  ${state.dynamicEqBandSensitivity[index]} %`);
    column.dataset.details = detailLines.join('\n');
    if (column.classList.contains('is-active') && !dynamicEqBandDetail.hidden) dynamicEqBandDetail.textContent = column.dataset.details;
    column.setAttribute('aria-label', `${BAND_DEFINITIONS[index].label} band details`);
    column.title = `${BAND_DEFINITIONS[index].label}: ${dual
      ? `L ${leftLevel.toFixed(1)} dBFS, R ${rightLevel.toFixed(1)} dBFS; L ${formatDynamicGain(leftGain)}, R ${formatDynamicGain(rightGain)}`
      : `${level.toFixed(1)} dBFS · ${formatDynamicGain(gain)}`}`;
  });
  const profilePoints = values => values.map((value, index) => Number.isFinite(value)
    ? `${(index + .5) * (1000 / BAND_DEFINITIONS.length)},${1000 - levelPosition(value) * 10}` : null);
  const setProfile = (selector, values, visible) => {
    const points = profilePoints(values);
    const polyline = dynamicEqProfileSvg.querySelector(selector);
    polyline.setAttribute('points', points.filter(Boolean).join(' '));
    if (!visible || points.filter(Boolean).length < 2) polyline.setAttribute('hidden', '');
    else polyline.removeAttribute('hidden');
  };
  const validProfile = learnedProfileValid;
  setProfile('.dynamic-eq-profile-learned', state.learnedReferenceDb || [], dynamicEqGraphView.reference && relativeMode && validProfile);
  setProfile('.dynamic-eq-profile-relative-left', state.stereoDetectorMode === 'DUAL'
    ? (dynamicEqTelemetry?.leftRelativeReferences || []) : (dynamicEqTelemetry?.relativeReferences || []),
  dynamicEqGraphView.reference && relativeMode && !(validProfile && Array.isArray(state.learnedReferenceDb)));
  setProfile('.dynamic-eq-profile-relative-right', dynamicEqTelemetry?.rightRelativeReferences || [], dynamicEqGraphView.reference && relativeMode && !(validProfile && Array.isArray(state.learnedReferenceDb)) && state.stereoDetectorMode === 'DUAL');
};
document.addEventListener('click', event => {
  if (event.target.closest('[data-dynamic-eq-columns]')) return;
  dynamicEqColumns.querySelectorAll('.dynamic-eq-column.is-pinned').forEach(column => column.classList.remove('is-pinned'));
  dynamicEqColumns.querySelectorAll('.dynamic-eq-column.is-active').forEach(column => column.classList.remove('is-active'));
  if (document.activeElement?.classList.contains('dynamic-eq-column')) document.activeElement.blur();
  dynamicEqBandDetail.hidden = true;
});
const renderDynamicEqControls = () => {
  dynamicEqPowerButton?.setAttribute('aria-pressed', String(state.dynamicEqEnabled));
  dynamicEqPowerButton?.setAttribute('aria-label', state.dynamicEqEnabled ? 'DYNAMIC EQ ausschalten' : 'DYNAMIC EQ einschalten');
  document.querySelectorAll('[data-dynamic-eq-mode]').forEach(button => {
    const active = button.dataset.dynamicEqMode === state.dynamicEqMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-dynamic-eq-detector]').forEach(button => {
    const active = button.dataset.dynamicEqDetector === state.dynamicEqDetectorMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-dynamic-eq-reference]').forEach(button => {
    const active = button.dataset.dynamicEqReference === state.detectorReferenceMode;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-dynamic-eq-stereo]').forEach(button => {
    const active = button.dataset.dynamicEqStereo === state.stereoDetectorMode;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  const profileStatus = document.querySelector('[data-dynamic-eq-learn-status]');
  if (profileStatus) profileStatus.textContent = dynamicEqTelemetry?.learnProgress > 0
    ? `LEARNING ${Math.round(dynamicEqTelemetry.learnProgress * 100)} %`
    : hasValidLearnedReference() ? (state.learnedReferenceFrozen ? 'FROZEN PROFILE' : 'PROFILE LIVE') : 'NO PROFILE';
  const freezeButton = document.querySelector('[data-dynamic-eq-freeze]');
  freezeButton?.classList.toggle('active', hasValidLearnedReference() && state.learnedReferenceFrozen);
  freezeButton?.setAttribute('aria-pressed', String(hasValidLearnedReference() && state.learnedReferenceFrozen));
  if (freezeButton) freezeButton.disabled = !hasValidLearnedReference();
  const statusParts = [`DYNAMIC EQ ${state.dynamicEqEnabled ? 'ON' : 'OFF'}`, state.dynamicEqMode.toUpperCase(), state.detectorReferenceMode,
    state.dynamicEqDetectorMode.toUpperCase(), state.stereoDetectorMode, 'PRE', state.perChannelBands ? 'P/CH' : 'CLASSIC'];
  if (!state.perChannelBands && Math.abs(Number(state.spread) || 0) >= 0.05) {
    statusParts.push(`SPREAD ${state.spread >= 0 ? '+' : ''}${Number(state.spread).toFixed(1)} dB`);
  }
  if (dynamicEqTelemetry?.learnProgress > 0) statusParts.push('LEARNING');
  else if (hasValidLearnedReference()) statusParts.push(state.learnedReferenceFrozen ? 'FROZEN' : 'LIVE');
  document.querySelector('[data-dynamic-eq-status]').textContent = statusParts.join(' | ');
  dynamicEqDefinitions.forEach(([, field, , , , unit], index) => {
    const control = dynamicEqControls.children[index];
    control.querySelector('input').value = state[field];
    control.querySelector('output').textContent = `${state[field]} ${unit}`;
  });
  dynamicEqSensitivityInputs.forEach((input, index) => {
    input.value = state.dynamicEqBandSensitivity[index];
    input.nextElementSibling.textContent = input.value;
  });
  renderDynamicEqGraph();
};
dynamicEqPowerButton?.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  if (event.detail === 0) return;
  state.dynamicEqEnabled = !state.dynamicEqEnabled;
  if (!state.dynamicEqEnabled) dynamicEqTelemetry = null;
  audioEngine?.setDynamicEq(state);
  renderDynamicEqControls();
  if (state.selectedWorkspaceMode === 'presets') renderMacroControls();
});
document.querySelectorAll('[data-dynamic-eq-mode]').forEach(button => button.addEventListener('click', () => {
  state.dynamicEqMode = button.dataset.dynamicEqMode;
  audioEngine?.setDynamicEq(state);
  renderDynamicEqControls();
}));
document.querySelectorAll('[data-dynamic-eq-detector]').forEach(button => button.addEventListener('click', () => {
  state.dynamicEqDetectorMode = button.dataset.dynamicEqDetector;
  audioEngine?.setDynamicEq(state);
  renderDynamicEqControls();
}));
document.querySelectorAll('[data-dynamic-eq-view]').forEach(button => button.addEventListener('click', () => {
  const layer = button.dataset.dynamicEqView;
  dynamicEqGraphView[layer] = !dynamicEqGraphView[layer];
  button.classList.toggle('active', dynamicEqGraphView[layer]);
  button.setAttribute('aria-pressed', String(dynamicEqGraphView[layer]));
  renderDynamicEqGraph();
}));
document.querySelectorAll('[data-dynamic-eq-reference]').forEach(button => button.addEventListener('click', () => {
  state.detectorReferenceMode = button.dataset.dynamicEqReference; audioEngine?.setDynamicEq(state); renderDynamicEqControls();
}));
document.querySelectorAll('[data-dynamic-eq-stereo]').forEach(button => button.addEventListener('click', () => {
  state.stereoDetectorMode = button.dataset.dynamicEqStereo; audioEngine?.setDynamicEq(state); renderDynamicEqControls();
}));
document.querySelector('[data-dynamic-eq-learn]')?.addEventListener('click', () => { audioEngine?.learnDynamicEq(); });
document.querySelector('[data-dynamic-eq-freeze]')?.addEventListener('click', () => {
  if (!hasValidLearnedReference()) return;
  audioEngine?.setDynamicEqFrozen(!state.learnedReferenceFrozen);
});
document.querySelector('[data-dynamic-eq-reset]')?.addEventListener('click', () => {
  state.dynamicEqBandSensitivity.fill(100);
  audioEngine?.setDynamicEq(state);
  renderDynamicEqControls();
});
renderDynamicEqControls();

export {
  renderDynamicEqControls, setDynamicEqTelemetry
};
