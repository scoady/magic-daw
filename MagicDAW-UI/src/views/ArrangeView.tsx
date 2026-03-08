import React, { useMemo, useRef, useState, useEffect } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import type { Track } from '../types/daw';
import { aurora, seededRandom, hexToRgba } from '../mockData';

interface ArrangeViewProps {
  tracks: Track[];
  bpm: number;
  playing: boolean;
}

const TOTAL_BARS = 32;
const TRACK_HEIGHT = 64;
const RULER_HEIGHT = 30;
const HEADER_WIDTH = 0; // Track headers are in TrackList

const SECTIONS = [
  { bar: 1, label: 'INTRO', color: aurora.teal },
  { bar: 9, label: 'VERSE', color: aurora.green },
  { bar: 17, label: 'CHORUS', color: aurora.cyan },
  { bar: 25, label: 'BRIDGE', color: aurora.purple },
];

function drawClipContent(
  type: Track['type'],
  x: number, y: number, w: number, h: number,
  color: string, seed: number,
): React.ReactNode {
  const rng = seededRandom(seed);
  const contentY = y + 14;
  const contentH = h - 18;
  const midY = contentY + contentH / 2;

  switch (type) {
    case 'midi': {
      const steps = Math.max(Math.floor(w / 6), 8);
      const points: string[] = [];
      for (let i = 0; i <= steps; i++) {
        const px = x + 4 + (i / steps) * (w - 8);
        const py = midY + Math.sin(i * 0.8 + seed) * (contentH * 0.3) + (rng() - 0.5) * (contentH * 0.2);
        points.push(`${px},${py}`);
      }
      return (
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={hexToRgba(color, 0.5)}
          strokeWidth={1.2}
        />
      );
    }
    case 'audio': {
      const points: string[] = [];
      const steps = Math.max(Math.floor(w / 3), 16);
      for (let i = 0; i <= steps; i++) {
        const px = x + 4 + (i / steps) * (w - 8);
        const envelope = Math.sin((i / steps) * Math.PI) * 0.7 + 0.3;
        const noise = (rng() - 0.5) * 2;
        const py = midY + noise * envelope * (contentH * 0.35);
        points.push(`${px},${py}`);
      }
      return (
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={hexToRgba(color, 0.5)}
          strokeWidth={1}
        />
      );
    }
    case 'bus': {
      return (
        <line
          x1={x + 4} y1={midY + contentH * 0.3}
          x2={x + w - 4} y2={midY - contentH * 0.35}
          stroke={hexToRgba(color, 0.5)}
          strokeWidth={1.5}
        />
      );
    }
  }
}

