import React, { useState, useEffect, useRef } from 'react';
import { Music, Disc3 } from 'lucide-react';
import { GlassPanel } from './GlassPanel';
import { onSwiftMessage, BridgeMessages } from '../bridge';
import { aurora } from '../mockData';
import type { SongMatch } from '../types/daw';

// ── Types ──────────────────────────────────────────────────────────────────

interface SongMatchesPayload {
  matches: Array<{
    title: string;
    artist: string;
    year: number;
    genre: string;
    progression: string[];
    section: string;
    confidence: number;
    matchedChords: number;
    matchType: string;
  }>;
}

// ── Genre color map ────────────────────────────────────────────────────────

const genreColors: Record<string, string> = {
  Pop: aurora.pink,
  Rock: aurora.cyan,
  Jazz: aurora.teal,
  Blues: '#8b7ec8',
  'R&B': aurora.purple,
  Classical: '#e8c547',
  Country: '#d4956a',
  Reggae: aurora.green,
  Electronic: aurora.cyan,
  'Hip-Hop': '#ff7b5c',
};

// ── Component ──────────────────────────────────────────────────────────────

export const SongMatchPanel: React.FC = () => {
  const [matches, setMatches] = useState<SongMatch[]>([]);
  const [visible, setVisible] = useState<boolean[]>([]);
  const prevMatchesRef = useRef<string>('');

  // Subscribe to song_matches events from Swift
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.SONG_MATCHES, (payload: unknown) => {
      const p = payload as SongMatchesPayload;
      if (p.matches && p.matches.length > 0) {
        const newMatches: SongMatch[] = p.matches.map((m) => ({
          title: m.title,
          artist: m.artist,
          year: m.year,
          genre: m.genre,
          progression: m.progression,
          section: m.section,
          confidence: m.confidence,
          matchedChords: m.matchedChords,
          matchType: m.matchType as SongMatch['matchType'],
        }));

        // Only animate if matches actually changed
        const key = newMatches.map((m) => `${m.title}|${m.artist}`).join(',');
        if (key !== prevMatchesRef.current) {
          prevMatchesRef.current = key;
          setMatches(newMatches);
          // Stagger reveal animation
          setVisible([]);
          newMatches.forEach((_, i) => {
            setTimeout(() => {
              setVisible((prev) => {
                const next = [...prev];
                next[i] = true;
                return next;
              });
            }, i * 80);
          });
        }
      } else {
        if (prevMatchesRef.current !== '') {
          prevMatchesRef.current = '';
          setMatches([]);
          setVisible([]);
        }
      }
    });

    return unsub;
  }, []);

  if (matches.length === 0) {
    return (
      <div
        className="flex items-center gap-2"
        style={{
          padding: '4px 8px',
          color: 'var(--text-muted)',
          fontSize: 8,
          fontStyle: 'italic',
        }}
      >
        <Disc3 size={10} style={{ opacity: 0.4 }} />
        Play 3+ chords to match songs...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" style={{ maxHeight: 120, overflowY: 'auto' }}>
      <div className="flex items-center gap-1.5" style={{ marginBottom: 2 }}>
        <Music size={9} style={{ color: aurora.pink }} />
        <span
          style={{
            fontSize: 8,
            color: 'var(--text-muted)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          Song Matches
        </span>
      </div>

      {matches.slice(0, 5).map((match, i) => {
        const genreColor = genreColors[match.genre] ?? aurora.text;
        const glowIntensity = match.confidence;
        const isVisible = visible[i] ?? false;

        return (
          <GlassPanel
            key={`${match.title}-${match.artist}`}
            className="flex items-center gap-2 px-2.5 py-1.5"
            style={{
              borderRadius: 8,
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? 'translateX(0)' : 'translateX(12px)',
              transition: 'opacity 0.3s ease, transform 0.3s ease, box-shadow 0.3s ease',
              boxShadow: `0 0 ${Math.round(glowIntensity * 12)}px ${Math.round(glowIntensity * 4)}px ${genreColor}22`,
              borderColor: `${genreColor}${Math.round(glowIntensity * 60).toString(16).padStart(2, '0')}`,
            }}
            glow={glowIntensity > 0.7 ? genreColor : undefined}
          >
            {/* Song info */}
            <div className="flex flex-col flex-1" style={{ minWidth: 0 }}>
              <div className="flex items-center gap-1.5">
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: i === 0 ? genreColor : aurora.text,
                    fontFamily: 'var(--font-display)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {match.title}
                </span>
                {match.year > 0 && (
                  <span
                    style={{
                      fontSize: 7,
                      color: 'var(--text-muted)',
                      opacity: 0.6,
                    }}
                  >
                    ({match.year})
                  </span>
                )}
              </div>
              <span
                style={{
                  fontSize: 8,
                  color: 'var(--text-dim)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {match.artist}
              </span>
            </div>

            {/* Genre tag */}
            <span
              style={{
                fontSize: 7,
                padding: '1px 5px',
                borderRadius: 4,
                background: `${genreColor}18`,
                color: genreColor,
                border: `1px solid ${genreColor}30`,
                whiteSpace: 'nowrap',
                fontWeight: 600,
              }}
            >
              {match.genre}
            </span>

            {/* Progression */}
            <div className="flex gap-0.5" style={{ flexShrink: 0 }}>
              {match.progression.slice(0, 6).map((chord, j) => (
                <span
                  key={j}
                  style={{
                    fontSize: 7,
                    padding: '0px 3px',
                    borderRadius: 3,
                    background:
                      j < match.matchedChords
                        ? `${genreColor}20`
                        : 'rgba(255,255,255,0.03)',
                    color:
                      j < match.matchedChords
                        ? genreColor
                        : 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: j < match.matchedChords ? 700 : 400,
                  }}
                >
                  {chord}
                </span>
              ))}
              {match.progression.length > 6 && (
                <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>
                  +{match.progression.length - 6}
                </span>
              )}
            </div>

            {/* Confidence indicator */}
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: genreColor,
                opacity: glowIntensity,
                boxShadow: `0 0 ${Math.round(glowIntensity * 6)}px ${genreColor}`,
                flexShrink: 0,
              }}
            />
          </GlassPanel>
        );
      })}
    </div>
  );
};
