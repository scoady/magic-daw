# Magic DAW — Vision: The Music Theory Universe

> *"A planetarium meets a recording studio — where harmony becomes visible, tangible, and unforgettable."*

---

## The Big Idea

Magic DAW evolves from a DAW with theory features into a **music theory universe** — an interconnected system of visual tools where every concept is audible, visible, and playable simultaneously. Three modalities, always: **see it on screen, hear it through speakers, play it on the keyboard.**

The app splits into two modes:

1. **Create** — composition tools (Arrange, Edit, Mix, Instruments, Plugins, Chord Builder)
2. **Learn** — interactive theory education (Circle Explorer, Interval Trainer, Tonnetz, future modules)

Every learning tool feeds into every creation tool. Learn a progression on the Tonnetz → export it to the Chord Builder → arrange it in the timeline. The boundary between learning and creating dissolves.

---

## Design Philosophy

### Aesthetic: Observatory Noir

The visual language is **observatory noir** — the feeling of standing in a dark planetarium watching constellations form. Every visualization is a star map of harmonic space.

- **Dark void** (`#0a0e1a`) as infinite canvas — elements float in space
- **Neon constellations** — cyan (`#67e8f9`) for tonic/consonance, purple (`#a78bfa`) for color/tension, gold (`#fbbf24`) for active/highlighted, pink (`#f472b6`) for dissonance/warning
- **Frosted glass panels** — UI chrome is translucent, never opaque. The visualization breathes behind controls
- **Particle systems** — notes are not static dots but living particles that pulse, drift, attract, and repel
- **Depth through blur** — inactive elements recede with gaussian blur; active elements are razor sharp

### Animation Philosophy: Remotion-First

Every view is a Remotion composition. This means:
- **Frame-based animation** — smooth 30fps interpolation for all state changes
- **Spring physics** — chord changes trigger spring animations, not instant snaps
- **Breathing** — even idle states have subtle sine-wave motion (pulse, drift, orbit)
- **Cinematic transitions** — switching between lessons uses crossfade/zoom transitions
- **Trail effects** — moving elements leave fading afterimages (chord paths on Tonnetz, note trails on keyboard)

### Typography

- **Labels/Data**: `JetBrains Mono` or system monospace — precise, technical, legible at small sizes
- **Lesson Headings**: Consider `Playfair Display` or `Cormorant Garamond` for editorial warmth in lesson text — music education should feel inviting, not clinical
- **Scale degrees/Roman numerals**: Bold monospace with the chord's function color

### Interaction Model

- **MIDI keyboard** is the primary input for all exercises
- **Click/hover** on visualizations as secondary input
- **Always accept inversions** — validate by pitch-class set, never penalize voicing choices
- **200ms tolerance** on timing-based exercises
- **Immediate audio feedback** — every interaction produces sound via GM synth

---

## Tab Architecture

### Top-Level Navigation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ARRANGE  EDIT  MIX  INSTRUMENTS  PLUGINS  CHORD BUILDER  LEARN           │
│                                                            ▼               │
│                                              ┌──────────────────────────┐  │
│                                              │ ◉ Circle    ◉ Intervals │  │
│                                              │ ◉ Tonnetz   ◉ More...  │  │
│                                              └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### ViewId Changes

```typescript
// Old
type ViewId = 'arrange' | 'edit' | 'mix' | 'instruments' | 'plugins' | 'visualizer' | 'circle' | 'trainer';

// New
type ViewId = 'arrange' | 'edit' | 'mix' | 'instruments' | 'plugins' | 'chord-builder' | 'learn';
type LearnSubView = 'circle' | 'intervals' | 'tonnetz';
```

### Component Hierarchy

