import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Player } from '@remotion/player';
import { TonnetzComposition } from '../compositions/Tonnetz';
import type { TonnetzProps } from '../compositions/Tonnetz';
import {
  triangleChord, adjacentTriangles, getSharedEdgeOp, computeVoiceLeading,
  triEquals, findTriangleForChord,
} from '../lib/tonnetz';
import type { TonnetzTriangle, PathStep } from '../lib/tonnetz';
import { GRID_Q_MIN, GRID_Q_MAX, GRID_R_MIN, GRID_R_MAX } from '../lib/tonnetzLayout';
import { chordToMidiNotes } from '../compositions/CircleOfFifths1';
import { onSwiftMessage, onMidiStateChange, BridgeMessages, previewNote } from '../bridge';
import { TONNETZ_LESSONS } from '../lib/tonnetzLessons';
import type { TonnetzLesson, LessonStep } from '../lib/tonnetzLessons';

// ── Bridge payload types ──────────────────────────────────────────────────

interface ChordDetectedPayload {
  chord: string | null;
  root?: string;
  quality?: string;
  notes?: number[];
}

// ── Music theory helpers ──────────────────────────────────────────────────

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ENHARMONIC: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'Gb': 'F#',
  'Cb': 'B', 'Fb': 'E', 'B#': 'C', 'E#': 'F',
};
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_QUALITIES = ['', 'm', 'm', '', '', 'm', 'dim'] as const;
const MINOR_QUALITIES = ['m', 'dim', '', 'm', 'm', '', ''] as const;
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db']);
const ALL_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];

function normalizeRoot(n: string): string { return ENHARMONIC[n] ?? n; }
function rootToChroma(root: string): number { return CHROMATIC.indexOf(normalizeRoot(root)); }

function inferDiatonicChord(midiNote: number, key: string, mode: 'major' | 'minor'): string {
  const rootChroma = rootToChroma(key);
  const noteChroma = midiNote % 12;
  const useFlats = FLAT_KEYS.has(key);
  const chordRoot = useFlats
    ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'][noteChroma]
    : CHROMATIC[noteChroma];
  if (rootChroma < 0) return chordRoot;
  const interval = ((noteChroma - rootChroma) % 12 + 12) % 12;
  const scaleIntervals = mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  const qualities = mode === 'major' ? MAJOR_QUALITIES : MINOR_QUALITIES;
  const degreeIdx = scaleIntervals.indexOf(interval);
  if (degreeIdx < 0) return chordRoot;
  return chordRoot + qualities[degreeIdx];
}

// ── Example progressions ──────────────────────────────────────────────────

interface ExampleProgression {
  name: string;
  description: string;
  chords: string[];
}

const EXAMPLE_PROGRESSIONS: ExampleProgression[] = [
  {
    name: 'Pop Canon (I-V-vi-IV)',
    description: 'The most common pop progression. All moves are P, L, or R — smooth voice leading.',
    chords: ['C', 'G', 'Am', 'F'],
  },
  {
    name: 'Creep (I-III-IV-iv)',
    description: 'Radiohead\'s classic. The III→IV is a chromatic mediant — watch the single note shift.',
    chords: ['C', 'E', 'F', 'Fm'],
  },
  {
    name: 'Axis of Awesome (I-V-vi-IV)',
    description: 'Same as the Canon but try it in different keys — the shape on the Tonnetz stays the same!',
    chords: ['G', 'D', 'Em', 'C'],
  },
  {
    name: 'Descending Fifths (vi-ii-V-I)',
    description: 'Jazz turnaround. Each chord shares two notes with the next — pure R operations.',
    chords: ['Am', 'Dm', 'G', 'C'],
  },
  {
    name: 'PLR Cycle',
    description: 'Parallel → Leading-tone → Relative in a loop. This traces a hexagonal path on the grid.',
    chords: ['C', 'Cm', 'Ab', 'Abm', 'E', 'Em', 'C'],
  },
  {
    name: 'Chromatic Mediant Chain',
    description: 'Major thirds apart — each jump moves just one note by a semitone. Cinematic sound.',
    chords: ['C', 'Ab', 'E', 'C'],
  },
  {
    name: 'Minor Plagal (i-iv-i-V)',
    description: 'Dark and moody. See how minor triads (up triangles) differ from major (down triangles).',
    chords: ['Am', 'Dm', 'Am', 'E'],
  },
  {
    name: 'Pachelbel\'s Canon',
    description: 'The original. 8 chords that trace a beautiful winding path across the lattice.',
    chords: ['C', 'G', 'Am', 'Em', 'F', 'C', 'F', 'G'],
  },
];

