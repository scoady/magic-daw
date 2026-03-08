import CoreMIDI
import Foundation

/// Parsed MIDI message types.
enum MIDIMessage {
    case noteOn(note: UInt8, velocity: UInt8, channel: UInt8)
    case noteOff(note: UInt8, velocity: UInt8, channel: UInt8)
    case controlChange(controller: UInt8, value: UInt8, channel: UInt8)
    case pitchBend(value: UInt16, channel: UInt8)
    case programChange(program: UInt8, channel: UInt8)
    case aftertouch(pressure: UInt8, channel: UInt8)
    case polyAftertouch(note: UInt8, pressure: UInt8, channel: UInt8)

    // MARK: - Parse from raw bytes

    /// Parse a stream of MIDI bytes into messages, handling running status.
    static func parse(bytes: [UInt8]) -> [MIDIMessage] {
        var messages: [MIDIMessage] = []
        var i = 0
        var runningStatus: UInt8 = 0

        while i < bytes.count {
            var statusByte: UInt8

            // Real-time messages (single byte, can appear anywhere in the stream)
            if bytes[i] >= 0xF8 {
                // Skip real-time messages (clock, start, stop, continue, etc.)
                i += 1
                continue
            }

            // System common messages (0xF0-0xF7) clear running status
            if bytes[i] >= 0xF0 && bytes[i] <= 0xF7 {
                runningStatus = 0
                switch bytes[i] {
                case 0xF0: // SysEx start — skip until 0xF7
                    i += 1
                    while i < bytes.count && bytes[i] != 0xF7 { i += 1 }
                    if i < bytes.count { i += 1 } // skip 0xF7
                case 0xF1, 0xF3: // MTC quarter frame, song select — 1 data byte
                    i += 2
                case 0xF2: // Song position — 2 data bytes
                    i += 3
                default: // F4-F7 — no data bytes
                    i += 1
                }
                continue
            }

            if bytes[i] & 0x80 != 0 {
                // This is a status byte
                statusByte = bytes[i]
                runningStatus = statusByte
                i += 1
            } else {
                // Running status — reuse previous status byte
                statusByte = runningStatus
            }

            guard statusByte & 0x80 != 0 else {
                // No valid status, skip this data byte
                i += 1
                continue
            }

            let channel = statusByte & 0x0F
            let messageType = statusByte & 0xF0

            switch messageType {
            case 0x80: // Note Off
                guard i + 1 < bytes.count else { i = bytes.count; break }
                let note = bytes[i] & 0x7F
                let velocity = bytes[i + 1] & 0x7F
                messages.append(.noteOff(note: note, velocity: velocity, channel: channel))
                i += 2

            case 0x90: // Note On
                guard i + 1 < bytes.count else { i = bytes.count; break }
                let note = bytes[i] & 0x7F
                let velocity = bytes[i + 1] & 0x7F
                // Note-on with velocity 0 is treated as note-off at the dispatch level
                messages.append(.noteOn(note: note, velocity: velocity, channel: channel))
                i += 2

            case 0xA0: // Poly Aftertouch
                guard i + 1 < bytes.count else { i = bytes.count; break }
                let note = bytes[i] & 0x7F
                let pressure = bytes[i + 1] & 0x7F
                messages.append(.polyAftertouch(note: note, pressure: pressure, channel: channel))
                i += 2

            case 0xB0: // Control Change
                guard i + 1 < bytes.count else { i = bytes.count; break }
                let controller = bytes[i] & 0x7F
                let value = bytes[i + 1] & 0x7F
                messages.append(.controlChange(controller: controller, value: value, channel: channel))
                i += 2

            case 0xC0: // Program Change (1 data byte)
                guard i < bytes.count else { i = bytes.count; break }
                let program = bytes[i] & 0x7F
                messages.append(.programChange(program: program, channel: channel))
                i += 1

            case 0xD0: // Channel Aftertouch (1 data byte)
                guard i < bytes.count else { i = bytes.count; break }
                let pressure = bytes[i] & 0x7F
                messages.append(.aftertouch(pressure: pressure, channel: channel))
                i += 1

            case 0xE0: // Pitch Bend (2 data bytes, 14-bit value)
                guard i + 1 < bytes.count else { i = bytes.count; break }
                let lsb = UInt16(bytes[i] & 0x7F)
                let msb = UInt16(bytes[i + 1] & 0x7F)
                let value = (msb << 7) | lsb
                messages.append(.pitchBend(value: value, channel: channel))
                i += 2

            default:
                i += 1 // Unknown — skip
            }
        }

        return messages
    }

