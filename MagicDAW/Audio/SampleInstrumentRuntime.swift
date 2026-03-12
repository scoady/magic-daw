import Foundation

struct LoadedSampleRegion: Identifiable, Sendable {
    let id: UUID
    let sampleURL: URL
    let zone: SampleZone

    init(sampleURL: URL, zone: SampleZone) {
        self.id = zone.id
        self.sampleURL = sampleURL
        self.zone = zone
    }

    func matches(note: UInt8, velocity: UInt8) -> Bool {
        zone.trigger == .attack &&
        note >= zone.lowNote && note <= zone.highNote &&
        velocity >= zone.lowVelocity && velocity <= zone.highVelocity
    }

    func matches(note: UInt8, velocity: UInt8, trigger: SampleTrigger) -> Bool {
        zone.trigger == trigger &&
        note >= zone.lowNote && note <= zone.highNote &&
        velocity >= zone.lowVelocity && velocity <= zone.highVelocity
    }

    var roundRobinKey: SampleRoundRobinKey {
        SampleRoundRobinKey(
            trigger: zone.trigger,
            rootNote: zone.rootNote,
            lowNote: zone.lowNote,
            highNote: zone.highNote,
            lowVelocity: zone.lowVelocity,
            highVelocity: zone.highVelocity
        )
    }
}

struct LoadedInstrumentDefinition: Sendable {
    let definitionURL: URL
    let definition: InstrumentDefinition
    let regions: [LoadedSampleRegion]

    func matchingRegions(note: UInt8, velocity: UInt8) -> [LoadedSampleRegion] {
        matchingRegions(note: note, velocity: velocity, trigger: .attack)
    }

    func matchingRegions(note: UInt8, velocity: UInt8, trigger: SampleTrigger) -> [LoadedSampleRegion] {
        regions.filter { $0.matches(note: note, velocity: velocity, trigger: trigger) }
    }
}

struct SampleInstrumentSummary: Sendable {
    let name: String
    let path: String
    let zoneCount: Int
    let sampleCount: Int
}

struct SampleRoundRobinKey: Hashable, Sendable {
    let trigger: SampleTrigger
    let rootNote: UInt8
    let lowNote: UInt8
    let highNote: UInt8
    let lowVelocity: UInt8
    let highVelocity: UInt8
}

final class RoundRobinSelector: @unchecked Sendable {
    private let lock = NSLock()
    private var nextIndexByKey: [SampleRoundRobinKey: Int] = [:]

    func select(from regions: [LoadedSampleRegion], enabled: Bool) -> LoadedSampleRegion? {
        guard !regions.isEmpty else { return nil }
        guard enabled else { return regions.first }

        let grouped = Dictionary(grouping: regions, by: \.roundRobinKey)
        let orderedGroups = grouped.keys.sorted {
            ($0.trigger.rawValue, $0.lowNote, $0.highNote, $0.lowVelocity, $0.highVelocity, $0.rootNote) <
            ($1.trigger.rawValue, $1.lowNote, $1.highNote, $1.lowVelocity, $1.highVelocity, $1.rootNote)
        }
        guard let key = orderedGroups.first,
              let group = grouped[key]?.sorted(by: { $0.sampleURL.lastPathComponent < $1.sampleURL.lastPathComponent }) else {
            return regions.first
        }

        lock.lock()
        defer { lock.unlock() }
        let index = nextIndexByKey[key, default: 0]
        let selected = group[index % group.count]
        nextIndexByKey[key] = (index + 1) % group.count
        return selected
    }
}

struct VoiceAllocation: Sendable {
    let voiceIndex: Int
    let stolenVoiceIndex: Int?
}

final class VoiceAllocator: @unchecked Sendable {
    struct VoiceState: Sendable {
        var note: UInt8?
        var startedAt: UInt64
        var releasedAt: UInt64?

        var isIdle: Bool { note == nil }
        var isReleased: Bool { note != nil && releasedAt != nil }
    }

    private let maxVoices: Int
    private let lock = NSLock()
    private var voices: [VoiceState]

    init(maxVoices: Int) {
        self.maxVoices = max(1, maxVoices)
        self.voices = Array(
            repeating: VoiceState(note: nil, startedAt: 0, releasedAt: nil),
            count: max(1, maxVoices)
        )
    }

