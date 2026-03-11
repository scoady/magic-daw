// ── Tonnetz Grid Math ──────────────────────────────────────────────────────
//
// Axial coordinate system (q, r):
//   q = horizontal axis = perfect fifths (+7 semitones per step)
//   r = diagonal axis = minor thirds (+3 semitones per step)
//   Diagonal (q+1, r-1) = major thirds (+4 semitones)
//
// Every upward-pointing triangle = minor triad
// Every downward-pointing triangle = major triad

export interface AxialCoord {
  q: number;
  r: number;
}

export interface TonnetzTriangle {
  q: number;       // bottom-left vertex column
  r: number;       // bottom-left vertex row
  pointing: 'up' | 'down';
}

export type PLROp = 'P' | 'L' | 'R';

export interface ChordInfo {
  root: number;         // pitch class 0-11
  quality: 'major' | 'minor';
  name: string;         // e.g. "C", "Am", "F#m"
  pcs: [number, number, number];
}

export interface VoiceLeading {
  from: number;      // pitch class that moved
  to: number;        // pitch class it moved to
  semitones: number; // signed distance (+1 = up, -1 = down, etc.)
}

export interface PathStep {
  triangle: TonnetzTriangle;
  chord: ChordInfo;
  operation?: PLROp;
  voiceLeading?: VoiceLeading;
}

// ── Note names ────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function noteName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

// ── Pitch class at grid position ──────────────────────────────────────────

export function pitchClassAt(q: number, r: number): number {
  return (((q * 7) + (r * 3)) % 12 + 12) % 12;
}

// ── Triangle vertices and chord info ──────────────────────────────────────

export function triangleVertices(tri: TonnetzTriangle): [AxialCoord, AxialCoord, AxialCoord] {
  const { q, r, pointing } = tri;
  if (pointing === 'up') {
    return [{ q, r }, { q: q + 1, r }, { q, r: r + 1 }];
  } else {
    return [{ q, r }, { q: q + 1, r }, { q: q + 1, r: r - 1 }];
  }
}

export function triangleChord(tri: TonnetzTriangle): ChordInfo {
  const verts = triangleVertices(tri);
  const pcs = verts.map(v => pitchClassAt(v.q, v.r)) as [number, number, number];
  const root = pcs[0];
  const quality = tri.pointing === 'up' ? 'minor' : 'major';
  const name = noteName(root) + (quality === 'minor' ? 'm' : '');
  return { root, quality, name, pcs };
}

// ── Neo-Riemannian P/L/R operations ──────────────────────────────────────

export function applyPLR(tri: TonnetzTriangle, op: PLROp): TonnetzTriangle {
  const { q, r, pointing } = tri;
  if (pointing === 'down') {
    // Major triad
    switch (op) {
      case 'P': return { q, r, pointing: 'up' };
      case 'R': return { q, r: r - 1, pointing: 'up' };
      case 'L': return { q: q + 1, r: r - 1, pointing: 'up' };
    }
  } else {
    // Minor triad
    switch (op) {
      case 'P': return { q, r, pointing: 'down' };
      case 'R': return { q, r: r + 1, pointing: 'down' };
      case 'L': return { q: q - 1, r: r + 1, pointing: 'down' };
    }
  }
}

/** Get all 3 adjacent triangles with their P/L/R labels */
export function adjacentTriangles(tri: TonnetzTriangle): { op: PLROp; tri: TonnetzTriangle }[] {
  return (['P', 'L', 'R'] as PLROp[]).map(op => ({ op, tri: applyPLR(tri, op) }));
}

/** Compute voice leading between two adjacent triads */
export function computeVoiceLeading(from: TonnetzTriangle, to: TonnetzTriangle): VoiceLeading | null {
  const fromChord = triangleChord(from);
  const toChord = triangleChord(to);
  const fromSet = new Set(fromChord.pcs);
  const toSet = new Set(toChord.pcs);

  const moved = fromChord.pcs.find(pc => !toSet.has(pc));
  const arrived = toChord.pcs.find(pc => !fromSet.has(pc));
  if (moved === undefined || arrived === undefined) return null;

  // Compute signed semitone distance (shortest path)
  let diff = ((arrived - moved) % 12 + 12) % 12;
  if (diff > 6) diff -= 12;

  return { from: moved, to: arrived, semitones: diff };
}

/** Get the shared edge label between two triangles */
export function getSharedEdgeOp(from: TonnetzTriangle, to: TonnetzTriangle): PLROp | null {
  for (const op of ['P', 'L', 'R'] as PLROp[]) {
    const adj = applyPLR(from, op);
    if (adj.q === to.q && adj.r === to.r && adj.pointing === to.pointing) return op;
  }
  return null;
}

// ── Diatonic region ───────────────────────────────────────────────────────
// The 6 consonant triads (I, ii, iii, IV, V, vi) form a compact strip

export function diatonicTriangles(
  rootQ: number, rootR: number,
): TonnetzTriangle[] {
  return [
    // Major triads: IV, I, V
    { q: rootQ - 1, r: rootR, pointing: 'down' },
    { q: rootQ, r: rootR, pointing: 'down' },
    { q: rootQ + 1, r: rootR, pointing: 'down' },
    // Minor triads: ii, vi, iii
    { q: rootQ - 1, r: rootR - 1, pointing: 'up' },
    { q: rootQ, r: rootR - 1, pointing: 'up' },
    { q: rootQ + 1, r: rootR - 1, pointing: 'up' },
  ];
}

/** Get the set of pitch classes in a key's diatonic triads */
export function diatonicPitchClasses(rootQ: number, rootR: number): Set<number> {
  const tris = diatonicTriangles(rootQ, rootR);
  const pcs = new Set<number>();
  for (const tri of tris) {
    const chord = triangleChord(tri);
    chord.pcs.forEach(pc => pcs.add(pc));
  }
  return pcs;
}

// ── Triangle identity helpers ─────────────────────────────────────────────

export function triKey(tri: TonnetzTriangle): string {
  return `${tri.q},${tri.r},${tri.pointing}`;
}

export function triEquals(a: TonnetzTriangle, b: TonnetzTriangle): boolean {
  return a.q === b.q && a.r === b.r && a.pointing === b.pointing;
}

// ── Find triangle by chord name ───────────────────────────────────────────

/** Find the nearest triangle on the grid that matches a chord name */
export function findTriangleForChord(
  chordName: string,
  nearQ: number, nearR: number,
  gridQMin: number, gridQMax: number,
  gridRMin: number, gridRMax: number,
): TonnetzTriangle | null {
  const isMinor = chordName.endsWith('m') && !chordName.endsWith('dim');
  const pointing = isMinor ? 'up' as const : 'down' as const;

  let best: TonnetzTriangle | null = null;
  let bestDist = Infinity;

  for (let q = gridQMin; q <= gridQMax; q++) {
    for (let r = gridRMin; r <= gridRMax; r++) {
      const tri: TonnetzTriangle = { q, r, pointing };
      const chord = triangleChord(tri);
      if (chord.name === chordName) {
        const dist = Math.abs(q - nearQ) + Math.abs(r - nearR);
        if (dist < bestDist) {
          bestDist = dist;
          best = tri;
        }
      }
    }
  }
  return best;
}
