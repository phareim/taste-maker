# iOS Share Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a native iOS Share Extension that captures a quote/reference/music/art item into taste-maker from any app's Share Sheet, via a new `TASTE_IOS_KEY`-authed backend route plus a new R2-backed photo-upload path for raw-photo shares, without the extension ever needing a browser session.

**Architecture:** Two new backend routes (`POST /api/ingest/capture-image`, `GET /api/images/[key]`) backed by a new R2 bucket, alongside the existing `POST /api/ingest/capture` route (reused as-is). A new Xcode project (`ios/`) with three targets: `TasteCapture` (host app — key entry only), `TasteCaptureShare` (the Share Extension — the actual capture UI), and `TasteCaptureKit` (a shared Swift package with the networking client and Keychain helper, imported by both).

**Tech Stack:** Nuxt 3 / Nitro (`cloudflare-module`) + h3 + Cloudflare R2 for the backend, matching existing route patterns. Swift 6 / SwiftUI for iOS, project generated via `xcodegen` (already installed: 2.45.4) from a `project.yml` spec — no hand-written `.pbxproj`.

## Global Constraints

- Companion to `docs/superpowers/plans/2026-07-14-chrome-extension-capture.md` (already merged into `main`) — this plan does not touch `extension/`, `/api/items`, or `/capture`.
- No test framework exists for the backend (`package.json` has no test runner) — verification is `npm run build` plus manual curl, same convention as the rest of this repo. `TasteCaptureKit` is the one part of this plan with real automated tests (`swift test`), since it's pure Swift logic outside app/extension sandboxing — `KeychainStore` and anything needing Simulator/device (Keychain access groups, Share Sheet integration) is manually verified instead, same "manual only" convention used everywhere else in this repo.
- New secret: `TASTE_IOS_KEY`, distinct from `TASTE_INGEST_KEY` and `TASTE_EXTENSION_KEY` (per the approved design — separate trust boundary, independently rotatable).
- New R2 bucket: `taste-maker-images`, bound as `TASTE_IMAGES`.
- `POST /api/ingest/capture-image` rejects bodies over 8MB with `413`. Client-side downscale before upload: max 1600px longest side, JPEG quality 0.8.
- iOS deployment target: 17.0. Bundle IDs: `no.phareim.tastecapture` (host app), `no.phareim.tastecapture.share` (extension). App Group: `group.no.phareim.tastecapture`. Both targets share one keychain-access-group entitlement — no access-group string is ever passed explicitly in Swift code (see Task 6): when a process has exactly one keychain-access-group entitled, Keychain Services uses it automatically if `kSecAttrAccessGroup` is omitted from the query.
- The Xcode project is generated via `xcodegen generate` from `ios/project.yml` — never hand-edit the generated `ios/TasteCapture.xcodeproj`. Verified empirically while writing this plan: `xcodegen generate` also **overwrites** any file sitting at a target's `info.path`/`entitlements.path` with its own auto-generated plist on every run — it does not preserve a pre-existing hand-authored one. Every `Info.plist`/`.entitlements` value in this plan (`NSExtension` config, App Group, keychain-access-group, `CFBundleURLTypes`) is therefore expressed as a `properties:` block inside `project.yml`, never as a separately hand-written XML file. Edit `project.yml`, then regenerate — never the generated plists directly.
- Every "build" verification step in this plan uses `xcodebuild ... -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build`, so it never depends on your Apple Developer Team ID. Real device install (which does need your team, and you have the paid $99/year account for it) happens only in Task 10.
- Deploying (pushing to `main`, which triggers the GitHub Actions build+deploy), `wrangler secret put`, `wrangler r2 bucket create` against production, and the on-device Xcode signing/install step are the irreversible/production-affecting or account-specific actions in this plan. All happen only in Task 10, and only with your explicit go-ahead at execution time.

---

## Task 1: Extend `requireIngestKey` for `TASTE_IOS_KEY`, add the R2 binding

**Files:**
- Modify: `server/utils/cloudflare.ts`
- Modify: `wrangler.toml`

**Interfaces:**
- Consumes: nothing new.
- Produces: `requireIngestKey(event, 'TASTE_IOS_KEY')` — third member of the existing `envKey` union. Task 2 calls this. `env.TASTE_IMAGES` (R2 binding) — Task 2 and Task 3 consume this.

- [ ] **Step 1: Extend the `CloudflareEnv` type and `envKey` union**

In `server/utils/cloudflare.ts`, replace:

```ts
type CloudflareEnv = {
  DB?: any
  TASTE_DB?: any
  NVIDIA_API_KEY?: string
  TASTE_INGEST_KEY?: string
  TASTE_EXTENSION_KEY?: string
}
```

with:

```ts
type CloudflareEnv = {
  DB?: any
  TASTE_DB?: any
  NVIDIA_API_KEY?: string
  TASTE_INGEST_KEY?: string
  TASTE_EXTENSION_KEY?: string
  TASTE_IOS_KEY?: string
}
```

And replace the `requireIngestKey` signature:

```ts
export const requireIngestKey = (
  event: any,
  envKey: 'TASTE_INGEST_KEY' | 'TASTE_EXTENSION_KEY' = 'TASTE_INGEST_KEY'
) => {
```

with:

```ts
export const requireIngestKey = (
  event: any,
  envKey: 'TASTE_INGEST_KEY' | 'TASTE_EXTENSION_KEY' | 'TASTE_IOS_KEY' = 'TASTE_INGEST_KEY'
) => {
```

No other change to the function body — `env?.[envKey]` already handles any key named on the union.

- [ ] **Step 2: Verify existing call sites still compile**

