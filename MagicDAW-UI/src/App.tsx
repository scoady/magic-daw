import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { DAWState, ViewId, Track, ProjectData, SwiftTrack, InstrumentPreset, TrackAutomationLane, AutomationLaneType, AutomationPoint } from './types/daw';
import { mockDAWState, aurora, trackColorToHex } from './mockData';
import { sendToSwift, onSwiftMessage, onMidiStateChange, BridgeMessages } from './bridge';
import type { ActiveMidiNote, MidiDeviceList } from './bridge';
import type { SampleRackSummary, SavedPluginGraphSummary } from './bridge';
import { TransportBar } from './components/TransportBar';
import { TrackList } from './components/TrackList';
import { BottomPanel } from './components/BottomPanel';
import { ArrangeView } from './views/ArrangeView';
import { EditView } from './views/EditView';
import { MixView } from './views/MixView';
import { InstrumentView } from './views/InstrumentView';
import { PluginView } from './views/PluginView';
import { ChordVisualizerPanel } from './components/ChordVisualizerPanel';
import { CircleOfFifthsPanel } from './components/CircleOfFifthsPanel';
import { IntervalTrainerPanel } from './components/IntervalTrainerPanel';
import { TheoryPanel } from './components/TheoryPanel';
import { SoundDesignView } from './views/SoundDesignView';
import { ToastProvider, useToast } from './components/Toast';
import { ContextMenuProvider } from './components/ContextMenu';

type RecentInstrumentChoice =
  | { kind: 'gm'; id: string; name: string; gmProgram: number; subtitle: string }
  | { kind: 'rack'; id: string; name: string; path: string; subtitle: string }
  | { kind: 'plugin'; id: string; name: string; path: string; subtitle: string }
  | { kind: 'preset'; id: string; name: string; presetId: string; gmProgram: number; subtitle: string };

const QUICK_GM_INSTRUMENTS = [
  { name: 'Acoustic Grand Piano', gmProgram: 0 },
  { name: 'Electric Piano 1', gmProgram: 4 },
  { name: 'Nylon Guitar', gmProgram: 24 },
  { name: 'Acoustic Bass', gmProgram: 32 },
  { name: 'String Ensemble 1', gmProgram: 48 },
  { name: 'Flute', gmProgram: 73 },
  { name: 'Warm Pad', gmProgram: 89 },
  { name: 'Halo Pad', gmProgram: 94 },
] as const;

function mapSwiftMidiEvents(events: unknown[] | undefined, clipId: string): Track['clips'][number]['notes'] {
  if (!Array.isArray(events)) return undefined;
  const mapped = events.flatMap((event, index) => {
    if (!event || typeof event !== 'object') return [];
    const data = event as Record<string, unknown>;
    const pitchRaw = data.pitch ?? data.note;
    const startRaw = data.start ?? data.tick;
    const durationRaw = data.duration;
    const velocityRaw = data.velocity;
    const channelRaw = data.channel;

    const pitch = typeof pitchRaw === 'number' ? pitchRaw : Number(pitchRaw);
    const start = typeof startRaw === 'number' ? startRaw : Number(startRaw);
    const duration = typeof durationRaw === 'number' ? durationRaw : Number(durationRaw);
    const velocity = typeof velocityRaw === 'number' ? velocityRaw : Number(velocityRaw ?? 100);
    const channel = typeof channelRaw === 'number' ? channelRaw : Number(channelRaw ?? 0);

    if (!Number.isFinite(pitch) || !Number.isFinite(start) || !Number.isFinite(duration)) return [];
    return [{
      id: `${clipId}-note-${index}`,
      pitch,
      start,
      duration,
      velocity: Number.isFinite(velocity) ? velocity : 100,
      channel: Number.isFinite(channel) ? channel : 0,
    }];
  });
  return mapped.length > 0 ? mapped : undefined;
}

function mapSwiftTrackVolume(value: number): number {
  if (value > 0 && value <= 1) return value;
  if (value === 0) return 1;
  if (value <= -96) return 0;
  return Math.max(0, Math.min(1.5, Math.pow(10, value / 20)));
}

function mergeTrackAutomation(previousTracks: Track[], nextTracks: Track[]): Track[] {
  const previousById = new Map(previousTracks.map((track) => [track.id, track]));
  return nextTracks.map((track) => ({
    ...track,
    automation: previousById.get(track.id)?.automation ?? track.automation,
  }));
}

const VIEW_TABS: { id: ViewId; label: string; key: string }[] = [
  { id: 'arrange', label: 'Arrange', key: '1' },
  { id: 'edit', label: 'Edit', key: '2' },
  { id: 'mix', label: 'Mix', key: '3' },
  { id: 'sound-design', label: 'Sound', key: '4' },
  { id: 'theory', label: 'Theory', key: '5' },
];

const VIEW_IDS: ViewId[] = VIEW_TABS.map((t) => t.id);
const DAW_SHELL_VIEWS: ViewId[] = ['arrange', 'edit', 'mix', 'sound-design'];
const initialDAWState: DAWState = {
  ...mockDAWState,
  transport: {
    ...mockDAWState.transport,
    bpm: 120,
    position: { bar: 1, beat: 1, timeMs: 0 },
    loopEnabled: false,
    loopStart: 0,
    loopEnd: 4,
  },
  tracks: [],
  selectedTrackId: null,
  keySignature: {
    key: '',
    scale: '',
    confidence: 0,
  },
  masterLevelL: 0,
  masterLevelR: 0,
  projectName: 'Untitled',
  projectSaved: false,
  projectDirty: false,
};

