import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, Check, Send, Loader2 } from 'lucide-react';
import { GlassPanel } from './GlassPanel';
import { aurora, mockChordSuggestions, mockProgression } from '../mockData';
import { onSwiftMessage, sendToSwift, BridgeMessages } from '../bridge';
import type { ChordSuggestion } from '../types/daw';

// ── Types for Swift bridge events ───────────────────────────────────────────

interface ChordDetectedPayload {
  chord: string | null;
  root?: string;
  quality?: string;
  qualityName?: string;
  notes?: number[];
}

interface KeyDetectedPayload {
  key: string | null;
  tonic?: string;
  mode?: string;
  confidence: number;
}

interface ChordSuggestionsPayload {
  suggestions: Array<{
    chord: string;
    probability: number;
    quality: string;
    explanation: string;
    source: string;
  }>;
}

interface AIChatResultPayload {
  result?: string;
  error?: string;
  model?: string;
  latencyMs?: number;
  requestId?: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export const AIPanel: React.FC = () => {
  const [query, setQuery] = useState('');
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Live state from Swift bridge (falls back to mock data when no bridge)
  const [currentChord, setCurrentChord] = useState<string | null>(null);
  const [chordQuality, setChordQuality] = useState<string>('');
  const [detectedKey, setDetectedKey] = useState<{ key: string; confidence: number } | null>(null);
  const [suggestions, setSuggestions] = useState<ChordSuggestion[]>(mockChordSuggestions);
  const [progression, setProgression] = useState<string[]>(mockProgression);

  const requestIdRef = useRef(0);

  // Subscribe to Swift bridge events
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // Chord detection from MIDIRouter -> ChordAnalyzer
    unsubs.push(
      onSwiftMessage(BridgeMessages.CHORD_DETECTED, (payload: unknown) => {
        const p = payload as ChordDetectedPayload;
        if (p.chord) {
          setCurrentChord(p.chord);
          setChordQuality(p.qualityName ?? '');
          // Add to progression history (keep last 7)
          setProgression((prev) => {
            const next = [...prev, p.chord!];
            return next.slice(-7);
          });
        } else {
          // No chord (all notes released)
          // Keep displaying last chord
        }
      }),
    );

    // Key detection from MIDIRouter -> RealtimeKeyDetector
    unsubs.push(
      onSwiftMessage(BridgeMessages.KEY_DETECTED, (payload: unknown) => {
        const p = payload as KeyDetectedPayload;
        if (p.key && p.confidence > 0) {
          setDetectedKey({ key: p.key as string, confidence: p.confidence });
        }
      }),
    );

    // Chord suggestions from HarmonyService (AI + algorithmic fallback)
    unsubs.push(
      onSwiftMessage(BridgeMessages.CHORD_SUGGESTIONS, (payload: unknown) => {
        const p = payload as ChordSuggestionsPayload;
        if (p.suggestions && p.suggestions.length > 0) {
          setSuggestions(
            p.suggestions.map((s) => ({
              chord: s.chord,
              probability: s.probability,
              quality: s.quality,
            })),
          );
        }
      }),
    );

    // AI chat response (natural language)
    unsubs.push(
      onSwiftMessage(BridgeMessages.AI_CHAT_RESULT, (payload: unknown) => {
        const p = payload as AIChatResultPayload;
        setAiLoading(false);
        if (p.error) {
          setAiResponse(`Error: ${p.error}`);
        } else if (p.result) {
          setAiResponse(p.result);
        }
      }),
    );

    return () => unsubs.forEach((fn) => fn());
  }, []);

  // Send natural language query to Ollama via AIRouter
  const handleSendQuery = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const id = String(++requestIdRef.current);
    setAiLoading(true);
    setAiResponse(null);

    sendToSwift(BridgeMessages.AI_REQUEST, {
      prompt: trimmed,
      requestId: id,
    });

    setQuery('');
  }, [query]);

  // Handle Enter key in input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSendQuery();
      }
    },
    [handleSendQuery],
  );

  // Display chord name or fallback
  const displayChord = currentChord ?? 'Em9';
  const displayQuality = chordQuality || 'minor ninth';

  return (
    <div className="flex gap-3 h-full">
      {/* Current Chord Display */}
      <div className="flex flex-col items-center justify-center gap-1" style={{ minWidth: 100 }}>
        <span style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Current
        </span>
        <span
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: aurora.cyan,
            fontFamily: 'var(--font-display)',
          }}
          className="text-glow-cyan"
        >
          {displayChord}
        </span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{displayQuality}</span>

        {/* Detected key */}
        {detectedKey && (
          <span
            style={{
              fontSize: 7,
              color: detectedKey.confidence > 0.5 ? aurora.teal : 'var(--text-muted)',
              marginTop: 2,
            }}
          >
            Key: {detectedKey.key} ({Math.round(detectedKey.confidence * 100)}%)
          </span>
        )}

        {/* Mini progression */}
        <div className="flex gap-1 mt-1 flex-wrap justify-center">
          {progression.map((chord, i) => (
            <span
              key={i}
              className="glass-panel px-1.5 py-0.5"
              style={{
                fontSize: 7,
                borderRadius: 8,
                color: chord === displayChord ? aurora.cyan : 'var(--text-dim)',
                borderColor: chord === displayChord ? 'rgba(103, 232, 249, 0.3)' : 'var(--border)',
                background: chord === displayChord ? 'rgba(103, 232, 249, 0.1)' : 'var(--surface)',
              }}
            >
              {chord}
            </span>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: 1, background: 'var(--border)' }} />

      {/* Suggested Chords */}
      <div className="flex flex-col gap-1 flex-1">
        <span
          style={{
            fontSize: 8,
            color: 'var(--text-muted)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          Suggested Next
        </span>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((suggestion, i) => (
            <GlassPanel
              key={i}
              className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer glass-panel-hover"
              style={{ borderRadius: 8 }}
              glow={i === 0 ? aurora.teal : undefined}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: i === 0 ? aurora.teal : aurora.text,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {suggestion.chord}
              </span>
              {/* Probability bar */}
              <div style={{ width: 40, height: 3, background: 'rgba(0,0,0,0.3)', borderRadius: 2 }}>
                <div
                  style={{
                    width: `${suggestion.probability * 100}%`,
                    height: '100%',
                    borderRadius: 2,
                    background: `linear-gradient(to right, ${aurora.teal}, ${aurora.cyan})`,
                    opacity: 0.7,
                  }}
                />
              </div>
              <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>
                {Math.round(suggestion.probability * 100)}%
              </span>
              <button
                className="flex items-center justify-center rounded"
                style={{
                  width: 16,
                  height: 16,
                  background: 'rgba(45, 212, 191, 0.15)',
                  border: '1px solid rgba(45, 212, 191, 0.3)',
                  cursor: 'pointer',
                  color: aurora.teal,
                }}
              >
                <Check size={8} />
              </button>
            </GlassPanel>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: 1, background: 'var(--border)' }} />

      {/* Natural Language Input */}
      <div className="flex flex-col gap-1.5" style={{ minWidth: 200 }}>
        <span
          style={{
            fontSize: 8,
            color: 'var(--text-muted)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          <Sparkles size={9} style={{ display: 'inline', marginRight: 4 }} />
          Ask AI
        </span>
        <div className="flex gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Suggest a jazz chord progression..."
            className="flex-1 rounded px-2 py-1"
            style={{
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontSize: 9,
              fontFamily: 'var(--font-mono)',
              outline: 'none',
            }}
            disabled={aiLoading}
          />
          <button
            className="glass-button flex items-center justify-center"
            style={{ width: 28, height: 24, borderRadius: 4 }}
            onClick={handleSendQuery}
            disabled={aiLoading || !query.trim()}
          >
            {aiLoading ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
          </button>
        </div>

        {/* AI Response */}
        {aiResponse && (
          <div
            className="glass-panel px-2 py-1.5"
            style={{
              fontSize: 8,
              color: aiResponse.startsWith('Error:') ? aurora.pink : 'var(--text)',
              borderRadius: 6,
              maxHeight: 60,
              overflowY: 'auto',
              lineHeight: 1.4,
            }}
          >
            {aiResponse}
          </div>
        )}

        {/* Scale suggestions based on detected key */}
        <div className="flex flex-col gap-1">
          <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>Scales</span>
          <div className="flex gap-1 flex-wrap">
            {(detectedKey
              ? [detectedKey.key, `${detectedKey.key.split(' ')[0]} Pentatonic`, `${detectedKey.key.split(' ')[0]} Blues`]
              : ['E Dorian', 'G Major', 'E Blues', 'E Phrygian']
            ).map((scale) => (
              <span
                key={scale}
                className="glass-panel px-2 py-0.5 cursor-pointer glass-panel-hover"
                style={{ fontSize: 8, borderRadius: 6, color: 'var(--text-dim)' }}
              >
                {scale}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
