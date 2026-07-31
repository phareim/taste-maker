import XCTest
@testable import TasteCaptureKit

final class EnrichMergeTests: XCTestCase {
    private func result(
        kind: String? = nil, confidence: String? = "high", reason: String? = "matched x",
        title: String? = nil, creator: String? = nil, creatorSource: String? = nil,
        imageURL: String? = nil, sourceURL: String? = nil
    ) -> EnrichResult {
        var r = EnrichResult()
        r.kind = kind; r.kindConfidence = confidence; r.kindReason = reason
        r.title = title; r.creator = creator; r.creatorSource = creatorSource
        r.imageURL = imageURL; r.sourceURL = sourceURL
        return r
    }

    func testFillsEmptyUntouchedFields() {
        let merged = EnrichMerge.merge(
            CaptureFields(),
            result: result(kind: "music", title: "Dreams", creator: "Fleetwood Mac", creatorSource: "og:description"),
            touched: []
        )
        XCTAssertEqual(merged.kind, "music")
        XCTAssertEqual(merged.title, "Dreams")
        XCTAssertEqual(merged.creator, "Fleetwood Mac")
        XCTAssertEqual(merged.creatorSource, "og:description")
        XCTAssertEqual(merged.kindReason, "matched x")
    }

    // The race the whole policy exists for: the user typed before the response
    // landed.
    func testDoesNotClobberTouchedCreator() {
        let fields = CaptureFields(creator: "My own attribution")
        let merged = EnrichMerge.merge(fields, result: result(creator: "Robot Guess"), touched: [.creator])
        XCTAssertEqual(merged.creator, "My own attribution")
        XCTAssertNil(merged.creatorSource, "a typed value must not carry a provenance caption")
    }

    func testDoesNotClobberNonEmptyFieldEvenIfUntouched() {
        let fields = CaptureFields(title: "Prefilled from the page")
        let merged = EnrichMerge.merge(fields, result: result(title: "Server title"), touched: [])
        XCTAssertEqual(merged.title, "Prefilled from the page")
    }

    func testUserChosenKindSurvivesHighConfidence() {
        let fields = CaptureFields(kind: "quote")
        let merged = EnrichMerge.merge(fields, result: result(kind: "music", confidence: "high"), touched: [.kind])
        XCTAssertEqual(merged.kind, "quote")
    }

    func testHighConfidenceOverridesAnUntouchedLocalGuess() {
        let fields = CaptureFields(kind: "art")
        let merged = EnrichMerge.merge(fields, result: result(kind: "clothing", confidence: "high"), touched: [])
        XCTAssertEqual(merged.kind, "clothing")
    }

    func testMediumConfidenceDoesNotOverrideAnExistingKind() {
        let fields = CaptureFields(kind: "art")
        let merged = EnrichMerge.merge(fields, result: result(kind: "clothing", confidence: "medium"), touched: [])
        XCTAssertEqual(merged.kind, "art")
    }

    // ...but it may fill a kind that nothing had settled yet.
    func testMediumConfidenceFillsAnUnsetKind() {
        let merged = EnrichMerge.merge(
            CaptureFields(), result: result(kind: "clothing", confidence: "medium", reason: "looks like a product page"),
            touched: []
        )
        XCTAssertEqual(merged.kind, "clothing")
        XCTAssertEqual(merged.kindReason, "looks like a product page")
    }

    func testRejectsAnUnknownKind() {
        let merged = EnrichMerge.merge(CaptureFields(), result: result(kind: "podcast"), touched: [])
        XCTAssertNil(merged.kind, "a kind outside KINDS would fail the server's own CHECK constraint")
    }

    func testImageURLOnlyAppliesToImageKinds() {
        let music = EnrichMerge.merge(
            CaptureFields(), result: result(kind: "music", imageURL: "https://img.test/a.jpg"), touched: []
        )
        XCTAssertEqual(music.imageURL, "", "music has no image field on the form")

        let art = EnrichMerge.merge(
            CaptureFields(), result: result(kind: "art", imageURL: "https://img.test/a.jpg"), touched: []
        )
        XCTAssertEqual(art.imageURL, "https://img.test/a.jpg")

        let clothing = EnrichMerge.merge(
            CaptureFields(), result: result(kind: "clothing", imageURL: "https://img.test/a.jpg"), touched: []
        )
        XCTAssertEqual(clothing.imageURL, "https://img.test/a.jpg")
    }

    func testBlankServerValuesAreIgnored() {
        let merged = EnrichMerge.merge(
            CaptureFields(kind: "music"), result: result(kind: "music", title: "   ", creator: ""), touched: []
        )
        XCTAssertEqual(merged.title, "")
        XCTAssertEqual(merged.creator, "")
        XCTAssertNil(merged.creatorSource)
    }

    func testAllNullResultIsANoOp() {
        let fields = CaptureFields(kind: "quote", title: "T", body: "B", creator: "C")
        let merged = EnrichMerge.merge(fields, result: EnrichResult(), touched: [])
        XCTAssertEqual(merged, fields)
    }

    func testNoteAndBodyAreNeverTouchedByEnrichment() {
        let fields = CaptureFields(body: "the quote", note: "why it strikes me")
        let merged = EnrichMerge.merge(fields, result: result(kind: "quote", title: "T"), touched: [])
        XCTAssertEqual(merged.body, "the quote")
        XCTAssertEqual(merged.note, "why it strikes me")
    }
}
