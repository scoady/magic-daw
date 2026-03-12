import Foundation

struct PluginGraphSummary: Codable {
    let name: String
    let path: String
    let category: String
    let description: String
    let version: String
    let modifiedAt: Date
}

final class PluginGraphLibrary {
    private let directory: URL

    init() {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        directory = appSupport
            .appendingPathComponent("MagicDAW", isDirectory: true)
            .appendingPathComponent("Plugins", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func listGraphs() -> [PluginGraphSummary] {
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: .skipsHiddenFiles
        ) else {
            return []
        }

        return urls
            .filter { $0.pathExtension.lowercased() == "magicplugin" }
            .compactMap { url in
                guard let graph = try? loadGraph(at: url) else { return nil }
                let modifiedAt = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date()
                return PluginGraphSummary(
                    name: graph.metadata.name,
                    path: url.path,
                    category: graph.metadata.category.rawValue,
                    description: graph.metadata.description,
                    version: graph.metadata.version,
                    modifiedAt: modifiedAt
                )
            }
            .sorted { $0.modifiedAt > $1.modifiedAt }
    }

    @discardableResult
    func saveGraph(_ graph: NodeGraphDefinition, named requestedName: String? = nil) throws -> URL {
        let baseName = (requestedName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
            ? requestedName!
            : graph.metadata.name
        let safeName = sanitizedFileName(baseName.isEmpty ? "Untitled Plugin" : baseName)
        let url = directory.appendingPathComponent("\(safeName).magicplugin")

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(graph)
        try data.write(to: url, options: .atomic)
        return url
    }

    func loadGraph(at url: URL) throws -> NodeGraphDefinition {
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(NodeGraphDefinition.self, from: data)
    }

    private func sanitizedFileName(_ name: String) -> String {
        let sanitized = name
            .replacingOccurrences(of: "[^A-Za-z0-9_-]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return sanitized.isEmpty ? "Untitled-Plugin" : sanitized
    }
}
