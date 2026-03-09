import Foundation

/// Records incoming MIDI note-on/off events with beat-accurate timestamps.
/// When recording stops, produces a Clip containing all captured MIDIEvents.
class MIDIRecorder {
    /// Whether the recorder is actively capturing events.
    private(set) var isRecording = false

    /// The beat position at which recording started (from AudioEngine.currentBeat).
    private var recordStartBeat: Double = 0.0

    /// Buffered note-on events keyed by (note, channel) awaiting their matching note-off.
    private var pendingNotes: [NoteKey: PendingNote] = [:]

    /// Completed MIDI events ready to become a Clip.
    private var completedEvents: [MIDIEvent] = []

    /// Optional quantize grid size in beats. 0 means no quantization.
    var quantizeGrid: Double = 0.0

    /// The track ID this recorder is capturing for.
    var trackID: UUID?

    /// Whether to merge into existing clips (overdub) or create a new clip.
    var overdubMode: Bool = false

    // MARK: - Recording Lifecycle

    /// Begin recording at the given transport beat position.
    func startRecording(atBeat beat: Double) {
        isRecording = true
        recordStartBeat = beat
        pendingNotes.removeAll()
        completedEvents.removeAll()
    }

    /// Feed a note-on event into the recorder.
    /// - Parameters:
    ///   - note: MIDI note number 0-127
    ///   - velocity: Note velocity 0-127
    ///   - channel: MIDI channel 0-15
    ///   - currentBeat: The current transport beat position
    func noteOn(note: UInt8, velocity: UInt8, channel: UInt8, currentBeat: Double) {
        guard isRecording else { return }

        let relativeBeat = currentBeat - recordStartBeat
        let key = NoteKey(note: note, channel: channel)

        // If there's already a pending note for this key, finish it first
        if let pending = pendingNotes.removeValue(forKey: key) {
            let duration = max(0.01, relativeBeat - pending.startBeat)
            completedEvents.append(MIDIEvent(
                tick: pending.startBeat,
                type: .noteOn,
                note: pending.note,
                velocity: pending.velocity,
                duration: duration,
                channel: pending.channel
            ))
        }

        pendingNotes[key] = PendingNote(
            note: note,
            velocity: velocity,
            channel: channel,
            startBeat: relativeBeat
        )
    }

    /// Feed a note-off event into the recorder.
    /// - Parameters:
    ///   - note: MIDI note number 0-127
    ///   - channel: MIDI channel 0-15
    ///   - currentBeat: The current transport beat position
    func noteOff(note: UInt8, channel: UInt8, currentBeat: Double) {
        guard isRecording else { return }

        let relativeBeat = currentBeat - recordStartBeat
        let key = NoteKey(note: note, channel: channel)

        guard let pending = pendingNotes.removeValue(forKey: key) else { return }

        let duration = max(0.01, relativeBeat - pending.startBeat)
        completedEvents.append(MIDIEvent(
            tick: pending.startBeat,
            type: .noteOn,
            note: pending.note,
            velocity: pending.velocity,
            duration: duration,
            channel: pending.channel
        ))
    }

    /// Stop recording and return a finalized Clip with all captured events.
    /// Returns nil if no events were recorded.
    /// - Parameter currentBeat: The transport beat when stop was pressed.
    func stopRecording(atBeat currentBeat: Double) -> Clip? {
        guard isRecording else { return nil }
        isRecording = false

        let relativeBeat = currentBeat - recordStartBeat

        // Close any still-held notes
        for (_, pending) in pendingNotes {
            let duration = max(0.01, relativeBeat - pending.startBeat)
            completedEvents.append(MIDIEvent(
                tick: pending.startBeat,
                type: .noteOn,
                note: pending.note,
                velocity: pending.velocity,
                duration: duration,
                channel: pending.channel
            ))
        }
        pendingNotes.removeAll()

        guard !completedEvents.isEmpty else { return nil }

        // Apply quantization if enabled
        if quantizeGrid > 0 {
            completedEvents = completedEvents.map { event in
                let quantizedTick = (event.tick / quantizeGrid).rounded() * quantizeGrid
                return MIDIEvent(
                    tick: quantizedTick,
                    type: event.type,
                    note: event.note,
                    velocity: event.velocity,
                    duration: event.duration,
                    channel: event.channel
                )
            }
        }

        // Sort events by tick
        completedEvents.sort()

        // Calculate clip length: from first note to end of last note, rounded up to nearest bar (4 beats)
        let maxEnd = completedEvents.map { $0.tick + $0.duration }.max() ?? relativeBeat
        let lengthBeats = max(4.0, ceil(maxEnd / 4.0) * 4.0)

        // Convert beat positions to bars for clip placement (4 beats = 1 bar in 4/4)
        let startBar = recordStartBeat / 4.0
        let lengthBars = lengthBeats / 4.0

        let clip = Clip(name: "Recording", type: .midi, startBar: startBar, lengthBars: lengthBars)
        clip.midiEvents = completedEvents

        return clip
    }

    /// Merge recorded events into an existing clip (overdub).
    /// Returns the merged clip.
    func mergeIntoClip(_ existingClip: Clip, atBeat currentBeat: Double) -> Clip? {
        guard let newClip = stopRecording(atBeat: currentBeat) else { return nil }
        guard let newEvents = newClip.midiEvents, !newEvents.isEmpty else { return nil }

        // Calculate the offset: where does the recording start relative to the clip?
        let clipStartBeat = existingClip.startBar * 4.0
        let recordOffsetBeats = recordStartBeat - clipStartBeat

        // Shift new events to be relative to the existing clip's start
        let shiftedEvents = newEvents.map { event in
            MIDIEvent(
                tick: event.tick + recordOffsetBeats,
                type: event.type,
                note: event.note,
                velocity: event.velocity,
                duration: event.duration,
                channel: event.channel
            )
        }

        // Merge with existing events
        var merged = existingClip.midiEvents ?? []
        merged.append(contentsOf: shiftedEvents)
        merged.sort()
        existingClip.midiEvents = merged

        // Extend clip if new notes go beyond current end
        let maxEnd = merged.map { $0.tick + $0.duration }.max() ?? 0
        let neededLengthBars = ceil(maxEnd / 4.0)
        if neededLengthBars > existingClip.lengthBars {
            existingClip.lengthBars = neededLengthBars
        }

        return existingClip
    }
}

// MARK: - Private Types

private struct NoteKey: Hashable {
    let note: UInt8
    let channel: UInt8
}

private struct PendingNote {
    let note: UInt8
    let velocity: UInt8
    let channel: UInt8
    let startBeat: Double
}
