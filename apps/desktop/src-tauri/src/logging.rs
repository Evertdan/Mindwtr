use crate::*;

fn write_log_line(app: &tauri::AppHandle, line: &str) -> Result<String, String> {
    let log_dir = get_data_dir(app).join("logs");
    if let Err(err) = std::fs::create_dir_all(&log_dir) {
        return Err(err.to_string());
    }
    let log_path = log_dir.join("mindwtr.log");
    let rotated_path = log_dir.join("mindwtr.log.1");
    let max_bytes: u64 = 5 * 1024 * 1024;

    if let Ok(meta) = std::fs::metadata(&log_path) {
        if meta.len() >= max_bytes {
            let _ = std::fs::remove_file(&rotated_path);
            let _ = std::fs::rename(&log_path, &rotated_path);
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| e.to_string())?;
    if let Err(err) = file.write_all(line.as_bytes()) {
        return Err(err.to_string());
    }
    if let Err(err) = file.flush() {
        return Err(err.to_string());
    }

    Ok(log_path.to_string_lossy().to_string())
}

fn native_log_line(message: &str) -> String {
    let timestamp = OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| OffsetDateTime::now_utc().unix_timestamp().to_string());
    format!(
        "{}\n",
        serde_json::json!({
            "ts": timestamp,
            "level": "info",
            "scope": "app",
            "message": message,
            "context": { "source": "native" },
        })
    )
}

pub(crate) fn append_native_log_line(app: &tauri::AppHandle, message: &str) {
    let line = native_log_line(message);
    if let Err(error) = write_log_line(app, &line) {
        log::warn!("Failed to append native app log: {error}");
    }
}

// Synchronous log file I/O (open/append/flush, occasional rotation) off the
// UI thread; O_APPEND writes to this file are already safe under concurrent
// writers, and a rotation race costs at worst a diagnostic log hiccup, not
// app data (B1).
#[tauri::command(async)]
pub(crate) fn append_log_line(app: tauri::AppHandle, line: String) -> Result<String, String> {
    write_log_line(&app, &line)
}

#[tauri::command(async)]
pub(crate) fn clear_log_file(app: tauri::AppHandle) -> Result<String, String> {
    let log_path = get_data_dir(&app).join("logs").join("mindwtr.log");
    if log_path.exists() {
        if let Err(err) = std::fs::remove_file(&log_path) {
            return Err(err.to_string());
        }
    }
    Ok(log_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::native_log_line;

    #[test]
    fn native_log_line_is_valid_jsonl() {
        let line = native_log_line("Close trace: quoted \"message\"");

        assert!(line.ends_with('\n'));
        let entry: serde_json::Value =
            serde_json::from_str(line.trim_end()).expect("native log line should be JSON");
        assert_eq!(entry["level"], "info");
        assert_eq!(entry["scope"], "app");
        assert_eq!(entry["message"], "Close trace: quoted \"message\"");
        assert_eq!(entry["context"]["source"], "native");
        assert!(entry["ts"].as_str().is_some_and(|value| !value.is_empty()));
    }
}
