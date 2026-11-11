using System.Security.Cryptography;
using System.Text;
using CodexAccountSwitcher.Core;

namespace CodexAccountSwitcher.Tests;

public sealed class LinuxSecretProtectorTests
{
    private static readonly byte[] Key = SHA256.HashData("synthetic-unit-test-key"u8);

    [Fact]
    public void AuthenticatedEncryptionRoundTripsAndUsesUniqueNonces()
    {
        var protector = new LinuxSecretProtector(() => Key.ToArray());
        var plaintext = Encoding.UTF8.GetBytes("{\"token\":\"тест\"}");
        var encrypted = protector.Protect(plaintext);
        Assert.Equal(plaintext, protector.Unprotect(encrypted));
        Assert.NotEqual(encrypted, protector.Protect(plaintext));
        Assert.DoesNotContain("тест", Encoding.UTF8.GetString(encrypted));
    }

    [Fact]
    public void RejectsTamperingAndWrongKeys()
    {
        var protector = new LinuxSecretProtector(() => Key.ToArray());
        var encrypted = protector.Protect("test"u8);
        var other = new LinuxSecretProtector(() => new byte[32]);
        Assert.ThrowsAny<CryptographicException>(() => other.Unprotect(encrypted));
        encrypted[^1] ^= 1;
        Assert.ThrowsAny<CryptographicException>(() => protector.Unprotect(encrypted));
    }

    [Fact]
    public void RejectsForeignOrTruncatedCredentialsBeforeLoadingTheKey()
    {
        var protector = new LinuxSecretProtector(() => throw new InvalidOperationException("Key must not be requested"));
        Assert.Throws<CryptographicException>(() => protector.Unprotect([1, 2, 3]));
        Assert.Throws<CryptographicException>(() => protector.Unprotect(new byte[64]));
    }
}
