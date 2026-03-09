import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from 'remotion';
import { DiatonicChordsPanel } from './MiniKeyboard';

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
const CX = 960;
const CY = 540;

const MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINOR_KEYS = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];
const DIM_KEYS = ['Bdim', 'F#dim', 'C#dim', 'G#dim', 'D#dim', 'A#dim', 'Fdim', 'Cdim', 'Gdim', 'Ddim', 'Adim', 'Edim'];

const R_OUTER = 320;
const R_MIDDLE = 240;
const R_INNER = 160;

const ENHARMONIC: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'Gb': 'F#',
  'Cb': 'B', 'Fb': 'E', 'B#': 'C', 'E#': 'F',
};

const jewel = {
  bg: '#0a0a12',
  gold: '#fbbf24',
  goldDark: '#d4a017',
  purple: '#7c3aed',
  purpleDark: '#6d28d9',
  emerald: '#059669',
  emeraldLight: '#10b981',
  ruby: '#dc2626',
  rubyLight: '#ef4444',
  sapphire: '#2563eb',
  sapphireLight: '#3b82f6',
  amber: '#f59e0b',
  rose: '#e11d48',
  text: '#f1f5f9',
  textDim: '#94a3b8',
};

// ── Utilities ──────────────────────────────────────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function normalizeNote(n: string): string {
  return ENHARMONIC[n] ?? n;
}

