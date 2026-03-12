import AVFoundation
import Accelerate

final class Sampler {
    private static let defaultPolyphony = 24

    private struct VoiceRuntime {
        let note: UInt8
        let velocity: UInt8
        let trigger: SampleTrigger
        let player: AVAudioPlayerNode
        let pitchUnit: AVAudioUnitTimePitch
        let toneFilter: AVAudioUnitEQ
    }

    private let engine: AVAudioEngine
    private let mixer: AVAudioMixerNode
    private let filterNode: AVAudioUnitEQ

    /// Built-in General MIDI synth — used as fallback when no custom samples are loaded.
    private let gmSynth = AVAudioUnitSampler()

    /// Cached PCM buffers keyed by source URL so multiple zones can reuse the same sample.
    private var sampleBufferCache: [URL: AVAudioPCMBuffer] = [:]

    /// The current sample instrument loaded in this sampler (preview or track instrument).
    private var loadedInstrument: LoadedInstrumentDefinition?

    /// Preview rack state used by the instrument view before an instrument is saved to disk.
    private var previewInstrumentDefinition = InstrumentDefinition(name: "Imported Sampler", type: .sampler)
    private var previewSampleSources: [String: URL] = [:]

    private var voiceAllocator = VoiceAllocator(maxVoices: Sampler.defaultPolyphony)
    private let roundRobinSelector = RoundRobinSelector()
    private var activeVoices: [Int: VoiceRuntime] = [:]
    private var noteToVoiceIndices: [UInt8: Set<Int>] = [:]
    private var envelopeTasks: [Int: [DispatchWorkItem]] = [:]

    // ADSR envelope
    var attack: Float = 0.01
    var decay: Float = 0.1
    var sustain: Float = 0.8
    var release: Float = 0.3

    // Basic output shaping
    var outputGain: Float = 1.0 {
        didSet { applyOutputShaping() }
    }
    var outputPan: Float = 0.0 {
        didSet { applyOutputShaping() }
    }

    // Filter
    var filterCutoff: Float = 20000 {
        didSet { applyFilter() }
    }
    var filterResonance: Float = 0 {
        didSet { applyFilter() }
    }
    var filterType: String = "LP" {
        didSet { applyFilter() }
    }

    init(engine: AVAudioEngine) {
        self.engine = engine
        self.mixer = AVAudioMixerNode()
        self.filterNode = AVAudioUnitEQ(numberOfBands: 1)
        engine.attach(mixer)
        engine.attach(filterNode)
        engine.attach(gmSynth)
        engine.connect(gmSynth, to: mixer, format: nil)
        engine.connect(mixer, to: filterNode, format: nil)
        loadGMSoundbank()
        applyFilter()
        applyOutputShaping()
    }

    /// Load the macOS built-in DLS General MIDI soundbank into the GM synth.
    private func loadGMSoundbank() {
        let dlsPath = "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls"
        let dlsURL = URL(fileURLWithPath: dlsPath)
        do {
            try gmSynth.loadSoundBankInstrument(
                at: dlsURL,
                program: 0,
                bankMSB: 0x79,
                bankLSB: 0
            )
            print("[Sampler] Loaded built-in GM piano")
        } catch {
            print("[Sampler] Failed to load GM soundbank: \(error)")
        }
    }

    /// Connect this sampler's output to a destination mixer.
    func connect(to destination: AVAudioMixerNode) {
        let format = destination.outputFormat(forBus: 0)
        engine.connect(filterNode, to: destination, format: format)
    }

    // MARK: - Instrument Loading

    /// Clear all currently loaded sample regions so the sampler falls back to GM playback.
    func clearLoadedInstrument() {
        allNotesOff()
        loadedInstrument = nil
        previewInstrumentDefinition = InstrumentDefinition(name: "Imported Sampler", type: .sampler)
        previewSampleSources.removeAll()
        sampleBufferCache.removeAll()
        voiceAllocator = VoiceAllocator(maxVoices: Sampler.defaultPolyphony)
    }

