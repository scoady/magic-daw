import AVFoundation
import Foundation

final class GraphSynth {
    private struct PendingEvent {
        enum Kind {
            case noteOn
            case noteOff
            case allNotesOff
        }

        let kind: Kind
        let note: UInt8
        let velocity: UInt8
    }

    private struct VoiceEnvelope {
        enum Stage {
            case attack
            case decay
            case sustain
            case release
            case done
        }

        let attack: Double
        let decay: Double
        let sustain: Double
        let release: Double
        var stage: Stage = .attack
        var level: Float = 0

        mutating func noteOff() {
            guard stage != .done else { return }
            stage = .release
        }

        mutating func nextLevel(sampleRate: Double) -> Float {
            let attackStep = attack <= 0.0001 ? 1.0 : Float(1.0 / (attack * sampleRate))
            let decayStep = decay <= 0.0001 ? 1.0 : Float((1.0 - sustain) / (decay * sampleRate))
            let releaseStep = release <= 0.0001 ? 1.0 : Float(max(0.0001, Double(level)) / (release * sampleRate))

            switch stage {
            case .attack:
                level += attackStep
                if level >= 1.0 {
                    level = 1.0
                    stage = .decay
                }
            case .decay:
                level -= decayStep
                if level <= Float(sustain) {
                    level = Float(sustain)
                    stage = .sustain
                }
            case .sustain:
                level = Float(sustain)
            case .release:
                level -= releaseStep
                if level <= 0.0001 {
                    level = 0
                    stage = .done
                }
            case .done:
                level = 0
            }

            return level
        }
    }

    private struct Voice {
        let note: UInt8
        let velocity: UInt8
        var graph: DSPGraph
        var envelope: VoiceEnvelope
    }

    private let engine: AVAudioEngine
    private let outputMixer: AVAudioMixerNode
    private let eventLock = NSLock()

    private var graphDefinition = NodeGraphDefinition.empty(name: "Untitled Plugin")
    private var activeVoices: [Voice] = []
    private var pendingEvents: [PendingEvent] = []
    private var sampleRate: Double = 44_100
    private var outputGain: Float = 0.8

    private lazy var sourceNode: AVAudioSourceNode = {
        AVAudioSourceNode { [weak self] _, _, frameCount, audioBufferList -> OSStatus in
            guard let self else { return noErr }
            let abl = UnsafeMutableAudioBufferListPointer(audioBufferList)
            let frames = Int(frameCount)
            guard frames > 0 else { return noErr }

            var left = [Float](repeating: 0, count: frames)
            var right = [Float](repeating: 0, count: frames)

            self.render(intoLeft: &left, right: &right, frameCount: frames)

            for bufferIndex in 0..<abl.count {
                guard let destination = abl[bufferIndex].mData?.assumingMemoryBound(to: Float.self) else { continue }
                if bufferIndex == 0 {
                    left.withUnsafeBufferPointer { source in
                        destination.assign(from: source.baseAddress!, count: frames)
                    }
                } else {
                    right.withUnsafeBufferPointer { source in
                        destination.assign(from: source.baseAddress!, count: frames)
                    }
                }
            }

            return noErr
        }
    }()

    init(engine: AVAudioEngine) {
        self.engine = engine
        self.outputMixer = AVAudioMixerNode()

        engine.attach(sourceNode)
        engine.attach(outputMixer)
    }

    func connect(to destination: AVAudioMixerNode) {
        let format = destination.outputFormat(forBus: 0)
        sampleRate = format.sampleRate > 0 ? format.sampleRate : 44_100
        engine.connect(sourceNode, to: outputMixer, format: format)
        engine.connect(outputMixer, to: destination, format: format)
        outputMixer.outputVolume = outputGain
    }

    func loadGraph(_ definition: NodeGraphDefinition) {
        graphDefinition = definition
        allNotesOff()
    }

    func noteOn(note: UInt8, velocity: UInt8) {
        enqueue(.init(kind: .noteOn, note: note, velocity: velocity))
    }

    func noteOff(note: UInt8) {
        enqueue(.init(kind: .noteOff, note: note, velocity: 0))
    }

    func allNotesOff() {
        enqueue(.init(kind: .allNotesOff, note: 0, velocity: 0))
    }

    private func enqueue(_ event: PendingEvent) {
        eventLock.lock()
        pendingEvents.append(event)
        eventLock.unlock()
    }

    private func render(intoLeft left: inout [Float], right: inout [Float], frameCount: Int) {
        let events = drainPendingEvents()
        if !events.isEmpty {
            apply(events: events)
        }

        guard !activeVoices.isEmpty else {
            return
        }

        for voiceIndex in activeVoices.indices.reversed() {
            let samples = activeVoices[voiceIndex].graph.process(frameCount: frameCount, sampleRate: sampleRate)
            var removeVoice = false
            for frame in 0..<frameCount {
                let envelopeLevel = activeVoices[voiceIndex].envelope.nextLevel(sampleRate: sampleRate)
                let sample = (frame < samples.count ? samples[frame] : 0) * envelopeLevel
                left[frame] += sample
                right[frame] += sample
                if activeVoices[voiceIndex].envelope.stage == .done {
                    removeVoice = true
                }
            }

            if removeVoice {
                activeVoices.remove(at: voiceIndex)
            }
        }
    }

    private func drainPendingEvents() -> [PendingEvent] {
        eventLock.lock()
        let events = pendingEvents
        pendingEvents.removeAll(keepingCapacity: true)
        eventLock.unlock()
        return events
    }

    private func apply(events: [PendingEvent]) {
        for event in events {
            switch event.kind {
            case .noteOn:
                let graph = PluginDSPFactory.prepareInstrumentGraph(
                    from: graphDefinition,
                    note: event.note,
                    velocity: event.velocity
                )
                let settings = PluginDSPFactory.envelopeSettings(from: graphDefinition)
                activeVoices.append(
                    Voice(
                        note: event.note,
                        velocity: event.velocity,
                        graph: graph,
                        envelope: VoiceEnvelope(
                            attack: settings.attack,
                            decay: settings.decay,
                            sustain: settings.sustain,
                            release: settings.release
                        )
                    )
                )
            case .noteOff:
                for index in activeVoices.indices where activeVoices[index].note == event.note {
                    activeVoices[index].envelope.noteOff()
                }
            case .allNotesOff:
                activeVoices.removeAll()
            }
        }
    }
}
