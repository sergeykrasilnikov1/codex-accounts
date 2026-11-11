using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;

namespace CodexAccountSwitcher.Core;

public sealed class LinuxCodexProcessService : ICodexProcessService
{
    public static string ValidateExecutablePath(string path)
    {
        if (!Path.IsPathFullyQualified(path) || !File.Exists(path))
            throw new InvalidDataException("Configure the absolute path to the installed Codex desktop executable.");
        path = File.ResolveLinkTarget(path, returnFinalTarget: true)?.FullName ?? Path.GetFullPath(path);
        if (!File.Exists(Path.Combine(Path.GetDirectoryName(path)!, "resources", "app.asar")))
            throw new InvalidDataException("The configured program is not a desktop installation: resources/app.asar is missing. Do not use the Codex CLI.");
        if (OperatingSystem.IsLinux() && (File.GetUnixFileMode(path) &
            (UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute)) == 0)
            throw new InvalidDataException("The configured desktop file is not executable.");
        return path;
    }

    private static string? ConfiguredPath()
    {
        var directory = Environment.GetEnvironmentVariable("CODEX_SWITCHER_DATA_DIR")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CodexAccountSwitcher");
        var config = Path.Combine(directory, "codex-executable.txt");
        return File.Exists(config) ? ValidateExecutablePath(File.ReadAllText(config).Trim()) : null;
    }

    private static string RequiredPath() => ConfiguredPath()
        ?? throw new InvalidOperationException("Set the absolute desktop executable path in ~/.config/CodexAccountSwitcher/codex-executable.txt before switching accounts.");

    private static string? ExecutablePath(int pid) => File.ResolveLinkTarget($"/proc/{pid}/exe", true)?.FullName;

    public static IReadOnlyList<ProcessInventoryEntry> FindProcesses(string desktopPath)
    {
        var entries = new List<ProcessInventoryEntry>();
        foreach (var directory in Directory.EnumerateDirectories("/proc"))
        {
            if (!int.TryParse(Path.GetFileName(directory), out var pid)) continue;
            try
            {
                var stat = File.ReadAllText(Path.Combine(directory, "stat"));
                var fields = stat[(stat.LastIndexOf(')') + 2)..].Split(' ', StringSplitOptions.RemoveEmptyEntries);
                entries.Add(new ProcessInventoryEntry(pid, int.Parse(fields[1], CultureInfo.InvariantCulture),
                    File.ReadAllText(Path.Combine(directory, "comm")).Trim(), ExecutablePath(pid)));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or FormatException) { }
        }
        var root = Path.GetDirectoryName(desktopPath)! + Path.DirectorySeparatorChar;
        var ids = entries.Where(p => p.ExecutablePath?.StartsWith(root, StringComparison.Ordinal) == true)
            .Select(p => p.ProcessId).ToHashSet();
        bool changed;
        do
        {
            changed = false;
            foreach (var entry in entries)
                if (ids.Contains(entry.ParentProcessId) && ids.Add(entry.ProcessId)) changed = true;
        } while (changed);
        return entries.Where(p => ids.Contains(p.ProcessId)).ToArray();
    }

    public IReadOnlyList<CodexProcessInfo> FindRunningCodexProcesses()
    {
        var path = ConfiguredPath();
        return path is null ? [] : FindProcesses(path)
            .Select(p => new CodexProcessInfo(p.ProcessName, p.ProcessId, p.ExecutablePath)).ToArray();
    }

    public async Task StopCodexAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        var path = RequiredPath();
        var deadline = DateTime.UtcNow + timeout;
        var forceAfter = DateTime.UtcNow + TimeSpan.FromSeconds(2);
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var processes = FindProcesses(path);
            if (processes.Count == 0) return;
            if (DateTime.UtcNow >= deadline) throw new TimeoutException("Codex desktop did not exit. The sign-in has not been changed.");
            var ids = processes.Select(p => p.ProcessId).ToHashSet();
            foreach (var root in processes.Where(p => !ids.Contains(p.ParentProcessId)))
            {
                try
                {
                    if (root.ExecutablePath is null || ExecutablePath(root.ProcessId) != root.ExecutablePath) continue;
                    using var process = Process.GetProcessById(root.ProcessId);
                    if (DateTime.UtcNow >= forceAfter) process.Kill(entireProcessTree: true);
                    else _ = Kill(root.ProcessId, 15);
                }
                catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or IOException) { }
            }
            await Task.Delay(200, cancellationToken);
        }
    }

    public Task LaunchCodexAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var path = RequiredPath();
        var process = Process.Start(new ProcessStartInfo(path) { WorkingDirectory = Path.GetDirectoryName(path),
            UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true })
            ?? throw new InvalidOperationException("Could not start the Codex desktop.");
        process.StandardInput.Close();
        // Desktop logs must never enter the JSON bridge's stdout.
        _ = Task.WhenAll(process.StandardOutput.BaseStream.CopyToAsync(Stream.Null),
            process.StandardError.BaseStream.CopyToAsync(Stream.Null)).ContinueWith(task => { _ = task.Exception; process.Dispose(); });
        return Task.CompletedTask;
    }

    [DllImport("libc", EntryPoint = "kill", SetLastError = true)]
    private static extern int Kill(int pid, int signal);
}
