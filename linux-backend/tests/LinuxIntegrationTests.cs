using System.Diagnostics;
using CodexAccountSwitcher.Core;

namespace CodexAccounts.Linux.Tests;

[CollectionDefinition("Linux environment", DisableParallelization = true)]
public sealed class LinuxEnvironmentCollection { }

[Collection("Linux environment")]
public sealed class LinuxIntegrationTests
{
    [Fact]
    public void SecretServicePersistsKeyAcrossProtectorInstances()
    {
        if (!OperatingSystem.IsLinux() || Environment.GetEnvironmentVariable("CODEX_ACCOUNTS_KEYRING_TEST") != "1") return;
        var first = new LinuxSecretProtector();
        var encrypted = first.Protect("synthetic-secret"u8);
        Assert.Equal("synthetic-secret"u8.ToArray(), new LinuxSecretProtector().Unprotect(encrypted));
    }

    [Fact]
    public void AtomicFilesArePrivateAndCaseSensitiveContainmentRejectsSibling()
    {
        if (!OperatingSystem.IsLinux()) return;
        var root = Path.Combine(Path.GetTempPath(), "codex-accounts-test-" + Guid.NewGuid());
        try
        {
            var fs = new RealFileSystem();
            fs.CreateDirectory(root);
            var auth = Path.Combine(root, "auth.json");
            fs.WriteAllTextAtomic(auth, "synthetic");
            fs.WriteAllTextAtomic(auth, "replaced");
            Assert.Equal("replaced", File.ReadAllText(auth));
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(auth));
            Assert.Throws<InvalidOperationException>(() => PathSafety.EnsurePathInside(root.ToUpperInvariant() + "/auth.json", root));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task StopsOnlyTheConfiguredDesktopInstallation()
    {
        if (!OperatingSystem.IsLinux()) return;
        var root = Path.Combine(Path.GetTempPath(), "codex-accounts-process-" + Guid.NewGuid());
        var oldDirectory = Environment.GetEnvironmentVariable("CODEX_SWITCHER_DATA_DIR");
        Process? desktop = null;
        Process? unrelated = null;
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "resources"));
            var path = Path.Combine(root, "desktop");
            File.Copy("/bin/sleep", path);
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            File.WriteAllText(Path.Combine(root, "resources", "app.asar"), "fixture");
            Assert.Equal(path, LinuxCodexProcessService.ValidateExecutablePath(path));
            Assert.Throws<InvalidDataException>(() => LinuxCodexProcessService.ValidateExecutablePath("/bin/sleep"));
            File.WriteAllText(Path.Combine(root, "codex-executable.txt"), path);
            Environment.SetEnvironmentVariable("CODEX_SWITCHER_DATA_DIR", root);
            desktop = Process.Start(path, "60")!;
            unrelated = Process.Start("/bin/sleep", "60")!;
            var processes = LinuxCodexProcessService.FindProcesses(path);
            Assert.Contains(processes, entry => entry.ProcessId == desktop.Id);
            Assert.DoesNotContain(processes, entry => entry.ProcessId == unrelated.Id);
            await new LinuxCodexProcessService().StopCodexAsync(TimeSpan.FromSeconds(5), CancellationToken.None);
            Assert.True(desktop.WaitForExit(2000));
            Assert.False(unrelated.HasExited);
        }
        finally
        {
            Environment.SetEnvironmentVariable("CODEX_SWITCHER_DATA_DIR", oldDirectory);
            foreach (var process in new[] { desktop, unrelated })
            {
                if (process is null) continue;
                if (!process.HasExited) { process.Kill(true); process.WaitForExit(); }
                process.Dispose();
            }
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }
}
