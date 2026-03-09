import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Player } from '@remotion/player';
import { IntervalTrainer } from '../compositions/IntervalTrainer';
import type { IntervalTrainerProps } from '../compositions/IntervalTrainer';
import { onMidiStateChange, previewNote, sendToSwift } from '../bridge';

// ── Scale / mode definitions ──────────────────────────────────────────────

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

  // ── State ────────────────────────────────────────────────────────────
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

  const mode = MODES[scaleMode];
  const rootIdx = CHROMATIC.indexOf(rootNote);

  // Subscribe to live MIDI notes
  useEffect(() => {
    const unsub = onMidiStateChange((notes) => {
      setActiveNotes(notes.map((n) => n.note));
    });
    return unsub;
  }, []);

  // Detect which interval the user is playing
  useEffect(() => {
    if (activeNotes.length === 0) {
      setActiveInterval(null);
      return;
    }
    // Find the interval from root
    const played = activeNotes.map(n => n % 12);
    for (const note of played) {
      const interval = ((note - rootIdx) % 12 + 12) % 12;
      if (mode.intervals.includes(interval) || mode.intervals.includes(interval + 12)) {
        setActiveInterval(interval === 0 && activeNotes.some(n => n > rootIdx + 60 + 11) ? 12 : interval);

        // Quiz mode — check if this is the target interval
        if (gameMode === 'quiz' && quizTarget !== null) {
          const targetSemitones = quizTarget % 12;
          if (interval === targetSemitones || (quizTarget === 12 && interval === 0)) {
            // Correct!
            setCorrectIntervals(prev => [...prev, quizTarget]);
            setScore(prev => ({ correct: prev.correct + 1, total: prev.total + 1 }));
            setMessage(`✓ Correct! ${INTERVAL_NAMES[quizTarget]}`);
            setQuizTarget(null);
            setTimeout(() => { setMessage(null); pickNextQuizTarget(); }, 1200);
          } else {
            // Wrong
            setWrongInterval(interval);
            setScore(prev => ({ ...prev, total: prev.total + 1 }));
            setMessage(`✗ That was a ${INTERVAL_NAMES[interval]}. Try again!`);
            setTimeout(() => { setWrongInterval(null); setMessage(null); }, 1500);
          }
        }
        return;
      }
    }
  }, [activeNotes, rootIdx, mode, gameMode, quizTarget]);

  // Pick a random quiz target
  const pickNextQuizTarget = useCallback(() => {
    const available = mode.intervals.filter(i => i > 0 && !correctIntervals.includes(i));
    if (available.length === 0) {
      setMessage('🎉 Perfect! All intervals identified!');
      setQuizTarget(null);
      return;
    }
    const next = available[Math.floor(Math.random() * available.length)];
    setQuizTarget(next);
  }, [mode, correctIntervals]);

  // Play interval preview
  const playInterval = useCallback((semitones: number) => {
    const rootMidi = 60 + rootIdx; // C4 = 60
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
    // Pick first target after a short delay
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

  // ── Input props ──────────────────────────────────────────────────────
  const inputProps = useMemo((): IntervalTrainerProps => ({
    rootNote,
    activeInterval,
    scaleIntervals: mode.intervals,
    correctIntervals,
    wrongInterval,
    activeNotes,
    modeLabel: mode.label,
    score,
  }), [rootNote, activeInterval, mode, correctIntervals, wrongInterval, activeNotes, score]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Remotion Player */}
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

      {/* Controls bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        background: 'rgba(8, 14, 24, 0.9)',
        borderTop: '1px solid rgba(120,200,220,0.1)',
        flexWrap: 'wrap',
      }}>
        {/* Key selector */}
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

        {/* Mode selector */}
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

        {/* Mode description */}
        <span style={{
          color: '#94a3b8', fontSize: 10, fontFamily: 'monospace',
          opacity: 0.6, flex: 1, minWidth: 100,
        }}>
          {mode.description}
        </span>

        {/* Interval buttons (explore mode) */}
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

        {/* Quiz controls */}
        {gameMode === 'quiz' && quizTarget !== null && (
          <span style={{
            color: '#fbbf24', fontSize: 12, fontFamily: 'monospace', fontWeight: 700,
          }}>
            Play the {INTERVAL_NAMES[quizTarget]}
          </span>
        )}

        {/* Message */}
        {message && (
          <span style={{
            color: message.startsWith('✓') || message.startsWith('🎉') ? '#2dd4bf' : '#f87171',
            fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
          }}>
            {message}
          </span>
        )}

        {/* Game mode buttons */}
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
    </div>
  );
};

export default IntervalTrainerPanel;
