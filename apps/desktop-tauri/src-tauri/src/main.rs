//! OpenCord em Tauri (protótipo de comparação com o Electron).
//!
//! A interface é a MESMA do app Electron (apps/desktop/src), carregada no WebView2 do Windows. Este processo faz o
//! papel do processo principal do Electron: janela, bandeja, atalhos globais, notificações, cofre de segredos (DPAPI),
//! clipes, detecção de jogos, som das saídas (oc-audio.exe) e controle remoto (oc-input.exe). A ponte `window.opencord`
//! (o mesmo contrato de apps/desktop/electron/shared/ipc.ts) é montada em JavaScript em apps/desktop-tauri/src/bridge.ts
//! em cima dos comandos daqui.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod aux_windows;
mod clips;
mod sidecar;
mod sys;

use serde::Deserialize;
use std::sync::Mutex;
use tauri::{
  image::Image,
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  webview::{NewWindowResponse, PermissionKind, PermissionResponse},
  AppHandle, Emitter, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

pub const MAIN: &str = "main";

/// Mesmas chaves do Chromium que o Electron liga (apps/desktop/electron/main/index.ts): voz e live não podem ser
/// estranguladas com a janela escondida ou coberta por um jogo. As três primeiras features são as que o wry já
/// desliga por padrão (passar argumentos substitui os dele).
pub fn browser_args(gpu_off: bool) -> String {
  let mut a = String::from(
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
     --autoplay-policy=no-user-gesture-required --disable-renderer-backgrounding \
     --disable-background-timer-throttling --disable-backgrounding-occluded-windows",
  );
  if gpu_off {
    a.push_str(" --disable-gpu");
  }
  // depuração/medição: OPENCORD_TAURI_DEBUG_PORT=9333 abre o DevTools remoto do WebView2 (só em 127.0.0.1)
  if let Some(port) = std::env::var("OPENCORD_TAURI_DEBUG_PORT").ok().and_then(|p| p.parse::<u16>().ok()) {
    a.push_str(&format!(" --remote-debugging-port={port}"));
  }
  a
}

#[derive(Default)]
pub struct VoiceState {
  in_voice: bool,
  muted: bool,
  deafened: bool,
}

pub struct AppState {
  voice: Mutex<VoiceState>,
  pub gpu_off_active: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayVoiceArgs {
  in_voice: bool,
  muted: bool,
  deafened: bool,
}

fn show_main(app: &AppHandle) {
  if let Some(w) = app.get_webview_window(MAIN) {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
  }
}

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
  let st = app.state::<AppState>();
  let v = st.voice.lock().unwrap();
  let items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = vec![
    Box::new(MenuItem::with_id(app, "show", "Abrir OpenCord", true, None::<&str>)?),
    Box::new(PredefinedMenuItem::separator(app)?),
    Box::new(MenuItem::with_id(
      app,
      "toggleMute",
      if v.muted { "Ativar microfone" } else { "Silenciar microfone" },
      v.in_voice,
      None::<&str>,
    )?),
    Box::new(MenuItem::with_id(
      app,
      "toggleDeafen",
      if v.deafened { "Ativar áudio" } else { "Ensurdecer" },
      v.in_voice,
      None::<&str>,
    )?),
    Box::new(MenuItem::with_id(app, "disconnect", "Sair da chamada", v.in_voice, None::<&str>)?),
    Box::new(PredefinedMenuItem::separator(app)?),
    Box::new(MenuItem::with_id(app, "quit", "Encerrar OpenCord", true, None::<&str>)?),
  ];
  let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items.iter().map(|b| b.as_ref()).collect();
  Menu::with_items(app, &refs)
}

fn refresh_tray(app: &AppHandle) {
  if let Some(tray) = app.tray_by_id("main") {
    if let Ok(menu) = build_tray_menu(app) {
      let _ = tray.set_menu(Some(menu));
    }
    let v = app.state::<AppState>();
    let v = v.voice.lock().unwrap();
    let tip = if v.in_voice {
      format!("OpenCord — em chamada{}", if v.muted { " (mudo)" } else { "" })
    } else {
      "OpenCord".into()
    };
    let _ = tray.set_tooltip(Some(tip));
  }
}

#[tauri::command]
fn tray_voice_state(app: AppHandle, state: TrayVoiceArgs) {
  {
    let st = app.state::<AppState>();
    let mut v = st.voice.lock().unwrap();
    *v = VoiceState { in_voice: state.in_voice, muted: state.muted, deafened: state.deafened };
  }
  refresh_tray(&app);
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
  let u = Url::parse(&url).map_err(|e| e.to_string())?;
  if u.scheme() != "http" && u.scheme() != "https" {
    return Err("apenas http(s)".into());
  }
  app.opener().open_url(u.as_str(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn relaunch(app: AppHandle) {
  sidecar::stop_all(&app);
  app.restart();
}

#[tauri::command]
fn quit_app(app: AppHandle) {
  sidecar::stop_all(&app);
  app.exit(0);
}

/// A página do próprio app (produção: http://tauri.localhost; desenvolvimento: o Vite).
fn is_app_url(u: &Url) -> bool {
  let host = u.host_str().unwrap_or("");
  (u.scheme() == "http" || u.scheme() == "https" || u.scheme() == "tauri")
    && (host == "tauri.localhost" || (cfg!(debug_assertions) && host == "localhost"))
}

static POPOUTS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// Transmissão desanexada (src/features/voice/popout.tsx): sem IPC do app, sem navegação, sem janelas filhas.
fn popout_window(
  app: &AppHandle,
  features: tauri::webview::NewWindowFeatures,
  gpu_off: bool,
) -> tauri::Result<tauri::WebviewWindow> {
  let n = POPOUTS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
  WebviewWindowBuilder::new(app, format!("popout-{n}"), WebviewUrl::External("about:blank".parse().unwrap()))
    .window_features(features)
    .title("OpenCord — Transmissão")
    .inner_size(1120.0, 700.0)
    .min_inner_size(480.0, 300.0)
    .background_color(tauri::window::Color(0, 0, 0, 0xff))
    .additional_browser_args(&browser_args(gpu_off))
    .on_document_title_changed(|w, title| {
      let _ = w.set_title(if title.is_empty() || title == "about:blank" { "OpenCord — Transmissão" } else { &title });
    })
    .on_navigation(|u| u.as_str() == "about:blank")
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .build()
}

fn create_main_window(app: &AppHandle, gpu_off: bool) -> tauri::Result<()> {
  let open_handle = app.clone();
  let w = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
    .title("OpenCord")
    .inner_size(1280.0, 800.0)
    .min_inner_size(940.0, 560.0)
    // barra de título desenhada pela interface (como no Electron com titleBarStyle: 'hidden')
    .decorations(false)
    .shadow(true)
    .visible(false)
    .background_color(tauri::window::Color(0x1b, 0x1d, 0x22, 0xff))
    .additional_browser_args(&browser_args(gpu_off))
    .on_navigation(|u| is_app_url(u) || u.as_str() == "about:blank")
    .on_new_window(move |url, features| {
      // única janela filha: a transmissão desanexada (about:blank montada pela própria interface), numa janela do
      // app (sem a barra de endereço do popup padrão do WebView2)
      if url.as_str() == "about:blank" {
        return match popout_window(&open_handle, features, gpu_off) {
          Ok(window) => NewWindowResponse::Create { window },
          Err(_) => NewWindowResponse::Deny,
        };
      }
      if url.scheme() == "http" || url.scheme() == "https" {
        let _ = open_handle.opener().open_url(url.as_str(), None::<&str>);
      }
      NewWindowResponse::Deny
    })
    .on_page_load(|w, p| {
      if matches!(p.event(), tauri::webview::PageLoadEvent::Finished) && !w.is_visible().unwrap_or(true) {
        let _ = w.show();
      }
    })
    .build()?;
  let wc = w.clone();
  w.on_window_event(move |e| match e {
    // fechar a janela esconde na bandeja: a chamada continua
    WindowEvent::CloseRequested { api, .. } => {
      api.prevent_close();
      let _ = wc.hide();
    }
    WindowEvent::Resized(_) => {
      let _ = wc.emit_to(MAIN, "oc:window-state", serde_json::json!({ "maximized": wc.is_maximized().unwrap_or(false) }));
    }
    _ => {}
  });
  Ok(())
}

fn main() {
  let gpu_off = sys::read_prefs_raw().map(|p| p.gpu_mode == "off").unwrap_or(false);
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    // permissões mínimas, como no Electron: mídia, notificações, área de transferência e autoplay
    .on_permission_request(|w, kind| {
      if !w.url().map(|u| is_app_url(&u) || u.as_str() == "about:blank").unwrap_or(false) {
        return PermissionResponse::Deny;
      }
      match kind {
        PermissionKind::Microphone
        | PermissionKind::Camera
        | PermissionKind::Notifications
        | PermissionKind::ClipboardRead
        | PermissionKind::Autoplay => PermissionResponse::Allow,
        _ => PermissionResponse::Deny,
      }
    })
    .manage(AppState { voice: Mutex::new(VoiceState::default()), gpu_off_active: gpu_off })
    .manage(sidecar::Sidecars::default())
    .setup(move |app| {
      let handle = app.handle().clone();
      create_main_window(&handle, gpu_off)?;
      let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
      TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("OpenCord")
        .menu(&build_tray_menu(&handle)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| {
          let id = e.id().as_ref().to_string();
          match id.as_str() {
            "quit" => {
              sidecar::stop_all(app);
              app.exit(0);
            }
            "show" => {
              show_main(app);
              let _ = app.emit_to(MAIN, "oc:tray-action", "show");
            }
            other => {
              let _ = app.emit_to(MAIN, "oc:tray-action", other);
            }
          }
        })
        .on_tray_icon_event(|tray, e| {
          if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            show_main(tray.app_handle());
          }
        })
        .build(app)?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      tray_voice_state,
      open_external,
      relaunch,
      quit_app,
      sys::secure_get,
      sys::secure_set,
      sys::secure_delete,
      sys::hardware_id,
      sys::app_metrics,
      sys::app_info,
      sys::idle_seconds,
      sys::processes,
      sys::steam_running,
      sys::boost_media_priority,
      sys::set_badge,
      sys::prefs_get,
      sys::prefs_set,
      sys::report_error,
      clips::clips_dir,
      clips::clips_choose_dir,
      clips::clips_save,
      clips::clips_list,
      clips::clips_read,
      clips::clips_remove,
      clips::clips_reveal,
      clips::clips_copy,
      clips::clips_export,
      sidecar::win_audio_list,
      sidecar::win_audio_start,
      sidecar::win_audio_stop,
      sidecar::remote_input_available,
      sidecar::remote_input_start,
      sidecar::remote_input_send,
      sidecar::remote_input_stop,
      sidecar::remote_set_clipboard,
      sidecar::remote_file_chunk,
      sidecar::remote_reveal_file,
      aux_windows::overlay_update,
      aux_windows::overlay_state,
      aux_windows::banner_show,
      aux_windows::banner_close,
    ])
    .build(tauri::generate_context!())
    .expect("erro ao iniciar o OpenCord");
  app.run(|app, e| {
    if let RunEvent::Exit = e {
      sidecar::stop_all(app);
    }
  });
}
