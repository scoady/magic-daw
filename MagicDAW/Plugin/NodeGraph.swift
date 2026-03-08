import Foundation
import CoreGraphics

// MARK: - NodeGraphDefinition

struct NodeGraphDefinition: Codable {
    var nodes: [NodeDefinition]
    var connections: [ConnectionDefinition]
    var metadata: NodeGraphMetadata

    /// Create an empty graph with just an output node
    static func empty(name: String) -> NodeGraphDefinition {
        NodeGraphDefinition(
            nodes: [
                NodeDefinition(
                    id: "output",
                    type: "output",
                    parameters: [
                        ParameterDefinition(name: "gain", value: 1.0, min: 0.0, max: 1.0, unit: "", isExposed: false)
                    ],
                    position: CGPoint(x: 600, y: 200)
                )
            ],
            connections: [],
            metadata: NodeGraphMetadata(
                name: name,
                author: "",
                description: "",
                category: .instrument,
                version: "1.0"
            )
        )
    }

    // MARK: - Graph Queries

    /// Get a node by its ID
    func node(withId id: String) -> NodeDefinition? {
        nodes.first { $0.id == id }
    }

    /// Get all connections going into a specific node
    func incomingConnections(to nodeId: String) -> [ConnectionDefinition] {
        connections.filter { $0.toNode == nodeId }
    }

    /// Get all connections coming out of a specific node
    func outgoingConnections(from nodeId: String) -> [ConnectionDefinition] {
        connections.filter { $0.fromNode == nodeId }
    }

    /// Check whether a node has any incoming connections on a given port
    func isPortConnected(nodeId: String, port: String, isInput: Bool) -> Bool {
        if isInput {
            return connections.contains { $0.toNode == nodeId && $0.toPort == port }
        } else {
            return connections.contains { $0.fromNode == nodeId && $0.fromPort == port }
        }
    }

    /// All exposed parameters across all nodes, ordered by node then parameter
    var exposedParameters: [(nodeId: String, parameter: ParameterDefinition)] {
        nodes.flatMap { node in
            node.parameters
                .filter(\.isExposed)
                .map { (nodeId: node.id, parameter: $0) }
        }
    }

    /// Validate that the graph is well-formed
    func validate() -> [GraphValidationError] {
        var errors: [GraphValidationError] = []

        // Must have an output node
        if !nodes.contains(where: { $0.type == "output" }) {
            errors.append(.missingOutputNode)
        }

        // Check for duplicate IDs
        let ids = nodes.map(\.id)
        let duplicates = Dictionary(grouping: ids, by: { $0 }).filter { $1.count > 1 }.keys
        for dup in duplicates {
            errors.append(.duplicateNodeId(dup))
        }

        // Check connections reference valid nodes
        let nodeIds = Set(ids)
        for conn in connections {
            if !nodeIds.contains(conn.fromNode) {
                errors.append(.invalidConnection("Source node '\(conn.fromNode)' not found"))
            }
            if !nodeIds.contains(conn.toNode) {
                errors.append(.invalidConnection("Target node '\(conn.toNode)' not found"))
            }
        }

        // Check for cycles using DFS
        if hasCycles() {
            errors.append(.cyclicGraph)
        }

        return errors
    }

    /// Check for cycles via DFS
    private func hasCycles() -> Bool {
        var visited = Set<String>()
        var inStack = Set<String>()

        func dfs(_ nodeId: String) -> Bool {
            if inStack.contains(nodeId) { return true }
            if visited.contains(nodeId) { return false }
            visited.insert(nodeId)
            inStack.insert(nodeId)
            for conn in outgoingConnections(from: nodeId) {
                if dfs(conn.toNode) { return true }
            }
            inStack.remove(nodeId)
            return false
        }

        for node in nodes {
            if dfs(node.id) { return true }
        }
        return false
    }
}

// MARK: - GraphValidationError

enum GraphValidationError: CustomStringConvertible {
    case missingOutputNode
    case duplicateNodeId(String)
    case invalidConnection(String)
    case cyclicGraph
    case unconnectedNode(String)

