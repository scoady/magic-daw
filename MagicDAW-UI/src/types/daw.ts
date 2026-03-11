// ── Core DAW Types ──────────────────────────────────────────────────────────

export interface MidiNote {
  id: string;          // unique identifier for selection/manipulation
  pitch: number;       // MIDI note number 0-127
  start: number;       // beat position
  duration: number;    // in beats
  velocity: number;    // 0-127
  channel: number;
}

/** Quantize grid size in beats */
export type QuantizeValue = 0 | 0.125 | 0.25 | 0.5 | 1;

/** Labels for quantize dropdown */
export const QUANTIZE_LABELS: Record<QuantizeValue, string> = {
  0: 'Off',
  0.125: '1/32',
  0.25: '1/16',
  0.5: '1/8',
  1: '1/4',
};

export interface InstrumentPreset {
  id: string;
  name: string;
  description: string;
  gmProgram: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterCutoff: number;
  filterResonance: number;
  filterType: string;
  createdAt: string;
}

export interface Track {
  id: string;
  name: string;
  type: 'midi' | 'audio' | 'bus';
  color: string;
  volume: number;      // 0-1
  pan: number;         // -1 to 1
  muted: boolean;
  soloed: boolean;
  armed: boolean;
  clips: Clip[];
  effects?: EffectSlot[];
  sends?: SendLevel[];
  instrumentPresetId?: string;
  instrumentPresetName?: string;
}

// ── Effects Chain Types ─────────────────────────────────────────────────────

export type EffectTypeName = 'eq' | 'compressor' | 'reverb' | 'delay' | 'chorus' | 'distortion';

export interface EffectSlot {
  id: string;
  type: EffectTypeName;
  bypassed: boolean;
  params: Record<string, number>;
}

export interface SendLevel {
  id: string;
  busTrackId: string;
  level: number;
  isPreFader: boolean;
}

