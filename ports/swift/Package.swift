// swift-tools-version: 5.9
// The Swift port of i18n-keyless: protocol v3, zero dependencies (Foundation only).
import PackageDescription

let package = Package(
    name: "I18nKeyless",
    platforms: [
        .iOS(.v15), .macOS(.v12), .tvOS(.v15), .watchOS(.v8), .visionOS(.v1),
    ],
    products: [
        .library(name: "I18nKeyless", targets: ["I18nKeyless"]),
    ],
    targets: [
        .target(name: "I18nKeyless"),
        .testTarget(name: "I18nKeylessTests", dependencies: ["I18nKeyless"]),
    ],
    swiftLanguageVersions: [.v5]
)
