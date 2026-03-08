// MusicTypes.swift
// MagicDAW
//
// Core music theory types used throughout the app.

import Foundation

// MARK: - MIDI Primitives

/// MIDI note number (0-127).
typealias MIDINote = UInt8

/// MIDI velocity (0-127).
typealias Velocity = UInt8

// MARK: - Note Names

/// The 12 chromatic pitch classes, using sharps as canonical representation.
enum NoteName: Int, CaseIterable, Codable, Sendable, CustomStringConvertible {
    case C = 0, Cs, D, Ds, E, F, Fs, G, Gs, A, As, B

    var description: String {
        switch self {
        case .C:  return "C"
        case .Cs: return "C#"
        case .D:  return "D"
        case .Ds: return "D#"
        case .E:  return "E"
        case .F:  return "F"
        case .Fs: return "F#"
        case .G:  return "G"
        case .Gs: return "G#"
        case .A:  return "A"
        case .As: return "A#"
        case .B:  return "B"
        }
    }

    /// Human-readable name using sharps.
    var displayName: String { description }

    /// Enharmonic flat spelling.
    var flat: String {
        switch self {
        case .C:  return "C"
        case .Cs: return "Db"
        case .D:  return "D"
        case .Ds: return "Eb"
        case .E:  return "E"
        case .F:  return "F"
        case .Fs: return "Gb"
        case .G:  return "G"
        case .Gs: return "Ab"
        case .A:  return "A"
        case .As: return "Bb"
        case .B:  return "B"
        }
    }

    /// Alias for `flat` used by older call sites.
    var flatName: String { flat }

    /// Extract note name and octave from a MIDI note number.
    /// Uses standard MIDI convention where middle C (60) = C4.
    static func fromMIDI(_ note: MIDINote) -> (name: NoteName, octave: Int) {
        let pitchClass = Int(note) % 12
        let octave = Int(note) / 12 - 1
        return (NoteName(rawValue: pitchClass)!, octave)
    }

    /// Create from a MIDI note number (pitch class only).
    static func from(midiNote: UInt8) -> NoteName {
        NoteName(rawValue: Int(midiNote) % 12)!
    }

    /// Get the octave from a MIDI note number.
    static func octave(fromMIDI note: UInt8) -> Int {
        Int(note) / 12 - 1
    }

    /// Convert note name and octave back to a MIDI note number.
    func toMIDI(octave: Int) -> MIDINote {
        let value = (octave + 1) * 12 + rawValue
        return MIDINote(clamping: max(0, min(127, value)))
    }

    /// Transpose by a number of semitones (wraps around chromatically).
    func transposed(by semitones: Int) -> NoteName {
        let newValue = ((rawValue + semitones) % 12 + 12) % 12
        return NoteName(rawValue: newValue)!
    }

    /// Ascending semitone interval from self to another note (0-11).
    func interval(to other: NoteName) -> Int {
        ((other.rawValue - rawValue) % 12 + 12) % 12
    }

    /// Alias for `interval(to:)`.
    func distance(to other: NoteName) -> Int {
        interval(to: other)
    }

    /// Choose sharp or flat spelling based on key context.
    func spelled(preferFlats: Bool) -> String {
        preferFlats ? flat : description
    }
}

// MARK: - Key Mode

/// Major or minor quality of a key.
enum KeyMode: String, Codable, CaseIterable, Sendable {
    case major, minor

    var displayName: String { rawValue.capitalized }
}

// MARK: - Scale Type (Mode)

/// All supported scale types with their interval patterns.
/// The `Mode` typealias keeps compatibility with the rest of the codebase.
enum ScaleType: String, CaseIterable, Codable, Sendable {
    // Diatonic
    case major, naturalMinor, harmonicMinor, melodicMinor
    // Modes
    case dorian, phrygian, lydian, mixolydian, aeolian, locrian
    // Symmetric / Jazz
    case diminishedHW, diminishedWH, wholeTone, altered
    case lydianDominant, superLocrian
    // Pentatonic
    case majorPentatonic, minorPentatonic, blues
    // Special
    case chromatic

