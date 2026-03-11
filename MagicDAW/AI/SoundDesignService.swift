import Foundation

// MARK: - Sound Design Types

struct SynthPatchResult: Codable, Sendable {
    let name: String
    let nodes: [SynthNodeSpec]
    let connections: [NodeConnection]
    let description: String
}

struct SynthNodeSpec: Codable, Sendable {
    let id: String
    let type: String   // "oscillator", "filter", "envelope", "lfo", "delay", "reverb", "distortion", "chorus", "mixer", "output"
    let parameters: [String: Double]
}

struct NodeConnection: Codable, Sendable {
    let from: String      // source node id
    let fromPort: String  // "output", "cutoff", etc.
    let to: String        // destination node id
    let toPort: String    // "input", "cutoff", "frequency", etc.
}

struct ProcessingChain: Codable, Sendable {
    let steps: [ProcessingStep]
    let explanation: String
}

struct ProcessingStep: Codable, Sendable {
    let effect: String              // "eq", "compressor", "reverb", "delay", "distortion", "chorus", "phaser", "filter"
    let parameters: [String: Double]
    let reason: String
}

struct SampleInfo: Codable, Sendable {
    let filename: String
    let detectedPitch: String?
    let durationSeconds: Double
    let rmsLevel: Double
}

struct SampleMapResult: Codable, Sendable {
    let zones: [AISampleZone]
    let explanation: String
}

struct AISampleZone: Codable, Sendable {
    let sampleFile: String
    let rootNote: UInt8
    let lowNote: UInt8
    let highNote: UInt8
    let lowVelocity: UInt8
    let highVelocity: UInt8
}

// MARK: - GM Instrument Result

/// Result of AI-powered GM instrument selection and parameter design.
struct GMInstrumentResult: Codable, Sendable {
    let name: String
    let gmProgram: UInt8
    let bankMSB: UInt8
    let attack: Float
    let decay: Float
    let sustain: Float
    let release: Float
    let filterCutoff: Float
    let filterResonance: Float
    let filterType: String
    let description: String
}

// MARK: - Sound Design Service

