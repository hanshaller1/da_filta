const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const p = require('./input-character-oversampling.cjs');
const rates = [44100, 48000, 96000];
const stages = ['silk', 'tape', 'tube', 'console', 'crunch', 'destroy'];
const factors = [1, 2, 4, 8];
const amounts = [.25, .5, .75, 1];
const frequencies = [100, 1000, 5000, 8000, 10000, 12000];
const amplitudes = [.03, .25, .8];
const directory = path.resolve(__dirname, '../measurements');
fs.mkdirSync(directory, { recursive: true });
const report = { filter: p.filterQuality(), rates, stages, factors, amounts, frequencies, amplitudes, tones: [], signals: [], mix: [], tube: [], switches: [], cpu: [], convergence: [], validation: {} };
report.productionHash = createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../../input-preamp-processor.js'))).digest('hex');
report.environment = { node: process.version, platform: process.platform, arch: process.arch };
const db = ratio => 20 * Math.log10(Math.max(1e-15, ratio));
const segment = (data, rate, factor, first = .25, duration = .1) => data.slice(Math.round(rate * first) + p.delay(factor), Math.round(rate * (first + duration)) + p.delay(factor));
function sine(rate, frequency, amplitude, duration = .35) {
  return Float32Array.from({ length: Math.round(rate * duration) + 256 }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
}
function analyze(data, rate, frequency) {
  const spec = p.spectrum(data), N = data.length;
  const fundamentalBin = Math.round(frequency * N / rate);
  const fundamentalPower = 2 * (spec.re[fundamentalBin] ** 2 + spec.im[fundamentalBin] ** 2) / N ** 2;
  const harmonicBins = new Set();
  for (let h = 2; h * frequency < rate / 2; h++) harmonicBins.add(Math.round(h * frequency * N / rate));
  let harmonicPower = 0, aliasPower = 0, totalPower = 0;
  for (let k = 1; k < spec.re.length; k++) {
    const factor = 2 * k === N ? 1 : 2;
    const power = factor * (spec.re[k] ** 2 + spec.im[k] ** 2) / N ** 2;
    totalPower += power;
    if (harmonicBins.has(k)) harmonicPower += power;
    else if (k !== fundamentalBin) aliasPower += power;
  }
  return { ...p.metrics(data), fundamental: Math.sqrt(2 * fundamentalPower), harmonicPower, aliasPower, totalPower,
    aliasFundamental: Math.sqrt(aliasPower / Math.max(1e-30, fundamentalPower)), aliasTotal: Math.sqrt(aliasPower / Math.max(1e-30, totalPower)), thd: Math.sqrt(harmonicPower / Math.max(1e-30, fundamentalPower)) };
}
function variants(input, rate, factor, tubeLocation = 'internal') {
  const up = p.prepare(input, factor), linear = p.down(up, factor);
  return { linear, wet: Object.fromEntries(stages.map(stage => [stage, p.wet(up, rate, stage, factor, tubeLocation)])) };
}

// Validate coherent spectral analysis and exact FFT/streaming FIR equivalence.
const known = sine(48000, 1000, .8);
report.validation.fftAmplitude = analyze(segment(known, 48000, 1), 48000, 1000).fundamental;
report.validation.streaming = [];
for (const factor of [2, 4]) for (const stage of ['linear', 'tube', 'destroy']) {
  const input = Float32Array.from({ length: 4096 }, (_, i) => .5 * Math.sin(i * .31) + .1 * Math.sin(i * .047));
  const up = p.prepare(input, factor), linear = p.down(up, factor), shaped = p.wet(up, 48000, stage, factor);
  const expected = p.mix(input, shaped, linear, factor, 1, 'C');
  const actual = new Float32Array(input.length), stream = new p.StreamingPrototype(48000, stage, factor, 1);
  for (let first = 0; first < input.length; first += 128) actual.set(stream.process([input.subarray(first, first + 128)])[0], first);
  report.validation.streaming.push({ factor, stage, ...p.error(actual, expected) });
}

for (const rate of rates) {
  for (const frequency of frequencies) for (const amplitude of amplitudes) {
    const input = sine(rate, frequency, amplitude), rendered = Object.fromEntries(factors.map(factor => [factor, variants(input, rate, factor)]));
    for (const stage of stages) for (const amount of amounts) {
      const reference = segment(p.mix(input, rendered[8].wet[stage], rendered[8].linear, 8, amount), rate, 8);
      for (const factor of [1, 2, 4]) {
        const output = segment(p.mix(input, rendered[factor].wet[stage], rendered[factor].linear, factor, amount), rate, factor);
        report.tones.push({ rate, frequency, amplitude, stage, amount, factor, ...analyze(output, rate, frequency), referenceError: p.error(output, reference), referenceErrorRatio: p.error(output, reference).rms / p.metrics(reference).rms });
      }
    }
  }
  process.stdout.write(`Finished sine matrix at ${rate} Hz\n`);
}

// Additional legal +24 dB stress; reference convergence is explicitly checked below.
for (const rate of rates) {
  const frequency = 10000, amplitude = .8 * 10 ** (24 / 20), input = sine(rate, frequency, amplitude);
  const rendered = Object.fromEntries([1, 2, 4, 16].map(factor => [factor, variants(input, rate, factor)]));
  for (const stage of stages) for (const factor of [1, 2, 4]) {
    const output = segment(p.mix(input, rendered[factor].wet[stage], rendered[factor].linear, factor, 1), rate, factor);
    const reference = segment(p.mix(input, rendered[16].wet[stage], rendered[16].linear, 16, 1), rate, 16);
    report.tones.push({ rate, frequency, amplitude, gainStress: 24, stage, amount: 1, factor, ...analyze(output, rate, frequency), referenceError: p.error(output, reference), referenceErrorRatio: p.error(output, reference).rms / p.metrics(reference).rms });
  }
}

for (const rate of rates) {
  for (const kind of ['sweep', 'multitone', 'drum']) for (const amplitude of amplitudes) {
    const length = Math.round(rate * .35) + 256;
    const input = new Float32Array(length);
    const lo = 100, hi = Math.min(18000, rate * .4), duration = .3;
    const k = Math.log(hi / lo) / duration;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      if (kind === 'sweep') input[i] = amplitude * Math.sin(2 * Math.PI * lo * Math.expm1(k * Math.min(t, duration)) / k);
      if (kind === 'multitone') input[i] = amplitude * [100, 1000, 5000, 8000, 10000, 12000].reduce((sum, f, j) => sum + Math.sin(2 * Math.PI * f * t + j * .37), 0) / 6;
      if (kind === 'drum' && t >= .04) {
        const u = t - .04;
        input[i] = amplitude * (.7 * Math.exp(-u * 50) * Math.sin(2 * Math.PI * (100 * u + 250 * (.015 * (1 - Math.exp(-u / .015))))) + .3 * Math.exp(-u * 400) * Math.sin(2 * Math.PI * 9000 * u));
        if (i === Math.round(rate * .04)) input[i] += amplitude;
      }
    }
    const rendered = Object.fromEntries(factors.map(factor => [factor, variants(input, rate, factor)]));
    for (const stage of stages) for (const amount of amounts) {
      const reference = segment(p.mix(input, rendered[8].wet[stage], rendered[8].linear, 8, amount), rate, 8, 0, .35);
      for (const factor of [1, 2, 4]) {
        const output = segment(p.mix(input, rendered[factor].wet[stage], rendered[factor].linear, factor, amount), rate, factor, 0, .35);
        const refMetric = p.metrics(reference);
        report.signals.push({ rate, kind, amplitude, stage, amount, factor, ...p.metrics(output), referenceError: p.error(output, reference), referenceErrorRatio: p.error(output, reference).rms / Math.max(1e-20, refMetric.rms) });
      }
    }
  }
  process.stdout.write(`Finished sweep/multitone/drum at ${rate} Hz\n`);
}

