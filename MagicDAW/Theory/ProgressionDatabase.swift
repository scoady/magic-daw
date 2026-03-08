// ProgressionDatabase.swift
// MagicDAW
//
// Database of common chord progressions organised by genre.
// Provides 30+ real progressions with metadata for the AI-assisted
// composition workflow.

import Foundation

// MARK: - Genre

/// Musical genres for categorising progressions.
enum Genre: String, CaseIterable, Codable, Sendable {
    case pop, rock, jazz, blues, classical, rnb, electronic, cinematic

    var displayName: String {
        switch self {
        case .pop:        return "Pop"
        case .rock:       return "Rock"
        case .jazz:       return "Jazz"
        case .blues:      return "Blues"
        case .classical:  return "Classical"
        case .rnb:        return "R&B"
        case .electronic: return "Electronic"
        case .cinematic:  return "Cinematic"
        }
    }
}

// MARK: - Progression Template

/// A named chord progression template expressed in Roman numerals.
struct ProgressionTemplate: Codable, Sendable, Identifiable {
    /// Unique identifier.
    let id: String
    /// Human-readable name.
    let name: String
    /// Roman numeral degrees (e.g., ["I", "V", "vi", "IV"]).
    let degrees: [String]
    /// Primary genre association.
    let genre: Genre
    /// Descriptive tags for search and filtering.
    let tags: [String]

    /// Realise this progression in a concrete key, returning `MusicChord` objects.
    ///
    /// Parses each Roman numeral to determine root scale degree and quality,
    /// then maps to actual note names in the given key.
    func chords(in key: MusicalKey) -> [MusicChord] {
        let scale = key.scale
        let scaleNotes = scale.pitchClasses
        guard scaleNotes.count >= 7 else { return [] }

        return degrees.compactMap { numeral in
            parseRomanNumeral(numeral, scaleNotes: scaleNotes, key: key)
        }
    }

    /// Display string: "I - V - vi - IV"
    var displayDegrees: String {
        degrees.joined(separator: " - ")
    }
}

// MARK: - Roman Numeral Parsing

private func parseRomanNumeral(_ numeral: String, scaleNotes: [NoteName], key: MusicalKey) -> MusicChord? {
    var remaining = numeral
    var isFlat = false
    var isSharp = false

    // Check for accidentals
    if remaining.hasPrefix("b") {
        isFlat = true
        remaining = String(remaining.dropFirst())
    } else if remaining.hasPrefix("#") {
        isSharp = true
        remaining = String(remaining.dropFirst())
    }

    // Extract the Roman numeral base
    let romanMap: [(String, Int, Bool)] = [
        // (numeral, degree 0-based, isMinorQuality)
        ("VII", 6, false), ("vii", 6, true),
        ("VII", 6, false),
        ("VI",  5, false), ("vi",  5, true),
        ("IV",  3, false), ("iv",  3, true),
        ("V",   4, false), ("v",   4, true),
        ("III", 2, false), ("iii", 2, true),
        ("II",  1, false), ("ii",  1, true),
        ("I",   0, false), ("i",   0, true),
    ]

    var degree = 0
    var isMinor = false
    var suffix = ""

    for (roman, deg, minor) in romanMap {
        if remaining.hasPrefix(roman) {
            degree = deg
            isMinor = minor
            suffix = String(remaining.dropFirst(roman.count))
            break
        }
    }

    // Compute root note
    guard degree < scaleNotes.count else { return nil }
    var root = scaleNotes[degree]
    if isFlat {
        root = root.transposed(by: -1)
    } else if isSharp {
        root = root.transposed(by: 1)
    }

    // Determine quality from suffix and case
    let quality: ChordQuality

    // Handle special suffixes
    let trimmedSuffix = suffix.trimmingCharacters(in: .whitespaces)
    switch trimmedSuffix {
    case "":
        quality = isMinor ? .minor : .major
    case "°", "dim":
        quality = .diminished
    case "+", "aug":
        quality = .augmented
    case "7":
        if isMinor {
            quality = .minor7
        } else if degree == 4 { // V7 defaults to dominant
            quality = .dominant7
        } else {
            quality = .dominant7
        }
    case "maj7":
        quality = .major7
    case "m7":
        quality = .minor7
    case "ø7", "ø":
        quality = .halfDiminished7
    case "°7", "dim7":
        quality = .diminished7
    case "sus4":
        quality = .sus4
    case "sus2":
        quality = .sus2
    case "9":
        quality = isMinor ? .minor9 : .dominant9
    case "maj9":
        quality = .major9
    case "m9":
        quality = .minor9
    case "11":
        quality = isMinor ? .minor11 : .dominant11
    case "13":
        quality = isMinor ? .minor13 : .dominant13
    case "add9":
        quality = .add9
    case "m(maj7)":
        quality = .minorMajor7
    default:
        quality = isMinor ? .minor : .major
    }

    return MusicChord(root: root, quality: quality)
}

