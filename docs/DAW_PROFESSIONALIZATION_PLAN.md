# DAW Professionalization Plan

This plan is scoped to the core DAW surfaces only:
- `Arrange`
- `Edit`
- `Mix`
- `Instruments`
- `Plugins`
- `Harmonic Lab`
- top transport / project shell

It explicitly excludes the Learn/theory interfaces for now.

## Goals

1. Make the DAW feel calmer, more modern, and more trustworthy.
2. Reduce prototype-style glow/noise in core workflow views.
3. Move toward a track-first workflow with fewer context hops.
4. Improve readability of clips, transport state, and instrument assignment.
5. Prepare the app for more serious editing, mixing, and production workflows.

## Execution Streams

### Stream A: Visual System

#### Phase A1: DAW Shell Theme
- Replace cyan-heavy glass look with a black/graphite palette.
- Keep one restrained accent for focus states.
- Reduce aurora/noise/scanline intensity in DAW views only.
- Standardize panel, tab, button, and border treatments.

Acceptance criteria:
- Arrange/Edit/Mix/Instruments/Plugins/Harmonic Lab share the same shell language.
- The app still feels premium, but no longer visually noisy.
- Functional states remain clear: play, loop, record, mute, solo, arm.

#### Phase A2: Typography + Density
- Tighten spacing and row heights.
- Use typography hierarchy rather than glow for emphasis.
- Simplify tab, ruler, and status treatments.

Acceptance criteria:
- More information fits on screen with less clutter.
- Headers, metadata, and interactive controls are clearly separated.

### Stream B: Track-First Workflow

#### Phase B1: Direct Instrument Picking in Arrange
- Keep `Instruments` as browser/editor/import workspace.
- Move actual track assignment into the Arrange track header.
- Support presets, GM instruments, saved racks, and discovered sample racks.

Acceptance criteria:
- A user can assign or swap an instrument without leaving Arrange.
- The current multi-hop assign flow becomes optional, not required.

#### Phase B2: Track Header Maturity
- Add clearer track identity strip, name, instrument, input/output state.
- Improve mute/solo/arm visual language.
- Add faster inline actions for duplicate/delete/color where appropriate.

Acceptance criteria:
- Track headers feel like the primary control surface for the arrangement.

### Stream C: Clip Readability

#### Phase C1: MIDI Clip Rendering
- Make note density and rhythmic structure visible at a glance.
- Improve selected-state contrast and drag affordances.
- Better differentiate empty blocks from actual musical content.

#### Phase C2: Audio Clip Rendering
- Clear waveform rendering.
- Gain/fade handles.
- Better distinction between generated placeholders and real imported audio.

Acceptance criteria:
- Users can tell what a clip contains without opening the editor.

### Stream D: Transport and Session Confidence

#### Phase D1: Transport Cleanup
- Sharpen play/stop/record/loop presentation.
- Improve loop-region display and status indicators.
- Make project dirty/save state quieter but more trustworthy.

#### Phase D2: Timeline Confidence
- Stronger playhead.
- Better ruler legibility.
- Clear loop region and section visibility.

Acceptance criteria:
- Playback state is obvious instantly.
- Ruler and playhead feel precise and stable.

### Stream E: Mixer and Automation

#### Phase E1: Mixer Pass
- Standardize mixer styling to match new shell.
- Improve metering, inserts, sends, and selected-channel clarity.

#### Phase E2: Automation Foundation
- Add automation lanes for volume, pan, sends, and instrument/plugin parameters.
- Give Arrange a clean expand/collapse model for automation editing.

Acceptance criteria:
- Mixer looks like part of the same DAW.
- Automation is treated as a first-class production tool.

## Recommended Implementation Order

1. A1: DAW Shell Theme
2. D1: Transport Cleanup
3. B1: Direct Instrument Picking in Arrange
4. C1: MIDI Clip Readability
5. B2: Track Header Maturity
6. E1: Mixer Pass
7. C2: Audio Clip Readability
8. E2: Automation Foundation
9. A2: Typography + Density cleanup pass

## Current Turn Focus

This implementation tranche should cover:
- A1: DAW Shell Theme
- D1: Transport Cleanup
- start B1 groundwork by keeping the Arrange-side instrument picker path visible and first-class

## Notes

- Functional colors can remain for record/warning/meter states.
- The DAW can be grayscale without becoming sterile; contrast and motion should be subtle, not absent.
- Any visual pass should preserve performance and not add more animated background overhead.
