import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from 'remotion';
import type { Track, Clip } from '../types/daw';

// ── Props ────────────────────────────────────────────────────────────────────

export interface LiveArrangeProps {
  tracks: Track[];
  playheadBeat: number;
  isPlaying: boolean;
  bpm: number;
  beatsPerBar: number;
  totalBars: number;
  visibleBars: number;
  scrollOffsetBars: number;
  selectedClipId: string | null;
  selectedTrackId: string | null;
  loopStart?: number;
  loopEnd?: number;
  markers: Array<{ position: number; label: string; color: string }>;
}

// ── Theme ────────────────────────────────────────────────────────────────────

const A = {
  bg: '#0d1520',
  bgDeep: '#080e18',
  teal: '#2dd4bf',
  green: '#34d399',
  cyan: '#67e8f9',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  orange: '#fb923c',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  textMuted: '#64748b',
  glass: 'rgba(120,200,220,0.06)',
  glassBorder: 'rgba(120,200,220,0.12)',
  glassBright: 'rgba(120,200,220,0.25)',
};

// ── Layout constants ─────────────────────────────────────────────────────────

const HEADER_W = 120;
const RULER_H = 32;
const TRACK_H = 60;
const ENERGY_H = 24;

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  // Handle rgba() pass-through
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Section markers (default if none provided via props.markers) ─────────

const DEFAULT_SECTIONS = [
  { position: 1, label: 'INTRO', color: A.teal },
  { position: 9, label: 'VERSE', color: A.green },
  { position: 17, label: 'CHORUS', color: A.cyan },
  { position: 25, label: 'BRIDGE', color: A.purple },
];

// ── Constellation background dots ────────────────────────────────────────────

function generateConstellationDots(count: number, w: number, h: number) {
  const rng = seededRandom(42);
  const dots: { x: number; y: number; r: number; phase: number }[] = [];
  for (let i = 0; i < count; i++) {
    dots.push({
      x: rng() * w,
      y: rng() * h,
      r: 0.3 + rng() * 1.2,
      phase: rng() * Math.PI * 2,
    });
  }
  return dots;
}

// ── Energy curve calculation ─────────────────────────────────────────────────

function computeEnergy(tracks: Track[], totalBars: number): number[] {
  const energy: number[] = [];
  for (let bar = 1; bar <= totalBars; bar++) {
    let count = 0;
    for (const track of tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (bar >= clip.startBar && bar < clip.startBar + clip.lengthBars) {
          count++;
          break;
        }
      }
    }
    energy.push(count / Math.max(tracks.length, 1));
  }
  return energy;
}

// ── Clip content renderers ───────────────────────────────────────────────────

function renderMidiContent(
  x: number, y: number, w: number, h: number,
  color: string, seed: number, clip: Clip,
): React.ReactNode {
  // If clip has real notes, render them as mini bars
  if (clip.notes && clip.notes.length > 0) {
    const notes = clip.notes;
    const minPitch = Math.min(...notes.map(n => n.pitch));
    const maxPitch = Math.max(...notes.map(n => n.pitch));
    const pitchRange = Math.max(maxPitch - minPitch, 1);
    const totalBeats = clip.lengthBars * 4; // assume 4/4
    const contentY = y + 16;
    const contentH = h - 20;

    return (
      <g>
        {notes.map((note, i) => {
          const nx = x + 3 + ((note.start) / totalBeats) * (w - 6);
          const nw = Math.max(2, (note.duration / totalBeats) * (w - 6));
          const ny = contentY + (1 - (note.pitch - minPitch) / pitchRange) * (contentH - 3);
          const nh = Math.max(1.5, 3);
          return (
            <rect
              key={`mn-${i}`}
              x={nx} y={ny} width={nw} height={nh}
              rx={0.75}
              fill={hexToRgba(color, 0.6 + (note.velocity / 127) * 0.3)}
            />
          );
        })}
      </g>
    );
  }

  // Fallback: procedural mini-melody bars
  const rng = seededRandom(seed);
  const barCount = Math.max(8, Math.floor(w / 6));
  const contentY = y + 16;
  const contentH = h - 20;
  const bars: React.ReactNode[] = [];
  for (let i = 0; i < barCount; i++) {
    const bx = x + 3 + (i / barCount) * (w - 6);
    const bh = rng() * contentH * 0.7 + contentH * 0.15;
    const by = contentY + contentH - bh - rng() * contentH * 0.2;
    bars.push(
      <rect
        key={`mb-${i}`}
        x={bx} y={by}
        width={Math.max(2, (w - 6) / barCount - 1)}
        height={Math.max(1.5, bh * 0.3)}
        rx={0.75}
        fill={hexToRgba(color, 0.35 + rng() * 0.25)}
      />
    );
  }
  return <g>{bars}</g>;
}

