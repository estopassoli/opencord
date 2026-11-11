//! Atualização automática do app em Tauri, com as mesmas regras do Electron (ADR-0051, `update-core.ts`):
//! consulta `/downloads/desktop` do servidor do app, baixa o instalador mais novo (mesma origem, https; http só em
//! localhost), confere tamanho e SHA-256 publicados e instala:
//! - ao encerrar o OpenCord (silencioso, sem reabrir);
//! - sozinho com a pessoa longe do PC e fora de chamada/jogo (silencioso, reabre);
//! - na hora, em "Reiniciar e atualizar agora" (com a janela do instalador, reabre).
//! A interface recebe o estado pelo evento `update-status` (o mesmo `UpdateStatus` do Electron).

use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const FIRST_CHECK: Duration = Duration::from_secs(15);
const CHECK_EVERY: Duration = Duration::from_secs(20 * 60);
/// sem teclado/mouse por este tempo com a janela aberta (ou este outro com ela escondida): a pessoa saiu de perto
const IDLE_VISIBLE_S: u64 = 10 * 60;
const IDLE_HIDDEN_S: u64 = 2 * 60;

#[derive(Clone)]
enum State {
  Idle,
  Downloading { version: String, progress: u32 },
  Ready { version: String, path: PathBuf, sha256: String },
}

#[derive(Default)]
pub struct Updater {
  state: Mutex<Option<State>>,
  busy: AtomicBool,
  launched: AtomicBool,
  /// jogo aberto (a detecção de jogos fica na interface; ela avisa aqui)
  pub game_running: AtomicBool,
}

fn status_json(s: &State) -> Value {
  match s {
    State::Idle => json!({ "state": "idle" }),
    State::Downloading { version, progress } => json!({ "state": "downloading", "version": version, "progress": progress }),
    State::Ready { version, .. } => json!({ "state": "ready", "version": version }),
  }
}

fn set(app: &AppHandle, s: State) {
  let up = app.state::<Updater>();
  let _ = app.emit("update-status", status_json(&s));
  *up.state.lock().unwrap() = Some(s);
}

fn current(app: &AppHandle) -> State {
  app.state::<Updater>().state.lock().unwrap().clone().unwrap_or(State::Idle)
}

// ---------- regras puras (iguais ao update-core.ts) ----------

fn parse(v: &str) -> Option<[u64; 3]> {
  let mut it = v.trim().split('.');
  let a = [it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?];
  it.next().is_none().then_some(a)
}

/// `candidate` é estritamente mais nova que `current` (x.y.z); versões inválidas nunca contam
pub fn is_newer(candidate: &str, current: &str) -> bool {
  match (parse(candidate), parse(current)) {
    (Some(a), Some(b)) => a > b,
    _ => false,
  }
}

fn valid_name(n: &str) -> bool {
  (1..=124).contains(&n.len())
    && n.to_lowercase().ends_with(".exe")
    && n.chars().all(|c| c.is_ascii_alphanumeric() || " ._()-".contains(c))
}

/// mesma origem do servidor, /downloads/files/<nome válido>, https (http só em localhost)
pub fn trusted_url(url: &str, server: &str) -> bool {
  let (Ok(u), Ok(s)) = (url::Url::parse(url), url::Url::parse(server)) else { return false };
  if u.origin() != s.origin() || !u.username().is_empty() || u.password().is_some() {
    return false;
  }
  let local = matches!(u.host_str(), Some("localhost") | Some("127.0.0.1"));
  if u.scheme() != "https" && !(local && u.scheme() == "http") {
    return false;
  }
  let Some(name) = u.path().strip_prefix("/downloads/files/") else { return false };
  let name = percent_decode(name);
  !name.contains('/') && valid_name(&name)
}

