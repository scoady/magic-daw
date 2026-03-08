// ScaleDatabase.swift
// MagicDAW
//
// Static database of all scales with utilities for lookup, chord-scale matching,
// diatonic chord generation, and functional analysis.

import Foundation

/// Database of all supported scales and modes, with utilities for lookup and search.
struct ScaleDatabase: Sendable {

    // MARK: - All Scales

    /// All possible scales (12 roots x all scale types).
    static let allScales: [Scale] = {
        var scales: [Scale] = []
        for root in NoteName.allCases {
            for mode in ScaleType.allCases {
                scales.append(Scale(root: root, mode: mode))
            }
        }
        return scales
    }()

    // MARK: - Scale Search

    /// Find scales that contain all the given notes.
    static func findScalesContaining(notes: [NoteName]) -> [Scale] {
        allScales.filter { scale in
            notes.allSatisfy { scale.contains($0) }
        }
    }

    /// Find scales that contain all the given MIDI notes.
    static func findScalesContaining(midiNotes: [UInt8]) -> [Scale] {
        let pitchClasses = Array(Set(midiNotes.map { NoteName.from(midiNote: $0) }))
        return findScalesContaining(notes: pitchClasses)
    }

    // MARK: - Suggest Scales for a Chord

    /// Suggest scales that contain all chord tones, scored by fit.
    ///
    /// Scoring considers:
    /// - All chord tones must be present (hard requirement)
    /// - Scales with fewer notes score higher (less ambiguity)
    /// - Common scale types score higher
    /// - Scales where the chord root matches the scale root score higher
    ///
    /// - Parameter chord: The chord to find compatible scales for.
    /// - Returns: Scales sorted by descending fit score.
    static func suggestScales(for chord: Chord) -> [(scale: Scale, score: Double)] {
        let chordTones = chord.noteNames

        var results: [(scale: Scale, score: Double)] = []

        for scale in allScales {
            // Hard requirement: scale must contain all chord tones
            guard chordTones.allSatisfy({ scale.contains($0) }) else { continue }

            var score = 1.0

            // Root match bonus
            if scale.root == chord.root {
                score += 2.0
            }

            // Common scale type bonus
            switch scale.mode {
            case .major, .naturalMinor, .dorian, .mixolydian:
                score += 1.5
            case .harmonicMinor, .melodicMinor, .lydian, .phrygian:
                score += 1.0
            case .majorPentatonic, .minorPentatonic, .blues:
                score += 0.8
            case .aeolian, .locrian:
                score += 0.7
            case .diminishedHW, .diminishedWH, .wholeTone, .altered, .lydianDominant, .superLocrian:
                score += 0.5
            case .chromatic:
                score += 0.0  // Chromatic always matches; not useful
            }

            // Penalty for symmetric/chromatic scales (too many options)
            if scale.mode == .chromatic {
                score -= 5.0
            }

            // Fewer notes = more focused scale
            let noteCount = scale.mode.noteCount
            if noteCount <= 6 {
                score += 0.3
            }

            // Match quality-to-scale idiom
            score += idiomBonus(chord: chord, scale: scale)

            results.append((scale, score))
        }

        return results.sorted { $0.score > $1.score }
    }

    /// Suggest related scales/modes for a given key.
    ///
    /// Returns the parallel modes, relative key scales, and closely related scales.
    static func suggestScales(for key: Key) -> [Scale] {
        var suggestions: [Scale] = []

        // The key's own scale
        suggestions.append(key.scale)

        // Parallel modes (same root, different type)
        let parallelTypes: [ScaleType] = [
            .major, .naturalMinor, .dorian, .mixolydian,
            .lydian, .phrygian, .harmonicMinor, .melodicMinor
        ]
        for mode in parallelTypes where mode != key.mode {
            suggestions.append(Scale(root: key.tonic, mode: mode))
        }

        // Relative key
        let relKey = key.relativeKey
        suggestions.append(relKey.scale)

        // Pentatonic/blues
        suggestions.append(Scale(root: key.tonic, mode: .majorPentatonic))
        suggestions.append(Scale(root: key.tonic, mode: .minorPentatonic))
        suggestions.append(Scale(root: key.tonic, mode: .blues))

        // Deduplicate
        var seen = Set<String>()
        return suggestions.filter { seen.insert($0.displayName).inserted }
    }