function renderAudioContent(
  x: number, y: number, w: number, h: number,
  color: string, seed: number,
): React.ReactNode {
  const rng = seededRandom(seed);
  const steps = Math.max(Math.floor(w / 2), 24);
  const contentY = y + 16;
  const contentH = h - 20;
  const midY = contentY + contentH / 2;

  // Build top and bottom waveform paths
  let topPath = `M ${x + 3} ${midY}`;
  let bottomPath = `M ${x + 3} ${midY}`;
  for (let i = 0; i <= steps; i++) {
    const px = x + 3 + (i / steps) * (w - 6);
    const envelope = Math.sin((i / steps) * Math.PI) * 0.8 + 0.2;
    const noise = rng();
    const amp = noise * envelope * (contentH * 0.4);
    topPath += ` L ${px} ${midY - amp}`;
    bottomPath += ` L ${px} ${midY + amp}`;
  }
  topPath += ` L ${x + w - 3} ${midY}`;
  bottomPath += ` L ${x + w - 3} ${midY}`;

  return (
    <g>
      <path d={topPath} fill={hexToRgba(color, 0.2)} stroke={hexToRgba(color, 0.5)} strokeWidth={0.8} />
      <path d={bottomPath} fill={hexToRgba(color, 0.15)} stroke={hexToRgba(color, 0.35)} strokeWidth={0.6} />
    </g>
  );
}

function renderBusContent(
  x: number, y: number, w: number, h: number,
  color: string,
): React.ReactNode {
  const midY = y + h / 2;
  return (
    <line
      x1={x + 4} y1={midY + h * 0.15}
      x2={x + w - 4} y2={midY - h * 0.18}
      stroke={hexToRgba(color, 0.4)}
      strokeWidth={1.5}
      strokeDasharray="4 3"
    />
  );
}

// ── Main Composition ─────────────────────────────────────────────────────────

