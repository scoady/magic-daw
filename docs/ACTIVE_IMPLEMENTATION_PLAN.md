# Active Implementation Plan

This file connects the current implementation work to the broader production roadmap.

## Current Focus

Primary active track:
- sample-based instrument engine

Why this is first:
- it directly improves perceived output quality
- it unlocks Harmonic Lab, Arrange playback, and future rendering quality
- it establishes the per-track playback architecture needed by a professional DAW

## Current State

Already landed:
- per-track MIDI playback routing instead of one global sampler path
- sample instrument runtime types:
  - loader
  - region selection
  - round robin selector
  - voice allocator
- sample rack import / save / assign flow
- demo sample instrument + demo WAV assets

## Immediate Next Steps

### Engine

1. Loop-point aware playback in the sampler.
2. Stronger voice envelope handling.
3. Instrument-level gain/pan output settings.
4. Better sample rack serialization and loading consistency.
5. Optional release-trigger / articulation groundwork.

### Library / Workflow

1. Surface saved sample instruments in the current instrument workflows.
2. Unify GM presets and sample racks in one instrument library model.
3. Ensure project save/load restores track instruments without manual repair.

### Validation

1. Add tests for:
   - region matching
   - round robin
   - voice stealing
   - saved instrument loading
2. Verify:
   - real-time playback
   - arrange playback
   - export rendering

## Deferred Until After Engine / Rendering

These are important, but intentionally deferred so the playback foundation stays coherent.

### Direct Arrange Instrument Picker

Target UX:
- track-level instrument menu directly in Arrange
- search + browse
- preview from the picker
- one-click apply

Why deferred:
- the instrument engine and saved-library behavior need to stabilize first

### Instrument UX Simplification

End-state direction:
- `Instruments` = create/import/edit/save
- `Arrange` = choose/swap instrument quickly

The current multi-hop flow is temporary.

## Risks

1. Preview sampler and project sampler may drift if they don’t share one runtime path.
2. Sample loading can become slow or memory-heavy before disk streaming lands.
3. Instrument library format may fragment if GM presets and sample racks stay too separate for too long.

## Definition of Done for Current Track

The current instrument-engine tranche is complete when:
- imported sample racks play correctly from Arrange
- saved sample instruments restore reliably on reload
- looped sample material behaves musically
- repeated-note playback sounds stable and intentional
- the current workflow, while not final UX, is reliable enough for real use
