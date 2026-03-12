import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from 'remotion';
import type { Track, Clip, AutomationLaneType, AutomationPoint } from '../types/daw';

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
  // Drag preview offsets (optional)
  dragOffsetBars?: number;
  dragOffsetTracks?: number;
  dragMode?: string;
  selectedClipIds?: string[];
  showAutomation?: boolean;
  automationMode?: AutomationLaneType;
  expandedAutomationTrackId?: string | null;
  selectedAutomationPoint?: { trackId: string; pointIndex: number } | null;
}

// ── Theme ────────────────────────────────────────────────────────────────────

const A = {
  bg: '#0b0b0c',
  bgDeep: '#060607',
  teal: '#b4bbc4',
  green: '#8dd4b4',
  cyan: '#d8dbe1',
  purple: '#aeb4bd',
  pink: '#c7ccd4',
  gold: '#d6be8a',
  orange: '#c89e76',
  text: '#f1f3f5',
  textDim: '#b0b5bc',
  textMuted: '#6f757d',
  glass: 'rgba(255,255,255,0.035)',
  glassBorder: 'rgba(255,255,255,0.08)',
  glassBright: 'rgba(255,255,255,0.16)',
};

// ── Layout constants ─────────────────────────────────────────────────────────

const HEADER_W = 120;
const RULER_H = 32;
const TRACK_H = 60;
const ENERGY_H = 24;
const AUTOMATION_LANE_H = 14;

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
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

function formatClipBarRange(startBar: number, lengthBars: number): string {
  const endBar = startBar + lengthBars - 1;
  return lengthBars <= 1 ? `Bar ${startBar}` : `Bars ${startBar}-${endBar}`;
}

function getFallbackAutomationValue(track: Track, type: AutomationLaneType): number {
  return type === 'volume'
    ? clamp(track.volume, 0, 1)
    : clamp((track.pan + 1) / 2, 0, 1);
}

function getAutomationPoints(track: Track, totalBars: number, type: AutomationLaneType): AutomationPoint[] {
  const lane = track.automation?.find((candidate) => candidate.type === type && candidate.enabled !== false && candidate.points.length > 0);
  if (lane) {
    return [...lane.points].sort((a, b) => a.bar - b.bar);
  }

  const value = getFallbackAutomationValue(track, type);
  const boundaries = new Set<number>([1, totalBars + 1]);
  track.clips.forEach((clip) => {
    boundaries.add(clip.startBar);
    boundaries.add(clip.startBar + clip.lengthBars);
  });

  return Array.from(boundaries)
    .sort((a, b) => a - b)
    .map((bar) => ({ bar, value }));
}

function getAutomationLaneHeight(showAutomation: boolean, expandedAutomationTrackId: string | null, trackId: string): number {
  if (!showAutomation) return 0;
  return expandedAutomationTrackId === trackId ? 22 : AUTOMATION_LANE_H;
}

// ── Section markers (default if none provided via props.markers) ─────────

const DEFAULT_SECTIONS = [
  { position: 1, label: 'INTRO', color: A.textMuted },
  { position: 9, label: 'VERSE', color: A.textDim },
  { position: 17, label: 'CHORUS', color: A.cyan },
  { position: 25, label: 'BRIDGE', color: A.gold },
];

// ── Constellation background dots (reduced count for perf) ──────────────

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

// ── Energy curve calculation ─────────────────────────────────────────────

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

// ── Clip content renderers ───────────────────────────────────────────────

