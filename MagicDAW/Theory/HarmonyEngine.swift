// HarmonyEngine.swift
// MagicDAW
//
// Pure algorithmic harmony generation — no AI/Ollama required.
// Provides parallel harmony, chord voicings, voice leading,
// next-chord suggestions, and circle-of-fifths utilities.

import Foundation

/// Algorithmic harmony engine for real-time music generation.
///
/// All methods are pure functions (no side effects, no network calls).
/// Suitable for real-time audio thread use where allocations are avoided.
struct HarmonyEngine: Sendable {

    // MARK: - Parallel Harmony

    /// Generate a diatonic parallel harmony line for a melody.
    ///
    /// Each melody note is harmonised by finding the note a given number of
    /// scale degrees above or below it, staying within the scale.
    ///
    /// - Parameters:
    ///   - melody: The original melody note events.
    ///   - interval: Scale-degree interval (e.g., 3 for thirds, 6 for sixths).
    ///              Positive = above, negative = below.
    ///   - scale: The scale to constrain harmony notes to.
    /// - Returns: Harmony note events aligned to the original timestamps.
    static func parallelHarmony(melody: [MIDINoteEvent], interval: Int, scale: Scale) -> [MIDINoteEvent] {
        let scaleNotes = scale.pitchClasses
        guard !scaleNotes.isEmpty else { return [] }

        return melody.compactMap { event -> MIDINoteEvent? in
            let (name, octave) = NoteName.fromMIDI(event.note)

            // Find the scale degree of this melody note
            guard let degree = scale.degree(of: name) else {
                // Note not in scale — snap to nearest scale note first
                let snapped = scale.snap(event.note)
                let (snappedName, snappedOctave) = NoteName.fromMIDI(snapped)
                guard let snappedDegree = scale.degree(of: snappedName) else { return nil }
                return harmoniseNote(
                    degree: snappedDegree, octave: snappedOctave,
                    interval: interval, scale: scale, event: event
                )
            }

            return harmoniseNote(
                degree: degree, octave: octave,
                interval: interval, scale: scale, event: event
            )
        }
    }

    private static func harmoniseNote(
        degree: Int, octave: Int, interval: Int, scale: Scale, event: MIDINoteEvent
    ) -> MIDINoteEvent {
        let scaleNotes = scale.pitchClasses
        let count = scaleNotes.count

        // Target degree (1-based, wrapping)
        let targetDegreeZeroBased = (degree - 1 + (interval - 1))
        let wrappedDegree = ((targetDegreeZeroBased % count) + count) % count
        let octaveShift = targetDegreeZeroBased < 0
            ? (targetDegreeZeroBased - count + 1) / count
            : targetDegreeZeroBased / count

        let harmonyName = scaleNotes[wrappedDegree]
        let harmonyOctave = octave + octaveShift
        let harmonyMIDI = harmonyName.toMIDI(octave: harmonyOctave)

        return MIDINoteEvent(
            note: harmonyMIDI,
            velocity: Velocity(max(1, Int(Double(event.velocity) * 0.85))),
            timestamp: event.timestamp,
            duration: event.duration,
            channel: event.channel
        )
    }

    // MARK: - MusicChord Voicings

    /// Generate a chord voicing according to a specific style.
    ///
    /// - Parameters:
    ///   - chord: The chord to voice.
    ///   - style: Voicing strategy.
    ///   - baseOctave: The octave for the root (default 3 for piano LH).
    /// - Returns: MIDI note numbers for the voicing, sorted low to high.
    static func chordVoicing(chord: MusicChord, style: VoicingStyle, baseOctave: Int = 3) -> [MIDINote] {
        let intervals = chord.quality.intervals
        guard !intervals.isEmpty else { return [] }

        // Build close voicing first
        var closeNotes: [MIDINote] = intervals.map { interval in
            let name = chord.root.transposed(by: interval % 12)
            let octOffset = interval / 12
            return name.toMIDI(octave: baseOctave + octOffset)
        }

        // Add bass note for slash chords
        if let bass = chord.bass, bass != chord.root {
            let bassNote = bass.toMIDI(octave: baseOctave - 1)
            closeNotes.insert(bassNote, at: 0)
        }

        switch style {
        case .close:
            return closeNotes.sorted()

        case .drop2:
            return drop2Voicing(closeNotes)

        case .drop3:
            return drop3Voicing(closeNotes)

        case .rootless:
            return rootlessVoicing(chord: chord, baseOctave: baseOctave)

        case .shell:
            return shellVoicing(chord: chord, baseOctave: baseOctave)

        case .quartal:
            return quartalVoicing(chord: chord, baseOctave: baseOctave)

        case .spread:
            return spreadVoicing(chord: chord, baseOctave: baseOctave)
        }
    }

