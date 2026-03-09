# Magic DAW — Session Handover (2026-03-09, Session 2)

## Current State

### Branch: `main`
### Latest commits (most recent first):
- `ee686b4` — feat: tab restructure — Chord Builder + Learn with sub-navigation
- `d6473bb` — docs: VISION.md — Music Theory Universe architecture & curriculum
- `280415a` — feat: horizontal interval strip, docs cleanup, handover
- `aeaa2f7` — feat: harmonic context strip HUD, interval trainer educational view
- `5af1280` — v1.0: GM synth, voice leading viz, deterministic pathfinder, chord debounce

### All changes are committed and pushed to remote.

---

## What Was Done This Session

### 1. Interval Trainer — Scale-Only Keyboard
Removed non-scale keys from the piano keyboard in `IntervalTrainer.tsx`. Now only shows keys that belong to the selected scale (equal-width blocks, no black/white distinction). Each key displays note name and interval label.

### 2. Triad Geometry Exploration (REVERTED)
Attempted to add triad triangles and diminished squares to the Circle of Fifths:
- First: on the main circle view (worked but hidden when path active due to `hasPath ? 0` opacity)
- Then: mini circles behind each path node (too small, hidden behind node decorations)
- Then: geometry lane below path (collided with voice leading visualization)
- Then: geometry lane above path (still hard to see at zoom level)
- **All geometry changes to CircleOfFifths1.tsx were reverted** via `git checkout`. The file is back to its committed state.
- **The concept is good but needs a dedicated view** — this became part of the VISION.md plan (Tonnetz and Circle Explorer are better homes for this geometry).

### 3. VISION.md — Comprehensive Architecture Document
Created `/Users/ayx106492/git/magic-daw/VISION.md` — the north star document for the project's evolution. Contains:

**Architecture:**
- Tab restructure: `ARRANGE | EDIT | MIX | INSTRUMENTS | PLUGINS | CHORD BUILDER | LEARN`
- Learn parent tab with sub-views: Circle Explorer, Interval Trainer, Tonnetz
- Chord Builder = existing circle path features refocused for composition

**Circle Explorer — 10 Progressive Interactive Lessons:**
1. Key Awareness ("Your Harmonic Home")
2. Relative Major/Minor ("The Mirror Connection")
3. Nashville Number System ("Universal Chord Language")
4. Secondary Dominants ("Harmonic Gravity Wells")
5. Tension & Release Chains ("The Cascade")
6. Pivot Chord Modulation ("The Bridge Between Worlds")
7. Modal Interchange ("Borrowing Color")
8. Chord Substitution ("The Art of Reharmonization")
9. Improv Guide Rails ("Safe Notes, Color Notes, Avoid Notes")
10. Song Analysis ("The Constellation Map" — capstone)

Each lesson has: beginner/intermediate/advanced tiers, visual approach (what to animate on the wheel), interactive exercises, MIDI validation logic, and gamification (bronze/silver/gold, streaks, speed bonuses).

**Tonnetz — Hexagonal Harmonic Lattice:**
- Three axes: fifths (horizontal), major thirds (NE-SW diagonal), minor thirds (NW-SE diagonal)
- Every triangle = a triad (upward = minor, downward = major)
- Neo-Riemannian operations P, L, R as triangle edge flips
- Compound operations: LR=dominant, RL=subdominant, PL/LP/PR/RP=chromatic mediants
- **Primary chord path builder** — click triangles to walk the lattice, see voice leading at each step
- Key region overlay (diatonic chords form a compact parallelogram)
- Modulation = translating the region across the grid
- Famous progression constellations, film score analysis mode

**Design Philosophy:**
- "Observatory Noir" — planetarium meets recording studio
- Remotion-first animation: spring physics, breathing idle states, particle trails, cinematic transitions
- 10 reusable animation patterns cataloged
- 4-phase implementation plan with projected file map

### 4. Phase 1: Tab Restructure (COMPLETED)
Implemented the new tab architecture:

**Files modified:**
- `types/daw.ts` — `ViewId` now: `'arrange' | 'edit' | 'mix' | 'instruments' | 'plugins' | 'chord-builder' | 'learn'`. Added `LearnSubView = 'circle' | 'intervals' | 'tonnetz'`
- `App.tsx` — 7 tabs instead of 8. Chord Builder (key 6) renders `<CircleOfFifthsPanel />`. Learn (key 7) renders `<LearnPanel />`. Removed 'visualizer' tab entirely. Updated sidebar exclusion logic.

**Files created:**
- `components/LearnPanel.tsx` — Parent panel with aurora glass sub-navigation bar. Contains 3 sub-views: Circle of Fifths (renders existing `CircleOfFifthsPanel`), Interval Trainer (renders `IntervalTrainerPanel`), Tonnetz (placeholder). Sub-nav has icons, labels, descriptions.

**Note:** The ChordVisualizerPanel import is still in App.tsx but no longer routed to any tab. It can be re-added later or removed.

---

## What's Next — Implementation Phases

### Phase 2: Circle Explorer (Next Priority)
Build the educational circle composition and lesson engine.

