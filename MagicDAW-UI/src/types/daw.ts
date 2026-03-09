// ── Core DAW Types ──────────────────────────────────────────────────────────

export interface MidiNote {
  pitch: number;       // MIDI note number 0-127
  start: number;       // beat position
  duration: number;    // in beats
  velocity: number;    // 0-127
  channel: number;
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
}

export interface Clip {
  id: string;
  name: string;
  startBar: number;
  lengthBars: number;
  color: string;
  notes?: MidiNote[];
  selected?: boolean;
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
}

export type ViewId = 'arrange' | 'edit' | 'mix' | 'instruments' | 'plugins';

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
