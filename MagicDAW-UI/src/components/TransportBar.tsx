import React, { useState } from 'react';
import {
  Rewind,
  Square,
  Play,
  Circle,
  Pause,
  Repeat,
  Music,
  Timer,
} from 'lucide-react';
import { VUMeter } from './VUMeter';
import { aurora } from '../mockData';

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
}) => {
  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmInput, setBpmInput] = useState(String(bpm));
  const [editingLoop, setEditingLoop] = useState(false);
  const [loopStartInput, setLoopStartInput] = useState(String(loopStart));
  const [loopEndInput, setLoopEndInput] = useState(String(loopEnd));

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
          background: 'rgba(52, 211, 153, 0.15)',
          borderColor: 'rgba(52, 211, 153, 0.4)',
          boxShadow: '0 0 10px rgba(52, 211, 153, 0.15)',
        }
      : {}),
  });

  return (
    <div className="transport-bar flex items-center px-4 gap-4 select-none">
      {/* Logo + unsaved indicator */}
      <div className="flex items-center gap-2 mr-2">
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            color: aurora.cyan,
            letterSpacing: '0.05em',
          }}
          className="text-glow-cyan"
        >
          Magic DAW
        </span>
        {projectDirty && (
          <div
            title="Unsaved changes"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: aurora.gold,
              boxShadow: `0 0 8px ${aurora.gold}`,
              flexShrink: 0,
              animation: 'pulse 2s ease-in-out infinite',
            }}
          />
        )}
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
              border: '1px solid var(--cyan)',
              color: 'var(--cyan)',
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
              color: aurora.gold,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
            className="text-glow-teal"
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
        <span style={{ fontSize: 12, fontWeight: 700, color: aurora.cyan }}>
          {keySignature.key}
        </span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
          {keySignature.scale}
        </span>
        <span
          style={{
            fontSize: 8,
            color: keySignature.confidence > 0.8 ? aurora.green : aurora.gold,
            opacity: 0.8,
          }}
        >
          {Math.round(keySignature.confidence * 100)}%
        </span>
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
                  boxShadow: '0 0 16px rgba(52, 211, 153, 0.2)',
                }
              : {}),
          }}
          onClick={onPlay}
        >
          {playing ? (
            <Pause size={14} style={{ color: aurora.green }} />
          ) : (
            <Play size={14} style={{ color: aurora.green }} />
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
          style={{ color: metronomeEnabled ? aurora.green : 'var(--text-dim)' }}
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
          style={{ color: countInEnabled ? aurora.green : 'var(--text-dim)' }}
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
            style={{ color: loopEnabled ? aurora.green : 'var(--text-dim)' }}
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
                  border: '1px solid var(--cyan)',
                  color: 'var(--cyan)',
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
                  border: '1px solid var(--cyan)',
                  color: 'var(--cyan)',
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
                color: aurora.cyan,
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
        <span style={{ color: aurora.text, fontWeight: 700, minWidth: 20, textAlign: 'right' }}>
          {position.bar}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span style={{ color: 'var(--text-dim)' }}>Beat</span>
        <span style={{ color: aurora.text, fontWeight: 700, minWidth: 12, textAlign: 'right' }}>
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
            background: midiInputActive ? aurora.teal : 'var(--text-muted)',
            boxShadow: midiInputActive ? `0 0 8px ${aurora.teal}` : 'none',
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
            background: ollamaConnected ? aurora.green : '#ef4444',
            boxShadow: ollamaConnected
              ? `0 0 8px ${aurora.green}`
              : '0 0 8px rgba(239,68,68,0.5)',
          }}
        />
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>AI</span>
      </div>
    </div>
  );
};
