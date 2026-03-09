import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from 'remotion';
import type { MidiNote } from '../types/daw';

// ── Aurora Palette ────────────────────────────────────────────────────────────

const aurora = {
  bg: '#0d1520',
  bgDeep: '#080e18',
  teal: '#2dd4bf',
  green: '#34d399',
  cyan: '#67e8f9',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  glassBorder: 'rgba(120,200,220,0.12)',
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface LivePianoRollProps {
  notes: MidiNote[];
  activeNotes: number[];
  playheadBeat: number;
  isPlaying: boolean;
  bpm: number;
  beatsPerBar: number;
  visibleBars: number;
  scrollOffsetBeats: number;
  octaveRange: [number, number];
  selectedTool: 'select' | 'draw' | 'erase';
  keySignature: { root: string; mode: string };
  chordName?: string;
  selectedNoteIds?: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALE_INTERVALS: Record<string, number[]> = {
  'major': [0, 2, 4, 5, 7, 9, 11],
  'natural minor': [0, 2, 3, 5, 7, 8, 10],
  'minor': [0, 2, 3, 5, 7, 8, 10],
  'dorian': [0, 2, 3, 5, 7, 9, 10],
  'mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'pentatonic': [0, 2, 4, 7, 9],
};

function getScaleNotes(root: string, mode: string): Set<number> {
  const rootIdx = NOTE_NAMES.indexOf(root.replace(/m$/, ''));
  if (rootIdx === -1) return new Set();
  const intervals = SCALE_INTERVALS[mode] ?? SCALE_INTERVALS['natural minor'] ?? [];
  const set = new Set<number>();
  for (const iv of intervals) {
    set.add((rootIdx + iv) % 12);
  }
  return set;
}

function isBlackKey(noteIndex: number): boolean {
  return [1, 3, 6, 8, 10].includes(noteIndex % 12);
}

function noteToName(midi: number): string {
  const note = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[note]}${octave}`;
}

function velocityToColor(v: number): string {
  const t = v / 127;
  if (t >= 0.85) return aurora.pink;
  if (t >= 0.7) return aurora.cyan;
  if (t >= 0.5) return aurora.green;
  return aurora.purple;
}

function velocityToGradientId(v: number): string {
  const t = v / 127;
  if (t >= 0.85) return 'vel-high';
  if (t >= 0.7) return 'vel-mid-high';
  if (t >= 0.5) return 'vel-mid';
  return 'vel-low';
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── Memoized Sub-components ─────────────────────────────────────────────────

/** Static background: deep space color, aurora washes (these don't change with notes) */
const BackgroundGrid = React.memo<{
  bgDots: Array<{ x: number; y: number; r: number; brightness: number }>;
  frame: number;
  gridEntrance: number;
  noteDensity: number;
}>(({ bgDots, frame, gridEntrance, noteDensity }) => {
  const auroraShift = Math.sin(frame * 0.02) * 5;
  return (
    <>
      <rect width="1000" height="600" fill={aurora.bgDeep} />
      <g opacity={gridEntrance}>
        <rect
          width="1000" height="600"
          fill="url(#aurora-wash-1)"
          transform={`translate(${auroraShift}, ${-auroraShift * 0.5})`}
        />
        <rect
          width="1000" height="600"
          fill="url(#aurora-wash-2)"
          transform={`translate(${-auroraShift * 0.7}, ${auroraShift * 0.3})`}
        />
      </g>
      <g opacity={gridEntrance * 0.5}>
        {bgDots.map((dot, i) => {
          const twinkle = 0.5 + 0.5 * Math.sin(frame * 0.05 + i * 1.7);
          return (
            <circle
              key={i}
              cx={dot.x * 10}
              cy={dot.y * 6}
              r={dot.r}
              fill={aurora.cyan}
              opacity={dot.brightness * twinkle}
            />
          );
        })}
      </g>
      {/* Dynamic aurora gradient stops need noteDensity */}
      {noteDensity > 0 && null}
    </>
  );
});
BackgroundGrid.displayName = 'BackgroundGrid';

/** Piano keyboard on the left side */
const PianoKeyboard = React.memo<{
  totalKeys: number;
  midiMin: number;
  activePitchSet: Set<number>;
  frame: number;
  fps: number;
  KEY_H: number;
  PIANO_W: number;
}>(({ totalKeys, midiMin, activePitchSet, frame, fps, KEY_H, PIANO_W }) => (
  <>
    {Array.from({ length: totalKeys }, (_, i) => {
      const noteIdx = totalKeys - 1 - i;
      const midiNote = midiMin + noteIdx;
      const y = i * KEY_H;
      const black = isBlackKey(noteIdx);
      const isC = noteIdx % 12 === 0;
      const isActive = activePitchSet.has(midiNote);

      const keyPress = isActive
        ? spring({ frame, fps, config: { damping: 20, stiffness: 200, mass: 0.3 } })
        : 0;

      const keyW = black ? 34 : PIANO_W;
      const keyFill = isActive
        ? aurora.cyan
        : black
          ? 'rgba(10,15,25,0.85)'
          : 'rgba(200,220,230,0.08)';

      return (
        <g key={i}>
          <rect
            x={0} y={y} width={keyW} height={KEY_H - 0.3}
            fill={keyFill} stroke={aurora.glassBorder} strokeWidth={0.3} rx={1}
            opacity={isActive ? 0.9 : 1}
            filter={isActive ? 'url(#lpr-key-glow)' : undefined}
          />
          {black && !isActive && (
            <rect x={0} y={y} width={keyW} height={KEY_H - 0.3}
              fill="url(#black-key-aurora)" rx={1} opacity={0.5} />
          )}
          {isActive && (
            <rect x={0} y={y - 1} width={keyW + 4} height={KEY_H + 1.7}
              fill={aurora.cyan} rx={2}
              opacity={0.15 + 0.1 * Math.sin(frame * 0.15)}
              filter="url(#lpr-key-glow)" />
          )}
          {isActive && keyPress > 0 && (
            <rect x={1} y={y + 1}
              width={(keyW - 2) * (0.95 + 0.05 * keyPress)}
              height={KEY_H - 2.3} fill="#ffffff" rx={1}
              opacity={0.15 * keyPress} />
          )}
          {isC && (
            <text x={PIANO_W - 4} y={y + KEY_H * 0.7}
              textAnchor="end" fill={isActive ? '#ffffff' : aurora.textDim}
              fontSize={7} fontFamily="monospace" opacity={isActive ? 1 : 0.7}>
              {noteToName(midiNote)}
            </text>
          )}
        </g>
      );
    })}
  </>
));
PianoKeyboard.displayName = 'PianoKeyboard';

/** Grid lines (horizontal rows + vertical beat/sub-beat lines) */
const GridLines = React.memo<{
  totalKeys: number;
  midiMin: number;
  scaleNotes: Set<number>;
  KEY_H: number;
  ROLL_X: number;
  ROLL_W: number;
  GRID_H: number;
  BEAT_W: number;
  totalBeats: number;
  beatsPerBar: number;
}>(({ totalKeys, midiMin, scaleNotes, KEY_H, ROLL_X, ROLL_W, GRID_H, BEAT_W, totalBeats, beatsPerBar }) => (
  <>
    {/* Row backgrounds */}
    {Array.from({ length: totalKeys }, (_, i) => {
      const noteIdx = totalKeys - 1 - i;
      const y = i * KEY_H;
      const black = isBlackKey(noteIdx);
      const notePc = (midiMin + noteIdx) % 12;
      const inScale = scaleNotes.has(notePc);
      return (
        <rect key={i} x={ROLL_X} y={y} width={ROLL_W} height={KEY_H}
          fill={black
            ? inScale ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.2)'
            : inScale ? 'rgba(103,232,249,0.015)' : 'rgba(0,0,0,0.06)'}
        />
      );
    })}
    {/* Horizontal lines */}
    {Array.from({ length: totalKeys + 1 }, (_, i) => (
      <line key={i}
        x1={ROLL_X} y1={i * KEY_H} x2={ROLL_X + ROLL_W} y2={i * KEY_H}
        stroke={i % 12 === 0 ? 'rgba(120,200,220,0.1)' : 'rgba(120,200,220,0.04)'}
        strokeWidth={i % 12 === 0 ? 0.6 : 0.3}
      />
    ))}
    {/* Vertical beat lines */}
    {Array.from({ length: totalBeats + 1 }, (_, i) => {
      const isBar = i % beatsPerBar === 0;
      return (
        <line key={i}
          x1={ROLL_X + i * BEAT_W} y1={0} x2={ROLL_X + i * BEAT_W} y2={GRID_H}
          stroke={isBar ? 'rgba(103,232,249,0.25)' : 'rgba(120,200,220,0.08)'}
          strokeWidth={isBar ? 0.8 : 0.4}
        />
      );
    })}
    {/* Sub-beat lines (16ths) */}
    {Array.from({ length: totalBeats * 4 }, (_, i) => {
      if (i % 4 === 0) return null;
      const x = ROLL_X + (i / 4) * BEAT_W;
      return (
        <line key={i}
          x1={x} y1={0} x2={x} y2={GRID_H}
          stroke="rgba(120,200,220,0.025)" strokeWidth={0.3}
        />
      );
    })}
  </>
));
GridLines.displayName = 'GridLines';

// ── Main Component ────────────────────────────────────────────────────────────

export const LivePianoRoll: React.FC<LivePianoRollProps> = ({
  notes,
  activeNotes,
  playheadBeat,
  isPlaying,
  bpm: _bpm,
  beatsPerBar,
  visibleBars,
  scrollOffsetBeats,
  octaveRange,
  selectedTool: _selectedTool,
  keySignature,
  chordName,
  selectedNoteIds: selectedNoteIdsArr,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Dimensions
  const PIANO_W = 52;
  const VELOCITY_LANE_RATIO = 0.15;

  const octLow = octaveRange[0];
  const octHigh = octaveRange[1];
  const totalKeys = (octHigh - octLow + 1) * 12;
  const midiMin = octLow * 12 + 12;
  const midiMax = (octHigh + 1) * 12 + 12;
  const totalBeats = visibleBars * beatsPerBar;

  // Selected note IDs as a Set for O(1) lookup
  const selectedNoteIdSet = useMemo(
    () => new Set(selectedNoteIdsArr ?? []),
    [selectedNoteIdsArr],
  );

  // Scale highlighting
  const scaleNotes = useMemo(
    () => getScaleNotes(keySignature.root, keySignature.mode),
    [keySignature.root, keySignature.mode],
  );

  // Filter notes to visible range
  const visibleNotes = useMemo(() => {
    const endBeat = scrollOffsetBeats + totalBeats;
    return notes.filter(
      (n) =>
        n.pitch >= midiMin &&
        n.pitch < midiMax &&
        n.start + n.duration > scrollOffsetBeats &&
        n.start < endBeat,
    );
  }, [notes, midiMin, midiMax, scrollOffsetBeats, totalBeats]);

  // Active pitches set
  const activePitchSet = useMemo(() => new Set(activeNotes), [activeNotes]);

  // Constellation background dots (static, memoized once)
  const bgDots = useMemo(() => {
    const rand = seededRandom(42);
    return Array.from({ length: 80 }, () => ({
      x: rand() * 100,
      y: rand() * 100,
      r: 0.3 + rand() * 0.8,
      brightness: 0.1 + rand() * 0.3,
    }));
  }, []);

  // Particle seeds — reduced to max 6 per active note for perf
  const particleSeeds = useMemo(() => {
    const rand = seededRandom(137);
    return Array.from({ length: 6 }, () => ({
      dx: (rand() - 0.5) * 20,
      dy: -rand() * 30 - 5,
      size: 0.5 + rand() * 1.5,
      delay: rand() * 30,
      life: 20 + rand() * 40,
    }));
  }, []);

  // Note density for aurora background intensity
  const noteDensity = Math.min(1, visibleNotes.length / 30 + activePitchSet.size / 8);

  // Entrance animation
  const gridEntrance = spring({
    frame,
    fps,
    config: { damping: 60, stiffness: 40 },
  });

  // Layout calculations (memoized)
  const layout = useMemo(() => {
    const ROLL_X = PIANO_W;
    const ROLL_W = 1000 - PIANO_W - 4;
    const VEL_H = 600 * VELOCITY_LANE_RATIO;
    const GRID_H = 600 - VEL_H - 4;
    const KEY_H = GRID_H / totalKeys;
    const BEAT_W = ROLL_W / totalBeats;
    return { ROLL_X, ROLL_W, VEL_H, GRID_H, KEY_H, BEAT_W };
  }, [totalKeys, totalBeats]);

  const { ROLL_X, ROLL_W, VEL_H, GRID_H, KEY_H, BEAT_W } = layout;

  // Note layout calculations (memoized)
  const noteLayouts = useMemo(() => {
    return visibleNotes.map((note) => {
      const rowIdx = totalKeys - 1 - (note.pitch - midiMin);
      const noteY = rowIdx * KEY_H + 1;
      const noteX = ROLL_X + (note.start - scrollOffsetBeats) * BEAT_W;
      const noteW = note.duration * BEAT_W - 1;
      const noteH = KEY_H - 2;
      const gradId = velocityToGradientId(note.velocity);
      const opacity = 0.55 + (note.velocity / 127) * 0.45;
      const isSelected = selectedNoteIdSet.has(note.id);
      return { note, rowIdx, noteY, noteX, noteW, noteH, gradId, opacity, isSelected };
    });
  }, [visibleNotes, totalKeys, midiMin, KEY_H, ROLL_X, scrollOffsetBeats, BEAT_W, selectedNoteIdSet]);

  // Playhead position
  const playheadLocalBeat = playheadBeat - scrollOffsetBeats;
  const playheadX = ROLL_X + playheadLocalBeat * BEAT_W;
  const playheadVisible = playheadLocalBeat >= 0 && playheadLocalBeat <= totalBeats;

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent', overflow: 'hidden' }}>
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 1000 600"
          preserveAspectRatio="none"
          style={{ display: 'block' }}
        >
          <defs>
            {/* Use CSS filters where possible — keep only essential SVG filters */}
            <filter id="lpr-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="lpr-key-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="lpr-playhead-glow" x="-200%" y="-10%" width="500%" height="120%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="lpr-particle-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="lpr-selected-glow" x="-20%" y="-30%" width="140%" height="160%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Velocity gradients */}
            <linearGradient id="vel-high" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={aurora.pink} />
              <stop offset="100%" stopColor="#fff" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="vel-mid-high" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={aurora.cyan} />
              <stop offset="100%" stopColor={aurora.teal} />
            </linearGradient>
            <linearGradient id="vel-mid" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={aurora.green} />
              <stop offset="100%" stopColor={aurora.cyan} />
            </linearGradient>
            <linearGradient id="vel-low" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={aurora.purple} />
              <stop offset="100%" stopColor={aurora.teal} />
            </linearGradient>

            {/* Aurora background gradients */}
            <radialGradient id="aurora-wash-1" cx="30%" cy="40%" r="60%">
              <stop offset="0%" stopColor={aurora.teal} stopOpacity={0.06 * noteDensity} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <radialGradient id="aurora-wash-2" cx="70%" cy="60%" r="50%">
              <stop offset="0%" stopColor={aurora.purple} stopOpacity={0.04 * noteDensity} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>

            {/* Playhead trail gradient */}
            <linearGradient id="playhead-trail" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={aurora.cyan} stopOpacity="0" />
              <stop offset="70%" stopColor={aurora.cyan} stopOpacity="0.05" />
              <stop offset="100%" stopColor={aurora.cyan} stopOpacity="0.15" />
            </linearGradient>

            {/* Piano key aurora gradient for black keys */}
            <linearGradient id="black-key-aurora" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(103,232,249,0.04)" />
              <stop offset="50%" stopColor="rgba(167,139,250,0.03)" />
              <stop offset="100%" stopColor="rgba(45,212,191,0.04)" />
            </linearGradient>

            {/* Selected note gradient */}
            <linearGradient id="selected-note" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="100%" stopColor={aurora.cyan} stopOpacity="0.8" />
            </linearGradient>
          </defs>

          {/* ── Background ─────────────────────────────────────────────── */}
          <BackgroundGrid
            bgDots={bgDots}
            frame={frame}
            gridEntrance={gridEntrance}
            noteDensity={noteDensity}
          />

          {/* ── Main grid area ─────────────────────────────────────────── */}
          <g opacity={gridEntrance}>
            {/* Piano Keyboard */}
            <PianoKeyboard
              totalKeys={totalKeys}
              midiMin={midiMin}
              activePitchSet={activePitchSet}
              frame={frame}
              fps={fps}
              KEY_H={KEY_H}
              PIANO_W={PIANO_W}
            />

            {/* Grid */}
            <GridLines
              totalKeys={totalKeys}
              midiMin={midiMin}
              scaleNotes={scaleNotes}
              KEY_H={KEY_H}
              ROLL_X={ROLL_X}
              ROLL_W={ROLL_W}
              GRID_H={GRID_H}
              BEAT_W={BEAT_W}
              totalBeats={totalBeats}
              beatsPerBar={beatsPerBar}
            />

            {/* ── Active note row highlights ───────────────────────── */}
            {activeNotes.map((pitch) => {
              if (pitch < midiMin || pitch >= midiMax) return null;
              const rowIdx = totalKeys - 1 - (pitch - midiMin);
              const y = rowIdx * KEY_H;
              return (
                <g key={`active-row-${pitch}`}>
                  <rect x={ROLL_X} y={y} width={ROLL_W} height={KEY_H}
                    fill={aurora.cyan} opacity={0.06 + 0.03 * Math.sin(frame * 0.12)} />
                  <line x1={ROLL_X} y1={y + KEY_H / 2} x2={ROLL_X + ROLL_W} y2={y + KEY_H / 2}
                    stroke={aurora.cyan} strokeWidth={0.5} opacity={0.12} />
                </g>
              );
            })}

            {/* ── Playhead trail ────────────────────────────────────── */}
            {playheadVisible && isPlaying && (
              <rect x={ROLL_X} y={0}
                width={Math.max(0, playheadX - ROLL_X)} height={GRID_H}
                fill="url(#playhead-trail)" opacity={0.6} />
            )}

            {/* ── MIDI Notes ────────────────────────────────────────── */}
            {noteLayouts.map(({ note, rowIdx, noteY, noteX, noteW, noteH, gradId, opacity, isSelected }, ni) => {
              if (rowIdx < 0 || rowIdx >= totalKeys) return null;

              const noteEntrance = spring({
                frame: frame - (ni * 0.8 + 3),
                fps,
                config: { damping: 35, stiffness: 80, mass: 0.5 },
              });

              const scaleY = interpolate(
                noteEntrance,
                [0, 1],
                [0.3, 1],
                { extrapolateRight: 'clamp' },
              );

              return (
                <g
                  key={note.id}
                  opacity={opacity * noteEntrance}
                  transform={`translate(0, ${noteY + noteH / 2}) scale(1, ${scaleY}) translate(0, ${-(noteY + noteH / 2)})`}
                >
                  {/* Selected glow */}
                  {isSelected && (
                    <rect
                      x={noteX - 2} y={noteY - 2}
                      width={noteW + 4} height={noteH + 4}
                      rx={5} fill={aurora.cyan}
                      opacity={0.25 + 0.1 * Math.sin(frame * 0.12)}
                      filter="url(#lpr-selected-glow)"
                    />
                  )}
                  {/* Inner glow */}
                  <rect
                    x={noteX - 1} y={noteY - 1}
                    width={noteW + 2} height={noteH + 2}
                    rx={4} fill={velocityToColor(note.velocity)}
                    opacity={0.1} filter="url(#lpr-glow)"
                  />
                  {/* Note body */}
                  <rect
                    x={noteX} y={noteY}
                    width={noteW} height={noteH}
                    rx={3}
                    fill={isSelected ? 'url(#selected-note)' : `url(#${gradId})`}
                    opacity={isSelected ? 0.95 : 0.85}
                  />
                  {/* Frosted top edge */}
                  <rect
                    x={noteX + 1} y={noteY}
                    width={noteW - 2} height={Math.min(noteH * 0.3, 3)}
                    rx={1.5} fill="#ffffff"
                    opacity={isSelected ? 0.25 : 0.12}
                  />
                  {/* Left edge highlight */}
                  <rect
                    x={noteX} y={noteY}
                    width={2.5} height={noteH}
                    rx={1} fill="#ffffff"
                    opacity={isSelected ? 0.5 : 0.3}
                  />
                  {/* Right edge resize handle (visible when selected) */}
                  {isSelected && (
                    <rect
                      x={noteX + noteW - 3} y={noteY}
                      width={3} height={noteH}
                      rx={1} fill="#ffffff" opacity={0.4}
                    />
                  )}
                  {/* Selection border */}
                  {isSelected && (
                    <rect
                      x={noteX} y={noteY}
                      width={noteW} height={noteH}
                      rx={3} fill="none"
                      stroke="#ffffff" strokeWidth={1}
                      opacity={0.6}
                    />
                  )}
                </g>
              );
            })}

            {/* ── Live recording rectangles ────────────────────────── */}
            {playheadVisible && isPlaying && activeNotes.map((pitch) => {
              if (pitch < midiMin || pitch >= midiMax) return null;
              const rowIdx = totalKeys - 1 - (pitch - midiMin);
              const y = rowIdx * KEY_H + 1;
              const h = KEY_H - 2;
              const rectX = playheadX - 8;
              const rectW = 8;
              const pulseOpacity = 0.5 + 0.2 * Math.sin(frame * 0.15);
              return (
                <g key={`rec-${pitch}`}>
                  <rect x={rectX} y={y} width={Math.max(rectW, 4)} height={h}
                    rx={2} fill={aurora.cyan} opacity={pulseOpacity} />
                  <rect x={rectX} y={y} width={Math.max(rectW, 4)} height={h}
                    rx={2} fill={aurora.cyan} opacity={0.2} filter="url(#lpr-glow)" />
                </g>
              );
            })}

            {/* ── Live note glow indicators at grid left edge ── */}
            {activeNotes.map((pitch) => {
              if (pitch < midiMin || pitch >= midiMax) return null;
              const rowIdx = totalKeys - 1 - (pitch - midiMin);
              const y = rowIdx * KEY_H + 1;
              const h = KEY_H - 2;
              return (
                <g key={`live-${pitch}`}>
                  <rect x={ROLL_X} y={y - 2} width={20} height={h + 4}
                    rx={4} fill={aurora.cyan} opacity={0.25}
                    filter="url(#lpr-key-glow)" />
                  <rect x={ROLL_X + 1} y={y} width={14} height={h}
                    rx={3} fill={aurora.cyan} opacity={0.7} />
                  <rect x={ROLL_X + 1} y={y} width={3} height={h}
                    rx={1} fill="#ffffff" opacity={0.5} />
                </g>
              );
            })}

            {/* ── Particles drifting up from active notes (max 6 per note) ── */}
            {activeNotes.map((pitch) => {
              if (pitch < midiMin || pitch >= midiMax) return null;
              const rowIdx = totalKeys - 1 - (pitch - midiMin);
              const baseY = rowIdx * KEY_H;
              const baseX = ROLL_X + 10;
              return (
                <g key={`particles-${pitch}`}>
                  {particleSeeds.map((seed, pi) => {
                    const age = ((frame + seed.delay) % seed.life) / seed.life;
                    const px = baseX + seed.dx * age;
                    const py = baseY + seed.dy * age;
                    const pOpacity = (1 - age) * 0.6;
                    if (pOpacity <= 0) return null;
                    return (
                      <circle
                        key={pi}
                        cx={px} cy={py}
                        r={seed.size * (1 - age * 0.5)}
                        fill={aurora.cyan} opacity={pOpacity}
                        filter="url(#lpr-particle-glow)"
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* ── Playhead ────────────────────────────────────────── */}
            {playheadVisible && (
              <g>
                <line x1={playheadX} y1={0} x2={playheadX} y2={GRID_H}
                  stroke={aurora.cyan} strokeWidth={2}
                  filter="url(#lpr-playhead-glow)" opacity={0.7} />
                <line x1={playheadX} y1={0} x2={playheadX} y2={GRID_H}
                  stroke={aurora.cyan} strokeWidth={1} opacity={0.95} />
                <polygon
                  points={`${playheadX},8 ${playheadX - 5},0 ${playheadX},2 ${playheadX + 5},0`}
                  fill={aurora.cyan} opacity={0.9} />
                <line x1={playheadX} y1={0} x2={playheadX} y2={GRID_H}
                  stroke={aurora.teal} strokeWidth={6}
                  opacity={0.08 + 0.04 * Math.sin(frame * 0.1)} />
              </g>
            )}

            {/* ── Velocity Lane ─────────────────────────────────────── */}
            <g>
              <line x1={ROLL_X} y1={GRID_H + 2} x2={ROLL_X + ROLL_W} y2={GRID_H + 2}
                stroke={aurora.glassBorder} strokeWidth={0.5} />
              <text x={4} y={GRID_H + 16} fill={aurora.textDim}
                fontSize={7} fontFamily="monospace" opacity={0.5}>
                VEL
              </text>

              {/* Velocity bars */}
              {noteLayouts.map(({ note, noteX, isSelected }, ni) => {
                const maxBarH = VEL_H * 0.85;
                const barH = (note.velocity / 127) * maxBarH;
                const color = isSelected ? '#ffffff' : velocityToColor(note.velocity);

                const barEntrance = spring({
                  frame: frame - (ni * 0.8 + 5),
                  fps,
                  config: { damping: 30, stiffness: 60 },
                });

                return (
                  <g key={`vel-${note.id}`} opacity={barEntrance}>
                    <rect
                      x={noteX} y={GRID_H + 4 + VEL_H - barH * barEntrance}
                      width={5} height={barH * barEntrance}
                      rx={1} fill={color} opacity={0.2}
                      filter="url(#lpr-glow)"
                    />
                    <rect
                      x={noteX + 1} y={GRID_H + 4 + VEL_H - barH * barEntrance}
                      width={4} height={barH * barEntrance}
                      rx={1} fill={color}
                      opacity={isSelected ? 0.9 : 0.75}
                    />
                    {/* Selection indicator on velocity bar */}
                    {isSelected && (
                      <circle
                        cx={noteX + 3} cy={GRID_H + 4 + VEL_H - barH * barEntrance - 3}
                        r={2} fill="#ffffff" opacity={0.8}
                      />
                    )}
                  </g>
                );
              })}

              {/* Velocity envelope curve */}
              {visibleNotes.length > 1 && (() => {
                const maxBarH = VEL_H * 0.85;
                const points = visibleNotes
                  .slice()
                  .sort((a, b) => a.start - b.start)
                  .map((note) => {
                    const x = ROLL_X + (note.start - scrollOffsetBeats) * BEAT_W + 3;
                    const barH = (note.velocity / 127) * maxBarH;
                    const y = GRID_H + 4 + VEL_H - barH;
                    return `${x},${y}`;
                  });
                return (
                  <polyline
                    points={points.join(' ')}
                    fill="none" stroke={aurora.cyan}
                    strokeWidth={0.8} opacity={0.25}
                    strokeLinejoin="round"
                  />
                );
              })()}
            </g>

            {/* ── Chord Overlay ─────────────────────────────────────── */}
            {chordName && (
              <g>
                <rect x={ROLL_X + ROLL_W - 90} y={8}
                  width={80} height={24} rx={6}
                  fill="rgba(120,200,220,0.08)"
                  stroke={aurora.glassBorder} strokeWidth={0.5} />
                <rect x={ROLL_X + ROLL_W - 88} y={10}
                  width={76} height={20} rx={5}
                  fill={aurora.cyan}
                  opacity={0.05 + 0.02 * Math.sin(frame * 0.08)} />
                <text x={ROLL_X + ROLL_W - 50} y={24}
                  textAnchor="middle" fill={aurora.cyan}
                  fontSize={12} fontFamily="monospace" fontWeight="bold"
                  opacity={0.9}>
                  {chordName}
                </text>
              </g>
            )}
          </g>
        </svg>
      </div>
    </AbsoluteFill>
  );
};
