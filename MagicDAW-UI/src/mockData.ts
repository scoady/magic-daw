import type { Track, DAWState, ChordSuggestion, PluginNode, PluginConnection } from './types/daw';

// ── Aurora Colors ──────────────────────────────────────────────────────────

export const aurora = {
  bg: '#0d1520',
  bgDeep: '#080e18',
  teal: '#2dd4bf',
  green: '#34d399',
  cyan: '#67e8f9',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  orange: '#fb923c',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  textMuted: '#64748b',
  surface: 'rgba(120, 200, 220, 0.06)',
  surfaceHover: 'rgba(120, 200, 220, 0.10)',
  border: 'rgba(120, 200, 220, 0.12)',
  borderBright: 'rgba(120, 200, 220, 0.25)',
};

// ── Mock Tracks ────────────────────────────────────────────────────────────

export const mockTracks: Track[] = [
  {
    id: 'drums',
    name: 'Drums',
    type: 'midi',
    color: aurora.orange,
    volume: 0.78,
    pan: 0,
    muted: false,
    soloed: false,
    armed: false,
    clips: [
      { id: 'drums-1', name: 'Beat A', startBar: 1, lengthBars: 8, color: aurora.orange },
      { id: 'drums-2', name: 'Beat B', startBar: 9, lengthBars: 8, color: aurora.orange },
      { id: 'drums-3', name: 'Beat A', startBar: 17, lengthBars: 8, color: aurora.orange },
      { id: 'drums-4', name: 'Fill', startBar: 25, lengthBars: 8, color: aurora.orange },
    ],
  },
  {
    id: 'bass',
    name: 'Bass',
    type: 'midi',
    color: aurora.teal,
    volume: 0.72,
    pan: 0,
    muted: false,
    soloed: false,
    armed: false,
    clips: [
      { id: 'bass-1', name: 'Bass Line', startBar: 1, lengthBars: 8, color: aurora.teal },
      { id: 'bass-2', name: 'Walking', startBar: 9, lengthBars: 8, color: aurora.teal },
      { id: 'bass-3', name: 'Bass Line', startBar: 17, lengthBars: 8, color: aurora.teal },
      { id: 'bass-4', name: 'Bass Fill', startBar: 25, lengthBars: 8, color: aurora.teal },
    ],
  },
  {
    id: 'keys',
    name: 'Keys',
    type: 'midi',
    color: aurora.purple,
    volume: 0.55,
    pan: -0.3,
    muted: false,
    soloed: false,
    armed: false,
    clips: [
      { id: 'keys-1', name: 'Chords A', startBar: 5, lengthBars: 8, color: aurora.purple },
      { id: 'keys-2', name: 'Chords B', startBar: 13, lengthBars: 8, color: aurora.purple },
      { id: 'keys-3', name: 'Chords A', startBar: 21, lengthBars: 8, color: aurora.purple },
    ],
  },
  {
    id: 'pad',
    name: 'Pad',
    type: 'midi',
    color: aurora.pink,
    volume: 0.45,
    pan: 0.2,
    muted: false,
    soloed: false,
    armed: false,
    clips: [
      { id: 'pad-1', name: 'Atmosphere', startBar: 1, lengthBars: 16, color: aurora.pink },
      { id: 'pad-2', name: 'Atmosphere 2', startBar: 17, lengthBars: 16, color: aurora.pink },
    ],
  },
  {
    id: 'lead',
    name: 'Lead',
    type: 'midi',
    color: aurora.cyan,
    volume: 0.62,
    pan: 0.15,
    muted: false,
    soloed: true,
    armed: false,
    clips: [
      { id: 'lead-1', name: 'Hook', startBar: 17, lengthBars: 8, color: aurora.cyan, selected: true },
      { id: 'lead-2', name: 'Lead Fill', startBar: 25, lengthBars: 4, color: aurora.cyan },
    ],
  },
  {
    id: 'vocals',
    name: 'Vocals',
    type: 'audio',
    color: aurora.green,
    volume: 0.68,
    pan: 0,
    muted: false,
    soloed: false,
    armed: false,
    clips: [
      { id: 'vox-1', name: 'Verse 1', startBar: 9, lengthBars: 8, color: aurora.green },
      { id: 'vox-2', name: 'Chorus', startBar: 17, lengthBars: 8, color: aurora.green },
      { id: 'vox-3', name: 'Bridge', startBar: 25, lengthBars: 8, color: aurora.green },
    ],
  },
  {
    id: 'fx',
    name: 'FX',
    type: 'bus',
    color: aurora.gold,
    volume: 0.35,
    pan: 0.4,
    muted: false,
    soloed: false,
    armed: false,
    clips: [
      { id: 'fx-1', name: 'Riser', startBar: 8, lengthBars: 2, color: aurora.gold },
      { id: 'fx-2', name: 'Riser', startBar: 16, lengthBars: 2, color: aurora.gold },
      { id: 'fx-3', name: 'Impact', startBar: 24, lengthBars: 2, color: aurora.gold },
      { id: 'fx-4', name: 'Tail', startBar: 31, lengthBars: 2, color: aurora.gold },
    ],
  },
];

