//! Atalhos globais também pelo gancho de teclado de baixo nível (`WH_KEYBOARD_LL`), como o Discord.
//!
//! O plugin de atalhos do Tauri usa `RegisterHotKey`, e alguns jogos desligam esses atalhos enquanto estão em foco
//! (raw input com `RIDEV_NOHOTKEYS`). No League of Legends o Shift+F10 nunca chegava ao app: medido na máquina do
//! mantenedor com o jogo em foco, o gancho e o raw input viam a tecla e o `RegisterHotKey` não recebia nada. O gancho
//! roda numa thread própria com fila de mensagens, só olha teclas apertadas (sem a repetição de tecla segurada) e não
//! segura a tecla (o jogo continua recebendo). A interface ignora o segundo aviso do mesmo atalho quando os dois
//! caminhos disparam juntos.
//!
//! Sem dependência do Tauri aqui (dá para testar sozinho); `main.rs` liga o aviso ao evento da interface.

use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT};
use windows::Win32::UI::WindowsAndMessaging::{
  CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, KBDLLHOOKSTRUCT, MSG,
  WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

pub const CTRL: u8 = 1;
pub const ALT: u8 = 2;
pub const SHIFT: u8 = 4;
pub const WIN: u8 = 8;

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Bind {
  /// o que a interface recebe de volta (a ação do atalho)
  pub id: String,
  /// CTRL | ALT | SHIFT | WIN, exatamente
  pub mods: u8,
  /// tecla virtual do Windows
  pub vk: u32,
}

/// Teclas apertadas agora e o último aviso de cada uma: segurar a tecla repete o WM_KEYDOWN (a cada ~30 ms), mas o
/// atalho dispara uma vez. Sem aviso há mais de 1 s, vale como aperto novo (uma soltura que o gancho perdeu não
/// trava a tecla para sempre).
type Down = HashMap<u32, Instant>;
const REPEAT_GAP: Duration = Duration::from_secs(1);

struct State {
  binds: Vec<Bind>,
  down: Option<Down>,
  tx: Option<Sender<String>>,
}

static STATE: Mutex<State> = Mutex::new(State { binds: Vec::new(), down: None, tx: None });
static STARTED: OnceLock<bool> = OnceLock::new();

/// O atalho que esta tecla (com estes modificadores) dispara, se algum. `None` também para a repetição da tecla.
fn hit(binds: &[Bind], down: &mut Down, vk: u32, pressed: bool, mods: u8, now: Instant) -> Option<String> {
  if !pressed {
    down.remove(&vk);
    return None;
  }
  let repeat = down.get(&vk).is_some_and(|t| now.duration_since(*t) < REPEAT_GAP);
  down.insert(vk, now);
  if repeat {
    return None;
  }
  binds.iter().find(|b| b.vk == vk && b.mods == mods).map(|b| b.id.clone())
}

fn mods_now() -> u8 {
  let on = |vk: u16| unsafe { GetAsyncKeyState(vk as i32) } as u16 & 0x8000 != 0;
  (if on(VK_CONTROL.0) { CTRL } else { 0 })
    | (if on(VK_MENU.0) { ALT } else { 0 })
    | (if on(VK_SHIFT.0) { SHIFT } else { 0 })
    | (if on(VK_LWIN.0) || on(VK_RWIN.0) { WIN } else { 0 })
}

unsafe extern "system" fn proc(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
  if code >= 0 {
    let msg = wp.0 as u32;
    let pressed = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
    if pressed || msg == WM_KEYUP || msg == WM_SYSKEYUP {
      let k = &*(lp.0 as *const KBDLLHOOKSTRUCT);
      // o gancho precisa responder rápido (o Windows o tira se demorar): sem esperar trava, nada pesado
      if let Ok(mut s) = STATE.try_lock() {
        if !s.binds.is_empty() || !pressed {
          let mods = if pressed { mods_now() } else { 0 };
          let State { binds, down, tx } = &mut *s;
          let down = down.get_or_insert_with(HashMap::new);
          if let Some(id) = hit(binds, down, k.vkCode, pressed, mods, Instant::now()) {
            if let Some(tx) = tx {
              let _ = tx.send(id);
            }
          }
        }
      }
    }
  }
  CallNextHookEx(None, code, wp, lp)
}

/// Liga o gancho (uma vez; fica até o app fechar). `on_hit` recebe o `id` do atalho, fora da thread do gancho.
pub fn start(on_hit: impl Fn(String) + Send + 'static) -> Result<(), String> {
  if STARTED.get().is_some() {
    return Ok(());
  }
  let (tx, rx) = channel::<String>();
  STATE.lock().unwrap().tx = Some(tx);
  std::thread::spawn(move || {
    for id in rx {
      on_hit(id);
    }
  });
  let (ok_tx, ok_rx) = channel::<Result<(), String>>();
  std::thread::spawn(move || unsafe {
    let module = GetModuleHandleW(PCWSTR::null()).ok();
    match SetWindowsHookExW(WH_KEYBOARD_LL, Some(proc), module.map(Into::into), 0) {
      Ok(_) => {
        let _ = ok_tx.send(Ok(()));
      }
      Err(e) => {
        let _ = ok_tx.send(Err(format!("gancho de teclado: {e}")));
        return;
      }
    }
    // o gancho de baixo nível é chamado pela fila de mensagens desta thread
    let mut msg = MSG::default();
    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
      let _ = TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
  });
  let res = ok_rx.recv().unwrap_or_else(|_| Err("gancho de teclado não começou".into()));
  if res.is_ok() {
    let _ = STARTED.set(true);
  }
  res
}

/// Troca os atalhos vigiados (lista vazia = o gancho não dispara nada).
pub fn set_binds(binds: Vec<Bind>) {
  STATE.lock().unwrap().binds = binds;
}

#[cfg(test)]
mod tests {
  use super::*;

  fn b(id: &str, mods: u8, vk: u32) -> Bind {
    Bind { id: id.into(), mods, vk }
  }

  #[test]
  fn dispara_uma_vez_por_aperto_e_so_com_os_modificadores_exatos() {
    let binds = [b("saveClip", SHIFT, 0x79), b("toggleMute", CTRL | ALT, 0x4D)];
    let mut down = Down::new();
    let t = Instant::now();
    let ms = |n: u64| t + Duration::from_millis(n);
    assert_eq!(hit(&binds, &mut down, 0x79, true, SHIFT, ms(0)).as_deref(), Some("saveClip"));
    // tecla segurada: o Windows repete o aperto
    assert_eq!(hit(&binds, &mut down, 0x79, true, SHIFT, ms(500)), None);
    assert_eq!(hit(&binds, &mut down, 0x79, true, SHIFT, ms(1400)), None);
    assert_eq!(hit(&binds, &mut down, 0x79, false, 0, ms(1500)), None);
    // sem o Shift, ou com um modificador a mais, não é o atalho
    assert_eq!(hit(&binds, &mut down, 0x79, true, 0, ms(1600)), None);
    hit(&binds, &mut down, 0x79, false, 0, ms(1700));
    assert_eq!(hit(&binds, &mut down, 0x79, true, SHIFT | CTRL, ms(1800)), None);
    hit(&binds, &mut down, 0x79, false, 0, ms(1900));
    assert_eq!(hit(&binds, &mut down, 0x4D, true, CTRL | ALT, ms(2000)).as_deref(), Some("toggleMute"));
  }

  #[test]
  fn soltura_perdida_nao_trava_a_tecla() {
    let binds = [b("saveClip", SHIFT, 0x79)];
    let mut down = Down::new();
    let t = Instant::now();
    assert!(hit(&binds, &mut down, 0x79, true, SHIFT, t).is_some());
    // a soltura não chegou; 3 s depois é um aperto novo
    assert!(hit(&binds, &mut down, 0x79, true, SHIFT, t + Duration::from_secs(3)).is_some());
  }
}
