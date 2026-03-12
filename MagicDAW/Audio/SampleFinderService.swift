import Foundation

struct SampleFinderRoot: Sendable {
    let path: String
    let name: String
    let source: String
}

struct SampleFinderResult: Sendable {
    let name: String
    let path: String
    let kind: String
    let source: String
    let extensionName: String
    let family: String
    let contentType: String
    let readiness: String
    let packageName: String
    let packageScore: Int
    let nearbySampleCount: Int
    let sizeBytes: Int64
    let matchScore: Int
}

final class SampleFinderService: @unchecked Sendable {
    private let queue = DispatchQueue(label: "magicdaw.sample-finder", qos: .userInitiated)
    private let fileManager = FileManager.default
    private let rootsKey = "MagicDAW.sampleFinderRoots"
    private let allowedExtensions = Set(["sfz", "wav", "flac", "aif", "aiff", "caf", "mp3", "m4a", "magicinstrument"])
    private let indexFileName = "sample-finder-index.json"

    func searchLocalSamples(query: String, limit: Int = 120, completion: @escaping ([SampleFinderResult]) -> Void) {
        queue.async {
            let results = self.searchLocalSamplesSync(query: query, limit: limit)
            completion(results)
        }
    }

    func searchLocalSamplesSync(query: String, limit: Int = 120) -> [SampleFinderResult] {
        let queryTokens = tokenize(query)
        let entries: [SampleFinderResult] = loadIndex().map { index in
            index.entries.filter { queryTokens.isEmpty || scoreMatch(tokens: queryTokens, haystack: $0.searchText, filename: $0.name.lowercased(), ext: $0.extensionName) > 0 }
                .map { entry -> SampleFinderResult in
                    SampleFinderResult(
                        name: entry.name,
                        path: entry.path,
                        kind: entry.kind,
                        source: entry.source,
                        extensionName: entry.extensionName,
                        family: entry.family,
                        contentType: entry.contentType,
                        readiness: entry.readiness,
                        packageName: entry.packageName,
                        packageScore: entry.packageScore,
                        nearbySampleCount: entry.nearbySampleCount,
                        sizeBytes: entry.sizeBytes,
                        matchScore: scoreMatch(tokens: queryTokens, haystack: entry.searchText, filename: entry.name.lowercased(), ext: entry.extensionName)
                    )
                }
        } ?? []

        if !entries.isEmpty {
            return sortResults(entries, limit: limit)
        }

        rebuildIndexSync()
        return searchLocalSamplesSyncFromRoots(query: query, limit: limit)
    }

    func listRoots() -> [SampleFinderRoot] {
        if let data = UserDefaults.standard.data(forKey: rootsKey),
           let roots = try? JSONDecoder().decode([PersistedRoot].self, from: data) {
            return roots.map { SampleFinderRoot(path: $0.path, name: $0.name, source: $0.source) }
        }
        let defaults = defaultRoots()
        persistRoots(defaults)
        return defaults.map { SampleFinderRoot(path: $0.path, name: $0.name, source: $0.source) }
    }

    func addRoot(url: URL, source: String = "Custom") {
        var roots = listRoots().map(PersistedRoot.init)
        if !roots.contains(where: { $0.path == url.path }) {
            roots.append(PersistedRoot(path: url.path, name: url.lastPathComponent, source: source))
            persistRoots(roots)
        }
    }

    func removeRoot(path: String) {
        let roots = listRoots().map(PersistedRoot.init).filter { $0.path != path }
        persistRoots(roots)
    }

    func rebuildIndex(completion: @escaping (Int) -> Void) {
        queue.async {
            let count = self.rebuildIndexSync()
            completion(count)
        }
    }

