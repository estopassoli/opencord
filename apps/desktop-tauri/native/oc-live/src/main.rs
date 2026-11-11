//! oc-live.exe — Go Live nativo do OpenCord (ADR-0062), fora do WebView:
//!   oc-live sources [pid]  → JSON com telas e janelas (miniaturas) para o seletor; `pid` = o app (fica de fora)
//!   oc-live run            → lê a configuração (uma linha JSON) no stdin e transmite até "stop" no stdin
//!   oc-live clip           → grava a tela para o replay dos clipes (H.264 no stdout; ver clip.rs)
//! Processo à parte (como o oc-audio): se o driver da placa ou o libwebrtc travar, cai só a live.

#![cfg(windows)]

mod clip;
mod dxgi;
mod encoder;
mod gpu;
mod live;
mod sources;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let code = match args.get(1).map(String::as_str) {
        Some("sources") => {
            let skip = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            println!("{}", serde_json::to_string(&sources::list(skip)).unwrap_or_else(|_| "[]".into()));
            0
        }
        Some("run") => live::run_from_stdin(),
        Some("clip") => clip::run_from_stdin(),
        _ => {
            eprintln!("uso: oc-live sources [pid] | oc-live run | oc-live clip");
            2
        }
    };
    std::process::exit(code);
}
