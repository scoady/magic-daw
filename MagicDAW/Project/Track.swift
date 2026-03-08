import Foundation

// MARK: - Track

@Observable
class Track: Codable, Identifiable {
    let id: UUID
    var name: String
    var type: TrackType
    var color: TrackColor
    var clips: [Clip]

    // Mixer state
    var volume: Float = 0.0       // dB, 0.0 = unity gain
    var pan: Float = 0.0          // -1.0 (L) to 1.0 (R)
    var isMuted: Bool = false
    var isSoloed: Bool = false
    var isArmed: Bool = false
    var height: Double = 80.0     // UI track height in points

    // Effects chain
    var effects: [EffectSlot]

    // Send routing
    var sends: [SendLevel]

    // Instrument (MIDI tracks only)
    var instrument: InstrumentRef?

    // Output routing (nil = master bus)
    var outputBusId: UUID?

    // MARK: - Init

    init(name: String, type: TrackType, color: TrackColor) {
        self.id = UUID()
        self.name = name
        self.type = type
        self.color = color
        self.clips = []
        self.effects = []
        self.sends = []
        self.instrument = nil
        self.outputBusId = nil
    }

    // MARK: - Codable

    enum CodingKeys: String, CodingKey {
        case id, name, type, color, clips, volume, pan
        case isMuted, isSoloed, isArmed, height
        case effects, sends, instrument, outputBusId
    }

    required init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        type = try container.decode(TrackType.self, forKey: .type)
        color = try container.decode(TrackColor.self, forKey: .color)
        clips = try container.decode([Clip].self, forKey: .clips)
        volume = try container.decodeIfPresent(Float.self, forKey: .volume) ?? 0.0
        pan = try container.decodeIfPresent(Float.self, forKey: .pan) ?? 0.0
        isMuted = try container.decodeIfPresent(Bool.self, forKey: .isMuted) ?? false
        isSoloed = try container.decodeIfPresent(Bool.self, forKey: .isSoloed) ?? false
        isArmed = try container.decodeIfPresent(Bool.self, forKey: .isArmed) ?? false
        height = try container.decodeIfPresent(Double.self, forKey: .height) ?? 80.0
        effects = try container.decodeIfPresent([EffectSlot].self, forKey: .effects) ?? []
        sends = try container.decodeIfPresent([SendLevel].self, forKey: .sends) ?? []
        instrument = try container.decodeIfPresent(InstrumentRef.self, forKey: .instrument)
        outputBusId = try container.decodeIfPresent(UUID.self, forKey: .outputBusId)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encode(type, forKey: .type)
        try container.encode(color, forKey: .color)
        try container.encode(clips, forKey: .clips)
        try container.encode(volume, forKey: .volume)
        try container.encode(pan, forKey: .pan)
        try container.encode(isMuted, forKey: .isMuted)
        try container.encode(isSoloed, forKey: .isSoloed)
        try container.encode(isArmed, forKey: .isArmed)
        try container.encode(height, forKey: .height)
        try container.encode(effects, forKey: .effects)
        try container.encode(sends, forKey: .sends)
        try container.encodeIfPresent(instrument, forKey: .instrument)
        try container.encodeIfPresent(outputBusId, forKey: .outputBusId)
    }

    // MARK: - Clip Management

    /// Add a clip to this track, maintaining sort order by startBar
    @discardableResult
    func addClip(_ clip: Clip) -> Clip {
        clips.append(clip)
        clips.sort { $0.startBar < $1.startBar }
        return clip
    }

    /// Remove a clip by ID
    func removeClip(id: UUID) {
        clips.removeAll { $0.id == id }
    }

    /// Create and add an empty MIDI clip
    @discardableResult
    func addMIDIClip(name: String, startBar: Double, lengthBars: Double) -> Clip {
        let clip = Clip(name: name, type: .midi, startBar: startBar, lengthBars: lengthBars)
        return addClip(clip)
    }

    /// Create and add an audio clip referencing a file
    @discardableResult
    func addAudioClip(name: String, startBar: Double, lengthBars: Double, audioFile: String) -> Clip {
        let clip = Clip(name: name, type: .audio, startBar: startBar, lengthBars: lengthBars)
        clip.audioFile = audioFile
        return addClip(clip)
    }

    // MARK: - Effects Chain

    /// Insert an effect at a given position (or append if nil)
    @discardableResult
    func insertEffect(_ effectType: EffectType, at index: Int? = nil) -> EffectSlot {
        let slot = EffectSlot(effectType: effectType)
        if let index, effects.indices.contains(index) {
            effects.insert(slot, at: index)
        } else {
            effects.append(slot)
        }
        return slot
    }

    /// Remove an effect by ID
    func removeEffect(id: UUID) {
        effects.removeAll { $0.id == id }
    }

    /// Move an effect in the chain
    func moveEffect(from source: Int, to destination: Int) {
        guard source != destination,
              effects.indices.contains(source),
              destination >= 0, destination <= effects.count else { return }
        let effect = effects.remove(at: source)
        let insertIndex = destination > source ? destination - 1 : destination
        effects.insert(effect, at: min(insertIndex, effects.count))
    }

    // MARK: - Sends

    /// Add a send to a bus track
    @discardableResult
    func addSend(to busTrackId: UUID, level: Float = -6.0, preFader: Bool = false) -> SendLevel {
        let send = SendLevel(busTrackId: busTrackId, level: level, isPreFader: preFader)
        sends.append(send)
        return send
    }

    /// Remove a send by ID
    func removeSend(id: UUID) {
        sends.removeAll { $0.id == id }
    }

    // MARK: - Helpers

    /// Linear gain multiplier from dB volume
    var linearGain: Float {
        if volume <= -96.0 { return 0.0 }
        return powf(10.0, volume / 20.0)
    }

    /// Left channel gain accounting for pan law (constant power)
    var leftGain: Float {
        let angle = (Double(pan) + 1.0) * .pi / 4.0
        return linearGain * Float(cos(angle))
    }

    /// Right channel gain accounting for pan law (constant power)
    var rightGain: Float {
        let angle = (Double(pan) + 1.0) * .pi / 4.0
        return linearGain * Float(sin(angle))
    }
}