    @discardableResult
    func rebuildIndexSync() -> Int {
        let roots = listRoots()
        var entries: [IndexedEntry] = []
        var directoryProfiles: [String: DirectoryProfile] = [:]

        for root in roots {
            let rootURL = URL(fileURLWithPath: root.path, isDirectory: true)
            guard fileManager.fileExists(atPath: rootURL.path),
                  let enumerator = fileManager.enumerator(
                    at: rootURL,
                    includingPropertiesForKeys: [.fileSizeKey],
                    options: [.skipsHiddenFiles, .skipsPackageDescendants]
                  ) else {
                continue
            }

            for case let fileURL as URL in enumerator {
                let ext = fileURL.pathExtension.lowercased()
                guard allowedExtensions.contains(ext) else { continue }
                let name = fileURL.lastPathComponent
                let relativePath = fileURL.path.replacingOccurrences(of: rootURL.path, with: "")
                let family = inferFamily(name: name, relativePath: relativePath)
                let contentType = inferContentType(name: name, relativePath: relativePath, ext: ext)
                let directoryProfile = profile(forDirectory: fileURL.deletingLastPathComponent(), cache: &directoryProfiles)
                let readiness = inferReadiness(
                    fileURL: fileURL,
                    ext: ext,
                    contentType: contentType,
                    directoryProfile: directoryProfile
                )
                let packageName = inferPackageName(fileURL: fileURL, directoryProfile: directoryProfile)
                let searchText = "\(name.lowercased()) \(relativePath.lowercased()) \(root.name.lowercased()) \(family) \(contentType) \(readiness.label.lowercased()) \(packageName.lowercased())"
                let sizeBytes = (try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
                entries.append(
                    IndexedEntry(
                        name: name,
                        path: fileURL.path,
                        kind: kind(forExtension: ext),
                        source: root.name,
                        extensionName: ext,
                        family: family,
                        contentType: contentType,
                        readiness: readiness.label,
                        packageName: packageName,
                        packageScore: readiness.score,
                        nearbySampleCount: directoryProfile.audioFileCount,
                        sizeBytes: sizeBytes,
                        searchText: searchText
                    )
                )
            }
        }

        let index = PersistedIndex(updatedAt: Date(), entries: entries)
        if let data = try? JSONEncoder().encode(index) {
            try? data.write(to: indexURL(), options: .atomic)
        }
        return entries.count
    }

    private func searchLocalSamplesSyncFromRoots(query: String, limit: Int) -> [SampleFinderResult] {
        let queryTokens = tokenize(query)
        let roots = listRoots()
        var results: [SampleFinderResult] = []
        var directoryProfiles: [String: DirectoryProfile] = [:]

        for root in roots {
            let rootURL = URL(fileURLWithPath: root.path, isDirectory: true)
            guard fileManager.fileExists(atPath: rootURL.path),
                  let enumerator = fileManager.enumerator(
                    at: rootURL,
                    includingPropertiesForKeys: [.fileSizeKey],
                    options: [.skipsHiddenFiles, .skipsPackageDescendants]
                  ) else {
                continue
            }

            for case let fileURL as URL in enumerator {
                let ext = fileURL.pathExtension.lowercased()
                guard allowedExtensions.contains(ext) else { continue }
                let filename = fileURL.deletingPathExtension().lastPathComponent
                let relativePath = fileURL.path.replacingOccurrences(of: rootURL.path, with: "")
                let haystack = "\(filename) \(relativePath)".lowercased()
                let score = scoreMatch(tokens: queryTokens, haystack: haystack, filename: filename.lowercased(), ext: ext)
                guard queryTokens.isEmpty || score > 0 else { continue }

                let family = inferFamily(name: fileURL.lastPathComponent, relativePath: relativePath)
                let contentType = inferContentType(name: fileURL.lastPathComponent, relativePath: relativePath, ext: ext)
                let directoryProfile = profile(forDirectory: fileURL.deletingLastPathComponent(), cache: &directoryProfiles)
                let readiness = inferReadiness(
                    fileURL: fileURL,
                    ext: ext,
                    contentType: contentType,
                    directoryProfile: directoryProfile
                )
                let sizeBytes = (try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
                results.append(
                    SampleFinderResult(
                        name: fileURL.lastPathComponent,
                        path: fileURL.path,
                        kind: kind(forExtension: ext),
                        source: root.name,
                        extensionName: ext,
                        family: family,
                        contentType: contentType,
                        readiness: readiness.label,
                        packageName: inferPackageName(fileURL: fileURL, directoryProfile: directoryProfile),
                        packageScore: readiness.score,
                        nearbySampleCount: directoryProfile.audioFileCount,
                        sizeBytes: sizeBytes,
                        matchScore: score
                    )
                )
            }
        }

        return sortResults(results, limit: limit)
    }

    private func loadIndex() -> PersistedIndex? {
        guard let data = try? Data(contentsOf: indexURL()) else { return nil }
        return try? JSONDecoder().decode(PersistedIndex.self, from: data)
    }

    private func indexURL() -> URL {
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let directory = appSupport.appendingPathComponent("MagicDAW", isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent(indexFileName)
    }

    private func defaultRoots() -> [PersistedRoot] {
        let home = fileManager.homeDirectoryForCurrentUser
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        var roots: [PersistedRoot] = [
            PersistedRoot(path: home.appendingPathComponent("Downloads", isDirectory: true).path, name: "Downloads", source: "Default"),
            PersistedRoot(path: home.appendingPathComponent("Desktop", isDirectory: true).path, name: "Desktop", source: "Default"),
            PersistedRoot(path: home.appendingPathComponent("Documents", isDirectory: true).path, name: "Documents", source: "Default"),
            PersistedRoot(path: home.appendingPathComponent("Music", isDirectory: true).path, name: "Music", source: "Default"),
        ]
        if let appSupport {
            roots.append(PersistedRoot(
                path: appSupport.appendingPathComponent("MagicDAW", isDirectory: true).appendingPathComponent("SampleInstruments", isDirectory: true).path,
                name: "MagicDAW Library",
                source: "Default"
            ))
        }
        roots.append(PersistedRoot(
            path: URL(fileURLWithPath: fileManager.currentDirectoryPath).appendingPathComponent("DemoInstruments", isDirectory: true).path,
            name: "DemoInstruments",
            source: "Default"
        ))
        return roots
    }

    private func persistRoots(_ roots: [PersistedRoot]) {
        if let data = try? JSONEncoder().encode(roots) {
            UserDefaults.standard.set(data, forKey: rootsKey)
        }
    }

    private func tokenize(_ query: String) -> [String] {
        query
            .lowercased()
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
            .filter { !$0.isEmpty }
    }

    private func scoreMatch(tokens: [String], haystack: String, filename: String, ext: String) -> Int {
        guard !tokens.isEmpty else {
            return ext == "sfz" || ext == "magicinstrument" ? 3 : 1
        }
        var score = 0
        for token in tokens {
            guard haystack.contains(token) else { return 0 }
            score += filename.contains(token) ? 6 : 3
        }
        if ext == "sfz" || ext == "magicinstrument" {
            score += 3
        }
        return score
    }

    private func sortResults(_ results: [SampleFinderResult], limit: Int) -> [SampleFinderResult] {
        results
            .sorted {
                if $0.matchScore == $1.matchScore {
                    if $0.packageScore == $1.packageScore {
                        return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                    }
                    return $0.packageScore > $1.packageScore
                }
                return $0.matchScore > $1.matchScore
            }
            .prefix(limit)
            .map { $0 }
    }

    private func profile(forDirectory directoryURL: URL, cache: inout [String: DirectoryProfile]) -> DirectoryProfile {
        if let cached = cache[directoryURL.path] {
            return cached
        }

        var audioFileCount = 0
        var hasSFZ = false
        var hasRack = false

        if let contents = try? fileManager.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) {
            for itemURL in contents {
                let ext = itemURL.pathExtension.lowercased()
                guard allowedExtensions.contains(ext) else { continue }
                if ext == "sfz" {
                    hasSFZ = true
                } else if ext == "magicinstrument" {
                    hasRack = true
                } else {
                    audioFileCount += 1
                }
            }
        }

        let profile = DirectoryProfile(
            directoryName: directoryURL.lastPathComponent,
            audioFileCount: audioFileCount,
            hasSFZ: hasSFZ,
            hasRack: hasRack
        )
        cache[directoryURL.path] = profile
        return profile
    }

    private func inferReadiness(fileURL: URL, ext: String, contentType: String, directoryProfile: DirectoryProfile) -> ReadinessProfile {
        if ext == "magicinstrument" {
            return ReadinessProfile(label: "ready rack", score: 120)
        }
        if ext == "sfz" {
            return ReadinessProfile(label: "ready sfz", score: 110)
        }
        if directoryProfile.hasRack || directoryProfile.hasSFZ {
            return ReadinessProfile(label: "mapped companion", score: 85)
        }
        if contentType == "multisample" || directoryProfile.audioFileCount >= 12 {
            return ReadinessProfile(label: "multisample candidate", score: 55)
        }
        if contentType == "loop" {
            return ReadinessProfile(label: "loop ready", score: 35)
        }
        if contentType == "one-shot" || directoryProfile.audioFileCount <= 4 {
            return ReadinessProfile(label: "one-shot", score: 20)
        }
        return ReadinessProfile(label: "loose sample", score: 10)
    }

    private func inferPackageName(fileURL: URL, directoryProfile: DirectoryProfile) -> String {
        let directoryName = directoryProfile.directoryName
        let parentName = fileURL.deletingLastPathComponent().deletingLastPathComponent().lastPathComponent
        if directoryName.lowercased() == "samples", !parentName.isEmpty {
            return parentName
        }
        return directoryName.isEmpty ? "Library" : directoryName
    }

    private func kind(forExtension ext: String) -> String {
        switch ext {
        case "sfz":
            return "sfz"
        case "magicinstrument":
            return "rack"
        default:
            return "sample"
        }
    }

    private func inferFamily(name: String, relativePath: String) -> String {
        let haystack = "\(name) \(relativePath)".lowercased()
        let familyKeywords: [(String, [String])] = [
            ("piano", ["piano", "felt", "upright", "grand", "keys", "epiano", "rhodes", "wurl", "keyscape"]),
            ("drums", ["drum", "kick", "snare", "hat", "clap", "tom", "cymbal", "perc", "percussion", "kit"]),
            ("bass", ["bass", "sub", "808"]),
            ("guitar", ["guitar", "strat", "tele", "acoustic", "electric guitar", "ukulele", "mandolin"]),
            ("strings", ["string", "violin", "viola", "cello", "contrabass", "ensemble"]),
            ("brass", ["brass", "trumpet", "trombone", "horn", "tuba"]),
            ("woodwind", ["flute", "clarinet", "oboe", "bassoon", "sax", "woodwind"]),
            ("voice", ["voice", "vocal", "choir", "vox", "ahh", "ooh"]),
            ("synth", ["synth", "analog", "saw", "lead", "pad", "pluck", "arp"]),
            ("mallet", ["mallet", "marimba", "vibe", "vibraphone", "xylophone", "glock", "bell"]),
            ("fx", ["fx", "impact", "riser", "sweep", "hit", "transition", "texture", "cinematic"]),
            ("ambient", ["ambient", "atmo", "atmos", "drone", "soundscape", "field", "noise"]),
        ]
        for (family, keywords) in familyKeywords where keywords.contains(where: { haystack.contains($0) }) {
            return family
        }
        return "other"
    }

    private func inferContentType(name: String, relativePath: String, ext: String) -> String {
        if ext == "sfz" || ext == "magicinstrument" {
            return "multisample"
        }

        let haystack = "\(name) \(relativePath)".lowercased()
        let loopKeywords = ["loop", "loops", "bpm", "groove"]
        let oneShotKeywords = ["oneshot", "one-shot", "one shot", "hit", "stab", "shot"]
        let multiKeywords = ["multi", "multisample", "sustain", "rr", "roundrobin", "velocity"]

        if loopKeywords.contains(where: { haystack.contains($0) }) {
            return "loop"
        }
        if oneShotKeywords.contains(where: { haystack.contains($0) }) {
            return "one-shot"
        }
        if multiKeywords.contains(where: { haystack.contains($0) }) {
            return "multisample"
        }
        return "sample"
    }
}

private struct DirectoryProfile {
    let directoryName: String
    let audioFileCount: Int
    let hasSFZ: Bool
    let hasRack: Bool
}

private struct ReadinessProfile {
    let label: String
    let score: Int
}

private struct PersistedRoot: Codable {
    let path: String
    let name: String
    let source: String

    init(path: String, name: String, source: String) {
        self.path = path
        self.name = name
        self.source = source
    }

    init(_ root: SampleFinderRoot) {
        self.path = root.path
        self.name = root.name
        self.source = root.source
    }
}

private struct PersistedIndex: Codable {
    let updatedAt: Date
    let entries: [IndexedEntry]
}

private struct IndexedEntry: Codable {
    let name: String
    let path: String
    let kind: String
    let source: String
    let extensionName: String
    let family: String
    let contentType: String
    let readiness: String
    let packageName: String
    let packageScore: Int
    let nearbySampleCount: Int
    let sizeBytes: Int64
    let searchText: String
}
