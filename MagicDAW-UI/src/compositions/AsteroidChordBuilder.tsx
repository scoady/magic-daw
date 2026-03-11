import React, { useMemo, useRef, useEffect } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
  Easing,
} from 'remotion';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AsteroidChordBuilderProps {
  activeKey: string;
  activeMode: 'major' | 'minor';
  detectedChord: string | null;
  isFullChord?: boolean;
  activeNotes: number[];
  chordProgression: string[];
  playbackIndex?: number;
  loopRegion?: [number, number] | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DISPLAY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

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

const BASE_R = 34;
const EJECT_FRAMES = 50; // total ejection animation length
const CHARGE_FRAMES = 8; // initial charge-up before launch
const TRAIL_COUNT = 12;  // motion blur ghost copies
const SHOCKWAVE_FRAMES = 45;
const SHAKE_FRAMES = 20;

// ── Helpers ────────────────────────────────────────────────────────────────

function noteToChroma(n: number): number { return ((n % 12) + 12) % 12; }

function sr(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function hex2rgba(hex: string, a: number): string {
  return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
}

/** High-detail asteroid silhouette SVG path */
function makeAsteroidPath(radius: number, seed: number): string {
  const N = 16;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const jag = 0.65 + sr(seed * 100 + i * 37) * 0.6;
    const micro = 0.93 + sr(seed * 200 + i * 53) * 0.14;
    const r = radius * jag * micro;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < N; i++) {
    const next = pts[(i + 1) % N];
    const mid = [(pts[i][0] + next[0]) / 2, (pts[i][1] + next[1]) / 2];
    d += ` Q ${next[0].toFixed(1)} ${next[1].toFixed(1)} ${mid[0].toFixed(1)} ${mid[1].toFixed(1)}`;
  }
  return d + ' Z';
}

/** Crater data with depth info for 3D shading */
function makeCraters(radius: number, seed: number) {
  const n = 3 + Math.floor(sr(seed * 77) * 4);
  return Array.from({ length: n }, (_, i) => ({
    cx: Math.cos(sr(seed * 300 + i * 41) * Math.PI * 2) * sr(seed * 400 + i * 59) * radius * 0.45,
    cy: Math.sin(sr(seed * 300 + i * 41) * Math.PI * 2) * sr(seed * 400 + i * 59) * radius * 0.45,
    r: 2 + sr(seed * 500 + i * 71) * (radius * 0.22),
    depth: 0.3 + sr(seed * 600 + i * 83) * 0.7, // 0=shallow, 1=deep
  }));
}

/** Surface ridges — irregular lines across the asteroid surface */
function makeRidges(radius: number, seed: number) {
  const n = 2 + Math.floor(sr(seed * 88) * 3);
  return Array.from({ length: n }, (_, i) => {
    const a1 = sr(seed * 700 + i * 47) * Math.PI * 2;
    const a2 = a1 + 0.8 + sr(seed * 800 + i * 53) * 1.5;
    const dist = 0.15 + sr(seed * 900 + i * 61) * 0.3;
    return {
      x1: Math.cos(a1) * radius * dist,
      y1: Math.sin(a1) * radius * dist,
      x2: Math.cos(a2) * radius * (dist + 0.2 + sr(seed * 1000 + i * 67) * 0.3),
      y2: Math.sin(a2) * radius * (dist + 0.2 + sr(seed * 1000 + i * 67) * 0.3),
      // Control point for curve
      cpx: (Math.cos(a1) + Math.cos(a2)) * radius * 0.3 + (sr(seed * 1100 + i * 71) - 0.5) * radius * 0.4,
      cpy: (Math.sin(a1) + Math.sin(a2)) * radius * 0.3 + (sr(seed * 1200 + i * 79) - 0.5) * radius * 0.4,
    };
  });
}

/** Parse hex to {r,g,b} */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// ── Composition ────────────────────────────────────────────────────────────

export const AsteroidChordBuilder: React.FC<AsteroidChordBuilderProps> = ({
  activeNotes,
  detectedChord,
  chordProgression,
  playbackIndex = -1,
  loopRegion,
}) => {
  const frame = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();

  // ── Active note tracking ────────────────────────────────────────────────

  const activeChromas = useMemo(() => {
    const s = new Set<number>();
    activeNotes.forEach(n => s.add(noteToChroma(n)));
    return s;
  }, [activeNotes]);

  const activeCount = activeChromas.size;

  // ── Event tracking refs ─────────────────────────────────────────────────

  const ejectionFramesRef = useRef<Map<number, number>>(new Map());
  const prevActiveChromas = useRef<Set<number>>(new Set());
  const chordEventFrameRef = useRef<number>(-999);
  const prevChordRef = useRef<string | null>(null);
  const prevProgLenRef = useRef(0);
  const nodeAddedFrameRef = useRef<number>(-999);

  useEffect(() => {
    // New note ejections
    activeChromas.forEach(c => {
      if (!prevActiveChromas.current.has(c)) {
        ejectionFramesRef.current.set(c, frame);
      }
    });
    prevActiveChromas.current = new Set(activeChromas);

    // Chord detection shockwave
    if (detectedChord && detectedChord !== prevChordRef.current) {
      chordEventFrameRef.current = frame;
    }
    prevChordRef.current = detectedChord;

    // New node added to path
    if (chordProgression.length > prevProgLenRef.current) {
      nodeAddedFrameRef.current = frame;
    }
    prevProgLenRef.current = chordProgression.length;
  }, [activeChromas, frame, detectedChord, chordProgression.length]);

  // ── Layout ──────────────────────────────────────────────────────────────

  const beltCx = W / 2;
  const beltCy = H * 0.35;
  const beltRx = W * 0.42;
  const beltRy = H * 0.19;
  const pathY = H * 0.83;
  const pathStartX = 70;
  const pathStepX = Math.min(72, (W - 140) / Math.max(chordProgression.length, 1));

  // ── Camera shake (spring-damped after ejections) ────────────────────────

  const timeSinceNodeAdded = frame - nodeAddedFrameRef.current;
  const shakeIntensity = timeSinceNodeAdded >= 0 && timeSinceNodeAdded < SHAKE_FRAMES
    ? interpolate(
        spring({ frame: timeSinceNodeAdded, fps, config: { damping: 8, stiffness: 200, mass: 0.4 } }),
        [0, 1], [6, 0]
      )
    : 0;
  const shakeX = shakeIntensity * Math.sin(frame * 1.7);
  const shakeY = shakeIntensity * Math.cos(frame * 2.3);

  // ── Nebula reactivity — breathes with active note count ─────────────────

  const nebulaBreath = interpolate(activeCount, [0, 3, 6, 12], [1, 1.15, 1.35, 1.6], { extrapolateRight: 'clamp' });
  const nebulaOpacity = interpolate(activeCount, [0, 3, 12], [1, 1.8, 2.5], { extrapolateRight: 'clamp' });

  // ── Pre-compute asteroid data ───────────────────────────────────────────

  const asteroids = useMemo(() => CHROMATIC.map((_, i) => {
    const sizeVar = 0.75 + sr(i * 31) * 0.5;
    return {
      chroma: i,
      displayName: DISPLAY_NAMES[i],
      color: NOTE_COLORS[i],
      colorDim: NOTE_COLORS_DIM[i],
      baseAngle: (i / 12) * Math.PI * 2 - Math.PI / 2,
      orbitSpeed: 0.002 + sr(i * 7) * 0.002,
      wobbleAmp: 5 + sr(i * 13) * 8,
      wobbleFreq: 0.012 + sr(i * 19) * 0.01,
      size: BASE_R * sizeVar,
      depth: sr(i * 43),
      tumbleSpeed: 0.15 + sr(i * 61) * 0.5,
      path: makeAsteroidPath(BASE_R * sizeVar, i),
      craters: makeCraters(BASE_R * sizeVar, i),
      ridges: makeRidges(BASE_R * sizeVar, i),
    };
  }), []);

  const sortedAsteroids = useMemo(() => [...asteroids].sort((a, b) => a.depth - b.depth), [asteroids]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          {/* ── SVG Filters ── */}

          {/* Bloom: triple-layer gaussian for photorealistic glow */}
          <filter id="bloom-heavy" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="b1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b2" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b3" />
            <feMerge>
              <feMergeNode in="b1" />
              <feMergeNode in="b2" />
              <feMergeNode in="b3" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="bloom-med" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="b1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b2" />
            <feMerge>
              <feMergeNode in="b1" />
              <feMergeNode in="b2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="bloom-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>

          {/* Heat shimmer — displacement turbulence */}
          <filter id="heat-shimmer" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="turbulence" baseFrequency="0.015" numOctaves="3"
              seed={Math.floor(frame * 0.3) % 100} result="turb" />
            <feDisplacementMap in="SourceGraphic" in2="turb" scale="3" />
          </filter>

          {/* Asteroid surface noise texture */}
          <filter id="rock-texture" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="4" result="noise" />
            <feColorMatrix in="noise" type="saturate" values="0" result="gray" />
            <feBlend in="SourceGraphic" in2="gray" mode="overlay" />
          </filter>

          {/* ── Gradients ── */}

          {/* Nebula layers */}
          <radialGradient id="neb-purple" cx="20%" cy="25%" r="45%">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.05 * nebulaOpacity} />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="neb-cyan" cx="80%" cy="40%" r="40%">
            <stop offset="0%" stopColor="#67e8f9" stopOpacity={0.04 * nebulaOpacity} />
            <stop offset="100%" stopColor="#67e8f9" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="neb-pink" cx="55%" cy="15%" r="30%">
            <stop offset="0%" stopColor="#f472b6" stopOpacity={0.03 * nebulaOpacity} />
            <stop offset="100%" stopColor="#f472b6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="neb-gold" cx="40%" cy="50%" r="25%">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.02 * nebulaOpacity} />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ── Scene root with camera shake ────────────────────────────── */}
        <g transform={`translate(${shakeX.toFixed(2)}, ${shakeY.toFixed(2)})`}>

          {/* ══════════ LAYER 0: DEEP SPACE ══════════ */}

          {/* Nebula clouds — drift with parallax, breathe with note activity */}
          {[
            { id: 'neb-purple', dx: 0.0008, dy: 0.0006, sx: nebulaBreath },
            { id: 'neb-cyan', dx: 0.001, dy: 0.0007, sx: nebulaBreath * 0.95 },
            { id: 'neb-pink', dx: 0.0013, dy: 0.0009, sx: nebulaBreath * 1.05 },
            { id: 'neb-gold', dx: 0.0006, dy: 0.0011, sx: nebulaBreath * 0.9 },
          ].map((neb, ni) => (
            <rect key={`neb-${ni}`}
              x={-W * 0.1} y={-H * 0.1} width={W * 1.2} height={H * 1.2}
              fill={`url(#${neb.id})`}
              transform={`translate(${Math.sin(frame * neb.dx + ni) * 25}, ${Math.cos(frame * neb.dy + ni * 2) * 18}) scale(${neb.sx})`}
              style={{ transformOrigin: `${W / 2}px ${H / 2}px` }}
            />
          ))}

          {/* Star field — 3 parallax layers */}
          {useMemo(() => {
            const nodes: React.ReactNode[] = [];
            // Layer 1: distant — tiny, slow
            for (let i = 0; i < 150; i++) {
              const sx = sr(i * 3.7) * W;
              const sy = sr(i * 7.3) * H * 0.78;
              const rad = 0.2 + sr(i * 11.1) * 0.5;
              const phase = sr(i * 17) * 6.28;
              // Spring-based twinkle: compute a repeating spring curve
              const twinkleFrame = (frame + Math.floor(phase * 100)) % 120;
              const twinkle = 0.06 + 0.1 * spring({ frame: twinkleFrame, fps, config: { damping: 20, stiffness: 30, mass: 2 } });
              nodes.push(<circle key={`s1-${i}`} cx={sx} cy={sy} r={rad} fill="#c8d6e5" opacity={twinkle} />);
            }
            // Layer 2: mid — colored, faster twinkle
            for (let i = 0; i < 50; i++) {
              const sx = sr(i * 5.1 + 500) * W;
              const sy = sr(i * 8.9 + 500) * H * 0.72;
              const rad = 0.5 + sr(i * 13.3 + 500) * 1.2;
              const phase = sr(i * 19 + 500) * 6.28;
              const twinkleFrame = (frame + Math.floor(phase * 80)) % 90;
              const twinkle = 0.1 + 0.2 * spring({ frame: twinkleFrame, fps, config: { damping: 15, stiffness: 40, mass: 1.5 } });
              const colors = ['#67e8f9', '#a78bfa', '#e2e8f0', '#f472b6', '#fbbf24'];
              const tint = colors[Math.floor(sr(i * 23 + 500) * colors.length)];
              nodes.push(<circle key={`s2-${i}`} cx={sx} cy={sy} r={rad} fill={tint} opacity={twinkle} />);
            }
            // Layer 3: bright stars with cross-spikes + lens flare
            for (let i = 0; i < 8; i++) {
              const sx = sr(i * 7.7 + 900) * W;
              const sy = sr(i * 11.3 + 900) * H * 0.55;
              const twinkleFrame = (frame + i * 30) % 150;
              const brightness = interpolate(
                spring({ frame: twinkleFrame, fps, config: { damping: 25, stiffness: 20, mass: 3 } }),
                [0, 1], [0.15, 0.4]
              );
              const spikeLen = 4 + sr(i * 31 + 900) * 6;
              const diagLen = spikeLen * 0.6;
              nodes.push(
                <g key={`s3-${i}`} opacity={brightness}>
                  <circle cx={sx} cy={sy} r={1.2} fill="#fff" filter="url(#bloom-soft)" />
                  {/* Cross spikes */}
                  <line x1={sx - spikeLen} y1={sy} x2={sx + spikeLen} y2={sy} stroke="#fff" strokeWidth={0.4} opacity={0.7} />
                  <line x1={sx} y1={sy - spikeLen} x2={sx} y2={sy + spikeLen} stroke="#fff" strokeWidth={0.4} opacity={0.7} />
                  {/* Diagonal spikes */}
                  <line x1={sx - diagLen} y1={sy - diagLen} x2={sx + diagLen} y2={sy + diagLen} stroke="#fff" strokeWidth={0.2} opacity={0.3} />
                  <line x1={sx + diagLen} y1={sy - diagLen} x2={sx - diagLen} y2={sy + diagLen} stroke="#fff" strokeWidth={0.2} opacity={0.3} />
                  {/* Lens flare circle */}
                  <circle cx={sx} cy={sy} r={spikeLen * 1.2} fill="none" stroke="#fff" strokeWidth={0.15} opacity={brightness * 0.3} />
                </g>
              );
            }
            return nodes;
          }, [W, H, frame, fps])}

          {/* ══════════ LAYER 1: BELT STRUCTURE ══════════ */}

          {/* Dust band — thick soft ellipse */}
          <ellipse cx={beltCx} cy={beltCy} rx={beltRx * 1.2} ry={beltRy * 1.5}
            fill="none" stroke="rgba(103,232,249,0.015)"
            strokeWidth={beltRy * 0.8}
            opacity={interpolate(activeCount, [0, 6], [0.5, 0.9], { extrapolateRight: 'clamp' })}
          />

          {/* Orbital guide rings with spring-based breathing */}
          {[0.85, 1.0, 1.15].map((mult, ri) => {
            const breathFrame = (frame + ri * 40) % 200;
            const breathScale = 1 + 0.008 * spring({ frame: breathFrame, fps, config: { damping: 30, stiffness: 10, mass: 5 } });
            return (
              <ellipse key={`ring-${ri}`}
                cx={beltCx} cy={beltCy}
                rx={beltRx * mult * breathScale} ry={beltRy * mult * breathScale}
                fill="none" stroke="rgba(103,232,249,0.02)"
                strokeWidth={0.5} strokeDasharray={`${2 + ri} ${10 + ri * 5}`}
              />
            );
          })}

          {/* Debris field — 80 tiny rocks orbiting with depth sorting */}
          {useMemo(() => Array.from({ length: 80 }, (_, i) => {
            const phase = sr(i * 3.1 + 100) * Math.PI * 2;
            const dist = 0.8 + sr(i * 5.3 + 200) * 0.4;
            const speed = 0.0015 + sr(i * 9.1 + 400) * 0.004;
            const angle = phase + frame * speed;
            const px = beltCx + beltRx * dist * Math.cos(angle);
            const py = beltCy + beltRy * dist * Math.sin(angle);
            const rad = 0.4 + sr(i * 7.7 + 300) * 2.5;
            const bright = 0.1 + sr(i * 11.3 + 500) * 0.2;
            // Spring-based flicker
            const flickFrame = (frame + i * 7) % 80;
            const flick = spring({ frame: flickFrame, fps, config: { damping: 25, stiffness: 15, mass: 3 } });
            return (
              <circle key={`deb-${i}`} cx={px} cy={py} r={rad}
                fill="#64748b" opacity={bright + flick * 0.08} />
            );
          }), [beltCx, beltCy, beltRx, beltRy, frame, fps])}

          {/* ══════════ LAYER 2: CHORD SHOCKWAVE ══════════ */}

          {(() => {
            const timeSinceChord = frame - chordEventFrameRef.current;
            if (timeSinceChord < 0 || timeSinceChord >= SHOCKWAVE_FRAMES) return null;

            // Spring-driven expansion
            const expand = spring({
              frame: timeSinceChord, fps,
              config: { damping: 15, stiffness: 40, mass: 1.2 },
            });
            const ringR = interpolate(expand, [0, 1], [20, Math.max(W, H) * 0.6]);
            const fade = interpolate(timeSinceChord, [0, SHOCKWAVE_FRAMES], [0.35, 0], { extrapolateRight: 'clamp' });

            // Get chord color
            const rootMatch = detectedChord?.match(/^([A-G][b#]?)/);
            const rootName = rootMatch ? rootMatch[1] : 'C';
            const rootChroma = DISPLAY_NAMES.indexOf(rootName);
            const shockColor = rootChroma >= 0 ? NOTE_COLORS[rootChroma] : '#67e8f9';

            return (
              <g>
                {/* Outer ring */}
                <circle cx={beltCx} cy={beltCy} r={ringR}
                  fill="none" stroke={shockColor}
                  strokeWidth={interpolate(expand, [0, 1], [4, 0.5])}
                  opacity={fade} filter="url(#bloom-med)" />
                {/* Inner ring — delayed */}
                <circle cx={beltCx} cy={beltCy}
                  r={ringR * 0.7}
                  fill="none" stroke={shockColor}
                  strokeWidth={interpolate(expand, [0, 1], [2, 0.3])}
                  opacity={fade * 0.5} />
                {/* Flash */}
                {timeSinceChord < 6 && (
                  <circle cx={beltCx} cy={beltCy}
                    r={interpolate(timeSinceChord, [0, 6], [5, 40])}
                    fill={shockColor}
                    opacity={interpolate(timeSinceChord, [0, 6], [0.3, 0], { extrapolateRight: 'clamp' })}
                    filter="url(#bloom-heavy)" />
                )}
              </g>
            );
          })()}

          {/* ══════════ LAYER 3: GRAVITATIONAL FIELD LINES ══════════ */}

          {(() => {
            if (activeCount < 2) return null;
            const activeList = Array.from(activeChromas);
            const lines: React.ReactNode[] = [];
            for (let i = 0; i < activeList.length; i++) {
              for (let j = i + 1; j < activeList.length; j++) {
                const a1 = asteroids[activeList[i]];
                const a2 = asteroids[activeList[j]];
                const angle1 = a1.baseAngle + frame * (a1.orbitSpeed * (0.6 + a1.depth * 0.8));
                const angle2 = a2.baseAngle + frame * (a2.orbitSpeed * (0.6 + a2.depth * 0.8));
                const x1 = beltCx + beltRx * Math.cos(angle1) + a1.wobbleAmp * Math.sin(frame * a1.wobbleFreq + a1.chroma);
                const y1 = beltCy + beltRy * Math.sin(angle1) + a1.wobbleAmp * Math.cos(frame * a1.wobbleFreq * 0.7 + a1.chroma * 2);
                const x2 = beltCx + beltRx * Math.cos(angle2) + a2.wobbleAmp * Math.sin(frame * a2.wobbleFreq + a2.chroma);
                const y2 = beltCy + beltRy * Math.sin(angle2) + a2.wobbleAmp * Math.cos(frame * a2.wobbleFreq * 0.7 + a2.chroma * 2);
                // Curved field line via quadratic bezier
                const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15;
                const my = (y1 + y2) / 2 - (x2 - x1) * 0.15;
                lines.push(
                  <path key={`field-${i}-${j}`}
                    d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                    fill="none" stroke={hex2rgba(a1.color, 0.08)}
                    strokeWidth={0.8} strokeDasharray="3 6"
                    filter="url(#bloom-soft)"
                  />
                );
              }
            }
            return <g>{lines}</g>;
          })()}

          {/* ══════════ LAYER 4: ASTEROIDS ══════════ */}

          {sortedAsteroids.map((ast) => {
            const isActive = activeChromas.has(ast.chroma);
            const ejFrame = ejectionFramesRef.current.get(ast.chroma);
            const tSinceEject = ejFrame != null ? frame - ejFrame : Infinity;
            const isEjecting = ejFrame != null && tSinceEject >= 0 && tSinceEject < EJECT_FRAMES;

            // ── Multi-stage ejection animation ──
            // Stage 1 (0-CHARGE_FRAMES): charge — glow intensifies, asteroid vibrates
            // Stage 2 (CHARGE_FRAMES-end): launch — spring arc to path
            const isCharging = isEjecting && tSinceEject < CHARGE_FRAMES;
            const launchFrame = isEjecting ? Math.max(0, tSinceEject - CHARGE_FRAMES) : 0;

            const ejectArc = isEjecting && !isCharging
              ? spring({ frame: launchFrame, fps, config: { damping: 14, stiffness: 55, mass: 0.9 } })
              : 0;

            const chargeIntensity = isCharging
              ? spring({ frame: tSinceEject, fps, config: { damping: 5, stiffness: 300, mass: 0.3 } })
              : 0;

            // Depth parallax
            const depthScale = 0.7 + ast.depth * 0.5;
            const pSpeed = ast.orbitSpeed * (0.6 + ast.depth * 0.8);

            // Spring-based orbital wobble (replace raw Math.sin)
            const wobFrame1 = (frame + ast.chroma * 50) % 200;
            const wobFrame2 = (frame + ast.chroma * 70) % 170;
            const wobSpring1 = spring({ frame: wobFrame1, fps, config: { damping: 30, stiffness: 8, mass: 4 } });
            const wobSpring2 = spring({ frame: wobFrame2, fps, config: { damping: 25, stiffness: 10, mass: 3.5 } });

            const angle = ast.baseAngle + frame * pSpeed;
            const wobX = ast.wobbleAmp * (wobSpring1 * 2 - 1);
            const wobY = ast.wobbleAmp * (wobSpring2 * 2 - 1);

            const orbitX = beltCx + beltRx * Math.cos(angle) + wobX;
            const orbitY = beltCy + beltRy * Math.sin(angle) + wobY;

            // Charge vibration
            const chargeShake = isCharging ? chargeIntensity * 3 : 0;
            const chargeX = chargeShake * Math.sin(frame * 3.7 + ast.chroma);
            const chargeY = chargeShake * Math.cos(frame * 4.1 + ast.chroma);

            // Ejection arc
            const landX = W / 2;
            const landY = pathY;

            let x: number, y: number;
            if (isEjecting && !isCharging) {
              const t = ejectArc;
              x = orbitX + (landX - orbitX) * t;
              const linearY = orbitY + (landY - orbitY) * t;
              // Parabolic arc peaking 80px above midpoint
              const arcHeight = 80;
              y = linearY - arcHeight * 4 * t * (1 - t);
            } else {
              x = orbitX + chargeX;
              y = orbitY + chargeY;
            }

            const r = ast.size * depthScale;
            const tumble = frame * ast.tumbleSpeed;

            // Active state: spring-based glow pulse
            const glowFrame = isActive ? (frame + ast.chroma * 20) % 60 : 0;
            const glowPulse = isActive
              ? 0.5 + 0.5 * spring({ frame: glowFrame, fps, config: { damping: 12, stiffness: 30, mass: 2 } })
              : 0;

            const bodyOpacity = isActive ? 1 : interpolate(ast.depth, [0, 1], [0.3, 0.6]);

            return (
              <g key={ast.chroma}>
                {/* ── Motion blur trail during ejection ── */}
                {isEjecting && !isCharging && ejectArc > 0.05 && (
                  <g>
                    {Array.from({ length: TRAIL_COUNT }, (_, ti) => {
                      const trailT = Math.max(0, ejectArc - (ti + 1) * 0.06);
                      const tx = orbitX + (landX - orbitX) * trailT;
                      const tLinearY = orbitY + (landY - orbitY) * trailT;
                      const ty = tLinearY - 80 * 4 * trailT * (1 - trailT);
                      const trailOpacity = interpolate(ti, [0, TRAIL_COUNT], [0.2, 0], { extrapolateRight: 'clamp' });
                      const trailScale = interpolate(ti, [0, TRAIL_COUNT], [0.9, 0.3]);
                      return (
                        <g key={`trail-${ast.chroma}-${ti}`}
                          transform={`translate(${tx}, ${ty}) scale(${trailScale}) rotate(${tumble - ti * 8})`}
                          opacity={trailOpacity * (1 - ejectArc * 0.5)}>
                          <path d={ast.path} fill={ast.color} stroke="none" />
                        </g>
                      );
                    })}

                    {/* Plasma streak */}
                    <line x1={orbitX} y1={orbitY} x2={x} y2={y}
                      stroke={ast.color}
                      strokeWidth={interpolate(ejectArc, [0, 1], [3, 0.5])}
                      opacity={interpolate(ejectArc, [0, 0.3, 1], [0.6, 0.4, 0])}
                      strokeLinecap="round"
                      filter="url(#bloom-soft)"
                    />

                    {/* Particle shower — spring-dispersed */}
                    {Array.from({ length: 8 }, (_, pi) => {
                      const pFrame = Math.max(0, launchFrame - pi * 0.5);
                      const pSpread = spring({ frame: pFrame, fps, config: { damping: 8, stiffness: 60, mass: 0.5 } });
                      const pAngle = sr(ast.chroma * 100 + pi * 17) * Math.PI * 2;
                      const pDist = pSpread * (20 + sr(ast.chroma * 200 + pi * 31) * 30);
                      const px = x + Math.cos(pAngle) * pDist;
                      const py = y + Math.sin(pAngle) * pDist;
                      return (
                        <circle key={`p-${ast.chroma}-${pi}`}
                          cx={px} cy={py}
                          r={interpolate(pSpread, [0, 1], [2, 0.3])}
                          fill={ast.color}
                          opacity={interpolate(pSpread, [0, 0.5, 1], [0.6, 0.3, 0])}
                          filter="url(#bloom-soft)"
                        />
                      );
                    })}

                    {/* Impact shockwave at landing */}
                    {ejectArc > 0.8 && (() => {
                      const impactT = (ejectArc - 0.8) / 0.2;
                      const impactR = interpolate(impactT, [0, 1], [5, r * 4]);
                      const impactFade = interpolate(impactT, [0, 0.3, 1], [0.5, 0.3, 0]);
                      return (
                        <>
                          <circle cx={landX} cy={landY} r={impactR}
                            fill="none" stroke={ast.color} strokeWidth={2 * (1 - impactT)}
                            opacity={impactFade} filter="url(#bloom-heavy)" />
                          <circle cx={landX} cy={landY} r={impactR * 0.5}
                            fill={ast.color} opacity={impactFade * 0.3}
                            filter="url(#bloom-heavy)" />
                        </>
                      );
                    })()}
                  </g>
                )}

                {/* ── Charge-up glow ── */}
                {isCharging && (
                  <g>
                    <circle cx={x} cy={y}
                      r={r * (1.5 + chargeIntensity * 1.5)}
                      fill={hex2rgba(ast.color, 0.1 * chargeIntensity)}
                      filter="url(#bloom-heavy)" />
                    <circle cx={x} cy={y}
                      r={r * (1 + chargeIntensity * 0.5)}
                      fill="none" stroke={ast.color}
                      strokeWidth={2 * chargeIntensity}
                      opacity={0.6 * chargeIntensity}
                      filter="url(#bloom-med)" />
                  </g>
                )}

                {/* ── 3D Asteroid body ── */}
                {(() => {
                  // Light direction rotates slowly with tumble — simulates 3D rotation
                  const lightAngle = tumble * 0.3; // slower than tumble for subtle effect
                  const lx = Math.cos(lightAngle * Math.PI / 180);
                  const ly = Math.sin(lightAngle * Math.PI / 180);
                  // Light source offset (where the bright spot is, in fraction of radius)
                  const lightOffX = -lx * 0.35;
                  const lightOffY = -ly * 0.35;
                  // Shadow side (opposite light)
                  const shadowOffX = lx * 0.25;
                  const shadowOffY = ly * 0.25;

                  const rgb = hexToRgb(ast.color);
                  const clipId = `ast-clip-${ast.chroma}`;
                  const gradBaseId = `ast-base-${ast.chroma}-${Math.floor(frame / 3)}`; // update every 3 frames
                  const gradSpecId = `ast-spec-${ast.chroma}-${Math.floor(frame / 3)}`;
                  const gradRimId = `ast-rim-${ast.chroma}-${Math.floor(frame / 3)}`;

                  return (
                    <g transform={`translate(${x}, ${y}) rotate(${tumble})`} opacity={bodyOpacity}>

                      {/* Active: energy field */}
                      {isActive && !isEjecting && (
                        <>
                          <circle cx={0} cy={0} r={r * 2.5}
                            fill="none" stroke={ast.color}
                            strokeWidth={0.4} opacity={glowPulse * 0.12}
                            filter="url(#bloom-soft)" />
                          <circle cx={0} cy={0} r={r * 1.8}
                            fill="none" stroke={ast.color}
                            strokeWidth={0.7} opacity={glowPulse * 0.2} />
                          <circle cx={0} cy={0} r={r * 1.35}
                            fill={hex2rgba(ast.color, 0.06 * glowPulse)}
                            filter="url(#bloom-heavy)" />
                        </>
                      )}

                      {/* Clip path from asteroid silhouette */}
                      <defs>
                        <clipPath id={clipId}>
                          <path d={ast.path} />
                        </clipPath>

                        {/* 3D base shading — radial gradient offset toward light */}
                        <radialGradient id={gradBaseId}
                          cx={`${50 + lightOffX * 60}%`} cy={`${50 + lightOffY * 60}%`}
                          r="65%" fx={`${50 + lightOffX * 70}%`} fy={`${50 + lightOffY * 70}%`}>
                          {isActive ? (
                            <>
                              <stop offset="0%" stopColor={`rgb(${Math.min(255, rgb.r + 60)},${Math.min(255, rgb.g + 60)},${Math.min(255, rgb.b + 60)})`} stopOpacity="0.5" />
                              <stop offset="35%" stopColor={ast.color} stopOpacity="0.35" />
                              <stop offset="70%" stopColor={ast.colorDim} stopOpacity="0.8" />
                              <stop offset="100%" stopColor="rgb(8,12,24)" stopOpacity="0.95" />
                            </>
                          ) : (
                            <>
                              <stop offset="0%" stopColor={`rgb(${Math.min(255, rgb.r * 0.4 + 40)},${Math.min(255, rgb.g * 0.4 + 40)},${Math.min(255, rgb.b * 0.4 + 40)})`} stopOpacity="0.6" />
                              <stop offset="40%" stopColor={ast.colorDim} stopOpacity="0.8" />
                              <stop offset="75%" stopColor="rgb(12,16,28)" stopOpacity="0.9" />
                              <stop offset="100%" stopColor="rgb(4,6,12)" stopOpacity="0.95" />
                            </>
                          )}
                        </radialGradient>

                        {/* Specular highlight — small bright hotspot */}
                        <radialGradient id={gradSpecId}
                          cx={`${50 + lightOffX * 75}%`} cy={`${50 + lightOffY * 75}%`}
                          r="30%">
                          <stop offset="0%" stopColor="#fff" stopOpacity={isActive ? '0.35' : '0.08'} />
                          <stop offset="40%" stopColor="#fff" stopOpacity={isActive ? '0.1' : '0.02'} />
                          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
                        </radialGradient>

                        {/* Rim light — opposite to shadow, edge glow */}
                        <radialGradient id={gradRimId}
                          cx={`${50 - shadowOffX * 100}%`} cy={`${50 - shadowOffY * 100}%`}
                          r="55%">
                          <stop offset="70%" stopColor={ast.color} stopOpacity="0" />
                          <stop offset="90%" stopColor={ast.color} stopOpacity={isActive ? '0.25' : '0.06'} />
                          <stop offset="100%" stopColor={ast.color} stopOpacity={isActive ? '0.4' : '0.1'} />
                        </radialGradient>
                      </defs>

                      {/* Drop shadow — offset toward shadow side */}
                      <path d={ast.path}
                        fill="rgba(0,0,0,0.6)"
                        transform={`translate(${shadowOffX * 6}, ${shadowOffY * 6})`}
                        opacity={0.3}
                        filter="url(#bloom-soft)"
                      />

                      {/* ── Clipped 3D layers ── */}
                      <g clipPath={`url(#${clipId})`}>
                        {/* Layer 1: Base 3D shading */}
                        <rect x={-r * 1.2} y={-r * 1.2} width={r * 2.4} height={r * 2.4}
                          fill={`url(#${gradBaseId})`} />

                        {/* Layer 2: Surface color tint */}
                        <rect x={-r * 1.2} y={-r * 1.2} width={r * 2.4} height={r * 2.4}
                          fill={isActive ? hex2rgba(ast.color, 0.08) : hex2rgba(ast.color, 0.03)} />

                        {/* Layer 3: Rocky texture — dashed arcs simulating surface roughness */}
                        {[0.3, 0.5, 0.7].map((dist, ti) => {
                          const texAngle = lightAngle + ti * 40;
                          return (
                            <ellipse key={`tex-${ti}`}
                              cx={Math.cos(texAngle * Math.PI / 180) * r * dist * 0.2}
                              cy={Math.sin(texAngle * Math.PI / 180) * r * dist * 0.2}
                              rx={r * dist} ry={r * dist * (0.7 + sr(ast.chroma * 50 + ti) * 0.3)}
                              fill="none"
                              stroke={isActive ? hex2rgba(ast.color, 0.08) : 'rgba(148,163,184,0.04)'}
                              strokeWidth={0.5 + sr(ast.chroma * 60 + ti) * 0.5}
                              strokeDasharray={`${1 + sr(ast.chroma * 70 + ti) * 3} ${3 + sr(ast.chroma * 80 + ti) * 6}`}
                              transform={`rotate(${sr(ast.chroma * 90 + ti) * 360})`}
                            />
                          );
                        })}

                        {/* Layer 4: Ridges — curved surface lines */}
                        {ast.ridges.map((ridge, ri) => (
                          <path key={`ridge-${ri}`}
                            d={`M ${ridge.x1} ${ridge.y1} Q ${ridge.cpx} ${ridge.cpy} ${ridge.x2} ${ridge.y2}`}
                            fill="none"
                            stroke={isActive ? hex2rgba(ast.color, 0.12) : 'rgba(148,163,184,0.05)'}
                            strokeWidth={0.6 + sr(ast.chroma * 110 + ri) * 0.8}
                            strokeLinecap="round"
                          />
                        ))}

                        {/* Layer 5: 3D Craters with directional light */}
                        {ast.craters.map((cr, ci) => {
                          // Shadow inside crater falls toward light direction
                          const crShadowX = lx * cr.r * 0.4 * cr.depth;
                          const crShadowY = ly * cr.r * 0.4 * cr.depth;
                          // Highlight rim on light-facing side
                          const crHighX = -lx * cr.r * 0.5;
                          const crHighY = -ly * cr.r * 0.5;

                          return (
                            <g key={`cr-${ci}`}>
                              {/* Crater depression — dark fill */}
                              <circle cx={cr.cx} cy={cr.cy} r={cr.r}
                                fill={isActive
                                  ? hex2rgba(ast.color, 0.06)
                                  : `rgba(0,0,0,${0.12 + cr.depth * 0.15})`}
                              />
                              {/* Inner shadow (offset by light direction) */}
                              <ellipse
                                cx={cr.cx + crShadowX} cy={cr.cy + crShadowY}
                                rx={cr.r * 0.7} ry={cr.r * 0.5}
                                fill={`rgba(0,0,0,${0.15 + cr.depth * 0.2})`}
                              />
                              {/* Rim highlight on lit side */}
                              <ellipse
                                cx={cr.cx + crHighX} cy={cr.cy + crHighY}
                                rx={cr.r * 0.55} ry={cr.r * 0.25}
                                fill={isActive
                                  ? hex2rgba(ast.color, 0.2)
                                  : `rgba(226,232,240,${0.03 + cr.depth * 0.03})`}
                              />
                              {/* Crater ring */}
                              <circle cx={cr.cx} cy={cr.cy} r={cr.r}
                                fill="none"
                                stroke={isActive
                                  ? hex2rgba(ast.color, 0.15)
                                  : 'rgba(100,116,139,0.08)'}
                                strokeWidth={0.4}
                              />
                            </g>
                          );
                        })}

                        {/* Layer 6: Specular highlight */}
                        <rect x={-r * 1.2} y={-r * 1.2} width={r * 2.4} height={r * 2.4}
                          fill={`url(#${gradSpecId})`} />

                        {/* Layer 7: Rim light */}
                        <rect x={-r * 1.2} y={-r * 1.2} width={r * 2.4} height={r * 2.4}
                          fill={`url(#${gradRimId})`} />
                      </g>

                      {/* Outline — thin with glow when active */}
                      <path d={ast.path}
                        fill="none"
                        stroke={isActive ? ast.color : hex2rgba(ast.color, 0.15)}
                        strokeWidth={isActive ? 1.2 : 0.4}
                        filter={isActive ? 'url(#bloom-soft)' : undefined}
                      />

                      {/* Note label — counter-rotate so text stays readable */}
                      <g transform={`rotate(${-tumble})`}>
                        {/* Label shadow for readability */}
                        <text x={0.5} y={1.5}
                          textAnchor="middle" dominantBaseline="central"
                          fontFamily="'SF Mono', 'Fira Code', monospace"
                          fontSize={Math.max(10, r * 0.48)}
                          fontWeight={800}
                          fill="rgba(0,0,0,0.5)">
                          {ast.displayName}
                        </text>
                        <text x={0} y={1}
                          textAnchor="middle" dominantBaseline="central"
                          fontFamily="'SF Mono', 'Fira Code', monospace"
                          fontSize={Math.max(10, r * 0.48)}
                          fontWeight={800}
                          fill={isActive ? '#fff' : hex2rgba(ast.color, 0.8)}
                          filter={isActive ? 'url(#bloom-soft)' : undefined}>
                          {ast.displayName}
                        </text>
                      </g>
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* ══════════ LAYER 5: CHORD PROGRESSION PATH ══════════ */}

          {(() => {
            const hasChords = chordProgression.length > 0;
            const railW = hasChords ? Math.max(chordProgression.length * pathStepX + 50, W * 0.65) : W * 0.45;
            const railX = hasChords ? pathStartX - 25 : W * 0.275;

            return (
              <g>
                {/* Rail with frosted glass effect */}
                <rect x={railX} y={pathY - 28} width={railW} height={56}
                  rx={12} fill="rgba(4, 8, 16, 0.75)"
                  stroke="rgba(103,232,249,0.05)" strokeWidth={0.5} />
                {/* Top edge highlight */}
                <line x1={railX + 12} y1={pathY - 28} x2={railX + railW - 12} y2={pathY - 28}
                  stroke="rgba(103,232,249,0.06)" strokeWidth={0.5} />
                {/* Center guide */}
                <line x1={railX + 12} y1={pathY} x2={railX + railW - 12} y2={pathY}
                  stroke="rgba(103,232,249,0.025)" strokeWidth={0.5} />

                {hasChords && (
                  <g>
                    {/* Energy beam connections with traveling particles */}
                    {chordProgression.map((_, i) => {
                      if (i === 0) return null;
                      const x1 = pathStartX + (i - 1) * pathStepX;
                      const x2 = pathStartX + i * pathStepX;
                      const isPlaySeg = playbackIndex >= 0 && (i === playbackIndex || i - 1 === playbackIndex);

                      // Spring-based beam appearance
                      const beamAge = Math.max(0, frame - nodeAddedFrameRef.current);
                      const beamOpacity = i === chordProgression.length - 1
                        ? spring({ frame: Math.min(beamAge, 20), fps, config: { damping: 12, stiffness: 100, mass: 0.5 } }) * 0.15
                        : 0.08;

                      return (
                        <g key={`beam-${i}`}>
                          {/* Glow layer */}
                          <line x1={x1} y1={pathY} x2={x2} y2={pathY}
                            stroke={isPlaySeg ? '#fbbf24' : '#67e8f9'}
                            strokeWidth={isPlaySeg ? 4 : 2}
                            opacity={isPlaySeg ? 0.15 : beamOpacity * 0.5}
                            filter="url(#bloom-soft)" />
                          {/* Core beam */}
                          <line x1={x1} y1={pathY} x2={x2} y2={pathY}
                            stroke={isPlaySeg ? 'rgba(251,191,36,0.4)' : 'rgba(103,232,249,0.12)'}
                            strokeWidth={isPlaySeg ? 1.5 : 0.8} />
                          {/* Traveling particle */}
                          {(() => {
                            const pT = (frame * 0.025 + i * 0.3) % 1;
                            return (
                              <circle cx={x1 + (x2 - x1) * pT} cy={pathY}
                                r={isPlaySeg ? 2 : 1.2}
                                fill={isPlaySeg ? '#fbbf24' : '#67e8f9'}
                                opacity={0.5} filter="url(#bloom-soft)" />
                            );
                          })()}
                        </g>
                      );
                    })}

                    {/* Chord nodes */}
                    {chordProgression.map((chord, i) => {
                      const cx = pathStartX + i * pathStepX;
                      const cy = pathY;
                      const isPlay = i === playbackIndex;
                      const isLoop = loopRegion != null && i >= loopRegion[0] && i <= loopRegion[1];

                      const rootMatch = chord.match(/^([A-G][b#]?)/);
                      const rootName = rootMatch ? rootMatch[1] : 'C';
                      const rootChroma = DISPLAY_NAMES.indexOf(rootName);
                      const nodeColor = rootChroma >= 0 ? NOTE_COLORS[rootChroma] : '#67e8f9';
                      const isMinor = chord.includes('m') && !chord.includes('maj');
                      const isDim = chord.includes('dim');

                      // Spring entrance
                      const nodeAge = Math.max(0, frame - nodeAddedFrameRef.current);
                      const isNewest = i === chordProgression.length - 1;
                      const entranceSpring = isNewest
                        ? spring({ frame: Math.min(nodeAge, 30), fps, config: { damping: 8, stiffness: 80, mass: 0.7 } })
                        : 1;
                      const nodeR = 18 * entranceSpring;

                      // Playback glow pulse (spring-based)
                      const playGlowFrame = isPlay ? (frame % 40) : 0;
                      const playGlow = isPlay
                        ? spring({ frame: playGlowFrame, fps, config: { damping: 12, stiffness: 30, mass: 2 } })
                        : 0;

                      return (
                        <g key={`node-${i}`}>
                          {isLoop && (
                            <rect x={cx - pathStepX / 2} y={cy - 26} width={pathStepX} height={52}
                              fill="rgba(251,191,36,0.025)" rx={6} />
                          )}

                          {/* Playback rings */}
                          {isPlay && (
                            <>
                              <circle cx={cx} cy={cy}
                                r={nodeR + 16 + playGlow * 6}
                                fill="none" stroke="#fbbf24" strokeWidth={0.4}
                                opacity={0.25} filter="url(#bloom-heavy)" />
                              <circle cx={cx} cy={cy}
                                r={nodeR + 9 + playGlow * 3}
                                fill="none" stroke="#fbbf24" strokeWidth={1.5}
                                opacity={0.5} filter="url(#bloom-med)" />
                            </>
                          )}

                          {/* Outer halo */}
                          <circle cx={cx} cy={cy} r={nodeR + 4}
                            fill="none" stroke={nodeColor}
                            strokeWidth={0.3} opacity={isPlay ? 0.5 : 0.2} />

                          {/* Node body */}
                          <circle cx={cx} cy={cy} r={nodeR}
                            fill={isPlay ? hex2rgba(nodeColor, 0.45) : hex2rgba(nodeColor, 0.08)}
                            stroke={nodeColor}
                            strokeWidth={isPlay ? 2 : 0.8}
                            filter={isPlay ? 'url(#bloom-med)' : undefined}
                          />

                          {/* Inner highlight */}
                          <circle cx={cx - nodeR * 0.2} cy={cy - nodeR * 0.2}
                            r={nodeR * 0.4}
                            fill={hex2rgba(nodeColor, isPlay ? 0.15 : 0.04)} />

                          {/* Quality shapes */}
                          {isMinor && !isDim && (
                            <polygon
                              points={`${cx},${cy - nodeR + 5} ${cx - nodeR + 6},${cy + nodeR - 7} ${cx + nodeR - 6},${cy + nodeR - 7}`}
                              fill="none" stroke={nodeColor} strokeWidth={0.5} opacity={0.3} />
                          )}
                          {isDim && (
                            <rect x={cx - nodeR + 7} y={cy - nodeR + 7}
                              width={(nodeR - 7) * 2} height={(nodeR - 7) * 2}
                              fill="none" stroke={nodeColor} strokeWidth={0.5} opacity={0.3}
                              transform={`rotate(45, ${cx}, ${cy})`} />
                          )}

                          {/* Chord label */}
                          <text x={cx} y={cy + 1}
                            textAnchor="middle" dominantBaseline="central"
                            fontFamily="'SF Mono', 'Fira Code', monospace"
                            fontSize={10} fontWeight={700}
                            fill={isPlay ? '#fff' : nodeColor}
                            filter={isPlay ? 'url(#bloom-soft)' : undefined}>
                            {chord}
                          </text>
                          <text x={cx} y={cy + nodeR + 12}
                            textAnchor="middle"
                            fontFamily="'SF Mono', monospace" fontSize={7}
                            fill="#475569" opacity={0.5}>
                            {i + 1}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                )}

                {/* Empty state */}
                {!hasChords && !detectedChord && (
                  <text x={W / 2} y={pathY + 1} textAnchor="middle"
                    fontFamily="'SF Pro Display', system-ui"
                    fontSize={12} fill="#475569" opacity={0.35} letterSpacing={2}>
                    PLAY CHORDS TO BUILD A PROGRESSION
                  </text>
                )}

                {hasChords && (
                  <text x={pathStartX + chordProgression.length * pathStepX + 22} y={pathY + 3}
                    fontFamily="'SF Mono', monospace" fontSize={9} fill="#475569" opacity={0.4}>
                    {chordProgression.length}
                  </text>
                )}
              </g>
            );
          })()}

          {/* ══════════ LAYER 6: DETECTED CHORD HUD ══════════ */}

          {detectedChord && (() => {
            const rootMatch = detectedChord.match(/^([A-G][b#]?)/);
            const rootName = rootMatch ? rootMatch[1] : 'C';
            const rootChroma = DISPLAY_NAMES.indexOf(rootName);
            const chordColor = rootChroma >= 0 ? NOTE_COLORS[rootChroma] : '#67e8f9';

            const timeSinceChord = frame - chordEventFrameRef.current;
            const hudEntrance = spring({
              frame: Math.min(Math.max(0, timeSinceChord), 20),
              fps,
              config: { damping: 10, stiffness: 120, mass: 0.5 },
            });
            const hudScale = interpolate(hudEntrance, [0, 1], [0.6, 1]);
            const hudOpacity = interpolate(hudEntrance, [0, 1], [0, 0.9]);

            return (
              <g transform={`translate(${W / 2}, ${H * 0.6}) scale(${hudScale})`} opacity={hudOpacity}>
                {/* Aura */}
                <circle cx={0} cy={0} r={70}
                  fill={hex2rgba(chordColor, 0.03)} filter="url(#bloom-heavy)" />
                <circle cx={0} cy={0} r={45}
                  fill={hex2rgba(chordColor, 0.02)} filter="url(#bloom-med)" />

                {/* Chord name */}
                <text x={0} y={-4} textAnchor="middle" dominantBaseline="central"
                  fontFamily="'SF Pro Display', system-ui"
                  fontSize={40} fontWeight={200}
                  fill={chordColor} letterSpacing={4}
                  filter="url(#bloom-soft)">
                  {detectedChord}
                </text>
                <text x={0} y={22} textAnchor="middle"
                  fontFamily="'SF Mono', monospace"
                  fontSize={9} fill="#64748b" opacity={0.5}>
                  {activeNotes.length} note{activeNotes.length !== 1 ? 's' : ''} active
                </text>
              </g>
            );
          })()}

        </g>{/* end camera shake group */}
      </svg>
    </AbsoluteFill>
  );
};

export default AsteroidChordBuilder;