```
App.tsx
├── ArrangeView          (key 1)
├── EditView             (key 2)
├── MixView              (key 3)
├── InstrumentView       (key 4)
├── PluginView           (key 5)
├── ChordBuilderPanel    (key 6) — current CircleOfFifthsPanel chord path features
└── LearnPanel           (key 7) — parent with sub-navigation
    ├── CircleExplorerPanel    → CircleExplorer.tsx (Remotion)
    ├── IntervalTrainerPanel   → IntervalTrainer.tsx (Remotion) [exists]
    └── TonnetzPanel           → Tonnetz.tsx (Remotion)
```

### Learn Panel Sub-Navigation

The Learn tab has a **sidebar course menu** (left, 200px) with:
- Module icons + titles
- Progress indicators (bronze/silver/gold per lesson)
- Expandable lesson lists within each module

The main area is the Remotion composition + exercise controls.

---

## Module 1: Circle of Fifths Explorer

### Purpose

Transform the circle of fifths from a static diagram into a **living, interactive theory teacher**. Each lesson uses the same animated wheel but highlights different relationships, plays different examples, and poses different challenges.

### Composition: `CircleExplorer.tsx`

A new Remotion composition (not the existing CircleOfFifths1.tsx) purpose-built for education:

- **Clean circle** with outer (major), inner (minor), and center (diminished) rings
- **Lesson overlay system** — each lesson adds/removes visual layers (wedges, arrows, ghost rings, connectors)
- **Integrated piano keyboard** at bottom — scale-degree colored keys, MIDI input
- **Lesson text panel** — right side, frosted glass, with instructions, hints, and feedback
- **Score/progress HUD** — top right

### Lesson Curriculum

**Suggested order (progressive difficulty):**

#### Lesson 1: Key Awareness — "Your Harmonic Home"
- **Objective:** Given any key, identify all 7 diatonic chords
- **Visual:** Tap a key → a luminous "wedge" (7 contiguous segments) lights up. Major chords glow teal, minors glow purple, diminished glows pink
- **Exercise (Beginner):** App highlights C major. Play the I, IV, V chords on MIDI. Circle segments "collect" as you play them
- **Exercise (Intermediate):** "Play the ii chord in Bb major." Student plays Cm. Circle confirms
- **Exercise (Advanced):** App plays a diatonic progression → student identifies the key by clicking the circle. Shorter excerpts = harder
- **MIDI Validation:** Detect chord from note-on messages, compare pitch-class set against expected. Accept inversions. Partial credit for correct root/wrong quality

#### Lesson 2: Relative Major/Minor — "The Mirror Connection"
- **Objective:** Understand that every major key shares notes with a relative minor
- **Visual:** Glowing connector line between outer and inner ring (C ↔ Am). Animate "mode switch" — tonic marker slides between rings while highlighted notes stay identical
- **Exercise (Beginner):** App highlights major key → student clicks its relative minor (3 positions clockwise on inner ring). Play both scales to hear same notes, different mood
- **Exercise (Intermediate):** App plays a melody → is it major or its relative minor? Click the correct ring
- **Exercise (Advanced):** Play a phrase that starts in major, ends in relative minor. App analyzes where the tonal center shifted

#### Lesson 3: Nashville Number System — "Universal Chord Language"
- **Objective:** Think in Roman numerals. Transpose instantly by rotating the mental frame
- **Visual:** Roman numeral labels (I–vii°) overlaid on the diatonic wedge. When transposing, the **entire labeled wedge rotates smoothly** to the new key — note names change, numbers stay fixed. This is the core "aha" animation
- **Number line** below circle: `| I | ii | iii | IV | V | vi | vii° |` updating live
- **Exercise (Beginner):** App displays "1 - 5 - 6 - 4" and a key. Student plays the chords
- **Exercise (Intermediate):** App plays a progression in G. Student writes it as numbers. Then "now in Eb" — play the same numbers transposed. Watch the wheel rotate
- **Exercise (Advanced):** "Chart reading" — Nashville chart scrolls by, student plays along in real time. Tempo increases

