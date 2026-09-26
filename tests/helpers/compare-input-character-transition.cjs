const { CharacterArchitecture, ratesFor } = require('./input-character-architecture-p3b4.cjs');
const stages = ['linear', 'silk', 'tape', 'tube', 'console', 'crunch', 'destroy'];
const transitions = ['tube->destroy', 'tape->destroy', 'destroy->tape', 'destroy->tube',
  'linear->tape', 'tape->linear', 'linear->destroy', 'destroy->linear', 'tape->tube'];
function compare(mode) {
  const { OptimizedCharacterArchitecture } = require(mode === 'shape' ? './input-character-architecture-shape.cjs' : './input-character-architecture-optimized.cjs');
  const rows = [], contracts = [], controls = [], extremes = [];
  let stateMaximum = 0;
  const state = (a, b) => {
    for (const key of ['tubePreviousInput', 'tubePreviousOutput']) for (let c = 0; c < 2; c++)
      stateMaximum = Math.max(stateMaximum, Math.abs(a.tube[key][c] - b.tube[key][c]));
    for (const key of ['active', 'target', 'weight', 'amount', 'warmFrames', 'dryPosition', 'queued'])
      if (a[key] !== b[key]) throw new Error(`Control state differs: ${key}`);
  };
  for (const rate of [44100, 48000, 96000]) for (const name of [...stages, ...transitions]) for (const amount of [0, .25, .5, .75, 1]) {
    const rates = ratesFor(rate, true), from = name.split('->')[0], to = name.split('->')[1];
    const old = new CharacterArchitecture(rate, from, 'A', amount, rates);
    const next = new OptimizedCharacterArchitecture(rate, from, 'A', amount, rates, mode);
    const input = [new Float32Array(128), new Float32Array(128)], length = (to ? 160 : 40) * 128;
    const data = [new Float32Array(length), new Float32Array(length)];
    let maximum = 0, squared = 0, bits = 0, peakOld = 0, peakNew = 0, dryMaximum = 0;
    for (let first = 0; first < length; first += 128) {
      for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) {
        const t = first + i;
        data[c][t] = input[c][i] = (c ? -.07 : .12) + .72 * Math.sin(2 * Math.PI * (c ? 2203 : 1373) * t / rate)
          + .13 * Math.sin(2 * Math.PI * 11003 * t / rate) + (t % 997 === 0 ? (c ? -2 : 2) : 0);
      }
      if (to && first === 24 * 128) { old.request(to); next.request(to); }
      const a = old.process(input), b = next.process(input); state(old, next);
      for (let c = 0; c < 2; c++) {
        const ab = new Uint32Array(a[c].buffer), bb = new Uint32Array(b[c].buffer);
        for (let i = 0; i < 128; i++) {
          if (!Number.isFinite(b[c][i])) throw new Error('Nonfinite output');
          const delta = b[c][i] - a[c][i]; maximum = Math.max(maximum, Math.abs(delta)); squared += delta * delta;
          bits += ab[i] !== bb[i]; peakOld = Math.max(peakOld, Math.abs(a[c][i])); peakNew = Math.max(peakNew, Math.abs(b[c][i]));
          if (amount === 0 || name === 'linear') dryMaximum = Math.max(dryMaximum, Math.abs(b[c][i] - (first + i >= 192 ? data[c][first + i - 192] : 0)));
        }
      }
    }
    rows.push({ rate, case: name, amount, frames: length, maximum, rms: Math.sqrt(squared / (2 * length)), peakDifference: Math.abs(peakOld - peakNew), bitDifferences: bits, dryMaximum });
  }
  for (const rate of [44100, 48000, 96000]) for (const stage of stages) {
    const rates = ratesFor(rate, true), char = new OptimizedCharacterArchitecture(rate, stage, 'A', 1, rates, mode);
    if (stage === 'tube') char.tube.shape = (_, x) => x;
    else if (stage !== 'linear') char.branches[stage].node.shape = (_, x) => x;
    const input = [new Float32Array(128), new Float32Array(128)];
    let maximum = 0, stereoMaximum = 0, peakAt = -1;
    for (let block = 0; block < 12; block++) {
      input[0].fill(0); input[0][0] = block === 0 ? 1 : 0; input[1].set(input[0]);
      const out = char.process(input);
      for (let i = 0; i < 128; i++) { const t = block * 128 + i; maximum = Math.max(maximum, Math.abs(out[0][i] - (t === 192 ? 1 : 0))); stereoMaximum = Math.max(stereoMaximum, Math.abs(out[0][i] - out[1][i])); if (out[0][i] === 1) peakAt = t; }
    }
    contracts.push({ rate, stage, factor: rates[stage], delay: char.latency(stage), identityMaximum: maximum, stereoMaximum, peakAt, tubePole: char.tube.tubeDcPole, tubeCutoffHz: -Math.log(char.tube.tubeDcPole) * rate * rates.tube / (2 * Math.PI) });
  }
  for (const rate of [44100, 48000, 96000]) {
    const rates = ratesFor(rate, true), old = new CharacterArchitecture(rate, 'tube', 'A', .5, rates), next = new OptimizedCharacterArchitecture(rate, 'tube', 'A', .5, rates, mode);
    const input = [new Float32Array(128), new Float32Array(128)];
    let maximum = 0, stereoMaximum = 0, tubeStatePeak = 0, tubeFinal = 0, dcIncreases = 0, previousDc = Infinity;
    for (let block = 0; block < 700; block++) {
      // Legal input gain +24 dB on full-scale input; initial DC, alternating extrema, then DC decay.
      for (let i = 0; i < 128; i++) input[0][i] = block < 50 ? 10 ** (24 / 20) : block < 160 ? (i & 1 ? -1 : 1) * 10 ** (24 / 20) : 10 ** (24 / 20);
      input[1].set(input[0]);
      if ([20, 21, 22, 130, 230, 330].includes(block)) { const stage = ['destroy', 'tape', 'tube', 'linear', 'destroy', 'tube'][[20,21,22,130,230,330].indexOf(block)]; old.request(stage); next.request(stage); }
      if (block % 61 === 0) old.targetAmount = next.targetAmount = [0, .25, .5, .75, 1][(block / 61 | 0) % 5];
      if (block === 250 && old.panic() !== next.panic()) throw new Error('Panic mismatch');
      const a = old.process(input), b = next.process(input); state(old, next);
      for (let c = 0; c < 2; c++) for (let i = 0; i < 128; i++) { if (!Number.isFinite(b[c][i])) throw new Error('Nonfinite legal extreme'); maximum = Math.max(maximum, Math.abs(a[c][i] - b[c][i])); }
      for (let i = 0; i < 128; i++) stereoMaximum = Math.max(stereoMaximum, Math.abs(b[0][i] - b[1][i]));
      for (const value of next.tube.tubePreviousOutput) { if (!Number.isFinite(value)) throw new Error('Nonfinite tube state'); tubeStatePeak = Math.max(tubeStatePeak, Math.abs(value)); tubeFinal = Math.abs(value); }
      if (block > 170 && tubeFinal > previousDc + 1e-12) dcIncreases++;
      previousDc = tubeFinal;
    }
    controls.push({ rate, maximum, stereoMaximum, tubeStatePeak, tubeFinal, dcIncreases, amountAutomation: true, coalescedRequests: true, panic: true });
    for (const stage of stages) {
      const char = new OptimizedCharacterArchitecture(rate, stage, 'A', 1, rates, mode);
      let peak = 0, nonfinite = 0, stereo = 0;
      for (let i = 0; i < 128; i++) input[0][i] = (i % 3 === 0 ? 1 : -.8) * 10 ** (24 / 20);
      input[1].set(input[0]);
      for (let block = 0; block < 100; block++) {
        const out = char.process(input);
        for (let i = 0; i < 128; i++) { peak = Math.max(peak, Math.abs(out[0][i])); nonfinite += Number.isFinite(out[0][i]) && Number.isFinite(out[1][i]) ? 0 : 1; stereo = Math.max(stereo, Math.abs(out[0][i] - out[1][i])); }
      }
      extremes.push({ rate, stage, peak, nonfinite, stereo });
    }
  }
  return { mode, rows, contracts, controls, extremes, stateMaximum };
}
module.exports = { compare };
