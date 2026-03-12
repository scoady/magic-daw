import AppKit
import AVFoundation
import Foundation
import UniformTypeIdentifiers
import WebKit

private enum LiveInputSource: Hashable {
    case external
    case ui
}

private struct LiveInputNoteKey: Hashable {
    let note: UInt8
    let channel: UInt8
    let source: LiveInputSource
}

/// Bridge between Swift native layer and the JavaScript UI running in WKWebView.
/// Receives messages from JS via WKScriptMessageHandler and sends events back via evaluateJavaScript.
final class WebViewBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?

    private let midiManager = MIDIManager()
    private let audioEngine = AudioEngine()
    private let ollamaClient = OllamaClient()
    private let projectManager = ProjectManager()

    /// The currently open project (for save operations that need a project reference).
    var currentProject: DAWProject?

    /// Callback invoked when a project is loaded or created so the host can update its state.
    var onProjectChanged: ((DAWProject) -> Void)?

    /// Timer for sending transport state updates to JS (~30 fps when playing)
    private var transportStateTimer: DispatchSourceTimer?
    /// Timer for sending audio level metering data to JS (~20 fps)
    private var meterTimer: DispatchSourceTimer?

    // MARK: - Plugin Builder State

    /// The active node graph being edited in the Plugin Builder view
    private var pluginGraph = NodeGraphDefinition.empty(name: "Untitled Plugin")
    /// Live DSP preview graph built from the node graph
    private var previewGraph = DSPGraph()
    /// Whether live audio preview is active
    private var isPreviewingPlugin = false
    /// Timer for sending preview audio levels to JS
    private var previewLevelTimer: DispatchSourceTimer?
    /// Plugin compiler instance
    private let pluginCompiler = PluginCompiler()
    /// Saved plugin graph library
    private let pluginGraphLibrary = PluginGraphLibrary()
    /// AI router for patch generation (lazy — shares ollamaClient)
    private lazy var aiRouter = AIRouter(client: ollamaClient)
    /// Sound design service for AI patch generation
    private lazy var soundDesignService = SoundDesignService(router: aiRouter)
    /// Instrument preset library (persisted to ~/Library/Application Support/MagicDAW/Instruments/)
    private lazy var instrumentLibrary = InstrumentLibrary()
    private let sampleInstrumentLoader = InstrumentLoader()
    private let sfzImporter = SFZImporter()
    private let sampleFinderService = SampleFinderService()

    // MARK: - Note Editing Undo Stack

    /// Undo stack for clip note editing — stores snapshots of MIDIEvents before each edit
    private var noteUndoStack: [[MIDIEvent]] = []
    /// Redo stack for clip note editing
    private var noteRedoStack: [[MIDIEvent]] = []
    /// Maximum undo history entries
    private let maxUndoEntries = 50
    /// The clip currently being edited in the piano roll
    private var editingClipId: UUID?

    /// MIDI recorder for capturing incoming notes during record mode.
    private let midiRecorder = MIDIRecorder()

    /// MIDI player for clip playback.
    private let midiPlayer = MIDIPlayer()

    /// Metronome click track.
    private lazy var metronome: Metronome = {
        let m = Metronome(engine: audioEngine.avEngine)
        m.connect(to: audioEngine.avEngine.mainMixerNode)
        return m
    }()

    /// MIDI router with chord detection and key analysis
    private lazy var midiRouter: MIDIRouter = {
        MIDIRouter(midiManager: midiManager, audioEngine: audioEngine)
    }()

    /// Harmony service: AI-powered with algorithmic fallback
    private lazy var harmonyService: HarmonyService = {
        HarmonyService(router: aiRouter)
    }()

    /// Sampler for the instrument view — connects to the main mixer automatically.
    private lazy var sampler: Sampler = {
        let s = Sampler(engine: audioEngine.avEngine)
        s.connect(to: audioEngine.avEngine.mainMixerNode)
        return s
    }()

    /// Per-track playback samplers so Arrange can respect each track's instrument assignment.
    private var trackSamplers: [UUID: Sampler] = [:]
    /// Per-track graph synths so saved plugin instruments can play directly in Arrange.
    private var trackGraphSynths: [UUID: GraphSynth] = [:]
    /// Dedicated preview synth for the plugin builder.
    private lazy var pluginPreviewSynth: GraphSynth = {
        let synth = GraphSynth(engine: audioEngine.avEngine)
        synth.connect(to: audioEngine.avEngine.mainMixerNode)
        return synth
    }()
    /// Last automation-applied mixer state to avoid hammering the engine with identical values.
    private var lastAutomationVolumes: [UUID: Float] = [:]
    private var lastAutomationPans: [UUID: Float] = [:]
    /// Track base mix state as last set by the user/UI, used as the automation fallback target.
    private var baseTrackVolumes: [UUID: Float] = [:]
    private var baseTrackPans: [UUID: Float] = [:]
    /// The track the UI most recently selected. Used as the default live-play target when nothing is armed.
    private var liveInputSelectedTrackID: UUID?
    /// Keeps note-offs routed back to the same track/runtime that received the original note-on.
    private var liveInputNoteTargets: [LiveInputNoteKey: UUID?] = [:]

    override init() {
        super.init()
        do {
            try audioEngine.setup()
        } catch {
            print("[WebViewBridge] Failed to start audio engine: \(error)")
        }
        ensureBundledDemoInstrumentsInstalled()
        setupMIDIRouter()
        setupCallbacks()
        setupTransportCallbacks()
        startMeterTimer()
    }

    // MARK: - Setup

    private func setupCallbacks() {
        // Forward MIDI note-on events to JavaScript AND the MIDIRouter for analysis.
        // This replaces the router's onNoteOn so we must call through to it.
        midiManager.onNoteOn = { [weak self] note, velocity, channel in
            guard let self else { return }
            // 1. Play through the armed/selected track instrument, falling back to the preview sampler.
            self.routeLiveInputNoteOn(note: note, velocity: velocity, channel: channel, source: .external)
            // 2. Record if armed
            if self.audioEngine.isRecording {
                self.midiRecorder.noteOn(
                    note: note,
                    velocity: velocity,
                    channel: channel,
                    currentBeat: self.audioEngine.currentBeat
                )
            }
            // 3. Forward raw MIDI to JS immediately (for Circle of Fifths node highlighting)
            self.sendEvent("midi_note_on", data: [
                "note": note,
                "velocity": velocity,
                "channel": channel,
            ])
            // 4. Feed into MIDIRouter for chord/key analysis (runs debounced)
            self.midiRouter.handleExternalNoteOn(note: note, velocity: velocity, channel: channel)
        }

        // Forward MIDI note-off events to JavaScript AND the MIDIRouter.
        midiManager.onNoteOff = { [weak self] note, channel in
            guard let self else { return }
            self.routeLiveInputNoteOff(note: note, channel: channel, source: .external)
            if self.audioEngine.isRecording {
                self.midiRecorder.noteOff(
                    note: note,
                    channel: channel,
                    currentBeat: self.audioEngine.currentBeat
                )
            }
            self.sendEvent("midi_note_off", data: [
                "note": note,
                "channel": channel,
            ])
            self.midiRouter.handleExternalNoteOff(note: note, channel: channel)
        }

        // Forward MIDI CC events to JavaScript via bridge.ts pub/sub
        midiManager.onControlChange = { [weak self] controller, value, channel in
            self?.sendEvent("midi_cc", data: [
                "controller": controller,
                "value": value,
                "channel": channel,
            ])
        }

        // Forward MIDI pitch bend events to JavaScript via bridge.ts pub/sub
        midiManager.onPitchBend = { [weak self] value, channel in
            self?.sendEvent("midi_pitch_bend", data: [
                "value": value,
                "channel": channel,
            ])
        }
    }

    /// Set up transport callbacks for MIDI playback, recording, and metronome.
    private func setupTransportCallbacks() {
        // Wire the MIDI player to use our sampler and MIDI manager
        midiPlayer.sampler = sampler
        midiPlayer.midiManager = midiManager
        midiPlayer.onTrackNoteOn = { [weak self] note, velocity, _, trackID in
            self?.playTrackNoteOn(note: note, velocity: velocity, trackID: trackID)
        }
        midiPlayer.onTrackNoteOff = { [weak self] note, _, trackID in
            self?.playTrackNoteOff(note: note, trackID: trackID)
        }

        // High-frequency transport tick: drive MIDIPlayer and Metronome
        audioEngine.onTransportTick = { [weak self] currentBeat in
            guard let self else { return }
            self.applyTrackAutomation(atBeat: currentBeat)
            self.midiPlayer.process(currentBeat: currentBeat)
            self.metronome.process(currentBeat: currentBeat)
        }

        // When recording actually starts (after optional count-in)
        audioEngine.onRecordingStarted = { [weak self] in
            guard let self else { return }
            // Find the first armed MIDI track
            if let project = self.currentProject,
               let armedTrack = project.tracks.first(where: { $0.isArmed && $0.type == .midi }) {
                self.midiRecorder.trackID = armedTrack.id

                // Check for overdub: does the armed track have clips at the current position?
                let currentBar = self.audioEngine.currentBeat / 4.0
                let hasOverlapClip = armedTrack.clips.contains {
                    $0.type == .midi && $0.startBar <= currentBar && $0.endBar > currentBar
                }
                self.midiRecorder.overdubMode = hasOverlapClip

                self.midiRecorder.startRecording(atBeat: self.audioEngine.currentBeat)
            }
        }

        // When transport stops: finalize recording
        audioEngine.onTransportStopped = { [weak self] in
            guard let self else { return }
            self.midiPlayer.stopPlayback()
            self.metronome.reset()
            self.restoreBaseTrackMixState()
            self.finalizeRecording()
        }
    }

    private func registerTrackWithAudioEngine(_ track: Track, isBus: Bool = false) {
        baseTrackVolumes[track.id] = track.linearGain
        baseTrackPans[track.id] = track.pan
        let audioTrack = AudioTrack(
            id: track.id,
            name: track.name,
            volume: track.linearGain,
            pan: track.pan,
            isMuted: track.isMuted,
            isSoloed: track.isSoloed,
            isBus: isBus
        )
        if isBus {
            audioEngine.addBusTrack(audioTrack)
        } else {
            audioEngine.addTrack(audioTrack)
        }
        if track.type == .midi {
            refreshTrackInstrument(for: track)
        }
    }

    private func clearProjectAudioState() {
        guard let project = currentProject else { return }
        for track in project.tracks {
            audioEngine.removeTrack(AudioTrack(id: track.id, name: track.name))
            midiPlayer.removeClips(for: track.id)
            removeTrackSampler(for: track.id)
            removeTrackGraphSynth(for: track.id)
        }
        lastAutomationVolumes.removeAll()
        lastAutomationPans.removeAll()
        baseTrackVolumes.removeAll()
        baseTrackPans.removeAll()
        liveInputNoteTargets.removeAll()
        liveInputSelectedTrackID = nil
    }

    private func applyTrackAutomation(atBeat beat: Double) {
        guard let project = currentProject else { return }
        let beatsPerBar = project.timeSignature.beatsPerBar
        let currentBar = (beat / max(0.0001, beatsPerBar)) + 1.0

        for track in project.tracks {
            if track.automation.contains(where: { $0.type == .volume && $0.enabled && !$0.points.isEmpty }) {
                let baseVolume = baseTrackVolumes[track.id] ?? track.linearGain
                let automatedVolume = track.automationValue(for: .volume, atBar: currentBar) ?? baseVolume
                let clampedVolume = max(0.0, min(1.0, automatedVolume))
                if abs((lastAutomationVolumes[track.id] ?? -1.0) - clampedVolume) > 0.0005 {
                    audioEngine.setTrackVolume(track.id, volume: clampedVolume)
                    lastAutomationVolumes[track.id] = clampedVolume
                }
            }

            if track.automation.contains(where: { $0.type == .pan && $0.enabled && !$0.points.isEmpty }) {
                let basePan = baseTrackPans[track.id] ?? track.pan
                let automatedPanNormalized = track.automationValue(for: .pan, atBar: currentBar)
                let automatedPan = automatedPanNormalized.map { max(-1.0, min(1.0, ($0 * 2.0) - 1.0)) } ?? basePan
                if abs((lastAutomationPans[track.id] ?? 9.0) - automatedPan) > 0.0005 {
                    audioEngine.setTrackPan(track.id, pan: automatedPan)
                    lastAutomationPans[track.id] = automatedPan
                }
            }
        }
    }

    private func restoreBaseTrackMixState() {
        guard let project = currentProject else { return }
        for track in project.tracks {
            audioEngine.setTrackVolume(track.id, volume: baseTrackVolumes[track.id] ?? track.linearGain)
            audioEngine.setTrackPan(track.id, pan: baseTrackPans[track.id] ?? track.pan)
        }
        lastAutomationVolumes.removeAll()
        lastAutomationPans.removeAll()
    }

    private func ensureTrackSampler(for track: Track) -> Sampler? {
        if let sampler = trackSamplers[track.id] { return sampler }
        guard let destination = audioEngine.mixerNode(for: track.id) else { return nil }
        let sampler = Sampler(engine: audioEngine.avEngine)
        sampler.connect(to: destination)
        trackSamplers[track.id] = sampler
        return sampler
    }

    private func ensureTrackGraphSynth(for track: Track) -> GraphSynth? {
        if let synth = trackGraphSynths[track.id] { return synth }
        guard let destination = audioEngine.mixerNode(for: track.id) else { return nil }
        let synth = GraphSynth(engine: audioEngine.avEngine)
        synth.connect(to: destination)
        trackGraphSynths[track.id] = synth
        return synth
    }

    private func refreshTrackInstrument(for track: Track) {
        switch track.instrument?.type {
        case .synth:
            removeTrackSampler(for: track.id)
            guard let synth = ensureTrackGraphSynth(for: track) else { return }
            configureTrackGraphSynth(synth, for: track)
        case .sampler, .external, nil:
            removeTrackGraphSynth(for: track.id)
            guard let sampler = ensureTrackSampler(for: track) else { return }
            configureTrackSampler(sampler, for: track)
        }
    }

    private func configureTrackSampler(_ sampler: Sampler, for track: Track) {
        if let path = track.instrument?.path, !path.isEmpty,
           let instrumentURL = resolveInstrumentDefinitionURL(from: path) {
            do {
                let loaded = try sampleInstrumentLoader.loadInstrumentSync(at: instrumentURL)
                try sampler.loadInstrument(loaded)
                return
            } catch {
                print("[Bridge] Failed to load sample instrument for track \(track.name): \(error)")
            }
        }

        let bankMSB = track.instrument?.bankMSB ?? 0x79
        let gmProgram = track.instrument?.gmProgram ?? 0
        sampler.setGMProgram(gmProgram, bankMSB: bankMSB)
    }

    private func configureTrackGraphSynth(_ synth: GraphSynth, for track: Track) {
        guard let path = track.instrument?.path, !path.isEmpty else {
            return
        }

        do {
            let graph = try pluginGraphLibrary.loadGraph(at: URL(fileURLWithPath: path))
            synth.loadGraph(graph)
        } catch {
            print("[Bridge] Failed to load graph synth for track \(track.name): \(error)")
        }
    }

    private func removeTrackSampler(for trackID: UUID) {
        guard let sampler = trackSamplers.removeValue(forKey: trackID) else { return }
        sampler.allNotesOff()
    }

    private func removeTrackGraphSynth(for trackID: UUID) {
        guard let synth = trackGraphSynths.removeValue(forKey: trackID) else { return }
        synth.allNotesOff()
    }

    private func syncTrackSamplersForCurrentProject() {
        guard let project = currentProject else { return }
        let midiTrackIDs = Set(project.tracks.filter { $0.type == .midi }.map(\.id))
        for track in project.tracks where track.type == .midi {
            refreshTrackInstrument(for: track)
        }
        for staleTrackID in trackSamplers.keys where !midiTrackIDs.contains(staleTrackID) {
            removeTrackSampler(for: staleTrackID)
        }
        for staleTrackID in trackGraphSynths.keys where !midiTrackIDs.contains(staleTrackID) {
            removeTrackGraphSynth(for: staleTrackID)
        }
    }

    private func playTrackNoteOn(note: UInt8, velocity: UInt8, trackID: UUID) {
        guard let track = currentProject?.tracks.first(where: { $0.id == trackID }),
              track.type == .midi else {
            sampler.noteOn(note: note, velocity: velocity)
            return
        }

        if track.instrument?.type == .synth,
           let trackSynth = trackGraphSynths[track.id] ?? ensureTrackGraphSynth(for: track) {
            trackSynth.noteOn(note: note, velocity: velocity)
            return
        }

        if let trackSampler = trackSamplers[track.id] ?? ensureTrackSampler(for: track) {
            trackSampler.noteOn(note: note, velocity: velocity)
            return
        }

        sampler.noteOn(note: note, velocity: velocity)
    }

    private func playTrackNoteOff(note: UInt8, trackID: UUID) {
        if let trackSynth = trackGraphSynths[trackID] {
            trackSynth.noteOff(note: note)
        } else if let trackSampler = trackSamplers[trackID] {
            trackSampler.noteOff(note: note)
        } else {
            sampler.noteOff(note: note)
        }
    }

    private func currentLiveInputTrackID() -> UUID? {
        guard let project = currentProject else { return nil }

        if let armedTrack = project.tracks.first(where: { $0.type == .midi && $0.isArmed }) {
            return armedTrack.id
        }

        if let selectedTrackID = liveInputSelectedTrackID,
           project.tracks.contains(where: { $0.id == selectedTrackID && $0.type == .midi }) {
            return selectedTrackID
        }

        return nil
    }

    private func routeLiveInputNoteOn(note: UInt8, velocity: UInt8, channel: UInt8, source: LiveInputSource) {
        let key = LiveInputNoteKey(note: note, channel: channel, source: source)
        let targetTrackID = currentLiveInputTrackID()
        liveInputNoteTargets[key] = targetTrackID

        if let targetTrackID {
            playTrackNoteOn(note: note, velocity: velocity, trackID: targetTrackID)
        } else {
            sampler.noteOn(note: note, velocity: velocity)
        }
    }

    private func routeLiveInputNoteOff(note: UInt8, channel: UInt8, source: LiveInputSource) {
        let key = LiveInputNoteKey(note: note, channel: channel, source: source)
        let targetTrackID = liveInputNoteTargets.removeValue(forKey: key) ?? currentLiveInputTrackID()

        if let targetTrackID {
            playTrackNoteOff(note: note, trackID: targetTrackID)
        } else {
            sampler.noteOff(note: note)
        }
    }

    /// Wire MIDIRouter's analysis callbacks to send chord, key, and suggestion data to the UI.
    private func setupMIDIRouter() {
        midiRouter.harmonyService = harmonyService
        midiRouter.setup()

        // When ChordAnalyzer detects a chord, send to JS
        midiRouter.onAnalyzedChord = { [weak self] chord in
            guard let self else { return }
            if let chord = chord {
                self.sendEvent("chord_detected", data: [
                    "chord": chord.displayName,
                    "root": chord.root.displayName,
                    "quality": chord.quality.symbol,
                    "qualityName": chord.quality.rawValue,
                    "notes": chord.midiNotes().map { Int($0) },
                ])
            } else {
                self.sendEvent("chord_detected", data: [
                    "chord": NSNull(),
                ])
            }
        }

        // When key is detected/updated, send to JS
        midiRouter.onKeyDetected = { [weak self] key in
            guard let self else { return }
            if let key = key {
                self.sendEvent("key_detected", data: [
                    "key": key.displayName,
                    "tonic": key.tonic.displayName,
                    "mode": key.mode.displayName,
                    "confidence": key.confidence,
                ])
            } else {
                self.sendEvent("key_detected", data: [
                    "key": NSNull(),
                    "confidence": 0.0,
                ])
            }
        }

        // When chord suggestions arrive (from AI or algorithmic fallback), send to JS
        midiRouter.onChordSuggestions = { [weak self] suggestions in
            guard let self else { return }
            let mapped = suggestions.map { suggestion -> [String: Any] in
                let sourceStr: String
                switch suggestion.source {
                case .ai(let model, let latencyMs):
                    sourceStr = "ai:\(model) (\(latencyMs)ms)"
                case .algorithmic:
                    sourceStr = "algorithmic"
                }
                return [
                    "chord": suggestion.chord.displayName,
                    "probability": suggestion.confidence,
                    "quality": suggestion.chord.quality.rawValue,
                    "explanation": suggestion.explanation,
                    "source": sourceStr,
                ]
            }
            self.sendEvent("chord_suggestions", data: ["suggestions": mapped])
        }

        // When song matches are found for the current progression, send to JS
        midiRouter.onSongMatches = { [weak self] matches in
            guard let self else { return }
            let mapped = matches.map { match -> [String: Any] in
                [
                    "title": match.song.title,
                    "artist": match.song.artist,
                    "year": match.song.year ?? 0,
                    "genre": match.song.genre,
                    "progression": match.song.progression,
                    "section": match.song.section ?? "",
                    "confidence": match.confidence,
                    "matchedChords": match.matchedChords,
                    "matchType": match.matchType.rawValue,
                ]
            }
            self.sendEvent("song_matches", data: ["matches": mapped])
        }
    }

    // MARK: - MIDI Auto-Connect

    /// Sets up MIDI hardware, auto-connects to the first available source,
    /// and sends the device list to the UI. Call after webView finishes loading.
    func startMIDI() {
        do {
            try midiManager.setup()
        } catch {
            print("[Bridge] MIDI setup failed: \(error.localizedDescription)")
            return
        }

        // Auto-connect to the first available MIDI source
        if let firstSource = midiManager.availableSources.first {
            do {
                try midiManager.connect(to: firstSource)
                print("[Bridge] Auto-connected to MIDI source: \(firstSource.name)")
            } catch {
                print("[Bridge] Failed to auto-connect MIDI: \(error.localizedDescription)")
            }
        }

        // Send device list to the UI
        sendMIDIDeviceList()
    }

    /// Sends the current MIDI device list to the JS UI.
    private func sendMIDIDeviceList() {
        let sources = midiManager.availableSources.map { [
            "id": $0.id,
            "name": $0.name,
            "connected": ($0 == midiManager.connectedSource),
        ] as [String: Any] }
        let destinations = midiManager.availableDestinations.map { [
            "id": $0.id,
            "name": $0.name,
        ] as [String: Any] }
        sendEvent("midi_devices", data: [
            "sources": sources,
            "destinations": destinations,
        ])
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String,
              let payload = body["payload"] as? [String: Any] else {
            print("[Bridge] Invalid message format: \(message.body)")
            return
        }

        Task {
            await handleMessage(type: type, payload: payload)
        }
    }

    // MARK: - Message Routing

    private func handleMessage(type: String, payload: [String: Any]) async {
        switch type {
        // MIDI messages
        case "midi.noteOn":
            guard let note = payload["note"] as? Int,
                  let velocity = payload["velocity"] as? Int,
                  let channel = payload["channel"] as? Int else { return }
            sampler.noteOn(note: UInt8(note), velocity: UInt8(velocity))
            // Send note-on to all connected MIDI destinations
            for dest in midiManager.availableDestinations {
                midiManager.sendNoteOn(note: UInt8(note), velocity: UInt8(velocity), channel: UInt8(channel), to: dest)
            }

        case "midi.noteOff":
            guard let note = payload["note"] as? Int,
                  let channel = payload["channel"] as? Int else { return }
            sampler.noteOff(note: UInt8(note))
            // Send note-off to all connected MIDI destinations
            for dest in midiManager.availableDestinations {
                midiManager.sendNoteOff(note: UInt8(note), channel: UInt8(channel), to: dest)
            }

        case "midi.cc":
            guard let controller = payload["controller"] as? Int,
                  let value = payload["value"] as? Int,
                  let channel = payload["channel"] as? Int else { return }
            for dest in midiManager.availableDestinations {
                midiManager.sendControlChange(controller: UInt8(controller), value: UInt8(value), channel: UInt8(channel), to: dest)
            }

        case "midi.listDevices":
            sendMIDIDeviceList()

        case "midi.connectSource":
            if let index = payload["index"] as? Int,
               index < midiManager.availableSources.count {
                let source = midiManager.availableSources[index]
                try? midiManager.connect(to: source)
                sendMIDIDeviceList()
            }

        // Audio/Transport messages (from bridge.ts BridgeMessages constants)
        case "transport_play", "audio.play":
            startPlayback()
            startTransportStateTimer()
            sendTransportState()

        case "transport_stop", "audio.stop":
            // Finalize any active audio recording before stopping
            let recordingTrackID = audioEngine.recordingTrackID
            let recordStartBeat = audioEngine.recordStartBeat
            if let result = audioEngine.stopRecordingInput(),
               let project = currentProject,
               let trackID = recordingTrackID {
                handleRecordingComplete(
                    fileURL: result.url,
                    durationSeconds: result.durationSeconds,
                    trackID: trackID,
                    startBeat: recordStartBeat,
                    project: project
                )
            }
            audioEngine.stop()
            stopTransportStateTimer()
            sendTransportState()

        case "transport_record", "audio.record":
            // Find the first armed audio track for recording
            if let project = currentProject,
               let armedTrack = project.tracks.first(where: { $0.isArmed && $0.type == .audio }) {
                let startBeat = audioEngine.currentBeat
                let filename = "recording-\(Int(Date().timeIntervalSince1970)).wav"

                if let bundleURL = project.fileURL {
                    let audioDir = bundleURL.appendingPathComponent("audio", isDirectory: true)
                    try? FileManager.default.createDirectory(at: audioDir, withIntermediateDirectories: true)
                    let fileURL = audioDir.appendingPathComponent(filename)
                    audioEngine.startRecordingInput(trackID: armedTrack.id, outputURL: fileURL, startBeat: startBeat)
                } else {
                    let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
                    audioEngine.startRecordingInput(trackID: armedTrack.id, outputURL: tempURL, startBeat: startBeat)
                }
            }
            audioEngine.record()
            startTransportStateTimer()
            sendTransportState()

        case "transport_rewind":
            audioEngine.seekToBar(1)
            midiPlayer.stopPlayback()
            metronome.reset()
            sendTransportState()

        case "set_bpm", "audio.setBPM":
            if let bpm = payload["bpm"] as? Double {
                audioEngine.setBPM(bpm)
                sendTransportState()
            }

        case "set_volume", "audio.setVolume":
            // AudioEngine doesn't expose setMasterVolume directly;
            // volume can be set via the mainMixerNode externally if needed.
            break

        // ── Metronome ──

        case "set_metronome":
            if let enabled = payload["enabled"] as? Bool {
                metronome.isEnabled = enabled
                sendEvent("metronome_state", data: ["enabled": enabled])
            }

        // ── Loop Region ──

        case "set_loop_enabled":
            if let enabled = payload["enabled"] as? Bool {
                audioEngine.setLoopEnabled(enabled)
                midiPlayer.loopRegion = enabled ?
                    LoopRegion(startBeat: audioEngine.loopStartBeat, endBeat: audioEngine.loopEndBeat) : nil
                sendTransportState()
            }

        case "set_loop_region":
            if let startBar = payload["startBar"] as? Double,
               let endBar = payload["endBar"] as? Double {
                let startBeat = startBar * 4.0
                let endBeat = endBar * 4.0
                audioEngine.setLoopRegion(startBeat: startBeat, endBeat: endBeat)
                if audioEngine.loopEnabled {
                    midiPlayer.loopRegion = LoopRegion(startBeat: startBeat, endBeat: endBeat)
                }
                sendTransportState()
            }

        // ── Count-in ──

        case "set_count_in":
            if let enabled = payload["enabled"] as? Bool {
                audioEngine.countInEnabled = enabled
                sendEvent("count_in_state", data: ["enabled": enabled])
            }

        // ── Track Arming ──

        case "arm_track":
            if let trackIdStr = payload["trackId"] as? String,
               let armed = payload["armed"] as? Bool,
               let uuid = resolveTrackUUID(trackIdStr) {
                if let track = currentProject?.tracks.first(where: { $0.id == uuid }) {
                    track.isArmed = armed
                }
                sendTracksUpdated()
            }

        case "select_track":
            if let trackIdStr = payload["trackId"] as? String {
                liveInputSelectedTrackID = resolveTrackUUID(trackIdStr)
            } else {
                liveInputSelectedTrackID = nil
            }

        // ── Audio Input Devices ──

        case "get_input_devices":
            let devices = audioEngine.availableInputDevices()
            let deviceList = devices.map { [
                "uid": $0.uid,
                "name": $0.name,
                "channelCount": $0.channelCount,
            ] as [String: Any] }
            sendEvent("input_devices", data: ["devices": deviceList])

        // ── Input Monitoring ──

        case "set_monitor":
            if let enabled = payload["enabled"] as? Bool {
                audioEngine.setInputMonitoring(enabled)
                sendEvent("monitor_state", data: ["enabled": enabled])
            }

        // ── Audio Clip Playback ──

        case "schedule_clip_playback":
            if let clipIdStr = payload["clipId"] as? String,
               let trackIdStr = payload["trackId"] as? String,
               let filePath = payload["filePath"] as? String,
               let startBeat = payload["startBeat"] as? Double,
               let clipUUID = UUID(uuidString: clipIdStr),
               let trackUUID = resolveTrackUUID(trackIdStr) {
                let offset = payload["offsetSeconds"] as? Double ?? 0.0
                let gain = payload["gainDB"] as? Float ?? 0.0

                // Resolve file path relative to project bundle
                let fileURL: URL
                if let bundleURL = currentProject?.fileURL {
                    fileURL = bundleURL.appendingPathComponent(filePath)
                } else {
                    fileURL = URL(fileURLWithPath: filePath)
                }

                audioEngine.scheduleClip(
                    clipID: clipUUID,
                    fileURL: fileURL,
                    trackID: trackUUID,
                    startBeat: startBeat,
                    offsetSeconds: offset,
                    gainDB: gain
                )
            }

        case "stop_clip_playback":
            if let clipIdStr = payload["clipId"] as? String,
               let clipUUID = UUID(uuidString: clipIdStr) {
                audioEngine.stopClip(clipUUID)
            }

        // ── Quantize ──

        case "set_quantize":
            if let grid = payload["grid"] as? Double {
                midiRecorder.quantizeGrid = grid
            }

        // ── MIDI Output Selection ──

        case "set_midi_output":
            if let index = payload["index"] as? Int,
               index < midiManager.availableDestinations.count {
                midiPlayer.midiOutputDestination = midiManager.availableDestinations[index]
            } else {
                midiPlayer.midiOutputDestination = nil
            }

        // AI messages
        case "ai.request":
            guard let prompt = payload["prompt"] as? String else { return }
            let model = payload["model"] as? String ?? "llama3.2"
            let system = payload["system"] as? String
            do {
                let result = try await ollamaClient.generate(model: model, prompt: prompt, system: system)
                sendEvent("ai_result", data: ["result": result, "requestId": payload["requestId"] ?? ""])
            } catch {
                sendEvent("ai_result", data: ["error": error.localizedDescription, "requestId": payload["requestId"] ?? ""])
            }

        case "ai.listModels":
            do {
                let models = try await ollamaClient.listModels()
                let modelData = models.map { ["name": $0.name, "size": $0.size, "modified": $0.modifiedAt] as [String: Any] }
                sendEvent("ai_models", data: ["models": modelData])
            } catch {
                sendEvent("ai_models", data: ["error": error.localizedDescription])
            }

        case "ai.checkStatus":
            let available = await ollamaClient.checkAvailability()
            sendEvent("ollama_status", data: ["available": available])

        // Natural language AI chat via AIRouter (uses reasoning model with music context)
        case "ai_request", "ai.chat":
            guard let prompt = payload["prompt"] as? String else { return }
            let requestId = payload["requestId"] as? String ?? ""
            let context = buildMusicContext()
            do {
                let result = try await aiRouter.route(.naturalLanguage(instruction: prompt, context: context))
                if case .text(let response) = result.result {
                    sendEvent("ai_chat_result", data: [
                        "result": response,
                        "model": result.model,
                        "latencyMs": result.latencyMs,
                        "requestId": requestId,
                    ])
                }
            } catch {
                sendEvent("ai_chat_result", data: [
                    "error": error.localizedDescription,
                    "requestId": requestId,
                ])
            }

        // Track mixer messages
        case "set_track_volume":
            if let trackId = payload["trackId"] as? String,
               let volume = payload["volume"] as? Double,
               let uuid = resolveTrackUUID(trackId) {
                let linearVolume = max(0.0, min(1.0, Float(volume)))
                baseTrackVolumes[uuid] = linearVolume
                audioEngine.setTrackVolume(uuid, volume: linearVolume)
                if let track = currentProject?.tracks.first(where: { $0.id == uuid }) {
                    track.volume = linearVolume > 0.0001 ? 20.0 * log10f(linearVolume) : -96.0
                }
            }

        case "set_track_pan":
            if let trackId = payload["trackId"] as? String,
               let pan = payload["pan"] as? Double,
               let uuid = resolveTrackUUID(trackId) {
                let clampedPan = max(-1.0, min(1.0, Float(pan)))
                baseTrackPans[uuid] = clampedPan
                audioEngine.setTrackPan(uuid, pan: clampedPan)
                if let track = currentProject?.tracks.first(where: { $0.id == uuid }) {
                    track.pan = clampedPan
                }
            }

        case "set_track_mute":
            if let trackId = payload["trackId"] as? String,
               let muted = payload["muted"] as? Bool,
               let uuid = resolveTrackUUID(trackId) {
                audioEngine.setTrackMute(uuid, muted: muted)
            }

        case "set_track_solo":
            if let trackId = payload["trackId"] as? String,
               let soloed = payload["soloed"] as? Bool,
               let uuid = resolveTrackUUID(trackId) {
                audioEngine.setTrackSolo(uuid, soloed: soloed)
            }

        case "set_track_effect":
            if let trackId = payload["trackId"] as? String,
               let effectIndex = payload["effectIndex"] as? Int,
               let paramName = payload["paramName"] as? String,
               let value = payload["value"] as? Double,
               let uuid = resolveTrackUUID(trackId) {
                applyEffectParameter(trackID: uuid, effectIndex: effectIndex, paramName: paramName, value: value)
            }

        case "set_track_automation":
            handleSetTrackAutomation(payload)

        // ── Effects Chain Messages ──

        case "add_effect":
            handleAddEffect(payload)

        case "remove_effect":
            handleRemoveEffect(payload)

        case "set_effect_param":
            handleSetEffectParam(payload)

        case "reorder_effects":
            handleReorderEffects(payload)

        case "bypass_effect":
            handleBypassEffect(payload)

        // ── Send Routing Messages ──

        case "set_send_level":
            handleSetSendLevel(payload)

        // Project messages
        case "project.save":
            if let path = payload["path"] as? String {
                saveProject(to: URL(fileURLWithPath: path))
            } else if !saveCurrentProject() {
                showSaveProjectAsPanel()
            }

        case "project.load":
            if let path = payload["path"] as? String {
                loadProject(from: URL(fileURLWithPath: path))
            } else {
                showOpenProjectPanel()
            }

        case "project.new":
            if let name = payload["name"] as? String, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                newProject(named: name)
            } else {
                newProject()
            }

        case "project.saveAs":
            showSaveProjectAsPanel()

        case "project.updateState":
            updateProjectFromJS(payload)

        case "export_audio":
            await handleExportAudio(payload)

        // ── Instrument / Sampler Messages ──

        case "instrument.loadSample":
            handleLoadSample(payload)

        case "instrument.updateADSR":
            handleUpdateADSR(payload)

        case "instrument.updateFilter":
            handleUpdateFilter(payload)

        case "instrument.updateOutput":
            handleUpdateOutput(payload)

        case "instrument.importSample":
            await handleImportSample()

        case "instrument.importSampleFolder":
            await handleImportSampleFolder()

        case "instrument.importSFZ":
            await handleImportSFZ()

        case "instrument.previewNote":
            guard let note = payload["note"] as? Int else { return }
            let velocity = payload["velocity"] as? Int ?? 100
            sampler.noteOn(note: UInt8(note), velocity: UInt8(velocity))
            // Auto note-off after a short duration for preview
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.sampler.noteOff(note: UInt8(note))
            }

        case "instrument.designSound":
            if let description = payload["description"] as? String {
                await handleInstrumentDesignSound(description: description)
            }

        case "instrument.mapZones":
            await handleInstrumentMapZones()

        case "instrument.saveRack":
            handleSaveCurrentSamplerInstrument(payload)

        case "instrument.assignPreviewRack":
            handleAssignPreviewRackToTrack(payload)

        case "instrument.listSampleRacks":
            handleListSampleRacks()

        case "instrument.loadSampleRack":
            handleLoadSampleRack(payload)

        case "instrument.loadBuiltinDemo":
            handleLoadBuiltInDemo(payload)

        case "instrument.searchLocal":
            handleSearchLocalSamples(payload)

        case "instrument.refineSearch":
            await handleRefineSampleSearch(payload)

        case "instrument.loadDiscovered":
            handleLoadDiscoveredSample(payload)

        case "instrument.pickSearchRoot":
            await handlePickSampleSearchRoot()

        case "instrument.listSearchRoots":
            handleListSampleSearchRoots()

        case "instrument.removeSearchRoot":
            handleRemoveSampleSearchRoot(payload)

        case "instrument.reindexSearch":
            handleReindexSampleSearch()

        // ── Instrument Factory (GM Preset) Messages ──

        case "instrument.createPreset":
            if let description = payload["description"] as? String {
                await handleCreatePreset(description: description)
            }

        case "instrument.listPresets":
            handleListPresets()

        case "instrument.deletePreset":
            if let idStr = payload["id"] as? String,
               let uuid = UUID(uuidString: idStr) {
                handleDeletePreset(id: uuid)
            }

        case "instrument.assignToTrack":
            let trackIdStr = payload["trackId"] as? String
            let instrumentName = payload["name"] as? String
            if let presetIdStr = payload["presetId"] as? String,
               let presetUUID = UUID(uuidString: presetIdStr) {
                handleAssignPresetToTrack(presetId: presetUUID, trackIdStr: trackIdStr)
            } else if let sampleRackPath = payload["sampleRackPath"] as? String {
                handleAssignSavedRackToTrack(path: sampleRackPath, trackIdStr: trackIdStr)
            } else if let pluginGraphPath = payload["pluginGraphPath"] as? String {
                handleAssignSavedPluginGraphToTrack(path: pluginGraphPath, trackIdStr: trackIdStr)
            } else if let gmProg = payload["gmProgram"] as? Int {
                handleAssignGMProgram(UInt8(gmProg), trackIdStr: trackIdStr, name: instrumentName)
            }

        case "instrument.previewPreset":
            if let presetIdStr = payload["presetId"] as? String,
               let presetUUID = UUID(uuidString: presetIdStr) {
                let note = payload["note"] as? Int ?? 60
                handlePreviewPreset(presetId: presetUUID, note: UInt8(note))
            }

        // ── Plugin Builder Messages ──

        case "add_node":
            handleAddNode(payload)

        case "remove_node":
            if let nodeId = payload["nodeId"] as? String {
                handleRemoveNode(nodeId)
            }

        case "connect_nodes":
            handleConnectNodes(payload)

        case "disconnect_nodes":
            if let connId = payload["connectionId"] as? String {
                handleDisconnectNodes(connId)
            }

        case "set_node_param":
            handleSetNodeParam(payload)

        case "move_node":
            handleMoveNode(payload)

        case "plugin_sync_graph":
            handlePluginSyncGraph()

        case "plugin_load_template":
            if let templateId = payload["templateId"] as? String {
                handlePluginLoadTemplate(templateId)
            }

        case "plugin_preview_start":
            startPluginPreview()

        case "plugin_preview_stop":
            stopPluginPreview()

        case "plugin.previewNote":
            let note = payload["note"] as? Int ?? 60
            handlePreviewCurrentPluginGraph(note: UInt8(max(0, min(127, note))))

        case "plugin.saveGraph":
            handleSaveCurrentPluginGraph(payload)

        case "plugin.listSaved":
            handleListSavedPluginGraphs()

        case "plugin.loadSaved":
            if let path = payload["path"] as? String {
                handleLoadSavedPluginGraph(path: path)
            }

        case "plugin.assignToTrack":
            let trackIdStr = payload["trackId"] as? String
            if let path = payload["path"] as? String, !path.isEmpty {
                handleAssignSavedPluginGraphToTrack(path: path, trackIdStr: trackIdStr)
            } else {
                handleAssignCurrentPluginGraphToTrack(trackIdStr: trackIdStr)
            }

        case "export_auv3":
            await handleExportAUv3()

        case "ai_generate_patch":
            if let description = payload["description"] as? String {
                await handleAIGeneratePatch(description: description)
            }

        // ── Audio Import ──

        case "audio.importFile":
            await handleImportAudioFile()

        // ── Track Management Messages ──

        case "add_track":
            handleAddTrack(payload)

        case "delete_track":
            handleDeleteTrack(payload)

        case "rename_track":
            handleRenameTrack(payload)

        case "reorder_tracks":
            handleReorderTracks(payload)

        case "set_track_color":
            handleSetTrackColor(payload)

        // ── Piano Roll Note Editing Messages ──

        case "note.add":
            handleAddNote(payload)

        case "note.move":
            handleMoveNotes(payload)

        case "note.resize":
            handleResizeNote(payload)

        case "note.delete":
            handleDeleteNotes(payload)

        case "note.setVelocity":
            handleSetVelocity(payload)

        case "note.paste":
            handlePasteNotes(payload)

        case "edit.undo":
            handleNoteUndo()

        case "edit.redo":
            handleNoteRedo()

        // ── Clip Management Messages ──

        case "create_clip":
            handleCreateClip(payload)

        case "move_clip":
            handleMoveClip(payload)

        case "resize_clip":
            handleResizeClip(payload)

        case "delete_clips":
            handleDeleteClips(payload)

        case "duplicate_clip":
            handleDuplicateClip(payload)

        case "split_clip":
            handleSplitClip(payload)

        case "set_clip_loop":
            handleSetClipLoop(payload)

        case "edit_clip":
            // UI-only action: JS side switches to Edit view. No backend state change needed.
            break

        case "harmonic_lab_commit":
            handleHarmonicLabCommit(payload)

        // ── Transport Position ──

        case "set_position":
            if let beat = payload["beat"] as? Double {
                let bar = Int(beat / 4.0) + 1
                audioEngine.seekToBar(bar)
                sendTransportState()
            }

        // ── System: file picker & URL opening ──────────────────────────
        case "system.openFilePicker":
            let extensions = (payload["extensions"] as? [String]) ?? [".mid"]
            let pickerId = (payload["pickerId"] as? String) ?? "default"
            await handleOpenFilePicker(extensions: extensions, pickerId: pickerId)

        case "system.openURL":
            if let urlStr = payload["url"] as? String, let url = URL(string: urlStr) {
                NSWorkspace.shared.open(url)
            }

        default:
            print("[Bridge] Unknown message type: \(type)")
        }
    }

    // MARK: - File Picker

    @MainActor
    private func handleOpenFilePicker(extensions: [String], pickerId: String) {
        let panel = NSOpenPanel()
        panel.title = "Import File"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false

        // Build UTTypes from extensions
        var contentTypes: [UTType] = []
        for ext in extensions {
            let cleanExt = ext.hasPrefix(".") ? String(ext.dropFirst()) : ext
            if let utType = UTType(filenameExtension: cleanExt) {
                contentTypes.append(utType)
            }
        }
        // Fallback: allow all if no types resolved
        if contentTypes.isEmpty {
            contentTypes = [.data]
        }
        panel.allowedContentTypes = contentTypes

        guard panel.runModal() == .OK, let url = panel.url else { return }

        // Read file data as base64 for transport to JS
        do {
            let data = try Data(contentsOf: url)
            let base64 = data.base64EncodedString()
            sendEvent("system.filePicked", data: [
                "path": url.lastPathComponent,
                "data": base64,
                "pickerId": pickerId,
            ])
        } catch {
            print("[Bridge] Failed to read picked file: \(error)")
        }
    }

    // MARK: - Music Context

    /// Build a MusicContext from current project state for AI natural language requests.
    private func buildMusicContext() -> MusicContext {
        let key = midiRouter.keyDetector.currentKey
        let keyStr = key?.displayName ?? currentProject?.key?.rawValue ?? "C Major"
        let bpm = currentProject?.bpm ?? 120.0
        let ts = currentProject?.timeSignature
        let tsStr = ts.map { "\($0.numerator)/\($0.denominator)" } ?? "4/4"

        return MusicContext(
            key: keyStr,
            bpm: bpm,
            timeSignature: tsStr,
            currentChords: [],
            genre: nil,
            trackNames: []
        )
    }

    // MARK: - Send to JavaScript

    /// Send a typed event to JS via the bridge.ts pub/sub system (window.__magicDAWReceive).
    func sendEvent(_ type: String, data: [String: Any]) {
        guard let jsonData = try? JSONSerialization.data(withJSONObject: data),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            print("[Bridge] Failed to serialize event: \(type)")
            return
        }

        let js = "if (window.__magicDAWReceive) { window.__magicDAWReceive('\(type)', \(jsonString)); }"

        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js) { _, error in
                if let error = error {
                    print("[Bridge] JS event error for \(type): \(error.localizedDescription)")
                }
            }
        }
    }

    // MARK: - Project Operations (called from menu actions)

    /// Create a new empty project, reset transport state, and notify JS.
    func newProject(named name: String = "Untitled") {
        audioEngine.stop()
        midiPlayer.stopPlayback()
        metronome.reset()
        audioEngine.seekToBar(1)
        clearProjectAudioState()
        let project = DAWProject(name: name)
        audioEngine.setBPM(project.bpm)

        currentProject = project
        onProjectChanged?(project)
        sendProjectToJS(project)
        sendTransportState()
    }

    /// Save the current project. If it already has a fileURL, save in place; otherwise trigger Save As.
    /// Returns true if saved successfully, false if Save As is needed.
    @discardableResult
    func saveCurrentProject() -> Bool {
        guard let project = currentProject, let url = project.fileURL else {
            return false
        }
        do {
            try projectManager.save(project, to: url)
            sendEvent("project_saved", data: ["success": true, "path": url.path, "name": project.name])
            return true
        } catch {
            sendEvent("project_saved", data: ["success": false, "error": error.localizedDescription])
            return false
        }
    }

    /// Save the current project to a specific URL.
    func saveProject(to url: URL) {
        let project = currentProject ?? DAWProject(name: url.deletingPathExtension().lastPathComponent)
        project.name = url.deletingPathExtension().lastPathComponent
        do {
            try projectManager.save(project, to: url)
            currentProject = project
            onProjectChanged?(project)
            sendEvent("project_saved", data: ["success": true, "path": url.path, "name": project.name])
        } catch {
            sendEvent("project_saved", data: ["success": false, "error": error.localizedDescription])
        }
    }

    /// Load a project from disk and send its state to JS.
    func loadProject(from url: URL) {
        do {
            audioEngine.stop()
            midiPlayer.stopPlayback()
            metronome.reset()
            audioEngine.seekToBar(1)
            clearProjectAudioState()
            let project = try projectManager.load(from: url)
            audioEngine.setBPM(project.bpm)
            currentProject = project
            for track in project.tracks {
                let isBus = track.type == .bus
                registerTrackWithAudioEngine(track, isBus: isBus)
            }
            onProjectChanged?(project)
            sendProjectToJS(project)
            sendEvent("project_loaded", data: [
                "success": true,
                "path": url.path,
                "name": project.name,
            ])
            sendTransportState()
        } catch {
            sendEvent("project_loaded", data: [
                "success": false,
                "error": error.localizedDescription,
            ])
        }
    }

    /// Encode the full project as JSON and send to JS via the bridge event system.
    func sendProjectToJS(_ project: DAWProject) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(project),
              let jsonString = String(data: data, encoding: .utf8) else {
            print("[Bridge] Failed to encode project for JS")
            return
        }
        // Send as a raw JS call since the project JSON is a string that needs to be parsed on the JS side
        let hasFileURL = project.fileURL != nil ? "true" : "false"
        let projectPath: String
        if let path = project.fileURL?.path {
            let escapedPath = path
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
            projectPath = "\"\(escapedPath)\""
        } else {
            projectPath = "null"
        }
        let js = "if (window.__magicDAWReceive) { window.__magicDAWReceive('project_data', { project: \(jsonString), hasFileURL: \(hasFileURL), path: \(projectPath) }); }"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js) { _, error in
                if let error = error {
                    print("[Bridge] JS event error for project_data: \(error.localizedDescription)")
                }
            }
        }
    }

    private func showOpenProjectPanel() {
        DispatchQueue.main.async { [weak self] in
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [.init(filenameExtension: "magicdaw")].compactMap { $0 }
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = false
            panel.begin { response in
                guard response == .OK, let url = panel.url else { return }
                self?.loadProject(from: url)
            }
        }
    }

    private func showSaveProjectAsPanel() {
        DispatchQueue.main.async { [weak self] in
            let panel = NSSavePanel()
            panel.allowedContentTypes = [.init(filenameExtension: "magicdaw")].compactMap { $0 }
            panel.nameFieldStringValue = self?.currentProject?.name ?? "Untitled"
            panel.begin { response in
                guard response == .OK, let url = panel.url else { return }
                self?.saveProject(to: url)
            }
        }
    }

    /// Update the current project model from a JSON payload sent by JS.
    /// Called when the UI state changes (tracks added, clips moved, etc.).
    func updateProjectFromJS(_ payload: [String: Any]) {
        guard let project = currentProject else { return }

        if let name = payload["name"] as? String { project.name = name }
        if let bpm = payload["bpm"] as? Double { project.bpm = bpm }

        if let tsData = payload["timeSignature"] as? [String: Int],
           let num = tsData["numerator"],
           let den = tsData["denominator"] {
            project.timeSignature = TimeSignature(numerator: num, denominator: den)
        }

        if let keyStr = payload["key"] as? String {
            project.key = ProjectKey(rawValue: keyStr)
        }

        if let scaleStr = payload["keyScale"] as? String {
            project.keyScale = ProjectKey.Scale(rawValue: scaleStr)
        }

        // Tracks are synced via individual track update messages rather than bulk replacement
        // to avoid constant large JSON payloads. The full project state is synced on save.
    }

    // MARK: - Instrument Handlers

    /// Load a sample file into the sampler at the given root note and key range.
    private func handleLoadSample(_ payload: [String: Any]) {
        guard let path = payload["path"] as? String else {
            sendEvent("instrument_error", data: ["error": "No file path provided"])
            return
        }

        let rootNote = UInt8(payload["rootNote"] as? Int ?? 60)
        let lowNote = UInt8(payload["lowNote"] as? Int ?? 0)
        let highNote = UInt8(payload["highNote"] as? Int ?? 127)

        let url = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: path) else {
            sendEvent("instrument_error", data: ["error": "File not found: \(url.lastPathComponent)"])
            return
        }

        do {
            try sampler.loadSample(url: url, rootNote: rootNote, lowNote: lowNote, highNote: highNote)
            print("[Bridge] Loaded sample: \(url.lastPathComponent) root=\(rootNote) range=\(lowNote)-\(highNote)")

            // Send waveform data back to UI
            if let waveform = sampler.waveformData(for: rootNote, points: 500) {
                sendEvent("instrument_waveform", data: [
                    "rootNote": Int(rootNote),
                    "waveform": waveform,
                    "name": url.lastPathComponent,
                ])
            }

            // Send updated zone map
            sendInstrumentZones()

            sendEvent("instrument_loaded", data: [
                "success": true,
                "name": url.lastPathComponent,
                "rootNote": Int(rootNote),
                "lowNote": Int(lowNote),
                "highNote": Int(highNote),
            ])
        } catch {
            sendEvent("instrument_error", data: ["error": error.localizedDescription])
        }
    }

    /// Update ADSR envelope parameters on the sampler.
    private func handleUpdateADSR(_ payload: [String: Any]) {
        if let attack = payload["attack"] as? Double {
            sampler.attack = Float(attack)
        }
        if let decay = payload["decay"] as? Double {
            sampler.decay = Float(decay)
        }
        if let sustain = payload["sustain"] as? Double {
            sampler.sustain = Float(sustain)
        }
        if let release = payload["release"] as? Double {
            sampler.release = Float(release)
        }
    }

    /// Update filter parameters on the sampler.
    private func handleUpdateFilter(_ payload: [String: Any]) {
        if let cutoff = payload["cutoff"] as? Double {
            sampler.filterCutoff = Float(cutoff)
        }
        if let resonance = payload["resonance"] as? Double {
            sampler.filterResonance = Float(resonance)
        }
    }

    /// Update output gain / pan on the preview sampler.
    private func handleUpdateOutput(_ payload: [String: Any]) {
        if let gain = payload["gain"] as? Double {
            sampler.outputGain = Float(gain)
        }
        if let pan = payload["pan"] as? Double {
            sampler.outputPan = Float(pan)
        }
    }

    /// Show an NSOpenPanel to import an audio sample file.
    @MainActor
    private func handleImportSample() {
        let panel = NSOpenPanel()
        panel.title = "Import Audio Sample"
        panel.allowedContentTypes = [
            .wav, .aiff, .audio,
        ]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }

        // Load as a one-shot at C4 (MIDI 60) spanning the full keyboard by default
        handleLoadSample([
            "path": url.path,
            "rootNote": 60,
            "lowNote": 0,
            "highNote": 127,
        ])
    }

    @MainActor
    private func handleImportSampleFolder() {
        let panel = NSOpenPanel()
        panel.title = "Import Sample Folder"
        panel.allowedContentTypes = [.folder]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = true
        panel.canChooseFiles = false

        guard panel.runModal() == .OK, let folderURL = panel.url else {
            return
        }

        let allowedExtensions = Set(["wav", "aif", "aiff", "flac", "caf", "mp3", "m4a"])
        guard let enumerator = FileManager.default.enumerator(
            at: folderURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else {
            sendEvent("instrument_error", data: ["error": "Unable to scan sample folder"])
            return
        }

        var sampleURLs: [URL] = []
        for case let fileURL as URL in enumerator {
            let ext = fileURL.pathExtension.lowercased()
            if allowedExtensions.contains(ext) {
                sampleURLs.append(fileURL)
            }
        }

        guard !sampleURLs.isEmpty else {
            sendEvent("instrument_error", data: ["error": "No supported audio samples found in folder"])
            return
        }

        sampler.clearLoadedInstrument()
        for url in sampleURLs.sorted(by: { $0.lastPathComponent.localizedCaseInsensitiveCompare($1.lastPathComponent) == .orderedAscending }) {
            let detectedRoot = detectMIDINoteFromFilename(url.lastPathComponent) ?? 60
            handleLoadSample([
                "path": url.path,
                "rootNote": Int(detectedRoot),
                "lowNote": Int(detectedRoot),
                "highNote": Int(detectedRoot),
            ])
        }
    }

    @MainActor
    private func handleImportSFZ() {
        let panel = NSOpenPanel()
        panel.title = "Import Instrument Rack"
        panel.allowedContentTypes = [
            UTType(filenameExtension: "sfz") ?? .data,
            UTType(filenameExtension: "magicinstrument") ?? .data,
        ]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true

        guard panel.runModal() == .OK, let instrumentURL = panel.url else {
            return
        }

        do {
            let loaded: LoadedInstrumentDefinition
            if instrumentURL.pathExtension.lowercased() == "magicinstrument" {
                try loadInstrumentDefinitionIntoPreview(
                    from: instrumentURL,
                    eventPath: instrumentURL.path,
                    source: "library"
                )
                return
            } else {
                loaded = try sfzImporter.loadInstrument(from: instrumentURL)
            }
            try sampler.loadInstrument(loaded)
            sendLoadedSampleRackEvent(for: loaded)
            sendInstrumentZones()
        } catch {
            sendEvent("instrument_error", data: ["error": error.localizedDescription])
        }
    }

    /// Send the current sample zone map to the JS UI.
    private func sendInstrumentZones() {
        let zones = sampler.loadedZones().map { zone -> [String: Any] in
            [
                "rootNote": Int(zone.rootNote),
                "lowNote": Int(zone.lowNote),
                "highNote": Int(zone.highNote),
                "sampleFile": zone.sampleFile,
                "lowVelocity": Int(zone.lowVelocity),
                "highVelocity": Int(zone.highVelocity),
            ]
        }
        sendEvent("instrument_zones", data: ["zones": zones])
    }

    private func handleListSampleRacks() {
        let builtInRacks = listBuiltInDemoInstrumentSummaries().map { rack in
            [
                "name": rack.name,
                "path": rack.path,
                "zoneCount": rack.zoneCount,
                "sampleCount": rack.sampleCount,
                "source": "built-in",
            ]
        }
        let libraryRacks = instrumentLibrary.listSampleInstrumentSummaries().map { rack in
            [
                "name": rack.name,
                "path": rack.path,
                "zoneCount": rack.zoneCount,
                "sampleCount": rack.sampleCount,
                "source": "library",
            ]
        }
        sendEvent("instrument_sample_rack_list", data: ["racks": builtInRacks + libraryRacks])
    }

    private func handleLoadSampleRack(_ payload: [String: Any]) {
        guard let path = payload["path"] as? String, !path.isEmpty else {
            sendEvent("instrument_error", data: ["error": "No sample rack path provided"])
            return
        }

        guard let definitionURL = resolveInstrumentDefinitionURL(from: path) else {
            sendEvent("instrument_error", data: ["error": "Could not resolve sample rack: \(path)"])
            return
        }
        do {
            let source = path.hasPrefix("builtin:") ? "built-in" : (isBuiltInDemoInstrument(definitionURL) ? "built-in" : "library")
            let eventPath = path.hasPrefix("builtin:") ? path : definitionURL.path
            try loadInstrumentDefinitionIntoPreview(from: definitionURL, eventPath: eventPath, source: source)
        } catch {
            sendEvent("instrument_error", data: ["error": error.localizedDescription])
        }
    }

    private func handleLoadBuiltInDemo(_ payload: [String: Any]) {
        guard let id = payload["id"] as? String, !id.isEmpty else {
            sendEvent("instrument_error", data: ["error": "No built-in demo id provided"])
            return
        }
        let builtinPath = "builtin:\(id)"
        guard let definitionURL = resolveInstrumentDefinitionURL(from: builtinPath) else {
            sendEvent("instrument_error", data: ["error": "Could not resolve built-in demo: \(id)"])
            return
        }

        do {
            try loadInstrumentDefinitionIntoPreview(from: definitionURL, eventPath: builtinPath, source: "built-in")
        } catch {
            sendEvent("instrument_error", data: ["error": error.localizedDescription])
        }
    }

    private func loadInstrumentDefinitionIntoPreview(from definitionURL: URL, eventPath: String, source: String) throws {
        let definition = try InstrumentDefinition.load(from: definitionURL)
        guard let zones = definition.zones, !zones.isEmpty else {
            throw NSError(domain: "MagicDAW.Instrument", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Instrument has no sample zones",
            ])
        }

        let instrumentFolder = definitionURL.deletingLastPathComponent()
        var sampleSources: [String: URL] = [:]
        for zone in zones {
            let sampleURL = instrumentFolder.appendingPathComponent(zone.sampleFile).standardizedFileURL
            guard FileManager.default.fileExists(atPath: sampleURL.path) else {
                throw NSError(domain: "MagicDAW.Instrument", code: 2, userInfo: [
                    NSLocalizedDescriptionKey: "Missing sample file: \(sampleURL.path)",
                ])
            }
            sampleSources[zone.sampleFile] = sampleURL
        }

        try sampler.loadPreviewInstrument(definition: definition, sampleSources: sampleSources)
        sendCurrentPreviewRackLoadedEvent(name: definition.name, path: eventPath, source: source)
        sendInstrumentZones()
    }

    private func sendLoadedSampleRackEvent(for loaded: LoadedInstrumentDefinition, source: String? = nil, eventPath: String? = nil) {
        let regions = loaded.regions.map { region -> [String: Any] in
            let waveform = sampler.waveformData(for: region.zone.rootNote, points: 500) ?? []
            return [
                "name": URL(fileURLWithPath: region.zone.sampleFile).lastPathComponent,
                "rootNote": Int(region.zone.rootNote),
                "lowNote": Int(region.zone.lowNote),
                "highNote": Int(region.zone.highNote),
                "waveform": waveform,
            ]
        }
        let zones = loaded.regions.map { region -> [String: Any] in
            [
                "rootNote": Int(region.zone.rootNote),
                "lowNote": Int(region.zone.lowNote),
                "highNote": Int(region.zone.highNote),
                "sampleFile": region.zone.sampleFile,
                "lowVelocity": Int(region.zone.lowVelocity),
                "highVelocity": Int(region.zone.highVelocity),
            ]
        }
        sendEvent("instrument_sample_rack_loaded", data: [
            "name": loaded.definition.name,
            "path": eventPath ?? loaded.definitionURL.path,
            "source": source ?? (isBuiltInDemoInstrument(loaded.definitionURL) ? "built-in" : "library"),
            "outputGain": loaded.definition.outputGain,
            "outputPan": loaded.definition.outputPan,
            "samples": regions,
            "zones": zones,
        ])
    }

    private func sendCurrentPreviewRackLoadedEvent(name: String, path: String, source: String) {
        let zones = sampler.loadedZones()
        let samples = zones.map { zone -> [String: Any] in
            [
                "name": URL(fileURLWithPath: zone.sampleFile).lastPathComponent,
                "rootNote": Int(zone.rootNote),
                "lowNote": Int(zone.lowNote),
                "highNote": Int(zone.highNote),
                "waveform": sampler.waveformData(for: zone.rootNote, points: 500) ?? [],
            ]
        }
        let zonePayload = zones.map { zone -> [String: Any] in
            [
                "rootNote": Int(zone.rootNote),
                "lowNote": Int(zone.lowNote),
                "highNote": Int(zone.highNote),
                "sampleFile": zone.sampleFile,
                "lowVelocity": Int(zone.lowVelocity),
                "highVelocity": Int(zone.highVelocity),
            ]
        }
        sendEvent("instrument_sample_rack_loaded", data: [
            "name": name,
            "path": path,
            "source": source,
            "outputGain": sampler.outputGain,
            "outputPan": sampler.outputPan,
            "samples": samples,
            "zones": zonePayload,
        ])
    }

    private func isBuiltInDemoInstrument(_ fileURL: URL) -> Bool {
        let standardizedPath = fileURL.standardizedFileURL.path
        return standardizedPath.contains("/DemoInstruments/")
    }

    private func resolveInstrumentDefinitionURL(from path: String) -> URL? {
        if path.hasPrefix("builtin:") {
            let builtinId = String(path.dropFirst("builtin:".count)).lowercased()
            let folderName: String
            let filename: String
            switch builtinId {
            case "samplerqa":
                folderName = "SamplerQA"
                filename = "SamplerQA.magicinstrument"
            case "studiopiano":
                folderName = "StudioPiano"
                filename = "StudioPiano.magicinstrument"
            default:
                return nil
            }

            let installedURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
                .appendingPathComponent("MagicDAW", isDirectory: true)
                .appendingPathComponent("SampleInstruments", isDirectory: true)
                .appendingPathComponent(folderName, isDirectory: true)
                .appendingPathComponent(filename)
                .standardizedFileURL
            if let installedURL, instrumentLibrary.hasSampleInstrument(at: installedURL) {
                return installedURL
            }

            for directory in demoInstrumentDirectories() {
                let explicitPath = directory
                    .appendingPathComponent(folderName, isDirectory: true)
                    .appendingPathComponent(filename)
                    .standardizedFileURL
                if FileManager.default.fileExists(atPath: explicitPath.path) {
                    return (try? instrumentLibrary.ensureSampleInstrumentInstalled(from: explicitPath)) ?? explicitPath
                }
                if let subpaths = try? FileManager.default.subpathsOfDirectory(atPath: directory.path),
                   let relativePath = subpaths.first(where: { $0.caseInsensitiveCompare(filename) == .orderedSame || $0.lowercased().hasSuffix("/" + filename.lowercased()) }) {
                    let resolved = directory.appendingPathComponent(relativePath).standardizedFileURL
                    return (try? instrumentLibrary.ensureSampleInstrumentInstalled(from: resolved)) ?? resolved
                }
                let directPath = directory.appendingPathComponent(filename).standardizedFileURL
                if FileManager.default.fileExists(atPath: directPath.path) {
                    return (try? instrumentLibrary.ensureSampleInstrumentInstalled(from: directPath)) ?? directPath
                }
            }
            return nil
        }
        return URL(fileURLWithPath: path)
    }

    private func ensureBundledDemoInstrumentsInstalled() {
        _ = resolveInstrumentDefinitionURL(from: "builtin:SamplerQA")
        _ = resolveInstrumentDefinitionURL(from: "builtin:StudioPiano")
    }

    private func demoInstrumentDirectories() -> [URL] {
        let fileManager = FileManager.default
        let executableURL = (Bundle.main.executableURL ?? URL(fileURLWithPath: ProcessInfo.processInfo.arguments[0])).standardizedFileURL

        let candidates: [URL?] = [
            Bundle.main.url(forResource: "DemoInstruments", withExtension: nil),
            Bundle.main.resourceURL?.appendingPathComponent("DemoInstruments", isDirectory: true),
            executableURL
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Resources", isDirectory: true)
                .appendingPathComponent("DemoInstruments", isDirectory: true),
            URL(fileURLWithPath: fileManager.currentDirectoryPath)
                .appendingPathComponent("DemoInstruments", isDirectory: true),
            executableURL
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("DemoInstruments", isDirectory: true),
        ]

        var seen: Set<URL> = []
        var directories: [URL] = []
        for candidate in candidates.compactMap({ $0?.standardizedFileURL }) {
            guard fileManager.fileExists(atPath: candidate.path), !seen.contains(candidate) else { continue }
            seen.insert(candidate)
            directories.append(candidate)
        }
        return directories
    }

    private func listBuiltInDemoInstrumentSummaries() -> [SampleInstrumentSummary] {
        var summaries: [SampleInstrumentSummary] = []
        let fileManager = FileManager.default
        var candidateFiles: [URL] = []

        let bundledPaths = Bundle.main.paths(forResourcesOfType: "magicinstrument", inDirectory: "DemoInstruments")
        candidateFiles.append(contentsOf: bundledPaths.map { URL(fileURLWithPath: $0).standardizedFileURL })

        for directory in demoInstrumentDirectories() where fileManager.fileExists(atPath: directory.path) {
            if let subpaths = try? fileManager.subpathsOfDirectory(atPath: directory.path) {
                for subpath in subpaths where subpath.lowercased().hasSuffix(".magicinstrument") {
                    candidateFiles.append(directory.appendingPathComponent(subpath).standardizedFileURL)
                }
            }
        }

        // Hard fallback for bundled demo instruments we ship today.
        for directory in demoInstrumentDirectories() {
            candidateFiles.append(directory.appendingPathComponent("SamplerQA/SamplerQA.magicinstrument").standardizedFileURL)
            candidateFiles.append(directory.appendingPathComponent("StudioPiano/StudioPiano.magicinstrument").standardizedFileURL)
        }

        var seen: Set<URL> = []
        for fileURL in candidateFiles where !seen.contains(fileURL) {
            seen.insert(fileURL)
            guard fileManager.fileExists(atPath: fileURL.path) else { continue }
            do {
                let definition = try InstrumentDefinition.load(from: fileURL)
                let zones = definition.zones ?? []
                summaries.append(
                    SampleInstrumentSummary(
                        name: definition.name,
                        path: fileURL.path,
                        zoneCount: zones.count,
                        sampleCount: Set(zones.map(\.sampleFile)).count
                    )
                )
            } catch {
                print("[Bridge] Skipping demo instrument \(fileURL.lastPathComponent): \(error)")
            }
        }

        return summaries.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func handleSearchLocalSamples(_ payload: [String: Any]) {
        let query = (payload["query"] as? String) ?? ""
        sendEvent("instrument_ai_status", data: ["status": "loading", "message": "Searching local libraries..."])
        sampleFinderService.searchLocalSamples(query: query) { [weak self] results in
            guard let self else { return }
            let payload = results.map { result in
                [
                    "name": result.name,
                    "path": result.path,
                    "kind": result.kind,
                    "source": result.source,
                    "extensionName": result.extensionName,
                    "family": result.family,
                    "contentType": result.contentType,
                    "readiness": result.readiness,
                    "packageName": result.packageName,
                    "packageScore": result.packageScore,
                    "nearbySampleCount": result.nearbySampleCount,
                    "sizeBytes": result.sizeBytes,
                    "matchScore": result.matchScore,
                ]
            }
            self.sendEvent("instrument_search_results", data: ["results": payload, "query": query])
            self.sendEvent("instrument_ai_status", data: ["status": "done", "message": "Found \(results.count) local matches"])
        }
    }

    private func handleRefineSampleSearch(_ payload: [String: Any]) async {
        let query = (payload["query"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !query.isEmpty else {
            sendEvent("instrument_search_refined", data: ["query": "", "notes": "Enter a search phrase first."])
            return
        }

        let model = (payload["model"] as? String) ?? "qwen2.5:14b"
        let system = """
        You are helping a DAW user search for free sample libraries.
        Rewrite the user's search into a compact instrument-library query.
        Focus on instrument, texture, articulation, and format keywords.
        Avoid artist names and copyrighted song references.
        Return strict JSON: {"query":"...", "notes":"..."}.
        """

        do {
            let raw = try await ollamaClient.generate(
                model: model,
                prompt: query,
                system: system,
                temperature: 0.2,
                format: .json
            )
            if let data = raw.data(using: .utf8),
               let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                sendEvent("instrument_search_refined", data: [
                    "query": json["query"] as? String ?? query,
                    "notes": json["notes"] as? String ?? "Refined with Ollama.",
                ])
            } else {
                sendEvent("instrument_search_refined", data: [
                    "query": query,
                    "notes": "Ollama returned an unreadable refinement; using the original search."
                ])
            }
        } catch {
            let fallback = query
                .replacingOccurrences(of: "song", with: "")
                .replacingOccurrences(of: "type beat", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            sendEvent("instrument_search_refined", data: [
                "query": fallback.isEmpty ? query : fallback,
                "notes": "Ollama unavailable; using a local fallback refinement."
            ])
        }
    }

    private func handleLoadDiscoveredSample(_ payload: [String: Any]) {
        guard let path = payload["path"] as? String, !path.isEmpty else {
            sendEvent("instrument_error", data: ["error": "No discovered sample path provided"])
            return
        }

        let kind = (payload["kind"] as? String) ?? "sample"
        switch kind {
        case "sfz":
            do {
                let loaded = try sfzImporter.loadInstrument(from: URL(fileURLWithPath: path))
                try sampler.loadInstrument(loaded)
                sendLoadedSampleRackEvent(for: loaded)
                sendInstrumentZones()
            } catch {
                sendEvent("instrument_error", data: ["error": error.localizedDescription])
            }
        case "rack":
            handleLoadSampleRack(["path": path])
        default:
            let detectedRoot = detectMIDINoteFromFilename(URL(fileURLWithPath: path).lastPathComponent) ?? 60
            handleLoadSample([
                "path": path,
                "rootNote": Int(detectedRoot),
                "lowNote": 0,
                "highNote": 127,
            ])
        }
    }

    @MainActor
    private func handlePickSampleSearchRoot() {
        let panel = NSOpenPanel()
        panel.title = "Add Sample Search Folder"
        panel.allowedContentTypes = [.folder]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = true
        panel.canChooseFiles = false

        guard panel.runModal() == .OK, let folderURL = panel.url else { return }
        sampleFinderService.addRoot(url: folderURL)
        handleListSampleSearchRoots()
        handleReindexSampleSearch()
    }

    private func handleListSampleSearchRoots() {
        let roots = sampleFinderService.listRoots().map { root in
            [
                "path": root.path,
                "name": root.name,
                "source": root.source,
            ]
        }
        sendEvent("instrument_search_roots", data: ["roots": roots])
    }

    private func handleRemoveSampleSearchRoot(_ payload: [String: Any]) {
        guard let path = payload["path"] as? String, !path.isEmpty else { return }
        sampleFinderService.removeRoot(path: path)
        handleListSampleSearchRoots()
        handleReindexSampleSearch()
    }

    private func handleReindexSampleSearch() {
        sendEvent("instrument_ai_status", data: ["status": "loading", "message": "Indexing sample folders..."])
        sampleFinderService.rebuildIndex { [weak self] count in
            guard let self else { return }
            self.sendEvent("instrument_ai_status", data: ["status": "done", "message": "Indexed \(count) sample files"])
        }
    }

    // MARK: - MIDI Playback / Recording

    /// Start playback: load clips into MIDIPlayer and start the transport.
    private func startPlayback() {
        syncTrackSamplersForCurrentProject()
        lastAutomationVolumes.removeAll()
        lastAutomationPans.removeAll()

        // Load all MIDI clips from the project into the player
        if let project = currentProject {
            for track in project.tracks where track.type == .midi {
                midiPlayer.setClips(for: track.id, clips: track.clips)
            }
        }

        // Sync loop region
        if audioEngine.loopEnabled {
            midiPlayer.loopRegion = LoopRegion(
                startBeat: audioEngine.loopStartBeat,
                endBeat: audioEngine.loopEndBeat
            )
        } else {
            midiPlayer.loopRegion = nil
        }

        audioEngine.play()
        midiPlayer.startPlayback(atBeat: audioEngine.currentBeat)
    }

    /// Finalize a recording session: create or merge the clip, notify JS.
    private func finalizeRecording() {
        guard midiRecorder.isRecording || !midiRecorder.overdubMode else { return }

        guard let project = currentProject,
              let trackID = midiRecorder.trackID,
              let track = project.tracks.first(where: { $0.id == trackID }) else {
            _ = midiRecorder.stopRecording(atBeat: audioEngine.currentBeat)
            return
        }

        if midiRecorder.overdubMode {
            // Find the overlapping clip and merge into it
            let recordStartBar = audioEngine.currentBeat / 4.0
            if let existingClip = track.clips.first(where: {
                $0.type == .midi && $0.startBar <= recordStartBar && $0.endBar > recordStartBar
            }) {
                _ = midiRecorder.mergeIntoClip(existingClip, atBeat: audioEngine.currentBeat)
            } else {
                // No overlapping clip found; create a new one
                if let clip = midiRecorder.stopRecording(atBeat: audioEngine.currentBeat) {
                    track.addClip(clip)
                }
            }
        } else {
            if let clip = midiRecorder.stopRecording(atBeat: audioEngine.currentBeat) {
                track.addClip(clip)
            }
        }

        // Send updated track data to JS so clips appear immediately
        sendTracksUpdated()
        sendRecordedClipToJS(trackID: trackID)
    }

    /// Send the latest clip data for a track to JS for immediate piano roll display.
    private func sendRecordedClipToJS(trackID: UUID) {
        guard let project = currentProject,
              let track = project.tracks.first(where: { $0.id == trackID }),
              let latestClip = track.clips.last,
              let midiEvents = latestClip.midiEvents else { return }

        let notes = midiEvents.filter { $0.type == .noteOn }.map { event -> [String: Any] in
            [
                "pitch": Int(event.note),
                "start": event.tick,
                "duration": event.duration,
                "velocity": Int(event.velocity),
                "channel": Int(event.channel),
            ]
        }

        sendEvent("clip_recorded", data: [
            "trackId": trackID.uuidString,
            "clipId": latestClip.id.uuidString,
            "clipName": latestClip.name,
            "startBar": latestClip.startBar,
            "lengthBars": latestClip.lengthBars,
            "notes": notes,
        ])
    }

    // MARK: - Transport State Broadcasting

    /// Send current transport state to JS.
    private func sendTransportState() {
        let currentBeat = audioEngine.currentBeat
        // 4/4 time: 4 beats per bar, 1-indexed
        let bar = Int(currentBeat / 4.0) + 1
        let beat = Int(currentBeat.truncatingRemainder(dividingBy: 4.0)) + 1
        let beatsPerSecond = audioEngine.bpm / 60.0
        let timeMs = beatsPerSecond > 0 ? (currentBeat / beatsPerSecond) * 1000.0 : 0.0

        let data: [String: Any] = [
            "playing": audioEngine.isPlaying,
            "recording": audioEngine.isRecording,
            "bpm": audioEngine.bpm,
            "bar": bar,
            "beat": beat,
            "timeMs": timeMs,
            "currentBeat": currentBeat,
            "loopEnabled": audioEngine.loopEnabled,
            "loopStartBar": audioEngine.loopStartBeat / 4.0,
            "loopEndBar": audioEngine.loopEndBeat / 4.0,
            "metronomeEnabled": metronome.isEnabled,
            "countInEnabled": audioEngine.countInEnabled,
        ]
        sendEvent("transport_state", data: data)
    }

    /// Start sending transport state at ~30 fps (only while playing).
    private func startTransportStateTimer() {
        stopTransportStateTimer()

        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
        // ~30 fps
        timer.schedule(deadline: .now(), repeating: .milliseconds(33))
        timer.setEventHandler { [weak self] in
            guard let self, self.audioEngine.isPlaying else { return }
            self.sendTransportState()
        }
        timer.resume()
        transportStateTimer = timer
    }

    /// Stop the transport state timer.
    private func stopTransportStateTimer() {
        transportStateTimer?.cancel()
        transportStateTimer = nil
    }
    /// Start sending audio level data at ~20 fps (always active).
    /// Sends both master levels and per-track levels.
    private func startMeterTimer() {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
        // ~20 fps
        timer.schedule(deadline: .now(), repeating: .milliseconds(50))
        timer.setEventHandler { [weak self] in
            guard let self else { return }

            // Master levels
            let data: [String: Any] = [
                "leftLevel": self.audioEngine.masterLevelL,
                "rightLevel": self.audioEngine.masterLevelR,
            ]
            self.sendEvent("audio_levels", data: data)

            // Per-track levels
            self.sendTrackLevels()

            // Input levels (while recording or monitoring)
            if self.audioEngine.isRecording || self.audioEngine.inputLevelL > 0.001 {
                self.sendEvent("input_levels", data: [
                    "left": self.audioEngine.inputLevelL,
                    "right": self.audioEngine.inputLevelR,
                ])
            }
        }
        timer.resume()
        meterTimer = timer
    }

    // MARK: - Per-Track Level Metering

    /// Send per-track RMS levels to JS as a dictionary keyed by track ID string.
    private func sendTrackLevels() {
        let levels = audioEngine.trackLevels
        guard !levels.isEmpty else { return }

        var data: [String: Any] = [:]
        for (uuid, level) in levels {
            data[uuid.uuidString] = ["left": level.left, "right": level.right]
        }
        sendEvent("track_levels", data: data)
    }

    // MARK: - Audio File Import

    /// Import an audio file: show picker, copy to project, create audio track + clip, generate waveform.
    @MainActor
    private func handleImportAudioFile() {
        guard let project = currentProject else { return }

        let panel = NSOpenPanel()
        panel.title = "Import Audio File"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [
            .mp3, .wav, .aiff, .audio,
            UTType(filenameExtension: "m4a") ?? .audio,
            UTType(filenameExtension: "flac") ?? .audio,
            UTType(filenameExtension: "ogg") ?? .audio,
        ]

        guard panel.runModal() == .OK, let sourceURL = panel.url else { return }

        // Ensure audio/ directory exists in project bundle
        let audioDir: URL
        if let bundleURL = project.fileURL {
            audioDir = bundleURL.appendingPathComponent("audio")
        } else {
            // No project bundle yet — use temp directory
            audioDir = FileManager.default.temporaryDirectory.appendingPathComponent("MagicDAW-audio")
        }
        try? FileManager.default.createDirectory(at: audioDir, withIntermediateDirectories: true)

        // Copy file into project audio directory
        let destFilename = sourceURL.lastPathComponent
        let destURL = audioDir.appendingPathComponent(destFilename)
        do {
            // Remove existing file with same name if present
            if FileManager.default.fileExists(atPath: destURL.path) {
                try FileManager.default.removeItem(at: destURL)
            }
            try FileManager.default.copyItem(at: sourceURL, to: destURL)
        } catch {
            print("[Bridge] Failed to copy audio file: \(error)")
            sendEvent("import_error", data: ["error": "Failed to copy file: \(error.localizedDescription)"])
            return
        }

        // Get audio file duration
        let durationSeconds: Double
        do {
            let audioFile = try AVAudioFile(forReading: destURL)
            let sampleRate = audioFile.processingFormat.sampleRate
            let frameCount = Double(audioFile.length)
            durationSeconds = frameCount / sampleRate
        } catch {
            print("[Bridge] Failed to read audio file: \(error)")
            sendEvent("import_error", data: ["error": "Cannot read audio: \(error.localizedDescription)"])
            return
        }

        // Create a new audio track
        let trackName = destFilename
            .replacingOccurrences(of: ".\(sourceURL.pathExtension)", with: "")
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
        let track = project.addAudioTrack(name: trackName, color: .purple)

        // Register in audio engine
        registerTrackWithAudioEngine(track)

        // Calculate clip length in bars
        let beatsPerSecond = audioEngine.bpm / 60.0
        let durationBeats = durationSeconds * beatsPerSecond
        let beatsPerBar = 4.0
        let lengthBars = durationBeats / beatsPerBar

        // Audio file reference (relative path within project)
        let audioFileRef: String
        if let bundleURL = project.fileURL, destURL.path.hasPrefix(bundleURL.path) {
            audioFileRef = String(destURL.path.dropFirst(bundleURL.path.count + 1))
        } else {
            audioFileRef = destURL.path
        }

        // Create audio clip starting at bar 1
        let clip = track.addAudioClip(
            name: trackName,
            startBar: 1.0,
            lengthBars: lengthBars,
            audioFile: audioFileRef
        )

        // Generate waveform asynchronously
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            if let waveform = AudioEngine.generateWaveform(from: destURL, points: 500) {
                let waveformData = waveform.map { Double($0) }
                self.sendEvent("clip_waveform", data: [
                    "clipId": clip.id.uuidString,
                    "waveform": waveformData,
                ])
            }
        }

        // Notify JS
        sendTracksUpdated()
        sendEvent("audio_imported", data: [
            "trackId": track.id.uuidString,
            "clipId": clip.id.uuidString,
            "name": trackName,
            "durationSeconds": durationSeconds,
            "lengthBars": lengthBars,
        ])
    }

    // MARK: - Recording Completion

    /// Handle the completion of an audio recording: create a clip and send waveform data.
    private func handleRecordingComplete(
        fileURL: URL,
        durationSeconds: Double,
        trackID: UUID,
        startBeat: Double,
        project: DAWProject
    ) {
        guard let track = project.tracks.first(where: { $0.id == trackID }) else { return }

        // Calculate clip length in bars
        let beatsPerSecond = audioEngine.bpm / 60.0
        let durationBeats = durationSeconds * beatsPerSecond
        let beatsPerBar = 4.0 // Assuming 4/4
        let lengthBars = durationBeats / beatsPerBar
        let startBar = startBeat / beatsPerBar

        // Determine audio file reference (relative path if in project bundle)
        let audioFileRef: String
        if let bundleURL = project.fileURL, fileURL.path.hasPrefix(bundleURL.path) {
            // Relative path within the project bundle
            let relativePath = String(fileURL.path.dropFirst(bundleURL.path.count + 1))
            audioFileRef = relativePath
        } else {
            // Absolute path (temp recording)
            audioFileRef = fileURL.path
        }

        // Create a new audio clip on the armed track
        let clip = track.addAudioClip(
            name: "Recording \(track.clips.count + 1)",
            startBar: startBar,
            lengthBars: lengthBars,
            audioFile: audioFileRef
        )

        // Generate waveform for the clip preview
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            if let waveform = AudioEngine.generateWaveform(from: fileURL, points: 500) {
                let waveformData = waveform.map { Double($0) }
                self.sendEvent("clip_waveform", data: [
                    "clipId": clip.id.uuidString,
                    "waveform": waveformData,
                ])
            }
        }

        // Send updated clip data to JS
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        if let clipData = try? encoder.encode(clip),
           let clipJSON = try? JSONSerialization.jsonObject(with: clipData) as? [String: Any] {
            sendEvent("recording_complete", data: [
                "trackId": trackID.uuidString,
                "clip": clipJSON,
                "startBar": startBar,
                "lengthBars": lengthBars,
                "audioFile": audioFileRef,
            ])
        }

        // Also send full tracks update
        sendTracksUpdated()
    }

    // MARK: - Export Handler

    /// Export the master output as a WAV file.
    /// Plays the project from start to the specified end beat, captures to file, then stops.
    private func handleExportAudio(_ payload: [String: Any]) async {
        let totalBeats = payload["totalBeats"] as? Double ?? 128.0  // default 32 bars
        let filename = payload["filename"] as? String ?? "export"

        // Create export URL in temp directory
        let exportDir = FileManager.default.temporaryDirectory.appendingPathComponent("MagicDAW-exports")
        try? FileManager.default.createDirectory(at: exportDir, withIntermediateDirectories: true)
        let exportURL = exportDir.appendingPathComponent("\(filename).wav")

        // Remove existing file
        try? FileManager.default.removeItem(at: exportURL)

        do {
            // Stop any current playback
            audioEngine.stop()
            audioEngine.currentBeat = 0.0

            // Start capture
            try audioEngine.startExportCapture(outputURL: exportURL)

            // Start playback from the beginning
            audioEngine.play()
            midiPlayer.startPlayback(atBeat: 0.0)

            sendEvent("export_progress", data: ["status": "recording", "filename": filename])

            // Wait for playback to reach the end beat
            let beatsPerSecond = audioEngine.bpm / 60.0
            let durationSeconds = totalBeats / beatsPerSecond
            let durationNs = UInt64(durationSeconds * 1_000_000_000)
            try await Task.sleep(nanoseconds: durationNs)

            // Stop capture and playback
            audioEngine.stop()
            audioEngine.stopExportCapture()

            // Show save panel on main thread
            await MainActor.run {
                let savePanel = NSSavePanel()
                savePanel.allowedContentTypes = [.wav]
                savePanel.nameFieldStringValue = "\(filename).wav"
                savePanel.title = "Export Audio"

                if savePanel.runModal() == .OK, let destURL = savePanel.url {
                    do {
                        // Copy to user-selected destination
                        if FileManager.default.fileExists(atPath: destURL.path) {
                            try FileManager.default.removeItem(at: destURL)
                        }
                        try FileManager.default.copyItem(at: exportURL, to: destURL)
                        sendEvent("export_complete", data: [
                            "success": true,
                            "path": destURL.path,
                            "filename": destURL.lastPathComponent,
                        ])
                    } catch {
                        sendEvent("export_complete", data: [
                            "success": false,
                            "error": error.localizedDescription,
                        ])
                    }
                } else {
                    sendEvent("export_complete", data: [
                        "success": false,
                        "error": "Export cancelled",
                    ])
                }
            }
        } catch {
            audioEngine.stopExportCapture()
            sendEvent("export_complete", data: [
                "success": false,
                "error": error.localizedDescription,
            ])
        }
    }

    // MARK: - Track Management Handlers

    /// Add a new track to the project and audio engine, then notify JS.
    private func handleAddTrack(_ payload: [String: Any]) {
        guard let project = currentProject,
              let typeStr = payload["type"] as? String else { return }

        let name = payload["name"] as? String ?? "\(typeStr.capitalized) \(project.tracks.count + 1)"

        let track: Track
        switch typeStr {
        case "audio":
            track = project.addAudioTrack(name: name, color: .blue)
        case "bus":
            track = project.addBusTrack(name: name)
        default:
            track = project.addMIDITrack(name: name, color: .teal)
        }

        // Register in audio engine
        registerTrackWithAudioEngine(track, isBus: typeStr == "bus")

        sendTracksUpdated()
    }

    /// Delete a track from the project and audio engine, then notify JS.
    private func handleDeleteTrack(_ payload: [String: Any]) {
        guard let project = currentProject,
              let trackIdStr = payload["trackId"] as? String,
              let uuid = resolveTrackUUID(trackIdStr) else { return }

        // Find the track to remove from engine
        if let track = project.tracks.first(where: { $0.id == uuid }) {
            audioEngine.removeTrack(AudioTrack(id: track.id, name: track.name))
        }
        removeTrackSampler(for: uuid)
        removeTrackGraphSynth(for: uuid)
        project.removeTrack(id: uuid)
        sendTracksUpdated()
    }

    /// Rename a track and notify JS.
    private func handleRenameTrack(_ payload: [String: Any]) {
        guard let project = currentProject,
              let trackIdStr = payload["trackId"] as? String,
              let newName = payload["name"] as? String,
              let uuid = resolveTrackUUID(trackIdStr) else { return }

        if let track = project.tracks.first(where: { $0.id == uuid }) {
            track.name = newName
        }
        sendTracksUpdated()
    }

    /// Reorder tracks based on an ordered array of track IDs from JS.
    private func handleReorderTracks(_ payload: [String: Any]) {
        guard let project = currentProject,
              let trackIdsRaw = payload["trackIds"] as? [String] else { return }

        let orderedUUIDs = trackIdsRaw.compactMap { UUID(uuidString: $0) }
        guard orderedUUIDs.count == project.tracks.count else {
            print("[Bridge] reorder_tracks: ID count mismatch (\(orderedUUIDs.count) vs \(project.tracks.count))")
            return
        }

        var reordered: [Track] = []
        for uuid in orderedUUIDs {
            if let track = project.tracks.first(where: { $0.id == uuid }) {
                reordered.append(track)
            }
        }
        if reordered.count == project.tracks.count {
            project.tracks = reordered
        }
        sendTracksUpdated()
    }

    /// Set a track's color and notify JS.
    private func handleSetTrackColor(_ payload: [String: Any]) {
        guard let project = currentProject,
              let trackIdStr = payload["trackId"] as? String,
              let colorStr = payload["color"] as? String,
              let uuid = resolveTrackUUID(trackIdStr) else { return }

        if let track = project.tracks.first(where: { $0.id == uuid }),
           let color = TrackColor(rawValue: colorStr) {
            track.color = color
        }
        sendTracksUpdated()
    }

    // MARK: - Clip Management Handlers

    /// Create a new empty clip on a track.
    /// Payload: { trackId: String, startBeat: Double, lengthBeats: Double, type: "midi"|"audio" }
    private func handleCreateClip(_ payload: [String: Any]) {
        guard let project = currentProject,
              let trackIdStr = payload["trackId"] as? String,
              let startBeat = payload["startBeat"] as? Double,
              let lengthBeats = payload["lengthBeats"] as? Double,
              let typeStr = payload["type"] as? String,
              let uuid = resolveTrackUUID(trackIdStr) else { return }

        guard let track = project.tracks.first(where: { $0.id == uuid }) else { return }

        let startBar = startBeat / 4.0 + 1  // Convert beat to 1-indexed bar
        let lengthBars = lengthBeats / 4.0
        let clipType: ClipType = typeStr == "audio" ? .audio : .midi
        let clipCount = track.clips.count + 1
        let name = clipType == .midi ? "MIDI \(clipCount)" : "Audio \(clipCount)"
        let clip = Clip(name: name, type: clipType, startBar: startBar, lengthBars: lengthBars)
        track.addClip(clip)
        sendTracksUpdated()
    }

    /// Move a clip to a new position and/or track.
    /// Payload: { clipId: String, newTrackId: String, newStartBeat: Double }
    private func handleMoveClip(_ payload: [String: Any]) {
        guard let project = currentProject,
              let clipIdStr = payload["clipId"] as? String,
              let newTrackIdStr = payload["newTrackId"] as? String,
              let newStartBeat = payload["newStartBeat"] as? Double,
              let clipUUID = UUID(uuidString: clipIdStr),
              let newTrackUUID = resolveTrackUUID(newTrackIdStr) else { return }

        // Find and remove clip from its current track
        var movedClip: Clip?
        for track in project.tracks {
            if let idx = track.clips.firstIndex(where: { $0.id == clipUUID }) {
                movedClip = track.clips[idx]
                track.clips.remove(at: idx)
                break
            }
        }

        guard let clip = movedClip,
              let newTrack = project.tracks.first(where: { $0.id == newTrackUUID }) else { return }

        clip.startBar = newStartBeat / 4.0 + 1
        newTrack.addClip(clip)
        sendTracksUpdated()
    }

    /// Resize a clip's duration.
    /// Payload: { clipId: String, newLengthBeats: Double }
    private func handleResizeClip(_ payload: [String: Any]) {
        guard let project = currentProject,
              let clipIdStr = payload["clipId"] as? String,
              let newLengthBeats = payload["newLengthBeats"] as? Double,
              let clipUUID = UUID(uuidString: clipIdStr) else { return }

        for track in project.tracks {
            if let clip = track.clips.first(where: { $0.id == clipUUID }) {
                clip.lengthBars = max(0.25, newLengthBeats / 4.0)
                break
            }
        }
        sendTracksUpdated()
    }

    /// Delete one or more clips by ID.
    /// Payload: { clipIds: [String] }
    private func handleDeleteClips(_ payload: [String: Any]) {
        guard let project = currentProject,
              let clipIdStrs = payload["clipIds"] as? [String] else { return }

        let clipUUIDs = Set(clipIdStrs.compactMap { UUID(uuidString: $0) })
        guard !clipUUIDs.isEmpty else { return }

        for track in project.tracks {
            track.clips.removeAll { clipUUIDs.contains($0.id) }
        }
        sendTracksUpdated()
    }

    /// Commit a generated Harmonic Lab draft into the current project as new tracks/clips.
    /// Payload:
    /// {
    ///   name?: String, bpm?: Double, key?: String, keyScale?: String,
    ///   tracks: [{ name, type, color, clips: [{ name, startBar, lengthBars, isLooped?, loopLengthBars?, notes?[] }] }]
    /// }
    private func handleHarmonicLabCommit(_ payload: [String: Any]) {
        func number(from value: Any?) -> Double? {
            switch value {
            case let double as Double:
                return double
            case let int as Int:
                return Double(int)
            case let float as Float:
                return Double(float)
            case let number as NSNumber:
                return number.doubleValue
            case let string as String:
                return Double(string)
            default:
                return nil
            }
        }

        func intNumber(from value: Any?) -> Int? {
            switch value {
            case let int as Int:
                return int
            case let double as Double:
                return Int(double)
            case let number as NSNumber:
                return number.intValue
            case let string as String:
                return Int(string)
            default:
                return nil
            }
        }

        guard let project = currentProject else {
            sendEvent("harmonic_lab_commit_result", data: [
                "success": false,
                "error": "No active project"
            ])
            return
        }

        if let name = payload["name"] as? String, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            project.name = name
        }
        if let bpm = payload["bpm"] as? Double, bpm > 0 {
            project.bpm = bpm
            audioEngine.bpm = bpm
        }
        if let key = payload["key"] as? String {
            project.key = ProjectKey(rawValue: key)
        }
        if let keyScale = payload["keyScale"] as? String {
            project.keyScale = ProjectKey.Scale(rawValue: keyScale)
        }

        guard let trackPayloads = payload["tracks"] as? [[String: Any]], !trackPayloads.isEmpty else {
            sendEvent("harmonic_lab_commit_result", data: [
                "success": false,
                "error": "No tracks in draft"
            ])
            return
        }

        var createdTrackIds: [String] = []

        for trackData in trackPayloads {
            guard let name = trackData["name"] as? String else { continue }
            let typeRaw = (trackData["type"] as? String) ?? "midi"
            let colorRaw = (trackData["color"] as? String) ?? "teal"
            let color = TrackColor(rawValue: colorRaw) ?? .teal
            let instrumentName = (trackData["instrumentName"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let gmProgram = trackData["gmProgram"] as? Int

            let track: Track
            switch typeRaw {
            case "audio":
                track = project.addAudioTrack(name: name, color: color)
            case "bus":
                track = project.addBusTrack(name: name)
                track.color = color
            default:
                track = project.addMIDITrack(name: name, color: color)
            }

            if typeRaw == "midi" {
                if let instrumentName, !instrumentName.isEmpty {
                    track.instrument = InstrumentRef(
                        type: .sampler,
                        name: instrumentName,
                        path: nil,
                        gmProgram: gmProgram.map { UInt8(max(0, min(127, $0))) } ?? 0,
                        bankMSB: 0x79,
                        presetId: nil
                    )
                } else if let gmProgram {
                    track.instrument = InstrumentRef(
                        type: .sampler,
                        name: "GM \(gmProgram)",
                        path: nil,
                        gmProgram: UInt8(max(0, min(127, gmProgram))),
                        bankMSB: 0x79,
                        presetId: nil
                    )
                }
            }

            registerTrackWithAudioEngine(track, isBus: track.type == .bus)
            createdTrackIds.append(track.id.uuidString)

            let clips = (trackData["clips"] as? [[String: Any]]) ?? []
            for clipData in clips {
                guard let clipName = clipData["name"] as? String,
                      let startBar = number(from: clipData["startBar"]),
                      let lengthBars = number(from: clipData["lengthBars"]) else { continue }

                let clipType: ClipType = typeRaw == "audio" ? .audio : .midi
                let clip = Clip(name: clipName, type: clipType, startBar: startBar, lengthBars: lengthBars)
                clip.isLooped = (clipData["isLooped"] as? Bool) ?? false
                clip.loopLengthBars = number(from: clipData["loopLengthBars"])

                if let notePayloads = clipData["notes"] as? [[String: Any]], clipType == .midi {
                    clip.midiEvents = notePayloads.compactMap { noteData in
                        guard let pitch = intNumber(from: noteData["pitch"] ?? noteData["note"]),
                              let start = number(from: noteData["start"] ?? noteData["tick"]),
                              let duration = number(from: noteData["duration"]) else { return nil }
                        let velocity = UInt8(intNumber(from: noteData["velocity"]) ?? 100)
                        let channel = UInt8(intNumber(from: noteData["channel"]) ?? 0)
                        return MIDIEvent(
                            tick: start,
                            type: .noteOn,
                            note: UInt8(max(0, min(127, pitch))),
                            velocity: velocity,
                            duration: max(0.125, duration),
                            channel: channel
                        )
                    }.sorted()
                }

                track.addClip(clip)
            }
        }

        onProjectChanged?(project)
        sendProjectToJS(project)
        sendTracksUpdated()
        sendEvent("harmonic_lab_commit_result", data: [
            "success": true,
            "trackIds": createdTrackIds
        ])
    }

    /// Duplicate a clip to a target position/track.
    /// Payload: { clipId: String, targetTrackId: String, targetBeat: Double }
    private func handleDuplicateClip(_ payload: [String: Any]) {
        guard let project = currentProject,
              let clipIdStr = payload["clipId"] as? String,
              let targetTrackIdStr = payload["targetTrackId"] as? String,
              let targetBeat = payload["targetBeat"] as? Double,
              let clipUUID = UUID(uuidString: clipIdStr),
              let targetTrackUUID = resolveTrackUUID(targetTrackIdStr) else { return }

        // Find the source clip
        var sourceClip: Clip?
        for track in project.tracks {
            if let clip = track.clips.first(where: { $0.id == clipUUID }) {
                sourceClip = clip
                break
            }
        }

        guard let source = sourceClip,
              let targetTrack = project.tracks.first(where: { $0.id == targetTrackUUID }) else { return }

        // Create a duplicate
        let dup = Clip(name: "\(source.name) copy", type: source.type, startBar: targetBeat / 4.0 + 1, lengthBars: source.lengthBars)
        dup.color = source.color
        dup.isLooped = source.isLooped
        dup.loopLengthBars = source.loopLengthBars
        dup.audioFile = source.audioFile
        dup.audioOffset = source.audioOffset
        dup.audioGain = source.audioGain

        // Deep copy MIDI events if present
        if let events = source.midiEvents {
            dup.midiEvents = events.map {
                MIDIEvent(tick: $0.tick, type: $0.type, note: $0.note, velocity: $0.velocity, duration: $0.duration, channel: $0.channel)
            }
        }

        targetTrack.addClip(dup)
        sendTracksUpdated()
    }

    /// Split a clip at a given beat position.
    /// Payload: { clipId: String, splitBeat: Double }
    private func handleSplitClip(_ payload: [String: Any]) {
        guard let project = currentProject,
              let clipIdStr = payload["clipId"] as? String,
              let splitBeat = payload["splitBeat"] as? Double,
              let clipUUID = UUID(uuidString: clipIdStr) else { return }

        let splitBar = splitBeat / 4.0 + 1  // Convert beat to 1-indexed bar

        for track in project.tracks {
            if let clip = track.clips.first(where: { $0.id == clipUUID }) {
                if let rightHalf = clip.split(atBar: splitBar) {
                    track.addClip(rightHalf)
                }
                break
            }
        }
        sendTracksUpdated()
    }

    /// Set the loop count for a clip.
    /// Payload: { clipId: String, loopCount: Int }
    private func handleSetClipLoop(_ payload: [String: Any]) {
        guard let project = currentProject,
              let clipIdStr = payload["clipId"] as? String,
              let loopCount = payload["loopCount"] as? Int,
              let clipUUID = UUID(uuidString: clipIdStr) else { return }

        for track in project.tracks {
            if let clip = track.clips.first(where: { $0.id == clipUUID }) {
                if loopCount <= 1 {
                    clip.isLooped = false
                    clip.loopLengthBars = nil
                } else {
                    let contentLength = clip.contentLengthBars
                    clip.isLooped = true
                    clip.loopLengthBars = contentLength
                    clip.lengthBars = contentLength * Double(loopCount)
                }
                break
            }
        }
        sendTracksUpdated()
    }

    /// Encode the current track list and send to JS as a `tracks_updated` event.
    private func sendTracksUpdated() {
        guard let project = currentProject else { return }

        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        guard let data = try? encoder.encode(project.tracks),
              let jsonString = String(data: data, encoding: .utf8) else {
            print("[Bridge] Failed to encode tracks for tracks_updated")
            return
        }

        let js = "if (window.__magicDAWReceive) { window.__magicDAWReceive('tracks_updated', { tracks: \(jsonString) }); }"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js) { _, error in
                if let error = error {
                    print("[Bridge] JS event error for tracks_updated: \(error.localizedDescription)")
                }
            }
        }
    }

    // MARK: - Note Editing Handlers

    private func findEditingClip(trackId: String?, clipId: String?) -> Clip? {
        guard let project = currentProject else { return nil }
        if let clipIdStr = clipId, let clipUUID = UUID(uuidString: clipIdStr) {
            for track in project.tracks {
                if let clip = track.clips.first(where: { $0.id == clipUUID && $0.type == .midi }) {
                    return clip
                }
            }
        }
        if let trackIdStr = trackId, let trackUUID = resolveTrackUUID(trackIdStr),
           let track = project.tracks.first(where: { $0.id == trackUUID }) {
            return track.clips.first { $0.type == .midi }
        }
        for track in project.tracks {
            if let clip = track.clips.first(where: { $0.type == .midi }) { return clip }
        }
        return nil
    }

    private func pushNoteUndoState(_ clip: Clip) {
        noteUndoStack.append(clip.midiEvents ?? [])
        if noteUndoStack.count > maxUndoEntries { noteUndoStack.removeFirst() }
        noteRedoStack.removeAll()
        editingClipId = clip.id
    }

    private func sendUpdatedNotes(_ clip: Clip) {
        let events = clip.notes
        let mapped = events.map { event -> [String: Any] in
            ["id": "\(event.note)-\(event.tick)-\(event.duration)",
             "pitch": Int(event.note), "start": event.tick,
             "duration": event.duration, "velocity": Int(event.velocity),
             "channel": Int(event.channel)]
        }
        sendEvent("notes_updated", data: ["notes": mapped])
    }

    private func handleAddNote(_ payload: [String: Any]) {
        guard let pitch = payload["pitch"] as? Int,
              let startBeat = payload["startBeat"] as? Double,
              let duration = payload["duration"] as? Double else { return }
        let velocity = payload["velocity"] as? Int ?? 100
        guard let clip = findEditingClip(trackId: payload["trackId"] as? String, clipId: payload["clipId"] as? String) else {
            print("[Bridge] No MIDI clip found for note editing"); return
        }
        pushNoteUndoState(clip)
        clip.addNote(tick: startBeat, note: UInt8(pitch), velocity: UInt8(velocity), duration: duration, channel: 0)
        sampler.noteOn(note: UInt8(pitch), velocity: UInt8(velocity))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.sampler.noteOff(note: UInt8(pitch))
        }
        sendUpdatedNotes(clip)
    }

    private func handleMoveNotes(_ payload: [String: Any]) {
        guard let noteIds = payload["noteIds"] as? [String] else { return }
        let deltaPitch = payload["deltaPitch"] as? Int ?? 0
        let deltaBeats = payload["deltaBeats"] as? Double ?? 0.0
        guard let clip = findEditingClip(trackId: payload["trackId"] as? String, clipId: payload["clipId"] as? String) else { return }
        pushNoteUndoState(clip)
        guard var events = clip.midiEvents else { return }
        let noteIdSet = Set(noteIds)
        for i in events.indices where events[i].type == .noteOn {
            let eventId = "\(events[i].note)-\(events[i].tick)-\(events[i].duration)"
            if noteIdSet.contains(eventId) {
                let newPitch = Int(events[i].note) + deltaPitch
                let newTick = events[i].tick + deltaBeats
                guard newPitch >= 0, newPitch <= 127, newTick >= 0 else { continue }
                events[i] = MIDIEvent(tick: newTick, type: .noteOn, note: UInt8(newPitch),
                                       velocity: events[i].velocity, duration: events[i].duration, channel: events[i].channel)
            }
        }
        clip.midiEvents = events.sorted()
        sendUpdatedNotes(clip)
    }

    private func handleResizeNote(_ payload: [String: Any]) {
        guard let noteId = payload["noteId"] as? String,
              let newDuration = payload["newDuration"] as? Double else { return }
        guard let clip = findEditingClip(trackId: payload["trackId"] as? String, clipId: payload["clipId"] as? String) else { return }
        pushNoteUndoState(clip)
        guard var events = clip.midiEvents else { return }
        for i in events.indices where events[i].type == .noteOn {
            if "\(events[i].note)-\(events[i].tick)-\(events[i].duration)" == noteId {
                events[i] = MIDIEvent(tick: events[i].tick, type: .noteOn, note: events[i].note,
                                       velocity: events[i].velocity, duration: max(0.0625, newDuration), channel: events[i].channel)
                break
            }
        }
        clip.midiEvents = events
        sendUpdatedNotes(clip)
    }

    private func handleDeleteNotes(_ payload: [String: Any]) {
        guard let noteIds = payload["noteIds"] as? [String] else { return }
        guard let clip = findEditingClip(trackId: payload["trackId"] as? String, clipId: payload["clipId"] as? String) else { return }
        pushNoteUndoState(clip)
        let noteIdSet = Set(noteIds)
        clip.midiEvents?.removeAll { event in
            event.type == .noteOn && noteIdSet.contains("\(event.note)-\(event.tick)-\(event.duration)")
        }
        sendUpdatedNotes(clip)
    }

    private func handleSetVelocity(_ payload: [String: Any]) {
        guard let noteId = payload["noteId"] as? String,
              let velocity = payload["velocity"] as? Int else { return }
        guard let clip = findEditingClip(trackId: payload["trackId"] as? String, clipId: payload["clipId"] as? String) else { return }
        pushNoteUndoState(clip)
        guard var events = clip.midiEvents else { return }
        for i in events.indices where events[i].type == .noteOn {
            if "\(events[i].note)-\(events[i].tick)-\(events[i].duration)" == noteId {
                events[i] = MIDIEvent(tick: events[i].tick, type: .noteOn, note: events[i].note,
                                       velocity: UInt8(max(1, min(127, velocity))), duration: events[i].duration, channel: events[i].channel)
                break
            }
        }
        clip.midiEvents = events
        sendUpdatedNotes(clip)
    }

    private func handlePasteNotes(_ payload: [String: Any]) {
        guard let notesArray = payload["notes"] as? [[String: Any]] else { return }
        guard let clip = findEditingClip(trackId: payload["trackId"] as? String, clipId: payload["clipId"] as? String) else { return }
        pushNoteUndoState(clip)
        for noteData in notesArray {
            guard let pitch = noteData["pitch"] as? Int,
                  let start = noteData["start"] as? Double,
                  let duration = noteData["duration"] as? Double else { continue }
            let velocity = noteData["velocity"] as? Int ?? 100
            let channel = noteData["channel"] as? Int ?? 0
            clip.addNote(tick: start, note: UInt8(pitch), velocity: UInt8(velocity), duration: duration, channel: UInt8(channel))
        }
        sendUpdatedNotes(clip)
    }

    private func handleNoteUndo() {
        guard let clipId = editingClipId, let project = currentProject, !noteUndoStack.isEmpty else { return }
        var targetClip: Clip?
        for track in project.tracks {
            if let clip = track.clips.first(where: { $0.id == clipId }) { targetClip = clip; break }
        }
        guard let clip = targetClip else { return }
        noteRedoStack.append(clip.midiEvents ?? [])
        clip.midiEvents = noteUndoStack.removeLast()
        sendUpdatedNotes(clip)
    }

    private func handleNoteRedo() {
        guard let clipId = editingClipId, let project = currentProject, !noteRedoStack.isEmpty else { return }
        var targetClip: Clip?
        for track in project.tracks {
            if let clip = track.clips.first(where: { $0.id == clipId }) { targetClip = clip; break }
        }
        guard let clip = targetClip else { return }
        noteUndoStack.append(clip.midiEvents ?? [])
        clip.midiEvents = noteRedoStack.removeLast()
        sendUpdatedNotes(clip)
    }

    // MARK: - Track ID Resolution

    /// Resolve a JS track ID string to a UUID.
    /// The JS side may send either a UUID string or a short name (e.g. "drums").
    /// When using short names, we look up the project's tracks by name.
    private func resolveTrackUUID(_ trackId: String) -> UUID? {
        // Try parsing as UUID first
        if let uuid = UUID(uuidString: trackId) {
            return uuid
        }

        // Fall back to looking up by track name in the current project
        if let project = currentProject {
            for track in project.tracks {
                if track.name.lowercased() == trackId.lowercased() ||
                   track.id.uuidString == trackId {
                    return track.id
                }
            }
        }

        print("[Bridge] Could not resolve track ID: \(trackId)")
        return nil
    }

    // MARK: - Effect Parameter Application

    /// Apply an effect parameter change to the audio engine's effects chain for a track.
    private func applyEffectParameter(trackID: UUID, effectIndex: Int, paramName: String, value: Double) {
        guard let project = currentProject,
              let track = project.tracks.first(where: { $0.id == trackID }),
              effectIndex >= 0 && effectIndex < track.effects.count else {
            print("[Bridge] Effect index \(effectIndex) out of range for track \(trackID)")
            return
        }

        let effectSlot = track.effects[effectIndex]
        var params = effectSlot.parameters
        params[paramName] = value
        track.effects[effectIndex].parameters = params
        print("[Bridge] Applied effect param: track=\(trackID) effect=\(effectSlot.effectType.rawValue) \(paramName)=\(value)")
    }

    private func handleSetTrackAutomation(_ payload: [String: Any]) {
        guard let project = currentProject,
              let trackIdStr = payload["trackId"] as? String,
              let typeStr = payload["type"] as? String,
              let type = TrackAutomationLane.AutomationType(rawValue: typeStr),
              let uuid = resolveTrackUUID(trackIdStr),
              let track = project.tracks.first(where: { $0.id == uuid }) else { return }

        let enabled = payload["enabled"] as? Bool ?? true
        let pointsPayload = payload["points"] as? [[String: Any]] ?? []
        let points = pointsPayload.compactMap { pointData -> AutomationPoint? in
            guard let barRaw = pointData["bar"],
                  let valueRaw = pointData["value"] else { return nil }
            let bar = (barRaw as? Double) ?? (barRaw as? NSNumber)?.doubleValue ?? Double("\(barRaw)")
            let value = (valueRaw as? Double) ?? (valueRaw as? NSNumber)?.doubleValue ?? Double("\(valueRaw)")
            guard let bar, let value else { return nil }
            return AutomationPoint(bar: max(1.0, bar), value: Float(max(0.0, min(1.0, value))))
        }

        track.automation.removeAll { $0.type == type }
        if !points.isEmpty {
            let laneID = "\(uuid.uuidString)-\(type.rawValue)"
            let lane = TrackAutomationLane(id: laneID, type: type, points: points, enabled: enabled)
            track.automation.append(lane)
        }
        track.automation.sort { $0.type.rawValue < $1.type.rawValue }

        if !audioEngine.isPlaying {
            restoreBaseTrackMixState()
        }
    }

    // MARK: - Effects Chain Handlers

    private func handleAddEffect(_ payload: [String: Any]) {
        guard let trackIdStr = payload["trackId"] as? String,
              let typeStr = payload["type"] as? String,
              let uuid = resolveTrackUUID(trackIdStr),
              let effectType = EffectType(rawValue: typeStr) else { return }
        audioEngine.addEffect(to: uuid, type: effectType)
        if let track = currentProject?.tracks.first(where: { $0.id == uuid }) {
            track.insertEffect(effectType)
        }
        sendEffectsChainState(for: uuid)
        sendTracksUpdated()
    }

    private func handleRemoveEffect(_ payload: [String: Any]) {
        guard let trackIdStr = payload["trackId"] as? String,
              let index = payload["index"] as? Int,
              let uuid = resolveTrackUUID(trackIdStr) else { return }
        audioEngine.removeEffect(from: uuid, at: index)
        if let track = currentProject?.tracks.first(where: { $0.id == uuid }),
           index >= 0 && index < track.effects.count {
            track.removeEffect(id: track.effects[index].id)
        }
        sendEffectsChainState(for: uuid)
        sendTracksUpdated()
    }

    private func handleSetEffectParam(_ payload: [String: Any]) {
        guard let trackIdStr = payload["trackId"] as? String,
              let index = payload["index"] as? Int,
              let paramName = payload["param"] as? String,
              let value = payload["value"] as? Double,
              let uuid = resolveTrackUUID(trackIdStr) else { return }
        audioEngine.setEffectParameter(trackID: uuid, effectIndex: index, paramName: paramName, value: value)
        if let track = currentProject?.tracks.first(where: { $0.id == uuid }),
           index >= 0 && index < track.effects.count {
            track.effects[index].parameters[paramName] = value
        }
        sendEffectsChainState(for: uuid)
    }

    private func handleReorderEffects(_ payload: [String: Any]) {
        guard let trackIdStr = payload["trackId"] as? String,
              let from = payload["from"] as? Int,
              let to = payload["to"] as? Int,
              let uuid = resolveTrackUUID(trackIdStr) else { return }
        audioEngine.reorderEffects(trackID: uuid, from: from, to: to)
        if let track = currentProject?.tracks.first(where: { $0.id == uuid }) {
            track.moveEffect(from: from, to: to)
        }
        sendEffectsChainState(for: uuid)
        sendTracksUpdated()
    }

    private func handleBypassEffect(_ payload: [String: Any]) {
        guard let trackIdStr = payload["trackId"] as? String,
              let index = payload["index"] as? Int,
              let bypassed = payload["bypassed"] as? Bool,
              let uuid = resolveTrackUUID(trackIdStr) else { return }
        audioEngine.bypassEffect(trackID: uuid, effectIndex: index, bypassed: bypassed)
        if let track = currentProject?.tracks.first(where: { $0.id == uuid }),
           index >= 0 && index < track.effects.count {
            track.effects[index].isEnabled = !bypassed
        }
        sendEffectsChainState(for: uuid)
    }

    private func handleSetSendLevel(_ payload: [String: Any]) {
        guard let trackIdStr = payload["trackId"] as? String,
              let busIdStr = payload["busId"] as? String,
              let level = payload["level"] as? Double,
              let trackUUID = resolveTrackUUID(trackIdStr),
              let busUUID = resolveTrackUUID(busIdStr) else { return }
        audioEngine.setSendLevel(from: trackUUID, to: busUUID, level: Float(level))
        if let track = currentProject?.tracks.first(where: { $0.id == trackUUID }) {
            if let idx = track.sends.firstIndex(where: { $0.busTrackId == busUUID }) {
                track.sends[idx].level = Float(level)
            } else {
                track.addSend(to: busUUID, level: Float(level))
            }
        }
        sendTracksUpdated()
    }

    private func sendEffectsChainState(for trackID: UUID) {
        let chainState = audioEngine.effectsChainState(for: trackID)
        sendEvent("effects_chain_updated", data: [
            "trackId": trackID.uuidString,
            "effects": chainState,
        ])
    }

    // MARK: - Plugin Builder Handlers

    private func handleAddNode(_ payload: [String: Any]) {
        guard let nodeType = payload["type"] as? String,
              let x = payload["x"] as? Double,
              let y = payload["y"] as? Double else { return }
        let nodeId = payload["id"] as? String ?? UUID().uuidString
        let defaults = payload["defaults"] as? [String: Double] ?? [:]
        guard let template = DSPNodeRegistry.template(for: nodeType) else {
            print("[Bridge] Unknown node type: \(nodeType)")
            return
        }
        var node = template.instantiate(id: nodeId, position: CGPoint(x: x, y: y))
        for (key, val) in defaults { node.setParameter(key, value: val) }
        pluginGraph.nodes.append(node)
        pluginValidateAndNotify()
        pluginSendGraphToJS()
    }

    private func handleRemoveNode(_ nodeId: String) {
        pluginGraph.nodes.removeAll { $0.id == nodeId }
        pluginGraph.connections.removeAll { $0.fromNode == nodeId || $0.toNode == nodeId }
        pluginRebuildPreview()
        pluginValidateAndNotify()
        pluginSendGraphToJS()
    }

    private func handleConnectNodes(_ payload: [String: Any]) {
        guard let fromNode = payload["fromNode"] as? String,
              let fromPort = payload["fromPort"] as? String,
              let toNode = payload["toNode"] as? String,
              let toPort = payload["toPort"] as? String else { return }
        let conn = ConnectionDefinition(fromNode: fromNode, fromPort: fromPort, toNode: toNode, toPort: toPort)
        if !pluginGraph.connections.contains(where: { $0.id == conn.id }) {
            pluginGraph.connections.append(conn)
        }
        pluginRebuildPreview()
        pluginValidateAndNotify()
        pluginSendGraphToJS()
    }

    private func handleDisconnectNodes(_ connId: String) {
        pluginGraph.connections.removeAll { $0.id == connId }
        pluginRebuildPreview()
        pluginValidateAndNotify()
        pluginSendGraphToJS()
    }

    private func handleSetNodeParam(_ payload: [String: Any]) {
        guard let nodeId = payload["nodeId"] as? String,
              let param = payload["param"] as? String,
              let value = payload["value"] as? Double else { return }
        if let idx = pluginGraph.nodes.firstIndex(where: { $0.id == nodeId }) {
            pluginGraph.nodes[idx].setParameter(param, value: value)
            if var dspNode = previewGraph.nodes[nodeId] {
                dspNode.parameters[param] = Float(value)
                previewGraph.nodes[nodeId] = dspNode
            }
        }
    }

    private func handleMoveNode(_ payload: [String: Any]) {
        guard let nodeId = payload["nodeId"] as? String,
              let x = payload["x"] as? Double,
              let y = payload["y"] as? Double else { return }
        if let idx = pluginGraph.nodes.firstIndex(where: { $0.id == nodeId }) {
            let old = pluginGraph.nodes[idx]
            pluginGraph.nodes[idx] = NodeDefinition(
                id: old.id, type: old.type, parameters: old.parameters,
                position: CGPoint(x: x, y: y)
            )
        }
    }

    private func handlePluginSyncGraph() {
        pluginValidateAndNotify()
        pluginSendGraphToJS()
    }

    private func handlePluginLoadTemplate(_ templateId: String) {
        pluginGraph = pluginTemplateGraph(templateId)
        pluginRebuildPreview()
        pluginValidateAndNotify()
        pluginSendGraphToJS()
    }

    private func pluginTemplateGraph(_ templateId: String) -> NodeGraphDefinition {
        func makeNode(_ type: String, _ id: String, _ x: Double, _ y: Double, _ params: [String: Double] = [:]) -> NodeDefinition {
            guard let template = DSPNodeRegistry.template(for: type) else {
                return NodeDefinition(id: id, type: type, parameters: [], position: CGPoint(x: x, y: y))
            }
            var node = template.instantiate(id: id, position: CGPoint(x: x, y: y))
            for (key, value) in params {
                node.setParameter(key, value: value)
            }
            return node
        }

        switch templateId {
        case "basic-synth":
            return NodeGraphDefinition(
                nodes: [
                    makeNode("oscillator", "osc1", 140, 180, [
                        "waveform": 1,
                        "amplitude": 0.72,
                        "detune": 3,
                    ]),
                    makeNode("lowpass", "filter1", 470, 180, [
                        "cutoff": 2400,
                        "resonance": 0.18,
                    ]),
                    makeNode("output", "output", 820, 180, [
                        "gain": 0.85,
                    ]),
                ],
                connections: [
                    ConnectionDefinition(fromNode: "osc1", fromPort: "audio", toNode: "filter1", toPort: "audio"),
                    ConnectionDefinition(fromNode: "filter1", fromPort: "audio", toNode: "output", toPort: "audio"),
                ],
                metadata: NodeGraphMetadata(
                    name: "Basic Synth",
                    author: "",
                    description: "Starter subtractive synth graph",
                    category: .instrument,
                    version: "1.0"
                )
            )
        case "bass-voice":
            return NodeGraphDefinition(
                nodes: [
                    makeNode("oscillator", "osc1", 120, 145, [
                        "waveform": 2,
                        "amplitude": 0.86,
                        "detune": 0,
                    ]),
                    makeNode("distortion", "drive1", 430, 145, [
                        "drive": 0.22,
                        "mix": 0.32,
                    ]),
                    makeNode("lowpass", "filter1", 710, 145, [
                        "cutoff": 920,
                        "resonance": 0.26,
                    ]),
                    makeNode("output", "output", 980, 145, [
                        "gain": 0.9,
                    ]),
                ],
                connections: [
                    ConnectionDefinition(fromNode: "osc1", fromPort: "audio", toNode: "drive1", toPort: "audio"),
                    ConnectionDefinition(fromNode: "drive1", fromPort: "audio", toNode: "filter1", toPort: "audio"),
                    ConnectionDefinition(fromNode: "filter1", fromPort: "audio", toNode: "output", toPort: "audio"),
                ],
                metadata: NodeGraphMetadata(
                    name: "Bass Voice",
                    author: "",
                    description: "Starter mono bass voice graph",
                    category: .instrument,
                    version: "1.0"
                )
            )
        case "noise-fx":
            return NodeGraphDefinition(
                nodes: [
                    makeNode("noise", "noise1", 120, 260, [
                        "amplitude": 0.5,
                        "noiseType": 1,
                    ]),
                    makeNode("delay", "delay1", 430, 260, [
                        "time": 420,
                        "feedback": 0.38,
                        "mix": 0.44,
                    ]),
                    makeNode("output", "output", 780, 260, [
                        "gain": 0.8,
                    ]),
                ],
                connections: [
                    ConnectionDefinition(fromNode: "noise1", fromPort: "audio", toNode: "delay1", toPort: "audio"),
                    ConnectionDefinition(fromNode: "delay1", fromPort: "audio", toNode: "output", toPort: "audio"),
                ],
                metadata: NodeGraphMetadata(
                    name: "Noise FX",
                    author: "",
                    description: "Starter noise and delay effect source",
                    category: .instrument,
                    version: "1.0"
                )
            )
        default:
            return NodeGraphDefinition.empty(name: "Untitled Plugin")
        }
    }

    private func pluginValidateAndNotify() {
        let errors = pluginGraph.validate()
        let errorDicts = errors.map { ["message": $0.description] as [String: Any] }
        sendEvent("plugin_validation", data: ["errors": errorDicts])
    }

    private func pluginSendGraphToJS() {
        let jsNodes = pluginGraph.nodes.map { node -> [String: Any] in
            let cat = pluginCategoryFor(node.type)
            let tmpl = DSPNodeRegistry.template(for: node.type)
            let params = Dictionary(uniqueKeysWithValues: node.parameters.map { ($0.name, $0.value as Any) })
            return [
                "id": node.id, "type": cat,
                "name": tmpl?.displayName ?? node.type,
                "x": node.position.x, "y": node.position.y,
                "params": params,
                "inputs": (tmpl?.inputs ?? ["audio"]) as [Any],
                "outputs": (tmpl?.outputs ?? ["audio"]) as [Any],
            ] as [String: Any]
        }
        let conns = pluginGraph.connections.map { c -> [String: Any] in
            ["id": c.id,
             "from": ["nodeId": c.fromNode, "port": c.fromPort] as [String: Any],
             "to": ["nodeId": c.toNode, "port": c.toPort] as [String: Any]]
        }
        sendEvent("plugin_graph_update", data: ["nodes": jsNodes, "connections": conns])
    }

    private func pluginCategoryFor(_ t: String) -> String {
        switch t {
        case "oscillator", "noise", "wavetable", "subOscillator": return "oscillator"
        case "lowpass", "highpass", "bandpass", "notch", "comb": return "filter"
        case "adsr", "multiStageEnvelope": return "envelope"
        case "lfo": return "lfo"
        case "delay", "reverb", "chorus", "distortion", "bitcrusher", "phaser", "flanger": return "effect"
        case "add", "multiply", "mix", "clamp", "scale": return "math"
        case "output": return "output"
        default: return "math"
        }
    }

    // MARK: - Plugin Live Preview

    private func startPluginPreview() {
        pluginRebuildPreview()
        isPreviewingPlugin = true
        startPreviewLevelTimer()
    }

    private func stopPluginPreview() {
        isPreviewingPlugin = false
        stopPreviewLevelTimer()
    }

    private func pluginRebuildPreview() {
        previewGraph = PluginDSPFactory.buildGraph(from: pluginGraph)
        pluginPreviewSynth.loadGraph(pluginGraph)
    }

    private func pluginPreviewInputPort(_ port: String, for nodeType: String?) -> String {
        guard port == "audio", let nodeType else { return port }
        switch nodeType {
        case "lowpass", "highpass", "bandpass", "notch", "comb",
             "delay", "reverb", "chorus", "distortion", "bitcrusher",
             "phaser", "flanger", "clamp", "scale", "output":
            return "input"
        default:
            return port
        }
    }

    private func pluginMakeDSPNode(_ def: NodeDefinition) -> (any DSPNode)? {
        func apply(_ defs: [ParameterDefinition], _ p: inout [String: Float]) {
            for d in defs { p[d.name] = Float(d.value) }
        }
        switch def.type {
        case "oscillator":
            var n = OscillatorNode(id: def.id); apply(def.parameters, &n.parameters); return n
        case "noise":
            var n = NoiseNode(id: def.id); apply(def.parameters, &n.parameters); return n
        case "lowpass":
            var n = LowPassFilterNode(id: def.id); apply(def.parameters, &n.parameters); return n
        case "adsr":
            var n = ADSRNode(id: def.id); apply(def.parameters, &n.parameters); return n
        case "lfo":
            var n = LFONode(id: def.id); apply(def.parameters, &n.parameters); return n
        case "delay":
            var n = DelayNode(id: def.id); apply(def.parameters, &n.parameters); return n
        case "distortion":
            var n = DistortionNode(id: def.id); apply(def.parameters, &n.parameters); return n
        case "mix":
            var n = MixNode(id: def.id); apply(def.parameters, &n.parameters); return n
        case "output":
            var n = OutputNode(id: def.id); apply(def.parameters, &n.parameters); return n
        default:
            return OutputNode(id: def.id)
        }
    }

    private func startPreviewLevelTimer() {
        stopPreviewLevelTimer()
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
        timer.schedule(deadline: .now(), repeating: .milliseconds(50))
        timer.setEventHandler { [weak self] in
            guard let self, self.isPreviewingPlugin else { return }
            let output = self.previewGraph.process(frameCount: 512, sampleRate: 44100.0)
            var rms: Float = 0
            for s in output { rms += s * s }
            rms = sqrt(rms / 512.0)
            self.sendEvent("plugin_preview_levels", data: ["left": min(1.0, rms), "right": min(1.0, rms)])
        }
        timer.resume()
        previewLevelTimer = timer
    }

    private func stopPreviewLevelTimer() {
        previewLevelTimer?.cancel()
        previewLevelTimer = nil
    }

    // MARK: - Plugin Export (AUv3)

    private func handleExportAUv3() async {
        let outputDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Desktop").appendingPathComponent("MagicDAW Plugins")
        sendEvent("plugin_export_progress", data: ["stage": "compiling", "message": "Compiling node graph..."])
        do {
            try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
            let plugin = try pluginCompiler.compile(pluginGraph)
            sendEvent("plugin_export_progress", data: ["stage": "building", "message": "Building AUv3 bundle..."])
            let appexURL = try await pluginCompiler.buildPlugin(plugin, outputDir: outputDir)
            let successMessage = "Export succeeded.\nBundle: \(appexURL.path)"
            let logURL = writePluginExportLog(in: outputDir, contents: successMessage)
            sendEvent("plugin_export_result", data: [
                "success": true,
                "path": appexURL.path,
                "message": successMessage,
                "logPath": logURL?.path ?? "",
            ])
        } catch {
            let failureMessage = error.localizedDescription
            let logURL = writePluginExportLog(in: outputDir, contents: failureMessage)
            sendEvent("plugin_export_result", data: [
                "success": false,
                "error": failureMessage,
                "logPath": logURL?.path ?? "",
            ])
        }
    }

    private func writePluginExportLog(in directory: URL, contents: String) -> URL? {
        let logURL = directory.appendingPathComponent("last-plugin-export.log")
        let stamped = "[\(ISO8601DateFormatter().string(from: Date()))]\n\(contents)\n"
        do {
            try stamped.write(to: logURL, atomically: true, encoding: .utf8)
            return logURL
        } catch {
            return nil
        }
    }

    private func handlePreviewCurrentPluginGraph(note: UInt8) {
        pluginPreviewSynth.loadGraph(pluginGraph)
        pluginPreviewSynth.noteOn(note: note, velocity: 104)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
            self?.pluginPreviewSynth.noteOff(note: note)
        }
    }

    private func handleSaveCurrentPluginGraph(_ payload: [String: Any]) {
        let requestedName = (payload["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let savedURL = try pluginGraphLibrary.saveGraph(pluginGraph, named: requestedName)
            sendEvent("plugin_saved", data: pluginGraphSummaryDict(for: savedURL))
            handleListSavedPluginGraphs()
        } catch {
            sendEvent("plugin_export_result", data: [
                "success": false,
                "error": error.localizedDescription,
                "logPath": "",
            ])
        }
    }

    private func handleListSavedPluginGraphs() {
        let graphs = pluginGraphLibrary.listGraphs().map { summary -> [String: Any] in
            [
                "name": summary.name,
                "path": summary.path,
                "category": summary.category,
                "description": summary.description,
                "version": summary.version,
                "modifiedAt": ISO8601DateFormatter().string(from: summary.modifiedAt),
            ]
        }
        sendEvent("plugin_saved_list", data: ["graphs": graphs])
    }

    private func handleLoadSavedPluginGraph(path: String) {
        do {
            pluginGraph = try pluginGraphLibrary.loadGraph(at: URL(fileURLWithPath: path))
            pluginRebuildPreview()
            pluginValidateAndNotify()
            pluginSendGraphToJS()
        } catch {
            sendEvent("plugin_export_result", data: [
                "success": false,
                "error": error.localizedDescription,
                "logPath": "",
            ])
        }
    }

    private func handleAssignCurrentPluginGraphToTrack(trackIdStr: String?) {
        do {
            let savedURL = try pluginGraphLibrary.saveGraph(pluginGraph)
            handleAssignSavedPluginGraphToTrack(path: savedURL.path, trackIdStr: trackIdStr)
            handleListSavedPluginGraphs()
        } catch {
            sendEvent("instrument_error", data: ["error": error.localizedDescription])
        }
    }

    private func handleAssignSavedPluginGraphToTrack(path: String, trackIdStr: String?) {
        guard let trackIdStr,
              let uuid = resolveTrackUUID(trackIdStr),
              let track = currentProject?.tracks.first(where: { $0.id == uuid }) else {
            sendEvent("instrument_error", data: ["error": "No target track selected"])
            return
        }
        guard track.type == .midi else {
            sendEvent("instrument_error", data: ["error": "Graph synths can only be assigned to MIDI tracks right now"])
            return
        }

        do {
            let graph = try pluginGraphLibrary.loadGraph(at: URL(fileURLWithPath: path))
            guard graph.metadata.category == .instrument else {
                sendEvent("instrument_error", data: ["error": "Only instrument graphs can be assigned to MIDI tracks right now"])
                return
            }

            track.instrument = InstrumentRef(
                type: .synth,
                name: graph.metadata.name,
                path: path,
                gmProgram: nil,
                bankMSB: nil,
                presetId: nil
            )
            refreshTrackInstrument(for: track)
            sendTracksUpdated()
            sendEvent("instrument_assigned", data: [
                "trackId": trackIdStr,
                "name": graph.metadata.name,
                "path": path,
                "type": "plugin-graph",
            ])
        } catch {
            sendEvent("instrument_error", data: ["error": error.localizedDescription])
        }
    }

    private func pluginGraphSummaryDict(for url: URL) -> [String: Any] {
        let graph = (try? pluginGraphLibrary.loadGraph(at: url)) ?? pluginGraph
        return [
            "name": graph.metadata.name,
            "path": url.path,
            "category": graph.metadata.category.rawValue,
            "description": graph.metadata.description,
            "version": graph.metadata.version,
            "modifiedAt": ISO8601DateFormatter().string(from: Date()),
        ]
    }

    // MARK: - AI Instrument Sound Design

    /// Generate ADSR + filter parameters from a text description and apply to the Sampler.
    private func handleInstrumentDesignSound(description: String) async {
        sendEvent("instrument_ai_status", data: ["status": "loading", "message": "Designing sound..."])

        let patch = await soundDesignService.designSoundWithFallback(description: description)

        // Extract ADSR from envelope node
        var attack = 0.01, decay = 0.2, sustain = 0.7, release = 0.3
        if let envNode = patch.nodes.first(where: { $0.type == "envelope" }) {
            attack = envNode.parameters["attack"] ?? attack
            decay = envNode.parameters["decay"] ?? decay
            sustain = envNode.parameters["sustain"] ?? sustain
            release = envNode.parameters["release"] ?? release
        }

        // Extract filter from filter node
        var cutoff = 8000.0, resonance = 0.5
        var filterType = "LP"
        if let filterNode = patch.nodes.first(where: { $0.type == "filter" }) {
            cutoff = filterNode.parameters["cutoff"] ?? cutoff
            resonance = filterNode.parameters["resonance"] ?? resonance
            if let ft = filterNode.parameters["type"] {
                switch Int(ft) {
                case 1: filterType = "HP"
                case 2: filterType = "BP"
                case 3: filterType = "Notch"
                default: filterType = "LP"
                }
            }
        }

        // Apply to sampler
        sampler.attack = Float(attack)
        sampler.decay = Float(decay)
        sampler.sustain = Float(sustain)
        sampler.release = Float(release)
        sampler.filterCutoff = Float(cutoff)
        sampler.filterResonance = Float(resonance)

        // Send result back to UI
        sendEvent("instrument_ai_patch", data: [
            "name": patch.name,
            "description": patch.description,
            "adsr": [
                "attack": attack,
                "decay": decay,
                "sustain": sustain,
                "release": release,
            ],
            "filter": [
                "cutoff": cutoff,
                "resonance": resonance,
                "type": filterType,
            ],
            "success": true,
        ])
        sendEvent("instrument_ai_status", data: ["status": "done"])
    }

    /// Auto-map loaded samples to keyboard zones using AI.
    private func handleInstrumentMapZones() async {
        sendEvent("instrument_ai_status", data: ["status": "loading", "message": "Mapping zones..."])

        // Gather sample metadata from the sampler
        let meta = sampler.sampleMetadata()
        var sampleInfos: [SampleInfo] = []
        for entry in meta {
            sampleInfos.append(SampleInfo(
                filename: entry.filename,
                detectedPitch: nil,
                durationSeconds: entry.durationSeconds,
                rmsLevel: 0.5
            ))
        }

        guard !sampleInfos.isEmpty else {
            sendEvent("instrument_ai_status", data: ["status": "error", "message": "No samples loaded"])
            return
        }

        let result = await soundDesignService.suggestSampleMappingWithFallback(samples: sampleInfos)

        do {
            let mappedZones = result.zones.map { zone in
                SampleZone(
                    sampleFile: zone.sampleFile,
                    trigger: .attack,
                    rootNote: zone.rootNote,
                    lowNote: zone.lowNote,
                    highNote: zone.highNote,
                    lowVelocity: zone.lowVelocity,
                    highVelocity: zone.highVelocity,
                    loopStart: nil,
                    loopEnd: nil,
                    tuning: 0.0
                )
            }
            try sampler.applyZoneMappings(mappedZones)
            sendInstrumentZones()
            sendEvent("instrument_ai_status", data: ["status": "done", "message": result.explanation])
        } catch {
            sendEvent("instrument_ai_status", data: ["status": "error", "message": error.localizedDescription])
        }
    }

    private func handleSaveCurrentSamplerInstrument(_ payload: [String: Any]) {
        let providedName = (payload["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallbackName = providedName?.isEmpty == false ? providedName! : "Sample Rack"
        guard let exported = sampler.exportPreviewInstrument(named: fallbackName) else {
            sendEvent("instrument_error", data: ["error": "No sampler rack loaded"])
            return
        }

        do {
            let savedURL = try instrumentLibrary.saveSampleInstrument(
                name: exported.definition.name,
                definition: exported.definition,
                sampleSources: exported.sources
            )
            sendEvent("instrument_assigned", data: [
                "name": exported.definition.name,
                "path": savedURL.path,
                "type": "sample-rack",
            ])
        } catch {
            sendEvent("instrument_error", data: ["error": error.localizedDescription])
        }
    }

    private func handleAssignPreviewRackToTrack(_ payload: [String: Any]) {
        guard let trackIdStr = payload["trackId"] as? String,
              let trackID = resolveTrackUUID(trackIdStr),
              let track = currentProject?.tracks.first(where: { $0.id == trackID }) else {
            sendEvent("instrument_error", data: ["error": "No target track selected"])
            return
        }

        let providedName = (payload["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallbackName = providedName?.isEmpty == false ? providedName! : track.name + " Rack"
        guard let exported = sampler.exportPreviewInstrument(named: fallbackName) else {
            sendEvent("instrument_error", data: ["error": "No sampler rack loaded"])
            return
        }

        do {
            let savedURL = try instrumentLibrary.saveSampleInstrument(
                name: exported.definition.name,
                definition: exported.definition,
                sampleSources: exported.sources
            )
            track.instrument = InstrumentRef(
                type: .sampler,
                name: exported.definition.name,
                path: savedURL.path,
                gmProgram: nil,
                bankMSB: nil,
                presetId: nil
            )
            refreshTrackInstrument(for: track)
            sendTracksUpdated()
            sendEvent("instrument_assigned", data: [
                "trackId": trackIdStr,
                "name": exported.definition.name,
                "path": savedURL.path,
                "type": "sample-rack",
            ])
        } catch {
            sendEvent("instrument_error", data: ["error": error.localizedDescription])
        }
    }

    private func detectMIDINoteFromFilename(_ filename: String) -> UInt8? {
        let pattern = #"(?i)([A-G])([#b]?)(-?\d)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(filename.startIndex..<filename.endIndex, in: filename)
        guard let match = regex.firstMatch(in: filename, options: [], range: range),
              let noteRange = Range(match.range(at: 1), in: filename),
              let accidentalRange = Range(match.range(at: 2), in: filename),
              let octaveRange = Range(match.range(at: 3), in: filename) else { return nil }

        let noteName = String(filename[noteRange]).uppercased()
        let accidental = String(filename[accidentalRange])
        let octave = Int(filename[octaveRange]) ?? 4

        let basePitchClass: Int
        switch noteName {
        case "C": basePitchClass = 0
        case "D": basePitchClass = 2
        case "E": basePitchClass = 4
        case "F": basePitchClass = 5
        case "G": basePitchClass = 7
        case "A": basePitchClass = 9
        case "B": basePitchClass = 11
        default: return nil
        }

        let accidentalOffset: Int
        switch accidental {
        case "#": accidentalOffset = 1
        case "b", "B": accidentalOffset = -1
        default: accidentalOffset = 0
        }

        let midiNote = (octave + 1) * 12 + basePitchClass + accidentalOffset
        guard midiNote >= 0, midiNote <= 127 else { return nil }
        return UInt8(midiNote)
    }

    // MARK: - Instrument Factory (GM Presets)

    /// Create a new GM instrument preset from a text description using AI.
    private func handleCreatePreset(description: String) async {
        sendEvent("instrument_ai_status", data: ["status": "loading", "message": "Designing instrument..."])

        let result = await soundDesignService.designGMInstrument(description: description)
        let preset = InstrumentPreset(from: result)

        do {
            try instrumentLibrary.savePreset(preset)
        } catch {
            sendEvent("instrument_ai_status", data: ["status": "error", "message": error.localizedDescription])
            return
        }

        sendEvent("instrument_preset_created", data: presetToDict(preset))
        sendEvent("instrument_ai_status", data: ["status": "done"])
    }

    /// List all saved instrument presets.
    private func handleListPresets() {
        let presets = instrumentLibrary.listPresets()
        let list = presets.map { presetToDict($0) }
        sendEvent("instrument_preset_list", data: ["presets": list])
    }

    /// Delete an instrument preset by ID.
    private func handleDeletePreset(id: UUID) {
        do {
            try instrumentLibrary.deletePreset(id: id)
            sendEvent("instrument_preset_deleted", data: ["id": id.uuidString])
        } catch {
            sendEvent("instrument_error", data: ["error": error.localizedDescription])
        }
    }

    /// Assign a preset to the sampler (global for now; per-track is future work).
    private func handleAssignPresetToTrack(presetId: UUID, trackIdStr: String?) {
        do {
            let preset = try instrumentLibrary.loadPreset(id: presetId)
            if let trackIdStr = trackIdStr,
               let uuid = resolveTrackUUID(trackIdStr),
               let track = currentProject?.tracks.first(where: { $0.id == uuid }) {
                track.instrument = InstrumentRef(
                    type: .sampler,
                    name: preset.name,
                    path: nil,
                    gmProgram: preset.gmProgram,
                    bankMSB: preset.bankMSB,
                    presetId: preset.id
                )
                refreshTrackInstrument(for: track)
                if let trackSampler = trackSamplers[track.id] ?? ensureTrackSampler(for: track) {
                    trackSampler.applyPreset(preset)
                }
                sendTracksUpdated()
            } else {
                sampler.applyPreset(preset)
            }

            sendEvent("instrument_assigned", data: [
                "presetId": presetId.uuidString,
                "trackId": trackIdStr ?? "",
                "name": preset.name,
            ])
        } catch {
            sendEvent("instrument_error", data: ["error": error.localizedDescription])
        }
    }

    /// Assign a GM program directly to the sampler (no preset ID needed).
    private func handleAssignGMProgram(_ program: UInt8, trackIdStr: String?, name: String?) {
        let trimmedName = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedName = (trimmedName?.isEmpty == false) ? trimmedName! : "Program \(Int(program) + 1)"

        if let trackIdStr = trackIdStr,
           let uuid = resolveTrackUUID(trackIdStr),
           let track = currentProject?.tracks.first(where: { $0.id == uuid }) {
            track.instrument = InstrumentRef(type: .sampler, name: resolvedName, path: nil, gmProgram: program, bankMSB: 0x79, presetId: nil)
            refreshTrackInstrument(for: track)
            sendTracksUpdated()
        } else {
            sampler.setGMProgram(program)
        }

        sendEvent("instrument_assigned", data: [
            "gmProgram": Int(program),
            "trackId": trackIdStr ?? "",
            "name": resolvedName,
        ])
    }

    private func handleAssignSavedRackToTrack(path: String, trackIdStr: String?) {
        guard let trackIdStr,
              let uuid = resolveTrackUUID(trackIdStr),
              let track = currentProject?.tracks.first(where: { $0.id == uuid }) else {
            sendEvent("instrument_error", data: ["error": "No target track selected"])
            return
        }

        do {
            let definition = try instrumentLibrary.loadSampleInstrumentDefinition(at: URL(fileURLWithPath: path))
            track.instrument = InstrumentRef(
                type: .sampler,
                name: definition.name,
                path: path,
                gmProgram: nil,
                bankMSB: nil,
                presetId: nil
            )
            refreshTrackInstrument(for: track)
            sendTracksUpdated()
            sendEvent("instrument_assigned", data: [
                "trackId": trackIdStr,
                "name": definition.name,
                "path": path,
                "type": "sample-rack",
            ])
        } catch {
            sendEvent("instrument_error", data: ["error": error.localizedDescription])
        }
    }

    /// Preview a preset: apply it to the sampler and play a note.
    private func handlePreviewPreset(presetId: UUID, note: UInt8) {
        do {
            let preset = try instrumentLibrary.loadPreset(id: presetId)
            sampler.applyPreset(preset)
            sampler.noteOn(note: note, velocity: 100)
            // Auto note-off after a short duration
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.sampler.noteOff(note: note)
            }
        } catch {
            sendEvent("instrument_error", data: ["error": error.localizedDescription])
        }
    }

    /// Convert an InstrumentPreset to a dictionary for sending to JS.
    private func presetToDict(_ preset: InstrumentPreset) -> [String: Any] {
        let formatter = ISO8601DateFormatter()
        return [
            "id": preset.id.uuidString,
            "name": preset.name,
            "description": preset.description,
            "gmProgram": Int(preset.gmProgram),
            "bankMSB": Int(preset.bankMSB),
            "attack": Double(preset.attack),
            "decay": Double(preset.decay),
            "sustain": Double(preset.sustain),
            "release": Double(preset.release),
            "filterCutoff": Double(preset.filterCutoff),
            "filterResonance": Double(preset.filterResonance),
            "filterType": preset.filterType,
            "createdAt": formatter.string(from: preset.createdAt),
        ]
    }

    // MARK: - AI Patch Generation (Plugin Builder)

    private func handleAIGeneratePatch(description: String) async {
        let patch = await soundDesignService.designSoundWithFallback(description: description)
        var newGraph = NodeGraphDefinition.empty(name: patch.name)
        newGraph.nodes.removeAll()
        for (i, spec) in patch.nodes.enumerated() {
            let mapped = normalizedAIGraphNodeType(for: spec)
            guard let tmpl = DSPNodeRegistry.template(for: mapped) else { continue }
            var node = tmpl.instantiate(id: spec.id, position: CGPoint(x: Double(100 + i * 220), y: Double(100 + (i % 3) * 180)))
            for (k, v) in spec.parameters {
                if let normalized = normalizedAIGraphParameterName(k, for: mapped) {
                    node.setParameter(normalized, value: normalizedAIGraphParameterValue(v, parameter: normalized, nodeType: mapped))
                }
            }
            newGraph.nodes.append(node)
        }
        for c in patch.connections {
            newGraph.connections.append(ConnectionDefinition(
                fromNode: c.from,
                fromPort: normalizedAIGraphOutputPort(c.fromPort),
                toNode: c.to,
                toPort: normalizedAIGraphInputPort(c.toPort)
            ))
        }
        if !newGraph.nodes.contains(where: { $0.type == "output" }) {
            let ot = DSPNodeRegistry.template(for: "output")!
            newGraph.nodes.append(ot.instantiate(id: "output", position: CGPoint(x: 800, y: 200)))
        }
        newGraph.metadata = NodeGraphMetadata(
            name: patch.name,
            author: "Ollama",
            description: patch.description,
            category: .instrument,
            version: "1.0"
        )
        newGraph = PluginDSPFactory.normalizedDefinitionForInternalPlayback(from: newGraph)
        pluginGraph = newGraph
        pluginRebuildPreview()
        pluginValidateAndNotify()
        pluginSendGraphToJS()
        sendEvent("plugin_ai_result", data: ["success": true])
    }

    private func normalizedAIGraphNodeType(for spec: SynthNodeSpec) -> String {
        switch spec.type.lowercased() {
        case "filter":
            let filterType = Int(spec.parameters["type"] ?? 0)
            switch filterType {
            case 1: return "highpass"
            case 2: return "bandpass"
            case 3: return "notch"
            default: return "lowpass"
            }
        case "mixer":
            return "mix"
        case "envelope":
            return "adsr"
        default:
            return spec.type
        }
    }

    private func normalizedAIGraphParameterName(_ name: String, for nodeType: String) -> String? {
        switch (nodeType, name) {
        case ("oscillator", "level"), ("noise", "level"), ("wavetable", "level"), ("subOscillator", "level"):
            return "amplitude"
        case ("output", "level"):
            return "gain"
        case ("reverb", "size"):
            return "roomSize"
        case ("noise", "color"):
            return "noiseType"
        case ("mix", "level"):
            return "mix"
        case (_, "type"):
            return nodeType == "lowpass" || nodeType == "highpass" || nodeType == "bandpass" || nodeType == "notch" ? nil : name
        default:
            return name
        }
    }

    private func normalizedAIGraphParameterValue(_ value: Double, parameter: String, nodeType: String) -> Double {
        switch (nodeType, parameter) {
        case ("delay", "time"):
            return value < 10.0 ? value * 1000.0 : value
        case ("lowpass", "cutoff"), ("highpass", "cutoff"), ("bandpass", "cutoff"), ("notch", "cutoff"), ("comb", "frequency"):
            if value <= 1.0 {
                return 20.0 + (value * 19_980.0)
            }
            return value
        default:
            return value
        }
    }

    private func normalizedAIGraphInputPort(_ port: String) -> String {
        switch port {
        case "audio":
            return "input"
        case "input1":
            return "input1"
        case "input2":
            return "input2"
        case "input3":
            return "input3"
        case "pitch":
            return "frequency"
        default:
            return port
        }
    }

    private func normalizedAIGraphOutputPort(_ port: String) -> String {
        switch port {
        case "output":
            return "audio"
        default:
            return port
        }
    }
}
