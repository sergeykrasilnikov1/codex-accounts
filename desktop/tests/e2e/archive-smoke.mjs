import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron } from '@playwright/test'

const root = await mkdtemp(join(tmpdir(), 'codex-archive-smoke-'))
const home = join(root, '.codex')
await mkdir(home)
await writeFile(join(home, 'config.toml'), 'model = "synthetic"\n')
const auth = '{"token":"synthetic-archive-smoke-secret"}'
await writeFile(join(home, 'auth.json'), auth)
const application = await _electron.launch({ executablePath: process.argv[2], args: process.platform === 'linux' ? ['--no-sandbox', '--manage'] : ['--manage'],
  env: { ...process.env, CODEX_SWITCHER_E2E: '0', CODEX_SWITCHER_DATA_DIR: root, CODEX_HOME: home } })
try {
  const page = await application.firstWindow()
  await page.locator('.app-shell').waitFor()
  const added = await page.evaluate(() => window.codexSwitcher.invoke('addProfile', { displayName: 'Synthetic account' }))
  assert.equal(added.ok, true)
  await writeFile(join(added.data.directoryPath, 'auth.json'), auth)
  await application.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, root)
  await page.getByRole('button', { name: /настройки/i }).click()
  await page.getByText('Перенос через файл', { exact: true }).click()
  await page.getByLabel('Мастер-пароль (от 8 символов)').fill('synthetic-test-password')
  await page.getByLabel('Повторите пароль для сохранения').fill('synthetic-test-password')
  await page.getByRole('button', { name: 'Экспорт файла' }).click()
  await page.getByText('Аккаунтов сохранено в зашифрованный файл: 1', { exact: true }).waitFor()
  const archive = join(root, (await readdir(root)).find(name => name.endsWith('.encrypted')))
  assert.ok(!(await readFile(archive)).includes(Buffer.from('synthetic-archive-smoke-secret')))
  await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, archive)
  page.on('dialog', dialog => dialog.accept())
  await page.getByLabel('Мастер-пароль (от 8 символов)').fill('synthetic-test-password')
  await page.getByRole('button', { name: 'Импорт файла' }).click()
  await page.getByText('Аккаунтов добавлено: 1', { exact: true }).waitFor()
  const result = await page.evaluate(() => window.codexSwitcher.invoke('listProfiles'))
  assert.equal(result.data.length, 2)
  assert.ok(result.data.every(profile => profile.hasCredentials))
  assert.equal(await readFile(join(home, 'auth.json'), 'utf8'), auth)
  await page.screenshot({ path: join(process.cwd(), '../artifacts/google-drive-settings.png'), fullPage: true })
  console.log('Archive smoke passed: encrypted export, UI import, two protected profiles, current login preserved.')
} finally {
  await application.close()
  await rm(root, { recursive: true, force: true })
}
