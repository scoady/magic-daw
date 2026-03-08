import Foundation

// MARK: - Arrangement Types

struct ArrangementResult: Codable, Sendable {
    let sections: [ArrangementSection]
    let explanation: String
}

struct ArrangementSection: Codable, Sendable {
    let name: String       // "Intro", "Verse", "Chorus", "Bridge", "Outro"
    let startBar: Int
    let endBar: Int
    let chords: [String]
    let instruments: [String]
    let dynamics: String   // "pp", "p", "mp", "mf", "f", "ff"
    let notes: String      // Brief description of what happens in this section
}

struct MusicContext: Codable, Sendable {
    let key: String
    let bpm: Double
    let timeSignature: String
    let currentChords: [String]
    let genre: String?
    let trackNames: [String]
}

// MARK: - Arrangement Service

/// AI arrangement assistance. Uses Ollama's reasoning model for complex
/// arrangement tasks and the fast model for quick suggestions.
actor ArrangementService {
    let router: AIRouter

    init(router: AIRouter) {
        self.router = router
    }

    // MARK: - Full Arrangement

    /// Suggest a full arrangement from a chord progression.
    /// Uses the reasoning model for structural analysis.
    func suggestArrangement(
        progression: [Chord],
        key: Key,
        bpm: Double,
        genre: String,
        bars: Int
    ) async throws -> ArrangementResult {
        let result = try await router.route(.arrangementSuggestion(
            progression: progression,
            key: key,
            genre: genre
        ))

        if case .arrangement(let arrangement) = result.result {
            return validateArrangement(arrangement, maxBars: bars)
        }

        throw ArrangementError.unexpectedResult
    }

    /// Suggest an arrangement with algorithmic fallback.
    func suggestArrangementWithFallback(
        progression: [Chord],
        key: Key,
        bpm: Double,
        genre: String,
        bars: Int
    ) async -> ArrangementResult {
        do {
            return try await suggestArrangement(
                progression: progression,
                key: key,
                bpm: bpm,
                genre: genre,
                bars: bars
            )
        } catch {
            return algorithmicArrangement(
                progression: progression,
                key: key,
                genre: genre,
                bars: bars
            )
        }
    }

    // MARK: - Reharmonization

    /// Reharmonize a chord progression in a given style.
    func reharmonize(
        original: [Chord],
        key: Key,
        style: String
    ) async throws -> [Chord] {
        let result = try await router.route(.reharmonization(
            progression: original,
            key: key,
            style: style
        ))

        if case .harmony(let harmonyResult) = result.result {
            return harmonyResult.suggestions.compactMap { suggestion in
                parseChordName(suggestion.chordName)
            }
        }

        throw ArrangementError.unexpectedResult
    }

    /// Reharmonize with fallback that returns the original progression.
    func reharmonizeWithFallback(
        original: [Chord],
        key: Key,
        style: String
    ) async -> [Chord] {
        do {
            let result = try await reharmonize(original: original, key: key, style: style)
            return result.isEmpty ? original : result
        } catch {
            return algorithmicReharmonize(original: original, key: key, style: style)
        }
    }

    // MARK: - Natural Language

    /// Process a natural language instruction about the arrangement.
    /// Returns a text response with actionable suggestions.
    func processInstruction(
        instruction: String,
        context: MusicContext
    ) async throws -> String {
        let result = try await router.route(.naturalLanguage(
            instruction: instruction,
            context: context
        ))

        if case .text(let response) = result.result {
            return response
        }

        throw ArrangementError.unexpectedResult
    }

    // MARK: - Validation

    private func validateArrangement(_ arrangement: ArrangementResult, maxBars: Int) -> ArrangementResult {
        // Ensure sections don't exceed the requested bar count
        let validSections = arrangement.sections.map { section in
            ArrangementSection(
                name: section.name,
                startBar: max(1, section.startBar),
                endBar: min(maxBars, max(section.startBar, section.endBar)),
                chords: section.chords.isEmpty ? ["N.C."] : section.chords,
                instruments: section.instruments,
                dynamics: validDynamic(section.dynamics),
                notes: section.notes
            )
        }.filter { $0.startBar <= maxBars }

        guard !validSections.isEmpty else {
            return algorithmicArrangement(
                progression: [],
                key: Key(tonic: .C, mode: .major, confidence: 1.0),
                genre: "pop",
                bars: maxBars
            )
        }

        return ArrangementResult(sections: validSections, explanation: arrangement.explanation)
    }

    private func validDynamic(_ dynamic: String) -> String {
        let valid = ["pp", "p", "mp", "mf", "f", "ff"]
        return valid.contains(dynamic.lowercased()) ? dynamic.lowercased() : "mf"
    }

    // MARK: - Algorithmic Fallbacks

    private func algorithmicArrangement(
        progression: [Chord],
        key: Key,
        genre: String,
        bars: Int
    ) -> ArrangementResult {
        let chordNames = progression.isEmpty
            ? ["I", "V", "vi", "IV"]
            : progression.map(\.displayName)

        // Standard pop/rock structure
        let structure: [(String, Int, String, [String])]

        if bars <= 16 {
            structure = [
                ("Intro", 4, "mp", ["piano"]),
                ("Verse", 8, "mf", ["piano", "bass", "drums"]),
                ("Outro", 4, "mp", ["piano"])
            ]
        } else if bars <= 32 {
            structure = [
                ("Intro", 4, "mp", ["piano", "strings"]),
                ("Verse", 8, "mf", ["piano", "bass", "drums"]),
                ("Chorus", 8, "f", ["piano", "bass", "drums", "strings"]),
                ("Verse 2", 8, "mf", ["piano", "bass", "drums", "guitar"]),
                ("Outro", 4, "mp", ["piano", "strings"])
            ]
        } else {
            structure = [
                ("Intro", 4, "p", ["piano"]),
                ("Verse 1", 8, "mf", ["piano", "bass", "drums"]),
                ("Pre-Chorus", 4, "mf", ["piano", "bass", "drums", "strings"]),
                ("Chorus", 8, "f", ["piano", "bass", "drums", "strings", "synth"]),
                ("Verse 2", 8, "mf", ["piano", "bass", "drums", "guitar"]),
                ("Pre-Chorus", 4, "mf", ["piano", "bass", "drums", "strings"]),
                ("Chorus", 8, "f", ["piano", "bass", "drums", "strings", "synth"]),
                ("Bridge", 8, "mp", ["piano", "strings"]),
                ("Final Chorus", 8, "ff", ["piano", "bass", "drums", "strings", "synth", "brass"]),
                ("Outro", 4, "p", ["piano"])
            ]
        }

        var sections: [ArrangementSection] = []
        var currentBar = 1

        for (name, length, dynamic, instruments) in structure {
            guard currentBar <= bars else { break }
            let endBar = min(currentBar + length - 1, bars)

            sections.append(ArrangementSection(
                name: name,
                startBar: currentBar,
                endBar: endBar,
                chords: chordNames,
                instruments: genreInstruments(genre, base: instruments),
                dynamics: dynamic,
                notes: "\(name) section"
            ))

            currentBar = endBar + 1
        }

        return ArrangementResult(
            sections: sections,
            explanation: "Standard \(genre) arrangement structure (algorithmic fallback)"
        )
    }

    /// Adjust instruments based on genre.
    private func genreInstruments(_ genre: String, base: [String]) -> [String] {
        let g = genre.lowercased()
        var instruments = base

        if g.contains("jazz") {
            instruments = instruments.map {
                $0 == "guitar" ? "jazz guitar" :
                $0 == "drums" ? "brushes" :
                $0 == "synth" ? "rhodes" : $0
            }
            if !instruments.contains("upright bass") {
                instruments = instruments.map { $0 == "bass" ? "upright bass" : $0 }
            }
        } else if g.contains("electronic") || g.contains("edm") {
            instruments = instruments.map {
                $0 == "piano" ? "synth pad" :
                $0 == "guitar" ? "synth lead" :
                $0 == "drums" ? "drum machine" : $0
            }
        } else if g.contains("orchestral") || g.contains("cinematic") {
            instruments = instruments.map {
                $0 == "guitar" ? "woodwinds" :
                $0 == "synth" ? "brass" :
                $0 == "drums" ? "timpani" : $0
            }
        }

        return instruments
    }

    /// Simple algorithmic reharmonization.
    private func algorithmicReharmonize(
        original: [Chord],
        key: Key,
        style: String
    ) -> [Chord] {
        let s = style.lowercased()

        if s.contains("jazz") {
            // Add 7ths to all chords
            return original.map { chord in
                let newQuality: ChordQuality
                switch chord.quality {
                case .major:      newQuality = .major7
                case .minor:      newQuality = .minor7
                case .diminished: newQuality = .halfDiminished7
                default:          newQuality = chord.quality
                }
                return Chord(root: chord.root, quality: newQuality, bass: nil)
            }
        } else if s.contains("simple") || s.contains("pop") {
            // Simplify to triads
            return original.map { chord in
                let newQuality: ChordQuality
                switch chord.quality {
                case .major7, .dominant7, .dominant9, .major9:  newQuality = .major
                case .minor7, .minor9, .minorMajor7:           newQuality = .minor
                case .halfDiminished7, .diminished7:            newQuality = .diminished
                default:                                        newQuality = chord.quality
                }
                return Chord(root: chord.root, quality: newQuality, bass: nil)
            }
        } else if s.contains("modal") {
            // Borrow from parallel minor/major
            return original.map { chord in
                if chord.quality == .major && Bool.random() {
                    return Chord(root: chord.root, quality: .minor, bass: nil)
                }
                return chord
            }
        }

        return original
    }

    // MARK: - Chord Parsing

    private func parseChordName(_ name: String) -> Chord? {
        let rootCandidates: [(String, NoteName)] = [
            ("C#", .Cs), ("D#", .Ds), ("F#", .Fs), ("G#", .Gs), ("A#", .As),
            ("Db", .Cs), ("Eb", .Ds), ("Gb", .Fs), ("Ab", .Gs), ("Bb", .As),
            ("C", .C), ("D", .D), ("E", .E), ("F", .F), ("G", .G), ("A", .A), ("B", .B)
        ]

        for (prefix, note) in rootCandidates {
            if name.hasPrefix(prefix) {
                let suffix = String(name.dropFirst(prefix.count))

                // Check for slash chord
                var bass: NoteName? = nil
                var qualitySuffix = suffix
                if let slashIndex = suffix.firstIndex(of: "/") {
                    let bassStr = String(suffix[suffix.index(after: slashIndex)...])
                    qualitySuffix = String(suffix[..<slashIndex])
                    for (bp, bn) in rootCandidates {
                        if bassStr.hasPrefix(bp) {
                            bass = bn
                            break
                        }
                    }
                }

                let quality = parseQuality(qualitySuffix)
                return Chord(root: note, quality: quality, bass: bass)
            }
        }
        return nil
    }

    private func parseQuality(_ suffix: String) -> ChordQuality {
        let s = suffix.lowercased()
        switch s {
        case "", "maj":                     return .major
        case "m", "min":                    return .minor
        case "7", "dom7":                   return .dominant7
        case "maj7":                        return .major7
        case "m7", "min7":                  return .minor7
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
        case "mmaj7":                       return .minorMajor7
        case "aug7":                        return .augmented7
        default:                            return .major
        }
    }
}

// MARK: - Errors

enum ArrangementError: Error, LocalizedError {
    case unexpectedResult
    case emptyProgression

    var errorDescription: String? {
        switch self {
        case .unexpectedResult:
            return "Received unexpected result type from AI router"
        case .emptyProgression:
            return "Cannot arrange an empty chord progression"
        }
    }
}