#### Lesson 4: Secondary Dominants — "Harmonic Gravity Wells"
- **Objective:** Any diatonic chord can be "tonicized" by preceding it with its own dominant
- **Visual:** From each diatonic chord, draw a "gravity arrow" one step clockwise (its V). Each secondary dominant gets a "satellite" marker orbiting its target. When played, the target pulses with anticipation. On resolution, a satisfying "lock-in" animation plays
- **Color arrows by tension:** V/V (common, green) through V/iii (rare, red)
- **Exercise (Beginner):** "What is V/V in C?" Student reasons: V of C = G, V of G = D major. Play D major
- **Exercise (Intermediate):** App plays a progression with a secondary dominant. Identify which chord was tonicized
- **Exercise (Advanced):** "Tonicization sprint" — app names a chord, student plays its secondary dominant within time limit, then resolves. Speed scoring

#### Lesson 5: Tension & Release Chains — "The Cascade"
- **Objective:** Dominant chains (each resolving down a fifth) create cascading tension pulling toward tonic
- **Visual:** Animate a glowing cascade moving counter-clockwise around the circle. Each step lights up as a dominant 7th, then resolves to the next. Show a spiral tightening toward tonic — "gravitational pull." Closer to home = brighter + more energetic
- **Exercise (Beginner):** App plays E7. Student resolves to Am. Chain continues: A7→D, D7→G, G7→C. Play each resolution as the circle animates
- **Exercise (Intermediate):** "How far can you chain?" Build a dominant chain backward from a random point, then resolve all the way home. Longer = higher score
- **Exercise (Advanced):** App plays a jazz turnaround. Trace the dominant chain on the circle in real time, then replicate on keyboard

#### Lesson 6: Pivot Chord Modulation — "The Bridge Between Worlds"
- **Objective:** Use chords common to two keys as bridges for smooth modulation
- **Visual:** Two overlapping wedges (origin + destination key). Overlap region = pivot chord candidates, pulsing bright. Animated particle travels from origin tonic → through pivot → to destination tonic. Venn diagram inset showing shared chords
- **Exercise (Beginner):** Given two keys → find all shared chords by playing them. Each correct one lights up
- **Exercise (Intermediate):** Play a 4-chord progression: start in origin, use a pivot, cadence in destination (V-I in new key)
- **Exercise (Advanced):** "Modulation chain" — modulate through 3-4 keys, choosing the smoothest pivot each time

#### Lesson 7: Modal Interchange — "Borrowing Color"
- **Objective:** Chords from parallel modes add emotional color
- **Visual:** Base diatonic wedge + translucent "ghost wedge" for the parallel mode. Only the borrowed chord segment is opaque. Animate a bridge from the borrowed position to its landing spot. Color-code by mode: Dorian=blue, Mixolydian=orange, Aeolian=purple
- **Exercise (Beginner):** App plays C major progression, swaps IV (F) for iv (Fm). Identify which chord changed
- **Exercise (Intermediate):** "Darken this progression" — choose a borrowed chord from the ghost ring
- **Exercise (Advanced):** Analyze a pop song with known borrowed chords. Map the full progression, flag which are borrowed and from which mode

#### Lesson 8: Chord Substitution — "The Art of Reharmonization"
- **Objective:** Replace chords with functionally equivalent alternatives
- **Visual (Diatonic subs):** Functional groups highlighted: Tonic (I, iii, vi), Subdominant (ii, IV), Dominant (V, vii°). Same-group chords share a color
- **Visual (Tritone subs):** Line across the circle's diameter. The 3rd and 7th of both dominants are the same two notes, just swapped — animate this shared tritone
- **Exercise (Beginner):** App plays I-IV-V-I. Replace V with vii°. Then replace I with vi
- **Exercise (Intermediate):** Apply tritone sub to a ii-V-I (Db7 instead of G7). See the chromatic bass line: D-Db-C
- **Exercise (Advanced):** "Reharmonization challenge" — given a 4-chord progression, create an alternate version with 2+ substitutions

