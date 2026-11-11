import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TrayPopup from '../../src/renderer/src/TrayPopup'
import type { DesktopApi } from '../../src/shared/contracts'

describe('tray popup', () => {
  it('shows both remaining limits including zero, keeps unknown limits blank and switches accounts', async () => {
    const invoke = vi.fn(async (command: string) => ({ id: 'test', ok: true, error: null, data: command === 'listProfiles' ? [
      { name: 'one', displayName: 'Рабочий', active: false, hasCredentials: true, credentialStatus: 'ready' },
      { name: 'two', displayName: 'Личный', active: true, hasCredentials: true, credentialStatus: 'ready' }
    ] : command === 'getLimits' ? [{ name: 'one', success: true, fiveHour: { percentLeft: 0 }, weekly: { percentLeft: 62 } }] : { success: true } })) as unknown as DesktopApi['invoke']
    window.codexSwitcher = { invoke } as DesktopApi
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    render(<TrayPopup />)
    expect(await screen.findByText('0%')).toBeInTheDocument()
    expect(screen.getByText('62%')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Личный/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Рабочий/ }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('switchProfile', { name: 'one' }))
    await waitFor(() => expect(close).toHaveBeenCalled())
    close.mockRestore()
  })

  it('surfaces a failed switch while retaining the popup', async () => {
    const invoke = vi.fn(async (command: string) => ({id:'test',ok:true,error:null,data: command === 'listProfiles' ? [{name:'one',displayName:'Account',active:false,hasCredentials:true,credentialStatus:'ready'}] : command === 'getLimits' ? [] : {success:false,message:'Предыдущий вход восстановлен'} })) as unknown as DesktopApi['invoke']
    window.codexSwitcher = { invoke } as DesktopApi
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    render(<TrayPopup />)
    fireEvent.click(await screen.findByRole('button',{name:/Account/}))
    expect(await screen.findByRole('alert')).toHaveTextContent('Предыдущий вход восстановлен')
    expect(close).not.toHaveBeenCalled()
    close.mockRestore()
  })
})