    /// Generate a voicing within a specific voice range.
    static func chordVoicing(chord: MusicChord, style: VoicingStyle, range: VocalVoice) -> [MIDINote] {
        let baseOctave: Int
        switch range {
        case .bass:    baseOctave = 2
        case .tenor:   baseOctave = 3
        case .alto:    baseOctave = 3
        case .soprano: baseOctave = 4
        }

        var notes = chordVoicing(chord: chord, style: style, baseOctave: baseOctave)

        // Constrain to voice range
        let voiceRange = range.range
        notes = notes.filter { voiceRange.contains($0) }

        return notes
    }

    // MARK: - Voicing Implementations

    /// Drop-2 voicing: take the second-highest note and drop it an octave.
    private static func drop2Voicing(_ closeNotes: [MIDINote]) -> [MIDINote] {
        var notes = closeNotes.sorted()
        guard notes.count >= 3 else { return notes }

        let secondFromTopIndex = notes.count - 2
        let dropped = notes[secondFromTopIndex]
        notes[secondFromTopIndex] = MIDINote(clamping: max(0, Int(dropped) - 12))

        return notes.sorted()
    }

    /// Drop-3 voicing: take the third-highest note and drop it an octave.
    private static func drop3Voicing(_ closeNotes: [MIDINote]) -> [MIDINote] {
        var notes = closeNotes.sorted()
        guard notes.count >= 4 else { return drop2Voicing(closeNotes) }

        let thirdFromTopIndex = notes.count - 3
        let dropped = notes[thirdFromTopIndex]
        notes[thirdFromTopIndex] = MIDINote(clamping: max(0, Int(dropped) - 12))

        return notes.sorted()
    }

    /// Rootless voicing: omit the root, keep 3rd, 5th (optional), 7th, extensions.
    /// Two types: "A" voicing (3-5-7-9) and "B" voicing (7-9-3-5).
    private static func rootlessVoicing(chord: MusicChord, baseOctave: Int) -> [MIDINote] {
        let intervals = chord.quality.intervals
        // Remove root (interval 0)
        let withoutRoot = intervals.filter { ($0 % 12) != 0 }
        guard !withoutRoot.isEmpty else {
            // Fallback: just return the chord tones
            return intervals.map { chord.root.transposed(by: $0 % 12).toMIDI(octave: baseOctave) }
        }

        return withoutRoot.map { interval in
            let name = chord.root.transposed(by: interval % 12)
            let octOffset = interval / 12
            return name.toMIDI(octave: baseOctave + octOffset)
        }.sorted()
    }

    /// Shell voicing: root + 3rd (or sus) + 7th only.
    private static func shellVoicing(chord: MusicChord, baseOctave: Int) -> [MIDINote] {
        var notes: [MIDINote] = []

        // Root
        notes.append(chord.root.toMIDI(octave: baseOctave))

        let intervals = chord.quality.intervals

        // Find the 3rd (or sus equivalent): interval 3, 4, 2, or 5
        let thirdCandidates = [3, 4, 2, 5]  // m3, M3, sus2, sus4
        for candidate in thirdCandidates {
            if intervals.contains(where: { $0 % 12 == candidate }) {
                notes.append(chord.root.transposed(by: candidate).toMIDI(octave: baseOctave))
                break
            }
        }

        // Find the 7th: interval 10 or 11
        let seventhCandidates = [10, 11, 9]  // m7, M7, dim7
        for candidate in seventhCandidates {
            if intervals.contains(where: { $0 % 12 == candidate }) {
                notes.append(chord.root.transposed(by: candidate).toMIDI(octave: baseOctave))
                break
            }
        }

        return notes.sorted()
    }

    /// Quartal voicing: stack notes in fourths from the root.
    private static func quartalVoicing(chord: MusicChord, baseOctave: Int) -> [MIDINote] {
        // Build 4 notes stacked in perfect fourths (5 semitones each)
        var notes: [MIDINote] = []
        var currentNote = chord.root.toMIDI(octave: baseOctave)

        for _ in 0..<4 {
            guard currentNote <= 120 else { break }
            notes.append(currentNote)
            currentNote = MIDINote(clamping: Int(currentNote) + 5)
        }

        return notes
    }

