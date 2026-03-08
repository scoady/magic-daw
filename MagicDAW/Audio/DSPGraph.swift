import AVFoundation
import Accelerate

// MARK: - DSP Graph

/// A node-based DSP processing graph for building synths and effects.
class DSPGraph {
    var nodes: [String: any DSPNode] = [:]
    var connections: [DSPConnection] = []
    var outputNode: String?

    func process(frameCount: Int, sampleRate: Double) -> [Float] {
        // Reset all node inputs
        for key in nodes.keys {
            nodes[key]?.clearInputs()
        }

        // Build adjacency: for each connection, compute source node output, feed into destination input
        let sortedOrder = topologicalSort()

        var finalOutput = [Float](repeating: 0.0, count: frameCount)

        for nodeID in sortedOrder {
            guard var node = nodes[nodeID] else { continue }

            // Gather inputs from connections feeding into this node
            for conn in connections where conn.toNode == nodeID {
                if let sourceNode = nodes[conn.fromNode] {
                    let sourceOutput = sourceNode.process(frameCount: frameCount, sampleRate: sampleRate)
                    node.inputs[conn.toPort] = sourceOutput
                }
            }

            let output = node.process(frameCount: frameCount, sampleRate: sampleRate)
            nodes[nodeID] = node

            if nodeID == outputNode {
                finalOutput = output
            }
        }

        return finalOutput
    }

    func addNode(_ node: any DSPNode) {
        nodes[node.id] = node
    }

    func connect(from: String, fromPort: String, to: String, toPort: String) {
        let conn = DSPConnection(fromNode: from, fromPort: fromPort, toNode: to, toPort: toPort)
        connections.append(conn)
    }

    func removeNode(id: String) {
        nodes.removeValue(forKey: id)
        connections.removeAll { $0.fromNode == id || $0.toNode == id }
        if outputNode == id { outputNode = nil }
    }

    // Topological sort via Kahn's algorithm to ensure correct processing order.
    private func topologicalSort() -> [String] {
        var inDegree: [String: Int] = [:]
        for key in nodes.keys { inDegree[key] = 0 }
        for conn in connections {
            inDegree[conn.toNode, default: 0] += 1
        }

        var queue = nodes.keys.filter { inDegree[$0] == 0 }
        var sorted: [String] = []

        while !queue.isEmpty {
            let node = queue.removeFirst()
            sorted.append(node)
            for conn in connections where conn.fromNode == node {
                inDegree[conn.toNode, default: 0] -= 1
                if inDegree[conn.toNode] == 0 {
                    queue.append(conn.toNode)
                }
            }
        }

        return sorted
    }
}

// MARK: - DSP Node Protocol

protocol DSPNode {
    var id: String { get }
    var type: DSPNodeType { get }
    var parameters: [String: Float] { get set }
    var inputs: [String: [Float]] { get set }

    mutating func process(frameCount: Int, sampleRate: Double) -> [Float]
    mutating func clearInputs()
}

extension DSPNode {
    mutating func clearInputs() {
        inputs.removeAll()
    }
}

// MARK: - Types

enum DSPNodeType: String, Codable {
    case oscillator, noise, wavetable
    case lowpass, highpass, bandpass, notch
    case adsr, lfo
    case delay, reverb, chorus, distortion, bitcrusher
    case add, multiply, mix
    case output
}

struct DSPConnection: Codable {
    let fromNode: String
    let fromPort: String
    let toNode: String
    let toPort: String
}

// MARK: - Oscillator Node

struct OscillatorNode: DSPNode {
    let id: String
    let type: DSPNodeType = .oscillator
    var parameters: [String: Float] = [
        "frequency": 440.0,
        "amplitude": 1.0,
        "detune": 0.0,       // cents
        "waveform": 0.0      // 0=sine, 1=saw, 2=square, 3=triangle
    ]
    var inputs: [String: [Float]] = [:]
    private var phase: Double = 0.0

    init(id: String) { self.id = id }

