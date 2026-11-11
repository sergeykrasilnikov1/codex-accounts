import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage, shell } from 'electron'

const scope = 'https://www.googleapis.com/auth/drive.appdata'
const maximumArchiveLength = 32 * 1024 * 1024
interface Client { client_id: string; client_secret: string }
interface Tokens { access_token: string; refresh_token: string; expires_at: number }

export async function readLimited(response: Response, maximum: number): Promise<Buffer> {
  if (!response.ok) throw new Error(`Google Drive: HTTP ${response.status}. Проверьте подключение и доступ к Google.`)
  if (Number(response.headers.get('content-length')) > maximum) throw new Error('Ответ Google Drive слишком большой.')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Google Drive вернул пустой ответ.')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return Buffer.concat(chunks, length)
      length += value.length
      if (length > maximum) throw new Error('Ответ Google Drive слишком большой.')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export class GoogleDrive {
  private readonly tokenPath = join(app.getPath('userData'), 'google-drive-token.encrypted')
  private connecting = false
  private readonly clientPath = join(process.resourcesPath, 'google-oauth.json')

  status(): { configured: boolean; connected: boolean } {
    let configured = false
    try { configured = Boolean(JSON.parse(readFileSync(this.clientPath, 'utf8')).installed?.client_id) } catch { /* Not configured yet. */ }
    return { configured, connected: existsSync(this.tokenPath) }
  }

  private async client(): Promise<Client> {
    if (!existsSync(this.clientPath)) throw new Error('Подключение Google ещё не настроено разработчиком.')
    const value = JSON.parse(await readFile(this.clientPath, 'utf8')).installed as Client
    if (!value || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(value.client_id) || typeof value.client_secret !== 'string')
      throw new Error('Некорректные настройки подключения Google.')
    return value
  }

  private checkStorage(): void {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'))
      throw new Error('Системное хранилище ключей недоступно. Разблокируйте его перед подключением Google.')
  }

  private async save(tokens: Tokens): Promise<void> {
    this.checkStorage()
    await mkdir(app.getPath('userData'), { recursive: true, mode: 0o700 })
    const temporary = `${this.tokenPath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, safeStorage.encryptString(JSON.stringify(tokens)), { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.tokenPath)
    } finally { await rm(temporary, { force: true }) }
  }

  private async tokenRequest(fields: Record<string, string>, previousRefresh = ''): Promise<Tokens> {
    const client = await this.client()
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', body: new URLSearchParams({ ...client, ...fields }), redirect: 'error', signal: AbortSignal.timeout(30_000)
    })
    const result = JSON.parse((await readLimited(response, 65536)).toString())
    if (typeof result.access_token !== 'string' || !(result.refresh_token || previousRefresh) || !Number.isFinite(result.expires_in))
      throw new Error('Google не выдал постоянный доступ. Подключите Google Drive повторно.')
    const tokens: Tokens = { access_token: result.access_token, refresh_token: result.refresh_token || previousRefresh, expires_at: Date.now() + result.expires_in * 1000 }
    await this.save(tokens)
    return tokens
  }

  async connect(): Promise<ReturnType<GoogleDrive['status']>> {
    if (this.connecting) throw new Error('Подключение Google уже выполняется.')
    this.connecting = true
    let server: ReturnType<typeof createServer> | undefined
    let timer: NodeJS.Timeout | undefined
    try {
      this.checkStorage()
      const client = await this.client()
      const verifier = randomBytes(32).toString('base64url')
      const state = randomBytes(32).toString('base64url')
      let redirect = ''
      let accept!: (code: string) => void
      let reject!: (error: Error) => void
      const codePromise = new Promise<string>((resolve, fail) => { accept = resolve; reject = fail })
      // Attach immediately so opening the browser cannot leave a rejected callback promise unhandled.
      void codePromise.catch(() => {})
      server = createServer((request, response) => {
        let url: URL
        try { url = new URL(request.url || '/', redirect) }
        catch { response.writeHead(400).end('Invalid callback'); return }
        if (request.method !== 'GET' || request.headers.host !== new URL(redirect).host || url.origin !== new URL(redirect).origin || url.pathname !== '/oauth/callback' || url.searchParams.get('state') !== state) {
          response.writeHead(400).end('Invalid callback'); return
        }
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        if (url.searchParams.has('error') || !url.searchParams.get('code')) {
          response.end('Подключение отменено. Вернитесь в Codex Accounts.')
          reject(new Error('Подключение Google отменено.')); return
        }
        response.end('Разрешение получено. Вернитесь в Codex Accounts для завершения подключения.')
        accept(url.searchParams.get('code')!)
      })
      server.requestTimeout = 10_000
      server.headersTimeout = 10_000
      await new Promise<void>((resolve, fail) => { server!.once('error', fail); server!.listen(0, '127.0.0.1', resolve) })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Не удалось открыть локальное подключение Google.')
      redirect = `http://127.0.0.1:${address.port}/oauth/callback`
      timer = setTimeout(() => reject(new Error('Время подключения Google истекло. Попробуйте снова.')), 180_000)
      const parameters = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: 'code', scope,
        access_type: 'offline', prompt: 'consent select_account', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })
      await shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${parameters}`)
      const code = await codePromise
      await this.tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect })
      return this.status()
    } finally {
      if (timer) clearTimeout(timer)
      server?.closeAllConnections()
      server?.close()
      this.connecting = false
    }
  }

  async disconnect(): Promise<ReturnType<GoogleDrive['status']>> {
    if (this.connecting) throw new Error('Сначала завершите подключение Google.')
    await rm(this.tokenPath, { force: true })
    return this.status()
  }

  private async request(url: string, options: RequestInit = {}): Promise<Response> {
    this.checkStorage()
    if (!existsSync(this.tokenPath)) throw new Error('Сначала подключите Google Drive.')
    let tokens: Tokens
    try { tokens = JSON.parse(safeStorage.decryptString(await readFile(this.tokenPath))) }
    catch { throw new Error('Не удалось прочитать вход Google. Подключите Google Drive повторно.') }
    if (tokens.expires_at < Date.now() + 60_000) tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }, tokens.refresh_token)
    return fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${tokens.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(60_000) })
  }

  async upload(archive: Buffer): Promise<void> {
    if (archive.length > maximumArchiveLength || archive.subarray(0, 5).toString() !== 'CAAR1') throw new Error('Некорректный зашифрованный архив.')
    const boundary = `codex-${randomUUID()}`
    const metadata = JSON.stringify({ name: `Codex-Accounts-${new Date().toISOString()}.encrypted`, parents: ['appDataFolder'], mimeType: 'application/octet-stream' })
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`), archive, Buffer.from(`\r\n--${boundary}--\r\n`)])
    await readLimited(await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    }), 65536)
  }

  async download(): Promise<Buffer> {
    const query = new URLSearchParams({ spaces: 'appDataFolder', q: "trashed = false and mimeType = 'application/octet-stream' and name contains 'Codex-Accounts-'", orderBy: 'createdTime desc', pageSize: '1', fields: 'files(id,size)' })
    const listing = JSON.parse((await readLimited(await this.request(`https://www.googleapis.com/drive/v3/files?${query}`), 65536)).toString())
    const file = listing.files?.[0]
    if (!file || typeof file.id !== 'string') throw new Error('В этом Google Drive ещё нет сохранённых аккаунтов.')
    if (Number(file.size) > maximumArchiveLength) throw new Error('Архив в Google Drive слишком большой.')
    const archive = await readLimited(await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`), maximumArchiveLength)
    if (archive.subarray(0, 5).toString() !== 'CAAR1') throw new Error('Некорректный архив в Google Drive.')
    return archive
  }
}
