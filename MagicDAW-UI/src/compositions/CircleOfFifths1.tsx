import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from 'remotion';
import { useCircleZoom, chordToRingIndex, FIFTHS_MAJOR, FIFTHS_MINOR } from './useCircleZoom';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CircleOfFifthsProps {
  activeKey: string;
  activeMode: 'major' | 'minor';
  detectedChord: string | null;
  /** True when the detected chord came from 3+ notes (a real chord, not inferred from a single note) */
  isFullChord?: boolean;
  activeNotes: number[];
  chordProgression: string[];
  pathfinderFrom: string | null;
  pathfinderTo: string | null;
  pathfinderPaths: string[][];
  highlightedDegrees: number[];
  /** Signal to reset the chord path and zoom out to circle */
  resetSignal?: number;
  /** Callback when save is requested — receives the chord path */
  onSavePath?: (chords: string[]) => void;
  /** External pan offset from click-and-drag (SVG units) */
  panOffset?: { x: number; y: number };
  /** Callback when a branch node is clicked — adds chord to path programmatically */
  onClickChord?: (chord: string) => void;
  /** Callback to delete a node at index from the chord path */
  onDeleteNode?: (index: number) => void;
  /** Import chords directly into the path — set this to load a progression without MIDI */
  importChords?: string[] | null;
  /** Whether playback is active — highlights the current playback position */
  playbackIndex?: number;
  /** Loop region [startIdx, endIdx] inclusive */
  loopRegion?: [number, number] | null;
  /** Callback to set loop region */
  onSetLoopRegion?: (region: [number, number] | null) => void;
}

// ── Famous chord progressions database ──────────────────────────────────

export interface FamousProgression {
  name: string;
  artist?: string;
  chords: string[]; // normalized chord names relative to key (roman → actual computed at runtime)
  romans: string[];  // roman numerals for display
  genre: string;
}

// Progressions stored as scale degree indices + quality, resolved at runtime to actual chords
const FAMOUS_PROGRESSIONS: FamousProgression[] = [
  { name: 'Axis of Awesome', chords: ['I', 'V', 'vi', 'IV'], romans: ['I', 'V', 'vi', 'IV'], genre: 'Pop' },
  { name: '50s Progression', chords: ['I', 'vi', 'IV', 'V'], romans: ['I', 'vi', 'IV', 'V'], genre: 'Pop' },
  { name: 'Pachelbel\'s Canon', chords: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'], romans: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'], genre: 'Classical' },
  { name: 'Andalusian Cadence', chords: ['vi', 'V', 'IV', 'III'], romans: ['vi', 'V', 'IV', 'III'], genre: 'Flamenco' },
  { name: '12-Bar Blues', chords: ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V'], romans: ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V'], genre: 'Blues' },
  { name: 'Heart and Soul', chords: ['I', 'vi', 'IV', 'V'], romans: ['I', 'vi', 'IV', 'V'], genre: 'Pop' },
  { name: 'Creep', artist: 'Radiohead', chords: ['I', 'III', 'IV', 'iv'], romans: ['I', 'III', 'IV', 'iv'], genre: 'Rock' },
  { name: 'Let It Be', artist: 'Beatles', chords: ['I', 'V', 'vi', 'IV'], romans: ['I', 'V', 'vi', 'IV'], genre: 'Rock' },
  { name: 'Jazz ii-V-I', chords: ['ii', 'V', 'I'], romans: ['ii', 'V', 'I'], genre: 'Jazz' },
  { name: 'Rhythm Changes', chords: ['I', 'vi', 'ii', 'V'], romans: ['I', 'vi', 'ii', 'V'], genre: 'Jazz' },
  { name: 'Minor Jazz ii-V-i', chords: ['ii', 'V', 'i'], romans: ['ii°', 'V', 'i'], genre: 'Jazz' },
  { name: 'Despacito', artist: 'Luis Fonsi', chords: ['vi', 'IV', 'V', 'I'], romans: ['vi', 'IV', 'V', 'I'], genre: 'Latin Pop' },
  { name: 'Autumn Leaves', chords: ['ii', 'V', 'I', 'IV', 'vii', 'III', 'vi'], romans: ['ii', 'V', 'I', 'IV', 'vii°', 'III', 'vi'], genre: 'Jazz' },
  { name: 'Hallelujah', artist: 'Leonard Cohen', chords: ['I', 'IV', 'I', 'IV', 'I', 'V', 'IV', 'V'], romans: ['I', 'IV', 'I', 'IV', 'I', 'V', 'IV', 'V'], genre: 'Folk' },
  { name: 'Hotel California', artist: 'Eagles', chords: ['vi', 'III', 'V', 'II', 'IV', 'I', 'ii', 'V'], romans: ['vi', 'III', 'V', 'II', 'IV', 'I', 'ii', 'V'], genre: 'Rock' },
  { name: 'Knockin\' on Heaven\'s Door', artist: 'Bob Dylan', chords: ['I', 'V', 'ii', 'ii'], romans: ['I', 'V', 'ii', 'ii'], genre: 'Folk Rock' },
  { name: 'Stand By Me', artist: 'Ben E. King', chords: ['I', 'vi', 'IV', 'V'], romans: ['I', 'vi', 'IV', 'V'], genre: 'R&B' },
  { name: 'No Woman No Cry', artist: 'Bob Marley', chords: ['I', 'V', 'vi', 'IV'], romans: ['I', 'V', 'vi', 'IV'], genre: 'Reggae' },
];

/** Resolve a roman numeral to an actual chord name in a given key */
function romanToChord(roman: string, key: string, _mode: 'major' | 'minor'): string {
  const norm = ENHARMONIC[key] ?? key;
  const rootIdx = CHROMATIC.indexOf(norm);
  if (rootIdx < 0) return 'C';

  // Map roman numeral to scale degree + quality
  const romanMap: Record<string, [number, string]> = {
    'I': [0, ''], 'i': [0, 'm'],
    'II': [2, ''], 'ii': [2, 'm'], 'ii°': [2, 'dim'],
    'III': [4, ''], 'iii': [4, 'm'],
    'IV': [5, ''], 'iv': [5, 'm'],
    'V': [7, ''], 'v': [7, 'm'],
    'VI': [9, ''], 'vi': [9, 'm'],
    'VII': [11, ''], 'vii': [11, 'dim'], 'vii°': [11, 'dim'],
    'bII': [1, ''], 'bIII': [3, ''], 'bV': [6, ''],
    'bVI': [8, ''], 'bVII': [10, ''],
  };

  const entry = romanMap[roman];
  if (!entry) return key; // fallback
  const [interval, quality] = entry;
  const noteIdx = (rootIdx + interval) % 12;
  const useFlats = FLAT_KEYS.has(key);
  const noteName = (useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[noteIdx];
  return noteName + quality;
}

/** Check if current path matches or is close to a famous progression */
function matchFamousProgressions(
  path: string[], key: string, mode: 'major' | 'minor',
): { exact: FamousProgression[]; close: { prog: FamousProgression; distance: number }[] } {
  if (path.length < 3) return { exact: [], close: [] };

  const normalized = path.map(c => normalizeChordForMatch(c));
  const exact: FamousProgression[] = [];
  const close: { prog: FamousProgression; distance: number }[] = [];

  for (const prog of FAMOUS_PROGRESSIONS) {
    const resolved = prog.chords.map(r => normalizeChordForMatch(romanToChord(r, key, mode)));
    // Check exact subsequence match
    const progStr = resolved.join(',');
    const pathStr = normalized.join(',');
    if (pathStr.includes(progStr) || progStr === pathStr) {
      exact.push(prog);
      continue;
    }
    // Check if path is close (off by 1 chord)
    if (Math.abs(normalized.length - resolved.length) <= 1) {
      let mismatches = 0;
      const minLen = Math.min(normalized.length, resolved.length);
      for (let i = 0; i < minLen; i++) {
        if (normalized[i] !== resolved[i]) mismatches++;
      }
      mismatches += Math.abs(normalized.length - resolved.length);
      if (mismatches <= 1) {
        close.push({ prog, distance: mismatches });
      }
    }
  }
  return { exact, close };
}

/** Compute harmonic tension for a chord relative to the key (0 = stable, 1 = max tension) */
function chordTension(chord: string, key: string, _mode: 'major' | 'minor'): number {
  const norm = ENHARMONIC[key] ?? key;
  const rootIdx = CHROMATIC.indexOf(norm);
  const chordRoot = normalizeChordForMatch(chord).replace(/m$/, '').replace(/dim$/, '');
  const chordNorm = ENHARMONIC[chordRoot] ?? chordRoot;
  const chordIdx = CHROMATIC.indexOf(chordNorm);
  if (rootIdx < 0 || chordIdx < 0) return 0.5;

  const interval = ((chordIdx - rootIdx) % 12 + 12) % 12;
  // Tension values by interval from tonic
  const tensionMap: Record<number, number> = {
    0: 0,     // I - tonic, stable
    2: 0.4,   // ii - mild
    4: 0.35,  // iii - mild
    5: 0.25,  // IV - gentle
    7: 0.7,   // V - dominant tension
    9: 0.3,   // vi - relative minor
    11: 0.85, // vii - leading tone, high tension
    1: 0.9,   // bII - chromatic, high
    3: 0.5,   // bIII - modal
    6: 1.0,   // tritone - maximum tension
    8: 0.6,   // bVI - chromatic
    10: 0.55, // bVII - modal
  };
  const baseTension = tensionMap[interval] ?? 0.5;
  // Diminished/minor chords add slight tension
  const isDim = chord.includes('dim');
  const isMinor = chord.endsWith('m') && !isDim;
  return Math.min(1, baseTension + (isDim ? 0.15 : isMinor ? 0.05 : 0));
}

/** Determine harmonic function: tonic, subdominant, dominant */
function chordFunction(chord: string, key: string): 'tonic' | 'subdominant' | 'dominant' | 'chromatic' {
  const norm = ENHARMONIC[key] ?? key;
  const rootIdx = CHROMATIC.indexOf(norm);
  const chordRoot = normalizeChordForMatch(chord).replace(/m$/, '').replace(/dim$/, '');
  const chordNorm = ENHARMONIC[chordRoot] ?? chordRoot;
  const chordIdx = CHROMATIC.indexOf(chordNorm);
  if (rootIdx < 0 || chordIdx < 0) return 'chromatic';

  const interval = ((chordIdx - rootIdx) % 12 + 12) % 12;
  if ([0, 4, 9].includes(interval)) return 'tonic';       // I, iii, vi
  if ([5, 2].includes(interval)) return 'subdominant';     // IV, ii
  if ([7, 11].includes(interval)) return 'dominant';       // V, vii
  return 'chromatic';
}

const FUNCTION_COLORS: Record<string, string> = {
  tonic: '#67e8f9',      // cyan - stable
  subdominant: '#2dd4bf', // teal - warm
  dominant: '#fbbf24',    // gold - tension
  chromatic: '#a78bfa',   // purple - color
};

// ── Constants ──────────────────────────────────────────────────────────────

// Base design dimensions — actual W/H come from useVideoConfig()
const BASE_H = 1080;
const OUTER_R_BASE = 480;
const MIDDLE_R_BASE = 370;
const INNER_R_BASE = 260;

const palette = {
  bg: '#080e18',
  cyan: '#67e8f9',
  teal: '#2dd4bf',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  glass: 'rgba(120,200,220,0.06)',
  glassBorder: 'rgba(120,200,220,0.12)',
};

const PATHFINDER_COLORS = [palette.cyan, palette.pink, palette.gold, palette.purple, palette.teal];

const MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINOR_KEYS = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];
const DIM_KEYS = ['Bdim', 'F#dim', 'C#dim', 'G#dim', 'D#dim', 'A#dim', 'Fdim', 'Cdim', 'Gdim', 'Ddim', 'Adim', 'Edim'];

const DEGREE_LABELS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii\u00B0'];

const ENHARMONIC: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'Gb': 'F#',
  'Cb': 'B', 'Fb': 'E', 'B#': 'C', 'E#': 'F',
};

// ── Scale & Piano helpers ─────────────────────────────────────────────────

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]; // W W H W W W H
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]; // W H W W H W W

/** Is this chromatic index a black key? */
const IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

/** Note display names — prefer sharps for some, flats for others depending on context */
const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// Keys that conventionally use flats
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db']);

function getScaleNotes(root: string, mode: 'major' | 'minor'): Set<number> {
  const norm = ENHARMONIC[root] ?? root;
  const rootIdx = CHROMATIC.indexOf(norm);
  if (rootIdx < 0) return new Set();
  const intervals = mode === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
  return new Set(intervals.map(i => (rootIdx + i) % 12));
}

