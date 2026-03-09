import React from 'react';
import { AbsoluteFill } from 'remotion';

/**
 * AppIcon — 1024x1024 static icon composition for Magic DAW.
 *
 * Design: deep navy circle with aurora gradient glow, stylised waveform
 * in aurora colours, sparkle accents, frosted-glass inner ring.
 *
 * Render frame 0 as a still for .icns export.
 */

const aurora = {
  teal: '#2dd4bf',
  green: '#34d399',
  cyan: '#67e8f9',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  navy: '#0a0e1a',
  deepNavy: '#060a14',
};

/* ---- Sparkle positions (normalised 0-1024) ---- */
const sparkles = [
  { x: 280, y: 220, r: 3.5, o: 0.9 },
  { x: 740, y: 260, r: 2.5, o: 0.7 },
  { x: 350, y: 720, r: 2.0, o: 0.6 },
  { x: 680, y: 180, r: 3.0, o: 0.8 },
  { x: 200, y: 480, r: 2.5, o: 0.5 },
  { x: 820, y: 540, r: 2.0, o: 0.7 },
  { x: 450, y: 160, r: 1.5, o: 0.6 },
  { x: 600, y: 830, r: 2.5, o: 0.65 },
  { x: 160, y: 350, r: 1.8, o: 0.55 },
  { x: 860, y: 680, r: 2.2, o: 0.6 },
  { x: 510, y: 280, r: 1.5, o: 0.5 },
  { x: 390, y: 580, r: 1.2, o: 0.45 },
];

/* ---- Constellation lines (index pairs into sparkles) ---- */
const constellationLines: [number, number][] = [
  [0, 3],
  [3, 6],
  [6, 10],
  [1, 5],
  [4, 8],
  [7, 9],
];

/* ---- Waveform generation ---- */
function generateWaveformPath(
  cx: number,
  cy: number,
  width: number,
  amplitude: number,
  segments: number,
  phase: number,
): string {
  const startX = cx - width / 2;
  const points: string[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = startX + t * width;
    // Multi-frequency waveform for a musical feel
    const y =
      cy +
      Math.sin(t * Math.PI * 4 + phase) * amplitude * 0.6 *
        Math.exp(-Math.pow((t - 0.5) * 3, 2)) +
      Math.sin(t * Math.PI * 8 + phase * 1.5) * amplitude * 0.25 *
        Math.exp(-Math.pow((t - 0.5) * 2.5, 2)) +
      Math.sin(t * Math.PI * 2 + phase * 0.7) * amplitude * 0.15;
    if (i === 0) {
      points.push(`M ${x} ${y}`);
    } else {
      points.push(`L ${x} ${y}`);
    }
  }
  return points.join(' ');
}

/* ---- Stylised "M" as two peaks ---- */
function generateMPath(cx: number, cy: number, size: number): string {
  const half = size * 0.6;
  const peakH = size * 0.52;
  const valley = size * 0.03;
  return [
    `M ${cx - half} ${cy + half * 0.35}`,
    `L ${cx - half * 0.5} ${cy - peakH}`,
    `L ${cx} ${cy + valley}`,
    `L ${cx + half * 0.5} ${cy - peakH}`,
    `L ${cx + half} ${cy + half * 0.35}`,
  ].join(' ');
}

