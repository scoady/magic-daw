# Magic DAW

**AI-powered macOS Digital Audio Workstation with Aurora glass UI**

A native macOS DAW that combines professional audio production tools with AI-assisted composition, sound design, and plugin building -- all running locally through Ollama.

![Magic DAW Screenshot](docs/screenshot-placeholder.png)

---

## Features

### DAW Core
- **Multi-track timeline** with audio and MIDI recording
- **AVAudioEngine-based** audio engine with low-latency playback
- **CoreMIDI integration** for hardware controller support
- **Sample-based instrument creator** -- drag in samples, map across keys
- **Mixer** with per-track faders, VU meters, pan, solo/mute

### Music Theory Engine
- **Real-time key detection** using the Krumhansl-Schmuckler algorithm
- **Chord analysis** -- identifies chord quality, extensions, and inversions
- **Scale database** -- 20+ scales with interval patterns and note generation
- **Theory-aware suggestions** for harmonically correct composition

### AI Integration (100% Local)
- **Harmony suggestions** -- AI analyzes your progression and suggests next chords
- **Sound design assistant** -- describe a sound, get synthesis parameter recommendations
- **Arrangement ideas** -- AI proposes structural variations and instrumentation
- Powered by **Ollama** (`qwen2.5:14b` for speed, `deepseek-r1:14b` for reasoning)
- No cloud APIs, no external services, no subscriptions

### Visual Plugin Builder
- **Node-graph editor** for designing audio effects and instruments
- Drag-and-drop DSP nodes: oscillators, filters, envelopes, delays, reverbs
- **Compile to AUv3** -- export your designs as native Audio Unit plugins
- Real-time preview while building

### Aurora Glass UI
- Built with **React + Remotion + Tailwind** embedded via WKWebView
- Dark theme with frosted glass panels and teal/cyan/purple neon accents
- Smooth animations powered by Remotion compositions
- Responsive layout with resizable panels

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App Shell | Swift / SwiftUI / macOS 14+ |
| Audio | AVAudioEngine, Accelerate (DSP) |
| MIDI | CoreMIDI |
| UI | React, Remotion, Tailwind CSS |
| Bridge | WKWebView + message handlers |
| AI | Ollama (local LLM inference) |
| Build | Swift Package Manager + Vite |

---

## Build

### Prerequisites
- macOS 14.0+ (Sonoma)
- Xcode 15+
- Node.js 20+
- [Ollama](https://ollama.ai) with `qwen2.5:14b` model pulled

### Quick Start

```bash
# Clone
git clone https://github.com/scoady/magic-daw.git
cd magic-daw

# Build everything
make build

# Or develop with hot reload
make dev
```

### Individual Builds

```bash
# UI only (hot reload on localhost:5173)
make dev-ui

# Swift app only
swift build

# Clean all artifacts
make clean
```

---

## Architecture

```
MagicDAW/                 Swift source
  App/                    SwiftUI app shell, WKWebView bridge
  Audio/                  AVAudioEngine, Sampler, DSP
  MIDI/                   CoreMIDI wrapper
  AI/                     Ollama client + AI services
  Theory/                 Key detection, chord analysis, scales
  Plugin/                 Node graph -> AUv3 compiler
  Project/                Project model, save/load
  Views/                  SwiftUI views + WebView bridge

MagicDAW-UI/              React + Remotion web UI
  src/
    components/           Knob, Fader, VUMeter, TransportBar, GlassPanel
    bridge.ts             Swift <-> JS message passing
    types/                TypeScript type definitions
```

The Swift app provides the audio engine, MIDI handling, and AI client. The UI is a React application rendered in a WKWebView, communicating with Swift via a bidirectional message bridge. This hybrid approach gives us native audio performance with web-grade UI flexibility.

---

## License

MIT
