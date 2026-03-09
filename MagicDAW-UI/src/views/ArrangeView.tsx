import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Player } from '@remotion/player';
import { ZoomIn, ZoomOut } from 'lucide-react';
import type { Track, Clip, ViewId } from '../types/daw';
import { sendToSwift, onSwiftMessage, BridgeMessages } from '../bridge';
import { LiveArrange } from '../compositions/LiveArrange';
import type { LiveArrangeProps } from '../compositions/LiveArrange';
import { useToast } from '../components/Toast';
import { useContextMenu as useCtxMenu } from '../components/ContextMenu';
import type { ContextMenuEntry } from '../components/ContextMenu';
import { SelectionRect } from '../components/SelectionRect';

interface ArrangeViewProps {
  tracks: Track[];
  bpm: number;
  playing: boolean;
  onSwitchView?: (view: ViewId, clipId?: string) => void;
}

const TOTAL_BARS = 32;
const BEATS_PER_BAR = 4;
const FPS = 30;
const DURATION_FRAMES = 9000; // 5 minutes at 30fps
const HEADER_W = 120;
const RULER_H = 32;
const ENERGY_H = 24;
const TRACK_H = 60;
const RESIZE_HANDLE_W = 8; // pixels for right-edge resize handle
const SNAP_BARS = 1; // snap to 1-bar grid

type DragMode = 'idle' | 'selecting' | 'moving' | 'resizing' | 'duplicating' | 'playhead-scrub' | 'loop-handle';

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  /** Bar position at drag start (for the dragged clip) */
  originBar: number;
  /** Track index at drag start */
  originTrackIdx: number;
  /** Accumulated delta in bars */
  deltaBar: number;
  /** Accumulated delta in track indices */
  deltaTrack: number;
  /** Whether the drag has moved enough to be considered a real drag (vs click) */
  hasMoved: boolean;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  clipId: string | null;
  trackId: string | null;
  bar: number;
}

function snapToBar(bar: number): number {
  return Math.round(bar / SNAP_BARS) * SNAP_BARS;
}

