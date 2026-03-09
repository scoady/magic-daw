import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Player } from '@remotion/player';
import { CircleOfFifths1 } from '../compositions/CircleOfFifths1';
import { CircleOfFifths2 } from '../compositions/CircleOfFifths2';
import { CircleOfFifths3 } from '../compositions/CircleOfFifths3';
import { CircleOfFifths4 } from '../compositions/CircleOfFifths4';
import { CircleOfFifths5 } from '../compositions/CircleOfFifths5';
import type { CircleOfFifthsProps } from '../compositions/CircleOfFifths1';
import { onSwiftMessage, onMidiStateChange, BridgeMessages } from '../bridge';

// ── Music theory helpers ──────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B',
};

function midiToNoteName(midi: number): string {
  return NOTE_NAMES[midi % 12];
}

function noteNameToKey(name: string): string {
  const sharp = FLAT_TO_SHARP[name] ?? name;
  return sharp;
}

// ── Composition selector ──────────────────────────────────────────────────

const COMPOSITIONS = [
  { id: 1, name: 'Harmonic Gravity', component: CircleOfFifths1 },
  { id: 2, name: 'Sacred Aurora', component: CircleOfFifths2 },
  { id: 3, name: 'Orbital Mechanics', component: CircleOfFifths3 },
  { id: 4, name: 'Crystalline Mandala', component: CircleOfFifths4 },
  { id: 5, name: 'Gravity Well', component: CircleOfFifths5 },
] as const;

// ── Bridge payload types ──────────────────────────────────────────────────

interface ChordDetectedPayload {
  chord: string | null;
  root?: string;
  quality?: string;
  qualityName?: string;
  notes?: number[];
}

interface KeyDetectedPayload {
  key: string | null;
  tonic?: string;
  mode?: string;
  confidence: number;
}

// ── Component ──────────────────────────────────────────────────────────────

export const CircleOfFifthsPanel: React.FC = () => {
  const [activeComposition, setActiveComposition] = useState(0); // index into COMPOSITIONS
  const [activeKey, setActiveKey] = useState('C');
  const [activeMode, setActiveMode] = useState<'major' | 'minor'>('major');
  const [detectedChord, setDetectedChord] = useState<string | null>('Am7');
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [chordProgression, setChordProgression] = useState<string[]>(['C', 'Am', 'F', 'G']);
  const [pathfinderFrom, setPathfinderFrom] = useState<string | null>(null);
  const [pathfinderTo, setPathfinderTo] = useState<string | null>(null);
  const [pathfinderPaths, setPathfinderPaths] = useState<string[][]>([]);
  const [highlightedDegrees, setHighlightedDegrees] = useState<number[]>([]);

  // Subscribe to bridge events
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // Key detection
    unsubs.push(
      onSwiftMessage(BridgeMessages.KEY_DETECTED, (payload: unknown) => {
        const p = payload as KeyDetectedPayload;
        if (p.key && p.confidence > 0.3) {
          const tonic = p.tonic ?? p.key.replace(/m$/, '');
          setActiveKey(tonic);
          setActiveMode(p.mode === 'minor' || p.key.endsWith('m') ? 'minor' : 'major');
        }
      }),
    );

    // Chord detection
    unsubs.push(
      onSwiftMessage(BridgeMessages.CHORD_DETECTED, (payload: unknown) => {
        const p = payload as ChordDetectedPayload;
        if (p.chord) {
          setDetectedChord(p.chord);
          setChordProgression((prev) => {
            const next = [...prev, p.chord!];
            return next.slice(-16);
          });
        }
      }),
    );

    return () => unsubs.forEach((fn) => fn());
  }, []);

  // Subscribe to live MIDI notes
  useEffect(() => {
    const unsub = onMidiStateChange((notes) => {
      setActiveNotes(notes.map((n) => n.note));
    });
    return unsub;
  }, []);

  const comp = COMPOSITIONS[activeComposition];
  const CompositionComponent = comp.component;

  const inputProps: CircleOfFifthsProps = {
    activeKey,
    activeMode,
    detectedChord,
    activeNotes,
    chordProgression,
    pathfinderFrom,
    pathfinderTo,
    pathfinderPaths,
    highlightedDegrees,
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Remotion Player — full viewport */}
      <Player
        component={CompositionComponent}
        inputProps={inputProps}
        compositionWidth={1920}
        compositionHeight={1080}
        fps={30}
        durationInFrames={9000}
        loop
        autoPlay
        controls={false}
        style={{
          width: '100%',
          height: '100%',
        }}
      />

      {/* Composition selector (top-right overlay) */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: 4,
          zIndex: 10,
        }}
      >
        {COMPOSITIONS.map((c, i) => (
          <button
            key={c.id}
            onClick={() => setActiveComposition(i)}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontFamily: "'SF Pro Display', system-ui",
              background:
                i === activeComposition
                  ? 'rgba(103, 232, 249, 0.2)'
                  : 'rgba(120, 200, 220, 0.06)',
              border: `1px solid ${
                i === activeComposition
                  ? 'rgba(103, 232, 249, 0.4)'
                  : 'rgba(120, 200, 220, 0.12)'
              }`,
              borderRadius: 6,
              color:
                i === activeComposition ? '#67e8f9' : '#94a3b8',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(8px)',
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
};
