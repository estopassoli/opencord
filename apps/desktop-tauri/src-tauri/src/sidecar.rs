//! Auxiliares nativos do app Electron reaproveitados sem mudança:
//! - oc-audio.exe (native/win-audio): som de cada saída e "tudo menos o OpenCord" para a live (ADR-0024/0025);
//! - oc-input.exe (native/win-input): mouse e teclado de quem controla este PC (ADR-0026).
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::{AppHandle, Emitter, Manager};

const NO_WINDOW: u32 = 0x0800_0000;
const EXCEPT_SELF: &str = "except-self";

pub fn exe(app: &AppHandle, name: &str) -> PathBuf {
  let res = app.path().resource_dir().ok().map(|d| d.join(name));
  match res {
    Some(p) if p.exists() => p,
    _ => std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join(name))).unwrap_or_else(|| name.into()),
  }
}

struct Running {
  child: Arc<Mutex<Child>>,
  stdin: Option<ChildStdin>,
}

struct InputSession {
  seq: u64,
  child: Arc<Mutex<Child>>,
  stdin: Option<ChildStdin>,
}

struct FileRecv {
  file: fs::File,
  path: PathBuf,
  next: u32,
  received: u64,
}

#[derive(Default)]
pub struct Sidecars {
  audio: Mutex<HashMap<String, Running>>,
  input: Mutex<Option<InputSession>>,
  seq: Mutex<u64>,
  files: Mutex<HashMap<String, FileRecv>>,
}

/// fecha o stdin (pedido de parada) e encerra à força se não sair em 2 s
fn stop_child(child: Arc<Mutex<Child>>, stdin: Option<ChildStdin>) {
  drop(stdin);
  std::thread::spawn(move || {
    std::thread::sleep(Duration::from_secs(2));
    let mut c = child.lock().unwrap();
    if matches!(c.try_wait(), Ok(None)) {
      let _ = c.kill();
    }
  });
}

pub fn stop_all(app: &AppHandle) {
  let s = app.state::<Sidecars>();
  for (_, r) in s.audio.lock().unwrap().drain() {
    stop_child(r.child, r.stdin);
  }
  stop_input(&s);
  // dá tempo de os auxiliares soltarem teclas/dispositivos antes de o processo sair
  std::thread::sleep(Duration::from_millis(150));
}

/// espera o "ready" do auxiliar no stderr (ou a saída dele) por até 5 s
fn wait_ready(child: &mut Child) -> mpsc::Receiver<bool> {
  let (tx, rx) = mpsc::channel();
  if let Some(err) = child.stderr.take() {
    std::thread::spawn(move || {
      let mut said = false;
      for line in BufReader::new(err).lines() {
        let Ok(l) = line else { break };
        if !said && l.contains("ready") {
          said = true;
          let _ = tx.send(true);
        }
      }
      if !said {
        let _ = tx.send(false);
      }
    });
  }
  rx
}

// ---------- som das saídas ----------

#[derive(Serialize, Deserialize)]
pub struct WinAudioOutput {
  id: String,
  name: String,
  default: bool,
  comm: bool,
}

#[tauri::command]
pub async fn win_audio_list(app: AppHandle) -> Vec<WinAudioOutput> {
  let path = exe(&app, "oc-audio.exe");
  tauri::async_runtime::spawn_blocking(move || {
    let out = Command::new(path).arg("list").creation_flags(NO_WINDOW).output().ok()?;
    serde_json::from_slice::<Vec<WinAudioOutput>>(&out.stdout).ok()
  })
  .await
  .ok()
  .flatten()
  .unwrap_or_default()
}

