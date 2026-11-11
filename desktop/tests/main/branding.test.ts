import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWindowOptions } from '../../src/main/window-security'

describe('Codex Accounts branding', () => {
  it('uses the same account icon in the UI, Electron installer and .NET executable', () => {
    const root = process.cwd()
    const png = readFileSync(join(root, 'build/account-switcher.png'))
    for (const name of ['logo.png', 'codex-account-switcher-logo.png']) {
      expect(readFileSync(join(root, 'src/renderer/src/assets', name))).toEqual(png)
    }
    expect(readFileSync(join(root, '../codex-account-switcher/Assets/AppIcon.ico')))
      .toEqual(readFileSync(join(root, 'build/icon.ico')))
    const config = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(config.build.productName).toBe('Codex Accounts')
    expect(config.repository.url).toBe('https://github.com/sergeykrasilnikov1/codex-accounts.git')
    expect(createWindowOptions('preload.cjs').title).toBe('Codex Accounts')
  })
})
