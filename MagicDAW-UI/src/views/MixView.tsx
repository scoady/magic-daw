import React, { useState, useEffect } from 'react';
import { Fader } from '../components/Fader';
import { Knob } from '../components/Knob';
import { VUMeter } from '../components/VUMeter';
import type { Track } from '../types/daw';
import { aurora, seededRandom, hexToRgba } from '../mockData';

interface MixViewProps {
  tracks: Track[];
}

interface ChannelEQ {
  points: number[];
  inserts: string[];
}

const CHANNEL_EQS: Record<string, ChannelEQ> = {
  drums: { points: [0.3, 0.8, 0.9, 0.4, 0.25, 0.2, 0.15], inserts: ['Comp', 'EQ', 'Sat'] },
  bass: { points: [0.5, 0.85, 0.7, 0.35, 0.2, 0.15, 0.1], inserts: ['Comp', 'EQ', 'Lim'] },
  keys: { points: [0.15, 0.2, 0.3, 0.6, 0.7, 0.5, 0.35], inserts: ['EQ', 'Cho', 'Rev'] },
  pad: { points: [0.1, 0.15, 0.35, 0.55, 0.65, 0.7, 0.5], inserts: ['EQ', 'Rev', 'Del'] },
  lead: { points: [0.1, 0.2, 0.4, 0.75, 0.85, 0.6, 0.3], inserts: ['Dist', 'EQ', 'Del'] },
  vocals: { points: [0.08, 0.12, 0.3, 0.65, 0.8, 0.7, 0.4], inserts: ['Comp', 'EQ', 'Rev'] },
  fx: { points: [0.2, 0.35, 0.5, 0.45, 0.55, 0.7, 0.6], inserts: ['Rev', 'Del', 'Mod'] },
};

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