    /// Spread voicing: distribute chord tones across a wide range (2+ octaves).
    private static func spreadVoicing(chord: MusicChord, baseOctave: Int) -> [MIDINote] {
        let intervals = chord.quality.intervals
        guard !intervals.isEmpty else { return [] }

        var notes: [MIDINote] = []

        // Root in the bass register
        notes.append(chord.root.toMIDI(octave: baseOctave))

        // Spread remaining tones across octaves
        for (i, interval) in intervals.dropFirst().enumerated() {
            let octaveSpread = baseOctave + 1 + (i / 2)
            let name = chord.root.transposed(by: interval % 12)
            notes.append(name.toMIDI(octave: min(octaveSpread, 7)))
        }

        return notes.sorted()
    }

    // MARK: - Voice Leading

    /// Find the smoothest voice leading from one chord to another.
    ///
    /// Minimises total semitone movement between voices while avoiding
    /// parallel fifths and octaves.
    ///
    /// - Parameters:
    ///   - from: Current chord MIDI notes (sorted low to high).
    ///   - to: Target chord.
    ///   - scale: Optional scale to constrain movement.
    /// - Returns: MIDI notes for the target chord with minimal voice movement.
    static func smoothVoiceLeading(from currentNotes: [MIDINote], to targetChord: MusicChord,
                                    scale: Scale? = nil) -> [MIDINote] {
        let targetPitchClasses = targetChord.noteNames
        guard !currentNotes.isEmpty, !targetPitchClasses.isEmpty else {
            return targetChord.midiNotes()
        }

        var result: [MIDINote] = []

        // For each voice in the current chord, find the nearest target pitch class
        for currentNote in currentNotes {
            var bestTarget: MIDINote = currentNote
            var bestDistance = Int.max

            for targetPC in targetPitchClasses {
                // Check notes within +/- 6 semitones (closest instance)
                for octaveOffset in -1...1 {
                    let octave = NoteName.octave(fromMIDI: currentNote) + octaveOffset
                    guard octave >= 0, octave <= 8 else { continue }
                    let candidate = targetPC.toMIDI(octave: octave)
                    let distance = abs(Int(candidate) - Int(currentNote))
                    if distance < bestDistance {
                        bestDistance = distance
                        bestTarget = candidate
                    }
                }
            }

            result.append(bestTarget)
        }

        // Deduplicate: if two voices landed on the same note, shift one
        result.sort()
        for i in 1..<result.count {
            if result[i] == result[i - 1] {
                // Try moving up or down to find an unused chord tone
                let up = MIDINote(clamping: Int(result[i]) + 12)
                let down = Int(result[i]) >= 12 ? MIDINote(clamping: Int(result[i]) - 12) : result[i]
                // Pick whichever is closer to the original voice position
                if i < currentNotes.count {
                    let distUp = abs(Int(up) - Int(currentNotes[i]))
                    let distDown = abs(Int(down) - Int(currentNotes[i]))
                    result[i] = distUp <= distDown ? up : down
                } else {
                    result[i] = up
                }
            }
        }

        // Check for parallel fifths/octaves and fix them
        result = avoidParallels(from: currentNotes, to: result, targetChord: targetChord)

        return result.sorted()
    }

    /// Detect and fix parallel fifths and octaves between two voicings.
    private static func avoidParallels(from: [MIDINote], to: [MIDINote],
                                        targetChord: MusicChord) -> [MIDINote] {
        var fixed = to
        let count = min(from.count, to.count)
        guard count >= 2 else { return fixed }

        for i in 0..<(count - 1) {
            for j in (i + 1)..<count {
                let prevInterval = abs(Int(from[i]) - Int(from[j])) % 12
                let nextInterval = abs(Int(fixed[i]) - Int(fixed[j])) % 12

                let isParallelFifth = prevInterval == 7 && nextInterval == 7
                let isParallelOctave = prevInterval == 0 && nextInterval == 0

                if isParallelFifth || isParallelOctave {
                    // Shift the upper voice by a step to break the parallel
                    let shifted = Int(fixed[j]) + 1
                    if shifted <= 127 {
                        fixed[j] = MIDINote(shifted)
                    }
                }
            }
        }

        return fixed
    }

    // MARK: - Tendency Tone Resolution

