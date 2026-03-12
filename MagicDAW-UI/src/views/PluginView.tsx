import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import { Player } from '@remotion/player';
import {
  aurora,
} from '../mockData';
import { sendToSwift, onSwiftMessage, BridgeMessages } from '../bridge';
import type { PluginNode, PluginConnection } from '../types/daw';
import type { SavedPluginGraphSummary } from '../bridge';
import { LiveNodeGraph } from '../compositions/LiveNodeGraph';

const NODE_WIDTH = 200;
const NODE_HEIGHT_BASE = 80;
const PARAM_ROW_H = 22;

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

const STARTER_TEMPLATES: { id: string; label: string; description: string }[] = [
  { id: 'basic-synth', label: 'Basic Synth', description: 'Oscillator into filter into output.' },
  { id: 'bass-voice', label: 'Bass Voice', description: 'Tighter mono bass chain with drive.' },
  { id: 'noise-fx', label: 'Noise FX', description: 'Noise source through delay for risers and sweeps.' },
  { id: 'empty', label: 'Empty Graph', description: 'Clean slate with just an output node.' },
];

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

function nodeHeight(node: PluginNode): number {
  return NODE_HEIGHT_BASE + Object.keys(node.params).length * PARAM_ROW_H;
}

let nextNodeCounter = 100;

interface ValidationError {
  message: string;
}

interface ExportState {
  status: 'idle' | 'compiling' | 'building' | 'done' | 'error';
  message: string;
  outputPath?: string;
  logPath?: string;
}

interface PluginViewProps {
  selectedTrackId?: string | null;
}

