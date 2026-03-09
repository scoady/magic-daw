import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  useVideoConfig,
} from 'remotion';

// ── Types ──────────────────────────────────────────────────────────────────

export interface IntervalTrainerProps {
  /** The root note name (e.g. "C") */
  rootNote: string;
  /** Current interval being highlighted (semitones from root, 0-12) */
  activeInterval: number | null;
  /** All intervals to show (e.g. [0,2,4,5,7,9,11,12] for major scale) */
  scaleIntervals: number[];
  /** Which intervals the user has correctly identified */
  correctIntervals: number[];
  /** Which interval the user just guessed wrong */
  wrongInterval: number | null;
  /** Active MIDI notes for keyboard highlighting */
  activeNotes: number[];
  /** Current mode label */
  modeLabel: string;
  /** Score */
  score: { correct: number; total: number };
}

// ── Constants ──────────────────────────────────────────────────────────────

const palette = {
  bg: '#080e18',
  cyan: '#67e8f9',
  teal: '#2dd4bf',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  red: '#f87171',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  glass: 'rgba(120,200,220,0.06)',
  glassBorder: 'rgba(120,200,220,0.12)',
};

const INTERVAL_NAMES: Record<number, { name: string; short: string; color: string }> = {
  0:  { name: 'Unison (P1)', short: 'P1', color: palette.cyan },
  1:  { name: 'Minor 2nd (m2)', short: 'm2', color: palette.pink },
  2:  { name: 'Major 2nd (M2)', short: 'M2', color: palette.teal },
  3:  { name: 'Minor 3rd (m3)', short: 'm3', color: palette.purple },
  4:  { name: 'Major 3rd (M3)', short: 'M3', color: palette.teal },
  5:  { name: 'Perfect 4th (P4)', short: 'P4', color: palette.cyan },
  6:  { name: 'Tritone (TT)', short: 'TT', color: palette.red },
  7:  { name: 'Perfect 5th (P5)', short: 'P5', color: palette.gold },
  8:  { name: 'Minor 6th (m6)', short: 'm6', color: palette.purple },
  9:  { name: 'Major 6th (M6)', short: 'M6', color: palette.teal },
  10: { name: 'Minor 7th (m7)', short: 'm7', color: palette.purple },
  11: { name: 'Major 7th (M7)', short: 'M7', color: palette.pink },
  12: { name: 'Octave (P8)', short: 'P8', color: palette.cyan },
};

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db']);
const IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

// ── Component ──────────────────────────────────────────────────────────────

