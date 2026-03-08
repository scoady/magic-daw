// KeyDetector.swift
// MagicDAW
//
// Krumhansl-Schmuckler key detection algorithm with real-time sliding window.
// Correlates pitch-class distributions against empirical key profiles to determine
// the most likely musical key from MIDI note events.

import Foundation

// MARK: - KeyDetector (static analysis)

/// Static key detection using the Krumhansl-Schmuckler algorithm.
///
/// For one-shot analysis of a clip or note collection, use `detectKey(from:)`.
/// For real-time streaming, use `RealtimeKeyDetector`.
struct KeyDetector: Sendable {

    // MARK: - Krumhansl-Kessler Key Profiles

    /// Empirical pitch-class ratings for major keys (Krumhansl & Kessler, 1990).
    /// Index 0 = tonic, index 1 = minor second, ... index 11 = major seventh.
    static let majorProfile: [Double] = [
        6.35,  // tonic
        2.23,  // m2
        3.48,  // M2
        2.33,  // m3
        4.38,  // M3
        4.09,  // P4
        2.52,  // tritone
        5.19,  // P5
        2.39,  // m6
        3.66,  // M6
        2.29,  // m7
        2.88   // M7
    ]

    /// Empirical pitch-class ratings for minor keys (Krumhansl & Kessler, 1990).
    static let minorProfile: [Double] = [
        6.33,  // tonic
        2.68,  // m2
        3.52,  // M2
        5.38,  // m3
        2.60,  // M3
        3.53,  // P4
        2.54,  // tritone
        4.75,  // P5
        3.98,  // m6
        2.69,  // M6
        3.34,  // m7
        3.17   // M7
    ]

    // MARK: - Static Detection

    /// Detect the key from a collection of weighted notes.
    ///
    /// - Parameter notes: Pitch classes with associated weights (duration * velocity).
    /// - Returns: The most likely key with a confidence score.
    static func detectKey(from notes: [WeightedNote]) -> Key {
        guard !notes.isEmpty else {
            return Key(tonic: .C, mode: .major, confidence: 0.0)
        }

        // Build pitch-class distribution (12 bins)
        var distribution = [Double](repeating: 0.0, count: 12)
        for note in notes {
            distribution[note.pitchClass.rawValue] += note.weight
        }

        return detectKey(fromDistribution: distribution)
    }

    /// Detect key from a raw 12-bin pitch-class distribution.
    static func detectKey(fromDistribution distribution: [Double]) -> Key {
        precondition(distribution.count == 12, "Distribution must have exactly 12 bins.")

        let total = distribution.reduce(0.0, +)
        guard total > 0 else {
            return Key(tonic: .C, mode: .major, confidence: 0.0)
        }

        // Normalise distribution
        let normalised = distribution.map { $0 / total }

        // Correlate with all 24 possible keys (12 major + 12 minor)
        var results: [(key: Key, correlation: Double)] = []
        results.reserveCapacity(24)

        for root in NoteName.allCases {
            let rotated = rotateDistribution(normalised, by: root.rawValue)

            let majorCorr = pearsonCorrelation(rotated, majorProfile)
            results.append((Key(tonic: root, mode: .major, confidence: majorCorr), majorCorr))

            let minorCorr = pearsonCorrelation(rotated, minorProfile)
            results.append((Key(tonic: root, mode: .naturalMinor, confidence: minorCorr), minorCorr))
        }

        results.sort { $0.correlation > $1.correlation }

        guard let best = results.first else {
            return Key(tonic: .C, mode: .major, confidence: 0.0)
        }

        // Confidence: normalised gap between 1st and 2nd place.
        let confidence: Double
        if results.count >= 2 {
            let diff = best.correlation - results[1].correlation
            // diff > 0.15 is very confident; < 0.02 is ambiguous
            confidence = min(1.0, max(0.0, diff / 0.15))
        } else {
            confidence = min(1.0, max(0.0, best.correlation))
        }

        return Key(tonic: best.key.tonic, mode: best.key.mode, confidence: confidence)
    }

    /// Detect key from raw MIDI note numbers (all weighted equally).
    static func detectKey(fromMIDINotes notes: [UInt8]) -> Key {
        let weighted = notes.map { WeightedNote(midiNote: $0) }
        return detectKey(from: weighted)
    }

