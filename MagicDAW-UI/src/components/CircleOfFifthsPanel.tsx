import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Player } from '@remotion/player';
import { CircleOfFifths1 } from '../compositions/CircleOfFifths1';
import { CircleOfFifths2 } from '../compositions/CircleOfFifths2';
import { CircleOfFifths3 } from '../compositions/CircleOfFifths3';
import { CircleOfFifths4 } from '../compositions/CircleOfFifths4';
import { CircleOfFifths5 } from '../compositions/CircleOfFifths5';
import type { CircleOfFifthsProps } from '../compositions/CircleOfFifths1';
import { onSwiftMessage, onMidiStateChange, BridgeMessages } from '../bridge';

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

// ── Throttle helper ───────────────────────────────────────────────────────

/** Leading-edge throttle: fires immediately on first call, then coalesces for intervalMs */
function useThrottledState<T>(initial: T, intervalMs: number): [T, (v: T) => void] {
  const [state, setState] = useState(initial);
  const pendingRef = useRef(initial);
  const lastFireRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setThrottled = useCallback((value: T) => {
    pendingRef.current = value;
    const now = performance.now();
    const elapsed = now - lastFireRef.current;

    if (elapsed >= intervalMs) {
      // Leading edge — fire immediately
      lastFireRef.current = now;
      setState(value);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    } else if (!timerRef.current) {
      // Schedule trailing edge for remaining time
      timerRef.current = setTimeout(() => {
        lastFireRef.current = performance.now();
        setState(pendingRef.current);
        timerRef.current = null;
      }, intervalMs - elapsed);
    }
  }, [intervalMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return [state, setThrottled];
}

// ── Component ──────────────────────────────────────────────────────────────

export const CircleOfFifthsPanel: React.FC = () => {
  const [activeComposition, setActiveComposition] = useState(0);
  const [activeKey, setActiveKey] = useState('C');
  const [activeMode, setActiveMode] = useState<'major' | 'minor'>('major');
  const [detectedChord, setDetectedChord] = useState<string | null>('Am7');
  // No throttle — Remotion Player already renders at 30fps max
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [chordProgression, setChordProgression] = useState<string[]>(['C', 'Am', 'F', 'G']);
  const [pathfinderFrom] = useState<string | null>(null);
  const [pathfinderTo] = useState<string | null>(null);
  const [pathfinderPaths] = useState<string[][]>([]);
  const [highlightedDegrees] = useState<number[]>([]);

  // Subscribe to bridge events
  useEffect(() => {
    const unsubs: Array<() => void> = [];

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

  // Subscribe to live MIDI notes — throttled
  useEffect(() => {
    const unsub = onMidiStateChange((notes) => {
      setActiveNotes(notes.map((n) => n.note));
    });
    return unsub;
  }, []);

  // Memoize inputProps to avoid new object reference every render
  const inputProps: CircleOfFifthsProps = useMemo(() => ({
    activeKey,
    activeMode,
    detectedChord,
    activeNotes,
    chordProgression,
    pathfinderFrom,
    pathfinderTo,
    pathfinderPaths,
    highlightedDegrees,
  }), [activeKey, activeMode, detectedChord, activeNotes, chordProgression, pathfinderFrom, pathfinderTo, pathfinderPaths, highlightedDegrees]);

  const comp = COMPOSITIONS[activeComposition];
  const CompositionComponent = comp.component;

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

      {/* Composition selector */}
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
              color: i === activeComposition ? '#67e8f9' : '#94a3b8',
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
