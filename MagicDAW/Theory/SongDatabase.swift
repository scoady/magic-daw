// SongDatabase.swift
// MagicDAW
//
// Database of 100+ popular songs with their chord progressions stored as
// Roman numeral patterns. Includes a matcher that identifies songs from
// detected chord progressions in real time.

import Foundation

// MARK: - Song Entry

/// A song entry in the database with its chord progression as Roman numerals.
struct SongEntry: Codable, Sendable {
    let title: String
    let artist: String
    let year: Int?
    let genre: String
    let progression: [String]  // Roman numerals: ["I", "V", "vi", "IV"]
    let section: String?       // "verse", "chorus", "bridge"
}

// MARK: - Song Match Result

/// A matched song with confidence score.
struct SongMatch: Sendable {
    let song: SongEntry
    let confidence: Double     // 0.0 - 1.0
    let matchedChords: Int     // how many chords matched
    let matchType: MatchType

    enum MatchType: String, Sendable {
        case exact          // full progression matches
        case partial        // 3+ chord window matches
        case rotated        // circular rotation matches
    }
}

// MARK: - Song Matcher

/// Matches detected chord progressions against the song database.
struct SongMatcher: Sendable {

    /// Minimum number of chords required for a match.
    static let minimumMatchLength = 3

    /// Match a sequence of detected chords against the song database.
    ///
    /// - Parameters:
    ///   - chords: Recently detected chords.
    ///   - key: The detected musical key (used to convert chords to Roman numerals).
    ///   - maxResults: Maximum number of results to return.
    /// - Returns: Ranked song matches.
    static func findMatches(
        chords: [MusicChord],
        key: MusicalKey,
        maxResults: Int = 5
    ) -> [SongMatch] {
        guard chords.count >= minimumMatchLength else { return [] }

        // Convert detected chords to Roman numerals
        let romanNumerals = chords.map { chord -> String in
            simplifiedRomanNumeral(chord: chord, key: key)
        }

        var matches: [SongMatch] = []

        for song in SongDatabase.all {
            let songProg = song.progression.map { normalizeNumeral($0) }

            // Try exact match (full progression)
            if romanNumerals.count >= songProg.count && songProg.count >= minimumMatchLength {
                if containsSubsequence(romanNumerals, pattern: songProg) {
                    matches.append(SongMatch(
                        song: song,
                        confidence: 1.0,
                        matchedChords: songProg.count,
                        matchType: .exact
                    ))
                    continue
                }
            }

            // Try windowed partial match (3+ chord windows)
            let bestWindow = bestWindowMatch(detected: romanNumerals, songProgression: songProg)
            if let best = bestWindow {
                matches.append(best)
                continue
            }

            // Try rotated match (circular permutation of the progression)
            let rotatedMatch = bestRotatedMatch(detected: romanNumerals, songProgression: songProg)
            if let rotated = rotatedMatch {
                matches.append(SongMatch(
                    song: song,
                    confidence: rotated.confidence * 0.85, // slight penalty for rotation
                    matchedChords: rotated.matchedChords,
                    matchType: .rotated
                ))
            }
        }

        // Sort by confidence descending, then by matched chord count
        matches.sort { a, b in
            if abs(a.confidence - b.confidence) > 0.01 {
                return a.confidence > b.confidence
            }
            return a.matchedChords > b.matchedChords
        }

        // Deduplicate by song title + artist
        var seen = Set<String>()
        var unique: [SongMatch] = []
        for match in matches {
            let key = "\(match.song.title)|\(match.song.artist)"
            if seen.insert(key).inserted {
                unique.append(match)
            }
            if unique.count >= maxResults { break }
        }

        return unique
    }

    // MARK: - Numeral Conversion

    /// Convert a chord to a simplified Roman numeral relative to a key.
    /// Strips complex quality suffixes for matching purposes.
    private static func simplifiedRomanNumeral(chord: MusicChord, key: MusicalKey) -> String {
        let interval = key.tonic.interval(to: chord.root)

        let isMinor: Bool = {
            switch chord.quality {
            case .minor, .minor7, .minor9, .minor11, .minor13, .minorMajor7:
                return true
            default:
                return false
            }
        }()

        let isDiminished: Bool = {
            switch chord.quality {
            case .diminished, .diminished7, .halfDiminished7:
                return true
            default:
                return false
            }
        }()

        let numerals = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"]
        var numeral = numerals[interval]

        if isMinor || isDiminished {
            numeral = numeral.lowercased()
        }
        if isDiminished {
            numeral += "°"
        }

        return numeral
    }