    /// Detect key from MIDI notes weighted by duration and velocity.
    static func detectKey(fromNoteEvents events: [NoteEvent]) -> Key {
        let weighted = events.map { event -> WeightedNote in
            let duration = event.duration ?? 0.25
            let weight = duration * (Double(event.velocity) / 127.0)
            return WeightedNote(pitchClass: event.noteName, weight: max(0.01, weight))
        }
        return detectKey(from: weighted)
    }

    /// Return all 24 key correlations, sorted descending by correlation.
    static func allCorrelations(from notes: [WeightedNote]) -> [(key: Key, correlation: Double)] {
        guard !notes.isEmpty else { return [] }

        var distribution = [Double](repeating: 0.0, count: 12)
        for note in notes {
            distribution[note.pitchClass.rawValue] += note.weight
        }
        let total = distribution.reduce(0.0, +)
        guard total > 0 else { return [] }
        let normalised = distribution.map { $0 / total }

        var results: [(key: Key, correlation: Double)] = []
        results.reserveCapacity(24)

        for root in NoteName.allCases {
            let rotated = rotateDistribution(normalised, by: root.rawValue)
            let majorCorr = pearsonCorrelation(rotated, majorProfile)
            results.append((Key(tonic: root, mode: .major, confidence: majorCorr), majorCorr))
            let minorCorr = pearsonCorrelation(rotated, minorProfile)
            results.append((Key(tonic: root, mode: .naturalMinor, confidence: minorCorr), minorCorr))
        }

        return results.sorted { $0.correlation > $1.correlation }
    }

    // MARK: - Math Utilities

    /// Rotate an array so that element at `offset` becomes element 0.
    private static func rotateDistribution(_ distribution: [Double], by offset: Int) -> [Double] {
        let n = distribution.count
        return (0..<n).map { distribution[($0 + offset) % n] }
    }

    /// Pearson correlation coefficient between two equal-length arrays.
    static func pearsonCorrelation(_ x: [Double], _ y: [Double]) -> Double {
        let n = Double(x.count)
        guard n > 0, x.count == y.count else { return 0.0 }

        let sumX = x.reduce(0.0, +)
        let sumY = y.reduce(0.0, +)
        let sumXY = zip(x, y).reduce(0.0) { $0 + $1.0 * $1.1 }
        let sumX2 = x.reduce(0.0) { $0 + $1 * $1 }
        let sumY2 = y.reduce(0.0) { $0 + $1 * $1 }

        let numerator = n * sumXY - sumX * sumY
        let denominator = sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))

        guard denominator > 1e-10 else { return 0.0 }
        return numerator / denominator
    }
}

// MARK: - RealtimeKeyDetector

/// Sliding-window key detector for real-time MIDI event streams.
///
/// Maintains a time-windowed buffer of recent note events. Call `update(note:...)` on every
/// MIDI note-on event and read `currentKey` at any time.
///
/// The window discards events older than `windowDuration` (default: 8 seconds, roughly
/// 4 bars at 120 BPM). Events are weighted by `duration * velocity/127`.
final class RealtimeKeyDetector: @unchecked Sendable {

    // MARK: - Configuration

    /// Length of the analysis window in seconds.
    var windowDuration: TimeInterval

    /// Minimum distinct pitch classes required before producing a key estimate.
    var minimumPitchClasses: Int = 3

    /// Minimum total weight before producing a key estimate.
    var minimumWeight: Double = 0.5

    // MARK: - State

    private struct Entry {
        let pitchClass: Int
        let weight: Double
        let timestamp: TimeInterval
    }

    private var buffer: [Entry] = []
    private var distribution: [Double] = Array(repeating: 0.0, count: 12)
    private var latestTimestamp: TimeInterval = 0
    private let lock = NSLock()

    /// The most recently detected key, or nil if insufficient data.
    private(set) var currentKey: Key?

    /// All 24 correlations from the most recent analysis, sorted descending.
    private(set) var allCorrelations: [(key: Key, correlation: Double)] = []

    // MARK: - Init

    /// - Parameter windowDuration: Analysis window in seconds (default 8s ≈ 4 bars at 120 BPM).
    init(windowDuration: TimeInterval = 8.0) {
        self.windowDuration = windowDuration
    }

    // MARK: - Public API

