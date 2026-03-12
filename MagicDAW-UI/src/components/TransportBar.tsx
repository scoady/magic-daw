import React, { useEffect, useRef, useState } from 'react';
import {
  Rewind,
  Square,
  Play,
  Circle,
  Pause,
  Repeat,
  Music,
  Timer,
  ChevronDown,
  FolderOpen,
  FilePlus2,
  Save,
  SaveAll,
} from 'lucide-react';
import { VUMeter } from './VUMeter';

interface TransportBarProps {
  bpm: number;
  onBpmChange?: (bpm: number) => void;
  keySignature: { key: string; scale: string; confidence: number };
  timeSignature: [number, number];
  playing: boolean;
  recording: boolean;
  position: { bar: number; beat: number; timeMs: number };
  masterLevelL: number;
  masterLevelR: number;
  midiInputActive: boolean;
  ollamaConnected: boolean;
  metronomeEnabled?: boolean;
  loopEnabled?: boolean;
  loopStart?: number;
  loopEnd?: number;
  countInEnabled?: boolean;
  onPlay?: () => void;
  onStop?: () => void;
  onRecord?: () => void;
  onRewind?: () => void;
  onMetronomeToggle?: (enabled: boolean) => void;
  onLoopToggle?: (enabled: boolean) => void;
  onLoopRegionChange?: (startBar: number, endBar: number) => void;
  onCountInToggle?: (enabled: boolean) => void;
  projectDirty?: boolean;
  projectName?: string;
  onNewProject?: () => void;
  onOpenProject?: () => void;
  onSaveProject?: () => void;
  onSaveProjectAs?: () => void;
}

