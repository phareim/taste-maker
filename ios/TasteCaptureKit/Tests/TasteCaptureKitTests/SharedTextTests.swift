import XCTest
@testable import TasteCaptureKit

final class SharedTextTests: XCTestCase {
    // The exact payload the Spotify app hands over: a bare link, as plain
    // text, with no public.url attachment.
    private let spotifyShare =
        "https://open.spotify.com/track/1s9i7W8zx7Nxx78MUIsvjV?si=pVtG4yyKR1ikC5d1LQZ1nw&utm_source=native-share"

    func testExtractsURLFromABareTextShare() {
        let url = SharedText.firstURL(in: spotifyShare)
        XCTAssertNotNil(url)
        XCTAssertEqual(LocalRouter.normalizeHost(url!), "open.spotify.com")
    }

    func testBareURLShareLeavesNoBodyText() {
        XCTAssertEqual(SharedText.withoutURLs(spotifyShare), "")
    }

    func testKeepsTheHumanPartOfAMixedShare() {
        let text = "Dreams by Fleetwood Mac https://open.spotify.com/track/abc"
        XCTAssertEqual(SharedText.withoutURLs(text), "Dreams by Fleetwood Mac")
        XCTAssertEqual(SharedText.firstURL(in: text), "https://open.spotify.com/track/abc")
    }

    func testNoURLIsLeftAlone() {
        XCTAssertNil(SharedText.firstURL(in: "just some words"))
        XCTAssertEqual(SharedText.withoutURLs("just some words"), "just some words")
    }

    func testEmptyInput() {
        XCTAssertNil(SharedText.firstURL(in: ""))
        XCTAssertEqual(SharedText.withoutURLs(""), "")
    }

    func testIgnoresNonHTTPSchemes() {
        XCTAssertNil(SharedText.firstURL(in: "mailto:someone@example.com"))
    }

    // The end-to-end point of all this: a text-only Spotify share must route.
    func testTextOnlySpotifyShareRoutesToMusic() {
        let url = SharedText.firstURL(in: spotifyShare)
        let guess = LocalRouter().classify(sourceURL: url, hasSelection: false, hasImage: false)
        XCTAssertEqual(guess.kind, "music")
        XCTAssertTrue(guess.autoSelects)
    }

    func testStripsTrackingParams() {
        XCTAssertEqual(
            SharedText.cleanURL(spotifyShare),
            "https://open.spotify.com/track/1s9i7W8zx7Nxx78MUIsvjV"
        )
    }

    func testKeepsMeaningfulQueryParams() {
        // Apple Music and YouTube both carry content-identifying params.
        XCTAssertEqual(
            SharedText.cleanURL("https://www.youtube.com/watch?v=abc123&utm_source=share"),
            "https://www.youtube.com/watch?v=abc123"
        )
        XCTAssertEqual(
            SharedText.cleanURL("https://music.apple.com/us/album/rumours/594061854?i=99"),
            "https://music.apple.com/us/album/rumours/594061854?i=99"
        )
    }

    func testCleanURLLeavesPlainURLsUntouched() {
        let plain = "https://open.spotify.com/track/abc"
        XCTAssertEqual(SharedText.cleanURL(plain), plain)
        XCTAssertEqual(SharedText.cleanURL("not a url"), "not a url")
    }
}
