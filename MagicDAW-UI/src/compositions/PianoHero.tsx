import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SongNote {
  midi: number;   // MIDI note 21-108
  time: number;   // start time in seconds
  dur: number;    // duration in seconds
}

export type KeyRange = 41 | 88;

export interface PianoHeroProps {
  songNotes: SongNote[];
  songTitle: string;
  currentTime: number;        // playback position in seconds
  activeNotes: number[];      // currently held MIDI keys
  hitNoteIndices: number[];   // indices of notes successfully hit
  isPlaying: boolean;
  score: { hits: number; total: number; combo: number; maxCombo: number };
  lookAhead?: number;         // seconds of visible notes (default 4)
  keyRange?: KeyRange;        // 41 (compact) or 88 (full)
}

// ── Constants ──────────────────────────────────────────────────────────────

const palette = {
  bg: '#060a14',
  bgGrad: '#0c1424',
  text: '#e2e8f0',
  textDim: '#64748b',
  glass: 'rgba(120,200,220,0.06)',
  glassBorder: 'rgba(120,200,220,0.1)',
  hitLine: '#67e8f9',
  miss: '#f8717144',
};

// Chromatic rainbow for note colors
const NOTE_COLORS = [
  '#67e8f9', // C  - cyan
  '#38bdf8', // C# - sky
  '#2dd4bf', // D  - teal
  '#34d399', // D# - emerald
  '#a3e635', // E  - lime
  '#fbbf24', // F  - amber
  '#fb923c', // F# - orange
  '#f87171', // G  - red
  '#f472b6', // G# - pink
  '#a78bfa', // A  - purple
  '#818cf8', // A# - indigo
  '#c4b5fd', // B  - violet
];

const WHITE_MASK = [true, false, true, false, true, true, false, true, false, true, false, true];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Key ranges
const RANGE_88 = { low: 21, high: 108 }; // A0 → C8
const RANGE_41 = { low: 48, high: 84 };  // C3 → C7 (4 octaves centered on middle C)

// ── Keyboard layout builder ───────────────────────────────────────────────

interface KeyLayout {
  midi: number;
  x: number;
  w: number;
  h: number;
  isBlack: boolean;
  chroma: number;
}

function buildKeyboard(totalW: number, kbH: number, midiLow: number, midiHigh: number): KeyLayout[] {
  // Count white keys
  let whiteCount = 0;
  for (let m = midiLow; m <= midiHigh; m++) {
    if (WHITE_MASK[m % 12]) whiteCount++;
  }

  const wkW = totalW / whiteCount;
  const bkW = wkW * 0.6;
  const bkH = kbH * 0.62;

  // White keys first — assign sequential x positions
  const whitePos: Record<number, number> = {};
  const keys: KeyLayout[] = [];
  let wi = 0;

  for (let m = midiLow; m <= midiHigh; m++) {
    if (WHITE_MASK[m % 12]) {
      const x = wi * wkW;
      whitePos[m] = x;
      keys.push({ midi: m, x, w: wkW, h: kbH, isBlack: false, chroma: m % 12 });
      wi++;
    }
  }

  // Black keys — positioned centered between adjacent white keys
  for (let m = midiLow; m <= midiHigh; m++) {
    if (!WHITE_MASK[m % 12]) {
      const prevW = whitePos[m - 1];
      const nextW = whitePos[m + 1];
      if (prevW !== undefined && nextW !== undefined) {
        const cx = (prevW + wkW + nextW) / 2;
        keys.push({ midi: m, x: cx - bkW / 2, w: bkW, h: bkH, isBlack: true, chroma: m % 12 });
      }
    }
  }

  return keys;
}

// Map midi → key layout for fast lookup
function buildKeyLookup(keys: KeyLayout[]): Map<number, KeyLayout> {
  const map = new Map<number, KeyLayout>();
  for (const k of keys) map.set(k.midi, k);
  return map;
}

// ── Main Component ────────────────────────────────────────────────────────

