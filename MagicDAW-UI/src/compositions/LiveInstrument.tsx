import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from 'remotion';

// ── Aurora palette (inline to avoid mockData dep in composition) ──────────
const A = {
  bg: '#0d1520',
  bgDeep: '#080e18',
  teal: '#2dd4bf',
  green: '#34d399',
  cyan: '#67e8f9',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  orange: '#fb923c',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  textMuted: '#64748b',
  glass: 'rgba(120,200,220,0.06)',
  glassBorder: 'rgba(120,200,220,0.12)',
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ZONE_COLORS = [A.teal, A.cyan, A.purple, A.pink, A.gold];

// ── Types ──────────────────────────────────────────────────────────────────

export interface LiveInstrumentProps {
  waveformData: number[];
  zones: Array<{ lowNote: number; highNote: number; rootNote: number; name: string }>;
  adsr: { attack: number; decay: number; sustain: number; release: number };
  filter: { cutoff: number; resonance: number; type: string };
  activeNotes: number[];
  sampleLoaded: boolean;
  sampleName: string;
}

// ── Layout constants ───────────────────────────────────────────────────────
const W = 960;
const H = 600;

// Waveform area
const WAVE_X = 20;
const WAVE_Y = 20;
const WAVE_W = 700;
const WAVE_H = 200;

// ADSR area
const ADSR_X = 20;
const ADSR_Y = 240;
const ADSR_W = 700;
const ADSR_H = 130;

// Keyboard area
const KB_X = 20;
const KB_Y = 390;
const KB_W = 920;
const KB_H = 100;
const TOTAL_KEYS = 88;

// Filter area (side panel)
const FILT_X = 740;
const FILT_Y = 20;
const FILT_W = 200;
const FILT_H = 350;

// ── Helper: seeded random ──────────────────────────────────────────────────
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── Helper: build waveform SVG path ────────────────────────────────────────
function buildWaveformPath(data: number[], x: number, y: number, w: number, h: number): string {
  if (data.length === 0) return '';
  const midY = y + h / 2;
  const step = data.length / w;
  const points: string[] = [];
  for (let i = 0; i < w; i++) {
    const idx = Math.min(Math.floor(i * step), data.length - 1);
    const val = data[idx];
    const py = midY - val * (h / 2) * 0.85;
    points.push(`${i === 0 ? 'M' : 'L'} ${x + i} ${py.toFixed(1)}`);
  }
  return points.join(' ');
}

// ── Helper: build filled waveform (for gradient fill below line) ──────────
function buildWaveformFill(data: number[], x: number, y: number, w: number, h: number): string {
  const path = buildWaveformPath(data, x, y, w, h);
  if (!path) return '';
  return `${path} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
}

// ── Helper: ADSR envelope path ─────────────────────────────────────────────
function buildADSRPath(
  adsr: LiveInstrumentProps['adsr'],
  x: number, y: number, w: number, h: number,
): { path: string; points: Array<{ cx: number; cy: number; label: string }> } {
  const pad = 10;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const top = y + pad;
  const bottom = y + h - pad;
  const left = x + pad;

  // Normalize ADSR to segment widths
  const totalTime = adsr.attack + adsr.decay + 0.3 + adsr.release; // sustain hold is fixed visual width
  const aW = (adsr.attack / totalTime) * innerW;
  const dW = (adsr.decay / totalTime) * innerW;
  const sW = (0.3 / totalTime) * innerW;
  const rW = (adsr.release / totalTime) * innerW;

  const sustainY = top + innerH * (1 - adsr.sustain);

  const p0 = { cx: left, cy: bottom };
  const p1 = { cx: left + aW, cy: top, label: 'A' };
  const p2 = { cx: left + aW + dW, cy: sustainY, label: 'D' };
  const p3 = { cx: left + aW + dW + sW, cy: sustainY, label: 'S' };
  const p4 = { cx: left + aW + dW + sW + rW, cy: bottom, label: 'R' };

  const path = `M ${p0.cx} ${p0.cy} L ${p1.cx} ${p1.cy} L ${p2.cx} ${p2.cy} L ${p3.cx} ${p3.cy} L ${p4.cx} ${p4.cy}`;

  return {
    path,
    points: [p1, p2, p3, p4],
  };
}

// ── Helper: filter response curve ──────────────────────────────────────────
function buildFilterCurve(
  cutoff: number, resonance: number, type: string,
  x: number, y: number, w: number, h: number,
): string {
  const points: string[] = [];
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    const freq = i / steps; // 0..1 normalized frequency
    const px = x + (i / steps) * w;
    let gain = 0;

    // Simple filter shape approximation
    const fc = cutoff; // 0..1
    const q = 1 + resonance * 8;
    const dist = Math.abs(freq - fc);
    const resPeak = q * Math.exp(-dist * dist * q * 40);

    if (type === 'HP' || type === 'highpass') {
      gain = freq < fc ? Math.pow(freq / Math.max(fc, 0.001), 3) : 1;
      gain += resPeak * 0.3;
    } else if (type === 'BP' || type === 'bandpass') {
      gain = Math.exp(-dist * dist * 20) * (1 + resonance * 2);
    } else if (type === 'Notch' || type === 'notch') {
      gain = 1 - Math.exp(-dist * dist * 30);
      gain = Math.max(gain, 0.05);
    } else {
      // LP (default)
      gain = freq > fc ? Math.pow(fc / Math.max(freq, 0.001), 3) : 1;
      gain += resPeak * 0.3;
    }

    gain = Math.max(0, Math.min(1.5, gain));
    const py = y + h - gain * h * 0.6 - h * 0.1;
    points.push(`${i === 0 ? 'M' : 'L'} ${px} ${py.toFixed(1)}`);
  }
  return points.join(' ');
}

// ── Constellation background dots ──────────────────────────────────────────
function ConstellationDots({ frame, rand }: { frame: number; rand: () => number }) {
  const dots = useMemo(() => {
    return Array.from({ length: 60 }, () => ({
      x: rand() * W,
      y: rand() * H,
      r: 0.5 + rand() * 1.5,
      phase: rand() * Math.PI * 2,
      speed: 0.02 + rand() * 0.03,
    }));
  }, [rand]);

  return (
    <g>
      {dots.map((d, i) => {
        const opacity = 0.15 + Math.sin(frame * d.speed + d.phase) * 0.1;
        return (
          <circle key={i} cx={d.x} cy={d.y} r={d.r}
            fill={A.cyan} opacity={opacity} />
        );
      })}
    </g>
  );
}

// ── Main composition ───────────────────────────────────────────────────────

export const LiveInstrument: React.FC<LiveInstrumentProps> = ({
  waveformData,
  zones,
  adsr,
  filter,
  activeNotes,
  sampleLoaded,
  sampleName,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rand = useMemo(() => seededRandom(42), []);

  // ── Entrance animations ─────────────────────────────────────────────────
  const masterEntrance = spring({ frame, fps, config: { damping: 60, stiffness: 30 } });
  const waveEntrance = spring({ frame: frame - 5, fps, config: { damping: 50, stiffness: 40 } });
  const adsrEntrance = spring({ frame: frame - 12, fps, config: { damping: 50, stiffness: 40 } });
  const kbEntrance = spring({ frame: frame - 18, fps, config: { damping: 50, stiffness: 40 } });
  const filterEntrance = spring({ frame: frame - 8, fps, config: { damping: 50, stiffness: 40 } });

  // ── Waveform ghost echoes ───────────────────────────────────────────────
  const echoScales = [0.6, 1.4, 0.3];
  const echoOffsets = [{ x: -30, y: 40 }, { x: 60, y: -20 }, { x: -80, y: 80 }];

  // ── ADSR envelope ───────────────────────────────────────────────────────
  const adsrData = useMemo(
    () => buildADSRPath(adsr, ADSR_X, ADSR_Y, ADSR_W, ADSR_H),
    [adsr],
  );

  // ── ADSR tracing dot (cycles through envelope when notes active) ──────
  const hasActiveNotes = activeNotes.length > 0;
  const traceDot = useMemo(() => {
    if (!hasActiveNotes) return null;
    // Parse the path to get segment points
    const segments = adsrData.path.split(/[ML]\s*/).filter(Boolean).map((s) => {
      const [cx, cy] = s.trim().split(/\s+/).map(Number);
      return { cx, cy };
    });
    if (segments.length < 5) return null;

    // Cycle through envelope in 2 seconds
    const cycleDuration = fps * 2;
    const t = (frame % cycleDuration) / cycleDuration;

    // Walk segments proportionally
    const totalLen = segments.reduce((acc, s, i) => {
      if (i === 0) return 0;
      const prev = segments[i - 1];
      return acc + Math.hypot(s.cx - prev.cx, s.cy - prev.cy);
    }, 0);

    let target = t * totalLen;
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1];
      const cur = segments[i];
      const segLen = Math.hypot(cur.cx - prev.cx, cur.cy - prev.cy);
      if (target <= segLen || i === segments.length - 1) {
        const frac = segLen > 0 ? target / segLen : 0;
        return {
          cx: prev.cx + (cur.cx - prev.cx) * Math.min(frac, 1),
          cy: prev.cy + (cur.cy - prev.cy) * Math.min(frac, 1),
        };
      }
      target -= segLen;
    }
    return null;
  }, [hasActiveNotes, adsrData.path, frame, fps]);

  // ── Filter curve ────────────────────────────────────────────────────────
  const filterCurvePath = useMemo(
    () => buildFilterCurve(filter.cutoff, filter.resonance, filter.type, FILT_X + 15, FILT_Y + 60, FILT_W - 30, FILT_H - 140),
    [filter],
  );
  const cutoffX = FILT_X + 15 + filter.cutoff * (FILT_W - 30);

  // ── Keyboard helpers ────────────────────────────────────────────────────
  const whiteKeyIndices = useMemo(() => {
    const indices: number[] = [];
    for (let i = 0; i < TOTAL_KEYS; i++) {
      const noteInOctave = (i + 9) % 12; // Piano starts at A0 (MIDI 21)
      const isBlack = [1, 3, 6, 8, 10].includes(noteInOctave);
      if (!isBlack) indices.push(i);
    }
    return indices;
  }, []);
  const totalWhite = whiteKeyIndices.length; // 52
  const whiteW = KB_W / totalWhite;

  // Map MIDI note 21-108 to key index
  const keyToWhiteIndex = (keyIdx: number): number => {
    let wIdx = 0;
    for (let i = 0; i < keyIdx; i++) {
      const noteInOctave = (i + 9) % 12;
      if (![1, 3, 6, 8, 10].includes(noteInOctave)) wIdx++;
    }
    return wIdx;
  };

  // ── Active notes set ────────────────────────────────────────────────────
  const activeSet = useMemo(() => new Set(activeNotes), [activeNotes]);

  // ── Drop zone particles (when no sample loaded) ─────────────────────────
  const dropParticles = useMemo(() => {
    const r2 = seededRandom(99);
    return Array.from({ length: 30 }, () => ({
      angle: r2() * Math.PI * 2,
      dist: 60 + r2() * 100,
      speed: 0.01 + r2() * 0.02,
      size: 1 + r2() * 2,
    }));
  }, []);

  // ── Waveform playback particles ─────────────────────────────────────────
  const waveParticles = useMemo(() => {
    const r2 = seededRandom(77);
    return Array.from({ length: 12 }, () => ({
      dy: -20 + r2() * 40,
      life: 10 + r2() * 20,
      size: 1 + r2() * 2,
      delay: r2() * 10,
    }));
  }, []);

  // ── Playback position on waveform when notes active ─────────────────────
  const playbackPos = hasActiveNotes
    ? WAVE_X + ((frame * 2) % WAVE_W)
    : -1;

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          {/* Aurora gradient for waveform stroke */}
          <linearGradient id="li-aurora" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={A.teal} />
            <stop offset="25%" stopColor={A.cyan} />
            <stop offset="50%" stopColor={A.purple} />
            <stop offset="75%" stopColor={A.pink} />
            <stop offset="100%" stopColor={A.gold} />
          </linearGradient>

          {/* Aurora gradient for fill */}
          <linearGradient id="li-aurora-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={A.teal} stopOpacity={0.25} />
            <stop offset="25%" stopColor={A.cyan} stopOpacity={0.2} />
            <stop offset="50%" stopColor={A.purple} stopOpacity={0.15} />
            <stop offset="75%" stopColor={A.pink} stopOpacity={0.1} />
            <stop offset="100%" stopColor={A.gold} stopOpacity={0.08} />
          </linearGradient>

          {/* ADSR gradient */}
          <linearGradient id="li-adsr-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={A.teal} />
            <stop offset="33%" stopColor={A.cyan} />
            <stop offset="66%" stopColor={A.purple} />
            <stop offset="100%" stopColor={A.pink} />
          </linearGradient>

          <linearGradient id="li-adsr-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={A.teal} stopOpacity={0.15} />
            <stop offset="50%" stopColor={A.purple} stopOpacity={0.08} />
            <stop offset="100%" stopColor={A.pink} stopOpacity={0.05} />
          </linearGradient>

          {/* Filter gradient */}
          <linearGradient id="li-filter-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={A.gold} />
            <stop offset="100%" stopColor={A.orange} />
          </linearGradient>

          {/* Zone gradients */}
          {ZONE_COLORS.map((color, i) => (
            <linearGradient key={`zg-${i}`} id={`li-zone-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={color} stopOpacity={0.1} />
            </linearGradient>
          ))}

          {/* Glow filters */}
          <filter id="li-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="li-glow-lg" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="li-glow-sm" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>

          {/* Drop zone radial pulse */}
          <radialGradient id="li-drop-ring" cx="50%" cy="50%" r="50%">
            <stop offset="60%" stopColor={A.cyan} stopOpacity={0} />
            <stop offset="80%" stopColor={A.cyan} stopOpacity={0.3} />
            <stop offset="100%" stopColor={A.cyan} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* ═══ Background ═══ */}
        <rect width={W} height={H} fill={A.bgDeep} rx={12} />

        {/* Constellation dots */}
        <ConstellationDots frame={frame} rand={rand} />

        {/* Ghost waveform echoes (very low opacity) */}
        {sampleLoaded && waveformData.length > 0 && echoScales.map((scale, i) => {
          const echoW = WAVE_W * scale;
          const echoH = WAVE_H * scale;
          const ox = WAVE_X + echoOffsets[i].x + (WAVE_W - echoW) / 2;
          const oy = WAVE_Y + echoOffsets[i].y + (WAVE_H - echoH) / 2;
          const drift = Math.sin(frame * 0.015 + i * 2) * 8;
          return (
            <g key={`echo-${i}`} opacity={0.04 + Math.sin(frame * 0.02 + i) * 0.01}
              transform={`translate(${drift}, ${Math.cos(frame * 0.012 + i) * 4})`}>
              <path
                d={buildWaveformPath(waveformData, ox, oy, echoW, echoH)}
                fill="none" stroke={A.cyan} strokeWidth={1} />
            </g>
          );
        })}

        {/* ═══ Waveform Display ═══ */}
        <g opacity={waveEntrance}>
          {/* Panel background */}
          <rect x={WAVE_X} y={WAVE_Y} width={WAVE_W} height={WAVE_H}
            rx={8} fill={A.glass} stroke={A.glassBorder} strokeWidth={0.5} />

          {/* Label */}
          <text x={WAVE_X + 12} y={WAVE_Y + 16} fill={A.textMuted}
            fontSize={9} fontFamily="monospace" letterSpacing="0.1em">
            {sampleLoaded ? `WAVEFORM — ${sampleName}` : 'WAVEFORM'}
          </text>

          {sampleLoaded && waveformData.length > 0 ? (
            <>
              {/* Center line */}
              <line x1={WAVE_X} y1={WAVE_Y + WAVE_H / 2}
                x2={WAVE_X + WAVE_W} y2={WAVE_Y + WAVE_H / 2}
                stroke={A.glassBorder} strokeWidth={0.5} strokeDasharray="4 4" />

              {/* Fill below waveform */}
              <path
                d={buildWaveformFill(waveformData, WAVE_X, WAVE_Y + 24, WAVE_W, WAVE_H - 24)}
                fill="url(#li-aurora-fill)" />

              {/* Main waveform line (thick, glowing) */}
              <path
                d={buildWaveformPath(waveformData, WAVE_X, WAVE_Y + 24, WAVE_W, WAVE_H - 24)}
                fill="none" stroke="url(#li-aurora)" strokeWidth={2.5}
                strokeLinecap="round" strokeLinejoin="round"
                filter="url(#li-glow)" />

              {/* Active playback highlight */}
              {hasActiveNotes && playbackPos > 0 && (
                <g>
                  {/* Playback position beam */}
                  <line x1={playbackPos} y1={WAVE_Y + 24} x2={playbackPos} y2={WAVE_Y + WAVE_H}
                    stroke={A.cyan} strokeWidth={2} opacity={0.9} filter="url(#li-glow)" />

                  {/* Particles emitting from playback position */}
                  {waveParticles.map((p, i) => {
                    const age = (frame + p.delay) % p.life;
                    const t = age / p.life;
                    const midIdx = Math.min(
                      Math.floor(((playbackPos - WAVE_X) / WAVE_W) * waveformData.length),
                      waveformData.length - 1,
                    );
                    const baseY = WAVE_Y + 24 + (WAVE_H - 24) / 2
                      - (midIdx >= 0 ? waveformData[midIdx] : 0) * (WAVE_H - 24) / 2 * 0.85;
                    return (
                      <circle key={`wp-${i}`}
                        cx={playbackPos + t * 15}
                        cy={baseY + p.dy * t}
                        r={p.size * (1 - t)}
                        fill={A.cyan} opacity={0.6 * (1 - t)}
                        filter="url(#li-glow-sm)" />
                    );
                  })}
                </g>
              )}
            </>
          ) : !sampleLoaded ? (
            /* ═══ Drop Zone (no sample loaded) ═══ */
            <g>
              {/* Pulsing aurora ring */}
              {(() => {
                const cx = WAVE_X + WAVE_W / 2;
                const cy = WAVE_Y + WAVE_H / 2 + 10;
                const pulseR = 50 + Math.sin(frame * 0.05) * 8;
                const ringOpacity = 0.3 + Math.sin(frame * 0.05) * 0.15;
                return (
                  <>
                    <circle cx={cx} cy={cy} r={pulseR + 10}
                      fill="none" stroke={A.cyan} strokeWidth={1}
                      opacity={ringOpacity * 0.3} filter="url(#li-glow-lg)" />
                    <circle cx={cx} cy={cy} r={pulseR}
                      fill="none" stroke="url(#li-aurora)" strokeWidth={2}
                      opacity={ringOpacity} filter="url(#li-glow)" />
                    <circle cx={cx} cy={cy} r={pulseR - 15}
                      fill="none" stroke={A.purple} strokeWidth={0.5}
                      opacity={ringOpacity * 0.5} />

                    {/* Drop text */}
                    <text x={cx} y={cy - 4} textAnchor="middle"
                      fill={A.cyan} fontSize={14} fontFamily="monospace"
                      opacity={0.6 + Math.sin(frame * 0.04) * 0.2}
                      filter="url(#li-glow-sm)">
                      Drop Sample
                    </text>
                    <text x={cx} y={cy + 14} textAnchor="middle"
                      fill={A.textMuted} fontSize={9} fontFamily="monospace" opacity={0.5}>
                      WAV · AIFF · MP3
                    </text>

                    {/* Constellation particles drifting inward */}
                    {dropParticles.map((p, i) => {
                      const age = (frame * p.speed + p.angle) % (Math.PI * 2);
                      const drift = p.dist * (0.3 + Math.sin(age) * 0.7);
                      const px = cx + Math.cos(p.angle + frame * 0.003) * drift;
                      const py = cy + Math.sin(p.angle + frame * 0.003) * drift;
                      const pOpacity = interpolate(drift, [20, p.dist], [0, 0.4], {
                        extrapolateLeft: 'clamp',
                        extrapolateRight: 'clamp',
                      });
                      return (
                        <circle key={`dp-${i}`} cx={px} cy={py} r={p.size}
                          fill={i % 3 === 0 ? A.cyan : i % 3 === 1 ? A.purple : A.teal}
                          opacity={pOpacity} />
                      );
                    })}
                  </>
                );
              })()}
            </g>
          ) : null}
        </g>

        {/* ═══ ADSR Envelope ═══ */}
        <g opacity={adsrEntrance}>
          {/* Panel */}
          <rect x={ADSR_X} y={ADSR_Y} width={ADSR_W} height={ADSR_H}
            rx={8} fill={A.glass} stroke={A.glassBorder} strokeWidth={0.5} />

          {/* Label */}
          <text x={ADSR_X + 12} y={ADSR_Y + 16} fill={A.textMuted}
            fontSize={9} fontFamily="monospace" letterSpacing="0.1em">
            ADSR ENVELOPE
          </text>

          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((r) => (
            <line key={`adsr-grid-${r}`}
              x1={ADSR_X + 10} y1={ADSR_Y + 10 + (ADSR_H - 20) * r}
              x2={ADSR_X + ADSR_W - 10} y2={ADSR_Y + 10 + (ADSR_H - 20) * r}
              stroke={A.glassBorder} strokeWidth={0.3} />
          ))}

          {/* Fill below curve */}
          <path
            d={`${adsrData.path} L ${ADSR_X + ADSR_W - 10} ${ADSR_Y + ADSR_H - 10} L ${ADSR_X + 10} ${ADSR_Y + ADSR_H - 10} Z`}
            fill="url(#li-adsr-fill)" />

          {/* ADSR curve */}
          <path d={adsrData.path}
            fill="none" stroke="url(#li-adsr-grad)" strokeWidth={2.5}
            strokeLinecap="round" strokeLinejoin="round"
            filter="url(#li-glow)" />

          {/* Control point dots with glow halos */}
          {adsrData.points.map((pt, i) => (
            <g key={`adsr-pt-${i}`}>
              {/* Halo */}
              <circle cx={pt.cx} cy={pt.cy} r={8}
                fill={ZONE_COLORS[i]} opacity={0.1}
                filter="url(#li-glow-lg)" />
              {/* Dot */}
              <circle cx={pt.cx} cy={pt.cy} r={4}
                fill={ZONE_COLORS[i]} opacity={0.9}
                filter="url(#li-glow-sm)"
                style={{ cursor: 'pointer' }} />
              {/* Label */}
              <text x={pt.cx} y={pt.cy - 10}
                textAnchor="middle" fill={ZONE_COLORS[i]}
                fontSize={8} fontFamily="monospace" opacity={0.7}>
                {pt.label}
              </text>
            </g>
          ))}

          {/* Tracing dot when notes active */}
          {traceDot && (
            <g>
              <circle cx={traceDot.cx} cy={traceDot.cy} r={10}
                fill={A.cyan} opacity={0.15} filter="url(#li-glow-lg)" />
              <circle cx={traceDot.cx} cy={traceDot.cy} r={5}
                fill={A.cyan} opacity={0.8} filter="url(#li-glow)" />
              <circle cx={traceDot.cx} cy={traceDot.cy} r={2}
                fill="#fff" opacity={0.9} />
            </g>
          )}
        </g>

        {/* ═══ Filter Visualization (side panel) ═══ */}
        <g opacity={filterEntrance}>
          {/* Panel */}
          <rect x={FILT_X} y={FILT_Y} width={FILT_W} height={FILT_H}
            rx={8} fill={A.glass} stroke={A.glassBorder} strokeWidth={0.5} />

          {/* Label */}
          <text x={FILT_X + 12} y={FILT_Y + 16} fill={A.textMuted}
            fontSize={9} fontFamily="monospace" letterSpacing="0.1em">
            FILTER — {filter.type.toUpperCase()}
          </text>

          {/* Frequency axis */}
          <line x1={FILT_X + 15} y1={FILT_Y + FILT_H - 80}
            x2={FILT_X + FILT_W - 15} y2={FILT_Y + FILT_H - 80}
            stroke={A.glassBorder} strokeWidth={0.5} />
          <text x={FILT_X + 15} y={FILT_Y + FILT_H - 68}
            fill={A.textMuted} fontSize={7} fontFamily="monospace">20Hz</text>
          <text x={FILT_X + FILT_W - 15} y={FILT_Y + FILT_H - 68}
            fill={A.textMuted} fontSize={7} fontFamily="monospace" textAnchor="end">20kHz</text>

          {/* Filter curve fill */}
          <path
            d={`${filterCurvePath} L ${FILT_X + FILT_W - 15} ${FILT_Y + FILT_H - 80} L ${FILT_X + 15} ${FILT_Y + FILT_H - 80} Z`}
            fill={A.gold} opacity={0.06} />

          {/* Filter curve */}
          <path d={filterCurvePath}
            fill="none" stroke="url(#li-filter-grad)" strokeWidth={2}
            strokeLinecap="round" filter="url(#li-glow-sm)" />

          {/* Cutoff beam */}
          <line x1={cutoffX} y1={FILT_Y + 50}
            x2={cutoffX} y2={FILT_Y + FILT_H - 80}
            stroke={A.gold} strokeWidth={1.5} opacity={0.5 + Math.sin(frame * 0.06) * 0.2}
            filter="url(#li-glow)" />
          <circle cx={cutoffX} cy={FILT_Y + 50} r={3}
            fill={A.gold} opacity={0.8} filter="url(#li-glow-sm)" />

          {/* Readouts */}
          <text x={FILT_X + FILT_W / 2} y={FILT_Y + FILT_H - 44}
            textAnchor="middle" fill={A.gold}
            fontSize={11} fontFamily="monospace" opacity={0.8}>
            {Math.round(filter.cutoff * 20000)} Hz
          </text>
          <text x={FILT_X + FILT_W / 2} y={FILT_Y + FILT_H - 30}
            textAnchor="middle" fill={A.orange}
            fontSize={9} fontFamily="monospace" opacity={0.6}>
            Q: {filter.resonance.toFixed(2)}
          </text>

          {/* Resonance visual — peak indicator */}
          <rect x={FILT_X + 15} y={FILT_Y + FILT_H - 20}
            width={(FILT_W - 30) * filter.resonance} height={4}
            rx={2} fill={A.orange} opacity={0.4} />
        </g>

        {/* ═══ Keyboard + Key Mapping ═══ */}
        <g opacity={kbEntrance}>
          {/* Panel */}
          <rect x={KB_X} y={KB_Y} width={KB_W} height={KB_H}
            rx={8} fill={A.glass} stroke={A.glassBorder} strokeWidth={0.5} />

          {/* Zone rectangles above keyboard */}
          {zones.map((zone, zi) => {
            const startKey = Math.max(zone.lowNote - 21, 0);
            const endKey = Math.min(zone.highNote - 21, TOTAL_KEYS - 1);
            const startWI = keyToWhiteIndex(startKey);
            const endWI = keyToWhiteIndex(endKey);
            const zx = KB_X + startWI * whiteW;
            const zw = (endWI - startWI + 1) * whiteW;
            return (
              <rect key={`zone-${zi}`}
                x={zx} y={KB_Y + 4}
                width={Math.max(zw, 2)} height={20}
                rx={3} fill={`url(#li-zone-${zi % ZONE_COLORS.length})`}
                stroke={ZONE_COLORS[zi % ZONE_COLORS.length]}
                strokeWidth={0.5} opacity={0.7} />
            );
          })}

          {/* Root note diamonds */}
          {zones.map((zone, zi) => {
            const rootKey = zone.rootNote - 21;
            if (rootKey < 0 || rootKey >= TOTAL_KEYS) return null;
            const rootWI = keyToWhiteIndex(rootKey);
            const dx = KB_X + rootWI * whiteW + whiteW / 2;
            const dy = KB_Y + 14;
            return (
              <polygon key={`root-${zi}`}
                points={`${dx},${dy - 5} ${dx + 4},${dy} ${dx},${dy + 5} ${dx - 4},${dy}`}
                fill={ZONE_COLORS[zi % ZONE_COLORS.length]}
                filter="url(#li-glow-sm)" />
            );
          })}

          {/* Zone labels */}
          {zones.map((zone, zi) => {
            const startKey = Math.max(zone.lowNote - 21, 0);
            const endKey = Math.min(zone.highNote - 21, TOTAL_KEYS - 1);
            const startWI = keyToWhiteIndex(startKey);
            const endWI = keyToWhiteIndex(endKey);
            const midX = KB_X + ((startWI + endWI) / 2) * whiteW + whiteW / 2;
            return (
              <text key={`zlbl-${zi}`} x={midX} y={KB_Y + 30}
                textAnchor="middle" fill={ZONE_COLORS[zi % ZONE_COLORS.length]}
                fontSize={7} fontFamily="monospace" opacity={0.7}>
                {zone.name || `${NOTE_NAMES[zone.rootNote % 12]}${Math.floor(zone.rootNote / 12) - 1}`}
              </text>
            );
          })}

          {/* White keys */}
          {whiteKeyIndices.map((keyIdx, wi) => {
            const midiNote = keyIdx + 21;
            const isActive = activeSet.has(midiNote);
            const inZone = zones.some((z) => midiNote >= z.lowNote && midiNote <= z.highNote);
            const zoneIdx = zones.findIndex((z) => midiNote >= z.lowNote && midiNote <= z.highNote);
            return (
              <rect key={`wk-${wi}`}
                x={KB_X + wi * whiteW + 0.5}
                y={KB_Y + 36}
                width={whiteW - 1}
                height={KB_H - 42}
                rx={2}
                fill={isActive
                  ? ZONE_COLORS[zoneIdx >= 0 ? zoneIdx % ZONE_COLORS.length : 0]
                  : inZone
                    ? `${ZONE_COLORS[zoneIdx % ZONE_COLORS.length]}22`
                    : 'rgba(200,220,230,0.06)'}
                stroke={A.glassBorder}
                strokeWidth={0.3}
                opacity={isActive ? 0.9 : 1} />
            );
          })}

          {/* Black keys */}
          {Array.from({ length: TOTAL_KEYS }, (_, keyIdx) => {
            const noteInOctave = (keyIdx + 9) % 12;
            const isBlack = [1, 3, 6, 8, 10].includes(noteInOctave);
            if (!isBlack) return null;

            const midiNote = keyIdx + 21;
            const isActive = activeSet.has(midiNote);
            const zoneIdx = zones.findIndex((z) => midiNote >= z.lowNote && midiNote <= z.highNote);

            // Position black key between its neighboring white keys
            const prevWhites = whiteKeyIndices.filter((wi) => wi < keyIdx).length;
            const bx = KB_X + prevWhites * whiteW - whiteW * 0.3;

            return (
              <rect key={`bk-${keyIdx}`}
                x={bx}
                y={KB_Y + 36}
                width={whiteW * 0.6}
                height={(KB_H - 42) * 0.6}
                rx={1.5}
                fill={isActive
                  ? ZONE_COLORS[zoneIdx >= 0 ? zoneIdx % ZONE_COLORS.length : 0]
                  : zoneIdx >= 0
                    ? `${ZONE_COLORS[zoneIdx % ZONE_COLORS.length]}44`
                    : 'rgba(10,15,25,0.9)'}
                stroke={A.glassBorder}
                strokeWidth={0.5} />
            );
          })}

          {/* Active key glows */}
          {activeNotes.map((note) => {
            const keyIdx = note - 21;
            if (keyIdx < 0 || keyIdx >= TOTAL_KEYS) return null;
            const noteInOctave = (keyIdx + 9) % 12;
            const isBlack = [1, 3, 6, 8, 10].includes(noteInOctave);
            const wi = keyToWhiteIndex(keyIdx);
            const kx = isBlack
              ? KB_X + wi * whiteW - whiteW * 0.3
              : KB_X + wi * whiteW + 0.5;
            const kw = isBlack ? whiteW * 0.6 : whiteW - 1;
            const ky = KB_Y + 36;
            const kh = isBlack ? (KB_H - 42) * 0.6 : KB_H - 42;
            const zoneIdx = zones.findIndex((z) => note >= z.lowNote && note <= z.highNote);
            const color = ZONE_COLORS[zoneIdx >= 0 ? zoneIdx % ZONE_COLORS.length : 0];

            return (
              <rect key={`glow-${note}`}
                x={kx - 1} y={ky - 1}
                width={kw + 2} height={kh + 2}
                rx={3} fill="none"
                stroke={color} strokeWidth={1.5}
                opacity={0.7} filter="url(#li-glow)" />
            );
          })}

          {/* Keyboard label */}
          <text x={KB_X + 12} y={KB_Y + KB_H - 4} fill={A.textMuted}
            fontSize={7} fontFamily="monospace" opacity={0.4}>
            A0 — C8 · {zones.length} zone{zones.length !== 1 ? 's' : ''}
          </text>
        </g>

        {/* ═══ Title / master opacity ═══ */}
        <g opacity={masterEntrance * 0.5}>
          <text x={W - 12} y={H - 8} textAnchor="end"
            fill={A.textMuted} fontSize={7} fontFamily="monospace"
            letterSpacing="0.15em">
            MAGIC DAW · INSTRUMENT
          </text>
        </g>
      </svg>
    </AbsoluteFill>
  );
};
