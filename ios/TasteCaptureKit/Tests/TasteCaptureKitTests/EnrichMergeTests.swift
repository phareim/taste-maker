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
        XCTAssertEqual(merged.creator, "Fleetwood Mac")
        XCTAssertEqual(merged.creatorSource, "og:description")
        XCTAssertEqual(merged.kindReason, "matched x")
    }

    // The form labels the body "Track" for music and "Description" for
    // art/clothing — that field is the item's NAME for those kinds, so the
    // page title belongs there. Otherwise the user is asked to type a track
    // name that is already on screen in the Title field above.
    func testNameGoesToBodyForMusicArtAndClothing() {
        for kind in ["music", "art", "clothing"] {
            let merged = EnrichMerge.merge(CaptureFields(), result: result(kind: kind, title: "Outro"), touched: [])
            XCTAssertEqual(merged.body, "Outro", kind)
            XCTAssertEqual(merged.title, "", "\(kind) should not duplicate the name into title")
        }
    }

    func testNameGoesToTitleForQuoteAndReference() {
        for kind in ["quote", "reference"] {
            let merged = EnrichMerge.merge(CaptureFields(), result: result(kind: kind, title: "A headline"), touched: [])
            XCTAssertEqual(merged.title, "A headline", kind)
            XCTAssertEqual(merged.body, "", kind)
        }
    }

    // A quote's body is the selection the user made; enrichment must not
    // overwrite it with the page title.
    func testSelectionBodySurvives() {
        let fields = CaptureFields(kind: "quote", body: "the selected sentence")
        let merged = EnrichMerge.merge(fields, result: result(kind: "quote", title: "Page title"), touched: [])
        XCTAssertEqual(merged.body, "the selected sentence")
        XCTAssertEqual(merged.title, "Page title")
    }

    func testTypedTrackNameIsNotOverwritten() {
        let fields = CaptureFields(kind: "music", body: "my own words")
        let merged = EnrichMerge.merge(fields, result: result(kind: "music", title: "Outro"), touched: [.body])
        XCTAssertEqual(merged.body, "my own words")
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

    // Album art off a Spotify link is worth keeping even though the music form
    // hides the image field — the library renders it.
    func testImageURLIsKeptForEveryKind() {
        for kind in kinds {
            let merged = EnrichMerge.merge(
                CaptureFields(), result: result(kind: kind, imageURL: "https://img.test/a.jpg"), touched: []
            )
            XCTAssertEqual(merged.imageURL, "https://img.test/a.jpg", kind)
        }
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