Run: `grep -rn "requireIngestKey(event" server/api/`
Expected: `highlight.post.ts`, `highlight/[id].delete.ts` still call with no second argument; `capture.post.ts` still calls with `'TASTE_EXTENSION_KEY'`. None reference `TASTE_IOS_KEY` yet (that's Task 2).

- [ ] **Step 3: Add the R2 bucket binding**

In `wrangler.toml`, add after the `[[d1_databases]]` blocks (before `[[routes]]`):

```toml
# Photo uploads from the iOS Share Extension (raw photos have no URL to
# reference directly, unlike Chrome's right-click-on-image). Created via
# `wrangler r2 bucket create taste-maker-images` (Task 10).
[[r2_buckets]]
binding = "TASTE_IMAGES"
bucket_name = "taste-maker-images"
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add server/utils/cloudflare.ts wrangler.toml
git commit -m "$(cat <<'EOF'
Add TASTE_IOS_KEY and the taste-maker-images R2 binding

Prep for the iOS Share Extension's ingest route (own Bearer secret,
same pattern as the Chrome extension's TASTE_EXTENSION_KEY) and its
photo-upload route (raw Share Sheet photos have no URL to store
directly, unlike Chrome's right-click-on-image).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `POST /api/ingest/capture-image`

**Files:**
- Create: `server/api/ingest/capture-image.post.ts`

**Interfaces:**
- Consumes: `requireIngestKey(event, 'TASTE_IOS_KEY')` from Task 1; `env.TASTE_IMAGES` (R2 binding) from Task 1.
- Produces: `POST /api/ingest/capture-image` — request body is raw image bytes (`Content-Type: image/jpeg`), response `{url: string}`. Task 9 (iOS) is the only consumer.

- [ ] **Step 1: Write the route**

Create `server/api/ingest/capture-image.post.ts`:

```ts
const MAX_BYTES = 8 * 1024 * 1024

/**
 * iOS Share Extension photo upload: raw Share Sheet photos usually have no
 * URL (unlike Chrome's right-click-on-image, which always has a src URL),
 * so this route hands back a URL the extension can then pass to the
 * existing POST /api/ingest/capture as image_url. No CORS handling —
 * this is only ever called from the native app via URLSession, never a
 * browser, so no preflight is issued.
 */
export default defineEventHandler(async (event) => {
  requireIngestKey(event, 'TASTE_IOS_KEY')

  const env = event?.context?.cloudflare?.env
  if (!env?.TASTE_IMAGES) {
    throw createError({ statusCode: 500, statusMessage: 'R2 bucket binding (TASTE_IMAGES) is not configured.' })
  }

  const bytes = await readRawBody(event, false)
  if (!bytes || !(bytes instanceof Buffer) || bytes.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Non-empty image body is required' })
  }
  if (bytes.length > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Image exceeds 8MB limit' })
  }

  const key = `${crypto.randomUUID()}.jpg`
  await env.TASTE_IMAGES.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } })

  return { url: `https://taste.phareim.no/api/images/${key}` }
})
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server/api/ingest/capture-image.post.ts
git commit -m "$(cat <<'EOF'
Add POST /api/ingest/capture-image for the iOS Share Extension

Bearer-authed (TASTE_IOS_KEY), 8MB cap, uploads to the new R2 bucket
and hands back a URL for the extension to pass to the existing
POST /api/ingest/capture as image_url. Live end-to-end verification
happens once the extension exists, in Task 10.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `GET /api/images/[key]`, document both in README

**Files:**
- Create: `server/api/images/[key].get.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `env.TASTE_IMAGES` from Task 1.
- Produces: `GET /api/images/[key]` — public, streams the stored image. This is the URL shape `capture-image` (Task 2) hands back, and what `image_url` will point to for iOS-uploaded art items.

- [ ] **Step 1: Write the route**

Create `server/api/images/[key].get.ts`:

```ts
/**
 * Serves images uploaded via POST /api/ingest/capture-image. No auth —
 * same visibility as any other image_url already rendered in the library
 * UI today (those are already arbitrary public URLs); this just adds one
 * more source for that column. Keys are UUIDs and objects are never
 * overwritten, so the response is safe to cache forever.
 */