export const MixView: React.FC<MixViewProps> = ({ tracks }) => {
  const [frame, setFrame] = useState(0);

  // Animate levels
  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => f + 1);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  const eqW = 110;
  const eqH = 48;

  return (
    <div className="flex h-full overflow-x-auto">
      {/* Channel strips */}
      <div className="flex gap-1 p-2 h-full">
        {tracks.map((track, i) => {
          const rng = seededRandom(i * 31 + frame);
          const eq = CHANNEL_EQS[track.id] || CHANNEL_EQS.fx;
          const vuL = Math.max(0, Math.min(1,
            Math.sin(frame * 0.15 + i * 1.5) * 0.2 + track.volume * 0.8,
          ));
          const vuR = Math.max(0, Math.min(1,
            Math.sin(frame * 0.15 + i * 1.5 + 0.8) * 0.2 + track.volume * 0.75,
          ));

          return (
            <div
              key={track.id}
              className="glass-panel flex flex-col items-center gap-1 p-2 shrink-0"
              style={{
                width: 120,
                borderLeft: `3px solid ${track.color}`,
              }}
            >
              {/* Track name */}
              <div className="flex items-center gap-1.5 w-full">
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: track.color,
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--text)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {track.name}
                </span>
              </div>

              {/* EQ curve */}
              <svg width={eqW} height={eqH} className="shrink-0">
                <rect x={0} y={0} width={eqW} height={eqH} rx={3}
                  fill="rgba(0,0,0,0.3)" stroke="var(--border)" strokeWidth={0.5} />
                {[0.25, 0.5, 0.75].map((r) => (
                  <line key={r} x1={0} y1={eqH * r} x2={eqW} y2={eqH * r}
                    stroke="rgba(255,255,255,0.03)" strokeWidth={0.5} />
                ))}
                <path d={generateEqFill(eqW, eqH, eq.points)}
                  fill={track.color} opacity={0.1} />
                <path d={generateEqPath(eqW, eqH, eq.points)}
                  fill="none" stroke={track.color} strokeWidth={1.2}
                  strokeLinecap="round" />
              </svg>

              {/* Insert slots */}
              <div className="flex gap-0.5 w-full">
                {eq.inserts.map((ins) => (
                  <div
                    key={ins}
                    className="flex-1 text-center py-0.5 rounded"
                    style={{
                      fontSize: 7,
                      color: 'var(--text-muted)',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--border)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {ins}
                  </div>
                ))}
              </div>

              {/* Pan knob */}
              <Knob
                value={track.pan}
                min={-1}
                max={1}
                size={32}
                color={track.color}
                label="PAN"
                displayValue={
                  track.pan === 0
                    ? 'C'
                    : track.pan < 0
                      ? `L${Math.abs(Math.round(track.pan * 100))}`
                      : `R${Math.round(track.pan * 100)}`
                }
              />

              {/* Fader + VU */}
              <div className="flex gap-1.5 items-end flex-1">
                <Fader
                  value={track.volume}
                  height={140}
                  width={24}
                  color={track.color}
                  dbDisplay={false}
                />
                <div className="flex gap-0.5">
                  <VUMeter
                    level={track.muted ? 0 : vuL}
                    width={4}
                    height={140}
                  />
                  <VUMeter
                    level={track.muted ? 0 : vuR}
                    width={4}
                    height={140}
                  />
                </div>
              </div>

              {/* M/S buttons */}
              <div className="flex gap-1 w-full">
                <button
                  className="flex-1 flex items-center justify-center rounded"
                  style={{
                    height: 18,
                    fontSize: 8,
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    background: track.muted
                      ? 'rgba(239,68,68,0.25)'
                      : 'rgba(120,200,220,0.06)',
                    border: `1px solid ${
                      track.muted ? 'rgba(239,68,68,0.5)' : 'var(--border)'
                    }`,
                    color: track.muted ? '#ef4444' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  M
                </button>
                <button
                  className="flex-1 flex items-center justify-center rounded"
                  style={{
                    height: 18,
                    fontSize: 8,
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    background: track.soloed
                      ? 'rgba(251,191,36,0.25)'
                      : 'rgba(120,200,220,0.06)',
                    border: `1px solid ${
                      track.soloed ? 'rgba(251,191,36,0.5)' : 'var(--border)'
                    }`,
                    color: track.soloed ? aurora.gold : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  S
                </button>
              </div>
            </div>
          );
        })}

        {/* Master Channel */}
        <div
          className="glass-panel flex flex-col items-center gap-1.5 p-2 shrink-0"
          style={{
            width: 150,
            border: '1px solid rgba(120,200,220,0.2)',
            background: 'rgba(120,200,220,0.08)',
          }}
        >
          {/* MASTER label */}
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.15em',
              color: aurora.cyan,
            }}
            className="text-glow-cyan"
          >
            MASTER
          </span>

          {/* Master fader + VU */}
          <div className="flex gap-2 items-end flex-1">
            <Fader
              value={0.82}
              height={200}
              width={32}
              color={aurora.cyan}
            />
            <div className="flex gap-1">
              <div className="flex flex-col items-center gap-0.5">
                <VUMeter
                  level={Math.sin(frame * 0.12) * 0.15 + 0.6}
                  width={6}
                  height={200}
                />
                <span style={{ fontSize: 6, color: 'var(--text-muted)' }}>L</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <VUMeter
                  level={Math.sin(frame * 0.12 + 0.5) * 0.15 + 0.58}
                  width={6}
                  height={200}
                />
                <span style={{ fontSize: 6, color: 'var(--text-muted)' }}>R</span>
              </div>
            </div>
          </div>

          {/* LUFS display */}
          <div
            className="w-full glass-panel p-1.5"
            style={{ borderRadius: 4 }}
          >
            <div className="flex justify-between items-center">
              <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>LUFS</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: aurora.cyan,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {(-14.2 + Math.sin(frame * 0.05) * 0.8).toFixed(1)}
              </span>
            </div>
            <div
              className="mt-1 rounded"
              style={{ height: 4, background: 'rgba(0,0,0,0.3)' }}
            >
              <div
                className="rounded"
                style={{
                  height: '100%',
                  width: `${Math.max(0, ((-14.2 + Math.sin(frame * 0.05) * 0.8 + 24) / 24) * 100)}%`,
                  background: aurora.teal,
                  opacity: 0.7,
                  transition: 'width 0.1s linear',
                }}
              />
            </div>
          </div>

          <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>
            48kHz / 24bit
          </span>
        </div>
      </div>
    </div>
  );
};
