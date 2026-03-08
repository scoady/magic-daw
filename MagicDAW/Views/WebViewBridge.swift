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

    override init() {
        super.init()
        setupCallbacks()
    }

    // MARK: - Setup

    private func setupCallbacks() {
        // Forward MIDI input events to JavaScript
        midiManager.onMIDIReceived = { [weak self] message in
            let data: [String: Any] = [
                "status": message.status,
                "channel": message.channel,
                "data1": message.data1,
                "data2": message.data2,
                "type": message.type.rawValue
            ]
            self?.sendToJS(handler: "onMIDI", data: data)
        }

        // Forward audio levels to JavaScript
        audioEngine.onLevelUpdate = { [weak self] left, right in
            let data: [String: Any] = ["left": left, "right": right]
            self?.sendToJS(handler: "onAudioLevel", data: data)
        }

        // Forward transport state changes
        audioEngine.onTransportChange = { [weak self] state in
            let data: [String: Any] = [
                "isPlaying": state.isPlaying,
                "isRecording": state.isRecording,
                "position": state.position,
                "bpm": state.bpm
            ]
            self?.sendToJS(handler: "onTransport", data: data)
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
            let msg = MIDIMessage(type: .noteOn, channel: UInt8(channel), data1: UInt8(note), data2: UInt8(velocity))
            midiManager.sendToAllDestinations(message: msg)
            audioEngine.handleMIDI(message: msg)

        case "midi.noteOff":
            guard let note = payload["note"] as? Int,
                  let channel = payload["channel"] as? Int else { return }
            let msg = MIDIMessage(type: .noteOff, channel: UInt8(channel), data1: UInt8(note), data2: 0)
            midiManager.sendToAllDestinations(message: msg)
            audioEngine.handleMIDI(message: msg)

        case "midi.cc":
            guard let controller = payload["controller"] as? Int,
                  let value = payload["value"] as? Int,
                  let channel = payload["channel"] as? Int else { return }
            let msg = MIDIMessage(type: .controlChange, channel: UInt8(channel), data1: UInt8(controller), data2: UInt8(value))
            midiManager.sendToAllDestinations(message: msg)

        case "midi.listDevices":
            let sources = midiManager.listSources()
            let destinations = midiManager.listDestinations()
            let data: [String: Any] = ["sources": sources, "destinations": destinations]
            sendToJS(handler: "onMIDIDevices", data: data)

        case "midi.connectSource":
            if let index = payload["index"] as? Int {
                midiManager.connect(sourceIndex: index)
            }

        // Audio messages
        case "audio.play":
            audioEngine.play()

        case "audio.stop":
            audioEngine.stop()

        case "audio.record":
            audioEngine.toggleRecord()

        case "audio.setBPM":
            if let bpm = payload["bpm"] as? Double {
                audioEngine.setBPM(bpm)
            }

        case "audio.setVolume":
            if let volume = payload["volume"] as? Float {
                audioEngine.setMasterVolume(volume)
            }

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
                let modelData = models.map { ["name": $0.name, "size": $0.size, "modified": $0.modifiedAt] }
                sendToJS(handler: "onAIModels", data: ["models": modelData])
            } catch {
                sendToJS(handler: "onAIModels", data: ["error": error.localizedDescription])
            }

        case "ai.checkStatus":
            let available = await ollamaClient.isAvailable()
            sendToJS(handler: "onAIStatus", data: ["available": available])

        // Project messages
        case "project.save":
            if let path = payload["path"] as? String {
                let url = URL(fileURLWithPath: path)
                do {
                    try projectManager.save(to: url)
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
            projectManager.createNew(name: name, bpm: bpm)
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
