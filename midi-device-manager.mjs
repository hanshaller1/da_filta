// Owns Web MIDI permission, input discovery, hotplug updates, and the single
// selected clock-input listener. Clock interpretation stays with the router.
export class MidiDeviceManager {
  constructor({ onMessage = () => {}, onChange = () => {} } = {}) {
    this.access = null;
    this.inputs = [];
    this.selectedId = '';
    this.onMessage = onMessage;
    this.onChange = onChange;
    this.activeInput = null;
    this.handleStateChange = () => this.refresh();
  }

  get available() { return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'; }

  async enable() {
    if (!this.available) return { status: 'UNAVAILABLE', inputs: [] };
    this.access ||= await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = this.handleStateChange;
    this.refresh();
    return { status: 'CONNECTED', inputs: this.inputs };
  }

  refresh() {
    if (!this.access) return [];
    this.inputs = [...this.access.inputs.values()].filter(input => input.state !== 'disconnected');
    if (!this.inputs.some(input => input.id === this.selectedId)) this.selectedId = '';
    this.attachSelected();
    this.onChange(this.inputs, this.selectedId);
    return this.inputs;
  }

  select(id) {
    this.selectedId = this.inputs.some(input => input.id === id) ? id : '';
    this.attachSelected();
    this.onChange(this.inputs, this.selectedId);
    return this.selectedId;
  }

  attachSelected() {
    if (this.activeInput?.onmidimessage === this.handleMessage) this.activeInput.onmidimessage = null;
    this.activeInput = this.inputs.find(input => input.id === this.selectedId) || null;
    if (this.activeInput) this.activeInput.onmidimessage = this.handleMessage;
  }

  handleMessage = event => this.onMessage(event);

  dispose() {
    if (this.activeInput?.onmidimessage === this.handleMessage) this.activeInput.onmidimessage = null;
    if (this.access?.onstatechange === this.handleStateChange) this.access.onstatechange = null;
    this.activeInput = null;
  }
}
