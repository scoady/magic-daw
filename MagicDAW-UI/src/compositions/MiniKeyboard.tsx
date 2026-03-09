import React from 'react';

// ── Chord voicing engine ──────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ENHARMONIC: Record<string, string> = {
  Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B',
};

function normNote(n: string): number {
  const mapped = ENHARMONIC[n] ?? n;
  const idx = NOTE_NAMES.indexOf(mapped);
  return idx >= 0 ? idx : 0;
}

/** Scale intervals from root (in semitones) */
const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

/** Diatonic chord qualities per scale degree */
const DIATONIC_MAJOR = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'] as const;
const DIATONIC_MINOR = ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'] as const;

/** Chord intervals from root (in semitones) */
const CHORD_INTERVALS: Record<string, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
};

/** Degree labels for major and minor keys */
export const DEGREE_LABELS_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
export const DEGREE_LABELS_MINOR = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

/** Get the pitch classes (0-11) for a diatonic chord at a given degree in a key */
export function getDiatonicChordNotes(
  rootName: string,
  mode: 'major' | 'minor',
  degree: number, // 0-6
): number[] {
  const rootPc = normNote(rootName);
  const scale = SCALE_INTERVALS[mode];
  const qualities = mode === 'major' ? DIATONIC_MAJOR : DIATONIC_MINOR;
  const chordRoot = (rootPc + scale[degree]) % 12;
  const quality = qualities[degree];
  const intervals = CHORD_INTERVALS[quality] ?? [0, 4, 7];
  return intervals.map((i) => (chordRoot + i) % 12);
}

/** Get chord name for a diatonic degree */
export function getDiatonicChordName(
  rootName: string,
  mode: 'major' | 'minor',
  degree: number,
): string {
  const rootPc = normNote(rootName);
  const scale = SCALE_INTERVALS[mode];
  const qualities = mode === 'major' ? DIATONIC_MAJOR : DIATONIC_MINOR;
  const chordRootPc = (rootPc + scale[degree]) % 12;
  const chordRootName = NOTE_NAMES[chordRootPc];
  const q = qualities[degree];
  if (q === 'maj') return chordRootName;
  if (q === 'min') return chordRootName + 'm';
  if (q === 'dim') return chordRootName + '°';
  return chordRootName;
}

// ── SVG Mini Keyboard ─────────────────────────────────────────────────────

const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const BLACK_KEYS = [1, 3, 6, 8, 10]; // C# D# F# G# A#
const BLACK_KEY_X = [1, 2, 4, 5, 6]; // position relative to white key index (0-based)

interface MiniKeyboardProps {
  /** SVG x position of top-left corner */
  x: number;
  /** SVG y position of top-left corner */
  y: number;
  /** Total width of the keyboard */
  width: number;
  /** Total height of the keyboard */
  height: number;
  /** Pitch classes to highlight (0-11, where 0=C) */
  highlightNotes: number[];
  /** Color for highlighted keys */
  highlightColor?: string;
  /** Color for highlighted black keys (defaults to highlightColor) */
  highlightBlackColor?: string;
  /** Opacity of the entire keyboard */
  opacity?: number;
}

/** Renders a 1-octave mini piano keyboard as SVG elements */
export const MiniKeyboard: React.FC<MiniKeyboardProps> = ({
  x,
  y,
  width,
  height,
  highlightNotes,
  highlightColor = '#67e8f9',
  highlightBlackColor,
  opacity = 1,
}) => {
  const whiteW = width / 7;
  const blackW = whiteW * 0.6;
  const blackH = height * 0.58;
  const highlightSet = new Set(highlightNotes);
  const bkColor = highlightBlackColor ?? highlightColor;

  return (
    <g opacity={opacity}>
      {/* White keys */}
      {WHITE_KEYS.map((pc, i) => {
        const isLit = highlightSet.has(pc);
        return (
          <rect
            key={`w-${pc}`}
            x={x + i * whiteW}
            y={y}
            width={whiteW - 0.5}
            height={height}
            rx={1}
            fill={isLit ? highlightColor : 'rgba(255,255,255,0.08)'}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={0.5}
            opacity={isLit ? 0.9 : 0.5}
          />
        );
      })}
      {/* Black keys */}
      {BLACK_KEYS.map((pc, i) => {
        const isLit = highlightSet.has(pc);
        const xPos = BLACK_KEY_X[i];
        return (
          <rect
            key={`b-${pc}`}
            x={x + xPos * whiteW - blackW / 2 + whiteW}
            y={y}
            width={blackW}
            height={blackH}
            rx={1}
            fill={isLit ? bkColor : 'rgba(0,0,0,0.7)'}
            stroke={isLit ? bkColor : 'rgba(255,255,255,0.08)'}
            strokeWidth={0.5}
            opacity={isLit ? 0.95 : 0.7}
          />
        );
      })}
    </g>
  );
};

