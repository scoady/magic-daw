import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, Sparkles, Play, FolderOpen } from 'lucide-react';
import { GlassPanel } from '../components/GlassPanel';
import { Knob } from '../components/Knob';
import { aurora } from '../mockData';
import {
  onSwiftMessage,
  updateADSR,
  updateFilter,
  importSample,
  loadSample,
  previewNote,
  BridgeMessages,
  type InstrumentZone,
  type InstrumentLoadedPayload,
  type InstrumentWaveformPayload,
  type InstrumentZonesPayload,
} from '../bridge';

interface LoadedSample {
  id: string;
  name: string;
  rootNote: number;
  keyRange: [number, number];
  waveform: number[] | null;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const OCTAVE_COLORS = [aurora.teal, aurora.cyan, aurora.purple, aurora.pink, aurora.gold];

export const InstrumentView: React.FC = () => {
  const [samples, setSamples] = useState<LoadedSample[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [zones, setZones] = useState<InstrumentZone[]>([]);
  const [attack, setAttack] = useState(0.01);
  const [decay, setDecay] = useState(0.3);
  const [sustain, setSustain] = useState(0.7);
  const [release, setRelease] = useState(0.5);
  const [cutoff, setCutoff] = useState(0.6);
  const [resonance, setResonance] = useState(0.3);
  const [filterType, setFilterType] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Subscribe to Swift events
  useEffect(() => {
    const unsubs = [
      onSwiftMessage(BridgeMessages.INSTRUMENT_LOADED, (payload: unknown) => {
        const p = payload as InstrumentLoadedPayload;
        if (p.success) {
          const newSample: LoadedSample = {
            id: `s-${Date.now()}`,
            name: p.name,
            rootNote: p.rootNote,
            keyRange: [p.lowNote, p.highNote],
            waveform: null,
          };
          setSamples((prev) => [...prev, newSample]);
          setSelectedSampleId(newSample.id);
          setError(null);
        }
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_WAVEFORM, (payload: unknown) => {
        const p = payload as InstrumentWaveformPayload;
        setSamples((prev) =>
          prev.map((s) =>
            s.name === p.name ? { ...s, waveform: p.waveform } : s,
          ),
        );
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_ZONES, (payload: unknown) => {
        const p = payload as InstrumentZonesPayload;
        setZones(p.zones);
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_ERROR, (payload: unknown) => {
        const p = payload as { error: string };
        setError(p.error);
        setTimeout(() => setError(null), 5000);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // Wire ADSR knob changes to Swift
  const handleAttackChange = useCallback((v: number) => {
    setAttack(v);
    updateADSR({ attack: v });
  }, []);
  const handleDecayChange = useCallback((v: number) => {
    setDecay(v);
    updateADSR({ decay: v });
  }, []);
  const handleSustainChange = useCallback((v: number) => {
    setSustain(v);
    updateADSR({ sustain: v });
  }, []);
  const handleReleaseChange = useCallback((v: number) => {
    setRelease(v);
    updateADSR({ release: v });
  }, []);

  // Wire filter knob changes to Swift
  const handleCutoffChange = useCallback((v: number) => {
    setCutoff(v);
    updateFilter({ cutoff: v * 20000 });
  }, []);
  const handleResonanceChange = useCallback((v: number) => {
    setResonance(v);
    updateFilter({ resonance: v });
  }, []);

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'wav' || ext === 'aiff' || ext === 'aif' || ext === 'mp3') {
        // WKWebView file drops provide the path via webkitRelativePath or we use the name
        // In WKWebView context, dropped files are accessible via their full path
        const path = (file as any).path || file.name;
        loadSample(path, 60, 0, 127);
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Handle preview button click
  const handlePreview = useCallback((sample: LoadedSample) => {
    previewNote(sample.rootNote, 100);
  }, []);

  // Handle Import Sample button
  const handleImport = useCallback(() => {
    importSample();
  }, []);

  // Determine which data to use for key mapping visualization
  const displayZones = zones.length > 0
    ? zones
    : samples.map((s) => ({ rootNote: s.rootNote, lowNote: s.keyRange[0], highNote: s.keyRange[1] }));

  const selectedSample = samples.find((s) => s.id === selectedSampleId);

  // ADSR envelope path
  const envW = 200;
  const envH = 80;
  const attackX = attack * envW * 0.3;
  const decayX = attackX + decay * envW * 0.25;
  const sustainY = envH * (1 - sustain);
  const releaseX = envW * 0.75;
  const envPath = `M 0 ${envH} L ${attackX} 4 L ${decayX} ${sustainY} L ${releaseX} ${sustainY} L ${envW} ${envH}`;

  // Build waveform polyline from real data or placeholder
  const buildWaveform = (sample: LoadedSample, width: number, height: number): string => {
    if (sample.waveform && sample.waveform.length > 0) {
      const points: string[] = [];
      const step = sample.waveform.length / width;
      for (let i = 0; i < width; i++) {
        const idx = Math.min(Math.floor(i * step), sample.waveform.length - 1);
        const val = sample.waveform[idx];
        const y = height / 2 - val * (height / 2) * 0.9;
        points.push(`${i},${y.toFixed(1)}`);
      }
      return points.join(' ');
    }
    // Placeholder waveform
    const points: string[] = [];
    for (let i = 0; i < width; i++) {
      const t = i / width;
      const envelope = Math.sin(t * Math.PI);
      const y = height / 2 + (Math.sin(t * 40) * envelope * height * 0.3);
      points.push(`${i},${y.toFixed(1)}`);
    }
    return points.join(' ');
  };

  return (
    <div className="flex gap-3 h-full p-3 overflow-auto">
      {/* Left: Sample Zone */}
      <div className="flex flex-col gap-2" style={{ width: 280 }}>
        {/* Drop zone */}
        <div
          ref={dropRef}
          className="glass-panel flex flex-col items-center justify-center gap-2 p-4 cursor-pointer glass-panel-hover"
          style={{ height: 100, borderStyle: 'dashed' }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={handleImport}
        >
          <Upload size={20} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Drop audio files or click to import</span>
          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>WAV, AIFF, MP3</span>
        </div>

        {/* Error message */}
        {error && (
          <div style={{
            fontSize: 9,
            color: '#f87171',
            padding: '4px 8px',
            background: 'rgba(248,113,113,0.1)',
            borderRadius: 4,
          }}>
            {error}
          </div>
        )}

        {/* Import button */}
        <button
          className="glass-button flex items-center justify-center gap-1.5 px-3 py-1.5"
          style={{ fontSize: 9 }}
          onClick={handleImport}
        >
          <FolderOpen size={11} />
          <span>Import Sample</span>
        </button>

        {/* Sample list */}
        <div className="flex flex-col gap-0.5">
          <span style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Samples {samples.length > 0 ? `(${samples.length})` : ''}
          </span>
          {samples.length === 0 && (
            <div style={{ fontSize: 9, color: 'var(--text-muted)', padding: '8px 0', textAlign: 'center' }}>
              No samples loaded
            </div>
          )}
          {samples.map((sample, idx) => {
            const isSelected = sample.id === selectedSampleId;

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
                onClick={() => setSelectedSampleId(sample.id)}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePreview(sample);
                  }}
                >
                  <Play size={8} />
                </button>
                <div className="flex-1">
                  <div style={{ fontSize: 9, color: isSelected ? aurora.text : 'var(--text-dim)' }}>
                    {sample.name}
                  </div>
                  <div style={{ fontSize: 7, color: 'var(--text-muted)' }}>
                    {NOTE_NAMES[sample.rootNote % 12]}{Math.floor(sample.rootNote / 12) - 1} |
                    {NOTE_NAMES[sample.keyRange[0] % 12]}{Math.floor(sample.keyRange[0] / 12) - 1}-
                    {NOTE_NAMES[sample.keyRange[1] % 12]}{Math.floor(sample.keyRange[1] / 12) - 1}
                  </div>
                </div>
                {/* Mini waveform */}
                <svg width={108} height={28} style={{ opacity: 0.6 }}>
                  <polyline
                    points={buildWaveform(sample, 108, 28)}
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

      {/* Center: Key Mapping + Envelope + Filter */}
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

              // Check which zone this key is in
              const zoneIdx = displayZones.findIndex(
                (z) => midiNote >= z.lowNote && midiNote <= z.highNote,
              );
              const zoneColor = zoneIdx >= 0
                ? OCTAVE_COLORS[zoneIdx % OCTAVE_COLORS.length]
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
                    style={{ cursor: 'pointer' }}
                    onClick={() => previewNote(midiNote)}
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
                  style={{ cursor: 'pointer' }}
                  onClick={() => previewNote(midiNote)}
                />
              );
            })}

            {/* Zone labels */}
            {displayZones.map((zone, zi) => {
              const startKey = Math.max(zone.lowNote - 36, 0);
              const endKey = Math.min(zone.highNote - 36, 59);
              const noteToX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
              const x1 = (Math.floor(startKey / 12) * 7 + noteToX[startKey % 12]) * (600 / 35);
              const x2 = (Math.floor(endKey / 12) * 7 + noteToX[endKey % 12] + 1) * (600 / 35);
              const rootName = `${NOTE_NAMES[zone.rootNote % 12]}${Math.floor(zone.rootNote / 12) - 1}`;

              return (
                <text
                  key={`label-${zi}`}
                  x={(x1 + x2) / 2}
                  y={88}
                  textAnchor="middle"
                  fill={OCTAVE_COLORS[zi % OCTAVE_COLORS.length]}
                  fontSize={7}
                  fontFamily="var(--font-mono)"
                  opacity={0.7}
                >
                  {rootName}
                </text>
              );
            })}
          </svg>
        </GlassPanel>

        {/* Waveform display for selected sample */}
        {selectedSample && selectedSample.waveform && (
          <>
            <span style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Waveform - {selectedSample.name}
            </span>
            <GlassPanel className="p-2" style={{ height: 60 }}>
              <svg width="100%" height={48} viewBox="0 0 500 48" preserveAspectRatio="none">
                <polyline
                  points={buildWaveform(selectedSample, 500, 48)}
                  fill="none"
                  stroke={aurora.cyan}
                  strokeWidth={1}
                  opacity={0.8}
                />
              </svg>
            </GlassPanel>
          </>
        )}

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
            <Knob value={attack} onChange={handleAttackChange} size={36}
              color={aurora.teal} label="ATK"
              displayValue={`${(attack * 1000).toFixed(0)}ms`} />
            <Knob value={decay} onChange={handleDecayChange} size={36}
              color={aurora.cyan} label="DEC"
              displayValue={`${(decay * 1000).toFixed(0)}ms`} />
            <Knob value={sustain} onChange={handleSustainChange} size={36}
              color={aurora.purple} label="SUS"
              displayValue={`${Math.round(sustain * 100)}%`} />
            <Knob value={release} onChange={handleReleaseChange} size={36}
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
            <Knob value={cutoff} onChange={handleCutoffChange} size={40}
              color={aurora.gold} label="CUTOFF"
              displayValue={`${Math.round(cutoff * 20000)}Hz`} />
            <Knob value={resonance} onChange={handleResonanceChange} size={40}
              color={aurora.orange} label="RES"
              displayValue={`${Math.round(resonance * 100)}%`} />
          </div>

          <div className="flex gap-1 ml-4">
            {['LP', 'HP', 'BP', 'Notch'].map((type, i) => (
              <button
                key={type}
                className={`glass-button px-2 py-1 ${i === filterType ? 'active' : ''}`}
                style={{ fontSize: 8 }}
                onClick={() => setFilterType(i)}
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
