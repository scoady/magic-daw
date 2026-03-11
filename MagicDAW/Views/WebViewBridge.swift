import AppKit
import AVFoundation
import Foundation
import UniformTypeIdentifiers
import WebKit

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
    /// AI router for patch generation (lazy — shares ollamaClient)
    private lazy var aiRouter = AIRouter(client: ollamaClient)
    /// Sound design service for AI patch generation
    private lazy var soundDesignService = SoundDesignService(router: aiRouter)
    /// Instrument preset library (persisted to ~/Library/Application Support/MagicDAW/Instruments/)
    private lazy var instrumentLibrary = InstrumentLibrary()

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

    override init() {
        super.init()
        do {
            try audioEngine.setup()
        } catch {
            print("[WebViewBridge] Failed to start audio engine: \(error)")
        }
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
            // 1. Play through sampler (falls back to GM synth if no custom samples)
            self.sampler.noteOn(note: note, velocity: velocity)
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
            self.sampler.noteOff(note: note)
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

        // High-frequency transport tick: drive MIDIPlayer and Metronome
        audioEngine.onTransportTick = { [weak self] currentBeat in
            guard let self else { return }
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
            self.finalizeRecording()
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
                audioEngine.setTrackVolume(uuid, volume: Float(volume))
            }

        case "set_track_pan":
            if let trackId = payload["trackId"] as? String,
               let pan = payload["pan"] as? Double,
               let uuid = resolveTrackUUID(trackId) {
                audioEngine.setTrackPan(uuid, pan: Float(pan))
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
                let url = URL(fileURLWithPath: path)
                let project = currentProject ?? DAWProject(name: "Untitled")
                do {
                    try projectManager.save(project, to: url)
                    sendEvent("project_saved", data: ["success": true, "path": path])
                } catch {
                    sendEvent("project_saved", data: ["success": false, "error": error.localizedDescription])
                }
            }

        case "project.load":
            if let path = payload["path"] as? String {
                let url = URL(fileURLWithPath: path)
                do {
                    let project = try projectManager.load(from: url)
                    currentProject = project
                    let encoder = JSONEncoder()
                    encoder.outputFormatting = .prettyPrinted
                    let data = try encoder.encode(project)
                    if let json = String(data: data, encoding: .utf8) {
                        sendEvent("project_loaded", data: ["project": json])
                    }
                } catch {
                    sendEvent("project_loaded", data: ["error": error.localizedDescription])
                }
            }

        case "project.new":
            let name = payload["name"] as? String ?? "Untitled"
            let bpm = payload["bpm"] as? Double ?? 120.0
            let project = DAWProject(name: name)
            project.bpm = bpm
            currentProject = project
            onProjectChanged?(project)
            sendEvent("project_created", data: ["name": name])

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

        case "instrument.importSample":
            await handleImportSample()

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
            if let presetIdStr = payload["presetId"] as? String,
               let presetUUID = UUID(uuidString: presetIdStr) {
                handleAssignPresetToTrack(presetId: presetUUID, trackIdStr: trackIdStr)
            } else if let gmProg = payload["gmProgram"] as? Int {
                handleAssignGMProgram(UInt8(gmProg), trackIdStr: trackIdStr)
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

        case "plugin_preview_start":
            startPluginPreview()

        case "plugin_preview_stop":
            stopPluginPreview()

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

    /// Create a new project with default starter tracks, update state, and notify JS.
    func newProject() {
        let project = DAWProject(name: "Untitled")

        // Add default starter tracks so the user has something to work with
        let midi1 = project.addMIDITrack(name: "MIDI 1", color: .teal)
        let midi2 = project.addMIDITrack(name: "MIDI 2", color: .purple)
        let audio1 = project.addAudioTrack(name: "Audio 1", color: .blue)

        // Register in audio engine
        for track in [midi1, midi2, audio1] {
            let audioTrack = AudioTrack(
                id: track.id,
                name: track.name,
                volume: track.linearGain,
                pan: track.pan,
                isMuted: track.isMuted,
                isSoloed: track.isSoloed,
                isBus: false
            )
            audioEngine.addTrack(audioTrack)
        }

        currentProject = project
        onProjectChanged?(project)
        sendProjectToJS(project)
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
            let project = try projectManager.load(from: url)
            currentProject = project
            onProjectChanged?(project)
            sendProjectToJS(project)
        } catch {
            sendEvent("project_loaded", data: ["error": error.localizedDescription])
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
        let js = "if (window.__magicDAWReceive) { window.__magicDAWReceive('project_data', { project: \(jsonString) }); }"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js) { _, error in
                if let error = error {
                    print("[Bridge] JS event error for project_data: \(error.localizedDescription)")
                }
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

    /// Send the current sample zone map to the JS UI.
    private func sendInstrumentZones() {
        let zones = sampler.loadedZones().map { zone -> [String: Any] in
            [
                "rootNote": Int(zone.rootNote),
                "lowNote": Int(zone.lowNote),
                "highNote": Int(zone.highNote),
            ]
        }
        sendEvent("instrument_zones", data: ["zones": zones])
    }

    // MARK: - MIDI Playback / Recording

    /// Start playback: load clips into MIDIPlayer and start the transport.
    private func startPlayback() {
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
        let audioTrack = AudioTrack(
            id: track.id,
            name: track.name,
            volume: track.linearGain,
            pan: track.pan,
            isMuted: track.isMuted,
            isSoloed: track.isSoloed,
            isBus: false
        )
        audioEngine.addTrack(audioTrack)

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
        let audioTrack = AudioTrack(
            id: track.id,
            name: track.name,
            volume: track.linearGain,
            pan: track.pan,
            isMuted: track.isMuted,
            isSoloed: track.isSoloed,
            isBus: typeStr == "bus"
        )
        if typeStr == "bus" {
            audioEngine.addBusTrack(audioTrack)
        } else {
            audioEngine.addTrack(audioTrack)
        }

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
        let g = DSPGraph()
        for nd in pluginGraph.nodes {
            if let dn = pluginMakeDSPNode(nd) { g.addNode(dn) }
        }
        for c in pluginGraph.connections {
            g.connect(from: c.fromNode, fromPort: c.fromPort, to: c.toNode, toPort: c.toPort)
        }
        if let out = pluginGraph.nodes.first(where: { $0.type == "output" }) { g.outputNode = out.id }
        previewGraph = g
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
        sendEvent("plugin_export_progress", data: ["stage": "compiling", "message": "Compiling node graph..."])
        do {
            let plugin = try pluginCompiler.compile(pluginGraph)
            sendEvent("plugin_export_progress", data: ["stage": "building", "message": "Building AUv3 bundle..."])
            let outputDir = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Desktop").appendingPathComponent("MagicDAW Plugins")
            try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
            let appexURL = try await pluginCompiler.buildPlugin(plugin, outputDir: outputDir)
            sendEvent("plugin_export_result", data: ["success": true, "path": appexURL.path])
        } catch {
            sendEvent("plugin_export_result", data: ["success": false, "error": error.localizedDescription])
        }
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

        // Apply zone mappings
        let zones = result.zones.map { zone -> [String: Any] in
            [
                "sampleFile": zone.sampleFile,
                "rootNote": Int(zone.rootNote),
                "lowNote": Int(zone.lowNote),
                "highNote": Int(zone.highNote),
                "lowVelocity": Int(zone.lowVelocity),
                "highVelocity": Int(zone.highVelocity),
            ]
        }

        sendEvent("instrument_zones", data: ["zones": zones, "explanation": result.explanation])
        sendEvent("instrument_ai_status", data: ["status": "done"])
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
            sampler.applyPreset(preset)

            // Update track instrument ref in the project if a trackId was provided
            if let trackIdStr = trackIdStr,
               let uuid = resolveTrackUUID(trackIdStr),
               let track = currentProject?.tracks.first(where: { $0.id == uuid }) {
                track.instrument = InstrumentRef(type: .sampler, name: preset.name, path: nil)
                sendTracksUpdated()
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
    private func handleAssignGMProgram(_ program: UInt8, trackIdStr: String?) {
        sampler.setGMProgram(program)

        let name = trackIdStr != nil ? "GM \(program)" : "GM \(program)"

        // Update track instrument ref
        if let trackIdStr = trackIdStr,
           let uuid = resolveTrackUUID(trackIdStr),
           let track = currentProject?.tracks.first(where: { $0.id == uuid }) {
            track.instrument = InstrumentRef(type: .sampler, name: name, path: nil)
            sendTracksUpdated()
        }

        sendEvent("instrument_assigned", data: [
            "gmProgram": Int(program),
            "trackId": trackIdStr ?? "",
            "name": name,
        ])
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
            let mapped: String
            switch spec.type.lowercased() {
            case "filter": mapped = "lowpass"
            case "mixer": mapped = "mix"
            case "envelope": mapped = "adsr"
            default: mapped = spec.type
            }
            guard let tmpl = DSPNodeRegistry.template(for: mapped) else { continue }
            var node = tmpl.instantiate(id: spec.id, position: CGPoint(x: Double(100 + i * 220), y: Double(100 + (i % 3) * 180)))
            for (k, v) in spec.parameters { node.setParameter(k, value: v) }
            newGraph.nodes.append(node)
        }
        for c in patch.connections {
            newGraph.connections.append(ConnectionDefinition(fromNode: c.from, fromPort: c.fromPort, toNode: c.to, toPort: c.toPort))
        }
        if !newGraph.nodes.contains(where: { $0.type == "output" }) {
            let ot = DSPNodeRegistry.template(for: "output")!
            newGraph.nodes.append(ot.instantiate(id: "output", position: CGPoint(x: 800, y: 200)))
        }
        pluginGraph = newGraph
        pluginRebuildPreview()
        pluginValidateAndNotify()
        pluginSendGraphToJS()
        sendEvent("plugin_ai_result", data: ["success": true])
    }
}
