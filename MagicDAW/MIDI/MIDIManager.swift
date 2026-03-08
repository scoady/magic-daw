import CoreMIDI
import Foundation
import Observation

@Observable
class MIDIManager {
    private var client: MIDIClientRef = 0
    private var inputPort: MIDIPortRef = 0
    private var outputPort: MIDIPortRef = 0

    var availableSources: [MIDIDeviceInfo] = []
    var availableDestinations: [MIDIDeviceInfo] = []
    var connectedSource: MIDIDeviceInfo?
    var isReceiving = false

    // Callbacks for received MIDI messages
    var onNoteOn: ((UInt8, UInt8, UInt8) -> Void)?       // note, velocity, channel
    var onNoteOff: ((UInt8, UInt8) -> Void)?              // note, channel
    var onControlChange: ((UInt8, UInt8, UInt8) -> Void)? // cc, value, channel
    var onPitchBend: ((UInt16, UInt8) -> Void)?           // value, channel

    init() {}

    // MARK: - Setup

    func setup() throws {
        // Create MIDI client with notification callback for hot-plug
        let clientName = "MagicDAW" as CFString
        let status = MIDIClientCreateWithBlock(clientName, &client) { [weak self] notification in
            self?.handleMIDINotification(notification)
        }

        guard status == noErr else {
            throw MIDIManagerError.clientCreationFailed(status)
        }

        // Create input port using the modern EventList-based API (macOS 11+)
        let inputPortName = "MagicDAW Input" as CFString
        let inputStatus = MIDIInputPortCreateWithProtocol(
            client,
            inputPortName,
            ._1_0,
            &inputPort
        ) { [weak self] eventList, srcConnRefCon in
            self?.handleMIDIEventList(eventList)
        }

        guard inputStatus == noErr else {
            throw MIDIManagerError.inputPortCreationFailed(inputStatus)
        }

        // Create output port
        let outputPortName = "MagicDAW Output" as CFString
        let outputStatus = MIDIOutputPortCreate(client, outputPortName, &outputPort)

        guard outputStatus == noErr else {
            throw MIDIManagerError.outputPortCreationFailed(outputStatus)
        }

        scanDevices()
    }

    // MARK: - Device Scanning

    func scanDevices() {
        var sources: [MIDIDeviceInfo] = []
        var destinations: [MIDIDeviceInfo] = []

        // Enumerate sources (inputs we can read from)
        let sourceCount = MIDIGetNumberOfSources()
        for i in 0..<sourceCount {
            let endpoint = MIDIGetSource(i)
            let name = Self.endpointName(endpoint) ?? "Source \(i)"
            sources.append(MIDIDeviceInfo(
                id: Int(endpoint),
                name: name,
                endpoint: endpoint,
                isSource: true
            ))
        }

        // Enumerate destinations (outputs we can send to)
        let destCount = MIDIGetNumberOfDestinations()
        for i in 0..<destCount {
            let endpoint = MIDIGetDestination(i)
            let name = Self.endpointName(endpoint) ?? "Destination \(i)"
            destinations.append(MIDIDeviceInfo(
                id: Int(endpoint),
                name: name,
                endpoint: endpoint,
                isSource: false
            ))
        }

        availableSources = sources
        availableDestinations = destinations
    }

    // MARK: - Connection

    func connect(to source: MIDIDeviceInfo) throws {
        guard source.isSource else {
            throw MIDIManagerError.notASource
        }

        // Disconnect existing source first
        disconnect()

        let status = MIDIPortConnectSource(inputPort, source.endpoint, nil)
        guard status == noErr else {
            throw MIDIManagerError.connectionFailed(status)
        }

        connectedSource = source
        isReceiving = true
    }

    func disconnect() {
        if let source = connectedSource {
            MIDIPortDisconnectSource(inputPort, source.endpoint)
        }
        connectedSource = nil
        isReceiving = false
    }

    // MARK: - Sending MIDI

    func sendNoteOn(note: UInt8, velocity: UInt8, channel: UInt8, to dest: MIDIDeviceInfo) {
        let statusByte: UInt8 = 0x90 | (channel & 0x0F)
        sendBytes([statusByte, note & 0x7F, velocity & 0x7F], to: dest)
    }

    func sendNoteOff(note: UInt8, channel: UInt8, to dest: MIDIDeviceInfo) {
        let statusByte: UInt8 = 0x80 | (channel & 0x0F)
        sendBytes([statusByte, note & 0x7F, 0], to: dest)
    }

    func sendControlChange(controller: UInt8, value: UInt8, channel: UInt8, to dest: MIDIDeviceInfo) {
        let statusByte: UInt8 = 0xB0 | (channel & 0x0F)
        sendBytes([statusByte, controller & 0x7F, value & 0x7F], to: dest)
    }

    func sendPitchBend(value: UInt16, channel: UInt8, to dest: MIDIDeviceInfo) {
        let statusByte: UInt8 = 0xE0 | (channel & 0x0F)
        let lsb = UInt8(value & 0x7F)
        let msb = UInt8((value >> 7) & 0x7F)
        sendBytes([statusByte, lsb, msb], to: dest)
    }

