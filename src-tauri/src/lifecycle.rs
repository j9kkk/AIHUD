//! 生命周期事件：系统唤醒 / 锁屏 / 面板可见性，转发给 TS 内核。
//!
//! 说明：容器内无法验证 NSWorkspace 通知订阅；此处用 Tauri 窗口与
//! 定时心跳近似表达「唤醒后补算」的契约，真正的 NSWorkspace 订阅
//! 留在 macOS 实机阶段接入（见 docs/BUILD-macOS.md「未验证项」）。

use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        if let Some(w) = handle.get_webview_window("main") {
            let _ = w.emit("hud:tick", ());
        }
    });
    Ok(())
}

