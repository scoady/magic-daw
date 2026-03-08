import Foundation

// MARK: - Models

struct OllamaModel: Codable, Sendable {
    let name: String
    let size: Int64
    let modifiedAt: String

    enum CodingKeys: String, CodingKey {
        case name, size
        case modifiedAt = "modified_at"
    }
}

struct ChatMessage: Codable, Sendable {
    let role: String   // "system", "user", "assistant"
    let content: String

    static func system(_ content: String) -> ChatMessage {
        ChatMessage(role: "system", content: content)
    }
    static func user(_ content: String) -> ChatMessage {
        ChatMessage(role: "user", content: content)
    }
    static func assistant(_ content: String) -> ChatMessage {
        ChatMessage(role: "assistant", content: content)
    }
}

enum ResponseFormat: Sendable {
    case text
    case json
}

// MARK: - Errors

enum OllamaError: Error, LocalizedError {
    case serverUnavailable
    case modelNotFound(String)
    case timeout
    case invalidResponse
    case decodingFailed(String)
    case httpError(Int, String)

    var errorDescription: String? {
        switch self {
        case .serverUnavailable:
            return "Ollama server is not reachable. Check that Ollama is running at the configured endpoint."
        case .modelNotFound(let model):
            return "Model '\(model)' is not available on the Ollama server."
        case .timeout:
            return "Request to Ollama timed out."
        case .invalidResponse:
            return "Received an invalid response from Ollama."
        case .decodingFailed(let detail):
            return "Failed to decode Ollama response: \(detail)"
        case .httpError(let code, let message):
            return "Ollama HTTP error \(code): \(message)"
        }
    }
}

// MARK: - Internal Response Types

private struct OllamaGenerateRequest: Encodable {
    let model: String
    let prompt: String
    let system: String?
    let stream: Bool
    let format: String?
    let options: OllamaOptions?
}

private struct OllamaOptions: Encodable {
    let temperature: Double?
}

private struct OllamaChatRequest: Encodable {
    let model: String
    let messages: [ChatMessage]
    let stream: Bool
    let format: String?
    let options: OllamaOptions?
}

private struct OllamaGenerateResponse: Decodable {
    let model: String?
    let response: String
    let done: Bool
}

private struct OllamaChatResponse: Decodable {
    let model: String?
    let message: ChatMessage?
    let done: Bool
}

private struct OllamaTagsResponse: Decodable {
    let models: [OllamaModel]
}

// MARK: - Client

