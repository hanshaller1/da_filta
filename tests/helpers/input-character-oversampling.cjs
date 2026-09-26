// Test-only prototype. Production curves/process() are evaluated without copying them.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../input-preamp-processor.js'), 'utf8');
const classes = new Map();
function productionClass(rate) {
  if (!classes.has(rate)) {
    let Processor;
    vm.runInNewContext(source, {
      sampleRate: rate, Math, Number, Object, Float64Array,
      AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null }; } },
      registerProcessor: (_, value) => { Processor = value; }
    }, { filename: 'input-preamp-processor.js' });
    classes.set(rate, Processor);
  }
  return classes.get(rate);
}
function processor(rate, stage, tubeLocation = 'internal') {
  const Class = productionClass(rate);
  const node = new Class({ processorOptions: { stage, characterAmount: 1, inputGainDb: 0 } });
  if (stage === 'tube' && tubeLocation === 'host') {
    // Reuse the production bias/tanh mapping, exposing its pre-DC-block value.
    const original = node.shapeTube;
    node.shapeTube = function (sample, channel) {
      original.call(this, sample, channel);
      return this.tubePreviousInput[channel];
    };
  }
  return node;
}
function processProduction(input, rate, stage, tubeLocation = 'internal') {
  const node = processor(rate, stage, tubeLocation);
  const out = new Float32Array(input.length);
  for (let first = 0; first < input.length; first += 128) {
    const last = Math.min(first + 128, input.length);
    node.process([[input.subarray(first, last)]], [[out.subarray(first, last)]]);
  }
  return out;
}
const twiddles = new Map();
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size *= 2) {
    if (!twiddles.has(size)) {
      const real = new Float64Array(size / 2), imaginary = new Float64Array(size / 2);
      for (let k = 0; k < size / 2; k++) { real[k] = Math.cos(-2 * Math.PI * k / size); imaginary[k] = Math.sin(-2 * Math.PI * k / size); }
      twiddles.set(size, [real, imaginary]);
    }
    const [wr, wi] = twiddles.get(size), half = size / 2;
    for (let first = 0; first < n; first += size) for (let k = 0; k < half; k++) {
      const left = first + k, right = left + half;
      const wim = inverse ? -wi[k] : wi[k];
      const tr = re[right] * wr[k] - im[right] * wim;
      const ti = re[right] * wim + im[right] * wr[k];
      re[right] = re[left] - tr; im[right] = im[left] - ti;
      re[left] += tr; im[left] += ti;
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
const powerOfTwo = n => 2 ** Math.ceil(Math.log2(n));
function spectrum(data) {
  // Bluestein transform: coherent windows need not have power-of-two lengths.
  const n = data.length, m = powerOfTwo(2 * n - 1);
  const ar = new Float64Array(m), ai = new Float64Array(m);
  const br = new Float64Array(m), bi = new Float64Array(m);
  for (let k = 0; k < n; k++) {
    const angle = Math.PI * ((k * k) % (2 * n)) / n;
    const c = Math.cos(angle), s = Math.sin(angle);
    ar[k] = data[k] * c; ai[k] = -data[k] * s;
    br[k] = c; bi[k] = s;
    if (k) { br[m - k] = c; bi[m - k] = s; }
  }
  fft(ar, ai); fft(br, bi);
  for (let k = 0; k < m; k++) {
    const real = ar[k] * br[k] - ai[k] * bi[k];
    ai[k] = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = real;
  }
  fft(ar, ai, true);
  const re = new Float64Array(Math.floor(n / 2) + 1), im = new Float64Array(re.length);
  for (let k = 0; k < re.length; k++) {
    const angle = Math.PI * ((k * k) % (2 * n)) / n, c = Math.cos(angle), s = Math.sin(angle);
    re[k] = ar[k] * c + ai[k] * s;
    im[k] = ai[k] * c - ar[k] * s;
  }
  return { re, im, n };
}
function bessel0(x) {
  let term = 1, sum = 1;
  for (let k = 1; k < 100; k++) { term *= (x * x / 4) / (k * k); sum += term; if (term < sum * 1e-16) break; }
  return sum;
}
const TAPS = 257, BETA = 8.6, CUTOFF = .2375;
const kernel = new Float64Array(TAPS);
let kernelSum = 0;
for (let i = 0; i < TAPS; i++) {
  const x = i - (TAPS - 1) / 2;
  const sinc = x === 0 ? 2 * CUTOFF : Math.sin(2 * Math.PI * CUTOFF * x) / (Math.PI * x);
  const window = bessel0(BETA * Math.sqrt(Math.max(0, 1 - (2 * i / (TAPS - 1) - 1) ** 2))) / bessel0(BETA);
  kernel[i] = sinc * window; kernelSum += kernel[i];
}
for (let i = 0; i < TAPS; i++) kernel[i] /= kernelSum;
const filterFFTs = new Map();
function filter(input) {
  const n = powerOfTwo(input.length + TAPS - 1);
  const re = new Float64Array(n), im = new Float64Array(n); re.set(input);
  if (!filterFFTs.has(n)) {
    const hr = new Float64Array(n), hi = new Float64Array(n); hr.set(kernel); fft(hr, hi); filterFFTs.set(n, [hr, hi]);
  }
  const [hr, hi] = filterFFTs.get(n); fft(re, im);
  for (let i = 0; i < n; i++) {
    const real = re[i] * hr[i] - im[i] * hi[i];
    im[i] = re[i] * hi[i] + im[i] * hr[i]; re[i] = real;
  }
  fft(re, im, true);
  return re.slice(0, input.length);
}
function up2(input) {
  const zeroStuffed = new Float64Array(input.length * 2);
  for (let i = 0; i < input.length; i++) zeroStuffed[i * 2] = input[i] * 2;
  return filter(zeroStuffed);
}
function down2(input) {
  const filtered = filter(input), out = new Float64Array(Math.ceil(input.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = filtered[i * 2];
  return out;
}
function prepare(input, factor) {
  let up = input;
  for (let f = 1; f < factor; f *= 2) up = up2(up);
  return Float32Array.from(up);
}
function down(input, factor) { for (let f = factor; f > 1; f /= 2) input = down2(input); return input; }
function delay(factor) { return factor === 1 ? 0 : 256 * (1 - 1 / factor); }
function wet(prepared, rate, stage, factor, tubeLocation = 'internal') {
  let result = down(processProduction(prepared, rate * factor, stage, tubeLocation), factor);
  if (stage === 'tube' && tubeLocation === 'host') {
    const a = Math.pow(.9987, 48000 / rate), blocked = new Float64Array(result.length);
    let previousInput = 0, previousOutput = 0;
    for (let i = 0; i < result.length; i++) {
      blocked[i] = result[i] - previousInput + a * previousOutput;
      previousInput = result[i]; previousOutput = blocked[i];
    }
    result = blocked;
  }
  return result;
}
function mix(input, shaped, linearFiltered, factor, amount, architecture = 'C') {
  const d = delay(factor), out = new Float64Array(input.length);
  for (let i = 0; i < out.length; i++) {
    const original = input[i], delayed = i >= d ? input[i - d] : 0;
    if (architecture === 'A') out[i] = original + amount * (shaped[i] - original);
    else if (architecture === 'B') out[i] = delayed + amount * (shaped[i] - delayed);
    else out[i] = delayed + amount * (shaped[i] - linearFiltered[i]);
  }
  return out;
}
function metrics(data) {
  let sum = 0, dc = 0, peak = 0, finite = true;
  for (const x of data) { sum += x * x; dc += x; peak = Math.max(peak, Math.abs(x)); finite &&= Number.isFinite(x); }
  return { rms: Math.sqrt(sum / data.length), peak, dc: dc / data.length, finite };
}
function error(a, b) {
  let sum = 0, maximum = 0;
  for (let i = 0; i < a.length; i++) { const e = a[i] - b[i]; sum += e * e; maximum = Math.max(maximum, Math.abs(e)); }
  return { rms: Math.sqrt(sum / a.length), maximum };
}
function filterQuality() {
  const n = 65536, re = new Float64Array(n), im = new Float64Array(n); re.set(kernel); fft(re, im);
  let passMin = Infinity, passMax = 0, stopMax = 0;
  for (let k = 0; k <= n / 2; k++) {
    const magnitude = Math.hypot(re[k], im[k]), f = k / n;
    if (f <= .225) { passMin = Math.min(passMin, magnitude); passMax = Math.max(passMax, magnitude); }
    if (f >= .25) stopMax = Math.max(stopMax, magnitude);
  }
  return { taps: TAPS, order: TAPS - 1, beta: BETA, cutoff: CUTOFF, passbandEnd: .225, stopbandStart: .25, passMin, passMax, rippleDb: 20 * Math.log10(passMax / passMin), stopbandDb: 20 * Math.log10(stopMax), latencySamples: { 1: delay(1), 2: delay(2), 4: delay(4), 8: delay(8), 16: delay(16) } };
}

// Causal, allocation-free-per-block FIR implementation for streaming cost measurements.
class Up2Stream {
  constructor() { this.ring = new Float64Array(256); this.position = 0; }
  process(input, output) {
    for (let i = 0; i < input.length; i++) {
      this.ring[this.position] = input[i];
      for (let phase = 0; phase < 2; phase++) {
        let sum = 0, p = this.position;
        for (let tap = phase; tap < TAPS; tap += 2) { sum += kernel[tap] * this.ring[p]; p = (p - 1) & 255; }
        output[2 * i + phase] = sum * 2;
      }
      this.position = (this.position + 1) & 255;
    }
  }
}
class Down2Stream {
  constructor() { this.ring = new Float64Array(512); this.position = 0; }
  process(input, output) {
    for (let i = 0; i < input.length; i++) {
      this.ring[this.position] = input[i];
      if (!(i & 1)) {
        let sum = 0, p = this.position;
        for (let tap = 0; tap < TAPS; tap++) { sum += kernel[tap] * this.ring[p]; p = (p - 1) & 511; }
        output[i / 2] = sum;
      }
      this.position = (this.position + 1) & 511;
    }
  }
}
class StreamingPrototype {
  constructor(rate, stage, factor, channels = 2, architecture = 'C', amount = 1) {
    this.architecture = architecture; this.amount = amount;
    this.factor = factor; this.channels = channels; this.latency = delay(factor);
    this.node = processor(rate * factor, stage);
    this.ups = []; this.downs = []; this.buffers = []; this.delays = [];
    this.shaped = Array.from({ length: channels }, () => new Float32Array(128 * factor));
    this.final = Array.from({ length: channels }, () => new Float32Array(128));
    this.inputsWrapper = [null]; this.outputsWrapper = [this.shaped];
    for (let c = 0; c < channels; c++) {
      this.ups[c] = []; this.downs[c] = []; this.buffers[c] = [];
      for (let f = 2; f <= factor; f *= 2) {
        this.ups[c].push(new Up2Stream()); this.downs[c].push(new Down2Stream());
        this.buffers[c].push(new Float32Array(128 * f));
      }
      this.delays[c] = { data: new Float32Array(Math.max(1, this.latency)), position: 0 };
    }
    this.internalInputs = Array(channels);
  }
  process(inputs) {
    if (this.factor === 1) {
      this.inputsWrapper[0] = inputs; this.node.process(this.inputsWrapper, this.outputsWrapper); return this.shaped;
    }
    for (let c = 0; c < this.channels; c++) {
      let input = inputs[c];
      for (let i = 0; i < this.ups[c].length; i++) { this.ups[c][i].process(input, this.buffers[c][i]); input = this.buffers[c][i]; }
      this.internalInputs[c] = input;
    }
    this.inputsWrapper[0] = this.internalInputs; this.node.process(this.inputsWrapper, this.outputsWrapper);
    for (let c = 0; c < this.channels; c++) {
      const high = this.shaped[c], original = this.internalInputs[c];
      if (this.architecture === 'C') for (let i = 0; i < high.length; i++) high[i] -= original[i];
      let input = high;
      for (let i = this.downs[c].length - 1; i >= 0; i--) {
        const output = i === 0 ? this.final[c] : this.buffers[c][i - 1];
        this.downs[c][i].process(input, output); input = output;
      }
      const history = this.delays[c];
      for (let i = 0; i < 128; i++) {
        if (this.architecture === 'A') {
          this.final[c][i] = inputs[c][i] + this.amount * (this.final[c][i] - inputs[c][i]);
          continue;
        }
        const dry = history.data[history.position];
        this.final[c][i] = this.architecture === 'C'
          ? dry + this.amount * this.final[c][i]
          : dry + this.amount * (this.final[c][i] - dry);
        history.data[history.position] = inputs[c][i];
        history.position++; if (history.position === history.data.length) history.position = 0;
      }
    }
    return this.final;
  }
}
module.exports = { processProduction, productionClass, processor, fft, spectrum, prepare, down, wet, mix, delay, metrics, error, filterQuality, StreamingPrototype, Up2Stream, Down2Stream };
