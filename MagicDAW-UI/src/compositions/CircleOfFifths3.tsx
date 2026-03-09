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
const CX = 680;
const CY = H / 2;

const OUTER_R = 320;
const MIDDLE_R = 240;
const INNER_R = 160;

const MAJORS = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F'];
const MINORS = ['Am','Em','Bm','F#m','C#m','G#m','Ebm','Bbm','Fm','Cm','Gm','Dm'];
const DIMS   = ['Bdim','F#dim','C#dim','G#dim','D#dim','A#dim','Fdim','Cdim','Gdim','Ddim','Adim','Edim'];

const palette = {
  bg:         '#050508',
  gridLine:   '#1a1a2e',
  contour:    '#1e293b',
  primary:    '#60a5fa',
  secondary:  '#93c5fd',
  accent:     '#34d399',
  danger:     '#ef4444',
  text:       '#9ca3af',
  textDim:    '#4b5563',
  node:       '#1e293b',
  nodeBorder: '#374151',
};

const FONT = "'JetBrains Mono', 'SF Mono', monospace";

// ── Helpers ────────────────────────────────────────────────────────────────

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49271;
  return x - Math.floor(x);
}

function fifthsDistance(a: string, b: string): number {
  const normalize = (k: string) => k.replace('m', '').replace('dim', '');
  const idxA = MAJORS.indexOf(normalize(a));
  const idxB = MAJORS.indexOf(normalize(b));
  if (idxA === -1 || idxB === -1) return 6;
  const d = Math.abs(idxB - idxA);
  return Math.min(d, 12 - d);
}

function keyIndex(key: string): number {
  const idx = MAJORS.indexOf(key);
  if (idx !== -1) return idx;
  const mi = MINORS.indexOf(key);
  if (mi !== -1) return mi;
  const di = DIMS.indexOf(key);
  if (di !== -1) return di;
  return 0;
}

function posOnRing(index: number, radius: number): { x: number; y: number } {
  const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
  return { x: CX + Math.cos(angle) * radius, y: CY + Math.sin(angle) * radius };
}

function angleOnRing(index: number): number {
  return (index / 12) * Math.PI * 2 - Math.PI / 2;
}

// ── Component ──────────────────────────────────────────────────────────────

