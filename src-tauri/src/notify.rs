//! 通知：只发文字，正文长度 ≤120 且已脱敏（脱敏在 TS 侧完成）。

use anyhow::Result;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub fn post(app: &AppHandle, title: &str, body: &str) -> Result<bool> {
    let clipped: String = body.chars().take(120).collect();
    app.notification()
        .builder()
        .title(title)
        .body(clipped)
        .show()
        .map(|_| true)
        .map_err(|e| anyhow::anyhow!("通知发送失败: {e}"))
}

