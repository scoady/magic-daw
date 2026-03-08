import React, { useState, useMemo, useEffect } from 'react';
import {
  Sparkles,
  Play,
  Download,
  AudioWaveform,
  Waves,
  Timer,
  Triangle,
  CircleDot,
  Calculator,
  Speaker,
} from 'lucide-react';
import { GlassPanel } from '../components/GlassPanel';
import { Knob } from '../components/Knob';
import {
  aurora,
  mockPluginNodes,
  mockPluginConnections,
  seededRandom,
  hexToRgba,
} from '../mockData';
import type { PluginNode, PluginConnection } from '../types/daw';

const NODE_WIDTH = 180;
const NODE_HEIGHT_BASE = 70;

const NODE_TYPE_COLORS: Record<string, string> = {
  oscillator: aurora.cyan,
  filter: aurora.teal,
  envelope: aurora.purple,
  lfo: aurora.pink,
  effect: aurora.green,
  math: aurora.gold,
  output: aurora.orange,
};

const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
  oscillator: <AudioWaveform size={12} />,
  filter: <Waves size={12} />,
  envelope: <Timer size={12} />,
  lfo: <Triangle size={12} />,
  effect: <CircleDot size={12} />,
  math: <Calculator size={12} />,
  output: <Speaker size={12} />,
};

const PALETTE_ITEMS = [
  { type: 'oscillator', name: 'Oscillator', items: ['Sine', 'Saw', 'Square', 'Triangle', 'Noise'] },
  { type: 'filter', name: 'Filter', items: ['Low Pass', 'High Pass', 'Band Pass', 'Notch'] },
  { type: 'envelope', name: 'Envelope', items: ['ADSR', 'AD', 'Multi-Stage'] },
  { type: 'lfo', name: 'LFO', items: ['Sine LFO', 'Saw LFO', 'Random S&H'] },
  { type: 'effect', name: 'Effect', items: ['Delay', 'Reverb', 'Chorus', 'Distortion'] },
  { type: 'math', name: 'Math', items: ['Add', 'Multiply', 'Scale', 'Mix'] },
  { type: 'output', name: 'Output', items: ['Stereo Out', 'Mono Out'] },
];

