# Magic DAW — Feature Ideas

Ideas and enhancements to consider for future development.

## HIGH PRIORITY — Interactive Circle of Fifths Explorer
- **Full 3-ring wheel**: Major keys (outer), minor keys (middle), diminished (inner) — like the reference diagram
- **Live MIDI integration**: Play a note/chord → wheel zooms to that node, highlights it with aurora glow
- **Traversal explorer**: From the active node, show ALL possible movements — fifths, relative minor/major, parallel keys, tritone subs, secondary dominants — each as a glowing path with labels
- **Pathfinder mode**: Text input for start + end key (e.g. "C major → F# minor"). Wheel lights up ALL valid harmonic paths between them (shortest via fifths, through relative keys, chromatic mediants, etc.) with different colored trails per route
- **Click to navigate**: Click any node to "travel" there — animated zoom + rotation, shows the new traversal options
- **Scale degree chords**: When hovering a key, show its diatonic chords (I-ii-iii-IV-V-vi-vii°) as satellite nodes
- **Remotion composition**: Full cinematic Remotion rendering with aurora beams for connections, particle trails for paths, spring animations for zoom/rotation
- **Standalone view tab**: Big enough to be a primary workspace, not just a sidebar widget

## Audio / Engine
- **Sidechain compression**: Route one track's signal to control another track's compressor (classic kick→bass ducking)
- **Freeze/bounce track**: Render a track to audio to save CPU, with ability to unfreeze
- **Time-stretch audio clips**: Independent pitch/time manipulation on audio clips (rubberband-style)
- **Audio-to-MIDI**: Detect pitch from audio clips and convert to MIDI notes
- **Stem separation**: Split an audio file into drums/bass/vocals/other using ML (could run on Ollama or a dedicated model)

## MIDI / Theory
- **Smart chord voicing**: When playing single notes, auto-voice them into chords based on detected key + style (jazz voicings, pop triads, etc.)
- **Arpeggiator**: Built-in arpeggiator per track with pattern editor (up, down, random, custom)
- **Scale lock / MIDI filter**: Constrain MIDI input to notes in the detected key — wrong notes get snapped to nearest in-scale note
- **Humanize**: Add subtle timing/velocity randomization to quantized MIDI for a more natural feel
- **Chord pads**: Virtual pad interface — tap a pad to play a full chord, drag between pads for progressions
- **MIDI learn**: Click any knob/fader, move a MIDI CC, instant mapping

## AI (Ollama)
- **AI arrangement**: "Write me a verse-chorus-bridge structure in Am" → generates full clip layout
- **Style transfer**: "Make this progression sound more jazz" → re-voices chords with extensions
- **Lyric assistant**: Given chord progression + key, suggest lyric meter/rhyme schemes
- **Mix assistant**: "My vocals sound muddy" → suggests EQ/compression settings
- **Practice mode**: AI detects what you're playing wrong and suggests exercises

## Visualization / UI
- **Waveform color by frequency**: Color audio waveforms by spectral content (bass=warm, treble=cool)
- **3D spectrum**: Spectrogram waterfall view as a Remotion composition
- **Live lyrics overlay**: Display lyrics synced to playhead position
- **Session view**: Ableton-style clip launcher grid (alternative to linear arrange)
- **Detachable windows**: Pop out mixer, piano roll, visualizer into separate macOS windows
- **Theme system**: Multiple aurora variants (warm amber, cool violet, green matrix) selectable in settings

## Instruments / Samples
- **Drag-and-drop from Finder**: Drag audio files onto tracks to create clips or load instruments
- **Sample browser**: Built-in browser with preview for audio files on disk
- **Granular synthesis**: Granular engine as a built-in instrument (scatter grains across a sample)
- **FM synthesis**: FM synth node type in the plugin builder
- **Wavetable import**: Load custom wavetables into the oscillator node

## Collaboration / Export
- **Export stems**: Render each track as a separate audio file
- **Export MIDI**: Export MIDI clips as .mid files
- **Mixdown to audio**: Bounce the full project to WAV/AIFF/MP3
- **Share project**: Package .magicdaw bundle as a zip for sharing
- **Ableton Link**: Tempo sync with other apps/devices on the network

## Plugin Builder
- **Preset browser**: Save/load/share synth patches with preview
- **Macro controls**: Map multiple node parameters to a single macro knob
- **Visual A/B compare**: Toggle between two versions of a patch to compare
- **Import node graph from JSON**: Paste a node graph definition to load a patch
- **Modulation matrix**: Visual matrix showing all mod source → destination routings
