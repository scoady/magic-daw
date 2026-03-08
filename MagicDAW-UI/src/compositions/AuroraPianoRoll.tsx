import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from 'remotion';

const aurora = {
  bg: '#0d1520',
  teal: '#2dd4bf',
  green: '#34d399',
  cyan: '#67e8f9',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  glass: 'rgba(120,200,220,0.06)',
  glassBorder: 'rgba(120,200,220,0.12)',
};

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface MidiNote {
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
}

export interface AuroraPianoRollProps {
  title?: string;
  currentChord?: string;
  musicalKey?: string;
  bpm?: number;
}

const W = 800;
const H = 400;
const PIANO_X = 40;
const PIANO_W = 24;
const ROLL_X = PIANO_X + PIANO_W;
const ROLL_W = W - ROLL_X - 20;
const ROLL_Y = 20;
const ROLL_H = H - 60;
const BEATS = 8;
const KEYS = 24;
const KEY_H = ROLL_H / KEYS;
const BEAT_W = ROLL_W / BEATS;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function buildKeyboard() {
  const rows: { name: string; isBlack: boolean; pitch: number }[] = [];
  for (let octave = 3; octave <= 4; octave++) {
    for (let n = 0; n < 12; n++) {
      rows.push({
        name: `${NOTE_NAMES[n]}${octave}`,
        isBlack: [1, 3, 6, 8, 10].includes(n),
        pitch: (octave - 3) * 12 + n,
      });
    }
  }
  return rows.reverse();
}

function generateNotes(rand: () => number): MidiNote[] {
  const notes: MidiNote[] = [];
  const chordTones = [4, 7, 11, 14, 18];
  chordTones.forEach((pitch, i) => {
    notes.push({ pitch, start: 0.0 + i * 0.12, duration: 2.5, velocity: 0.7 + rand() * 0.2 });
    notes.push({ pitch, start: 3.0 + i * 0.1, duration: 2.0, velocity: 0.6 + rand() * 0.2 });
  });
  const melody: [number, number, number][] = [
    [18, 0.5, 0.8], [19, 1.5, 0.5], [21, 2.0, 1.0], [23, 3.5, 0.6],
    [21, 4.2, 0.7], [19, 5.0, 0.9], [18, 5.8, 0.5], [16, 6.5, 1.2],
  ];
  melody.forEach(([pitch, start, dur]) => {
    notes.push({ pitch, start, duration: dur, velocity: 0.85 + rand() * 0.15 });
  });
  const bass: [number, number, number][] = [
    [4, 0, 1.8], [0, 2.0, 1.5], [4, 4.0, 1.8], [7, 6.0, 1.5],
  ];
  bass.forEach(([pitch, start, dur]) => {
    notes.push({ pitch, start, duration: dur, velocity: 0.5 + rand() * 0.15 });
  });
  return notes;
}

function velocityColor(v: number): string {
  if (v >= 0.85) return aurora.pink;
  if (v >= 0.7) return aurora.cyan;
  if (v >= 0.5) return aurora.green;
  return aurora.teal;
}

