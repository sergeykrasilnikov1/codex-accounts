namespace CodexAccountSwitcher.Core;

public static class PlatformServices
{
    public static ISecretProtector CreateSecretProtector() => OperatingSystem.IsWindows()
        ? new WindowsDpapiSecretProtector()
        : OperatingSystem.IsLinux() ? new LinuxSecretProtector()
        : throw new PlatformNotSupportedException("Supported platforms: Windows and Ubuntu Linux.");

    public static ICodexProcessService CreateProcessService() => OperatingSystem.IsWindows()
        ? new WindowsCodexProcessService()
        : OperatingSystem.IsLinux() ? new LinuxCodexProcessService()
        : throw new PlatformNotSupportedException("Supported platforms: Windows and Ubuntu Linux.");
}