**New files to create:**
- `compositions/CircleExplorer.tsx` — New Remotion composition purpose-built for education (NOT reusing the 3500-line CircleOfFifths1.tsx). Clean circle with lesson overlay system, integrated piano keyboard, lesson text panel, score HUD
- `components/CircleExplorerPanel.tsx` — Panel wrapper with lesson state, MIDI validation, progress tracking
- `lib/lessonEngine.ts` — Lesson definitions, scoring logic, progress persistence
- `lib/chordDetection.ts` — Extract chord detection from CircleOfFifths1.tsx for reuse

**Key features per lesson:**
1. Wedge highlighting (diatonic region on circle)
2. Ghost ring overlay (modal interchange visualization)
3. Roman numeral labels + transposition rotation animation
4. Secondary dominant arrows + satellite markers
5. Cascade animation (dominant chains counter-clockwise)
6. Dual-wedge overlap (pivot chord modulation)
7. Piano keyboard with scale-degree coloring + MIDI input
8. Real-time scoring engine
9. Progress/streak/mastery tracking (localStorage)

**Update LearnPanel.tsx** to render `CircleExplorerPanel` instead of `CircleOfFifthsPanel` for the 'circle' sub-view.

**Estimated scope:** ~3000-4000 lines across 4+ files

### Phase 3: Tonnetz
Build the hexagonal lattice composition and chord path builder.

**New files to create:**
- `compositions/Tonnetz.tsx` — Remotion composition for the hex grid
- `components/TonnetzPanel.tsx` — Panel with path builder controls, play/loop/export
- `lib/tonnetz.ts` — Grid math, neo-Riemannian P/L/R operations, pathfinding
- `lib/tonnetzLayout.ts` — Hex grid → SVG coordinate mapping

**Key features:**
1. Hexagonal grid rendering (SVG) with 12 pitch classes
2. Triangle detection and click-to-select
3. P/L/R operation labels on shared edges
4. Click-to-walk path building
5. Path trail animation (particles along edges)
6. Key region overlay (diatonic parallelogram)
7. Voice leading indicators at each step
8. Integration with Chord Builder (export path)
9. Famous progression constellation library
10. Pathfinder suggestion engine (shortest walk between two triangles)

**Update LearnPanel.tsx** to render `TonnetzPanel` instead of placeholder for 'tonnetz' sub-view.

**Estimated scope:** ~2500-3500 lines across 4+ files

### Phase 4: Polish & Integration
- Two-way sync: Tonnetz ↔ Chord Builder
- Persistent progress tracking
- Adaptive difficulty
- Cross-module "daily practice" mode
- Shared Remotion animation library

---

## Key Architecture Notes

### Tab Routing
`App.tsx` line ~678: `renderView()` switch on `activeView: ViewId`. The Learn tab renders `<LearnPanel />` which manages its own sub-routing via `activeSubView: LearnSubView` state.

### Component Pattern
Every view follows: Panel component (state, MIDI, game logic) → Remotion composition (pure rendering). The `<Player>` renders inline with `controls={false}`, `ResizeObserver` matches dimensions.

### Bridge Messages (for new modules)
- `previewNote(note, velocity)` — play a note via GM synth
- `onMidiStateChange(listener)` — subscribe to live MIDI input
- `onSwiftMessage('chord_detected', cb)` — detected chord from Swift
- `onSwiftMessage('key_detected', cb)` — detected key/mode
- Full list in `bridge.ts`

### Existing Compositions to Study
- `CircleOfFifths1.tsx` (138KB) — the most complex. Has chord path, voice leading, branches, pathfinder, zoom system. Good reference but too large to extend — better to build CircleExplorer fresh.
- `IntervalTrainer.tsx` (16KB) — cleaner, more recent. Good pattern to follow for new educational compositions.

---

## File Quick Reference

| File | Purpose | Status |
|------|---------|--------|
| `VISION.md` | North star architecture document | **NEW** — committed |
| `types/daw.ts` | Core types, ViewId, LearnSubView | **Modified** |
| `App.tsx` | Tab routing, 7 tabs | **Modified** |
| `components/LearnPanel.tsx` | Learn tab parent with sub-nav | **NEW** — committed |
| `components/CircleOfFifthsPanel.tsx` | Circle + chord path (now in Chord Builder AND Learn) | Unchanged |
| `components/IntervalTrainerPanel.tsx` | Interval trainer (now under Learn) | Unchanged |
| `compositions/CircleOfFifths1.tsx` | Main circle composition | Unchanged (geometry reverted) |
| `compositions/IntervalTrainer.tsx` | Interval trainer composition | Modified (scale-only keyboard) |

---

## Important Context for Next Session

1. **VISION.md is the north star** — read it first. All design decisions should align with it.
2. **Phase 1 is DONE** — tabs are restructured, build passes, app runs.
3. **Phase 2 (Circle Explorer) is next** — build a NEW composition, don't extend CircleOfFifths1.tsx.
4. **The geometry idea (triad triangles, dim squares) belongs in Circle Explorer and Tonnetz** — not on the chord path nodes. Multiple attempts proved it's too cluttered on the path view.
5. **ChordVisualizerPanel is orphaned** — imported but no tab routes to it. Can be removed or re-integrated later.
6. **Root-level node_modules/** exists (from `sharp` dependency for icon rendering) — added to `.gitignore`, not committed.

---

## Build & Run

```bash
cd MagicDAW-UI && npm run dev    # UI hot reload
cd MagicDAW-UI && npm run build  # UI production
swift build                       # Swift app
make build                        # Both
```
