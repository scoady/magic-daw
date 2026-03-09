// ── Swift/WKWebView Bridge ──────────────────────────────────────────────────

type SwiftMessageHandler = (payload: unknown) => void;

const handlers: Map<string, Set<SwiftMessageHandler>> = new Map();

// Post message to Swift via WKWebView
export function sendToSwift(type: string, payload: unknown = {}): void {
  try {
    const webkit = (window as any).webkit;
    if (webkit?.messageHandlers?.magicdaw) {
      webkit.messageHandlers.magicdaw.postMessage({ type, payload });
    } else {
      console.debug('[Bridge] No Swift handler, message:', type, payload);
    }
  } catch (e) {
    console.warn('[Bridge] Failed to send:', type, e);
  }
}

// Register callback for Swift -> JS events
export function onSwiftMessage(type: string, callback: SwiftMessageHandler): () => void {
  if (!handlers.has(type)) {
    handlers.set(type, new Set());
  }
  handlers.get(type)!.add(callback);

  // Return unsubscribe function
  return () => {
    handlers.get(type)?.delete(callback);
  };
}

// Called by Swift to dispatch events to JS
(window as any).__magicDAWReceive = (type: string, payload: unknown) => {
  const typeHandlers = handlers.get(type);
  if (typeHandlers) {
    typeHandlers.forEach((handler) => handler(payload));
  }
};

// ── Live MIDI State ──────────────────────────────────────────────────────────

export interface ActiveMidiNote {
  note: number;       // MIDI note number 0-127
  velocity: number;   // 0-127
  channel: number;
  timestamp: number;  // Date.now() when received
}

export interface MidiDeviceInfo {
  id: number;
  name: string;
  connected?: boolean;
}

export interface MidiDeviceList {
  sources: MidiDeviceInfo[];
  destinations: MidiDeviceInfo[];
}

type MidiStateListener = (activeNotes: ActiveMidiNote[], devices: MidiDeviceList) => void;

const midiListeners = new Set<MidiStateListener>();
let activeNotes: ActiveMidiNote[] = [];
let midiDevices: MidiDeviceList = { sources: [], destinations: [] };

function notifyMidiListeners() {
  midiListeners.forEach((fn) => fn([...activeNotes], { ...midiDevices }));
}

/** Subscribe to live MIDI state changes. Returns unsubscribe function. */
export function onMidiStateChange(listener: MidiStateListener): () => void {
  midiListeners.add(listener);
  // Immediately fire with current state
  listener([...activeNotes], { ...midiDevices });
  return () => { midiListeners.delete(listener); };
}

/** Get current active notes snapshot. */
export function getActiveNotes(): ActiveMidiNote[] {
  return [...activeNotes];
}

/** Get current MIDI devices snapshot. */
export function getMidiDevices(): MidiDeviceList {
  return { ...midiDevices };
}

// Wire up MIDI message handlers from Swift
onSwiftMessage('midi_note_on', (payload: unknown) => {
  const p = payload as { note: number; velocity: number; channel: number };
  // Remove any existing note-on for the same pitch+channel, then add new
  activeNotes = activeNotes.filter(
    (n) => !(n.note === p.note && n.channel === p.channel),
  );
  activeNotes.push({
    note: p.note,
    velocity: p.velocity,
    channel: p.channel,
    timestamp: Date.now(),
  });
  notifyMidiListeners();
});

onSwiftMessage('midi_note_off', (payload: unknown) => {
  const p = payload as { note: number; channel: number };
  activeNotes = activeNotes.filter(
    (n) => !(n.note === p.note && n.channel === p.channel),
  );
  notifyMidiListeners();
});

onSwiftMessage('midi_devices', (payload: unknown) => {
  midiDevices = payload as MidiDeviceList;
  notifyMidiListeners();
});

// ── Message Types ──────────────────────────────────────────────────────────

