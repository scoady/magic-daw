import React, { useState } from 'react';
import type { SoundDesignSubView } from '../types/daw';
import { InstrumentView } from './InstrumentView';
import { PluginView } from './PluginView';

interface SoundDesignViewProps {
  selectedTrackId: string | null;
}

const SUB_VIEWS: { id: SoundDesignSubView; label: string }[] = [
  { id: 'browser', label: 'Instrument Browser' },
  { id: 'plugin-builder', label: 'Plugin Builder' },
];

export const SoundDesignView: React.FC<SoundDesignViewProps> = ({ selectedTrackId }) => {
  const [subView, setSubView] = useState<SoundDesignSubView>('browser');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sub-navigation bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          height: 32,
          minHeight: 32,
          padding: '0 8px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated, rgba(255,255,255,0.02))',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
        }}
      >
        {SUB_VIEWS.map((sv) => (
          <button
            key={sv.id}
            className="glass-button"
            onClick={() => setSubView(sv.id)}
            style={{
              color: subView === sv.id ? 'var(--text)' : 'var(--text-dim)',
              background: subView === sv.id ? 'rgba(255,255,255,0.06)' : 'transparent',
              border: 'none',
              padding: '4px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              transition: 'color 0.15s, background 0.15s',
            }}
          >
            {sv.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {subView === 'browser' && <InstrumentView selectedTrackId={selectedTrackId} />}
        {subView === 'plugin-builder' && <PluginView selectedTrackId={selectedTrackId} />}
      </div>
    </div>
  );
};
