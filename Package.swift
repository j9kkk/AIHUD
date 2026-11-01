// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AIHUD",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "AIHUD", targets: ["AIHUD"]),
        // 开发工具：真实数据垂直切片（命令行登录 + 取数 + 桌面组件），不随 App 发布
        .executable(name: "AIHUDSlice", targets: ["AIHUDSlice"]),
    ],
    targets: [
        // 数据层：模型、三渠道取数、凭据与本地存储
        .target(name: "HUDCore", path: "Sources/HUDCore"),
        // 面板外壳与绘制层：窗口锚定、阴影、高度动画、样式令牌
        .target(name: "HUDKit", dependencies: ["HUDCore"], path: "Sources/HUDKit",
                linkerSettings: [.linkedFramework("AppKit")]),
        // 交付目标：菜单栏 App
        .executableTarget(name: "AIHUD", dependencies: ["HUDKit", "HUDCore"], path: "Sources/AIHUD"),
        // 切片：刻意不分层、不复用 HUDCore，用来独立验证真实接口
        .executableTarget(name: "AIHUDSlice", path: "Sources/AIHUDSlice",
                          linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("Network")]),
    ]
)
