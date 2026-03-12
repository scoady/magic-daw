import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Player } from '@remotion/player';
import { MousePointer, Pencil, Eraser, ZoomIn, ZoomOut } from 'lucide-react';
import { LivePianoRoll } from '../compositions/LivePianoRoll';
import type { LivePianoRollProps } from '../compositions/LivePianoRoll';
import { aurora, mockPianoRollNotes } from '../mockData';
import { sendToSwift, onSwiftMessage, BridgeMessages } from '../bridge';
import type { ActiveMidiNote } from '../bridge';
import type { MidiNote, QuantizeValue } from '../types/daw';
import { QUANTIZE_LABELS } from '../types/daw';
import { useToast } from '../components/Toast';
import { useContextMenu } from '../components/ContextMenu';
import type { ContextMenuEntry } from '../components/ContextMenu';
import { SelectionRect } from '../components/SelectionRect';

// ── Constants ─────────────────────────────────────────────────────────────────

type Tool = 'select' | 'draw' | 'erase';

const DEFAULT_OCTAVE_RANGE: [number, number] = [2, 6];
const DEFAULT_VISIBLE_BARS = 4;
const DEFAULT_BPM = 92;
const DEFAULT_BEATS_PER_BAR = 4;

/** Minimum drag distance (px) before treating as drag vs click */
const DRAG_THRESHOLD = 4;

/** Generate a unique note id */
let noteIdCounter = 0;
function generateNoteId(): string {
  return `n-${Date.now()}-${++noteIdCounter}`;
}

// ── Undo Stack ─────────────────────────────────────────────────────────────────

interface UndoState {
  past: MidiNote[][];
  future: MidiNote[][];
}

// ── Hit Testing ────────────────────────────────────────────────────────────────

interface GridCoords {
  beat: number;
  pitch: number;
  /** Relative X within the grid area (0-1) */
  gridX: number;
  /** Relative Y within the grid area (0-1) */
  gridY: number;
  /** True if click is in the velocity lane */
  inVelocityLane: boolean;
}

type DragAction =
  | { type: 'draw'; startBeat: number; pitch: number }
  | { type: 'move'; noteIds: string[]; startBeat: number; startPitch: number }
  | { type: 'resize'; noteId: string; originalDuration: number; startBeat: number }
  | { type: 'velocity'; noteId: string; startY: number; originalVelocity: number }
  | { type: 'select-box'; startBeat: number; startPitch: number };

// ── Props ─────────────────────────────────────────────────────────────────────

interface EditViewProps {
  trackId?: string;
  clipId?: string;
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
  trackId,
  clipId,
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
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [quantize, setQuantize] = useState<QuantizeValue>(0.25);
  const [clipboard, setClipboard] = useState<MidiNote[]>([]);
  const [undoState, setUndoState] = useState<UndoState>({ past: [], future: [] });

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragAction | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const previewNoteRef = useRef<MidiNote | null>(null);
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const { showToast } = useToast();
  const { openMenu } = useContextMenu();

  // Grid layout constants (matching LivePianoRoll SVG viewBox)
  const PIANO_W_FRAC = 52 / 1000;
  const VEL_LANE_FRAC = 0.15;
  const octLow = DEFAULT_OCTAVE_RANGE[0];
  const octHigh = DEFAULT_OCTAVE_RANGE[1];
  const totalKeys = (octHigh - octLow + 1) * 12;
  const midiMin = octLow * 12 + 12;
  const totalBeats = visibleBars * beatsPerBar;

  // ── Undo helpers ──────────────────────────────────────────────────────────

  const pushUndo = useCallback((prevNotes: MidiNote[]) => {
    setUndoState((s) => ({
      past: [...s.past.slice(-49), prevNotes],
      future: [],
    }));
  }, []);

  const updateNotes = useCallback(
    (updater: (prev: MidiNote[]) => MidiNote[]) => {
      setLocalNotes((prev) => {
        pushUndo(prev);
        return updater(prev);
      });
    },
    [pushUndo],
  );

