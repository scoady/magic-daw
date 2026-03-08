import Foundation

/// Routes MIDI messages between sources, the internal audio engine, and output destinations.
/// Supports channel filtering, note range filtering, transposition, and velocity curves.
final class MIDIRouter: @unchecked Sendable {

    /// A routing rule that transforms and filters MIDI messages.
    struct Route: Identifiable, Sendable {
        let id: UUID
        let name: String
        let sourceFilter: SourceFilter
        let channelFilter: ChannelFilter
        let noteRange: ClosedRange<UInt8>
        let transpose: Int
        let velocityCurve: VelocityCurve
        let destination: Destination

        init(
            name: String = "Route",
            sourceFilter: SourceFilter = .all,
            channelFilter: ChannelFilter = .all,
            noteRange: ClosedRange<UInt8> = 0...127,
            transpose: Int = 0,
            velocityCurve: VelocityCurve = .linear,
            destination: Destination
        ) {
            self.id = UUID()
            self.name = name
            self.sourceFilter = sourceFilter
            self.channelFilter = channelFilter
            self.noteRange = noteRange
            self.transpose = transpose
            self.velocityCurve = velocityCurve
            self.destination = destination
        }
    }

    enum SourceFilter: Sendable {
        case all
        case sourceIndex(Int)
    }

    enum ChannelFilter: Sendable {
        case all
        case channel(UInt8)
        case channels(Set<UInt8>)
    }

    enum VelocityCurve: Sendable {
        case linear
        case soft       // logarithmic — emphasizes low velocities
        case hard       // exponential — emphasizes high velocities
        case fixed(UInt8)
    }

    enum Destination: Sendable {
        case internalEngine
        case midiOutput(Int)  // destination index
        case callback((MIDIMessage) -> Void)

        // Sendable conformance for callback requires nonisolated(unsafe)
        static func == (lhs: Destination, rhs: Destination) -> Bool { false }
    }

    private var routes: [Route] = []
    private let lock = NSLock()

    /// Callback to send MIDI to the internal audio engine.
    var onRouteToEngine: ((MIDIMessage) -> Void)?

    /// Callback to send MIDI to a physical output.
    var onRouteToOutput: ((MIDIMessage, Int) -> Void)?

    // MARK: - Route Management

    func addRoute(_ route: Route) {
        lock.lock()
        defer { lock.unlock() }
        routes.append(route)
    }

    func removeRoute(id: UUID) {
        lock.lock()
        defer { lock.unlock() }
        routes.removeAll { $0.id == id }
    }

    func clearRoutes() {
        lock.lock()
        defer { lock.unlock() }
        routes.removeAll()
    }

    func allRoutes() -> [Route] {
        lock.lock()
        defer { lock.unlock() }
        return routes
    }

    /// Set up default routing: all input -> internal engine.
    func setupDefaultRoutes() {
        clearRoutes()
        addRoute(Route(
            name: "All Input → Engine",
            destination: .internalEngine
        ))
    }

    // MARK: - Message Processing

    /// Route an incoming MIDI message through all matching routes.
    func route(message: MIDIMessage, fromSourceIndex: Int = -1) {
        lock.lock()
        let currentRoutes = routes
        lock.unlock()

        for route in currentRoutes {
            // Check source filter
            switch route.sourceFilter {
            case .all:
                break
            case .sourceIndex(let index):
                if fromSourceIndex != index { continue }
            }

            // Check channel filter
            switch route.channelFilter {
            case .all:
                break
            case .channel(let ch):
                if message.channel != ch { continue }
            case .channels(let chs):
                if !chs.contains(message.channel) { continue }
            }

            // Check note range (only for note messages)
            if message.type == .noteOn || message.type == .noteOff {
                if !route.noteRange.contains(message.data1) { continue }
            }

            // Apply transformations
            let transformed = applyTransformations(message: message, route: route)

            // Deliver to destination
            switch route.destination {
            case .internalEngine:
                onRouteToEngine?(transformed)

            case .midiOutput(let index):
                onRouteToOutput?(transformed, index)

            case .callback(let callback):
                callback(transformed)
            }
        }
    }

    // MARK: - Transformations

    private func applyTransformations(message: MIDIMessage, route: Route) -> MIDIMessage {
        var data1 = message.data1
        var data2 = message.data2

        // Transpose (only for note messages)
        if message.type == .noteOn || message.type == .noteOff {
            let transposed = Int(data1) + route.transpose
            data1 = UInt8(max(0, min(127, transposed)))

            // Apply velocity curve (only for note on)
            if message.type == .noteOn {
                data2 = applyVelocityCurve(velocity: data2, curve: route.velocityCurve)
            }
        }

        return MIDIMessage(
            type: message.type,
            channel: message.channel,
            data1: data1,
            data2: data2,
            timestamp: message.timestamp
        )
    }

    private func applyVelocityCurve(velocity: UInt8, curve: VelocityCurve) -> UInt8 {
        let v = Double(velocity) / 127.0

        let result: Double
        switch curve {
        case .linear:
            result = v
        case .soft:
            // Logarithmic — boosts low velocities
            result = log2(1.0 + v)
        case .hard:
            // Exponential — reduces low velocities
            result = v * v
        case .fixed(let value):
            return value
        }

        return UInt8(max(1, min(127, Int(result * 127.0))))
    }
}