    mutating func process(frameCount: Int, sampleRate: Double) -> [Float] {
        var output = [Float](repeating: 0.0, count: frameCount)
        let baseFreq = Double(parameters["frequency", default: 440.0])
        let detuneCents = Double(parameters["detune", default: 0.0])
        let frequency = baseFreq * pow(2.0, detuneCents / 1200.0)
        let amplitude = Double(parameters["amplitude", default: 1.0])
        let waveform = Int(parameters["waveform", default: 0.0])

        // If frequency modulation input exists, use it
        let freqMod = inputs["frequency"]

        let phaseIncrement = frequency / sampleRate

        for i in 0..<frameCount {
            var currentFreq = frequency
            if let fm = freqMod, i < fm.count {
                currentFreq += Double(fm[i])
            }
            let inc = currentFreq / sampleRate

            let sample: Double
            switch waveform {
            case 0: // Sine
                sample = sin(phase * 2.0 * .pi)
            case 1: // Saw (naive, no anti-aliasing for simplicity)
                sample = 2.0 * (phase - floor(phase + 0.5))
            case 2: // Square
                sample = phase.truncatingRemainder(dividingBy: 1.0) < 0.5 ? 1.0 : -1.0
            case 3: // Triangle
                let p = phase.truncatingRemainder(dividingBy: 1.0)
                sample = 4.0 * abs(p - 0.5) - 1.0
            default:
                sample = sin(phase * 2.0 * .pi)
            }

            output[i] = Float(sample * amplitude)
            phase += inc
            if phase >= 1.0 { phase -= 1.0 }
        }

        return output
    }
}

// MARK: - Noise Node

struct NoiseNode: DSPNode {
    let id: String
    let type: DSPNodeType = .noise
    var parameters: [String: Float] = [
        "amplitude": 1.0,
        "color": 0.0     // 0=white, 1=pink
    ]
    var inputs: [String: [Float]] = [:]

    // Pink noise state (Paul Kellet's algorithm)
    private var b0: Float = 0, b1: Float = 0, b2: Float = 0
    private var b3: Float = 0, b4: Float = 0, b5: Float = 0, b6: Float = 0

    init(id: String) { self.id = id }

    mutating func process(frameCount: Int, sampleRate: Double) -> [Float] {
        var output = [Float](repeating: 0.0, count: frameCount)
        let amplitude = parameters["amplitude", default: 1.0]
        let color = Int(parameters["color", default: 0.0])

        for i in 0..<frameCount {
            let white = Float.random(in: -1.0...1.0)

            if color == 1 {
                // Pink noise — Paul Kellet's refined method
                b0 = 0.99886 * b0 + white * 0.0555179
                b1 = 0.99332 * b1 + white * 0.0750759
                b2 = 0.96900 * b2 + white * 0.1538520
                b3 = 0.86650 * b3 + white * 0.3104856
                b4 = 0.55000 * b4 + white * 0.5329522
                b5 = -0.7616 * b5 - white * 0.0168980
                let pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
                b6 = white * 0.115926
                output[i] = pink * amplitude
            } else {
                output[i] = white * amplitude
            }
        }

        return output
    }
}

// MARK: - Low-Pass Filter Node (Biquad)

struct LowPassFilterNode: DSPNode {
    let id: String
    let type: DSPNodeType = .lowpass
    var parameters: [String: Float] = [
        "cutoff": 20000.0,
        "resonance": 0.707
    ]
    var inputs: [String: [Float]] = [:]

    // Biquad state
    private var x1: Float = 0, x2: Float = 0
    private var y1: Float = 0, y2: Float = 0

    init(id: String) { self.id = id }

    mutating func process(frameCount: Int, sampleRate: Double) -> [Float] {
        guard let inputSignal = inputs["input"], !inputSignal.isEmpty else {
            return [Float](repeating: 0.0, count: frameCount)
        }

        var output = [Float](repeating: 0.0, count: frameCount)
        let cutoff = max(20.0, min(Float(sampleRate / 2.0 - 1.0), parameters["cutoff", default: 20000.0]))
        let Q = max(0.1, parameters["resonance", default: 0.707])

        // Biquad coefficients for 2-pole low-pass
        let omega = 2.0 * Float.pi * cutoff / Float(sampleRate)
        let sinOmega = sin(omega)
        let cosOmega = cos(omega)
        let alpha = sinOmega / (2.0 * Q)

        let a0 = 1.0 + alpha
        let b0 = ((1.0 - cosOmega) / 2.0) / a0
        let b1 = (1.0 - cosOmega) / a0
        let b2 = ((1.0 - cosOmega) / 2.0) / a0
        let a1 = (-2.0 * cosOmega) / a0
        let a2 = (1.0 - alpha) / a0

        for i in 0..<frameCount {
            let x0 = i < inputSignal.count ? inputSignal[i] : 0.0
            let y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2

            output[i] = y0
            x2 = x1
            x1 = x0
            y2 = y1
            y1 = y0
        }

        return output
    }
}

// MARK: - ADSR Node

struct ADSRNode: DSPNode {
    let id: String
    let type: DSPNodeType = .adsr
    var parameters: [String: Float] = [
        "attack": 0.01,
        "decay": 0.1,
        "sustain": 0.8,
        "release": 0.3
    ]
    var inputs: [String: [Float]] = [:]

    private enum Stage { case idle, attack, decay, sustain, release }
    private var stage: Stage = .idle
    private var level: Float = 0.0
    private var sampleCounter: Int = 0

