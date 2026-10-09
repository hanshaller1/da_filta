// Filterbank analyzer: band bars, hover/detail overlays, feedback and saturation indicators, status strip.
import {
  BAND_DEFINITIONS, BAND_COUNT, BAND_GAIN_NEUTRAL, bandGainDbToBipolarPercent, state, audioEngine,
  updateResonatorDiagnostics, hooks
} from './app-context.js';
import {
  analyzerDisplay, analyzer, analyzerFooter, clearAnalyzerHover, hideAnalyzerDetails, analyzerAxisX,
  normalResponseButton, devResponseButton, responseChart, analyzerOptionsPopover, liveStatusStrip,
  setClearAnalyzerHover, setHideAnalyzerDetails
} from './analyzer-header.js';
import { spectrumRenderer } from './spectrum-renderer.js';
import { devLabTelemetry } from './dev-lab-telemetry.js';
import { getFilterbankDisplayBandGains, getBandBoostDb, getBandCutDb } from './band-gain-range.js';

const bars = document.querySelector('.bars');
bars.innerHTML = Array.from({ length: BAND_COUNT }, (_, i) => `<div class="bar-pair" data-analyzer-band="${i}" tabindex="0" aria-label="Band ${i + 1}, ${BAND_DEFINITIONS[i].label}"><i data-channel="left"></i><i data-channel="right"></i><b class="analyzer-peak analyzer-peak-left"></b><b class="analyzer-peak analyzer-peak-right"></b><small class="analyzer-band-delta"></small><em class="analyzer-feedback-marker" aria-hidden="true">FB</em><em class="analyzer-osc-marker" aria-hidden="true">OSC</em></div>`).join('');
const analyzerDetail = document.createElement('div');
analyzerDetail.className = 'analyzer-band-detail';
analyzerDetail.hidden = true;
responseChart?.append(analyzerDetail);
const analyzerFeedbackMeter = document.createElement('div');
analyzerFeedbackMeter.className = 'analyzer-feedback-energy';
analyzerFeedbackMeter.hidden = true;
analyzerFeedbackMeter.innerHTML = '<span>FB ENERGY</span><em>LOCAL</em><i data-feedback-energy="local"><b></b></i><em>MAIN</em><i data-feedback-energy="main"><b></b></i>';
responseChart?.append(analyzerFeedbackMeter);
const analyzerSaturationBadge = document.createElement('span');
analyzerSaturationBadge.className = 'analyzer-saturation-indicator';
analyzerSaturationBadge.hidden = true;
analyzerSaturationBadge.textContent = 'SAT';
responseChart?.append(analyzerSaturationBadge);
const analyzerMotion = Array.from({ length: BAND_COUNT }, () => ({ left: 0, right: 0, peakLeft: 0, peakRight: 0, peakLeftAt: 0, peakRightAt: 0 }));
const analyzerOscillation = Array.from({ length: BAND_COUNT }, () => ({ since: 0, active: false }));
let analyzerAnimationFrame = 0;
let analyzerLastFrame = performance.now();
let analyzerDetailMode = 'hidden';
let hoveredAnalyzerBand = null;
const toDb = value => `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)} dB`;
const getAnalyzerTelemetry = () => devLabTelemetry.getLatest?.() || null;
const getEnergyPair = (packet, index) => {
  const zdf = packet?.left?.feedbackCoreEffective === 'zdf' || packet?.left?.feedbackCoreEffective === 'zdf-per-band' || packet?.left?.feedbackCoreEffective === 'zdf-shared-band-sat';
  const left = zdf ? packet?.left?.baseBandEnergy : packet?.left?.bandEnergy;
  const right = zdf ? packet?.right?.baseBandEnergy : packet?.right?.bandEnergy;
  return (Number(left?.[index]) || 0) + (Number(right?.[index]) || 0);
};
const analyzerBandInfo = index => {
  const display = getFilterbankDisplayBandGains(index);
  const packet = getAnalyzerTelemetry();
  const feedback = Boolean(state.feedbackBandLeft[index] || state.feedbackBandRight[index]);
  return { index, display, delta: display.leftDb - display.rightDb, feedback, dominant: devLabTelemetry.getDominant?.().index === index, oscillating: analyzerOscillation[index].active, energy: getEnergyPair(packet, index) };
};
const detailText = index => {
  const info = analyzerBandInfo(index);
  return [`BAND ${index + 1} · ${BAND_DEFINITIONS[index].label}`, `L ${toDb(info.display.leftDb)}`, `R ${toDb(info.display.rightDb)}`, ...(analyzerDisplay.spreadDelta || Math.abs(info.delta) > .005 ? [`Δ ${toDb(info.delta)}`] : []), info.feedback ? 'FB ON' : 'FB OFF', ...(state.feedbackAllLeft || state.feedbackAllRight ? ['MAIN'] : []), ...(info.dominant ? ['DOM'] : []), ...(info.oscillating ? ['OSC'] : [])];
};
const hideDetailElement = detail => { detail.hidden = true; };
setHideAnalyzerDetails(() => {
  hoveredAnalyzerBand = null;
  analyzerDetailMode = 'hidden';
  hideDetailElement(analyzerDetail);
  bars.querySelectorAll('.is-hovered').forEach(element => element.classList.remove('is-hovered'));
});
setClearAnalyzerHover(() => {
  hoveredAnalyzerBand = null;
  bars.querySelectorAll('.is-hovered').forEach(element => element.classList.remove('is-hovered'));
  if (analyzerDetailMode === 'hover') {
    analyzerDetailMode = 'hidden';
    hideDetailElement(analyzerDetail);
  }
});
const renderAnalyzerDetail = (index, anchor) => {
  const detail = analyzerDetail;
  const container = responseChart;
  detail.replaceChildren(...detailText(index).map((line, lineIndex) => { const row = document.createElement(lineIndex === 0 ? 'strong' : 'span'); row.textContent = line; return row; }));
  detail.hidden = false;
  const containerRect = container.getBoundingClientRect();
  const rect = anchor?.getBoundingClientRect?.() || containerRect;
  detail.style.left = `${Math.max(4, Math.min(containerRect.width - 116, rect.left - containerRect.left + rect.width / 2 - 58))}px`;
  detail.style.top = `${Math.max(4, Math.min(containerRect.height - 82, rect.top - containerRect.top + 8))}px`;
};
const showAnalyzerHover = (index, anchor) => {
  if (!analyzerDisplay.hoverValues) return;
  hideAnalyzerDetails();
  hoveredAnalyzerBand = index;
  analyzerDetailMode = 'hover';
  anchor?.classList.add('is-hovered');
  renderAnalyzerDetail(index, anchor);
};
const refreshStatusStrip = () => {
  if (!liveStatusStrip) return;
  const engine = audioEngine || {};
  const mainActive = state.feedbackAllLeft || state.feedbackAllRight;
  const activeBands = state.feedbackBandLeft.map((enabled, index) => enabled || state.feedbackBandRight[index] ? index + 1 : null).filter(Boolean);
  const packet = getAnalyzerTelemetry();
  const sat = packet && ((Number(packet.left?.saturationActiveFrames) || 0) > 0 || (Number(packet.right?.saturationActiveFrames) || 0) > 0);
  const tokens = [
    `INPUT ${Number(state.inputGain).toFixed(1)} dB`,
    Number(engine.commonBusDrive) > 1 ? `DRIVE ${engine.commonBusDrive}` : null,
    engine.feedbackTopology ? `FB ${String(engine.feedbackTopology).replaceAll('-', ' ').toUpperCase()}` : null,
    engine.feedbackCore ? String(engine.feedbackCore).toUpperCase() : null,
    `SPREAD ${state.spread >= 0 ? '+' : ''}${Number(state.spread).toFixed(1)} dB`,
    `OUT ${Number(state.volume).toFixed(1)} dB`,
    engine.feedbackTap ? (engine.feedbackTap === 'post-gain' ? 'POST' : 'PRE') : null,
    mainActive ? 'MAIN' : null,
    activeBands.length ? `FB ${activeBands.join(' ')}` : null,
    sat ? 'SAT' : null
  ].filter(Boolean);
  liveStatusStrip.replaceChildren(...tokens.map(token => { const badge = document.createElement('span'); badge.textContent = token; if (token === 'MAIN' || token === 'SAT' || token === 'ZDF') badge.classList.add('is-active'); if (token === 'SAT') badge.classList.add('is-warning'); return badge; }));
  liveStatusStrip.hidden = !analyzerDisplay.liveStatusStrip;
};
const updateOscillation = () => {
  const packet = getAnalyzerTelemetry();
  if (!packet) return;
  const energies = Array.from({ length: BAND_COUNT }, (_, index) => getEnergyPair(packet, index));
  const strongest = Math.max(1e-9, ...energies);
  const now = performance.now();
  energies.forEach((energy, index) => {
    const gated = state.feedbackBandLeft[index] || state.feedbackBandRight[index] || state.feedbackAllLeft || state.feedbackAllRight;
    const sustained = gated && energy > .00001 && energy >= strongest * .42;
    const candidate = analyzerOscillation[index];
    if (sustained) { if (!candidate.since) candidate.since = now; if (now - candidate.since >= 650) candidate.active = true; }
    else if (candidate.active && now - candidate.since < 1100) { /* short release hysteresis */ }
    else { candidate.since = 0; candidate.active = false; }
  });
};
const renderTelemetryIndicators = () => {
  const packet = getAnalyzerTelemetry();
  const left = packet?.left; const right = packet?.right;
  const local = Math.max(Math.abs(Number(left?.commonFeedbackReturn) || 0), Math.abs(Number(right?.commonFeedbackReturn) || 0));
  const main = Math.max(Math.abs(Number(left?.mainCommonFeedbackReturn) || 0), Math.abs(Number(right?.mainCommonFeedbackReturn) || 0));
  analyzerFeedbackMeter.hidden = !analyzerDisplay.feedbackEnergy;
  analyzerFeedbackMeter.querySelector('[data-feedback-energy="local"] b').style.width = `${Math.min(100, Math.sqrt(local) * 100)}%`;
  analyzerFeedbackMeter.querySelector('[data-feedback-energy="main"] b').style.width = `${Math.min(100, Math.sqrt(main) * 100)}%`;
  const frames = Math.max(1, Number(left?.frameCount) || 0, Number(right?.frameCount) || 0);
  const saturated = Math.max(Number(left?.saturationActiveFrames) || 0, Number(right?.saturationActiveFrames) || 0) / frames > .01 || Math.max(Math.abs(Number(left?.wetPeak) || 0), Math.abs(Number(right?.wetPeak) || 0)) >= .995;
  analyzerSaturationBadge.hidden = !analyzerDisplay.saturationIndicators || !saturated;
};
const animateAnalyzer = now => {
  analyzerAnimationFrame = 0;
  const elapsed = Math.min(100, Math.max(1, now - analyzerLastFrame));
  analyzerLastFrame = now;
  let needsFrame = false;
  updateOscillation();
  for (let index = 0; index < BAND_COUNT; index += 1) {
    const info = analyzerBandInfo(index); const motion = analyzerMotion[index];
    [['left', info.display.leftControl, 'peakLeft', 'peakLeftAt'], ['right', info.display.rightControl, 'peakRight', 'peakRightAt']].forEach(([channel, target, peakKey, peakAtKey]) => {
      const previous = motion[channel];
      const current = !analyzerDisplay.smoothDecay || Math.abs(target) >= Math.abs(previous) ? target : previous + (target - previous) * (1 - Math.exp(-elapsed / 150));
      motion[channel] = current;
      const magnitude = Math.abs(current);
      if (magnitude >= motion[peakKey]) { motion[peakKey] = magnitude; motion[peakAtKey] = now; }
      else if (now - motion[peakAtKey] > 550) motion[peakKey] = Math.max(magnitude, motion[peakKey] - elapsed * .035);
      if (Math.abs(target - current) > .05 || motion[peakKey] > magnitude + .05) needsFrame = true;
    });
    const pair = bars.querySelector(`[data-analyzer-band="${index}"]`);
    if (pair) {
      pair.dataset.leftDb = info.display.leftDb.toFixed(3); pair.dataset.rightDb = info.display.rightDb.toFixed(3); pair.dataset.deltaDb = info.delta.toFixed(3);
      pair.classList.toggle('has-feedback', analyzerDisplay.feedbackActivity && info.feedback);
      pair.classList.toggle('is-dominant', analyzerDisplay.dominantBand && info.dominant);
      pair.classList.toggle('is-oscillating', analyzerDisplay.selfOscillation && info.oscillating);
      pair.classList.toggle('has-glow', analyzerDisplay.peakGlow && Math.max(Math.abs(motion.left), Math.abs(motion.right)) > 4);
      pair.classList.toggle('hide-lr-bars', !analyzerDisplay.lrBars);
      const [leftBar, rightBar] = pair.querySelectorAll('i[data-channel]');
      // These bars are manual FILTERBANK controls, not an audio meter or the
      // final effective DSP shape. They update immediately without decay.
      renderAnalyzerBar(leftBar, info.display.leftDb);
      renderAnalyzerBar(rightBar, info.display.rightDb);
      pair.querySelector('.analyzer-band-delta').textContent = `Δ ${toDb(info.delta)}`;
      pair.querySelector('.analyzer-peak-left').style.setProperty('--peak-level', (Math.sign(motion.left || 1) * motion.peakLeft / 2).toFixed(2));
      pair.querySelector('.analyzer-peak-right').style.setProperty('--peak-level', (Math.sign(motion.right || 1) * motion.peakRight / 2).toFixed(2));
    }
    analyzerAxisX?.children[index]?.classList.toggle('is-dominant', analyzerDisplay.dominantBand && info.dominant);
  }
  refreshStatusStrip();
  renderTelemetryIndicators();
  if (needsFrame) analyzerAnimationFrame = requestAnimationFrame(animateAnalyzer);
};
const scheduleAnalyzerRender = () => { if (!analyzerAnimationFrame) analyzerAnimationFrame = requestAnimationFrame(animateAnalyzer); };
const setAnalyzerDisplayOption = (key, enabled) => {
  if (!(key in analyzerDisplay)) return;
  analyzerDisplay[key] = Boolean(enabled);
  analyzerOptionsPopover.querySelector(`[data-analyzer-option="${key}"]`).checked = analyzerDisplay[key];
  responseChart?.classList.toggle(`hide-${key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}`, !analyzerDisplay[key]);
  if (key === 'liveStatusStrip') refreshStatusStrip();
  if (key === 'hoverValues' && !analyzerDisplay[key]) hideAnalyzerDetails();
  if (key === 'frequencyLabels') analyzerFooter?.classList.toggle('hide-frequency-labels', !analyzerDisplay[key]);
  if (key === 'bandRegions') responseChart?.classList.toggle('hide-band-regions', !analyzerDisplay[key]);
  if (key === 'grid') responseChart?.classList.toggle('hide-grid', !analyzerDisplay[key]);
  spectrumRenderer.refresh(); scheduleAnalyzerRender();
  updateResonatorDiagnostics();
};
hooks.setAnalyzerDisplayOption = setAnalyzerDisplayOption;
window.FilterbankAnalyzer = { getDisplayState: () => ({ ...analyzerDisplay }), getDetailState: () => ({ mode: analyzerDetailMode, hoveredBand: hoveredAnalyzerBand }), setDisplayOption: setAnalyzerDisplayOption, getBandInfo: index => analyzerBandInfo(index), refresh: scheduleAnalyzerRender, getSpectrumLayers: () => spectrumRenderer.getLayers() };
const ANALYZER_ZERO_EPSILON = 1e-9;
const renderAnalyzerBar = (bar, value) => {
  const numericValue = Number(value);
  const isZero = Math.abs(numericValue) < ANALYZER_ZERO_EPSILON;
  const height = Math.abs(bandGainDbToBipolarPercent(numericValue, getBandBoostDb(), getBandCutDb())) / 2;
  bar.classList.toggle('negative', numericValue < BAND_GAIN_NEUTRAL);
  bar.classList.toggle('is-zero', isZero);
  bar.style.height = `${height}%`;
};
const updateAnalyzerBand = index => {
  const [leftBar, rightBar] = document.querySelectorAll(`[data-analyzer-band="${index}"] i`);
  const display = getFilterbankDisplayBandGains(index);
  renderAnalyzerBar(leftBar, display.leftDb);
  renderAnalyzerBar(rightBar, display.rightDb);
  scheduleAnalyzerRender();
};
bars.querySelectorAll('[data-analyzer-band]').forEach(pair => {
  pair.addEventListener('pointerenter', () => showAnalyzerHover(Number(pair.dataset.analyzerBand), pair));
  pair.addEventListener('pointerleave', clearAnalyzerHover);
});
bars.addEventListener('focusin', event => {
  const pair = event.target.closest('[data-analyzer-band]');
  if (pair) showAnalyzerHover(Number(pair.dataset.analyzerBand), pair);
});
bars.addEventListener('focusout', clearAnalyzerHover);
analyzer?.addEventListener('pointerleave', hideAnalyzerDetails);
window.addEventListener('blur', hideAnalyzerDetails);
normalResponseButton.addEventListener('click', hideAnalyzerDetails);
devResponseButton.addEventListener('click', hideAnalyzerDetails);
document.addEventListener('input', () => { refreshStatusStrip(); scheduleAnalyzerRender(); });
document.addEventListener('change', () => { refreshStatusStrip(); scheduleAnalyzerRender(); });

export {
  refreshStatusStrip, scheduleAnalyzerRender, updateAnalyzerBand
};
