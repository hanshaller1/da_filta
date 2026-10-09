// Band strips: faders, per-channel faders, spread centres and the band gain/feedback setters.
import {
  BAND_DEFINITIONS, BAND_COUNT, BAND_GAIN_MIN, BAND_GAIN_MAX, BAND_GAIN_NEUTRAL, controlToBandGainDb,
  bandGainDbToControl, bandGainDbToBipolarPercent, setStateBandBaseGain, state, audioEngine
} from './app-context.js';
import { devLabTelemetry } from './dev-lab-telemetry.js';
import { getBandBoostDb, getBandCutDb } from './band-gain-range.js';
import { refreshStatusStrip, scheduleAnalyzerRender, updateAnalyzerBand } from './band-analyzer.js';

const bands = document.querySelector('.bands');
bands.innerHTML = BAND_DEFINITIONS.map((band,index) => `<article class="band-card"><output class="band-slider-value" data-band-value="${index}">0.0 dB</output><div class="fader-wrap"><span class="fader-label positive">+</span><div class="fader-track"><i class="classic-channel-marker classic-channel-marker-left" data-classic-marker="${index}-left" aria-hidden="true"></i><i class="classic-channel-marker classic-channel-marker-right" data-classic-marker="${index}-right" aria-hidden="true"></i><div class="fader-hit-area"><input class="band-fader" type="range" min="${BAND_GAIN_MIN}" max="${BAND_GAIN_MAX}" step="0.1" value="${BAND_GAIN_NEUTRAL}" data-band="${index}" aria-label="${band.label} Fader"></div></div><span class="fader-label negative">−</span></div><div class="band-value">${band.label}</div></article>`).join('');
const filterbankBandControls = document.querySelector('.filterbank-band-controls');
if (filterbankBandControls) filterbankBandControls.innerHTML = BAND_DEFINITIONS.map((band, index) => `<div class="filterbank-band-control" data-filterbank-band-control="${index}" aria-label="${band.label} Filterbank Controls"><button class="band-action" type="button" data-feedback-band="${index}" aria-pressed="false" title="COMMON BUS: Dieses Band speist den gemeinsamen Feedback-Bus; sein Return regt alle zehn Bänder dieses Kanals an.">FB</button></div>`).join('');
document.querySelectorAll('[data-feedback-band]').forEach(button => button.classList.add('ui-role-toggle'));
document.querySelectorAll('.band-card').forEach((card, index) => {
  card.querySelector('.fader-wrap')?.classList.add('center-fader');
  const channelFader = channel => `<div class="channel-fader"><div class="fader-track"><div class="fader-hit-area"><input class="band-fader band-fader-channel" type="range" min="${BAND_GAIN_MIN}" max="${BAND_GAIN_MAX}" step="0.1" data-band="${index}" data-channel="${channel}" aria-label="${BAND_DEFINITIONS[index].label} ${channel === 'left' ? 'Left' : 'Right'}"></div></div><output data-band-channel-value="${index}-${channel}">0.0 dB</output></div>`;
  card.insertAdjacentHTML('beforeend', `<div class="channel-faders">${channelFader('left')}<button class="band-link-toggle" type="button" data-band-link="${index}" aria-label="${BAND_DEFINITIONS[index].label} L/R verketten" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"/><path d="M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 12 20l1.15-1.15"/></svg></button>${channelFader('right')}</div>`);
});
const formatValue = (name,value) => {
  if(name==='dryWet') return `${Math.round(value)} %`;
  if(name==='inputGain'||name==='volume'||name==='spread') return `${name === 'spread' && Number(value) > 0 ? '+' : ''}${Number(value).toFixed(1)} dB`;
  return Number(value).toFixed(2).replace(/\.?0+$/,'');
};
const faders = [...document.querySelectorAll('.center-fader .band-fader')];
const renderAnalyzerScale = () => {
  const boost = getBandBoostDb(); const cut = getBandCutDb();
  const boostLabel = document.querySelector('[data-axis-boost]');
  const cutLabel = document.querySelector('[data-axis-cut]');
  if (boostLabel) boostLabel.textContent = `+${boost} dB`;
  if (cutLabel) cutLabel.textContent = `−${cut} dB`;
};
const formatBandSliderValue = value => {
  const gainDb = controlToBandGainDb(value, getBandBoostDb(), getBandCutDb());
  const normalizedGainDb = Math.abs(gainDb) < 1e-9 ? 0 : gainDb;
  return `${normalizedGainDb > 0 ? '+' : ''}${normalizedGainDb.toFixed(1)} dB`;
};
const renderBandSliderValues = () => faders.forEach((_, index) => renderBand(index));
// SPREAD is an explicit writer to the authoritative L/R pair. Keep the
// pre-spread center stable across consecutive writes so channel clamping
// cannot move that center. Any non-SPREAD band edit invalidates the anchor.
const spreadCenterDb = Array(BAND_COUNT).fill(0);
const spreadCenterDirty = Array(BAND_COUNT).fill(true);
const invalidateSpreadCenter = index => { spreadCenterDirty[index] = true; };
const invalidateAllSpreadCenters = () => spreadCenterDirty.fill(true);
const getSpreadCenterDb = (index, boost, cut) => {
  if (spreadCenterDirty[index]) {
    const leftDb = controlToBandGainDb(state.bandGainLeft[index], boost, cut);
    const rightDb = controlToBandGainDb(state.bandGainRight[index], boost, cut);
    spreadCenterDb[index] = (leftDb + rightDb) / 2;
    spreadCenterDirty[index] = false;
  }
  return spreadCenterDb[index];
};
const renderBand = index => {
  const slider = faders[index];
  const leftDb = controlToBandGainDb(state.bandGainLeft[index], getBandBoostDb(), getBandCutDb());
  const rightDb = controlToBandGainDb(state.bandGainRight[index], getBandBoostDb(), getBandCutDb());
  slider.value = String(bandGainDbToControl((leftDb + rightDb) / 2, getBandBoostDb(), getBandCutDb()));
  const valueDisplay = document.querySelector(`[data-band-value="${index}"]`);
  if (valueDisplay) valueDisplay.textContent = `${((leftDb + rightDb) / 2 >= 0 ? '+' : '')}${((leftDb + rightDb) / 2).toFixed(1)} dB`;
  document.querySelectorAll(`.band-fader-channel[data-band="${index}"]`).forEach(input => {
    input.value = String(input.dataset.channel === 'left' ? state.bandGainLeft[index] : state.bandGainRight[index]);
  });
  const channelValue = channel => document.querySelector(`[data-band-channel-value="${index}-${channel}"]`);
  if (channelValue('left')) channelValue('left').textContent = formatBandSliderValue(state.bandGainLeft[index]);
  if (channelValue('right')) channelValue('right').textContent = formatBandSliderValue(state.bandGainRight[index]);
  [['left', leftDb], ['right', rightDb]].forEach(([channel, gainDb]) => {
    const marker = document.querySelector(`[data-classic-marker="${index}-${channel}"]`);
    if (marker) marker.style.bottom = `${(bandGainDbToBipolarPercent(gainDb, getBandBoostDb(), getBandCutDb()) + 100) / 2}%`;
  });
  const link = document.querySelector(`[data-band-link="${index}"]`);
  if (link) {
    link.classList.toggle('active', Boolean(state.bandChannelLinked[index]));
    link.setAttribute('aria-pressed', String(Boolean(state.bandChannelLinked[index])));
  }
  updateAnalyzerBand(index);
};
const setBandPairByDb = (index, sourceChannel, targetControl) => {
  const boost = getBandBoostDb(); const cut = getBandCutDb();
  const currentLeft = controlToBandGainDb(state.bandGainLeft[index], boost, cut);
  const currentRight = controlToBandGainDb(state.bandGainRight[index], boost, cut);
  const current = sourceChannel === 'right' ? currentRight : sourceChannel === 'center' ? (currentLeft + currentRight) / 2 : currentLeft;
  const desired = controlToBandGainDb(targetControl, boost, cut);
  let delta = desired - current;
  const minimum = Math.max(-cut - currentLeft, -cut - currentRight);
  const maximum = Math.min(boost - currentLeft, boost - currentRight);
  delta = Math.max(minimum, Math.min(maximum, delta));
  ['left', 'right'].forEach(channel => {
    const db = (channel === 'left' ? currentLeft : currentRight) + delta;
    const control = bandGainDbToControl(db, boost, cut);
    const next = setStateBandBaseGain(state, channel, index, control);
    audioEngine?.setBandBaseGain(channel, index, next);
  });
  invalidateSpreadCenter(index);
  renderBand(index); refreshStatusStrip();
};
const materializeSpreadDb = spreadDb => {
  const boost = getBandBoostDb(); const cut = getBandCutDb();
  const offsetDb = Number(spreadDb) || 0;
  for (let index = 0; index < BAND_COUNT; index += 1) {
    const centerDb = getSpreadCenterDb(index, boost, cut);
    const nextLeft = setStateBandBaseGain(state, 'left', index, bandGainDbToControl(centerDb - offsetDb, boost, cut));
    const nextRight = setStateBandBaseGain(state, 'right', index, bandGainDbToControl(centerDb + offsetDb, boost, cut));
    audioEngine?.setBandBaseGain('left', index, nextLeft);
    audioEngine?.setBandBaseGain('right', index, nextRight);
    renderBand(index);
  }
  refreshStatusStrip();
};
const setBandBaseGain = (channel, index, value, singleChannel = false) => {
  const channels = !singleChannel && state.channelSelection === 'LR' ? ['left', 'right'] : [channel];
  channels.forEach(targetChannel => {
    const nextValue = setStateBandBaseGain(state, targetChannel, index, value);
    audioEngine?.setBandBaseGain(targetChannel, index, nextValue);
  });
  invalidateSpreadCenter(index);
  renderBand(index);
  refreshStatusStrip();
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
  scheduleAnalyzerRender();
  refreshStatusStrip();
};
const setFeedbackAll = (channel, enabled) => {
  const channels = state.channelSelection === 'LR' ? ['left', 'right'] : [channel];
  channels.forEach(targetChannel => {
    if (targetChannel === 'left') state.feedbackAllLeft = Boolean(enabled);
    else state.feedbackAllRight = Boolean(enabled);
    audioEngine?.setFeedbackAll(targetChannel, enabled);
  });
  devLabTelemetry.logStateChange('FB ALL', setFeedbackAll.last ?? 'OFF', enabled ? 'ON' : 'OFF');
  setFeedbackAll.last = enabled ? 'ON' : 'OFF';
  scheduleAnalyzerRender();
  refreshStatusStrip();
};
faders.forEach((slider,index) => {
  slider.addEventListener('input', () => setBandPairByDb(index, 'center', slider.value));
  slider.addEventListener('dblclick', () => setBandPairByDb(index, 'center', BAND_GAIN_NEUTRAL));
  renderBand(index);
});
document.querySelectorAll('.band-fader-channel').forEach(input => {
  const index = Number(input.dataset.band); const channel = input.dataset.channel;
  const change = () => state.bandChannelLinked[index] ? setBandPairByDb(index, channel, input.value) : setBandBaseGain(channel, index, input.value, true);
  input.addEventListener('input', change);
  input.addEventListener('dblclick', () => state.bandChannelLinked[index] ? setBandPairByDb(index, channel, BAND_GAIN_NEUTRAL) : setBandBaseGain(channel, index, BAND_GAIN_NEUTRAL, true));
});
document.querySelectorAll('[data-band-link]').forEach(button => button.addEventListener('click', () => {
  const index = Number(button.dataset.bandLink);
  state.bandChannelLinked[index] = !state.bandChannelLinked[index];
  renderBand(index);
}));

export {
  bands, formatValue, faders, renderAnalyzerScale, renderBandSliderValues, invalidateSpreadCenter,
  invalidateAllSpreadCenters, renderBand, materializeSpreadDb, setBandBaseGain, setBandFeedback,
  setFeedbackAll
};
