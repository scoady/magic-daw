import Foundation
import UniformTypeIdentifiers

// MARK: - ProjectError

enum ProjectError: LocalizedError {
    case bundleNotFound(URL)
    case projectFileNotFound(URL)
    case corruptedProject(String)
    case saveFailed(String)
    case autoSaveNoURL

    var errorDescription: String? {
        switch self {
        case .bundleNotFound(let url):
            return "Project bundle not found at \(url.path)"
        case .projectFileNotFound(let url):
            return "project.json not found in \(url.path)"
        case .corruptedProject(let detail):
            return "Corrupted project file: \(detail)"
        case .saveFailed(let detail):
            return "Save failed: \(detail)"
        case .autoSaveNoURL:
            return "Cannot auto-save: project has no file URL"
        }
    }
}

// MARK: - ProjectManager

class ProjectManager {
    static let shared = ProjectManager()

    static let fileExtension = "magicdaw"
    static let utType = UTType(filenameExtension: fileExtension) ?? .data

    private let fileManager = FileManager.default
    private let recentProjectsKey = "MagicDAW.recentProjects"
    private let maxRecentProjects = 20

    /// Auto-save directory inside Application Support
    private var autoSaveDirectory: URL {
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("MagicDAW/AutoSave", isDirectory: true)
    }

    init() {}

    // MARK: - Save

    /// Save a project to disk as a .magicdaw bundle directory.
    ///
    /// Bundle structure:
    /// ```
    /// MyProject.magicdaw/
    ///   project.json         — serialized DAWProject
    ///   audio/               — audio clip files
    ///   instruments/         — .magicinstrument definitions
    ///   plugins/             — plugin node graphs
    ///   backups/             — rolling backup copies
    /// ```
    func save(_ project: DAWProject, to url: URL) throws {
        let bundleURL: URL
        if url.pathExtension == Self.fileExtension {
            bundleURL = url
        } else {
            bundleURL = url.appendingPathExtension(Self.fileExtension)
        }

        // Create bundle directory and subdirectories
        let subdirectories = ["audio", "instruments", "plugins", "backups"]
        for subdir in subdirectories {
            try fileManager.createDirectory(
                at: bundleURL.appendingPathComponent(subdir, isDirectory: true),
                withIntermediateDirectories: true
            )
        }

        let projectFileURL = bundleURL.appendingPathComponent("project.json")

        // Before overwriting, create a backup of the existing project.json
        if fileManager.fileExists(atPath: projectFileURL.path) {
            let backupDir = bundleURL.appendingPathComponent("backups", isDirectory: true)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withFullDate, .withTime, .withColonSeparatorInTime]
            let timestamp = formatter.string(from: Date())
            let backupURL = backupDir.appendingPathComponent("project-\(timestamp).json")
            try? fileManager.copyItem(at: projectFileURL, to: backupURL)
            pruneBackups(in: backupDir, keepCount: 10)
        }

        // Update modification date
        project.modifiedAt = Date()
        project.fileURL = bundleURL

        // Encode and write
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601

        let data: Data
        do {
            data = try encoder.encode(project)
        } catch {
            throw ProjectError.saveFailed("Encoding failed: \(error.localizedDescription)")
        }

        do {
            try data.write(to: projectFileURL, options: .atomic)
        } catch {
            throw ProjectError.saveFailed("Write failed: \(error.localizedDescription)")
        }

