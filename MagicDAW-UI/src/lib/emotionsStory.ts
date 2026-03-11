// ── Emotions of Music: Story Data ─────────────────────────────────────────
//
// A cinematic narrative journey through harmony, told as emotions.
// Each chapter maps chord progressions to feelings, always relating
// back to "home" (C major) so the listener understands intervals
// and harmonic distance.

export interface StoryBeat {
  /** Chord symbol, e.g. "C", "Am", "Fm" */
  chord: string;
  /** Duration in frames at 30fps */
  durationFrames: number;
  /** Brief poetic text for this beat */
  text?: string;
}

export interface StoryChapter {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  /** The emotion this chapter embodies */
  emotion: string;
  /** Poetic narration lines (revealed sequentially) */
  narration: string[];
  /** Chord progression beats */
  beats: StoryBeat[];
  /** Dominant atmosphere color */
  color: string;
  /** Secondary accent color */
  accent: string;
  /** Background gradient stops */
  gradient: [string, string, string];
  /** Particle effect style */
  particleStyle: 'warm-glow' | 'cool-drift' | 'sparkle' | 'swirl' | 'storm' | 'aurora' | 'bloom' | 'fireworks';
  /** Interval description relative to home */
  intervalNote: string;
  /** How far from home (0 = home, higher = farther) */
  harmonicDistance: number;
}

// ── Chapter Definitions ───────────────────────────────────────────────────

