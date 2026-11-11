using CodexAccountSwitcher.Core;
using CodexAccountSwitcher.DesktopBridge;
using System.Text;

if (!args.Contains("--desktop-bridge"))
{
    Console.Error.WriteLine("Start Codex Accounts through its Electron application.");
    return 1;
}
var utf8 = new UTF8Encoding(false, true);
using var input = new StreamReader(Console.OpenStandardInput(), utf8);
using var output = new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true };
await new DesktopBridgeServer(SqliteAppDatabase.CreateDefault()).RunAsync(input, output, CancellationToken.None);
return 0;
