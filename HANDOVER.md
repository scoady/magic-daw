# Magic DAW — Session Handover (2026-03-09)

## Project Overview

Magic DAW is a macOS music production app (Swift/SwiftUI) with a React + Remotion web UI embedded via WKWebView. The UI features a Circle of Fifths interactive composition tool that lets users build chord progressions through MIDI input, branch exploration, and algorithmic path generation.

For full project structure, see `/Users/ayx106492/git/magic-daw/CLAUDE.md`.

---

## Current State

### Uncommitted Changes (~3080 lines across 10 files)

These changes are staged/modified but **not yet committed**:

| File | Summary |
|------|---------|
| `MagicDAW/Audio/Sampler.swift` | GM synth fallback via AVAudioUnitSampler |
| `MagicDAW/Views/WebViewBridge.swift` | Removed hasSamples guards |
| `MagicDAW/Views/MainWindow.swift` | NoContextMenuWebView, WKUserScript injection |
| `MagicDAW-UI/src/compositions/CircleOfFifths1.tsx` | Voice leading viz, pathfinder algorithm, branch spacing, right-click delete |
| `MagicDAW-UI/src/compositions/useCircleZoom.ts` | Zoom refinements |
| `MagicDAW-UI/src/components/CircleOfFifthsPanel.tsx` | Build Path UI, chord release fix |
| `MagicDAW-UI/src/compositions/AppIcon.tsx` | Full-bleed background |
| `MagicDAW-UI/package.json` / `package-lock.json` | Added `sharp` dependency (for icon rendering) |
| `Resources/AppIcon.icns` | Regenerated icon (no white border) |
| `scripts/render-icon.mjs` | New — SVG → PNG → .icns pipeline |

### Branch: `main`
### Last Commit: `e8fc274` — feat: key selector, scale piano overlay, branch hover tooltips

---

## What Was Done This Session

### 1. GM Synth Fallback (Audio)
**Problem:** No audio playback without custom samples loaded.
**Solution:** Added `AVAudioUnitSampler` to `Sampler.swift` that loads the macOS built-in General MIDI DLS soundbank at `/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls`. When no custom sample buffers exist for a note, playback falls back to GM piano. `ensureEngineRunning()` lazily starts `AVAudioEngine` on the first GM note. All `hasSamples` guards were removed from `WebViewBridge.swift` so the sampler always plays.

### 2. Chord Release Bug Fix
**Problem:** Releasing keys from a chord triggered spurious node creation (each key-up reduced `activeNotes`, causing `inferDiatonicChord` to fire on the remaining subset).
**Solution:** Added `prevNoteCountRef` to `CircleOfFifthsPanel.tsx`. When `activeNotes.length < prevCount`, the change is a release, not a new chord — skip inference.

### 3. Voice Leading Visualization
Added `<VoiceLeadingViz>` components between each pair of chord path nodes in `CircleOfFifths1.tsx`. Shows chord tones stacked vertically with neon glow effects:
- **Cyan solid lines** = common tones (notes shared between chords)
- **Purple dashed curves** = step motion (notes that move by step)
- `chordToMidi()` converts chord names to MIDI note arrays
- Voice pairing algorithm matches notes by proximity (minimum semitone distance)
- Hover tooltip system using `hoveredVL` state

### 4. Deterministic Harmonic Pathfinder
Added `findHarmonicPath()` — a beam search (width 50) over the graph of all 24 major/minor triads:
- **Edge weights:** fifths=1, relative=1.5, parallel=2, stepwise=2.5, chromatic mediant=3, tritone=4
- **Voice leading cost** multiplied by 0.5 and added to harmonic cost
- Helper functions: `harmonicNeighbors()`, `voiceLeadingCost()`, `chordToFifthsPosition()`
- Deterministic: same FROM/TO/STEPS always produces the same path

### 5. Build Path UI (CircleOfFifthsPanel.tsx)
New panel section with:
- FROM/TO chord selectors (all 24 major + minor triads)
- STEPS slider (3-12)
- **Generate** button — uses the deterministic pathfinder (instant)
- **AI Suggest** button — sends prompt to Ollama via `ai.chat` bridge message
- Live preview updates as parameters change
- Mini circle-of-fifths SVG showing the geometric shape of the generated path

### 6. Right-Click Delete
- `NoContextMenuWebView` subclass in `MainWindow.swift` suppresses the native macOS context menu
- JS `contextmenu` event prevention injected via `WKUserScript` at document start
- `onContextMenu` handlers on path nodes call `onDeleteNode`

