import Foundation
import CoreGraphics

@main
struct PluginExportSmoke {
    static func main() async {
        do {
            let compiler = PluginCompiler()
            let graph = makeBasicInstrumentGraph()
            let plugin = try compiler.compile(graph)

            let outputRoot = FileManager.default.temporaryDirectory
                .appendingPathComponent("MagicDAWPluginSmoke-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: outputRoot, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: outputRoot) }

            let appexURL = try await compiler.buildPlugin(plugin, outputDir: outputRoot)
            print("OK")
            print(appexURL.path)
        } catch {
            fputs("ERROR\n\(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    private static func makeBasicInstrumentGraph() -> NodeGraphDefinition {
        var osc = DSPNodeRegistry.template(for: "oscillator")!.instantiate(
            id: "osc1",
            position: CGPoint(x: 120, y: 160)
        )
        osc.setParameter("waveform", value: 1)
        osc.setParameter("amplitude", value: 0.72)
        osc.setParameter("detune", value: 3)

        var filter = DSPNodeRegistry.template(for: "lowpass")!.instantiate(
            id: "filter1",
            position: CGPoint(x: 420, y: 160)
        )
        filter.setParameter("cutoff", value: 2400)
        filter.setParameter("resonance", value: 0.18)

        var output = DSPNodeRegistry.template(for: "output")!.instantiate(
            id: "output",
            position: CGPoint(x: 760, y: 160)
        )
        output.setParameter("gain", value: 0.85)

        return NodeGraphDefinition(
            nodes: [osc, filter, output],
            connections: [
                ConnectionDefinition(fromNode: "osc1", fromPort: "audio", toNode: "filter1", toPort: "audio"),
                ConnectionDefinition(fromNode: "filter1", fromPort: "audio", toNode: "output", toPort: "audio"),
            ],
            metadata: NodeGraphMetadata(
                name: "Basic Synth",
                author: "Smoke",
                description: "Smoke test graph",
                category: .instrument,
                version: "1.0"
            )
        )
    }
}
