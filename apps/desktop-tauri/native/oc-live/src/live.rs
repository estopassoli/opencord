//! A live: conecta na sala do LiveKit como o participante da live (`<userId>:live`, token emitido pela API), publica
//! o vídeo pré-codificado (captura → NV12 na GPU → H.264 da placa) e o áudio do sistema (oc-audio, "tudo menos o
//! OpenCord"). Configuração numa linha JSON no stdin; avisos em JSON por linha no stdout; "stop" no stdin encerra.

use std::io::{BufRead, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use livekit::options::{TrackPublishOptions, VideoCodec, VideoEncoderBackend, VideoEncoding};
use livekit::prelude::*;
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
use livekit::webrtc::video_frame::{EncodedFrameType, EncodedVideoCodec, EncodedVideoFrame};
use livekit::webrtc::video_source::native::NativeVideoSource;
use livekit::webrtc::video_source::{RtcVideoSource, VideoResolution};
use serde::Deserialize;
use serde_json::json;
use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::ID3D11Multithread;
use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings, MinimumUpdateIntervalSettings,
    SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use crate::encoder::{Config as EncConfig, Control, Dev, Encoder, Input, Tex};
use crate::gpu::Converter;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub url: String,
    pub token: String,
    /// `window:<hwnd>` ou `screen:<hmonitor>` (ids do `sources`)
    pub source: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// bps
    pub bitrate: u32,
    #[serde(default = "yes")]
    pub cursor: bool,
    /// com áudio: o pid do app (o som dele e dos filhos fica de fora) e o caminho do oc-audio.exe
    pub audio_except_pid: Option<u32>,
    pub oc_audio: Option<String>,
}

fn yes() -> bool {
    true
}

