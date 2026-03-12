# Codex Interpretation

This file is my working interpretation of `CLAUDE.md` for this repository. It is not a replacement for the source instructions; it is the condensed version I will use while working here.

## What This Repo Is

Magic DAW is a macOS DAW with:
- a native Swift/SwiftUI shell and audio stack
- a React + Remotion UI embedded through `WKWebView`
- local AI features routed through Ollama only

The practical split is:
- Swift owns audio, MIDI, AI integration, project state, and native app behavior
- the web UI owns the interactive visual surfaces and panel logic

## Build Interpretation

When the user says "build" or "rebuild", prefer:

```bash
make dmg
```

Reason:
- `make build` is not the real user-facing deliverable
- the user runs the mounted DMG, so rebuilding without refreshing the DMG can leave them testing stale output

Secondary commands:
- UI-only build: `cd MagicDAW-UI && npm run build`
- Swift-only build: `swift build`
- combined non-DMG build: `make build`

## AI Constraints

AI must stay local.

Use only:
- Ollama at `http://DESKTOP-D4U6J5M:11434`
- `qwen2.5:14b` for faster responses
- `deepseek-r1:14b` when stronger reasoning is needed

Do not introduce:
- Claude API
- OpenAI API
- external hosted inference services

## Codebase Hotspots

Swift:
- `MagicDAW/App/` for app shell and bridge integration
- `MagicDAW/Audio/` for playback, sampler, engine, DSP
- `MagicDAW/MIDI/` for hardware I/O
- `MagicDAW/AI/` for Ollama client behavior
- `MagicDAW/Theory/` for harmony and analysis logic
- `MagicDAW/Plugin/` for node graph to AUv3 work
- `MagicDAW/Project/` for save/load and project model behavior

UI:
- `MagicDAW-UI/src/compositions/CircleOfFifths1.tsx` is large and likely high-risk
- `MagicDAW-UI/src/compositions/IntervalTrainer.tsx` contains trainer composition behavior
- `MagicDAW-UI/src/compositions/useCircleZoom.ts` is the zoom state machine
- `MagicDAW-UI/src/components/CircleOfFifthsPanel.tsx` contains panel controls and MIDI chord handling
- `MagicDAW-UI/src/components/IntervalTrainerPanel.tsx` contains trainer game logic
- `MagicDAW-UI/src/bridge.ts` is the Swift/JS contract surface
- `MagicDAW-UI/src/types/daw.ts` defines shared DAW-facing types

## Working Conventions

Swift:
- prefer modern Swift patterns already in use: async/await, `@Observable`, structured concurrency
- target macOS 14+

UI:
- preserve the current Aurora glass direction rather than restyling arbitrarily
- keep the dark frosted look and neon accent palette unless the task explicitly changes design direction
- respect the existing bridge contract between Swift and JS

## Practical Rules I Will Follow Here

- Treat DMG creation as the default release/test build path.
- Avoid architecture drift between Swift-native responsibilities and web UI responsibilities.
- Keep AI integrations local-only.
- Be careful when editing large interactive UI files, especially the circle-of-fifths composition and panel logic.
- Prefer minimal, targeted changes around the bridge and shared types because regressions there can break the whole app surface.

## Current Roadmap Notes

Near-term priority order for instrument work:

1. Finish the sample-based instrument engine foundation.
2. Improve sound rendering quality:
   - loop-point playback
   - stronger voice envelopes / voice handling
   - better library loading and eventual disk streaming
   - future SFZ import
3. After the engine/rendering pass, simplify instrument UX.

Instrument UX simplification task, based on the Soundtrap reference:
- Keep `Instruments` as the place to create, import, edit, and save instruments.
- Remove multi-hop assignment friction.
- Make instrument selection happen directly from Arrange via a track-level picker/menu.
- The Arrange picker should feel immediate and lightweight:
  - browse/search presets
  - preview from the picker
  - select instrument on the track without switching views
- Use the current multi-step assign flow only as a temporary implementation, not the end-state UX.
