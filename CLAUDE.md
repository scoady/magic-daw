# Magic DAW

## Project Structure
- `MagicDAW/` -- Swift source (macOS app)
- `MagicDAW-UI/` -- React + Remotion web UI (embedded via WKWebView)
- `projects/magic-daw/PROJECT.md` -- full project plan (in claude-manager)

## Build
- UI: `cd MagicDAW-UI && npm run build`
- App: `swift build`
- Both: `make build`
- **DMG (always use this when user says "build" or "rebuild"):** `make dmg`
  - This builds UI + Swift + bundles into .app + creates dist/MagicDAW-0.1.0.dmg
  - `make build` alone does NOT update the DMG — the user mounts the DMG to run the app

## AI
- ALL AI through Ollama at `http://DESKTOP-D4U6J5M:11434`
- Models: `qwen2.5:14b` (fast), `deepseek-r1:14b` (reasoning)
- No Claude API, no external services

## Key Files — Swift
- `MagicDAW/App/` -- SwiftUI app shell + WKWebView bridge
- `MagicDAW/Audio/` -- AVAudioEngine, Sampler (GM synth fallback via DLS soundbank), DSP graph
- `MagicDAW/MIDI/` -- CoreMIDI wrapper
- `MagicDAW/AI/` -- Ollama client + AI services
- `MagicDAW/Theory/` -- Music theory engine (key detection, chord analysis)
- `MagicDAW/Plugin/` -- Node graph -> AUv3 compiler
- `MagicDAW/Project/` -- Project model, save/load

## Key Files — UI (MagicDAW-UI/src/)
- `compositions/CircleOfFifths1.tsx` -- Circle of Fifths Remotion composition (~3500+ lines)
- `compositions/IntervalTrainer.tsx` -- Interval Trainer Remotion composition
- `compositions/useCircleZoom.ts` -- Zoom state machine (idle→zoomed→lingering→zooming-out)
- `components/CircleOfFifthsPanel.tsx` -- Panel with controls, MIDI chord detection + debounce
- `components/IntervalTrainerPanel.tsx` -- Panel with explore/quiz game logic
- `bridge.ts` -- Swift ↔ JS bidirectional message passing
- `types/daw.ts` -- Core TypeScript types (ViewId includes 'circle' and 'trainer')

## Conventions
- Swift: modern async/await, @Observable, structured concurrency
- Target: macOS 14.0+ (Sonoma)
- UI: React + Remotion + Tailwind in WKWebView
- Theme: Aurora glass (dark, frosted panels, teal/cyan/purple neon accents)
- Palette: bg=#0a0e1a, cyan=#67e8f9, purple=#a78bfa, gold=#fbbf24, text=#e2e8f0