    /// Semitone intervals from the root for each scale degree.
    var intervals: [Int] {
        switch self {
        // Diatonic
        case .major:            return [0, 2, 4, 5, 7, 9, 11]
        case .naturalMinor:     return [0, 2, 3, 5, 7, 8, 10]
        case .harmonicMinor:    return [0, 2, 3, 5, 7, 8, 11]
        case .melodicMinor:     return [0, 2, 3, 5, 7, 9, 11]
        // Modes
        case .dorian:           return [0, 2, 3, 5, 7, 9, 10]
        case .phrygian:         return [0, 1, 3, 5, 7, 8, 10]
        case .lydian:           return [0, 2, 4, 6, 7, 9, 11]
        case .mixolydian:       return [0, 2, 4, 5, 7, 9, 10]
        case .aeolian:          return [0, 2, 3, 5, 7, 8, 10]
        case .locrian:          return [0, 1, 3, 5, 6, 8, 10]
        // Symmetric / Jazz
        case .diminishedHW:     return [0, 1, 3, 4, 6, 7, 9, 10]
        case .diminishedWH:     return [0, 2, 3, 5, 6, 8, 9, 11]
        case .wholeTone:        return [0, 2, 4, 6, 8, 10]
        case .altered:          return [0, 1, 3, 4, 6, 8, 10]
        case .lydianDominant:   return [0, 2, 4, 6, 7, 9, 10]
        case .superLocrian:     return [0, 1, 3, 4, 6, 8, 10]
        // Pentatonic
        case .majorPentatonic:  return [0, 2, 4, 7, 9]
        case .minorPentatonic:  return [0, 3, 5, 7, 10]
        case .blues:            return [0, 3, 5, 6, 7, 10]
        // Special
        case .chromatic:        return Array(0..<12)
        }
    }

    var displayName: String {
        switch self {
        case .major:            return "Major"
        case .naturalMinor:     return "Natural Minor"
        case .harmonicMinor:    return "Harmonic Minor"
        case .melodicMinor:     return "Melodic Minor"
        case .dorian:           return "Dorian"
        case .phrygian:         return "Phrygian"
        case .lydian:           return "Lydian"
        case .mixolydian:       return "Mixolydian"
        case .aeolian:          return "Aeolian"
        case .locrian:          return "Locrian"
        case .diminishedHW:     return "Diminished (H-W)"
        case .diminishedWH:     return "Diminished (W-H)"
        case .wholeTone:        return "Whole Tone"
        case .altered:          return "Altered"
        case .lydianDominant:   return "Lydian Dominant"
        case .superLocrian:     return "Super Locrian"
        case .majorPentatonic:  return "Major Pentatonic"
        case .minorPentatonic:  return "Minor Pentatonic"
        case .blues:            return "Blues"
        case .chromatic:        return "Chromatic"
        }
    }

    /// Number of notes in the scale.
    var noteCount: Int { intervals.count }
}

/// Backward-compatible alias so existing code referencing `Mode` still compiles.
typealias Mode = ScaleType

// MARK: - Scale

/// A concrete scale: root note + scale type.
struct Scale: Codable, Sendable, CustomStringConvertible {
    let root: NoteName
    let mode: ScaleType

    /// Convenience initialiser using the `type` label.
    init(root: NoteName, type: ScaleType) {
        self.root = root
        self.mode = type
    }

    /// Primary initialiser.
    init(root: NoteName, mode: ScaleType) {
        self.root = root
        self.mode = mode
    }

    var intervals: [Int] { mode.intervals }

    /// Display name like "C Major" or "A Minor Pentatonic".
    var displayName: String {
        "\(root.displayName) \(mode.displayName)"
    }

    var description: String { displayName }

    /// The pitch classes in this scale.
    var pitchClasses: [NoteName] {
        mode.intervals.map { root.transposed(by: $0) }
    }

    /// Alias matching the spec.
    var noteNames: [NoteName] { pitchClasses }

    /// Whether the scale contains a given note name.
    func contains(_ note: NoteName) -> Bool {
        pitchClasses.contains(note)
    }

    /// Overload accepting label `note:`.
    func contains(note: NoteName) -> Bool {
        contains(note)
    }

    /// Whether the scale contains a given MIDI note.
    func contains(midiNote: UInt8) -> Bool {
        contains(NoteName.from(midiNote: midiNote))
    }