export default defineEventHandler(async (event) => {
  const env = event?.context?.cloudflare?.env
  if (!env?.TASTE_IMAGES) {
    throw createError({ statusCode: 500, statusMessage: 'R2 bucket binding (TASTE_IMAGES) is not configured.' })
  }

  const key = getRouterParam(event, 'key')
  if (!key) {
    throw createError({ statusCode: 400, statusMessage: 'Missing key' })
  }

  const object = await env.TASTE_IMAGES.get(key)
  if (!object) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  setResponseHeaders(event, {
    'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
  return object.body
})
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Document both routes in README**

In `README.md`, in the "### Ingest" section, add a new bullet immediately after the existing `POST /api/ingest/capture` bullet (before the "Auth for..." line):

```markdown
- `POST /api/ingest/capture-image` — raw image bytes
  (`Content-Type: image/jpeg`), max 8MB. Used by the iOS Share Extension
  to upload a photo before capturing it (`image_url` in `POST
  /api/ingest/capture` needs a real URL; raw Share Sheet photos usually
  don't have one). Auth is `Authorization: Bearer <TASTE_IOS_KEY>` — its
  own secret, same reasoning as `TASTE_EXTENSION_KEY`. Response:
  `{url}`, served back by `GET /api/images/[key]` (public, no auth,
  streamed from the `taste-maker-images` R2 bucket, cached
  indefinitely — keys are UUIDs, never overwritten).
```

Then update the "Auth for..." line right after it — replace:

```markdown
Auth for `/api/ingest/highlight*`: `Authorization: Bearer <TASTE_INGEST_KEY>`
(Worker secret; host-side copy in `~/.config/taste/env`, shared with Reader
as `NUXT_TASTE_INGEST_KEY`). Auth for `/api/ingest/capture`:
`Authorization: Bearer <TASTE_EXTENSION_KEY>` (separate Worker secret, held
only by the Chrome extension). Both: 503 when the relevant secret is unset,
401 on mismatch. Reader's side of the highlight pipe (mirror-on-create,
undo-on-delete, backfill script) lives in the reader repo.
```

with:

```markdown
Auth for `/api/ingest/highlight*`: `Authorization: Bearer <TASTE_INGEST_KEY>`
(Worker secret; host-side copy in `~/.config/taste/env`, shared with Reader
as `NUXT_TASTE_INGEST_KEY`). Auth for `/api/ingest/capture`:
`Authorization: Bearer <TASTE_EXTENSION_KEY>` (separate Worker secret, held
only by the Chrome extension). Auth for `/api/ingest/capture-image`:
`Authorization: Bearer <TASTE_IOS_KEY>` (separate Worker secret, held only
by the iOS Share Extension). All three: 503 when the relevant secret is
unset, 401 on mismatch. Reader's side of the highlight pipe
(mirror-on-create, undo-on-delete, backfill script) lives in the reader
repo.
```

Then add a new section after "## Chrome extension (`extension/`)" and before "## The refine ritual":

```markdown
## iOS Share Extension (`ios/`)

A personal, unpublished Share Extension — build and run from Xcode onto
your own device. Captures from any app's Share Sheet without a browser
session, via `POST /api/ingest/capture` (see above) plus, for raw photo
shares, `POST /api/ingest/capture-image`.

- **Text selection shared from Safari** → `kind=quote`, body = selection,
  title/source URL from the page.
- **A link shared with no selection** → `kind=reference`.
- **An image shared with a URL attached** (e.g. long-press → Share on an
  image in Safari) → `kind=art`, `image_url` set directly, no upload.
- **A raw photo shared with no URL** (e.g. from the Photos app) →
  `kind=art`, the photo is downscaled on-device and uploaded via
  `POST /api/ingest/capture-image`, then captured with the returned URL.
- **Setup**: open the `TasteCapture` host app and paste the
  `TASTE_IOS_KEY` value (generated via `openssl rand -hex 32`, set on the
  Worker via `wrangler secret put TASTE_IOS_KEY`) — stored in the shared
  Keychain group, readable by the Share Extension.
```

- [ ] **Step 4: Commit**

```bash
git add server/api/images/\[key\].get.ts README.md
git commit -m "$(cat <<'EOF'
Add GET /api/images/[key], document the iOS ingest routes in README

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Xcode project scaffold

**Files:**
- Create: `ios/project.yml`
- Create: `ios/TasteCapture/TasteCaptureApp.swift`
- Create: `ios/TasteCapture/ContentView.swift`
- Create: `ios/TasteCaptureShare/ShareViewController.swift`
- Create: `ios/TasteCaptureKit/Package.swift`
- Create: `ios/TasteCaptureKit/Sources/TasteCaptureKit/Placeholder.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: the two app targets (`TasteCapture`, `TasteCaptureShare`) and the `TasteCaptureKit` package, wired together, buildable for Simulator. Task 5+ replace the placeholder files.

**Important — verified empirically while writing this plan:** `xcodegen generate` **overwrites** whatever file sits at a target's `info.path`/`entitlements.path` with its own auto-generated plist, every time it runs — it does not treat a pre-existing hand-authored plist as input to preserve. Hand-writing `Info.plist`/`.entitlements` XML files and pointing `info.path`/`entitlements.path` at them (as an earlier draft of this plan did) silently loses all their content (NSExtension config, App Group, URL scheme — everything) on the very first `xcodegen generate`. The fix, used throughout this task: express all Info.plist/entitlements content as `properties:` blocks directly in `project.yml`; never hand-author those XML files. **Never edit the generated `Info.plist`/`.entitlements` files directly — edit `project.yml` and regenerate.**

- [ ] **Step 1: Write the xcodegen spec**

Create `ios/project.yml`:

```yaml
name: TasteCapture
options:
  bundleIdPrefix: no.phareim
  deploymentTarget:
    iOS: "17.0"
settings:
  base:
    CODE_SIGN_STYLE: Automatic
    # Fill in your Apple Developer Team ID here before Task 10's on-device
    # build. Every build step before Task 10 overrides signing off via
    # xcodebuild flags, so this stays blank until then.
    DEVELOPMENT_TEAM: ""
packages:
  TasteCaptureKit:
    path: TasteCaptureKit
targets:
  TasteCapture:
    type: application
    platform: iOS
    sources:
      - TasteCapture
    info:
      path: TasteCapture/Info.plist
      properties:
        CFBundleDisplayName: Taste Capture
        UILaunchScreen: {}
        UIApplicationSceneManifest:
          UIApplicationSupportsMultipleScenes: false
        CFBundleURLTypes:
          - CFBundleURLName: no.phareim.tastecapture
            CFBundleURLSchemes: [tastecapture]
    entitlements:
      path: TasteCapture/TasteCapture.entitlements
      properties:
        com.apple.security.application-groups:
          - group.no.phareim.tastecapture
        keychain-access-groups:
          - $(AppIdentifierPrefix)no.phareim.tastecapture.shared
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: no.phareim.tastecapture
        TARGETED_DEVICE_FAMILY: "1"
    dependencies:
      - target: TasteCaptureShare
        embed: true
      - package: TasteCaptureKit
  TasteCaptureShare:
    type: app-extension
    platform: iOS
    sources:
      - TasteCaptureShare
    info:
      path: TasteCaptureShare/Info.plist
      properties:
        CFBundleDisplayName: Taste Capture
        NSExtension:
          NSExtensionPointIdentifier: com.apple.share-services
          NSExtensionPrincipalClass: $(PRODUCT_MODULE_NAME).ShareViewController
          NSExtensionAttributes:
            NSExtensionActivationRule:
              NSExtensionActivationSupportsText: true
              NSExtensionActivationSupportsWebURLWithMaxCount: 1
              NSExtensionActivationSupportsWebPageWithMaxCount: 1
              NSExtensionActivationSupportsImageWithMaxCount: 1
    entitlements:
      path: TasteCaptureShare/TasteCaptureShare.entitlements
      properties:
        com.apple.security.application-groups:
          - group.no.phareim.tastecapture
        keychain-access-groups:
          - $(AppIdentifierPrefix)no.phareim.tastecapture.shared
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: no.phareim.tastecapture.share
        TARGETED_DEVICE_FAMILY: "1"
    dependencies:
      - package: TasteCaptureKit
```

(`NSExtensionJavaScriptPreprocessingFile` is added under `NSExtensionAttributes` in Task 8, alongside the JS file itself — leaving it out here means Safari page-context extraction isn't wired yet, but text/URL/image attachment handling already is once Task 8 lands.)

- [ ] **Step 2: Write placeholder host app sources**

Create `ios/TasteCapture/TasteCaptureApp.swift`:

```swift
import SwiftUI

@main
struct TasteCaptureApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

Create `ios/TasteCapture/ContentView.swift` (Task 7 replaces this):

```swift
import SwiftUI

struct ContentView: View {
    var body: some View {
        Text("Settings land in Task 7.")
            .padding()
    }
}
```

- [ ] **Step 3: Write a placeholder Share Extension source**

Create `ios/TasteCaptureShare/ShareViewController.swift` (Task 8 replaces this):

```swift
import UIKit

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        // Capture UI lands in Task 8.
        extensionContext?.completeRequest(returningItems: nil)
    }
}
```

- [ ] **Step 4: Write the TasteCaptureKit package skeleton**

Create `ios/TasteCaptureKit/Package.swift`:

```swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TasteCaptureKit",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "TasteCaptureKit", targets: ["TasteCaptureKit"])
    ],
    targets: [
        .target(name: "TasteCaptureKit"),
        .testTarget(name: "TasteCaptureKitTests", dependencies: ["TasteCaptureKit"]),
    ]
)
```

The `.macOS(.v13)` floor is required even though this package only ships on iOS:
`swift test` runs the test host on macOS, and without an explicit macOS
platform, SwiftPM defaults it low enough that `URLSession`'s async
`data(for:)` (used by `CaptureClient`, Task 5) isn't available, causing a
"only available in macOS 12.0 or newer" compile error in the test target.

Create `ios/TasteCaptureKit/Sources/TasteCaptureKit/Placeholder.swift` (Task 5 replaces this):

```swift
// CapturePayload and CaptureClient land in Task 5.
```

- [ ] **Step 5: Generate the Xcode project**

Run: `cd ios && xcodegen generate`
Expected: `Created project at TasteCapture.xcodeproj`, exit 0. A `TasteCapture.xcodeproj` now exists in `ios/`.

- [ ] **Step 6: Build both targets for Simulator**

Run:

```bash
cd ios && xcodebuild -project TasteCapture.xcodeproj -scheme TasteCapture \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

