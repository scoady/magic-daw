import Foundation

// MARK: - Harmony Engine (Algorithmic Fallback)

/// Pure algorithmic harmony engine. Used when Ollama is unavailable or too slow.
/// Implements common-practice and jazz harmony rules without AI.
struct HarmonyEngine: Sendable {

    /// Suggest harmonies based on current notes and key using music theory rules.
    func suggestHarmony(
        currentNotes: [UInt8],
        key: Key,
        style: HarmonyStyle
    ) -> [HarmonySuggestion] {
        let scale = key.scale
        let pitchClasses = Set(currentNotes.map { NoteName.from(midiNote: $0) })

        // Build diatonic triads in the key
        let scaleNotes = scale.pitchClasses
        var suggestions: [HarmonySuggestion] = []

        for (i, root) in scaleNotes.enumerated() {
            // Build triad from scale degrees
            let thirdIndex = (i + 2) % scaleNotes.count
            let fifthIndex = (i + 4) % scaleNotes.count
            let third = scaleNotes[thirdIndex]
            let fifth = scaleNotes[fifthIndex]

            // Determine quality from intervals
            let thirdInterval = root.interval(to: third)
            let fifthInterval = root.interval(to: fifth)
            let quality = chordQuality(thirdInterval: thirdInterval, fifthInterval: fifthInterval)

            let chord = Chord(root: root, quality: quality, bass: nil)

            // Score based on how well it fits with current notes
            let chordPitches = Set(quality.intervals.map { root.transposed(by: $0) })
            let overlap = pitchClasses.intersection(chordPitches).count
            let confidence = min(1.0, Double(overlap) / max(1.0, Double(pitchClasses.count)) * 0.6 + 0.3)

            // Build MIDI notes for the chord (root in octave 4)
            let rootMidi = 48 + root.rawValue
            let midiNotes = quality.intervals.map { UInt8(clamping: rootMidi + $0) }

            let explanation = "\(chord.romanNumeral(in: key)) - \(chord.displayName)"
            suggestions.append(HarmonySuggestion(
                notes: midiNotes,
                chord: chord,
                confidence: confidence,
                explanation: explanation,
                source: .algorithmic
            ))
        }

        // Sort by confidence and return top 4
        return Array(suggestions.sorted { $0.confidence > $1.confidence }.prefix(4))
    }

    /// Suggest the next chord in a progression based on common voice leading.
    func suggestNextChord(
        currentChord: Chord,
        key: Key
    ) -> [ChordSuggestion] {
        let scaleNotes = key.scale.pitchClasses
        let currentDegree = key.tonic.interval(to: currentChord.root)

        // Common progressions by scale degree
        let commonNext: [Int: [(Int, Double)]] = [
            0:  [(5, 0.9), (7, 0.85), (3, 0.8), (9, 0.7)],   // I -> IV, V, ii, vi
            2:  [(7, 0.9), (5, 0.85), (0, 0.7)],               // ii -> V, IV, I
            3:  [(7, 0.85), (5, 0.8), (0, 0.75)],              // bIII -> V, IV, I
            4:  [(7, 0.9), (0, 0.8), (5, 0.75)],               // III -> V, I, IV
            5:  [(0, 0.9), (7, 0.85), (2, 0.8), (9, 0.7)],    // IV -> I, V, ii, vi
            7:  [(0, 0.95), (9, 0.8), (5, 0.75)],              // V -> I, vi, IV
            9:  [(5, 0.85), (2, 0.8), (7, 0.75), (0, 0.7)],   // vi -> IV, ii, V, I
            11: [(0, 0.9), (7, 0.8)]                            // vii -> I, V
        ]

        let nexts = commonNext[currentDegree] ?? [(0, 0.8), (7, 0.7)]

        return nexts.compactMap { (interval, confidence) -> ChordSuggestion? in
            let rootNote = key.tonic.transposed(by: interval)
            guard let scaleIndex = scaleNotes.firstIndex(of: rootNote) else {
                // Out of scale, use major triad
                let chord = Chord(root: rootNote, quality: .major, bass: nil)
                return ChordSuggestion(
                    chord: chord,
                    confidence: confidence * 0.8,
                    explanation: "Chromatic approach to \(rootNote.displayName)",
                    source: .algorithmic
                )
            }

            // Determine quality from scale
            let thirdIndex = (scaleIndex + 2) % scaleNotes.count
            let fifthIndex = (scaleIndex + 4) % scaleNotes.count
            let thirdInterval = rootNote.interval(to: scaleNotes[thirdIndex])
            let fifthInterval = rootNote.interval(to: scaleNotes[fifthIndex])
            let quality = chordQuality(thirdInterval: thirdInterval, fifthInterval: fifthInterval)

            let chord = Chord(root: rootNote, quality: quality, bass: nil)
            return ChordSuggestion(
                chord: chord,
                confidence: confidence,
                explanation: "\(chord.romanNumeral(in: key)) - common resolution from \(currentChord.displayName)",
                source: .algorithmic
            )
        }
    }