    // MARK: - Parse from MIDIEventPacket (UMP)

    /// Parse a MIDIEventPacket (MIDI 2.0 UMP format) into MIDI messages.
    static func fromEventPacket(_ packet: MIDIEventPacket) -> [MIDIMessage] {
        var messages: [MIDIMessage] = []

        let wordCount = Int(packet.wordCount)
        guard wordCount > 0 else { return messages }

        // Access the packet's words tuple via withUnsafePointer
        withUnsafePointer(to: packet.words) { wordsPtr in
            let words = UnsafeRawPointer(wordsPtr).assumingMemoryBound(to: UInt32.self)

            var wordIndex = 0
            while wordIndex < wordCount {
                let word = words[wordIndex]
                let messageType = (word >> 28) & 0xF

                switch messageType {
                case 0x2:
                    // MIDI 1.0 channel voice message (32-bit, single word)
                    let statusByte = UInt8((word >> 16) & 0xFF)
                    let data1 = UInt8((word >> 8) & 0x7F)
                    let data2 = UInt8(word & 0x7F)
                    let channel = statusByte & 0x0F

                    switch statusByte & 0xF0 {
                    case 0x80:
                        messages.append(.noteOff(note: data1, velocity: data2, channel: channel))
                    case 0x90:
                        messages.append(.noteOn(note: data1, velocity: data2, channel: channel))
                    case 0xA0:
                        messages.append(.polyAftertouch(note: data1, pressure: data2, channel: channel))
                    case 0xB0:
                        messages.append(.controlChange(controller: data1, value: data2, channel: channel))
                    case 0xC0:
                        messages.append(.programChange(program: data1, channel: channel))
                    case 0xD0:
                        messages.append(.aftertouch(pressure: data1, channel: channel))
                    case 0xE0:
                        let lsb = UInt16(data1)
                        let msb = UInt16(data2)
                        messages.append(.pitchBend(value: (msb << 7) | lsb, channel: channel))
                    default:
                        break
                    }
                    wordIndex += 1

                case 0x4:
                    // MIDI 2.0 channel voice message (64-bit, two words)
                    if wordIndex + 1 < wordCount {
                        let statusByte = UInt8((word >> 16) & 0xFF)
                        let channel = statusByte & 0x0F
                        let word2 = words[wordIndex + 1]

                        switch statusByte & 0xF0 {
                        case 0x80:
                            let note = UInt8((word >> 8) & 0x7F)
                            // MIDI 2.0 velocity is 16-bit in word2[31:16], scale to 7-bit
                            let velocity = UInt8((word2 >> 25) & 0x7F)
                            messages.append(.noteOff(note: note, velocity: velocity, channel: channel))
                        case 0x90:
                            let note = UInt8((word >> 8) & 0x7F)
                            let velocity = UInt8((word2 >> 25) & 0x7F)
                            messages.append(.noteOn(note: note, velocity: velocity, channel: channel))
                        case 0xB0:
                            let controller = UInt8((word >> 8) & 0x7F)
                            // MIDI 2.0 CC value is 32-bit in word2, scale to 7-bit
                            let value = UInt8((word2 >> 25) & 0x7F)
                            messages.append(.controlChange(controller: controller, value: value, channel: channel))
                        case 0xE0:
                            // MIDI 2.0 pitch bend is 32-bit in word2, scale to 14-bit
                            let value = UInt16((word2 >> 18) & 0x3FFF)
                            messages.append(.pitchBend(value: value, channel: channel))
                        default:
                            break
                        }
                        wordIndex += 2
                    } else {
                        wordIndex += 1
                    }

                default:
                    // Unknown or utility message type — advance by 1
                    wordIndex += 1
                }
            }
        }

        return messages
    }

