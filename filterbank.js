(function () {
  const { BAND_COUNT, clampBandGain, setBandBaseGain } = window.ResonantState;

  class Filterbank {
    constructor(audioContext) {
      this.context = audioContext;
      this.inputNode = audioContext.createGain();
      this.outputNode = audioContext.createGain();
      this.inputNode.connect(this.outputNode);
      this.bandGainLeft = Array(BAND_COUNT).fill(0);
      this.bandGainRight = Array(BAND_COUNT).fill(0);
      this.disposed = false;
    }

    get input() {
      return this.inputNode;
    }

    get output() {
      return this.outputNode;
    }

    setBandBaseGain(channel, index, value) {
      if (this.disposed) return;
      setBandBaseGain({ bandGainLeft: this.bandGainLeft, bandGainRight: this.bandGainRight }, channel, index, value);
    }

    applyState(snapshot) {
      if (this.disposed) return;
      const nextLeft = Array.isArray(snapshot?.bandGainLeft) ? snapshot.bandGainLeft : [];
      const nextRight = Array.isArray(snapshot?.bandGainRight) ? snapshot.bandGainRight : [];
      this.bandGainLeft = Array.from({ length: BAND_COUNT }, (_, index) => clampBandGain(nextLeft[index] ?? 0));
      this.bandGainRight = Array.from({ length: BAND_COUNT }, (_, index) => clampBandGain(nextRight[index] ?? 0));
    }

    dispose() {
      if (this.disposed) return;
      this.inputNode.disconnect();
      this.outputNode.disconnect();
      this.disposed = true;
    }
  }

  window.Filterbank = Filterbank;
})();
