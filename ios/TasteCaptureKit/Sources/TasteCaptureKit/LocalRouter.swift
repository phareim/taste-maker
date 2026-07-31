import Foundation

public enum KindConfidence: String, Sendable {
    case high, medium, low
}

public struct KindGuess: Sendable, Equatable {
    public var kind: String?
    public var confidence: KindConfidence
    public var reason: String

    public init(kind: String?, confidence: KindConfidence, reason: String) {
        self.kind = kind
        self.confidence = confidence
        self.reason = reason
    }

    public var autoSelects: Bool { kind != nil && confidence == .high }
}

/// The instant, offline half of kind routing.
///
/// NOTE: `server/utils/enrich/domains.ts` is AUTHORITATIVE. This is a small
/// hardcoded subset that exists only so the form is never blank during the
/// ~400ms the enrich request is in flight; the server's verdict supersedes it.
/// The two lists WILL drift, and that is fine and expected — keeping the full
/// table server-side is precisely what lets it be tuned with a deploy instead
/// of an App Store round trip. Do not try to sync them.
///
/// iOS gives a share extension no way to learn which app invoked it, so this
/// routes on the shared URL's host. Spotify, Apple Music, Tidal and every
/// clothing retailer all share a URL, so in practice it behaves the same.
public struct LocalRouter: Sendable {
    private static let musicHosts: [String] = [
        "open.spotify.com", "spotify.link", "music.apple.com", "tidal.com",
        "listen.tidal.com", "soundcloud.com", "music.youtube.com", "deezer.com",
        "mixcloud.com", "bandcamp.com", "discogs.com", "nts.live", "last.fm",
    ]

    private static let clothingHosts: [String] = [
        "cos.com", "arket.com", "hm.com", "uniqlo.com", "zalando.no", "zalando.com",
        "ssense.com", "net-a-porter.com", "mrporter.com", "farfetch.com",
        "endclothing.com", "norseprojects.com", "acnestudios.com", "carhartt-wip.com",
        "patagonia.com", "arcteryx.com",
    ]

    public init() {}

    /// Lowercased host with `www.`, a trailing dot and any port removed.
    public static func normalizeHost(_ urlString: String) -> String? {
        guard let components = URLComponents(string: urlString),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              var host = components.host?.lowercased(), !host.isEmpty
        else { return nil }
        if host.hasSuffix(".") { host.removeLast() }
        if host.hasPrefix("www.") { host.removeFirst(4) }
        return host.isEmpty ? nil : host
    }

    /// True for an exact host match or any subdomain of it, so
    /// `mdou-moctar.bandcamp.com` matches `bandcamp.com` but `notbandcamp.com`
    /// does not.
    private static func matches(_ host: String, _ candidate: String) -> Bool {
        host == candidate || host.hasSuffix("." + candidate)
    }

    public func classify(sourceURL: String?, hasSelection: Bool, hasImage: Bool) -> KindGuess {
        // A selection is an explicit intent and outranks everything — selecting
        // a lyric on a Spotify page is a quote, not a music item.
        if hasSelection {
            return KindGuess(kind: "quote", confidence: .high, reason: "you selected text")
        }

        if let sourceURL, let host = Self.normalizeHost(sourceURL) {
            if Self.musicHosts.contains(where: { Self.matches(host, $0) }) {
                return KindGuess(kind: "music", confidence: .high, reason: "matched \(host)")
            }
            if Self.clothingHosts.contains(where: { Self.matches(host, $0) }) {
                return KindGuess(kind: "clothing", confidence: .high, reason: "matched \(host)")
            }
        }

        if hasImage && sourceURL == nil {
            return KindGuess(kind: "art", confidence: .medium, reason: "shared a photo")
        }

        // Deliberately NOT defaulting to `reference` the way the Chrome
        // extension does — an unrecognized source is a question, not a guess.
        return KindGuess(kind: nil, confidence: .low, reason: "unrecognized source")
    }
}
