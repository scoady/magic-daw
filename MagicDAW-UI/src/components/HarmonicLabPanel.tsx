import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Wand2,
  Music2,
  Disc3,
  Waves,
  Loader2,
  CheckCircle2,
  Play,
  Square,
  Radio,
  ChevronRight,
} from 'lucide-react';
import { sendToSwift, onSwiftMessage, BridgeMessages } from '../bridge';
import { GlassPanel } from './GlassPanel';
import { aurora } from '../mockData';
import { useToast } from './Toast';

type LabMode = 'beat' | 'melody' | 'harmony' | 'full-song';
type Density = 'sparse' | 'medium' | 'dense';
type Energy = 'low' | 'medium' | 'high';
type Role = 'drums' | 'bass' | 'chords' | 'pad' | 'melody' | 'arp';
type SectionMotion = 'hold' | 'lift' | 'drive' | 'drop';

interface AIModel {
  name: string;
  size?: number;
}

interface AIResultPayload {
  result?: string;
  error?: string;
  requestId?: string;
}

interface CommitResultPayload {
  success: boolean;
  error?: string;
  trackIds?: string[];
}

interface LabSpecSection {
  name: string;
  startBar: number;
  lengthBars: number;
  energy: Energy;
  texture?: string;
  motion?: SectionMotion;
  spotlight?: Role;
  rhythmicDensity?: Density;
}

interface LabSpecTrack {
  name: string;
  role: Role;
  density: Density;
  instrument?: string;
  gmProgram?: number;
}

interface ReferenceBlueprint {
  groove: string;
  drumFeel: string;
  bassFeel: string;
  chordFeel: string;
  melodyFeel: string;
  arrangementFeel: string;
  safetyNote: string;
}

interface LabSpec {
  title: string;
  summary: string;
  bpm: number;
  key: string;
  scale: 'major' | 'minor';
  bars: number;
  progression: string[];
  sections: LabSpecSection[];
  tracks: LabSpecTrack[];
  blueprint: ReferenceBlueprint;
}

interface DraftNote {
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
  channel: number;
}

interface DraftClip {
  id: string;
  name: string;
  startBar: number;
  lengthBars: number;
  notes: DraftNote[];
  noteLabel: string;
  isLooped?: boolean;
  loopLengthBars?: number;
}

interface DraftTrack {
  id: string;
  name: string;
  type: 'midi';
  color: string;
  accent: string;
  role: Role;
  density: Density;
  instrumentName: string;
  gmProgram: number;
  noteLabel: string;
  clips: DraftClip[];
}

interface DraftArrangement {
  title: string;
  summary: string;
  bpm: number;
  key: string;
  scale: 'major' | 'minor';
  bars: number;
  progression: string[];
  sections: LabSpecSection[];
  tracks: DraftTrack[];
  blueprint: ReferenceBlueprint;
}

interface GenerationProfile {
  groove: 'laid-back' | 'driving' | 'swing' | 'steady';
  drumPattern: 'backbeat' | 'four-floor' | 'brush' | 'pulse';
  bassMotion: 'roots' | 'pedal' | 'walking' | 'syncopated';
  chordStyle: 'strum' | 'stabs' | 'sustain' | 'pulse';
  melodyShape: 'stepwise' | 'hooky' | 'wide' | 'sparse';
}

interface DraftPlaybackTarget {
  trackId: string;
  clipId?: string;
}

interface ScheduledTimer {
  id: number;
  type: 'timeout' | 'interval';
}

const BAR_BEATS = 4;
const TRACK_HEADER_W = 190;
const BAR_W = 72;
const TRACK_ROW_H = 74;
const SECTION_RIBBON_H = 26;
const RULER_H = 30;

const MODE_META: Record<LabMode, { label: string; accent: string; icon: React.ReactNode; starter: string }> = {
  beat: {
    label: 'Beat Maker',
    accent: aurora.orange,
    icon: <Disc3 size={14} />,
    starter: 'Dark swing beat, dusty drums, warm sub, late-night bounce with a strong pocket.',
  },
  melody: {
    label: 'Melody Maker',
    accent: aurora.cyan,
    icon: <Waves size={14} />,
    starter: 'Airy topline in a cinematic minor key, emotional but memorable, space for vocals.',
  },
  harmony: {
    label: 'Harmony Maker',
    accent: aurora.purple,
    icon: <Music2 size={14} />,
    starter: 'Lush harmonic bed with modern voicings, tension into release, reflective and spacious.',
  },
  'full-song': {
    label: 'Full Song Maker',
    accent: aurora.teal,
    icon: <Sparkles size={14} />,
    starter: 'Build a complete song sketch with drums, bass, chords and topline for a cinematic pop track.',
  },
};

