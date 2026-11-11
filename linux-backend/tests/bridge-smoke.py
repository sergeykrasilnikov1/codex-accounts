"""Exercise the published Ubuntu backend against disposable metadata only."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

with tempfile.TemporaryDirectory(prefix="codex-accounts-bridge-") as directory:
    home = Path(directory) / ".codex"
    home.mkdir()
    (home / "config.toml").write_text('model = "demo"\n', encoding="utf-8")
    requests = [
        {"id": "home", "command": "setCodexHome", "payload": {"path": str(home)}},
        {"id": "add", "command": "addProfile", "payload": {"displayName": "Тест Ubuntu"}},
        {"id": "list", "command": "listProfiles"},
        {"id": "diagnostics", "command": "getDiagnostics"},
    ]
    result = subprocess.run(
        [sys.argv[1], "--desktop-bridge"],
        input="".join(json.dumps(request) + "\n" for request in requests),
        text=True, encoding="utf-8", capture_output=True, timeout=30,
        env={**os.environ, "CODEX_SWITCHER_DATA_DIR": directory, "CODEX_HOME": str(home)},
        check=True,
    )
    responses = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(responses) == len(requests), responses
    assert all(response["ok"] for response in responses), responses
    assert responses[2]["data"][0]["displayName"] == "Тест Ubuntu"
    assert responses[2]["data"][0]["hasCredentials"] is False
    assert not (home / "auth.json").exists()
    print("Ubuntu bridge: UTF-8 metadata round trip passed.")