/** Get the note name for display, respecting the key's accidental preference */
function noteName(chromaticIdx: number, key: string): string {
  const useFlats = FLAT_KEYS.has(key);
  return (useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[chromaticIdx % 12];
}

// Chord quality for each scale degree
const MAJOR_QUALITIES = ['', 'm', 'm', '', '', 'm', 'dim'] as const;
const MINOR_QUALITIES = ['m', 'dim', '', 'm', 'm', '', ''] as const;

/** Detect chord quality from a set of MIDI notes (e.g. [60,64,67,71] → "Cmaj7") */
function detectChordFromNotes(notes: number[], key: string): string | null {
  if (notes.length < 2) return null;
  const chromas = [...new Set(notes.map(n => n % 12))].sort((a, b) => a - b);
  if (chromas.length < 2) return null;
  const useFlats = FLAT_KEYS.has(key);
  const names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;

  // Try each chroma as root and check interval pattern
  for (const root of chromas) {
    const intervals = chromas.map(c => ((c - root) % 12 + 12) % 12).sort((a, b) => a - b);
    const pat = intervals.join(',');

    // Triads
    if (pat === '0,3,7') return names[root] + 'm';
    if (pat === '0,4,7') return names[root];
    if (pat === '0,3,6') return names[root] + 'dim';
    if (pat === '0,4,8') return names[root] + 'aug';

    // Sevenths
    if (pat === '0,4,7,11') return names[root] + 'maj7';
    if (pat === '0,4,7,10') return names[root] + '7';
    if (pat === '0,3,7,10') return names[root] + 'm7';
    if (pat === '0,3,6,10') return names[root] + 'm7b5';
    if (pat === '0,3,6,9')  return names[root] + 'dim7';
    if (pat === '0,3,7,11') return names[root] + 'mMaj7';

    // Sus chords
    if (pat === '0,5,7') return names[root] + 'sus4';
    if (pat === '0,2,7') return names[root] + 'sus2';
  }
  return null;
}

/** Infer diatonic chord from a MIDI note in the given key/mode */
function inferChordFromNote(midiNote: number, key: string, mode: 'major' | 'minor'): string {
  const norm = ENHARMONIC[key] ?? key;
  const rootIdx = CHROMATIC.indexOf(norm);
  const noteChroma = midiNote % 12;
  const useFlats = FLAT_KEYS.has(key);
  const chordRoot = (useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[noteChroma];
  if (rootIdx < 0) return chordRoot;
  const interval = ((noteChroma - rootIdx) % 12 + 12) % 12;
  const scaleIntervals = mode === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
  const qualities = mode === 'major' ? MAJOR_QUALITIES : MINOR_QUALITIES;
  const degreeIdx = scaleIntervals.indexOf(interval);
  if (degreeIdx < 0) return chordRoot; // chromatic note → major
  return chordRoot + qualities[degreeIdx];
}

/**
 * Build piano keys from root to root (one octave of the scale).
 * Returns chromatic indices spanning 13 semitones (root to root inclusive).
 */
function buildPianoRange(root: string): number[] {
  const norm = ENHARMONIC[root] ?? root;
  const rootIdx = CHROMATIC.indexOf(norm);
  if (rootIdx < 0) return Array.from({ length: 13 }, (_, i) => i); // fallback C-C
  // 13 chromatic keys: root to root+12 (inclusive — shows the octave)
  return Array.from({ length: 13 }, (_, i) => (rootIdx + i) % 12);
}

// ── Branch tooltip data ───────────────────────────────────────────────────

interface BranchTooltip {
  roman: string;
  description: string;
  tension: string;  // "stable" | "mild tension" | "strong tension" | "chromatic"
  genres: string;
  voiceLeading: string;
}

const BRANCH_TOOLTIPS: Record<string, BranchTooltip> = {
  'V':    { roman: 'V',    description: 'Dominant — strongest pull to resolve home', tension: 'strong tension → resolution', genres: 'All genres', voiceLeading: 'Leading tone → tonic' },
  'IV':   { roman: 'IV',   description: 'Subdominant — warm, open, plagal cadence', tension: 'stable → gentle pull', genres: 'Pop, Rock, Gospel', voiceLeading: '4th resolves to 3rd' },
  'ii':   { roman: 'ii',   description: 'Supertonic — pre-dominant, sets up V', tension: 'mild tension → V → I', genres: 'Jazz, Pop, Classical', voiceLeading: 'Stepwise to V' },
  'vi':   { roman: 'vi',   description: 'Relative minor — deceptive, emotional shift', tension: 'surprise resolution', genres: 'Pop, R&B, Singer-songwriter', voiceLeading: 'Shared tones with I' },
  'bVII': { roman: 'bVII', description: 'Subtonic — borrowed from Mixolydian mode', tension: 'modal color', genres: 'Rock, Blues, Celtic', voiceLeading: 'Parallel motion down' },
  'bVI':  { roman: 'bVI',  description: 'Borrowed from parallel minor — epic, cinematic', tension: 'chromatic surprise', genres: 'Film scores, Metal, Pop', voiceLeading: 'Half-step to V' },
  'iii':  { roman: 'iii',  description: 'Mediant — delicate, transitional color', tension: 'mild → ambiguous', genres: 'Classical, Art pop', voiceLeading: 'Shared tone with I' },
  'bV':   { roman: 'bV',   description: 'Tritone substitution — jazz tension', tension: 'maximum tension', genres: 'Jazz, Neo-soul, Prog', voiceLeading: 'Chromatic approach' },
  'vii°': { roman: 'vii°', description: 'Leading tone diminished — unstable, wants I', tension: 'strong tension', genres: 'Classical, Jazz', voiceLeading: 'Converging half-steps' },
  'bIII': { roman: 'bIII', description: 'Chromatic mediant — bright, unexpected shift', tension: 'chromatic color', genres: 'Film, Prog rock, Pop', voiceLeading: 'Common tone modulation' },
  'V/vi': { roman: 'V/vi', description: 'Secondary dominant — targets the vi chord', tension: 'applied tension → vi', genres: 'Jazz, Classical, Pop', voiceLeading: 'Creates temporary leading tone' },
};

// ── Chord path types ──────────────────────────────────────────────────────

interface PathNode {
  chord: string;          // normalized base name ("C", "Am") — used for ring matching & dedup
  displayChord: string;   // full detected name ("Cmaj7", "Am7") — shown on the node label
  ring: 'major' | 'minor' | 'dim';
  index: number;          // fifths-circle index
  x: number;              // SVG position
  y: number;
  arrivalAngle: number;   // angle from prev node (degrees), used to fan branches away
  isFullChord: boolean;   // true = played as real chord (3+ notes), false = inferred from single note
}

interface Branch {
  label: string; roman: string; color: string;
  angle: number; dist: number; tier: number;
  transition: string; width: number;
  targetChord: string; // normalized chord name for matching
}

/** Normalize a detected chord for matching: "Am/C" → "Am", "G7" → "G" */
function normalizeChordForMatch(chord: string): string {
  const base = chord.includes('/') ? chord.split('/')[0] : chord;
  return base.replace(/(maj7|m7|7|9|11|13|sus[24]|aug|\?)$/i, '');
}

/** Generate branches from a node — fan out horizontally to the right, spread vertically */
function generateBranches(
  pi: number, ring: 'major' | 'minor' | 'dim',
  _arrivalAngle: number, scale: number,
  _treeCentroid?: { x: number; y: number; nodeX: number; nodeY: number },
): Branch[] {
  // Branches extend to the RIGHT and fan vertically
  // Tier 1: close, slight vertical spread; Tier 2: further right, wider spread; Tier 3: furthest
  const r1 = 160 * scale, r2 = 240 * scale, r3 = 320 * scale;

  // Angles: 0 = straight right, negative = up-right, positive = down-right
  // All branches go rightward (angles stay in -70..+70 range so they extend to the right)
  const raw: Branch[] = ring === 'minor' ? [
    { label: FIFTHS_MAJOR[(pi + 9) % 12],  roman: 'III',   color: '#67e8f9', angle: 90,   dist: r1, tier: 1, transition: '', width: 3, targetChord: FIFTHS_MAJOR[(pi + 9) % 12] },
    { label: FIFTHS_MAJOR[(pi + 8) % 12],  roman: 'bVII',  color: '#2dd4bf', angle: 60,   dist: r1, tier: 1, transition: '', width: 3, targetChord: FIFTHS_MAJOR[(pi + 8) % 12] },
    { label: FIFTHS_MAJOR[(pi + 5) % 12],  roman: 'iv',    color: '#60a5fa', angle: 120,  dist: r1, tier: 1, transition: '', width: 2.5, targetChord: FIFTHS_MAJOR[(pi + 5) % 12] },
    { label: FIFTHS_MAJOR[(pi + 7) % 12],  roman: 'bVI',   color: '#e879f9', angle: 40,   dist: r2, tier: 2, transition: '', width: 2, targetChord: FIFTHS_MAJOR[(pi + 7) % 12] },
    { label: FIFTHS_MAJOR[(pi + 2) % 12],  roman: 'V',     color: '#fb923c', angle: 140,  dist: r2, tier: 2, transition: FIFTHS_MAJOR[(pi + 2) % 12] + '7', width: 2, targetChord: FIFTHS_MAJOR[(pi + 2) % 12] },
    { label: FIFTHS_MINOR[(pi + 5) % 12],  roman: 'iv(m)', color: '#a78bfa', angle: 75,   dist: r2, tier: 2, transition: '', width: 1.5, targetChord: FIFTHS_MINOR[(pi + 5) % 12] },
    { label: FIFTHS_MAJOR[pi],              roman: 'I',     color: '#818cf8', angle: 105,  dist: r2, tier: 2, transition: '', width: 1.5, targetChord: FIFTHS_MAJOR[pi] },
    { label: FIFTHS_MAJOR[(pi + 10) % 12], roman: 'bII',   color: '#f87171', angle: 25,   dist: r3, tier: 3, transition: '', width: 1, targetChord: FIFTHS_MAJOR[(pi + 10) % 12] },
    { label: FIFTHS_MINOR[(pi + 7) % 12],  roman: 'vm',    color: '#fbbf24', angle: 155,  dist: r3, tier: 3, transition: '', width: 1, targetChord: FIFTHS_MINOR[(pi + 7) % 12] },
    { label: FIFTHS_MAJOR[(pi + 3) % 12],  roman: 'IV',    color: '#34d399', angle: 10,   dist: r3, tier: 3, transition: '', width: 1, targetChord: FIFTHS_MAJOR[(pi + 3) % 12] },
    { label: FIFTHS_MINOR[(pi + 2) % 12],  roman: 'iim',   color: '#c084fc', angle: 170,  dist: r3, tier: 3, transition: '', width: 1, targetChord: FIFTHS_MINOR[(pi + 2) % 12] },
  ] : [
    { label: FIFTHS_MAJOR[(pi + 1) % 12],  roman: 'V',     color: '#67e8f9', angle: 90,   dist: r1, tier: 1, transition: FIFTHS_MAJOR[(pi + 1) % 12] + '7', width: 3, targetChord: FIFTHS_MAJOR[(pi + 1) % 12] },
    { label: FIFTHS_MAJOR[(pi + 11) % 12], roman: 'IV',    color: '#2dd4bf', angle: 60,   dist: r1, tier: 1, transition: '', width: 3, targetChord: FIFTHS_MAJOR[(pi + 11) % 12] },
    { label: FIFTHS_MAJOR[(pi + 2) % 12],  roman: 'ii',    color: '#60a5fa', angle: 120,  dist: r1, tier: 1, transition: FIFTHS_MAJOR[(pi + 2) % 12] + '7', width: 2.5, targetChord: FIFTHS_MAJOR[(pi + 2) % 12] },
    { label: FIFTHS_MINOR[pi],              roman: 'vi',    color: '#a78bfa', angle: 40,   dist: r2, tier: 2, transition: '', width: 2, targetChord: FIFTHS_MINOR[pi] },
    { label: FIFTHS_MAJOR[(pi + 10) % 12], roman: 'bVII',  color: '#fb923c', angle: 140,  dist: r2, tier: 2, transition: '', width: 2, targetChord: FIFTHS_MAJOR[(pi + 10) % 12] },
    { label: FIFTHS_MAJOR[(pi + 9) % 12],  roman: 'bVI',   color: '#e879f9', angle: 75,   dist: r2, tier: 2, transition: '', width: 1.5, targetChord: FIFTHS_MAJOR[(pi + 9) % 12] },
    { label: FIFTHS_MAJOR[(pi + 3) % 12],  roman: 'iii',   color: '#818cf8', angle: 105,  dist: r2, tier: 2, transition: FIFTHS_MAJOR[(pi + 3) % 12] + '7', width: 1.5, targetChord: FIFTHS_MAJOR[(pi + 3) % 12] },
    { label: FIFTHS_MAJOR[(pi + 8) % 12],  roman: 'bV',    color: '#f87171', angle: 25,   dist: r3, tier: 3, transition: '', width: 1, targetChord: FIFTHS_MAJOR[(pi + 8) % 12] },
    { label: FIFTHS_MAJOR[(pi + 5) % 12],  roman: 'vii°',  color: '#fbbf24', angle: 155,  dist: r3, tier: 3, transition: '', width: 1, targetChord: FIFTHS_MAJOR[(pi + 5) % 12] },
    { label: FIFTHS_MAJOR[(pi + 7) % 12],  roman: 'bIII',  color: '#34d399', angle: 10,   dist: r3, tier: 3, transition: '', width: 1, targetChord: FIFTHS_MAJOR[(pi + 7) % 12] },
    { label: FIFTHS_MAJOR[(pi + 4) % 12],  roman: 'V/vi',  color: '#c084fc', angle: 170,  dist: r3, tier: 3, transition: '', width: 1, targetChord: FIFTHS_MAJOR[(pi + 4) % 12] },
  ];

  // No rotation — branches always fan rightward
  return raw;
}

// ── MIDI export ───────────────────────────────────────────────────────────

/** Convert a chord name to a MIDI root note number (middle octave) */
function chordToMidi(chord: string): number[] {
  const base = normalizeChordForMatch(chord);
  const isMinor = base.endsWith('m') && !base.endsWith('dim');
  const root = isMinor ? base.slice(0, -1) : base;
  const norm = ENHARMONIC[root] ?? root;
  const rootIdx = CHROMATIC.indexOf(norm);
  if (rootIdx < 0) return [60]; // fallback C
  const midiRoot = 60 + rootIdx; // C4 = 60
  if (isMinor) return [midiRoot, midiRoot + 3, midiRoot + 7]; // minor triad
  return [midiRoot, midiRoot + 4, midiRoot + 7]; // major triad
}

// ── Deterministic harmonic pathfinder ─────────────────────────────────────

/** Get the chromatic index (0-11) for a chord root */
function chordChroma(chord: string): number {
  const base = normalizeChordForMatch(chord);
  const isMin = base.endsWith('m') && !base.endsWith('dim');
  const root = isMin ? base.slice(0, -1) : base;
  const norm = ENHARMONIC[root] ?? root;
  return CHROMATIC.indexOf(norm);
}

/** Is this chord minor? */
function isMinorChord(chord: string): boolean {
  const base = normalizeChordForMatch(chord);
  return base.endsWith('m') && !base.endsWith('dim');
}

/** Get the circle-of-fifths position (0-11) for a chromatic index */
function chromaToFifthsPos(chroma: number): number {
  // C=0, G=1, D=2, A=3, E=4, B=5, F#=6, Db=7, Ab=8, Eb=9, Bb=10, F=11
  const map = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  return map[chroma];
}

/** Voice leading cost: sum of semitone distances between closest chord tones */
function voiceLeadingCost(from: string, to: string): number {
  const fromNotes = chordToMidi(from).map(n => n % 12);
  const toNotes = chordToMidi(to).map(n => n % 12);
  let cost = 0;
  const used = new Set<number>();
  for (const fn of fromNotes) {
    let bestDist = 12;
    let bestIdx = 0;
    for (let ti = 0; ti < toNotes.length; ti++) {
      if (used.has(ti)) continue;
      const d = Math.min(Math.abs(toNotes[ti] - fn), 12 - Math.abs(toNotes[ti] - fn));
      if (d < bestDist) { bestDist = d; bestIdx = ti; }
    }
    used.add(bestIdx);
    cost += bestDist;
  }
  return cost;
}

/** Generate all neighbor chords with weighted edges from a given chord */
function harmonicNeighbors(chord: string, key: string, mode: 'major' | 'minor'): { chord: string; cost: number }[] {
  const chroma = chordChroma(chord);
  const isMin = isMinorChord(chord);
  const useFlats = FLAT_KEYS.has(key);
  const names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  const neighbors: { chord: string; cost: number }[] = [];

  const addChord = (semitones: number, quality: string, baseCost: number) => {
    const targetChroma = ((chroma + semitones) % 12 + 12) % 12;
    const name = names[targetChroma] + quality;
    const vlCost = voiceLeadingCost(chord, name);
    neighbors.push({ chord: name, cost: baseCost + vlCost * 0.5 });
  };

  // Circle of fifths motion (strongest relationships)
  addChord(7, isMin ? 'm' : '', 1);   // up a fifth
  addChord(5, isMin ? 'm' : '', 1);   // up a fourth (down a fifth)

  // Relative major/minor
  if (isMin) addChord(3, '', 1.5);     // relative major (up minor 3rd)
  else addChord(-3, 'm', 1.5);         // relative minor (down minor 3rd)

  // Parallel major/minor
  addChord(0, isMin ? '' : 'm', 2);

  // Diatonic neighbors (stepwise)
  addChord(2, '', 2.5);   // whole step up major
  addChord(-2, '', 2.5);  // whole step down major
  addChord(2, 'm', 2.5);  // whole step up minor
  addChord(-2, 'm', 2.5); // whole step down minor

  // Chromatic mediant
  addChord(4, '', 3);     // major third up
  addChord(-4, '', 3);    // major third down
  addChord(3, '', 3);     // minor third up major
  addChord(-3, '', 3);    // minor third down major

  // Tritone sub
  addChord(6, '', 4);
  addChord(6, 'm', 4);

  // Half step (chromatic)
  addChord(1, '', 3.5);
  addChord(-1, '', 3.5);
  addChord(1, 'm', 3.5);
  addChord(-1, 'm', 3.5);

  return neighbors;
}

/**
 * Find a harmonic path from one chord to another using weighted BFS (Dijkstra).
 * Returns an array of chord names including start and end.
 */
export function findHarmonicPath(
  from: string, to: string, steps: number,
  key: string, mode: 'major' | 'minor',
): string[] {
  // Normalize
  const startNorm = normalizeChordForMatch(from);
  const endNorm = normalizeChordForMatch(to);
  if (startNorm === endNorm) return [from, to];

  // For the target step count, we do iterative-deepening BFS with cost
  // Try to find paths of exactly `steps` length, pick the lowest-cost one
  interface PathState {
    chord: string;
    path: string[];
    cost: number;
  }

  const targetLen = Math.max(2, Math.min(steps, 16));
  let bestPath: string[] | null = null;
  let bestCost = Infinity;

  // Beam search: at each depth, keep top-K candidates
  const beamWidth = 50;
  let beam: PathState[] = [{ chord: from, path: [from], cost: 0 }];

  for (let depth = 1; depth < targetLen; depth++) {
    const nextBeam: PathState[] = [];
    const isLastStep = depth === targetLen - 1;

    for (const state of beam) {
      const neighbors = harmonicNeighbors(state.chord, key, mode);
      for (const n of neighbors) {
        // Avoid revisiting chords in the path (unless it's the target on last step)
        if (state.path.includes(n.chord) && !(isLastStep && normalizeChordForMatch(n.chord) === endNorm)) continue;

        if (isLastStep) {
          // Last step must reach the target
          if (normalizeChordForMatch(n.chord) === endNorm) {
            const totalCost = state.cost + n.cost;
            if (totalCost < bestCost) {
              bestCost = totalCost;
              bestPath = [...state.path, to]; // use original `to` name
            }
          }
        } else {
          nextBeam.push({
            chord: n.chord,
            path: [...state.path, n.chord],
            cost: state.cost + n.cost,
          });
        }
      }
    }

    // Prune beam to top K by cost
    nextBeam.sort((a, b) => a.cost - b.cost);
    beam = nextBeam.slice(0, beamWidth);

    if (beam.length === 0 && !bestPath) break;
  }

  if (bestPath) return bestPath;

  // Fallback: if exact step count wasn't reachable, try shorter paths
  // Simple BFS for shortest path
  const queue: PathState[] = [{ chord: from, path: [from], cost: 0 }];
  const visited = new Set<string>([startNorm]);

  while (queue.length > 0) {
    const state = queue.shift()!;
    if (state.path.length > 12) continue;

    for (const n of harmonicNeighbors(state.chord, key, mode)) {
      const nNorm = normalizeChordForMatch(n.chord);
      if (nNorm === endNorm) return [...state.path, to];
      if (visited.has(nNorm)) continue;
      visited.add(nNorm);
      queue.push({ chord: n.chord, path: [...state.path, n.chord], cost: state.cost + n.cost });
    }
  }

  // Ultimate fallback: direct
  return [from, to];
}

/** Get circle-of-fifths position for a chord (0-11, where 0=C, 1=G, etc.) */
export function chordToFifthsPosition(chord: string): number {
  return chromaToFifthsPos(chordChroma(chord));
}

/** Build a simple MIDI file (format 0) from a chord path — quarter notes at 120 BPM */
function buildMidiFile(chords: string[]): Uint8Array {
  const ticksPerBeat = 480;
  const tempo = 120;
  const microsecondsPerBeat = Math.round(60000000 / tempo);

  // Helper to write variable-length quantity
  function vlq(value: number): number[] {
    if (value < 128) return [value];
    const bytes: number[] = [];
    bytes.push(value & 0x7f);
    value >>= 7;
    while (value > 0) {
      bytes.push((value & 0x7f) | 0x80);
      value >>= 7;
    }
    return bytes.reverse();
  }

  // Track data
  const track: number[] = [];

  // Tempo meta event
  track.push(0x00, 0xff, 0x51, 0x03,
    (microsecondsPerBeat >> 16) & 0xff,
    (microsecondsPerBeat >> 8) & 0xff,
    microsecondsPerBeat & 0xff);

  // Time signature: 4/4
  track.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  // Note events — each chord is a quarter note
  for (const chord of chords) {
    const notes = chordToMidi(chord);
    // Note on (all at delta 0)
    for (let i = 0; i < notes.length; i++) {
      track.push(...vlq(i === 0 ? 0 : 0), 0x90, notes[i] & 0x7f, 100);
    }
    // Note off after one beat
    for (let i = 0; i < notes.length; i++) {
      track.push(...vlq(i === 0 ? ticksPerBeat : 0), 0x80, notes[i] & 0x7f, 0);
    }
  }

  // End of track
  track.push(0x00, 0xff, 0x2f, 0x00);

  // Build file
  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // header length
    0x00, 0x00,             // format 0
    0x00, 0x01,             // 1 track
    (ticksPerBeat >> 8) & 0xff, ticksPerBeat & 0xff,
  ];

  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    (track.length >> 24) & 0xff,
    (track.length >> 16) & 0xff,
    (track.length >> 8) & 0xff,
    track.length & 0xff,
  ];

  return new Uint8Array([...header, ...trackHeader, ...track]);
}

