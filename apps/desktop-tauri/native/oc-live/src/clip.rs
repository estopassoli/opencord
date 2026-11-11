//! Replay dos clipes (ADR-0022/0062) no app em Tauri: a tela gravada fora do WebView (que abria o seletor de tela a
//! cada captura). Mesma captura, conversão e encoder da live; o H.264 sai no stdout e a interface guarda os últimos
//! segundos e monta o MP4 com o áudio dela.
//!
//! Configuração numa linha JSON no stdin; "ready <largura> <altura>" no stderr quando o encoder está pronto (ou
//! "error <motivo>"); depois, cada quadro no stdout: tamanho (u32 LE) · 1 se quadro-chave (u8) · tempo em µs
//! (i64 LE) · H.264 Annex B (com SPS/PPS nos quadros-chave). Para com "stop" no stdin ou com o stdin fechado.

use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use windows_capture::capture::GraphicsCaptureApiHandler;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, DirtyRegionSettings, SecondaryWindowSettings, Settings,
};

use crate::encoder::{Config as EncConfig, Control, Dev, Encoder, Input};
use crate::live::{Capture, Flags};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipConfig {
    /// `screen:<hmonitor>`; sem fonte, o monitor principal
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
    let monitor = match cfg.source.as_deref().and_then(|s| s.strip_prefix("screen:")).and_then(|v| v.parse::<usize>().ok()) {
        Some(raw) => Monitor::from_raw_hmonitor(raw as *mut _),
        None => match Monitor::primary() {
            Ok(m) => m,
            Err(e) => {
                eprintln!("error sem monitor: {e:?}");
                return 4;
            }
        },
    };
    let (mw, mh) = (monitor.width().unwrap_or(1920), monitor.height().unwrap_or(1080));
    let (width, height) = fit(mw, mh, cfg.max_width, cfg.max_height);
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
    };
    let (cursor, border, interval) = crate::live::capture_options(cfg.cursor, fps);
    let settings = Settings::new(
        monitor,
        cursor,
        border,
        SecondaryWindowSettings::Default,
        interval,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        flags,
    );
    let capture = match Capture::start_free_threaded(settings) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error captura não começou: {e:?}");
            return 4;
        }
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
