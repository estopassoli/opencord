//! Janelas auxiliares, as mesmas do Electron:
//! - overlay no jogo (ADR-0027): transparente, sempre no topo, deixa o clique passar, no canto do monitor principal;
//! - faixa do controle remoto (ADR-0026): "<nome> está controlando seu PC" com o botão Parar.
//! Os comandos são assíncronos: criar janela num comando síncrono trava a thread principal no Windows.
//! Todas usam os mesmos argumentos do WebView2 da janela principal (o ambiente do WebView2 é um só por processo).
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const OVERLAY: &str = "overlay";
const BANNER: &str = "banner";
const OV_W: f64 = 340.0;
const OV_H: f64 = 420.0;
const MARGIN: f64 = 12.0;

static LAST: Mutex<Option<Value>> = Mutex::new(None);

fn args(app: &AppHandle) -> String {
  crate::browser_args(app.state::<crate::AppState>().gpu_off_active)
}

fn place_overlay(app: &AppHandle, w: &WebviewWindow, corner: &str) {
  let Ok(Some(m)) = app.primary_monitor() else { return };
  let s = m.scale_factor();
  let wa = m.work_area();
  let (w_px, h_px, mg) = ((OV_W * s) as i32, (OV_H * s) as i32, (MARGIN * s) as i32);
  let left = corner == "tl" || corner == "bl";
  let top = corner == "tl" || corner == "tr";
  let x = if left { wa.position.x + mg } else { wa.position.x + wa.size.width as i32 - w_px - mg };
  let y = if top { wa.position.y + mg } else { wa.position.y + wa.size.height as i32 - h_px - mg };
  let _ = w.set_size(PhysicalSize::new(w_px as u32, h_px as u32));
  let _ = w.set_position(PhysicalPosition::new(x, y));
}

/// Estado mandado pela janela principal (validado lá com o OverlayState de apps/desktop/electron/shared/overlay.ts).
#[tauri::command]
pub async fn overlay_update(app: AppHandle, state: Value) -> Result<(), String> {
  let visible = state.get("visible").and_then(|v| v.as_bool()).unwrap_or(false);
  if !visible {
    *LAST.lock().unwrap() = None;
    // fechar em vez de esconder: sem jogo aberto, o overlay não deixa um processo do WebView2 ocupando memória
    if let Some(w) = app.get_webview_window(OVERLAY) {
      let _ = w.destroy();
    }
    return Ok(());
  }
  let corner = state.get("corner").and_then(|v| v.as_str()).unwrap_or("tl").to_string();
  let bottom = corner == "bl" || corner == "br";
  let mut payload = state.clone();
  if let Some(o) = payload.as_object_mut() {
    o.insert("bottom".into(), Value::Bool(bottom));
  }
  *LAST.lock().unwrap() = Some(payload.clone());
  if let Some(w) = app.get_webview_window(OVERLAY) {
    place_overlay(&app, &w, &corner);
    let _ = w.emit_to(OVERLAY, "overlay:state", payload);
    return Ok(());
  }
  let w = WebviewWindowBuilder::new(&app, OVERLAY, WebviewUrl::App("overlay.html".into()))
    .title("OpenCord overlay")
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .focused(false)
    .focusable(false)
    .visible(false)
    .additional_browser_args(&args(&app))
    .on_navigation(|u| u.host_str() == Some("tauri.localhost"))
    .on_page_load(|w, p| {
      if matches!(p.event(), tauri::webview::PageLoadEvent::Finished) {
        if let Some(s) = LAST.lock().unwrap().clone() {
          let _ = w.emit_to(OVERLAY, "overlay:state", s);
        }
        let _ = w.show();
      }
    })
    .build()
    .map_err(|e| e.to_string())?;
  let _ = w.set_ignore_cursor_events(true);
  place_overlay(&app, &w, &corner);
  Ok(())
}

/// O overlay acabou de carregar e pede o último estado (o evento mandado antes de ele escutar se perde).
#[tauri::command]
pub fn overlay_state() -> Option<Value> {
  LAST.lock().unwrap().clone()
}

/// Faixa no topo do monitor principal enquanto alguém controla este PC.
#[tauri::command]
pub async fn banner_show(app: AppHandle, controller: String) -> Result<(), String> {
  if let Some(w) = app.get_webview_window(BANNER) {
    let _ = w.destroy();
  }
  let name: String = controller.chars().take(64).collect();
  let q: String = name.bytes().map(|b| format!("%{b:02X}")).collect();
  let (w_l, h_l) = (520.0, 44.0);
  let mut b = WebviewWindowBuilder::new(&app, BANNER, WebviewUrl::App(format!("banner.html?n={q}").into()))
    .title("OpenCord")
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .focused(false)
    .inner_size(w_l, h_l)
    .background_color(tauri::window::Color(0x1b, 0x1d, 0x22, 0xff))
    .additional_browser_args(&args(&app))
    .on_navigation(|u| u.host_str() == Some("tauri.localhost"));
  if let Ok(Some(m)) = app.primary_monitor() {
    let s = m.scale_factor();
    let x = m.position().x as f64 / s + (m.size().width as f64 / s - w_l) / 2.0;
    b = b.position(x, m.position().y as f64 / s + 8.0);
  }
  b.build().map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub async fn banner_close(app: AppHandle) {
  if let Some(w) = app.get_webview_window(BANNER) {
    let _ = w.destroy();
  }
}