// Compare A/B/C using LINEAR, so no nonlinear harmonic change can hide comb filtering.
for (const rate of rates) for (const factor of [2, 4]) {
  const response = { rate, factor, latencySamples: p.delay(factor), latencyMs: 1000 * p.delay(factor) / rate, amounts: [] };
  for (const amount of amounts) for (const architecture of ['A', 'B', 'C']) {
    let minimumGain = Infinity, maximumGain = 0, worstFrequency = 0, maximumError = 0;
    const limit = Math.min(20000, rate * .45), grid = [];
    for (let frequency = 100; frequency <= limit; frequency += 100) grid.push(frequency);
    for (let n = 0; (n + .5) * rate / p.delay(factor) <= limit; n++) grid.push((n + .5) * rate / p.delay(factor));
    for (const frequency of grid) {
      // Exact complex response of the cascade's FIRs on both rate-conversion passes.
      let gain = 1;
      for (let f = 2; f <= factor; f *= 2) {
        const impulse = new Float32Array(1024); impulse[0] = 1;
        // Frequency response is obtained from the same test-only resampling filter.
        // Cached impulse FFT below avoids rebuilding a full audio render per tone.
        const key = f;
        if (!report._impulseCache) report._impulseCache = {};
        if (!report._impulseCache[key]) {
          const hi = p.prepare(impulse, 2), low = p.down(hi, 2);
          report._impulseCache[key] = low;
        }
        const impulseResponse = report._impulseCache[key];
        let re = 0, im = 0;
        for (let i = 0; i < impulseResponse.length; i++) {
          const angle = 2 * Math.PI * frequency * i / (rate * f / 2);
          re += impulseResponse[i] * Math.cos(angle); im -= impulseResponse[i] * Math.sin(angle);
        }
        gain *= Math.hypot(re, im);
      }
      const phase = -2 * Math.PI * frequency * p.delay(factor) / rate;
      let magnitude;
      if (architecture === 'A') magnitude = Math.hypot(1 - amount + amount * gain * Math.cos(phase), amount * gain * Math.sin(phase));
      else if (architecture === 'B') magnitude = 1 - amount + amount * gain;
      else magnitude = 1;
      if (magnitude < minimumGain) { minimumGain = magnitude; worstFrequency = frequency; }
      maximumGain = Math.max(maximumGain, magnitude); maximumError = Math.max(maximumError, Math.abs(magnitude - 1));
    }
    response.amounts.push({ amount, architecture, minimumGainDb: db(minimumGain), maximumGainDb: db(maximumGain), worstFrequency, maximumError });
  }
  report.mix.push(response);
}
delete report._impulseCache;

