//! Migração do app Electron para o app em Tauri (ADR-0062), uma vez, na primeira abertura depois da troca: quem já
//! usava o OpenCord continua logado e com as mesmas preferências do app.
//!
//! O Electron guardava os segredos (`serverUrl`, `session`) em `%APPDATA%\@opencord\desktop\secure-store.json`,
//! cifrados pelo `safeStorage` (Chromium `os_crypt`): cada valor é `v10` + nonce (12 bytes) + AES-256-GCM, com a
//! chave em `Local State` (`os_crypt.encrypted_key`, base64 de "DPAPI" + a chave protegida pela DPAPI do usuário).
//! Aqui eles são decifrados e gravados no cofre do Tauri (DPAPI direto). Também vêm o `app-prefs.json` (modo da placa
//! de vídeo) e o `clips-dir.json` (pasta dos clipes). Nada sai da máquina.

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

use crate::sys::dpapi;

const MARKER: &str = "migrated-from-electron.json";

fn electron_dir() -> Option<PathBuf> {
  std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("@opencord").join("desktop"))
}

fn tauri_dir() -> Option<PathBuf> {
  std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("org.opencord.tauri"))
}

/// a chave AES do `os_crypt` do Chromium daquele perfil
fn os_crypt_key(dir: &Path) -> Result<Vec<u8>, String> {
  let state: Value =
    serde_json::from_str(&fs::read_to_string(dir.join("Local State")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
  let enc = state["os_crypt"]["encrypted_key"].as_str().ok_or("sem os_crypt.encrypted_key")?;
  let raw = B64.decode(enc).map_err(|e| e.to_string())?;
  let protected = raw.strip_prefix(b"DPAPI").ok_or("chave sem o prefixo DPAPI")?;
  let key = dpapi::unprotect(protected)?;
  if key.len() != 32 {
    return Err("chave do os_crypt com tamanho inesperado".into());
  }
  Ok(key)
}

/// um valor do `safeStorage` (`v10` + nonce + AES-GCM)
fn decrypt_v10(key: &[u8], b64: &str) -> Result<String, String> {
  let raw = B64.decode(b64).map_err(|e| e.to_string())?;
  let body = raw.strip_prefix(b"v10").ok_or("formato desconhecido (não é v10)")?;
  if body.len() < 12 + 16 {
    return Err("valor curto demais".into());
  }
  let (nonce, ct) = body.split_at(12);
  let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
  let plain = cipher.decrypt(Nonce::from_slice(nonce), ct).map_err(|_| "não decifrou (chave errada?)".to_string())?;
  String::from_utf8(plain).map_err(|e| e.to_string())
}

/// segredos do Electron, já em texto (para o cofre do Tauri)
pub fn read_electron_secrets() -> Result<Map<String, Value>, String> {
  let dir = electron_dir().ok_or("sem APPDATA")?;
  let store: Map<String, Value> = serde_json::from_str(
    &fs::read_to_string(dir.join("secure-store.json")).map_err(|e| format!("sem secure-store.json: {e}"))?,
  )
  .map_err(|e| e.to_string())?;
  let key = os_crypt_key(&dir)?;
  let mut out = Map::new();
  for (k, v) in store {
    if let Some(s) = v.as_str() {
      out.insert(k, Value::String(decrypt_v10(&key, s)?));
    }
  }
  Ok(out)
}

fn write_atomic(path: &Path, data: &str) -> Result<(), String> {
  let tmp = path.with_extension("json.tmp");
  fs::write(&tmp, data).map_err(|e| e.to_string())?;
  fs::rename(tmp, path).map_err(|e| e.to_string())
}

/// Roda antes de qualquer janela. Só uma vez (marca no diretório do Tauri) e só se o Tauri ainda não tem sessão:
/// quem já entrou no app novo não é sobrescrito. Falha não impede o app de abrir (a pessoa entra de novo).
pub fn from_electron() {
  let (Some(edir), Some(tdir)) = (electron_dir(), tauri_dir()) else { return };
  if !edir.exists() || tdir.join(MARKER).exists() {
    return;
  }
  let _ = fs::create_dir_all(&tdir);
  let mut report = Map::new();
  let secure_file = tdir.join("secure-store.json");
  let mut store: Map<String, Value> =
    fs::read_to_string(&secure_file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
  if store.contains_key("session") {
    report.insert("secrets".into(), Value::String("o app novo já tinha sessão: mantida".into()));
  } else {
    match read_electron_secrets() {
      Ok(secrets) => {
        let mut moved = Vec::new();
        for (k, v) in secrets {
          let Some(s) = v.as_str() else { continue };
          if let Ok(enc) = dpapi::protect(s.as_bytes()) {
            store.insert(k.clone(), Value::String(B64.encode(enc)));
            moved.push(Value::String(k));
          }
        }
        if let Ok(json) = serde_json::to_string(&store) {
          let _ = write_atomic(&secure_file, &json);
        }
        report.insert("secrets".into(), Value::Array(moved));
      }
      Err(e) => {
        report.insert("secrets".into(), Value::String(format!("não migrou: {e}")));
      }
    }
  }
  // preferências do app (modo da placa de vídeo) e a pasta dos clipes: só se o app novo ainda não tem
  for name in ["app-prefs.json", "clips-dir.json"] {
    let (from, to) = (edir.join(name), tdir.join(name));
    if from.exists() && !to.exists() && fs::copy(&from, &to).is_ok() {
      report.insert(name.into(), Value::Bool(true));
    }
  }
  report.insert("at".into(), Value::String(format!("{:?}", std::time::SystemTime::now())));
  let _ = fs::write(tdir.join(MARKER), Value::Object(report).to_string());
}

/// `opencord-tauri.exe --migration-check`: diz o que a migração acharia, sem mostrar segredo nem gravar nada
pub fn check_report() -> String {
  match read_electron_secrets() {
    Ok(s) => {
      let keys: Vec<String> = s.iter().map(|(k, v)| format!("{k} ({} caracteres)", v.as_str().map_or(0, str::len))).collect();
      format!("ok: {}", keys.join(", "))
    }
    Err(e) => format!("falhou: {e}"),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn decifra_valor_v10_do_safe_storage() {
    use aes_gcm::aead::OsRng;
    use aes_gcm::AeadCore;
    let key = [7u8; 32];
    let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher.encrypt(&nonce, b"https://api.opencord.pro".as_ref()).unwrap();
    let mut raw = b"v10".to_vec();
    raw.extend_from_slice(&nonce);
    raw.extend_from_slice(&ct);
    assert_eq!(decrypt_v10(&key, &B64.encode(&raw)).unwrap(), "https://api.opencord.pro");
    assert!(decrypt_v10(&[8u8; 32], &B64.encode(&raw)).is_err());
    assert!(decrypt_v10(&key, &B64.encode(b"v11abc")).is_err());
  }
}
