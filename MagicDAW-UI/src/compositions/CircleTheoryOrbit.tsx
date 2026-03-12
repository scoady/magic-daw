import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

export interface CircleTheoryProps {
  activeKey: string;
  activeMode: 'major' | 'minor';
  activeNotes: number[];
  detectedChord: string | null;
  analysisNode?: { idx: number; ring: 'major' | 'minor' | 'dim' } | null;
  analysisLabel?: string | null;
  focusMode: 'diatonic' | 'chord';
  trailNodes: Array<{ idx: number; ring: 'major' | 'minor' | 'dim' }>;
  guidedMode?: 'off' | 'walkthrough';
  guidedStep?: number;
  showDegrees?: boolean;
  conceptOverlay?: boolean;
}

const MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINOR_KEYS = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];
const DIM_KEYS = ['Bdim', 'F#dim', 'C#dim', 'G#dim', 'D#dim', 'A#dim', 'Fdim', 'Cdim', 'Gdim', 'Ddim', 'Adim', 'Edim'];

const CHROMATIC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHROMATIC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const ENHARMONIC: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'Gb': 'F#',
  'Cb': 'B', 'Fb': 'E', 'B#': 'C', 'E#': 'F',
};

const P = {
  bg0: '#050d1c',
  bg1: '#08152d',
  bg2: '#0a1f3f',
  cyan: '#67e8f9',
  teal: '#2dd4bf',
  purple: '#a78bfa',
  rose: '#f472b6',
  gold: '#fbbf24',
  text: '#ddecff',
  dim: '#809ab3',
  glass: 'rgba(7, 16, 34, 0.68)',
  glassBorder: 'rgba(126, 182, 220, 0.26)',
};

