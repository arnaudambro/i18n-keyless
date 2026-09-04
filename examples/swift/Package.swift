// swift-tools-version: 6.0
// The i18n-keyless Swift example. Two targets share one store setup (`AppCore`):
//   - `App`         a SwiftUI two-screen app (built as a library so it compiles headless);
//   - the CLI       runs the same store against the mock backend or the real service.
// It depends on the port by path, like every example in this repository.
import PackageDescription

let package = Package(
    name: "i18n-keyless-example",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "App", targets: ["App"]),
        .executable(name: "i18n-keyless-example-cli", targets: ["i18n-keyless-example-cli"]),
    ],
    dependencies: [
        .package(path: "i18n-keyless-swift"),
    ],
    targets: [
        .target(name: "App", dependencies: [.product(name: "I18nKeyless", package: "i18n-keyless-swift")]),
        .executableTarget(
            name: "i18n-keyless-example-cli",
            dependencies: [
                "App", .product(name: "I18nKeyless", package: "i18n-keyless-swift"),
            ]),
        .testTarget(name: "AppTests", dependencies: ["App"]),
    ]
)