/// Começa a mandar o PCM (float32 estéreo 48 kHz) da saída pelo canal; false se a captura não começou.
#[tauri::command]
pub async fn win_audio_start(app: AppHandle, id: String, on_chunk: Channel<InvokeResponseBody>) -> bool {
  if id.is_empty() || id.len() > 256 {
    return false;
  }
  if app.state::<Sidecars>().audio.lock().unwrap().contains_key(&id) {
    return true;
  }
  let path = exe(&app, "oc-audio.exe");
  let mut cmd = Command::new(path);
  // a árvore de processos do OpenCord parte deste processo: o WebView2 é filho dele
  if id == EXCEPT_SELF {
    cmd.args(["except", &std::process::id().to_string()]);
  } else {
    cmd.args(["capture", &id]);
  }
  let Ok(mut child) =
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).creation_flags(NO_WINDOW).spawn()
  else {
    return false;
  };
  let ready = wait_ready(&mut child);
  let stdout = child.stdout.take();
  let stdin = child.stdin.take();
  let child = Arc::new(Mutex::new(child));
  app
    .state::<Sidecars>()
    .audio
    .lock()
    .unwrap()
    .insert(id.clone(), Running { child: child.clone(), stdin });
  if let Some(mut out) = stdout {
    let app2 = app.clone();
    let id2 = id.clone();
    let child2 = child.clone();
    std::thread::spawn(move || {
      const FRAME: usize = 8;
      let mut buf = vec![0u8; 64 * 1024];
      let mut rest: Vec<u8> = Vec::new();
      loop {
        let n = match out.read(&mut buf) {
          Ok(0) | Err(_) => break,
          Ok(n) => n,
        };
        rest.extend_from_slice(&buf[..n]);
        let whole = rest.len() - rest.len() % FRAME;
        if whole == 0 {
          continue;
        }
        let chunk: Vec<u8> = rest.drain(..whole).collect();
        if on_chunk.send(InvokeResponseBody::Raw(chunk)).is_err() {
          break;
        }
      }
      // saiu sozinho (dispositivo removido): tira da lista se ainda for este
      let s = app2.state::<Sidecars>();
      let mut m = s.audio.lock().unwrap();
      if m.get(&id2).map(|r| Arc::ptr_eq(&r.child, &child2)).unwrap_or(false) {
        m.remove(&id2);
      }
    });
  }
  let ok = tauri::async_runtime::spawn_blocking(move || ready.recv_timeout(Duration::from_secs(5)))
    .await
    .ok()
    .and_then(|r| r.ok());
  match ok {
    Some(v) => v,
    // sem "ready" em 5 s: vale se ainda estiver rodando
    None => app.state::<Sidecars>().audio.lock().unwrap().contains_key(&id),
  }
}

#[tauri::command]
pub fn win_audio_stop(app: AppHandle, id: String) {
  if let Some(r) = app.state::<Sidecars>().audio.lock().unwrap().remove(&id) {
    stop_child(r.child, r.stdin);
  }
}

// ---------- controle remoto ----------

#[tauri::command]
pub fn remote_input_available(app: AppHandle) -> bool {
  exe(&app, "oc-input.exe").exists()
}

#[tauri::command]
pub async fn remote_input_start(app: AppHandle) -> bool {
  stop_input(&app.state::<Sidecars>());
  let path = exe(&app, "oc-input.exe");
  if !path.exists() {
    return false;
  }
  let Ok(mut child) = Command::new(path)
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::piped())
    .creation_flags(NO_WINDOW)
    .spawn()
  else {
    return false;
  };
  let ready = wait_ready(&mut child);
  let ok = tauri::async_runtime::spawn_blocking(move || ready.recv_timeout(Duration::from_secs(5)).unwrap_or(false))
    .await
    .unwrap_or(false);
  if !ok {
    let _ = child.kill();
    return false;
  }
  let stdin = child.stdin.take();
  let child = Arc::new(Mutex::new(child));
  let seq = {
    let s = app.state::<Sidecars>();
    let mut q = s.seq.lock().unwrap();
    *q += 1;
    *q
  };
  *app.state::<Sidecars>().input.lock().unwrap() = Some(InputSession { seq, child: child.clone(), stdin });
  // o oc-input saiu sozinho: avisa a janela
  let app2 = app.clone();
  std::thread::spawn(move || loop {
    std::thread::sleep(Duration::from_millis(500));
    let exited = !matches!(child.lock().unwrap().try_wait(), Ok(None));
    let s = app2.state::<Sidecars>();
    let current = s.input.lock().unwrap().as_ref().map(|i| i.seq) == Some(seq);
    if !current {
      break;
    }
    if exited {
      stop_input(&s);
      let _ = app2.emit_to(crate::MAIN, "oc:remote-input-stop", "exit");
      break;
    }
  });
  true
}

/// Linhas já montadas pela janela (inputLine de apps/desktop/electron/shared/remote-input.ts); só o alfabeto do
/// protocolo do oc-input passa.
#[tauri::command]
pub fn remote_input_send(app: AppHandle, lines: String) {
  if lines.len() > 4096 || !lines.chars().all(|c| c.is_ascii_digit() || " -\nmbwkr".contains(c)) {
    return;
  }
  let s = app.state::<Sidecars>();
  let mut g = s.input.lock().unwrap();
  if let Some(stdin) = g.as_mut().and_then(|i| i.stdin.as_mut()) {
    let _ = stdin.write_all(lines.as_bytes());
    let _ = stdin.flush();
  }
}