// MARK: - TrackType

enum TrackType: String, Codable, Sendable {
    case midi
    case audio
    case bus
    case master
}

// MARK: - TrackColor

enum TrackColor: String, Codable, CaseIterable, Sendable {
    case teal, green, cyan, purple, pink, gold, orange, red, blue, indigo

    var hex: String {
        switch self {
        case .teal:    return "#008080"
        case .green:   return "#4CAF50"
        case .cyan:    return "#00BCD4"
        case .purple:  return "#9C27B0"
        case .pink:    return "#E91E63"
        case .gold:    return "#FFC107"
        case .orange:  return "#FF9800"
        case .red:     return "#F44336"
        case .blue:    return "#2196F3"
        case .indigo:  return "#3F51B5"
        }
    }

    /// Lighter variant for clip backgrounds
    var lightHex: String {
        switch self {
        case .teal:    return "#4DB6AC"
        case .green:   return "#81C784"
        case .cyan:    return "#4DD0E1"
        case .purple:  return "#CE93D8"
        case .pink:    return "#F48FB1"
        case .gold:    return "#FFD54F"
        case .orange:  return "#FFB74D"
        case .red:     return "#E57373"
        case .blue:    return "#64B5F6"
        case .indigo:  return "#7986CB"
        }
    }
}

// MARK: - EffectSlot

struct EffectSlot: Codable, Identifiable {
    let id: UUID
    var effectType: EffectType
    var isEnabled: Bool
    var parameters: [String: Double]

    init(effectType: EffectType, isEnabled: Bool = true) {
        self.id = UUID()
        self.effectType = effectType
        self.isEnabled = isEnabled
        self.parameters = effectType.defaultParameters
    }
}

// MARK: - EffectType

enum EffectType: String, Codable, CaseIterable, Sendable {
    case eq
    case compressor
    case reverb
    case delay
    case chorus
    case distortion
    case bitcrusher
    case phaser
    case flanger

    var displayName: String {
        switch self {
        case .eq:          return "Equalizer"
        case .compressor:  return "Compressor"
        case .reverb:      return "Reverb"
        case .delay:       return "Delay"
        case .chorus:      return "Chorus"
        case .distortion:  return "Distortion"
        case .bitcrusher:  return "Bitcrusher"
        case .phaser:      return "Phaser"
        case .flanger:     return "Flanger"
        }
    }

    var defaultParameters: [String: Double] {
        switch self {
        case .eq:
            return [
                "lowGain": 0.0, "midGain": 0.0, "highGain": 0.0,
                "lowFreq": 200.0, "midFreq": 1000.0, "highFreq": 5000.0,
                "midQ": 1.0
            ]
        case .compressor:
            return [
                "threshold": -20.0, "ratio": 4.0,
                "attack": 10.0, "release": 100.0,
                "makeupGain": 0.0, "knee": 6.0
            ]
        case .reverb:
            return [
                "roomSize": 0.5, "damping": 0.5,
                "wetLevel": 0.3, "dryLevel": 1.0,
                "preDelay": 20.0, "width": 1.0
            ]
        case .delay:
            return [
                "time": 375.0, "feedback": 0.4,
                "wetLevel": 0.3, "dryLevel": 1.0,
                "lowCut": 200.0, "highCut": 8000.0
            ]
        case .chorus:
            return [
                "rate": 1.5, "depth": 0.5,
                "mix": 0.5, "feedback": 0.2
            ]
        case .distortion:
            return [
                "drive": 0.5, "tone": 0.5,
                "mix": 1.0, "outputLevel": 0.0
            ]
        case .bitcrusher:
            return [
                "bitDepth": 8.0, "sampleRateReduction": 1.0,
                "mix": 1.0
            ]
        case .phaser:
            return [
                "rate": 0.5, "depth": 0.7,
                "feedback": 0.5, "stages": 4.0, "mix": 0.5
            ]
        case .flanger:
            return [
                "rate": 0.3, "depth": 0.7,
                "feedback": 0.5, "mix": 0.5
            ]
        }
    }
}

// MARK: - SendLevel

struct SendLevel: Codable, Identifiable {
    let id: UUID
    var busTrackId: UUID
    var level: Float   // dB
    var isPreFader: Bool

    init(busTrackId: UUID, level: Float = -6.0, isPreFader: Bool = false) {
        self.id = UUID()
        self.busTrackId = busTrackId
        self.level = level
        self.isPreFader = isPreFader
    }
}

// MARK: - InstrumentRef

struct InstrumentRef: Codable {
    var type: InstrumentType
    var name: String
    var path: String?   // relative path to .magicinstrument file within project bundle
}

// MARK: - InstrumentType

enum InstrumentType: String, Codable, Sendable {
    case sampler
    case synth
    case external
}
