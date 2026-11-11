import { useEffect, useState } from 'react'
import type { ProfileSummary, ProfileLimits } from '../../shared/contracts'

function remaining(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : `${Math.round(Math.max(0, Math.min(100, value)))}%`
}

export default function TrayPopup() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [limits, setLimits] = useState<ProfileLimits[]>([])
  const [loading, setLoading] = useState(true)
  const [limitsLoading, setLimitsLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const response = await window.codexSwitcher.invoke<ProfileSummary[]>('listProfiles')
        if (!response.ok || !response.data) throw new Error(response.error || 'Не удалось загрузить аккаунты.')
        if (!active) return
        setProfiles(response.data); setLoading(false)
        const usage = await window.codexSwitcher.invoke<ProfileLimits[]>('getLimits')
        if (active && usage.ok && usage.data) setLimits(usage.data)
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'Ошибка загрузки.') }
      finally { if (active) { setLoading(false); setLimitsLoading(false) } }
    })()
    return () => { active = false }
  }, [])
  useEffect(() => {
    const close = () => { if (!busy) window.close() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('blur', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('blur', close); window.removeEventListener('keydown', escape) }
  }, [busy])
  async function switchTo(profile: ProfileSummary) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await window.codexSwitcher.invoke<{success: boolean; message: string}>('switchProfile', { name: profile.name })
      if (!result.ok || !result.data?.success) throw new Error(result.data?.message || result.error || 'Не удалось переключить аккаунт.')
      window.close()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Ошибка переключения.') }
    finally { setBusy(false) }
  }
  return <main className="tray-popup">
    <header><strong>Codex Accounts</strong><button aria-label="Закрыть" disabled={busy} onClick={() => window.close()}>×</button></header>
    <div className="tray-popup__hint">Осталось лимитов {limitsLoading && '· обновляем…'}</div>
    {loading && <p role="status">Загрузка аккаунтов…</p>}
    {error && <p className="tray-popup__error" role="alert">{error}</p>}
    <div className="tray-popup__accounts">{profiles.map(profile => {
      const usage = limits.find(item => item.name === profile.name && item.success)
      return <button className={`tray-popup__account ${profile.active ? 'is-active' : ''}`} key={profile.name}
        disabled={busy || profile.active || !profile.hasCredentials || profile.credentialStatus !== 'ready'} onClick={() => void switchTo(profile)}>
        <span className="tray-popup__name">{profile.active && '✓ '}{profile.displayName}<small>{!profile.hasCredentials ? 'Вход не сохранён' : profile.active ? 'Текущий аккаунт' : 'Нажмите для входа'}</small></span>
        <span className="tray-popup__limit"><small>5 часов</small><strong>{remaining(usage?.fiveHour?.percentLeft)}</strong></span>
        <span className="tray-popup__limit"><small>Неделя</small><strong>{remaining(usage?.weekly?.percentLeft)}</strong></span>
      </button>
    })}</div>
    {!loading && profiles.length === 0 && <p>Нет подключённых аккаунтов</p>}
    {busy && <p role="status">Переключение аккаунта…</p>}
    <footer><button disabled={busy} onClick={() => { void window.codexSwitcher.invoke('openManagement') }}>Управление аккаунтами</button><small>«—» — лимит пока недоступен</small></footer>
  </main>
}
