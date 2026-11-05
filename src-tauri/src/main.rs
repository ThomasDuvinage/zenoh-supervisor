#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, RunEvent, State};

#[derive(Default)]
struct Router(Mutex<Option<Child>>);

/// Port from `websocket_port: "10000"` (or a number) in the config; zenoh's default is 10000.
fn ws_port(config: &str) -> u16 {
    config
        .find("websocket_port")
        .map(|i| &config[i + "websocket_port".len()..])
        .and_then(|rest| {
            let digits: String = rest
                .chars()
                .skip_while(|c| !c.is_ascii_digit())
                .take_while(|c| c.is_ascii_digit())
                .collect();
            digits.parse().ok()
        })
        .unwrap_or(10000)
}

fn kill(slot: &mut Option<Child>) {
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Bundled `supervisor-zenohd` next to the executable (named so it cannot clash with a system
/// `zenohd`), else `zenohd` from PATH.
fn zenohd_path() -> PathBuf {
    let exe = if cfg!(windows) { "supervisor-zenohd.exe" } else { "supervisor-zenohd" };
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(exe)))
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from("zenohd"))
}

#[tauri::command]
fn start_router(config_path: String, app: AppHandle, router: State<Router>) -> Result<String, String> {
    let text = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let mut slot = router.0.lock().unwrap();
    kill(&mut slot);

    let zenohd = zenohd_path();
    let mut cmd = Command::new(&zenohd);
    cmd.args(["-c", &config_path]);
    // Point plugin loading at the bundled plugins, whatever search_dirs the user's file says
    // (it is usually /usr/lib, which does not exist on Windows or macOS).
    if let Some(dir) = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("zenoh-plugins"))
        .filter(|d| d.is_dir())
    {
        let dir = dir.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
        cmd.args(["--cfg", &format!("plugins_loading/search_dirs:[\"{dir}\"]")]);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("cannot start {} (bundled zenohd missing and none on PATH?): {e}", zenohd.display()))?;
    *slot = Some(child);
    Ok(format!("ws://127.0.0.1:{}", ws_port(&text)))
}

/// Files the user picked in a native dialog (the webview's own file input is unreliable on Linux).
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn stop_router(router: State<Router>) {
    kill(&mut router.0.lock().unwrap());
}

/// A GTK app started from a snap app (VS Code, ...) inherits that snap's GTK/GSettings paths and
/// aborts or loses its dialogs ("Settings schema ... does not contain a key named 'antialiasing'",
/// "im-wayland.so: cannot open shared object file"). Drop them before GTK initialises.
#[cfg(target_os = "linux")]
fn drop_snap_env() {
    const PATH_VARS: &[&str] = &[
        "GTK_PATH", "GTK_EXE_PREFIX", "GTK_IM_MODULE_FILE", "GIO_MODULE_DIR", "GSETTINGS_SCHEMA_DIR",
        "GDK_PIXBUF_MODULEDIR", "GDK_PIXBUF_MODULE_FILE", "LOCPATH",
    ];
    for var in PATH_VARS {
        if std::env::var(var).map_or(false, |v| v.contains("/snap/")) {
            std::env::remove_var(var);
        }
    }
    if let Ok(dirs) = std::env::var("XDG_DATA_DIRS") {
        let kept: Vec<&str> = dirs.split(':').filter(|d| !d.contains("/snap/")).collect();
        if kept.len() != dirs.split(':').count() {
            std::env::set_var("XDG_DATA_DIRS", kept.join(":"));
        }
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    drop_snap_env();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Router::default())
        .invoke_handler(tauri::generate_handler![start_router, stop_router, read_text_file, write_text_file])
        .build(tauri::generate_context!())
        .expect("error while building tauri app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                kill(&mut app.state::<Router>().0.lock().unwrap());
            }
        });
}
