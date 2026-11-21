//! Vídeo da tela para a interface, fora do WebView (que abria o seletor de tela a cada captura), em dois usos no app em
//! Tauri (ADR-0022/0062): o replay dos clipes (monitor) e a tela de uma live com cena (monitor ou janela escolhida no
//! seletor do OpenCord; a interface decodifica e compõe a cena). Mesma captura, conversão e encoder da live.
//!
//! Configuração numa linha JSON no stdin; "ready <largura> <altura>" no stderr quando o encoder está pronto (ou
//! "error <motivo>"); depois, cada quadro no stdout: tamanho (u32 LE) · 1 se quadro-chave (u8) · tempo em µs
//! (i64 LE) · H.264 Annex B (com SPS/PPS nos quadros-chave). Para com "stop" no stdin ou com o stdin fechado.
//! Janela fechada: "ended source-closed" no stderr e o processo sai.

use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows_capture::capture::GraphicsCaptureApiHandler;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, DirtyRegionSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use crate::encoder::{Config as EncConfig, Control, Dev, Encoder, Input};
use crate::live::{Capture, Flags};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipConfig {
    /// `screen:<hmonitor>` ou `window:<hwnd>` (ids do `sources`); sem fonte, o monitor principal
    source: Option<String>,
    /// teto do tamanho do vídeo (0 = o do monitor)
    max_width: u32,
    max_height: u32,
    fps: u32,
    /// bps
    bitrate: u32,
    /// o clipe só começa num quadro-chave
    key_every_sec: u32,
    #[serde(default)]
    cursor: bool,
}

fn even(n: f32) -> u32 {
    ((n as u32) / 2 * 2).max(2)
}

/// o que capturar
enum Target {
    Screen(Monitor),
    Window(usize),
}

/// tamanho da janela na tela em pixels reais, sem a borda invisível que o Windows põe em volta (a mesma área da captura)
fn window_size(hwnd: usize) -> Option<(u32, u32)> {
    let mut r = RECT::default();
    unsafe {
        DwmGetWindowAttribute(
            HWND(hwnd as *mut _),
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut r as *mut RECT as *mut _,
            std::mem::size_of::<RECT>() as u32,
        )
        .ok()?;
    }
    let (w, h) = ((r.right - r.left).max(0) as u32, (r.bottom - r.top).max(0) as u32);
    (w >= 2 && h >= 2).then_some((w, h))
}

/// o tamanho do monitor reduzido para caber no teto (sem aumentar), sempre par
fn fit(w: u32, h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    let k = if max_w == 0 || max_h == 0 { 1.0 } else { (max_w as f32 / w as f32).min(max_h as f32 / h as f32).min(1.0) };
    (even(w as f32 * k), even(h as f32 * k))
}

