// ── Tonnetz Guided Lessons ────────────────────────────────────────────────
//
// Each lesson is a sequence of steps. Each step highlights specific
// triangles/chords on the Tonnetz and provides narration + auto-play.

import type { TonnetzTriangle, PLROp } from './tonnetz';

export interface LessonStep {
  /** Narration text — short, punchy, cinematic */
  title: string;
  /** Longer explanation */
  body: string;
  /** Triangles to highlight with a spotlight beam */
  highlights: TonnetzTriangle[];
  /** Chord to auto-play when this step activates */
  playChord?: string;
  /** If set, draw a glowing arrow/trail from the previous step's highlight to this one */
  showTrail?: boolean;
  /** PLR operation label to display on the transition */
  operation?: PLROp;
  /** Duration in ms before auto-advancing (0 = wait for user click) */
  autoDuration?: number;
  /** Optional: specific pitch classes to light up on nodes */
  highlightPCs?: number[];
  /** Optional: annotation text to show near a specific triangle */
  annotation?: { tri: TonnetzTriangle; text: string };
  /** Optional: additional annotations to show (multiple callouts) */
  annotations?: { tri: TonnetzTriangle; text: string }[];
}

export interface TonnetzLesson {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  /** Estimated duration in minutes */
  durationMin: number;
  /** Difficulty: 1-3 */
  difficulty: 1 | 2 | 3;
  /** Accent color for the lesson card */
  accentColor: string;
  /** Icon character */
  icon: string;
  /** Key to set before starting */
  startKey: string;
  startMode: 'major' | 'minor';
  steps: LessonStep[];
}

// ── Helper: common triangle positions ────────────────────────────────────
// These are for key of C major, where C major triad is at q=0, r=0, down

const C_MAJ: TonnetzTriangle = { q: 0, r: 0, pointing: 'down' };
const A_MIN: TonnetzTriangle = { q: 0, r: -1, pointing: 'up' };
const F_MAJ: TonnetzTriangle = { q: -1, r: 0, pointing: 'down' };
const G_MAJ: TonnetzTriangle = { q: 1, r: 0, pointing: 'down' };
const D_MIN: TonnetzTriangle = { q: -1, r: -1, pointing: 'up' };
const E_MIN: TonnetzTriangle = { q: 1, r: -1, pointing: 'up' };
const E_MAJ: TonnetzTriangle = { q: 2, r: -1, pointing: 'down' };
const C_MIN: TonnetzTriangle = { q: 0, r: 0, pointing: 'up' };
const Ab_MAJ: TonnetzTriangle = { q: -1, r: 1, pointing: 'down' };
const Eb_MAJ: TonnetzTriangle = { q: -2, r: 1, pointing: 'down' };
const F_MIN: TonnetzTriangle = { q: -1, r: 0, pointing: 'up' };
const Bb_MAJ: TonnetzTriangle = { q: -2, r: 0, pointing: 'down' };

// ── Lessons ──────────────────────────────────────────────────────────────