// ── Mock DAW State ─────────────────────────────────────────────────────────

export const mockDAWState: DAWState = {
  transport: {
    playing: true,
    recording: false,
    bpm: 92,
    timeSignature: [4, 4],
    position: { bar: 1, beat: 1, timeMs: 0 },
    loopStart: 17,
    loopEnd: 25,
    loopEnabled: true,
  },
  tracks: mockTracks,
  keySignature: {
    key: 'Em',
    scale: 'natural minor',
    confidence: 0.87,
  },
  selectedTrackId: 'lead',
  ollamaConnected: true,
  midiInputActive: true,
  masterLevelL: 0.72,
  masterLevelR: 0.68,
};

// ── Mock Chord Suggestions ─────────────────────────────────────────────────

export const mockChordSuggestions: ChordSuggestion[] = [
  { chord: 'Am7', probability: 0.89, quality: 'minor seventh' },
  { chord: 'D7', probability: 0.76, quality: 'dominant seventh' },
  { chord: 'Gmaj7', probability: 0.68, quality: 'major seventh' },
  { chord: 'Cmaj9', probability: 0.54, quality: 'major ninth' },
  { chord: 'F#dim7', probability: 0.41, quality: 'diminished seventh' },
  { chord: 'B7', probability: 0.38, quality: 'dominant seventh' },
];

export const mockProgression = ['Em9', 'Am7', 'D7', 'Gmaj7', 'Cmaj9', 'F#dim7', 'B7'];

// ── Mock Plugin Nodes ──────────────────────────────────────────────────────

export const mockPluginNodes: PluginNode[] = [
  {
    id: 'osc1',
    type: 'oscillator',
    name: 'Saw Osc',
    x: 80,
    y: 100,
    params: { frequency: 440, detune: 5, waveform: 1 },
    inputs: [],
    outputs: ['audio'],
  },
  {
    id: 'osc2',
    type: 'oscillator',
    name: 'Sub Osc',
    x: 80,
    y: 300,
    params: { frequency: 220, detune: 0, waveform: 0 },
    inputs: [],
    outputs: ['audio'],
  },
  {
    id: 'filter1',
    type: 'filter',
    name: 'LP Filter',
    x: 350,
    y: 150,
    params: { cutoff: 2200, resonance: 0.6, type: 0 },
    inputs: ['audio'],
    outputs: ['audio'],
  },
  {
    id: 'env1',
    type: 'envelope',
    name: 'Amp Env',
    x: 350,
    y: 350,
    params: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.5 },
    inputs: [],
    outputs: ['control'],
  },
  {
    id: 'lfo1',
    type: 'lfo',
    name: 'Filter LFO',
    x: 80,
    y: 480,
    params: { rate: 2.5, depth: 0.4, waveform: 0 },
    inputs: [],
    outputs: ['control'],
  },
  {
    id: 'delay1',
    type: 'effect',
    name: 'Delay',
    x: 600,
    y: 100,
    params: { time: 0.375, feedback: 0.35, mix: 0.3 },
    inputs: ['audio'],
    outputs: ['audio'],
  },
  {
    id: 'reverb1',
    type: 'effect',
    name: 'Reverb',
    x: 600,
    y: 300,
    params: { size: 0.7, damping: 0.5, mix: 0.25 },
    inputs: ['audio'],
    outputs: ['audio'],
  },
  {
    id: 'out',
    type: 'output',
    name: 'Output',
    x: 850,
    y: 200,
    params: { volume: 0.8 },
    inputs: ['audio'],
    outputs: [],
  },
];

