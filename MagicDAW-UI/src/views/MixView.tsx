import React, { useCallback, useRef, useMemo } from 'react';
import { Player } from '@remotion/player';
import { LiveMixer } from '../compositions/LiveMixer';
import type { LiveMixerProps } from '../compositions/LiveMixer';
import type { Track } from '../types/daw';
import { sendToSwift, BridgeMessages } from '../bridge';

interface MixViewProps {
  tracks: Track[];
  trackLevels?: Record<string, { left: number; right: number }>;
  onVolumeChange?: (trackId: string, volume: number) => void;
  onPanChange?: (trackId: string, pan: number) => void;
  onMuteToggle?: (trackId: string) => void;
  onSoloToggle?: (trackId: string) => void;
  onEffectChange?: (trackId: string, effectIndex: number, paramName: string, value: number) => void;
}

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

  // Build input props for the Remotion composition
  const inputProps: LiveMixerProps = useMemo(() => ({
    tracks,
    masterLevelL,
    masterLevelR,
    trackLevels: trackLevels ?? {},
    selectedTrackId,
    soloedTracks,
    mutedTracks,
  }), [tracks, masterLevelL, masterLevelR, trackLevels, selectedTrackId, soloedTracks, mutedTracks]);

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
    }
  }, [onMuteToggle, onSoloToggle]);

  // Fader dragging on the overlay layer
  const handleOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    // Check if the click is on a fader area (within a channel strip)
    const target = e.target as HTMLElement;
    const stripEl = target.closest('[data-track-id]') as HTMLElement | null;
    if (!stripEl) return;

    const trackId = stripEl.dataset.trackId;
    if (!trackId) return;

    // Only start fader drag if not clicking a button
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
          // Transparent — all visuals come from the Remotion layer below
        }}
        onClick={handleOverlayClick}
        onMouseDown={handleOverlayMouseDown}
        onContextMenu={handleOverlayContextMenu}
      />
    </div>
  );
};