export const PluginView: React.FC<PluginViewProps> = ({ selectedTrackId = null }) => {
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [nodes, setNodes] = useState<PluginNode[]>([]);
  const [connections, setConnections] = useState<PluginConnection[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewLevels, setPreviewLevels] = useState({ left: 0, right: 0 });
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle', message: '' });
  const [exportLogCopied, setExportLogCopied] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [savedGraphs, setSavedGraphs] = useState<SavedPluginGraphSummary[]>([]);
  const [saveMessage, setSaveMessage] = useState<string>('');

  // Connection drawing state
  const [connectingFrom, setConnectingFrom] = useState<{ nodeId: string; port: string } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Dragging state
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragOffset = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  // Canvas container ref for coordinate translation
  const canvasRef = useRef<HTMLDivElement>(null);

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
        const data = payload as { success: boolean; path?: string; error?: string; message?: string; logPath?: string };
        if (data.success) {
          setExportState({
            status: 'done',
            message: data.message ?? `Exported to ${data.path}`,
            outputPath: data.path,
            logPath: data.logPath,
          });
        } else {
          setExportState({
            status: 'error',
            message: data.error ?? 'Export failed',
            logPath: data.logPath,
          });
        }
        setExportLogCopied(false);
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
      onSwiftMessage(BridgeMessages.PLUGIN_SAVED_LIST, (payload: unknown) => {
        const data = payload as { graphs?: SavedPluginGraphSummary[] };
        setSavedGraphs(data.graphs ?? []);
      }),
      onSwiftMessage(BridgeMessages.PLUGIN_SAVED, (payload: unknown) => {
        const data = payload as { name?: string };
        setSaveMessage(data.name ? `Saved ${data.name}` : 'Graph saved');
      }),
    ];
    sendToSwift(BridgeMessages.PLUGIN_SYNC_GRAPH, {});
    sendToSwift(BridgeMessages.PLUGIN_LIST_SAVED, {});
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => () => {
    sendToSwift(BridgeMessages.PLUGIN_PREVIEW_STOP, {});
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
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId]);

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

  // Translate screen coords to SVG viewBox coords (1200x700)
  const screenToSVG = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const el = canvasRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    const sx = 1200 / rect.width;
    const sy = 700 / rect.height;
    return {
      x: (clientX - rect.left) * sx,
      y: (clientY - rect.top) * sy,
    };
  }, []);

  // Handle node dragging on overlay
  const handleOverlayMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToSVG(e.clientX, e.clientY);

      // Check if clicking on a port first (for connection drawing)
      for (const node of nodes) {
        const h = nodeHeight(node);

        // Output ports
        for (const port of node.outputs) {
          const px = node.x + NODE_WIDTH;
          const py = node.y + h / 2;
          if (Math.hypot(pos.x - px, pos.y - py) < 12) {
            e.stopPropagation();
            setConnectingFrom({ nodeId: node.id, port });
            return;
          }
        }

        // Input ports
        for (const port of node.inputs) {
          const px = node.x;
          const py = node.y + h / 2;
          if (Math.hypot(pos.x - px, pos.y - py) < 12) {
            e.stopPropagation();
            if (connectingFrom && connectingFrom.nodeId !== node.id) {
              handleConnect(connectingFrom.nodeId, connectingFrom.port, node.id, port);
              setConnectingFrom(null);
            }
            return;
          }
        }
      }

      // Check if clicking on a node body (for dragging / selection)
      for (const node of [...nodes].reverse()) {
        const h = nodeHeight(node);
        if (
          pos.x >= node.x &&
          pos.x <= node.x + NODE_WIDTH &&
          pos.y >= node.y &&
          pos.y <= node.y + h
        ) {
          e.stopPropagation();
          setSelectedNodeId(node.id);
          setDraggingNodeId(node.id);
          dragOffset.current = { dx: pos.x - node.x, dy: pos.y - node.y };
          return;
        }
      }

      // Click on empty space -- deselect and cancel connection
      setSelectedNodeId(null);
      setConnectingFrom(null);
    },
    [nodes, connectingFrom, handleConnect, screenToSVG],
  );

  const handleOverlayMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToSVG(e.clientX, e.clientY);
      setMousePos(pos);

      if (draggingNodeId) {
        const newX = pos.x - dragOffset.current.dx;
        const newY = pos.y - dragOffset.current.dy;
        setNodes((prev) =>
          prev.map((n) => (n.id === draggingNodeId ? { ...n, x: newX, y: newY } : n)),
        );
      }
    },
    [draggingNodeId, screenToSVG],
  );

  const handleOverlayMouseUp = useCallback(() => {
    if (draggingNodeId) {
      const node = nodes.find((n) => n.id === draggingNodeId);
      if (node) {
        sendToSwift(BridgeMessages.MOVE_NODE, { nodeId: draggingNodeId, x: node.x, y: node.y });
      }
      setDraggingNodeId(null);
    }
  }, [draggingNodeId, nodes]);

  // Handle slider interaction on overlay
  const handleSliderMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string, param: string, currentVal: number, min: number, max: number) => {
      e.stopPropagation();
      const startX = e.clientX;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const ratio = dx / 100;
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

  const handleLoadTemplate = useCallback((templateId: string) => {
    setSelectedNodeId(null);
    setConnectingFrom(null);
    setExportState({ status: 'idle', message: '' });
    setExportLogCopied(false);
    setSaveMessage('');
    sendToSwift(BridgeMessages.PLUGIN_LOAD_TEMPLATE, { templateId });
  }, []);

  const handlePreviewNote = useCallback(() => {
    sendToSwift(BridgeMessages.PLUGIN_PREVIEW_NOTE, { note: 60 });
  }, []);

  const handleSaveGraph = useCallback(() => {
    setSaveMessage('Saving graph...');
    sendToSwift(BridgeMessages.PLUGIN_SAVE_GRAPH, {});
  }, []);

  const handleAssignToTrack = useCallback(() => {
    if (!selectedTrackId) return;
    sendToSwift(BridgeMessages.PLUGIN_ASSIGN_TO_TRACK, { trackId: selectedTrackId });
    setSaveMessage('Saved and assigned to selected track');
  }, [selectedTrackId]);

  const handleLoadSavedGraph = useCallback((path: string) => {
    setSelectedNodeId(null);
    setConnectingFrom(null);
    setSaveMessage('');
    sendToSwift(BridgeMessages.PLUGIN_LOAD_SAVED, { path });
  }, []);

  // Handle export
  const handleExport = useCallback(() => {
    setExportLogCopied(false);
    setExportState({ status: 'compiling', message: 'Compiling node graph...' });
    sendToSwift(BridgeMessages.EXPORT_AUV3, {});
  }, []);

  const handleCopyExportLog = useCallback(async () => {
    if (!exportState.message) return;
    try {
      await navigator.clipboard.writeText(exportState.message);
      setExportLogCopied(true);
      window.setTimeout(() => setExportLogCopied(false), 1600);
    } catch {
      setExportLogCopied(false);
    }
  }, [exportState.message]);

  // Handle AI generate
  const handleAIGenerate = useCallback(() => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    sendToSwift(BridgeMessages.AI_GENERATE_PATCH, { description: aiPrompt.trim() });
  }, [aiPrompt]);

  // Remotion Player input props
  const inputProps = useMemo(() => ({
    nodes,
    connections,
    selectedNodeId,
    previewLevelL: previewLevels.left,
    previewLevelR: previewLevels.right,
    isPreviewPlaying: isPreviewing,
    validationErrors: validationErrors.map((e) => e.message),
  }), [nodes, connections, selectedNodeId, previewLevels, isPreviewing, validationErrors]);

  // Interactive overlay: connection-drawing bezier preview
  const connectingFromNode = connectingFrom ? nodes.find((n) => n.id === connectingFrom.nodeId) : null;
  const connectingBezier = useMemo(() => {
    if (!connectingFromNode || !connectingFrom) return null;
    const h = nodeHeight(connectingFromNode);
    const x1 = connectingFromNode.x + NODE_WIDTH;
    const y1 = connectingFromNode.y + h / 2;
    const x2 = mousePos.x;
    const y2 = mousePos.y;
    const dx = Math.abs(x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }, [connectingFromNode, connectingFrom, mousePos]);

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
        <div
          className="glass-panel"
          style={{
            padding: 8,
            marginBottom: 8,
            background: 'rgba(255,255,255,0.03)',
            borderColor: 'rgba(255,255,255,0.08)',
          }}
        >
          <div
            style={{
              fontSize: 8,
              color: 'var(--text-muted)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Quick Start
          </div>
          <div style={{ fontSize: 8, color: 'var(--text-dim)', lineHeight: 1.45, marginBottom: 8 }}>
            Start with a template, then tweak node params and connections. Export writes an AUv3 bundle to your Desktop.
          </div>
          <div className="flex flex-col gap-1">
            {STARTER_TEMPLATES.map((template) => (
              <button
                key={template.id}
                className="glass-panel glass-panel-hover text-left"
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  borderColor: 'rgba(255,255,255,0.08)',
                }}
                onClick={() => handleLoadTemplate(template.id)}
                title={template.description}
              >
                <div style={{ fontSize: 8.5, color: 'var(--text)', fontWeight: 600 }}>{template.label}</div>
                <div style={{ fontSize: 7.5, color: 'var(--text-muted)', marginTop: 1 }}>{template.description}</div>
              </button>
            ))}
          </div>
          {saveMessage && (
            <div style={{ fontSize: 7.5, color: 'var(--text-muted)', marginTop: 8 }}>
              {saveMessage}
            </div>
          )}
        </div>

        {savedGraphs.length > 0 && (
          <div
            className="glass-panel"
            style={{
              padding: 8,
              marginBottom: 8,
              background: 'rgba(255,255,255,0.03)',
              borderColor: 'rgba(255,255,255,0.08)',
            }}
          >
            <div
              style={{
                fontSize: 8,
                color: 'var(--text-muted)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              Saved Graphs
            </div>
            <div className="flex flex-col gap-1">
              {savedGraphs.slice(0, 6).map((graph) => (
                <button
                  key={graph.path}
                  className="glass-panel glass-panel-hover text-left"
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    borderColor: 'rgba(255,255,255,0.08)',
                  }}
                  onClick={() => handleLoadSavedGraph(graph.path)}
                  title={graph.description || graph.name}
                >
                  <div style={{ fontSize: 8.5, color: 'var(--text)', fontWeight: 600 }}>{graph.name}</div>
                  <div style={{ fontSize: 7.5, color: 'var(--text-muted)', marginTop: 1 }}>
                    {graph.category === 'instrument' ? 'Graph synth' : 'Effect graph'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

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

          {/* Preview toggle */}
          <button
            className="glass-button flex items-center gap-1.5 px-2 py-1"
            style={{
              background: isPreviewing ? 'rgba(248,113,113,0.15)' : 'rgba(52,211,153,0.15)',
              borderColor: isPreviewing ? 'rgba(248,113,113,0.3)' : 'rgba(52,211,153,0.3)',
            }}
            onClick={handlePreviewToggle}
            title="The current preview meters the graph state. It is not a full audible audition path yet."
          >
            {isPreviewing ? (
              <Square size={10} style={{ color: '#f87171' }} />
            ) : (
              <Play size={12} style={{ color: aurora.green }} />
            )}
            <span style={{ fontSize: 8, color: isPreviewing ? '#f87171' : aurora.green }}>
              {isPreviewing ? 'Stop Meter' : 'Meter Preview'}
            </span>
          </button>

          <button
            className="glass-button flex items-center gap-1.5 px-2 py-1"
            style={{
              background: 'rgba(255,255,255,0.08)',
              borderColor: 'rgba(255,255,255,0.12)',
              color: 'var(--text)',
            }}
            onClick={handlePreviewNote}
          >
            <Play size={10} />
            <span style={{ fontSize: 8 }}>Audition C3</span>
          </button>

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
              background: 'rgba(255,255,255,0.08)',
              borderColor: 'rgba(255,255,255,0.12)',
              color: 'var(--text)',
            }}
            onClick={handleSaveGraph}
          >
            <Download size={10} />
            <span style={{ fontSize: 8 }}>Save Synth</span>
          </button>

          {selectedTrackId && (
            <button
              className="glass-button flex items-center gap-1.5 px-2 py-1"
              style={{
                background: 'rgba(216,219,225,0.12)',
                borderColor: 'rgba(216,219,225,0.18)',
                color: 'var(--text)',
              }}
              onClick={handleAssignToTrack}
            >
              <CheckCircle size={10} />
              <span style={{ fontSize: 8 }}>Use On Selected Track</span>
            </button>
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
            style={{
              background: 'rgba(0,0,0,0.22)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div
              className="flex items-center justify-between gap-2 px-3 py-1"
              style={{
                fontSize: 8,
                fontFamily: 'var(--font-mono)',
                color: exportState.status === 'error' ? '#f87171' :
                       exportState.status === 'done' ? aurora.green :
                       aurora.gold,
              }}
            >
              <span>
                {exportState.status === 'error' ? 'Export failed. Full log below.' : exportState.message.split('\n')[0]}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  className="glass-button px-2 py-1"
                  style={{ fontSize: 8 }}
                  onClick={handleCopyExportLog}
                >
                  {exportLogCopied ? 'Copied' : 'Copy Log'}
                </button>
                {exportState.logPath && (
                  <span style={{ color: 'var(--text-muted)' }}>{exportState.logPath}</span>
                )}
              </div>
            </div>
            <textarea
              readOnly
              value={exportState.message}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: exportState.status === 'error' ? 140 : 64,
                maxHeight: 220,
                resize: 'vertical',
                overflow: 'auto',
                padding: '8px 12px',
                background: 'rgba(0,0,0,0.38)',
                color: exportState.status === 'error' ? '#fca5a5' : 'var(--text)',
                border: 'none',
                outline: 'none',
                borderTop: '1px solid rgba(255,255,255,0.05)',
                fontSize: 8,
                lineHeight: 1.45,
                fontFamily: 'var(--font-mono)',
                userSelect: 'text',
                WebkitUserSelect: 'text',
              }}
            />
          </div>
        )}

        <div
          className="px-3 py-1.5"
          style={{
            fontSize: 8,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            background: 'rgba(255,255,255,0.02)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          Use a starter graph or AI prompt first. `Audition C3` plays the current graph internally, `Save Synth` stores it for reuse, and `Use On Selected Track` pushes it into Arrange.
        </div>

        {/* Remotion Player + Interactive Overlay */}
        <div
          ref={canvasRef}
          className="flex-1 relative"
          style={{ overflow: 'hidden', background: '#080e18' }}
        >
          {/* Remotion Player -- cinematic node graph visualization */}
          <Player
            component={LiveNodeGraph}
            inputProps={inputProps}
            durationInFrames={9000}
            fps={30}
            compositionWidth={1200}
            compositionHeight={700}
            loop
            autoPlay
            controls={false}
            style={{
              width: '100%',
              height: '100%',
            }}
          />

          {/* Transparent interactive overlay for mouse events */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              cursor: draggingNodeId ? 'grabbing' : connectingFrom ? 'crosshair' : 'default',
            }}
            onMouseDown={handleOverlayMouseDown}
            onMouseMove={handleOverlayMouseMove}
            onMouseUp={handleOverlayMouseUp}
          >
            {/* Connection-drawing preview line (SVG overlay) */}
            {connectingBezier && (
              <svg
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                viewBox="0 0 1200 700"
                preserveAspectRatio="none"
              >
                <path
                  d={connectingBezier}
                  fill="none"
                  stroke={aurora.cyan}
                  strokeWidth={2}
                  strokeDasharray="8 5"
                  opacity={0.6}
                />
              </svg>
            )}

            {/* Invisible hit targets for sliders on nodes */}
            {nodes.map((node) => {
              const h = nodeHeight(node);
              const paramKeys = Object.keys(node.params);
              const el = canvasRef.current;
              if (!el) return null;
              const rect = el.getBoundingClientRect();
              const sx = rect.width / 1200;
              const sy = rect.height / 700;

              return paramKeys.map((param, pi) => {
                const val = node.params[param];
                const isLargeRange = val > 1 || param === 'frequency' || param === 'cutoff';
                const min = 0;
                const max = isLargeRange ? 20000 : 1;
                const py = node.y + 34 + pi * PARAM_ROW_H;

                return (
                  <div
                    key={`slider-${node.id}-${param}`}
                    style={{
                      position: 'absolute',
                      left: (node.x + 80) * sx,
                      top: (py + 3) * sy,
                      width: 90 * sx,
                      height: 10 * sy,
                      cursor: 'ew-resize',
                    }}
                    onMouseDown={(e) => handleSliderMouseDown(e, node.id, param, val, min, max)}
                  />
                );
              });
            })}

            {/* Delete button hit targets */}
            {nodes.map((node) => {
              if (node.type === 'output') return null;
              const el = canvasRef.current;
              if (!el) return null;
              const rect = el.getBoundingClientRect();
              const sx = rect.width / 1200;
              const sy = rect.height / 700;

              return (
                <div
                  key={`del-${node.id}`}
                  style={{
                    position: 'absolute',
                    left: (node.x + NODE_WIDTH - 20) * sx,
                    top: (node.y + 4) * sy,
                    width: 16 * sx,
                    height: 16 * sy,
                    cursor: 'pointer',
                    borderRadius: '50%',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveNode(node.id);
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
