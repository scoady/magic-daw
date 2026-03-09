import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Player } from '@remotion/player';
import { Upload, Sparkles, Play, FolderOpen } from 'lucide-react';
import { Knob } from '../components/Knob';
import { aurora } from '../mockData';
import { LiveInstrument } from '../compositions/LiveInstrument';
import type { LiveInstrumentProps } from '../compositions/LiveInstrument';
import {
  onSwiftMessage,
  onMidiStateChange,
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

// ── Types ──────────────────────────────────────────────────────────────────

interface LoadedSample {
  id: string;
  name: string;
  rootNote: number;
  keyRange: [number, number];
  waveform: number[] | null;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FILTER_TYPES = ['LP', 'HP', 'BP', 'Notch'];

// ── Component ──────────────────────────────────────────────────────────────

export const InstrumentView: React.FC = () => {
  // ── Sample state ─────────────────────────────────────────────────────────
  const [samples, setSamples] = useState<LoadedSample[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [zones, setZones] = useState<InstrumentZone[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ── ADSR state ───────────────────────────────────────────────────────────
  const [attack, setAttack] = useState(0.01);
  const [decay, setDecay] = useState(0.3);
  const [sustain, setSustain] = useState(0.7);
  const [release, setRelease] = useState(0.5);

  // ── Filter state ─────────────────────────────────────────────────────────
  const [cutoff, setCutoff] = useState(0.6);
  const [resonance, setResonance] = useState(0.3);
  const [filterType, setFilterType] = useState(0);

  // ── Live MIDI state ──────────────────────────────────────────────────────
  const [activeNotes, setActiveNotes] = useState<number[]>([]);

  const dropRef = useRef<HTMLDivElement>(null);

  // ── Subscribe to Swift bridge events ─────────────────────────────────────
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

  // ── Subscribe to live MIDI notes ─────────────────────────────────────────
  useEffect(() => {
    return onMidiStateChange((notes) => {
      setActiveNotes(notes.map((n) => n.note));
    });
  }, []);

  // ── ADSR handlers ────────────────────────────────────────────────────────
  const handleAttackChange = useCallback((v: number) => {
    setAttack(v); updateADSR({ attack: v });
  }, []);
  const handleDecayChange = useCallback((v: number) => {
    setDecay(v); updateADSR({ decay: v });
  }, []);
  const handleSustainChange = useCallback((v: number) => {
    setSustain(v); updateADSR({ sustain: v });
  }, []);
  const handleReleaseChange = useCallback((v: number) => {
    setRelease(v); updateADSR({ release: v });
  }, []);

  // ── Filter handlers ──────────────────────────────────────────────────────
  const handleCutoffChange = useCallback((v: number) => {
    setCutoff(v); updateFilter({ cutoff: v * 20000 });
  }, []);
  const handleResonanceChange = useCallback((v: number) => {
    setResonance(v); updateFilter({ resonance: v });
  }, []);

  // ── Drop / import handlers ───────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'wav' || ext === 'aiff' || ext === 'aif' || ext === 'mp3') {
        const path = (file as unknown as Record<string, unknown>).path as string || file.name;
        loadSample(path, 60, 0, 127);
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleImport = useCallback(() => { importSample(); }, []);

  const handlePreview = useCallback((sample: LoadedSample) => {
    previewNote(sample.rootNote, 100);
  }, []);

  // ── Derived data ─────────────────────────────────────────────────────────
  const selectedSample = samples.find((s) => s.id === selectedSampleId);

  const compositionZones = useMemo(() => {
    if (zones.length > 0) {
      return zones.map((z) => ({
        lowNote: z.lowNote,
        highNote: z.highNote,
        rootNote: z.rootNote,
        name: `${NOTE_NAMES[z.rootNote % 12]}${Math.floor(z.rootNote / 12) - 1}`,
      }));
    }
    return samples.map((s) => ({
      lowNote: s.keyRange[0],
      highNote: s.keyRange[1],
      rootNote: s.rootNote,
      name: s.name,
    }));
  }, [zones, samples]);

  const inputProps: LiveInstrumentProps = useMemo(() => ({
    waveformData: selectedSample?.waveform ?? [],
    zones: compositionZones,
    adsr: { attack, decay, sustain, release },
    filter: { cutoff, resonance, type: FILTER_TYPES[filterType] },
    activeNotes,
    sampleLoaded: samples.length > 0,
    sampleName: selectedSample?.name ?? '',
  }), [selectedSample, compositionZones, attack, decay, sustain, release, cutoff, resonance, filterType, activeNotes, samples.length]);

  // ── Build mini waveform for sample list ──────────────────────────────────
  const buildMiniWaveform = (sample: LoadedSample, width: number, height: number): string => {
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
    const points: string[] = [];
    for (let i = 0; i < width; i++) {
      const t = i / width;
      const envelope = Math.sin(t * Math.PI);
      const y = height / 2 + (Math.sin(t * 40) * envelope * height * 0.3);
      points.push(`${i},${y.toFixed(1)}`);
    }
    return points.join(' ');
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full" style={{ overflow: 'hidden' }}>
      {/* ═══ Left sidebar: sample list + import ═══ */}
      <div className="flex flex-col gap-2 p-3" style={{ width: 220, flexShrink: 0, overflowY: 'auto' }}>
        {/* Drop zone */}
        <div
          ref={dropRef}
          className="glass-panel flex flex-col items-center justify-center gap-2 p-3 cursor-pointer glass-panel-hover"
          style={{ height: 80, borderStyle: 'dashed' }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={handleImport}
        >
          <Upload size={16} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Drop audio or click to import</span>
          <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>WAV · AIFF · MP3</span>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            fontSize: 9, color: '#f87171',
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
          {samples.map((sample) => {
            const isSelected = sample.id === selectedSampleId;
            return (
              <div
                key={sample.id}
                className={`glass-panel flex items-center gap-2 px-2 py-1.5 cursor-pointer ${isSelected ? '' : 'glass-panel-hover'}`}
                style={{
                  borderColor: isSelected ? aurora.borderBright : undefined,
                  background: isSelected ? 'rgba(103,232,249,0.08)' : undefined,
                }}
                onClick={() => setSelectedSampleId(sample.id)}
              >
                <button
                  className="flex items-center justify-center"
                  style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: 'rgba(120,200,220,0.1)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-dim)', cursor: 'pointer',
                  }}
                  onClick={(e) => { e.stopPropagation(); handlePreview(sample); }}
                >
                  <Play size={8} />
                </button>
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 9,
                    color: isSelected ? aurora.text : 'var(--text-dim)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {sample.name}
                  </div>
                  <div style={{ fontSize: 7, color: 'var(--text-muted)' }}>
                    {NOTE_NAMES[sample.rootNote % 12]}{Math.floor(sample.rootNote / 12) - 1} |{' '}
                    {NOTE_NAMES[sample.keyRange[0] % 12]}{Math.floor(sample.keyRange[0] / 12) - 1}-
                    {NOTE_NAMES[sample.keyRange[1] % 12]}{Math.floor(sample.keyRange[1] / 12) - 1}
                  </div>
                </div>
                <svg width={60} height={20} style={{ opacity: 0.6, flexShrink: 0 }}>
                  <polyline
                    points={buildMiniWaveform(sample, 60, 20)}
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

      {/* ═══ Center: Remotion Player + interactive overlays ═══ */}
      <div className="flex-1 flex flex-col" style={{ position: 'relative', overflow: 'hidden' }}>
        {/* Remotion player (fills area, no controls) */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <Player
            component={LiveInstrument}
            inputProps={inputProps}
            compositionWidth={960}
            compositionHeight={600}
            fps={30}
            durationInFrames={9000}
            loop
            autoPlay
            controls={false}
            style={{
              width: '100%',
              height: '100%',
            }}
          />
        </div>

        {/* ═══ Interactive overlay: ADSR knobs ═══ */}
        <div style={{
          position: 'absolute',
          left: 20,
          top: 242,
          display: 'flex',
          gap: 12,
          padding: '8px 12px',
          pointerEvents: 'auto',
          zIndex: 10,
        }}>
          {/* Position knobs in the ADSR area — right side */}
          <div style={{ width: 620 }} /> {/* spacer to push knobs right */}
          <div className="flex gap-2">
            <Knob value={attack} onChange={handleAttackChange} size={32}
              color={aurora.teal} label="ATK"
              displayValue={`${(attack * 1000).toFixed(0)}ms`} />
            <Knob value={decay} onChange={handleDecayChange} size={32}
              color={aurora.cyan} label="DEC"
              displayValue={`${(decay * 1000).toFixed(0)}ms`} />
            <Knob value={sustain} onChange={handleSustainChange} size={32}
              color={aurora.purple} label="SUS"
              displayValue={`${Math.round(sustain * 100)}%`} />
            <Knob value={release} onChange={handleReleaseChange} size={32}
              color={aurora.pink} label="REL"
              displayValue={`${(release * 1000).toFixed(0)}ms`} />
          </div>
        </div>

        {/* ═══ Interactive overlay: Filter controls ═══ */}
        <div style={{
          position: 'absolute',
          right: 16,
          top: 280,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '8px',
          pointerEvents: 'auto',
          zIndex: 10,
        }}>
          <div className="flex gap-2">
            <Knob value={cutoff} onChange={handleCutoffChange} size={34}
              color={aurora.gold} label="CUT"
              displayValue={`${Math.round(cutoff * 20000)}Hz`} />
            <Knob value={resonance} onChange={handleResonanceChange} size={34}
              color={aurora.orange} label="RES"
              displayValue={`${Math.round(resonance * 100)}%`} />
          </div>
          <div className="flex gap-1">
            {FILTER_TYPES.map((type, i) => (
              <button
                key={type}
                className={`glass-button px-2 py-1 ${i === filterType ? 'active' : ''}`}
                style={{ fontSize: 7, pointerEvents: 'auto' }}
                onClick={() => setFilterType(i)}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* ═══ Interactive overlay: AI Assist button ═══ */}
        <div style={{
          position: 'absolute',
          right: 16,
          bottom: 16,
          pointerEvents: 'auto',
          zIndex: 10,
        }}>
          <button
            className="glass-button flex items-center gap-1.5 px-3 py-1.5"
            style={{
              background: 'rgba(167, 139, 250, 0.12)',
              borderColor: 'rgba(167, 139, 250, 0.3)',
              color: aurora.purple,
              fontSize: 9,
            }}
          >
            <Sparkles size={11} />
            <span>AI Assist</span>
          </button>
        </div>
      </div>
    </div>
  );
};
