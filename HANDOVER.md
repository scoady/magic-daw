# Magic DAW — Session Handover (2026-03-09)

## Project Overview

Magic DAW is a macOS music production app (Swift/SwiftUI) with a React + Remotion web UI embedded via WKWebView. It features an interactive Circle of Fifths harmony explorer and an Interval Trainer for ear training — both powered by Remotion compositions with live MIDI input.

For full project structure, see `CLAUDE.md`.

---

## Current State

### Branch: `main`
### Latest Commits:
- `aeaa2f7` — feat: harmonic context strip HUD, interval trainer educational view
- `5af1280` — v1.0: GM synth, voice leading viz, deterministic pathfinder, chord debounce

### Uncommitted Changes
| File | Summary |
|------|---------|
| `compositions/IntervalTrainer.tsx` | Horizontal interval strip (was circular wheel), bigger key labels |

---

## What Was Built This Session

### 1. GM Synth Fallback
`Sampler.swift` loads the macOS built-in DLS soundbank so the app always plays audio without custom samples. All `hasSamples` guards removed.

### 2. Circle of Fifths — Core Features
- **Live chord path**: Play MIDI chords → nodes appear horizontally L→R
- **Debounced chord detection**: SETTLE_FRAMES=4 (~130ms) prevents key releases from creating spurious nodes. Uses note set tracking + pending chord settle timer
- **Full chord quality**: `detectChordFromNotes()` identifies maj7, m7, 7, dim7, m7b5, sus2/4, aug. `displayChord` on nodes shows full name
- **Voice leading viz**: Cyan = common tones, purple dashed = step motion between nodes
- **Deterministic pathfinder**: Beam search (width 50) with weighted harmonic + voice leading costs
- **Branch trees**: 3-tier rightward fan showing harmonic neighbors from any node
- **Famous progressions**: 18 progressions across genres with matching
- **Build Path UI**: FROM/TO selectors, STEPS slider, Generate + AI Suggest

### 3. Harmonic Context Strip HUD
Replaced the old in-viewBox piano overlay (which broke under zoom) with a separate SVG layer showing 7 diatonic degrees with Roman numerals, colored by function (tonic=cyan, subdominant=purple, dominant=gold). Lives outside the main viewBox so it stays anchored to screen space.

### 4. Interval Trainer (Educational View)
New Remotion composition accessible via key 8:
- **Horizontal interval strip**: 13 positions (unison→octave) with connection arcs
- **Piano keyboard**: In-scale keys labeled with interval names, prominent lettering
- **8 scale modes**: Major, Minor, Pentatonic, Blues, Dorian, Mixolydian, Chromatic, Perfect Fifths
- **Explore mode**: Click buttons to hear interval previews via GM synth
- **Quiz mode**: App prompts intervals, player responds via MIDI, score tracking

---

## Key Architecture Decisions

### Chord Release Detection
MIDI notes arrive one-at-a-time across frames. Releasing a chord produces subsets that can be misidentified. Four approaches were tried:
1. One-frame guard — too narrow
2. High water mark — edge cases with bridge events
3. Note set tracking alone — fast players still got spurious nodes
4. **Debounced settle timer (final)** — waits 130ms after last new note

### SVG Zoom & HUD Layers
Circle of Fifths uses dynamic `viewBox` for zoom (via `useCircleZoom.ts`). HUD elements inside the viewBox get scaled with content. The Harmonic Context Strip uses a **separate SVG** with fixed viewBox, absolutely positioned, staying in screen space.

### Remotion Player Pattern
Both compositions follow the same pattern:
1. Panel component (`*Panel.tsx`) — game logic, state, MIDI subscriptions
2. Composition (`compositions/*.tsx`) — pure Remotion component receiving props
3. `<Player>` renders inline (not iframe) with `controls={false}`
4. `ResizeObserver` matches composition dimensions to container

---

## File Quick Reference

| File | Purpose |
|------|---------|
| `compositions/CircleOfFifths1.tsx` | Main circle SVG composition (~3500+ lines) |
| `compositions/IntervalTrainer.tsx` | Interval trainer composition |
| `compositions/useCircleZoom.ts` | Zoom state machine |
| `components/CircleOfFifthsPanel.tsx` | Circle panel + chord detection + build path UI |
| `components/IntervalTrainerPanel.tsx` | Trainer panel + quiz logic |
| `bridge.ts` | Swift ↔ JS message bridge |
| `types/daw.ts` | Core types (ViewId, DAWState, etc.) |
| `App.tsx` | Root app with tab routing |

---

## Known Issues / Technical Debt

1. **CircleOfFifths1.tsx is very large** (~3500+ lines) — pathfinder, voice leading, branches could be extracted
2. **No tests** for harmonic pathfinder — complex enough to warrant unit tests
3. **AI Suggest** relies on local Ollama at `http://DESKTOP-D4U6J5M:11434`
4. **`sharp`** dependency is only needed for icon rendering — should be devDependency

---

## Suggested Next Steps

- **Extract pathfinder** into `src/lib/harmonicPathfinder.ts` for testability
- **Chord progression library** — save/load/share discovered progressions
- **Scale degree ear training** — identify degrees, not just intervals
- **Rhythm trainer** — similar educational view for rhythmic patterns
- **MIDI export** — save chord paths as standard MIDI files
- **Path editing** — drag-and-drop reordering of chord path nodes
- **Undo/redo** for chord path operations

---

## Build & Run

```bash
cd MagicDAW-UI && npm run dev    # UI hot reload
cd MagicDAW-UI && npm run build  # UI production
swift build                       # Swift app
make build                        # Both
```