export const AppIcon: React.FC = () => {
  const S = 1024;
  const cx = S / 2;
  const cy = S / 2;

  const waveLines = 5;
  const waveAmplitude = 110;
  const waveWidth = 520;

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      <svg
        width={S}
        height={S}
        viewBox={`0 0 ${S} ${S}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Background aurora radial */}
          <radialGradient id="bg-glow" cx="50%" cy="45%" r="50%">
            <stop offset="0%" stopColor="#0f1a2e" />
            <stop offset="60%" stopColor="#0a0e1a" />
            <stop offset="100%" stopColor="#040810" />
          </radialGradient>

          {/* Aurora sweep gradient */}
          <linearGradient id="aurora-sweep" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={aurora.teal} />
            <stop offset="30%" stopColor={aurora.cyan} />
            <stop offset="60%" stopColor={aurora.purple} />
            <stop offset="100%" stopColor={aurora.pink} />
          </linearGradient>

          {/* Waveform glow gradient */}
          <linearGradient id="wave-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={aurora.teal} stopOpacity={0.3} />
            <stop offset="25%" stopColor={aurora.cyan} />
            <stop offset="50%" stopColor={aurora.purple} />
            <stop offset="75%" stopColor={aurora.pink} />
            <stop offset="100%" stopColor={aurora.teal} stopOpacity={0.3} />
          </linearGradient>

          {/* M letter gradient */}
          <linearGradient id="m-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={aurora.cyan} />
            <stop offset="100%" stopColor={aurora.purple} />
          </linearGradient>

          {/* Frosted glass inner circle */}
          <radialGradient id="frost" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stopColor="white" stopOpacity={0.08} />
            <stop offset="70%" stopColor="white" stopOpacity={0.02} />
            <stop offset="100%" stopColor="white" stopOpacity={0} />
          </radialGradient>

          {/* Outer glow filter */}
          <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="25" />
          </filter>

          <filter id="sparkle-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          {/* Clip to circle */}
          <clipPath id="circle-clip">
            <circle cx={cx} cy={cy} r={480} />
          </clipPath>
        </defs>

        {/* ===== Background circle ===== */}
        <circle cx={cx} cy={cy} r={480} fill="url(#bg-glow)" />

        {/* Aurora atmosphere — large soft glow behind everything */}
        <ellipse
          cx={cx}
          cy={cy - 60}
          rx={350}
          ry={200}
          fill="url(#aurora-sweep)"
          opacity={0.12}
          filter="url(#soft-glow)"
          clipPath="url(#circle-clip)"
        />

        {/* Second aurora wash lower */}
        <ellipse
          cx={cx + 80}
          cy={cy + 100}
          rx={280}
          ry={160}
          fill={aurora.purple}
          opacity={0.08}
          filter="url(#soft-glow)"
          clipPath="url(#circle-clip)"
        />

        {/* ===== Constellation lines ===== */}
        <g clipPath="url(#circle-clip)" opacity={0.25}>
          {constellationLines.map(([a, b], i) => (
            <line
              key={`cl-${i}`}
              x1={sparkles[a].x}
              y1={sparkles[a].y}
              x2={sparkles[b].x}
              y2={sparkles[b].y}
              stroke={aurora.cyan}
              strokeWidth={0.8}
              opacity={0.4}
            />
          ))}
        </g>

        {/* ===== Sparkle stars ===== */}
        <g clipPath="url(#circle-clip)">
          {sparkles.map((s, i) => (
            <g key={`sp-${i}`} filter="url(#sparkle-glow)">
              <circle cx={s.x} cy={s.y} r={s.r} fill="white" opacity={s.o} />
              {/* Cross sparkle for larger stars */}
              {s.r > 2 && (
                <>
                  <line
                    x1={s.x - s.r * 3}
                    y1={s.y}
                    x2={s.x + s.r * 3}
                    y2={s.y}
                    stroke="white"
                    strokeWidth={0.6}
                    opacity={s.o * 0.5}
                  />
                  <line
                    x1={s.x}
                    y1={s.y - s.r * 3}
                    x2={s.x}
                    y2={s.y + s.r * 3}
                    stroke="white"
                    strokeWidth={0.6}
                    opacity={s.o * 0.5}
                  />
                </>
              )}
            </g>
          ))}
        </g>

        {/* ===== Waveform lines ===== */}
        <g clipPath="url(#circle-clip)">
          {Array.from({ length: waveLines }, (_, i) => {
            const offset = (i - Math.floor(waveLines / 2)) * 28;
            const phase = i * 0.8;
            const opacity = 1 - Math.abs(i - Math.floor(waveLines / 2)) * 0.18;
            return (
              <path
                key={`wave-${i}`}
                d={generateWaveformPath(
                  cx,
                  cy + offset,
                  waveWidth,
                  waveAmplitude - Math.abs(offset) * 0.3,
                  200,
                  phase,
                )}
                fill="none"
                stroke="url(#wave-grad)"
                strokeWidth={3 - Math.abs(i - Math.floor(waveLines / 2)) * 0.3}
                strokeLinecap="round"
                opacity={opacity}
                filter="url(#glow)"
              />
            );
          })}
        </g>

        {/* ===== Stylised "M" mark ===== */}
        <path
          d={generateMPath(cx, cy - 10, 200)}
          fill="none"
          stroke="url(#m-grad)"
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
          filter="url(#glow)"
        />

        {/* ===== Frosted glass inner ring ===== */}
        <circle
          cx={cx}
          cy={cy}
          r={420}
          fill="url(#frost)"
          clipPath="url(#circle-clip)"
        />

        {/* ===== Neon edge ring ===== */}
        <circle
          cx={cx}
          cy={cy}
          r={478}
          fill="none"
          stroke="url(#aurora-sweep)"
          strokeWidth={2.5}
          opacity={0.7}
        />

        {/* Outer glow ring */}
        <circle
          cx={cx}
          cy={cy}
          r={478}
          fill="none"
          stroke="url(#aurora-sweep)"
          strokeWidth={8}
          opacity={0.15}
          filter="url(#soft-glow)"
        />

        {/* Inner subtle ring */}
        <circle
          cx={cx}
          cy={cy}
          r={440}
          fill="none"
          stroke="white"
          strokeWidth={0.5}
          opacity={0.08}
        />
      </svg>
    </AbsoluteFill>
  );
};

export default AppIcon;
