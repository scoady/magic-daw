import React, { useCallback, useRef, useMemo, useState, useEffect } from 'react';
import { Player } from '@remotion/player';
import { LiveMixer } from '../compositions/LiveMixer';
import type { LiveMixerProps } from '../compositions/LiveMixer';
import type { Track, EffectTypeName, EffectSlot } from '../types/daw';
import { EFFECT_PARAMS, EFFECT_DISPLAY_NAMES } from '../types/daw';
import {
  sendToSwift, BridgeMessages, onSwiftMessage,
  addEffect, removeEffect, setEffectParam, bypassEffect, setSendLevel,
} from '../bridge';
import type { EffectsChainUpdatedPayload } from '../bridge';

interface MixViewProps {
  tracks: Track[];
  trackLevels?: Record<string, { left: number; right: number }>;
  onVolumeChange?: (trackId: string, volume: number) => void;
  onPanChange?: (trackId: string, pan: number) => void;
  onMuteToggle?: (trackId: string) => void;
  onSoloToggle?: (trackId: string) => void;
  onEffectChange?: (trackId: string, effectIndex: number, paramName: string, value: number) => void;
}

const EFFECT_TYPES: EffectTypeName[] = ['eq', 'compressor', 'reverb', 'delay', 'chorus', 'distortion'];