    var description: String {
        switch self {
        case .missingOutputNode:
            return "Graph must have an output node"
        case .duplicateNodeId(let id):
            return "Duplicate node ID: \(id)"
        case .invalidConnection(let detail):
            return "Invalid connection: \(detail)"
        case .cyclicGraph:
            return "Graph contains a cycle — feedback loops are not supported"
        case .unconnectedNode(let id):
            return "Node '\(id)' has no connections"
        }
    }
}

// MARK: - NodeDefinition

struct NodeDefinition: Codable, Identifiable {
    let id: String
    var type: String       // matches DSPNodeTemplate.type
    var parameters: [ParameterDefinition]
    var position: CGPoint  // for UI layout in the node editor

    enum CodingKeys: String, CodingKey {
        case id, type, parameters, positionX, positionY
    }

    init(id: String, type: String, parameters: [ParameterDefinition], position: CGPoint) {
        self.id = id
        self.type = type
        self.parameters = parameters
        self.position = position
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        type = try container.decode(String.self, forKey: .type)
        parameters = try container.decode([ParameterDefinition].self, forKey: .parameters)
        let x = try container.decode(Double.self, forKey: .positionX)
        let y = try container.decode(Double.self, forKey: .positionY)
        position = CGPoint(x: x, y: y)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(parameters, forKey: .parameters)
        try container.encode(position.x, forKey: .positionX)
        try container.encode(position.y, forKey: .positionY)
    }

    /// Get a parameter value by name
    func parameterValue(_ name: String) -> Double? {
        parameters.first { $0.name == name }?.value
    }

    /// Set a parameter value by name
    mutating func setParameter(_ name: String, value: Double) {
        if let index = parameters.firstIndex(where: { $0.name == name }) {
            parameters[index].value = max(parameters[index].min, min(parameters[index].max, value))
        }
    }
}

// MARK: - ParameterDefinition

struct ParameterDefinition: Codable, Hashable {
    let name: String
    var value: Double
    var min: Double
    var max: Double
    var unit: String       // "Hz", "dB", "%", "ms", "cents", ""
    var isExposed: Bool    // if true, becomes a user-facing plugin parameter

    init(name: String, value: Double, min: Double, max: Double, unit: String, isExposed: Bool = false) {
        self.name = name
        self.value = value
        self.min = min
        self.max = max
        self.unit = unit
        self.isExposed = isExposed
    }

    /// Normalize the current value to 0.0-1.0 range
    var normalizedValue: Double {
        guard max > min else { return 0 }
        return (value - min) / (max - min)
    }

    /// Set value from a normalized 0.0-1.0 input
    mutating func setNormalized(_ normalized: Double) {
        value = min + (max - min) * Swift.max(0, Swift.min(1, normalized))
    }
}

// MARK: - ConnectionDefinition

struct ConnectionDefinition: Codable, Hashable, Identifiable {
    var id: String { "\(fromNode).\(fromPort)->\(toNode).\(toPort)" }

    let fromNode: String
    let fromPort: String
    let toNode: String
    let toPort: String
}

// MARK: - NodeGraphMetadata

struct NodeGraphMetadata: Codable {
    var name: String
    var author: String
    var description: String
    var category: PluginCategory
    var version: String
}

// MARK: - PluginCategory

enum PluginCategory: String, Codable, Sendable {
    case instrument
    case effect

    var displayName: String {
        switch self {
        case .instrument: return "Instrument"
        case .effect: return "Effect"
        }
    }

    var subcategories: [String] {
        switch self {
        case .instrument:
            return ["Synth", "Sampler", "Drum Machine", "Bass", "Pad", "Lead", "Keys"]
        case .effect:
            return ["EQ", "Dynamics", "Reverb", "Delay", "Modulation", "Distortion", "Utility"]
        }
    }

    /// The AUv3 component type FourCC
    var auComponentType: String {
        switch self {
        case .instrument: return "aumu"
        case .effect: return "aufx"
        }
    }
}
