import { app, BrowserWindow, nativeImage, nativeTheme, screen, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BackendClient } from './backend-client'
import { registerIpc, unregisterIpc } from './ipc'
import { UpdateManager } from './update-manager'
import { configureE2EUpdateFeed } from './update-feed'
import { createWindowOptions } from './window-security'
import { AccountTray } from './account-tray'
import iconPath from '../../build/icon.ico?asset'
import linuxIconPath from '../../build/account-switcher.png?asset'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const applicationIcon = nativeImage.createFromPath(process.platform === 'win32' ? iconPath : linuxIconPath)
const { autoUpdater } = electronUpdater
const isE2E = process.env.CODEX_SWITCHER_E2E === '1'
configureE2EUpdateFeed(autoUpdater, isE2E, process.env.CODEX_SWITCHER_E2E_UPDATE_URL)
let mainWindow: BrowserWindow | null = null
let trayWindow: BrowserWindow | null = null
let accountTray: AccountTray | null = null
let quitting = false
const backend = new BackendClient()
// Keep existing desktop preferences when upgrading from the original product name.
app.setPath('userData', join(app.getPath('appData'), 'codex-account-switcher-desktop'))
const updates = new UpdateManager({
  isPackaged: app.isPackaged && (process.platform !== 'linux' || Boolean(process.env.APPIMAGE)),
  currentVersion: app.getVersion(),
  updater: autoUpdater,
  openExternal: (url) => shell.openExternal(url)
})

if (isE2E && process.env.CODEX_SWITCHER_E2E_USER_DATA) {
  app.setPath('userData', join(process.env.CODEX_SWITCHER_E2E_USER_DATA))
}

function rendererEntry(): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return process.env.ELECTRON_RENDERER_URL
  }
  return pathToFileURL(join(currentDirectory, '../renderer/index.html')).toString()
}

async function createMainWindow(): Promise<void> {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.reload()
    return
  }
  const entry = rendererEntry()
  const preload = join(currentDirectory, '../preload/index.cjs')
  nativeTheme.themeSource = 'system'
  mainWindow = new BrowserWindow({
    ...createWindowOptions(preload, nativeTheme.shouldUseDarkColors ? '#0d0f0e' : '#f3f5f2'),
    icon: applicationIcon
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://github.com/sergeykrasilnikov1/codex-accounts')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== entry) {
      event.preventDefault()
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    if (!quitting && process.platform === 'linux') void accountTray?.open(false)
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(entry)
  } else {
    await mainWindow.loadFile(join(currentDirectory, '../renderer/index.html'))
  }

  void backend.invoke<{ theme?: 'system' | 'dark' | 'light' }>('getSettings').then((response) => {
    const theme = response.ok ? response.data?.theme : undefined
    nativeTheme.themeSource = theme === 'dark' || theme === 'light' ? theme : 'system'
  }).catch(() => {
    nativeTheme.themeSource = 'system'
  })
}

async function createTrayWindow(): Promise<void> {
  if (trayWindow) { trayWindow.show(); trayWindow.focus(); return }
  const bounds = accountTray!.tray.getBounds()
  const area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea
  const width = Math.min(600, area.width)
  const height = Math.min(580, area.height)
  const popup = new BrowserWindow({
    ...createWindowOptions(join(currentDirectory, '../preload/index.cjs')),
    width, height, minWidth: 320, minHeight: 200, frame: false, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, icon: applicationIcon,
    x: Math.max(area.x, Math.min(bounds.x + bounds.width - width, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y - height, area.y + area.height - height)),
    webPreferences: { ...createWindowOptions(join(currentDirectory, '../preload/index.cjs')).webPreferences, additionalArguments: ['--tray-popup'] }
  })
  trayWindow = popup
  popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  popup.webContents.on('will-navigate', event => event.preventDefault())
  popup.once('ready-to-show', () => { popup.show(); popup.focus() })
  popup.on('closed', () => { trayWindow = null })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) await popup.loadURL(rendererEntry())
  else await popup.loadFile(join(currentDirectory, '../renderer/index.html'))
}

const hasLock = isE2E || app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine: string[] = []) => {
    if (commandLine.includes('--manage')) void createMainWindow()
    else void accountTray?.open()
  })

  app.whenReady().then(async () => {
    registerIpc(backend, updates, rendererEntry(), () => { void createMainWindow() }, (sender, count) => {
      if (!trayWindow || trayWindow.webContents !== sender) return
      const bounds = trayWindow.getBounds()
      const area = screen.getDisplayMatching(bounds).workArea
      const height = Math.min(area.height, 580, Math.max(280, 220 + count * 98))
      trayWindow.setBounds({ height, y: Math.max(area.y, bounds.y + bounds.height - height) })
    })
    if (isE2E) {
      await createMainWindow()
      return
    }
    accountTray = new AccountTray(backend, applicationIcon,
      () => { void createMainWindow() }, () => app.quit(), process.platform,
      process.platform === 'win32' ? () => { void createTrayWindow() } : undefined)
    if (process.argv.includes('--manage')) await createMainWindow()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow()
    }
  })
}

app.on('before-quit', () => {
  quitting = true
  accountTray?.tray.destroy()
  unregisterIpc()
  backend.dispose()
})

app.on('window-all-closed', () => {
  if (isE2E) app.quit()
})
