import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, spring, useVideoConfig, interpolate } from 'remotion';
import type { Track, EffectSlot } from '../types/daw';
import { EFFECT_DISPLAY_NAMES } from '../types/daw';

// ── Props ────────────────────────────────────────────────────────────────────

export interface LiveMixerProps {
  tracks: Track[];
  masterLevelL: number;
  masterLevelR: number;
  trackLevels: Record<string, { left: number; right: number }>;
  selectedTrackId: string | null;
  soloedTracks: string[];
  mutedTracks: string[];
  effectsChains?: Record<string, EffectSlot[]>;
}

// ── Aurora color constants ──────────────────────────────────────────────────

const AURORA = {
  bg: '#0a0f1a',
  teal: '#2dd4bf',
  green: '#34d399',
  cyan: '#67e8f9',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  orange: '#fb923c',
  textDim: '#94a3b8',
  textMuted: '#64748b',
  text: '#e2e8f0',
  border: 'rgba(120,200,220,0.12)',
};

// ── EQ data (matches MixView) ───────────────────────────────────────────────

const CHANNEL_EQS: Record<string, number[]> = {
  drums: [0.3, 0.8, 0.9, 0.4, 0.25, 0.2, 0.15],
  bass: [0.5, 0.85, 0.7, 0.35, 0.2, 0.15, 0.1],
  keys: [0.15, 0.2, 0.3, 0.6, 0.7, 0.5, 0.35],
  pad: [0.1, 0.15, 0.35, 0.55, 0.65, 0.7, 0.5],
  lead: [0.1, 0.2, 0.4, 0.75, 0.85, 0.6, 0.3],
  vocals: [0.08, 0.12, 0.3, 0.65, 0.8, 0.7, 0.4],
  fx: [0.2, 0.35, 0.5, 0.45, 0.55, 0.7, 0.6],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function generateEqPath(w: number, h: number, points: number[]): string {
  const step = w / (points.length - 1);
  let d = `M 0 ${h - points[0] * h}`;
  for (let i = 1; i < points.length; i++) {
    const x = i * step;
    const y = h - points[i] * h;
    const cpx1 = (i - 1) * step + step * 0.5;
    const cpy1 = h - points[i - 1] * h;
    const cpx2 = x - step * 0.5;
    d += ` C ${cpx1} ${cpy1}, ${cpx2} ${y}, ${x} ${y}`;
  }
  return d;
}

function generateEqFill(w: number, h: number, points: number[]): string {
  return `${generateEqPath(w, h, points)} L ${w} ${h} L 0 ${h} Z`;
}

// ── Sub-components (memoized for perf) ──────────────────────────────────────

/** VU meter bar with aurora gradient, spring physics, peak hold, glow */
const VUBar: React.FC<{
  level: number;
  width: number;
  height: number;
  frame: number;
  fps: number;
  channelIndex: number;
  side: 'L' | 'R';
}> = ({ level, width, height, frame, fps, channelIndex, side }) => {
  const springLevel = spring({
    frame,
    fps,
    from: 0,
    to: level,
    config: { damping: 18, mass: 0.3, stiffness: 120 },
    durationInFrames: 8,
  });

  const fillH = springLevel * height;
  const peakDecay = Math.max(level, level * (1 - (frame % 60) / 120));
  const peakY = height - peakDecay * height;
  const glowIntensity = Math.min(1, level * 1.5);
  const blazeFilter = level > 0.85
    ? `drop-shadow(0 0 ${6 + level * 10}px ${AURORA.pink}) drop-shadow(0 0 ${3 + level * 5}px ${AURORA.gold})`
    : `drop-shadow(0 0 ${2 + glowIntensity * 4}px ${AURORA.cyan})`;
  const ghostH = Math.min(height, fillH * 1.15);
  const gradientId = `vu-grad-${channelIndex}-${side}`;

  return (
    <svg width={width} height={height} style={{ filter: blazeFilter }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={AURORA.cyan} stopOpacity={0.9} />
          <stop offset="45%" stopColor={AURORA.green} stopOpacity={0.85} />
          <stop offset="70%" stopColor={AURORA.gold} stopOpacity={0.8} />
          <stop offset="90%" stopColor={AURORA.pink} stopOpacity={0.9} />
          <stop offset="100%" stopColor="#ff3080" stopOpacity={1} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={width} height={height} rx={2} fill="rgba(0,0,0,0.4)" />
      <rect x={0} y={height - ghostH} width={width} height={ghostH} rx={2}
        fill={AURORA.cyan} opacity={0.06} />
      <rect x={0} y={height - fillH} width={width} height={fillH} rx={2}
        fill={`url(#${gradientId})`} />
      {peakDecay > 0.02 && (
        <rect x={0} y={peakY - 1} width={width} height={2}
          fill={peakDecay > 0.85 ? AURORA.pink : AURORA.gold} opacity={0.95} />
      )}
    </svg>
  );
};

/** Fader visualization — glowing line with aurora gradient fill */
const FaderVis: React.FC<{
  value: number;
  width: number;
  height: number;
  color: string;
  frame: number;
}> = ({ value, width, height, color, frame }) => {
  const fillH = value * height;
  const thumbY = height - fillH;
  const particleCount = 3;
  const particles = Array.from({ length: particleCount }, (_, i) => {
    const phase = (frame * 0.08 + i * 2.1) % 1;
    const px = width / 2 + Math.sin(frame * 0.15 + i * 1.7) * (width * 0.3);
    const py = thumbY - phase * 20;
    const opacity = Math.max(0, 0.6 - phase);
    return { px, py, opacity, r: 1 + (1 - phase) * 1.5 };
  });

  return (
    <svg width={width} height={height}>
      <defs>
        <linearGradient id={`fader-fill-${color}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity={0.6} />
          <stop offset="50%" stopColor={AURORA.cyan} stopOpacity={0.3} />
          <stop offset="100%" stopColor={AURORA.purple} stopOpacity={0.1} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={width} height={height} rx={3} fill="rgba(0,0,0,0.4)"
        stroke={AURORA.border} strokeWidth={0.5} />
      <rect x={1} y={thumbY} width={width - 2} height={fillH} rx={2}
        fill={`url(#fader-fill-${color})`} />
      <line x1={0} y1={thumbY} x2={width} y2={thumbY}
        stroke={color} strokeWidth={2} opacity={0.9} />
      <circle cx={width / 2} cy={thumbY} r={3.5}
        fill={color} opacity={1}
        filter={`drop-shadow(0 0 6px ${color})`} />
      {particles.map((p, i) => (
        <circle key={i} cx={p.px} cy={p.py} r={p.r}
          fill={color} opacity={p.opacity} />
      ))}
    </svg>
  );
};

/** Pan indicator — circular aurora arc */
const PanArc: React.FC<{
  pan: number;
  size: number;
  color: string;
}> = ({ pan, size, color }) => {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;
  const startAngle = interpolate(pan, [-1, 0, 1], [-135, -135, 0]);
  const endAngle = interpolate(pan, [-1, 0, 1], [0, 135, 135]);
  const startRad = (startAngle * Math.PI) / 180 - Math.PI / 2;
  const endRad = (endAngle * Math.PI) / 180 - Math.PI / 2;
  const sx = cx + r * Math.cos(startRad);
  const sy = cy + r * Math.sin(startRad);
  const ex = cx + r * Math.cos(endRad);
  const ey = cy + r * Math.sin(endRad);
  const sweep = endAngle - startAngle;
  const largeArc = sweep > 180 ? 1 : 0;

  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(120,200,220,0.08)" strokeWidth={2} />
      {sweep > 0.5 && (
        <path
          d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`}
          fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round"
          opacity={0.8} filter={`drop-shadow(0 0 4px ${color})`}
        />
      )}
      <circle cx={cx} cy={cy} r={1.5} fill={AURORA.textDim} opacity={0.5} />
      <circle
        cx={cx + r * Math.cos(((pan * 135) * Math.PI) / 180 - Math.PI / 2)}
        cy={cy + r * Math.sin(((pan * 135) * Math.PI) / 180 - Math.PI / 2)}
        r={2} fill={color} opacity={0.9}
      />
    </svg>
  );
};

/** EQ curve visualization per channel */
const EqCurve: React.FC<{
  points: number[];
  width: number;
  height: number;
  color: string;
  frame: number;
}> = ({ points, width, height, color, frame }) => {
  const pulsePhase = Math.sin(frame * 0.06) * 0.03;
  const animatedPoints = points.map((p) => Math.max(0, Math.min(1, p + pulsePhase)));

  return (
    <svg width={width} height={height}>
      <rect x={0} y={0} width={width} height={height} rx={3}
        fill="rgba(0,0,0,0.3)" stroke={AURORA.border} strokeWidth={0.5} />
      {[0.25, 0.5, 0.75].map((r) => (
        <line key={r} x1={0} y1={height * r} x2={width} y2={height * r}
          stroke="rgba(255,255,255,0.03)" strokeWidth={0.5} />
      ))}
      <path d={generateEqFill(width, height, animatedPoints)}
        fill={color} opacity={0.1} />
      <path d={generateEqPath(width, height, animatedPoints)}
        fill="none" stroke={color} strokeWidth={1.2} strokeLinecap="round"
        filter={`drop-shadow(0 0 3px ${hexToRgba(color, 0.5)})`} />
    </svg>
  );
};

// ── Insert Effects Slots ────────────────────────────────────────────────────

const InsertSlots = React.memo<{
  effects: EffectSlot[];
  trackId: string;
  stripWidth: number;
  color: string;
}>(({ effects, trackId, stripWidth, color }) => {
  const maxSlots = 4;
  const slots = [...effects.slice(0, maxSlots)];
  while (slots.length < maxSlots) {
    slots.push(null as unknown as EffectSlot);
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 1, width: stripWidth - 16,
    }}>
      {slots.map((effect, i) => (
        <div
          key={i}
          style={{
            height: 12, borderRadius: 2, fontSize: 6, fontWeight: 600,
            fontFamily: "'Space Mono', monospace",
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: effect
              ? (effect.bypassed ? 'rgba(100,116,139,0.15)' : `${hexToRgba(color, 0.15)}`)
              : 'rgba(120,200,220,0.04)',
            border: `1px solid ${effect
              ? (effect.bypassed ? 'rgba(100,116,139,0.3)' : hexToRgba(color, 0.3))
              : AURORA.border}`,
            color: effect
              ? (effect.bypassed ? AURORA.textMuted : AURORA.text)
              : AURORA.textMuted,
            cursor: 'pointer',
            opacity: effect?.bypassed ? 0.5 : 1,
            textDecoration: effect?.bypassed ? 'line-through' : 'none',
          }}
          data-action={effect ? 'show-effect-params' : 'add-effect'}
          data-track-id={trackId}
          data-effect-index={i}
        >
          {effect ? EFFECT_DISPLAY_NAMES[effect.type]?.substring(0, 6) : '+'}
        </div>
      ))}
    </div>
  );
});

// ── Send Level Indicators ──────────────────────────────────────────────────

const SendIndicators = React.memo<{
  sends: Array<{ busTrackId: string; level: number }>;
  stripWidth: number;
}>(({ sends, stripWidth }) => {
  if (sends.length === 0) return null;
  return (
    <div style={{
      display: 'flex', gap: 2, width: stripWidth - 16, justifyContent: 'center',
    }}>
      {sends.map((send, i) => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: '50%',
          background: `rgba(103, 232, 249, ${Math.max(0.15, send.level)})`,
          border: '1px solid rgba(103, 232, 249, 0.3)',
        }} title={`Send ${i + 1}: ${(send.level * 100).toFixed(0)}%`} />
      ))}
    </div>
  );
});

// ── Channel Strip ───────────────────────────────────────────────────────────

const ChannelStrip: React.FC<{
  track: Track;
  index: number;
  levelL: number;
  levelR: number;
  isSelected: boolean;
  isMuted: boolean;
  isSoloed: boolean;
  dimmed: boolean;
  frame: number;
  fps: number;
  stripWidth: number;
  stripHeight: number;
  effects: EffectSlot[];
  sends: Array<{ busTrackId: string; level: number }>;
}> = ({ track, index, levelL, levelR, isSelected, isMuted, isSoloed, dimmed,
        frame, fps, stripWidth, stripHeight, effects, sends }) => {
  const eqPoints = CHANNEL_EQS[track.id] || CHANNEL_EQS.fx;
  const eqW = stripWidth - 16;
  const eqH = 32;
  const vuHeight = stripHeight * 0.25;
  const faderHeight = stripHeight * 0.25;

  const opacity = isMuted ? 0.25 : dimmed ? 0.2 : 1;
  const selectedGlow = isSelected
    ? `0 0 20px ${hexToRgba(track.color, 0.3)}, 0 0 40px ${hexToRgba(track.color, 0.15)}`
    : 'none';
  const soloPulse = isSoloed ? 0.6 + Math.sin(frame * 0.15) * 0.4 : 0;

  return (
    <div
      style={{
        width: stripWidth, height: stripHeight, display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 3, padding: 5,
        background: isSelected ? 'rgba(120,200,220,0.08)' : 'rgba(120,200,220,0.04)',
        border: `1px solid ${isSelected ? hexToRgba(track.color, 0.4) : AURORA.border}`,
        borderRadius: 8, backdropFilter: 'blur(24px)', opacity,
        transition: 'opacity 0.3s ease', boxShadow: selectedGlow,
        position: 'relative', overflow: 'hidden', flexShrink: 0,
      }}
      data-track-id={track.id}
    >
      {/* Aurora accent stripe */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, transparent, ${track.color}, transparent)`,
        opacity: isSelected ? 0.9 : 0.5,
      }} />

      {isSoloed && (
        <div style={{
          position: 'absolute', inset: -1, borderRadius: 8,
          border: `2px solid ${AURORA.gold}`, opacity: soloPulse, pointerEvents: 'none',
        }} />
      )}

      {isMuted && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', pointerEvents: 'none', zIndex: 5,
        }}>
          <svg width={30} height={30} opacity={0.3}>
            <line x1={5} y1={5} x2={25} y2={25} stroke={AURORA.pink} strokeWidth={2} />
            <line x1={25} y1={5} x2={5} y2={25} stroke={AURORA.pink} strokeWidth={2} />
          </svg>
        </div>
      )}

      {/* Track name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%', paddingTop: 2 }}>
        <div style={{
          width: 5, height: 5, borderRadius: '50%', background: track.color,
          boxShadow: `0 0 5px ${hexToRgba(track.color, 0.6)}`,
        }} />
        <span style={{
          fontSize: 8, fontWeight: 600, color: AURORA.text,
          fontFamily: "'Space Mono', monospace", letterSpacing: '0.02em',
        }}>
          {track.name}
        </span>
      </div>

      {/* Insert effect slots */}
      <InsertSlots effects={effects} trackId={track.id} stripWidth={stripWidth} color={track.color} />

      {/* EQ curve */}
      <EqCurve points={eqPoints} width={eqW} height={eqH} color={track.color} frame={frame} />

      {/* Pan */}
      <PanArc pan={track.pan} size={22} color={track.color} />

      {/* Fader + VU */}
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', flex: 1, minHeight: 0 }}>
        <FaderVis value={track.volume} width={16} height={faderHeight} color={track.color} frame={frame} />
        <VUBar level={isMuted ? 0 : levelL} width={5} height={vuHeight} frame={frame} fps={fps}
          channelIndex={index} side="L" />
        <VUBar level={isMuted ? 0 : levelR} width={5} height={vuHeight} frame={frame} fps={fps}
          channelIndex={index} side="R" />
      </div>

      {/* Send indicators */}
      <SendIndicators sends={sends} stripWidth={stripWidth} />

      {/* dB readout */}
      <span style={{ fontSize: 6, color: AURORA.textDim, fontFamily: "'Space Mono', monospace" }}>
        {track.volume > 0 ? `${(track.volume * 54 - 48).toFixed(1)} dB` : '-inf'}
      </span>

      {/* M/S */}
      <div style={{ display: 'flex', gap: 2, width: '100%' }}>
        <div data-action="mute" data-track-id={track.id} style={{
          flex: 1, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 3, fontSize: 7, fontWeight: 700, fontFamily: "'Space Mono', monospace",
          background: isMuted ? 'rgba(239,68,68,0.25)' : 'rgba(120,200,220,0.06)',
          border: `1px solid ${isMuted ? 'rgba(239,68,68,0.5)' : AURORA.border}`,
          color: isMuted ? '#ef4444' : AURORA.textMuted, cursor: 'pointer',
        }}>M</div>
        <div data-action="solo" data-track-id={track.id} style={{
          flex: 1, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 3, fontSize: 7, fontWeight: 700, fontFamily: "'Space Mono', monospace",
          background: isSoloed ? 'rgba(251,191,36,0.25)' : 'rgba(120,200,220,0.06)',
          border: `1px solid ${isSoloed ? 'rgba(251,191,36,0.5)' : AURORA.border}`,
          color: isSoloed ? AURORA.gold : AURORA.textMuted, cursor: 'pointer',
        }}>S</div>
      </div>
    </div>
  );
};