function getNodeCenter(node: PluginNode, port: string, side: 'input' | 'output'): [number, number] {
  const x = side === 'output' ? node.x + NODE_WIDTH : node.x;
  const y = node.y + NODE_HEIGHT_BASE / 2;
  return [x, y];
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export const PluginView: React.FC = () => {
  const [aiPrompt, setAiPrompt] = useState('');
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setFrame((f) => f + 1), 50);
    return () => clearInterval(interval);
  }, []);

  // Connection paths with aurora gradient animation
  const connections = useMemo(() => {
    return mockPluginConnections.map((conn) => {
      const fromNode = mockPluginNodes.find((n) => n.id === conn.from.nodeId);
      const toNode = mockPluginNodes.find((n) => n.id === conn.to.nodeId);
      if (!fromNode || !toNode) return null;

      const [x1, y1] = getNodeCenter(fromNode, conn.from.port, 'output');
      const [x2, y2] = getNodeCenter(toNode, conn.to.port, 'input');

      return { ...conn, x1, y1, x2, y2 };
    }).filter(Boolean) as (PluginConnection & { x1: number; y1: number; x2: number; y2: number })[];
  }, []);

  // Waveform preview data
  const waveform = useMemo(() => {
    const rng = seededRandom(42);
    return Array.from({ length: 200 }, (_, i) => {
      const t = i / 200;
      return Math.sin(t * Math.PI * 8) * 0.6 +
        Math.sin(t * Math.PI * 15) * 0.2 +
        (rng() - 0.5) * 0.1;
    });
  }, []);

  const canvasWidth = 1100;
  const canvasHeight = 600;

  return (
    <div className="flex h-full">
      {/* Node Palette Sidebar */}
      <div
        className="flex flex-col gap-1 p-2 overflow-y-auto shrink-0"
        style={{
          width: 160,
          background: 'rgba(8,14,24,0.6)',
          borderRight: '1px solid var(--border)',
        }}
      >
        <span
          style={{
            fontSize: 8,
            color: 'var(--text-muted)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          Node Palette
        </span>

        {PALETTE_ITEMS.map((category) => (
          <div key={category.type} className="flex flex-col gap-0.5 mb-1">
            <div className="flex items-center gap-1.5 py-0.5">
              <div style={{ color: NODE_TYPE_COLORS[category.type] }}>
                {NODE_TYPE_ICONS[category.type]}
              </div>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: NODE_TYPE_COLORS[category.type],
                }}
              >
                {category.name}
              </span>
            </div>
            {category.items.map((item) => (
              <div
                key={item}
                className="glass-panel glass-panel-hover px-2 py-1 cursor-grab"
                style={{
                  fontSize: 8,
                  color: 'var(--text-dim)',
                  borderRadius: 4,
                  borderLeft: `2px solid ${NODE_TYPE_COLORS[category.type]}44`,
                }}
              >
                {item}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div
          className="flex items-center gap-2 px-3 py-1 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex gap-1 flex-1">
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Describe your synth: warm pad with slow filter sweep..."
              className="flex-1 rounded px-2 py-1"
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                outline: 'none',
                maxWidth: 400,
              }}
            />
            <button
              className="glass-button flex items-center gap-1.5 px-2 py-1"
              style={{
                background: 'rgba(167,139,250,0.12)',
                borderColor: 'rgba(167,139,250,0.3)',
                color: aurora.purple,
              }}
            >
              <Sparkles size={10} />
              <span style={{ fontSize: 8 }}>Generate</span>
            </button>
          </div>

          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

          <button
            className="glass-button flex items-center gap-1.5 px-2 py-1"
            style={{
              background: 'rgba(52,211,153,0.12)',
              borderColor: 'rgba(52,211,153,0.3)',
              color: aurora.green,
            }}
          >
            <Download size={10} />
            <span style={{ fontSize: 8 }}>Export AUv3</span>
          </button>
        </div>

        {/* Node graph canvas */}
        <div className="flex-1 overflow-auto relative">
          <svg width={canvasWidth} height={canvasHeight}>
            <defs>
              {/* Aurora gradient for connections */}
              {connections.map((conn, i) => (
                <linearGradient
                  key={`grad-${conn.id}`}
                  id={`conn-grad-${conn.id}`}
                  x1="0%" y1="0%" x2="100%" y2="0%"
                >
                  <stop offset="0%" stopColor={aurora.teal} />
                  <stop offset="50%" stopColor={aurora.cyan} />
                  <stop offset="100%" stopColor={aurora.purple} />
                </linearGradient>
              ))}
              <filter id="connection-glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Grid dots */}
            {Array.from({ length: Math.ceil(canvasWidth / 30) }, (_, i) =>
              Array.from({ length: Math.ceil(canvasHeight / 30) }, (_, j) => (
                <circle
                  key={`dot-${i}-${j}`}
                  cx={i * 30}
                  cy={j * 30}
                  r={0.5}
                  fill="rgba(120,200,220,0.08)"
                />
              )),
            )}

            {/* Connections */}
            {connections.map((conn) => {
              const dashOffset = frame * 2;
              return (
                <g key={conn.id}>
                  {/* Glow */}
                  <path
                    d={bezierPath(conn.x1, conn.y1, conn.x2, conn.y2)}
                    fill="none"
                    stroke={`url(#conn-grad-${conn.id})`}
                    strokeWidth={3}
                    opacity={0.15}
                    filter="url(#connection-glow)"
                  />
                  {/* Main line */}
                  <path
                    d={bezierPath(conn.x1, conn.y1, conn.x2, conn.y2)}
                    fill="none"
                    stroke={`url(#conn-grad-${conn.id})`}
                    strokeWidth={1.5}
                    opacity={0.6}
                  />
                  {/* Animated data flow dots */}
                  <path
                    d={bezierPath(conn.x1, conn.y1, conn.x2, conn.y2)}
                    fill="none"
                    stroke={aurora.cyan}
                    strokeWidth={2}
                    strokeDasharray="4 20"
                    strokeDashoffset={-dashOffset}
                    opacity={0.4}
                  />
                </g>
              );
            })}

            {/* Nodes */}
            {mockPluginNodes.map((node) => {
              const color = NODE_TYPE_COLORS[node.type];
              const paramKeys = Object.keys(node.params);
              const nodeH = NODE_HEIGHT_BASE + paramKeys.length * 20;

              return (
                <g key={node.id}>
                  {/* Node shadow */}
                  <rect
                    x={node.x + 2}
                    y={node.y + 2}
                    width={NODE_WIDTH}
                    height={nodeH}
                    rx={8}
                    fill="rgba(0,0,0,0.3)"
                  />
                  {/* Node body */}
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_WIDTH}
                    height={nodeH}
                    rx={8}
                    fill="rgba(120,200,220,0.06)"
                    stroke={hexToRgba(color, 0.3)}
                    strokeWidth={1}
                  />
                  {/* Header */}
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_WIDTH}
                    height={24}
                    rx={8}
                    fill={hexToRgba(color, 0.12)}
                  />
                  <rect
                    x={node.x}
                    y={node.y + 16}
                    width={NODE_WIDTH}
                    height={8}
                    fill={hexToRgba(color, 0.12)}
                  />

                  {/* Type icon placeholder */}
                  <circle
                    cx={node.x + 14}
                    cy={node.y + 12}
                    r={6}
                    fill={hexToRgba(color, 0.3)}
                  />
                  {/* Name */}
                  <text
                    x={node.x + 26}
                    y={node.y + 16}
                    fill={color}
                    fontSize={10}
                    fontWeight={600}
                    fontFamily="var(--font-mono)"
                  >
                    {node.name}
                  </text>

                  {/* Parameters */}
                  {paramKeys.map((param, pi) => {
                    const val = node.params[param];
                    const y = node.y + 30 + pi * 20;

                    return (
                      <g key={param}>
                        <text
                          x={node.x + 10}
                          y={y + 10}
                          fill="var(--text-muted)"
                          fontSize={7}
                          fontFamily="var(--font-mono)"
                        >
                          {param}
                        </text>
                        {/* Mini slider track */}
                        <rect
                          x={node.x + 70}
                          y={y + 5}
                          width={80}
                          height={6}
                          rx={3}
                          fill="rgba(0,0,0,0.3)"
                        />
                        <rect
                          x={node.x + 70}
                          y={y + 5}
                          width={Math.min(80, (typeof val === 'number' ? Math.min(1, val > 1 ? val / 20000 : val) : 0.5) * 80)}
                          height={6}
                          rx={3}
                          fill={hexToRgba(color, 0.5)}
                        />
                        <text
                          x={node.x + 155}
                          y={y + 10}
                          fill="var(--text-dim)"
                          fontSize={7}
                          fontFamily="var(--font-mono)"
                          textAnchor="end"
                        >
                          {typeof val === 'number'
                            ? val >= 1000
                              ? `${(val / 1000).toFixed(1)}k`
                              : val >= 1
                                ? val.toFixed(0)
                                : val.toFixed(2)
                            : val}
                        </text>
                      </g>
                    );
                  })}

                  {/* Input ports */}
                  {node.inputs.map((port, pi) => (
                    <g key={`in-${port}`}>
                      <circle
                        cx={node.x}
                        cy={node.y + nodeH / 2}
                        r={5}
                        fill="var(--bg)"
                        stroke={hexToRgba(color, 0.5)}
                        strokeWidth={1.5}
                        style={{ cursor: 'crosshair' }}
                      />
                    </g>
                  ))}

                  {/* Output ports */}
                  {node.outputs.map((port, pi) => (
                    <g key={`out-${port}`}>
                      <circle
                        cx={node.x + NODE_WIDTH}
                        cy={node.y + nodeH / 2}
                        r={5}
                        fill={hexToRgba(color, 0.3)}
                        stroke={hexToRgba(color, 0.6)}
                        strokeWidth={1.5}
                        style={{ cursor: 'crosshair' }}
                      />
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Preview section */}
        <div
          className="flex items-center gap-3 px-3 py-2 shrink-0"
          style={{ borderTop: '1px solid var(--border)', height: 60 }}
        >
          <button
            className="glass-button flex items-center justify-center"
            style={{
              width: 32,
              height: 28,
              background: 'rgba(52,211,153,0.15)',
              borderColor: 'rgba(52,211,153,0.3)',
            }}
          >
            <Play size={12} style={{ color: aurora.green }} />
          </button>

          {/* Waveform preview */}
          <svg width={300} height={40} className="flex-1" style={{ maxWidth: 300 }}>
            <rect x={0} y={0} width={300} height={40} rx={4}
              fill="rgba(0,0,0,0.2)" stroke="var(--border)" strokeWidth={0.5} />
            <polyline
              points={waveform
                .map((v, i) => `${(i / waveform.length) * 300},${20 + v * 16}`)
                .join(' ')}
              fill="none"
              stroke={aurora.teal}
              strokeWidth={1}
              opacity={0.7}
            />
          </svg>

          {/* Spectrum mini */}
          <svg width={150} height={40}>
            <rect x={0} y={0} width={150} height={40} rx={4}
              fill="rgba(0,0,0,0.2)" stroke="var(--border)" strokeWidth={0.5} />
            {Array.from({ length: 24 }, (_, i) => {
              const h = (Math.sin(frame * 0.1 + i * 0.3) * 0.5 + 0.5) * 30;
              const color = i < 8 ? aurora.teal : i < 16 ? aurora.purple : aurora.pink;
              return (
                <rect
                  key={i}
                  x={2 + i * 6}
                  y={38 - h}
                  width={4}
                  height={h}
                  rx={1}
                  fill={color}
                  opacity={0.6}
                />
              );
            })}
          </svg>

          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>A4 (440Hz)</span>
        </div>
      </div>
    </div>
  );
};