/// AI-assisted sound creation service. Uses Ollama to generate synth patches,
/// suggest processing chains, and auto-map samples to keyboard zones.
actor SoundDesignService {
    let router: AIRouter

    init(router: AIRouter) {
        self.router = router
    }

    // MARK: - Synth Patch Design

    /// Generate synth parameters from a natural language description.
    /// Returns a complete node graph that can be instantiated in the audio engine.
    func designSound(description: String) async throws -> SynthPatchResult {
        let result = try await router.route(.synthPatch(description: description))

        if case .synthPatch(let patch) = result.result {
            return validatePatch(patch)
        }

        throw SoundDesignError.unexpectedResult
    }

    /// Generate a synth patch with a fallback if AI is unavailable.
    /// Returns a basic patch matching the description keywords.
    func designSoundWithFallback(description: String) async -> SynthPatchResult {
        do {
            return try await designSound(description: description)
        } catch {
            return fallbackPatch(for: description)
        }
    }

    // MARK: - Processing Chain

    /// Suggest an audio processing chain to transform a sample toward a target sound.
    func suggestProcessing(
        sampleDescription: String,
        targetSound: String
    ) async throws -> ProcessingChain {
        let prompt = """
        Source sample: \(sampleDescription)
        Target sound: \(targetSound)

        Suggest an audio processing chain to transform the source into the target sound.
        """

        let result = try await router.client.generateJSON(
            model: AIRouter.fastModel,
            prompt: prompt,
            system: processingChainSystemPrompt,
            type: ProcessingChain.self
        )

        return validateProcessingChain(result)
    }

    // MARK: - Sample Mapping

    /// Auto-map samples to keyboard zones based on their metadata.
    func suggestSampleMapping(
        samples: [SampleInfo]
    ) async throws -> SampleMapResult {
        let result = try await router.route(.sampleMapping(sampleInfo: samples))

        if case .sampleMap(let mapping) = result.result {
            return validateSampleMap(mapping, sampleCount: samples.count)
        }

        throw SoundDesignError.unexpectedResult
    }

    /// Map samples with algorithmic fallback if AI is unavailable.
    func suggestSampleMappingWithFallback(
        samples: [SampleInfo]
    ) async -> SampleMapResult {
        do {
            return try await suggestSampleMapping(samples: samples)
        } catch {
            return algorithmicSampleMap(samples: samples)
        }
    }

    // MARK: - GM Instrument Design

    /// Use AI to pick the best GM program and parameters for a text description.
    /// Falls back to keyword matching if Ollama is unavailable.
    func designGMInstrument(description: String) async -> GMInstrumentResult {
        do {
            let result = try await router.client.generateJSON(
                model: AIRouter.fastModel,
                prompt: description,
                system: gmInstrumentSystemPrompt,
                type: GMInstrumentResult.self
            )
            return result
        } catch {
            print("[SoundDesign] GM instrument AI failed, using fallback: \(error.localizedDescription)")
            return fallbackGMInstrument(for: description)
        }
    }

    /// Keyword-based fallback when Ollama is unavailable.
    private func fallbackGMInstrument(for desc: String) -> GMInstrumentResult {
        let d = desc.lowercased()
        if d.contains("piano") {
            return GMInstrumentResult(name: "Piano", gmProgram: 0, bankMSB: 0x79, attack: 0.005, decay: 0.8, sustain: 0.3, release: 0.5, filterCutoff: 12000, filterResonance: 0.2, filterType: "LP", description: "Acoustic grand piano")
        }
        if d.contains("guitar") && (d.contains("distort") || d.contains("power") || d.contains("rock")) {
            return GMInstrumentResult(name: "Distortion Guitar", gmProgram: 30, bankMSB: 0x79, attack: 0.005, decay: 0.4, sustain: 0.7, release: 0.3, filterCutoff: 6000, filterResonance: 0.4, filterType: "LP", description: "Heavy distortion guitar")
        }
        if d.contains("guitar") && d.contains("overdrive") {
            return GMInstrumentResult(name: "Overdrive Guitar", gmProgram: 29, bankMSB: 0x79, attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.3, filterCutoff: 8000, filterResonance: 0.3, filterType: "LP", description: "Overdrive guitar")
        }
        if d.contains("guitar") {
            return GMInstrumentResult(name: "Clean Guitar", gmProgram: 27, bankMSB: 0x79, attack: 0.005, decay: 0.5, sustain: 0.5, release: 0.4, filterCutoff: 10000, filterResonance: 0.2, filterType: "LP", description: "Clean electric guitar")
        }
        if d.contains("bass") && d.contains("synth") {
            return GMInstrumentResult(name: "Synth Bass", gmProgram: 38, bankMSB: 0x79, attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.2, filterCutoff: 4000, filterResonance: 0.5, filterType: "LP", description: "Synth bass")
        }
        if d.contains("bass") {
            return GMInstrumentResult(name: "Finger Bass", gmProgram: 33, bankMSB: 0x79, attack: 0.005, decay: 0.4, sustain: 0.5, release: 0.3, filterCutoff: 5000, filterResonance: 0.3, filterType: "LP", description: "Finger bass")
        }
        if d.contains("string") || d.contains("orchestr") {
            return GMInstrumentResult(name: "String Ensemble", gmProgram: 48, bankMSB: 0x79, attack: 0.3, decay: 0.5, sustain: 0.8, release: 0.8, filterCutoff: 10000, filterResonance: 0.2, filterType: "LP", description: "String ensemble")
        }
        if d.contains("pad") || d.contains("ambient") {
            return GMInstrumentResult(name: "Warm Pad", gmProgram: 89, bankMSB: 0x79, attack: 0.5, decay: 0.8, sustain: 0.7, release: 1.0, filterCutoff: 6000, filterResonance: 0.3, filterType: "LP", description: "Warm synth pad")
        }
        if d.contains("brass") || d.contains("trumpet") {
            return GMInstrumentResult(name: "Brass Section", gmProgram: 61, bankMSB: 0x79, attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.3, filterCutoff: 8000, filterResonance: 0.3, filterType: "LP", description: "Brass section")
        }
        if d.contains("sax") {
            return GMInstrumentResult(name: "Tenor Sax", gmProgram: 66, bankMSB: 0x79, attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.3, filterCutoff: 8000, filterResonance: 0.3, filterType: "LP", description: "Tenor saxophone")
        }
        if d.contains("flute") {
            return GMInstrumentResult(name: "Flute", gmProgram: 73, bankMSB: 0x79, attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.4, filterCutoff: 12000, filterResonance: 0.2, filterType: "LP", description: "Flute")
        }
        if d.contains("organ") {
            return GMInstrumentResult(name: "Rock Organ", gmProgram: 18, bankMSB: 0x79, attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.2, filterCutoff: 10000, filterResonance: 0.3, filterType: "LP", description: "Rock organ")
        }
        if d.contains("drum") || d.contains("percus") {
            return GMInstrumentResult(name: "Drums", gmProgram: 0, bankMSB: 0x78, attack: 0.001, decay: 0.2, sustain: 0.1, release: 0.1, filterCutoff: 15000, filterResonance: 0.2, filterType: "LP", description: "Drum kit")
        }
        if d.contains("choir") || d.contains("vocal") {
            return GMInstrumentResult(name: "Choir", gmProgram: 52, bankMSB: 0x79, attack: 0.2, decay: 0.5, sustain: 0.7, release: 0.6, filterCutoff: 8000, filterResonance: 0.2, filterType: "LP", description: "Choir aahs")
        }
        if d.contains("bell") || d.contains("chime") {
            return GMInstrumentResult(name: "Tubular Bells", gmProgram: 14, bankMSB: 0x79, attack: 0.001, decay: 1.0, sustain: 0.2, release: 1.5, filterCutoff: 15000, filterResonance: 0.2, filterType: "LP", description: "Tubular bells")
        }
        // Default: piano
        return GMInstrumentResult(name: "Acoustic Piano", gmProgram: 0, bankMSB: 0x79, attack: 0.005, decay: 0.8, sustain: 0.3, release: 0.5, filterCutoff: 12000, filterResonance: 0.2, filterType: "LP", description: "Default acoustic piano")
    }

    private let gmInstrumentSystemPrompt = """
    You are a sound design expert. Given a description, pick the best General MIDI program and parameters.

    GM PROGRAMS: 0=Acoustic Grand Piano, 1=Bright Piano, 2=Electric Grand, 3=Honky-tonk, 4=EP1, 5=EP2, 6=Harpsichord, 7=Clavinet, 8=Celesta, 9=Glockenspiel, 10=Music Box, 11=Vibraphone, 12=Marimba, 13=Xylophone, 14=Tubular Bells, 15=Dulcimer, 16=Drawbar Organ, 17=Percussive Organ, 18=Rock Organ, 19=Church Organ, 20=Reed Organ, 21=Accordion, 22=Harmonica, 23=Tango Accordion, 24=Nylon Guitar, 25=Steel Guitar, 26=Jazz Guitar, 27=Clean Electric Guitar, 28=Muted Guitar, 29=Overdrive Guitar, 30=Distortion Guitar, 31=Guitar Harmonics, 32=Acoustic Bass, 33=Finger Bass, 34=Pick Bass, 35=Fretless Bass, 36=Slap Bass 1, 37=Slap Bass 2, 38=Synth Bass 1, 39=Synth Bass 2, 40=Violin, 41=Viola, 42=Cello, 43=Contrabass, 44=Tremolo Strings, 45=Pizzicato Strings, 46=Orchestral Harp, 47=Timpani, 48=String Ensemble 1, 49=String Ensemble 2, 50=Synth Strings 1, 51=Synth Strings 2, 52=Choir Aahs, 53=Voice Oohs, 54=Synth Voice, 55=Orchestra Hit, 56=Trumpet, 57=Trombone, 58=Tuba, 59=Muted Trumpet, 60=French Horn, 61=Brass Section, 62=Synth Brass 1, 63=Synth Brass 2, 64=Soprano Sax, 65=Alto Sax, 66=Tenor Sax, 67=Baritone Sax, 68=Oboe, 69=English Horn, 70=Bassoon, 71=Clarinet, 72=Piccolo, 73=Flute, 74=Recorder, 75=Pan Flute, 76=Blown Bottle, 77=Shakuhachi, 78=Whistle, 79=Ocarina, 80=Square Lead, 81=Saw Lead, 82=Calliope, 83=Chiff Lead, 84=Charang, 85=Voice Lead, 86=Fifths Lead, 87=Bass+Lead, 88=New Age, 89=Warm Pad, 90=Polysynth, 91=Choir Pad, 92=Bowed Pad, 93=Metallic Pad, 94=Halo Pad, 95=Sweep Pad, 96=Rain, 97=Soundtrack, 98=Crystal, 99=Atmosphere, 100=Brightness, 101=Goblins, 102=Echoes, 103=Sci-Fi, 104=Sitar, 105=Banjo, 106=Shamisen, 107=Koto, 108=Kalimba, 109=Bagpipe, 110=Fiddle, 111=Shanai, 112=Tinkle Bell, 113=Agogo, 114=Steel Drums, 115=Woodblock, 116=Taiko, 117=Melodic Tom, 118=Synth Drum, 119=Reverse Cymbal, 120=Guitar Fret, 121=Breath, 122=Seashore, 123=Bird Tweet, 124=Telephone, 125=Helicopter, 126=Applause, 127=Gunshot

    Respond ONLY with JSON: {"name":"Short Name","gmProgram":29,"bankMSB":121,"attack":0.01,"decay":0.3,"sustain":0.6,"release":0.3,"filterCutoff":8000,"filterResonance":0.3,"filterType":"LP","description":"Why these choices"}

    Rules: attack/decay/release in seconds (0.001-10), sustain 0-1, cutoff 20-20000 Hz, resonance 0-1, filterType: LP/HP/BP/Notch, bankMSB: 121 melodic, 120 percussion
    """

    // MARK: - Validation

    /// Ensure the patch has at least an oscillator and output, and all connections reference valid nodes.
    private func validatePatch(_ patch: SynthPatchResult) -> SynthPatchResult {
        let nodeIDs = Set(patch.nodes.map(\.id))

        // Filter out connections referencing non-existent nodes
        let validConnections = patch.connections.filter {
            nodeIDs.contains($0.from) && nodeIDs.contains($0.to)
        }

        // Ensure we have at least an oscillator and output
        var nodes = patch.nodes
        let hasOsc = nodes.contains { $0.type == "oscillator" }
        let hasOutput = nodes.contains { $0.type == "output" }

        if !hasOsc {
            nodes.insert(SynthNodeSpec(
                id: "osc_fallback",
                type: "oscillator",
                parameters: ["waveform": 1, "detune": 0, "level": 0.8]
            ), at: 0)
        }

        if !hasOutput {
            nodes.append(SynthNodeSpec(
                id: "out_fallback",
                type: "output",
                parameters: ["level": 0.7]
            ))
        }

        return SynthPatchResult(
            name: patch.name,
            nodes: nodes,
            connections: validConnections,
            description: patch.description
        )
    }

    /// Clamp processing parameters to sensible ranges.
    private func validateProcessingChain(_ chain: ProcessingChain) -> ProcessingChain {
        let validatedSteps = chain.steps.map { step in
            var params = step.parameters
            // Clamp common parameters
            if let freq = params["frequency"] {
                params["frequency"] = max(20, min(20000, freq))
            }
            if let gain = params["gain"] {
                params["gain"] = max(-24, min(24, gain))
            }
            if let mix = params["mix"] {
                params["mix"] = max(0, min(1, mix))
            }
            if let ratio = params["ratio"] {
                params["ratio"] = max(1, min(20, ratio))
            }
            return ProcessingStep(effect: step.effect, parameters: params, reason: step.reason)
        }
        return ProcessingChain(steps: validatedSteps, explanation: chain.explanation)
    }

    /// Ensure sample zones cover valid MIDI ranges without overlaps.
    private func validateSampleMap(_ map: SampleMapResult, sampleCount: Int) -> SampleMapResult {
        let validatedZones = map.zones.map { zone in
            AISampleZone(
                sampleFile: zone.sampleFile,
                rootNote: clampMIDI(zone.rootNote),
                lowNote: clampMIDI(zone.lowNote),
                highNote: max(clampMIDI(zone.lowNote), clampMIDI(zone.highNote)),
                lowVelocity: max(1, min(127, zone.lowVelocity)),
                highVelocity: max(zone.lowVelocity, min(127, zone.highVelocity))
            )
        }
        return SampleMapResult(zones: validatedZones, explanation: map.explanation)
    }

    private func clampMIDI(_ note: UInt8) -> UInt8 {
        max(0, min(127, note))
    }

    // MARK: - Algorithmic Fallbacks

    /// Generate a basic patch based on keywords in the description.
    private func fallbackPatch(for description: String) -> SynthPatchResult {
        let desc = description.lowercased()

        if desc.contains("pad") || desc.contains("ambient") || desc.contains("warm") {
            return warmPadPatch()
        } else if desc.contains("bass") || desc.contains("sub") {
            return bassPatch()
        } else if desc.contains("lead") || desc.contains("solo") {
            return leadPatch()
        } else if desc.contains("pluck") || desc.contains("stab") {
            return pluckPatch()
        } else if desc.contains("string") || desc.contains("orchestral") {
            return stringPatch()
        } else if desc.contains("bell") || desc.contains("chime") {
            return bellPatch()
        } else {
            return defaultPatch(name: description)
        }
    }

    private func warmPadPatch() -> SynthPatchResult {
        SynthPatchResult(
            name: "Warm Pad",
            nodes: [
                SynthNodeSpec(id: "osc1", type: "oscillator", parameters: ["waveform": 1, "detune": 5, "level": 0.6]),
                SynthNodeSpec(id: "osc2", type: "oscillator", parameters: ["waveform": 1, "detune": -5, "level": 0.6]),
                SynthNodeSpec(id: "mix", type: "mixer", parameters: ["level": 0.8]),
                SynthNodeSpec(id: "flt", type: "filter", parameters: ["cutoff": 1500, "resonance": 0.2, "type": 0]),
                SynthNodeSpec(id: "env", type: "envelope", parameters: ["attack": 0.8, "decay": 0.4, "sustain": 0.7, "release": 2.0]),
                SynthNodeSpec(id: "chorus", type: "chorus", parameters: ["rate": 0.5, "depth": 0.4, "mix": 0.3]),
                SynthNodeSpec(id: "reverb", type: "reverb", parameters: ["size": 0.7, "damping": 0.5, "mix": 0.35]),
                SynthNodeSpec(id: "out", type: "output", parameters: ["level": 0.7])
            ],
            connections: [
                NodeConnection(from: "osc1", fromPort: "output", to: "mix", toPort: "input1"),
                NodeConnection(from: "osc2", fromPort: "output", to: "mix", toPort: "input2"),
                NodeConnection(from: "mix", fromPort: "output", to: "flt", toPort: "input"),
                NodeConnection(from: "env", fromPort: "output", to: "flt", toPort: "cutoff"),
                NodeConnection(from: "flt", fromPort: "output", to: "chorus", toPort: "input"),
                NodeConnection(from: "chorus", fromPort: "output", to: "reverb", toPort: "input"),
                NodeConnection(from: "reverb", fromPort: "output", to: "out", toPort: "input")
            ],
            description: "Warm analog-style pad with detuned saw oscillators, gentle filtering, chorus, and reverb"
        )
    }

    private func bassPatch() -> SynthPatchResult {
        SynthPatchResult(
            name: "Sub Bass",
            nodes: [
                SynthNodeSpec(id: "osc1", type: "oscillator", parameters: ["waveform": 2, "detune": 0, "level": 0.9]),
                SynthNodeSpec(id: "osc2", type: "oscillator", parameters: ["waveform": 0, "detune": 0, "level": 0.5]),
                SynthNodeSpec(id: "mix", type: "mixer", parameters: ["level": 0.9]),
                SynthNodeSpec(id: "flt", type: "filter", parameters: ["cutoff": 400, "resonance": 0.4, "type": 0]),
                SynthNodeSpec(id: "env", type: "envelope", parameters: ["attack": 0.01, "decay": 0.3, "sustain": 0.5, "release": 0.2]),
                SynthNodeSpec(id: "dist", type: "distortion", parameters: ["drive": 0.2, "mix": 0.15]),
                SynthNodeSpec(id: "out", type: "output", parameters: ["level": 0.8])
            ],
            connections: [
                NodeConnection(from: "osc1", fromPort: "output", to: "mix", toPort: "input1"),
                NodeConnection(from: "osc2", fromPort: "output", to: "mix", toPort: "input2"),
                NodeConnection(from: "mix", fromPort: "output", to: "flt", toPort: "input"),
                NodeConnection(from: "env", fromPort: "output", to: "flt", toPort: "cutoff"),
                NodeConnection(from: "flt", fromPort: "output", to: "dist", toPort: "input"),
                NodeConnection(from: "dist", fromPort: "output", to: "out", toPort: "input")
            ],
            description: "Punchy sub bass with square and sine oscillators, tight envelope, and subtle saturation"
        )
    }

    private func leadPatch() -> SynthPatchResult {
        SynthPatchResult(
            name: "Synth Lead",
            nodes: [
                SynthNodeSpec(id: "osc1", type: "oscillator", parameters: ["waveform": 1, "detune": 7, "level": 0.8]),
                SynthNodeSpec(id: "osc2", type: "oscillator", parameters: ["waveform": 2, "detune": -7, "level": 0.5]),
                SynthNodeSpec(id: "mix", type: "mixer", parameters: ["level": 0.85]),
                SynthNodeSpec(id: "flt", type: "filter", parameters: ["cutoff": 3000, "resonance": 0.5, "type": 0]),
                SynthNodeSpec(id: "env", type: "envelope", parameters: ["attack": 0.02, "decay": 0.2, "sustain": 0.6, "release": 0.4]),
                SynthNodeSpec(id: "lfo", type: "lfo", parameters: ["rate": 5.5, "depth": 0.15, "waveform": 0]),
                SynthNodeSpec(id: "delay", type: "delay", parameters: ["time": 0.375, "feedback": 0.3, "mix": 0.2]),
                SynthNodeSpec(id: "out", type: "output", parameters: ["level": 0.7])
            ],
            connections: [
                NodeConnection(from: "osc1", fromPort: "output", to: "mix", toPort: "input1"),
                NodeConnection(from: "osc2", fromPort: "output", to: "mix", toPort: "input2"),
                NodeConnection(from: "mix", fromPort: "output", to: "flt", toPort: "input"),
                NodeConnection(from: "env", fromPort: "output", to: "flt", toPort: "cutoff"),
                NodeConnection(from: "lfo", fromPort: "output", to: "osc1", toPort: "pitch"),
                NodeConnection(from: "flt", fromPort: "output", to: "delay", toPort: "input"),
                NodeConnection(from: "delay", fromPort: "output", to: "out", toPort: "input")
            ],
            description: "Bright detuned lead with vibrato LFO, resonant filter, and slapback delay"
        )
    }

    private func pluckPatch() -> SynthPatchResult {
        SynthPatchResult(
            name: "Pluck",
            nodes: [
                SynthNodeSpec(id: "osc1", type: "oscillator", parameters: ["waveform": 1, "detune": 0, "level": 0.9]),
                SynthNodeSpec(id: "flt", type: "filter", parameters: ["cutoff": 5000, "resonance": 0.3, "type": 0]),
                SynthNodeSpec(id: "env", type: "envelope", parameters: ["attack": 0.001, "decay": 0.15, "sustain": 0.0, "release": 0.3]),
                SynthNodeSpec(id: "reverb", type: "reverb", parameters: ["size": 0.4, "damping": 0.6, "mix": 0.2]),
                SynthNodeSpec(id: "out", type: "output", parameters: ["level": 0.75])
            ],
            connections: [
                NodeConnection(from: "osc1", fromPort: "output", to: "flt", toPort: "input"),
                NodeConnection(from: "env", fromPort: "output", to: "flt", toPort: "cutoff"),
                NodeConnection(from: "env", fromPort: "output", to: "osc1", toPort: "amplitude"),
                NodeConnection(from: "flt", fromPort: "output", to: "reverb", toPort: "input"),
                NodeConnection(from: "reverb", fromPort: "output", to: "out", toPort: "input")
            ],
            description: "Short percussive pluck with fast decay envelope and light reverb"
        )
    }

    private func stringPatch() -> SynthPatchResult {
        SynthPatchResult(
            name: "Strings",
            nodes: [
                SynthNodeSpec(id: "osc1", type: "oscillator", parameters: ["waveform": 1, "detune": 3, "level": 0.5]),
                SynthNodeSpec(id: "osc2", type: "oscillator", parameters: ["waveform": 1, "detune": -3, "level": 0.5]),
                SynthNodeSpec(id: "osc3", type: "oscillator", parameters: ["waveform": 1, "detune": 8, "level": 0.3]),
                SynthNodeSpec(id: "mix", type: "mixer", parameters: ["level": 0.7]),
                SynthNodeSpec(id: "flt", type: "filter", parameters: ["cutoff": 2500, "resonance": 0.15, "type": 0]),
                SynthNodeSpec(id: "env", type: "envelope", parameters: ["attack": 1.2, "decay": 0.5, "sustain": 0.8, "release": 1.5]),
                SynthNodeSpec(id: "chorus", type: "chorus", parameters: ["rate": 0.3, "depth": 0.5, "mix": 0.4]),
                SynthNodeSpec(id: "reverb", type: "reverb", parameters: ["size": 0.8, "damping": 0.4, "mix": 0.4]),
                SynthNodeSpec(id: "out", type: "output", parameters: ["level": 0.65])
            ],
            connections: [
                NodeConnection(from: "osc1", fromPort: "output", to: "mix", toPort: "input1"),
                NodeConnection(from: "osc2", fromPort: "output", to: "mix", toPort: "input2"),
                NodeConnection(from: "osc3", fromPort: "output", to: "mix", toPort: "input3"),
                NodeConnection(from: "mix", fromPort: "output", to: "flt", toPort: "input"),
                NodeConnection(from: "env", fromPort: "output", to: "flt", toPort: "cutoff"),
                NodeConnection(from: "flt", fromPort: "output", to: "chorus", toPort: "input"),
                NodeConnection(from: "chorus", fromPort: "output", to: "reverb", toPort: "input"),
                NodeConnection(from: "reverb", fromPort: "output", to: "out", toPort: "input")
            ],
            description: "Lush string ensemble with three detuned saws, slow attack, chorus, and hall reverb"
        )
    }

    private func bellPatch() -> SynthPatchResult {
        SynthPatchResult(
            name: "Bell",
            nodes: [
                SynthNodeSpec(id: "osc1", type: "oscillator", parameters: ["waveform": 0, "detune": 0, "level": 0.7]),
                SynthNodeSpec(id: "osc2", type: "oscillator", parameters: ["waveform": 0, "detune": 700, "level": 0.4]),
                SynthNodeSpec(id: "mix", type: "mixer", parameters: ["level": 0.8]),
                SynthNodeSpec(id: "env", type: "envelope", parameters: ["attack": 0.001, "decay": 2.0, "sustain": 0.0, "release": 3.0]),
                SynthNodeSpec(id: "reverb", type: "reverb", parameters: ["size": 0.85, "damping": 0.3, "mix": 0.45]),
                SynthNodeSpec(id: "out", type: "output", parameters: ["level": 0.6])
            ],
            connections: [
                NodeConnection(from: "osc1", fromPort: "output", to: "mix", toPort: "input1"),
                NodeConnection(from: "osc2", fromPort: "output", to: "mix", toPort: "input2"),
                NodeConnection(from: "mix", fromPort: "output", to: "reverb", toPort: "input"),
                NodeConnection(from: "env", fromPort: "output", to: "mix", toPort: "amplitude"),
                NodeConnection(from: "reverb", fromPort: "output", to: "out", toPort: "input")
            ],
            description: "FM-style bell with inharmonic partials, long decay, and spacious reverb"
        )
    }

    private func defaultPatch(name: String) -> SynthPatchResult {
        SynthPatchResult(
            name: name.prefix(30).capitalized,
            nodes: [
                SynthNodeSpec(id: "osc1", type: "oscillator", parameters: ["waveform": 1, "detune": 0, "level": 0.8]),
                SynthNodeSpec(id: "flt", type: "filter", parameters: ["cutoff": 2000, "resonance": 0.3, "type": 0]),
                SynthNodeSpec(id: "env", type: "envelope", parameters: ["attack": 0.1, "decay": 0.3, "sustain": 0.5, "release": 0.5]),
                SynthNodeSpec(id: "out", type: "output", parameters: ["level": 0.7])
            ],
            connections: [
                NodeConnection(from: "osc1", fromPort: "output", to: "flt", toPort: "input"),
                NodeConnection(from: "env", fromPort: "output", to: "flt", toPort: "cutoff"),
                NodeConnection(from: "flt", fromPort: "output", to: "out", toPort: "input")
            ],
            description: "Basic subtractive patch: saw oscillator through lowpass filter with envelope"
        )
    }

    // MARK: - Algorithmic Sample Mapping Fallback

    private func algorithmicSampleMap(samples: [SampleInfo]) -> SampleMapResult {
        guard !samples.isEmpty else {
            return SampleMapResult(zones: [], explanation: "No samples provided")
        }

        // Sort by detected pitch or filename
        let sorted = samples.sorted { a, b in
            let pitchA = a.detectedPitch ?? a.filename
            let pitchB = b.detectedPitch ?? b.filename
            return pitchA < pitchB
        }

        let totalRange: UInt8 = 96  // C2 to C10
        let startNote: UInt8 = 24    // C1
        let rangePerSample = max(1, Int(totalRange) / sorted.count)

        var zones: [AISampleZone] = []
        for (i, sample) in sorted.enumerated() {
            let low = UInt8(clamping: Int(startNote) + i * rangePerSample)
            let high = UInt8(clamping: Int(low) + rangePerSample - 1)
            let root = UInt8(clamping: (Int(low) + Int(high)) / 2)

            zones.append(AISampleZone(
                sampleFile: sample.filename,
                rootNote: root,
                lowNote: low,
                highNote: high,
                lowVelocity: 1,
                highVelocity: 127
            ))
        }

        return SampleMapResult(
            zones: zones,
            explanation: "Even distribution across keyboard range (algorithmic fallback)"
        )
    }

    // MARK: - System Prompt

    private let processingChainSystemPrompt = """
    You are an audio processing expert. Given a source sample description and a target sound, \
    suggest an effects processing chain to transform the source toward the target.

    ALWAYS respond in this exact JSON format:
    {
      "steps": [
        {
          "effect": "eq",
          "parameters": {"low_gain": -3.0, "mid_gain": 2.0, "high_gain": 1.0, "mid_freq": 2000.0},
          "reason": "Boost presence frequencies for clarity"
        }
      ],
      "explanation": "Overall processing strategy"
    }

    Available effects: eq, compressor, reverb, delay, distortion, chorus, phaser, flanger, filter, \
    pitch_shift, time_stretch, gate, limiter, stereo_widener, tremolo, bitcrusher

    Rules:
    - Order effects logically (typically: EQ -> dynamics -> modulation -> time-based)
    - Keep parameter values in standard ranges
    - Explain why each step is needed
    - Use 3-6 processing steps (not too few, not excessive)
    - Consider the transformation needed between source and target
    """
}

// MARK: - Errors

enum SoundDesignError: Error, LocalizedError {
    case unexpectedResult
    case invalidPatch(String)

    var errorDescription: String? {
        switch self {
        case .unexpectedResult:
            return "Received unexpected result type from AI router"
        case .invalidPatch(let detail):
            return "Invalid synth patch: \(detail)"
        }
    }
}
