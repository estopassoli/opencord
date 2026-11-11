//! Captura de monitor pela Desktop Duplication do DXGI, sem a borda amarela.
//!
//! No Windows 10 a Windows Graphics Capture sempre desenha uma borda amarela em volta do que é capturado (só o
//! Windows 11 deixa tirar, `IsBorderRequired`). A Desktop Duplication (a "Captura de tela" do OBS) não tem borda, mas
//! só captura monitores inteiros e entrega a imagem sem o cursor: o cursor é desenhado aqui, pelo GDI, numa cópia da
//! imagem. Janela continua pela WGC (com a borda no Windows 10).
//!
//! Usada quando o Windows não deixa tirar a borda (ou com `OC_LIVE_DXGI=1`, para testar no Windows 11). Se a
//! duplicação não abre (a placa que liga o monitor não é a do device, outra app já duplica, etc.), quem chamou volta
//! para a WGC.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, TrySendError};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, ID3D11Multithread, ID3D11Texture2D, D3D11_BIND_RENDER_TARGET,
    D3D11_BIND_SHADER_RESOURCE, D3D11_RESOURCE_MISC_GDI_COMPATIBLE, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    IDXGIDevice, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource, IDXGISurface1, DXGI_ERROR_ACCESS_LOST,
    DXGI_ERROR_NOT_FOUND, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
};
use windows::Win32::Graphics::Gdi::{DeleteObject, GetMonitorInfoW, HMONITOR, MONITORINFO};
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::WindowsAndMessaging::{
    DrawIconEx, GetCursorInfo, GetIconInfo, CURSORINFO, CURSOR_SHOWING, DI_NORMAL, HCURSOR, HICON, ICONINFO,
};
use windows_capture::graphics_capture_api::GraphicsCaptureApi;

use crate::encoder::{Dev, Input, Tex};
use crate::gpu::Converter;
use crate::live::{frame_interval, Flags, Pacer};

/// a captura de monitor vai pela Desktop Duplication?
pub(crate) fn wanted() -> bool {
    std::env::var_os("OC_LIVE_DXGI").is_some() || !GraphicsCaptureApi::is_border_settings_supported().unwrap_or(false)
}

