//! Cofre de segredos (DPAPI), impressão digital do aparelho, memória dos processos, tempo ocioso, processos abertos,
//! jogo da Steam, prioridade da live, selo de não lidas, preferências e registro de erros.
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{image::Image, AppHandle, Manager};

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let d = app.path().app_data_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&d).map_err(|e| e.to_string())?;
  Ok(d)
}

// ---------- cofre (DPAPI do usuário do Windows) ----------

const SECURE_KEYS: [&str; 2] = ["session", "serverUrl"];

fn check_key(key: &str) -> Result<(), String> {
  if SECURE_KEYS.contains(&key) {
    Ok(())
  } else {
    Err("chave inválida".into())
  }
}

#[cfg(windows)]
pub mod dpapi {
  use windows::Win32::Foundation::{LocalFree, HLOCAL};
  use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
  };

  fn take(blob: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let out = unsafe { std::slice::from_raw_parts(blob.pbData, blob.cbData as usize) }.to_vec();
    unsafe {
      let _ = LocalFree(Some(HLOCAL(blob.pbData as *mut _)));
    }
    out
  }

  pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe { CryptProtectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out) }
      .map_err(|e| e.to_string())?;
    Ok(take(out))
  }

  pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe { CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out) }
      .map_err(|e| e.to_string())?;
    Ok(take(out))
  }
}

fn secure_file(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(data_dir(app)?.join("secure-store.json"))
}

fn secure_load(app: &AppHandle) -> Map<String, Value> {
  secure_file(app)
    .ok()
    .and_then(|f| fs::read_to_string(f).ok())
    .and_then(|s| serde_json::from_str::<Map<String, Value>>(&s).ok())
    .unwrap_or_default()
}

fn secure_save(app: &AppHandle, data: &Map<String, Value>) -> Result<(), String> {
  let f = secure_file(app)?;
  let tmp = f.with_extension("json.tmp");
  fs::write(&tmp, serde_json::to_string(data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
  fs::rename(tmp, f).map_err(|e| e.to_string())
}

/// lê um segredo direto (sem passar pela interface): o atualizador usa o `serverUrl`
pub fn secure_read(app: &AppHandle, key: &str) -> Option<String> {
  let enc = secure_load(app).get(key).and_then(|v| v.as_str().map(String::from))?;
  let raw = B64.decode(enc).ok()?;
  dpapi::unprotect(&raw).ok().and_then(|v| String::from_utf8(v).ok())
}

#[tauri::command]
pub fn secure_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
  check_key(&key)?;
  Ok(secure_read(&app, &key))
}

#[tauri::command]
pub fn secure_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
  check_key(&key)?;
  if value.len() > 8192 {
    return Err("valor grande demais".into());
  }
  let mut data = secure_load(&app);
  data.insert(key, Value::String(B64.encode(dpapi::protect(value.as_bytes())?)));
  secure_save(&app, &data)
}

#[tauri::command]
pub fn secure_delete(app: AppHandle, key: String) -> Result<(), String> {
  check_key(&key)?;
  let mut data = secure_load(&app);
  if data.remove(&key).is_some() {
    secure_save(&app, &data)?;
  }
  Ok(())
}

// ---------- impressão digital do aparelho (ADR-0036) ----------

/// Mesmo cálculo do Electron (apps/desktop/electron/shared/hardware-id.ts sobre os.networkInterfaces()): SHA-256 dos
/// MACs das interfaces ativas com endereço IP, fora a de loopback, ordenados e unidos por "|".
#[tauri::command]
pub fn hardware_id() -> Option<String> {
  let macs = adapter_macs();
  if macs.is_empty() {
    return None;
  }
  let joined = macs.into_iter().collect::<Vec<_>>().join("|");
  Some(hex(&Sha256::digest(joined.as_bytes())))
}

fn hex(b: &[u8]) -> String {
  b.iter().map(|x| format!("{x:02x}")).collect()
}

#[cfg(windows)]
fn adapter_macs() -> BTreeSet<String> {
  use windows::Win32::NetworkManagement::IpHelper::{
    GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST,
    IP_ADAPTER_ADDRESSES_LH,
  };
  use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
  use windows::Win32::Networking::WinSock::AF_UNSPEC;
  const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;
  let mut out = BTreeSet::new();
  let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
  let mut size: u32 = 16 * 1024;
  let mut buf: Vec<u64> = Vec::new();
  for _ in 0..3 {
    buf = vec![0u64; (size as usize / 8) + 1];
    let r = unsafe {
      GetAdaptersAddresses(AF_UNSPEC.0 as u32, flags, None, Some(buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH), &mut size)
    };
    if r == 0 {
      break;
    }
    if r != 111 {
      // ERROR_BUFFER_OVERFLOW = 111; qualquer outro erro: sem impressão
      return out;
    }
  }
  let mut p = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
  while !p.is_null() {
    let a = unsafe { &*p };
    p = a.Next;
    if a.OperStatus != IfOperStatusUp || a.IfType == IF_TYPE_SOFTWARE_LOOPBACK || a.FirstUnicastAddress.is_null() {
      continue;
    }
    if a.PhysicalAddressLength != 6 {
      continue;
    }
    let m = &a.PhysicalAddress[..6];
    if m.iter().all(|b| *b == 0) {
      continue;
    }
    out.insert(m.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(":"));
  }
  out
}