    /// Load a single sample into the preview rack.
    func loadSample(
        url: URL,
        rootNote: UInt8,
        lowNote: UInt8,
        highNote: UInt8,
        lowVelocity: UInt8 = 0,
        highVelocity: UInt8 = 127,
        tuning: Double = 0.0
    ) throws {
        let sampleURL = url.standardizedFileURL
        _ = try buffer(for: sampleURL)

        var definition = previewInstrumentDefinition
        if definition.zones == nil {
            definition.zones = []
        }

        let sampleFile = uniquePreviewSampleFileName(for: sampleURL)
        previewSampleSources[sampleFile] = sampleURL
        definition.name = definition.name.isEmpty ? "Imported Sampler" : definition.name
        let zone = SampleZone(
            sampleFile: sampleFile,
            trigger: .attack,
            rootNote: rootNote,
            lowNote: lowNote,
            highNote: highNote,
            lowVelocity: lowVelocity,
            highVelocity: highVelocity,
            loopStart: nil,
            loopEnd: nil,
            tuning: tuning
        )
        definition.zones?.removeAll {
            $0.sampleFile == sampleFile &&
            $0.rootNote == rootNote &&
            $0.lowNote == lowNote &&
            $0.highNote == highNote &&
            $0.lowVelocity == lowVelocity &&
            $0.highVelocity == highVelocity
        }
        definition.zones?.append(zone)

        try setPreviewInstrument(definition)
    }

    func loadOneshot(url: URL, rootNote: UInt8 = 60) throws {
        try loadSample(url: url, rootNote: rootNote, lowNote: rootNote, highNote: rootNote)
    }

    func loadInstrument(_ loaded: LoadedInstrumentDefinition) throws {
        for region in loaded.regions {
            _ = try buffer(for: region.sampleURL)
        }
        allNotesOff()
        loadedInstrument = loaded
        previewInstrumentDefinition = loaded.definition
        previewSampleSources = Dictionary(uniqueKeysWithValues: loaded.regions.map { ($0.zone.sampleFile, $0.sampleURL) })
        applyInstrumentParameters(loaded.definition)
        voiceAllocator = VoiceAllocator(maxVoices: max(1, loaded.definition.polyphony))
    }

    func loadPreviewInstrument(definition: InstrumentDefinition, sampleSources: [String: URL]) throws {
        allNotesOff()
        previewInstrumentDefinition = definition
        previewSampleSources = Dictionary(
            uniqueKeysWithValues: sampleSources.map { ($0.key, $0.value.standardizedFileURL) }
        )
        try setPreviewInstrument(definition)
        applyInstrumentParameters(definition)
        voiceAllocator = VoiceAllocator(maxVoices: max(1, definition.polyphony))
    }

    func applyZoneMappings(_ mappings: [SampleZone]) throws {
        guard !previewSampleSources.isEmpty else { return }
        var definition = previewInstrumentDefinition
        definition.zones = mappings
        try setPreviewInstrument(definition)
    }

    func exportPreviewInstrument(named name: String? = nil) -> (definition: InstrumentDefinition, sources: [String: URL])? {
        guard !previewSampleSources.isEmpty else { return nil }
        var definition = previewInstrumentDefinition
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty {
            definition = InstrumentDefinition(
                name: trimmed,
                type: .sampler
            ).mergingSamplerSettings(from: previewInstrumentDefinition)
        }
        definition.envelope = ADSRParameters(attack: attack, decay: decay, sustain: sustain, release: release)
        definition.filter = FilterParameters(
            type: filterType.instrumentFilterType,
            cutoff: filterCutoff,
            resonance: min(1.0, max(0.0, filterResonance)),
            envAmount: previewInstrumentDefinition.filter?.envAmount ?? 0.0,
            keyTracking: previewInstrumentDefinition.filter?.keyTracking ?? 0.0
        )
        definition.polyphony = max(1, previewInstrumentDefinition.polyphony)
        definition.roundRobin = previewInstrumentDefinition.roundRobin ?? false
        definition.velocityLayers = previewInstrumentDefinition.velocityLayers
        definition.zones = previewInstrumentDefinition.zones
        definition.outputGain = outputGain
        definition.outputPan = outputPan
        return (definition, previewSampleSources)
    }

    // MARK: - Playback

    func noteOn(note: UInt8, velocity: UInt8) {
        guard let selected = selectRegion(note: note, velocity: velocity, trigger: .attack),
              let buffer = try? buffer(for: selected.sampleURL) else {
            ensureEngineRunning()
            gmSynth.startNote(note, withVelocity: velocity, onChannel: 0)
            return
        }

        triggerRegionPlayback(
            selected,
            note: note,
            velocity: velocity,
            buffer: buffer,
            trigger: .attack,
            allowLooping: true
        )
    }