    // MARK: - Diatonic Chords

    /// Build diatonic triads on each degree of a scale.
    ///
    /// Only works for 7-note scales. Returns an empty array for pentatonic/blues etc.
    static func diatonicTriads(for scale: Scale) -> [Chord] {
        let pitchClasses = scale.pitchClasses
        guard pitchClasses.count >= 7 else { return [] }

        return (0..<pitchClasses.count).map { index in
            let root = pitchClasses[index]
            let thirdIndex = (index + 2) % pitchClasses.count
            let fifthIndex = (index + 4) % pitchClasses.count

            let thirdInterval = root.interval(to: pitchClasses[thirdIndex])
            let fifthInterval = root.interval(to: pitchClasses[fifthIndex])

            let quality: ChordQuality
            switch (thirdInterval, fifthInterval) {
            case (4, 7): quality = .major
            case (3, 7): quality = .minor
            case (3, 6): quality = .diminished
            case (4, 8): quality = .augmented
            default:     quality = .major
            }

            return Chord(root: root, quality: quality, bass: nil)
        }
    }

    /// Build diatonic seventh chords on each degree of a scale.
    static func diatonicSevenths(for scale: Scale) -> [Chord] {
        let pitchClasses = scale.pitchClasses
        guard pitchClasses.count >= 7 else { return [] }

        return (0..<pitchClasses.count).map { index in
            let root = pitchClasses[index]
            let thirdPC = pitchClasses[(index + 2) % pitchClasses.count]
            let fifthPC = pitchClasses[(index + 4) % pitchClasses.count]
            let seventhPC = pitchClasses[(index + 6) % pitchClasses.count]

            let third = root.interval(to: thirdPC)
            let fifth = root.interval(to: fifthPC)
            let seventh = root.interval(to: seventhPC)

            let quality: ChordQuality
            switch (third, fifth, seventh) {
            case (4, 7, 11): quality = .major7
            case (3, 7, 10): quality = .minor7
            case (4, 7, 10): quality = .dominant7
            case (3, 6, 10): quality = .halfDiminished7
            case (3, 6, 9):  quality = .diminished7
            case (3, 7, 11): quality = .minorMajor7
            case (4, 8, 10): quality = .augmented7
            default:         quality = .dominant7
            }

            return Chord(root: root, quality: quality, bass: nil)
        }
    }

    /// Alias for `diatonicTriads(for:)`.
    static func diatonicChords(for scale: Scale) -> [Chord] {
        diatonicTriads(for: scale)
    }

    /// All common chords in a scale (triads + sevenths, deduplicated).
    static func commonChords(in scale: Scale) -> [Chord] {
        let triads = diatonicTriads(for: scale)
        let sevenths = diatonicSevenths(for: scale)
        var seen = Set<String>()
        var result: [Chord] = []
        for chord in triads + sevenths {
            if seen.insert(chord.displayName).inserted {
                result.append(chord)
            }
        }
        return result
    }

    // MARK: - Functional Analysis

    /// Determine the function of a chord in a key.
    ///
    /// Returns roman numeral strings like "I", "ii", "V7", "bVI", etc.
    static func chordFunction(chord: Chord, in key: Key) -> String {
        return chord.romanNumeral(in: key)
    }

    /// Get the scale degree (1-7) of a chord's root in a key, or nil if chromatic.
    static func scaleDegree(of chord: Chord, in key: Key) -> Int? {
        return key.scale.degree(of: chord.root)
    }

    // MARK: - Relative Modes

    /// Get relative modes for a scale (same notes, different root).
    ///
    /// Only applies to 7-note diatonic scales.
    static func relativeModes(for scale: Scale) -> [Scale] {
        let notes = scale.pitchClasses
        guard notes.count == 7 else { return [scale] }

        let parentModes: [ScaleType] = [
            .major, .dorian, .phrygian, .lydian, .mixolydian, .aeolian, .locrian
        ]

        return notes.enumerated().compactMap { index, root in
            guard index < parentModes.count else { return nil }
            return Scale(root: root, mode: parentModes[index])
        }
    }

