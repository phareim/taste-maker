import XCTest
@testable import TasteCaptureKit

final class EnrichClientTests: XCTestCase {
    private var client: EnrichClient!

    override func setUp() {
        super.setUp()
        client = EnrichClient(session: MockURLProtocol.session())
    }

    func testDecodesFullResult() async {
        MockURLProtocol.respond(200, """
        {"kind":"music","kind_confidence":"high","kind_reason":"matched open.spotify.com",
         "title":"Dreams","creator":"Fleetwood Mac","creator_source":"og:description",
         "image_url":"https://i.scdn.co/x.jpg","source_url":"https://open.spotify.com/track/x"}
        """)
        let result = await client.enrich(EnrichRequest(url: "https://open.spotify.com/track/x"), key: "k")
        XCTAssertEqual(result?.kind, "music")
        XCTAssertEqual(result?.creator, "Fleetwood Mac")
        XCTAssertEqual(result?.creatorSource, "og:description")
        XCTAssertEqual(result?.kindReason, "matched open.spotify.com")
        XCTAssertTrue(result?.isHighConfidence == true)
    }

    func testDecodesAllNullResult() async {
        MockURLProtocol.respond(200, """
        {"kind":null,"kind_confidence":"low","kind_reason":"unrecognized source","title":null,
         "creator":null,"creator_source":null,"image_url":null,"source_url":null}
        """)
        let result = await client.enrich(EnrichRequest(url: "https://unknown.test/x"), key: "k")
        XCTAssertNotNil(result, "an all-null body is a valid answer, not a failure")
        XCTAssertNil(result?.kind)
        XCTAssertFalse(result?.isHighConfidence == true)
    }

    // Enrichment is an enhancement over a guess the client already made, so
    // every failure path must degrade to silence rather than surfacing an error.
    func testNonSuccessReturnsNil() async {
        MockURLProtocol.respond(500, "boom")
        let result = await client.enrich(EnrichRequest(url: "https://x.test"), key: "k")
        XCTAssertNil(result)
    }

    func testUnauthorizedReturnsNilRatherThanThrowing() async {
        MockURLProtocol.respond(401, "")
        let result = await client.enrich(EnrichRequest(url: "https://x.test"), key: "bad")
        XCTAssertNil(result)
    }

    func testTransportFailureReturnsNil() async {
        MockURLProtocol.handler = { _ in throw URLError(.timedOut) }
        let result = await client.enrich(EnrichRequest(url: "https://x.test"), key: "k")
        XCTAssertNil(result)
    }

    func testMalformedJSONReturnsNil() async {
        MockURLProtocol.respond(200, "not json")
        let result = await client.enrich(EnrichRequest(url: "https://x.test"), key: "k")
        XCTAssertNil(result)
    }

    func testEncodesSnakeCaseRequest() async {
        MockURLProtocol.respond(200, "{}")
        let page = SharedPageContext(title: "T", url: "https://x.test", selection: "sel", meta: ["og:title": "T"], jsonld: ["{}"])
        _ = await client.enrich(
            EnrichRequest(url: "https://x.test", sharedText: "Dreams by Fleetwood Mac", hasImage: true, page: page),
            key: "k"
        )
        let sent = MockURLProtocol.lastRequestBody!
        let json = try! JSONSerialization.jsonObject(with: sent) as! [String: Any]
        XCTAssertEqual(json["shared_text"] as? String, "Dreams by Fleetwood Mac")
        XCTAssertEqual(json["has_image"] as? Bool, true)
        let pageJSON = json["page"] as? [String: Any]
        XCTAssertEqual(pageJSON?["selection"] as? String, "sel")
    }
}
