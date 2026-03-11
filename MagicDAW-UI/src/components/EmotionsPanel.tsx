// ── Emotions of Music Panel ───────────────────────────────────────────────
//
// Top-level tab that wraps the cinematic Remotion composition.
// Auto-plays chord progressions and manages chapter navigation.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { EmotionsOfMusic } from '../compositions/EmotionsOfMusic';
import type { EmotionsProps } from '../compositions/EmotionsOfMusic';
import {
  STORY_CHAPTERS, storyTotalFrames, frameToChapter, chapterTotalFrames,
} from '../lib/emotionsStory';
import type { StoryChapter } from '../lib/emotionsStory';
import { chordToMidiNotes } from '../compositions/CircleOfFifths1';
import { previewNote } from '../bridge';

// ── Styles ────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: '#0a0e1a',
  position: 'relative',
  overflow: 'hidden',
};

const controlBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 20px',
  background: 'rgba(10, 14, 26, 0.95)',
  borderTop: '1px solid rgba(255,255,255,0.06)',
  backdropFilter: 'blur(20px)',
  zIndex: 20,
};

const btnStyle = (active = false, color = '#67e8f9'): React.CSSProperties => ({
  padding: '6px 16px',
  borderRadius: 6,
  border: `1px solid ${active ? color : 'rgba(255,255,255,0.12)'}`,
  background: active ? `${color}15` : 'rgba(255,255,255,0.04)',
  color: active ? color : 'rgba(255,255,255,0.7)',
  fontSize: 13,
  fontFamily: 'system-ui, sans-serif',
  cursor: 'pointer',
  transition: 'all 0.2s',
  outline: 'none',
  whiteSpace: 'nowrap',
});

const chapterDotStyle = (active: boolean, color: string): React.CSSProperties => ({
  width: active ? 28 : 8,
  height: 8,
  borderRadius: 4,
  background: active ? color : 'rgba(255,255,255,0.15)',
  transition: 'all 0.3s ease',
  cursor: 'pointer',
});

// ── Component ─────────────────────────────────────────────────────────────

