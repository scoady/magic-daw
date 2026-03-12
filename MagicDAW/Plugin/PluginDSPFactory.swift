import Foundation

enum PluginDSPFactory {
    static func normalizedDefinitionForInternalPlayback(from definition: NodeGraphDefinition) -> NodeGraphDefinition {
        var normalized = definition
        let hasInstrumentSource = normalized.nodes.contains { ["oscillator", "noise", "wavetable", "subOscillator"].contains($0.type) }

        for index in normalized.nodes.indices {
            let node = normalized.nodes[index]

            if node.type == "lowpass",
               hasInstrumentSource,
               let cutoff = node.parameterValue("cutoff"),
               cutoff <= 40.0 {
                normalized.nodes[index].setParameter("cutoff", value: 2200.0)
            }
        }

        return normalized
    }

    static func buildGraph(from definition: NodeGraphDefinition) -> DSPGraph {
        let definition = normalizedDefinitionForInternalPlayback(from: definition)
        let graph = DSPGraph()
        for node in definition.nodes {
            if let dspNode = makeDSPNode(node) {
                graph.addNode(dspNode)
            }
        }
        for connection in definition.connections {
            graph.connect(
                from: connection.fromNode,
                fromPort: connection.fromPort,
                to: connection.toNode,
                toPort: normalizedInputPort(connection.toPort, for: definition.node(withId: connection.toNode)?.type)
            )
        }
        if let output = definition.nodes.first(where: { $0.type == "output" }) {
            graph.outputNode = output.id
        }
        return graph
    }

    static func prepareInstrumentGraph(
        from definition: NodeGraphDefinition,
        note: UInt8,
        velocity: UInt8
    ) -> DSPGraph {
        let normalizedDefinition = normalizedDefinitionForInternalPlayback(from: definition)
        let graph = buildGraph(from: normalizedDefinition)
        let noteFrequency = 440.0 * pow(2.0, (Double(note) - 69.0) / 12.0)
        let velocityScale = max(0.05, min(1.0, Double(velocity) / 127.0))

        for node in normalizedDefinition.nodes where node.type == "oscillator" {
            graph.setParameter(nodeId: node.id, name: "frequency", value: Float(noteFrequency))
            let baseAmplitude = Float(node.parameterValue("amplitude") ?? 1.0)
            graph.setParameter(nodeId: node.id, name: "amplitude", value: baseAmplitude * Float(velocityScale))
        }

        for node in normalizedDefinition.nodes where node.type == "output" {
            let baseGain = Float(node.parameterValue("gain") ?? 1.0)
            graph.setParameter(nodeId: node.id, name: "gain", value: baseGain)
        }

        return graph
    }

    static func envelopeSettings(from definition: NodeGraphDefinition) -> EnvelopeSettings {
        guard let adsr = definition.nodes.first(where: { $0.type == "adsr" }) else {
            return EnvelopeSettings(attack: 0.01, decay: 0.1, sustain: 0.85, release: 0.25)
        }

        let rawAttack = adsr.parameterValue("attack") ?? 0.01
        let rawDecay = adsr.parameterValue("decay") ?? 0.1
        let rawRelease = adsr.parameterValue("release") ?? 0.25

        return EnvelopeSettings(
            attack: max(0.001, normalizedEnvelopeTime(rawAttack)),
            decay: max(0.001, normalizedEnvelopeTime(rawDecay)),
            sustain: max(0.0, min(1.0, adsr.parameterValue("sustain") ?? 0.85)),
            release: max(0.001, normalizedEnvelopeTime(rawRelease))
        )
    }

    static func normalizedInputPort(_ port: String, for nodeType: String?) -> String {
        if port == "input1" { return "input1" }
        if port == "input2" { return "input2" }
        if port == "input3" { return "input3" }
        guard port == "audio", let nodeType else { return port }
        switch nodeType {
        case "lowpass", "highpass", "bandpass", "notch", "comb",
             "delay", "reverb", "chorus", "distortion", "bitcrusher",
             "phaser", "flanger", "clamp", "scale", "output":
            return "input"
        default:
            return port
        }
    }

    private static func normalizedEnvelopeTime(_ value: Double) -> Double {
        value > 10.0 ? value / 1000.0 : value
    }

    private static func makeDSPNode(_ definition: NodeDefinition) -> (any DSPNode)? {
        func apply(_ defs: [ParameterDefinition], _ parameters: inout [String: Float]) {
            for definition in defs {
                parameters[definition.name] = Float(definition.value)
            }
        }

        switch definition.type {
        case "oscillator":
            var node = OscillatorNode(id: definition.id)
            apply(definition.parameters, &node.parameters)
            return node
        case "noise":
            var node = NoiseNode(id: definition.id)
            apply(definition.parameters, &node.parameters)
            return node
        case "lowpass":
            var node = LowPassFilterNode(id: definition.id)
            apply(definition.parameters, &node.parameters)
            return node
        case "adsr":
            var node = ADSRNode(id: definition.id)
            apply(definition.parameters, &node.parameters)
            return node
        case "lfo":
            var node = LFONode(id: definition.id)
            apply(definition.parameters, &node.parameters)
            return node
        case "delay":
            var node = DelayNode(id: definition.id)
            apply(definition.parameters, &node.parameters)
            return node
        case "distortion":
            var node = DistortionNode(id: definition.id)
            apply(definition.parameters, &node.parameters)
            return node
        case "mix":
            var node = MixNode(id: definition.id)
            apply(definition.parameters, &node.parameters)
            return node
        case "output":
            var node = OutputNode(id: definition.id)
            apply(definition.parameters, &node.parameters)
            return node
        default:
            return OutputNode(id: definition.id)
        }
    }
}

struct EnvelopeSettings {
    let attack: Double
    let decay: Double
    let sustain: Double
    let release: Double
}