    func noteOff(note: UInt8) {
        let now = DispatchTime.now().uptimeNanoseconds
        let releasedVoiceIndices = voiceAllocator.release(note: note, at: now)
        guard !releasedVoiceIndices.isEmpty else {
            gmSynth.stopNote(note, onChannel: 0)
            return
        }

        for voiceIndex in releasedVoiceIndices {
            guard let voice = activeVoices[voiceIndex] else { continue }
            triggerReleaseRegion(for: voice.note, velocity: voice.velocity)
            cancelEnvelopeTasks(for: voiceIndex)
            if release > 0.001 {
                let currentVolume = voice.player.volume
                let releaseTasks = makeRampTasks(
                    player: voice.player,
                    from: currentVolume,
                    to: 0.0,
                    duration: release,
                    delay: 0.0
                ) { [weak self] in
                    self?.cleanupVoice(index: voiceIndex)
                }
                storeEnvelopeTasks(releaseTasks, for: voiceIndex)
            } else {
                cleanupVoice(index: voiceIndex)
            }
        }
    }

    func allNotesOff() {
        for voiceIndex in Array(activeVoices.keys) {
            cleanupVoice(index: voiceIndex)
        }
        noteToVoiceIndices.removeAll()
    }

    // MARK: - Filter

    private func applyFilter() {
        guard let band = filterNode.bands.first else { return }
        switch filterType {
        case "HP":
            band.filterType = .highPass
        case "BP":
            band.filterType = .bandPass
        case "Notch":
            band.filterType = .parametric
        default:
            band.filterType = .lowPass
        }
        band.frequency = filterCutoff
        band.bandwidth = max(0.05, filterResonance)
        band.bypass = false
    }

    private func applyOutputShaping() {
        mixer.outputVolume = max(0.0, outputGain)
        mixer.pan = min(1.0, max(-1.0, outputPan))
    }

    // MARK: - Sample Metadata

    func sampleMetadata() -> [(filename: String, rootNote: UInt8, durationSeconds: Double)] {
        let zones = activeZones()
        return zones.compactMap { zone in
            guard let url = sourceURL(for: zone.sampleFile),
                  let buffer = sampleBufferCache[url] else { return nil }
            let duration = Double(buffer.frameLength) / buffer.format.sampleRate
            return (filename: url.lastPathComponent, rootNote: zone.rootNote, durationSeconds: duration)
        }
        .sorted { $0.rootNote < $1.rootNote }
    }

    func waveformData(for rootNote: UInt8, points: Int = 500) -> [Float]? {
        guard let zone = activeZones().first(where: { $0.rootNote == rootNote }),
              let url = sourceURL(for: zone.sampleFile),
              let buffer = sampleBufferCache[url],
              let channelData = buffer.floatChannelData else { return nil }

        let frameCount = Int(buffer.frameLength)
        guard frameCount > 0 else { return nil }

        let stride = max(1, frameCount / points)
        var result: [Float] = []
        result.reserveCapacity(points)

        for i in Swift.stride(from: 0, to: frameCount, by: stride) {
            let end = min(i + stride, frameCount)
            var maxVal: Float = 0
            var minVal: Float = 0
            for j in i..<end {
                let sample = channelData[0][j]
                if sample > maxVal { maxVal = sample }
                if sample < minVal { minVal = sample }
            }
            result.append(abs(maxVal) > abs(minVal) ? maxVal : minVal)
        }

        return result
    }

    func loadedZones() -> [(rootNote: UInt8, lowNote: UInt8, highNote: UInt8, sampleFile: String, lowVelocity: UInt8, highVelocity: UInt8)] {
        activeZones()
            .map { ($0.rootNote, $0.lowNote, $0.highNote, $0.sampleFile, $0.lowVelocity, $0.highVelocity) }
            .sorted { ($0.lowNote, $0.lowVelocity) < ($1.lowNote, $1.lowVelocity) }
    }

    // MARK: - GM Program & Preset

