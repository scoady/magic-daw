import Foundation

// MARK: - DSPNodeTemplate

struct DSPNodeTemplate {
    let type: String
    let category: String
    let displayName: String
    let inputs: [String]
    let outputs: [String]
    let parameters: [ParameterDefinition]

    /// Create a NodeDefinition instance from this template with a unique ID
    func instantiate(id: String, position: CGPoint = .zero) -> NodeDefinition {
        NodeDefinition(
            id: id,
            type: type,
            parameters: parameters,
            position: position
        )
    }
}

// MARK: - DSPNodeRegistry

struct DSPNodeRegistry {

    /// Look up a node template by type string
    static func template(for type: String) -> DSPNodeTemplate? {
        allNodes.first { $0.type == type }
    }

    /// All node templates grouped by category
    static var categorized: [(category: String, nodes: [DSPNodeTemplate])] {
        let grouped = Dictionary(grouping: allNodes, by: \.category)
        let order = ["Source", "Filter", "Envelope", "Modulation", "Effect", "Math", "Output"]
        return order.compactMap { cat in
            guard let nodes = grouped[cat] else { return nil }
            return (category: cat, nodes: nodes)
        }
    }

    // MARK: - Complete Node Catalog

    static let allNodes: [DSPNodeTemplate] = [

        // ─────────────────────────────────────────────
        // MARK: Sources
        // ─────────────────────────────────────────────

        DSPNodeTemplate(
            type: "oscillator",
            category: "Source",
            displayName: "Oscillator",
            inputs: ["frequency", "amplitude", "detune"],
            outputs: ["audio"],
            parameters: [
                .init(name: "waveform", value: 0, min: 0, max: 3, unit: ""),        // 0=sine, 1=saw, 2=square, 3=triangle
                .init(name: "frequency", value: 440, min: 20, max: 20000, unit: "Hz"),
                .init(name: "amplitude", value: 0.5, min: 0, max: 1, unit: ""),
                .init(name: "detune", value: 0, min: -100, max: 100, unit: "cents"),
                .init(name: "pulseWidth", value: 0.5, min: 0.01, max: 0.99, unit: ""),  // for square wave
            ]
        ),

        DSPNodeTemplate(
            type: "noise",
            category: "Source",
            displayName: "Noise Generator",
            inputs: ["amplitude"],
            outputs: ["audio"],
            parameters: [
                .init(name: "noiseType", value: 0, min: 0, max: 2, unit: ""),   // 0=white, 1=pink, 2=brown
                .init(name: "amplitude", value: 0.5, min: 0, max: 1, unit: ""),
            ]
        ),

        DSPNodeTemplate(
            type: "wavetable",
            category: "Source",
            displayName: "Wavetable Oscillator",
            inputs: ["frequency", "amplitude", "tablePosition"],
            outputs: ["audio"],
            parameters: [
                .init(name: "frequency", value: 440, min: 20, max: 20000, unit: "Hz"),
                .init(name: "amplitude", value: 0.5, min: 0, max: 1, unit: ""),
                .init(name: "tablePosition", value: 0, min: 0, max: 1, unit: ""),  // morph between tables
                .init(name: "tableSize", value: 2048, min: 256, max: 4096, unit: "samples"),
                .init(name: "detune", value: 0, min: -100, max: 100, unit: "cents"),
            ]
        ),

        DSPNodeTemplate(
            type: "subOscillator",
            category: "Source",
            displayName: "Sub Oscillator",
            inputs: ["frequency", "amplitude"],
            outputs: ["audio"],
            parameters: [
                .init(name: "waveform", value: 0, min: 0, max: 1, unit: ""),   // 0=sine, 1=square
                .init(name: "frequency", value: 440, min: 20, max: 20000, unit: "Hz"),
                .init(name: "amplitude", value: 0.5, min: 0, max: 1, unit: ""),
                .init(name: "octave", value: -1, min: -2, max: 0, unit: "oct"),  // -1 = one octave below
            ]
        ),

        // ─────────────────────────────────────────────
        // MARK: Filters
        // ─────────────────────────────────────────────

        DSPNodeTemplate(
            type: "lowpass",
            category: "Filter",
            displayName: "Low Pass Filter",
            inputs: ["audio", "cutoff", "resonance"],
            outputs: ["audio"],
            parameters: [
                .init(name: "cutoff", value: 8000, min: 20, max: 20000, unit: "Hz"),
                .init(name: "resonance", value: 0.0, min: 0, max: 1, unit: ""),
                .init(name: "slope", value: 0, min: 0, max: 1, unit: ""),       // 0=12dB/oct, 1=24dB/oct
            ]
        ),

        DSPNodeTemplate(
            type: "highpass",
            category: "Filter",
            displayName: "High Pass Filter",
            inputs: ["audio", "cutoff", "resonance"],
            outputs: ["audio"],
            parameters: [
                .init(name: "cutoff", value: 200, min: 20, max: 20000, unit: "Hz"),
                .init(name: "resonance", value: 0.0, min: 0, max: 1, unit: ""),
                .init(name: "slope", value: 0, min: 0, max: 1, unit: ""),
            ]
        ),

        DSPNodeTemplate(
            type: "bandpass",
            category: "Filter",
            displayName: "Band Pass Filter",
            inputs: ["audio", "cutoff", "resonance"],
            outputs: ["audio"],
            parameters: [
                .init(name: "cutoff", value: 1000, min: 20, max: 20000, unit: "Hz"),
                .init(name: "resonance", value: 0.5, min: 0, max: 1, unit: ""),
                .init(name: "bandwidth", value: 1.0, min: 0.1, max: 10, unit: "oct"),
            ]
        ),

        DSPNodeTemplate(
            type: "notch",
            category: "Filter",
            displayName: "Notch Filter",
            inputs: ["audio", "cutoff"],
            outputs: ["audio"],
            parameters: [
                .init(name: "cutoff", value: 1000, min: 20, max: 20000, unit: "Hz"),
                .init(name: "bandwidth", value: 1.0, min: 0.1, max: 10, unit: "oct"),
            ]
        ),

        DSPNodeTemplate(
            type: "comb",
            category: "Filter",
            displayName: "Comb Filter",
            inputs: ["audio", "frequency"],
            outputs: ["audio"],
            parameters: [
                .init(name: "frequency", value: 200, min: 20, max: 5000, unit: "Hz"),
                .init(name: "feedback", value: 0.5, min: 0, max: 0.99, unit: ""),
                .init(name: "damping", value: 0.5, min: 0, max: 1, unit: ""),
            ]
        ),

        // ─────────────────────────────────────────────
        // MARK: Envelopes
        // ─────────────────────────────────────────────

        DSPNodeTemplate(
            type: "adsr",
            category: "Envelope",
            displayName: "ADSR Envelope",
            inputs: ["gate"],
            outputs: ["signal"],
            parameters: [
                .init(name: "attack", value: 10, min: 0.1, max: 10000, unit: "ms"),
                .init(name: "decay", value: 100, min: 0.1, max: 10000, unit: "ms"),
                .init(name: "sustain", value: 0.7, min: 0, max: 1, unit: ""),
                .init(name: "release", value: 200, min: 0.1, max: 30000, unit: "ms"),
                .init(name: "curve", value: 0.5, min: 0, max: 1, unit: ""),    // 0=linear, 0.5=exp, 1=log
            ]
        ),

        DSPNodeTemplate(
            type: "multiStageEnvelope",
            category: "Envelope",
            displayName: "Multi-Stage Envelope",
            inputs: ["gate"],
            outputs: ["signal"],
            parameters: [
                .init(name: "stages", value: 4, min: 2, max: 8, unit: ""),
                .init(name: "time1", value: 10, min: 0.1, max: 10000, unit: "ms"),
                .init(name: "level1", value: 1.0, min: 0, max: 1, unit: ""),
                .init(name: "time2", value: 100, min: 0.1, max: 10000, unit: "ms"),
                .init(name: "level2", value: 0.7, min: 0, max: 1, unit: ""),
                .init(name: "time3", value: 200, min: 0.1, max: 10000, unit: "ms"),
                .init(name: "level3", value: 0.5, min: 0, max: 1, unit: ""),
                .init(name: "releaseTime", value: 300, min: 0.1, max: 30000, unit: "ms"),
            ]
        ),

        // ─────────────────────────────────────────────
        // MARK: Modulation
        // ─────────────────────────────────────────────

        DSPNodeTemplate(
            type: "lfo",
            category: "Modulation",
            displayName: "LFO",
            inputs: ["rate", "depth"],
            outputs: ["signal"],
            parameters: [
                .init(name: "waveform", value: 0, min: 0, max: 4, unit: ""),   // 0=sine, 1=saw, 2=square, 3=tri, 4=s&h
                .init(name: "rate", value: 2.0, min: 0.01, max: 50, unit: "Hz"),
                .init(name: "depth", value: 1.0, min: 0, max: 1, unit: ""),
                .init(name: "phase", value: 0, min: 0, max: 360, unit: "deg"),
                .init(name: "sync", value: 0, min: 0, max: 1, unit: ""),       // 0=free, 1=tempo sync
            ]
        ),

        // ─────────────────────────────────────────────
        // MARK: Effects
        // ─────────────────────────────────────────────

        DSPNodeTemplate(
            type: "delay",
            category: "Effect",
            displayName: "Delay",
            inputs: ["audio"],
            outputs: ["audio"],
            parameters: [
                .init(name: "time", value: 375, min: 1, max: 5000, unit: "ms"),
                .init(name: "feedback", value: 0.4, min: 0, max: 0.99, unit: ""),
                .init(name: "mix", value: 0.3, min: 0, max: 1, unit: ""),
                .init(name: "lowCut", value: 200, min: 20, max: 2000, unit: "Hz"),
                .init(name: "highCut", value: 8000, min: 1000, max: 20000, unit: "Hz"),
            ]
        ),

        DSPNodeTemplate(
            type: "reverb",
            category: "Effect",
            displayName: "Reverb",
            inputs: ["audio"],
            outputs: ["audio"],
            parameters: [
                .init(name: "roomSize", value: 0.5, min: 0, max: 1, unit: ""),
                .init(name: "damping", value: 0.5, min: 0, max: 1, unit: ""),
                .init(name: "mix", value: 0.3, min: 0, max: 1, unit: ""),
                .init(name: "preDelay", value: 20, min: 0, max: 200, unit: "ms"),
                .init(name: "width", value: 1.0, min: 0, max: 1, unit: ""),
            ]
        ),

        DSPNodeTemplate(
            type: "chorus",
            category: "Effect",
            displayName: "Chorus",
            inputs: ["audio"],
            outputs: ["audio"],
            parameters: [
                .init(name: "rate", value: 1.5, min: 0.1, max: 10, unit: "Hz"),
                .init(name: "depth", value: 0.5, min: 0, max: 1, unit: ""),
                .init(name: "mix", value: 0.5, min: 0, max: 1, unit: ""),
                .init(name: "feedback", value: 0.2, min: 0, max: 0.9, unit: ""),
                .init(name: "voices", value: 2, min: 1, max: 4, unit: ""),
            ]
        ),

        DSPNodeTemplate(
            type: "distortion",
            category: "Effect",
            displayName: "Distortion",
            inputs: ["audio"],
            outputs: ["audio"],
            parameters: [
                .init(name: "drive", value: 0.5, min: 0, max: 1, unit: ""),
                .init(name: "tone", value: 0.5, min: 0, max: 1, unit: ""),
                .init(name: "mix", value: 1.0, min: 0, max: 1, unit: ""),
                .init(name: "mode", value: 0, min: 0, max: 2, unit: ""),   // 0=soft clip, 1=hard clip, 2=fold
            ]
        ),

        DSPNodeTemplate(
            type: "bitcrusher",
            category: "Effect",
            displayName: "Bitcrusher",
            inputs: ["audio"],
            outputs: ["audio"],
            parameters: [
                .init(name: "bitDepth", value: 8, min: 1, max: 24, unit: "bits"),
                .init(name: "sampleRateReduction", value: 1, min: 1, max: 64, unit: "x"),
                .init(name: "mix", value: 1.0, min: 0, max: 1, unit: ""),
            ]
        ),

        DSPNodeTemplate(
            type: "phaser",
            category: "Effect",
            displayName: "Phaser",
            inputs: ["audio"],
            outputs: ["audio"],
            parameters: [
                .init(name: "rate", value: 0.5, min: 0.01, max: 10, unit: "Hz"),
                .init(name: "depth", value: 0.7, min: 0, max: 1, unit: ""),
                .init(name: "feedback", value: 0.5, min: 0, max: 0.99, unit: ""),
                .init(name: "stages", value: 4, min: 2, max: 12, unit: ""),
                .init(name: "mix", value: 0.5, min: 0, max: 1, unit: ""),
            ]
        ),

        DSPNodeTemplate(
            type: "flanger",
            category: "Effect",
            displayName: "Flanger",
            inputs: ["audio"],
            outputs: ["audio"],
            parameters: [
                .init(name: "rate", value: 0.3, min: 0.01, max: 10, unit: "Hz"),
                .init(name: "depth", value: 0.7, min: 0, max: 1, unit: ""),
                .init(name: "feedback", value: 0.5, min: -0.99, max: 0.99, unit: ""),
                .init(name: "mix", value: 0.5, min: 0, max: 1, unit: ""),
            ]
        ),

        // ─────────────────────────────────────────────
        // MARK: Math / Utility
        // ─────────────────────────────────────────────

        DSPNodeTemplate(
            type: "add",
            category: "Math",
            displayName: "Add (Mix)",
            inputs: ["inputA", "inputB"],
            outputs: ["audio"],
            parameters: [
                .init(name: "gainA", value: 1.0, min: 0, max: 2, unit: ""),
                .init(name: "gainB", value: 1.0, min: 0, max: 2, unit: ""),
            ]
        ),

        DSPNodeTemplate(
            type: "multiply",
            category: "Math",
            displayName: "Multiply (VCA)",
            inputs: ["audio", "modulator"],
            outputs: ["audio"],
            parameters: [
                .init(name: "amount", value: 1.0, min: 0, max: 2, unit: ""),
            ]
        ),

        DSPNodeTemplate(
            type: "mix",
            category: "Math",
            displayName: "Crossfade Mix",
            inputs: ["inputA", "inputB"],
            outputs: ["audio"],
            parameters: [
                .init(name: "mix", value: 0.5, min: 0, max: 1, unit: ""),    // 0=all A, 1=all B
            ]
        ),

        DSPNodeTemplate(
            type: "clamp",
            category: "Math",
            displayName: "Clamp / Limiter",
            inputs: ["audio"],
            outputs: ["audio"],
            parameters: [
                .init(name: "min", value: -1.0, min: -1, max: 0, unit: ""),
                .init(name: "max", value: 1.0, min: 0, max: 1, unit: ""),
            ]
        ),

        DSPNodeTemplate(
            type: "scale",
            category: "Math",
            displayName: "Scale / Gain",
            inputs: ["audio"],
            outputs: ["audio"],
            parameters: [
                .init(name: "gain", value: 1.0, min: 0, max: 4, unit: ""),
                .init(name: "offset", value: 0.0, min: -1, max: 1, unit: ""),
            ]
        ),

        // ─────────────────────────────────────────────
        // MARK: Output
        // ─────────────────────────────────────────────

        DSPNodeTemplate(
            type: "output",
            category: "Output",
            displayName: "Audio Output",
            inputs: ["audio"],
            outputs: [],
            parameters: [
                .init(name: "gain", value: 1.0, min: 0, max: 1, unit: ""),
            ]
        ),
    ]
}