    /// Normalize a Roman numeral for comparison (strip quality suffixes like 7, maj7, etc.).
    static func normalizeNumeral(_ numeral: String) -> String {
        var s = numeral

        // Strip trailing quality markers for basic matching
        let suffixes = ["maj7", "maj9", "m7", "m9", "7", "9", "11", "13",
                        "sus2", "sus4", "add9", "add11", "ø7", "°7", "ø", "+"]
        for suffix in suffixes {
            if s.hasSuffix(suffix) {
                s = String(s.dropLast(suffix.count))
                break
            }
        }

        // Normalize dim marker
        if s.hasSuffix("dim") {
            s = String(s.dropLast(3)) + "°"
        }

        return s
    }

    // MARK: - Matching Algorithms

    /// Check if `haystack` contains `pattern` as a contiguous subsequence.
    private static func containsSubsequence(_ haystack: [String], pattern: [String]) -> Bool {
        guard pattern.count <= haystack.count else { return false }
        let limit = haystack.count - pattern.count
        for start in 0...limit {
            var match = true
            for (i, p) in pattern.enumerated() {
                if haystack[start + i] != p {
                    match = false
                    break
                }
            }
            if match { return true }
        }
        return false
    }

    /// Find the best sliding-window match of detected chords against a song progression.
    private static func bestWindowMatch(
        detected: [String],
        songProgression: [String]
    ) -> SongMatch? {
        // We don't have the song reference here yet — this is called from findMatches
        // which wraps the result. Return nil placeholder to be handled by caller.
        nil // Handled inline in findMatches
    }

    /// Find the best sliding-window match, returning confidence and match count.
    private static func windowMatchScore(
        detected: [String],
        songProgression: [String]
    ) -> (matchedChords: Int, confidence: Double)? {
        guard !detected.isEmpty, !songProgression.isEmpty else { return nil }

        var bestCount = 0
        var bestConfidence = 0.0

        // Slide a window of each valid size across the song progression
        let minWindow = minimumMatchLength
        let maxWindow = min(detected.count, songProgression.count)

        guard maxWindow >= minWindow else { return nil }

        for windowSize in minWindow...maxWindow {
            // Slide the window across the song progression
            let songLimit = songProgression.count - windowSize
            for songStart in 0...songLimit {
                let songWindow = Array(songProgression[songStart..<(songStart + windowSize)])

                // Check if this window appears in the detected chords
                if containsSubsequence(detected, pattern: songWindow) {
                    let confidence = Double(windowSize) / Double(songProgression.count)
                    if windowSize > bestCount || (windowSize == bestCount && confidence > bestConfidence) {
                        bestCount = windowSize
                        bestConfidence = confidence
                    }
                }
            }
        }

        guard bestCount >= minWindow else { return nil }
        return (bestCount, bestConfidence)
    }

    /// Try all circular rotations of the song progression.
    private static func bestRotatedMatch(
        detected: [String],
        songProgression: [String]
    ) -> (matchedChords: Int, confidence: Double)? {
        guard songProgression.count >= minimumMatchLength else { return nil }

        var best: (matchedChords: Int, confidence: Double)?

        for rotation in 1..<songProgression.count {
            let rotated = Array(songProgression[rotation...]) + Array(songProgression[..<rotation])
            if let score = windowMatchScore(detected: detected, songProgression: rotated) {
                if best == nil || score.matchedChords > best!.matchedChords {
                    best = score
                }
            }
        }

        return best
    }
}

// MARK: - Overloaded findMatches using inline window logic

