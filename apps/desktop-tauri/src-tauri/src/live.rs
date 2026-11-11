//! Go Live nativo (ADR-0062): o `oc-live.exe` (apps/desktop-tauri/native/oc-live) lista as fontes com miniatura e
//! transmite fora do WebView (captura do Windows → H.264 da placa → LiveKit). Aqui só se abre o processo, passa a
//! configuração e repassa os avisos dele para a interface (evento `live-event`).

use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::sidecar::exe;

const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct Live {
  run: Mutex<Option<(Arc<Mutex<Child>>, Option<ChildStdin>)>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartArgs {
  url: String,
  token: String,
  source_id: String,
  width: u32,
  height: u32,
  fps: u32,
  bitrate: u32,
  audio: bool,
  cursor: bool,
}

/// telas e janelas com miniatura (o próprio app fica de fora)
#[tauri::command]
pub async fn live_sources(app: AppHandle) -> Result<Vec<Value>, String> {
  let path = exe(&app, "oc-live.exe");
  tauri::async_runtime::spawn_blocking(move || {
    let out = Command::new(path)
      .args(["sources", &std::process::id().to_string()])
      .creation_flags(NO_WINDOW)
      .output()
      .map_err(|e| format!("oc-live não abriu: {e}"))?;
    serde_json::from_slice::<Vec<Value>>(&out.stdout).map_err(|e| format!("lista de fontes inválida: {e}"))
  })
  .await
  .map_err(|e| e.to_string())?
}

fn stop_running(live: &Live) {
  if let Some((child, stdin)) = live.run.lock().unwrap().take() {
    if let Some(mut s) = stdin {
      let _ = s.write_all(b"stop\n");
      let _ = s.flush();
    }
    std::thread::spawn(move || {
      // dá tempo de sair da sala direito (o LiveKit avisa quem assiste); senão, encerra à força
      for _ in 0..50 {
        if !matches!(child.lock().unwrap().try_wait(), Ok(None)) {
          return;
        }
        std::thread::sleep(Duration::from_millis(100));
      }
      let _ = child.lock().unwrap().kill();
    });
  }
}

/// Começa a live; responde quando ela está publicada (`{ encoder, audio }`) ou com o erro do oc-live.
/// Erro `no-hw-encoder:` = a placa não tem encoder H.264 (o app volta para a captura do WebView).
#[tauri::command]
pub async fn live_start(app: AppHandle, args: StartArgs) -> Result<Value, String> {
  let live = app.state::<Live>();
  stop_running(&live);
  let cfg = json!({
    "url": args.url,
    "token": args.token,
    "source": args.source_id,
    "width": args.width,
    "height": args.height,
    "fps": args.fps,
    "bitrate": args.bitrate,
    "cursor": args.cursor,
    // som de todos os programas menos o OpenCord (e os processos dele: WebView2)
    "audioExceptPid": if args.audio { Some(std::process::id()) } else { None },
    "ocAudio": if args.audio { Some(exe(&app, "oc-audio.exe").to_string_lossy().to_string()) } else { None },
  });
  let mut child = Command::new(exe(&app, "oc-live.exe"))
    .arg("run")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::null())
    .creation_flags(NO_WINDOW)
    .spawn()
    .map_err(|e| format!("oc-live não abriu: {e}"))?;
  let mut stdin = child.stdin.take();
  if let Some(s) = stdin.as_mut() {
    s.write_all(format!("{cfg}\n").as_bytes()).map_err(|e| e.to_string())?;
    s.flush().map_err(|e| e.to_string())?;
  }
  let stdout = child.stdout.take().ok_or("oc-live sem saída")?;
  let child = Arc::new(Mutex::new(child));
  *live.run.lock().unwrap() = Some((child.clone(), stdin));

  // os avisos do oc-live vão para a interface; o primeiro "publishing" ou "error" responde este pedido
  let (tx, rx) = mpsc::channel::<Result<Value, String>>();
  let emitter = app.clone();
  std::thread::spawn(move || {
    let mut tx = Some(tx);
    for line in BufReader::new(stdout).lines() {
      let Ok(line) = line else { break };
      let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
      let ev = v.get("ev").and_then(Value::as_str).unwrap_or("");
      if let Some(t) = tx.as_ref() {
        if ev == "publishing" {
          let _ = t.send(Ok(json!({ "encoder": v["encoder"], "audio": v["audio"] })));
          tx = None;
        } else if ev == "error" {
          let code = v.get("code").and_then(Value::as_str).unwrap_or("");
          let msg = v.get("message").and_then(Value::as_str).unwrap_or("erro");
          let _ = t.send(Err(if code.is_empty() { msg.to_string() } else { format!("{code}: {msg}") }));
          tx = None;
        }
      }
      let _ = emitter.emit("live-event", v);
    }
    // o processo acabou (parou, caiu ou a sala fechou)
    if let Some(t) = tx {
      let _ = t.send(Err("a live nativa encerrou antes de começar".into()));
    }
    let _ = emitter.emit("live-event", json!({ "ev": "exited" }));
  });
  tauri::async_runtime::spawn_blocking(move || {
    rx.recv_timeout(Duration::from_secs(20)).unwrap_or_else(|_| Err("a live nativa não respondeu".into()))
  })
  .await
  .map_err(|e| e.to_string())?
  .inspect_err(|_| stop_running(&app.state::<Live>()))
}

#[tauri::command]
pub fn live_stop(app: AppHandle) {
  stop_running(&app.state::<Live>());
}

pub fn stop_all(app: &AppHandle) {
  stop_running(&app.state::<Live>());
}
