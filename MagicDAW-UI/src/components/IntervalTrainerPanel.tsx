import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Player } from '@remotion/player';
import { IntervalTrainer } from '../compositions/IntervalTrainer';
import type { IntervalTrainerProps } from '../compositions/IntervalTrainer';
import { onMidiStateChange, previewNote, sendToSwift } from '../bridge';

// ── Scale / mode definitions (kept for intervals drill) ─────────────────

const MODES: Record<string, { label: string; intervals: number[]; description: string }> = {
  major: { label: 'Major Scale', intervals: [0, 2, 4, 5, 7, 9, 11, 12], description: 'The bright, happy scale. W-W-H-W-W-W-H' },
  minor: { label: 'Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10, 12], description: 'The dark, moody scale. W-H-W-W-H-W-W' },
  pentatonic: { label: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9, 12], description: 'The universal melody scale. 5 notes, no tension.' },
  blues: { label: 'Blues Scale', intervals: [0, 3, 5, 6, 7, 10, 12], description: 'Minor pentatonic + the blue note (tritone).' },
  dorian: { label: 'Dorian Mode', intervals: [0, 2, 3, 5, 7, 9, 10, 12], description: 'Minor with a bright 6th. Jazz, funk, Santana.' },
  mixolydian: { label: 'Mixolydian Mode', intervals: [0, 2, 4, 5, 7, 9, 10, 12], description: 'Major with a flat 7th. Blues rock, folk.' },
  chromatic: { label: 'All Intervals', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], description: 'Every semitone. The ultimate ear training.' },
  fifths: { label: 'Perfect Fifths', intervals: [0, 7, 12], description: 'The strongest consonance. Foundation of harmony.' },
};

const ALL_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F', 'Bb', 'Eb', 'Ab'];
const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const INTERVAL_NAMES: Record<number, string> = {
  0: 'Unison', 1: 'Minor 2nd', 2: 'Major 2nd', 3: 'Minor 3rd', 4: 'Major 3rd',
  5: 'Perfect 4th', 6: 'Tritone', 7: 'Perfect 5th', 8: 'Minor 6th', 9: 'Major 6th',
  10: 'Minor 7th', 11: 'Major 7th', 12: 'Octave',
};

// ── Drill categories ─────────────────────────────────────────────────────

type DrillCategory =
  | 'intervals'
  | 'pentatonic-major'
  | 'pentatonic-minor'
  | 'major-scale'
  | 'minor-scale'
  | 'major-chord'
  | 'minor-chord'
  | 'diminished-chord';

interface DrillDef {
  id: DrillCategory;
  label: string;
  shortLabel: string;
  color: string;
  semitones: number[];
  type: 'scale' | 'chord' | 'intervals';
  degreeLabels: string[];
}

const DRILL_DEFS: DrillDef[] = [
  {
    id: 'intervals', label: 'Intervals', shortLabel: 'INT',
    color: '#67e8f9', semitones: [], type: 'intervals', degreeLabels: [],
  },
  {
    id: 'pentatonic-major', label: 'Major Pentatonic', shortLabel: 'PNT+',
    color: '#2dd4bf', semitones: [0, 2, 4, 7, 9], type: 'scale',
    degreeLabels: ['1', '2', '3', '5', '6'],
  },
  {
    id: 'pentatonic-minor', label: 'Minor Pentatonic', shortLabel: 'PNT-',
    color: '#2dd4bf', semitones: [0, 3, 5, 7, 10], type: 'scale',
    degreeLabels: ['1', 'b3', '4', '5', 'b7'],
  },
  {
    id: 'major-scale', label: 'Major Scale', shortLabel: 'MAJ',
    color: '#fbbf24', semitones: [0, 2, 4, 5, 7, 9, 11], type: 'scale',
    degreeLabels: ['1', '2', '3', '4', '5', '6', '7'],
  },
  {
    id: 'minor-scale', label: 'Minor Scale', shortLabel: 'MIN',
    color: '#a78bfa', semitones: [0, 2, 3, 5, 7, 8, 10], type: 'scale',
    degreeLabels: ['1', '2', 'b3', '4', '5', 'b6', 'b7'],
  },
  {
    id: 'major-chord', label: 'Major Chord', shortLabel: 'MAJ',
    color: '#34d399', semitones: [0, 4, 7], type: 'chord',
    degreeLabels: ['R', '3', '5'],
  },
  {
    id: 'minor-chord', label: 'Minor Chord', shortLabel: 'MIN',
    color: '#f472b6', semitones: [0, 3, 7], type: 'chord',
    degreeLabels: ['R', 'b3', '5'],
  },
  {
    id: 'diminished-chord', label: 'Dim Chord', shortLabel: 'DIM',
    color: '#fb923c', semitones: [0, 3, 6], type: 'chord',
    degreeLabels: ['R', 'b3', 'b5'],
  },
];

