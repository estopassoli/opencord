// oc-input.exe: mouse e teclado do controle remoto (ADR-0026). Lê comandos de texto do stdin, um por linha, e os
// injeta com SendInput. Só o processo principal do OpenCord o abre, e só durante uma sessão aceita pelo dono do PC.
//
//   m X Y            move o cursor para o pixel físico (X, Y) da área de trabalho virtual
//   b BOTAO D        botão do mouse (0 esquerdo, 1 meio, 2 direito, 3 voltar, 4 avançar); D = 1 aperta, 0 solta
//   w DX DY          rodinha (unidades de WHEEL_DELTA, 120 = um "clique")
//   k SCAN EXT D     tecla pelo scancode físico (independe do layout); EXT = 1 para teclas estendidas
//   r                solta tudo que estiver apertado
//
// Fechar o stdin solta tudo e encerra: nunca fica tecla ou botão preso no PC de quem foi controlado.
// Limite do Windows (UIPI): sem elevação, janelas de administrador e a tela do UAC ignoram a entrada injetada.
//
// Compilar (vem com o Windows): csc /nologo /optimize+ /platform:x64 /out:oc-input.exe OcInput.cs

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

static class OcInput
{
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public INPUTUNION u; }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint MOVE = 0x1, WHEEL = 0x800, HWHEEL = 0x1000, VIRTUALDESK = 0x4000, ABSOLUTE = 0x8000;
    const uint KEY_EXTENDED = 0x1, KEY_UP = 0x2, KEY_SCANCODE = 0x8;
    static readonly uint[] DOWN = { 0x2, 0x20, 0x8, 0x80, 0x80 };
    static readonly uint[] UP = { 0x4, 0x40, 0x10, 0x100, 0x100 };

    static readonly HashSet<int> keys = new HashSet<int>();
    static readonly HashSet<int> buttons = new HashSet<int>();

    static void Send(INPUT i)
    {
        SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Mouse(uint flags, int dx = 0, int dy = 0, uint data = 0)
    {
        var i = new INPUT { type = INPUT_MOUSE };
        i.u.mi = new MOUSEINPUT { dx = dx, dy = dy, mouseData = data, dwFlags = flags };
        Send(i);
    }

    static void Move(int x, int y)
    {
        // coordenadas absolutas vão de 0 a 65535 sobre a área de trabalho virtual (todos os monitores)
        int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77);
        int vw = Math.Max(2, GetSystemMetrics(78)), vh = Math.Max(2, GetSystemMetrics(79));
        int nx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1));
        int ny = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
        Mouse(MOVE | ABSOLUTE | VIRTUALDESK, Math.Max(0, Math.Min(65535, nx)), Math.Max(0, Math.Min(65535, ny)));
    }

    static void Button(int b, bool down)
    {
        if (b < 0 || b > 4) return;
        if (down) buttons.Add(b); else if (!buttons.Remove(b)) return;
        Mouse(down ? DOWN[b] : UP[b], 0, 0, b == 3 ? 1u : b == 4 ? 2u : 0u);
    }

    static void Key(int scan, bool ext, bool down)
    {
        if (scan <= 0 || scan > 0xff) return;
        int id = scan | (ext ? 0x100 : 0);
        if (down) keys.Add(id); else if (!keys.Remove(id)) return;
        var i = new INPUT { type = INPUT_KEYBOARD };
        i.u.ki = new KEYBDINPUT
        {
            wScan = (ushort)scan,
            dwFlags = KEY_SCANCODE | (ext ? KEY_EXTENDED : 0) | (down ? 0 : KEY_UP),
        };
        Send(i);
    }

    static void ReleaseAll()
    {
        foreach (var id in new List<int>(keys)) Key(id & 0xff, (id & 0x100) != 0, false);
        foreach (var b in new List<int>(buttons)) Button(b, false);
    }

    static int Int(string[] p, int i) { return int.Parse(p[i], System.Globalization.CultureInfo.InvariantCulture); }

    static int Main()
    {
        // pixels físicos (o processo principal converte para eles): sem isto o Windows escala as coordenadas
        try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }
        catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
        Console.Error.WriteLine("ready");
        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            var p = line.Split(' ');
            try
            {
                switch (p[0])
                {
                    case "m": Move(Int(p, 1), Int(p, 2)); break;
                    case "b": Button(Int(p, 1), p[2] == "1"); break;
                    case "w":
                        int dx = Math.Max(-1200, Math.Min(1200, Int(p, 1)));
                        int dy = Math.Max(-1200, Math.Min(1200, Int(p, 2)));
                        if (dy != 0) Mouse(WHEEL, 0, 0, unchecked((uint)dy));
                        if (dx != 0) Mouse(HWHEEL, 0, 0, unchecked((uint)dx));
                        break;
                    case "k": Key(Int(p, 1), p[2] == "1", p[3] == "1"); break;
                    case "r": ReleaseAll(); break;
                }
            }
            catch (Exception) { /* linha malformada: ignora */ }
        }
        ReleaseAll();
        return 0;
    }
}