    /// The 1-based scale degree of a note, or nil if not in the scale.
    func degree(of note: NoteName) -> Int? {
        guard let index = pitchClasses.firstIndex(of: note) else { return nil }
        return index + 1
    }

    /// Snap a MIDI note to the nearest note in this scale.
    func snap(_ midiNote: MIDINote) -> MIDINote {
        let (name, octave) = NoteName.fromMIDI(midiNote)
        if contains(name) { return midiNote }

        var bestNote = midiNote
        var bestDistance = Int.max

        for scaleName in pitchClasses {
            for oct in (octave - 1)...(octave + 1) {
                guard oct >= -1 && oct <= 9 else { continue }
                let candidate = scaleName.toMIDI(octave: oct)
                let dist = abs(Int(candidate) - Int(midiNote))
                if dist < bestDistance {
                    bestDistance = dist
                    bestNote = candidate
                }
            }
        }
        return bestNote
    }
}

// MARK: - Key

/// A musical key with detection confidence.
struct Key: Codable, Sendable, CustomStringConvertible {
    let tonic: NoteName
    let mode: ScaleType
    let confidence: Double  // 0.0 - 1.0

    /// Convenience initialiser accepting `KeyMode`.
    init(tonic: NoteName, mode: KeyMode, confidence: Double = 1.0) {
        self.tonic = tonic
        self.mode = mode == .major ? .major : .naturalMinor
        self.confidence = confidence
    }

    /// Primary initialiser.
    init(tonic: NoteName, mode: ScaleType, confidence: Double = 1.0) {
        self.tonic = tonic
        self.mode = mode
        self.confidence = confidence
    }

    var displayName: String {
        "\(tonic.spelled(preferFlats: prefersFlats)) \(mode.displayName)"
    }

    var description: String { displayName }

    /// The scale implied by this key.
    var scale: Scale {
        Scale(root: tonic, mode: mode)
    }

    /// The relative major/minor key (e.g., C major <-> A minor).
    var relativeKey: Key {
        switch mode {
        case .major, .lydian, .mixolydian:
            return Key(tonic: tonic.transposed(by: -3), mode: .naturalMinor, confidence: confidence)
        case .naturalMinor, .aeolian, .dorian, .phrygian:
            return Key(tonic: tonic.transposed(by: 3), mode: .major, confidence: confidence)
        default:
            return Key(tonic: tonic.transposed(by: 3), mode: .major, confidence: confidence)
        }
    }

    /// The parallel major/minor key (same tonic, different mode).
    var parallelKey: Key {
        switch mode {
        case .major:
            return Key(tonic: tonic, mode: .naturalMinor, confidence: confidence)
        case .naturalMinor:
            return Key(tonic: tonic, mode: .major, confidence: confidence)
        default:
            return Key(tonic: tonic, mode: mode == .major ? .naturalMinor : .major, confidence: confidence)
        }
    }

    /// Whether this key typically uses flat accidentals in notation.
    var prefersFlats: Bool {
        switch mode {
        case .major:
            return [NoteName.F, .As, .Ds, .Gs, .Cs, .Fs].contains(tonic)
        case .naturalMinor, .aeolian:
            return [NoteName.D, .G, .C, .F, .As, .Ds].contains(tonic)
        default:
            return false
        }
    }

    /// Simplified `KeyMode` representation.
    var keyMode: KeyMode {
        switch mode {
        case .naturalMinor, .harmonicMinor, .melodicMinor, .aeolian, .dorian, .phrygian, .locrian:
            return .minor
        default:
            return .major
        }
    }
}

// MARK: - Chord Quality

/// All supported chord qualities with their interval patterns.
enum ChordQuality: String, CaseIterable, Codable, Sendable {
    case major, minor, diminished, augmented
    case dominant7, major7, minor7, minorMajor7
    case halfDiminished7, diminished7
    case sus2, sus4
    case add9, add11
    case dominant9, major9, minor9
    case dominant11, major11, minor11
    case dominant13, major13, minor13
    case augmented7, altered
    case power

