import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  Play,
  Square,
  Download,
  AudioWaveform,
  Waves,
  Timer,
  Triangle,
  CircleDot,
  Calculator,
  Speaker,
  AlertCircle,
  CheckCircle,
  Loader,
} from 'lucide-react';
import {
  aurora,
  mockPluginNodes,
  mockPluginConnections,
  seededRandom,
  hexToRgba,
} from '../mockData';
import { sendToSwift, onSwiftMessage, BridgeMessages } from '../bridge';
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

// Maps palette items to Swift-side DSP node types
const PALETTE_ITEMS: { type: string; name: string; items: { label: string; nodeType: string; defaults: Record<string, number> }[] }[] = [
  { type: 'oscillator', name: 'Oscillator', items: [
    { label: 'Sine', nodeType: 'oscillator', defaults: { waveform: 0 } },
    { label: 'Saw', nodeType: 'oscillator', defaults: { waveform: 1 } },
    { label: 'Square', nodeType: 'oscillator', defaults: { waveform: 2 } },
    { label: 'Triangle', nodeType: 'oscillator', defaults: { waveform: 3 } },
    { label: 'Noise', nodeType: 'noise', defaults: {} },
  ]},
  { type: 'filter', name: 'Filter', items: [
    { label: 'Low Pass', nodeType: 'lowpass', defaults: {} },
    { label: 'High Pass', nodeType: 'highpass', defaults: {} },
    { label: 'Band Pass', nodeType: 'bandpass', defaults: {} },
    { label: 'Notch', nodeType: 'notch', defaults: {} },
  ]},
  { type: 'envelope', name: 'Envelope', items: [
    { label: 'ADSR', nodeType: 'adsr', defaults: {} },
    { label: 'Multi-Stage', nodeType: 'multiStageEnvelope', defaults: {} },
  ]},
  { type: 'lfo', name: 'LFO', items: [
    { label: 'Sine LFO', nodeType: 'lfo', defaults: { waveform: 0 } },
    { label: 'Saw LFO', nodeType: 'lfo', defaults: { waveform: 3 } },
    { label: 'Random S&H', nodeType: 'lfo', defaults: { waveform: 4 } },
  ]},
  { type: 'effect', name: 'Effect', items: [
    { label: 'Delay', nodeType: 'delay', defaults: {} },
    { label: 'Reverb', nodeType: 'reverb', defaults: {} },
    { label: 'Chorus', nodeType: 'chorus', defaults: {} },
    { label: 'Distortion', nodeType: 'distortion', defaults: {} },
  ]},
  { type: 'math', name: 'Math', items: [
    { label: 'Add', nodeType: 'add', defaults: {} },
    { label: 'Multiply', nodeType: 'multiply', defaults: {} },
    { label: 'Scale', nodeType: 'scale', defaults: {} },
    { label: 'Mix', nodeType: 'mix', defaults: {} },
  ]},
  { type: 'output', name: 'Output', items: [
    { label: 'Audio Output', nodeType: 'output', defaults: {} },
  ]},
];

// Category for a DSP node type string
function categoryForNodeType(nodeType: string): string {
  if (['oscillator', 'noise', 'wavetable', 'subOscillator'].includes(nodeType)) return 'oscillator';
  if (['lowpass', 'highpass', 'bandpass', 'notch', 'comb'].includes(nodeType)) return 'filter';
  if (['adsr', 'multiStageEnvelope'].includes(nodeType)) return 'envelope';
  if (nodeType === 'lfo') return 'lfo';
  if (['delay', 'reverb', 'chorus', 'distortion', 'bitcrusher', 'phaser', 'flanger'].includes(nodeType)) return 'effect';
  if (['add', 'multiply', 'mix', 'clamp', 'scale'].includes(nodeType)) return 'math';
  if (nodeType === 'output') return 'output';
  return 'math';
}