const AppInner: React.FC = () => {
  const [dawState, setDAWState] = useState<DAWState>(initialDAWState);
  const [activeView, setActiveView] = useState<ViewId>('arrange');
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [trackLevels, setTrackLevels] = useState<Record<string, { left: number; right: number }>>({});
  const [liveActiveNotes, setLiveActiveNotes] = useState<ActiveMidiNote[]>([]);
  const [midiDevices, setMidiDevices] = useState<MidiDeviceList>({ sources: [], destinations: [] });
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [instrumentPickerTrackId, setInstrumentPickerTrackId] = useState<string | null>(null);
  const [instrumentPickerAnchor, setInstrumentPickerAnchor] = useState<{ x: number; y: number } | null>(null);
  const [instrumentPresets, setInstrumentPresets] = useState<InstrumentPreset[]>([]);
  const [sampleRacks, setSampleRacks] = useState<SampleRackSummary[]>([]);
  const [savedPluginGraphs, setSavedPluginGraphs] = useState<SavedPluginGraphSummary[]>([]);
  const [instrumentPickerQuery, setInstrumentPickerQuery] = useState('');
  const [instrumentPickerExpanded, setInstrumentPickerExpanded] = useState(false);
  const [recentInstrumentChoices, setRecentInstrumentChoices] = useState<RecentInstrumentChoice[]>([]);
  const { showToast } = useToast();
  const isDawShellView = DAW_SHELL_VIEWS.includes(activeView);
  const normalizedInstrumentPickerQuery = instrumentPickerQuery.trim().toLowerCase();
  const filteredQuickInstruments = QUICK_GM_INSTRUMENTS.filter((item) =>
    normalizedInstrumentPickerQuery.length === 0 || item.name.toLowerCase().includes(normalizedInstrumentPickerQuery)
  );
  const filteredSampleRacks = sampleRacks.filter((rack) =>
    normalizedInstrumentPickerQuery.length === 0 || rack.name.toLowerCase().includes(normalizedInstrumentPickerQuery)
  );
  const filteredInstrumentPresets = instrumentPresets.filter((preset) =>
    normalizedInstrumentPickerQuery.length === 0
    || preset.name.toLowerCase().includes(normalizedInstrumentPickerQuery)
    || preset.description.toLowerCase().includes(normalizedInstrumentPickerQuery)
  );
  const filteredPluginGraphs = savedPluginGraphs
    .filter((graph) => graph.category === 'instrument')
    .filter((graph) =>
      normalizedInstrumentPickerQuery.length === 0
      || graph.name.toLowerCase().includes(normalizedInstrumentPickerQuery)
      || graph.description.toLowerCase().includes(normalizedInstrumentPickerQuery)
    );
  const filteredRecentInstrumentChoices = recentInstrumentChoices.filter((choice) =>
    normalizedInstrumentPickerQuery.length === 0
    || choice.name.toLowerCase().includes(normalizedInstrumentPickerQuery)
    || choice.subtitle.toLowerCase().includes(normalizedInstrumentPickerQuery)
  );
  const showExpandedInstrumentPicker = instrumentPickerExpanded || normalizedInstrumentPickerQuery.length > 0;
  const featuredSampleRacks = showExpandedInstrumentPicker ? filteredSampleRacks : filteredSampleRacks.slice(0, 4);
  const featuredPluginGraphs = showExpandedInstrumentPicker ? filteredPluginGraphs : filteredPluginGraphs.slice(0, 4);
  const featuredQuickInstruments = showExpandedInstrumentPicker ? filteredQuickInstruments : filteredQuickInstruments.slice(0, 6);
  const shouldShowPresetSection = showExpandedInstrumentPicker && filteredInstrumentPresets.length > 0;
  const hasMoreInstrumentChoices =
    filteredSampleRacks.length > featuredSampleRacks.length
    || filteredPluginGraphs.length > featuredPluginGraphs.length
    || filteredQuickInstruments.length > featuredQuickInstruments.length
    || filteredInstrumentPresets.length > 0;
  const pushRecentInstrumentChoice = useCallback((choice: RecentInstrumentChoice) => {
    setRecentInstrumentChoices((prev) => [
      choice,
      ...prev.filter((item) => item.id !== choice.id),
    ].slice(0, 8));
  }, []);

  // Subscribe to live MIDI state (note on/off from hardware controllers)
  useEffect(() => {
    const unsub = onMidiStateChange((notes, devices) => {
      setLiveActiveNotes(notes);
      setMidiDevices(devices);
    });
    return unsub;
  }, []);

  // Update midiInputActive flag when devices connect/disconnect
  useEffect(() => {
    const hasConnected = midiDevices.sources.some((s) => s.connected);
    setDAWState((prev) => {
      if (prev.midiInputActive === hasConnected) return prev;
      return { ...prev, midiInputActive: hasConnected };
    });
  }, [midiDevices]);

  // Listen for per-track metering data from Swift
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.TRACK_LEVELS, (payload: unknown) => {
      const data = payload as Record<string, { left: number; right: number }>;
      setTrackLevels(data);
    });
    return unsub;
  }, []);

  // Listen for transport state updates from Swift (~30fps when playing)
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.TRANSPORT_STATE, (payload: unknown) => {
      const data = payload as {
        playing: boolean;
        recording: boolean;
        bpm: number;
        bar: number;
        beat: number;
        timeMs: number;
      };
      setDAWState((prev) => ({
        ...prev,
        transport: {
          ...prev.transport,
          playing: data.playing,
          recording: data.recording,
          bpm: data.bpm,
          position: {
            bar: data.bar,
            beat: data.beat,
            timeMs: data.timeMs,
          },
        },
      }));
    });
    return unsub;
  }, []);

  // Listen for master audio level metering from Swift (~20fps for VU meters)
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.AUDIO_LEVELS, (payload: unknown) => {
      const data = payload as { leftLevel: number; rightLevel: number };
      setDAWState((prev) => ({
        ...prev,
        masterLevelL: data.leftLevel,
        masterLevelR: data.rightLevel,
      }));
    });
    return unsub;
  }, []);

  // Listen for project data from Swift (loaded/created projects)
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.PROJECT_DATA, (payload: unknown) => {
      const data = payload as { project: ProjectData; hasFileURL?: boolean; path?: string | null };
      const proj = data.project;
      if (!proj) return;
      setEditingClipId(null);
      setInstrumentPickerTrackId(null);
      setInstrumentPickerAnchor(null);

      // Convert Swift tracks to UI tracks
      const uiTracks: Track[] = (proj.tracks || []).map((st: SwiftTrack) => ({
        id: st.id,
        name: st.name,
        type: st.type === 'master' ? 'bus' as const : st.type,
        color: trackColorToHex(st.color),
        volume: mapSwiftTrackVolume(st.volume),
        pan: st.pan,
        muted: st.isMuted,
        soloed: st.isSoloed,
        armed: st.isArmed,
        instrumentPresetName: st.instrument?.name,
        automation: st.automation,
        clips: (st.clips || []).map((c) => ({
          id: c.id,
          name: c.name,
          startBar: c.startBar,
          lengthBars: c.lengthBars,
          color: c.color ? trackColorToHex(c.color) : trackColorToHex(st.color),
          notes: mapSwiftMidiEvents(c.midiEvents, c.id),
        })),
      }));

      setDAWState((prev) => ({
        ...prev,
        projectName: proj.name,
        projectSaved: Boolean(data.hasFileURL),
        projectDirty: false,
        transport: {
          ...prev.transport,
          bpm: proj.bpm,
          timeSignature: [
            proj.timeSignature.numerator,
            proj.timeSignature.denominator,
          ],
        },
        tracks: mergeTrackAutomation(prev.tracks, uiTracks),
        keySignature: proj.key
          ? { key: proj.key, scale: proj.keyScale ?? '', confidence: 1.0 }
          : { key: '', scale: '', confidence: 0 },
        selectedTrackId: uiTracks[0]?.id ?? null,
      }));
    });
    return unsub;
  }, []);

  // Listen for tracks_updated events from Swift (after add/delete/rename/reorder/color)
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.TRACKS_UPDATED, (payload: unknown) => {
      const data = payload as { tracks: SwiftTrack[] };
      if (!data.tracks) return;

      const uiTracks: Track[] = data.tracks.map((st: SwiftTrack) => ({
        id: st.id,
        name: st.name,
        type: st.type === 'master' ? 'bus' as const : st.type,
        color: trackColorToHex(st.color),
        volume: mapSwiftTrackVolume(st.volume),
        pan: st.pan,
        muted: st.isMuted,
        soloed: st.isSoloed,
        armed: st.isArmed,
        instrumentPresetName: st.instrument?.name,
        automation: st.automation,
        clips: (st.clips || []).map((c) => ({
          id: c.id,
          name: c.name,
          startBar: c.startBar,
          lengthBars: c.lengthBars,
          color: c.color ? trackColorToHex(c.color) : trackColorToHex(st.color),
          notes: mapSwiftMidiEvents(c.midiEvents, c.id),
        })),
      }));

      setDAWState((prev) => ({
        ...prev,
        tracks: mergeTrackAutomation(prev.tracks, uiTracks),
        projectDirty: true,
      }));
    });
    return unsub;
  }, []);

  // Listen for project saved confirmation
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.PROJECT_SAVED, (payload: unknown) => {
      const data = payload as { success: boolean; name?: string; error?: string };
      if (data.success) {
        setDAWState((prev) => ({
          ...prev,
          projectSaved: true,
          projectDirty: false,
          projectName: data.name ?? prev.projectName,
        }));
        showToast('Project saved', 'success');
      } else {
        console.error('[Project] Save failed:', data.error);
        showToast('Save failed: ' + (data.error ?? 'Unknown error'), 'error');
      }
    });
    return unsub;
  }, [showToast]);

  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.PROJECT_LOADED, (payload: unknown) => {
      const data = payload as { success?: boolean; name?: string; error?: string };
      if (data.success === false) {
        showToast('Load failed: ' + (data.error ?? 'Unknown error'), 'error');
      } else if (data.success) {
        showToast(`Loaded ${data.name ?? 'project'}`, 'success');
      }
    });
    return unsub;
  }, [showToast]);

  // Listen for input level metering (during recording/monitoring)
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.INPUT_LEVELS, (payload: unknown) => {
      const data = payload as { left: number; right: number };
      setDAWState((prev) => ({
        ...prev,
        inputLevelL: data.left,
        inputLevelR: data.right,
      }));
    });
    return unsub;
  }, []);

  // Listen for input device list from Swift
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.INPUT_DEVICES, (payload: unknown) => {
      const data = payload as { devices: Array<{ uid: string; name: string; channelCount: number }> };
      setDAWState((prev) => ({
        ...prev,
        inputDevices: data.devices,
      }));
    });
    return unsub;
  }, []);

  // Listen for recording complete events (new clip created)
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.RECORDING_COMPLETE, (payload: unknown) => {
      const data = payload as {
        trackId: string;
        clip: { id: string; name: string; startBar: number; lengthBars: number; audioFile?: string };
      };
      showToast(`Recording saved: ${data.clip.name}`);
    });
    return unsub;
  }, [showToast]);

  // Listen for clip waveform data
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.CLIP_WAVEFORM, (payload: unknown) => {
      const data = payload as { clipId: string; waveform: number[] };
      setDAWState((prev) => ({
        ...prev,
        tracks: prev.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === data.clipId ? { ...c, waveform: data.waveform } : c,
          ),
        })),
      }));
    });
    return unsub;
  }, []);

  // Listen for clip recorded events (MIDI recording finalization)
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.CLIP_RECORDED, (payload: unknown) => {
      const data = payload as {
        trackId: string;
        clipId: string;
        clipName: string;
        startBar: number;
        lengthBars: number;
        notes: Array<{ pitch: number; start: number; duration: number; velocity: number; channel: number }>;
      };
      showToast(`Recorded: ${data.clipName} (${data.notes.length} notes)`, 'success');
      // The tracks_updated event (also sent by finalizeRecording) handles the actual state update
    });
    return unsub;
  }, [showToast]);

  // Listen for export events
  useEffect(() => {
    const unsub1 = onSwiftMessage('export_progress', (payload: unknown) => {
      const data = payload as { status: string; filename: string };
      showToast(`Export: ${data.status}...`);
    });
    const unsub2 = onSwiftMessage('export_complete', (payload: unknown) => {
      const data = payload as { success: boolean; path?: string; filename?: string; error?: string };
      if (data.success) {
        showToast(`Exported: ${data.filename ?? 'audio'}`, 'success');
      } else {
        showToast(`Export failed: ${data.error ?? 'Unknown'}`, 'error');
      }
    });
    return () => { unsub1(); unsub2(); };
  }, [showToast]);

  // Listen for monitor state changes
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.MONITOR_STATE, (payload: unknown) => {
      const data = payload as { enabled: boolean };
      setDAWState((prev) => ({
        ...prev,
        monitorEnabled: data.enabled,
      }));
    });
    return unsub;
  }, []);

  // Request input device list on mount
  useEffect(() => {
    sendToSwift(BridgeMessages.GET_INPUT_DEVICES);
  }, []);

  // Listen for instrument preset list from Swift
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.INSTRUMENT_PRESET_LIST, (payload: unknown) => {
      const data = payload as { presets?: InstrumentPreset[] };
      setInstrumentPresets(data.presets ?? []);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.INSTRUMENT_SAMPLE_RACK_LIST, (payload: unknown) => {
      const data = payload as { racks?: SampleRackSummary[] };
      setSampleRacks(data.racks ?? []);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.PLUGIN_SAVED_LIST, (payload: unknown) => {
      const data = payload as { graphs?: SavedPluginGraphSummary[] };
      setSavedPluginGraphs(data.graphs ?? []);
    });
    return unsub;
  }, []);

  // Request instrument preset list on mount
  useEffect(() => {
    sendToSwift(BridgeMessages.INSTRUMENT_LIST_PRESETS);
    sendToSwift(BridgeMessages.INSTRUMENT_LIST_SAMPLE_RACKS);
    sendToSwift(BridgeMessages.PLUGIN_LIST_SAVED);
  }, []);

  // ── Unsaved changes indicator in window title ──────────────────────────────
  useEffect(() => {
    const dirty = dawState.projectDirty;
    const name = dawState.projectName || 'Untitled';
    const title = dirty ? `${name} *` : name;
    document.title = title;
    sendToSwift('set_window_title', { title: `${dirty ? '\u25CF ' : ''}${name} — Magic DAW` });
  }, [dawState.projectDirty, dawState.projectName]);

  // Send project state updates to Swift when BPM or tracks change
  // (debounced to avoid flooding the bridge)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dawStateRef = useRef(dawState);
  dawStateRef.current = dawState;

  const syncProjectToSwift = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      const s = dawStateRef.current;
      sendToSwift(BridgeMessages.UPDATE_PROJECT_STATE, {
        name: s.projectName,
        bpm: s.transport.bpm,
        timeSignature: {
          numerator: s.transport.timeSignature[0],
          denominator: s.transport.timeSignature[1],
        },
      });
    }, 500);
  }, []);

  // Mark dirty + sync on BPM changes
  const prevBpmRef = useRef(dawState.transport.bpm);
  useEffect(() => {
    if (dawState.transport.bpm !== prevBpmRef.current) {
      prevBpmRef.current = dawState.transport.bpm;
      setDAWState((prev) =>
        prev.projectDirty ? prev : { ...prev, projectDirty: true },
      );
      syncProjectToSwift();
    }
  }, [dawState.transport.bpm, syncProjectToSwift]);

  // Mark dirty on track changes (mute/solo/volume/pan)
  const prevTracksRef = useRef(dawState.tracks);
  useEffect(() => {
    if (dawState.tracks !== prevTracksRef.current) {
      prevTracksRef.current = dawState.tracks;
      setDAWState((prev) =>
        prev.projectDirty ? prev : { ...prev, projectDirty: true },
      );
    }
  }, [dawState.tracks]);

  // Transport handlers
  const handlePlay = useCallback(() => {
    setDAWState((prev) => ({
      ...prev,
      transport: { ...prev.transport, playing: !prev.transport.playing },
    }));
    sendToSwift(BridgeMessages.TRANSPORT_PLAY);
  }, []);

  const handleStop = useCallback(() => {
    setDAWState((prev) => ({
      ...prev,
      transport: {
        ...prev.transport,
        playing: false,
        recording: false,
        position: { bar: 1, beat: 1, timeMs: 0 },
      },
    }));
    sendToSwift(BridgeMessages.TRANSPORT_STOP);
  }, []);

  const handleRecord = useCallback(() => {
    const current = dawStateRef.current;
    if (current.transport.recording) {
      // Stop recording — also stop transport
      setDAWState((prev) => ({
        ...prev,
        transport: { ...prev.transport, playing: false, recording: false },
      }));
      sendToSwift(BridgeMessages.TRANSPORT_STOP);
    } else {
      // Check if any track is armed
      const hasArmedTrack = current.tracks.some((t) => t.armed);
      if (!hasArmedTrack) {
        showToast('Arm a track first (R button)', 'error');
        return;
      }
      // Start recording — also starts playback
      setDAWState((prev) => ({
        ...prev,
        transport: { ...prev.transport, playing: true, recording: true },
      }));
      sendToSwift(BridgeMessages.TRANSPORT_RECORD);
    }
  }, [showToast]);

  const handleNewProject = useCallback(() => {
    if (dawStateRef.current.projectDirty && !window.confirm('Discard unsaved changes and create a new project?')) {
      return;
    }
    setActiveView('arrange');
    sendToSwift(BridgeMessages.NEW_PROJECT);
  }, []);

  const handleOpenProject = useCallback(() => {
    if (dawStateRef.current.projectDirty && !window.confirm('Discard unsaved changes and open another project?')) {
      return;
    }
    setActiveView('arrange');
    sendToSwift(BridgeMessages.LOAD_PROJECT);
  }, []);

  const handleSaveProject = useCallback(() => {
    sendToSwift(BridgeMessages.SAVE_PROJECT);
  }, []);

  const handleSaveProjectAs = useCallback(() => {
    sendToSwift(BridgeMessages.SAVE_PROJECT_AS);
  }, []);

  const handleRewind = useCallback(() => {
    setDAWState((prev) => ({
      ...prev,
      transport: {
        ...prev.transport,
        position: { bar: 1, beat: 1, timeMs: 0 },
      },
    }));
    sendToSwift(BridgeMessages.TRANSPORT_REWIND);
  }, []);

  const handleBpmChange = useCallback((bpm: number) => {
    setDAWState((prev) => ({
      ...prev,
      transport: { ...prev.transport, bpm },
    }));
    sendToSwift(BridgeMessages.SET_BPM, { bpm });
  }, []);

  // Track management handlers
  const handleAddTrack = useCallback((type: 'midi' | 'audio' | 'bus') => {
    const count = dawStateRef.current.tracks.filter((t) => t.type === type).length + 1;
    const name = `${type.charAt(0).toUpperCase() + type.slice(1)} ${count}`;
    sendToSwift(BridgeMessages.ADD_TRACK, { type, name });
    showToast(`Added ${type} track`);
  }, [showToast]);

  const handleDeleteTrack = useCallback((id: string) => {
    sendToSwift(BridgeMessages.DELETE_TRACK, { trackId: id });
    showToast('Track deleted');
  }, [showToast]);

  const handleRenameTrack = useCallback((id: string, name: string) => {
    sendToSwift(BridgeMessages.RENAME_TRACK, { trackId: id, name });
  }, []);

  const handleReorderTracks = useCallback((trackIds: string[]) => {
    sendToSwift(BridgeMessages.REORDER_TRACKS, { trackIds });
  }, []);

  const handleSetTrackColor = useCallback((id: string, color: string) => {
    sendToSwift(BridgeMessages.SET_TRACK_COLOR, { trackId: id, color });
  }, []);

  const handleDuplicateTrack = useCallback((id: string) => {
    const track = dawStateRef.current.tracks.find((t) => t.id === id);
    if (track) {
      sendToSwift(BridgeMessages.ADD_TRACK, { type: track.type, duplicateFrom: id });
      showToast('Track duplicated');
    }
  }, [showToast]);

  // Track handlers
  const handleSelectTrack = useCallback((id: string) => {
    setDAWState((prev) => ({ ...prev, selectedTrackId: id }));
    sendToSwift(BridgeMessages.SELECT_TRACK, { trackId: id });
  }, []);

  const handleToggleMute = useCallback((id: string) => {
    setDAWState((prev) => {
      const track = prev.tracks.find((t) => t.id === id);
      const newMuted = track ? !track.muted : false;
      sendToSwift(BridgeMessages.SET_TRACK_MUTE, { trackId: id, muted: newMuted });
      return {
        ...prev,
        tracks: prev.tracks.map((t) =>
          t.id === id ? { ...t, muted: newMuted } : t,
        ),
      };
    });
  }, []);

  const handleToggleSolo = useCallback((id: string) => {
    setDAWState((prev) => {
      const track = prev.tracks.find((t) => t.id === id);
      const newSoloed = track ? !track.soloed : false;
      sendToSwift(BridgeMessages.SET_TRACK_SOLO, { trackId: id, soloed: newSoloed });
      return {
        ...prev,
        tracks: prev.tracks.map((t) =>
          t.id === id ? { ...t, soloed: newSoloed } : t,
        ),
      };
    });
  }, []);

  const handleTrackVolumeChange = useCallback((id: string, volume: number) => {
    setDAWState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) =>
        t.id === id ? { ...t, volume } : t,
      ),
    }));
    sendToSwift(BridgeMessages.SET_TRACK_VOLUME, { trackId: id, volume });
  }, []);

  const handleTrackPanChange = useCallback((id: string, pan: number) => {
    setDAWState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) =>
        t.id === id ? { ...t, pan } : t,
      ),
    }));
    sendToSwift(BridgeMessages.SET_TRACK_PAN, { trackId: id, pan });
  }, []);

  const handleTrackAutomationChange = useCallback((
    id: string,
    type: AutomationLaneType,
    points: AutomationPoint[],
  ) => {
    const sortedPoints = [...points]
      .map((point) => ({
        bar: Math.max(1, Math.round(point.bar)),
        value: Math.max(0, Math.min(1, point.value)),
      }))
      .sort((a, b) => a.bar - b.bar);

    setDAWState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => {
        if (track.id !== id) return track;
        const existing = track.automation ?? [];
        const otherLanes = existing.filter((lane) => lane.type !== type);
        const nextLane: TrackAutomationLane = {
          id: `${id}-${type}`,
          type,
          enabled: true,
          points: sortedPoints,
        };
        return {
          ...track,
          automation: sortedPoints.length > 0
            ? [...otherLanes, nextLane]
            : otherLanes,
        };
      }),
    }));
    sendToSwift(BridgeMessages.SET_TRACK_AUTOMATION, {
      trackId: id,
      type,
      points: sortedPoints,
      enabled: true,
    });
  }, []);

  const handleToggleArm = useCallback((id: string) => {
    setDAWState((prev) => {
      const track = prev.tracks.find((t) => t.id === id);
      const newArmed = track ? !track.armed : false;
      sendToSwift(BridgeMessages.ARM_TRACK, { trackId: id, armed: newArmed });
      return {
        ...prev,
        tracks: prev.tracks.map((t) =>
          t.id === id ? { ...t, armed: newArmed } : t,
        ),
      };
    });
  }, []);

  const handleToggleMonitor = useCallback(() => {
    setDAWState((prev) => {
      const newEnabled = !prev.monitorEnabled;
      sendToSwift(BridgeMessages.SET_MONITOR, { enabled: newEnabled });
      return { ...prev, monitorEnabled: newEnabled };
    });
  }, []);

  const handleMetronomeToggle = useCallback((enabled: boolean) => {
    setDAWState((prev) => ({
      ...prev,
      transport: { ...prev.transport, metronomeEnabled: enabled },
    }));
    sendToSwift(BridgeMessages.SET_METRONOME, { enabled });
  }, []);

  const handleLoopToggle = useCallback((enabled: boolean) => {
    setDAWState((prev) => ({
      ...prev,
      transport: { ...prev.transport, loopEnabled: enabled },
    }));
    sendToSwift(BridgeMessages.SET_LOOP_ENABLED, { enabled });
  }, []);

  const handleLoopRegionChange = useCallback((startBar: number, endBar: number) => {
    setDAWState((prev) => ({
      ...prev,
      transport: { ...prev.transport, loopStart: startBar, loopEnd: endBar },
    }));
    sendToSwift(BridgeMessages.SET_LOOP_REGION, { startBar, endBar });
  }, []);

  const handleCountInToggle = useCallback((enabled: boolean) => {
    setDAWState((prev) => ({
      ...prev,
      transport: { ...prev.transport, countInEnabled: enabled },
    }));
    sendToSwift(BridgeMessages.SET_COUNT_IN, { enabled });
  }, []);

  const handleExportAudio = useCallback(() => {
    // Calculate total beats from tracks
    let maxEndBar = 0;
    for (const track of dawStateRef.current.tracks) {
      for (const clip of track.clips) {
        const end = clip.startBar + clip.lengthBars;
        if (end > maxEndBar) maxEndBar = end;
      }
    }
    const totalBeats = Math.max(32, maxEndBar) * 4; // 4 beats per bar
    const projectName = dawStateRef.current.projectName || 'Untitled';
    sendToSwift(BridgeMessages.EXPORT_AUDIO, {
      totalBeats,
      filename: projectName,
    });
    showToast('Exporting audio...');
  }, [showToast]);

  const handleTrackEffectChange = useCallback(
    (trackId: string, effectIndex: number, paramName: string, value: number) => {
      sendToSwift(BridgeMessages.SET_TRACK_EFFECT, {
        trackId,
        effectIndex,
        paramName,
        value,
      });
    },
    [],
  );

  // ── Instrument Assignment ──────────────────────────────────────────────────
  const handleAssignInstrument = useCallback((trackId: string, preset: InstrumentPreset | null) => {
    if (preset) {
      sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, {
        trackId,
        presetId: preset.id,
      });
      // Optimistically update local state
      setDAWState((prev) => ({
        ...prev,
        tracks: prev.tracks.map((t) =>
          t.id === trackId
            ? { ...t, instrumentPresetId: preset.id, instrumentPresetName: preset.name }
            : t,
        ),
      }));
      pushRecentInstrumentChoice({
        kind: 'preset',
        id: `preset-${preset.id}`,
        name: preset.name,
        presetId: preset.id,
        gmProgram: preset.gmProgram,
        subtitle: preset.description || 'Saved preset',
      });
    } else {
      // Reset to default GM piano (program 0)
      sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, {
        trackId,
        gmProgram: 0,
        name: 'Acoustic Grand Piano',
      });
      setDAWState((prev) => ({
        ...prev,
        tracks: prev.tracks.map((t) =>
          t.id === trackId
            ? { ...t, instrumentPresetId: undefined, instrumentPresetName: 'Acoustic Grand Piano' }
            : t,
        ),
      }));
      pushRecentInstrumentChoice({
        kind: 'gm',
        id: 'gm-0',
        name: 'Acoustic Grand Piano',
        gmProgram: 0,
        subtitle: 'General MIDI',
      });
    }
    setInstrumentPickerTrackId(null);
    setInstrumentPickerAnchor(null);
  }, [pushRecentInstrumentChoice]);

  const handleAssignGMInstrument = useCallback((trackId: string, gmProgram: number, name: string) => {
    sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, {
      trackId,
      gmProgram,
      name,
    });
    setDAWState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) =>
        t.id === trackId
          ? { ...t, instrumentPresetId: undefined, instrumentPresetName: name }
          : t,
      ),
    }));
    pushRecentInstrumentChoice({
      kind: 'gm',
      id: `gm-${gmProgram}`,
      name,
      gmProgram,
      subtitle: 'General MIDI',
    });
    setInstrumentPickerTrackId(null);
    setInstrumentPickerAnchor(null);
  }, [pushRecentInstrumentChoice]);

  const handleAssignSampleRack = useCallback((trackId: string, rack: SampleRackSummary) => {
    sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, {
      trackId,
      sampleRackPath: rack.path,
    });
    setDAWState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) =>
        t.id === trackId
          ? { ...t, instrumentPresetId: undefined, instrumentPresetName: rack.name }
          : t,
      ),
    }));
    pushRecentInstrumentChoice({
      kind: 'rack',
      id: `rack-${rack.path}`,
      name: rack.name,
      path: rack.path,
      subtitle: `${rack.sampleCount} samples • ${rack.zoneCount} zones`,
    });
    setInstrumentPickerTrackId(null);
    setInstrumentPickerAnchor(null);
  }, [pushRecentInstrumentChoice]);

  const handleAssignPluginGraph = useCallback((trackId: string, graph: SavedPluginGraphSummary) => {
    sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, {
      trackId,
      pluginGraphPath: graph.path,
    });
    setDAWState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) =>
        t.id === trackId
          ? { ...t, instrumentPresetId: undefined, instrumentPresetName: graph.name }
          : t,
      ),
    }));
    pushRecentInstrumentChoice({
      kind: 'plugin',
      id: `plugin-${graph.path}`,
      name: graph.name,
      path: graph.path,
      subtitle: graph.description || 'Saved graph synth',
    });
    setInstrumentPickerTrackId(null);
    setInstrumentPickerAnchor(null);
  }, [pushRecentInstrumentChoice]);

  // ── Global Keyboard Shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't capture shortcuts when typing in an input or textarea
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;

      // Space: Play/Stop toggle
      if (e.code === 'Space' && !meta) {
        e.preventDefault();
        handlePlay();
        showToast(dawStateRef.current.transport.playing ? 'Stop' : 'Play');
        return;
      }

      // R: Record (without meta)
      if (e.key === 'r' && !meta && !shift) {
        e.preventDefault();
        handleRecord();
        showToast(dawStateRef.current.transport.recording ? 'Record Off' : 'Record On');
        return;
      }

      // Cmd+Z: Undo
      if (e.key === 'z' && meta && !shift) {
        showToast('Undo');
        return;
      }

      // Cmd+Shift+Z: Redo
      if (e.key === 'z' && meta && shift) {
        showToast('Redo');
        return;
      }

      // Cmd+S: Save
      if (e.key === 's' && meta && !shift) {
        e.preventDefault();
        sendToSwift(BridgeMessages.SAVE_PROJECT);
        showToast('Saving...');
        return;
      }

      // Cmd+E: Export audio
      if (e.key === 'e' && meta && !shift) {
        e.preventDefault();
        handleExportAudio();
        return;
      }

      // Cmd+T: Add new track
      if (e.key === 't' && meta && !shift) {
        e.preventDefault();
        handleAddTrack('midi');
        return;
      }

      // 1-6: Switch views
      if (!meta && !shift && e.key >= '1' && e.key <= '7') {
        const idx = parseInt(e.key) - 1;
        if (idx < VIEW_IDS.length) {
          e.preventDefault();
          setActiveView(VIEW_IDS[idx]);
          showToast(`View: ${VIEW_TABS[idx].label}`);
        }
        return;
      }

      // Tab: Cycle views
      if (e.key === 'Tab' && !meta) {
        e.preventDefault();
        setActiveView((prev) => {
          const idx = VIEW_IDS.indexOf(prev);
          const next = shift
            ? (idx - 1 + VIEW_IDS.length) % VIEW_IDS.length
            : (idx + 1) % VIEW_IDS.length;
          showToast(`View: ${VIEW_TABS[next].label}`);
          return VIEW_IDS[next];
        });
        return;
      }

      // Backspace/Delete: Delete selected items
      if ((e.key === 'Backspace' || e.key === 'Delete') && !meta) {
        e.preventDefault();
        sendToSwift('delete_selected', {});
        showToast('Deleted');
        return;
      }

      // Cmd+A: Select all
      if (e.key === 'a' && meta) {
        e.preventDefault();
        sendToSwift('select_all', {});
        showToast('Select All');
        return;
      }

      // Cmd+D: Duplicate selected
      if (e.key === 'd' && meta) {
        e.preventDefault();
        sendToSwift('duplicate_selected', {});
        showToast('Duplicated');
        return;
      }

      // +/-: Zoom in/out
      if ((e.key === '=' || e.key === '+') && !meta) {
        e.preventDefault();
        sendToSwift('zoom_in', {});
        showToast('Zoom In');
        return;
      }
      if (e.key === '-' && !meta) {
        e.preventDefault();
        sendToSwift('zoom_out', {});
        showToast('Zoom Out');
        return;
      }

      // Home: Go to beginning
      if (e.key === 'Home') {
        e.preventDefault();
        handleRewind();
        showToast('Go to Beginning');
        return;
      }

      // Left/Right arrows: Nudge playhead by 1 bar
      if (e.key === 'ArrowLeft' && !meta && !shift) {
        e.preventDefault();
        setDAWState((prev) => ({
          ...prev,
          transport: {
            ...prev.transport,
            position: {
              ...prev.transport.position,
              bar: Math.max(1, prev.transport.position.bar - 1),
            },
          },
        }));
        sendToSwift('nudge_playhead', { bars: -1 });
        return;
      }
      if (e.key === 'ArrowRight' && !meta && !shift) {
        e.preventDefault();
        setDAWState((prev) => ({
          ...prev,
          transport: {
            ...prev.transport,
            position: {
              ...prev.transport.position,
              bar: prev.transport.position.bar + 1,
            },
          },
        }));
        sendToSwift('nudge_playhead', { bars: 1 });
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlay, handleRecord, handleRewind, handleAddTrack, handleExportAudio, showToast]);

  // Get selected track color for EditView
  const selectedTrack = useMemo(
    () => dawState.tracks.find((t) => t.id === dawState.selectedTrackId),
    [dawState.tracks, dawState.selectedTrackId],
  );

  useEffect(() => {
    if (dawState.selectedTrackId) {
      sendToSwift(BridgeMessages.SELECT_TRACK, { trackId: dawState.selectedTrackId });
    }
  }, [dawState.selectedTrackId]);
  const pickerTrack = useMemo(
    () => dawState.tracks.find((t) => t.id === instrumentPickerTrackId) ?? null,
    [dawState.tracks, instrumentPickerTrackId],
  );

  // Render the active view
  const renderView = () => {
    switch (activeView) {
      case 'arrange':
        return (
          <ArrangeView
            tracks={dawState.tracks}
            bpm={dawState.transport.bpm}
            playing={dawState.transport.playing}
            recording={dawState.transport.recording}
            transportPosition={dawState.transport.position}
            selectedTrackId={dawState.selectedTrackId}
            onSwitchView={(view, clipId) => {
              setActiveView(view);
              if (clipId) setEditingClipId(clipId);
            }}
            onSelectTrack={handleSelectTrack}
            onToggleMute={handleToggleMute}
            onToggleSolo={handleToggleSolo}
            onToggleArm={handleToggleArm}
            onAddTrack={handleAddTrack}
            onDeleteTrack={handleDeleteTrack}
            onRenameTrack={handleRenameTrack}
            onAutomationChange={handleTrackAutomationChange}
            onChangeInstrument={(trackId, anchor) => {
              setDAWState((prev) => ({ ...prev, selectedTrackId: trackId }));
              setInstrumentPickerTrackId(trackId);
              setInstrumentPickerAnchor(anchor ?? null);
              setInstrumentPickerQuery('');
              setInstrumentPickerExpanded(false);
              sendToSwift(BridgeMessages.INSTRUMENT_LIST_PRESETS);
              sendToSwift(BridgeMessages.INSTRUMENT_LIST_SAMPLE_RACKS);
            }}
          />
        );
      case 'edit':
        return <EditView trackColor={selectedTrack?.color ?? aurora.cyan} liveActiveNotes={liveActiveNotes} clipId={editingClipId ?? undefined} />;
      case 'mix':
        return (
          <MixView
            tracks={dawState.tracks}
            trackLevels={trackLevels}
            onVolumeChange={handleTrackVolumeChange}
            onPanChange={handleTrackPanChange}
            onMuteToggle={handleToggleMute}
            onSoloToggle={handleToggleSolo}
            onEffectChange={handleTrackEffectChange}
          />
        );
      case 'sound-design':
        return <SoundDesignView selectedTrackId={dawState.selectedTrackId} />;
      case 'theory':
        return <TheoryPanel />;
    }
  };

  return (
    <div className={`flex flex-col h-full w-full relative ${isDawShellView ? 'daw-shell' : ''}`} style={{ background: 'var(--bg)' }}>
      {/* Aurora animated background */}
      <div className="aurora-bg">
        <div className="aurora-orb" />
        <div className="aurora-orb" />
        <div className="aurora-orb" />
        <div className="aurora-orb" />
      </div>
      <div className="noise-overlay" />
      <div className="scanlines" />

      {/* Main content (above background) */}
      <div className="relative z-10 flex flex-col h-full">
        {/* Transport Bar */}
        <TransportBar
          bpm={dawState.transport.bpm}
          onBpmChange={handleBpmChange}
          keySignature={dawState.keySignature}
          timeSignature={dawState.transport.timeSignature}
          playing={dawState.transport.playing}
          recording={dawState.transport.recording}
          position={dawState.transport.position}
          masterLevelL={dawState.masterLevelL}
          masterLevelR={dawState.masterLevelR}
          midiInputActive={dawState.midiInputActive}
          ollamaConnected={dawState.ollamaConnected}
          metronomeEnabled={dawState.transport.metronomeEnabled}
          loopEnabled={dawState.transport.loopEnabled}
          loopStart={dawState.transport.loopStart}
          loopEnd={dawState.transport.loopEnd}
          countInEnabled={dawState.transport.countInEnabled}
          onPlay={handlePlay}
          onStop={handleStop}
          onRecord={handleRecord}
          onRewind={handleRewind}
          onMetronomeToggle={handleMetronomeToggle}
          onLoopToggle={handleLoopToggle}
          onLoopRegionChange={handleLoopRegionChange}
          onCountInToggle={handleCountInToggle}
          projectDirty={dawState.projectDirty}
          projectName={dawState.projectName}
          onNewProject={handleNewProject}
          onOpenProject={handleOpenProject}
          onSaveProject={handleSaveProject}
          onSaveProjectAs={handleSaveProjectAs}
        />

        {/* View tabs */}
        <div
          className="flex items-center px-2 shrink-0"
          style={{
            height: 30,
            borderBottom: '1px solid var(--border)',
            background: isDawShellView ? 'rgba(7, 7, 8, 0.78)' : 'rgba(8, 14, 24, 0.5)',
          }}
        >
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`view-tab ${activeView === tab.id ? 'active' : ''}`}
              onClick={() => setActiveView(tab.id)}
              title={`${tab.label} (${tab.key})`}
            >
              {tab.label}
              <span style={{ fontSize: 7, color: 'var(--text-muted)', marginLeft: 4, opacity: 0.6 }}>
                {tab.key}
              </span>
            </button>
          ))}
        </div>

        {/* Main area: TrackList sidebar + View content */}
        <div className="flex flex-1 min-h-0">
          {/* Track list sidebar (visible in arrange/edit/mix views) */}
          {activeView !== 'sound-design' && activeView !== 'theory' && (
            <TrackList
              tracks={dawState.tracks}
              selectedTrackId={dawState.selectedTrackId}
              onSelectTrack={handleSelectTrack}
              onToggleMute={handleToggleMute}
              onToggleSolo={handleToggleSolo}
              onAddTrack={handleAddTrack}
              onDeleteTrack={handleDeleteTrack}
              onRenameTrack={handleRenameTrack}
              onReorderTracks={handleReorderTracks}
              onSetTrackColor={handleSetTrackColor}
              onDuplicateTrack={handleDuplicateTrack}
              onToggleArm={handleToggleArm}
            />
          )}

          {/* Active view */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {renderView()}
          </div>
        </div>

        {/* Instrument Picker Popover */}
        {instrumentPickerTrackId && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 100 }}
            onClick={() => {
              setInstrumentPickerTrackId(null);
              setInstrumentPickerAnchor(null);
              setInstrumentPickerQuery('');
              setInstrumentPickerExpanded(false);
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                left: instrumentPickerAnchor ? Math.min(Math.max(24, instrumentPickerAnchor.x + 12), window.innerWidth - 376) : 130,
                top: instrumentPickerAnchor ? Math.min(Math.max(56, instrumentPickerAnchor.y - 18), window.innerHeight - 476) : Math.round(window.innerHeight * 0.22),
                width: 352,
                maxHeight: 452,
                overflowY: 'auto',
                background: isDawShellView ? 'rgba(10,10,11,0.96)' : 'rgba(10,14,26,0.95)',
                border: isDawShellView ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(103,232,249,0.15)',
                borderRadius: 8,
                padding: 10,
                zIndex: 101,
                backdropFilter: 'blur(12px)',
              }}
            >
              <div style={{
                fontSize: 8,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: 4,
              }}>
                Track Instrument
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.1 }}>
                    {pickerTrack?.name ?? 'Selected Track'}
                  </div>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 3 }}>
                    Current: {pickerTrack?.instrumentPresetName ?? 'Acoustic Grand Piano'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    className="glass-button"
                    style={{ padding: '6px 8px', fontSize: 8, color: 'var(--text-dim)' }}
                    onClick={() => {
                      setInstrumentPickerTrackId(null);
                      setInstrumentPickerAnchor(null);
                      setInstrumentPickerQuery('');
                      setInstrumentPickerExpanded(false);
                      setActiveView('sound-design');
                    }}
                  >
                    Open Library
                  </button>
                  <button
                    className="glass-button"
                    style={{ padding: '6px 8px', fontSize: 8, color: 'var(--text-dim)' }}
                    onClick={() => {
                      setInstrumentPickerTrackId(null);
                      setInstrumentPickerAnchor(null);
                      setInstrumentPickerQuery('');
                      setInstrumentPickerExpanded(false);
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
              <input
                value={instrumentPickerQuery}
                onChange={(e) => setInstrumentPickerQuery(e.target.value)}
                placeholder="Search pianos, racks, presets..."
                autoFocus
                style={{
                  width: '100%',
                  marginBottom: 10,
                  padding: '7px 9px',
                  fontSize: 10,
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.09)',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text)',
                  outline: 'none',
                }}
              />
              <div
                onClick={() => handleAssignGMInstrument(instrumentPickerTrackId, 0, 'Acoustic Grand Piano')}
                style={{
                  padding: '6px 8px',
                  cursor: 'pointer',
                  fontSize: 9,
                  color: 'var(--text-dim)',
                  borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.06)',
                  background: 'rgba(255,255,255,0.03)',
                  marginBottom: 10,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = isDawShellView ? 'rgba(255,255,255,0.06)' : 'rgba(103,232,249,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Reset to default piano
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {featuredSampleRacks.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Best Sounds
                      </div>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                        Saved sample racks
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {featuredSampleRacks.map((rack) => (
                        <button
                          key={rack.path}
                          className="glass-button"
                          onClick={() => handleAssignSampleRack(instrumentPickerTrackId, rack)}
                          style={{
                            padding: '8px 9px',
                            textAlign: 'left',
                          }}
                        >
                          <div style={{ fontSize: 9, color: 'var(--text)' }}>{rack.name}</div>
                          <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2 }}>
                            {rack.sampleCount} samples • {rack.zoneCount} zones
                          </div>
                        </button>
                      ))}
                    </div>
                    {!showExpandedInstrumentPicker && filteredSampleRacks.length > featuredSampleRacks.length && (
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 5 }}>
                        Saved racks are the fastest route to better sound.
                      </div>
                    )}
                  </div>
                )}

                {featuredPluginGraphs.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Graph Synths
                      </div>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                        Saved from Plugins
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {featuredPluginGraphs.map((graph) => (
                        <button
                          key={graph.path}
                          className="glass-button"
                          onClick={() => handleAssignPluginGraph(instrumentPickerTrackId, graph)}
                          style={{
                            padding: '8px 9px',
                            textAlign: 'left',
                          }}
                        >
                          <div style={{ fontSize: 9, color: 'var(--text)' }}>{graph.name}</div>
                          <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2 }}>
                            {graph.description || 'Saved graph synth'}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {filteredRecentInstrumentChoices.length > 0 && (
                  <div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                      Recent
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {filteredRecentInstrumentChoices.map((choice) => (
                        <button
                          key={choice.id}
                          className="glass-button"
                          onClick={() => {
                            if (choice.kind === 'gm') handleAssignGMInstrument(instrumentPickerTrackId, choice.gmProgram, choice.name);
                            if (choice.kind === 'rack') handleAssignSampleRack(instrumentPickerTrackId, { path: choice.path, name: choice.name, sampleCount: 0, zoneCount: 0 });
                            if (choice.kind === 'plugin') handleAssignPluginGraph(instrumentPickerTrackId, {
                              path: choice.path,
                              name: choice.name,
                              category: 'instrument',
                              description: choice.subtitle,
                              version: '1.0',
                              modifiedAt: new Date().toISOString(),
                            });
                            if (choice.kind === 'preset') {
                              const preset = instrumentPresets.find((item) => item.id === choice.presetId);
                              if (preset) handleAssignInstrument(instrumentPickerTrackId, preset);
                            }
                          }}
                          style={{ padding: '7px 8px', textAlign: 'left' }}
                        >
                          <div style={{ fontSize: 9, color: 'var(--text)' }}>{choice.name}</div>
                          <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2 }}>{choice.subtitle}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    Quick Picks
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                    {featuredQuickInstruments.map((item) => (
                      <button
                        key={item.gmProgram}
                        className="glass-button"
                        onClick={() => handleAssignGMInstrument(instrumentPickerTrackId, item.gmProgram, item.name)}
                        style={{
                          padding: '7px 8px',
                          textAlign: 'left',
                          fontSize: 9,
                          color: 'var(--text)',
                        }}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                </div>

                {!showExpandedInstrumentPicker && hasMoreInstrumentChoices && (
                  <button
                    className="glass-button"
                    onClick={() => setInstrumentPickerExpanded(true)}
                    style={{
                      padding: '8px 9px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 9,
                      color: 'var(--text)',
                    }}
                  >
                    <span>More Sounds</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 8 }}>
                      racks • presets • full list
                    </span>
                  </button>
                )}

                {shouldShowPresetSection && (
                  <div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                      AI + Saved Presets
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {filteredInstrumentPresets.map((preset) => {
                        const isActive = dawState.tracks.find((t) => t.id === instrumentPickerTrackId)?.instrumentPresetId === preset.id;
                        return (
                          <button
                            key={preset.id}
                            className="glass-button"
                            onClick={() => handleAssignInstrument(instrumentPickerTrackId, preset)}
                            style={{
                              padding: '7px 8px',
                              textAlign: 'left',
                              background: isActive ? 'rgba(255,255,255,0.08)' : undefined,
                            }}
                          >
                            <div style={{ fontSize: 9, color: 'var(--text)' }}>{preset.name}</div>
                            <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2 }}>
                              {preset.description}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Bottom Panel */}
        <BottomPanel
          collapsed={bottomCollapsed}
          onToggle={() => setBottomCollapsed((c) => !c)}
        />
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <ToastProvider>
      <ContextMenuProvider>
        <AppInner />
      </ContextMenuProvider>
    </ToastProvider>
  );
};

export default App;