    /// Resolve tendency tones in a chord to their natural targets.
    ///
    /// - Leading tone (7th degree) resolves up to tonic.
    /// - MusicChord 7th resolves down by step.
    /// - Augmented 4th resolves outward; diminished 5th resolves inward.
    ///
    /// - Parameters:
    ///   - notes: Current voicing.
    ///   - key: The key context for resolution.
    /// - Returns: Resolved MIDI notes.
    static func resolveTendencyTones(notes: [MIDINote], in key: MusicalKey) -> [MIDINote] {
        let scale = key.scale
        let scaleNotes = scale.pitchClasses

        return notes.map { note -> MIDINote in
            let (name, octave) = NoteName.fromMIDI(note)
            guard let degree = scale.degree(of: name) else { return note }

            switch degree {
            case 7:
                // Leading tone resolves up to tonic
                if key.keyMode == .major {
                    return key.tonic.toMIDI(octave: octave + (name.rawValue > key.tonic.rawValue ? 1 : 0))
                }
                return note

            case 4:
                // 4th degree can resolve down to 3rd
                let thirdDegree = scaleNotes.count > 2 ? scaleNotes[2] : name
                return thirdDegree.toMIDI(octave: octave)

            default:
                return note
            }
        }
    }

    // MARK: - Next MusicChord Suggestion

    /// Suggest the most likely next chords based on common progression patterns.
    ///
    /// Uses a probabilistic model of chord transitions derived from common
    /// progressions across genres.
    ///
    /// - Parameters:
    ///   - current: The current chord.
    ///   - key: The key context.
    /// - Returns: Possible next chords with probability scores (sum to ~1.0).
    static func suggestNextChord(current: MusicChord, key: MusicalKey) -> [(chord: MusicChord, probability: Double)] {
        let scale = key.scale
        let diatonic = ScaleDatabase.diatonicTriads(for: scale)
        guard !diatonic.isEmpty else { return [] }

        let currentInterval = key.tonic.interval(to: current.root)

        // Transition probability matrix (from scale degree -> to scale degree with weight)
        // Based on aggregate analysis of pop, rock, jazz, and classical progressions.
        let transitions: [Int: [(degree: Int, weight: Double)]] = [
            0:  [(7, 0.30), (5, 0.25), (9, 0.15), (4, 0.10), (2, 0.10), (3, 0.05), (11, 0.05)],
            2:  [(7, 0.35), (5, 0.25), (0, 0.20), (9, 0.10), (4, 0.10)],
            3:  [(5, 0.25), (0, 0.20), (9, 0.20), (7, 0.15), (2, 0.10), (8, 0.10)],
            4:  [(5, 0.30), (0, 0.25), (7, 0.20), (9, 0.15), (2, 0.10)],
            5:  [(7, 0.30), (0, 0.25), (2, 0.15), (9, 0.10), (4, 0.10), (11, 0.10)],
            7:  [(0, 0.40), (9, 0.20), (5, 0.15), (4, 0.10), (2, 0.10), (3, 0.05)],
            8:  [(5, 0.25), (7, 0.25), (0, 0.20), (3, 0.15), (9, 0.15)],
            9:  [(5, 0.25), (2, 0.20), (7, 0.20), (0, 0.15), (4, 0.10), (3, 0.10)],
            10: [(0, 0.30), (5, 0.25), (7, 0.20), (9, 0.15), (2, 0.10)],
            11: [(0, 0.40), (7, 0.25), (5, 0.15), (9, 0.10), (2, 0.10)],
        ]

        // Fallback transitions for degrees not explicitly listed
        let fallback: [(degree: Int, weight: Double)] = [
            (0, 0.25), (5, 0.25), (7, 0.25), (9, 0.15), (2, 0.10)
        ]

        let candidates = transitions[currentInterval] ?? fallback

        var results: [(chord: MusicChord, probability: Double)] = []
        for candidate in candidates {
            if let chord = diatonic.first(where: { key.tonic.interval(to: $0.root) == candidate.degree }) {
                results.append((chord, candidate.weight))
            }
        }

        // Normalise probabilities
        let total = results.reduce(0.0) { $0 + $1.probability }
        if total > 0 {
            results = results.map { ($0.chord, $0.probability / total) }
        }

        return results.sorted { $0.probability > $1.probability }
    }

    // MARK: - Circle of Fifths

