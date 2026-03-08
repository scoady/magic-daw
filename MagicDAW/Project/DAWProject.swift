import Foundation

// MARK: - ProjectKey

enum ProjectKey: String, Codable, CaseIterable {
    case c = "C"
    case cSharp = "C#"
    case d = "D"
    case dSharp = "D#"
    case e = "E"
    case f = "F"
    case fSharp = "F#"
    case g = "G"
    case gSharp = "G#"
    case a = "A"
    case aSharp = "A#"
    case b = "B"

    enum Scale: String, Codable, CaseIterable {
        case major, minor, dorian, mixolydian, phrygian, lydian, harmonicMinor, melodicMinor
    }
}

// MARK: - TimeSignature

struct TimeSignature: Codable, Hashable, Sendable {
    let numerator: Int
    let denominator: Int

    var description: String { "\(numerator)/\(denominator)" }

    /// Duration of one bar in beats (quarter notes)
    var beatsPerBar: Double {
        Double(numerator) * (4.0 / Double(denominator))
    }

    static let common = TimeSignature(numerator: 4, denominator: 4)
    static let waltz = TimeSignature(numerator: 3, denominator: 4)
    static let sixEight = TimeSignature(numerator: 6, denominator: 8)
    static let fiveFour = TimeSignature(numerator: 5, denominator: 4)
    static let sevenEight = TimeSignature(numerator: 7, denominator: 8)
}

// MARK: - Marker

struct Marker: Codable, Identifiable, Hashable {
    let id: UUID
    var name: String
    var bar: Int
    var color: String

    init(name: String, bar: Int, color: String = "#FFFFFF") {
        self.id = UUID()
        self.name = name
        self.bar = bar
        self.color = color
    }
}

// MARK: - DAWProject

@Observable
class DAWProject: Codable {
    var name: String
    var bpm: Double
    var timeSignature: TimeSignature
    var key: ProjectKey?
    var keyScale: ProjectKey.Scale?
    var tracks: [Track]
    var markers: [Marker]
    var createdAt: Date
    var modifiedAt: Date

    /// URL this project was last saved to / loaded from
    var fileURL: URL?

    // MARK: - Computed Properties

    /// Total project duration based on the furthest clip end across all tracks
    var duration: TimeInterval {
        let maxEndBar = tracks
            .flatMap(\.clips)
            .map(\.endBar)
            .max() ?? 0.0

        guard maxEndBar > 0, bpm > 0 else { return 0 }

        let beatsPerBar = timeSignature.beatsPerBar
        let totalBeats = maxEndBar * beatsPerBar
        return (totalBeats / bpm) * 60.0
    }

    /// Number of bars covering all content (minimum 16 for empty projects)
    var barCount: Int {
        let maxEndBar = tracks
            .flatMap(\.clips)
            .map(\.endBar)
            .max() ?? 0.0
        return max(16, Int(ceil(maxEndBar)))
    }

    // MARK: - Initializer

    init(name: String = "Untitled") {
        self.name = name
        self.bpm = 120.0
        self.timeSignature = .common
        self.key = nil
        self.keyScale = nil
        self.tracks = []
        self.markers = []
        self.createdAt = Date()
        self.modifiedAt = Date()
        self.fileURL = nil
    }

    // MARK: - Codable

    enum CodingKeys: String, CodingKey {
        case name, bpm, timeSignature, key, keyScale, tracks, markers, createdAt, modifiedAt
    }

    required init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        bpm = try container.decode(Double.self, forKey: .bpm)
        timeSignature = try container.decode(TimeSignature.self, forKey: .timeSignature)
        key = try container.decodeIfPresent(ProjectKey.self, forKey: .key)
        keyScale = try container.decodeIfPresent(ProjectKey.Scale.self, forKey: .keyScale)
        tracks = try container.decode([Track].self, forKey: .tracks)
        markers = try container.decode([Marker].self, forKey: .markers)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        modifiedAt = try container.decode(Date.self, forKey: .modifiedAt)
        fileURL = nil
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(bpm, forKey: .bpm)
        try container.encode(timeSignature, forKey: .timeSignature)
        try container.encodeIfPresent(key, forKey: .key)
        try container.encodeIfPresent(keyScale, forKey: .keyScale)
        try container.encode(tracks, forKey: .tracks)
        try container.encode(markers, forKey: .markers)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(modifiedAt, forKey: .modifiedAt)
    }

    // MARK: - Track Management

    /// Add a MIDI track and return it
    @discardableResult
    func addMIDITrack(name: String, color: TrackColor = .teal) -> Track {
        let track = Track(name: name, type: .midi, color: color)
        tracks.append(track)
        touch()
        return track
    }

    /// Add an audio track and return it
    @discardableResult
    func addAudioTrack(name: String, color: TrackColor = .blue) -> Track {
        let track = Track(name: name, type: .audio, color: color)
        tracks.append(track)
        touch()
        return track
    }

    /// Add a bus/aux track for routing sends
    @discardableResult
    func addBusTrack(name: String) -> Track {
        let track = Track(name: name, type: .bus, color: .purple)
        tracks.append(track)
        touch()
        return track
    }

    /// Remove a track by its ID
    func removeTrack(id: UUID) {
        tracks.removeAll { $0.id == id }
        // Clean up sends referencing this track
        for track in tracks {
            track.sends.removeAll { $0.busTrackId == id }
        }
        touch()
    }

    /// Reorder a track from one index to another
    func moveTrack(from source: Int, to destination: Int) {
        guard source != destination,
              tracks.indices.contains(source),
              destination >= 0, destination <= tracks.count else { return }

        let track = tracks.remove(at: source)
        let insertIndex = destination > source ? destination - 1 : destination
        tracks.insert(track, at: min(insertIndex, tracks.count))
        touch()
    }

    /// Add a marker at a given bar
    @discardableResult
    func addMarker(name: String, bar: Int, color: String = "#FFFFFF") -> Marker {
        let marker = Marker(name: name, bar: bar, color: color)
        markers.append(marker)
        markers.sort { $0.bar < $1.bar }
        touch()
        return marker
    }

    /// Remove a marker by ID
    func removeMarker(id: UUID) {
        markers.removeAll { $0.id == id }
        touch()
    }

    // MARK: - Helpers

    /// Update modification timestamp
    private func touch() {
        modifiedAt = Date()
    }

    /// Convert a bar position to time in seconds
    func barToTime(_ bar: Double) -> TimeInterval {
        guard bpm > 0 else { return 0 }
        let beatsPerBar = timeSignature.beatsPerBar
        let totalBeats = bar * beatsPerBar
        return (totalBeats / bpm) * 60.0
    }

    /// Convert time in seconds to a bar position
    func timeToBar(_ time: TimeInterval) -> Double {
        guard bpm > 0 else { return 0 }
        let beatsPerBar = timeSignature.beatsPerBar
        let totalBeats = (time / 60.0) * bpm
        return totalBeats / beatsPerBar
    }
}
