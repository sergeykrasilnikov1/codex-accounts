using System.Diagnostics;
using System.Text.Json;
using System.Runtime.Versioning;

namespace CodexAccountSwitcher.Core;

/// <summary>Read limits through the installed Codex client without changing the active sign-in.</summary>
public static class CodexAppServerUsage
{
    public static string? FindLinuxClient()
    {
        if (!OperatingSystem.IsLinux()) return null;
        var directory = Environment.GetEnvironmentVariable("CODEX_SWITCHER_DATA_DIR")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CodexAccountSwitcher");
        var config = Path.Combine(directory, "codex-executable.txt");
        if (!File.Exists(config)) return null;
        var desktop = LinuxCodexProcessService.ValidateExecutablePath(File.ReadAllText(config).Trim());
        var cli = Path.Combine(Path.GetDirectoryName(desktop)!, "resources", "codex");
        return File.Exists(cli) ? cli : null;
    }

    [SupportedOSPlatform("linux")]
    public static async Task<CodexUsageResult> FetchAsync(string executable, ReadOnlyMemory<byte> auth, CancellationToken cancellationToken)
    {
        // Each profile gets its own private home. External-token mode receives only
        // an access token over stdin, so a read cannot rotate saved refresh tokens.
        // No credentials are written to disk or passed as command arguments.
        var home = Path.Combine(Path.GetTempPath(), "codex-accounts-usage-" + Guid.NewGuid().ToString("N"));
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(25));
        var token = timeout.Token;
        Process? process = null;
        try
        {
            Directory.CreateDirectory(home, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            using var authJson = JsonDocument.Parse(auth);
            var rootAuth = authJson.RootElement;
            var tokens = rootAuth.TryGetProperty("tokens", out var nested) ? nested : rootAuth;
            var login = JsonSerializer.Serialize(new
            {
                id = 3, method = "account/login/start",
                @params = new { type = "chatgptAuthTokens",
                    accessToken = tokens.GetProperty("access_token").GetString(),
                    chatgptAccountId = tokens.GetProperty("account_id").GetString() }
            });
            await WritePrivateAsync(Path.Combine(home, "config.toml"), System.Text.Encoding.UTF8.GetBytes("cli_auth_credentials_store = \"file\"\n"), token);
            var info = new ProcessStartInfo(executable)
            {
                UseShellExecute = false, RedirectStandardInput = true,
                RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true,
                WorkingDirectory = home
            };
            info.ArgumentList.Add("app-server");
            info.Environment["CODEX_HOME"] = home;
            process = Process.Start(info) ?? throw new IOException("Codex client did not start.");
            // Drain diagnostics without retaining potentially sensitive server messages.
            process.ErrorDataReceived += (_, _) => { };
            process.BeginErrorReadLine();
            await process.StandardInput.WriteLineAsync("{\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"codex_accounts\",\"version\":\"2.1.1\"},\"capabilities\":{\"experimentalApi\":true}}}");
            while (await process.StandardOutput.ReadLineAsync(token) is { } line)
            {
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                if (root.TryGetProperty("method", out var method)
                    && method.GetString() == "account/chatgptAuthTokens/refresh")
                    return CodexUsageResult.Failed("Срок сохранённого входа истёк. Откройте этот аккаунт в Codex и сохраните обновлённый вход.");
                if (!root.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.Number || !id.TryGetInt32(out var number)) continue;
                if (root.TryGetProperty("error", out _))
                    return CodexUsageResult.Failed("Codex не смог получить лимиты этого профиля. Проверьте подключение и актуальность сохранённого входа.");
                if (number == 1)
                {
                    await process.StandardInput.WriteLineAsync("{\"method\":\"initialized\"}");
                    await process.StandardInput.WriteLineAsync(login);
                }
                else if (number == 3)
                    await process.StandardInput.WriteLineAsync("{\"id\":2,\"method\":\"account/rateLimits/read\"}");
                else if (number == 2 && root.TryGetProperty("result", out var result)) return Parse(result);
            }
            return CodexUsageResult.Failed("Codex завершил проверку без ответа о лимитах.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return CodexUsageResult.Failed("Время ожидания лимитов Codex истекло. Проверьте подключение и повторите обновление.");
        }
        catch (Exception ex) when (ex is IOException or System.ComponentModel.Win32Exception or JsonException or KeyNotFoundException or InvalidOperationException)
        {
            return CodexUsageResult.Failed("Не удалось прочитать лимиты через установленный Codex.");
        }
        finally
        {
            if (process is not null)
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync(CancellationToken.None);
                process.Dispose();
            }
            if (Directory.Exists(home)) Directory.Delete(home, recursive: true);
        }
    }

    [SupportedOSPlatform("linux")]
    private static async Task WritePrivateAsync(string path, ReadOnlyMemory<byte> bytes, CancellationToken token)
    {
        await using var stream = new FileStream(path, new FileStreamOptions
        {
            Mode = FileMode.CreateNew, Access = FileAccess.Write,
            UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
        });
        await stream.WriteAsync(bytes, token);
    }

    public static CodexUsageResult Parse(JsonElement result)
    {
        JsonElement limits;
        if (result.TryGetProperty("rateLimitsByLimitId", out var buckets) && buckets.ValueKind == JsonValueKind.Object
            && buckets.TryGetProperty("codex", out var codex) && codex.ValueKind == JsonValueKind.Object) limits = codex;
        else if (!result.TryGetProperty("rateLimits", out limits) || limits.ValueKind != JsonValueKind.Object)
            return CodexUsageResult.Failed("Codex не вернул лимиты для этого профиля.");
        CodexUsageWindow? fiveHour = null, weekly = null;
        foreach (var key in new[] { "primary", "secondary" })
        {
            if (!limits.TryGetProperty(key, out var window) || window.ValueKind != JsonValueKind.Object) continue;
            if (!window.TryGetProperty("windowDurationMins", out var duration) || !duration.TryGetDouble(out var minutes)) continue;
            double? left = window.TryGetProperty("usedPercent", out var used) && used.TryGetDouble(out var value)
                ? Math.Clamp(100 - value, 0, 100) : null;
            DateTimeOffset? reset = window.TryGetProperty("resetsAt", out var resets) && resets.TryGetInt64(out var timestamp)
                ? DateTimeOffset.FromUnixTimeSeconds(timestamp) : null;
            var parsed = new CodexUsageWindow(left, reset);
            if (minutes == 300) fiveHour = parsed;
            else if (minutes == 10080) weekly = parsed;
        }
        return fiveHour is null && weekly is null
            ? CodexUsageResult.Failed("Codex не вернул пятичасовой или недельный лимит.")
            : CodexUsageResult.Succeeded(fiveHour, weekly, DateTimeOffset.Now);
    }
}
