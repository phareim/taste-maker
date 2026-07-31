import Foundation

/// The closed set of kinds, mirroring `KINDS` in `types/taste.ts` and the
/// CHECK constraint in the latest `taste_item` migration.
public let kinds = ["quote", "reference", "music", "art", "clothing"]

public enum TasteAPI {
    public static let baseURL = URL(string: "https://taste.phareim.no")!
}

/// Matches the JSON body `POST /api/ingest/capture` validates.
public struct CapturePayload: Codable, Equatable, Sendable {
    public var kind: String
    public var body: String
    public var title: String?
    public var sourceURL: String?
    public var creator: String?
    public var note: String?
    public var imageURL: String?

    public init(
        kind: String,
        body: String,
        title: String? = nil,
        sourceURL: String? = nil,
        creator: String? = nil,
        note: String? = nil,
        imageURL: String? = nil
    ) {
        self.kind = kind
        self.body = body
        self.title = title
        self.sourceURL = sourceURL
        self.creator = creator
        self.note = note
        self.imageURL = imageURL
    }

    enum CodingKeys: String, CodingKey {
        case kind, body, title, creator, note
        case sourceURL = "source_url"
        case imageURL = "image_url"
    }
}

public enum CaptureError: Error, Equatable {
    /// 401 — the key is wrong or has been rotated.
    case unauthorized
    /// 503 — the secret isn't set on the Worker at all.
    case notConfigured
    /// 400 — validation, e.g. an empty body.
    case badRequest
    /// 413 — the image is still over the cap after downscaling.
    case tooLarge
    case server(status: Int)
    case transport
}

private func mapStatus(_ status: Int) -> CaptureError? {
    switch status {
    case 200..<300: return nil
    case 400: return .badRequest
    case 401: return .unauthorized
    case 413: return .tooLarge
    case 503: return .notConfigured
    default: return .server(status: status)
    }
}

public struct CaptureClient: Sendable {
    private let session: URLSession
    private let baseURL: URL

    public init(session: URLSession = .shared, baseURL: URL = TasteAPI.baseURL) {
        self.session = session
        self.baseURL = baseURL
    }

    /// Creates the item. Returns the raw response JSON (the route returns the
    /// bare item row, not a wrapper).
    @discardableResult
    public func capture(_ payload: CapturePayload, key: String) async throws -> Data {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/ingest/capture"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await perform(request)
        if let error = mapStatus((response as? HTTPURLResponse)?.statusCode ?? 0) { throw error }
        return data
    }

    /// Uploads raw image bytes and returns the URL to use as `image_url`.
    public func uploadImage(_ data: Data, contentType: String = "image/jpeg", key: String) async throws -> String {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/ingest/capture-image"))
        request.httpMethod = "POST"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.httpBody = data

        let (body, response) = try await perform(request)
        if let error = mapStatus((response as? HTTPURLResponse)?.statusCode ?? 0) { throw error }

        struct UploadResponse: Decodable { let url: String }
        guard let decoded = try? JSONDecoder().decode(UploadResponse.self, from: body) else {
            throw CaptureError.server(status: 200)
        }
        return decoded.url
    }

    private func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch {
            throw CaptureError.transport
        }
    }
}
