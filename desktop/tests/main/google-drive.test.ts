import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const mocks = vi.hoisted(() => ({ directory: '', open: vi.fn(), available: true }))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.directory },
  shell: { openExternal: mocks.open },
  safeStorage: { isEncryptionAvailable: () => mocks.available, getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (text: string) => Buffer.from(text).reverse(), decryptString: (bytes: Buffer) => Buffer.from(bytes).reverse().toString() }
}))
import { GoogleDrive, readLimited } from '../../src/main/google-drive'

describe('Google Drive', () => {
  const originalResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  const realFetch = globalThis.fetch
  beforeEach(async () => {
    mocks.directory = await mkdtemp(join(tmpdir(), 'drive-test-'))
    mocks.available = true
    mocks.open.mockReset()
    Object.defineProperty(process, 'resourcesPath', { value: mocks.directory, configurable: true })
    await writeFile(join(mocks.directory, 'google-oauth.json'), JSON.stringify({ installed: { client_id: 'synthetic.apps.googleusercontent.com', client_secret: 'synthetic-desktop-client' } }))
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    if (originalResources) Object.defineProperty(process, 'resourcesPath', originalResources)
    else Reflect.deleteProperty(process, 'resourcesPath')
    await rm(mocks.directory, { recursive: true, force: true })
  })

  it('uses loopback, validates state, exchanges PKCE, uploads ciphertext and downloads the newest backup', async () => {
    let challenge = ''
    mocks.open.mockImplementation(async (address: string) => {
      const url = new URL(address)
      expect(url.origin).toBe('https://accounts.google.com')
      expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.appdata')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      challenge = url.searchParams.get('code_challenge')!
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      expect(callback.hostname).toBe('127.0.0.1')
      callback.search = new URLSearchParams({ state: 'wrong', code: 'synthetic-code' }).toString()
      expect((await realFetch(callback)).status).toBe(400)
      callback.searchParams.set('state', url.searchParams.get('state')!)
      expect((await realFetch(callback)).status).toBe(200)
    })
    const archive = Buffer.from('CAAR1-synthetic-encrypted-data')
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (address: string, options?: RequestInit) => {
      calls.push(address)
      expect(options?.redirect).toBe('error')
      if (address.includes('/token')) {
        const body = options?.body as URLSearchParams
        expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(challenge)
        return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600 })
      }
      expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer synthetic-access')
      if (address.includes('/upload/')) {
        expect((options?.body as Buffer).includes(archive)).toBe(true)
        expect((options?.body as Buffer).toString()).toContain('appDataFolder')
        return Response.json({ id: 'synthetic-file' })
      }
      if (address.includes('alt=media')) return new Response(archive)
      const query = new URL(address).searchParams
      expect(query.get('spaces')).toBe('appDataFolder')
      expect(query.get('orderBy')).toBe('createdTime desc')
      return Response.json({ files: [{ id: 'synthetic-file', size: archive.length.toString() }] })
    }))
    const drive = new GoogleDrive()
    expect((await drive.connect()).connected).toBe(true)
    expect((await readFile(join(mocks.directory, 'google-drive-token.encrypted'))).toString()).not.toContain('synthetic-refresh')
    await drive.upload(archive)
    expect(await drive.download()).toEqual(archive)
    expect(calls).toHaveLength(4)
    expect((await drive.disconnect()).connected).toBe(false)
    await expect(drive.download()).rejects.toThrow('Сначала подключите')
  })

  it('rejects unavailable secure storage, oversized responses and Google failures', async () => {
    mocks.available = false
    await expect(new GoogleDrive().connect()).rejects.toThrow('хранилище ключей')
    expect(mocks.open).not.toHaveBeenCalled()
    await expect(readLimited(new Response('oversized'), 2)).rejects.toThrow('слишком большой')
    await expect(readLimited(new Response('private diagnostic', { status: 401 }), 100)).rejects.toThrow('HTTP 401')
  })
})
