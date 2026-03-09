import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Player } from '@remotion/player';
import { CircleOfFifths1 } from '../compositions/CircleOfFifths1';
import { CircleOfFifths2 } from '../compositions/CircleOfFifths2';
import type { CircleOfFifthsProps } from '../compositions/CircleOfFifths1';
import { onSwiftMessage, onMidiStateChange, BridgeMessages } from '../bridge';

// ── Composition selector ──────────────────────────────────────────────────

const COMPOSITIONS = [
  { id: 1, name: 'Harmonic Gravity', component: CircleOfFifths1 },
  { id: 2, name: 'Sacred Aurora', component: CircleOfFifths2 },
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

// ── Key selector constants ────────────────────────────────────────────────

const ALL_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];

// ── Component ──────────────────────────────────────────────────────────────

export const CircleOfFifthsPanel: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [compSize, setCompSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Immediate measure on mount
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setCompSize({ w: Math.round(rect.width / 2) * 2, h: Math.round(rect.height / 2) * 2 });
    }
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setCompSize({ w: Math.round(width / 2) * 2, h: Math.round(height / 2) * 2 });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [activeComposition, setActiveComposition] = useState(0);
  const [activeKey, setActiveKey] = useState('C');
  const [activeMode, setActiveMode] = useState<'major' | 'minor'>('major');
  const [detectedChord, setDetectedChord] = useState<string | null>(null);
  // No throttle — Remotion Player already renders at 30fps max
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [chordProgression, setChordProgression] = useState<string[]>([]);
  const [pathfinderFrom] = useState<string | null>(null);
  const [pathfinderTo] = useState<string | null>(null);
  const [pathfinderPaths] = useState<string[][]>([]);
  const [highlightedDegrees] = useState<number[]>([]);

  // Subscribe to bridge events (chord detection only — key is user-defined)
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSwiftMessage(BridgeMessages.CHORD_DETECTED, (payload: unknown) => {
        const p = payload as ChordDetectedPayload;
        if (p.chord) {
          setDetectedChord(p.chord);
          setChordProgression((prev) => {
            const next = [...prev, p.chord!];
            return next.slice(-16);
          });
        } else {
          setDetectedChord(null);
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
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {compSize && (
        <Player
          key={`${compSize.w}x${compSize.h}`}
          component={CompositionComponent}
          inputProps={inputProps}
          compositionWidth={compSize.w}
          compositionHeight={compSize.h}
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
      )}

      {/* ── Top bar: Key selector + Mode toggle + Composition selector ── */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          right: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        {/* Key selector */}
        <div style={{ display: 'flex', gap: 2, pointerEvents: 'auto' }}>
          {ALL_KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setActiveKey(k)}
              style={{
                padding: '3px 7px',
                fontSize: 11,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontWeight: k === activeKey ? 700 : 400,
                background: k === activeKey
                  ? 'rgba(103, 232, 249, 0.25)'
                  : 'rgba(120, 200, 220, 0.04)',
                border: `1px solid ${k === activeKey
                  ? 'rgba(103, 232, 249, 0.5)'
                  : 'rgba(120, 200, 220, 0.08)'}`,
                borderRadius: 4,
                color: k === activeKey ? '#67e8f9' : '#64748b',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                backdropFilter: 'blur(8px)',
                minWidth: 28,
                textAlign: 'center' as const,
              }}
            >
              {k}
            </button>
          ))}
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 2, pointerEvents: 'auto' }}>
          {(['major', 'minor'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setActiveMode(m)}
              style={{
                padding: '3px 10px',
                fontSize: 11,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontWeight: m === activeMode ? 700 : 400,
                background: m === activeMode
                  ? (m === 'minor' ? 'rgba(167, 139, 250, 0.25)' : 'rgba(103, 232, 249, 0.25)')
                  : 'rgba(120, 200, 220, 0.04)',
                border: `1px solid ${m === activeMode
                  ? (m === 'minor' ? 'rgba(167, 139, 250, 0.5)' : 'rgba(103, 232, 249, 0.5)')
                  : 'rgba(120, 200, 220, 0.08)'}`,
                borderRadius: 4,
                color: m === activeMode
                  ? (m === 'minor' ? '#a78bfa' : '#67e8f9')
                  : '#64748b',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                backdropFilter: 'blur(8px)',
                textTransform: 'capitalize' as const,
              }}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Composition selector */}
        <div style={{ display: 'flex', gap: 4, pointerEvents: 'auto' }}>
          {COMPOSITIONS.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setActiveComposition(i)}
              style={{
                padding: '3px 10px',
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
    </div>
  );
};
