import Foundation
import UIKit
import UniformTypeIdentifiers
import TasteCaptureKit

@MainActor
final class CaptureViewModel: ObservableObject {
    typealias Field = CaptureField

    /// Optional on purpose: an unrecognized source leaves this nil and Save
    /// stays disabled until the user picks, rather than silently defaulting to
    /// `reference` the way the Chrome extension does.
    @Published var kind: String?
    @Published var title = ""
    @Published var body = ""
    @Published var sourceURL = ""
    @Published var imageURL = ""
    @Published var creator = ""
    @Published var note = ""

    /// Provenance captions. Cleared the moment the user edits the field —
    /// once you've typed it, it's yours, not a guess.
    @Published var kindReason: String?
    @Published var creatorSource: String?

    @Published var isEnriching = false
    @Published var isSubmitting = false
    @Published var statusMessage: String?
    @Published var statusIsError = false
    @Published var needsKey = false

    private(set) var touched: Set<Field> = []
    private var pendingImage: UIImage?

    private weak var extensionContext: NSExtensionContext?
    private let keychain = KeychainStore()
    private let captureClient = CaptureClient()
    private let enrichClient = EnrichClient()
    private let router = LocalRouter()

    init(extensionContext: NSExtensionContext?) {
        self.extensionContext = extensionContext
    }

    var isImageKind: Bool { kind == "art" || kind == "clothing" }
    var creatorLabel: String { kind == "clothing" ? "Brand" : "Creator" }
    var bodyLabel: String {
        switch kind {
        case "quote": return "Quote"
        case "art", "clothing": return "Description"
        case "music": return "Track"
        default: return "Body"
        }
    }
    var canSubmit: Bool {
        kind != nil && !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSubmitting
    }

    func markTouched(_ field: Field) {
        touched.insert(field)
        if field == .creator { creatorSource = nil }
        if field == .kind { kindReason = nil }
    }

    // MARK: - Prefill

