import Foundation

/// Metadata the Share Extension's JS preprocessor scraped out of Safari's live
/// DOM. When this is present the Worker classifies from it directly and skips
/// its own outbound fetch — faster, and more accurate than refetching a page
/// that may be behind a paywall or a consent wall.
public struct SharedPageContext: Codable, Sendable {
    public var title: String?
    public var url: String?
    public var selection: String?
    public var meta: [String: String]?
    public var jsonld: [String]?

    public init(
        title: String? = nil,
        url: String? = nil,
        selection: String? = nil,
        meta: [String: String]? = nil,
        jsonld: [String]? = nil
    ) {
        self.title = title
        self.url = url
        self.selection = selection
        self.meta = meta
        self.jsonld = jsonld
    }
}

public struct EnrichRequest: Codable, Sendable {
    public var url: String?
    public var sharedText: String?
    public var hasImage: Bool
    public var page: SharedPageContext?

    public init(url: String? = nil, sharedText: String? = nil, hasImage: Bool = false, page: SharedPageContext? = nil) {
        self.url = url
        self.sharedText = sharedText
        self.hasImage = hasImage
        self.page = page
    }

    enum CodingKeys: String, CodingKey {
        case url, page
        case sharedText = "shared_text"
        case hasImage = "has_image"
    }
}

public struct EnrichResult: Codable, Sendable, Equatable {
    public var kind: String?
    public var kindConfidence: String?
    public var kindReason: String?
    public var title: String?
    public var creator: String?
    public var creatorSource: String?
    public var imageURL: String?
    public var sourceURL: String?

    /// Only a high-confidence server verdict is allowed to override a kind the
    /// local router already settled on.
    public var isHighConfidence: Bool { kindConfidence == "high" }

    enum CodingKeys: String, CodingKey {
        case kind, title, creator
        case kindConfidence = "kind_confidence"
        case kindReason = "kind_reason"
        case creatorSource = "creator_source"
        case imageURL = "image_url"
        case sourceURL = "source_url"
    }
}

public struct EnrichClient: Sendable {
    private let session: URLSession
    private let baseURL: URL

    public init(session: URLSession = .shared, baseURL: URL = TasteAPI.baseURL) {
        self.session = session
        self.baseURL = baseURL
    }

    /// Returns nil rather than throwing on every failure path. Enrichment is
    /// an enhancement over a guess the caller already made — a slow or broken
    /// page must never surface an error for a field the user didn't ask to be
    /// filled.
    public func enrich(_ payload: EnrichRequest, key: String) async -> EnrichResult? {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/ingest/enrich"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        // Shorter than the Worker's own 5s fetch budget plus overhead, so a
        // slow retailer never holds the form hostage.
        request.timeoutInterval = 6
        request.httpBody = try? JSONEncoder().encode(payload)

        guard let (data, response) = try? await session.data(for: request),
              (200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0),
              let result = try? JSONDecoder().decode(EnrichResult.self, from: data)
        else { return nil }
        return result
    }
}
