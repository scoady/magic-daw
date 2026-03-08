import Foundation

// MARK: - CompilerError

enum CompilerError: LocalizedError {
    case missingOutputNode
    case cyclicGraph
    case unconnectedOutputNode
    case invalidNodeType(String)
    case invalidConnection(String)
    case buildFailed(String)
    case noXcodeToolchain
    case emptyGraph
    case validationFailed([GraphValidationError])

    var errorDescription: String? {
        switch self {
        case .missingOutputNode:
            return "Graph must have exactly one 'output' node"
        case .cyclicGraph:
            return "Graph contains a cycle — feedback loops are not supported in compiled plugins"
        case .unconnectedOutputNode:
            return "The output node has no incoming audio connection"
        case .invalidNodeType(let type):
            return "Unknown node type: '\(type)'"
        case .invalidConnection(let detail):
            return "Invalid connection: \(detail)"
        case .buildFailed(let detail):
            return "Build failed: \(detail)"
        case .noXcodeToolchain:
            return "Xcode command-line tools not found. Install with: xcode-select --install"
        case .emptyGraph:
            return "Cannot compile an empty graph"
        case .validationFailed(let errors):
            return "Graph validation failed: \(errors.map(\.description).joined(separator: "; "))"
        }
    }
}

// MARK: - GeneratedPlugin

struct GeneratedPlugin {
    let name: String
    let dspKernelCode: String
    let auWrapperCode: String
    let infoPlist: String
    let category: PluginCategory

    /// All generated source files as (filename, content) pairs
    var sourceFiles: [(name: String, content: String)] {
        [
            ("\(safeName)DSPKernel.swift", dspKernelCode),
            ("\(safeName)AudioUnit.swift", auWrapperCode),
        ]
    }

    /// Plugin name sanitized for use as a Swift identifier
    var safeName: String {
        PluginCompiler.sanitizeIdentifier(name)
    }
}

// MARK: - PluginCompiler

class PluginCompiler {

    /// Manufacturer FourCC for generated plugins
    let manufacturerCode = "MgDw"

    /// Bundle ID prefix
    let bundleIdPrefix = "com.magicdaw.plugin"

    // MARK: - Public API

    /// Generate Swift source code for an AUv3 plugin from a node graph definition.
    func compile(_ graph: NodeGraphDefinition) throws -> GeneratedPlugin {
        // 1. Validate
        try validateGraph(graph)

        // 2. Topological sort for processing order
        let sortedNodeIds = try topologicalSort(graph)

        // 3. Generate DSP kernel code
        let dspCode = generateDSPKernel(graph: graph, sortOrder: sortedNodeIds)

        // 4. Generate AUv3 wrapper code
        let auCode = generateAUWrapper(graph: graph)

        // 5. Generate Info.plist
        let plist = generateInfoPlist(graph: graph)

        return GeneratedPlugin(
            name: graph.metadata.name,
            dspKernelCode: dspCode,
            auWrapperCode: auCode,
            infoPlist: plist,
            category: graph.metadata.category
        )
    }

    /// Compile a graph and write to a single file (convenience for quick export)
    func compile(graph: NodeGraphDefinition, to url: URL) throws {
        let plugin = try compile(graph)
        let combined = plugin.dspKernelCode + "\n\n" + plugin.auWrapperCode
        try combined.write(to: url, atomically: true, encoding: .utf8)
    }