/// um aviso para o app (uma linha JSON no stdout)
pub fn say(v: serde_json::Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

struct Flags {
    cfg: Config,
    tx: SyncSender<Input>,
    ctl: Arc<Control>,
    start: Instant,
    /// o encoder é criado com o device da captura (o mesmo da textura): o handler entrega o device para a thread dele
    dev_tx: SyncSender<Dev>,
    dropped: Arc<AtomicU64>,
}

struct Capture {
    conv: Converter,
    tx: SyncSender<Input>,
    ctl: Arc<Control>,
    start: Instant,
    dropped: Arc<AtomicU64>,
}

impl GraphicsCaptureApiHandler for Capture {
    type Flags = Flags;
    type Error = String;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        // a captura, a conversão e o encoder usam o mesmo device em threads diferentes
        if let Ok(mt) = ctx.device_context.cast::<ID3D11Multithread>() {
            unsafe {
                let _ = mt.SetMultithreadProtected(true);
            }
        }
        let f = ctx.flags;
        let conv = Converter::new(&ctx.device, &ctx.device_context, f.cfg.width, f.cfg.height, f.cfg.fps)
            .map_err(|e| format!("conversão na GPU: {e}"))?;
        f.dev_tx.send(Dev(ctx.device.clone())).map_err(|_| "encoder não iniciou".to_string())?;
        Ok(Self { conv, tx: f.tx, ctl: f.ctl, start: f.start, dropped: f.dropped })
    }

    fn on_frame_arrived(&mut self, frame: &mut Frame, control: InternalCaptureControl) -> Result<(), Self::Error> {
        if self.ctl.stop.load(Ordering::Acquire) {
            control.stop();
            return Ok(());
        }
        let (w, h) = (frame.width(), frame.height());
        let nv12 = self.conv.convert(frame.as_raw_texture(), w, h).map_err(|e| format!("conversão: {e}"))?;
        let ts = self.start.elapsed().as_nanos() as i64 / 100;
        match self.tx.try_send(Input { tex: Tex(nv12), ts }) {
            Ok(()) => {}
            // o encoder está atrasado: este quadro fica de fora (melhor que acumular atraso)
            Err(TrySendError::Full(_)) => {
                self.dropped.fetch_add(1, Ordering::Relaxed);
            }
            Err(TrySendError::Disconnected(_)) => control.stop(),
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        // janela fechada / monitor removido
        say(json!({ "ev": "ended", "reason": "source-closed" }));
        self.ctl.stop.store(true, Ordering::Release);
        Ok(())
    }
}

fn parse_source(s: &str) -> Result<(bool, usize), String> {
    let (kind, id) = s.split_once(':').ok_or("fonte inválida")?;
    let id: usize = id.parse().map_err(|_| "fonte inválida")?;
    match kind {
        "window" => Ok((true, id)),
        "screen" => Ok((false, id)),
        _ => Err("fonte inválida".into()),
    }
}

/// áudio do sistema: oc-audio.exe except <pid> → PCM float estéreo 48 kHz → frames de 10 ms para o LiveKit
fn start_audio(cfg: &Config, src: NativeAudioSource, rt: &tokio::runtime::Handle) -> Option<Child> {
    let (pid, exe) = (cfg.audio_except_pid?, cfg.oc_audio.clone()?);
    let mut child = Command::new(exe)
        .args(["apps-except", &pid.to_string()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| say(json!({ "ev": "warn", "message": format!("áudio da live não abriu: {e}") })))
        .ok()?;
    let mut out = child.stdout.take()?;
    let rt = rt.clone();
    std::thread::spawn(move || {
        const SPC: usize = 480; // 10 ms a 48 kHz
        let mut bytes = vec![0u8; SPC * 2 * 4];
        let mut pcm = vec![0i16; SPC * 2];
        loop {
            if out.read_exact(&mut bytes).is_err() {
                return;
            }
            for (i, c) in bytes.chunks_exact(4).enumerate() {
                let f = f32::from_le_bytes([c[0], c[1], c[2], c[3]]).clamp(-1.0, 1.0);
                pcm[i] = (f * i16::MAX as f32) as i16;
            }
            let frame = AudioFrame {
                data: pcm.as_slice().into(),
                sample_rate: 48_000,
                num_channels: 2,
                samples_per_channel: SPC as u32,
            };
            if rt.block_on(src.capture_frame(&frame)).is_err() {
                return;
            }
        }
    });
    Some(child)
}

pub fn run_from_stdin() -> i32 {
    let mut line = String::new();
    if std::io::stdin().lock().read_line(&mut line).is_err() {
        return 2;
    }
    let cfg: Config = match serde_json::from_str(&line) {
        Ok(c) => c,
        Err(e) => {
            say(json!({ "ev": "error", "message": format!("configuração inválida: {e}") }));
            return 2;
        }
    };
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
    let code = rt.block_on(run(cfg, rt.handle().clone()));
    rt.shutdown_timeout(Duration::from_secs(2));
    code
}

async fn run(cfg: Config, handle: tokio::runtime::Handle) -> i32 {
    let (is_window, raw) = match parse_source(&cfg.source) {
        Ok(v) => v,
        Err(e) => {
            say(json!({ "ev": "error", "message": e }));
            return 2;
        }
    };
    // ---- sala
    let mut opts = RoomOptions::default();
    opts.auto_subscribe = false;
    let (room, mut events) = match Room::connect(&cfg.url, &cfg.token, opts).await {
        Ok(r) => r,
        Err(e) => {
            say(json!({ "ev": "error", "message": format!("não conectou na sala: {e}") }));
            return 3;
        }
    };
    say(json!({ "ev": "connected" }));

    // ---- vídeo: encoder primeiro (sem encoder de hardware, a live não sai por aqui)
    let ctl = Arc::new(Control::default());
    let (tx, rx) = sync_channel::<Input>(2);
    let (dev_tx, dev_rx) = sync_channel::<Dev>(1);
    let dropped = Arc::new(AtomicU64::new(0));
    let flags = Flags {
        cfg: cfg.clone(),
        tx,
        ctl: ctl.clone(),
        start: Instant::now(),
        dev_tx,
        dropped: dropped.clone(),
    };
    let cursor = if cfg.cursor { CursorCaptureSettings::WithCursor } else { CursorCaptureSettings::WithoutCursor };
    let interval = MinimumUpdateIntervalSettings::Custom(Duration::from_micros(1_000_000 / cfg.fps as u64));
    macro_rules! settings {
        ($item:expr) => {
            Settings::new(
                $item,
                cursor,
                DrawBorderSettings::WithoutBorder,
                SecondaryWindowSettings::Default,
                interval,
                DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                flags,
            )
        };
    }
    let capture = if is_window {
        Capture::start_free_threaded(settings!(Window::from_raw_hwnd(raw as *mut _)))
            .map(|c| Box::new(c) as Box<dyn std::any::Any>)
    } else {
        Capture::start_free_threaded(settings!(Monitor::from_raw_hmonitor(raw as *mut _)))
            .map(|c| Box::new(c) as Box<dyn std::any::Any>)
    };
    if let Err(e) = &capture {
        say(json!({ "ev": "error", "message": format!("captura não começou: {e:?}") }));
        room.close().await.ok();
        return 4;
    }
    let Ok(Dev(device)) = dev_rx.recv_timeout(Duration::from_secs(5)) else {
        say(json!({ "ev": "error", "message": "captura sem device" }));
        return 4;
    };

    let video = NativeVideoSource::new_encoded(VideoResolution { width: cfg.width, height: cfg.height });
    let enc_cfg = EncConfig { width: cfg.width, height: cfg.height, fps: cfg.fps, bitrate: cfg.bitrate };
    let (name_tx, name_rx) = sync_channel::<Result<String, String>>(1);
    let frames = Arc::new(AtomicU64::new(0));
    let bytes = Arc::new(AtomicU64::new(0));
    let keys = Arc::new(AtomicU64::new(0));
    let enc_thread = {
        let (ctl, video, frames, bytes, keys) = (ctl.clone(), video.clone(), frames.clone(), bytes.clone(), keys.clone());
        let max_bps = cfg.bitrate as u64;
        std::thread::spawn(move || {
            let enc = match Encoder::new(&device, enc_cfg) {
                Ok(e) => e,
                Err(e) => {
                    let _ = name_tx.send(Err(format!("{e}")));
                    ctl.stop.store(true, Ordering::Release);
                    return;
                }
            };
            let _ = name_tx.send(Ok(enc.name.clone()));
            let res = enc.run(rx, ctl.clone(), |out| {
                frames.fetch_add(1, Ordering::Relaxed);
                bytes.fetch_add(out.data.len() as u64, Ordering::Relaxed);
                if out.key {
                    keys.fetch_add(1, Ordering::Relaxed);
                }
                video.capture_encoded_frame(&EncodedVideoFrame {
                    codec: EncodedVideoCodec::H264,
                    payload: &out.data,
                    timestamp_us: out.ts_us,
                    frame_type: if out.key { EncodedFrameType::Key } else { EncodedFrameType::Delta },
                    resolution: VideoResolution { width: enc_cfg.width, height: enc_cfg.height },
                    frame_metadata: None,
                });
                // a rede pede quadro-chave (alguém entrou, perdeu pacote) e ajusta o bitrate (banda estimada)
                if video.take_keyframe_request() {
                    ctl.force_key.store(true, Ordering::Release);
                }
                if let Some(rc) = video.take_rate_control_request() {
                    ctl.bitrate.store(rc.target_bitrate_bps.clamp(500_000, max_bps), Ordering::Release);
                }
            });
            if let Err(e) = res {
                say(json!({ "ev": "error", "message": format!("encoder: {e}") }));
            }
            ctl.stop.store(true, Ordering::Release);
        })
    };
    let encoder_name = match name_rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(n)) => n,
        Ok(Err(e)) => {
            say(json!({ "ev": "error", "code": "no-hw-encoder", "message": e }));
            ctl.stop.store(true, Ordering::Release);
            room.close().await.ok();
            return 5;
        }
        Err(_) => {
            say(json!({ "ev": "error", "message": "encoder não respondeu" }));
            ctl.stop.store(true, Ordering::Release);
            room.close().await.ok();
            return 5;
        }
    };

    let track = LocalVideoTrack::create_video_track("screen", RtcVideoSource::Native(video));
    let vopts = TrackPublishOptions {
        source: TrackSource::Screenshare,
        video_codec: VideoCodec::H264,
        // o H.264 já vem pronto da placa: o libwebrtc só empacota e envia
        video_encoder: VideoEncoderBackend::PreEncoded,
        simulcast: false,
        video_encoding: Some(VideoEncoding { max_bitrate: cfg.bitrate as u64, max_framerate: cfg.fps as f64 }),
        ..Default::default()
    };
    if let Err(e) = room.local_participant().publish_track(LocalTrack::Video(track), vopts).await {
        say(json!({ "ev": "error", "message": format!("não publicou o vídeo: {e}") }));
        ctl.stop.store(true, Ordering::Release);
        room.close().await.ok();
        return 6;
    }

    // ---- áudio do sistema
    let mut audio_child = None;
    if cfg.audio_except_pid.is_some() {
        let src = NativeAudioSource::new(
            AudioSourceOptions { echo_cancellation: false, noise_suppression: false, auto_gain_control: false },
            48_000,
            2,
            200,
        );
        let track = LocalAudioTrack::create_audio_track("screen-audio", RtcAudioSource::Native(src.clone()));
        let aopts = TrackPublishOptions {
            source: TrackSource::ScreenshareAudio,
            dtx: false,
            red: false,
            audio_encoding: Some(livekit::options::AudioEncoding { max_bitrate: 128_000 }),
            ..Default::default()
        };
        match room.local_participant().publish_track(LocalTrack::Audio(track), aopts).await {
            Ok(_) => audio_child = start_audio(&cfg, src, &handle),
            Err(e) => say(json!({ "ev": "warn", "message": format!("áudio não publicou: {e}") })),
        }
    }
    say(json!({ "ev": "publishing", "encoder": encoder_name, "audio": audio_child.is_some() }));

    // ---- "stop" no stdin (ou stdin fechado: o app caiu) encerra
    let stop_flag = ctl.clone();
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(l) if l.trim() == "stop" => break,
                Ok(_) => continue,
                Err(_) => break,
            }
        }
        stop_flag.stop.store(true, Ordering::Release);
    });

    // ---- laço: números a cada 2 s, sala caída ou fim
    let audio_child = Arc::new(Mutex::new(audio_child));
    let mut tick = tokio::time::interval(Duration::from_secs(2));
    let mut last = (0u64, 0u64, Instant::now());
    let reason = loop {
        tokio::select! {
            _ = tick.tick() => {
                if ctl.stop.load(Ordering::Acquire) { break "stopped"; }
                let (f, b) = (frames.load(Ordering::Relaxed), bytes.load(Ordering::Relaxed));
                let dt = last.2.elapsed().as_secs_f64().max(0.001);
                say(json!({
                    "ev": "stats",
                    "fps": ((f - last.0) as f64 / dt * 10.0).round() / 10.0,
                    "kbps": ((b - last.1) as f64 * 8.0 / dt / 1000.0).round(),
                    "keyframes": keys.load(Ordering::Relaxed),
                    "dropped": dropped.load(Ordering::Relaxed),
                }));
                last = (f, b, Instant::now());
            }
            ev = events.recv() => match ev {
                Some(RoomEvent::Disconnected { .. }) | None => break "disconnected",
                _ => {}
            }
        }
    };
    ctl.stop.store(true, Ordering::Release);
    if let Some(mut c) = audio_child.lock().unwrap().take() {
        drop(c.stdin.take());
        let _ = c.kill();
    }
    let _ = enc_thread.join();
    drop(capture);
    room.close().await.ok();
    say(json!({ "ev": "ended", "reason": reason }));
    0
}
