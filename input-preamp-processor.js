// Promoted P3B.4/P3B.5 differential FIR architecture; 192 host samples of latency.
// Coefficients and every working buffer are constructed outside the render path.
const CHARACTER_TAPS = 257;
function characterBessel0(x) {
  let term = 1, sum = 1;
  for (let k = 1; k < 100; k += 1) {
    term *= (x * x / 4) / (k * k);
    sum += term;
    if (term < sum * 1e-16) break;
  }
  return sum;
}
const characterKernel = new Float64Array(CHARACTER_TAPS);
let characterKernelSum = 0;
for (let i = 0; i < CHARACTER_TAPS; i += 1) {
  const x = i - 128;
  const sinc = x === 0 ? 0.475 : Math.sin(2 * Math.PI * 0.2375 * x) / (Math.PI * x);
  const window = characterBessel0(8.6 * Math.sqrt(Math.max(0, 1 - (2 * i / 256 - 1) ** 2))) / characterBessel0(8.6);
  characterKernel[i] = sinc * window;
  characterKernelSum += characterKernel[i];
}
for (let i = 0; i < CHARACTER_TAPS; i += 1) characterKernel[i] /= characterKernelSum;

class CharacterUp2 {
  // Mirrored finite history removes a wrap mask from every FIR tap. The
  // coefficient and accumulation order remain the P1-C sample contract.
  constructor() { this.ring = new Float64Array(512); this.position = 0; }
  process(input, output, length) {
    for (let i = 0; i < length; i += 1) {
      this.ring[this.position] = this.ring[this.position + 256] = input[i];
      for (let phase = 0; phase < 2; phase += 1) {
        let sum = 0, position = this.position + 256;
        for (let tap = phase; tap < CHARACTER_TAPS; tap += 2) {
          sum += characterKernel[tap] * this.ring[position];
          position -= 1;
        }
        output[2 * i + phase] = sum * 2;
      }
      this.position = (this.position + 1) & 255;
    }
  }
}
class CharacterDown2 {
  constructor() { this.ring = new Float64Array(1024); this.position = 0; }
  process(input, output, length) {
    for (let i = 0; i < length; i += 1) {
      this.ring[this.position] = this.ring[this.position + 512] = input[i];
      if (!(i & 1)) {
        let sum = 0, position = this.position + 512;
        for (let tap = 0; tap < CHARACTER_TAPS; tap += 1) {
          sum += characterKernel[tap] * this.ring[position];
          position -= 1;
        }
        output[i / 2] = sum;
      }
      this.position = (this.position + 1) & 511;
    }
  }
}

class ResonantInputPreampProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const initial = options?.processorOptions || {};
    this.inputGainDb = this.normalizeGainDb(initial.inputGainDb);
    this.targetInputGainDb = this.inputGainDb;
    this.stage = this.normalizeStage(initial.stage);
    this.requestedStage = ResonantInputPreampProcessor.STAGES[this.stage];
    this.stageCrossfade = 1;
    this.characterAmount = this.normalizeCharacterAmount(initial.characterAmount);
    this.targetCharacterAmount = this.characterAmount;
    this.smoothingCoefficient = Math.exp(-1 / Math.max(1, sampleRate * 0.015));
    this.latencySamples = 192;
    this.rates = sampleRate === 96000 ? [1, 1, 1, 1, 1, 1, 2] : [1, 2, 2, 2, 2, 2, 4];
    this.tubeDcPole = Math.pow(0.9987, 48000 / (sampleRate * this.rates[3]));
    this.tubePreviousInput = new Float64Array(2);
    this.tubePreviousOutput = new Float64Array(2);
    this.inputSamples = [new Float32Array(128), new Float32Array(128)];
    this.high2 = [new Float32Array(256), new Float32Array(256)];
    this.tubeSamples = [new Float32Array(128 * this.rates[3]), new Float32Array(128 * this.rates[3])];
    this.up2 = [new CharacterUp2(), new CharacterUp2()];
    this.dry = [new Float32Array(192), new Float32Array(192)];
    this.dryPosition = 0;
    this.branches = new Array(7);
    for (let index = 0; index < 7; index += 1) this.branches[index] = this.createBranch(index);
    this.active = this.branches[this.requestedStage];
    this.target = null;
    this.warmFrames = 0;
    this.port.onmessage = event => this.handleMessage(event.data);
  }

  normalizeGainDb(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(24, numeric)) : 0;
  }

  normalizeCharacterAmount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.5;
  }

  normalizeStage(value) {
    return Object.prototype.hasOwnProperty.call(ResonantInputPreampProcessor.STAGES, value) ? value : 'linear';
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'set-input-gain-db') this.targetInputGainDb = this.normalizeGainDb(message.value);
    if (message.type === 'set-character-amount') this.targetCharacterAmount = this.normalizeCharacterAmount(message.value);
    if (message.type === 'set-input-stage') {
      this.stage = this.normalizeStage(message.value);
      // Latest requested target wins after the current aligned fade finishes.
      this.requestedStage = ResonantInputPreampProcessor.STAGES[this.stage];
    }
  }

  createBranch(index) {
    const factor = this.rates[index];
    const four = factor === 4;
    const padLength = 192 - (four ? 192 : factor === 2 ? 128 : 0);
    const branch = {
      index, factor,
      high: four ? [new Float32Array(512), new Float32Array(512)] : null,
      shaped: [new Float32Array(128 * factor), new Float32Array(128 * factor)],
      correction: [new Float32Array(128), new Float32Array(128)],
      mid: four ? [new Float32Array(256), new Float32Array(256)] : null,
      up4: four ? [new CharacterUp2(), new CharacterUp2()] : null,
      down4: four ? [new CharacterDown2(), new CharacterDown2()] : null,
      down2: factor >= 2 ? [new CharacterDown2(), new CharacterDown2()] : null,
      padding: [new Float32Array(padLength), new Float32Array(padLength)],
      padPosition: 0, resetFilters: [], resetBuffers: []
    };
    if (factor === 1) branch.correction = branch.shaped;
    for (let channel = 0; channel < 2; channel += 1) {
      if (four) branch.resetFilters.push(branch.up4[channel], branch.down4[channel]);
      if (branch.down2) branch.resetFilters.push(branch.down2[channel]);
      branch.resetBuffers.push(branch.shaped[channel], branch.correction[channel], branch.padding[channel]);
      if (four) branch.resetBuffers.push(branch.high[channel], branch.mid[channel]);
    }
    return branch;
  }

  beginTransition() {
    if (this.target || this.requestedStage === this.active.index) return;
    const branch = this.branches[this.requestedStage];
    for (let i = 0; i < branch.resetFilters.length; i += 1) {
      const filter = branch.resetFilters[i];
      filter.ring.fill(0);
      filter.position = 0;
    }
    for (let i = 0; i < branch.resetBuffers.length; i += 1) branch.resetBuffers[i].fill(0);
    branch.padPosition = 0;
    this.target = branch;
    this.stageCrossfade = 0;
    this.warmFrames = 384;
  }

  clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  shapeTube(sample, channel) {
    // Bias creates even harmonics. A 9.94 Hz (48 kHz reference) DC blocker removes waveform DC afterwards.
    const bias = 0.18;
    const biasedZero = Math.tanh(1.3 * bias);
    const biased = (Math.tanh(1.3 * (sample + bias)) - biasedZero) / 1.3;
    const previousInput = this.tubePreviousInput[channel] || 0;
    const previousOutput = this.tubePreviousOutput[channel] || 0;
    const dcBlocked = biased - previousInput + this.tubeDcPole * previousOutput;
    this.tubePreviousInput[channel] = biased;
    this.tubePreviousOutput[channel] = dcBlocked;
    return dcBlocked;
  }

  shape(stage, sample, channel) {
    const limited = this.clamp(sample, -12, 12);
    switch (stage) {
      case 1:
        // Long, symmetric and nearly transparent peak rounding.
        return limited / Math.sqrt(1 + 0.16 * limited * limited);
      case 2:
        // Broad atan compression gives a soft, glue-like curve.
        return Math.atan(1.45 * limited) / 1.45;
      case 3:
        return this.shapeTube(limited, channel);
      case 4:
        // Firmer rational knee, weighted toward odd harmonics.
        return limited / (1 + 0.48 * Math.abs(limited));
      case 5: {
        const magnitude = Math.abs(limited);
        const sign = limited < 0 ? -1 : 1;
        // Linear core, then a distinctly harder exponential shoulder.
        return magnitude <= 0.48
          ? limited
          : sign * (0.48 + 0.52 * (1 - Math.exp(-3.3 * (magnitude - 0.48))));
      }
      case 6: {
        const clipped = this.clamp(limited, -0.62, 0.62);
        // Hard clipping plus bounded fold-like harmonic deformation.
        return 0.58 * clipped + 0.42 * 0.82 * Math.sin(2.85 * limited);
      }
      default:
        return sample;
    }
  }

  runBranch(branch, frames) {
    if (branch.index === 0) return null;
    const factor = branch.factor;
    const high = factor === 4 ? branch.high : factor === 2 ? this.high2 : this.inputSamples;
    const highFrames = frames * factor;
    for (let channel = 0; channel < 2; channel += 1) {
      if (factor === 4) branch.up4[channel].process(this.high2[channel], high[channel], frames * 2);
      for (let i = 0; i < highFrames; i += 1) {
        const sample = high[channel][i];
        if (branch.index === 3) branch.shaped[channel][i] = this.tubeSamples[channel][i];
        else {
          const shaped = this.shape(branch.index, sample, channel);
          // Keep the tested Float32 boundary before forming the differential.
          branch.shaped[channel][i] = sample + (shaped - sample);
        }
        branch.shaped[channel][i] -= sample;
      }
      if (factor === 4) {
        branch.down4[channel].process(branch.shaped[channel], branch.mid[channel], highFrames);
        branch.down2[channel].process(branch.mid[channel], branch.correction[channel], frames * 2);
      } else if (factor === 2) branch.down2[channel].process(branch.shaped[channel], branch.correction[channel], highFrames);
    }
    const padLength = branch.padding[0].length;
    if (padLength) for (let i = 0; i < frames; i += 1) {
      for (let channel = 0; channel < 2; channel += 1) {
        const delayed = branch.padding[channel][branch.padPosition];
        branch.padding[channel][branch.padPosition] = branch.correction[channel][i];
        branch.correction[channel][i] = delayed;
      }
      if (++branch.padPosition === padLength) branch.padPosition = 0;
    }
    return branch.correction;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const frames = output[0].length;
    this.beginTransition();
    for (let channel = 0; channel < 2; channel += 1) {
      const source = input?.[channel] || input?.[0];
      for (let i = 0; i < frames; i += 1) this.inputSamples[channel][i] = source ? source[i] : 0;
      // At 96k only DESTROY needs the shared upsampler. Its finite history
      // is completely restored during the 384-sample target warmup.
      if (this.rates[3] === 2 || this.active.factor >= 2 || this.target?.factor >= 2) {
        this.up2[channel].process(this.inputSamples[channel], this.high2[channel], frames);
      }
      const tubeInput = this.rates[3] === 1 ? this.inputSamples[channel] : this.high2[channel];
      for (let i = 0; i < frames * this.rates[3]; i += 1) {
        const sample = tubeInput[i];
        const shaped = this.shape(3, sample, channel);
        this.tubeSamples[channel][i] = sample + (shaped - sample);
      }
    }
    const old = this.runBranch(this.active, frames);
    const next = this.target ? this.runBranch(this.target, frames) : null;
    const warming = this.warmFrames > 0;
    for (let frame = 0; frame < frames; frame += 1) {
      // Metadata only: InputGainNode is the sole linear gain stage.
      this.inputGainDb = this.targetInputGainDb + this.smoothingCoefficient * (this.inputGainDb - this.targetInputGainDb);
      this.characterAmount = this.targetCharacterAmount + this.smoothingCoefficient * (this.characterAmount - this.targetCharacterAmount);
      if (this.target && !warming) this.stageCrossfade = 1 + this.smoothingCoefficient * (this.stageCrossfade - 1);
      for (let channel = 0; channel < 2; channel += 1) {
        const dry = this.dry[channel][this.dryPosition];
        const first = dry + this.characterAmount * (old ? old[channel][frame] : 0);
        const second = this.target ? dry + this.characterAmount * (next ? next[channel][frame] : 0) : first;
        if (output[channel]) output[channel][frame] = warming ? first : first + this.stageCrossfade * (second - first);
        this.dry[channel][this.dryPosition] = this.inputSamples[channel][frame];
      }
      if (++this.dryPosition === 192) this.dryPosition = 0;
    }
    if (warming) this.warmFrames -= frames;
    if (this.target && !warming && this.stageCrossfade > 0.9999) {
      this.active = this.target;
      this.target = null;
      this.stageCrossfade = 1;
    }
    return true;
  }
}

ResonantInputPreampProcessor.STAGES = Object.freeze({
  linear: 0,
  silk: 1,
  tape: 2,
  tube: 3,
  console: 4,
  crunch: 5,
  destroy: 6
});

registerProcessor('resonant-input-preamp-processor', ResonantInputPreampProcessor);