export const EmotionsPanel: React.FC = () => {
  const playerRef = useRef<PlayerRef>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const lastChordRef = useRef<string>('');
  const totalFrames = useMemo(() => storyTotalFrames(), []);

  // Track which chapter we're in
  const info = useMemo(() => frameToChapter(currentFrame), [currentFrame]);

  // ── Chord auto-play on beat changes ────────────────────────────────

  useEffect(() => {
    if (!isPlaying) return;

    const beat = info.chapter.beats[info.beatIndex];
    if (!beat) return;

    const chordKey = `${info.chapterIndex}-${info.beatIndex}`;
    if (chordKey === lastChordRef.current) return;
    lastChordRef.current = chordKey;

    // Play the chord
    const notes = chordToMidiNotes(beat.chord);
    for (const n of notes) {
      previewNote(n, 85);
    }
  }, [isPlaying, info.chapterIndex, info.beatIndex, info.chapter.beats]);

  // ── Frame tracking via Remotion Player events ───────────────────────

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const handler = (e: { detail: { frame: number } }) => {
      setCurrentFrame(e.detail.frame);
    };
    p.addEventListener('frameupdate', handler as any);
    return () => p.removeEventListener('frameupdate', handler as any);
  }, [hasStarted]);

  // ── Playback controls ──────────────────────────────────────────────

  const handlePlayPause = useCallback(() => {
    if (!playerRef.current) return;
    if (isPlaying) {
      playerRef.current.pause();
    } else {
      playerRef.current.play();
      setHasStarted(true);
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleRestart = useCallback(() => {
    if (!playerRef.current) return;
    playerRef.current.seekTo(0);
    setCurrentFrame(0);
    lastChordRef.current = '';
    playerRef.current.play();
    setIsPlaying(true);
    setHasStarted(true);
  }, []);

  const handleSeekToChapter = useCallback((chapterIndex: number) => {
    if (!playerRef.current) return;
    let frame = 0;
    for (let i = 0; i < chapterIndex; i++) {
      frame += chapterTotalFrames(STORY_CHAPTERS[i]) + 60; // +60 for transitions
    }
    playerRef.current.seekTo(frame);
    setCurrentFrame(frame);
    lastChordRef.current = '';
    if (!isPlaying) {
      playerRef.current.play();
      setIsPlaying(true);
      setHasStarted(true);
    }
  }, [isPlaying]);

  // ── Input props for Remotion ──────────────────────────────────────

  const inputProps: EmotionsProps = {
    activeChapterIndex: info.chapterIndex,
  };

  return (
    <div style={panelStyle}>
      {/* ── Remotion Player (fills available space) ─────────────────────── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {!hasStarted && (
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: 'radial-gradient(ellipse at 50% 40%, #141b2d 0%, #0a0e1a 70%)',
              cursor: 'pointer',
            }}
            onClick={handlePlayPause}
          >
            {/* Title card */}
            <div style={{
              fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
              fontSize: 14,
              letterSpacing: '0.4em',
              textTransform: 'uppercase',
              color: '#67e8f9',
              opacity: 0.6,
              marginBottom: 16,
            }}>
              Magic DAW Presents
            </div>
            <div style={{
              fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
              fontSize: 56,
              fontWeight: 300,
              color: 'white',
              textShadow: '0 0 60px rgba(103, 232, 249, 0.2)',
              marginBottom: 12,
            }}>
              Emotions of Music
            </div>
            <div style={{
              fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
              fontSize: 20,
              fontStyle: 'italic',
              color: 'rgba(255,255,255,0.5)',
              marginBottom: 40,
            }}>
              A harmonic journey through feeling
            </div>

            {/* Play button */}
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              border: '2px solid rgba(103, 232, 249, 0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(103, 232, 249, 0.05)',
              transition: 'all 0.3s',
            }}>
              <svg width={32} height={32} viewBox="0 0 24 24" fill="#67e8f9">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div style={{
              fontFamily: 'system-ui',
              fontSize: 12,
              color: 'rgba(255,255,255,0.3)',
              marginTop: 16,
              letterSpacing: '0.2em',
            }}>
              CLICK TO BEGIN
            </div>

            {/* Chapter preview */}
            <div style={{
              display: 'flex', gap: 24, marginTop: 50, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 700,
            }}>
              {STORY_CHAPTERS.map((ch) => (
                <div key={ch.id} style={{ textAlign: 'center', opacity: 0.4 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: ch.color, margin: '0 auto 6px',
                    boxShadow: `0 0 8px ${ch.color}40`,
                  }} />
                  <div style={{
                    fontFamily: '"Cormorant Garamond", serif',
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.5)',
                  }}>
                    {ch.title}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Player
          ref={playerRef}
          component={EmotionsOfMusic}
          inputProps={inputProps}
          durationInFrames={totalFrames}
          fps={30}
          compositionWidth={1920}
          compositionHeight={1080}
          style={{
            width: '100%',
            height: '100%',
          }}
          controls={false}
          loop={false}
          autoPlay={false}
          renderLoading={() => null}
        />
      </div>

      {/* ── Bottom control bar ──────────────────────────────────────────── */}
      <div style={controlBarStyle}>
        {/* Play / Pause */}
        <button
          onClick={handlePlayPause}
          style={btnStyle(isPlaying, '#67e8f9')}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>

        {/* Restart */}
        <button
          onClick={handleRestart}
          style={btnStyle(false)}
          title="Restart from beginning"
        >
          ↺ Restart
        </button>

        {/* Separator */}
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

        {/* Chapter dots */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {STORY_CHAPTERS.map((ch, i) => (
            <div
              key={ch.id}
              style={chapterDotStyle(i === info.chapterIndex, ch.color)}
              onClick={() => handleSeekToChapter(i)}
              title={`${ch.number > 0 ? `Ch.${ch.number}: ` : ''}${ch.title} — ${ch.emotion}`}
            />
          ))}
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

        {/* Current chapter info */}
        <div style={{
          fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
          fontSize: 14,
          color: info.chapter.color,
          opacity: 0.8,
        }}>
          {info.chapter.number > 0 ? `Ch.${info.chapter.number}` : 'Prologue'}
          {' · '}
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>{info.chapter.title}</span>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Current chord */}
        <div style={{
          fontFamily: '"Cormorant Garamond", serif',
          fontSize: 22,
          fontWeight: 500,
          color: 'white',
          textShadow: `0 0 20px ${info.chapter.color}40`,
          minWidth: 60,
          textAlign: 'center',
        }}>
          {info.chapter.beats[info.beatIndex]?.chord ?? ''}
        </div>
      </div>
    </div>
  );
};