Expected: `** BUILD SUCCEEDED **`, exit 0.

Then:

```bash
xcodebuild -project TasteCapture.xcodeproj -scheme TasteCaptureShare \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

Expected: `** BUILD SUCCEEDED **`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add ios/
git commit -m "$(cat <<'EOF'
Scaffold the iOS Share Extension project via xcodegen

Three targets: TasteCapture (host app), TasteCaptureShare (share
extension), TasteCaptureKit (shared package). App Group and
keychain-access-group entitlements wired on both app targets.
Placeholder sources build cleanly for Simulator; real logic lands in
the following tasks.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `TasteCaptureKit` — `CapturePayload` + `CaptureClient` (TDD)

**Files:**
- Modify: `ios/TasteCaptureKit/Sources/TasteCaptureKit/Placeholder.swift` → delete, replaced by the files below
- Create: `ios/TasteCaptureKit/Sources/TasteCaptureKit/CapturePayload.swift`
- Create: `ios/TasteCaptureKit/Sources/TasteCaptureKit/CaptureClient.swift`
- Create: `ios/TasteCaptureKit/Tests/TasteCaptureKitTests/CaptureClientTests.swift`
- Create: `ios/TasteCaptureKit/Tests/TasteCaptureKitTests/MockURLProtocol.swift`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CapturePayload` (Encodable struct: `kind, body, title?, sourceURL?, creator?, note?, imageURL?`), `CaptureResponse`, `ImageUploadResponse`, `CaptureError` enum (`.missingKey, .unauthorized, .badRequest, .imageTooLarge, .server(Int), .network`), `CaptureClient.capture(_:key:) async throws -> CaptureResponse`, `CaptureClient.uploadImage(_:key:) async throws -> String`. Task 8 and Task 9 (iOS) consume all of these.

- [ ] **Step 1: Delete the placeholder**

Run: `rm ios/TasteCaptureKit/Sources/TasteCaptureKit/Placeholder.swift`

- [ ] **Step 2: Write the failing test**

Create `ios/TasteCaptureKit/Tests/TasteCaptureKitTests/MockURLProtocol.swift`:

```swift
import Foundation

final class MockURLProtocol: URLProtocol {
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = MockURLProtocol.requestHandler else {
            fatalError("MockURLProtocol.requestHandler not set")
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: config)
    }
}
```

Create `ios/TasteCaptureKit/Tests/TasteCaptureKitTests/CaptureClientTests.swift`:

```swift
import XCTest
@testable import TasteCaptureKit

final class CaptureClientTests: XCTestCase {
    func testCaptureSendsBearerHeaderAndDecodesResponse() async throws {
        MockURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/api/ingest/capture")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-key")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let body = #"{"id":"abc123","kind":"quote"}"#.data(using: .utf8)!
            return (response, body)
        }

        let client = CaptureClient(session: MockURLProtocol.makeSession())
        let payload = CapturePayload(kind: "quote", body: "hello", sourceURL: "https://example.com")
        let result = try await client.capture(payload, key: "test-key")

        XCTAssertEqual(result.id, "abc123")
        XCTAssertEqual(result.kind, "quote")
    }

    func testCaptureThrowsUnauthorizedOn401() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!
            return (response, Data())
        }

        let client = CaptureClient(session: MockURLProtocol.makeSession())
        let payload = CapturePayload(kind: "quote", body: "hello")

        do {
            _ = try await client.capture(payload, key: "wrong-key")
            XCTFail("expected CaptureError.unauthorized")
        } catch CaptureError.unauthorized {
            // expected
        }
    }

    func testUploadImageSendsJPEGContentTypeAndReturnsURL() async throws {
        MockURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/api/ingest/capture-image")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "image/jpeg")
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let body = #"{"url":"https://taste.phareim.no/api/images/abc.jpg"}"#.data(using: .utf8)!
            return (response, body)
        }

        let client = CaptureClient(session: MockURLProtocol.makeSession())
        let url = try await client.uploadImage(Data([0xFF, 0xD8, 0xFF]), key: "test-key")

        XCTAssertEqual(url, "https://taste.phareim.no/api/images/abc.jpg")
    }

    func testUploadImageThrowsImageTooLargeOn413() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 413, httpVersion: nil, headerFields: nil)!
            return (response, Data())
        }

        let client = CaptureClient(session: MockURLProtocol.makeSession())

        do {
            _ = try await client.uploadImage(Data(), key: "test-key")
            XCTFail("expected CaptureError.imageTooLarge")
        } catch CaptureError.imageTooLarge {
            // expected
        }
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd ios/TasteCaptureKit && swift test`
Expected: FAIL — `CapturePayload`, `CaptureClient`, `CaptureError` don't exist yet.

