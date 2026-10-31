// oc-audio.exe: captura o som de UMA saída de áudio do Windows (WASAPI loopback, modo compartilhado) para os clipes
// (ADR-0024). O Chromium só grava o dispositivo de saída padrão; fones com duas saídas (ex.: "Game" e "Chat") deixavam
// a outra de fora.
//
//   oc-audio.exe list          → JSON com as saídas ativas: [{"id","name","default","comm"}]
//   oc-audio.exe capture <id>  → PCM float32 LE estéreo 48 kHz intercalado no stdout, até o stdin fechar
//   oc-audio.exe except <pid>  → idem, com o som de TODOS os processos menos <pid> e os filhos dele (process loopback,
//                                Windows 10 build 20348+). Áudio do Go Live sem as vozes da chamada (ADR-0025).
//
// Compilado com o csc do .NET Framework 4 que vem no Windows (C# 5: sem interpolação de strings etc.).
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace OpenCord.WinAudio
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore props);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey
    {
        public Guid fmtid;
        public int pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PropVariant
    {
        public ushort vt;
        public ushort r1, r2, r3;
        public IntPtr p;
        public IntPtr p2;
    }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint frames);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation
    {
        [PreserveSig] int GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler
    {
        [PreserveSig] int ActivateCompleted(IActivateAudioInterfaceAsyncOperation op);
    }

    // a ativação chama o handler de outra thread: ele precisa ser ágil
    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject { }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    class Activation : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEvent Done = new ManualResetEvent(false);
        public int Result = -1;
        public object Client;

        public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation op)
        {
            int hr;
            object o;
            if (op.GetActivateResult(out hr, out o) == 0) { Result = hr; Client = o; }
            Done.Set();
            return 0;
        }
    }

    static class Program
    {
        const int eRender = 0;
        const int eConsole = 0;
        const int eCommunications = 2;
        const int DEVICE_STATE_ACTIVE = 1;
        const int CLSCTX_ALL = 23;
        const int AUDCLNT_SHAREMODE_SHARED = 0;
        const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
        const int AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
        const int AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = unchecked((int)0x80000000);
        const int AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1;
        const int PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1;
        const ushort VT_BLOB = 65;
        const uint AUDCLNT_BUFFERFLAGS_SILENT = 2;
        const int OUT_RATE = 48000;

        static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
        static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
        static readonly Guid SUBTYPE_FLOAT = new Guid("00000003-0000-0010-8000-00aa00389b71");
        static readonly Guid SUBTYPE_PCM = new Guid("00000001-0000-0010-8000-00aa00389b71");

        [DllImport("Mmdevapi.dll", ExactSpelling = true)]
        static extern int ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
            [MarshalAs(UnmanagedType.LPStruct)] Guid riid, IntPtr activationParams,
            IActivateAudioInterfaceCompletionHandler completionHandler, out IActivateAudioInterfaceAsyncOperation op);

        [MTAThread]
        static int Main(string[] args)
        {
            try
            {
                if (args.Length == 1 && args[0] == "list") return List();
                if (args.Length == 2 && args[0] == "capture") return Capture(args[1]);
                uint pid;
                if (args.Length == 2 && args[0] == "except" && uint.TryParse(args[1], out pid)) return Except(pid);
                Console.Error.WriteLine("uso: oc-audio list | oc-audio capture <id> | oc-audio except <pid>");
                return 64;
            }
            catch (Exception e)
            {
                Console.Error.WriteLine(e.Message);
                return 1;
            }
        }

        static IMMDeviceEnumerator Enumerator()
        {
            return (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        }

        static string DefaultId(IMMDeviceEnumerator en, int role)
        {
            IMMDevice d;
            if (en.GetDefaultAudioEndpoint(eRender, role, out d) != 0 || d == null) return null;
            string id;
            d.GetId(out id);
            return id;
        }

        static string FriendlyName(IMMDevice d)
        {
            IPropertyStore props;
            if (d.OpenPropertyStore(0, out props) != 0 || props == null) return "";
            // PKEY_Device_FriendlyName
            PropertyKey key = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
            PropVariant v;
            if (props.GetValue(ref key, out v) != 0) return "";
            // VT_LPWSTR
            return v.vt == 31 && v.p != IntPtr.Zero ? Marshal.PtrToStringUni(v.p) : "";
        }

        static string Json(string s)
        {
            StringBuilder b = new StringBuilder("\"");
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') b.Append('\\').Append(c);
                else if (c < 32) b.Append("\\u").Append(((int)c).ToString("x4"));
                else b.Append(c);
            }
            return b.Append('"').ToString();
        }

        static int List()
        {
            IMMDeviceEnumerator en = Enumerator();
            string def = DefaultId(en, eConsole);
            string comm = DefaultId(en, eCommunications);
            IMMDeviceCollection all;
            Marshal.ThrowExceptionForHR(en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, out all));
            int n;
            all.GetCount(out n);
            List<string> items = new List<string>();
            for (int i = 0; i < n; i++)
            {
                IMMDevice d;
                if (all.Item(i, out d) != 0) continue;
                string id;
                d.GetId(out id);
                items.Add("{\"id\":" + Json(id) + ",\"name\":" + Json(FriendlyName(d)) + ",\"default\":" +
                    (id == def ? "true" : "false") + ",\"comm\":" + (id == comm ? "true" : "false") + "}");
            }
            Console.OutputEncoding = new UTF8Encoding(false);
            Console.Out.Write("[" + string.Join(",", items.ToArray()) + "]");
            return 0;
        }

        static int Capture(string deviceId)
        {
            IMMDeviceEnumerator en = Enumerator();
            IMMDevice dev;
            Marshal.ThrowExceptionForHR(en.GetDevice(deviceId, out dev));
            Guid iid = IID_IAudioClient;
            object o;
            Marshal.ThrowExceptionForHR(dev.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o));
            IAudioClient client = (IAudioClient)o;
            IntPtr fmt;
            Marshal.ThrowExceptionForHR(client.GetMixFormat(out fmt));
            // WAVEFORMATEX: wFormatTag(0) nChannels(2) nSamplesPerSec(4) ... wBitsPerSample(14); EXTENSIBLE: SubFormat(24)
            int tag = Marshal.ReadInt16(fmt, 0) & 0xffff;
            int channels = Marshal.ReadInt16(fmt, 2);
            int rate = Marshal.ReadInt32(fmt, 4);
            int bits = Marshal.ReadInt16(fmt, 14);
            bool isFloat = tag == 3;
            if (tag == 0xFFFE)
            {
                byte[] g = new byte[16];
                Marshal.Copy(new IntPtr(fmt.ToInt64() + 24), g, 0, 16);
                Guid sub = new Guid(g);
                isFloat = sub == SUBTYPE_FLOAT;
                if (!isFloat && sub != SUBTYPE_PCM) throw new Exception("formato de áudio não suportado");
            }
            if (!(isFloat && bits == 32) && !(!isFloat && (bits == 16 || bits == 24 || bits == 32)))
                throw new Exception("formato de áudio não suportado: " + bits + " bits");
            // 200 ms de buffer no modo compartilhado
            Marshal.ThrowExceptionForHR(client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 2000000, 0, fmt, IntPtr.Zero));
            return Pump(client, new Converter(channels, rate, bits / 8, isFloat), null);
        }

        static int Except(uint pid)
        {
            // AUDIOCLIENT_ACTIVATION_PARAMS { ActivationType, TargetProcessId, ProcessLoopbackMode } num PROPVARIANT VT_BLOB
            IntPtr p = Marshal.AllocHGlobal(12);
            IntPtr pv = Marshal.AllocHGlobal(8 + 2 * IntPtr.Size);
            IntPtr fmt = Marshal.AllocHGlobal(18);
            try
            {
                Marshal.WriteInt32(p, 0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK);
                Marshal.WriteInt32(p, 4, unchecked((int)pid));
                Marshal.WriteInt32(p, 8, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE);
                for (int i = 0; i < 8 + 2 * IntPtr.Size; i++) Marshal.WriteByte(pv, i, 0);
                Marshal.WriteInt16(pv, 0, unchecked((short)VT_BLOB));
                Marshal.WriteInt32(pv, 8, 12);
                Marshal.WriteIntPtr(pv, 8 + IntPtr.Size, p);
                Activation act = new Activation();
                IActivateAudioInterfaceAsyncOperation op;
                Marshal.ThrowExceptionForHR(ActivateAudioInterfaceAsync("VAD\\Process_Loopback", IID_IAudioClient, pv, act, out op));
                if (!act.Done.WaitOne(5000)) throw new Exception("ativação do process loopback não respondeu");
                Marshal.ThrowExceptionForHR(act.Result);
                IAudioClient client = (IAudioClient)act.Client;
                // o process loopback não tem formato próprio (GetMixFormat falha): pede float estéreo 48 kHz direto
                Marshal.WriteInt16(fmt, 0, 3);
                Marshal.WriteInt16(fmt, 2, 2);
                Marshal.WriteInt32(fmt, 4, OUT_RATE);
                Marshal.WriteInt32(fmt, 8, OUT_RATE * 8);
                Marshal.WriteInt16(fmt, 12, 8);
                Marshal.WriteInt16(fmt, 14, 32);
                Marshal.WriteInt16(fmt, 16, 0);
                Marshal.ThrowExceptionForHR(client.Initialize(AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                    2000000, 0, fmt, IntPtr.Zero));
                AutoResetEvent ready = new AutoResetEvent(false);
                Marshal.ThrowExceptionForHR(client.SetEventHandle(ready.SafeWaitHandle.DangerousGetHandle()));
                return Pump(client, new Converter(2, OUT_RATE, 4, true), ready);
            }
            finally
            {
                Marshal.FreeHGlobal(fmt);
                Marshal.FreeHGlobal(pv);
                Marshal.FreeHGlobal(p);
            }
        }

        /// <summary>Lê o cliente de captura até o stdin fechar e escreve estéreo float 48 kHz no stdout.</summary>
        static int Pump(IAudioClient client, Converter conv, AutoResetEvent ready)
        {
            Guid ciid = IID_IAudioCaptureClient;
            object co;
            Marshal.ThrowExceptionForHR(client.GetService(ref ciid, out co));
            IAudioCaptureClient capture = (IAudioCaptureClient)co;

            // o processo principal fecha o stdin para parar (e ele fecha sozinho se o app morrer)
            bool running = true;
            Thread watch = new Thread(delegate ()
            {
                try { Console.OpenStandardInput().CopyTo(Stream.Null); } catch { }
                running = false;
            });
            watch.IsBackground = true;
            watch.Start();

            Stream stdout = Console.OpenStandardOutput();
            Marshal.ThrowExceptionForHR(client.Start());
            // avisa o processo principal que a captura começou (ou ele cai para a captura do Chromium)
            Console.Error.WriteLine("ready");
            Console.Error.Flush();
            try
            {
                while (running)
                {
                    if (ready != null) ready.WaitOne(50);
                    else Thread.Sleep(10);
                    uint packet;
                    int hr = capture.GetNextPacketSize(out packet);
                    if (hr != 0) return 2; // dispositivo removido ou trocado
                    while (packet > 0)
                    {
                        IntPtr data;
                        uint frames, flags;
                        ulong pos, qpc;
                        hr = capture.GetBuffer(out data, out frames, out flags, out pos, out qpc);
                        if (hr != 0) return 2;
                        byte[] outBytes = conv.Convert(data, (int)frames, (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0);
                        capture.ReleaseBuffer(frames);
                        if (outBytes.Length > 0) stdout.Write(outBytes, 0, outBytes.Length);
                        if (capture.GetNextPacketSize(out packet) != 0) return 2;
                    }
                    stdout.Flush();
                }
            }
            catch (IOException)
            {
                // o processo principal fechou o pipe
            }
            finally
            {
                client.Stop();
            }
            return 0;
        }
    }

    /// <summary>Qualquer formato da saída → estéreo float 48 kHz (mistura os canais extras e reamostra linear).</summary>
    class Converter
    {
        readonly int channels, rate, bytesPer;
        readonly bool isFloat;
        readonly double step;
        double frac;
        float lastL, lastR;
        bool primed;

        public Converter(int channels, int rate, int bytesPer, bool isFloat)
        {
            this.channels = channels;
            this.rate = rate;
            this.bytesPer = bytesPer;
            this.isFloat = isFloat;
            step = (double)rate / 48000.0;
        }

        float Sample(IntPtr data, int index)
        {
            long at = data.ToInt64() + (long)index * bytesPer;
            if (isFloat)
            {
                int raw = Marshal.ReadInt32(new IntPtr(at));
                return BitConverter.ToSingle(BitConverter.GetBytes(raw), 0);
            }
            if (bytesPer == 2) return Marshal.ReadInt16(new IntPtr(at)) / 32768f;
            if (bytesPer == 3)
            {
                int v = Marshal.ReadByte(new IntPtr(at)) | (Marshal.ReadByte(new IntPtr(at + 1)) << 8) | ((sbyte)Marshal.ReadByte(new IntPtr(at + 2)) << 16);
                return v / 8388608f;
            }
            return Marshal.ReadInt32(new IntPtr(at)) / 2147483648f;
        }

        // ordem padrão do Windows: FL FR FC LFE BL BR SL SR
        void Frame(IntPtr data, int i, bool silent, out float l, out float r)
        {
            if (silent) { l = 0; r = 0; return; }
            int b = i * channels;
            if (channels == 1) { l = r = Sample(data, b); return; }
            l = Sample(data, b);
            r = Sample(data, b + 1);
            if (channels < 3) return;
            const float k = 0.7071f;
            float c = Sample(data, b + 2) * k;
            float sl = 0, sr = 0;
            if (channels >= 6) { sl += Sample(data, b + 4) * k; sr += Sample(data, b + 5) * k; }
            if (channels >= 8) { sl += Sample(data, b + 6) * k; sr += Sample(data, b + 7) * k; }
            l = (l + c + sl) / (channels >= 6 ? 2.4f : 1.7f);
            r = (r + c + sr) / (channels >= 6 ? 2.4f : 1.7f);
        }

        public byte[] Convert(IntPtr data, int frames, bool silent)
        {
            List<float> outS = new List<float>(frames * 2 + 8);
            for (int i = 0; i < frames; i++)
            {
                float l, r;
                Frame(data, i, silent, out l, out r);
                if (rate == 48000) { outS.Add(l); outS.Add(r); continue; }
                if (!primed) { lastL = l; lastR = r; primed = true; continue; }
                // amostras de saída entre o quadro anterior e este
                while (frac < 1.0)
                {
                    float t = (float)frac;
                    outS.Add(lastL + (l - lastL) * t);
                    outS.Add(lastR + (r - lastR) * t);
                    frac += step;
                }
                frac -= 1.0;
                lastL = l;
                lastR = r;
            }
            byte[] bytes = new byte[outS.Count * 4];
            Buffer.BlockCopy(outS.ToArray(), 0, bytes, 0, bytes.Length);
            return bytes;
        }
    }
}