// MARK: - Progression Database

/// Static database of common chord progressions across genres.
struct ProgressionDatabase: Sendable {

    /// All built-in progressions.
    static let all: [ProgressionTemplate] = builtInProgressions

    /// Filter progressions by genre.
    static func progressions(for genre: Genre) -> [ProgressionTemplate] {
        all.filter { $0.genre == genre }
    }

    /// Filter progressions by tag.
    static func progressions(withTag tag: String) -> [ProgressionTemplate] {
        let lowered = tag.lowercased()
        return all.filter { $0.tags.contains(where: { $0.lowercased() == lowered }) }
    }

    /// Search progressions by name or tag.
    static func search(_ query: String) -> [ProgressionTemplate] {
        let lowered = query.lowercased()
        return all.filter { progression in
            progression.name.lowercased().contains(lowered) ||
            progression.tags.contains(where: { $0.lowercased().contains(lowered) }) ||
            progression.genre.rawValue.lowercased().contains(lowered)
        }
    }

    /// Get a random progression, optionally filtered by genre.
    static func random(genre: Genre? = nil) -> ProgressionTemplate? {
        let pool = genre.map { progressions(for: $0) } ?? all
        return pool.randomElement()
    }

    /// Realise a progression by ID in a given key.
    static func realise(id: String, in key: MusicalKey) -> [MusicChord]? {
        guard let template = all.first(where: { $0.id == id }) else { return nil }
        return template.chords(in: key)
    }
}

// MARK: - Built-in Progressions

