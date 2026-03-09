import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Player } from '@remotion/player';
import { ChordVisualizer } from '../compositions/ChordVisualizer';
import type { ChordVisualizerProps, NoteParticle } from '../compositions/ChordVisualizer';
import { onSwiftMessage, onMidiStateChange, BridgeMessages } from '../bridge';
import { mockChordSuggestions, mockProgression } from '../mockData';

// ── Tension heuristic ──────────────────────────────────────────────────────

const CONSONANT_INTERVALS = new Set([0, 3, 4, 5, 7, 8, 9, 12]);

function computeTension(midiNotes: number[]): number {
  if (midiNotes.length < 2) return 0;
  let dissonant = 0;
  let total = 0;
  for (let i = 0; i < midiNotes.length; i++) {
    for (let j = i + 1; j < midiNotes.length; j++) {
      const interval = Math.abs(midiNotes[i] - midiNotes[j]) % 12;
      if (!CONSONANT_INTERVALS.has(interval)) dissonant++;
      total++;
    }
  }
  return total > 0 ? dissonant / total : 0;
}

// ── Note role classification ────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B',
};

function rootPitchClass(chord: string): number {
  const m = chord.match(/^([A-G][#b]?)/);
  if (!m) return -1;
  let name = m[1];
  if (FLAT_TO_SHARP[name]) name = FLAT_TO_SHARP[name];
  return NOTE_NAMES.indexOf(name);
}

function classifyRole(midiNote: number, chordName: string): string {
  const root = rootPitchClass(chordName);
  if (root < 0) return 'other';
  const pc = midiNote % 12;
  const interval = (pc - root + 12) % 12;
  if (interval === 0) return 'root';
  if (interval === 3 || interval === 4) return 'third';
  if (interval === 7) return 'fifth';
  if (interval === 10 || interval === 11) return 'seventh';
  return 'other';
}

// ── Bridge payload types ────────────────────────────────────────────────────

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

interface ChordSuggestionsPayload {
  suggestions: Array<{
    chord: string;
    probability: number;
    quality: string;
    explanation: string;
    source: string;
  }>;
}

// ── Component ──────────────────────────────────────────────────────────────

export const ChordVisualizerPanel: React.FC = () => {
  const [currentChord, setCurrentChord] = useState('Em9');
  const [previousChord, setPreviousChord] = useState('');
  const [chordQuality, setChordQuality] = useState('minor ninth');
  const [detectedKey, setDetectedKey] = useState('Em');
  const [keyMode, setKeyMode] = useState('minor');
  const [keyConfidence, setKeyConfidence] = useState(0.87);
  const [progression, setProgression] = useState<string[]>(mockProgression);
  const [suggestions, setSuggestions] = useState<Array<{ chord: string; probability: number }>>(
    mockChordSuggestions.map((s) => ({ chord: s.chord, probability: s.probability })),
  );
  const [activeNotes, setActiveNotes] = useState<NoteParticle[]>([]);
  const [chordChangeId, setChordChangeId] = useState(0);
  const [tension, setTension] = useState(0.2);

  const currentChordRef = useRef(currentChord);
  currentChordRef.current = currentChord;

  // Subscribe to bridge events
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // Chord detection
    unsubs.push(
      onSwiftMessage(BridgeMessages.CHORD_DETECTED, (payload: unknown) => {
        const p = payload as ChordDetectedPayload;
        if (p.chord) {
          setPreviousChord(currentChordRef.current);
          setCurrentChord(p.chord);
          setChordQuality(p.qualityName ?? '');
          setChordChangeId((id) => id + 1);
          setProgression((prev) => {
            const next = [...prev, p.chord!];
            return next.slice(-12);
          });
        }
      }),
    );

    // Key detection
    unsubs.push(
      onSwiftMessage(BridgeMessages.KEY_DETECTED, (payload: unknown) => {
        const p = payload as KeyDetectedPayload;
        if (p.key && p.confidence > 0) {
          setDetectedKey(p.key);
          setKeyMode(p.mode ?? (p.key.includes('m') ? 'minor' : 'major'));
          setKeyConfidence(p.confidence);
        }
      }),
    );

    // Chord suggestions
    unsubs.push(
      onSwiftMessage(BridgeMessages.CHORD_SUGGESTIONS, (payload: unknown) => {
        const p = payload as ChordSuggestionsPayload;
        if (p.suggestions?.length) {
          setSuggestions(
            p.suggestions.map((s) => ({ chord: s.chord, probability: s.probability })),
          );
        }
      }),
    );

    return () => unsubs.forEach((fn) => fn());
  }, []);

  // Subscribe to live MIDI notes for particles + tension
  useEffect(() => {
    const unsub = onMidiStateChange((notes) => {
      const chord = currentChordRef.current;
      const particles: NoteParticle[] = notes.map((n) => ({
        note: n.note,
        velocity: n.velocity,
        timestamp: n.timestamp,
        role: classifyRole(n.note, chord),
      }));
      setActiveNotes(particles);
      setTension(computeTension(notes.map((n) => n.note)));
    });
    return unsub;
  }, []);

  const inputProps: ChordVisualizerProps = {
    currentChord,
    previousChord,
    chordQuality,
    detectedKey,
    keyMode,
    keyConfidence,
    progression,
    suggestions,
    activeNotes,
    chordChangeId,
    tension,
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
      <Player
        component={ChordVisualizer}
        inputProps={inputProps}
        compositionWidth={1920}
        compositionHeight={800}
        fps={30}
        durationInFrames={300}
        loop
        autoPlay
        controls={false}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
};