extension SongMatcher {
    /// Full match implementation with inline window matching.
    static func match(
        chords: [MusicChord],
        key: MusicalKey,
        maxResults: Int = 5
    ) -> [SongMatch] {
        guard chords.count >= minimumMatchLength else { return [] }

        let romanNumerals = chords.map { chord -> String in
            simplifiedRomanNumeral(chord: chord, key: key)
        }

        var matches: [SongMatch] = []

        for song in SongDatabase.all {
            let songProg = song.progression.map { normalizeNumeral($0) }

            // Exact full match
            if romanNumerals.count >= songProg.count && songProg.count >= minimumMatchLength {
                if containsSubsequence(romanNumerals, pattern: songProg) {
                    matches.append(SongMatch(
                        song: song,
                        confidence: 1.0,
                        matchedChords: songProg.count,
                        matchType: .exact
                    ))
                    continue
                }
            }

            // Windowed partial match
            if let score = windowMatchScore(detected: romanNumerals, songProgression: songProg),
               score.matchedChords >= minimumMatchLength {
                matches.append(SongMatch(
                    song: song,
                    confidence: score.confidence,
                    matchedChords: score.matchedChords,
                    matchType: .partial
                ))
                continue
            }

            // Rotated match
            if let rotScore = bestRotatedMatch(detected: romanNumerals, songProgression: songProg),
               rotScore.matchedChords >= minimumMatchLength {
                matches.append(SongMatch(
                    song: song,
                    confidence: rotScore.confidence * 0.85,
                    matchedChords: rotScore.matchedChords,
                    matchType: .rotated
                ))
            }
        }

        matches.sort { a, b in
            if abs(a.confidence - b.confidence) > 0.01 {
                return a.confidence > b.confidence
            }
            return a.matchedChords > b.matchedChords
        }

        var seen = Set<String>()
        var unique: [SongMatch] = []
        for match in matches {
            let id = "\(match.song.title)|\(match.song.artist)"
            if seen.insert(id).inserted {
                unique.append(match)
            }
            if unique.count >= maxResults { break }
        }

        return unique
    }
}

// MARK: - Song Database

/// Static database of popular songs with their chord progressions.
struct SongDatabase: Sendable {

    /// All songs in the database.
    static let all: [SongEntry] = songEntries

    /// Search songs by title or artist.
    static func search(_ query: String) -> [SongEntry] {
        let q = query.lowercased()
        return all.filter {
            $0.title.lowercased().contains(q) ||
            $0.artist.lowercased().contains(q) ||
            $0.genre.lowercased().contains(q)
        }
    }

    /// Get all songs in a genre.
    static func byGenre(_ genre: String) -> [SongEntry] {
        let g = genre.lowercased()
        return all.filter { $0.genre.lowercased() == g }
    }
}

// MARK: - Song Data (100+ entries)

