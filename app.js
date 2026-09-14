const {
  BAND_DEFINITIONS,
  BAND_COUNT,
  BAND_GAIN_MIN,
  BAND_GAIN_MAX,
  BAND_GAIN_NEUTRAL,
  GLOBAL_CONTROL_DEFINITIONS,
  createInitialState,
  setBandBaseGain: setStateBandBaseGain
} = window.ResonantState;
const state = createInitialState();
let audioEngine = null;
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
  group.innerHTML = `<h2>${label}</h2>`;
  devLabControls?.append(group);
  devLabGroups.set(value, group);
});
const groupForDevControl = control => {
  const attribute = control.querySelector('select')?.getAttributeNames().find(name => name.startsWith('data-')) ?? '';
  if (attribute === 'data-input-preamp-stage') return 'input';
  if (attribute === 'data-reference-level' || attribute === 'data-band-boost-db' || attribute === 'data-band-cut-db' || attribute === 'data-wet-model') return 'filterbank';
  if (attribute === 'data-feedback-all-engine' || attribute === 'data-feedback-all-source' || attribute === 'data-feedback-all-level') return 'main';
  return 'resonator';
};
const inlineDevLabControls = document.querySelector('.analyzer-header .dev-lab-controls');
inlineDevLabControls?.querySelectorAll(':scope > .dev-audition-control, :scope > .dev-lab-control').forEach(control => {
  devLabGroups.get(groupForDevControl(control))?.append(control);
});
inlineDevLabControls?.remove();
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
    'data-feedback-tap': 'local-feedback',
    'data-common-bus-saturation-mode': 'local-feedback',
    'data-common-bus-drive': 'local-feedback',
    'data-common-bus-ceiling': 'local-feedback',
    'data-feedback-all-engine': 'main',
    'data-feedback-all-source': 'main',
    'data-feedback-all-level': 'main'
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
const feedbackTopologySelect = addDevLabSelector('DEV FB TOPOLOGY', 'data-feedback-topology', [['isolated-tpt', 'ISOLATED TPT'], ['common-bus', 'COMMON BUS']]);
const feedbackTapSelect = addDevLabSelector('DEV FB TAP', 'data-feedback-tap', [['pre-gain', 'PRE GAIN'], ['post-gain', 'POST GAIN']]);
const wetModelSelect = addDevLabSelector('DEV WET MODEL', 'data-wet-model', [['reference-delta', 'REFERENCE + DELTA'], ['filterbank-sum', 'FILTERBANK SUM']]);
const commonBusSatSelect = addDevLabSelector('DEV FB SAT', 'data-common-bus-saturation-mode', [['current', 'CURRENT'], ['constant-ceiling', 'CONSTANT CEILING']]);
const commonBusDriveSelect = addDevLabSelector('DEV FB DRIVE', 'data-common-bus-drive', [['0.5', '0.5'], ['1', '1'], ['2', '2'], ['4', '4'], ['8', '8'], ['16', '16']]);
const commonBusCeilingSelect = addDevLabSelector('DEV FB CEILING', 'data-common-bus-ceiling', [['0.25', '0.25'], ['0.5', '0.50'], ['1', '1.00'], ['2', '2.00'], ['4', '4.00']]);
const feedbackAllEngineSelect = addDevLabSelector('DEV FB ALL ENGINE', 'data-feedback-all-engine', [['legacy', 'LEGACY'], ['common-bus', 'COMMON BUS']]);
const feedbackAllSourceSelect = addDevLabSelector('DEV FB ALL SOURCE', 'data-feedback-all-source', [['pre-gain-sum', 'PRE GAIN SUM'], ['post-gain-sum', 'POST GAIN SUM']]);
if (feedbackAllSourceSelect) feedbackAllSourceSelect.value = 'post-gain-sum';
const feedbackAllLevelSelect = addDevLabSelector('DEV FB ALL LEVEL', 'data-feedback-all-level', [
  ['raw', 'RAW'],
  ['sqrt10', '1 / SQRT(10)'],
  ['tenth', '1 / 10'],
  ['twentieth', '1 / 20'],
  ['fortieth', '1 / 40'],
  ['eightieth', '1 / 80']
]);
const inputPreampStageSelect = addDevLabSelector('DEV INPUT STAGE', 'data-input-preamp-stage', [['linear', 'LINEAR'], ['preamp', 'PREAMP']]);
const THEME_STORAGE_KEY = 'resonant-filterbank-theme';
const THEME_VALUES = ['current', 'clean-modern', 'dark-studio', 'analog-inspired', 'minimal-dark', 'soft-neutral', 'pro-console'];
const themeSelect = document.querySelector('[data-theme-select]');
const readStoredTheme = () => {
  try { return window.localStorage.getItem(THEME_STORAGE_KEY); } catch { return null; }
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
bands.innerHTML = BAND_DEFINITIONS.map((band,index) => `<article class="band-card"><div class="band-title">BAND ${index+1}</div><div class="band-actions"><button class="band-action" type="button" data-feedback-band="${index}">FB</button><button class="band-action" type="button" data-mod-band="${index}">MOD</button></div><div class="fader-wrap"><span class="fader-label positive">+</span><div class="fader-track"><input class="band-fader" type="range" min="${BAND_GAIN_MIN}" max="${BAND_GAIN_MAX}" value="${BAND_GAIN_NEUTRAL}" data-band="${index}" aria-label="${band.label} Fader"></div><span class="fader-label negative">−</span></div><div class="band-value">${band.label}</div></article>`).join('');
const formatValue = (name,value) => { if(name==='dryWet') return `${Math.round(value)} %`; if(name==='inputGain'||name==='volume') return `${Number(value).toFixed(1)} dB`; return Number(value).toFixed(2).replace(/\.00$/,'0'); };

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
const renderBand = index => {
  const slider = faders[index];
  slider.value = String(state.bandGainLeft[index]);
  updateAnalyzerBand(index);
};
const setBandBaseGain = (channel, index, value) => {
  const channels = state.channelSelection === 'LR' ? ['left', 'right'] : [channel];
  channels.forEach(targetChannel => {
    const nextValue = setStateBandBaseGain(state, targetChannel, index, value);
    audioEngine?.setBandBaseGain(targetChannel, index, nextValue);
  });
  renderBand(index);
};
const setBandFeedback = (channel, index, enabled) => {
  const channels = state.channelSelection === 'LR' ? ['left', 'right'] : [channel];
  channels.forEach(targetChannel => {
    const target = targetChannel === 'left' ? state.feedbackBandLeft : state.feedbackBandRight;
    target[index] = Boolean(enabled);
    audioEngine?.setBandFeedback(targetChannel, index, target[index]);
  });
};
const setFeedbackAll = (channel, enabled) => {
  const channels = state.channelSelection === 'LR' ? ['left', 'right'] : [channel];
  channels.forEach(targetChannel => {
    if (targetChannel === 'left') state.feedbackAllLeft = Boolean(enabled);
    else state.feedbackAllRight = Boolean(enabled);
    audioEngine?.setFeedbackAll(targetChannel, enabled);
  });
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
const isEditableTarget = target => target instanceof HTMLElement && ((target.matches('input, textarea, select') && !target.matches('input[type="range"]')) || target.isContentEditable);
document.addEventListener('keydown', event => {
  if (isEditableTarget(event.target)) return;
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
const startAudioButton = document.querySelector('[data-audio-start]');
const stopAudioButton = document.querySelector('[data-audio-stop]');
const audioStatus = document.querySelector('[data-audio-status]');
const audioMessage = document.querySelector('[data-audio-message]');
const renderDevices = (select, devices, emptyLabel) => {
  const selectedValue = select.value;
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
  if ([...select.options].some(option => option.value === selectedValue)) select.value = selectedValue;
};
const updateAudioStatus = (status, message = '') => {
  state.audioStatus = status;
  state.audioError = message;
  audioStatus.textContent = status;
  audioMessage.textContent = message;
  audioStatus.dataset.status = status;
  startAudioButton.disabled = status === 'STARTING' || status === 'ON';
  stopAudioButton.disabled = status !== 'ON';
};
audioEngine = new AudioEngine({
  onStatusChange: updateAudioStatus,
  onDevicesChanged: devices => { renderDevices(inputDeviceSelect, devices.inputs, 'Kein Input-Gerät'); renderDevices(outputDeviceSelect, devices.outputs, 'Standardausgabe'); }
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
  apply(select.value ?? fallback);
  select.addEventListener('change', event => apply(event.target.value));
};
bindDevLabSelect(referenceLevelSelect, value => audioEngine.setReferenceLevel(value), '1');
bindDevLabSelect(resonanceEngineSelect, value => audioEngine.setPositiveResonanceEngine(value), 'tpt');
bindDevLabSelect(bandBoostSelect, value => audioEngine.setBandBoostDb(value), '12');
bindDevLabSelect(bandCutSelect, value => audioEngine.setBandCutDb(value), '12');
bindDevLabSelect(feedbackTopologySelect, value => audioEngine.setFeedbackTopology(value), 'isolated-tpt');
bindDevLabSelect(feedbackTapSelect, value => audioEngine.setFeedbackTap(value), 'pre-gain');
bindDevLabSelect(wetModelSelect, value => audioEngine.setWetModel(value), 'reference-delta');
bindDevLabSelect(commonBusSatSelect, value => audioEngine.setCommonBusSaturationMode(value), 'current');
bindDevLabSelect(commonBusDriveSelect, value => audioEngine.setCommonBusDrive(value), '1');
bindDevLabSelect(commonBusCeilingSelect, value => audioEngine.setCommonBusCeiling(value), '1');
bindDevLabSelect(feedbackAllEngineSelect, value => audioEngine.setFeedbackAllEngine(value), 'legacy');
bindDevLabSelect(feedbackAllSourceSelect, value => audioEngine.setFeedbackAllSource(value), 'post-gain-sum');
bindDevLabSelect(feedbackAllLevelSelect, value => audioEngine.setFeedbackAllLevel(value), 'raw');
bindDevLabSelect(inputPreampStageSelect, value => audioEngine.setInputPreampStage(value), 'linear');
const syncAudioParameters = () => {
  audioEngine.setInputGainDb(state.inputGain);
  audioEngine.setDryWet(state.dryWet);
  audioEngine.setVolumeDb(state.volume);
};
document.querySelector('[data-control="inputGain"]').addEventListener('input', syncAudioParameters);
document.querySelector('[data-control="dryWet"]').addEventListener('input', syncAudioParameters);
document.querySelector('[data-control="volume"]').addEventListener('input', syncAudioParameters);
document.querySelector('[data-control="resonance"]').addEventListener('input', () => audioEngine.setResonance(state.resonance));
syncAudioParameters();
const refreshAudioDevices = async () => {
  try {
    const devices = await audioEngine.refreshDevices();
    renderDevices(inputDeviceSelect, devices.inputs, 'Kein Input-Gerät');
    renderDevices(outputDeviceSelect, devices.outputs, 'Standardausgabe');
  } catch (error) {
    audioMessage.textContent = error.message;
  }
};
startAudioButton.addEventListener('click', async () => {
  try {
    await audioEngine.start({ inputDeviceId: inputDeviceSelect.value, outputDeviceId: outputDeviceSelect.value });
  } catch (error) {
    audioMessage.textContent = audioEngine.getErrorMessage(error);
  }
});
stopAudioButton.addEventListener('click', () => audioEngine.stop());
updateAudioStatus('OFF');
refreshAudioDevices();