  const undo = useCallback(() => {
    setUndoState((s) => {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      setLocalNotes((current) => {
        setUndoState((us) => ({
          past: us.past.slice(0, -1),
          future: [...us.future, current],
        }));
        return prev;
      });
      return s;  // Will be overwritten by inner setUndoState
    });
    sendToSwift(BridgeMessages.UNDO, {});
  }, []);

  const redo = useCallback(() => {
    setUndoState((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[s.future.length - 1];
      setLocalNotes((current) => {
        setUndoState((us) => ({
          past: [...us.past, current],
          future: us.future.slice(0, -1),
        }));
        return next;
      });
      return s;
    });
    sendToSwift(BridgeMessages.REDO, {});
  }, []);

  // ── Quantize helper ───────────────────────────────────────────────────────

  const snap = useCallback(
    (beat: number): number => {
      if (quantize === 0) return beat;
      return Math.round(beat / quantize) * quantize;
    },
    [quantize],
  );

  // ── Sync external notes ───────────────────────────────────────────────────

  useEffect(() => {
    if (externalNotes) {
      setLocalNotes(externalNotes);
    }
  }, [externalNotes]);

  // Listen for notes_updated from Swift
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.NOTES_UPDATED, (payload: unknown) => {
      const data = payload as { notes: MidiNote[] };
      if (data.notes) {
        setLocalNotes(data.notes);
      }
    });
    return unsub;
  }, []);

  // Listen for chord detection from Swift
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.CHORD_DETECTED, (payload: unknown) => {
      const data = payload as { chord: string };
      setChordName(data.chord || undefined);
    });
    return unsub;
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // Delete / Backspace - delete selected notes
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNoteIds.size > 0) {
        e.preventDefault();
        const ids = Array.from(selectedNoteIds);
        updateNotes((prev) => prev.filter((n) => !selectedNoteIds.has(n.id)));
        setSelectedNoteIds(new Set());
        sendToSwift(BridgeMessages.DELETE_NOTES, { noteIds: ids });
        return;
      }

      // Cmd+Z - undo
      if (meta && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }

      // Cmd+Shift+Z - redo
      if (meta && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        redo();
        return;
      }

      // Cmd+C - copy
      if (meta && e.key === 'c' && selectedNoteIds.size > 0) {
        e.preventDefault();
        const selected = localNotes.filter((n) => selectedNoteIds.has(n.id));
        setClipboard(selected.map((n) => ({ ...n })));
        return;
      }

      // Cmd+V - paste at playhead
      if (meta && e.key === 'v' && clipboard.length > 0) {
        e.preventDefault();
        const minStart = Math.min(...clipboard.map((n) => n.start));
        const offset = snap(playheadBeat) - minStart;
        const pastedNotes = clipboard.map((n) => ({
          ...n,
          id: generateNoteId(),
          start: n.start + offset,
        }));
        updateNotes((prev) => [...prev, ...pastedNotes]);
        setSelectedNoteIds(new Set(pastedNotes.map((n) => n.id)));
        sendToSwift(BridgeMessages.PASTE_NOTES, {
          notes: pastedNotes,
          targetBeat: snap(playheadBeat),
        });
        return;
      }

      // Cmd+A - select all
      if (meta && e.key === 'a') {
        e.preventDefault();
        setSelectedNoteIds(new Set(localNotes.map((n) => n.id)));
        return;
      }

      // Escape - deselect
      if (e.key === 'Escape') {
        setSelectedNoteIds(new Set());
        return;
      }

      // B - Draw tool
      if (e.key === 'b' && !meta) {
        e.preventDefault();
        setTool('draw');
        showToast('Tool: Draw');
        return;
      }

      // V - Select tool
      if (e.key === 'v' && !meta) {
        e.preventDefault();
        setTool('select');
        showToast('Tool: Select');
        return;
      }

      // E - Erase tool
      if (e.key === 'e' && !meta) {
        e.preventDefault();
        setTool('erase');
        showToast('Tool: Erase');
        return;
      }

      // Cmd+Up/Down - Transpose selected by octave
      if (meta && e.key === 'ArrowUp' && selectedNoteIds.size > 0) {
        e.preventDefault();
        updateNotes((prev) =>
          prev.map((n) =>
            selectedNoteIds.has(n.id) ? { ...n, pitch: Math.min(127, n.pitch + 12) } : n,
          ),
        );
        showToast('Transpose +1 octave');
        return;
      }
      if (meta && e.key === 'ArrowDown' && selectedNoteIds.size > 0) {
        e.preventDefault();
        updateNotes((prev) =>
          prev.map((n) =>
            selectedNoteIds.has(n.id) ? { ...n, pitch: Math.max(0, n.pitch - 12) } : n,
          ),
        );
        showToast('Transpose -1 octave');
        return;
      }

      // Up/Down - Transpose by semitone
      if (!meta && e.key === 'ArrowUp' && selectedNoteIds.size > 0) {
        e.preventDefault();
        updateNotes((prev) =>
          prev.map((n) =>
            selectedNoteIds.has(n.id) ? { ...n, pitch: Math.min(127, n.pitch + 1) } : n,
          ),
        );
        return;
      }
      if (!meta && e.key === 'ArrowDown' && selectedNoteIds.size > 0) {
        e.preventDefault();
        updateNotes((prev) =>
          prev.map((n) =>
            selectedNoteIds.has(n.id) ? { ...n, pitch: Math.max(0, n.pitch - 1) } : n,
          ),
        );
        return;
      }

      // Left/Right - Nudge notes by grid division
      if (!meta && e.key === 'ArrowLeft' && selectedNoteIds.size > 0) {
        e.preventDefault();
        const step = quantize || 0.25;
        updateNotes((prev) =>
          prev.map((n) =>
            selectedNoteIds.has(n.id) ? { ...n, start: Math.max(0, n.start - step) } : n,
          ),
        );
        return;
      }
      if (!meta && e.key === 'ArrowRight' && selectedNoteIds.size > 0) {
        e.preventDefault();
        const step = quantize || 0.25;
        updateNotes((prev) =>
          prev.map((n) =>
            selectedNoteIds.has(n.id) ? { ...n, start: n.start + step } : n,
          ),
        );
        return;
      }

      // Ctrl+1/2/3/4 - Quantize grid
      if (e.ctrlKey && !e.metaKey) {
        const qMap: Record<string, QuantizeValue> = { '1': 1, '2': 0.5, '3': 0.25, '4': 0.125 };
        const qLabels: Record<string, string> = { '1': '1/4', '2': '1/8', '3': '1/16', '4': '1/32' };
        if (qMap[e.key] !== undefined) {
          e.preventDefault();
          setQuantize(qMap[e.key]);
          showToast(`Quantize: ${qLabels[e.key]}`);
          return;
        }
      }

      // Cmd+D - Duplicate selected notes
      if (meta && e.key === 'd' && selectedNoteIds.size > 0) {
        e.preventDefault();
        const selected = localNotes.filter((n) => selectedNoteIds.has(n.id));
        if (selected.length === 0) return;
        const maxEnd = Math.max(...selected.map((n) => n.start + n.duration));
        const minStart = Math.min(...selected.map((n) => n.start));
        const offset = maxEnd - minStart;
        const duped = selected.map((n) => ({
          ...n,
          id: generateNoteId(),
          start: n.start + offset,
        }));
        updateNotes((prev) => [...prev, ...duped]);
        setSelectedNoteIds(new Set(duped.map((n) => n.id)));
        showToast('Duplicated');
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNoteIds, localNotes, clipboard, playheadBeat, quantize, undo, redo, updateNotes, snap, showToast]);

  // Active MIDI pitches array
  const activePitches = useMemo(
    () => liveActiveNotes.map((n) => n.note),
    [liveActiveNotes],
  );

  // Selected note IDs as array for LivePianoRoll
  const selectedIdsArray = useMemo(
    () => Array.from(selectedNoteIds),
    [selectedNoteIds],
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
      selectedNoteIds: selectedIdsArray,
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
      selectedIdsArray,
    ],
  );

  // ── Coordinate mapping ────────────────────────────────────────────────────

  const getGridCoords = useCallback(
    (e: React.MouseEvent | MouseEvent): GridCoords | null => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;

      const inVelocityLane = relY > (1 - VEL_LANE_FRAC);

      // Grid area (excludes piano keys and velocity lane)
      const gridX = (relX - PIANO_W_FRAC) / (1 - PIANO_W_FRAC - 0.004);
      const gridY = relY / (1 - VEL_LANE_FRAC);

      if (gridX < 0 || gridX > 1) return null;

      const beat = scrollOffsetBeats + gridX * totalBeats;
      const keyIdx = Math.floor(gridY * totalKeys);
      const noteIdx = totalKeys - 1 - keyIdx;
      const pitch = midiMin + noteIdx;

      return { beat, pitch, gridX, gridY, inVelocityLane };
    },
    [scrollOffsetBeats, totalBeats, totalKeys, midiMin],
  );

  // ── Hit-test notes ────────────────────────────────────────────────────────

  const hitTestNote = useCallback(
    (beat: number, pitch: number): MidiNote | null => {
      // Find note at this beat/pitch (top-most = last in array)
      for (let i = localNotes.length - 1; i >= 0; i--) {
        const n = localNotes[i];
        if (
          n.pitch === pitch &&
          beat >= n.start &&
          beat < n.start + n.duration
        ) {
          return n;
        }
      }
      return null;
    },
    [localNotes],
  );

  /** Check if the click is near the right edge of a note (for resize) */
  const isNearRightEdge = useCallback(
    (beat: number, note: MidiNote): boolean => {
      const rightEdge = note.start + note.duration;
      const beatPixelWidth = containerRef.current
        ? (containerRef.current.getBoundingClientRect().width * (1 - PIANO_W_FRAC)) / totalBeats
        : 40;
      const edgeThresholdBeats = 6 / beatPixelWidth; // 6px threshold
      return Math.abs(beat - rightEdge) < edgeThresholdBeats;
    },
    [totalBeats],
  );

  /** Hit-test velocity bars */
  const hitTestVelocity = useCallback(
    (e: React.MouseEvent | MouseEvent): MidiNote | null => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;

      const gridX = (relX - PIANO_W_FRAC) / (1 - PIANO_W_FRAC - 0.004);
      if (gridX < 0 || gridX > 1) return null;
      const beat = scrollOffsetBeats + gridX * totalBeats;

      // Find closest note by start position
      let closest: MidiNote | null = null;
      let closestDist = Infinity;
      for (const n of localNotes) {
        const dist = Math.abs(n.start - beat);
        const beatPx = (rect.width * (1 - PIANO_W_FRAC)) / totalBeats;
        if (dist < 8 / beatPx && dist < closestDist) {
          closest = n;
          closestDist = dist;
        }
      }
      return closest;
    },
    [localNotes, scrollOffsetBeats, totalBeats],
  );

  // ── Scroll / Zoom handlers ──────────────────────────────────────────────

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

  // Mouse wheel: vertical=pitch scroll, shift+wheel=horizontal scroll, cmd+wheel=zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl + wheel = zoom
        e.preventDefault();
        if (e.deltaY < 0) {
          setVisibleBars((v) => Math.max(1, v - 1));
        } else {
          setVisibleBars((v) => Math.min(16, v + 1));
        }
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Shift + wheel or horizontal trackpad = horizontal scroll (time)
        const delta = e.shiftKey ? e.deltaY : e.deltaX;
        setScrollOffsetBeats((s) => Math.max(0, s + delta * 0.05));
      }
      // Plain vertical scroll does nothing special (pitch scroll is handled by the Remotion composition)
    },
    [],
  );

  // ── Mouse event handlers ──────────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const coords = getGridCoords(e);
      if (!coords) return;

      dragStartPos.current = { x: e.clientX, y: e.clientY };
      isDragging.current = false;

      // ── Velocity lane interaction ──
      if (coords.inVelocityLane) {
        const note = hitTestVelocity(e);
        if (note) {
          dragRef.current = {
            type: 'velocity',
            noteId: note.id,
            startY: e.clientY,
            originalVelocity: note.velocity,
          };
        }
        return;
      }

      const { beat, pitch } = coords;

      if (tool === 'draw') {
        const snappedBeat = snap(beat);
        const newNote: MidiNote = {
          id: generateNoteId(),
          pitch,
          start: snappedBeat,
          duration: quantize || 0.25,
          velocity: 100,
          channel: 0,
        };
        previewNoteRef.current = newNote;
        dragRef.current = { type: 'draw', startBeat: snappedBeat, pitch };

        // Preview sound
        sendToSwift(BridgeMessages.INSTRUMENT_PREVIEW_NOTE, {
          note: pitch,
          velocity: 100,
        });
        return;
      }

      if (tool === 'erase') {
        const hitNote = hitTestNote(beat, pitch);
        if (hitNote) {
          updateNotes((prev) => prev.filter((n) => n.id !== hitNote.id));
          sendToSwift(BridgeMessages.DELETE_NOTES, { noteIds: [hitNote.id] });
        }
        return;
      }

      // ── Select tool ──
      if (tool === 'select') {
        const hitNote = hitTestNote(beat, pitch);
        if (hitNote) {
          // Check if near right edge for resize
          if (isNearRightEdge(beat, hitNote)) {
            dragRef.current = {
              type: 'resize',
              noteId: hitNote.id,
              originalDuration: hitNote.duration,
              startBeat: beat,
            };
            // Make sure it's selected
            if (!selectedNoteIds.has(hitNote.id)) {
              setSelectedNoteIds(new Set([hitNote.id]));
            }
            return;
          }

          // Select the note
          if (e.shiftKey) {
            // Shift-click: toggle in multi-select
            setSelectedNoteIds((prev) => {
              const next = new Set(prev);
              if (next.has(hitNote.id)) {
                next.delete(hitNote.id);
              } else {
                next.add(hitNote.id);
              }
              return next;
            });
          } else if (!selectedNoteIds.has(hitNote.id)) {
            setSelectedNoteIds(new Set([hitNote.id]));
          }

          // Start move drag
          const moveIds = selectedNoteIds.has(hitNote.id)
            ? Array.from(selectedNoteIds)
            : [hitNote.id];

          dragRef.current = {
            type: 'move',
            noteIds: moveIds,
            startBeat: beat,
            startPitch: pitch,
          };

          // Preview sound
          sendToSwift(BridgeMessages.INSTRUMENT_PREVIEW_NOTE, {
            note: pitch,
            velocity: hitNote.velocity,
          });
        } else {
          // Click on empty space - deselect (or start box select)
          if (!e.shiftKey) {
            setSelectedNoteIds(new Set());
          }
          dragRef.current = {
            type: 'select-box',
            startBeat: beat,
            startPitch: pitch,
          };
        }
      }
    },
    [tool, getGridCoords, hitTestNote, hitTestVelocity, isNearRightEdge, snap, quantize, selectedNoteIds, updateNotes],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const coords = getGridCoords(e);
      if (!coords) return;

      // Update cursor based on hover
      const container = containerRef.current;
      if (container && tool === 'select' && !dragRef.current) {
        const { beat, pitch, inVelocityLane } = coords;
        if (inVelocityLane) {
          container.style.cursor = 'ns-resize';
        } else {
          const hitNote = hitTestNote(beat, pitch);
          if (hitNote && isNearRightEdge(beat, hitNote)) {
            container.style.cursor = 'ew-resize';
          } else if (hitNote) {
            container.style.cursor = 'grab';
          } else {
            container.style.cursor = 'default';
          }
        }
      }

      if (!dragRef.current || !dragStartPos.current) return;

      // Check drag threshold
      if (!isDragging.current) {
        const dx = Math.abs(e.clientX - dragStartPos.current.x);
        const dy = Math.abs(e.clientY - dragStartPos.current.y);
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
        isDragging.current = true;
      }

      const action = dragRef.current;

      if (action.type === 'draw') {
        // Extend the preview note duration
        const snappedBeat = snap(coords.beat);
        const duration = Math.max(quantize || 0.25, snappedBeat - action.startBeat);
        if (previewNoteRef.current) {
          previewNoteRef.current = {
            ...previewNoteRef.current,
            duration,
          };
          // Force re-render by temporarily adding preview note
          setLocalNotes((prev) => {
            const withoutPreview = prev.filter((n) => n.id !== previewNoteRef.current!.id);
            return [...withoutPreview, previewNoteRef.current!];
          });
        }
        return;
      }

      if (action.type === 'move') {
        const deltaBeat = snap(coords.beat) - snap(action.startBeat);
        const deltaPitch = coords.pitch - action.startPitch;
        if (deltaBeat === 0 && deltaPitch === 0) return;

        setLocalNotes((prev) =>
          prev.map((n) => {
            if (!action.noteIds.includes(n.id)) return n;
            return {
              ...n,
              start: Math.max(0, n.start + deltaBeat),
              pitch: Math.min(127, Math.max(0, n.pitch + deltaPitch)),
            };
          }),
        );
        action.startBeat = coords.beat;
        action.startPitch = coords.pitch;

        // Preview on pitch change
        if (deltaPitch !== 0) {
          sendToSwift(BridgeMessages.INSTRUMENT_PREVIEW_NOTE, {
            note: coords.pitch,
            velocity: 100,
          });
        }
        return;
      }

      if (action.type === 'resize') {
        const snappedBeat = snap(coords.beat);
        const note = localNotes.find((n) => n.id === action.noteId);
        if (!note) return;
        const newDuration = Math.max(
          quantize || 0.125,
          snappedBeat - note.start,
        );
        setLocalNotes((prev) =>
          prev.map((n) =>
            n.id === action.noteId ? { ...n, duration: newDuration } : n,
          ),
        );
        return;
      }

      if (action.type === 'velocity') {
        const container = containerRef.current;
        if (!container) return;
        const deltaY = action.startY - e.clientY; // up = increase
        const velChange = Math.round(deltaY * 0.5);
        const newVel = Math.min(127, Math.max(1, action.originalVelocity + velChange));

        setLocalNotes((prev) =>
          prev.map((n) =>
            n.id === action.noteId ? { ...n, velocity: newVel } : n,
          ),
        );
        return;
      }

      // select-box: show visual selection rectangle
      if (action.type === 'select-box' && containerRef.current && dragStartPos.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const x1 = dragStartPos.current.x - rect.left;
        const y1 = dragStartPos.current.y - rect.top;
        const x2 = e.clientX - rect.left;
        const y2 = e.clientY - rect.top;
        setSelectionRect({
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        });
      }
    },
    [tool, getGridCoords, hitTestNote, isNearRightEdge, localNotes, snap, quantize],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const action = dragRef.current;
      dragRef.current = null;
      dragStartPos.current = null;

      if (!action) return;

      if (action.type === 'draw') {
        const note = previewNoteRef.current;
        previewNoteRef.current = null;
        if (!note) return;

        // If we were dragging, note is already in localNotes via the preview mechanism
        // If just clicked, add it with the default duration
        if (!isDragging.current) {
          updateNotes((prev) => [...prev, note]);
        } else {
          // The note is already added during drag; just push undo
          pushUndo(localNotes.filter((n) => n.id !== note.id));
        }

        sendToSwift(BridgeMessages.ADD_NOTE, {
          trackId,
          clipId,
          pitch: note.pitch,
          startBeat: note.start,
          duration: note.duration,
          velocity: note.velocity,
        });
        setSelectedNoteIds(new Set([note.id]));
        return;
      }

      if (action.type === 'move' && isDragging.current) {
        sendToSwift(BridgeMessages.MOVE_NOTES, {
          noteIds: action.noteIds,
          deltaPitch: 0,   // Already applied incrementally
          deltaBeats: 0,
        });
        return;
      }

      if (action.type === 'resize') {
        const note = localNotes.find((n) => n.id === action.noteId);
        if (note) {
          sendToSwift(BridgeMessages.RESIZE_NOTE, {
            noteId: action.noteId,
            newDuration: note.duration,
          });
        }
        return;
      }

      if (action.type === 'velocity') {
        const note = localNotes.find((n) => n.id === action.noteId);
        if (note) {
          sendToSwift(BridgeMessages.SET_VELOCITY, {
            noteId: action.noteId,
            velocity: note.velocity,
          });
        }
        return;
      }

      if (action.type === 'select-box' && isDragging.current) {
        // Box select: select all notes within the box
        const coords = getGridCoords(e);
        if (!coords) return;

        const minBeat = Math.min(action.startBeat, coords.beat);
        const maxBeat = Math.max(action.startBeat, coords.beat);
        const minPitch = Math.min(action.startPitch, coords.pitch);
        const maxPitch = Math.max(action.startPitch, coords.pitch);

        const boxSelected = localNotes.filter(
          (n) =>
            n.pitch >= minPitch &&
            n.pitch <= maxPitch &&
            n.start + n.duration > minBeat &&
            n.start < maxBeat,
        );
        setSelectedNoteIds(new Set(boxSelected.map((n) => n.id)));
      }

      setSelectionRect(null);
      isDragging.current = false;
    },
    [localNotes, trackId, clipId, updateNotes, pushUndo, getGridCoords],
  );

  // ── Context menu ─────────────────────────────────────────────────────────

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const hasSelection = selectedNoteIds.size > 0;

      const items: ContextMenuEntry[] = [
        { label: 'Cut', shortcut: '\u2318X', action: () => {
          if (!hasSelection) return;
          const selected = localNotes.filter((n) => selectedNoteIds.has(n.id));
          setClipboard(selected.map((n) => ({ ...n })));
          updateNotes((prev) => prev.filter((n) => !selectedNoteIds.has(n.id)));
          setSelectedNoteIds(new Set());
          showToast('Cut');
        }, disabled: !hasSelection },
        { label: 'Copy', shortcut: '\u2318C', action: () => {
          if (!hasSelection) return;
          const selected = localNotes.filter((n) => selectedNoteIds.has(n.id));
          setClipboard(selected.map((n) => ({ ...n })));
          showToast('Copied');
        }, disabled: !hasSelection },
        { label: 'Paste', shortcut: '\u2318V', action: () => {
          if (clipboard.length === 0) return;
          const minStart = Math.min(...clipboard.map((n) => n.start));
          const offset = snap(playheadBeat) - minStart;
          const pasted = clipboard.map((n) => ({
            ...n,
            id: generateNoteId(),
            start: n.start + offset,
          }));
          updateNotes((prev) => [...prev, ...pasted]);
          setSelectedNoteIds(new Set(pasted.map((n) => n.id)));
          showToast('Pasted');
        }, disabled: clipboard.length === 0 },
        { separator: true },
        { label: 'Select All', shortcut: '\u2318A', action: () => {
          setSelectedNoteIds(new Set(localNotes.map((n) => n.id)));
        }},
        { label: 'Delete', shortcut: '\u232B', action: () => {
          if (!hasSelection) return;
          updateNotes((prev) => prev.filter((n) => !selectedNoteIds.has(n.id)));
          setSelectedNoteIds(new Set());
          showToast('Deleted');
        }, disabled: !hasSelection },
        { label: 'Duplicate', shortcut: '\u2318D', action: () => {
          if (!hasSelection) return;
          const selected = localNotes.filter((n) => selectedNoteIds.has(n.id));
          const maxEnd = Math.max(...selected.map((n) => n.start + n.duration));
          const minStart = Math.min(...selected.map((n) => n.start));
          const offset = maxEnd - minStart;
          const duped = selected.map((n) => ({
            ...n,
            id: generateNoteId(),
            start: n.start + offset,
          }));
          updateNotes((prev) => [...prev, ...duped]);
          setSelectedNoteIds(new Set(duped.map((n) => n.id)));
          showToast('Duplicated');
        }, disabled: !hasSelection },
        { separator: true },
        { label: 'Quantize Selection', action: () => {
          if (!hasSelection || quantize === 0) return;
          updateNotes((prev) =>
            prev.map((n) =>
              selectedNoteIds.has(n.id) ? { ...n, start: snap(n.start) } : n,
            ),
          );
          showToast(`Quantized to ${QUANTIZE_LABELS[quantize]}`);
        }, disabled: !hasSelection || quantize === 0 },
        { label: 'Transpose +1 Octave', shortcut: '\u2318\u2191', action: () => {
          if (!hasSelection) return;
          updateNotes((prev) =>
            prev.map((n) =>
              selectedNoteIds.has(n.id) ? { ...n, pitch: Math.min(127, n.pitch + 12) } : n,
            ),
          );
          showToast('Transpose +1 octave');
        }, disabled: !hasSelection },
        { label: 'Transpose -1 Octave', shortcut: '\u2318\u2193', action: () => {
          if (!hasSelection) return;
          updateNotes((prev) =>
            prev.map((n) =>
              selectedNoteIds.has(n.id) ? { ...n, pitch: Math.max(0, n.pitch - 12) } : n,
            ),
          );
          showToast('Transpose -1 octave');
        }, disabled: !hasSelection },
      ];

      openMenu(e.clientX, e.clientY, items);
    },
    [selectedNoteIds, localNotes, clipboard, playheadBeat, quantize, snap, updateNotes, openMenu, showToast],
  );

  // ── Selection rectangle visual ──────────────────────────────────────────

  // Update selection rect during select-box drag
  useEffect(() => {
    if (!dragRef.current || dragRef.current.type !== 'select-box' || !isDragging.current) {
      setSelectionRect(null);
    }
  }, [localNotes]); // Cheap way to re-check on re-renders

  // ── Quantize cycle ────────────────────────────────────────────────────────

  const cycleQuantize = useCallback(() => {
    const values: QuantizeValue[] = [0, 1, 0.5, 0.25, 0.125];
    const idx = values.indexOf(quantize);
    setQuantize(values[(idx + 1) % values.length]);
  }, [quantize]);

  // ── Tool buttons ────────────────────────────────────────────────────────

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
        {tools.map((t) => {
          const shortcutKey = t.id === 'select' ? 'V' : t.id === 'draw' ? 'B' : 'E';
          return (
            <button
              key={t.id}
              className={`glass-button flex items-center gap-1.5 px-2 py-1 ${
                tool === t.id ? 'active' : ''
              }`}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${shortcutKey})`}
            >
              {t.icon}
              <span style={{ fontSize: 8 }}>{t.label}</span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', opacity: 0.6 }}>{shortcutKey}</span>
            </button>
          );
        })}

        <div className="flex-1" />

        {/* Quantize selector */}
        <button
          className="glass-button px-2 py-0.5"
          onClick={cycleQuantize}
          title="Cycle quantize grid"
        >
          <span style={{ fontSize: 8, color: quantize === 0 ? 'var(--text-muted)' : 'var(--text)' }}>
            Snap: {QUANTIZE_LABELS[quantize]}
          </span>
        </button>

        <span style={{ fontSize: 8, color: 'var(--text-muted)', margin: '0 4px' }}>|</span>

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
      </div>

      {/* Remotion Piano Roll */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
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
        <SelectionRect rect={selectionRect} />
      </div>
    </div>
  );
};
