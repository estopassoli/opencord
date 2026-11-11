//! Encoder H.264 da placa de vídeo pelo Media Foundation (o MFT de hardware: NVENC, AMF ou Quick Sync, conforme a
//! placa). Recebe texturas NV12 da mesma GPU (sem cópia para a CPU) e devolve o H.264 em Annex B. Baixa latência,
//! sem quadros B, bitrate constante; quadro-chave e bitrate sob pedido da rede (LiveKit, vídeo pré-codificado).
//!
//! O MFT de hardware é assíncrono: pede entrada (`METransformNeedInput`) e avisa quando tem saída
//! (`METransformHaveOutput`). Tudo roda numa thread só (as interfaces do MFT ficam nela).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use windows::core::{Interface, GUID, PWSTR};
use windows::Win32::Foundation::LUID;
use windows::Win32::Graphics::Direct3D11::{ID3D11Device, ID3D11Texture2D};
use windows::Win32::Graphics::Dxgi::{IDXGIAdapter, IDXGIDevice};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_MULTITHREADED};
use windows::Win32::Foundation::{VARIANT_FALSE, VARIANT_TRUE};
use windows::Win32::System::Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_BOOL, VT_UI4};

/// COM do D3D11 é livre de thread (o device tem a proteção de multithread ligada): dá para mandar entre threads
pub struct Tex(pub ID3D11Texture2D);
unsafe impl Send for Tex {}
pub struct Dev(pub ID3D11Device);
unsafe impl Send for Dev {}

pub struct Input {
    pub tex: Tex,
    /// tempo do quadro em unidades de 100 ns
    pub ts: i64,
}

pub struct Encoded {
    pub data: Vec<u8>,
    pub key: bool,
    pub ts_us: i64,
}

/// pedidos de fora para o encoder (a rede pede quadro-chave e muda o bitrate)
#[derive(Default)]
pub struct Control {
    pub stop: AtomicBool,
    pub force_key: AtomicBool,
    /// novo bitrate em bps (0 = nenhum pedido)
    pub bitrate: AtomicU64,
}

#[derive(Clone, Copy)]
pub struct Config {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u32,
    /// quadro-chave a cada N segundos (a rede ainda pode pedir um a qualquer hora)
    pub gop_sec: u32,
}

const MF_VERSION: u32 = 0x0002_0070;
const H264_PROFILE_BASE: u32 = 66;
/// sem quadro novo da captura (janela parada): repete o último para a rede não ficar sem nada e o quadro-chave sair
const REPEAT_AFTER: Duration = Duration::from_millis(250);

fn var_u32(v: u32) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_UI4,
                Anonymous: VARIANT_0_0_0 { ulVal: v },
                ..Default::default()
            }),
        },
    }
}

fn var_bool(v: bool) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_BOOL,
                Anonymous: VARIANT_0_0_0 { boolVal: if v { VARIANT_TRUE } else { VARIANT_FALSE } },
                ..Default::default()
            }),
        },
    }
}

fn adapter_luid(device: &ID3D11Device) -> windows::core::Result<LUID> {
    let dxgi: IDXGIDevice = device.cast()?;
    let adapter: IDXGIAdapter = unsafe { dxgi.GetAdapter()? };
    Ok(unsafe { adapter.GetDesc()? }.AdapterLuid)
}

fn friendly_name(a: &IMFActivate) -> String {
    let mut p = PWSTR::null();
    let mut n = 0u32;
    unsafe {
        if a.GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut p, &mut n).is_ok() && !p.is_null() {
            let s = p.to_string().unwrap_or_default();
            CoTaskMemFree(Some(p.0 as *const _));
            return s;
        }
    }
    "encoder de hardware".into()
}