private let builtInProgressions: [ProgressionTemplate] = [

    // ─── Pop ────────────────────────────────────────────

    ProgressionTemplate(
        id: "pop-1564",
        name: "Axis of Awesome",
        degrees: ["I", "V", "vi", "IV"],
        genre: .pop,
        tags: ["anthem", "uplifting", "four-chord", "hit"]
    ),
    ProgressionTemplate(
        id: "pop-1456",
        name: "Classic Pop",
        degrees: ["I", "IV", "V", "vi"],
        genre: .pop,
        tags: ["standard", "bright"]
    ),
    ProgressionTemplate(
        id: "pop-6415",
        name: "Sensitive",
        degrees: ["vi", "IV", "I", "V"],
        genre: .pop,
        tags: ["emotional", "ballad", "minor-feel"]
    ),
    ProgressionTemplate(
        id: "pop-1545",
        name: "Pop Anthem",
        degrees: ["I", "V", "IV", "V"],
        genre: .pop,
        tags: ["driving", "upbeat"]
    ),
    ProgressionTemplate(
        id: "pop-6514",
        name: "Sad Pop",
        degrees: ["vi", "V", "I", "IV"],
        genre: .pop,
        tags: ["melancholy", "emotional"]
    ),
    ProgressionTemplate(
        id: "pop-14564",
        name: "Extended Pop",
        degrees: ["I", "IV", "V", "vi", "IV"],
        genre: .pop,
        tags: ["extended", "flowing"]
    ),

    // ─── Rock ───────────────────────────────────────────

    ProgressionTemplate(
        id: "rock-145",
        name: "Rock & Roll",
        degrees: ["I", "IV", "V"],
        genre: .rock,
        tags: ["classic", "three-chord", "garage"]
    ),
    ProgressionTemplate(
        id: "rock-1b716",
        name: "Power Rock",
        degrees: ["I", "bVII", "I", "vi"],
        genre: .rock,
        tags: ["power", "heavy", "modal"]
    ),
    ProgressionTemplate(
        id: "rock-1b6b714",
        name: "Classic Rock",
        degrees: ["I", "bVI", "bVII", "I"],
        genre: .rock,
        tags: ["arena", "anthemic"]
    ),
    ProgressionTemplate(
        id: "rock-i-bVII-bVI-V",
        name: "Andalusian Cadence",
        degrees: ["i", "bVII", "bVI", "V"],
        genre: .rock,
        tags: ["minor", "descending", "flamenco", "metal"]
    ),

    // ─── Jazz ───────────────────────────────────────────

    ProgressionTemplate(
        id: "jazz-251",
        name: "ii-V-I",
        degrees: ["ii7", "V7", "Imaj7"],
        genre: .jazz,
        tags: ["fundamental", "cadence", "bebop"]
    ),
    ProgressionTemplate(
        id: "jazz-1625",
        name: "Turnaround",
        degrees: ["Imaj7", "vi7", "ii7", "V7"],
        genre: .jazz,
        tags: ["turnaround", "standard"]
    ),
    ProgressionTemplate(
        id: "jazz-3625",
        name: "Rhythm Changes Bridge",
        degrees: ["III7", "VI7", "II7", "V7"],
        genre: .jazz,
        tags: ["rhythm-changes", "bridge", "secondary-dominants"]
    ),
    ProgressionTemplate(
        id: "jazz-1417",
        name: "Jazz Major",
        degrees: ["Imaj7", "IV7", "iii7", "vi7"],
        genre: .jazz,
        tags: ["smooth", "major"]
    ),
    ProgressionTemplate(
        id: "jazz-minor-251",
        name: "Minor ii-V-i",
        degrees: ["iiø7", "V7", "i7"],
        genre: .jazz,
        tags: ["minor", "cadence"]
    ),
    ProgressionTemplate(
        id: "jazz-coltrane",
        name: "Coltrane Changes",
        degrees: ["Imaj7", "bIIImaj7", "Vmaj7", "Imaj7"],
        genre: .jazz,
        tags: ["advanced", "giant-steps", "coltrane"]
    ),
    ProgressionTemplate(
        id: "jazz-backdoor",
        name: "Backdoor ii-V",
        degrees: ["iv7", "bVII7", "Imaj7"],
        genre: .jazz,
        tags: ["backdoor", "surprise", "modal"]
    ),

    // ─── Blues ───────────────────────────────────────────

    ProgressionTemplate(
        id: "blues-12bar",
        name: "12-Bar Blues",
        degrees: ["I7", "I7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"],
        genre: .blues,
        tags: ["classic", "12-bar", "standard"]
    ),
    ProgressionTemplate(
        id: "blues-quick-change",
        name: "Quick-Change Blues",
        degrees: ["I7", "IV7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"],
        genre: .blues,
        tags: ["quick-change", "12-bar"]
    ),
    ProgressionTemplate(
        id: "blues-minor",
        name: "Minor Blues",
        degrees: ["i7", "i7", "i7", "i7", "iv7", "iv7", "i7", "i7", "bVI7", "V7", "i7", "V7"],
        genre: .blues,
        tags: ["minor", "12-bar", "dark"]
    ),
    ProgressionTemplate(
        id: "blues-jazz",
        name: "Jazz Blues",
        degrees: ["I7", "IV7", "I7", "I7", "IV7", "#IV°7", "I7", "vi7", "ii7", "V7", "I7", "V7"],
        genre: .blues,
        tags: ["jazz", "12-bar", "bop"]
    ),

    // ─── Classical ──────────────────────────────────────

    ProgressionTemplate(
        id: "classical-authentic",
        name: "Authentic Cadence",
        degrees: ["I", "IV", "V", "I"],
        genre: .classical,
        tags: ["cadence", "resolution", "traditional"]
    ),
    ProgressionTemplate(
        id: "classical-deceptive",
        name: "Deceptive Cadence",
        degrees: ["I", "IV", "V", "vi"],
        genre: .classical,
        tags: ["deceptive", "surprise"]
    ),
    ProgressionTemplate(
        id: "classical-pachelbel",
        name: "Pachelbel's Canon",
        degrees: ["I", "V", "vi", "iii", "IV", "I", "IV", "V"],
        genre: .classical,
        tags: ["baroque", "canon", "sequence"]
    ),
    ProgressionTemplate(
        id: "classical-circle",
        name: "Circle Progression",
        degrees: ["I", "IV", "vii°", "iii", "vi", "ii", "V", "I"],
        genre: .classical,
        tags: ["circle-of-fifths", "baroque"]
    ),

    // ─── R&B ────────────────────────────────────────────

    ProgressionTemplate(
        id: "rnb-soul",
        name: "Soul Progression",
        degrees: ["I", "V", "vi", "iii", "IV"],
        genre: .rnb,
        tags: ["soul", "smooth", "neo-soul"]
    ),
    ProgressionTemplate(
        id: "rnb-6545",
        name: "R&B Groove",
        degrees: ["vi", "V", "IV", "V"],
        genre: .rnb,
        tags: ["groove", "funky"]
    ),
    ProgressionTemplate(
        id: "rnb-gospel",
        name: "Gospel Turn",
        degrees: ["I", "I7", "IV", "iv"],
        genre: .rnb,
        tags: ["gospel", "church", "emotional"]
    ),
    ProgressionTemplate(
        id: "rnb-neosoul",
        name: "Neo-Soul",
        degrees: ["ii9", "V9", "Imaj9", "IVmaj7"],
        genre: .rnb,
        tags: ["neo-soul", "smooth", "extended-harmony"]
    ),

    // ─── Electronic ─────────────────────────────────────

    ProgressionTemplate(
        id: "electronic-trance",
        name: "Trance Gate",
        degrees: ["i", "bVI", "bVII", "i"],
        genre: .electronic,
        tags: ["trance", "epic", "arpeggio"]
    ),
    ProgressionTemplate(
        id: "electronic-house",
        name: "Deep House",
        degrees: ["i", "iv", "bVI", "bVII"],
        genre: .electronic,
        tags: ["house", "deep", "loop"]
    ),
    ProgressionTemplate(
        id: "electronic-edm",
        name: "EDM Anthem",
        degrees: ["vi", "IV", "I", "V"],
        genre: .electronic,
        tags: ["edm", "festival", "anthem"]
    ),

    // ─── Cinematic ──────────────────────────────────────

    ProgressionTemplate(
        id: "cinematic-epic",
        name: "Epic Cinematic",
        degrees: ["i", "bVI", "III", "bVII"],
        genre: .cinematic,
        tags: ["epic", "trailer", "orchestral"]
    ),
    ProgressionTemplate(
        id: "cinematic-dark",
        name: "Dark Suspense",
        degrees: ["i", "iv", "v", "i"],
        genre: .cinematic,
        tags: ["dark", "suspense", "minor"]
    ),
    ProgressionTemplate(
        id: "cinematic-hopeful",
        name: "Hope Rising",
        degrees: ["I", "iii", "vi", "IV", "I", "V"],
        genre: .cinematic,
        tags: ["hopeful", "emotional", "resolution"]
    ),
    ProgressionTemplate(
        id: "cinematic-wonder",
        name: "Sense of Wonder",
        degrees: ["I", "bVII", "IV", "I"],
        genre: .cinematic,
        tags: ["wonder", "space", "discovery"]
    ),
]
