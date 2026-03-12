import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Player } from '@remotion/player';
import {
  Upload, Sparkles, Play, FolderOpen, Loader2, Wand2, CheckCircle, Trash2, Music,
  Piano, Guitar, Mic, Zap, Waves, Drum, Wind, Globe, Volume2, Headphones, Save,
} from 'lucide-react';
import { Knob } from '../components/Knob';
import { aurora } from '../mockData';
import { LiveInstrument } from '../compositions/LiveInstrument';
import type { LiveInstrumentProps } from '../compositions/LiveInstrument';
import type { InstrumentPreset } from '../types/daw';
import {
  onSwiftMessage,
  onMidiStateChange,
  sendToSwift,
  updateADSR,
  updateFilter,
  updateInstrumentOutput,
  importSample,
  importSampleFolder,
  loadSample,
  listSampleSearchRoots,
  openURL,
  pickSampleSearchRoot,
  previewNote,
  reindexSampleSearch,
  removeSampleSearchRoot,
  searchLocalSamples,
  refineSampleSearch,
  BridgeMessages,
  type InstrumentZone,
  type InstrumentLoadedPayload,
  type InstrumentWaveformPayload,
  type InstrumentZonesPayload,
  type SampleRackLoadedPayload,
  type SampleRackSummary,
  type SampleSearchResult,
  type SampleSearchRoot,
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

const GM_PROGRAMS: Record<number, string> = {
  0: 'Acoustic Grand Piano', 1: 'Bright Piano', 2: 'Electric Grand', 3: 'Honky-tonk',
  4: 'Electric Piano 1', 5: 'Electric Piano 2', 6: 'Harpsichord', 7: 'Clavinet',
  8: 'Celesta', 9: 'Glockenspiel', 10: 'Music Box', 11: 'Vibraphone',
  12: 'Marimba', 13: 'Xylophone', 14: 'Tubular Bells', 15: 'Dulcimer',
  16: 'Drawbar Organ', 17: 'Percussive Organ', 18: 'Rock Organ', 19: 'Church Organ',
  20: 'Reed Organ', 21: 'Accordion', 22: 'Harmonica', 23: 'Tango Accordion',
  24: 'Nylon Guitar', 25: 'Steel Guitar', 26: 'Jazz Guitar', 27: 'Clean Electric',
  28: 'Muted Guitar', 29: 'Overdrive Guitar', 30: 'Distortion Guitar', 31: 'Harmonics',
  32: 'Acoustic Bass', 33: 'Finger Bass', 34: 'Pick Bass', 35: 'Fretless Bass',
  36: 'Slap Bass 1', 37: 'Slap Bass 2', 38: 'Synth Bass 1', 39: 'Synth Bass 2',
  40: 'Violin', 41: 'Viola', 42: 'Cello', 43: 'Contrabass',
  44: 'Tremolo Strings', 45: 'Pizzicato Strings', 46: 'Orchestral Harp', 47: 'Timpani',
  48: 'String Ensemble 1', 49: 'String Ensemble 2', 50: 'Synth Strings 1', 51: 'Synth Strings 2',
  52: 'Choir Aahs', 53: 'Voice Oohs', 54: 'Synth Choir', 55: 'Orchestra Hit',
  56: 'Trumpet', 57: 'Trombone', 58: 'Tuba', 59: 'Muted Trumpet',
  60: 'French Horn', 61: 'Brass Section', 62: 'Synth Brass 1', 63: 'Synth Brass 2',
  64: 'Soprano Sax', 65: 'Alto Sax', 66: 'Tenor Sax', 67: 'Baritone Sax',
  68: 'Oboe', 69: 'English Horn', 70: 'Bassoon', 71: 'Clarinet',
  72: 'Piccolo', 73: 'Flute', 74: 'Recorder', 75: 'Pan Flute',
  76: 'Blown Bottle', 77: 'Shakuhachi', 78: 'Whistle', 79: 'Ocarina',
  80: 'Square Lead', 81: 'Sawtooth Lead', 82: 'Calliope Lead', 83: 'Chiff Lead',
  84: 'Charang Lead', 85: 'Voice Lead', 86: 'Fifths Lead', 87: 'Bass + Lead',
  88: 'New Age Pad', 89: 'Warm Pad', 90: 'Polysynth Pad', 91: 'Choir Pad',
  92: 'Bowed Pad', 93: 'Metallic Pad', 94: 'Halo Pad', 95: 'Sweep Pad',
  96: 'Rain FX', 97: 'Soundtrack FX', 98: 'Crystal FX', 99: 'Atmosphere FX',
  100: 'Brightness FX', 101: 'Goblins FX', 102: 'Echoes FX', 103: 'Sci-Fi FX',
  104: 'Sitar', 105: 'Banjo', 106: 'Shamisen', 107: 'Koto',
  108: 'Kalimba', 109: 'Bagpipe', 110: 'Fiddle', 111: 'Shanai',
  112: 'Tinkle Bell', 113: 'Agogo', 114: 'Steel Drums', 115: 'Woodblock',
  116: 'Taiko Drum', 117: 'Melodic Tom', 118: 'Synth Drum', 119: 'Reverse Cymbal',
  120: 'Guitar Fret Noise', 121: 'Breath Noise', 122: 'Seashore', 123: 'Bird Tweet',
  124: 'Telephone Ring', 125: 'Helicopter', 126: 'Applause', 127: 'Gunshot',
};

// ── GM Categories ────────────────────────────────────────────────────────

interface GMCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  programs: number[];
}

const BUILT_IN_DEMO_RACKS: SampleRackSummary[] = [
  { name: 'Sampler QA Demo', path: 'builtin:SamplerQA', zoneCount: 3, sampleCount: 3, source: 'built-in' },
  { name: 'Studio Piano Demo', path: 'builtin:StudioPiano', zoneCount: 6, sampleCount: 6, source: 'built-in' },
];

const GM_CATEGORIES: GMCategory[] = [
  { id: 'finder', name: 'Sample Finder', icon: <Wand2 size={12} />, programs: [] },
  { id: 'ai', name: 'AI Created', icon: <Sparkles size={12} />, programs: [] },
  { id: 'built-in', name: 'Built-In Demos', icon: <Music size={12} />, programs: [] },
  { id: 'sample-racks', name: 'Sample Racks', icon: <FolderOpen size={12} />, programs: [] },
  { id: 'piano', name: 'Piano & Keys', icon: <Piano size={12} />, programs: [0,1,2,3,4,5,6,7] },
  { id: 'organ', name: 'Organ', icon: <Headphones size={12} />, programs: [16,17,18,19,20,21,22,23] },
  { id: 'guitar', name: 'Guitar', icon: <Guitar size={12} />, programs: [24,25,26,27,28,29,30,31] },
  { id: 'bass', name: 'Bass', icon: <Guitar size={12} />, programs: [32,33,34,35,36,37,38,39] },
  { id: 'strings', name: 'Strings', icon: <Music size={12} />, programs: [40,41,42,43,44,45,46,47,48,49,50,51] },
  { id: 'choir', name: 'Choir & Voice', icon: <Mic size={12} />, programs: [52,53,54,55] },
  { id: 'brass', name: 'Brass', icon: <Volume2 size={12} />, programs: [56,57,58,59,60,61,62,63] },
  { id: 'woodwind', name: 'Woodwind', icon: <Wind size={12} />, programs: [64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79] },
  { id: 'synth-lead', name: 'Synth Lead', icon: <Zap size={12} />, programs: [80,81,82,83,84,85,86,87] },
  { id: 'synth-pad', name: 'Synth Pad', icon: <Waves size={12} />, programs: [88,89,90,91,92,93,94,95] },
  { id: 'sfx', name: 'Sound FX', icon: <Sparkles size={12} />, programs: [96,97,98,99,100,101,102,103,120,121,122,123,124,125,126,127] },
  { id: 'ethnic', name: 'Ethnic', icon: <Globe size={12} />, programs: [104,105,106,107,108,109,110,111] },
  { id: 'percussion', name: 'Percussion', icon: <Drum size={12} />, programs: [112,113,114,115,116,117,118,119] },
];