/// o primeiro MFT H.264 de hardware da mesma placa da captura
fn find_encoder(device: &ID3D11Device) -> windows::core::Result<(IMFTransform, String)> {
    let input = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_NV12 };
    let output = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_H264 };
    let luid = adapter_luid(device)?;
    let mut attrs: Option<IMFAttributes> = None;
    unsafe { MFCreateAttributes(&mut attrs, 1)? };
    let attrs = attrs.unwrap();
    let luid_bytes: [u8; 8] = unsafe { std::mem::transmute(luid) };
    unsafe { attrs.SetBlob(&MFT_ENUM_ADAPTER_LUID, &luid_bytes)? };
    let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count = 0u32;
    unsafe {
        MFTEnum2(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            Some(&input),
            Some(&output),
            &attrs,
            &mut list,
            &mut count,
        )?
    };
    if count == 0 || list.is_null() {
        return Err(windows::core::Error::new(MF_E_NOT_FOUND, "nenhum encoder H.264 de hardware nesta placa"));
    }
    let items = unsafe { std::slice::from_raw_parts_mut(list, count as usize) };
    let first = items[0].take().unwrap();
    for it in items.iter_mut() {
        drop(it.take());
    }
    unsafe { CoTaskMemFree(Some(list as *const _)) };
    let name = friendly_name(&first);
    let mft: IMFTransform = unsafe { first.ActivateObject()? };
    Ok((mft, name))
}

fn set_size(t: &IMFMediaType, key: &GUID, a: u32, b: u32) -> windows::core::Result<()> {
    unsafe { t.SetUINT64(key, ((a as u64) << 32) | b as u64) }
}

fn color(t: &IMFMediaType) -> windows::core::Result<()> {
    unsafe {
        t.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32)?;
        t.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32)?;
        t.SetUINT32(&MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709.0 as u32)?;
        t.SetUINT32(&MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709.0 as u32)?;
    }
    Ok(())
}

/// unidades NAL de um fluxo Annex B: (tipo, bytes com o código de início)
fn nals(b: &[u8]) -> Vec<(u8, &[u8])> {
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 <= b.len() {
        if b[i] == 0 && b[i + 1] == 0 && b[i + 2] == 1 {
            // código de 4 bytes (00 00 00 01): começa no zero de antes
            let s = if i > 0 && b[i - 1] == 0 { i - 1 } else { i };
            starts.push((s, i + 3));
            i += 3;
        } else {
            i += 1;
        }
    }
    let mut out = Vec::with_capacity(starts.len());
    for (k, &(s, h)) in starts.iter().enumerate() {
        let end = starts.get(k + 1).map_or(b.len(), |n| n.0);
        if h < end {
            out.push((b[h] & 0x1f, &b[s..end]));
        }
    }
    out
}

/// SPS (7) e PPS (8) do quadro, se ele trouxer
fn parameter_sets(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    for (t, n) in nals(b) {
        if t == 7 || t == 8 {
            out.extend_from_slice(n);
        }
    }
    out
}

fn has_sps(b: &[u8]) -> bool {
    nals(b).iter().any(|(t, _)| *t == 7)
}

pub struct Encoder {
    mft: IMFTransform,
    codec: ICodecAPI,
    events: IMFMediaEventGenerator,
    _manager: IMFDXGIDeviceManager,
    provides_samples: bool,
    out_size: u32,
    /// SPS/PPS do fluxo (vai na frente do quadro-chave que vier sem eles)
    header: Vec<u8>,
    pub name: String,
    cfg: Config,
}

