using System.Diagnostics;
using System.Runtime.InteropServices;

namespace JacaAudio;

// Captures system audio EXCLUDING one process tree (e.g. Discord) through the WASAPI
// process-loopback API (Windows 10 build 19041+). Writes raw PCM s16le, 48 kHz, stereo to stdout.
// Status lines go to stderr: "READY" once capturing, "ERR <message>" on failure.
internal static class Program
{
    private const int Rate = 48000, Channels = 2, Bits = 16;

    private static int Main(string[] args)
    {
        string? name = null;
        int pid = 0;
        long hwnd = 0;
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--exclude-name") name = args[i + 1];
            if (args[i] == "--exclude-pid") int.TryParse(args[i + 1], out pid);
            if (args[i] == "--include-hwnd") long.TryParse(args[i + 1], out hwnd);
        }
        try
        {
            // include mode: capture ONLY the process tree that owns the shared window, which also
            // leaves out Discord and this app (so received audio never loops back).
            if (hwnd != 0)
            {
                GetWindowThreadProcessId((IntPtr)hwnd, out uint owner);
                if (owner == 0) return Fail("window not found");
                Capture(TopmostSameName((int)owner), include: true);
                return 0;
            }
            if (pid == 0 && !string.IsNullOrWhiteSpace(name)) pid = FindRootPid(name!);
            if (pid == 0) return Fail(name == null ? "no target given" : "process '" + name + "' not found");
            Capture(pid, include: false);
            return 0;
        }
        catch (Exception e)
        {
            return Fail(e.Message);
        }
    }

    private static int Fail(string msg)
    {
        Console.Error.WriteLine("ERR " + msg.Replace('\n', ' '));
        return 1;
    }

    // Finds the root of the process tree for the given executable name (without .exe).
    private static int FindRootPid(string name)
    {
        var same = Process.GetProcessesByName(name).Select(p => p.Id).ToHashSet();
        if (same.Count == 0) return 0;
        var parents = ParentMap();
        var roots = same.Where(id => !parents.TryGetValue(id, out var pp) || !same.Contains(pp)).ToList();
        if (roots.Count > 1) Console.Error.WriteLine("WARN multiple roots: " + string.Join(",", roots));
        return roots.FirstOrDefault();
    }

    // Climbs to the topmost ancestor that runs the same executable (multi-process apps own the window
    // from a child process, while the audio may come from sibling/child processes of the root).
    private static int TopmostSameName(int pid)
    {
        string name;
        try { name = Process.GetProcessById(pid).ProcessName; } catch { return pid; }
        var parents = ParentMap();
        int cur = pid;
        while (parents.TryGetValue(cur, out int pp) && pp != 0)
        {
            try { if (Process.GetProcessById(pp).ProcessName != name) break; } catch { break; }
            cur = pp;
        }
        return cur;
    }

    private static Dictionary<int, int> ParentMap()
    {
        var map = new Dictionary<int, int>();
        IntPtr snap = CreateToolhelp32Snapshot(0x2, 0);
        if (snap == (IntPtr)(-1)) return map;
        var entry = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32>() };
        if (Process32First(snap, ref entry))
        {
            do map[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
            while (Process32Next(snap, ref entry));
        }
        CloseHandle(snap);
        return map;
    }

    private static void Capture(int targetPid, bool include)
    {
        IAudioClient client = Activate(targetPid, include);

        IntPtr fmt = Marshal.AllocHGlobal(18);
        Marshal.WriteInt16(fmt, 0, 1); // WAVE_FORMAT_PCM
        Marshal.WriteInt16(fmt, 2, Channels);
        Marshal.WriteInt32(fmt, 4, Rate);
        Marshal.WriteInt32(fmt, 8, Rate * Channels * Bits / 8);
        Marshal.WriteInt16(fmt, 12, (short)(Channels * Bits / 8));
        Marshal.WriteInt16(fmt, 14, Bits);
        Marshal.WriteInt16(fmt, 16, 0);

        const int LOOPBACK = 0x00020000, EVENTCB = 0x00040000;
        client.Initialize(0, LOOPBACK | EVENTCB, 200000, 0, fmt, IntPtr.Zero);
        IntPtr evt = CreateEvent(IntPtr.Zero, false, false, null);
        client.SetEventHandle(evt);
        Guid capIid = new("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
        client.GetService(ref capIid, out object svc);
        var cap = (IAudioCaptureClient)svc;
        client.Start();
        Console.Error.WriteLine("READY");

        using var stdout = Console.OpenStandardOutput();
        var buf = new byte[65536];
        while (true)
        {
            WaitForSingleObject(evt, 100);
            cap.GetNextPacketSize(out uint packet);
            while (packet != 0)
            {
                cap.GetBuffer(out IntPtr data, out uint frames, out uint flags, out _, out _);
                int bytes = (int)frames * Channels * Bits / 8;
                if (bytes > buf.Length) buf = new byte[bytes];
                if ((flags & 2) != 0) Array.Clear(buf, 0, bytes); // AUDCLNT_BUFFERFLAGS_SILENT
                else Marshal.Copy(data, buf, 0, bytes);
                cap.ReleaseBuffer(frames);
                try
                {
                    stdout.Write(buf, 0, bytes);
                    stdout.Flush();
                }
                catch (IOException)
                {
                    return; // parent closed the pipe
                }
                cap.GetNextPacketSize(out packet);
            }
        }
    }

    private static IAudioClient Activate(int targetPid, bool include)
    {
        // AUDIOCLIENT_ACTIVATION_PARAMS { type=1 (PROCESS_LOOPBACK), pid, mode=0 include / 1 exclude target tree }
        IntPtr p = Marshal.AllocHGlobal(12);
        Marshal.WriteInt32(p, 0, 1);
        Marshal.WriteInt32(p, 4, targetPid);
        Marshal.WriteInt32(p, 8, include ? 0 : 1);

        // PROPVARIANT VT_BLOB
        IntPtr pv = Marshal.AllocHGlobal(24);
        for (int i = 0; i < 24; i += 8) Marshal.WriteInt64(pv, i, 0);
        Marshal.WriteInt16(pv, 0, 0x41);
        Marshal.WriteInt32(pv, 8, 12);
        Marshal.WriteIntPtr(pv, 16, p);

        var handler = new Handler();
        Guid iid = new("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
        ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, pv, handler, out var op);
        if (!handler.Done.WaitOne(5000)) throw new TimeoutException("audio activation timed out");
        op.GetActivateResult(out int hr, out object iface);
        if (hr != 0) throw new COMException("audio activation failed", hr);
        return (IAudioClient)iface;
    }

    [ClassInterface(ClassInterfaceType.None)]
    private sealed class Handler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEvent Done = new(false);
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op) => Done.Set();
    }

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    private static extern void ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid riid, IntPtr activationParams,
        IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation op);

    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("kernel32.dll")] private static extern IntPtr CreateEvent(IntPtr a, bool manual, bool initial, string? name);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll")] private static extern bool Process32First(IntPtr snap, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll")] private static extern bool Process32Next(IntPtr snap, ref PROCESSENTRY32 e);

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESSENTRY32
    {
        public uint dwSize, cntUsage, th32ProcessID;
        public UIntPtr th32DefaultHeapID;
        public uint th32ModuleID, cntThreads, th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int hr, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAgileObject { }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        void Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        void GetBufferSize(out uint frames);
        void GetStreamLatency(out long latency);
        void GetCurrentPadding(out uint padding);
        void IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        void GetMixFormat(out IntPtr format);
        void GetDevicePeriod(out long def, out long min);
        void Start();
        void Stop();
        void Reset();
        void SetEventHandle(IntPtr evt);
        void GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        void GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePos, out ulong qpcPos);
        void ReleaseBuffer(uint frames);
        void GetNextPacketSize(out uint frames);
    }
}