// TUBE internal-rate vs host-rate blocker: same analog cutoff, differing passband gain.
for (const rate of rates) for (const factor of [2, 4]) for (const frequency of [5, 10, 100, 1000]) {
  const input = sine(rate, frequency, .1, 1.3), up = p.prepare(input, factor);
  const internal = segment(p.wet(up, rate, 'tube', factor), rate, factor, 1, .2);
  const host = segment(p.wet(up, rate, 'tube', factor, 'host'), rate, factor, 1, .2);
  report.tube.push({ rate, factor, frequency, internalPole: Math.pow(.9987, 48000 / (rate * factor)), hostPole: Math.pow(.9987, 48000 / rate), cutoffHz: -Math.log(.9987) * 48000 / (2 * Math.PI), internal: p.metrics(internal), host: p.metrics(host), difference: p.error(internal, host) });
}

// Empirical reference convergence, including the extreme DESTROY drive.
for (const rate of rates) for (const amplitude of [.8, .8 * 10 ** (24 / 20)]) {
  const input = sine(rate, 10000, amplitude), referenceFactors = amplitude > 1 ? [16, 32] : [8, 16];
  const outputs = referenceFactors.map(factor => {
    const up = p.prepare(input, factor), linear = p.down(up, factor);
    return segment(p.mix(input, p.wet(up, rate, 'destroy', factor), linear, factor, 1), rate, factor);
  });
  report.convergence.push({ rate, amplitude, factors: referenceFactors, error: p.error(outputs[0], outputs[1]), relativeError: p.error(outputs[0], outputs[1]).rms / p.metrics(outputs[1]).rms });
}

// Existing exponential 15 ms crossfade, with and without common latency padding.
const switchFactors = { linear: 1, silk: 1, tape: 2, tube: 2, console: 2, crunch: 1, destroy: 4 };
for (const rate of rates) for (const frequency of [1373, 10000]) for (const [from, to] of [['linear', 'destroy'], ['tape', 'tube'], ['destroy', 'silk']]) {
  const input = sine(rate, frequency, .25, .5);
  const stageOutput = stage => {
    const factor = switchFactors[stage], up = p.prepare(input, factor), linear = p.down(up, factor);
    return { factor, data: p.mix(input, p.wet(up, rate, stage, factor), linear, factor, .5) };
  };
  const a = stageOutput(from), b = stageOutput(to);
  for (const matched of [false, true]) {
    const sharedDelay = 192, first = Math.round(rate * .2), length = Math.round(rate * .15), output = new Float64Array(length);
    let maximumDelta = 0, startJump = 0;
    const read = (r, index) => r.data[index - (matched ? sharedDelay - p.delay(r.factor) : 0)] || 0;
    let previous = read(a, first - 1);
    for (let n = 0; n < length; n++) {
      const weight = 1 - Math.exp(-(n + 1) / (rate * .015));
      const value = read(a, first + n) * (1 - weight) + read(b, first + n) * weight;
      maximumDelta = Math.max(maximumDelta, Math.abs(value - previous));
      if (!n) startJump = Math.abs(value - read(a, first));
      output[n] = value; previous = value;
    }
    report.switches.push({ rate, frequency, from, to, matched, fromDelay: p.delay(a.factor), toDelay: p.delay(b.factor), sharedDelay: matched ? sharedDelay : null, startDeviation: startJump, maximumSampleDelta: maximumDelta, ...p.metrics(output) });
  }
}

