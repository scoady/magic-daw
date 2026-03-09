import Foundation

/// Routes incoming MIDI events to audio engines, samplers, and analysis callbacks.
class MIDIRouter {
    let midiManager: MIDIManager
    let audioEngine: AudioEngine
    var sampler: Sampler?

    // Active notes for chord detection
    private(set) var activeNotes: Set<UInt8> = []

    // Callbacks
    var onNotesChanged: ((Set<UInt8>) -> Void)?
    var onChordDetected: ((MIDIChord?) -> Void)?

    /// Callback when ChordAnalyzer detects a chord (richer than MIDIChord).
    var onAnalyzedChord: ((MusicChord?) -> Void)?

    /// Callback when the real-time key detector updates.
    var onKeyDetected: ((MusicalKey?) -> Void)?

    /// Callback when harmony suggestions are ready.
    var onChordSuggestions: (([ChordSuggestion]) -> Void)?

    // Real-time key detection via Krumhansl-Schmuckler sliding window
    let keyDetector = RealtimeKeyDetector(windowDuration: 8.0)

    // AI harmony service (set externally after init)
    var harmonyService: HarmonyService?

    // Note history for key detection (timestamps)
    private var noteOnTimes: [UInt8: TimeInterval] = [:]

    // Debounce timer for chord detection (notes arrive sequentially even when played together)
    private var chordDetectionTimer: DispatchSourceTimer?
    private let chordDetectionDelay: TimeInterval = 0.05 // 50ms window

    // Debounce for AI suggestion requests
    private var suggestionTask: Task<Void, Never>?

    init(midiManager: MIDIManager, audioEngine: AudioEngine) {
        self.midiManager = midiManager
        self.audioEngine = audioEngine
    }

    func setup() {
        midiManager.onNoteOn = { [weak self] note, velocity, channel in
            self?.handleNoteOn(note: note, velocity: velocity, channel: channel)
        }

        midiManager.onNoteOff = { [weak self] note, channel in
            self?.handleNoteOff(note: note, channel: channel)
        }

        midiManager.onControlChange = { [weak self] cc, value, channel in
            self?.handleControlChange(cc: cc, value: value, channel: channel)
        }

        midiManager.onPitchBend = { [weak self] value, channel in
            self?.handlePitchBend(value: value, channel: channel)
        }
    }

    // MARK: - Note Handling

    private func handleNoteOn(note: UInt8, velocity: UInt8, channel: UInt8) {
        activeNotes.insert(note)
        noteOnTimes[note] = ProcessInfo.processInfo.systemUptime
        sampler?.noteOn(note: note, velocity: velocity)

        // Feed the real-time key detector
        keyDetector.update(
            note: note,
            velocity: velocity,
            timestamp: ProcessInfo.processInfo.systemUptime,
            duration: 0.25 // estimate; updated on note-off
        )

        onNotesChanged?(activeNotes)
        scheduleChordDetection()
    }

    private func handleNoteOff(note: UInt8, channel: UInt8) {
        // Update key detector with actual duration
        if let onTime = noteOnTimes.removeValue(forKey: note) {
            let duration = ProcessInfo.processInfo.systemUptime - onTime
            keyDetector.update(
                note: note,
                velocity: 64,
                timestamp: onTime,
                duration: duration
            )
        }

        activeNotes.remove(note)
        sampler?.noteOff(note: note)
        onNotesChanged?(activeNotes)
        scheduleChordDetection()
    }

    private func handleControlChange(cc: UInt8, value: UInt8, channel: UInt8) {
        // Common CC mappings
        switch cc {
        case 1: // Mod wheel — map to filter cutoff
            let normalizedValue = Float(value) / 127.0
            sampler?.filterCutoff = 200 + normalizedValue * 19800 // 200 Hz to 20 kHz
        case 7: // Volume
            break
        case 10: // Pan
            break
        case 64: // Sustain pedal
            if value < 64 {
                // Pedal up — could release sustained notes
            }
        case 120, 123: // All sound off / All notes off
            sampler?.allNotesOff()
            activeNotes.removeAll()
            noteOnTimes.removeAll()
            onNotesChanged?(activeNotes)
            onChordDetected?(nil)
            onAnalyzedChord?(nil)
        default:
            break
        }
    }

    private func handlePitchBend(value: UInt16, channel: UInt8) {
        // Pitch bend center is 8192 (0x2000), range 0-16383
        // Could apply to sampler pitch offset
    }

    // MARK: - Chord Detection

