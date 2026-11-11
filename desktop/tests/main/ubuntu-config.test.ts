import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Ubuntu packaging', () => {
  it('uses Linux backend artifacts, a PNG icon and Secret Service dependencies', () => {
    const config = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(config.build.linux.target).toEqual(['deb', 'AppImage'])
    expect(config.build.linux.icon).toBe('build/account-switcher.png')
    expect(config.build.linux.extraResources).toContainEqual({
      from: '../artifacts/backend/linux-${arch}', to: 'backend', filter: ['**/*']
    })
    expect(config.build.deb.depends).toEqual(expect.arrayContaining(['libsecret-tools', 'gnome-keyring']))
    expect(config.build.extraResources).toEqual([{ from: 'build', to: '.', filter: ['google-oauth.json'] }])
  })
})