/** Trigger a file download in the browser */
function downloadBlob(data: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Utilities ──────────────────────────────────────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function normalizeNote(n: string): string {
  return ENHARMONIC[n] ?? n;
}

function extractRoot(key: string): string {
  if (!key) return '';
  const m = key.match(/^([A-G][#b]?)/);
  return m ? normalizeNote(m[1]) : '';
}

function keyIndexOnCircle(key: string): number {
  const root = extractRoot(key);
  const idx = MAJOR_KEYS.indexOf(root);
  return idx >= 0 ? idx : -1;
}


function fifthsDistance(a: number, b: number): number {
  if (a < 0 || b < 0) return 12;
  const d = Math.abs(a - b);
  return Math.min(d, 12 - d);
}

function polarToXY(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function nodeAngle(index: number): number {
  return (index / 12) * 360;
}

// ── Background Stars ──────────────────────────────────────────────────────

interface BgStar {
  x: number; y: number; r: number; baseOpacity: number;
  twinkleSpeed: number; twinklePhase: number;
  color: string;
}

function generateStars(count: number, w: number, h: number): BgStar[] {
  const rand = seededRandom(7749);
  const starColors = ['#ffffff', '#cfe8ff', '#ffe4c4', '#d4e4ff', '#fff5e6'];
  const stars: BgStar[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rand() * w,
      y: rand() * h,
      r: 0.3 + rand() * 1.8,
      baseOpacity: 0.1 + rand() * 0.5,
      twinkleSpeed: 0.02 + rand() * 0.06,
      twinklePhase: rand() * Math.PI * 2,
      color: starColors[Math.floor(rand() * starColors.length)],
    });
  }
  return stars;
}

// ── Accretion Disk Particles ──────────────────────────────────────────────

interface AccretionParticle {
  orbitRadius: number;
  angularSpeed: number;
  phase: number;
  size: number;
  opacity: number;
  color: string;
}

function generateAccretionDisk(count: number): AccretionParticle[] {
  const rand = seededRandom(1337);
  const colors = [palette.cyan, palette.teal, palette.purple, palette.pink, palette.gold];
  const particles: AccretionParticle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      orbitRadius: 30 + rand() * 28,
      angularSpeed: 0.8 + rand() * 2.2,
      phase: rand() * Math.PI * 2,
      size: 0.8 + rand() * 2.5,
      opacity: 0.2 + rand() * 0.6,
      color: colors[Math.floor(rand() * colors.length)],
    });
  }
  return particles;
}

// ── Sacred Geometry Lines ─────────────────────────────────────────────────

function generateDodecagonPoints(cx: number, cy: number, outerR: number): [number, number][] {
  return Array.from({ length: 12 }, (_, i) => polarToXY(cx, cy, outerR + 60, nodeAngle(i)));
}

// ── Component ──────────────────────────────────────────────────────────────

