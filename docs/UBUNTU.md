# Ubuntu 24.04 LTS (x86-64)

Первая Linux-версия Codex Accounts рассчитана на Ubuntu 24.04 Desktop с GNOME,
установленным настольным Codex и разблокированной системной связкой ключей.
Это отдельная сборка backend без Windows Forms; Windows-сборка сохраняется.

## Установка

После успешной сборки GitHub Actions скачайте артефакт
`codex-accounts-ubuntu-x64` во вкладке **Actions → Ubuntu 24.04** и распакуйте его.
Для Ubuntu предпочтителен `.deb`:

```bash
sudo apt install ./Codex-Accounts-2.1.0-x64.deb
```

Перед использованием AppImage установите зависимости вручную:

```bash
sudo apt install libsecret-tools gnome-keyring libayatana-appindicator3-1 gnome-shell-extension-appindicator libfuse2t64
chmod +x Codex-Accounts-2.1.0-x64.AppImage
./Codex-Accounts-2.1.0-x64.AppImage
```

Для значка в панели GNOME требуется включённое расширение AppIndicator
(в стандартной Ubuntu Desktop оно обычно уже есть). После установки расширения
может потребоваться повторный вход в сеанс. Не запускайте переключатель через sudo.
Не отключайте sandbox Electron в постоянном ярлыке: если AppImage не запускается
из-за ограничений user namespaces, используйте `.deb`.

## Путь к Codex

Linux-сборка требует явного пути к настольному исполняемому файлу Codex.
Он проверяется по соседнему `resources/app.asar`; CLI вместо desktop не принимается.
Узнать команду запуска можно из поля `Exec` установленного desktop-файла:

```bash
grep -h '^Exec=' /usr/share/applications/*codex*.desktop /usr/share/applications/*chatgpt*.desktop 2>/dev/null
mkdir -p ~/.config/CodexAccountSwitcher
printf '%s\n' '/absolute/path/to/desktop-executable' > ~/.config/CodexAccountSwitcher/codex-executable.txt
```

Замените пример на фактический абсолютный путь **без аргументов и кавычек**.
Символические ссылки разрешаются до настоящего файла. AppImage самого Codex и
Snap/Flatpak-изоляция в эту первую версию не входят; используйте установленную
desktop-сборку с доступной папкой `resources`.

При `CODEX_SWITCHER_DATA_DIR` файл `codex-executable.txt` должен лежать в этой
папке, а не в стандартной. Codex Home определяется через `CODEX_HOME` или `~/.codex`.
Существующая логика работы требует файлового `auth.json`; при необходимости
выберите файловое хранилище входа через настройки переключателя.

## Защита аккаунтов

Профили и резервные копии шифруются AES-256-GCM со случайным nonce и проверкой
целостности. Ключ хранится в GNOME Secret Service через `secret-tool`; при
недоступной или заблокированной связке ключей приложение не переходит на открытое
хранение. Новые файлы входа создаются с правами `0600`, каталоги профилей — `0700`.

Сохраняется техническое имя файла `auth.dpapi`, но формат Ubuntu отличается от
Windows DPAPI. **Перенос зашифрованных входов между Windows и Ubuntu не поддерживается**:
добавьте аккаунты на Ubuntu и выполните вход заново. Не удаляйте ключ Codex Accounts
из связки ключей: без него сохранённые профили не расшифруются.

## Сборка и проверки

```bash
dotnet test linux-backend/tests/CodexAccounts.Linux.Tests.csproj -c Release
dotnet publish linux-backend/CodexAccounts.Linux.csproj -c Release -r linux-x64 --self-contained true -p:PublishSingleFile=true -o artifacts/backend/linux-x64
python3 linux-backend/tests/bridge-smoke.py "$PWD/artifacts/backend/linux-x64/CodexAccountSwitcher"
cd desktop
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm package:ubuntu
```

Для интеграционного теста Secret Service задайте `CODEX_ACCOUNTS_KEYRING_TEST=1`
только в одноразовом тестовом сеансе D-Bus с тестовой связкой ключей; пример
приведён в `.github/workflows/ubuntu.yml`.

CI проверяет реальное шифрование через связку ключей, остановку только тестового
desktop-процесса, права файлов, JSON-мост и интерфейс под Xvfb. Он не входит в
реальный аккаунт OpenAI. Полное переключение, GNOME/Wayland и обновление живого
Codex требуют отдельной проверки на Ubuntu Desktop. Windows Remote API, команды
питания и управление V2RayTun в Linux-backend не включены.

Для `.deb` обновления устанавливаются вручную; обновление через интерфейс
предназначено для AppImage. Готовые пакеты CI — тестовые артефакты, а не стабильный
подписанный релиз.
