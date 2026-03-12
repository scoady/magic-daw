# Production Roadmap

This document turns Magic DAW from a promising prototype into a production-ready, professional DAW.

It is intentionally opinionated:
- audio engine correctness comes before feature sprawl
- workflow speed comes before ornamental UI expansion
- Magic DAW differentiators should sit on top of solid DAW fundamentals, not replace them

## Current State Snapshot

What already exists in the repo:
- native macOS shell with Swift + `AVAudioEngine`
- multi-track arrange timeline with MIDI and audio clips
- MIDI recording, transport, count-in, looping, metering
- mixer view with mute/solo/pan/volume and effects chain plumbing
- export-to-audio flow
- local AI integrations through Ollama
- sample-based instrument creation path
- plugin builder / AUv3 export path
- theory and learning surfaces

What is still below professional DAW expectations:
- MIDI playback is still evolving toward true multitimbral production behavior
- sample engine is not yet a full professional sampler
- arrangement editing lacks core pro workflows like comping, automation, fades, warping, and freeze
- reliability features like full autosave/crash recovery/versioning are partial or absent
- track-level instrument workflow is still too indirect

## Product Thesis

Magic DAW should become:
1. A credible production environment for MIDI-first composition and hybrid audio work.
2. A local-first intelligent composition system that writes directly into the DAW.
3. A cinematic, modern DAW that still respects pro workflow expectations.

That means the roadmap splits into:
- `v1 Core DAW`
- `v2 Pro Workflow`
- `v3 Magic DAW Differentiators`

## v1 Core DAW

These are the features required before the app can reasonably claim to be a production-ready DAW for serious composition work.

### 1. Audio Engine Reliability

Must have:
- stable transport under play/stop/seek/loop
- deterministic MIDI clip playback
- per-track instrument playback that matches visible track assignments
- correct mute/solo behavior across all playback paths
- low-latency monitoring and recording stability
- offline bounce that matches real-time playback

Why:
- if playback or routing is untrustworthy, every higher-level feature becomes suspect

### 2. Instrument and Sound Engine

Must have:
- sample-based instrument engine with polyphony
- note range + velocity range mapping
- round robin
- loop point playback
- background sample loading
- saved sample instruments/presets
- instrument browser/library
- direct track-level instrument selection

Why:
- good instruments are the fastest path from idea to usable output
- current GM fallback is useful, but not enough for professional rendering

### 3. Arrange Essentials

Must have:
- reliable clip creation, move, resize, duplicate, split, loop
- clip gain for audio
- fades and crossfades
- arrangement markers / section track
- bounce in place / render clip
- track freeze / flatten

Why:
- arranging without these is still sketching, not production

### 4. MIDI Editing Essentials

Must have:
- robust piano roll
- quantize, swing, humanize
- velocity tools
- transpose, legato, duplicate, scale constrain
- note-level undo/redo backed by project-level undo

Why:
- MIDI-first composition is one of the product’s strongest natural lanes

### 5. Safety / Reliability

Must have:
- autosave
- crash recovery
- backup versions / snapshots
- project integrity checks
- consistent project serialization for clips, instruments, effects, and routing

Why:
- professionals will not trust a DAW that can destroy sessions

## v2 Pro Workflow

These features elevate Magic DAW from “usable” to “competitive”.

### Recording and Editing

- punch in / punch out
- comping and take lanes
- slip editing
- audio warp markers and time-stretch
- transient detection
- track alternatives / playlists

### Mixing

- automation lanes for:
  - volume
  - pan
  - sends
  - plugin parameters
  - instrument macros
- plugin delay compensation
- latency compensation
- sidechain routing
- bus/folder/VCA workflows
- better meters:
  - LUFS
  - RMS
  - peak hold
  - spectrum
  - stereo correlation

### Stock Devices

- production EQ
- compressor
- limiter
- de-esser
- transient shaper
- saturation
- modulation effects
- better delay and reverb
- mastering chain template support

### Workflow Speed

- command palette
- shortcut editor
- browser with tags/favorites/recent
- drag-and-drop from browser into arrange
- track templates
- project templates
- inspector panel

## v3 Magic DAW Differentiators

These are the features that should make Magic DAW feel unique, not just complete.

### AI-Native Composition

- prompt-to-arrangement that writes directly into track lanes
- prompt-to-variation on selected clips/tracks
- arrangement rewriting by section
- intelligent instrument suggestions based on genre/mood/reference blueprint
- AI clip generation that stays editable as normal DAW data

### Theory-Native Workflow

- reharmonize selected melody
- generate bassline from chords
- countermelody assistant
- voice-leading aware chord alternatives
- “fit to scale / borrow from mode / tension map” tools

### Sound Design and Instrument Intelligence

- prompt-to-preset for synths
- prompt-to-sample-map for imported folders
- SFZ import with AI-assisted cleanup/tagging
- searchable semantic instrument browser

## Ranked Priorities

### Must-Have for v1

1. Transport and playback correctness
2. Per-track instrument/audio rendering correctness
3. Professional sampler foundation
4. Project safety: autosave/recovery/versioning
5. Arrange essentials: fades, bounce in place, freeze
6. Automation lanes
7. Direct track-level instrument picker

### Pro Features for v2

1. Warp/time-stretch
2. Comping/takes
3. Plugin delay compensation
4. sidechain and advanced routing
5. richer stock effects
6. templates/browser/command palette

### Signature Magic DAW Differentiators

1. Harmonic Lab integrated with Arrange
2. AI arrangement authoring that produces editable DAW clips
3. theory-aware reharmonization and countermelody tools
4. smart sample instrument builder

## Architecture Implications

### Audio / Engine

Need to evolve toward:
- track-owned instrument engines
- pooled sampler voices
- disk streaming layer
- clear distinction between preview playback and project playback
- plugin/instrument latency accounting

### Project Model

Need durable storage for:
- sample instruments by path/reference
- automation data
- routing state
- take lanes / frozen states
- render artifacts and cached bounces

### UI / Workflow

Need a clearer separation between:
- creation/editing workspaces
- immediate Arrange actions
- deep instrument/effect editors

The user should not need to leave Arrange to make routine decisions.

## UX Direction

Reference direction:
- Soundtrap-style fast track-level instrument selection
- clear arrange-first workflow
- instrument workbench for deeper editing, not routine assignment

Principle:
- `Arrange` is where users choose and swap working instruments.
- `Instruments` is where users create, import, edit, and save instruments.

## Recommended Execution Order

### Tranche 1: Playback and Instrument Correctness

- finish sample instrument engine
- direct saved sample instruments into track playback
- loop point support
- better envelopes / voice handling
- library browsing and serialization cleanup

### Tranche 2: Production Arrange Essentials

- fades / crossfades
- bounce in place
- freeze / flatten
- markers / arrangement track
- clip gain

### Tranche 3: Safety and Automation

- autosave and recovery
- project snapshots
- automation lanes

### Tranche 4: Pro Mixing / Recording

- sidechain
- take lanes / comping
- plugin delay compensation
- warping

### Tranche 5: Magic Layer

- AI-native arrangement tools
- theory-native composition assistants
- semantic browser / instrument intelligence

## Success Bar

Magic DAW is ready for serious production use when:
- users can build a full arrangement without workarounds
- playback and export match
- projects recover safely from failure
- instruments sound polished without manual rescue steps
- core workflows are faster than “toy DAW” behavior
- AI features augment the DAW instead of bypassing it
