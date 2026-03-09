import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from 'remotion';

// ── Types ──────────────────────────────────────────────────────────────────

export interface NoteParticle {
  note: number;
  velocity: number;
  timestamp: number;
  /** 'root' | 'third' | 'fifth' | 'seventh' | 'other' */
  role: string;
}

export interface ChordVisualizerProps {
  currentChord: string;
  previousChord: string;
  chordQuality: string;
  detectedKey: string;
  keyMode: string; // 'major' | 'minor' | ''
  keyConfidence: number;
  progression: string[];
  suggestions: Array<{ chord: string; probability: number }>;
  activeNotes: NoteParticle[];
  /** Monotonic counter that increments each chord change — drives spring triggers */
  chordChangeId: number;
  /** Harmonic tension 0-1 */
  tension: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const W = 1920;
const H = 800;

const aurora = {
  bg: '#0d1520',
  teal: '#2dd4bf',
  green: '#34d399',
  cyan: '#67e8f9',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  glass: 'rgba(120,200,220,0.06)',
  glassBorder: 'rgba(120,200,220,0.12)',
};

const CIRCLE_NOTES = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const ENHARMONIC: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'Gb': 'F#',
  'Cb': 'B', 'Fb': 'E', 'B#': 'C', 'E#': 'F',
};

function normalizeNote(n: string): string {
  return ENHARMONIC[n] ?? n;
}