    init(id: String) { self.id = id }

    mutating func process(frameCount: Int, sampleRate: Double) -> [Float] {
        var output = [Float](repeating: 0.0, count: frameCount)
        let gate = inputs["gate"]
        let attackTime = max(0.001, parameters["attack", default: 0.01])
        let decayTime = max(0.001, parameters["decay", default: 0.1])
        let sustainLevel = parameters["sustain", default: 0.8]
        let releaseTime = max(0.001, parameters["release", default: 0.3])

        let attackSamples = Int(Double(attackTime) * sampleRate)
        let decaySamples = Int(Double(decayTime) * sampleRate)
        let releaseSamples = Int(Double(releaseTime) * sampleRate)

        for i in 0..<frameCount {
            let gateOn = gate != nil && i < gate!.count && gate![i] > 0.5

            // State transitions
            if gateOn && (stage == .idle || stage == .release) {
                stage = .attack
                sampleCounter = 0
            } else if !gateOn && (stage == .attack || stage == .decay || stage == .sustain) {
                stage = .release
                sampleCounter = 0
            }

            switch stage {
            case .idle:
                level = 0.0
            case .attack:
                level = Float(sampleCounter) / Float(attackSamples)
                if level >= 1.0 {
                    level = 1.0
                    stage = .decay
                    sampleCounter = 0
                }
            case .decay:
                let decayProgress = Float(sampleCounter) / Float(decaySamples)
                level = 1.0 - (1.0 - sustainLevel) * decayProgress
                if decayProgress >= 1.0 {
                    level = sustainLevel
                    stage = .sustain
                    sampleCounter = 0
                }
            case .sustain:
                level = sustainLevel
            case .release:
                let releaseProgress = Float(sampleCounter) / Float(releaseSamples)
                let startLevel = level
                level = startLevel * (1.0 - releaseProgress)
                if releaseProgress >= 1.0 {
                    level = 0.0
                    stage = .idle
                    sampleCounter = 0
                }
            }

            output[i] = level
            sampleCounter += 1
        }

        // If there's an input signal, multiply by envelope
        if let inputSignal = inputs["input"], !inputSignal.isEmpty {
            var result = [Float](repeating: 0.0, count: frameCount)
            let count = min(frameCount, inputSignal.count)
            vDSP_vmul(inputSignal, 1, output, 1, &result, 1, vDSP_Length(count))
            return result
        }

        return output
    }
}

// MARK: - LFO Node

struct LFONode: DSPNode {
    let id: String
    let type: DSPNodeType = .lfo
    var parameters: [String: Float] = [
        "rate": 1.0,      // Hz
        "depth": 1.0,
        "waveform": 0.0   // 0=sine, 1=triangle, 2=square, 3=saw
    ]
    var inputs: [String: [Float]] = [:]
    private var phase: Double = 0.0

    init(id: String) { self.id = id }

    mutating func process(frameCount: Int, sampleRate: Double) -> [Float] {
        var output = [Float](repeating: 0.0, count: frameCount)
        let rate = Double(parameters["rate", default: 1.0])
        let depth = parameters["depth", default: 1.0]
        let waveform = Int(parameters["waveform", default: 0.0])

        let phaseIncrement = rate / sampleRate

        for i in 0..<frameCount {
            let sample: Double
            switch waveform {
            case 0: // Sine
                sample = sin(phase * 2.0 * .pi)
            case 1: // Triangle
                let p = phase.truncatingRemainder(dividingBy: 1.0)
                sample = 4.0 * abs(p - 0.5) - 1.0
            case 2: // Square
                sample = phase.truncatingRemainder(dividingBy: 1.0) < 0.5 ? 1.0 : -1.0
            case 3: // Saw
                sample = 2.0 * (phase - floor(phase + 0.5))
            default:
                sample = sin(phase * 2.0 * .pi)
            }

            output[i] = Float(sample) * depth
            phase += phaseIncrement
            if phase >= 1.0 { phase -= 1.0 }
        }

        return output
    }
}

// MARK: - Delay Node

struct DelayNode: DSPNode {
    let id: String
    let type: DSPNodeType = .delay
    var parameters: [String: Float] = [
        "time": 0.25,       // seconds
        "feedback": 0.4,
        "mix": 0.5
    ]
    var inputs: [String: [Float]] = [:]

    private var buffer: [Float] = []
    private var writeIndex: Int = 0
    private var maxDelaySamples: Int = 0
    private var initialized = false

    init(id: String) { self.id = id }

