import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CircleTheoryProps } from './CircleTheoryOrbit';

const MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINOR_KEYS = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];

const CHROMATIC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHROMATIC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const ENHARMONIC: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'Gb': 'F#',
  'Cb': 'B', 'Fb': 'E', 'B#': 'C', 'E#': 'F',
};

const C = {
  bg0: '#050f1f',
  bg1: '#0a1832',
  bg2: '#0f2550',
  cyan: '#60d9ff',
  teal: '#2dd4bf',
  violet: '#a78bfa',
  rose: '#f472b6',
  amber: '#fbbf24',
  text: '#d7ebff',
  dim: '#86a5be',
  glass: 'rgba(7, 17, 34, 0.68)',
  glassBorder: 'rgba(110, 170, 220, 0.25)',
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
  const idx = MAJOR_KEYS.findIndex((k) => normalizeRoot(k) === root);
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
  const tonic = rootToChroma(activeKey);
  if (tonic < 0) return { major: new Set(), minor: new Set(), dim: new Set() };
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
    const idx = chromaToFifthsIndex((tonic + intervals[i]) % 12);
    const q = qualities[i];
    if (q === 'major') major.add(idx);
    if (q === 'minor') minor.add(idx);
    if (q === 'dim') dim.add(idx);
  }
  return { major, minor, dim };
}

function diatonicDegreeEntries(activeKey: string, activeMode: 'major' | 'minor') {
  const tonic = rootToChroma(activeKey);
  if (tonic < 0) return [];
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
    idx: chromaToFifthsIndex((tonic + iv) % 12),
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
    if (guidedStep === 0) return '1/5 Play I: tonal center.';
    if (guidedStep === 1) return '2/5 Play vi: relative minor color.';
    if (guidedStep === 2) return '3/5 Play ii: pre-dominant.';
    if (guidedStep === 3) return '4/5 Play V: dominant pull.';
    return '5/5 Resolve to I.';
  }
  if (guidedStep === 0) return '1/5 Play i: minor center.';
  if (guidedStep === 1) return '2/5 Play VI: stable contrast.';
  if (guidedStep === 2) return '3/5 Play iv: broaden color.';
  if (guidedStep === 3) return '4/5 Play v: directional pull.';
  return '5/5 Resolve to i.';
}

