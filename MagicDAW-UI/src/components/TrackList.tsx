import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Music, Volume2, Waves, Plus, Trash2, ChevronDown } from 'lucide-react';
import { VUMeter } from './VUMeter';
import type { Track } from '../types/daw';
import { seededRandom } from '../mockData';
import { useContextMenu } from './ContextMenu';
import type { ContextMenuEntry } from './ContextMenu';

// Preset colors matching Swift TrackColor enum raw values
const TRACK_COLORS = [
  'teal', 'green', 'cyan', 'purple', 'pink',
  'gold', 'orange', 'red', 'blue', 'indigo',
] as const;

const COLOR_HEX: Record<string, string> = {
  teal: '#008080',
  green: '#4CAF50',
  cyan: '#00BCD4',
  purple: '#9C27B0',
  pink: '#E91E63',
  gold: '#FFC107',
  orange: '#FF9800',
  red: '#F44336',
  blue: '#2196F3',
  indigo: '#3F51B5',
};

interface TrackListProps {
  tracks: Track[];
  selectedTrackId: string | null;
  onSelectTrack?: (id: string) => void;
  onToggleMute?: (id: string) => void;
  onToggleSolo?: (id: string) => void;
  onToggleArm?: (id: string) => void;
  onAddTrack?: (type: 'midi' | 'audio' | 'bus') => void;
  onDeleteTrack?: (id: string) => void;
  onDuplicateTrack?: (id: string) => void;
  onRenameTrack?: (id: string, name: string) => void;
  onReorderTracks?: (trackIds: string[]) => void;
  onSetTrackColor?: (id: string, color: string) => void;
}

const trackIcon = (type: Track['type']) => {
  switch (type) {
    case 'midi':
      return <Music size={12} />;
    case 'audio':
      return <Volume2 size={12} />;
    case 'bus':
      return <Waves size={12} />;
  }
};

// ── Add Track Dropdown ──────────────────────────────────────────────────

