import AVFoundation
import Accelerate

class Sampler {
    private var sampleBuffers: [UInt8: AVAudioPCMBuffer] = [:]  // MIDI note -> buffer
    private var sampleRootNotes: [UInt8: UInt8] = [:]            // mapped note -> root note
    private var activePlayers: [UInt8: AVAudioPlayerNode] = [:]
    private var pitchUnits: [UInt8: AVAudioUnitTimePitch] = [:]
    private let engine: AVAudioEngine
    private let mixer: AVAudioMixerNode

    /// Built-in General MIDI piano synth — used as fallback when no custom samples are loaded.
    private let gmSynth = AVAudioUnitSampler()

    // ADSR envelope
    var attack: Float = 0.01
    var decay: Float = 0.1
    var sustain: Float = 0.8
    var release: Float = 0.3

    // Filter
    var filterCutoff: Float = 20000
    var filterResonance: Float = 0

    init(engine: AVAudioEngine) {
        self.engine = engine
        self.mixer = AVAudioMixerNode()
        engine.attach(mixer)
        engine.attach(gmSynth)
        engine.connect(gmSynth, to: mixer, format: nil)
        loadGMSoundbank()
    }

    /// Load the macOS built-in DLS General MIDI soundbank into the GM synth.
    private func loadGMSoundbank() {
        let dlsPath = "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls"
        let dlsURL = URL(fileURLWithPath: dlsPath)
        do {
            try gmSynth.loadSoundBankInstrument(
                at: dlsURL,
                program: 0,   // Acoustic Grand Piano
                bankMSB: 0x79, // GM melodic bank
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
        engine.connect(mixer, to: destination, format: format)
    }

    // MARK: - Load Samples

    /// Load a sample mapped across a range of notes.
    func loadSample(url: URL, rootNote: UInt8, lowNote: UInt8, highNote: UInt8) throws {
        let buffer = try loadBuffer(from: url)
        for note in lowNote...highNote {
            sampleBuffers[note] = buffer
            sampleRootNotes[note] = rootNote
        }
    }

    /// Load a one-shot sample mapped to a single note.
    func loadOneshot(url: URL, rootNote: UInt8 = 60) throws {
        let buffer = try loadBuffer(from: url)
        sampleBuffers[rootNote] = buffer
        sampleRootNotes[rootNote] = rootNote
    }

    // MARK: - Playback

    func noteOn(note: UInt8, velocity: UInt8) {
        // Fall back to built-in GM synth when no custom samples are loaded for this note
        guard let buffer = sampleBuffers[note] else {
            ensureEngineRunning()
            gmSynth.startNote(note, withVelocity: velocity, onChannel: 0)
            return
        }
        let rootNote = sampleRootNotes[note] ?? note

        // Stop any existing player for this note (retrigger)
        noteOff(note: note)

        let player = AVAudioPlayerNode()
        engine.attach(player)

        // Calculate pitch shift in cents
        let semitoneDifference = Float(Int(note) - Int(rootNote))
        let pitchShiftCents = semitoneDifference * 100.0

        let timePitch = AVAudioUnitTimePitch()
        timePitch.pitch = pitchShiftCents
        timePitch.rate = 1.0
        engine.attach(timePitch)

        let format = buffer.format
        engine.connect(player, to: timePitch, format: format)
        engine.connect(timePitch, to: mixer, format: format)

        // Apply velocity scaling
        let velocityGain = Float(velocity) / 127.0
        player.volume = velocityGain

        activePlayers[note] = player
        pitchUnits[note] = timePitch

        player.scheduleBuffer(buffer, at: nil, options: [], completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                self?.cleanupPlayer(for: note)
            }
        }
        player.play()

        // Apply attack envelope via volume ramp
        if attack > 0.001 {
            player.volume = 0
            let steps = 20
            let stepDuration = TimeInterval(attack) / TimeInterval(steps)
            for i in 0...steps {
                let fraction = Float(i) / Float(steps)
                let vol = fraction * velocityGain
                DispatchQueue.main.asyncAfter(deadline: .now() + stepDuration * Double(i)) { [weak player] in
                    player?.volume = vol
                }
            }
        }
    }

    func noteOff(note: UInt8) {
        guard let player = activePlayers[note] else {
            gmSynth.stopNote(note, onChannel: 0)
            return
        }

        // Apply release envelope
        if release > 0.001 {
            let currentVolume = player.volume
            let steps = 20
            let stepDuration = TimeInterval(release) / TimeInterval(steps)
            for i in 0...steps {
                let fraction = 1.0 - (Float(i) / Float(steps))
                let vol = fraction * currentVolume
                DispatchQueue.main.asyncAfter(deadline: .now() + stepDuration * Double(i)) { [weak self, weak player] in
                    if i == steps {
                        self?.cleanupPlayer(for: note)
                    } else {
                        player?.volume = vol
                    }
                }
            }
        } else {
            cleanupPlayer(for: note)
        }
    }

    func allNotesOff() {
        let notes = Array(activePlayers.keys)
        for note in notes {
            cleanupPlayer(for: note)
        }
    }

    // MARK: - Private

    private func cleanupPlayer(for note: UInt8) {
        if let player = activePlayers.removeValue(forKey: note) {
            player.stop()
            engine.disconnectNodeOutput(player)
            engine.detach(player)
        }
        if let pitchUnit = pitchUnits.removeValue(forKey: note) {
            engine.disconnectNodeOutput(pitchUnit)
            engine.detach(pitchUnit)
        }
    }

    // MARK: - Waveform Data

    /// Downsample the audio buffer for a given root note to approximately `points` values.
    /// Returns an array of normalized floats (-1...1) suitable for waveform visualization.
    func waveformData(for rootNote: UInt8, points: Int = 500) -> [Float]? {
        guard let buffer = sampleBuffers[rootNote],
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
            // Find peak in this chunk (channel 0)
            for j in i..<end {
                let sample = channelData[0][j]
                if sample > maxVal { maxVal = sample }
                if sample < minVal { minVal = sample }
            }
            // Use the value with the larger absolute magnitude
            let val = abs(maxVal) > abs(minVal) ? maxVal : minVal
            result.append(val)
        }

        return result
    }

