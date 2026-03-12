# Sampler QA Checklist

Use `DemoInstruments/SamplerQA/SamplerQA.magicinstrument` to verify recent sampler changes.

## In-App Checks

1. Load `Sampler QA Demo` in `Instruments`.
2. Play `C4` softly, then hard.
   Expected: hard hit is louder and brighter.
3. Hold `C4` for 3-4 seconds.
   Expected: sound sustains through a looped middle section without a hard click at the seam.
4. Release `C4`.
   Expected: a distinct release sample is heard on note-off.
5. Repeat `C4` several times quickly.
   Expected: no premature choking at normal playing density.

## Arrange Checks

1. Assign `Sampler QA Demo` to a MIDI track from `Arrange`.
2. Play/record a short held-note clip around `C4`.
3. Play back the clip in `Arrange`.
   Expected: same sustain and release behavior as the preview in `Instruments`.

## Known Limits

- The loop crossfade is currently a basic seam smoother, not a full crossfade looper.
- The release sample in this demo is synthetic QA material, not a polished production release layer.