/// a captura rodando numa thread; parar = soltar este valor (ou `ctl.stop`)
pub(crate) struct DxgiCapture {
    halt: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for DxgiCapture {
    fn drop(&mut self) {
        self.halt.store(true, Ordering::Release);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

struct Raw(usize);
unsafe impl Send for Raw {}

/// Abre a duplicação do monitor `hmonitor` e começa a mandar quadros para `flags.tx`. Erro = nada foi entregue (nem o
/// device), então dá para tentar a WGC em seguida.
pub(crate) fn start(hmonitor: usize, flags: Flags, cursor: bool) -> Result<DxgiCapture, String> {
    let halt = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = sync_channel::<Result<(), String>>(1);
    let thread = {
        let halt = halt.clone();
        let raw = Raw(hmonitor);
        std::thread::spawn(move || {
            let raw = raw;
            let mut cap = match Duplicator::open(HMONITOR(raw.0 as *mut _), &flags, cursor) {
                Ok(c) => c,
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return;
                }
            };
            if flags.dev_tx.send(Dev(cap.device.clone())).is_err() {
                let _ = ready_tx.send(Err("encoder não iniciou".into()));
                return;
            }
            let _ = ready_tx.send(Ok(()));
            cap.run(&flags, &halt);
        })
    };
    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => Ok(DxgiCapture { halt, thread: Some(thread) }),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => {
            halt.store(true, Ordering::Release);
            Err("duplicação não respondeu".into())
        }
    }
}

struct Duplicator {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    hmon: HMONITOR,
    dup: IDXGIOutputDuplication,
    conv: Converter,
    /// cópia da tela onde o cursor é desenhado (GDI)
    canvas: Option<(ID3D11Texture2D, u32, u32)>,
    cursor: bool,
    /// cursor da última vez → ponto quente (o GetIconInfo é caro para todo quadro)
    hot: Option<(isize, i32, i32)>,
    pacer: Pacer,
}

fn duplicate(device: &ID3D11Device, hmon: HMONITOR) -> windows::core::Result<Option<IDXGIOutputDuplication>> {
    let adapter = unsafe { device.cast::<IDXGIDevice>()?.GetAdapter()? };
    let mut i = 0;
    loop {
        let out = match unsafe { adapter.EnumOutputs(i) } {
            Ok(o) => o,
            Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => return Ok(None),
            Err(e) => return Err(e),
        };
        if unsafe { out.GetDesc()? }.Monitor == hmon {
            return unsafe { out.cast::<IDXGIOutput1>()?.DuplicateOutput(device) }.map(Some);
        }
        i += 1;
    }
}

impl Duplicator {
    fn open(hmon: HMONITOR, flags: &Flags, cursor: bool) -> Result<Self, String> {
        // coordenadas do cursor e da tela em pixels de verdade (oc-live é um processo à parte; não muda o app)
        unsafe {
            let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
        let (device, context) =
            windows_capture::d3d11::create_d3d_device().map_err(|e| format!("device da duplicação: {e}"))?;
        let dup = duplicate(&device, hmon)
            .map_err(|e| format!("duplicação: {e}"))?
            .ok_or("o monitor não está na placa do device")?;
        // a conversão e o encoder usam o mesmo device em outras threads
        if let Ok(mt) = context.cast::<ID3D11Multithread>() {
            unsafe {
                let _ = mt.SetMultithreadProtected(true);
            }
        }
        let conv = Converter::new(&device, &context, flags.width, flags.height, flags.fps)
            .map_err(|e| format!("conversão na GPU: {e}"))?;
        Ok(Self {
            device,
            context,
            hmon,
            dup,
            conv,
            canvas: None,
            cursor,
            hot: None,
            pacer: Pacer::new(Some(frame_interval(flags.fps))),
        })
    }

    fn run(&mut self, flags: &Flags, halt: &AtomicBool) {
        while !halt.load(Ordering::Acquire) && !flags.ctl.stop.load(Ordering::Acquire) {
            match self.next(flags) {
                Ok(()) => {}
                // troca de resolução, tela de UAC, jogo em tela cheia exclusiva…: a duplicação precisa ser refeita
                Err(e) if e.code() == DXGI_ERROR_ACCESS_LOST => {
                    while !halt.load(Ordering::Acquire) && !flags.ctl.stop.load(Ordering::Acquire) {
                        if let Ok(Some(d)) = duplicate(&self.device, self.hmon) {
                            self.dup = d;
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(250));
                    }
                }
                Err(e) => {
                    eprintln!("error duplicação: {e}");
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }
    }

    fn next(&mut self, flags: &Flags) -> windows::core::Result<()> {
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut res: Option<IDXGIResource> = None;
        match unsafe { self.dup.AcquireNextFrame(100, &mut info, &mut res) } {
            Ok(()) => {}
            Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(()),
            Err(e) => return Err(e),
        }
        // a imagem é copiada e o quadro devolvido na hora (segurar atrasa o DWM)
        let copied = (|| -> windows::core::Result<Option<(u32, u32)>> {
            if !self.pacer.take(Instant::now()) {
                return Ok(None);
            }
            let Some(res) = res.as_ref() else { return Ok(None) };
            let tex: ID3D11Texture2D = res.cast()?;
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { tex.GetDesc(&mut desc) };
            let canvas = self.canvas_for(desc.Width, desc.Height)?;
            unsafe { self.context.CopyResource(&canvas, &tex) };
            Ok(Some((desc.Width, desc.Height)))
        })();
        unsafe {
            let _ = self.dup.ReleaseFrame();
        }
        let Some((w, h)) = copied? else { return Ok(()) };
        let canvas = self.canvas.as_ref().map(|c| c.0.clone()).expect("canvas criado acima");
        if self.cursor {
            self.draw_cursor(&canvas);
        }
        let nv12 = self.conv.convert(&canvas, w, h)?;
        let ts = flags.start.elapsed().as_nanos() as i64 / 100;
        match flags.tx.try_send(Input { tex: Tex(nv12), ts }) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                flags.dropped.fetch_add(1, Ordering::Relaxed);
            }
            Err(TrySendError::Disconnected(_)) => flags.ctl.stop.store(true, Ordering::Release),
        }
        Ok(())
    }

    fn canvas_for(&mut self, w: u32, h: u32) -> windows::core::Result<ID3D11Texture2D> {
        if let Some((t, cw, ch)) = &self.canvas {
            if *cw == w && *ch == h {
                return Ok(t.clone());
            }
        }
        let desc = D3D11_TEXTURE2D_DESC {
            Width: w,
            Height: h,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
            CPUAccessFlags: 0,
            MiscFlags: D3D11_RESOURCE_MISC_GDI_COMPATIBLE.0 as u32,
        };
        let mut tex = None;
        unsafe { self.device.CreateTexture2D(&desc, None, Some(&mut tex))? };
        let tex = tex.expect("CreateTexture2D sem textura");
        self.canvas = Some((tex.clone(), w, h));
        Ok(tex)
    }

    /// o cursor de agora por cima da imagem (a duplicação entrega a tela sem ele)
    fn draw_cursor(&mut self, canvas: &ID3D11Texture2D) {
        unsafe {
            let mut ci = CURSORINFO { cbSize: size_of::<CURSORINFO>() as u32, ..Default::default() };
            if GetCursorInfo(&mut ci).is_err() || ci.flags.0 & CURSOR_SHOWING.0 == 0 || ci.hCursor.is_invalid() {
                return;
            }
            let mut mi = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
            if !GetMonitorInfoW(self.hmon, &mut mi).as_bool() {
                return;
            }
            let RECT { left, top, .. } = mi.rcMonitor;
            let (hx, hy) = self.hotspot(ci.hCursor);
            let Ok(surface) = canvas.cast::<IDXGISurface1>() else { return };
            let Ok(hdc) = surface.GetDC(false) else { return };
            let _ = DrawIconEx(
                hdc,
                ci.ptScreenPos.x - left - hx,
                ci.ptScreenPos.y - top - hy,
                HICON(ci.hCursor.0),
                0,
                0,
                0,
                None,
                DI_NORMAL,
            );
            let _ = surface.ReleaseDC(None);
        }
    }

    fn hotspot(&mut self, cur: HCURSOR) -> (i32, i32) {
        let key = cur.0 as isize;
        if let Some((k, x, y)) = self.hot {
            if k == key {
                return (x, y);
            }
        }
        let mut ii = ICONINFO::default();
        let (x, y) = unsafe {
            if GetIconInfo(HICON(cur.0), &mut ii).is_ok() {
                if !ii.hbmMask.is_invalid() {
                    let _ = DeleteObject(ii.hbmMask.into());
                }
                if !ii.hbmColor.is_invalid() {
                    let _ = DeleteObject(ii.hbmColor.into());
                }
                (ii.xHotspot as i32, ii.yHotspot as i32)
            } else {
                (0, 0)
            }
        };
        self.hot = Some((key, x, y));
        (x, y)
    }
}