    func loadSharedContent() async {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else { return }

        var foundText = ""
        var foundURL: String?
        var foundImage: UIImage?
        var page: SharedPageContext?

        // The JS preprocessor's output arrives either on the item's userInfo or
        // as a property-list attachment, depending on how the share was routed.
        if let results = item.userInfo?[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any] {
            page = Self.pageContext(from: results)
        }

        for provider in item.attachments ?? [] {
            if page == nil, provider.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier),
               let plist = try? await provider.loadItem(forTypeIdentifier: UTType.propertyList.identifier) as? [String: Any],
               let results = plist[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any] {
                page = Self.pageContext(from: results)
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
               let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                foundText = text
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
               let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                // A file URL is an image on disk, not a web source.
                if url.isFileURL {
                    if let data = try? Data(contentsOf: url) { foundImage = UIImage(data: data) }
                } else {
                    foundURL = url.absoluteString
                }
            }
            if foundImage == nil, provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
               let loaded = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier) {
                if let image = loaded as? UIImage {
                    foundImage = image
                } else if let url = loaded as? URL, let data = try? Data(contentsOf: url) {
                    foundImage = UIImage(data: data)
                } else if let data = loaded as? Data {
                    foundImage = UIImage(data: data)
                }
            }
        }

        // The page's own URL is more trustworthy than a shared attachment URL.
        if let pageURL = page?.url, !pageURL.isEmpty { foundURL = pageURL }
        let selection = (page?.selection ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        if let pageTitle = page?.title, !pageTitle.isEmpty { title = pageTitle }
        if let foundURL { sourceURL = foundURL }
        pendingImage = foundImage

        if !selection.isEmpty {
            body = selection
        } else if !foundText.isEmpty, foundText != foundURL {
            // Some apps share "Track by Artist <url>" as text; keep it as the
            // body but don't duplicate a bare URL into it.
            body = foundText
        }

        // The instant guess, so the form is never blank while enrich is in flight.
        let guess = router.classify(
            sourceURL: foundURL,
            hasSelection: !selection.isEmpty,
            hasImage: foundImage != nil
        )
        if guess.autoSelects {
            kind = guess.kind
            kindReason = guess.reason
        }
        // Sharing an image that came with a URL (long-press in Safari) needs no
        // upload — the URL is already the image.
        if foundImage != nil, let foundURL, isLikelyImageURL(foundURL) { imageURL = foundURL }

        await enrich(url: foundURL, sharedText: foundText.isEmpty ? nil : foundText, page: page, hasImage: foundImage != nil)
    }

    private static func pageContext(from results: [String: Any]) -> SharedPageContext {
        SharedPageContext(
            title: results["title"] as? String,
            url: results["url"] as? String,
            selection: results["selection"] as? String,
            meta: results["meta"] as? [String: String],
            jsonld: results["jsonld"] as? [String]
        )
    }

    private func isLikelyImageURL(_ url: String) -> Bool {
        url.range(of: #"\.(jpg|jpeg|png|gif|webp|heic)(\?|$)"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    // MARK: - Enrichment

    private func enrich(url: String?, sharedText: String?, page: SharedPageContext?, hasImage: Bool) async {
        guard url != nil || page != nil else { return }
        guard let key = keychain.load() else { return }

        isEnriching = true
        defer { isEnriching = false }

        let result = await enrichClient.enrich(
            EnrichRequest(url: url, sharedText: sharedText, hasImage: hasImage, page: page),
            key: key
        )
        guard let result else { return }
        apply(result)
    }

    /// The merge policy itself lives in TasteCaptureKit's `EnrichMerge`, where
    /// it is a pure function and unit-tested — it is the one piece here with a
    /// real race in it (the response can land after the user starts typing).
    func apply(_ result: EnrichResult) {
        let merged = EnrichMerge.merge(currentFields, result: result, touched: touched)
        kind = merged.kind
        title = merged.title
        sourceURL = merged.sourceURL
        imageURL = merged.imageURL
        creator = merged.creator
        kindReason = merged.kindReason
        creatorSource = merged.creatorSource
    }

    private var currentFields: CaptureFields {
        CaptureFields(
            kind: kind, title: title, body: body, sourceURL: sourceURL,
            imageURL: imageURL, creator: creator, note: note,
            kindReason: kindReason, creatorSource: creatorSource
        )
    }

    // MARK: - Submit

    func submit() async {
        let trimmedBody = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let kind, !trimmedBody.isEmpty else { return }

        guard let key = keychain.load() else {
            needsKey = true
            statusMessage = "No ingest key set — tap to open the app."
            statusIsError = true
            return
        }

        isSubmitting = true
        statusMessage = nil
        defer { isSubmitting = false }

        do {
            var finalImageURL = imageURL.trimmingCharacters(in: .whitespacesAndNewlines)
            // A raw photo (shared from Photos) has bytes but no URL — upload it
            // and use what comes back.
            if finalImageURL.isEmpty, let pendingImage {
                guard let data = Self.downscaledJPEG(pendingImage) else {
                    statusMessage = "Could not prepare the image."
                    statusIsError = true
                    return
                }
                finalImageURL = try await captureClient.uploadImage(data, key: key)
            }

            let payload = CapturePayload(
                kind: kind,
                body: trimmedBody,
                title: nilIfEmpty(title),
                sourceURL: nilIfEmpty(sourceURL),
                creator: nilIfEmpty(creator),
                note: nilIfEmpty(note),
                imageURL: nilIfEmpty(finalImageURL)
            )
            try await captureClient.capture(payload, key: key)
            extensionContext?.completeRequest(returningItems: nil)
        } catch CaptureError.unauthorized {
            fail("Key rejected — check it in the app.")
        } catch CaptureError.notConfigured {
            fail("Ingest is not configured on the server.")
        } catch CaptureError.badRequest {
            fail("Could not save the item.")
        } catch CaptureError.tooLarge {
            fail("Image too large.")
        } catch {
            fail("Network error — could not reach taste-maker.")
        }
    }

    private func fail(_ message: String) {
        statusMessage = message
        statusIsError = true
    }

    private func nilIfEmpty(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    /// Max 1600px on the longest side at JPEG 0.8 — comfortably under both the
    /// extension's memory ceiling and the backend's 8MB cap.
    static func downscaledJPEG(_ image: UIImage, maxDimension: CGFloat = 1600, quality: CGFloat = 0.8) -> Data? {
        let longest = max(image.size.width, image.size.height)
        guard longest > 0 else { return nil }
        let scale = min(1, maxDimension / longest)
        let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
        return resized.jpegData(compressionQuality: quality)
    }

    // MARK: - Extension lifecycle

    func openSettings() {
        guard let url = URL(string: "tastecapture://settings") else { return }
        extensionContext?.open(url, completionHandler: nil)
    }

    func cancel() {
        extensionContext?.cancelRequest(withError: NSError(domain: "TasteCaptureShare", code: 0))
    }
}