export const LiveArrange: React.FC<LiveArrangeProps> = (props) => {
  const {
    tracks,
    playheadBeat,
    isPlaying,
    bpm: _bpm,
    beatsPerBar,
    totalBars,
    visibleBars,
    scrollOffsetBars,
    selectedClipId,
    selectedTrackId,
    loopStart,
    loopEnd,
    markers,
  } = props;

  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();

  // Responsive grid dimensions
  const gridW = W - HEADER_W;
  const barW = gridW / visibleBars;
  const totalH = RULER_H + ENERGY_H + tracks.length * TRACK_H;
  const contentTop = RULER_H + ENERGY_H;

  // Convert playhead from beat to bar-space (1-indexed)
  const playheadBar = playheadBeat / beatsPerBar + 1;
  const playheadX = HEADER_W + (playheadBar - 1 - scrollOffsetBars) * barW;

  // Sections / markers
  const sections = markers.length > 0 ? markers : DEFAULT_SECTIONS;

  // Constellation dots
  const dots = useMemo(() => generateConstellationDots(80, W, H), [W, H]);

  // Energy curve
  const energy = useMemo(() => computeEnergy(tracks, totalBars), [tracks, totalBars]);

  // Entrance animation
  const entrance = spring({ frame, fps, config: { damping: 60, stiffness: 30 } });

  // Pulse clock (for selected-glow and active-lane effects)
  const pulse = Math.sin(frame * 0.08) * 0.5 + 0.5;

  // Determine which tracks have clips under the playhead
  const activeLanes = useMemo(() => {
    const set = new Set<string>();
    for (const track of tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        const clipStartBar = clip.startBar;
        const clipEndBar = clip.startBar + clip.lengthBars;
        if (playheadBar >= clipStartBar && playheadBar < clipEndBar) {
          set.add(track.id);
          break;
        }
      }
    }
    return set;
  }, [tracks, playheadBar]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent', overflow: 'hidden' }}>
      <svg width={W} height={Math.max(H, totalH)} style={{ fontFamily: "'Space Mono', monospace" }}>
        <defs>
          {/* Playhead glow filter */}
          <filter id="la-playhead-glow" x="-100%" y="-10%" width="300%" height="120%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Clip selected glow */}
          <filter id="la-clip-glow" x="-10%" y="-20%" width="120%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Aurora gradient for energy curve */}
          <linearGradient id="la-energy-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={A.teal} />
            <stop offset="25%" stopColor={A.cyan} />
            <stop offset="50%" stopColor={A.purple} />
            <stop offset="75%" stopColor={A.pink} />
            <stop offset="100%" stopColor={A.gold} />
          </linearGradient>
          {/* Playhead trail gradient */}
          <linearGradient id="la-played-tint" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={A.cyan} stopOpacity={0} />
            <stop offset="90%" stopColor={A.cyan} stopOpacity={0.03} />
            <stop offset="100%" stopColor={A.cyan} stopOpacity={0.06} />
          </linearGradient>
          {/* Clip prismatic border gradient */}
          <linearGradient id="la-prism" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={A.teal} stopOpacity={0.6} />
            <stop offset="33%" stopColor={A.cyan} stopOpacity={0.4} />
            <stop offset="66%" stopColor={A.purple} stopOpacity={0.5} />
            <stop offset="100%" stopColor={A.pink} stopOpacity={0.4} />
          </linearGradient>
        </defs>

        {/* ── Deep navy background ──────────────────────────────────────── */}
        <rect x={0} y={0} width={W} height={Math.max(H, totalH)} fill={A.bgDeep} />

        {/* ── Constellation dots ─────────────────────────────────────────── */}
        {dots.map((d, i) => {
          const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(frame * 0.04 + d.phase));
          return (
            <circle
              key={`dot-${i}`}
              cx={d.x} cy={d.y} r={d.r}
              fill={A.textMuted}
              opacity={twinkle * 0.2 * entrance}
            />
          );
        })}

        {/* ── Aurora waves (intensity based on energy near playhead) ───── */}
        {(() => {
          const pbIdx = clamp(Math.floor(playheadBar) - 1, 0, energy.length - 1);
          const localEnergy = energy[pbIdx] ?? 0;
          const waveOpacity = 0.03 + localEnergy * 0.06;
          return (
            <g opacity={entrance}>
              <ellipse
                cx={playheadX}
                cy={contentTop + (tracks.length * TRACK_H) / 2}
                rx={200 + localEnergy * 150}
                ry={100 + localEnergy * 80}
                fill={A.teal}
                opacity={waveOpacity + Math.sin(frame * 0.05) * 0.02}
                style={{ filter: 'blur(60px)' }}
              />
              <ellipse
                cx={playheadX + 80}
                cy={contentTop + (tracks.length * TRACK_H) / 3}
                rx={120 + localEnergy * 100}
                ry={80 + localEnergy * 50}
                fill={A.purple}
                opacity={waveOpacity * 0.7 + Math.sin(frame * 0.06 + 1) * 0.015}
                style={{ filter: 'blur(50px)' }}
              />
            </g>
          );
        })()}

        {/* ── Track header panel ──────────────────────────────────────────── */}
        <rect
          x={0} y={RULER_H + ENERGY_H}
          width={HEADER_W}
          height={tracks.length * TRACK_H}
          fill="rgba(8,14,24,0.85)"
          opacity={entrance}
        />
        <line
          x1={HEADER_W} y1={RULER_H}
          x2={HEADER_W} y2={contentTop + tracks.length * TRACK_H}
          stroke={A.glassBorder} strokeWidth={0.5}
        />

        {/* ── Track headers ──────────────────────────────────────────────── */}
        {tracks.map((track, i) => {
          const ty = contentTop + i * TRACK_H;
          const isSelected = track.id === selectedTrackId;
          const isActive = activeLanes.has(track.id) && isPlaying;
          const headerEntrance = spring({
            frame: frame - 3 - i * 2,
            fps,
            config: { damping: 50, stiffness: 50 },
          });

          return (
            <g key={`th-${track.id}`} opacity={headerEntrance}>
              {/* Selected track aurora border */}
              {isSelected && (
                <rect
                  x={1} y={ty + 1}
                  width={HEADER_W - 2} height={TRACK_H - 2}
                  rx={4}
                  fill="none"
                  stroke={hexToRgba(track.color, 0.4 + pulse * 0.2)}
                  strokeWidth={1.2}
                  style={{ filter: 'blur(1px)' }}
                />
              )}
              {/* Color stripe */}
              <rect
                x={2} y={ty + 4}
                width={3} height={TRACK_H - 8}
                rx={1.5}
                fill={track.color}
                opacity={track.muted ? 0.3 : 0.8}
              />
              {/* Track name */}
              <text
                x={12} y={ty + 22}
                fill={track.muted ? A.textMuted : A.text}
                fontSize={9} fontWeight={isSelected ? 'bold' : 'normal'}
              >
                {track.name}
              </text>
              {/* Mute / Solo mini indicators */}
              <text
                x={12} y={ty + 38}
                fill={track.muted ? A.orange : A.textMuted}
                fontSize={7} opacity={track.muted ? 1 : 0.4}
              >
                M
              </text>
              <text
                x={24} y={ty + 38}
                fill={track.soloed ? A.gold : A.textMuted}
                fontSize={7} opacity={track.soloed ? 1 : 0.4}
              >
                S
              </text>
              {/* Active glow pulse on lane */}
              {isActive && (
                <rect
                  x={0} y={ty}
                  width={HEADER_W} height={TRACK_H}
                  fill={hexToRgba(track.color, 0.04 + pulse * 0.03)}
                />
              )}
              {/* Track separator */}
              <line
                x1={0} y1={ty + TRACK_H}
                x2={HEADER_W} y2={ty + TRACK_H}
                stroke={A.glassBorder} strokeWidth={0.3}
              />
            </g>
          );
        })}

        {/* ── Ruler (top bar) ────────────────────────────────────────────── */}
        <rect x={0} y={0} width={W} height={RULER_H} fill="rgba(8,14,24,0.9)" opacity={entrance} />
        <line x1={0} y1={RULER_H} x2={W} y2={RULER_H} stroke={A.glassBorder} strokeWidth={0.5} />

        {/* Bar numbers & beat ticks */}
        {Array.from({ length: Math.ceil(visibleBars) + 1 }, (_, i) => {
          const bar = Math.floor(scrollOffsetBars) + i + 1;
          if (bar < 1 || bar > totalBars) return null;
          const x = HEADER_W + (bar - 1 - scrollOffsetBars) * barW;
          const isPlayheadBar = Math.floor(playheadBar) === bar;
          const barEntrance = spring({
            frame: frame - 2 - i,
            fps,
            config: { damping: 60, stiffness: 40 },
          });

          return (
            <g key={`bar-${bar}`} opacity={barEntrance}>
              {/* Bar number — glows if current */}
              <text
                x={x + barW / 2} y={14}
                textAnchor="middle"
                fill={isPlayheadBar ? A.cyan : A.textMuted}
                fontSize={9}
                fontWeight={isPlayheadBar ? 'bold' : 'normal'}
                style={isPlayheadBar
                  ? { filter: 'drop-shadow(0 0 4px rgba(103,232,249,0.6))' }
                  : undefined}
              >
                {bar}
              </text>
              {/* Beat subdivision ticks */}
              {Array.from({ length: beatsPerBar }, (_, bi) => {
                const tickX = x + (bi / beatsPerBar) * barW;
                return (
                  <line
                    key={`tick-${bar}-${bi}`}
                    x1={tickX} y1={bi === 0 ? 20 : 26}
                    x2={tickX} y2={RULER_H}
                    stroke={bi === 0 ? 'rgba(120,200,220,0.25)' : 'rgba(120,200,220,0.08)'}
                    strokeWidth={bi === 0 ? 0.8 : 0.4}
                  />
                );
              })}
            </g>
          );
        })}

        {/* ── Section markers on ruler ────────────────────────────────────── */}
        {sections.map((section) => {
          const x = HEADER_W + (section.position - 1 - scrollOffsetBars) * barW;
          if (x < HEADER_W - 50 || x > W + 20) return null;
          return (
            <g key={`sec-${section.position}`} opacity={entrance}>
              {/* Glass label */}
              <rect
                x={x} y={2}
                width={50} height={14}
                rx={3}
                fill={hexToRgba(section.color, 0.15)}
                stroke={hexToRgba(section.color, 0.4)}
                strokeWidth={0.5}
              />
              <text
                x={x + 25} y={12}
                textAnchor="middle"
                fill={section.color} fontSize={7} fontWeight="bold"
              >
                {section.label}
              </text>
              {/* Section boundary line through tracks */}
              <rect
                x={x - 0.5} y={contentTop}
                width={1} height={tracks.length * TRACK_H}
                fill={hexToRgba(section.color, 0.1)}
              />
            </g>
          );
        })}

        {/* ── Energy curve ────────────────────────────────────────────────── */}
        {(() => {
          const ey = RULER_H + 2;
          const eh = ENERGY_H - 4;
          let pathD = `M ${HEADER_W} ${ey + eh}`;
          for (let i = 0; i < energy.length; i++) {
            const barIdx = i - scrollOffsetBars;
            if (barIdx < -1 || barIdx > visibleBars + 1) continue;
            const ex = HEADER_W + barIdx * barW + barW / 2;
            const val = energy[i];
            pathD += ` L ${ex} ${ey + eh - val * eh}`;
          }
          pathD += ` L ${W} ${ey + eh} Z`;

          return (
            <g opacity={entrance * 0.6}>
              <rect x={HEADER_W} y={ey} width={gridW} height={eh}
                fill="rgba(8,14,24,0.4)" />
              <path d={pathD} fill="url(#la-energy-grad)" opacity={0.15} />
              {/* Re-draw the line as a stroke on top */}
              <path
                d={pathD.replace(/ Z$/, '')}
                fill="none"
                stroke="url(#la-energy-grad)"
                strokeWidth={1}
                opacity={0.4}
              />
            </g>
          );
        })()}

        {/* ── Grid lines ─────────────────────────────────────────────────── */}
        <g opacity={entrance}>
          {/* Horizontal track separators */}
          {tracks.map((track, i) => {
            const ly = contentTop + i * TRACK_H;
            // Alternating lane tints
            const laneAlpha = i % 2 === 0 ? 0.02 : 0.04;
            return (
              <g key={`lane-${i}`}>
                <rect
                  x={HEADER_W} y={ly}
                  width={gridW} height={TRACK_H}
                  fill={`rgba(120,200,220,${laneAlpha})`}
                />
                {/* Active lane glow */}
                {activeLanes.has(track.id) && isPlaying && (
                  <rect
                    x={HEADER_W} y={ly}
                    width={gridW} height={TRACK_H}
                    fill={hexToRgba(track.color, 0.02 + pulse * 0.02)}
                  />
                )}
                {/* Muted lane dim overlay */}
                {track.muted && (
                  <rect
                    x={HEADER_W} y={ly}
                    width={gridW} height={TRACK_H}
                    fill="rgba(8,14,24,0.4)"
                  />
                )}
                <line
                  x1={HEADER_W} y1={ly + TRACK_H}
                  x2={W} y2={ly + TRACK_H}
                  stroke="rgba(120,200,220,0.06)"
                  strokeWidth={0.5}
                />
              </g>
            );
          })}

          {/* Vertical bar lines — spotlight effect: brighter near playhead */}
          {Array.from({ length: Math.ceil(visibleBars) + 2 }, (_, i) => {
            const bar = Math.floor(scrollOffsetBars) + i;
            const x = HEADER_W + (bar - scrollOffsetBars) * barW;
            if (x < HEADER_W || x > W) return null;

            // Distance from playhead in bars for spotlight
            const distFromPlayhead = Math.abs(bar - (playheadBar - 1));
            const spotlightAlpha = isPlaying
              ? interpolate(distFromPlayhead, [0, 3, 10], [0.2, 0.1, 0.04], {
                  extrapolateRight: 'clamp',
                })
              : 0.06;

            const isSection = sections.some(s => s.position === bar + 1);

            return (
              <line
                key={`vl-${bar}`}
                x1={x} y1={contentTop}
                x2={x} y2={contentTop + tracks.length * TRACK_H}
                stroke={`rgba(120,200,220,${isSection ? spotlightAlpha * 2 : spotlightAlpha})`}
                strokeWidth={0.5}
              />
            );
          })}
        </g>

        {/* ── Played-area tint ───────────────────────────────────────────── */}
        {isPlaying && playheadX > HEADER_W && (
          <rect
            x={HEADER_W} y={contentTop}
            width={Math.max(0, playheadX - HEADER_W)}
            height={tracks.length * TRACK_H}
            fill="url(#la-played-tint)"
            opacity={0.5}
          />
        )}

        {/* ── Loop region ────────────────────────────────────────────────── */}
        {loopStart != null && loopEnd != null && loopEnd > loopStart && (
          (() => {
            const lx = HEADER_W + (loopStart - 1 - scrollOffsetBars) * barW;
            const lw = (loopEnd - loopStart) * barW;
            return (
              <g opacity={entrance}>
                {/* Loop overlay */}
                <rect
                  x={lx} y={contentTop}
                  width={lw} height={tracks.length * TRACK_H}
                  fill={hexToRgba(A.teal, 0.04)}
                />
                {/* Loop bracket start */}
                <line
                  x1={lx} y1={RULER_H}
                  x2={lx} y2={contentTop + tracks.length * TRACK_H}
                  stroke={hexToRgba(A.teal, 0.3)}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                />
                {/* Loop bracket end */}
                <line
                  x1={lx + lw} y1={RULER_H}
                  x2={lx + lw} y2={contentTop + tracks.length * TRACK_H}
                  stroke={hexToRgba(A.teal, 0.3)}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                />
                {/* Glowing bracket markers */}
                <rect
                  x={lx - 1} y={RULER_H - 2}
                  width={3} height={6}
                  rx={1} fill={A.teal}
                  style={{ filter: 'drop-shadow(0 0 3px rgba(45,212,191,0.6))' }}
                />
                <rect
                  x={lx + lw - 1} y={RULER_H - 2}
                  width={3} height={6}
                  rx={1} fill={A.teal}
                  style={{ filter: 'drop-shadow(0 0 3px rgba(45,212,191,0.6))' }}
                />
              </g>
            );
          })()
        )}

        {/* ── Clips ──────────────────────────────────────────────────────── */}
        {tracks.map((track, trackIdx) =>
          track.clips.map((clip, clipIdx) => {
            const clipBarStart = clip.startBar - 1 - scrollOffsetBars;
            const cx = HEADER_W + clipBarStart * barW;
            const cy = contentTop + trackIdx * TRACK_H + 3;
            const cw = clip.lengthBars * barW - 2;
            const ch = TRACK_H - 6;

            // Off-screen culling
            if (cx + cw < HEADER_W || cx > W) return null;

            const isSelected = clip.id === selectedClipId || clip.selected;
            const clipEntrance = spring({
              frame: frame - 8 - trackIdx * 2 - clipIdx,
              fps,
              config: { damping: 40, stiffness: 50, mass: 0.8 },
            });

            // Zoom level — decide detail vs compact
            const showDetail = barW > 25;

            return (
              <g key={clip.id} opacity={clipEntrance}>
                {/* Selected clip outer glow */}
                {isSelected && (
                  <rect
                    x={cx - 2} y={cy - 2}
                    width={cw + 4} height={ch + 4}
                    rx={6}
                    fill="none"
                    stroke={hexToRgba(track.color, 0.5 + pulse * 0.3)}
                    strokeWidth={1.5}
                    filter="url(#la-clip-glow)"
                  />
                )}

                {/* Glass card body */}
                <rect
                  x={cx} y={cy}
                  width={cw} height={ch}
                  rx={4}
                  fill={hexToRgba(track.color, isSelected ? 0.18 : 0.1)}
                  stroke={isSelected
                    ? 'url(#la-prism)'
                    : hexToRgba(track.color, track.muted ? 0.12 : 0.25)}
                  strokeWidth={isSelected ? 1.2 : 0.6}
                />

                {/* Prismatic edge highlight (left edge refraction) */}
                <rect
                  x={cx} y={cy}
                  width={2} height={ch}
                  rx={1}
                  fill={hexToRgba(track.color, 0.4)}
                />
                {/* Right edge subtle refraction */}
                <rect
                  x={cx + cw - 1.5} y={cy}
                  width={1.5} height={ch}
                  rx={0.75}
                  fill={hexToRgba(A.cyan, 0.15)}
                />

                {/* Clip content based on type + zoom */}
                {showDetail ? (
                  track.type === 'midi'
                    ? renderMidiContent(cx, cy, cw, ch, track.color, clipIdx * 17 + clip.startBar, clip)
                    : track.type === 'audio'
                      ? renderAudioContent(cx, cy, cw, ch, track.color, clipIdx * 17 + clip.startBar)
                      : renderBusContent(cx, cy, cw, ch, track.color)
                ) : (
                  /* Zoomed-out compact: just a colored aurora bar */
                  <rect
                    x={cx + 2} y={cy + ch * 0.3}
                    width={cw - 4} height={ch * 0.4}
                    rx={2}
                    fill={hexToRgba(track.color, 0.25)}
                  />
                )}

                {/* Clip name */}
                {showDetail && (
                  <text
                    x={cx + 6} y={cy + 11}
                    fill={hexToRgba(track.color, track.muted ? 0.4 : 0.75)}
                    fontSize={8}
                    fontWeight="500"
                  >
                    {clip.name}
                  </text>
                )}
              </g>
            );
          }),
        )}

        {/* ── Playhead ───────────────────────────────────────────────────── */}
        {playheadX >= HEADER_W && playheadX <= W && (
          <g>
            {/* Fading light trail (behind playhead) */}
            {isPlaying && (
              <rect
                x={Math.max(HEADER_W, playheadX - 30)}
                y={0}
                width={30}
                height={contentTop + tracks.length * TRACK_H}
                fill={hexToRgba(A.cyan, 0.03 + pulse * 0.02)}
                style={{ filter: 'blur(8px)' }}
              />
            )}

            {/* Main playhead line — aurora beam */}
            <line
              x1={playheadX} y1={0}
              x2={playheadX}
              y2={contentTop + tracks.length * TRACK_H}
              stroke={A.cyan}
              strokeWidth={isPlaying ? 2 : 1.5}
              opacity={0.9}
              filter="url(#la-playhead-glow)"
            />

            {/* Diamond marker on ruler */}
            <polygon
              points={`${playheadX},2 ${playheadX + 5},${RULER_H / 2} ${playheadX},${RULER_H - 2} ${playheadX - 5},${RULER_H / 2}`}
              fill={A.cyan}
              opacity={0.85}
              style={{ filter: 'drop-shadow(0 0 4px rgba(103,232,249,0.5))' }}
            />
          </g>
        )}
      </svg>
    </AbsoluteFill>
  );
};
