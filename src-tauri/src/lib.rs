// ── Overlay window commands ────────────────────────────────────────────────────

use std::sync::atomic::{AtomicBool, Ordering};
static OVERLAY_POSITIONED: AtomicBool = AtomicBool::new(false);

const OVERLAY_W: f64 = 600.0;
const OVERLAY_H: f64 = 118.0;
const OVERLAY_W_COMPACT: f64 = 260.0;
const OVERLAY_H_COMPACT: f64 = 56.0;
const MAIN_WINDOW_LABEL: &str = "main";
const OVERLAY_WINDOW_LABEL: &str = "overlay";

fn should_close_auxiliary_webview(label: &str) -> bool {
  label != MAIN_WINDOW_LABEL && label != OVERLAY_WINDOW_LABEL
}

#[cfg(test)]
mod tests {
  use super::should_close_auxiliary_webview;

  #[test]
  fn preserves_first_class_windows() {
    assert!(!should_close_auxiliary_webview("main"));
    assert!(!should_close_auxiliary_webview("overlay"));
    assert!(should_close_auxiliary_webview("auth-popup"));
  }
}

#[tauri::command]
fn show_overlay(app: tauri::AppHandle) {
  use tauri::Manager;
  if let Some(w) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
    // Ensure expanded size is restored (in case it was left compact)
    let _ = w.set_size(tauri::LogicalSize::new(OVERLAY_W, OVERLAY_H));
    // On first show, position at bottom-center of primary monitor above the Dock.
    if !OVERLAY_POSITIONED.swap(true, Ordering::SeqCst) {
      if let Ok(Some(monitor)) = w.primary_monitor() {
        let scale = monitor.scale_factor();
        let sw = monitor.size().width as f64 / scale;
        let sh = monitor.size().height as f64 / scale;
        let dock_margin = 92.0_f64;
        let x = (sw - OVERLAY_W) / 2.0;
        let y = sh - OVERLAY_H - dock_margin;
        let _ = w.set_position(tauri::LogicalPosition::new(x, y));
      }
    }
    let _ = w.set_visible_on_all_workspaces(true);
    let _ = w.show();
    let _ = w.set_focus();
  }
}

#[tauri::command]
fn hide_overlay(app: tauri::AppHandle) {
  use tauri::Manager;
  if let Some(w) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
    let _ = w.hide();
  }
}

#[tauri::command]
fn focus_main_window(app: tauri::AppHandle) {
  use tauri::Manager;
  #[cfg(target_os = "macos")]
  {
    let _ = app.show();
  }
  if let Some(w) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
  }
}

#[tauri::command]
fn minimize_main_window(app: tauri::AppHandle) {
  use tauri::Manager;
  if let Some(w) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    let _ = w.minimize();
  }
}

#[tauri::command]
fn resize_overlay_compact(app: tauri::AppHandle) {
  use tauri::Manager;
  if let Some(w) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
    let _ = w.set_size(tauri::LogicalSize::new(OVERLAY_W_COMPACT, OVERLAY_H_COMPACT));
  }
}

#[tauri::command]
fn resize_overlay_expanded(app: tauri::AppHandle) {
  use tauri::Manager;
  if let Some(w) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
    let _ = w.set_size(tauri::LogicalSize::new(OVERLAY_W, OVERLAY_H));
  }
}

// ── Runtime ───────────────────────────────────────────────────────────────────

#[cfg(all(
  not(target_os = "android"),
  not(target_os = "ios"),
))]
use tauri::Runtime;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  use tauri::{Listener, Manager};

  let mut builder = tauri::Builder::default();

  // Deep-link plugin must register before single-instance so the latter can call
  // `deep_link.handle_cli_arguments` on the primary app when a second instance
  // is opened with lecturecompanion://… (see tauri-plugin-single-instance `deep-link` feature).
  //
  // macOS caveat: `handle_cli_arguments` only parses argv on Windows/Linux. URL opens on macOS
  // normally use `RunEvent::Opened` on the process that receives the event. A secondary
  // process killed by single-instance exits in `setup` before that event runs, so the URL is
  // only available via forwarded argv — we re-emit `deep-link://new-url` in the callback below.
  builder = builder.plugin(tauri_plugin_deep_link::init());
  builder = builder.plugin(tauri_plugin_shell::init());

  #[cfg(all(not(target_os = "android"), not(target_os = "ios")))]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
      #[cfg(target_os = "macos")]
      emit_forwarded_deep_link_urls(&app, &args);

      for (label, w) in app.webview_windows() {
        if should_close_auxiliary_webview(&label) {
          log::info!("[single-instance] closing non-main webview: {}", label);
          let _ = w.close();
        }
      }

      activate_main_for_auth_callback(&app);
      if !args.is_empty() {
        log::info!("[single-instance] secondary launch args: {:?}", args);
      }
    }));
  }

  builder
    .invoke_handler(tauri::generate_handler![
      show_overlay,
      hide_overlay,
      focus_main_window,
      minimize_main_window,
      resize_overlay_compact,
      resize_overlay_expanded
    ])
    .setup(|app| {
      #[cfg(all(not(target_os = "android"), not(target_os = "ios")))]
      {
        let handle = app.handle().clone();
        let _ = app.listen("deep-link://new-url", move |_event| {
          activate_main_for_auth_callback(&handle);
        });
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

/// Bring the main webview to the foreground after a deep link or second-instance handoff.
///
/// On macOS, `RunEvent::Opened` delivers URLs to the **already-running** app without going through
/// `single-instance`; we rely on a global listener for `deep-link://new-url` for that path.
/// `AppHandle::show` maps to `show_application()` and helps the app steal focus from the mail client.
#[cfg(all(not(target_os = "android"), not(target_os = "ios")))]
fn activate_main_for_auth_callback<R: Runtime>(app: &tauri::AppHandle<R>) {
  use tauri::Manager;
  #[cfg(target_os = "macos")]
  {
    let _ = app.show();
  }
  if let Some(w) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
  }
}

/// macOS: single-instance forwards `std::env::args()` from the secondary process. If the custom
/// scheme appears there, emit the same event the deep-link plugin uses so the main webview runs
/// `onOpenUrl` and updates Supabase session on the existing window.
#[cfg(target_os = "macos")]
fn emit_forwarded_deep_link_urls<R: tauri::Runtime>(app: &tauri::AppHandle<R>, args: &[String]) {
  use tauri::Emitter;
  let urls = collect_lecturecompanion_urls_from_args(args);
  if urls.is_empty() {
    return;
  }
  log::info!(
    "[single-instance] forwarding {} deep link URL(s) to main webview",
    urls.len()
  );
  let _ = app.emit("deep-link://new-url", urls);
}

#[cfg(target_os = "macos")]
fn collect_lecturecompanion_urls_from_args(args: &[String]) -> Vec<String> {
  let mut out = Vec::new();
  for arg in args {
    let arg = arg.trim();
    if arg.starts_with("lecturecompanion://") {
      out.push(arg.to_string());
      continue;
    }
    if let Some(i) = arg.find("lecturecompanion://") {
      let rest = arg[i..].trim_end();
      if !rest.is_empty() {
        out.push(rest.to_string());
      }
    }
  }
  out
}