// ---------- processos ----------

fn system_with(cmd: bool) -> System {
  let mut s = System::new();
  let kind = ProcessRefreshKind::nothing().with_memory();
  let kind = if cmd { kind.with_cmd(UpdateKind::Always) } else { kind };
  s.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
  s
}

/// O processo do app e todos os descendentes (os do WebView2 e os auxiliares oc-audio/oc-input).
fn tree(s: &System) -> Vec<Pid> {
  let me = Pid::from_u32(std::process::id());
  let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
  for (pid, p) in s.processes() {
    if let Some(parent) = p.parent() {
      children.entry(parent).or_default().push(*pid);
    }
  }
  let mut out = vec![me];
  let mut seen: HashSet<Pid> = HashSet::from([me]);
  let mut i = 0;
  while i < out.len() {
    if let Some(c) = children.get(&out[i]) {
      for pid in c {
        if seen.insert(*pid) {
          out.push(*pid);
        }
      }
    }
    i += 1;
  }
  out
}

/// Tipo do processo nos nomes do Chromium (para a prioridade da live).
fn kind_of(s: &System, pid: Pid) -> String {
  let Some(p) = s.process(pid) else { return "Unknown".into() };
  if pid.as_u32() == std::process::id() {
    return "Browser".into();
  }
  let name = p.name().to_string_lossy().to_lowercase();
  if name.starts_with("oc-audio") || name.starts_with("oc-input") {
    return "Auxiliar nativo".into();
  }
  if name.starts_with("oc-live") {
    return "Live".into();
  }
  let ty = p
    .cmd()
    .iter()
    .filter_map(|a| a.to_str())
    .find_map(|a| a.strip_prefix("--type="))
    .map(String::from);
  match ty.as_deref() {
    None => "WebView2".into(),
    Some("renderer") => "Tab".into(),
    Some("gpu-process") => "GPU".into(),
    Some("utility") | Some("crashpad-handler") => "Utility".into(),
    Some(other) => other.to_string(),
  }
}

/// Live começando: GPU e janela do WebView2 acima do normal, para não perderem a disputa com um jogo pesado.
#[tauri::command]
pub async fn boost_media_priority() {
  let _ = tauri::async_runtime::spawn_blocking(|| {
    let s = system_with(true);
    for pid in tree(&s) {
      let k = kind_of(&s, pid);
      if k == "GPU" || k == "Tab" || k == "Browser" {
        set_above_normal(pid.as_u32());
      }
    }
  })
  .await;
}

#[cfg(windows)]
fn set_above_normal(pid: u32) {
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::Threading::{
    OpenProcess, SetPriorityClass, ABOVE_NORMAL_PRIORITY_CLASS, PROCESS_SET_INFORMATION,
  };
  unsafe {
    if let Ok(h) = OpenProcess(PROCESS_SET_INFORMATION, false, pid) {
      let _ = SetPriorityClass(h, ABOVE_NORMAL_PRIORITY_CLASS);
      let _ = CloseHandle(h);
    }
  }
}

/// Executáveis abertos agora (como o `tasklist` do Electron), para a detecção de jogos.
#[tauri::command]
pub async fn processes() -> Vec<String> {
  tauri::async_runtime::spawn_blocking(|| {
    let mut s = System::new();
    s.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    s.processes().values().map(|p| p.name().to_string_lossy().to_string()).collect()
  })
  .await
  .unwrap_or_default()
}

#[derive(Serialize)]
pub struct SteamGame {
  id: u32,
  name: Option<String>,
}

#[tauri::command]
pub fn steam_running() -> SteamGame {
  use winreg::{enums::HKEY_CURRENT_USER, RegKey};
  let hk = RegKey::predef(HKEY_CURRENT_USER);
  let Ok(steam) = hk.open_subkey("Software\\Valve\\Steam") else { return SteamGame { id: 0, name: None } };
  let id: u32 = steam.get_value("RunningAppID").unwrap_or(0);
  if id == 0 {
    return SteamGame { id: 0, name: None };
  }
  let name = steam.open_subkey(format!("Apps\\{id}")).ok().and_then(|k| k.get_value::<String, _>("Name").ok());
  SteamGame { id, name }
}

// ---------- tempo ocioso ----------

