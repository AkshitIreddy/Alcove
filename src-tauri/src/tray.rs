//! System-tray quick capture (wave-2 group F, roadmap item 32 — minimal
//! scope).
//!
//! The tray is intentionally small: an icon with two menu entries.
//! - "Open Alcove"  -> shows / unminimizes / focuses the main window.
//! - "Quick note"     -> same focus, then emits `nb://tray-quick-note` to
//!   the main webview; the frontend (src/features/system/tray.ts) opens an
//!   "Inbox" book, creating it on demand.
//!
//! The tray's presence follows the `trayQuickCapture` setting: the frontend
//! invokes `tray_enable` / `tray_disable` at startup and whenever the
//! setting flips (Rust never parses the settings blob itself).
//!
//! Known limitations (documented deviation from the full roadmap wording):
//! - No dedicated capture popup window — quick capture focuses the main
//!   window and opens the Inbox book instead of a second webview.
//! - Left-clicking the icon focuses the window; the menu opens on
//!   right-click (platform default).
//!
//! Requires the `tray-icon` feature on the `tauri` crate.

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

/// Stable id so the tray can be found/removed across enable/disable calls.
const TRAY_ID: &str = "nb-tray";
/// Menu item ids.
const MENU_OPEN: &str = "nb-tray-open";
const MENU_QUICK: &str = "nb-tray-quick";
/// Event the frontend listens for (must match src/features/system/tray.ts).
pub const QUICK_NOTE_EVENT: &str = "nb://tray-quick-note";

/// What a given menu id should do (pure — unit-tested).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayAction {
    Open,
    QuickNote,
}

fn menu_action(id: &str) -> Option<TrayAction> {
    match id {
        MENU_OPEN => Some(TrayAction::Open),
        MENU_QUICK => Some(TrayAction::QuickNote),
        _ => None,
    }
}

/// Show + unminimize + focus the main window (best-effort).
fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn run_action(app: &AppHandle, action: TrayAction) {
    focus_main(app);
    if action == TrayAction::QuickNote {
        let _ = app.emit_to("main", QUICK_NOTE_EVENT, ());
    }
}

/// Build the tray icon + menu if it does not exist yet. Idempotent.
fn build_tray(app: &AppHandle) -> Result<(), String> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let open = MenuItemBuilder::with_id(MENU_OPEN, "Open Alcove")
        .build(app)
        .map_err(|e| e.to_string())?;
    let quick = MenuItemBuilder::with_id(MENU_QUICK, "Quick note")
        .build(app)
        .map_err(|e| e.to_string())?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &quick])
        .build()
        .map_err(|e| e.to_string())?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Alcove")
        .on_menu_event(|app, event| {
            if let Some(action) = menu_action(event.id().as_ref()) {
                run_action(app, action);
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click on the icon = "Open Alcove".
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Create the tray icon (no-op when it already exists).
#[tauri::command]
pub fn tray_enable(app: AppHandle) -> Result<(), String> {
    build_tray(&app)
}

/// Remove the tray icon (no-op when absent).
#[tauri::command]
pub fn tray_disable(app: AppHandle) -> Result<(), String> {
    app.remove_tray_by_id(TRAY_ID);
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_ids_map_to_actions() {
        assert_eq!(menu_action(MENU_OPEN), Some(TrayAction::Open));
        assert_eq!(menu_action(MENU_QUICK), Some(TrayAction::QuickNote));
        assert_eq!(menu_action("nb-tray-unknown"), None);
        assert_eq!(menu_action(""), None);
    }

    #[test]
    fn event_name_is_tauri_valid() {
        // Tauri event names may only contain [a-zA-Z0-9/:_-].
        assert!(QUICK_NOTE_EVENT
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | ':' | '_' | '-')));
    }
}
