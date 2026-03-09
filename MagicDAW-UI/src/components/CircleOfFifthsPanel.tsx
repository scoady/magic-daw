import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Player } from '@remotion/player';
import { CircleOfFifths1, chordToMidiNotes, getSurpriseChord, getFamousProgressions, resolveProgression, findHarmonicPath, chordToFifthsPosition } from '../compositions/CircleOfFifths1';
import { CircleOfFifths2 } from '../compositions/CircleOfFifths2';
import type { CircleOfFifthsProps } from '../compositions/CircleOfFifths1';
import { onSwiftMessage, onMidiStateChange, BridgeMessages, previewNote, sendToSwift } from '../bridge';

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

// ── Diatonic chord inference from single notes ──────────────────────────

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ENHARMONIC: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'Gb': 'F#',
  'Cb': 'B', 'Fb': 'E', 'B#': 'C', 'E#': 'F',
};

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor

// Chord quality for each scale degree: major, minor, minor, major, major, minor, dim
const MAJOR_QUALITIES = ['', 'm', 'm', '', '', 'm', 'dim'] as const;
// Natural minor: minor, dim, major, minor, minor, major, major
const MINOR_QUALITIES = ['m', 'dim', '', 'm', 'm', '', ''] as const;

// Keys that prefer flat names
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db']);

function normalizeRoot(n: string): string {
  return ENHARMONIC[n] ?? n;
}

/** Get the MIDI pitch class (0-11) for a note name like "C", "F#", "Db" */
function rootToChroma(root: string): number {
  const norm = normalizeRoot(root);
  return CHROMATIC.indexOf(norm);
}

/** Build the diatonic chord name for a MIDI note number in the given key/mode.
 *  For notes in the scale → diatonic chord (e.g. D in Cmaj → Dm).
 *  For chromatic notes → major chord on that root (best guess). */