- [ ] **Step 4: Write `CapturePayload.swift`**

Create `ios/TasteCaptureKit/Sources/TasteCaptureKit/CapturePayload.swift`:

```swift
import Foundation

public struct CapturePayload: Encodable {
    public var kind: String
    public var body: String
    public var title: String?
    public var sourceURL: String?
    public var creator: String?
    public var note: String?
    public var imageURL: String?

    public init(
        kind: String,
        body: String,
        title: String? = nil,
        sourceURL: String? = nil,
        creator: String? = nil,
        note: String? = nil,
        imageURL: String? = nil
    ) {
        self.kind = kind
        self.body = body
        self.title = title
        self.sourceURL = sourceURL
        self.creator = creator
        self.note = note
        self.imageURL = imageURL
    }

    enum CodingKeys: String, CodingKey {
        case kind, body, title
        case sourceURL = "source_url"
        case creator, note
        case imageURL = "image_url"
    }
}

public struct CaptureResponse: Decodable {
    public let id: String
    public let kind: String
}

public struct ImageUploadResponse: Decodable {
    public let url: String
}

public enum CaptureError: Error, Equatable {
    case missingKey
    case unauthorized
    case badRequest
    case imageTooLarge
    case server(Int)
    case network
}
```

- [ ] **Step 5: Write `CaptureClient.swift`**

Create `ios/TasteCaptureKit/Sources/TasteCaptureKit/CaptureClient.swift`:

```swift
import Foundation

public struct CaptureClient {
    public var baseURL: URL
    public var session: URLSession

    public init(baseURL: URL = URL(string: "https://taste.phareim.no")!, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func capture(_ payload: CapturePayload, key: String) async throws -> CaptureResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/ingest/capture"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        try Self.checkStatus(response)
        return try JSONDecoder().decode(CaptureResponse.self, from: data)
    }

    public func uploadImage(_ jpegData: Data, key: String) async throws -> String {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/ingest/capture-image"))
        request.httpMethod = "POST"
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.httpBody = jpegData

        let (data, response) = try await session.data(for: request)
        try Self.checkStatus(response)
        return try JSONDecoder().decode(ImageUploadResponse.self, from: data).url
    }

    private static func checkStatus(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw CaptureError.network }
        switch http.statusCode {
        case 200...299: return
        case 401: throw CaptureError.unauthorized
        case 400: throw CaptureError.badRequest
        case 413: throw CaptureError.imageTooLarge
        default: throw CaptureError.server(http.statusCode)
        }
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd ios/TasteCaptureKit && swift test`
Expected: PASS, all 4 tests green.

- [ ] **Step 7: Commit**

```bash
git add ios/TasteCaptureKit/
git commit -m "$(cat <<'EOF'
Add CapturePayload and CaptureClient to TasteCaptureKit

TDD via a mock URLProtocol — verifies request shape (Bearer header,
JSON vs. raw-JPEG bodies) and status-code-to-CaptureError mapping
without a real network call. Consumed by the Share Extension and
host app in later tasks.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `TasteCaptureKit` — `KeychainStore`

**Files:**
- Create: `ios/TasteCaptureKit/Sources/TasteCaptureKit/KeychainStore.swift`

**Interfaces:**
- Consumes: nothing new.
- Produces: `KeychainStore(service:)`, `.save(_ value: String)`, `.load() -> String?`, `.clear()`. Task 7 (host app) and Task 8 (share extension) both consume this — it's how the ingest key crosses the host-app/extension process boundary.

- [ ] **Step 1: Write `KeychainStore.swift`**

Create `ios/TasteCaptureKit/Sources/TasteCaptureKit/KeychainStore.swift`:

```swift
import Foundation
import Security

/// Reads/writes the ingest key without specifying `kSecAttrAccessGroup`.
/// Both the host app and the Share Extension are entitled with exactly one
/// keychain-access-group (see their .entitlements files); when a process
/// has only one, Keychain Services uses it automatically, which is what
/// lets the key cross the host-app/extension process boundary without
/// hardcoding the `$(AppIdentifierPrefix)`-qualified group name in Swift
/// (that substitution only applies inside .entitlements/.plist files).
public struct KeychainStore {
    public var service: String

    public init(service: String = "no.phareim.tastecapture.ingestKey") {
        self.service = service
    }

    public func save(_ value: String) {
        let data = Data(value.utf8)
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        SecItemAdd(query as CFDictionary, nil)
    }

    public func load() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

Not covered by `swift test`: a bare SPM test binary isn't code-signed with a keychain-access-group entitlement, so `SecItemAdd`/`SecItemCopyMatching` would fail there regardless of this code's correctness. Verified manually in Task 10 instead (save in the host app, read from the extension).

- [ ] **Step 2: Build the package**

Run: `cd ios/TasteCaptureKit && swift build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add ios/TasteCaptureKit/Sources/TasteCaptureKit/KeychainStore.swift
git commit -m "$(cat <<'EOF'
Add KeychainStore to TasteCaptureKit

No explicit access-group string in Swift — relies on each process
having exactly one keychain-access-group entitled (set in the two
targets' .entitlements files), which Keychain Services uses
automatically. Verified manually in Task 10 (Keychain access groups
aren't available to a bare `swift test` binary).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Host app — settings screen

**Files:**
- Modify: `ios/TasteCapture/ContentView.swift` (placeholder from Task 4)

**Interfaces:**
- Consumes: `KeychainStore` from Task 6.
- Produces: nothing new consumed by later tasks (Task 8/9 use `KeychainStore` directly, not this view).

- [ ] **Step 1: Write the settings screen**

Replace `ios/TasteCapture/ContentView.swift`:

```swift
import SwiftUI
import TasteCaptureKit

struct ContentView: View {
    @State private var key: String = ""
    @State private var savedHint = false

    private let keychain = KeychainStore()

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Ingest key"), footer: Text("Paste the TASTE_IOS_KEY value here. The Share Extension reads it from the shared Keychain group.")) {
                    SecureField("TASTE_IOS_KEY", text: $key)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                    Button("Save") {
                        keychain.save(key)
                        savedHint = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                            savedHint = false
                        }
                    }
                    if savedHint {
                        Text("Saved.").foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Taste Capture")
            .onAppear { key = keychain.load() ?? "" }
        }
    }
}
```

- [ ] **Step 2: Regenerate and build for Simulator**

Run:

```bash
cd ios && xcodegen generate && xcodebuild -project TasteCapture.xcodeproj -scheme TasteCapture \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Manual verification in Simulator**

