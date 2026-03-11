import Foundation

/// A GM-synth-based instrument preset created by the AI Instrument Factory.
/// Stored as individual JSON files in ~/Library/Application Support/MagicDAW/Instruments/.
struct InstrumentPreset: Codable, Identifiable, Sendable {
    let id: UUID
    var name: String
    var description: String
    var gmProgram: UInt8       // 0-127
    var bankMSB: UInt8         // 0x79 melodic, 0x78 percussion
    var attack: Float
    var decay: Float
    var sustain: Float
    var release: Float
    var filterCutoff: Float
    var filterResonance: Float
    var filterType: String     // "LP", "HP", "BP", "Notch"
    var createdAt: Date

    /// Create a preset from an AI-generated GM instrument result.
    init(from result: GMInstrumentResult) {
        self.id = UUID()
        self.name = result.name
        self.description = result.description
        self.gmProgram = result.gmProgram
        self.bankMSB = result.bankMSB
        self.attack = result.attack
        self.decay = result.decay
        self.sustain = result.sustain
        self.release = result.release
        self.filterCutoff = result.filterCutoff
        self.filterResonance = result.filterResonance
        self.filterType = result.filterType
        self.createdAt = Date()
    }
}
