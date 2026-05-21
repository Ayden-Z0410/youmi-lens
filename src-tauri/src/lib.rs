// ── Overlay window commands ────────────────────────────────────────────────────

use std::sync::atomic::{AtomicBool, Ordering};
static OVERLAY_POSITIONED: AtomicBool = AtomicBool::new(false);

const OVERLAY_W: f64 = 600.0;
const OVERLAY_H: f64 = 118.0;
const OVERLAY_W_COMPACT: f64 = 260.0;
const OVERLAY_H_COMPACT: f64 = 56.0;

/// Make the overlay a real macOS floating companion (NSPanel-style HUD):
///   1. Class-swap the underlying NSWindow → NSPanel via `object_setClass`.
///      tao creates a `TaoWindow` subclass of NSWindow; we swap it to NSPanel
///      so AppKit treats the window as a panel for all the cross-Space and
///      activation-policy purposes. Standard pattern used by Codex Pet,
///      Itsycal, Magnet, and every floating-companion app on macOS.
///   2. Add `NonactivatingPanel` style-mask bit so showing/clicking the panel
///      does NOT activate the Youmi Lens app — the user's current app
///      (Chrome, WPS, PPT) keeps focus.
///   3. `setHidesOnDeactivate(false)` — explicitly stays visible when the host
///      app is no longer frontmost.
///   4. `setLevel(NSPopUpMenuWindowLevel)` (101) — high enough to float over
///      fullscreen Chrome / WPS content. Previous round used
///      NSStatusWindowLevel (25) which proved insufficient.
///   5. Collection behavior = `CanJoinAllSpaces | FullScreenAuxiliary
///      | Stationary | IgnoresCycle` (unchanged from previous round).
///   6. `orderFrontRegardless()` to bring the panel to the front of its level
///      WITHOUT calling `makeKeyAndOrderFront:` (which would activate the
///      app and could yank the user back to the Youmi Lens Space).
///
/// All AppKit work is dispatched onto the main thread via
/// `run_on_main_thread`; the `ns_window()` getter is called inside the
/// closure so it resolves on the main thread too.
///
/// Logs every before/after value with the `[OverlaySpaces]` prefix via
/// `eprintln!` (visible in `Console.app` / `log stream` even in release
/// builds, because the `tauri_plugin_log` plugin is only registered in debug
/// builds).
#[cfg(target_os = "macos")]
fn apply_overlay_workspace_behavior<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
  phase: &'static str,
) {
  let win = window.clone();
  let dispatch = window.run_on_main_thread(move || {
    let ptr = match win.ns_window() {
      Ok(p) => p,
      Err(e) => {
        eprintln!("[OverlaySpaces] {phase}: ns_window() error: {e}");
        return;
      }
    };
    if ptr.is_null() {
      eprintln!("[OverlaySpaces] {phase}: ns_window pointer is NULL");
      return;
    }
    unsafe {
      use objc2::runtime::AnyObject;
      use objc2::ClassType;
      use objc2_app_kit::{
        NSPanel, NSPopUpMenuWindowLevel, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask,
      };

      let ns_window: &NSWindow = &*(ptr as *const NSWindow);
      let any_obj: &AnyObject = &*(ptr as *const AnyObject);

      let before_behavior = ns_window.collectionBehavior();
      let before_level = ns_window.level();
      let before_style = ns_window.styleMask();
      let before_class_name = std::ffi::CStr::from_ptr(
        objc2::ffi::object_getClassName(ptr.cast::<AnyObject>()),
      )
      .to_string_lossy()
      .into_owned();
      let visible = ns_window.isVisible();

      // 1. Class-swap → NSPanel. Use raw `object_setClass` so we bypass the
      //    debug-only `instance_size` assert in `AnyObject::set_class`
      //    (TaoWindow has a 1-byte `focusable` ivar that NSPanel lacks; the
      //    extra byte just stays unused, which is sound).
      let panel_class = NSPanel::class();
      let panel_class_ptr: *const objc2::runtime::AnyClass = panel_class;
      let _prev_class = objc2::ffi::object_setClass(
        any_obj as *const AnyObject as *mut AnyObject,
        panel_class_ptr,
      );

      // 2. Non-activating panel style mask. Keep all the existing bits
      //    (Borderless was already there because decorations: false).
      let new_style = before_style | NSWindowStyleMask::NonactivatingPanel;
      ns_window.setStyleMask(new_style);

      // 3. Stay visible when the host app is no longer frontmost.
      ns_window.setHidesOnDeactivate(false);

      // 4. Raise level above NSStatusWindowLevel — popup-menu level (101)
      //    floats above fullscreen apps' content on macOS in our testing.
      ns_window.setLevel(NSPopUpMenuWindowLevel);

      // 5. CollectionBehavior — every cross-Space bit we have access to.
      let target_behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::Stationary
        | NSWindowCollectionBehavior::IgnoresCycle;
      ns_window.setCollectionBehavior(target_behavior);

      // (Step 6 — orderFrontRegardless — is intentionally NOT here.
      //  Setup-time should only configure flags without making the panel
      //  visible. show_overlay() calls order_overlay_front() separately
      //  after applying flags.)

      let after_behavior = ns_window.collectionBehavior();
      let after_level = ns_window.level();
      let after_style = ns_window.styleMask();
      let after_class_name = std::ffi::CStr::from_ptr(
        objc2::ffi::object_getClassName(ptr.cast::<AnyObject>()),
      )
      .to_string_lossy()
      .into_owned();
      let visible_after = ns_window.isVisible();
      let hides_on_deactivate = ns_window.hidesOnDeactivate();

      eprintln!(
        "[OverlaySpaces] {phase}: ns_window=0x{:x} \
         class {before_class_name} -> {after_class_name} \
         visible {visible} -> {visible_after} \
         level {before_level} -> {after_level} (popup={NSPopUpMenuWindowLevel}) \
         styleMask 0x{:x} -> 0x{:x} (NonactivatingPanel? {}) \
         behavior 0x{:x} -> 0x{:x} \
         [CanJoinAllSpaces={} FullScreenAuxiliary={} Stationary={} IgnoresCycle={}] \
         hidesOnDeactivate={hides_on_deactivate}",
        ptr as usize,
        before_style.0,
        after_style.0,
        after_style.contains(NSWindowStyleMask::NonactivatingPanel),
        before_behavior.0,
        after_behavior.0,
        after_behavior.contains(NSWindowCollectionBehavior::CanJoinAllSpaces),
        after_behavior.contains(NSWindowCollectionBehavior::FullScreenAuxiliary),
        after_behavior.contains(NSWindowCollectionBehavior::Stationary),
        after_behavior.contains(NSWindowCollectionBehavior::IgnoresCycle),
      );
    }
  });
  if let Err(e) = dispatch {
    eprintln!("[OverlaySpaces] {phase}: run_on_main_thread dispatch error: {e}");
  }
}

