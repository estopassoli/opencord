//! Clipes (ADR-0022), mesmo formato do Electron (apps/desktop/electron/main/clips.ts): `<nome>.mp4` com `<nome>.json`
//! (jogo, ícone, data, duração) e `<nome>.jpg` (miniatura) ao lado, na pasta escolhida (padrão Vídeos\OpenCord).
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

fn dir_file(app: &AppHandle) -> Option<PathBuf> {
  app.path().app_data_dir().ok().map(|d| d.join("clips-dir.json"))
}

fn current_dir(app: &AppHandle) -> PathBuf {
  if let Some(f) = dir_file(app) {
    if let Ok(s) = fs::read_to_string(f) {
      if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
        if let Some(d) = v.get("dir").and_then(|d| d.as_str()) {
          let p = PathBuf::from(d);
          if p.is_absolute() {
            return p;
          }
        }
      }
    }
  }
  app.path().video_dir().unwrap_or_else(|_| PathBuf::from(".")).join("OpenCord")
}

#[tauri::command]
pub fn clips_dir(app: AppHandle) -> String {
  current_dir(&app).to_string_lossy().into()
}

#[tauri::command]
pub async fn clips_choose_dir(app: AppHandle) -> Result<String, String> {
  let a = app.clone();
  let picked = tauri::async_runtime::spawn_blocking(move || {
    a.dialog().file().set_title("Pasta dos clipes").set_directory(current_dir(&a)).blocking_pick_folder()
  })
  .await
  .map_err(|e| e.to_string())?;
  if let Some(p) = picked.and_then(|p| p.into_path().ok()) {
    if let Some(f) = dir_file(&app) {
      if let Some(d) = f.parent() {
        let _ = fs::create_dir_all(d);
      }
      fs::write(f, serde_json::json!({ "dir": p.to_string_lossy() }).to_string()).map_err(|e| e.to_string())?;
    }
  }
  Ok(clips_dir(app))
}

/// caracteres proibidos em nomes de arquivo do Windows (e de controle)
fn safe(s: &str) -> String {
  let t: String = s.chars().filter(|c| (*c as u32) >= 32 && !"<>:\"/\\|?*".contains(*c)).collect();
  let t = t.trim().to_string();
  if t.is_empty() {
    "Clipe".into()
  } else {
    t
  }
}

