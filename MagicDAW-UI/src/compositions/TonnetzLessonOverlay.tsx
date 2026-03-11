import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { LessonStep } from '../lib/tonnetzLessons';
import type { TonnetzTriangle } from '../lib/tonnetz';
import { triangleChord, noteName } from '../lib/tonnetz';
import { triangleCentroid, axialToPixel, HEX_SIZE } from '../lib/tonnetzLayout';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LessonOverlayProps {
  /** Current lesson step data */
  step: LessonStep | null;
  /** Step index (for animation sequencing) */
  stepIndex: number;
  /** Frame when this step started */
  stepStartFrame: number;
  /** Total steps in lesson */
  totalSteps: number;
  /** Lesson accent color */
  accentColor: string;
  /** Lesson title (shown in corner) */
  lessonTitle: string;
  /** Whether lesson is active */
  isActive: boolean;
  /** Grid transform params (to convert grid coords to screen) */
  gridTransform: { tx: number; ty: number; scale: number };
  /** Previous step's highlights (for trail drawing) */
  prevHighlights: TonnetzTriangle[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hex2rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Convert grid-space centroid to screen-space coordinates */
function gridToScreen(
  tri: TonnetzTriangle,
  gt: { tx: number; ty: number; scale: number },
): { x: number; y: number } {
  const c = triangleCentroid(tri, 0, 0);
  return {
    x: gt.tx + c.x * gt.scale,
    y: gt.ty + c.y * gt.scale,
  };
}

/** Convert grid node to screen coords */
function nodeToScreen(
  q: number, r: number,
  gt: { tx: number; ty: number; scale: number },
): { x: number; y: number } {
  const p = axialToPixel(q, r, 0, 0);
  return {
    x: gt.tx + p.x * gt.scale,
    y: gt.ty + p.y * gt.scale,
  };
}

// ── Seeded random for consistent procedural effects ─────────────────────

function sr(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ── Component ──────────────────────────────────────────────────────────────

export const TonnetzLessonOverlay: React.FC<LessonOverlayProps> = ({
  step,
  stepIndex,
  stepStartFrame,
  totalSteps,
  accentColor,
  lessonTitle,
  isActive,
  gridTransform: gt,
  prevHighlights,
}) => {
  const frame = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();

  if (!isActive || !step) return null;

  const age = frame - stepStartFrame;

  // ── Entrance animations ────────────────────────────────────────────────

  const fadeIn = spring({
    frame: age,
    fps,
    config: { damping: 25, stiffness: 40, mass: 1.2 },
  });

  const textReveal = spring({
    frame: Math.max(0, age - 5),
    fps,
    config: { damping: 20, stiffness: 50, mass: 0.8 },
  });

  const spotlightReveal = spring({
    frame: Math.max(0, age - 2),
    fps,
    config: { damping: 15, stiffness: 35, mass: 1 },
  });

  // ── Screen-space positions of highlighted triangles ────────────────────

  const highlightPositions = useMemo(() => {
    return step.highlights.map(tri => gridToScreen(tri, gt));
  }, [step.highlights, gt]);

  const prevPositions = useMemo(() => {
    return prevHighlights.map(tri => gridToScreen(tri, gt));
  }, [prevHighlights, gt]);

  // Spotlight center (average of all highlights, or screen center)
  const spotCenter = useMemo(() => {
    if (highlightPositions.length === 0) return { x: W / 2, y: H / 2 };
    const sx = highlightPositions.reduce((a, p) => a + p.x, 0) / highlightPositions.length;
    const sy = highlightPositions.reduce((a, p) => a + p.y, 0) / highlightPositions.length;
    return { x: sx, y: sy };
  }, [highlightPositions, W, H]);

  // ── Cinematic letterbox bars ──────────────────────────────────────────

  const letterboxH = 3;
  const hasText = step.title || step.body;

  // ── Narration panel position ──────────────────────────────────────────
  // Place the narration panel on the opposite side of the screen from the spotlight
  const narrateOnLeft = spotCenter.x > W / 2;
  const narrateX = narrateOnLeft ? 30 : W - 380;
  const narrateY = H - 160;
  const narrateW = 350;

  // ── Annotation positions ──────────────────────────────────────────────
  const annotationPos = useMemo(() => {
    if (!step.annotation) return null;
    return gridToScreen(step.annotation.tri, gt);
  }, [step.annotation, gt]);

  const multiAnnotations = useMemo(() => {
    if (!step.annotations) return [];
    return step.annotations.map(a => ({
      ...a,
      pos: gridToScreen(a.tri, gt),
    }));
  }, [step.annotations, gt]);

  return (
    <g>
      {/* ══════ CINEMATIC LETTERBOX ══════ */}
      <rect x={0} y={0} width={W} height={letterboxH}
        fill="#0a0e1a" opacity={fadeIn * 0.7} />
      <rect x={0} y={H - letterboxH} width={W} height={letterboxH}
        fill="#0a0e1a" opacity={fadeIn * 0.7} />

      {/* ══════ VIGNETTE OVERLAY ══════ */}
      <defs>
        <radialGradient id={`tn-lesson-vignette-${stepIndex}`}
          cx={spotCenter.x / W} cy={spotCenter.y / H} r="0.7">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="60%" stopColor="transparent" />
          <stop offset="100%" stopColor="rgba(10,14,26,0.5)" />
        </radialGradient>
        <filter id={`tn-lesson-glow-${stepIndex}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="20" result="g1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="g2" />
          <feMerge>
            <feMergeNode in="g1" />
            <feMergeNode in="g2" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`tn-lesson-text-glow-${stepIndex}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      <rect x={0} y={0} width={W} height={H}
        fill={`url(#tn-lesson-vignette-${stepIndex})`}
        opacity={fadeIn * 0.4}
        pointerEvents="none" />

      {/* ══════ SPOTLIGHT BEAMS ══════ */}

      {highlightPositions.map((pos, i) => {
        const delay = i * 4;
        const beamReveal = spring({
          frame: Math.max(0, age - delay - 3),
          fps,
          config: { damping: 18, stiffness: 30, mass: 1.2 },
        });

        const beamRadius = HEX_SIZE * gt.scale * 0.8;
        const pulseR = beamRadius * (1 + 0.05 * Math.sin(frame * 0.08 + i));
        const chord = triangleChord(step.highlights[i]);
        const chordColor = accentColor;

        return (
          <g key={`spot-${i}`} opacity={beamReveal}>
            {/* Outer glow ring */}
            <circle cx={pos.x} cy={pos.y} r={pulseR * 1.8}
              fill="none"
              stroke={hex2rgba(chordColor, 0.06)}
              strokeWidth={pulseR * 0.5}
              filter={`url(#tn-lesson-glow-${stepIndex})`}
            />

            {/* Pulsing spotlight ring */}
            <circle cx={pos.x} cy={pos.y} r={pulseR}
              fill="none"
              stroke={hex2rgba(chordColor, 0.25 * beamReveal)}
              strokeWidth={2}
              strokeDasharray={`${pulseR * 0.3} ${pulseR * 0.15}`}
              strokeDashoffset={frame * 0.5}
            />

            {/* Inner spotlight */}
            <circle cx={pos.x} cy={pos.y} r={pulseR * 0.4}
              fill={hex2rgba(chordColor, 0.04 * beamReveal)}
            />

            {/* Crosshair lines */}
            <line x1={pos.x - pulseR * 0.15} y1={pos.y}
              x2={pos.x - pulseR * 0.5} y2={pos.y}
              stroke={hex2rgba(chordColor, 0.15)} strokeWidth={0.5} />
            <line x1={pos.x + pulseR * 0.15} y1={pos.y}
              x2={pos.x + pulseR * 0.5} y2={pos.y}
              stroke={hex2rgba(chordColor, 0.15)} strokeWidth={0.5} />
            <line x1={pos.x} y1={pos.y - pulseR * 0.15}
              x2={pos.x} y2={pos.y - pulseR * 0.5}
              stroke={hex2rgba(chordColor, 0.15)} strokeWidth={0.5} />
            <line x1={pos.x} y1={pos.y + pulseR * 0.15}
              x2={pos.x} y2={pos.y + pulseR * 0.5}
              stroke={hex2rgba(chordColor, 0.15)} strokeWidth={0.5} />

            {/* Chord label beneath spotlight */}
            {step.highlights.length <= 4 && (
              <text x={pos.x} y={pos.y + pulseR + 16}
                textAnchor="middle" dominantBaseline="hanging"
                fontFamily="'SF Pro Display', 'Georgia', serif"
                fontSize={13} fontWeight={600}
                fill={chordColor}
                opacity={beamReveal * 0.7}>
                {chord.name}
              </text>
            )}
          </g>
        );
      })}

      {/* ══════ GLOWING TRAIL between steps ══════ */}

      {step.showTrail && prevPositions.length > 0 && highlightPositions.length > 0 && (() => {
        // Trail from last prev highlight to first current highlight
        const from = prevPositions[prevPositions.length - 1];
        const to = highlightPositions[highlightPositions.length - 1];

        const trailProgress = spring({
          frame: Math.max(0, age - 2),
          fps,
          config: { damping: 12, stiffness: 40, mass: 0.8 },
        });

        const currentX = from.x + (to.x - from.x) * trailProgress;
        const currentY = from.y + (to.y - from.y) * trailProgress;

        // Particle count along trail
        const particles = Array.from({ length: 8 }, (_, i) => {
          const t = i / 7;
          if (t > trailProgress) return null;
          const px = from.x + (to.x - from.x) * t;
          const py = from.y + (to.y - from.y) * t;
          const fade = interpolate(t, [trailProgress - 0.3, trailProgress], [0.6, 0.1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <circle key={`tp-${i}`}
              cx={px} cy={py}
              r={1.5 + sr(i * 7.3) * 1.5}
              fill={accentColor}
              opacity={fade}
              filter={`url(#tn-lesson-text-glow-${stepIndex})`}
            />
          );
        });

        return (
          <g>
            {/* Trail glow line */}
            <line x1={from.x} y1={from.y} x2={currentX} y2={currentY}
              stroke={accentColor}
              strokeWidth={3}
              opacity={0.15}
              filter={`url(#tn-lesson-glow-${stepIndex})`}
              strokeLinecap="round"
            />
            {/* Trail core line */}
            <line x1={from.x} y1={from.y} x2={currentX} y2={currentY}
              stroke={accentColor}
              strokeWidth={1.5}
              opacity={0.5 * trailProgress}
              strokeLinecap="round"
            />
            {/* Trail particles */}
            {particles}
            {/* Leading particle */}
            <circle cx={currentX} cy={currentY}
              r={4}
              fill={accentColor}
              opacity={0.6 * trailProgress}
              filter={`url(#tn-lesson-text-glow-${stepIndex})`}
            />
          </g>
        );
      })()}

      {/* ══════ PLR OPERATION BADGE ══════ */}

      {step.operation && highlightPositions.length > 0 && prevPositions.length > 0 && (() => {
        const from = prevPositions[prevPositions.length - 1];
        const to = highlightPositions[highlightPositions.length - 1];
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        // Offset perpendicular
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const offX = -dy / len * 24;
        const offY = dx / len * 24;

        const badgeReveal = spring({
          frame: Math.max(0, age - 10),
          fps,
          config: { damping: 15, stiffness: 60, mass: 0.6 },
        });

        return (
          <g opacity={badgeReveal}>
            {/* Badge background */}
            <rect x={midX + offX - 16} y={midY + offY - 12}
              width={32} height={24} rx={6}
              fill="rgba(4,8,16,0.9)"
              stroke={accentColor}
              strokeWidth={1}
              opacity={0.8}
            />
            {/* Operation letter */}
            <text x={midX + offX} y={midY + offY + 1}
              textAnchor="middle" dominantBaseline="central"
              fontFamily="'SF Pro Display', 'Georgia', serif"
              fontSize={14} fontWeight={800}
              fill={accentColor}>
              {step.operation}
            </text>
          </g>
        );
      })()}

      {/* ══════ ANNOTATION CALLOUT ══════ */}

      {step.annotation && annotationPos && (() => {
        const annReveal = spring({
          frame: Math.max(0, age - 12),
          fps,
          config: { damping: 18, stiffness: 45, mass: 0.7 },
        });

        const annX = annotationPos.x + 30;
        const annY = annotationPos.y - 20;

        return (
          <g opacity={annReveal}>
            {/* Connector line */}
            <line x1={annotationPos.x + 8} y1={annotationPos.y - 8}
              x2={annX} y2={annY}
              stroke={accentColor} strokeWidth={0.5} opacity={0.4}
              strokeDasharray="3 3"
            />
            {/* Annotation pill */}
            <rect x={annX - 4} y={annY - 10}
              width={step.annotation.text.length * 7 + 16} height={20}
              rx={4}
              fill="rgba(4,8,16,0.85)"
              stroke={hex2rgba(accentColor, 0.3)}
              strokeWidth={0.5}
            />
            <text x={annX + 4} y={annY + 1}
              fontFamily="'SF Mono', 'Fira Code', monospace"
              fontSize={10} fontWeight={600}
              fill={accentColor} opacity={0.85}
              dominantBaseline="central">
              {step.annotation.text}
            </text>
          </g>
        );
      })()}

      {/* ══════ MULTI-ANNOTATIONS ══════ */}

      {multiAnnotations.map((ann, i) => {
        const annReveal = spring({
          frame: Math.max(0, age - 8 - i * 4),
          fps,
          config: { damping: 18, stiffness: 45, mass: 0.7 },
        });

        // Offset below the triangle centroid
        const ax = ann.pos.x;
        const ay = ann.pos.y + HEX_SIZE * gt.scale * 0.55;
        const textW = ann.text.length * 7 + 16;

        return (
          <g key={`ma-${i}`} opacity={annReveal}>
            {/* Connector line */}
            <line x1={ann.pos.x} y1={ann.pos.y + 6}
              x2={ax} y2={ay - 10}
              stroke={accentColor} strokeWidth={0.5} opacity={0.3}
              strokeDasharray="2 3"
            />
            {/* Annotation pill */}
            <rect x={ax - textW / 2} y={ay - 10}
              width={textW} height={20}
              rx={4}
              fill="rgba(4,8,16,0.85)"
              stroke={hex2rgba(accentColor, 0.3)}
              strokeWidth={0.5}
            />
            <text x={ax} y={ay + 1}
              textAnchor="middle"
              fontFamily="'SF Mono', 'Fira Code', monospace"
              fontSize={10} fontWeight={600}
              fill={accentColor} opacity={0.85}
              dominantBaseline="central">
              {ann.text}
            </text>
          </g>
        );
      })}

      {/* ══════ NARRATION PANEL ══════ */}

      {hasText && (() => {
        const panelSlideY = interpolate(textReveal, [0, 1], [20, 0]);
        const panelOpacity = textReveal;

        return (
          <g transform={`translate(0, ${panelSlideY.toFixed(1)})`} opacity={panelOpacity}>
            {/* Frosted glass panel */}
            <rect x={narrateX} y={narrateY}
              width={narrateW} height={step.body ? 100 : 50}
              rx={10}
              fill="rgba(4,8,16,0.75)"
              stroke={hex2rgba(accentColor, 0.12)}
              strokeWidth={0.5}
            />

            {/* Accent line on left edge */}
            <rect x={narrateX} y={narrateY}
              width={3} height={step.body ? 100 : 50}
              rx={1.5}
              fill={accentColor}
              opacity={0.6}
            />

            {/* Step counter */}
            <text x={narrateX + 16} y={narrateY + 18}
              fontFamily="'SF Mono', 'Fira Code', monospace"
              fontSize={9} fontWeight={500}
              fill={accentColor} opacity={0.5}>
              {String(stepIndex + 1).padStart(2, '0')} / {String(totalSteps).padStart(2, '0')}
            </text>

            {/* Title */}
            {step.title && (
              <text x={narrateX + 16} y={narrateY + 38}
                fontFamily="'SF Pro Display', 'Georgia', serif"
                fontSize={16} fontWeight={700}
                fill="#e2e8f0">
                {step.title}
              </text>
            )}

            {/* Body — word-wrapped manually */}
            {step.body && (() => {
              const words = step.body.split(' ');
              const lines: string[] = [];
              let currentLine = '';
              const maxCharsPerLine = 48;

              for (const word of words) {
                if ((currentLine + ' ' + word).length > maxCharsPerLine && currentLine) {
                  lines.push(currentLine);
                  currentLine = word;
                } else {
                  currentLine = currentLine ? currentLine + ' ' + word : word;
                }
              }
              if (currentLine) lines.push(currentLine);

              return lines.slice(0, 4).map((line, i) => (
                <text key={i}
                  x={narrateX + 16}
                  y={narrateY + (step.title ? 56 : 36) + i * 15}
                  fontFamily="'SF Pro Text', 'Helvetica Neue', sans-serif"
                  fontSize={11} fontWeight={400}
                  fill="#94a3b8" opacity={0.8}>
                  {line}
                </text>
              ));
            })()}
          </g>
        );
      })()}

      {/* ══════ PROGRESS DOTS ══════ */}

      {(() => {
        const dotY = H - 20;
        const dotSpacing = 10;
        const totalWidth = totalSteps * dotSpacing;
        const dotStartX = W / 2 - totalWidth / 2;

        return (
          <g opacity={fadeIn * 0.6}>
            {Array.from({ length: totalSteps }, (_, i) => {
              const isCurrent = i === stepIndex;
              const isPast = i < stepIndex;
              return (
                <circle key={`dot-${i}`}
                  cx={dotStartX + i * dotSpacing}
                  cy={dotY}
                  r={isCurrent ? 3 : 2}
                  fill={isCurrent ? accentColor : isPast ? hex2rgba(accentColor, 0.4) : 'rgba(148,163,184,0.2)'}
                  filter={isCurrent ? `url(#tn-lesson-text-glow-${stepIndex})` : undefined}
                />
              );
            })}
          </g>
        );
      })()}

      {/* ══════ LESSON TITLE WATERMARK ══════ */}

      <text x={W - 16} y={28}
        textAnchor="end"
        fontFamily="'SF Pro Display', 'Georgia', serif"
        fontSize={10} fontWeight={600} letterSpacing={2}
        fill={accentColor} opacity={fadeIn * 0.2}
        textDecoration="uppercase">
        {lessonTitle.toUpperCase()}
      </text>
    </g>
  );
};

export default TonnetzLessonOverlay;
