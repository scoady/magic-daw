import React, { useMemo, useCallback } from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';
import {
  pitchClassAt, triangleChord, adjacentTriangles, diatonicTriangles,
  diatonicPitchClasses, triKey, triEquals, getSharedEdgeOp, computeVoiceLeading,
  noteName,
} from '../lib/tonnetz';
import type { TonnetzTriangle, PathStep, PLROp } from '../lib/tonnetz';
import {
  axialToPixel, triangleSVGPath, triangleCentroid, sharedEdgeMidpoint,
  enumerateNodes, enumerateTriangles, gridDistance,
  GRID_Q_MIN, GRID_Q_MAX, GRID_R_MIN, GRID_R_MAX, HEX_SIZE,
} from '../lib/tonnetzLayout';
import { TonnetzLessonOverlay } from './TonnetzLessonOverlay';
import type { LessonStep } from '../lib/tonnetzLessons';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TonnetzProps {
  activeKey: string;
  activeMode: 'major' | 'minor';
  activeNotes: number[];
  path: PathStep[];
  hoveredTriangle: TonnetzTriangle | null;
  selectedTriangle: TonnetzTriangle | null;
  playbackIndex: number;
  /** Callback: user clicked a triangle */
  onClickTriangle?: (tri: TonnetzTriangle) => void;
  onHoverTriangle?: (tri: TonnetzTriangle | null) => void;
  /** Frame when the last chord was added to the path */
  lastAddedFrame?: number;
  /** Frame when the last MIDI chord was detected */
  chordDetectedFrame?: number;
  // ── Lesson overlay props ────────────────────────────────────────────────
  lessonStep?: LessonStep | null;
  lessonStepIndex?: number;
  lessonStepStartFrame?: number;
  lessonTotalSteps?: number;
  lessonAccentColor?: string;
  lessonTitle?: string;
  lessonActive?: boolean;
  lessonPrevHighlights?: TonnetzTriangle[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const NOTE_COLORS: string[] = [
  '#67e8f9', '#818cf8', '#a78bfa', '#c084fc',
  '#f472b6', '#fb7185', '#fbbf24', '#f59e0b',
  '#34d399', '#2dd4bf', '#22d3ee', '#38bdf8',
];

const NOTE_COLORS_DIM: string[] = [
  '#0d2933', '#131740', '#1a1438', '#1f1238',
  '#2b1224', '#2b1218', '#2b2108', '#2b1d06',
  '#062b1c', '#062b24', '#061e2b', '#06182b',
];

const CHROMATIC_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const NODE_R = 14; // base node circle radius
const NODE_R_ACTIVE = 20;
const NODE_R_DIATONIC = 16;

function sr(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function hex2rgba(hex: string, a: number): string {
  return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
}

/** Get root pitch class from key name */
function keyToPC(key: string): number {
  return CHROMATIC_NAMES.indexOf(key);
}

/** Find the grid position (q,r) nearest center where pitchClassAt = target */
function findRootPos(targetPC: number): { q: number; r: number } {
  let best = { q: 0, r: 0 };
  let bestDist = Infinity;
  for (let q = GRID_Q_MIN; q <= GRID_Q_MAX; q++) {
    for (let r = GRID_R_MIN; r <= GRID_R_MAX; r++) {
      if (pitchClassAt(q, r) === targetPC) {
        const dist = Math.abs(q - 2) + Math.abs(r); // bias toward center-right
        if (dist < bestDist) { bestDist = dist; best = { q, r }; }
      }
    }
  }
  return best;
}

// ── Composition ────────────────────────────────────────────────────────────

export const TonnetzComposition: React.FC<TonnetzProps> = ({
  activeKey,
  activeNotes,
  path,
  hoveredTriangle,
  selectedTriangle,
  playbackIndex,
  onClickTriangle,
  onHoverTriangle,
  lastAddedFrame = -999,
  chordDetectedFrame = -999,
  lessonStep = null,
  lessonStepIndex = 0,
  lessonStepStartFrame = 0,
  lessonTotalSteps = 0,
  lessonAccentColor = '#67e8f9',
  lessonTitle = '',
  lessonActive = false,
  lessonPrevHighlights = [],
}) => {
  const frame = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();

  // ── Compute grid bounds at origin, then scale to fit viewport ──────────
  // Layout at cx=0, cy=0 — we'll transform to fit
  const cx = 0;
  const cy = 0;

  // Padding for top bar (key selector ~70px) and bottom bar (controls ~50px)
  const PAD_TOP = 70;
  const PAD_BOTTOM = 50;
  const PAD_X = 20;

  // Compute raw grid extents
  const gridMetrics = useMemo(() => {
    // Horizontal: q ranges from GRID_Q_MIN to GRID_Q_MAX, with r offset
    const xMin = HEX_SIZE * (GRID_Q_MIN + GRID_R_MAX * 0.5);
    const xMax = HEX_SIZE * (GRID_Q_MAX + GRID_R_MIN * 0.5);
    // Vertical: r ranges, with sqrt(3)/2 factor, negated for SVG
    const yMin = -HEX_SIZE * (GRID_R_MAX * Math.sqrt(3) / 2);
    const yMax = -HEX_SIZE * (GRID_R_MIN * Math.sqrt(3) / 2);
    const rawW = xMax - xMin;
    const rawH = yMax - yMin;
    const rawCx = (xMin + xMax) / 2;
    const rawCy = (yMin + yMax) / 2;
    return { rawW, rawH, rawCx, rawCy };
  }, []);

  // Scale to fit available viewport (between top bar and bottom controls)
  const { scale, tx, ty } = useMemo(() => {
    const availW = W - PAD_X * 2;
    const availH = H - PAD_TOP - PAD_BOTTOM;
    const sx = availW / gridMetrics.rawW;
    const sy = availH / gridMetrics.rawH;
    const s = Math.min(sx, sy, 1.2); // cap so it doesn't get absurdly large on huge screens
    // Center the scaled grid in the available area
    const centerX = W / 2;
    const centerY = PAD_TOP + (H - PAD_TOP - PAD_BOTTOM) / 2;
    return {
      scale: s,
      tx: centerX - gridMetrics.rawCx * s,
      ty: centerY - gridMetrics.rawCy * s,
    };
  }, [W, H, gridMetrics]);

  // Active pitch classes from MIDI
  const activePCs = useMemo(() => {
    const s = new Set<number>();
    activeNotes.forEach(n => s.add(n % 12));
    return s;
  }, [activeNotes]);

  // Key info
  const rootPC = keyToPC(activeKey);
  const rootPos = useMemo(() => findRootPos(rootPC), [rootPC]);
  const diatonicTris = useMemo(() => diatonicTriangles(rootPos.q, rootPos.r), [rootPos]);
  const diatonicPCs = useMemo(() => diatonicPitchClasses(rootPos.q, rootPos.r), [rootPos]);
  const diatonicTriKeys = useMemo(() => new Set(diatonicTris.map(triKey)), [diatonicTris]);

  // Path triangle keys for quick lookup
  const pathTriKeys = useMemo(() => new Set(path.map(s => triKey(s.triangle))), [path]);

  // Adjacent triangles to selected
  const adjacents = useMemo(() => {
    if (!selectedTriangle) return [];
    return adjacentTriangles(selectedTriangle);
  }, [selectedTriangle]);
  const adjacentKeys = useMemo(() => new Set(adjacents.map(a => triKey(a.tri))), [adjacents]);

  // Pre-compute grid
  const nodes = useMemo(() => enumerateNodes(cx, cy), [cx, cy]);
  const triangles = useMemo(() => enumerateTriangles(cx, cy), [cx, cy]);

  // Camera shake on chord add
  const timeSinceAdd = frame - lastAddedFrame;
  const shakeI = timeSinceAdd >= 0 && timeSinceAdd < 15
    ? interpolate(spring({ frame: timeSinceAdd, fps, config: { damping: 8, stiffness: 200, mass: 0.4 } }), [0, 1], [4, 0])
    : 0;
  const shakeX = shakeI * Math.sin(frame * 1.7);
  const shakeY = shakeI * Math.cos(frame * 2.3);

  // Shockwave on MIDI chord detect
  const timeSinceChord = frame - chordDetectedFrame;

  // Active triangle centroid (for focus falloff)
  const focusCenter = useMemo(() => {
    const tri = selectedTriangle || (path.length > 0 ? path[path.length - 1].triangle : null);
    if (!tri) return { q: rootPos.q, r: rootPos.r };
    const verts = [{ q: tri.q, r: tri.r }];
    return verts[0];
  }, [selectedTriangle, path, rootPos]);

  // Reverse the scale/translate transform to get grid-space coords from screen
  const screenToGrid = useCallback((e: React.MouseEvent<SVGElement>) => {
    const svg = e.currentTarget.closest('svg');
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    // Reverse: gridX = (svgX - tx - shakeX*scale) / scale
    const gx = (svgPt.x - tx) / scale - shakeX;
    const gy = (svgPt.y - ty) / scale - shakeY;
    return { x: gx, y: gy };
  }, [tx, ty, scale, shakeX, shakeY]);

  // Click handler
  const handleTriClick = useCallback((e: React.MouseEvent<SVGElement>) => {
    if (!onClickTriangle) return;
    const g = screenToGrid(e);
    if (!g) return;
    let best: TonnetzTriangle | null = null;
    let bestDist = Infinity;
    for (const t of triangles) {
      const dx = g.x - t.centroid.x;
      const dy = g.y - t.centroid.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = t.tri; }
    }
    if (best && bestDist < HEX_SIZE * HEX_SIZE) {
      onClickTriangle(best);
    }
  }, [onClickTriangle, triangles, screenToGrid]);

  // Hover handler
  const handleTriHover = useCallback((e: React.MouseEvent<SVGElement>) => {
    if (!onHoverTriangle) return;
    const g = screenToGrid(e);
    if (!g) return;
    let best: TonnetzTriangle | null = null;
    let bestDist = Infinity;
    for (const t of triangles) {
      const dx = g.x - t.centroid.x;
      const dy = g.y - t.centroid.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = t.tri; }
    }
    if (best && bestDist < HEX_SIZE * HEX_SIZE) {
      onHoverTriangle(best);
    } else {
      onHoverTriangle(null);
    }
  }, [onHoverTriangle, triangles, screenToGrid]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        onClick={handleTriClick}
        onMouseMove={handleTriHover}
        onMouseLeave={() => onHoverTriangle?.(null)}
        style={{ cursor: 'crosshair' }}>
        <defs>
          <filter id="tn-bloom-heavy" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="b1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b2" />
            <feMerge><feMergeNode in="b1" /><feMergeNode in="b2" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="tn-bloom-med" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b2" />
            <feMerge><feMergeNode in="b1" /><feMergeNode in="b2" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="tn-bloom-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>

          {/* Hatching pattern for minor triads */}
          <pattern id="tn-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(226,232,240,0.12)" strokeWidth="1" />
          </pattern>
        </defs>

        {/* ══════ LAYER 0: BACKGROUND ATMOSPHERE (screen space) ══════ */}
        {useMemo(() => Array.from({ length: 60 }, (_, i) => {
          const sx = sr(i * 3.7) * W;
          const sy = sr(i * 7.3) * H;
          const rad = 0.3 + sr(i * 11.1) * 0.5;
          const twinkleFrame = (frame + Math.floor(sr(i * 17) * 100)) % 120;
          const twinkle = 0.05 + 0.08 * spring({ frame: twinkleFrame, fps, config: { damping: 20, stiffness: 30, mass: 2 } });
          return <circle key={`s-${i}`} cx={sx} cy={sy} r={rad} fill="#c8d6e5" opacity={twinkle} />;
        }), [W, H, frame, fps])}

        <g transform={`translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) scale(${scale.toFixed(4)})`}>
        <g transform={`translate(${shakeX.toFixed(2)}, ${shakeY.toFixed(2)})`}>

          {/* ══════ LAYER 1: AXIS GUIDE LINES ══════ */}

          {/* Fifths axis (horizontal connections) — cyan */}
          {useMemo(() => {
            const lines: React.ReactNode[] = [];
            for (let r = GRID_R_MIN; r <= GRID_R_MAX; r++) {
              for (let q = GRID_Q_MIN; q < GRID_Q_MAX; q++) {
                const p1 = axialToPixel(q, r, cx, cy);
                const p2 = axialToPixel(q + 1, r, cx, cy);
                lines.push(
                  <line key={`ax5-${q}-${r}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke="rgba(103,232,249,0.08)" strokeWidth={0.7} />
                );
              }
            }
            return lines;
          }, [cx, cy])}

          {/* Minor thirds axis (vertical-ish connections) — pink */}
          {useMemo(() => {
            const lines: React.ReactNode[] = [];
            for (let q = GRID_Q_MIN; q <= GRID_Q_MAX; q++) {
              for (let r = GRID_R_MIN; r < GRID_R_MAX; r++) {
                const p1 = axialToPixel(q, r, cx, cy);
                const p2 = axialToPixel(q, r + 1, cx, cy);
                lines.push(
                  <line key={`ax3-${q}-${r}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke="rgba(244,114,182,0.06)" strokeWidth={0.7} />
                );
              }
            }
            return lines;
          }, [cx, cy])}

          {/* Major thirds axis (diagonal connections) — purple */}
          {useMemo(() => {
            const lines: React.ReactNode[] = [];
            for (let q = GRID_Q_MIN; q < GRID_Q_MAX; q++) {
              for (let r = GRID_R_MIN + 1; r <= GRID_R_MAX; r++) {
                const p1 = axialToPixel(q, r, cx, cy);
                const p2 = axialToPixel(q + 1, r - 1, cx, cy);
                lines.push(
                  <line key={`ax4-${q}-${r}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke="rgba(167,139,250,0.06)" strokeWidth={0.7} />
                );
              }
            }
            return lines;
          }, [cx, cy])}

          {/* ══════ LAYER 2: DIATONIC REGION ══════ */}

          {diatonicTris.map(tri => {
            const key = triKey(tri);
            const chord = triangleChord(tri);
            const color = NOTE_COLORS[chord.root];
            return (
              <path key={`dia-${key}`}
                d={triangleSVGPath(tri, cx, cy)}
                fill={hex2rgba(color, 0.04)}
                stroke={hex2rgba(color, 0.08)}
                strokeWidth={0.5}
                strokeDasharray="4 4"
              />
            );
          })}

          {/* ══════ LAYER 3: TRIANGLE FILLS ══════ */}

          {triangles.map(({ tri, path: d, centroid }) => {
            const key = triKey(tri);
            const chord = triangleChord(tri);
            const color = NOTE_COLORS[chord.root];
            const isDiatonic = diatonicTriKeys.has(key);
            const isPath = pathTriKeys.has(key);
            const isSelected = selectedTriangle && triEquals(tri, selectedTriangle);
            const isHovered = hoveredTriangle && triEquals(tri, hoveredTriangle);
            const isAdjacent = adjacentKeys.has(key);
            const isPlaying = playbackIndex >= 0 && path[playbackIndex] && triEquals(tri, path[playbackIndex].triangle);

            // Focus falloff — distance from active area (gentle — everything stays visible)
            const dist = gridDistance({ q: tri.q, r: tri.r }, focusCenter);
            const falloff = interpolate(dist, [0, 2, 5, 10], [1, 0.85, 0.55, 0.35], { extrapolateRight: 'clamp' });

            let fillColor = color;
            let fillOpacity = 0.015 * falloff;
            let strokeColor = hex2rgba(color, 0.06 * falloff);
            let strokeWidth = 0.3;
            let filter: string | undefined;

            if (isDiatonic && !isPath && !isSelected && !isHovered && !isAdjacent) {
              // Subtle diatonic background — already handled in layer 2
              fillOpacity = 0.03 * falloff;
              strokeColor = hex2rgba(color, 0.1 * falloff);
            }

            if (isAdjacent && !isSelected && !isPath) {
              fillColor = color;
              fillOpacity = 0.03 * falloff;
              strokeColor = hex2rgba(color, 0.15);
              strokeWidth = 0.5;
            }

            if (isHovered) {
              fillColor = color;
              fillOpacity = 0.08;
              strokeColor = hex2rgba(color, 0.35);
              strokeWidth = 1;
              filter = 'url(#tn-bloom-soft)';
            }

            if (isPath) {
              const pathIdx = path.findIndex(s => triEquals(s.triangle, tri));
              const recency = path.length > 1 ? 1 - (path.length - 1 - pathIdx) / Math.max(path.length, 6) : 1;
              fillColor = color;
              fillOpacity = interpolate(recency, [0, 1], [0.06, 0.15]) * falloff;
              strokeColor = hex2rgba(color, interpolate(recency, [0, 1], [0.15, 0.5]));
              strokeWidth = interpolate(recency, [0, 1], [0.5, 1.5]);
              if (pathIdx === path.length - 1) filter = 'url(#tn-bloom-soft)';
            }

            if (isSelected) {
              const age = Math.max(0, frame - lastAddedFrame);
              const scaleSpring = spring({ frame: Math.min(age, 20), fps, config: { damping: 12, stiffness: 80, mass: 0.8 } });
              fillColor = color;
              fillOpacity = 0.2 * scaleSpring;
              strokeColor = color;
              strokeWidth = 2;
              filter = 'url(#tn-bloom-med)';
            }

            if (isPlaying) {
              const playPulse = spring({ frame: (frame % 30), fps, config: { damping: 12, stiffness: 30, mass: 2 } });
              fillColor = '#fbbf24';
              fillOpacity = 0.15 + playPulse * 0.1;
              strokeColor = '#fbbf24';
              strokeWidth = 2;
              filter = 'url(#tn-bloom-med)';
            }

            return (
              <g key={`tf-${key}`}>
                {/* Minor triad hatching */}
                {tri.pointing === 'up' && (isPath || isSelected || isPlaying) && (
                  <path d={d} fill="url(#tn-hatch)" opacity={fillOpacity * 2} />
                )}
                <path d={d}
                  fill={hex2rgba(fillColor, fillOpacity)}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  filter={filter}
                />
              </g>
            );
          })}

          {/* ══════ LAYER 4: CHORD PATH EDGES ══════ */}

          {path.map((step, i) => {
            if (i === 0) return null;
            const prev = path[i - 1];
            const c1 = triangleCentroid(prev.triangle, cx, cy);
            const c2 = triangleCentroid(step.triangle, cx, cy);
            const color = NOTE_COLORS[step.chord.root];
            const recency = 1 - (path.length - 1 - i) / Math.max(path.length, 6);
            const opacity = interpolate(recency, [0, 1], [0.15, 0.8]);
            const isPlayEdge = playbackIndex >= 0 && (i === playbackIndex || i - 1 === playbackIndex);

            return (
              <g key={`edge-${i}`}>
                {/* Glow */}
                <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y}
                  stroke={isPlayEdge ? '#fbbf24' : color}
                  strokeWidth={6} opacity={opacity * 0.08}
                  filter="url(#tn-bloom-heavy)" />
                {/* Core */}
                <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y}
                  stroke={isPlayEdge ? '#fbbf24' : color}
                  strokeWidth={1.5} opacity={opacity * 0.5}
                  strokeLinecap="round" />
                {/* Traveling particle */}
                {(() => {
                  const t = (frame * 0.025 + i * 0.3) % 1;
                  return (
                    <circle cx={c1.x + (c2.x - c1.x) * t} cy={c1.y + (c2.y - c1.y) * t}
                      r={1.5} fill={isPlayEdge ? '#fbbf24' : color}
                      opacity={opacity * 0.6} filter="url(#tn-bloom-soft)" />
                  );
                })()}
                {/* P/L/R label on edge */}
                {step.operation && (() => {
                  const mid = sharedEdgeMidpoint(prev.triangle, step.triangle, cx, cy);
                  if (!mid) return null;
                  // Offset perpendicular to edge
                  const dx = c2.x - c1.x;
                  const dy = c2.y - c1.y;
                  const len = Math.sqrt(dx * dx + dy * dy) || 1;
                  const offX = -dy / len * 8;
                  const offY = dx / len * 8;
                  return (
                    <g>
                      <rect x={mid.x + offX - 7} y={mid.y + offY - 6} width={14} height={12}
                        rx={3} fill="rgba(4,8,16,0.85)" />
                      <text x={mid.x + offX} y={mid.y + offY + 1}
                        textAnchor="middle" dominantBaseline="central"
                        fontFamily="'SF Mono', monospace" fontSize={8} fontWeight={800}
                        fill="#e2e8f0" opacity={opacity * 0.7}>
                        {step.operation}
                      </text>
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* ══════ LAYER 5: PLR LABELS ON ADJACENT EDGES ══════ */}

          {selectedTriangle && adjacents.map(({ op, tri: adjTri }) => {
            const mid = sharedEdgeMidpoint(selectedTriangle, adjTri, cx, cy);
            if (!mid) return null;
            const isHov = hoveredTriangle && triEquals(adjTri, hoveredTriangle);
            const adjChord = triangleChord(adjTri);
            const c1 = triangleCentroid(selectedTriangle, cx, cy);
            const c2 = triangleCentroid(adjTri, cx, cy);
            const dx = c2.x - c1.x;
            const dy = c2.y - c1.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const offX = -dy / len * 10;
            const offY = dx / len * 10;

            return (
              <g key={`plr-${op}`}>
                <rect x={mid.x + offX - 8} y={mid.y + offY - 7} width={16} height={14}
                  rx={3} fill="rgba(4,8,16,0.85)"
                  stroke={isHov ? '#e2e8f0' : 'rgba(103,232,249,0.1)'}
                  strokeWidth={isHov ? 0.8 : 0.3} />
                <text x={mid.x + offX} y={mid.y + offY + 1}
                  textAnchor="middle" dominantBaseline="central"
                  fontFamily="'SF Mono', monospace" fontSize={9} fontWeight={800}
                  fill={isHov ? '#fff' : '#94a3b8'} opacity={isHov ? 1 : 0.6}>
                  {op}
                </text>
              </g>
            );
          })}

          {/* ══════ LAYER 6: SHOCKWAVE ON MIDI CHORD ══════ */}

          {timeSinceChord >= 0 && timeSinceChord < 35 && (() => {
            const expand = spring({ frame: timeSinceChord, fps, config: { damping: 15, stiffness: 40, mass: 1.2 } });
            const ringR = interpolate(expand, [0, 1], [15, Math.max(W, H) * 0.35]);
            const fade = interpolate(timeSinceChord, [0, 35], [0.25, 0], { extrapolateRight: 'clamp' });
            return (
              <circle cx={cx} cy={cy} r={ringR}
                fill="none" stroke="#67e8f9"
                strokeWidth={interpolate(expand, [0, 1], [3, 0.5])}
                opacity={fade} filter="url(#tn-bloom-med)" />
            );
          })()}

          {/* ══════ LAYER 7: GRID NODES ══════ */}

          {nodes.map(node => {
            const pc = node.pc;
            const color = NOTE_COLORS[pc];
            const colorDim = NOTE_COLORS_DIM[pc];
            const isDiatonic = diatonicPCs.has(pc);
            const isActive = activePCs.has(pc);

            // Focus falloff — gentle, everything stays readable
            const dist = gridDistance({ q: node.q, r: node.r }, focusCenter);
            const falloff = interpolate(dist, [0, 2, 5, 10], [1, 0.85, 0.55, 0.35], { extrapolateRight: 'clamp' });

            const r = isActive ? NODE_R_ACTIVE : isDiatonic ? NODE_R_DIATONIC : NODE_R;
            const fillOp = isActive ? 0.4 : isDiatonic ? 0.18 : 0.08;
            const strokeOp = isActive ? 0.85 : isDiatonic ? 0.35 : 0.15;
            const labelOp = isActive ? 1 : isDiatonic ? 0.7 : 0.5;

            // Breathing
            const breathe = 0.02 * Math.sin(frame * 0.06 + pc * 0.52);

            return (
              <g key={`n-${node.q}-${node.r}`} opacity={falloff + breathe}>
                {/* Drop shadow */}
                <circle cx={node.x + 1} cy={node.y + 1.5} r={r}
                  fill="rgba(0,0,0,0.2)" />

                {/* Active glow */}
                {isActive && (
                  <circle cx={node.x} cy={node.y} r={r * 2}
                    fill={hex2rgba(color, 0.06)}
                    filter="url(#tn-bloom-med)" />
                )}

                {/* Node body */}
                <circle cx={node.x} cy={node.y} r={r}
                  fill={isActive ? hex2rgba(color, fillOp) : colorDim}
                  stroke={color} strokeWidth={isActive ? 1.5 : isDiatonic ? 0.8 : 0.4}
                  opacity={strokeOp}
                  filter={isActive ? 'url(#tn-bloom-soft)' : undefined}
                />

                {/* Specular highlight */}
                {(isActive || isDiatonic) && (
                  <circle cx={node.x - r * 0.2} cy={node.y - r * 0.25}
                    r={r * 0.35}
                    fill="rgba(255,255,255,0.08)" />
                )}

                {/* Note label */}
                <text x={node.x} y={node.y + 1}
                  textAnchor="middle" dominantBaseline="central"
                  fontFamily="'SF Mono', 'Fira Code', monospace"
                  fontSize={isActive ? 12 : 10} fontWeight={700}
                  fill={isActive ? '#fff' : color}
                  opacity={labelOp}
                  filter={isActive ? 'url(#tn-bloom-soft)' : undefined}>
                  {noteName(pc)}
                </text>
              </g>
            );
          })}

          {/* ══════ LAYER 8: PATH STEP NUMBERS ══════ */}

          {path.map((step, i) => {
            const c = triangleCentroid(step.triangle, cx, cy);
            const isPlay = i === playbackIndex;
            const color = NOTE_COLORS[step.chord.root];
            return (
              <g key={`pn-${i}`}>
                <circle cx={c.x} cy={c.y} r={8}
                  fill={isPlay ? '#fbbf24' : 'rgba(4,8,16,0.8)'}
                  stroke={isPlay ? '#fbbf24' : color}
                  strokeWidth={isPlay ? 1.5 : 0.5}
                  filter={isPlay ? 'url(#tn-bloom-soft)' : undefined} />
                <text x={c.x} y={c.y + 1}
                  textAnchor="middle" dominantBaseline="central"
                  fontFamily="'SF Mono', monospace" fontSize={7} fontWeight={700}
                  fill={isPlay ? '#0a0e1a' : '#e2e8f0'} opacity={isPlay ? 1 : 0.7}>
                  {i + 1}
                </text>
              </g>
            );
          })}

        </g>
        </g>

        {/* ══════ LAYER 9: CHORD HUD (screen space) ══════ */}

        {selectedTriangle && (() => {
          const chord = triangleChord(selectedTriangle);
          const color = NOTE_COLORS[chord.root];
          const lastStep = path.length > 0 ? path[path.length - 1] : null;
          const vl = lastStep ? computeVoiceLeading(lastStep.triangle, selectedTriangle) : null;
          const op = lastStep ? getSharedEdgeOp(lastStep.triangle, selectedTriangle) : null;

          return (
            <g>
              {/* Background pill */}
              <rect x={14} y={PAD_TOP + 4} width={140} height={vl ? 52 : 36}
                rx={8} fill="rgba(4,8,16,0.8)"
                stroke="rgba(103,232,249,0.08)" strokeWidth={0.5} />

              {/* Chord name */}
              <text x={24} y={PAD_TOP + 24}
                fontFamily="'SF Pro Display', system-ui"
                fontSize={18} fontWeight={700} fill={color}>
                {chord.name}
              </text>

              {/* Quality */}
              <text x={24 + chord.name.length * 12} y={PAD_TOP + 24}
                fontFamily="'SF Mono', monospace"
                fontSize={11} fill="#64748b">
                {chord.quality === 'minor' ? ' min' : ' maj'}
              </text>

              {/* Operation arrow */}
              {op && lastStep && (
                <text x={100} y={PAD_TOP + 24}
                  fontFamily="'SF Mono', monospace"
                  fontSize={10} fill="#94a3b8">
                  {op}
                </text>
              )}

              {/* Voice leading */}
              {vl && (
                <text x={24} y={PAD_TOP + 44}
                  fontFamily="'SF Mono', monospace"
                  fontSize={9} fill="#64748b" opacity={0.6}>
                  {noteName(vl.from)} → {noteName(vl.to)} ({vl.semitones > 0 ? '+' : ''}{vl.semitones})
                </text>
              )}
            </g>
          );
        })()}

        {/* ══════ LAYER 10: LESSON OVERLAY (screen space) ══════ */}

        {lessonActive && (
          <TonnetzLessonOverlay
            step={lessonStep}
            stepIndex={lessonStepIndex}
            stepStartFrame={lessonStepStartFrame}
            totalSteps={lessonTotalSteps}
            accentColor={lessonAccentColor}
            lessonTitle={lessonTitle}
            isActive={lessonActive}
            gridTransform={{ tx, ty, scale }}
            prevHighlights={lessonPrevHighlights}
          />
        )}

      </svg>
    </AbsoluteFill>
  );
};

export default TonnetzComposition;