fn stop_input(s: &Sidecars) {
  let Some(mut i) = s.input.lock().unwrap().take() else { return };
  for (_, f) in s.files.lock().unwrap().drain() {
    drop(f.file);
    let _ = fs::remove_file(f.path);
  }
  // "r" solta o que estiver apertado; fechar o stdin encerra
  if let Some(stdin) = i.stdin.as_mut() {
    let _ = stdin.write_all(b"r\n");
  }
  stop_child(i.child, i.stdin.take());
}

#[tauri::command]
pub fn remote_input_stop(app: AppHandle) {
  stop_input(&app.state::<Sidecars>());
}

#[tauri::command]
pub async fn remote_set_clipboard(app: AppHandle, text: String) -> Result<(), String> {
  if app.state::<Sidecars>().input.lock().unwrap().is_none() || text.chars().count() > 12_000 {
    return Ok(());
  }
  tauri::async_runtime::spawn_blocking(move || {
    Command::new("powershell.exe")
      .args(["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -Value $env:OPENCORD_TEXT"])
      .env("OPENCORD_TEXT", text)
      .creation_flags(NO_WINDOW)
      .status()
      .map(|_| ())
      .map_err(|e| e.to_string())
  })
  .await
  .map_err(|e| e.to_string())?
}

fn downloads_dir(app: &AppHandle) -> PathBuf {
  app.path().download_dir().unwrap_or_else(|_| PathBuf::from(".")).join("OpenCord")
}

#[derive(Deserialize)]
struct ChunkMeta {
  id: String,
  name: String,
  size: u64,
  index: u32,
  total: u32,
}

/// Arquivo de quem controla, em pedaços na ordem; grava em Downloads/OpenCord sem sobrescrever.
#[tauri::command]
pub fn remote_file_chunk(app: AppHandle, request: Request<'_>) -> Result<serde_json::Value, String> {
  let s = app.state::<Sidecars>();
  if s.input.lock().unwrap().is_none() {
    return Err("sem sessão de controle remoto".into());
  }
  let h = request.headers().get("x-meta").ok_or("sem metadados")?.to_str().map_err(|e| e.to_string())?;
  let c: ChunkMeta = serde_json::from_slice(&B64.decode(h).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
  let InvokeBody::Raw(data) = request.body() else { return Err("corpo inválido".into()) };
  if c.id.len() != 32 || !c.id.chars().all(|ch| ch.is_ascii_hexdigit()) || c.total == 0 || c.index >= c.total {
    return Err("pedaço inválido".into());
  }
  let mut files = s.files.lock().unwrap();
  if !files.contains_key(&c.id) {
    if c.index != 0 {
      return Err("arquivo fora de ordem".into());
    }
    let dir = downloads_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let cleaned: String = c
      .name
      .chars()
      .map(|ch| if "<>:\"|?*/\\".contains(ch) || ch.is_control() { '_' } else { ch })
      .collect::<String>()
      .trim_start_matches('.')
      .chars()
      .take(120)
      .collect();
    let safe = if cleaned.is_empty() { "arquivo".to_string() } else { cleaned };
    let p = PathBuf::from(&safe);
    let stem = p.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or(safe.clone());
    let ext = p.extension().map(|x| format!(".{}", x.to_string_lossy())).unwrap_or_default();
    let mut target = dir.join(&safe);
    let mut n = 1;
    while target.exists() {
      target = dir.join(format!("{stem} ({n}){ext}"));
      n += 1;
    }
    let file = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| e.to_string())?;
    files.insert(c.id.clone(), FileRecv { file, path: target, next: 0, received: 0 });
  }
  let f = files.get_mut(&c.id).unwrap();
  if c.index != f.next || f.received + data.len() as u64 > c.size {
    let f = files.remove(&c.id).unwrap();
    drop(f.file);
    let _ = fs::remove_file(f.path);
    return Err("arquivo fora de ordem ou maior que o anunciado".into());
  }
  f.file.write_all(data).map_err(|e| e.to_string())?;
  f.received += data.len() as u64;
  f.next += 1;
  if c.index == c.total - 1 {
    let f = files.remove(&c.id).unwrap();
    return Ok(serde_json::json!({ "done": true, "path": f.path.to_string_lossy() }));
  }
  Ok(serde_json::json!({ "done": false }))
}

#[tauri::command]
pub fn remote_reveal_file(app: AppHandle, path: String) -> Result<(), String> {
  let dir = downloads_dir(&app);
  let p = PathBuf::from(&path);
  let ok = p.parent().map(|d| d.to_string_lossy().to_lowercase() == dir.to_string_lossy().to_lowercase()).unwrap_or(false);
  if !ok || path.contains("..") {
    return Err("fora da pasta de downloads do OpenCord".into());
  }
  crate::sys::reveal(&app, &p)
}
