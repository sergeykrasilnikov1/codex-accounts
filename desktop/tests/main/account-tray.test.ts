import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeImage, MenuItemConstructorOptions } from 'electron'
import type { BackendClient } from '../../src/main/backend-client'
import { AccountTray } from '../../src/main/account-tray'

const mocks = vi.hoisted(() => ({
  menu: [] as MenuItemConstructorOptions[],
  error: vi.fn(),
  tooltip: vi.fn()
}))
vi.mock('electron', () => ({
  dialog: { showErrorBox: mocks.error },
  Menu: { buildFromTemplate: (items: MenuItemConstructorOptions[]) => { mocks.menu = items; return items } },
  Tray: class {
    setToolTip = mocks.tooltip
    on = vi.fn()
    popUpContextMenu = vi.fn()
  }
}))

const profiles = [
  { name: 'current', displayName: 'Первый', active: true, hasCredentials: true, credentialStatus: 'ready' },
  { name: 'next', displayName: 'Работа & личное', active: false, hasCredentials: true, credentialStatus: 'ready' },
  { name: 'empty', displayName: 'Новый', active: false, hasCredentials: false, credentialStatus: 'missing' }
]

function setup(invoke = vi.fn().mockResolvedValue({ ok: true, data: profiles })) {
  const management = vi.fn()
  const quit = vi.fn()
  const tray = new AccountTray({ invoke } as unknown as BackendClient, {} as NativeImage, management, quit)
  return { tray, invoke, management, quit }
}

function click(index: number): void {
  mocks.menu[index].click?.({} as never, {} as never, {} as never)
}

describe('account tray', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.menu = [] })

  it('shows all accounts, marks the active account and disables unavailable sign-ins', async () => {
    const { tray, management, quit } = setup()
    await tray.open()
    expect(mocks.menu[0]).toMatchObject({ checked: true, enabled: false })
    expect(mocks.menu[1]).toMatchObject({ label: 'Работа && личное', enabled: true })
    expect(mocks.menu[2]).toMatchObject({ enabled: false })
    click(4)
    click(5)
    expect(management).toHaveBeenCalledOnce()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('switches on one click and blocks duplicate clicks until completion', async () => {
    let complete!: (value: unknown) => void
    const { tray, invoke } = setup()
    await tray.open()
    invoke.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    click(1)
    click(1)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenLastCalledWith('switchProfile', { name: 'next' })
    await tray.open()
    expect(mocks.menu[0].label).toBe('Переключение аккаунта…')
    complete({ ok: true, data: { success: true } })
    await vi.waitFor(() => expect(mocks.tooltip).toHaveBeenLastCalledWith('Codex: Работа & личное'))
  })

  it('surfaces a rolled-back switch even when the bridge request succeeded', async () => {
    const { tray, invoke } = setup()
    await tray.open()
    invoke.mockResolvedValueOnce({ ok: true, data: { success: false, message: 'Предыдущий вход восстановлен' } })
    click(1)
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Переключение аккаунта отменено', 'Предыдущий вход восстановлен'))
  })

  it('opens management on a backend error and handles an empty account list', async () => {
    const { tray, management, invoke } = setup(vi.fn().mockRejectedValue(new Error('Backend missing')))
    await tray.open()
    expect(management).toHaveBeenCalledOnce()
    expect(mocks.error).toHaveBeenCalled()
    invoke.mockResolvedValueOnce({ ok: true, data: [] })
    await tray.open()
    expect(mocks.menu[0]).toMatchObject({ label: 'Нет подключённых аккаунтов', enabled: false })
  })
})
