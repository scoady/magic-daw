import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { DAWState, ViewId, LearnSubView, Track, ProjectData, SwiftTrack, InstrumentPreset } from './types/daw';
import { mockDAWState, aurora, trackColorToHex } from './mockData';
import { sendToSwift, onSwiftMessage, onMidiStateChange, BridgeMessages } from './bridge';
import type { ActiveMidiNote, MidiDeviceList } from './bridge';
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
import { LearnPanel } from './components/LearnPanel';
import { ChordBuilderPanel } from './components/ChordBuilderPanel';
import { EmotionsPanel } from './components/EmotionsPanel';
import { ToastProvider, useToast } from './components/Toast';
import { ContextMenuProvider } from './components/ContextMenu';

const VIEW_TABS: { id: ViewId; label: string; key: string }[] = [
  { id: 'arrange', label: 'Arrange', key: '1' },
  { id: 'edit', label: 'Edit', key: '2' },
  { id: 'mix', label: 'Mix', key: '3' },
  { id: 'instruments', label: 'Instruments', key: '4' },
  { id: 'plugins', label: 'Plugins', key: '5' },
  { id: 'chord-builder', label: 'Chord Builder', key: '6' },
  { id: 'learn', label: 'Learn', key: '7' },
  { id: 'emotions', label: 'Emotions of Music', key: '8' },
];

const VIEW_IDS: ViewId[] = VIEW_TABS.map((t) => t.id);

