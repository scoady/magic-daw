// ChordAnalyzer.swift
// MagicDAW
//
// Full chord recognition from sets of MIDI notes.
// Supports triads, sevenths, ninths, elevenths, thirteenths,
// suspended chords, slash chords, and ambiguity ranking.

import Foundation

/// Analyses sets of MIDI notes to recognise chords.
///
/// The algorithm:
/// 1. Extract pitch classes (collapse octaves).
/// 2. Try all 12 possible roots.
/// 3. For each root, compute the interval set.
/// 4. Match against known chord interval templates.
/// 5. Score matches by: matched intervals, extra notes, bass note, commonality, diatonicity.
/// 6. Handle inversions and slash chords automatically.
struct ChordAnalyzer: Sendable {

    // MARK: - Public API

    /// Recognise the most likely chord from a set of MIDI notes.
    ///
    /// - Parameter midiNotes: Currently sounding MIDI note numbers.
    /// - Returns: The best matching chord, or nil if fewer than 2 distinct pitch classes.
    static func analyze(midiNotes: [UInt8]) -> MusicChord? {
        return analyze(midiNotes: midiNotes, in: nil)
    }

    /// Recognise a chord with optional key context for diatonic preference.
    ///
    /// - Parameters:
    ///   - midiNotes: Currently sounding MIDI note numbers.
    ///   - key: If provided, diatonic chords in this key are scored higher.
    /// - Returns: The best matching chord.
    static func analyze(midiNotes: [UInt8], in key: MusicalKey?) -> MusicChord? {
        let ranked = rankedInterpretations(midiNotes: midiNotes, in: key)
        return ranked.first?.chord
    }

    /// Analyse chord and provide Roman numeral analysis in context of a key.
    static func analyzeInKey(midiNotes: [UInt8], key: MusicalKey) -> (chord: MusicChord, romanNumeral: String)? {
        guard let chord = analyze(midiNotes: midiNotes, in: key) else { return nil }
        return (chord, chord.romanNumeral(in: key))
    }

    /// Identify all possible chord interpretations, ranked by likelihood.
    ///
    /// - Parameters:
    ///   - midiNotes: Currently sounding MIDI note numbers.
    ///   - maxResults: Maximum number of results to return.
    /// - Returns: Array of chords ordered from most to least likely.
    static func allInterpretations(midiNotes: [UInt8], maxResults: Int = 5) -> [MusicChord] {
        return allInterpretations(midiNotes: midiNotes, in: nil, maxResults: maxResults)
    }

    /// All interpretations with optional key context.
    static func allInterpretations(midiNotes: [UInt8], in key: MusicalKey?, maxResults: Int = 5) -> [MusicChord] {
        let ranked = rankedInterpretations(midiNotes: midiNotes, in: key)
        var seen = Set<String>()
        var results: [MusicChord] = []
        for match in ranked {
            let name = match.chord.displayName
            if seen.insert(name).inserted {
                results.append(match.chord)
            }
            if results.count >= maxResults { break }
        }
        return results
    }

    // MARK: - Internal Scoring

    /// A scored chord interpretation.
    struct ScoredChord {
        let chord: MusicChord
        let score: Double
    }

    /// Return all interpretations with full scoring, sorted descending.
    static func rankedInterpretations(midiNotes: [UInt8], in key: MusicalKey? = nil) -> [ScoredChord] {
        let sorted = midiNotes.sorted()
        guard let lowestNote = sorted.first else { return [] }

        let pitchClasses = Array(Set(midiNotes.map { Int($0) % 12 })).sorted()
        guard pitchClasses.count >= 2 else { return [] }

        let lowestPC = Int(lowestNote) % 12
        let pitchClassSet = Set(pitchClasses)

        var matches: [ScoredChord] = []

        // Try every pitch class as potential root — not just those present.
        // This allows detection of rootless voicings (e.g., jazz rootless chords).
        for rootPC in 0..<12 {
            let root = NoteName(rawValue: rootPC)!
            let noteIntervals = Set(pitchClasses.map { (($0 - rootPC) % 12 + 12) % 12 })

            for template in chordTemplates {
                let score = scoreMatch(
                    noteIntervals: noteIntervals,
                    notePitchClasses: pitchClassSet,
                    template: template,
                    rootPC: rootPC,
                    lowestPC: lowestPC,
                    rootPresent: pitchClassSet.contains(rootPC),
                    key: key
                )

                if score > 0 {
                    let bass: NoteName?
                    if lowestPC != rootPC {
                        bass = NoteName(rawValue: lowestPC)
                    } else {
                        bass = nil
                    }
                    let chord = MusicChord(root: root, quality: template.quality, bass: bass)
                    matches.append(ScoredChord(chord: chord, score: score))
                }
            }
        }

        return matches.sorted { $0.score > $1.score }
    }

    // MARK: - Templates

    /// Template for matching a chord quality.
    private struct ChordTemplate {
        let quality: ChordQuality
        /// Required intervals (pitch-class space, 0-11). All must be present for a match.
        let required: Set<Int>
        /// Optional intervals that add score if present but aren't required.
        let optional: Set<Int>
        /// Priority boost for commonly used chord types.
        let commonality: Double
    }