    /// Simple countermelody using contrary motion.
    func generateCountermelody(
        melody: [NoteEvent],
        key: Key,
        bars: Int,
        voice: Voice
    ) -> [NoteEvent] {
        guard !melody.isEmpty else { return [] }

        let scaleIntervals = key.mode.intervals
        let range = voice.midiRange
        var counter: [NoteEvent] = []

        // Pivot around the midpoint of the melody range
        let pitches = melody.map(\.pitch)
        let midpoint = Int(pitches.reduce(0) { $0 + Int($1) }) / pitches.count

        for note in melody {
            // Contrary motion: mirror around midpoint
            let mirrored = 2 * midpoint - Int(note.pitch)
            // Snap to scale
            let snapped = snapToScale(midi: mirrored, key: key, scaleIntervals: scaleIntervals)
            let clamped = UInt8(clamping: max(Int(range.lowerBound), min(Int(range.upperBound), snapped)))

            // Offset rhythm slightly for independence
            let offsetBeat = note.startBeat + 0.5
            let duration = max(0.25, note.duration - 0.25)

            counter.append(NoteEvent(
                pitch: clamped,
                velocity: UInt8(clamping: max(60, Int(note.velocity) - 15)),
                startBeat: offsetBeat,
                duration: duration
            ))
        }

        // Trim to requested bar count
        let maxBeat = Double(bars) * 4.0
        return counter.filter { $0.startBeat < maxBeat }
    }

    // MARK: - Helpers

    private func chordQuality(thirdInterval: Int, fifthInterval: Int) -> ChordQuality {
        switch (thirdInterval, fifthInterval) {
        case (4, 7):  return .major
        case (3, 7):  return .minor
        case (3, 6):  return .diminished
        case (4, 8):  return .augmented
        default:      return .major
        }
    }

    private func snapToScale(midi: Int, key: Key, scaleIntervals: [Int]) -> Int {
        let pc = ((midi % 12) - key.tonic.rawValue + 12) % 12
        let octave = midi / 12

        // Find closest scale degree
        var closest = scaleIntervals[0]
        var minDist = abs(pc - closest)
        for interval in scaleIntervals {
            let dist = abs(pc - interval)
            if dist < minDist {
                minDist = dist
                closest = interval
            }
        }

        return octave * 12 + key.tonic.rawValue + closest
    }
}

// MARK: - Suggestion Types

struct HarmonySuggestion: Sendable {
    let notes: [UInt8]
    let chord: Chord
    let confidence: Double
    let explanation: String
    let source: SuggestionSource
}

struct ChordSuggestion: Sendable {
    let chord: Chord
    let confidence: Double
    let explanation: String
    let source: SuggestionSource
}

enum SuggestionSource: Sendable {
    case ai(model: String, latencyMs: Int)
    case algorithmic
}

// MARK: - Harmony Service