export const BridgeMessages = {
  // JS -> Swift
  TRANSPORT_PLAY: 'transport_play',
  TRANSPORT_STOP: 'transport_stop',
  TRANSPORT_RECORD: 'transport_record',
  TRANSPORT_REWIND: 'transport_rewind',
  SET_BPM: 'set_bpm',
  SET_VOLUME: 'set_volume',
  SET_PAN: 'set_pan',
  SET_TRACK_VOLUME: 'set_track_volume',
  SET_TRACK_PAN: 'set_track_pan',
  SET_TRACK_MUTE: 'set_track_mute',
  SET_TRACK_SOLO: 'set_track_solo',
  SET_TRACK_EFFECT: 'set_track_effect',
  MIDI_NOTE_ON: 'midi_note_on',
  MIDI_NOTE_OFF: 'midi_note_off',
  AI_REQUEST: 'ai_request',
  EXPORT_AU: 'export_au',
  SAVE_PROJECT: 'project.save',
  LOAD_PROJECT: 'project.load',
  NEW_PROJECT: 'project.new',
  UPDATE_PROJECT_STATE: 'project.updateState',

  // Instrument / Sampler (JS -> Swift)
  INSTRUMENT_LOAD_SAMPLE: 'instrument.loadSample',
  INSTRUMENT_UPDATE_ADSR: 'instrument.updateADSR',
  INSTRUMENT_UPDATE_FILTER: 'instrument.updateFilter',
  INSTRUMENT_IMPORT_SAMPLE: 'instrument.importSample',
  INSTRUMENT_PREVIEW_NOTE: 'instrument.previewNote',

  // Plugin Builder (JS -> Swift)
  ADD_NODE: 'add_node',
  REMOVE_NODE: 'remove_node',
  CONNECT_NODES: 'connect_nodes',
  DISCONNECT_NODES: 'disconnect_nodes',
  SET_NODE_PARAM: 'set_node_param',
  MOVE_NODE: 'move_node',
  PLUGIN_PREVIEW_START: 'plugin_preview_start',
  PLUGIN_PREVIEW_STOP: 'plugin_preview_stop',
  EXPORT_AUV3: 'export_auv3',
  AI_GENERATE_PATCH: 'ai_generate_patch',

  // Swift -> JS (MIDI)
  MIDI_NOTE_ON_EVENT: 'midi_note_on',
  MIDI_NOTE_OFF_EVENT: 'midi_note_off',
  MIDI_CC_EVENT: 'midi_cc',
  MIDI_PITCH_BEND_EVENT: 'midi_pitch_bend',
  MIDI_DEVICES: 'midi_devices',
  MIDI_EVENT: 'midi_event',
  AUDIO_LEVELS: 'audio_levels',
  TRACK_LEVELS: 'track_levels',
  TRANSPORT_STATE: 'transport_state',
  AI_RESULT: 'ai_result',
  PROJECT_DATA: 'project_data',
  PROJECT_SAVED: 'project_saved',
  PROJECT_LOADED: 'project_loaded',
  KEY_DETECTED: 'key_detected',
  CHORD_DETECTED: 'chord_detected',
  CHORD_SUGGESTIONS: 'chord_suggestions',
  AI_CHAT_RESULT: 'ai_chat_result',
  OLLAMA_STATUS: 'ollama_status',
  PLUGIN_GRAPH_UPDATE: 'plugin_graph_update',
  PLUGIN_VALIDATION: 'plugin_validation',
  PLUGIN_PREVIEW_LEVELS: 'plugin_preview_levels',
  PLUGIN_EXPORT_PROGRESS: 'plugin_export_progress',
  PLUGIN_EXPORT_RESULT: 'plugin_export_result',
  PLUGIN_AI_RESULT: 'plugin_ai_result',

  // Swift -> JS (Instrument)
  INSTRUMENT_LOADED: 'instrument_loaded',
  INSTRUMENT_WAVEFORM: 'instrument_waveform',
  INSTRUMENT_ZONES: 'instrument_zones',
  INSTRUMENT_ERROR: 'instrument_error',
} as const;

// ── Instrument Helper Types ───────────────────────────────────────────────

export interface InstrumentZone {
  rootNote: number;
  lowNote: number;
  highNote: number;
}

export interface InstrumentLoadedPayload {
  success: boolean;
  name: string;
  rootNote: number;
  lowNote: number;
  highNote: number;
}

export interface InstrumentWaveformPayload {
  rootNote: number;
  waveform: number[];
  name: string;
}

export interface InstrumentZonesPayload {
  zones: InstrumentZone[];
}

// ── Instrument Helper Functions ───────────────────────────────────────────

/** Load a sample file at the given path into the sampler. */
export function loadSample(
  path: string,
  rootNote = 60,
  lowNote = 0,
  highNote = 127,
): void {
  sendToSwift(BridgeMessages.INSTRUMENT_LOAD_SAMPLE, {
    path,
    rootNote,
    lowNote,
    highNote,
  });
}

/** Update ADSR envelope on the sampler. Only sends changed values. */
export function updateADSR(params: {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
}): void {
  sendToSwift(BridgeMessages.INSTRUMENT_UPDATE_ADSR, params);
}

/** Update filter parameters on the sampler. */
export function updateFilter(params: {
  cutoff?: number;
  resonance?: number;
}): void {
  sendToSwift(BridgeMessages.INSTRUMENT_UPDATE_FILTER, params);
}

/** Open a native file dialog to import an audio sample. */
export function importSample(): void {
  sendToSwift(BridgeMessages.INSTRUMENT_IMPORT_SAMPLE, {});
}

/** Preview a note on the sampler (auto note-off after 0.5s). */
export function previewNote(note: number, velocity = 100): void {
  sendToSwift(BridgeMessages.INSTRUMENT_PREVIEW_NOTE, { note, velocity });
}
