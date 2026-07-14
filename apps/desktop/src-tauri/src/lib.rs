use serde::Serialize;
use std::{
    env,
    fs::{create_dir_all, OpenOptions},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Manager, State};

#[derive(Default)]
struct SidecarState {
    child: Option<Child>,
    connection: Option<SidecarConnection>,
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[derive(Clone, Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarConnection {
    port: u16,
    token: String,
    boot_id: String,
    url: String,
}

#[derive(Debug, thiserror::Error)]
enum DesktopError {
    #[error("sidecar binary was not found; run `pnpm sidecar:bun:build` first")]
    SidecarMissing,
    #[error("sidecar exited before handshake")]
    EarlyExit,
    #[error("failed to start sidecar: {0}")]
    Start(String),
    #[error("failed to read sidecar handshake: {0}")]
    Handshake(String),
}

impl Serialize for DesktopError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

fn sidecar_filename() -> &'static str {
    if cfg!(windows) {
        "quorum-sidecar.exe"
    } else {
        "quorum-sidecar"
    }
}

fn dev_sidecar_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join("dist-sidecar/bun")
        .join(sidecar_filename())
}

fn bundled_sidecar_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    Some(resource_dir.join("sidecars").join(sidecar_filename()))
}

fn resolve_sidecar_path(app: &tauri::AppHandle) -> Result<PathBuf, DesktopError> {
    let bundled = bundled_sidecar_path(app);
    if let Some(path) = bundled.as_ref().filter(|path| path.exists()) {
        return Ok(path.to_path_buf());
    }

    let dev = dev_sidecar_path();
    if dev.exists() {
        return Ok(dev);
    }

    Err(DesktopError::SidecarMissing)
}

fn sidecar_path_env() -> Option<std::ffi::OsString> {
    let mut paths: Vec<PathBuf> = env::var_os("PATH")
        .as_deref()
        .map(env::split_paths)
        .into_iter()
        .flatten()
        .collect();

    if cfg!(windows) {
        if let Some(profile) = env::var_os("USERPROFILE") {
            paths.push(PathBuf::from(profile).join(".local").join("bin"));
        }
        if let Some(app_data) = env::var_os("APPDATA") {
            paths.push(PathBuf::from(app_data).join("npm"));
        }
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            paths.push(PathBuf::from(local_app_data).join("Programs").join("Claude"));
        }
    }

    let mut unique = Vec::with_capacity(paths.len());
    for path in paths {
        if !unique.contains(&path) {
            unique.push(path);
        }
    }
    env::join_paths(unique).ok()
}

fn start_sidecar(app: &tauri::AppHandle, binary: &Path) -> Result<(Child, SidecarConnection), DesktopError> {
    let data_dir = app.path().app_local_data_dir().map_err(|err| DesktopError::Start(err.to_string()))?;
    let workspace_dir = data_dir.join("workspace");
    create_dir_all(&workspace_dir).map_err(|err| DesktopError::Start(format!("failed to create app data: {err}")))?;
    let stderr_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("sidecar.log"))
        .map_err(|err| DesktopError::Start(format!("failed to open sidecar log: {err}")))?;

    let mut command = Command::new(binary);
    command
        .current_dir(&data_dir)
        .env("QUORUM_DB_PATH", data_dir.join("quorum.sqlite"))
        .env("QUORUM_DEFAULT_WORKSPACE", &workspace_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(stderr_log));
    if let Some(path) = sidecar_path_env() {
        command.env("PATH", path);
    }
    let mut child = command
        .spawn()
        .map_err(|err| DesktopError::Start(err.to_string()))?;

    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(DesktopError::Handshake("stdout unavailable".into()));
        }
    };
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let result = reader.read_line(&mut line).map(|bytes| (bytes, line));
        let _ = tx.send(result);
    });
    let handshake = rx.recv_timeout(Duration::from_secs(10));
    let (bytes, line) = match handshake {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(DesktopError::Handshake(err.to_string()));
        }
        Err(err) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(DesktopError::Handshake(format!("timed out waiting for sidecar handshake: {err}")));
        }
    };
    if bytes == 0 {
        let _ = child.wait();
        return Err(DesktopError::EarlyExit);
    }

    let mut connection: SidecarConnection = match serde_json::from_str(line.trim()) {
        Ok(connection) => connection,
        Err(err) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(DesktopError::Handshake(err.to_string()));
        }
    };
    connection.url = format!("ws://127.0.0.1:{}?token={}", connection.port, connection.token);

    Ok((child, connection))
}

#[tauri::command]
fn get_sidecar_connection(
    app: tauri::AppHandle,
    state: State<'_, Mutex<SidecarState>>,
) -> Result<SidecarConnection, DesktopError> {
    let mut guard = state.lock().map_err(|err| DesktopError::Start(err.to_string()))?;

    if let Some(child) = guard.child.as_mut() {
        if child.try_wait().map_err(|err| DesktopError::Start(err.to_string()))?.is_none() {
            if let Some(connection) = guard.connection.clone() {
                return Ok(connection);
            }
        }
    }

    let binary = resolve_sidecar_path(&app)?;
    let (child, connection) = start_sidecar(&app, &binary)?;
    guard.child = Some(child);
    guard.connection = Some(connection.clone());
    Ok(connection)
}

#[tauri::command]
async fn pick_workspace_directory(initial_path: Option<String>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new().set_title("Choose Quorum workspace");
        if let Some(path) = initial_path.filter(|path| !path.trim().is_empty()) {
            let initial = PathBuf::from(path);
            let directory = if initial.is_dir() {
                initial
            } else {
                initial.parent().map(Path::to_path_buf).unwrap_or(initial)
            };
            dialog = dialog.set_directory(directory);
        }
        dialog.pick_folder().map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|err| format!("folder picker failed: {err}"))
}

pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(SidecarState::default()))
        .invoke_handler(tauri::generate_handler![get_sidecar_connection, pick_workspace_directory])
        .build(tauri::generate_context!())
        .expect("failed to build tauri app")
        .run(|_app, _event| {});
}