    // MARK: - Suggest Next Chords

    /// Suggest chords that fit well after a given chord in a key.
    ///
    /// Uses common progression tendencies to rank suggestions.
    static func suggestNextChords(after chord: Chord, in key: Key, count: Int = 4) -> [Chord] {
        let diatonic = diatonicChords(for: key.scale)
        guard !diatonic.isEmpty else { return [] }

        let currentDegree = key.tonic.interval(to: chord.root)

        // Common chord-progression tendencies (semitone offset -> likely next offsets)
        let tendencies: [Int: [Int]] = [
            0:  [5, 7, 4, 9],     // I  -> IV, V, III, vi
            1:  [0, 7, 5],        // bII -> I, V, IV
            2:  [5, 7, 0],        // ii -> IV, V, I
            3:  [5, 0, 7, 8],     // bIII/iii -> IV, I, V, bVI
            4:  [5, 0, 7],        // III -> IV, I, V
            5:  [7, 0, 2, 9],     // IV -> V, I, ii, vi
            6:  [7, 0, 5],        // #IV/bV -> V, I, IV
            7:  [0, 5, 9, 2],     // V -> I, IV, vi, ii
            8:  [7, 0, 5, 3],     // bVI -> V, I, IV, bIII
            9:  [5, 2, 7, 0],     // vi -> IV, ii, V, I
            10: [0, 5, 7],        // bVII -> I, IV, V
            11: [0, 7, 5],        // vii -> I, V, IV
        ]

        let nextDegrees = tendencies[currentDegree] ?? [0, 5, 7]

        var suggestions: [Chord] = []
        for degree in nextDegrees {
            if let chord = diatonic.first(where: { key.tonic.interval(to: $0.root) == degree }) {
                suggestions.append(chord)
            }
            if suggestions.count >= count { break }
        }

        // Fill remaining with other diatonic chords
        for diatonicChord in diatonic {
            if suggestions.count >= count { break }
            if !suggestions.contains(where: { $0.displayName == diatonicChord.displayName }) {
                suggestions.append(diatonicChord)
            }
        }

        return Array(suggestions.prefix(count))
    }

    // MARK: - Private Helpers

    /// Idiom bonus: common chord-quality-to-scale-type pairings get a score boost.
    private static func idiomBonus(chord: Chord, scale: Scale) -> Double {
        guard scale.root == chord.root else { return 0 }

        switch (chord.quality, scale.mode) {
        // Major chords pair naturally with major/lydian/mixolydian
        case (.major, .major), (.major, .lydian), (.major, .mixolydian):
            return 1.0
        // Minor chords pair with natural minor/dorian/phrygian/aeolian
        case (.minor, .naturalMinor), (.minor, .dorian), (.minor, .aeolian):
            return 1.0
        case (.minor, .phrygian):
            return 0.8
        // Dom7 -> mixolydian, lydian dominant, altered
        case (.dominant7, .mixolydian), (.dominant7, .lydianDominant):
            return 1.2
        case (.dominant7, .altered), (.dominant7, .superLocrian):
            return 0.9
        // Minor7 -> dorian, aeolian
        case (.minor7, .dorian), (.minor7, .aeolian), (.minor7, .naturalMinor):
            return 1.0
        // Major7 -> major, lydian
        case (.major7, .major), (.major7, .lydian):
            return 1.0
        // Diminished -> diminished scales
        case (.diminished, .diminishedHW), (.diminished7, .diminishedWH):
            return 1.2
        // Half-diminished -> locrian
        case (.halfDiminished7, .locrian):
            return 1.2
        // Augmented -> whole tone
        case (.augmented, .wholeTone):
            return 1.0
        // Blues
        case (_, .blues), (_, .minorPentatonic):
            return 0.5
        default:
            return 0
        }
    }
}
