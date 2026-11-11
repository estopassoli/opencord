//! Conversão na GPU: o quadro BGRA da captura vira NV12 já no tamanho da live (com tarja preta quando a proporção não
//! bate), pelo processador de vídeo do D3D11. Nada passa pela CPU. BT.709 em faixa limitada (16–235), como o H.264
//! espera; o encoder escreve o mesmo no fluxo.

use windows::core::{Interface, Result};
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_RATIONAL, DXGI_SAMPLE_DESC};

/// quantas texturas NV12 giram entre a conversão e o encoder (o encoder pode segurar algumas por um instante)
const RING: usize = 6;

pub struct Converter {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    vdev: ID3D11VideoDevice,
    vctx: ID3D11VideoContext,
    out_w: u32,
    out_h: u32,
    fps: u32,
    /// cópia do quadro da captura (o da captura não é garantido como entrada do processador de vídeo)
    src: Option<(u32, u32, ID3D11Texture2D, ID3D11VideoProcessorEnumerator, ID3D11VideoProcessor, ID3D11VideoProcessorInputView)>,
    ring: Vec<(ID3D11Texture2D, Option<ID3D11VideoProcessorOutputView>)>,
    next: usize,
}

impl Converter {
    pub fn new(device: &ID3D11Device, context: &ID3D11DeviceContext, out_w: u32, out_h: u32, fps: u32) -> Result<Self> {
        let vdev: ID3D11VideoDevice = device.cast()?;
        let vctx: ID3D11VideoContext = context.cast()?;
        let mut ring = Vec::with_capacity(RING);
        for _ in 0..RING {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: out_w,
                Height: out_h,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_NV12,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: 0,
            };
            let mut t = None;
            unsafe { device.CreateTexture2D(&desc, None, Some(&mut t))? };
            ring.push((t.unwrap(), None));
        }
        Ok(Self {
            device: device.clone(),
            context: context.clone(),
            vdev,
            vctx,
            out_w,
            out_h,
            fps,
            src: None,
            ring,
            next: 0,
        })
    }

    /// recria o processador quando o tamanho da fonte muda (janela redimensionada)
    fn ensure_source(&mut self, w: u32, h: u32) -> Result<()> {
        if matches!(&self.src, Some((sw, sh, ..)) if *sw == w && *sh == h) {
            return Ok(());
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
            MiscFlags: 0,
        };
        let mut tex = None;
        unsafe { self.device.CreateTexture2D(&desc, None, Some(&mut tex))? };
        let tex = tex.unwrap();
        let rate = DXGI_RATIONAL { Numerator: self.fps, Denominator: 1 };
        let content = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: rate,
            InputWidth: w,
            InputHeight: h,
            OutputFrameRate: rate,
            OutputWidth: self.out_w,
            OutputHeight: self.out_h,
            Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED,
        };
        let en = unsafe { self.vdev.CreateVideoProcessorEnumerator(&content)? };
        let vp = unsafe { self.vdev.CreateVideoProcessor(&en, 0)? };
        let in_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
            FourCC: 0,
            ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 } },
        };
        let mut iv = None;
        unsafe { self.vdev.CreateVideoProcessorInputView(&tex, &en, &in_desc, Some(&mut iv))? };
        // as vistas de saída dependem do enumerador: refeitas junto
        for r in &mut self.ring {
            r.1 = None;
        }
        unsafe {
            // entrada RGB 0–255; saída YCbCr BT.709 16–235 (bits: YCbCr_Matrix=1, Nominal_Range=1)
            self.vctx.VideoProcessorSetStreamColorSpace(&vp, 0, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 0 });
            self.vctx.VideoProcessorSetOutputColorSpace(&vp, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 0b01_0100 });
            self.vctx.VideoProcessorSetStreamFrameFormat(&vp, 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
            // sem o processador "inventar" quadros nem filtros automáticos
            self.vctx.VideoProcessorSetStreamAutoProcessingMode(&vp, 0, false);
            // tarja preta (em YCbCr: Y=16, Cb=Cr=128 em 0..1)
            let black = D3D11_VIDEO_COLOR {
                Anonymous: D3D11_VIDEO_COLOR_0 { YCbCr: D3D11_VIDEO_COLOR_YCbCrA { Y: 16.0 / 255.0, Cb: 0.5, Cr: 0.5, A: 1.0 } },
            };
            self.vctx.VideoProcessorSetOutputBackgroundColor(&vp, true, &black);
            // encaixa a fonte no quadro da live sem distorcer
            let k = (self.out_w as f32 / w as f32).min(self.out_h as f32 / h as f32);
            let (dw, dh) = ((w as f32 * k).round() as i32 & !1, (h as f32 * k).round() as i32 & !1);
            let (dx, dy) = ((self.out_w as i32 - dw) / 2 & !1, (self.out_h as i32 - dh) / 2 & !1);
            let src = RECT { left: 0, top: 0, right: w as i32, bottom: h as i32 };
            let dst = RECT { left: dx, top: dy, right: dx + dw, bottom: dy + dh };
            self.vctx.VideoProcessorSetStreamSourceRect(&vp, 0, true, Some(&src));
            self.vctx.VideoProcessorSetStreamDestRect(&vp, 0, true, Some(&dst));
            let full = RECT { left: 0, top: 0, right: self.out_w as i32, bottom: self.out_h as i32 };
            self.vctx.VideoProcessorSetOutputTargetRect(&vp, true, Some(&full));
        }
        self.src = Some((w, h, tex, en, vp, iv.unwrap()));
        Ok(())
    }

    /// converte um quadro da captura; devolve a textura NV12 (do anel) pronta para o encoder
    pub fn convert(&mut self, frame: &ID3D11Texture2D, w: u32, h: u32) -> Result<ID3D11Texture2D> {
        self.ensure_source(w, h)?;
        let (_, _, tex, en, vp, iv) = self.src.as_ref().unwrap();
        unsafe { self.context.CopyResource(tex, frame) };
        let i = self.next;
        self.next = (self.next + 1) % RING;
        if self.ring[i].1.is_none() {
            let od = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 } },
            };
            let mut ov = None;
            unsafe { self.vdev.CreateVideoProcessorOutputView(&self.ring[i].0, en, &od, Some(&mut ov))? };
            self.ring[i].1 = ov;
        }
        let stream = D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: true.into(),
            OutputIndex: 0,
            InputFrameOrField: 0,
            PastFrames: 0,
            FutureFrames: 0,
            ppPastSurfaces: std::ptr::null_mut(),
            pInputSurface: std::mem::ManuallyDrop::new(Some(iv.clone())),
            ppFutureSurfaces: std::ptr::null_mut(),
            ppPastSurfacesRight: std::ptr::null_mut(),
            pInputSurfaceRight: std::mem::ManuallyDrop::new(None),
            ppFutureSurfacesRight: std::ptr::null_mut(),
        };
        let mut streams = [stream];
        let r = unsafe { self.vctx.VideoProcessorBlt(vp, self.ring[i].1.as_ref().unwrap(), 0, &streams) };
        // a referência extra posta no ManuallyDrop volta aqui
        unsafe { std::mem::ManuallyDrop::drop(&mut streams[0].pInputSurface) };
        r?;
        Ok(self.ring[i].0.clone())
    }
}
