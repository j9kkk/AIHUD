//! 状态栏托盘：文本 + 环轮廓（模板图），点击切换面板。

use anyhow::Result;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub const TRAY_ID: &str = "ai-hud-tray";

pub fn install(app: &AppHandle) -> Result<()> {
    let open_i = MenuItem::with_id(app, "open", "打开 AI HUD", true, None::<&str>)?;
    let refresh_i = MenuItem::with_id(app, "refresh", "立即刷新", true, None::<&str>)?;
    let settings_i = MenuItem::with_id(app, "settings", "偏好设置…", true, Some("CmdOrCtrl+,"))?;
    let quit_i = MenuItem::with_id(app, "quit", "退出 AI HUD", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(app, &[&open_i, &refresh_i, &settings_i, &quit_i])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("AI HUD")
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => crate::panel::toggle(app),
            "refresh" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.emit("hud:refresh-requested", ());
                }
            }
            "settings" => {
                crate::panel::show(app);
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.emit("hud:navigate", "settings");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::panel::toggle(&tray.app_handle().clone());
            }
        })
        .build(app)?;
    Ok(())
}

/// 托盘文本：≤12 字符（ARCHITECTURE §8.4）
pub fn set_text(app: &AppHandle, text: &str) -> Result<()> {
    let clipped: String = text.chars().take(12).collect();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_title(Some(clipped))?;
    }
    Ok(())
}

