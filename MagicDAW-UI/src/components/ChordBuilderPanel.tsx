import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Player } from '@remotion/player';
import { CircleOfFifths1, chordToMidiNotes, getSurpriseChord, getFamousProgressions, resolveProgression, findHarmonicPath } from '../compositions/CircleOfFifths1';
import type { CircleOfFifthsProps } from '../compositions/CircleOfFifths1';
import { onSwiftMessage, onMidiStateChange, BridgeMessages, previewNote } from '../bridge';
import { ALL_KEYS, inferDiatonicChord } from '../lib/musicTheory';
import type { ChordDetectedPayload } from '../lib/musicTheory';

// ── Component ──────────────────────────────────────────────────────────────

export const ChordBuilderPanel: React.FC = () => {
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
  const [detectedChord, setDetectedChord] = useState<string | null>(null);
  const [isFullChord, setIsFullChord] = useState(false);
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [chordProgression, setChordProgression] = useState<string[]>([]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [bpm, setBpm] = useState(120);
  const playbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [loopRegion, setLoopRegion] = useState<[number, number] | null>(null);

  // Circle of Fifths interaction state
  const [resetSignal, setResetSignal] = useState(0);
  const [pathChords, setPathChords] = useState<string[]>([]);
  const [importChords, setImportChords] = useState<string[] | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // Build path menu
  const [showBuildPath, setShowBuildPath] = useState(false);
  const [buildPathFrom, setBuildPathFrom] = useState('C');
  const [buildPathTo, setBuildPathTo] = useState('G');
  const [buildPathSteps, setBuildPathSteps] = useState(6);
  const [showImportMenu, setShowImportMenu] = useState(false);

  const ALL_CHORDS = useMemo(() => {
    const roots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const qualities = ['', 'm'];
    return roots.flatMap(r => qualities.map(q => r + q));
  }, []);

  // ── MIDI / Bridge subscriptions ───────────────────────────────────────
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.CHORD_DETECTED, (payload: unknown) => {
      const p = payload as ChordDetectedPayload;
      if (p.chord) {
        setDetectedChord(p.chord);
        setIsFullChord(true);
        setChordProgression((prev) => [...prev, p.chord!].slice(-32));
      } else {
        setDetectedChord(null);
        setIsFullChord(false);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onMidiStateChange((notes) => {
      setActiveNotes(notes.map((n) => n.note));
    });
    return unsub;
  }, []);

  // Infer diatonic chord from single notes
  const prevNoteSetRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const hasNewNote = activeNotes.length > 0 &&
      activeNotes.some(n => !prevNoteSetRef.current.has(n));
    prevNoteSetRef.current = new Set(activeNotes);

    if (activeNotes.length === 0) {
      setDetectedChord(null);
      setIsFullChord(false);
      return;
    }
    if (isFullChord && detectedChord) return;
    if (!hasNewNote) return;

    const lowest = Math.min(...activeNotes);
    const inferred = inferDiatonicChord(lowest, activeKey, activeMode);
    if (inferred && inferred !== detectedChord) {
      setDetectedChord(inferred);
      setIsFullChord(activeNotes.length >= 3);
      setChordProgression((prev) => {
        const last = prev[prev.length - 1];
        if (last === inferred) return prev;
        return [...prev, inferred].slice(-32);
      });
    }
  }, [activeNotes, activeKey, activeMode]);

  // ── Playback ──────────────────────────────────────────────────────────
  const playChordAudio = useCallback((chord: string) => {
    const notes = chordToMidiNotes(chord);
    notes.forEach(n => previewNote(n, 90));
  }, []);

  const handlePlayback = useCallback(() => {
    const chords = importChords ?? pathChords;
    if (isPlaying) {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      setIsPlaying(false);
      setPlaybackIndex(-1);
      return;
    }
    if (chords.length === 0) return;

    setIsPlaying(true);
    const startIdx = loopRegion ? loopRegion[0] : 0;
    const endIdx = loopRegion ? loopRegion[1] : chords.length - 1;
    let currentIdx = startIdx;
    setPlaybackIndex(currentIdx);
    playChordAudio(chords[currentIdx]);

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
      playChordAudio(chords[currentIdx]);
    }, msPerBeat);
  }, [isPlaying, importChords, pathChords, bpm, loopRegion, playChordAudio]);

  const handleReset = useCallback(() => {
    if (playbackTimerRef.current) {
      clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    setIsPlaying(false);
    setPlaybackIndex(-1);
    setLoopRegion(null);
    setChordProgression([]);
    setImportChords(null);
    setPathChords([]);
    setResetSignal(s => s + 1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const handleSurprise = useCallback(() => {
    const currentChords = importChords ?? pathChords;
    const lastChord = currentChords.length > 0 ? currentChords[currentChords.length - 1] : null;
    const chord = getSurpriseChord(lastChord, activeKey, activeMode);
    setImportChords(prev => {
      const base = prev ?? pathChords;
      return [...base, chord];
    });
  }, [importChords, pathChords, activeKey, activeMode]);

  const handleUndo = useCallback(() => {
    setImportChords(prev => prev && prev.length > 1 ? prev.slice(0, -1) : null);
  }, []);

  const handleToggleLoop = useCallback(() => {
    const chords = importChords ?? pathChords;
    if (loopRegion) {
      setLoopRegion(null);
    } else if (chords.length >= 2) {
      setLoopRegion([0, chords.length - 1]);
    }
  }, [loopRegion, importChords, pathChords]);

  const handleBuildPath = useCallback(() => {
    const path = findHarmonicPath(buildPathFrom, buildPathTo, buildPathSteps, activeKey, activeMode);
    setResetSignal(s => s + 1);
    setPathChords([]);
    setPanOffset({ x: 0, y: 0 });
    setImportChords(null);
    setTimeout(() => setImportChords(path), 0);
    setShowBuildPath(false);
  }, [buildPathFrom, buildPathTo, buildPathSteps, activeKey, activeMode]);

  const handleImportProgression = useCallback((progIndex: number) => {
    const progs = getFamousProgressions();
    const prog = progs[progIndex];
    if (!prog) return;
    const chords = resolveProgression(prog, activeKey, activeMode);
    setResetSignal(s => s + 1);
    setPathChords([]);
    setPanOffset({ x: 0, y: 0 });
    setImportChords(null);
    setTimeout(() => setImportChords(chords), 0);
    setShowImportMenu(false);
  }, [activeKey, activeMode]);

  // Click-to-navigate: add a chord to the path
  const handleClickChord = useCallback((chord: string) => {
    setImportChords(prev => {
      const base = prev ?? pathChords;
      return [...base, chord];
    });
  }, [pathChords]);

  // Delete a node from the chord path
  const handleDeleteNode = useCallback((index: number) => {
    setImportChords(prev => prev ? prev.filter((_, i) => i !== index) : null);
  }, []);

  const onSavePath = useCallback((chords: string[]) => {
    setPathChords(chords);
  }, []);

  // Pan
  const panStartRef = useRef<{ x: number; y: number; startPan: { x: number; y: number } } | null>(null);
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    panStartRef.current = { x: e.clientX, y: e.clientY, startPan: { ...panOffset } };
  }, [panOffset]);
  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!panStartRef.current || !compSize) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    const svgScale = compSize.w / (containerRef.current?.clientWidth ?? compSize.w);
    setPanOffset({
      x: panStartRef.current.startPan.x - dx * svgScale,
      y: panStartRef.current.startPan.y - dy * svgScale,
    });
  }, [compSize]);
  const handlePanEnd = useCallback(() => { panStartRef.current = null; }, []);

  useEffect(() => {
    return () => {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    };
  }, []);

  // ── Composition props ─────────────────────────────────────────────────
  const inputProps: CircleOfFifthsProps = useMemo(() => ({
    activeKey,
    activeMode,
    detectedChord,
    isFullChord,
    activeNotes,
    chordProgression,
    pathfinderFrom: null,
    pathfinderTo: null,
    pathfinderPaths: [],
    highlightedDegrees: [],
    resetSignal,
    onSavePath,
    panOffset,
    onClickChord: handleClickChord,
    onDeleteNode: handleDeleteNode,
    importChords,
    playbackIndex,
    loopRegion,
    onSetLoopRegion: setLoopRegion,
  }), [activeKey, activeMode, detectedChord, isFullChord, activeNotes, chordProgression,
    resetSignal, onSavePath, panOffset, handleClickChord, handleDeleteNode,
    importChords, playbackIndex, loopRegion]);

  // ── Button style helper ───────────────────────────────────────────────
  const btnStyle = (active: boolean, color = '#67e8f9'): React.CSSProperties => ({
    padding: '5px 12px',
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    fontWeight: active ? 700 : 500,
    background: active ? `${color}20` : 'rgba(120, 200, 220, 0.04)',
    border: `1px solid ${active ? `${color}66` : 'rgba(120, 200, 220, 0.1)'}`,
    borderRadius: 6,
    color: active ? color : 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    backdropFilter: 'blur(8px)',
  });

  const currentChords = importChords ?? pathChords;

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
        cursor: panStartRef.current ? 'grabbing' : 'default',
      }}
    >
      {compSize && (
        <Player
          key={`${compSize.w}x${compSize.h}`}
          component={CircleOfFifths1}
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

      {/* ── Top bar: Key selector + Mode toggle + Progression ── */}
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
              fontFamily: 'var(--font-mono)',
              fontWeight: k === activeKey ? 700 : 400,
              background: k === activeKey ? 'rgba(103, 232, 249, 0.25)' : 'rgba(120, 200, 220, 0.04)',
              border: `1px solid ${k === activeKey ? 'rgba(103, 232, 249, 0.5)' : 'rgba(120, 200, 220, 0.08)'}`,
              borderRadius: 4,
              color: k === activeKey ? '#67e8f9' : 'var(--text-muted)',
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
              fontFamily: 'var(--font-mono)',
              fontWeight: m === activeMode ? 700 : 400,
              background: m === activeMode
                ? (m === 'minor' ? 'rgba(167, 139, 250, 0.25)' : 'rgba(103, 232, 249, 0.25)')
                : 'rgba(120, 200, 220, 0.04)',
              border: `1px solid ${m === activeMode
                ? (m === 'minor' ? 'rgba(167, 139, 250, 0.5)' : 'rgba(103, 232, 249, 0.5)')
                : 'rgba(120, 200, 220, 0.08)'}`,
              borderRadius: 4,
              color: m === activeMode ? (m === 'minor' ? '#a78bfa' : '#67e8f9') : 'var(--text-muted)',
              cursor: 'pointer', transition: 'all 0.15s ease',
              backdropFilter: 'blur(8px)', textTransform: 'capitalize',
            }}>
              {m}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Progression display */}
        {currentChords.length > 0 && (
          <span style={{
            pointerEvents: 'auto', fontSize: 10,
            fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
            padding: '3px 8px',
            background: 'rgba(10, 14, 26, 0.6)',
            borderRadius: 4, border: '1px solid rgba(120, 200, 220, 0.08)',
            backdropFilter: 'blur(8px)', maxWidth: 400, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {currentChords.join(' → ')}
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
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>BPM</span>
            <input
              type="range" min={40} max={240} value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
              style={{ width: 60, height: 14, accentColor: '#67e8f9' }}
            />
            <span style={{
              fontSize: 11, fontFamily: 'var(--font-mono)',
              color: '#67e8f9', fontWeight: 700, minWidth: 28, textAlign: 'right',
            }}>{bpm}</span>
          </div>
        </div>

        {/* Tools */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', pointerEvents: 'auto' }}>
          <button onClick={handleSurprise} style={btnStyle(false, '#a78bfa')}>
            Surprise
          </button>

          {/* Build Path */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowBuildPath(!showBuildPath); setShowImportMenu(false); }}
              style={btnStyle(showBuildPath, '#2dd4bf')}
            >
              Build Path
            </button>
            {showBuildPath && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
                background: 'rgba(8, 14, 24, 0.95)',
                border: '1px solid rgba(45, 212, 191, 0.25)',
                borderRadius: 8, padding: 12, minWidth: 280,
                backdropFilter: 'blur(12px)', zIndex: 100,
              }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Harmonic Path Builder
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3, fontFamily: 'var(--font-mono)' }}>FROM</div>
                    <select value={buildPathFrom} onChange={(e) => setBuildPathFrom(e.target.value)} style={{
                      width: '100%', padding: '4px 6px', fontSize: 12,
                      fontFamily: 'var(--font-mono)', fontWeight: 700,
                      background: 'rgba(45, 212, 191, 0.08)',
                      border: '1px solid rgba(45, 212, 191, 0.2)',
                      borderRadius: 4, color: '#2dd4bf', cursor: 'pointer',
                    }}>
                      {ALL_CHORDS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 14, paddingTop: 14 }}>→</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3, fontFamily: 'var(--font-mono)' }}>TO</div>
                    <select value={buildPathTo} onChange={(e) => setBuildPathTo(e.target.value)} style={{
                      width: '100%', padding: '4px 6px', fontSize: 12,
                      fontFamily: 'var(--font-mono)', fontWeight: 700,
                      background: 'rgba(167, 139, 250, 0.08)',
                      border: '1px solid rgba(167, 139, 250, 0.2)',
                      borderRadius: 4, color: '#a78bfa', cursor: 'pointer',
                    }}>
                      {ALL_CHORDS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 36 }}>STEPS</span>
                  <input type="range" min={3} max={12} value={buildPathSteps}
                    onChange={(e) => setBuildPathSteps(Number(e.target.value))}
                    style={{ flex: 1, height: 14, accentColor: '#2dd4bf' }}
                  />
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#2dd4bf', fontWeight: 700 }}>{buildPathSteps}</span>
                </div>
                <button onClick={handleBuildPath} style={{
                  width: '100%', padding: '6px 12px', fontSize: 12,
                  fontFamily: 'var(--font-mono)', fontWeight: 700,
                  background: 'rgba(45, 212, 191, 0.15)',
                  border: '1px solid rgba(45, 212, 191, 0.3)',
                  borderRadius: 6, color: '#2dd4bf', cursor: 'pointer',
                }}>
                  Generate Path
                </button>
              </div>
            )}
          </div>

          {/* Import menu */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowImportMenu(!showImportMenu); setShowBuildPath(false); }}
              style={btnStyle(showImportMenu, '#f472b6')}
            >
              Import
            </button>
            {showImportMenu && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
                background: 'rgba(8, 14, 24, 0.95)',
                border: '1px solid rgba(244, 114, 182, 0.25)',
                borderRadius: 8, padding: 8, minWidth: 220, maxHeight: 280, overflowY: 'auto',
                backdropFilter: 'blur(12px)', zIndex: 100,
              }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, padding: '0 4px' }}>
                  Famous Progressions
                </div>
                {getFamousProgressions().map((prog, i) => (
                  <button key={i} onClick={() => handleImportProgression(i)} style={{
                    display: 'block', width: '100%', padding: '5px 8px',
                    fontSize: 11, fontFamily: 'var(--font-mono)',
                    background: 'transparent',
                    border: 'none', borderRadius: 4,
                    color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
                  }}>
                    <span style={{ color: '#f472b6', fontWeight: 700 }}>{prog.name}</span>
                    {prog.artist && <span style={{ color: 'var(--text-muted)' }}> — {prog.artist}</span>}
                    <br />
                    <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>{prog.romans.join(' → ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Right side: Undo + Reset */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', pointerEvents: 'auto' }}>
          <button onClick={handleUndo} disabled={currentChords.length === 0}
            style={{ ...btnStyle(false, '#94a3b8'), opacity: currentChords.length === 0 ? 0.3 : 1 }}>
            Undo
          </button>
          <button onClick={handleReset} style={btnStyle(false, '#f43f5e')}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChordBuilderPanel;
