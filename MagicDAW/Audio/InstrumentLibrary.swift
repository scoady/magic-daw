import Foundation

/// Manages InstrumentPreset files on disk in ~/Library/Application Support/MagicDAW/Instruments/.
/// Each preset is stored as an individual JSON file named {id}.json.
class InstrumentLibrary {

    private let presetsDirectory: URL
    private let samplerDirectory: URL

    init() {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let root = appSupport
            .appendingPathComponent("MagicDAW", isDirectory: true)
        presetsDirectory = root
            .appendingPathComponent("Instruments", isDirectory: true)
        samplerDirectory = root
            .appendingPathComponent("SampleInstruments", isDirectory: true)

        // Ensure the directory exists
        try? FileManager.default.createDirectory(at: presetsDirectory, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: samplerDirectory, withIntermediateDirectories: true)
    }

    // MARK: - CRUD

    /// Read all preset JSON files from the instruments directory.
    func listPresets() -> [InstrumentPreset] {
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: presetsDirectory,
            includingPropertiesForKeys: nil,
            options: .skipsHiddenFiles
        ) else {
            return []
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        return urls
            .filter { $0.pathExtension == "json" }
            .compactMap { url -> InstrumentPreset? in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? decoder.decode(InstrumentPreset.self, from: data)
            }
            .sorted { $0.createdAt > $1.createdAt }
    }

    /// Write a single preset to disk as {id}.json.
    func savePreset(_ preset: InstrumentPreset) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(preset)
        let fileURL = presetsDirectory.appendingPathComponent("\(preset.id.uuidString).json")
        try data.write(to: fileURL, options: .atomic)
    }

    /// Delete a preset file by its UUID.
    func deletePreset(id: UUID) throws {
        let fileURL = presetsDirectory.appendingPathComponent("\(id.uuidString).json")
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            throw InstrumentLibraryError.presetNotFound(id)
        }
        try FileManager.default.removeItem(at: fileURL)
    }

    /// Load a single preset by UUID.
    func loadPreset(id: UUID) throws -> InstrumentPreset {
        let fileURL = presetsDirectory.appendingPathComponent("\(id.uuidString).json")
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            throw InstrumentLibraryError.presetNotFound(id)
        }
        let data = try Data(contentsOf: fileURL)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(InstrumentPreset.self, from: data)
    }

    // MARK: - Sample Instruments

    func listSampleInstruments() -> [URL] {
        guard let folderURLs = try? FileManager.default.contentsOfDirectory(
            at: samplerDirectory,
            includingPropertiesForKeys: nil,
            options: .skipsHiddenFiles
        ) else {
            return []
        }

        return folderURLs
            .compactMap { folderURL in
                if let urls = try? FileManager.default.contentsOfDirectory(
                    at: folderURL,
                    includingPropertiesForKeys: nil,
                    options: .skipsHiddenFiles
                ) {
                    return urls.first(where: { $0.pathExtension.lowercased() == "magicinstrument" })
                }
                return nil
            }
            .sorted { $0.lastPathComponent.localizedCaseInsensitiveCompare($1.lastPathComponent) == .orderedAscending }
    }

    func listSampleInstrumentSummaries() -> [SampleInstrumentSummary] {
        listSampleInstruments().compactMap { url in
            guard let definition = try? InstrumentDefinition.load(from: url) else { return nil }
            let zones = definition.zones ?? []
            let sampleCount = Set(zones.map(\.sampleFile)).count
            return SampleInstrumentSummary(
                name: definition.name,
                path: url.path,
                zoneCount: zones.count,
                sampleCount: sampleCount
            )
        }
    }

    @discardableResult
    func saveSampleInstrument(
        name: String,
        definition: InstrumentDefinition,
        sampleSources: [String: URL]
    ) throws -> URL {
        let folderName = sanitizedInstrumentFolderName(name)
        let instrumentFolder = samplerDirectory.appendingPathComponent(folderName, isDirectory: true)
        let samplesFolder = instrumentFolder.appendingPathComponent("samples", isDirectory: true)

        if FileManager.default.fileExists(atPath: instrumentFolder.path) {
            try FileManager.default.removeItem(at: instrumentFolder)
        }

        try FileManager.default.createDirectory(at: samplesFolder, withIntermediateDirectories: true)

        for (relativeName, sourceURL) in sampleSources {
            let destinationURL = samplesFolder.appendingPathComponent(relativeName)
            if FileManager.default.fileExists(atPath: destinationURL.path) {
                try FileManager.default.removeItem(at: destinationURL)
            }
            try FileManager.default.copyItem(at: sourceURL, to: destinationURL)
        }

        var persisted = definition
        persisted.zones = definition.zones?.map { zone in
            var adjusted = zone
            if !zone.sampleFile.hasPrefix("samples/") {
                adjusted.sampleFile = "samples/\(zone.sampleFile)"
            }
            return adjusted
        }

        let definitionURL = instrumentFolder.appendingPathComponent("\(folderName).magicinstrument")
        try persisted.save(to: definitionURL)
        return definitionURL
    }

    func loadSampleInstrumentDefinition(at url: URL) throws -> InstrumentDefinition {
        try InstrumentDefinition.load(from: url)
    }

    func sampleInstrumentURL(named name: String) -> URL {
        let folderName = sanitizedInstrumentFolderName(name)
        return samplerDirectory
            .appendingPathComponent(folderName, isDirectory: true)
            .appendingPathComponent("\(folderName).magicinstrument")
    }

    func hasSampleInstrument(named name: String) -> Bool {
        FileManager.default.fileExists(atPath: sampleInstrumentURL(named: name).path)
    }

    func hasSampleInstrument(at url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    @discardableResult
    func ensureSampleInstrumentInstalled(from sourceDefinitionURL: URL) throws -> URL {
        let sourceFolder = sourceDefinitionURL.deletingLastPathComponent().standardizedFileURL
        let destinationFolder = samplerDirectory.appendingPathComponent(sourceFolder.lastPathComponent, isDirectory: true)
        let destinationURL = destinationFolder.appendingPathComponent(sourceDefinitionURL.lastPathComponent)

        if FileManager.default.fileExists(atPath: destinationURL.path) {
            return destinationURL
        }

        if FileManager.default.fileExists(atPath: destinationFolder.path) {
            try FileManager.default.removeItem(at: destinationFolder)
        }
        try FileManager.default.copyItem(at: sourceFolder, to: destinationFolder)
        return destinationURL
    }

    private func sanitizedInstrumentFolderName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate = trimmed.isEmpty ? "SampleInstrument" : trimmed
        let sanitized = candidate.replacingOccurrences(
            of: "[^A-Za-z0-9_-]+",
            with: "-",
            options: .regularExpression
        )
        return sanitized.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }
}

// MARK: - Errors

enum InstrumentLibraryError: Error, LocalizedError {
    case presetNotFound(UUID)

    var errorDescription: String? {
        switch self {
        case .presetNotFound(let id):
            return "Instrument preset not found: \(id.uuidString)"
        }
    }
}
