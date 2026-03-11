import AVFoundation
import Accelerate
import CoreAudio
import Observation

/// Describes an available audio input device.
struct AudioInputDevice {
    let uid: String
    let name: String
    let channelCount: Int
}

@Observable
class AudioEngine {
    @ObservationIgnored private(set) var avEngine = AVAudioEngine()
    private let mainMixer: AVAudioMixerNode
    private var isRunning = false
    private var transportTimer: DispatchSourceTimer?
    private var trackMixers: [UUID: AVAudioMixerNode] = [:]
    private var trackMeterTaps: Set<UUID> = []

    /// Per-track effects chains, keyed by track ID.
    private var trackEffectsChains: [UUID: EffectsChain] = [:]

    /// Per-track send mixers: [trackID: [busTrackID: sendMixer]]
    /// Each send mixer splits the track signal to a bus track's mixer.
    private var trackSendMixers: [UUID: [UUID: AVAudioMixerNode]] = [:]

    /// Bus track IDs (tracks with type .bus)
    private var busTrackIDs: Set<UUID> = []

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

    // Loop region
    var loopEnabled: Bool = false
    var loopStartBeat: Double = 0.0
    var loopEndBeat: Double = 16.0  // default 4 bars

    // Count-in
    var countInEnabled: Bool = false
    private var isCountingIn: Bool = false
    private var countInStartBeat: Double = 0.0

    /// Callback invoked on each transport tick (~240 Hz) with the current beat.
    /// Used by MIDIPlayer and Metronome for high-resolution processing.
    var onTransportTick: ((Double) -> Void)?

    /// Callback invoked when recording actually starts (after count-in completes).
    var onRecordingStarted: (() -> Void)?

    /// Callback invoked when transport stops.
    var onTransportStopped: (() -> Void)?

    // MARK: - Recording State

    /// The beat position where recording started (for clip placement).
    private(set) var recordStartBeat: Double = 0.0
    /// The track ID currently being recorded into.
    private(set) var recordingTrackID: UUID?
    /// The active AVAudioFile being written to during recording.
    private var recordingFile: AVAudioFile?
    /// The file URL of the current recording in progress.
    private(set) var recordingFileURL: URL?
    /// Whether the input tap is currently installed for recording.
    private var inputTapInstalled = false
    /// Input level for metering while recording/monitoring.
    var inputLevelL: Float = 0.0
    var inputLevelR: Float = 0.0

    // MARK: - Monitoring

    /// Whether input monitoring is active (routes input to output for armed tracks).
    private var isMonitoring = false
    /// Mixer node used to route input to output for monitoring.
    private var monitorMixer: AVAudioMixerNode?

    // MARK: - Audio Playback

    /// Pool of player nodes for clip playback, keyed by clip ID.
    private var playerNodes: [UUID: AVAudioPlayerNode] = [:]
    /// Audio files loaded for playback, keyed by file path.
    private var loadedAudioFiles: [String: AVAudioFile] = [:]

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

    // MARK: - Input Device Enumeration

    /// List available audio input devices on the system.
    func availableInputDevices() -> [AudioInputDevice] {
        var devices: [AudioInputDevice] = []

        #if os(macOS)
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        var dataSize: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress, 0, nil, &dataSize
        ) == noErr else { return devices }

