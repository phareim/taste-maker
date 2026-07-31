import Foundation

public enum CaptureField: Hashable, Sendable {
    case kind, title, body, sourceURL, imageURL, creator, note
}

/// The form's state, as a value so the merge policy can be a pure function.
public struct CaptureFields: Equatable, Sendable {
    public var kind: String?
    public var title: String
    public var body: String
    public var sourceURL: String
    public var imageURL: String
    public var creator: String
    public var note: String
    /// Provenance captions for the two fields that get inferred.
    public var kindReason: String?
    public var creatorSource: String?

    public init(
        kind: String? = nil,
        title: String = "",
        body: String = "",
        sourceURL: String = "",
        imageURL: String = "",
        creator: String = "",
        note: String = "",
        kindReason: String? = nil,
        creatorSource: String? = nil
    ) {
        self.kind = kind
        self.title = title
        self.body = body
        self.sourceURL = sourceURL
        self.imageURL = imageURL
        self.creator = creator
        self.note = note
        self.kindReason = kindReason
        self.creatorSource = creatorSource
    }

    public var isImageKind: Bool { kind == "art" || kind == "clothing" }
}

public enum EnrichMerge {
    /// Folds a server result into the form.
    ///
    /// The rule that matters: an enrich response can land *after* the user has
    /// started typing, so it may only write into fields that are both empty and
    /// untouched. Their input always wins. Kind is the one exception — it may
    /// be replaced when nothing was settled locally, or when the server is
    /// highly confident and the user hasn't chosen one themselves.
    public static func merge(
        _ fields: CaptureFields,
        result: EnrichResult,
        touched: Set<CaptureField>
    ) -> CaptureFields {
        var next = fields

        if let newKind = result.kind, kinds.contains(newKind), !touched.contains(.kind) {
            if next.kind == nil || result.isHighConfidence {
                next.kind = newKind
                next.kindReason = result.kindReason
            }
        }

        if let value = nonEmpty(result.title), next.title.isEmpty, !touched.contains(.title) {
            next.title = value
        }
        if let value = nonEmpty(result.creator), next.creator.isEmpty, !touched.contains(.creator) {
            next.creator = value
            next.creatorSource = result.creatorSource
        }
        if let value = nonEmpty(result.sourceURL), next.sourceURL.isEmpty, !touched.contains(.sourceURL) {
            next.sourceURL = value
        }
        // An og:image is only wanted for the kinds that actually show one.
        if let value = nonEmpty(result.imageURL), next.imageURL.isEmpty, !touched.contains(.imageURL), next.isImageKind {
            next.imageURL = value
        }

        return next
    }

    private static func nonEmpty(_ s: String?) -> String? {
        guard let s, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return s
    }
}
