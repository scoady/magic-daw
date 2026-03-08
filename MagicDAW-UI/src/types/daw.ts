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
}

export type ViewId = 'arrange' | 'edit' | 'mix' | 'instruments' | 'plugins';
