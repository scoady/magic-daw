import Foundation

// MARK: - Task Types

/// All AI tasks that can be routed to an appropriate model.
enum AITask: Sendable {
    case harmonySuggestion(notes: [UInt8], key: MusicalKey?, style: String?)
    case chordVoicing(chord: MusicChord, style: AIVoicingStyle)
    case countermelody(melody: [AINote], key: MusicalKey, bars: Int)
    case arrangementSuggestion(progression: [MusicChord], key: MusicalKey, genre: String)
    case reharmonization(progression: [MusicChord], key: MusicalKey, style: String)
    case soundDesign(description: String)
    case synthPatch(description: String)
    case sampleMapping(sampleInfo: [SampleInfo])
    case naturalLanguage(instruction: String, context: MusicContext)
    case mixingSuggestion(trackInfo: [TrackInfo])
}

// MARK: - Supporting Types

enum AIVoicingStyle: String, Codable, Sendable {
    case close       // notes within one octave
    case open        // notes spread across octaves
    case drop2       // second-highest note dropped an octave
    case drop3       // third-highest note dropped an octave
    case rootless    // omit the root (for jazz)
    case quartal     // stacked fourths
    case cluster     // dense chromatic clusters
    case spread      // wide intervals
}

struct AINote: Codable, Sendable {
    let pitch: UInt8        // MIDI note number
    let velocity: UInt8     // 0-127
    let startBeat: Double   // position in beats
    let duration: Double    // duration in beats

    var noteName: NoteName {
        NoteName.from(midiNote: pitch)
    }

    var octave: Int {
        NoteName.octave(fromMIDI: pitch)
    }
}

enum AIVoice: String, Codable, Sendable {
    case soprano, alto, tenor, bass
    case lead, pad, arpeggio

    var midiRange: ClosedRange<UInt8> {
        switch self {
        case .soprano:  return 60...84
        case .alto:     return 53...77
        case .tenor:    return 48...72
        case .bass:     return 36...60
        case .lead:     return 48...84
        case .pad:      return 36...84
        case .arpeggio: return 36...96
        }
    }
}

enum HarmonyStyle: String, Codable, Sendable {
    case auto           // let AI decide
    case classical      // common practice period
    case jazz           // extended harmony
    case pop            // simple triads & 7ths
    case modal          // modal interchange
    case chromatic      // chromatic voice leading
    case neoSoul        // neo-soul/R&B
    case cinematic      // film score style
}

struct TrackInfo: Codable, Sendable {
    let name: String
    let instrument: String
    let volume: Double           // 0.0-1.0
    let pan: Double              // -1.0 to 1.0
    let isMuted: Bool
    let peakLevel: Double        // dBFS
    let frequencyRange: String   // "low", "mid", "high", "full"
}

// MARK: - Result Types

struct AIResult: Sendable {
    let model: String
    let latencyMs: Int
    let result: AIResultPayload
}

enum AIResultPayload: Sendable {
    case harmony(HarmonyResult)
    case voicing([UInt8])
    case countermelody([AINote])
    case arrangement(ArrangementResult)
    case soundDesign(SoundDesignResult)
    case synthPatch(SynthPatchResult)
    case sampleMap(SampleMapResult)
    case text(String)
    case mixing(MixingSuggestion)
}

struct HarmonyResult: Codable, Sendable {
    let suggestions: [HarmonySuggestionJSON]
}

struct HarmonySuggestionJSON: Codable, Sendable {
    let notes: [UInt8]
    let chordName: String
    let confidence: Double
    let explanation: String
}

struct SoundDesignResult: Codable, Sendable {
    let name: String
    let category: String
    let description: String
    let characteristics: [String]
}

struct MixingSuggestion: Codable, Sendable {
    let suggestions: [MixAction]
    let overallNotes: String
}

struct MixAction: Codable, Sendable {
    let track: String
    let action: String
    let parameter: String
    let currentValue: String?
    let suggestedValue: String
    let reason: String
}

// MARK: - Router

