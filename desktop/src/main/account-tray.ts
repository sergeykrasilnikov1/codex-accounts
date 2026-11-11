import { dialog, Menu, Tray, type NativeImage, type MenuItemConstructorOptions } from 'electron'
import type { BackendClient } from './backend-client'
import type { ProfileSummary } from '../shared/contracts'

export class AccountTray {
  readonly tray: Tray
  private loading = false
  private switching = false

  constructor(private readonly backend: BackendClient, icon: NativeImage,
    private readonly openManagement: () => void, private readonly quit: () => void) {
    this.tray = new Tray(icon)
    this.tray.setToolTip('Codex Accounts')
    this.tray.on('click', () => { void this.open() })
    this.tray.on('right-click', () => { void this.open() })
  }

  async open(): Promise<void> {
    if (this.loading) return
    if (this.switching) {
      this.tray.popUpContextMenu(Menu.buildFromTemplate([{ label: 'Переключение аккаунта…', enabled: false }]))
      return
    }
    this.loading = true
    try {
      const response = await this.backend.invoke<ProfileSummary[]>('listProfiles')
      if (!response.ok || !response.data) throw new Error(response.error ?? 'Не удалось загрузить аккаунты.')
      const items: MenuItemConstructorOptions[] = response.data.map(profile => ({
        label: profile.displayName.replaceAll('&', '&&') + (profile.hasCredentials ? '' : ' — вход не сохранён'),
        type: 'checkbox',
        checked: profile.active,
        enabled: !profile.active && profile.hasCredentials && profile.credentialStatus === 'ready',
        click: () => { void this.switchTo(profile) }
      }))
      if (items.length === 0) items.push({ label: 'Нет подключённых аккаунтов', enabled: false })
      items.push(
        { type: 'separator' },
        { label: 'Управление аккаунтами…', click: this.openManagement },
        { label: 'Выход', click: this.quit }
      )
      this.tray.popUpContextMenu(Menu.buildFromTemplate(items))
    } catch (error) {
      dialog.showErrorBox('Codex Accounts', error instanceof Error ? error.message : String(error))
      this.openManagement()
    } finally {
      this.loading = false
    }
  }

  private async switchTo(profile: ProfileSummary): Promise<void> {
    if (this.switching) return
    this.switching = true
    this.tray.setToolTip('Переключение аккаунта Codex…')
    try {
      const response = await this.backend.invoke<{ success: boolean; message: string }>('switchProfile', { name: profile.name })
      if (!response.ok || !response.data?.success) {
        throw new Error(response.data?.message ?? response.error ?? 'Не удалось переключить аккаунт.')
      }
      this.tray.setToolTip(`Codex: ${profile.displayName}`)
    } catch (error) {
      this.tray.setToolTip('Codex Accounts')
      dialog.showErrorBox('Переключение аккаунта отменено', error instanceof Error ? error.message : String(error))
    } finally {
      this.switching = false
    }
  }
}
