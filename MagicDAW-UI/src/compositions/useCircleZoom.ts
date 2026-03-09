import { useRef } from 'react';
import { spring } from 'remotion';

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
  // Strip slash bass note (e.g. "Am/C" → "Am", "G/B" → "G")
  const chordName = chord.includes('/') ? chord.split('/')[0] : chord;
  const base = chordName.replace(/(maj7|m7|7|9|11|13|sus[24]|aug|\?)$/i, '');

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

/** Safe spring — clamps to [0,1] and catches errors from Remotion */
function safeSpring(f: number, fps: number, config: typeof ZOOM_IN_SPRING, dur: number): number {
  try {
    const v = spring({ frame: Math.max(0, f), fps, config, durationInFrames: dur });
    return Math.max(0, Math.min(1, v));
  } catch {
    return f >= dur ? 1 : 0;
  }
}

/** Lerp a ZoomTarget */
function lerpTarget(from: ZoomTarget, to: ZoomTarget, t: number): ZoomTarget {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    w: from.w + (to.w - from.w) * t,
    h: from.h + (to.h - from.h) * t,
  };
}

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
  /** Detected chord ring info — when present, zoom targets this instead of individual notes */
  detectedRing?: DetectedRing;
  cx: number;
  cy: number;
  outerR: number;
  middleR?: number;
  innerR?: number;
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
    detectedRing: dRing,
    cx, cy, outerR,
    middleR = outerR * 0.75,
    innerR = outerR * 0.5,
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

  // Guard: reset transitionFrame on Remotion loop boundary (frame < stored frame)
  if (frame < s.transitionFrame) {
    s.transitionFrame = frame;
  }
  if (s.releaseFrame > 0 && frame < s.releaseFrame) {
    s.releaseFrame = frame;
  }

  // ── State machine ─────────────────────────────────────────────────────

  if (notesActive) {
    // When a chord is detected, zoom to the chord's ring position
    // instead of the centroid of individual notes on the major ring
    let zoomTarget: ZoomTarget;
    let primaryIdx: number;

    if (dRing && dRing.ring && dRing.index >= 0) {
      // Chord detected — zoom to the chord's position on its ring
      const ringR = dRing.ring === 'major' ? outerR
        : dRing.ring === 'minor' ? middleR : innerR;
      const chordSet = new Set([dRing.index]);
      zoomTarget = computeZoomWindow(
        chordSet, cx, cy, ringR, fullW, fullH, zoomFraction,
      );
      primaryIdx = dRing.index;
    } else {
      // No chord — use individual note positions
      zoomTarget = computeZoomWindow(
        playedIndices, cx, cy, outerR, fullW, fullH, zoomFraction,
      );
      primaryIdx = playedIndices.values().next().value!;
    }

    // Update persisted played info — all harmonically reachable targets
    const adjSet = new Set<number>();
    const focusIdx = primaryIdx;
    adjSet.add(focusIdx);           // self (played)
    adjSet.add((focusIdx + 1) % 12);  // V (dominant)
    adjSet.add((focusIdx + 11) % 12); // IV (subdominant)
    adjSet.add((focusIdx + 2) % 12);  // ii (supertonic)
    adjSet.add((focusIdx + 10) % 12); // bVII (subtonic)
    adjSet.add((focusIdx + 3) % 12);  // vi / iii (mediant area)
    adjSet.add((focusIdx + 9) % 12);  // bVI (submediant)
    adjSet.add((focusIdx + 4) % 12);  // iii (mediant)
    adjSet.add((focusIdx + 8) % 12);  // bV / tritone sub
    adjSet.add((focusIdx + 5) % 12);  // vii° area
    adjSet.add((focusIdx + 7) % 12);  // bIII (chromatic mediant)
    s.lastIndices = Array.from(adjSet).sort((a, b) => a - b);
    s.lastPrimaryIdx = primaryIdx;

    if (s.phase === 'idle' || s.phase === 'zooming-out') {
      // Start zooming in — snapshot current position as "from"
      const el = Math.max(0, frame - s.transitionFrame);
      const oldCfg = s.phase === 'zooming-out' ? ZOOM_OUT_SPRING : ZOOM_IN_SPRING;
      const oldP = safeSpring(el, fps, oldCfg, Math.round(fps * 2.5));
      s.from = lerpTarget(s.from, s.to, oldP);
      s.to = zoomTarget;
      s.transitionFrame = frame;
      s.phase = 'zoomed';
    } else if (s.phase === 'zoomed' || s.phase === 'lingering') {
      // Already zoomed — check if target moved (different note)
      const targetMoved =
        Math.abs(s.to.x - zoomTarget.x) > 1 ||
        Math.abs(s.to.y - zoomTarget.y) > 1;

      if (targetMoved) {
        const el = Math.max(0, frame - s.transitionFrame);
        const prog = safeSpring(el, fps, ZOOM_IN_SPRING, Math.round(fps * 2.5));
        s.from = lerpTarget(s.from, s.to, prog);
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
        const el = Math.max(0, frame - s.transitionFrame);
        const prog = safeSpring(el, fps, ZOOM_IN_SPRING, Math.round(fps * 2.5));
        s.from = lerpTarget(s.from, s.to, prog);
        s.to = fullView;
        s.transitionFrame = frame;
        s.phase = 'zooming-out';
      }
    } else if (s.phase === 'zooming-out') {
      // Check if zoom-out spring is done
      const el = Math.max(0, frame - s.transitionFrame);
      const prog = safeSpring(el, fps, ZOOM_OUT_SPRING, Math.round(fps * 3));
      if (prog >= 0.999) {
        s.phase = 'idle';
        s.from = fullView;
        s.to = fullView;
      }
    }
  }

  // ── Compute current viewBox from spring ────────────────────────────────

  // Guard against negative elapsed (Remotion loop: frame resets to 0 while transitionFrame is high)
  const rawElapsed = frame - s.transitionFrame;
  const elapsed = rawElapsed >= 0 ? rawElapsed : 0;
  const springConfig = s.phase === 'zooming-out' ? ZOOM_OUT_SPRING : ZOOM_IN_SPRING;
  const dur = s.phase === 'zooming-out' ? Math.round(fps * 3) : Math.round(fps * 2.5);
  const p = safeSpring(elapsed, fps, springConfig, dur);
  const view = lerpTarget(s.from, s.to, p);

  // Zoom progress: 0 = full view, 1 = fully zoomed
  const zoomedW = fullW * zoomFraction;
  const denom = fullW - zoomedW;
  const zoomProgress = denom > 0
    ? 1 - Math.max(0, Math.min(1, (view.w - zoomedW) / denom))
    : 0;

  const isZoomed = s.phase === 'zoomed' || s.phase === 'lingering' ||
    (s.phase === 'zooming-out' && zoomProgress > 0.05);

  return {
    viewBox: `${view.x} ${view.y} ${Math.max(1, view.w)} ${Math.max(1, view.h)}`,
    isZoomed,
    adjacentIndices: s.lastIndices,
    primaryPlayedIdx: s.lastPrimaryIdx,
    zoomProgress,
  };
}
