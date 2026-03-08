import Foundation
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
    private var currentProject: DAWProject?

    override init() {
        super.init()
        setupCallbacks()
    }

    // MARK: - Setup

    private func setupCallbacks() {
        // Forward MIDI note-on events to JavaScript
        midiManager.onNoteOn = { [weak self] note, velocity, channel in
            let data: [String: Any] = [
                "type": "noteOn",
                "note": note,
                "velocity": velocity,
                "channel": channel
            ]
            self?.sendToJS(handler: "onMIDI", data: data)
        }

        // Forward MIDI note-off events to JavaScript
        midiManager.onNoteOff = { [weak self] note, channel in
            let data: [String: Any] = [
                "type": "noteOff",
                "note": note,
                "channel": channel
            ]
            self?.sendToJS(handler: "onMIDI", data: data)
        }

        // Forward MIDI CC events to JavaScript
        midiManager.onControlChange = { [weak self] controller, value, channel in
            let data: [String: Any] = [
                "type": "controlChange",
                "controller": controller,
                "value": value,
                "channel": channel
            ]
            self?.sendToJS(handler: "onMIDI", data: data)
        }

        // Forward MIDI pitch bend events to JavaScript
        midiManager.onPitchBend = { [weak self] value, channel in
            let data: [String: Any] = [
                "type": "pitchBend",
                "value": value,
                "channel": channel
            ]
            self?.sendToJS(handler: "onMIDI", data: data)
        }
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
            // Send note-on to all connected MIDI destinations
            for dest in midiManager.availableDestinations {
                midiManager.sendNoteOn(note: UInt8(note), velocity: UInt8(velocity), channel: UInt8(channel), to: dest)
            }

        case "midi.noteOff":
            guard let note = payload["note"] as? Int,
                  let channel = payload["channel"] as? Int else { return }
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
            let sources = midiManager.availableSources.map { ["id": $0.id, "name": $0.name] as [String: Any] }
            let destinations = midiManager.availableDestinations.map { ["id": $0.id, "name": $0.name] as [String: Any] }
            let data: [String: Any] = ["sources": sources, "destinations": destinations]
            sendToJS(handler: "onMIDIDevices", data: data)

        case "midi.connectSource":
            if let index = payload["index"] as? Int,
               index < midiManager.availableSources.count {
                let source = midiManager.availableSources[index]
                try? midiManager.connect(to: source)
            }

        // Audio messages
        case "audio.play":
            audioEngine.play()

        case "audio.stop":
            audioEngine.stop()

        case "audio.record":
            audioEngine.record()

        case "audio.setBPM":
            if let bpm = payload["bpm"] as? Double {
                audioEngine.setBPM(bpm)
            }

        case "audio.setVolume":
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
                sendToJS(handler: "onAI", data: ["result": result, "requestId": payload["requestId"] ?? ""])
            } catch {
                sendToJS(handler: "onAI", data: ["error": error.localizedDescription, "requestId": payload["requestId"] ?? ""])
            }

        case "ai.listModels":
            do {
                let models = try await ollamaClient.listModels()
                let modelData = models.map { ["name": $0.name, "size": $0.size, "modified": $0.modifiedAt] as [String: Any] }
                sendToJS(handler: "onAIModels", data: ["models": modelData])
            } catch {
                sendToJS(handler: "onAIModels", data: ["error": error.localizedDescription])
            }

        case "ai.checkStatus":
            let available = await ollamaClient.checkAvailability()
            sendToJS(handler: "onAIStatus", data: ["available": available])

        // Project messages
        case "project.save":
            if let path = payload["path"] as? String {
                let url = URL(fileURLWithPath: path)
                let project = currentProject ?? DAWProject(name: "Untitled")
                do {
                    try projectManager.save(project, to: url)
                    sendToJS(handler: "onProjectSaved", data: ["success": true, "path": path])
                } catch {
                    sendToJS(handler: "onProjectSaved", data: ["success": false, "error": error.localizedDescription])
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
                        sendToJS(handler: "onProjectLoaded", data: ["project": json])
                    }
                } catch {
                    sendToJS(handler: "onProjectLoaded", data: ["error": error.localizedDescription])
                }
            }

        case "project.new":
            let name = payload["name"] as? String ?? "Untitled"
            let bpm = payload["bpm"] as? Double ?? 120.0
            let project = DAWProject(name: name)
            project.bpm = bpm
            currentProject = project
            sendToJS(handler: "onProjectCreated", data: ["name": name])

        default:
            print("[Bridge] Unknown message type: \(type)")
        }
    }

    // MARK: - Send to JavaScript

    func sendToJS(handler: String, data: [String: Any]) {
        guard let jsonData = try? JSONSerialization.data(withJSONObject: data),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            print("[Bridge] Failed to serialize data for handler: \(handler)")
            return
        }

        let js = "if (window.magicdaw && window.magicdaw.\(handler)) { window.magicdaw.\(handler)(\(jsonString)); }"

        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js) { _, error in
                if let error = error {
                    print("[Bridge] JS evaluation error for \(handler): \(error.localizedDescription)")
                }
            }
        }
    }
}
