use crate::*;

// Team-ID-prefixed, not "group.*": macOS Sequoia shows a user-facing
// authorization prompt for "group.*" application groups in Developer-ID-signed
// apps, but stays silent for the team-prefixed form (#1054 decision 4). Baked
// in at compile time by build.rs from the same APPLE_TEAM_ID the release
// workflow already signs with; a build without it (local dev) gets a
// placeholder that simply never resolves a container, so this command no-ops
// instead of crashing.
#[cfg(target_os = "macos")]
const MACOS_WIDGET_APP_GROUP: &str = env!("MINDWTR_MACOS_APP_GROUP");
#[cfg(target_os = "macos")]
const MACOS_WIDGET_PAYLOAD_FILE_NAME: &str = "widget-payload.json";

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn mindwtr_macos_widget_container_path(app_group: *const c_char) -> *mut c_char;
    fn mindwtr_macos_widget_free_string(ptr: *mut c_char);
    fn mindwtr_reload_widgets();
}

#[cfg(target_os = "macos")]
fn macos_widget_container_dir() -> Option<PathBuf> {
    let group_cstring = CString::new(MACOS_WIDGET_APP_GROUP).ok()?;
    let raw = unsafe { mindwtr_macos_widget_container_path(group_cstring.as_ptr()) };
    if raw.is_null() {
        return None;
    }
    // SAFETY: `raw` is non-null; the bridge allocates via `strdup()`, so the
    // pointer stays valid until we free it. Copy immediately, then free.
    let path = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
    unsafe { mindwtr_macos_widget_free_string(raw) };
    Some(PathBuf::from(path))
}

/// Writes the macOS widget's JSON payload to the App Group container and asks
/// WidgetKit to reload timelines (#1054). Never errors: the App Group
/// container being unavailable (unsigned dev build, missing entitlement) or
/// any I/O failure along the way is logged and swallowed, since a widget that
/// stays stale for a cycle is not worth interrupting the caller over.
#[tauri::command]
pub(crate) fn write_macos_widget_payload(payload_json: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let Some(dir) = macos_widget_container_dir() else {
            log::warn!("macOS widget: App Group container unavailable; skipping payload write");
            return Ok(());
        };
        if let Err(error) = fs::create_dir_all(&dir) {
            log::warn!("macOS widget: failed to create container dir: {error}");
            return Ok(());
        }
        let final_path = dir.join(MACOS_WIDGET_PAYLOAD_FILE_NAME);
        let tmp_path = dir.join(format!("{MACOS_WIDGET_PAYLOAD_FILE_NAME}.tmp"));
        if let Err(error) = fs::write(&tmp_path, payload_json.as_bytes()) {
            log::warn!("macOS widget: failed to write payload: {error}");
            return Ok(());
        }
        // Rename rather than write-in-place so a concurrent widget timeline
        // read never observes a partially written file.
        if let Err(error) = fs::rename(&tmp_path, &final_path) {
            log::warn!("macOS widget: failed to publish payload: {error}");
            return Ok(());
        }
        unsafe { mindwtr_reload_widgets() };
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = payload_json;
        Ok(())
    }
}
