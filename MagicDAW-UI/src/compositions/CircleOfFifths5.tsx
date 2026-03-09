import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from 'remotion';
import { DiatonicChordsPanel, AdjacentChordsPanel } from './MiniKeyboard';
import { useCircleZoom, chordToRingIndex } from './useCircleZoom';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CircleOfFifthsProps {
  activeKey: string;
  activeMode: 'major' | 'minor';
  detectedChord: string | null;
  activeNotes: number[];
  chordProgression: string[];
  pathfinderFrom: string | null;
  pathfinderTo: string | null;
  pathfinderPaths: string[][];
  highlightedDegrees: number[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const W = 1920;
const H = 1080;
const CX = W / 2;
const CY = H / 2;

const OUTER_R = 320;
const MIDDLE_R = 240;
const INNER_R = 160;

const MAJORS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINORS = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];
const DIMINISHED = [
  'Bdim', 'F#dim', 'C#dim', 'G#dim', 'D#dim', 'A#dim',
  'Fdim', 'Cdim', 'Gdim', 'Ddim', 'Adim', 'Edim',
];

const palette = {
  bg: '#000000',
  light: '#ffffff',
  accent: '#bfdbfe',
  accentDim: '#60a5fa',
  ghost: 'rgba(255,255,255,0.04)',
  ghostLine: 'rgba(255,255,255,0.02)',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

/** Angle in radians for the i-th slot (12 positions, starting at top / -π/2). */
function slotAngle(i: number): number {
  return ((2 * Math.PI) / 12) * i - Math.PI / 2;
}

/** Position on a ring. */
function ringPos(i: number, r: number): { x: number; y: number } {
  const a = slotAngle(i);
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}

/** Map a MIDI note (0-127) to its pitch class index in the circle of fifths. */
function midiToFifthsIndex(note: number): number {
  const pc = note % 12; // C=0 chromatic
  // chromatic-to-fifths: multiply by 7 mod 12
  return (pc * 7) % 12;
}

/** Check if a key label matches a fifths-index (for majors ring). */
function keyMatchesFifthsIndex(key: string, idx: number): boolean {
  return MAJORS[idx] === key;
}

// ── Component ──────────────────────────────────────────────────────────────

export const CircleOfFifths5: React.FC<CircleOfFifthsProps> = ({
  activeKey,
  activeMode,
  detectedChord,
  activeNotes,
  chordProgression,
  pathfinderFrom,
  pathfinderTo,
  pathfinderPaths,
  highlightedDegrees,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ── Derived indices ────────────────────────────────────────────────────

  const activeIdx = useMemo(() => {
    if (activeMode === 'minor') {
      const mi = MINORS.indexOf(activeKey);
      return mi >= 0 ? mi : 0;
    }
    const mi = MAJORS.indexOf(activeKey);
    return mi >= 0 ? mi : 0;
  }, [activeKey, activeMode]);

  const relativeMinorIdx = activeIdx; // same slot on middle ring
  const adjacentIdxs = [(activeIdx + 11) % 12, (activeIdx + 1) % 12];

  // MIDI notes → fifths indices currently sounding
  const activeFifthsIdxs = useMemo(
    () => Array.from(new Set(activeNotes.map(midiToFifthsIndex))),
    [activeNotes],
  );

  const playedIndices = useMemo(
    () => new Set(activeNotes.map(midiToFifthsIndex)),
    [activeNotes],
  );

  const detectedRing = useMemo(() => chordToRingIndex(detectedChord), [detectedChord]);

  // ── Zoom into played node's quadrant
  const zoom = useCircleZoom({
    playedIndices,
    detectedRing,
    cx: CX, cy: CY, outerR: OUTER_R,
    middleR: MIDDLE_R, innerR: INNER_R,
    fullW: W, fullH: H,
    frame, fps,
    zoomFraction: 0.45,
  });

  // ── Pathfinder lookup ──────────────────────────────────────────────────

  const pathfinderNodeSet = useMemo(() => {
    const s = new Set<string>();
    for (const path of pathfinderPaths) {
      for (const node of path) s.add(node);
    }
    return s;
  }, [pathfinderPaths]);

  const pathfinderEdges = useMemo(() => {
    const edges: Array<{ from: string; to: string; pathIdx: number; segIdx: number }> = [];
    pathfinderPaths.forEach((path, pi) => {
      for (let i = 0; i < path.length - 1; i++) {
        edges.push({ from: path[i], to: path[i + 1], pathIdx: pi, segIdx: i });
      }
    });
    return edges;
  }, [pathfinderPaths]);

  // ── Animation values ───────────────────────────────────────────────────

  const breathe = Math.sin((frame / fps) * Math.PI * 0.66); // ~3s period
  const glowOuter = interpolate(breathe, [-1, 1], [0.3, 0.6]);
  const glowRadius = interpolate(breathe, [-1, 1], [90, 130]);

  // Ripple (fires every ~90 frames as a simple repeating trigger)
  const ripplePhase = (frame % 90) / 90;
  const rippleR = interpolate(ripplePhase, [0, 1], [0, 200]);
  const rippleOpacity = interpolate(ripplePhase, [0, 0.15, 1], [0.7, 0.5, 0]);

  // ── Node helpers ───────────────────────────────────────────────────────

  function nodeLabel(ring: 'major' | 'minor' | 'dim', idx: number): string {
    if (ring === 'major') return MAJORS[idx];
    if (ring === 'minor') return MINORS[idx];
    return DIMINISHED[idx];
  }

  function isActive(ring: 'major' | 'minor' | 'dim', idx: number): boolean {
    if (ring === 'major' && activeMode === 'major' && idx === activeIdx) return true;
    if (ring === 'minor' && activeMode === 'minor' && idx === activeIdx) return true;
    return false;
  }

  function isConnection(ring: 'major' | 'minor' | 'dim', idx: number): boolean {
    if (ring === 'major' && activeMode === 'major') {
      if (adjacentIdxs.includes(idx)) return true;
    }
    if (ring === 'minor' && activeMode === 'major' && idx === relativeMinorIdx) return true;
    if (ring === 'major' && activeMode === 'minor' && idx === activeIdx) return true;
    if (ring === 'minor' && activeMode === 'minor') {
      if (adjacentIdxs.includes(idx)) return true;
    }
    return false;
  }

  function isGravityTarget(_ring: 'major' | 'minor' | 'dim', idx: number): boolean {
    return activeFifthsIdxs.includes(idx);
  }

  function isPathfinderNode(ring: 'major' | 'minor' | 'dim', idx: number): boolean {
    return pathfinderNodeSet.has(nodeLabel(ring, idx));
  }

  function nodeOpacity(ring: 'major' | 'minor' | 'dim', idx: number): number {
    if (isActive(ring, idx)) return 1;
    if (isConnection(ring, idx)) return 0.8;
    if (isPathfinderNode(ring, idx)) return 0.9;
    if (isGravityTarget(ring, idx)) return 0.6;
    // Ghost breathing
    const seed = idx * 3 + (ring === 'minor' ? 37 : ring === 'dim' ? 73 : 0);
    const ghostBreath = 0.04 + 0.01 * Math.sin((frame / fps) * 0.4 + seededRandom(seed) * 20);
    return ghostBreath;
  }

  function ringForLabel(label: string): { ring: 'major' | 'minor' | 'dim'; idx: number; r: number } | null {
    let i = MAJORS.indexOf(label);
    if (i >= 0) return { ring: 'major', idx: i, r: OUTER_R };
    i = MINORS.indexOf(label);
    if (i >= 0) return { ring: 'minor', idx: i, r: MIDDLE_R };
    i = DIMINISHED.indexOf(label);
    if (i >= 0) return { ring: 'dim', idx: i, r: INNER_R };
    return null;
  }

  // ── Active node position ───────────────────────────────────────────────

  const activeR = activeMode === 'major' ? OUTER_R : MIDDLE_R;
  const activePos = ringPos(activeIdx, activeR);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg }}>
      <svg viewBox={zoom.viewBox} width={W} height={H}>
        <defs>
          {/* Massive glow for active key */}
          <filter id="gw-glow-massive" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="20" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Soft glow for connections and pathfinder */}
          <filter id="gw-glow-soft" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="6" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Radial glow gradient for active key halo */}
          <radialGradient id="gw-halo">
            <stop offset="0%" stopColor={palette.accent} stopOpacity={glowOuter} />
            <stop offset="100%" stopColor={palette.accent} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* ── Ghost ring lines (barely visible structure) ────────────── */}
        <circle cx={CX} cy={CY} r={OUTER_R} fill="none" stroke={palette.ghostLine} strokeWidth={0.5} />
        <circle cx={CX} cy={CY} r={MIDDLE_R} fill="none" stroke={palette.ghostLine} strokeWidth={0.5} />
        <circle cx={CX} cy={CY} r={INNER_R} fill="none" stroke={palette.ghostLine} strokeWidth={0.5} />

        {/* ── Ghost spoke lines ──────────────────────────────────────── */}
        {Array.from({ length: 12 }).map((_, i) => {
          const inner = ringPos(i, INNER_R - 10);
          const outer = ringPos(i, OUTER_R + 10);
          return (
            <line
              key={`spoke-${i}`}
              x1={inner.x} y1={inner.y}
              x2={outer.x} y2={outer.y}
              stroke={palette.ghostLine}
              strokeWidth={0.5}
            />
          );
        })}

        {/* ── Connection lines (active key → adjacent fifths + relative) */}
        {adjacentIdxs.map((ai) => {
          const p = ringPos(ai, activeR);
          const dashOffset = (frame * 0.3) % 20;
          return (
            <line
              key={`conn-${ai}`}
              x1={activePos.x} y1={activePos.y}
              x2={p.x} y2={p.y}
              stroke={palette.light}
              strokeWidth={1.5}
              opacity={0.8}
              strokeDasharray="8 4"
              strokeDashoffset={dashOffset}
            />
          );
        })}
        {/* Active → relative minor/major */}
        {(() => {
          const targetR = activeMode === 'major' ? MIDDLE_R : OUTER_R;
          const p = ringPos(activeIdx, targetR);
          const dashOffset = (frame * 0.2) % 16;
          return (
            <line
              x1={activePos.x} y1={activePos.y}
              x2={p.x} y2={p.y}
              stroke={palette.accent}
              strokeWidth={1}
              opacity={0.6}
              strokeDasharray="6 6"
              strokeDashoffset={dashOffset}
            />
          );
        })()}

        {/* ── Gravity beams (active notes → distant keys) ────────────── */}
        {activeFifthsIdxs
          .filter((fi) => fi !== activeIdx && !adjacentIdxs.includes(fi))
          .map((fi) => {
            const target = ringPos(fi, OUTER_R);
            const beamProgress = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
            const bx = activePos.x + (target.x - activePos.x) * beamProgress;
            const by = activePos.y + (target.y - activePos.y) * beamProgress;
            return (
              <line
                key={`gravity-${fi}`}
                x1={activePos.x} y1={activePos.y}
                x2={bx} y2={by}
                stroke={palette.accent}
                strokeWidth={1}
                opacity={0.5 * beamProgress}
              />
            );
          })}

        {/* ── Pathfinder paths ───────────────────────────────────────── */}
        {pathfinderEdges.map(({ from, to, pathIdx, segIdx }) => {
          const a = ringForLabel(from);
          const b = ringForLabel(to);
          if (!a || !b) return null;
          const pa = ringPos(a.idx, a.r);
          const pb = ringPos(b.idx, b.r);
          const delay = (pathIdx * 3 + segIdx) * 5;
          const segProgress = spring({
            frame: Math.max(0, frame - delay),
            fps,
            config: { damping: 14, stiffness: 100 },
          });
          const ex = pa.x + (pb.x - pa.x) * segProgress;
          const ey = pa.y + (pb.y - pa.y) * segProgress;
          return (
            <React.Fragment key={`pf-${pathIdx}-${segIdx}`}>
              {/* Cheap fake glow: thicker line at lower opacity behind */}
              <line
                x1={pa.x} y1={pa.y}
                x2={ex} y2={ey}
                stroke={palette.accent}
                strokeWidth={6}
                opacity={segProgress * 0.25}
                strokeLinecap="round"
              />
              <line
                x1={pa.x} y1={pa.y}
                x2={ex} y2={ey}
                stroke={palette.light}
                strokeWidth={2}
                opacity={segProgress * 0.95}
              />
            </React.Fragment>
          );
        })}

        {/* ── Nodes: Outer ring (Majors) ─────────────────────────────── */}
        {MAJORS.map((label, i) => {
          const p = ringPos(i, OUTER_R);
          const active = isActive('major', i);
          const played = playedIndices.has(i) && !active;
          const op = played ? 0.85 : nodeOpacity('major', i);
          const r = active ? 6 : played ? 5 : 3;
          return (
            <g key={`maj-${i}`} opacity={op}>
              <circle
                cx={p.x} cy={p.y} r={r}
                fill={active ? palette.accent : played ? palette.accentDim : palette.light}
                filter={active ? 'url(#gw-glow-massive)' : played ? 'url(#gw-glow-soft)' : undefined}
              />
              <text
                x={p.x} y={p.y - (active ? 18 : played ? 14 : 12)}
                textAnchor="middle"
                fill={active ? palette.accent : played ? palette.accentDim : palette.light}
                fontSize={active ? 22 : played ? 14 : 12}
                fontFamily="monospace"
                fontWeight={active ? 700 : played ? 600 : 400}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* ── Nodes: Middle ring (Minors) ────────────────────────────── */}
        {MINORS.map((label, i) => {
          const p = ringPos(i, MIDDLE_R);
          const active = isActive('minor', i);
          const isDetectedMinor = detectedRing.ring === 'minor' && detectedRing.index === i;
          const op = isDetectedMinor ? 0.95 : nodeOpacity('minor', i);
          const r = active ? 5 : isDetectedMinor ? 4 : 2.5;
          return (
            <g key={`min-${i}`} opacity={op}>
              <circle
                cx={p.x} cy={p.y} r={r}
                fill={active ? palette.accent : isDetectedMinor ? palette.accentDim : palette.light}
                filter={isDetectedMinor ? 'url(#gw-glow-soft)' : undefined}
              />
              <text
                x={p.x} y={p.y - (active ? 16 : isDetectedMinor ? 12 : 10)}
                textAnchor="middle"
                fill={active ? palette.accent : isDetectedMinor ? palette.accentDim : palette.light}
                fontSize={active ? 18 : isDetectedMinor ? 12 : 10}
                fontFamily="monospace"
                fontWeight={active ? 700 : isDetectedMinor ? 600 : 400}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* ── Nodes: Inner ring (Diminished) ─────────────────────────── */}
        {DIMINISHED.map((label, i) => {
          const p = ringPos(i, INNER_R);
          const isDetectedDim = detectedRing.ring === 'dim' && detectedRing.index === i;
          const op = isDetectedDim ? 0.9 : nodeOpacity('dim', i);
          const r = isDetectedDim ? 3.5 : 2;
          return (
            <g key={`dim-${i}`} opacity={op}>
              <circle
                cx={p.x} cy={p.y} r={r}
                fill={isDetectedDim ? palette.accentDim : palette.light}
                filter={isDetectedDim ? 'url(#gw-glow-soft)' : undefined}
              />
              <text
                x={p.x} y={p.y - (isDetectedDim ? 10 : 8)}
                textAnchor="middle"
                fill={isDetectedDim ? palette.accentDim : palette.light}
                fontSize={isDetectedDim ? 10 : 8}
                fontFamily="monospace"
                fontWeight={isDetectedDim ? 600 : 400}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* ── Active key massive halo ────────────────────────────────── */}
        <circle
          cx={activePos.x}
          cy={activePos.y}
          r={glowRadius}
          fill="url(#gw-halo)"
          opacity={1}
        />

        {/* ── Active key label (large) ───────────────────────────────── */}
        <text
          x={activePos.x}
          y={activePos.y + 38}
          textAnchor="middle"
          fill={palette.accent}
          fontSize={48}
          fontFamily="monospace"
          fontWeight={700}
        >
          {activeKey}
        </text>

        {/* ── Ripple ring (on chord change) ──────────────────────────── */}
        {detectedChord && (
          <circle
            cx={activePos.x}
            cy={activePos.y}
            r={rippleR}
            fill="none"
            stroke={palette.light}
            strokeWidth={1}
            opacity={rippleOpacity}
          />
        )}

        {/* ── Detected chord (center) ────────────────────────────────── */}
        {detectedChord && (
          <text
            x={CX}
            y={CY + 10}
            textAnchor="middle"
            fill={palette.light}
            fontSize={24}
            fontFamily="monospace"
            fontWeight={400}
            opacity={spring({ frame, fps, config: { damping: 20, stiffness: 80 } })}
          >
            {detectedChord}
          </text>
        )}

        {/* ── Mode indicator (below center) ──────────────────────────── */}
        <text
          x={CX}
          y={CY + 38}
          textAnchor="middle"
          fill={palette.light}
          fontSize={12}
          fontFamily="monospace"
          opacity={0.3}
        >
          {activeMode}
        </text>

        {/* ── Chord progression (bottom) ─────────────────────────────── */}
        {chordProgression.length > 0 && (
          <g>
            {chordProgression.slice(-8).map((chord, i, arr) => {
              const spacing = 120;
              const totalW = (arr.length - 1) * spacing;
              const sx = CX - totalW / 2 + i * spacing;
              return (
                <text
                  key={`prog-${i}`}
                  x={sx}
                  y={H - 40}
                  textAnchor="middle"
                  fill={palette.light}
                  fontSize={14}
                  fontFamily="monospace"
                  opacity={i === arr.length - 1 ? 0.7 : 0.35}
                >
                  {chord}
                </text>
              );
            })}
          </g>
        )}

        {/* ── Highlighted degree markers ─────────────────────────────── */}
        {highlightedDegrees.map((deg) => {
          const idx = (activeIdx + deg) % 12;
          const p = ringPos(idx, OUTER_R + 24);
          return (
            <circle
              key={`hl-${deg}`}
              cx={p.x}
              cy={p.y}
              r={3}
              fill={palette.accentDim}
              opacity={0.7}
            />
          );
        })}

        {/* ── Chord keyboards: crossfade between adjacent and diatonic ── */}
        {zoom.primaryPlayedIdx >= 0 && zoom.zoomProgress > 0.01 && (() => {
          const pos = ringPos(zoom.primaryPlayedIdx, OUTER_R);
          return (
            <AdjacentChordsPanel
              anchorX={pos.x}
              anchorY={pos.y}
              playedIndex={zoom.primaryPlayedIdx}
              accentColor="#bfdbfe"
              secondaryColor="rgba(255,255,255,0.5)"
              textColor="rgba(255,255,255,0.7)"
              textDimColor="rgba(255,255,255,0.3)"
              opacity={zoom.zoomProgress}
            />
          );
        })()}
        {zoom.zoomProgress < 0.99 && (
          <DiatonicChordsPanel
            x={1660}
            y={120}
            activeKey={activeKey}
            activeMode={activeMode}
            accentColor="#bfdbfe"
            secondaryColor="rgba(255,255,255,0.5)"
            textColor="rgba(255,255,255,0.7)"
            textDimColor="rgba(255,255,255,0.3)"
            kbWidth={130}
            kbHeight={38}
            spacing={68}
            opacity={0.6 * (1 - zoom.zoomProgress)}
          />
        )}
      </svg>
    </AbsoluteFill>
  );
};