export const STORY_CHAPTERS: StoryChapter[] = [
  // ── PROLOGUE: THE SCALE ─────────────────────────────────────────────────
  {
    id: 'prologue',
    number: 0,
    title: 'The Map',
    subtitle: 'Every journey begins with seven steps',
    emotion: 'Curiosity',
    narration: [
      'Before the story begins, learn the language.',
      'Seven notes. Seven colors. One home.',
      'C — D — E — F — G — A — B',
      'Each step has a feeling. A distance from home.',
      'The 1st is rest. The 5th is strength. The 7th yearns to resolve.',
      'This is your scale. This is your compass.',
    ],
    beats: [
      { chord: 'C', durationFrames: 30, text: 'I — Home' },
      { chord: 'Dm', durationFrames: 25, text: 'ii — One step out' },
      { chord: 'Em', durationFrames: 25, text: 'iii — Gentle motion' },
      { chord: 'F', durationFrames: 28, text: 'IV — The horizon' },
      { chord: 'G', durationFrames: 28, text: 'V — Strength' },
      { chord: 'Am', durationFrames: 25, text: 'vi — Bittersweet' },
      { chord: 'Bdim', durationFrames: 22, text: 'vii° — Tension' },
      { chord: 'C', durationFrames: 35, text: 'I — Home again' },
    ],
    color: '#e2e8f0',
    accent: '#67e8f9',
    gradient: ['#0a0e1a', '#141b2d', '#0a0e1a'],
    particleStyle: 'cool-drift',
    intervalNote: 'The major scale: seven unique distances from home, each with its own gravity.',
    harmonicDistance: 0,
  },

  // ── CHAPTER 1: HOME ─────────────────────────────────────────────────────
  {
    id: 'home',
    number: 1,
    title: 'Home',
    subtitle: 'Where every story begins',
    emotion: 'Safety',
    narration: [
      'Close your eyes.',
      'This is C major. This is home.',
      'The root, the third, the fifth — a perfect triangle of rest.',
      'Every journey starts from a place you can return to.',
      'Feel the warmth. Remember this feeling.',
    ],
    beats: [
      { chord: 'C', durationFrames: 45, text: 'Home' },
      { chord: 'C', durationFrames: 40, text: 'Safe' },
      { chord: 'C', durationFrames: 50, text: 'Still' },
    ],
    color: '#fbbf24',
    accent: '#f59e0b',
    gradient: ['#1a1508', '#2a2010', '#1a1508'],
    particleStyle: 'warm-glow',
    intervalNote: 'Unison — zero steps from home. The I chord. Pure resolution.',
    harmonicDistance: 0,
  },

  // ── CHAPTER 2: WONDER ───────────────────────────────────────────────────
  {
    id: 'wonder',
    number: 2,
    title: 'Wonder',
    subtitle: 'The first steps into the unknown',
    emotion: 'Wonder',
    narration: [
      'A door opens.',
      'F major — the IV chord. Just one step away on the circle.',
      'Then A minor — the relative minor. The same notes, but a shadow.',
      'You\u2019re still close to home, but the light is different here.',
      'This is wonder: familiar yet strange.',
    ],
    beats: [
      { chord: 'C', durationFrames: 30, text: 'Starting from home...' },
      { chord: 'F', durationFrames: 40, text: 'IV — The subdominant' },
      { chord: 'Am', durationFrames: 40, text: 'vi — Its shadow' },
      { chord: 'F', durationFrames: 35, text: 'IV — Still close' },
    ],
    color: '#67e8f9',
    accent: '#22d3ee',
    gradient: ['#061e2b', '#0c2d3d', '#061e2b'],
    particleStyle: 'cool-drift',
    intervalNote: 'IV and vi — one and three steps on the circle of fifths. Near home, but the light shifts.',
    harmonicDistance: 1,
  },

  // ── CHAPTER 3: ADVENTURE ────────────────────────────────────────────────
  {
    id: 'adventure',
    number: 3,
    title: 'Adventure',
    subtitle: 'The road rises to meet you',
    emotion: 'Excitement',
    narration: [
      'The path widens.',
      'G major — the V chord. The dominant. Raw power.',
      'It pulls toward home like gravity, but we resist.',
      'E minor answers — gentle, running alongside.',
      'Then C returns, not as rest, but as a launching pad.',
    ],
    beats: [
      { chord: 'G', durationFrames: 35, text: 'V — The dominant' },
      { chord: 'Em', durationFrames: 30, text: 'iii — Running free' },
      { chord: 'Am', durationFrames: 28, text: 'vi — A glance back' },
      { chord: 'G', durationFrames: 30, text: 'V — Surging forward' },
      { chord: 'C', durationFrames: 30, text: 'I — Not rest — momentum' },
    ],
    color: '#34d399',
    accent: '#10b981',
    gradient: ['#061a14', '#0c2d22', '#061a14'],
    particleStyle: 'sparkle',
    intervalNote: 'V — one fifth above home. The strongest pull in all of harmony. The dominant wants to resolve.',
    harmonicDistance: 1,
  },

  // ── CHAPTER 4: TENSION ──────────────────────────────────────────────────
  {
    id: 'tension',
    number: 4,
    title: 'Tension',
    subtitle: 'When the ground shifts beneath you',
    emotion: 'Unease',
    narration: [
      'Something changes.',
      'D minor — the ii chord. Not dissonant, but… searching.',
      'G pulls us toward resolution, but D minor pulls back.',
      'We oscillate. Unresolved. Suspended between wanting and waiting.',
      'This is the space where stories get interesting.',
    ],
    beats: [
      { chord: 'Dm', durationFrames: 35, text: 'ii — Searching' },
      { chord: 'G', durationFrames: 30, text: 'V — Pulling home' },
      { chord: 'Dm', durationFrames: 35, text: 'ii — But not yet' },
      { chord: 'G', durationFrames: 28, text: 'V — Almost...' },
      { chord: 'Dm', durationFrames: 30, text: 'ii — Suspended' },
    ],
    color: '#f59e0b',
    accent: '#d97706',
    gradient: ['#1a1408', '#2d2210', '#1a1408'],
    particleStyle: 'swirl',
    intervalNote: 'ii–V oscillation — the most common tension in Western music. Two steps from home, reaching but never arriving.',
    harmonicDistance: 2,
  },

  // ── CHAPTER 5: DARKNESS ─────────────────────────────────────────────────
  {
    id: 'darkness',
    number: 5,
    title: 'Darkness',
    subtitle: 'Far from home, in borrowed light',
    emotion: 'Fear',
    narration: [
      'Now we leave the map entirely.',
      'F minor — a chromatic mediant. Notes that don\'t belong to our scale.',
      'A♭ major — four steps away on the circle. Distant, foreign.',
      'C minor — our home key\'s dark twin. Same root, opposite feeling.',
      'We are lost. But even here, there is beauty.',
    ],
    beats: [
      { chord: 'Fm', durationFrames: 38, text: 'iv — Borrowed darkness' },
      { chord: 'Ab', durationFrames: 35, text: '♭VI — Far from home' },
      { chord: 'Cm', durationFrames: 40, text: 'i — The dark mirror' },
      { chord: 'Fm', durationFrames: 35, text: 'iv — Deeper still' },
    ],
    color: '#a78bfa',
    accent: '#7c3aed',
    gradient: ['#0f0a1a', '#1a1030', '#0f0a1a'],
    particleStyle: 'storm',
    intervalNote: 'Chromatic mediants — ♭VI, iv, i. Three to four fifths from home. Notes outside our scale. We are truly far away.',
    harmonicDistance: 4,
  },

  // ── CHAPTER 6: HOPE ─────────────────────────────────────────────────────
  {
    id: 'hope',
    number: 6,
    title: 'Hope',
    subtitle: 'Dawn breaks on the horizon',
    emotion: 'Hope',
    narration: [
      'A crack of light.',
      'F major returns — familiar! The IV chord, our old friend.',
      'Then G — the dominant. Home is pulling us back.',
      'The intervals shrink. One step. Then half a step.',
      'We can see home from here.',
    ],
    beats: [
      { chord: 'Fm', durationFrames: 25, text: 'Still dark...' },
      { chord: 'F', durationFrames: 35, text: 'IV — A familiar face!' },
      { chord: 'G', durationFrames: 40, text: 'V — Home is calling' },
      { chord: 'G', durationFrames: 35, text: 'V — Almost there' },
    ],
    color: '#f472b6',
    accent: '#ec4899',
    gradient: ['#1a0a14', '#2d1025', '#1a0a14'],
    particleStyle: 'aurora',
    intervalNote: 'IV → V — the pre-cadential motion. One step left on the circle. The dominant resolves to the tonic. Home is inevitable.',
    harmonicDistance: 1,
  },

  // ── CHAPTER 7: TRIUMPH ──────────────────────────────────────────────────
  {
    id: 'triumph',
    number: 7,
    title: 'Home Again',
    subtitle: 'Every ending is a beginning',
    emotion: 'Triumph',
    narration: [
      'C major.',
      'The same three notes. The same triangle.',
      'But you are not the same.',
      'You\'ve heard the shadows, felt the tension, found your way back.',
      'Home doesn\'t sound the same when you\'ve been away.',
      'It sounds like triumph.',
    ],
    beats: [
      { chord: 'G', durationFrames: 25, text: 'V — The final step' },
      { chord: 'C', durationFrames: 50, text: 'I — HOME' },
      { chord: 'C', durationFrames: 45, text: 'You made it.' },
      { chord: 'C', durationFrames: 60, text: '♡' },
    ],
    color: '#fbbf24',
    accent: '#f472b6',
    gradient: ['#1a1508', '#2d2210', '#1a1508'],
    particleStyle: 'fireworks',
    intervalNote: 'V → I — the perfect authentic cadence. Zero distance. Complete resolution. You are home.',
    harmonicDistance: 0,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────

/** Total frames across all beats in a chapter */
export function chapterTotalFrames(ch: StoryChapter): number {
  return ch.beats.reduce((sum, b) => sum + b.durationFrames, 0);
}

/** Total frames for the entire story */
export function storyTotalFrames(): number {
  // Each chapter has its beats + 60 frames transition between chapters
  return STORY_CHAPTERS.reduce((sum, ch, i) => {
    return sum + chapterTotalFrames(ch) + (i < STORY_CHAPTERS.length - 1 ? 60 : 0);
  }, 0);
}

/** Given a global frame, find which chapter and local frame we're in */
export function frameToChapter(globalFrame: number): {
  chapter: StoryChapter;
  chapterIndex: number;
  localFrame: number;
  beatIndex: number;
  beatLocalFrame: number;
  isTransition: boolean;
  transitionProgress: number;
} {
  let remaining = globalFrame;

  for (let i = 0; i < STORY_CHAPTERS.length; i++) {
    const ch = STORY_CHAPTERS[i];
    const chFrames = chapterTotalFrames(ch);

    if (remaining < chFrames) {
      // We're in this chapter's beats
      let beatRemaining = remaining;
      for (let b = 0; b < ch.beats.length; b++) {
        if (beatRemaining < ch.beats[b].durationFrames) {
          return {
            chapter: ch,
            chapterIndex: i,
            localFrame: remaining,
            beatIndex: b,
            beatLocalFrame: beatRemaining,
            isTransition: false,
            transitionProgress: 0,
          };
        }
        beatRemaining -= ch.beats[b].durationFrames;
      }
    }
    remaining -= chFrames;

    // Transition period (60 frames)
    if (i < STORY_CHAPTERS.length - 1) {
      if (remaining < 60) {
        return {
          chapter: ch,
          chapterIndex: i,
          localFrame: chFrames,
          beatIndex: ch.beats.length - 1,
          beatLocalFrame: 0,
          isTransition: true,
          transitionProgress: remaining / 60,
        };
      }
      remaining -= 60;
    }
  }

  // Past the end — return last chapter
  const last = STORY_CHAPTERS[STORY_CHAPTERS.length - 1];
  return {
    chapter: last,
    chapterIndex: STORY_CHAPTERS.length - 1,
    localFrame: chapterTotalFrames(last),
    beatIndex: last.beats.length - 1,
    beatLocalFrame: 0,
    isTransition: false,
    transitionProgress: 0,
  };
}

/** Get the next chapter (for transitions) */
export function getNextChapter(index: number): StoryChapter | null {
  return index < STORY_CHAPTERS.length - 1 ? STORY_CHAPTERS[index + 1] : null;
}
