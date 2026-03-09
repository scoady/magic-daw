import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { DAWState, ViewId, Track, ProjectData, SwiftTrack } from './types/daw';
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

const VIEW_TABS: { id: ViewId; label: string }[] = [
  { id: 'arrange', label: 'Arrange' },
  { id: 'edit', label: 'Edit' },
  { id: 'mix', label: 'Mix' },
  { id: 'instruments', label: 'Instruments' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'visualizer', label: 'Visualizer' },
];

const App: React.FC = () => {
  const [dawState, setDAWState] = useState<DAWState>(mockDAWState);
  const [activeView, setActiveView] = useState<ViewId>('arrange');
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [trackLevels, setTrackLevels] = useState<Record<string, { left: number; right: number }>>({});
  const [liveActiveNotes, setLiveActiveNotes] = useState<ActiveMidiNote[]>([]);
  const [midiDevices, setMidiDevices] = useState<MidiDeviceList>({ sources: [], destinations: [] });

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
      } else {
        console.error('[Project] Save failed:', data.error);
      }
    });
    return unsub;
  }, []);

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
    setDAWState((prev) => ({
      ...prev,
      transport: { ...prev.transport, recording: !prev.transport.recording },
    }));
    sendToSwift(BridgeMessages.TRANSPORT_RECORD);
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

  // Get selected track color for EditView
  const selectedTrack = dawState.tracks.find(
    (t) => t.id === dawState.selectedTrackId,
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
          />
        );
      case 'edit':
        return <EditView trackColor={selectedTrack?.color ?? aurora.cyan} liveActiveNotes={liveActiveNotes} />;
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
      case 'visualizer':
        return <ChordVisualizerPanel />;
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
          onPlay={handlePlay}
          onStop={handleStop}
          onRecord={handleRecord}
          onRewind={handleRewind}
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
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main area: TrackList sidebar + View content */}
        <div className="flex flex-1 min-h-0">
          {/* Track list sidebar (visible in arrange/edit/mix views) */}
          {activeView !== 'instruments' && activeView !== 'plugins' && activeView !== 'visualizer' && (
            <TrackList
              tracks={dawState.tracks}
              selectedTrackId={dawState.selectedTrackId}
              onSelectTrack={handleSelectTrack}
              onToggleMute={handleToggleMute}
              onToggleSolo={handleToggleSolo}
            />
          )}

          {/* Active view */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {renderView()}
          </div>
        </div>

        {/* Bottom Panel */}
        <BottomPanel
          collapsed={bottomCollapsed}
          onToggle={() => setBottomCollapsed((c) => !c)}
        />
      </div>
    </div>
  );
};

export default App;