    func setGMProgram(_ program: UInt8, bankMSB: UInt8 = 0x79) {
        let dlsURL = URL(fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
        do {
            try gmSynth.loadSoundBankInstrument(at: dlsURL, program: program, bankMSB: bankMSB, bankLSB: 0)
            print("[Sampler] Loaded GM program \(program) bank=\(bankMSB)")
        } catch {
            print("[Sampler] Failed to load GM program \(program): \(error)")
        }
        loadedInstrument = nil
        previewInstrumentDefinition = InstrumentDefinition(name: "Imported Sampler", type: .sampler)
        previewSampleSources.removeAll()
        sampleBufferCache.removeAll()
        voiceAllocator = VoiceAllocator(maxVoices: Sampler.defaultPolyphony)
    }

    func applyPreset(_ preset: InstrumentPreset) {
        setGMProgram(preset.gmProgram, bankMSB: preset.bankMSB)
        attack = preset.attack
        decay = preset.decay
        sustain = preset.sustain
        release = preset.release
        filterCutoff = preset.filterCutoff
        filterResonance = preset.filterResonance
        filterType = preset.filterType
    }

    var hasSamples: Bool {
        !activeZones().isEmpty
    }

    var hasGMSynth: Bool { true }

    // MARK: - Private

    private func setPreviewInstrument(_ definition: InstrumentDefinition) throws {
        let regions = try (definition.zones ?? []).map { zone -> LoadedSampleRegion in
            guard let source = previewSampleSources[zone.sampleFile] else {
                throw SamplerError.missingPreviewSample(zone.sampleFile)
            }
            return LoadedSampleRegion(sampleURL: source, zone: zone)
        }
        let loaded = LoadedInstrumentDefinition(
            definitionURL: URL(fileURLWithPath: "/preview/\(definition.name).magicinstrument"),
            definition: definition,
            regions: regions
        )
        previewInstrumentDefinition = definition
        try loadInstrument(loaded)
    }

    private func selectRegion(note: UInt8, velocity: UInt8) -> LoadedSampleRegion? {
        selectRegion(note: note, velocity: velocity, trigger: .attack)
    }

    private func selectRegion(note: UInt8, velocity: UInt8, trigger: SampleTrigger) -> LoadedSampleRegion? {
        guard let loadedInstrument else { return nil }
        let matching = loadedInstrument.matchingRegions(note: note, velocity: velocity, trigger: trigger)
        return roundRobinSelector.select(
            from: matching,
            enabled: loadedInstrument.definition.roundRobin ?? false
        )
    }

    private func activeZones() -> [SampleZone] {
        loadedInstrument?.definition.zones ?? previewInstrumentDefinition.zones ?? []
    }

    private func sourceURL(for sampleFile: String) -> URL? {
        previewSampleSources[sampleFile]
            ?? loadedInstrument?.regions.first(where: { $0.zone.sampleFile == sampleFile })?.sampleURL
    }

    private func triggerReleaseRegion(for note: UInt8, velocity: UInt8) {
        guard let selected = selectRegion(note: note, velocity: velocity, trigger: .release),
              let buffer = try? buffer(for: selected.sampleURL) else {
            return
        }
        triggerRegionPlayback(
            selected,
            note: note,
            velocity: velocity,
            buffer: buffer,
            trigger: .release,
            allowLooping: false
        )
    }

    private func triggerRegionPlayback(
        _ selected: LoadedSampleRegion,
        note: UInt8,
        velocity: UInt8,
        buffer: AVAudioPCMBuffer,
        trigger: SampleTrigger,
        allowLooping: Bool
    ) {
        ensureEngineRunning()

        let now = DispatchTime.now().uptimeNanoseconds
        let allocation = voiceAllocator.allocate(note: note, at: now)
        if let stolen = allocation.stolenVoiceIndex {
            cleanupVoice(index: stolen)
        }

        let player = AVAudioPlayerNode()
        let timePitch = AVAudioUnitTimePitch()
        let toneFilter = AVAudioUnitEQ(numberOfBands: 1)
        engine.attach(player)
        engine.attach(timePitch)
        engine.attach(toneFilter)

        let format = buffer.format
        let pitchRatio = selected.zone.pitchRatio(forNote: note)
        timePitch.pitch = Float(log2(pitchRatio) * 1200.0)
        timePitch.rate = 1.0
        configureVoiceFilter(toneFilter, note: note, velocity: velocity)
        engine.connect(player, to: timePitch, format: format)
        engine.connect(timePitch, to: toneFilter, format: format)
        engine.connect(toneFilter, to: mixer, format: format)

        let velocityGain = Float(velocity) / 127.0
        player.volume = trigger == .release ? velocityGain : (attack > 0.001 ? 0.0 : velocityGain)
        player.pan = 0.0

        let loopPlan = allowLooping ? loopPlan(for: selected.zone, buffer: buffer) : nil
        activeVoices[allocation.voiceIndex] = VoiceRuntime(
            note: note,
            velocity: velocity,
            trigger: trigger,
            player: player,
            pitchUnit: timePitch,
            toneFilter: toneFilter
        )
        if trigger == .attack {
            noteToVoiceIndices[note, default: []].insert(allocation.voiceIndex)
        }

        if let loopPlan {
            if let introBuffer = loopPlan.introBuffer {
                player.scheduleBuffer(introBuffer, at: nil, options: [], completionHandler: nil)
            }
            player.scheduleBuffer(loopPlan.loopBuffer, at: nil, options: .loops, completionHandler: nil)
        } else {
            player.scheduleBuffer(buffer, at: nil, options: [], completionCallbackType: .dataPlayedBack) { [weak self] _ in
                DispatchQueue.main.async {
                    self?.cleanupVoice(index: allocation.voiceIndex)
                }
            }
        }
        player.play()
        scheduleAttackDecayEnvelope(
            for: allocation.voiceIndex,
            player: player,
            peakVolume: velocityGain,
            trigger: trigger
        )
    }

    private func applyInstrumentParameters(_ definition: InstrumentDefinition) {
        if let envelope = definition.envelope {
            attack = envelope.attack
            decay = envelope.decay
            sustain = envelope.sustain
            release = envelope.release
        }
        if let filter = definition.filter {
            filterCutoff = filter.cutoff
            filterResonance = filter.resonance
            switch filter.type {
            case .highpass:
                filterType = "HP"
            case .bandpass:
                filterType = "BP"
            case .notch:
                filterType = "Notch"
            case .lowpass:
                filterType = "LP"
            }
        }
        outputGain = definition.outputGain
        outputPan = definition.outputPan
    }

    private func configureVoiceFilter(_ eq: AVAudioUnitEQ, note: UInt8, velocity: UInt8) {
        guard let band = eq.bands.first else { return }
        let definitionFilter = loadedInstrument?.definition.filter ?? previewInstrumentDefinition.filter
        let filter = definitionFilter ?? FilterParameters(type: .lowpass, cutoff: filterCutoff, resonance: filterResonance, envAmount: 0.0, keyTracking: 0.0)
        let velocityNorm = Float(velocity) / 127.0
        let centeredVelocity = max(-1.0, min(1.0, (velocityNorm - 0.5) * 2.0))
        let velocityScale = 1.0 + centeredVelocity * 0.45
        let semitoneOffset = Float(Int(note) - 60)
        let keyTrackingScale = 1.0 + ((filter.keyTracking * semitoneOffset) / 36.0)
        let computedCutoff = max(80.0, min(20_000.0, filter.cutoff * velocityScale * keyTrackingScale))

        switch filter.type {
        case .highpass:
            band.filterType = .highPass
        case .bandpass:
            band.filterType = .bandPass
        case .notch:
            band.filterType = .parametric
        case .lowpass:
            band.filterType = .lowPass
        }
        band.frequency = computedCutoff
        band.bandwidth = max(0.05, filter.resonance)
        band.gain = 0
        band.bypass = false
    }

    private func uniquePreviewSampleFileName(for url: URL) -> String {
        let base = url.lastPathComponent
        if previewSampleSources[base] == nil || previewSampleSources[base] == url.standardizedFileURL {
            return base
        }
        let stem = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension
        var suffix = 2
        while true {
            let candidate = "\(stem)-\(suffix).\(ext)"
            if previewSampleSources[candidate] == nil {
                return candidate
            }
            suffix += 1
        }
    }

    private func loopPlan(for zone: SampleZone, buffer: AVAudioPCMBuffer) -> (introBuffer: AVAudioPCMBuffer?, loopBuffer: AVAudioPCMBuffer)? {
        guard let loopStart = zone.loopStart,
              let loopEnd = zone.loopEnd else { return nil }

        let totalFrames = Int(buffer.frameLength)
        let clampedStart = max(0, min(loopStart, totalFrames - 1))
        let clampedEnd = max(clampedStart + 1, min(loopEnd, totalFrames))
        guard clampedEnd > clampedStart else { return nil }

        let introLength = clampedStart
        let loopLength = clampedEnd - clampedStart

        let introBuffer = introLength > 0 ? copyBufferSlice(buffer, startFrame: 0, frameCount: introLength) : nil
        guard let loopBuffer = copyBufferSlice(buffer, startFrame: clampedStart, frameCount: loopLength) else {
            return nil
        }
        applyLoopCrossfade(to: loopBuffer)
        return (introBuffer, loopBuffer)
    }

    private func copyBufferSlice(_ source: AVAudioPCMBuffer, startFrame: Int, frameCount: Int) -> AVAudioPCMBuffer? {
        guard frameCount > 0,
              startFrame >= 0,
              startFrame + frameCount <= Int(source.frameLength),
              let destination = AVAudioPCMBuffer(
                pcmFormat: source.format,
                frameCapacity: AVAudioFrameCount(frameCount)
              ) else {
            return nil
        }

        destination.frameLength = AVAudioFrameCount(frameCount)
        let sourceList = UnsafeMutableAudioBufferListPointer(source.mutableAudioBufferList)
        let destinationList = UnsafeMutableAudioBufferListPointer(destination.mutableAudioBufferList)

        for index in 0..<min(sourceList.count, destinationList.count) {
            let sourceBuffer = sourceList[index]
            let destinationBuffer = destinationList[index]
            let bytesPerFrame = Int(sourceBuffer.mDataByteSize) / max(1, Int(source.frameLength))
            let byteCount = frameCount * bytesPerFrame
            guard let sourceBase = sourceBuffer.mData,
                  let destinationBase = destinationBuffer.mData else { continue }
            memcpy(
                destinationBase,
                sourceBase.advanced(by: startFrame * bytesPerFrame),
                byteCount
            )
            destinationList[index].mDataByteSize = UInt32(byteCount)
        }

        return destination
    }

    private func cleanupVoice(index: Int) {
        cancelEnvelopeTasks(for: index)
        guard let voice = activeVoices.removeValue(forKey: index) else { return }
        voice.player.stop()
        engine.disconnectNodeOutput(voice.player)
        engine.detach(voice.player)
        engine.disconnectNodeOutput(voice.pitchUnit)
        engine.detach(voice.pitchUnit)
        engine.disconnectNodeOutput(voice.toneFilter)
        engine.detach(voice.toneFilter)

        if var voiceIndices = noteToVoiceIndices[voice.note] {
            voiceIndices.remove(index)
            noteToVoiceIndices[voice.note] = voiceIndices.isEmpty ? nil : voiceIndices
        }

        voiceAllocator.finishVoice(index)
    }

    private func scheduleAttackDecayEnvelope(for voiceIndex: Int, player: AVAudioPlayerNode, peakVolume: Float, trigger: SampleTrigger) {
        cancelEnvelopeTasks(for: voiceIndex)

        if trigger == .release {
            if attack > 0.001 {
                let fadeIn = min(0.008, max(0.001, attack * 0.25))
                let tasks = makeRampTasks(
                    player: player,
                    from: 0.0,
                    to: peakVolume,
                    duration: fadeIn,
                    delay: 0.0,
                    completion: nil
                )
                storeEnvelopeTasks(tasks, for: voiceIndex)
            } else {
                player.volume = peakVolume
            }
            return
        }

        let clampedSustain = max(0.0, min(1.0, sustain))
        let sustainVolume = peakVolume * clampedSustain
        var tasks: [DispatchWorkItem] = []

        if attack > 0.001 {
            tasks += makeRampTasks(
                player: player,
                from: 0.0,
                to: peakVolume,
                duration: attack,
                delay: 0.0,
                completion: nil
            )
        } else {
            player.volume = peakVolume
        }

        if decay > 0.001, abs(sustainVolume - peakVolume) > 0.0001 {
            tasks += makeRampTasks(
                player: player,
                from: peakVolume,
                to: sustainVolume,
                duration: decay,
                delay: attack > 0.001 ? attack : 0.0,
                completion: nil
            )
        } else if attack <= 0.001 {
            player.volume = sustainVolume
        }

        storeEnvelopeTasks(tasks, for: voiceIndex)
    }

    private func applyLoopCrossfade(to buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData else { return }
        let frameCount = Int(buffer.frameLength)
        guard frameCount > 64 else { return }

        let maxCrossfadeFrames = max(32, Int(buffer.format.sampleRate * 0.012))
        let crossfadeFrames = min(frameCount / 6, maxCrossfadeFrames)
        guard crossfadeFrames > 8 else { return }

        let channelCount = Int(buffer.format.channelCount)
        for channel in 0..<channelCount {
            let samples = channelData[channel]
            for frame in 0..<crossfadeFrames {
                let fadeIn = Float(frame) / Float(crossfadeFrames - 1)
                let fadeOut = 1.0 - fadeIn
                let startIndex = frame
                let endIndex = frameCount - crossfadeFrames + frame
                let startSample = samples[startIndex]
                let endSample = samples[endIndex]
                let blended = (startSample * fadeIn) + (endSample * fadeOut)
                samples[startIndex] = blended
                samples[endIndex] = blended
            }
        }
    }

    private func storeEnvelopeTasks(_ tasks: [DispatchWorkItem], for voiceIndex: Int) {
        guard !tasks.isEmpty else { return }
        envelopeTasks[voiceIndex] = tasks
    }

    private func cancelEnvelopeTasks(for voiceIndex: Int) {
        envelopeTasks.removeValue(forKey: voiceIndex)?.forEach { $0.cancel() }
    }

    private func makeRampTasks(
        player: AVAudioPlayerNode,
        from start: Float,
        to end: Float,
        duration: Float,
        delay: Float,
        completion: (() -> Void)? = nil
    ) -> [DispatchWorkItem] {
        let steps = 20
        let stepDuration = TimeInterval(duration) / TimeInterval(steps)
        let baseDelay = TimeInterval(delay)
        var tasks: [DispatchWorkItem] = []
        for i in 0...steps {
            let fraction = Float(i) / Float(steps)
            let volume = start + (end - start) * fraction
            var task: DispatchWorkItem?
            task = DispatchWorkItem { [weak player] in
                guard task?.isCancelled == false else { return }
                player?.volume = volume
                if i == steps { completion?() }
            }
            guard let task else { continue }
            tasks.append(task)
            DispatchQueue.main.asyncAfter(deadline: .now() + baseDelay + stepDuration * Double(i), execute: task)
        }
        return tasks
    }

    private func ensureEngineRunning() {
        guard !engine.isRunning else { return }
        do {
            engine.prepare()
            try engine.start()
            print("[Sampler] Started AVAudioEngine for playback")
        } catch {
            print("[Sampler] Failed to start engine: \(error)")
        }
    }

    private func buffer(for url: URL) throws -> AVAudioPCMBuffer {
        if let cached = sampleBufferCache[url] {
            return cached
        }
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        let frameCount = AVAudioFrameCount(file.length)

        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
            throw SamplerError.bufferCreationFailed
        }

        try file.read(into: buffer)
        sampleBufferCache[url] = buffer
        return buffer
    }
}