const ROLE_COLORS: Record<Role, { raw: string; accent: string }> = {
  drums: { raw: 'orange', accent: aurora.orange },
  bass: { raw: 'teal', accent: aurora.teal },
  chords: { raw: 'purple', accent: aurora.purple },
  pad: { raw: 'pink', accent: aurora.pink },
  melody: { raw: 'cyan', accent: aurora.cyan },
  arp: { raw: 'gold', accent: aurora.gold },
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const GM_DRUMS = { kick: 36, snare: 38, hatClosed: 42, hatOpen: 46, clap: 39 };
const DRUM_LABELS: Record<number, string> = {
  36: 'Kick',
  38: 'Snare',
  39: 'Clap',
  42: 'Hat',
  46: 'Open Hat',
};

const GM_PROGRAM_NAMES: Record<number, string> = {
  0: 'Acoustic Grand Piano',
  4: 'Electric Piano 1',
  24: 'Nylon Guitar',
  32: 'Acoustic Bass',
  38: 'Synth Bass 1',
  40: 'Violin',
  48: 'String Ensemble 1',
  50: 'Synth Strings 1',
  52: 'Choir Aahs',
  73: 'Flute',
  81: 'Sawtooth Lead',
  88: 'New Age Pad',
  89: 'Warm Pad',
  90: 'Polysynth Pad',
  94: 'Halo Pad',
  98: 'Crystal FX',
  116: 'Taiko Drum',
  118: 'Synth Drum',
};

const HARMONIC_LAB_SYSTEM = `
You are generating compact JSON for an in-DAW music ideation tool called Harmonic Lab.
Return JSON only. No markdown. No commentary.
Schema:
{
  "title": "short name",
  "summary": "1 sentence",
  "bpm": 120,
  "key": "C",
  "scale": "major" | "minor",
  "bars": 16,
  "progression": ["Am","F","C","G"],
  "sections": [
    {
      "name": "Intro",
      "startBar": 1,
      "lengthBars": 4,
      "energy": "low",
      "texture": "intimate acoustic opening",
      "motion": "hold",
      "spotlight": "chords",
      "rhythmicDensity": "sparse"
    }
  ],
  "tracks": [
    {
      "name": "Pulse Drums",
      "role": "drums",
      "density": "medium",
      "instrument": "Synth Drum",
      "gmProgram": 118
    }
  ],
  "blueprint": {
    "groove": "laid-back acoustic pulse",
    "drumFeel": "soft backbeat with restrained hats",
    "bassFeel": "root-first supportive motion",
    "chordFeel": "open strummed voicings",
    "melodyFeel": "stepwise, singable, spacious contour",
    "arrangementFeel": "intimate verse, wider chorus lift",
    "safetyNote": "Use reference energy and instrumentation only; do not copy melody, lyrics, or exact progression."
  }
}
Rules:
- Roles must be from: drums, bass, chords, pad, melody, arp
- Density must be sparse, medium, or dense
- Section motion must be one of: hold, lift, drive, drop
- Bars must be between 8 and 64
- Key must be one of C, C#, D, D#, E, F, F#, G, G#, A, A#, B
- Progression should use simple pop/jazz chord symbols
- Prefer practical GM instruments that match the role
- Keep results practical for MIDI drafting
- If the brief references a real song or artist, extract a reference blueprint from the feel only.
- Never reproduce exact melody, lyrics, or a signature note sequence from a real song.
- Stay arrangement-faithful, not song-faithful.
- Use section directives to shape the arrangement arc and spotlight different roles across the form.
`;

function clamp<T extends number>(value: T, min: number, max: number): T {
  return Math.min(max, Math.max(min, value)) as T;
}

function normalizeKey(key: string): string {
  const upper = key.trim().toUpperCase();
  if (upper === 'DB') return 'C#';
  if (upper === 'EB') return 'D#';
  if (upper === 'GB') return 'F#';
  if (upper === 'AB') return 'G#';
  if (upper === 'BB') return 'A#';
  return NOTE_NAMES.includes(upper) ? upper : 'C';
}

function notePc(note: string): number {
  const idx = NOTE_NAMES.indexOf(normalizeKey(note));
  return idx >= 0 ? idx : 0;
}

function parseChord(chord: string): { root: number; quality: 'major' | 'minor' | 'dim' } {
  const match = chord.trim().match(/^([A-G](?:#|b)?)(.*)$/i);
  if (!match) return { root: 0, quality: 'major' };
  const root = notePc(match[1]);
  const suffix = match[2].toLowerCase();
  if (suffix.includes('dim')) return { root, quality: 'dim' };
  if (suffix.includes('m') && !suffix.includes('maj')) return { root, quality: 'minor' };
  return { root, quality: 'major' };
}

function chordTones(chord: string, octaveBase: number): number[] {
  const parsed = parseChord(chord);
  const intervals = parsed.quality === 'major' ? [0, 4, 7] : parsed.quality === 'minor' ? [0, 3, 7] : [0, 3, 6];
  return intervals.map((interval) => octaveBase + ((parsed.root + interval) % 12));
}

function extractJSON(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function gmName(program: number, fallback?: string): string {
  return fallback?.trim() || GM_PROGRAM_NAMES[program] || `GM ${program}`;
}

function detectStyleProfile(source: string): 'cinematic' | 'ambient' | 'jazz' | 'electronic' | 'pop' {
  const lower = source.toLowerCase();
  if (lower.includes('jazz') || lower.includes('neo soul')) return 'jazz';
  if (lower.includes('ambient') || lower.includes('atmospheric')) return 'ambient';
  if (lower.includes('edm') || lower.includes('electronic') || lower.includes('club') || lower.includes('house')) return 'electronic';
  if (lower.includes('cinematic') || lower.includes('score') || lower.includes('film')) return 'cinematic';
  return 'pop';
}

function deriveFallbackBlueprint(source: string, mode: LabMode): ReferenceBlueprint {
  const lower = source.toLowerCase();
  const groove = hasAny(lower, ['laid back', 'laid-back', 'acoustic', 'singer-songwriter', 'mayer'])
    ? 'laid-back acoustic pulse'
    : hasAny(lower, ['driving', 'anthem', 'uplift'])
      ? 'driving straight pocket'
      : hasAny(lower, ['swing', 'shuffle'])
        ? 'swung pocket'
        : 'steady modern pocket';
  const drumFeel = hasAny(lower, ['brush', 'soft', 'restrained'])
    ? 'soft backbeat with restrained hats'
    : hasAny(lower, ['four on the floor', 'club', 'house'])
      ? 'four on the floor kick with bright hats'
      : 'supportive backbeat with light syncopation';
  const bassFeel = hasAny(lower, ['walking', 'jazz'])
    ? 'walking, connective bass line'
    : hasAny(lower, ['pedal', 'drone'])
      ? 'pedal bass with occasional lifts'
      : 'root-first supportive motion';
  const chordFeel = hasAny(lower, ['strum', 'acoustic', 'guitar'])
    ? 'open strummed voicings'
    : hasAny(lower, ['stab', 'punch'])
      ? 'short rhythmic chord stabs'
      : hasAny(lower, ['pad', 'ambient', 'sustain'])
        ? 'long sustained harmony bed'
        : 'pulsed supportive voicings';
  const melodyFeel = mode === 'beat'
    ? 'minimal topline fragments'
    : hasAny(lower, ['wide', 'cinematic', 'soaring'])
      ? 'wide, spacious contour'
      : hasAny(lower, ['hook', 'anthem'])
        ? 'hooky repeated contour'
        : 'stepwise, singable, spacious contour';
  const arrangementFeel = hasAny(lower, ['intimate', 'verse', 'acoustic'])
    ? 'intimate verse, wider chorus lift'
    : hasAny(lower, ['club', 'drop'])
      ? 'gradual tension with a larger drop section'
      : 'clear sectional lift from intro to chorus';
  return {
    groove,
    drumFeel,
    bassFeel,
    chordFeel,
    melodyFeel,
    arrangementFeel,
    safetyNote: 'Uses reference energy and arrangement traits only; avoids copying melody, lyrics, and exact progression.',
  };
}

function roleInstrument(role: Role, source: string, suggestedName?: string, suggestedProgram?: number): { instrumentName: string; gmProgram: number } {
  if (typeof suggestedProgram === 'number' && suggestedProgram >= 0 && suggestedProgram <= 127) {
    return { instrumentName: gmName(suggestedProgram, suggestedName), gmProgram: suggestedProgram };
  }
  if (suggestedName?.trim()) {
    switch (role) {
      case 'drums':
        return { instrumentName: suggestedName.trim(), gmProgram: 118 };
      case 'bass':
        return { instrumentName: suggestedName.trim(), gmProgram: 38 };
      case 'pad':
        return { instrumentName: suggestedName.trim(), gmProgram: 94 };
      case 'melody':
        return { instrumentName: suggestedName.trim(), gmProgram: 81 };
      case 'arp':
        return { instrumentName: suggestedName.trim(), gmProgram: 98 };
      default:
        return { instrumentName: suggestedName.trim(), gmProgram: 48 };
    }
  }

  const profile = detectStyleProfile(source);
  const palette: Record<Role, Record<string, { instrumentName: string; gmProgram: number }>> = {
    drums: {
      cinematic: { instrumentName: 'Taiko Pulse Kit', gmProgram: 116 },
      ambient: { instrumentName: 'Synth Drum Kit', gmProgram: 118 },
      jazz: { instrumentName: 'Brush Kit', gmProgram: 0 },
      electronic: { instrumentName: 'Synth Drum Kit', gmProgram: 118 },
      pop: { instrumentName: 'Modern Drum Kit', gmProgram: 118 },
    },
    bass: {
      cinematic: { instrumentName: 'Synth Bass 1', gmProgram: 38 },
      ambient: { instrumentName: 'Acoustic Bass', gmProgram: 32 },
      jazz: { instrumentName: 'Acoustic Bass', gmProgram: 32 },
      electronic: { instrumentName: 'Synth Bass 1', gmProgram: 38 },
      pop: { instrumentName: 'Synth Bass 1', gmProgram: 38 },
    },
    chords: {
      cinematic: { instrumentName: 'String Ensemble 1', gmProgram: 48 },
      ambient: { instrumentName: 'Electric Piano 1', gmProgram: 4 },
      jazz: { instrumentName: 'Acoustic Grand Piano', gmProgram: 0 },
      electronic: { instrumentName: 'Electric Piano 1', gmProgram: 4 },
      pop: { instrumentName: 'Acoustic Grand Piano', gmProgram: 0 },
    },
    pad: {
      cinematic: { instrumentName: 'Halo Pad', gmProgram: 94 },
      ambient: { instrumentName: 'Warm Pad', gmProgram: 89 },
      jazz: { instrumentName: 'Synth Strings 1', gmProgram: 50 },
      electronic: { instrumentName: 'Polysynth Pad', gmProgram: 90 },
      pop: { instrumentName: 'Warm Pad', gmProgram: 89 },
    },
    melody: {
      cinematic: { instrumentName: 'Flute', gmProgram: 73 },
      ambient: { instrumentName: 'Crystal FX', gmProgram: 98 },
      jazz: { instrumentName: 'Sawtooth Lead', gmProgram: 81 },
      electronic: { instrumentName: 'Sawtooth Lead', gmProgram: 81 },
      pop: { instrumentName: 'Sawtooth Lead', gmProgram: 81 },
    },
    arp: {
      cinematic: { instrumentName: 'Crystal FX', gmProgram: 98 },
      ambient: { instrumentName: 'New Age Pad', gmProgram: 88 },
      jazz: { instrumentName: 'Electric Piano 1', gmProgram: 4 },
      electronic: { instrumentName: 'Crystal FX', gmProgram: 98 },
      pop: { instrumentName: 'New Age Pad', gmProgram: 88 },
    },
  };

  return palette[role][profile];
}

function defaultProgression(mode: LabMode, scale: 'major' | 'minor'): string[] {
  if (mode === 'beat') return scale === 'minor' ? ['Am', 'F', 'C', 'G'] : ['C', 'Am', 'F', 'G'];
  if (mode === 'melody') return scale === 'minor' ? ['Am', 'Em', 'F', 'G'] : ['C', 'G', 'Am', 'F'];
  if (mode === 'harmony') return scale === 'minor' ? ['Am', 'Dm', 'Em', 'Am'] : ['C', 'F', 'G', 'C'];
  return scale === 'minor' ? ['Am', 'F', 'C', 'G'] : ['C', 'G', 'Am', 'F'];
}

function defaultTracks(mode: LabMode): LabSpecTrack[] {
  if (mode === 'beat') {
    return [
      { name: 'Pulse Drums', role: 'drums', density: 'dense' },
      { name: 'Sub Bass', role: 'bass', density: 'medium' },
      { name: 'Air Pad', role: 'pad', density: 'sparse' },
    ];
  }
  if (mode === 'melody') {
    return [
      { name: 'Lead Line', role: 'melody', density: 'medium' },
      { name: 'Support Chords', role: 'chords', density: 'medium' },
      { name: 'Pulse Bass', role: 'bass', density: 'sparse' },
    ];
  }
  if (mode === 'harmony') {
    return [
      { name: 'Voiced Chords', role: 'chords', density: 'medium' },
      { name: 'Cinematic Pad', role: 'pad', density: 'sparse' },
      { name: 'Anchor Bass', role: 'bass', density: 'medium' },
      { name: 'Glass Arp', role: 'arp', density: 'medium' },
    ];
  }
  return [
    { name: 'Drums', role: 'drums', density: 'dense' },
    { name: 'Bass', role: 'bass', density: 'medium' },
    { name: 'Chords', role: 'chords', density: 'medium' },
    { name: 'Pad', role: 'pad', density: 'sparse' },
    { name: 'Lead', role: 'melody', density: 'medium' },
  ];
}

function defaultSections(bars: number): LabSpecSection[] {
  if (bars <= 16) {
    return [
      { name: 'Intro', startBar: 1, lengthBars: 4, energy: 'low', texture: 'minimal opening', motion: 'hold', spotlight: 'chords', rhythmicDensity: 'sparse' },
      { name: 'Lift', startBar: 5, lengthBars: 4, energy: 'medium', texture: 'rising support', motion: 'lift', spotlight: 'bass', rhythmicDensity: 'medium' },
      { name: 'Hook', startBar: 9, lengthBars: 4, energy: 'high', texture: 'wide hook section', motion: 'drive', spotlight: 'melody', rhythmicDensity: 'dense' },
      { name: 'Resolve', startBar: 13, lengthBars: 4, energy: 'medium', texture: 'release and settle', motion: 'drop', spotlight: 'pad', rhythmicDensity: 'medium' },
    ] as LabSpecSection[];
  }
  const sections: LabSpecSection[] = [
    { name: 'Intro', startBar: 1, lengthBars: 8, energy: 'low', texture: 'minimal opening', motion: 'hold', spotlight: 'chords', rhythmicDensity: 'sparse' },
    { name: 'Verse', startBar: 9, lengthBars: 8, energy: 'medium', texture: 'intimate lead-in', motion: 'lift', spotlight: 'melody', rhythmicDensity: 'medium' },
    { name: 'Chorus', startBar: 17, lengthBars: 8, energy: 'high', texture: 'full lift and width', motion: 'drive', spotlight: 'melody', rhythmicDensity: 'dense' },
    { name: 'Outro', startBar: 25, lengthBars: 8, energy: 'medium', texture: 'release and resolve', motion: 'drop', spotlight: 'pad', rhythmicDensity: 'medium' },
  ];
  return sections.filter((s) => s.startBar <= bars);
}

function normalizeEnergy(value: string | undefined): Energy {
  if (value === 'low' || value === 'high') return value;
  return 'medium';
}

function normalizeMotion(value: string | undefined): SectionMotion {
  if (value === 'lift' || value === 'drive' || value === 'drop') return value;
  return 'hold';
}

function normalizeRole(value: string | undefined): Role | undefined {
  if (value === 'drums' || value === 'bass' || value === 'chords' || value === 'pad' || value === 'melody' || value === 'arp') return value;
  return undefined;
}

function buildFallbackSpec(mode: LabMode, prompt: string, bars: number, bpm: number, key: string, scale: 'major' | 'minor'): LabSpec {
  const source = `${prompt} ${MODE_META[mode].starter}`;
  return {
    title: prompt.split(/[.]/)[0]?.slice(0, 36) || `${MODE_META[mode].label} Draft`,
    summary: prompt || 'AI fallback draft built from the current brief.',
    bpm,
    key,
    scale,
    bars,
    progression: defaultProgression(mode, scale),
    sections: defaultSections(bars),
    tracks: defaultTracks(mode),
    blueprint: deriveFallbackBlueprint(source, mode),
  };
}

function sanitizeSpec(mode: LabMode, spec: Partial<LabSpec>, fallback: LabSpec): LabSpec {
  return {
    title: spec.title?.trim() || fallback.title,
    summary: spec.summary?.trim() || fallback.summary,
    bpm: clamp(Math.round(spec.bpm ?? fallback.bpm), 70, 180),
    key: normalizeKey(spec.key ?? fallback.key),
    scale: spec.scale === 'minor' ? 'minor' : 'major',
    bars: clamp(Math.round(spec.bars ?? fallback.bars), 8, 64),
    progression: (spec.progression?.filter(Boolean) ?? fallback.progression).slice(0, 8),
    sections: (spec.sections?.length ? spec.sections : fallback.sections).map((section) => ({
      name: section.name || 'Section',
      startBar: clamp(Math.round(section.startBar), 1, 64),
      lengthBars: clamp(Math.round(section.lengthBars), 1, 16),
      energy: normalizeEnergy(section.energy),
      texture: section.texture?.trim() || 'supportive section texture',
      motion: normalizeMotion(section.motion),
      spotlight: normalizeRole(section.spotlight),
      rhythmicDensity: section.rhythmicDensity === 'dense' || section.rhythmicDensity === 'sparse' ? section.rhythmicDensity : 'medium',
    })),
    tracks: (spec.tracks?.length ? spec.tracks : fallback.tracks)
      .filter((track) => ['drums', 'bass', 'chords', 'pad', 'melody', 'arp'].includes(track.role))
      .map((track) => ({
        name: track.name || track.role,
        role: track.role,
        density: track.density ?? 'medium',
        instrument: track.instrument?.trim(),
        gmProgram: typeof track.gmProgram === 'number' ? clamp(Math.round(track.gmProgram), 0, 127) : undefined,
      })),
    blueprint: {
      groove: spec.blueprint?.groove?.trim() || fallback.blueprint.groove,
      drumFeel: spec.blueprint?.drumFeel?.trim() || fallback.blueprint.drumFeel,
      bassFeel: spec.blueprint?.bassFeel?.trim() || fallback.blueprint.bassFeel,
      chordFeel: spec.blueprint?.chordFeel?.trim() || fallback.blueprint.chordFeel,
      melodyFeel: spec.blueprint?.melodyFeel?.trim() || fallback.blueprint.melodyFeel,
      arrangementFeel: spec.blueprint?.arrangementFeel?.trim() || fallback.blueprint.arrangementFeel,
      safetyNote: spec.blueprint?.safetyNote?.trim() || fallback.blueprint.safetyNote,
    },
  };
}

function resolveGenerationProfile(blueprint: ReferenceBlueprint, source: string): GenerationProfile {
  const lower = `${source} ${blueprint.groove} ${blueprint.drumFeel} ${blueprint.bassFeel} ${blueprint.chordFeel} ${blueprint.melodyFeel}`.toLowerCase();
  const groove: GenerationProfile['groove'] = hasAny(lower, ['swing', 'shuffle']) ? 'swing'
    : hasAny(lower, ['laid back', 'laid-back', 'acoustic', 'relaxed']) ? 'laid-back'
      : hasAny(lower, ['driving', 'push', 'anthem']) ? 'driving'
        : 'steady';
  const drumPattern: GenerationProfile['drumPattern'] = hasAny(lower, ['four on the floor', 'four-on-the-floor', 'club', 'house']) ? 'four-floor'
    : hasAny(lower, ['brush', 'restrained', 'soft']) ? 'brush'
      : hasAny(lower, ['pulse', 'tom']) ? 'pulse'
        : 'backbeat';
  const bassMotion: GenerationProfile['bassMotion'] = hasAny(lower, ['walk', 'walking']) ? 'walking'
    : hasAny(lower, ['syncop', 'bounce', 'offbeat']) ? 'syncopated'
      : hasAny(lower, ['pedal', 'drone']) ? 'pedal'
        : 'roots';
  const chordStyle: GenerationProfile['chordStyle'] = hasAny(lower, ['strum', 'guitar', 'open']) ? 'strum'
    : hasAny(lower, ['stab', 'punch']) ? 'stabs'
      : hasAny(lower, ['sustain', 'bed', 'pad']) ? 'sustain'
        : 'pulse';
  const melodyShape: GenerationProfile['melodyShape'] = hasAny(lower, ['hook', 'repeat']) ? 'hooky'
    : hasAny(lower, ['wide', 'soaring', 'cinematic']) ? 'wide'
      : hasAny(lower, ['sparse', 'minimal']) ? 'sparse'
        : 'stepwise';
  return { groove, drumPattern, bassMotion, chordStyle, melodyShape };
}

function sectionDensity(section: LabSpecSection, fallback: Density): Density {
  if (section.rhythmicDensity === 'dense' || section.rhythmicDensity === 'sparse') return section.rhythmicDensity;
  return fallback;
}

function scalePcs(key: string, scale: 'major' | 'minor'): number[] {
  const tonic = notePc(key);
  const steps = scale === 'minor' ? MINOR_SCALE : MAJOR_SCALE;
  return steps.map((step) => (tonic + step) % 12);
}

function melodyNotePool(chord: string, key: string, scale: 'major' | 'minor', octaveBase: number): number[] {
  const chordNotes = chordTones(chord, octaveBase);
  const pcs = scalePcs(key, scale);
  const scaleNotes = pcs.map((pc) => octaveBase + pc);
  return [...new Set([...chordNotes, ...scaleNotes])].sort((a, b) => a - b);
}

function buildDrumNotes(section: LabSpecSection, density: Density, profile: GenerationProfile): DraftNote[] {
  const notes: DraftNote[] = [];
  const localDensity = sectionDensity(section, density);
  const eighths = localDensity === 'dense' ? 8 : localDensity === 'medium' ? 4 : 2;
  for (let bar = 0; bar < section.lengthBars; bar++) {
    const base = (section.startBar - 1 + bar) * BAR_BEATS;
    if (profile.drumPattern === 'four-floor') {
      for (let beat = 0; beat < 4; beat++) {
        notes.push({ pitch: GM_DRUMS.kick, start: base + beat, duration: 0.4, velocity: 108, channel: 9 });
      }
      notes.push({ pitch: GM_DRUMS.snare, start: base + 1, duration: 0.5, velocity: 98, channel: 9 });
      notes.push({ pitch: GM_DRUMS.snare, start: base + 3, duration: 0.5, velocity: 98, channel: 9 });
    } else if (profile.drumPattern === 'brush') {
      notes.push({ pitch: GM_DRUMS.kick, start: base, duration: 0.5, velocity: 92, channel: 9 });
      notes.push({ pitch: GM_DRUMS.kick, start: base + 2.5, duration: 0.5, velocity: 84, channel: 9 });
      notes.push({ pitch: GM_DRUMS.snare, start: base + 1, duration: 0.5, velocity: 78, channel: 9 });
      notes.push({ pitch: GM_DRUMS.snare, start: base + 3, duration: 0.5, velocity: 76, channel: 9 });
    } else if (profile.drumPattern === 'pulse') {
      notes.push({ pitch: GM_DRUMS.kick, start: base, duration: 0.5, velocity: 112, channel: 9 });
      notes.push({ pitch: GM_DRUMS.kick, start: base + 2, duration: 0.5, velocity: 102, channel: 9 });
      notes.push({ pitch: GM_DRUMS.clap, start: base + 3, duration: 0.4, velocity: 88, channel: 9 });
    } else {
      notes.push({ pitch: GM_DRUMS.kick, start: base, duration: 0.5, velocity: 118, channel: 9 });
      notes.push({ pitch: GM_DRUMS.kick, start: base + 2, duration: 0.5, velocity: 108, channel: 9 });
      notes.push({ pitch: GM_DRUMS.snare, start: base + 1, duration: 0.5, velocity: 104, channel: 9 });
      notes.push({ pitch: GM_DRUMS.snare, start: base + 3, duration: 0.5, velocity: 100, channel: 9 });
    }
    for (let step = 0; step < eighths; step++) {
      const swingOffset = profile.groove === 'swing' && step % 2 === 1 ? 0.12 : 0;
      notes.push({
        pitch: step === eighths - 1 && localDensity === 'dense' && profile.drumPattern !== 'brush' ? GM_DRUMS.hatOpen : GM_DRUMS.hatClosed,
        start: base + step * (BAR_BEATS / eighths) + swingOffset,
        duration: 0.25,
        velocity: profile.drumPattern === 'brush' ? 56 : localDensity === 'sparse' ? 72 : 82,
        channel: 9,
      });
    }
    if (section.motion === 'lift' || section.motion === 'drive') {
      notes.push({ pitch: GM_DRUMS.clap, start: base + 3.5, duration: 0.25, velocity: 72, channel: 9 });
    }
  }
  return notes;
}

function buildBassNotes(section: LabSpecSection, progression: string[], density: Density, profile: GenerationProfile): DraftNote[] {
  const notes: DraftNote[] = [];
  const localDensity = sectionDensity(section, density);
  const pulses = localDensity === 'dense' ? 4 : localDensity === 'medium' ? 2 : 1;
  for (let bar = 0; bar < section.lengthBars; bar++) {
    const chord = progression[bar % progression.length];
    const parsed = parseChord(chord);
    const root = 36 + parsed.root;
    const third = root + (parsed.quality === 'major' ? 4 : 3);
    const fifth = root + 7;
    const base = (section.startBar - 1 + bar) * BAR_BEATS;
    if (profile.bassMotion === 'walking' || section.spotlight === 'bass') {
      [root, third, fifth, third].forEach((pitch, idx) => {
        notes.push({ pitch, start: base + idx, duration: 0.9, velocity: 84, channel: 0 });
      });
    } else if (profile.bassMotion === 'syncopated') {
      [0, 1.5, 2.5].forEach((offset, idx) => {
        notes.push({ pitch: idx === 1 ? fifth : root, start: base + offset, duration: 0.8, velocity: 92, channel: 0 });
      });
    } else if (profile.bassMotion === 'pedal') {
      notes.push({ pitch: root, start: base, duration: 3.6, velocity: 86, channel: 0 });
    } else {
      for (let pulse = 0; pulse < pulses; pulse++) {
        notes.push({
          pitch: root,
          start: base + pulse * (BAR_BEATS / pulses),
          duration: (BAR_BEATS / pulses) * 0.9,
          velocity: 92,
          channel: 0,
        });
      }
    }
  }
  return notes;
}

function buildChordNotes(section: LabSpecSection, progression: string[], density: Density, profile: GenerationProfile): DraftNote[] {
  const notes: DraftNote[] = [];
  for (let bar = 0; bar < section.lengthBars; bar++) {
    const chord = progression[bar % progression.length];
    const tones = chordTones(chord, 60);
    const base = (section.startBar - 1 + bar) * BAR_BEATS;
    if (profile.chordStyle === 'strum' || section.texture?.toLowerCase().includes('acoustic')) {
      tones.forEach((pitch, index) => {
        notes.push({
          pitch: pitch + (index === 0 ? 0 : 12),
          start: base + index * 0.08,
          duration: 3.2,
          velocity: 76 - index * 4,
          channel: 0,
        });
      });
    } else if (profile.chordStyle === 'stabs') {
      [0, 2].forEach((hit) => {
        tones.forEach((pitch, index) => {
          notes.push({
            pitch: pitch + (index === 0 ? 0 : 12),
            start: base + hit,
            duration: 0.7,
            velocity: 82,
            channel: 0,
          });
        });
      });
    } else if (profile.chordStyle === 'sustain') {
      tones.forEach((pitch, index) => {
        notes.push({
          pitch: pitch + (index === 2 ? 12 : 0),
          start: base,
          duration: 3.8,
          velocity: 66,
          channel: 0,
        });
      });
    } else {
      const localDensity = sectionDensity(section, density);
      const hits = localDensity === 'dense' || section.motion === 'drive' ? 2 : 1;
      for (let hit = 0; hit < hits; hit++) {
        const start = base + hit * 2;
        tones.forEach((pitch, index) => {
          notes.push({
            pitch: pitch + (index === 0 ? 0 : 12),
            start,
            duration: hits === 1 ? 3.75 : 1.8,
            velocity: 78,
            channel: 0,
          });
        });
      }
    }
  }
  return notes;
}

function buildPadNotes(section: LabSpecSection, progression: string[], profile: GenerationProfile): DraftNote[] {
  const notes: DraftNote[] = [];
  const step = profile.chordStyle === 'sustain' || section.motion === 'hold' ? 4 : 2;
  for (let bar = 0; bar < section.lengthBars; bar += step) {
    const chord = progression[bar % progression.length];
    const tones = chordTones(chord, 48);
    const base = (section.startBar - 1 + bar) * BAR_BEATS;
    tones.forEach((pitch, index) => {
      notes.push({
        pitch: pitch + (index === 2 ? 12 : 0),
        start: base,
        duration: step * BAR_BEATS - 0.5,
        velocity: 60,
        channel: 0,
      });
    });
  }
  return notes;
}

function buildMelodyNotes(section: LabSpecSection, progression: string[], key: string, scale: 'major' | 'minor', density: Density, profile: GenerationProfile): DraftNote[] {
  const notes: DraftNote[] = [];
  const localDensity = sectionDensity(section, density);
  const pattern = section.spotlight === 'melody'
    ? [0, 2, 4, 2]
    : profile.melodyShape === 'hooky'
    ? [0, 2, 4, 2]
    : profile.melodyShape === 'wide'
      ? [0, 3, 5]
      : profile.melodyShape === 'sparse'
        ? [1]
        : localDensity === 'dense' ? [0, 1, 2, 1] : localDensity === 'medium' ? [0, 2] : [1];
  let previousPitch = 72 + notePc(key);
  for (let bar = 0; bar < section.lengthBars; bar++) {
    const chord = progression[bar % progression.length];
    const pool = melodyNotePool(chord, key, scale, 72);
    const base = (section.startBar - 1 + bar) * BAR_BEATS;
    pattern.forEach((choice, idx) => {
      let pitch = pool[(choice + bar) % pool.length];
      if (profile.melodyShape === 'stepwise') {
        const nearest = [...pool].sort((a, b) => Math.abs(a - previousPitch) - Math.abs(b - previousPitch));
        pitch = nearest[Math.min(idx % 2, nearest.length - 1)];
      }
      if (profile.melodyShape === 'wide' && idx % 2 === 1) {
        pitch = pool[Math.min(pool.length - 1, (choice + bar + 2) % pool.length)];
      }
      if (section.motion === 'lift' || section.motion === 'drive') {
        pitch = Math.min(84, pitch + (idx % 2 === 0 ? 2 : 4));
      }
      if (section.motion === 'drop') {
        pitch = Math.max(67, pitch - 2);
      }
      previousPitch = pitch;
      notes.push({
        pitch,
        start: base + idx * (BAR_BEATS / pattern.length) + (profile.groove === 'laid-back' ? 0.06 : 0),
        duration: profile.melodyShape === 'sparse' ? 1.6 : localDensity === 'sparse' ? 1.5 : 0.9,
        velocity: 86,
        channel: 0,
      });
    });
  }
  return notes;
}

function buildArpNotes(section: LabSpecSection, progression: string[], profile: GenerationProfile): DraftNote[] {
  const notes: DraftNote[] = [];
  for (let bar = 0; bar < section.lengthBars; bar++) {
    const chord = progression[bar % progression.length];
    const tones = chordTones(chord, 72);
    const base = (section.startBar - 1 + bar) * BAR_BEATS;
    const steps = section.motion === 'hold' ? 4 : 8;
    for (let step = 0; step < steps; step++) {
      notes.push({
        pitch: tones[step % tones.length] + (step >= Math.ceil(steps / 2) || profile.melodyShape === 'wide' ? 12 : 0),
        start: base + step * (BAR_BEATS / steps) + (profile.groove === 'swing' && step % 2 === 1 ? 0.08 : 0),
        duration: 0.4,
        velocity: 74,
        channel: 0,
      });
    }
  }
  return notes;
}

function formatPitch(pitch: number): string {
  return `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

function summarizeNotes(notes: DraftNote[], role?: Role, limit = 6): string {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const note of notes) {
    const label = role === 'drums' ? (DRUM_LABELS[note.pitch] ?? `Dr ${note.pitch}`) : formatPitch(note.pitch);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length >= limit) break;
  }
  return labels.length > 0 ? labels.join(' • ') : 'No notes';
}

function synthesizeDraft(spec: LabSpec, sourceText: string): DraftArrangement {
  const profile = resolveGenerationProfile(spec.blueprint, sourceText);
  const tracks: DraftTrack[] = spec.tracks.map((trackSpec, trackIndex) => {
    const color = ROLE_COLORS[trackSpec.role] ?? ROLE_COLORS.chords;
    const instrument = roleInstrument(trackSpec.role, sourceText, trackSpec.instrument, trackSpec.gmProgram);
    const clips = spec.sections.map((section, sectionIndex) => {
      const sectionProgression = Array.from(
        { length: section.lengthBars },
        (_, i) => spec.progression[(section.startBar - 1 + i) % spec.progression.length],
      );
      let notes: DraftNote[] = [];
      if (trackSpec.role === 'drums') notes = buildDrumNotes(section, trackSpec.density, profile);
      if (trackSpec.role === 'bass') notes = buildBassNotes(section, sectionProgression, trackSpec.density, profile);
      if (trackSpec.role === 'chords') notes = buildChordNotes(section, sectionProgression, trackSpec.density, profile);
      if (trackSpec.role === 'pad') notes = buildPadNotes(section, sectionProgression, profile);
      if (trackSpec.role === 'melody') notes = buildMelodyNotes(section, sectionProgression, spec.key, spec.scale, trackSpec.density, profile);
      if (trackSpec.role === 'arp') notes = buildArpNotes(section, sectionProgression, profile);

      const clipNotes = notes.map((note) => ({
        ...note,
        start: note.start - (section.startBar - 1) * BAR_BEATS,
      }));

      return {
        id: `lab-clip-${trackIndex}-${sectionIndex}`,
        name: `${section.name} ${trackSpec.role}`,
        startBar: section.startBar,
        lengthBars: section.lengthBars,
        notes: clipNotes,
        noteLabel: summarizeNotes(clipNotes, trackSpec.role, 5),
        isLooped: section.lengthBars >= 4,
        loopLengthBars: section.lengthBars,
      };
    });

    return {
      id: `lab-track-${trackIndex}`,
      name: trackSpec.name,
      type: 'midi',
      color: color.raw,
      accent: color.accent,
      role: trackSpec.role,
      density: trackSpec.density,
      instrumentName: instrument.instrumentName,
      gmProgram: instrument.gmProgram,
      noteLabel: summarizeNotes(clips.flatMap((clip) => clip.notes), trackSpec.role, 7),
      clips,
    };
  });

  return {
    title: spec.title,
    summary: spec.summary,
    bpm: spec.bpm,
    key: spec.key,
    scale: spec.scale,
    bars: spec.bars,
    progression: spec.progression,
    sections: spec.sections,
    tracks,
    blueprint: spec.blueprint,
  };
}

function energyColor(energy: Energy): string {
  if (energy === 'high') return aurora.orange;
  if (energy === 'medium') return aurora.cyan;
  return aurora.teal;
}

function noteY(track: DraftTrack, pitch: number): number {
  if (track.role === 'drums') {
    const band = [GM_DRUMS.kick, GM_DRUMS.snare, GM_DRUMS.hatClosed, GM_DRUMS.hatOpen, GM_DRUMS.clap];
    const idx = Math.max(0, band.indexOf(pitch));
    return 48 - idx * 8;
  }
  return clamp(52 - (pitch - 48) * 1.2, 8, 52);
}

function chipStyle(accent: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 34,
    borderRadius: 10,
    padding: '0 12px',
    border: `1px solid ${accent}44`,
    background: `linear-gradient(180deg, ${accent}12, rgba(6,10,18,0.76))`,
    color: aurora.text,
    fontSize: 12,
    fontWeight: 700,
  };
}

function buttonStyle(accent: string, muted = false): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 38,
    padding: '0 14px',
    borderRadius: 12,
    border: muted ? '1px solid rgba(120,200,220,0.14)' : `1px solid ${accent}55`,
    background: muted ? 'rgba(8,14,24,0.88)' : `linear-gradient(180deg, ${accent}22, rgba(8,14,24,0.9))`,
    color: muted ? aurora.textDim : aurora.text,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
  };
}

export const HarmonicLabPanel: React.FC = () => {
  const { showToast } = useToast();
  const [mode, setMode] = useState<LabMode>('full-song');
  const [prompt, setPrompt] = useState(MODE_META['full-song'].starter);
  const [genre, setGenre] = useState('cinematic pop');
  const [bars, setBars] = useState(16);
  const [bpm, setBpm] = useState(120);
  const [key, setKey] = useState('C');
  const [scale, setScale] = useState<'major' | 'minor'>('minor');
  const [models, setModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('qwen2.5:14b');
  const [ollamaAvailable, setOllamaAvailable] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [rawIdea, setRawIdea] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftArrangement | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playingPreview, setPlayingPreview] = useState(false);
  const [playheadBeat, setPlayheadBeat] = useState(0);
  const [mutedTrackIds, setMutedTrackIds] = useState<Set<string>>(new Set());
  const [soloTrackIds, setSoloTrackIds] = useState<Set<string>>(new Set());
  const requestIdRef = useRef(0);
  const activeRequestRef = useRef<string | null>(null);
  const timersRef = useRef<ScheduledTimer[]>([]);
  const playheadStartRef = useRef<number | null>(null);
  const previewDurationRef = useRef(0);

  useEffect(() => {
    const unsubModels = onSwiftMessage(BridgeMessages.AI_MODELS, (payload: unknown) => {
      const data = payload as { models?: AIModel[] };
      const next = data.models ?? [];
      setModels(next);
      if (next.length > 0 && !next.some((model) => model.name === selectedModel)) {
        setSelectedModel(next[0].name);
      }
    });
    const unsubStatus = onSwiftMessage(BridgeMessages.OLLAMA_STATUS, (payload: unknown) => {
      const data = payload as { available?: boolean };
      setOllamaAvailable(Boolean(data.available));
    });
    const unsubResult = onSwiftMessage(BridgeMessages.AI_RESULT, (payload: unknown) => {
      const data = payload as AIResultPayload;
      if (!activeRequestRef.current || data.requestId !== activeRequestRef.current) return;
      setGenerating(false);
      activeRequestRef.current = null;
      if (data.error) {
        showToast(`AI draft failed: ${data.error}`, 'error');
        return;
      }
      const raw = data.result ?? '';
      setRawIdea(raw);
      const fallback = buildFallbackSpec(mode, prompt, bars, bpm, key, scale);
      const json = extractJSON(raw);
      let spec = fallback;
      if (json) {
        try {
          spec = sanitizeSpec(mode, JSON.parse(json) as Partial<LabSpec>, fallback);
        } catch {
          spec = fallback;
        }
      }
      const nextDraft = synthesizeDraft(spec, `${genre}\n${prompt}`);
      setDraft(nextDraft);
      setSelectedTrackId(nextDraft.tracks[0]?.id ?? null);
      setSelectedClipId(nextDraft.tracks[0]?.clips[0]?.id ?? null);
      setMutedTrackIds(new Set());
      setSoloTrackIds(new Set());
      showToast('Draft generated', 'success');
    });
    const unsubCommit = onSwiftMessage(BridgeMessages.HARMONIC_LAB_COMMIT_RESULT, (payload: unknown) => {
      const data = payload as CommitResultPayload;
      setCommitting(false);
      if (data.success) {
        showToast(`Committed ${data.trackIds?.length ?? 0} tracks to Arrange`, 'success');
        return;
      }
      showToast(data.error ?? 'Commit failed', 'error');
    });

    sendToSwift(BridgeMessages.AI_CHECK_STATUS);
    sendToSwift(BridgeMessages.AI_LIST_MODELS);

    return () => {
      unsubModels();
      unsubStatus();
      unsubResult();
      unsubCommit();
    };
  }, [bars, bpm, genre, key, mode, prompt, scale, selectedModel, showToast]);

  const clearPreviewTimers = useCallback(() => {
    timersRef.current.forEach((timer) => {
      if (timer.type === 'timeout') {
        window.clearTimeout(timer.id);
      } else {
        window.clearInterval(timer.id);
      }
    });
    timersRef.current = [];
    playheadStartRef.current = null;
    previewDurationRef.current = 0;
    setPlayingPreview(false);
    setPlayheadBeat(0);
  }, []);

  useEffect(() => clearPreviewTimers, [clearPreviewTimers]);

  const buildPrompt = useCallback(() => {
    return [
      `Mode: ${mode}`,
      `Genre: ${genre}`,
      `Bars: ${bars}`,
      `BPM: ${bpm}`,
      `Key: ${key} ${scale}`,
      `Brief: ${prompt.trim() || MODE_META[mode].starter}`,
      'If the brief references a real song or artist, extract only the arrangement blueprint: groove, instrumentation, section pacing, chord language, and melodic contour.',
      'For each section, define texture, motion, spotlight, and rhythmic density so the arrangement changes across the form.',
      'Do not copy melody, lyrics, or exact progression from the reference.',
      'Make it cinematic, practical, loopable, instrument-aware, and DAW-ready.',
    ].join('\n');
  }, [mode, genre, bars, bpm, key, scale, prompt]);

  const handleGenerate = useCallback(() => {
    clearPreviewTimers();
    const fallback = buildFallbackSpec(mode, prompt.trim(), bars, bpm, key, scale);
    if (!ollamaAvailable) {
      setRawIdea('Ollama unavailable; using local fallback draft.');
      const nextDraft = synthesizeDraft(fallback, `${genre}\n${prompt}`);
      setDraft(nextDraft);
      setSelectedTrackId(nextDraft.tracks[0]?.id ?? null);
      setSelectedClipId(nextDraft.tracks[0]?.clips[0]?.id ?? null);
      setMutedTrackIds(new Set());
      setSoloTrackIds(new Set());
      showToast('Built local fallback draft', 'success');
      return;
    }
    const requestId = `harmonic-lab-${++requestIdRef.current}`;
    activeRequestRef.current = requestId;
    setGenerating(true);
    setRawIdea(null);
    sendToSwift(BridgeMessages.AI_RAW_REQUEST, {
      prompt: buildPrompt(),
      system: HARMONIC_LAB_SYSTEM,
      model: selectedModel,
      requestId,
    });
  }, [bars, bpm, buildPrompt, clearPreviewTimers, genre, key, mode, ollamaAvailable, prompt, scale, selectedModel, showToast]);

  const handleCommit = useCallback(() => {
    if (!draft) return;
    setCommitting(true);
    sendToSwift(BridgeMessages.HARMONIC_LAB_COMMIT, {
      name: draft.title,
      bpm: draft.bpm,
      key: draft.key,
      keyScale: draft.scale,
      tracks: draft.tracks.map((track) => ({
        name: track.name,
        type: track.type,
        color: track.color,
        gmProgram: track.gmProgram,
        instrumentName: track.instrumentName,
        clips: track.clips.map((clip) => ({
          name: clip.name,
          startBar: clip.startBar,
          lengthBars: clip.lengthBars,
          isLooped: clip.isLooped ?? false,
          loopLengthBars: clip.loopLengthBars,
          notes: clip.notes,
        })),
      })),
    });
  }, [draft]);

  const draftStats = useMemo(() => {
    if (!draft) return null;
    const trackCount = draft.tracks.length;
    const clipCount = draft.tracks.reduce((sum, track) => sum + track.clips.length, 0);
    const noteCount = draft.tracks.reduce((sum, track) => sum + track.clips.reduce((clipSum, clip) => clipSum + clip.notes.length, 0), 0);
    return { trackCount, clipCount, noteCount };
  }, [draft]);

  const timelineWidth = useMemo(() => Math.max(960, (draft?.bars ?? bars) * BAR_W), [bars, draft?.bars]);
  const selectedTrack = useMemo(() => draft?.tracks.find((track) => track.id === selectedTrackId) ?? draft?.tracks[0] ?? null, [draft, selectedTrackId]);
  const selectedClip = useMemo(
    () => selectedTrack?.clips.find((clip) => clip.id === selectedClipId) ?? null,
    [selectedClipId, selectedTrack],
  );
  const audibleTracks = useMemo(() => {
    if (!draft) return [];
    if (soloTrackIds.size > 0) {
      return draft.tracks.filter((track) => soloTrackIds.has(track.id));
    }
    return draft.tracks.filter((track) => !mutedTrackIds.has(track.id));
  }, [draft, mutedTrackIds, soloTrackIds]);

  const focusLabel = useMemo(() => {
    if (selectedClip && selectedTrack) return `${selectedTrack.name} / ${selectedClip.name}`;
    if (selectedTrack) return `${selectedTrack.name}`;
    return 'No focus selected';
  }, [selectedClip, selectedTrack]);

  const handlePreview = useCallback((target?: DraftPlaybackTarget) => {
    if (!draft) return;
    clearPreviewTimers();

    const track = draft.tracks.find((item) => item.id === (target?.trackId ?? selectedTrack?.id));
    if (!track) return;
    const clip = target?.clipId ? track.clips.find((item) => item.id === target.clipId) : selectedClip && selectedClip.id && selectedTrack?.id === track.id ? selectedClip : null;
    const notes = (clip ? clip.notes : track.clips.flatMap((item) =>
      item.notes.map((note) => ({
        ...note,
        start: (item.startBar - 1) * BAR_BEATS + note.start,
      })),
    )).sort((a, b) => a.start - b.start);

    if (notes.length === 0) {
      showToast('Nothing to preview on that lane', 'error');
      return;
    }

    const offsetBeats = clip ? 0 : Math.min(...notes.map((note) => note.start));
    const normalizedNotes = notes.map((note) => ({ ...note, start: note.start - offsetBeats }));
    const totalBeats = Math.max(...normalizedNotes.map((note) => note.start + note.duration));
    const beatMs = 60000 / (draft.bpm || bpm);

    sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, { gmProgram: track.gmProgram });
    setPlayingPreview(true);
    playheadStartRef.current = performance.now();
    previewDurationRef.current = totalBeats;

    const playheadInterval = window.setInterval(() => {
      if (playheadStartRef.current === null) return;
      const elapsedBeats = (performance.now() - playheadStartRef.current) / beatMs;
      if (elapsedBeats >= previewDurationRef.current) {
        clearPreviewTimers();
        return;
      }
      setPlayheadBeat(elapsedBeats);
    }, 33);
    timersRef.current.push({ id: playheadInterval, type: 'interval' });

    normalizedNotes.forEach((note) => {
      const noteOn = window.setTimeout(() => {
        sendToSwift('midi.noteOn', {
          note: note.pitch,
          velocity: clamp(Math.round(note.velocity), 1, 127),
          channel: note.channel,
        });
      }, note.start * beatMs);
      const noteOff = window.setTimeout(() => {
        sendToSwift('midi.noteOff', {
          note: note.pitch,
          channel: note.channel,
        });
      }, (note.start + note.duration) * beatMs);
      timersRef.current.push({ id: noteOn, type: 'timeout' }, { id: noteOff, type: 'timeout' });
    });

    const stopTimer = window.setTimeout(() => {
      clearPreviewTimers();
    }, totalBeats * beatMs + 80);
    timersRef.current.push({ id: stopTimer, type: 'timeout' });
  }, [bpm, clearPreviewTimers, draft, selectedClip, selectedTrack, showToast]);

  const handlePlayAll = useCallback(() => {
    if (!draft) return;
    const tracksToPlay = audibleTracks;
    if (tracksToPlay.length === 0) {
      showToast('All lanes are muted', 'error');
      return;
    }

    clearPreviewTimers();
    const mergedNotes = tracksToPlay.flatMap((track) =>
      track.clips.flatMap((clip) =>
        clip.notes.map((note) => ({
          ...note,
          start: (clip.startBar - 1) * BAR_BEATS + note.start,
        })),
      ),
    ).sort((a, b) => a.start - b.start);

    if (mergedNotes.length === 0) {
      showToast('Nothing to preview in the active lanes', 'error');
      return;
    }

    const beatMs = 60000 / (draft.bpm || bpm);
    const totalBeats = Math.max(...mergedNotes.map((note) => note.start + note.duration));
    sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, { gmProgram: 0 });
    setPlayingPreview(true);
    playheadStartRef.current = performance.now();
    previewDurationRef.current = totalBeats;

    const playheadInterval = window.setInterval(() => {
      if (playheadStartRef.current === null) return;
      const elapsedBeats = (performance.now() - playheadStartRef.current) / beatMs;
      if (elapsedBeats >= previewDurationRef.current) {
        clearPreviewTimers();
        return;
      }
      setPlayheadBeat(elapsedBeats);
    }, 33);
    timersRef.current.push({ id: playheadInterval, type: 'interval' });

    mergedNotes.forEach((note) => {
      const noteOn = window.setTimeout(() => {
        sendToSwift('midi.noteOn', {
          note: note.pitch,
          velocity: clamp(Math.round(note.velocity), 1, 127),
          channel: note.channel,
        });
      }, note.start * beatMs);
      const noteOff = window.setTimeout(() => {
        sendToSwift('midi.noteOff', {
          note: note.pitch,
          channel: note.channel,
        });
      }, (note.start + note.duration) * beatMs);
      timersRef.current.push({ id: noteOn, type: 'timeout' }, { id: noteOff, type: 'timeout' });
    });

    const stopTimer = window.setTimeout(() => {
      clearPreviewTimers();
    }, totalBeats * beatMs + 80);
    timersRef.current.push({ id: stopTimer, type: 'timeout' });
  }, [audibleTracks, bpm, clearPreviewTimers, draft, showToast]);

  const toggleMuted = useCallback((trackId: string) => {
    setMutedTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  const toggleSolo = useCallback((trackId: string) => {
    setSoloTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: 'radial-gradient(circle at 18% 26%, rgba(67, 168, 255, 0.16), transparent 26%), radial-gradient(circle at 78% 12%, rgba(244, 114, 182, 0.08), transparent 20%), linear-gradient(180deg, #07111f 0%, #040913 100%)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'linear-gradient(rgba(148,163,184,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.03) 1px, transparent 1px)',
          backgroundSize: '120px 120px',
          opacity: 0.35,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: '58px 10% auto 10%',
          height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(103,232,249,0.32), transparent)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'grid',
          gridTemplateColumns: '330px 1fr',
          gap: 14,
          height: '100%',
          padding: 12,
          minHeight: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, overflow: 'auto', paddingRight: 2 }}>
          <GlassPanel style={{ padding: 16, borderRadius: 18, background: 'linear-gradient(180deg, rgba(6,12,24,0.92), rgba(4,9,18,0.86))', border: '1px solid rgba(120,200,220,0.14)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.14em', color: aurora.textMuted, textTransform: 'uppercase' }}>Harmonic Lab</div>
                <div style={{ marginTop: 6, fontSize: 28, color: aurora.text, fontWeight: 800, lineHeight: 1.02 }}>AI Song Forge</div>
              </div>
              <div style={chipStyle(ollamaAvailable ? aurora.teal : aurora.orange)}>
                <Radio size={13} />
                <span>{ollamaAvailable ? 'Ollama Ready' : 'Fallback Mode'}</span>
              </div>
            </div>
            <div style={{ marginTop: 8, color: aurora.textDim, fontSize: 13, lineHeight: 1.45 }}>
              Prompt the lab, generate a playable draft, then commit the lanes straight into Arrange.
            </div>
          </GlassPanel>

          <GlassPanel style={{ padding: 12, borderRadius: 18, background: 'rgba(7,13,24,0.9)', border: '1px solid rgba(120,200,220,0.12)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {(Object.keys(MODE_META) as LabMode[]).map((item) => {
                const meta = MODE_META[item];
                const active = item === mode;
                return (
                  <button
                    key={item}
                    onClick={() => {
                      setMode(item);
                      setPrompt(MODE_META[item].starter);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      height: 44,
                      padding: '0 12px',
                      borderRadius: 12,
                      border: `1px solid ${active ? `${meta.accent}66` : 'rgba(120,200,220,0.12)'}`,
                      background: active ? `${meta.accent}16` : 'rgba(10,18,34,0.72)',
                      color: active ? aurora.text : aurora.textDim,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ color: meta.accent }}>{meta.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 800 }}>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </GlassPanel>

          <GlassPanel style={{ padding: 12, borderRadius: 18, background: 'rgba(7,13,24,0.9)', border: '1px solid rgba(120,200,220,0.12)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, color: aurora.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Brief</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the arrangement you want..."
              style={{
                width: '100%',
                minHeight: 170,
                resize: 'vertical',
                background: 'rgba(3,8,16,0.92)',
                border: '1px solid rgba(120,200,220,0.12)',
                borderRadius: 14,
                padding: 14,
                color: aurora.text,
                fontSize: 14,
                lineHeight: 1.5,
                outline: 'none',
              }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Genre / style" style={inputStyle} />
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} style={inputStyle}>
                {(models.length > 0 ? models : [{ name: 'qwen2.5:14b' }]).map((model) => (
                  <option key={model.name} value={model.name}>{model.name}</option>
                ))}
              </select>
              <input type="number" min={8} max={64} step={4} value={bars} onChange={(e) => setBars(clamp(Number(e.target.value) || 16, 8, 64))} style={inputStyle} />
              <input type="number" min={70} max={180} value={bpm} onChange={(e) => setBpm(clamp(Number(e.target.value) || 120, 70, 180))} style={inputStyle} />
              <select value={key} onChange={(e) => setKey(e.target.value)} style={inputStyle}>
                {NOTE_NAMES.map((note) => <option key={note} value={note}>{note}</option>)}
              </select>
              <select value={scale} onChange={(e) => setScale(e.target.value as 'major' | 'minor')} style={inputStyle}>
                <option value="major">major</option>
                <option value="minor">minor</option>
              </select>
            </div>
          </GlassPanel>

          <GlassPanel
            style={{
              position: 'sticky',
              bottom: 0,
              zIndex: 3,
              padding: 12,
              borderRadius: 18,
              background: 'linear-gradient(180deg, rgba(7,13,24,0.96), rgba(4,8,16,0.98))',
              border: '1px solid rgba(120,200,220,0.16)',
              boxShadow: '0 -18px 36px rgba(0,0,0,0.28)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button onClick={handleGenerate} disabled={generating} style={buttonStyle(MODE_META[mode].accent)}>
                {generating ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
                <span>{generating ? 'Forging' : 'Generate'}</span>
              </button>
              <button onClick={() => handlePreview()} disabled={!draft} style={buttonStyle(aurora.cyan, false)}>
                <Play size={14} />
                <span>Preview Focus</span>
              </button>
              <button onClick={clearPreviewTimers} disabled={!playingPreview} style={buttonStyle(aurora.textMuted, true)}>
                <Square size={14} />
                <span>Stop</span>
              </button>
              <button onClick={handleCommit} disabled={!draft || committing} style={buttonStyle(aurora.teal, committing)}>
                {committing ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
                <span>{committing ? 'Committing' : 'Commit'}</span>
              </button>
            </div>
            <div style={{ marginTop: 8, color: aurora.textMuted, fontSize: 11 }}>
              `Generate` is always pinned here.
            </div>
          </GlassPanel>

          <GlassPanel style={{ padding: 12, borderRadius: 18, background: 'rgba(7,13,24,0.9)', border: '1px solid rgba(120,200,220,0.12)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: aurora.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Focus Lane</div>
                <div style={{ marginTop: 4, color: aurora.text, fontSize: 15, fontWeight: 800 }}>{focusLabel}</div>
              </div>
              <div style={{ fontSize: 11, color: MODE_META[mode].accent, fontWeight: 700 }}>{MODE_META[mode].label}</div>
            </div>
            <div style={{ marginTop: 10, color: aurora.textDim, fontSize: 12, lineHeight: 1.55 }}>
              {selectedTrack
                ? `${selectedTrack.instrumentName} on ${selectedTrack.role}. Note line: ${selectedClip?.noteLabel ?? selectedTrack.noteLabel}`
                : 'Generate a draft to inspect instrument lanes, note strings, and section pacing.'}
            </div>
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', color: aurora.textMuted, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>AI Direction</summary>
              <div style={{ marginTop: 8, color: aurora.textDim, fontSize: 12, lineHeight: 1.5, maxHeight: 140, overflow: 'auto' }}>
                {rawIdea ?? 'No generation yet.'}
              </div>
            </details>
          </GlassPanel>

          <GlassPanel style={{ padding: 12, borderRadius: 18, background: 'rgba(7,13,24,0.9)', border: '1px solid rgba(120,200,220,0.12)' }}>
            <div style={{ fontSize: 11, color: aurora.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Reference Blueprint</div>
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              <div style={blueprintRowStyle}>
                <span style={blueprintLabelStyle}>Groove</span>
                <span style={blueprintValueStyle}>{draft?.blueprint.groove ?? 'Generated after draft'}</span>
              </div>
              <div style={blueprintRowStyle}>
                <span style={blueprintLabelStyle}>Drums</span>
                <span style={blueprintValueStyle}>{draft?.blueprint.drumFeel ?? 'Generated after draft'}</span>
              </div>
              <div style={blueprintRowStyle}>
                <span style={blueprintLabelStyle}>Bass</span>
                <span style={blueprintValueStyle}>{draft?.blueprint.bassFeel ?? 'Generated after draft'}</span>
              </div>
              <div style={blueprintRowStyle}>
                <span style={blueprintLabelStyle}>Harmony</span>
                <span style={blueprintValueStyle}>{draft?.blueprint.chordFeel ?? 'Generated after draft'}</span>
              </div>
              <div style={blueprintRowStyle}>
                <span style={blueprintLabelStyle}>Topline</span>
                <span style={blueprintValueStyle}>{draft?.blueprint.melodyFeel ?? 'Generated after draft'}</span>
              </div>
            </div>
            <div style={{ marginTop: 10, color: aurora.textMuted, fontSize: 11, lineHeight: 1.5 }}>
              {draft?.blueprint.safetyNote ?? 'Reference prompts are converted into an original arrangement blueprint rather than a direct copy.'}
            </div>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(120,200,220,0.1)' }}>
              <div style={{ fontSize: 10, color: aurora.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Section Map</div>
              <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                {(draft?.sections ?? defaultSections(bars)).map((section, index) => (
                  <div key={`${section.name}-${index}`} style={{ display: 'grid', gridTemplateColumns: '58px 1fr', gap: 8 }}>
                    <span style={blueprintLabelStyle}>{section.name}</span>
                    <span style={blueprintValueStyle}>
                      {(section.motion ?? 'hold')} · {(section.spotlight ?? 'ensemble')} · {(section.texture ?? 'supportive texture')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </GlassPanel>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 10px 12px',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: aurora.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Draft Tape</div>
              <div style={{ marginTop: 4, fontSize: 30, color: aurora.text, fontWeight: 800, lineHeight: 1.02 }}>
                {draft?.title ?? 'No draft yet'}
              </div>
              <div style={{ marginTop: 6, color: aurora.textDim, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {draft?.summary ?? 'Generate a draft to get a tape-style arrangement preview with lanes, sections, and playable focus.'}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button onClick={handleGenerate} disabled={generating} style={buttonStyle(MODE_META[mode].accent)}>
                {generating ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
                <span>{generating ? 'Forging' : 'Generate Draft'}</span>
              </button>
              <button onClick={handlePlayAll} disabled={!draft} style={buttonStyle(aurora.green)}>
                <Play size={14} />
                <span>Play All</span>
              </button>
              <div style={chipStyle(MODE_META[mode].accent)}>{MODE_META[mode].label}</div>
              <div style={chipStyle(aurora.cyan)}>{draft?.bpm ?? bpm} BPM</div>
              <div style={chipStyle(aurora.purple)}>{draft ? `${draft.key} ${draft.scale}` : `${key} ${scale}`}</div>
              <div style={chipStyle(aurora.teal)}>{draftStats ? `${draftStats.trackCount} lanes / ${draftStats.noteCount} notes` : 'Idle'}</div>
            </div>
          </div>

          <div
            style={{
              position: 'relative',
              flex: 1,
              minHeight: 0,
              borderRadius: 22,
              overflow: 'hidden',
              border: '1px solid rgba(120,200,220,0.12)',
              background: 'linear-gradient(180deg, rgba(6,12,22,0.92), rgba(3,8,16,0.94))',
              boxShadow: '0 32px 80px rgba(0, 0, 0, 0.34)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 14px',
                borderBottom: '1px solid rgba(120,200,220,0.08)',
                background: 'linear-gradient(180deg, rgba(9,18,34,0.96), rgba(7,12,20,0.9))',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={handlePlayAll} disabled={!draft} style={buttonStyle(aurora.green)}>
                  <Play size={14} />
                  <span>Play All</span>
                </button>
                <button onClick={() => handlePreview()} disabled={!draft} style={buttonStyle(aurora.cyan)}>
                  <Play size={14} />
                  <span>Play Focus</span>
                </button>
                <button onClick={clearPreviewTimers} disabled={!playingPreview} style={buttonStyle(aurora.textMuted, true)}>
                  <Square size={14} />
                  <span>Stop</span>
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: aurora.textDim, fontSize: 12 }}>
                <span>Focus: <span style={{ color: aurora.text }}>{focusLabel}</span></span>
                <span>Progression: <span style={{ color: aurora.text }}>{draft?.progression.slice(0, 4).join(' · ') ?? defaultProgression(mode, scale).join(' · ')}</span></span>
              </div>
            </div>

            <div style={{ overflow: 'auto', height: 'calc(100% - 58px)' }}>
              <div style={{ minWidth: TRACK_HEADER_W + timelineWidth, minHeight: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `${TRACK_HEADER_W}px ${timelineWidth}px`, minHeight: SECTION_RIBBON_H }}>
                  <div style={{ padding: '6px 14px', borderBottom: '1px solid rgba(120,200,220,0.08)', color: aurora.textMuted, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    Sections
                  </div>
                  <div style={{ position: 'relative', height: SECTION_RIBBON_H, borderBottom: '1px solid rgba(120,200,220,0.08)' }}>
                    {(draft?.sections ?? defaultSections(bars)).map((section, index) => (
                      <div
                        key={`${section.name}-${index}`}
                        style={{
                          position: 'absolute',
                          left: (section.startBar - 1) * BAR_W,
                          width: section.lengthBars * BAR_W,
                          height: SECTION_RIBBON_H - 4,
                          top: 2,
                          borderRadius: 999,
                          background: `linear-gradient(90deg, ${energyColor(section.energy)}30, transparent)`,
                          border: `1px solid ${energyColor(section.energy)}44`,
                          padding: '0 10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          color: aurora.text,
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                        }}
                      >
                        <span>{section.name}</span>
                        <span style={{ color: energyColor(section.energy) }}>{section.motion ?? section.energy}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: `${TRACK_HEADER_W}px ${timelineWidth}px`, minHeight: RULER_H }}>
                  <div style={{ borderBottom: '1px solid rgba(120,200,220,0.08)' }} />
                  <div style={{ position: 'relative', height: RULER_H, borderBottom: '1px solid rgba(120,200,220,0.08)' }}>
                    {Array.from({ length: draft?.bars ?? bars }, (_, i) => (
                      <div
                        key={`bar-${i + 1}`}
                        style={{
                          position: 'absolute',
                          left: i * BAR_W,
                          top: 0,
                          width: BAR_W,
                          height: '100%',
                          borderLeft: `1px solid ${(i + 1) % 4 === 1 ? 'rgba(103,232,249,0.18)' : 'rgba(120,200,220,0.07)'}`,
                          color: (i + 1) % 4 === 1 ? aurora.text : aurora.textMuted,
                          fontSize: 10,
                          padding: '8px 8px 0',
                        }}
                      >
                        {i + 1}
                      </div>
                    ))}
                    {playingPreview && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: playheadBeat * (BAR_W / BAR_BEATS),
                          width: 2,
                          height: '100%',
                          background: 'linear-gradient(180deg, rgba(103,232,249,0.95), rgba(103,232,249,0.15))',
                          boxShadow: '0 0 18px rgba(103,232,249,0.45)',
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                  </div>
                </div>

                {(draft?.tracks ?? []).map((track) => {
                  const isTrackSelected = track.id === selectedTrackId;
                  const isMuted = mutedTrackIds.has(track.id);
                  const isSoloed = soloTrackIds.has(track.id);
                  return (
                    <div key={track.id} style={{ display: 'grid', gridTemplateColumns: `${TRACK_HEADER_W}px ${timelineWidth}px`, minHeight: TRACK_ROW_H }}>
                      <button
                        onClick={() => {
                          setSelectedTrackId(track.id);
                          setSelectedClipId(track.clips[0]?.id ?? null);
                        }}
                        style={{
                          appearance: 'none',
                          border: 'none',
                          borderBottom: '1px solid rgba(120,200,220,0.08)',
                          borderRight: '1px solid rgba(120,200,220,0.08)',
                          background: isTrackSelected
                            ? `linear-gradient(135deg, ${track.accent}14, rgba(7,12,20,0.96))`
                            : 'linear-gradient(180deg, rgba(7,12,20,0.96), rgba(4,8,14,0.96))',
                          textAlign: 'left',
                          padding: '10px 12px',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: track.accent, fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.name}</div>
                            <div style={{ color: aurora.textMuted, fontSize: 11, marginTop: 2 }}>{track.instrumentName}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleMuted(track.id);
                              }}
                              style={{
                                width: 18,
                                height: 14,
                                fontSize: 8,
                                fontWeight: 700,
                                border: 'none',
                                borderRadius: 3,
                                cursor: 'pointer',
                                background: isMuted ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.06)',
                                color: isMuted ? '#fbbf24' : 'rgba(255,255,255,0.3)',
                              }}
                              title="Mute"
                            >M</button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSolo(track.id);
                              }}
                              style={{
                                width: 18,
                                height: 14,
                                fontSize: 8,
                                fontWeight: 700,
                                border: 'none',
                                borderRadius: 3,
                                cursor: 'pointer',
                                background: isSoloed ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.06)',
                                color: isSoloed ? '#34d399' : 'rgba(255,255,255,0.3)',
                              }}
                              title="Solo"
                            >S</button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTrackId(track.id);
                                setSelectedClipId(track.clips[0]?.id ?? null);
                                handlePreview({ trackId: track.id });
                              }}
                              style={{
                                ...buttonStyle(track.accent),
                                height: 30,
                                padding: '0 10px',
                              }}
                            >
                              <Play size={12} />
                            </button>
                          </div>
                        </div>
                        <div style={{ marginTop: 8, color: aurora.textDim, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {track.role} · {track.density}
                        </div>
                        <div style={{ marginTop: 6, color: aurora.textMuted, fontSize: 10, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {track.noteLabel}
                        </div>
                      </button>

                      <div
                        style={{
                          position: 'relative',
                          height: TRACK_ROW_H,
                          borderBottom: '1px solid rgba(120,200,220,0.08)',
                          background: isMuted
                            ? 'linear-gradient(180deg, rgba(5,10,18,0.46), rgba(8,14,24,0.4))'
                            : 'linear-gradient(180deg, rgba(5,10,18,0.8), rgba(8,14,24,0.76))',
                          overflow: 'hidden',
                          opacity: soloTrackIds.size > 0 && !isSoloed ? 0.42 : 1,
                        }}
                      >
                        {Array.from({ length: draft?.bars ?? bars }, (_, i) => (
                          <div
                            key={`grid-${track.id}-${i}`}
                            style={{
                              position: 'absolute',
                              left: i * BAR_W,
                              top: 0,
                              width: BAR_W,
                              height: '100%',
                              borderLeft: `1px solid ${(i + 1) % 4 === 1 ? 'rgba(103,232,249,0.16)' : 'rgba(120,200,220,0.06)'}`,
                              background: (i + 1) % 8 === 1 ? 'rgba(103,232,249,0.02)' : 'transparent',
                            }}
                          />
                        ))}

                        {track.clips.map((clip) => {
                          const isClipSelected = clip.id === selectedClipId;
                          const clipLeft = (clip.startBar - 1) * BAR_W;
                          const clipWidth = clip.lengthBars * BAR_W;
                          return (
                            <button
                              key={clip.id}
                              onClick={() => {
                                setSelectedTrackId(track.id);
                                setSelectedClipId(clip.id);
                              }}
                              style={{
                                appearance: 'none',
                                position: 'absolute',
                                left: clipLeft + 4,
                                top: 8,
                                width: clipWidth - 8,
                                height: TRACK_ROW_H - 16,
                                borderRadius: 12,
                                border: `1px solid ${isClipSelected ? `${track.accent}90` : `${track.accent}4a`}`,
                                background: `linear-gradient(135deg, ${track.accent}${isClipSelected ? '30' : '1d'}, rgba(13,22,36,0.86))`,
                                boxShadow: isClipSelected ? `0 0 26px ${track.accent}2e` : 'none',
                                padding: '8px 10px',
                                textAlign: 'left',
                                cursor: 'pointer',
                                overflow: 'hidden',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <div style={{ color: aurora.text, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.name}</div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTrackId(track.id);
                                    setSelectedClipId(clip.id);
                                    handlePreview({ trackId: track.id, clipId: clip.id });
                                  }}
                                  style={{
                                    ...buttonStyle(track.accent),
                                    height: 24,
                                    padding: '0 8px',
                                    borderRadius: 8,
                                  }}
                                >
                                  <Play size={11} />
                                </button>
                              </div>
                              <div style={{ marginTop: 4, color: aurora.textMuted, fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {clip.noteLabel}
                              </div>
                              <div style={{ position: 'absolute', left: 10, right: 10, bottom: 8, height: 18 }}>
                                {clip.notes.slice(0, 20).map((note, noteIndex) => (
                                  <div
                                    key={`${clip.id}-note-${noteIndex}`}
                                    style={{
                                      position: 'absolute',
                                      left: `${(note.start / (clip.lengthBars * BAR_BEATS)) * 100}%`,
                                      width: `${Math.max(2, (note.duration / (clip.lengthBars * BAR_BEATS)) * (clipWidth - 20))}px`,
                                      height: 4,
                                      bottom: noteY(track, note.pitch),
                                      borderRadius: 999,
                                      background: `${track.accent}cc`,
                                      opacity: 0.92,
                                    }}
                                  />
                                ))}
                              </div>
                            </button>
                          );
                        })}

                        {playingPreview && isTrackSelected && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: playheadBeat * (BAR_W / BAR_BEATS),
                              width: 2,
                              height: '100%',
                              background: 'linear-gradient(180deg, rgba(103,232,249,0.95), rgba(103,232,249,0.15))',
                              boxShadow: '0 0 16px rgba(103,232,249,0.45)',
                              pointerEvents: 'none',
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}

                {!draft && (
                  <div style={{ padding: 48, color: aurora.textDim, textAlign: 'center' }}>
                    Generate a draft to populate the tape.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 40,
  background: 'rgba(4,10,20,0.88)',
  border: '1px solid rgba(120,200,220,0.12)',
  borderRadius: 12,
  padding: '0 12px',
  color: aurora.text,
  fontSize: 13,
  outline: 'none',
};

const blueprintRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '72px 1fr',
  gap: 8,
  alignItems: 'start',
};

const blueprintLabelStyle: React.CSSProperties = {
  color: aurora.textMuted,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  paddingTop: 2,
};

const blueprintValueStyle: React.CSSProperties = {
  color: aurora.textDim,
  fontSize: 12,
  lineHeight: 1.45,
};

export default HarmonicLabPanel;