export const MixView: React.FC<MixViewProps> = ({
  tracks,
  trackLevels,
  onVolumeChange,
  onPanChange,
  onMuteToggle,
  onSoloToggle,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{
    trackId: string;
    type: 'fader' | 'pan';
    startY: number;
    startX: number;
    startValue: number;
  } | null>(null);

  // ── Effects Chain State ──
  const [effectsChains, setEffectsChains] = useState<Record<string, EffectSlot[]>>({});
  const [selectedEffectTrack, setSelectedEffectTrack] = useState<string | null>(null);
  const [showEffectDropdown, setShowEffectDropdown] = useState<string | null>(null);

  // Listen for effects chain updates from Swift
  useEffect(() => {
    const unsub = onSwiftMessage(BridgeMessages.EFFECTS_CHAIN_UPDATED, (payload) => {
      const p = payload as EffectsChainUpdatedPayload;
      setEffectsChains(prev => ({
        ...prev,
        [p.trackId]: p.effects.map((e, i) => ({
          id: `${p.trackId}-${i}`,
          type: e.type,
          bypassed: e.bypassed,
          params: e.params,
        })),
      }));
    });
    return unsub;
  }, []);

  // Derive soloed/muted lists for the composition
  const soloedTracks = useMemo(
    () => tracks.filter((t) => t.soloed).map((t) => t.id),
    [tracks],
  );
  const mutedTracks = useMemo(
    () => tracks.filter((t) => t.muted).map((t) => t.id),
    [tracks],
  );

  // Master levels — use first available or fallback
  const masterLevelL = useMemo(() => {
    const values = Object.values(trackLevels ?? {});
    if (values.length === 0) return 0.65;
    return Math.min(1, values.reduce((sum, v) => sum + v.left, 0) / values.length + 0.3);
  }, [trackLevels]);

  const masterLevelR = useMemo(() => {
    const values = Object.values(trackLevels ?? {});
    if (values.length === 0) return 0.62;
    return Math.min(1, values.reduce((sum, v) => sum + v.right, 0) / values.length + 0.28);
  }, [trackLevels]);

  const selectedTrackId = useMemo(
    () => tracks.find((t) => t.soloed)?.id ?? tracks[0]?.id ?? null,
    [tracks],
  );

  const busTracks = useMemo(() => tracks.filter(t => t.type === 'bus'), [tracks]);

  // Build input props for the Remotion composition
  const inputProps: LiveMixerProps = useMemo(() => ({
    tracks,
    masterLevelL,
    masterLevelR,
    trackLevels: trackLevels ?? {},
    selectedTrackId,
    soloedTracks,
    mutedTracks,
    effectsChains,
  }), [tracks, masterLevelL, masterLevelR, trackLevels, selectedTrackId, soloedTracks, mutedTracks, effectsChains]);

  // Interactive overlay: handle clicks on mute/solo buttons rendered in the composition
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const actionEl = target.closest('[data-action]') as HTMLElement | null;
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const trackId = actionEl.dataset.trackId;
    if (!trackId) return;

    if (action === 'mute') {
      onMuteToggle?.(trackId);
    } else if (action === 'solo') {
      onSoloToggle?.(trackId);
    } else if (action === 'add-effect') {
      setShowEffectDropdown(prev => prev === trackId ? null : trackId);
    } else if (action === 'select-effect') {
      const effectType = actionEl.dataset.effectType as EffectTypeName;
      if (effectType) {
        addEffect(trackId, effectType);
        setShowEffectDropdown(null);
      }
    } else if (action === 'remove-effect') {
      const idx = parseInt(actionEl.dataset.effectIndex ?? '0', 10);
      removeEffect(trackId, idx);
    } else if (action === 'bypass-effect') {
      const idx = parseInt(actionEl.dataset.effectIndex ?? '0', 10);
      const chain = effectsChains[trackId] ?? [];
      const current = chain[idx]?.bypassed ?? false;
      bypassEffect(trackId, idx, !current);
    } else if (action === 'show-effect-params') {
      setSelectedEffectTrack(prev => prev === trackId ? null : trackId);
    }
  }, [onMuteToggle, onSoloToggle, effectsChains]);

  // Fader dragging on the overlay layer
  const handleOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const stripEl = target.closest('[data-track-id]') as HTMLElement | null;
    if (!stripEl) return;

    const trackId = stripEl.dataset.trackId;
    if (!trackId) return;

    const actionEl = target.closest('[data-action]');
    if (actionEl) return;

    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;

    draggingRef.current = {
      trackId,
      type: 'fader',
      startY: e.clientY,
      startX: e.clientX,
      startValue: track.volume,
    };

    const handleMouseMove = (me: MouseEvent) => {
      if (!draggingRef.current) return;
      const dy = draggingRef.current.startY - me.clientY;
      const sensitivity = 200;
      const newVal = Math.max(0, Math.min(1, draggingRef.current.startValue + dy / sensitivity));
      onVolumeChange?.(draggingRef.current.trackId, newVal);
    };

    const handleMouseUp = () => {
      draggingRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [tracks, onVolumeChange]);

  // Pan knob dragging via right-click or shift+click
  const handleOverlayContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const stripEl = target.closest('[data-track-id]') as HTMLElement | null;
    if (!stripEl) return;

    const trackId = stripEl.dataset.trackId;
    if (!trackId) return;

    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;

    draggingRef.current = {
      trackId,
      type: 'pan',
      startY: e.clientY,
      startX: e.clientX,
      startValue: track.pan,
    };

    const handleMouseMove = (me: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = me.clientX - draggingRef.current.startX;
      const sensitivity = 150;
      const newVal = Math.max(-1, Math.min(1, draggingRef.current.startValue + dx / sensitivity));
      onPanChange?.(draggingRef.current.trackId, newVal);
    };

    const handleMouseUp = () => {
      draggingRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [tracks, onPanChange]);

  // ── Effect Parameter Panel ──
  const effectParamPanel = useMemo(() => {
    if (!selectedEffectTrack) return null;
    const chain = effectsChains[selectedEffectTrack] ?? [];
    if (chain.length === 0) return null;
    const track = tracks.find(t => t.id === selectedEffectTrack);
    if (!track) return null;

    return (
      <div style={{
        position: 'absolute', bottom: 65, left: 8, right: 8,
        background: 'rgba(10,15,26,0.95)', border: '1px solid rgba(120,200,220,0.2)',
        borderRadius: 8, padding: 10, zIndex: 20, backdropFilter: 'blur(20px)',
        maxHeight: 200, overflowY: 'auto',
      }}>
        <div style={{ fontSize: 10, color: '#67e8f9', marginBottom: 6, fontWeight: 700 }}>
          {track.name} — Effects
        </div>
        {chain.map((effect, idx) => {
          const params = EFFECT_PARAMS[effect.type] ?? [];
          return (
            <div key={effect.id} style={{ marginBottom: 8 }}>
              <div style={{
                fontSize: 9, color: effect.bypassed ? '#64748b' : '#e2e8f0',
                fontWeight: 600, marginBottom: 3,
                textDecoration: effect.bypassed ? 'line-through' : 'none',
              }}>
                {EFFECT_DISPLAY_NAMES[effect.type]}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {params.map(p => (
                  <label key={p.name} style={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 7, color: '#94a3b8' }}>
                    {p.label}
                    <input
                      type="range"
                      min={p.min} max={p.max} step={p.step}
                      value={effect.params[p.name] ?? (p.min + p.max) / 2}
                      onChange={(e) => setEffectParam(selectedEffectTrack, idx, p.name, parseFloat(e.target.value))}
                      style={{ width: 60, height: 10, accentColor: '#67e8f9' }}
                    />
                    <span style={{ fontSize: 6, color: '#64748b' }}>
                      {(effect.params[p.name] ?? 0).toFixed(1)}{p.unit ? ` ${p.unit}` : ''}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }, [selectedEffectTrack, effectsChains, tracks]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: '#0a0f1a',
      }}
    >
      {/* Remotion Player — purely visual layer */}
      <Player
        component={LiveMixer}
        inputProps={inputProps}
        compositionWidth={1200}
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

      {/* Interactive overlay — captures mouse events for faders, knobs, buttons */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          cursor: 'default',
        }}
        onClick={handleOverlayClick}
        onMouseDown={handleOverlayMouseDown}
        onContextMenu={handleOverlayContextMenu}
      />

      {/* Effect parameter panel overlay */}
      {effectParamPanel}

      {/* Effect type dropdown */}
      {showEffectDropdown && (
        <div style={{
          position: 'absolute', top: 40, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(10,15,26,0.95)', border: '1px solid rgba(120,200,220,0.3)',
          borderRadius: 6, padding: 4, zIndex: 30, backdropFilter: 'blur(20px)',
        }}>
          {EFFECT_TYPES.map(type => (
            <div
              key={type}
              data-action="select-effect"
              data-track-id={showEffectDropdown}
              data-effect-type={type}
              style={{
                padding: '4px 12px', fontSize: 10, color: '#e2e8f0', cursor: 'pointer',
                borderRadius: 3,
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(120,200,220,0.15)'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
            >
              {EFFECT_DISPLAY_NAMES[type]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