function normalizeRoot(name: string): string {
  const m = name.match(/^([A-G][#b]?)/);
  if (!m) return name;
  return (ENHARMONIC[m[1]] ?? m[1]) + name.slice(m[1].length);
}

function rootToChroma(name: string): number {
  const root = normalizeRoot(name);
  let idx = CHROMATIC_FLAT.indexOf(root);
  if (idx >= 0) return idx;
  idx = CHROMATIC_SHARP.indexOf(root);
  return idx;
}

function chromaToFifthsIndex(chroma: number): number {
  return ((chroma % 12) * 7) % 12;
}

function midiToFifthsIndex(midi: number): number {
  return chromaToFifthsIndex(midi % 12);
}

function pointOnRing(cx: number, cy: number, r: number, i: number): [number, number] {
  const a = ((i / 12) * Math.PI * 2) - Math.PI / 2;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function polygonPath(points: [number, number][]): string {
  if (points.length === 0) return '';
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ') + ' Z';
}

function chordToHit(chord: string | null): { idx: number; ring: 'major' | 'minor' | 'dim' } | null {
  if (!chord) return null;
  const m = chord.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  const root = normalizeRoot(m[1]);
  const suffix = (m[2] || '').toLowerCase();
  const idx = MAJOR_KEYS.findIndex((n) => normalizeRoot(n) === root);
  if (idx < 0) return null;
  if (suffix.includes('dim')) return { idx, ring: 'dim' };
  if (suffix.includes('m') && !suffix.includes('maj')) return { idx, ring: 'minor' };
  return { idx, ring: 'major' };
}

function triadSets(activeKey: string, activeMode: 'major' | 'minor'): {
  major: Set<number>;
  minor: Set<number>;
  dim: Set<number>;
} {
  const tonicChroma = rootToChroma(activeKey);
  if (tonicChroma < 0) return { major: new Set(), minor: new Set(), dim: new Set() };

  const intervals = activeMode === 'major'
    ? [0, 2, 4, 5, 7, 9, 11]
    : [0, 2, 3, 5, 7, 8, 10];
  const qualities = activeMode === 'major'
    ? ['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim']
    : ['minor', 'dim', 'major', 'minor', 'minor', 'major', 'major'];

  const major = new Set<number>();
  const minor = new Set<number>();
  const dim = new Set<number>();
  for (let i = 0; i < intervals.length; i++) {
    const idx = chromaToFifthsIndex((tonicChroma + intervals[i]) % 12);
    const q = qualities[i];
    if (q === 'major') major.add(idx);
    if (q === 'minor') minor.add(idx);
    if (q === 'dim') dim.add(idx);
  }
  return { major, minor, dim };
}

function diatonicDegreeEntries(activeKey: string, activeMode: 'major' | 'minor') {
  const tonicChroma = rootToChroma(activeKey);
  if (tonicChroma < 0) return [];
  const intervals = activeMode === 'major'
    ? [0, 2, 4, 5, 7, 9, 11]
    : [0, 2, 3, 5, 7, 8, 10];
  const qualities = activeMode === 'major'
    ? (['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim'] as const)
    : (['minor', 'dim', 'major', 'minor', 'minor', 'major', 'major'] as const);
  const labels = activeMode === 'major'
    ? ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
    : ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
  return intervals.map((iv, i) => ({
    idx: chromaToFifthsIndex((tonicChroma + iv) % 12),
    quality: qualities[i],
    degree: labels[i],
  }));
}

function degreeMaps(activeKey: string, activeMode: 'major' | 'minor') {
  const major = new Map<number, string>();
  const minor = new Map<number, string>();
  const dim = new Map<number, string>();
  diatonicDegreeEntries(activeKey, activeMode).forEach((entry) => {
    if (entry.quality === 'major') major.set(entry.idx, entry.degree);
    if (entry.quality === 'minor') minor.set(entry.idx, entry.degree);
    if (entry.quality === 'dim') dim.set(entry.idx, entry.degree);
  });
  return { major, minor, dim };
}

function guidedTargets(activeKey: string, activeMode: 'major' | 'minor', guidedStep: number) {
  const entries = diatonicDegreeEntries(activeKey, activeMode);
  const byDegree = new Map(entries.map((e) => [e.degree, e]));
  const target = {
    major: new Set<number>(),
    minor: new Set<number>(),
    dim: new Set<number>(),
  };
  const add = (degree: string) => {
    const entry = byDegree.get(degree);
    if (!entry) return;
    if (entry.quality === 'major') target.major.add(entry.idx);
    if (entry.quality === 'minor') target.minor.add(entry.idx);
    if (entry.quality === 'dim') target.dim.add(entry.idx);
  };
  if (activeMode === 'major') {
    if (guidedStep === 0) add('I');
    if (guidedStep === 1) add('vi');
    if (guidedStep === 2) add('ii');
    if (guidedStep === 3) add('V');
    if (guidedStep === 4) add('I');
  } else {
    if (guidedStep === 0) add('i');
    if (guidedStep === 1) add('VI');
    if (guidedStep === 2) add('iv');
    if (guidedStep === 3) add('v');
    if (guidedStep === 4) add('i');
  }
  return target;
}

function guidedCaption(activeMode: 'major' | 'minor', guidedStep: number) {
  if (activeMode === 'major') {
    if (guidedStep === 0) return '1/5 Play I: establish tonal center.';
    if (guidedStep === 1) return '2/5 Play vi: relative minor color within the same key.';
    if (guidedStep === 2) return '3/5 Play ii: pre-dominant setup.';
    if (guidedStep === 3) return '4/5 Play V: strongest dominant pull.';
    return '5/5 Resolve to I: complete the phrase.';
  }
  if (guidedStep === 0) return '1/5 Play i: establish minor center.';
  if (guidedStep === 1) return '2/5 Play VI: stable contrast in minor.';
  if (guidedStep === 2) return '3/5 Play iv: widen harmonic space.';
  if (guidedStep === 3) return '4/5 Play v: directional tension.';
  return '5/5 Resolve to i: close the phrase.';
}

export const CircleTheoryOrbit: React.FC<CircleTheoryProps> = ({
  activeKey,
  activeMode,
  activeNotes,
  detectedChord,
  analysisNode,
  analysisLabel,
  focusMode,
  trailNodes,
  guidedMode = 'off',
  guidedStep = 0,
  showDegrees = true,
  conceptOverlay = false,
}) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const cx = W / 2;
  const cy = H / 2;
  const minDim = Math.min(W, H);
  const scale = minDim / 1080;

  const rOuter = minDim * 0.385;
  const rMinor = minDim * 0.282;
  const rDim = minDim * 0.193;
  const rCore = minDim * 0.145;

  const outer = useMemo(() => MAJOR_KEYS.map((_, i) => pointOnRing(cx, cy, rOuter, i)), [cx, cy, rOuter]);
  const inner = useMemo(() => MAJOR_KEYS.map((_, i) => pointOnRing(cx, cy, rMinor, i)), [cx, cy, rMinor]);
  const dim = useMemo(() => MAJOR_KEYS.map((_, i) => pointOnRing(cx, cy, rDim, i)), [cx, cy, rDim]);

  const activeIdx = useMemo(() => {
    const idx = MAJOR_KEYS.findIndex((n) => n === activeKey);
    return idx >= 0 ? idx : 0;
  }, [activeKey]);
  const dominantIdx = (activeIdx + 1) % 12;
  const subdominantIdx = (activeIdx + 11) % 12;

  const diatonic = useMemo(() => triadSets(activeKey, activeMode), [activeKey, activeMode]);
  const degreeMap = useMemo(() => degreeMaps(activeKey, activeMode), [activeKey, activeMode]);
  const guided = useMemo(() => guidedTargets(activeKey, activeMode, guidedStep % 5), [activeKey, activeMode, guidedStep]);
  const guideOn = guidedMode === 'walkthrough';
  const caption = guidedCaption(activeMode, guidedStep % 5);
  const chordHit = useMemo(() => analysisNode ?? chordToHit(detectedChord), [analysisNode, detectedChord]);
  const liveNoteSet = useMemo(() => new Set(activeNotes.map(midiToFifthsIndex)), [activeNotes]);

  const dimSquareIndices = [0, 3, 6, 9];
  const dimSquarePath = useMemo(() => polygonPath(dimSquareIndices.map((i) => dim[i])), [dim]);

  const triangles = useMemo(() => {
    const result: Array<{ d: string; alpha: number }> = [];
    for (let i = 0; i < 12; i++) {
      const p1 = outer[i];
      const p2 = inner[(i + 2) % 12];
      const p3 = outer[(i + 4) % 12];
      result.push({ d: polygonPath([p1, p2, p3]), alpha: 0.055 + ((i % 4) * 0.02) });
    }
    return result;
  }, [outer, inner]);

  const connections = useMemo(() => {
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number; o: number; d: string }> = [];
    for (let i = 0; i < 12; i++) {
      const a = outer[i];
      const b = outer[(i + 1) % 12];
      const c = inner[(i + 2) % 12];
      lines.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], o: 0.1, d: '6 6' });
      lines.push({ x1: a[0], y1: a[1], x2: c[0], y2: c[1], o: 0.08, d: '4 7' });
    }
    return lines;
  }, [outer, inner]);

  const stars = useMemo(() => {
    let s = 20260311;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    return Array.from({ length: 240 }, () => ({
      x: rnd() * W,
      y: rnd() * H,
      r: 0.45 + rnd() * 2.2,
      p: rnd() * Math.PI * 2,
      sp: 0.012 + rnd() * 0.03,
    }));
  }, [W, H]);

  const dust = useMemo(() => {
    let s = 9911;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    return Array.from({ length: 32 }, () => ({
      r: rCore + rnd() * (rOuter - rCore),
      size: 1.4 + rnd() * 2.6,
      phase: rnd() * Math.PI * 2,
      speed: 0.004 + rnd() * 0.008,
      hue: rnd() > 0.5 ? P.cyan : P.purple,
    }));
  }, [rCore, rOuter]);

  const pulse = 0.58 + Math.sin(frame * 0.06) * 0.2;
  const driftA = frame * 0.004;
  const driftB = frame * 0.0028;

  const trailEdges = useMemo(() => {
    if (!trailNodes || trailNodes.length < 2) return [];
    const ringPoint = (node: { idx: number; ring: 'major' | 'minor' | 'dim' }): [number, number] => {
      if (node.ring === 'major') return outer[node.idx];
      if (node.ring === 'minor') return inner[node.idx];
      return dim[node.idx];
    };
    const edges: Array<{ from: [number, number]; to: [number, number]; i: number }> = [];
    for (let i = 0; i < trailNodes.length - 1; i++) {
      edges.push({ from: ringPoint(trailNodes[i]), to: ringPoint(trailNodes[i + 1]), i });
    }
    return edges;
  }, [trailNodes, outer, inner, dim]);

  return (
    <AbsoluteFill style={{ background: P.bg0 }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <radialGradient id="o-bg-main" cx="50%" cy="45%" r="64%">
            <stop offset="0%" stopColor={P.bg2} stopOpacity={0.95} />
            <stop offset="70%" stopColor={P.bg1} stopOpacity={1} />
            <stop offset="100%" stopColor={P.bg0} stopOpacity={1} />
          </radialGradient>
          <radialGradient id="o-aurora-a" cx={`${50 + Math.sin(driftA) * 18}%`} cy={`${46 + Math.cos(driftA * 0.8) * 14}%`} r="58%">
            <stop offset="0%" stopColor={activeMode === 'minor' ? P.purple : P.cyan} stopOpacity={0.12} />
            <stop offset="100%" stopColor={P.bg0} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="o-aurora-b" cx={`${48 + Math.cos(driftB * 1.1) * 22}%`} cy={`${53 + Math.sin(driftB * 0.9) * 16}%`} r="50%">
            <stop offset="0%" stopColor={P.teal} stopOpacity={0.09} />
            <stop offset="100%" stopColor={P.bg0} stopOpacity={0} />
          </radialGradient>
          <linearGradient id="o-tri-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={P.cyan} stopOpacity={0.4} />
            <stop offset="50%" stopColor={P.purple} stopOpacity={0.35} />
            <stop offset="100%" stopColor={P.teal} stopOpacity={0.4} />
          </linearGradient>
          <filter id="o-glow-sm" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <filter id="o-glow-md" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>

        <rect x={0} y={0} width={W} height={H} fill="url(#o-bg-main)" />
        <rect x={0} y={0} width={W} height={H} fill="url(#o-aurora-a)" />
        <rect x={0} y={0} width={W} height={H} fill="url(#o-aurora-b)" />

        {stars.map((s, i) => (
          <circle key={`star-${i}`} cx={s.x} cy={s.y} r={s.r} fill="#e1f4ff"
            opacity={0.06 + (Math.sin(frame * s.sp + s.p) * 0.5 + 0.5) * 0.55}
          />
        ))}

        {dust.map((d, i) => {
          const ang = frame * d.speed + d.phase;
          const x = cx + Math.cos(ang) * d.r;
          const y = cy + Math.sin(ang) * (d.r * 0.6);
          return <circle key={`dust-${i}`} cx={x} cy={y} r={d.size} fill={d.hue} opacity={0.18 + 0.1 * Math.sin(frame * 0.02 + i)} />;
        })}

        <g>
          {triangles.map((t, i) => (
            <path key={`tri-fill-${i}`} d={t.d} fill="url(#o-tri-grad)" opacity={t.alpha} />
          ))}
          {triangles.map((t, i) => (
            <path key={`tri-line-${i}`} d={t.d} fill="none" stroke={P.purple} strokeOpacity={0.12} strokeWidth={1} />
          ))}
        </g>

        {connections.map((l, i) => (
          <line key={`conn-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke={P.cyan} strokeOpacity={l.o} strokeWidth={1}
            strokeDasharray={l.d} strokeDashoffset={-frame * 0.35}
          />
        ))}

        <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="rgba(103,232,249,0.28)" strokeWidth={2.2} />
        <circle cx={cx} cy={cy} r={rMinor} fill="none" stroke="rgba(167,139,250,0.26)" strokeWidth={1.9} />
        <circle cx={cx} cy={cy} r={rDim} fill="none" stroke="rgba(244,114,182,0.2)" strokeWidth={1.4} />

        {(focusMode === 'diatonic' || conceptOverlay) && (
          <>
            <line x1={outer[activeIdx][0]} y1={outer[activeIdx][1]} x2={outer[dominantIdx][0]} y2={outer[dominantIdx][1]}
              stroke={P.gold} strokeOpacity={0.45 + pulse * 0.18} strokeWidth={2.2}
            />
            <line x1={outer[activeIdx][0]} y1={outer[activeIdx][1]} x2={outer[subdominantIdx][0]} y2={outer[subdominantIdx][1]}
              stroke={P.teal} strokeOpacity={0.42 + pulse * 0.18} strokeWidth={2.2}
            />
          </>
        )}

        <path d={dimSquarePath} fill="rgba(244,114,182,0.07)" stroke={P.rose}
          strokeOpacity={0.44 + pulse * 0.22} strokeWidth={2.1}
        />

        {trailEdges.map((e) => (
          <g key={`trail-${e.i}`}>
            <line x1={e.from[0]} y1={e.from[1]} x2={e.to[0]} y2={e.to[1]}
              stroke={P.gold} strokeWidth={9} strokeOpacity={0.08} strokeLinecap="round"
            />
            <line x1={e.from[0]} y1={e.from[1]} x2={e.to[0]} y2={e.to[1]}
              stroke={P.gold} strokeWidth={4.2} strokeOpacity={0.22} strokeLinecap="round"
            />
            <line x1={e.from[0]} y1={e.from[1]} x2={e.to[0]} y2={e.to[1]}
              stroke={P.gold} strokeWidth={1.8} strokeOpacity={0.92} strokeLinecap="round"
              strokeDasharray="8 6" strokeDashoffset={-frame * 0.8}
            />
          </g>
        ))}

        {conceptOverlay && (
          <>
            <line x1={outer[0][0]} y1={outer[0][1]} x2={outer[1][0]} y2={outer[1][1]}
              stroke="#86efac" strokeOpacity={0.85} strokeWidth={2.8}
              strokeDasharray="10 7" strokeDashoffset={-frame * 0.9}
            />
            <line x1={outer[0][0]} y1={outer[0][1]} x2={outer[11][0]} y2={outer[11][1]}
              stroke="#86efac" strokeOpacity={0.68} strokeWidth={2.2}
              strokeDasharray="7 7" strokeDashoffset={frame * 0.9}
            />
            <path
              d={polygonPath([outer[activeIdx], outer[subdominantIdx], outer[dominantIdx]])}
              fill="rgba(134,239,172,0.06)"
              stroke="#86efac"
              strokeOpacity={0.64}
              strokeWidth={2.2}
            />
            <text x={cx + rOuter * 0.05} y={cy - rOuter - 22 * scale} textAnchor="middle" fill="#bbf7d0"
              style={{ fontSize: `${11 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
            >
              Clockwise = +5th
            </text>
            <text x={cx - rOuter * 0.38} y={cy + rOuter + 18 * scale} textAnchor="middle" fill="#bbf7d0"
              style={{ fontSize: `${10.5 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
            >
              Counter-clockwise = +4th
            </text>
          </>
        )}

        <circle cx={cx} cy={cy} r={rCore * 1.45} fill={activeMode === 'minor' ? P.purple : P.cyan} opacity={0.06 + pulse * 0.05} filter="url(#o-glow-md)" />

        {MAJOR_KEYS.map((label, i) => {
          const isDiatonic = focusMode === 'diatonic' && diatonic.major.has(i);
          const isLive = focusMode === 'diatonic' && liveNoteSet.has(i);
          const isChord = chordHit?.idx === i && chordHit.ring === 'major';
          const isGuide = focusMode === 'diatonic' && (i === activeIdx || i === dominantIdx || i === subdominantIdx);
          const isWalk = guideOn && guided.major.has(i);
          const glow = isDiatonic || isLive || isChord || isGuide || isWalk;
          const color = isChord ? P.gold : isGuide ? P.teal : P.cyan;

          return (
            <g key={`maj-${label}`}>
              {glow && <circle cx={outer[i][0]} cy={outer[i][1]} r={31 * scale} fill={color} opacity={isChord ? 0.3 : isLive ? 0.24 : 0.14} filter="url(#o-glow-sm)" />}
              <circle cx={outer[i][0]} cy={outer[i][1]} r={20 * scale} fill="rgba(8,18,34,0.95)"
                stroke={glow ? color : 'rgba(130,162,192,0.34)'} strokeWidth={glow ? 2.4 : 1.25} />
              <text x={outer[i][0]} y={outer[i][1] + 4 * scale} textAnchor="middle"
                fill={glow ? P.text : P.dim}
                style={{ fontSize: `${14 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
              >
                {label}
              </text>
              {showDegrees && focusMode === 'diatonic' && degreeMap.major.get(i) && (
                <g>
                  <rect x={outer[i][0] - 13 * scale} y={outer[i][1] + 12 * scale} width={26 * scale} height={12.5 * scale} rx={4 * scale}
                    fill="rgba(8,18,34,0.9)" stroke="rgba(148,163,184,0.5)" strokeWidth={0.8}
                  />
                  <text x={outer[i][0]} y={outer[i][1] + 21 * scale} textAnchor="middle"
                    fill="#e2e8f0"
                    style={{ fontSize: `${9.8 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
                  >
                    {degreeMap.major.get(i)}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {MINOR_KEYS.map((label, i) => {
          const isDiatonic = focusMode === 'diatonic' && diatonic.minor.has(i);
          const isChord = chordHit?.idx === i && chordHit.ring === 'minor';
          const isWalk = guideOn && guided.minor.has(i);
          const glow = isDiatonic || isChord || i === activeIdx || isWalk;
          return (
            <g key={`min-${label}`}>
              {glow && <circle cx={inner[i][0]} cy={inner[i][1]} r={25 * scale} fill={P.purple} opacity={isChord ? 0.32 : 0.14} filter="url(#o-glow-sm)" />}
              <circle cx={inner[i][0]} cy={inner[i][1]} r={16 * scale} fill="rgba(8,16,30,0.92)"
                stroke={glow ? P.purple : 'rgba(130,162,192,0.27)'} strokeWidth={glow ? 2.1 : 1.1} />
              <text x={inner[i][0]} y={inner[i][1] + 3 * scale} textAnchor="middle"
                fill={glow ? '#efe5ff' : P.dim}
                style={{ fontSize: `${11 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
              >
                {label}
              </text>
              {showDegrees && focusMode === 'diatonic' && degreeMap.minor.get(i) && (
                <g>
                  <rect x={inner[i][0] - 13 * scale} y={inner[i][1] + 10 * scale} width={26 * scale} height={12 * scale} rx={4 * scale}
                    fill="rgba(8,18,34,0.9)" stroke="rgba(167,139,250,0.52)" strokeWidth={0.8}
                  />
                  <text x={inner[i][0]} y={inner[i][1] + 18.8 * scale} textAnchor="middle"
                    fill="#ede9fe"
                    style={{ fontSize: `${9.2 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
                  >
                    {degreeMap.minor.get(i)}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {DIM_KEYS.map((_, i) => {
          const isDiatonic = focusMode === 'diatonic' && diatonic.dim.has(i);
          const isChord = chordHit?.idx === i && chordHit.ring === 'dim';
          const squareNode = dimSquareIndices.includes(i);
          const isWalk = guideOn && guided.dim.has(i);
          const glow = isDiatonic || isChord || squareNode || isWalk;
          return (
            <g key={`dim-${i}`}>
              {glow && <circle cx={dim[i][0]} cy={dim[i][1]} r={16 * scale} fill={P.rose} opacity={isChord ? 0.32 : isDiatonic ? 0.26 : 0.1} />}
              <circle cx={dim[i][0]} cy={dim[i][1]} r={10 * scale} fill="rgba(9,16,29,0.9)"
                stroke={glow ? P.rose : 'rgba(130,162,192,0.2)'} strokeWidth={glow ? 1.9 : 1}
              />
              {showDegrees && focusMode === 'diatonic' && degreeMap.dim.get(i) && (
                <g>
                  <rect x={dim[i][0] - 13 * scale} y={dim[i][1] + 8 * scale} width={26 * scale} height={11.5 * scale} rx={4 * scale}
                    fill="rgba(8,18,34,0.9)" stroke="rgba(244,114,182,0.52)" strokeWidth={0.8}
                  />
                  <text x={dim[i][0]} y={dim[i][1] + 16.4 * scale} textAnchor="middle"
                    fill="#fbcfe8"
                    style={{ fontSize: `${8.6 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
                  >
                    {degreeMap.dim.get(i)}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        <text x={cx} y={cy - 10 * scale} textAnchor="middle" fill={P.text}
          style={{ fontSize: `${48 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700, letterSpacing: 1 }}
        >
          {activeKey} {activeMode}
        </text>
        <text x={cx} y={cy + 22 * scale} textAnchor="middle" fill={P.dim}
          style={{ fontSize: `${15 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace' }}
        >
          {guideOn
            ? caption
            : focusMode === 'diatonic'
            ? 'Diatonic focus: I-IV-V, ii-iii-vi, and vii dim'
            : (detectedChord ? `Detected chord: ${detectedChord}` : 'Chord focus: play a full chord to illuminate one target')}
        </text>

        <g>
          <rect x={W - 285} y={14} width={271} height={114} rx={10}
            fill={P.glass} stroke={P.glassBorder} strokeWidth={1}
          />
          <line x1={W - 285} y1={40} x2={W - 14} y2={40} stroke="rgba(124,177,211,0.24)" strokeWidth={1} />
          <text x={W - 269} y={32} fill={P.text} style={{ fontSize: '11px', fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}>
            THEORETICAL RELATIONSHIPS
          </text>
          <text x={W - 269} y={58} fill={P.dim} style={{ fontSize: '11px', fontFamily: 'SF Mono, Fira Code, monospace' }}>
            Focus: {focusMode.toUpperCase()}
          </text>
          <text x={W - 269} y={76} fill={P.dim} style={{ fontSize: '11px', fontFamily: 'SF Mono, Fira Code, monospace' }}>
            Active Key: {activeKey} {activeMode}
          </text>
          <text x={W - 269} y={94} fill={P.dim} style={{ fontSize: '11px', fontFamily: 'SF Mono, Fira Code, monospace' }}>
            Chord: {analysisLabel ?? detectedChord ?? 'none'}
          </text>
          <text x={W - 269} y={112} fill={P.dim} style={{ fontSize: '11px', fontFamily: 'SF Mono, Fira Code, monospace' }}>
            Live Notes: {activeNotes.length}
          </text>
        </g>
      </svg>
    </AbsoluteFill>
  );
};