export const TONNETZ_LESSONS: TonnetzLesson[] = [

  // ═══════════════════════════════════════════════════════════════════════
  // LESSON 1: Your First Steps
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'first-steps',
    title: 'Your First Steps',
    subtitle: 'Navigate the harmonic lattice',
    description: 'Learn how chords are arranged on the Tonnetz and take your first steps across the harmonic landscape.',
    durationMin: 3,
    difficulty: 1,
    accentColor: '#67e8f9',
    icon: '✦',
    startKey: 'C',
    startMode: 'major',
    steps: [
      {
        title: 'Welcome to the Tonnetz',
        body: 'This is the Tonnetz — an infinite lattice where every triangle is a chord. Look: downward-pointing triangles are major chords. Upward-pointing triangles are minor chords.',
        highlights: [C_MAJ, A_MIN],
        annotations: [
          { tri: C_MAJ, text: '▽ Major' },
          { tri: A_MIN, text: '△ Minor' },
        ],
        autoDuration: 0,
      },
      {
        title: 'The Three Nodes',
        body: 'Each triangle connects three notes — the three notes of the chord. These three nodes are C, E, and G. Together they form C major.',
        highlights: [C_MAJ],
        playChord: 'C',
        highlightPCs: [0, 4, 7],
        annotations: [
          { tri: C_MAJ, text: 'C · E · G' },
        ],
        autoDuration: 3500,
      },
      {
        title: 'The Parallel Operation (P)',
        body: 'Flip across the shared edge. One note moves by a single semitone — E drops to Eb. C major becomes C minor. This is the Parallel operation.',
        highlights: [C_MAJ, C_MIN],
        playChord: 'Cm',
        showTrail: true,
        operation: 'P',
        annotation: { tri: C_MIN, text: 'E → Eb (−1)' },
        highlightPCs: [0, 3, 7],
        autoDuration: 4000,
      },
      {
        title: 'The Relative Operation (R)',
        body: 'Now from C major, flip the other way. G moves up to A — and you land on A minor. C major\'s relative minor. This is the R operation.',
        highlights: [C_MAJ, A_MIN],
        playChord: 'Am',
        showTrail: true,
        operation: 'R',
        annotation: { tri: A_MIN, text: 'G → A (+2)' },
        highlightPCs: [0, 4, 9],
        autoDuration: 4000,
      },
      {
        title: 'The Leading-Tone Operation (L)',
        body: 'The third move: from C major, C drops a semitone to B. You land on E minor. This is the Leading-tone operation — the most dramatic of the three.',
        highlights: [C_MAJ, E_MIN],
        playChord: 'Em',
        showTrail: true,
        operation: 'L',
        annotation: { tri: E_MIN, text: 'C → B (−1)' },
        highlightPCs: [4, 7, 11],
        autoDuration: 4000,
      },
      {
        title: 'Three Moves, Infinite Possibilities',
        body: 'P, L, and R — just three operations, each moving only one note by one or two semitones. But chained together, they can reach any chord in existence. Click any triangle to start exploring.',
        highlights: [C_MAJ, C_MIN, A_MIN, E_MIN],
        annotations: [
          { tri: C_MIN, text: 'P' },
          { tri: A_MIN, text: 'R' },
          { tri: E_MIN, text: 'L' },
        ],
        autoDuration: 0,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // LESSON 2: The Diatonic Neighborhood
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'diatonic-neighborhood',
    title: 'The Diatonic Neighborhood',
    subtitle: 'Six chords that live together',
    description: 'Discover the compact strip of six triads that form a major key, and see why some chord changes feel natural.',
    durationMin: 4,
    difficulty: 1,
    accentColor: '#fbbf24',
    icon: '◈',
    startKey: 'C',
    startMode: 'major',
    steps: [
      {
        title: 'Home Territory',
        body: 'In any major key, six triads form a tight neighborhood on the Tonnetz — three major chords in a row (▽), with three minor chords (△) nestled between them.',
        highlights: [F_MAJ, C_MAJ, G_MAJ, D_MIN, A_MIN, E_MIN],
        annotations: [
          { tri: F_MAJ, text: 'IV' },
          { tri: C_MAJ, text: 'I' },
          { tri: G_MAJ, text: 'V' },
          { tri: D_MIN, text: 'ii' },
          { tri: A_MIN, text: 'vi' },
          { tri: E_MIN, text: 'iii' },
        ],
        autoDuration: 0,
      },
      {
        title: 'The Major Triads: IV - I - V',
        body: 'The three major chords sit in a horizontal line. F major (IV), C major (I), G major (V). Moving horizontally means moving by perfect fifths — the strongest harmonic relationship.',
        highlights: [F_MAJ, C_MAJ, G_MAJ],
        playChord: 'C',
        annotations: [
          { tri: F_MAJ, text: 'IV — F' },
          { tri: C_MAJ, text: 'I — C' },
          { tri: G_MAJ, text: 'V — G' },
        ],
        autoDuration: 3500,
      },
      {
        title: 'F Major — The Subdominant (IV)',
        body: 'One step left of home. F major pulls you gently away from the tonic, creating a sense of openness and possibility.',
        highlights: [F_MAJ],
        playChord: 'F',
        showTrail: true,
        autoDuration: 3000,
      },
      {
        title: 'G Major — The Dominant (V)',
        body: 'One step right of home. G major creates tension that wants to resolve back to C. This V→I pull is the engine of Western harmony.',
        highlights: [G_MAJ],
        playChord: 'G',
        showTrail: true,
        autoDuration: 3000,
      },
      {
        title: 'The Minor Triads: ii - vi - iii',
        body: 'Below each major chord sits its relative minor. D minor (ii) under F, A minor (vi) under C, E minor (iii) under G. Each pair shares two notes.',
        highlights: [D_MIN, A_MIN, E_MIN],
        playChord: 'Am',
        annotations: [
          { tri: D_MIN, text: 'ii — Dm' },
          { tri: A_MIN, text: 'vi — Am' },
          { tri: E_MIN, text: 'iii — Em' },
        ],
        autoDuration: 3500,
      },
      {
        title: 'Walking the Neighborhood',
        body: 'Watch: I → V → vi → IV. The most popular progression in pop music. Every move is a single P, L, or R step — smooth voice leading, maximum emotional impact.',
        highlights: [C_MAJ],
        playChord: 'C',
        autoDuration: 2000,
      },
      {
        title: '',
        body: '',
        highlights: [G_MAJ],
        playChord: 'G',
        showTrail: true,
        operation: 'L',
        autoDuration: 2000,
      },
      {
        title: '',
        body: '',
        highlights: [A_MIN],
        playChord: 'Am',
        showTrail: true,
        operation: 'R',
        autoDuration: 2000,
      },
      {
        title: '',
        body: '',
        highlights: [F_MAJ],
        playChord: 'F',
        showTrail: true,
        operation: 'R',
        autoDuration: 2000,
      },
      {
        title: 'Home Again',
        body: 'C → G → Am → F. Four chords. Four single-step moves on the Tonnetz. Hundreds of hit songs. The geometry of the lattice reveals why these chords work together — they\'re neighbors.',
        highlights: [C_MAJ, G_MAJ, A_MIN, F_MAJ],
        playChord: 'C',
        showTrail: true,
        autoDuration: 0,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // LESSON 3: Chromatic Mediants — The Cinematic Sound
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'chromatic-mediants',
    title: 'Chromatic Mediants',
    subtitle: 'The cinematic sound',
    description: 'Learn the chord moves that make film scores sound epic — dramatic jumps that share just one note.',
    durationMin: 4,
    difficulty: 2,
    accentColor: '#a78bfa',
    icon: '⬡',
    startKey: 'C',
    startMode: 'major',
    steps: [
      {
        title: 'Beyond the Neighborhood',
        body: 'P, L, and R move one note by one or two semitones. But what happens when you chain two operations? You get chromatic mediants — chords a major or minor third apart that share exactly one note.',
        highlights: [C_MAJ],
        playChord: 'C',
        highlightPCs: [0, 4, 7],
        annotations: [{ tri: C_MAJ, text: 'Starting here' }],
        autoDuration: 0,
      },
      {
        title: 'C Major to E Major (LP)',
        body: 'First L (C→Em), then P (Em→E). Two moves, but the sound is one dramatic leap. C major to E major — a chromatic mediant. Film composers live here.',
        highlights: [C_MAJ, E_MAJ],
        playChord: 'E',
        showTrail: true,
        annotation: { tri: E_MAJ, text: 'LP: 2 moves' },
        autoDuration: 4000,
      },
      {
        title: 'C Major to Ab Major (RP)',
        body: 'Now try R then P: C→Am→Ab. Another chromatic mediant in the opposite direction. Listen to how different it feels — darker, more mysterious.',
        highlights: [C_MAJ, Ab_MAJ],
        playChord: 'Ab',
        showTrail: true,
        annotation: { tri: Ab_MAJ, text: 'RP: 2 moves' },
        autoDuration: 4000,
      },
      {
        title: 'The Chain',
        body: 'Watch and listen: C → Ab → E → C. Three chromatic mediants in a row, forming a triangle of major thirds. This is pure cinema.',
        highlights: [C_MAJ],
        playChord: 'C',
        autoDuration: 2500,
      },
      {
        title: '',
        body: '',
        highlights: [Ab_MAJ],
        playChord: 'Ab',
        showTrail: true,
        autoDuration: 2500,
      },
      {
        title: '',
        body: '',
        highlights: [E_MAJ],
        playChord: 'E',
        showTrail: true,
        autoDuration: 2500,
      },
      {
        title: '',
        body: '',
        highlights: [C_MAJ],
        playChord: 'C',
        showTrail: true,
        autoDuration: 2500,
      },
      {
        title: 'Why It Works',
        body: 'Each chromatic mediant shares one note with the previous chord while two notes shift by a semitone. Maximum drama, minimal motion. This is why the Tonnetz is powerful — you can see these relationships geometrically.',
        highlights: [C_MAJ, Ab_MAJ, E_MAJ],
        autoDuration: 0,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // LESSON 4: The PLR Cycle — Hexagonal Journeys
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'plr-cycle',
    title: 'The PLR Cycle',
    subtitle: 'Hexagonal journeys',
    description: 'Discover how repeating P-L-R operations traces a perfect hexagonal path that returns you home — passing through all 12 pitch classes.',
    durationMin: 5,
    difficulty: 3,
    accentColor: '#f472b6',
    icon: '⟡',
    startKey: 'C',
    startMode: 'major',
    steps: [
      {
        title: 'A Repeating Pattern',
        body: 'What happens if you keep applying P, then L, then R, over and over? Something remarkable — you trace a hexagon on the Tonnetz and return to where you started.',
        highlights: [C_MAJ],
        playChord: 'C',
        autoDuration: 0,
      },
      {
        title: 'Step 1: P (C → Cm)',
        body: 'Parallel: E drops to Eb.',
        highlights: [C_MAJ, C_MIN],
        playChord: 'Cm',
        showTrail: true,
        operation: 'P',
        annotation: { tri: C_MIN, text: 'E → Eb' },
        autoDuration: 2500,
      },
      {
        title: 'Step 2: L (Cm → Ab)',
        body: 'Leading-tone: G drops to Ab. We\'ve left the key of C entirely.',
        highlights: [C_MIN, Ab_MAJ],
        playChord: 'Ab',
        showTrail: true,
        operation: 'L',
        annotation: { tri: Ab_MAJ, text: 'G → Ab' },
        autoDuration: 2500,
      },
      {
        title: 'Step 3: R (Ab → Fm)',
        body: 'Relative: Ab major\'s relative minor.',
        highlights: [Ab_MAJ, F_MIN],
        playChord: 'Fm',
        showTrail: true,
        operation: 'R',
        annotation: { tri: F_MIN, text: 'Ab → F' },
        autoDuration: 2500,
      },
      {
        title: 'Step 4: P (Fm → F)',
        body: 'Parallel again: Ab rises to A.',
        highlights: [F_MIN, F_MAJ],
        playChord: 'F',
        showTrail: true,
        operation: 'P',
        annotation: { tri: F_MAJ, text: 'Ab → A' },
        autoDuration: 2500,
      },
      {
        title: 'Step 5: L (F → Am)',
        body: 'Leading-tone: C rises to... wait — we know A minor!',
        highlights: [F_MAJ, A_MIN],
        playChord: 'Am',
        showTrail: true,
        operation: 'L',
        annotation: { tri: A_MIN, text: 'F → E' },
        autoDuration: 2500,
      },
      {
        title: 'Step 6: R (Am → C)',
        body: 'Relative: and we\'re home. A minor\'s relative major is C major. The hexagon is complete.',
        highlights: [A_MIN, C_MAJ],
        playChord: 'C',
        showTrail: true,
        operation: 'R',
        annotation: { tri: C_MAJ, text: 'A → G' },
        autoDuration: 3000,
      },
      {
        title: 'The Hexagonal Orbit',
        body: 'C → Cm → Ab → Fm → F → Am → C. Six steps, six edges of a hexagon on the Tonnetz. The PLR cycle visits 6 chords and touches 9 of the 12 pitch classes. This is one of the deepest symmetries in all of music theory.',
        highlights: [C_MAJ, C_MIN, Ab_MAJ, F_MIN, F_MAJ, A_MIN],
        autoDuration: 0,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // LESSON 5: Voice Leading Mastery
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'voice-leading',
    title: 'Voice Leading Mastery',
    subtitle: 'The art of minimal motion',
    description: 'Master the principle that makes great chord progressions — moving voices by the smallest possible intervals.',
    durationMin: 4,
    difficulty: 2,
    accentColor: '#2dd4bf',
    icon: '◇',
    startKey: 'C',
    startMode: 'major',
    steps: [
      {
        title: 'The Golden Rule',
        body: 'The best chord progressions move voices as little as possible. On the Tonnetz, adjacent triangles always share two notes — only one voice moves. This is voice leading at its finest.',
        highlights: [C_MAJ],
        playChord: 'C',
        autoDuration: 0,
      },
      {
        title: 'One Semitone: P and L',
        body: 'The P and L operations each move one note by exactly one semitone. This is the smoothest possible voice leading — the listener barely notices the change, but feels the color shift.',
        highlights: [C_MAJ, C_MIN],
        playChord: 'Cm',
        showTrail: true,
        operation: 'P',
        annotation: { tri: C_MIN, text: 'E → Eb (1 semitone)' },
        autoDuration: 3500,
      },
      {
        title: 'Two Semitones: R',
        body: 'The R operation moves one note by two semitones — a whole step. Still very smooth, but with a slightly bigger color change.',
        highlights: [C_MAJ, A_MIN],
        playChord: 'Am',
        showTrail: true,
        operation: 'R',
        annotation: { tri: A_MIN, text: 'G → A (2 semitones)' },
        autoDuration: 3500,
      },
      {
        title: 'Descending Fifths',
        body: 'Watch: Am → Dm → G → C. Each step is an R operation. The classic jazz turnaround — every chord shares 2 notes with the next. The smoothest possible journey through a ii-V-I.',
        highlights: [A_MIN],
        playChord: 'Am',
        autoDuration: 2000,
      },
      {
        title: '',
        body: '',
        highlights: [D_MIN],
        playChord: 'Dm',
        showTrail: true,
        operation: 'R',
        autoDuration: 2000,
      },
      {
        title: '',
        body: '',
        highlights: [G_MAJ],
        playChord: 'G',
        showTrail: true,
        operation: 'R',
        autoDuration: 2000,
      },
      {
        title: '',
        body: '',
        highlights: [C_MAJ],
        playChord: 'C',
        showTrail: true,
        operation: 'R',
        autoDuration: 2000,
      },
      {
        title: 'The Principle',
        body: 'On the Tonnetz, distance = voice leading cost. Nearby triangles share more notes. The closer two chords are on the lattice, the smoother the transition sounds. Use this to craft progressions that flow like water.',
        highlights: [A_MIN, D_MIN, G_MAJ, C_MAJ],
        autoDuration: 0,
      },
    ],
  },
];

export function getLessonById(id: string): TonnetzLesson | undefined {
  return TONNETZ_LESSONS.find(l => l.id === id);
}