function renderMidiContent(
  x: number, y: number, w: number, h: number,
  color: string, seed: number, clip: Clip,
): React.ReactNode {
  if (clip.notes && clip.notes.length > 0) {
    const notes = clip.notes;
    const minPitch = Math.min(...notes.map(n => n.pitch));
    const maxPitch = Math.max(...notes.map(n => n.pitch));
    const pitchRange = Math.max(maxPitch - minPitch, 1);
    const totalBeats = clip.lengthBars * 4;
    const contentY = y + 16;
    const contentH = h - 20;

    return (
      <g>
        {Array.from({ length: 4 }, (_, i) => {
          const guideY = contentY + (i / 3) * Math.max(2, contentH - 3);
          return (
            <line
              key={`mg-${i}`}
              x1={x + 4}
              y1={guideY}
              x2={x + w - 4}
              y2={guideY}
              stroke="rgba(255,255,255,0.04)"
              strokeWidth={0.5}
            />
          );
        })}
        {notes.map((note, i) => {
          const nx = x + 3 + ((note.start) / totalBeats) * (w - 6);
          const nw = Math.max(2, (note.duration / totalBeats) * (w - 6));
          const ny = contentY + (1 - (note.pitch - minPitch) / pitchRange) * (contentH - 3);
          const nh = Math.max(1.5, 3);
          return (
            <g key={`mn-${i}`}>
              <rect
                x={nx} y={ny} width={nw} height={nh}
                rx={0.75}
                fill={hexToRgba(color, 0.6 + (note.velocity / 127) * 0.24)}
              />
              <rect
                x={nx}
                y={ny}
                width={Math.max(1, Math.min(2, nw * 0.18))}
                height={nh}
                rx={0.75}
                fill="rgba(255,255,255,0.28)"
              />
            </g>
          );
        })}
      </g>
    );
  }

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

  let topPath = `M ${x + 3} ${midY}`;
  let bottomPath = `M ${x + 3} ${midY}`;
  const topPoints: Array<[number, number]> = [];
  const bottomPoints: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const px = x + 3 + (i / steps) * (w - 6);
    const envelope = Math.sin((i / steps) * Math.PI) * 0.8 + 0.2;
    const noise = rng();
    const amp = noise * envelope * (contentH * 0.4);
    topPoints.push([px, midY - amp]);
    bottomPoints.push([px, midY + amp]);
    topPath += ` L ${px} ${midY - amp}`;
    bottomPath += ` L ${px} ${midY + amp}`;
  }
  topPath += ` L ${x + w - 3} ${midY}`;
  bottomPath += ` L ${x + w - 3} ${midY}`;
  const areaPath = [
    `M ${x + 3} ${midY}`,
    ...topPoints.map(([px, py]) => `L ${px} ${py}`),
    ...bottomPoints.slice().reverse().map(([px, py]) => `L ${px} ${py}`),
    'Z',
  ].join(' ');

  return (
    <g>
      <rect
        x={x + 4}
        y={contentY + 1}
        width={Math.max(0, w - 8)}
        height={Math.max(0, contentH - 2)}
        rx={2}
        fill="rgba(255,255,255,0.015)"
      />
      <line
        x1={x + 4}
        y1={midY}
        x2={x + w - 4}
        y2={midY}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={0.5}
      />
      <path d={areaPath} fill={hexToRgba(color, 0.14)} opacity={0.95} />
      <path d={topPath} fill="none" stroke={hexToRgba(color, 0.62)} strokeWidth={0.9} />
      <path d={bottomPath} fill="none" stroke={hexToRgba(color, 0.32)} strokeWidth={0.6} />
    </g>
  );
}

function renderBusContent(
  x: number, y: number, w: number, h: number,
  color: string,
): React.ReactNode {
  const midY = y + h / 2;
  return (
    <g>
      <line
        x1={x + 4} y1={midY + h * 0.15}
        x2={x + w - 4} y2={midY - h * 0.18}
        stroke={hexToRgba(color, 0.4)}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <line
        x1={x + 4} y1={midY - h * 0.12}
        x2={x + w - 4} y2={midY + h * 0.1}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={0.8}
        strokeDasharray="3 4"
      />
    </g>
  );
}

// ── Memoized background layer ───────────────────────────────────────────