impl Encoder {
    pub fn new(device: &ID3D11Device, cfg: Config) -> windows::core::Result<Self> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            MFStartup(MF_VERSION, MFSTARTUP_FULL)?;
        }
        let (mft, name) = find_encoder(device)?;
        unsafe {
            let attrs = mft.GetAttributes()?;
            attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)?;
            let _ = attrs.SetUINT32(&MF_LOW_LATENCY, 1);
        }
        let mut token = 0u32;
        let mut manager: Option<IMFDXGIDeviceManager> = None;
        unsafe { MFCreateDXGIDeviceManager(&mut token, &mut manager)? };
        let manager = manager.unwrap();
        unsafe {
            manager.ResetDevice(device, token)?;
            mft.ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize)?;
        }
        // encoder: primeiro o tipo de saída, depois o de entrada
        let out = unsafe { MFCreateMediaType()? };
        unsafe {
            out.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            out.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
            out.SetUINT32(&MF_MT_AVG_BITRATE, cfg.bitrate)?;
            set_size(&out, &MF_MT_FRAME_SIZE, cfg.width, cfg.height)?;
            set_size(&out, &MF_MT_FRAME_RATE, cfg.fps, 1)?;
            set_size(&out, &MF_MT_PIXEL_ASPECT_RATIO, 1, 1)?;
            out.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            out.SetUINT32(&MF_MT_MPEG2_PROFILE, H264_PROFILE_BASE)?;
            color(&out)?;
            mft.SetOutputType(0, &out, 0)?;
        }
        let inp = unsafe { MFCreateMediaType()? };
        unsafe {
            inp.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            inp.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
            set_size(&inp, &MF_MT_FRAME_SIZE, cfg.width, cfg.height)?;
            set_size(&inp, &MF_MT_FRAME_RATE, cfg.fps, 1)?;
            set_size(&inp, &MF_MT_PIXEL_ASPECT_RATIO, 1, 1)?;
            inp.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            color(&inp)?;
            mft.SetInputType(0, &inp, 0)?;
        }
        let codec: ICodecAPI = mft.cast()?;
        unsafe {
            // alguns encoders não aceitam todos: o que falhar fica no padrão deles
            let _ = codec.SetValue(&CODECAPI_AVLowLatencyMode, &var_bool(true));
            let _ = codec.SetValue(
                &CODECAPI_AVEncCommonRateControlMode,
                &var_u32(eAVEncCommonRateControlMode_CBR.0 as u32),
            );
            let _ = codec.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &var_u32(cfg.bitrate));
            let _ = codec.SetValue(&CODECAPI_AVEncMPVDefaultBPictureCount, &var_u32(0));
            // quadro-chave a cada `gop_sec` (live: quem entra no meio pede um na hora, PLI)
            let _ = codec.SetValue(&CODECAPI_AVEncMPVGOPSize, &var_u32(cfg.fps * cfg.gop_sec.max(1)));
        }
        let info = unsafe { mft.GetOutputStreamInfo(0)? };
        let provides_samples = info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32) != 0;
        let mut header = Vec::new();
        unsafe {
            if let Ok(t) = mft.GetOutputCurrentType(0) {
                if let Ok(n) = t.GetBlobSize(&MF_MT_MPEG_SEQUENCE_HEADER) {
                    header.resize(n as usize, 0);
                    if t.GetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut header, None).is_err() {
                        header.clear();
                    }
                }
            }
            mft.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0)?;
            mft.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            mft.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        }
        let events: IMFMediaEventGenerator = mft.cast()?;
        Ok(Self {
            mft,
            codec,
            events,
            _manager: manager,
            provides_samples,
            out_size: info.cbSize.max(cfg.width * cfg.height),
            header,
            name,
            cfg,
        })
    }

    fn feed(&self, tex: &ID3D11Texture2D, ts: i64) -> windows::core::Result<()> {
        unsafe {
            let buf = MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, tex, 0, false)?;
            if let Ok(b2) = buf.cast::<IMF2DBuffer>() {
                let len = b2.GetContiguousLength()?;
                buf.SetCurrentLength(len)?;
            }
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buf)?;
            sample.SetSampleTime(ts)?;
            sample.SetSampleDuration(10_000_000 / self.cfg.fps as i64)?;
            self.mft.ProcessInput(0, &sample, 0)
        }
    }

    fn drain(&mut self) -> windows::core::Result<Option<Encoded>> {
        let mut own: Option<IMFSample> = None;
        if !self.provides_samples {
            unsafe {
                let s = MFCreateSample()?;
                let b = MFCreateMemoryBuffer(self.out_size)?;
                s.AddBuffer(&b)?;
                own = Some(s);
            }
        }
        let mut out = [MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: 0,
            pSample: std::mem::ManuallyDrop::new(own),
            dwStatus: 0,
            pEvents: std::mem::ManuallyDrop::new(None),
        }];
        let mut status = 0u32;
        let r = unsafe { self.mft.ProcessOutput(0, &mut out, &mut status) };
        let sample = unsafe { std::mem::ManuallyDrop::take(&mut out[0].pSample) };
        unsafe { drop(std::mem::ManuallyDrop::take(&mut out[0].pEvents)) };
        if let Err(e) = r {
            if e.code() == MF_E_TRANSFORM_STREAM_CHANGE {
                // a saída mudou de formato: aceita o que o encoder propõe
                unsafe {
                    let t = self.mft.GetOutputAvailableType(0, 0)?;
                    self.mft.SetOutputType(0, &t, 0)?;
                }
                return Ok(None);
            }
            if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT {
                return Ok(None);
            }
            return Err(e);
        }
        let Some(sample) = sample else { return Ok(None) };
        unsafe {
            let buf = sample.ConvertToContiguousBuffer()?;
            let mut p: *mut u8 = std::ptr::null_mut();
            let mut len = 0u32;
            buf.Lock(&mut p, None, Some(&mut len))?;
            let mut data = std::slice::from_raw_parts(p, len as usize).to_vec();
            buf.Unlock()?;
            let key = sample.GetUINT32(&MFSampleExtension_CleanPoint).unwrap_or(0) == 1;
            // a SFU só libera o vídeo para quem assiste num quadro-chave com SPS: o encoder da NVIDIA manda SPS/PPS
            // só no primeiro; os seguintes levam o último cabeçalho visto
            if key {
                if has_sps(&data) {
                    self.header = parameter_sets(&data);
                } else if !self.header.is_empty() {
                    let mut with = self.header.clone();
                    with.extend_from_slice(&data);
                    data = with;
                }
            }
            let ts = sample.GetSampleTime().unwrap_or(0);
            Ok(Some(Encoded { data, key, ts_us: ts / 10 }))
        }
    }

    fn apply_control(&self, ctl: &Control) {
        if ctl.force_key.swap(false, Ordering::AcqRel) {
            unsafe {
                let _ = self.codec.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &var_u32(1));
            }
        }
        let b = ctl.bitrate.swap(0, Ordering::AcqRel);
        if b > 0 {
            unsafe {
                let _ = self.codec.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &var_u32(b.min(u32::MAX as u64) as u32));
            }
        }
    }

    /// laço do encoder: até `stop`; cada saída vai para `on_out`
    pub fn run(
        mut self,
        rx: Receiver<Input>,
        ctl: Arc<Control>,
        mut on_out: impl FnMut(Encoded),
    ) -> windows::core::Result<()> {
        // o último quadro, quando foi entregue e o tempo dele: o repetido continua o mesmo relógio da captura
        let mut last: Option<(Tex, Instant, i64)> = None;
        while !ctl.stop.load(Ordering::Acquire) {
            let ev = unsafe { self.events.GetEvent(MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS(0))? };
            let kind = unsafe { ev.GetType()? } as i32;
            if kind == METransformNeedInput.0 {
                // espera o próximo quadro; sem quadro novo, repete o último (janela parada)
                loop {
                    if ctl.stop.load(Ordering::Acquire) {
                        return Ok(());
                    }
                    match rx.recv_timeout(Duration::from_millis(50)) {
                        Ok(inp) => {
                            self.apply_control(&ctl);
                            self.feed(&inp.tex.0, inp.ts)?;
                            last = Some((inp.tex, Instant::now(), inp.ts));
                            break;
                        }
                        Err(RecvTimeoutError::Timeout) => {
                            let repeat = last.as_ref().is_some_and(|(_, at, _)| at.elapsed() >= REPEAT_AFTER)
                                || (last.is_some() && ctl.force_key.load(Ordering::Acquire));
                            if repeat {
                                let (tex, at, ts0) = last.take().unwrap();
                                self.apply_control(&ctl);
                                // sempre depois do anterior (ao menos 1 ms), no relógio da captura
                                let ts = ts0 + (at.elapsed().as_nanos() as i64 / 100).max(10_000);
                                self.feed(&tex.0, ts)?;
                                last = Some((tex, Instant::now(), ts));
                                break;
                            }
                        }
                        Err(RecvTimeoutError::Disconnected) => return Ok(()),
                    }
                }
            } else if kind == METransformHaveOutput.0 {
                if let Some(e) = self.drain()? {
                    on_out(e);
                }
            } else if kind == METransformDrainComplete.0 {
                return Ok(());
            }
        }
        Ok(())
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        unsafe {
            let _ = self.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            let _ = self.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
            let _ = MFShutdown();
        }
    }
}