fn percent_decode(s: &str) -> String {
  let b = s.as_bytes();
  let mut out = Vec::with_capacity(b.len());
  let mut i = 0;
  while i < b.len() {
    if b[i] == b'%' && i + 2 < b.len() {
      if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
        out.push(v);
        i += 3;
        continue;
      }
    }
    out.push(b[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).into_owned()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopFile {
  platform: String,
  arch: String,
  format: String,
  url: String,
  file_name: Option<String>,
  version: Option<String>,
  size_bytes: Option<u64>,
  sha256: Option<String>,
}

#[derive(Deserialize)]
struct Listing {
  #[serde(default)]
  files: Vec<DesktopFile>,
}

fn is_sha256(s: &str) -> bool {
  s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

// ---------- verificação e download ----------

fn app_version(app: &AppHandle) -> String {
  app.package_info().version.to_string()
}

fn server_url(app: &AppHandle) -> Option<String> {
  crate::sys::secure_read(app, "serverUrl")
}

fn check_blocking(app: &AppHandle) -> Result<(), String> {
  let server = server_url(app).ok_or("sem servidor configurado")?;
  // com uma versão já baixada, só interessa uma ainda mais nova
  let baseline = match current(app) {
    State::Ready { version, .. } => version,
    _ => app_version(app),
  };
  let list_url = url::Url::parse(&server).and_then(|s| s.join("/downloads/desktop")).map_err(|e| e.to_string())?;
  let body: Listing = ureq::get(list_url.as_str())
    .timeout(Duration::from_secs(20))
    .call()
    .map_err(|e| e.to_string())?
    .into_json()
    .map_err(|e| e.to_string())?;
  let Some(f) = body.files.into_iter().find(|f| f.platform == "windows" && f.arch == "x64" && f.format == "exe") else {
    return Ok(());
  };
  let (Some(version), Some(name)) = (f.version.clone(), f.file_name.clone()) else { return Ok(()) };
  if !valid_name(&name) || !is_newer(&version, &baseline) || !trusted_url(&f.url, &server) {
    return Ok(());
  }
  let dir = std::env::temp_dir().join("opencord-update").join(&version);
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let file = dir.join(&name);
  set(app, State::Downloading { version: version.clone(), progress: 0 });
  let res = ureq::get(&f.url).timeout(Duration::from_secs(30 * 60)).call().map_err(|e| e.to_string())?;
  let total = f.size_bytes.or_else(|| res.header("content-length").and_then(|v| v.parse().ok())).unwrap_or(0);
  let mut reader = res.into_reader();
  let mut out = std::fs::File::create(&file).map_err(|e| e.to_string())?;
  let mut hash = Sha256::new();
  let mut buf = vec![0u8; 256 * 1024];
  let (mut received, mut last_pct) = (0u64, u32::MAX);
  loop {
    let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
    if n == 0 {
      break;
    }
    out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
    hash.update(&buf[..n]);
    received += n as u64;
    let pct = if total > 0 { (received * 100 / total) as u32 } else { 0 };
    if pct != last_pct {
      last_pct = pct;
      set(app, State::Downloading { version: version.clone(), progress: pct });
    }
  }
  drop(out);
  let digest = format!("{:x}", hash.finalize());
  if let Some(size) = f.size_bytes {
    if received != size {
      let _ = std::fs::remove_dir_all(&dir);
      return Err("tamanho do instalador não confere".into());
    }
  }
  // hash publicado mas malformado conta como falha; sem hash (servidor antigo) vale a origem e o tamanho
  if let Some(expected) = f.sha256.as_deref() {
    if !is_sha256(expected) || !expected.eq_ignore_ascii_case(&digest) {
      let _ = std::fs::remove_dir_all(&dir);
      return Err(format!("SHA-256 do instalador {version} não confere com o publicado"));
    }
  }
  set(app, State::Ready { version, path: file, sha256: digest });
  Ok(())
}

pub fn check(app: &AppHandle) {
  let up = app.state::<Updater>();
  if up.busy.swap(true, Ordering::AcqRel) {
    return;
  }
  let prev = current(app);
  if let Err(e) = check_blocking(app) {
    eprintln!("verificação de atualização falhou: {e}");
    if matches!(current(app), State::Downloading { .. }) {
      set(app, if matches!(prev, State::Downloading { .. }) { State::Idle } else { prev });
    }
  }
  up.busy.store(false, Ordering::Release);
}

/// o arquivo na pasta temporária ainda é o que foi baixado e conferido?
fn intact(path: &PathBuf, sha: &str) -> bool {
  let Ok(mut f) = std::fs::File::open(path) else { return false };
  let mut h = Sha256::new();
  let mut buf = vec![0u8; 256 * 1024];
  loop {
    match f.read(&mut buf) {
      Ok(0) => break,
      Ok(n) => h.update(&buf[..n]),
      Err(_) => return false,
    }
  }
  format!("{:x}", h.finalize()).eq_ignore_ascii_case(sha)
}

/// `manual`: com a janela do instalador e reabre; `auto`: silencioso e reabre; `quit`: silencioso, não reabre
fn launch(app: &AppHandle, mode: &str) -> bool {
  let State::Ready { path, sha256, .. } = current(app) else { return false };
  let up = app.state::<Updater>();
  if up.launched.load(Ordering::Acquire) {
    return false;
  }
  if !intact(&path, &sha256) {
    eprintln!("instalador da atualização mudou depois do download; descartado");
    set(app, State::Idle);
    return false;
  }
  let args: &[&str] = match mode {
    "manual" => &["--updated", "--force-run"],
    "auto" => &["/S", "--updated", "--force-run"],
    _ => &["/S", "--updated"],
  };
  if std::process::Command::new(&path).args(args).spawn().is_ok() {
    up.launched.store(true, Ordering::Release);
    return true;
  }
  false
}

/// ao encerrar o app: instala em silêncio (a próxima abertura já é a versão nova)
pub fn install_on_quit(app: &AppHandle) {
  launch(app, "quit");
}

fn should_auto_install(app: &AppHandle) -> bool {
  if !matches!(current(app), State::Ready { .. }) || app.state::<Updater>().game_running.load(Ordering::Acquire) {
    return false;
  }
  if crate::in_voice(app) {
    return false;
  }
  let visible = app.get_webview_window("main").map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false)).unwrap_or(false);
  let idle = crate::sys::idle_seconds();
  idle >= if visible { IDLE_VISIBLE_S } else { IDLE_HIDDEN_S }
}

/// verificação ao abrir (15 s), a cada 20 min, e instalação sozinha quando der
pub fn start(app: AppHandle) {
  std::thread::spawn(move || {
    std::thread::sleep(FIRST_CHECK);
    let mut last = Instant::now() - CHECK_EVERY;
    loop {
      if last.elapsed() >= CHECK_EVERY {
        check(&app);
        last = Instant::now();
      }
      if should_auto_install(&app) && launch(&app, "auto") {
        crate::shutdown(&app);
        return;
      }
      std::thread::sleep(Duration::from_secs(30));
    }
  });
}

// ---------- comandos da interface ----------

#[tauri::command]
pub fn update_status(app: AppHandle) -> Value {
  status_json(&current(&app))
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Value {
  let a = app.clone();
  let _ = tauri::async_runtime::spawn_blocking(move || check(&a)).await;
  status_json(&current(&app))
}

/// "Reiniciar e atualizar agora"
#[tauri::command]
pub fn update_install(app: AppHandle) {
  if launch(&app, "manual") {
    crate::shutdown(&app);
  }
}

#[tauri::command]
pub fn update_game_running(app: AppHandle, running: bool) {
  app.state::<Updater>().game_running.store(running, Ordering::Release);
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn versao_mais_nova_so_em_x_y_z() {
    assert!(is_newer("0.3.1", "0.3.0"));
    assert!(is_newer("0.3.0", "0.2.393"));
    assert!(!is_newer("0.3.0", "0.3.0"));
    assert!(!is_newer("0.3.0-tauri", "0.2.0"));
    assert!(!is_newer("x", "0.1.0"));
  }

  #[test]
  fn instalador_so_da_mesma_origem_por_https() {
    let s = "https://api.opencord.pro";
    assert!(trusted_url("https://api.opencord.pro/downloads/files/OpenCord-Setup-0.3.1.exe", s));
    assert!(trusted_url("https://api.opencord.pro/downloads/files/OpenCord%20Setup%200.3.1.exe", s));
    assert!(!trusted_url("http://api.opencord.pro/downloads/files/a.exe", s));
    assert!(!trusted_url("https://evil.example/downloads/files/a.exe", s));
    assert!(!trusted_url("https://api.opencord.pro/downloads/files/../a.exe", s));
    assert!(!trusted_url("https://api.opencord.pro/other/a.exe", s));
    assert!(trusted_url("http://localhost:3000/downloads/files/a.exe", "http://localhost:3000"));
  }
}