        addToRecent(bundleURL)
    }

    // MARK: - Load

    /// Load a project from a .magicdaw bundle URL
    func load(from url: URL) throws -> DAWProject {
        let bundleURL: URL
        if url.pathExtension == Self.fileExtension {
            bundleURL = url
        } else {
            bundleURL = url.appendingPathExtension(Self.fileExtension)
        }

        guard fileManager.fileExists(atPath: bundleURL.path) else {
            throw ProjectError.bundleNotFound(bundleURL)
        }

        let projectFileURL = bundleURL.appendingPathComponent("project.json")
        guard fileManager.fileExists(atPath: projectFileURL.path) else {
            throw ProjectError.projectFileNotFound(bundleURL)
        }

        let data: Data
        do {
            data = try Data(contentsOf: projectFileURL)
        } catch {
            throw ProjectError.corruptedProject("Cannot read file: \(error.localizedDescription)")
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let project: DAWProject
        do {
            project = try decoder.decode(DAWProject.self, from: data)
        } catch {
            throw ProjectError.corruptedProject("JSON decode failed: \(error.localizedDescription)")
        }

        project.fileURL = bundleURL
        addToRecent(bundleURL)
        return project
    }

    // MARK: - Recent Projects

    /// Get the list of recently opened project URLs (validated to still exist on disk)
    func recentProjects() -> [URL] {
        guard let bookmarks = UserDefaults.standard.array(forKey: recentProjectsKey) as? [Data] else {
            return []
        }

        var validURLs: [URL] = []
        for bookmark in bookmarks {
            var isStale = false
            if let url = try? URL(resolvingBookmarkData: bookmark, options: .withSecurityScope, bookmarkDataIsStale: &isStale),
               fileManager.fileExists(atPath: url.path) {
                validURLs.append(url)
            }
        }
        return validURLs
    }

    /// Add a URL to the recent projects list
    func addToRecent(_ url: URL) {
        var bookmarks = UserDefaults.standard.array(forKey: recentProjectsKey) as? [Data] ?? []

        // Create a bookmark for this URL
        if let bookmark = try? url.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil) {
            // Remove duplicates (matching by resolved path)
            bookmarks = bookmarks.filter { existingBookmark in
                var isStale = false
                guard let existingURL = try? URL(resolvingBookmarkData: existingBookmark, options: .withSecurityScope, bookmarkDataIsStale: &isStale) else {
                    return false
                }
                return existingURL.path != url.path
            }

            bookmarks.insert(bookmark, at: 0)

            // Trim to max
            if bookmarks.count > maxRecentProjects {
                bookmarks = Array(bookmarks.prefix(maxRecentProjects))
            }

            UserDefaults.standard.set(bookmarks, forKey: recentProjectsKey)
        }
    }

    /// Clear the recent projects list
    func clearRecent() {
        UserDefaults.standard.removeObject(forKey: recentProjectsKey)
    }

    // MARK: - Auto-Save

    /// Auto-save the project. Uses the project's existing fileURL, or a temporary location.
    func autoSave(_ project: DAWProject) throws {
        if let url = project.fileURL {
            try save(project, to: url)
        } else {
            // Save to auto-save directory with a stable name based on creation date
            try fileManager.createDirectory(at: autoSaveDirectory, withIntermediateDirectories: true)

            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withFullDate, .withTime]
            let filename = "autosave-\(formatter.string(from: project.createdAt))"
            let url = autoSaveDirectory.appendingPathComponent(filename)
            try save(project, to: url)
        }
    }

    /// Recover auto-saved projects that were not explicitly saved
    func recoverAutoSaves() -> [URL] {
        guard fileManager.fileExists(atPath: autoSaveDirectory.path) else { return [] }

        do {
            let contents = try fileManager.contentsOfDirectory(
                at: autoSaveDirectory,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: .skipsHiddenFiles
            )
            return contents
                .filter { $0.pathExtension == Self.fileExtension }
                .sorted { a, b in
                    let dateA = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                    let dateB = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                    return dateA > dateB
                }
        } catch {
            return []
        }
    }

    /// Delete an auto-save bundle
    func deleteAutoSave(at url: URL) {
        try? fileManager.removeItem(at: url)
    }

    // MARK: - Audio File Management

    /// Copy an audio file into the project bundle's audio/ directory.
    /// Returns the relative path (e.g. "audio/drums.wav") for use in clips.
    func importAudioFile(source: URL, into project: DAWProject) throws -> String {
        guard let bundleURL = project.fileURL else {
            throw ProjectError.autoSaveNoURL
        }

        let audioDir = bundleURL.appendingPathComponent("audio", isDirectory: true)
        try fileManager.createDirectory(at: audioDir, withIntermediateDirectories: true)

        var destFilename = source.lastPathComponent
        var destURL = audioDir.appendingPathComponent(destFilename)

        // Handle filename collisions
        var counter = 1
        while fileManager.fileExists(atPath: destURL.path) {
            let stem = source.deletingPathExtension().lastPathComponent
            let ext = source.pathExtension
            destFilename = "\(stem)-\(counter).\(ext)"
            destURL = audioDir.appendingPathComponent(destFilename)
            counter += 1
        }

        try fileManager.copyItem(at: source, to: destURL)
        return "audio/\(destFilename)"
    }

    // MARK: - Helpers

    /// Keep only the N most recent backup files
    private func pruneBackups(in directory: URL, keepCount: Int) {
        guard let files = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: .skipsHiddenFiles
        ) else { return }

        let sorted = files.sorted { a, b in
            let dateA = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let dateB = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return dateA > dateB
        }

        for file in sorted.dropFirst(keepCount) {
            try? fileManager.removeItem(at: file)
        }
    }
}
