//! Fontes da live (o seletor do OpenCord, não o do WebView2): telas e janelas com miniatura.
//! Miniatura de janela por `PrintWindow(PW_RENDERFULLCONTENT)` (pega também janelas de jogo/aceleradas e as que estão
//! atrás de outras); de tela, cópia da área do monitor. JPEG em data URL, no mesmo formato do `desktopCapturer`.

use base64::Engine;
use serde::Serialize;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, EnumDisplayMonitors, GetDC,
    GetDIBits, GetMonitorInfoW, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC,
    HMONITOR, MONITORINFO, SRCCOPY,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowLongPtrW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
};

/// mesma forma do `CaptureSourceDto` do app (`apps/desktop/electron/shared/ipc.ts`)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub thumbnail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_id: Option<String>,
}

const THUMB_W: u32 = 320;
const THUMB_H: u32 = 180;
const PW_RENDERFULLCONTENT: u32 = 2;

/// telas primeiro (na ordem do Windows), depois as janelas (a de cima primeiro); `skip_pid` = o próprio app
pub fn list(skip_pid: u32) -> Vec<Source> {
    let mut out = Vec::new();
    for (i, m) in monitors().into_iter().enumerate() {
        let thumb = grab_screen(&m).map(|(w, h, px)| jpeg(w, h, &px)).unwrap_or_default();
        out.push(Source {
            id: format!("screen:{}", m.0 as usize),
            name: format!("Tela {}", i + 1),
            kind: "screen",
            thumbnail: thumb,
            display_id: Some(i.to_string()),
        });
    }
    for (hwnd, title) in windows(skip_pid) {
        let thumb = grab_window(hwnd).map(|(w, h, px)| jpeg(w, h, &px)).unwrap_or_default();
        out.push(Source {
            id: format!("window:{}", hwnd.0 as usize),
            name: title,
            kind: "window",
            thumbnail: thumb,
            display_id: None,
        });
    }
    out
}

pub fn monitors() -> Vec<HMONITOR> {
    unsafe extern "system" fn cb(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> windows::core::BOOL {
        let v = &mut *(data.0 as *mut Vec<HMONITOR>);
        v.push(m);
        true.into()
    }
    let mut v: Vec<HMONITOR> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(cb), LPARAM(&mut v as *mut _ as isize));
    }
    v
}

fn monitor_rect(m: &HMONITOR) -> Option<RECT> {
    let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    unsafe { GetMonitorInfoW(*m, &mut info).as_bool().then_some(info.rcMonitor) }
}

/// janelas que dá para transmitir: visíveis, com título, não minimizadas, não "fantasmas" (cloaked: outras áreas de
/// trabalho, apps da loja suspensos) e não do próprio OpenCord
fn windows(skip_pid: u32) -> Vec<(HWND, String)> {
    unsafe extern "system" fn cb(h: HWND, data: LPARAM) -> windows::core::BOOL {
        let v = &mut *(data.0 as *mut Vec<HWND>);
        v.push(h);
        true.into()
    }
    let mut all: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut all as *mut _ as isize));
    }
    let mut out = Vec::new();
    for h in all {
        unsafe {
            if !IsWindowVisible(h).as_bool() || IsIconic(h).as_bool() {
                continue;
            }
            if (GetWindowLongPtrW(h, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW.0 != 0 {
                continue;
            }
            let mut cloaked: u32 = 0;
            let _ = DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut _, 4);
            if cloaked != 0 {
                continue;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, Some(&mut pid));
            if pid == skip_pid || pid == std::process::id() {
                continue;
            }
            let n = GetWindowTextLengthW(h);
            if n <= 0 {
                continue;
            }
            let mut buf = vec![0u16; n as usize + 1];
            let got = GetWindowTextW(h, &mut buf);
            let title = String::from_utf16_lossy(&buf[..got as usize]);
            // a barra de tarefas e a área de trabalho não são "aplicativos"
            if title.is_empty() || title == "Program Manager" {
                continue;
            }
            let mut r = RECT::default();
            if GetWindowRect(h, &mut r).is_err() || r.right - r.left < 64 || r.bottom - r.top < 64 {
                continue;
            }
            out.push((h, title));
        }
    }
    out
}

/// pixels BGRA de cima para baixo
fn dib(dc: HDC, bmp: windows::Win32::Graphics::Gdi::HBITMAP, w: i32, h: i32) -> Option<Vec<u8>> {
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut px = vec![0u8; (w * h * 4) as usize];
    let n = unsafe { GetDIBits(dc, bmp, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS) };
    (n > 0).then_some(px)
}

fn grab_window(h: HWND) -> Option<(u32, u32, Vec<u8>)> {
    unsafe {
        let mut r = RECT::default();
        GetWindowRect(h, &mut r).ok()?;
        let (w, hh) = (r.right - r.left, r.bottom - r.top);
        let screen = GetDC(None);
        let dc = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, w, hh);
        let old = SelectObject(dc, bmp.into());
        let ok = PrintWindow(h, dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool();
        let px = if ok { dib(dc, bmp, w, hh) } else { None };
        SelectObject(dc, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(dc);
        ReleaseDC(None, screen);
        px.map(|p| (w as u32, hh as u32, p))
    }
}

fn grab_screen(m: &HMONITOR) -> Option<(u32, u32, Vec<u8>)> {
    let r = monitor_rect(m)?;
    let (w, h) = (r.right - r.left, r.bottom - r.top);
    unsafe {
        let screen = GetDC(None);
        let dc = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(dc, bmp.into());
        let ok = BitBlt(dc, 0, 0, w, h, Some(screen), r.left, r.top, SRCCOPY).is_ok();
        let px = if ok { dib(dc, bmp, w, h) } else { None };
        SelectObject(dc, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(dc);
        ReleaseDC(None, screen);
        px.map(|p| (w as u32, h as u32, p))
    }
}

/// reduz para caber em 320×180 (sem distorcer) e devolve `data:image/jpeg;base64,…`
fn jpeg(w: u32, h: u32, bgra: &[u8]) -> String {
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for p in bgra.chunks_exact(4) {
        rgb.extend_from_slice(&[p[2], p[1], p[0]]);
    }
    let Some(img) = image::RgbImage::from_raw(w, h, rgb) else { return String::new() };
    let k = (THUMB_W as f32 / w as f32).min(THUMB_H as f32 / h as f32).min(1.0);
    let (tw, th) = (((w as f32 * k) as u32).max(1), ((h as f32 * k) as u32).max(1));
    let small = image::imageops::resize(&img, tw, th, image::imageops::FilterType::Triangle);
    let mut out = Vec::new();
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 70);
    if enc.encode_image(&small).is_err() {
        return String::new();
    }
    format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(out))
}