const DRILL_BY_ID = Object.fromEntries(DRILL_DEFS.map(d => [d.id, d])) as Record<DrillCategory, DrillDef>;

const ROOT_NOTES = [
  { name: 'C', midi: 60 }, { name: 'C#', midi: 61 }, { name: 'D', midi: 62 },
  { name: 'D#', midi: 63 }, { name: 'E', midi: 64 }, { name: 'F', midi: 65 },
  { name: 'F#', midi: 66 }, { name: 'G', midi: 67 }, { name: 'G#', midi: 68 },
  { name: 'A', midi: 69 }, { name: 'A#', midi: 70 }, { name: 'B', midi: 71 },
];

// ── Daily progress tracking ──────────────────────────────────────────────

interface DrillProgress {
  date: string;
  completed: Record<string, number>;
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadProgress(): DrillProgress {
  try {
    const raw = localStorage.getItem('drill-progress');
    if (raw) {
      const parsed = JSON.parse(raw) as DrillProgress;
      if (parsed.date === getTodayKey()) return parsed;
    }
  } catch { /* ignore */ }
  return { date: getTodayKey(), completed: {} };
}

function saveProgress(progress: DrillProgress): void {
  localStorage.setItem('drill-progress', JSON.stringify(progress));
}

// ── Game modes ────────────────────────────────────────────────────────────

type GameMode = 'explore' | 'quiz';

// ── Component ─────────────────────────────────────────────────────────────

export const IntervalTrainerPanel: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [compSize, setCompSize] = useState<{ w: number; h: number } | null>(null);

  // Observe container size
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setCompSize({ w: Math.round(width / 2) * 2, h: Math.round(height / 2) * 2 });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── Drill selector state ──────────────────────────────────────────────
  const [activeDrill, setActiveDrill] = useState<DrillCategory>('intervals');
  const drill = DRILL_BY_ID[activeDrill];

  // ── Intervals drill state (existing) ──────────────────────────────────
  const [rootNote, setRootNote] = useState('C');
  const [scaleMode, setScaleMode] = useState('major');
  const [gameMode, setGameMode] = useState<GameMode>('explore');
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [activeInterval, setActiveInterval] = useState<number | null>(null);
  const [correctIntervals, setCorrectIntervals] = useState<number[]>([]);
  const [wrongInterval, setWrongInterval] = useState<number | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [quizTarget, setQuizTarget] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // ── Scale/chord drill state ────────────────────────────────────────────
  const [drillKeyIndex, setDrillKeyIndex] = useState(0);
  const [currentNoteIndex, setCurrentNoteIndex] = useState(-1);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState<DrillProgress>(loadProgress);
  const playTimeoutRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // MIDI matching: how many notes the user has played correctly in sequence
  const [matchedUpTo, setMatchedUpTo] = useState(0);
  const matchedUpToRef = useRef(0); // ref mirror to avoid stale closures
  matchedUpToRef.current = matchedUpTo;

  const drillRoot = ROOT_NOTES[drillKeyIndex];

  const mode = MODES[scaleMode];
  const rootIdx = CHROMATIC.indexOf(rootNote);

  // Subscribe to live MIDI notes
  useEffect(() => {
    const unsub = onMidiStateChange((notes) => {
      setActiveNotes(notes.map((n) => n.note));
    });
    return unsub;
  }, []);

