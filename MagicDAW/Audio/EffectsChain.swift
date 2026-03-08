import AVFoundation

/// Per-track effects chain using AVAudioUnit nodes.
/// Manages a serial chain of audio effects connected within the AVAudioEngine graph.
class EffectsChain {
    private(set) var nodes: [AVAudioNode] = []
    private let engine: AVAudioEngine
    private var inputNode: AVAudioNode?
    private var outputMixer: AVAudioMixerNode?

    init(engine: AVAudioEngine) {
        self.engine = engine
    }

    // MARK: - Add Built-in Effects

    /// Add a parametric EQ with the specified number of bands.
    @discardableResult
    func addEQ(bandCount: Int = 3) -> AVAudioUnitEQ {
        let eq = AVAudioUnitEQ(numberOfBands: bandCount)

        // Set up reasonable default bands
        if bandCount >= 3 {
            let bands = eq.bands
            // Low shelf
            bands[0].filterType = .lowShelf
            bands[0].frequency = 80
            bands[0].gain = 0
            bands[0].bypass = false

            // Mid peak
            bands[1].filterType = .parametric
            bands[1].frequency = 1000
            bands[1].bandwidth = 1.0
            bands[1].gain = 0
            bands[1].bypass = false

            // High shelf
            bands[2].filterType = .highShelf
            bands[2].frequency = 8000
            bands[2].gain = 0
            bands[2].bypass = false
        }

        engine.attach(eq)
        nodes.append(eq)
        return eq
    }

    /// Add a dynamics processor (compressor/limiter).
    @discardableResult
    func addCompressor() -> AVAudioUnitEffect {
        let compressor = AVAudioUnitEffect(
            audioComponentDescription: AudioComponentDescription(
                componentType: kAudioUnitType_Effect,
                componentSubType: kAudioUnitSubType_DynamicsProcessor,
                componentManufacturer: kAudioUnitManufacturer_Apple,
                componentFlags: 0,
                componentFlagsMask: 0
            )
        )
        engine.attach(compressor)
        nodes.append(compressor)
        return compressor
    }

    /// Add a reverb effect.
    @discardableResult
    func addReverb(preset: AVAudioUnitReverbPreset = .mediumHall, wetDryMix: Float = 30) -> AVAudioUnitReverb {
        let reverb = AVAudioUnitReverb()
        reverb.loadFactoryPreset(preset)
        reverb.wetDryMix = wetDryMix
        engine.attach(reverb)
        nodes.append(reverb)
        return reverb
    }

    /// Add a delay effect.
    @discardableResult
    func addDelay(delayTime: TimeInterval = 0.25, feedback: Float = 50, wetDryMix: Float = 30) -> AVAudioUnitDelay {
        let delay = AVAudioUnitDelay()
        delay.delayTime = delayTime
        delay.feedback = feedback
        delay.wetDryMix = wetDryMix
        engine.attach(delay)
        nodes.append(delay)
        return delay
    }

    /// Add any arbitrary AVAudioNode to the chain.
    func addCustomEffect(_ node: AVAudioNode) {
        engine.attach(node)
        nodes.append(node)
    }

    // MARK: - Rebuild Chain

    /// Connect the effects chain: input -> effect1 -> effect2 -> ... -> output.
    /// Call this after adding/removing/reordering effects.
    func rebuild(from input: AVAudioNode, to output: AVAudioMixerNode) {
        inputNode = input
        outputMixer = output

        // Disconnect existing chain
        disconnectAll()

        let format = output.outputFormat(forBus: 0)

        if nodes.isEmpty {
            // Direct connection: input -> output
            engine.connect(input, to: output, format: format)
            return
        }

        // input -> first effect
        engine.connect(input, to: nodes[0], format: format)

        // Chain effects together
        for i in 0..<(nodes.count - 1) {
            engine.connect(nodes[i], to: nodes[i + 1], format: format)
        }

        // Last effect -> output
        engine.connect(nodes[nodes.count - 1], to: output, format: format)
    }

    // MARK: - Modify Chain

    /// Remove an effect at the given index and rebuild the chain.
    func removeEffect(at index: Int) {
        guard index >= 0 && index < nodes.count else { return }

        let node = nodes.remove(at: index)
        engine.disconnectNodeOutput(node)
        engine.disconnectNodeInput(node)
        engine.detach(node)

        if let input = inputNode, let output = outputMixer {
            rebuild(from: input, to: output)
        }
    }

    /// Move an effect from one position to another and rebuild the chain.
    func moveEffect(from source: Int, to destination: Int) {
        guard source >= 0 && source < nodes.count,
              destination >= 0 && destination < nodes.count,
              source != destination else { return }

        let node = nodes.remove(at: source)
        nodes.insert(node, at: destination)

        if let input = inputNode, let output = outputMixer {
            rebuild(from: input, to: output)
        }
    }

    /// Remove all effects and detach them from the engine.
    func removeAll() {
        disconnectAll()
        for node in nodes {
            engine.detach(node)
        }
        nodes.removeAll()

        // Reconnect input directly to output if available
        if let input = inputNode, let output = outputMixer {
            let format = output.outputFormat(forBus: 0)
            engine.connect(input, to: output, format: format)
        }
    }

    /// The number of effects currently in the chain.
    var count: Int { nodes.count }

    /// Get the effect node at a given index.
    func effect(at index: Int) -> AVAudioNode? {
        guard index >= 0 && index < nodes.count else { return nil }
        return nodes[index]
    }

    // MARK: - Private

    private func disconnectAll() {
        if let input = inputNode {
            engine.disconnectNodeOutput(input)
        }
        for node in nodes {
            engine.disconnectNodeOutput(node)
            engine.disconnectNodeInput(node)
        }
    }
}