/// Bring the overlay panel to the front of its level WITHOUT activating the
/// Youmi Lens app. Replaces Tauri's `show()` (which calls
/// `makeKeyAndOrderFront:` and can drag the user back to Youmi Lens's Space).
/// Must run on the main thread.
#[cfg(target_os = "macos")]
fn order_overlay_front<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
  let win = window.clone();
  let dispatch = window.run_on_main_thread(move || {
    let ptr = match win.ns_window() {
      Ok(p) if !p.is_null() => p,
      _ => {
        eprintln!("[OverlaySpaces] order: ns_window unavailable");
        return;
      }
    };
    unsafe {
      use objc2_app_kit::NSWindow;
      let ns_window: &NSWindow = &*(ptr as *const NSWindow);
      let was_visible = ns_window.isVisible();
      ns_window.orderFrontRegardless();
      eprintln!(
        "[OverlaySpaces] order: ns_window=0x{:x} visible {was_visible} -> {}",
        ptr as usize,
        ns_window.isVisible()
      );
    }
  });
  if let Err(e) = dispatch {
    eprintln!("[OverlaySpaces] order: run_on_main_thread dispatch error: {e}");
  }
}

#[tauri::command]
fn show_overlay(app: tauri::AppHandle) {
  use tauri::Manager;
  let Some(w) = app.get_webview_window("overlay") else {
    eprintln!("[OverlaySpaces] show_overlay: overlay window NOT FOUND");
    return;
  };
  eprintln!("[OverlaySpaces] show_overlay: entered, label={}", w.label());

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
  // Re-assert transparency on every show. With `macOSPrivateApi: true` + the
  // `macos-private-api` feature on the `tauri` crate, wry actually wires
  // `drawsBackground=false` on the WKWebView config and `NSWindow.opaque=NO`.
  let _ = w.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
  // Disable the native NSWindow shadow.
  let _ = w.set_shadow(false);

  // Workspace behavior. macOS: configure NSPanel-style flags first, then
  // bring to front via orderFrontRegardless (NOT makeKeyAndOrderFront, which
  // would activate Youmi Lens and could yank the user back to its Space).
  #[cfg(target_os = "macos")]
  {
    apply_overlay_workspace_behavior(&w, "show");
    order_overlay_front(&w);
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = w.set_visible_on_all_workspaces(true);
    let _ = w.show();
  }

  // Intentionally NOT calling set_focus(): the overlay is a passive caption HUD
  // and must not steal keyboard focus from Chrome/WPS/PPT/Notes. Buttons and
  // dragging still work because the panel accepts mouse events at its high
  // level, and clicks routed through performWindowDragWithEvent: from
  // OverlayWindow.tsx do not require key-window status.
}

#[tauri::command]
fn hide_overlay(app: tauri::AppHandle) {
  use tauri::Manager;
  if let Some(w) = app.get_webview_window("overlay") {
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
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
  }
}

#[tauri::command]
fn minimize_main_window(app: tauri::AppHandle) {
  use tauri::Manager;
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.minimize();
  }
}

#[tauri::command]
fn resize_overlay_compact(app: tauri::AppHandle) {
  use tauri::Manager;
  if let Some(w) = app.get_webview_window("overlay") {
    let _ = w.set_size(tauri::LogicalSize::new(OVERLAY_W_COMPACT, OVERLAY_H_COMPACT));
  }
}

#[tauri::command]
fn resize_overlay_expanded(app: tauri::AppHandle) {
  use tauri::Manager;
  if let Some(w) = app.get_webview_window("overlay") {
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
        if label != "main" {
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

      // Re-assert transparent overlay at startup, and pre-apply macOS
      // collection behavior + level so the overlay is wired for all-Spaces
      // floating before its first show.
      {
        use tauri::Manager;
        if let Some(overlay) = app.get_webview_window("overlay") {
          let _ = overlay.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
          #[cfg(target_os = "macos")]
          apply_overlay_workspace_behavior(&overlay, "setup");
        } else {
          eprintln!("[OverlaySpaces] setup: overlay window NOT FOUND");
        }
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
  if let Some(w) = app.get_webview_window("main") {
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
