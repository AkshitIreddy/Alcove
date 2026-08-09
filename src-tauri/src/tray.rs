//! System-tray quick capture and close-to-tray.
//!
//! The tray is intentionally small: an icon with at most three menu entries.
//! - "Open Alcove"  -> shows / unminimizes / focuses the main window.
//! - "Quick note"   -> same focus, then emits `nb://tray-quick-note` to
//!   the main webview; the frontend (src/features/system/tray.ts) opens an
//!   "Inbox" book, creating it on demand. Only shown when quick capture is on.
//! - "Quit Alcove"  -> the explicit way out when the close button hides the
//!   main window.
//!
//! The tray exists when either `trayQuickCapture` or `closeToTray` needs it.
//! Rust never parses the settings blob: the frontend sends both booleans to
//! `tray_sync` whenever the store changes.
//!
//! Known limitations (documented deviation from the full roadmap wording):
//! - No dedicated capture popup window — quick capture focuses the main
//!   window and opens the Inbox book instead of a second webview.
//! - Left-clicking the icon focuses the window; the menu opens on
//!   right-click (platform default).
//!
//! Requires the `tray-icon` feature on the `tauri` crate.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

/// Stable id so the tray can be found/removed across enable/disable calls.
const TRAY_ID: &str = "nb-tray";
/// Menu item ids.
const MENU_OPEN: &str = "nb-tray-open";
const MENU_QUICK: &str = "nb-tray-quick";
const MENU_QUIT: &str = "nb-tray-quit";
/// Event the frontend listens for (must match src/features/system/tray.ts).
pub const QUICK_NOTE_EVENT: &str = "nb://tray-quick-note";
/// Main-window tray state, emitted with `true` after a successful hide and
/// `false` after the tray restores the window.
pub const VISIBILITY_EVENT: &str = "nb://tray-visibility";

static QUICK_CAPTURE: AtomicBool = AtomicBool::new(false);
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

/// What a given menu id should do (pure — unit-tested).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayAction {
    Open,
    QuickNote,
    Quit,
}

fn menu_action(id: &str) -> Option<TrayAction> {
    match id {
        MENU_OPEN => Some(TrayAction::Open),
        MENU_QUICK => Some(TrayAction::QuickNote),
        MENU_QUIT => Some(TrayAction::Quit),
        _ => None,
    }
}

fn tray_needed_for(quick_capture: bool, close_to_tray: bool) -> bool {
    quick_capture || close_to_tray
}

fn tray_needed() -> bool {
    tray_needed_for(
        QUICK_CAPTURE.load(Ordering::Relaxed),
        CLOSE_TO_TRAY.load(Ordering::Relaxed),
    )
}

/// Read by the window close handler in lib.rs.
pub fn close_to_tray_enabled() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Relaxed)
}

/// Show + unminimize + focus the main window (best-effort).
fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let shown = window.show().is_ok();
        let _ = window.unminimize();
        let _ = window.set_focus();
        if shown {
            let _ = app.emit_to("main", VISIBILITY_EVENT, false);
        }
    }
}

/// Tell the frontend that a close-to-tray hide actually completed.
pub fn report_hidden(app: &AppHandle) {
    let _ = app.emit_to("main", VISIBILITY_EVENT, true);
}

fn run_action(app: &AppHandle, action: TrayAction) {
    match action {
        TrayAction::Open => focus_main(app),
        TrayAction::QuickNote => {
            focus_main(app);
            let _ = app.emit_to("main", QUICK_NOTE_EVENT, ());
        }
        TrayAction::Quit => app.exit(0),
    }
}

/// Build the tray icon + the menu that matches the current settings.
fn build_tray(app: &AppHandle) -> Result<(), String> {
    app.remove_tray_by_id(TRAY_ID);
    let open = MenuItemBuilder::with_id(MENU_OPEN, "Open Alcove")
        .build(app)
        .map_err(|e| e.to_string())?;
    let quit = MenuItemBuilder::with_id(MENU_QUIT, "Quit Alcove")
        .build(app)
        .map_err(|e| e.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let menu = if QUICK_CAPTURE.load(Ordering::Relaxed) {
        let quick = MenuItemBuilder::with_id(MENU_QUICK, "Quick note")
            .build(app)
            .map_err(|e| e.to_string())?;
        MenuBuilder::new(app)
            .items(&[&open, &quick, &separator, &quit])
            .build()
            .map_err(|e| e.to_string())?
    } else {
        MenuBuilder::new(app)
            .items(&[&open, &separator, &quit])
            .build()
            .map_err(|e| e.to_string())?
    };

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

/// Ensure a needed tray exists without replacing a live icon. Used on the
/// window-close hot path, where remove + rebuild would visibly blink the tray.
pub fn ensure_tray(app: &AppHandle) -> Result<(), String> {
    if tray_needed() {
        if app.tray_by_id(TRAY_ID).is_none() {
            build_tray(app)?;
        }
        Ok(())
    } else {
        app.remove_tray_by_id(TRAY_ID);
        Ok(())
    }
}

/// Rebuild after a settings change, because the Quick note row may have been
/// added or removed even when the icon remains necessary.
fn sync_tray(app: &AppHandle) -> Result<(), String> {
    if tray_needed() {
        build_tray(app)
    } else {
        app.remove_tray_by_id(TRAY_ID);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Sync tray presence and close behavior with the persisted frontend store.
#[tauri::command]
pub fn tray_sync(app: AppHandle, quick_capture: bool, close_to_tray: bool) -> Result<(), String> {
    QUICK_CAPTURE.store(quick_capture, Ordering::Relaxed);
    CLOSE_TO_TRAY.store(close_to_tray, Ordering::Relaxed);
    sync_tray(&app)
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
        assert_eq!(menu_action(MENU_QUIT), Some(TrayAction::Quit));
        assert_eq!(menu_action("nb-tray-unknown"), None);
        assert_eq!(menu_action(""), None);
    }

    #[test]
    fn event_name_is_tauri_valid() {
        // Tauri event names may only contain [a-zA-Z0-9/:_-].
        assert!(QUICK_NOTE_EVENT
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | ':' | '_' | '-')));
        assert!(VISIBILITY_EVENT
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | ':' | '_' | '-')));
    }

    #[test]
    fn either_setting_keeps_the_tray_reachable() {
        assert!(!tray_needed_for(false, false));
        assert!(tray_needed_for(true, false));
        assert!(tray_needed_for(false, true));
        assert!(tray_needed_for(true, true));
    }
}
