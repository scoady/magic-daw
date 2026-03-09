import AVFoundation
import Accelerate
import Observation

@Observable
class AudioEngine {
    @ObservationIgnored private(set) var avEngine = AVAudioEngine()
    private let mainMixer: AVAudioMixerNode
    private var isRunning = false
    private var transportTimer: DispatchSourceTimer?
    private var trackMixers: [UUID: AVAudioMixerNode] = [:]
    private var trackMeterTaps: Set<UUID> = []

    /// Per-track RMS levels, keyed by track ID. Updated via meter taps.
    var trackLevels: [UUID: (left: Float, right: Float)] = [:]

    /// Track IDs which are currently soloed. When non-empty, only soloed tracks produce audio.
    private var soloedTrackIDs: Set<UUID> = []

    /// Stores per-track intended volume so we can restore after unmute/unsolo.
    private var trackVolumes: [UUID: Float] = [:]

    /// Stores per-track mute state.
    private var trackMuteStates: [UUID: Bool] = [:]

    // State
    var bpm: Double = 120.0
    var isPlaying = false
    var isRecording = false
    var currentBeat: Double = 0.0
    var masterLevelL: Float = 0.0
    var masterLevelR: Float = 0.0

    init() {
        mainMixer = avEngine.mainMixerNode
    }

    // MARK: - Setup

    func setup() throws {
        let output = avEngine.outputNode
        let format = output.inputFormat(forBus: 0)

        // Ensure main mixer is connected to output with the correct format
        avEngine.connect(mainMixer, to: output, format: format)

        installMeterTap()

        avEngine.prepare()
        try avEngine.start()
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

    /// Install a meter tap on a per-track mixer node to capture RMS levels.
    private func installTrackMeterTap(for trackID: UUID, on mixer: AVAudioMixerNode) {
        guard !trackMeterTaps.contains(trackID) else { return }

        let format = mixer.outputFormat(forBus: 0)
        let channelCount = Int(format.channelCount)
        guard format.sampleRate > 0 else { return }

        mixer.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self else { return }

            let frameLength = Int(buffer.frameLength)
            guard frameLength > 0 else { return }

            var rmsL: Float = 0.0
            var rmsR: Float = 0.0

            if let channelData = buffer.floatChannelData {
                var sumSquared: Float = 0.0
                vDSP_measqv(channelData[0], 1, &sumSquared, vDSP_Length(frameLength))
                rmsL = sqrtf(sumSquared)

                if channelCount >= 2 {
                    var sumSquaredR: Float = 0.0
                    vDSP_measqv(channelData[1], 1, &sumSquaredR, vDSP_Length(frameLength))
                    rmsR = sqrtf(sumSquaredR)
                } else {
                    rmsR = rmsL
                }
            }

            DispatchQueue.main.async {
                self.trackLevels[trackID] = (left: rmsL, right: rmsR)
            }
        }
        trackMeterTaps.insert(trackID)
    }

    /// Remove a per-track meter tap.
    private func removeTrackMeterTap(for trackID: UUID, on mixer: AVAudioMixerNode) {
        guard trackMeterTaps.contains(trackID) else { return }
        mixer.removeTap(onBus: 0)
        trackMeterTaps.remove(trackID)
        trackLevels.removeValue(forKey: trackID)
    }

    // MARK: - Track Management

    func addTrack(_ track: AudioTrack) {
        let trackMixer = AVAudioMixerNode()
        avEngine.attach(trackMixer)

        let format = mainMixer.outputFormat(forBus: 0)
        avEngine.connect(trackMixer, to: mainMixer, format: format)

        // Store and apply initial mixer state
        trackVolumes[track.id] = track.volume
        trackMuteStates[track.id] = track.isMuted
        trackMixer.outputVolume = track.isMuted ? 0.0 : track.volume
        trackMixer.pan = track.pan

        trackMixers[track.id] = trackMixer
        installTrackMeterTap(for: track.id, on: trackMixer)

        if track.isSoloed {
            soloedTrackIDs.insert(track.id)
            applySoloState()
        }
    }

    func removeTrack(_ track: AudioTrack) {
        guard let trackMixer = trackMixers.removeValue(forKey: track.id) else { return }
        removeTrackMeterTap(for: track.id, on: trackMixer)
        avEngine.disconnectNodeOutput(trackMixer)
        avEngine.detach(trackMixer)
        soloedTrackIDs.remove(track.id)
        trackVolumes.removeValue(forKey: track.id)
        trackMuteStates.removeValue(forKey: track.id)
    }

    /// Returns the mixer node for a given track, used by Sampler/EffectsChain to connect.
    func mixerNode(for trackID: UUID) -> AVAudioMixerNode? {
        trackMixers[trackID]
    }

    // MARK: - Track Mixer Control

    /// Set the volume (linear 0-1) for a track's mixer node.
    func setTrackVolume(_ trackID: UUID, volume: Float) {
        trackVolumes[trackID] = volume
        applyEffectiveVolume(trackID)
    }

    /// Set the pan (-1 L to +1 R) for a track's mixer node.
    func setTrackPan(_ trackID: UUID, pan: Float) {
        guard let mixer = trackMixers[trackID] else { return }
        mixer.pan = max(-1.0, min(1.0, pan))
    }

    /// Mute or unmute a track.
    func setTrackMute(_ trackID: UUID, muted: Bool) {
        trackMuteStates[trackID] = muted
        applyEffectiveVolume(trackID)
    }

    /// Solo or unsolo a track.
    func setTrackSolo(_ trackID: UUID, soloed: Bool) {
        if soloed {
            soloedTrackIDs.insert(trackID)
        } else {
            soloedTrackIDs.remove(trackID)
        }
        applySoloState()
    }

    /// Compute and apply the effective output volume for a track,
    /// accounting for mute state, solo state, and intended volume.
    private func applyEffectiveVolume(_ trackID: UUID) {
        guard let mixer = trackMixers[trackID] else { return }
        let isMuted = trackMuteStates[trackID] ?? false
        let intendedVolume = trackVolumes[trackID] ?? 1.0

        if isMuted {
            mixer.outputVolume = 0.0
        } else if !soloedTrackIDs.isEmpty && !soloedTrackIDs.contains(trackID) {
            // Another track is soloed and this one is not
            mixer.outputVolume = 0.0
        } else {
            mixer.outputVolume = intendedVolume
        }
    }

    /// Recompute effective volume for all tracks based on solo selections.
    private func applySoloState() {
        for id in trackMixers.keys {
            applyEffectiveVolume(id)
        }
    }

    // MARK: - Cleanup

    func shutdown() {
        stopTransportTimer()
        mainMixer.removeTap(onBus: 0)

        if isRunning {
            avEngine.stop()
            isRunning = false
        }

        // Remove track meter taps and detach all track mixers
        for (id, mixer) in trackMixers {
            removeTrackMeterTap(for: id, on: mixer)
            avEngine.disconnectNodeOutput(mixer)
            avEngine.detach(mixer)
        }
        trackMixers.removeAll()
        soloedTrackIDs.removeAll()
        trackVolumes.removeAll()
        trackMuteStates.removeAll()
        trackLevels.removeAll()

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
