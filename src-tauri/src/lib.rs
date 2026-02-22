use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn payment_profile_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let mut path = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

  path.push("payment_profile.json");
  Ok(path)
}

#[tauri::command]
fn load_payment_profile_blob(app: tauri::AppHandle) -> Result<Option<String>, String> {
  let path = payment_profile_path(&app)?;
  if !path.exists() {
    return Ok(None);
  }

  let raw = fs::read_to_string(path)
    .map_err(|error| format!("Failed to read payment profile file: {error}"))?;
  Ok(Some(raw))
}

#[tauri::command]
fn save_payment_profile_blob(app: tauri::AppHandle, blob: String) -> Result<(), String> {
  let path = payment_profile_path(&app)?;

  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Failed to create payment profile directory: {error}"))?;
  }

  let parsed = serde_json::from_str::<serde_json::Value>(&blob)
    .map_err(|error| format!("Failed to parse payment profile blob JSON: {error}"))?;
  let serialized = serde_json::to_string_pretty(&parsed)
    .map_err(|error| format!("Failed to serialize payment profile blob: {error}"))?;

  fs::write(&path, serialized)
    .map_err(|error| format!("Failed to write payment profile file: {error}"))?;

  #[cfg(unix)]
  {
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
      .map_err(|error| format!("Failed to set payment profile file permissions: {error}"))?;
  }

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![load_payment_profile_blob, save_payment_profile_blob])
    .setup(|app| {
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
