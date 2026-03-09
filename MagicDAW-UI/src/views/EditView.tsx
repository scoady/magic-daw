import React, { useState, useMemo } from 'react';
import { MousePointer, Pencil, Eraser } from 'lucide-react';
import { aurora, mockPianoRollNotes, hexToRgba } from '../mockData';
import type { MidiNote } from '../types/daw';
import type { ActiveMidiNote } from '../bridge';

interface EditViewProps {
  trackColor?: string;
  liveActiveNotes?: ActiveMidiNote[];
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OCTAVE_LOW = 3;
const OCTAVE_HIGH = 6;
const TOTAL_KEYS = (OCTAVE_HIGH - OCTAVE_LOW + 1) * 12;
const KEY_HEIGHT = 14;
const PIANO_WIDTH = 48;
const BEATS = 8;
const VELOCITY_LANE_HEIGHT = 60;

type Tool = 'select' | 'draw' | 'erase';

function isBlackKey(noteIndex: number): boolean {
  return [1, 3, 6, 8, 10].includes(noteIndex % 12);
}

function noteToName(midi: number): string {
  const note = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[note]}${octave}`;
}

function velocityColor(v: number): string {
  if (v >= 110) return aurora.pink;
  if (v >= 90) return aurora.cyan;
  if (v >= 70) return aurora.green;
  return aurora.teal;
}

export const EditView: React.FC<EditViewProps> = ({ trackColor = aurora.cyan, liveActiveNotes = [] }) => {
  const [tool, setTool] = useState<Tool>('select');
  const [hoveredNote, setHoveredNote] = useState<number | null>(null);

  // Map MIDI notes to grid coordinates
  const gridHeight = TOTAL_KEYS * KEY_HEIGHT;
  const midiMin = OCTAVE_LOW * 12 + 12; // C3 = MIDI 48
  const midiMax = (OCTAVE_HIGH + 1) * 12 + 12; // C7 = MIDI 96

  const notes = useMemo(() => {
    return mockPianoRollNotes.filter(
      (n) => n.pitch >= midiMin && n.pitch < midiMax,
    );
  }, [midiMin, midiMax]);

  // Build a set of currently active (held) MIDI note pitches for keyboard highlighting
  const activePitchSet = useMemo(() => {
    const set = new Set<number>();
    for (const n of liveActiveNotes) {
      set.add(n.note);
    }
    return set;
  }, [liveActiveNotes]);

  const tools: { id: Tool; icon: React.ReactNode; label: string }[] = [
    { id: 'select', icon: <MousePointer size={12} />, label: 'Select' },
    { id: 'draw', icon: <Pencil size={12} />, label: 'Draw' },
    { id: 'erase', icon: <Eraser size={12} />, label: 'Erase' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-3 py-1 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {tools.map((t) => (
          <button
            key={t.id}
            className={`glass-button flex items-center gap-1.5 px-2 py-1 ${
              tool === t.id ? 'active' : ''
            }`}
            onClick={() => setTool(t.id)}
          >
            {t.icon}
            <span style={{ fontSize: 8 }}>{t.label}</span>
          </button>
        ))}

        <div className="flex-1" />

        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
          Quantize: 1/16
        </span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>|</span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
          Snap: On
        </span>
      </div>

      {/* Piano Roll */}
      <div className="flex-1 overflow-auto flex">
        <svg
          width={PIANO_WIDTH + BEATS * 100 + 20}
          height={gridHeight + VELOCITY_LANE_HEIGHT + 10}
        >
          <defs>
            <filter id="note-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="live-note-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Piano keyboard */}
          {Array.from({ length: TOTAL_KEYS }, (_, i) => {
            const noteIdx = TOTAL_KEYS - 1 - i;
            const midiNote = midiMin + noteIdx;
            const y = i * KEY_HEIGHT;
            const black = isBlackKey(noteIdx);
            const isC = noteIdx % 12 === 0;
            const isActive = activePitchSet.has(midiNote);

            return (
              <g key={`key-${i}`}>
                <rect
                  x={0}
                  y={y}
                  width={black ? 32 : PIANO_WIDTH}
                  height={KEY_HEIGHT - 0.5}
                  fill={
                    isActive
                      ? aurora.cyan
                      : black
                        ? 'rgba(10,15,25,0.85)'
                        : 'rgba(200,220,230,0.08)'
                  }
                  stroke="var(--border)"
                  strokeWidth={0.3}
                  rx={1}
                  opacity={isActive ? 0.9 : 1}
                  filter={isActive ? 'url(#live-note-glow)' : undefined}
                />
                {!black && (
                  <text
                    x={PIANO_WIDTH - 4}
                    y={y + KEY_HEIGHT * 0.7}
                    textAnchor="end"
                    fill={isActive ? '#ffffff' : 'var(--text-muted)'}
                    fontSize={7}
                    fontFamily="var(--font-mono)"
                    opacity={isActive ? 1 : isC ? 0.8 : 0.4}
                  >
                    {noteToName(midiNote)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Grid area */}
          {/* Horizontal lines */}
          {Array.from({ length: TOTAL_KEYS }, (_, i) => (
            <line
              key={`hg-${i}`}
              x1={PIANO_WIDTH}
              y1={i * KEY_HEIGHT}
              x2={PIANO_WIDTH + BEATS * 100}
              y2={i * KEY_HEIGHT}
              stroke={
                isBlackKey(TOTAL_KEYS - 1 - i)
                  ? 'rgba(120,200,220,0.03)'
                  : 'rgba(120,200,220,0.06)'
              }
              strokeWidth={0.3}
            />
          ))}

          {/* Alternating row shading for black keys */}
          {Array.from({ length: TOTAL_KEYS }, (_, i) => {
            const noteIdx = TOTAL_KEYS - 1 - i;
            if (!isBlackKey(noteIdx)) return null;
            return (
              <rect
                key={`shade-${i}`}
                x={PIANO_WIDTH}
                y={i * KEY_HEIGHT}
                width={BEATS * 100}
                height={KEY_HEIGHT}
                fill="rgba(0,0,0,0.15)"
              />
            );
          })}

          {/* Live MIDI input — row highlights for active notes */}
          {liveActiveNotes.map((activeNote) => {
            if (activeNote.note < midiMin || activeNote.note >= midiMax) return null;
            const rowIdx = TOTAL_KEYS - 1 - (activeNote.note - midiMin);
            const y = rowIdx * KEY_HEIGHT;
            return (
              <rect
                key={`live-row-${activeNote.note}`}
                x={PIANO_WIDTH}
                y={y}
                width={BEATS * 100}
                height={KEY_HEIGHT}
                fill={aurora.cyan}
                opacity={0.12}
              />
            );
          })}

          {/* Vertical beat lines */}
          {Array.from({ length: BEATS + 1 }, (_, i) => (
            <line
              key={`vb-${i}`}
              x1={PIANO_WIDTH + i * 100}
              y1={0}
              x2={PIANO_WIDTH + i * 100}
              y2={gridHeight}
              stroke={
                i % 4 === 0
                  ? 'rgba(120,200,220,0.2)'
                  : 'rgba(120,200,220,0.08)'
              }
              strokeWidth={i % 4 === 0 ? 0.8 : 0.4}
            />
          ))}

          {/* Sub-beat lines (16ths) */}
          {Array.from({ length: BEATS * 4 }, (_, i) => {
            if (i % 4 === 0) return null;
            const x = PIANO_WIDTH + (i / 4) * 100;
            return (
              <line
                key={`sb-${i}`}
                x1={x} y1={0}
                x2={x} y2={gridHeight}
                stroke="rgba(120,200,220,0.03)"
                strokeWidth={0.3}
              />
            );
          })}

          {/* MIDI Notes */}
          {notes.map((note, ni) => {
            const rowIdx = TOTAL_KEYS - 1 - (note.pitch - midiMin);
            if (rowIdx < 0 || rowIdx >= TOTAL_KEYS) return null;

            const noteY = rowIdx * KEY_HEIGHT + 1;
            const noteX = PIANO_WIDTH + note.start * (100);
            const noteW = note.duration * 100 - 2;
            const noteH = KEY_HEIGHT - 2;
            const color = velocityColor(note.velocity);
            const opacity = 0.5 + (note.velocity / 127) * 0.5;

            return (
              <g
                key={`note-${ni}`}
                opacity={opacity}
                onMouseEnter={() => setHoveredNote(ni)}
                onMouseLeave={() => setHoveredNote(null)}
                style={{ cursor: tool === 'erase' ? 'crosshair' : 'pointer' }}
              >
                {/* Note glow */}
                {hoveredNote === ni && (
                  <rect
                    x={noteX - 1}
                    y={noteY - 1}
                    width={noteW + 2}
                    height={noteH + 2}
                    rx={3}
                    fill={color}
                    opacity={0.2}
                    filter="url(#note-glow)"
                  />
                )}
                {/* Note body */}
                <rect
                  x={noteX}
                  y={noteY}
                  width={noteW}
                  height={noteH}
                  rx={2}
                  fill={color}
                  opacity={0.85}
                />
                {/* Left edge highlight */}
                <rect
                  x={noteX}
                  y={noteY}
                  width={2.5}
                  height={noteH}
                  rx={1}
                  fill="#ffffff"
                  opacity={0.4}
                />
              </g>
            );
          })}

          {/* Live MIDI input — glowing note indicators at the left edge of the grid */}
          {liveActiveNotes.map((activeNote) => {
            if (activeNote.note < midiMin || activeNote.note >= midiMax) return null;
            const rowIdx = TOTAL_KEYS - 1 - (activeNote.note - midiMin);
            const y = rowIdx * KEY_HEIGHT + 1;
            const h = KEY_HEIGHT - 2;
            const velNorm = activeNote.velocity / 127;
            const liveColor = velocityColor(activeNote.velocity);

            return (
              <g key={`live-${activeNote.note}`}>
                {/* Outer glow */}
                <rect
                  x={PIANO_WIDTH}
                  y={y - 2}
                  width={24}
                  height={h + 4}
                  rx={4}
                  fill={liveColor}
                  opacity={0.3 * velNorm}
                  filter="url(#live-note-glow)"
                />
                {/* Inner solid indicator */}
                <rect
                  x={PIANO_WIDTH + 1}
                  y={y}
                  width={16}
                  height={h}
                  rx={3}
                  fill={liveColor}
                  opacity={0.7 + 0.3 * velNorm}
                />
                {/* Bright left edge */}
                <rect
                  x={PIANO_WIDTH + 1}
                  y={y}
                  width={3}
                  height={h}
                  rx={1}
                  fill="#ffffff"
                  opacity={0.6}
                />
              </g>
            );
          })}

          {/* Velocity lane separator */}
          <line
            x1={PIANO_WIDTH}
            y1={gridHeight + 4}
            x2={PIANO_WIDTH + BEATS * 100}
            y2={gridHeight + 4}
            stroke="var(--border)"
            strokeWidth={0.5}
          />

          {/* Velocity bars */}
          {notes.map((note, ni) => {
            const x = PIANO_WIDTH + note.start * 100;
            const barH = (note.velocity / 127) * VELOCITY_LANE_HEIGHT * 0.85;
            const color = velocityColor(note.velocity);

            return (
              <rect
                key={`vel-${ni}`}
                x={x + 1}
                y={gridHeight + 8 + VELOCITY_LANE_HEIGHT - barH}
                width={6}
                height={barH}
                rx={1}
                fill={color}
                opacity={0.7}
              />
            );
          })}

          {/* Velocity label */}
          <text
            x={4}
            y={gridHeight + 16}
            fill="var(--text-muted)"
            fontSize={7}
            fontFamily="var(--font-mono)"
          >
            VEL
          </text>
        </svg>
      </div>
    </div>
  );
};