function extractRoot(chord: string): string {
  if (!chord) return '';
  const m = chord.match(/^([A-G][#b]?)/);
  return m ? normalizeNote(m[1]) : '';
}

function keyIndex(key: string): number {
  const root = extractRoot(key);
  const idx = MAJOR_KEYS.indexOf(root);
  if (idx >= 0) return idx;
  const normKey = normalizeNote(root);
  return MAJOR_KEYS.indexOf(normKey);
}

function polarToCart(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function nodeAngle(i: number): number {
  return (i * 360) / 12;
}

function hexColor(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lerpColor(a: string, b: string, t: number): string {
  const ra = parseInt(a.slice(1, 3), 16), ga = parseInt(a.slice(3, 5), 16), ba = parseInt(a.slice(5, 7), 16);
  const rb = parseInt(b.slice(1, 3), 16), gb = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ra + (rb - ra) * t);
  const g = Math.round(ga + (gb - ga) * t);
  const bl = Math.round(ba + (bb - ba) * t);
  return `rgb(${r},${g},${bl})`;
}

// ── Background Noise ───────────────────────────────────────────────────────

interface NoiseDot {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

function generateNoiseDots(count: number): NoiseDot[] {
  const rand = seededRandom(777);
  const dots: NoiseDot[] = [];
  for (let i = 0; i < count; i++) {
    dots.push({
      x: rand() * W,
      y: rand() * H,
      r: rand() * 1.2 + 0.3,
      opacity: rand() * 0.15 + 0.03,
    });
  }
  return dots;
}

// ── Stained Glass Sections ─────────────────────────────────────────────────

interface GlassSection {
  points: [number, number][];
  color: string;
  baseOpacity: number;
  ringIndex: number; // 0=outer, 1=middle, 2=inner for ripple
}

function generateGlassSections(): GlassSection[] {
  const sections: GlassSection[] = [];
  const rand = seededRandom(314);
  const colors = [jewel.sapphire, jewel.purple, jewel.emerald, jewel.gold, jewel.ruby, jewel.amber, jewel.rose, jewel.purpleDark];

  // Sections between outer and middle rings
  for (let i = 0; i < 12; i++) {
    const a1 = nodeAngle(i);
    const a2 = nodeAngle((i + 1) % 12);
    const [ox1, oy1] = polarToCart(CX, CY, R_OUTER, a1);
    const [ox2, oy2] = polarToCart(CX, CY, R_OUTER, a2);
    const [mx1, my1] = polarToCart(CX, CY, R_MIDDLE, a1);
    const [mx2, my2] = polarToCart(CX, CY, R_MIDDLE, a2);
    sections.push({
      points: [[ox1, oy1], [ox2, oy2], [mx2, my2], [mx1, my1]],
      color: colors[Math.floor(rand() * colors.length)],
      baseOpacity: 0.06 + rand() * 0.06,
      ringIndex: 0,
    });
  }

  // Sections between middle and inner rings
  for (let i = 0; i < 12; i++) {
    const a1 = nodeAngle(i);
    const a2 = nodeAngle((i + 1) % 12);
    const [mx1, my1] = polarToCart(CX, CY, R_MIDDLE, a1);
    const [mx2, my2] = polarToCart(CX, CY, R_MIDDLE, a2);
    const [ix1, iy1] = polarToCart(CX, CY, R_INNER, a1);
    const [ix2, iy2] = polarToCart(CX, CY, R_INNER, a2);
    sections.push({
      points: [[mx1, my1], [mx2, my2], [ix2, iy2], [ix1, iy1]],
      color: colors[Math.floor(rand() * colors.length)],
      baseOpacity: 0.07 + rand() * 0.07,
      ringIndex: 1,
    });
  }

  // Triangular sections inside inner ring (center star)
  for (let i = 0; i < 12; i++) {
    const a1 = nodeAngle(i);
    const a2 = nodeAngle((i + 1) % 12);
    const [ix1, iy1] = polarToCart(CX, CY, R_INNER, a1);
    const [ix2, iy2] = polarToCart(CX, CY, R_INNER, a2);
    sections.push({
      points: [[CX, CY], [ix1, iy1], [ix2, iy2]],
      color: colors[Math.floor(rand() * colors.length)],
      baseOpacity: 0.05 + rand() * 0.05,
      ringIndex: 2,
    });
  }

  return sections;
}

// ── Flower of Life Arcs ────────────────────────────────────────────────────

interface FlowerArc {
  cx: number;
  cy: number;
  r: number;
  index: number;
}

function generateFlowerOfLife(): FlowerArc[] {
  const arcs: FlowerArc[] = [];
  const flowerR = 80;

  // Center circle
  arcs.push({ cx: CX, cy: CY, r: flowerR, index: 0 });

  // First ring — 6 circles
  for (let i = 0; i < 6; i++) {
    const angle = (i * 60) * Math.PI / 180;
    arcs.push({
      cx: CX + flowerR * Math.cos(angle),
      cy: CY + flowerR * Math.sin(angle),
      r: flowerR,
      index: i + 1,
    });
  }

  // Second ring — 12 circles
  for (let i = 0; i < 12; i++) {
    const angle = (i * 30 + 15) * Math.PI / 180;
    arcs.push({
      cx: CX + flowerR * 1.73 * Math.cos(angle),
      cy: CY + flowerR * 1.73 * Math.sin(angle),
      r: flowerR,
      index: i + 7,
    });
  }

  return arcs;
}

// ── Golden Spiral Points ───────────────────────────────────────────────────

function goldenSpiralPoints(startAngle: number, turns: number, steps: number): [number, number][] {
  const phi = 1.618033988749;
  const pts: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const angle = startAngle + t * turns * Math.PI * 2;
    const r = 30 * Math.pow(phi, t * turns * 0.7);
    if (r > 400) break;
    pts.push([CX + r * Math.cos(angle), CY + r * Math.sin(angle)]);
  }
  return pts;
}

// ── Spiral Particles ───────────────────────────────────────────────────────

interface SpiralParticle {
  spiralIndex: number;
  t: number;
  size: number;
  brightness: number;
}

function generateSpiralParticles(count: number): SpiralParticle[] {
  const rand = seededRandom(2718);
  const particles: SpiralParticle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      spiralIndex: Math.floor(rand() * 4),
      t: rand(),
      size: rand() * 2 + 0.8,
      brightness: rand() * 0.6 + 0.3,
    });
  }
  return particles;
}

// ── Component ──────────────────────────────────────────────────────────────

export const CircleOfFifths4: React.FC<CircleOfFifthsProps> = ({
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

  // ── Derived state ──
  const activeRoot = useMemo(() => extractRoot(activeKey), [activeKey]);
  const activeIdx = useMemo(() => keyIndex(activeKey), [activeKey]);
  const playedIndices = useMemo(
    () => new Set(activeNotes.map((n) => ((n % 12) * 7) % 12)),
    [activeNotes],
  );
  const chordRoot = useMemo(() => extractRoot(detectedChord ?? ''), [detectedChord]);
  const chordIdx = useMemo(() => keyIndex(detectedChord ?? ''), [detectedChord]);

  const pathfinderFromIdx = useMemo(() => (pathfinderFrom ? keyIndex(pathfinderFrom) : -1), [pathfinderFrom]);
  const pathfinderToIdx = useMemo(() => (pathfinderTo ? keyIndex(pathfinderTo) : -1), [pathfinderTo]);
  const pathfinderEdges = useMemo(() => {
    if (!pathfinderPaths || pathfinderPaths.length === 0) return new Set<string>();
    const edges = new Set<string>();
    for (const path of pathfinderPaths) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = keyIndex(path[i]);
        const b = keyIndex(path[i + 1]);
        if (a >= 0 && b >= 0) {
          edges.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
        }
      }
    }
    return edges;
  }, [pathfinderPaths]);

  // ── Static geometry ──
  const noiseDots = useMemo(() => generateNoiseDots(600), []);
  const glassSections = useMemo(() => generateGlassSections(), []);
  const flowerArcs = useMemo(() => generateFlowerOfLife(), []);
  const spirals = useMemo(() => {
    return [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((startAngle) =>
      goldenSpiralPoints(startAngle, 3, 200)
    );
  }, []);
  const spiralParticles = useMemo(() => generateSpiralParticles(80), []);

  // ── Multi-layer rotations ──
  const rotDodecagon = frame * 0.05;
  const rotHexagram = frame * -0.03;
  const rotPentagons = frame * 0.02;
  const rotInnerMandala = frame * 0.08;
  const rotNodes = frame * -0.04;

  // ── Ripple from active key ──
  const ripplePhase = (frame % 120) / 120; // 0..1 repeating every 120 frames
  const rippleRadius = ripplePhase * 500;

  // ── Helper: is key active ──
  const isKeyActive = (idx: number) => idx === activeIdx && idx >= 0;
  const isChordActive = (idx: number) => idx === chordIdx && idx >= 0;

  // ── Node positions (unrotated) ──
  const outerNodes = useMemo(() => MAJOR_KEYS.map((_, i) => polarToCart(CX, CY, R_OUTER, nodeAngle(i))), []);
  const middleNodes = useMemo(() => MINOR_KEYS.map((_, i) => polarToCart(CX, CY, R_MIDDLE, nodeAngle(i))), []);
  const innerNodes = useMemo(() => DIM_KEYS.map((_, i) => polarToCart(CX, CY, R_INNER, nodeAngle(i))), []);

  // ── Hexagram triangles (indices) ──
  const hexTriA = [0, 2, 4, 6, 8, 10]; // even indices
  const hexTriB = [1, 3, 5, 7, 9, 11]; // odd indices

  // ── Pentagon patterns (interval of 5) ──
  const pentA = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7]; // cycle through fifths of fifths
  const pentPatterns = useMemo(() => {
    const patterns: number[][] = [];
    for (let start = 0; start < 12; start += 3) {
      const p: number[] = [];
      for (let j = 0; j < 5; j++) {
        p.push((start + j * 5) % 12);
      }
      patterns.push(p);
    }
    return patterns;
  }, []);

  // ── Render helpers ──

  const renderNoise = () => (
    <g>
      {noiseDots.map((dot, i) => (
        <circle
          key={`noise-${i}`}
          cx={dot.x}
          cy={dot.y}
          r={dot.r}
          fill={jewel.text}
          opacity={dot.opacity * (0.8 + 0.2 * Math.sin(frame * 0.02 + i * 0.5))}
        />
      ))}
    </g>
  );

  const renderConcentricRings = () => {
    const radii = [R_OUTER + 40, R_OUTER, R_OUTER - 20, R_MIDDLE + 20, R_MIDDLE, R_MIDDLE - 15, R_INNER + 15, R_INNER, R_INNER - 10, 60, 30];
    return (
      <g>
        {radii.map((r, i) => {
          const dist = Math.abs(r - R_OUTER);
          const rippleHit = Math.abs(rippleRadius - dist) < 30;
          const baseOp = i % 2 === 0 ? 0.12 : 0.06;
          const opacity = rippleHit ? Math.min(baseOp + 0.25, 0.5) : baseOp;
          return (
            <circle
              key={`ring-${i}`}
              cx={CX}
              cy={CY}
              r={r}
              fill="none"
              stroke={rippleHit ? jewel.gold : jewel.goldDark}
              strokeWidth={i === 1 || i === 4 || i === 7 ? 1.5 : 0.6}
              opacity={opacity}
            />
          );
        })}
      </g>
    );
  };

  const renderGlassSections = () => (
    <g>
      {glassSections.map((section, i) => {
        const pts = section.points.map((p) => p.join(',')).join(' ');
        const centroid = section.points.reduce(
          (acc, p) => [acc[0] + p[0] / section.points.length, acc[1] + p[1] / section.points.length],
          [0, 0]
        );
        const distFromCenter = Math.sqrt((centroid[0] - CX) ** 2 + (centroid[1] - CY) ** 2);
        const rippleHit = Math.abs(rippleRadius - distFromCenter) < 50;

        // Slow hue shift
        const hueShift = Math.sin(frame * 0.005 + i * 0.3) * 0.5 + 0.5;
        const shiftedColor = lerpColor(section.color, jewel.gold, hueShift * 0.15);

        // Active section glow
        const sectionIdx = i % 12;
        const isActive = isKeyActive(sectionIdx) || isChordActive(sectionIdx);

        const opacity = isActive
          ? section.baseOpacity + 0.2
          : rippleHit
            ? section.baseOpacity + 0.12
            : section.baseOpacity;

        return (
          <polygon
            key={`glass-${i}`}
            points={pts}
            fill={shiftedColor}
            opacity={opacity}
            stroke={hexColor(jewel.gold, 0.08)}
            strokeWidth={0.5}
          />
        );
      })}
    </g>
  );

  const renderDodecagon = () => {
    const pts = outerNodes.map((p) => p.join(',')).join(' ');
    return (
      <g transform={`rotate(${rotDodecagon}, ${CX}, ${CY})`}>
        <polygon
          points={pts}
          fill="none"
          stroke={jewel.gold}
          strokeWidth={1.2}
          opacity={0.35}
        />
        {/* Dodecagon diagonals — connect every node to node+4 and node+5 */}
        {outerNodes.map((p, i) => {
          const j4 = (i + 4) % 12;
          const j5 = (i + 5) % 12;
          const edgeKey4 = `${Math.min(i, j4)}-${Math.max(i, j4)}`;
          const edgeKey5 = `${Math.min(i, j5)}-${Math.max(i, j5)}`;
          const isPath4 = pathfinderEdges.has(edgeKey4);
          const isPath5 = pathfinderEdges.has(edgeKey5);
          return (
            <React.Fragment key={`dod-diag-${i}`}>
              <line
                x1={p[0]} y1={p[1]}
                x2={outerNodes[j4][0]} y2={outerNodes[j4][1]}
                stroke={isPath4 ? jewel.ruby : jewel.goldDark}
                strokeWidth={isPath4 ? 2.5 : 0.4}
                opacity={isPath4 ? 0.9 : 0.12}
              />
              {i < 6 && (
                <line
                  x1={p[0]} y1={p[1]}
                  x2={outerNodes[j5][0]} y2={outerNodes[j5][1]}
                  stroke={isPath5 ? jewel.ruby : jewel.goldDark}
                  strokeWidth={isPath5 ? 2.5 : 0.3}
                  opacity={isPath5 ? 0.9 : 0.08}
                />
              )}
            </React.Fragment>
          );
        })}
      </g>
    );
  };

  const renderHexagram = () => {
    const triApts = hexTriA.map((i) => outerNodes[i].join(',')).join(' ');
    const triBpts = hexTriB.map((i) => outerNodes[i].join(',')).join(' ');

    // Check if any triangle edges are pathfinder edges
    const triAEdges = hexTriA.map((_, idx) => {
      const a = hexTriA[idx];
      const b = hexTriA[(idx + 1) % hexTriA.length];
      return pathfinderEdges.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
    });
    const triBEdges = hexTriB.map((_, idx) => {
      const a = hexTriB[idx];
      const b = hexTriB[(idx + 1) % hexTriB.length];
      return pathfinderEdges.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
    });
    const anyAPath = triAEdges.some(Boolean);
    const anyBPath = triBEdges.some(Boolean);

    return (
      <g transform={`rotate(${rotHexagram}, ${CX}, ${CY})`}>
        <polygon
          points={triApts}
          fill="none"
          stroke={anyAPath ? jewel.rubyLight : jewel.purple}
          strokeWidth={anyAPath ? 2.5 : 1}
          opacity={anyAPath ? 0.85 : 0.3}
        />
        <polygon
          points={triBpts}
          fill="none"
          stroke={anyBPath ? jewel.rubyLight : jewel.purpleDark}
          strokeWidth={anyBPath ? 2.5 : 1}
          opacity={anyBPath ? 0.85 : 0.25}
        />
        {/* Inner hexagram — middle ring */}
        <polygon
          points={hexTriA.map((i) => middleNodes[i].join(',')).join(' ')}
          fill="none"
          stroke={jewel.purple}
          strokeWidth={0.6}
          opacity={0.2}
        />
        <polygon
          points={hexTriB.map((i) => middleNodes[i].join(',')).join(' ')}
          fill="none"
          stroke={jewel.purpleDark}
          strokeWidth={0.6}
          opacity={0.15}
        />
      </g>
    );
  };

  const renderPentagons = () => (
    <g transform={`rotate(${rotPentagons}, ${CX}, ${CY})`}>
      {pentPatterns.map((pattern, pi) => {
        const pts = pattern.map((i) => outerNodes[i].join(',')).join(' ');
        const hasPathEdge = pattern.some((idx, j) => {
          const next = pattern[(j + 1) % pattern.length];
          const ek = `${Math.min(idx, next)}-${Math.max(idx, next)}`;
          return pathfinderEdges.has(ek);
        });
        return (
          <polygon
            key={`pent-${pi}`}
            points={pts}
            fill="none"
            stroke={hasPathEdge ? jewel.rubyLight : jewel.emerald}
            strokeWidth={hasPathEdge ? 2 : 0.8}
            opacity={hasPathEdge ? 0.8 : 0.2}
          />
        );
      })}
      {/* Pentagon inner connections at middle ring */}
      {pentPatterns.map((pattern, pi) => {
        const pts = pattern.map((i) => middleNodes[i].join(',')).join(' ');
        return (
          <polygon
            key={`pent-mid-${pi}`}
            points={pts}
            fill="none"
            stroke={jewel.emeraldLight}
            strokeWidth={0.5}
            opacity={0.12}
          />
        );
      })}
    </g>
  );

  const renderFlowerOfLife = () => (
    <g opacity={0.15}>
      {flowerArcs.map((arc, i) => {
        const pulsePhase = (frame * 0.03 + i * 0.4) % (Math.PI * 2);
        const pulse = Math.sin(pulsePhase) * 0.5 + 0.5;
        return (
          <circle
            key={`flower-${i}`}
            cx={arc.cx}
            cy={arc.cy}
            r={arc.r}
            fill="none"
            stroke={jewel.gold}
            strokeWidth={0.6 + pulse * 0.4}
            opacity={0.3 + pulse * 0.3}
          />
        );
      })}
    </g>
  );

  const renderGoldenSpirals = () => (
    <g opacity={0.2}>
      {spirals.map((pts, si) => {
        if (pts.length < 2) return null;
        const d = pts.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ');
        const colors = [jewel.gold, jewel.sapphireLight, jewel.emeraldLight, jewel.amber];
        return (
          <path
            key={`spiral-${si}`}
            d={d}
            fill="none"
            stroke={colors[si]}
            strokeWidth={0.7}
            opacity={0.4}
            strokeDasharray="4 6"
            strokeDashoffset={-frame * 0.5}
          />
        );
      })}
    </g>
  );

  const renderSpiralParticles = () => (
    <g>
      {spiralParticles.map((particle, i) => {
        const spiral = spirals[particle.spiralIndex];
        if (!spiral || spiral.length < 2) return null;
        const progress = (particle.t + frame * 0.002) % 1;
        const idx = Math.floor(progress * (spiral.length - 1));
        const pt = spiral[Math.min(idx, spiral.length - 1)];
        const glow = Math.sin(frame * 0.05 + i) * 0.3 + 0.7;
        return (
          <circle
            key={`sp-${i}`}
            cx={pt[0]}
            cy={pt[1]}
            r={particle.size}
            fill={jewel.gold}
            opacity={particle.brightness * glow * 0.6}
          />
        );
      })}
    </g>
  );

  const renderInnerMandala = () => {
    // Star patterns inside the inner ring
    const starPoints: [number, number][] = [];
    for (let i = 0; i < 24; i++) {
      const angle = (i * 15) * Math.PI / 180;
      const r = i % 2 === 0 ? R_INNER - 20 : R_INNER * 0.4;
      starPoints.push([CX + r * Math.cos(angle), CY + r * Math.sin(angle)]);
    }
    const pts = starPoints.map((p) => p.join(',')).join(' ');

    // Inner star (12 points)
    const innerStar: [number, number][] = [];
    for (let i = 0; i < 24; i++) {
      const angle = (i * 15) * Math.PI / 180;
      const r = i % 2 === 0 ? 55 : 25;
      innerStar.push([CX + r * Math.cos(angle), CY + r * Math.sin(angle)]);
    }
    const innerPts = innerStar.map((p) => p.join(',')).join(' ');

    return (
      <g transform={`rotate(${rotInnerMandala}, ${CX}, ${CY})`}>
        <polygon
          points={pts}
          fill="none"
          stroke={jewel.gold}
          strokeWidth={0.8}
          opacity={0.25}
        />
        <polygon
          points={innerPts}
          fill={hexColor(jewel.gold, 0.04)}
          stroke={jewel.amber}
          strokeWidth={0.6}
          opacity={0.3}
        />
        {/* Cross lines through center */}
        {[0, 30, 60, 90, 120, 150].map((angle) => {
          const rad = (angle * Math.PI) / 180;
          return (
            <line
              key={`cross-${angle}`}
              x1={CX + R_INNER * 0.9 * Math.cos(rad)}
              y1={CY + R_INNER * 0.9 * Math.sin(rad)}
              x2={CX - R_INNER * 0.9 * Math.cos(rad)}
              y2={CY - R_INNER * 0.9 * Math.sin(rad)}
              stroke={jewel.goldDark}
              strokeWidth={0.4}
              opacity={0.15}
            />
          );
        })}
      </g>
    );
  };

  const renderOrnateNode = (
    x: number,
    y: number,
    label: string,
    type: 'major' | 'minor' | 'dim',
    idx: number,
    isActive: boolean,
    isChord: boolean,
    isPathEnd: boolean,
    isPlayed: boolean = false,
  ) => {
    const baseNodeR = type === 'major' ? 24 : type === 'minor' ? 19 : 15;
    const nodeR = isPlayed && !isActive && !isChord ? baseNodeR + 3 : baseNodeR;
    const fillColor = type === 'major' ? jewel.gold : type === 'minor' ? jewel.purple : jewel.emerald;
    const borderColor = type === 'major' ? jewel.goldDark : type === 'minor' ? jewel.purpleDark : jewel.emeraldLight;

    // Active glow animation
    const glowPulse = isActive ? Math.sin(frame * 0.1) * 0.3 + 0.7 : 0;
    const chordPulse = isChord ? Math.sin(frame * 0.15) * 0.2 + 0.8 : 0;

    // Ripple hit
    const dist = Math.sqrt((x - CX) ** 2 + (y - CY) ** 2);
    const rippleHit = Math.abs(rippleRadius - dist) < 25 && activeIdx >= 0;

    // Inner star rotation
    const innerStarRot = frame * 0.3 + idx * 30;

    // Inner 6-pointed star
    const innerStarPts: string[] = [];
    for (let i = 0; i < 12; i++) {
      const angle = (i * 30 + innerStarRot) * Math.PI / 180;
      const r = i % 2 === 0 ? nodeR * 0.55 : nodeR * 0.25;
      innerStarPts.push(`${x + r * Math.cos(angle)},${y + r * Math.sin(angle)}`);
    }

    const highlighted = highlightedDegrees.includes(idx);

    return (
      <g key={`node-${type}-${idx}`}>
        {/* Outer glow */}
        {(isActive || isChord || isPathEnd || isPlayed) && (
          <circle
            cx={x} cy={y}
            r={nodeR + 12}
            fill="none"
            stroke={isPathEnd ? jewel.rubyLight : isChord ? jewel.sapphireLight : isPlayed && !isActive ? jewel.sapphireLight : jewel.gold}
            strokeWidth={isPlayed && !isActive && !isChord ? 1.5 : 2}
            opacity={isPlayed && !isActive && !isChord ? 0.35 : 0.4 + glowPulse + chordPulse}
          />
        )}
        {/* Ripple ring */}
        {rippleHit && (
          <circle
            cx={x} cy={y}
            r={nodeR + 8}
            fill="none"
            stroke={jewel.gold}
            strokeWidth={1.5}
            opacity={0.5}
          />
        )}
        {/* Double border */}
        <circle
          cx={x} cy={y}
          r={nodeR + 3}
          fill="none"
          stroke={borderColor}
          strokeWidth={0.8}
          opacity={0.5}
        />
        {/* Main circle */}
        <circle
          cx={x} cy={y}
          r={nodeR}
          fill={isActive || isChord ? fillColor : isPlayed ? hexColor(fillColor, 0.5) : hexColor(fillColor, 0.2)}
          stroke={isActive || isChord || highlighted || isPlayed ? fillColor : borderColor}
          strokeWidth={isActive || isChord ? 2 : isPlayed ? 1.5 : 1}
          opacity={isActive || isChord ? 1 : isPlayed ? 0.9 : highlighted ? 0.85 : 0.7}
        />
        {/* Inner star pattern */}
        <polygon
          points={innerStarPts.join(' ')}
          fill="none"
          stroke={isActive || isChord ? '#fff' : borderColor}
          strokeWidth={0.5}
          opacity={isActive || isChord ? 0.7 : 0.3}
        />
        {/* Label */}
        <text
          x={x}
          y={y + (type === 'dim' ? 1 : 1.5)}
          textAnchor="middle"
          dominantBaseline="central"
          fill={isActive || isChord ? '#fff' : jewel.text}
          fontSize={type === 'major' ? 11 : type === 'minor' ? 9.5 : 7.5}
          fontFamily="'Georgia', serif"
          fontWeight={isActive || isChord ? 700 : 400}
          opacity={isActive || isChord ? 1 : 0.85}
        >
          {label}
        </text>
      </g>
    );
  };

  const renderNodes = () => (
    <g>
      {/* Outer ring — Major keys */}
      {MAJOR_KEYS.map((key, i) => {
        const [x, y] = outerNodes[i];
        const active = isKeyActive(i);
        const chord = isChordActive(i);
        const isPathEnd = i === pathfinderFromIdx || i === pathfinderToIdx;
        return renderOrnateNode(x, y, key, 'major', i, active, chord, isPathEnd, playedIndices.has(i));
      })}
      {/* Middle ring — Minor keys */}
      {MINOR_KEYS.map((key, i) => {
        const [x, y] = middleNodes[i];
        const active = activeMode === 'minor' && isKeyActive(i);
        return renderOrnateNode(x, y, key, 'minor', i, active, false, false, false);
      })}
      {/* Inner ring — Diminished */}
      {DIM_KEYS.map((key, i) => {
        const [x, y] = innerNodes[i];
        return renderOrnateNode(x, y, key, 'dim', i, false, false, false, false);
      })}
    </g>
  );

  const renderRelativeMinorConnections = () => (
    <g>
      {outerNodes.map((op, i) => {
        const mp = middleNodes[i];
        const active = isKeyActive(i);
        return (
          <line
            key={`rel-${i}`}
            x1={op[0]} y1={op[1]}
            x2={mp[0]} y2={mp[1]}
            stroke={active ? jewel.purple : jewel.purpleDark}
            strokeWidth={active ? 1.8 : 0.5}
            opacity={active ? 0.7 : 0.12}
            strokeDasharray={active ? 'none' : '2 4'}
          />
        );
      })}
    </g>
  );

  const renderMiddleToInnerConnections = () => (
    <g>
      {middleNodes.map((mp, i) => {
        const ip = innerNodes[i];
        return (
          <line
            key={`mid-inn-${i}`}
            x1={mp[0]} y1={mp[1]}
            x2={ip[0]} y2={ip[1]}
            stroke={jewel.emerald}
            strokeWidth={0.4}
            opacity={0.1}
            strokeDasharray="1 3"
          />
        );
      })}
    </g>
  );

  const renderFifthsConnections = () => {
    // Adjacent keys on the circle are a fifth apart
    return (
      <g>
        {outerNodes.map((p, i) => {
          const next = outerNodes[(i + 1) % 12];
          const edgeKey = `${Math.min(i, (i + 1) % 12)}-${Math.max(i, (i + 1) % 12)}`;
          const isPath = pathfinderEdges.has(edgeKey);
          const isAdjacentActive = isKeyActive(i) || isKeyActive((i + 1) % 12);
          return (
            <line
              key={`fifth-${i}`}
              x1={p[0]} y1={p[1]}
              x2={next[0]} y2={next[1]}
              stroke={isPath ? jewel.rubyLight : isAdjacentActive ? jewel.sapphireLight : jewel.sapphire}
              strokeWidth={isPath ? 3 : isAdjacentActive ? 1.5 : 0.6}
              opacity={isPath ? 0.9 : isAdjacentActive ? 0.5 : 0.15}
            />
          );
        })}
      </g>
    );
  };

  const renderPathfinderGlow = () => {
    if (pathfinderPaths.length === 0) return null;

    return (
      <g>
        {pathfinderPaths.map((path, pi) =>
          path.map((key, ki) => {
            if (ki >= path.length - 1) return null;
            const aIdx = keyIndex(key);
            const bIdx = keyIndex(path[ki + 1]);
            if (aIdx < 0 || bIdx < 0) return null;
            const a = outerNodes[aIdx];
            const b = outerNodes[bIdx];

            // Animated glow along path
            const progress = interpolate(
              (frame + ki * 10) % 60,
              [0, 60],
              [0, 1],
            );
            const midX = a[0] + (b[0] - a[0]) * progress;
            const midY = a[1] + (b[1] - a[1]) * progress;

            return (
              <React.Fragment key={`pf-${pi}-${ki}`}>
                <line
                  x1={a[0]} y1={a[1]}
                  x2={b[0]} y2={b[1]}
                  stroke={jewel.rubyLight}
                  strokeWidth={3}
                  opacity={0.7}
                />
                {/* Traveling glow particle */}
                <circle
                  cx={midX} cy={midY}
                  r={4}
                  fill={jewel.gold}
                  opacity={0.9}
                />
                <circle
                  cx={midX} cy={midY}
                  r={10}
                  fill="none"
                  stroke={jewel.gold}
                  strokeWidth={1}
                  opacity={0.4}
                />
              </React.Fragment>
            );
          })
        )}
      </g>
    );
  };

  const renderChordProgressionArc = () => {
    if (!chordProgression || chordProgression.length < 2) return null;

    return (
      <g>
        {chordProgression.map((chord, ci) => {
          if (ci >= chordProgression.length - 1) return null;
          const aIdx = keyIndex(chord);
          const bIdx = keyIndex(chordProgression[ci + 1]);
          if (aIdx < 0 || bIdx < 0) return null;
          const a = outerNodes[aIdx];
          const b = outerNodes[bIdx];

          // Bezier curve through center area
          const midAngle = (nodeAngle(aIdx) + nodeAngle(bIdx)) / 2;
          const [cpx, cpy] = polarToCart(CX, CY, R_MIDDLE * 0.5, midAngle);

          const opacity = interpolate(ci, [0, chordProgression.length - 1], [0.15, 0.5]);

          return (
            <path
              key={`prog-${ci}`}
              d={`M ${a[0]} ${a[1]} Q ${cpx} ${cpy} ${b[0]} ${b[1]}`}
              fill="none"
              stroke={jewel.amber}
              strokeWidth={1.2}
              opacity={opacity}
              strokeDasharray="3 3"
            />
          );
        })}
      </g>
    );
  };

  const renderActiveNoteMarkers = () => {
    if (!activeNotes || activeNotes.length === 0) return null;

    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    return (
      <g>
        {activeNotes.map((note, ni) => {
          const noteName = normalizeNote(noteNames[note % 12]);
          const idx = MAJOR_KEYS.indexOf(noteName);
          if (idx < 0) return null;
          const [x, y] = outerNodes[idx];
          const pulse = Math.sin(frame * 0.12 + ni * 1.2) * 0.3 + 0.7;

          return (
            <React.Fragment key={`an-${ni}`}>
              <circle
                cx={x} cy={y}
                r={32}
                fill="none"
                stroke={jewel.rubyLight}
                strokeWidth={2}
                opacity={pulse * 0.5}
              />
              <circle
                cx={x} cy={y}
                r={38}
                fill="none"
                stroke={jewel.ruby}
                strokeWidth={1}
                opacity={pulse * 0.25}
              />
            </React.Fragment>
          );
        })}
      </g>
    );
  };

  // ── Outer decorative arcs (beyond the outer ring) ──

  const renderOuterDecorations = () => {
    const decorR = R_OUTER + 60;
    const arcR = R_OUTER + 80;

    return (
      <g>
        {/* Outer scalloped arcs */}
        {Array.from({ length: 24 }).map((_, i) => {
          const angle = (i * 15) * Math.PI / 180;
          const r1 = decorR - 10;
          const r2 = decorR + 10;
          const a1 = i * 15 - 5;
          const a2 = i * 15 + 5;
          const [x1, y1] = polarToCart(CX, CY, r1, a1);
          const [x2, y2] = polarToCart(CX, CY, r2, (a1 + a2) / 2);
          const [x3, y3] = polarToCart(CX, CY, r1, a2);
          return (
            <path
              key={`scallop-${i}`}
              d={`M ${x1} ${y1} Q ${x2} ${y2} ${x3} ${y3}`}
              fill="none"
              stroke={jewel.goldDark}
              strokeWidth={0.6}
              opacity={0.2}
            />
          );
        })}

        {/* Radial tick marks */}
        {Array.from({ length: 72 }).map((_, i) => {
          const angle = i * 5;
          const isMajorTick = i % 6 === 0;
          const [x1, y1] = polarToCart(CX, CY, R_OUTER + 35, angle);
          const [x2, y2] = polarToCart(CX, CY, R_OUTER + (isMajorTick ? 55 : 45), angle);
          return (
            <line
              key={`tick-${i}`}
              x1={x1} y1={y1}
              x2={x2} y2={y2}
              stroke={jewel.goldDark}
              strokeWidth={isMajorTick ? 1 : 0.4}
              opacity={isMajorTick ? 0.3 : 0.12}
            />
          );
        })}

        {/* Corner ornaments */}
        {[
          [80, 80], [W - 80, 80], [80, H - 80], [W - 80, H - 80],
        ].map(([ox, oy], ci) => {
          const cornerStarPts: string[] = [];
          for (let i = 0; i < 16; i++) {
            const angle = (i * 22.5 + frame * 0.1) * Math.PI / 180;
            const r = i % 2 === 0 ? 30 : 12;
            cornerStarPts.push(`${ox + r * Math.cos(angle)},${oy + r * Math.sin(angle)}`);
          }
          return (
            <g key={`corner-${ci}`}>
              <polygon
                points={cornerStarPts.join(' ')}
                fill="none"
                stroke={jewel.goldDark}
                strokeWidth={0.6}
                opacity={0.2}
              />
              <circle cx={ox} cy={oy} r={5} fill={jewel.goldDark} opacity={0.15} />
              <circle cx={ox} cy={oy} r={35} fill="none" stroke={jewel.goldDark} strokeWidth={0.4} opacity={0.1} />
            </g>
          );
        })}

        {/* Edge filigree — top and bottom */}
        {Array.from({ length: 20 }).map((_, i) => {
          const x = 100 + i * ((W - 200) / 19);
          const amp = Math.sin(i * 0.8 + frame * 0.02) * 8;
          return (
            <React.Fragment key={`filigree-${i}`}>
              <circle cx={x} cy={20 + amp} r={2} fill={jewel.goldDark} opacity={0.12} />
              <circle cx={x} cy={H - 20 - amp} r={2} fill={jewel.goldDark} opacity={0.12} />
            </React.Fragment>
          );
        })}
      </g>
    );
  };

  // ── Border frame ──

  const renderBorderFrame = () => (
    <g>
      {/* Outer frame */}
      <rect x={10} y={10} width={W - 20} height={H - 20} rx={4} fill="none" stroke={jewel.goldDark} strokeWidth={1} opacity={0.2} />
      <rect x={18} y={18} width={W - 36} height={H - 36} rx={2} fill="none" stroke={jewel.goldDark} strokeWidth={0.5} opacity={0.12} />

      {/* Corner brackets */}
      {[
        [15, 15, 50, 0, 0, 50],
        [W - 15, 15, -50, 0, 0, 50],
        [15, H - 15, 50, 0, 0, -50],
        [W - 15, H - 15, -50, 0, 0, -50],
      ].map(([x, y, dx1, dy1, dx2, dy2], i) => (
        <path
          key={`bracket-${i}`}
          d={`M ${x + dx1} ${y + dy1} L ${x} ${y} L ${x + dx2} ${y + dy2}`}
          fill="none"
          stroke={jewel.gold}
          strokeWidth={1.5}
          opacity={0.3}
        />
      ))}
    </g>
  );

  // ── Ambient glow at center ──

  const renderCenterGlow = () => {
    const pulse = Math.sin(frame * 0.03) * 0.15 + 0.35;
    return (
      <g>
        <defs>
          <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={jewel.gold} stopOpacity={pulse * 0.2} />
            <stop offset="40%" stopColor={jewel.purple} stopOpacity={pulse * 0.05} />
            <stop offset="100%" stopColor={jewel.bg} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="outerVignette" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={jewel.bg} stopOpacity={0} />
            <stop offset="70%" stopColor={jewel.bg} stopOpacity={0} />
            <stop offset="100%" stopColor={jewel.bg} stopOpacity={0.6} />
          </radialGradient>
        </defs>
        <circle cx={CX} cy={CY} r={R_INNER - 10} fill="url(#centerGlow)" />
        <rect x={0} y={0} width={W} height={H} fill="url(#outerVignette)" />
      </g>
    );
  };

  // ── Detected chord label ──

  const renderChordLabel = () => {
    if (!detectedChord) return null;
    const springVal = spring({ frame, fps, config: { damping: 15, stiffness: 120 } });
    const scale = interpolate(springVal, [0, 1], [0.8, 1]);
    const opacity = interpolate(springVal, [0, 1], [0, 0.9]);

    return (
      <g transform={`translate(${CX}, ${CY}) scale(${scale})`} opacity={opacity}>
        <text
          x={0} y={-4}
          textAnchor="middle"
          dominantBaseline="central"
          fill={jewel.gold}
          fontSize={22}
          fontFamily="'Georgia', serif"
          fontWeight={700}
          letterSpacing={2}
        >
          {detectedChord}
        </text>
        <text
          x={0} y={16}
          textAnchor="middle"
          dominantBaseline="central"
          fill={jewel.textDim}
          fontSize={9}
          fontFamily="'Georgia', serif"
          letterSpacing={1}
        >
          {activeMode.toUpperCase()}
        </text>
      </g>
    );
  };

  // ── Ripple rings emanating from active node ──

  const renderRippleRings = () => {
    if (activeIdx < 0) return null;
    const [ax, ay] = outerNodes[activeIdx];
    const numRings = 4;
    return (
      <g>
        {Array.from({ length: numRings }).map((_, ri) => {
          const phase = ((frame + ri * 30) % 120) / 120;
          const r = phase * 200;
          const opacity = (1 - phase) * 0.3;
          return (
            <circle
              key={`ripple-${ri}`}
              cx={ax} cy={ay}
              r={r}
              fill="none"
              stroke={jewel.gold}
              strokeWidth={1.5}
              opacity={opacity}
            />
          );
        })}
      </g>
    );
  };

  // ── Cross-ring web (fine lines from outer to inner nodes) ──

  const renderCrossRingWeb = () => (
    <g>
      {outerNodes.map((op, i) => {
        const ip = innerNodes[i];
        const active = isKeyActive(i);
        return (
          <line
            key={`web-${i}`}
            x1={op[0]} y1={op[1]}
            x2={ip[0]} y2={ip[1]}
            stroke={active ? jewel.gold : jewel.goldDark}
            strokeWidth={active ? 0.8 : 0.3}
            opacity={active ? 0.3 : 0.06}
            strokeDasharray="2 6"
          />
        );
      })}
    </g>
  );

  // ── Assembly ─────────────────────────────────────────────────────────────

  return (
    <AbsoluteFill style={{ backgroundColor: jewel.bg }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Layer 0: Background noise texture */}
        {renderNoise()}

        {/* Layer 1: Stained glass sections */}
        {renderGlassSections()}

        {/* Layer 2: Concentric rings */}
        {renderConcentricRings()}

        {/* Layer 3: Flower of life (center, static) */}
        {renderFlowerOfLife()}

        {/* Layer 4: Inner mandala (rotating) */}
        {renderInnerMandala()}

        {/* Layer 5: Golden spirals */}
        {renderGoldenSpirals()}
        {renderSpiralParticles()}

        {/* Layer 6: Dodecagon (slow rotation) */}
        {renderDodecagon()}

        {/* Layer 7: Hexagram (counter-rotation) */}
        {renderHexagram()}

        {/* Layer 8: Pentagon patterns */}
        {renderPentagons()}

        {/* Layer 9: Connections */}
        {renderFifthsConnections()}
        {renderRelativeMinorConnections()}
        {renderMiddleToInnerConnections()}
        {renderCrossRingWeb()}

        {/* Layer 10: Chord progression arcs */}
        {renderChordProgressionArc()}

        {/* Layer 11: Pathfinder glow */}
        {renderPathfinderGlow()}

        {/* Layer 12: Active note markers */}
        {renderActiveNoteMarkers()}

        {/* Layer 13: Ripple rings from active key */}
        {renderRippleRings()}

        {/* Layer 14: Outer decorations */}
        {renderOuterDecorations()}

        {/* Layer 15: Nodes (on top of geometry) */}
        {renderNodes()}

        {/* Layer 16: Center glow + vignette */}
        {renderCenterGlow()}

        {/* Layer 17: Chord label at center */}
        {renderChordLabel()}

        {/* Layer 18: Border frame */}
        {renderBorderFrame()}

        {/* Diatonic chords with mini keyboards */}
        <DiatonicChordsPanel
          x={1660}
          y={120}
          activeKey={activeKey}
          activeMode={activeMode}
          accentColor="#fbbf24"
          secondaryColor="#7c3aed"
          textColor="#e2e8f0"
          textDimColor="#94a3b8"
          kbWidth={130}
          kbHeight={38}
          spacing={68}
          opacity={0.8}
        />
      </svg>
    </AbsoluteFill>
  );
};
