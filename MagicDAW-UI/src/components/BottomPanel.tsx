import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles, Settings, Terminal } from 'lucide-react';
import { AIPanel } from './AIPanel';
import { aurora } from '../mockData';

interface BottomPanelProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

type Tab = 'ai' | 'properties' | 'console';

export const BottomPanel: React.FC<BottomPanelProps> = ({
  collapsed = false,
  onToggle,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('ai');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'ai', label: 'AI Suggestions', icon: <Sparkles size={11} /> },
    { id: 'properties', label: 'Properties', icon: <Settings size={11} /> },
    { id: 'console', label: 'Console', icon: <Terminal size={11} /> },
  ];

  return (
    <div
      className="bottom-panel flex flex-col"
      style={{
        height: collapsed ? 28 : 200,
        transition: 'height 0.3s ease',
        overflow: 'hidden',
      }}
    >
      {/* Tab bar */}
      <div
        className="flex items-center gap-0 px-2 shrink-0"
        style={{ height: 28, borderBottom: '1px solid var(--border)' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`view-tab flex items-center gap-1.5 ${
              activeTab === tab.id ? 'active' : ''
            }`}
            style={{
              height: 28,
              fontSize: 9,
              padding: '0 12px',
              borderBottom: activeTab === tab.id ? '2px solid var(--cyan)' : '2px solid transparent',
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}

        <div className="flex-1" />

        <button
          className="glass-button flex items-center justify-center"
          style={{ width: 20, height: 18, borderRadius: 3 }}
          onClick={onToggle}
        >
          {collapsed ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-2">
        {activeTab === 'ai' && <AIPanel />}

        {activeTab === 'properties' && (
          <div className="flex flex-col gap-2 p-2">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 60 }}>Name:</span>
              <span style={{ fontSize: 10, color: 'var(--text)' }}>Hook</span>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 60 }}>Track:</span>
              <span style={{ fontSize: 10, color: aurora.cyan }}>Lead</span>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 60 }}>Position:</span>
              <span style={{ fontSize: 10, color: 'var(--text)' }}>Bar 17 - 25</span>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 60 }}>Notes:</span>
              <span style={{ fontSize: 10, color: 'var(--text)' }}>24</span>
            </div>
          </div>
        )}

        {activeTab === 'console' && (
          <div className="flex flex-col gap-0.5 p-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            {[
              { time: '00:01.234', msg: 'MIDI device connected: Arturia KeyLab', color: aurora.green },
              { time: '00:01.456', msg: 'Ollama connection established (llama3.2)', color: aurora.green },
              { time: '00:02.100', msg: 'Project loaded: Aurora Session', color: aurora.cyan },
              { time: '00:03.800', msg: 'Key detection: Em (87% confidence)', color: aurora.teal },
              { time: '00:05.200', msg: 'Audio engine initialized: 48kHz / 256 samples', color: 'var(--text-dim)' },
              { time: '00:08.100', msg: 'AI: Chord progression analysis complete', color: aurora.purple },
            ].map((log, i) => (
              <div key={i} className="flex gap-2" style={{ opacity: 0.8 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 64 }}>{log.time}</span>
                <span style={{ color: log.color }}>{log.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