private extension InstrumentDefinition {
    func mergingSamplerSettings(from other: InstrumentDefinition) -> InstrumentDefinition {
        var merged = self
        merged.zones = other.zones
        merged.envelope = other.envelope
        merged.filter = other.filter
        merged.roundRobin = other.roundRobin
        merged.velocityLayers = other.velocityLayers
        merged.polyphony = other.polyphony
        merged.portamento = other.portamento
        merged.pitchBendRange = other.pitchBendRange
        merged.outputGain = other.outputGain
        merged.outputPan = other.outputPan
        return merged
    }
}

private extension String {
    var instrumentFilterLabel: String {
        switch lowercased() {
        case "high pass", "highpass":
            return "HP"
        case "band pass", "bandpass":
            return "BP"
        case "notch":
            return "Notch"
        default:
            return "LP"
        }
    }
}

private extension String {
    var instrumentFilterType: FilterType {
        switch uppercased() {
        case "HP":
            return .highpass
        case "BP":
            return .bandpass
        case "NOTCH":
            return .notch
        default:
            return .lowpass
        }
    }
}

enum SamplerError: Error, LocalizedError {
    case bufferCreationFailed
    case fileLoadFailed(URL)
    case missingPreviewSample(String)

    var errorDescription: String? {
        switch self {
        case .bufferCreationFailed:
            return "Failed to create audio buffer"
        case .fileLoadFailed(let url):
            return "Failed to load audio file: \(url.lastPathComponent)"
        case .missingPreviewSample(let sampleFile):
            return "Missing preview sample source for \(sampleFile)"
        }
    }
}