    private func scheduleChordDetection() {
        chordDetectionTimer?.cancel()

        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + chordDetectionDelay)
        timer.setEventHandler { [weak self] in
            guard let self else { return }

            // Legacy MIDIChord detection (kept for backward compat)
            let midiChord = MIDIChord.detect(from: self.activeNotes)
            self.onChordDetected?(midiChord)

            // Rich chord analysis via ChordAnalyzer
            let noteArray = Array(self.activeNotes)
            let detectedKey = self.keyDetector.currentKey
            let analyzed = ChordAnalyzer.analyze(midiNotes: noteArray, in: detectedKey)
            self.onAnalyzedChord?(analyzed)

            // Emit current key estimate
            self.onKeyDetected?(detectedKey)

            // Request AI chord suggestions (debounced)
            if let analyzed = analyzed {
                self.requestChordSuggestions(currentChord: analyzed, key: detectedKey)
            }
        }
        timer.resume()
        chordDetectionTimer = timer
    }

    /// Request next-chord suggestions from HarmonyService (AI with algorithmic fallback).
    /// Debounced: cancels any in-flight request when a new chord is detected.
    private func requestChordSuggestions(currentChord: MusicChord, key: MusicalKey?) {
        suggestionTask?.cancel()

        let service = self.harmonyService
        let effectiveKey = key ?? MusicalKey(tonic: .C, mode: ScaleType.major, confidence: 0.0)
        let callback = self.onChordSuggestions

        suggestionTask = Task {
            guard let service = service else {
                // No harmony service — use algorithmic fallback directly
                let fallback = AIHarmonyFallback()
                let suggestions = fallback.suggestNextChord(currentChord: currentChord, key: effectiveKey)
                guard !Task.isCancelled else { return }
                DispatchQueue.main.async {
                    callback?(suggestions)
                }
                return
            }

            let suggestions = await service.suggestNextChord(
                currentChord: currentChord,
                key: effectiveKey,
                style: nil
            )
            guard !Task.isCancelled else { return }
            DispatchQueue.main.async {
                callback?(suggestions)
            }
        }
    }

    /// Release all active notes and reset state.
    func panic() {
        sampler?.allNotesOff()
        activeNotes.removeAll()
        noteOnTimes.removeAll()
        suggestionTask?.cancel()
        onNotesChanged?(activeNotes)
        onChordDetected?(nil)
        onAnalyzedChord?(nil)
        onKeyDetected?(keyDetector.currentKey)
    }
}

// MARK: - MIDIChord

/// A detected chord from a set of active MIDI notes.
struct MIDIChord {
    let root: UInt8
    let name: String
    let type: ChordType
    let notes: [UInt8]

    enum ChordType: String {
        case major, minor
        case diminished, augmented
        case dominant7, major7, minor7
        case sus2, sus4
        case power
        case unknown
    }

    /// Attempt to detect a chord from a set of MIDI note numbers.
    static func detect(from notes: Set<UInt8>) -> MIDIChord? {
        guard notes.count >= 2 else { return nil }

        let sorted = notes.sorted()
        // Normalize to pitch classes (0-11)
        let pitchClasses = Set(sorted.map { $0 % 12 })

        // Try each note as potential root, starting from lowest
        for root in sorted {
            let rootPC = root % 12
            // Calculate intervals relative to this root
            let intervals = Set(pitchClasses.map { pc -> Int in
                (Int(pc) - Int(rootPC) + 12) % 12
            })

            if let type = matchChordType(intervals: intervals) {
                let noteName = noteNames[Int(rootPC)]
                let typeSuffix: String
                switch type {
                case .major: typeSuffix = ""
                case .minor: typeSuffix = "m"
                case .diminished: typeSuffix = "dim"
                case .augmented: typeSuffix = "aug"
                case .dominant7: typeSuffix = "7"
                case .major7: typeSuffix = "maj7"
                case .minor7: typeSuffix = "m7"
                case .sus2: typeSuffix = "sus2"
                case .sus4: typeSuffix = "sus4"
                case .power: typeSuffix = "5"
                case .unknown: typeSuffix = "?"
                }

                return MIDIChord(
                    root: root,
                    name: "\(noteName)\(typeSuffix)",
                    type: type,
                    notes: sorted
                )
            }
        }

        // Fallback: unknown chord
        return MIDIChord(
            root: sorted[0],
            name: "\(noteNames[Int(sorted[0] % 12)])?",
            type: .unknown,
            notes: sorted
        )
    }

    private static let noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

    private static func matchChordType(intervals: Set<Int>) -> ChordType? {
        // Check from most specific (7th chords) to least specific (power chords)
        if intervals.isSuperset(of: [0, 4, 7, 11]) { return .major7 }
        if intervals.isSuperset(of: [0, 3, 7, 10]) { return .minor7 }
        if intervals.isSuperset(of: [0, 4, 7, 10]) { return .dominant7 }
        if intervals.isSuperset(of: [0, 4, 8]) { return .augmented }
        if intervals.isSuperset(of: [0, 3, 6]) { return .diminished }
        if intervals.isSuperset(of: [0, 4, 7]) { return .major }
        if intervals.isSuperset(of: [0, 3, 7]) { return .minor }
        if intervals.isSuperset(of: [0, 2, 7]) { return .sus2 }
        if intervals.isSuperset(of: [0, 5, 7]) { return .sus4 }
        if intervals == [0, 7] { return .power }
        return nil
    }
}