#### Lesson 9: Improv Guide Rails — "Safe Notes, Color Notes, Avoid Notes"
- **Objective:** Know which notes work over each chord
- **Visual:** Piano keyboard color-codes all 12 notes: chord tones=bright teal, tensions=soft purple, avoid notes=dim red. Circle highlights the "neighborhood" — adjacent segments = related scales. "Safety meter" moves green→yellow→red as student ventures further from chord tones
- **Exercise (Beginner):** Chord sustains. Explore keyboard freely with real-time color feedback. Play a 4-note phrase using only chord tones
- **Exercise (Intermediate):** Improv over a two-chord vamp. Real-time scoring: chord tones=3pts, tensions=1pt, avoid notes=-1pt
- **Exercise (Advanced):** ii-V-I cycles. Must "target" specific chord tones on beat 1 of each change. Rhythm game meets jazz improv

#### Lesson 10: Song Analysis — "The Constellation Map" (Capstone)
- **Objective:** Map real progressions on the circle, understand why they work
- **Visual:** Glowing dot traces a path in real time as progression plays, connecting chords with directional arrows. Result is a "constellation." Common patterns produce recognizable shapes. Label each movement: "fifth drop," "step up," "borrowed," "tritone sub." Heat map: most-visited segments glow brightest
- **Exercise (Beginner):** Play a well-known song (Let It Be = I-V-vi-IV). Click chords on circle in order. App explains: "The path stays within the diatonic wedge — that's why it sounds stable"
- **Exercise (Intermediate):** Progression with a borrowed chord. Trace the path AND identify the non-diatonic chord
- **Exercise (Advanced):** Student inputs their own progression via MIDI. App analyzes, traces, suggests modifications

### Gamification

- **3 tiers per lesson** (bronze/silver/gold) — unlock next tier by scoring above threshold
- **Streak bonuses** for consecutive correct answers
- **Speed bonuses** within time windows
- **Circle Mastery Map** — persistent overview showing which concepts are covered. Aim for full illumination

---

## Module 2: Tonnetz — The Harmonic Lattice

### Purpose

The Tonnetz reveals what the circle of fifths hides: **third-based relationships** (chromatic mediants, hexatonic poles) that drive Romantic, film, and modern pop harmony. It also becomes the **primary chord path builder**, replacing the beam-search pathfinder with a visual, spatial experience.

### The Geometry

A hexagonal grid where every note is surrounded by 6 neighbors:

```
 Three axes:
 ─────────── Horizontal: Perfect fifths (7 semitones)
 ╲           Northeast-Southwest: Major thirds (4 semitones)
  ╲          Northwest-Southeast: Minor thirds (3 semitones)
```

**Every triangle is a triad:**
- Downward-pointing triangles → **major triads**
- Upward-pointing triangles → **minor triads**

**Grid layout (center section):**
```
Row 4:    Ab ─── Eb ─── Bb ─── F  ─── C  ─── G  ─── D
         ╱ ╲   ╱ ╲   ╱ ╲   ╱ ╲   ╱ ╲   ╱ ╲   ╱ ╲
Row 3:  E  ─── B  ─── F# ─── C# ─── G# ─── D# ─── A#
         ╲ ╱   ╲ ╱   ╲ ╱   ╲ ╱   ╲ ╱   ╲ ╱   ╲ ╱
Row 2:    C  ─── G  ─── D  ─── A  ─── E  ─── B  ─── F#
         ╱ ╲   ╱ ╲   ╱ ╲   ╱ ╲   ╱ ╲   ╱ ╲   ╱ ╲
Row 1:  Ab ─── Eb ─── Bb ─── F  ─── C  ─── G  ─── D
         ╲ ╱   ╲ ╱   ╲ ╱   ╲ ╱   ╲ ╱   ╲ ╱   ╲ ╱
Row 0:    E  ─── B  ─── F# ─── C# ─── G# ─── D# ─── A#
```

The grid wraps toroidally (donut-shaped): 12 fifths horizontally, 3 major thirds vertically, 4 minor thirds diagonally.