        let deviceCount = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
        var deviceIDs = [AudioDeviceID](repeating: 0, count: deviceCount)
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress, 0, nil, &dataSize, &deviceIDs
        ) == noErr else { return devices }

        for deviceID in deviceIDs {
            // Check if device has input channels
            var inputAddress = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyStreamConfiguration,
                mScope: kAudioDevicePropertyScopeInput,
                mElement: kAudioObjectPropertyElementMain
            )

            var inputSize: UInt32 = 0
            guard AudioObjectGetPropertyDataSize(deviceID, &inputAddress, 0, nil, &inputSize) == noErr else { continue }

            let bufferListData = UnsafeMutablePointer<UInt8>.allocate(capacity: Int(inputSize))
            defer { bufferListData.deallocate() }

            guard AudioObjectGetPropertyData(deviceID, &inputAddress, 0, nil, &inputSize, bufferListData) == noErr else { continue }

            let bufferList = bufferListData.withMemoryRebound(to: AudioBufferList.self, capacity: 1) { $0.pointee }
            let channelCount = Int(bufferList.mBuffers.mNumberChannels)
            guard channelCount > 0 else { continue }

            // Get device name
            var nameAddress = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyDeviceNameCFString,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            var nameSize = UInt32(MemoryLayout<CFString>.size)
            var deviceName: CFString = "" as CFString
            guard AudioObjectGetPropertyData(deviceID, &nameAddress, 0, nil, &nameSize, &deviceName) == noErr else { continue }

            // Get device UID
            var uidAddress = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyDeviceUID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            var uidSize = UInt32(MemoryLayout<CFString>.size)
            var deviceUID: CFString = "" as CFString
            guard AudioObjectGetPropertyData(deviceID, &uidAddress, 0, nil, &uidSize, &deviceUID) == noErr else { continue }

            devices.append(AudioInputDevice(
                uid: deviceUID as String,
                name: deviceName as String,
                channelCount: channelCount
            ))
        }
        #endif

        return devices
    }

    // MARK: - Transport

    func play() {
        guard isRunning else { return }
        isPlaying = true
        isCountingIn = false
        startTransportTimer()
    }

    func stop() {
        let wasRecording = isRecording
        isPlaying = false
        isRecording = false
        isCountingIn = false
        stopTransportTimer()

        if wasRecording {
            stopRecordingInput()
        }

        // Stop all player nodes
        stopAllPlayers()

        onTransportStopped?()
        currentBeat = 0.0
    }

    func record() {
        guard isRunning else { return }

        if countInEnabled && !isPlaying {
            // Start count-in: play 1 bar of metronome before actual recording
            isPlaying = true
            isCountingIn = true
            countInStartBeat = currentBeat
            startTransportTimer()
        } else {
            isRecording = true
            onRecordingStarted?()
            if !isPlaying {
                play()
            }
        }
    }

    // MARK: - Loop Control

    func setLoopRegion(startBeat: Double, endBeat: Double) {
        loopStartBeat = max(0.0, startBeat)
        loopEndBeat = max(loopStartBeat + 1.0, endBeat)
    }

    func setLoopEnabled(_ enabled: Bool) {
        loopEnabled = enabled
    }

    // MARK: - Recording

    /// Start recording audio from the input node to a file.
    /// - Parameters:
    ///   - trackID: The track to record into.
    ///   - outputURL: The file URL to write the recording to (WAV format).
    ///   - startBeat: The beat position where recording starts (for clip placement).
    func startRecordingInput(trackID: UUID, outputURL: URL, startBeat: Double) {
        guard isRunning else { return }

        // Stop any existing recording
        if inputTapInstalled {
            stopRecordingInput()
        }

        recordingTrackID = trackID
        recordStartBeat = startBeat
        recordingFileURL = outputURL

        let inputNode = avEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)

        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
            print("[AudioEngine] Invalid input format: \(inputFormat)")
            return
        }

        // Create the output file in WAV format
        do {
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: inputFormat.sampleRate,
                AVNumberOfChannelsKey: inputFormat.channelCount,
                AVLinearPCMBitDepthKey: 24,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
            ]
            recordingFile = try AVAudioFile(
                forWriting: outputURL,
                settings: settings,
                commonFormat: inputFormat.commonFormat,
                interleaved: inputFormat.isInterleaved
            )
        } catch {
            print("[AudioEngine] Failed to create recording file: \(error)")
            return
        }

        // Install tap on input node
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            guard let self, self.isRecording, let file = self.recordingFile else { return }

            // Write buffer to file
            do {
                try file.write(from: buffer)
            } catch {
                print("[AudioEngine] Failed to write recording buffer: \(error)")
            }

            // Update input levels for metering
            let frameLength = Int(buffer.frameLength)
            guard frameLength > 0 else { return }

            var rmsL: Float = 0.0
            var rmsR: Float = 0.0
            if let channelData = buffer.floatChannelData {
                var sumSquared: Float = 0.0
                vDSP_measqv(channelData[0], 1, &sumSquared, vDSP_Length(frameLength))
                rmsL = sqrtf(sumSquared)

                if Int(buffer.format.channelCount) >= 2 {
                    var sumSquaredR: Float = 0.0
                    vDSP_measqv(channelData[1], 1, &sumSquaredR, vDSP_Length(frameLength))
                    rmsR = sqrtf(sumSquaredR)
                } else {
                    rmsR = rmsL
                }
            }

            DispatchQueue.main.async {
                self.inputLevelL = rmsL
                self.inputLevelR = rmsR
            }
        }
        inputTapInstalled = true

        // Start recording transport
        isRecording = true
        if !isPlaying {
            play()
        }

        print("[AudioEngine] Recording started -> \(outputURL.lastPathComponent) at beat \(startBeat)")
    }

    /// Stop recording and finalize the audio file.
    /// Returns the URL of the recorded file and the duration in seconds, or nil if not recording.
    @discardableResult
    func stopRecordingInput() -> (url: URL, durationSeconds: Double)? {
        guard inputTapInstalled else { return nil }

        let inputNode = avEngine.inputNode
        inputNode.removeTap(onBus: 0)
        inputTapInstalled = false

        let url = recordingFileURL
        let file = recordingFile

        // Calculate duration
        var durationSeconds: Double = 0.0
        if let file = file {
            durationSeconds = Double(file.length) / file.processingFormat.sampleRate
        }

        recordingFile = nil
        isRecording = false

        DispatchQueue.main.async {
            self.inputLevelL = 0.0
            self.inputLevelR = 0.0
        }

        recordingTrackID = nil

        if let url = url {
            print("[AudioEngine] Recording stopped. Duration: \(String(format: "%.2f", durationSeconds))s -> \(url.lastPathComponent)")
            return (url: url, durationSeconds: durationSeconds)
        }
        return nil
    }

    // MARK: - Input Monitoring

    /// Enable or disable input monitoring (routes input to output).
    /// WARNING: Only use with headphones to avoid feedback loops.
    func setInputMonitoring(_ enabled: Bool) {
        guard isRunning else { return }

        if enabled && !isMonitoring {
            let inputNode = avEngine.inputNode
            let inputFormat = inputNode.outputFormat(forBus: 0)
            guard inputFormat.sampleRate > 0 else { return }

            let mixer = AVAudioMixerNode()
            avEngine.attach(mixer)
            avEngine.connect(inputNode, to: mixer, format: inputFormat)

            let outputFormat = mainMixer.outputFormat(forBus: 0)
            avEngine.connect(mixer, to: mainMixer, format: outputFormat)

            monitorMixer = mixer
            isMonitoring = true
            print("[AudioEngine] Input monitoring enabled")
        } else if !enabled && isMonitoring {
            if let mixer = monitorMixer {
                avEngine.disconnectNodeOutput(mixer)
                avEngine.detach(mixer)
            }
            monitorMixer = nil
            isMonitoring = false
            print("[AudioEngine] Input monitoring disabled")
        }
    }

    // MARK: - Waveform Generation

    /// Generate a downsampled waveform from an audio file.
    /// Returns an array of peak amplitude values normalized to 0-1.
    static func generateWaveform(from url: URL, points: Int = 500) -> [Float]? {
        guard let file = try? AVAudioFile(forReading: url) else { return nil }

        let frameCount = AVAudioFrameCount(file.length)
        guard frameCount > 0, let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: file.processingFormat.sampleRate,
            channels: file.processingFormat.channelCount,
            interleaved: false
        ) else { return nil }

        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return nil }

        do {
            try file.read(into: buffer)
        } catch {
            print("[AudioEngine] Failed to read audio file for waveform: \(error)")
            return nil
        }

        guard let channelData = buffer.floatChannelData else { return nil }
        let totalFrames = Int(buffer.frameLength)
        let framesPerPoint = max(1, totalFrames / points)

        var waveform: [Float] = []
        waveform.reserveCapacity(points)

        for i in 0..<points {
            let start = i * framesPerPoint
            let end = min(start + framesPerPoint, totalFrames)
            let count = end - start
            guard count > 0 else {
                waveform.append(0.0)
                continue
            }

            // Find peak absolute value in this chunk
            var peak: Float = 0.0
            var absValues = [Float](repeating: 0, count: count)
            vDSP_vabs(channelData[0].advanced(by: start), 1, &absValues, 1, vDSP_Length(count))
            vDSP_maxv(absValues, 1, &peak, vDSP_Length(count))

            waveform.append(min(1.0, peak))
        }

        return waveform
    }

    // MARK: - Audio Clip Playback

    /// Schedule an audio clip for playback at a specific beat position.
    func scheduleClip(
        clipID: UUID,
        fileURL: URL,
        trackID: UUID,
        startBeat: Double,
        offsetSeconds: Double = 0.0,
        gainDB: Float = 0.0
    ) {
        guard isRunning else { return }
        guard let trackMixer = trackMixers[trackID] else {
            print("[AudioEngine] No mixer for track \(trackID)")
            return
        }

        // Load audio file (cache it)
        let filePath = fileURL.path
        let audioFile: AVAudioFile
        if let cached = loadedAudioFiles[filePath] {
            audioFile = cached
        } else {
            guard let file = try? AVAudioFile(forReading: fileURL) else {
                print("[AudioEngine] Failed to load audio file: \(fileURL.lastPathComponent)")
                return
            }
            loadedAudioFiles[filePath] = file
            audioFile = file
        }

        // Remove existing player for this clip if any
        if let existing = playerNodes.removeValue(forKey: clipID) {
            existing.stop()
            avEngine.disconnectNodeOutput(existing)
            avEngine.detach(existing)
        }

        // Create and attach player node
        let playerNode = AVAudioPlayerNode()
        avEngine.attach(playerNode)

        let format = audioFile.processingFormat
        avEngine.connect(playerNode, to: trackMixer, format: format)

        playerNodes[clipID] = playerNode

        // Calculate frame offset
        let offsetFrames = AVAudioFramePosition(offsetSeconds * format.sampleRate)
        let totalFrames = audioFile.length
        let framesToPlay = AVAudioFrameCount(max(0, totalFrames - offsetFrames))

        guard framesToPlay > 0 else { return }

        // Read the segment into a buffer
        audioFile.framePosition = offsetFrames
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: framesToPlay) else { return }
        do {
            try audioFile.read(into: buffer, frameCount: framesToPlay)
        } catch {
            print("[AudioEngine] Failed to read clip audio: \(error)")
            return
        }

        // Apply clip gain
        if gainDB != 0.0 {
            let gain = powf(10.0, gainDB / 20.0)
            if let channelData = buffer.floatChannelData {
                for ch in 0..<Int(format.channelCount) {
                    var g = gain
                    vDSP_vsmul(channelData[ch], 1, &g, channelData[ch], 1, vDSP_Length(buffer.frameLength))
                }
            }
        }

        // Calculate when to start playing based on beat position
        let beatsUntilClip = startBeat - currentBeat
        if beatsUntilClip > 0 {
            let beatsPerSecond = bpm / 60.0
            let delaySeconds = beatsUntilClip / beatsPerSecond
            let sampleRate = avEngine.outputNode.outputFormat(forBus: 0).sampleRate
            let delaySamples = AVAudioFramePosition(delaySeconds * sampleRate)

            let startTime = AVAudioTime(sampleTime: delaySamples, atRate: sampleRate)
            playerNode.scheduleBuffer(buffer, at: startTime, options: [], completionHandler: nil)
        } else {
            // Play immediately (or skip into the clip if we're past the start)
            let beatsPerSecond = bpm / 60.0
            let secondsInto = -beatsUntilClip / beatsPerSecond
            let framesInto = AVAudioFramePosition(secondsInto * format.sampleRate)

            if framesInto < Int64(buffer.frameLength) {
                let remainingFrames = AVAudioFrameCount(Int64(buffer.frameLength) - framesInto)
                if let subBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: remainingFrames) {
                    subBuffer.frameLength = remainingFrames
                    if let srcData = buffer.floatChannelData, let dstData = subBuffer.floatChannelData {
                        for ch in 0..<Int(format.channelCount) {
                            memcpy(dstData[ch], srcData[ch].advanced(by: Int(framesInto)), Int(remainingFrames) * MemoryLayout<Float>.size)
                        }
                    }
                    playerNode.scheduleBuffer(subBuffer, at: nil, options: [], completionHandler: nil)
                }
            }
        }

        playerNode.play()
    }

    /// Stop and remove a specific clip's player node.
    func stopClip(_ clipID: UUID) {
        guard let player = playerNodes.removeValue(forKey: clipID) else { return }
        player.stop()
        avEngine.disconnectNodeOutput(player)
        avEngine.detach(player)
    }

    /// Stop all currently playing clip player nodes.
    func stopAllPlayers() {
        for (_, player) in playerNodes {
            player.stop()
            avEngine.disconnectNodeOutput(player)
            avEngine.detach(player)
        }
        playerNodes.removeAll()
    }

    /// Reschedule all clips when seeking to a new position.
    /// The caller should stop all players and re-schedule clips based on the new currentBeat.
    func repositionPlayers() {
        stopAllPlayers()
    }

    func setBPM(_ newBPM: Double) {
        bpm = max(20.0, min(999.0, newBPM))
    }

    func seekToBar(_ bar: Int) {
        // Assuming 4/4 time signature, 4 beats per bar, bars are 1-indexed
        currentBeat = Double(max(0, bar - 1)) * 4.0
        repositionPlayers()
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

            var newBeat = self.currentBeat + beatDelta

            // Handle count-in completion
            if self.isCountingIn {
                let countInBeats = 4.0  // 1 bar count-in (4/4)
                if newBeat - self.countInStartBeat >= countInBeats {
                    self.isCountingIn = false
                    self.isRecording = true
                    DispatchQueue.main.async {
                        self.onRecordingStarted?()
                    }
                }
            }

            // Handle loop wrapping
            if self.loopEnabled && !self.isCountingIn && newBeat >= self.loopEndBeat {
                newBeat = self.loopStartBeat + (newBeat - self.loopEndBeat).truncatingRemainder(dividingBy: max(1.0, self.loopEndBeat - self.loopStartBeat))
            }

            // Invoke the transport tick callback on the high-priority queue
            self.onTransportTick?(newBeat)

            DispatchQueue.main.async {
                self.currentBeat = newBeat
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

        // Create an effects chain for this track
        let chain = EffectsChain(engine: avEngine)
        trackEffectsChains[track.id] = chain

        // Initialize empty send mixer map
        trackSendMixers[track.id] = [:]

        if track.isSoloed {
            soloedTrackIDs.insert(track.id)
            applySoloState()
        }
    }

    /// Add a bus track. Bus tracks receive signal from sends rather than having their own input.
    func addBusTrack(_ track: AudioTrack) {
        busTrackIDs.insert(track.id)
        addTrack(track)
    }

    func removeTrack(_ track: AudioTrack) {
        // Remove all sends to/from this track
        removeSendsForTrack(track.id)

        // Remove effects chain
        if let chain = trackEffectsChains.removeValue(forKey: track.id) {
            chain.removeAll()
        }

        guard let trackMixer = trackMixers.removeValue(forKey: track.id) else { return }
        removeTrackMeterTap(for: track.id, on: trackMixer)
        avEngine.disconnectNodeOutput(trackMixer)
        avEngine.detach(trackMixer)
        soloedTrackIDs.remove(track.id)
        trackVolumes.removeValue(forKey: track.id)
        trackMuteStates.removeValue(forKey: track.id)
        busTrackIDs.remove(track.id)
        trackSendMixers.removeValue(forKey: track.id)
    }

    /// Returns the mixer node for a given track, used by Sampler/EffectsChain to connect.
    func mixerNode(for trackID: UUID) -> AVAudioMixerNode? {
        trackMixers[trackID]
    }

    /// Returns the effects chain for a given track.
    func effectsChain(for trackID: UUID) -> EffectsChain? {
        trackEffectsChains[trackID]
    }

    // MARK: - Effects Chain Management

    /// Add an effect to a track's chain and rebuild the audio graph.
    @discardableResult
    func addEffect(to trackID: UUID, type: EffectType) -> AVAudioNode? {
        guard let chain = trackEffectsChains[trackID],
              let mixer = trackMixers[trackID] else { return nil }

        let node = chain.addEffect(ofType: type)
        chain.rebuild(from: mixer, to: mixer)
        return node
    }

    /// Remove an effect at the given index from a track's chain.
    func removeEffect(from trackID: UUID, at index: Int) {
        guard let chain = trackEffectsChains[trackID] else { return }
        chain.removeEffect(at: index)
    }

    /// Set a parameter on an effect in a track's chain.
    func setEffectParameter(trackID: UUID, effectIndex: Int, paramName: String, value: Double) {
        guard let chain = trackEffectsChains[trackID] else { return }
        chain.setParameter(at: effectIndex, name: paramName, value: value)
    }

    /// Reorder effects in a track's chain.
    func reorderEffects(trackID: UUID, from source: Int, to destination: Int) {
        guard let chain = trackEffectsChains[trackID],
              let mixer = trackMixers[trackID] else { return }
        chain.moveEffect(from: source, to: destination)
        chain.rebuild(from: mixer, to: mixer)
    }

    /// Toggle bypass on a single effect in a track's chain.
    func bypassEffect(trackID: UUID, effectIndex: Int, bypassed: Bool) {
        guard let chain = trackEffectsChains[trackID] else { return }
        chain.setBypass(at: effectIndex, bypassed: bypassed)
    }

    /// Get the serialized effects chain state for a track.
    func effectsChainState(for trackID: UUID) -> [[String: Any]] {
        guard let chain = trackEffectsChains[trackID] else { return [] }
        return chain.serialize()
    }

    // MARK: - Send Routing

    /// Set the send level from a source track to a bus track.
    func setSendLevel(from sourceTrackID: UUID, to busTrackID: UUID, level: Float) {
        guard let sourceMixer = trackMixers[sourceTrackID],
              let busMixer = trackMixers[busTrackID],
              busTrackIDs.contains(busTrackID) else {
            print("[AudioEngine] Cannot set send: source or bus track not found")
            return
        }

        let format = mainMixer.outputFormat(forBus: 0)

        if let existingSend = trackSendMixers[sourceTrackID]?[busTrackID] {
            existingSend.outputVolume = level
            return
        }

        let sendMixer = AVAudioMixerNode()
        avEngine.attach(sendMixer)
        sendMixer.outputVolume = level

        avEngine.connect(sourceMixer, to: sendMixer, format: format)
        avEngine.connect(sendMixer, to: busMixer, format: format)

        if trackSendMixers[sourceTrackID] == nil {
            trackSendMixers[sourceTrackID] = [:]
        }
        trackSendMixers[sourceTrackID]?[busTrackID] = sendMixer
    }

    /// Remove a send from a source track to a bus track.
    func removeSend(from sourceTrackID: UUID, to busTrackID: UUID) {
        guard let sendMixer = trackSendMixers[sourceTrackID]?[busTrackID] else { return }
        avEngine.disconnectNodeOutput(sendMixer)
        avEngine.disconnectNodeInput(sendMixer)
        avEngine.detach(sendMixer)
        trackSendMixers[sourceTrackID]?.removeValue(forKey: busTrackID)
    }

    /// Remove all sends to/from a track (used when removing a track).
    private func removeSendsForTrack(_ trackID: UUID) {
        if let sends = trackSendMixers.removeValue(forKey: trackID) {
            for (_, sendMixer) in sends {
                avEngine.disconnectNodeOutput(sendMixer)
                avEngine.disconnectNodeInput(sendMixer)
                avEngine.detach(sendMixer)
            }
        }
        for (sourceID, var sends) in trackSendMixers {
            if let sendMixer = sends.removeValue(forKey: trackID) {
                avEngine.disconnectNodeOutput(sendMixer)
                avEngine.disconnectNodeInput(sendMixer)
                avEngine.detach(sendMixer)
            }
            trackSendMixers[sourceID] = sends
        }
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

        // Stop recording if active
        if inputTapInstalled {
            stopRecordingInput()
        }

        // Disable monitoring
        setInputMonitoring(false)

        // Stop all playback
        stopAllPlayers()

        if isRunning {
            avEngine.stop()
            isRunning = false
        }

        // Remove all effects chains
        for (_, chain) in trackEffectsChains {
            chain.removeAll()
        }
        trackEffectsChains.removeAll()

        // Remove all send mixers
        for (_, sends) in trackSendMixers {
            for (_, sendMixer) in sends {
                avEngine.disconnectNodeOutput(sendMixer)
                avEngine.disconnectNodeInput(sendMixer)
                avEngine.detach(sendMixer)
            }
        }
        trackSendMixers.removeAll()
        busTrackIDs.removeAll()

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
        loadedAudioFiles.removeAll()

        isPlaying = false
        isRecording = false
    }

    // MARK: - Export / Bounce

    /// Export state for progress tracking.
    private(set) var isExporting = false
    private var exportFile: AVAudioFile?
    private var exportMixerNode: AVAudioMixerNode?

    /// Start capturing the master output to a WAV file.
    /// Call this before starting playback. Call `stopExportCapture()` after playback ends.
    func startExportCapture(outputURL: URL) throws {
        guard isRunning else {
            throw NSError(domain: "AudioEngine", code: 1, userInfo: [NSLocalizedDescriptionKey: "Engine not running"])
        }

        let format = mainMixer.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "AudioEngine", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid mixer format"])
        }

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: format.channelCount,
            AVLinearPCMBitDepthKey: 24,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ]

        exportFile = try AVAudioFile(
            forWriting: outputURL,
            settings: settings,
            commonFormat: format.commonFormat,
            interleaved: format.isInterleaved
        )

        // Insert an export mixer between mainMixer and outputNode to tap without
        // conflicting with the existing meter tap on mainMixer bus 0.
        let exportMixer = AVAudioMixerNode()
        avEngine.attach(exportMixer)

        let outputNode = avEngine.outputNode
        // Disconnect mainMixer → output, insert export mixer in between
        avEngine.disconnectNodeOutput(mainMixer)
        avEngine.connect(mainMixer, to: exportMixer, format: format)
        avEngine.connect(exportMixer, to: outputNode, format: format)

        exportMixer.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            guard let self, self.isExporting, let file = self.exportFile else { return }
            do {
                try file.write(from: buffer)
            } catch {
                print("[AudioEngine] Export write error: \(error)")
            }
        }

        exportMixerNode = exportMixer
        isExporting = true
        print("[AudioEngine] Export capture started → \(outputURL.lastPathComponent)")
    }

    /// Stop export capture, remove the tap, and restore the audio graph.
    func stopExportCapture() {
        isExporting = false

        if let exportMixer = exportMixerNode {
            exportMixer.removeTap(onBus: 0)
            let format = mainMixer.outputFormat(forBus: 0)
            let outputNode = avEngine.outputNode

            // Restore direct mainMixer → output connection
            avEngine.disconnectNodeOutput(exportMixer)
            avEngine.disconnectNodeOutput(mainMixer)
            avEngine.detach(exportMixer)
            avEngine.connect(mainMixer, to: outputNode, format: format)
        }

        exportMixerNode = nil
        exportFile = nil
        print("[AudioEngine] Export capture stopped")
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
    var isBus: Bool = false
}