    /// Semitone intervals from the root.
    var intervals: [Int] {
        switch self {
        // Triads
        case .major:            return [0, 4, 7]
        case .minor:            return [0, 3, 7]
        case .diminished:       return [0, 3, 6]
        case .augmented:        return [0, 4, 8]
        // Seventh chords
        case .dominant7:        return [0, 4, 7, 10]
        case .major7:           return [0, 4, 7, 11]
        case .minor7:           return [0, 3, 7, 10]
        case .minorMajor7:      return [0, 3, 7, 11]
        case .halfDiminished7:  return [0, 3, 6, 10]
        case .diminished7:      return [0, 3, 6, 9]
        // Suspended
        case .sus2:             return [0, 2, 7]
        case .sus4:             return [0, 5, 7]
        // Add chords
        case .add9:             return [0, 2, 4, 7]
        case .add11:            return [0, 4, 5, 7]
        // Ninth chords
        case .dominant9:        return [0, 4, 7, 10, 14]
        case .major9:           return [0, 4, 7, 11, 14]
        case .minor9:           return [0, 3, 7, 10, 14]
        // Eleventh chords
        case .dominant11:       return [0, 4, 7, 10, 14, 17]
        case .major11:          return [0, 4, 7, 11, 14, 17]
        case .minor11:          return [0, 3, 7, 10, 14, 17]
        // Thirteenth chords
        case .dominant13:       return [0, 4, 7, 10, 14, 17, 21]
        case .major13:          return [0, 4, 7, 11, 14, 17, 21]
        case .minor13:          return [0, 3, 7, 10, 14, 17, 21]
        // Other
        case .augmented7:       return [0, 4, 8, 10]
        case .altered:          return [0, 4, 6, 10, 13, 15]
        case .power:            return [0, 7]
        }
    }

    /// Compact pitch class set (0-11) for template matching.
    var pitchClassSet: Set<Int> {
        Set(intervals.map { $0 % 12 })
    }

    /// Symbol suffix for display (e.g., "m7", "maj9", "").
    var symbol: String {
        switch self {
        case .major:            return ""
        case .minor:            return "m"
        case .diminished:       return "dim"
        case .augmented:        return "aug"
        case .dominant7:        return "7"
        case .major7:           return "maj7"
        case .minor7:           return "m7"
        case .minorMajor7:      return "m(maj7)"
        case .halfDiminished7:  return "m7b5"
        case .diminished7:      return "dim7"
        case .sus2:             return "sus2"
        case .sus4:             return "sus4"
        case .add9:             return "add9"
        case .add11:            return "add11"
        case .dominant9:        return "9"
        case .major9:           return "maj9"
        case .minor9:           return "m9"
        case .dominant11:       return "11"
        case .major11:          return "maj11"
        case .minor11:          return "m11"
        case .dominant13:       return "13"
        case .major13:          return "maj13"
        case .minor13:          return "m13"
        case .augmented7:       return "aug7"
        case .altered:          return "alt"
        case .power:            return "5"
        }
    }

    /// Alias for `symbol` used in newer code.
    var displaySuffix: String { symbol }

    /// Commonality weight for ranking ambiguous chord matches.
    /// Higher = more commonly encountered.
    var commonality: Double {
        switch self {
        case .major, .minor:                                    return 1.0
        case .dominant7, .minor7, .major7:                      return 0.9
        case .sus4, .sus2:                                      return 0.85
        case .power:                                            return 0.82
        case .diminished, .augmented:                           return 0.7
        case .dominant9, .minor9, .major9:                      return 0.75
        case .halfDiminished7, .minorMajor7:                    return 0.65
        case .add9, .add11:                                     return 0.6
        case .dominant11, .dominant13:                           return 0.55
        case .major11, .major13, .minor11, .minor13:            return 0.5
        case .diminished7:                                      return 0.45
        case .augmented7:                                       return 0.4
        case .altered:                                          return 0.35
        }
    }
}

// MARK: - Chord

/// A fully specified chord with root, quality, and optional bass note for slash chords.
struct Chord: Codable, Sendable, Equatable, CustomStringConvertible {
    let root: NoteName
    let quality: ChordQuality
    let bass: NoteName?  // for slash chords (e.g., G/B)

    init(root: NoteName, quality: ChordQuality, bass: NoteName? = nil) {
        self.root = root
        self.quality = quality
        self.bass = bass
    }

    var description: String { displayName }

    /// Display name like "Cm7" or "D/F#".
    var displayName: String {
        var name = root.displayName + quality.symbol
        if let bass = bass, bass != root {
            name += "/\(bass.displayName)"
        }
        return name
    }

