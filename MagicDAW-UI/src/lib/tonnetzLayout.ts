// ── Tonnetz Layout: Grid ↔ Pixel coordinate mapping ──────────────────────
//
// Converts axial (q, r) grid coordinates to SVG pixel positions
// and provides hit-testing from pixel clicks back to triangles.

import type { AxialCoord, TonnetzTriangle } from './tonnetz';
import { triangleVertices, pitchClassAt } from './tonnetz';

// ── Grid configuration ────────────────────────────────────────────────────

export const HEX_SIZE = 80; // distance between adjacent nodes in pixels
export const GRID_Q_MIN = -4;
export const GRID_Q_MAX = 10;
export const GRID_R_MIN = -3;
export const GRID_R_MAX = 4;

// ── Coordinate conversion ─────────────────────────────────────────────────

/** Axial (q, r) → SVG pixel (x, y), centered at (cx, cy) */
export function axialToPixel(q: number, r: number, cx: number, cy: number): { x: number; y: number } {
  const x = cx + HEX_SIZE * (q + r * 0.5);
  const y = cy - HEX_SIZE * (r * (Math.sqrt(3) / 2)); // negate for SVG y-down
  return { x, y };
}

/** SVG pixel → fractional axial coordinates */
export function pixelToAxial(px: number, py: number, cx: number, cy: number): { q: number; r: number } {
  const relX = px - cx;
  const relY = -(py - cy); // un-negate SVG y
  const r = relY / (HEX_SIZE * Math.sqrt(3) / 2);
  const q = relX / HEX_SIZE - r * 0.5;
  return { q, r };
}

/** Hit-test: pixel → nearest triangle */
export function pixelToTriangle(px: number, py: number, cx: number, cy: number): TonnetzTriangle {
  const { q: qf, r: rf } = pixelToAxial(px, py, cx, cy);
  const qFloor = Math.floor(qf);
  const rFloor = Math.floor(rf);
  const qFrac = qf - qFloor;
  const rFrac = rf - rFloor;

  if (qFrac + rFrac < 1) {
    return { q: qFloor, r: rFloor, pointing: 'up' };
  } else {
    return { q: qFloor, r: rFloor, pointing: 'down' };
  }
}

// ── Triangle geometry ─────────────────────────────────────────────────────

/** Get SVG pixel positions of a triangle's 3 vertices */
export function trianglePixelVertices(
  tri: TonnetzTriangle, cx: number, cy: number,
): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] {
  const verts = triangleVertices(tri);
  return verts.map(v => axialToPixel(v.q, v.r, cx, cy)) as any;
}

/** SVG path for a triangle */
export function triangleSVGPath(tri: TonnetzTriangle, cx: number, cy: number): string {
  const [a, b, c] = trianglePixelVertices(tri, cx, cy);
  return `M ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y} Z`;
}

/** Centroid of a triangle in pixel space */
export function triangleCentroid(tri: TonnetzTriangle, cx: number, cy: number): { x: number; y: number } {
  const [a, b, c] = trianglePixelVertices(tri, cx, cy);
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}

/** Midpoint of the shared edge between two adjacent triangles */
export function sharedEdgeMidpoint(
  t1: TonnetzTriangle, t2: TonnetzTriangle, cx: number, cy: number,
): { x: number; y: number } | null {
  const v1 = triangleVertices(t1);
  const v2 = triangleVertices(t2);

  // Find 2 shared vertices
  const shared: AxialCoord[] = [];
  for (const a of v1) {
    for (const b of v2) {
      if (a.q === b.q && a.r === b.r) shared.push(a);
    }
  }
  if (shared.length < 2) return null;

  const p1 = axialToPixel(shared[0].q, shared[0].r, cx, cy);
  const p2 = axialToPixel(shared[1].q, shared[1].r, cx, cy);
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

// ── Grid enumeration ──────────────────────────────────────────────────────

export interface GridNode {
  q: number;
  r: number;
  pc: number;
  x: number;
  y: number;
}

/** Generate all visible grid nodes */
export function enumerateNodes(cx: number, cy: number): GridNode[] {
  const nodes: GridNode[] = [];
  for (let q = GRID_Q_MIN; q <= GRID_Q_MAX; q++) {
    for (let r = GRID_R_MIN; r <= GRID_R_MAX; r++) {
      const { x, y } = axialToPixel(q, r, cx, cy);
      nodes.push({ q, r, pc: pitchClassAt(q, r), x, y });
    }
  }
  return nodes;
}

/** Generate all visible triangles */
export function enumerateTriangles(cx: number, cy: number): {
  tri: TonnetzTriangle;
  path: string;
  centroid: { x: number; y: number };
}[] {
  const result: { tri: TonnetzTriangle; path: string; centroid: { x: number; y: number } }[] = [];

  for (let q = GRID_Q_MIN; q < GRID_Q_MAX; q++) {
    for (let r = GRID_R_MIN; r < GRID_R_MAX; r++) {
      // Upward triangle
      const up: TonnetzTriangle = { q, r, pointing: 'up' };
      result.push({
        tri: up,
        path: triangleSVGPath(up, cx, cy),
        centroid: triangleCentroid(up, cx, cy),
      });
    }
    for (let r = GRID_R_MIN + 1; r <= GRID_R_MAX; r++) {
      // Downward triangle
      const down: TonnetzTriangle = { q, r, pointing: 'down' };
      result.push({
        tri: down,
        path: triangleSVGPath(down, cx, cy),
        centroid: triangleCentroid(down, cx, cy),
      });
    }
  }
  return result;
}

/** Compute the grid distance (manhattan-like) between two axial coords */
export function gridDistance(a: AxialCoord, b: AxialCoord): number {
  const dq = Math.abs(a.q - b.q);
  const dr = Math.abs(a.r - b.r);
  const ds = Math.abs((a.q + a.r) - (b.q + b.r));
  return Math.max(dq, dr, ds);
}
