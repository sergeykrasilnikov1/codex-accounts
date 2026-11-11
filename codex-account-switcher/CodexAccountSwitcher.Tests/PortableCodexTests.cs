using CodexAccountSwitcher.Core;

namespace CodexAccountSwitcher.Tests;

public sealed class PortableCodexTests
{
    [Fact]
    public void FindsPortableDesktopAndDescendantsWithoutIncludingOtherCli()
    {
        const string desktop = @"C:\Portable\Codex\Codex.exe";
        var processes = new[]
        {
            new ProcessInventoryEntry(100, 1, "Codex", desktop),
            new ProcessInventoryEntry(101, 100, "codex", @"C:\Portable\Codex\resources\codex.exe"),
            new ProcessInventoryEntry(102, 101, "node", null),
            new ProcessInventoryEntry(200, 1, "codex", @"C:\Tools\codex.exe"),
            new ProcessInventoryEntry(201, 1, "codex", @"C:\Portable\Codex-other\codex.exe")
        };
        Assert.Equal([100, 101, 102], CodexProcessLocator.FindCodexProcesses(processes, desktop).Select(p => p.ProcessId));
    }

    [Fact]
    public void MatchesOnlyFilesInsideConfiguredDesktopDirectory()
    {
        const string desktop = @"C:\Portable\Codex\Codex.exe";
        Assert.True(PortableCodex.MatchesExecutable(desktop, desktop));
        Assert.True(PortableCodex.MatchesExecutable(@"C:\Portable\Codex\resources\codex.exe", desktop));
        Assert.False(PortableCodex.MatchesExecutable(@"C:\Portable\Codex-other\codex.exe", desktop));
        Assert.False(PortableCodex.MatchesExecutable(@"C:\Tools\codex.exe", desktop));
        Assert.False(PortableCodex.MatchesExecutable(null, desktop));
        Assert.False(PortableCodex.MatchesExecutable(desktop, null));
    }

    [Fact]
    public void RejectsCliAndIncompleteDesktopAndAcceptsDesktopLayout()
    {
        var directory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(Path.Combine(directory, "resources"));
        try
        {
            var desktop = Path.Combine(directory, "Codex.exe");
            Assert.Null(PortableCodex.ReadExecutablePath(directory));
            File.WriteAllText(desktop, "");
            Assert.Throws<InvalidDataException>(() => PortableCodex.ValidateExecutablePath(desktop));
            File.WriteAllText(Path.Combine(directory, "resources", "app.asar"), "");
            File.WriteAllText(Path.Combine(directory, "resources", "codex.exe"), "");
            Assert.Equal(desktop, PortableCodex.ValidateExecutablePath(desktop));
            File.WriteAllText(Path.Combine(directory, "codex-executable.txt"), desktop + Environment.NewLine);
            Assert.Equal(desktop, PortableCodex.ReadExecutablePath(directory));
            var legacyDesktop = Path.Combine(directory, "ChatGPT.exe");
            File.WriteAllText(legacyDesktop, "");
            Assert.Equal(legacyDesktop, PortableCodex.ValidateExecutablePath(legacyDesktop));
            Assert.Throws<InvalidDataException>(() => PortableCodex.ValidateExecutablePath(Path.Combine(directory, "resources", "codex.exe")));
            Assert.Throws<InvalidDataException>(() => PortableCodex.ValidateExecutablePath("Codex.exe"));
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }
}