export const ArrangeView: React.FC<ArrangeViewProps> = ({ tracks, bpm, playing }) => {
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playheadPos, setPlayheadPos] = useState(0);

  const gridWidth = useMemo(() => Math.max(800, TOTAL_BARS * 40 * zoom), [zoom]);
  const barWidth = gridWidth / TOTAL_BARS;

  // Animate playhead
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      setPlayheadPos((prev) => (prev + 0.5) % gridWidth);
    }, 16);
    return () => clearInterval(interval);
  }, [playing, gridWidth]);

  const totalHeight = RULER_HEIGHT + tracks.length * TRACK_HEIGHT + 60;

  return (
    <div className="flex flex-col h-full relative">
      {/* Zoom controls */}
      <div className="absolute top-2 right-3 flex gap-1 z-10">
        <button
          className="glass-button flex items-center justify-center"
          style={{ width: 24, height: 20 }}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
        >
          <ZoomOut size={10} />
        </button>
        <span
          style={{ fontSize: 8, color: 'var(--text-muted)', alignSelf: 'center', minWidth: 28, textAlign: 'center' }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="glass-button flex items-center justify-center"
          style={{ width: 24, height: 20 }}
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
        >
          <ZoomIn size={10} />
        </button>
      </div>

      {/* Scrollable grid */}
      <div ref={containerRef} className="flex-1 overflow-auto">
        <svg width={gridWidth + 20} height={totalHeight} style={{ minWidth: '100%' }}>
          <defs>
            <filter id="clip-glow" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Timeline ruler */}
          <rect x={0} y={0} width={gridWidth + 20} height={RULER_HEIGHT}
            fill="rgba(8, 14, 24, 0.8)" />
          <line x1={0} y1={RULER_HEIGHT} x2={gridWidth + 20} y2={RULER_HEIGHT}
            stroke="var(--border)" strokeWidth={0.5} />

          {/* Bar numbers */}
          {Array.from({ length: TOTAL_BARS }, (_, i) => {
            const bar = i + 1;
            const x = i * barWidth;
            return (
              <g key={`bar-${bar}`}>
                <text x={x + barWidth / 2} y={14} textAnchor="middle"
                  fill="var(--text-muted)" fontSize={9} fontFamily="var(--font-mono)">
                  {bar}
                </text>
                {[0, 0.25, 0.5, 0.75].map((beat, bi) => (
                  <line key={`tick-${bar}-${bi}`}
                    x1={x + beat * barWidth}
                    y1={bi === 0 ? 20 : 26}
                    x2={x + beat * barWidth}
                    y2={RULER_HEIGHT}
                    stroke={bi === 0 ? 'rgba(120,200,220,0.2)' : 'rgba(120,200,220,0.08)'}
                    strokeWidth={bi === 0 ? 0.8 : 0.4}
                  />
                ))}
              </g>
            );
          })}

          {/* Section markers */}
          {SECTIONS.map((section) => {
            const x = (section.bar - 1) * barWidth;
            return (
              <g key={`section-${section.bar}`}>
                <polygon
                  points={`${x},2 ${x + 46},2 ${x + 46},16 ${x + 42},12 ${x},12`}
                  fill={hexToRgba(section.color, 0.7)}
                />
                <text x={x + 5} y={11} fill={aurora.bgDeep} fontSize={7}
                  fontWeight="bold" fontFamily="var(--font-mono)">
                  {section.label}
                </text>
                {/* Section boundary line */}
                <rect x={x - 1} y={RULER_HEIGHT}
                  width={2} height={tracks.length * TRACK_HEIGHT}
                  fill={hexToRgba(section.color, 0.12)}
                />
              </g>
            );
          })}

          {/* Grid lines */}
          {/* Horizontal - track separators */}
          {tracks.map((_, i) => (
            <line key={`h-${i}`}
              x1={0} y1={RULER_HEIGHT + i * TRACK_HEIGHT}
              x2={gridWidth + 20} y2={RULER_HEIGHT + i * TRACK_HEIGHT}
              stroke="rgba(120,200,220,0.06)" strokeWidth={0.5}
            />
          ))}
          {/* Vertical - bar lines */}
          {Array.from({ length: TOTAL_BARS + 1 }, (_, i) => (
            <line key={`v-${i}`}
              x1={i * barWidth} y1={RULER_HEIGHT}
              x2={i * barWidth} y2={RULER_HEIGHT + tracks.length * TRACK_HEIGHT}
              stroke={SECTIONS.some(s => s.bar === i + 1)
                ? 'rgba(120,200,220,0.15)'
                : 'rgba(120,200,220,0.06)'}
              strokeWidth={0.5}
            />
          ))}

          {/* Clips */}
          {tracks.map((track, trackIdx) =>
            track.clips.map((clip, clipIdx) => {
              const x = (clip.startBar - 1) * barWidth;
              const y = RULER_HEIGHT + trackIdx * TRACK_HEIGHT + 2;
              const w = clip.lengthBars * barWidth - 2;
              const h = TRACK_HEIGHT - 6;

              return (
                <g key={clip.id}>
                  {/* Selected glow */}
                  {clip.selected && (
                    <rect x={x - 1} y={y - 1} width={w + 2} height={h + 2}
                      rx={5} fill="none"
                      stroke={hexToRgba(track.color, 0.5)} strokeWidth={1.5}
                      filter="url(#clip-glow)"
                    />
                  )}
                  {/* Clip body */}
                  <rect x={x} y={y} width={w} height={h} rx={4}
                    fill={hexToRgba(track.color, clip.selected ? 0.2 : 0.12)}
                    stroke={hexToRgba(track.color, clip.selected ? 0.5 : 0.25)}
                    strokeWidth={clip.selected ? 1.2 : 0.6}
                  />
                  {/* Clip name */}
                  <text x={x + 5} y={y + 11}
                    fill={hexToRgba(track.color, 0.8)}
                    fontSize={8} fontFamily="var(--font-mono)" fontWeight="500">
                    {clip.name}
                  </text>
                  {/* Clip content waveform */}
                  {drawClipContent(track.type, x, y, w, h, track.color, clipIdx * 17 + clip.startBar)}
                </g>
              );
            }),
          )}

          {/* Playhead */}
          {playing && (
            <g>
              <line
                x1={playheadPos} y1={0}
                x2={playheadPos} y2={RULER_HEIGHT + tracks.length * TRACK_HEIGHT}
                stroke={aurora.cyan} strokeWidth={1.5}
                opacity={0.9}
              />
              <polygon
                points={`${playheadPos - 4},0 ${playheadPos + 4},0 ${playheadPos},7`}
                fill={aurora.cyan}
              />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};
