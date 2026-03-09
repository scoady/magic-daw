import React, { useMemo, useState, useCallback } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from 'remotion';
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

// Base design dimensions — actual W/H come from useVideoConfig()
const BASE_H = 1080;
const OUTER_R_BASE = 480;
const MIDDLE_R_BASE = 370;
const INNER_R_BASE = 260;

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

// ── Scale & Piano helpers ─────────────────────────────────────────────────

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]; // W W H W W W H
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]; // W H W W H W W

/** Is this chromatic index a black key? */
const IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

/** Note display names — prefer sharps for some, flats for others depending on context */
const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// Keys that conventionally use flats
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db']);

function getScaleNotes(root: string, mode: 'major' | 'minor'): Set<number> {
  const norm = ENHARMONIC[root] ?? root;
  const rootIdx = CHROMATIC.indexOf(norm);
  if (rootIdx < 0) return new Set();
  const intervals = mode === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
  return new Set(intervals.map(i => (rootIdx + i) % 12));
}

/** Get the note name for display, respecting the key's accidental preference */
function noteName(chromaticIdx: number, key: string): string {
  const useFlats = FLAT_KEYS.has(key);
  return (useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[chromaticIdx % 12];
}

/**
 * Build piano keys from root to root (one octave of the scale).
 * Returns chromatic indices spanning 13 semitones (root to root inclusive).
 */
function buildPianoRange(root: string): number[] {
  const norm = ENHARMONIC[root] ?? root;
  const rootIdx = CHROMATIC.indexOf(norm);
  if (rootIdx < 0) return Array.from({ length: 13 }, (_, i) => i); // fallback C-C
  // 13 chromatic keys: root to root+12 (inclusive — shows the octave)
  return Array.from({ length: 13 }, (_, i) => (rootIdx + i) % 12);
}

// ── Branch tooltip data ───────────────────────────────────────────────────

interface BranchTooltip {
  roman: string;
  description: string;
  tension: string;  // "stable" | "mild tension" | "strong tension" | "chromatic"
  genres: string;
  voiceLeading: string;
}

const BRANCH_TOOLTIPS: Record<string, BranchTooltip> = {
  'V':    { roman: 'V',    description: 'Dominant — strongest pull to resolve home', tension: 'strong tension → resolution', genres: 'All genres', voiceLeading: 'Leading tone → tonic' },
  'IV':   { roman: 'IV',   description: 'Subdominant — warm, open, plagal cadence', tension: 'stable → gentle pull', genres: 'Pop, Rock, Gospel', voiceLeading: '4th resolves to 3rd' },
  'ii':   { roman: 'ii',   description: 'Supertonic — pre-dominant, sets up V', tension: 'mild tension → V → I', genres: 'Jazz, Pop, Classical', voiceLeading: 'Stepwise to V' },
  'vi':   { roman: 'vi',   description: 'Relative minor — deceptive, emotional shift', tension: 'surprise resolution', genres: 'Pop, R&B, Singer-songwriter', voiceLeading: 'Shared tones with I' },
  'bVII': { roman: 'bVII', description: 'Subtonic — borrowed from Mixolydian mode', tension: 'modal color', genres: 'Rock, Blues, Celtic', voiceLeading: 'Parallel motion down' },
  'bVI':  { roman: 'bVI',  description: 'Borrowed from parallel minor — epic, cinematic', tension: 'chromatic surprise', genres: 'Film scores, Metal, Pop', voiceLeading: 'Half-step to V' },
  'iii':  { roman: 'iii',  description: 'Mediant — delicate, transitional color', tension: 'mild → ambiguous', genres: 'Classical, Art pop', voiceLeading: 'Shared tone with I' },
  'bV':   { roman: 'bV',   description: 'Tritone substitution — jazz tension', tension: 'maximum tension', genres: 'Jazz, Neo-soul, Prog', voiceLeading: 'Chromatic approach' },
  'vii°': { roman: 'vii°', description: 'Leading tone diminished — unstable, wants I', tension: 'strong tension', genres: 'Classical, Jazz', voiceLeading: 'Converging half-steps' },
  'bIII': { roman: 'bIII', description: 'Chromatic mediant — bright, unexpected shift', tension: 'chromatic color', genres: 'Film, Prog rock, Pop', voiceLeading: 'Common tone modulation' },
  'V/vi': { roman: 'V/vi', description: 'Secondary dominant — targets the vi chord', tension: 'applied tension → vi', genres: 'Jazz, Classical, Pop', voiceLeading: 'Creates temporary leading tone' },
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

function generateStars(count: number, w: number, h: number): BgStar[] {
  const rand = seededRandom(7749);
  const starColors = ['#ffffff', '#cfe8ff', '#ffe4c4', '#d4e4ff', '#fff5e6'];
  const stars: BgStar[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rand() * w,
      y: rand() * h,
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

function generateDodecagonPoints(cx: number, cy: number, outerR: number): [number, number][] {
  return Array.from({ length: 12 }, (_, i) => polarToXY(cx, cy, outerR + 60, nodeAngle(i)));
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
  const { fps, width: W, height: H } = useVideoConfig();
  const CX = W / 2;
  const CY = H / 2;

  // Scale radii proportionally to height (circle should fill vertical space)
  const scale = H / BASE_H;
  const OUTER_R = OUTER_R_BASE * scale;
  const MIDDLE_R = MIDDLE_R_BASE * scale;
  const INNER_R = INNER_R_BASE * scale;

  const activeIdx = useMemo(() => keyIndexOnCircle(activeKey), [activeKey]);

  // Which ring + index does the detected chord belong to?
  const detectedRing = useMemo(() => chordToRingIndex(detectedChord), [detectedChord]);

  // Scale notes for piano overlay
  const scaleNotes = useMemo(() => getScaleNotes(activeKey, activeMode), [activeKey, activeMode]);

  // Hover state for branch tooltips
  const [hoveredBranch, setHoveredBranch] = useState<string | null>(null);
  const onBranchEnter = useCallback((roman: string) => setHoveredBranch(roman), []);
  const onBranchLeave = useCallback(() => setHoveredBranch(null), []);

  const playedIndices = useMemo(
    () => new Set(activeNotes.map((n) => ((n % 12) * 7) % 12)),
    [activeNotes],
  );

  // ── Zoom into played node's quadrant ─────────────────────────────────
  const zoom = useCircleZoom({
    playedIndices,
    detectedRing,
    cx: CX, cy: CY, outerR: OUTER_R,
    middleR: MIDDLE_R, innerR: INNER_R,
    fullW: W, fullH: H,
    frame, fps,
    zoomFraction: 0.28,
  });

  const bgStars = useMemo(() => generateStars(220, W, H), [W, H]);
  const accretionDisk = useMemo(() => generateAccretionDisk(28), []);
  const dodecagon = useMemo(() => generateDodecagonPoints(CX, CY, OUTER_R), [CX, CY, OUTER_R]);

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
  }, [activeIdx, CX, CY, OUTER_R]);

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
  }, [CX, CY, OUTER_R, MIDDLE_R]);

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
  }, [pathfinderPaths, CX, CY, OUTER_R]);

  // ── Spring for active key transition ──────────────────────────────────

  const pulseSpring = spring({ frame, fps, config: { damping: 12, stiffness: 80, mass: 0.6 } });

  // ── Render helpers ────────────────────────────────────────────────────

  const renderActiveKeyPos = useMemo((): [number, number] => {
    if (activeIdx < 0) return [CX, CY];
    return polarToXY(CX, CY, OUTER_R, nodeAngle(activeIdx));
  }, [activeIdx, CX, CY, OUTER_R]);

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
      <svg width={W} height={H} viewBox={(() => {
        // Parse zoom viewBox and add gentle breathing on top
        const breathX = Math.sin(frame * 0.003) * 8 * (1 + zoom.zoomProgress * 0.5);
        const breathY = Math.cos(frame * 0.0025) * 5 * (1 + zoom.zoomProgress * 0.5);
        const parts = zoom.viewBox.split(' ').map(Number);
        return `${parts[0] + breathX} ${parts[1] + breathY} ${parts[2]} ${parts[3]}`;
      })()}>
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
        {[OUTER_R - 20, MIDDLE_R - 20, INNER_R - 20].map((r, ri) => {
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
            r={OUTER_R - 40}
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
              {/* Glow under path — wide soft stroke instead of blur filter */}
              <path
                d={pathD}
                fill="none"
                stroke={arc.color}
                strokeWidth={14}
                opacity={0.08}
                strokeDasharray={`${dashLen} ${gapLen}`}
                strokeDashoffset={-frame * 1.5}
                strokeLinecap="round"
              />
              <path
                d={pathD}
                fill="none"
                stroke={arc.color}
                strokeWidth={8}
                opacity={0.12}
                strokeDasharray={`${dashLen} ${gapLen}`}
                strokeDashoffset={-frame * 1.5}
                strokeLinecap="round"
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
                  <React.Fragment key={`pf-p-${ai}-${pi}`}>
                    {/* Fake glow: larger low-opacity circle behind */}
                    <circle
                      cx={px} cy={py} r={8}
                      fill={arc.color}
                      opacity={0.2}
                    />
                    <circle
                      cx={px} cy={py} r={4}
                      fill={arc.color}
                      opacity={0.95}
                    />
                  </React.Fragment>
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
          const isDetectedDim = detectedRing.ring === 'dim' && detectedRing.index === i;
          const zp = zoom.zoomProgress;
          // When zoomed: ALL dim nodes become ghost dots (branch tree replaces navigation)
          const idleR = isDetectedDim ? 10 : isHighlighted ? 8 : 6;
          const ghostR = 3;
          const r = idleR + (ghostR - idleR) * zp;
          const baseOpacity = isDetectedDim ? 0.85 : isHighlighted ? 0.7 : 0.2;
          const opacity = Math.max(0.02, baseOpacity * (1 - zp * 0.95));

          return (
            <g key={`dim-${i}`}>
              {isDetectedDim && zp < 0.5 && (
                <>
                  <circle cx={x} cy={y} r={r + 12} fill={palette.gold} opacity={0.06 * (1 - zp)} />
                  <circle cx={x} cy={y} r={r + 7} fill={palette.gold} opacity={0.12 * (1 - zp)} />
                </>
              )}
              <circle
                cx={x} cy={y} r={r}
                fill={isDetectedDim ? palette.gold : palette.textDim}
                opacity={opacity}
              />
              <text
                x={x} y={y + r + 12}
                textAnchor="middle"
                fill={isDetectedDim ? palette.gold : palette.textDim}
                fontSize={isDetectedDim ? 10 : 8}
                fontWeight={isDetectedDim ? 700 : 400}
                opacity={Math.max(0, (isDetectedDim ? 0.9 : opacity * 0.8) * (1 - zp))}
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
          const isDetectedMinor = detectedRing.ring === 'minor' && detectedRing.index === i;
          const isHighlightedMinor = isRelativeMinor || isDetectedMinor;
          const zp = zoom.zoomProgress;
          // When zoomed: ALL minor nodes become ghost dots (branch tree replaces navigation)
          const ghostR = 3;
          const idleNodeR = isHighlightedMinor ? 18 : 14;
          const nodeR = idleNodeR + (ghostR - idleNodeR) * zp;
          const idleGlow = isHighlightedMinor
            ? 0.4 + 0.15 * Math.sin(frame * 0.06)
            : interpolate(dist, [0, 6], [0.25, 0.08], { extrapolateRight: 'clamp' });
          const glowOpacity = Math.max(0.02, idleGlow * (1 - zp * 0.95));

          return (
            <g key={`min-${i}`}>
              {/* Subtle orbital ring */}
              <circle
                cx={x} cy={y} r={nodeR + 6}
                fill="none"
                stroke={palette.purple}
                strokeWidth={isDetectedMinor ? 1.5 : 0.5}
                opacity={(isDetectedMinor ? 0.7 : glowOpacity * 0.4) * (1 - zp)}
              />
              {/* Glow — layered opacity circles instead of blur filter */}
              {isHighlightedMinor && zp < 0.5 && (
                <>
                  <circle
                    cx={x} cy={y} r={nodeR + 22}
                    fill={palette.purple}
                    opacity={(0.05 + 0.02 * Math.sin(frame * 0.05)) * (1 - zp)}
                  />
                  <circle
                    cx={x} cy={y} r={nodeR + 14}
                    fill={palette.purple}
                    opacity={(0.1 + 0.04 * Math.sin(frame * 0.05)) * (1 - zp)}
                  />
                </>
              )}
              {/* Node body */}
              <circle
                cx={x} cy={y} r={nodeR}
                fill={zp > 0.5 ? (palette.purple) : palette.bg}
                stroke={isDetectedMinor ? palette.pink : palette.purple}
                strokeWidth={isHighlightedMinor ? 2 * (1 - zp) : 1 * (1 - zp)}
                opacity={Math.max(0.04, (isDetectedMinor ? 0.9 : glowOpacity + 0.3) * (1 - zp * 0.9))}
              />
              {/* Inner fill */}
              {zp < 0.5 && (
              <circle
                cx={x} cy={y} r={Math.max(0, nodeR - 3)}
                fill={isDetectedMinor ? palette.pink : palette.purple}
                opacity={(isDetectedMinor ? 0.35 : glowOpacity * 0.3) * (1 - zp)}
              />
              )}
              {/* Label */}
              <text
                x={x} y={y + 4}
                textAnchor="middle"
                fill={isDetectedMinor ? palette.pink : palette.text}
                fontSize={isDetectedMinor ? 13 : 11}
                fontFamily="monospace"
                fontWeight={isHighlightedMinor ? 700 : 400}
                opacity={Math.max(0, (isDetectedMinor ? 1 : interpolate(dist, [0, 6], [1, 0.4], { extrapolateRight: 'clamp' })) * (1 - zp))}
              >
                {key}
              </text>
            </g>
          );
        })}

        {/* ── Outer ring: Major keys — predictive navigation ─────────── */}
        {MAJOR_KEYS.map((key, i) => {
          const angle = nodeAngle(i);
          const [bx, by] = polarToXY(CX, CY, OUTER_R, angle);
          const isActive = i === activeIdx;
          const isPlayed = playedIndices.has(i);
          const dist = activeIdx >= 0 ? fifthsDistance(i, activeIdx) : 6;
          const zp = zoom.zoomProgress; // 0=idle, 1=note held

          // Gravity offset (idle state only)
          const grav = gravityOffsets.get(i);
          const springVal = interpolate(Math.sin(frame * 0.025), [-1, 1], [0.5, 1]);
          const idleGx = grav ? grav.dx * springVal * (1 - zp) : 0;
          const idleGy = grav ? grav.dy * springVal * (1 - zp) : 0;
          const x = bx + idleGx;
          const y = by + idleGy;

          // ── Predictive keyboard: classify each node ──
          const isAdjacent = zoom.adjacentIndices.includes(i);
          const pi = zoom.primaryPlayedIdx;

          // Relationship label for adjacent nodes — expanded harmonic map
          let relLabel = '';
          let relColor = palette.cyan;
          // Harmonic "tier" — how close/strong the relationship is (1=strongest)
          let harmonicTier = 3;
          if (pi >= 0 && isAdjacent && !isPlayed) {
            const diff = ((i - pi) % 12 + 12) % 12;
            if (diff === 1)  { relLabel = 'V';    relColor = palette.cyan;  harmonicTier = 1; }
            else if (diff === 11) { relLabel = 'IV';   relColor = palette.teal;  harmonicTier = 1; }
            else if (diff === 2)  { relLabel = 'ii';   relColor = '#60a5fa';     harmonicTier = 1; }
            else if (diff === 10) { relLabel = 'bVII'; relColor = '#fb923c';     harmonicTier = 2; }
            else if (diff === 3)  { relLabel = 'vi';   relColor = palette.purple; harmonicTier = 2; }
            else if (diff === 9)  { relLabel = 'bVI';  relColor = '#e879f9';     harmonicTier = 2; }
            else if (diff === 4)  { relLabel = 'iii';  relColor = '#818cf8';     harmonicTier = 3; }
            else if (diff === 8)  { relLabel = 'bV';   relColor = '#f87171';     harmonicTier = 3; }
            else if (diff === 5)  { relLabel = 'vii°'; relColor = '#fbbf24';     harmonicTier = 3; }
            else if (diff === 7)  { relLabel = 'bIII'; relColor = '#34d399';     harmonicTier = 3; }
          }

          // ── Node sizing: when zoomed, ONLY the played node stays large ──
          // All others become ghost dots — the branch tree provides navigation
          const idleR = isActive
            ? interpolate(pulseSpring, [0, 1], [26, 30])
            : interpolate(dist, [0, 6], [26, 22], { extrapolateRight: 'clamp' });

          const playedR = 28; // played node (smaller than before — zoomed view magnifies it)
          const ghostR = 3;   // everything else becomes a tiny ghost

          let targetR: number;
          let targetOpacity: number;
          if (isPlayed) {
            targetR = playedR;
            targetOpacity = 1;
          } else {
            // ALL non-played nodes become ghost dots when zoomed
            targetR = ghostR;
            targetOpacity = 0.04;
          }

          // Smooth transition between idle and zoomed states
          const nodeR = idleR + (targetR - idleR) * zp;
          const nodeOpacity = (isActive ? 1 : interpolate(dist, [0, 6], [1, 0.35], { extrapolateRight: 'clamp' }))
            * (1 - zp) + targetOpacity * zp;

          const glowColor = isActive
            ? (activeMode === 'minor' ? palette.purple : palette.cyan)
            : isPlayed ? palette.cyan
            : isAdjacent ? relColor
            : palette.cyan;

          return (
            <g key={`maj-${i}`}>
              {/* Active key glow (idle state) */}
              {isActive && zp < 0.5 && (
                <>
                  <circle cx={x} cy={y} r={70}
                    fill={glowColor} opacity={(0.06 + 0.03 * Math.sin(frame * 0.04)) * (1 - zp * 2)}
                    filter="url(#cof-glow-lg)"
                  />
                  <circle cx={x} cy={y} r={45}
                    fill={glowColor} opacity={(0.1 + 0.05 * Math.sin(frame * 0.06)) * (1 - zp * 2)}
                    filter="url(#cof-glow-md)"
                  />
                </>
              )}

              {/* ── PLAYED: focused glow (scaled for zoom magnification) ── */}
              {isPlayed && zp > 0.05 && (
                <>
                  <circle cx={x} cy={y}
                    r={nodeR + 16 + 3 * Math.sin(frame * 0.06)}
                    fill={palette.cyan} opacity={0.04 + 0.02 * zp}
                  />
                  <circle cx={x} cy={y}
                    r={nodeR + 8}
                    fill={palette.cyan} opacity={0.08 + 0.04 * zp}
                  />
                  {/* Neon ring */}
                  <circle cx={x} cy={y} r={nodeR + 3}
                    fill="none" stroke={palette.cyan}
                    strokeWidth={1.5} opacity={0.5 + 0.2 * Math.sin(frame * 0.07)}
                  />
                  {/* Single subtle ripple */}
                  {(() => {
                    const ripR = nodeR + 4 + (frame % 50);
                    const ripOp = interpolate(frame % 50, [0, 50], [0.15 * zp, 0]);
                    return (
                      <circle cx={x} cy={y} r={ripR}
                        fill="none" stroke={palette.cyan} strokeWidth={0.8} opacity={ripOp}
                      />
                    );
                  })()}
                </>
              )}

              {/* Adjacent glow removed — branch tree provides navigation */}

              {/* Node body */}
              <circle cx={x} cy={y} r={nodeR}
                fill={palette.bg}
                stroke={isPlayed ? palette.cyan : glowColor}
                strokeWidth={isPlayed ? 3 : isAdjacent && zp > 0.3 ? 2 : 1.5}
                opacity={nodeOpacity}
              />
              {/* Inner fill */}
              <circle cx={x} cy={y} r={Math.max(0, nodeR - 4)}
                fill={isPlayed ? palette.cyan : glowColor}
                opacity={isPlayed ? 0.35 + 0.1 * Math.sin(frame * 0.05)
                  : isAdjacent && zp > 0.3 ? 0.15 * zp
                  : isActive ? 0.2 + 0.08 * Math.sin(frame * 0.05) : nodeOpacity * 0.08}
              />

              {/* Key name label */}
              <text x={x} y={y + (isPlayed && zp > 0.3 ? 4 : 5)}
                textAnchor="middle"
                fill={isPlayed ? '#ffffff' : palette.text}
                fontSize={isPlayed && zp > 0.3 ? 12 : 14}
                fontFamily="monospace"
                fontWeight={isPlayed ? 900 : isActive ? 800 : 500}
                opacity={nodeOpacity}
              >
                {key}
              </text>

              {/* Roman numeral labels moved to branch tree */}
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
              {/* Soft glow line — wider stroke with low opacity instead of blur */}
              <line
                x1={ax} y1={ay} x2={tx} y2={ty}
                stroke={palette.cyan}
                strokeWidth={10}
                opacity={0.04}
                strokeLinecap="round"
              />
              <line
                x1={ax} y1={ay} x2={tx} y2={ty}
                stroke={palette.cyan}
                strokeWidth={6}
                opacity={0.07}
                strokeLinecap="round"
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
              const fadeOpacity = total <= 1 ? 0.9 : interpolate(ci, [0, total - 1], [0.25, 0.9]);

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
        {/* ── Branch tree: local radial nodes around played chord ─────── */}
        {zoom.primaryPlayedIdx >= 0 && zoom.zoomProgress > 0.05 && (() => {
          const pi = zoom.primaryPlayedIdx;
          const [px, py] = polarToXY(CX, CY, OUTER_R, nodeAngle(pi));
          const zp = zoom.zoomProgress;

          // Branch radius — distance from played node in SVG coords
          // These are in the zoomed-in coordinate space, so they appear larger on screen
          const branchR1 = 55 * scale;  // tier 1 — closest
          const branchR2 = 85 * scale;  // tier 2
          const branchR3 = 115 * scale; // tier 3 — furthest

          // Branch targets with angular placement (local, not circle positions)
          const branches: Array<{
            label: string; roman: string; color: string;
            angle: number; dist: number; tier: number;
            transition: string; width: number;
          }> = [
            // Tier 1 — primary (inner ring, largest)
            { label: MAJOR_KEYS[(pi + 1) % 12],  roman: 'V',    color: palette.cyan,   angle: -30,  dist: branchR1, tier: 1, transition: MAJOR_KEYS[(pi + 1) % 12] + '7', width: 3 },
            { label: MAJOR_KEYS[(pi + 11) % 12], roman: 'IV',   color: palette.teal,   angle: -150, dist: branchR1, tier: 1, transition: '', width: 3 },
            { label: MAJOR_KEYS[(pi + 2) % 12],  roman: 'ii',   color: '#60a5fa',      angle: 30,   dist: branchR1, tier: 1, transition: MAJOR_KEYS[(pi + 2) % 12] + '7', width: 2.5 },
            // Tier 2 — common (middle ring)
            { label: MINOR_KEYS[pi],              roman: 'vi',   color: palette.purple,  angle: 180,  dist: branchR2, tier: 2, transition: '', width: 2 },
            { label: MAJOR_KEYS[(pi + 10) % 12], roman: 'bVII', color: '#fb923c',      angle: -100, dist: branchR2, tier: 2, transition: '', width: 2 },
            { label: MAJOR_KEYS[(pi + 9) % 12],  roman: 'bVI',  color: '#e879f9',      angle: -60,  dist: branchR2, tier: 2, transition: '', width: 1.5 },
            { label: MAJOR_KEYS[(pi + 3) % 12],  roman: 'iii',  color: '#818cf8',      angle: 80,   dist: branchR2, tier: 2, transition: MAJOR_KEYS[(pi + 3) % 12] + '7', width: 1.5 },
            // Tier 3 — chromatic / exotic (outer ring)
            { label: MAJOR_KEYS[(pi + 8) % 12],  roman: 'bV',   color: '#f87171',      angle: -80,  dist: branchR3, tier: 3, transition: '', width: 1 },
            { label: MAJOR_KEYS[(pi + 5) % 12],  roman: 'vii°', color: palette.gold,   angle: 60,   dist: branchR3, tier: 3, transition: '', width: 1 },
            { label: MAJOR_KEYS[(pi + 7) % 12],  roman: 'bIII', color: '#34d399',      angle: 140,  dist: branchR3, tier: 3, transition: '', width: 1 },
            { label: MAJOR_KEYS[(pi + 4) % 12],  roman: 'V/vi', color: '#c084fc',      angle: 110,  dist: branchR3, tier: 3, transition: '', width: 1 },
          ];

          return (
            <g opacity={zp}>
              {branches.map((b, bi) => {
                // Position relative to the played node
                const rad = (b.angle - 90) * Math.PI / 180;
                const tx = px + b.dist * Math.cos(rad);
                const ty = py + b.dist * Math.sin(rad);

                // Curved branch line — slight curve away from center
                const mx = (px + tx) / 2;
                const my = (py + ty) / 2;
                const perpX = -(ty - py);
                const perpY = (tx - px);
                const perpLen = Math.sqrt(perpX * perpX + perpY * perpY);
                const curveMag = (b.tier === 1 ? 8 : b.tier === 2 ? 12 : 16) * scale;
                const cpx = mx + (perpLen > 0 ? perpX / perpLen * curveMag : 0);
                const cpy = my + (perpLen > 0 ? perpY / perpLen * curveMag : 0);
                const arcD = `M ${px} ${py} Q ${cpx} ${cpy} ${tx} ${ty}`;

                const nodeR = b.tier === 1 ? 14 * scale : b.tier === 2 ? 10 * scale : 8 * scale;
                const dashLen = b.tier === 1 ? 8 : 5;
                const gapLen = b.tier === 1 ? 4 : 5;

                const isHovered = hoveredBranch === b.roman;
                const hoverScale = isHovered ? 1.2 : 1;

                return (
                  <g key={`branch-${bi}`}
                    onMouseEnter={() => onBranchEnter(b.roman)}
                    onMouseLeave={onBranchLeave}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Glow under branch line */}
                    {b.tier <= 2 && (
                      <path d={arcD} fill="none"
                        stroke={b.color} strokeWidth={b.width * 3}
                        opacity={isHovered ? 0.12 : 0.04} strokeLinecap="round"
                      />
                    )}
                    {/* Branch line — animated dash flowing outward */}
                    <path d={arcD} fill="none"
                      stroke={b.color} strokeWidth={b.width * (isHovered ? 1.5 : 1)}
                      opacity={isHovered ? 0.8 : b.tier === 1 ? 0.5 : b.tier === 2 ? 0.35 : 0.2}
                      strokeDasharray={`${dashLen} ${gapLen}`}
                      strokeDashoffset={-frame * (b.tier === 1 ? 1.2 : 0.7)}
                      strokeLinecap="round"
                    />

                    {/* Transition label on branch midpoint */}
                    {b.transition && (
                      <g>
                        <rect
                          x={cpx - 12 * scale} y={cpy - 5 * scale}
                          width={24 * scale} height={10 * scale} rx={2}
                          fill="rgba(8,14,24,0.85)"
                          stroke={b.color} strokeWidth={0.3}
                          opacity={0.7}
                        />
                        <text x={cpx} y={cpy + 2.5 * scale}
                          textAnchor="middle" fill={b.color}
                          fontSize={5.5 * scale} fontFamily="monospace" fontWeight={600}
                          opacity={0.85}
                        >
                          {b.transition}
                        </text>
                      </g>
                    )}

                    {/* Hover hit area — invisible larger circle for easier targeting */}
                    <circle cx={tx} cy={ty} r={nodeR * 2}
                      fill="transparent" stroke="none"
                    />

                    {/* Target node — glass circle */}
                    <circle cx={tx} cy={ty} r={(nodeR + 6) * hoverScale}
                      fill={b.color} opacity={(isHovered ? 0.12 : 0.04) + 0.02 * Math.sin(frame * 0.05 + bi)}
                    />
                    {isHovered && (
                      <circle cx={tx} cy={ty} r={nodeR * hoverScale + 12}
                        fill={b.color} opacity={0.06}
                      />
                    )}
                    <circle cx={tx} cy={ty} r={nodeR * hoverScale}
                      fill={palette.bg} stroke={b.color}
                      strokeWidth={isHovered ? 2.5 : b.tier === 1 ? 2 : 1.2}
                      opacity={isHovered ? 1 : b.tier === 1 ? 0.9 : b.tier === 2 ? 0.7 : 0.5}
                    />
                    <circle cx={tx} cy={ty} r={Math.max(0, nodeR * hoverScale - 3)}
                      fill={b.color}
                      opacity={isHovered ? 0.25 : b.tier === 1 ? 0.15 : 0.08}
                    />

                    {/* Chord name */}
                    <text x={tx} y={ty + 1}
                      textAnchor="middle" dominantBaseline="central"
                      fill={isHovered ? '#ffffff' : palette.text}
                      fontSize={(b.tier === 1 ? 9 * scale : b.tier === 2 ? 7 * scale : 6 * scale) * hoverScale}
                      fontFamily="monospace" fontWeight={isHovered ? 800 : b.tier === 1 ? 700 : 500}
                      opacity={isHovered ? 1 : b.tier === 1 ? 1 : b.tier === 2 ? 0.85 : 0.65}
                    >
                      {b.label}
                    </text>

                    {/* Roman numeral below node */}
                    <text x={tx} y={ty + nodeR * hoverScale + 6 * scale}
                      textAnchor="middle"
                      fill={b.color}
                      fontSize={5 * scale * hoverScale} fontFamily="monospace" fontWeight={600}
                      opacity={isHovered ? 0.9 : b.tier === 1 ? 0.7 : 0.45}
                    >
                      {b.roman}
                    </text>

                    {/* Flowing particle along branch */}
                    {b.tier <= 2 && (() => {
                      const period = b.tier === 1 ? 60 : 90;
                      const progress = ((frame * 2 + bi * 20) % period) / period;
                      const t2 = progress;
                      const mt = 1 - t2;
                      const bx2 = mt * mt * px + 2 * mt * t2 * cpx + t2 * t2 * tx;
                      const by2 = mt * mt * py + 2 * mt * t2 * cpy + t2 * t2 * ty;
                      return (
                        <>
                          <circle cx={bx2} cy={by2} r={2.5 * scale} fill={b.color} opacity={0.12} />
                          <circle cx={bx2} cy={by2} r={1.2 * scale} fill={b.color} opacity={0.6} />
                        </>
                      );
                    })()}
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* ── Scale piano overlay — bottom-left, root-to-root ────── */}
        {(() => {
          const zp = zoom.zoomProgress;
          const pianoOpacity = 1 - zp * 0.8;
          if (pianoOpacity < 0.05) return null;

          // Build the chromatic range from root to root (13 keys)
          const range = buildPianoRange(activeKey);

          // Count white keys in range to size the piano
          const whiteCount = range.filter(n => !IS_BLACK[n]).length;
          const pianoW = Math.min(W * 0.28, 380);
          const whiteW = pianoW / whiteCount;
          const whiteH = whiteW * 3; // realistic proportions
          const blackW = whiteW * 0.62;
          const blackH = whiteH * 0.6;
          const pianoX = 24;
          const pianoY = H - whiteH - 28;
          const cornerR = whiteW * 0.12;

          // Layout: assign x positions — white keys get sequential slots,
          // black keys overlay between adjacent whites
          const keyLayouts: Array<{
            chromIdx: number; x: number; w: number; h: number;
            isBlack: boolean; inScale: boolean; isRoot: boolean;
            name: string; seqIdx: number;
          }> = [];

          let wIdx = 0;
          for (let si = 0; si < range.length; si++) {
            const n = range[si];
            const inScale = scaleNotes.has(n);
            const isRoot = n === range[0]; // first and last are root
            const name = noteName(n, activeKey);

            if (!IS_BLACK[n]) {
              keyLayouts.push({
                chromIdx: n,
                x: pianoX + wIdx * whiteW,
                w: whiteW,
                h: whiteH,
                isBlack: false,
                inScale,
                isRoot: isRoot || (si === range.length - 1), // octave root too
                name,
                seqIdx: si,
              });
              wIdx++;
            } else {
              // Black key sits on top of the boundary between previous and next white
              const bx = pianoX + wIdx * whiteW - blackW / 2;
              keyLayouts.push({
                chromIdx: n,
                x: bx,
                w: blackW,
                h: blackH,
                isBlack: true,
                inScale,
                isRoot,
                name,
                seqIdx: si,
              });
            }
          }

          const whites = keyLayouts.filter(k => !k.isBlack);
          const blacks = keyLayouts.filter(k => k.isBlack);
          const neonColor = activeMode === 'minor' ? palette.purple : palette.cyan;
          // Scale key fills — like the reference: light blue for white, saturated blue for black
          const whiteScaleFill = 'rgba(170,210,240,0.88)';    // soft light blue
          const whiteRootFill = 'rgba(130,200,235,0.95)';     // slightly stronger for root
          const blackScaleFill = '#2a6090';                    // deep saturated blue (like ref)
          const blackRootFill = '#3a85b8';                     // brighter blue for root
          const whiteDimFill = 'rgba(200,205,215,0.18)';      // very dim grey
          const blackDimFill = 'rgba(15,18,25,0.85)';         // dark, nearly invisible

          return (
            <g opacity={pianoOpacity}>
              {/* Neon glow filter for scale keys */}
              <defs>
                <filter id="piano-neon" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="piano-neon-sm" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Glass backdrop */}
              <rect
                x={pianoX - 8} y={pianoY - 22}
                width={pianoW + 16} height={whiteH + 34}
                rx={6}
                fill="rgba(8,14,24,0.7)"
                stroke={palette.glassBorder}
                strokeWidth={0.5}
              />
              {/* Label */}
              <text
                x={pianoX + pianoW / 2} y={pianoY - 8}
                textAnchor="middle"
                fill={neonColor}
                fontSize={9}
                fontFamily="monospace"
                fontWeight={600}
                opacity={0.6}
              >
                {activeKey} {activeMode}
              </text>

              {/* ── White keys ── */}
              {whites.map((k) => {
                const pulse = k.isRoot ? 0.06 * Math.sin(frame * 0.06) : 0;
                return (
                  <g key={`pw-${k.seqIdx}`}>
                    {/* Neon glow behind scale keys */}
                    {k.inScale && (
                      <rect
                        x={k.x + 1} y={pianoY}
                        width={k.w - 2} height={k.h}
                        rx={cornerR}
                        fill={neonColor}
                        opacity={k.isRoot ? 0.25 + pulse : 0.1}
                        filter="url(#piano-neon)"
                      />
                    )}
                    {/* Key body */}
                    <rect
                      x={k.x + 0.8} y={pianoY}
                      width={k.w - 1.6} height={k.h}
                      rx={cornerR}
                      fill={k.inScale
                        ? (k.isRoot ? whiteRootFill : whiteScaleFill)
                        : whiteDimFill}
                      stroke={k.inScale
                        ? `${neonColor}88`
                        : 'rgba(80,90,110,0.15)'}
                      strokeWidth={k.inScale ? 1 : 0.4}
                    />
                    {/* Note name at bottom of key */}
                    <text
                      x={k.x + k.w / 2} y={pianoY + k.h - 6}
                      textAnchor="middle"
                      fill={k.inScale ? 'rgba(15,25,40,0.75)' : 'rgba(100,116,139,0.2)'}
                      fontSize={k.isRoot ? 12 : 10}
                      fontFamily="monospace"
                      fontWeight={k.isRoot ? 800 : 500}
                    >
                      {k.name}
                    </text>
                  </g>
                );
              })}

              {/* ── Black keys (rendered on top) ── */}
              {blacks.map((k) => {
                const pulse = k.isRoot ? 0.08 * Math.sin(frame * 0.06) : 0;
                return (
                  <g key={`pb-${k.seqIdx}`}>
                    {/* Neon glow behind in-scale black keys */}
                    {k.inScale && (
                      <rect
                        x={k.x - 1} y={pianoY - 1}
                        width={k.w + 2} height={k.h + 2}
                        rx={cornerR * 0.8}
                        fill={neonColor}
                        opacity={k.isRoot ? 0.3 + pulse : 0.18}
                        filter="url(#piano-neon-sm)"
                      />
                    )}
                    {/* Key body */}
                    <rect
                      x={k.x} y={pianoY}
                      width={k.w} height={k.h}
                      rx={cornerR * 0.8}
                      fill={k.inScale
                        ? (k.isRoot ? blackRootFill : blackScaleFill)
                        : blackDimFill}
                      stroke={k.inScale
                        ? `${neonColor}66`
                        : 'rgba(40,50,65,0.3)'}
                      strokeWidth={k.inScale ? 0.8 : 0.3}
                    />
                    {/* Note name on in-scale black key */}
                    {k.inScale && (
                      <text
                        x={k.x + k.w / 2} y={pianoY + k.h - 5}
                        textAnchor="middle"
                        fill="rgba(220,235,255,0.9)"
                        fontSize={8}
                        fontFamily="monospace"
                        fontWeight={700}
                      >
                        {k.name}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Subtle neon accent line under the piano */}
              <line
                x1={pianoX} y1={pianoY + whiteH + 2}
                x2={pianoX + pianoW} y2={pianoY + whiteH + 2}
                stroke={neonColor}
                strokeWidth={0.8}
                opacity={0.12 + 0.04 * Math.sin(frame * 0.04)}
              />
            </g>
          );
        })()}

        {/* ── Branch hover tooltip ──────────────────────────────────── */}
        {hoveredBranch && BRANCH_TOOLTIPS[hoveredBranch] && zoom.primaryPlayedIdx >= 0 && (() => {
          const tip = BRANCH_TOOLTIPS[hoveredBranch];
          const pi = zoom.primaryPlayedIdx;
          const [px, py] = polarToXY(CX, CY, OUTER_R, nodeAngle(pi));
          // Position tooltip to the right of the played node
          const tipX = px + 35 * scale;
          const tipY = py - 50 * scale;
          const tipW = 160 * scale;
          const tipH = 62 * scale;
          const fs = 5.5 * scale;
          const lh = 7.5 * scale;

          return (
            <g>
              {/* Backdrop */}
              <rect
                x={tipX} y={tipY}
                width={tipW} height={tipH}
                rx={4}
                fill="rgba(8,14,24,0.92)"
                stroke={palette.glassBorder}
                strokeWidth={0.5}
              />
              {/* Accent bar */}
              <rect
                x={tipX} y={tipY}
                width={2.5} height={tipH}
                rx={1}
                fill={palette.cyan}
                opacity={0.6}
              />
              {/* Roman numeral header */}
              <text x={tipX + 8} y={tipY + lh + 2}
                fill={palette.cyan} fontSize={fs * 1.3}
                fontFamily="monospace" fontWeight={800}
              >
                {tip.roman}
              </text>
              {/* Description */}
              <text x={tipX + 8} y={tipY + lh * 2 + 3}
                fill={palette.text} fontSize={fs}
                fontFamily="monospace" fontWeight={400} opacity={0.85}
              >
                {tip.description}
              </text>
              {/* Tension */}
              <text x={tipX + 8} y={tipY + lh * 3 + 4}
                fill={palette.gold} fontSize={fs * 0.9}
                fontFamily="monospace" opacity={0.7}
              >
                {tip.tension}
              </text>
              {/* Voice leading */}
              <text x={tipX + 8} y={tipY + lh * 4 + 5}
                fill={palette.purple} fontSize={fs * 0.9}
                fontFamily="monospace" opacity={0.6}
              >
                {tip.voiceLeading}
              </text>
              {/* Genres */}
              <text x={tipX + 8} y={tipY + lh * 5 + 6}
                fill={palette.textDim} fontSize={fs * 0.85}
                fontFamily="monospace" opacity={0.45}
              >
                {tip.genres}
              </text>
            </g>
          );
        })()}
      </svg>
    </AbsoluteFill>
  );
};
