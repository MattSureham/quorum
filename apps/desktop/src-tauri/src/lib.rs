use serde::Serialize;
use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
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

fn dev_sidecar_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join("dist-sidecar/bun/quorum-sidecar")
}

fn bundled_sidecar_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    Some(resource_dir.join("sidecars/quorum-sidecar"))
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

fn start_sidecar(binary: &Path) -> Result<(Child, SidecarConnection), DesktopError> {
    let mut child = Command::new(binary)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|err| DesktopError::Start(err.to_string()))?;

    let stdout = child.stdout.take().ok_or_else(|| DesktopError::Handshake("stdout unavailable".into()))?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let bytes = reader
        .read_line(&mut line)
        .map_err(|err| DesktopError::Handshake(err.to_string()))?;

    if bytes == 0 {
        return Err(DesktopError::EarlyExit);
    }

    let mut connection: SidecarConnection =
        serde_json::from_str(line.trim()).map_err(|err| DesktopError::Handshake(err.to_string()))?;
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
    let (child, connection) = start_sidecar(&binary)?;
    guard.child = Some(child);
    guard.connection = Some(connection.clone());
    Ok(connection)
}

pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(SidecarState::default()))
        .invoke_handler(tauri::generate_handler![get_sidecar_connection])
        .build(tauri::generate_context!())
        .expect("failed to build tauri app")
        .run(|_app, _event| {});
}