In Xcode, select an iOS Simulator destination, Run the `TasteCapture` scheme. Paste any placeholder string into the field, tap Save, confirm "Saved." flashes, quit and relaunch the app in the simulator, confirm the field still shows the pasted value.

- [ ] **Step 4: Commit**

```bash
git add ios/TasteCapture/ContentView.swift ios/TasteCapture.xcodeproj
git commit -m "$(cat <<'EOF'
Host app: settings screen for the ingest key

Single field over KeychainStore, mirroring the Chrome extension's
options page. This is the only screen the host app has.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Share Extension — activation, prefill, UI, basic submit

**Files:**
- Modify: `ios/project.yml` (add JS preprocessing config to the generated Info.plist's properties)
- Create: `ios/TasteCaptureShare/SharePreprocessor.js`
- Create: `ios/TasteCaptureShare/CaptureViewModel.swift`
- Create: `ios/TasteCaptureShare/CaptureView.swift`
- Modify: `ios/TasteCaptureShare/ShareViewController.swift` (placeholder from Task 4)

**Interfaces:**
- Consumes: `CapturePayload`, `CaptureClient`, `CaptureError`, `KeychainStore` from Tasks 5–6.
- Produces: `CaptureViewModel` (`@Published kind, title, body, sourceURL, imageURL, creator, note, statusMessage, statusIsError, isSubmitting`; `loadSharedContent() async`, `submit() async`, `openSettings()`, `cancel()`) — Task 9 extends `submit()` with the photo-upload path. `CaptureView(viewModel:)` — the SwiftUI form, unchanged by Task 9.

This task covers the quote/reference/art-with-URL paths end-to-end (submit already works for these — no image upload is needed for them). The art-without-URL (raw photo) path is wired in Task 9, which extends `submit()`.

- [ ] **Step 1: Add the JS preprocessing file**

Create `ios/TasteCaptureShare/SharePreprocessor.js`:

```js
var Preprocessor = function () {};

Preprocessor.prototype = {
    run: function (arguments) {
        var selection = window.getSelection ? window.getSelection().toString() : "";
        arguments.completionFunction({
            title: document.title,
            url: document.URL,
            selection: selection,
        });
    },
};

var ExtensionPreprocessingJS = new Preprocessor();
```

- [ ] **Step 2: Wire it into the generated Info.plist via `project.yml`**

`xcodegen generate` overwrites `ios/TasteCaptureShare/Info.plist` from `project.yml`'s `properties:` block every run (see Task 4's note) — so the JS preprocessing key is added there, not by editing the generated plist directly. In `ios/project.yml`, under the `TasteCaptureShare` target's `info.properties.NSExtension.NSExtensionAttributes`, add `NSExtensionJavaScriptPreprocessingFile` as a sibling of `NSExtensionActivationRule`:

```yaml
          NSExtensionAttributes:
            NSExtensionActivationRule:
              NSExtensionActivationSupportsText: true
              NSExtensionActivationSupportsWebURLWithMaxCount: 1
              NSExtensionActivationSupportsWebPageWithMaxCount: 1
              NSExtensionActivationSupportsImageWithMaxCount: 1
            NSExtensionJavaScriptPreprocessingFile: SharePreprocessor
```

Then regenerate: `cd ios && xcodegen generate`. `SharePreprocessor.js` living directly in the `TasteCaptureShare/` sources folder is picked up by xcodegen as a bundle resource automatically (verified: it lands at the top level of the built `.appex`, which is where `NSExtensionJavaScriptPreprocessingFile: SharePreprocessor` expects to find it) — no separate resources list needed.

- [ ] **Step 3: Write `CaptureViewModel.swift`**

Create `ios/TasteCaptureShare/CaptureViewModel.swift`:

```swift
import Foundation
import UIKit
import UniformTypeIdentifiers
import TasteCaptureKit

@MainActor
final class CaptureViewModel: ObservableObject {
    @Published var kind: String = "quote"
    @Published var title: String = ""
    @Published var body: String = ""
    @Published var sourceURL: String = ""
    @Published var imageURL: String = ""
    @Published var creator: String = ""
    @Published var note: String = ""
    @Published var statusMessage: String?
    @Published var statusIsError: Bool = false
    @Published var isSubmitting: Bool = false

    var pendingImage: UIImage?

    private weak var extensionContext: NSExtensionContext?
    private let keychain = KeychainStore()
    private let client = CaptureClient()

    init(extensionContext: NSExtensionContext?) {
        self.extensionContext = extensionContext
    }

