// Chromatic note names (sharps)
export const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Enharmonic equivalences
export const ENHARMONIC: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'Gb': 'F#',
  'Cb': 'B', 'Fb': 'E', 'B#': 'C', 'E#': 'F',
};

// Scale interval patterns
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

// Diatonic chord qualities for each scale degree
export const MAJOR_QUALITIES = ['', 'm', 'm', '', '', 'm', 'dim'] as const;
export const MINOR_QUALITIES = ['m', 'dim', '', 'm', 'm', '', ''] as const;

// Keys that use flats in their spelling
export const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db']);

// All 12 keys in circle-of-fifths order
export const ALL_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];

// Flat chromatic spelling for flat keys
export const CHROMATIC_FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Normalize an enharmonic note name to its sharp equivalent */
export function normalizeRoot(n: string): string { return ENHARMONIC[n] ?? n; }

/** Get the chroma (0-11) index for a root note name */
export function rootToChroma(root: string): number { return CHROMATIC.indexOf(normalizeRoot(root)); }

/** Infer the diatonic chord (e.g. "Am", "G", "Bdim") for a MIDI note in a given key and mode */
export function inferDiatonicChord(midiNote: number, key: string, mode: 'major' | 'minor'): string {
  const rootChroma = rootToChroma(key);
  const noteChroma = midiNote % 12;
  const useFlats = FLAT_KEYS.has(key);
  const chordRoot = useFlats ? CHROMATIC_FLATS[noteChroma] : CHROMATIC[noteChroma];
  if (rootChroma < 0) return chordRoot;
  const interval = ((noteChroma - rootChroma) % 12 + 12) % 12;
  const scaleIntervals = mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  const qualities = mode === 'major' ? MAJOR_QUALITIES : MINOR_QUALITIES;
  const degreeIdx = scaleIntervals.indexOf(interval);
  if (degreeIdx < 0) return chordRoot;
  return chordRoot + qualities[degreeIdx];
}

/** Common bridge payload type for chord detection */
export interface ChordDetectedPayload {
  chord: string | null;
  root?: string;
  quality?: string;
  notes?: number[];
}
