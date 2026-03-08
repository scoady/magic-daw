import React, { useState, useCallback } from 'react';
import type { DAWState, ViewId } from './types/daw';
import { mockDAWState, aurora } from './mockData';
import { sendToSwift, BridgeMessages } from './bridge';
import { TransportBar } from './components/TransportBar';
import { TrackList } from './components/TrackList';
import { BottomPanel } from './components/BottomPanel';
import { ArrangeView } from './views/ArrangeView';
import { EditView } from './views/EditView';
import { MixView } from './views/MixView';
import { InstrumentView } from './views/InstrumentView';
import { PluginView } from './views/PluginView';

const VIEW_TABS: { id: ViewId; label: string }[] = [
  { id: 'arrange', label: 'Arrange' },
  { id: 'edit', label: 'Edit' },
  { id: 'mix', label: 'Mix' },
  { id: 'instruments', label: 'Instruments' },
  { id: 'plugins', label: 'Plugins' },
];

const App: React.FC = () => {
  const [dawState, setDAWState] = useState<DAWState>(mockDAWState);
  const [activeView, setActiveView] = useState<ViewId>('arrange');
  const [bottomCollapsed, setBottomCollapsed] = useState(false);

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
    setDAWState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) =>
        t.id === id ? { ...t, muted: !t.muted } : t,
      ),
    }));
  }, []);

  const handleToggleSolo = useCallback((id: string) => {
    setDAWState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) =>
        t.id === id ? { ...t, soloed: !t.soloed } : t,
      ),
    }));
  }, []);

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
        return <EditView trackColor={selectedTrack?.color ?? aurora.cyan} />;
      case 'mix':
        return <MixView tracks={dawState.tracks} />;
      case 'instruments':
        return <InstrumentView />;
      case 'plugins':
        return <PluginView />;
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
          {(activeView === 'arrange' || activeView === 'edit' || activeView === 'mix') && (
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