### Neo-Riemannian Operations (P, L, R)

Each takes a triad and transforms it by **moving one note by 1-2 semitones** — equivalent to **flipping a triangle across one of its edges**:

| Operation | Shared Edge | Moving Note | Semitones | Example |
|-----------|------------|-------------|-----------|---------|
| **P** (Parallel) | Root + Fifth | Third | 1 | C major → C minor |
| **R** (Relative) | Root + Third | Fifth | 2 | C major → A minor |
| **L** (Leading-tone) | Third + Fifth | Root | 1 | C major → E minor |

**Compound operations:**
| Compound | Net Motion | Example | Musical Name |
|----------|-----------|---------|-------------|
| **LR** | Up a fifth | C maj → G maj | Dominant |
| **RL** | Down a fifth | C maj → F maj | Subdominant |
| **PL** | Down major 3rd | C maj → Ab maj | Chromatic mediant |
| **LP** | Up major 3rd | C maj → E maj | Chromatic mediant |
| **PR** | Up minor 3rd | C maj → Eb maj | Chromatic mediant |
| **RP** | Down minor 3rd | C maj → A maj | Chromatic mediant |

### Tonnetz as Chord Path Builder

**This is the killer feature.** Instead of typing "from C to F# in 6 steps" into a text box and getting a list, users **walk the Tonnetz** to build progressions:

#### How It Works

1. **Click a triangle** → that chord becomes the first node in the path
2. **Adjacent triangles highlight** showing all possible next moves (P, L, R + compounds)
3. **Click the next triangle** → the edge between them glows, showing the voice leading (which note moved, by how much)
4. **Repeat** → the path traces a visible route across the lattice
5. **Below the Tonnetz:** the horizontal chord path view (from current Chord Builder) shows the constructed progression with play/loop/export controls

#### Visual Design

- **Idle state:** Faint hexagonal grid, all 12 pitch classes visible as nodes, triangles subtly outlined
- **Active chord:** Triangle fills with bright color, vertices (chord tones) glow, the 3 notes play via GM synth
- **Path trail:** Edges along the path glow with animated particles flowing in the direction of travel. Past chords dim but remain visible. The trail creates a "constellation" across the lattice
- **Key region overlay:** A translucent colored region shows where the current diatonic key lives on the grid. When the path leaves this region, the boundary pulses — "you're borrowing!"
- **Neo-Riemannian labels:** Each possible move shows a small P/L/R label on the shared edge, plus the resulting chord name
- **Voice leading indicators:** At each step, show which note moves and by how many semitones (tiny animated arrow on the moving vertex)

#### Pathfinder Integration

The existing beam-search pathfinder becomes a **suggestion engine** on the Tonnetz:
- User picks Start and End triangles
- Algorithm finds the shortest/smoothest walk
- The suggested path **animates across the grid** step by step
- User can modify the path by dragging waypoints to different triangles

#### Common Progressions as Paths

Visualize these as pre-built "constellations" users can load and study:

- **I-V-vi-IV** (C-G-Am-F): Compact diamond shape — all chords cluster tightly around C and the C-E edge. Visual compactness = why it sounds smooth
- **ii-V-I** (Dm-G-C): Straight diagonal walk descending by fifths. Jazz musicians think of it as a single unit — geometrically, it IS a straight line
- **I-vi-ii-V** (C-Am-Dm-G): Zigzag descending by fifths, alternating major-minor via R. Sawtooth wave pattern = strong forward momentum
- **I-IV-V-I** (C-F-G-C): Horizontal oscillation along the fifths axis: left, jump right, return center

### Educational Features

#### "Why Does This Sound Good?"
Select any two chords → the Tonnetz shows:
- **Shared vertices** = common tones (count them)
- **Edge distance** = voice leading cost
- **Same region?** = diatonic vs. chromatic relationship