/// Async HTTP client for the Ollama REST API.
/// Thread-safe via actor isolation.
actor OllamaClient {
    let baseURL: URL
    private let session: URLSession
    private let streamSession: URLSession
    private(set) var isAvailable: Bool = false

    /// Create a client pointed at the given Ollama instance.
    init(baseURL: URL = URL(string: "http://DESKTOP-D4U6J5M:11434")!) {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 120
        self.baseURL = baseURL
        self.session = URLSession(configuration: config)

        // Streaming needs a longer timeout for large generations
        let streamConfig = URLSessionConfiguration.default
        streamConfig.timeoutIntervalForRequest = 300
        streamConfig.timeoutIntervalForResource = 600
        self.streamSession = URLSession(configuration: streamConfig)
    }

    // MARK: - Health Check

    /// Check if the Ollama server is reachable.
    func checkAvailability() async -> Bool {
        var request = URLRequest(url: baseURL)
        request.httpMethod = "GET"
        request.timeoutInterval = 5

        do {
            let (_, response) = try await session.data(for: request)
            if let http = response as? HTTPURLResponse {
                isAvailable = (200..<300).contains(http.statusCode)
            } else {
                isAvailable = false
            }
        } catch {
            isAvailable = false
        }
        return isAvailable
    }

    // MARK: - List Models

    /// Fetch the list of models available on the server.
    func listModels() async throws -> [OllamaModel] {
        let url = baseURL.appendingPathComponent("api/tags")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        let (data, response) = try await performRequest(request)
        try validateHTTPResponse(response, data: data)

        do {
            let tagsResponse = try JSONDecoder().decode(OllamaTagsResponse.self, from: data)
            return tagsResponse.models
        } catch {
            throw OllamaError.decodingFailed("Failed to decode model list: \(error.localizedDescription)")
        }
    }

    // MARK: - Generate (non-streaming)

    /// Generate a completion. Returns the full response text.
    func generate(
        model: String,
        prompt: String,
        system: String? = nil,
        temperature: Double = 0.7,
        format: ResponseFormat = .text
    ) async throws -> String {
        let url = baseURL.appendingPathComponent("api/generate")

        let body = OllamaGenerateRequest(
            model: model,
            prompt: prompt,
            system: system,
            stream: false,
            format: format == .json ? "json" : nil,
            options: OllamaOptions(temperature: temperature)
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        request.timeoutInterval = 120

        let (data, response) = try await performRequest(request)
        try validateHTTPResponse(response, data: data, model: model)

        do {
            let genResponse = try JSONDecoder().decode(OllamaGenerateResponse.self, from: data)
            return genResponse.response
        } catch {
            throw OllamaError.decodingFailed("Generate response: \(error.localizedDescription)")
        }
    }

    // MARK: - Generate with JSON decoding

    /// Generate a completion and decode the response as a specific type.
    /// Instructs Ollama to use JSON output format.
    func generateJSON<T: Decodable>(
        model: String,
        prompt: String,
        system: String? = nil,
        type: T.Type
    ) async throws -> T {
        let rawJSON = try await generate(
            model: model,
            prompt: prompt,
            system: system,
            temperature: 0.3, // lower temp for structured output
            format: .json
        )

        guard let jsonData = rawJSON.data(using: .utf8) else {
            throw OllamaError.decodingFailed("Response is not valid UTF-8")
        }

        do {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            return try decoder.decode(T.self, from: jsonData)
        } catch {
            throw OllamaError.decodingFailed(
                "Expected \(T.self) but got: \(rawJSON.prefix(500))... Error: \(error.localizedDescription)"
            )
        }
    }

    // MARK: - Chat

    /// Send a chat completion request. Returns the assistant's response text.
    func chat(
        model: String,
        messages: [ChatMessage],
        temperature: Double = 0.7,
        format: ResponseFormat = .text
    ) async throws -> String {
        let url = baseURL.appendingPathComponent("api/chat")

        let body = OllamaChatRequest(
            model: model,
            messages: messages,
            stream: false,
            format: format == .json ? "json" : nil,
            options: OllamaOptions(temperature: temperature)
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        request.timeoutInterval = 120

        let (data, response) = try await performRequest(request)
        try validateHTTPResponse(response, data: data, model: model)

        do {
            let chatResponse = try JSONDecoder().decode(OllamaChatResponse.self, from: data)
            return chatResponse.message?.content ?? ""
        } catch {
            throw OllamaError.decodingFailed("Chat response: \(error.localizedDescription)")
        }
    }

    // MARK: - Streaming Generate

    /// Generate a completion with streaming. Yields each token as it arrives.
    func generateStream(
        model: String,
        prompt: String,
        system: String? = nil
    ) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            Task { [weak streamSession] in
                guard let session = streamSession else {
                    continuation.finish(throwing: OllamaError.serverUnavailable)
                    return
                }

                let url = self.baseURL.appendingPathComponent("api/generate")
                let body = OllamaGenerateRequest(
                    model: model,
                    prompt: prompt,
                    system: system,
                    stream: true,
                    format: nil,
                    options: nil
                )

                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try? JSONEncoder().encode(body)
                request.timeoutInterval = 300

                do {
                    let (bytes, response) = try await session.bytes(for: request)

                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        if http.statusCode == 404 {
                            continuation.finish(throwing: OllamaError.modelNotFound(model))
                        } else {
                            continuation.finish(throwing: OllamaError.httpError(http.statusCode, "Stream request failed"))
                        }
                        return
                    }

                    for try await line in bytes.lines {
                        guard !line.isEmpty else { continue }
                        guard let lineData = line.data(using: .utf8) else { continue }

                        if let chunk = try? JSONDecoder().decode(OllamaGenerateResponse.self, from: lineData) {
                            if !chunk.response.isEmpty {
                                continuation.yield(chunk.response)
                            }
                            if chunk.done {
                                break
                            }
                        }
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch let error as URLError where error.code == .timedOut {
                    continuation.finish(throwing: OllamaError.timeout)
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    // MARK: - Private Helpers

    private func performRequest(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let error as URLError where error.code == .timedOut {
            throw OllamaError.timeout
        } catch let error as URLError where error.code == .cannotConnectToHost
            || error.code == .notConnectedToInternet
            || error.code == .networkConnectionLost {
            isAvailable = false
            throw OllamaError.serverUnavailable
        } catch {
            throw error
        }
    }

    private func validateHTTPResponse(_ response: URLResponse, data: Data, model: String? = nil) throws {
        guard let http = response as? HTTPURLResponse else {
            throw OllamaError.invalidResponse
        }

        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 404, let model = model {
                throw OllamaError.modelNotFound(model)
            }
            let body = String(data: data, encoding: .utf8) ?? "<binary>"
            throw OllamaError.httpError(http.statusCode, body)
        }

        isAvailable = true
    }
}