// ── Master Channel (memoized static parts) ─────────────────────────────────

const MasterChannel: React.FC<{
  levelL: number;
  levelR: number;
  frame: number;
  fps: number;
  stripWidth: number;
  stripHeight: number;
}> = ({ levelL, levelR, frame, fps, stripWidth, stripHeight }) => {
  const vuHeight = stripHeight * 0.45;
  const faderHeight = stripHeight * 0.35;
  const lufs = -14.2 + Math.sin(frame * 0.05) * 0.8 + (levelL + levelR) * 2 - 2;
  const lufsNorm = Math.max(0, (lufs + 24) / 24);
  const loudness = (levelL + levelR) / 2;
  const washOpacity = 0.05 + loudness * 0.1;

  return (
    <div style={{
      width: stripWidth, height: stripHeight, display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 6, padding: 8,
      background: 'rgba(120,200,220,0.08)', border: '1px solid rgba(120,200,220,0.2)',
      borderRadius: 8, backdropFilter: 'blur(24px)',
      position: 'relative', overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(ellipse at 50% 30%, ${hexToRgba(AURORA.cyan, washOpacity)}, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <span style={{
        fontSize: 11, fontWeight: 700, fontFamily: "'Libre Caslon Display', serif",
        letterSpacing: '0.15em', color: AURORA.cyan,
        textShadow: `0 0 20px ${hexToRgba(AURORA.cyan, 0.5)}, 0 0 40px ${hexToRgba(AURORA.cyan, 0.2)}`,
        zIndex: 1,
      }}>MASTER</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flex: 1, minHeight: 0, zIndex: 1 }}>
        <FaderVis value={0.82} width={26} height={faderHeight} color={AURORA.cyan} frame={frame} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <VUBar level={levelL} width={8} height={vuHeight} frame={frame} fps={fps} channelIndex={100} side="L" />
          <span style={{ fontSize: 6, color: AURORA.textMuted }}>L</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <VUBar level={levelR} width={8} height={vuHeight} frame={frame} fps={fps} channelIndex={101} side="R" />
          <span style={{ fontSize: 6, color: AURORA.textMuted }}>R</span>
        </div>
      </div>
      <div style={{
        width: '100%', padding: 6, background: 'rgba(0,0,0,0.3)',
        border: `1px solid ${AURORA.border}`, borderRadius: 4, zIndex: 1,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 7, color: AURORA.textMuted }}>LUFS</span>
          <span style={{
            fontSize: 11, fontWeight: 700, color: AURORA.cyan,
            fontFamily: "'Space Mono', monospace",
            textShadow: `0 0 8px ${hexToRgba(AURORA.cyan, 0.4)}`,
          }}>{lufs.toFixed(1)}</span>
        </div>
        <div style={{ marginTop: 3, height: 4, background: 'rgba(0,0,0,0.3)', borderRadius: 2 }}>
          <div style={{
            height: '100%', width: `${Math.max(0, Math.min(100, lufsNorm * 100))}%`,
            background: AURORA.teal, borderRadius: 2, opacity: 0.7,
          }} />
        </div>
      </div>
      <span style={{ fontSize: 7, color: AURORA.textMuted, zIndex: 1 }}>48kHz / 24bit</span>
    </div>
  );
};

// ── Spectrum Analyzer (memoized) ────────────────────────────────────────────

const SpectrumBar = React.memo<{
  frame: number;
  fps: number;
  width: number;
  height: number;
  masterLevelL: number;
  masterLevelR: number;
  trackCount: number;
}>(({ frame, fps, width, height, masterLevelL, masterLevelR, trackCount }) => {
  // Reduce bar count when many tracks visible for perf
  const barCount = trackCount > 8 ? 32 : 64;
  const barW = (width - 20) / barCount;
  const maxH = height - 8;
  const loudness = (masterLevelL + masterLevelR) / 2;

  return (
    <svg width={width} height={height}>
      <defs>
        <linearGradient id="spectrum-aurora" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={AURORA.cyan} />
          <stop offset="25%" stopColor={AURORA.teal} />
          <stop offset="50%" stopColor={AURORA.green} />
          <stop offset="75%" stopColor={AURORA.purple} />
          <stop offset="100%" stopColor={AURORA.pink} />
        </linearGradient>
      </defs>

      {Array.from({ length: barCount }, (_, i) => {
        const freq = i / barCount;
        const baseH = Math.exp(-freq * 2) * 0.6 + 0.2;
        const motion = Math.sin(frame * 0.12 + i * 0.25) * 0.2;
        const loudnessScale = 0.3 + loudness * 0.7;

        const springH = spring({
          frame: frame + i,
          fps,
          from: 0,
          to: Math.max(0.02, (baseH + motion) * loudnessScale),
          config: { damping: 15, mass: 0.4, stiffness: 100 },
          durationInFrames: 6,
        });

        const h = springH * maxH;

        return (
          <rect
            key={i}
            x={10 + i * barW}
            y={height - 4 - h}
            width={barW - 1}
            height={h}
            rx={1}
            fill="url(#spectrum-aurora)"
            opacity={0.5 + freq * 0.3}
          />
        );
      })}
    </svg>
  );
});

// ── Constellation Grid Background (memoized) ───────────────────────────────

const ConstellationGrid = React.memo<{
  width: number;
  height: number;
  frame: number;
  loudness: number;
}>(({ width, height, frame, loudness }) => {
  const gridSpacing = 40;
  const cols = Math.ceil(width / gridSpacing);
  const rows = Math.ceil(height / gridSpacing);
  const baseOpacity = 0.02 + loudness * 0.03;

  return (
    <svg width={width} height={height}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
      {Array.from({ length: cols }, (_, i) => (
        <line key={`v${i}`} x1={i * gridSpacing} y1={0} x2={i * gridSpacing} y2={height}
          stroke={AURORA.cyan} strokeWidth={0.5} opacity={baseOpacity} />
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <line key={`h${i}`} x1={0} y1={i * gridSpacing} x2={width} y2={i * gridSpacing}
          stroke={AURORA.cyan} strokeWidth={0.5} opacity={baseOpacity} />
      ))}
      {Array.from({ length: 5 }, (_, i) => {
        const x = 100 + i * 150 + Math.sin(frame * 0.02 + i * 1.3) * 10;
        const rayOpacity = 0.02 + loudness * 0.04;
        return (
          <rect key={`ray${i}`} x={x - 2} y={0} width={4} height={height}
            fill={AURORA.cyan} opacity={rayOpacity} rx={2} />
        );
      })}
    </svg>
  );
});

// ── Main Composition ────────────────────────────────────────────────────────

export const LiveMixer: React.FC<LiveMixerProps> = ({
  tracks,
  masterLevelL,
  masterLevelR,
  trackLevels,
  selectedTrackId,
  soloedTracks,
  mutedTracks,
  effectsChains,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: compWidth, height: compHeight } = useVideoConfig();

  const anySoloed = soloedTracks.length > 0;
  const loudness = (masterLevelL + masterLevelR) / 2;
  const washOpacity = 0.03 + loudness * 0.06;

  // Layout calculations (memoized)
  const layout = useMemo(() => {
    const spectrumHeight = 60;
    const channelAreaHeight = compHeight - spectrumHeight - 8;
    const masterWidth = 130;
    const stripWidth = Math.min(110, (compWidth - masterWidth - 20) / Math.max(1, tracks.length) - 4);
    return { spectrumHeight, channelAreaHeight, masterWidth, stripWidth };
  }, [compWidth, compHeight, tracks.length]);

  // Memoize channel strip layout data
  const channelData = useMemo(() => {
    return tracks.map((track, i) => {
      const levels = trackLevels[track.id];
      const levelL = levels ? levels.left : Math.max(0, Math.min(1,
        Math.sin(frame * 0.005 + i * 1.5) * 0.2 + track.volume * 0.8));
      const levelR = levels ? levels.right : Math.max(0, Math.min(1,
        Math.sin(frame * 0.005 + i * 1.5 + 0.8) * 0.2 + track.volume * 0.75));
      return { track, levelL, levelR, index: i };
    });
  }, [tracks, trackLevels, frame]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: AURORA.bg,
        fontFamily: "'Space Mono', monospace",
        overflow: 'hidden',
      }}
    >
      <ConstellationGrid width={compWidth} height={compHeight} frame={frame} loudness={loudness} />

      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(ellipse at 30% 20%, ${hexToRgba(AURORA.teal, washOpacity)}, transparent 60%),
                     radial-gradient(ellipse at 70% 80%, ${hexToRgba(AURORA.purple, washOpacity * 0.7)}, transparent 60%)`,
        pointerEvents: 'none',
      }} />

      {/* Channel strips */}
      <div style={{
        display: 'flex', gap: 4, padding: '6px 8px',
        height: layout.channelAreaHeight, alignItems: 'stretch',
        overflowX: 'auto', overflowY: 'hidden',
      }}>
        {channelData.map(({ track, levelL, levelR, index }) => (
          <ChannelStrip
            key={track.id}
            track={track}
            index={index}
            levelL={levelL}
            levelR={levelR}
            isSelected={track.id === selectedTrackId}
            isMuted={mutedTracks.includes(track.id)}
            isSoloed={soloedTracks.includes(track.id)}
            dimmed={anySoloed && !soloedTracks.includes(track.id)}
            frame={frame}
            fps={fps}
            stripWidth={layout.stripWidth}
            stripHeight={layout.channelAreaHeight - 12}
            effects={effectsChains?.[track.id] ?? track.effects ?? []}
            sends={track.sends ?? []}
          />
        ))}

        <MasterChannel
          levelL={masterLevelL}
          levelR={masterLevelR}
          frame={frame}
          fps={fps}
          stripWidth={layout.masterWidth}
          stripHeight={layout.channelAreaHeight - 12}
        />
      </div>

      {/* Spectrum analyzer */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: layout.spectrumHeight,
        borderTop: `1px solid ${AURORA.border}`,
        background: 'rgba(0,0,0,0.3)',
      }}>
        <SpectrumBar
          frame={frame} fps={fps} width={compWidth} height={layout.spectrumHeight}
          masterLevelL={masterLevelL} masterLevelR={masterLevelR}
          trackCount={tracks.length}
        />
      </div>

      {/* Send routing beams */}
      <svg width={compWidth} height={compHeight}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
        <defs>
          <linearGradient id="send-beam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={AURORA.cyan} stopOpacity={0} />
            <stop offset="50%" stopColor={AURORA.cyan} stopOpacity={0.3} />
            <stop offset="100%" stopColor={AURORA.cyan} stopOpacity={0} />
          </linearGradient>
        </defs>
        {tracks.map((track, i) => {
          if (track.type !== 'bus') return null;
          const busX = 8 + (i + 0.5) * (layout.stripWidth + 4);
          return tracks.map((src, si) => {
            if (src.id === track.id || src.type === 'bus') return null;
            // Check if this source has a send to this bus
            const hasSend = src.sends?.some(s => s.busTrackId === track.id);
            if (!hasSend && !effectsChains?.[src.id]) {
              // Still show faint potential connections
            }
            const srcX = 8 + (si + 0.5) * (layout.stripWidth + 4);
            const beamY = layout.channelAreaHeight * 0.7;
            const sendLevel = src.sends?.find(s => s.busTrackId === track.id)?.level ?? 0;
            const beamOpacity = hasSend
              ? 0.15 + sendLevel * 0.3 + Math.sin(frame * 0.08 + si) * 0.05
              : 0.03 + Math.sin(frame * 0.08 + si) * 0.02;
            return (
              <line
                key={`send-${src.id}-${track.id}`}
                x1={srcX} y1={beamY} x2={busX} y2={beamY + 10}
                stroke={AURORA.cyan} strokeWidth={hasSend ? 1.5 : 0.5}
                opacity={beamOpacity}
              />
            );
          });
        })}
      </svg>
    </AbsoluteFill>
  );
};