// Same-process warmed streaming benchmark; includes FIR, stereo and production process().
let sink = 0;
for (const rate of [48000, 96000]) for (const stage of stages) {
  const inputs = [Float32Array.from({ length: 128 }, (_, i) => .8 * Math.sin(i * .13)), Float32Array.from({ length: 128 }, (_, i) => .8 * Math.sin(i * .13 + .3))];
  const baseline = [];
  for (const factor of [1, 2, 4]) {
    const stream = new p.StreamingPrototype(rate, stage, factor, 2);
    for (let i = 0; i < 32; i++) sink += stream.process(inputs)[0][0];
    const elapsed = [];
    const iterations = 128;
    for (let repeat = 0; repeat < 3; repeat++) {
      const first = performance.now();
      for (let i = 0; i < iterations; i++) sink += stream.process(inputs)[0][0];
      elapsed.push(performance.now() - first);
    }
    elapsed.sort((a, b) => a - b);
    const milliseconds = elapsed[1], frames = iterations * 128;
    if (factor === 1) baseline.push(milliseconds);
    report.cpu.push({ rate, stage, factor, channels: 2, frames, milliseconds, relative: milliseconds / baseline[0], cpuFraction: milliseconds / (1000 * frames / rate), internalRate: factor * rate });
  }
}
// Architecture CPU comparison at partial Amount, separate from the stage benchmark.
report.mixCpu = [];
for (const rate of [48000, 96000]) for (const factor of [2, 4]) for (const architecture of ['A', 'B', 'C']) {
  const inputs = [Float32Array.from({ length: 128 }, (_, i) => .8 * Math.sin(i * .13)), Float32Array.from({ length: 128 }, (_, i) => .8 * Math.sin(i * .13 + .3))];
  const stream = new p.StreamingPrototype(rate, 'destroy', factor, 2, architecture, .5);
  for (let i = 0; i < 32; i++) stream.process(inputs);
  const elapsed = [];
  for (let repeat = 0; repeat < 3; repeat++) {
    const start = performance.now();
    for (let i = 0; i < 128; i++) stream.process(inputs);
    elapsed.push(performance.now() - start);
  }
  elapsed.sort((a, b) => a - b);
  report.mixCpu.push({ rate, factor, architecture, amount: .5, milliseconds: elapsed[1], cpuFraction: elapsed[1] / (1000 * 16384 / rate) });
}
report.benchmarkSinkFinite = Number.isFinite(sink);
const summary = stages.map(stage => {
  const rows = report.tones.filter(r => r.stage === stage && !r.gainStress && r.amount === 1);
  const aliases = [1, 2, 4].map(factor => Math.max(...rows.filter(r => r.factor === factor).map(r => r.aliasFundamental)));
  const errors = [1, 2, 4].map(factor => Math.max(...rows.filter(r => r.factor === factor).map(r => r.referenceErrorRatio)));
  const representative = [1, 2, 4].map(factor => rows.find(r => r.rate === 44100 && r.frequency === 10000 && r.amplitude === .8 && r.factor === factor));
  const cpu = report.cpu.filter(r => r.stage === stage && r.rate === 48000).map(r => ({ factor: r.factor, relative: r.relative, cpuFraction: r.cpuFraction }));
  return { stage, maxAliasRatios: aliases, maxReferenceErrors: errors, aliasReductionDb: [db(aliases[0] / Math.max(1e-15, aliases[1])), db(aliases[0] / Math.max(1e-15, aliases[2]))], representative, cpu };
});
report.summary = summary;
fs.writeFileSync(path.join(directory, 'input-character-oversampling.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(directory, 'summary-input-character-oversampling.json'), JSON.stringify({ filter: report.filter, summary, mix: report.mix, convergence: report.convergence, cpu: report.cpu, validation: report.validation }, null, 2));
console.log('OVERSAMPLING_SUMMARY=' + JSON.stringify(summary.map(({ representative, ...row }) => row)));
module.exports = report;
