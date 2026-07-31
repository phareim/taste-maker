import Foundation

/// Parsing for shares that arrive as bare text.
///
/// Not every app hands over a `public.url` attachment. Spotify's share sheet,
/// for one, provides only plain text containing the link — so without this the
/// URL ends up sitting in the body, `sourceURL` stays empty, kind routing has
/// nothing to match on, and enrichment never fires at all.
public enum SharedText {
    private static let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    /// The first http(s) URL in the text, if any.
    public static func firstURL(in text: String) -> String? {
        guard !text.isEmpty, let detector else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        for match in detector.matches(in: text, range: range) {
            guard let url = match.url else { continue }
            let scheme = url.scheme?.lowercased()
            if scheme == "http" || scheme == "https" { return url.absoluteString }
        }
        return nil
    }

    /// The text with every detected link removed — what's left is the human
    /// part, e.g. "Dreams by Fleetwood Mac" from a share that also carried a
    /// link. Empty when the share was nothing but a URL.
    public static func withoutURLs(_ text: String) -> String {
        guard !text.isEmpty, let detector else { return text }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        var result = text
        // Replace back-to-front so earlier ranges stay valid.
        for match in detector.matches(in: text, range: range).reversed() {
            guard let r = Range(match.range, in: result) else { continue }
            result.replaceSubrange(r, with: "")
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Query parameters that identify the sharer or the campaign rather than
    /// the content. Spotify appends `?si=…&utm_source=native-share` to every
    /// shared link; keeping that in the library is noise, and `si` is
    /// share-session identifying.
    private static let trackingParams: Set<String> = [
        "si", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "fbclid", "gclid", "igshid", "ref", "ref_src", "_branch_match_id", "_bhlid",
    ]

    /// Strips tracking parameters, preserving everything else about the URL.
    public static func cleanURL(_ raw: String) -> String {
        guard var components = URLComponents(string: raw), let items = components.queryItems else { return raw }
        let kept = items.filter { !trackingParams.contains($0.name.lowercased()) }
        components.queryItems = kept.isEmpty ? nil : kept
        return components.string ?? raw
    }
}