    // MARK: - Serialize to bytes

    /// Convert this MIDI message back to raw MIDI 1.0 bytes.
    var bytes: [UInt8] {
        switch self {
        case .noteOn(let note, let velocity, let channel):
            return [0x90 | (channel & 0x0F), note & 0x7F, velocity & 0x7F]
        case .noteOff(let note, let velocity, let channel):
            return [0x80 | (channel & 0x0F), note & 0x7F, velocity & 0x7F]
        case .controlChange(let controller, let value, let channel):
            return [0xB0 | (channel & 0x0F), controller & 0x7F, value & 0x7F]
        case .pitchBend(let value, let channel):
            let lsb = UInt8(value & 0x7F)
            let msb = UInt8((value >> 7) & 0x7F)
            return [0xE0 | (channel & 0x0F), lsb, msb]
        case .programChange(let program, let channel):
            return [0xC0 | (channel & 0x0F), program & 0x7F]
        case .aftertouch(let pressure, let channel):
            return [0xD0 | (channel & 0x0F), pressure & 0x7F]
        case .polyAftertouch(let note, let pressure, let channel):
            return [0xA0 | (channel & 0x0F), note & 0x7F, pressure & 0x7F]
        }
    }

    // MARK: - Utilities

    /// Standard MIDI CC controller names.
    static func ccName(for controller: UInt8) -> String {
        switch controller {
        case 0: return "Bank Select MSB"
        case 1: return "Modulation"
        case 2: return "Breath Controller"
        case 4: return "Foot Controller"
        case 5: return "Portamento Time"
        case 7: return "Volume"
        case 8: return "Balance"
        case 10: return "Pan"
        case 11: return "Expression"
        case 32: return "Bank Select LSB"
        case 64: return "Sustain Pedal"
        case 65: return "Portamento"
        case 66: return "Sostenuto"
        case 67: return "Soft Pedal"
        case 68: return "Legato"
        case 71: return "Resonance"
        case 72: return "Release Time"
        case 73: return "Attack Time"
        case 74: return "Cutoff"
        case 91: return "Reverb"
        case 93: return "Chorus"
        case 120: return "All Sound Off"
        case 121: return "Reset All Controllers"
        case 123: return "All Notes Off"
        default: return "CC \(controller)"
        }
    }

    /// Convert pitch bend value (0-16383) to normalized float (-1.0 to 1.0).
    static func pitchBendNormalized(_ value: UInt16) -> Double {
        (Double(value) - 8192.0) / 8192.0
    }

    /// Note name from MIDI note number (e.g., 60 -> "C4").
    static func noteName(_ note: UInt8) -> String {
        let names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        let octave = Int(note) / 12 - 1
        let name = names[Int(note) % 12]
        return "\(name)\(octave)"
    }
}

// MARK: - MIDIParser (namespace for static helpers used by MIDIManager)

enum MIDIParser {
    /// Parse a MIDIEventPacket into MIDIMessage values. Delegates to MIDIMessage.fromEventPacket.
    static func fromEventPacket(_ packet: MIDIEventPacket) -> [MIDIMessage] {
        MIDIMessage.fromEventPacket(packet)
    }

    /// Parse raw MIDI bytes. Delegates to MIDIMessage.parse.
    static func parse(bytes: [UInt8]) -> [MIDIMessage] {
        MIDIMessage.parse(bytes: bytes)
    }
}
