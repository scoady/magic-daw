import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, spring, useVideoConfig, interpolate } from 'remotion';
import type { PluginNode, PluginConnection } from '../types/daw';

// ── Constants ────────────────────────────────────────────────────────────────

const NODE_WIDTH = 200;
const NODE_HEIGHT_BASE = 80;
const PARAM_ROW_H = 22;

const CATEGORY_COLORS: Record<string, string> = {
  oscillator: '#67e8f9', // cyan
  filter: '#a78bfa',     // purple
  envelope: '#c084fc',   // lighter purple
  lfo: '#f472b6',        // magenta/pink
  effect: '#f472b6',     // magenta
  math: '#34d399',       // green
  output: '#fbbf24',     // gold
};

const SIGNAL_COLORS: Record<string, string> = {
  audio: '#67e8f9',
  control: '#a78bfa',
  trigger: '#f472b6',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function nodeHeight(node: PluginNode): number {
  return NODE_HEIGHT_BASE + Object.keys(node.params).length * PARAM_ROW_H;
}

function portPos(node: PluginNode, port: string, side: 'input' | 'output'): [number, number] {
  const h = nodeHeight(node);
  const x = side === 'output' ? node.x + NODE_WIDTH : node.x;
  const y = node.y + h / 2;
  return [x, y];
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/** Sample a point on a cubic bezier at parameter t */
function bezierPoint(
  x1: number, y1: number, x2: number, y2: number, t: number,
): [number, number] {
  const dx = Math.abs(x2 - x1) * 0.5;
  const cx1 = x1 + dx;
  const cy1 = y1;
  const cx2 = x2 - dx;
  const cy2 = y2;
  const u = 1 - t;
  const px = u * u * u * x1 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x2;
  const py = u * u * u * y1 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * y2;
  return [px, py];
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function signalTypeForPort(port: string): string {
  if (port === 'audio') return 'audio';
  if (port === 'control') return 'control';
  if (port === 'trigger') return 'trigger';
  return 'audio';
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface LiveNodeGraphProps {
  nodes: PluginNode[];
  connections: PluginConnection[];
  selectedNodeId: string | null;
  previewLevelL: number;
  previewLevelR: number;
  isPreviewPlaying: boolean;
  validationErrors: string[];
}

// ── Composition ──────────────────────────────────────────────────────────────

export const LiveNodeGraph: React.FC<LiveNodeGraphProps> = ({
  nodes,
  connections,
  selectedNodeId,
  previewLevelL,
  previewLevelR,
  isPreviewPlaying,
  validationErrors,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Set of node IDs with errors
  const errorNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const err of validationErrors) {
      // Extract node ID from error strings like "node_123: ..."
      const match = err.match(/^(\S+?):/);
      if (match) set.add(match[1]);
    }
    return set;
  }, [validationErrors]);

  // Build adjacency for signal path tracing
  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of connections) {
      ids.add(c.from.nodeId);
      ids.add(c.to.nodeId);
    }
    return ids;
  }, [connections]);

  // Find output node
  const outputNode = nodes.find((n) => n.type === 'output');

  // Background tint
  const hasErrors = validationErrors.length > 0;
  const bgTint = hasErrors
    ? 'rgba(248,113,113,0.04)'
    : nodes.length > 1
      ? 'rgba(52,211,153,0.03)'
      : 'transparent';

  // Constellation background stars
  const bgStars = useMemo(() => {
    const rng = seededRandom(777);
    return Array.from({ length: 80 }, () => ({
      x: rng() * 1200,
      y: rng() * 700,
      r: rng() * 1.2 + 0.3,
      phase: rng() * Math.PI * 2,
      speed: rng() * 0.02 + 0.01,
    }));
  }, []);

  // Shooting star
  const shootingStarCycle = 300; // frames
  const shootingT = (frame % shootingStarCycle) / shootingStarCycle;
  const showShootingStar = shootingT < 0.15;

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1200 700"
        style={{ overflow: 'visible' }}
      >
        <defs>
          {/* Glow filter */}
          <filter id="lng-glow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="lng-glow-strong">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="lng-glow-soft">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Node shadow filter */}
          <filter id="lng-node-shadow">
            <feDropShadow dx="2" dy="3" stdDeviation="6" floodColor="rgba(0,0,0,0.5)" />
          </filter>
          {/* Selected node pulse */}
          <filter id="lng-selected-glow">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Aurora connection gradients per connection */}
          {connections.map((conn) => {
            const fromNode = nodes.find((n) => n.id === conn.from.nodeId);
            const sigType = signalTypeForPort(fromNode ? (fromNode.outputs[0] ?? 'audio') : 'audio');
            const sigColor = SIGNAL_COLORS[sigType] ?? SIGNAL_COLORS.audio;
            return (
              <linearGradient
                key={`conn-grad-${conn.id}`}
                id={`lng-conn-grad-${conn.id}`}
                x1="0%" y1="0%" x2="100%" y2="0%"
              >
                <stop offset="0%" stopColor={sigColor} stopOpacity={0.9} />
                <stop offset="50%" stopColor="#a78bfa" stopOpacity={0.7} />
                <stop offset="100%" stopColor={sigColor} stopOpacity={0.9} />
              </linearGradient>
            );
          })}
        </defs>

        {/* Background tint wash */}
        <rect x="0" y="0" width="1200" height="700" fill={bgTint} />

        {/* Circuit-board grid pattern */}
        {Array.from({ length: 41 }, (_, i) => (
          <line
            key={`vg-${i}`}
            x1={i * 30}
            y1={0}
            x2={i * 30}
            y2={700}
            stroke="rgba(103,232,249,0.03)"
            strokeWidth={0.5}
          />
        ))}
        {Array.from({ length: 24 }, (_, j) => (
          <line
            key={`hg-${j}`}
            x1={0}
            y1={j * 30}
            x2={1200}
            y2={j * 30}
            stroke="rgba(103,232,249,0.03)"
            strokeWidth={0.5}
          />
        ))}

        {/* Grid intersection dots */}
        {Array.from({ length: 41 }, (_, i) =>
          Array.from({ length: 24 }, (_, j) => (
            <circle
              key={`gd-${i}-${j}`}
              cx={i * 30}
              cy={j * 30}
              r={0.6}
              fill="rgba(103,232,249,0.06)"
            />
          )),
        )}

        {/* Constellation background stars */}
        {bgStars.map((star, i) => {
          const twinkle = Math.sin(frame * star.speed + star.phase) * 0.4 + 0.6;
          return (
            <circle
              key={`star-${i}`}
              cx={star.x}
              cy={star.y}
              r={star.r}
              fill={i % 3 === 0 ? '#67e8f9' : i % 3 === 1 ? '#a78bfa' : '#e2e8f0'}
              opacity={twinkle * 0.15}
            />
          );
        })}

        {/* Shooting star */}
        {showShootingStar && (() => {
          const st = shootingT / 0.15;
          const sx = 200 + st * 800;
          const sy = 30 + st * 120;
          return (
            <g opacity={1 - st}>
              <line
                x1={sx}
                y1={sy}
                x2={sx - 40}
                y2={sy - 15}
                stroke="#67e8f9"
                strokeWidth={1.5}
                opacity={0.6}
                filter="url(#lng-glow-soft)"
              />
              <circle cx={sx} cy={sy} r={1.5} fill="#67e8f9" filter="url(#lng-glow-soft)" />
            </g>
          );
        })()}

        {/* ── Connections with aurora beams ── */}
        {connections.map((conn) => {
          const fromNode = nodes.find((n) => n.id === conn.from.nodeId);
          const toNode = nodes.find((n) => n.id === conn.to.nodeId);
          if (!fromNode || !toNode) return null;

          const [x1, y1] = portPos(fromNode, conn.from.port, 'output');
          const [x2, y2] = portPos(toNode, conn.to.port, 'input');
          const path = bezierPath(x1, y1, x2, y2);

          const sigType = signalTypeForPort(fromNode.outputs[0] ?? 'audio');
          const sigColor = SIGNAL_COLORS[sigType] ?? SIGNAL_COLORS.audio;

          // Particle speed varies when playing
          const particleSpeed = isPreviewPlaying ? 3 : 1.5;
          const particleBrightness = isPreviewPlaying ? 0.8 : 0.4;
          const dashOffset = frame * particleSpeed;

          // Number of flowing particles
          const particleCount = isPreviewPlaying ? 5 : 3;

          return (
            <g key={`conn-${conn.id}`}>
              {/* Outer glow */}
              <path
                d={path}
                fill="none"
                stroke={`url(#lng-conn-grad-${conn.id})`}
                strokeWidth={6}
                opacity={0.08}
                filter="url(#lng-glow-strong)"
              />
              {/* Main aurora beam */}
              <path
                d={path}
                fill="none"
                stroke={`url(#lng-conn-grad-${conn.id})`}
                strokeWidth={2}
                opacity={isPreviewPlaying ? 0.7 : 0.45}
                filter="url(#lng-glow-soft)"
              />
              {/* Animated dash flow */}
              <path
                d={path}
                fill="none"
                stroke={sigColor}
                strokeWidth={2.5}
                strokeDasharray="4 22"
                strokeDashoffset={-dashOffset}
                opacity={particleBrightness * 0.5}
              />

              {/* Data particles flowing along the curve */}
              {Array.from({ length: particleCount }, (_, pi) => {
                const t = ((frame * 0.015 * particleSpeed + pi / particleCount) % 1);
                const [px, py] = bezierPoint(x1, y1, x2, y2, t);
                const pSize = isPreviewPlaying ? 3 : 2;
                return (
                  <circle
                    key={`p-${conn.id}-${pi}`}
                    cx={px}
                    cy={py}
                    r={pSize}
                    fill={sigColor}
                    opacity={particleBrightness}
                    filter="url(#lng-glow-soft)"
                  />
                );
              })}
            </g>
          );
        })}

        {/* ── Nodes ── */}
        {nodes.map((node, nodeIdx) => {
          const color = CATEGORY_COLORS[node.type] ?? '#67e8f9';
          const h = nodeHeight(node);
          const isSelected = node.id === selectedNodeId;
          const hasError = errorNodeIds.has(node.id);
          const isActive = isPreviewPlaying && connectedNodeIds.has(node.id);

          // Spring entrance animation
          const entranceScale = spring({
            frame,
            fps,
            config: { damping: 15, stiffness: 120, mass: 0.8 },
            durationInFrames: 30,
            delay: nodeIdx * 4,
          });
          const entranceOpacity = interpolate(entranceScale, [0, 1], [0, 1]);

          // Breathing pulse when active
          const breathe = isActive
            ? Math.sin(frame * 0.08 + nodeIdx) * 0.15 + 0.85
            : 1;

          // Selected pulse
          const selectedPulse = isSelected
            ? Math.sin(frame * 0.1) * 0.3 + 0.7
            : 0;

          const paramKeys = Object.keys(node.params);

          return (
            <g
              key={node.id}
              opacity={entranceOpacity}
              transform={`translate(${node.x + NODE_WIDTH / 2}, ${node.y + h / 2}) scale(${entranceScale}) translate(${-(node.x + NODE_WIDTH / 2)}, ${-(node.y + h / 2)})`}
            >
              {/* Error glow ring */}
              {hasError && (
                <rect
                  x={node.x - 4}
                  y={node.y - 4}
                  width={NODE_WIDTH + 8}
                  height={h + 8}
                  rx={12}
                  fill="none"
                  stroke="#f87171"
                  strokeWidth={2}
                  opacity={Math.sin(frame * 0.15) * 0.3 + 0.5}
                  filter="url(#lng-glow)"
                />
              )}

              {/* Selected glow */}
              {isSelected && (
                <rect
                  x={node.x - 3}
                  y={node.y - 3}
                  width={NODE_WIDTH + 6}
                  height={h + 6}
                  rx={11}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  opacity={selectedPulse}
                  filter="url(#lng-selected-glow)"
                />
              )}

              {/* Drop shadow */}
              <rect
                x={node.x + 2}
                y={node.y + 3}
                width={NODE_WIDTH}
                height={h}
                rx={10}
                fill="rgba(0,0,0,0.35)"
              />

              {/* Node body -- frosted glass */}
              <rect
                x={node.x}
                y={node.y}
                width={NODE_WIDTH}
                height={h}
                rx={10}
                fill="rgba(13,21,32,0.85)"
                stroke={hasError ? '#f87171' : hexToRgba(color, isSelected ? 0.6 : 0.25)}
                strokeWidth={isSelected ? 1.5 : 1}
                opacity={breathe}
              />

              {/* Aurora-gradient header bar */}
              <clipPath id={`hdr-clip-${node.id}`}>
                <rect x={node.x} y={node.y} width={NODE_WIDTH} height={26} rx={10} />
                <rect x={node.x} y={node.y + 16} width={NODE_WIDTH} height={10} />
              </clipPath>
              <rect
                x={node.x}
                y={node.y}
                width={NODE_WIDTH}
                height={26}
                clipPath={`url(#hdr-clip-${node.id})`}
                fill={hexToRgba(color, 0.15)}
              />
              {/* Header accent line */}
              <line
                x1={node.x}
                y1={node.y + 26}
                x2={node.x + NODE_WIDTH}
                y2={node.y + 26}
                stroke={hexToRgba(color, 0.2)}
                strokeWidth={0.5}
              />

              {/* Type icon circle */}
              <circle
                cx={node.x + 16}
                cy={node.y + 13}
                r={7}
                fill={hexToRgba(color, 0.25)}
                stroke={hexToRgba(color, 0.4)}
                strokeWidth={0.5}
              />
              {/* Mini icon inside (type-specific shape) */}
              <NodeTypeIcon type={node.type} cx={node.x + 16} cy={node.y + 13} color={color} frame={frame} isActive={isActive} />

              {/* Node name */}
              <text
                x={node.x + 30}
                y={node.y + 17}
                fill={color}
                fontSize={11}
                fontWeight={600}
                fontFamily="'Space Mono', monospace"
              >
                {node.name}
              </text>

              {/* Active processing indicator */}
              {isActive && (
                <circle
                  cx={node.x + NODE_WIDTH - 14}
                  cy={node.y + 13}
                  r={3}
                  fill={color}
                  opacity={Math.sin(frame * 0.2) * 0.4 + 0.6}
                  filter="url(#lng-glow-soft)"
                />
              )}

              {/* Parameters with mini aurora bars */}
              {paramKeys.map((param, pi) => {
                const val = node.params[param];
                const py = node.y + 34 + pi * PARAM_ROW_H;
                const isLargeRange = val > 1 || param === 'frequency' || param === 'cutoff';
                const normalizedVal = typeof val === 'number'
                  ? Math.min(1, isLargeRange ? val / 20000 : val)
                  : 0.5;
                const barWidth = normalizedVal * 90;

                return (
                  <g key={param}>
                    <text
                      x={node.x + 10}
                      y={py + 12}
                      fill="rgba(148,163,184,0.8)"
                      fontSize={8}
                      fontFamily="'Space Mono', monospace"
                    >
                      {param}
                    </text>
                    {/* Slider track */}
                    <rect
                      x={node.x + 80}
                      y={py + 5}
                      width={90}
                      height={7}
                      rx={3.5}
                      fill="rgba(0,0,0,0.4)"
                    />
                    {/* Aurora gradient fill */}
                    <rect
                      x={node.x + 80}
                      y={py + 5}
                      width={barWidth}
                      height={7}
                      rx={3.5}
                      fill={hexToRgba(color, 0.55)}
                    />
                    {/* Glow on fill end */}
                    {barWidth > 4 && (
                      <circle
                        cx={node.x + 80 + barWidth}
                        cy={py + 8.5}
                        r={2}
                        fill={color}
                        opacity={0.4}
                        filter="url(#lng-glow-soft)"
                      />
                    )}
                    {/* Value label */}
                    <text
                      x={node.x + 176}
                      y={py + 12}
                      fill="rgba(148,163,184,0.6)"
                      fontSize={7}
                      fontFamily="'Space Mono', monospace"
                      textAnchor="end"
                    >
                      {typeof val === 'number'
                        ? val >= 1000
                          ? `${(val / 1000).toFixed(1)}k`
                          : val >= 1
                            ? val.toFixed(0)
                            : val.toFixed(2)
                        : String(val)}
                    </text>
                  </g>
                );
              })}

              {/* Input ports */}
              {node.inputs.map((port, pi) => {
                const py = node.y + h / 2 + (pi - (node.inputs.length - 1) / 2) * 20;
                const portColor = SIGNAL_COLORS[signalTypeForPort(port)] ?? color;
                return (
                  <g key={`in-${port}`}>
                    <circle
                      cx={node.x}
                      cy={py}
                      r={6}
                      fill="rgba(13,21,32,0.9)"
                      stroke={hexToRgba(portColor, 0.5)}
                      strokeWidth={1.5}
                    />
                    <circle
                      cx={node.x}
                      cy={py}
                      r={2.5}
                      fill={portColor}
                      opacity={0.6}
                      filter="url(#lng-glow-soft)"
                    />
                  </g>
                );
              })}

              {/* Output ports */}
              {node.outputs.map((port, pi) => {
                const py = node.y + h / 2 + (pi - (node.outputs.length - 1) / 2) * 20;
                const portColor = SIGNAL_COLORS[signalTypeForPort(port)] ?? color;
                return (
                  <g key={`out-${port}`}>
                    <circle
                      cx={node.x + NODE_WIDTH}
                      cy={py}
                      r={6}
                      fill={hexToRgba(portColor, 0.2)}
                      stroke={hexToRgba(portColor, 0.6)}
                      strokeWidth={1.5}
                    />
                    <circle
                      cx={node.x + NODE_WIDTH}
                      cy={py}
                      r={3}
                      fill={portColor}
                      opacity={isActive ? 0.9 : 0.5}
                      filter="url(#lng-glow-soft)"
                    />
                  </g>
                );
              })}

              {/* Inline visualizations for specific node types when active */}
              {isActive && node.type === 'oscillator' && (
                <OscillatorVis
                  x={node.x + 10}
                  y={node.y + h - 22}
                  w={NODE_WIDTH - 20}
                  h={16}
                  waveform={node.params.waveform ?? 0}
                  frame={frame}
                  color={color}
                />
              )}
              {isActive && node.type === 'filter' && (
                <FilterVis
                  x={node.x + 10}
                  y={node.y + h - 22}
                  w={NODE_WIDTH - 20}
                  h={16}
                  cutoff={node.params.cutoff ?? 2000}
                  resonance={node.params.resonance ?? 0.5}
                  color={color}
                />
              )}
              {isActive && node.type === 'effect' && (
                <EffectVis
                  x={node.x + 10}
                  y={node.y + h - 22}
                  w={NODE_WIDTH - 20}
                  h={16}
                  name={node.name}
                  frame={frame}
                  color={color}
                />
              )}
            </g>
          );
        })}

        {/* ── Preview meters near output node ── */}
        {outputNode && (
          <g>
            {/* VU meters */}
            <rect
              x={outputNode.x + NODE_WIDTH + 20}
              y={outputNode.y}
              width={40}
              height={80}
              rx={6}
              fill="rgba(0,0,0,0.3)"
              stroke="rgba(103,232,249,0.12)"
              strokeWidth={0.5}
            />
            {/* L meter */}
            <rect
              x={outputNode.x + NODE_WIDTH + 26}
              y={outputNode.y + 76 - previewLevelL * 70}
              width={12}
              height={Math.max(0, previewLevelL * 70)}
              rx={3}
              fill="#2dd4bf"
              opacity={0.75}
              filter="url(#lng-glow-soft)"
            />
            {/* R meter */}
            <rect
              x={outputNode.x + NODE_WIDTH + 42}
              y={outputNode.y + 76 - previewLevelR * 70}
              width={12}
              height={Math.max(0, previewLevelR * 70)}
              rx={3}
              fill="#67e8f9"
              opacity={0.75}
              filter="url(#lng-glow-soft)"
            />
            <text
              x={outputNode.x + NODE_WIDTH + 32}
              y={outputNode.y + 78}
              fill="rgba(148,163,184,0.5)"
              fontSize={6}
              fontFamily="'Space Mono', monospace"
              textAnchor="middle"
            >
              L
            </text>
            <text
              x={outputNode.x + NODE_WIDTH + 48}
              y={outputNode.y + 78}
              fill="rgba(148,163,184,0.5)"
              fontSize={6}
              fontFamily="'Space Mono', monospace"
              textAnchor="middle"
            >
              R
            </text>

            {/* Mini oscilloscope */}
            <rect
              x={outputNode.x + NODE_WIDTH + 20}
              y={outputNode.y + 88}
              width={60}
              height={36}
              rx={4}
              fill="rgba(0,0,0,0.3)"
              stroke="rgba(103,232,249,0.12)"
              strokeWidth={0.5}
            />
            <WaveformOscilloscope
              x={outputNode.x + NODE_WIDTH + 22}
              y={outputNode.y + 90}
              w={56}
              h={32}
              frame={frame}
              isPlaying={isPreviewPlaying}
              level={(previewLevelL + previewLevelR) / 2}
            />
          </g>
        )}

        {/* Validation: missing connections as dashed lines */}
        {validationErrors.map((err, i) => {
          // Show a subtle indicator in the corner
          return (
            <g key={`err-${i}`}>
              <circle
                cx={1170}
                cy={20 + i * 14}
                r={4}
                fill="rgba(248,113,113,0.4)"
                filter="url(#lng-glow-soft)"
              />
              <text
                x={1162}
                y={23 + i * 14}
                fill="#f87171"
                fontSize={7}
                fontFamily="'Space Mono', monospace"
                textAnchor="end"
                opacity={0.7}
              >
                {err.length > 40 ? err.slice(0, 40) + '...' : err}
              </text>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

// ── Sub-components ───────────────────────────────────────────────────────────

/** Type-specific icon inside node header */
const NodeTypeIcon: React.FC<{
  type: string;
  cx: number;
  cy: number;
  color: string;
  frame: number;
  isActive: boolean;
}> = ({ type, cx, cy, color, frame, isActive }) => {
  const pulse = isActive ? Math.sin(frame * 0.1) * 0.2 + 0.8 : 0.7;
  switch (type) {
    case 'oscillator':
      // Sine wave icon
      return (
        <path
          d={`M ${cx - 4} ${cy} Q ${cx - 2} ${cy - 3}, ${cx} ${cy} Q ${cx + 2} ${cy + 3}, ${cx + 4} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={1}
          opacity={pulse}
        />
      );
    case 'filter':
      // Step/curve icon
      return (
        <path
          d={`M ${cx - 4} ${cy - 2} L ${cx - 1} ${cy - 2} Q ${cx + 1} ${cy - 2}, ${cx + 2} ${cy + 2} L ${cx + 4} ${cy + 2}`}
          fill="none"
          stroke={color}
          strokeWidth={1}
          opacity={pulse}
        />
      );
    case 'envelope':
      // ADSR shape
      return (
        <path
          d={`M ${cx - 4} ${cy + 2} L ${cx - 2} ${cy - 3} L ${cx} ${cy - 1} L ${cx + 2} ${cy - 1} L ${cx + 4} ${cy + 2}`}
          fill="none"
          stroke={color}
          strokeWidth={1}
          opacity={pulse}
        />
      );
    case 'lfo':
      // Triangle wave
      return (
        <path
          d={`M ${cx - 4} ${cy} L ${cx - 2} ${cy - 3} L ${cx} ${cy} L ${cx + 2} ${cy + 3} L ${cx + 4} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={1}
          opacity={pulse}
        />
      );
    case 'effect':
      // Circle with dot
      return (
        <>
          <circle cx={cx} cy={cy} r={3} fill="none" stroke={color} strokeWidth={0.8} opacity={pulse} />
          <circle cx={cx} cy={cy} r={1} fill={color} opacity={pulse} />
        </>
      );
    case 'math':
      // Plus sign
      return (
        <>
          <line x1={cx - 3} y1={cy} x2={cx + 3} y2={cy} stroke={color} strokeWidth={1} opacity={pulse} />
          <line x1={cx} y1={cy - 3} x2={cx} y2={cy + 3} stroke={color} strokeWidth={1} opacity={pulse} />
        </>
      );
    case 'output':
      // Speaker icon
      return (
        <path
          d={`M ${cx - 3} ${cy - 2} L ${cx - 1} ${cy - 2} L ${cx + 2} ${cy - 4} L ${cx + 2} ${cy + 4} L ${cx - 1} ${cy + 2} L ${cx - 3} ${cy + 2} Z`}
          fill={color}
          opacity={pulse * 0.6}
        />
      );
    default:
      return <circle cx={cx} cy={cy} r={2} fill={color} opacity={pulse} />;
  }
};

/** Oscillator waveform visualization */
const OscillatorVis: React.FC<{
  x: number; y: number; w: number; h: number;
  waveform: number; frame: number; color: string;
}> = ({ x, y, w, h, waveform, frame, color }) => {
  const points = Array.from({ length: 40 }, (_, i) => {
    const t = i / 39;
    const phase = t * Math.PI * 4 + frame * 0.15;
    let val: number;
    switch (Math.round(waveform)) {
      case 0: val = Math.sin(phase); break; // sine
      case 1: val = ((phase / Math.PI) % 2) - 1; break; // saw
      case 2: val = Math.sin(phase) > 0 ? 1 : -1; break; // square
      case 3: val = Math.abs(((phase / Math.PI) % 2) - 1) * 2 - 1; break; // triangle
      default: val = Math.sin(phase);
    }
    return `${x + t * w},${y + h / 2 - val * h * 0.4}`;
  }).join(' ');

  return (
    <polyline
      points={points}
      fill="none"
      stroke={color}
      strokeWidth={1}
      opacity={0.5}
    />
  );
};

/** Filter frequency response visualization */
const FilterVis: React.FC<{
  x: number; y: number; w: number; h: number;
  cutoff: number; resonance: number; color: string;
}> = ({ x, y, w, h, cutoff, resonance, color }) => {
  const cutoffNorm = Math.min(1, cutoff / 20000);
  const points = Array.from({ length: 40 }, (_, i) => {
    const t = i / 39;
    // Simple lowpass response curve
    const freqRatio = t / Math.max(0.01, cutoffNorm);
    const response = 1 / Math.sqrt(1 + Math.pow(freqRatio, 4));
    // Resonance peak near cutoff
    const resPeak = resonance * Math.exp(-Math.pow((t - cutoffNorm) * 10, 2));
    const val = Math.min(1, response + resPeak);
    return `${x + t * w},${y + h - val * h * 0.85}`;
  }).join(' ');

  return (
    <polyline
      points={points}
      fill="none"
      stroke={color}
      strokeWidth={1}
      opacity={0.5}
    />
  );
};

/** Effect-specific visualization */
const EffectVis: React.FC<{
  x: number; y: number; w: number; h: number;
  name: string; frame: number; color: string;
}> = ({ x, y, w, h, name, frame, color }) => {
  const lowerName = name.toLowerCase();

  if (lowerName.includes('delay')) {
    // Echo dots
    const dots = Array.from({ length: 4 }, (_, i) => {
      const dx = (i + 1) * w / 5;
      const opacity = 0.7 - i * 0.15;
      const scale = 1 - i * 0.15;
      const bounce = Math.sin(frame * 0.1 + i * 0.5) * 2;
      return (
        <circle
          key={i}
          cx={x + dx}
          cy={y + h / 2 + bounce}
          r={3 * scale}
          fill={color}
          opacity={opacity * 0.6}
        />
      );
    });
    return <>{dots}</>;
  }

  if (lowerName.includes('reverb')) {
    // Expanding rings
    const rings = Array.from({ length: 3 }, (_, i) => {
      const r = 4 + i * 4 + Math.sin(frame * 0.08 + i) * 2;
      return (
        <circle
          key={i}
          cx={x + w / 2}
          cy={y + h / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={0.8}
          opacity={0.4 - i * 0.1}
        />
      );
    });
    return <>{rings}</>;
  }

  // Default: simple activity indicator
  const barCount = 8;
  return (
    <>
      {Array.from({ length: barCount }, (_, i) => {
        const bh = Math.abs(Math.sin(frame * 0.12 + i * 0.5)) * h * 0.7;
        return (
          <rect
            key={i}
            x={x + i * (w / barCount) + 1}
            y={y + h - bh}
            width={w / barCount - 2}
            height={bh}
            rx={1}
            fill={color}
            opacity={0.3}
          />
        );
      })}
    </>
  );
};

/** Waveform oscilloscope near output */
const WaveformOscilloscope: React.FC<{
  x: number; y: number; w: number; h: number;
  frame: number; isPlaying: boolean; level: number;
}> = ({ x, y, w, h, frame, isPlaying, level }) => {
  const amp = isPlaying ? level * 0.8 : 0.2;
  const points = Array.from({ length: 50 }, (_, i) => {
    const t = i / 49;
    const phase = t * Math.PI * 6 + frame * 0.12;
    const val = Math.sin(phase) * amp + Math.sin(phase * 2.7) * amp * 0.3;
    return `${x + t * w},${y + h / 2 - val * h * 0.4}`;
  }).join(' ');

  return (
    <>
      {/* Center line */}
      <line
        x1={x}
        y1={y + h / 2}
        x2={x + w}
        y2={y + h / 2}
        stroke="rgba(103,232,249,0.1)"
        strokeWidth={0.5}
      />
      <polyline
        points={points}
        fill="none"
        stroke="#2dd4bf"
        strokeWidth={1}
        opacity={isPlaying ? 0.7 : 0.3}
      />
    </>
  );
};