pub fn run_from_stdin() -> i32 {
    let mut line = String::new();
    if std::io::stdin().lock().read_line(&mut line).is_err() {
        return 2;
    }
    let cfg: ClipConfig = match serde_json::from_str(&line) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error configuração inválida: {e}");
            return 2;
        }
    };
    let target = match cfg.source.as_deref().map(crate::live::parse_source) {
        Some(Ok((true, raw))) => Target::Window(raw),
        Some(Ok((false, raw))) => Target::Screen(Monitor::from_raw_hmonitor(raw as *mut _)),
        Some(Err(e)) => {
            eprintln!("error {e}");
            return 2;
        }
        None => match Monitor::primary() {
            Ok(m) => Target::Screen(m),
            Err(e) => {
                eprintln!("error sem monitor: {e:?}");
                return 4;
            }
        },
    };
    let (sw, sh) = match &target {
        Target::Screen(m) => (m.width().unwrap_or(1920), m.height().unwrap_or(1080)),
        Target::Window(hwnd) => {
            // tamanho em pixels reais (sem isso, numa tela com escala de 150% a janela pareceria menor)
            unsafe {
                let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            }
            match window_size(*hwnd) {
                Some(s) => s,
                None => {
                    eprintln!("error a janela não está mais aberta");
                    return 4;
                }
            }
        }
    };
    let (width, height) = fit(sw, sh, cfg.max_width, cfg.max_height);
    let fps = cfg.fps.clamp(15, 120);

    let ctl = Arc::new(Control::default());
    let (tx, rx) = sync_channel::<Input>(2);
    let (dev_tx, dev_rx) = sync_channel::<Dev>(1);
    let flags = Flags {
        width,
        height,
        fps,
        tx,
        ctl: ctl.clone(),
        start: Instant::now(),
        dev_tx,
        dropped: Arc::new(AtomicU64::new(0)),
        json_out: false,
    };
    let (cursor, border, interval) = crate::live::capture_options(cfg.cursor, fps);
    macro_rules! settings {
        ($item:expr, $flags:expr) => {
            Settings::new(
                $item,
                cursor,
                border,
                SecondaryWindowSettings::Default,
                interval,
                DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                $flags,
            )
        };
    }
    let capture: Box<dyn std::any::Any> = match target {
        Target::Screen(monitor) => {
            // sem a borda amarela no Windows 10: Desktop Duplication (se não abrir, WGC)
            let dxgi = if crate::dxgi::wanted() {
                crate::dxgi::start(monitor.as_raw_hmonitor() as usize, flags.clone(), cfg.cursor)
                    .map_err(|e| eprintln!("duplicação indisponível, captura pela WGC: {e}"))
                    .ok()
            } else {
                None
            };
            match dxgi {
                Some(d) => Box::new(d),
                None => match Capture::start_free_threaded(settings!(monitor, flags)) {
                    Ok(c) => Box::new(c),
                    Err(e) => {
                        eprintln!("error captura não começou: {e:?}");
                        return 4;
                    }
                },
            }
        }
        // janela: WGC (no Windows 10 com a borda amarela, como na live sem cena)
        Target::Window(hwnd) => match Capture::start_free_threaded(settings!(Window::from_raw_hwnd(hwnd as *mut _), flags)) {
            Ok(c) => Box::new(c),
            Err(e) => {
                eprintln!("error captura não começou: {e:?}");
                return 4;
            }
        },
    };
    let Ok(Dev(device)) = dev_rx.recv_timeout(Duration::from_secs(5)) else {
        eprintln!("error captura sem device");
        return 4;
    };
    let enc_cfg = EncConfig { width, height, fps, bitrate: cfg.bitrate, gop_sec: cfg.key_every_sec.max(1) };
    let enc = match Encoder::new(&device, enc_cfg) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("error no-hw-encoder {e}");
            ctl.stop.store(true, Ordering::Release);
            return 5;
        }
    };
    eprintln!("ready {width} {height}");

    // quadro-chave pelo relógio (com a tela parada o encoder repete quadros e o GOP em quadros ficaria longo)
    {
        let ctl = ctl.clone();
        let every = Duration::from_secs(cfg.key_every_sec.max(1) as u64);
        std::thread::spawn(move || {
            while !ctl.stop.load(Ordering::Acquire) {
                std::thread::sleep(every);
                ctl.force_key.store(true, Ordering::Release);
            }
        });
    }
    // "stop" (ou stdin fechado: o app caiu) encerra
    {
        let ctl = ctl.clone();
        std::thread::spawn(move || {
            for l in std::io::stdin().lock().lines() {
                match l {
                    Ok(l) if l.trim() == "stop" => break,
                    Ok(_) => continue,
                    Err(_) => break,
                }
            }
            ctl.stop.store(true, Ordering::Release);
        });
    }
    let mut out = std::io::stdout().lock();
    let ctl2 = ctl.clone();
    let res = enc.run(rx, ctl.clone(), |e| {
        let mut head = [0u8; 13];
        head[..4].copy_from_slice(&(e.data.len() as u32).to_le_bytes());
        head[4] = e.key as u8;
        head[5..].copy_from_slice(&e.ts_us.to_le_bytes());
        // a interface fechou o pipe: para
        if out.write_all(&head).and_then(|_| out.write_all(&e.data)).and_then(|_| out.flush()).is_err() {
            ctl2.stop.store(true, Ordering::Release);
        }
    });
    ctl.stop.store(true, Ordering::Release);
    drop(capture);
    match res {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("error encoder: {e}");
            6
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fit;

    #[test]
    fn reduz_sem_aumentar_e_sempre_par() {
        assert_eq!(fit(2560, 1440, 1920, 1080), (1920, 1080));
        assert_eq!(fit(1920, 1080, 2560, 1440), (1920, 1080));
        assert_eq!(fit(3440, 1440, 1920, 1080), (1920, 802));
        assert_eq!(fit(1366, 768, 0, 0), (1366, 768));
    }
}