export const CircleOfFifths3: React.FC<CircleOfFifthsProps> = ({
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
  const activeFullKey = activeMode === 'minor'
    ? MINORS[MAJORS.indexOf(activeKey)] ?? activeKey
    : activeKey;
  const activeIdx = keyIndex(activeFullKey);

  const playedIndices = useMemo(
    () => new Set(activeNotes.map((n) => ((n % 12) * 7) % 12)),
    [activeNotes],
  );

  // ── Zoom into played node's quadrant
  const zoom = useCircleZoom({
    playedIndices,
    cx: CX, cy: CY, outerR: OUTER_R,
    fullW: W, fullH: H,
    frame, fps,
    zoomFraction: 0.5,
  });

  const detectedRing = useMemo(() => chordToRingIndex(detectedChord), [detectedChord]);

  const primaryPlayedIdx = useMemo(() => {
    if (playedIndices.size === 0) return -1;
    return playedIndices.values().next().value!;
  }, [playedIndices]);

  // ── Gravity well contour lines ───────────────────────────────────────
  const contourLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    for (let i = 1; i <= 8; i++) {
      const r = 30 + i * 18;
      lines.push(
        <ellipse
          key={`contour-${i}`}
          cx={0}
          cy={0}
          rx={r * 1.15}
          ry={r}
          fill="none"
          stroke={palette.contour}
          strokeWidth={0.6}
          strokeDasharray={`${3 + i} ${6 + i * 2}`}
          opacity={0.08 + 0.02 * Math.sin(frame * 0.02 + i * 0.7)}
        />,
      );
    }
    return lines;
  }, [frame]);

  // ── Grid background ──────────────────────────────────────────────────
  const gridLines = useMemo(() => {
    const g: React.ReactNode[] = [];
    const spacing = 60;
    for (let x = 0; x <= W; x += spacing) {
      g.push(
        <line key={`gv-${x}`} x1={x} y1={0} x2={x} y2={H}
          stroke={palette.gridLine} strokeWidth={0.4} opacity={0.3} />,
      );
    }
    for (let y = 0; y <= H; y += spacing) {
      g.push(
        <line key={`gh-${y}`} x1={0} y1={y} x2={W} y2={y}
          stroke={palette.gridLine} strokeWidth={0.4} opacity={0.3} />,
      );
    }
    return g;
  }, []);

  // ── Gravity well around active key ───────────────────────────────────
  const activePos = posOnRing(
    activeMode === 'minor' ? MINORS.indexOf(activeFullKey) : MAJORS.indexOf(activeKey),
    activeMode === 'minor' ? MIDDLE_R : OUTER_R,
  );

  const gravityWell = useMemo(() => {
    const rings: React.ReactNode[] = [];
    for (let i = 1; i <= 12; i++) {
      const baseR = 8 + i * 7;
      const breathe = Math.sin(frame * 0.015 + i * 0.5) * 2;
      const r = baseR + breathe;
      rings.push(
        <circle
          key={`gwell-${i}`}
          cx={activePos.x}
          cy={activePos.y}
          r={r}
          fill="none"
          stroke={palette.primary}
          strokeWidth={interpolate(i, [1, 12], [1.2, 0.3])}
          opacity={interpolate(i, [1, 12], [0.25, 0.04])}
        />,
      );
    }
    return rings;
  }, [frame, activePos.x, activePos.y]);

  // ── Accretion particles per node ─────────────────────────────────────
  const accretionParticles = useMemo(() => {
    const particles: React.ReactNode[] = [];
    const allKeys = [
      ...MAJORS.map((k, i) => ({ key: k, ring: 'major' as const, idx: i, r: OUTER_R })),
      ...MINORS.map((k, i) => ({ key: k, ring: 'minor' as const, idx: i, r: MIDDLE_R })),
      ...DIMS.map((k, i) => ({ key: k, ring: 'dim' as const, idx: i, r: INNER_R })),
    ];

    allKeys.forEach(({ key, idx, r }, ki) => {
      const dist = fifthsDistance(key, activeKey);
      const count = dist <= 1 ? 8 : dist <= 3 ? 5 : 3;
      const speed = 1 / (dist + 1);
      const pos = posOnRing(idx, r);

      for (let p = 0; p < count; p++) {
        const seed = ki * 100 + p;
        const orbitR = 6 + seededRandom(seed) * 14;
        const phase = seededRandom(seed + 1) * Math.PI * 2;
        const t = frame * 0.02 * speed + phase;
        const px = pos.x + Math.cos(t) * orbitR;
        const py = pos.y + Math.sin(t) * orbitR * 0.7;
        const size = 0.6 + seededRandom(seed + 2) * 0.8;

        particles.push(
          <circle
            key={`ap-${ki}-${p}`}
            cx={px}
            cy={py}
            r={size}
            fill={dist <= 1 ? palette.primary : palette.textDim}
            opacity={interpolate(dist, [0, 6], [0.6, 0.15])}
          />,
        );
      }
    });
    return particles;
  }, [frame, activeKey]);

  // ── Connection lines with Lagrange points ────────────────────────────
  const connections = useMemo(() => {
    const lines: React.ReactNode[] = [];
    // Connect each major to its relative minor (same index)
    for (let i = 0; i < 12; i++) {
      const from = posOnRing(i, OUTER_R);
      const to = posOnRing(i, MIDDLE_R);
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      const pulse = 0.3 + 0.15 * Math.sin(frame * 0.03 + i * 0.5);

      lines.push(
        <g key={`conn-mr-${i}`}>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke={palette.contour} strokeWidth={0.5} opacity={0.2} />
          <rect x={midX - 2} y={midY - 2} width={4} height={4}
            fill="none" stroke={palette.primary} strokeWidth={0.6}
            opacity={pulse}
            transform={`rotate(45, ${midX}, ${midY})`} />
        </g>,
      );
    }
    // Connect each minor to its diminished (same index)
    for (let i = 0; i < 12; i++) {
      const from = posOnRing(i, MIDDLE_R);
      const to = posOnRing(i, INNER_R);
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      const pulse = 0.2 + 0.1 * Math.sin(frame * 0.025 + i * 0.7);

      lines.push(
        <g key={`conn-md-${i}`}>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke={palette.contour} strokeWidth={0.4} opacity={0.12} />
          <rect x={midX - 1.5} y={midY - 1.5} width={3} height={3}
            fill="none" stroke={palette.textDim} strokeWidth={0.5}
            opacity={pulse}
            transform={`rotate(45, ${midX}, ${midY})`} />
        </g>,
      );
    }
    // Adjacent fifths connections on outer ring
    for (let i = 0; i < 12; i++) {
      const next = (i + 1) % 12;
      const from = posOnRing(i, OUTER_R);
      const to = posOnRing(next, OUTER_R);
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;

      lines.push(
        <g key={`conn-fifth-${i}`}>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke={palette.gridLine} strokeWidth={0.4} opacity={0.15} />
          <rect x={midX - 1.5} y={midY - 1.5} width={3} height={3}
            fill="none" stroke={palette.secondary} strokeWidth={0.4}
            opacity={0.15 + 0.08 * Math.sin(frame * 0.02 + i)}
            transform={`rotate(45, ${midX}, ${midY})`} />
        </g>,
      );
    }
    return lines;
  }, [frame]);

  // ── Flowing particles between connected keys ─────────────────────────
  const flowParticles = useMemo(() => {
    const parts: React.ReactNode[] = [];
    for (let i = 0; i < 12; i++) {
      const from = posOnRing(i, OUTER_R);
      const to = posOnRing(i, MIDDLE_R);
      const t = ((frame * 0.008 + i * 0.3) % 1);
      const px = from.x + (to.x - from.x) * t;
      const py = from.y + (to.y - from.y) * t;
      parts.push(
        <circle key={`flow-${i}`} cx={px} cy={py} r={1}
          fill={palette.primary} opacity={0.3 * (1 - Math.abs(t - 0.5) * 2)} />,
      );
    }
    return parts;
  }, [frame]);

  // ── Key nodes ────────────────────────────────────────────────────────
  const renderNode = (
    key: string,
    index: number,
    radius: number,
    ring: 'major' | 'minor' | 'dim',
  ) => {
    const pos = posOnRing(index, radius);
    const dist = fifthsDistance(key, activeKey);
    const isActive =
      (ring === 'major' && key === activeKey && activeMode === 'major') ||
      (ring === 'minor' && key === activeFullKey && activeMode === 'minor');
    const isDetected = detectedChord !== null && key === detectedChord;
    const isDetectedMinor = ring === 'minor' && detectedRing.ring === 'minor' && detectedRing.index === index;
    const isDetectedDim = ring === 'dim' && detectedRing.ring === 'dim' && detectedRing.index === index;
    const isRingDetected = isDetected || isDetectedMinor || isDetectedDim;
    const isHighlighted = highlightedDegrees.includes(index);
    const isPlayed = ring === 'major' && playedIndices.has(index);

    // Harmonic mass — size
    const baseSize = ring === 'major' ? 22 : ring === 'minor' ? 17 : 12;
    const massScale = isActive ? 1.6 : isRingDetected ? 1.3 : isPlayed ? 1.25 : interpolate(dist, [0, 6], [1.15, 0.85]);
    const nodeR = baseSize * massScale;

    // Color
    let strokeColor = palette.nodeBorder;
    let fillColor = palette.node;
    let textColor = palette.text;
    let glowOp = 0;

    if (isActive) {
      strokeColor = palette.accent;
      fillColor = '#0a2520';
      textColor = palette.accent;
      glowOp = 0.35 + 0.1 * Math.sin(frame * 0.04);
    } else if (isDetectedMinor) {
      strokeColor = palette.accent;
      fillColor = '#0a2520';
      textColor = palette.accent;
      glowOp = 0.3 + 0.08 * Math.sin(frame * 0.05);
    } else if (isDetectedDim) {
      strokeColor = palette.danger;
      fillColor = '#1a0a0a';
      textColor = palette.danger;
      glowOp = 0.3 + 0.08 * Math.sin(frame * 0.05);
    } else if (isDetected) {
      strokeColor = palette.primary;
      fillColor = '#0c1629';
      textColor = palette.primary;
      glowOp = 0.25;
    } else if (isPlayed) {
      strokeColor = palette.primary;
      fillColor = '#0c1629';
      textColor = palette.secondary;
      glowOp = 0.2;
    } else if (isHighlighted) {
      strokeColor = palette.secondary;
      textColor = palette.secondary;
      glowOp = 0.12;
    } else if (dist <= 1) {
      strokeColor = '#475569';
      textColor = '#cbd5e1';
    }

    const tensionColor = dist >= 5 ? palette.danger : undefined;
    if (tensionColor && !isActive && !isRingDetected) {
      strokeColor = tensionColor;
      textColor = tensionColor;
    }

    const fontSize = ring === 'major' ? 11 : ring === 'minor' ? 9.5 : 7.5;

    return (
      <g key={`node-${ring}-${index}`}>
        {glowOp > 0 && (
          <circle cx={pos.x} cy={pos.y} r={nodeR + 8}
            fill={isActive ? palette.accent : isDetectedMinor ? palette.accent : isDetectedDim ? palette.danger : palette.primary}
            opacity={glowOp} filter="url(#glow)" />
        )}
        <circle
          cx={pos.x} cy={pos.y} r={nodeR}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={isActive ? 2 : 1}
          opacity={0.9}
        />
        <text
          x={pos.x} y={pos.y + 1}
          textAnchor="middle"
          dominantBaseline="central"
          fill={textColor}
          fontSize={fontSize}
          fontFamily={FONT}
          fontWeight={isActive ? 700 : 400}
        >
          {key}
        </text>
      </g>
    );
  };

  // ── Pathfinder: Hohmann transfer ellipses ────────────────────────────
  const pathfinderArc = useMemo(() => {
    if (!pathfinderFrom || !pathfinderTo || pathfinderPaths.length === 0) return null;
    const elements: React.ReactNode[] = [];

    pathfinderPaths.forEach((path, pi) => {
      if (path.length < 2) return;
      for (let s = 0; s < path.length - 1; s++) {
        const fromKey = path[s];
        const toKey = path[s + 1];
        const fromIdx = keyIndex(fromKey);
        const toIdx = keyIndex(toKey);
        const fromRing = MAJORS.includes(fromKey) ? OUTER_R : MINORS.includes(fromKey) ? MIDDLE_R : INNER_R;
        const toRing = MAJORS.includes(toKey) ? OUTER_R : MINORS.includes(toKey) ? MIDDLE_R : INNER_R;
        const from = posOnRing(fromIdx, fromRing);
        const to = posOnRing(toIdx, toRing);

        // Hohmann half-ellipse via SVG arc
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const rx = dist / 2;
        const ry = dist * 0.3;

        elements.push(
          <path
            key={`hohmann-${pi}-${s}`}
            d={`M ${from.x} ${from.y} A ${rx} ${ry} 0 0 1 ${to.x} ${to.y}`}
            fill="none"
            stroke={palette.primary}
            strokeWidth={1.2}
            strokeDasharray="4 3"
            opacity={0.5}
          />,
        );

        // Particle along the arc
        const t = ((frame * 0.012 + pi * 0.4 + s * 0.2) % 1);
        const arcAngle = t * Math.PI;
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        const perpX = -(to.y - from.y) / dist;
        const perpY = (to.x - from.x) / dist;
        const px = from.x + dx * t + perpX * Math.sin(arcAngle) * ry;
        const py = from.y + dy * t + perpY * Math.sin(arcAngle) * ry;

        elements.push(
          <circle key={`hp-${pi}-${s}`} cx={px} cy={py} r={2.5}
            fill={palette.primary} opacity={0.8} />,
        );

        // Trail behind particle
        for (let tr = 1; tr <= 5; tr++) {
          const tt = ((frame * 0.012 + pi * 0.4 + s * 0.2 - tr * 0.03) % 1 + 1) % 1;
          const ta = tt * Math.PI;
          const tx = from.x + dx * tt + perpX * Math.sin(ta) * ry;
          const ty = from.y + dy * tt + perpY * Math.sin(ta) * ry;
          elements.push(
            <circle key={`ht-${pi}-${s}-${tr}`} cx={tx} cy={ty} r={1.5 - tr * 0.2}
              fill={palette.secondary} opacity={0.4 - tr * 0.07} />,
          );
        }

        // Delta-V annotations
        if (s === 0) {
          elements.push(
            <text key={`dv-start-${pi}`} x={from.x + 12} y={from.y - 14}
              fill={palette.primary} fontSize={8} fontFamily={FONT} opacity={0.7}>
              {`\u0394v\u2081`}
            </text>,
          );
        }
        if (s === path.length - 2) {
          elements.push(
            <text key={`dv-end-${pi}`} x={to.x + 12} y={to.y - 14}
              fill={palette.primary} fontSize={8} fontFamily={FONT} opacity={0.7}>
              {`\u0394v\u2082`}
            </text>,
          );
        }
      }
    });

    return elements;
  }, [frame, pathfinderFrom, pathfinderTo, pathfinderPaths]);

  // ── Ring orbit lines ─────────────────────────────────────────────────
  const ringOrbits = useMemo(() => {
    const pulse1 = 0.18 + 0.04 * Math.sin(frame * 0.018);
    const pulse2 = 0.14 + 0.03 * Math.sin(frame * 0.022 + 1);
    const pulse3 = 0.10 + 0.02 * Math.sin(frame * 0.026 + 2);
    return (
      <g>
        <circle cx={CX} cy={CY} r={OUTER_R} fill="none"
          stroke={palette.contour} strokeWidth={0.6}
          strokeDasharray="2 8" opacity={pulse1} />
        <circle cx={CX} cy={CY} r={MIDDLE_R} fill="none"
          stroke={palette.contour} strokeWidth={0.5}
          strokeDasharray="2 10" opacity={pulse2} />
        <circle cx={CX} cy={CY} r={INNER_R} fill="none"
          stroke={palette.contour} strokeWidth={0.4}
          strokeDasharray="1 12" opacity={pulse3} />
      </g>
    );
  }, [frame]);

  // ── Data readout panel ───────────────────────────────────────────────
  const dataPanel = useMemo(() => {
    const detDist = detectedChord ? fifthsDistance(detectedChord, activeKey) : 0;
    const gravity = detectedChord
      ? interpolate(detDist, [0, 6], [100, 0], { extrapolateRight: 'clamp' })
      : 100;
    const tension = detectedChord
      ? interpolate(detDist, [0, 6], [0, 1], { extrapolateRight: 'clamp' })
      : 0;

    const modeMap: Record<string, string> = {
      major: 'Ionian', minor: 'Aeolian',
    };
    const modeName = modeMap[activeMode] ?? activeMode;

    const panelX = 1340;
    const panelY = 180;
    const lineH = 22;
    const panelW = 420;
    const panelH = 260;

    const borderOp = 0.2 + 0.05 * Math.sin(frame * 0.02);

    const lines = [
      { label: 'HARMONIC FIELD ANALYSIS', header: true },
      { label: '', separator: true },
      { label: 'Active Key', value: `${activeKey} ${activeMode.charAt(0).toUpperCase() + activeMode.slice(1)}` },
      { label: 'Detected', value: detectedChord ?? '---' },
      { label: 'Fifths Dist', value: detectedChord ? `${detDist}` : '---' },
      { label: 'Gravity', value: `${gravity.toFixed(1)}%` },
      { label: 'Tension', value: tension.toFixed(2) },
      { label: 'Mode', value: modeName },
      { label: 'Active Notes', value: `${activeNotes.length}` },
      { label: 'Progression', value: chordProgression.length > 0 ? chordProgression.slice(-4).join(' \u2192 ') : '---' },
    ];

    return (
      <g>
        {/* Panel background */}
        <rect x={panelX} y={panelY} width={panelW} height={panelH}
          fill={palette.bg} stroke={palette.contour} strokeWidth={1}
          opacity={0.85} rx={2} />
        {/* Corner accents */}
        {[[panelX, panelY], [panelX + panelW, panelY],
          [panelX, panelY + panelH], [panelX + panelW, panelY + panelH]].map(([cx, cy], ci) => (
          <rect key={`corner-${ci}`}
            x={cx as number - 2} y={cy as number - 2} width={4} height={4}
            fill={palette.primary} opacity={borderOp} />
        ))}
        {/* Lines */}
        {lines.map((l, li) => {
          const ly = panelY + 24 + li * lineH;
          if (l.header) {
            return (
              <text key={`dl-${li}`} x={panelX + panelW / 2} y={ly}
                textAnchor="middle" fill={palette.primary}
                fontSize={11} fontFamily={FONT} fontWeight={700}
                opacity={0.9}>
                {l.label}
              </text>
            );
          }
          if (l.separator) {
            return (
              <line key={`dl-${li}`}
                x1={panelX + 12} y1={ly - 6} x2={panelX + panelW - 12} y2={ly - 6}
                stroke={palette.contour} strokeWidth={0.6} opacity={0.4} />
            );
          }
          const valColor = l.label === 'Tension' && tension > 0.7
            ? palette.danger
            : l.label === 'Gravity' && gravity > 80
              ? palette.accent
              : palette.text;
          return (
            <g key={`dl-${li}`}>
              <text x={panelX + 16} y={ly}
                fill={palette.textDim} fontSize={9.5} fontFamily={FONT}>
                {l.label}
              </text>
              <text x={panelX + panelW - 16} y={ly}
                textAnchor="end" fill={valColor} fontSize={9.5} fontFamily={FONT}>
                {l.value}
              </text>
            </g>
          );
        })}
      </g>
    );
  }, [frame, activeKey, activeMode, detectedChord, activeNotes.length, chordProgression]);

  // ── Progression timeline (bottom of data panel) ──────────────────────
  const progressionTimeline = useMemo(() => {
    if (chordProgression.length === 0) return null;
    const startX = 1340;
    const y = 480;
    const boxW = 60;
    const gap = 8;
    const visible = chordProgression.slice(-6);

    return (
      <g>
        <text x={startX} y={y - 12} fill={palette.textDim}
          fontSize={8} fontFamily={FONT} opacity={0.6}>
          PROGRESSION HISTORY
        </text>
        <line x1={startX} y1={y - 4} x2={startX + 420} y2={y - 4}
          stroke={palette.contour} strokeWidth={0.5} opacity={0.3} />
        {visible.map((chord, i) => {
          const x = startX + i * (boxW + gap);
          const isCurrent = i === visible.length - 1;
          return (
            <g key={`prog-${i}`}>
              <rect x={x} y={y} width={boxW} height={24}
                fill={isCurrent ? '#0c1629' : palette.node}
                stroke={isCurrent ? palette.primary : palette.nodeBorder}
                strokeWidth={isCurrent ? 1.2 : 0.6}
                rx={2} opacity={0.85} />
              <text x={x + boxW / 2} y={y + 14}
                textAnchor="middle" fill={isCurrent ? palette.primary : palette.text}
                fontSize={9} fontFamily={FONT} fontWeight={isCurrent ? 600 : 400}>
                {chord}
              </text>
            </g>
          );
        })}
      </g>
    );
  }, [chordProgression]);

  // ── N-body field particles (background ambient) ──────────────────────
  const fieldParticles = useMemo(() => {
    const parts: React.ReactNode[] = [];
    const count = 60;
    for (let i = 0; i < count; i++) {
      const seed = i * 37;
      const baseX = seededRandom(seed) * W;
      const baseY = seededRandom(seed + 1) * H;
      // Inverse-square attraction toward active key
      const dx = activePos.x - baseX;
      const dy = activePos.y - baseY;
      const d = Math.sqrt(dx * dx + dy * dy) + 50;
      const pull = 800 / (d * d);
      const speed = 0.004 + pull * 0.5;
      const px = baseX + Math.sin(frame * speed + seed) * (3 + pull * 10);
      const py = baseY + Math.cos(frame * speed * 0.7 + seed) * (3 + pull * 10);
      const size = 0.5 + seededRandom(seed + 2) * 0.8;

      parts.push(
        <circle key={`fp-${i}`} cx={px} cy={py} r={size}
          fill={palette.textDim}
          opacity={0.12 + pull * 0.8} />,
      );
    }
    return parts;
  }, [frame, activePos.x, activePos.y]);

  // ── Scan line (top accent) ───────────────────────────────────────────
  const scanLineY = interpolate(frame % 300, [0, 300], [0, H]);

  // ── Highlighted degrees arcs ─────────────────────────────────────────
  const degreeHighlights = useMemo(() => {
    return highlightedDegrees.map((deg) => {
      const pos = posOnRing(deg, OUTER_R);
      const pulse = 0.15 + 0.1 * Math.sin(frame * 0.05 + deg);
      return (
        <circle key={`deg-${deg}`} cx={pos.x} cy={pos.y} r={30}
          fill="none" stroke={palette.secondary} strokeWidth={0.8}
          strokeDasharray="3 5" opacity={pulse} />
      );
    });
  }, [frame, highlightedDegrees]);

  // ── Cross-hair at center ─────────────────────────────────────────────
  const crosshairOp = 0.12 + 0.03 * Math.sin(frame * 0.015);

  // ── Status indicators (top-right) ────────────────────────────────────
  const statusBar = useMemo(() => {
    const x = 1340;
    const y = 60;
    const items = [
      { label: 'SYS', status: 'NOMINAL', color: palette.accent },
      { label: 'FLD', status: 'TRACKING', color: palette.primary },
      { label: 'PFD', status: pathfinderFrom ? 'ACTIVE' : 'IDLE', color: pathfinderFrom ? palette.primary : palette.textDim },
    ];

    return (
      <g>
        {items.map((item, i) => (
          <g key={`status-${i}`}>
            <circle cx={x + i * 140} cy={y} r={3}
              fill={item.color}
              opacity={0.6 + 0.3 * Math.sin(frame * 0.04 + i)} />
            <text x={x + i * 140 + 10} y={y + 1}
              fill={palette.textDim} fontSize={8} fontFamily={FONT}
              dominantBaseline="central" opacity={0.7}>
              {item.label}
            </text>
            <text x={x + i * 140 + 38} y={y + 1}
              fill={item.color} fontSize={8} fontFamily={FONT}
              dominantBaseline="central" opacity={0.8}>
              {item.status}
            </text>
          </g>
        ))}
      </g>
    );
  }, [frame, pathfinderFrom]);

  // ── Ring labels ──────────────────────────────────────────────────────
  const ringLabels = useMemo(() => {
    const labelOp = 0.3 + 0.05 * Math.sin(frame * 0.012);
    return (
      <g>
        <text x={CX} y={CY - OUTER_R - 16}
          textAnchor="middle" fill={palette.textDim}
          fontSize={7} fontFamily={FONT} opacity={labelOp}>
          MAJOR KEYS \u00B7 OUTER ORBIT
        </text>
        <text x={CX} y={CY - MIDDLE_R - 12}
          textAnchor="middle" fill={palette.textDim}
          fontSize={6.5} fontFamily={FONT} opacity={labelOp * 0.85}>
          RELATIVE MINOR \u00B7 MIDDLE ORBIT
        </text>
        <text x={CX} y={CY - INNER_R - 10}
          textAnchor="middle" fill={palette.textDim}
          fontSize={6} fontFamily={FONT} opacity={labelOp * 0.7}>
          DIMINISHED \u00B7 INNER ORBIT
        </text>
      </g>
    );
  }, [frame]);

  // ── Frame counter / timestamp ────────────────────────────────────────
  const timestamp = useMemo(() => {
    const sec = Math.floor(frame / fps);
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    const ts = `${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(frame % fps).padStart(2, '0')}`;
    return (
      <g>
        <text x={1340} y={H - 40}
          fill={palette.textDim} fontSize={8} fontFamily={FONT} opacity={0.4}>
          T+ {ts}
        </text>
        <text x={1340} y={H - 24}
          fill={palette.textDim} fontSize={7} fontFamily={FONT} opacity={0.3}>
          FRAME {String(frame).padStart(6, '0')} \u00B7 {fps}fps
        </text>
      </g>
    );
  }, [frame, fps]);

  // ════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════════════

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg }}>
      <svg
        viewBox={zoom.viewBox}
        style={{ width: '100%', height: '100%' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="wellGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={palette.primary} stopOpacity="0.06" />
            <stop offset="100%" stopColor={palette.primary} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Grid */}
        {gridLines}

        {/* Scan line */}
        <line x1={0} y1={scanLineY} x2={W} y2={scanLineY}
          stroke={palette.primary} strokeWidth={0.3} opacity={0.06} />

        {/* Background field particles */}
        {fieldParticles}

        {/* Gravity well gradient */}
        <circle cx={activePos.x} cy={activePos.y} r={120}
          fill="url(#wellGrad)" />

        {/* Contour lines around active key */}
        <g transform={`translate(${activePos.x}, ${activePos.y})`}>
          {contourLines}
        </g>

        {/* Gravity well rings */}
        {gravityWell}

        {/* Orbital ring lines */}
        {ringOrbits}

        {/* Cross-hair at center */}
        <line x1={CX - 20} y1={CY} x2={CX + 20} y2={CY}
          stroke={palette.contour} strokeWidth={0.5} opacity={crosshairOp} />
        <line x1={CX} y1={CY - 20} x2={CX} y2={CY + 20}
          stroke={palette.contour} strokeWidth={0.5} opacity={crosshairOp} />
        <circle cx={CX} cy={CY} r={6} fill="none"
          stroke={palette.contour} strokeWidth={0.4} opacity={crosshairOp} />

        {/* Connections with Lagrange points */}
        {connections}

        {/* Flow particles */}
        {flowParticles}

        {/* Degree highlights */}
        {degreeHighlights}

        {/* Accretion particles */}
        {accretionParticles}

        {/* Key nodes — inner to outer for z-order */}
        {DIMS.map((k, i) => renderNode(k, i, INNER_R, 'dim'))}
        {MINORS.map((k, i) => renderNode(k, i, MIDDLE_R, 'minor'))}
        {MAJORS.map((k, i) => renderNode(k, i, OUTER_R, 'major'))}

        {/* Pathfinder arcs */}
        {pathfinderArc}

        {/* Ring labels */}
        {ringLabels}

        {/* Data readout panel */}
        {statusBar}
        {dataPanel}
        {progressionTimeline}
        {timestamp}

        {/* ── Chord keyboards: zoomed = adjacent only, unzoomed = all 7 ── */}
        {zoom.isZoomed && primaryPlayedIdx >= 0 ? (() => {
          const pos = posOnRing(primaryPlayedIdx, OUTER_R);
          return (
            <AdjacentChordsPanel
              anchorX={pos.x}
              anchorY={pos.y}
              playedIndex={primaryPlayedIdx}
              accentColor="#60a5fa"
              secondaryColor="#93c5fd"
              textColor="#9ca3af"
              textDimColor="#4b5563"
              opacity={zoom.zoomProgress}
            />
          );
        })() : (
          <DiatonicChordsPanel
            x={1660}
            y={120}
            activeKey={activeKey}
            activeMode={activeMode}
            accentColor="#60a5fa"
            secondaryColor="#93c5fd"
            textColor="#9ca3af"
            textDimColor="#4b5563"
            kbWidth={130}
            kbHeight={38}
            spacing={68}
            opacity={0.75 * (1 - zoom.zoomProgress)}
          />
        )}
      </svg>
    </AbsoluteFill>
  );
};
