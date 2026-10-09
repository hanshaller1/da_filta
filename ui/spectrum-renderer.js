// Canvas spectrum of the filterbank response chart (input/output curves, trail, foreground switch).
import { BAND_DEFINITIONS, audioEngine, hooks } from './app-context.js';
import { analyzerDisplay, responseChart, spectrumBarsButton, spectrumCurveButton } from './analyzer-header.js';

const spectrumRenderer = (() => {
  if (!responseChart) return { setVisible() {}, refresh() {} };
  const canvas = document.createElement('canvas');
  canvas.className = 'filterbank-spectrum';
  canvas.setAttribute('aria-hidden', 'true');
  responseChart.insertBefore(canvas, responseChart.querySelector('.bars'));
  const context = canvas.getContext('2d');
  const minFrequency = 20;
  const maxFrequency = 20000;
  const minDecibels = -90;
  const maxDecibels = 0;
  const logFrequencyRange = Math.log(maxFrequency / minFrequency);
  let visible = true;
  let foreground = 'bars';
  let animationFrame = 0;
  let leftAnalyser = null;
  let rightAnalyser = null;
  let inputLeftAnalyser = null;
  let inputRightAnalyser = null;
  let leftBins = null;
  let rightBins = null;
  let inputLeftBins = null;
  let inputRightBins = null;
  let lastLayers = [];
  let cssWidth = 0;
  let cssHeight = 0;
  let palette = null;
  let outputTrail = [];
  let lastTrailCaptureAt = 0;
  const frequencyToX = (frequency, width) => Math.log(Math.max(minFrequency, Math.min(maxFrequency, frequency)) / minFrequency) / logFrequencyRange * width;
  const decibelsToY = (decibels, height) => (maxDecibels - Math.max(minDecibels, Math.min(maxDecibels, decibels))) / (maxDecibels - minDecibels) * height;
  const shouldRender = () => visible;
  const updateButtons = () => {
    const barsFront = foreground === 'bars';
    spectrumBarsButton.classList.toggle('active', barsFront);
    spectrumCurveButton.classList.toggle('active', !barsFront);
    spectrumBarsButton.setAttribute('aria-pressed', String(barsFront));
    spectrumCurveButton.setAttribute('aria-pressed', String(!barsFront));
    responseChart.classList.toggle('spectrum-foreground', !barsFront);
  };
  const resize = () => {
    const rect = responseChart.getBoundingClientRect();
    const width = Math.max(0, Math.floor(rect.width));
    const height = Math.max(0, Math.floor(rect.height));
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    if (!width || !height) return false;
    if (cssWidth !== width || cssHeight !== height || canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
      cssWidth = width; cssHeight = height;
      canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    return true;
  };
  const colors = () => {
    if (palette) return palette;
    const style = getComputedStyle(document.body);
    const canvasColor = (value, fallback) => String(value || '').trim().match(/^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i)?.[0] || fallback;
    palette = {
      left: canvasColor(style.getPropertyValue('--graph-left-color'), '#49d7eb'),
      right: canvasColor(style.getPropertyValue('--graph-right-color'), '#e16c85'),
      input: canvasColor(style.getPropertyValue('--secondary-text'), '#9aaab0'),
      response: canvasColor(style.getPropertyValue('--strong-text'), '#d9e4e8')
    };
    return palette;
  };
  const ensureBins = () => {
    if (analyzerDisplay.inputSpectrum) audioEngine?.ensureInputSpectrumAnalysers?.();
    const nextLeft = audioEngine?.spectrumAnalyserLeft || null;
    const nextRight = audioEngine?.spectrumAnalyserRight || null;
    const nextInputLeft = audioEngine?.inputSpectrumAnalyserLeft || null;
    const nextInputRight = audioEngine?.inputSpectrumAnalyserRight || null;
    if (nextLeft !== leftAnalyser || nextRight !== rightAnalyser || nextInputLeft !== inputLeftAnalyser || nextInputRight !== inputRightAnalyser) {
      leftAnalyser = nextLeft; rightAnalyser = nextRight;
      inputLeftAnalyser = nextInputLeft; inputRightAnalyser = nextInputRight;
      leftBins = leftAnalyser ? new Float32Array(leftAnalyser.frequencyBinCount) : null;
      rightBins = rightAnalyser ? new Float32Array(rightAnalyser.frequencyBinCount) : null;
      inputLeftBins = inputLeftAnalyser ? new Float32Array(inputLeftAnalyser.frequencyBinCount) : null;
      inputRightBins = inputRightAnalyser ? new Float32Array(inputRightAnalyser.frequencyBinCount) : null;
    }
    return leftAnalyser && rightAnalyser && leftBins && rightBins;
  };
  const curvePath = (data, analyser) => {
    const sampleRate = analyser.context.sampleRate;
    const binWidth = sampleRate / analyser.fftSize;
    const start = Math.max(1, Math.ceil(minFrequency / binWidth));
    const end = Math.min(data.length - 1, Math.floor(maxFrequency / binWidth));
    context.beginPath();
    for (let bin = start; bin <= end; bin += 1) {
      const x = frequencyToX(bin * binWidth, cssWidth);
      const y = decibelsToY(Number.isFinite(data[bin]) ? data[bin] : minDecibels, cssHeight);
      if (bin === start) context.moveTo(x, y); else context.lineTo(x, y);
    }
    return { start, end, binWidth };
  };
  const drawCurve = (data, analyser, color, alpha, lineWidth) => {
    curvePath(data, analyser);
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
  };
  const drawOutputFill = (data, analyser, color, alpha) => {
    const { start, end, binWidth } = curvePath(data, analyser);
    const gradient = context.createLinearGradient(0, 0, 0, cssHeight);
    gradient.addColorStop(0, color);
    gradient.addColorStop(.78, color);
    gradient.addColorStop(1, 'transparent');
    context.lineTo(frequencyToX(end * binWidth, cssWidth), cssHeight);
    context.lineTo(frequencyToX(start * binWidth, cssWidth), cssHeight);
    context.closePath();
    context.globalAlpha = alpha;
    context.fillStyle = gradient;
    context.fill();
  };
  const drawEnergyBloom = (data, analyser, color) => {
    const binWidth = analyser.context.sampleRate / analyser.fftSize;
    BAND_DEFINITIONS.forEach(band => {
      const center = Math.round(band.frequency / binWidth);
      const radius = Math.max(1, Math.round(center * .13));
      let peak = minDecibels;
      for (let bin = Math.max(1, center - radius); bin <= Math.min(data.length - 1, center + radius); bin += 1) peak = Math.max(peak, Number.isFinite(data[bin]) ? data[bin] : minDecibels);
      if (peak < -42) return;
      const x = frequencyToX(band.frequency, cssWidth);
      const alpha = Math.min(.12, Math.max(.018, (peak + 42) / 42 * .12));
      const glow = context.createRadialGradient(x, cssHeight * .58, 0, x, cssHeight * .58, Math.max(15, cssWidth * .065));
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'transparent');
      context.globalAlpha = alpha;
      context.fillStyle = glow;
      context.fillRect(Math.max(0, x - cssWidth * .08), 0, Math.min(cssWidth * .16, cssWidth), cssHeight);
    });
  };
  const drawPeakMarkers = (data, analyser, color) => {
    const binWidth = analyser.context.sampleRate / analyser.fftSize;
    const start = Math.max(3, Math.ceil(minFrequency / binWidth));
    const end = Math.min(data.length - 4, Math.floor(maxFrequency / binWidth));
    const peaks = [];
    for (let bin = start; bin <= end; bin += 3) {
      const value = Number.isFinite(data[bin]) ? data[bin] : minDecibels;
      if (value > -30 && value >= data[bin - 2] && value >= data[bin + 2]) peaks.push({ bin, value });
    }
    peaks.sort((a, b) => b.value - a.value).slice(0, 5).forEach(({ bin, value }) => {
      context.globalAlpha = Math.min(.72, .22 + (value + 30) / 30 * .5);
      context.fillStyle = color;
      context.beginPath();
      context.arc(frequencyToX(bin * binWidth, cssWidth), decibelsToY(value, cssHeight), 1.45, 0, Math.PI * 2);
      context.fill();
    });
  };
  const captureTrail = now => {
    if (!analyzerDisplay.spectrumTrail || now - lastTrailCaptureAt < 105) return;
    outputTrail.unshift({ left: new Float32Array(leftBins), right: new Float32Array(rightBins), at: now });
    outputTrail = outputTrail.slice(0, 3);
    lastTrailCaptureAt = now;
  };
  const drawFilterResponse = (channel, color) => {
    context.globalAlpha = .52;
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.beginPath();
    for (let x = 0; x <= cssWidth; x += 2) {
      const frequency = minFrequency * Math.exp((x / cssWidth) * logFrequencyRange);
      let linearGain = 1;
      BAND_DEFINITIONS.forEach((band, index) => {
        const gainDb = hooks.getFilterbankDisplayBandGains(index)[channel === 'left' ? 'leftDb' : 'rightDb'];
        const ratio = frequency / band.frequency;
        // The linear, no-feedback BPF magnitude is intentionally an
        // approximation: it communicates the configured bank, not a solver prediction.
        const q = Number(band.q) || 1.2;
        const magnitude = (ratio / q) / Math.sqrt((1 - ratio * ratio) ** 2 + (ratio / q) ** 2);
        linearGain += (10 ** (gainDb / 20) - 1) * magnitude;
      });
      const y = decibelsToY(20 * Math.log10(Math.max(1e-5, Math.abs(linearGain))), cssHeight);
      if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
    context.setLineDash([]);
  };
  const draw = () => {
    animationFrame = 0;
    if (!shouldRender()) return;
    if (!resize()) { schedule(); return; }
    context.clearRect(0, 0, cssWidth, cssHeight);
    lastLayers = [];
    ensureBins();
    const color = colors();
    if (analyzerDisplay.inputSpectrum && inputLeftAnalyser && inputRightAnalyser && inputLeftBins && inputRightBins) {
      inputLeftAnalyser.getFloatFrequencyData(inputLeftBins); inputRightAnalyser.getFloatFrequencyData(inputRightBins);
      drawCurve(inputLeftBins, inputLeftAnalyser, color.input, .28, .85);
      drawCurve(inputRightBins, inputRightAnalyser, color.input, .16, .85);
      lastLayers.push('inputSpectrum');
    }
    if (analyzerDisplay.filterResponse) {
      drawFilterResponse('left', color.left); drawFilterResponse('right', color.right);
      lastLayers.push('filterResponse');
    }
    if (analyzerDisplay.outputSpectrum && leftAnalyser && rightAnalyser && leftBins && rightBins) {
      leftAnalyser.getFloatFrequencyData(leftBins); rightAnalyser.getFloatFrequencyData(rightBins);
      const now = performance.now();
      captureTrail(now);
      if (analyzerDisplay.energyBloom) {
        drawEnergyBloom(leftBins, leftAnalyser, color.left);
        drawEnergyBloom(rightBins, rightAnalyser, color.right);
        lastLayers.push('energyBloom');
      }
      if (analyzerDisplay.spectrumTrail && outputTrail.length > 1) {
        outputTrail.slice(1).forEach((trail, index) => {
          const age = Math.max(0, now - trail.at);
          const trailAlpha = Math.max(0, .15 - age / 2200) * (1 - index * .25);
          if (!trailAlpha) return;
          drawCurve(trail.left, leftAnalyser, color.left, trailAlpha, .9);
          drawCurve(trail.right, rightAnalyser, color.right, trailAlpha * .7, .9);
        });
        lastLayers.push('spectrumTrail');
      }
      if (analyzerDisplay.spectrumFill) {
        drawOutputFill(leftBins, leftAnalyser, color.left, foreground === 'bars' ? .075 : .12);
        drawOutputFill(rightBins, rightAnalyser, color.right, foreground === 'bars' ? .045 : .075);
        lastLayers.push('spectrumFill');
      }
      const alpha = foreground === 'bars' ? .38 : .96;
      const width = foreground === 'bars' ? 1 : 1.65;
      drawCurve(leftBins, leftAnalyser, color.left, alpha, width);
      drawCurve(rightBins, rightAnalyser, color.right, alpha, width);
      if (analyzerDisplay.peakMarkers) {
        drawPeakMarkers(leftBins, leftAnalyser, color.left);
        drawPeakMarkers(rightBins, rightAnalyser, color.right);
        lastLayers.push('peakMarkers');
      }
      lastLayers.push('outputSpectrum');
    }
    context.globalAlpha = 1;
    schedule();
  };
  const schedule = () => { if (!animationFrame && shouldRender()) animationFrame = requestAnimationFrame(draw); };
  const refresh = () => { if (shouldRender()) schedule(); };
  const setVisible = nextVisible => {
    visible = Boolean(nextVisible);
    if (!visible && animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = 0; } else refresh();
  };
  const setForeground = nextForeground => { foreground = nextForeground === 'spectrum' ? 'spectrum' : 'bars'; updateButtons(); refresh(); };
  spectrumBarsButton.addEventListener('click', () => setForeground('bars'));
  spectrumCurveButton.addEventListener('click', () => setForeground('spectrum'));
  window.addEventListener('resize', () => { palette = null; refresh(); });
  new ResizeObserver(() => refresh()).observe(responseChart);
  new MutationObserver(() => { palette = null; }).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('da-filta-theme-change', () => { palette = null; refresh(); });
  updateButtons(); refresh();
window.FilterbankSpectrum = { frequencyToX, decibelsToY };
  return { setVisible, refresh, setForeground, getLayers: () => [...lastLayers] };
})();

export {
  spectrumRenderer
};