#### Modulation Visualization
A diatonic key occupies a **compact parallelogram** on the Tonnetz (7 adjacent triangles). Modulation = **translating this region**:
- To the dominant: shift 1 step right (1 note changes: F→F# for C→G)
- To relative minor: region stays put, tonic marker shifts
- To parallel minor: diagonal shift (3 notes change)
- To chromatic mediant: large diagonal jump (dramatic sound = large visual distance)

#### Film Score Analysis Mode
Load famous progressions from film scores and watch them trace paths:
- Chromatic mediants (Hans Zimmer) = diagonal jumps
- Minor-third chains (Inception) = straight vertical lines
- Fifths chains (John Williams) = horizontal walks

---

## Module 3: Interval Trainer (Exists — Polish)

Already built. Enhancements for the Learning tab integration:

- **Progress persistence** — track which intervals the student has mastered across sessions
- **Adaptive difficulty** — if student nails P5 consistently, stop quizzing it, focus on weak intervals
- **Contextual mode** — "Practice the intervals in today's Circle Explorer lesson key"
- **Singing mode** (future) — mic input for sing-the-interval exercises

---

## Chord Builder (Refocused)

The current CircleOfFifthsPanel chord path features move here as a **pure composition tool**:

- Horizontal chord path with voice leading visualization
- Branch tree navigation (harmonic neighbors)
- Pathfinder (deterministic beam search)
- Famous progression matching
- Play/loop/export controls
- Import/export MIDI
- Tension arc visualization
- Right-click delete

**New:** Receive progressions from the Tonnetz path builder. Two-way sync — build a path on the Tonnetz, see it appear in the Chord Builder. Edit in either view.

---

## Implementation Plan

### Phase 1: Tab Restructure (Foundation)
**Files to modify:**
- `types/daw.ts` — update `ViewId`, add `LearnSubView`
- `App.tsx` — restructure tabs, add Learn parent with sub-nav
- Move `CircleOfFifthsPanel` chord path features → new `ChordBuilderPanel`

**New files:**
- `components/LearnPanel.tsx` — parent panel with sub-navigation
- `components/ChordBuilderPanel.tsx` — refocused chord composition tool

**Estimated scope:** ~200 lines new, ~100 lines modified

### Phase 2: Circle Explorer
**New files:**
- `compositions/CircleExplorer.tsx` — new Remotion composition for education
- `components/CircleExplorerPanel.tsx` — panel with lesson state, MIDI validation
- `lib/lessonEngine.ts` — lesson definitions, scoring logic, progress tracking
- `lib/chordDetection.ts` — extracted from CircleOfFifths1.tsx for reuse

**Key features to build per lesson:**
1. Lesson text/instruction overlay system
2. Wedge highlighting (diatonic region)
3. Ghost ring overlay (modal interchange)
4. Roman numeral labels + transposition animation
5. Secondary dominant arrows + satellite markers
6. Cascade animation (dominant chains)
7. Dual-wedge overlap (pivot modulation)
8. Piano keyboard with scale-degree coloring
9. Real-time MIDI scoring engine
10. Progress/streak/mastery tracking

**Estimated scope:** ~3000-4000 lines across files

### Phase 3: Tonnetz
**New files:**
- `compositions/Tonnetz.tsx` — Remotion composition for the hexagonal lattice
- `components/TonnetzPanel.tsx` — panel with path builder controls
- `lib/tonnetz.ts` — grid math, neo-Riemannian operations, pathfinding
- `lib/tonnetzLayout.ts` — hex grid → SVG coordinate mapping

**Key features:**
1. Hexagonal grid rendering (SVG)
2. Triangle detection and highlighting
3. P/L/R operation labels on edges
4. Click-to-build path interaction
5. Path trail animation (particles along edges)
6. Key region overlay (diatonic parallelogram)
7. Voice leading indicators (vertex animations)
8. Pathfinder integration (Tonnetz-aware shortest path)
9. Chord path export to Chord Builder
10. Famous progression constellation library
11. Film score analysis presets

**Estimated scope:** ~2500-3500 lines across files

### Phase 4: Polish & Integration
- Two-way sync between Tonnetz and Chord Builder
- Persistent progress tracking across sessions (localStorage or Swift bridge)
- Adaptive difficulty engine
- Cross-module "daily practice" mode
- Shared animation library for consistent Remotion effects

---

## Remotion Animation Catalog

Reusable animation patterns across all modules:

| Animation | Usage | Technique |
|-----------|-------|-----------|
| **Spring snap** | Chord selection, node activation | `spring()` with damping 12, stiffness 80 |
| **Pulse breathe** | Idle states, active nodes | `sin(frame * 0.06)` modulating opacity/radius |
| **Cascade glow** | Dominant chains, path traversal | Sequential `interpolate()` with staggered delays |
| **Wedge sweep** | Key highlighting, diatonic region | Animated SVG arc from 0° to wedge angle |
| **Ghost fade** | Modal interchange, borrowed chords | Opacity interpolation with gaussian blur |
| **Particle flow** | Path trails, voice leading | Frame-based position along bezier path |
| **Ripple burst** | Correct answer, achievement | Expanding circle with opacity decay |
| **Spiral tighten** | Tension chains toward tonic | Decreasing radius with frame-based rotation |
| **Constellation trace** | Song analysis path | Sequential line drawing with glow trail |
| **Wheel rotate** | Nashville transposition | Smooth rotation of the entire circle group |

---

## File Map (Projected)

```
MagicDAW-UI/src/
├── App.tsx                              (modified — new tab structure)
├── types/daw.ts                         (modified — new ViewId, LearnSubView)
├── bridge.ts                            (unchanged)
│
├── components/
│   ├── LearnPanel.tsx                   (NEW — parent with sub-nav)
│   ├── CircleExplorerPanel.tsx          (NEW — lesson state + MIDI validation)
│   ├── TonnetzPanel.tsx                 (NEW — path builder controls)
│   ├── ChordBuilderPanel.tsx            (NEW — refocused from CircleOfFifthsPanel)
│   ├── IntervalTrainerPanel.tsx         (move under Learn)
│   ├── CircleOfFifthsPanel.tsx          (keep for Chord Builder internals)
│   └── ... (existing panels unchanged)
│
├── compositions/
│   ├── CircleExplorer.tsx               (NEW — educational circle Remotion comp)
│   ├── Tonnetz.tsx                      (NEW — hexagonal lattice Remotion comp)
│   ├── IntervalTrainer.tsx              (exists — minor enhancements)
│   ├── CircleOfFifths1.tsx              (exists — used by Chord Builder)
│   └── ... (existing compositions unchanged)
│
├── lib/
│   ├── lessonEngine.ts                  (NEW — lesson definitions, scoring, progress)
│   ├── tonnetz.ts                       (NEW — grid math, P/L/R operations)
│   ├── tonnetzLayout.ts                 (NEW — hex grid → SVG coordinates)
│   ├── chordDetection.ts               (NEW — extracted from CircleOfFifths1)
│   ├── musicTheory.ts                   (NEW — shared theory utils)
│   └── animations.ts                    (NEW — reusable Remotion animation helpers)
│
└── views/
    └── ... (existing views unchanged)
```

---

## Success Metrics

The vision is realized when:

1. **A complete beginner** can open the Learn tab and, guided by the Circle Explorer, understand key signatures, diatonic chords, and basic progressions within 30 minutes
2. **An intermediate musician** can use the Tonnetz to discover chord progressions they would never have found on a keyboard alone, because the geometric relationships suggest moves they wouldn't have considered
3. **An advanced composer** can analyze any song's harmonic structure visually, seeing the constellation pattern on both the circle and the Tonnetz, understanding instantly why it works
4. **Everyone** says "I've never seen anything like this" — because the visual quality, animation polish, and interactivity are genuinely unprecedented in music education software

---

*This document is the north star. Every implementation decision should be checked against this vision. When in doubt: make it more visual, more audible, more interactive, more beautiful.*