const AddTrackDropdown: React.FC<{ onAdd: (type: 'midi' | 'audio' | 'bus') => void }> = ({ onAdd }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="glass-button flex items-center justify-center gap-0.5"
        style={{ height: 18, borderRadius: 4, padding: '0 4px' }}
        onClick={() => setOpen((v) => !v)}
        title="Add Track"
      >
        <Plus size={10} />
        <ChevronDown size={8} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: 'rgba(12, 20, 36, 0.95)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 4,
            zIndex: 100,
            minWidth: 120,
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          {([
            { type: 'audio' as const, label: 'Audio Track', icon: <Volume2 size={11} /> },
            { type: 'midi' as const, label: 'MIDI Track', icon: <Music size={11} /> },
            { type: 'bus' as const, label: 'Bus Track', icon: <Waves size={11} /> },
          ]).map(({ type, label, icon }) => (
            <button
              key={type}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded"
              style={{
                fontSize: 10,
                color: 'var(--text-dim)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.color = 'var(--text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-dim)';
              }}
              onClick={() => {
                onAdd(type);
                setOpen(false);
              }}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Inline Delete Confirmation ──────────────────────────────────────────

const DeleteConfirm: React.FC<{ onConfirm: () => void; onCancel: () => void }> = ({ onConfirm, onCancel }) => (
  <div
    className="flex items-center gap-1"
    style={{
      position: 'absolute',
      right: 4,
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'rgba(12, 20, 36, 0.95)',
      border: '1px solid rgba(239, 68, 68, 0.4)',
      borderRadius: 4,
      padding: '2px 4px',
      zIndex: 10,
      backdropFilter: 'blur(8px)',
    }}
  >
    <span style={{ fontSize: 8, color: '#ef4444', whiteSpace: 'nowrap' }}>Delete?</span>
    <button
      style={{
        fontSize: 8,
        color: '#ef4444',
        background: 'rgba(239, 68, 68, 0.15)',
        border: '1px solid rgba(239, 68, 68, 0.4)',
        borderRadius: 3,
        padding: '1px 5px',
        cursor: 'pointer',
      }}
      onClick={(e) => { e.stopPropagation(); onConfirm(); }}
    >
      Yes
    </button>
    <button
      style={{
        fontSize: 8,
        color: 'var(--text-muted)',
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        padding: '1px 5px',
        cursor: 'pointer',
      }}
      onClick={(e) => { e.stopPropagation(); onCancel(); }}
    >
      No
    </button>
  </div>
);

// ── Track Item ──────────────────────────────────────────────────────────

interface TrackItemProps {
  track: Track;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onToggleArm: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRename: (name: string) => void;
  onColorCycle: () => void;
  onSetColor: (color: string) => void;
  onAddTrack: (type: 'midi' | 'audio' | 'bus') => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
  isDragOver: boolean;
}

const TrackItem: React.FC<TrackItemProps> = ({
  track,
  index,
  isSelected,
  onSelect,
  onToggleMute,
  onToggleSolo,
  onToggleArm,
  onDelete,
  onDuplicate,
  onRename,
  onColorCycle,
  onSetColor,
  onAddTrack,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragOver,
}) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(track.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rng = seededRandom(index * 31 + 7);
  const vuLevel = 0.3 + rng() * 0.4;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== track.name) {
      onRename(trimmed);
    }
    setEditing(false);
  }, [editValue, track.name, onRename]);

  const { openMenu } = useContextMenu();

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const colorItems: ContextMenuEntry[] = TRACK_COLORS.map((c) => ({
        label: `  ${c.charAt(0).toUpperCase() + c.slice(1)}`,
        action: () => onSetColor(c),
      }));

      const items: ContextMenuEntry[] = [
        { label: 'Add Track', shortcut: '\u2318T', action: () => onAddTrack('midi') },
        { label: 'Duplicate Track', shortcut: '\u2318D', action: () => onDuplicate() },
        { separator: true },
        {
          label: 'Rename',
          action: () => {
            setEditValue(track.name);
            setEditing(true);
          },
        },
        { separator: true },
        ...colorItems,
        { separator: true },
        { label: 'Delete Track', shortcut: '\u232B', action: () => onDelete() },
      ];

      openMenu(e.clientX, e.clientY, items);
    },
    [openMenu, onAddTrack, onDelete, onDuplicate, onSetColor, track.name],
  );

  return (
    <div
      className={`track-item mx-1 mb-0.5 rounded-md px-2 py-1.5 ${isSelected ? 'selected' : ''}`}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderLeft: `3px solid ${track.color}`,
        background: isDragOver
          ? 'rgba(255, 255, 255, 0.08)'
          : isSelected
            ? 'rgba(255, 255, 255, 0.05)'
            : 'transparent',
        border: isDragOver
          ? '1px solid rgba(255,255,255,0.12)'
          : isSelected
            ? '1px solid rgba(255,255,255,0.1)'
            : '1px solid transparent',
        borderLeftWidth: 3,
        borderLeftColor: track.color,
        cursor: 'grab',
        transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
        ...(isSelected ? { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' } : {}),
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(index);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOver(index);
      }}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onContextMenu={handleContextMenu}
    >
      {/* Color stripe — click to cycle */}
      <div
        style={{
          color: track.color,
          opacity: 0.8,
          cursor: 'pointer',
        }}
        onClick={(e) => {
          e.stopPropagation();
          onColorCycle();
        }}
        title="Click to change color"
      >
        {trackIcon(track.type)}
      </div>

      {/* Name — double-click to rename */}
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') { setEditValue(track.name); setEditing(false); }
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text)',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            padding: '0 4px',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <span
          className="flex-1 truncate"
          style={{
            fontSize: 11,
            fontWeight: isSelected ? 600 : 400,
            color: isSelected ? 'var(--text)' : 'var(--text-dim)',
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditValue(track.name);
            setEditing(true);
          }}
        >
          {track.name}
        </span>
      )}

      {/* Mini VU */}
      <VUMeter level={track.muted ? 0 : vuLevel} width={3} height={20} />

      {/* M/S/R Buttons */}
      <div className="flex gap-0.5">
        <button
          className="flex items-center justify-center"
          style={{
            width: 16,
            height: 14,
            borderRadius: 2,
            fontSize: 7,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            background: track.muted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${track.muted ? 'rgba(239, 68, 68, 0.5)' : 'var(--border)'}`,
            color: track.muted ? '#ef4444' : 'var(--text-muted)',
            cursor: 'pointer',
          }}
          onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
        >
          M
        </button>
        <button
          className="flex items-center justify-center"
          style={{
            width: 16,
            height: 14,
            borderRadius: 2,
            fontSize: 7,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            background: track.soloed ? 'rgba(214, 190, 138, 0.2)' : 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${track.soloed ? 'rgba(214, 190, 138, 0.4)' : 'var(--border)'}`,
            color: track.soloed ? 'var(--warning)' : 'var(--text-muted)',
            cursor: 'pointer',
          }}
          onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
        >
          S
        </button>
        {(track.type === 'audio' || track.type === 'midi') && (
          <button
            className={`flex items-center justify-center ${track.armed ? 'animate-pulse-glow' : ''}`}
            style={{
              width: 16,
              height: 14,
              borderRadius: 2,
              fontSize: 7,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              background: track.armed ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${track.armed ? 'rgba(239, 68, 68, 0.6)' : 'var(--border)'}`,
              color: track.armed ? '#ef4444' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
            onClick={(e) => { e.stopPropagation(); onToggleArm(); }}
            title="Record arm"
          >
            R
          </button>
        )}
      </div>

      {/* Delete button */}
      <button
        className="flex items-center justify-center"
        style={{
          width: 14,
          height: 14,
          borderRadius: 2,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          opacity: 0.4,
          transition: 'opacity 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#ef4444'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        onClick={(e) => {
          e.stopPropagation();
          setConfirmingDelete(true);
        }}
        title="Delete track"
      >
        <Trash2 size={9} />
      </button>

      {/* Inline delete confirmation */}
      {confirmingDelete && (
        <DeleteConfirm
          onConfirm={() => { setConfirmingDelete(false); onDelete(); }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
};

// ── Track List ──────────────────────────────────────────────────────────

export const TrackList: React.FC<TrackListProps> = ({
  tracks,
  selectedTrackId,
  onSelectTrack,
  onToggleMute,
  onToggleSolo,
  onToggleArm,
  onAddTrack,
  onDeleteTrack,
  onDuplicateTrack,
  onRenameTrack,
  onReorderTracks,
  onSetTrackColor,
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      const reordered = [...tracks];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(dragOverIndex, 0, moved);
      onReorderTracks?.(reordered.map((t) => t.id));
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex, dragOverIndex, tracks, onReorderTracks]);

  const cycleColor = useCallback((trackId: string, currentColor: string) => {
    // Find current color in preset list by matching hex
    const currentIndex = TRACK_COLORS.findIndex((c) => COLOR_HEX[c] === currentColor);
    const nextIndex = (currentIndex + 1) % TRACK_COLORS.length;
    onSetTrackColor?.(trackId, TRACK_COLORS[nextIndex]);
  }, [onSetTrackColor]);

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: 200,
        background: 'rgba(10, 10, 11, 0.82)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span
          style={{
            fontSize: 9,
            color: 'var(--text-muted)',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}
        >
          Tracks
        </span>
        <AddTrackDropdown onAdd={(type) => onAddTrack?.(type)} />
      </div>

      {/* Track List */}
      <div className="flex-1 overflow-y-auto py-1">
        {tracks.map((track, i) => (
          <TrackItem
            key={track.id}
            track={track}
            index={i}
            isSelected={track.id === selectedTrackId}
            onSelect={() => onSelectTrack?.(track.id)}
            onToggleMute={() => onToggleMute?.(track.id)}
            onToggleSolo={() => onToggleSolo?.(track.id)}
            onToggleArm={() => onToggleArm?.(track.id)}
            onDelete={() => onDeleteTrack?.(track.id)}
            onDuplicate={() => onDuplicateTrack?.(track.id)}
            onRename={(name) => onRenameTrack?.(track.id, name)}
            onColorCycle={() => cycleColor(track.id, track.color)}
            onSetColor={(color) => onSetTrackColor?.(track.id, color)}
            onAddTrack={(type) => onAddTrack?.(type)}
            onDragStart={setDragIndex}
            onDragOver={setDragOverIndex}
            onDragEnd={handleDragEnd}
            isDragOver={dragOverIndex === i && dragIndex !== i}
          />
        ))}
      </div>

      {/* Add Track Buttons */}
      <div
        className="flex gap-1 px-2 py-2"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        {(['midi', 'audio', 'bus'] as const).map((type) => (
          <button
            key={type}
            className="glass-button flex-1 py-1"
            style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            onClick={() => onAddTrack?.(type)}
          >
            + {type}
          </button>
        ))}
      </div>
    </div>
  );
};