export const ArrangeView: React.FC<ArrangeViewProps> = ({ tracks, bpm, playing, onSwitchView }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [playheadBeat, setPlayheadBeat] = useState(0);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 400 });
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, clipId: null, trackId: null, bar: 0,
  });
  const { showToast } = useToast();
  const { openMenu: openGlassMenu } = useCtxMenu();

  // Drag state machine
  const [drag, setDrag] = useState<DragState>({
    mode: 'idle',
    startX: 0, startY: 0,
    originBar: 0, originTrackIdx: 0,
    deltaBar: 0, deltaTrack: 0,
    hasMoved: false,
  });
  const dragRef = useRef(drag);
  dragRef.current = drag;

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

  // Listen for tracks_updated from Swift
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.TRACKS_UPDATED, (_payload) => {
      // Tracks are updated through App-level state; this is just for acknowledgment
    });
    return unsub;
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

  // Convert screen X to bar position (1-indexed, fractional)
  const xToBar = useCallback(
    (clientX: number): number => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return 1;
      const relX = clientX - rect.left - HEADER_W;
      return scrollOffset + relX / barW + 1;
    },
    [scrollOffset, barW],
  );

  // Convert screen Y to track index
  const yToTrackIdx = useCallback(
    (clientY: number): number => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const relY = clientY - rect.top - RULER_H - ENERGY_H;
      return Math.floor(relY / TRACK_H);
    },
    [],
  );

  // Find clip under mouse, also return if on resize handle
  const hitTest = useCallback(
    (clientX: number, clientY: number): { clipId: string | null; trackId: string | null; trackIdx: number; bar: number; onResizeEdge: boolean } => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { clipId: null, trackId: null, trackIdx: -1, bar: 1, onResizeEdge: false };
      const relX = clientX - rect.left - HEADER_W;
      const relY = clientY - rect.top - RULER_H - ENERGY_H;

      const bar = scrollOffset + relX / barW + 1;
      const trackIdx = Math.floor(relY / TRACK_H);

      if (relX < 0 || relY < 0 || trackIdx < 0 || trackIdx >= tracks.length) {
        return { clipId: null, trackId: null, trackIdx, bar, onResizeEdge: false };
      }

      const track = tracks[trackIdx];
      for (const clip of track.clips) {
        if (bar >= clip.startBar && bar < clip.startBar + clip.lengthBars) {
          // Check if near right edge (resize handle)
          const clipEndX = HEADER_W + (clip.startBar + clip.lengthBars - 1 - scrollOffset) * barW;
          const pixelX = clientX - rect.left;
          const onResizeEdge = Math.abs(pixelX - clipEndX) < RESIZE_HANDLE_W;
          return { clipId: clip.id, trackId: track.id, trackIdx, bar, onResizeEdge };
        }
      }
      return { clipId: null, trackId: track.id, trackIdx, bar, onResizeEdge: false };
    },
    [scrollOffset, barW, tracks],
  );

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete / Backspace — delete selected clips
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedClipIds.size > 0) {
        e.preventDefault();
        sendToSwift(BridgeMessages.DELETE_CLIPS, { clipIds: Array.from(selectedClipIds) });
        setSelectedClipIds(new Set());
        showToast('Clip deleted');
        return;
      }

      // Cmd+D — duplicate selected clips in place (offset +1 bar)
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && selectedClipIds.size > 0) {
        e.preventDefault();
        for (const clipId of selectedClipIds) {
          // Find the clip to get its position
          for (const track of tracks) {
            const clip = track.clips.find((c) => c.id === clipId);
            if (clip) {
              sendToSwift(BridgeMessages.DUPLICATE_CLIP, {
                clipId,
                targetTrackId: track.id,
                targetBeat: (clip.startBar - 1 + clip.lengthBars) * BEATS_PER_BAR,
              });
              break;
            }
          }
        }
        return;
      }

      // Escape — deselect
      if (e.key === 'Escape') {
        setSelectedClipIds(new Set());
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipIds, tracks, showToast]);

  // Context menu state is maintained for backward compat with handleMouseDown checks

  // ── Mouse down ──────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Close context menu if open
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }

      // Only handle left button
      if (e.button !== 0) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;

      // ── Ruler area — playhead scrub ──
      if (relY < RULER_H && relX > HEADER_W) {
        const bar = xToBar(e.clientX);
        const beat = Math.max(0, (bar - 1)) * BEATS_PER_BAR;
        setPlayheadBeat(beat);
        sendToSwift(BridgeMessages.SET_POSITION, { beat });
        setDrag({
          mode: 'playhead-scrub',
          startX: e.clientX, startY: e.clientY,
          originBar: bar, originTrackIdx: 0,
          deltaBar: 0, deltaTrack: 0, hasMoved: false,
        });
        return;
      }

      // ── Track grid area ──
      if (relX > HEADER_W && relY > RULER_H + ENERGY_H) {
        const hit = hitTest(e.clientX, e.clientY);

        if (hit.clipId) {
          // Alt+click = start duplicate drag
          const isDuplicate = e.altKey;

          // Shift+click = toggle multi-select
          if (e.shiftKey && !isDuplicate) {
            setSelectedClipIds((prev) => {
              const next = new Set(prev);
              if (next.has(hit.clipId!)) {
                next.delete(hit.clipId!);
              } else {
                next.add(hit.clipId!);
              }
              return next;
            });
            return;
          }

          // Select the clip (unless already selected as part of multi-select)
          if (!selectedClipIds.has(hit.clipId)) {
            setSelectedClipIds(new Set([hit.clipId]));
          }

          const mode: DragMode = isDuplicate ? 'duplicating' : hit.onResizeEdge ? 'resizing' : 'moving';

          setDrag({
            mode,
            startX: e.clientX, startY: e.clientY,
            originBar: hit.bar, originTrackIdx: hit.trackIdx,
            deltaBar: 0, deltaTrack: 0, hasMoved: false,
          });
        } else {
          // Clicked empty space — deselect
          if (!e.shiftKey) {
            setSelectedClipIds(new Set());
          }
          // Set selected track
          if (hit.trackId) {
            setSelectedTrackId(hit.trackId);
          }
        }
        return;
      }

      // ── Header area — track selection ──
      if (relX <= HEADER_W && relY > RULER_H + ENERGY_H) {
        const trackIdx = yToTrackIdx(e.clientY);
        if (trackIdx >= 0 && trackIdx < tracks.length) {
          setSelectedTrackId(tracks[trackIdx].id);
        }
      }
    },
    [xToBar, hitTest, yToTrackIdx, selectedClipIds, tracks, contextMenu.visible],
  );

  // ── Double-click ────────────────────────────────────────────────────────
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;

      if (relX <= HEADER_W || relY <= RULER_H + ENERGY_H) return;

      const hit = hitTest(e.clientX, e.clientY);

      if (hit.clipId) {
        // Double-click on clip → open editor
        // Check if it's a MIDI clip
        const track = tracks.find((t) => t.id === hit.trackId);
        if (track && track.type === 'midi') {
          sendToSwift(BridgeMessages.EDIT_CLIP, { clipId: hit.clipId });
          onSwitchView?.('edit', hit.clipId);
        }
      } else if (hit.trackId && hit.trackIdx >= 0 && hit.trackIdx < tracks.length) {
        // Double-click on empty track lane → create new clip
        const track = tracks[hit.trackIdx];
        const snappedBar = Math.max(1, snapToBar(hit.bar));
        const startBeat = (snappedBar - 1) * BEATS_PER_BAR;
        const lengthBeats = 4 * BEATS_PER_BAR; // 4 bars default
        const clipType = track.type === 'audio' ? 'audio' : 'midi';

        sendToSwift(BridgeMessages.CREATE_CLIP, {
          trackId: track.id,
          startBeat,
          lengthBeats,
          type: clipType,
        });
      }
    },
    [hitTest, tracks, onSwitchView],
  );

  // ── Context menu (right-click) — using glass-styled provider ────────────
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const hit = hitTest(e.clientX, e.clientY);

      if (hit.clipId) {
        const clipId = hit.clipId;
        const items: ContextMenuEntry[] = [
          { label: 'Edit Clip', shortcut: 'Dbl-click', action: () => {
            sendToSwift(BridgeMessages.EDIT_CLIP, { clipId });
            onSwitchView?.('edit', clipId);
          }},
          { separator: true },
          { label: 'Cut', shortcut: '\u2318X', action: () => {
            sendToSwift('cut_clips', { clipIds: [clipId] });
            showToast('Cut');
          }},
          { label: 'Copy', shortcut: '\u2318C', action: () => {
            sendToSwift('copy_clips', { clipIds: [clipId] });
            showToast('Copied');
          }},
          { label: 'Paste', shortcut: '\u2318V', action: () => {
            sendToSwift('paste_clips', { beat: playheadBeat });
            showToast('Pasted');
          }},
          { separator: true },
          { label: 'Split at Playhead', action: () => {
            sendToSwift(BridgeMessages.SPLIT_CLIP, { clipId, splitBeat: playheadBeat });
            showToast('Split');
          }},
          { label: 'Duplicate', shortcut: '\u2318D', action: () => {
            for (const track of tracks) {
              const clip = track.clips.find((c) => c.id === clipId);
              if (clip) {
                sendToSwift(BridgeMessages.DUPLICATE_CLIP, {
                  clipId,
                  targetTrackId: track.id,
                  targetBeat: (clip.startBar - 1 + clip.lengthBars) * BEATS_PER_BAR,
                });
                showToast('Duplicated');
                break;
              }
            }
          }},
          { separator: true },
          { label: 'Delete', shortcut: '\u232B', action: () => {
            sendToSwift(BridgeMessages.DELETE_CLIPS, { clipIds: [clipId] });
            setSelectedClipIds((prev) => { const n = new Set(prev); n.delete(clipId); return n; });
            showToast('Deleted');
          }},
        ];
        openGlassMenu(e.clientX, e.clientY, items);
      } else {
        // Right-click on empty space
        const items: ContextMenuEntry[] = [
          { label: 'Create Clip', shortcut: 'Dbl-click', action: () => {
            if (hit.trackId) {
              const trackIdx = tracks.findIndex((t) => t.id === hit.trackId);
              if (trackIdx >= 0) {
                const track = tracks[trackIdx];
                const snappedBar = Math.max(1, snapToBar(hit.bar));
                sendToSwift(BridgeMessages.CREATE_CLIP, {
                  trackId: track.id,
                  startBeat: (snappedBar - 1) * BEATS_PER_BAR,
                  lengthBeats: 4 * BEATS_PER_BAR,
                  type: track.type === 'audio' ? 'audio' : 'midi',
                });
                showToast('Clip created');
              }
            }
          }},
          { label: 'Paste', shortcut: '\u2318V', action: () => {
            sendToSwift('paste_clips', { beat: playheadBeat });
            showToast('Pasted');
          }},
          { separator: true },
          { label: 'Select All', shortcut: '\u2318A', action: () => {
            const all = new Set<string>();
            tracks.forEach((t) => t.clips.forEach((c) => all.add(c.id)));
            setSelectedClipIds(all);
          }},
        ];
        openGlassMenu(e.clientX, e.clientY, items);
      }

      // Also keep the old state for backwards compat
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setContextMenu({
          visible: false,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          clipId: hit.clipId,
          trackId: hit.trackId,
          bar: hit.bar,
        });
      }
    },
    [hitTest, openGlassMenu, showToast, tracks, playheadBeat, onSwitchView],
  );

  // ── Mouse move — drag handling ──────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const d = dragRef.current;
      if (d.mode === 'idle') return;

      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const hasMoved = d.hasMoved || Math.abs(dx) > 3 || Math.abs(dy) > 3;

      if (d.mode === 'playhead-scrub') {
        const bar = xToBar(e.clientX);
        const clampedBar = Math.max(1, Math.min(TOTAL_BARS + 1, bar));
        const beat = (clampedBar - 1) * BEATS_PER_BAR;
        setPlayheadBeat(beat);
        setDrag((prev) => ({ ...prev, hasMoved }));
        return;
      }

      if (!hasMoved) return;

      const deltaBar = dx / barW;
      const deltaTrack = Math.round(dy / TRACK_H);

      setDrag((prev) => ({
        ...prev,
        deltaBar: snapToBar(deltaBar),
        deltaTrack,
        hasMoved,
      }));
    },
    [xToBar, barW],
  );

  // ── Mouse up — commit drag ──────────────────────────────────────────────
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const d = dragRef.current;

      if (d.mode === 'playhead-scrub') {
        // Send final position to Swift
        const bar = xToBar(e.clientX);
        const beat = Math.max(0, (Math.max(1, Math.min(TOTAL_BARS + 1, bar)) - 1)) * BEATS_PER_BAR;
        sendToSwift(BridgeMessages.SET_POSITION, { beat });
        setDrag({ mode: 'idle', startX: 0, startY: 0, originBar: 0, originTrackIdx: 0, deltaBar: 0, deltaTrack: 0, hasMoved: false });
        return;
      }

      if (d.mode === 'moving' && d.hasMoved) {
        // Commit move for all selected clips
        for (const clipId of selectedClipIds) {
          for (const track of tracks) {
            const clip = track.clips.find((c) => c.id === clipId);
            if (clip) {
              const trackIdx = tracks.indexOf(track);
              const newTrackIdx = Math.max(0, Math.min(tracks.length - 1, trackIdx + d.deltaTrack));
              const newStartBar = Math.max(1, clip.startBar + d.deltaBar);
              const newStartBeat = (newStartBar - 1) * BEATS_PER_BAR;
              sendToSwift(BridgeMessages.MOVE_CLIP, {
                clipId,
                newTrackId: tracks[newTrackIdx].id,
                newStartBeat,
              });
              break;
            }
          }
        }
      }

      if (d.mode === 'resizing' && d.hasMoved) {
        // Commit resize for the primary selected clip
        for (const clipId of selectedClipIds) {
          for (const track of tracks) {
            const clip = track.clips.find((c) => c.id === clipId);
            if (clip) {
              const newLength = Math.max(1, clip.lengthBars + d.deltaBar);
              const newLengthBeats = newLength * BEATS_PER_BAR;
              sendToSwift(BridgeMessages.RESIZE_CLIP, { clipId, newLengthBeats });
              break;
            }
          }
        }
      }

      if (d.mode === 'duplicating' && d.hasMoved) {
        // Commit duplicate for all selected clips
        for (const clipId of selectedClipIds) {
          for (const track of tracks) {
            const clip = track.clips.find((c) => c.id === clipId);
            if (clip) {
              const trackIdx = tracks.indexOf(track);
              const newTrackIdx = Math.max(0, Math.min(tracks.length - 1, trackIdx + d.deltaTrack));
              const newStartBar = Math.max(1, clip.startBar + d.deltaBar);
              const newStartBeat = (newStartBar - 1) * BEATS_PER_BAR;
              sendToSwift(BridgeMessages.DUPLICATE_CLIP, {
                clipId,
                targetTrackId: tracks[newTrackIdx].id,
                targetBeat: newStartBeat,
              });
              break;
            }
          }
        }
      }

      setDrag({ mode: 'idle', startX: 0, startY: 0, originBar: 0, originTrackIdx: 0, deltaBar: 0, deltaTrack: 0, hasMoved: false });
    },
    [selectedClipIds, tracks, xToBar],
  );

  // Scroll / zoom via wheel: Cmd+wheel=zoom, Shift+wheel=horizontal scroll, plain wheel=vertical track scroll
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Cmd/Ctrl + wheel = zoom
        e.preventDefault();
        setZoom((z) => {
          const delta = e.deltaY > 0 ? -0.15 : 0.15;
          return Math.max(0.5, Math.min(4, z + delta));
        });
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Shift + wheel or horizontal trackpad = horizontal scroll (time)
        const delta = e.shiftKey ? e.deltaY : e.deltaX;
        setScrollOffset((prev) =>
          Math.max(0, Math.min(TOTAL_BARS - visibleBars, prev + delta * 0.02)),
        );
      } else {
        // Plain vertical scroll = horizontal scroll (legacy behavior for track views)
        const scrollDelta = e.deltaY * 0.02;
        setScrollOffset((prev) =>
          Math.max(0, Math.min(TOTAL_BARS - visibleBars, prev + scrollDelta)),
        );
      }
    },
    [visibleBars],
  );

  // Determine cursor based on hover and drag state
  const getCursor = useCallback((): string => {
    if (drag.mode === 'playhead-scrub') return 'col-resize';
    if (drag.mode === 'moving' || drag.mode === 'duplicating') return 'grabbing';
    if (drag.mode === 'resizing') return 'ew-resize';
    return 'default';
  }, [drag.mode]);

  // Loop region
  const loopStart = 17;
  const loopEnd = 25;

  // Compute the "visual override" for clip positions during drag
  // This is passed to Remotion so clips appear to move before the commit
  const selectedClipIdStr = useMemo(() => {
    if (selectedClipIds.size === 0) return null;
    return Array.from(selectedClipIds)[0]; // single selected for highlight
  }, [selectedClipIds]);

  // Build input props for Remotion
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
      selectedClipId: selectedClipIdStr,
      selectedTrackId,
      loopStart,
      loopEnd,
      markers: [],
      // Pass drag offset for visual preview
      dragOffsetBars: drag.hasMoved ? drag.deltaBar : 0,
      dragOffsetTracks: drag.hasMoved ? drag.deltaTrack : 0,
      dragMode: drag.mode,
      selectedClipIds: Array.from(selectedClipIds),
    }),
    [tracks, playheadBeat, playing, bpm, visibleBars, scrollOffset, selectedClipIdStr, selectedTrackId, drag, selectedClipIds],
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
            cursor: getCursor(),
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          onWheel={handleWheel}
        />

        {/* Selection rectangle */}
        <SelectionRect rect={selectionRect} />
      </div>
    </div>
  );
};
