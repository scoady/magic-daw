import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
} from 'remotion';

const aurora = {
  teal: '#2dd4bf',
  green: '#34d399',
  cyan: '#67e8f9',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
};

export interface AuroraSpectrumProps {
  barCount?: number;
  bpm?: number;
}

export const AuroraSpectrum: React.FC<AuroraSpectrumProps> = ({
  barCount = 64,
  bpm = 120,
}) => {
  const frame = useCurrentFrame();
  const W = 800;
  const H = 200;
  const barW = (W - 20) / barCount;
  const maxH = H - 20;

  const beat = Math.floor(frame / 15) % 4;

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      <svg width={W} height={H}>
        <defs>
          <linearGradient id="spec-fill" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={aurora.teal} stopOpacity={0.8} />
            <stop offset="30%" stopColor={aurora.green} stopOpacity={0.7} />
            <stop offset="60%" stopColor={aurora.purple} stopOpacity={0.6} />
            <stop offset="100%" stopColor={aurora.pink} stopOpacity={0.5} />
          </linearGradient>
        </defs>

        {Array.from({ length: barCount }, (_, i) => {
          const rawH = Math.sin(frame * 0.12 + i * 0.2) * Math.exp(-i * 0.015) * maxH;
          const beatPulse = (beat === 0 || beat === 2) && i < 12 ? 0.25 : 0;
          const snarePulse = (beat === 1 || beat === 3) && i > 15 && i < 40 ? 0.18 : 0;
          const h = Math.max(2, (Math.abs(rawH) + beatPulse * maxH + snarePulse * maxH) * 0.5);

          const bandProgress = i / barCount;
          let barColor = aurora.teal;
          if (bandProgress > 0.25) barColor = aurora.green;
          if (bandProgress > 0.5) barColor = aurora.purple;
          if (bandProgress > 0.75) barColor = aurora.pink;

          return (
            <rect
              key={i}
              x={10 + i * barW}
              y={H - 10 - h}
              width={barW - 1}
              height={h}
              rx={2}
              fill={barColor}
              opacity={0.5 + bandProgress * 0.4}
            />
          );
        })}

        {/* Frequency labels */}
        {['32', '125', '500', '2k', '8k', '16k'].map((label, i) => (
          <text key={label}
            x={10 + (i / 5) * (W - 20)}
            y={H - 2}
            fill="rgba(148,163,184,0.5)"
            fontSize={6} fontFamily="monospace" textAnchor="middle">
            {label}
          </text>
        ))}
      </svg>
    </AbsoluteFill>
  );
};