export const TransportBar: React.FC<TransportBarProps> = ({
  bpm,
  onBpmChange,
  keySignature,
  timeSignature,
  playing,
  recording,
  position,
  masterLevelL,
  masterLevelR,
  midiInputActive,
  ollamaConnected,
  metronomeEnabled = false,
  loopEnabled = false,
  loopStart = 1,
  loopEnd = 5,
  countInEnabled = false,
  onPlay,
  onStop,
  onRecord,
  onRewind,
  onMetronomeToggle,
  onLoopToggle,
  onLoopRegionChange,
  onCountInToggle,
  projectDirty = false,
  projectName = 'Untitled',
  onNewProject,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
}) => {
  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmInput, setBpmInput] = useState(String(bpm));
  const [editingLoop, setEditingLoop] = useState(false);
  const [loopStartInput, setLoopStartInput] = useState(String(loopStart));
  const [loopEndInput, setLoopEndInput] = useState(String(loopEnd));
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(event.target as Node)) {
        setProjectMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const msRem = Math.floor(ms % 1000);
    return `${m}:${String(sec).padStart(2, '0')}.${String(msRem).padStart(3, '0')}`;
  };

  const handleBpmSubmit = () => {
    const val = parseInt(bpmInput);
    if (val >= 20 && val <= 300) {
      onBpmChange?.(val);
    }
    setEditingBpm(false);
  };

  const handleLoopSubmit = () => {
    const start = parseInt(loopStartInput);
    const end = parseInt(loopEndInput);
    if (start >= 1 && end > start) {
      onLoopRegionChange?.(start - 1, end - 1); // convert to 0-indexed bars
    }
    setEditingLoop(false);
  };

  const toggleBtnStyle = (active: boolean) => ({
    width: 28,
    height: 28,
    ...(active
      ? {
          background: 'rgba(141, 212, 180, 0.14)',
          borderColor: 'rgba(141, 212, 180, 0.34)',
          boxShadow: 'none',
        }
      : {}),
  });

  const projectMenuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    width: '100%',
    padding: '9px 10px',
    borderRadius: 10,
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--text)',
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    cursor: 'pointer',
    textAlign: 'left',
  };

  const hasDetectedKey = keySignature.key.trim().length > 0;

  return (
    <div className="transport-bar flex items-center px-4 gap-4 select-none relative">
      {/* Logo + project menu */}
      <div className="flex items-center gap-2 mr-2">
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            color: 'var(--text)',
            letterSpacing: '0.05em',
          }}
        >
          Magic DAW
        </span>
        <div ref={projectMenuRef} className="relative">
          <button
            className="glass-button flex items-center gap-2"
            style={{
              minWidth: 152,
              height: 28,
              padding: '0 10px',
              borderRadius: 12,
              background: projectMenuOpen ? 'rgba(255,255,255,0.06)' : undefined,
            }}
            onClick={() => setProjectMenuOpen((open) => !open)}
            title="Project"
          >
            <span
              style={{
                fontSize: 11,
                color: 'var(--text)',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 120,
              }}
            >
              {projectName || 'Untitled'}
            </span>
            {projectDirty && (
              <div
                title="Unsaved changes"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--warning)',
                  boxShadow: '0 0 8px rgba(214, 190, 138, 0.28)',
                  flexShrink: 0,
                }}
              />
            )}
            <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} />
          </button>
          {projectMenuOpen && (
            <div
              className="glass-panel"
              style={{
                position: 'absolute',
                top: 34,
                left: 0,
                width: 220,
                padding: 8,
                borderRadius: 14,
                zIndex: 30,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                background: 'rgba(8, 11, 15, 0.94)',
                border: '1px solid rgba(255,255,255,0.10)',
                boxShadow: '0 18px 42px rgba(0,0,0,0.42)',
              }}
            >
              <div
                style={{
                  padding: '2px 4px 8px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  marginBottom: 4,
                }}
              >
                <div style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Project
                </div>
                <div style={{ fontSize: 13, color: 'var(--text)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                  {projectName || 'Untitled'}
                </div>
              </div>
              {[
                { label: 'New Project', hint: 'Cmd+N', icon: <FilePlus2 size={13} />, action: onNewProject },
                { label: 'Open Project...', hint: 'Cmd+O', icon: <FolderOpen size={13} />, action: onOpenProject },
                { label: 'Save', hint: 'Cmd+S', icon: <Save size={13} />, action: onSaveProject },
                { label: 'Save As...', hint: 'Shift+Cmd+S', icon: <SaveAll size={13} />, action: onSaveProjectAs },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    setProjectMenuOpen(false);
                    item.action?.();
                  }}
                  style={projectMenuItemStyle}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                    event.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'transparent';
                    event.currentTarget.style.borderColor = 'transparent';
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span style={{ color: 'var(--text-muted)' }}>{item.icon}</span>
                    <span>{item.label}</span>
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{item.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 28, background: 'var(--border)' }} />

      {/* BPM */}
      <div className="flex items-center gap-1.5">
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>BPM</span>
        {editingBpm ? (
          <input
            type="number"
            value={bpmInput}
            onChange={(e) => setBpmInput(e.target.value)}
            onBlur={handleBpmSubmit}
            onKeyDown={(e) => e.key === 'Enter' && handleBpmSubmit()}
            autoFocus
            className="text-center rounded"
            style={{
              width: 44,
              height: 22,
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid var(--accent-border)',
              color: 'var(--text)',
              fontFamily: 'var(--font-mono)',
              fontSize: 14,
              fontWeight: 700,
              outline: 'none',
            }}
          />
        ) : (
          <span
            onClick={() => {
              setEditingBpm(true);
              setBpmInput(String(bpm));
            }}
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--warning)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {bpm}
          </span>
        )}
      </div>

      {/* Key Signature */}
      <div
        className="glass-panel flex items-center gap-1.5 px-2 py-1"
        style={{ borderRadius: 20 }}
      >
        {hasDetectedKey ? (
          <>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
              {keySignature.key}
            </span>
            <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
              {keySignature.scale}
            </span>
            <span
              style={{
                fontSize: 8,
                color: keySignature.confidence > 0.8 ? 'var(--success)' : 'var(--warning)',
                opacity: 0.8,
              }}
            >
              {Math.round(keySignature.confidence * 100)}%
            </span>
          </>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            No key
          </span>
        )}
      </div>

      {/* Time Signature */}
      <div
        className="glass-panel px-2 py-0.5"
        style={{ borderRadius: 12, fontSize: 11, color: 'var(--text-dim)' }}
      >
        {timeSignature[0]}/{timeSignature[1]}
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 28, background: 'var(--border)' }} />

      {/* Transport Controls */}
      <div className="flex items-center gap-1">
        <button
          className="glass-button flex items-center justify-center"
          style={{ width: 32, height: 28 }}
          onClick={onRewind}
        >
          <Rewind size={14} />
        </button>
        <button
          className="glass-button flex items-center justify-center"
          style={{ width: 32, height: 28 }}
          onClick={onStop}
        >
          <Square size={12} />
        </button>
        <button
          className={`glass-button flex items-center justify-center ${playing ? 'active' : ''}`}
          style={{
            width: 36,
            height: 28,
            ...(playing
              ? {
                  background: 'rgba(52, 211, 153, 0.15)',
                  borderColor: 'rgba(52, 211, 153, 0.4)',
                  boxShadow: 'none',
                }
              : {}),
          }}
          onClick={onPlay}
        >
          {playing ? (
            <Pause size={14} style={{ color: 'var(--success)' }} />
          ) : (
            <Play size={14} style={{ color: 'var(--success)' }} />
          )}
        </button>
        <button
          className="glass-button flex items-center justify-center"
          style={{
            width: 32,
            height: 28,
            ...(recording
              ? {
                  background: 'rgba(239, 68, 68, 0.2)',
                  borderColor: 'rgba(239, 68, 68, 0.5)',
                }
              : {}),
          }}
          onClick={onRecord}
        >
          <Circle
            size={12}
            fill={recording ? '#ef4444' : 'transparent'}
            style={{
              color: recording ? '#ef4444' : 'var(--text-dim)',
            }}
            className={recording ? 'animate-pulse-glow' : ''}
          />
        </button>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 28, background: 'var(--border)' }} />

      {/* Metronome Toggle */}
      <button
        className="glass-button flex items-center justify-center"
        style={toggleBtnStyle(metronomeEnabled)}
        onClick={() => onMetronomeToggle?.(!metronomeEnabled)}
        title="Metronome"
      >
        <Music
          size={12}
          style={{ color: metronomeEnabled ? 'var(--success)' : 'var(--text-dim)' }}
        />
      </button>

      {/* Count-in Toggle */}
      <button
        className="glass-button flex items-center justify-center"
        style={toggleBtnStyle(countInEnabled)}
        onClick={() => onCountInToggle?.(!countInEnabled)}
        title="Count-in (1 bar)"
      >
        <Timer
          size={12}
          style={{ color: countInEnabled ? 'var(--success)' : 'var(--text-dim)' }}
        />
      </button>

      {/* Loop Toggle + Region */}
      <div className="flex items-center gap-1">
        <button
          className="glass-button flex items-center justify-center"
          style={toggleBtnStyle(loopEnabled)}
          onClick={() => onLoopToggle?.(!loopEnabled)}
          title="Loop"
        >
          <Repeat
            size={12}
            style={{ color: loopEnabled ? 'var(--success)' : 'var(--text-dim)' }}
          />
        </button>
        {loopEnabled && (
          editingLoop ? (
            <div className="flex items-center gap-1" style={{ fontSize: 10 }}>
              <input
                type="number"
                value={loopStartInput}
                onChange={(e) => setLoopStartInput(e.target.value)}
                className="text-center rounded"
                style={{
                  width: 28,
                  height: 20,
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid var(--accent-border)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  outline: 'none',
                }}
              />
              <span style={{ color: 'var(--text-muted)' }}>-</span>
              <input
                type="number"
                value={loopEndInput}
                onChange={(e) => setLoopEndInput(e.target.value)}
                onBlur={handleLoopSubmit}
                onKeyDown={(e) => e.key === 'Enter' && handleLoopSubmit()}
                className="text-center rounded"
                style={{
                  width: 28,
                  height: 20,
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid var(--accent-border)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  outline: 'none',
                }}
              />
            </div>
          ) : (
            <span
              onClick={() => {
                setEditingLoop(true);
                setLoopStartInput(String(Math.round(loopStart) + 1));
                setLoopEndInput(String(Math.round(loopEnd) + 1));
              }}
              style={{
                fontSize: 10,
                color: 'var(--text)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {Math.round(loopStart) + 1}-{Math.round(loopEnd) + 1}
            </span>
          )
        )}
      </div>

      {/* Position Display */}
      <div
        className="glass-panel px-3 py-1 flex items-center gap-2"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
      >
        <span style={{ color: 'var(--text-dim)' }}>Bar</span>
        <span style={{ color: 'var(--text)', fontWeight: 700, minWidth: 20, textAlign: 'right' }}>
          {position.bar}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span style={{ color: 'var(--text-dim)' }}>Beat</span>
        <span style={{ color: 'var(--text)', fontWeight: 700, minWidth: 12, textAlign: 'right' }}>
          {position.beat}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span style={{ color: 'var(--text-dim)', minWidth: 64, textAlign: 'right' }}>
          {formatTime(position.timeMs)}
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Master Level Meters */}
      <div className="flex items-center gap-1">
        <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>L</span>
        <VUMeter level={masterLevelL} height={6} width={80} orientation="horizontal" />
      </div>
      <div className="flex items-center gap-1">
        <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>R</span>
        <VUMeter level={masterLevelR} height={6} width={80} orientation="horizontal" />
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 28, background: 'var(--border)' }} />

      {/* MIDI IN indicator */}
      <div className="flex items-center gap-1.5">
        <div
          className={midiInputActive ? 'animate-dot-pulse' : ''}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: midiInputActive ? 'var(--success)' : 'var(--text-muted)',
            boxShadow: midiInputActive ? '0 0 8px rgba(141, 212, 180, 0.35)' : 'none',
          }}
        />
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>MIDI</span>
      </div>

      {/* Ollama Status */}
      <div className="flex items-center gap-1.5">
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: ollamaConnected ? 'var(--success)' : 'var(--danger)',
            boxShadow: ollamaConnected
              ? '0 0 8px rgba(141, 212, 180, 0.35)'
              : '0 0 8px rgba(239,68,68,0.5)',
          }}
        />
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>AI</span>
      </div>
    </div>
  );
};