export const IntervalTrainer: React.FC<IntervalTrainerProps> = ({
  rootNote,
  activeInterval,
  scaleIntervals,
  correctIntervals,
  wrongInterval,
  activeNotes,
  modeLabel,
  score,
}) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const CX = W / 2;
  const CY = H / 2;

  const rootIdx = CHROMATIC.indexOf(rootNote);
  const useFlats = FLAT_KEYS.has(rootNote);
  const names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  const activeNoteSet = useMemo(() => new Set(activeNotes.map(n => n % 12)), [activeNotes]);

  // ── Horizontal interval strip ─────────────────────────────────────────
  const stripW = Math.min(W * 0.82, 900);
  const stripX = (W - stripW) / 2;
  const stripY = CY * 0.52;  // upper-middle area
  const nodeSpacing = stripW / 12;

  // Generate the 13 interval positions in a horizontal row (0=left, 12=right)
  const intervalPositions = useMemo(() => {
    return Array.from({ length: 13 }, (_, i) => {
      const x = stripX + i * nodeSpacing;
      const y = stripY;
      const noteChroma = (rootIdx + i) % 12;
      const noteName = names[noteChroma];
      const info = INTERVAL_NAMES[i];
      const inScale = scaleIntervals.includes(i);
      const isCorrect = correctIntervals.includes(i);
      const isWrong = wrongInterval === i;
      const isActive = activeInterval === i;
      const isPlaying = activeNoteSet.has(noteChroma);
      return { i, x, y, noteName, info, inScale, isCorrect, isWrong, isActive, isPlaying };
    });
  }, [stripX, stripY, nodeSpacing, rootIdx, names, scaleIntervals, correctIntervals, wrongInterval, activeInterval, activeNoteSet]);

  // ── Connecting lines from root to each interval ────────────────────────
  const rootPos = intervalPositions[0];

  // ── Piano keyboard at bottom ───────────────────────────────────────────
  const pianoKeys = useMemo(() => {
    const keys: Array<{
      chroma: number; x: number; w: number; h: number;
      isBlack: boolean; name: string; interval: number;
      inScale: boolean;
    }> = [];
    const pianoW = Math.min(W * 0.7, 700);
    const whiteW = pianoW / 8; // 8 white keys for one octave + root
    const whiteH = whiteW * 3.2;
    const blackW = whiteW * 0.58;
    const blackH = whiteH * 0.6;
    const pianoX = (W - pianoW) / 2;
    const pianoY = H - whiteH - 30;

    let wIdx = 0;
    for (let si = 0; si <= 12; si++) {
      const chroma = (rootIdx + si) % 12;
      const name = names[chroma];
      const inScale = scaleIntervals.includes(si);

      if (!IS_BLACK[chroma]) {
        keys.push({
          chroma, name, interval: si, inScale,
          x: pianoX + wIdx * whiteW,
          w: whiteW, h: whiteH, isBlack: false,
        });
        wIdx++;
      } else {
        keys.push({
          chroma, name, interval: si, inScale,
          x: pianoX + wIdx * whiteW - blackW / 2,
          w: blackW, h: blackH, isBlack: true,
        });
      }
    }
    return keys;
  }, [W, H, rootIdx, names, scaleIntervals]);

  const whites = pianoKeys.filter(k => !k.isBlack);
  const blacks = pianoKeys.filter(k => k.isBlack);
  const pianoW = whites.length > 0 ? whites[whites.length - 1].x + whites[whites.length - 1].w - whites[0].x : 0;
  const pianoX = whites.length > 0 ? whites[0].x : 0;
  const pianoY = whites.length > 0 ? H - whites[0].h - 30 : H - 200;
  const whiteH = whites.length > 0 ? whites[0].h : 150;

  // Breathing / pulse
  const pulse = Math.sin(frame * 0.06);
  const breathe = Math.sin(frame * 0.02) * 3;

  // Wrong flash
  const wrongFlash = wrongInterval !== null ? Math.max(0, 1 - (frame % 20) / 10) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <filter id="it-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="it-glow-sm" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="it-bg-glow" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#0f1a2e" />
            <stop offset="100%" stopColor={palette.bg} />
          </radialGradient>
        </defs>

        {/* Background */}
        <rect x={0} y={0} width={W} height={H} fill="url(#it-bg-glow)" />

        {/* ── Title / Mode label ───────────────────────────────────── */}
        <text
          x={CX} y={40}
          textAnchor="middle" fill={palette.text}
          fontSize={18} fontFamily="monospace" fontWeight={700}
          opacity={0.8}
        >
          Interval Trainer
        </text>
        <text
          x={CX} y={62}
          textAnchor="middle" fill={palette.cyan}
          fontSize={12} fontFamily="monospace" fontWeight={600}
          opacity={0.5}
        >
          {modeLabel} · {rootNote}
        </text>

        {/* ── Score ───────────────────────────────────────────────── */}
        <text
          x={W - 20} y={40}
          textAnchor="end" fill={palette.gold}
          fontSize={14} fontFamily="monospace" fontWeight={700}
          opacity={0.7}
        >
          {score.correct}/{score.total}
        </text>

        {/* ── Horizontal Interval Strip ────────────────────────── */}

        {/* Faint baseline track */}
        <line
          x1={stripX} y1={stripY}
          x2={stripX + stripW} y2={stripY}
          stroke={palette.glassBorder} strokeWidth={1}
          opacity={0.2}
        />
        {/* Semitone tick marks */}
        {Array.from({ length: 13 }, (_, i) => (
          <line
            key={`tick-${i}`}
            x1={stripX + i * nodeSpacing} y1={stripY + 20}
            x2={stripX + i * nodeSpacing} y2={stripY + 26}
            stroke={palette.glassBorder} strokeWidth={0.5}
            opacity={0.2}
          />
        ))}

        {/* Connection arcs from root to each scale interval */}
        {intervalPositions.filter(p => p.i > 0 && p.inScale).map((p) => {
          const isActive = p.isActive || p.isPlaying;
          const col = p.isCorrect ? palette.teal : p.info.color;
          // Arc height proportional to interval distance
          const arcH = 15 + p.i * 4;
          const midX = (rootPos.x + p.x) / 2;
          return (
            <path
              key={`arc-${p.i}`}
              d={`M ${rootPos.x} ${rootPos.y + 22} Q ${midX} ${rootPos.y + 22 + arcH} ${p.x} ${p.y + 22}`}
              fill="none"
              stroke={col}
              strokeWidth={isActive ? 2 : 0.8}
              opacity={isActive ? 0.5 : p.isCorrect ? 0.25 : 0.1}
              strokeDasharray={p.isCorrect ? 'none' : '4 3'}
            />
          );
        })}

        {/* Interval nodes */}
        {intervalPositions.map((p) => {
          const nodeR = p.i === 0 ? 24 : p.inScale ? 18 : 12;
          const col = p.isWrong ? palette.red
            : p.isCorrect ? palette.teal
            : p.isActive ? palette.gold
            : p.isPlaying ? palette.cyan
            : p.info.color;
          const opacity = p.inScale ? 1 : 0.25;
          const glowOp = p.isActive ? 0.3 + pulse * 0.1
            : p.isPlaying ? 0.2
            : p.isCorrect ? 0.15 : 0;

          return (
            <g key={`node-${p.i}`}>
              {/* Glow */}
              {glowOp > 0 && (
                <circle cx={p.x} cy={p.y} r={nodeR + 10}
                  fill={col} opacity={glowOp}
                  filter="url(#it-glow)"
                />
              )}
              {/* Wrong flash */}
              {p.isWrong && (
                <circle cx={p.x} cy={p.y} r={nodeR + 15}
                  fill={palette.red} opacity={wrongFlash * 0.3}
                />
              )}
              {/* Node circle */}
              <circle cx={p.x} cy={p.y} r={nodeR}
                fill={palette.bg} stroke={col}
                strokeWidth={p.isActive || p.isPlaying ? 2.5 : p.isCorrect ? 2 : 1.2}
                opacity={opacity}
              />
              <circle cx={p.x} cy={p.y} r={nodeR - 3}
                fill={col}
                opacity={(p.isCorrect ? 0.25 : p.isActive ? 0.2 : 0.08) * opacity}
              />
              {/* Note name */}
              <text x={p.x} y={p.y - 2}
                textAnchor="middle" dominantBaseline="central"
                fill={p.isCorrect || p.isActive ? '#fff' : col}
                fontSize={p.i === 0 ? 11 : 9}
                fontFamily="monospace" fontWeight={700}
                opacity={p.inScale ? 0.9 : 0.3}
              >
                {p.noteName}
              </text>
              {/* Interval label below */}
              <text x={p.x} y={p.y + (p.i === 0 ? 10 : 8)}
                textAnchor="middle" dominantBaseline="central"
                fill={col} fontSize={6}
                fontFamily="monospace" fontWeight={600}
                opacity={p.inScale ? 0.5 : 0.15}
              >
                {p.info.short}
              </text>
            </g>
          );
        })}

        {/* Semitone count labels under ticks */}
        {Array.from({ length: 13 }, (_, i) => (
          <text
            key={`st-${i}`}
            x={stripX + i * nodeSpacing} y={stripY + 36}
            textAnchor="middle" fill={palette.textDim}
            fontSize={6} fontFamily="monospace" opacity={0.2}
          >
            {i}
          </text>
        ))}

        {/* ── Piano Keyboard ─────────────────────────────────────── */}
        <g>
          {/* Glass backdrop */}
          <rect
            x={pianoX - 10} y={pianoY - 20}
            width={pianoW + 20} height={whiteH + 30}
            rx={6}
            fill="rgba(6,10,18,0.75)"
            stroke={palette.glassBorder} strokeWidth={0.5}
          />

          {/* White keys */}
          {whites.map((k) => {
            const isPlaying = activeNoteSet.has(k.chroma);
            const isActive = activeInterval === k.interval;
            const isCorrect = correctIntervals.includes(k.interval);
            const col = INTERVAL_NAMES[k.interval]?.color ?? palette.cyan;
            return (
              <g key={`w-${k.interval}`}>
                {(isPlaying || isActive) && (
                  <rect x={k.x + 1} y={pianoY} width={k.w - 2} height={k.h}
                    rx={3} fill={isActive ? palette.gold : col}
                    opacity={0.2} filter="url(#it-glow-sm)"
                  />
                )}
                <rect
                  x={k.x + 0.8} y={pianoY} width={k.w - 1.6} height={k.h} rx={3}
                  fill={isPlaying ? 'rgba(130,200,235,0.9)'
                    : isCorrect ? 'rgba(45,212,191,0.3)'
                    : k.inScale ? 'rgba(170,210,240,0.85)' : 'rgba(200,205,215,0.12)'}
                  stroke={k.inScale ? `${col}66` : 'rgba(80,90,110,0.15)'}
                  strokeWidth={k.inScale ? 0.8 : 0.3}
                />
                <text x={k.x + k.w / 2} y={pianoY + k.h - 6}
                  textAnchor="middle"
                  fill={k.inScale ? 'rgba(10,18,30,0.95)' : 'rgba(100,116,139,0.2)'}
                  fontSize={14} fontFamily="monospace" fontWeight={800}
                >
                  {k.name}
                </text>
                {k.inScale && (
                  <text x={k.x + k.w / 2} y={pianoY + k.h - 24}
                    textAnchor="middle"
                    fill={col} fontSize={9}
                    fontFamily="monospace" fontWeight={700}
                    opacity={0.6}
                  >
                    {INTERVAL_NAMES[k.interval]?.short}
                  </text>
                )}
              </g>
            );
          })}

          {/* Black keys */}
          {blacks.map((k) => {
            const isPlaying = activeNoteSet.has(k.chroma);
            const isCorrect = correctIntervals.includes(k.interval);
            const col = INTERVAL_NAMES[k.interval]?.color ?? palette.purple;
            return (
              <g key={`b-${k.interval}`}>
                <rect
                  x={k.x} y={pianoY} width={k.w} height={k.h} rx={2}
                  fill={isPlaying ? '#3a85b8'
                    : isCorrect ? 'rgba(45,212,191,0.4)'
                    : k.inScale ? '#2a6090' : 'rgba(15,18,25,0.85)'}
                  stroke={k.inScale ? `${col}44` : 'rgba(40,50,65,0.3)'}
                  strokeWidth={0.5}
                />
                {k.inScale && (
                  <text x={k.x + k.w / 2} y={pianoY + k.h - 5}
                    textAnchor="middle"
                    fill="rgba(230,240,255,0.95)" fontSize={10}
                    fontFamily="monospace" fontWeight={800}
                  >
                    {k.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* ── Interval info panel (when an interval is active) ──── */}
        {activeInterval !== null && activeInterval > 0 && (() => {
          const info = INTERVAL_NAMES[activeInterval];
          const targetNote = names[(rootIdx + activeInterval) % 12];
          const panelW = 200;
          const panelH = 50;
          const panelX = 20;
          const panelY = H - whiteH - 90;

          return (
            <g>
              <rect x={panelX} y={panelY} width={panelW} height={panelH}
                rx={5} fill="rgba(6,10,18,0.85)"
                stroke={info.color} strokeWidth={0.5} strokeOpacity={0.3}
              />
              <rect x={panelX} y={panelY} width={3} height={panelH}
                rx={1} fill={info.color} opacity={0.5}
              />
              <text x={panelX + 14} y={panelY + 18}
                fill={info.color} fontSize={13}
                fontFamily="monospace" fontWeight={800}
              >
                {rootNote} → {targetNote}
              </text>
              <text x={panelX + 14} y={panelY + 36}
                fill={palette.textDim} fontSize={10}
                fontFamily="monospace" fontWeight={600} opacity={0.6}
              >
                {info.name}
              </text>
            </g>
          );
        })()}
      </svg>
    </AbsoluteFill>
  );
};

export default IntervalTrainer;
