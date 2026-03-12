import Foundation

enum SFZImporterError: LocalizedError {
    case invalidFile
    case noRegions
    case missingSample(String)

    var errorDescription: String? {
        switch self {
        case .invalidFile:
            return "Unable to read SFZ file."
        case .noRegions:
            return "No playable <region> entries were found in the SFZ."
        case .missingSample(let samplePath):
            return "Missing sample referenced by SFZ: \(samplePath)"
        }
    }
}

final class SFZImporter {
    private struct ParsedRegion {
        let opcodes: [String: String]
    }

    func loadInstrument(from sfzURL: URL) throws -> LoadedInstrumentDefinition {
        let source = try String(contentsOf: sfzURL, encoding: .utf8)
        let sanitized = removeComments(from: source)
        let parsedRegions = parseRegions(from: sanitized)
        guard !parsedRegions.isEmpty else {
            throw SFZImporterError.noRegions
        }

        let instrumentFolder = sfzURL.deletingLastPathComponent()
        var definition = InstrumentDefinition(
            name: sfzURL.deletingPathExtension().lastPathComponent,
            type: .sampler
        )

        var regions: [LoadedSampleRegion] = []
        var envelope = definition.envelope ?? .defaultPiano
        var sawEnvelopeOverride = false

        for parsed in parsedRegions {
            guard let samplePath = parsed.opcodes["sample"], !samplePath.isEmpty else { continue }
            let resolvedSampleURL = instrumentFolder.appendingPathComponent(samplePath).standardizedFileURL
            guard FileManager.default.fileExists(atPath: resolvedSampleURL.path) else {
                throw SFZImporterError.missingSample(samplePath)
            }

            let rootNote = UInt8(clampMidi(parseMidiValue(parsed.opcodes["pitch_keycenter"])
                ?? parseMidiValue(parsed.opcodes["key"])
                ?? parseMidiValue(parsed.opcodes["lokey"])
                ?? 60))
            let lowNote = UInt8(clampMidi(parseMidiValue(parsed.opcodes["lokey"])
                ?? parseMidiValue(parsed.opcodes["key"])
                ?? Int(rootNote)))
            let highNote = UInt8(clampMidi(parseMidiValue(parsed.opcodes["hikey"])
                ?? parseMidiValue(parsed.opcodes["key"])
                ?? Int(rootNote)))
            let lowVelocity = UInt8(clampVelocity(Int(parsed.opcodes["lovel"] ?? "") ?? 0))
            let highVelocity = UInt8(clampVelocity(Int(parsed.opcodes["hivel"] ?? "") ?? 127))
            let tuning = Double(parsed.opcodes["tune"] ?? "") ?? 0
            let loopStart = Int(parsed.opcodes["loop_start"] ?? "")
            let loopEnd = Int(parsed.opcodes["loop_end"] ?? "")
            let trigger = parseTriggerOpcode(parsed.opcodes["trigger"])

            let relativeSamplePath = standardizedRelativePath(from: instrumentFolder, to: resolvedSampleURL)
            let zone = SampleZone(
                sampleFile: relativeSamplePath,
                trigger: trigger,
                rootNote: rootNote,
                lowNote: min(lowNote, highNote),
                highNote: max(lowNote, highNote),
                lowVelocity: min(lowVelocity, highVelocity),
                highVelocity: max(lowVelocity, highVelocity),
                loopStart: loopStart,
                loopEnd: loopEnd,
                tuning: tuning
            )
            regions.append(LoadedSampleRegion(sampleURL: resolvedSampleURL, zone: zone))

            if let attack = secondsOpcode(parsed.opcodes["ampeg_attack"]) {
                envelope.attack = attack
                sawEnvelopeOverride = true
            }
            if let decay = secondsOpcode(parsed.opcodes["ampeg_decay"]) {
                envelope.decay = decay
                sawEnvelopeOverride = true
            }
            if let sustain = percentOpcode(parsed.opcodes["ampeg_sustain"]) {
                envelope.sustain = sustain
                sawEnvelopeOverride = true
            }
            if let release = secondsOpcode(parsed.opcodes["ampeg_release"]) {
                envelope.release = release
                sawEnvelopeOverride = true
            }
        }

        guard !regions.isEmpty else {
            throw SFZImporterError.noRegions
        }

        definition.zones = regions.map(\.zone)
        definition.velocityLayers = max(1, Set(regions.map { "\($0.zone.lowVelocity)-\($0.zone.highVelocity)" }).count)
        definition.roundRobin = hasRoundRobinLayers(parsedRegions)
        definition.polyphony = max(16, regions.count)
        if sawEnvelopeOverride {
            envelope.clamp()
            definition.envelope = envelope
        }

        return LoadedInstrumentDefinition(
            definitionURL: sfzURL,
            definition: definition,
            regions: regions
        )
    }