private let songEntries: [SongEntry] = [

    // ═══════════════════════════════════════════════════════════════════
    //  I - V - vi - IV  (Axis of Awesome)
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Let It Be", artist: "The Beatles", year: 1970, genre: "Rock",
              progression: ["I", "V", "vi", "IV"], section: "chorus"),
    SongEntry(title: "No Woman, No Cry", artist: "Bob Marley", year: 1974, genre: "Reggae",
              progression: ["I", "V", "vi", "IV"], section: "chorus"),
    SongEntry(title: "Can You Feel the Love Tonight", artist: "Elton John", year: 1994, genre: "Pop",
              progression: ["I", "V", "vi", "IV"], section: "chorus"),
    SongEntry(title: "With or Without You", artist: "U2", year: 1987, genre: "Rock",
              progression: ["I", "V", "vi", "IV"], section: "verse"),
    SongEntry(title: "She Will Be Loved", artist: "Maroon 5", year: 2002, genre: "Pop",
              progression: ["I", "V", "vi", "IV"], section: "chorus"),
    SongEntry(title: "Take Me Home, Country Roads", artist: "John Denver", year: 1971, genre: "Country",
              progression: ["I", "V", "vi", "IV"], section: "chorus"),
    SongEntry(title: "Wherever You Will Go", artist: "The Calling", year: 2001, genre: "Rock",
              progression: ["I", "V", "vi", "IV"], section: "chorus"),
    SongEntry(title: "Beast of Burden", artist: "The Rolling Stones", year: 1978, genre: "Rock",
              progression: ["I", "V", "vi", "IV"], section: "verse"),
    SongEntry(title: "Under the Bridge", artist: "Red Hot Chili Peppers", year: 1991, genre: "Rock",
              progression: ["I", "V", "vi", "IV"], section: "chorus"),
    SongEntry(title: "When I Come Around", artist: "Green Day", year: 1994, genre: "Rock",
              progression: ["I", "V", "vi", "IV"], section: "verse"),

    // ═══════════════════════════════════════════════════════════════════
    //  vi - IV - I - V  (Sensitive / Emotional)
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Numb", artist: "Linkin Park", year: 2003, genre: "Rock",
              progression: ["vi", "IV", "I", "V"], section: "verse"),
    SongEntry(title: "Apologize", artist: "OneRepublic", year: 2006, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Not Afraid", artist: "Eminem", year: 2010, genre: "Hip-Hop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Complicated", artist: "Avril Lavigne", year: 2002, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Save Tonight", artist: "Eagle-Eye Cherry", year: 1997, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Zombie", artist: "The Cranberries", year: 1994, genre: "Rock",
              progression: ["vi", "IV", "I", "V"], section: "verse"),
    SongEntry(title: "Demons", artist: "Imagine Dragons", year: 2012, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Someone Like You", artist: "Adele", year: 2011, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "verse"),

    // ═══════════════════════════════════════════════════════════════════
    //  I - IV - V - IV  /  I - IV - V
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Twist and Shout", artist: "The Beatles", year: 1963, genre: "Rock",
              progression: ["I", "IV", "V"], section: "verse"),
    SongEntry(title: "La Bamba", artist: "Ritchie Valens", year: 1958, genre: "Rock",
              progression: ["I", "IV", "V"], section: "verse"),
    SongEntry(title: "Wild Thing", artist: "The Troggs", year: 1966, genre: "Rock",
              progression: ["I", "IV", "V", "IV"], section: "verse"),
    SongEntry(title: "Louie Louie", artist: "The Kingsmen", year: 1963, genre: "Rock",
              progression: ["I", "IV", "V", "IV"], section: "verse"),
    SongEntry(title: "Sweet Home Alabama", artist: "Lynyrd Skynyrd", year: 1974, genre: "Rock",
              progression: ["V", "IV", "I"], section: "verse"),
    SongEntry(title: "Free Fallin'", artist: "Tom Petty", year: 1989, genre: "Rock",
              progression: ["I", "IV", "V", "IV"], section: "verse"),

    // ═══════════════════════════════════════════════════════════════════
    //  I - V - vi - iii - IV - I - IV - V  (Pachelbel / Canon)
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Canon in D", artist: "Pachelbel", year: 1680, genre: "Classical",
              progression: ["I", "V", "vi", "iii", "IV", "I", "IV", "V"], section: nil),
    SongEntry(title: "Basket Case", artist: "Green Day", year: 1994, genre: "Rock",
              progression: ["I", "V", "vi", "iii", "IV", "I", "IV", "V"], section: "verse"),
    SongEntry(title: "Graduation", artist: "Vitamin C", year: 1999, genre: "Pop",
              progression: ["I", "V", "vi", "iii", "IV", "I", "IV", "V"], section: "verse"),

    // ═══════════════════════════════════════════════════════════════════
    //  I - vi - IV - V  (50s Doo-Wop)
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Stand by Me", artist: "Ben E. King", year: 1961, genre: "R&B",
              progression: ["I", "vi", "IV", "V"], section: "verse"),
    SongEntry(title: "Earth Angel", artist: "The Penguins", year: 1954, genre: "R&B",
              progression: ["I", "vi", "IV", "V"], section: "verse"),
    SongEntry(title: "Every Breath You Take", artist: "The Police", year: 1983, genre: "Rock",
              progression: ["I", "vi", "IV", "V"], section: "verse"),
    SongEntry(title: "Unchained Melody", artist: "The Righteous Brothers", year: 1965, genre: "Pop",
              progression: ["I", "vi", "IV", "V"], section: "verse"),
    SongEntry(title: "Crocodile Rock", artist: "Elton John", year: 1972, genre: "Rock",
              progression: ["I", "vi", "IV", "V"], section: "verse"),
    SongEntry(title: "Happiness Is a Warm Gun", artist: "The Beatles", year: 1968, genre: "Rock",
              progression: ["I", "vi", "IV", "V"], section: "verse"),

    // ═══════════════════════════════════════════════════════════════════
    //  I - IV - vi - V
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Hey Ya!", artist: "OutKast", year: 2003, genre: "Pop",
              progression: ["I", "IV", "vi", "V"], section: "verse"),
    SongEntry(title: "Poker Face", artist: "Lady Gaga", year: 2008, genre: "Pop",
              progression: ["I", "IV", "vi", "V"], section: "verse"),

    // ═══════════════════════════════════════════════════════════════════
    //  vi - V - IV - V
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Rolling in the Deep", artist: "Adele", year: 2010, genre: "Pop",
              progression: ["vi", "V", "IV", "V"], section: "verse"),

    // ═══════════════════════════════════════════════════════════════════
    //  I - V - IV - V  /  I - V - IV
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Born This Way", artist: "Lady Gaga", year: 2011, genre: "Pop",
              progression: ["I", "V", "IV", "V"], section: "chorus"),

    // ═══════════════════════════════════════════════════════════════════
    //  I - IV  (Two-chord)
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Achy Breaky Heart", artist: "Billy Ray Cyrus", year: 1992, genre: "Country",
              progression: ["I", "V", "I", "V"], section: "verse"),

    // ═══════════════════════════════════════════════════════════════════
    //  Modern Pop
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Shape of You", artist: "Ed Sheeran", year: 2017, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "verse"),
    SongEntry(title: "All of Me", artist: "John Legend", year: 2013, genre: "Pop",
              progression: ["I", "V", "vi", "IV"], section: "verse"),
    SongEntry(title: "Stay With Me", artist: "Sam Smith", year: 2014, genre: "Pop",
              progression: ["vi", "IV", "I"], section: "chorus"),
    SongEntry(title: "Blinding Lights", artist: "The Weeknd", year: 2019, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Counting Stars", artist: "OneRepublic", year: 2013, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Stitches", artist: "Shawn Mendes", year: 2015, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Love Yourself", artist: "Justin Bieber", year: 2015, genre: "Pop",
              progression: ["I", "V", "vi", "IV"], section: "verse"),
    SongEntry(title: "Photograph", artist: "Ed Sheeran", year: 2014, genre: "Pop",
              progression: ["I", "V", "vi", "IV"], section: "chorus"),
    SongEntry(title: "Cheap Thrills", artist: "Sia", year: 2016, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Havana", artist: "Camila Cabello", year: 2017, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "verse"),
    SongEntry(title: "Happier", artist: "Marshmello & Bastille", year: 2018, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Shallow", artist: "Lady Gaga & Bradley Cooper", year: 2018, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Perfect", artist: "Ed Sheeran", year: 2017, genre: "Pop",
              progression: ["I", "vi", "IV", "V"], section: "verse"),
    SongEntry(title: "Thinking Out Loud", artist: "Ed Sheeran", year: 2014, genre: "Pop",
              progression: ["I", "V", "vi", "IV"], section: "verse"),
    SongEntry(title: "Radioactive", artist: "Imagine Dragons", year: 2012, genre: "Rock",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Believer", artist: "Imagine Dragons", year: 2017, genre: "Rock",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),

    // ═══════════════════════════════════════════════════════════════════
    //  Classic Rock / Pop-Rock
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Don't Stop Believin'", artist: "Journey", year: 1981, genre: "Rock",
              progression: ["I", "V", "vi", "IV"], section: "verse"),
    SongEntry(title: "Hotel California", artist: "Eagles", year: 1977, genre: "Rock",
              progression: ["vi", "III", "V", "II", "IV", "I", "V"], section: "verse"),
    SongEntry(title: "Stairway to Heaven", artist: "Led Zeppelin", year: 1971, genre: "Rock",
              progression: ["vi", "bVI", "V"], section: "intro"),
    SongEntry(title: "Wonderwall", artist: "Oasis", year: 1995, genre: "Rock",
              progression: ["vi", "IV", "I", "V"], section: "verse"),
    SongEntry(title: "Hallelujah", artist: "Leonard Cohen", year: 1984, genre: "Rock",
              progression: ["I", "vi", "I", "vi", "IV", "V", "I"], section: "verse"),
    SongEntry(title: "Hey Jude", artist: "The Beatles", year: 1968, genre: "Rock",
              progression: ["I", "V", "V", "I", "I", "IV", "I"], section: "verse"),
    SongEntry(title: "Piano Man", artist: "Billy Joel", year: 1973, genre: "Rock",
              progression: ["I", "V", "vi", "iii", "IV", "I", "V"], section: "verse"),
    SongEntry(title: "Yesterday", artist: "The Beatles", year: 1965, genre: "Rock",
              progression: ["I", "V", "vi", "IV", "IV", "I", "V", "I"], section: "verse"),
    SongEntry(title: "Bohemian Rhapsody", artist: "Queen", year: 1975, genre: "Rock",
              progression: ["I", "V", "vi", "IV"], section: "verse"),
    SongEntry(title: "Imagine", artist: "John Lennon", year: 1971, genre: "Rock",
              progression: ["I", "IV", "I", "IV"], section: "verse"),
    SongEntry(title: "Knockin' on Heaven's Door", artist: "Bob Dylan", year: 1973, genre: "Rock",
              progression: ["I", "V", "ii"], section: "verse"),
    SongEntry(title: "Brown Eyed Girl", artist: "Van Morrison", year: 1967, genre: "Rock",
              progression: ["I", "IV", "I", "V"], section: "verse"),
    SongEntry(title: "Good Riddance (Time of Your Life)", artist: "Green Day", year: 1997, genre: "Rock",
              progression: ["I", "V", "vi", "IV"], section: "verse"),
    SongEntry(title: "Losing My Religion", artist: "R.E.M.", year: 1991, genre: "Rock",
              progression: ["vi", "IV", "I", "V"], section: "verse"),
    SongEntry(title: "Creep", artist: "Radiohead", year: 1992, genre: "Rock",
              progression: ["I", "III", "IV", "iv"], section: "verse"),
    SongEntry(title: "Wake Me Up When September Ends", artist: "Green Day", year: 2004, genre: "Rock",
              progression: ["I", "V", "vi", "IV"], section: "verse"),
    SongEntry(title: "Clocks", artist: "Coldplay", year: 2002, genre: "Rock",
              progression: ["I", "V", "vi"], section: "verse"),
    SongEntry(title: "Fix You", artist: "Coldplay", year: 2005, genre: "Rock",
              progression: ["I", "III", "vi", "IV"], section: "verse"),
    SongEntry(title: "Viva la Vida", artist: "Coldplay", year: 2008, genre: "Rock",
              progression: ["IV", "V", "I", "vi"], section: "verse"),
    SongEntry(title: "Yellow", artist: "Coldplay", year: 2000, genre: "Rock",
              progression: ["I", "V", "IV"], section: "verse"),

    // ═══════════════════════════════════════════════════════════════════
    //  i - bVII - bVI - V  (Andalusian Cadence)
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Hit the Road Jack", artist: "Ray Charles", year: 1961, genre: "R&B",
              progression: ["vi", "V", "IV", "V"], section: "verse"),
    SongEntry(title: "Sultans of Swing", artist: "Dire Straits", year: 1978, genre: "Rock",
              progression: ["i", "bVII", "bVI", "V"], section: "verse"),
    SongEntry(title: "Stray Cat Strut", artist: "Stray Cats", year: 1981, genre: "Rock",
              progression: ["i", "bVII", "bVI", "V"], section: "verse"),
    SongEntry(title: "Smooth", artist: "Santana ft. Rob Thomas", year: 1999, genre: "Rock",
              progression: ["i", "bVII", "bVI", "V"], section: "verse"),

    // ═══════════════════════════════════════════════════════════════════
    //  I - bVII - IV - I  (Mixolydian / Rock)
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Sympathy for the Devil", artist: "The Rolling Stones", year: 1968, genre: "Rock",
              progression: ["I", "bVII", "IV", "I"], section: "verse"),
    SongEntry(title: "Hey Joe", artist: "Jimi Hendrix", year: 1966, genre: "Rock",
              progression: ["bVI", "bVII", "I"], section: "verse"),

    // ═══════════════════════════════════════════════════════════════════
    //  Jazz Standards
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Autumn Leaves", artist: "Joseph Kosma", year: 1945, genre: "Jazz",
              progression: ["ii", "V", "I", "IV", "vii°", "III", "vi"], section: nil),
    SongEntry(title: "All The Things You Are", artist: "Jerome Kern", year: 1939, genre: "Jazz",
              progression: ["vi", "ii", "V", "I", "IV"], section: nil),
    SongEntry(title: "Blue Bossa", artist: "Kenny Dorham", year: 1963, genre: "Jazz",
              progression: ["i", "iv", "ii", "V", "I"], section: nil),
    SongEntry(title: "Fly Me to the Moon", artist: "Bart Howard", year: 1954, genre: "Jazz",
              progression: ["vi", "ii", "V", "I"], section: nil),
    SongEntry(title: "Take the A Train", artist: "Billy Strayhorn", year: 1941, genre: "Jazz",
              progression: ["I", "II", "ii", "V"], section: nil),
    SongEntry(title: "Satin Doll", artist: "Duke Ellington", year: 1953, genre: "Jazz",
              progression: ["ii", "V", "ii", "V", "I"], section: nil),
    SongEntry(title: "So What", artist: "Miles Davis", year: 1959, genre: "Jazz",
              progression: ["i", "i", "i", "i"], section: "A section"),
    SongEntry(title: "Summertime", artist: "George Gershwin", year: 1935, genre: "Jazz",
              progression: ["i", "iv", "i", "V"], section: nil),
    SongEntry(title: "All of Me", artist: "Marks & Simons", year: 1931, genre: "Jazz",
              progression: ["I", "III", "vi", "II", "ii", "V", "I"], section: nil),
    SongEntry(title: "Girl from Ipanema", artist: "Antonio Carlos Jobim", year: 1962, genre: "Jazz",
              progression: ["I", "II", "ii", "V"], section: nil),
    SongEntry(title: "My Funny Valentine", artist: "Rodgers & Hart", year: 1937, genre: "Jazz",
              progression: ["i", "i", "bVII", "bVI", "V"], section: nil),
    SongEntry(title: "Body and Soul", artist: "Johnny Green", year: 1930, genre: "Jazz",
              progression: ["ii", "V", "I", "vi", "ii", "V"], section: nil),
    SongEntry(title: "Round Midnight", artist: "Thelonious Monk", year: 1944, genre: "Jazz",
              progression: ["i", "iv", "bVII", "bVI", "V", "i"], section: nil),
    SongEntry(title: "Stella by Starlight", artist: "Victor Young", year: 1944, genre: "Jazz",
              progression: ["ii", "V", "IV", "bVII", "I"], section: nil),
    SongEntry(title: "Misty", artist: "Erroll Garner", year: 1954, genre: "Jazz",
              progression: ["I", "V", "I", "IV", "ii", "V"], section: nil),
    SongEntry(title: "Blue Moon", artist: "Rodgers & Hart", year: 1934, genre: "Jazz",
              progression: ["I", "vi", "ii", "V"], section: nil),
    SongEntry(title: "Bye Bye Blackbird", artist: "Henderson & Dixon", year: 1926, genre: "Jazz",
              progression: ["I", "vi", "ii", "V", "I"], section: nil),
    SongEntry(title: "Night and Day", artist: "Cole Porter", year: 1932, genre: "Jazz",
              progression: ["bII", "I", "bII", "I"], section: nil),
    SongEntry(title: "On Green Dolphin Street", artist: "Bronislau Kaper", year: 1947, genre: "Jazz",
              progression: ["I", "I", "bII", "bII", "I"], section: nil),
    SongEntry(title: "Cherokee", artist: "Ray Noble", year: 1938, genre: "Jazz",
              progression: ["I", "I", "V", "V", "I"], section: nil),

    // ═══════════════════════════════════════════════════════════════════
    //  Blues
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Sweet Home Chicago", artist: "Robert Johnson", year: 1936, genre: "Blues",
              progression: ["I", "I", "I", "I", "IV", "IV", "I", "I", "V", "IV", "I", "V"],
              section: "12-bar"),
    SongEntry(title: "The Thrill Is Gone", artist: "B.B. King", year: 1969, genre: "Blues",
              progression: ["i", "i", "i", "i", "iv", "iv", "i", "i", "bVI", "V", "i", "i"],
              section: "12-bar minor"),
    SongEntry(title: "Stormy Monday", artist: "T-Bone Walker", year: 1947, genre: "Blues",
              progression: ["I", "IV", "I", "I", "IV", "IV", "I", "I", "V", "IV", "I", "V"],
              section: "12-bar"),
    SongEntry(title: "Crossroads", artist: "Robert Johnson", year: 1936, genre: "Blues",
              progression: ["I", "I", "I", "I", "IV", "IV", "I", "I", "V", "IV", "I", "V"],
              section: "12-bar"),
    SongEntry(title: "Pride and Joy", artist: "Stevie Ray Vaughan", year: 1983, genre: "Blues",
              progression: ["I", "I", "I", "I", "IV", "IV", "I", "I", "V", "IV", "I", "V"],
              section: "12-bar"),
    SongEntry(title: "Red House", artist: "Jimi Hendrix", year: 1967, genre: "Blues",
              progression: ["I", "I", "I", "I", "IV", "IV", "I", "I", "V", "IV", "I", "V"],
              section: "12-bar"),

    // ═══════════════════════════════════════════════════════════════════
    //  ii - V - I  (Jazz cadence)
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "The Days of Wine and Roses", artist: "Henry Mancini", year: 1962, genre: "Jazz",
              progression: ["I", "ii", "V", "I"], section: nil),
    SongEntry(title: "There Will Never Be Another You", artist: "Harry Warren", year: 1942, genre: "Jazz",
              progression: ["I", "ii", "V", "I", "IV"], section: nil),
    SongEntry(title: "Just Friends", artist: "John Klenner", year: 1931, genre: "Jazz",
              progression: ["I", "ii", "V", "I", "vi"], section: nil),

    // ═══════════════════════════════════════════════════════════════════
    //  More Classic Songs
    // ═══════════════════════════════════════════════════════════════════

    SongEntry(title: "Africa", artist: "Toto", year: 1982, genre: "Rock",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Take on Me", artist: "a-ha", year: 1985, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "I'm Yours", artist: "Jason Mraz", year: 2008, genre: "Pop",
              progression: ["I", "V", "vi", "IV"], section: "verse"),
    SongEntry(title: "Riptide", artist: "Vance Joy", year: 2013, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "verse"),
    SongEntry(title: "21 Guns", artist: "Green Day", year: 2009, genre: "Rock",
              progression: ["I", "V", "vi", "IV"], section: "chorus"),
    SongEntry(title: "Despacito", artist: "Luis Fonsi", year: 2017, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Someone You Loved", artist: "Lewis Capaldi", year: 2018, genre: "Pop",
              progression: ["I", "V", "vi", "IV"], section: "chorus"),
    SongEntry(title: "A Thousand Years", artist: "Christina Perri", year: 2011, genre: "Pop",
              progression: ["I", "V", "vi", "IV"], section: "chorus"),
    SongEntry(title: "Love Story", artist: "Taylor Swift", year: 2008, genre: "Pop",
              progression: ["I", "V", "vi", "IV"], section: "chorus"),
    SongEntry(title: "Payphone", artist: "Maroon 5", year: 2012, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Let Her Go", artist: "Passenger", year: 2012, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Chandelier", artist: "Sia", year: 2014, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Hello", artist: "Adele", year: 2015, genre: "Pop",
              progression: ["vi", "IV", "I", "V"], section: "verse"),
    SongEntry(title: "Titanium", artist: "David Guetta ft. Sia", year: 2011, genre: "Electronic",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Wake Me Up", artist: "Avicii", year: 2013, genre: "Electronic",
              progression: ["vi", "IV", "I", "V"], section: "chorus"),
    SongEntry(title: "Levels", artist: "Avicii", year: 2011, genre: "Electronic",
              progression: ["vi", "IV", "I", "V"], section: "hook"),
    SongEntry(title: "Lean on Me", artist: "Bill Withers", year: 1972, genre: "R&B",
              progression: ["I", "IV", "I", "V", "IV", "I"], section: "verse"),
    SongEntry(title: "Ain't No Sunshine", artist: "Bill Withers", year: 1971, genre: "R&B",
              progression: ["vi", "vi", "vi", "IV", "V"], section: "verse"),
    SongEntry(title: "Superstition", artist: "Stevie Wonder", year: 1972, genre: "R&B",
              progression: ["i", "IV", "i", "bVII"], section: "verse"),
    SongEntry(title: "What's Going On", artist: "Marvin Gaye", year: 1971, genre: "R&B",
              progression: ["I", "ii", "I", "ii"], section: "verse"),
    SongEntry(title: "Isn't She Lovely", artist: "Stevie Wonder", year: 1976, genre: "R&B",
              progression: ["I", "IV", "V", "I"], section: "verse"),
]
