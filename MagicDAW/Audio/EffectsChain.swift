import AVFoundation

/// Per-track effects chain using AVAudioUnit nodes.
/// Manages a serial chain of audio effects connected within the AVAudioEngine graph.
class EffectsChain {
    private(set) var nodes: [AVAudioNode] = []
    /// Tracks which effect type each node corresponds to (parallel array to `nodes`).
    private(set) var effectTypes: [EffectType] = []
    /// Per-node bypass state. Bypassed nodes are kept in the chain but signal passes through unchanged.
    private(set) var bypassStates: [Bool] = []
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
        effectTypes.append(.eq)
        bypassStates.append(false)
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
        effectTypes.append(.compressor)
        bypassStates.append(false)
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
        effectTypes.append(.reverb)
        bypassStates.append(false)
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
        effectTypes.append(.delay)
        bypassStates.append(false)
        return delay
    }

    /// Add a chorus effect using AVAudioUnitDistortion with a multi-voice chorus preset.
    @discardableResult
    func addChorus(rate: Float = 1.5, depth: Float = 0.5, wetDry: Float = 50) -> AVAudioUnitDistortion {
        let chorus = AVAudioUnitDistortion()
        chorus.loadFactoryPreset(.multiEcho1)
        chorus.wetDryMix = wetDry
        engine.attach(chorus)
        nodes.append(chorus)
        effectTypes.append(.chorus)
        bypassStates.append(false)
        return chorus
    }

    /// Add a distortion effect.
    @discardableResult
    func addDistortion(drive: Float = 0.5, wetDry: Float = 50, preset: AVAudioUnitDistortionPreset = .drumsBitBrush) -> AVAudioUnitDistortion {
        let distortion = AVAudioUnitDistortion()
        distortion.loadFactoryPreset(preset)
        distortion.wetDryMix = wetDry
        engine.attach(distortion)
        nodes.append(distortion)
        effectTypes.append(.distortion)
        bypassStates.append(false)
        return distortion
    }

    /// Add an effect by its EffectType enum, returning the created AVAudioNode.
    @discardableResult
    func addEffect(ofType type: EffectType) -> AVAudioNode {
        switch type {
        case .eq:         return addEQ()
        case .compressor: return addCompressor()
        case .reverb:     return addReverb()
        case .delay:      return addDelay()
        case .chorus:     return addChorus()
        case .distortion: return addDistortion()
        default:
            // Unsupported types fall back to a pass-through EQ
            return addEQ(bandCount: 1)
        }
    }

    /// Add any arbitrary AVAudioNode to the chain.
    func addCustomEffect(_ node: AVAudioNode) {
        engine.attach(node)
        nodes.append(node)
        effectTypes.append(.eq) // default metadata
        bypassStates.append(false)
    }

    // MARK: - Bypass

    /// Toggle bypass on a single effect at the given index.
    func setBypass(at index: Int, bypassed: Bool) {
        guard index >= 0 && index < nodes.count else { return }
        bypassStates[index] = bypassed

        let node = nodes[index]
        if let unit = node as? AVAudioUnit {
            unit.auAudioUnit.shouldBypassEffect = bypassed
        }
    }

    // MARK: - Parameter Application

    /// Set a parameter on the effect node at the given index.
    func setParameter(at index: Int, name: String, value: Double) {
        guard index >= 0 && index < nodes.count else { return }
        let node = nodes[index]
        let type = effectTypes[index]

        switch type {
        case .eq:
            if let eq = node as? AVAudioUnitEQ {
                applyEQParameter(eq, name: name, value: value)
            }
        case .compressor:
            if let comp = node as? AVAudioUnitEffect {
                applyCompressorParameter(comp, name: name, value: value)
            }
        case .reverb:
            if let reverb = node as? AVAudioUnitReverb {
                applyReverbParameter(reverb, name: name, value: value)
            }
        case .delay:
            if let delay = node as? AVAudioUnitDelay {
                applyDelayParameter(delay, name: name, value: value)
            }
        case .chorus:
            if let chorus = node as? AVAudioUnitDistortion {
                applyChorusParameter(chorus, name: name, value: value)
            }
        case .distortion:
            if let dist = node as? AVAudioUnitDistortion {
                applyDistortionParameter(dist, name: name, value: value)
            }
        default:
            break
        }
    }

    // MARK: - EQ Parameters

    private func applyEQParameter(_ eq: AVAudioUnitEQ, name: String, value: Double) {
        let bands = eq.bands
        switch name {
        case "lowFreq":  if bands.count > 0 { bands[0].frequency = Float(value) }
        case "lowGain":  if bands.count > 0 { bands[0].gain = Float(value) }
        case "lowQ":     if bands.count > 0 { bands[0].bandwidth = Float(value) }
        case "midFreq":  if bands.count > 1 { bands[1].frequency = Float(value) }
        case "midGain":  if bands.count > 1 { bands[1].gain = Float(value) }
        case "midQ":     if bands.count > 1 { bands[1].bandwidth = Float(value) }
        case "highFreq": if bands.count > 2 { bands[2].frequency = Float(value) }
        case "highGain": if bands.count > 2 { bands[2].gain = Float(value) }
        case "highQ":    if bands.count > 2 { bands[2].bandwidth = Float(value) }
        default: break
        }
    }

    // MARK: - Compressor Parameters

    private func applyCompressorParameter(_ comp: AVAudioUnitEffect, name: String, value: Double) {
        let au = comp.auAudioUnit
        guard let paramTree = au.parameterTree else { return }

        // DynamicsProcessor AudioUnit parameter IDs
        let paramID: AUParameterAddress
        switch name {
        case "threshold":  paramID = 0  // kDynamicsProcessorParam_Threshold
        case "ratio":      paramID = 6  // kDynamicsProcessorParam_CompressionAmount (expansion ratio)
        case "attack":     paramID = 2  // kDynamicsProcessorParam_AttackTime
        case "release":    paramID = 3  // kDynamicsProcessorParam_ReleaseTime
        case "makeupGain": paramID = 5  // kDynamicsProcessorParam_MasterGain
        default: return
        }

        if let param = paramTree.parameter(withAddress: paramID) {
            param.value = Float(value)
        }
    }

    // MARK: - Reverb Parameters

    private func applyReverbParameter(_ reverb: AVAudioUnitReverb, name: String, value: Double) {
        switch name {
        case "wetDry", "wetDryMix":
            reverb.wetDryMix = Float(value)
        case "roomSize":
            // Map numeric roomSize to factory presets
            let preset: AVAudioUnitReverbPreset
            switch Int(value) {
            case 0: preset = .smallRoom
            case 1: preset = .mediumRoom
            case 2: preset = .largeRoom
            case 3: preset = .mediumHall
            case 4: preset = .cathedral
            default: preset = .mediumHall
            }
            let currentWetDry = reverb.wetDryMix
            reverb.loadFactoryPreset(preset)
            reverb.wetDryMix = currentWetDry
        default: break
        }
    }

    // MARK: - Delay Parameters

    private func applyDelayParameter(_ delay: AVAudioUnitDelay, name: String, value: Double) {
        switch name {
        case "time":     delay.delayTime = value / 1000.0  // ms -> seconds
        case "feedback": delay.feedback = Float(value)
        case "wetDry", "wetDryMix": delay.wetDryMix = Float(value)
        default: break
        }
    }

    // MARK: - Chorus Parameters

    private func applyChorusParameter(_ chorus: AVAudioUnitDistortion, name: String, value: Double) {
        switch name {
        case "wetDry", "wetDryMix": chorus.wetDryMix = Float(value)
        // rate and depth are not directly exposed on AVAudioUnitDistortion;
        // changing preset approximates different chorus characters
        default: break
        }
    }

    // MARK: - Distortion Parameters

    private func applyDistortionParameter(_ dist: AVAudioUnitDistortion, name: String, value: Double) {
        switch name {
        case "wetDry", "wetDryMix":
            dist.wetDryMix = Float(value)
        case "type":
            let preset: AVAudioUnitDistortionPreset
            switch Int(value) {
            case 0: preset = .drumsBitBrush       // soft
            case 1: preset = .drumsBufferBeats     // hard
            case 2: preset = .speechAlienChatter   // fuzz
            default: preset = .drumsBitBrush
            }
            let currentWetDry = dist.wetDryMix
            dist.loadFactoryPreset(preset)
            dist.wetDryMix = currentWetDry
        default: break
        }
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
        effectTypes.remove(at: index)
        bypassStates.remove(at: index)
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
        let type = effectTypes.remove(at: source)
        let bypass = bypassStates.remove(at: source)
        nodes.insert(node, at: destination)
        effectTypes.insert(type, at: destination)
        bypassStates.insert(bypass, at: destination)

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
        effectTypes.removeAll()
        bypassStates.removeAll()

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

    /// Get the effect type at a given index.
    func type(at index: Int) -> EffectType? {
        guard index >= 0 && index < effectTypes.count else { return nil }
        return effectTypes[index]
    }

    // MARK: - Serialization

    /// Return the current chain state as an array of dictionaries for sending to JS.
    func serialize() -> [[String: Any]] {
        return (0..<nodes.count).map { i in
            let type = effectTypes[i]
            let bypassed = bypassStates[i]
            var params: [String: Double] = [:]

            // Read current parameter values from the audio units
            switch type {
            case .eq:
                if let eq = nodes[i] as? AVAudioUnitEQ, eq.bands.count >= 3 {
                    params["lowFreq"] = Double(eq.bands[0].frequency)
                    params["lowGain"] = Double(eq.bands[0].gain)
                    params["lowQ"] = Double(eq.bands[0].bandwidth)
                    params["midFreq"] = Double(eq.bands[1].frequency)
                    params["midGain"] = Double(eq.bands[1].gain)
                    params["midQ"] = Double(eq.bands[1].bandwidth)
                    params["highFreq"] = Double(eq.bands[2].frequency)
                    params["highGain"] = Double(eq.bands[2].gain)
                    params["highQ"] = Double(eq.bands[2].bandwidth)
                }
            case .reverb:
                if let reverb = nodes[i] as? AVAudioUnitReverb {
                    params["wetDry"] = Double(reverb.wetDryMix)
                }
            case .delay:
                if let delay = nodes[i] as? AVAudioUnitDelay {
                    params["time"] = delay.delayTime * 1000.0
                    params["feedback"] = Double(delay.feedback)
                    params["wetDry"] = Double(delay.wetDryMix)
                }
            case .chorus:
                if let chorus = nodes[i] as? AVAudioUnitDistortion {
                    params["wetDry"] = Double(chorus.wetDryMix)
                }
            case .distortion:
                if let dist = nodes[i] as? AVAudioUnitDistortion {
                    params["wetDry"] = Double(dist.wetDryMix)
                }
            default:
                break
            }

            return [
                "type": type.rawValue,
                "bypassed": bypassed,
                "params": params,
            ] as [String: Any]
        }
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
