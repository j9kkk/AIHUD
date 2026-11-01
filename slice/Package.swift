// swift-tools-version:5.9
// 垂直切片 V0（docs/reboot/SPEC.md §8）：真实 API → 桌面组件 → 手动刷新。刻意不分层。
import PackageDescription

let package = Package(
    name: "AIHUDSlice",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "AIHUDSlice",
            path: "Sources/AIHUDSlice",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("Network"),
            ]
        ),
    ]
)
