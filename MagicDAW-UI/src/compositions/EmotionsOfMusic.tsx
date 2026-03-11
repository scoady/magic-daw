// ── Emotions of Music: Cinematic Remotion Composition ─────────────────────
//
// A full-screen atmospheric experience that tells a harmonic story.
// Each chapter has unique color palettes, particle effects, and typography.

import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { frameToChapter, getNextChapter, chapterTotalFrames } from '../lib/emotionsStory';
import type { StoryChapter } from '../lib/emotionsStory';

// ── Props ─────────────────────────────────────────────────────────────────

export interface EmotionsProps {
  /** Currently active chapter override (for panel-controlled playback) */
  activeChapterIndex?: number;
}

// ── Seeded random for deterministic particles ────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── Particle generator ──────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
  opacity: number;
  hueShift: number;
}

function generateParticles(seed: number, count: number): Particle[] {
  const rng = seededRandom(seed);
  return Array.from({ length: count }, () => ({
    x: rng() * 100,
    y: rng() * 100,
    size: 1 + rng() * 4,
    speed: 0.2 + rng() * 0.8,
    phase: rng() * Math.PI * 2,
    opacity: 0.2 + rng() * 0.6,
    hueShift: -20 + rng() * 40,
  }));
}

// ── Star field (background constellation) ────────────────────────────────

interface Star {
  x: number;
  y: number;
  size: number;
  twinklePhase: number;
  brightness: number;
}

function generateStars(count: number): Star[] {
  const rng = seededRandom(42);
  return Array.from({ length: count }, () => ({
    x: rng() * 100,
    y: rng() * 100,
    size: 0.3 + rng() * 1.5,
    twinklePhase: rng() * Math.PI * 2,
    brightness: 0.15 + rng() * 0.4,
  }));
}

const STARS = generateStars(120);

// ── Harmonic distance indicator positions (circle of fifths arc) ─────────

const CIRCLE_POSITIONS: { note: string; angle: number }[] = [
  { note: 'C', angle: -90 },
  { note: 'G', angle: -90 + 30 },
  { note: 'D', angle: -90 + 60 },
  { note: 'A', angle: -90 + 90 },
  { note: 'E', angle: -90 + 120 },
  { note: 'B', angle: -90 + 150 },
  { note: 'F#', angle: -90 + 180 },
  { note: 'Db', angle: -90 + 210 },
  { note: 'Ab', angle: -90 + 240 },
  { note: 'Eb', angle: -90 + 270 },
  { note: 'Bb', angle: -90 + 300 },
  { note: 'F', angle: -90 + 330 },
];

// ── Scale degree labels ──────────────────────────────────────────────────

const SCALE_DEGREES = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const SCALE_COLORS = ['#fbbf24', '#67e8f9', '#a78bfa', '#34d399', '#fb7185', '#f472b6', '#f59e0b'];

// ── Main Composition ─────────────────────────────────────────────────────