const Background = React.memo<{ W: number; H: number; totalH: number; entrance: number }>(
  ({ W, H, totalH, entrance }) => {
    const dots = useMemo(() => generateConstellationDots(40, W, H), [W, H]);
    const frame = useCurrentFrame();
    return (
      <>
        <rect x={0} y={0} width={W} height={Math.max(H, totalH)} fill={A.bgDeep} />
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
      </>
    );
  },
);

// ── Memoized ruler ──────────────────────────────────────────────────────

const Ruler = React.memo<{
  W: number; visibleBars: number; scrollOffsetBars: number;
  beatsPerBar: number; totalBars: number; playheadBar: number;
  entrance: number; sections: Array<{ position: number; label: string; color: string }>;
}>(({ W, visibleBars, scrollOffsetBars, beatsPerBar, totalBars, playheadBar, entrance, sections }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const gridW = W - HEADER_W;
  const barW = gridW / visibleBars;

  return (
    <g>
      <rect x={0} y={0} width={W} height={RULER_H} fill="rgba(7,7,8,0.94)" opacity={entrance} />
      <line x1={0} y1={RULER_H} x2={W} y2={RULER_H} stroke={A.glassBorder} strokeWidth={0.5} />
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
            <text
              x={x + barW / 2} y={14}
              textAnchor="middle"
              fill={isPlayheadBar ? A.text : A.textMuted}
              fontSize={9}
              fontWeight={isPlayheadBar ? 'bold' : 'normal'}
            >
              {bar}
            </text>
            {Array.from({ length: beatsPerBar }, (_, bi) => {
              const tickX = x + (bi / beatsPerBar) * barW;
              return (
                <line
                  key={`tick-${bar}-${bi}`}
                  x1={tickX} y1={bi === 0 ? 20 : 26}
                  x2={tickX} y2={RULER_H}
                  stroke={bi === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)'}
                  strokeWidth={bi === 0 ? 0.8 : 0.4}
                />
              );
            })}
          </g>
        );
      })}
      {sections.map((section) => {
        const x = HEADER_W + (section.position - 1 - scrollOffsetBars) * barW;
        if (x < HEADER_W - 50 || x > W + 20) return null;
        return (
          <g key={`sec-${section.position}`} opacity={entrance}>
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
          </g>
        );
      })}
    </g>
  );
});

// ── Memoized grid lines ─────────────────────────────────────────────────

