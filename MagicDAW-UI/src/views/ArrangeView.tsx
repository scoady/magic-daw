import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Player } from '@remotion/player';
import { ZoomIn, ZoomOut } from 'lucide-react';
import type { Track } from '../types/daw';
import { LiveArrange } from '../compositions/LiveArrange';
import type { LiveArrangeProps } from '../compositions/LiveArrange';

interface ArrangeViewProps {
  tracks: Track[];
  bpm: number;
  playing: boolean;
}

const TOTAL_BARS = 32;
const BEATS_PER_BAR = 4;
const FPS = 30;
const DURATION_FRAMES = 9000; // 5 minutes at 30fps
const HEADER_W = 120;

export const ArrangeView: React.FC<ArrangeViewProps> = ({ tracks, bpm, playing }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [playheadBeat, setPlayheadBeat] = useState(0);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 400 });

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [dragTarget, setDragTarget] = useState<'playhead' | 'clip' | 'scroll' | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0, startVal: 0 });

  // Visible bars based on zoom
  const visibleBars = useMemo(() => TOTAL_BARS / zoom, [zoom]);

  // Measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height),
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Animate playhead when playing
  useEffect(() => {
    if (!playing) return;
    const beatsPerSecond = bpm / 60;
    const interval = setInterval(() => {
      setPlayheadBeat((prev) => {
        const next = prev + beatsPerSecond / FPS;
        const totalBeats = TOTAL_BARS * BEATS_PER_BAR;
        return next >= totalBeats ? 0 : next;
      });
    }, 1000 / FPS);
    return () => clearInterval(interval);
  }, [playing, bpm]);

  // Bar width for mouse hit-testing
  const gridW = containerSize.width - HEADER_W;
  const barW = gridW / visibleBars;

  // Convert screen X to bar position
  const xToBar = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const relX = clientX - rect.left - HEADER_W;
      return scrollOffset + relX / barW;
    },
    [scrollOffset, barW],
  );

  // Find clip under mouse
  const clipAtPosition = useCallback(
    (clientX: number, clientY: number): string | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const relX = clientX - rect.left - HEADER_W;
      const relY = clientY - rect.top - 32 - 24; // ruler + energy height
      if (relX < 0 || relY < 0) return null;

      const bar = scrollOffset + relX / barW + 1;
      const trackIdx = Math.floor(relY / 60);
      if (trackIdx < 0 || trackIdx >= tracks.length) return null;

      const track = tracks[trackIdx];
      for (const clip of track.clips) {
        if (bar >= clip.startBar && bar < clip.startBar + clip.lengthBars) {
          return clip.id;
        }
      }
      return null;
    },
    [scrollOffset, barW, tracks],
  );

  // Find track under mouse
  const trackAtY = useCallback(
    (clientY: number): string | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const relY = clientY - rect.top - 32 - 24;
      const trackIdx = Math.floor(relY / 60);
      if (trackIdx < 0 || trackIdx >= tracks.length) return null;
      return tracks[trackIdx].id;
    },
    [tracks],
  );

  // Mouse down — determine drag target
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;

      // Ruler area — playhead scrub
      if (relY < 32 && relX > HEADER_W) {
        const bar = xToBar(e.clientX);
        setPlayheadBeat(bar * BEATS_PER_BAR);
        setIsDragging(true);
        setDragTarget('playhead');
        dragStartRef.current = { x: e.clientX, y: e.clientY, startVal: bar };
        return;
      }

      // Track area — clip selection or track selection
      if (relX > HEADER_W && relY > 56) {
        const clipId = clipAtPosition(e.clientX, e.clientY);
        if (clipId) {
          setSelectedClipId(clipId);
          setIsDragging(true);
          setDragTarget('clip');
          dragStartRef.current = { x: e.clientX, y: e.clientY, startVal: 0 };
        } else {
          setSelectedClipId(null);
        }
        const trackId = trackAtY(e.clientY);
        if (trackId) {
          setSelectedTrackId(trackId);
        }
        return;
      }

      // Header area — track selection
      if (relX <= HEADER_W && relY > 56) {
        const trackId = trackAtY(e.clientY);
        if (trackId) {
          setSelectedTrackId(trackId);
        }
      }
    },
    [xToBar, clipAtPosition, trackAtY],
  );

  // Mouse move — handle drag
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !dragTarget) return;

      if (dragTarget === 'playhead') {
        const bar = xToBar(e.clientX);
        const clampedBar = Math.max(0, Math.min(TOTAL_BARS, bar));
        setPlayheadBeat(clampedBar * BEATS_PER_BAR);
      }
    },
    [isDragging, dragTarget, xToBar],
  );

  // Mouse up — end drag
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragTarget(null);
  }, []);

  // Scroll / zoom via wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Zoom
        e.preventDefault();
        setZoom((z) => {
          const delta = e.deltaY > 0 ? -0.15 : 0.15;
          return Math.max(0.5, Math.min(4, z + delta));
        });
      } else {
        // Horizontal scroll
        const scrollDelta = (e.deltaX || e.deltaY) * 0.02;
        setScrollOffset((prev) =>
          Math.max(0, Math.min(TOTAL_BARS - visibleBars, prev + scrollDelta)),
        );
      }
    },
    [visibleBars],
  );

  // Loop region from mock state
  const loopStart = 17;
  const loopEnd = 25;

  // Build input props
  const inputProps: LiveArrangeProps = useMemo(
    () => ({
      tracks,
      playheadBeat,
      isPlaying: playing,
      bpm,
      beatsPerBar: BEATS_PER_BAR,
      totalBars: TOTAL_BARS,
      visibleBars,
      scrollOffsetBars: scrollOffset,
      selectedClipId,
      selectedTrackId,
      loopStart,
      loopEnd,
      markers: [],
    }),
    [tracks, playheadBeat, playing, bpm, visibleBars, scrollOffset, selectedClipId, selectedTrackId],
  );

  return (
    <div className="flex flex-col h-full relative" ref={containerRef}>
      {/* Zoom controls overlay */}
      <div className="absolute top-2 right-3 flex gap-1 z-20">
        <button
          className="glass-button flex items-center justify-center"
          style={{ width: 24, height: 20 }}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
        >
          <ZoomOut size={10} />
        </button>
        <span
          style={{
            fontSize: 8,
            color: 'var(--text-muted)',
            alignSelf: 'center',
            minWidth: 28,
            textAlign: 'center',
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="glass-button flex items-center justify-center"
          style={{ width: 24, height: 20 }}
          onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
        >
          <ZoomIn size={10} />
        </button>
      </div>

      {/* Remotion Player — visual layer */}
      <div
        className="flex-1 min-h-0"
        style={{ position: 'relative' }}
      >
        <Player
          component={LiveArrange}
          inputProps={inputProps}
          compositionWidth={containerSize.width || 800}
          compositionHeight={containerSize.height || 400}
          fps={FPS}
          durationInFrames={DURATION_FRAMES}
          loop
          autoPlay
          controls={false}
          style={{
            width: '100%',
            height: '100%',
          }}
        />

        {/* Interactive overlay — captures all mouse events */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            cursor: isDragging
              ? dragTarget === 'playhead'
                ? 'col-resize'
                : 'grabbing'
              : 'default',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />
      </div>
    </div>
  );
};
