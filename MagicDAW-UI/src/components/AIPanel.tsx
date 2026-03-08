import React, { useState } from 'react';
import { Sparkles, Check, Send } from 'lucide-react';
import { GlassPanel } from './GlassPanel';
import { aurora, mockChordSuggestions, mockProgression } from '../mockData';

export const AIPanel: React.FC = () => {
  const [query, setQuery] = useState('');
  const currentChord = 'Em9';

  return (
    <div className="flex gap-3 h-full">
      {/* Current Chord Display */}
      <div className="flex flex-col items-center justify-center gap-1" style={{ minWidth: 100 }}>
        <span style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Current
        </span>
        <span
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: aurora.cyan,
            fontFamily: 'var(--font-display)',
          }}
          className="text-glow-cyan"
        >
          {currentChord}
        </span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>minor ninth</span>

        {/* Mini progression */}
        <div className="flex gap-1 mt-1 flex-wrap justify-center">
          {mockProgression.map((chord, i) => (
            <span
              key={i}
              className="glass-panel px-1.5 py-0.5"
              style={{
                fontSize: 7,
                borderRadius: 8,
                color: chord === currentChord ? aurora.cyan : 'var(--text-dim)',
                borderColor: chord === currentChord ? 'rgba(103, 232, 249, 0.3)' : 'var(--border)',
                background: chord === currentChord ? 'rgba(103, 232, 249, 0.1)' : 'var(--surface)',
              }}
            >
              {chord}
            </span>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: 1, background: 'var(--border)' }} />

      {/* Suggested Chords */}
      <div className="flex flex-col gap-1 flex-1">
        <span
          style={{
            fontSize: 8,
            color: 'var(--text-muted)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          Suggested Next
        </span>
        <div className="flex flex-wrap gap-1.5">
          {mockChordSuggestions.map((suggestion, i) => (
            <GlassPanel
              key={i}
              className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer glass-panel-hover"
              style={{ borderRadius: 8 }}
              glow={i === 0 ? aurora.teal : undefined}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: i === 0 ? aurora.teal : aurora.text,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {suggestion.chord}
              </span>
              {/* Probability bar */}
              <div style={{ width: 40, height: 3, background: 'rgba(0,0,0,0.3)', borderRadius: 2 }}>
                <div
                  style={{
                    width: `${suggestion.probability * 100}%`,
                    height: '100%',
                    borderRadius: 2,
                    background: `linear-gradient(to right, ${aurora.teal}, ${aurora.cyan})`,
                    opacity: 0.7,
                  }}
                />
              </div>
              <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>
                {Math.round(suggestion.probability * 100)}%
              </span>
              <button
                className="flex items-center justify-center rounded"
                style={{
                  width: 16,
                  height: 16,
                  background: 'rgba(45, 212, 191, 0.15)',
                  border: '1px solid rgba(45, 212, 191, 0.3)',
                  cursor: 'pointer',
                  color: aurora.teal,
                }}
              >
                <Check size={8} />
              </button>
            </GlassPanel>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: 1, background: 'var(--border)' }} />

      {/* Natural Language Input */}
      <div className="flex flex-col gap-1.5" style={{ minWidth: 200 }}>
        <span
          style={{
            fontSize: 8,
            color: 'var(--text-muted)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          <Sparkles size={9} style={{ display: 'inline', marginRight: 4 }} />
          Ask AI
        </span>
        <div className="flex gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suggest a jazz chord progression..."
            className="flex-1 rounded px-2 py-1"
            style={{
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontSize: 9,
              fontFamily: 'var(--font-mono)',
              outline: 'none',
            }}
          />
          <button
            className="glass-button flex items-center justify-center"
            style={{ width: 28, height: 24, borderRadius: 4 }}
          >
            <Send size={10} />
          </button>
        </div>

        {/* Scale suggestions */}
        <div className="flex flex-col gap-1">
          <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>Scales</span>
          <div className="flex gap-1 flex-wrap">
            {['E Dorian', 'G Major', 'E Blues', 'E Phrygian'].map((scale) => (
              <span
                key={scale}
                className="glass-panel px-2 py-0.5 cursor-pointer glass-panel-hover"
                style={{ fontSize: 8, borderRadius: 6, color: 'var(--text-dim)' }}
              >
                {scale}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
