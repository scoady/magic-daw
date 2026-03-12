import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Player } from '@remotion/player';
import { onMidiStateChange, onSwiftMessage, BridgeMessages } from '../bridge';
import { CircleTheoryOrbit, type CircleTheoryProps } from '../compositions/CircleTheoryOrbit';
import { CircleTheoryConstellation } from '../compositions/CircleTheoryConstellation';

const COMPOSITIONS = [
  { id: 'orbit', name: 'Theory Orbit', component: CircleTheoryOrbit },
  { id: 'constellation', name: 'Constellation Grid', component: CircleTheoryConstellation },
] as const;

const ALL_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];

type VariantId = (typeof COMPOSITIONS)[number]['id'];
type FocusMode = 'diatonic' | 'chord';
type GuidedMode = 'off' | 'walkthrough';
type ChordListRing = 'major' | 'minor' | 'dim';
type TrailRing = 'major' | 'minor' | 'dim';
interface TrailNode {
  idx: number;
  ring: TrailRing;
}

interface ChordDetectedPayload {
  chord: string | null;
}
interface GuidedLessonStep {
  degree: string;
  name: string;
  ring: TrailRing;
  idx: number;
  rootPc: number;
  requiredPcs: number[];
  prompt: string;
  explanation: string;
}
interface AnalyzedChord {
  idx: number;
  ring: TrailRing;
  label: string;
  pcs: number[];
}

const ENHARMONIC: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'Gb': 'F#',
  'Cb': 'B', 'Fb': 'E', 'B#': 'C', 'E#': 'F',
};

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db']);
const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_KEYS = [1, 3, 6, 8, 10];
const BLACK_POS = [1, 2, 4, 5, 6];

function rootToPitchClass(root: string): number {
  const normalized = ENHARMONIC[root] ?? root;
  let idx = NOTE_NAMES_FLAT.indexOf(normalized);
  if (idx >= 0) return idx;
  idx = NOTE_NAMES_SHARP.indexOf(normalized);
  return idx;
}

function qualityToIntervals(quality: ChordListRing): number[] {
  if (quality === 'major') return [0, 4, 7];
  if (quality === 'minor') return [0, 3, 7];
  return [0, 3, 6];
}

function chordNotesFromRoot(root: string, quality: ChordListRing): number[] {
  const pc = rootToPitchClass(root);
  if (pc < 0) return [];
  return qualityToIntervals(quality).map((i) => (pc + i) % 12);
}

function chordDisplayName(root: string, quality: ChordListRing): string {
  if (quality === 'major') return root;
  if (quality === 'minor') return `${root}m`;
  return `${root}dim`;
}

const MiniOctaveKeyboard: React.FC<{
  notes: number[];
  accent?: string;
  width?: number;
  height?: number;
  noteNames?: string[];
}> = ({ notes, accent = '#67e8f9', width = 132, height = 40 }) => {
  const lit = new Set(notes);
  const whiteW = width / 7;
  const topInset = Math.max(1, height * 0.06);
  const whiteH = height - topInset;
  const blackW = whiteW * 0.36;
  const blackH = height * 0.48;
  const whiteRadius = 1.2;
  const blackRadius = 1.4;
  const gradId = useMemo(() => `kb-white-grad-${Math.random().toString(36).slice(2, 9)}`, []);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(210,230,255,0.34)" />
          <stop offset="100%" stopColor="rgba(120,150,190,0.14)" />
        </linearGradient>
      </defs>
      {WHITE_KEYS.map((pc, i) => (
        <rect
          key={`w-${pc}`}
          x={i * whiteW + 0.6}
          y={topInset}
          width={whiteW - 1.2}
          height={whiteH}
          rx={whiteRadius}
          fill={lit.has(pc) ? accent : `url(#${gradId})`}
          stroke={lit.has(pc) ? 'rgba(255,255,255,0.3)' : 'transparent'}
          strokeWidth={lit.has(pc) ? 0.55 : 0}
          opacity={lit.has(pc) ? 0.94 : 0.68}
        />
      ))}
      {BLACK_KEYS.map((pc, i) => (
        <rect
          key={`b-${pc}`}
          x={BLACK_POS[i] * whiteW - blackW / 2}
          y={topInset * 0.45}
          width={blackW}
          height={blackH}
          rx={blackRadius}
          fill={lit.has(pc) ? accent : '#070b14'}
          stroke={lit.has(pc) ? accent : 'transparent'}
          strokeWidth={lit.has(pc) ? 0.6 : 0}
          opacity={0.98}
        />
      ))}
    </svg>
  );
};

