// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "MagicDAW",
    platforms: [
        .macOS(.v14)
    ],
    targets: [
        .executableTarget(
            name: "MagicDAW",
            path: "MagicDAW",
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreMIDI"),
                .linkedFramework("WebKit"),
                .linkedFramework("Accelerate"),
                .linkedFramework("AppKit"),
            ]
        )
    ]
)
