using System.Text;
using System.Text.Json;
using CodexAccountSwitcher.Core;

public sealed class CodexAppServerUsageTests
{
    [Fact]
    public void UsesCodexBucketAndWindowDurationsInsteadOfPrimaryPosition()
    {
        using var json = JsonDocument.Parse("""
        {"rateLimits":{"primary":{"usedPercent":99,"windowDurationMins":300}},
         "rateLimitsByLimitId":{"codex":{
         "primary":{"usedPercent":85,"windowDurationMins":10080,"resetsAt":1794795258},
         "secondary":{"usedPercent":26,"windowDurationMins":300,"resetsAt":1794402262}}}}
        """);
        var result = CodexAppServerUsage.Parse(json.RootElement);
        Assert.True(result.Success);
        Assert.Equal(74, result.FiveHour!.PercentLeft);
        Assert.Equal(15, result.Weekly!.PercentLeft);
        Assert.Equal(1794402262, result.FiveHour.ResetAt!.Value.ToUnixTimeSeconds());
    }

    [Fact]
    public void AcceptsWeeklyOnlyAndRejectsMissingLimits()
    {
        using var weekly = JsonDocument.Parse("""{"rateLimits":{"primary":{"usedPercent":12,"windowDurationMins":10080},"secondary":null}}""");
        var result = CodexAppServerUsage.Parse(weekly.RootElement);
        Assert.True(result.Success);
        Assert.Null(result.FiveHour);
        Assert.Equal(88, result.Weekly!.PercentLeft);
        using var missing = JsonDocument.Parse("{}");
        Assert.False(CodexAppServerUsage.Parse(missing.RootElement).Success);
    }

    [Fact]
    public async Task HandshakeUsesPrivateDisposableHomeAndTerminatesChild()
    {
        if (!OperatingSystem.IsLinux()) return;
        var directory = Path.Combine(Path.GetTempPath(), "usage-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var script = Path.Combine(directory, "codex");
            var audit = Path.Combine(directory, "home");
            await File.WriteAllTextAsync(script, """
                #!/bin/sh
                printf '%s' "$CODEX_HOME" > 'AUDIT'
                test "$(stat -c %a "$CODEX_HOME")" = 700 || exit 1
                test ! -e "$CODEX_HOME/auth.json" || exit 1
                test "$(stat -c %a "$CODEX_HOME/config.toml")" = 600 || exit 1
                read -r init
                printf '%s\n' '{"id":1,"result":{}}'
                read -r initialized
                read -r login
                printf '%s\n' '{"id":3,"result":{"type":"chatgptAuthTokens"}}'
                read -r limits
                printf '%s\n' '{"id":2,"result":{"rateLimits":{"primary":{"usedPercent":25,"windowDurationMins":300}}}}'
                sleep 60
                """.Replace("AUDIT", audit));
            File.SetUnixFileMode(script, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            var result = await CodexAppServerUsage.FetchAsync(script, Encoding.UTF8.GetBytes("{\"tokens\":{\"access_token\":\"test\",\"account_id\":\"test-account\"}}"), CancellationToken.None);
            Assert.True(result.Success);
            Assert.Equal(75, result.FiveHour!.PercentLeft);
            var temporaryHome = await File.ReadAllTextAsync(audit);
            Assert.False(Directory.Exists(temporaryHome));
        }
        finally { Directory.Delete(directory, true); }
    }
}
