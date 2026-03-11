import React, { useState } from 'react';
import type { LearnSubView } from '../types/daw';
import { IntervalTrainerPanel } from './IntervalTrainerPanel';
import { CircleOfFifthsPanel } from './CircleOfFifthsPanel';
import { TonnetzPanel } from './TonnetzPanel';
import { PianoHeroPanel } from './PianoHeroPanel';

const SUB_VIEWS: { id: LearnSubView; label: string; icon: string; description: string }[] = [
  { id: 'circle', label: 'Circle of Fifths', icon: '◉', description: 'Explore keys, chords & harmony' },
  { id: 'intervals', label: 'Drills', icon: '♫', description: 'Daily practice drills — intervals, scales & chords' },
  { id: 'piano-hero', label: 'Piano Hero', icon: '🎹', description: 'Guitar Hero-style note waterfall — learn songs by playing along' },
  { id: 'tonnetz', label: 'Tonnetz', icon: '⬡', description: 'Harmonic lattice & path builder' },
];

export const LearnPanel: React.FC = () => {
  const [activeSubView, setActiveSubView] = useState<LearnSubView>('circle');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Sub-navigation bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '4px 10px',
        background: 'rgba(8, 14, 24, 0.7)',
        borderBottom: '1px solid rgba(120,200,220,0.08)',
        flexShrink: 0,
      }}>
        {SUB_VIEWS.map((sv) => {
          const isActive = activeSubView === sv.id;
          return (
            <button
              key={sv.id}
              onClick={() => setActiveSubView(sv.id)}
              title={sv.description}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 14px',
                background: isActive ? 'rgba(103,232,249,0.08)' : 'transparent',
                border: isActive ? '1px solid rgba(103,232,249,0.2)' : '1px solid transparent',
                borderRadius: 4,
                color: isActive ? '#67e8f9' : '#94a3b8',
                fontSize: 11, fontFamily: 'monospace', fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ fontSize: 13, opacity: isActive ? 1 : 0.5 }}>{sv.icon}</span>
              {sv.label}
            </button>
          );
        })}
        <span style={{
          marginLeft: 'auto', color: '#94a3b8', fontSize: 9,
          fontFamily: 'monospace', opacity: 0.4,
        }}>
          {SUB_VIEWS.find(sv => sv.id === activeSubView)?.description}
        </span>
      </div>

      {/* Active sub-view */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeSubView === 'circle' && <CircleOfFifthsPanel />}
        {activeSubView === 'intervals' && <IntervalTrainerPanel />}
        {activeSubView === 'piano-hero' && <PianoHeroPanel />}
        {activeSubView === 'tonnetz' && <TonnetzPanel />}
      </div>
    </div>
  );
};

export default LearnPanel;