function getNodeCenter(node: PluginNode, _port: string, side: 'input' | 'output'): [number, number] {
  const paramKeys = Object.keys(node.params);
  const nodeH = NODE_HEIGHT_BASE + paramKeys.length * 20;
  const x = side === 'output' ? node.x + NODE_WIDTH : node.x;
  const y = node.y + nodeH / 2;
  return [x, y];
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

let nextNodeCounter = 100;

interface ValidationError {
  message: string;
}

interface ExportState {
  status: 'idle' | 'compiling' | 'building' | 'done' | 'error';
  message: string;
  outputPath?: string;
}

export const PluginView: React.FC = () => {
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [frame, setFrame] = useState(0);
  const [nodes, setNodes] = useState<PluginNode[]>(mockPluginNodes);
  const [connections, setConnections] = useState<PluginConnection[]>(mockPluginConnections);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewLevels, setPreviewLevels] = useState({ left: 0, right: 0 });
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle', message: '' });

  // Connection drawing state
  const [connectingFrom, setConnectingFrom] = useState<{ nodeId: string; port: string } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Dragging state
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragOffset = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  useEffect(() => {
    const interval = setInterval(() => setFrame((f) => f + 1), 50);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to Swift events
  useEffect(() => {
    const unsubs = [
      onSwiftMessage(BridgeMessages.PLUGIN_GRAPH_UPDATE, (payload: unknown) => {
        const data = payload as { nodes: PluginNode[]; connections: PluginConnection[] };
        if (data.nodes) setNodes(data.nodes);
        if (data.connections) setConnections(data.connections);
      }),
      onSwiftMessage(BridgeMessages.PLUGIN_VALIDATION, (payload: unknown) => {
        const data = payload as { errors: ValidationError[] };
        setValidationErrors(data.errors ?? []);
      }),
      onSwiftMessage(BridgeMessages.PLUGIN_PREVIEW_LEVELS, (payload: unknown) => {
        const data = payload as { left: number; right: number };
        setPreviewLevels({ left: data.left ?? 0, right: data.right ?? 0 });
      }),
      onSwiftMessage(BridgeMessages.PLUGIN_EXPORT_PROGRESS, (payload: unknown) => {
        const data = payload as { stage: string; message: string };
        setExportState({ status: data.stage as ExportState['status'], message: data.message });
      }),
      onSwiftMessage(BridgeMessages.PLUGIN_EXPORT_RESULT, (payload: unknown) => {
        const data = payload as { success: boolean; path?: string; error?: string };
        if (data.success) {
          setExportState({ status: 'done', message: `Exported to ${data.path}`, outputPath: data.path });
        } else {
          setExportState({ status: 'error', message: data.error ?? 'Export failed' });
        }
      }),
      onSwiftMessage(BridgeMessages.PLUGIN_AI_RESULT, (payload: unknown) => {
        const data = payload as { nodes: PluginNode[]; connections: PluginConnection[]; error?: string };
        setAiLoading(false);
        if (data.error) {
          console.warn('[PluginView] AI error:', data.error);
        } else {
          if (data.nodes) setNodes(data.nodes);
          if (data.connections) setConnections(data.connections);
        }
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // Handle adding a node from palette
  const handleAddNode = useCallback(
    (nodeType: string, defaults: Record<string, number>, label: string) => {
      const id = `node_${nextNodeCounter++}`;
      const x = 200 + Math.random() * 300;
      const y = 100 + Math.random() * 300;
      sendToSwift(BridgeMessages.ADD_NODE, {
        id,
        type: nodeType,
        x,
        y,
        defaults,
        label,
      });
      // Optimistic update: add node locally with empty params (Swift will send back full params)
      const cat = categoryForNodeType(nodeType) as PluginNode['type'];
      setNodes((prev) => [
        ...prev,
        { id, type: cat, name: label, x, y, params: { ...defaults }, inputs: ['audio'], outputs: ['audio'] },
      ]);
    },
    [],
  );

  // Handle removing a node
  const handleRemoveNode = useCallback((nodeId: string) => {
    sendToSwift(BridgeMessages.REMOVE_NODE, { nodeId });
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setConnections((prev) => prev.filter((c) => c.from.nodeId !== nodeId && c.to.nodeId !== nodeId));
  }, []);

  // Handle connecting two ports
  const handleConnect = useCallback(
    (fromNodeId: string, fromPort: string, toNodeId: string, toPort: string) => {
      sendToSwift(BridgeMessages.CONNECT_NODES, {
        fromNode: fromNodeId,
        fromPort,
        toNode: toNodeId,
        toPort,
      });
      const id = `${fromNodeId}.${fromPort}->${toNodeId}.${toPort}`;
      setConnections((prev) => [
        ...prev,
        { id, from: { nodeId: fromNodeId, port: fromPort }, to: { nodeId: toNodeId, port: toPort } },
      ]);
    },
    [],
  );

  // Handle parameter changes
  const handleParamChange = useCallback(
    (nodeId: string, param: string, value: number) => {
      sendToSwift(BridgeMessages.SET_NODE_PARAM, { nodeId, param, value });
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, params: { ...n.params, [param]: value } } : n)),
      );
    },
    [],
  );

  // Handle node dragging
  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string, nodeX: number, nodeY: number) => {
      e.stopPropagation();
      setDraggingNodeId(nodeId);
      const svgRect = (e.currentTarget as SVGElement).closest('svg')?.getBoundingClientRect();
      if (svgRect) {
        dragOffset.current = { dx: e.clientX - svgRect.left - nodeX, dy: e.clientY - svgRect.top - nodeY };
      }
    },
    [],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svgRect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - svgRect.left;
      const my = e.clientY - svgRect.top;
      setMousePos({ x: mx, y: my });

      if (draggingNodeId) {
        const newX = mx - dragOffset.current.dx;
        const newY = my - dragOffset.current.dy;
        setNodes((prev) =>
          prev.map((n) => (n.id === draggingNodeId ? { ...n, x: newX, y: newY } : n)),
        );
      }
    },
    [draggingNodeId],
  );

  const handleCanvasMouseUp = useCallback(() => {
    if (draggingNodeId) {
      const node = nodes.find((n) => n.id === draggingNodeId);
      if (node) {
        sendToSwift(BridgeMessages.MOVE_NODE, { nodeId: draggingNodeId, x: node.x, y: node.y });
      }
      setDraggingNodeId(null);
    }
    if (connectingFrom) {
      setConnectingFrom(null);
    }
  }, [draggingNodeId, connectingFrom, nodes]);

  // Handle output port click (start connection)
  const handleOutputPortClick = useCallback(
    (e: React.MouseEvent, nodeId: string, port: string) => {
      e.stopPropagation();
      setConnectingFrom({ nodeId, port });
    },
    [],
  );

  // Handle input port click (complete connection)
  const handleInputPortClick = useCallback(
    (e: React.MouseEvent, nodeId: string, port: string) => {
      e.stopPropagation();
      if (connectingFrom && connectingFrom.nodeId !== nodeId) {
        handleConnect(connectingFrom.nodeId, connectingFrom.port, nodeId, port);
        setConnectingFrom(null);
      }
    },
    [connectingFrom, handleConnect],
  );

  // Handle preview toggle
  const handlePreviewToggle = useCallback(() => {
    if (isPreviewing) {
      sendToSwift(BridgeMessages.PLUGIN_PREVIEW_STOP, {});
      setIsPreviewing(false);
    } else {
      sendToSwift(BridgeMessages.PLUGIN_PREVIEW_START, {});
      setIsPreviewing(true);
    }
  }, [isPreviewing]);

  // Handle export
  const handleExport = useCallback(() => {
    setExportState({ status: 'compiling', message: 'Compiling node graph...' });
    sendToSwift(BridgeMessages.EXPORT_AUV3, {});
  }, []);

  // Handle AI generate
  const handleAIGenerate = useCallback(() => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    sendToSwift(BridgeMessages.AI_GENERATE_PATCH, { description: aiPrompt.trim() });
  }, [aiPrompt]);

  // Handle slider interaction
  const handleSliderMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string, param: string, currentVal: number, min: number, max: number) => {
      e.stopPropagation();
      const startX = e.clientX;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const ratio = dx / 80; // 80px = slider width
        const newVal = Math.max(min, Math.min(max, currentVal + ratio * (max - min)));
        handleParamChange(nodeId, param, newVal);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [handleParamChange],
  );

  // Compute connection paths
  const connectionPaths = useMemo(() => {
    return connections.map((conn) => {
      const fromNode = nodes.find((n) => n.id === conn.from.nodeId);
      const toNode = nodes.find((n) => n.id === conn.to.nodeId);
      if (!fromNode || !toNode) return null;

      const [x1, y1] = getNodeCenter(fromNode, conn.from.port, 'output');
      const [x2, y2] = getNodeCenter(toNode, conn.to.port, 'input');

      return { ...conn, x1, y1, x2, y2 };
    }).filter(Boolean) as (PluginConnection & { x1: number; y1: number; x2: number; y2: number })[];
  }, [connections, nodes]);

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
                key={item.label}
                className="glass-panel glass-panel-hover px-2 py-1 cursor-pointer"
                style={{
                  fontSize: 8,
                  color: 'var(--text-dim)',
                  borderRadius: 4,
                  borderLeft: `2px solid ${NODE_TYPE_COLORS[category.type]}44`,
                }}
                onClick={() => handleAddNode(item.nodeType, item.defaults, item.label)}
              >
                {item.label}
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
              onKeyDown={(e) => { if (e.key === 'Enter') handleAIGenerate(); }}
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
                opacity: aiLoading ? 0.5 : 1,
              }}
              onClick={handleAIGenerate}
              disabled={aiLoading}
            >
              {aiLoading ? <Loader size={10} className="animate-spin" /> : <Sparkles size={10} />}
              <span style={{ fontSize: 8 }}>{aiLoading ? 'Generating...' : 'Generate'}</span>
            </button>
          </div>

          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

          {/* Validation indicators */}
          {validationErrors.length > 0 && (
            <div className="flex items-center gap-1" title={validationErrors.map((e) => e.message).join('\n')}>
              <AlertCircle size={12} style={{ color: '#f87171' }} />
              <span style={{ fontSize: 8, color: '#f87171' }}>{validationErrors.length} issue{validationErrors.length > 1 ? 's' : ''}</span>
            </div>
          )}
          {validationErrors.length === 0 && nodes.length > 1 && (
            <div className="flex items-center gap-1">
              <CheckCircle size={12} style={{ color: aurora.green }} />
              <span style={{ fontSize: 8, color: aurora.green }}>Valid</span>
            </div>
          )}

          <button
            className="glass-button flex items-center gap-1.5 px-2 py-1"
            style={{
              background: exportState.status === 'compiling' || exportState.status === 'building'
                ? 'rgba(251,191,36,0.15)'
                : exportState.status === 'done'
                ? 'rgba(52,211,153,0.15)'
                : exportState.status === 'error'
                ? 'rgba(248,113,113,0.15)'
                : 'rgba(52,211,153,0.12)',
              borderColor: exportState.status === 'error' ? 'rgba(248,113,113,0.3)' : 'rgba(52,211,153,0.3)',
              color: exportState.status === 'error' ? '#f87171' : aurora.green,
              opacity: exportState.status === 'compiling' || exportState.status === 'building' ? 0.6 : 1,
            }}
            onClick={handleExport}
            disabled={exportState.status === 'compiling' || exportState.status === 'building'}
          >
            {(exportState.status === 'compiling' || exportState.status === 'building') ? (
              <Loader size={10} className="animate-spin" />
            ) : (
              <Download size={10} />
            )}
            <span style={{ fontSize: 8 }}>
              {exportState.status === 'idle' ? 'Export AUv3' :
               exportState.status === 'compiling' ? 'Compiling...' :
               exportState.status === 'building' ? 'Building...' :
               exportState.status === 'done' ? 'Exported!' :
               'Export Failed'}
            </span>
          </button>
        </div>

        {/* Export status message */}
        {exportState.status !== 'idle' && exportState.message && (
          <div
            className="px-3 py-1"
            style={{
              fontSize: 8,
              fontFamily: 'var(--font-mono)',
              color: exportState.status === 'error' ? '#f87171' :
                     exportState.status === 'done' ? aurora.green :
                     aurora.gold,
              background: 'rgba(0,0,0,0.2)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {exportState.message}
          </div>
        )}

        {/* Node graph canvas */}
        <div className="flex-1 overflow-auto relative">
          <svg
            width={canvasWidth}
            height={canvasHeight}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            style={{ cursor: draggingNodeId ? 'grabbing' : connectingFrom ? 'crosshair' : 'default' }}
          >
            <defs>
              {/* Aurora gradient for connections */}
              {connectionPaths.map((conn) => (
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
            {connectionPaths.map((conn) => {
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

            {/* Active connection line (being drawn) */}
            {connectingFrom && (() => {
              const fromNode = nodes.find((n) => n.id === connectingFrom.nodeId);
              if (!fromNode) return null;
              const [x1, y1] = getNodeCenter(fromNode, connectingFrom.port, 'output');
              return (
                <path
                  d={bezierPath(x1, y1, mousePos.x, mousePos.y)}
                  fill="none"
                  stroke={aurora.cyan}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  opacity={0.6}
                />
              );
            })()}

            {/* Nodes */}
            {nodes.map((node) => {
              const color = NODE_TYPE_COLORS[node.type] ?? aurora.cyan;
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
                    style={{ cursor: 'grab' }}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.id, node.x, node.y)}
                  />
                  {/* Header */}
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_WIDTH}
                    height={24}
                    rx={8}
                    fill={hexToRgba(color, 0.12)}
                    style={{ cursor: 'grab' }}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.id, node.x, node.y)}
                  />
                  <rect
                    x={node.x}
                    y={node.y + 16}
                    width={NODE_WIDTH}
                    height={8}
                    fill={hexToRgba(color, 0.12)}
                    style={{ cursor: 'grab', pointerEvents: 'none' }}
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
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.name}
                  </text>

                  {/* Delete button */}
                  {node.type !== 'output' && (
                    <g
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleRemoveNode(node.id)}
                    >
                      <circle cx={node.x + NODE_WIDTH - 12} cy={node.y + 12} r={7} fill="rgba(248,113,113,0.15)" />
                      <text
                        x={node.x + NODE_WIDTH - 12}
                        y={node.y + 16}
                        fill="#f87171"
                        fontSize={10}
                        textAnchor="middle"
                        style={{ pointerEvents: 'none' }}
                      >
                        x
                      </text>
                    </g>
                  )}

                  {/* Parameters */}
                  {paramKeys.map((param, pi) => {
                    const val = node.params[param];
                    const y = node.y + 30 + pi * 20;
                    // Determine min/max heuristics for slider
                    const isLargeRange = val > 1 || param === 'frequency' || param === 'cutoff';
                    const min = 0;
                    const max = isLargeRange ? 20000 : 1;
                    const sliderFill = Math.min(80, (typeof val === 'number' ? Math.min(1, val > 1 ? val / 20000 : val) : 0.5) * 80);

                    return (
                      <g key={param}>
                        <text
                          x={node.x + 10}
                          y={y + 10}
                          fill="var(--text-muted)"
                          fontSize={7}
                          fontFamily="var(--font-mono)"
                          style={{ pointerEvents: 'none' }}
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
                          style={{ cursor: 'ew-resize' }}
                          onMouseDown={(e) => handleSliderMouseDown(e, node.id, param, val, min, max)}
                        />
                        <rect
                          x={node.x + 70}
                          y={y + 5}
                          width={sliderFill}
                          height={6}
                          rx={3}
                          fill={hexToRgba(color, 0.5)}
                          style={{ pointerEvents: 'none' }}
                        />
                        <text
                          x={node.x + 155}
                          y={y + 10}
                          fill="var(--text-dim)"
                          fontSize={7}
                          fontFamily="var(--font-mono)"
                          textAnchor="end"
                          style={{ pointerEvents: 'none' }}
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
                  {node.inputs.map((port) => (
                    <g key={`in-${port}`}>
                      <circle
                        cx={node.x}
                        cy={node.y + nodeH / 2}
                        r={5}
                        fill={connectingFrom ? hexToRgba(aurora.cyan, 0.3) : 'var(--bg)'}
                        stroke={hexToRgba(color, 0.5)}
                        strokeWidth={1.5}
                        style={{ cursor: 'crosshair' }}
                        onClick={(e) => handleInputPortClick(e, node.id, port)}
                      />
                    </g>
                  ))}

                  {/* Output ports */}
                  {node.outputs.map((port) => (
                    <g key={`out-${port}`}>
                      <circle
                        cx={node.x + NODE_WIDTH}
                        cy={node.y + nodeH / 2}
                        r={5}
                        fill={hexToRgba(color, 0.3)}
                        stroke={hexToRgba(color, 0.6)}
                        strokeWidth={1.5}
                        style={{ cursor: 'crosshair' }}
                        onClick={(e) => handleOutputPortClick(e, node.id, port)}
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
              background: isPreviewing ? 'rgba(248,113,113,0.15)' : 'rgba(52,211,153,0.15)',
              borderColor: isPreviewing ? 'rgba(248,113,113,0.3)' : 'rgba(52,211,153,0.3)',
            }}
            onClick={handlePreviewToggle}
          >
            {isPreviewing ? (
              <Square size={10} style={{ color: '#f87171' }} />
            ) : (
              <Play size={12} style={{ color: aurora.green }} />
            )}
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

          {/* Level meters */}
          <svg width={60} height={40}>
            <rect x={0} y={0} width={60} height={40} rx={4}
              fill="rgba(0,0,0,0.2)" stroke="var(--border)" strokeWidth={0.5} />
            {/* Left channel */}
            <rect x={10} y={38 - previewLevels.left * 34} width={14} height={previewLevels.left * 34}
              rx={2} fill={aurora.teal} opacity={0.7} />
            {/* Right channel */}
            <rect x={36} y={38 - previewLevels.right * 34} width={14} height={previewLevels.right * 34}
              rx={2} fill={aurora.cyan} opacity={0.7} />
            <text x={17} y={38} fill="var(--text-muted)" fontSize={6} textAnchor="middle">L</text>
            <text x={43} y={38} fill="var(--text-muted)" fontSize={6} textAnchor="middle">R</text>
          </svg>

          {/* Spectrum mini */}
          <svg width={150} height={40}>
            <rect x={0} y={0} width={150} height={40} rx={4}
              fill="rgba(0,0,0,0.2)" stroke="var(--border)" strokeWidth={0.5} />
            {Array.from({ length: 24 }, (_, i) => {
              const h = isPreviewing
                ? (Math.sin(frame * 0.15 + i * 0.4) * 0.5 + 0.5) * 30
                : (Math.sin(frame * 0.1 + i * 0.3) * 0.5 + 0.5) * 30;
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
                  opacity={isPreviewing ? 0.8 : 0.6}
                />
              );
            })}
          </svg>

          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
            {isPreviewing ? 'Previewing...' : 'A4 (440Hz)'}
          </span>
        </div>
      </div>
    </div>
  );
};
