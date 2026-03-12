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
  SET_TRACK_AUTOMATION: 'set_track_automation',
  MIDI_NOTE_ON: 'midi_note_on',
  MIDI_NOTE_OFF: 'midi_note_off',
  AI_REQUEST: 'ai_request',
  AI_RAW_REQUEST: 'ai.request',
  AI_LIST_MODELS: 'ai.listModels',
  AI_CHECK_STATUS: 'ai.checkStatus',
  EXPORT_AU: 'export_au',
  EXPORT_AUDIO: 'export_audio',
  SAVE_PROJECT: 'project.save',
  SAVE_PROJECT_AS: 'project.saveAs',
  LOAD_PROJECT: 'project.load',
  NEW_PROJECT: 'project.new',
  UPDATE_PROJECT_STATE: 'project.updateState',

  // Track Management (JS -> Swift)
  ADD_TRACK: 'add_track',
  DELETE_TRACK: 'delete_track',
  RENAME_TRACK: 'rename_track',
  REORDER_TRACKS: 'reorder_tracks',
  SET_TRACK_COLOR: 'set_track_color',

  // Clip Management (JS -> Swift)
  CREATE_CLIP: 'create_clip',
  MOVE_CLIP: 'move_clip',
  RESIZE_CLIP: 'resize_clip',
  DELETE_CLIPS: 'delete_clips',
  DUPLICATE_CLIP: 'duplicate_clip',
  SPLIT_CLIP: 'split_clip',
  SET_CLIP_LOOP: 'set_clip_loop',
  EDIT_CLIP: 'edit_clip',
  HARMONIC_LAB_COMMIT: 'harmonic_lab_commit',

  // Transport Position (JS -> Swift)
  SET_POSITION: 'set_position',

  // Metronome / Loop / Count-in (JS -> Swift)
  SET_METRONOME: 'set_metronome',
  SET_LOOP_ENABLED: 'set_loop_enabled',
  SET_LOOP_REGION: 'set_loop_region',
  SET_COUNT_IN: 'set_count_in',
  ARM_TRACK: 'arm_track',
  SELECT_TRACK: 'select_track',
  SET_QUANTIZE: 'set_quantize',
  SET_MIDI_OUTPUT: 'set_midi_output',

  // Audio Recording / Monitoring (JS -> Swift)
  GET_INPUT_DEVICES: 'get_input_devices',
  SET_MONITOR: 'set_monitor',
  SCHEDULE_CLIP_PLAYBACK: 'schedule_clip_playback',
  STOP_CLIP_PLAYBACK: 'stop_clip_playback',

  // Instrument / Sampler (JS -> Swift)
  INSTRUMENT_LOAD_SAMPLE: 'instrument.loadSample',
  INSTRUMENT_UPDATE_ADSR: 'instrument.updateADSR',
  INSTRUMENT_UPDATE_FILTER: 'instrument.updateFilter',
  INSTRUMENT_UPDATE_OUTPUT: 'instrument.updateOutput',
  INSTRUMENT_IMPORT_SAMPLE: 'instrument.importSample',
  INSTRUMENT_IMPORT_SAMPLE_FOLDER: 'instrument.importSampleFolder',
  INSTRUMENT_IMPORT_SFZ: 'instrument.importSFZ',
  INSTRUMENT_PREVIEW_NOTE: 'instrument.previewNote',
  INSTRUMENT_DESIGN_SOUND: 'instrument.designSound',
  INSTRUMENT_MAP_ZONES: 'instrument.mapZones',
  INSTRUMENT_SAVE_RACK: 'instrument.saveRack',
  INSTRUMENT_ASSIGN_PREVIEW_RACK: 'instrument.assignPreviewRack',
  INSTRUMENT_LIST_SAMPLE_RACKS: 'instrument.listSampleRacks',
  INSTRUMENT_LOAD_SAMPLE_RACK: 'instrument.loadSampleRack',
  INSTRUMENT_LOAD_BUILTIN_DEMO: 'instrument.loadBuiltinDemo',
  INSTRUMENT_SEARCH_LOCAL: 'instrument.searchLocal',
  INSTRUMENT_REFINE_SEARCH: 'instrument.refineSearch',
  INSTRUMENT_LOAD_DISCOVERED: 'instrument.loadDiscovered',
  INSTRUMENT_PICK_SEARCH_ROOT: 'instrument.pickSearchRoot',
  INSTRUMENT_LIST_SEARCH_ROOTS: 'instrument.listSearchRoots',
  INSTRUMENT_REMOVE_SEARCH_ROOT: 'instrument.removeSearchRoot',
  INSTRUMENT_REINDEX_SEARCH: 'instrument.reindexSearch',

  // Instrument Factory (JS -> Swift)
  INSTRUMENT_CREATE_PRESET: 'instrument.createPreset',
  INSTRUMENT_LIST_PRESETS: 'instrument.listPresets',
  INSTRUMENT_DELETE_PRESET: 'instrument.deletePreset',
  INSTRUMENT_ASSIGN_TO_TRACK: 'instrument.assignToTrack',
  INSTRUMENT_PREVIEW_PRESET: 'instrument.previewPreset',

  // Plugin Builder (JS -> Swift)
  ADD_NODE: 'add_node',
  REMOVE_NODE: 'remove_node',
  CONNECT_NODES: 'connect_nodes',
  DISCONNECT_NODES: 'disconnect_nodes',
  SET_NODE_PARAM: 'set_node_param',
  MOVE_NODE: 'move_node',
  PLUGIN_SYNC_GRAPH: 'plugin_sync_graph',
  PLUGIN_LOAD_TEMPLATE: 'plugin_load_template',
  PLUGIN_PREVIEW_START: 'plugin_preview_start',
  PLUGIN_PREVIEW_STOP: 'plugin_preview_stop',
  PLUGIN_PREVIEW_NOTE: 'plugin.previewNote',
  PLUGIN_SAVE_GRAPH: 'plugin.saveGraph',
  PLUGIN_LIST_SAVED: 'plugin.listSaved',
  PLUGIN_LOAD_SAVED: 'plugin.loadSaved',
  PLUGIN_ASSIGN_TO_TRACK: 'plugin.assignToTrack',
  EXPORT_AUV3: 'export_auv3',
  AI_GENERATE_PATCH: 'ai_generate_patch',

  // Effects Chain (JS -> Swift)
  ADD_EFFECT: 'add_effect',
  REMOVE_EFFECT: 'remove_effect',
  SET_EFFECT_PARAM: 'set_effect_param',
  REORDER_EFFECTS: 'reorder_effects',
  BYPASS_EFFECT: 'bypass_effect',

  // Send Routing (JS -> Swift)
  SET_SEND_LEVEL: 'set_send_level',

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
  AI_MODELS: 'ai_models',
  HARMONIC_LAB_COMMIT_RESULT: 'harmonic_lab_commit_result',
  PLUGIN_GRAPH_UPDATE: 'plugin_graph_update',
  PLUGIN_VALIDATION: 'plugin_validation',
  PLUGIN_PREVIEW_LEVELS: 'plugin_preview_levels',
  PLUGIN_EXPORT_PROGRESS: 'plugin_export_progress',
  PLUGIN_EXPORT_RESULT: 'plugin_export_result',
  PLUGIN_AI_RESULT: 'plugin_ai_result',
  PLUGIN_SAVED_LIST: 'plugin_saved_list',
  PLUGIN_SAVED: 'plugin_saved',
  SONG_MATCHES: 'song_matches',

  // Swift -> JS (Effects Chain)
  EFFECTS_CHAIN_UPDATED: 'effects_chain_updated',

  // Piano Roll Note Editing (JS -> Swift)
  ADD_NOTE: 'note.add',
  MOVE_NOTES: 'note.move',
  RESIZE_NOTE: 'note.resize',
  DELETE_NOTES: 'note.delete',
  SET_VELOCITY: 'note.setVelocity',
  PASTE_NOTES: 'note.paste',
  UNDO: 'edit.undo',
  REDO: 'edit.redo',

  // Swift -> JS (Note Editing)
  NOTES_UPDATED: 'notes_updated',

  // Swift -> JS (Track Management)
  TRACKS_UPDATED: 'tracks_updated',

  // Swift -> JS (Recording)
  CLIP_RECORDED: 'clip_recorded',
  RECORDING_COMPLETE: 'recording_complete',
  CLIP_WAVEFORM: 'clip_waveform',
  INPUT_DEVICES: 'input_devices',
  INPUT_LEVELS: 'input_levels',
  MONITOR_STATE: 'monitor_state',
  METRONOME_STATE: 'metronome_state',
  COUNT_IN_STATE: 'count_in_state',

  // Swift -> JS (Instrument)
  INSTRUMENT_LOADED: 'instrument_loaded',
  INSTRUMENT_WAVEFORM: 'instrument_waveform',
  INSTRUMENT_ZONES: 'instrument_zones',
  INSTRUMENT_ERROR: 'instrument_error',
  INSTRUMENT_AI_PATCH: 'instrument_ai_patch',
  INSTRUMENT_AI_STATUS: 'instrument_ai_status',
  INSTRUMENT_SAMPLE_RACK_LIST: 'instrument_sample_rack_list',
  INSTRUMENT_SAMPLE_RACK_LOADED: 'instrument_sample_rack_loaded',
  INSTRUMENT_SEARCH_RESULTS: 'instrument_search_results',
  INSTRUMENT_SEARCH_REFINED: 'instrument_search_refined',
  INSTRUMENT_SEARCH_ROOTS: 'instrument_search_roots',

  // Swift -> JS (Instrument Factory)
  INSTRUMENT_PRESET_CREATED: 'instrument_preset_created',
  INSTRUMENT_PRESET_LIST: 'instrument_preset_list',
  INSTRUMENT_PRESET_DELETED: 'instrument_preset_deleted',
  INSTRUMENT_ASSIGNED: 'instrument_assigned',

  // Audio Import (JS -> Swift)
  IMPORT_AUDIO_FILE: 'audio.importFile',

  // System (JS -> Swift)
  OPEN_FILE_PICKER: 'system.openFilePicker',
  OPEN_URL: 'system.openURL',

  // System (Swift -> JS)
  FILE_PICKED: 'system.filePicked',
} as const;