fn stamp() -> String {
  // horário local pelo próprio Windows (sem crate de datas)
  #[cfg(windows)]
  {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!("{:04}-{:02}-{:02} {:02}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond)
  }
}

fn now_ms() -> u64 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Sidecar {
  #[serde(default)]
  game: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  icon: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  steam_app_id: Option<u64>,
  #[serde(default)]
  created_at: Option<f64>,
  #[serde(default)]
  duration_ms: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveMeta {
  game: String,
  duration_ms: u64,
  icon: Option<String>,
  steam_app_id: Option<u64>,
  thumb_len: usize,
}

fn meta<T: for<'de> Deserialize<'de>>(req: &Request<'_>) -> Result<T, String> {
  let h = req.headers().get("x-meta").ok_or("sem metadados")?.to_str().map_err(|e| e.to_string())?;
  let raw = B64.decode(h).map_err(|e| e.to_string())?;
  serde_json::from_slice(&raw).map_err(|e| e.to_string())
}

fn body<'a>(req: &'a Request<'_>) -> Result<&'a [u8], String> {
  match req.body() {
    InvokeBody::Raw(b) => Ok(b),
    _ => Err("corpo inválido".into()),
  }
}

/// Corpo: miniatura JPEG (thumbLen bytes) seguida do MP4. Metadados em `x-meta` (JSON em base64).
#[tauri::command]
pub fn clips_save(app: AppHandle, request: Request<'_>) -> Result<String, String> {
  let m: SaveMeta = meta(&request)?;
  let all = body(&request)?;
  if m.thumb_len > 512 * 1024 || m.thumb_len >= all.len() || m.game.chars().count() > 64 {
    return Err("clipe inválido".into());
  }
  if let Some(i) = &m.icon {
    if i.len() > 16 * 1024 || !i.starts_with("data:image/png;base64,") {
      return Err("ícone inválido".into());
    }
  }
  let (thumb, data) = all.split_at(m.thumb_len);
  let dir = current_dir(&app);
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let base = dir.join(format!("{} {}", safe(&m.game), stamp()));
  let file = base.with_extension("mp4");
  fs::write(&file, data).map_err(|e| e.to_string())?;
  let side = Sidecar {
    game: Some(m.game),
    icon: m.icon,
    steam_app_id: m.steam_app_id,
    created_at: Some(now_ms() as f64),
    duration_ms: Some(m.duration_ms.min(600_000) as f64),
  };
  fs::write(base.with_extension("json"), serde_json::to_string(&side).map_err(|e| e.to_string())?)
    .map_err(|e| e.to_string())?;
  if !thumb.is_empty() {
    fs::write(base.with_extension("jpg"), thumb).map_err(|e| e.to_string())?;
  }
  Ok(file.to_string_lossy().into())
}

/// Só arquivos .mp4 dentro da pasta de clipes (nada de caminhos vindos da janela fora dela).
fn inside(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
  let p = PathBuf::from(file);
  let ok_ext = p.extension().map(|e| e.eq_ignore_ascii_case("mp4")).unwrap_or(false);
  let dir = current_dir(app);
  let parent_ok = p.parent().map(|d| same_path(d, &dir)).unwrap_or(false);
  if !ok_ext || !parent_ok || file.contains("..") {
    return Err("fora da pasta de clipes".into());
  }
  Ok(p)
}

fn same_path(a: &Path, b: &Path) -> bool {
  a.to_string_lossy().trim_end_matches('\\').to_lowercase() == b.to_string_lossy().trim_end_matches('\\').to_lowercase()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipInfo {
  file: String,
  name: String,
  game: Option<String>,
  icon: Option<String>,
  steam_app_id: Option<u64>,
  created_at: f64,
  duration_ms: f64,
  size_bytes: u64,
  thumb: Option<String>,
}

#[tauri::command]
pub async fn clips_list(app: AppHandle) -> Vec<ClipInfo> {
  tauri::async_runtime::spawn_blocking(move || {
    let dir = current_dir(&app);
    let Ok(rd) = fs::read_dir(&dir) else { return vec![] };
    let mut out = vec![];
    for e in rd.flatten() {
      let file = e.path();
      if !file.extension().map(|x| x.eq_ignore_ascii_case("mp4")).unwrap_or(false) {
        continue;
      }
      let Ok(st) = e.metadata() else { continue };
      if !st.is_file() {
        continue;
      }
      let side: Sidecar = fs::read_to_string(file.with_extension("json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
      let mtime = st
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
      let thumb = fs::read(file.with_extension("jpg")).ok().map(|b| format!("data:image/jpeg;base64,{}", B64.encode(b)));
      out.push(ClipInfo {
        name: file.file_stem().map(|s| s.to_string_lossy().into()).unwrap_or_default(),
        file: file.to_string_lossy().into(),
        game: side.game,
        icon: side.icon,
        steam_app_id: side.steam_app_id,
        created_at: side.created_at.unwrap_or(mtime),
        duration_ms: side.duration_ms.unwrap_or(0.0),
        size_bytes: st.len(),
        thumb,
      });
    }
    out.sort_by(|a, b| b.created_at.partial_cmp(&a.created_at).unwrap_or(std::cmp::Ordering::Equal));
    out.truncate(200);
    out
  })
  .await
  .unwrap_or_default()
}

#[tauri::command]
pub async fn clips_read(app: AppHandle, path: String) -> Result<Response, String> {
  let p = inside(&app, &path)?;
  let data = tauri::async_runtime::spawn_blocking(move || fs::read(p)).await.map_err(|e| e.to_string())?;
  Ok(Response::new(data.map_err(|e| e.to_string())?))
}

#[tauri::command]
pub fn clips_remove(app: AppHandle, path: String) -> Result<(), String> {
  let p = inside(&app, &path)?;
  for f in [p.clone(), p.with_extension("json"), p.with_extension("jpg")] {
    let _ = fs::remove_file(f);
  }
  Ok(())
}

#[tauri::command]
pub fn clips_reveal(app: AppHandle, path: String) -> Result<(), String> {
  let p = inside(&app, &path)?;
  crate::sys::reveal(&app, &p)
}

/// Copia o arquivo para a área de transferência (lista de arquivos, CF_HDROP) pelo PowerShell, como no Electron.
#[tauri::command]
pub async fn clips_copy(app: AppHandle, path: String) -> Result<(), String> {
  let p = inside(&app, &path)?;
  tauri::async_runtime::spawn_blocking(move || {
    use std::os::windows::process::CommandExt;
    let st = std::process::Command::new("powershell.exe")
      .args(["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -LiteralPath $env:OPENCORD_CLIP"])
      // o caminho vai por variável de ambiente, nunca dentro do script
      .env("OPENCORD_CLIP", p)
      .creation_flags(0x0800_0000)
      .status()
      .map_err(|e| e.to_string())?;
    if st.success() {
      Ok(())
    } else {
      Err("não foi possível copiar".into())
    }
  })
  .await
  .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
struct ExportMeta {
  kind: String,
  name: String,
}

/// "Salvar como" de um vídeo/áudio cortado na janela; devolve o caminho ou null se cancelou.
#[tauri::command]
pub async fn clips_export(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
  let m: ExportMeta = meta(&request)?;
  let data = body(&request)?.to_vec();
  if data.is_empty() || m.name.chars().count() > 120 {
    return Err("arquivo inválido".into());
  }
  let audio = m.kind == "audio";
  let ext = if audio { "m4a" } else { "mp4" };
  let a = app.clone();
  let name = format!("{}.{ext}", safe(&m.name));
  let picked = tauri::async_runtime::spawn_blocking(move || {
    a.dialog()
      .file()
      .set_title(if audio { "Exportar áudio do clipe" } else { "Exportar clipe" })
      .set_directory(current_dir(&a))
      .set_file_name(name)
      .add_filter(if audio { "Áudio" } else { "Vídeo" }, &[ext])
      .blocking_save_file()
  })
  .await
  .map_err(|e| e.to_string())?;
  let Some(p) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
  fs::write(&p, data).map_err(|e| e.to_string())?;
  Ok(Some(p.to_string_lossy().into()))
}
