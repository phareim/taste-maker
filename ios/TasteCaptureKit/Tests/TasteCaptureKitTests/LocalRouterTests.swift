import XCTest
@testable import TasteCaptureKit

final class LocalRouterTests: XCTestCase {
    private let router = LocalRouter()

    // Host matching is where this kind of code actually breaks.
    func testNormalizeHost() {
        XCTAssertEqual(LocalRouter.normalizeHost("https://www.COS.com/en/x"), "cos.com")
        XCTAssertEqual(LocalRouter.normalizeHost("https://open.spotify.com./track/x"), "open.spotify.com")
        XCTAssertEqual(LocalRouter.normalizeHost("https://open.spotify.com:443/track/x"), "open.spotify.com")
        XCTAssertNil(LocalRouter.normalizeHost("ftp://cos.com/x"))
        XCTAssertNil(LocalRouter.normalizeHost("not a url"))
        XCTAssertNil(LocalRouter.normalizeHost("tastecapture://settings"))
    }

    func testMusicHostsRouteToMusic() {
        for url in [
            "https://open.spotify.com/track/abc",
            "https://music.apple.com/us/album/rumours/594061854",
            "https://listen.tidal.com/album/1",
            "https://mdou-moctar.bandcamp.com/album/afrique-victime",
        ] {
            let guess = router.classify(sourceURL: url, hasSelection: false, hasImage: false)
            XCTAssertEqual(guess.kind, "music", url)
            XCTAssertTrue(guess.autoSelects, url)
        }
    }

    func testClothingHostsRouteToClothing() {
        for url in ["https://www.cos.com/en/x", "https://www.uniqlo.com/us/en/products/1"] {
            let guess = router.classify(sourceURL: url, hasSelection: false, hasImage: false)
            XCTAssertEqual(guess.kind, "clothing", url)
        }
    }

    // A subdomain of a listed host matches; a host that merely ends in the
    // same letters must not.
    func testSubdomainMatchingIsNotSubstringMatching() {
        XCTAssertEqual(router.classify(sourceURL: "https://x.bandcamp.com/a", hasSelection: false, hasImage: false).kind, "music")
        XCTAssertNil(router.classify(sourceURL: "https://notbandcamp.com/a", hasSelection: false, hasImage: false).kind)
        XCTAssertNil(router.classify(sourceURL: "https://fakecos.com/a", hasSelection: false, hasImage: false).kind)
    }

    func testSelectionBeatsHostMatch() {
        let guess = router.classify(sourceURL: "https://open.spotify.com/track/abc", hasSelection: true, hasImage: false)
        XCTAssertEqual(guess.kind, "quote")
        XCTAssertEqual(guess.reason, "you selected text")
    }

    func testBarePhotoIsMediumConfidenceArt() {
        let guess = router.classify(sourceURL: nil, hasSelection: false, hasImage: true)
        XCTAssertEqual(guess.kind, "art")
        XCTAssertEqual(guess.confidence, .medium)
        XCTAssertFalse(guess.autoSelects, "medium confidence must not auto-select")
    }

    // Deliberately NOT `reference` — an unrecognized source is a question.
    func testUnknownHostLeavesKindUnset() {
        let guess = router.classify(sourceURL: "https://some-blog.test/post", hasSelection: false, hasImage: false)
        XCTAssertNil(guess.kind)
        XCTAssertEqual(guess.confidence, .low)
        XCTAssertFalse(guess.autoSelects)
    }

    func testEveryRoutedKindIsAValidKind() {
        for url in ["https://open.spotify.com/x", "https://cos.com/x", nil] {
            let guess = router.classify(sourceURL: url, hasSelection: false, hasImage: url == nil)
            if let kind = guess.kind { XCTAssertTrue(kinds.contains(kind), kind) }
        }
    }
}
