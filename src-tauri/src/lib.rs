//! AI HUD 壳层装配。
//!
//! 职责边界（见 docs/ARCHITECTURE.md §2 / §8）：
//! - 系统原语：状态栏托盘、无边框面板、面板定位与高度钳制；
//! - 密钥：Keychain 读写，明文永不出现在 IPC 返回值里；
//! - 网络出口：域名白名单 + header 禁写 + body 上限；
//! - 子进程：命令白名单（agy / gemini）；
//! - 存储：SQLite 只存快照与调度态，不存密钥；
//! - 通知：UNUserNotificationCenter 经 tauri-plugin-notification。
//!
//! 领域逻辑（解析、投影、熔断、调度）全部在 TypeScript 内核 core/ 中，
//! 本层不做任何渠道分支。

pub mod cli;
pub mod http;
pub mod ipc;
pub mod keychain;
pub mod lifecycle;
pub mod notify;
pub mod panel;
pub mod store;
pub mod tray;

use std::sync::Arc;
use tauri::Manager;

pub struct AppState {
    pub http: Arc<http::HttpClient>,
    pub store: Arc<store::Store>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // 存储：~/Library/Application Support/app.aihud.desktop/ai-hud.db
            let store = store::Store::open(&handle)?;
            let http = http::HttpClient::new()?;

            app.manage(AppState {
                http: Arc::new(http),
                store: Arc::new(store),
            });

            tray::install(app.handle())?;
            panel::install(app.handle())?;
            lifecycle::install(app.handle())?;

            // 面板默认隐藏，仅托盘常驻；内核就绪后由 core.tick 推送首帧。
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::credential_lease,
            ipc::credential_execute_refresh,
            ipc::credential_revoke,
            ipc::http_request,
            ipc::cli_run,
            ipc::store_load,
            ipc::store_save,
            ipc::tray_set_view,
            ipc::notify_post,
            ipc::panel_resize,
            ipc::panel_show,
            ipc::panel_hide,
            ipc::health_check,
        ])
        .run(tauri::generate_context!())
        .expect("AI HUD 启动失败");
}

