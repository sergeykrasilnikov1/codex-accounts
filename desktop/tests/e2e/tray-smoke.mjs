import assert from 'node:assert/strict'
import { _electron, expect } from '@playwright/test'

const executablePath = process.argv[2]
assert.ok(executablePath, 'Pass the installed switcher executable path.')
const application = await _electron.launch({ executablePath,
  args: process.platform === 'linux' ? ['--no-sandbox'] : [],
  env: { ...process.env, CODEX_SWITCHER_E2E: '0' } })
try {
  await application.evaluate(async ({ app }) => { await app.whenReady() })
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0,
    'Tray startup must not create the management window.')
  await application.evaluate(({ app, Tray }) => {
    // Capture the native menu without showing it or selecting an account.
    Tray.prototype.popUpContextMenu = function (menu) {
      globalThis.traySmokeItems = menu.items.map(item => ({ label: item.label, checked: item.checked, enabled: item.enabled }))
    }
    Tray.prototype.setContextMenu = Tray.prototype.popUpContextMenu
  })
  await expect.poll(() => application.evaluate(({ app }) => {
    app.emit('second-instance')
    const items = globalThis.traySmokeItems
    return items?.[0]?.label === 'Загрузка аккаунтов…' ? undefined : items
  }), { timeout: 30000 }).toBeDefined()
  const items = await application.evaluate(() => globalThis.traySmokeItems)
  assert.ok(items?.some(item => item.label === 'Управление аккаунтами…'), 'Tray menu was not created.')
  await application.evaluate(({ app }) => app.emit('second-instance', {}, ['--manage']))
  const page = await application.firstWindow()
  await page.locator('.app-shell').waitFor()
  const result = await page.evaluate(() => window.codexSwitcher.invoke('listProfiles'))
  assert.equal(result.ok, true)
  assert.equal(items.length, result.data.length === 0 ? 4 : result.data.length + 3)
  await page.close()
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
  console.log(`Tray smoke passed: ${result.data.length} accounts; lazy management window opens and closes.`)
} finally {
  await application.close()
}
