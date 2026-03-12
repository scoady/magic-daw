import React, { useState } from 'react';
import type { TheorySubView } from '../types/daw';
import { CircleOfFifthsPanel } from './CircleOfFifthsPanel';
import { ChordBuilderPanel } from './ChordBuilderPanel';
import { IntervalTrainerPanel } from './IntervalTrainerPanel';
import { PianoHeroPanel } from './PianoHeroPanel';
import { TonnetzPanel } from './TonnetzPanel';
import { EmotionsPanel } from './EmotionsPanel';
import { HarmonicLabPanel } from './HarmonicLabPanel';

const SUB_VIEWS: { id: TheorySubView; label: string; icon: string; description: string }[] = [
  { id: 'circle', label: 'Circle of Fifths', icon: '◉', description: 'Explore keys, chords & harmony' },
  { id: 'chord-builder', label: 'Chord Builder', icon: '⚡', description: 'Build chord progressions with the harmonic pathfinder' },
  { id: 'drills', label: 'Drills', icon: '♫', description: 'Daily practice drills — intervals, scales & chords' },
  { id: 'piano-hero', label: 'Piano Hero', icon: '🎹', description: 'Guitar Hero-style note waterfall — learn songs by playing along' },
  { id: 'tonnetz', label: 'Tonnetz', icon: '⬡', description: 'Harmonic lattice & neo-Riemannian path builder' },
  { id: 'emotions', label: 'Emotions', icon: '✦', description: 'Cinematic story of music & emotion' },
  { id: 'harmonic-lab', label: 'AI Compose', icon: '✦', description: 'AI-powered harmonic composition' },
];

export const TheoryPanel: React.FC = () => {
  const [activeSubView, setActiveSubView] = useState<TheorySubView>('circle');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Sub-navigation bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '4px 10px',
        background: 'rgba(8, 14, 24, 0.7)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        {SUB_VIEWS.map((sv) => {
          const isActive = activeSubView === sv.id;
          return (
            <button
              key={sv.id}
              className="glass-button"
              onClick={() => setActiveSubView(sv.id)}
              title={sv.description}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 14px',
                background: isActive ? 'rgba(103,232,249,0.08)' : 'transparent',
                border: isActive ? '1px solid rgba(103,232,249,0.2)' : '1px solid transparent',
                borderRadius: 4,
                color: isActive ? 'var(--cyan)' : 'var(--text-dim)',
                fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ fontSize: 12, opacity: isActive ? 1 : 0.5 }}>{sv.icon}</span>
              {sv.label}
            </button>
          );
        })}
        <span style={{
          marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 9,
          fontFamily: 'var(--font-mono)', opacity: 0.5,
        }}>
          {SUB_VIEWS.find(sv => sv.id === activeSubView)?.description}
        </span>
      </div>

      {/* Active sub-view */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeSubView === 'circle' && <CircleOfFifthsPanel />}
        {activeSubView === 'chord-builder' && <ChordBuilderPanel />}
        {activeSubView === 'drills' && <IntervalTrainerPanel />}
        {activeSubView === 'piano-hero' && <PianoHeroPanel />}
        {activeSubView === 'tonnetz' && <TonnetzPanel />}
        {activeSubView === 'emotions' && <EmotionsPanel />}
        {activeSubView === 'harmonic-lab' && <HarmonicLabPanel />}
      </div>
    </div>
  );
};

export default TheoryPanel;