const GridLines = React.memo<{
  W: number; tracks: Track[]; visibleBars: number; scrollOffsetBars: number;
  contentTop: number; isPlaying: boolean; playheadBar: number; entrance: number;
  activeLanes: Set<string>; pulse: number;
  sections: Array<{ position: number; label: string; color: string }>;
}>(({ W, tracks, visibleBars, scrollOffsetBars, contentTop, isPlaying, playheadBar, entrance, activeLanes, pulse, sections }) => {
  const gridW = W - HEADER_W;
  const barW = gridW / visibleBars;

  return (
    <g opacity={entrance}>
      {tracks.map((track, i) => {
        const ly = contentTop + i * TRACK_H;
        const laneAlpha = i % 2 === 0 ? 0.02 : 0.04;
        return (
          <g key={`lane-${i}`}>
            <rect
              x={HEADER_W} y={ly}
              width={gridW} height={TRACK_H}
              fill={`rgba(255,255,255,${laneAlpha})`}
            />
            {activeLanes.has(track.id) && isPlaying && (
              <rect
                x={HEADER_W} y={ly}
                width={gridW} height={TRACK_H}
                fill={hexToRgba(track.color, 0.02 + pulse * 0.02)}
              />
            )}
            {track.muted && (
              <rect
                x={HEADER_W} y={ly}
                width={gridW} height={TRACK_H}
                fill="rgba(0,0,0,0.28)"
              />
            )}
            <line
              x1={HEADER_W} y1={ly + TRACK_H}
              x2={W} y2={ly + TRACK_H}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={0.5}
            />
          </g>
        );
      })}
      {Array.from({ length: Math.ceil(visibleBars) + 2 }, (_, i) => {
        const bar = Math.floor(scrollOffsetBars) + i;
        const x = HEADER_W + (bar - scrollOffsetBars) * barW;
        if (x < HEADER_W || x > W) return null;
        const distFromPlayhead = Math.abs(bar - (playheadBar - 1));
        const spotlightAlpha = isPlaying
          ? interpolate(distFromPlayhead, [0, 3, 10], [0.2, 0.1, 0.04], { extrapolateRight: 'clamp' })
          : 0.06;
        const isSection = sections.some(s => s.position === bar + 1);
        return (
          <line
            key={`vl-${bar}`}
            x1={x} y1={contentTop}
            x2={x} y2={contentTop + tracks.length * TRACK_H}
            stroke={`rgba(255,255,255,${isSection ? spotlightAlpha * 1.5 : spotlightAlpha})`}
            strokeWidth={0.5}
          />
        );
      })}
    </g>
  );
});

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
    dragOffsetBars = 0,
    dragOffsetTracks = 0,
    dragMode = 'idle',
    selectedClipIds = [],
    showAutomation = false,
    automationMode = 'volume',
    expandedAutomationTrackId = null,
    selectedAutomationPoint = null,
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

  // Energy curve (memoized)
  const energy = useMemo(() => computeEnergy(tracks, totalBars), [tracks, totalBars]);

  // Entrance animation
  const entrance = spring({ frame, fps, config: { damping: 60, stiffness: 30 } });

  // Pulse clock
  const pulse = Math.sin(frame * 0.08) * 0.5 + 0.5;

  // Active lanes (memoized)
  const activeLanes = useMemo(() => {
    const set = new Set<string>();
    for (const track of tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (playheadBar >= clip.startBar && playheadBar < clip.startBar + clip.lengthBars) {
          set.add(track.id);
          break;
        }
      }
    }
    return set;
  }, [tracks, playheadBar]);

  // Selected clip ID set for fast lookup
  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);
  const isDragging = dragMode === 'moving' || dragMode === 'resizing' || dragMode === 'duplicating';
  const automationLanes = useMemo(() => {
    if (!showAutomation) return [];

    return tracks.map((track, trackIdx) => {
      const laneHeight = getAutomationLaneHeight(showAutomation, expandedAutomationTrackId, track.id);
      const laneY = contentTop + trackIdx * TRACK_H + TRACK_H - laneHeight - 3;
      const points = getAutomationPoints(track, totalBars, automationMode);
      const path = points
        .map((point, pointIdx) => {
          const px = HEADER_W + (point.bar - 1 - scrollOffsetBars) * barW;
          const normalizedValue = clamp(point.value, 0, 1);
          const py = laneY + (1 - normalizedValue) * (laneHeight - 4) + 2;
          return `${pointIdx === 0 ? 'M' : 'L'} ${px} ${py}`;
        })
        .join(' ');

      const label = automationMode === 'volume'
        ? `${Math.round(track.volume * 100)}%`
        : track.pan === 0
          ? 'C'
          : track.pan < 0
            ? `L${Math.round(Math.abs(track.pan) * 100)}`
            : `R${Math.round(track.pan * 100)}`;

      return { track, trackIdx, laneY, laneHeight, points, path, label };
    });
  }, [showAutomation, tracks, contentTop, totalBars, automationMode, scrollOffsetBars, barW, expandedAutomationTrackId]);

  // Pre-compute clip layout positions (memoized)
  const clipLayouts = useMemo(() => {
    const layouts: Array<{
      clip: Clip;
      track: Track;
      trackIdx: number;
      cx: number;
      cy: number;
      cw: number;
      ch: number;
      isSelected: boolean;
      isGhost: boolean; // for duplicate drag preview
    }> = [];

    tracks.forEach((track, trackIdx) => {
      track.clips.forEach((clip) => {
        const isSelected = selectedSet.has(clip.id) || clip.id === selectedClipId || clip.selected === true;

        // Apply drag offset for selected clips
        let effectiveStartBar = clip.startBar;
        let effectiveTrackIdx = trackIdx;
        let effectiveLengthBars = clip.lengthBars;
        let isGhost = false;

        if (isSelected && isDragging && dragOffsetBars !== 0 || (isSelected && isDragging && dragOffsetTracks !== 0)) {
          if (dragMode === 'moving') {
            effectiveStartBar = Math.max(1, clip.startBar + dragOffsetBars);
            effectiveTrackIdx = Math.max(0, Math.min(tracks.length - 1, trackIdx + dragOffsetTracks));
          } else if (dragMode === 'resizing') {
            effectiveLengthBars = Math.max(1, clip.lengthBars + dragOffsetBars);
          } else if (dragMode === 'duplicating') {
            // Show ghost at new position, keep original in place
            layouts.push({
              clip,
              track,
              trackIdx,
              cx: HEADER_W + (clip.startBar - 1 - scrollOffsetBars) * barW,
              cy: contentTop + trackIdx * TRACK_H + (showAutomation ? 4 : 3),
              cw: clip.lengthBars * barW - 2,
              ch: TRACK_H - (getAutomationLaneHeight(showAutomation, expandedAutomationTrackId, track.id) + (showAutomation ? 8 : 6)),
              isSelected: false,
              isGhost: false,
            });
            // Ghost duplicate
            effectiveStartBar = Math.max(1, clip.startBar + dragOffsetBars);
            effectiveTrackIdx = Math.max(0, Math.min(tracks.length - 1, trackIdx + dragOffsetTracks));
            isGhost = true;
          }
        }

        const clipBarStart = effectiveStartBar - 1 - scrollOffsetBars;
        const cx = HEADER_W + clipBarStart * barW;
        const cy = contentTop + effectiveTrackIdx * TRACK_H + (showAutomation ? 4 : 3);
        const cw = effectiveLengthBars * barW - 2;
        const ch = TRACK_H - (getAutomationLaneHeight(showAutomation, expandedAutomationTrackId, track.id) + (showAutomation ? 8 : 6));

        // Off-screen culling
        if (cx + cw >= HEADER_W && cx <= W) {
          layouts.push({
            clip,
            track,
            trackIdx: effectiveTrackIdx,
            cx, cy, cw, ch,
            isSelected: isSelected && !isGhost,
            isGhost,
          });
        }
      });
    });
    return layouts;
  }, [tracks, selectedSet, selectedClipId, isDragging, dragOffsetBars, dragOffsetTracks, dragMode, scrollOffsetBars, barW, contentTop, W, showAutomation, expandedAutomationTrackId]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent', overflow: 'hidden' }}>
      <svg width={W} height={Math.max(H, totalH)} style={{ fontFamily: "'Space Mono', monospace" }}>
        <defs>
          <filter id="la-playhead-glow" x="-100%" y="-10%" width="300%" height="120%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="la-clip-glow" x="-10%" y="-20%" width="120%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="la-energy-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#737a82" />
            <stop offset="50%" stopColor="#bcc3cb" />
            <stop offset="100%" stopColor="#f1f3f5" />
          </linearGradient>
          <linearGradient id="la-played-tint" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={A.cyan} stopOpacity={0} />
            <stop offset="90%" stopColor={A.cyan} stopOpacity={0.02} />
            <stop offset="100%" stopColor={A.cyan} stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="la-prism" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#d9dde3" stopOpacity={0.8} />
            <stop offset="100%" stopColor="#7f8790" stopOpacity={0.5} />
          </linearGradient>
        </defs>

        {/* ── Background + constellation dots ─────────────────────────────── */}
        <Background W={W} H={H} totalH={totalH} entrance={entrance} />

        {/* ── Aurora waves ────────────────────────────────────────────────── */}
        {(() => {
          const pbIdx = clamp(Math.floor(playheadBar) - 1, 0, energy.length - 1);
          const localEnergy = energy[pbIdx] ?? 0;
          const waveOpacity = 0.03 + localEnergy * 0.06;
          return (
            <g opacity={entrance}>
              <ellipse
                cx={playheadX}
                cy={contentTop + (tracks.length * TRACK_H) / 2}
                rx={180 + localEnergy * 120}
                ry={90 + localEnergy * 60}
                fill="#c8cdd4"
                opacity={waveOpacity * 0.45 + Math.sin(frame * 0.05) * 0.01}
                style={{ filter: 'blur(70px)' }}
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
              <rect
                x={2} y={ty + 4}
                width={3} height={TRACK_H - 8}
                rx={1.5}
                fill={track.color}
                opacity={track.muted ? 0.3 : 0.8}
              />
              <text
                x={12} y={ty + 22}
                fill={track.muted ? A.textMuted : A.text}
                fontSize={9} fontWeight={isSelected ? 'bold' : 'normal'}
              >
                {track.name}
              </text>
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
              {isActive && (
                <rect
                  x={0} y={ty}
                  width={HEADER_W} height={TRACK_H}
                  fill={hexToRgba(track.color, 0.04 + pulse * 0.03)}
                />
              )}
              <line
                x1={0} y1={ty + TRACK_H}
                x2={HEADER_W} y2={ty + TRACK_H}
                stroke={A.glassBorder} strokeWidth={0.3}
              />
            </g>
          );
        })}

        {/* ── Ruler ──────────────────────────────────────────────────────── */}
        <Ruler
          W={W}
          visibleBars={visibleBars}
          scrollOffsetBars={scrollOffsetBars}
          beatsPerBar={beatsPerBar}
          totalBars={totalBars}
          playheadBar={playheadBar}
          entrance={entrance}
          sections={sections}
        />

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
        <GridLines
          W={W}
          tracks={tracks}
          visibleBars={visibleBars}
          scrollOffsetBars={scrollOffsetBars}
          contentTop={contentTop}
          isPlaying={isPlaying}
          playheadBar={playheadBar}
          entrance={entrance}
          activeLanes={activeLanes}
          pulse={pulse}
          sections={sections}
        />

        {/* ── Automation read lanes ─────────────────────────────────────── */}
        {showAutomation && automationLanes.map(({ track, trackIdx, laneY, laneHeight, points, path, label }) => {
          const isSelectedTrack = track.id === selectedTrackId;
          const isExpanded = expandedAutomationTrackId === track.id;
          const laneOpacity = isSelectedTrack ? 0.9 : 0.66;
          const stroke = isSelectedTrack ? A.text : A.textDim;
          const fill = hexToRgba(track.color, isSelectedTrack ? 0.06 : 0.03);
          return (
            <g key={`auto-${track.id}`} opacity={entrance * laneOpacity}>
              <rect
                x={HEADER_W + 1}
                y={laneY}
                width={gridW - 2}
                height={laneHeight}
                rx={3}
                fill={fill}
                stroke={isExpanded ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'}
                strokeWidth={isExpanded ? 0.7 : 0.5}
              />
              <text
                x={HEADER_W + 8}
                y={laneY + 9}
                fill={A.textMuted}
                fontSize={6}
                fontWeight="700"
                letterSpacing="0.08em"
                textAnchor="start"
              >
                {automationMode === 'volume' ? 'VOL' : 'PAN'}
              </text>
              <text
                x={HEADER_W + gridW - 8}
                y={laneY + 9}
                fill={isSelectedTrack ? A.textDim : A.textMuted}
                fontSize={6}
                fontWeight="700"
                textAnchor="end"
              >
                {label}
              </text>
              <path
                d={path}
                fill="none"
                stroke={stroke}
                strokeWidth={1.1}
                opacity={0.8}
              />
              {points.map((point, pointIdx) => {
                const px = HEADER_W + (point.bar - 1 - scrollOffsetBars) * barW;
                if (px < HEADER_W - 4 || px > W + 4) return null;
                const normalizedValue = clamp(point.value, 0, 1);
                const py = laneY + (1 - normalizedValue) * (laneHeight - 4) + 2;
                const isSelectedPoint = selectedAutomationPoint?.trackId === track.id && selectedAutomationPoint.pointIndex === pointIdx;
                return (
                  <g key={`auto-pt-${track.id}-${pointIdx}`}>
                    {isSelectedPoint && (
                      <circle
                        cx={px}
                        cy={py}
                        r={5}
                        fill="rgba(255,255,255,0.06)"
                        stroke="rgba(255,255,255,0.18)"
                        strokeWidth={0.7}
                      />
                    )}
                    <circle
                      cx={px}
                      cy={py}
                      r={isSelectedPoint ? 2.8 : (isSelectedTrack ? 1.8 : 1.4)}
                      fill={isSelectedPoint ? A.text : stroke}
                      opacity={0.92}
                    />
                  </g>
                );
              })}
              <line
                x1={HEADER_W + 1}
                y1={laneY + laneHeight / 2}
                x2={HEADER_W + gridW - 1}
                y2={laneY + laneHeight / 2}
                stroke="rgba(255,255,255,0.035)"
                strokeWidth={0.5}
                strokeDasharray="2 3"
              />
              {trackIdx < tracks.length - 1 && (
                <line
                  x1={HEADER_W}
                  y1={laneY + laneHeight + 3}
                  x2={W}
                  y2={laneY + laneHeight + 3}
                  stroke="rgba(255,255,255,0.035)"
                  strokeWidth={0.4}
                />
              )}
            </g>
          );
        })}

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
                <rect
                  x={lx} y={contentTop}
                  width={lw} height={tracks.length * TRACK_H}
                  fill={hexToRgba(A.teal, 0.04)}
                />
                <line
                  x1={lx} y1={RULER_H}
                  x2={lx} y2={contentTop + tracks.length * TRACK_H}
                  stroke={hexToRgba(A.teal, 0.3)}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                />
                <line
                  x1={lx + lw} y1={RULER_H}
                  x2={lx + lw} y2={contentTop + tracks.length * TRACK_H}
                  stroke={hexToRgba(A.teal, 0.3)}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                />
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

        {/* ── Clips (using pre-computed layout) ──────────────────────────── */}
        {clipLayouts.map((layout) => {
          const { clip, track, cx, cy, cw, ch, isSelected, isGhost } = layout;
          const clipEntrance = spring({
            frame: frame - 8 - layout.trackIdx * 2,
            fps,
            config: { damping: 40, stiffness: 50, mass: 0.8 },
          });

          const showDetail = barW > 25;
          const ghostOpacity = isGhost ? 0.5 : 1;
          const showMeta = cw > 96;
          const typeLabel = track.type === 'midi' ? 'MIDI' : track.type === 'audio' ? 'AUDIO' : 'BUS';
          const rangeLabel = formatClipBarRange(clip.startBar, clip.lengthBars);
          const secondaryLabel = track.type === 'midi'
            ? `${clip.notes?.length ?? 0} notes`
            : track.type === 'audio'
              ? 'Audio region'
              : 'Signal route';

          return (
            <g key={isGhost ? `ghost-${clip.id}` : clip.id} opacity={clipEntrance * ghostOpacity}>
              {/* Selected clip outer glow */}
              {isSelected && (
                <rect
                  x={cx - 2} y={cy - 2}
                  width={cw + 4} height={ch + 4}
                  rx={6}
                  fill="none"
                  stroke={hexToRgba(A.cyan, 0.55 + pulse * 0.12)}
                  strokeWidth={1.2}
                />
              )}

              {/* Ghost duplicate dashed outline */}
              {isGhost && (
                <rect
                  x={cx} y={cy}
                  width={cw} height={ch}
                  rx={4}
                  fill="none"
                  stroke={hexToRgba(A.textDim, 0.55)}
                  strokeWidth={1}
                  strokeDasharray="4 2"
                />
              )}

              {/* Glass card body */}
              <rect
                x={cx} y={cy}
                width={cw} height={ch}
                rx={4}
                fill={isSelected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.045)'}
                stroke={isSelected
                  ? 'url(#la-prism)'
                  : (track.muted ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.09)')}
                strokeWidth={isSelected ? 1.1 : 0.8}
              />
              <rect
                x={cx + 1}
                y={cy + 1}
                width={Math.max(0, cw - 2)}
                height={11}
                rx={3}
                fill={isSelected ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)'}
              />

              {/* Left edge refraction */}
              <rect
                x={cx} y={cy}
                width={2} height={ch}
                rx={1}
                fill={hexToRgba(track.color, 0.7)}
              />
              {/* Right edge — resize handle indicator for selected clips */}
              <rect
                x={cx + cw - 1.5} y={cy}
                width={1.5} height={ch}
                rx={0.75}
                fill={isSelected ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)'}
              />

              {/* Clip content */}
              {showDetail ? (
                track.type === 'midi'
                  ? renderMidiContent(cx, cy, cw, ch, track.color, clip.startBar * 17, clip)
                  : track.type === 'audio'
                    ? renderAudioContent(cx, cy, cw, ch, track.color, clip.startBar * 17)
                    : renderBusContent(cx, cy, cw, ch, track.color)
              ) : (
                <rect
                  x={cx + 2} y={cy + ch * 0.3}
                  width={cw - 4} height={ch * 0.4}
                  rx={2}
                  fill={hexToRgba(track.color, 0.25)}
                />
              )}

              {/* Clip name */}
              {showDetail && (
                <>
                  <text
                    x={cx + 6} y={cy + 11}
                    fill={track.muted ? A.textMuted : A.text}
                    fontSize={8}
                    fontWeight="600"
                  >
                    {clip.name}
                  </text>
                  {showMeta && (
                    <text
                      x={cx + 6} y={cy + 21}
                      fill={A.textMuted}
                      fontSize={6.5}
                      fontWeight="500"
                    >
                      {secondaryLabel} • {rangeLabel}
                    </text>
                  )}
                  {cw > 70 && (
                    <>
                      <rect
                        x={cx + cw - 34}
                        y={cy + 4}
                        width={28}
                        height={8}
                        rx={4}
                        fill="rgba(0,0,0,0.22)"
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth={0.5}
                      />
                      <text
                        x={cx + cw - 20}
                        y={cy + 10}
                        fill={isSelected ? A.text : A.textDim}
                        fontSize={5.8}
                        fontWeight="700"
                        letterSpacing="0.08em"
                        textAnchor="middle"
                      >
                        {typeLabel}
                      </text>
                    </>
                  )}
                  {cw > 120 && (
                    <text
                      x={cx + 6}
                      y={cy + ch - 5}
                      fill="rgba(255,255,255,0.42)"
                      fontSize={6}
                      fontWeight="600"
                    >
                      {track.type === 'midi'
                        ? `${track.name} lane`
                        : track.type === 'audio'
                          ? 'Waveform preview'
                          : 'Routing region'}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}

        {/* ── Playhead ───────────────────────────────────────────────────── */}
        {playheadX >= HEADER_W && playheadX <= W && (
          <g>
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

            <line
              x1={playheadX} y1={0}
              x2={playheadX}
              y2={contentTop + tracks.length * TRACK_H}
              stroke={A.cyan}
              strokeWidth={isPlaying ? 2 : 1.5}
              opacity={0.9}
              filter="url(#la-playhead-glow)"
            />

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