function inferDiatonicChord(
  midiNote: number,
  key: string,
  mode: 'major' | 'minor',
): string {
  const rootChroma = rootToChroma(key);
  const noteChroma = midiNote % 12;
  const useFlats = FLAT_KEYS.has(key);
  const chordRoot = useFlats
    ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'][noteChroma]
    : CHROMATIC[noteChroma];
  if (rootChroma < 0) return chordRoot; // unknown key — just major

  const interval = ((noteChroma - rootChroma) % 12 + 12) % 12;
  const scaleIntervals = mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  const qualities = mode === 'major' ? MAJOR_QUALITIES : MINOR_QUALITIES;
  const degreeIdx = scaleIntervals.indexOf(interval);
  if (degreeIdx < 0) return chordRoot; // chromatic note — treat as major
  return chordRoot + qualities[degreeIdx];
}

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
  const [isFullChord, setIsFullChord] = useState(false);
  // No throttle — Remotion Player already renders at 30fps max
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [chordProgression, setChordProgression] = useState<string[]>([]);
  const [pathfinderFrom] = useState<string | null>(null);
  const [pathfinderTo] = useState<string | null>(null);
  const [pathfinderPaths] = useState<string[][]>([]);
  const [highlightedDegrees] = useState<number[]>([]);

  // Subscribe to bridge chord detection
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.CHORD_DETECTED, (payload: unknown) => {
      const p = payload as ChordDetectedPayload;
      if (p.chord) {
        setDetectedChord(p.chord);
        setIsFullChord(true);
        setChordProgression((prev) => {
          const next = [...prev, p.chord!];
          return next.slice(-16);
        });
      } else {
        setDetectedChord(null);
        setIsFullChord(false);
      }
    });
    return unsub;
  }, []);

  // Subscribe to live MIDI notes
  useEffect(() => {
    const unsub = onMidiStateChange((notes) => {
      setActiveNotes(notes.map((n) => n.note));
    });
    return unsub;
  }, []);

  // Infer diatonic chord from single notes when bridge hasn't detected a chord.
  // Only infer when a genuinely NEW note is pressed (not just releasing keys from a chord).
  const prevNoteSetRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const hasNewNote = activeNotes.length > 0 &&
      activeNotes.some(n => !prevNoteSetRef.current.has(n));
    prevNoteSetRef.current = new Set(activeNotes);

    if (activeNotes.length === 0) {
      // All notes released — clear chord
      setDetectedChord(null);
      setIsFullChord(false);
      return;
    }

    // If the bridge already set a chord this cycle, don't override
    if (isFullChord && detectedChord) return;

    // Only infer when a new note was pressed (not just old notes being released)
    if (!hasNewNote) return;

    // Infer from the lowest note
    const lowest = Math.min(...activeNotes);
    const inferred = inferDiatonicChord(lowest, activeKey, activeMode);
    if (inferred && inferred !== detectedChord) {
      setDetectedChord(inferred);
      setIsFullChord(activeNotes.length >= 3);
      setChordProgression((prev) => {
        const last = prev[prev.length - 1];
        if (last === inferred) return prev;
        const next = [...prev, inferred];
        return next.slice(-16);
      });
    }
  }, [activeNotes, activeKey, activeMode]); // intentionally omit detectedChord/isFullChord to avoid loops

  // ── Click-and-drag panning ──────────────────────────────────────────────
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number; startPan: { x: number; y: number } } | null>(null);

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    // Only pan on middle-click or when holding space (via data attribute)
    // For now: any mousedown on the canvas starts panning
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startPan: { ...panOffset },
    };
  }, [panOffset]);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!panStartRef.current || !compSize) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    // Convert screen pixels to SVG units (approximate — the viewBox zoom affects this)
    const svgScale = compSize.w / (containerRef.current?.clientWidth ?? compSize.w);
    setPanOffset({
      x: panStartRef.current.startPan.x - dx * svgScale,
      y: panStartRef.current.startPan.y - dy * svgScale,
    });
  }, [compSize]);

  const handlePanEnd = useCallback(() => {
    panStartRef.current = null;
  }, []);

  // Reset / save controls for chord path
  const [resetSignal, setResetSignal] = useState(0);
  const [pathChords, setPathChords] = useState<string[]>([]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [bpm, setBpm] = useState(120);
  const playbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Loop region
  const [loopRegion, setLoopRegion] = useState<[number, number] | null>(null);

  // Import menu
  const [showImportMenu, setShowImportMenu] = useState(false);

  // Build Path
  const [showBuildPath, setShowBuildPath] = useState(false);
  const [buildPathFrom, setBuildPathFrom] = useState('C');
  const [buildPathTo, setBuildPathTo] = useState('G');
  const [buildPathSteps, setBuildPathSteps] = useState(6);
  const [buildPathLoading, setBuildPathLoading] = useState(false);
  const [buildPathPreview, setBuildPathPreview] = useState<string[] | null>(null);

  const ALL_CHORDS = useMemo(() => {
    const roots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const qualities = ['', 'm'];
    return roots.flatMap(r => qualities.map(q => r + q));
  }, []);

  // Live preview of the deterministic path
  useEffect(() => {
    if (!showBuildPath) { setBuildPathPreview(null); return; }
    const path = findHarmonicPath(buildPathFrom, buildPathTo, buildPathSteps, activeKey, activeMode);
    setBuildPathPreview(path);
  }, [showBuildPath, buildPathFrom, buildPathTo, buildPathSteps, activeKey, activeMode]);

  // Import a path result (shared by both deterministic and AI)
  const importBuildPath = useCallback((chords: string[]) => {
    setResetSignal(s => s + 1);
    setPathChords([]);
    setPanOffset({ x: 0, y: 0 });
    setImportChords(null);
    setTimeout(() => setImportChords(chords), 0);
    setShowBuildPath(false);
  }, []);

  // Deterministic pathfinder (default)
  const handleBuildPath = useCallback(() => {
    const path = findHarmonicPath(buildPathFrom, buildPathTo, buildPathSteps, activeKey, activeMode);
    importBuildPath(path);
  }, [buildPathFrom, buildPathTo, buildPathSteps, activeKey, activeMode, importBuildPath]);

  // AI pathfinder (fallback)
  const handleBuildPathAI = useCallback(() => {
    if (buildPathLoading) return;
    setBuildPathLoading(true);

    const requestId = `buildpath-${Date.now()}`;
    const prompt = `You are a music theory expert. Create a chord progression of exactly ${buildPathSteps} chords that starts on ${buildPathFrom} and ends on ${buildPathTo} in the key of ${activeKey} ${activeMode}. Use smooth voice leading with musically satisfying harmonic movement. Respond with ONLY the chord names separated by spaces, nothing else. Example: C Am F G`;

    const unsub = onSwiftMessage(BridgeMessages.AI_CHAT_RESULT, (payload: unknown) => {
      const p = payload as { result?: string; error?: string; requestId?: string };
      if (p.requestId !== requestId) return;
      unsub();
      setBuildPathLoading(false);

      if (p.error || !p.result) {
        console.error('[BuildPath AI] error:', p.error);
        return;
      }

      const raw = p.result.trim();
      const chordPattern = /\b([A-G][b#]?(?:maj7|m7|dim7|aug7|sus[24]|7|m|dim|aug)?)\b/g;
      const chords: string[] = [];
      let match;
      while ((match = chordPattern.exec(raw)) !== null) {
        chords.push(match[1]);
      }

      if (chords.length >= 2) {
        importBuildPath(chords);
        setBuildPathPreview(chords);
      }
    });

    sendToSwift('ai.chat', { prompt, requestId });
  }, [buildPathFrom, buildPathTo, buildPathSteps, activeKey, activeMode, buildPathLoading, importBuildPath]);

  const handleReset = useCallback(() => {
    // Stop playback if running
    if (playbackTimerRef.current) {
      clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    setIsPlaying(false);
    setPlaybackIndex(-1);
    setLoopRegion(null);
    setImportChords(null);
    setResetSignal(s => s + 1);
    setPathChords([]);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const onSavePath = useCallback((chords: string[]) => {
    setPathChords(chords);
  }, []);

  // Import chords directly into the composition path
  const [importChords, setImportChords] = useState<string[] | null>(null);

  // Click-to-navigate: add a chord to the path programmatically
  const handleClickChord = useCallback((chord: string) => {
    // Append to existing path — use current pathChords as base if importChords is null
    setImportChords(prev => {
      const base = prev ?? pathChords;
      return [...base, chord];
    });
  }, [pathChords]);

  // Delete a node from the chord path
  const handleDeleteNode = useCallback((index: number) => {
    setImportChords(prev => prev ? prev.filter((_, i) => i !== index) : null);
  }, []);

  // Play a chord via bridge — sends previewNote for each note in the chord
  const playChordAudio = useCallback((chord: string) => {
    const notes = chordToMidiNotes(chord);
    notes.forEach(n => previewNote(n, 90));
  }, []);

  // Playback: step through chords and play each via bridge
  const handlePlayback = useCallback(() => {
    if (isPlaying) {
      // Stop
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      setIsPlaying(false);
      setPlaybackIndex(-1);
      return;
    }

    const chords = importChords ?? pathChords;
    if (chords.length === 0) return;

    setIsPlaying(true);
    const startIdx = loopRegion ? loopRegion[0] : 0;
    const endIdx = loopRegion ? loopRegion[1] : chords.length - 1;
    let currentIdx = startIdx;
    setPlaybackIndex(currentIdx);

    // Play the first chord immediately
    playChordAudio(chords[currentIdx]);

    const msPerBeat = (60 / bpm) * 1000;
    playbackTimerRef.current = setInterval(() => {
      currentIdx++;
      if (currentIdx > endIdx) {
        if (loopRegion) {
          currentIdx = loopRegion[0]; // loop back
        } else {
          // Stop at end
          clearInterval(playbackTimerRef.current!);
          playbackTimerRef.current = null;
          setIsPlaying(false);
          setPlaybackIndex(-1);
          return;
        }
      }
      setPlaybackIndex(currentIdx);
      playChordAudio(chords[currentIdx]);
    }, msPerBeat);
  }, [isPlaying, importChords, pathChords, bpm, loopRegion, playChordAudio]);

  // Surprise me: add a random harmonically valid chord
  const handleSurprise = useCallback(() => {
    const current = importChords ?? pathChords;
    const lastChord = current.length > 0 ? current[current.length - 1] : null;
    const chord = getSurpriseChord(lastChord, activeKey, activeMode);
    setImportChords(prev => prev ? [...prev, chord] : [chord]);
  }, [importChords, pathChords, activeKey, activeMode]);

  // Import a famous progression
  const handleImportProgression = useCallback((progIndex: number) => {
    const progs = getFamousProgressions();
    const prog = progs[progIndex];
    if (!prog) return;
    const chords = resolveProgression(prog, activeKey, activeMode);
    // Reset then load new chords
    setResetSignal(s => s + 1);
    setPathChords([]);
    setPanOffset({ x: 0, y: 0 });
    setImportChords(null);
    // Set import after a tick so reset processes first
    setTimeout(() => setImportChords(chords), 0);
    setShowImportMenu(false);
  }, [activeKey, activeMode]);

  // Set loop region from current path
  const handleToggleLoop = useCallback(() => {
    if (loopRegion) {
      setLoopRegion(null);
    } else if (pathChords.length >= 2) {
      setLoopRegion([0, pathChords.length - 1]);
    }
  }, [loopRegion, pathChords]);

  // Cleanup playback on unmount
  useEffect(() => {
    return () => {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    };
  }, []);

  // Memoize inputProps to avoid new object reference every render
  const inputProps: CircleOfFifthsProps = useMemo(() => ({
    activeKey,
    activeMode,
    detectedChord,
    isFullChord,
    activeNotes,
    chordProgression,
    pathfinderFrom,
    pathfinderTo,
    pathfinderPaths,
    highlightedDegrees,
    resetSignal,
    onSavePath,
    panOffset,
    onClickChord: handleClickChord,
    onDeleteNode: handleDeleteNode,
    playbackIndex,
    loopRegion,
    onSetLoopRegion: setLoopRegion,
    importChords,
  }), [activeKey, activeMode, detectedChord, isFullChord, activeNotes, chordProgression, pathfinderFrom, pathfinderTo, pathfinderPaths, highlightedDegrees, resetSignal, onSavePath, panOffset, handleClickChord, handleDeleteNode, playbackIndex, loopRegion, importChords]);

  const comp = COMPOSITIONS[activeComposition];
  const CompositionComponent = comp.component;

  return (
    <div
      ref={containerRef}
      onMouseDown={handlePanStart}
      onMouseMove={handlePanMove}
      onMouseUp={handlePanEnd}
      onMouseLeave={handlePanEnd}
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
        overflow: 'hidden',
        position: 'relative',
        cursor: panStartRef.current ? 'grabbing' : 'grab',
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

      {/* ── Bottom controls ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          right: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        {/* Left side: playback controls */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', pointerEvents: 'auto' }}>
          {/* Play / Stop */}
          <button
            onClick={handlePlayback}
            style={{
              padding: '5px 12px',
              fontSize: 11,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontWeight: 700,
              background: isPlaying
                ? 'rgba(244, 63, 94, 0.2)'
                : 'rgba(45, 212, 191, 0.15)',
              border: `1px solid ${isPlaying
                ? 'rgba(244, 63, 94, 0.4)'
                : 'rgba(45, 212, 191, 0.3)'}`,
              borderRadius: 6,
              color: isPlaying ? '#f43f5e' : '#2dd4bf',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              backdropFilter: 'blur(8px)',
              minWidth: 50,
            }}
          >
            {isPlaying ? 'Stop' : 'Play'}
          </button>

          {/* Loop toggle */}
          <button
            onClick={handleToggleLoop}
            style={{
              padding: '5px 10px',
              fontSize: 11,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontWeight: 600,
              background: loopRegion
                ? 'rgba(251, 191, 36, 0.2)'
                : 'rgba(120, 200, 220, 0.06)',
              border: `1px solid ${loopRegion
                ? 'rgba(251, 191, 36, 0.4)'
                : 'rgba(120, 200, 220, 0.15)'}`,
              borderRadius: 6,
              color: loopRegion ? '#fbbf24' : '#94a3b8',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              backdropFilter: 'blur(8px)',
            }}
          >
            Loop
          </button>

          {/* BPM control */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px',
            background: 'rgba(120, 200, 220, 0.04)',
            border: '1px solid rgba(120, 200, 220, 0.1)',
            borderRadius: 6,
            backdropFilter: 'blur(8px)',
          }}>
            <span style={{
              fontSize: 10, fontFamily: "'SF Mono', 'Fira Code', monospace",
              color: '#64748b',
            }}>BPM</span>
            <input
              type="range" min={40} max={240} value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
              style={{ width: 60, height: 14, accentColor: '#67e8f9' }}
            />
            <span style={{
              fontSize: 11, fontFamily: "'SF Mono', 'Fira Code', monospace",
              color: '#67e8f9', fontWeight: 700, minWidth: 28, textAlign: 'right' as const,
            }}>{bpm}</span>
          </div>
        </div>

        {/* Center: Surprise me + Import */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', pointerEvents: 'auto' }}>
          <button
            onClick={handleSurprise}
            style={{
              padding: '5px 12px',
              fontSize: 11,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontWeight: 600,
              background: 'rgba(167, 139, 250, 0.12)',
              border: '1px solid rgba(167, 139, 250, 0.3)',
              borderRadius: 6,
              color: '#a78bfa',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              backdropFilter: 'blur(8px)',
            }}
          >
            Surprise
          </button>

          {/* Build Path */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowBuildPath(!showBuildPath); setShowImportMenu(false); }}
              style={{
                padding: '5px 12px',
                fontSize: 11,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontWeight: 600,
                background: buildPathLoading
                  ? 'rgba(251, 191, 36, 0.2)'
                  : 'rgba(45, 212, 191, 0.12)',
                border: `1px solid ${buildPathLoading
                  ? 'rgba(251, 191, 36, 0.4)'
                  : 'rgba(45, 212, 191, 0.3)'}`,
                borderRadius: 6,
                color: buildPathLoading ? '#fbbf24' : '#2dd4bf',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                backdropFilter: 'blur(8px)',
              }}
            >
              {buildPathLoading ? 'Building...' : 'Build Path'}
            </button>
            {showBuildPath && (
              <div style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 4,
                background: 'rgba(8, 14, 24, 0.95)',
                border: '1px solid rgba(45, 212, 191, 0.25)',
                borderRadius: 8,
                padding: 12,
                minWidth: 320,
                backdropFilter: 'blur(12px)',
                zIndex: 100,
              }}>
                <div style={{
                  fontSize: 10,
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  marginBottom: 8,
                }}>Harmonic Path Builder</div>

                {/* From / To selectors */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: '#64748b', marginBottom: 3, fontFamily: "'SF Mono', monospace" }}>FROM</div>
                    <select
                      value={buildPathFrom}
                      onChange={(e) => setBuildPathFrom(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 6px',
                        fontSize: 12,
                        fontFamily: "'SF Mono', 'Fira Code', monospace",
                        fontWeight: 700,
                        background: 'rgba(45, 212, 191, 0.08)',
                        border: '1px solid rgba(45, 212, 191, 0.2)',
                        borderRadius: 4,
                        color: '#2dd4bf',
                        cursor: 'pointer',
                      }}
                    >
                      {ALL_CHORDS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  <div style={{ color: '#475569', fontSize: 14, paddingTop: 14 }}>→</div>

                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: '#64748b', marginBottom: 3, fontFamily: "'SF Mono', monospace" }}>TO</div>
                    <select
                      value={buildPathTo}
                      onChange={(e) => setBuildPathTo(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 6px',
                        fontSize: 12,
                        fontFamily: "'SF Mono', 'Fira Code', monospace",
                        fontWeight: 700,
                        background: 'rgba(167, 139, 250, 0.08)',
                        border: '1px solid rgba(167, 139, 250, 0.2)',
                        borderRadius: 4,
                        color: '#a78bfa',
                        cursor: 'pointer',
                      }}
                    >
                      {ALL_CHORDS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                {/* Steps slider */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
                  padding: '4px 0',
                }}>
                  <span style={{ fontSize: 9, color: '#64748b', fontFamily: "'SF Mono', monospace", minWidth: 36 }}>STEPS</span>
                  <input
                    type="range" min={3} max={12} value={buildPathSteps}
                    onChange={(e) => setBuildPathSteps(Number(e.target.value))}
                    style={{ flex: 1, height: 14, accentColor: '#2dd4bf' }}
                  />
                  <span style={{
                    fontSize: 12, fontFamily: "'SF Mono', 'Fira Code', monospace",
                    color: '#2dd4bf', fontWeight: 700, minWidth: 20, textAlign: 'right' as const,
                  }}>{buildPathSteps}</span>
                </div>

                {/* Mini circle of fifths preview */}
                {buildPathPreview && buildPathPreview.length >= 2 && (() => {
                  const circR = 50;
                  const cx = 55;
                  const cy = 55;
                  const fifthsLabels = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
                  const previewPositions = buildPathPreview.map(c => chordToFifthsPosition(c));

                  return (
                    <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                      {/* Mini circle */}
                      <svg width={110} height={110} viewBox="0 0 110 110">
                        {/* Circle outline */}
                        <circle cx={cx} cy={cy} r={circR} fill="none" stroke="rgba(103,232,249,0.1)" strokeWidth={1} />
                        {/* 12 positions */}
                        {fifthsLabels.map((label, i) => {
                          const angle = (i * 30 - 90) * Math.PI / 180;
                          const x = cx + circR * Math.cos(angle);
                          const y = cy + circR * Math.sin(angle);
                          const isInPath = previewPositions.includes(i);
                          return (
                            <g key={label}>
                              <circle cx={x} cy={y} r={isInPath ? 6 : 3}
                                fill={isInPath ? 'rgba(45,212,191,0.3)' : 'rgba(100,116,139,0.15)'}
                                stroke={isInPath ? '#2dd4bf' : 'rgba(100,116,139,0.3)'}
                                strokeWidth={isInPath ? 1.2 : 0.5}
                              />
                              <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="central"
                                fill={isInPath ? '#e2e8f0' : '#475569'}
                                fontSize={isInPath ? 5 : 4} fontFamily="monospace" fontWeight={isInPath ? 700 : 400}
                              >{label}</text>
                            </g>
                          );
                        })}
                        {/* Path shape */}
                        {previewPositions.length >= 2 && (() => {
                          const pts = previewPositions.map(pos => {
                            const angle = (pos * 30 - 90) * Math.PI / 180;
                            return { x: cx + circR * Math.cos(angle), y: cy + circR * Math.sin(angle) };
                          });
                          // Fill shape
                          const fillD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
                          // Path line (open)
                          const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                          return (
                            <>
                              <path d={fillD} fill="rgba(45,212,191,0.06)" stroke="none" />
                              <path d={lineD} fill="none" stroke="#2dd4bf" strokeWidth={1.5}
                                opacity={0.6} strokeLinejoin="round"
                              />
                              {/* Direction arrows */}
                              {pts.slice(0, -1).map((p, i) => {
                                const next = pts[i + 1];
                                const mx = (p.x + next.x) / 2;
                                const my = (p.y + next.y) / 2;
                                const dx = next.x - p.x;
                                const dy = next.y - p.y;
                                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                                const nx = dx / len;
                                const ny = dy / len;
                                return (
                                  <circle key={`arr-${i}`} cx={mx + nx * 2} cy={my + ny * 2} r={1.5}
                                    fill="#2dd4bf" opacity={0.8}
                                  />
                                );
                              })}
                              {/* Start dot */}
                              <circle cx={pts[0].x} cy={pts[0].y} r={3} fill="#2dd4bf" opacity={0.9} />
                              {/* End dot */}
                              <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3}
                                fill="#a78bfa" opacity={0.9}
                              />
                            </>
                          );
                        })()}
                      </svg>

                      {/* Path chord list */}
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
                        {buildPathPreview.map((chord, i) => (
                          <div key={i} style={{
                            fontSize: 10,
                            fontFamily: "'SF Mono', 'Fira Code', monospace",
                            color: i === 0 ? '#2dd4bf' : i === buildPathPreview!.length - 1 ? '#a78bfa' : '#94a3b8',
                            fontWeight: (i === 0 || i === buildPathPreview!.length - 1) ? 700 : 400,
                            display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            <span style={{
                              width: 14, height: 14, borderRadius: '50%',
                              background: i === 0 ? 'rgba(45,212,191,0.2)' : i === buildPathPreview!.length - 1 ? 'rgba(167,139,250,0.2)' : 'rgba(100,116,139,0.1)',
                              border: `1px solid ${i === 0 ? 'rgba(45,212,191,0.4)' : i === buildPathPreview!.length - 1 ? 'rgba(167,139,250,0.4)' : 'rgba(100,116,139,0.2)'}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 7, color: '#64748b',
                            }}>{i + 1}</span>
                            {chord}
                            {i < buildPathPreview!.length - 1 && <span style={{ color: '#334155', marginLeft: 2 }}>→</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Generate + AI buttons */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleBuildPath}
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      fontSize: 11,
                      fontFamily: "'SF Mono', 'Fira Code', monospace",
                      fontWeight: 700,
                      background: 'rgba(45, 212, 191, 0.15)',
                      border: '1px solid rgba(45, 212, 191, 0.4)',
                      borderRadius: 6,
                      color: '#2dd4bf',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Generate
                  </button>
                  <button
                    onClick={handleBuildPathAI}
                    disabled={buildPathLoading}
                    style={{
                      padding: '6px 12px',
                      fontSize: 11,
                      fontFamily: "'SF Mono', 'Fira Code', monospace",
                      fontWeight: 600,
                      background: buildPathLoading
                        ? 'rgba(100, 116, 139, 0.15)'
                        : 'rgba(251, 191, 36, 0.1)',
                      border: `1px solid ${buildPathLoading
                        ? 'rgba(100, 116, 139, 0.3)'
                        : 'rgba(251, 191, 36, 0.3)'}`,
                      borderRadius: 6,
                      color: buildPathLoading ? '#64748b' : '#fbbf24',
                      cursor: buildPathLoading ? 'wait' : 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {buildPathLoading ? 'Asking...' : 'AI Suggest'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Import dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowImportMenu(!showImportMenu); setShowBuildPath(false); }}
              style={{
                padding: '5px 12px',
                fontSize: 11,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontWeight: 600,
                background: 'rgba(244, 114, 182, 0.12)',
                border: '1px solid rgba(244, 114, 182, 0.3)',
                borderRadius: 6,
                color: '#f472b6',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                backdropFilter: 'blur(8px)',
              }}
            >
              Import
            </button>
            {showImportMenu && (
              <div style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 4,
                background: 'rgba(8, 14, 24, 0.95)',
                border: '1px solid rgba(120, 200, 220, 0.2)',
                borderRadius: 8,
                padding: 4,
                minWidth: 260,
                maxHeight: 320,
                overflowY: 'auto',
                backdropFilter: 'blur(12px)',
                zIndex: 100,
              }}>
                {(() => {
                  // Group by genre
                  const byGenre: Record<string, { name: string; artist?: string; index: number }[]> = {};
                  // We'll load the list synchronously since it's static data
                  const progs = [
                    { name: 'Axis of Awesome', genre: 'Pop', index: 0 },
                    { name: '50s Progression', genre: 'Pop', index: 1 },
                    { name: 'Pachelbel\'s Canon', genre: 'Classical', index: 2 },
                    { name: 'Andalusian Cadence', genre: 'Flamenco', index: 3 },
                    { name: '12-Bar Blues', genre: 'Blues', index: 4 },
                    { name: 'Heart and Soul', genre: 'Pop', index: 5 },
                    { name: 'Creep — Radiohead', genre: 'Rock', index: 6 },
                    { name: 'Let It Be — Beatles', genre: 'Rock', index: 7 },
                    { name: 'Jazz ii-V-I', genre: 'Jazz', index: 8 },
                    { name: 'Rhythm Changes', genre: 'Jazz', index: 9 },
                    { name: 'Minor Jazz ii-V-i', genre: 'Jazz', index: 10 },
                    { name: 'Despacito — Luis Fonsi', genre: 'Latin Pop', index: 11 },
                    { name: 'Autumn Leaves', genre: 'Jazz', index: 12 },
                    { name: 'Hallelujah — Leonard Cohen', genre: 'Folk', index: 13 },
                    { name: 'Hotel California — Eagles', genre: 'Rock', index: 14 },
                    { name: 'Knockin\' on Heaven\'s Door', genre: 'Folk Rock', index: 15 },
                    { name: 'Stand By Me', genre: 'R&B', index: 16 },
                    { name: 'No Woman No Cry', genre: 'Reggae', index: 17 },
                  ];
                  progs.forEach(p => {
                    if (!byGenre[p.genre]) byGenre[p.genre] = [];
                    byGenre[p.genre].push(p);
                  });
                  return Object.entries(byGenre).map(([genre, items]) => (
                    <div key={genre}>
                      <div style={{
                        padding: '4px 8px',
                        fontSize: 9,
                        fontFamily: "'SF Mono', 'Fira Code', monospace",
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                      }}>{genre}</div>
                      {items.map(item => (
                        <button
                          key={item.index}
                          onClick={() => handleImportProgression(item.index)}
                          style={{
                            display: 'block',
                            width: '100%',
                            padding: '5px 8px',
                            fontSize: 11,
                            fontFamily: "'SF Mono', 'Fira Code', monospace",
                            background: 'transparent',
                            border: 'none',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            textAlign: 'left' as const,
                            borderRadius: 4,
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(103, 232, 249, 0.1)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right side: Reset + Save */}
        <div style={{ display: 'flex', gap: 4, pointerEvents: 'auto' }}>
          <button
            onClick={handleReset}
            style={{
              padding: '5px 14px',
              fontSize: 11,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontWeight: 600,
              background: 'rgba(120, 200, 220, 0.06)',
              border: '1px solid rgba(120, 200, 220, 0.15)',
              borderRadius: 6,
              color: '#94a3b8',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              backdropFilter: 'blur(8px)',
            }}
          >
            Reset
          </button>
          <button
            onClick={() => {
              const chords = chordProgression;
              if (chords.length === 0) return;
              import('../compositions/CircleOfFifths1').then(mod => {
                mod.exportMidi(chords);
              });
            }}
            style={{
              padding: '5px 14px',
              fontSize: 11,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontWeight: 600,
              background: 'rgba(103, 232, 249, 0.15)',
              border: '1px solid rgba(103, 232, 249, 0.3)',
              borderRadius: 6,
              color: '#67e8f9',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              backdropFilter: 'blur(8px)',
            }}
          >
            Save MIDI
          </button>
        </div>
      </div>

      {/* Close dropdowns on click outside */}
      {(showImportMenu || showBuildPath) && (
        <div
          onClick={() => { setShowImportMenu(false); setShowBuildPath(false); }}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 9,
          }}
        />
      )}
    </div>
  );
};