  // Detect which interval the user is playing (intervals drill only)
  useEffect(() => {
    if (activeDrill !== 'intervals') return;
    if (activeNotes.length === 0) {
      setActiveInterval(null);
      return;
    }
    const played = activeNotes.map(n => n % 12);
    for (const note of played) {
      const interval = ((note - rootIdx) % 12 + 12) % 12;
      if (mode.intervals.includes(interval) || mode.intervals.includes(interval + 12)) {
        setActiveInterval(interval === 0 && activeNotes.some(n => n > rootIdx + 60 + 11) ? 12 : interval);

        if (gameMode === 'quiz' && quizTarget !== null) {
          const targetSemitones = quizTarget % 12;
          if (interval === targetSemitones || (quizTarget === 12 && interval === 0)) {
            setCorrectIntervals(prev => [...prev, quizTarget]);
            setScore(prev => ({ correct: prev.correct + 1, total: prev.total + 1 }));
            setMessage('Correct! ' + INTERVAL_NAMES[quizTarget]);
            setQuizTarget(null);
            setTimeout(() => { setMessage(null); pickNextQuizTarget(); }, 1200);
          } else {
            setWrongInterval(interval);
            setScore(prev => ({ ...prev, total: prev.total + 1 }));
            setMessage('That was a ' + INTERVAL_NAMES[interval] + '. Try again!');
            setTimeout(() => { setWrongInterval(null); setMessage(null); }, 1500);
          }
        }
        return;
      }
    }
  }, [activeNotes, rootIdx, mode, gameMode, quizTarget, activeDrill]);

  // ── MIDI matching for scale/chord drills ────────────────────────────────
  // Track which note the user needs to play next. For scales: sequential.
  // For chords: any order (all must be held simultaneously).
  const prevActiveNotesRef = useRef<number[]>([]);

  useEffect(() => {
    if (activeDrill === 'intervals' || drill.type === 'intervals') return;
    if (activeNotes.length === 0) {
      prevActiveNotesRef.current = [];
      return;
    }

    const expectedNotes = drill.semitones.map(s => drillRoot.midi + s);
    const curMatched = matchedUpToRef.current;

    if (drill.type === 'chord') {
      // Chord: user must hold all notes simultaneously (any octave)
      const expectedChroma = new Set(expectedNotes.map(n => n % 12));
      const playedChroma = new Set(activeNotes.map(n => n % 12));
      let allHeld = true;
      for (const c of expectedChroma) {
        if (!playedChroma.has(c)) { allHeld = false; break; }
      }
      if (allHeld) {
        setMatchedUpTo(expectedNotes.length);
      }
    } else {
      // Scale: sequential matching — detect newly pressed notes (note-on)
      const prevSet = new Set(prevActiveNotesRef.current);
      const newlyPressed = activeNotes.filter(n => !prevSet.has(n));

      if (newlyPressed.length > 0 && curMatched < expectedNotes.length) {
        const targetNote = expectedNotes[curMatched];
        const targetChroma = targetNote % 12;
        // Accept the note in any octave
        const hit = newlyPressed.some(n => n % 12 === targetChroma);
        if (hit) {
          setMatchedUpTo(curMatched + 1);
        }
      }
    }
    prevActiveNotesRef.current = [...activeNotes];
  }, [activeNotes, activeDrill, drill, drillRoot]);