    /// MusicChord templates ordered for matching, covering all ChordQuality cases.
    private static let chordTemplates: [ChordTemplate] = {
        var templates: [ChordTemplate] = []

        for quality in ChordQuality.allCases {
            let intervals = quality.intervals.map { $0 % 12 }

            let required: Set<Int>
            let optional: Set<Int>

            switch quality {
            // Triads: all intervals required
            case .major:
                required = Set([0, 4, 7])
                optional = []
            case .minor:
                required = Set([0, 3, 7])
                optional = []
            case .diminished:
                required = Set([0, 3, 6])
                optional = []
            case .augmented:
                required = Set([0, 4, 8])
                optional = []
            case .power:
                required = Set([0, 7])
                optional = []

            // Sevenths: require root + defining intervals
            case .dominant7:
                required = Set([0, 4, 7, 10])
                optional = []
            case .major7:
                required = Set([0, 4, 7, 11])
                optional = []
            case .minor7:
                required = Set([0, 3, 7, 10])
                optional = []
            case .minorMajor7:
                required = Set([0, 3, 7, 11])
                optional = []
            case .halfDiminished7:
                required = Set([0, 3, 6, 10])
                optional = []
            case .diminished7:
                required = Set([0, 3, 6, 9])
                optional = []
            case .augmented7:
                required = Set([0, 4, 8, 10])
                optional = []

            // Suspended: require root, 5th, and the sus note
            case .sus2:
                required = Set([0, 2, 7])
                optional = []
            case .sus4:
                required = Set([0, 5, 7])
                optional = []

            // Add chords: triad + added note
            case .add9:
                required = Set([0, 2, 4, 7])
                optional = []
            case .add11:
                required = Set([0, 4, 5, 7])
                optional = []

            // Ninths: require at least root, 3rd, 7th, 9th (5th optional)
            case .dominant9:
                required = Set([0, 4, 10, 2])
                optional = Set([7])
            case .major9:
                required = Set([0, 4, 11, 2])
                optional = Set([7])
            case .minor9:
                required = Set([0, 3, 10, 2])
                optional = Set([7])

            // Elevenths: require root, 3rd, 7th, 11th (5th, 9th optional)
            case .dominant11:
                required = Set([0, 4, 10, 5])
                optional = Set([7, 2])
            case .major11:
                required = Set([0, 4, 11, 5])
                optional = Set([7, 2])
            case .minor11:
                required = Set([0, 3, 10, 5])
                optional = Set([7, 2])

            // Thirteenths: require root, 3rd, 7th, 13th
            case .dominant13:
                required = Set([0, 4, 10, 9])
                optional = Set([7, 2, 5])
            case .major13:
                required = Set([0, 4, 11, 9])
                optional = Set([7, 2, 5])
            case .minor13:
                required = Set([0, 3, 10, 9])
                optional = Set([7, 2, 5])

            // Altered
            case .altered:
                required = Set([0, 4, 6, 10])
                optional = Set([1, 3, 8])
            }

            templates.append(ChordTemplate(
                quality: quality,
                required: required,
                optional: optional,
                commonality: quality.commonality
            ))
        }

        return templates
    }()

    // MARK: - Scoring

    /// Score a potential chord match.
    ///
    /// Returns 0 if the match is invalid (required intervals not present).
    /// Higher scores indicate better matches.
    private static func scoreMatch(
        noteIntervals: Set<Int>,
        notePitchClasses: Set<Int>,
        template: ChordTemplate,
        rootPC: Int,
        lowestPC: Int,
        rootPresent: Bool,
        key: MusicalKey?
    ) -> Double {

        // All required intervals must be present
        guard template.required.isSubset(of: noteIntervals) else { return 0 }

        var score: Double = 0

        // --- Base: number of matched required tones ---
        score += Double(template.required.count) * 10.0

        // --- Bonus for matched optional tones ---
        let matchedOptional = template.optional.intersection(noteIntervals)
        score += Double(matchedOptional.count) * 3.0

        // --- Penalty for extra notes not in required or optional ---
        let explained = template.required.union(template.optional)
        let extraNotes = noteIntervals.subtracting(explained).subtracting([0]) // root is always OK
        score -= Double(extraNotes.count) * 5.0

        // --- Bonus for exact match (all played notes are explained) ---
        if extraNotes.isEmpty {
            score += 15.0
        }

        // --- Root in bass bonus ---
        if rootPC == lowestPC {
            score += 8.0
        }

        // --- Root present bonus ---
        if rootPresent {
            score += 5.0
        } else {
            // Rootless voicings: small penalty but still valid
            score -= 3.0
        }

        // --- Commonality bonus ---
        score += template.commonality * 8.0

        // --- Simpler chords preferred (fewer required intervals) ---
        score += max(0, Double(6 - template.required.count)) * 1.5

        // --- Diatonic bonus if key context is available ---
        if let key = key {
            let scale = key.scale
            let root = NoteName(rawValue: rootPC)!
            if scale.contains(root) {
                score += 6.0  // Root is diatonic
            }
            // Extra bonus if all chord tones are diatonic
            let chordNotes = template.required.map { root.transposed(by: $0) }
            let allDiatonic = chordNotes.allSatisfy { scale.contains($0) }
            if allDiatonic {
                score += 4.0
            }
        }

        return max(0, score)
    }
}

// MARK: - Convenience Extensions

extension ChordAnalyzer {
    /// Analyse note events (extracts MIDI note numbers and delegates).
    static func analyze(noteEvents: [MIDINoteEvent]) -> MusicChord? {
        let midiNotes = noteEvents.map { $0.note }
        return analyze(midiNotes: midiNotes)
    }

    /// Analyse a `MusicChord` to verify/re-identify it (useful after transposition).
    static func identify(noteNames: [NoteName]) -> MusicChord? {
        let midiNotes = noteNames.map { $0.toMIDI(octave: 4) }
        return analyze(midiNotes: midiNotes)
    }
}
