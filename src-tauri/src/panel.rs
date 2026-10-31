//! 无边框面板：定位到托盘下方、高度钳制 240–720、失焦自动收起。

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position, Size};

const MIN_H: u32 = 240;
const MAX_H: u32 = 720;

fn window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
}

pub fn install(app: &AppHandle) -> Result<(), tauri::Error> {
    if let Some(w) = window(app) {
        let handle = app.clone();
        w.on_window_event(move |event| {
            // 失焦收起：与 Systems Settings / 其他 App 抢焦点时不残留浮层。
            // 注意：用户点击面板内控件不会触发失焦；点击面板外区域会。
            if let tauri::WindowEvent::Focused(false) = event {
                hide(&handle);
            }
        });
    }
    Ok(())
}

pub fn show(app: &AppHandle) {
    if let Some(w) = window(app) {
        let _ = place_under_tray(&w);
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("hud:panel-opened", ());
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(w) = window(app) {
        let _ = w.emit("hud:panel-closed", ());
        let _ = w.hide();
    }
}

pub fn toggle(app: &AppHandle) {
    if let Some(w) = window(app) {
        if w.is_visible().unwrap_or(false) {
            hide(app);
        } else {
            show(app);
        }
    }
}

/// 高度钳制（前端只传逻辑高度）
pub fn resize(app: &AppHandle, height: f64) {
    if let Some(w) = window(app) {
        let h = height.clamp(MIN_H as f64, MAX_H as f64) as u32;
        let _ = w.set_size(Size::Physical(tauri::PhysicalSize::new(360, h)));
    }
}

fn place_under_tray(w: &tauri::WebviewWindow) -> Result<(), tauri::Error> {
    // macOS：菜单栏高度 24pt；面板贴右上角并留 8pt 边距。
    #[cfg(target_os = "macos")]
    {
        if let Ok(Some(monitor)) = w.current_monitor() {
            let size = monitor.size();
            let scale = monitor.scale_factor();
            let width = 360.0 * scale;
            let x = size.width as f64 - width - 12.0 * scale;
            let y = 26.0 * scale;
            let _ = w.set_position(Position::Physical(PhysicalPosition::new(x as i32, y as i32)));
        }
    }
    Ok(())
}

