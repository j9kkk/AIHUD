//! 状态栏托盘：文本 + 环轮廓（模板图），点击切换面板。

use anyhow::{Context, Result};
use tauri::{
    image::Image,
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

    // 菜单栏图标：必须显式给 icon，否则 macOS 上状态项会「存在但不可见」。
    // 用 template 图（只吃 alpha，系统按明暗外观自动着色），44×44 @2x。
    let tray_icon = Image::from_bytes(include_bytes!("../../assets/tray-template@2x.png"))
        .context("无法解码菜单栏模板图标 assets/tray-template@2x.png")?;

    TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("AI HUD · 剩余额度")
        .icon(tray_icon)
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

