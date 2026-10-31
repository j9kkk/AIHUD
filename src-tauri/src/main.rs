// AI HUD — 二进制入口。真正的装配在 lib.rs（便于在 macOS 上做集成测试）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ai_hud_lib::run();
}