    /// Process a new MIDI note event.
    ///
    /// - Parameters:
    ///   - note: MIDI note number (0-127).
    ///   - velocity: MIDI velocity (0-127).
    ///   - timestamp: Absolute time in seconds.
    ///   - duration: Note duration in seconds (estimate if note-off hasn't arrived).
    func update(note: MIDINote, velocity: Velocity = 100,
                timestamp: TimeInterval, duration: TimeInterval = 0.25) {
        lock.lock()
        defer { lock.unlock() }

        let weight = max(0.01, min(duration, 10.0)) * (Double(velocity) / 127.0)
        let pitchClass = Int(note) % 12

        buffer.append(Entry(pitchClass: pitchClass, weight: weight, timestamp: timestamp))
        distribution[pitchClass] += weight
        latestTimestamp = max(latestTimestamp, timestamp)

        pruneAndRecalculate()
    }

    /// Process a `NoteEvent` struct.
    func update(noteEvent: NoteEvent) {
        update(note: noteEvent.note, velocity: noteEvent.velocity,
               timestamp: noteEvent.timestamp, duration: noteEvent.duration ?? 0.25)
    }

    /// Add a note by MIDI number with a default weight (for simple use cases).
    @discardableResult
    func addNote(midiNote: UInt8, weight: Double = 1.0) -> Key {
        lock.lock()
        defer { lock.unlock() }

        let pitchClass = Int(midiNote) % 12
        let ts = latestTimestamp + 0.01
        buffer.append(Entry(pitchClass: pitchClass, weight: weight, timestamp: ts))
        distribution[pitchClass] += weight
        latestTimestamp = ts

        pruneAndRecalculate()
        return currentKey ?? Key(tonic: .C, mode: .major, confidence: 0.0)
    }

    /// Analyse a batch of weighted notes (useful for analysing an existing clip).
    func analyze(notes: [WeightedNote]) {
        lock.lock()
        defer { lock.unlock() }

        distribution = Array(repeating: 0.0, count: 12)
        buffer.removeAll()

        for wn in notes {
            distribution[wn.pitchClass.rawValue] += wn.weight
        }
        correlateAndUpdate()
    }

    /// Clear all state.
    func reset() {
        lock.lock()
        defer { lock.unlock() }

        buffer.removeAll()
        distribution = Array(repeating: 0.0, count: 12)
        currentKey = nil
        allCorrelations = []
        latestTimestamp = 0
    }

    // MARK: - Private

    private func pruneAndRecalculate() {
        let cutoff = latestTimestamp - windowDuration
        let beforeCount = buffer.count
        buffer.removeAll { $0.timestamp < cutoff }

        if buffer.count < beforeCount {
            distribution = Array(repeating: 0.0, count: 12)
            for entry in buffer {
                distribution[entry.pitchClass] += entry.weight
            }
        }
        correlateAndUpdate()
    }

    private func correlateAndUpdate() {
        let totalWeight = distribution.reduce(0, +)
        guard totalWeight >= minimumWeight else {
            currentKey = nil
            allCorrelations = []
            return
        }

        let distinctCount = distribution.filter { $0 > 0 }.count
        guard distinctCount >= minimumPitchClasses else {
            currentKey = nil
            allCorrelations = []
            return
        }

        // Normalise
        let normalised = distribution.map { $0 / totalWeight }

        var results: [(key: Key, correlation: Double)] = []
        results.reserveCapacity(24)

        for tonic in 0..<12 {
            let rotated = (0..<12).map { normalised[($0 + tonic) % 12] }
            let majorCorr = KeyDetector.pearsonCorrelation(rotated, KeyDetector.majorProfile)
            let minorCorr = KeyDetector.pearsonCorrelation(rotated, KeyDetector.minorProfile)
            let noteName = NoteName(rawValue: tonic)!
            results.append((Key(tonic: noteName, mode: .major), majorCorr))
            results.append((Key(tonic: noteName, mode: .naturalMinor), minorCorr))
        }

        results.sort { $0.correlation > $1.correlation }
        allCorrelations = results

        guard let best = results.first else { return }

        let second = results.count > 1 ? results[1].correlation : 0.0
        let confidence: Double
        if best.correlation > 0 {
            let diff = best.correlation - second
            confidence = min(1.0, max(0.0, diff / 0.15))
        } else {
            confidence = 0
        }

        currentKey = Key(tonic: best.key.tonic, mode: best.key.mode, confidence: confidence)
    }
}