export const EmotionsOfMusic: React.FC<EmotionsProps> = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const info = useMemo(() => frameToChapter(frame), [frame]);
  const { chapter, chapterIndex, localFrame, beatIndex, beatLocalFrame, isTransition, transitionProgress } = info;
  const nextChapter = useMemo(() => getNextChapter(chapterIndex), [chapterIndex]);
  const chapterFrames = useMemo(() => chapterTotalFrames(chapter), [chapter]);

  // Chapter progress 0→1
  const chapterProgress = localFrame / Math.max(chapterFrames, 1);

  // Current beat
  const beat = chapter.beats[beatIndex];

  // Particles for this chapter
  const particles = useMemo(
    () => generateParticles(chapterIndex * 1000 + 7, chapter.particleStyle === 'storm' ? 80 : 40),
    [chapterIndex, chapter.particleStyle],
  );

  // ── Spring values ────────────────────────────────────────────────────

  const titleSpring = spring({ frame: localFrame, fps, config: { damping: 20, mass: 0.8 } });
  const subtitleSpring = spring({ frame: localFrame - 15, fps, config: { damping: 18 } });
  const narrationSpring = (idx: number) =>
    spring({ frame: localFrame - 30 - idx * 20, fps, config: { damping: 22, mass: 0.6 } });
  const beatTextSpring = spring({ frame: beatLocalFrame, fps, config: { damping: 15, stiffness: 120 } });

  // ── Transition opacity ──────────────────────────────────────────────

  const fadeIn = interpolate(localFrame, [0, 25], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = isTransition ? interpolate(transitionProgress, [0, 1], [1, 0]) : 1;
  const masterOpacity = fadeIn * fadeOut;

  // ── Colors ──────────────────────────────────────────────────────────

  const bgColor = isTransition && nextChapter
    ? lerpColor(chapter.gradient[1], nextChapter.gradient[1], transitionProgress)
    : chapter.gradient[1];

  // ── Interval badge position on mini circle ─────────────────────────

  const harmDist = chapter.harmonicDistance;

  return (
    <AbsoluteFill style={{ background: '#0a0e1a', overflow: 'hidden' }}>
      {/* ── Layer 0: Deep background gradient ───────────────────────────── */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(ellipse at 50% 40%, ${bgColor} 0%, #0a0e1a 70%)`,
          opacity: masterOpacity,
          transition: 'background 0.3s',
        }}
      />

      {/* ── Layer 1: Star field ─────────────────────────────────────────── */}
      <svg style={{ position: 'absolute', inset: 0 }} viewBox={`0 0 ${width} ${height}`}>
        {STARS.map((s, i) => {
          const twinkle = 0.4 + 0.6 * Math.sin(frame * 0.03 + s.twinklePhase);
          return (
            <circle
              key={i}
              cx={(s.x / 100) * width}
              cy={(s.y / 100) * height}
              r={s.size}
              fill="white"
              opacity={s.brightness * twinkle * masterOpacity * 0.5}
            />
          );
        })}
      </svg>

      {/* ── Layer 2: Atmospheric particles ──────────────────────────────── */}
      <svg style={{ position: 'absolute', inset: 0 }} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <filter id="particle-glow">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        {particles.map((p, i) => {
          const t = frame * 0.01 * p.speed;
          let px = ((p.x + t * 8 + Math.sin(t + p.phase) * 5) % 110) - 5;
          let py = p.y + Math.sin(t * 1.3 + p.phase) * 8;

          // Style-specific movement
          if (chapter.particleStyle === 'swirl') {
            const angle = t * 2 + p.phase;
            px = 50 + (px - 50) * Math.cos(angle * 0.1) - (py - 50) * Math.sin(angle * 0.1) * 0.3;
            py = 50 + (py - 50) * Math.cos(angle * 0.1) + (px - 50) * Math.sin(angle * 0.1) * 0.3;
          }
          if (chapter.particleStyle === 'storm') {
            px += Math.sin(t * 3 + i) * 3;
            py += Math.cos(t * 2.5 + i * 0.7) * 4;
          }
          if (chapter.particleStyle === 'bloom' || chapter.particleStyle === 'fireworks') {
            const burst = Math.sin(t * 2 + p.phase);
            px = 50 + (px - 50) * (1 + burst * 0.3);
            py = 50 + (py - 50) * (1 + burst * 0.3);
          }

          const size = p.size * (chapter.particleStyle === 'sparkle' ? 1 + 0.5 * Math.sin(frame * 0.1 + i) : 1);

          return (
            <circle
              key={i}
              cx={(px / 100) * width}
              cy={(py / 100) * height}
              r={size}
              fill={chapter.color}
              opacity={p.opacity * masterOpacity * 0.6}
              filter="url(#particle-glow)"
            />
          );
        })}
      </svg>

      {/* ── Layer 3: Aurora / atmospheric band ─────────────────────────── */}
      {(chapter.particleStyle === 'aurora' || chapter.particleStyle === 'warm-glow') && (
        <div
          style={{
            position: 'absolute',
            left: 0, right: 0,
            top: '30%', height: '40%',
            background: `linear-gradient(180deg, transparent 0%, ${chapter.color}15 30%, ${chapter.accent}20 50%, ${chapter.color}15 70%, transparent 100%)`,
            opacity: masterOpacity * (0.4 + 0.3 * Math.sin(frame * 0.02)),
            transform: `translateY(${Math.sin(frame * 0.015) * 20}px)`,
          }}
        />
      )}

      {/* ── Layer 4: Vignette ──────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.7) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* ── Layer 5: Cinematic letterbox bars ──────────────────────────── */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 60, background: 'linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 100%)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, background: 'linear-gradient(0deg, rgba(0,0,0,0.8) 0%, transparent 100%)' }} />

      {/* ── Layer 6: Chapter number & title (top-left) ────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 80,
          left: 60,
          opacity: masterOpacity * titleSpring,
          transform: `translateY(${(1 - titleSpring) * 30}px)`,
        }}
      >
        {chapter.number > 0 && (
          <div
            style={{
              fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
              fontSize: 14,
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              color: chapter.color,
              opacity: 0.7,
              marginBottom: 8,
            }}
          >
            Chapter {chapter.number}
          </div>
        )}
        {chapter.number === 0 && (
          <div
            style={{
              fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
              fontSize: 14,
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              color: chapter.accent,
              opacity: 0.7,
              marginBottom: 8,
            }}
          >
            Prologue
          </div>
        )}
        <div
          style={{
            fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
            fontSize: 52,
            fontWeight: 300,
            color: 'white',
            lineHeight: 1.1,
            textShadow: `0 0 40px ${chapter.color}40`,
          }}
        >
          {chapter.title}
        </div>
        <div
          style={{
            fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
            fontSize: 18,
            fontStyle: 'italic',
            color: chapter.color,
            opacity: subtitleSpring * 0.8,
            marginTop: 8,
            transform: `translateY(${(1 - subtitleSpring) * 15}px)`,
          }}
        >
          {chapter.subtitle}
        </div>
      </div>

      {/* ── Layer 7: Emotion badge (top-right) ────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 85,
          right: 60,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          opacity: masterOpacity * subtitleSpring,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: chapter.color,
            boxShadow: `0 0 12px ${chapter.color}`,
          }}
        />
        <div
          style={{
            fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
            fontSize: 16,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: chapter.color,
          }}
        >
          {chapter.emotion}
        </div>
      </div>

      {/* ── Layer 8: Narration text (center-left) ─────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: 60,
          transform: 'translateY(-50%)',
          maxWidth: '55%',
        }}
      >
        {chapter.narration.map((line, i) => {
          const s = narrationSpring(i);
          const show = s > 0.01;
          if (!show) return null;
          return (
            <div
              key={i}
              style={{
                fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
                fontSize: i === 0 ? 24 : 19,
                fontWeight: i === 0 ? 500 : 300,
                color: i === 0 ? 'white' : 'rgba(255,255,255,0.75)',
                lineHeight: 1.7,
                opacity: s * masterOpacity,
                transform: `translateX(${(1 - s) * 40}px)`,
                marginBottom: 6,
              }}
            >
              {line}
            </div>
          );
        })}
      </div>

      {/* ── Layer 9: Current chord display (center-right) ─────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '40%',
          right: 80,
          textAlign: 'center',
          opacity: masterOpacity,
        }}
      >
        <div
          style={{
            fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
            fontSize: 96,
            fontWeight: 200,
            color: 'white',
            textShadow: `0 0 60px ${chapter.color}60, 0 0 120px ${chapter.color}20`,
            opacity: beatTextSpring,
            transform: `scale(${0.8 + beatTextSpring * 0.2})`,
            lineHeight: 1,
          }}
        >
          {beat?.chord ?? ''}
        </div>
        {beat?.text && (
          <div
            style={{
              fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
              fontSize: 16,
              fontStyle: 'italic',
              color: chapter.color,
              opacity: beatTextSpring * 0.7,
              marginTop: 12,
              transform: `translateY(${(1 - beatTextSpring) * 10}px)`,
            }}
          >
            {beat.text}
          </div>
        )}
      </div>

      {/* ── Layer 10: Harmonic distance indicator (bottom-right) ──────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          right: 60,
          opacity: masterOpacity * subtitleSpring,
        }}
      >
        <svg width={140} height={140} viewBox="-70 -70 140 140">
          {/* Mini circle of fifths */}
          <circle cx={0} cy={0} r={50} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
          {CIRCLE_POSITIONS.map((pos, i) => {
            const rad = (pos.angle * Math.PI) / 180;
            const x = Math.cos(rad) * 50;
            const y = Math.sin(rad) * 50;
            const isActive = i <= harmDist || (harmDist > 6 && i >= 12 - (harmDist - 6));
            return (
              <g key={pos.note}>
                <circle
                  cx={x}
                  cy={y}
                  r={pos.note === 'C' ? 6 : 3.5}
                  fill={isActive ? chapter.color : 'rgba(255,255,255,0.1)'}
                  opacity={isActive ? 0.9 : 0.3}
                />
                {pos.note === 'C' && (
                  <text
                    x={x}
                    y={y + 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#0a0e1a"
                    fontSize={7}
                    fontWeight={700}
                    fontFamily="system-ui"
                  >
                    C
                  </text>
                )}
              </g>
            );
          })}
          {/* Distance label */}
          <text
            x={0}
            y={4}
            textAnchor="middle"
            dominantBaseline="central"
            fill="rgba(255,255,255,0.5)"
            fontSize={11}
            fontFamily="system-ui"
          >
            {harmDist === 0 ? 'home' : `${harmDist}♯/♭`}
          </text>
        </svg>
      </div>

      {/* ── Layer 11: Interval note (bottom-left) ────────────────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 85,
          left: 60,
          maxWidth: '45%',
          opacity: masterOpacity * interpolate(localFrame, [50, 80], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        }}
      >
        <div
          style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: 11,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: chapter.color,
            opacity: 0.6,
            marginBottom: 6,
          }}
        >
          Harmonic Distance
        </div>
        <div
          style={{
            fontFamily: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
            fontSize: 14,
            fontStyle: 'italic',
            color: 'rgba(255,255,255,0.6)',
            lineHeight: 1.5,
          }}
        >
          {chapter.intervalNote}
        </div>
      </div>

      {/* ── Layer 12: Scale degree bar (prologue only) ────────────────── */}
      {chapter.id === 'prologue' && (
        <div
          style={{
            position: 'absolute',
            top: '78%',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 24,
            opacity: masterOpacity * interpolate(localFrame, [20, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}
        >
          {SCALE_DEGREES.map((deg, i) => {
            const isActive = beatIndex >= i;
            const beatSpring = isActive
              ? spring({ frame: Math.max(0, localFrame - i * 25), fps, config: { damping: 15 } })
              : 0;
            return (
              <div key={deg} style={{ textAlign: 'center', opacity: 0.3 + beatSpring * 0.7 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    border: `2px solid ${SCALE_COLORS[i]}`,
                    background: isActive ? `${SCALE_COLORS[i]}30` : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: '"Cormorant Garamond", serif',
                    fontSize: 14,
                    fontWeight: 600,
                    color: SCALE_COLORS[i],
                    transform: `scale(${0.7 + beatSpring * 0.3})`,
                    boxShadow: isActive ? `0 0 16px ${SCALE_COLORS[i]}40` : 'none',
                  }}
                >
                  {deg}
                </div>
                <div
                  style={{
                    fontFamily: 'system-ui',
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.4)',
                    marginTop: 6,
                  }}
                >
                  {['C', 'D', 'E', 'F', 'G', 'A', 'B'][i]}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Layer 13: Beat progress dots ──────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 30,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 8,
          opacity: masterOpacity * 0.5,
        }}
      >
        {chapter.beats.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === beatIndex ? 20 : 6,
              height: 6,
              borderRadius: 3,
              background: i === beatIndex ? chapter.color : 'rgba(255,255,255,0.2)',
              transition: 'width 0.3s, background 0.3s',
            }}
          />
        ))}
      </div>

      {/* ── Layer 14: Pulsing ring behind chord (emotion resonance) ───── */}
      <svg
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        viewBox={`0 0 ${width} ${height}`}
      >
        {[0, 1, 2].map((ring) => {
          const ringFrame = Math.max(0, beatLocalFrame - ring * 5);
          const ringSpring = spring({ frame: ringFrame, fps, config: { damping: 8, mass: 1.5 } });
          const r = 40 + ringSpring * 80 + ring * 30;
          return (
            <circle
              key={ring}
              cx={width - 120}
              cy={height * 0.4 + 20}
              r={r}
              fill="none"
              stroke={chapter.color}
              strokeWidth={1.5 - ring * 0.4}
              opacity={(1 - ringSpring) * 0.3 * masterOpacity}
            />
          );
        })}
      </svg>

      {/* ── Layer 15: Film grain overlay ──────────────────────────────── */}
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E")`,
          opacity: 0.4,
          mixBlendMode: 'overlay',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};

// ── Color interpolation helper ──────────────────────────────────────────

function lerpColor(a: string, b: string, t: number): string {
  const parseHex = (h: string) => {
    const c = h.replace('#', '');
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * t);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(lerp(r1, r2))}${toHex(lerp(g1, g2))}${toHex(lerp(b1, b2))}`;
}
