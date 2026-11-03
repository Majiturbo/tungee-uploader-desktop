// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "TungeeUploader",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(
      name: "TungeeUploader",
      path: "Sources/TungeeUploader",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
  ]
)