    /// Semitone intervals from the root.
    var intervals: [Int] { quality.intervals }

    /// The note names that make up this chord.
    var noteNames: [NoteName] {
        var names = quality.intervals.map { root.transposed(by: $0 % 12) }
        var seen = Set<Int>()
        names = names.filter { seen.insert($0.rawValue).inserted }
        return names
    }

    /// MIDI notes for a specific voicing centered around a given octave.
    func midiNotes(octave: Int = 4) -> [MIDINote] {
        var notes: [MIDINote] = []
        if let bass = bass, bass != root {
            notes.append(bass.toMIDI(octave: octave - 1))
        }
        for interval in quality.intervals {
            let octaveOffset = interval / 12
            let note = root.transposed(by: interval % 12)
            notes.append(note.toMIDI(octave: octave + octaveOffset))
        }
        return notes
    }

    /// Roman numeral analysis relative to a key.
    func romanNumeral(in key: Key) -> String {
        let interval = key.tonic.interval(to: root)
        let numerals = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"]
        let base = numerals[interval]
        let isMinorQuality: Bool = {
            switch quality {
            case .minor, .minor7, .minor9, .minor11, .minor13, .minorMajor7:
                return true
            default:
                return false
            }
        }()
        let isDiminished: Bool = {
            switch quality {
            case .diminished, .diminished7, .halfDiminished7:
                return true
            default:
                return false
            }
        }()

        var numeral = base
        if isMinorQuality || isDiminished {
            numeral = base.lowercased()
        }

        // Add quality suffix
        switch quality {
        case .major, .minor, .power:
            break
        case .diminished:
            numeral += "°"
        case .augmented:
            numeral += "+"
        case .dominant7:
            numeral += "7"
        case .major7:
            numeral += "maj7"
        case .minor7:
            numeral += "7"
        case .halfDiminished7:
            numeral += "ø7"
        case .diminished7:
            numeral += "°7"
        default:
            numeral += quality.symbol
        }

        return numeral
    }
}

// MARK: - Note Event

/// A timestamped MIDI note event.
struct NoteEvent: Sendable {
    let note: MIDINote
    let velocity: Velocity
    let timestamp: TimeInterval
    let duration: TimeInterval?  // nil if note is still held
    let channel: UInt8

    init(note: MIDINote, velocity: Velocity, timestamp: TimeInterval,
         duration: TimeInterval? = nil, channel: UInt8 = 0) {
        self.note = note
        self.velocity = velocity
        self.timestamp = timestamp
        self.duration = duration
        self.channel = channel
    }

    /// The pitch class (0-11) of this note event.
    var pitchClass: Int { Int(note) % 12 }

    /// The note name.
    var noteName: NoteName { NoteName.from(midiNote: note) }
}

// MARK: - Weighted Note

/// A note with a duration/weight used for key detection.
struct WeightedNote: Sendable {
    let pitchClass: NoteName
    let weight: Double

    init(midiNote: UInt8, weight: Double = 1.0) {
        self.pitchClass = NoteName.from(midiNote: midiNote)
        self.weight = weight
    }

    init(pitchClass: NoteName, weight: Double = 1.0) {
        self.pitchClass = pitchClass
        self.weight = weight
    }
}

// MARK: - Voice Ranges

/// SATB voice ranges for part writing and voicing.
enum Voice: String, CaseIterable, Sendable {
    case soprano, alto, tenor, bass

    /// The comfortable MIDI note range for this voice.
    var range: ClosedRange<MIDINote> {
        switch self {
        case .soprano: return 60...79  // C4-G5
        case .alto:    return 55...72  // G3-C5
        case .tenor:   return 48...67  // C3-G4
        case .bass:    return 40...60  // E2-C4
        }
    }

    var displayName: String { rawValue.capitalized }
}

// MARK: - Voicing Style

/// Chord voicing strategies.
enum VoicingStyle: String, CaseIterable, Sendable {
    case close      // All notes within one octave
    case drop2      // Second voice from top dropped an octave
    case drop3      // Third voice from top dropped an octave
    case rootless   // Omit the root (jazz style)
    case shell      // Root + 3rd + 7th only
    case quartal    // Built in 4ths
    case spread     // Wide spacing across multiple octaves
}
