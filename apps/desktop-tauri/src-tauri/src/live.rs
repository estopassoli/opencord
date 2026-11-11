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
  /// o replay dos clipes (oc-live clip)
  clip: Mutex<Option<(Arc<Mutex<Child>>, Option<ChildStdin>)>>,
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
  stop_slot(&live.run);
}

fn stop_slot(slot: &Mutex<Option<(Arc<Mutex<Child>>, Option<ChildStdin>)>>) {
  if let Some((child, stdin)) = slot.lock().unwrap().take() {
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
  let live = app.state::<Live>();
  stop_running(&live);
  stop_slot(&live.clip);
}

// ---------- replay dos clipes (oc-live clip) ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipArgs {
  max_width: u32,
  max_height: u32,
  fps: u32,
  bitrate: u32,
  key_every_sec: u32,
  cursor: bool,
}

/// Começa a gravar a tela para o replay: cada quadro (cabeçalho de 13 bytes + H.264) vai pelo canal. Responde
/// `{ width, height }` quando o encoder está pronto; erro começando com `no-hw-encoder` = placa sem H.264.
#[tauri::command]
pub async fn clips_native_start(
  app: AppHandle,
  args: ClipArgs,
  on_chunk: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> Result<Value, String> {
  let live = app.state::<Live>();
  stop_slot(&live.clip);
  let cfg = json!({
    "maxWidth": args.max_width,
    "maxHeight": args.max_height,
    "fps": args.fps,
    "bitrate": args.bitrate,
    "keyEverySec": args.key_every_sec,
    "cursor": args.cursor,
  });
  let mut child = Command::new(exe(&app, "oc-live.exe"))
    .arg("clip")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .creation_flags(NO_WINDOW)
    .spawn()
    .map_err(|e| format!("oc-live não abriu: {e}"))?;
  let mut stdin = child.stdin.take();
  if let Some(s) = stdin.as_mut() {
    s.write_all(format!("{cfg}\n").as_bytes()).map_err(|e| e.to_string())?;
    s.flush().map_err(|e| e.to_string())?;
  }
  let stdout = child.stdout.take().ok_or("oc-live sem saída")?;
  let stderr = child.stderr.take().ok_or("oc-live sem saída de erro")?;
  let child = Arc::new(Mutex::new(child));
  *live.clip.lock().unwrap() = Some((child.clone(), stdin));
  // "ready <w> <h>" ou "error <motivo>" no stderr
  let (tx, rx) = mpsc::channel::<Result<Value, String>>();
  std::thread::spawn(move || {
    let mut tx = Some(tx);
    for line in BufReader::new(stderr).lines() {
      let Ok(line) = line else { break };
      let Some(t) = tx.take() else { continue };
      let mut it = line.split_whitespace();
      match it.next() {
        Some("ready") => {
          let w: u32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0);
          let h: u32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0);
          let _ = t.send(Ok(json!({ "width": w, "height": h })));
        }
        Some("error") => {
          let _ = t.send(Err(line.trim_start_matches("error ").to_string()));
        }
        _ => tx = Some(t),
      }
    }
    if let Some(t) = tx {
      let _ = t.send(Err("a gravação dos clipes encerrou antes de começar".into()));
    }
  });
  // os quadros vão inteiros (cabeçalho + dados) pelo canal; a interface monta o replay
  let emitter = app.clone();
  std::thread::spawn(move || {
    let mut out = BufReader::with_capacity(1 << 20, stdout);
    loop {
      let mut head = [0u8; 13];
      if std::io::Read::read_exact(&mut out, &mut head).is_err() {
        break;
      }
      let n = u32::from_le_bytes([head[0], head[1], head[2], head[3]]) as usize;
      if n > 64 << 20 {
        break;
      }
      let mut buf = Vec::with_capacity(13 + n);
      buf.extend_from_slice(&head);
      buf.resize(13 + n, 0);
      if std::io::Read::read_exact(&mut out, &mut buf[13..]).is_err() {
        break;
      }
      if on_chunk.send(tauri::ipc::InvokeResponseBody::Raw(buf)).is_err() {
        break;
      }
    }
    let _ = emitter.emit("clips-native-ended", json!({}));
  });
  let res = tauri::async_runtime::spawn_blocking(move || {
    rx.recv_timeout(Duration::from_secs(15)).unwrap_or_else(|_| Err("a gravação dos clipes não respondeu".into()))
  })
  .await
  .map_err(|e| e.to_string())?;
  if res.is_err() {
    stop_slot(&app.state::<Live>().clip);
  }
  res
}

#[tauri::command]
pub fn clips_native_stop(app: AppHandle) {
  stop_slot(&app.state::<Live>().clip);
}