export interface EffectParamDef {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export const EFFECT_PARAMS: Record<EffectTypeName, EffectParamDef[]> = {
  eq: [
    { name: 'lowFreq', label: 'Low Freq', min: 20, max: 500, step: 1, unit: 'Hz' },
    { name: 'lowGain', label: 'Low Gain', min: -24, max: 24, step: 0.5, unit: 'dB' },
    { name: 'midFreq', label: 'Mid Freq', min: 200, max: 5000, step: 1, unit: 'Hz' },
    { name: 'midGain', label: 'Mid Gain', min: -24, max: 24, step: 0.5, unit: 'dB' },
    { name: 'midQ', label: 'Mid Q', min: 0.1, max: 10, step: 0.1 },
    { name: 'highFreq', label: 'High Freq', min: 2000, max: 20000, step: 1, unit: 'Hz' },
    { name: 'highGain', label: 'High Gain', min: -24, max: 24, step: 0.5, unit: 'dB' },
  ],
  compressor: [
    { name: 'threshold', label: 'Threshold', min: -60, max: 0, step: 0.5, unit: 'dB' },
    { name: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.1 },
    { name: 'attack', label: 'Attack', min: 0.1, max: 200, step: 0.1, unit: 'ms' },
    { name: 'release', label: 'Release', min: 10, max: 2000, step: 1, unit: 'ms' },
    { name: 'makeupGain', label: 'Makeup', min: -12, max: 24, step: 0.5, unit: 'dB' },
  ],
  reverb: [
    { name: 'wetDry', label: 'Wet/Dry', min: 0, max: 100, step: 1, unit: '%' },
    { name: 'roomSize', label: 'Room', min: 0, max: 4, step: 1 },
  ],
  delay: [
    { name: 'time', label: 'Time', min: 1, max: 2000, step: 1, unit: 'ms' },
    { name: 'feedback', label: 'Feedback', min: 0, max: 100, step: 1, unit: '%' },
    { name: 'wetDry', label: 'Wet/Dry', min: 0, max: 100, step: 1, unit: '%' },
  ],
  chorus: [
    { name: 'rate', label: 'Rate', min: 0.1, max: 10, step: 0.1, unit: 'Hz' },
    { name: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01 },
    { name: 'wetDry', label: 'Wet/Dry', min: 0, max: 100, step: 1, unit: '%' },
  ],
  distortion: [
    { name: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01 },
    { name: 'wetDry', label: 'Wet/Dry', min: 0, max: 100, step: 1, unit: '%' },
    { name: 'type', label: 'Type', min: 0, max: 2, step: 1 },
  ],
};

export const EFFECT_DISPLAY_NAMES: Record<EffectTypeName, string> = {
  eq: 'EQ',
  compressor: 'Compressor',
  reverb: 'Reverb',
  delay: 'Delay',
  chorus: 'Chorus',
  distortion: 'Distortion',
};

export interface Clip {
  id: string;
  name: string;
  startBar: number;
  lengthBars: number;
  color: string;
  notes?: MidiNote[];
  selected?: boolean;
  /** Downsampled waveform data for audio clip preview (0-1 peak values) */
  waveform?: number[];
  /** Audio file reference (relative path in project bundle or absolute path) */
  audioFile?: string;
}

export interface AudioInputDevice {
  uid: string;
  name: string;
  channelCount: number;
}

export interface TransportState {
  playing: boolean;
  recording: boolean;
  bpm: number;
  timeSignature: [number, number];
  position: {
    bar: number;
    beat: number;
    timeMs: number;
  };
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  metronomeEnabled: boolean;
  countInEnabled: boolean;
}

export interface KeySignature {
  key: string;
  scale: string;
  confidence: number;
}

export interface ChordSuggestion {
  chord: string;
  probability: number;
  quality: string;
}

export interface SongMatch {
  title: string;
  artist: string;
  year: number;
  genre: string;
  progression: string[];
  section: string;
  confidence: number;
  matchedChords: number;
  matchType: 'exact' | 'partial' | 'rotated';
}

export interface PluginNode {
  id: string;
  type: 'oscillator' | 'filter' | 'envelope' | 'lfo' | 'effect' | 'math' | 'output';
  name: string;
  x: number;
  y: number;
  params: Record<string, number>;
  inputs: string[];
  outputs: string[];
}

export interface PluginConnection {
  id: string;
  from: { nodeId: string; port: string };
  to: { nodeId: string; port: string };
}

export interface DAWState {
  transport: TransportState;
  tracks: Track[];
  keySignature: KeySignature;
  selectedTrackId: string | null;
  ollamaConnected: boolean;
  midiInputActive: boolean;
  masterLevelL: number;
  masterLevelR: number;
  /** Name of the current project (matches DAWProject.name on Swift side) */
  projectName: string;
  /** Whether the project has been saved to disk (has a fileURL) */
  projectSaved: boolean;
  /** Whether the in-memory state has unsaved changes */
  projectDirty: boolean;
  /** Available audio input devices */
  inputDevices: AudioInputDevice[];
  /** Whether input monitoring is active */
  monitorEnabled: boolean;
  /** Input metering levels (for armed/recording tracks) */
  inputLevelL: number;
  inputLevelR: number;
}

export type ViewId = 'arrange' | 'edit' | 'mix' | 'instruments' | 'plugins' | 'chord-builder' | 'learn' | 'emotions';
export type LearnSubView = 'circle' | 'intervals' | 'tonnetz' | 'piano-hero';

// ── Project data from Swift (matches DAWProject Codable output) ──────────

/** Shape of the JSON object sent from Swift when a project is loaded/created */
export interface ProjectData {
  name: string;
  bpm: number;
  timeSignature: { numerator: number; denominator: number };
  key?: string;
  keyScale?: string;
  tracks: SwiftTrack[];
  markers: SwiftMarker[];
  createdAt: string;
  modifiedAt: string;
}

/** Track shape from Swift's Codable encoding */
export interface SwiftTrack {
  id: string;
  name: string;
  type: 'midi' | 'audio' | 'bus' | 'master';
  color: string;  // TrackColor raw value e.g. "teal"
  clips: SwiftClip[];
  volume: number;
  pan: number;
  isMuted: boolean;
  isSoloed: boolean;
  isArmed: boolean;
  height: number;
  effects: unknown[];
  sends: unknown[];
  instrument?: unknown;
  outputBusId?: string;
}

/** Clip shape from Swift's Codable encoding */
export interface SwiftClip {
  id: string;
  name: string;
  type: 'midi' | 'audio';
  startBar: number;
  lengthBars: number;
  color?: string;
  midiEvents?: unknown[];
  audioFile?: string;
  isLooped: boolean;
  loopLengthBars?: number;
}

export interface SwiftMarker {
  id: string;
  name: string;
  bar: number;
  color: string;
}
