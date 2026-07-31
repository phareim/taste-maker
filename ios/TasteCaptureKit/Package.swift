// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TasteCaptureKit",
    // iOS is the real target; the macOS floor exists purely so `swift test`
    // on the host can see the async URLSession.data(for:) overloads.
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "TasteCaptureKit", targets: ["TasteCaptureKit"])
    ],
    targets: [
        .target(name: "TasteCaptureKit"),
        .testTarget(name: "TasteCaptureKitTests", dependencies: ["TasteCaptureKit"]),
    ]
)