const FREE_SOURCE_CARDS = [
  {
    id: 'sfz-instruments',
    name: 'SFZ Instruments',
    subtitle: 'Directory source. Includes free and commercial links, so verify each linked library.',
    buildUrl: (query: string) => `https://duckduckgo.com/?q=${encodeURIComponent(`site:sfzinstruments.github.io ${query} sfz`)}`,
  },
  {
    id: 'freepats',
    name: 'FreePats',
    subtitle: 'Open sample/instrument project with explicit free-license guidance.',
    buildUrl: (query: string) => `https://duckduckgo.com/?q=${encodeURIComponent(`site:freepats.zenvoid.org ${query}`)}`,
  },
  {
    id: 'freesound',
    name: 'Freesound',
    subtitle: 'CC-licensed audio search. Always inspect the per-sound license.',
    buildUrl: (query: string) => `https://freesound.org/search/?q=${encodeURIComponent(query)}`,
  },
  {
    id: 'pianobook',
    name: 'Pianobook',
    subtitle: 'Community libraries. Useful, but each pack still needs review.',
    buildUrl: (query: string) => `https://duckduckgo.com/?q=${encodeURIComponent(`site:pianobook.co.uk ${query}`)}`,
  },
];

const formatFinderLabel = (value: string): string =>
  value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const isBuiltInRack = (rack: SampleRackSummary): boolean =>
  rack.source === 'built-in' || rack.path.startsWith('builtin:');

const formatFileSize = (sizeBytes: number): string => {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return 'Unknown size';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const finderReadinessTone = (readiness: string): { background: string; border: string; color: string } => {
  const normalized = readiness.toLowerCase();
  if (normalized.includes('ready')) {
    return {
      background: 'rgba(255,255,255,0.08)',
      border: 'rgba(255,255,255,0.16)',
      color: 'var(--text)',
    };
  }
  if (normalized.includes('mapped') || normalized.includes('multisample')) {
    return {
      background: 'rgba(255,255,255,0.06)',
      border: 'rgba(255,255,255,0.14)',
      color: 'var(--text-dim)',
    };
  }
  if (normalized.includes('loop')) {
    return {
      background: 'rgba(214,190,138,0.12)',
      border: 'rgba(214,190,138,0.22)',
      color: 'var(--warning)',
    };
  }
  return {
    background: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.1)',
    color: 'var(--text-muted)',
  };
};

// ── Component ──────────────────────────────────────────────────────────────

interface InstrumentViewProps {
  selectedTrackId?: string | null;
}