export const AuroraPianoRoll: React.FC<AuroraPianoRollProps> = ({
  title = 'MAGIC DAW',
  currentChord = 'Em9',
  musicalKey = 'Em',
  bpm = 92,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const keyboard = useMemo(() => buildKeyboard(), []);
  const midiNotes = useMemo(() => generateNotes(seededRandom(137)), []);

  const gridEntrance = spring({ frame: frame - 5, fps, config: { damping: 60, stiffness: 40 } });

  const playheadProgress = frame > 30
    ? interpolate(frame, [30, 200], [0, 1], { extrapolateRight: 'clamp' })
    : 0;
  const playheadX = ROLL_X + playheadProgress * ROLL_W;

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      <svg width={W} height={H}>
        <defs>
          <filter id="pr-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Piano keyboard */}
        {keyboard.map((key, i) => {
          const y = ROLL_Y + i * KEY_H;
          return (
            <g key={key.name} opacity={gridEntrance}>
              <rect x={PIANO_X} y={y}
                width={key.isBlack ? 16 : PIANO_W}
                height={KEY_H - 0.5}
                fill={key.isBlack ? 'rgba(10,15,25,0.8)' : 'rgba(200,220,230,0.08)'}
                stroke={aurora.glassBorder} strokeWidth={0.3} rx={1} />
              {!key.isBlack && (
                <text x={PIANO_X - 3} y={y + KEY_H * 0.65}
                  textAnchor="end" fill={aurora.textDim}
                  fontSize={6} fontFamily="monospace" opacity={0.5}>
                  {key.name}
                </text>
              )}
            </g>
          );
        })}

        {/* Grid */}
        <g opacity={gridEntrance}>
          {keyboard.map((_, i) => (
            <line key={`hr-${i}`}
              x1={ROLL_X} y1={ROLL_Y + i * KEY_H}
              x2={ROLL_X + ROLL_W} y2={ROLL_Y + i * KEY_H}
              stroke={aurora.glassBorder} strokeWidth={0.3} />
          ))}
          {Array.from({ length: BEATS + 1 }, (_, i) => (
            <line key={`vb-${i}`}
              x1={ROLL_X + i * BEAT_W} y1={ROLL_Y}
              x2={ROLL_X + i * BEAT_W} y2={ROLL_Y + ROLL_H}
              stroke={i % 4 === 0 ? 'rgba(120,200,220,0.2)' : aurora.glassBorder}
              strokeWidth={i % 4 === 0 ? 0.8 : 0.3} />
          ))}
        </g>

        {/* Notes */}
        {midiNotes.map((note, i) => {
          const rowIdx = KEYS - 1 - note.pitch;
          if (rowIdx < 0 || rowIdx >= KEYS) return null;
          const noteY = ROLL_Y + rowIdx * KEY_H + 1;
          const noteX = ROLL_X + note.start * BEAT_W;
          const noteW = note.duration * BEAT_W - 1;
          const noteH = KEY_H - 2;
          const entranceFrame = 10 + i * 1.5;
          const slideIn = spring({
            frame: frame - entranceFrame, fps,
            config: { damping: 40, stiffness: 60, mass: 0.6 },
          });
          const color = velocityColor(note.velocity);
          return (
            <g key={`note-${i}`} opacity={slideIn * (note.velocity < 0.5 ? 0.5 : 1)}>
              <rect x={noteX} y={noteY} width={noteW} height={noteH}
                rx={2} fill={color} opacity={0.85} />
              <rect x={noteX} y={noteY} width={2} height={noteH}
                rx={1} fill="#fff" opacity={0.3} />
            </g>
          );
        })}

        {/* Playhead */}
        {frame > 30 && (
          <g>
            <line x1={playheadX} y1={ROLL_Y} x2={playheadX} y2={ROLL_Y + ROLL_H}
              stroke={aurora.cyan} strokeWidth={1.5} filter="url(#pr-glow)" opacity={0.9} />
            <polygon points={`${playheadX - 4},${ROLL_Y} ${playheadX + 4},${ROLL_Y} ${playheadX},${ROLL_Y + 6}`}
              fill={aurora.cyan} opacity={0.8} />
          </g>
        )}

        {/* Spectrum at bottom */}
        {Array.from({ length: 32 }, (_, i) => {
          const amplitude = Math.sin(frame * 0.1 + i * 0.3) * 0.5 + 0.5;
          const barH = amplitude * 20;
          const barW = (W - 40) / 32;
          return (
            <rect key={`spec-${i}`}
              x={20 + i * barW} y={H - barH - 2}
              width={barW - 1} height={barH}
              rx={1}
              fill={i < 10 ? aurora.teal : i < 20 ? aurora.purple : aurora.pink}
              opacity={0.4 + amplitude * 0.3} />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