export const PianoHero: React.FC<PianoHeroProps> = ({
  songNotes,
  songTitle,
  currentTime,
  activeNotes,
  hitNoteIndices,
  isPlaying,
  score,
  lookAhead = 4,
  keyRange = 41,
}) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();

  const range = keyRange === 88 ? RANGE_88 : RANGE_41;
  const KB_HEIGHT = Math.max(keyRange === 88 ? H * 0.14 : H * 0.22, 80);
  const HIT_LINE_Y = H - KB_HEIGHT;
  const WATERFALL_TOP = 50;
  const WATERFALL_H = HIT_LINE_Y - WATERFALL_TOP;

  // Pixels per second in the waterfall
  const pxPerSec = WATERFALL_H / lookAhead;

  // Build keyboard layout
  const allKeys = useMemo(() => buildKeyboard(W, KB_HEIGHT, range.low, range.high), [W, KB_HEIGHT, range.low, range.high]);
  const keyLookup = useMemo(() => buildKeyLookup(allKeys), [allKeys]);

  // Separate white/black for rendering order
  const whiteKeys = useMemo(() => allKeys.filter(k => !k.isBlack), [allKeys]);
  const blackKeys = useMemo(() => allKeys.filter(k => k.isBlack), [allKeys]);

  // Active note set for keyboard highlighting
  const activeSet = useMemo(() => new Set(activeNotes), [activeNotes]);

  // Hit note set for waterfall coloring
  const hitSet = useMemo(() => new Set(hitNoteIndices), [hitNoteIndices]);

  // Filter visible notes in the waterfall window
  const visibleNotes = useMemo(() => {
    const results: { note: SongNote; idx: number; y: number; h: number; key: KeyLayout }[] = [];
    const tMin = currentTime - 0.5; // show recently passed notes briefly
    const tMax = currentTime + lookAhead;

    for (let i = 0; i < songNotes.length; i++) {
      const n = songNotes[i];
      const noteEnd = n.time + n.dur;
      if (noteEnd < tMin || n.time > tMax) continue;

      const key = keyLookup.get(n.midi);
      if (!key) continue;

      // y: note top position (future = higher on screen)
      const y = HIT_LINE_Y - (n.time - currentTime) * pxPerSec;
      const h = Math.max(n.dur * pxPerSec, 4);

      results.push({ note: n, idx: i, y: y - h, h, key });
    }
    return results;
  }, [songNotes, currentTime, lookAhead, keyLookup, HIT_LINE_Y, pxPerSec]);

  const pulse = Math.sin(frame * 0.08) * 0.15 + 0.85;
  const comboPulse = score.combo > 5 ? Math.sin(frame * 0.12) * 0.1 : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <linearGradient id="ph-bg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={palette.bg} />
            <stop offset="100%" stopColor={palette.bgGrad} />
          </linearGradient>
          <filter id="ph-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="ph-glow-lg" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id="ph-hit-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="85%" stopColor="rgba(103,232,249,0.03)" />
            <stop offset="100%" stopColor="rgba(103,232,249,0.08)" />
          </linearGradient>
          <clipPath id="ph-waterfall-clip">
            <rect x={0} y={WATERFALL_TOP} width={W} height={WATERFALL_H + KB_HEIGHT} />
          </clipPath>
        </defs>

        {/* Background */}
        <rect x={0} y={0} width={W} height={H} fill="url(#ph-bg)" />

        {/* Faint vertical lane lines for each white key */}
        {whiteKeys.map((k) => (
          <line key={`lane-${k.midi}`}
            x1={k.x + k.w} y1={WATERFALL_TOP} x2={k.x + k.w} y2={HIT_LINE_Y}
            stroke="rgba(120,200,220,0.03)" strokeWidth={0.5} />
        ))}

        {/* Waterfall gradient overlay approaching hit line */}
        <rect x={0} y={WATERFALL_TOP} width={W} height={WATERFALL_H}
          fill="url(#ph-hit-grad)" />

        {/* ── Waterfall notes ───────────────────────────── */}
        <g clipPath="url(#ph-waterfall-clip)">
          {visibleNotes.map(({ note, idx, y, h, key }) => {
            const color = NOTE_COLORS[note.midi % 12];
            const isHit = hitSet.has(idx);
            const isPassed = note.time + note.dur < currentTime;
            const isAtHitLine = note.time <= currentTime && note.time + note.dur >= currentTime;

            const fillOpacity = isHit ? 0.15 : isPassed ? 0.06 : isAtHitLine ? 0.6 : 0.4;
            const strokeOp = isHit ? 0.3 : isPassed ? 0.08 : isAtHitLine ? 0.9 : 0.5;

            return (
              <g key={`wn-${idx}`}>
                {/* Glow for active notes at hit line */}
                {isAtHitLine && !isHit && (
                  <rect x={key.x + 1} y={y} width={key.w - 2} height={h}
                    rx={3} fill={color} opacity={0.15 * pulse}
                    filter="url(#ph-glow)" />
                )}
                {/* Hit success glow */}
                {isHit && (
                  <rect x={key.x - 2} y={y} width={key.w + 4} height={h}
                    rx={4} fill="#2dd4bf" opacity={0.3}
                    filter="url(#ph-glow)" />
                )}
                {/* Note bar */}
                <rect x={key.x + 1} y={y} width={key.w - 2} height={h}
                  rx={3}
                  fill={isHit ? '#2dd4bf' : isPassed ? palette.miss : color}
                  opacity={fillOpacity}
                  stroke={isHit ? '#2dd4bf' : color}
                  strokeWidth={isAtHitLine ? 1.5 : 0.5}
                  strokeOpacity={strokeOp} />
                {/* Note name label */}
                {h > 12 && (
                  <text
                    x={key.x + key.w / 2} y={y + Math.min(h / 2 + 4, h - 3)}
                    textAnchor="middle" fill={isHit ? '#2dd4bf' : '#fff'}
                    fontSize={Math.min(key.w * 0.45, 11)} fontFamily="monospace"
                    fontWeight={700} opacity={isPassed ? 0.15 : 0.8}
                    pointerEvents="none">
                    {NOTE_NAMES[note.midi % 12]}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* ── Hit line ──────────────────────────────────── */}
        <line x1={0} y1={HIT_LINE_Y} x2={W} y2={HIT_LINE_Y}
          stroke={palette.hitLine} strokeWidth={2}
          opacity={isPlaying ? 0.6 * pulse : 0.3} />
        <line x1={0} y1={HIT_LINE_Y} x2={W} y2={HIT_LINE_Y}
          stroke={palette.hitLine} strokeWidth={6} opacity={0.08}
          filter="url(#ph-glow-lg)" />

        {/* ── Keyboard ──────────────────────────────────── */}
        <g>
          {/* Keyboard background */}
          <rect x={0} y={HIT_LINE_Y} width={W} height={KB_HEIGHT}
            fill="rgba(6,10,18,0.95)" />

          {/* White keys */}
          {whiteKeys.map((k) => {
            const isActive = activeSet.has(k.midi);
            const color = NOTE_COLORS[k.chroma];
            const isC = k.chroma === 0;
            const octave = Math.floor(k.midi / 12) - 1;
            return (
              <g key={`wk-${k.midi}`}>
                {isActive && (
                  <rect x={k.x + 0.5} y={HIT_LINE_Y + 1} width={k.w - 1} height={k.h - 2}
                    rx={2} fill={color} opacity={0.2} filter="url(#ph-glow)" />
                )}
                <rect x={k.x + 0.5} y={HIT_LINE_Y + 1} width={k.w - 1} height={k.h - 2}
                  rx={2}
                  fill={isActive ? `${color}44` : 'rgba(180,210,240,0.85)'}
                  stroke={isActive ? color : 'rgba(100,140,180,0.2)'}
                  strokeWidth={isActive ? 1.5 : 0.5} />
                {/* Show note name — all keys on 41-key, just C on 88 */}
                {(keyRange === 41 || isC) && (
                  <text x={k.x + k.w / 2} y={HIT_LINE_Y + k.h - 4}
                    textAnchor="middle" fill={isActive ? color : 'rgba(10,18,30,0.5)'}
                    fontSize={keyRange === 41 ? 9 : 7} fontFamily="monospace" fontWeight={700}>
                    {NOTE_NAMES[k.chroma]}{isC ? octave : ''}
                  </text>
                )}
              </g>
            );
          })}

          {/* Black keys */}
          {blackKeys.map((k) => {
            const isActive = activeSet.has(k.midi);
            const color = NOTE_COLORS[k.chroma];
            return (
              <g key={`bk-${k.midi}`}>
                {isActive && (
                  <rect x={k.x} y={HIT_LINE_Y + 1} width={k.w} height={k.h}
                    rx={2} fill={color} opacity={0.3} filter="url(#ph-glow)" />
                )}
                <rect x={k.x} y={HIT_LINE_Y + 1} width={k.w} height={k.h}
                  rx={2}
                  fill={isActive ? `${color}88` : 'rgba(15,22,38,0.95)'}
                  stroke={isActive ? color : 'rgba(60,80,110,0.3)'}
                  strokeWidth={isActive ? 1 : 0.5} />
              </g>
            );
          })}
        </g>

        {/* ── HUD: song title ───────────────────────────── */}
        <text x={12} y={22} fill={palette.text}
          fontSize={12} fontFamily="monospace" fontWeight={700} opacity={0.6}>
          {songTitle || 'No song loaded'}
        </text>

        {/* ── HUD: score ────────────────────────────────── */}
        {score.total > 0 && (
          <g>
            <text x={W - 12} y={20} textAnchor="end" fill="#fbbf24"
              fontSize={14} fontFamily="monospace" fontWeight={800}
              opacity={0.8 + comboPulse}>
              {score.hits}/{score.total}
            </text>
            {score.combo > 2 && (
              <text x={W - 12} y={36} textAnchor="end" fill="#2dd4bf"
                fontSize={10} fontFamily="monospace" fontWeight={700}
                opacity={0.6 + comboPulse}>
                {score.combo}x combo
              </text>
            )}
            <text x={W - 12} y={score.combo > 2 ? 50 : 36} textAnchor="end"
              fill={palette.textDim}
              fontSize={9} fontFamily="monospace" opacity={0.4}>
              {score.total > 0 ? Math.round(score.hits / score.total * 100) : 0}%
            </text>
          </g>
        )}

        {/* ── "Press play" or "waiting" indicator ────────── */}
        {!isPlaying && songNotes.length > 0 && currentTime === 0 && (
          <g>
            <text x={W / 2} y={H / 2 - 20} textAnchor="middle"
              fill={palette.hitLine} fontSize={16} fontFamily="monospace"
              fontWeight={700} opacity={0.4 + Math.sin(frame * 0.05) * 0.2}>
              Press Play to begin
            </text>
          </g>
        )}

        {/* ── No song loaded ─────────────────────────────── */}
        {songNotes.length === 0 && (
          <text x={W / 2} y={H / 2 - 20} textAnchor="middle"
            fill={palette.textDim} fontSize={14} fontFamily="monospace"
            fontWeight={600} opacity={0.4}>
            Select a song from the track list
          </text>
        )}
      </svg>
    </AbsoluteFill>
  );
};

export default PianoHero;
