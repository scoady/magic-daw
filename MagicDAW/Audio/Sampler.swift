import AVFoundation
import Accelerate

class Sampler {
    private var sampleBuffers: [UInt8: AVAudioPCMBuffer] = [:]  // MIDI note -> buffer
    private var sampleRootNotes: [UInt8: UInt8] = [:]            // mapped note -> root note
    private var activePlayers: [UInt8: AVAudioPlayerNode] = [:]
    private var pitchUnits: [UInt8: AVAudioUnitTimePitch] = [:]
    private let engine: AVAudioEngine
    private let mixer: AVAudioMixerNode

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
        guard let buffer = sampleBuffers[note] else { return }
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
        guard let player = activePlayers[note] else { return }

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