### 7. Branch Node Improvements
- Increased spacing: r1=160, r2=240, r3=320 (× scale)
- Bigger nodes: tier1=14, tier2=10, tier3=8 (× scale)
- Fat invisible hit areas (20px stroke + 3.5× radius)
- PATH_STEP_X increased to 190

### 8. App Icon Fix
- Changed background from circle (r=480) to full-bleed rectangle — eliminates white border
- Created `scripts/render-icon.mjs` (Node.js + sharp) to render SVG → PNG → `.icns`

---

## Key Architecture Notes

### Audio Pipeline
```
AVAudioEngine
├── mainMixerNode → outputNode
│   ├── Sampler (custom PCM buffers with pitch shifting)
│   │   └── AVAudioUnitSampler (GM synth fallback)
│   ├── Track mixers → EffectsChain per track
│   └── Metronome
└── MIDIManager (CoreMIDI)
    ├── onNoteOn → Sampler + MIDIRecorder + JS + MIDIRouter
    └── onNoteOff → Sampler + MIDIRecorder + JS
```

### JS ↔ Swift Bridge
- **JS→Swift:** `window.webkit.messageHandlers.magicdaw.postMessage({type, payload})`
- **Swift→JS:** `webView.evaluateJavaScript("window.onSwiftEvent(...)")`
- Key message types: `instrument.previewNote`, `midi.noteOn/Off`, `transport.*`, `project.*`, `ai.chat`

### Circle of Fifths Component Hierarchy
```
CircleOfFifthsPanel.tsx (controls + build path UI)
└── CircleOfFifths1.tsx (SVG composition, ~3500+ lines)
    ├── Circle rings (major/minor/diminished)
    ├── Chord path (L→R) with VoiceLeadingViz between nodes
    ├── Branch tree (3-tier rightward fan)
    ├── Tension arcs, loop brackets, directional guides
    └── useCircleZoom.ts (zoom state machine)
```

---

## Known Issues / Technical Debt

1. **CircleOfFifths1.tsx is very large** (~3500+ lines). The pathfinder, voice leading, and branch rendering could be extracted into separate modules.
2. **No tests** for the harmonic pathfinder algorithm — it's complex enough to warrant unit tests.
3. **AI Suggest relies on local Ollama** at `http://DESKTOP-D4U6J5M:11434` — will fail if Ollama is not running or the host is unreachable.
4. **Uncommitted changes are substantial** (~3080 lines) — should be committed and potentially broken into multiple commits for clearer history.
5. **`sharp` added as dependency** for icon rendering script — only needed for development, could be a devDependency.

---

## Suggested Next Steps

### Immediate
- **Commit the uncommitted work** — consider splitting into logical commits (audio, UI, pathfinder, icon)
- **Extract pathfinder into its own module** (`src/lib/harmonicPathfinder.ts`) for testability and reuse
- **Add unit tests for pathfinder** — verify edge weights, beam search behavior, determinism

### Feature Work
- **Playback of generated paths** — the build path UI generates progressions but playback integration could be tightened
- **Path editing** — drag-and-drop reordering of chord path nodes
- **Export to MIDI** — save generated chord progressions as standard MIDI files
- **Voice leading optimization** — option to automatically revoice chords for smoothest voice leading
- **Undo/redo** for chord path editing (currently only delete is available)

### Polish
- **Voice leading viz** — animate the lines when playing back a progression
- **Branch tree** — show voice leading hints on branch hover (preview what the motion would look like)
- **Mobile/touch support** — right-click delete needs a touch alternative (long-press?)

---

## Build & Run

```bash
# UI development
cd MagicDAW-UI && npm run dev

# UI production build
cd MagicDAW-UI && npm run build

# Swift app
swift build

# Both
make build

# Render app icon
node scripts/render-icon.mjs
```

---

## File Quick Reference

| File | Lines | Purpose |
|------|-------|---------|
| `MagicDAW-UI/src/compositions/CircleOfFifths1.tsx` | ~3500+ | Main circle SVG, pathfinder, voice leading |
| `MagicDAW-UI/src/components/CircleOfFifthsPanel.tsx` | ~1200+ | Panel controls, build path UI, chord release fix |
| `MagicDAW-UI/src/compositions/useCircleZoom.ts` | ~200 | Zoom state machine |
| `MagicDAW/Audio/Sampler.swift` | ~300 | Audio sampler + GM fallback |
| `MagicDAW/Views/WebViewBridge.swift` | ~2100 | All JS↔Swift messaging |
| `MagicDAW/Views/MainWindow.swift` | ~150 | WKWebView host, context menu suppression |