export const CircleOfFifths1: React.FC<CircleOfFifthsProps> = ({
  activeKey,
  activeMode,
  detectedChord,
  isFullChord = false,
  activeNotes,
  chordProgression,
  pathfinderFrom,
  pathfinderTo,
  pathfinderPaths,
  highlightedDegrees,
  resetSignal,
  onSavePath,
  panOffset,
  onClickChord,
  onDeleteNode,
  playbackIndex = -1,
  loopRegion = null,
  onSetLoopRegion,
  importChords = null,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const CX = W / 2;
  const CY = H / 2;

  // Scale radii proportionally to height (circle should fill vertical space)
  const scale = H / BASE_H;
  const OUTER_R = OUTER_R_BASE * scale;
  const MIDDLE_R = MIDDLE_R_BASE * scale;
  const INNER_R = INNER_R_BASE * scale;

  const activeIdx = useMemo(() => keyIndexOnCircle(activeKey), [activeKey]);

  // Scale notes for piano overlay
  const scaleNotes = useMemo(() => getScaleNotes(activeKey, activeMode), [activeKey, activeMode]);

  // Hover state for branch tooltips
  const [hoveredBranch, setHoveredBranch] = useState<{
    roman: string; tx: number; ty: number; px: number; py: number;
  } | null>(null);
  const onBranchEnter = useCallback((roman: string, tx: number, ty: number, px: number, py: number) => {
    setHoveredBranch({ roman, tx, ty, px, py });
  }, []);
  const onBranchLeave = useCallback(() => setHoveredBranch(null), []);

  // Hover state for voice leading tooltips
  const [hoveredVL, setHoveredVL] = useState<{
    x: number; y: number;
    fromChord: string; toChord: string;
    pairs: { fromName: string; toName: string; common: boolean; stepDesc: string }[];
  } | null>(null);
  const onVLEnter = useCallback((data: typeof hoveredVL) => setHoveredVL(data), []);
  const onVLLeave = useCallback(() => setHoveredVL(null), []);

  // ── Local chord inference: bridge chord OR infer from notes ──────────
  const localChord = useMemo(() => {
    // No notes → nothing
    if (activeNotes.length === 0) return { chord: null as string | null, full: false };
    // Bridge-detected chord takes priority when it's a real multi-note detection
    if (detectedChord && isFullChord && activeNotes.length >= 3) {
      return { chord: detectedChord, full: true };
    }
    // Try multi-note detection (identifies maj7, m7, 7, etc.)
    if (activeNotes.length >= 3) {
      const detected = detectChordFromNotes(activeNotes, activeKey);
      if (detected) return { chord: detected, full: true };
    }
    // Infer from lowest active note (works for single notes AND when bridge hasn't detected)
    const lowest = Math.min(...activeNotes);
    const inferred = inferChordFromNote(lowest, activeKey, activeMode);
    return { chord: inferred, full: activeNotes.length >= 3 };
  }, [detectedChord, isFullChord, activeNotes, activeKey, activeMode]);

  // Use the locally-resolved chord for all path/zoom logic
  const effectiveChord = localChord.chord;
  const effectiveFullChord = localChord.full;
  const effectiveRing = useMemo(() => chordToRingIndex(effectiveChord), [effectiveChord]);
  const detectedRing = effectiveRing; // alias for circle node highlighting

  const playedIndices = useMemo(
    () => new Set(activeNotes.map((n) => ((n % 12) * 7) % 12)),
    [activeNotes],
  );

  // ── Chord path tracking (render-body — no useEffect delay) ──────────
  const pathRef = useRef<PathNode[]>([]);
  const prevChordRef = useRef<string | null>(null);  // stores NORMALIZED chord for dedup
  const prevResetRef = useRef<number>(resetSignal ?? 0);
  /** Track which MIDI notes were held last frame for new-note detection */
  const prevNoteSetRef = useRef<Set<number>>(new Set());
  /** Debounce: frame when last new note arrived. Wait SETTLE_FRAMES before committing. */
  const lastNewNoteFrameRef = useRef(-999);
  /** Pending chord to commit after settle period */
  const pendingChordRef = useRef<{ normalized: string; display: string; full: boolean } | null>(null);
  const SETTLE_FRAMES = 4; // ~130ms at 30fps — time to let chord fully form

  // Handle reset signal
  if (resetSignal !== prevResetRef.current) {
    prevResetRef.current = resetSignal ?? 0;
    pathRef.current = [];
    prevChordRef.current = null;
  }

  // Horizontal layout for chord path — nodes placed left-to-right
  const PATH_START_X = W * 0.12;  // start center-left
  const PATH_START_Y = H / 2;     // vertically centered
  const PATH_STEP_X = 190 * scale; // horizontal gap between played nodes

  // Handle imported chords — build the full path directly
  const prevImportRef = useRef<string | null>(null);
  const importKey = importChords ? importChords.join(',') : null;
  if (importChords && importKey !== prevImportRef.current && importChords.length > 0) {
    prevImportRef.current = importKey;
    const path: PathNode[] = [];
    for (let i = 0; i < importChords.length; i++) {
      const chord = importChords[i];
      const normalized = normalizeChordForMatch(chord);
      const ringInfo = chordToRingIndex(chord);
      const ring = ringInfo.ring || 'major';
      const index = ringInfo.index >= 0 ? ringInfo.index : 0;
      path.push({
        chord: normalized, displayChord: chord, ring, index,
        x: PATH_START_X + i * PATH_STEP_X,
        y: PATH_START_Y,
        arrivalAngle: 0,
        isFullChord: false,
      });
    }
    pathRef.current = path;
    prevChordRef.current = importChords[importChords.length - 1];
    onSavePath?.(path.map(n => n.chord));
  } else if (!importKey) {
    prevImportRef.current = null;
  }

  // When notes change, detect new presses and debounce chord commitment.
  // MIDI notes arrive one-at-a-time across frames (D, then F, then A for a Dm chord).
  // We wait SETTLE_FRAMES after the last new note before committing, so the full chord
  // has time to form. This also prevents spurious nodes on key release.
  const currentNoteSet = new Set(activeNotes);
  const hasNewNote = activeNotes.length > 0 &&
    activeNotes.some(n => !prevNoteSetRef.current.has(n));
  prevNoteSetRef.current = currentNoteSet;

  const normalized = effectiveChord ? normalizeChordForMatch(effectiveChord) : null;

  if (hasNewNote) {
    // A new key was pressed — start/restart the settle timer
    lastNewNoteFrameRef.current = frame;
  }

  if (hasNewNote && normalized) {
    // A new key was pressed — update pending chord (may change as more notes arrive)
    pendingChordRef.current = { normalized, display: effectiveChord!, full: effectiveFullChord };
  } else if (activeNotes.length > 0 && normalized && pendingChordRef.current) {
    // Notes still held, chord detection may have improved (e.g. bridge detected "Cmaj7")
    // Only update if we're still in the settle window (new notes recently arrived)
    if (frame - lastNewNoteFrameRef.current < SETTLE_FRAMES) {
      pendingChordRef.current = { normalized, display: effectiveChord!, full: effectiveFullChord };
    }
  }

  // Commit the pending chord once settle period has elapsed since last new note
  const settled = frame - lastNewNoteFrameRef.current >= SETTLE_FRAMES;
  if (settled && pendingChordRef.current && pendingChordRef.current.normalized !== prevChordRef.current) {
    const { normalized: norm, display, full } = pendingChordRef.current;
    prevChordRef.current = norm;
    pendingChordRef.current = null;
    const ringInfo = chordToRingIndex(display);
    const ring = ringInfo.ring || 'major';
    const index = ringInfo.index >= 0 ? ringInfo.index : 0;

    const path = pathRef.current;
    if (path.length === 0) {
      path.push({ chord: norm, displayChord: display, ring, index, x: PATH_START_X, y: PATH_START_Y, arrivalAngle: 0, isFullChord: full });
    } else {
      const lastNode = path[path.length - 1];
      path.push({
        chord: norm, displayChord: display, ring, index,
        x: lastNode.x + PATH_STEP_X,
        y: PATH_START_Y,
        arrivalAngle: 0,
        isFullChord: full,
      });
    }
    onSavePath?.(path.map(n => n.chord));
  } else if (!effectiveChord) {
    prevChordRef.current = null;
    pendingChordRef.current = null;
  }

  const chordPath = pathRef.current;
  const latestNode = chordPath.length > 0 ? chordPath[chordPath.length - 1] : null;

  // Zoom target: keep latest node visible with room for branches to the right
  const zoomTargetXY = latestNode
    ? { x: latestNode.x + 80 * scale, y: PATH_START_Y }
    : null;
  const hasPath = chordPath.length > 0;
  // Zoom fraction: show a window wide enough for ~2-3 nodes + branches (including tier3 at r3=320)
  const dynamicZoomFraction = Math.min(1.0, 0.7);
  const forceReset = resetSignal !== undefined && chordPath.length === 0 && !effectiveChord;

  // ── Zoom into played node's quadrant ─────────────────────────────────
  const zoom = useCircleZoom({
    playedIndices,
    detectedRing: effectiveRing,
    cx: CX, cy: CY, outerR: OUTER_R,
    middleR: MIDDLE_R, innerR: INNER_R,
    fullW: W, fullH: H,
    frame, fps,
    zoomFraction: hasPath ? dynamicZoomFraction : 0.45,
    targetXY: zoomTargetXY,
    stayZoomed: hasPath,
    forceReset,
  });

  const bgStars = useMemo(() => generateStars(220, W, H), [W, H]);
  const accretionDisk = useMemo(() => generateAccretionDisk(28), []);
  const dodecagon = useMemo(() => generateDodecagonPoints(CX, CY, OUTER_R), [CX, CY, OUTER_R]);

  // ── Gravitational pull computation ────────────────────────────────────

  const gravityOffsets = useMemo(() => {
    if (activeIdx < 0) return new Map<number, { dx: number; dy: number }>();
    const offsets = new Map<number, { dx: number; dy: number }>();
    for (let i = 0; i < 12; i++) {
      if (i === activeIdx) continue;
      const dist = fifthsDistance(i, activeIdx);
      if (dist <= 2) {
        const pullStrength = dist === 1 ? 14 : 7;
        const [nx, ny] = polarToXY(CX, CY, OUTER_R, nodeAngle(i));
        const [ax, ay] = polarToXY(CX, CY, OUTER_R, nodeAngle(activeIdx));
        const dx = ax - nx;
        const dy = ay - ny;
        const mag = Math.sqrt(dx * dx + dy * dy);
        if (mag > 0) {
          offsets.set(i, { dx: (dx / mag) * pullStrength, dy: (dy / mag) * pullStrength });
        }
      }
    }
    return offsets;
  }, [activeIdx, CX, CY, OUTER_R]);

  // ── Connection lines data ─────────────────────────────────────────────

  const connections = useMemo(() => {
    const lines: Array<{
      x1: number; y1: number; x2: number; y2: number;
      thickness: number; opacity: number;
    }> = [];
    for (let i = 0; i < 12; i++) {
      // Fifth connections (adjacent on circle)
      const next = (i + 1) % 12;
      const [x1, y1] = polarToXY(CX, CY, OUTER_R, nodeAngle(i));
      const [x2, y2] = polarToXY(CX, CY, OUTER_R, nodeAngle(next));
      lines.push({ x1, y1, x2, y2, thickness: 1.2, opacity: 0.12 });

      // Relative minor connections
      const [mx, my] = polarToXY(CX, CY, MIDDLE_R, nodeAngle(i));
      lines.push({ x1, y1, x2: mx, y2: my, thickness: 0.6, opacity: 0.06 });
    }
    // Tritone lines (opposite keys)
    for (let i = 0; i < 6; i++) {
      const [x1, y1] = polarToXY(CX, CY, OUTER_R, nodeAngle(i));
      const [x2, y2] = polarToXY(CX, CY, OUTER_R, nodeAngle(i + 6));
      lines.push({ x1, y1, x2, y2, thickness: 0.4, opacity: 0.04 });
    }
    return lines;
  }, [CX, CY, OUTER_R, MIDDLE_R]);

  // ── Pathfinder arc computations ───────────────────────────────────────

  const pathfinderArcs = useMemo(() => {
    if (!pathfinderPaths || pathfinderPaths.length === 0) return [];
    return pathfinderPaths.map((path, pi) => {
      const points: [number, number][] = path.map((keyName) => {
        const idx = keyIndexOnCircle(keyName);
        if (idx < 0) return [CX, CY] as [number, number];
        return polarToXY(CX, CY, OUTER_R, nodeAngle(idx));
      });
      return { points, color: PATHFINDER_COLORS[pi % PATHFINDER_COLORS.length] };
    });
  }, [pathfinderPaths, CX, CY, OUTER_R]);

  // ── Spring for active key transition ──────────────────────────────────

  const pulseSpring = spring({ frame, fps, config: { damping: 12, stiffness: 80, mass: 0.6 } });

  // ── Render helpers ────────────────────────────────────────────────────

  const renderActiveKeyPos = useMemo((): [number, number] => {
    if (activeIdx < 0) return [CX, CY];
    return polarToXY(CX, CY, OUTER_R, nodeAngle(activeIdx));
  }, [activeIdx, CX, CY, OUTER_R]);

  // Aurora drift based on mode
  const auroraDrift = frame * 0.003;
  const auroraHue = activeMode === 'minor' ? 270 : 180; // purple for minor, cyan for major

  // Chord progression display (last 8)
  const recentChords = useMemo(
    () => (chordProgression || []).slice(-8),
    [chordProgression],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg }}>
      <svg width={W} height={H} viewBox={(() => {
        // Parse zoom viewBox and add gentle breathing + user pan offset
        const breathX = Math.sin(frame * 0.003) * 8 * (1 + zoom.zoomProgress * 0.5);
        const breathY = Math.cos(frame * 0.0025) * 5 * (1 + zoom.zoomProgress * 0.5);
        const panX = panOffset?.x ?? 0;
        const panY = panOffset?.y ?? 0;
        const parts = zoom.viewBox.split(' ').map(Number);
        return `${parts[0] + breathX + panX} ${parts[1] + breathY + panY} ${parts[2]} ${parts[3]}`;
      })()}>
        <defs>
          {/* Reusable blur filters — max 3 */}
          <filter id="cof-glow-sm" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <filter id="cof-glow-md" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="12" />
          </filter>
          <filter id="cof-glow-lg" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="30" />
          </filter>

          {/* Tension arc gradient */}
          <linearGradient id="tension-gradient" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={palette.teal} stopOpacity={0} />
            <stop offset="50%" stopColor={palette.gold} stopOpacity={0.3} />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.5} />
          </linearGradient>

          {/* Gravitational heatmap gradient */}
          <radialGradient id="cof-heatmap" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={activeMode === 'minor' ? palette.purple : palette.cyan} stopOpacity={0.08} />
            <stop offset="40%" stopColor={activeMode === 'minor' ? palette.pink : palette.teal} stopOpacity={0.03} />
            <stop offset="100%" stopColor={palette.bg} stopOpacity={0} />
          </radialGradient>

          {/* Aurora gradient for background */}
          <radialGradient id="cof-aurora-a" cx={`${50 + Math.sin(auroraDrift) * 15}%`} cy={`${50 + Math.cos(auroraDrift * 0.7) * 15}%`} r="60%">
            <stop offset="0%" stopColor={`hsl(${auroraHue}, 70%, 40%)`} stopOpacity={0.06} />
            <stop offset="100%" stopColor={palette.bg} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="cof-aurora-b" cx={`${50 + Math.cos(auroraDrift * 1.3) * 20}%`} cy={`${50 + Math.sin(auroraDrift * 0.5) * 20}%`} r="50%">
            <stop offset="0%" stopColor={`hsl(${auroraHue + 60}, 60%, 35%)`} stopOpacity={0.04} />
            <stop offset="100%" stopColor={palette.bg} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* ── Background layer ─────────────────────────────────────────── */}
        <rect width={W} height={H} fill={palette.bg} />
        <rect width={W} height={H} fill="url(#cof-aurora-a)" />
        <rect width={W} height={H} fill="url(#cof-aurora-b)" />

        {/* ── Stars ────────────────────────────────────────────────────── */}
        {bgStars.map((star, i) => {
          const twinkle = 0.5 + 0.5 * Math.sin(frame * star.twinkleSpeed + star.twinklePhase);
          const opacity = star.baseOpacity * twinkle;
          return (
            <circle
              key={`star-${i}`}
              cx={star.x}
              cy={star.y}
              r={star.r}
              fill={star.color}
              opacity={opacity}
            />
          );
        })}

        {/* ── Circle view (fades out when playing or path is active) ──── */}
        <g opacity={hasPath ? 0 : Math.max(0, 1 - zoom.zoomProgress * 1.5)}>

        {/* ── Sacred geometry dodecagon ─────────────────────────────────── */}
        <polygon
          points={dodecagon.map(([x, y]) => `${x},${y}`).join(' ')}
          fill="none"
          stroke={palette.gold}
          strokeWidth={0.5}
          opacity={0.05}
        />
        {/* Inner dodecagons */}
        {[OUTER_R - 20, MIDDLE_R - 20, INNER_R - 20].map((r, ri) => {
          const pts = Array.from({ length: 12 }, (_, i) => polarToXY(CX, CY, r, nodeAngle(i)));
          return (
            <polygon
              key={`geo-${ri}`}
              points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke={palette.gold}
              strokeWidth={0.3}
              opacity={0.04}
            />
          );
        })}
        {/* Radial spokes */}
        {dodecagon.map(([x, y], i) => (
          <line
            key={`spoke-${i}`}
            x1={CX} y1={CY} x2={x} y2={y}
            stroke={palette.gold}
            strokeWidth={0.3}
            opacity={0.03}
          />
        ))}

        {/* ── Augmented triad triangles (major 3rds apart) ──────────── */}
        {(() => {
          const augTriadColors = ['#67e8f9', '#fbbf24', '#34d399', '#f472b6'];
          const augTriads = [
            [0, 4, 8],   // C - E - Ab
            [1, 5, 9],   // G - B - Eb
            [2, 6, 10],  // D - F# - Bb
            [3, 7, 11],  // A - Db - F
          ];
          return augTriads.map((indices, ti) => {
            const pts = indices.map(idx => polarToXY(CX, CY, OUTER_R, nodeAngle(idx)));
            const color = augTriadColors[ti];
            // Highlight if the active key is one of the triangle's nodes
            const isActive = indices.includes(activeIdx);
            return (
              <g key={`aug-${ti}`}>
                <polygon
                  points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill={color}
                  fillOpacity={isActive ? 0.06 : 0.015}
                  stroke={color}
                  strokeWidth={isActive ? 1.2 : 0.5}
                  strokeOpacity={isActive ? 0.35 : 0.08}
                  strokeLinejoin="round"
                />
              </g>
            );
          });
        })()}

        {/* ── Diminished 7th squares (minor 3rds apart) ────────────── */}
        {(() => {
          const dimSquareColors = ['#a78bfa', '#fb7185', '#2dd4bf'];
          const dimSquares = [
            [0, 3, 6, 9],   // C - A - F# - Eb
            [1, 4, 7, 10],  // G - E - Db - Bb
            [2, 5, 8, 11],  // D - B - Ab - F
          ];
          return dimSquares.map((indices, si) => {
            const pts = indices.map(idx => polarToXY(CX, CY, INNER_R + (MIDDLE_R - INNER_R) * 0.5, nodeAngle(idx)));
            const color = dimSquareColors[si];
            const isActive = indices.includes(activeIdx);
            return (
              <g key={`dim-${si}`}>
                <polygon
                  points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill={color}
                  fillOpacity={isActive ? 0.05 : 0.012}
                  stroke={color}
                  strokeWidth={isActive ? 1 : 0.4}
                  strokeOpacity={isActive ? 0.3 : 0.06}
                  strokeLinejoin="round"
                  strokeDasharray={isActive ? 'none' : '4 3'}
                />
              </g>
            );
          });
        })()}

        {/* ── Gravitational heatmap centered on active key ─────────────── */}
        {activeIdx >= 0 && (
          <circle
            cx={renderActiveKeyPos[0]}
            cy={renderActiveKeyPos[1]}
            r={OUTER_R - 40}
            fill="url(#cof-heatmap)"
          />
        )}

        {/* ── Connection field lines ──────────────────────────────────── */}
        {connections.map((c, i) => (
          <line
            key={`conn-${i}`}
            x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
            stroke={palette.cyan}
            strokeWidth={c.thickness}
            opacity={c.opacity}
            strokeDasharray="6 4"
            strokeDashoffset={-frame * 0.3}
          />
        ))}

        {/* ── Pathfinder transfer arcs ────────────────────────────────── */}
        {pathfinderArcs.map((arc, ai) => {
          if (arc.points.length < 2) return null;
          const pathD = arc.points.reduce((d, [x, y], pi) => {
            if (pi === 0) return `M ${x} ${y}`;
            // Hohmann-style curved arcs — use quadratic bezier through center-ish control
            const [px, py] = arc.points[pi - 1];
            const cpx = CX + (x + px - 2 * CX) * 0.2;
            const cpy = CY + (y + py - 2 * CY) * 0.2;
            return `${d} Q ${cpx} ${cpy} ${x} ${y}`;
          }, '');

          const totalLen = arc.points.length * 120;
          const dashLen = 12;
          const gapLen = 8;

          return (
            <g key={`pf-${ai}`}>
              {/* Glow under path — wide soft stroke instead of blur filter */}
              <path
                d={pathD}
                fill="none"
                stroke={arc.color}
                strokeWidth={14}
                opacity={0.08}
                strokeDasharray={`${dashLen} ${gapLen}`}
                strokeDashoffset={-frame * 1.5}
                strokeLinecap="round"
              />
              <path
                d={pathD}
                fill="none"
                stroke={arc.color}
                strokeWidth={8}
                opacity={0.12}
                strokeDasharray={`${dashLen} ${gapLen}`}
                strokeDashoffset={-frame * 1.5}
                strokeLinecap="round"
              />
              {/* Path itself */}
              <path
                d={pathD}
                fill="none"
                stroke={arc.color}
                strokeWidth={2}
                opacity={0.7}
                strokeDasharray={`${dashLen} ${gapLen}`}
                strokeDashoffset={-frame * 1.5}
                strokeLinecap="round"
              />
              {/* Flowing particle along path */}
              {Array.from({ length: 3 }, (_, pi) => {
                const progress = ((frame * 2 + pi * (totalLen / 3)) % totalLen) / totalLen;
                const segIdx = Math.floor(progress * (arc.points.length - 1));
                const segT = (progress * (arc.points.length - 1)) - segIdx;
                const [sx, sy] = arc.points[Math.min(segIdx, arc.points.length - 1)];
                const [ex, ey] = arc.points[Math.min(segIdx + 1, arc.points.length - 1)];
                const px = sx + (ex - sx) * segT;
                const py = sy + (ey - sy) * segT;
                return (
                  <React.Fragment key={`pf-p-${ai}-${pi}`}>
                    {/* Fake glow: larger low-opacity circle behind */}
                    <circle
                      cx={px} cy={py} r={8}
                      fill={arc.color}
                      opacity={0.2}
                    />
                    <circle
                      cx={px} cy={py} r={4}
                      fill={arc.color}
                      opacity={0.95}
                    />
                  </React.Fragment>
                );
              })}
            </g>
          );
        })}

        {/* ── Inner ring: Diminished keys ─────────────────────────────── */}
        {DIM_KEYS.map((key, i) => {
          const angle = nodeAngle(i);
          const [x, y] = polarToXY(CX, CY, INNER_R, angle);
          const isHighlighted = highlightedDegrees.includes(7) && i === activeIdx;
          const isDetectedDim = detectedRing.ring === 'dim' && detectedRing.index === i;
          const zp = zoom.zoomProgress;
          // When zoomed: ALL dim nodes become ghost dots (branch tree replaces navigation)
          const idleR = isDetectedDim ? 10 : isHighlighted ? 8 : 6;
          const ghostR = 3;
          const r = idleR + (ghostR - idleR) * zp;
          const baseOpacity = isDetectedDim ? 0.85 : isHighlighted ? 0.7 : 0.2;
          const opacity = Math.max(0.02, baseOpacity * (1 - zp * 0.95));

          return (
            <g key={`dim-${i}`}>
              {isDetectedDim && zp < 0.5 && (
                <>
                  <circle cx={x} cy={y} r={r + 12} fill={palette.gold} opacity={0.06 * (1 - zp)} />
                  <circle cx={x} cy={y} r={r + 7} fill={palette.gold} opacity={0.12 * (1 - zp)} />
                </>
              )}
              <circle
                cx={x} cy={y} r={r}
                fill={isDetectedDim ? palette.gold : palette.textDim}
                opacity={opacity}
              />
              <text
                x={x} y={y + r + 12}
                textAnchor="middle"
                fill={isDetectedDim ? palette.gold : palette.textDim}
                fontSize={isDetectedDim ? 10 : 8}
                fontWeight={isDetectedDim ? 700 : 400}
                opacity={Math.max(0, (isDetectedDim ? 0.9 : opacity * 0.8) * (1 - zp))}
                fontFamily="monospace"
              >
                {key}
              </text>
            </g>
          );
        })}

        {/* ── Middle ring: Minor keys ─────────────────────────────────── */}
        {MINOR_KEYS.map((key, i) => {
          const angle = nodeAngle(i);
          const dist = activeIdx >= 0 ? fifthsDistance(i, activeIdx) : 6;
          const pullFactor = dist <= 2 ? (dist === 1 ? 8 : 4) : 0;
          const pullAngle = activeIdx >= 0 ? nodeAngle(activeIdx) : 0;
          const [bx, by] = polarToXY(CX, CY, MIDDLE_R, angle);

          // Gravitational pull toward active key
          let gx = 0, gy = 0;
          if (pullFactor > 0 && activeIdx >= 0) {
            const [ax, ay] = polarToXY(CX, CY, MIDDLE_R, nodeAngle(activeIdx));
            const dx = ax - bx, dy = ay - by;
            const mag = Math.sqrt(dx * dx + dy * dy);
            if (mag > 0) {
              const springPull = interpolate(
                Math.sin(frame * 0.02),
                [-1, 1],
                [pullFactor * 0.6, pullFactor],
              );
              gx = (dx / mag) * springPull;
              gy = (dy / mag) * springPull;
            }
          }

          const x = bx + gx;
          const y = by + gy;
          const isRelativeMinor = i === activeIdx;
          const isDetectedMinor = detectedRing.ring === 'minor' && detectedRing.index === i;
          const isHighlightedMinor = isRelativeMinor || isDetectedMinor;
          const zp = zoom.zoomProgress;
          // When zoomed: ALL minor nodes become ghost dots (branch tree replaces navigation)
          const ghostR = 3;
          const idleNodeR = isHighlightedMinor ? 18 : 14;
          const nodeR = idleNodeR + (ghostR - idleNodeR) * zp;
          const idleGlow = isHighlightedMinor
            ? 0.4 + 0.15 * Math.sin(frame * 0.06)
            : interpolate(dist, [0, 6], [0.25, 0.08], { extrapolateRight: 'clamp' });
          const glowOpacity = Math.max(0.02, idleGlow * (1 - zp * 0.95));

          return (
            <g key={`min-${i}`}>
              {/* Subtle orbital ring */}
              <circle
                cx={x} cy={y} r={nodeR + 6}
                fill="none"
                stroke={palette.purple}
                strokeWidth={isDetectedMinor ? 1.5 : 0.5}
                opacity={(isDetectedMinor ? 0.7 : glowOpacity * 0.4) * (1 - zp)}
              />
              {/* Glow — layered opacity circles instead of blur filter */}
              {isHighlightedMinor && zp < 0.5 && (
                <>
                  <circle
                    cx={x} cy={y} r={nodeR + 22}
                    fill={palette.purple}
                    opacity={(0.05 + 0.02 * Math.sin(frame * 0.05)) * (1 - zp)}
                  />
                  <circle
                    cx={x} cy={y} r={nodeR + 14}
                    fill={palette.purple}
                    opacity={(0.1 + 0.04 * Math.sin(frame * 0.05)) * (1 - zp)}
                  />
                </>
              )}
              {/* Node body */}
              <circle
                cx={x} cy={y} r={nodeR}
                fill={zp > 0.5 ? (palette.purple) : palette.bg}
                stroke={isDetectedMinor ? palette.pink : palette.purple}
                strokeWidth={isHighlightedMinor ? 2 * (1 - zp) : 1 * (1 - zp)}
                opacity={Math.max(0.04, (isDetectedMinor ? 0.9 : glowOpacity + 0.3) * (1 - zp * 0.9))}
              />
              {/* Inner fill */}
              {zp < 0.5 && (
              <circle
                cx={x} cy={y} r={Math.max(0, nodeR - 3)}
                fill={isDetectedMinor ? palette.pink : palette.purple}
                opacity={(isDetectedMinor ? 0.35 : glowOpacity * 0.3) * (1 - zp)}
              />
              )}
              {/* Label */}
              <text
                x={x} y={y + 4}
                textAnchor="middle"
                fill={isDetectedMinor ? palette.pink : palette.text}
                fontSize={isDetectedMinor ? 13 : 11}
                fontFamily="monospace"
                fontWeight={isHighlightedMinor ? 700 : 400}
                opacity={Math.max(0, (isDetectedMinor ? 1 : interpolate(dist, [0, 6], [1, 0.4], { extrapolateRight: 'clamp' })) * (1 - zp))}
              >
                {key}
              </text>
            </g>
          );
        })}

        {/* ── Outer ring: Major keys — predictive navigation ─────────── */}
        {MAJOR_KEYS.map((key, i) => {
          const angle = nodeAngle(i);
          const [bx, by] = polarToXY(CX, CY, OUTER_R, angle);
          const isActive = i === activeIdx;
          const isPlayed = playedIndices.has(i);
          const dist = activeIdx >= 0 ? fifthsDistance(i, activeIdx) : 6;
          const zp = zoom.zoomProgress; // 0=idle, 1=note held

          // Gravity offset (idle state only)
          const grav = gravityOffsets.get(i);
          const springVal = interpolate(Math.sin(frame * 0.025), [-1, 1], [0.5, 1]);
          const idleGx = grav ? grav.dx * springVal * (1 - zp) : 0;
          const idleGy = grav ? grav.dy * springVal * (1 - zp) : 0;
          const x = bx + idleGx;
          const y = by + idleGy;

          // ── Predictive keyboard: classify each node ──
          const isAdjacent = zoom.adjacentIndices.includes(i);
          const pi = zoom.primaryPlayedIdx;

          // Relationship label for adjacent nodes — expanded harmonic map
          let relLabel = '';
          let relColor = palette.cyan;
          // Harmonic "tier" — how close/strong the relationship is (1=strongest)
          let harmonicTier = 3;
          if (pi >= 0 && isAdjacent && !isPlayed) {
            const diff = ((i - pi) % 12 + 12) % 12;
            if (diff === 1)  { relLabel = 'V';    relColor = palette.cyan;  harmonicTier = 1; }
            else if (diff === 11) { relLabel = 'IV';   relColor = palette.teal;  harmonicTier = 1; }
            else if (diff === 2)  { relLabel = 'ii';   relColor = '#60a5fa';     harmonicTier = 1; }
            else if (diff === 10) { relLabel = 'bVII'; relColor = '#fb923c';     harmonicTier = 2; }
            else if (diff === 3)  { relLabel = 'vi';   relColor = palette.purple; harmonicTier = 2; }
            else if (diff === 9)  { relLabel = 'bVI';  relColor = '#e879f9';     harmonicTier = 2; }
            else if (diff === 4)  { relLabel = 'iii';  relColor = '#818cf8';     harmonicTier = 3; }
            else if (diff === 8)  { relLabel = 'bV';   relColor = '#f87171';     harmonicTier = 3; }
            else if (diff === 5)  { relLabel = 'vii°'; relColor = '#fbbf24';     harmonicTier = 3; }
            else if (diff === 7)  { relLabel = 'bIII'; relColor = '#34d399';     harmonicTier = 3; }
          }

          // ── Node sizing: when zoomed, ONLY the played node stays large ──
          // All others become ghost dots — the branch tree provides navigation
          const idleR = isActive
            ? interpolate(pulseSpring, [0, 1], [26, 30])
            : interpolate(dist, [0, 6], [26, 22], { extrapolateRight: 'clamp' });

          const playedR = 28; // played node (smaller than before — zoomed view magnifies it)
          const ghostR = 3;   // everything else becomes a tiny ghost

          let targetR: number;
          let targetOpacity: number;
          if (isPlayed) {
            targetR = playedR;
            targetOpacity = 1;
          } else {
            // ALL non-played nodes become ghost dots when zoomed
            targetR = ghostR;
            targetOpacity = 0.04;
          }

          // Smooth transition between idle and zoomed states
          const nodeR = idleR + (targetR - idleR) * zp;
          const nodeOpacity = (isActive ? 1 : interpolate(dist, [0, 6], [1, 0.35], { extrapolateRight: 'clamp' }))
            * (1 - zp) + targetOpacity * zp;

          const glowColor = isActive
            ? (activeMode === 'minor' ? palette.purple : palette.cyan)
            : isPlayed ? palette.cyan
            : isAdjacent ? relColor
            : palette.cyan;

          return (
            <g key={`maj-${i}`}>
              {/* Active key glow (idle state) */}
              {isActive && zp < 0.5 && (
                <>
                  <circle cx={x} cy={y} r={70}
                    fill={glowColor} opacity={(0.06 + 0.03 * Math.sin(frame * 0.04)) * (1 - zp * 2)}
                    filter="url(#cof-glow-lg)"
                  />
                  <circle cx={x} cy={y} r={45}
                    fill={glowColor} opacity={(0.1 + 0.05 * Math.sin(frame * 0.06)) * (1 - zp * 2)}
                    filter="url(#cof-glow-md)"
                  />
                </>
              )}

              {/* ── PLAYED: focused glow (scaled for zoom magnification) ── */}
              {isPlayed && zp > 0.05 && (
                <>
                  <circle cx={x} cy={y}
                    r={nodeR + 16 + 3 * Math.sin(frame * 0.06)}
                    fill={palette.cyan} opacity={0.04 + 0.02 * zp}
                  />
                  <circle cx={x} cy={y}
                    r={nodeR + 8}
                    fill={palette.cyan} opacity={0.08 + 0.04 * zp}
                  />
                  {/* Neon ring */}
                  <circle cx={x} cy={y} r={nodeR + 3}
                    fill="none" stroke={palette.cyan}
                    strokeWidth={1.5} opacity={0.5 + 0.2 * Math.sin(frame * 0.07)}
                  />
                  {/* Single subtle ripple */}
                  {(() => {
                    const ripR = nodeR + 4 + (frame % 50);
                    const ripOp = interpolate(frame % 50, [0, 50], [0.15 * zp, 0]);
                    return (
                      <circle cx={x} cy={y} r={ripR}
                        fill="none" stroke={palette.cyan} strokeWidth={0.8} opacity={ripOp}
                      />
                    );
                  })()}
                </>
              )}

              {/* Adjacent glow removed — branch tree provides navigation */}

              {/* Node body */}
              <circle cx={x} cy={y} r={nodeR}
                fill={palette.bg}
                stroke={isPlayed ? palette.cyan : glowColor}
                strokeWidth={isPlayed ? 3 : isAdjacent && zp > 0.3 ? 2 : 1.5}
                opacity={nodeOpacity}
              />
              {/* Inner fill */}
              <circle cx={x} cy={y} r={Math.max(0, nodeR - 4)}
                fill={isPlayed ? palette.cyan : glowColor}
                opacity={isPlayed ? 0.35 + 0.1 * Math.sin(frame * 0.05)
                  : isAdjacent && zp > 0.3 ? 0.15 * zp
                  : isActive ? 0.2 + 0.08 * Math.sin(frame * 0.05) : nodeOpacity * 0.08}
              />

              {/* Key name label */}
              <text x={x} y={y + (isPlayed && zp > 0.3 ? 4 : 5)}
                textAnchor="middle"
                fill={isPlayed ? '#ffffff' : palette.text}
                fontSize={isPlayed && zp > 0.3 ? 12 : 14}
                fontFamily="monospace"
                fontWeight={isPlayed ? 900 : isActive ? 800 : 500}
                opacity={nodeOpacity}
              >
                {key}
              </text>

              {/* Roman numeral labels moved to branch tree */}
            </g>
          );
        })}

        {/* ── Accretion disk around active key ────────────────────────── */}
        {activeIdx >= 0 && accretionDisk.map((p, i) => {
          const [akx, aky] = renderActiveKeyPos;
          const angle = frame * p.angularSpeed * 0.04 + p.phase;
          // Slight elliptical orbit
          const rx = p.orbitRadius;
          const ry = p.orbitRadius * 0.6;
          const px = akx + rx * Math.cos(angle);
          const py = aky + ry * Math.sin(angle);

          // Fade particles behind the node
          const behindNode = Math.abs(px - akx) < 15 && Math.abs(py - aky) < 15;
          const opacity = behindNode ? p.opacity * 0.3 : p.opacity;

          return (
            <circle
              key={`acc-${i}`}
              cx={px} cy={py}
              r={p.size}
              fill={p.color}
              opacity={opacity * (0.7 + 0.3 * Math.sin(frame * 0.1 + i))}
            />
          );
        })}

        {/* ── Highlighted field lines (fifths from active) ────────────── */}
        {activeIdx >= 0 && [
          (activeIdx + 1) % 12,
          (activeIdx + 11) % 12,
        ].map((ni, li) => {
          const [ax, ay] = renderActiveKeyPos;
          const [nx, ny] = polarToXY(CX, CY, OUTER_R, nodeAngle(ni));
          const grav = gravityOffsets.get(ni);
          const springVal = interpolate(Math.sin(frame * 0.025), [-1, 1], [0.5, 1]);
          const tx = nx + (grav ? grav.dx * springVal : 0);
          const ty = ny + (grav ? grav.dy * springVal : 0);

          return (
            <g key={`field-${li}`}>
              <line
                x1={ax} y1={ay} x2={tx} y2={ty}
                stroke={palette.cyan}
                strokeWidth={2}
                opacity={0.25}
                strokeDasharray="8 5"
                strokeDashoffset={-frame * 0.6}
              />
              {/* Soft glow line — wider stroke with low opacity instead of blur */}
              <line
                x1={ax} y1={ay} x2={tx} y2={ty}
                stroke={palette.cyan}
                strokeWidth={10}
                opacity={0.04}
                strokeLinecap="round"
              />
              <line
                x1={ax} y1={ay} x2={tx} y2={ty}
                stroke={palette.cyan}
                strokeWidth={6}
                opacity={0.07}
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {/* ── Diatonic degree labels ──────────────────────────────────── */}
        {highlightedDegrees.length > 0 && activeIdx >= 0 && highlightedDegrees.map((deg) => {
          if (deg < 1 || deg > 7) return null;
          // Map scale degrees to fifths-circle offsets
          // I=0, ii=2(up 2 fifths), iii=4, IV=-1(11), V=1, vi=3, vii°=5
          const degreeToFifths = [0, 2, 4, -1, 1, 3, 5];
          const fifthOffset = degreeToFifths[deg - 1];
          const nodeIdx = (activeIdx + fifthOffset + 12) % 12;
          const [nx, ny] = polarToXY(CX, CY, OUTER_R + 38, nodeAngle(nodeIdx));

          const label = DEGREE_LABELS[deg - 1];
          const labelOpacity = 0.6 + 0.2 * Math.sin(frame * 0.04 + deg);

          return (
            <g key={`deg-${deg}`}>
              <text
                x={nx} y={ny + 4}
                textAnchor="middle"
                fill={palette.gold}
                fontSize={12}
                fontFamily="monospace"
                fontWeight={700}
                opacity={labelOpacity}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* ── Detected chord indicator ───────────────────────────────── */}
        {detectedChord && (
          <g>
            <text
              x={CX} y={CY - 20}
              textAnchor="middle"
              fill={palette.text}
              fontSize={28}
              fontFamily="monospace"
              fontWeight={800}
              opacity={0.9}
            >
              {detectedChord}
            </text>
            <text
              x={CX} y={CY + 8}
              textAnchor="middle"
              fill={palette.textDim}
              fontSize={12}
              fontFamily="monospace"
              opacity={0.5}
            >
              detected
            </text>
          </g>
        )}

        {/* ── Center mode / key label ────────────────────────────────── */}
        {!detectedChord && activeKey && (
          <g>
            <text
              x={CX} y={CY - 10}
              textAnchor="middle"
              fill={palette.text}
              fontSize={22}
              fontFamily="monospace"
              fontWeight={700}
              opacity={0.7}
            >
              {activeKey} {activeMode}
            </text>
            <text
              x={CX} y={CY + 14}
              textAnchor="middle"
              fill={palette.textDim}
              fontSize={10}
              fontFamily="monospace"
              opacity={0.35}
            >
              harmonic gravity
            </text>
          </g>
        )}

        </g>{/* end circle view fade group */}

        {/* ── Chord progression trail — bottom glass cards ────────────── */}
        {recentChords.length > 0 && (
          <g>
            {recentChords.map((chord, ci) => {
              const total = recentChords.length;
              const cardW = 72;
              const gap = 8;
              const totalW = total * cardW + (total - 1) * gap;
              const startX = (W - totalW) / 2;
              const cx = startX + ci * (cardW + gap);
              const cy2 = H - 52;
              const isLatest = ci === total - 1;
              const fadeOpacity = total <= 1 ? 0.9 : interpolate(ci, [0, total - 1], [0.25, 0.9]);

              return (
                <g key={`prog-${ci}`}>
                  {/* Glass card background */}
                  <rect
                    x={cx} y={cy2}
                    width={cardW} height={32}
                    rx={6}
                    fill={palette.glass}
                    stroke={isLatest ? palette.cyan : palette.glassBorder}
                    strokeWidth={isLatest ? 1.5 : 0.5}
                    opacity={fadeOpacity}
                  />
                  {/* Chord text */}
                  <text
                    x={cx + cardW / 2}
                    y={cy2 + 20}
                    textAnchor="middle"
                    fill={isLatest ? palette.cyan : palette.text}
                    fontSize={13}
                    fontFamily="monospace"
                    fontWeight={isLatest ? 700 : 400}
                    opacity={fadeOpacity}
                  >
                    {chord}
                  </text>
                </g>
              );
            })}
            {/* Label */}
            <text
              x={W / 2} y={H - 60}
              textAnchor="middle"
              fill={palette.textDim}
              fontSize={9}
              fontFamily="monospace"
              opacity={0.3}
            >
              progression
            </text>
          </g>
        )}

        {/* ── Active notes indicator — tiny dots near center ──────────── */}
        {activeNotes.length > 0 && activeNotes.slice(0, 12).map((midi, ni) => {
          const noteClass = midi % 12;
          const noteAngle = (noteClass / 12) * 360;
          const [nx, ny] = polarToXY(CX, CY, 80, noteAngle);
          const pulse = 0.5 + 0.5 * Math.sin(frame * 0.1 + ni * 0.5);

          return (
            <circle
              key={`note-${ni}`}
              cx={nx} cy={ny}
              r={3 + pulse * 2}
              fill={palette.pink}
              opacity={0.5 + pulse * 0.4}
            />
          );
        })}
        {/* ── Chord path + branch tree ──────────────────────────────── */}
        {chordPath.length > 0 && (() => {
          const zp = hasPath ? 1 : Math.max(zoom.zoomProgress, 0.15); // full opacity when path exists

          // Compute tension values for the arc
          const tensions = chordPath.map(n => chordTension(n.chord, activeKey, activeMode));

          // Famous progression matching
          const pathChordNames = chordPath.map(n => n.chord);
          const famousMatch = matchFamousProgressions(pathChordNames, activeKey, activeMode);

          // Render each path node and its connection to the next
          return (
            <g opacity={zp}>
              {/* ── Loop region bracket ── */}
              {loopRegion && chordPath.length > 1 && (() => {
                const [ls, le] = loopRegion;
                const startNode = chordPath[Math.min(ls, chordPath.length - 1)];
                const endNode = chordPath[Math.min(le, chordPath.length - 1)];
                const bracketY = PATH_START_Y - 55 * scale;
                const bracketH = 12 * scale;
                return (
                  <g>
                    <rect
                      x={startNode.x - 8 * scale} y={bracketY}
                      width={endNode.x - startNode.x + 16 * scale} height={bracketH}
                      rx={3} fill="rgba(251,191,36,0.08)"
                      stroke={palette.gold} strokeWidth={1} opacity={0.6}
                      strokeDasharray="4 2"
                    />
                    <text
                      x={(startNode.x + endNode.x) / 2} y={bracketY + bracketH / 2 + 1}
                      textAnchor="middle" dominantBaseline="central"
                      fill={palette.gold} fontSize={4.5 * scale} fontFamily="monospace"
                      fontWeight={600} opacity={0.7}
                    >LOOP</text>
                  </g>
                );
              })()}

              {/* ── Tension arc ── */}
              {chordPath.length >= 2 && (() => {
                const arcY = PATH_START_Y - 35 * scale;
                const maxDeflect = 25 * scale; // max height of tension curve
                // Build SVG path from tension values
                const points = chordPath.map((node, i) => ({
                  x: node.x,
                  y: arcY - tensions[i] * maxDeflect,
                }));
                let d = `M ${points[0].x} ${points[0].y}`;
                for (let i = 1; i < points.length; i++) {
                  const prev = points[i - 1];
                  const curr = points[i];
                  const cpx = (prev.x + curr.x) / 2;
                  d += ` C ${cpx} ${prev.y} ${cpx} ${curr.y} ${curr.x} ${curr.y}`;
                }
                return (
                  <g>
                    {/* Tension fill */}
                    <path
                      d={d + ` L ${points[points.length - 1].x} ${arcY} L ${points[0].x} ${arcY} Z`}
                      fill="url(#tension-gradient)" opacity={0.15}
                    />
                    {/* Tension line */}
                    <path d={d} fill="none" stroke={palette.gold} strokeWidth={1.2 * scale}
                      opacity={0.4} strokeLinecap="round"
                    />
                    {/* Tension dots */}
                    {points.map((p, i) => (
                      <circle key={`t-${i}`} cx={p.x} cy={p.y} r={2 * scale}
                        fill={tensions[i] > 0.6 ? palette.gold : tensions[i] > 0.3 ? palette.teal : palette.cyan}
                        opacity={0.6}
                      />
                    ))}
                    {/* Label */}
                    <text x={points[0].x - 8 * scale} y={arcY - maxDeflect * 0.5}
                      textAnchor="end" fill={palette.textDim} fontSize={3.5 * scale}
                      fontFamily="monospace" opacity={0.3}
                    >tension</text>
                  </g>
                );
              })()}

              {/* ── Voice leading between nodes ── */}
              {chordPath.map((node, ni) => {
                if (ni === 0) return null;
                const prev = chordPath[ni - 1];
                const prevNotes = chordToMidi(prev.chord).map(n => n % 12).sort((a, b) => a - b);
                const currNotes = chordToMidi(node.chord).map(n => n % 12).sort((a, b) => a - b);

                // Voice leading: match each note in prev to closest note in curr
                const vlY = PATH_START_Y + 22 * scale; // below the node center
                const toneSpacing = 11 * scale;
                const toneR = 5 * scale;
                const midX = (prev.x + node.x) / 2;

                // Build voice pairs: for each prev note, find best curr target
                const usedCurr = new Set<number>();
                const pairs: { from: number; to: number; fromIdx: number; toIdx: number; common: boolean }[] = [];
                // First pass: exact matches (common tones)
                for (let fi = 0; fi < prevNotes.length; fi++) {
                  const ci = currNotes.indexOf(prevNotes[fi]);
                  if (ci >= 0 && !usedCurr.has(ci)) {
                    pairs.push({ from: prevNotes[fi], to: currNotes[ci], fromIdx: fi, toIdx: ci, common: true });
                    usedCurr.add(ci);
                  }
                }
                // Second pass: step motion for unmatched
                for (let fi = 0; fi < prevNotes.length; fi++) {
                  if (pairs.some(p => p.fromIdx === fi)) continue;
                  let bestCi = -1;
                  let bestDist = 99;
                  for (let ci = 0; ci < currNotes.length; ci++) {
                    if (usedCurr.has(ci)) continue;
                    const dist = Math.min(
                      Math.abs(currNotes[ci] - prevNotes[fi]),
                      12 - Math.abs(currNotes[ci] - prevNotes[fi])
                    );
                    if (dist < bestDist) { bestDist = dist; bestCi = ci; }
                  }
                  if (bestCi >= 0) {
                    pairs.push({ from: prevNotes[fi], to: currNotes[bestCi], fromIdx: fi, toIdx: bestCi, common: false });
                    usedCurr.add(bestCi);
                  }
                }

                const age = chordPath.length - ni;
                const ageDim = Math.max(0.3, 1 - age * 0.1);

                // Build tooltip data for hover
                const pairData = pairs.map(pair => {
                  const fromName = noteName(pair.from, activeKey);
                  const toName = noteName(pair.to, activeKey);
                  if (pair.common) return { fromName, toName, common: true, stepDesc: 'common tone — held' };
                  const dist = Math.min(
                    Math.abs(pair.to - pair.from),
                    12 - Math.abs(pair.to - pair.from)
                  );
                  const dir = ((pair.to - pair.from + 12) % 12) <= 6 ? '↑' : '↓';
                  const stepDesc = `${dir} ${dist === 1 ? 'half step' : dist === 2 ? 'whole step' : dist + ' semitones'}`;
                  return { fromName, toName, common: false, stepDesc };
                });

                const isHovered = hoveredVL?.fromChord === prev.chord && hoveredVL?.toChord === node.chord;
                const hoverBoost = isHovered ? 1.3 : 1;
                const vlHitH = Math.max(...[prevNotes.length, currNotes.length]) * toneSpacing + toneR * 8 + 20 * scale;

                return (
                  <g key={`vl-${ni}`} opacity={ageDim * (isHovered ? 1 : 0.85)}>
                    {/* Invisible hit area for hover */}
                    <rect
                      x={prev.x - 5 * scale} y={vlY - vlHitH / 2}
                      width={node.x - prev.x + 10 * scale} height={vlHitH}
                      fill="transparent"
                      onMouseEnter={() => onVLEnter({
                        x: midX, y: vlY - vlHitH / 2 - 8 * scale,
                        fromChord: prev.displayChord || prev.chord,
                        toChord: node.displayChord || node.chord,
                        pairs: pairData,
                      })}
                      onMouseLeave={onVLLeave}
                    />
                    {/* Prev chord tones (stacked vertically) */}
                    {prevNotes.map((note, ti) => {
                      const ty = vlY + (ti - (prevNotes.length - 1) / 2) * toneSpacing;
                      const isCommon = pairs.find(p => p.fromIdx === ti)?.common;
                      const color = isCommon ? palette.cyan : palette.purple;
                      const cx0 = prev.x + 14 * scale;
                      return (
                        <g key={`vl-p-${ni}-${ti}`}>
                          {/* Neon glow */}
                          <circle cx={cx0} cy={ty} r={(toneR + 4 * scale) * hoverBoost}
                            fill={color} opacity={isHovered ? 0.18 : 0.1}
                          />
                          <circle cx={cx0} cy={ty} r={(toneR + 2 * scale) * hoverBoost}
                            fill={color} opacity={isHovered ? 0.25 : 0.15}
                          />
                          {/* Core dot */}
                          <circle cx={cx0} cy={ty} r={toneR * hoverBoost}
                            fill={palette.bg} stroke={color}
                            strokeWidth={(isHovered ? 1.8 : 1.2) * scale} opacity={isHovered ? 1 : 0.8}
                          />
                          <circle cx={cx0} cy={ty} r={Math.max(0, toneR * hoverBoost - 1.5 * scale)}
                            fill={color} opacity={isHovered ? 0.3 : 0.2}
                          />
                          {/* Label */}
                          <text x={cx0} y={ty + 0.5}
                            textAnchor="middle" dominantBaseline="central"
                            fill="#ffffff" fontSize={4.5 * scale * hoverBoost} fontFamily="monospace" fontWeight={700}
                            opacity={isHovered ? 1 : 0.9}
                          >{noteName(note, activeKey)}</text>
                        </g>
                      );
                    })}
                    {/* Curr chord tones */}
                    {currNotes.map((note, ti) => {
                      const ty = vlY + (ti - (currNotes.length - 1) / 2) * toneSpacing;
                      const isCommon = pairs.find(p => p.toIdx === ti)?.common;
                      const color = isCommon ? palette.cyan : palette.purple;
                      const cx0 = node.x - 14 * scale;
                      return (
                        <g key={`vl-c-${ni}-${ti}`}>
                          {/* Neon glow */}
                          <circle cx={cx0} cy={ty} r={(toneR + 4 * scale) * hoverBoost}
                            fill={color} opacity={isHovered ? 0.18 : 0.1}
                          />
                          <circle cx={cx0} cy={ty} r={(toneR + 2 * scale) * hoverBoost}
                            fill={color} opacity={isHovered ? 0.25 : 0.15}
                          />
                          {/* Core dot */}
                          <circle cx={cx0} cy={ty} r={toneR * hoverBoost}
                            fill={palette.bg} stroke={color}
                            strokeWidth={(isHovered ? 1.8 : 1.2) * scale} opacity={isHovered ? 1 : 0.8}
                          />
                          <circle cx={cx0} cy={ty} r={Math.max(0, toneR * hoverBoost - 1.5 * scale)}
                            fill={color} opacity={isHovered ? 0.3 : 0.2}
                          />
                          {/* Label */}
                          <text x={cx0} y={ty + 0.5}
                            textAnchor="middle" dominantBaseline="central"
                            fill="#ffffff" fontSize={4.5 * scale * hoverBoost} fontFamily="monospace" fontWeight={700}
                            opacity={isHovered ? 1 : 0.9}
                          >{noteName(note, activeKey)}</text>
                        </g>
                      );
                    })}
                    {/* Connection lines between voice pairs */}
                    {pairs.map((pair, pi) => {
                      const fromY = vlY + (pair.fromIdx - (prevNotes.length - 1) / 2) * toneSpacing;
                      const toY = vlY + (pair.toIdx - (currNotes.length - 1) / 2) * toneSpacing;
                      const x1 = prev.x + 14 * scale + toneR + 2;
                      const x2 = node.x - 14 * scale - toneR - 2;
                      const color = pair.common ? palette.cyan : palette.purple;
                      return (
                        <g key={`vl-line-${ni}-${pi}`}>
                          {pair.common ? (
                            <>
                              <line x1={x1} y1={fromY} x2={x2} y2={toY}
                                stroke={color} strokeWidth={(isHovered ? 6 : 4) * scale} opacity={isHovered ? 0.1 : 0.06}
                                strokeLinecap="round"
                              />
                              <line x1={x1} y1={fromY} x2={x2} y2={toY}
                                stroke={color} strokeWidth={(isHovered ? 2 : 1.5) * scale} opacity={isHovered ? 0.6 : 0.4}
                                strokeLinecap="round"
                              />
                            </>
                          ) : (
                            <>
                              <path
                                d={`M ${x1} ${fromY} C ${midX} ${fromY} ${midX} ${toY} ${x2} ${toY}`}
                                fill="none" stroke={color} strokeWidth={(isHovered ? 6 : 4) * scale}
                                opacity={isHovered ? 0.1 : 0.06} strokeLinecap="round"
                              />
                              <path
                                d={`M ${x1} ${fromY} C ${midX} ${fromY} ${midX} ${toY} ${x2} ${toY}`}
                                fill="none" stroke={color} strokeWidth={(isHovered ? 1.6 : 1.2) * scale}
                                opacity={isHovered ? 0.5 : 0.35} strokeDasharray={`${4 * scale} ${3 * scale}`}
                                strokeLinecap="round"
                              />
                            </>
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {/* ── Path connection lines (neon chain) ── */}
              {chordPath.map((node, ni) => {
                if (ni === 0) return null;
                const prev = chordPath[ni - 1];
                const isRecent = ni >= chordPath.length - 3;
                const age = chordPath.length - ni;
                const ageDim = Math.max(0.4, 1 - age * 0.08);
                // Color by harmonic function
                const funcColor = FUNCTION_COLORS[chordFunction(node.chord, activeKey)];
                const lineColor = funcColor;
                const inLoop = loopRegion && ni >= loopRegion[0] && ni <= loopRegion[1];
                return (
                  <g key={`path-line-${ni}`}>
                    {/* Wide soft glow */}
                    <line x1={prev.x} y1={prev.y} x2={node.x} y2={node.y}
                      stroke={lineColor} strokeWidth={12 * scale}
                      opacity={0.06 * ageDim * (inLoop ? 1.5 : 1)} strokeLinecap="round"
                    />
                    {/* Medium glow */}
                    <line x1={prev.x} y1={prev.y} x2={node.x} y2={node.y}
                      stroke={lineColor} strokeWidth={6 * scale}
                      opacity={0.12 * ageDim} strokeLinecap="round"
                    />
                    {/* Core line */}
                    <line x1={prev.x} y1={prev.y} x2={node.x} y2={node.y}
                      stroke={lineColor} strokeWidth={2.5 * scale}
                      opacity={0.6 * ageDim} strokeLinecap="round"
                    />
                    {/* Animated dashed overlay */}
                    <line x1={prev.x} y1={prev.y} x2={node.x} y2={node.y}
                      stroke="#ffffff" strokeWidth={1.5 * scale}
                      opacity={0.2 * ageDim} strokeLinecap="round"
                      strokeDasharray={`${4 * scale} ${6 * scale}`}
                      strokeDashoffset={-frame * 0.8}
                    />
                    {/* Flowing particles on path segment */}
                    {isRecent && [0, 0.5].map((offset, pi) => {
                      const progress = ((frame * 1.5 + ni * 30 + offset * 60) % 60) / 60;
                      const px2 = prev.x + (node.x - prev.x) * progress;
                      const py2 = prev.y + (node.y - prev.y) * progress;
                      return (
                        <React.Fragment key={pi}>
                          <circle cx={px2} cy={py2} r={3 * scale} fill={lineColor} opacity={0.15} />
                          <circle cx={px2} cy={py2} r={1.5 * scale} fill={lineColor} opacity={0.7} />
                        </React.Fragment>
                      );
                    })}
                  </g>
                );
              })}

              {/* ── Past path nodes ── */}
              {chordPath.slice(0, -1).map((node, ni) => {
                const age = chordPath.length - 1 - ni;
                const dimFactor = Math.max(0.4, 1 - age * 0.08);
                const nodeR = 10 * scale;
                const funcCol = FUNCTION_COLORS[chordFunction(node.chord, activeKey)];
                const nodeColor = funcCol;
                const isPlaying = playbackIndex === ni;
                const playPulse = isPlaying ? 0.5 + 0.5 * Math.sin(frame * 0.15) : 0;
                return (
                  <g key={`path-node-${ni}`}>
                    {/* Playback indicator */}
                    {isPlaying && (
                      <circle cx={node.x} cy={node.y} r={nodeR + 18 + playPulse * 5}
                        fill={palette.gold} opacity={0.15 + playPulse * 0.1}
                      />
                    )}
                    {/* Full chord: double glow ring */}
                    {node.isFullChord && (
                      <>
                        <circle cx={node.x} cy={node.y} r={nodeR + 16}
                          fill={palette.gold} opacity={0.05 * dimFactor}
                        />
                        <circle cx={node.x} cy={node.y} r={nodeR + 5}
                          fill="none" stroke={palette.gold}
                          strokeWidth={1.2} opacity={0.3 * dimFactor}
                        />
                      </>
                    )}
                    {/* Neon glow */}
                    <circle cx={node.x} cy={node.y} r={nodeR + 10}
                      fill={nodeColor} opacity={0.08 * dimFactor}
                    />
                    {/* Node */}
                    <circle cx={node.x} cy={node.y} r={nodeR}
                      fill={palette.bg} stroke={nodeColor}
                      strokeWidth={isPlaying ? 3 : node.isFullChord ? 2.2 : 1.8} opacity={isPlaying ? 1 : 0.8 * dimFactor}
                    />
                    <circle cx={node.x} cy={node.y} r={nodeR - 3}
                      fill={nodeColor} opacity={(node.isFullChord ? 0.22 : 0.12) * dimFactor}
                    />
                    {/* Label */}
                    <text x={node.x} y={node.y + 1}
                      textAnchor="middle" dominantBaseline="central"
                      fill={isPlaying ? '#ffffff' : palette.text} fontSize={8 * scale}
                      fontFamily="monospace" fontWeight={isPlaying ? 800 : node.isFullChord ? 700 : 600}
                      opacity={isPlaying ? 1 : 0.85 * dimFactor}
                    >
                      {node.displayChord || node.chord}
                    </text>
                    {/* Step number */}
                    <text x={node.x} y={node.y - nodeR - 4 * scale}
                      textAnchor="middle" fill={palette.textDim}
                      fontSize={4 * scale} fontFamily="monospace"
                      opacity={0.3 * dimFactor}
                    >
                      {ni + 1}
                    </text>
                    {/* Hit area — right-click to delete */}
                    {onDeleteNode && (
                      <circle cx={node.x} cy={node.y} r={nodeR + 4}
                        fill="transparent" stroke="none"
                        style={{ cursor: 'pointer' }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onDeleteNode(ni);
                        }}
                      />
                    )}
                  </g>
                );
              })}

              {/* ── Latest node (large, bright, with branches) ── */}
              {latestNode && (() => {
                const px = latestNode.x;
                const py = latestNode.y;
                const playedNodeR = 14 * scale;
                const branches = generateBranches(
                  latestNode.index, latestNode.ring, latestNode.arrivalAngle, scale,
                );

                return (
                  <g>
                    {/* Branches from latest node */}
                    {branches.map((b, bi) => {
                      const rad = (b.angle - 90) * Math.PI / 180;
                      const tx = px + b.dist * Math.cos(rad);
                      const ty = py + b.dist * Math.sin(rad);

                      const mx = (px + tx) / 2;
                      const my = (py + ty) / 2;
                      const perpX = -(ty - py);
                      const perpY = (tx - px);
                      const perpLen = Math.sqrt(perpX * perpX + perpY * perpY);
                      const curveMag = (b.tier === 1 ? 8 : b.tier === 2 ? 12 : 16) * scale;
                      const cpx = mx + (perpLen > 0 ? perpX / perpLen * curveMag : 0);
                      const cpy = my + (perpLen > 0 ? perpY / perpLen * curveMag : 0);
                      const arcD = `M ${px} ${py} Q ${cpx} ${cpy} ${tx} ${ty}`;

                      const nodeR = b.tier === 1 ? 14 * scale : b.tier === 2 ? 10 * scale : 8 * scale;
                      const dashLen = b.tier === 1 ? 8 : 5;
                      const gapLen = b.tier === 1 ? 4 : 5;

                      const isHovered = hoveredBranch?.roman === b.roman;
                      const hs = isHovered ? 1.2 : 1;

                      return (
                        <g key={`branch-${bi}`}
                          style={{ cursor: 'pointer' }}
                        >
                          {b.tier <= 2 && (
                            <path d={arcD} fill="none"
                              stroke={b.color} strokeWidth={b.width * 3}
                              opacity={isHovered ? 0.12 : 0.04} strokeLinecap="round"
                            />
                          )}
                          <path d={arcD} fill="none"
                            stroke={b.color} strokeWidth={b.width * (isHovered ? 1.5 : 1)}
                            opacity={isHovered ? 0.8 : b.tier === 1 ? 0.5 : b.tier === 2 ? 0.35 : 0.2}
                            strokeDasharray={`${dashLen} ${gapLen}`}
                            strokeDashoffset={-frame * (b.tier === 1 ? 1.2 : 0.7)}
                            strokeLinecap="round"
                          />
                          {b.transition && (
                            <g>
                              <rect x={cpx - 12 * scale} y={cpy - 5 * scale}
                                width={24 * scale} height={10 * scale} rx={2}
                                fill="rgba(8,14,24,0.85)" stroke={b.color} strokeWidth={0.3} opacity={0.7}
                              />
                              <text x={cpx} y={cpy + 2.5 * scale}
                                textAnchor="middle" fill={b.color}
                                fontSize={5.5 * scale} fontFamily="monospace" fontWeight={600} opacity={0.85}
                              >{b.transition}</text>
                            </g>
                          )}
                          {/* Wide invisible hit area along the entire branch path */}
                          <path d={arcD} fill="none" stroke="transparent"
                            strokeWidth={20 * scale}
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={() => onBranchEnter(b.roman, tx, ty, px, py)}
                            onMouseLeave={onBranchLeave}
                            onClick={(e) => { e.stopPropagation(); onClickChord?.(b.targetChord); }}
                          />
                          {/* Node hit area */}
                          <circle cx={tx} cy={ty} r={nodeR * 3.5} fill="transparent" stroke="none"
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={() => onBranchEnter(b.roman, tx, ty, px, py)}
                            onMouseLeave={onBranchLeave}
                            onClick={(e) => { e.stopPropagation(); onClickChord?.(b.targetChord); }}
                          />
                          <circle cx={tx} cy={ty} r={(nodeR + 6) * hs}
                            fill={b.color} opacity={(isHovered ? 0.12 : 0.04) + 0.02 * Math.sin(frame * 0.05 + bi)}
                          />
                          {isHovered && <circle cx={tx} cy={ty} r={nodeR * hs + 12} fill={b.color} opacity={0.06} />}
                          <circle cx={tx} cy={ty} r={nodeR * hs}
                            fill={palette.bg} stroke={b.color}
                            strokeWidth={isHovered ? 2.5 : b.tier === 1 ? 2 : 1.2}
                            opacity={isHovered ? 1 : b.tier === 1 ? 0.9 : b.tier === 2 ? 0.7 : 0.5}
                          />
                          <circle cx={tx} cy={ty} r={Math.max(0, nodeR * hs - 3)}
                            fill={b.color} opacity={isHovered ? 0.25 : b.tier === 1 ? 0.15 : 0.08}
                          />
                          <text x={tx} y={ty + 1}
                            textAnchor="middle" dominantBaseline="central"
                            fill={isHovered ? '#ffffff' : palette.text}
                            fontSize={(b.tier === 1 ? 9 * scale : b.tier === 2 ? 7 * scale : 6 * scale) * hs}
                            fontFamily="monospace" fontWeight={isHovered ? 800 : b.tier === 1 ? 700 : 500}
                            opacity={isHovered ? 1 : b.tier === 1 ? 1 : b.tier === 2 ? 0.85 : 0.65}
                          >{b.label}</text>
                          <text x={tx} y={ty + nodeR * hs + 6 * scale}
                            textAnchor="middle" fill={b.color}
                            fontSize={5 * scale * hs} fontFamily="monospace" fontWeight={600}
                            opacity={isHovered ? 0.9 : b.tier === 1 ? 0.7 : 0.45}
                          >{b.roman}</text>
                          {b.tier <= 2 && (() => {
                            const period = b.tier === 1 ? 60 : 90;
                            const progress = ((frame * 2 + bi * 20) % period) / period;
                            const t2 = progress; const mt = 1 - t2;
                            const bx2 = mt * mt * px + 2 * mt * t2 * cpx + t2 * t2 * tx;
                            const by2 = mt * mt * py + 2 * mt * t2 * cpy + t2 * t2 * ty;
                            return (
                              <>
                                <circle cx={bx2} cy={by2} r={2.5 * scale} fill={b.color} opacity={0.12} />
                                <circle cx={bx2} cy={by2} r={1.2 * scale} fill={b.color} opacity={0.6} />
                              </>
                            );
                          })()}
                        </g>
                      );
                    })}

                    {/* Latest played node (on top of branches) */}
                    {(() => {
                      const fc = latestNode.isFullChord;
                      const nodeColor = fc ? palette.gold : palette.cyan;
                      const pulsePhase = Math.sin(frame * 0.06);
                      return (
                        <>
                          {/* Full chord: outer neon burst ring */}
                          {fc && (
                            <>
                              <circle cx={px} cy={py} r={playedNodeR + 30 + 3 * pulsePhase}
                                fill={palette.gold} opacity={0.06 + 0.03 * pulsePhase}
                              />
                              <circle cx={px} cy={py} r={playedNodeR + 6}
                                fill="none" stroke={palette.gold}
                                strokeWidth={2} opacity={0.4 + 0.15 * pulsePhase}
                                strokeDasharray={`${3 * scale} ${2 * scale}`}
                                strokeDashoffset={-frame * 0.5}
                              />
                            </>
                          )}
                          {/* Standard glow */}
                          <circle cx={px} cy={py} r={playedNodeR + 20}
                            fill={nodeColor} opacity={0.04 + 0.02 * pulsePhase}
                          />
                          <circle cx={px} cy={py} r={playedNodeR + 10}
                            fill={nodeColor} opacity={fc ? 0.12 : 0.08}
                          />
                          <circle cx={px} cy={py} r={playedNodeR + 3}
                            fill="none" stroke={nodeColor}
                            strokeWidth={fc ? 2 : 1.5} opacity={0.5 + 0.2 * Math.sin(frame * 0.07)}
                          />
                          <circle cx={px} cy={py} r={playedNodeR}
                            fill={palette.bg} stroke={nodeColor}
                            strokeWidth={fc ? 3 : 2.5} opacity={1}
                          />
                          <circle cx={px} cy={py} r={playedNodeR - 4}
                            fill={nodeColor} opacity={fc ? 0.3 : 0.2}
                          />
                          <text x={px} y={py + 1}
                            textAnchor="middle" dominantBaseline="central"
                            fill={fc ? palette.gold : '#ffffff'} fontSize={11 * scale}
                            fontFamily="monospace" fontWeight={900}
                          >
                            {latestNode.displayChord || latestNode.chord}
                          </text>
                          {/* Step number */}
                          <text x={px} y={py - playedNodeR - 5 * scale}
                            textAnchor="middle" fill={nodeColor}
                            fontSize={5 * scale} fontFamily="monospace" fontWeight={600}
                            opacity={0.5}
                          >
                            {chordPath.length}
                          </text>
                          {/* Hit area — right-click to delete latest node */}
                          {onDeleteNode && (
                            <circle cx={px} cy={py} r={playedNodeR + 6}
                              fill="transparent" stroke="none"
                              style={{ cursor: 'pointer' }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onDeleteNode(chordPath.length - 1);
                              }}
                            />
                          )}
                          {/* Ripple */}
                          {(() => {
                            const ripR = playedNodeR + 4 + (frame % 50);
                            const ripOp = interpolate(frame % 50, [0, 50], [fc ? 0.2 : 0.15, 0]);
                            return <circle cx={px} cy={py} r={ripR} fill="none" stroke={nodeColor} strokeWidth={fc ? 1.2 : 0.8} opacity={ripOp} />;
                          })()}
                          {/* Full chord: extra ripple ring */}
                          {fc && (() => {
                            const ripR2 = playedNodeR + 4 + ((frame + 25) % 60);
                            const ripOp2 = interpolate((frame + 25) % 60, [0, 60], [0.12, 0]);
                            return <circle cx={px} cy={py} r={ripR2} fill="none" stroke={palette.gold} strokeWidth={0.6} opacity={ripOp2} />;
                          })()}
                        </>
                      );
                    })()}
                  </g>
                );
              })()}
            </g>
          );
        })()}

        {/* ── Scale piano overlay — REMOVED, replaced by HUD degree strip ── */}
        {(() => {
          // Old piano removed — the HUD harmonic context strip handles this now
          return null;
          const zp = zoom.zoomProgress;
          const pianoOpacity = 1 - zp * 0.8;
          if (pianoOpacity < 0.05) return null;

          // Build the chromatic range from root to root (13 keys)
          const range = buildPianoRange(activeKey);

          // Count white keys in range to size the piano
          const whiteCount = range.filter(n => !IS_BLACK[n]).length;
          const pianoW = Math.min(W * 0.28, 380);
          const whiteW = pianoW / whiteCount;
          const whiteH = whiteW * 3; // realistic proportions
          const blackW = whiteW * 0.62;
          const blackH = whiteH * 0.6;
          const pianoX = 24;
          const pianoY = H - whiteH - 28;
          const cornerR = whiteW * 0.12;

          // Layout: assign x positions — white keys get sequential slots,
          // black keys overlay between adjacent whites
          const keyLayouts: Array<{
            chromIdx: number; x: number; w: number; h: number;
            isBlack: boolean; inScale: boolean; isRoot: boolean;
            name: string; seqIdx: number;
          }> = [];

          let wIdx = 0;
          for (let si = 0; si < range.length; si++) {
            const n = range[si];
            const inScale = scaleNotes.has(n);
            const isRoot = n === range[0]; // first and last are root
            const name = noteName(n, activeKey);

            if (!IS_BLACK[n]) {
              keyLayouts.push({
                chromIdx: n,
                x: pianoX + wIdx * whiteW,
                w: whiteW,
                h: whiteH,
                isBlack: false,
                inScale,
                isRoot: isRoot || (si === range.length - 1), // octave root too
                name,
                seqIdx: si,
              });
              wIdx++;
            } else {
              // Black key sits on top of the boundary between previous and next white
              const bx = pianoX + wIdx * whiteW - blackW / 2;
              keyLayouts.push({
                chromIdx: n,
                x: bx,
                w: blackW,
                h: blackH,
                isBlack: true,
                inScale,
                isRoot,
                name,
                seqIdx: si,
              });
            }
          }

          const whites = keyLayouts.filter(k => !k.isBlack);
          const blacks = keyLayouts.filter(k => k.isBlack);
          const neonColor = activeMode === 'minor' ? palette.purple : palette.cyan;
          // Scale key fills — like the reference: light blue for white, saturated blue for black
          const whiteScaleFill = 'rgba(170,210,240,0.88)';    // soft light blue
          const whiteRootFill = 'rgba(130,200,235,0.95)';     // slightly stronger for root
          const blackScaleFill = '#2a6090';                    // deep saturated blue (like ref)
          const blackRootFill = '#3a85b8';                     // brighter blue for root
          const whiteDimFill = 'rgba(200,205,215,0.18)';      // very dim grey
          const blackDimFill = 'rgba(15,18,25,0.85)';         // dark, nearly invisible

          return (
            <g opacity={pianoOpacity}>
              {/* Neon glow filter for scale keys */}
              <defs>
                <filter id="piano-neon" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="piano-neon-sm" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Glass backdrop */}
              <rect
                x={pianoX - 8} y={pianoY - 22}
                width={pianoW + 16} height={whiteH + 34}
                rx={6}
                fill="rgba(8,14,24,0.7)"
                stroke={palette.glassBorder}
                strokeWidth={0.5}
              />
              {/* Label */}
              <text
                x={pianoX + pianoW / 2} y={pianoY - 8}
                textAnchor="middle"
                fill={neonColor}
                fontSize={9}
                fontFamily="monospace"
                fontWeight={600}
                opacity={0.6}
              >
                {activeKey} {activeMode}
              </text>

              {/* ── White keys ── */}
              {whites.map((k) => {
                const pulse = k.isRoot ? 0.06 * Math.sin(frame * 0.06) : 0;
                return (
                  <g key={`pw-${k.seqIdx}`}>
                    {/* Neon glow behind scale keys */}
                    {k.inScale && (
                      <rect
                        x={k.x + 1} y={pianoY}
                        width={k.w - 2} height={k.h}
                        rx={cornerR}
                        fill={neonColor}
                        opacity={k.isRoot ? 0.25 + pulse : 0.1}
                        filter="url(#piano-neon)"
                      />
                    )}
                    {/* Key body */}
                    <rect
                      x={k.x + 0.8} y={pianoY}
                      width={k.w - 1.6} height={k.h}
                      rx={cornerR}
                      fill={k.inScale
                        ? (k.isRoot ? whiteRootFill : whiteScaleFill)
                        : whiteDimFill}
                      stroke={k.inScale
                        ? `${neonColor}88`
                        : 'rgba(80,90,110,0.15)'}
                      strokeWidth={k.inScale ? 1 : 0.4}
                    />
                    {/* Note name at bottom of key */}
                    <text
                      x={k.x + k.w / 2} y={pianoY + k.h - 6}
                      textAnchor="middle"
                      fill={k.inScale ? 'rgba(15,25,40,0.75)' : 'rgba(100,116,139,0.2)'}
                      fontSize={k.isRoot ? 12 : 10}
                      fontFamily="monospace"
                      fontWeight={k.isRoot ? 800 : 500}
                    >
                      {k.name}
                    </text>
                  </g>
                );
              })}

              {/* ── Black keys (rendered on top) ── */}
              {blacks.map((k) => {
                const pulse = k.isRoot ? 0.08 * Math.sin(frame * 0.06) : 0;
                return (
                  <g key={`pb-${k.seqIdx}`}>
                    {/* Neon glow behind in-scale black keys */}
                    {k.inScale && (
                      <rect
                        x={k.x - 1} y={pianoY - 1}
                        width={k.w + 2} height={k.h + 2}
                        rx={cornerR * 0.8}
                        fill={neonColor}
                        opacity={k.isRoot ? 0.3 + pulse : 0.18}
                        filter="url(#piano-neon-sm)"
                      />
                    )}
                    {/* Key body */}
                    <rect
                      x={k.x} y={pianoY}
                      width={k.w} height={k.h}
                      rx={cornerR * 0.8}
                      fill={k.inScale
                        ? (k.isRoot ? blackRootFill : blackScaleFill)
                        : blackDimFill}
                      stroke={k.inScale
                        ? `${neonColor}66`
                        : 'rgba(40,50,65,0.3)'}
                      strokeWidth={k.inScale ? 0.8 : 0.3}
                    />
                    {/* Note name on in-scale black key */}
                    {k.inScale && (
                      <text
                        x={k.x + k.w / 2} y={pianoY + k.h - 5}
                        textAnchor="middle"
                        fill="rgba(220,235,255,0.9)"
                        fontSize={8}
                        fontFamily="monospace"
                        fontWeight={700}
                      >
                        {k.name}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Subtle neon accent line under the piano */}
              <line
                x1={pianoX} y1={pianoY + whiteH + 2}
                x2={pianoX + pianoW} y2={pianoY + whiteH + 2}
                stroke={neonColor}
                strokeWidth={0.8}
                opacity={0.12 + 0.04 * Math.sin(frame * 0.04)}
              />
            </g>
          );
        })()}

        {/* ── Famous progression match indicator ─────────────────────── */}
        {chordPath.length >= 3 && (() => {
          const pathNames = chordPath.map(n => n.chord);
          const matches = matchFamousProgressions(pathNames, activeKey, activeMode);
          if (matches.exact.length === 0 && matches.close.length === 0) return null;
          const firstNode = chordPath[0];
          const displayY = PATH_START_Y + 45 * scale;
          const fs = 5 * scale;
          return (
            <g>
              {matches.exact.map((m, i) => (
                <g key={`match-${i}`}>
                  <rect x={firstNode.x - 4 * scale} y={displayY + i * 14 * scale - 5 * scale}
                    width={180 * scale} height={12 * scale} rx={3}
                    fill="rgba(251,191,36,0.08)" stroke={palette.gold} strokeWidth={0.5} opacity={0.6}
                  />
                  <text x={firstNode.x + 2 * scale} y={displayY + i * 14 * scale + 1.5 * scale}
                    fill={palette.gold} fontSize={fs} fontFamily="monospace" fontWeight={700} opacity={0.8}
                  >{m.name}{m.artist ? ` — ${m.artist}` : ''}</text>
                  <text x={firstNode.x + 170 * scale} y={displayY + i * 14 * scale + 1.5 * scale}
                    textAnchor="end" fill={palette.textDim} fontSize={fs * 0.8}
                    fontFamily="monospace" opacity={0.5}
                  >{m.genre}</text>
                </g>
              ))}
              {matches.close.map((c, i) => (
                <g key={`close-${i}`}>
                  <text x={firstNode.x} y={displayY + (matches.exact.length + i) * 14 * scale + 1.5 * scale}
                    fill={palette.textDim} fontSize={fs * 0.9} fontFamily="monospace" opacity={0.5}
                  >≈ {c.prog.name}{c.prog.artist ? ` — ${c.prog.artist}` : ''} (1 chord away)</text>
                </g>
              ))}
            </g>
          );
        })()}

        {/* ── Voice leading hover tooltip ─────────────────────────── */}
        {hoveredVL && (() => {
          const tipW = 180 * scale;
          const lh = 7.5 * scale;
          const fs = 5.5 * scale;
          const tipH = (hoveredVL.pairs.length + 2) * lh + 8 * scale;
          let tipX = hoveredVL.x - tipW / 2;
          let tipY = hoveredVL.y - tipH;

          return (
            <g>
              <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={4}
                fill="rgba(8,14,24,0.94)" stroke={palette.glassBorder} strokeWidth={0.5}
              />
              {/* Accent bar */}
              <rect x={tipX} y={tipY} width={2.5} height={tipH} rx={1}
                fill={palette.purple} opacity={0.6}
              />
              {/* Header */}
              <text x={tipX + 8} y={tipY + lh + 1}
                fill={palette.text} fontSize={fs * 1.2}
                fontFamily="monospace" fontWeight={800}
              >
                {hoveredVL.fromChord} → {hoveredVL.toChord}
              </text>
              <text x={tipX + 8} y={tipY + lh * 2 + 1}
                fill={palette.textDim} fontSize={fs * 0.85}
                fontFamily="monospace" opacity={0.5}
              >Voice Leading</text>
              {/* Each pair */}
              {hoveredVL.pairs.map((p, i) => (
                <g key={`vl-tip-${i}`}>
                  {/* Dot indicator */}
                  <circle cx={tipX + 12} cy={tipY + lh * (i + 3) + 1}
                    r={2 * scale} fill={p.common ? palette.cyan : palette.purple}
                  />
                  <text x={tipX + 20} y={tipY + lh * (i + 3) + 2.5}
                    fill={p.common ? palette.cyan : palette.purple}
                    fontSize={fs} fontFamily="monospace" fontWeight={600}
                    opacity={0.9}
                  >
                    {p.common
                      ? `${p.fromName} — held`
                      : `${p.fromName} → ${p.toName}  ${p.stepDesc}`
                    }
                  </text>
                </g>
              ))}
            </g>
          );
        })()}

        {/* ── Branch hover tooltip ──────────────────────────────────── */}
        {hoveredBranch && BRANCH_TOOLTIPS[hoveredBranch.roman] && (() => {
          const tip = BRANCH_TOOLTIPS[hoveredBranch.roman];
          const { tx, ty, px: parentX, py: parentY } = hoveredBranch;
          const tipW = 160 * scale;
          const tipH = 62 * scale;
          const fs = 5.5 * scale;
          const lh = 7.5 * scale;
          const gap = 16 * scale;

          // Direction away from parent node
          const dx = tx - parentX;
          const dy = ty - parentY;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = dx / len;
          const ny = dy / len;

          // Place tooltip along the away-direction, offset from the branch node
          let tipX = tx + nx * gap;
          let tipY = ty + ny * gap;

          // Anchor adjustment: if pointing left, shift left by width; center vertically
          if (nx < -0.3) tipX -= tipW;
          else if (Math.abs(nx) <= 0.3) tipX -= tipW / 2;
          if (ny < -0.3) tipY -= tipH;
          else if (Math.abs(ny) <= 0.3) tipY -= tipH / 2;

          return (
            <g>
              {/* Backdrop */}
              <rect
                x={tipX} y={tipY}
                width={tipW} height={tipH}
                rx={4}
                fill="rgba(8,14,24,0.92)"
                stroke={palette.glassBorder}
                strokeWidth={0.5}
              />
              {/* Accent bar */}
              <rect
                x={tipX} y={tipY}
                width={2.5} height={tipH}
                rx={1}
                fill={palette.cyan}
                opacity={0.6}
              />
              {/* Roman numeral header */}
              <text x={tipX + 8} y={tipY + lh + 2}
                fill={palette.cyan} fontSize={fs * 1.3}
                fontFamily="monospace" fontWeight={800}
              >
                {tip.roman}
              </text>
              {/* Description */}
              <text x={tipX + 8} y={tipY + lh * 2 + 3}
                fill={palette.text} fontSize={fs}
                fontFamily="monospace" fontWeight={400} opacity={0.85}
              >
                {tip.description}
              </text>
              {/* Tension */}
              <text x={tipX + 8} y={tipY + lh * 3 + 4}
                fill={palette.gold} fontSize={fs * 0.9}
                fontFamily="monospace" opacity={0.7}
              >
                {tip.tension}
              </text>
              {/* Voice leading */}
              <text x={tipX + 8} y={tipY + lh * 4 + 5}
                fill={palette.purple} fontSize={fs * 0.9}
                fontFamily="monospace" opacity={0.6}
              >
                {tip.voiceLeading}
              </text>
              {/* Genres */}
              <text x={tipX + 8} y={tipY + lh * 5 + 6}
                fill={palette.textDim} fontSize={fs * 0.85}
                fontFamily="monospace" opacity={0.45}
              >
                {tip.genres}
              </text>
            </g>
          );
        })()}
      </svg>

      {/* ── HUD Harmonic Context Strip — slides down from top when zoomed ── */}
      {(() => {
        const zp = zoom.zoomProgress;
        const hudProgress = Math.max(0, Math.min(1, (zp - 0.25) / 0.4));
        if (hudProgress < 0.01) return null;

        // Cinematic slide-down from top
        const slideY = interpolate(hudProgress, [0, 1], [-30, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const fadeIn = interpolate(hudProgress, [0, 0.3, 1], [0, 0.5, 0.95], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const neonColor = activeMode === 'minor' ? palette.purple : palette.cyan;
        const pulse = Math.sin(frame * 0.06) * 0.08;

        // Build diatonic chords for the current key
        const norm = ENHARMONIC[activeKey] ?? activeKey;
        const rootIdx = CHROMATIC.indexOf(norm);
        const intervals = activeMode === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
        const qualities = activeMode === 'major' ? MAJOR_QUALITIES : MINOR_QUALITIES;
        const romansMajor = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
        const romansMinor = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
        const romans = activeMode === 'major' ? romansMajor : romansMinor;
        const useFlats = FLAT_KEYS.has(activeKey);
        const names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;

        const degrees = intervals.map((interval, di) => {
          const noteIdx = (rootIdx + interval) % 12;
          const chordName = names[noteIdx] + qualities[di];
          const normalized = normalizeChordForMatch(chordName);
          const func = chordFunction(chordName, activeKey);
          const funcColor = FUNCTION_COLORS[func];
          // Check if this chord is in the current path
          const inPath = chordPath.some(n => n.chord === normalized);
          // Check if this is the latest chord
          const isLatest = chordPath.length > 0 && chordPath[chordPath.length - 1].chord === normalized;
          return { roman: romans[di], chordName, normalized, funcColor, func, inPath, isLatest, degreeIdx: di };
        });

        // Layout
        const stripW = Math.min(W * 0.55, 640);
        const cellW = stripW / 7;
        const stripH = 42;
        const stripX = (W - stripW) / 2;
        const stripY = 12;
        const dotR = 5;
        const dotY = stripY + 16;
        const romanY = stripY + 32;
        const chordY = stripY + 10;

        return (
          <svg
            width={W} height={H}
            viewBox={`0 0 ${W} ${H}`}
            style={{
              position: 'absolute', top: 0, left: 0,
              pointerEvents: 'none',
              opacity: fadeIn,
              transform: `translateY(${slideY}px)`,
            }}
          >
            <defs>
              <filter id="hud-dot-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Glass backdrop */}
            <rect
              x={stripX - 16} y={stripY - 6}
              width={stripW + 32} height={stripH + 12}
              rx={6}
              fill="rgba(6,10,18,0.82)"
              stroke={neonColor}
              strokeWidth={0.5}
              strokeOpacity={0.15}
            />
            {/* Top aurora gradient line */}
            <line
              x1={stripX - 16} y1={stripY - 6}
              x2={stripX + stripW + 16} y2={stripY - 6}
              stroke={neonColor}
              strokeWidth={1}
              opacity={0.2}
            />

            {/* Key label — left side */}
            <text
              x={stripX - 8} y={stripY + stripH / 2 + 1}
              textAnchor="end"
              fill={neonColor}
              fontSize={11}
              fontFamily="monospace"
              fontWeight={700}
              opacity={0.6}
            >
              {activeKey} {activeMode}
            </text>

            {/* Degree cells */}
            {degrees.map((d, i) => {
              const cx = stripX + i * cellW + cellW / 2;
              const isActive = d.inPath || d.isLatest;
              const glowOp = d.isLatest ? 0.4 + pulse : d.inPath ? 0.2 : 0;

              return (
                <g key={`deg-${i}`}>
                  {/* Neon glow behind active dots */}
                  {isActive && (
                    <circle
                      cx={cx} cy={dotY} r={dotR + 4}
                      fill={d.isLatest ? palette.gold : d.funcColor}
                      opacity={glowOp}
                      filter="url(#hud-dot-glow)"
                    />
                  )}
                  {/* Dot */}
                  <circle
                    cx={cx} cy={dotY}
                    r={d.isLatest ? dotR + 1.5 : isActive ? dotR : dotR - 1.5}
                    fill={d.isLatest ? palette.gold : isActive ? d.funcColor : 'transparent'}
                    stroke={isActive ? 'none' : d.funcColor}
                    strokeWidth={0.8}
                    opacity={isActive ? 1 : 0.3}
                  />
                  {/* Chord name above dot */}
                  <text
                    x={cx} y={chordY}
                    textAnchor="middle"
                    fill={d.isLatest ? palette.gold : isActive ? d.funcColor : palette.textDim}
                    fontSize={8}
                    fontFamily="monospace"
                    fontWeight={d.isLatest ? 800 : isActive ? 700 : 500}
                    opacity={isActive ? 0.95 : 0.35}
                  >
                    {d.chordName}
                  </text>
                  {/* Roman numeral below dot */}
                  <text
                    x={cx} y={romanY}
                    textAnchor="middle"
                    fill={d.isLatest ? palette.gold : isActive ? palette.text : palette.textDim}
                    fontSize={7}
                    fontFamily="monospace"
                    fontWeight={d.isLatest ? 700 : 500}
                    opacity={isActive ? 0.7 : 0.25}
                  >
                    {d.roman}
                  </text>
                </g>
              );
            })}
          </svg>
        );
      })()}
    </AbsoluteFill>
  );
};

/** Export MIDI file from a chord path */
export function exportMidi(chords: string[]) {
  if (chords.length === 0) return;
  const data = buildMidiFile(chords);
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '');
  downloadBlob(data, `chord-path-${timestamp}.mid`, 'audio/midi');
}

/** Get a weighted-random harmonically valid next chord */
export function getSurpriseChord(
  lastChord: string | null,
  key: string,
  mode: 'major' | 'minor',
): string {
  const norm = ENHARMONIC[key] ?? key;
  const rootIdx = CHROMATIC.indexOf(norm);
  if (rootIdx < 0) return key;

  // Weighted scale degree choices (higher weight = more likely)
  const weights: [string, number][] = mode === 'major'
    ? [['I', 3], ['ii', 4], ['iii', 2], ['IV', 5], ['V', 5], ['vi', 4], ['bVII', 2], ['bVI', 1], ['bIII', 1]]
    : [['i', 3], ['III', 3], ['iv', 4], ['v', 2], ['V', 4], ['bVI', 3], ['bVII', 4], ['bII', 1]];

  // Remove the last chord from options to avoid repetition
  const lastNorm = lastChord ? normalizeChordForMatch(lastChord) : null;
  const candidates = weights
    .map(([roman, w]) => ({ chord: romanToChord(roman, key, mode), weight: w }))
    .filter(c => normalizeChordForMatch(c.chord) !== lastNorm);

  const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * totalWeight;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return c.chord;
  }
  return candidates[candidates.length - 1]?.chord ?? key;
}

/** Get the list of famous progressions for the import UI */
export function getFamousProgressions(): FamousProgression[] {
  return FAMOUS_PROGRESSIONS;
}

/** Resolve a famous progression to actual chord names in a key */
export function resolveProgression(
  prog: FamousProgression,
  key: string,
  mode: 'major' | 'minor',
): string[] {
  return prog.chords.map(r => romanToChord(r, key, mode));
}

/** Get MIDI notes for a chord (for playback via bridge) */
export function chordToMidiNotes(chord: string): number[] {
  return chordToMidi(chord);
}
