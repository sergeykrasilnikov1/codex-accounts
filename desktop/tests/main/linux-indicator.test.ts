import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LinuxIndicator } from '../../src/main/linux-indicator'
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, default: { spawn: mocks.spawn } }))

let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }
beforeEach(() => {
  child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
  mocks.spawn.mockReset().mockReturnValue(child)
})

describe('Ubuntu native indicator', () => {
  it('uses unpacked assets and ignores stale or disabled menu actions', () => {
    const indicator = new LinuxIndicator('/opt/app/resources/app.asar/out/main/chunks/icon.png')
    expect(mocks.spawn.mock.calls[0][0]).toBe('/usr/bin/python3')
    expect(mocks.spawn.mock.calls[0][1][1]).toBe('/opt/app/resources/app.asar.unpacked/out/main/chunks/icon.png')
    const click = vi.fn()
    indicator.setMenu([{ label: 'Old', click }])
    indicator.setMenu([{ label: 'Current', click }, { label: 'Disabled', enabled: false, click }])
    child.stdout.write('{"generation":1,"id":0}\n{"generation":2,"id":1}\n{"generation":2,"id":0}\n')
    expect(click).toHaveBeenCalledOnce()
    indicator.destroy()
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('reports a failed helper once and suppresses errors during normal shutdown', () => {
    const indicator = new LinuxIndicator('/icon.png')
    const failed = vi.fn()
    indicator.on('unavailable', failed)
    child.emit('error', new Error('missing dependency'))
    child.emit('exit', 1)
    expect(failed).toHaveBeenCalledOnce()
    indicator.destroy()
    child.emit('exit', 0)
    expect(failed).toHaveBeenCalledOnce()
  })
})
