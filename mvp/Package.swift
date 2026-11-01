// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AIHUD",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "AIHUD", targets: ["AIHUD"]),
    ],
    targets: [
        // 数据层：模型、三渠道取数、凭据与本地存储
        .target(name: "HUDCore", path: "Sources/HUDCore"),
        // 面板外壳与绘制层：窗口锚定、阴影、高度动画、样式令牌
        .target(name: "HUDKit", dependencies: ["HUDCore"], path: "Sources/HUDKit",
                linkerSettings: [.linkedFramework("AppKit")]),
        // 唯一的交付目标：菜单栏 App
        .executableTarget(name: "AIHUD", dependencies: ["HUDKit", "HUDCore"], path: "Sources/AIHUD"),
    ]
)
