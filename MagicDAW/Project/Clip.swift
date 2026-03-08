import Foundation

// MARK: - Clip

@Observable
class Clip: Codable, Identifiable {
    let id: UUID
    var name: String
    var type: ClipType
    var startBar: Double     // position in bars from project start (can be fractional)
    var lengthBars: Double   // length in bars (can be fractional)
    var color: TrackColor?   // optional override of the parent track's color

    // MIDI clip data
    var midiEvents: [MIDIEvent]?

    // Audio clip data
    var audioFile: String?            // relative path within the project bundle's audio/ directory
    var audioOffset: TimeInterval?    // offset into the source audio file (for trimmed clips)
    var audioGain: Float?             // clip-level gain adjustment in dB

    // Looping
    var isLooped: Bool = false
    var loopLengthBars: Double?       // if looped, the length of the loop content (clip repeats this)

    // MARK: - Computed

    var endBar: Double { startBar + lengthBars }

    /// Duration of the clip content before any looping
    var contentLengthBars: Double {
        loopLengthBars ?? lengthBars
    }

    // MARK: - Init

    init(name: String, type: ClipType, startBar: Double, lengthBars: Double) {
        self.id = UUID()
        self.name = name
        self.type = type
        self.startBar = startBar
        self.lengthBars = lengthBars
        self.color = nil
        self.midiEvents = type == .midi ? [] : nil
        self.audioFile = nil
        self.audioOffset = nil
        self.audioGain = nil
        self.isLooped = false
        self.loopLengthBars = nil
    }

    // MARK: - Codable

    enum CodingKeys: String, CodingKey {
        case id, name, type, startBar, lengthBars, color
        case midiEvents, audioFile, audioOffset, audioGain
        case isLooped, loopLengthBars
    }

    required init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        type = try container.decode(ClipType.self, forKey: .type)
        startBar = try container.decode(Double.self, forKey: .startBar)
        lengthBars = try container.decode(Double.self, forKey: .lengthBars)
        color = try container.decodeIfPresent(TrackColor.self, forKey: .color)
        midiEvents = try container.decodeIfPresent([MIDIEvent].self, forKey: .midiEvents)
        audioFile = try container.decodeIfPresent(String.self, forKey: .audioFile)
        audioOffset = try container.decodeIfPresent(TimeInterval.self, forKey: .audioOffset)
        audioGain = try container.decodeIfPresent(Float.self, forKey: .audioGain)
        isLooped = try container.decodeIfPresent(Bool.self, forKey: .isLooped) ?? false
        loopLengthBars = try container.decodeIfPresent(Double.self, forKey: .loopLengthBars)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encode(type, forKey: .type)
        try container.encode(startBar, forKey: .startBar)
        try container.encode(lengthBars, forKey: .lengthBars)
        try container.encodeIfPresent(color, forKey: .color)
        try container.encodeIfPresent(midiEvents, forKey: .midiEvents)
        try container.encodeIfPresent(audioFile, forKey: .audioFile)
        try container.encodeIfPresent(audioOffset, forKey: .audioOffset)
        try container.encodeIfPresent(audioGain, forKey: .audioGain)
        try container.encode(isLooped, forKey: .isLooped)
        try container.encodeIfPresent(loopLengthBars, forKey: .loopLengthBars)
    }

    // MARK: - MIDI Helpers

    /// Add a note event to a MIDI clip
    @discardableResult
    func addNote(tick: Double, note: UInt8, velocity: UInt8 = 100, duration: Double = 1.0, channel: UInt8 = 0) -> MIDIEvent? {
        guard type == .midi else { return nil }
        let event = MIDIEvent(
            tick: tick,
            type: .noteOn,
            note: note,
            velocity: velocity,
            duration: duration,
            channel: channel
        )
        if midiEvents == nil { midiEvents = [] }
        midiEvents?.append(event)
        midiEvents?.sort()
        return event
    }

    /// Remove all MIDI events at a given tick and note
    func removeNote(tick: Double, note: UInt8) {
        midiEvents?.removeAll { $0.tick == tick && $0.note == note && $0.type == .noteOn }
    }

    /// Get all note-on events sorted by tick
    var notes: [MIDIEvent] {
        (midiEvents ?? []).filter { $0.type == .noteOn }.sorted()
    }

    /// Quantize all note events to a given grid size in beats
    func quantize(gridSize: Double) {
        guard var events = midiEvents else { return }
        for i in events.indices where events[i].type == .noteOn {
            let quantized = (events[i].tick / gridSize).rounded() * gridSize
            events[i] = MIDIEvent(
                tick: quantized,
                type: events[i].type,
                note: events[i].note,
                velocity: events[i].velocity,
                duration: events[i].duration,
                channel: events[i].channel
            )
        }
        midiEvents = events.sorted()
    }

    /// Transpose all notes by a number of semitones
    func transpose(semitones: Int) {
        guard var events = midiEvents else { return }
        for i in events.indices where events[i].type == .noteOn {
            let newNote = Int(events[i].note) + semitones
            guard newNote >= 0, newNote <= 127 else { continue }
            events[i] = MIDIEvent(
                tick: events[i].tick,
                type: events[i].type,
                note: UInt8(newNote),
                velocity: events[i].velocity,
                duration: events[i].duration,
                channel: events[i].channel
            )
        }
        midiEvents = events
    }

    // MARK: - Splitting

    /// Split this clip at a given bar position, returning the new right-half clip (or nil if out of range)
    func split(atBar bar: Double) -> Clip? {
        guard bar > startBar, bar < endBar else { return nil }

        let rightLength = endBar - bar
        let right = Clip(name: "\(name) (R)", type: type, startBar: bar, lengthBars: rightLength)
        right.color = color

        if type == .midi, let events = midiEvents {
            let splitTick = bar - startBar  // relative to clip start, in bars
            // Beats per bar is not available here — the split point is in bars same as tick unit
            right.midiEvents = events
                .filter { $0.tick >= splitTick }
                .map { MIDIEvent(tick: $0.tick - splitTick, type: $0.type, note: $0.note, velocity: $0.velocity, duration: $0.duration, channel: $0.channel) }
            midiEvents = events.filter { $0.tick < splitTick }
        }

        if type == .audio {
            right.audioFile = audioFile
            right.audioGain = audioGain
            // Offset into the audio file increases by the split amount
            // (caller must convert bars to seconds using project BPM)
        }

        lengthBars = bar - startBar
        return right
    }
}

// MARK: - ClipType

enum ClipType: String, Codable, Sendable {
    case midi
    case audio
}

// MARK: - MIDIEvent

struct MIDIEvent: Codable, Comparable, Hashable, Sendable {
    let tick: Double       // position in beats relative to clip start
    let type: MIDIEventType
    let note: UInt8        // MIDI note number (0-127)
    let velocity: UInt8    // velocity (0-127)
    let duration: Double   // duration in beats (for noteOn events)
    let channel: UInt8     // MIDI channel (0-15)

    static func < (lhs: MIDIEvent, rhs: MIDIEvent) -> Bool {
        if lhs.tick != rhs.tick { return lhs.tick < rhs.tick }
        // noteOff should come before noteOn at the same tick
        if lhs.type == .noteOff && rhs.type == .noteOn { return true }
        if lhs.type == .noteOn && rhs.type == .noteOff { return false }
        return lhs.note < rhs.note
    }
}

// MARK: - MIDIEventType

enum MIDIEventType: String, Codable, Sendable {
    case noteOn
    case noteOff
    case controlChange
    case pitchBend
    case programChange
}