    private func parseRegions(from source: String) -> [ParsedRegion] {
        let tokenPattern = #"<[^>]+>|[A-Za-z0-9_]+=(?:"[^"]*"|[^\s<]+)"#
        guard let regex = try? NSRegularExpression(pattern: tokenPattern) else { return [] }
        let matches = regex.matches(in: source, range: NSRange(source.startIndex..., in: source))

        var globals: [String: String] = [:]
        var group: [String: String] = [:]
        var regions: [ParsedRegion] = []
        var currentTag = ""
        var pendingRegion: [String: String]?

        func commitPendingRegion() {
            if let pendingRegion, pendingRegion["sample"] != nil {
                regions.append(ParsedRegion(opcodes: pendingRegion))
            }
        }

        for match in matches {
            guard let range = Range(match.range, in: source) else { continue }
            let token = String(source[range]).trimmingCharacters(in: .whitespacesAndNewlines)
            if token.hasPrefix("<"), token.hasSuffix(">") {
                let tagName = token.dropFirst().dropLast().lowercased()
                if tagName == "region" {
                    commitPendingRegion()
                    pendingRegion = globals.merging(group, uniquingKeysWith: { _, new in new })
                } else if tagName == "group" {
                    commitPendingRegion()
                    pendingRegion = nil
                    group = globals
                } else if tagName == "global" {
                    commitPendingRegion()
                    pendingRegion = nil
                    globals.removeAll()
                    group.removeAll()
                }
                currentTag = String(tagName)
                continue
            }

            let parts = token.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { continue }
            let key = parts[0].lowercased()
            let value = unquote(parts[1])

            switch currentTag {
            case "global":
                globals[key] = value
                group[key] = value
            case "group":
                group[key] = value
            case "region":
                if pendingRegion == nil {
                    pendingRegion = globals.merging(group, uniquingKeysWith: { _, new in new })
                }
                pendingRegion?[key] = value
            default:
                break
            }
        }

        commitPendingRegion()
        return regions
    }

    private func removeComments(from text: String) -> String {
        text
            .components(separatedBy: .newlines)
            .map { line in
                if let commentRange = line.range(of: "//") {
                    return String(line[..<commentRange.lowerBound])
                }
                return line
            }
            .joined(separator: "\n")
    }

    private func unquote(_ value: String) -> String {
        guard value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 else { return value }
        return String(value.dropFirst().dropLast())
    }

    private func parseMidiValue(_ raw: String?) -> Int? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        if let intValue = Int(raw) {
            return intValue
        }

        let pattern = #"(?i)^([A-G])([#B]?)(-?\d)$"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)),
              let noteRange = Range(match.range(at: 1), in: raw),
              let accidentalRange = Range(match.range(at: 2), in: raw),
              let octaveRange = Range(match.range(at: 3), in: raw) else {
            return nil
        }

        let noteName = String(raw[noteRange]).uppercased()
        let accidental = String(raw[accidentalRange]).uppercased()
        let octave = Int(raw[octaveRange]) ?? 4

        let base: Int
        switch noteName {
        case "C": base = 0
        case "D": base = 2
        case "E": base = 4
        case "F": base = 5
        case "G": base = 7
        case "A": base = 9
        case "B": base = 11
        default: return nil
        }

        let accidentalOffset: Int
        switch accidental {
        case "#": accidentalOffset = 1
        case "B": accidentalOffset = -1
        default: accidentalOffset = 0
        }

        return (octave + 1) * 12 + base + accidentalOffset
    }

    private func secondsOpcode(_ raw: String?) -> Float? {
        guard let raw, let value = Double(raw) else { return nil }
        return max(0.001, Float(value))
    }

    private func percentOpcode(_ raw: String?) -> Float? {
        guard let raw, let value = Double(raw) else { return nil }
        return Float(max(0, min(100, value)) / 100.0)
    }

    private func clampMidi(_ value: Int) -> Int {
        max(0, min(127, value))
    }

    private func clampVelocity(_ value: Int) -> Int {
        max(0, min(127, value))
    }

    private func standardizedRelativePath(from baseURL: URL, to fileURL: URL) -> String {
        let basePath = baseURL.standardizedFileURL.path
        let fullPath = fileURL.standardizedFileURL.path
        if fullPath.hasPrefix(basePath + "/") {
            return String(fullPath.dropFirst(basePath.count + 1))
        }
        return fileURL.lastPathComponent
    }

    private func parseTriggerOpcode(_ raw: String?) -> SampleTrigger {
        switch raw?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "release":
            return .release
        default:
            return .attack
        }
    }

    private func hasRoundRobinLayers(_ regions: [ParsedRegion]) -> Bool {
        regions.contains { parsed in
            parsed.opcodes["seq_position"] != nil || parsed.opcodes["lorand"] != nil || parsed.opcodes["hirand"] != nil
        }
    }
}