export const InstrumentView: React.FC<InstrumentViewProps> = ({ selectedTrackId = null }) => {
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
  const [outputGain, setOutputGain] = useState(1);
  const [outputPan, setOutputPan] = useState(0);

  // ── Filter state ─────────────────────────────────────────────────────────
  const [cutoff, setCutoff] = useState(0.6);
  const [resonance, setResonance] = useState(0.3);
  const [filterType, setFilterType] = useState(0);

  // ── Live MIDI state ──────────────────────────────────────────────────────
  const [activeNotes, setActiveNotes] = useState<number[]>([]);

  // ── AI Assist state ─────────────────────────────────────────────────────
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiToast, setAiToast] = useState<string | null>(null);

  // ── Instrument Factory state ──────────────────────────────────────────
  const [presets, setPresets] = useState<InstrumentPreset[]>([]);
  const [sampleRacks, setSampleRacks] = useState<SampleRackSummary[]>([]);
  const [createPrompt, setCreatePrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [finderQuery, setFinderQuery] = useState('');
  const [finderResults, setFinderResults] = useState<SampleSearchResult[]>([]);
  const [finderNote, setFinderNote] = useState<string | null>(null);
  const [finderLoading, setFinderLoading] = useState(false);
  const [finderRoots, setFinderRoots] = useState<SampleSearchRoot[]>([]);
  const [finderFormatFilter, setFinderFormatFilter] = useState('all');
  const [finderFamilyFilter, setFinderFamilyFilter] = useState('all');
  const [finderContentFilter, setFinderContentFilter] = useState('all');
  const pendingRackPreviewRef = useRef<number | null>(null);

  // ── Browser state ────────────────────────────────────────────────────────
  const [selectedCategory, setSelectedCategory] = useState('ai');
  const [selectedGMProgram, setSelectedGMProgram] = useState<number | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<InstrumentPreset | null>(null);
  const [selectedSampleRack, setSelectedSampleRack] = useState<SampleRackSummary | null>(null);
  const [selectedFinderResult, setSelectedFinderResult] = useState<SampleSearchResult | null>(null);
  const [hoveredInstrument, setHoveredInstrument] = useState<number | null>(null);
  const [rackName, setRackName] = useState('Imported Sampler');

  const dropRef = useRef<HTMLDivElement>(null);
  const lastSuccessfulRackLoadAtRef = useRef<number>(0);

  const isIgnorableNativeReadError = useCallback((message: string) => {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("couldn’t be read because it is missing") ||
      normalized.includes("couldn't be read because it is missing")
    );
  }, []);

  // ── Subscribe to Swift bridge events ─────────────────────────────────────
  useEffect(() => {
    const unsubs = [
      onSwiftMessage(BridgeMessages.INSTRUMENT_LOADED, (payload: unknown) => {
        const p = payload as InstrumentLoadedPayload;
        if (p.success) {
          setSelectedSampleRack(null);
          setSelectedGMProgram(null);
          setSelectedPreset(null);
          const inferredName = p.name.replace(/\.[^/.]+$/, '');
          const newSample: LoadedSample = {
            id: `s-${Date.now()}`,
            name: p.name,
            rootNote: p.rootNote,
            keyRange: [p.lowNote, p.highNote],
            waveform: null,
          };
          setSamples((prev) => [...prev, newSample]);
          setSelectedSampleId(newSample.id);
          setRackName((prev) => (prev === 'Imported Sampler' ? inferredName : prev));
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
      onSwiftMessage(BridgeMessages.INSTRUMENT_SAMPLE_RACK_LIST, (payload: unknown) => {
        const p = payload as { racks: SampleRackSummary[] };
        setSampleRacks(p.racks ?? []);
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_SAMPLE_RACK_LOADED, (payload: unknown) => {
        const p = payload as SampleRackLoadedPayload;
        const loadedSamples: LoadedSample[] = p.samples.map((sample, index) => ({
          id: `rack-${p.path}-${index}`,
          name: sample.name,
          rootNote: sample.rootNote,
          keyRange: [sample.lowNote, sample.highNote],
          waveform: sample.waveform,
        }));
        setSamples(loadedSamples);
        setSelectedSampleId(loadedSamples[0]?.id ?? null);
        setZones(p.zones);
        setRackName(p.name);
        setOutputGain(p.outputGain ?? 1);
        setOutputPan(p.outputPan ?? 0);
        setSelectedCategory((p.source === 'built-in' || p.path.startsWith('builtin:')) ? 'built-in' : 'sample-racks');
        setSelectedPreset(null);
        setSelectedGMProgram(null);
        setSelectedSampleRack({
          name: p.name,
          path: p.path,
          zoneCount: p.zones.length,
          sampleCount: p.samples.length,
          source: p.source,
        });
        lastSuccessfulRackLoadAtRef.current = Date.now();
        setError(null);
        if (pendingRackPreviewRef.current !== null) {
          previewLoadedInstrument(pendingRackPreviewRef.current, 80);
          pendingRackPreviewRef.current = null;
        }
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_SEARCH_RESULTS, (payload: unknown) => {
        const p = payload as { results: SampleSearchResult[]; query?: string };
        setFinderResults(p.results ?? []);
        setSelectedFinderResult((p.results ?? [])[0] ?? null);
        setFinderLoading(false);
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_SEARCH_REFINED, (payload: unknown) => {
        const p = payload as { query?: string; notes?: string };
        if (p.query) {
          setFinderQuery(p.query);
          searchLocalSamples(p.query);
          setFinderLoading(true);
        }
        setFinderNote(p.notes ?? null);
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_SEARCH_ROOTS, (payload: unknown) => {
        const p = payload as { roots: SampleSearchRoot[] };
        setFinderRoots(p.roots ?? []);
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_ERROR, (payload: unknown) => {
        const p = payload as { error: string };
        if (isIgnorableNativeReadError(p.error)) {
          return;
        }
        setError(p.error);
        setTimeout(() => setError(null), 5000);
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_AI_STATUS, (payload: unknown) => {
        const p = payload as { status: string; message?: string };
        setAiLoading(p.status === 'loading');
        setCreating(p.status === 'loading');
        setCreateStatus(p.message ?? null);
        if (p.status === 'error') {
          setError(p.message ?? 'AI error');
          setTimeout(() => setError(null), 5000);
          setAiLoading(false);
          setCreating(false);
          setCreateStatus(null);
        }
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_PRESET_CREATED, (payload: unknown) => {
        const p = payload as InstrumentPreset;
        setPresets(prev => [p, ...prev]);
        setCreating(false);
        setCreateStatus(null);
        setCreatePrompt('');
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_PRESET_LIST, (payload: unknown) => {
        const p = payload as { presets: InstrumentPreset[] };
        setPresets(p.presets);
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_PRESET_DELETED, (payload: unknown) => {
        const p = payload as { id: string };
        setPresets(prev => prev.filter(x => x.id !== p.id));
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_ASSIGNED, (payload: unknown) => {
        const p = payload as { name?: string; trackId?: string; type?: string };
        if (p.type === 'sample-rack') {
          sendToSwift(BridgeMessages.INSTRUMENT_LIST_SAMPLE_RACKS);
          setAiToast(
            p.trackId
              ? `Assigned ${p.name ?? 'sample rack'} to selected track`
              : `Saved ${p.name ?? 'sample rack'}`
          );
          setTimeout(() => setAiToast(null), 4000);
        }
      }),
      onSwiftMessage(BridgeMessages.INSTRUMENT_AI_PATCH, (payload: unknown) => {
        const p = payload as {
          name?: string;
          description?: string;
          adsr?: { attack?: number; decay?: number; sustain?: number; release?: number };
          filter?: { cutoff?: number; resonance?: number; type?: string };
          success?: boolean;
        };
        const a = p.adsr;
        if (a) {
          if (a.attack !== undefined) setAttack(a.attack);
          if (a.decay !== undefined) setDecay(a.decay);
          if (a.sustain !== undefined) setSustain(a.sustain);
          if (a.release !== undefined) setRelease(a.release);
        }
        const f = p.filter;
        if (f) {
          if (f.cutoff !== undefined) {
            const normalized = Math.min(1, f.cutoff / 20000);
            setCutoff(normalized);
          }
          if (f.resonance !== undefined) setResonance(f.resonance);
          if (f.type) {
            const idx = FILTER_TYPES.indexOf(f.type);
            if (idx >= 0) setFilterType(idx);
          }
        }
        setAiLoading(false);
        setAiToast(p.name ? `* ${p.name}` : 'Patch applied');
        setTimeout(() => setAiToast(null), 4000);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [isIgnorableNativeReadError]);

  // ── Subscribe to live MIDI notes ─────────────────────────────────────────
  useEffect(() => {
    return onMidiStateChange((notes) => {
      setActiveNotes(notes.map((n) => n.note));
    });
  }, []);

  // ── Request instrument presets on mount ────────────────────────────────
  useEffect(() => {
    sendToSwift(BridgeMessages.INSTRUMENT_LIST_PRESETS);
    sendToSwift(BridgeMessages.INSTRUMENT_LIST_SAMPLE_RACKS);
    listSampleSearchRoots();
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
  const handleOutputGainChange = useCallback((v: number) => {
    setOutputGain(v); updateInstrumentOutput({ gain: v });
  }, []);
  const handleOutputPanChange = useCallback((v: number) => {
    setOutputPan(v); updateInstrumentOutput({ pan: v });
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
  const handleImportFolder = useCallback(() => { importSampleFolder(); }, []);
  const handleFinderSearch = useCallback(() => {
    setFinderLoading(true);
    setFinderNote(null);
    searchLocalSamples(finderQuery);
  }, [finderQuery]);
  const handleFinderRefine = useCallback(() => {
    setFinderLoading(true);
    refineSampleSearch(finderQuery);
  }, [finderQuery]);
  const previewLoadedInstrument = useCallback((note = 60, delayMs = 80) => {
    window.setTimeout(() => previewNote(note, 100), delayMs);
  }, []);
  const handleLoadFinderResult = useCallback((result: SampleSearchResult) => {
    setSelectedFinderResult(result);
    sendToSwift(BridgeMessages.INSTRUMENT_LOAD_DISCOVERED, { path: result.path, kind: result.kind });
    previewLoadedInstrument(60, 110);
  }, [previewLoadedInstrument]);
  const handleOpenFreeSource = useCallback((query: string, buildUrl: (query: string) => string) => {
    openURL(buildUrl(query || 'free sfz instrument'));
  }, []);
  const handleAddFinderRoot = useCallback(() => {
    pickSampleSearchRoot();
  }, []);
  const handleRemoveFinderRoot = useCallback((path: string) => {
    removeSampleSearchRoot(path);
  }, []);
  const handleReindexFinder = useCallback(() => {
    reindexSampleSearch();
  }, []);

  const handlePreview = useCallback((sample: LoadedSample) => {
    previewNote(sample.rootNote, 100);
  }, []);

  // ── Instrument Factory handlers ───────────────────────────────────────
  const handleCreatePreset = useCallback(() => {
    if (!createPrompt.trim() || creating) return;
    sendToSwift(BridgeMessages.INSTRUMENT_CREATE_PRESET, { description: createPrompt });
    setCreating(true);
    setCreateStatus('Designing instrument...');
  }, [createPrompt, creating]);

  const handlePreviewPreset = useCallback((preset: InstrumentPreset) => {
    sendToSwift(BridgeMessages.INSTRUMENT_PREVIEW_PRESET, { presetId: preset.id });
  }, []);

  const handleAssignPreset = useCallback((preset: InstrumentPreset) => {
    sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, { presetId: preset.id });
  }, []);

  const handleDeletePreset = useCallback((preset: InstrumentPreset) => {
    sendToSwift(BridgeMessages.INSTRUMENT_DELETE_PRESET, { id: preset.id });
  }, []);

  // ── GM instrument handlers ────────────────────────────────────────────
  const handleSelectGMProgram = useCallback((program: number) => {
    setSelectedGMProgram(program);
    setSelectedPreset(null);
    setSelectedSampleRack(null);
    setOutputGain(1);
    setOutputPan(0);
    const name = GM_PROGRAMS[program] ?? `Program ${program}`;
    sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, {
      gmProgram: program,
      name,
    });
    previewLoadedInstrument(60, 50);
  }, [previewLoadedInstrument]);

  const handleSelectPreset = useCallback((preset: InstrumentPreset) => {
    setSelectedPreset(preset);
    setSelectedGMProgram(null);
    setSelectedSampleRack(null);
    // Load preset params into controls
    setAttack(preset.attack);
    setDecay(preset.decay);
    setSustain(preset.sustain);
    setRelease(preset.release);
    setCutoff(Math.min(1, preset.filterCutoff / 20000));
    setResonance(preset.filterResonance);
    setOutputGain(1);
    setOutputPan(0);
    const ftIdx = FILTER_TYPES.indexOf(preset.filterType);
    if (ftIdx >= 0) setFilterType(ftIdx);
    sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, { presetId: preset.id });
    previewLoadedInstrument(60, 50);
  }, [previewLoadedInstrument]);

  const handleSelectSampleRack = useCallback((rack: SampleRackSummary) => {
    setError(null);
    setSelectedSampleRack(rack);
    setSelectedPreset(null);
    setSelectedGMProgram(null);
    pendingRackPreviewRef.current = 60;
    if (rack.path.startsWith('builtin:')) {
      sendToSwift(BridgeMessages.INSTRUMENT_LOAD_BUILTIN_DEMO, { id: rack.path.replace('builtin:', '') });
    } else {
      sendToSwift(BridgeMessages.INSTRUMENT_LOAD_SAMPLE_RACK, { path: rack.path });
    }
  }, []);

  const handleSaveGMToLibrary = useCallback(() => {
    if (selectedGMProgram === null) return;
    const name = GM_PROGRAMS[selectedGMProgram] ?? `Program ${selectedGMProgram}`;
    sendToSwift(BridgeMessages.INSTRUMENT_CREATE_PRESET, {
      description: name,
      gmProgram: selectedGMProgram,
      adsr: { attack, decay, sustain, release },
      filter: { cutoff: cutoff * 20000, resonance, type: FILTER_TYPES[filterType] },
    });
  }, [selectedGMProgram, attack, decay, sustain, release, cutoff, resonance, filterType]);

  const handleAssignToTrack = useCallback(() => {
    if (selectedPreset) {
      if (selectedTrackId) {
        sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, { presetId: selectedPreset.id, trackId: selectedTrackId });
      } else {
        handleAssignPreset(selectedPreset);
      }
    } else if (selectedSampleRack && selectedTrackId) {
      sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, {
        sampleRackPath: selectedSampleRack.path,
        trackId: selectedTrackId,
      });
    } else if (selectedGMProgram !== null) {
      const name = GM_PROGRAMS[selectedGMProgram] ?? `Program ${selectedGMProgram}`;
      sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, {
        gmProgram: selectedGMProgram,
        name,
        ...(selectedTrackId ? { trackId: selectedTrackId } : {}),
      });
    }
  }, [selectedPreset, selectedSampleRack, selectedGMProgram, handleAssignPreset, selectedTrackId]);

  const handleSaveRack = useCallback(() => {
    if (samples.length === 0) return;
    sendToSwift(BridgeMessages.INSTRUMENT_SAVE_RACK, { name: rackName });
  }, [rackName, samples.length]);

  const handleAssignRack = useCallback(() => {
    if (!selectedTrackId || samples.length === 0) return;
    sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_PREVIEW_RACK, {
      trackId: selectedTrackId,
      name: rackName,
    });
  }, [rackName, samples.length, selectedTrackId]);

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

  // ── Category data ────────────────────────────────────────────────────────
  const activeCategory = GM_CATEGORIES.find(c => c.id === selectedCategory) ?? GM_CATEGORIES[0];
  const builtInSampleRacks = useMemo(
    () => sampleRacks.filter((rack) => isBuiltInRack(rack)),
    [sampleRacks],
  );
  const savedSampleRacks = useMemo(
    () => sampleRacks.filter((rack) => !isBuiltInRack(rack)),
    [sampleRacks],
  );

  const categoryInstruments = useMemo(() => {
    if (selectedCategory === 'ai' || selectedCategory === 'sample-racks' || selectedCategory === 'built-in' || selectedCategory === 'finder') return [];
    return activeCategory.programs.map(p => ({
      program: p,
      name: GM_PROGRAMS[p] ?? `Program ${p}`,
    }));
  }, [selectedCategory, activeCategory]);

  const finderFormats = useMemo(() =>
    Array.from(new Set(finderResults.map((result) => result.extensionName))).sort(),
  [finderResults]);

  const finderFamilies = useMemo(() =>
    Array.from(new Set(finderResults.map((result) => result.family))).sort(),
  [finderResults]);

  const finderContentTypes = useMemo(() =>
    Array.from(new Set(finderResults.map((result) => result.contentType))).sort(),
  [finderResults]);

  const filteredFinderResults = useMemo(() =>
    finderResults.filter((result) => {
      if (finderFormatFilter !== 'all' && result.extensionName !== finderFormatFilter) return false;
      if (finderFamilyFilter !== 'all' && result.family !== finderFamilyFilter) return false;
      if (finderContentFilter !== 'all' && result.contentType !== finderContentFilter) return false;
      return true;
    }),
  [finderResults, finderFormatFilter, finderFamilyFilter, finderContentFilter]);

  useEffect(() => {
    if (selectedCategory !== 'finder') return;
    if (!selectedFinderResult) {
      setSelectedFinderResult(filteredFinderResults[0] ?? null);
      return;
    }
    if (!filteredFinderResults.some((result) => result.path === selectedFinderResult.path)) {
      setSelectedFinderResult(filteredFinderResults[0] ?? null);
    }
  }, [filteredFinderResults, selectedFinderResult, selectedCategory]);

  // ── Detail info ──────────────────────────────────────────────────────────
  const detailName = selectedFinderResult?.name
    ?? selectedSampleRack?.name
    ?? selectedPreset?.name
    ?? (selectedGMProgram !== null ? (GM_PROGRAMS[selectedGMProgram] ?? `Program ${selectedGMProgram}`) : null);
  const detailDescription = selectedFinderResult
    ? `${formatFinderLabel(selectedFinderResult.readiness)} • ${formatFinderLabel(selectedFinderResult.family)} • ${selectedFinderResult.source}`
    : selectedSampleRack
    ? `${selectedSampleRack.sampleCount} samples across ${selectedSampleRack.zoneCount} zones`
    : selectedPreset?.description
    ?? (selectedGMProgram !== null ? `General MIDI Program ${selectedGMProgram}` : null);
  const hasSelection = selectedFinderResult !== null || selectedSampleRack !== null || selectedPreset !== null || selectedGMProgram !== null;

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
    <div className="flex flex-col h-full" style={{ overflow: 'hidden' }}>
      {/* ═══ Quick Factory Bar ═══ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.02)',
          flexShrink: 0,
        }}
      >
        <Sparkles size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <input
          type="text"
          value={createPrompt}
          onChange={(e) => setCreatePrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreatePreset(); }}
          placeholder="Describe an instrument..."
          style={{
            fontSize: 10,
            padding: '5px 10px',
            borderRadius: 5,
            border: '1px solid rgba(255,255,255,0.09)',
            background: 'rgba(255,255,255,0.04)',
            color: 'var(--text)',
            outline: 'none',
            flex: 1,
            minWidth: 0,
          }}
        />
        <button
          className="glass-button flex items-center gap-1.5 px-3 py-1"
          style={{
            fontSize: 9,
            background: createPrompt.trim() && !creating ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
            borderColor: 'rgba(255,255,255,0.1)',
            color: 'var(--text)',
            cursor: (!createPrompt.trim() || creating) ? 'not-allowed' : 'pointer',
            opacity: (!createPrompt.trim() || creating) ? 0.5 : 1,
            flexShrink: 0,
          }}
          disabled={!createPrompt.trim() || creating}
          onClick={handleCreatePreset}
        >
          {creating ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
          <span>{creating ? 'Creating...' : 'Create'}</span>
        </button>
        {createStatus && (
          <span style={{ fontSize: 8, color: 'var(--text-dim)', opacity: 0.8, flexShrink: 0 }}>
            {createStatus}
          </span>
        )}
      </div>

      {/* ═══ Error bar ═══ */}
      {error && !isIgnorableNativeReadError(error) && (
        <div style={{
          fontSize: 9, color: '#f87171',
          padding: '4px 12px',
          background: 'rgba(248,113,113,0.08)',
          borderBottom: '1px solid rgba(248,113,113,0.15)',
          flexShrink: 0,
        }}>
          {error}
        </div>
      )}

      {/* ═══ AI toast ═══ */}
      {aiToast && (
        <div style={{
          fontSize: 9, color: 'var(--text)',
          padding: '4px 12px',
          background: 'rgba(255,255,255,0.05)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
        }}>
          {aiToast}
        </div>
      )}

      {/* ═══ 3-Column Browser ═══ */}
      <div className="flex flex-1" style={{ overflow: 'hidden', minHeight: 0 }}>

        {/* ── Column 1: Categories ── */}
        <div
          style={{
            width: 160,
            flexShrink: 0,
            overflowY: 'auto',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(10,10,11,0.72)',
            padding: '4px 0',
          }}
        >
          <div style={{
            fontSize: 9, color: 'var(--text-muted)',
            letterSpacing: '0.1em', textTransform: 'uppercase',
            padding: '4px 10px 6px',
          }}>
            Categories
          </div>
          {GM_CATEGORIES.map((cat) => {
            const isActive = cat.id === selectedCategory;
            const count = cat.id === 'finder'
              ? filteredFinderResults.length
              : cat.id === 'ai'
              ? presets.length
              : cat.id === 'built-in'
                ? BUILT_IN_DEMO_RACKS.length
              : cat.id === 'sample-racks'
                ? savedSampleRacks.length
                : cat.programs.length;
            return (
              <div
                key={cat.id}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setSelectedGMProgram(null);
                  setSelectedPreset(null);
                  if (cat.id !== 'finder') {
                    setSelectedFinderResult(null);
                  }
                  if (cat.id !== 'sample-racks' && cat.id !== 'built-in') {
                    setSelectedSampleRack(null);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  borderLeft: isActive ? '2px solid rgba(255,255,255,0.8)' : '2px solid transparent',
                  background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
                  color: isActive ? 'var(--text)' : 'var(--text-dim)',
                  fontSize: 9,
                  transition: 'background 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.035)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ color: isActive ? 'var(--text)' : 'var(--text-muted)', flexShrink: 0 }}>
                  {cat.icon}
                </span>
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {cat.name}
                </span>
                <span style={{
                  fontSize: 9,
                  color: 'var(--text-muted)',
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: 6,
                  padding: '1px 4px',
                  flexShrink: 0,
                }}>
                  {count}
                </span>
              </div>
            );
          })}

          {/* Samples section at bottom of col 1 */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            marginTop: 8,
            paddingTop: 4,
          }}>
            <div style={{
              fontSize: 9, color: 'var(--text-muted)',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              padding: '4px 10px 4px',
            }}>
              Samples {samples.length > 0 ? `(${samples.length})` : ''}
            </div>
            <div
              ref={dropRef}
              style={{
                margin: '2px 8px 4px',
                padding: '6px',
                border: '1px dashed rgba(255,255,255,0.12)',
                borderRadius: 4,
                textAlign: 'center',
                cursor: 'pointer',
                fontSize: 8,
                color: 'var(--text-muted)',
              }}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={handleImport}
            >
              <Upload size={10} style={{ margin: '0 auto 2px', display: 'block' }} />
              Drop or import
            </div>
            <button
              className="glass-button flex items-center justify-center gap-1 w-full py-1"
              style={{
                fontSize: 8,
                margin: '0 8px 4px',
                width: 'calc(100% - 16px)',
              }}
              onClick={handleImportFolder}
            >
              <FolderOpen size={9} />
              <span>Import Folder</span>
            </button>
            <div
              style={{
                fontSize: 9,
                color: 'var(--text-muted)',
                lineHeight: 1.5,
                padding: '0 10px 6px',
              }}
            >
              Supported workflow: import a folder that contains your rack samples.
            </div>
            {samples.length > 0 && (
              <input
                value={rackName}
                onChange={(e) => setRackName(e.target.value)}
                placeholder="Rack name"
                style={{
                  width: 'calc(100% - 16px)',
                  margin: '0 8px 4px',
                  padding: '6px 8px',
                  fontSize: 8,
                  borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.09)',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text)',
                  outline: 'none',
                }}
              />
            )}
            {samples.map((sample) => {
              const isSel = sample.id === selectedSampleId;
              return (
                <div
                  key={sample.id}
                  onClick={() => setSelectedSampleId(sample.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 10px',
                    cursor: 'pointer',
                    borderLeft: isSel ? '2px solid rgba(255,255,255,0.8)' : '2px solid transparent',
                    background: isSel ? 'rgba(255,255,255,0.05)' : 'transparent',
                    fontSize: 8,
                    color: isSel ? 'var(--text)' : 'var(--text-dim)',
                  }}
                >
                  <button
                    style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-dim)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, padding: 0,
                    }}
                    onClick={(e) => { e.stopPropagation(); handlePreview(sample); }}
                  >
                    <Play size={6} />
                  </button>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sample.name}
                  </span>
                </div>
              );
            })}
            {samples.length >= 2 && (
              <button
                className="glass-button flex items-center justify-center gap-1 w-full py-1"
                style={{
                  fontSize: 8,
                  margin: '4px 8px 0',
                  width: 'calc(100% - 16px)',
                  background: 'rgba(255,255,255,0.06)',
                  borderColor: 'rgba(255,255,255,0.1)',
                  color: 'var(--text)',
                }}
                onClick={() => sendToSwift(BridgeMessages.INSTRUMENT_MAP_ZONES, {})}
              >
                <Wand2 size={9} />
                <span>AI Map Zones</span>
              </button>
            )}
            {samples.length > 0 && (
              <button
                className="glass-button flex items-center justify-center gap-1 w-full py-1"
                style={{
                  fontSize: 8,
                  margin: '4px 8px 0',
                  width: 'calc(100% - 16px)',
                  background: 'rgba(255,255,255,0.06)',
                  borderColor: 'rgba(255,255,255,0.1)',
                  color: 'var(--text)',
                }}
                onClick={handleSaveRack}
              >
                <Save size={9} />
                <span>Save Rack</span>
              </button>
            )}
            {samples.length > 0 && (
              <button
                className="glass-button flex items-center justify-center gap-1 w-full py-1"
                style={{
                  fontSize: 8,
                  margin: '4px 8px 0',
                  width: 'calc(100% - 16px)',
                  background: selectedTrackId ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
                  borderColor: 'rgba(255,255,255,0.1)',
                  color: 'var(--text)',
                  opacity: selectedTrackId ? 1 : 0.5,
                  cursor: selectedTrackId ? 'pointer' : 'not-allowed',
                }}
                disabled={!selectedTrackId}
                onClick={handleAssignRack}
              >
                <CheckCircle size={9} />
                <span>{selectedTrackId ? 'Assign Rack to Selected Track' : 'Select a MIDI track in Arrange'}</span>
              </button>
            )}
          </div>
        </div>

        {/* ── Column 2: Instruments in Category ── */}
        <div
          style={{
            width: 200,
            flexShrink: 0,
            overflowY: 'auto',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(12,12,13,0.52)',
            padding: '4px 0',
          }}
        >
          <div style={{
            fontSize: 9, color: 'var(--text-muted)',
            letterSpacing: '0.1em', textTransform: 'uppercase',
            padding: '4px 10px 6px',
          }}>
            {activeCategory.name}
          </div>

          {selectedCategory === 'finder' && (
            <>
              <div style={{ padding: '0 10px 8px' }}>
                <input
                  type="text"
                  value={finderQuery}
                  onChange={(e) => setFinderQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleFinderSearch(); }}
                  placeholder="felt piano, soft mallets, vinyl drums..."
                  style={{
                    width: '100%',
                    fontSize: 9,
                    padding: '7px 8px',
                    borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(10,10,11,0.88)',
                    color: 'var(--text)',
                    outline: 'none',
                  }}
                />
                <div className="flex gap-2" style={{ marginTop: 6 }}>
                  <button
                    className="glass-button flex-1 flex items-center justify-center gap-1 py-1"
                    style={{ fontSize: 8 }}
                    onClick={handleFinderSearch}
                  >
                    <FolderOpen size={9} />
                    <span>{finderLoading ? 'Searching...' : 'Search Local'}</span>
                  </button>
                  <button
                    className="glass-button flex-1 flex items-center justify-center gap-1 py-1"
                    style={{
                      fontSize: 8,
                      background: 'rgba(255,255,255,0.04)',
                      borderColor: 'rgba(255,255,255,0.12)',
                      color: 'var(--text-dim)',
                    }}
                    onClick={handleFinderRefine}
                  >
                    <Sparkles size={9} />
                    <span>Refine</span>
                  </button>
                </div>
                {finderNote && (
                  <div style={{
                    marginTop: 8,
                    fontSize: 8,
                    color: 'var(--text-muted)',
                    lineHeight: 1.5,
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}>
                    {finderNote}
                  </div>
                )}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 6,
                  marginTop: 8,
                }}>
                  <select
                    value={finderFormatFilter}
                    onChange={(e) => setFinderFormatFilter(e.target.value)}
                    style={{
                      fontSize: 8,
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(10,10,11,0.88)',
                      color: 'var(--text)',
                      outline: 'none',
                    }}
                  >
                    <option value="all">All formats</option>
                    {finderFormats.map((format) => (
                      <option key={format} value={format}>{format.toUpperCase()}</option>
                    ))}
                  </select>
                  <select
                    value={finderFamilyFilter}
                    onChange={(e) => setFinderFamilyFilter(e.target.value)}
                    style={{
                      fontSize: 8,
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(10,10,11,0.88)',
                      color: 'var(--text)',
                      outline: 'none',
                    }}
                  >
                    <option value="all">All families</option>
                    {finderFamilies.map((family) => (
                      <option key={family} value={family}>{formatFinderLabel(family)}</option>
                    ))}
                  </select>
                  <select
                    value={finderContentFilter}
                    onChange={(e) => setFinderContentFilter(e.target.value)}
                    style={{
                      fontSize: 8,
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(10,10,11,0.88)',
                      color: 'var(--text)',
                      outline: 'none',
                    }}
                  >
                    <option value="all">All types</option>
                    {finderContentTypes.map((contentType) => (
                      <option key={contentType} value={contentType}>{formatFinderLabel(contentType)}</option>
                    ))}
                  </select>
                </div>
                <div style={{
                  marginTop: 8,
                  padding: '8px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(10,10,11,0.72)',
                }}>
                  <div style={{
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 6,
                  }}>
                    Search Roots
                  </div>
                  <div className="flex gap-2" style={{ marginBottom: 6 }}>
                    <button
                      className="glass-button flex-1 flex items-center justify-center gap-1 py-1"
                      style={{ fontSize: 8 }}
                      onClick={handleAddFinderRoot}
                    >
                      <FolderOpen size={9} />
                      <span>Add Folder</span>
                    </button>
                    <button
                      className="glass-button flex-1 flex items-center justify-center gap-1 py-1"
                      style={{ fontSize: 8 }}
                      onClick={handleReindexFinder}
                    >
                      <Loader2 size={9} />
                      <span>Reindex</span>
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 96, overflowY: 'auto' }}>
                    {finderRoots.map((root) => (
                      <div
                        key={root.path}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 8,
                          color: 'var(--text-dim)',
                          padding: '4px 6px',
                          borderRadius: 4,
                          background: 'rgba(255,255,255,0.03)',
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {root.name}
                        </span>
                        <button
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#f87171',
                            cursor: 'pointer',
                            fontSize: 8,
                            padding: 0,
                          }}
                          onClick={() => handleRemoveFinderRoot(root.path)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {filteredFinderResults.length === 0 && !finderLoading && (
                <div style={{
                  fontSize: 9, color: 'var(--text-muted)',
                  padding: '16px 10px', textAlign: 'center', lineHeight: 1.5,
                }}>
                  {finderResults.length === 0
                    ? 'Search your local library first, then use the free-source cards on the right if you need more material.'
                    : 'No local matches fit the current filters. Loosen the finder filters or run a broader search.'}
                </div>
              )}

              {filteredFinderResults.map((result) => {
                const isSel = selectedFinderResult?.path === result.path;
                const readinessTone = finderReadinessTone(result.readiness);
                return (
                  <div
                    key={result.path}
                    onClick={() => handleLoadFinderResult(result)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      cursor: 'pointer',
                      borderLeft: isSel ? '2px solid rgba(255,255,255,0.32)' : '2px solid transparent',
                      background: isSel ? 'rgba(255,255,255,0.06)' : 'transparent',
                      fontSize: 9,
                      color: isSel ? 'var(--text)' : 'var(--text-dim)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {result.name}
                      </div>
                      <div className="flex items-center gap-1.5" style={{ marginTop: 3, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 9,
                            padding: '2px 5px',
                            borderRadius: 999,
                            background: readinessTone.background,
                            border: `1px solid ${readinessTone.border}`,
                            color: readinessTone.color,
                            lineHeight: 1.1,
                          }}
                        >
                          {formatFinderLabel(result.readiness)}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                          {formatFinderLabel(result.family)} • {formatFinderLabel(result.contentType)}
                        </span>
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                        {result.packageName} • {result.nearbySampleCount} nearby • {result.extensionName.toUpperCase()}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                        {result.source} • {result.kind.toUpperCase()}
                      </div>
                    </div>
                    <button
                      style={{
                        width: 16, height: 16, borderRadius: '50%',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 0,
                      }}
                      title="Load"
                      onClick={(e) => { e.stopPropagation(); handleLoadFinderResult(result); }}
                    >
                      <Play size={7} />
                    </button>
                  </div>
                );
              })}
            </>
          )}

          {/* AI Created category: show presets */}
          {selectedCategory === 'ai' && (
            <>
              {presets.length === 0 && (
                <div style={{
                  fontSize: 9, color: 'var(--text-muted)',
                  padding: '16px 10px', textAlign: 'center', lineHeight: 1.5,
                }}>
                  No AI instruments yet. Use the bar above to create one.
                </div>
              )}
              {presets.map((preset) => {
                const isSel = selectedPreset?.id === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 10px',
                      cursor: 'pointer',
                      borderLeft: isSel ? '2px solid rgba(255,255,255,0.32)' : '2px solid transparent',
                      background: isSel ? 'rgba(255,255,255,0.06)' : 'transparent',
                      fontSize: 9,
                      color: isSel ? 'var(--text)' : 'var(--text-dim)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSel) e.currentTarget.style.background = 'rgba(255,255,255,0.035)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSel) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {preset.name}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                        {GM_PROGRAMS[preset.gmProgram] ?? `Program ${preset.gmProgram}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                      <button
                        style={{
                          width: 16, height: 16, borderRadius: '50%',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: 0,
                        }}
                        title="Preview"
                        onClick={(e) => { e.stopPropagation(); handlePreviewPreset(preset); }}
                      >
                        <Play size={7} />
                      </button>
                      <button
                        style={{
                          width: 16, height: 16, borderRadius: '50%',
                          background: 'rgba(248,113,113,0.06)',
                          border: '1px solid rgba(248,113,113,0.15)',
                          color: '#f87171', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: 0,
                        }}
                        title="Delete"
                        onClick={(e) => { e.stopPropagation(); handleDeletePreset(preset); }}
                      >
                        <Trash2 size={7} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {selectedCategory === 'built-in' && (
            <>
              {BUILT_IN_DEMO_RACKS.map((rack) => {
                const loadedVersion = builtInSampleRacks.find((item) => item.name === rack.name) ?? rack;
                const isSel = selectedSampleRack?.path === rack.path || selectedSampleRack?.name === rack.name;
                return (
                  <div
                    key={rack.path}
                    onClick={() => handleSelectSampleRack(rack)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      cursor: 'pointer',
                      borderLeft: isSel ? '2px solid rgba(255,255,255,0.32)' : '2px solid transparent',
                      background: isSel ? 'rgba(255,255,255,0.06)' : 'transparent',
                      fontSize: 9,
                      color: isSel ? 'var(--text)' : 'var(--text-dim)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSel) e.currentTarget.style.background = 'rgba(255,255,255,0.035)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSel) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rack.name}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                        bundled demo • {loadedVersion.sampleCount} samples • {loadedVersion.zoneCount} zones
                      </div>
                    </div>
                    <button
                      style={{
                        width: 16, height: 16, borderRadius: '50%',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 0,
                      }}
                      title="Preview"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectSampleRack(rack);
                      }}
                    >
                      <Play size={7} />
                    </button>
                  </div>
                );
              })}
            </>
          )}

          {selectedCategory === 'sample-racks' && (
            <>
              {savedSampleRacks.length === 0 && (
                <div style={{
                  fontSize: 9, color: 'var(--text-muted)',
                  padding: '16px 10px', textAlign: 'center', lineHeight: 1.5,
                }}>
                  No saved racks yet. Import samples and save a rack from the left panel.
                </div>
              )}
              {savedSampleRacks.map((rack) => {
                const isSel = selectedSampleRack?.path === rack.path;
                return (
                  <div
                    key={rack.path}
                    onClick={() => handleSelectSampleRack(rack)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      cursor: 'pointer',
                      borderLeft: isSel ? '2px solid rgba(255,255,255,0.32)' : '2px solid transparent',
                      background: isSel ? 'rgba(255,255,255,0.06)' : 'transparent',
                      fontSize: 9,
                      color: isSel ? 'var(--text)' : 'var(--text-dim)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSel) e.currentTarget.style.background = 'rgba(255,255,255,0.035)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSel) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rack.name}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                        {rack.sampleCount} samples • {rack.zoneCount} zones
                      </div>
                    </div>
                    <button
                      style={{
                        width: 16, height: 16, borderRadius: '50%',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 0,
                      }}
                      title="Preview"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectSampleRack(rack);
                      }}
                    >
                      <Play size={7} />
                    </button>
                  </div>
                );
              })}
            </>
          )}

          {/* GM category: show programs */}
          {selectedCategory !== 'ai' && selectedCategory !== 'sample-racks' && categoryInstruments.map(({ program, name }) => {
            const isSel = selectedGMProgram === program;
            const isHovered = hoveredInstrument === program;
            return (
              <div
                key={program}
                onClick={() => handleSelectGMProgram(program)}
                onMouseEnter={() => setHoveredInstrument(program)}
                onMouseLeave={() => setHoveredInstrument(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  borderLeft: isSel ? '2px solid rgba(255,255,255,0.32)' : '2px solid transparent',
                  background: isSel ? 'rgba(255,255,255,0.06)' : 'transparent',
                  fontSize: 9,
                  color: isSel ? 'var(--text)' : 'var(--text-dim)',
                }}
              >
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {name}
                </span>
                {(isHovered || isSel) && (
                  <button
                    style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 0, flexShrink: 0,
                    }}
                    title="Preview"
                    onClick={(e) => { e.stopPropagation(); previewNote(60, 100); }}
                  >
                    <Play size={7} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Column 3: Detail / Editor ── */}
        <div
          className="flex-1 flex flex-col"
          style={{ overflow: 'hidden', minWidth: 0 }}
        >
          {selectedCategory === 'finder' ? (
            <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
              <div style={{
                padding: '10px 16px 8px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                flexShrink: 0,
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                  {selectedFinderResult?.name ?? 'Sample Finder'}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                  {selectedFinderResult
                    ? `${selectedFinderResult.source} • ${selectedFinderResult.path}`
                    : 'Search local folders first, then branch to curated free sources if needed.'}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {selectedFinderResult && (
                  <div style={{
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 10,
                    background: 'rgba(10,10,11,0.72)',
                    padding: 14,
                    marginBottom: 16,
                  }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Local Match
                    </div>
                    {(() => {
                      const readinessTone = finderReadinessTone(selectedFinderResult.readiness);
                      return (
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 8,
                            padding: '4px 8px',
                            borderRadius: 999,
                            background: readinessTone.background,
                            border: `1px solid ${readinessTone.border}`,
                            color: readinessTone.color,
                            marginTop: 8,
                          }}
                        >
                          <span>{formatFinderLabel(selectedFinderResult.readiness)}</span>
                          <span style={{ opacity: 0.7 }}>•</span>
                          <span>{selectedFinderResult.packageName}</span>
                        </div>
                      );
                    })()}
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text)' }}>{selectedFinderResult.name}</div>
                    <div style={{ marginTop: 4, fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {formatFinderLabel(selectedFinderResult.family)} • {formatFinderLabel(selectedFinderResult.contentType)} • {selectedFinderResult.source}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {selectedFinderResult.kind.toUpperCase()} • {selectedFinderResult.extensionName.toUpperCase()} • {formatFileSize(selectedFinderResult.sizeBytes)}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      Package: {selectedFinderResult.packageName} • Nearby sample files: {selectedFinderResult.nearbySampleCount} • Rank: {selectedFinderResult.packageScore}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.5, wordBreak: 'break-all' }}>
                      {selectedFinderResult.path}
                    </div>
                    <div className="flex gap-2" style={{ marginTop: 10 }}>
                      <button
                        className="glass-button flex items-center gap-1.5 px-3 py-1"
                        onClick={() => handleLoadFinderResult(selectedFinderResult)}
                      >
                        <Play size={10} />
                        <span>Load Into Preview</span>
                      </button>
                    </div>
                  </div>
                )}

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 12,
                }}>
                  {FREE_SOURCE_CARDS.map((source) => (
                    <div
                      key={source.id}
                      style={{
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 10,
                        background: 'rgba(10,10,11,0.68)',
                        padding: 14,
                      }}
                    >
                      <div style={{ fontSize: 11, color: 'var(--text)' }}>{source.name}</div>
                      <div style={{ marginTop: 6, fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                        {source.subtitle}
                      </div>
                      <button
                        className="glass-button flex items-center gap-1.5 px-3 py-1"
                        style={{ marginTop: 10, fontSize: 8 }}
                        onClick={() => handleOpenFreeSource(finderQuery, source.buildUrl)}
                      >
                        <FolderOpen size={9} />
                        <span>Open Search</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : !hasSelection ? (
            /* Empty state */
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              color: 'var(--text-muted)',
              gap: 8,
            }}>
              <Music size={32} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 10 }}>Select an instrument to view details</div>
              <div style={{ fontSize: 8, opacity: 0.6 }}>
                Choose a category, then pick an instrument
              </div>
            </div>
          ) : (
            <>
              {/* Top: instrument header */}
              <div style={{
                padding: '10px 16px 8px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                flexShrink: 0,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                      {detailName}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                      {detailDescription}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Save to Library (GM only) */}
                    {selectedGMProgram !== null && (
                      <button
                        className="glass-button flex items-center gap-1.5 px-3 py-1"
                        style={{
                          fontSize: 9,
                          background: 'rgba(255,255,255,0.05)',
                          borderColor: 'rgba(255,255,255,0.12)',
                          color: 'var(--text-dim)',
                        }}
                        onClick={handleSaveGMToLibrary}
                      >
                        <Save size={10} />
                        <span>Save to Library</span>
                      </button>
                    )}
                    {/* Assign to Track */}
                    <button
                      className="glass-button flex items-center gap-1.5 px-4 py-1.5"
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        background: 'rgba(255,255,255,0.08)',
                        borderColor: 'rgba(255,255,255,0.18)',
                        color: 'var(--text)',
                      }}
                      onClick={handleAssignToTrack}
                    >
                      <CheckCircle size={11} />
                      <span>Assign to Track</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Middle: Remotion Player */}
              <div style={{
                flex: 1,
                minHeight: 0,
                position: 'relative',
                overflow: 'hidden',
              }}>
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

              {/* Bottom: ADSR + Filter controls inline */}
              <div style={{
                flexShrink: 0,
                padding: '8px 16px 10px',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(10,10,11,0.76)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 24,
              }}>
                {/* ADSR */}
                <div>
                  <div style={{
                    fontSize: 9, color: 'var(--text-muted)',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    marginBottom: 6,
                  }}>
                    Envelope
                  </div>
                  <div className="flex gap-3">
                    <Knob value={attack} onChange={handleAttackChange} size={30}
                      color="#c5cbd2" label="ATK"
                      displayValue={`${(attack * 1000).toFixed(0)}ms`} />
                    <Knob value={decay} onChange={handleDecayChange} size={30}
                      color="#dde2e8" label="DEC"
                      displayValue={`${(decay * 1000).toFixed(0)}ms`} />
                    <Knob value={sustain} onChange={handleSustainChange} size={30}
                      color="#afb6bf" label="SUS"
                      displayValue={`${Math.round(sustain * 100)}%`} />
                    <Knob value={release} onChange={handleReleaseChange} size={30}
                      color="#8e959d" label="REL"
                      displayValue={`${(release * 1000).toFixed(0)}ms`} />
                  </div>
                </div>

                {/* Filter */}
                <div>
                  <div style={{
                    fontSize: 9, color: 'var(--text-muted)',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    marginBottom: 6,
                  }}>
                    Filter
                  </div>
                  <div className="flex items-end gap-3">
                    <Knob value={cutoff} onChange={handleCutoffChange} size={30}
                      color="#d6be8a" label="CUT"
                      displayValue={`${Math.round(cutoff * 20000)}Hz`} />
                    <Knob value={resonance} onChange={handleResonanceChange} size={30}
                      color="#bfa28a" label="RES"
                      displayValue={`${Math.round(resonance * 100)}%`} />
                    <div className="flex gap-1" style={{ marginBottom: 2 }}>
                      {FILTER_TYPES.map((type, i) => (
                        <button
                          key={type}
                          className={`glass-button px-2 py-1 ${i === filterType ? 'active' : ''}`}
                          style={{ fontSize: 9 }}
                          onClick={() => {
                            setFilterType(i);
                            sendToSwift(BridgeMessages.INSTRUMENT_UPDATE_FILTER, { type: type });
                          }}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{
                    fontSize: 9, color: 'var(--text-muted)',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    marginBottom: 6,
                  }}>
                    Output
                  </div>
                  <div className="flex gap-3">
                    <Knob value={outputGain} onChange={handleOutputGainChange} min={0} max={1.5} size={30}
                      color="#dde2e8" label="GAIN"
                      displayValue={`${Math.round(outputGain * 100)}%`} />
                    <Knob value={outputPan} onChange={handleOutputPanChange} min={-1} max={1} size={30}
                      color="#c5cbd2" label="PAN"
                      displayValue={outputPan === 0 ? 'C' : outputPan < 0 ? `L${Math.round(Math.abs(outputPan) * 100)}` : `R${Math.round(outputPan * 100)}`} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
