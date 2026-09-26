// P3B.5 prototype only. Never imported by production.
const { CharacterArchitecture, RATES } = require('./input-character-architecture-p3b4.cjs');

class OptimizedCharacterArchitecture extends CharacterArchitecture {
  constructor(rate, stage = 'linear', model = 'A', amount = 1, rates = RATES, mode = 'shape') {
    super(rate, stage, model, amount, rates);
    this.mode = mode;
    // These processors have constant gain metadata 0, amount 1 and a fixed stage.
    // Replace only their redundant parameter loop, retaining the original shape().
    this.tube.process = this.fixedProcess;
    for (const name of Object.keys(this.branches)) {
      const b = this.branches[name], node = b.node;
      if (node) node.process = this.fixedProcess;
      if (mode === 'lean') {
        // 1x shaped-correction already has the required Float32 rounding.
        if (b.factor === 1) b.correction = b.shaped;
        b.resetFilters = [...(b.up4 || []), ...(b.down4 || []), ...(b.down2 || [])];
        b.resetBuffers = [...b.padding, ...b.mid, ...b.correction, ...b.high, ...b.shaped];
      }
    }
  }
  fixedProcess(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    for (let frame = 0; frame < output[0].length; frame++) {
      for (let channel = 0; channel < output.length; channel++) {
        const sample = input[channel][frame];
        const oldShaped = this.shape(this.stage, sample, channel);
        // Preserve both original arithmetic steps, including signed-zero behavior.
        const shaped = oldShaped + 1 * (oldShaped - oldShaped);
        output[channel][frame] = sample + 1 * (shaped - sample);
      }
    }
    return true;
  }
  resetBranch(stage) {
    if (this.mode !== 'lean') return super.resetBranch(stage);
    const b = this.branches[stage];
    if (!b) return;
    for (let i = 0; i < b.resetFilters.length; i++) { b.resetFilters[i].ring.fill(0); b.resetFilters[i].position = 0; }
    for (let i = 0; i < b.resetBuffers.length; i++) b.resetBuffers[i].fill(0);
    b.padPosition = 0;
  }
  runBranch(stage) {
    if (this.mode !== 'lean') return super.runBranch(stage);
    if (stage === 'linear') return null;
    const b = this.branches[stage];
    const high = b.factor === 4 ? b.high : b.factor === 2 ? this.high2 : this.hostInput;
    if (b.factor === 4) for (let c = 0; c < 2; c++) b.up4[c].process(this.high2[c], high[c]);
    if (stage === 'tube') for (let c = 0; c < 2; c++) b.shaped[c].set(this.tubeSamples[c]);
    else { b.inputs[0] = high; b.node.process(b.inputs, b.outputs); }
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < b.shaped[c].length; i++) b.shaped[c][i] -= high[c][i];
      if (b.factor === 4) { b.down4[c].process(b.shaped[c], b.mid[c]); b.down2[c].process(b.mid[c], b.correction[c]); }
      else if (b.factor === 2) b.down2[c].process(b.shaped[c], b.correction[c]);
    }
    const padLength = b.padding[0].length;
    if (padLength) {
      for (let i = 0; i < 128; i++) {
        for (let c = 0; c < 2; c++) {
          const old = b.padding[c][b.padPosition]; b.padding[c][b.padPosition] = b.correction[c][i]; b.correction[c][i] = old;
        }
        if (++b.padPosition === padLength) b.padPosition = 0;
      }
    }
    return b.correction;
  }
  process(inputs) {
    if (this.mode !== 'lean' || this.model !== 'A') return super.process(inputs);
    this.hostInput = inputs;
    for (let c = 0; c < 2; c++) this.up2[c].process(inputs[c], this.high2[c]);
    this.tubeInput[0] = this.rates.tube === 1 ? inputs : this.high2;
    this.tube.process(this.tubeInput, this.tubeOutput);
    const hasTarget = this.target !== null, warming = this.warmFrames > 0, fading = hasTarget && !warming;
    const old = this.runBranch(this.active), next = hasTarget ? this.runBranch(this.target) : null;
    for (let i = 0; i < 128; i++) {
      this.amount = this.targetAmount + this.smoothing * (this.amount - this.targetAmount);
      if (fading) this.weight = 1 + this.smoothing * (this.weight - 1);
      for (let c = 0; c < 2; c++) {
        // Model A: both stages use exactly the same 192-sample delayed host dry.
        const dry = this.dry[c][this.dryPosition];
        const first = dry + this.amount * (old ? old[c][i] : 0);
        const second = hasTarget ? dry + this.amount * (next ? next[c][i] : 0) : first;
        // Keep the original order of operations, including its cancellation/rounding.
        this.output[c][i] = warming ? first : first + this.weight * (second - first);
        this.dry[c][this.dryPosition] = inputs[c][i];
      }
      if (++this.dryPosition === 192) this.dryPosition = 0;
    }
    if (warming) this.warmFrames -= 128;
    if (hasTarget && !warming && this.weight > .9999) {
      this.active = this.target; this.target = null; this.weight = 1;
      if (this.queued) { const queued = this.queued; this.queued = null; this.request(queued); }
    }
    return this.output;
  }
}
module.exports = { OptimizedCharacterArchitecture };