/// Routes AI tasks to the appropriate Ollama model based on complexity.
actor AIRouter {
    let client: OllamaClient

    static let fastModel = "qwen2.5:14b"
    static let reasoningModel = "deepseek-r1:14b"

    init(client: OllamaClient) {
        self.client = client
    }

    /// Route a task to the best model and return the result.
    func route(_ task: AITask) async throws -> AIResult {
        let start = DispatchTime.now()
        let model = modelFor(task)

        let payload: AIResultPayload

        switch task {
        case .harmonySuggestion(let notes, let key, let style):
            payload = try await handleHarmonySuggestion(notes: notes, key: key, style: style, model: model)

        case .chordVoicing(let chord, let style):
            payload = try await handleChordVoicing(chord: chord, style: style, model: model)

        case .countermelody(let melody, let key, let bars):
            payload = try await handleCountermelody(melody: melody, key: key, bars: bars, model: model)

        case .arrangementSuggestion(let progression, let key, let genre):
            payload = try await handleArrangement(progression: progression, key: key, genre: genre, model: model)

        case .reharmonization(let progression, let key, let style):
            payload = try await handleReharmonization(progression: progression, key: key, style: style, model: model)

        case .soundDesign(let description):
            payload = try await handleSoundDesign(description: description, model: model)

        case .synthPatch(let description):
            payload = try await handleSynthPatch(description: description, model: model)

        case .sampleMapping(let sampleInfo):
            payload = try await handleSampleMapping(samples: sampleInfo, model: model)

        case .naturalLanguage(let instruction, let context):
            payload = try await handleNaturalLanguage(instruction: instruction, context: context, model: model)

        case .mixingSuggestion(let trackInfo):
            payload = try await handleMixingSuggestion(tracks: trackInfo, model: model)
        }

        let end = DispatchTime.now()
        let latencyMs = Int((end.uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000)

        return AIResult(model: model, latencyMs: latencyMs, result: payload)
    }

    // MARK: - Model Selection

    /// Pick the right model based on task complexity.
    /// Fast model for real-time suggestions; reasoning model for complex analysis.
    private func modelFor(_ task: AITask) -> String {
        switch task {
        case .harmonySuggestion, .chordVoicing, .mixingSuggestion:
            return Self.fastModel

        case .countermelody, .arrangementSuggestion, .reharmonization:
            return Self.reasoningModel

        case .soundDesign, .synthPatch:
            return Self.fastModel

        case .sampleMapping:
            return Self.fastModel

        case .naturalLanguage:
            return Self.reasoningModel
        }
    }

    // MARK: - Task Handlers

    private func handleHarmonySuggestion(
        notes: [UInt8], key: MusicalKey?, style: String?, model: String
    ) async throws -> AIResultPayload {
        let noteNames = notes.map { "\(NoteName.from(midiNote: $0).displayName)\(NoteName.octave(fromMIDI: $0))" }
        let keyStr = key.map { $0.displayName } ?? "unknown"
        let styleStr = style ?? "auto"

        let prompt = """
        Current notes: \(noteNames.joined(separator: ", ")) (MIDI: \(notes.map(String.init).joined(separator: ", ")))
        MusicalKey: \(keyStr)
        Style: \(styleStr)

        Suggest 3-4 harmonies that work with these notes.
        """

        let result = try await client.generateJSON(
            model: model,
            prompt: prompt,
            system: AIPrompts.harmony,
            type: HarmonyResult.self
        )
        return .harmony(result)
    }

    private func handleChordVoicing(
        chord: MusicChord, style: AIVoicingStyle, model: String
    ) async throws -> AIResultPayload {
        let prompt = """
        MusicChord: \(chord.displayName)
        Voicing style: \(style.rawValue)

        Return MIDI note numbers for a voicing of this chord in the given style.
        Keep notes within MIDI range 36-84.
        """

        let result = try await client.generateJSON(
            model: model,
            prompt: prompt,
            system: AIPrompts.voicing,
            type: VoicingResult.self
        )
        return .voicing(result.notes)
    }

    private func handleCountermelody(
        melody: [AINote], key: MusicalKey, bars: Int, model: String
    ) async throws -> AIResultPayload {
        let melodyDesc = melody.prefix(32).map {
            "\(NoteName.from(midiNote: $0.pitch).displayName)\(NoteName.octave(fromMIDI: $0.pitch)) @ beat \($0.startBeat) dur \($0.duration)"
        }

        let prompt = """
        MusicalKey: \(key.displayName)
        Bars: \(bars)
        Melody notes:
        \(melodyDesc.joined(separator: "\n"))

        Generate a countermelody that complements this melody.
        """

        let result = try await client.generateJSON(
            model: model,
            prompt: prompt,
            system: AIPrompts.countermelody,
            type: CountermelodyResult.self
        )

        let events = result.notes.map { n in
            AINote(pitch: n.pitch, velocity: n.velocity, startBeat: n.startBeat, duration: n.duration)
        }
        return .countermelody(events)
    }

    private func handleArrangement(
        progression: [MusicChord], key: MusicalKey, genre: String, model: String
    ) async throws -> AIResultPayload {
        let chordNames = progression.map(\.displayName)

        let prompt = """
        MusicalKey: \(key.displayName)
        Genre: \(genre)
        MusicChord progression: \(chordNames.joined(separator: " | "))

        Suggest a full arrangement with sections, instrumentation, and dynamics.
        """

        let result = try await client.generateJSON(
            model: model,
            prompt: prompt,
            system: AIPrompts.arrangement,
            type: ArrangementResult.self
        )
        return .arrangement(result)
    }

    private func handleReharmonization(
        progression: [MusicChord], key: MusicalKey, style: String, model: String
    ) async throws -> AIResultPayload {
        let chordNames = progression.map(\.displayName)

        let prompt = """
        MusicalKey: \(key.displayName)
        Original progression: \(chordNames.joined(separator: " | "))
        Reharmonization style: \(style)

        Suggest a reharmonized version of this progression.
        """

        let result = try await client.generateJSON(
            model: model,
            prompt: prompt,
            system: AIPrompts.reharmonization,
            type: ReharmonizationResult.self
        )

        // Parse chord names back into MusicChord structs
        let chords = result.chords.compactMap { parseChord($0) }
        return .harmony(HarmonyResult(suggestions: result.chords.enumerated().map { i, name in
            HarmonySuggestionJSON(
                notes: i < chords.count ? chords[i].quality.intervals.map { UInt8(60 + $0) } : [],
                chordName: name,
                confidence: 0.85,
                explanation: result.explanation
            )
        }))
    }

    private func handleSoundDesign(description: String, model: String) async throws -> AIResultPayload {
        let prompt = """
        Describe how to create this sound:
        "\(description)"

        Provide synthesis parameters and signal chain.
        """

        let result = try await client.generateJSON(
            model: model,
            prompt: prompt,
            system: AIPrompts.soundDesign,
            type: SynthPatchResult.self
        )
        return .synthPatch(result)
    }

    private func handleSynthPatch(description: String, model: String) async throws -> AIResultPayload {
        let prompt = """
        Create a synth patch for:
        "\(description)"

        Return the node graph with all parameters.
        """

        let result = try await client.generateJSON(
            model: model,
            prompt: prompt,
            system: AIPrompts.synthPatch,
            type: SynthPatchResult.self
        )
        return .synthPatch(result)
    }

    private func handleSampleMapping(samples: [SampleInfo], model: String) async throws -> AIResultPayload {
        let sampleDescs = samples.map {
            "  \($0.filename): pitch=\($0.detectedPitch ?? "unknown"), dur=\(String(format: "%.2f", $0.durationSeconds))s, rms=\(String(format: "%.1f", $0.rmsLevel))dB"
        }

        let prompt = """
        Map these samples across the keyboard:
        \(sampleDescs.joined(separator: "\n"))

        Assign each sample a root note, key range, and velocity range.
        """

        let result = try await client.generateJSON(
            model: model,
            prompt: prompt,
            system: AIPrompts.sampleMapping,
            type: SampleMapResult.self
        )
        return .sampleMap(result)
    }

    private func handleNaturalLanguage(
        instruction: String, context: MusicContext, model: String
    ) async throws -> AIResultPayload {
        let contextJSON = try JSONEncoder().encode(context)
        let contextStr = String(data: contextJSON, encoding: .utf8) ?? "{}"

        let prompt = """
        Instruction: \(instruction)

        Current project context:
        \(contextStr)
        """

        let response = try await client.chat(
            model: model,
            messages: [
                .system(AIPrompts.naturalLanguage),
                .user(prompt)
            ],
            temperature: 0.7
        )
        return .text(response)
    }

    private func handleMixingSuggestion(tracks: [TrackInfo], model: String) async throws -> AIResultPayload {
        let trackDescs = tracks.map {
            "  \($0.name) (\($0.instrument)): vol=\(String(format: "%.2f", $0.volume)) pan=\(String(format: "%.2f", $0.pan)) peak=\(String(format: "%.1f", $0.peakLevel))dBFS muted=\($0.isMuted) range=\($0.frequencyRange)"
        }

        let prompt = """
        Analyze this mix and suggest improvements:
        \(trackDescs.joined(separator: "\n"))
        """

        let result = try await client.generateJSON(
            model: model,
            prompt: prompt,
            system: AIPrompts.mixing,
            type: MixingSuggestion.self
        )
        return .mixing(result)
    }

    // MARK: - MusicChord Parsing Helper

    private func parseChord(_ name: String) -> MusicChord? {
        guard !name.isEmpty else { return nil }

        let rootCandidates: [(String, NoteName)] = [
            ("C#", .Cs), ("D#", .Ds), ("F#", .Fs), ("G#", .Gs), ("A#", .As),
            ("Db", .Cs), ("Eb", .Ds), ("Gb", .Fs), ("Ab", .Gs), ("Bb", .As),
            ("C", .C), ("D", .D), ("E", .E), ("F", .F), ("G", .G), ("A", .A), ("B", .B)
        ]

        for (prefix, note) in rootCandidates {
            if name.hasPrefix(prefix) {
                let suffix = String(name.dropFirst(prefix.count))
                let quality = qualityFromSuffix(suffix)
                return MusicChord(root: note, quality: quality, bass: nil)
            }
        }
        return nil
    }

    private func qualityFromSuffix(_ suffix: String) -> ChordQuality {
        switch suffix.lowercased() {
        case "", "maj":                     return .major
        case "m", "min":                    return .minor
        case "7", "dom7":                   return .dominant7
        case "maj7", "m7":
            return suffix.lowercased() == "m7" ? .minor7 : .major7
        case "dim":                         return .diminished
        case "dim7":                        return .diminished7
        case "aug", "+":                    return .augmented
        case "sus2":                        return .sus2
        case "sus4":                        return .sus4
        case "m7b5":                        return .halfDiminished7
        case "9":                           return .dominant9
        case "maj9":                        return .major9
        case "m9", "min9":                  return .minor9
        case "add9":                        return .add9
        case "5":                           return .power
        default:                            return .major
        }
    }
}

// MARK: - Internal JSON Result Types

private struct VoicingResult: Codable {
    let notes: [UInt8]
    let voicingName: String
}

private struct CountermelodyResult: Codable {
    let notes: [NoteEventJSON]
}

private struct NoteEventJSON: Codable {
    let pitch: UInt8
    let velocity: UInt8
    let startBeat: Double
    let duration: Double
}

private struct ReharmonizationResult: Codable {
    let chords: [String]
    let explanation: String
}

// MARK: - AI Prompts

/// All system prompts used by the AI router. Carefully crafted for structured JSON output.
enum AIPrompts {

    static let harmony = """
    You are a music theory expert specializing in harmony and chord analysis.
    Given notes and musical context, suggest harmonies that complement the input.

    ALWAYS respond in this exact JSON format:
    {
      "suggestions": [
        {
          "notes": [60, 64, 67],
          "chord_name": "C",
          "confidence": 0.9,
          "explanation": "Diatonic I chord, strong resolution"
        }
      ]
    }

    Rules:
    - Suggest 3-4 harmonies ranked by confidence (0.0-1.0)
    - Only use MIDI note numbers in range 36-96
    - Respect the given key and scale context
    - Consider voice leading from recent chords
    - Include both safe (diatonic) and creative (chromatic/borrowed) options
    - Keep explanations concise (under 20 words)
    """

    static let voicing = """
    You are a chord voicing specialist. Given a chord and voicing style, return specific MIDI note numbers.

    ALWAYS respond in this exact JSON format:
    {
      "notes": [48, 55, 64, 67],
      "voicing_name": "Open C major"
    }

    Rules:
    - All notes must be in MIDI range 36-84
    - Close voicing: all notes within one octave
    - Open voicing: spread across 2+ octaves
    - Drop 2: take second-highest note, drop it one octave
    - Drop 3: take third-highest note, drop it one octave
    - Rootless: omit the root note (common in jazz)
    - Quartal: stack perfect/augmented fourths
    - Cluster: dense grouping, semitone/whole-tone intervals
    - Spread: wide intervals (5ths, octaves, 10ths)
    """

    static let countermelody = """
    You are a counterpoint and melody expert. Given a melody, key, and number of bars, \
    generate a countermelody that complements the original.

    ALWAYS respond in this exact JSON format:
    {
      "notes": [
        {"pitch": 60, "velocity": 80, "start_beat": 0.0, "duration": 1.0},
        {"pitch": 62, "velocity": 75, "start_beat": 1.0, "duration": 0.5}
      ]
    }

    Rules:
    - Use contrary or oblique motion relative to the melody
    - Avoid parallel fifths and octaves
    - Keep within the specified key (occasional chromatic passing tones OK)
    - Velocity range: 60-100
    - Ensure rhythmic independence from the melody
    - Notes should fill the requested number of bars (4 beats per bar)
    - MIDI pitch range: 36-96
    """

    static let arrangement = """
    You are a music arranger and producer. Given a chord progression, key, and genre, \
    suggest a complete arrangement with sections.

    ALWAYS respond in this exact JSON format:
    {
      "sections": [
        {
          "name": "Intro",
          "start_bar": 1,
          "end_bar": 4,
          "chords": ["Cmaj7", "Am7"],
          "instruments": ["piano", "strings"],
          "dynamics": "pp",
          "notes": "Sparse, atmospheric opening"
        }
      ],
      "explanation": "Overall arrangement concept"
    }

    Rules:
    - Include standard song sections: Intro, Verse, Pre-Chorus, Chorus, Bridge, Outro
    - Dynamics: pp, p, mp, mf, f, ff
    - Suggest appropriate instruments for the genre
    - Build energy through the arrangement
    - Keep total length reasonable (16-64 bars)
    """

    static let reharmonization = """
    You are a jazz harmony and reharmonization expert. Given a chord progression and style, \
    suggest a reharmonized version.

    ALWAYS respond in this exact JSON format:
    {
      "chords": ["Cmaj7", "A7b9", "Dm9", "G13"],
      "explanation": "Used tritone substitutions and extended dominants"
    }

    Rules:
    - Maintain the same phrase length as the original
    - Preserve the overall harmonic direction
    - Use style-appropriate substitutions (tritone subs, modal interchange, etc.)
    - MusicChord names should use standard notation (Cmaj7, Dm7b5, G7#9, etc.)
    """

    static let soundDesign = """
    You are a sound design and synthesis expert. Given a description of a desired sound, \
    specify a synth patch as a node graph.

    ALWAYS respond in this exact JSON format:
    {
      "name": "Warm Pad",
      "nodes": [
        {"id": "osc1", "type": "oscillator", "parameters": {"waveform": 1, "detune": 5.0, "level": 0.8}},
        {"id": "flt1", "type": "filter", "parameters": {"cutoff": 2000.0, "resonance": 0.3, "type": 0}},
        {"id": "env1", "type": "envelope", "parameters": {"attack": 0.5, "decay": 0.3, "sustain": 0.7, "release": 1.5}},
        {"id": "out", "type": "output", "parameters": {"level": 0.7}}
      ],
      "connections": [
        {"from": "osc1", "from_port": "output", "to": "flt1", "to_port": "input"},
        {"from": "flt1", "from_port": "output", "to": "out", "to_port": "input"},
        {"from": "env1", "from_port": "output", "to": "flt1", "to_port": "cutoff"}
      ],
      "description": "A warm analog-style pad with slow attack and gentle filtering"
    }

    Node types: oscillator, filter, envelope, lfo, delay, reverb, distortion, chorus, mixer, output
    Oscillator waveforms: 0=sine, 1=saw, 2=square, 3=triangle, 4=noise
    Filter types: 0=lowpass, 1=highpass, 2=bandpass, 3=notch
    All parameter values should be reasonable for audio synthesis.
    """

    static let synthPatch = """
    You are a synthesizer programmer. Given a sound description, create a detailed synth patch \
    as a node graph with specific parameter values.

    ALWAYS respond in this exact JSON format:
    {
      "name": "Patch Name",
      "nodes": [
        {"id": "node_id", "type": "node_type", "parameters": {"param": 0.5}}
      ],
      "connections": [
        {"from": "node_id", "from_port": "output", "to": "other_id", "to_port": "input"}
      ],
      "description": "What this patch sounds like"
    }

    Node types: oscillator, filter, envelope, lfo, delay, reverb, distortion, chorus, mixer, output
    Oscillator waveforms: 0=sine, 1=saw, 2=square, 3=triangle, 4=noise
    Filter types: 0=lowpass, 1=highpass, 2=bandpass, 3=notch

    Design principles:
    - Use multiple oscillators for rich sounds
    - Always include at least one envelope
    - Connect modulators (LFO, envelope) to parameters for movement
    - Keep signal flow logical: oscillators -> processing -> output
    """

    static let sampleMapping = """
    You are a sample instrument designer. Given metadata about audio samples, \
    map them across the keyboard with appropriate key ranges and velocity layers.

    ALWAYS respond in this exact JSON format:
    {
      "zones": [
        {
          "sample_file": "kick.wav",
          "root_note": 36,
          "low_note": 36,
          "high_note": 36,
          "low_velocity": 1,
          "high_velocity": 127
        }
      ],
      "explanation": "Mapping rationale"
    }

    Rules:
    - Use detected pitch to set root note; if unknown, infer from filename or context
    - Adjacent samples should have contiguous key ranges with no gaps
    - Velocity layers: use RMS level differences to create velocity splits
    - Drum samples: map to GM standard (kick=36, snare=38, hat=42, etc.)
    - Melodic samples: spread across 1-2 octaves per sample for natural transposition
    - MIDI note range: 0-127, velocity range: 1-127
    """

    static let mixing = """
    You are a professional mix engineer. Analyze the given track information and suggest \
    mix improvements.

    ALWAYS respond in this exact JSON format:
    {
      "suggestions": [
        {
          "track": "Vocals",
          "action": "adjust",
          "parameter": "volume",
          "current_value": "0.8",
          "suggested_value": "0.75",
          "reason": "Slightly hot, competing with lead guitar"
        }
      ],
      "overall_notes": "Summary of the mix state and priorities"
    }

    Consider:
    - Frequency balance (are low/mid/high evenly distributed?)
    - Stereo width (panning for separation)
    - Dynamic range (compression needs)
    - Level balance (nothing should dominate unless intended)
    - Common issues: muddy low-mids, harsh highs, buried vocals
    - Parameters: volume, pan, eq_low, eq_mid, eq_high, compression, reverb_send
    """

    static let naturalLanguage = """
    You are an AI music production assistant inside a DAW (digital audio workstation). \
    The user will give you natural language instructions about their music project. \
    Interpret their intent and provide actionable, specific music production guidance.

    You have context about the current project state (key, BPM, tracks, etc.).

    Respond clearly and concisely. If the instruction maps to a specific action \
    (add a track, change tempo, suggest chords), describe exactly what should happen. \
    If it's a creative question, give specific, practical suggestions.

    Keep responses under 200 words unless the question requires detailed explanation.
    """
}
