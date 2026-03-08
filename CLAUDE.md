# Magic DAW

## Project Structure
- `MagicDAW/` -- Swift source (macOS app)
- `MagicDAW-UI/` -- React + Remotion web UI (embedded via WKWebView)
- `projects/magic-daw/PROJECT.md` -- full project plan (in claude-manager)

## Build
- UI: `cd MagicDAW-UI && npm run build`
- App: `swift build`
- Both: `make build`

## AI
- ALL AI through Ollama at `http://DESKTOP-D4U6J5M:11434`
- Models: `qwen2.5:14b` (fast), `deepseek-r1:14b` (reasoning)
- No Claude API, no external services

## Key Files
- `MagicDAW/App/` -- SwiftUI app shell + WKWebView bridge
- `MagicDAW/Audio/` -- AVAudioEngine, Sampler, DSP graph
- `MagicDAW/MIDI/` -- CoreMIDI wrapper
- `MagicDAW/AI/` -- Ollama client + AI services
- `MagicDAW/Theory/` -- Music theory engine (key detection, chord analysis)
- `MagicDAW/Plugin/` -- Node graph -> AUv3 compiler
- `MagicDAW/Project/` -- Project model, save/load

## Conventions
- Swift: modern async/await, @Observable, structured concurrency
- Target: macOS 14.0+ (Sonoma)
- UI: React + Remotion + Tailwind in WKWebView
- Theme: Aurora glass (dark, frosted panels, teal/cyan/purple neon accents)
