import Foundation

// MARK: - InstrumentDefinition

/// Represents a complete instrument definition stored as a .magicinstrument file
/// within the project bundle's instruments/ directory.
struct InstrumentDefinition: Codable {
    let name: String
    let type: InstrumentType
    let version: Int

    // For samplers
    var zones: [SampleZone]?
    var envelope: ADSRParameters?
    var filter: FilterParameters?
    var roundRobin: Bool?
    var velocityLayers: Int?

    // For synths (node graph based)
    var nodeGraph: NodeGraphDefinition?

    // Shared
    var polyphony: Int
    var portamento: Float?          // glide time in ms (0 = off)
    var pitchBendRange: UInt8       // semitones

    init(name: String, type: InstrumentType) {
        self.name = name
        self.type = type
        self.version = 1
        self.zones = type == .sampler ? [] : nil
        self.envelope = ADSRParameters.defaultPiano
        self.filter = nil
        self.roundRobin = nil
        self.velocityLayers = nil
        self.nodeGraph = type == .synth ? NodeGraphDefinition.empty(name: name) : nil
        self.polyphony = 16
        self.portamento = nil
        self.pitchBendRange = 2
    }

    // MARK: - Save / Load

    /// Encode and write to a .magicinstrument file
    func save(to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(self)
        try data.write(to: url, options: .atomic)
    }

    /// Load from a .magicinstrument file
    static func load(from url: URL) throws -> InstrumentDefinition {
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(InstrumentDefinition.self, from: data)
    }

    // MARK: - Sampler Helpers

    /// Find the sample zone that should play for a given note and velocity
    func zoneForNote(_ note: UInt8, velocity: UInt8) -> SampleZone? {
        zones?.first { zone in
            note >= zone.lowNote && note <= zone.highNote &&
            velocity >= zone.lowVelocity && velocity <= zone.highVelocity
        }
    }

    /// Add a sample zone mapped to a single key
    mutating func addSingleKeyZone(sampleFile: String, note: UInt8) {
        let zone = SampleZone(
            sampleFile: sampleFile,
            rootNote: note,
            lowNote: note,
            highNote: note,
            lowVelocity: 0,
            highVelocity: 127,
            loopStart: nil,
            loopEnd: nil,
            tuning: 0.0
        )
        if zones == nil { zones = [] }
        zones?.append(zone)
    }

    /// Add a sample zone mapped to a range of keys
    mutating func addRangeZone(sampleFile: String, rootNote: UInt8, lowNote: UInt8, highNote: UInt8) {
        let zone = SampleZone(
            sampleFile: sampleFile,
            rootNote: rootNote,
            lowNote: lowNote,
            highNote: highNote,
            lowVelocity: 0,
            highVelocity: 127,
            loopStart: nil,
            loopEnd: nil,
            tuning: 0.0
        )
        if zones == nil { zones = [] }
        zones?.append(zone)
    }
}

// MARK: - SampleZone

struct SampleZone: Codable, Identifiable {
    var id: UUID = UUID()

    let sampleFile: String   // relative path within instruments/ directory
    let rootNote: UInt8      // the note at which the sample plays at original pitch
    let lowNote: UInt8       // lowest note in the zone range
    let highNote: UInt8      // highest note in the zone range
    let lowVelocity: UInt8   // lowest velocity that triggers this zone
    let highVelocity: UInt8  // highest velocity that triggers this zone
    var loopStart: Int?      // loop start point in samples
    var loopEnd: Int?        // loop end point in samples
    var tuning: Double       // fine tuning in cents (-100 to +100)

    /// Pitch ratio needed to play this sample at a given MIDI note
    func pitchRatio(forNote note: UInt8) -> Double {
        let semitones = Double(Int(note) - Int(rootNote)) + (tuning / 100.0)
        return pow(2.0, semitones / 12.0)
    }
}

// MARK: - ADSRParameters

struct ADSRParameters: Codable, Hashable {
    var attack: Float    // seconds (0.001 - 10.0)
    var decay: Float     // seconds (0.001 - 10.0)
    var sustain: Float   // level 0.0 - 1.0
    var release: Float   // seconds (0.001 - 30.0)

    static let defaultPiano = ADSRParameters(attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.3)
    static let defaultPad = ADSRParameters(attack: 0.5, decay: 0.5, sustain: 0.8, release: 1.5)
    static let defaultPluck = ADSRParameters(attack: 0.001, decay: 0.15, sustain: 0.0, release: 0.1)
    static let defaultOrgan = ADSRParameters(attack: 0.01, decay: 0.01, sustain: 1.0, release: 0.05)

    /// Clamp all values to valid ranges
    mutating func clamp() {
        attack = Swift.max(0.001, Swift.min(10.0, attack))
        decay = Swift.max(0.001, Swift.min(10.0, decay))
        sustain = Swift.max(0.0, Swift.min(1.0, sustain))
        release = Swift.max(0.001, Swift.min(30.0, release))
    }
}

// MARK: - FilterParameters

struct FilterParameters: Codable, Hashable {
    var type: FilterType
    var cutoff: Float       // Hz (20 - 20000)
    var resonance: Float    // 0.0 - 1.0 (maps to Q factor)
    var envAmount: Float    // how much the envelope modulates cutoff (-1.0 to 1.0)
    var keyTracking: Float  // 0.0 - 1.0: how much the cutoff follows the played note

    init(type: FilterType = .lowpass, cutoff: Float = 8000.0, resonance: Float = 0.0, envAmount: Float = 0.0, keyTracking: Float = 0.0) {
        self.type = type
        self.cutoff = cutoff
        self.resonance = resonance
        self.envAmount = envAmount
        self.keyTracking = keyTracking
    }

    /// Convert resonance (0-1) to Q factor for biquad filters
    var qFactor: Float {
        // Map 0-1 to Q range of 0.5 to 20
        0.5 + resonance * 19.5
    }
}

// MARK: - FilterType

enum FilterType: String, Codable, CaseIterable, Sendable {
    case lowpass
    case highpass
    case bandpass
    case notch

    var displayName: String {
        switch self {
        case .lowpass:  return "Low Pass"
        case .highpass: return "High Pass"
        case .bandpass: return "Band Pass"
        case .notch:    return "Notch"
        }
    }
}
