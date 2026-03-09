import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from 'remotion';

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

const palette = {
  bg: '#080e18',
  cyan: '#67e8f9',
  teal: '#2dd4bf',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  glass: 'rgba(120,200,220,0.06)',
  glassBorder: 'rgba(120,200,220,0.12)',
};

const PATHFINDER_COLORS = [palette.cyan, palette.pink, palette.gold, palette.purple, palette.teal];

const MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINOR_KEYS = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];
const DIM_KEYS = ['Bdim', 'F#dim', 'C#dim', 'G#dim', 'D#dim', 'A#dim', 'Fdim', 'Cdim', 'Gdim', 'Ddim', 'Adim', 'Edim'];

const DEGREE_LABELS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii\u00B0'];

const ENHARMONIC: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'Gb': 'F#',
  'Cb': 'B', 'Fb': 'E', 'B#': 'C', 'E#': 'F',
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

function extractRoot(key: string): string {
  if (!key) return '';
  const m = key.match(/^([A-G][#b]?)/);
  return m ? normalizeNote(m[1]) : '';
}

function keyIndexOnCircle(key: string): number {
  const root = extractRoot(key);
  const idx = MAJOR_KEYS.indexOf(root);
  return idx >= 0 ? idx : -1;
}

function fifthsDistance(a: number, b: number): number {
  if (a < 0 || b < 0) return 12;
  const d = Math.abs(a - b);
  return Math.min(d, 12 - d);
}

function polarToXY(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function nodeAngle(index: number): number {
  return (index / 12) * 360;
}

// ── Background Stars ──────────────────────────────────────────────────────

interface BgStar {
  x: number; y: number; r: number; baseOpacity: number;
  twinkleSpeed: number; twinklePhase: number;
  color: string;
}

function generateStars(count: number): BgStar[] {
  const rand = seededRandom(7749);
  const starColors = ['#ffffff', '#cfe8ff', '#ffe4c4', '#d4e4ff', '#fff5e6'];
  const stars: BgStar[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rand() * W,
      y: rand() * H,
      r: 0.3 + rand() * 1.8,
      baseOpacity: 0.1 + rand() * 0.5,
      twinkleSpeed: 0.02 + rand() * 0.06,
      twinklePhase: rand() * Math.PI * 2,
      color: starColors[Math.floor(rand() * starColors.length)],
    });
  }
  return stars;
}

// ── Accretion Disk Particles ──────────────────────────────────────────────

interface AccretionParticle {
  orbitRadius: number;
  angularSpeed: number;
  phase: number;
  size: number;
  opacity: number;
  color: string;
}

function generateAccretionDisk(count: number): AccretionParticle[] {
  const rand = seededRandom(1337);
  const colors = [palette.cyan, palette.teal, palette.purple, palette.pink, palette.gold];
  const particles: AccretionParticle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      orbitRadius: 30 + rand() * 28,
      angularSpeed: 0.8 + rand() * 2.2,
      phase: rand() * Math.PI * 2,
      size: 0.8 + rand() * 2.5,
      opacity: 0.2 + rand() * 0.6,
      color: colors[Math.floor(rand() * colors.length)],
    });
  }
  return particles;
}

// ── Sacred Geometry Lines ─────────────────────────────────────────────────

function generateDodecagonPoints(): [number, number][] {
  return Array.from({ length: 12 }, (_, i) => polarToXY(CX, CY, 380, nodeAngle(i)));
}

// ── Component ──────────────────────────────────────────────────────────────

