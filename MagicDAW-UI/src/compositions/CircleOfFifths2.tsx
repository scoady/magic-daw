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
const NODE_R_OUTER = 28;
const NODE_R_MIDDLE = 22;
const NODE_R_INNER = 18;

const MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINOR_KEYS = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];
const DIM_KEYS = ['Bdim', 'F#dim', 'C#dim', 'G#dim', 'D#dim', 'A#dim', 'Fdim', 'Cdim', 'Gdim', 'Ddim', 'Adim', 'Edim'];

const ENHARMONIC: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'Gb': 'F#',
  'Cb': 'B', 'Fb': 'E', 'B#': 'C', 'E#': 'F',
};

const aurora = {
  bg: '#080e18',
  cyan: '#67e8f9',
  teal: '#2dd4bf',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  text: '#e2e8f0',
  textDim: '#94a3b8',
};

const MANDALA_RADII = [80, 140, 200, 260, 320, 380];
const RADIAL_COUNT = 24;
const STAR_COUNT = 180;

// ── Utilities ──────────────────────────────────────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function normalizeKey(k: string): string {
  if (!k) return '';
  const root = k.match(/^([A-G][#b]?)/);
  if (!root) return k;
  const normalized = ENHARMONIC[root[1]] ?? root[1];
  return normalized + k.slice(root[1].length);
}

function posOnRing(index: number, radius: number, offsetDeg: number = -90): [number, number] {
  const angle = ((index / 12) * 360 + offsetDeg) * (Math.PI / 180);
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

function angleDeg(index: number, offsetDeg: number = -90): number {
  return (index / 12) * 360 + offsetDeg;
}

function findKeyIndex(key: string, ring: string[]): number {
  const norm = normalizeKey(key);
  const idx = ring.indexOf(norm);
  if (idx >= 0) return idx;
  // try without accidental normalization
  return ring.indexOf(key);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Component ──────────────────────────────────────────────────────────────

export const CircleOfFifths2: React.FC<CircleOfFifthsProps> = ({
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

  // ── Derived state ──────────────────────────────────────────────────────

  const activeKeyNorm = normalizeKey(activeKey);
  const activeMajorIdx = findKeyIndex(
    activeMode === 'major' ? activeKeyNorm : activeKeyNorm,
    MAJOR_KEYS,
  );
  const activeMinorIdx = findKeyIndex(
    activeMode === 'minor' ? activeKeyNorm : activeKeyNorm + 'm',
    MINOR_KEYS,
  );
  const activeRingIdx = activeMode === 'major' ? activeMajorIdx : activeMinorIdx;

  const playedIndices = useMemo(
    () => new Set(activeNotes.map((n) => ((n % 12) * 7) % 12)),
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
    zoomFraction: 0.5,
  });

  // ── Stars background ──────────────────────────────────────────────────

  const stars = useMemo(() => {
    const rng = seededRandom(42);
    return Array.from({ length: STAR_COUNT }, (_, i) => ({
      x: rng() * W,
      y: rng() * H,
      r: rng() * 1.8 + 0.3,
      phase: rng() * Math.PI * 2,
      speed: rng() * 0.03 + 0.01,
      hue: rng() > 0.7 ? (rng() > 0.5 ? 280 : 180) : 220,
    }));
  }, []);

  // ── Outer node positions (cached) ────────────────────────────────────

  const outerPositions = useMemo(
    () => MAJOR_KEYS.map((_, i) => posOnRing(i, OUTER_R)),
    [],
  );
  const middlePositions = useMemo(
    () => MINOR_KEYS.map((_, i) => posOnRing(i, MIDDLE_R)),
    [],
  );
  const innerPositions = useMemo(
    () => DIM_KEYS.map((_, i) => posOnRing(i, INNER_R)),
    [],
  );

  // ── Pathfinder edge path ─────────────────────────────────────────────

  const pathfinderEdges = useMemo(() => {
    if (!pathfinderPaths || pathfinderPaths.length === 0) return [];
    const path = pathfinderPaths[0];
    const edges: Array<{ from: [number, number]; to: [number, number] }> = [];
    for (let i = 0; i < path.length - 1; i++) {
      const fromIdx = findKeyIndex(normalizeKey(path[i]), MAJOR_KEYS);
      const toIdx = findKeyIndex(normalizeKey(path[i + 1]), MAJOR_KEYS);
      if (fromIdx >= 0 && toIdx >= 0) {
        edges.push({ from: outerPositions[fromIdx], to: outerPositions[toIdx] });
      }
    }
    return edges;
  }, [pathfinderPaths, outerPositions]);

  // ── Animation values ─────────────────────────────────────────────────

  const mandalaRotation = frame * 0.1;
  const hexagramRotation = -frame * 0.07;
  const pulsePhase = Math.sin(frame * 0.04) * 0.5 + 0.5;
  const breathe = Math.sin(frame * 0.025) * 0.5 + 0.5;

  // Adjacent distance for flower of life arcs
  const adjacentDist = useMemo(() => {
    const [x0, y0] = outerPositions[0];
    const [x1, y1] = outerPositions[1];
    return Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
  }, [outerPositions]);

  // ── SVG Definitions ──────────────────────────────────────────────────

  const renderDefs = () => (
    <defs>
      {/* Aurora gradients */}
      <radialGradient id="cof2-aurora-radial" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor={aurora.cyan} stopOpacity={0.15} />
        <stop offset="40%" stopColor={aurora.teal} stopOpacity={0.08} />
        <stop offset="70%" stopColor={aurora.purple} stopOpacity={0.05} />
        <stop offset="100%" stopColor={aurora.bg} stopOpacity={0} />
      </radialGradient>

      {/* Glass node gradient */}
      <radialGradient id="cof2-glass" cx="35%" cy="30%" r="65%">
        <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
        <stop offset="50%" stopColor="rgba(180,220,240,0.08)" />
        <stop offset="100%" stopColor="rgba(100,150,180,0.02)" />
      </radialGradient>

      {/* Active node glow */}
      <radialGradient id="cof2-active-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor={aurora.cyan} stopOpacity={0.6} />
        <stop offset="50%" stopColor={aurora.teal} stopOpacity={0.2} />
        <stop offset="100%" stopColor={aurora.purple} stopOpacity={0} />
      </radialGradient>

      {/* Aurora fill for triangles */}
      <linearGradient id="cof2-aurora-fill" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor={aurora.cyan} stopOpacity={0.12} />
        <stop offset="50%" stopColor={aurora.teal} stopOpacity={0.08} />
        <stop offset="100%" stopColor={aurora.purple} stopOpacity={0.12} />
      </linearGradient>

      {/* Pathfinder gradient */}
      <linearGradient id="cof2-pathfinder" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor={aurora.cyan} />
        <stop offset="50%" stopColor={aurora.pink} />
        <stop offset="100%" stopColor={aurora.purple} />
      </linearGradient>

      {/* Glow filter */}
      <filter id="cof2-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>

      <filter id="cof2-glow-strong" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>

      <filter id="cof2-glow-soft" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="20" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );

  // ── Layer 0: Background Stars ────────────────────────────────────────

  const renderStars = () =>
    stars.map((s, i) => {
      const twinkle = Math.sin(frame * s.speed + s.phase) * 0.4 + 0.6;
      return (
        <circle
          key={`star-${i}`}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill={`hsla(${s.hue}, 60%, 80%, ${twinkle * 0.7})`}
        />
      );
    });

  // ── Layer 1: Mandala ─────────────────────────────────────────────────

  const renderMandala = () => {
    const mandalaPulse = interpolate(pulsePhase, [0, 1], [0.08, 0.16]);
    return (
      <g
        transform={`rotate(${mandalaRotation}, ${CX}, ${CY})`}
        opacity={0.4}
      >
        {/* Concentric circles */}
        {MANDALA_RADII.map((r, i) => (
          <circle
            key={`mandala-c-${i}`}
            cx={CX}
            cy={CY}
            r={r}
            fill="none"
            stroke={aurora.gold}
            strokeWidth={0.5}
            opacity={mandalaPulse + (i % 2 === 0 ? 0.05 : 0)}
          />
        ))}
        {/* Radial lines */}
        {Array.from({ length: RADIAL_COUNT }, (_, i) => {
          const angle = (i / RADIAL_COUNT) * 360 * (Math.PI / 180);
          const x2 = CX + 400 * Math.cos(angle);
          const y2 = CY + 400 * Math.sin(angle);
          return (
            <line
              key={`mandala-r-${i}`}
              x1={CX}
              y1={CY}
              x2={x2}
              y2={y2}
              stroke={aurora.gold}
              strokeWidth={0.3}
              opacity={mandalaPulse * 0.6}
            />
          );
        })}
      </g>
    );
  };

  // ── Layer 2: Flower of Life ──────────────────────────────────────────

  const renderFlowerOfLife = () => {
    const flowerOpacity = interpolate(breathe, [0, 1], [0.06, 0.14]);
    return (
      <g opacity={flowerOpacity}>
        {outerPositions.map(([x, y], i) => {
          // Proximity to active key affects opacity
          let proximity = 1;
          if (activeMajorIdx >= 0) {
            const dist = Math.min(
              Math.abs(i - activeMajorIdx),
              12 - Math.abs(i - activeMajorIdx),
            );
            proximity = interpolate(dist, [0, 6], [1, 0.2], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
          }
          return (
            <circle
              key={`flower-${i}`}
              cx={x}
              cy={y}
              r={adjacentDist}
              fill="none"
              stroke={aurora.gold}
              strokeWidth={0.4}
              opacity={proximity * flowerOpacity}
            />
          );
        })}
      </g>
    );
  };

  // ── Layer 3: Dodecagon Construction ──────────────────────────────────

  const renderDodecagon = () => {
    const lineOpacity = interpolate(
      Math.sin(frame * 0.03),
      [-1, 1],
      [0.15, 0.3],
    );

    // Dodecagon outline
    const outerPath = outerPositions
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`)
      .join(' ') + ' Z';

    // All internal diagonals
    const diagonals: React.ReactNode[] = [];
    for (let i = 0; i < 12; i++) {
      for (let j = i + 2; j < 12; j++) {
        if (j === i + 11) continue; // skip adjacent (already in outline)
        const [x1, y1] = outerPositions[i];
        const [x2, y2] = outerPositions[j];
        // Highlight diagonals connected to active key
        const isActiveEdge = i === activeMajorIdx || j === activeMajorIdx;
        diagonals.push(
          <line
            key={`diag-${i}-${j}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={aurora.gold}
            strokeWidth={isActiveEdge ? 0.8 : 0.3}
            opacity={isActiveEdge ? lineOpacity * 1.5 : lineOpacity * 0.4}
          />,
        );
      }
    }

    return (
      <g>
        {diagonals}
        <path
          d={outerPath}
          fill="none"
          stroke={aurora.gold}
          strokeWidth={1}
          opacity={lineOpacity}
        />
      </g>
    );
  };

  // ── Layer 4: Hexagram (Star of David) — Minor Keys ──────────────────

  const renderHexagram = () => {
    const hexOpacity = interpolate(
      Math.sin(frame * 0.035 + 1),
      [-1, 1],
      [0.2, 0.45],
    );

    // Triangle 1: indices 0, 4, 8
    const tri1 = [0, 4, 8].map((i) => middlePositions[i]);
    // Triangle 2: indices 2, 6, 10
    const tri2 = [2, 6, 10].map((i) => middlePositions[i]);

    const triPath = (pts: [number, number][]) =>
      `M${pts[0][0]},${pts[0][1]} L${pts[1][0]},${pts[1][1]} L${pts[2][0]},${pts[2][1]} Z`;

    // Fill active triangle section with aurora
    const activeTriFill =
      activeMinorIdx >= 0
        ? 'url(#cof2-aurora-fill)'
        : 'none';
    const isInTri1 = [0, 4, 8].includes(activeMinorIdx);
    const isInTri2 = [2, 6, 10].includes(activeMinorIdx);

    return (
      <g
        transform={`rotate(${hexagramRotation}, ${CX}, ${CY})`}
        opacity={hexOpacity}
      >
        <path
          d={triPath(tri1)}
          fill={isInTri1 && activeMode === 'minor' ? activeTriFill : 'none'}
          stroke={aurora.purple}
          strokeWidth={1.2}
          opacity={0.7}
        />
        <path
          d={triPath(tri2)}
          fill={isInTri2 && activeMode === 'minor' ? activeTriFill : 'none'}
          stroke={aurora.pink}
          strokeWidth={1.2}
          opacity={0.7}
        />
      </g>
    );
  };

  // ── Layer 5: Golden Spiral Curves ────────────────────────────────────

  const renderGoldenSpirals = () => {
    const spiralOpacity = interpolate(breathe, [0, 1], [0.1, 0.22]);

    // Connect adjacent keys with bezier arcs (approximating golden spiral segments)
    const curves: React.ReactNode[] = [];
    for (let i = 0; i < 12; i++) {
      const next = (i + 1) % 12;
      const [x1, y1] = outerPositions[i];
      const [x2, y2] = outerPositions[next];

      // Control point pulled inward and rotated to create spiral feel
      const midAngle = (angleDeg(i) + angleDeg(next)) / 2 * (Math.PI / 180);
      const cpR = OUTER_R * 0.6;
      const cpx = CX + cpR * Math.cos(midAngle);
      const cpy = CY + cpR * Math.sin(midAngle);

      const isActive =
        activeMajorIdx === i || activeMajorIdx === next;

      curves.push(
        <path
          key={`spiral-${i}`}
          d={`M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`}
          fill="none"
          stroke={aurora.gold}
          strokeWidth={isActive ? 1.2 : 0.5}
          opacity={isActive ? spiralOpacity * 2 : spiralOpacity}
        />,
      );
    }
    return <g>{curves}</g>;
  };

  // ── Layer 6: Active Key Geometry Fill ────────────────────────────────

  const renderActiveGeometry = () => {
    if (activeMajorIdx < 0 && activeMinorIdx < 0) return null;

    const idx = activeMode === 'major' ? activeMajorIdx : activeMinorIdx;
    if (idx < 0) return null;

    const positions = activeMode === 'major' ? outerPositions : middlePositions;
    const [ax, ay] = positions[idx];

    // Pentagon formed by the active node and its 4 nearest neighbors
    const neighbors = [-2, -1, 0, 1, 2].map(
      (d) => positions[(idx + d + 12) % 12],
    );
    const pentPath = neighbors
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`)
      .join(' ') + ' Z';

    const activePulse = spring({
      frame,
      fps,
      config: { damping: 20, stiffness: 80, mass: 0.8 },
    });

    return (
      <g opacity={activePulse * 0.5}>
        {/* Pentagon fill */}
        <path
          d={pentPath}
          fill="url(#cof2-aurora-fill)"
          stroke={aurora.cyan}
          strokeWidth={0.5}
          opacity={0.3}
        />
        {/* Radiating glow from active node */}
        <circle
          cx={ax}
          cy={ay}
          r={50 + breathe * 20}
          fill="url(#cof2-active-glow)"
          opacity={0.4 + breathe * 0.2}
        />
      </g>
    );
  };

  // ── Layer 7: Pathfinder Particles ────────────────────────────────────

  const renderPathfinder = () => {
    if (pathfinderEdges.length === 0) return null;

    // Total path length for animation timing
    const totalEdges = pathfinderEdges.length;
    const progress = (frame % (totalEdges * 30)) / (totalEdges * 30);

    const particles: React.ReactNode[] = [];
    const trailCount = 8;

    for (let t = 0; t < trailCount; t++) {
      const offset = t / trailCount;
      const p = ((progress + offset) % 1) * totalEdges;
      const edgeIdx = Math.floor(p) % totalEdges;
      const edgeFrac = p - Math.floor(p);

      const edge = pathfinderEdges[edgeIdx];
      if (!edge) continue;

      const x = lerp(edge.from[0], edge.to[0], edgeFrac);
      const y = lerp(edge.from[1], edge.to[1], edgeFrac);
      const alpha = 1 - t / trailCount;

      particles.push(
        <circle
          key={`pf-${t}`}
          cx={x}
          cy={y}
          r={3 - t * 0.3}
          fill={aurora.cyan}
          opacity={alpha * 0.9}
        />,
      );
    }

    // Draw the path edges
    const pathLines = pathfinderEdges.map((edge, i) => (
      <line
        key={`pf-edge-${i}`}
        x1={edge.from[0]}
        y1={edge.from[1]}
        x2={edge.to[0]}
        y2={edge.to[1]}
        stroke="url(#cof2-pathfinder)"
        strokeWidth={2}
        opacity={0.5 + Math.sin(frame * 0.05 + i) * 0.2}
        strokeDasharray="6 4"
        strokeDashoffset={-frame * 0.5}
      />
    ));

    return (
      <g>
        {pathLines}
        <g filter="url(#cof2-glow-strong)">{particles}</g>
      </g>
    );
  };

  // ── Layer 8: Ring Nodes ──────────────────────────────────────────────

  const renderNode = (
    x: number,
    y: number,
    label: string,
    radius: number,
    isActive: boolean,
    isHighlighted: boolean,
    ringColor: string,
    key: string,
    isPlayed: boolean = false,
  ) => {
    const effectiveRadius = isPlayed && !isActive ? radius + 3 : radius;
    const glowR = effectiveRadius + 8 + (isActive ? breathe * 6 : 0);
    const borderOpacity = isActive ? 0.9 : isPlayed ? 0.7 : isHighlighted ? 0.6 : 0.25;
    const labelSize = radius > 24 ? 13 : radius > 20 ? 11 : 9;

    return (
      <g key={key}>
        {/* Outer glow for active/highlighted/played — cheap double-ring instead of blur */}
        {(isActive || isHighlighted || isPlayed) && (
          <>
            <circle
              cx={x}
              cy={y}
              r={glowR + 6}
              fill="none"
              stroke={isActive ? aurora.cyan : isPlayed ? aurora.teal : ringColor}
              strokeWidth={isActive ? 1 : 0.5}
              opacity={isActive ? 0.2 + breathe * 0.1 : isPlayed ? 0.15 : 0.1}
            />
            <circle
              cx={x}
              cy={y}
              r={glowR}
              fill="none"
              stroke={isActive ? aurora.cyan : isPlayed ? aurora.teal : ringColor}
              strokeWidth={isActive ? 2 : isPlayed ? 1.5 : 1}
              opacity={isActive ? 0.7 + breathe * 0.3 : isPlayed ? 0.5 : 0.4}
            />
          </>
        )}
        {/* Glass circle */}
        <circle
          cx={x}
          cy={y}
          r={effectiveRadius}
          fill="url(#cof2-glass)"
          stroke={isActive ? aurora.cyan : ringColor}
          strokeWidth={isActive ? 2 : 1}
          opacity={borderOpacity}
        />
        {/* Inner glass highlight */}
        <circle
          cx={x - radius * 0.2}
          cy={y - radius * 0.25}
          r={radius * 0.45}
          fill="rgba(255,255,255,0.08)"
        />
        {/* Label */}
        <text
          x={x}
          y={y + 1}
          textAnchor="middle"
          dominantBaseline="central"
          fill={isActive ? '#ffffff' : isPlayed ? aurora.teal : aurora.text}
          fontSize={labelSize}
          fontFamily="Georgia, 'Times New Roman', serif"
          fontWeight={isActive ? 700 : isPlayed ? 600 : 400}
          opacity={isActive ? 1 : isPlayed ? 0.9 : 0.85}
        >
          {label}
        </text>
      </g>
    );
  };

  const renderOuterRing = () =>
    MAJOR_KEYS.map((key, i) => {
      const [x, y] = outerPositions[i];
      const isActive =
        activeMode === 'major' && activeMajorIdx === i;
      const isHighlighted = highlightedDegrees.includes(i);
      return renderNode(
        x, y, key, NODE_R_OUTER,
        isActive, isHighlighted,
        aurora.gold,
        `outer-${i}`,
        playedIndices.has(i),
      );
    });

  const renderMiddleRing = () =>
    MINOR_KEYS.map((key, i) => {
      const [x, y] = middlePositions[i];
      const isDetectedMinor = detectedRing.ring === 'minor' && detectedRing.index === i;
      const isActive =
        (activeMode === 'minor' && activeMinorIdx === i) || isDetectedMinor;
      const isHighlighted = highlightedDegrees.includes(i) || isDetectedMinor;
      const nodeRadius = isDetectedMinor ? NODE_R_MIDDLE + 4 : NODE_R_MIDDLE;
      const ringColor = isDetectedMinor ? aurora.pink : aurora.purple;
      return (
        <g key={`middle-${i}`}>
          {isDetectedMinor && (
            <>
              {/* Pulsing glow behind detected minor node */}
              <circle
                cx={x} cy={y}
                r={nodeRadius + 16 + breathe * 8}
                fill={aurora.pink}
                opacity={0.08 + breathe * 0.06}
              />
              <circle
                cx={x} cy={y}
                r={nodeRadius + 10 + breathe * 4}
                fill={aurora.pink}
                opacity={0.12 + breathe * 0.08}
              />
            </>
          )}
          {renderNode(
            x, y, key, nodeRadius,
            isActive, isHighlighted,
            ringColor,
            `middle-node-${i}`,
            false,
          )}
        </g>
      );
    });

  const renderInnerRing = () =>
    DIM_KEYS.map((key, i) => {
      const [x, y] = innerPositions[i];
      const isDetectedDim = detectedRing.ring === 'dim' && detectedRing.index === i;
      const isActive = isDetectedDim;
      const isHighlighted = highlightedDegrees.includes(i) || isDetectedDim;
      const nodeRadius = isDetectedDim ? NODE_R_INNER + 4 : NODE_R_INNER;
      const ringColor = isDetectedDim ? aurora.gold : aurora.pink;
      return (
        <g key={`inner-${i}`}>
          {isDetectedDim && (
            <>
              {/* Outer glow halo for detected dim node */}
              <circle
                cx={x} cy={y}
                r={nodeRadius + 18 + breathe * 10}
                fill={aurora.gold}
                opacity={0.06 + breathe * 0.04}
              />
              <circle
                cx={x} cy={y}
                r={nodeRadius + 12 + breathe * 6}
                fill={aurora.gold}
                opacity={0.1 + breathe * 0.08}
              />
              {/* Inner accent ring */}
              <circle
                cx={x} cy={y}
                r={nodeRadius + 6}
                fill="none"
                stroke={aurora.gold}
                strokeWidth={1.5}
                opacity={0.5 + breathe * 0.3}
              />
            </>
          )}
          {renderNode(
            x, y, key, nodeRadius,
            isActive, isHighlighted,
            ringColor,
            `inner-node-${i}`,
            false,
          )}
        </g>
      );
    });

  // ── Layer 9: Ring Connection Lines ───────────────────────────────────

  const renderRingConnections = () => {
    // Connect each major key to its relative minor and diminished
    const lineOpacity = interpolate(breathe, [0, 1], [0.06, 0.12]);
    const connections: React.ReactNode[] = [];

    for (let i = 0; i < 12; i++) {
      const [ox, oy] = outerPositions[i];
      const [mx, my] = middlePositions[i];
      const [ix, iy] = innerPositions[i];

      connections.push(
        <line
          key={`conn-om-${i}`}
          x1={ox} y1={oy} x2={mx} y2={my}
          stroke={aurora.gold}
          strokeWidth={0.4}
          opacity={lineOpacity}
        />,
        <line
          key={`conn-mi-${i}`}
          x1={mx} y1={my} x2={ix} y2={iy}
          stroke={aurora.purple}
          strokeWidth={0.3}
          opacity={lineOpacity * 0.8}
        />,
      );
    }
    return <g>{connections}</g>;
  };

  // ── Layer 10: Detected Chord Label ───────────────────────────────────

  const renderChordLabel = () => {
    if (!detectedChord) return null;
    const chordOpacity = spring({
      frame,
      fps,
      config: { damping: 15, stiffness: 60, mass: 1 },
    });

    return (
      <g opacity={chordOpacity}>
        <text
          x={CX}
          y={CY - 12}
          textAnchor="middle"
          dominantBaseline="central"
          fill={aurora.cyan}
          fontSize={22}
          fontFamily="Georgia, 'Times New Roman', serif"
          fontWeight={700}
        >
          {detectedChord}
        </text>
        <text
          x={CX}
          y={CY + 14}
          textAnchor="middle"
          dominantBaseline="central"
          fill={aurora.textDim}
          fontSize={11}
          fontFamily="Georgia, 'Times New Roman', serif"
        >
          {activeKey} {activeMode}
        </text>
      </g>
    );
  };

  // ── Layer 11: Chord Progression Trail ────────────────────────────────

  const renderProgression = () => {
    if (!chordProgression || chordProgression.length === 0) return null;

    const recent = chordProgression.slice(-8);
    const progY = H - 40;
    const startX = CX - (recent.length - 1) * 30;

    return (
      <g>
        {recent.map((chord, i) => {
          const alpha = interpolate(i, [0, recent.length - 1], [0.3, 1]);
          return (
            <text
              key={`prog-${i}`}
              x={startX + i * 60}
              y={progY}
              textAnchor="middle"
              fill={aurora.text}
              fontSize={12}
              fontFamily="Georgia, 'Times New Roman', serif"
              opacity={alpha}
            >
              {chord}
            </text>
          );
        })}
        {/* Connecting dots */}
        {recent.slice(0, -1).map((_, i) => (
          <circle
            key={`prog-dot-${i}`}
            cx={startX + i * 60 + 30}
            cy={progY}
            r={1.5}
            fill={aurora.textDim}
            opacity={0.4}
          />
        ))}
      </g>
    );
  };

  // ── Layer 12: Active Notes Particles ─────────────────────────────────

  const renderActiveNoteParticles = () => {
    if (!activeNotes || activeNotes.length === 0) return null;

    return (
      <g>
        {activeNotes.map((note, i) => {
          // Map MIDI note to position around the circle
          const noteClass = note % 12;
          // Map chromatic note to circle-of-fifths position
          const cofMapping = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
          const cofIdx = cofMapping[noteClass];
          if (cofIdx === undefined) return null;

          const [nx, ny] = outerPositions[cofIdx];
          const particlePhase = frame * 0.08 + i * 0.7;
          const px = nx + Math.cos(particlePhase) * 15;
          const py = ny + Math.sin(particlePhase) * 15;
          const pr = 2 + Math.sin(frame * 0.1 + i) * 1;

          return (
            <g key={`note-p-${i}`}>
              {/* Cheap fake glow: larger low-opacity circle behind */}
              <circle
                cx={px}
                cy={py}
                r={pr + 4}
                fill={aurora.cyan}
                opacity={0.15}
              />
              <circle
                cx={px}
                cy={py}
                r={pr}
                fill={aurora.cyan}
                opacity={0.75}
              />
            </g>
          );
        })}
      </g>
    );
  };

  // ── Layer 13: Shooting Stars (Easter Egg) ────────────────────────────

  const renderShootingStars = () => {
    const rng = seededRandom(frame * 0.01 | 0);
    // One shooting star every ~120 frames
    if (frame % 120 > 5) return null;

    const t = (frame % 120) / 5;
    const sx = rng() * W * 0.6 + W * 0.1;
    const sy = rng() * H * 0.3;
    const angle = rng() * 0.4 + 0.3;
    const len = 80 + rng() * 60;

    const ex = sx + Math.cos(angle) * len * t;
    const ey = sy + Math.sin(angle) * len * t;
    const alpha = 1 - t;

    return (
      <line
        x1={ex}
        y1={ey}
        x2={ex - Math.cos(angle) * 30}
        y2={ey - Math.sin(angle) * 30}
        stroke={aurora.cyan}
        strokeWidth={2}
        opacity={alpha * 0.85}
        strokeLinecap="round"
      />
    );
  };

  // ── Layer 14: Aurora Glow Behind Active Region ───────────────────────

  const renderAuroraGlow = () => {
    if (activeMajorIdx < 0 && activeMinorIdx < 0) return null;

    const idx = activeMode === 'major' ? activeMajorIdx : activeMinorIdx;
    if (idx < 0) return null;

    const positions = activeMode === 'major' ? outerPositions : middlePositions;
    const [ax, ay] = positions[idx];

    return (
      <g opacity={0.15 + breathe * 0.1}>
        {/* Large diffuse aurora behind active region */}
        <ellipse
          cx={ax}
          cy={ay}
          rx={120 + breathe * 30}
          ry={90 + breathe * 20}
          fill={aurora.teal}
          opacity={0.08}
          filter="url(#cof2-glow-soft)"
        />
        <ellipse
          cx={ax + 20}
          cy={ay - 15}
          rx={80 + breathe * 20}
          ry={60 + breathe * 15}
          fill={aurora.purple}
          opacity={0.1}
        />
      </g>
    );
  };

  // ── Compose ──────────────────────────────────────────────────────────

  return (
    <AbsoluteFill
      style={{
        backgroundColor: aurora.bg,
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox={zoom.viewBox}
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0 }}
      >
        {renderDefs()}

        {/* Background aurora radial */}
        <circle
          cx={CX}
          cy={CY}
          r={450}
          fill="url(#cof2-aurora-radial)"
        />

        {/* Background stars */}
        {renderStars()}

        {/* Shooting stars */}
        {renderShootingStars()}

        {/* Sacred geometry layers (back to front) */}
        {renderMandala()}
        {renderFlowerOfLife()}
        {renderDodecagon()}
        {renderGoldenSpirals()}
        {renderHexagram()}

        {/* Active key geometry highlight */}
        {renderAuroraGlow()}
        {renderActiveGeometry()}

        {/* Ring connections */}
        {renderRingConnections()}

        {/* Pathfinder */}
        {renderPathfinder()}

        {/* Nodes (front) */}
        {renderInnerRing()}
        {renderMiddleRing()}
        {renderOuterRing()}

        {/* Active note particles */}
        {renderActiveNoteParticles()}

        {/* Center label */}
        {renderChordLabel()}

        {/* Progression trail */}
        {renderProgression()}

        {/* ── Chord keyboards: crossfade between adjacent and diatonic ── */}
        {zoom.primaryPlayedIdx >= 0 && zoom.zoomProgress > 0.01 && (
          <AdjacentChordsPanel
            anchorX={posOnRing(zoom.primaryPlayedIdx, OUTER_R)[0]}
            anchorY={posOnRing(zoom.primaryPlayedIdx, OUTER_R)[1]}
            playedIndex={zoom.primaryPlayedIdx}
            accentColor="#67e8f9"
            secondaryColor="#a78bfa"
            textColor="#e2e8f0"
            textDimColor="#94a3b8"
            opacity={zoom.zoomProgress}
          />
        )}
        {zoom.zoomProgress < 0.99 && (
          <DiatonicChordsPanel
            x={1660}
            y={120}
            activeKey={activeKey}
            activeMode={activeMode}
            accentColor="#67e8f9"
            secondaryColor="#a78bfa"
            textColor="#e2e8f0"
            textDimColor="#94a3b8"
            kbWidth={130}
            kbHeight={38}
            spacing={68}
            opacity={0.85 * (1 - zoom.zoomProgress)}
          />
        )}
      </svg>
    </AbsoluteFill>
  );
};