#[tauri::command]
pub fn idle_seconds() -> u64 {
  use windows::Win32::System::SystemInformation::GetTickCount;
  use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
  let mut li = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
  unsafe {
    if !GetLastInputInfo(&mut li).as_bool() {
      return 0;
    }
    (GetTickCount().wrapping_sub(li.dwTime) / 1000) as u64
  }
}

// ---------- janela ----------

/// Ponto vermelho de "não lidas" sobre o ícone da barra de tarefas (16×16, gerado por código).
fn badge_image() -> Image<'static> {
  let n = 16usize;
  let mut px = vec![0u8; n * n * 4];
  for y in 0..n {
    for x in 0..n {
      let dx = x as f32 + 0.5 - 8.0;
      let dy = y as f32 + 0.5 - 8.0;
      let d = (dx * dx + dy * dy).sqrt();
      let a = (7.5 - d).clamp(0.0, 1.0);
      let i = (y * n + x) * 4;
      px[i] = 0xda;
      px[i + 1] = 0x37;
      px[i + 2] = 0x3c;
      px[i + 3] = (a * 255.0) as u8;
    }
  }
  Image::new_owned(px, n as u32, n as u32)
}

#[tauri::command]
pub fn set_badge(app: AppHandle, count: u32) {
  if let Some(w) = app.get_webview_window(crate::MAIN) {
    let _ = w.set_overlay_icon(if count > 0 { Some(badge_image()) } else { None });
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
  version: String,
  electron: String,
  chrome: String,
  platform: String,
  os_release: String,
  secure_storage: bool,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
  AppInfo {
    version: format!("{}-tauri", app.package_info().version),
    electron: format!("Tauri {}", tauri::VERSION),
    chrome: tauri::webview_version().map(|v| format!("WebView2 {v}")).unwrap_or_else(|_| "WebView2".into()),
    platform: "win32".into(),
    os_release: System::kernel_long_version(),
    secure_storage: true,
  }
}

// ---------- preferências (Configurações → Sobre → Desempenho) ----------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppPrefs {
  pub gpu_mode: String,
}

/// Lido antes de o app existir (os argumentos do WebView2 são fixados na criação da janela).
fn prefs_path() -> Option<PathBuf> {
  std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("org.opencord.tauri").join("app-prefs.json"))
}

pub fn read_prefs_raw() -> Option<AppPrefs> {
  let p: AppPrefs = serde_json::from_str(&fs::read_to_string(prefs_path()?).ok()?).ok()?;
  Some(if p.gpu_mode == "off" { p } else { AppPrefs { gpu_mode: "full".into() } })
}

fn prefs_state(app: &AppHandle) -> Value {
  let saved = read_prefs_raw().unwrap_or(AppPrefs { gpu_mode: "full".into() });
  let active = if app.state::<crate::AppState>().gpu_off_active { "off" } else { "full" };
  json!({ "saved": saved, "activeGpuMode": active })
}

#[tauri::command]
pub fn prefs_get(app: AppHandle) -> Value {
  prefs_state(&app)
}

#[tauri::command]
pub fn prefs_set(app: AppHandle, prefs: AppPrefs) -> Result<Value, String> {
  if prefs.gpu_mode != "off" && prefs.gpu_mode != "full" {
    return Err("modo inválido".into());
  }
  let p = prefs_path().ok_or("sem pasta de dados")?;
  if let Some(d) = p.parent() {
    fs::create_dir_all(d).map_err(|e| e.to_string())?;
  }
  fs::write(p, serde_json::to_string(&prefs).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
  Ok(prefs_state(&app))
}

// ---------- crash-log.txt ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorReport {
  r#where: String,
  message: String,
  stack: Option<String>,
  component_stack: Option<String>,
}

#[tauri::command]
pub fn report_error(app: AppHandle, report: ErrorReport) -> Result<(), String> {
  let clip = |s: &str, n: usize| s.chars().take(n).collect::<String>();
  let f = data_dir(&app)?.join("crash-log.txt");
  if fs::metadata(&f).map(|m| m.len() > 1024 * 1024).unwrap_or(false) {
    let _ = fs::remove_file(&f);
  }
  let mut out = fs::OpenOptions::new().create(true).append(true).open(f).map_err(|e| e.to_string())?;
  let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
  let _ = writeln!(
    out,
    "[{now}] {}: {}\n{}\n{}\n",
    clip(&report.r#where, 20),
    clip(&report.message, 2000),
    clip(report.stack.as_deref().unwrap_or(""), 8000),
    clip(report.component_stack.as_deref().unwrap_or(""), 8000)
  );
  Ok(())
}

/// Abre o Explorer com o arquivo selecionado (quem chama já conferiu que ele está numa pasta permitida).
pub fn reveal(app: &AppHandle, path: &std::path::Path) -> Result<(), String> {
  use tauri_plugin_opener::OpenerExt;
  app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}