  // When all notes matched → record + auto-advance after brief delay
  const advanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (activeDrill === 'intervals' || drill.type === 'intervals') return;
    const expectedCount = drill.semitones.length;
    if (matchedUpTo >= expectedCount && expectedCount > 0) {
      recordKeyCompleted();
      advanceTimeoutRef.current = setTimeout(() => {
        setMatchedUpTo(0);
        matchedUpToRef.current = 0;
        setDrillKeyIndex(prev => ((prev + 1) % 12 + 12) % 12);
      }, 800);
    }
    return () => {
      if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current);
    };
  }, [matchedUpTo, activeDrill, drill]);

  // Pick a random quiz target
  const pickNextQuizTarget = useCallback(() => {
    const available = mode.intervals.filter(i => i > 0 && !correctIntervals.includes(i));
    if (available.length === 0) {
      setMessage('Perfect! All intervals identified!');
      setQuizTarget(null);
      return;
    }
    const next = available[Math.floor(Math.random() * available.length)];
    setQuizTarget(next);
  }, [mode, correctIntervals]);

  // Play interval preview
  const playInterval = useCallback((semitones: number) => {
    const rootMidi = 60 + rootIdx;
    previewNote(rootMidi);
    setTimeout(() => previewNote(rootMidi + semitones), 400);
    setActiveInterval(semitones);
    setTimeout(() => setActiveInterval(null), 1500);
  }, [rootIdx]);

  // Start quiz
  const startQuiz = useCallback(() => {
    setGameMode('quiz');
    setCorrectIntervals([]);
    setScore({ correct: 0, total: 0 });
    setMessage(null);
    setWrongInterval(null);
    setTimeout(() => {
      const available = mode.intervals.filter(i => i > 0);
      const next = available[Math.floor(Math.random() * available.length)];
      setQuizTarget(next);
    }, 500);
  }, [mode]);

  // Reset to explore
  const resetToExplore = useCallback(() => {
    setGameMode('explore');
    setQuizTarget(null);
    setCorrectIntervals([]);
    setScore({ correct: 0, total: 0 });
    setMessage(null);
    setWrongInterval(null);
  }, []);

  // ── Scale/chord play ───────────────────────────────────────────────────

  const clearPlayTimeouts = useCallback(() => {
    playTimeoutRef.current.forEach(t => clearTimeout(t));
    playTimeoutRef.current = [];
  }, []);

  const playDrill = useCallback(() => {
    if (drill.type === 'intervals' || isPlaying) return;
    clearPlayTimeouts();
    setIsPlaying(true);

    const midiNotes = drill.semitones.map(s => drillRoot.midi + s);

    if (drill.type === 'chord') {
      // Simultaneous
      setCurrentNoteIndex(-1);
      midiNotes.forEach(n => previewNote(n, 100));
      // Briefly highlight all, then highlight each in sequence
      let idx = 0;
      for (const [i] of midiNotes.entries()) {
        const t = setTimeout(() => {
          setCurrentNoteIndex(i);
        }, i * 200);
        playTimeoutRef.current.push(t);
      }
      const endT = setTimeout(() => {
        setCurrentNoteIndex(-1);
        setIsPlaying(false);
      }, midiNotes.length * 200 + 800);
      playTimeoutRef.current.push(endT);
    } else {
      // Sequential for scales
      midiNotes.forEach((n, i) => {
        const t = setTimeout(() => {
          setCurrentNoteIndex(i);
          previewNote(n, 100);
        }, i * 300);
        playTimeoutRef.current.push(t);
      });
      const endT = setTimeout(() => {
        setCurrentNoteIndex(-1);
        setIsPlaying(false);
      }, midiNotes.length * 300 + 400);
      playTimeoutRef.current.push(endT);
    }
  }, [drill, drillRoot, isPlaying, autoAdvance]);

  const advanceKey = useCallback((dir: 1 | -1) => {
    clearPlayTimeouts();
    setCurrentNoteIndex(-1);
    setIsPlaying(false);
    setMatchedUpTo(0);
    matchedUpToRef.current = 0;
    setDrillKeyIndex(prev => ((prev + dir) % 12 + 12) % 12);
  }, []);

  const recordKeyCompleted = useCallback(() => {
    setProgress(prev => {
      const next = { ...prev, date: getTodayKey(), completed: { ...prev.completed } };
      const key = activeDrill;
      const current = next.completed[key] ?? 0;
      if (current < 12) {
        next.completed[key] = current + 1;
      }
      saveProgress(next);
      return next;
    });
  }, [activeDrill]);

  // Cleanup on drill change
  useEffect(() => {
    clearPlayTimeouts();
    setCurrentNoteIndex(-1);
    setIsPlaying(false);
    setDrillKeyIndex(0);
    setMatchedUpTo(0);
    matchedUpToRef.current = 0;
  }, [activeDrill]);

  // Cleanup on unmount
  useEffect(() => () => clearPlayTimeouts(), []);

  // ── Composition: highlighted notes for scale/chord drills ──────────────
  const highlightedNotes = useMemo(() => {
    if (drill.type === 'intervals') return [];
    return drill.semitones.map(s => drillRoot.midi + s);
  }, [drill, drillRoot]);

  // ── Input props ──────────────────────────────────────────────────────
  const inputProps = useMemo((): IntervalTrainerProps => ({
    rootNote: activeDrill === 'intervals' ? rootNote : drillRoot.name,
    activeInterval: activeDrill === 'intervals' ? activeInterval : null,
    scaleIntervals: activeDrill === 'intervals' ? mode.intervals : [],
    correctIntervals: activeDrill === 'intervals' ? correctIntervals : [],
    wrongInterval: activeDrill === 'intervals' ? wrongInterval : null,
    activeNotes: activeDrill === 'intervals' ? activeNotes : [],
    modeLabel: activeDrill === 'intervals' ? mode.label : drill.label,
    score: activeDrill === 'intervals' ? score : { correct: 0, total: 0 },
    // New drill props
    drillType: activeDrill,
    highlightedNotes,
    currentNoteIndex,
    rootNoteMidi: drillRoot.midi,
    keyName: drillRoot.name,
    drillLabel: drill.label,
    drillColor: drill.color,
    degreeLabels: drill.degreeLabels,
    matchedUpTo,
  }), [rootNote, activeInterval, mode, correctIntervals, wrongInterval, activeNotes, score,
    activeDrill, highlightedNotes, currentNoteIndex, drillRoot, drill, matchedUpTo]);

  // ── Style helpers ──────────────────────────────────────────────────────

  const pillStyle = (active: boolean, color: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '3px 10px',
    background: active ? `${color}18` : 'rgba(15,25,40,0.6)',
    border: `1px solid ${active ? color + '44' : 'rgba(120,200,220,0.1)'}`,
    borderRadius: 12,
    color: active ? color : '#94a3b8',
    fontSize: 9, fontFamily: 'monospace', fontWeight: active ? 700 : 500,
    cursor: 'pointer', transition: 'all 0.15s ease',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
    whiteSpace: 'nowrap' as const,
  });

  const btnStyle = (color: string, small = false): React.CSSProperties => ({
    background: `${color}18`,
    color,
    border: `1px solid ${color}44`,
    borderRadius: 4,
    padding: small ? '2px 8px' : '4px 14px',
    fontSize: small ? 9 : 11,
    fontFamily: 'monospace', fontWeight: 700,
    cursor: 'pointer',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* ── Drill category selector ──────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
        background: 'rgba(8, 14, 24, 0.8)',
        borderBottom: '1px solid rgba(120,200,220,0.08)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{
          color: '#94a3b8', fontSize: 8, fontFamily: 'monospace',
          textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 4, opacity: 0.5,
        }}>
          DRILL
        </span>
        {DRILL_DEFS.map(d => {
          const isActive = activeDrill === d.id;
          const completed = progress.completed[d.id] ?? 0;
          return (
            <button
              key={d.id}
              onClick={() => setActiveDrill(d.id)}
              style={pillStyle(isActive, d.color)}
            >
              {d.label}
              {d.type !== 'intervals' && (
                <span style={{
                  fontSize: 7, opacity: 0.6, color: completed > 0 ? d.color : '#64748b',
                }}>
                  {completed}/12
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Remotion Player ──────────────────────────────────────────────── */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }}>
        {compSize && (
          <Player
            component={IntervalTrainer}
            inputProps={inputProps}
            compositionWidth={compSize.w}
            compositionHeight={compSize.h}
            fps={30}
            durationInFrames={999999}
            style={{ width: '100%', height: '100%' }}
            loop
            autoPlay
            controls={false}
          />
        )}
      </div>

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      {activeDrill === 'intervals' ? (
        /* Existing interval controls */
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          background: 'rgba(8, 14, 24, 0.9)',
          borderTop: '1px solid rgba(120,200,220,0.1)',
          flexWrap: 'wrap',
        }}>
          <select
            value={rootNote}
            onChange={(e) => { setRootNote(e.target.value); setCorrectIntervals([]); }}
            style={{
              background: 'rgba(15,25,40,0.8)', color: '#67e8f9',
              border: '1px solid rgba(103,232,249,0.2)', borderRadius: 4,
              padding: '3px 8px', fontSize: 11, fontFamily: 'monospace',
            }}
          >
            {ALL_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>

          <select
            value={scaleMode}
            onChange={(e) => { setScaleMode(e.target.value); setCorrectIntervals([]); setQuizTarget(null); }}
            style={{
              background: 'rgba(15,25,40,0.8)', color: '#a78bfa',
              border: '1px solid rgba(167,139,250,0.2)', borderRadius: 4,
              padding: '3px 8px', fontSize: 11, fontFamily: 'monospace',
            }}
          >
            {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>

          <span style={{
            color: '#94a3b8', fontSize: 10, fontFamily: 'monospace',
            opacity: 0.6, flex: 1, minWidth: 100,
          }}>
            {mode.description}
          </span>

          {gameMode === 'explore' && (
            <div style={{ display: 'flex', gap: 3 }}>
              {mode.intervals.filter(i => i > 0).map(i => (
                <button
                  key={i}
                  onClick={() => playInterval(i)}
                  style={{
                    background: correctIntervals.includes(i)
                      ? 'rgba(45,212,191,0.2)'
                      : 'rgba(15,25,40,0.8)',
                    color: correctIntervals.includes(i) ? '#2dd4bf' : '#e2e8f0',
                    border: `1px solid ${correctIntervals.includes(i) ? 'rgba(45,212,191,0.3)' : 'rgba(120,200,220,0.15)'}`,
                    borderRadius: 4, padding: '2px 6px', fontSize: 9,
                    fontFamily: 'monospace', cursor: 'pointer',
                  }}
                  title={INTERVAL_NAMES[i]}
                >
                  {INTERVAL_NAMES[i]?.split(' ')[0]?.slice(0, 3)}{i === 12 ? '8' : ''}
                </button>
              ))}
            </div>
          )}

          {gameMode === 'quiz' && quizTarget !== null && (
            <span style={{
              color: '#fbbf24', fontSize: 12, fontFamily: 'monospace', fontWeight: 700,
            }}>
              Play the {INTERVAL_NAMES[quizTarget]}
            </span>
          )}

          {message && (
            <span style={{
              color: message.startsWith('Correct') || message.startsWith('Perfect') ? '#2dd4bf' : '#f87171',
              fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
            }}>
              {message}
            </span>
          )}

          <button
            onClick={gameMode === 'explore' ? startQuiz : resetToExplore}
            style={{
              background: gameMode === 'quiz' ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.15)',
              color: gameMode === 'quiz' ? '#f87171' : '#fbbf24',
              border: `1px solid ${gameMode === 'quiz' ? 'rgba(248,113,113,0.3)' : 'rgba(251,191,36,0.3)'}`,
              borderRadius: 4, padding: '3px 10px', fontSize: 11,
              fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer',
            }}
          >
            {gameMode === 'quiz' ? 'Stop Quiz' : 'Quiz Me'}
          </button>
        </div>
      ) : (
        /* Scale / chord drill controls */
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
          background: 'rgba(8, 14, 24, 0.9)',
          borderTop: '1px solid rgba(120,200,220,0.1)',
          flexWrap: 'wrap',
        }}>
          {/* Key label */}
          <span style={{
            color: drill.color, fontSize: 14, fontFamily: 'monospace', fontWeight: 800,
            minWidth: 80,
          }}>
            {drillRoot.name} {drill.label}
          </span>

          {/* Matching progress */}
          <span style={{
            color: matchedUpTo >= drill.semitones.length && drill.semitones.length > 0
              ? '#2dd4bf' : '#94a3b8',
            fontSize: 10, fontFamily: 'monospace', opacity: 0.7,
          }}>
            {matchedUpTo}/{drill.semitones.length} notes · key {drillKeyIndex + 1}/12
          </span>

          {/* Key progress dots */}
          <div style={{ display: 'flex', gap: 3, flex: 1, minWidth: 80 }}>
            {ROOT_NOTES.map((rn, i) => (
              <div
                key={rn.name}
                style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: i === drillKeyIndex ? drill.color
                    : i < (progress.completed[activeDrill] ?? 0) ? drill.color + '55'
                    : 'rgba(120,200,220,0.12)',
                  transition: 'background 0.2s',
                }}
                title={rn.name}
              />
            ))}
          </div>

          {/* Prev button */}
          <button
            onClick={() => advanceKey(-1)}
            style={btnStyle(drill.color, true)}
            title="Previous key"
          >
            Prev
          </button>

          {/* Play button */}
          <button
            onClick={playDrill}
            disabled={isPlaying}
            style={{
              ...btnStyle(drill.color),
              opacity: isPlaying ? 0.5 : 1,
            }}
          >
            {isPlaying ? 'Playing...' : 'Play'}
          </button>

          {/* Next button */}
          <button
            onClick={() => advanceKey(1)}
            style={btnStyle(drill.color, true)}
            title="Next key"
          >
            Next
          </button>

          {/* Auto-advance toggle */}
          <button
            onClick={() => setAutoAdvance(prev => !prev)}
            style={{
              ...btnStyle(autoAdvance ? '#2dd4bf' : '#64748b', true),
              background: autoAdvance ? 'rgba(45,212,191,0.15)' : 'rgba(15,25,40,0.6)',
            }}
            title="Auto-advance to next key after playing"
          >
            Auto
          </button>
        </div>
      )}
    </div>
  );
};

export default IntervalTrainerPanel;