// ── Diatonic Chords Panel ─────────────────────────────────────────────────

interface DiatonicChordsPanelProps {
  /** SVG x position */
  x: number;
  /** SVG y position */
  y: number;
  /** Active key root name (e.g. "C", "F#") */
  activeKey: string;
  /** Major or minor */
  activeMode: 'major' | 'minor';
  /** Accent color for highlights */
  accentColor?: string;
  /** Secondary accent for minor chords */
  secondaryColor?: string;
  /** Text color */
  textColor?: string;
  /** Dim text color */
  textDimColor?: string;
  /** Keyboard width per chord */
  kbWidth?: number;
  /** Keyboard height per chord */
  kbHeight?: number;
  /** Vertical spacing between chords */
  spacing?: number;
  /** Overall opacity */
  opacity?: number;
}

/** Renders all 7 diatonic chords with mini keyboards */
export const DiatonicChordsPanel: React.FC<DiatonicChordsPanelProps> = ({
  x,
  y,
  activeKey,
  activeMode,
  accentColor = '#67e8f9',
  secondaryColor = '#a78bfa',
  textColor = '#e2e8f0',
  textDimColor = '#94a3b8',
  kbWidth = 84,
  kbHeight = 28,
  spacing = 52,
  opacity = 1,
}) => {
  const degreeLabels = activeMode === 'major' ? DEGREE_LABELS_MAJOR : DEGREE_LABELS_MINOR;
  const qualities = activeMode === 'major' ? DIATONIC_MAJOR : DIATONIC_MINOR;

  return (
    <g opacity={opacity}>
      {/* Header */}
      <text
        x={x + kbWidth / 2}
        y={y - 10}
        textAnchor="middle"
        fill={textDimColor}
        fontSize={9}
        fontFamily="'SF Pro Display', system-ui"
        letterSpacing="0.15em"
      >
        DIATONIC CHORDS
      </text>

      {Array.from({ length: 7 }, (_, deg) => {
        const chordName = getDiatonicChordName(activeKey, activeMode, deg);
        const notes = getDiatonicChordNotes(activeKey, activeMode, deg);
        const quality = qualities[deg];
        const isMinor = quality === 'min' || quality === 'dim';
        const color = isMinor ? secondaryColor : accentColor;
        const cy = y + deg * spacing;

        return (
          <g key={`dc-${deg}`}>
            {/* Degree numeral */}
            <text
              x={x - 8}
              y={cy + 6}
              textAnchor="end"
              fill={textDimColor}
              fontSize={10}
              fontFamily="'SF Pro Display', system-ui"
              opacity={0.6}
            >
              {degreeLabels[deg]}
            </text>

            {/* Chord name */}
            <text
              x={x + kbWidth / 2}
              y={cy - 2}
              textAnchor="middle"
              fill={color}
              fontSize={13}
              fontWeight={600}
              fontFamily="'Georgia', 'Palatino', serif"
            >
              {chordName}
            </text>

            {/* Mini keyboard */}
            <MiniKeyboard
              x={x}
              y={cy + 4}
              width={kbWidth}
              height={kbHeight}
              highlightNotes={notes}
              highlightColor={color}
              highlightBlackColor={color}
            />
          </g>
        );
      })}
    </g>
  );
};
