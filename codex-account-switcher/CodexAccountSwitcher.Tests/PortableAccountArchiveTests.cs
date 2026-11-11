using System.Text;
using CodexAccountSwitcher.Core;

namespace CodexAccountSwitcher.Tests;

public sealed class PortableAccountArchiveTests
{
    private const string Password = "synthetic-test-password";
    private static PortableAccount[] Accounts() => [new("Рабочий", "{\"token\":\"synthetic-secret\"}"u8.ToArray())];

    [Fact]
    public void PortableArchiveRoundTripsWithoutExposingCredentialsAndUsesRandomSalt()
    {
        var archive = PortableAccountArchive.Encrypt(Accounts(), Password);
        Assert.DoesNotContain("synthetic-secret", Encoding.UTF8.GetString(archive));
        Assert.NotEqual(archive, PortableAccountArchive.Encrypt(Accounts(), Password));
        var restored = Assert.Single(PortableAccountArchive.Decrypt(archive, Password));
        Assert.Equal("Рабочий", restored.DisplayName);
        Assert.Equal(Accounts()[0].Auth, restored.Auth);
    }

    [Fact]
    public void RejectsWrongPasswordTamperingAndTruncation()
    {
        var archive = PortableAccountArchive.Encrypt(Accounts(), Password);
        Assert.Throws<InvalidDataException>(() => PortableAccountArchive.Decrypt(archive, "wrong-password-value"));
        archive[^1] ^= 1;
        Assert.Throws<InvalidDataException>(() => PortableAccountArchive.Decrypt(archive, Password));
        Assert.Throws<InvalidDataException>(() => PortableAccountArchive.Decrypt([1, 2], Password));
    }

    [Fact]
    public void RejectsShortPasswordsAndInvalidCredentials()
    {
        Assert.Throws<InvalidDataException>(() => PortableAccountArchive.Encrypt(Accounts(), "short"));
        Assert.Throws<InvalidDataException>(() => PortableAccountArchive.Encrypt([new("test", "[]"u8.ToArray())], Password));
    }
}