function chordToTrailNode(chord: string): TrailNode | null {
  const m = chord.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  const root = ENHARMONIC[m[1]] ?? m[1];
  const idx = ALL_KEYS.findIndex((k) => k === root);
  if (idx < 0) return null;
  const suffix = (m[2] || '').toLowerCase();
  if (suffix.includes('dim')) return { idx, ring: 'dim' };
  if (suffix.includes('m') && !suffix.includes('maj')) return { idx, ring: 'minor' };
  return { idx, ring: 'major' };
}

function detectTriadFromActiveNotes(activeNotes: number[], noteNames: string[]): AnalyzedChord | null {
  const pcs = [...new Set(activeNotes.map((n) => ((n % 12) + 12) % 12))].sort((a, b) => a - b);
  if (pcs.length !== 3) return null;
  const shapes: Array<{ ring: TrailRing; ints: number[] }> = [
    { ring: 'major', ints: [0, 4, 7] },
    { ring: 'minor', ints: [0, 3, 7] },
    { ring: 'dim', ints: [0, 3, 6] },
  ];
  for (const rootPc of pcs) {
    const intervals = pcs.map((pc) => (pc - rootPc + 12) % 12).sort((a, b) => a - b);
    const hit = shapes.find((s) => s.ints.every((v, i) => intervals[i] === v));
    if (!hit) continue;
    const rootDisplay = noteNames[rootPc];
    const rootCircle = ENHARMONIC[rootDisplay] ?? rootDisplay;
    const idx = ALL_KEYS.findIndex((k) => k === rootCircle);
    if (idx < 0) continue;
    return {
      idx,
      ring: hit.ring,
      label: chordDisplayName(rootDisplay, hit.ring),
      pcs,
    };
  }
  return null;
}

