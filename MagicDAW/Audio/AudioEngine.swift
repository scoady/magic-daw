import AVFoundation
import Accelerate
import Observation

@Observable
class AudioEngine {
    private let engine = AVAudioEngine()
    private let mainMixer: AVAudioMixerNode
    private var isRunning = false
    private var transportTimer: DispatchSourceTimer?
    private var trackMixers: [UUID: AVAudioMixerNode] = [:]

    // State
    var bpm: Double = 120.0
    var isPlaying = false
    var isRecording = false
    var currentBeat: Double = 0.0
    var masterLevelL: Float = 0.0
    var masterLevelR: Float = 0.0

    init() {
        mainMixer = engine.mainMixerNode
    }

    // MARK: - Setup

    func setup() throws {
        let output = engine.outputNode
        let format = output.inputFormat(forBus: 0)

        // Ensure main mixer is connected to output with the correct format
        engine.connect(mainMixer, to: output, format: format)

        installMeterTap()

        engine.prepare()
        try engine.start()
        isRunning = true
    }

    // MARK: - Transport

    func play() {
        guard isRunning else { return }
        isPlaying = true
        startTransportTimer()
    }

    func stop() {
        isPlaying = false
        isRecording = false
        stopTransportTimer()
        currentBeat = 0.0
    }

    func record() {
        guard isRunning else { return }
        isRecording = true
        if !isPlaying {
            play()
        }
    }

    func setBPM(_ newBPM: Double) {
        bpm = max(20.0, min(999.0, newBPM))
    }

    func seekToBar(_ bar: Int) {
        // Assuming 4/4 time signature, 4 beats per bar, bars are 1-indexed
        currentBeat = Double(max(0, bar - 1)) * 4.0
    }

    // MARK: - Transport Timer

    private func startTransportTimer() {
        stopTransportTimer()

        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInteractive))
        // Update at ~240 Hz for smooth beat tracking
        let intervalNs = UInt64(1_000_000_000 / 240)
        timer.schedule(deadline: .now(), repeating: .nanoseconds(Int(intervalNs)))

        let beatsPerSecondRef = bpm / 60.0
        var lastTime = CACurrentMediaTime()

        timer.setEventHandler { [weak self] in
            guard let self, self.isPlaying else { return }

            let now = CACurrentMediaTime()
            let delta = now - lastTime
            lastTime = now

            let beatsPerSecond = self.bpm / 60.0
            let beatDelta = delta * beatsPerSecond

            DispatchQueue.main.async {
                self.currentBeat += beatDelta
            }
        }

        timer.resume()
        transportTimer = timer
    }

    private func stopTransportTimer() {
        transportTimer?.cancel()
        transportTimer = nil
    }

    // MARK: - Metering

    private func installMeterTap() {
        let format = mainMixer.outputFormat(forBus: 0)
        let channelCount = Int(format.channelCount)

        mainMixer.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self else { return }

            let frameLength = Int(buffer.frameLength)
            guard frameLength > 0 else { return }

            var rmsL: Float = 0.0
            var rmsR: Float = 0.0

            if let channelData = buffer.floatChannelData {
                // Left channel
                var sumSquared: Float = 0.0
                vDSP_measqv(channelData[0], 1, &sumSquared, vDSP_Length(frameLength))
                rmsL = sqrtf(sumSquared)

                // Right channel (if stereo)
                if channelCount >= 2 {
                    var sumSquaredR: Float = 0.0
                    vDSP_measqv(channelData[1], 1, &sumSquaredR, vDSP_Length(frameLength))
                    rmsR = sqrtf(sumSquaredR)
                } else {
                    rmsR = rmsL
                }
            }

            DispatchQueue.main.async {
                self.masterLevelL = rmsL
                self.masterLevelR = rmsR
            }
        }
    }

    // MARK: - Track Management

    func addTrack(_ track: AudioTrack) {
        let trackMixer = AVAudioMixerNode()
        engine.attach(trackMixer)

        let format = mainMixer.outputFormat(forBus: 0)
        engine.connect(trackMixer, to: mainMixer, format: format)

        trackMixers[track.id] = trackMixer
    }

    func removeTrack(_ track: AudioTrack) {
        guard let trackMixer = trackMixers.removeValue(forKey: track.id) else { return }
        engine.disconnectNodeOutput(trackMixer)
        engine.detach(trackMixer)
    }

    /// Returns the mixer node for a given track, used by Sampler/EffectsChain to connect.
    func mixerNode(for trackID: UUID) -> AVAudioMixerNode? {
        trackMixers[trackID]
    }

    // MARK: - Cleanup

    func shutdown() {
        stopTransportTimer()
        mainMixer.removeTap(onBus: 0)

        if isRunning {
            engine.stop()
            isRunning = false
        }

        // Detach all track mixers
        for (_, mixer) in trackMixers {
            engine.disconnectNodeOutput(mixer)
            engine.detach(mixer)
        }
        trackMixers.removeAll()

        isPlaying = false
        isRecording = false
    }
}

// MARK: - AudioTrack

/// Minimal track model used by the audio engine for mixer management.
struct AudioTrack: Identifiable {
    let id: UUID
    var name: String
    var volume: Float = 1.0
    var pan: Float = 0.0
    var isMuted: Bool = false
    var isSoloed: Bool = false
}