    func allocate(note: UInt8, at time: UInt64) -> VoiceAllocation {
        lock.lock()
        defer { lock.unlock() }

        if let idleIndex = voices.firstIndex(where: \.isIdle) {
            voices[idleIndex] = VoiceState(note: note, startedAt: time, releasedAt: nil)
            return VoiceAllocation(voiceIndex: idleIndex, stolenVoiceIndex: nil)
        }

        if let releasedIndex = voices.enumerated()
            .filter({ $0.element.isReleased })
            .min(by: { ($0.element.releasedAt ?? 0) < ($1.element.releasedAt ?? 0) })?
            .offset {
            voices[releasedIndex] = VoiceState(note: note, startedAt: time, releasedAt: nil)
            return VoiceAllocation(voiceIndex: releasedIndex, stolenVoiceIndex: releasedIndex)
        }

        let stolenIndex = voices.enumerated()
            .min(by: { $0.element.startedAt < $1.element.startedAt })?
            .offset ?? 0
        voices[stolenIndex] = VoiceState(note: note, startedAt: time, releasedAt: nil)
        return VoiceAllocation(voiceIndex: stolenIndex, stolenVoiceIndex: stolenIndex)
    }

    func release(note: UInt8, at time: UInt64) -> [Int] {
        lock.lock()
        defer { lock.unlock() }

        var releasedIndices: [Int] = []
        for index in voices.indices where voices[index].note == note {
            voices[index].releasedAt = time
            releasedIndices.append(index)
        }
        return releasedIndices
    }

    func finishVoice(_ index: Int) {
        lock.lock()
        defer { lock.unlock() }
        guard voices.indices.contains(index) else { return }
        voices[index] = VoiceState(note: nil, startedAt: 0, releasedAt: nil)
    }

    func snapshot() -> [VoiceState] {
        lock.lock()
        defer { lock.unlock() }
        return voices
    }
}

enum InstrumentLoaderError: LocalizedError {
    case unsupportedInstrumentType
    case missingZones
    case missingSampleFile(String)

    var errorDescription: String? {
        switch self {
        case .unsupportedInstrumentType:
            return "Only sampler instruments are supported by the sample loader."
        case .missingZones:
            return "The instrument definition does not contain any sample zones."
        case .missingSampleFile(let file):
            return "Missing sample file: \(file)"
        }
    }
}

final class InstrumentLoader: @unchecked Sendable {
    private let queue = DispatchQueue(label: "magicdaw.instrument-loader", qos: .userInitiated)
    private let cacheLock = NSLock()
    private var cache: [URL: LoadedInstrumentDefinition] = [:]

    func loadInstrument(at definitionURL: URL, completion: @escaping (Result<LoadedInstrumentDefinition, Error>) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }
            do {
                let instrument = try self.loadInstrumentSync(at: definitionURL)
                completion(.success(instrument))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func loadInstrumentSync(at definitionURL: URL) throws -> LoadedInstrumentDefinition {
        cacheLock.lock()
        if let cached = cache[definitionURL] {
            cacheLock.unlock()
            return cached
        }
        cacheLock.unlock()

        let definition = try InstrumentDefinition.load(from: definitionURL)
        guard definition.type == .sampler else {
            throw InstrumentLoaderError.unsupportedInstrumentType
        }
        guard let zones = definition.zones, !zones.isEmpty else {
            throw InstrumentLoaderError.missingZones
        }

        let instrumentFolder = definitionURL.deletingLastPathComponent()
        let regions = try zones.map { zone -> LoadedSampleRegion in
            let sampleURL = instrumentFolder.appendingPathComponent(zone.sampleFile)
            guard FileManager.default.fileExists(atPath: sampleURL.path) else {
                throw InstrumentLoaderError.missingSampleFile(zone.sampleFile)
            }
            return LoadedSampleRegion(sampleURL: sampleURL, zone: zone)
        }

        let loaded = LoadedInstrumentDefinition(
            definitionURL: definitionURL,
            definition: definition,
            regions: regions
        )

        cacheLock.lock()
        cache[definitionURL] = loaded
        cacheLock.unlock()
        return loaded
    }

    func invalidateCache(for definitionURL: URL? = nil) {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        if let definitionURL {
            cache.removeValue(forKey: definitionURL)
        } else {
            cache.removeAll()
        }
    }
}
