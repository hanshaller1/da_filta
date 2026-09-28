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
    this.enabled = false;
    this.handleStateChange = () => this.refresh();
  }

  get available() { return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'; }

  async enable() {
    if (!this.available) return { status: 'UNAVAILABLE', inputs: [] };
    this.access ||= await navigator.requestMIDIAccess({ sysex: false });
    this.enabled = true;
    this.access.onstatechange = this.handleStateChange;
    this.refresh();
    return { status: 'CONNECTED', inputs: this.inputs };
  }

  disable() {
    this.enabled = false;
    this.detachSelected();
    if (this.access?.onstatechange === this.handleStateChange) this.access.onstatechange = null;
    this.onChange(this.inputs, this.selectedId);
  }

  refresh() {
    if (!this.access) return [];
    this.inputs = [...this.access.inputs.values()].filter(input => input.state !== 'disconnected');
    if (!this.inputs.some(input => input.id === this.selectedId)) this.selectedId = '';
    if (this.enabled) this.attachSelected();
    else this.detachSelected();
    this.onChange(this.inputs, this.selectedId);
    return this.inputs;
  }

  select(id) {
    this.selectedId = this.inputs.some(input => input.id === id) ? id : '';
    if (this.enabled) this.attachSelected();
    else this.detachSelected();
    this.onChange(this.inputs, this.selectedId);
    return this.selectedId;
  }

  attachSelected() {
    this.detachSelected();
    this.activeInput = this.inputs.find(input => input.id === this.selectedId) || null;
    if (this.activeInput) this.activeInput.onmidimessage = this.handleMessage;
  }

  detachSelected() {
    if (this.activeInput?.onmidimessage === this.handleMessage) this.activeInput.onmidimessage = null;
    this.activeInput = null;
  }

  handleMessage = event => this.onMessage(event);

  dispose() {
    this.disable();
    this.access = null;
    this.inputs = [];
    this.selectedId = '';
    this.onChange(this.inputs, this.selectedId);
  }
}