// ── Instrument Helper Types ───────────────────────────────────────────────

export interface InstrumentZone {
  rootNote: number;
  lowNote: number;
  highNote: number;
  sampleFile?: string;
  lowVelocity?: number;
  highVelocity?: number;
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

export interface SampleRackSummary {
  name: string;
  path: string;
  zoneCount: number;
  sampleCount: number;
  source?: 'built-in' | 'library';
}

export interface SavedPluginGraphSummary {
  name: string;
  path: string;
  category: 'instrument' | 'effect';
  description: string;
  version: string;
  modifiedAt: string;
}

export interface SampleRackLoadedPayload {
  name: string;
  path: string;
  source?: 'built-in' | 'library';
  outputGain: number;
  outputPan: number;
  samples: Array<{
    name: string;
    rootNote: number;
    lowNote: number;
    highNote: number;
    waveform: number[];
  }>;
  zones: InstrumentZone[];
}

export interface SampleSearchResult {
  name: string;
  path: string;
  kind: 'sample' | 'sfz' | 'rack';
  source: string;
  extensionName: string;
  family: string;
  contentType: string;
  readiness: string;
  packageName: string;
  packageScore: number;
  nearbySampleCount: number;
  sizeBytes: number;
  matchScore: number;
}

export interface SampleSearchRoot {
  path: string;
  name: string;
  source: string;
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

/** Update sampler output shaping. */
export function updateInstrumentOutput(params: {
  gain?: number;
  pan?: number;
}): void {
  sendToSwift(BridgeMessages.INSTRUMENT_UPDATE_OUTPUT, params);
}

/** Open a native file dialog to import an audio sample. */
export function importSample(): void {
  sendToSwift(BridgeMessages.INSTRUMENT_IMPORT_SAMPLE, {});
}

export function importSampleFolder(): void {
  sendToSwift(BridgeMessages.INSTRUMENT_IMPORT_SAMPLE_FOLDER, {});
}

export function importSFZ(): void {
  sendToSwift(BridgeMessages.INSTRUMENT_IMPORT_SFZ, {});
}

export function searchLocalSamples(query: string): void {
  sendToSwift(BridgeMessages.INSTRUMENT_SEARCH_LOCAL, { query });
}

export function refineSampleSearch(query: string, model = 'qwen2.5:14b'): void {
  sendToSwift(BridgeMessages.INSTRUMENT_REFINE_SEARCH, { query, model });
}

export function pickSampleSearchRoot(): void {
  sendToSwift(BridgeMessages.INSTRUMENT_PICK_SEARCH_ROOT, {});
}

export function listSampleSearchRoots(): void {
  sendToSwift(BridgeMessages.INSTRUMENT_LIST_SEARCH_ROOTS, {});
}

export function removeSampleSearchRoot(path: string): void {
  sendToSwift(BridgeMessages.INSTRUMENT_REMOVE_SEARCH_ROOT, { path });
}

export function reindexSampleSearch(): void {
  sendToSwift(BridgeMessages.INSTRUMENT_REINDEX_SEARCH, {});
}

/** Preview a note on the sampler (auto note-off after 0.5s). */
export function previewNote(note: number, velocity = 100): void {
  sendToSwift(BridgeMessages.INSTRUMENT_PREVIEW_NOTE, { note, velocity });
}

// ── Metronome / Loop / Recording Helpers ────────────────────────────────

/** Toggle metronome on/off. */
export function setMetronome(enabled: boolean): void {
  sendToSwift(BridgeMessages.SET_METRONOME, { enabled });
}

/** Enable/disable loop playback. */
export function setLoopEnabled(enabled: boolean): void {
  sendToSwift(BridgeMessages.SET_LOOP_ENABLED, { enabled });
}

/** Set loop region in bars (1-indexed start, exclusive end). */
export function setLoopRegion(startBar: number, endBar: number): void {
  sendToSwift(BridgeMessages.SET_LOOP_REGION, { startBar, endBar });
}

/** Enable/disable count-in before recording. */
export function setCountIn(enabled: boolean): void {
  sendToSwift(BridgeMessages.SET_COUNT_IN, { enabled });
}

/** Arm/disarm a track for recording. */
export function armTrack(trackId: string, armed: boolean): void {
  sendToSwift(BridgeMessages.ARM_TRACK, { trackId, armed });
}

/** Set quantize grid for recording (0 = off, 0.25 = 1/16, 0.5 = 1/8, 1 = 1/4). */
export function setQuantize(grid: number): void {
  sendToSwift(BridgeMessages.SET_QUANTIZE, { grid });
}

/** Select MIDI output device by index (-1 or omit to disable external output). */
export function setMidiOutput(index: number): void {
  sendToSwift(BridgeMessages.SET_MIDI_OUTPUT, { index });
}

// ── System Helper Functions ──────────────────────────────────────────────

/** Open native file picker. Extensions should include the dot, e.g. [".mid", ".musicxml"] */
export function openFilePicker(extensions: string[], pickerId?: string): void {
  sendToSwift(BridgeMessages.OPEN_FILE_PICKER, { extensions, pickerId: pickerId ?? 'default' });
}

/** Open a URL in the system default browser. */
export function openURL(url: string): void {
  sendToSwift(BridgeMessages.OPEN_URL, { url });
}

/** Register a one-time callback for when a file is picked. Returns unsubscribe. */
export function onFilePicked(callback: (payload: { path: string; data: string; pickerId: string }) => void): () => void {
  return onSwiftMessage(BridgeMessages.FILE_PICKED, callback as SwiftMessageHandler);
}

// ── Effects Chain Helper Functions ───────────────────────────────────────

import type { EffectTypeName, EffectSlot } from './types/daw';

/** Add an effect to a track's insert chain. */
export function addEffect(trackId: string, type: EffectTypeName): void {
  sendToSwift(BridgeMessages.ADD_EFFECT, { trackId, type });
}

/** Remove an effect from a track's insert chain by index. */
export function removeEffect(trackId: string, index: number): void {
  sendToSwift(BridgeMessages.REMOVE_EFFECT, { trackId, index });
}

/** Set a parameter on a track's effect at the given index. */
export function setEffectParam(trackId: string, index: number, param: string, value: number): void {
  sendToSwift(BridgeMessages.SET_EFFECT_PARAM, { trackId, index, param, value });
}

/** Reorder effects in a track's insert chain. */
export function reorderEffects(trackId: string, from: number, to: number): void {
  sendToSwift(BridgeMessages.REORDER_EFFECTS, { trackId, from, to });
}

/** Toggle bypass on a single effect. */
export function bypassEffect(trackId: string, index: number, bypassed: boolean): void {
  sendToSwift(BridgeMessages.BYPASS_EFFECT, { trackId, index, bypassed });
}

/** Set the send level from a track to a bus. Level is linear 0-1. */
export function setSendLevel(trackId: string, busId: string, level: number): void {
  sendToSwift(BridgeMessages.SET_SEND_LEVEL, { trackId, busId, level });
}

/** Payload received from Swift when effects chain is updated. */
export interface EffectsChainUpdatedPayload {
  trackId: string;
  effects: Array<{ type: EffectTypeName; bypassed: boolean; params: Record<string, number> }>;
}

// ── Recorded Clip Payload ───────────────────────────────────────────────

export interface ClipRecordedPayload {
  trackId: string;
  clipId: string;
  clipName: string;
  startBar: number;
  lengthBars: number;
  notes: Array<{
    pitch: number;
    start: number;
    duration: number;
    velocity: number;
    channel: number;
  }>;
}