// ── Component ──────────────────────────────────────────────────────────────

export const TonnetzPanel: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [compSize, setCompSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
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

  // ── State ─────────────────────────────────────────────────────────────
  const [activeKey, setActiveKey] = useState('C');
  const [activeMode, setActiveMode] = useState<'major' | 'minor'>('major');
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [path, setPath] = useState<PathStep[]>([]);
  const [hoveredTriangle, setHoveredTriangle] = useState<TonnetzTriangle | null>(null);
  const [selectedTriangle, setSelectedTriangle] = useState<TonnetzTriangle | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [bpm, setBpm] = useState(120);
  const playbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [loopRegion, setLoopRegion] = useState<[number, number] | null>(null);

  // Example menu
  const [showExamples, setShowExamples] = useState(false);

  // ── Lesson state ──────────────────────────────────────────────────────
  const [activeLesson, setActiveLesson] = useState<TonnetzLesson | null>(null);
  const [lessonStepIndex, setLessonStepIndex] = useState(0);
  const [lessonStepStartFrame, setLessonStepStartFrame] = useState(0);
  const [lessonPrevHighlights, setLessonPrevHighlights] = useState<TonnetzTriangle[]>([]);
  const [showLessonPicker, setShowLessonPicker] = useState(false);
  const lessonAutoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Frame counters for animation triggers
  const frameCounterRef = useRef(0);
  const [lastAddedFrame, setLastAddedFrame] = useState(-999);
  const [chordDetectedFrame, setChordDetectedFrame] = useState(-999);

  // Tick the frame counter via interval (approximates Remotion's frame)
  useEffect(() => {
    const timer = setInterval(() => { frameCounterRef.current += 1; }, 33); // ~30fps
    return () => clearInterval(timer);
  }, []);

  // ── MIDI / Bridge subscriptions ───────────────────────────────────────

  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.CHORD_DETECTED, (payload: unknown) => {
      const p = payload as ChordDetectedPayload;
      if (p.chord) {
        setChordDetectedFrame(frameCounterRef.current);
        // Find the triangle on the grid matching this chord
        const lastTri = path.length > 0 ? path[path.length - 1].triangle : null;
        const nearQ = lastTri ? lastTri.q : 2;
        const nearR = lastTri ? lastTri.r : 0;
        const tri = findTriangleForChord(p.chord, nearQ, nearR, GRID_Q_MIN, GRID_Q_MAX, GRID_R_MIN, GRID_R_MAX);
        if (tri) {
          addTriangleToPath(tri);
        }
      }
    });
    return unsub;
  }, [path]);

  useEffect(() => {
    const unsub = onMidiStateChange((notes) => {
      setActiveNotes(notes.map((n) => n.note));
    });
    return unsub;
  }, []);

  // Infer diatonic chord from single MIDI notes
  const prevNoteSetRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const hasNewNote = activeNotes.length > 0 &&
      activeNotes.some(n => !prevNoteSetRef.current.has(n));
    prevNoteSetRef.current = new Set(activeNotes);

    if (activeNotes.length === 0) return;
    if (!hasNewNote) return;
    if (activeNotes.length >= 3) return; // let bridge chord detection handle full chords

    const lowest = Math.min(...activeNotes);
    const inferred = inferDiatonicChord(lowest, activeKey, activeMode);
    if (!inferred) return;

    const lastTri = path.length > 0 ? path[path.length - 1].triangle : null;
    const nearQ = lastTri ? lastTri.q : 2;
    const nearR = lastTri ? lastTri.r : 0;
    const tri = findTriangleForChord(inferred, nearQ, nearR, GRID_Q_MIN, GRID_Q_MAX, GRID_R_MIN, GRID_R_MAX);
    if (tri) {
      // Only auto-add if it's adjacent to the current position (for smoother path building)
      if (lastTri) {
        const op = getSharedEdgeOp(lastTri, tri);
        if (!op) return; // not adjacent, skip single-note inferences that jump
      }
      addTriangleToPath(tri);
    }
  }, [activeNotes, activeKey, activeMode]);

  // ── Path management ─────────────────────────────────────────────────

  const addTriangleToPath = useCallback((tri: TonnetzTriangle) => {
    setPath(prev => {
      // Don't add the same triangle twice in a row
      if (prev.length > 0 && triEquals(prev[prev.length - 1].triangle, tri)) return prev;

      const chord = triangleChord(tri);
      const lastStep = prev.length > 0 ? prev[prev.length - 1] : null;
      const operation = lastStep ? (getSharedEdgeOp(lastStep.triangle, tri) ?? undefined) : undefined;
      const voiceLeading = lastStep ? (computeVoiceLeading(lastStep.triangle, tri) ?? undefined) : undefined;

      const step: PathStep = { triangle: tri, chord, operation, voiceLeading };
      return [...prev, step].slice(-32);
    });
    setSelectedTriangle(tri);
    setLastAddedFrame(frameCounterRef.current);

    // Play the chord audio
    const chord = triangleChord(tri);
    const notes = chordToMidiNotes(chord.name);
    notes.forEach(n => previewNote(n, 90));
  }, []);

  const handleClickTriangle = useCallback((tri: TonnetzTriangle) => {
    addTriangleToPath(tri);
  }, [addTriangleToPath]);

  const handleHoverTriangle = useCallback((tri: TonnetzTriangle | null) => {
    setHoveredTriangle(tri);
  }, []);

  // ── Playback ──────────────────────────────────────────────────────────

  const playChordAudio = useCallback((chord: string) => {
    const notes = chordToMidiNotes(chord);
    notes.forEach(n => previewNote(n, 90));
  }, []);

  const handlePlayback = useCallback(() => {
    if (isPlaying) {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      setIsPlaying(false);
      setPlaybackIndex(-1);
      return;
    }
    if (path.length === 0) return;

    setIsPlaying(true);
    const startIdx = loopRegion ? loopRegion[0] : 0;
    const endIdx = loopRegion ? loopRegion[1] : path.length - 1;
    let currentIdx = startIdx;
    setPlaybackIndex(currentIdx);
    setSelectedTriangle(path[currentIdx].triangle);
    playChordAudio(path[currentIdx].chord.name);

    const msPerBeat = (60 / bpm) * 1000;
    playbackTimerRef.current = setInterval(() => {
      currentIdx++;
      if (currentIdx > endIdx) {
        if (loopRegion) {
          currentIdx = loopRegion[0];
        } else {
          clearInterval(playbackTimerRef.current!);
          playbackTimerRef.current = null;
          setIsPlaying(false);
          setPlaybackIndex(-1);
          return;
        }
      }
      setPlaybackIndex(currentIdx);
      setSelectedTriangle(path[currentIdx].triangle);
      playChordAudio(path[currentIdx].chord.name);
    }, msPerBeat);
  }, [isPlaying, path, bpm, loopRegion, playChordAudio]);

  const handleReset = useCallback(() => {
    if (playbackTimerRef.current) {
      clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    setIsPlaying(false);
    setPlaybackIndex(-1);
    setLoopRegion(null);
    setPath([]);
    setSelectedTriangle(null);
    setHoveredTriangle(null);
  }, []);

  const handleUndo = useCallback(() => {
    setPath(prev => {
      const next = prev.slice(0, -1);
      if (next.length > 0) {
        setSelectedTriangle(next[next.length - 1].triangle);
      } else {
        setSelectedTriangle(null);
      }
      return next;
    });
  }, []);

  const handleToggleLoop = useCallback(() => {
    if (loopRegion) {
      setLoopRegion(null);
    } else if (path.length >= 2) {
      setLoopRegion([0, path.length - 1]);
    }
  }, [loopRegion, path]);

  const handleLoadExample = useCallback((example: ExampleProgression) => {
    // Stop playback if running
    if (playbackTimerRef.current) {
      clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    setIsPlaying(false);
    setPlaybackIndex(-1);
    setLoopRegion(null);
    setShowExamples(false);

    // Build the path by finding triangles for each chord
    const newPath: PathStep[] = [];
    for (const chordName of example.chords) {
      const lastTri = newPath.length > 0 ? newPath[newPath.length - 1].triangle : null;
      const nearQ = lastTri ? lastTri.q : 2;
      const nearR = lastTri ? lastTri.r : 0;
      const tri = findTriangleForChord(chordName, nearQ, nearR, GRID_Q_MIN, GRID_Q_MAX, GRID_R_MIN, GRID_R_MAX);
      if (tri) {
        const chord = triangleChord(tri);
        const operation = lastTri ? (getSharedEdgeOp(lastTri, tri) ?? undefined) : undefined;
        const voiceLeading = lastTri ? (computeVoiceLeading(lastTri, tri) ?? undefined) : undefined;
        newPath.push({ triangle: tri, chord, operation, voiceLeading });
      }
    }

    setPath(newPath);
    if (newPath.length > 0) {
      setSelectedTriangle(newPath[newPath.length - 1].triangle);
      setLastAddedFrame(frameCounterRef.current);
    }
  }, []);

  // ── Lesson navigation ──────────────────────────────────────────────────

  const startLesson = useCallback((lesson: TonnetzLesson) => {
    // Stop any playback
    if (playbackTimerRef.current) { clearInterval(playbackTimerRef.current); playbackTimerRef.current = null; }
    if (lessonAutoTimerRef.current) { clearTimeout(lessonAutoTimerRef.current); lessonAutoTimerRef.current = null; }
    setIsPlaying(false);
    setPlaybackIndex(-1);
    setPath([]);
    setSelectedTriangle(null);
    setHoveredTriangle(null);
    setShowLessonPicker(false);
    setShowExamples(false);

    // Set key/mode
    setActiveKey(lesson.startKey);
    setActiveMode(lesson.startMode);

    // Start lesson
    setActiveLesson(lesson);
    setLessonStepIndex(0);
    setLessonPrevHighlights([]);
    setLessonStepStartFrame(frameCounterRef.current);

    // Auto-advance if first step has autoDuration
    const firstStep = lesson.steps[0];
    if (firstStep?.playChord) {
      const notes = chordToMidiNotes(firstStep.playChord);
      notes.forEach(n => previewNote(n, 80));
    }
    if (firstStep?.autoDuration && firstStep.autoDuration > 0) {
      lessonAutoTimerRef.current = setTimeout(() => advanceLessonStep(lesson, 0), firstStep.autoDuration);
    }
  }, []);

  const advanceLessonStep = useCallback((lesson: TonnetzLesson, currentIdx: number) => {
    if (lessonAutoTimerRef.current) { clearTimeout(lessonAutoTimerRef.current); lessonAutoTimerRef.current = null; }

    const nextIdx = currentIdx + 1;
    if (nextIdx >= lesson.steps.length) {
      // Lesson complete
      setActiveLesson(null);
      return;
    }

    const currentStep = lesson.steps[currentIdx];
    const nextStep = lesson.steps[nextIdx];

    // Save current highlights as prev for trail drawing
    setLessonPrevHighlights(currentStep?.highlights ?? []);
    setLessonStepIndex(nextIdx);
    setLessonStepStartFrame(frameCounterRef.current);

    // Play chord if specified
    if (nextStep.playChord) {
      const notes = chordToMidiNotes(nextStep.playChord);
      notes.forEach(n => previewNote(n, 80));
    }

    // Auto-advance if step has autoDuration
    if (nextStep.autoDuration && nextStep.autoDuration > 0) {
      lessonAutoTimerRef.current = setTimeout(() => advanceLessonStep(lesson, nextIdx), nextStep.autoDuration);
    }
  }, []);

  const handleLessonNext = useCallback(() => {
    if (!activeLesson) return;
    advanceLessonStep(activeLesson, lessonStepIndex);
  }, [activeLesson, lessonStepIndex, advanceLessonStep]);

  const handleLessonPrev = useCallback(() => {
    if (!activeLesson || lessonStepIndex <= 0) return;
    if (lessonAutoTimerRef.current) { clearTimeout(lessonAutoTimerRef.current); lessonAutoTimerRef.current = null; }

    const prevIdx = lessonStepIndex - 1;
    const prevStep = activeLesson.steps[prevIdx];
    setLessonPrevHighlights(prevIdx > 0 ? activeLesson.steps[prevIdx - 1].highlights : []);
    setLessonStepIndex(prevIdx);
    setLessonStepStartFrame(frameCounterRef.current);

    if (prevStep.playChord) {
      const notes = chordToMidiNotes(prevStep.playChord);
      notes.forEach(n => previewNote(n, 80));
    }
    // Don't auto-advance when going back
  }, [activeLesson, lessonStepIndex]);

  const handleLessonExit = useCallback(() => {
    if (lessonAutoTimerRef.current) { clearTimeout(lessonAutoTimerRef.current); lessonAutoTimerRef.current = null; }
    setActiveLesson(null);
    setLessonStepIndex(0);
    setLessonPrevHighlights([]);
  }, []);

  useEffect(() => {
    return () => {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
      if (lessonAutoTimerRef.current) clearTimeout(lessonAutoTimerRef.current);
    };
  }, []);

  // Current lesson step
  const currentLessonStep: LessonStep | null = activeLesson ? activeLesson.steps[lessonStepIndex] ?? null : null;

  // ── Composition props ─────────────────────────────────────────────────
  const inputProps: TonnetzProps = useMemo(() => ({
    activeKey,
    activeMode,
    activeNotes,
    path,
    hoveredTriangle,
    selectedTriangle,
    playbackIndex,
    onClickTriangle: handleClickTriangle,
    onHoverTriangle: handleHoverTriangle,
    lastAddedFrame,
    chordDetectedFrame,
    // Lesson overlay
    lessonStep: currentLessonStep,
    lessonStepIndex,
    lessonStepStartFrame,
    lessonTotalSteps: activeLesson?.steps.length ?? 0,
    lessonAccentColor: activeLesson?.accentColor ?? '#67e8f9',
    lessonTitle: activeLesson?.title ?? '',
    lessonActive: !!activeLesson,
    lessonPrevHighlights,
  }), [activeKey, activeMode, activeNotes, path, hoveredTriangle, selectedTriangle, playbackIndex, handleClickTriangle, handleHoverTriangle, lastAddedFrame, chordDetectedFrame, currentLessonStep, lessonStepIndex, lessonStepStartFrame, activeLesson, lessonPrevHighlights]);

  // ── Button style helper ───────────────────────────────────────────────
  const btnStyle = (active: boolean, color = '#67e8f9'): React.CSSProperties => ({
    padding: '5px 12px',
    fontSize: 11,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontWeight: active ? 700 : 500,
    background: active ? `${color}20` : 'rgba(120, 200, 220, 0.04)',
    border: `1px solid ${active ? `${color}66` : 'rgba(120, 200, 220, 0.1)'}`,
    borderRadius: 6,
    color: active ? color : '#64748b',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    backdropFilter: 'blur(8px)',
  });

  // Path summary string
  const pathSummary = useMemo(() => {
    if (path.length === 0) return '';
    return path.map((s, i) => {
      const op = i > 0 && s.operation ? ` ${s.operation}→` : '';
      return `${op}${s.chord.name}`;
    }).join(' ');
  }, [path]);

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
          component={TonnetzComposition}
          inputProps={inputProps}
          compositionWidth={compSize.w}
          compositionHeight={compSize.h}
          fps={30}
          durationInFrames={9000}
          loop
          autoPlay
          controls={false}
          style={{ width: '100%', height: '100%' }}
        />
      )}

      {/* ── Top bar: Key selector + Mode toggle ── */}
      <div style={{
        position: 'absolute', top: 8, left: 8, right: 8,
        display: 'flex', alignItems: 'center', gap: 6,
        zIndex: 10, pointerEvents: 'none',
      }}>
        {/* Key selector */}
        <div style={{ display: 'flex', gap: 2, pointerEvents: 'auto' }}>
          {ALL_KEYS.map((k) => (
            <button key={k} onClick={() => setActiveKey(k)} style={{
              padding: '3px 7px', fontSize: 11,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontWeight: k === activeKey ? 700 : 400,
              background: k === activeKey ? 'rgba(103, 232, 249, 0.25)' : 'rgba(120, 200, 220, 0.04)',
              border: `1px solid ${k === activeKey ? 'rgba(103, 232, 249, 0.5)' : 'rgba(120, 200, 220, 0.08)'}`,
              borderRadius: 4,
              color: k === activeKey ? '#67e8f9' : '#64748b',
              cursor: 'pointer', transition: 'all 0.15s ease',
              backdropFilter: 'blur(8px)', minWidth: 28, textAlign: 'center',
            }}>
              {k}
            </button>
          ))}
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 2, pointerEvents: 'auto' }}>
          {(['major', 'minor'] as const).map((m) => (
            <button key={m} onClick={() => setActiveMode(m)} style={{
              padding: '3px 10px', fontSize: 11,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontWeight: m === activeMode ? 700 : 400,
              background: m === activeMode
                ? (m === 'minor' ? 'rgba(167, 139, 250, 0.25)' : 'rgba(103, 232, 249, 0.25)')
                : 'rgba(120, 200, 220, 0.04)',
              border: `1px solid ${m === activeMode
                ? (m === 'minor' ? 'rgba(167, 139, 250, 0.5)' : 'rgba(103, 232, 249, 0.5)')
                : 'rgba(120, 200, 220, 0.08)'}`,
              borderRadius: 4,
              color: m === activeMode ? (m === 'minor' ? '#a78bfa' : '#67e8f9') : '#64748b',
              cursor: 'pointer', transition: 'all 0.15s ease',
              backdropFilter: 'blur(8px)', textTransform: 'capitalize',
            }}>
              {m}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Path summary */}
        {path.length > 0 && (
          <span style={{
            pointerEvents: 'auto', fontSize: 10,
            fontFamily: "'SF Mono', monospace", color: '#475569',
            padding: '3px 8px',
            background: 'rgba(10, 14, 26, 0.6)',
            borderRadius: 4, border: '1px solid rgba(120, 200, 220, 0.08)',
            backdropFilter: 'blur(8px)',
            maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {pathSummary}
          </span>
        )}
      </div>

      {/* ── Bottom controls ── */}
      <div style={{
        position: 'absolute', bottom: 12, left: 12, right: 12,
        display: 'flex', alignItems: 'center', gap: 6,
        zIndex: 10, pointerEvents: 'none',
      }}>
        {/* Playback controls */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', pointerEvents: 'auto' }}>
          <button onClick={handlePlayback} style={btnStyle(isPlaying, isPlaying ? '#f43f5e' : '#2dd4bf')}>
            {isPlaying ? 'Stop' : 'Play'}
          </button>
          <button onClick={handleToggleLoop} style={btnStyle(!!loopRegion, '#fbbf24')}>
            Loop
          </button>

          {/* BPM */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px',
            background: 'rgba(120, 200, 220, 0.04)',
            border: '1px solid rgba(120, 200, 220, 0.1)',
            borderRadius: 6, backdropFilter: 'blur(8px)',
          }}>
            <span style={{ fontSize: 10, fontFamily: "'SF Mono', monospace", color: '#64748b' }}>BPM</span>
            <input
              type="range" min={40} max={240} value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
              style={{ width: 60, height: 14, accentColor: '#67e8f9' }}
            />
            <span style={{
              fontSize: 11, fontFamily: "'SF Mono', monospace",
              color: '#67e8f9', fontWeight: 700, minWidth: 28, textAlign: 'right',
            }}>{bpm}</span>
          </div>
        </div>

        {/* Examples */}
        <div style={{ position: 'relative', pointerEvents: 'auto' }}>
          <button
            onClick={() => { setShowExamples(!showExamples); setShowLessonPicker(false); }}
            style={btnStyle(showExamples, '#a78bfa')}
          >
            Examples
          </button>
          {showExamples && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
              background: 'rgba(8, 14, 24, 0.95)',
              border: '1px solid rgba(167, 139, 250, 0.25)',
              borderRadius: 8, padding: 8, minWidth: 320, maxHeight: 340, overflowY: 'auto',
              backdropFilter: 'blur(12px)', zIndex: 100,
            }}>
              <div style={{
                fontSize: 10, fontFamily: "'SF Mono', monospace", color: '#64748b',
                textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, padding: '0 4px',
              }}>
                Example Progressions
              </div>
              {EXAMPLE_PROGRESSIONS.map((ex, i) => (
                <button key={i} onClick={() => handleLoadExample(ex)} style={{
                  display: 'block', width: '100%', padding: '8px 10px',
                  fontSize: 11, fontFamily: "'SF Mono', monospace",
                  background: 'transparent',
                  border: 'none', borderRadius: 4,
                  color: '#e2e8f0', cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(167,139,250,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ color: '#a78bfa', fontWeight: 700 }}>{ex.name}</span>
                  <br />
                  <span style={{ color: '#64748b', fontSize: 9, lineHeight: '14px' }}>{ex.description}</span>
                  <br />
                  <span style={{ color: '#475569', fontSize: 9 }}>{ex.chords.join(' → ')}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Guided Lessons */}
        <div style={{ position: 'relative', pointerEvents: 'auto' }}>
          <button
            onClick={() => { setShowLessonPicker(!showLessonPicker); setShowExamples(false); }}
            style={btnStyle(showLessonPicker || !!activeLesson, '#f472b6')}
          >
            {activeLesson ? `Lesson: ${activeLesson.title}` : 'Lessons'}
          </button>
          {showLessonPicker && !activeLesson && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
              background: 'rgba(8, 14, 24, 0.95)',
              border: '1px solid rgba(244, 114, 182, 0.25)',
              borderRadius: 10, padding: 10, minWidth: 360, maxHeight: 400, overflowY: 'auto',
              backdropFilter: 'blur(16px)', zIndex: 100,
            }}>
              <div style={{
                fontSize: 10, fontFamily: "'SF Mono', monospace", color: '#64748b',
                textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8, padding: '0 4px',
              }}>
                Guided Lessons
              </div>
              {TONNETZ_LESSONS.map((lesson) => (
                <button key={lesson.id} onClick={() => startLesson(lesson)} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  width: '100%', padding: '10px 10px',
                  fontSize: 11, fontFamily: "'SF Mono', monospace",
                  background: 'transparent',
                  border: 'none', borderRadius: 6,
                  color: '#e2e8f0', cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(244,114,182,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Icon */}
                  <span style={{
                    fontSize: 20, lineHeight: '24px', minWidth: 28, textAlign: 'center',
                    color: lesson.accentColor, filter: 'drop-shadow(0 0 4px ' + lesson.accentColor + '40)',
                  }}>
                    {lesson.icon}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: lesson.accentColor, fontWeight: 700, fontSize: 12 }}>
                        {lesson.title}
                      </span>
                      <span style={{ fontSize: 8, color: '#475569' }}>
                        {lesson.durationMin}min
                      </span>
                      <span style={{ fontSize: 8, color: '#475569' }}>
                        {'●'.repeat(lesson.difficulty)}{'○'.repeat(3 - lesson.difficulty)}
                      </span>
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 2 }}>
                      {lesson.subtitle}
                    </div>
                    <div style={{ color: '#475569', fontSize: 9, marginTop: 2 }}>
                      {lesson.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Right side: lesson nav OR Undo + Reset */}
        {activeLesson ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', pointerEvents: 'auto' }}>
            <button onClick={handleLessonPrev} disabled={lessonStepIndex <= 0}
              style={{ ...btnStyle(false, '#94a3b8'), opacity: lessonStepIndex <= 0 ? 0.3 : 1 }}>
              Back
            </button>
            <button onClick={handleLessonNext}
              style={btnStyle(false, activeLesson.accentColor)}>
              {lessonStepIndex >= activeLesson.steps.length - 1 ? 'Finish' : 'Next'}
            </button>
            <button onClick={handleLessonExit}
              style={btnStyle(false, '#f43f5e')}>
              Exit
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', pointerEvents: 'auto' }}>
            <button onClick={handleUndo} disabled={path.length === 0}
              style={{ ...btnStyle(false, '#94a3b8'), opacity: path.length === 0 ? 0.3 : 1 }}>
              Undo
            </button>
            <button onClick={handleReset} style={btnStyle(false, '#f43f5e')}>
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TonnetzPanel;
