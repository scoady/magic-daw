import React from 'react';
import { Music, Volume2, Waves, Plus } from 'lucide-react';
import { VUMeter } from './VUMeter';
import type { Track } from '../types/daw';
import { aurora, seededRandom } from '../mockData';

interface TrackListProps {
  tracks: Track[];
  selectedTrackId: string | null;
  onSelectTrack?: (id: string) => void;
  onToggleMute?: (id: string) => void;
  onToggleSolo?: (id: string) => void;
  onAddTrack?: (type: 'midi' | 'audio' | 'bus') => void;
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

export const TrackList: React.FC<TrackListProps> = ({
  tracks,
  selectedTrackId,
  onSelectTrack,
  onToggleMute,
  onToggleSolo,
  onAddTrack,
}) => {
  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: 200,
        background: 'rgba(8, 14, 24, 0.6)',
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
        <div className="flex gap-1">
          <button
            className="glass-button flex items-center justify-center"
            style={{ width: 22, height: 18, borderRadius: 4 }}
            onClick={() => onAddTrack?.('midi')}
            title="Add Track"
          >
            <Plus size={10} />
          </button>
        </div>
      </div>

      {/* Track List */}
      <div className="flex-1 overflow-y-auto py-1">
        {tracks.map((track, i) => {
          const isSelected = track.id === selectedTrackId;
          const rng = seededRandom(i * 31 + 7);
          const vuLevel = 0.3 + rng() * 0.4;

          return (
            <div
              key={track.id}
              className={`track-item mx-1 mb-0.5 rounded-md px-2 py-1.5 ${
                isSelected ? 'selected' : ''
              }`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderLeft: `3px solid ${track.color}`,
                background: isSelected
                  ? 'rgba(103, 232, 249, 0.08)'
                  : 'transparent',
                border: isSelected
                  ? `1px solid ${aurora.borderBright}`
                  : '1px solid transparent',
                borderLeftWidth: 3,
                borderLeftColor: track.color,
                ...(isSelected
                  ? {
                      boxShadow: `0 0 12px ${track.color}22`,
                    }
                  : {}),
              }}
              onClick={() => onSelectTrack?.(track.id)}
            >
              {/* Icon */}
              <div style={{ color: track.color, opacity: 0.8 }}>
                {trackIcon(track.type)}
              </div>

              {/* Name */}
              <span
                className="flex-1 truncate"
                style={{
                  fontSize: 11,
                  fontWeight: isSelected ? 600 : 400,
                  color: isSelected ? 'var(--text)' : 'var(--text-dim)',
                }}
              >
                {track.name}
              </span>

              {/* Mini VU */}
              <VUMeter
                level={track.muted ? 0 : vuLevel}
                width={3}
                height={20}
              />

              {/* M/S Buttons */}
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
                    background: track.muted
                      ? 'rgba(239, 68, 68, 0.25)'
                      : 'rgba(120, 200, 220, 0.06)',
                    border: `1px solid ${
                      track.muted ? 'rgba(239, 68, 68, 0.5)' : 'var(--border)'
                    }`,
                    color: track.muted ? '#ef4444' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMute?.(track.id);
                  }}
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
                    background: track.soloed
                      ? `rgba(251, 191, 36, 0.25)`
                      : 'rgba(120, 200, 220, 0.06)',
                    border: `1px solid ${
                      track.soloed ? 'rgba(251, 191, 36, 0.5)' : 'var(--border)'
                    }`,
                    color: track.soloed ? aurora.gold : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSolo?.(track.id);
                  }}
                >
                  S
                </button>
              </div>
            </div>
          );
        })}
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
