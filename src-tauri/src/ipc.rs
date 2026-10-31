//! IPC 命令面（与 docs/ARCHITECTURE.md §8.4 逐条对应）。
//!
//! 安全约束：命令入参在 Rust 侧二次校验，不信任前端；
//! 返回值里永不出现 key / token / cookie 明文。

use crate::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl From<anyhow::Error> for CommandError {
    fn from(e: anyhow::Error) -> Self {
        Self { code: "shell_error".into(), message: e.to_string() }
    }
}

type R<T> = Result<T, CommandError>;

#[tauri::command]
pub fn health_check() -> &'static str {
    "ok"
}

/// credential.lease → 只返回不透明租约与指纹，无明文
#[tauri::command]
pub fn credential_lease(
    state: State<'_, AppState>,
    account_id: String,
    provider: String,
) -> R<serde_json::Value> {
    let _ = &state;
    let lease = crate::keychain::probe(&account_id, &provider)?;
    Ok(match lease {
        Some(l) => serde_json::json!({
            "ok": true,
            "lease_id": l.lease_id,
            "revision": l.revision,
            "expires_in_secs": 60,
        }),
        None => serde_json::json!({ "ok": false, "reason": "no_entry" }),
    })
}

/// credential.execute_refresh → 由壳层执行写回（TS 只给计划）
#[tauri::command]
pub async fn credential_execute_refresh(
    account_id: String,
    provider: String,
    new_secret: String,
) -> R<serde_json::Value> {
    if new_secret.trim().is_empty() {
        return Err(CommandError { code: "invalid_patch".into(), message: "空凭据被拒绝".into() });
    }
    crate::keychain::write(&account_id, &provider, &new_secret)?;
    let after = crate::keychain::probe(&account_id, &provider)?;
    Ok(serde_json::json!({
        "ok": true,
        "revision": after.map(|l| l.revision).unwrap_or_default(),
    }))
}

#[tauri::command]
pub fn credential_revoke(account_id: String, provider: String) -> R<serde_json::Value> {
    let deleted = crate::keychain::delete(&account_id, &provider)?;
    Ok(serde_json::json!({ "deleted": deleted }))
}

#[tauri::command]
pub async fn http_request(
    state: State<'_, AppState>,
    spec: crate::http::RequestSpec,
) -> R<crate::http::Reply> {
    let client = state.http.clone();
    Ok(client.send(spec).await?)
}

#[tauri::command]
pub async fn cli_run(cmd: String, args: Vec<String>, timeout_ms: u64) -> R<crate::cli::CliOutput> {
    Ok(crate::cli::run(cmd, args, timeout_ms).await?)
}

#[tauri::command]
pub fn store_load(state: State<'_, AppState>) -> R<String> {
    Ok(state.store.load_snapshots()?)
}

#[tauri::command]
pub fn store_save(state: State<'_, AppState>, payload: String) -> R<serde_json::Value> {
    let n = state.store.save_snapshots(&payload)?;
    Ok(serde_json::json!({ "ok": true, "count": n }))
}

#[tauri::command]
pub fn tray_set_view(app: tauri::AppHandle, text: String) -> R<()> {
    crate::tray::set_text(&app, &text)?;
    Ok(())
}

#[tauri::command]
pub fn notify_post(app: tauri::AppHandle, id: String, title: String, body: String) -> R<serde_json::Value> {
    let _ = id;
    let delivered = crate::notify::post(&app, &title, &body).unwrap_or(false);
    Ok(serde_json::json!({ "delivered": delivered }))
}

#[tauri::command]
pub fn panel_resize(app: tauri::AppHandle, height: f64) -> R<()> {
    crate::panel::resize(&app, height);
    Ok(())
}

#[tauri::command]
pub fn panel_show(app: tauri::AppHandle) -> R<()> {
    crate::panel::show(&app);
    Ok(())
}

#[tauri::command]
pub fn panel_hide(app: tauri::AppHandle) -> R<()> {
    crate::panel::hide(&app);
    Ok(())
}
