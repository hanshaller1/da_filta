// Offline measurement only; all nonlinearities come from the production class.
const p = require('./input-character-oversampling.cjs');
const { ratesFor } = require('./input-character-architecture.cjs');
const stages = ['silk', 'tape', 'tube', 'console', 'crunch', 'destroy'];
function spectral(data, rate, frequency, limit = rate / 2) {
  const s = p.spectrum(data), n = data.length, fundamentalBin = Math.round(frequency * n / rate);
  const harmonics = new Set();
  for (let h = 2; h * frequency < limit; h++) harmonics.add(Math.round(h * frequency * n / rate));
  let fundamentalPower = 0, harmonicPower = 0, aliasPower = 0, totalPower = 0;
  for (let k = 1; k < s.re.length && k * rate / n < limit; k++) {
    const power = (2 * k === n ? 1 : 2) * (s.re[k] ** 2 + s.im[k] ** 2) / n ** 2;
    totalPower += power;
    if (k === fundamentalBin) fundamentalPower += power;
    else if (harmonics.has(k)) harmonicPower += power;
    else aliasPower += power;
  }
  return { limitHz: limit, fundamental: Math.sqrt(2 * fundamentalPower), fundamentalPhaseRadians: Math.atan2(s.im[fundamentalBin], s.re[fundamentalBin]), aliasFundamental: Math.sqrt(aliasPower / Math.max(1e-30, fundamentalPower)), aliasTotal: Math.sqrt(aliasPower / Math.max(1e-30, totalPower)), thd: Math.sqrt(harmonicPower / Math.max(1e-30, fundamentalPower)), totalRms: Math.sqrt(totalPower) };
}
function bandError(data, reference, rate, limit = 24000) {
  const difference = Float64Array.from(data, (x, i) => x - reference[i]);
  const s = p.spectrum(difference), n = data.length;
  let power = s.re[0] ** 2 / n ** 2;
  for (let k = 1; k < s.re.length && k * rate / n < limit; k++) power += (2 * k === n ? 1 : 2) * (s.re[k] ** 2 + s.im[k] ** 2) / n ** 2;
  return { limitHz: limit, rms: Math.sqrt(power), ratioToFullReferenceRms: Math.sqrt(power) / Math.max(1e-30, p.metrics(reference).rms) };
}
function source(rate, kind, amplitude, frequency = 10000) {
  return Float32Array.from({ length: Math.round(rate * .35) + 256 }, (_, i) => {
    const t = i / rate;
    if (kind === 'tone') return amplitude * Math.sin(2 * Math.PI * frequency * t);
    if (kind === 'sweep') {
      const k = Math.log(20000 / 100) / .3, u = Math.min(t, .3);
      return amplitude * Math.sin(2 * Math.PI * 100 * Math.expm1(k * u) / k);
    }
    if (kind === 'multitone') return amplitude * [173, 1000, 5000, 8000, 10000, 18000].reduce((sum, f, j) => sum + Math.sin(2 * Math.PI * f * t + j * .37), 0) / 6;
    // A continuous Gaussian transient has the same duration at both host rates.
    const pulse = .4 * Math.exp(-(((t - .04) / .00008) ** 2));
    if (t < .04) return amplitude * pulse;
    const u = t - .04;
    return amplitude * (.7 * Math.exp(-u * 50) * Math.sin(2 * Math.PI * (100 * u + 250 * .015 * (1 - Math.exp(-u / .015)))) + .3 * Math.exp(-u * 400) * Math.sin(2 * Math.PI * 9000 * u) + pulse);
  });
}
const resamplingCache = new WeakMap();
function variants(input, rate, stage, factors, first = .25, duration = .1) {
  const result = {};
  if (!resamplingCache.has(input)) resamplingCache.set(input, {});
  const cache = resamplingCache.get(input);
  for (const factor of factors) {
    if (!cache[factor]) { const up = p.prepare(input, factor); cache[factor] = { up, linear: p.down(up, factor) }; }
    const { up, linear } = cache[factor];
    const output = p.mix(input, p.wet(up, rate, stage, factor), linear, factor, 1, 'C');
    result[factor] = output.slice(Math.round(rate * first) + p.delay(factor), Math.round(rate * (first + duration)) + p.delay(factor));
  }
  return result;
}
function measureAdaptive() {
  const tones = [], signals = [], stress = [], convergence = [];
  for (const rate of [48000, 96000]) {
    for (const frequency of [100, 1000, 5000, 10000, 18000, 20000]) for (const amplitude of [.03, .25, .8]) {
      const input = source(rate, 'tone', amplitude, frequency);
      for (const stage of stages) {
        const old = ratesFor(rate)[stage], adaptive = ratesFor(rate, true)[stage];
        const rendered = variants(input, rate, stage, [...new Set([old, adaptive, 8])]);
        for (const factor of new Set([old, adaptive])) {
          const data = rendered[factor], ref = rendered[8];
          tones.push({ rate, stage, factor, policy: factor === adaptive ? 'adaptive' : 'old', frequency, amplitude, amount: 1,
            ...p.metrics(data), ...spectral(data, rate, frequency), commonBand: spectral(data, rate, frequency, 24000), referenceFactor: 8, referenceError: p.error(data, ref), referenceErrorRatio: p.error(data, ref).rms / p.metrics(ref).rms, commonBandReferenceError: bandError(data, ref, rate) });
        }
      }
    }
    process.stdout.write(`Adaptive tone matrix ${rate} Hz complete\n`);
    for (const kind of ['sweep', 'multitone', 'transient']) for (const amplitude of [.03, .25, .8]) {
      const input = source(rate, kind, amplitude);
      for (const stage of stages) {
        const old = ratesFor(rate)[stage], adaptive = ratesFor(rate, true)[stage];
        const rendered = variants(input, rate, stage, [...new Set([old, adaptive, 8])], 0, .35);
        for (const factor of new Set([old, adaptive])) {
          const data = rendered[factor], ref = rendered[8];
          signals.push({ rate, stage, factor, policy: factor === adaptive ? 'adaptive' : 'old', kind, amplitude, amount: 1,
            ...p.metrics(data), aliasFundamental: null, aliasTotal: null, thd: null, referenceFactor: 8, referenceError: p.error(data, ref), referenceErrorRatio: p.error(data, ref).rms / Math.max(1e-30, p.metrics(ref).rms), commonBandReferenceError: bandError(data, ref, rate) });
        }
      }
    }
    for (const sourcePeak of [.25, .8]) for (const gainDb of [0, 6, 12, 24]) {
      const amplitude = sourcePeak * 10 ** (gainDb / 20), frequency = 10000;
      const old = ratesFor(rate).destroy, adaptive = ratesFor(rate, true).destroy;
      const rendered = variants(source(rate, 'tone', amplitude, frequency), rate, 'destroy', [...new Set([old, adaptive, 16, 32])]);
      for (const factor of new Set([old, adaptive])) {
        const data = rendered[factor], ref = rendered[16];
        stress.push({ rate, stage: 'destroy', factor, policy: factor === adaptive ? 'adaptive' : 'old', frequency, sourcePeak, gainDb, amplitude, amount: 1,
          ...p.metrics(data), ...spectral(data, rate, frequency), commonBand: spectral(data, rate, frequency, 24000), referenceFactor: 16, referenceError: p.error(data, ref), referenceErrorRatio: p.error(data, ref).rms / p.metrics(ref).rms, commonBandReferenceError: bandError(data, ref, rate) });
      }
      convergence.push({ rate, sourcePeak, gainDb, factors: [16, 32], error: p.error(rendered[16], rendered[32]), ratio: p.error(rendered[16], rendered[32]).rms / p.metrics(rendered[32]).rms });
    }
    process.stdout.write(`Adaptive signals and DESTROY stress ${rate} Hz complete\n`);
    for (const stage of stages) {
      const rendered = variants(source(rate, 'tone', .8, 10000), rate, stage, [8, 16]);
      convergence.push({ rate, stage, amplitude: .8, frequency: 10000, factors: [8, 16], error: p.error(rendered[8], rendered[16]), ratio: p.error(rendered[8], rendered[16]).rms / p.metrics(rendered[16]).rms });
    }
  }
  const pairs = tones.filter(x => x.rate === 48000).map(a => {
    const b = tones.find(x => x.rate === 96000 && x.policy === 'adaptive' && x.stage === a.stage && x.frequency === a.frequency && x.amplitude === a.amplitude);
    return { stage: a.stage, frequency: a.frequency, amplitude: a.amplitude, low: a.commonBand, high: b.commonBand, aliasDifference: b.commonBand.aliasFundamental - a.commonBand.aliasFundamental, referenceError48: a.commonBandReferenceError.ratioToFullReferenceRms, referenceError96: b.commonBandReferenceError.ratioToFullReferenceRms };
  });
  const stressPairs = stress.filter(x => x.rate === 48000).map(a => {
    const b = stress.find(x => x.rate === 96000 && x.policy === 'adaptive' && x.sourcePeak === a.sourcePeak && x.gainDb === a.gainDb);
    return { sourcePeak: a.sourcePeak, gainDb: a.gainDb, amplitude: a.amplitude, alias48: a.commonBand.aliasFundamental, alias96: b.commonBand.aliasFundamental, fullAlias96: b.aliasFundamental, error48: a.commonBandReferenceError.ratioToFullReferenceRms, error96: b.commonBandReferenceError.ratioToFullReferenceRms };
  });
  return { tones, signals, stress, pairs, stressPairs, convergence, filter: p.filterQuality(), referenceCaveat: '8x is a normal reference, 16x with 32x convergence check for DESTROY stress. These are finite references, not ideal alias-free ground truth. Single-tone aliases exclude true in-band harmonics; folded products on fundamental/harmonics are unidentifiable. Nonstationary aliases and THD are intentionally null; common-band reference error is not pure alias energy.' };
}
module.exports = { measureAdaptive, source, spectral, variants };
