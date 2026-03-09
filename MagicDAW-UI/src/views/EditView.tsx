import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Player } from '@remotion/player';
import { MousePointer, Pencil, Eraser, ZoomIn, ZoomOut } from 'lucide-react';
import { LivePianoRoll } from '../compositions/LivePianoRoll';
import type { LivePianoRollProps } from '../compositions/LivePianoRoll';
import { aurora, mockPianoRollNotes } from '../mockData';
import { sendToSwift, onSwiftMessage, BridgeMessages } from '../bridge';
import type { ActiveMidiNote } from '../bridge';
import type { MidiNote } from '../types/daw';

// ── Constants ─────────────────────────────────────────────────────────────────

type Tool = 'select' | 'draw' | 'erase';

const DEFAULT_OCTAVE_RANGE: [number, number] = [2, 6];
const DEFAULT_VISIBLE_BARS = 4;
const DEFAULT_BPM = 92;
const DEFAULT_BEATS_PER_BAR = 4;

// ── Props ─────────────────────────────────────────────────────────────────────

interface EditViewProps {
  trackColor?: string;
  liveActiveNotes?: ActiveMidiNote[];
  bpm?: number;
  beatsPerBar?: number;
  isPlaying?: boolean;
  playheadBeat?: number;
  keySignature?: { key: string; scale: string };
  notes?: MidiNote[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export const EditView: React.FC<EditViewProps> = ({
  trackColor: _trackColor = aurora.cyan,
  liveActiveNotes = [],
  bpm = DEFAULT_BPM,
  beatsPerBar = DEFAULT_BEATS_PER_BAR,
  isPlaying = false,
  playheadBeat = 0,
  keySignature = { key: 'Em', scale: 'natural minor' },
  notes: externalNotes,
}) => {
  const [tool, setTool] = useState<Tool>('select');
  const [visibleBars, setVisibleBars] = useState(DEFAULT_VISIBLE_BARS);
  const [scrollOffsetBeats, setScrollOffsetBeats] = useState(0);
  const [localNotes, setLocalNotes] = useState<MidiNote[]>(
    externalNotes ?? mockPianoRollNotes,
  );
  const [chordName, setChordName] = useState<string | undefined>('Em9');
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync external notes when they change
  useEffect(() => {
    if (externalNotes) {
      setLocalNotes(externalNotes);
    }
  }, [externalNotes]);

  // Listen for chord detection from Swift
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.CHORD_DETECTED, (payload: unknown) => {
      const data = payload as { chord: string };
      setChordName(data.chord || undefined);
    });
    return unsub;
  }, []);

  // Active MIDI pitches array
  const activePitches = useMemo(
    () => liveActiveNotes.map((n) => n.note),
    [liveActiveNotes],
  );

  // Build input props for the Remotion Player
  const inputProps: LivePianoRollProps = useMemo(
    () => ({
      notes: localNotes,
      activeNotes: activePitches,
      playheadBeat,
      isPlaying,
      bpm,
      beatsPerBar,
      visibleBars,
      scrollOffsetBeats,
      octaveRange: DEFAULT_OCTAVE_RANGE,
      selectedTool: tool,
      keySignature: {
        root: keySignature.key,
        mode: keySignature.scale,
      },
      chordName,
    }),
    [
      localNotes,
      activePitches,
      playheadBeat,
      isPlaying,
      bpm,
      beatsPerBar,
      visibleBars,
      scrollOffsetBeats,
      tool,
      keySignature,
      chordName,
    ],
  );

  // ── Scroll / Zoom handlers ──────────────────────────────────────────────────

  const totalBeats = visibleBars * beatsPerBar;

  const handleZoomIn = useCallback(() => {
    setVisibleBars((v) => Math.max(1, v - 1));
  }, []);

  const handleZoomOut = useCallback(() => {
    setVisibleBars((v) => Math.min(16, v + 1));
  }, []);

  const handleScrollLeft = useCallback(() => {
    setScrollOffsetBeats((s) => Math.max(0, s - beatsPerBar));
  }, [beatsPerBar]);

  const handleScrollRight = useCallback(() => {
    setScrollOffsetBeats((s) => s + beatsPerBar);
  }, [beatsPerBar]);

  // Mouse wheel horizontal scroll
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setScrollOffsetBeats((s) => Math.max(0, s + e.deltaX * 0.05));
      } else if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl + scroll = zoom
        if (e.deltaY < 0) {
          setVisibleBars((v) => Math.max(1, v - 1));
        } else {
          setVisibleBars((v) => Math.min(16, v + 1));
        }
      }
    },
    [],
  );

  // ── Note editing via click ──────────────────────────────────────────────────

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (tool === 'select') return;

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;

      // Map to grid coordinates
      const pianoWidthFrac = 52 / 1000; // matches SVG viewBox
      const velLaneFrac = 0.15;
      if (relX < pianoWidthFrac || relY > 1 - velLaneFrac) return;

      const gridX = (relX - pianoWidthFrac) / (1 - pianoWidthFrac - 0.004);
      const gridY = relY / (1 - velLaneFrac);

      const octLow = DEFAULT_OCTAVE_RANGE[0];
      const octHigh = DEFAULT_OCTAVE_RANGE[1];
      const totalKeys = (octHigh - octLow + 1) * 12;
      const midiMin = octLow * 12 + 12;

      const clickBeat = scrollOffsetBeats + gridX * totalBeats;
      const keyIdx = Math.floor(gridY * totalKeys);
      const noteIdx = totalKeys - 1 - keyIdx;
      const midiPitch = midiMin + noteIdx;

      if (midiPitch < 0 || midiPitch > 127) return;

      // Quantize to nearest 16th
      const quantize = 0.25;
      const quantizedBeat =
        Math.round(clickBeat / quantize) * quantize;

      if (tool === 'draw') {
        const newNote: MidiNote = {
          pitch: midiPitch,
          start: quantizedBeat,
          duration: quantize,
          velocity: 100,
          channel: 0,
        };
        setLocalNotes((prev) => [...prev, newNote]);
        // Notify Swift
        sendToSwift(BridgeMessages.MIDI_NOTE_ON, {
          note: midiPitch,
          velocity: 100,
          channel: 0,
        });
      } else if (tool === 'erase') {
        setLocalNotes((prev) =>
          prev.filter(
            (n) =>
              !(
                n.pitch === midiPitch &&
                n.start <= quantizedBeat &&
                n.start + n.duration > quantizedBeat
              ),
          ),
        );
      }
    },
    [tool, scrollOffsetBeats, totalBeats],
  );

  // ── Tool buttons ────────────────────────────────────────────────────────────

  const tools: { id: Tool; icon: React.ReactNode; label: string }[] = [
    { id: 'select', icon: <MousePointer size={12} />, label: 'Select' },
    { id: 'draw', icon: <Pencil size={12} />, label: 'Draw' },
    { id: 'erase', icon: <Eraser size={12} />, label: 'Erase' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-3 py-1 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {tools.map((t) => (
          <button
            key={t.id}
            className={`glass-button flex items-center gap-1.5 px-2 py-1 ${
              tool === t.id ? 'active' : ''
            }`}
            onClick={() => setTool(t.id)}
          >
            {t.icon}
            <span style={{ fontSize: 8 }}>{t.label}</span>
          </button>
        ))}

        <div className="flex-1" />

        {/* Scroll controls */}
        <button
          className="glass-button px-1.5 py-0.5"
          onClick={handleScrollLeft}
          title="Scroll left"
        >
          <span style={{ fontSize: 9 }}>&larr;</span>
        </button>
        <button
          className="glass-button px-1.5 py-0.5"
          onClick={handleScrollRight}
          title="Scroll right"
        >
          <span style={{ fontSize: 9 }}>&rarr;</span>
        </button>

        <span style={{ fontSize: 8, color: 'var(--text-muted)', margin: '0 4px' }}>|</span>

        {/* Zoom controls */}
        <button
          className="glass-button px-1.5 py-0.5"
          onClick={handleZoomIn}
          title="Zoom in"
        >
          <ZoomIn size={10} />
        </button>
        <button
          className="glass-button px-1.5 py-0.5"
          onClick={handleZoomOut}
          title="Zoom out"
        >
          <ZoomOut size={10} />
        </button>

        <span style={{ fontSize: 8, color: 'var(--text-muted)', margin: '0 4px' }}>
          {visibleBars} bar{visibleBars !== 1 ? 's' : ''}
        </span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>|</span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
          Quantize: 1/16
        </span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>|</span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
          Snap: On
        </span>
      </div>

      {/* Remotion Piano Roll */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative"
        onClick={handleCanvasClick}
        onWheel={handleWheel}
        style={{
          cursor:
            tool === 'draw'
              ? 'crosshair'
              : tool === 'erase'
                ? 'not-allowed'
                : 'default',
        }}
      >
        <Player
          component={LivePianoRoll}
          inputProps={inputProps}
          compositionWidth={1000}
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
    </div>
  );
};
