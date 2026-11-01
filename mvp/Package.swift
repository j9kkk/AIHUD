// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AIHUDMVP",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "MVPA", targets: ["MVPA"]),
        .executable(name: "MVPB", targets: ["MVPB"]),
        .executable(name: "MVPM", targets: ["MVPM"]),
    ],
    targets: [
        .target(name: "HUDCore", path: "Sources/HUDCore"),
        .target(name: "HUDKit", dependencies: ["HUDCore"], path: "Sources/HUDKit",
                linkerSettings: [.linkedFramework("AppKit")]),
        .executableTarget(name: "MVPA", dependencies: ["HUDKit", "HUDCore"], path: "Sources/MVPA"),
        .executableTarget(name: "MVPB", dependencies: ["HUDKit", "HUDCore"], path: "Sources/MVPB"),
        .executableTarget(name: "MVPM", dependencies: ["HUDKit", "HUDCore"], path: "Sources/MVPM"),
    ]
)
