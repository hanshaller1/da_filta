// Frozen first P3B.5 optimization, for reproducible isolated ablation.
const { CharacterArchitecture, RATES } = require('./input-character-architecture-p3b4.cjs');

class OptimizedCharacterArchitecture extends CharacterArchitecture {
  constructor(rate, stage = 'linear', model = 'A', amount = 1, rates = RATES, mode = 'shape') {
    super(rate, stage, model, amount, rates);
    this.mode = mode;
    this.tube.process = this.fixedProcess;
    for (const name of Object.keys(this.branches)) {
      const node = this.branches[name].node;
      if (node) node.process = this.fixedProcess;
    }
  }
  fixedProcess(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    for (let frame = 0; frame < output[0].length; frame++) {
      for (let channel = 0; channel < output.length; channel++) {
        const sample = input[channel][frame];
        const oldShaped = this.shape(this.stage, sample, channel);
        const shaped = oldShaped + 1 * (oldShaped - oldShaped);
        output[channel][frame] = sample + 1 * (shaped - sample);
      }
    }
    return true;
  }
}
module.exports = { OptimizedCharacterArchitecture };
