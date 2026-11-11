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
  let items
  if (process.platform === 'win32') {
    await application.evaluate(({ app }) => app.emit('second-instance'))
    const popup = await application.firstWindow()
    await popup.locator('.tray-popup').waitFor()
    const fontSize = await popup.locator('.tray-popup').evaluate(element => getComputedStyle(element).fontSize)
    assert.ok(parseFloat(fontSize) >= 17)
    await popup.close()
  } else {
    await expect.poll(() => application.evaluate(({ app }) => {
    app.emit('second-instance')
    const items = globalThis.traySmokeItems
    return items?.[0]?.label === 'Загрузка аккаунтов…' ? undefined : items
  }), { timeout: 30000 }).toBeDefined()
  items = await application.evaluate(() => globalThis.traySmokeItems)
  assert.ok(items?.some(item => item.label === 'Управление аккаунтами…'), 'Tray menu was not created.')
  }
  await application.evaluate(({ app }) => app.emit('second-instance', {}, ['--manage']))
  const page = await application.firstWindow()
  await page.locator('.app-shell').waitFor()
  const result = await page.evaluate(() => window.codexSwitcher.invoke('listProfiles'))
  assert.equal(result.ok, true)
  if (items) assert.equal(items.length, result.data.length === 0 ? 4 : result.data.length + 3)
  await page.close()
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
  console.log(`Tray smoke passed: ${result.data.length} accounts; lazy management window opens and closes.`)
} finally {
  await application.close()
}