    mutating func process(frameCount: Int, sampleRate: Double) -> [Float] {
        guard let inputSignal = inputs["input"], !inputSignal.isEmpty else {
            return [Float](repeating: 0.0, count: frameCount)
        }

        // Initialize buffer on first use (max 2 seconds of delay)
        if !initialized {
            maxDelaySamples = Int(2.0 * sampleRate)
            buffer = [Float](repeating: 0.0, count: maxDelaySamples)
            initialized = true
        }

        var output = [Float](repeating: 0.0, count: frameCount)
        let delayTimeSamples = min(maxDelaySamples - 1, max(1, Int(Double(parameters["time", default: 0.25]) * sampleRate)))
        let feedback = max(0.0, min(0.99, parameters["feedback", default: 0.4]))
        let mix = parameters["mix", default: 0.5]

        for i in 0..<frameCount {
            let dry = i < inputSignal.count ? inputSignal[i] : 0.0

            // Read from delay line
            var readIndex = writeIndex - delayTimeSamples
            if readIndex < 0 { readIndex += maxDelaySamples }
            let wet = buffer[readIndex]

            // Write to delay line: input + feedback
            buffer[writeIndex] = dry + wet * feedback

            // Mix dry/wet
            output[i] = dry * (1.0 - mix) + wet * mix

            writeIndex += 1
            if writeIndex >= maxDelaySamples { writeIndex = 0 }
        }

        return output
    }
}

// MARK: - Distortion Node

struct DistortionNode: DSPNode {
    let id: String
    let type: DSPNodeType = .distortion
    var parameters: [String: Float] = [
        "drive": 5.0,
        "mix": 1.0
    ]
    var inputs: [String: [Float]] = [:]

    init(id: String) { self.id = id }

    mutating func process(frameCount: Int, sampleRate: Double) -> [Float] {
        guard let inputSignal = inputs["input"], !inputSignal.isEmpty else {
            return [Float](repeating: 0.0, count: frameCount)
        }

        var output = [Float](repeating: 0.0, count: frameCount)
        let drive = max(1.0, parameters["drive", default: 5.0])
        let mix = parameters["mix", default: 1.0]

        for i in 0..<min(frameCount, inputSignal.count) {
            let dry = inputSignal[i]
            // Soft clipping via tanh waveshaper
            let driven = dry * drive
            let wet = tanh(driven) / tanh(drive) // Normalized soft clip
            output[i] = dry * (1.0 - mix) + wet * mix
        }

        return output
    }
}

// MARK: - Mix Node

struct MixNode: DSPNode {
    let id: String
    let type: DSPNodeType = .mix
    var parameters: [String: Float] = [
        "crossfade": 0.5   // 0.0 = all inputA, 1.0 = all inputB
    ]
    var inputs: [String: [Float]] = [:]

    init(id: String) { self.id = id }

    mutating func process(frameCount: Int, sampleRate: Double) -> [Float] {
        var output = [Float](repeating: 0.0, count: frameCount)
        let crossfade = parameters["crossfade", default: 0.5]
        let inputA = inputs["inputA"] ?? [Float](repeating: 0.0, count: frameCount)
        let inputB = inputs["inputB"] ?? [Float](repeating: 0.0, count: frameCount)

        // Use vDSP for efficient mixing
        var scaledA = [Float](repeating: 0.0, count: frameCount)
        var scaledB = [Float](repeating: 0.0, count: frameCount)
        var gainA = 1.0 - crossfade
        var gainB = crossfade

        let countA = vDSP_Length(min(frameCount, inputA.count))
        let countB = vDSP_Length(min(frameCount, inputB.count))

        vDSP_vsmul(inputA, 1, &gainA, &scaledA, 1, countA)
        vDSP_vsmul(inputB, 1, &gainB, &scaledB, 1, countB)
        vDSP_vadd(scaledA, 1, scaledB, 1, &output, 1, vDSP_Length(frameCount))

        return output
    }
}

// MARK: - Output Node

struct OutputNode: DSPNode {
    let id: String
    let type: DSPNodeType = .output
    var parameters: [String: Float] = [
        "gain": 1.0
    ]
    var inputs: [String: [Float]] = [:]

    init(id: String) { self.id = id }

    mutating func process(frameCount: Int, sampleRate: Double) -> [Float] {
        guard let inputSignal = inputs["input"], !inputSignal.isEmpty else {
            return [Float](repeating: 0.0, count: frameCount)
        }

        let gain = parameters["gain", default: 1.0]
        if abs(gain - 1.0) < 0.0001 {
            return Array(inputSignal.prefix(frameCount))
        }

        var output = [Float](repeating: 0.0, count: frameCount)
        var g = gain
        vDSP_vsmul(inputSignal, 1, &g, &output, 1, vDSP_Length(min(frameCount, inputSignal.count)))
        return output
    }
}
