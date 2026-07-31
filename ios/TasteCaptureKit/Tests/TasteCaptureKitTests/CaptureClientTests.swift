import XCTest
@testable import TasteCaptureKit

final class CaptureClientTests: XCTestCase {
    private var client: CaptureClient!

    override func setUp() {
        super.setUp()
        client = CaptureClient(session: MockURLProtocol.session())
    }

    func testCaptureEncodesSnakeCaseKeys() async throws {
        MockURLProtocol.respond(200, #"{"id":"abc","kind":"music"}"#)
        let payload = CapturePayload(
            kind: "music", body: "Dreams", title: "Rumours",
            sourceURL: "https://open.spotify.com/track/x", creator: "Fleetwood Mac",
            imageURL: "https://img.test/a.jpg"
        )
        _ = try await client.capture(payload, key: "k")

        let sent = try XCTUnwrap(MockURLProtocol.lastRequestBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: sent) as? [String: Any])
        // The route reads source_url/image_url; camelCase would silently drop them.
        XCTAssertEqual(json["source_url"] as? String, "https://open.spotify.com/track/x")
        XCTAssertEqual(json["image_url"] as? String, "https://img.test/a.jpg")
        XCTAssertEqual(json["creator"] as? String, "Fleetwood Mac")
        XCTAssertNil(json["note"])
    }

    func testUnauthorizedIsDistinctFromGenericFailure() async {
        MockURLProtocol.respond(401, "")
        do {
            _ = try await client.capture(CapturePayload(kind: "quote", body: "x"), key: "bad")
            XCTFail("expected unauthorized")
        } catch {
            XCTAssertEqual(error as? CaptureError, .unauthorized)
        }
    }

    func testStatusMapping() async {
        let cases: [(Int, CaptureError)] = [
            (400, .badRequest), (413, .tooLarge), (503, .notConfigured), (500, .server(status: 500)),
        ]
        for (status, expected) in cases {
            MockURLProtocol.respond(status, "")
            do {
                _ = try await client.capture(CapturePayload(kind: "quote", body: "x"), key: "k")
                XCTFail("expected throw for \(status)")
            } catch {
                XCTAssertEqual(error as? CaptureError, expected, "status \(status)")
            }
        }
    }

    func testTransportFailure() async {
        MockURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        do {
            _ = try await client.capture(CapturePayload(kind: "quote", body: "x"), key: "k")
            XCTFail("expected transport error")
        } catch {
            XCTAssertEqual(error as? CaptureError, .transport)
        }
    }

    func testUploadImageReturnsURL() async throws {
        MockURLProtocol.respond(201, #"{"url":"https://taste.phareim.no/api/images/abc.jpg"}"#)
        let url = try await client.uploadImage(Data([0xFF, 0xD8]), key: "k")
        XCTAssertEqual(url, "https://taste.phareim.no/api/images/abc.jpg")
    }

    func testUploadImageTooLarge() async {
        MockURLProtocol.respond(413, "")
        do {
            _ = try await client.uploadImage(Data([0xFF]), key: "k")
            XCTFail("expected tooLarge")
        } catch {
            XCTAssertEqual(error as? CaptureError, .tooLarge)
        }
    }
}
