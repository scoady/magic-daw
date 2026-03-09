import Foundation

/// Plays back MIDI clips by scheduling note-on/off events based on the transport position.
/// Uses a high-priority timer to poll the transport and trigger notes with sub-beat accuracy.
class MIDIPlayer {
    /// The sampler to trigger notes on.
    weak var sampler: Sampler?

    /// The MIDI manager for sending notes to external devices.
    weak var midiManager: MIDIManager?

    /// Optional MIDI output destination for external synth playback.
    var midiOutputDestination: MIDIDeviceInfo?

    /// Active clips to play back, keyed by track ID.
    private var trackClips: [UUID: [Clip]] = [:]

    /// Currently sounding notes that need note-off, keyed by (trackID, note, channel).
    private var activePlaybackNotes: [PlaybackNoteKey: ScheduledNoteOff] = [:]

    /// The playback timer.
    private var playbackTimer: DispatchSourceTimer?

    /// Last processed beat position (to detect forward movement and avoid re-triggering).
    private var lastProcessedBeat: Double = -1.0

    /// Whether playback is active.
    private(set) var isPlaying = false

    /// Loop region (in beats). nil means no looping.
    var loopRegion: LoopRegion?

    // MARK: - Clip Management

    /// Set the clips for a given track.
    func setClips(for trackID: UUID, clips: [Clip]) {
        trackClips[trackID] = clips.filter { $0.type == .midi }
    }

    /// Remove clips for a track.
    func removeClips(for trackID: UUID) {
        trackClips.removeValue(forKey: trackID)
    }

    /// Clear all clips.
    func clearAllClips() {
        trackClips.removeAll()
    }

    // MARK: - Playback Control

    /// Start playback. Call this when the transport starts playing.
    /// - Parameter currentBeat: The transport's current beat position.
    func startPlayback(atBeat currentBeat: Double) {
        isPlaying = true
        lastProcessedBeat = currentBeat - 0.001  // slightly behind to catch notes at exact position
    }

    /// Stop playback and release all active notes.
    func stopPlayback() {
        isPlaying = false
        lastProcessedBeat = -1.0
        releaseAllNotes()
    }

    /// Process a tick of the transport. Called at high frequency (~240 Hz) by the transport timer.
    /// Scans all clips for notes that should start or end within the beat range since last tick.
    /// - Parameter currentBeat: The current transport beat position.
    func process(currentBeat: Double) {
        guard isPlaying else { return }

        let fromBeat = lastProcessedBeat
        let toBeat = currentBeat

        // Handle loop wrap-around
        if let loop = loopRegion, toBeat >= loop.endBeat {
            // Process remaining notes up to loop end
            processRange(from: fromBeat, to: loop.endBeat)
            // Wrap
            lastProcessedBeat = loop.startBeat - 0.001
            return
        }

        guard toBeat > fromBeat else {
            lastProcessedBeat = toBeat
            return
        }

        processRange(from: fromBeat, to: toBeat)

        // Check for note-offs
        processNoteOffs(atBeat: toBeat)

        lastProcessedBeat = toBeat
    }

    // MARK: - Private

    private func processRange(from fromBeat: Double, to toBeat: Double) {
        for (trackID, clips) in trackClips {
            for clip in clips {
                guard let events = clip.midiEvents else { continue }

                let clipStartBeat = clip.startBar * 4.0  // bars to beats (4/4 time)
                let clipEndBeat = clipStartBeat + clip.lengthBars * 4.0

                // Skip clips not in range
                guard clipEndBeat > fromBeat && clipStartBeat < toBeat else { continue }

                for event in events where event.type == .noteOn {
                    let eventBeat = clipStartBeat + event.tick

                    // Check if this note falls within the current processing window
                    if eventBeat > fromBeat && eventBeat <= toBeat {
                        triggerNoteOn(
                            note: event.note,
                            velocity: event.velocity,
                            channel: event.channel,
                            trackID: trackID
                        )

                        // Schedule note-off
                        let noteOffBeat = eventBeat + event.duration
                        let key = PlaybackNoteKey(trackID: trackID, note: event.note, channel: event.channel)
                        activePlaybackNotes[key] = ScheduledNoteOff(
                            note: event.note,
                            channel: event.channel,
                            offBeat: noteOffBeat
                        )
                    }
                }
            }
        }
    }

    private func processNoteOffs(atBeat currentBeat: Double) {
        var keysToRemove: [PlaybackNoteKey] = []

        for (key, scheduled) in activePlaybackNotes {
            if currentBeat >= scheduled.offBeat {
                triggerNoteOff(note: scheduled.note, channel: scheduled.channel)
                keysToRemove.append(key)
            }
        }

        for key in keysToRemove {
            activePlaybackNotes.removeValue(forKey: key)
        }
    }

    private func triggerNoteOn(note: UInt8, velocity: UInt8, channel: UInt8, trackID: UUID) {
        // Play through sampler
        sampler?.noteOn(note: note, velocity: velocity)

        // Send to external MIDI output if configured
        if let dest = midiOutputDestination {
            midiManager?.sendNoteOn(note: note, velocity: velocity, channel: channel, to: dest)
        }
    }

    private func triggerNoteOff(note: UInt8, channel: UInt8) {
        // Stop sampler note
        sampler?.noteOff(note: note)

        // Send to external MIDI output if configured
        if let dest = midiOutputDestination {
            midiManager?.sendNoteOff(note: note, channel: channel, to: dest)
        }
    }

    private func releaseAllNotes() {
        for (_, scheduled) in activePlaybackNotes {
            triggerNoteOff(note: scheduled.note, channel: scheduled.channel)
        }
        activePlaybackNotes.removeAll()
    }
}

// MARK: - Supporting Types

struct LoopRegion {
    var startBeat: Double
    var endBeat: Double

    var lengthBeats: Double { endBeat - startBeat }

    /// Start position in bars (4/4 time)
    var startBar: Double { startBeat / 4.0 }
    /// End position in bars (4/4 time)
    var endBar: Double { endBeat / 4.0 }
}

private struct PlaybackNoteKey: Hashable {
    let trackID: UUID
    let note: UInt8
    let channel: UInt8
}

private struct ScheduledNoteOff {
    let note: UInt8
    let channel: UInt8
    let offBeat: Double
}
