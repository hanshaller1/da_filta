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