    func loadSharedContent() async {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let providers = item.attachments else { return }

        var foundText = ""
        var foundURL: String?
        var foundImage: UIImage?

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
               let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                foundText = text
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
               let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                foundURL = url.absoluteString
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
               let loaded = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier) {
                if let url = loaded as? URL, let data = try? Data(contentsOf: url) {
                    foundImage = UIImage(data: data)
                } else if let uiImage = loaded as? UIImage {
                    foundImage = uiImage
                } else if let data = loaded as? Data {
                    foundImage = UIImage(data: data)
                }
            }
        }

        applyPreprocessingResults(from: item)

        if let foundImage {
            pendingImage = foundImage
            kind = "art"
            if let foundURL { imageURL = foundURL }
        } else if !foundText.isEmpty {
            kind = "quote"
            body = foundText
            if let foundURL { sourceURL = foundURL }
        } else if let foundURL {
            kind = "reference"
            sourceURL = foundURL
        }
    }

    private func applyPreprocessingResults(from item: NSExtensionItem) {
        guard let results = item.userInfo?[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any] else { return }
        if let pageTitle = results["title"] as? String, !pageTitle.isEmpty { title = pageTitle }
        if let pageURL = results["url"] as? String, !pageURL.isEmpty, sourceURL.isEmpty { sourceURL = pageURL }
        if let selection = results["selection"] as? String, !selection.isEmpty {
            kind = "quote"
            body = selection
        }
    }

    func submit() async {
        let trimmedBody = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedBody.isEmpty else { return }
        guard let key = keychain.load() else {
            statusMessage = "No ingest key set — tap to open the app."
            statusIsError = true
            return
        }

        isSubmitting = true
        statusMessage = nil
        defer { isSubmitting = false }

        do {
            let payload = CapturePayload(
                kind: kind,
                body: trimmedBody,
                title: title.isEmpty ? nil : title,
                sourceURL: sourceURL.isEmpty ? nil : sourceURL,
                creator: creator.isEmpty ? nil : creator,
                note: note.isEmpty ? nil : note,
                imageURL: imageURL.isEmpty ? nil : imageURL
            )
            _ = try await client.capture(payload, key: key)
            extensionContext?.completeRequest(returningItems: nil)
        } catch CaptureError.unauthorized {
            statusMessage = "Key rejected — check it in the app."
            statusIsError = true
        } catch CaptureError.badRequest {
            statusMessage = "Could not save the item."
            statusIsError = true
        } catch {
            statusMessage = "Network error — could not reach taste-maker."
            statusIsError = true
        }
    }

    func openSettings() {
        if let url = URL(string: "tastecapture://settings") {
            extensionContext?.open(url, completionHandler: nil)
        }
    }

    func cancel() {
        extensionContext?.cancelRequest(withError: NSError(domain: "TasteCaptureShare", code: 0))
    }
}
```

(`submit()` doesn't yet handle `pendingImage` when no `imageURL` is set — that's Task 9. Sharing an image-with-URL already works via this version since `imageURL` gets prefilled directly.)

- [ ] **Step 4: Write `CaptureView.swift`**

Create `ios/TasteCaptureShare/CaptureView.swift`:

```swift
import SwiftUI

struct CaptureView: View {
    @ObservedObject var viewModel: CaptureViewModel

    private let kinds = ["quote", "reference", "music", "art"]

    var body: some View {
        NavigationView {
            Form {
                Section {
                    Picker("Kind", selection: $viewModel.kind) {
                        ForEach(kinds, id: \.self) { kind in
                            Text(kind.capitalized).tag(kind)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    TextField("Title", text: $viewModel.title)
                    TextField(viewModel.kind == "art" ? "Description" : "Body", text: $viewModel.body, axis: .vertical)
                        .lineLimit(4...8)
                    if viewModel.kind == "art" {
                        TextField("Image URL", text: $viewModel.imageURL)
                            .keyboardType(.URL)
                            .autocapitalization(.none)
                    }
                    TextField("Source URL", text: $viewModel.sourceURL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                    TextField("Creator", text: $viewModel.creator)
                    TextField("Note", text: $viewModel.note, axis: .vertical)
                        .lineLimit(2...4)
                }

                if let statusMessage = viewModel.statusMessage {
                    Section {
                        Button(action: { viewModel.openSettings() }) {
                            Text(statusMessage)
                                .foregroundColor(viewModel.statusIsError ? .red : .primary)
                        }
                    }
                }
            }
            .navigationTitle("Capture")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { viewModel.cancel() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(viewModel.isSubmitting ? "Capturing…" : "Capture") {
                        Task { await viewModel.submit() }
                    }
                    .disabled(viewModel.isSubmitting)
                }
            }
        }
    }
}
```

- [ ] **Step 5: Wire `ShareViewController`**

Replace `ios/TasteCaptureShare/ShareViewController.swift`:

```swift
import UIKit
import SwiftUI

final class ShareViewController: UIViewController {
    private var viewModel: CaptureViewModel!

    override func viewDidLoad() {
        super.viewDidLoad()
        viewModel = CaptureViewModel(extensionContext: extensionContext)

        let hosting = UIHostingController(rootView: CaptureView(viewModel: viewModel))
        addChild(hosting)
        hosting.view.frame = view.bounds
        hosting.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(hosting.view)
        hosting.didMove(toParent: self)

        Task {
            await viewModel.loadSharedContent()
        }
    }
}
```

- [ ] **Step 6: Regenerate and build for Simulator**

Run:

```bash
cd ios && xcodegen generate && xcodebuild -project TasteCapture.xcodeproj -scheme TasteCaptureShare \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 7: Manual verification in Simulator**

Run the `TasteCapture` scheme on a Simulator (installs both the host app and the extension). Open Safari in the Simulator, select some text on any page, tap Share, choose "Taste Capture" from the share sheet.
Expected: the Capture form opens with Quote selected, body containing the selected text, title/source URL from the page. Repeat with no selection (expect Reference) and by long-pressing a Safari image with a link and choosing Share → confirm Art with `Image URL` prefilled.

- [ ] **Step 8: Commit**

```bash
git add ios/TasteCaptureShare/ ios/TasteCapture.xcodeproj
git commit -m "$(cat <<'EOF'
Share Extension: activation rules, prefill, capture UI, basic submit

Covers quote (selection), reference (link, no selection), and
art-with-URL (image share that already carries a src URL) end to
end. Raw-photo art capture (no URL, needs upload) lands in Task 9.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Share Extension — raw photo upload path

**Files:**
- Modify: `ios/TasteCaptureShare/CaptureViewModel.swift`

**Interfaces:**
- Consumes: `CaptureClient.uploadImage(_:key:)` from Task 5, `pendingImage` (already stored on `CaptureViewModel` since Task 8).
- Produces: nothing new — this completes `submit()`.

- [ ] **Step 1: Extend `submit()` to upload `pendingImage` when no URL is set**

In `ios/TasteCaptureShare/CaptureViewModel.swift`, replace the `do { ... }` block inside `submit()`:

```swift
        do {
            let payload = CapturePayload(
                kind: kind,
                body: trimmedBody,
                title: title.isEmpty ? nil : title,
                sourceURL: sourceURL.isEmpty ? nil : sourceURL,
                creator: creator.isEmpty ? nil : creator,
                note: note.isEmpty ? nil : note,
                imageURL: imageURL.isEmpty ? nil : imageURL
            )
            _ = try await client.capture(payload, key: key)
            extensionContext?.completeRequest(returningItems: nil)
        } catch CaptureError.unauthorized {
            statusMessage = "Key rejected — check it in the app."
            statusIsError = true
        } catch CaptureError.badRequest {
            statusMessage = "Could not save the item."
            statusIsError = true
        } catch {
            statusMessage = "Network error — could not reach taste-maker."
            statusIsError = true
        }
```

with:

```swift
        do {
            var finalImageURL = imageURL.isEmpty ? nil : imageURL
            if finalImageURL == nil, let pendingImage {
                let jpegData = Self.downscale(pendingImage)
                finalImageURL = try await client.uploadImage(jpegData, key: key)
            }

            let payload = CapturePayload(
                kind: kind,
                body: trimmedBody,
                title: title.isEmpty ? nil : title,
                sourceURL: sourceURL.isEmpty ? nil : sourceURL,
                creator: creator.isEmpty ? nil : creator,
                note: note.isEmpty ? nil : note,
                imageURL: finalImageURL
            )
            _ = try await client.capture(payload, key: key)
            extensionContext?.completeRequest(returningItems: nil)
        } catch CaptureError.unauthorized {
            statusMessage = "Key rejected — check it in the app."
            statusIsError = true
        } catch CaptureError.imageTooLarge {
            statusMessage = "Image too large."
            statusIsError = true
        } catch CaptureError.badRequest {
            statusMessage = "Could not save the item."
            statusIsError = true
        } catch {
            statusMessage = "Network error — could not reach taste-maker."
            statusIsError = true
        }
```

Then add the downscale helper as a new method on `CaptureViewModel` (below `cancel()`):

```swift
    private static func downscale(_ image: UIImage) -> Data {
        let maxDimension: CGFloat = 1600
        let scale = min(1, maxDimension / max(image.size.width, image.size.height))
        let newSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: newSize)) }
        return resized.jpegData(compressionQuality: 0.8) ?? Data()
    }