export const CircleOfFifths1: React.FC<CircleOfFifthsProps> = ({
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

  const activeIdx = useMemo(() => keyIndexOnCircle(activeKey), [activeKey]);

  const bgStars = useMemo(() => generateStars(220), []);
  const accretionDisk = useMemo(() => generateAccretionDisk(28), []);
  const dodecagon = useMemo(() => generateDodecagonPoints(), []);

  // ── Gravitational pull computation ────────────────────────────────────

  const gravityOffsets = useMemo(() => {
    if (activeIdx < 0) return new Map<number, { dx: number; dy: number }>();
    const offsets = new Map<number, { dx: number; dy: number }>();
    for (let i = 0; i < 12; i++) {
      if (i === activeIdx) continue;
      const dist = fifthsDistance(i, activeIdx);
      if (dist <= 2) {
        const pullStrength = dist === 1 ? 14 : 7;
        const [nx, ny] = polarToXY(CX, CY, OUTER_R, nodeAngle(i));
        const [ax, ay] = polarToXY(CX, CY, OUTER_R, nodeAngle(activeIdx));
        const dx = ax - nx;
        const dy = ay - ny;
        const mag = Math.sqrt(dx * dx + dy * dy);
        if (mag > 0) {
          offsets.set(i, { dx: (dx / mag) * pullStrength, dy: (dy / mag) * pullStrength });
        }
      }
    }
    return offsets;
  }, [activeIdx]);

  // ── Connection lines data ─────────────────────────────────────────────

  const connections = useMemo(() => {
    const lines: Array<{
      x1: number; y1: number; x2: number; y2: number;
      thickness: number; opacity: number;
    }> = [];
    for (let i = 0; i < 12; i++) {
      // Fifth connections (adjacent on circle)
      const next = (i + 1) % 12;
      const [x1, y1] = polarToXY(CX, CY, OUTER_R, nodeAngle(i));
      const [x2, y2] = polarToXY(CX, CY, OUTER_R, nodeAngle(next));
      lines.push({ x1, y1, x2, y2, thickness: 1.2, opacity: 0.12 });

      // Relative minor connections
      const [mx, my] = polarToXY(CX, CY, MIDDLE_R, nodeAngle(i));
      lines.push({ x1, y1, x2: mx, y2: my, thickness: 0.6, opacity: 0.06 });
    }
    // Tritone lines (opposite keys)
    for (let i = 0; i < 6; i++) {
      const [x1, y1] = polarToXY(CX, CY, OUTER_R, nodeAngle(i));
      const [x2, y2] = polarToXY(CX, CY, OUTER_R, nodeAngle(i + 6));
      lines.push({ x1, y1, x2, y2, thickness: 0.4, opacity: 0.04 });
    }
    return lines;
  }, []);

  // ── Pathfinder arc computations ───────────────────────────────────────

  const pathfinderArcs = useMemo(() => {
    if (!pathfinderPaths || pathfinderPaths.length === 0) return [];
    return pathfinderPaths.map((path, pi) => {
      const points: [number, number][] = path.map((keyName) => {
        const idx = keyIndexOnCircle(keyName);
        if (idx < 0) return [CX, CY] as [number, number];
        return polarToXY(CX, CY, OUTER_R, nodeAngle(idx));
      });
      return { points, color: PATHFINDER_COLORS[pi % PATHFINDER_COLORS.length] };
    });
  }, [pathfinderPaths]);

  // ── Spring for active key transition ──────────────────────────────────

  const pulseSpring = spring({ frame, fps, config: { damping: 12, stiffness: 80, mass: 0.6 } });

  // ── Render helpers ────────────────────────────────────────────────────

  const renderActiveKeyPos = useMemo((): [number, number] => {
    if (activeIdx < 0) return [CX, CY];
    return polarToXY(CX, CY, OUTER_R, nodeAngle(activeIdx));
  }, [activeIdx]);

  // Aurora drift based on mode
  const auroraDrift = frame * 0.003;
  const auroraHue = activeMode === 'minor' ? 270 : 180; // purple for minor, cyan for major

  // Chord progression display (last 8)
  const recentChords = useMemo(
    () => (chordProgression || []).slice(-8),
    [chordProgression],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          {/* Reusable blur filters — max 3 */}
          <filter id="cof-glow-sm" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <filter id="cof-glow-md" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="12" />
          </filter>
          <filter id="cof-glow-lg" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="30" />
          </filter>

          {/* Gravitational heatmap gradient */}
          <radialGradient id="cof-heatmap" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={activeMode === 'minor' ? palette.purple : palette.cyan} stopOpacity={0.08} />
            <stop offset="40%" stopColor={activeMode === 'minor' ? palette.pink : palette.teal} stopOpacity={0.03} />
            <stop offset="100%" stopColor={palette.bg} stopOpacity={0} />
          </radialGradient>

          {/* Aurora gradient for background */}
          <radialGradient id="cof-aurora-a" cx={`${50 + Math.sin(auroraDrift) * 15}%`} cy={`${50 + Math.cos(auroraDrift * 0.7) * 15}%`} r="60%">
            <stop offset="0%" stopColor={`hsl(${auroraHue}, 70%, 40%)`} stopOpacity={0.06} />
            <stop offset="100%" stopColor={palette.bg} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="cof-aurora-b" cx={`${50 + Math.cos(auroraDrift * 1.3) * 20}%`} cy={`${50 + Math.sin(auroraDrift * 0.5) * 20}%`} r="50%">
            <stop offset="0%" stopColor={`hsl(${auroraHue + 60}, 60%, 35%)`} stopOpacity={0.04} />
            <stop offset="100%" stopColor={palette.bg} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* ── Background layer ─────────────────────────────────────────── */}
        <rect width={W} height={H} fill={palette.bg} />
        <rect width={W} height={H} fill="url(#cof-aurora-a)" />
        <rect width={W} height={H} fill="url(#cof-aurora-b)" />

        {/* ── Stars ────────────────────────────────────────────────────── */}
        {bgStars.map((star, i) => {
          const twinkle = 0.5 + 0.5 * Math.sin(frame * star.twinkleSpeed + star.twinklePhase);
          const opacity = star.baseOpacity * twinkle;
          return (
            <circle
              key={`star-${i}`}
              cx={star.x}
              cy={star.y}
              r={star.r}
              fill={star.color}
              opacity={opacity}
            />
          );
        })}

        {/* ── Sacred geometry dodecagon ─────────────────────────────────── */}
        <polygon
          points={dodecagon.map(([x, y]) => `${x},${y}`).join(' ')}
          fill="none"
          stroke={palette.gold}
          strokeWidth={0.5}
          opacity={0.05}
        />
        {/* Inner dodecagons */}
        {[300, 220, 140].map((r, ri) => {
          const pts = Array.from({ length: 12 }, (_, i) => polarToXY(CX, CY, r, nodeAngle(i)));
          return (
            <polygon
              key={`geo-${ri}`}
              points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke={palette.gold}
              strokeWidth={0.3}
              opacity={0.04}
            />
          );
        })}
        {/* Radial spokes */}
        {dodecagon.map(([x, y], i) => (
          <line
            key={`spoke-${i}`}
            x1={CX} y1={CY} x2={x} y2={y}
            stroke={palette.gold}
            strokeWidth={0.3}
            opacity={0.03}
          />
        ))}

        {/* ── Gravitational heatmap centered on active key ─────────────── */}
        {activeIdx >= 0 && (
          <circle
            cx={renderActiveKeyPos[0]}
            cy={renderActiveKeyPos[1]}
            r={280}
            fill="url(#cof-heatmap)"
          />
        )}

        {/* ── Connection field lines ──────────────────────────────────── */}
        {connections.map((c, i) => (
          <line
            key={`conn-${i}`}
            x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
            stroke={palette.cyan}
            strokeWidth={c.thickness}
            opacity={c.opacity}
            strokeDasharray="6 4"
            strokeDashoffset={-frame * 0.3}
          />
        ))}

        {/* ── Pathfinder transfer arcs ────────────────────────────────── */}
        {pathfinderArcs.map((arc, ai) => {
          if (arc.points.length < 2) return null;
          const pathD = arc.points.reduce((d, [x, y], pi) => {
            if (pi === 0) return `M ${x} ${y}`;
            // Hohmann-style curved arcs — use quadratic bezier through center-ish control
            const [px, py] = arc.points[pi - 1];
            const cpx = CX + (x + px - 2 * CX) * 0.2;
            const cpy = CY + (y + py - 2 * CY) * 0.2;
            return `${d} Q ${cpx} ${cpy} ${x} ${y}`;
          }, '');

          const totalLen = arc.points.length * 120;
          const dashLen = 12;
          const gapLen = 8;

          return (
            <g key={`pf-${ai}`}>
              {/* Glow under path */}
              <path
                d={pathD}
                fill="none"
                stroke={arc.color}
                strokeWidth={6}
                opacity={0.15}
                filter="url(#cof-glow-md)"
                strokeDasharray={`${dashLen} ${gapLen}`}
                strokeDashoffset={-frame * 1.5}
              />
              {/* Path itself */}
              <path
                d={pathD}
                fill="none"
                stroke={arc.color}
                strokeWidth={2}
                opacity={0.7}
                strokeDasharray={`${dashLen} ${gapLen}`}
                strokeDashoffset={-frame * 1.5}
                strokeLinecap="round"
              />
              {/* Flowing particle along path */}
              {Array.from({ length: 3 }, (_, pi) => {
                const progress = ((frame * 2 + pi * (totalLen / 3)) % totalLen) / totalLen;
                const segIdx = Math.floor(progress * (arc.points.length - 1));
                const segT = (progress * (arc.points.length - 1)) - segIdx;
                const [sx, sy] = arc.points[Math.min(segIdx, arc.points.length - 1)];
                const [ex, ey] = arc.points[Math.min(segIdx + 1, arc.points.length - 1)];
                const px = sx + (ex - sx) * segT;
                const py = sy + (ey - sy) * segT;
                return (
                  <circle
                    key={`pf-p-${ai}-${pi}`}
                    cx={px} cy={py} r={3}
                    fill={arc.color}
                    opacity={0.9}
                    filter="url(#cof-glow-sm)"
                  />
                );
              })}
            </g>
          );
        })}

        {/* ── Inner ring: Diminished keys ─────────────────────────────── */}
        {DIM_KEYS.map((key, i) => {
          const angle = nodeAngle(i);
          const [x, y] = polarToXY(CX, CY, INNER_R, angle);
          const isHighlighted = highlightedDegrees.includes(7) && i === activeIdx;
          const r = isHighlighted ? 8 : 6;
          const opacity = isHighlighted ? 0.7 : 0.2;

          return (
            <g key={`dim-${i}`}>
              <circle
                cx={x} cy={y} r={r}
                fill={palette.textDim}
                opacity={opacity}
              />
              <text
                x={x} y={y + r + 12}
                textAnchor="middle"
                fill={palette.textDim}
                fontSize={8}
                opacity={opacity * 0.8}
                fontFamily="monospace"
              >
                {key}
              </text>
            </g>
          );
        })}

        {/* ── Middle ring: Minor keys ─────────────────────────────────── */}
        {MINOR_KEYS.map((key, i) => {
          const angle = nodeAngle(i);
          const dist = activeIdx >= 0 ? fifthsDistance(i, activeIdx) : 6;
          const pullFactor = dist <= 2 ? (dist === 1 ? 8 : 4) : 0;
          const pullAngle = activeIdx >= 0 ? nodeAngle(activeIdx) : 0;
          const [bx, by] = polarToXY(CX, CY, MIDDLE_R, angle);

          // Gravitational pull toward active key
          let gx = 0, gy = 0;
          if (pullFactor > 0 && activeIdx >= 0) {
            const [ax, ay] = polarToXY(CX, CY, MIDDLE_R, nodeAngle(activeIdx));
            const dx = ax - bx, dy = ay - by;
            const mag = Math.sqrt(dx * dx + dy * dy);
            if (mag > 0) {
              const springPull = interpolate(
                Math.sin(frame * 0.02),
                [-1, 1],
                [pullFactor * 0.6, pullFactor],
              );
              gx = (dx / mag) * springPull;
              gy = (dy / mag) * springPull;
            }
          }

          const x = bx + gx;
          const y = by + gy;
          const isRelativeMinor = i === activeIdx;
          const nodeR = isRelativeMinor ? 18 : 14;
          const glowOpacity = isRelativeMinor
            ? 0.4 + 0.15 * Math.sin(frame * 0.06)
            : interpolate(dist, [0, 6], [0.25, 0.08], { extrapolateRight: 'clamp' });

          return (
            <g key={`min-${i}`}>
              {/* Subtle orbital ring */}
              <circle
                cx={x} cy={y} r={nodeR + 6}
                fill="none"
                stroke={palette.purple}
                strokeWidth={0.5}
                opacity={glowOpacity * 0.4}
              />
              {/* Glow */}
              {isRelativeMinor && (
                <circle
                  cx={x} cy={y} r={nodeR + 10}
                  fill={palette.purple}
                  opacity={0.12 + 0.06 * Math.sin(frame * 0.05)}
                  filter="url(#cof-glow-md)"
                />
              )}
              {/* Node body */}
              <circle
                cx={x} cy={y} r={nodeR}
                fill={palette.bg}
                stroke={palette.purple}
                strokeWidth={isRelativeMinor ? 2 : 1}
                opacity={glowOpacity + 0.3}
              />
              {/* Inner fill */}
              <circle
                cx={x} cy={y} r={nodeR - 3}
                fill={palette.purple}
                opacity={glowOpacity * 0.3}
              />
              {/* Label */}
              <text
                x={x} y={y + 4}
                textAnchor="middle"
                fill={palette.text}
                fontSize={11}
                fontFamily="monospace"
                fontWeight={isRelativeMinor ? 700 : 400}
                opacity={interpolate(dist, [0, 6], [1, 0.4], { extrapolateRight: 'clamp' })}
              >
                {key}
              </text>
            </g>
          );
        })}

        {/* ── Outer ring: Major keys ──────────────────────────────────── */}
        {MAJOR_KEYS.map((key, i) => {
          const angle = nodeAngle(i);
          const [bx, by] = polarToXY(CX, CY, OUTER_R, angle);
          const isActive = i === activeIdx;
          const dist = activeIdx >= 0 ? fifthsDistance(i, activeIdx) : 6;

          // Gravity offset
          const grav = gravityOffsets.get(i);
          const springVal = interpolate(Math.sin(frame * 0.025), [-1, 1], [0.5, 1]);
          const x = bx + (grav ? grav.dx * springVal : 0);
          const y = by + (grav ? grav.dy * springVal : 0);

          const nodeR = isActive
            ? interpolate(pulseSpring, [0, 1], [24, 28])
            : interpolate(dist, [0, 6], [24, 20], { extrapolateRight: 'clamp' });

          const glowColor = isActive
            ? (activeMode === 'minor' ? palette.purple : palette.cyan)
            : palette.cyan;

          const nodeOpacity = interpolate(dist, [0, 6], [1, 0.35], { extrapolateRight: 'clamp' });

          return (
            <g key={`maj-${i}`}>
              {/* Active key: massive radial glow */}
              {isActive && (
                <>
                  <circle
                    cx={x} cy={y} r={70}
                    fill={glowColor}
                    opacity={0.06 + 0.03 * Math.sin(frame * 0.04)}
                    filter="url(#cof-glow-lg)"
                  />
                  <circle
                    cx={x} cy={y} r={45}
                    fill={glowColor}
                    opacity={0.1 + 0.05 * Math.sin(frame * 0.06)}
                    filter="url(#cof-glow-md)"
                  />
                  {/* Double ripple rings */}
                  {[0, 15].map((offset) => {
                    const rippleR = 30 + ((frame + offset) % 60);
                    const rippleOpacity = interpolate(
                      (frame + offset) % 60,
                      [0, 60],
                      [0.35, 0],
                    );
                    return (
                      <circle
                        key={`ripple-${offset}`}
                        cx={x} cy={y} r={rippleR}
                        fill="none"
                        stroke={glowColor}
                        strokeWidth={1.5}
                        opacity={rippleOpacity}
                      />
                    );
                  })}
                </>
              )}

              {/* Aurora glow aura for nearby nodes */}
              {dist <= 2 && !isActive && (
                <circle
                  cx={x} cy={y} r={nodeR + 12}
                  fill={palette.teal}
                  opacity={0.05}
                  filter="url(#cof-glow-sm)"
                />
              )}

              {/* Node body */}
              <circle
                cx={x} cy={y} r={nodeR}
                fill={palette.bg}
                stroke={glowColor}
                strokeWidth={isActive ? 2.5 : 1.5}
                opacity={nodeOpacity}
              />
              {/* Inner fill — aurora gradient feel */}
              <circle
                cx={x} cy={y} r={nodeR - 4}
                fill={glowColor}
                opacity={isActive ? 0.2 + 0.08 * Math.sin(frame * 0.05) : nodeOpacity * 0.08}
              />

              {/* Label */}
              <text
                x={x} y={y + 5}
                textAnchor="middle"
                fill={palette.text}
                fontSize={isActive ? 16 : 14}
                fontFamily="monospace"
                fontWeight={isActive ? 800 : 500}
                opacity={nodeOpacity}
              >
                {key}
              </text>
            </g>
          );
        })}

        {/* ── Accretion disk around active key ────────────────────────── */}
        {activeIdx >= 0 && accretionDisk.map((p, i) => {
          const [akx, aky] = renderActiveKeyPos;
          const angle = frame * p.angularSpeed * 0.04 + p.phase;
          // Slight elliptical orbit
          const rx = p.orbitRadius;
          const ry = p.orbitRadius * 0.6;
          const px = akx + rx * Math.cos(angle);
          const py = aky + ry * Math.sin(angle);

          // Fade particles behind the node
          const behindNode = Math.abs(px - akx) < 15 && Math.abs(py - aky) < 15;
          const opacity = behindNode ? p.opacity * 0.3 : p.opacity;

          return (
            <circle
              key={`acc-${i}`}
              cx={px} cy={py}
              r={p.size}
              fill={p.color}
              opacity={opacity * (0.7 + 0.3 * Math.sin(frame * 0.1 + i))}
            />
          );
        })}

        {/* ── Highlighted field lines (fifths from active) ────────────── */}
        {activeIdx >= 0 && [
          (activeIdx + 1) % 12,
          (activeIdx + 11) % 12,
        ].map((ni, li) => {
          const [ax, ay] = renderActiveKeyPos;
          const [nx, ny] = polarToXY(CX, CY, OUTER_R, nodeAngle(ni));
          const grav = gravityOffsets.get(ni);
          const springVal = interpolate(Math.sin(frame * 0.025), [-1, 1], [0.5, 1]);
          const tx = nx + (grav ? grav.dx * springVal : 0);
          const ty = ny + (grav ? grav.dy * springVal : 0);

          return (
            <g key={`field-${li}`}>
              <line
                x1={ax} y1={ay} x2={tx} y2={ty}
                stroke={palette.cyan}
                strokeWidth={2}
                opacity={0.25}
                strokeDasharray="8 5"
                strokeDashoffset={-frame * 0.6}
              />
              <line
                x1={ax} y1={ay} x2={tx} y2={ty}
                stroke={palette.cyan}
                strokeWidth={5}
                opacity={0.06}
                filter="url(#cof-glow-sm)"
              />
            </g>
          );
        })}

        {/* ── Diatonic degree labels ──────────────────────────────────── */}
        {highlightedDegrees.length > 0 && activeIdx >= 0 && highlightedDegrees.map((deg) => {
          if (deg < 1 || deg > 7) return null;
          // Map scale degrees to fifths-circle offsets
          // I=0, ii=2(up 2 fifths), iii=4, IV=-1(11), V=1, vi=3, vii°=5
          const degreeToFifths = [0, 2, 4, -1, 1, 3, 5];
          const fifthOffset = degreeToFifths[deg - 1];
          const nodeIdx = (activeIdx + fifthOffset + 12) % 12;
          const [nx, ny] = polarToXY(CX, CY, OUTER_R + 38, nodeAngle(nodeIdx));

          const label = DEGREE_LABELS[deg - 1];
          const labelOpacity = 0.6 + 0.2 * Math.sin(frame * 0.04 + deg);

          return (
            <g key={`deg-${deg}`}>
              <text
                x={nx} y={ny + 4}
                textAnchor="middle"
                fill={palette.gold}
                fontSize={12}
                fontFamily="monospace"
                fontWeight={700}
                opacity={labelOpacity}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* ── Detected chord indicator ───────────────────────────────── */}
        {detectedChord && (
          <g>
            <text
              x={CX} y={CY - 20}
              textAnchor="middle"
              fill={palette.text}
              fontSize={28}
              fontFamily="monospace"
              fontWeight={800}
              opacity={0.9}
            >
              {detectedChord}
            </text>
            <text
              x={CX} y={CY + 8}
              textAnchor="middle"
              fill={palette.textDim}
              fontSize={12}
              fontFamily="monospace"
              opacity={0.5}
            >
              detected
            </text>
          </g>
        )}

        {/* ── Center mode / key label ────────────────────────────────── */}
        {!detectedChord && activeKey && (
          <g>
            <text
              x={CX} y={CY - 10}
              textAnchor="middle"
              fill={palette.text}
              fontSize={22}
              fontFamily="monospace"
              fontWeight={700}
              opacity={0.7}
            >
              {activeKey} {activeMode}
            </text>
            <text
              x={CX} y={CY + 14}
              textAnchor="middle"
              fill={palette.textDim}
              fontSize={10}
              fontFamily="monospace"
              opacity={0.35}
            >
              harmonic gravity
            </text>
          </g>
        )}

        {/* ── Chord progression trail — bottom glass cards ────────────── */}
        {recentChords.length > 0 && (
          <g>
            {recentChords.map((chord, ci) => {
              const total = recentChords.length;
              const cardW = 72;
              const gap = 8;
              const totalW = total * cardW + (total - 1) * gap;
              const startX = (W - totalW) / 2;
              const cx = startX + ci * (cardW + gap);
              const cy2 = H - 52;
              const isLatest = ci === total - 1;
              const fadeOpacity = interpolate(ci, [0, total - 1], [0.25, 0.9]);

              return (
                <g key={`prog-${ci}`}>
                  {/* Glass card background */}
                  <rect
                    x={cx} y={cy2}
                    width={cardW} height={32}
                    rx={6}
                    fill={palette.glass}
                    stroke={isLatest ? palette.cyan : palette.glassBorder}
                    strokeWidth={isLatest ? 1.5 : 0.5}
                    opacity={fadeOpacity}
                  />
                  {/* Chord text */}
                  <text
                    x={cx + cardW / 2}
                    y={cy2 + 20}
                    textAnchor="middle"
                    fill={isLatest ? palette.cyan : palette.text}
                    fontSize={13}
                    fontFamily="monospace"
                    fontWeight={isLatest ? 700 : 400}
                    opacity={fadeOpacity}
                  >
                    {chord}
                  </text>
                </g>
              );
            })}
            {/* Label */}
            <text
              x={W / 2} y={H - 60}
              textAnchor="middle"
              fill={palette.textDim}
              fontSize={9}
              fontFamily="monospace"
              opacity={0.3}
            >
              progression
            </text>
          </g>
        )}

        {/* ── Active notes indicator — tiny dots near center ──────────── */}
        {activeNotes.length > 0 && activeNotes.slice(0, 12).map((midi, ni) => {
          const noteClass = midi % 12;
          const noteAngle = (noteClass / 12) * 360;
          const [nx, ny] = polarToXY(CX, CY, 80, noteAngle);
          const pulse = 0.5 + 0.5 * Math.sin(frame * 0.1 + ni * 0.5);

          return (
            <circle
              key={`note-${ni}`}
              cx={nx} cy={ny}
              r={3 + pulse * 2}
              fill={palette.pink}
              opacity={0.5 + pulse * 0.4}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
