import AppKit
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
        setupCallbacks()
        setupMIDIRouter()
        startMeterTimer()
    }

    // MARK: - Setup

    private func setupCallbacks() {
        // Forward MIDI note-on events to JavaScript via bridge.ts pub/sub
        // Also play through the sampler if samples are loaded
        midiManager.onNoteOn = { [weak self] note, velocity, channel in
            guard let self else { return }
            if self.sampler.hasSamples {
                self.sampler.noteOn(note: note, velocity: velocity)
            }
            self.sendEvent("midi_note_on", data: [
                "note": note,
                "velocity": velocity,
                "channel": channel,
            ])
        }

        // Forward MIDI note-off events to JavaScript via bridge.ts pub/sub
        midiManager.onNoteOff = { [weak self] note, channel in
            guard let self else { return }
            if self.sampler.hasSamples {
                self.sampler.noteOff(note: note)
            }
            self.sendEvent("midi_note_off", data: [
                "note": note,
                "channel": channel,
            ])
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
            // Play through sampler if loaded
            if sampler.hasSamples {
                sampler.noteOn(note: UInt8(note), velocity: UInt8(velocity))
            }
            // Send note-on to all connected MIDI destinations
            for dest in midiManager.availableDestinations {
                midiManager.sendNoteOn(note: UInt8(note), velocity: UInt8(velocity), channel: UInt8(channel), to: dest)
            }

        case "midi.noteOff":
            guard let note = payload["note"] as? Int,
                  let channel = payload["channel"] as? Int else { return }
            if sampler.hasSamples {
                sampler.noteOff(note: UInt8(note))
            }
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
            audioEngine.play()
            startTransportStateTimer()
            sendTransportState()

        case "transport_stop", "audio.stop":
            audioEngine.stop()
            stopTransportStateTimer()
            sendTransportState()

        case "transport_record", "audio.record":
            audioEngine.record()
            startTransportStateTimer()
            sendTransportState()

        case "transport_rewind":
            audioEngine.seekToBar(1)
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

        default:
            print("[Bridge] Unknown message type: \(type)")
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

    /// Create a new empty project, update state, and notify JS.
    func newProject() {
        let project = DAWProject(name: "Untitled")
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

    // MARK: - AI Patch Generation

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
