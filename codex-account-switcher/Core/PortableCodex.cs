namespace CodexAccountSwitcher.Core;

public static class PortableCodex
{
    public static string? ReadExecutablePath(string? dataDirectory = null)
    {
        dataDirectory ??= Environment.GetEnvironmentVariable("CODEX_SWITCHER_DATA_DIR")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CodexAccountSwitcher");
        var config = Path.Combine(dataDirectory, "codex-executable.txt");
        return File.Exists(config) ? ValidateExecutablePath(File.ReadAllText(config).Trim()) : null;
    }

    public static string ValidateExecutablePath(string path)
    {
        if (!Path.IsPathFullyQualified(path)
            || !(Path.GetFileName(path).Equals("Codex.exe", StringComparison.OrdinalIgnoreCase)
                || Path.GetFileName(path).Equals("ChatGPT.exe", StringComparison.OrdinalIgnoreCase))
            || !File.Exists(path)
            || !File.Exists(Path.Combine(Path.GetDirectoryName(path)!, "resources", "app.asar"))
            || !File.Exists(Path.Combine(Path.GetDirectoryName(path)!, "resources", "codex.exe")))
        {
            throw new InvalidDataException("Configured portable Codex must point to the desktop Codex.exe or ChatGPT.exe with resources/app.asar and resources/codex.exe.");
        }

        return Path.GetFullPath(path);
    }

    public static bool MatchesExecutable(string? path, string? desktopPath)
    {
        if (path is null || desktopPath is null) return false;
        var root = Path.GetDirectoryName(desktopPath)! + Path.DirectorySeparatorChar;
        return path.StartsWith(root, StringComparison.OrdinalIgnoreCase);
    }
}