/// AI-powered harmony service with algorithmic fallback.
/// Tries Ollama first for richer suggestions; falls back to `HarmonyEngine`
/// if the server is unavailable or response is too slow.
actor HarmonyService {
    let router: AIRouter
    let harmonyEngine: HarmonyEngine

    /// Maximum time to wait for AI before falling back to algorithmic, in seconds.
    private let aiTimeout: TimeInterval = 3.0

    init(router: AIRouter, harmonyEngine: HarmonyEngine = HarmonyEngine()) {
        self.router = router
        self.harmonyEngine = harmonyEngine
    }

    // MARK: - Harmony Suggestions

    /// Get harmony suggestions for the current musical context.
    /// Tries AI first with a timeout, falls back to algorithmic engine.
    func suggestHarmony(
        currentNotes: [UInt8],
        key: Key,
        recentChords: [Chord],
        style: HarmonyStyle = .auto
    ) async -> [HarmonySuggestion] {
        // Try AI with timeout
        do {
            let result = try await withTimeout(seconds: aiTimeout) {
                try await self.router.route(.harmonySuggestion(
                    notes: currentNotes,
                    key: key,
                    style: style.rawValue
                ))
            }

            if case .harmony(let harmonyResult) = result.result {
                return harmonyResult.suggestions.map { suggestion in
                    HarmonySuggestion(
                        notes: suggestion.notes,
                        chord: parseChordName(suggestion.chordName, fallbackNotes: suggestion.notes),
                        confidence: suggestion.confidence,
                        explanation: suggestion.explanation,
                        source: .ai(model: result.model, latencyMs: result.latencyMs)
                    )
                }
            }
        } catch {
            // AI failed or timed out -- fall through to algorithmic
        }

        // Algorithmic fallback
        return harmonyEngine.suggestHarmony(
            currentNotes: currentNotes,
            key: key,
            style: style
        )
    }

    // MARK: - Next Chord Suggestions

    /// Suggest the next chord in a progression.
    func suggestNextChord(
        currentChord: Chord,
        key: Key,
        style: String?
    ) async -> [ChordSuggestion] {
        // Try AI
        do {
            let progression = [currentChord]
            let result = try await withTimeout(seconds: aiTimeout) {
                try await self.router.route(.harmonySuggestion(
                    notes: currentChord.quality.intervals.map { UInt8(60 + $0) },
                    key: key,
                    style: style
                ))
            }

            if case .harmony(let harmonyResult) = result.result {
                return harmonyResult.suggestions.map { suggestion in
                    ChordSuggestion(
                        chord: parseChordName(suggestion.chordName, fallbackNotes: suggestion.notes),
                        confidence: suggestion.confidence,
                        explanation: suggestion.explanation,
                        source: .ai(model: result.model, latencyMs: result.latencyMs)
                    )
                }
            }
        } catch {
            // Fall through to algorithmic
        }

        return harmonyEngine.suggestNextChord(currentChord: currentChord, key: key)
    }

    // MARK: - Countermelody

    /// Generate a countermelody for the given melody.
    func generateCountermelody(
        melody: [NoteEvent],
        key: Key,
        bars: Int,
        voice: Voice
    ) async -> [NoteEvent] {
        // Try AI (uses reasoning model, so allow longer timeout)
        do {
            let result = try await withTimeout(seconds: 10.0) {
                try await self.router.route(.countermelody(melody: melody, key: key, bars: bars))
            }

            if case .countermelody(let events) = result.result {
                // Clamp to voice range
                return events.map { event in
                    let clamped = UInt8(clamping: max(Int(voice.midiRange.lowerBound),
                                                       min(Int(voice.midiRange.upperBound),
                                                           Int(event.pitch))))
                    return NoteEvent(
                        pitch: clamped,
                        velocity: event.velocity,
                        startBeat: event.startBeat,
                        duration: event.duration
                    )
                }
            }
        } catch {
            // Fall through to algorithmic
        }

        return harmonyEngine.generateCountermelody(
            melody: melody,
            key: key,
            bars: bars,
            voice: voice
        )
    }

    // MARK: - Helpers

    /// Parse a chord name string into a Chord struct.
    private func parseChordName(_ name: String, fallbackNotes: [UInt8]) -> Chord {
        let rootCandidates: [(String, NoteName)] = [
            ("C#", .Cs), ("D#", .Ds), ("F#", .Fs), ("G#", .Gs), ("A#", .As),
            ("Db", .Cs), ("Eb", .Ds), ("Gb", .Fs), ("Ab", .Gs), ("Bb", .As),
            ("C", .C), ("D", .D), ("E", .E), ("F", .F), ("G", .G), ("A", .A), ("B", .B)
        ]

        for (prefix, note) in rootCandidates {
            if name.hasPrefix(prefix) {
                let suffix = String(name.dropFirst(prefix.count))
                let quality = parseQuality(suffix)
                return Chord(root: note, quality: quality, bass: nil)
            }
        }

        // If parsing fails, infer from MIDI notes
        if let firstNote = fallbackNotes.first {
            return Chord(root: NoteName.from(midiNote: firstNote), quality: .major, bass: nil)
        }

        return Chord(root: .C, quality: .major, bass: nil)
    }

    private func parseQuality(_ suffix: String) -> ChordQuality {
        let s = suffix.lowercased()
        if s.isEmpty || s == "maj" { return .major }
        if s == "m" || s == "min" { return .minor }
        if s == "7" || s == "dom7" { return .dominant7 }
        if s == "maj7" { return .major7 }
        if s == "m7" || s == "min7" { return .minor7 }
        if s == "dim" { return .diminished }
        if s == "dim7" { return .diminished7 }
        if s == "aug" || s == "+" { return .augmented }
        if s == "sus2" { return .sus2 }
        if s == "sus4" { return .sus4 }
        if s == "m7b5" { return .halfDiminished7 }
        if s == "9" { return .dominant9 }
        if s == "maj9" { return .major9 }
        if s == "m9" { return .minor9 }
        if s == "add9" { return .add9 }
        if s == "5" { return .power }
        return .major
    }
}

// MARK: - Timeout Utility

/// Run an async operation with a timeout. Throws `OllamaError.timeout` if exceeded.
func withTimeout<T: Sendable>(
    seconds: TimeInterval,
    operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask {
            try await operation()
        }

        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            throw OllamaError.timeout
        }

        guard let result = try await group.next() else {
            throw OllamaError.timeout
        }
        group.cancelAll()
        return result
    }
}