const AppInner: React.FC = () => {
  const [dawState, setDAWState] = useState<DAWState>(mockDAWState);
  const [activeView, setActiveView] = useState<ViewId>('arrange');
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [trackLevels, setTrackLevels] = useState<Record<string, { left: number; right: number }>>({});
  const [liveActiveNotes, setLiveActiveNotes] = useState<ActiveMidiNote[]>([]);
  const [midiDevices, setMidiDevices] = useState<MidiDeviceList>({ sources: [], destinations: [] });
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [instrumentPickerTrackId, setInstrumentPickerTrackId] = useState<string | null>(null);
  const [instrumentPresets, setInstrumentPresets] = useState<InstrumentPreset[]>([]);
  const { showToast } = useToast();

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
      const data = payload as { project: ProjectData };
      const proj = data.project;
      if (!proj) return;

      // Convert Swift tracks to UI tracks
      const uiTracks: Track[] = (proj.tracks || []).map((st: SwiftTrack) => ({
        id: st.id,
        name: st.name,
        type: st.type === 'master' ? 'bus' as const : st.type,
        color: trackColorToHex(st.color),
        volume: st.volume,
        pan: st.pan,
        muted: st.isMuted,
        soloed: st.isSoloed,
        armed: st.isArmed,
        clips: (st.clips || []).map((c) => ({
          id: c.id,
          name: c.name,
          startBar: c.startBar,
          lengthBars: c.lengthBars,
          color: c.color ? trackColorToHex(c.color) : trackColorToHex(st.color),
          notes: c.midiEvents as { id: string; pitch: number; start: number; duration: number; velocity: number; channel: number }[] | undefined,
        })),
      }));

      setDAWState((prev) => ({
        ...prev,
        projectName: proj.name,
        projectSaved: true,
        projectDirty: false,
        transport: {
          ...prev.transport,
          bpm: proj.bpm,
          timeSignature: [
            proj.timeSignature.numerator,
            proj.timeSignature.denominator,
          ],
        },
        tracks: uiTracks.length > 0 ? uiTracks : prev.tracks,
        keySignature: proj.key
          ? { key: proj.key, scale: proj.keyScale ?? '', confidence: 1.0 }
          : prev.keySignature,
        selectedTrackId: uiTracks.length > 0 ? uiTracks[0].id : prev.selectedTrackId,
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
        volume: st.volume,
        pan: st.pan,
        muted: st.isMuted,
        soloed: st.isSoloed,
        armed: st.isArmed,
        clips: (st.clips || []).map((c) => ({
          id: c.id,
          name: c.name,
          startBar: c.startBar,
          lengthBars: c.lengthBars,
          color: c.color ? trackColorToHex(c.color) : trackColorToHex(st.color),
          notes: c.midiEvents as { id: string; pitch: number; start: number; duration: number; velocity: number; channel: number }[] | undefined,
        })),
      }));

      setDAWState((prev) => ({
        ...prev,
        tracks: uiTracks,
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

  // Request instrument preset list on mount
  useEffect(() => {
    sendToSwift(BridgeMessages.INSTRUMENT_LIST_PRESETS);
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
    } else {
      // Reset to default GM piano (program 0)
      sendToSwift(BridgeMessages.INSTRUMENT_ASSIGN_TO_TRACK, {
        trackId,
        gmProgram: 0,
      });
      setDAWState((prev) => ({
        ...prev,
        tracks: prev.tracks.map((t) =>
          t.id === trackId
            ? { ...t, instrumentPresetId: undefined, instrumentPresetName: 'Acoustic Grand Piano' }
            : t,
        ),
      }));
    }
    setInstrumentPickerTrackId(null);
  }, []);

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
            onSwitchView={(view, clipId) => {
              setActiveView(view);
              if (clipId) setEditingClipId(clipId);
            }}
            onToggleMute={handleToggleMute}
            onToggleSolo={handleToggleSolo}
            onToggleArm={handleToggleArm}
            onAddTrack={handleAddTrack}
            onDeleteTrack={handleDeleteTrack}
            onRenameTrack={handleRenameTrack}
            onChangeInstrument={(trackId) => {
              setInstrumentPickerTrackId(trackId);
              sendToSwift(BridgeMessages.INSTRUMENT_LIST_PRESETS);
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
      case 'instruments':
        return <InstrumentView />;
      case 'plugins':
        return <PluginView />;
      case 'chord-builder':
        return <ChordBuilderPanel />;
      case 'learn':
        return <LearnPanel />;
      case 'emotions':
        return <EmotionsPanel />;
    }
  };

  return (
    <div className="flex flex-col h-full w-full relative" style={{ background: 'var(--bg)' }}>
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
        />

        {/* View tabs */}
        <div
          className="flex items-center px-2 shrink-0"
          style={{
            height: 30,
            borderBottom: '1px solid var(--border)',
            background: 'rgba(8, 14, 24, 0.5)',
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
          {activeView !== 'instruments' && activeView !== 'plugins' && activeView !== 'chord-builder' && activeView !== 'learn' && activeView !== 'emotions' && (
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
            onClick={() => setInstrumentPickerTrackId(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                left: 130,
                top: '30%',
                width: 220,
                maxHeight: 300,
                overflowY: 'auto',
                background: 'rgba(10,14,26,0.95)',
                border: '1px solid rgba(103,232,249,0.15)',
                borderRadius: 8,
                padding: 8,
                zIndex: 101,
                backdropFilter: 'blur(12px)',
              }}
            >
              <div style={{
                fontSize: 8,
                color: 'rgba(255,255,255,0.35)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: 6,
              }}>
                Assign Instrument
              </div>
              <div
                onClick={() => handleAssignInstrument(instrumentPickerTrackId, null)}
                style={{
                  padding: '4px 8px',
                  cursor: 'pointer',
                  fontSize: 9,
                  color: 'rgba(255,255,255,0.4)',
                  borderRadius: 4,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(103,232,249,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                None (default piano)
              </div>
              {instrumentPresets.map((preset) => {
                const isActive = dawState.tracks.find((t) => t.id === instrumentPickerTrackId)?.instrumentPresetId === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => handleAssignInstrument(instrumentPickerTrackId, preset)}
                    style={{
                      padding: '4px 8px',
                      cursor: 'pointer',
                      fontSize: 9,
                      color: '#e2e8f0',
                      borderRadius: 4,
                      background: isActive ? 'rgba(167,139,250,0.15)' : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(103,232,249,0.08)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    {preset.name}
                  </div>
                );
              })}
              {instrumentPresets.length === 0 && (
                <div style={{
                  fontSize: 8,
                  color: 'rgba(255,255,255,0.35)',
                  padding: 8,
                  textAlign: 'center',
                }}>
                  No instruments yet — create one in the Instruments tab
                </div>
              )}
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