    /// Build the generated plugin into an .appex bundle using swiftc.
    func buildPlugin(_ plugin: GeneratedPlugin, outputDir: URL) async throws -> URL {
        let fm = FileManager.default

        // Verify toolchain
        let swiftcURL = URL(fileURLWithPath: "/usr/bin/swiftc")
        guard fm.fileExists(atPath: swiftcURL.path) else {
            throw CompilerError.noXcodeToolchain
        }

        // Create build directory
        let buildDir = outputDir.appendingPathComponent("build-\(plugin.safeName)", isDirectory: true)
        let sourcesDir = buildDir.appendingPathComponent("Sources", isDirectory: true)
        try fm.createDirectory(at: sourcesDir, withIntermediateDirectories: true)

        // Write source files
        for (filename, content) in plugin.sourceFiles {
            let fileURL = sourcesDir.appendingPathComponent(filename)
            try content.write(to: fileURL, atomically: true, encoding: .utf8)
        }

        // Write Info.plist
        let plistURL = buildDir.appendingPathComponent("Info.plist")
        try plugin.infoPlist.write(to: plistURL, atomically: true, encoding: .utf8)

        // Build the .appex bundle structure
        let outputName = "\(plugin.safeName).appex"
        let appexDir = outputDir.appendingPathComponent(outputName, isDirectory: true)
        let contentsDir = appexDir.appendingPathComponent("Contents", isDirectory: true)
        let macosDir = contentsDir.appendingPathComponent("MacOS", isDirectory: true)
        try fm.createDirectory(at: macosDir, withIntermediateDirectories: true)

        // Copy Info.plist
        let destPlist = contentsDir.appendingPathComponent("Info.plist")
        if fm.fileExists(atPath: destPlist.path) {
            try fm.removeItem(at: destPlist)
        }
        try fm.copyItem(at: plistURL, to: destPlist)

        // Compile with swiftc
        let sourceFilePaths = plugin.sourceFiles.map {
            sourcesDir.appendingPathComponent($0.name).path
        }

        let binaryPath = macosDir.appendingPathComponent(plugin.safeName).path

        // Discover SDK path dynamically
        let sdkProcess = Process()
        sdkProcess.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        sdkProcess.arguments = ["--show-sdk-path", "--sdk", "macosx"]
        let sdkPipe = Pipe()
        sdkProcess.standardOutput = sdkPipe
        try sdkProcess.run()
        sdkProcess.waitUntilExit()
        let sdkPath = String(data: sdkPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"

        let process = Process()
        process.executableURL = swiftcURL
        process.arguments = sourceFilePaths + [
            "-module-name", plugin.safeName,
            "-target", "arm64-apple-macos14.0",
            "-sdk", sdkPath,
            "-framework", "AudioToolbox",
            "-framework", "AVFoundation",
            "-framework", "CoreAudioKit",
            "-framework", "Accelerate",
            "-emit-library",
            "-o", binaryPath,
        ]

        let pipe = Pipe()
        process.standardError = pipe
        process.standardOutput = pipe

        try process.run()
        process.waitUntilExit()

        if process.terminationStatus != 0 {
            let errorData = pipe.fileHandleForReading.readDataToEndOfFile()
            let errorOutput = String(data: errorData, encoding: .utf8) ?? "Unknown error"
            throw CompilerError.buildFailed(errorOutput)
        }

        // Clean up build directory
        try? fm.removeItem(at: buildDir)

        return appexDir
    }

    // MARK: - Validation

    private func validateGraph(_ graph: NodeGraphDefinition) throws {
        guard !graph.nodes.isEmpty else {
            throw CompilerError.emptyGraph
        }

        // Run structural validation
        let errors = graph.validate()
        if !errors.isEmpty {
            throw CompilerError.validationFailed(errors)
        }

        // Must have exactly one output node
        let outputNodes = graph.nodes.filter { $0.type == "output" }
        guard outputNodes.count == 1 else {
            throw CompilerError.missingOutputNode
        }

        // All node types must be known
        for node in graph.nodes {
            if DSPNodeRegistry.template(for: node.type) == nil {
                throw CompilerError.invalidNodeType(node.type)
            }
        }

        // All connections must reference existing nodes and valid ports
        let nodeIds = Set(graph.nodes.map(\.id))
        for conn in graph.connections {
            if !nodeIds.contains(conn.fromNode) {
                throw CompilerError.invalidConnection("Source node '\(conn.fromNode)' does not exist")
            }
            if !nodeIds.contains(conn.toNode) {
                throw CompilerError.invalidConnection("Target node '\(conn.toNode)' does not exist")
            }
        }

        // Output node must have at least one incoming connection
        let outputNodeId = outputNodes[0].id
        let outputConnections = graph.connections.filter { $0.toNode == outputNodeId }
        if outputConnections.isEmpty {
            throw CompilerError.unconnectedOutputNode
        }
    }

    // MARK: - Topological Sort (Kahn's algorithm)

    private func topologicalSort(_ graph: NodeGraphDefinition) throws -> [String] {
        var inDegree: [String: Int] = [:]
        var adjacency: [String: [String]] = [:]

        for node in graph.nodes {
            inDegree[node.id] = 0
            adjacency[node.id] = []
        }

        for conn in graph.connections {
            adjacency[conn.fromNode, default: []].append(conn.toNode)
            inDegree[conn.toNode, default: 0] += 1
        }

        // Start with nodes that have no incoming edges (sources)
        var queue: [String] = graph.nodes
            .filter { (inDegree[$0.id] ?? 0) == 0 }
            .map(\.id)
        var sorted: [String] = []

        while !queue.isEmpty {
            let nodeId = queue.removeFirst()
            sorted.append(nodeId)

            for neighbor in adjacency[nodeId] ?? [] {
                inDegree[neighbor, default: 0] -= 1
                if inDegree[neighbor] == 0 {
                    queue.append(neighbor)
                }
            }
        }

        if sorted.count != graph.nodes.count {
            throw CompilerError.cyclicGraph
        }

        return sorted
    }

    // MARK: - DSP Kernel Code Generation

    private func generateDSPKernel(graph: NodeGraphDefinition, sortOrder: [String]) -> String {
        let safeName = Self.sanitizeIdentifier(graph.metadata.name)
        let nodeMap = Dictionary(uniqueKeysWithValues: graph.nodes.map { ($0.id, $0) })
        let exposedParams = graph.exposedParameters
        let isInstrument = graph.metadata.category == .instrument

        var code = """
        // Auto-generated by Magic DAW Plugin Compiler
        // DSP Kernel for: \(graph.metadata.name)
        // Generated: \(ISO8601DateFormatter().string(from: Date()))
        //
        // DO NOT EDIT — this file is regenerated from the node graph.

        import Foundation
        import Accelerate

        final class \(safeName)DSPKernel {

            // MARK: - Properties

            var sampleRate: Double = 44100.0
            private var isPlaying: Bool = false

        """

        // Declare per-node state variables
        for nodeId in sortOrder {
            guard let node = nodeMap[nodeId] else { continue }
            code += generateNodeStateDeclarations(node: node, nodeId: nodeId)
        }

        // Declare output buffers for each node
        code += "\n    // Node output buffers\n"
        for nodeId in sortOrder {
            let safeId = safeId(nodeId)
            code += "    private var buf_\(safeId) = [Float]()\n"
        }

        // Exposed parameter storage
        if !exposedParams.isEmpty {
            code += "\n    // Exposed parameters\n"
            for (nodeId, param) in exposedParams {
                let sid = safeId(nodeId)
                code += "    var param_\(sid)_\(param.name): Float = \(Float(param.value))\n"
            }
        }

        // Note state for instruments
        if isInstrument {
            code += """

                // Note state
                private var currentFrequency: Float = 440.0
                private var currentVelocity: Float = 0.0
                private var gateOpen: Bool = false

            """
        }

        // MARK: - Init / Setup

        code += """

            // MARK: - Setup

            init(sampleRate: Double) {
                self.sampleRate = sampleRate
            }

            func prepare(maxFrames: Int) {

        """

        for nodeId in sortOrder {
            let sid = safeId(nodeId)
            code += "        buf_\(sid) = [Float](repeating: 0, count: maxFrames)\n"
        }

        for nodeId in sortOrder {
            guard let node = nodeMap[nodeId] else { continue }
            code += generateNodeSetup(node: node, nodeId: nodeId)
        }

        code += "    }\n"

        // MARK: - Deallocate

        code += """

            func deallocate() {
        """
        for nodeId in sortOrder {
            let sid = safeId(nodeId)
            code += "        buf_\(sid) = []\n"
        }
        code += "    }\n"

        // MARK: - Parameter access

        code += """

            func setParameter(address: AUParameterAddress, value: AUValue) {
                switch address {

        """
        for (idx, (nodeId, param)) in exposedParams.enumerated() {
            let sid = safeId(nodeId)
            code += "            case \(idx): param_\(sid)_\(param.name) = value\n"
        }
        code += """
                default: break
                }
            }

            func getParameter(address: AUParameterAddress) -> AUValue {
                switch address {

        """
        for (idx, (nodeId, param)) in exposedParams.enumerated() {
            let sid = safeId(nodeId)
            code += "            case \(idx): return param_\(sid)_\(param.name)\n"
        }
        code += """
                default: return 0
                }
            }

        """

        // MARK: - Render

        code += """

            // MARK: - Render

            func render(frameCount: Int, outputData: UnsafeMutablePointer<AudioBufferList>) {
                let ablPointer = UnsafeMutableAudioBufferListPointer(outputData)
                guard let outputLeft = ablPointer[0].mData?.assumingMemoryBound(to: Float.self) else { return }
                let outputRight: UnsafeMutablePointer<Float>?
                if ablPointer.count > 1 {
                    outputRight = ablPointer[1].mData?.assumingMemoryBound(to: Float.self)
                } else {
                    outputRight = nil
                }

                process(frameCount: frameCount, outputLeft: outputLeft, outputRight: outputRight)
            }

            private func process(frameCount: Int, outputLeft: UnsafeMutablePointer<Float>, outputRight: UnsafeMutablePointer<Float>?) {

        """

        // Process each node in topological order
        for nodeId in sortOrder {
            guard let node = nodeMap[nodeId] else { continue }
            let incoming = graph.connections.filter { $0.toNode == nodeId }

            code += "\n        // --- \(node.type) [\(nodeId)] ---\n"
            code += generateNodeProcessing(node: node, nodeId: nodeId, graph: graph)
        }

        // Copy output node buffer to output pointers
        let outputNodeId = graph.nodes.first { $0.type == "output" }!.id
        let outputSafe = safeId(outputNodeId)
        let outputGain = graph.nodes.first { $0.type == "output" }?.parameterValue("gain") ?? 1.0

        code += """

                // Copy to output with gain
                buf_\(outputSafe).withUnsafeBufferPointer { src in
                    guard let srcBase = src.baseAddress else { return }
                    var gain: Float = \(Float(outputGain))
                    vDSP_vsmul(srcBase, 1, &gain, outputLeft, 1, vDSP_Length(frameCount))
                    if let outputRight {
                        vDSP_vsmul(srcBase, 1, &gain, outputRight, 1, vDSP_Length(frameCount))
                    }
                }
            }

        """

        // MARK: - Note handling (instruments)

        if isInstrument {
            code += """

                // MARK: - Note Handling

                func noteOn(note: UInt8, velocity: UInt8) {
                    currentFrequency = 440.0 * powf(2.0, (Float(note) - 69.0) / 12.0)
                    currentVelocity = Float(velocity) / 127.0
                    gateOpen = true
                }

                func noteOff(note: UInt8) {
                    gateOpen = false
                }

                func pitchBend(_ semitones: Float) {
                    let ratio = powf(2.0, semitones / 12.0)
                    currentFrequency *= ratio
                }

            """
        }

        // MARK: - Reset

        code += """

            // MARK: - Reset

            func reset() {
        """

        for nodeId in sortOrder {
            let sid = safeId(nodeId)
            code += "        if !buf_\(sid).isEmpty { buf_\(sid) = [Float](repeating: 0, count: buf_\(sid).count) }\n"
        }

        for nodeId in sortOrder {
            guard let node = nodeMap[nodeId] else { continue }
            code += generateNodeReset(node: node, nodeId: nodeId)
        }

        if isInstrument {
            code += "        gateOpen = false\n"
            code += "        currentVelocity = 0\n"
        }

        code += """
            }
        }

        """

        return code
    }

    // MARK: - Per-Node State Declarations

    private func generateNodeStateDeclarations(node: NodeDefinition, nodeId: String) -> String {
        let safe = safeId(nodeId)
        var code = ""

        switch node.type {
        case "oscillator", "subOscillator":
            code += "    private var phase_\(safe): Float = 0.0\n"
        case "wavetable":
            code += "    private var phase_\(safe): Float = 0.0\n"
            code += "    private var wavetable_\(safe) = [Float](repeating: 0, count: 2048)\n"
        case "noise":
            code += "    private var pinkState_\(safe) = [Float](repeating: 0, count: 7)\n"
            code += "    private var brownState_\(safe): Float = 0.0\n"
        case "lowpass", "highpass", "bandpass", "notch":
            code += "    private var bq_z1_\(safe): Float = 0.0\n"
            code += "    private var bq_z2_\(safe): Float = 0.0\n"
            code += "    private var bq_a0_\(safe): Float = 1.0\n"
            code += "    private var bq_a1_\(safe): Float = 0.0\n"
            code += "    private var bq_a2_\(safe): Float = 0.0\n"
            code += "    private var bq_b1_\(safe): Float = 0.0\n"
            code += "    private var bq_b2_\(safe): Float = 0.0\n"
        case "comb":
            code += "    private var combBuffer_\(safe) = [Float](repeating: 0, count: 4096)\n"
            code += "    private var combIndex_\(safe): Int = 0\n"
        case "adsr":
            code += "    private var envState_\(safe): Int = 0\n"     // 0=idle,1=A,2=D,3=S,4=R
            code += "    private var envLevel_\(safe): Float = 0.0\n"
        case "multiStageEnvelope":
            code += "    private var msEnvStage_\(safe): Int = 0\n"
            code += "    private var msEnvLevel_\(safe): Float = 0.0\n"
            code += "    private var msEnvSampleCount_\(safe): Int = 0\n"
        case "lfo":
            code += "    private var lfoPhase_\(safe): Float = 0.0\n"
        case "delay":
            code += "    private var delayBuffer_\(safe) = [Float](repeating: 0, count: 220500)\n"
            code += "    private var delayWriteIdx_\(safe): Int = 0\n"
        case "reverb":
            code += "    private var revComb_\(safe) = [[Float]](repeating: [Float](repeating: 0, count: 4096), count: 4)\n"
            code += "    private var revCombIdx_\(safe) = [Int](repeating: 0, count: 4)\n"
            code += "    private var revAP_\(safe) = [[Float]](repeating: [Float](repeating: 0, count: 1024), count: 2)\n"
            code += "    private var revAPIdx_\(safe) = [Int](repeating: 0, count: 2)\n"
        case "chorus":
            code += "    private var chorusBuffer_\(safe) = [Float](repeating: 0, count: 8192)\n"
            code += "    private var chorusWriteIdx_\(safe): Int = 0\n"
            code += "    private var chorusLfoPhase_\(safe): Float = 0.0\n"
        case "distortion":
            break // stateless
        case "bitcrusher":
            code += "    private var crushHold_\(safe): Float = 0.0\n"
            code += "    private var crushCounter_\(safe): Int = 0\n"
        case "phaser":
            code += "    private var phaserAP_\(safe) = [Float](repeating: 0, count: 12)\n"
            code += "    private var phaserLfoPhase_\(safe): Float = 0.0\n"
        case "flanger":
            code += "    private var flangerBuffer_\(safe) = [Float](repeating: 0, count: 4096)\n"
            code += "    private var flangerWriteIdx_\(safe): Int = 0\n"
            code += "    private var flangerLfoPhase_\(safe): Float = 0.0\n"
        default:
            break
        }

        return code
    }

    // MARK: - Per-Node Setup

    private func generateNodeSetup(node: NodeDefinition, nodeId: String) -> String {
        let safe = safeId(nodeId)
        var code = ""

        switch node.type {
        case "wavetable":
            let size = Int(node.parameterValue("tableSize") ?? 2048)
            code += """
                    // Initialize wavetable_\(safe)
                    wavetable_\(safe) = [Float](repeating: 0, count: \(size))
                    for i in 0..<\(size) {
                        let phase = Float(i) / Float(\(size)) * 2.0 * .pi
                        wavetable_\(safe)[i] = sin(phase)
                    }

            """
        case "delay":
            code += "        delayBuffer_\(safe) = [Float](repeating: 0, count: Int(sampleRate * 5))\n"
        default:
            break
        }

        return code
    }

    // MARK: - Per-Node Processing

    private func generateNodeProcessing(node: NodeDefinition, nodeId: String, graph: NodeGraphDefinition) -> String {
        let safe = safeId(nodeId)
        let incoming = graph.connections.filter { $0.toNode == nodeId }
        let isInstrument = graph.metadata.category == .instrument

        // Helper to find the source buffer for an input port
        func sourceBuffer(for port: String) -> String? {
            guard let conn = incoming.first(where: { $0.toPort == port }) else { return nil }
            return "buf_\(safeId(conn.fromNode))"
        }

        // Helper to get parameter value — uses exposed param var if exposed, else literal
        func paramVal(_ name: String) -> String {
            let param = node.parameters.first { $0.name == name }
            if param?.isExposed == true {
                return "param_\(safe)_\(name)"
            }
            return "\(Float(param?.value ?? 0))"
        }

        var code = ""

        switch node.type {

        // ───────────────── OSCILLATOR ─────────────────
        case "oscillator":
            let freqSource = sourceBuffer(for: "frequency")
            let ampSource = sourceBuffer(for: "amplitude")

            code += """
                    do {
                        let waveform = Int(\(paramVal("waveform")))
                        let baseFreq: Float = \(freqSource != nil ? "0" : paramVal("frequency"))
                        let baseAmp: Float = \(ampSource != nil ? "1.0" : paramVal("amplitude"))
                        let detuneCents: Float = \(paramVal("detune"))
                        let pw: Float = \(paramVal("pulseWidth"))
                        let detuneRatio = powf(2.0, detuneCents / 1200.0)

                        for i in 0..<frameCount {
                            var freq = \(isInstrument ? "currentFrequency" : "baseFreq")
            \(freqSource.map { "                freq += \($0)[i]" } ?? "")
                            freq *= detuneRatio
                            var amp = baseAmp\(isInstrument ? " * currentVelocity" : "")
            \(ampSource.map { "                amp *= \($0)[i]" } ?? "")

                            let phaseInc = freq / Float(sampleRate)
                            var sample: Float = 0

                            switch waveform {
                            case 0: // Sine
                                sample = sinf(phase_\(safe) * 2.0 * .pi)
                            case 1: // Sawtooth (PolyBLEP anti-aliased)
                                let t = phase_\(safe)
                                sample = 2.0 * t - 1.0
                                if t < phaseInc {
                                    let b = t / phaseInc
                                    sample -= (2.0 * b - b * b - 1.0)
                                } else if t > 1.0 - phaseInc {
                                    let b = (t - 1.0 + phaseInc) / phaseInc
                                    sample += (2.0 * b - b * b - 1.0)
                                }
                            case 2: // Square (PolyBLEP anti-aliased)
                                sample = phase_\(safe) < pw ? 1.0 : -1.0
                                let t = phase_\(safe)
                                if t < phaseInc {
                                    let b = t / phaseInc
                                    sample += (2.0 * b - b * b - 1.0)
                                } else if t > pw - phaseInc && t < pw + phaseInc {
                                    let b = (t - pw) / phaseInc
                                    sample -= (2.0 * b - b * b - 1.0)
                                }
                            case 3: // Triangle
                                sample = 2.0 * abs(2.0 * phase_\(safe) - 1.0) - 1.0
                            default:
                                sample = sinf(phase_\(safe) * 2.0 * .pi)
                            }

                            buf_\(safe)[i] = sample * amp
                            phase_\(safe) += phaseInc
                            if phase_\(safe) >= 1.0 { phase_\(safe) -= 1.0 }
                        }
                    }

            """

        // ───────────────── SUB OSCILLATOR ─────────────────
        case "subOscillator":
            code += """
                    do {
                        let waveform = Int(\(paramVal("waveform")))
                        let octaveShift: Float = \(paramVal("octave"))
                        let amp: Float = \(paramVal("amplitude"))\(isInstrument ? " * currentVelocity" : "")
                        let baseFreq: Float = \(isInstrument ? "currentFrequency" : paramVal("frequency"))
                        let freq = baseFreq * powf(2.0, octaveShift)

                        for i in 0..<frameCount {
                            let phaseInc = freq / Float(sampleRate)
                            let sample: Float
                            switch waveform {
                            case 0: sample = sinf(phase_\(safe) * 2.0 * .pi)
                            case 1: sample = phase_\(safe) < 0.5 ? 1.0 : -1.0
                            default: sample = sinf(phase_\(safe) * 2.0 * .pi)
                            }
                            buf_\(safe)[i] = sample * amp
                            phase_\(safe) += phaseInc
                            if phase_\(safe) >= 1.0 { phase_\(safe) -= 1.0 }
                        }
                    }

            """

        // ───────────────── NOISE ─────────────────
        case "noise":
            code += """
                    do {
                        let noiseType = Int(\(paramVal("noiseType")))
                        let amp: Float = \(paramVal("amplitude"))

                        for i in 0..<frameCount {
                            let white = Float.random(in: -1.0...1.0)
                            let sample: Float
                            switch noiseType {
                            case 0: // White
                                sample = white
                            case 1: // Pink (Paul Kellet approximation)
                                pinkState_\(safe)[0] = 0.99886 * pinkState_\(safe)[0] + white * 0.0555179
                                pinkState_\(safe)[1] = 0.99332 * pinkState_\(safe)[1] + white * 0.0750759
                                pinkState_\(safe)[2] = 0.96900 * pinkState_\(safe)[2] + white * 0.1538520
                                pinkState_\(safe)[3] = 0.86650 * pinkState_\(safe)[3] + white * 0.3104856
                                pinkState_\(safe)[4] = 0.55000 * pinkState_\(safe)[4] + white * 0.5329522
                                pinkState_\(safe)[5] = -0.7616 * pinkState_\(safe)[5] - white * 0.0168980
                                let pink = pinkState_\(safe)[0] + pinkState_\(safe)[1] + pinkState_\(safe)[2]
                                         + pinkState_\(safe)[3] + pinkState_\(safe)[4] + pinkState_\(safe)[5]
                                         + pinkState_\(safe)[6] + white * 0.5362
                                pinkState_\(safe)[6] = white * 0.115926
                                sample = pink * 0.11
                            case 2: // Brown (red noise)
                                brownState_\(safe) += white * 0.02
                                brownState_\(safe) = max(-1.0, min(1.0, brownState_\(safe)))
                                sample = brownState_\(safe) * 3.5
                            default:
                                sample = white
                            }
                            buf_\(safe)[i] = sample * amp
                        }
                    }

            """

        // ───────────────── WAVETABLE ─────────────────
        case "wavetable":
            code += """
                    do {
                        let amp: Float = \(paramVal("amplitude"))
                        let freq: Float = \(isInstrument ? "currentFrequency" : paramVal("frequency"))
                        let tableSize = wavetable_\(safe).count

                        for i in 0..<frameCount {
                            let phaseInc = freq / Float(sampleRate)
                            let tablePos = phase_\(safe) * Float(tableSize)
                            let idx0 = Int(tablePos) % tableSize
                            let idx1 = (idx0 + 1) % tableSize
                            let frac = tablePos - floorf(tablePos)
                            let sample = wavetable_\(safe)[idx0] * (1.0 - frac) + wavetable_\(safe)[idx1] * frac
                            buf_\(safe)[i] = sample * amp
                            phase_\(safe) += phaseInc
                            if phase_\(safe) >= 1.0 { phase_\(safe) -= 1.0 }
                        }
                    }

            """

        // ───────────────── BIQUAD FILTERS ─────────────────
        case "lowpass", "highpass", "bandpass", "notch":
            let audioSource = sourceBuffer(for: "audio") ?? "buf_\(safe)"

            code += """
                    do {
                        let cutoff: Float = \(paramVal("cutoff"))
                        let Q: Float = 0.5 + \(paramVal("resonance")) * 19.5

                        // Biquad coefficient calculation
                        let omega = 2.0 * Float.pi * cutoff / Float(sampleRate)
                        let sinOmega = sinf(omega)
                        let cosOmega = cosf(omega)
                        let alpha = sinOmega / (2.0 * Q)

            """

            // Compute filter-specific coefficients
            switch node.type {
            case "lowpass":
                code += "            let b0 = (1.0 - cosOmega) / 2.0\n"
                code += "            let b1_c = 1.0 - cosOmega\n"
                code += "            let b2 = (1.0 - cosOmega) / 2.0\n"
            case "highpass":
                code += "            let b0 = (1.0 + cosOmega) / 2.0\n"
                code += "            let b1_c = -(1.0 + cosOmega)\n"
                code += "            let b2 = (1.0 + cosOmega) / 2.0\n"
            case "bandpass":
                code += "            let b0 = alpha\n"
                code += "            let b1_c: Float = 0.0\n"
                code += "            let b2 = -alpha\n"
            case "notch":
                code += "            let b0: Float = 1.0\n"
                code += "            let b1_c = -2.0 * cosOmega\n"
                code += "            let b2: Float = 1.0\n"
            default: break
            }

            code += """
                        let a0 = 1.0 + alpha
                        let a1_c = -2.0 * cosOmega
                        let a2 = 1.0 - alpha

                        bq_a0_\(safe) = b0 / a0
                        bq_a1_\(safe) = b1_c / a0
                        bq_a2_\(safe) = b2 / a0
                        bq_b1_\(safe) = a1_c / a0
                        bq_b2_\(safe) = a2 / a0

                        // Transposed direct form II
                        for i in 0..<frameCount {
                            let input = \(audioSource)[i]
                            let output = bq_a0_\(safe) * input + bq_z1_\(safe)
                            bq_z1_\(safe) = bq_a1_\(safe) * input - bq_b1_\(safe) * output + bq_z2_\(safe)
                            bq_z2_\(safe) = bq_a2_\(safe) * input - bq_b2_\(safe) * output
                            buf_\(safe)[i] = output
                        }
                    }

            """

        // ───────────────── COMB FILTER ─────────────────
        case "comb":
            let audioSource = sourceBuffer(for: "audio") ?? "buf_\(safe)"
            code += """
                    do {
                        let freq: Float = \(paramVal("frequency"))
                        let feedback: Float = \(paramVal("feedback"))
                        let damping: Float = \(paramVal("damping"))
                        let delaySamples = max(1, Int(Float(sampleRate) / freq))

                        for i in 0..<frameCount {
                            let readIdx = (combIndex_\(safe) - delaySamples + combBuffer_\(safe).count) % combBuffer_\(safe).count
                            let delayed = combBuffer_\(safe)[readIdx]
                            let output = \(audioSource)[i] + delayed * feedback * (1.0 - damping)
                            combBuffer_\(safe)[combIndex_\(safe)] = output
                            combIndex_\(safe) = (combIndex_\(safe) + 1) % combBuffer_\(safe).count
                            buf_\(safe)[i] = output
                        }
                    }

            """

        // ───────────────── ADSR ENVELOPE ─────────────────
        case "adsr":
            code += """
                    do {
                        let attackTime = \(paramVal("attack")) / 1000.0
                        let decayTime = \(paramVal("decay")) / 1000.0
                        let sustainLevel: Float = \(paramVal("sustain"))
                        let releaseTime = \(paramVal("release")) / 1000.0
                        let sr = Float(sampleRate)
                        let attackRate = attackTime > 0 ? 1.0 / (attackTime * sr) : 1.0
                        let decayRate = decayTime > 0 ? (1.0 - sustainLevel) / (decayTime * sr) : 1.0
                        let releaseRate = releaseTime > 0 ? sustainLevel / (releaseTime * sr) : 1.0

                        for i in 0..<frameCount {
                            if gateOpen && envState_\(safe) == 0 {
                                envState_\(safe) = 1
                            } else if !gateOpen && envState_\(safe) != 0 && envState_\(safe) != 4 {
                                envState_\(safe) = 4
                            }

                            switch envState_\(safe) {
                            case 1: // Attack
                                envLevel_\(safe) += attackRate
                                if envLevel_\(safe) >= 1.0 { envLevel_\(safe) = 1.0; envState_\(safe) = 2 }
                            case 2: // Decay
                                envLevel_\(safe) -= decayRate
                                if envLevel_\(safe) <= sustainLevel { envLevel_\(safe) = sustainLevel; envState_\(safe) = 3 }
                            case 3: // Sustain
                                envLevel_\(safe) = sustainLevel
                            case 4: // Release
                                envLevel_\(safe) -= releaseRate
                                if envLevel_\(safe) <= 0 { envLevel_\(safe) = 0; envState_\(safe) = 0 }
                            default:
                                envLevel_\(safe) = 0
                            }

                            buf_\(safe)[i] = envLevel_\(safe)
                        }
                    }

            """

        // ───────────────── MULTI-STAGE ENVELOPE ─────────────────
        case "multiStageEnvelope":
            code += """
                    do {
                        let times: [Float] = [\(paramVal("time1")) / 1000.0, \(paramVal("time2")) / 1000.0, \(paramVal("time3")) / 1000.0]
                        let levels: [Float] = [\(paramVal("level1")), \(paramVal("level2")), \(paramVal("level3"))]
                        let relTime = \(paramVal("releaseTime")) / 1000.0
                        let stageCount = min(Int(\(paramVal("stages"))), times.count)
                        let sr = Float(sampleRate)

                        for i in 0..<frameCount {
                            if gateOpen && msEnvStage_\(safe) == 0 {
                                msEnvStage_\(safe) = 1; msEnvSampleCount_\(safe) = 0
                            } else if !gateOpen && msEnvStage_\(safe) > 0 && msEnvStage_\(safe) <= stageCount {
                                msEnvStage_\(safe) = stageCount + 1; msEnvSampleCount_\(safe) = 0
                            }

                            if msEnvStage_\(safe) > 0 && msEnvStage_\(safe) <= stageCount {
                                let idx = msEnvStage_\(safe) - 1
                                let targetLevel = levels[idx]
                                let stageSamples = Int(times[idx] * sr)
                                if stageSamples > 0 {
                                    let progress = Float(msEnvSampleCount_\(safe)) / Float(stageSamples)
                                    let prevLevel = idx == 0 ? Float(0) : levels[idx - 1]
                                    msEnvLevel_\(safe) = prevLevel + (targetLevel - prevLevel) * min(progress, 1.0)
                                }
                                msEnvSampleCount_\(safe) += 1
                                if msEnvSampleCount_\(safe) >= stageSamples && msEnvStage_\(safe) < stageCount {
                                    msEnvStage_\(safe) += 1; msEnvSampleCount_\(safe) = 0
                                }
                            } else if msEnvStage_\(safe) == stageCount + 1 {
                                let relSamples = Int(relTime * sr)
                                if relSamples > 0 { msEnvLevel_\(safe) -= msEnvLevel_\(safe) / Float(relSamples) }
                                if msEnvLevel_\(safe) <= 0.001 { msEnvLevel_\(safe) = 0; msEnvStage_\(safe) = 0 }
                            }
                            buf_\(safe)[i] = msEnvLevel_\(safe)
                        }
                    }

            """

        // ───────────────── LFO ─────────────────
        case "lfo":
            code += """
                    do {
                        let waveform = Int(\(paramVal("waveform")))
                        let rate: Float = \(paramVal("rate"))
                        let depth: Float = \(paramVal("depth"))
                        let sr = Float(sampleRate)

                        for i in 0..<frameCount {
                            let phaseInc = rate / sr
                            var sample: Float
                            switch waveform {
                            case 0: sample = sinf(lfoPhase_\(safe) * 2.0 * .pi)
                            case 1: sample = 2.0 * lfoPhase_\(safe) - 1.0
                            case 2: sample = lfoPhase_\(safe) < 0.5 ? 1.0 : -1.0
                            case 3: sample = 2.0 * abs(2.0 * lfoPhase_\(safe) - 1.0) - 1.0
                            case 4: // Sample & Hold
                                if lfoPhase_\(safe) + phaseInc >= 1.0 {
                                    sample = Float.random(in: -1.0...1.0)
                                } else {
                                    sample = i > 0 ? buf_\(safe)[i - 1] : 0
                                }
                            default: sample = sinf(lfoPhase_\(safe) * 2.0 * .pi)
                            }
                            buf_\(safe)[i] = sample * depth
                            lfoPhase_\(safe) += phaseInc
                            if lfoPhase_\(safe) >= 1.0 { lfoPhase_\(safe) -= 1.0 }
                        }
                    }

            """

        // ───────────────── DELAY ─────────────────
        case "delay":
            let audioSource = sourceBuffer(for: "audio") ?? "buf_\(safe)"
            code += """
                    do {
                        let delayMs: Float = \(paramVal("time"))
                        let feedback: Float = \(paramVal("feedback"))
                        let mix: Float = \(paramVal("mix"))
                        let delaySamples = Int(delayMs * 0.001 * Float(sampleRate))
                        let bufLen = delayBuffer_\(safe).count

                        for i in 0..<frameCount {
                            let readIdx = (delayWriteIdx_\(safe) - delaySamples + bufLen) % bufLen
                            let delayed = delayBuffer_\(safe)[readIdx]
                            let input = \(audioSource)[i]
                            delayBuffer_\(safe)[delayWriteIdx_\(safe)] = input + delayed * feedback
                            delayWriteIdx_\(safe) = (delayWriteIdx_\(safe) + 1) % bufLen
                            buf_\(safe)[i] = input * (1.0 - mix) + delayed * mix
                        }
                    }

            """

        // ───────────────── REVERB (Schroeder) ─────────────────
        case "reverb":
            let audioSource = sourceBuffer(for: "audio") ?? "buf_\(safe)"
            code += """
                    do {
                        let roomSize: Float = \(paramVal("roomSize"))
                        let damping: Float = \(paramVal("damping"))
                        let mix: Float = \(paramVal("mix"))
                        let combLengths = [1116, 1188, 1277, 1356]
                        let apLengths = [556, 441]

                        for i in 0..<frameCount {
                            let input = \(audioSource)[i]
                            var wet: Float = 0.0

                            for c in 0..<4 {
                                let len = Int(Float(combLengths[c]) * (0.5 + roomSize * 0.5))
                                let readIdx = (revCombIdx_\(safe)[c] - len + revComb_\(safe)[c].count) % revComb_\(safe)[c].count
                                let delayed = revComb_\(safe)[c][readIdx]
                                let fb = roomSize * 0.85
                                revComb_\(safe)[c][revCombIdx_\(safe)[c]] = input + delayed * fb * (1.0 - damping * 0.4)
                                revCombIdx_\(safe)[c] = (revCombIdx_\(safe)[c] + 1) % revComb_\(safe)[c].count
                                wet += delayed
                            }
                            wet *= 0.25

                            for a in 0..<2 {
                                let len = apLengths[a]
                                let readIdx = (revAPIdx_\(safe)[a] - len + revAP_\(safe)[a].count) % revAP_\(safe)[a].count
                                let delayed = revAP_\(safe)[a][readIdx]
                                let apFb: Float = 0.5
                                revAP_\(safe)[a][revAPIdx_\(safe)[a]] = wet + delayed * apFb
                                wet = delayed - wet * apFb
                                revAPIdx_\(safe)[a] = (revAPIdx_\(safe)[a] + 1) % revAP_\(safe)[a].count
                            }

                            buf_\(safe)[i] = input * (1.0 - mix) + wet * mix
                        }
                    }

            """

        // ───────────────── CHORUS ─────────────────
        case "chorus":
            let audioSource = sourceBuffer(for: "audio") ?? "buf_\(safe)"
            code += """
                    do {
                        let rate: Float = \(paramVal("rate"))
                        let depth: Float = \(paramVal("depth"))
                        let mix: Float = \(paramVal("mix"))
                        let feedback: Float = \(paramVal("feedback"))
                        let maxDelay: Float = 0.03
                        let bufLen = chorusBuffer_\(safe).count

                        for i in 0..<frameCount {
                            let input = \(audioSource)[i]
                            let lfoVal = sinf(chorusLfoPhase_\(safe) * 2.0 * .pi) * 0.5 + 0.5
                            let delaySamples = (0.001 + lfoVal * depth * maxDelay) * Float(sampleRate)
                            let readPos = Float(chorusWriteIdx_\(safe)) - delaySamples
                            var readIdx = Int(readPos) % bufLen
                            if readIdx < 0 { readIdx += bufLen }
                            let delayed = chorusBuffer_\(safe)[readIdx]

                            chorusBuffer_\(safe)[chorusWriteIdx_\(safe)] = input + delayed * feedback
                            chorusWriteIdx_\(safe) = (chorusWriteIdx_\(safe) + 1) % bufLen

                            buf_\(safe)[i] = input * (1.0 - mix) + delayed * mix
                            chorusLfoPhase_\(safe) += rate / Float(sampleRate)
                            if chorusLfoPhase_\(safe) >= 1.0 { chorusLfoPhase_\(safe) -= 1.0 }
                        }
                    }

            """

        // ───────────────── DISTORTION ─────────────────
        case "distortion":
            let audioSource = sourceBuffer(for: "audio") ?? "buf_\(safe)"
            code += """
                    do {
                        let drive: Float = \(paramVal("drive"))
                        let mix: Float = \(paramVal("mix"))
                        let mode = Int(\(paramVal("mode")))
                        let gain = 1.0 + drive * 20.0

                        for i in 0..<frameCount {
                            let input = \(audioSource)[i]
                            let driven = input * gain
                            var distorted: Float
                            switch mode {
                            case 0: distorted = tanhf(driven) // Soft clip
                            case 1: distorted = max(-1.0, min(1.0, driven)) // Hard clip
                            case 2: // Wavefold
                                var folded = driven
                                while folded > 1.0 || folded < -1.0 {
                                    if folded > 1.0 { folded = 2.0 - folded }
                                    if folded < -1.0 { folded = -2.0 - folded }
                                }
                                distorted = folded
                            default: distorted = tanhf(driven)
                            }
                            buf_\(safe)[i] = input * (1.0 - mix) + distorted * mix
                        }
                    }

            """

        // ───────────────── BITCRUSHER ─────────────────
        case "bitcrusher":
            let audioSource = sourceBuffer(for: "audio") ?? "buf_\(safe)"
            code += """
                    do {
                        let bitDepth: Float = \(paramVal("bitDepth"))
                        let srReduce = max(1, Int(\(paramVal("sampleRateReduction"))))
                        let mix: Float = \(paramVal("mix"))
                        let quantLevels = powf(2.0, bitDepth)

                        for i in 0..<frameCount {
                            let input = \(audioSource)[i]
                            crushCounter_\(safe) += 1
                            if crushCounter_\(safe) >= srReduce {
                                crushCounter_\(safe) = 0
                                crushHold_\(safe) = floorf(input * quantLevels) / quantLevels
                            }
                            buf_\(safe)[i] = input * (1.0 - mix) + crushHold_\(safe) * mix
                        }
                    }

            """

        // ───────────────── PHASER ─────────────────
        case "phaser":
            let audioSource = sourceBuffer(for: "audio") ?? "buf_\(safe)"
            code += """
                    do {
                        let rate: Float = \(paramVal("rate"))
                        let depth: Float = \(paramVal("depth"))
                        let feedback: Float = \(paramVal("feedback"))
                        let stages = min(Int(\(paramVal("stages"))), 12)
                        let mix: Float = \(paramVal("mix"))
                        let sr = Float(sampleRate)

                        for i in 0..<frameCount {
                            let lfo = sinf(phaserLfoPhase_\(safe) * 2.0 * .pi)
                            let minFreq: Float = 200.0
                            let maxFreq: Float = 4000.0
                            let modFreq = minFreq + (maxFreq - minFreq) * (lfo * depth * 0.5 + 0.5)
                            let coeff = (1.0 - tanf(.pi * modFreq / sr)) / (1.0 + tanf(.pi * modFreq / sr))

                            var x = \(audioSource)[i] + phaserAP_\(safe)[min(stages - 1, 11)] * feedback
                            for s in 0..<stages {
                                let ap = coeff * x + phaserAP_\(safe)[s]
                                phaserAP_\(safe)[s] = x - coeff * ap
                                x = ap
                            }
                            buf_\(safe)[i] = \(audioSource)[i] * (1.0 - mix) + x * mix

                            phaserLfoPhase_\(safe) += rate / sr
                            if phaserLfoPhase_\(safe) >= 1.0 { phaserLfoPhase_\(safe) -= 1.0 }
                        }
                    }

            """

        // ───────────────── FLANGER ─────────────────
        case "flanger":
            let audioSource = sourceBuffer(for: "audio") ?? "buf_\(safe)"
            code += """
                    do {
                        let rate: Float = \(paramVal("rate"))
                        let depth: Float = \(paramVal("depth"))
                        let feedback: Float = \(paramVal("feedback"))
                        let mix: Float = \(paramVal("mix"))
                        let maxDelay: Float = 0.007
                        let bufLen = flangerBuffer_\(safe).count
                        let sr = Float(sampleRate)

                        for i in 0..<frameCount {
                            let lfo = sinf(flangerLfoPhase_\(safe) * 2.0 * .pi) * 0.5 + 0.5
                            let delaySamples = (0.0001 + lfo * depth * maxDelay) * sr
                            let readPos = Float(flangerWriteIdx_\(safe)) - delaySamples
                            var readIdx = Int(readPos) % bufLen
                            if readIdx < 0 { readIdx += bufLen }
                            let delayed = flangerBuffer_\(safe)[readIdx]
                            let input = \(audioSource)[i]

                            flangerBuffer_\(safe)[flangerWriteIdx_\(safe)] = input + delayed * feedback
                            flangerWriteIdx_\(safe) = (flangerWriteIdx_\(safe) + 1) % bufLen

                            buf_\(safe)[i] = input * (1.0 - mix) + delayed * mix
                            flangerLfoPhase_\(safe) += rate / sr
                            if flangerLfoPhase_\(safe) >= 1.0 { flangerLfoPhase_\(safe) -= 1.0 }
                        }
                    }

            """

        // ───────────────── ADD (MIX) ─────────────────
        case "add":
            let srcA = sourceBuffer(for: "inputA")
            let srcB = sourceBuffer(for: "inputB")
            code += """
                    do {
                        let gainA: Float = \(paramVal("gainA"))
                        let gainB: Float = \(paramVal("gainB"))
                        for i in 0..<frameCount {
                            let a: Float = \(srcA.map { "\($0)[i]" } ?? "0.0") * gainA
                            let b: Float = \(srcB.map { "\($0)[i]" } ?? "0.0") * gainB
                            buf_\(safe)[i] = a + b
                        }
                    }

            """

        // ───────────────── MULTIPLY (VCA) ─────────────────
        case "multiply":
            let audioSrc = sourceBuffer(for: "audio")
            let modSrc = sourceBuffer(for: "modulator")
            code += """
                    do {
                        let amount: Float = \(paramVal("amount"))
                        for i in 0..<frameCount {
                            let audio: Float = \(audioSrc.map { "\($0)[i]" } ?? "0.0")
                            let mod: Float = \(modSrc.map { "\($0)[i]" } ?? "1.0")
                            buf_\(safe)[i] = audio * mod * amount
                        }
                    }

            """

        // ───────────────── CROSSFADE MIX ─────────────────
        case "mix":
            let srcA = sourceBuffer(for: "inputA")
            let srcB = sourceBuffer(for: "inputB")
            code += """
                    do {
                        let mixVal: Float = \(paramVal("mix"))
                        for i in 0..<frameCount {
                            let a: Float = \(srcA.map { "\($0)[i]" } ?? "0.0")
                            let b: Float = \(srcB.map { "\($0)[i]" } ?? "0.0")
                            buf_\(safe)[i] = a * (1.0 - mixVal) + b * mixVal
                        }
                    }

            """

        // ───────────────── CLAMP ─────────────────
        case "clamp":
            let audioSrc = sourceBuffer(for: "audio") ?? "buf_\(safe)"
            code += """
                    do {
                        let lo: Float = \(paramVal("min"))
                        let hi: Float = \(paramVal("max"))
                        for i in 0..<frameCount {
                            buf_\(safe)[i] = max(lo, min(hi, \(audioSrc)[i]))
                        }
                    }

            """

        // ───────────────── SCALE / GAIN ─────────────────
        case "scale":
            let audioSrc = sourceBuffer(for: "audio") ?? "buf_\(safe)"
            code += """
                    do {
                        var gain: Float = \(paramVal("gain"))
                        let offset: Float = \(paramVal("offset"))
                        // Use vDSP for vectorized multiply + add
                        \(audioSrc).withUnsafeBufferPointer { src in
                            guard let srcBase = src.baseAddress else { return }
                            buf_\(safe).withUnsafeMutableBufferPointer { dst in
                                guard let dstBase = dst.baseAddress else { return }
                                vDSP_vsmul(srcBase, 1, &gain, dstBase, 1, vDSP_Length(frameCount))
                                if offset != 0 {
                                    var off = offset
                                    vDSP_vsadd(dstBase, 1, &off, dstBase, 1, vDSP_Length(frameCount))
                                }
                            }
                        }
                    }

            """

        // ───────────────── OUTPUT ─────────────────
        case "output":
            let audioSrc = sourceBuffer(for: "audio") ?? "buf_\(safe)"
            if audioSrc != "buf_\(safe)" {
                code += """
                        // Output: copy from source
                        for i in 0..<frameCount {
                            buf_\(safe)[i] = \(audioSrc)[i]
                        }

                """
            }

        default:
            code += "        // Unknown node type: \(node.type) — pass-through\n"
        }

        return code
    }

    // MARK: - Per-Node Reset

    private func generateNodeReset(node: NodeDefinition, nodeId: String) -> String {
        let safe = safeId(nodeId)
        var code = ""

        switch node.type {
        case "oscillator", "subOscillator", "wavetable":
            code += "        phase_\(safe) = 0\n"
        case "noise":
            code += "        pinkState_\(safe) = [Float](repeating: 0, count: 7)\n"
            code += "        brownState_\(safe) = 0\n"
        case "lowpass", "highpass", "bandpass", "notch":
            code += "        bq_z1_\(safe) = 0; bq_z2_\(safe) = 0\n"
        case "comb":
            code += "        combBuffer_\(safe) = [Float](repeating: 0, count: combBuffer_\(safe).count)\n"
            code += "        combIndex_\(safe) = 0\n"
        case "adsr":
            code += "        envState_\(safe) = 0; envLevel_\(safe) = 0\n"
        case "multiStageEnvelope":
            code += "        msEnvStage_\(safe) = 0; msEnvLevel_\(safe) = 0; msEnvSampleCount_\(safe) = 0\n"
        case "lfo":
            code += "        lfoPhase_\(safe) = 0\n"
        case "delay":
            code += "        delayBuffer_\(safe) = [Float](repeating: 0, count: delayBuffer_\(safe).count)\n"
            code += "        delayWriteIdx_\(safe) = 0\n"
        case "reverb":
            code += "        for c in 0..<4 { revComb_\(safe)[c] = [Float](repeating: 0, count: revComb_\(safe)[c].count); revCombIdx_\(safe)[c] = 0 }\n"
            code += "        for a in 0..<2 { revAP_\(safe)[a] = [Float](repeating: 0, count: revAP_\(safe)[a].count); revAPIdx_\(safe)[a] = 0 }\n"
        case "chorus":
            code += "        chorusBuffer_\(safe) = [Float](repeating: 0, count: chorusBuffer_\(safe).count)\n"
            code += "        chorusWriteIdx_\(safe) = 0; chorusLfoPhase_\(safe) = 0\n"
        case "bitcrusher":
            code += "        crushHold_\(safe) = 0; crushCounter_\(safe) = 0\n"
        case "phaser":
            code += "        phaserAP_\(safe) = [Float](repeating: 0, count: 12); phaserLfoPhase_\(safe) = 0\n"
        case "flanger":
            code += "        flangerBuffer_\(safe) = [Float](repeating: 0, count: flangerBuffer_\(safe).count)\n"
            code += "        flangerWriteIdx_\(safe) = 0; flangerLfoPhase_\(safe) = 0\n"
        default:
            break
        }

        return code
    }

    // MARK: - AUv3 Wrapper Code Generation

    private func generateAUWrapper(graph: NodeGraphDefinition) -> String {
        let safeName = Self.sanitizeIdentifier(graph.metadata.name)
        let exposedParams = graph.exposedParameters
        let isInstrument = graph.metadata.category == .instrument
        let componentType = isInstrument ? "kAudioUnitType_MusicDevice" : "kAudioUnitType_Effect"
        let subType = Self.fourCC(from: safeName)

        var code = """
        // Auto-generated by Magic DAW Plugin Compiler
        // AUv3 Audio Unit wrapper for: \(graph.metadata.name)
        // Generated: \(ISO8601DateFormatter().string(from: Date()))

        import Foundation
        import AudioToolbox
        import AVFoundation
        import CoreAudioKit

        // MARK: - Audio Unit Factory

        @objc class \(safeName)AudioUnitFactory: NSObject, AUAudioUnitFactory {
            @objc func createAudioUnit(with componentDescription: AudioComponentDescription) throws -> AUAudioUnit {
                return try \(safeName)AudioUnit(componentDescription: componentDescription, options: [])
            }
        }

        // MARK: - Audio Unit

        final class \(safeName)AudioUnit: AUAudioUnit {

            private var kernel: \(safeName)DSPKernel!
            private var inputBus: AUAudioUnitBus?
            private var outputBus: AUAudioUnitBus!
            private var _inputBusArray: AUAudioUnitBusArray!
            private var _outputBusArray: AUAudioUnitBusArray!
            private var _parameterTree: AUParameterTree!

            // Component description for registration
            static let componentDescription = AudioComponentDescription(
                componentType: \(componentType),
                componentSubType: \(subType),
                componentManufacturer: FourCharCode("MgDW"),
                componentFlags: 0,
                componentFlagsMask: 0
            )

        """

        // Declare parameter references
        for (nodeId, param) in exposedParams {
            let sid = Self.sanitizeIdentifier(nodeId)
            code += "    private var auParam_\(sid)_\(param.name): AUParameter!\n"
        }

        // Init
        code += """

            // MARK: - Init

            override init(componentDescription: AudioComponentDescription,
                          options: AudioComponentInstantiationOptions = []) throws {

                let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!

                kernel = \(safeName)DSPKernel(sampleRate: format.sampleRate)

        """

        if !isInstrument {
            code += "        inputBus = try AUAudioUnitBus(format: format)\n"
            code += "        _inputBusArray = AUAudioUnitBusArray(audioUnit: self, busType: .input, busses: [inputBus!])\n"
        }

        code += """
                outputBus = try AUAudioUnitBus(format: format)
                _outputBusArray = AUAudioUnitBusArray(audioUnit: self, busType: .output, busses: [outputBus])

                try super.init(componentDescription: componentDescription, options: options)

        """

        // Create parameters
        if !exposedParams.isEmpty {
            code += "\n        // Create AUParameters\n"
            code += "        var parameters: [AUParameter] = []\n\n"

            for (idx, (nodeId, param)) in exposedParams.enumerated() {
                let sid = Self.sanitizeIdentifier(nodeId)
                code += """
                        auParam_\(sid)_\(param.name) = AUParameterTree.createParameter(
                            withIdentifier: "\(sid)_\(param.name)",
                            name: "\(param.name)",
                            address: AUParameterAddress(\(idx)),
                            min: AUValue(\(param.min)),
                            max: AUValue(\(param.max)),
                            unit: .generic,
                            unitName: "\(param.unit)",
                            flags: [.flag_IsReadable, .flag_IsWritable],
                            valueStrings: nil,
                            dependentParameters: nil
                        )
                        auParam_\(sid)_\(param.name).value = AUValue(\(param.value))
                        parameters.append(auParam_\(sid)_\(param.name))

                """
            }

            code += """

                    _parameterTree = AUParameterTree.createTree(withChildren: parameters)

                    _parameterTree.implementorValueObserver = { [weak self] param, value in
                        self?.kernel.setParameter(address: param.address, value: value)
                    }
                    _parameterTree.implementorValueProvider = { [weak self] param in
                        self?.kernel.getParameter(address: param.address) ?? param.value
                    }

            """
        } else {
            code += "        _parameterTree = AUParameterTree.createTree(withChildren: [])\n"
        }

        code += "    }\n"

        // Bus arrays and parameter tree
        code += "\n    // MARK: - Bus Arrays\n\n"
        if !isInstrument {
            code += "    override var inputBusses: AUAudioUnitBusArray { _inputBusArray }\n"
        }
        code += "    override var outputBusses: AUAudioUnitBusArray { _outputBusArray }\n"
        code += "    override var parameterTree: AUParameterTree? { get { _parameterTree } set { } }\n"

        // Lifecycle
        code += """

            // MARK: - Lifecycle

            override func allocateRenderResources() throws {
                try super.allocateRenderResources()
                let sampleRate = outputBus.format.sampleRate
                kernel.sampleRate = sampleRate
                kernel.prepare(maxFrames: Int(maximumFramesToRender))
            }

            override func deallocateRenderResources() {
                super.deallocateRenderResources()
                kernel.deallocate()
            }

        """

        // Render block
        code += """
            // MARK: - Render

            override var internalRenderBlock: AUInternalRenderBlock {
                let kernel = self.kernel!

                return { actionFlags, timestamp, frameCount, outputBusNumber,
                         outputData, renderEvent, pullInputBlock in

        """

        if !isInstrument {
            code += """
                        // Pull input audio
                        var pullFlags: AudioUnitRenderActionFlags = []
                        let inputStatus = pullInputBlock?(&pullFlags, timestamp, frameCount, 0, outputData)
                        guard inputStatus == nil || inputStatus == noErr else {
                            return inputStatus ?? kAudioUnitErr_NoConnection
                        }

            """
        }

        // Handle MIDI events for instruments
        if isInstrument {
            code += """
                        // Process MIDI events
                        var event = renderEvent?.pointee
                        while event != nil {
                            if event!.head.eventType == .MIDI {
                                let midi = event!.MIDI
                                let status = midi.data.0
                                let data1 = midi.data.1
                                let data2 = midi.data.2
                                let command = status & 0xF0
                                if command == 0x90 && data2 > 0 {
                                    kernel.noteOn(note: data1, velocity: data2)
                                } else if command == 0x80 || (command == 0x90 && data2 == 0) {
                                    kernel.noteOff(note: data1)
                                } else if command == 0xE0 {
                                    let bend = (Float(Int(data2) << 7 | Int(data1)) - 8192.0) / 8192.0 * 2.0
                                    kernel.pitchBend(bend)
                                }
                            }
                            event = event?.pointee.head.next?.pointee
                        }

            """
        }

        code += """
                        kernel.render(frameCount: Int(frameCount), outputData: outputData)
                        return noErr
                    }
                }

        """

        // Factory registration extension
        code += """

            // MARK: - Registration

            static func registerAUv3() {
                AUAudioUnit.registerSubclass(
                    \(safeName)AudioUnit.self,
                    as: componentDescription,
                    name: "\(graph.metadata.name)",
                    version: UInt32(1)
                )
            }
        }

        """

        return code
    }

    // MARK: - Info.plist Generation

    private func generateInfoPlist(graph: NodeGraphDefinition) -> String {
        let safeName = Self.sanitizeIdentifier(graph.metadata.name)
        let isInstrument = graph.metadata.category == .instrument
        let componentType = isInstrument ? "aumu" : "aufx"
        let subType = String(safeName.prefix(4).lowercased().padding(toLength: 4, withPad: "x", startingAt: 0))

        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>CFBundleDevelopmentRegion</key>
            <string>en</string>
            <key>CFBundleDisplayName</key>
            <string>\(graph.metadata.name)</string>
            <key>CFBundleExecutable</key>
            <string>\(safeName)</string>
            <key>CFBundleIdentifier</key>
            <string>\(bundleIdPrefix).\(safeName.lowercased())</string>
            <key>CFBundleInfoDictionaryVersion</key>
            <string>6.0</string>
            <key>CFBundleName</key>
            <string>\(graph.metadata.name)</string>
            <key>CFBundlePackageType</key>
            <string>XPC!</string>
            <key>CFBundleShortVersionString</key>
            <string>\(graph.metadata.version)</string>
            <key>CFBundleVersion</key>
            <string>1</string>
            <key>LSMinimumSystemVersion</key>
            <string>14.0</string>
            <key>NSExtension</key>
            <dict>
                <key>NSExtensionAttributes</key>
                <dict>
                    <key>AudioComponents</key>
                    <array>
                        <dict>
                            <key>description</key>
                            <string>\(graph.metadata.description.isEmpty ? graph.metadata.name : graph.metadata.description)</string>
                            <key>manufacturer</key>
                            <string>MgDW</string>
                            <key>name</key>
                            <string>Magic DAW: \(graph.metadata.name)</string>
                            <key>subtype</key>
                            <string>\(subType)</string>
                            <key>type</key>
                            <string>\(componentType)</string>
                            <key>version</key>
                            <integer>1</integer>
                            <key>sandboxSafe</key>
                            <true/>
                            <key>tags</key>
                            <array>
                                <string>\(isInstrument ? "Synthesizer" : "Effects")</string>
                            </array>
                        </dict>
                    </array>
                </dict>
                <key>NSExtensionPointIdentifier</key>
                <string>com.apple.AudioUnit-UI</string>
                <key>NSExtensionPrincipalClass</key>
                <string>\(safeName)AudioUnitFactory</string>
            </dict>
        </dict>
        </plist>
        """
    }

    // MARK: - Helpers

    /// Convert a node ID to a safe Swift identifier
    private func safeId(_ id: String) -> String {
        Self.sanitizeIdentifier(id)
    }

    /// Convert a string to a valid Swift identifier (static for use from GeneratedPlugin)
    static func sanitizeIdentifier(_ name: String) -> String {
        let cleaned = name
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "-", with: "_")
            .replacingOccurrences(of: ".", with: "_")
            .replacingOccurrences(of: "[^a-zA-Z0-9_]", with: "", options: .regularExpression)
        if let first = cleaned.first, first.isNumber {
            return "_\(cleaned)"
        }
        return cleaned.isEmpty ? "_unnamed" : cleaned
    }

    /// Generate a FourCC literal from a name
    static func fourCC(from name: String) -> String {
        let chars = Array(name.prefix(4).lowercased())
        let padded = chars + Array(repeating: Character(" "), count: max(0, 4 - chars.count))
        return "FourCharCode(\"\(String(padded))\")"
    }
}