function extractRoot(chord: string): string {
  if (!chord) return '';
  const m = chord.match(/^([A-G][#b]?)/);
  return m ? normalizeNote(m[1]) : '';
}

function noteIndexOnCircle(note: string): number {
  const norm = normalizeNote(note);
  const idx = CIRCLE_NOTES.indexOf(norm);
  return idx >= 0 ? idx : -1;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── Role colors ────────────────────────────────────────────────────────────

function roleColor(role: string): string {
  switch (role) {
    case 'root': return aurora.cyan;
    case 'third': return aurora.teal;
    case 'fifth': return aurora.purple;
    case 'seventh': return aurora.pink;
    default: return aurora.gold;
  }
}

// ── Background stars (static, seeded) ──────────────────────────────────────

interface BgStar { x: number; y: number; r: number; opacity: number; twinklePhase: number }

function generateBgStars(count: number): BgStar[] {
  const rand = seededRandom(42);
  const stars: BgStar[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rand() * W,
      y: rand() * H,
      r: 0.3 + rand() * 1.5,
      opacity: 0.15 + rand() * 0.5,
      twinklePhase: rand() * Math.PI * 2,
    });
  }
  return stars;
}

// ── Component ──────────────────────────────────────────────────────────────

export const ChordVisualizer: React.FC<ChordVisualizerProps> = ({
  currentChord,
  previousChord,
  chordQuality,
  detectedKey,
  keyMode,
  keyConfidence,
  progression,
  suggestions,
  activeNotes,
  chordChangeId,
  tension,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bgStars = useMemo(() => generateBgStars(180), []);

  // Derive chord change animation. The spring is keyed on chordChangeId
  // so transitions reset every chord change. We use frame % (fps*10) as a base.
  const chordEntrance = spring({
    frame: frame % (fps * 10),
    fps,
    config: { damping: 14, stiffness: 80, mass: 0.8 },
    durationInFrames: fps * 2,
  });

  // Glow pulse — cycles continuously
  const glowPulse = Math.sin(frame * 0.08) * 0.3 + 0.7;

  // Circle rotation (very slow)
  const circleRotation = frame * 0.15;

  // Aurora phase
  const auroraPhase = frame * 0.02;

  const isMinor = keyMode === 'minor' || detectedKey.toLowerCase().includes('m');

  // Current root index on circle
  const currentRoot = extractRoot(currentChord);
  const currentIdx = noteIndexOnCircle(currentRoot);

  // Key root on circle
  const keyRoot = extractRoot(detectedKey);
  const keyIdx = noteIndexOnCircle(keyRoot);

  // Tension interpolation for visual effects
  const tensionIntensity = Math.max(0, Math.min(1, tension));
  const tensionColor = interpolate(tensionIntensity, [0, 0.5, 1], [0, 0.5, 1]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent', overflow: 'hidden' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          {/* Glow filters */}
          <filter id="cv-glow-soft" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="cv-glow-strong" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="cv-glow-mega" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="24" result="blur1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur2" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="cv-glow-particle" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>

          {/* Aurora gradient — shifts with key mode */}
          <radialGradient id="cv-aurora-warm" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor={aurora.cyan} stopOpacity={0.12 + Math.sin(auroraPhase) * 0.05} />
            <stop offset="40%" stopColor={aurora.teal} stopOpacity={0.08} />
            <stop offset="70%" stopColor={aurora.green} stopOpacity={0.04} />
            <stop offset="100%" stopColor="transparent" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="cv-aurora-cool" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor={aurora.purple} stopOpacity={0.12 + Math.sin(auroraPhase) * 0.05} />
            <stop offset="40%" stopColor={aurora.pink} stopOpacity={0.08} />
            <stop offset="70%" stopColor={aurora.purple} stopOpacity={0.04} />
            <stop offset="100%" stopColor="transparent" stopOpacity={0} />
          </radialGradient>

          {/* Glass card gradient */}
          <linearGradient id="cv-glass-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(120,200,220,0.12)" />
            <stop offset="100%" stopColor="rgba(120,200,220,0.03)" />
          </linearGradient>

          {/* Tension radial */}
          <radialGradient id="cv-tension-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"
              stopColor={tensionColor > 0.5 ? aurora.pink : aurora.cyan}
              stopOpacity={0.15 * tensionIntensity} />
            <stop offset="100%" stopColor="transparent" stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* ═══ 5. KEY SIGNATURE AURORA ═══ */}
        <ellipse
          cx={W / 2 + Math.sin(auroraPhase * 0.7) * 100}
          cy={H / 2 + Math.cos(auroraPhase * 0.5) * 60}
          rx={600 + Math.sin(auroraPhase) * 80}
          ry={350 + Math.cos(auroraPhase * 0.8) * 50}
          fill={isMinor ? 'url(#cv-aurora-cool)' : 'url(#cv-aurora-warm)'}
        />
        {/* Secondary aurora orb */}
        <ellipse
          cx={W * 0.3 + Math.cos(auroraPhase * 0.4) * 150}
          cy={H * 0.6 + Math.sin(auroraPhase * 0.6) * 80}
          rx={300 + Math.sin(auroraPhase * 1.2) * 60}
          ry={200 + Math.cos(auroraPhase * 0.9) * 40}
          fill={isMinor ? 'url(#cv-aurora-warm)' : 'url(#cv-aurora-cool)'}
          opacity={0.5}
        />

        {/* Background stars */}
        {bgStars.map((star, i) => {
          const twinkle = Math.sin(frame * 0.05 + star.twinklePhase) * 0.3 + 0.7;
          return (
            <circle
              key={`bg-star-${i}`}
              cx={star.x}
              cy={star.y}
              r={star.r}
              fill={aurora.text}
              opacity={star.opacity * twinkle}
            />
          );
        })}

        {/* ═══ 7. HARMONIC TENSION METER ═══ */}
        {/* Bottom-center arc meter */}
        <g transform={`translate(${W / 2}, ${H - 40})`}>
          {/* Background arc */}
          <path
            d={describeArc(0, 0, 120, 200, 340)}
            fill="none"
            stroke={aurora.glassBorder}
            strokeWidth={3}
            opacity={0.4}
          />
          {/* Tension fill arc */}
          <path
            d={describeArc(0, 0, 120, 200, 200 + tensionIntensity * 140)}
            fill="none"
            stroke={tensionIntensity > 0.6 ? aurora.pink : tensionIntensity > 0.3 ? aurora.purple : aurora.cyan}
            strokeWidth={4}
            filter="url(#cv-glow-soft)"
            opacity={0.8}
          />
          {/* Tension label */}
          <text x={0} y={-6} textAnchor="middle"
            fill={aurora.textDim} fontSize={10} fontFamily="'SF Pro Display', system-ui">
            HARMONIC TENSION
          </text>
          <text x={0} y={10} textAnchor="middle"
            fill={tensionIntensity > 0.6 ? aurora.pink : aurora.cyan}
            fontSize={16} fontWeight={700} fontFamily="'SF Pro Display', system-ui"
            filter="url(#cv-glow-soft)">
            {Math.round(tensionIntensity * 100)}%
          </text>
          {/* Pulsing ring when high tension */}
          {tensionIntensity > 0.6 && (
            <circle
              cx={0} cy={0} r={130 + Math.sin(frame * 0.15) * 8}
              fill="none" stroke={aurora.pink}
              strokeWidth={1}
              opacity={0.15 + Math.sin(frame * 0.15) * 0.1}
            />
          )}
        </g>

        {/* ═══ 2. CIRCLE OF FIFTHS ═══ */}
        <g transform={`translate(380, ${H / 2 - 20})`}>
          {/* Outer glow ring */}
          <circle cx={0} cy={0} r={185}
            fill="none" stroke={aurora.glassBorder}
            strokeWidth={1} opacity={0.3 + glowPulse * 0.1} />

          {/* Key highlight arc */}
          {keyIdx >= 0 && (
            <path
              d={describeArc(0, 0, 178, keyIdx * 30 - 15 + circleRotation, keyIdx * 30 + 15 + circleRotation)}
              fill="none"
              stroke={isMinor ? aurora.purple : aurora.cyan}
              strokeWidth={6}
              filter="url(#cv-glow-strong)"
              opacity={0.7 * keyConfidence}
            />
          )}

          {/* Chord notes */}
          {CIRCLE_NOTES.map((note, i) => {
            const angle = (i * 30 + circleRotation - 90) * (Math.PI / 180);
            const r = 155;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;

            const isCurrentRoot = normalizeNote(note) === normalizeNote(currentRoot);
            const isKeyRoot = normalizeNote(note) === normalizeNote(keyRoot);
            const noteColor = isCurrentRoot ? aurora.cyan : isKeyRoot ? aurora.teal : aurora.textDim;
            const noteSize = isCurrentRoot ? 20 : isKeyRoot ? 15 : 12;
            const noteOpacity = isCurrentRoot ? 1 : isKeyRoot ? 0.9 : 0.5;

            return (
              <g key={`cof-${note}`}>
                {/* Connection beam to current chord root */}
                {isCurrentRoot && keyIdx >= 0 && i !== keyIdx && (
                  <line
                    x1={x} y1={y}
                    x2={Math.cos((keyIdx * 30 + circleRotation - 90) * (Math.PI / 180)) * r}
                    y2={Math.sin((keyIdx * 30 + circleRotation - 90) * (Math.PI / 180)) * r}
                    stroke={aurora.cyan}
                    strokeWidth={1.5}
                    filter="url(#cv-glow-soft)"
                    opacity={0.4 + glowPulse * 0.2}
                    strokeDasharray="4 4"
                  />
                )}

                {/* Glow circle behind active notes */}
                {isCurrentRoot && (
                  <circle cx={x} cy={y} r={24}
                    fill={aurora.cyan} opacity={0.15 + glowPulse * 0.08}
                    filter="url(#cv-glow-strong)" />
                )}
                {isKeyRoot && !isCurrentRoot && (
                  <circle cx={x} cy={y} r={18}
                    fill={aurora.teal} opacity={0.1}
                    filter="url(#cv-glow-soft)" />
                )}

                {/* Note circle */}
                <circle cx={x} cy={y} r={isCurrentRoot ? 20 : 14}
                  fill={isCurrentRoot ? 'rgba(103,232,249,0.2)' : 'rgba(120,200,220,0.06)'}
                  stroke={noteColor}
                  strokeWidth={isCurrentRoot ? 2 : 1}
                  opacity={noteOpacity}
                />

                {/* Note text */}
                <text x={x} y={y + noteSize * 0.35}
                  textAnchor="middle"
                  fill={noteColor}
                  fontSize={noteSize}
                  fontWeight={isCurrentRoot ? 800 : isKeyRoot ? 700 : 400}
                  fontFamily="'SF Pro Display', system-ui"
                  opacity={noteOpacity}
                  filter={isCurrentRoot ? 'url(#cv-glow-soft)' : undefined}>
                  {note}
                </text>
              </g>
            );
          })}

          {/* Inner labels */}
          <text x={0} y={-40} textAnchor="middle"
            fill={aurora.textDim} fontSize={9} fontFamily="'SF Pro Display', system-ui"
            letterSpacing="0.15em" opacity={0.6}>
            CIRCLE OF FIFTHS
          </text>
          {detectedKey && (
            <text x={0} y={-20} textAnchor="middle"
              fill={isMinor ? aurora.purple : aurora.teal}
              fontSize={14} fontWeight={600} fontFamily="'SF Pro Display', system-ui"
              filter="url(#cv-glow-soft)">
              Key: {detectedKey}
            </text>
          )}
          {keyConfidence > 0 && (
            <text x={0} y={0} textAnchor="middle"
              fill={aurora.textDim} fontSize={10} fontFamily="'SF Pro Display', system-ui"
              opacity={0.5}>
              {Math.round(keyConfidence * 100)}% confidence
            </text>
          )}
        </g>

        {/* ═══ 1. GIANT CHORD NAME ═══ */}
        <g transform={`translate(${W / 2 + 200}, ${H / 2 - 60})`}>
          {/* Massive glow behind chord name */}
          <circle cx={0} cy={0} r={140 + glowPulse * 20}
            fill={aurora.cyan} opacity={0.04 + glowPulse * 0.03}
            filter="url(#cv-glow-mega)" />

          {/* Chord quality label */}
          <text x={0} y={-90} textAnchor="middle"
            fill={aurora.textDim} fontSize={14}
            fontFamily="'SF Pro Display', system-ui"
            letterSpacing="0.2em" style={{ textTransform: 'uppercase' }}
            opacity={0.6 * chordEntrance}>
            {chordQuality || 'CHORD'}
          </text>

          {/* Previous chord fading out */}
          {previousChord && previousChord !== currentChord && (
            <text x={0} y={30} textAnchor="middle"
              fill={aurora.textDim}
              fontSize={100}
              fontWeight={800}
              fontFamily="'Georgia', 'Palatino', serif"
              opacity={Math.max(0, 0.15 - (chordEntrance * 0.15))}>
              {previousChord}
            </text>
          )}

          {/* Main chord name — HUGE */}
          <text x={0} y={30} textAnchor="middle"
            fill={aurora.cyan}
            fontSize={120}
            fontWeight={800}
            fontFamily="'Georgia', 'Palatino', serif"
            filter="url(#cv-glow-strong)"
            opacity={0.9 * chordEntrance}
            transform={`scale(${0.85 + chordEntrance * 0.15})`}
            style={{ transformOrigin: 'center', transformBox: 'fill-box' }}>
            {currentChord || '---'}
          </text>

          {/* Particle burst ring on chord change */}
          {chordEntrance < 0.95 && (
            <circle cx={0} cy={0}
              r={60 + chordEntrance * 100}
              fill="none"
              stroke={aurora.cyan}
              strokeWidth={2 - chordEntrance * 2}
              opacity={0.5 * (1 - chordEntrance)}
              filter="url(#cv-glow-soft)"
            />
          )}
          {chordEntrance < 0.9 && (
            <circle cx={0} cy={0}
              r={40 + chordEntrance * 140}
              fill="none"
              stroke={aurora.teal}
              strokeWidth={1.5 - chordEntrance * 1.5}
              opacity={0.3 * (1 - chordEntrance)}
            />
          )}
        </g>

        {/* ═══ 4. NOTE PARTICLES ═══ */}
        {activeNotes.map((np, i) => {
          const age = (Date.now() - np.timestamp) / 1000;
          if (age > 5) return null; // Don't render stale particles

          const centerX = W / 2 + 200;
          const centerY = H / 2 - 60;
          // Orbit around the chord name
          const orbitAngle = (frame * 0.03 + i * (Math.PI * 2 / Math.max(activeNotes.length, 1))) + (np.note * 0.5);
          const orbitR = 90 + (i % 3) * 30 + Math.sin(frame * 0.05 + i) * 15;
          const px = centerX + Math.cos(orbitAngle) * orbitR;
          const py = centerY + Math.sin(orbitAngle) * orbitR * 0.7;
          const pColor = roleColor(np.role);
          const pSize = 2 + (np.velocity / 127) * 4;
          const pOpacity = Math.max(0.2, 1 - age * 0.2);

          return (
            <g key={`np-${i}-${np.note}`}>
              <circle cx={px} cy={py} r={pSize}
                fill={pColor} opacity={pOpacity}
                filter="url(#cv-glow-particle)" />
              {/* Trail */}
              <circle cx={px - Math.cos(orbitAngle) * 8} cy={py - Math.sin(orbitAngle) * 5}
                r={pSize * 0.6} fill={pColor} opacity={pOpacity * 0.3} />
            </g>
          );
        })}

        {/* ═══ 3. CHORD PROGRESSION TRAIL ═══ */}
        <g transform={`translate(${W / 2 - 100}, ${H - 130})`}>
          <text x={0} y={-50} textAnchor="start"
            fill={aurora.textDim} fontSize={10}
            fontFamily="'SF Pro Display', system-ui"
            letterSpacing="0.15em" opacity={0.5}>
            PROGRESSION
          </text>
          {progression.map((chord, i) => {
            const total = progression.length;
            const recency = (i + 1) / total; // 0..1, most recent = 1
            const cardX = (total - 1 - i) * -80;
            const cardW = 68;
            const cardH = 38;
            const cardOpacity = 0.2 + recency * 0.8;
            const cardScale = 0.7 + recency * 0.3;
            const isLast = i === total - 1;
            const cardColor = isLast ? aurora.cyan : aurora.textDim;

            return (
              <g key={`prog-${i}`}
                transform={`translate(${cardX}, ${-30}) scale(${cardScale})`}
                opacity={cardOpacity}>
                <rect x={-cardW / 2} y={-cardH / 2}
                  width={cardW} height={cardH}
                  rx={8}
                  fill="url(#cv-glass-grad)"
                  stroke={isLast ? aurora.cyan : aurora.glassBorder}
                  strokeWidth={isLast ? 1.5 : 0.5}
                />
                {isLast && (
                  <rect x={-cardW / 2} y={-cardH / 2}
                    width={cardW} height={cardH}
                    rx={8}
                    fill="none"
                    stroke={aurora.cyan}
                    strokeWidth={1}
                    filter="url(#cv-glow-soft)"
                    opacity={glowPulse * 0.5}
                  />
                )}
                <text x={0} y={5} textAnchor="middle"
                  fill={cardColor}
                  fontSize={isLast ? 18 : 14}
                  fontWeight={isLast ? 700 : 400}
                  fontFamily="'Georgia', 'Palatino', serif"
                  filter={isLast ? 'url(#cv-glow-soft)' : undefined}>
                  {chord}
                </text>
              </g>
            );
          })}
        </g>

        {/* ═══ 6. SUGGESTION CARDS ═══ */}
        <g transform={`translate(${W - 200}, 80)`}>
          <text x={0} y={-20} textAnchor="middle"
            fill={aurora.textDim} fontSize={10}
            fontFamily="'SF Pro Display', system-ui"
            letterSpacing="0.15em" opacity={0.5}>
            SUGGESTED NEXT
          </text>
          {suggestions.slice(0, 6).map((s, i) => {
            const sy = i * 65;
            const orbR = 28 + s.probability * 14;
            const orbOpacity = 0.3 + s.probability * 0.5;
            const floatY = Math.sin(frame * 0.03 + i * 1.5) * 4;

            return (
              <g key={`sug-${i}`} transform={`translate(0, ${sy + floatY})`}>
                {/* Glass orb */}
                <circle cx={0} cy={0} r={orbR}
                  fill="url(#cv-glass-grad)"
                  stroke={i === 0 ? aurora.teal : aurora.glassBorder}
                  strokeWidth={i === 0 ? 1.5 : 0.5}
                  opacity={orbOpacity}
                />
                {/* Glow for top suggestion */}
                {i === 0 && (
                  <circle cx={0} cy={0} r={orbR + 4}
                    fill="none" stroke={aurora.teal}
                    strokeWidth={1} filter="url(#cv-glow-soft)"
                    opacity={0.3 * glowPulse}
                  />
                )}
                {/* Chord name */}
                <text x={0} y={2} textAnchor="middle"
                  fill={i === 0 ? aurora.teal : aurora.text}
                  fontSize={16} fontWeight={700}
                  fontFamily="'Georgia', 'Palatino', serif">
                  {s.chord}
                </text>
                {/* Probability */}
                <text x={0} y={orbR + 14} textAnchor="middle"
                  fill={aurora.textDim} fontSize={9}
                  fontFamily="'SF Pro Display', system-ui"
                  opacity={0.6}>
                  {Math.round(s.probability * 100)}%
                </text>
              </g>
            );
          })}
        </g>

        {/* Tension glow overlay */}
        <rect x={0} y={0} width={W} height={H}
          fill="url(#cv-tension-glow)"
          opacity={tensionIntensity > 0.5 ? 0.5 + Math.sin(frame * 0.12) * 0.2 : 0}
        />
      </svg>
    </AbsoluteFill>
  );
};

// ── SVG Arc helper ─────────────────────────────────────────────────────────

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}
