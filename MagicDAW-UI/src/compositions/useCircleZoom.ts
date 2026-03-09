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

/** Parse a detected chord name and return which ring + index it maps to. */
export function chordToRingIndex(chord: string | null): DetectedRing {
  if (!chord) return { ring: null, index: -1 };
  const base = chord.replace(/(maj7|m7|7|9|11|13|sus[24]|aug|\?)$/i, '');

  if (base.endsWith('dim') || chord.includes('dim')) {
    const root = base.replace(/dim$/, '');
    const norm = normalizeNoteForRing(root);
    const idx = FIFTHS_DIM.findIndex((k) => {
      const kr = k.replace(/dim$/, '');
      return kr === norm || kr === root;
    });
    return { ring: idx >= 0 ? 'dim' : null, index: idx };
  }

  if (base.endsWith('m')) {
    const root = base.slice(0, -1);
    const norm = normalizeNoteForRing(root);
    const idx = FIFTHS_MINOR.findIndex((k) => {
      const kr = k.replace(/m$/, '');
      return kr === norm || kr === root;
    });
    return { ring: idx >= 0 ? 'minor' : null, index: idx };
  }

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
  /** True while actively zoomed (notes held OR within linger window) */
  isZoomed: boolean;
  /** Adjacent chord indices for the keyboard panel */
  adjacentIndices: number[];
  /** The primary played index (persists during linger/zoom-out) */
  primaryPlayedIdx: number;
  /** 0 = full view, 1 = fully zoomed. Drives opacity crossfade. */
  zoomProgress: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function polarToXY(cx: number, cy: number, r: number, index: number): [number, number] {
  const angleDeg = (index / 12) * 360;
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function computeZoomWindow(
  indices: Set<number>,
  cx: number, cy: number, outerR: number,
  fullW: number, fullH: number, zoomFraction: number,
): ZoomTarget {
  let sumX = 0, sumY = 0, count = 0;
  indices.forEach((idx) => {
    const [nx, ny] = polarToXY(cx, cy, outerR, idx);
    sumX += nx;
    sumY += ny;
    count++;
  });
  const centroidX = sumX / count;
  const centroidY = sumY / count;
  const zw = fullW * zoomFraction;
  const zh = fullH * zoomFraction;
  return {
    x: Math.max(0, Math.min(fullW - zw, centroidX - zw / 2)),
    y: Math.max(0, Math.min(fullH - zh, centroidY - zh / 2)),
    w: zw,
    h: zh,
  };
}

// ── Spring config ────────────────────────────────────────────────────────────

const ZOOM_IN_SPRING = { damping: 22, stiffness: 35, mass: 1.2 };
const ZOOM_OUT_SPRING = { damping: 20, stiffness: 20, mass: 1.5 }; // slower zoom out

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Smooth SVG viewBox zoom that tracks played notes on the circle of fifths.
 *
 * Behavior:
 * - Note pressed → zoom in to that node's quadrant
 * - New note while zoomed → smoothly pan to the new node (stay zoomed)
 * - Note released → LINGER for `lingerSeconds` at the last position
 * - After linger expires with no new notes → slowly zoom out to full view
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
  zoomFraction?: number;
  /** How long to stay zoomed after note release (seconds). Default 5 */
  lingerSeconds?: number;
}): ZoomState {
  const {
    playedIndices,
    cx, cy, outerR,
    fullW, fullH,
    frame, fps,
    zoomFraction = 0.5,
    lingerSeconds = 5,
  } = opts;

  const fullView: ZoomTarget = { x: 0, y: 0, w: fullW, h: fullH };
  const lingerFrames = Math.round(lingerSeconds * fps);

  // ── Persistent state across frames ──────────────────────────────────────

  const stateRef = useRef<{
    /** The "from" position for the current spring transition */
    from: ZoomTarget;
    /** The "to" position we're springing toward */
    to: ZoomTarget;
    /** Frame when the current transition started */
    transitionFrame: number;
    /** Frame when notes were last released (0 = notes still held) */
    releaseFrame: number;
    /** Last played indices (persisted for linger) */
    lastIndices: number[];
    lastPrimaryIdx: number;
    /** Are we currently in zoomed or zooming-out state? */
    phase: 'idle' | 'zoomed' | 'lingering' | 'zooming-out';
  }>({
    from: fullView,
    to: fullView,
    transitionFrame: 0,
    releaseFrame: 0,
    lastIndices: [],
    lastPrimaryIdx: -1,
    phase: 'idle',
  });

  const s = stateRef.current;
  const notesActive = playedIndices.size > 0;

  // ── State machine ─────────────────────────────────────────────────────

  if (notesActive) {
    // Notes are being held — compute zoom target
    const zoomTarget = computeZoomWindow(
      playedIndices, cx, cy, outerR, fullW, fullH, zoomFraction,
    );

    // Update persisted played info
    const adjSet = new Set<number>();
    playedIndices.forEach((idx) => {
      adjSet.add(idx);
      adjSet.add((idx + 1) % 12);
      adjSet.add((idx + 11) % 12);
      adjSet.add((idx + 2) % 12);
      adjSet.add((idx + 10) % 12);
    });
    s.lastIndices = Array.from(adjSet).sort((a, b) => a - b);
    s.lastPrimaryIdx = playedIndices.values().next().value!;

    if (s.phase === 'idle' || s.phase === 'zooming-out') {
      // Start zooming in — snapshot current position as "from"
      const elapsed = frame - s.transitionFrame;
      const oldSpring = s.phase === 'zooming-out' ? ZOOM_OUT_SPRING : ZOOM_IN_SPRING;
      const oldProgress = spring({
        frame: elapsed, fps,
        config: oldSpring,
        durationInFrames: Math.round(fps * 2.5),
      });
      s.from = {
        x: s.from.x + (s.to.x - s.from.x) * oldProgress,
        y: s.from.y + (s.to.y - s.from.y) * oldProgress,
        w: s.from.w + (s.to.w - s.from.w) * oldProgress,
        h: s.from.h + (s.to.h - s.from.h) * oldProgress,
      };
      s.to = zoomTarget;
      s.transitionFrame = frame;
      s.phase = 'zoomed';
    } else if (s.phase === 'zoomed' || s.phase === 'lingering') {
      // Already zoomed — check if target moved (different note)
      const targetMoved =
        Math.abs(s.to.x - zoomTarget.x) > 1 ||
        Math.abs(s.to.y - zoomTarget.y) > 1;

      if (targetMoved) {
        // Pan to new node — snapshot current interpolated position
        const elapsed = frame - s.transitionFrame;
        const prog = spring({
          frame: elapsed, fps,
          config: ZOOM_IN_SPRING,
          durationInFrames: Math.round(fps * 2.5),
        });
        s.from = {
          x: s.from.x + (s.to.x - s.from.x) * prog,
          y: s.from.y + (s.to.y - s.from.y) * prog,
          w: s.from.w + (s.to.w - s.from.w) * prog,
          h: s.from.h + (s.to.h - s.from.h) * prog,
        };
        s.to = zoomTarget;
        s.transitionFrame = frame;
      }
      s.phase = 'zoomed';
    }

    s.releaseFrame = 0; // notes are held
  } else {
    // No notes held
    if (s.phase === 'zoomed') {
      // Just released — start lingering
      s.releaseFrame = frame;
      s.phase = 'lingering';
    } else if (s.phase === 'lingering') {
      // Check if linger expired
      if (frame - s.releaseFrame >= lingerFrames) {
        // Start slow zoom out
        const elapsed = frame - s.transitionFrame;
        const prog = spring({
          frame: elapsed, fps,
          config: ZOOM_IN_SPRING,
          durationInFrames: Math.round(fps * 2.5),
        });
        s.from = {
          x: s.from.x + (s.to.x - s.from.x) * prog,
          y: s.from.y + (s.to.y - s.from.y) * prog,
          w: s.from.w + (s.to.w - s.from.w) * prog,
          h: s.from.h + (s.to.h - s.from.h) * prog,
        };
        s.to = fullView;
        s.transitionFrame = frame;
        s.phase = 'zooming-out';
      }
    } else if (s.phase === 'zooming-out') {
      // Check if zoom-out spring is done
      const elapsed = frame - s.transitionFrame;
      const prog = spring({
        frame: elapsed, fps,
        config: ZOOM_OUT_SPRING,
        durationInFrames: Math.round(fps * 3),
      });
      if (prog >= 0.999) {
        s.phase = 'idle';
        s.from = fullView;
        s.to = fullView;
      }
    }
  }

  // ── Compute current viewBox from spring ────────────────────────────────

  const elapsed = frame - s.transitionFrame;
  const springConfig = s.phase === 'zooming-out' ? ZOOM_OUT_SPRING : ZOOM_IN_SPRING;
  const dur = s.phase === 'zooming-out' ? Math.round(fps * 3) : Math.round(fps * 2.5);
  const progress = spring({
    frame: elapsed,
    fps,
    config: springConfig,
    durationInFrames: dur,
  });

  const vx = interpolate(progress, [0, 1], [s.from.x, s.to.x]);
  const vy = interpolate(progress, [0, 1], [s.from.y, s.to.y]);
  const vw = interpolate(progress, [0, 1], [s.from.w, s.to.w]);
  const vh = interpolate(progress, [0, 1], [s.from.h, s.to.h]);

  // Zoom progress: 0 = full view, 1 = fully zoomed
  // Derived from how far the current viewBox width is from full vs zoomed
  const zoomedW = fullW * zoomFraction;
  const zoomProgress = 1 - Math.max(0, Math.min(1, (vw - zoomedW) / (fullW - zoomedW)));

  const isZoomed = s.phase === 'zoomed' || s.phase === 'lingering' ||
    (s.phase === 'zooming-out' && zoomProgress > 0.05);

  return {
    viewBox: `${vx} ${vy} ${vw} ${vh}`,
    isZoomed,
    adjacentIndices: s.lastIndices,
    primaryPlayedIdx: s.lastPrimaryIdx,
    zoomProgress,
  };
}