export const mockPluginConnections: PluginConnection[] = [
  { id: 'c1', from: { nodeId: 'osc1', port: 'audio' }, to: { nodeId: 'filter1', port: 'audio' } },
  { id: 'c2', from: { nodeId: 'osc2', port: 'audio' }, to: { nodeId: 'filter1', port: 'audio' } },
  { id: 'c3', from: { nodeId: 'filter1', port: 'audio' }, to: { nodeId: 'delay1', port: 'audio' } },
  { id: 'c4', from: { nodeId: 'filter1', port: 'audio' }, to: { nodeId: 'reverb1', port: 'audio' } },
  { id: 'c5', from: { nodeId: 'delay1', port: 'audio' }, to: { nodeId: 'out', port: 'audio' } },
  { id: 'c6', from: { nodeId: 'reverb1', port: 'audio' }, to: { nodeId: 'out', port: 'audio' } },
  { id: 'c7', from: { nodeId: 'lfo1', port: 'control' }, to: { nodeId: 'filter1', port: 'audio' } },
  { id: 'c8', from: { nodeId: 'env1', port: 'control' }, to: { nodeId: 'out', port: 'audio' } },
];

// ── Mock MIDI Notes for Piano Roll ─────────────────────────────────────────

export const mockPianoRollNotes = [
  // Em chord voicings
  { pitch: 64, start: 0, duration: 2.5, velocity: 95, channel: 0 },  // E4
  { pitch: 67, start: 0.12, duration: 2.5, velocity: 88, channel: 0 },  // G4
  { pitch: 71, start: 0.24, duration: 2.5, velocity: 90, channel: 0 },  // B4
  { pitch: 74, start: 0.36, duration: 2.0, velocity: 85, channel: 0 },  // D5
  { pitch: 78, start: 0.48, duration: 2.0, velocity: 82, channel: 0 },  // F#5

  // Melody
  { pitch: 78, start: 0.5, duration: 0.8, velocity: 110, channel: 0 },
  { pitch: 79, start: 1.5, duration: 0.5, velocity: 105, channel: 0 },
  { pitch: 81, start: 2.0, duration: 1.0, velocity: 115, channel: 0 },
  { pitch: 83, start: 3.5, duration: 0.6, velocity: 100, channel: 0 },
  { pitch: 81, start: 4.2, duration: 0.7, velocity: 108, channel: 0 },
  { pitch: 79, start: 5.0, duration: 0.9, velocity: 112, channel: 0 },
  { pitch: 78, start: 5.8, duration: 0.5, velocity: 95, channel: 0 },
  { pitch: 76, start: 6.5, duration: 1.2, velocity: 90, channel: 0 },
  { pitch: 74, start: 7.2, duration: 0.6, velocity: 85, channel: 0 },

  // Second chord Am7
  { pitch: 64, start: 3.0, duration: 2.0, velocity: 80, channel: 0 },
  { pitch: 67, start: 3.1, duration: 2.0, velocity: 78, channel: 0 },
  { pitch: 71, start: 3.2, duration: 2.0, velocity: 82, channel: 0 },

  // Bass
  { pitch: 52, start: 0, duration: 1.8, velocity: 70, channel: 0 },   // E3
  { pitch: 48, start: 2.0, duration: 1.5, velocity: 68, channel: 0 }, // C3
  { pitch: 52, start: 4.0, duration: 1.8, velocity: 72, channel: 0 }, // E3
  { pitch: 55, start: 6.0, duration: 1.5, velocity: 65, channel: 0 }, // G3
];

// ── Seeded Random ──────────────────────────────────────────────────────────

export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