export const CircleTheoryConstellation: React.FC<CircleTheoryProps> = ({
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

  const rOuter = minDim * 0.372;
  const rMinor = minDim * 0.266;
  const rDim = minDim * 0.182;

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
  const liveNotes = useMemo(() => new Set(activeNotes.map(midiToFifthsIndex)), [activeNotes]);

  const squareIndices = [0, 3, 6, 9];
  const squarePath = useMemo(() => polygonPath(squareIndices.map((i) => dim[i])), [dim]);

  const lattice = useMemo(() => {
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number; o: number; d: string }> = [];
    for (let i = 0; i < 12; i++) {
      const a = outer[i];
      const b = outer[(i + 2) % 12];
      const c = inner[(i + 1) % 12];
      lines.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], o: 0.1, d: '8 8' });
      lines.push({ x1: a[0], y1: a[1], x2: c[0], y2: c[1], o: 0.08, d: '4 7' });
    }
    return lines;
  }, [outer, inner]);

  const triMesh = useMemo(() => {
    const tris: string[] = [];
    for (let i = 0; i < 12; i++) {
      tris.push(polygonPath([outer[i], inner[(i + 1) % 12], outer[(i + 2) % 12]]));
    }
    return tris;
  }, [outer, inner]);

  const stars = useMemo(() => {
    let s = 70707;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    return Array.from({ length: 260 }, () => ({
      x: rnd() * W,
      y: rnd() * H,
      r: 0.4 + rnd() * 2.0,
      p: rnd() * Math.PI * 2,
      sp: 0.012 + rnd() * 0.028,
    }));
  }, [W, H]);

  const pulse = 0.6 + Math.sin(frame * 0.08) * 0.18;
  const drift = frame * 0.003;

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
    <AbsoluteFill style={{ background: C.bg0 }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <radialGradient id="c-bg" cx="50%" cy="45%" r="66%">
            <stop offset="0%" stopColor={C.bg2} stopOpacity={0.95} />
            <stop offset="75%" stopColor={C.bg1} stopOpacity={1} />
            <stop offset="100%" stopColor={C.bg0} stopOpacity={1} />
          </radialGradient>
          <radialGradient id="c-aurora" cx={`${50 + Math.sin(drift) * 18}%`} cy={`${48 + Math.cos(drift * 0.8) * 14}%`} r="56%">
            <stop offset="0%" stopColor={activeMode === 'minor' ? C.violet : C.cyan} stopOpacity={0.11} />
            <stop offset="100%" stopColor={C.bg0} stopOpacity={0} />
          </radialGradient>
          <linearGradient id="c-tri-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={C.cyan} stopOpacity={0.35} />
            <stop offset="50%" stopColor={C.violet} stopOpacity={0.3} />
            <stop offset="100%" stopColor={C.teal} stopOpacity={0.35} />
          </linearGradient>
          <filter id="c-glow" x="-60%" y="-60%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        <rect x={0} y={0} width={W} height={H} fill="url(#c-bg)" />
        <rect x={0} y={0} width={W} height={H} fill="url(#c-aurora)" />
        {stars.map((s, i) => (
          <circle key={`star-${i}`} cx={s.x} cy={s.y} r={s.r} fill="#dff1ff"
            opacity={0.06 + (Math.sin(frame * s.sp + s.p) * 0.5 + 0.5) * 0.52}
          />
        ))}

        {triMesh.map((d, i) => (
          <path key={`tri-fill-${i}`} d={d} fill="url(#c-tri-grad)" opacity={0.07 + ((i % 3) * 0.02)} />
        ))}
        {triMesh.map((d, i) => (
          <path key={`tri-line-${i}`} d={d} fill="none" stroke={C.violet} strokeOpacity={0.14} strokeWidth={1} />
        ))}

        {lattice.map((l, i) => (
          <line key={`lat-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke={C.cyan} strokeOpacity={l.o} strokeWidth={1}
            strokeDasharray={l.d} strokeDashoffset={-frame * 0.34}
          />
        ))}

        <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="rgba(96,217,255,0.3)" strokeWidth={2} />
        <circle cx={cx} cy={cy} r={rMinor} fill="none" stroke="rgba(167,139,250,0.25)" strokeWidth={1.8} />
        <circle cx={cx} cy={cy} r={rDim} fill="none" stroke="rgba(244,114,182,0.22)" strokeWidth={1.4} />

        {(focusMode === 'diatonic' || conceptOverlay) && (
          <>
            <line x1={outer[activeIdx][0]} y1={outer[activeIdx][1]} x2={outer[dominantIdx][0]} y2={outer[dominantIdx][1]}
              stroke={C.amber} strokeOpacity={0.44 + pulse * 0.18} strokeWidth={2.3}
            />
            <line x1={outer[activeIdx][0]} y1={outer[activeIdx][1]} x2={outer[subdominantIdx][0]} y2={outer[subdominantIdx][1]}
              stroke={C.teal} strokeOpacity={0.42 + pulse * 0.18} strokeWidth={2.3}
            />
          </>
        )}

        <path d={squarePath} fill="rgba(244,114,182,0.075)" stroke={C.rose}
          strokeOpacity={0.45 + pulse * 0.2} strokeWidth={2.2}
        />

        {trailEdges.map((e) => (
          <g key={`trail-${e.i}`}>
            <line x1={e.from[0]} y1={e.from[1]} x2={e.to[0]} y2={e.to[1]}
              stroke={C.amber} strokeWidth={8.5} strokeOpacity={0.08} strokeLinecap="round"
            />
            <line x1={e.from[0]} y1={e.from[1]} x2={e.to[0]} y2={e.to[1]}
              stroke={C.amber} strokeWidth={4} strokeOpacity={0.24} strokeLinecap="round"
            />
            <line x1={e.from[0]} y1={e.from[1]} x2={e.to[0]} y2={e.to[1]}
              stroke={C.amber} strokeWidth={1.8} strokeOpacity={0.92}
              strokeLinecap="round" strokeDasharray="8 6" strokeDashoffset={-frame * 0.75}
            />
          </g>
        ))}

        {conceptOverlay && (
          <>
            <line x1={outer[0][0]} y1={outer[0][1]} x2={outer[1][0]} y2={outer[1][1]}
              stroke="#86efac" strokeOpacity={0.86} strokeWidth={2.6}
              strokeDasharray="10 7" strokeDashoffset={-frame * 0.85}
            />
            <line x1={outer[0][0]} y1={outer[0][1]} x2={outer[11][0]} y2={outer[11][1]}
              stroke="#86efac" strokeOpacity={0.68} strokeWidth={2.1}
              strokeDasharray="7 7" strokeDashoffset={frame * 0.85}
            />
            <path
              d={polygonPath([outer[activeIdx], outer[subdominantIdx], outer[dominantIdx]])}
              fill="rgba(134,239,172,0.06)"
              stroke="#86efac"
              strokeOpacity={0.62}
              strokeWidth={2.1}
            />
            <text x={cx + rOuter * 0.08} y={cy - rOuter - 20 * scale} textAnchor="middle" fill="#bbf7d0"
              style={{ fontSize: `${10.8 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
            >
              Clockwise = +5th
            </text>
            <text x={cx - rOuter * 0.36} y={cy + rOuter + 16 * scale} textAnchor="middle" fill="#bbf7d0"
              style={{ fontSize: `${10.2 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
            >
              Counter-clockwise = +4th
            </text>
          </>
        )}

        <circle cx={cx} cy={cy} r={rDim * 0.95} fill={activeMode === 'minor' ? C.violet : C.cyan} opacity={0.06 + pulse * 0.05} filter="url(#c-glow)" />

        {MAJOR_KEYS.map((label, i) => {
          const inDiatonic = focusMode === 'diatonic' && diatonic.major.has(i);
          const isLive = focusMode === 'diatonic' && liveNotes.has(i);
          const isChord = chordHit?.idx === i && chordHit.ring === 'major';
          const isGuide = focusMode === 'diatonic' && (i === activeIdx || i === dominantIdx || i === subdominantIdx);
          const isWalk = guideOn && guided.major.has(i);
          const glow = inDiatonic || isLive || isChord || isGuide || isWalk;
          const color = isChord ? C.amber : isGuide ? C.teal : C.cyan;
          return (
            <g key={`maj-${label}`}>
              {glow && <circle cx={outer[i][0]} cy={outer[i][1]} r={29 * scale} fill={color} opacity={isChord ? 0.31 : isLive ? 0.22 : 0.13} />}
              <circle cx={outer[i][0]} cy={outer[i][1]} r={19 * scale}
                fill="rgba(8,20,38,0.95)"
                stroke={glow ? color : 'rgba(133,165,193,0.35)'}
                strokeWidth={glow ? 2.3 : 1.2}
              />
              <text x={outer[i][0]} y={outer[i][1] + 4 * scale} textAnchor="middle"
                fill={glow ? C.text : C.dim}
                style={{ fontSize: `${13 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
              >
                {label}
              </text>
              {showDegrees && focusMode === 'diatonic' && degreeMap.major.get(i) && (
                <g>
                  <rect x={outer[i][0] - 13 * scale} y={outer[i][1] + 11.5 * scale} width={26 * scale} height={12 * scale} rx={4 * scale}
                    fill="rgba(8,18,34,0.9)" stroke="rgba(148,163,184,0.5)" strokeWidth={0.8}
                  />
                  <text x={outer[i][0]} y={outer[i][1] + 20 * scale} textAnchor="middle"
                    fill="#e2e8f0"
                    style={{ fontSize: `${9.4 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
                  >
                    {degreeMap.major.get(i)}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {MINOR_KEYS.map((label, i) => {
          const inDiatonic = focusMode === 'diatonic' && diatonic.minor.has(i);
          const isChord = chordHit?.idx === i && chordHit.ring === 'minor';
          const isWalk = guideOn && guided.minor.has(i);
          const glow = inDiatonic || isChord || i === activeIdx || isWalk;
          return (
            <g key={`min-${label}`}>
              {glow && <circle cx={inner[i][0]} cy={inner[i][1]} r={24 * scale} fill={C.violet} opacity={isChord ? 0.3 : 0.14} />}
              <circle cx={inner[i][0]} cy={inner[i][1]} r={15 * scale}
                fill="rgba(9,17,33,0.91)"
                stroke={glow ? C.violet : 'rgba(133,165,193,0.28)'}
                strokeWidth={glow ? 2 : 1}
              />
              <text x={inner[i][0]} y={inner[i][1] + 3 * scale} textAnchor="middle"
                fill={glow ? '#f0e6ff' : C.dim}
                style={{ fontSize: `${10.5 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
              >
                {label}
              </text>
              {showDegrees && focusMode === 'diatonic' && degreeMap.minor.get(i) && (
                <g>
                  <rect x={inner[i][0] - 13 * scale} y={inner[i][1] + 10 * scale} width={26 * scale} height={11.5 * scale} rx={4 * scale}
                    fill="rgba(8,18,34,0.9)" stroke="rgba(167,139,250,0.52)" strokeWidth={0.8}
                  />
                  <text x={inner[i][0]} y={inner[i][1] + 18.2 * scale} textAnchor="middle"
                    fill="#ede9fe"
                    style={{ fontSize: `${8.9 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
                  >
                    {degreeMap.minor.get(i)}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {MAJOR_KEYS.map((_, i) => {
          const inDiatonic = focusMode === 'diatonic' && diatonic.dim.has(i);
          const isChord = chordHit?.idx === i && chordHit.ring === 'dim';
          const squareNode = squareIndices.includes(i);
          const isWalk = guideOn && guided.dim.has(i);
          const glow = inDiatonic || isChord || squareNode || isWalk;
          return (
            <g key={`dim-${i}`}>
              {glow && <circle cx={dim[i][0]} cy={dim[i][1]} r={16 * scale} fill={C.rose} opacity={isChord ? 0.32 : inDiatonic ? 0.25 : 0.1} />}
              <circle cx={dim[i][0]} cy={dim[i][1]} r={10 * scale}
                fill="rgba(8,14,28,0.9)"
                stroke={glow ? C.rose : 'rgba(133,165,193,0.2)'}
                strokeWidth={glow ? 1.8 : 1}
              />
              {showDegrees && focusMode === 'diatonic' && degreeMap.dim.get(i) && (
                <g>
                  <rect x={dim[i][0] - 12 * scale} y={dim[i][1] + 8 * scale} width={24 * scale} height={11 * scale} rx={4 * scale}
                    fill="rgba(8,18,34,0.9)" stroke="rgba(244,114,182,0.52)" strokeWidth={0.8}
                  />
                  <text x={dim[i][0]} y={dim[i][1] + 16 * scale} textAnchor="middle"
                    fill="#fbcfe8"
                    style={{ fontSize: `${8.2 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
                  >
                    {degreeMap.dim.get(i)}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        <text x={cx} y={cy - 10 * scale} textAnchor="middle" fill={C.text}
          style={{ fontSize: `${44 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}
        >
          {activeKey} {activeMode}
        </text>
        <text x={cx} y={cy + 22 * scale} textAnchor="middle" fill={C.dim}
          style={{ fontSize: `${15 * scale}px`, fontFamily: 'SF Mono, Fira Code, monospace' }}
        >
          {guideOn
            ? caption
            : focusMode === 'diatonic'
            ? 'Diatonic focus: major, minor and diminished triads by function'
            : (detectedChord ? `Detected chord: ${detectedChord}` : 'Chord focus: illuminate one chord target at a time')}
        </text>

        <g>
          <rect x={16} y={14} width={286} height={114} rx={10} fill={C.glass} stroke={C.glassBorder} strokeWidth={1} />
          <line x1={16} y1={40} x2={302} y2={40} stroke="rgba(115,170,214,0.25)" strokeWidth={1} />
          <text x={32} y={32} fill={C.text} style={{ fontSize: '11px', fontFamily: 'SF Mono, Fira Code, monospace', fontWeight: 700 }}>
            CONSTELLATION THEORY VIEW
          </text>
          <text x={32} y={58} fill={C.dim} style={{ fontSize: '11px', fontFamily: 'SF Mono, Fira Code, monospace' }}>
            Focus: {focusMode.toUpperCase()}
          </text>
          <text x={32} y={76} fill={C.dim} style={{ fontSize: '11px', fontFamily: 'SF Mono, Fira Code, monospace' }}>
            Active Key: {activeKey} {activeMode}
          </text>
          <text x={32} y={94} fill={C.dim} style={{ fontSize: '11px', fontFamily: 'SF Mono, Fira Code, monospace' }}>
            Chord: {analysisLabel ?? detectedChord ?? 'none'}
          </text>
          <text x={32} y={112} fill={C.dim} style={{ fontSize: '11px', fontFamily: 'SF Mono, Fira Code, monospace' }}>
            Notes Held: {activeNotes.length}
          </text>
        </g>
      </svg>
    </AbsoluteFill>
  );
};
