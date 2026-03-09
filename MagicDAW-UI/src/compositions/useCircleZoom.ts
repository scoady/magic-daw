import { useMemo, useRef } from 'react';
import { spring, interpolate } from 'remotion';

// ── Shared circle-of-fifths key arrays ──────────────────────────────────────

export const FIFTHS_MAJOR = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
export const FIFTHS_MINOR = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];
export const FIFTHS_DIM = ['Bdim', 'F#dim', 'C#dim', 'G#dim', 'D#dim', 'A#dim', 'Fdim', 'Cdim', 'Gdim', 'Ddim', 'Adim', 'Edim'];

const ENHARMONIC_MAP: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'Gb': 'F#',
  'Cb': 'B', 'Fb': 'E', 'B#': 'C', 'E#': 'F',
};

function normalizeNoteForRing(n: string): string {
  return ENHARMONIC_MAP[n] ?? n;
}

export interface DetectedRing {
  ring: 'major' | 'minor' | 'dim' | null;
  index: number;
}

/** Parse a detected chord name (e.g. "Am", "Bdim", "C", "F#m7") and return
 *  which ring it belongs to and its circle-of-fifths index. */
export function chordToRingIndex(chord: string | null): DetectedRing {
  if (!chord) return { ring: null, index: -1 };
  const base = chord.replace(/(maj7|m7|7|9|11|13|sus[24]|aug|\?)$/i, '');

  // Diminished
  if (base.endsWith('dim') || chord.includes('dim')) {
    const root = base.replace(/dim$/, '');
    const norm = normalizeNoteForRing(root);
    const idx = FIFTHS_DIM.findIndex((k) => {
      const kr = k.replace(/dim$/, '');
      return kr === norm || kr === root;
    });
    return { ring: idx >= 0 ? 'dim' : null, index: idx };
  }

  // Minor
  if (base.endsWith('m')) {
    const root = base.slice(0, -1);
    const norm = normalizeNoteForRing(root);
    const idx = FIFTHS_MINOR.findIndex((k) => {
      const kr = k.replace(/m$/, '');
      return kr === norm || kr === root;
    });
    return { ring: idx >= 0 ? 'minor' : null, index: idx };
  }

  // Major
  const m = base.match(/^([A-G][#b]?)/);
  const root = m ? normalizeNoteForRing(m[1]) : '';
  const idx = FIFTHS_MAJOR.indexOf(root);
  return { ring: idx >= 0 ? 'major' : null, index: idx };
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ZoomTarget {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ZoomState {
  viewBox: string;
  isZoomed: boolean;
  /** Circle-of-fifths indices of the "next playable" chords (adjacent fifths + relative minor) */
  adjacentIndices: number[];
  /** Zoom progress 0→1 (0=full view, 1=fully zoomed) */
  zoomProgress: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function polarToXY(cx: number, cy: number, r: number, index: number): [number, number] {
  const angleDeg = (index / 12) * 360;
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Computes a smoothly animated SVG viewBox that zooms into the quadrant
 * containing the played note(s) on the circle of fifths.
 *
 * When no notes are played, returns the full viewport.
 * When zoomed, also returns the indices of adjacent "next playable" chords
 * so the composition can show only relevant mini keyboards.
 */
export function useCircleZoom(opts: {
  playedIndices: Set<number>;
  cx: number;
  cy: number;
  outerR: number;
  fullW: number;
  fullH: number;
  frame: number;
  fps: number;
  /** Zoom level: fraction of full viewport (0.5 = 2× zoom). Default 0.5 */
  zoomFraction?: number;
}): ZoomState {
  const {
    playedIndices,
    cx, cy, outerR,
    fullW, fullH,
    frame, fps,
    zoomFraction = 0.5,
  } = opts;

  // Compute target viewBox based on played notes
  const zoomTarget = useMemo((): ZoomTarget => {
    if (playedIndices.size === 0) {
      return { x: 0, y: 0, w: fullW, h: fullH };
    }

    // Find centroid of played nodes on outer ring
    let sumX = 0, sumY = 0, count = 0;
    playedIndices.forEach((idx) => {
      const [nx, ny] = polarToXY(cx, cy, outerR, idx);
      sumX += nx;
      sumY += ny;
      count++;
    });
    const centroidX = sumX / count;
    const centroidY = sumY / count;

    // Zoom window
    const zw = fullW * zoomFraction;
    const zh = fullH * zoomFraction;

    // Center on centroid, clamp to viewport
    return {
      x: Math.max(0, Math.min(fullW - zw, centroidX - zw / 2)),
      y: Math.max(0, Math.min(fullH - zh, centroidY - zh / 2)),
      w: zw,
      h: zh,
    };
  }, [playedIndices, cx, cy, outerR, fullW, fullH, zoomFraction]);

  // Track previous target for spring animation
  const prevRef = useRef<{ target: ZoomTarget; changeFrame: number }>({
    target: { x: 0, y: 0, w: fullW, h: fullH },
    changeFrame: 0,
  });

  // Detect target change
  const prev = prevRef.current;
  const targetChanged =
    prev.target.x !== zoomTarget.x ||
    prev.target.y !== zoomTarget.y ||
    prev.target.w !== zoomTarget.w ||
    prev.target.h !== zoomTarget.h;

  if (targetChanged) {
    // Snapshot the current interpolated position as the new "from"
    // Use spring to compute where we currently are in the old transition
    const elapsed = frame - prev.changeFrame;
    const oldProgress = spring({
      frame: elapsed,
      fps,
      config: { damping: 22, stiffness: 35, mass: 1.2 },
      durationInFrames: Math.round(fps * 2.5),
    });
    prevRef.current = {
      target: {
        x: prev.target.x + (zoomTarget.x - prev.target.x) * oldProgress,
        y: prev.target.y + (zoomTarget.y - prev.target.y) * oldProgress,
        w: prev.target.w + (zoomTarget.w - prev.target.w) * oldProgress,
        h: prev.target.h + (zoomTarget.h - prev.target.h) * oldProgress,
      },
      changeFrame: frame,
    };
  }

  const from = prevRef.current.target;
  const elapsed = frame - prevRef.current.changeFrame;

  // Spring-driven progress — smooth, visible zoom (not instant)
  const progress = spring({
    frame: elapsed,
    fps,
    config: { damping: 22, stiffness: 35, mass: 1.2 },
    durationInFrames: Math.round(fps * 2.5),
  });

  const vx = interpolate(progress, [0, 1], [from.x, zoomTarget.x]);
  const vy = interpolate(progress, [0, 1], [from.y, zoomTarget.y]);
  const vw = interpolate(progress, [0, 1], [from.w, zoomTarget.w]);
  const vh = interpolate(progress, [0, 1], [from.h, zoomTarget.h]);

  const isZoomed = playedIndices.size > 0;

  // Compute adjacent "next playable" indices
  const adjacentIndices = useMemo(() => {
    if (playedIndices.size === 0) return [];

    const indices: Set<number> = new Set();
    playedIndices.forEach((idx) => {
      // The played note itself
      indices.add(idx);
      // Adjacent fifths (clockwise and counter-clockwise)
      indices.add((idx + 1) % 12);
      indices.add((idx + 11) % 12);
      // Two steps away (less common but still visible)
      indices.add((idx + 2) % 12);
      indices.add((idx + 10) % 12);
    });
    return Array.from(indices).sort((a, b) => a - b);
  }, [playedIndices]);

  // Zoom progress for opacity transitions (0 = full, 1 = zoomed)
  const zoomProgress = isZoomed
    ? interpolate(progress, [0, 1], [0, 1])
    : interpolate(progress, [0, 1], [1, 0]);

  return {
    viewBox: `${vx} ${vy} ${vw} ${vh}`,
    isZoomed,
    adjacentIndices,
    zoomProgress: isZoomed ? progress : 1 - progress,
  };
}