    // MARK: - Shutdown

    func shutdown() {
        disconnect()

        if inputPort != 0 {
            MIDIPortDispose(inputPort)
            inputPort = 0
        }
        if outputPort != 0 {
            MIDIPortDispose(outputPort)
            outputPort = 0
        }
        if client != 0 {
            MIDIClientDispose(client)
            client = 0
        }

        availableSources.removeAll()
        availableDestinations.removeAll()
    }

    // MARK: - Private — Receiving

    private func handleMIDIEventList(_ eventListPtr: UnsafePointer<MIDIEventList>) {
        let eventList = eventListPtr.pointee
        var packet = eventList.packet

        for _ in 0..<eventList.numPackets {
            let messages = MIDIParser.fromEventPacket(packet)
            for message in messages {
                dispatchMessage(message)
            }
            var packetCopy = packet
            withUnsafePointer(to: &packetCopy) { ptr in
                packet = MIDIEventPacketNext(ptr).pointee
            }
        }
    }

    private func dispatchMessage(_ message: MIDIMessage) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            switch message {
            case .noteOn(let note, let velocity, let channel):
                if velocity == 0 {
                    // Note-on with velocity 0 is equivalent to note-off
                    self.onNoteOff?(note, channel)
                } else {
                    self.onNoteOn?(note, velocity, channel)
                }
            case .noteOff(let note, _, let channel):
                self.onNoteOff?(note, channel)
            case .controlChange(let cc, let value, let channel):
                self.onControlChange?(cc, value, channel)
            case .pitchBend(let value, let channel):
                self.onPitchBend?(value, channel)
            default:
                break
            }
        }
    }

    // MARK: - Private — Sending

    private func sendBytes(_ bytes: [UInt8], to dest: MIDIDeviceInfo) {
        // Build a MIDIEventList with a single UMP (Universal MIDI Packet)
        // For MIDI 1.0 protocol messages, we pack into 32-bit UMP words
        let messageType: UInt32 = 0x2  // MIDI 1.0 channel voice
        let group: UInt32 = 0
        var word: UInt32 = (messageType << 28) | (group << 24)

        if bytes.count >= 1 { word |= UInt32(bytes[0]) << 16 }
        if bytes.count >= 2 { word |= UInt32(bytes[1]) << 8 }
        if bytes.count >= 3 { word |= UInt32(bytes[2]) }

        var eventList = MIDIEventList()
        var packet = MIDIEventListInit(&eventList, ._1_0)

        withUnsafePointer(to: word) { wordPtr in
            packet = MIDIEventListAdd(&eventList, MemoryLayout<MIDIEventList>.size, packet, 0, 1, wordPtr)
        }

        MIDISendEventList(outputPort, dest.endpoint, &eventList)
    }

    // MARK: - Private — Notifications

    private func handleMIDINotification(_ notification: UnsafePointer<MIDINotification>) {
        let messageID = notification.pointee.messageID

        switch messageID {
        case .msgObjectAdded, .msgObjectRemoved, .msgSetupChanged:
            DispatchQueue.main.async { [weak self] in
                self?.scanDevices()
            }
        default:
            break
        }
    }

    // MARK: - Helpers

    private static func endpointName(_ endpoint: MIDIEndpointRef) -> String? {
        var name: Unmanaged<CFString>?
        let status = MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &name)
        if status == noErr, let cfName = name?.takeRetainedValue() {
            return cfName as String
        }
        // Fallback to regular name property
        let status2 = MIDIObjectGetStringProperty(endpoint, kMIDIPropertyName, &name)
        if status2 == noErr, let cfName = name?.takeRetainedValue() {
            return cfName as String
        }
        return nil
    }
}

// MARK: - MIDIDeviceInfo

struct MIDIDeviceInfo: Identifiable, Hashable {
    let id: Int
    let name: String
    let endpoint: MIDIEndpointRef
    let isSource: Bool

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
        hasher.combine(isSource)
    }

    static func == (lhs: MIDIDeviceInfo, rhs: MIDIDeviceInfo) -> Bool {
        lhs.id == rhs.id && lhs.isSource == rhs.isSource
    }
}

// MARK: - Errors

enum MIDIManagerError: Error, LocalizedError {
    case clientCreationFailed(OSStatus)
    case inputPortCreationFailed(OSStatus)
    case outputPortCreationFailed(OSStatus)
    case connectionFailed(OSStatus)
    case notASource

    var errorDescription: String? {
        switch self {
        case .clientCreationFailed(let status):
            return "Failed to create MIDI client (OSStatus: \(status))"
        case .inputPortCreationFailed(let status):
            return "Failed to create MIDI input port (OSStatus: \(status))"
        case .outputPortCreationFailed(let status):
            return "Failed to create MIDI output port (OSStatus: \(status))"
        case .connectionFailed(let status):
            return "Failed to connect to MIDI source (OSStatus: \(status))"
        case .notASource:
            return "Attempted to connect to a destination endpoint as a source"
        }
    }
}
