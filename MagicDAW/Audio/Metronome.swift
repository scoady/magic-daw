import AVFoundation
import Foundation

/// Generates a metronome click track synchronized to the transport.
/// Plays an accented click on beat 1 and softer clicks on beats 2-4.
class Metronome {
    private let engine: AVAudioEngine
    private let mixer: AVAudioMixerNode
    private var accentBuffer: AVAudioPCMBuffer?
    private var normalBuffer: AVAudioPCMBuffer?

    /// Whether the metronome is enabled.
    var isEnabled: Bool = false

    /// Volume of the metronome click (0.0 - 1.0).
    var volume: Float = 0.7

    /// Last beat that was clicked (to avoid double-triggering).
    private var lastClickedBeat: Int = -1

    /// Time signature numerator (beats per bar). Default 4.
    var beatsPerBar: Int = 4

    init(engine: AVAudioEngine) {
        self.engine = engine
        self.mixer = AVAudioMixerNode()
        engine.attach(mixer)

        generateClickBuffers()
    }

    /// Connect the metronome output to a destination mixer node.
    func connect(to destination: AVAudioMixerNode) {
        let format = destination.outputFormat(forBus: 0)
        engine.connect(mixer, to: destination, format: format)
    }

    /// Called by the transport timer to trigger clicks at the appropriate beats.
    /// - Parameter currentBeat: The current transport beat position.
    func process(currentBeat: Double) {
        guard isEnabled else { return }

        let beatNumber = Int(floor(currentBeat))
        guard beatNumber != lastClickedBeat else { return }
        lastClickedBeat = beatNumber

        // Determine if this is beat 1 of a bar (accented) or other beats
        let beatInBar = beatNumber % beatsPerBar
        let isAccent = (beatInBar == 0)

        playClick(accented: isAccent)
    }

    /// Reset the click tracker (call when transport rewinds or stops).
    func reset() {
        lastClickedBeat = -1
    }

    // MARK: - Private

    /// Generate short sine wave click buffers.
    private func generateClickBuffers() {
        let sampleRate: Double = 44100.0
        let clickDuration: Double = 0.020  // 20ms

        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else { return }

        let frameCount = AVAudioFrameCount(sampleRate * clickDuration)

        // Accent click: 1000 Hz sine burst
        if let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) {
            buffer.frameLength = frameCount
            if let data = buffer.floatChannelData {
                for i in 0..<Int(frameCount) {
                    let t = Double(i) / sampleRate
                    let sine = Float(sin(2.0 * .pi * 1000.0 * t))
                    // Apply envelope: quick attack, exponential decay
                    let envelope = Float(exp(-t * 200.0))
                    data[0][i] = sine * envelope
                }
            }
            accentBuffer = buffer
        }

        // Normal click: 800 Hz sine burst, quieter
        if let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) {
            buffer.frameLength = frameCount
            if let data = buffer.floatChannelData {
                for i in 0..<Int(frameCount) {
                    let t = Double(i) / sampleRate
                    let sine = Float(sin(2.0 * .pi * 800.0 * t))
                    let envelope = Float(exp(-t * 250.0)) * 0.6
                    data[0][i] = sine * envelope
                }
            }
            normalBuffer = buffer
        }
    }

    /// Play a click sound.
    private func playClick(accented: Bool) {
        guard let buffer = accented ? accentBuffer : normalBuffer else { return }

        let player = AVAudioPlayerNode()
        engine.attach(player)

        let format = buffer.format
        engine.connect(player, to: mixer, format: format)
        player.volume = volume * (accented ? 1.0 : 0.6)

        player.scheduleBuffer(buffer, at: nil, options: [], completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                player.stop()
                self?.engine.disconnectNodeOutput(player)
                self?.engine.detach(player)
            }
        }
        player.play()
    }
}
