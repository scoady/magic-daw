import React, { useState } from 'react';
import { Upload, Sparkles, Play, Pause } from 'lucide-react';
import { GlassPanel } from '../components/GlassPanel';
import { Knob } from '../components/Knob';
import { aurora, seededRandom } from '../mockData';

interface Sample {
  id: string;
  name: string;
  duration: number;
  keyRange: [number, number];
  rootNote: number;
}

const mockSamples: Sample[] = [
  { id: 's1', name: 'Piano_C3.wav', duration: 2.4, keyRange: [48, 59], rootNote: 48 },
  { id: 's2', name: 'Piano_C4.wav', duration: 2.1, keyRange: [60, 71], rootNote: 60 },
  { id: 's3', name: 'Piano_C5.wav', duration: 1.8, keyRange: [72, 83], rootNote: 72 },
  { id: 's4', name: 'Pad_Layer.wav', duration: 4.2, keyRange: [36, 96], rootNote: 60 },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const OCTAVE_COLORS = [aurora.teal, aurora.cyan, aurora.purple, aurora.pink, aurora.gold];

export const InstrumentView: React.FC = () => {
  const [selectedSample, setSelectedSample] = useState<string>('s1');
  const [attack, setAttack] = useState(0.01);
  const [decay, setDecay] = useState(0.3);
  const [sustain, setSustain] = useState(0.7);
  const [release, setRelease] = useState(0.5);
  const [cutoff, setCutoff] = useState(0.6);
  const [resonance, setResonance] = useState(0.3);

  // ADSR envelope path
  const envW = 200;
  const envH = 80;
  const attackX = attack * envW * 0.3;
  const decayX = attackX + decay * envW * 0.25;
  const sustainY = envH * (1 - sustain);
  const releaseX = envW * 0.75;
  const envPath = `M 0 ${envH} L ${attackX} 4 L ${decayX} ${sustainY} L ${releaseX} ${sustainY} L ${envW} ${envH}`;

  return (
    <div className="flex gap-3 h-full p-3 overflow-auto">
      {/* Left: Sample Zone */}
      <div className="flex flex-col gap-2" style={{ width: 280 }}>
        {/* Drop zone */}
        <GlassPanel className="flex flex-col items-center justify-center gap-2 p-4 cursor-pointer glass-panel-hover"
          style={{ height: 100, borderStyle: 'dashed' }}>
          <Upload size={20} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Drop audio files here</span>
          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>WAV, AIFF, MP3</span>
        </GlassPanel>

        {/* Sample list */}
        <div className="flex flex-col gap-0.5">
          <span style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Samples
          </span>
          {mockSamples.map((sample) => {
            const isSelected = sample.id === selectedSample;
            const rng = seededRandom(parseInt(sample.id.slice(1)) * 42);

            // Mini waveform
            const wavePoints: string[] = [];
            for (let i = 0; i < 60; i++) {
              const x = 4 + (i / 60) * 100;
              const envelope = Math.sin((i / 60) * Math.PI);
              const y = 14 + (rng() - 0.5) * envelope * 16;
              wavePoints.push(`${x},${y}`);
            }

            return (
              <div
                key={sample.id}
                className={`glass-panel flex items-center gap-2 px-2 py-1.5 cursor-pointer ${
                  isSelected ? '' : 'glass-panel-hover'
                }`}
                style={{
                  borderColor: isSelected ? aurora.borderBright : undefined,
                  background: isSelected ? 'rgba(103,232,249,0.08)' : undefined,
                }}
                onClick={() => setSelectedSample(sample.id)}
              >
                <button
                  className="flex items-center justify-center"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: 'rgba(120,200,220,0.1)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                  }}
                >
                  <Play size={8} />
                </button>
                <div className="flex-1">
                  <div style={{ fontSize: 9, color: isSelected ? aurora.text : 'var(--text-dim)' }}>
                    {sample.name}
                  </div>
                  <div style={{ fontSize: 7, color: 'var(--text-muted)' }}>
                    {sample.duration.toFixed(1)}s | {NOTE_NAMES[sample.rootNote % 12]}{Math.floor(sample.rootNote / 12) - 1}
                  </div>
                </div>
                {/* Mini waveform */}
                <svg width={108} height={28} style={{ opacity: 0.6 }}>
                  <polyline
                    points={wavePoints.join(' ')}
                    fill="none"
                    stroke={isSelected ? aurora.cyan : 'var(--text-muted)'}
                    strokeWidth={1}
                  />
                </svg>
              </div>
            );
          })}
        </div>
      </div>

      {/* Center: Key Mapping */}
      <div className="flex flex-col gap-2 flex-1">
        <span style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Key Mapping
        </span>
        <GlassPanel className="p-3" style={{ height: 120 }}>
          <svg width="100%" height={90} viewBox="0 0 600 90" preserveAspectRatio="xMidYMid meet">
            {/* Piano keys (5 octaves) */}
            {Array.from({ length: 60 }, (_, i) => {
              const noteInOctave = i % 12;
              const octave = Math.floor(i / 12);
              const isBlack = [1, 3, 6, 8, 10].includes(noteInOctave);
              const midiNote = 36 + i;

              // Check which sample zone this key is in
              const sample = mockSamples.find(
                (s) => midiNote >= s.keyRange[0] && midiNote <= s.keyRange[1],
              );
              const zoneColor = sample
                ? OCTAVE_COLORS[mockSamples.indexOf(sample) % OCTAVE_COLORS.length]
                : undefined;

              if (isBlack) {
                const whiteOffset = [0, 0.6, 1.6, 3.6, 4.6][
                  [1, 3, 6, 8, 10].indexOf(noteInOctave)
                ];
                const x = (octave * 7 + whiteOffset) * (600 / 35);
                return (
                  <rect
                    key={`b-${i}`}
                    x={x}
                    y={0}
                    width={600 / 35 * 0.6}
                    height={50}
                    rx={1}
                    fill={zoneColor ? `${zoneColor}66` : 'rgba(10,15,25,0.9)'}
                    stroke="var(--border)"
                    strokeWidth={0.5}
                  />
                );
              }

              const whiteIndex = [0, 1, 2, 3, 4, 5, 6][
                [0, 2, 4, 5, 7, 9, 11].indexOf(noteInOctave)
              ];
              const x = (octave * 7 + whiteIndex) * (600 / 35);

              return (
                <rect
                  key={`w-${i}`}
                  x={x}
                  y={0}
                  width={600 / 35 - 1}
                  height={80}
                  rx={1}
                  fill={zoneColor ? `${zoneColor}33` : 'rgba(200,220,230,0.06)'}
                  stroke="var(--border)"
                  strokeWidth={0.3}
                />
              );
            })}

            {/* Zone labels */}
            {mockSamples.map((sample, si) => {
              const startKey = sample.keyRange[0] - 36;
              const endKey = sample.keyRange[1] - 36;
              const x1 = (Math.floor(startKey / 12) * 7 + [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][startKey % 12]) * (600 / 35);
              const x2 = (Math.floor(endKey / 12) * 7 + [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][endKey % 12] + 1) * (600 / 35);

              return (
                <text
                  key={`label-${si}`}
                  x={(x1 + x2) / 2}
                  y={88}
                  textAnchor="middle"
                  fill={OCTAVE_COLORS[si % OCTAVE_COLORS.length]}
                  fontSize={7}
                  fontFamily="var(--font-mono)"
                  opacity={0.7}
                >
                  {sample.name.split('.')[0]}
                </text>
              );
            })}
          </svg>
        </GlassPanel>

        {/* ADSR Envelope */}
        <span style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Envelope
        </span>
        <GlassPanel className="flex gap-4 p-3 items-center">
          {/* Envelope visualizer */}
          <svg width={envW} height={envH} className="shrink-0">
            <rect x={0} y={0} width={envW} height={envH} rx={3}
              fill="rgba(0,0,0,0.2)" />
            {/* Grid */}
            {[0.25, 0.5, 0.75].map((r) => (
              <line key={r} x1={0} y1={envH * r} x2={envW} y2={envH * r}
                stroke="rgba(120,200,220,0.05)" strokeWidth={0.5} />
            ))}
            {/* Fill */}
            <path d={`${envPath} L 0 ${envH} Z`} fill={aurora.teal} opacity={0.1} />
            {/* Curve */}
            <path d={envPath} fill="none" stroke={aurora.teal} strokeWidth={1.5}
              strokeLinecap="round" strokeLinejoin="round" />
            {/* Control points */}
            <circle cx={attackX} cy={4} r={3} fill={aurora.cyan}
              style={{ cursor: 'pointer' }} />
            <circle cx={decayX} cy={sustainY} r={3} fill={aurora.cyan}
              style={{ cursor: 'pointer' }} />
            <circle cx={releaseX} cy={sustainY} r={3} fill={aurora.cyan}
              style={{ cursor: 'pointer' }} />
          </svg>

          {/* ADSR knobs */}
          <div className="flex gap-3">
            <Knob value={attack} onChange={setAttack} size={36}
              color={aurora.teal} label="ATK"
              displayValue={`${(attack * 1000).toFixed(0)}ms`} />
            <Knob value={decay} onChange={setDecay} size={36}
              color={aurora.cyan} label="DEC"
              displayValue={`${(decay * 1000).toFixed(0)}ms`} />
            <Knob value={sustain} onChange={setSustain} size={36}
              color={aurora.purple} label="SUS"
              displayValue={`${Math.round(sustain * 100)}%`} />
            <Knob value={release} onChange={setRelease} size={36}
              color={aurora.pink} label="REL"
              displayValue={`${(release * 1000).toFixed(0)}ms`} />
          </div>
        </GlassPanel>

        {/* Filter */}
        <span style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Filter
        </span>
        <GlassPanel className="flex gap-4 p-3 items-center">
          <div className="flex gap-3">
            <Knob value={cutoff} onChange={setCutoff} size={40}
              color={aurora.gold} label="CUTOFF"
              displayValue={`${Math.round(cutoff * 20000)}Hz`} />
            <Knob value={resonance} onChange={setResonance} size={40}
              color={aurora.orange} label="RES"
              displayValue={`${Math.round(resonance * 100)}%`} />
          </div>

          <div className="flex gap-1 ml-4">
            {['LP', 'HP', 'BP', 'Notch'].map((type, i) => (
              <button
                key={type}
                className={`glass-button px-2 py-1 ${i === 0 ? 'active' : ''}`}
                style={{ fontSize: 8 }}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <button
            className="glass-button flex items-center gap-1.5 px-3 py-1.5"
            style={{
              background: 'rgba(167, 139, 250, 0.12)',
              borderColor: 'rgba(167, 139, 250, 0.3)',
              color: aurora.purple,
            }}
          >
            <Sparkles size={11} />
            <span style={{ fontSize: 9 }}>AI Assist</span>
          </button>
        </GlassPanel>
      </div>
    </div>
  );
};
