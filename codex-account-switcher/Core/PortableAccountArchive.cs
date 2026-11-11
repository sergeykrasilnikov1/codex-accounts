using System.Security.Cryptography;
using System.Text.Json;

namespace CodexAccountSwitcher.Core;

public sealed record PortableAccount(string DisplayName, byte[] Auth);

public static class PortableAccountArchive
{
    public const int MaximumLength = 32 * 1024 * 1024;
    private const int HeaderLength = 49;

    public static byte[] Encrypt(PortableAccount[] accounts, string password)
    {
        ValidatePassword(password);
        ValidateAccounts(accounts);
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(accounts);
        try
        {
            if (plaintext.Length > MaximumLength - HeaderLength) throw new InvalidDataException("Архив слишком большой.");
            var result = new byte[HeaderLength + plaintext.Length];
            "CAAR1"u8.CopyTo(result);
            RandomNumberGenerator.Fill(result.AsSpan(5, 28));
            var key = Rfc2898DeriveBytes.Pbkdf2(password, result.AsSpan(5, 16), 600_000, HashAlgorithmName.SHA256, 32);
            try
            {
                using var aes = new AesGcm(key, 16);
                aes.Encrypt(result.AsSpan(21, 12), plaintext, result.AsSpan(HeaderLength), result.AsSpan(33, 16), result.AsSpan(0, 33));
                return result;
            }
            finally { CryptographicOperations.ZeroMemory(key); }
        }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }

    public static PortableAccount[] Decrypt(byte[] archive, string password)
    {
        ValidatePassword(password);
        if (archive.Length <= HeaderLength || archive.Length > MaximumLength || !archive.AsSpan(0, 5).SequenceEqual("CAAR1"u8))
            throw new InvalidDataException("Неверный формат архива аккаунтов.");
        var key = Rfc2898DeriveBytes.Pbkdf2(password, archive.AsSpan(5, 16), 600_000, HashAlgorithmName.SHA256, 32);
        var plaintext = new byte[archive.Length - HeaderLength];
        try
        {
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(archive.AsSpan(21, 12), archive.AsSpan(HeaderLength), archive.AsSpan(33, 16), plaintext, archive.AsSpan(0, 33));
            var accounts = JsonSerializer.Deserialize<PortableAccount[]>(plaintext) ?? throw new InvalidDataException("Архив пуст.");
            ValidateAccounts(accounts);
            return accounts;
        }
        catch (CryptographicException) { throw new InvalidDataException("Неверный мастер-пароль или архив повреждён."); }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    private static void ValidatePassword(string password)
    {
        if (password.Length < 8 || password.Length > 1024) throw new InvalidDataException("Мастер-пароль должен содержать от 8 до 1024 символов.");
    }

    private static void ValidateAccounts(PortableAccount[] accounts)
    {
        if (accounts.Length is < 1 or > 200) throw new InvalidDataException("Архив должен содержать от 1 до 200 аккаунтов.");
        foreach (var account in accounts)
        {
            if (account is null || string.IsNullOrWhiteSpace(account.DisplayName) || account.DisplayName.Length > 160 || account.Auth is null)
                throw new InvalidDataException("Некорректный аккаунт в архиве.");
            AuthDocumentValidator.Validate(account.Auth);
        }
    }
}