    /// Return info about all loaded sample zones: [(rootNote, mappedLow, mappedHigh)]
    func loadedZones() -> [(rootNote: UInt8, lowNote: UInt8, highNote: UInt8)] {
        // Group by root note to reconstruct zones
        var zones: [UInt8: (low: UInt8, high: UInt8)] = [:]
        for (mappedNote, rootNote) in sampleRootNotes {
            if let existing = zones[rootNote] {
                zones[rootNote] = (min(existing.low, mappedNote), max(existing.high, mappedNote))
            } else {
                zones[rootNote] = (mappedNote, mappedNote)
            }
        }
        return zones.map { (rootNote: $0.key, lowNote: $0.value.low, highNote: $0.value.high) }
            .sorted { $0.lowNote < $1.lowNote }
    }

    /// Whether any samples are loaded
    var hasSamples: Bool {
        !sampleBuffers.isEmpty
    }

    /// The GM synth is always available as a fallback
    var hasGMSynth: Bool { true }

    /// Ensure the AVAudioEngine is running (needed for GM synth playback).
    private func ensureEngineRunning() {
        guard !engine.isRunning else { return }
        do {
            engine.prepare()
            try engine.start()
            print("[Sampler] Started AVAudioEngine for GM synth")
        } catch {
            print("[Sampler] Failed to start engine: \(error)")
        }
    }

    // MARK: - Private

    private func loadBuffer(from url: URL) throws -> AVAudioPCMBuffer {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        let frameCount = AVAudioFrameCount(file.length)

        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
            throw SamplerError.bufferCreationFailed
        }

        try file.read(into: buffer)
        return buffer
    }
}

enum SamplerError: Error, LocalizedError {
    case bufferCreationFailed
    case fileLoadFailed(URL)

    var errorDescription: String? {
        switch self {
        case .bufferCreationFailed:
            return "Failed to create audio buffer"
        case .fileLoadFailed(let url):
            return "Failed to load audio file: \(url.lastPathComponent)"
        }
    }
}
