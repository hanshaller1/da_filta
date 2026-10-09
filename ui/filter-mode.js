// FILTER mode: type selection, parameter controls, response curve and its spectrum canvas.
import { BAND_DEFINITIONS, state, audioEngine, hooks } from './app-context.js';
import { bandBoostSelect, bandCutSelect } from './dev-lab-controls.js';

const filterTypeDefinitions = window.FilterShape.FILTER_TYPE_DEFINITIONS;
const filterControlDefinitions = window.FilterShape.FILTER_CONTROL_DEFINITIONS;
const filterTypeGroups = document.querySelector('[data-filter-type-groups]');
const filterResponseDescriptor = document.querySelector('[data-filter-response-descriptor]');
const filterFormantMarkers = document.querySelector('[data-filter-formant-markers]');
const filterPrimaryControl = document.querySelector('[data-filter-primary-control]');
const filterSecondaryControls = [...document.querySelectorAll('.filter-secondary-controls .filter-parameter-control')];
const filterControlSlots = [filterPrimaryControl, ...filterSecondaryControls];
const filterTypeGroupsDefinition = [
  { label: 'CLASSIC', ids: ['lowpass', 'highpass', 'bandpass', 'notch'] },
  { label: 'EQ / TONE / FORMANT', ids: ['bell', 'lowshelf', 'highshelf', 'tilt', 'baxandall', 'formant'] }
];
if (filterTypeGroups) filterTypeGroups.innerHTML = filterTypeGroupsDefinition.map(group => `<div class="filter-type-group"><strong>${group.label}</strong><div class="filter-type-options">${group.ids.map(id => filterTypeDefinitions.find(definition => definition.id === id)).filter(Boolean).map(definition => `<button type="button" data-filter-type="${definition.id}" role="option" aria-selected="false" aria-pressed="false">${definition.displayName}</button>`).join('')}</div></div>`).join('');
const filterTypeButtons = [...document.querySelectorAll('[data-filter-type]')];
filterTypeButtons.forEach(button => button.classList.add('ui-role-toggle'));
const filterResponsePath = document.querySelector('[data-filter-response-path]');
const filterResponseMarkers = document.querySelector('[data-filter-response-markers]');
const filterResponseCeiling = document.querySelector('[data-filter-response-ceiling]');
const filterResponseZeroLabel = document.querySelector('[data-filter-response-zero-label]');
const filterResponseZeroLine = document.querySelector('[data-filter-response-zero-line]');
const filterResponseFloor = document.querySelector('[data-filter-response-floor]');
const filterResponseGrid = document.querySelector('[data-filter-response-grid]');
const filterResponseChart = document.querySelector('.filter-response-chart');
const filterSignalAxis = document.querySelector('[data-filter-signal-axis]');
const filterViewState = { input: true, output: true, filter: true };
const filterViewToggles = [...document.querySelectorAll('[data-filter-view]')];
const filterSpectrumRenderer = (() => {
  if (!filterResponseChart) return { setVisible() {}, refresh() {} };
  const canvas = document.createElement('canvas');
  canvas.className = 'filter-response-spectrum';
  canvas.setAttribute('aria-hidden', 'true');
  filterResponseChart.insertBefore(canvas, filterResponseChart.querySelector('svg'));
  const context = canvas.getContext('2d');
  const minimumDbfs = -90;
  const minimumHz = BAND_DEFINITIONS[0].frequency;
  const maximumHz = BAND_DEFINITIONS[BAND_DEFINITIONS.length - 1].frequency;
  const logRange = Math.log(maximumHz / minimumHz);
  let visible = false;
  let frame = 0;
  let timer = 0;
  let lastDraw = 0;
  let width = 0;
  let height = 0;
  let inputLeft = null;
  let inputRight = null;
  let outputLeft = null;
  let outputRight = null;
  let inputLeftBins = null;
  let inputRightBins = null;
  let outputLeftBins = null;
  let outputRightBins = null;
  let smoothInput = null;
  let smoothOutput = null;
  let palette = null;
  const spectrumVisible = () => filterViewState.input || filterViewState.output;
  const active = () => visible && spectrumVisible() && audioEngine?.status === 'ON';
  const clearCanvas = () => {
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
  };
  const refresh = () => {
    if (!active()) { clearCanvas(); return; }
    if (frame || timer) return;
    timer = window.setTimeout(() => { timer = 0; if (active() && !frame) frame = requestAnimationFrame(draw); }, 32);
  };
  const ensureAnalyzers = () => {
    if (filterViewState.input) audioEngine?.ensureInputSpectrumAnalysers?.();
    const next = [audioEngine?.inputSpectrumAnalyserLeft, audioEngine?.inputSpectrumAnalyserRight, audioEngine?.spectrumAnalyserLeft, audioEngine?.spectrumAnalyserRight];
    if (next[0] !== inputLeft || next[1] !== inputRight || next[2] !== outputLeft || next[3] !== outputRight) {
      [inputLeft, inputRight, outputLeft, outputRight] = next;
      inputLeftBins = inputLeft ? new Float32Array(inputLeft.frequencyBinCount) : null;
      inputRightBins = inputRight ? new Float32Array(inputRight.frequencyBinCount) : null;
      outputLeftBins = outputLeft ? new Float32Array(outputLeft.frequencyBinCount) : null;
      outputRightBins = outputRight ? new Float32Array(outputRight.frequencyBinCount) : null;
      smoothInput = new Float32Array(outputLeft?.frequencyBinCount || inputLeft?.frequencyBinCount || 0); smoothInput.fill(minimumDbfs);
      smoothOutput = new Float32Array(outputLeft?.frequencyBinCount || 0); smoothOutput.fill(minimumDbfs);
    }
  };
  const dbfsToY = value => (12 + (0 - Math.max(minimumDbfs, Math.min(0, value))) / -minimumDbfs * 208) / 240 * height;
  const drawSpectrum = (left, right, analyser, smoothed, color, alpha, lineWidth) => {
    if (!left || !right || !analyser || !smoothed) return;
    const binWidth = analyser.context.sampleRate / analyser.fftSize;
    const first = Math.max(1, Math.ceil(minimumHz / binWidth));
    const last = Math.min(left.length - 1, Math.floor(maximumHz / binWidth));
    context.beginPath();
    for (let bin = first; bin <= last; bin += 1) {
      const leftDb = Number.isFinite(left[bin]) ? left[bin] : minimumDbfs;
      const rightDb = Number.isFinite(right[bin]) ? right[bin] : minimumDbfs;
      const level = 10 * Math.log10((10 ** (leftDb / 10) + 10 ** (rightDb / 10)) * .5);
      smoothed[bin] += (level - smoothed[bin]) * .28;
      const frequency = bin * binWidth;
      const x = (50 + Math.log(frequency / minimumHz) / logRange * 900) / 1000 * width;
      if (bin === first) context.moveTo(x, dbfsToY(smoothed[bin])); else context.lineTo(x, dbfsToY(smoothed[bin]));
    }
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.stroke();
  };
  function draw(now) {
    frame = 0;
    if (!active() || !context) return;
    if (now - lastDraw < 32) { refresh(); return; }
    lastDraw = now;
    const rect = filterResponseChart.getBoundingClientRect();
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const nextWidth = Math.max(0, Math.floor(rect.width));
    const nextHeight = Math.max(0, Math.floor(rect.height));
    if (!nextWidth || !nextHeight) { refresh(); return; }
    if (width !== nextWidth || height !== nextHeight || canvas.width !== Math.round(nextWidth * pixelRatio) || canvas.height !== Math.round(nextHeight * pixelRatio)) {
      width = nextWidth; height = nextHeight;
      canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    ensureAnalyzers();
    if (filterViewState.input && inputLeft && inputRight && inputLeftBins && inputRightBins) {
      inputLeft.getFloatFrequencyData(inputLeftBins); inputRight.getFloatFrequencyData(inputRightBins);
    }
    if (filterViewState.output && outputLeft && outputRight && outputLeftBins && outputRightBins) {
      outputLeft.getFloatFrequencyData(outputLeftBins); outputRight.getFloatFrequencyData(outputRightBins);
    }
    if (!palette) {
      const style = getComputedStyle(document.body);
      palette = {
        input: style.getPropertyValue('--secondary-text').trim() || '#9aaab0',
        output: style.getPropertyValue('--graph-right-color').trim() || '#e16c85'
      };
    }
    if (filterViewState.input) drawSpectrum(inputLeftBins, inputRightBins, inputLeft, smoothInput, palette.input, .66, 1.05);
    if (filterViewState.output) drawSpectrum(outputLeftBins, outputRightBins, outputLeft, smoothOutput, palette.output, .9, 1.55);
    context.globalAlpha = 1;
    refresh();
  }
  const setVisible = next => {
    visible = Boolean(next);
    if (!visible) {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (timer) { clearTimeout(timer); timer = 0; }
      clearCanvas();
    }
    else refresh();
  };
  filterViewToggles.forEach(button => button.addEventListener('click', () => {
    const layer = button.dataset.filterView;
    if (!Object.hasOwn(filterViewState, layer)) return;
    filterViewState[layer] = !filterViewState[layer];
    button.setAttribute('aria-pressed', String(filterViewState[layer]));
    button.classList.toggle('active', filterViewState[layer]);
    filterResponseChart.dataset[`filterView${layer[0].toUpperCase()}${layer.slice(1)}`] = String(filterViewState[layer]);
    filterSignalAxis.hidden = !(filterViewState.input || filterViewState.output);
    refresh();
  }));
  window.addEventListener('resize', refresh);
  document.addEventListener('da-filta-theme-change', () => { palette = null; refresh(); });
  new MutationObserver(() => { palette = null; }).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  new ResizeObserver(refresh).observe(filterResponseChart);
  filterViewToggles.forEach(button => button.classList.add('active'));
  filterSignalAxis.hidden = false;
  return { setVisible, refresh };
})();
const filterFrequencyMarker = document.querySelector('[data-filter-frequency-marker]');
const filterFrequencyMarkerLabel = document.querySelector('[data-filter-frequency-marker-label]');
const formatFilterFrequency = value => {
  const frequency = window.FilterShape.normalizeFilterFrequencyHz(value);
  if (frequency < 1000) return `${Math.round(frequency)} Hz`;
  return `${(frequency / 1000).toFixed(1).replace(/\.0$/, '')} kHz`;
};
const getFilterModeShape = () => audioEngine?.filterModeBandGainsDb ?? window.FilterShape.createFilterShape({
  ...window.FilterShape.shapeParametersFromState(state),
  bandDefinitions: BAND_DEFINITIONS,
  maxBandBoostDb: Number(bandBoostSelect?.value ?? 12),
  maxBandCutDb: Number(bandCutSelect?.value ?? 12)
});
const filterResponsePathData = points => {
  if (!points.length) return '';
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`;
  let path = `M${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midpointX = (current.x + next.x) / 2;
    path += ` C${midpointX} ${current.y.toFixed(2)} ${midpointX} ${next.y.toFixed(2)} ${next.x} ${next.y}`;
  }
  return path;
};
const formatFilterControl = (definition, value) => {
  if (definition.format === 'frequency') return formatFilterFrequency(value);
  if (definition.format === 'db') return `${value > 0 ? '+' : ''}${Number(value).toFixed(1)} dB`;
  if (definition.format === 'semitones') return `${value > 0 ? '+' : ''}${Number(value).toFixed(1).replace(/\.0$/, '')} st`;
  if (definition.format === 'vowel') {
    const position = Math.min(4, Math.max(0, Number(value)));
    const first = Math.floor(position);
    const fraction = position - first;
    return fraction < .005 || first === 4 ? window.FilterShape.FORMANT_VOWELS[first]
      : `${window.FilterShape.FORMANT_VOWELS[first]} → ${window.FilterShape.FORMANT_VOWELS[first + 1]} ${Math.round(fraction * 100)} %`;
  }
  return `${Math.round(value)} %`;
};
const renderFilterControl = (slot, key, boostDb, cutDb) => {
  const definition = filterControlDefinitions[key];
  const input = slot.querySelector('input');
  const label = slot.querySelector('span');
  const output = slot.querySelector('output');
  const disabled = Boolean(definition.disabled || key === 'disabled');
  label.textContent = definition.label;
  input.min = String(definition.min === 'cut' ? -cutDb : definition.min);
  input.max = String(definition.max === 'boost' ? boostDb : definition.max);
  input.step = String(definition.step);
  input.getAttributeNames().filter(name => name.startsWith('data-filter-') && name !== 'data-filter-control').forEach(name => input.removeAttribute(name));
  if (key !== 'disabled') input.setAttribute(`data-filter-${key === 'width' || key === 'widthDisabled' ? 'bandwidth' : key}`, '');
  input.dataset.filterControl = key;
  input.setAttribute('aria-label', `Filter ${definition.label.toLowerCase()}`);
  input.disabled = disabled;
  slot.classList.toggle('is-disabled', disabled);
  const value = definition.field ? state[definition.field] : 0;
  const displayValue = definition.format === 'db' ? Math.min(Number(input.max), Math.max(Number(input.min), value)) : value;
  input.value = definition.format === 'frequency' ? String(window.FilterShape.frequencyToSlider(displayValue)) : String(displayValue);
  output.textContent = definition.field ? formatFilterControl(definition, displayValue) : '—';
  if (definition.format === 'vowel') input.setAttribute('list', 'filter-vowel-ticks'); else input.removeAttribute('list');
};
const renderFilterMode = () => {
  const boostDb = Math.max(1, Number(audioEngine?.maxBandBoostDb ?? bandBoostSelect?.value ?? 12));
  const cutDb = Math.max(1, Number(audioEngine?.maxBandCutDb ?? bandCutSelect?.value ?? 12));
  const gains = getFilterModeShape();
  const graphTop = 12;
  const graphBottom = 220;
  const graphLeft = 50;
  const graphRight = 950;
  const graphViewBoxHeight = 240;
  const graphRange = boostDb + cutDb;
  const zeroY = graphTop + boostDb / graphRange * (graphBottom - graphTop);
  const gainToY = gain => graphTop + (boostDb - Math.max(-cutDb, Math.min(boostDb, gain))) / graphRange * (graphBottom - graphTop);
  const points = gains.map((gain, index) => ({ x: 50 + index * 100, y: gainToY(gain) }));
  const frequencyMinHz = BAND_DEFINITIONS[0].frequency;
  const frequencyMaxHz = BAND_DEFINITIONS[BAND_DEFINITIONS.length - 1].frequency;
  const typeDefinition = filterTypeDefinitions.find(definition => definition.id === state.filterType) || filterTypeDefinitions[0];
  const markerControl = filterControlDefinitions[typeDefinition.marker];
  const markerFrequency = markerControl?.field ? state[markerControl.field] : state.filterBaxandallCenterHz;
  const frequencyPosition = Math.log(markerFrequency / frequencyMinHz) / Math.log(frequencyMaxHz / frequencyMinHz);
  const frequencyX = graphLeft + frequencyPosition * (graphRight - graphLeft);
  const regularGridYs = Array.from({ length: 5 }, (_, index) => graphTop + index / 4 * (graphBottom - graphTop));
  if (filterResponseGrid) filterResponseGrid.innerHTML = `${regularGridYs.map(y => `<line class="filter-response-grid-line" x1="0" y1="${y.toFixed(2)}" x2="1000" y2="${y.toFixed(2)}"></line>`).join('')}<line class="filter-response-grid-line filter-response-zero-grid-line" data-filter-response-zero-grid-line x1="0" y1="${zeroY.toFixed(2)}" x2="1000" y2="${zeroY.toFixed(2)}"></line>`;
  filterFrequencyMarker?.setAttribute('x1', frequencyX.toFixed(2));
  filterFrequencyMarker?.setAttribute('x2', frequencyX.toFixed(2));
  if (filterFrequencyMarker) filterFrequencyMarker.hidden = typeDefinition.marker === 'formants';
  if (filterFormantMarkers) filterFormantMarkers.innerHTML = typeDefinition.marker === 'formants'
    ? window.FilterShape.formantCenters(state.filterFormantVowel, state.filterFormantShiftSemitones).map((frequency, index) => {
      const x = graphLeft + Math.log(Math.max(frequencyMinHz, Math.min(frequencyMaxHz, frequency)) / frequencyMinHz) / Math.log(frequencyMaxHz / frequencyMinHz) * (graphRight - graphLeft);
      return `<line x1="${x.toFixed(2)}" y1="${graphTop}" x2="${x.toFixed(2)}" y2="${graphBottom}"><title>F${index + 1}: ${Math.round(frequency)} Hz</title></line>`;
    }).join('') : '';
  filterResponsePath?.setAttribute('d', filterResponsePathData(points));
  if (filterResponseMarkers) filterResponseMarkers.innerHTML = points.map((point, index) => `<line x1="${point.x}" y1="${zeroY.toFixed(2)}" x2="${point.x}" y2="${point.y.toFixed(2)}"></line><circle cx="${point.x}" cy="${point.y.toFixed(2)}" r="3"><title>${BAND_DEFINITIONS[index].label}: ${gains[index].toFixed(1)} dB</title></circle>`).join('');
  filterResponseZeroLine?.setAttribute('y1', zeroY.toFixed(2));
  filterResponseZeroLine?.setAttribute('y2', zeroY.toFixed(2));
  if (filterResponseCeiling) {
    filterResponseCeiling.textContent = `+${boostDb} dB`;
    filterResponseCeiling.style.top = `${graphTop / graphViewBoxHeight * 100}%`;
  }
  if (filterResponseZeroLabel) filterResponseZeroLabel.style.top = `${zeroY / graphViewBoxHeight * 100}%`;
  if (filterResponseFloor) {
    filterResponseFloor.textContent = `−${cutDb} dB`;
    filterResponseFloor.style.top = `${graphBottom / graphViewBoxHeight * 100}%`;
  }
  if (filterFrequencyMarkerLabel) {
    filterFrequencyMarkerLabel.hidden = typeDefinition.marker === 'formants';
    filterFrequencyMarkerLabel.textContent = formatFilterFrequency(markerFrequency);
    filterFrequencyMarkerLabel.style.left = `${frequencyX / 10}%`;
    filterFrequencyMarkerLabel.classList.toggle('is-start', frequencyPosition < 0.08);
    filterFrequencyMarkerLabel.classList.toggle('is-end', frequencyPosition > 0.92);
  }
  if (filterResponseDescriptor) filterResponseDescriptor.textContent = typeDefinition.descriptor;
  filterTypeButtons.forEach(button => {
    const active = button.dataset.filterType === state.filterType;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.setAttribute('aria-pressed', String(active));
  });
  [typeDefinition.primary, ...typeDefinition.secondary].forEach((key, index) => renderFilterControl(filterControlSlots[index], key, boostDb, cutDb));
};
const updateFilterState = values => {
  Object.assign(state, window.ResonantState.normalizeFilterState({ ...state, ...values }));
  audioEngine?.setFilterState(state);
  renderFilterMode();
  hooks.renderLfoControls();
};
filterTypeButtons.forEach(button => button.addEventListener('click', () => {
  updateFilterState({ filterType: button.dataset.filterType });
}));
filterControlSlots.forEach(slot => slot.querySelector('input')?.addEventListener('input', event => {
  const definition = filterControlDefinitions[event.target.dataset.filterControl];
  if (!definition?.field) return;
  const value = definition.format === 'frequency' ? window.FilterShape.sliderToFrequency(event.target.value) : Number(event.target.value);
  updateFilterState({ [definition.field]: value });
}));
renderFilterMode();

export {
  filterSpectrumRenderer, getFilterModeShape, renderFilterMode
};