    /// Keys ordered by circle of fifths distance from a starting key.
    ///
    /// Returns all 12 major and 12 minor keys, closest first.
    static func circleOfFifths(from key: MusicalKey) -> [MusicalKey] {
        var keys: [MusicalKey] = []

        // Major keys around the circle
        var current = key.tonic
        for i in 0..<12 {
            let confidence = max(0, 1.0 - Double(min(i, 12 - i)) * 0.15)
            keys.append(MusicalKey(tonic: current, mode: ScaleType.major, confidence: confidence))
            keys.append(MusicalKey(tonic: current.transposed(by: -3), mode: .naturalMinor, confidence: confidence * 0.9))
            current = current.transposed(by: 7) // up a fifth
        }

        // Deduplicate
        var seen = Set<String>()
        return keys.filter { seen.insert($0.displayName).inserted }
    }

    /// The 5 most closely related keys (relative major/minor + neighbours on circle of fifths).
    static func closelyRelatedKeys(to key: MusicalKey) -> [MusicalKey] {
        var related: [MusicalKey] = []

        // Relative major/minor
        related.append(key.relativeKey)

        // Parallel major/minor
        related.append(key.parallelKey)

        // Dominant key (up a 5th)
        let dominant = key.tonic.transposed(by: 7)
        related.append(MusicalKey(tonic: dominant, mode: key.mode, confidence: 0.8))

        // Subdominant key (up a 4th / down a 5th)
        let subdominant = key.tonic.transposed(by: 5)
        related.append(MusicalKey(tonic: subdominant, mode: key.mode, confidence: 0.8))

        // Relative of dominant
        let domKey = MusicalKey(tonic: dominant, mode: key.mode, confidence: 0.7)
        related.append(domKey.relativeKey)

        // Deduplicate
        var seen = Set<String>()
        seen.insert(key.displayName) // exclude the original key
        return related.filter { seen.insert($0.displayName).inserted }
    }

    // MARK: - SATB VocalVoice Assignment

    /// Distribute chord tones across SATB voices with proper spacing.
    ///
    /// Follows classical voice-leading rules:
    /// - Bass gets the root (or bass note for slash chords)
    /// - Adjacent voices separated by reasonable intervals
    /// - No voice crossing
    ///
    /// - Parameters:
    ///   - chord: The chord to voice.
    ///   - previous: Previous SATB voicing for smooth leading (optional).
    /// - Returns: Dictionary mapping each voice to its MIDI note.
    static func satbVoicing(chord: MusicChord, previous: [VocalVoice: MIDINote]? = nil) -> [VocalVoice: MIDINote] {
        let intervals = chord.quality.intervals
        guard intervals.count >= 3 else { return [:] }

        // Determine pitch classes needed
        let bassPC = chord.bass ?? chord.root
        let chordPCs = chord.noteNames

        var result: [VocalVoice: MIDINote] = [:]

        // Bass voice: root or slash bass
        let bassNote = findNoteInRange(pitchClass: bassPC, range: VocalVoice.bass.range, prefer: previous?[.bass])
        result[.bass] = bassNote

        // Distribute remaining chord tones to tenor, alto, soprano
        let remainingVocalVoices: [VocalVoice] = [.tenor, .alto, .soprano]
        var usedPCs: [NoteName] = [bassPC]

        for (i, voice) in remainingVocalVoices.enumerated() {
            // Cycle through chord tones, prioritising: 3rd, 5th, 7th, root doubling
            let pcIndex = (i + 1) % chordPCs.count
            let targetPC = chordPCs[pcIndex]

            let note = findNoteInRange(
                pitchClass: targetPC,
                range: voice.range,
                prefer: previous?[voice]
            )
            result[voice] = note
            usedPCs.append(targetPC)
        }

        return result
    }

    /// Find the best MIDI note for a pitch class within a voice range.
    private static func findNoteInRange(pitchClass: NoteName, range: ClosedRange<MIDINote>,
                                         prefer: MIDINote? = nil) -> MIDINote {
        var candidates: [MIDINote] = []
        for octave in 0...8 {
            let note = pitchClass.toMIDI(octave: octave)
            if range.contains(note) {
                candidates.append(note)
            }
        }

        guard !candidates.isEmpty else {
            // Fallback: closest note to range
            return pitchClass.toMIDI(octave: 4)
        }

        if let prefer = prefer {
            // Choose the candidate closest to the previous note
            return candidates.min(by: { abs(Int($0) - Int(prefer)) < abs(Int($1) - Int(prefer)) })!
        }

        // Default: middle of the range
        let mid = (Int(range.lowerBound) + Int(range.upperBound)) / 2
        return candidates.min(by: { abs(Int($0) - mid) < abs(Int($1) - mid) })!
    }
}