```

- [ ] **Step 2: Regenerate and build for Simulator**

Run:

```bash
cd ios && xcodegen generate && xcodebuild -project TasteCapture.xcodeproj -scheme TasteCaptureShare \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Commit**

```bash
git add ios/TasteCaptureShare/CaptureViewModel.swift
git commit -m "$(cat <<'EOF'
Share Extension: raw photo downscale + upload path

Completes the art-capture flow for shares with no URL (e.g. from the
Photos app): downscale to 1600px/JPEG 0.8 client-side, upload via
capture-image, then capture with the returned URL. Live end-to-end
verification (real key, real upload) happens in Task 10.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Deploy the backend, create the R2 bucket, on-device build, end-to-end verification

**Files:**
- Modify: `ios/project.yml` (fill in `DEVELOPMENT_TEAM`)

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces: nothing further (terminal task).

This task pushes to `main`, creates a production R2 bucket, sets a real secret on the production Worker, and signs/installs a real app onto your device. **All are production-affecting or account-specific — confirm with the user before each irreversible step**, per this session's standing git/deploy safety rules, even though the plan lists them in sequence.

- [ ] **Step 1: Generate the real secret**

Run: `openssl rand -hex 32`
Save the output somewhere durable (e.g. `~/.config/taste/env`, matching the existing `TASTE_INGEST_KEY`/`TASTE_EXTENSION_KEY` convention) — never committed to git.

- [ ] **Step 2: Confirm with the user, then push to `main`**

After explicit user go-ahead:

```bash
git push
```

Expected: GitHub Actions runs build + `wrangler deploy` (`.github/workflows/deploy.yml`). Wait for it to succeed (`gh run watch`) before continuing — the new routes and R2 binding won't exist on the remote Worker until this completes.

- [ ] **Step 3: Confirm with the user, then create the R2 bucket and set the secret**

```bash
npx wrangler r2 bucket create taste-maker-images
npx wrangler secret put TASTE_IOS_KEY
```

Paste the value from Step 1 when prompted for the secret.

- [ ] **Step 4: Verify the unauthenticated and wrong-key paths**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://taste.phareim.no/api/ingest/capture-image \
  -H "Content-Type: image/jpeg" --data-binary "not-a-real-image"
```
Expected: `401` (no `Authorization` header).

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://taste.phareim.no/api/ingest/capture-image \
  -H "Authorization: Bearer wrong-key" -H "Content-Type: image/jpeg" --data-binary "not-a-real-image"
```
Expected: `401`.

- [ ] **Step 5: Verify a real image upload and fetch it back**

```bash
curl -s -X POST https://taste.phareim.no/api/ingest/capture-image \
  -H "Authorization: Bearer <the real key from Step 1>" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/any/local/test.jpg
```
Expected: JSON `{"url":"https://taste.phareim.no/api/images/<uuid>.jpg"}`. Then:

```bash
curl -sI https://taste.phareim.no/api/images/<uuid>.jpg
```
Expected: `200`, `content-type: image/jpeg`.

- [ ] **Step 6: Fill in your Apple Developer Team ID**

In `ios/project.yml`, set `DEVELOPMENT_TEAM` under `settings.base` to your Team ID (find it at developer.apple.com → Membership, or in Xcode → Settings → Accounts). Run `cd ios && xcodegen generate` to regenerate the project with it.

- [ ] **Step 7: Confirm with the user, then build and install on-device**

In Xcode, open `ios/TasteCapture.xcodeproj`, select your physical device as the run destination, select the `TasteCapture` scheme, and Run. Trust the developer certificate on-device if prompted (Settings → General → VPN & Device Management), since this is your own paid Apple Developer account this doesn't expire in 7 days like free personal-team signing would.

- [ ] **Step 8: Paste the real key and do a full manual pass on-device**

Open the `TasteCapture` app, paste the real key from Step 1, tap Save. Then exercise every path from a real device:
- Select text in Safari → Share → Taste Capture → confirm `kind=quote` prefilled correctly → submit → confirm the item appears in the library.
- Share a link with no selection → confirm `kind=reference` → submit.
- Long-press an image in Safari with a link → Share → confirm `kind=art` with `Image URL` prefilled, no upload → submit.
- Share a photo from the Photos app → confirm `kind=art`, photo uploads, item created with a working `image_url` that renders in the library.
- Clear the key in the host app → attempt a capture → confirm the "no key" prompt appears and deep-links back to the host app.
- Set an intentionally wrong key → confirm the "check your key" message, distinguished from a generic failure.

- [ ] **Step 9: Commit the team ID change**

```bash
git add ios/project.yml
git commit -m "$(cat <<'EOF'
ios: pin DEVELOPMENT_TEAM for on-device signing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Confirm with the user before pushing this final commit too.
