import Foundation

/// Manages InstrumentPreset files on disk in ~/Library/Application Support/MagicDAW/Instruments/.
/// Each preset is stored as an individual JSON file named {id}.json.
class InstrumentLibrary {

    private let presetsDirectory: URL

    init() {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        presetsDirectory = appSupport
            .appendingPathComponent("MagicDAW", isDirectory: true)
            .appendingPathComponent("Instruments", isDirectory: true)

        // Ensure the directory exists
        try? FileManager.default.createDirectory(at: presetsDirectory, withIntermediateDirectories: true)
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
