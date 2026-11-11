using System.Diagnostics;
using System.Security.Cryptography;

namespace CodexAccountSwitcher.Core;

public sealed class LinuxSecretProtector : ISecretProtector
{
    private static readonly byte[] Header = "CAUL1"u8.ToArray();
    private readonly Func<bool, byte[]> _readKey;

    public LinuxSecretProtector(Func<byte[]>? readKey = null) => _readKey = readKey is null ? ReadKey : _ => readKey();

    public byte[] Protect(ReadOnlySpan<byte> plaintext)
    {
        var key = _readKey(true);
        try
        {
            var result = new byte[33 + plaintext.Length];
            Header.CopyTo(result, 0);
            RandomNumberGenerator.Fill(result.AsSpan(5, 12));
            using var aes = new AesGcm(key, 16);
            aes.Encrypt(result.AsSpan(5, 12), plaintext, result.AsSpan(33), result.AsSpan(17, 16), Header);
            return result;
        }
        finally { CryptographicOperations.ZeroMemory(key); }
    }

    public byte[] Unprotect(ReadOnlySpan<byte> protectedData)
    {
        if (protectedData.Length < 33 || !protectedData[..5].SequenceEqual(Header))
            throw new CryptographicException("Not an Ubuntu credential. Windows DPAPI profiles cannot be transferred to Linux.");
        var key = _readKey(false);
        try
        {
            var plaintext = new byte[protectedData.Length - 33];
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(protectedData.Slice(5, 12), protectedData[33..], protectedData.Slice(17, 16), plaintext, Header);
            return plaintext;
        }
        finally { CryptographicOperations.ZeroMemory(key); }
    }

    private static byte[] ReadKey(bool create)
    {
        using var mutex = new Mutex(false, "CodexAccountsKeyring-" + Environment.UserName);
        var acquired = false;
        try
        {
            try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(30)); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new TimeoutException("Secret Service is busy. Try again.");
            var existing = RunSecretTool(["lookup", "application", "codex-accounts", "purpose", "profile-key"]);
            if (existing.Code == 0 && !string.IsNullOrWhiteSpace(existing.Output))
                return ValidateKey(existing.Output);
            if (existing.Code != 1 || !string.IsNullOrWhiteSpace(existing.Error))
                throw new InvalidOperationException("Unlock your GNOME login keyring and check the Secret Service session.");
            if (!create) throw new CryptographicException("The Codex Accounts key is missing from Secret Service. Restore your login keyring; a replacement key will not decrypt existing profiles.");

            var generated = RandomNumberGenerator.GetBytes(32);
            try
            {
                var stored = RunSecretTool(["store", "--label=Codex Accounts", "application", "codex-accounts", "purpose", "profile-key"], Convert.ToBase64String(generated));
                if (stored.Code != 0) throw new InvalidOperationException("Could not store the encryption key in Secret Service. No plaintext fallback is used.");
                var verified = RunSecretTool(["lookup", "application", "codex-accounts", "purpose", "profile-key"]);
                var key = ValidateKey(verified.Output);
                if (verified.Code != 0 || !CryptographicOperations.FixedTimeEquals(generated, key))
                {
                    CryptographicOperations.ZeroMemory(key);
                    throw new CryptographicException("Secret Service key verification failed.");
                }
                return key;
            }
            finally { CryptographicOperations.ZeroMemory(generated); }
        }
        finally { if (acquired) mutex.ReleaseMutex(); }
    }

    private static byte[] ValidateKey(string value)
    {
        var key = Convert.FromBase64String(value.Trim());
        if (key.Length == 32) return key;
        CryptographicOperations.ZeroMemory(key);
        throw new CryptographicException("Invalid Codex Accounts encryption key in Secret Service.");
    }

    private static (int Code, string Output, string Error) RunSecretTool(string[] arguments, string? input = null)
    {
        var info = new ProcessStartInfo("secret-tool") { UseShellExecute = false,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in arguments) info.ArgumentList.Add(argument);
        using var process = Process.Start(info)
            ?? throw new InvalidOperationException("Install libsecret-tools and unlock the GNOME login keyring.");
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        if (input is not null) process.StandardInput.Write(input);
        process.StandardInput.Close();
        if (!process.WaitForExit(30000))
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException("Secret Service did not respond. Unlock the GNOME login keyring.");
        }
        return (process.ExitCode, output.GetAwaiter().GetResult(), error.GetAwaiter().GetResult());
    }
}