export const CircleOfFifthsPanel: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [compSize, setCompSize] = useState<{ w: number; h: number } | null>(null);

  const [activeKey, setActiveKey] = useState('C');
  const [activeMode, setActiveMode] = useState<'major' | 'minor'>('major');
  const [variant, setVariant] = useState<VariantId>('orbit');
  const [focusMode, setFocusMode] = useState<FocusMode>('diatonic');
  const [guidedMode, setGuidedMode] = useState<GuidedMode>('off');
  const [guidedStep, setGuidedStep] = useState(0);
  const [showDegrees, setShowDegrees] = useState(true);
  const [lessonBanner, setLessonBanner] = useState<string | null>(null);
  const [lessonError, setLessonError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [conceptOverlay, setConceptOverlay] = useState(false);
  const [lastRelation, setLastRelation] = useState('Play a chord to reveal circle movement.');
  const [chordListRing, setChordListRing] = useState<ChordListRing>('major');
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [detectedChord, setDetectedChord] = useState<string | null>(null);
  const [analyzedChord, setAnalyzedChord] = useState<AnalyzedChord | null>(null);
  const [trailNodes, setTrailNodes] = useState<TrailNode[]>([]);

  useEffect(() => {
    const unsubMidi = onMidiStateChange((notes) => {
      setActiveNotes(notes.map((n) => n.note));
    });
    const unsubChord = onSwiftMessage(BridgeMessages.CHORD_DETECTED, (payload: unknown) => {
      const p = payload as ChordDetectedPayload;
      setDetectedChord(p.chord ?? null);
    });
    return () => {
      unsubMidi();
      unsubChord();
    };
  }, []);

  useEffect(() => {
    setTrailNodes([]);
    setGuidedStep(0);
    setConceptOverlay(false);
    setLastRelation('Play a chord to reveal circle movement.');
    setLessonError(null);
  }, [activeKey, activeMode, focusMode]);

  useEffect(() => {
    let next: TrailNode | null = null;
    if (guidedMode === 'walkthrough') return;
    if (focusMode === 'chord') {
      if (analyzedChord) next = { idx: analyzedChord.idx, ring: analyzedChord.ring };
    } else if (detectedChord) {
      next = chordToTrailNode(detectedChord);
    }
    if (!next) return;

    setTrailNodes((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.idx === next!.idx && last.ring === next!.ring) return prev;
      if (last) {
        const cw = (next!.idx - last.idx + 12) % 12;
        if (last.idx === next!.idx && last.ring !== next!.ring) {
          setLastRelation('Same spoke: relative major/minor function shift.');
        } else if (cw === 1) {
          setLastRelation('Clockwise by one step: up a perfect 5th.');
        } else if (cw === 11) {
          setLastRelation('Counter-clockwise by one step: up a perfect 4th.');
        } else if (cw > 0 && cw < 6) {
          setLastRelation(`Clockwise by ${cw} steps on the fifths wheel.`);
        } else if (cw > 6) {
          setLastRelation(`Counter-clockwise by ${12 - cw} steps on the fifths wheel.`);
        } else {
          setLastRelation('Reinforcing the same harmonic center.');
        }
      }
      return [...prev, next!].slice(-18);
    });
  }, [detectedChord, activeNotes, guidedMode, focusMode, analyzedChord]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setCompSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    }
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setCompSize({ w: Math.round(width), h: Math.round(height) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const CompositionComponent = useMemo(
    () => COMPOSITIONS.find((c) => c.id === variant)?.component ?? CircleTheoryOrbit,
    [variant],
  );

  const useFlats = FLAT_KEYS.has(activeKey);
  const noteNames = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  const tonicPc = rootToPitchClass(activeKey);

  useEffect(() => {
    setAnalyzedChord(detectTriadFromActiveNotes(activeNotes, noteNames));
  }, [activeNotes, noteNames]);

  const diatonicScale = useMemo(() => {
    if (tonicPc < 0) return [];
    const intervals = activeMode === 'major'
      ? [0, 2, 4, 5, 7, 9, 11]
      : [0, 2, 3, 5, 7, 8, 10];
    return intervals.map((i) => (tonicPc + i) % 12);
  }, [tonicPc, activeMode]);

  const diatonicChordRows = useMemo(() => {
    if (tonicPc < 0) return [];
    const intervals = activeMode === 'major'
      ? [0, 2, 4, 5, 7, 9, 11]
      : [0, 2, 3, 5, 7, 8, 10];
    const qualities = activeMode === 'major'
      ? (['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim'] as ChordListRing[])
      : (['minor', 'dim', 'major', 'minor', 'minor', 'major', 'major'] as ChordListRing[]);
    const labels = activeMode === 'major'
      ? ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
      : ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
    return intervals.map((iv, i) => {
      const rootPc = (tonicPc + iv) % 12;
      const root = noteNames[rootPc];
      const quality = qualities[i];
      return {
        degree: labels[i],
        name: chordDisplayName(root, quality),
        notes: chordNotesFromRoot(root, quality),
        quality,
      };
    });
  }, [tonicPc, activeMode, noteNames]);

  const allCircleChords = useMemo(() => {
    return ALL_KEYS.map((root) => ({
      root,
      name: chordDisplayName(root, chordListRing),
      notes: chordNotesFromRoot(root, chordListRing),
    }));
  }, [chordListRing]);

  const chordNoteNames = (notes: number[]) => notes.map((pc) => noteNames[pc]).join(' ');

  const guidedLesson = useMemo<GuidedLessonStep[]>(() => {
    if (tonicPc < 0) return [];
    const intervals = activeMode === 'major'
      ? [0, 2, 4, 5, 7, 9, 11]
      : [0, 2, 3, 5, 7, 8, 10];
    const qualities = activeMode === 'major'
      ? (['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim'] as TrailRing[])
      : (['minor', 'dim', 'major', 'minor', 'minor', 'major', 'major'] as TrailRing[]);
    const degreeLabels = activeMode === 'major'
      ? ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
      : ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
    const majorScript = [
      { index: 0, prompt: 'Start at tonic.', explanation: 'Tonic is home. It sets the emotional center.' },
      { index: 5, prompt: 'Now play the relative minor.', explanation: 'Relative minor shares notes with tonic, so the mood shifts without leaving the key.' },
      { index: 1, prompt: 'Play the pre-dominant chord.', explanation: 'ii builds momentum and points toward dominant function.' },
      { index: 4, prompt: 'Play dominant.', explanation: 'V creates the strongest pull back to tonic.' },
      { index: 0, prompt: 'Resolve to tonic.', explanation: 'Resolution completes the harmonic story and confirms the key center.' },
    ];
    const minorScript = [
      { index: 0, prompt: 'Start at tonic minor.', explanation: 'Minor tonic defines the dark center of gravity.' },
      { index: 5, prompt: 'Now play VI.', explanation: 'VI is a stable color chord inside the same minor world.' },
      { index: 3, prompt: 'Play iv.', explanation: 'iv expands space before dominant tension.' },
      { index: 4, prompt: 'Play v.', explanation: 'v pushes the phrase toward resolution.' },
      { index: 0, prompt: 'Resolve to i.', explanation: 'Returning to i closes the phrase with clear tonal identity.' },
    ];
    const script = activeMode === 'major' ? majorScript : minorScript;
    return script.map((step) => {
      const iv = intervals[step.index];
      const quality = qualities[step.index];
      const degree = degreeLabels[step.index];
      const rootPc = (tonicPc + iv) % 12;
      const rootDisplay = noteNames[rootPc];
      const rootCircle = ENHARMONIC[rootDisplay] ?? rootDisplay;
      const idx = ALL_KEYS.findIndex((k) => k === rootCircle);
      return {
        degree,
        name: chordDisplayName(rootDisplay, quality as ChordListRing),
        ring: quality,
        idx,
        rootPc,
        requiredPcs: chordNotesFromRoot(rootDisplay, quality as ChordListRing),
        prompt: step.prompt,
        explanation: step.explanation,
      };
    }).filter((s) => s.idx >= 0);
  }, [tonicPc, activeMode, noteNames]);

  const activeGuidedStep = guidedLesson.length > 0 ? guidedLesson[guidedStep % guidedLesson.length] : null;
  const advanceLockRef = useRef(0);
  const matchStartRef = useRef<{ step: number; t: number } | null>(null);

  useEffect(() => {
    if (!lessonBanner) return;
    const id = window.setTimeout(() => setLessonBanner(null), 2400);
    return () => window.clearTimeout(id);
  }, [lessonBanner]);

  useEffect(() => {
    if (!lessonError) return;
    const id = window.setTimeout(() => setLessonError(null), 1800);
    return () => window.clearTimeout(id);
  }, [lessonError]);

  useEffect(() => {
    matchStartRef.current = null;
  }, [guidedStep, activeKey, activeMode]);

  useEffect(() => {
    if (guidedMode !== 'walkthrough' || !activeGuidedStep || guidedLesson.length === 0) return;
    const now = performance.now();
    const held = new Set(activeNotes.map((n) => ((n % 12) + 12) % 12));
    if (held.size < 3) {
      matchStartRef.current = null;
      return;
    }
    if (!matchStartRef.current || matchStartRef.current.step !== guidedStep) {
      matchStartRef.current = { step: guidedStep, t: now };
      return;
    }
    const heldForMs = now - matchStartRef.current.t;
    if (heldForMs < 120) return;
    if (now - advanceLockRef.current < 900) return;

    const expected = [...activeGuidedStep.requiredPcs].sort((a, b) => a - b);
    const actual = [...held].sort((a, b) => a - b);
    const isExactTriad = expected.length === actual.length && expected.every((pc, i) => pc === actual[i]);
    advanceLockRef.current = now;
    matchStartRef.current = null;

    if (!isExactTriad) {
      setLessonError(`Not a match. Expected ${activeGuidedStep.name} (${expected.map((pc) => noteNames[pc]).join(' - ')}).`);
      return;
    }

    setLessonError(null);
    setLessonBanner(`${activeGuidedStep.degree} ${activeGuidedStep.name}: ${activeGuidedStep.explanation}`);
    setGuidedStep((s) => {
      const nextStep = (s + 1) % guidedLesson.length;
      if (nextStep === 0) {
        setConceptOverlay(true);
        setLessonBanner('Lesson complete: the circle maps fifth-motion tension and resolution around a key center.');
      }
      return nextStep;
    });
  }, [guidedMode, activeGuidedStep, guidedLesson.length, guidedStep, activeNotes, noteNames]);

  const inputProps: CircleTheoryProps = useMemo(
    () => ({
      activeKey,
      activeMode,
      activeNotes,
      detectedChord,
      analysisNode: analyzedChord ? { idx: analyzedChord.idx, ring: analyzedChord.ring } : null,
      analysisLabel: analyzedChord?.label ?? null,
      focusMode,
      trailNodes,
      guidedMode,
      guidedStep,
      showDegrees,
      conceptOverlay,
    }),
    [activeKey, activeMode, activeNotes, detectedChord, analyzedChord, focusMode, trailNodes, guidedMode, guidedStep, showDegrees, conceptOverlay],
  );

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {compSize && (
        <Player
          component={CompositionComponent}
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
        <div style={{ display: 'flex', gap: 2, pointerEvents: 'auto' }}>
          {ALL_KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setActiveKey(k)}
              style={{
                padding: '3px 7px',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                fontWeight: k === activeKey ? 700 : 500,
                background: k === activeKey ? 'rgba(103,232,249,0.2)' : 'rgba(120,200,220,0.05)',
                border: `1px solid ${k === activeKey ? 'rgba(103,232,249,0.45)' : 'rgba(120,200,220,0.12)'}`,
                borderRadius: 4,
                color: k === activeKey ? '#67e8f9' : '#8ca3ba',
                cursor: 'pointer',
              }}
            >
              {k}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 2, pointerEvents: 'auto' }}>
          {(['major', 'minor'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setActiveMode(m)}
              style={{
                padding: '3px 10px',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                fontWeight: m === activeMode ? 700 : 500,
                textTransform: 'capitalize',
                background: m === activeMode
                  ? (m === 'minor' ? 'rgba(167,139,250,0.2)' : 'rgba(103,232,249,0.2)')
                  : 'rgba(120,200,220,0.05)',
                border: `1px solid ${m === activeMode
                  ? (m === 'minor' ? 'rgba(167,139,250,0.45)' : 'rgba(103,232,249,0.45)')
                  : 'rgba(120,200,220,0.12)'}`,
                borderRadius: 4,
                color: m === activeMode ? (m === 'minor' ? '#c4b5fd' : '#67e8f9') : '#8ca3ba',
                cursor: 'pointer',
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 2, pointerEvents: 'auto' }}>
          {([
            { id: 'diatonic' as const, label: 'Diatonic' },
            { id: 'chord' as const, label: 'Chord' },
          ]).map((f) => (
            <button
              key={f.id}
              onClick={() => setFocusMode(f.id)}
              style={{
                padding: '3px 10px',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                fontWeight: f.id === focusMode ? 700 : 500,
                background: f.id === focusMode ? 'rgba(45,212,191,0.2)' : 'rgba(120,200,220,0.05)',
                border: `1px solid ${f.id === focusMode ? 'rgba(45,212,191,0.45)' : 'rgba(120,200,220,0.12)'}`,
                borderRadius: 4,
                color: f.id === focusMode ? '#5eead4' : '#8ca3ba',
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setTrailNodes([])}
          style={{
            pointerEvents: 'auto',
            padding: '3px 10px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            background: 'rgba(120,200,220,0.05)',
            border: '1px solid rgba(120,200,220,0.12)',
            borderRadius: 4,
            color: '#8ca3ba',
            cursor: 'pointer',
          }}
        >
          Clear Trail
        </button>

        <div style={{ display: 'flex', gap: 2, pointerEvents: 'auto' }}>
          <button
            onClick={() => {
              const next = guidedMode === 'walkthrough' ? 'off' : 'walkthrough';
              setGuidedMode(next);
              if (next === 'walkthrough') {
                setGuidedStep(0);
                setLessonBanner(null);
                setConceptOverlay(false);
                setLessonError(null);
              } else {
                setLessonBanner(null);
                setConceptOverlay(false);
                setLessonError(null);
              }
            }}
            style={{
              padding: '3px 10px',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              background: guidedMode === 'walkthrough' ? 'rgba(251,191,36,0.18)' : 'rgba(120,200,220,0.05)',
              border: `1px solid ${guidedMode === 'walkthrough' ? 'rgba(251,191,36,0.46)' : 'rgba(120,200,220,0.12)'}`,
              borderRadius: 4,
              color: guidedMode === 'walkthrough' ? '#fcd34d' : '#8ca3ba',
              cursor: 'pointer',
            }}
          >
            Guided
          </button>
          <button
            onClick={() => {
              setGuidedStep(0);
              setConceptOverlay(false);
              setLessonError(null);
            }}
            disabled={guidedMode !== 'walkthrough'}
            style={{
              padding: '3px 10px',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              background: 'rgba(120,200,220,0.05)',
              border: '1px solid rgba(120,200,220,0.12)',
              borderRadius: 4,
              color: '#8ca3ba',
              cursor: guidedMode === 'walkthrough' ? 'pointer' : 'not-allowed',
              opacity: guidedMode === 'walkthrough' ? 1 : 0.5,
            }}
          >
            Reset Lesson
          </button>
          <button
            onClick={() => setLessonBanner(activeGuidedStep ? `${activeGuidedStep.degree} ${activeGuidedStep.name}: ${activeGuidedStep.explanation}` : null)}
            disabled={guidedMode !== 'walkthrough' || !activeGuidedStep}
            style={{
              padding: '3px 10px',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              background: 'rgba(251,191,36,0.1)',
              border: '1px solid rgba(251,191,36,0.28)',
              borderRadius: 4,
              color: '#fcd34d',
              cursor: guidedMode === 'walkthrough' ? 'pointer' : 'not-allowed',
              opacity: guidedMode === 'walkthrough' ? 1 : 0.5,
            }}
          >
            Show Why
          </button>
          <button
            onClick={() => setShowDegrees((v) => !v)}
            style={{
              padding: '3px 10px',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              background: showDegrees ? 'rgba(103,232,249,0.18)' : 'rgba(120,200,220,0.05)',
              border: `1px solid ${showDegrees ? 'rgba(103,232,249,0.46)' : 'rgba(120,200,220,0.12)'}`,
              borderRadius: 4,
              color: showDegrees ? '#9befff' : '#8ca3ba',
              cursor: 'pointer',
            }}
          >
            Degrees
          </button>
          <button
            onClick={() => setConceptOverlay((v) => !v)}
            style={{
              padding: '3px 10px',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              background: conceptOverlay ? 'rgba(134,239,172,0.18)' : 'rgba(120,200,220,0.05)',
              border: `1px solid ${conceptOverlay ? 'rgba(134,239,172,0.42)' : 'rgba(120,200,220,0.12)'}`,
              borderRadius: 4,
              color: conceptOverlay ? '#86efac' : '#8ca3ba',
              cursor: 'pointer',
            }}
          >
            Concept Lens
          </button>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', gap: 4, pointerEvents: 'auto' }}>
          {COMPOSITIONS.map((c) => (
            <button
              key={c.id}
              onClick={() => setVariant(c.id)}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                fontWeight: c.id === variant ? 700 : 600,
                background: c.id === variant ? 'rgba(103,232,249,0.18)' : 'rgba(120,200,220,0.05)',
                border: `1px solid ${c.id === variant ? 'rgba(103,232,249,0.5)' : 'rgba(120,200,220,0.15)'}`,
                borderRadius: 8,
                color: c.id === variant ? '#9befff' : '#9aaec3',
                cursor: 'pointer',
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => setSidebarCollapsed((v) => !v)}
        style={{
          position: 'absolute',
          top: 138,
          right: sidebarCollapsed ? 10 : 510,
          zIndex: 14,
          width: 26,
          height: 92,
          borderRadius: 8,
          border: '1px solid rgba(110,170,210,0.28)',
          background: 'rgba(8,16,30,0.85)',
          color: '#9fdaf6',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 700,
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
          letterSpacing: '0.05em',
          transition: 'right 220ms ease',
        }}
      >
        {sidebarCollapsed ? 'SHOW KEYS' : 'HIDE KEYS'}
      </button>

      <div
        style={{
          position: 'absolute',
          top: 48,
          right: 10,
          bottom: 10,
          width: 500,
          zIndex: 10,
          pointerEvents: sidebarCollapsed ? 'none' : 'auto',
          borderRadius: 10,
          border: '1px solid rgba(110,170,210,0.24)',
          background: 'rgba(7,14,26,0.78)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: `translateX(${sidebarCollapsed ? 520 : 0}px)`,
          transition: 'transform 220ms ease',
        }}
      >
        <div
          style={{
            padding: '10px 12px',
            borderBottom: '1px solid rgba(110,170,210,0.22)',
            color: '#d6ecff',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.04em',
          }}
        >
          CHORD + SCALE INFOGRAPH
        </div>

        <div style={{ overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              border: '1px solid rgba(110,170,210,0.18)',
              borderRadius: 8,
              padding: 10,
              background: 'rgba(10,19,34,0.55)',
            }}
          >
            <div style={{ color: '#d6ecff', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>
              DIATONIC NOTES ({activeKey} {activeMode})
            </div>
            <div style={{ marginTop: 8 }}>
              <MiniOctaveKeyboard notes={diatonicScale} accent={activeMode === 'minor' ? '#a78bfa' : '#67e8f9'} width={430} height={72} />
            </div>
            <div style={{ marginTop: 6, color: '#8fb0ca', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
              {diatonicScale.map((pc) => noteNames[pc]).join('  ')}
            </div>
          </div>

          <div
            style={{
              border: '1px solid rgba(110,170,210,0.18)',
              borderRadius: 8,
              padding: 10,
              background: 'rgba(10,19,34,0.55)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ color: '#d6ecff', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>
              DIATONIC CHORDS
            </div>
            {diatonicChordRows.map((row) => (
              <div
                key={`dc-${row.degree}-${row.name}`}
                style={{
                  border: '1px solid rgba(110,170,210,0.15)',
                  borderRadius: 7,
                  padding: 8,
                  background: 'rgba(8,16,30,0.66)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: '#8fb0ca', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{row.degree}</span>
                  <span style={{ color: '#d6ecff', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>{row.name}</span>
                </div>
                <MiniOctaveKeyboard notes={row.notes} width={430} height={72} accent={row.quality === 'major' ? '#67e8f9' : row.quality === 'minor' ? '#a78bfa' : '#f472b6'} />
                <div style={{ marginTop: 5, color: '#9db5ca', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                  Notes: {chordNoteNames(row.notes)}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              border: '1px solid rgba(110,170,210,0.18)',
              borderRadius: 8,
              padding: 10,
              background: 'rgba(10,19,34,0.55)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ color: '#d6ecff', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>
              ALL CIRCLE CHORDS
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['major', 'minor', 'dim'] as ChordListRing[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setChordListRing(r)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 4,
                    border: `1px solid ${chordListRing === r ? 'rgba(103,232,249,0.45)' : 'rgba(120,200,220,0.14)'}`,
                    background: chordListRing === r ? 'rgba(103,232,249,0.16)' : 'rgba(8,16,30,0.5)',
                    color: chordListRing === r ? '#9befff' : '#8fb0ca',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, maxHeight: 360, overflowY: 'auto', paddingRight: 2 }}>
              {allCircleChords.map((ch) => (
                <div
                  key={`ac-${ch.name}`}
                  style={{
                    border: '1px solid rgba(110,170,210,0.14)',
                    borderRadius: 7,
                    padding: 7,
                    background: 'rgba(8,16,30,0.6)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 68 }}>
                    <div style={{ color: '#d6ecff', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>
                      {ch.name}
                    </div>
                    <div style={{ marginTop: 4, color: '#9db5ca', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                      {chordNoteNames(ch.notes)}
                    </div>
                  </div>
                  <MiniOctaveKeyboard
                    notes={ch.notes}
                    width={300}
                    height={72}
                    accent={chordListRing === 'major' ? '#67e8f9' : chordListRing === 'minor' ? '#a78bfa' : '#f472b6'}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 14,
          top: 96,
          zIndex: 12,
          pointerEvents: 'none',
          width: 344,
          opacity: guidedMode === 'walkthrough' ? 1 : 0,
          transition: 'opacity 180ms ease',
          borderRadius: 10,
          border: '1px solid rgba(251,191,36,0.38)',
          background: 'rgba(12,20,34,0.88)',
          boxShadow: '0 16px 42px rgba(0,0,0,0.45)',
          padding: '10px 12px',
          color: '#dceeff',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.04em', color: '#fcd34d', fontWeight: 700 }}>
            GUIDED LESSON
          </div>
          {activeGuidedStep && (
            <div style={{ fontSize: 11, color: '#9db5ca' }}>
              Step {(guidedStep % Math.max(1, guidedLesson.length)) + 1}/{Math.max(1, guidedLesson.length)}
            </div>
          )}
        </div>
        {activeGuidedStep && (
          <>
            <div style={{ marginTop: 4, fontSize: 15, fontWeight: 700 }}>
              Play {activeGuidedStep.degree} • {activeGuidedStep.name}
            </div>
            <div style={{ marginTop: 5, fontSize: 11, color: '#9fb5c8' }}>
              {activeGuidedStep.prompt}
            </div>
            <div style={{ marginTop: 5, fontSize: 11, color: '#7dd3fc' }}>
              Target notes: {activeGuidedStep.requiredPcs.map((pc) => noteNames[pc]).join(' - ')}
            </div>
          </>
        )}
        {lessonBanner && (
          <div style={{ marginTop: 7, fontSize: 11, color: '#fef3c7' }}>
            {lessonBanner}
          </div>
        )}
        {lessonError && (
          <div style={{ marginTop: 7, fontSize: 11, color: '#fda4af' }}>
            {lessonError}
          </div>
        )}
        {conceptOverlay && (
          <div style={{ marginTop: 7, fontSize: 11, color: '#86efac' }}>
            Concept lens on: clockwise = rising fifths tension, counter-clockwise = fourths release.
          </div>
        )}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 10,
          bottom: 10,
          zIndex: 10,
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid rgba(120,200,220,0.2)',
          background: 'rgba(8,14,24,0.58)',
          backdropFilter: 'blur(8px)',
          color: '#9fb2c6',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
        }}
      >
        <div style={{ color: '#d6ecff', fontWeight: 700 }}>Learn Mode: Circle Illumination</div>
        <div>{focusMode === 'diatonic' ? 'Diatonic focus: key-family targets only.' : 'Chord focus: held-triad analysis only.'}</div>
        {focusMode === 'chord' && (
          <div>
            Input chord: {analyzedChord ? `${analyzedChord.label} (${analyzedChord.pcs.map((pc) => noteNames[pc]).join(' - ')})` : 'No stable triad held'}
          </div>
        )}
        <div>
          {guidedMode === 'walkthrough' && activeGuidedStep
            ? `Guided target: ${activeGuidedStep.degree} (${activeGuidedStep.name})`
            : 'Guided walkthrough is off.'}
        </div>
        <div>Last movement: {lastRelation}</div>
        <div>{conceptOverlay ? 'Concept lens: ON' : 'Concept lens: OFF'}</div>
        <div>Guide rails: Tonic, Dominant, Subdominant, Relative Minor.</div>
        <div>Progress Trail: {trailNodes.length} nodes</div>
      </div>
    </div>
  );
};

export default CircleOfFifthsPanel;
