// oc-audio.exe: captura o som de UMA saída de áudio do Windows (WASAPI loopback, modo compartilhado) para os clipes
// (ADR-0024). O Chromium só grava o dispositivo de saída padrão; fones com duas saídas (ex.: "Game" e "Chat") deixavam
// a outra de fora.
//
//   oc-audio.exe list          → JSON com as saídas ativas: [{"id","name","default","comm"}]
//   oc-audio.exe capture <id>  → PCM float32 LE estéreo 48 kHz intercalado no stdout, até o stdin fechar
//   oc-audio.exe include <pid> → idem, só o som de <pid> e dos filhos dele (o som de um aplicativo transmitido)
//   oc-audio.exe except <pid>  → idem, com o som de TODOS os processos menos <pid> e os filhos dele (process loopback,
//                                Windows 10 build 20348+). Não segura o áudio de chamada do Chromium (ver abaixo).
//   oc-audio.exe apps-except <pid> → o som de cada programa com sessão de áudio, menos <pid> e os filhos dele, um
//                                INCLUDE por programa, misturados: o áudio do Go Live sem as vozes da chamada.
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

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr guid, int flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr guid, int flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName(out IntPtr name);
        [PreserveSig] int SetDisplayName(IntPtr name, IntPtr ctx);
        [PreserveSig] int GetIconPath(out IntPtr path);
        [PreserveSig] int SetIconPath(IntPtr path, IntPtr ctx);
        [PreserveSig] int GetGroupingParam(out Guid g);
        [PreserveSig] int SetGroupingParam(IntPtr g, IntPtr ctx);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
        [PreserveSig] int GetSessionIdentifier(out IntPtr id);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
        [PreserveSig] int GetProcessId(out uint pid);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PROCESSENTRY32W
    {
        public uint dwSize, cntUsage, th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID, cntThreads, th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
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
        const int PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0;
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
                if (args.Length == 2 && args[0] == "except" && uint.TryParse(args[1], out pid)) return Except(pid, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE);
                if (args.Length == 2 && args[0] == "include" && uint.TryParse(args[1], out pid)) return Except(pid, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE);
                if (args.Length == 2 && args[0] == "apps-except" && uint.TryParse(args[1], out pid)) return AppsExcept(pid);
                Console.Error.WriteLine("uso: oc-audio list | oc-audio capture <id> | oc-audio except <pid> | oc-audio include <pid> | oc-audio apps-except <pid>");
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

        /// <summary>Cliente de captura do process loopback (incluir ou excluir a árvore de <pid>), float estéreo 48 kHz.</summary>
        static IAudioClient ProcessLoopback(uint pid, int mode, AutoResetEvent ready)
        {
            IntPtr p = Marshal.AllocHGlobal(12);
            IntPtr pv = Marshal.AllocHGlobal(8 + 2 * IntPtr.Size);
            IntPtr fmt = Marshal.AllocHGlobal(18);
            try
            {
                Marshal.WriteInt32(p, 0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK);
                Marshal.WriteInt32(p, 4, unchecked((int)pid));
                Marshal.WriteInt32(p, 8, mode);
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
                Marshal.ThrowExceptionForHR(client.SetEventHandle(ready.SafeWaitHandle.DangerousGetHandle()));
                return client;
            }
            finally
            {
                Marshal.FreeHGlobal(fmt);
                Marshal.FreeHGlobal(pv);
                Marshal.FreeHGlobal(p);
            }
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern bool Process32FirstW(IntPtr snap, ref PROCESSENTRY32W e);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern bool Process32NextW(IntPtr snap, ref PROCESSENTRY32W e);
        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr h);

        /// <summary>pai de cada processo vivo agora</summary>
        static Dictionary<uint, uint> Parents()
        {
            Dictionary<uint, uint> map = new Dictionary<uint, uint>();
            IntPtr snap = CreateToolhelp32Snapshot(2, 0);
            if (snap == new IntPtr(-1)) return map;
            try
            {
                PROCESSENTRY32W e = new PROCESSENTRY32W();
                e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32W));
                if (Process32FirstW(snap, ref e))
                    do { map[e.th32ProcessID] = e.th32ParentProcessID; } while (Process32NextW(snap, ref e));
            }
            finally { CloseHandle(snap); }
            return map;
        }

        /// <summary><pid> é <root> ou descende dele (a subida para em ciclos e em pais que já saíram)</summary>
        static bool Under(uint pid, uint root, Dictionary<uint, uint> parents)
        {
            HashSet<uint> seen = new HashSet<uint>();
            uint cur = pid;
            while (cur != 0 && seen.Add(cur))
            {
                if (cur == root) return true;
                uint up;
                if (!parents.TryGetValue(cur, out up)) return false;
                cur = up;
            }
            return false;
        }

        /// <summary>processos com sessão de áudio (tocando ou parados) em qualquer saída ativa</summary>
        static HashSet<uint> AudioPids()
        {
            HashSet<uint> pids = new HashSet<uint>();
            IMMDeviceEnumerator en = Enumerator();
            IMMDeviceCollection all;
            if (en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, out all) != 0) return pids;
            int n;
            all.GetCount(out n);
            Guid iid = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
            for (int i = 0; i < n; i++)
            {
                IMMDevice d;
                if (all.Item(i, out d) != 0) continue;
                object o;
                if (d.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o) != 0) continue;
                IAudioSessionEnumerator sessions;
                if (((IAudioSessionManager2)o).GetSessionEnumerator(out sessions) != 0) continue;
                int count;
                sessions.GetCount(out count);
                for (int k = 0; k < count; k++)
                {
                    IAudioSessionControl2 c;
                    if (sessions.GetSession(k, out c) != 0) continue;
                    int state;
                    uint pid;
                    // 2 = expirada (o programa fechou a sessão)
                    if (c.GetState(out state) == 0 && state != 2 && c.GetProcessId(out pid) == 0 && pid != 0) pids.Add(pid);
                }
            }
            return pids;
        }

        /// <summary>Um programa capturado: o que chegou dele e ainda não foi misturado (float estéreo 48 kHz).</summary>
        class AppSource
        {
            public uint Pid;
            public volatile bool Stop;
            public readonly object Lock = new object();
            public readonly Queue<float> Buf = new Queue<float>();
            public Thread Thread;
        }

        /// <summary>no máximo 200 ms guardados por programa: mais que isso é atraso, descarta o mais velho</summary>
        const int MAX_BUFFERED = OUT_RATE * 2 / 5;
        const int MAX_APPS = 32;

        static void RunSource(AppSource src)
        {
            try
            {
                AutoResetEvent ready = new AutoResetEvent(false);
                IAudioClient client = ProcessLoopback(src.Pid, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, ready);
                Guid ciid = IID_IAudioCaptureClient;
                object co;
                Marshal.ThrowExceptionForHR(client.GetService(ref ciid, out co));
                IAudioCaptureClient capture = (IAudioCaptureClient)co;
                Converter conv = new Converter(2, OUT_RATE, 4, true);
                Marshal.ThrowExceptionForHR(client.Start());
                try
                {
                    while (!src.Stop)
                    {
                        ready.WaitOne(50);
                        uint packet;
                        if (capture.GetNextPacketSize(out packet) != 0) return;
                        while (packet > 0)
                        {
                            IntPtr data;
                            uint frames, flags;
                            ulong pos, qpc;
                            if (capture.GetBuffer(out data, out frames, out flags, out pos, out qpc) != 0) return;
                            float[] f = conv.ConvertFloats(data, (int)frames, (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0);
                            capture.ReleaseBuffer(frames);
                            lock (src.Lock)
                            {
                                foreach (float x in f) src.Buf.Enqueue(x);
                                while (src.Buf.Count > MAX_BUFFERED) src.Buf.Dequeue();
                            }
                            if (capture.GetNextPacketSize(out packet) != 0) return;
                        }
                    }
                }
                finally { client.Stop(); }
            }
            catch (Exception)
            {
                // programa que fechou no meio ou que não deixa capturar: só fica de fora
            }
        }

        /// <summary>
        /// Som de todos os programas menos <root> e os filhos dele, um process loopback INCLUDE por programa, misturados.
        /// O EXCLUDE (modo except) não segura o áudio de chamada do WebView2/Chromium (sai pelo dispositivo de
        /// comunicação e o Windows não o atribui à árvore do app): as vozes da chamada vazavam na live (ADR-0025, adendo).
        /// </summary>
        static int AppsExcept(uint root)
        {
            uint self = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
            bool running = true;
            Thread watch = new Thread(delegate ()
            {
                try { Console.OpenStandardInput().CopyTo(Stream.Null); } catch { }
                running = false;
            });
            watch.IsBackground = true;
            watch.Start();
            Dictionary<uint, AppSource> sources = new Dictionary<uint, AppSource>();
            Stream stdout = Console.OpenStandardOutput();
            System.Diagnostics.Stopwatch clock = System.Diagnostics.Stopwatch.StartNew();
            long produced = 0;
            long nextScan = 0;
            Console.Error.WriteLine("ready");
            Console.Error.Flush();
            try
            {
                while (running)
                {
                    if (clock.ElapsedMilliseconds >= nextScan)
                    {
                        nextScan = clock.ElapsedMilliseconds + 2000;
                        Dictionary<uint, uint> parents = Parents();
                        HashSet<uint> want = new HashSet<uint>();
                        foreach (uint pid in AudioPids())
                        {
                            if (pid == self || Under(pid, root, parents) || !parents.ContainsKey(pid)) continue;
                            want.Add(pid);
                        }
                        // processo e filho com sessão: a captura da árvore do pai já leva o filho
                        HashSet<uint> top = new HashSet<uint>();
                        foreach (uint pid in want)
                        {
                            bool covered = false;
                            foreach (uint other in want)
                                if (other != pid && Under(pid, other, parents)) { covered = true; break; }
                            if (!covered) top.Add(pid);
                        }
                        foreach (uint pid in new List<uint>(sources.Keys))
                            if (!top.Contains(pid) || !sources[pid].Thread.IsAlive)
                            {
                                sources[pid].Stop = true;
                                sources.Remove(pid);
                            }
                        foreach (uint pid in top)
                        {
                            if (sources.ContainsKey(pid) || sources.Count >= MAX_APPS) continue;
                            AppSource src = new AppSource();
                            src.Pid = pid;
                            src.Thread = new Thread(delegate () { RunSource(src); });
                            src.Thread.IsBackground = true;
                            src.Thread.Start();
                            sources[pid] = src;
                        }
                    }
                    Thread.Sleep(10);
                    // quantos quadros o relógio pede agora (a saída anda no tempo real, com ou sem som)
                    long due = clock.ElapsedMilliseconds * OUT_RATE / 1000 - produced;
                    if (due <= 0) continue;
                    if (due > OUT_RATE / 5) due = OUT_RATE / 5;
                    int samples = (int)due * 2;
                    float[] mix = new float[samples];
                    foreach (AppSource src in sources.Values)
                        lock (src.Lock)
                        {
                            int take = Math.Min(samples, src.Buf.Count & ~1);
                            for (int i = 0; i < take; i++) mix[i] += src.Buf.Dequeue();
                        }
                    for (int i = 0; i < samples; i++) mix[i] = Math.Max(-1f, Math.Min(1f, mix[i]));
                    byte[] bytes = new byte[samples * 4];
                    Buffer.BlockCopy(mix, 0, bytes, 0, bytes.Length);
                    stdout.Write(bytes, 0, bytes.Length);
                    stdout.Flush();
                    produced += due;
                }
            }
            catch (IOException)
            {
                // o processo principal fechou o pipe
            }
            finally
            {
                foreach (AppSource src in sources.Values) src.Stop = true;
            }
            return 0;
        }

        static int Except(uint pid, int mode)
        {
            // AUDIOCLIENT_ACTIVATION_PARAMS { ActivationType, TargetProcessId, ProcessLoopbackMode } num PROPVARIANT VT_BLOB
            IntPtr p = Marshal.AllocHGlobal(12);
            IntPtr pv = Marshal.AllocHGlobal(8 + 2 * IntPtr.Size);
            IntPtr fmt = Marshal.AllocHGlobal(18);
            try
            {
                Marshal.WriteInt32(p, 0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK);
                Marshal.WriteInt32(p, 4, unchecked((int)pid));
                Marshal.WriteInt32(p, 8, mode);
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

        public float[] ConvertFloats(IntPtr data, int frames, bool silent)
        {
            byte[] b = Convert(data, frames, silent);
            float[] f = new float[b.Length / 4];
            Buffer.BlockCopy(b, 0, f, 0, b.Length);
            return f;
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
